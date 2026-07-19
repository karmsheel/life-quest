import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { assertEditable, canTransitionStatus } from "./documents.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentStatus,
  type DoctrineDocument,
  type Result,
} from "./types.ts";

const KIND_TITLES: Record<DocumentKind, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

function isDocumentKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

async function readDoctrineFile(
  filePath: string,
  kind: DocumentKind,
): Promise<DoctrineDocument> {
  const raw = await fs.readFile(filePath, "utf8");
  const st = await fs.stat(filePath);
  const { data, body } = parseFrontmatter(raw);
  return {
    kind,
    title: typeof data.title === "string" ? data.title : KIND_TITLES[kind],
    status: (data.status as DocumentStatus) || "draft",
    forgedAt: (data.forgedAt as string | null) ?? null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : st.mtime.toISOString(),
    bodyMarkdown: body,
    mtimeMs: st.mtimeMs,
  };
}

export async function getDocument(
  rootPath: string,
  slug: string,
  kind: DocumentKind,
): Promise<Result<DoctrineDocument>> {
  try {
    if (!isDocumentKind(kind)) {
      return { ok: false, error: `Invalid document kind: ${kind}` };
    }
    const paths = vaultPaths(rootPath);
    const filePath = paths.documentMd(slug, kind);
    try {
      const doc = await readDoctrineFile(filePath, kind);
      return { ok: true, value: doc };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Document not found: ${slug}/${kind}` };
      }
      throw e;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveDocument(
  rootPath: string,
  slug: string,
  kind: DocumentKind,
  bodyMarkdown: string,
  title?: string,
): Promise<Result<DoctrineDocument>> {
  try {
    if (!isDocumentKind(kind)) {
      return { ok: false, error: `Invalid document kind: ${kind}` };
    }
    const paths = vaultPaths(rootPath);
    const filePath = paths.documentMd(slug, kind);

    let existing: DoctrineDocument;
    try {
      existing = await readDoctrineFile(filePath, kind);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Document not found: ${slug}/${kind}` };
      }
      throw e;
    }

    const editable = assertEditable(existing.status);
    if (!editable.ok) {
      return { ok: false, error: editable.reason };
    }

    const now = new Date().toISOString();
    const nextTitle = title !== undefined ? title : existing.title;
    const md = serializeFrontmatter(
      {
        title: nextTitle,
        status: existing.status,
        forgedAt: existing.forgedAt,
        updatedAt: now,
      },
      bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "document.updated",
      summary: `Updated ${kind} for ${slug}`,
      payload: { kind, title: nextTitle },
    });
    if (!logRes.ok) return logRes;

    const doc = await readDoctrineFile(filePath, kind);
    return { ok: true, value: doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setDocumentStatus(
  rootPath: string,
  slug: string,
  kind: DocumentKind,
  status: DocumentStatus,
): Promise<Result<DoctrineDocument>> {
  try {
    if (!isDocumentKind(kind)) {
      return { ok: false, error: `Invalid document kind: ${kind}` };
    }
    const paths = vaultPaths(rootPath);
    const filePath = paths.documentMd(slug, kind);

    let existing: DoctrineDocument;
    try {
      existing = await readDoctrineFile(filePath, kind);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Document not found: ${slug}/${kind}` };
      }
      throw e;
    }

    if (!canTransitionStatus(existing.status, status)) {
      return {
        ok: false,
        error: `Invalid status transition: ${existing.status} → ${status}`,
      };
    }

    const now = new Date().toISOString();
    const forgedAt = status === "forged" ? now : existing.forgedAt;
    const md = serializeFrontmatter(
      {
        title: existing.title,
        status,
        forgedAt,
        updatedAt: now,
      },
      existing.bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "document.status_changed",
      summary: `Status ${existing.status} → ${status} for ${slug}/${kind}`,
      payload: { kind, from: existing.status, to: status },
    });
    if (!logRes.ok) return logRes;

    const doc = await readDoctrineFile(filePath, kind);
    return { ok: true, value: doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
