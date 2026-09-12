import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteBytes, atomicWriteFile } from "./atomic-write.ts";
import {
  actorDisplayName,
  assertEditable,
  lockedFromFrontmatter,
} from "./documents.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  USER_ACTOR,
  type Actor,
  type DocumentKind,
  type DoctrineDocument,
  type Result,
} from "./types.ts";

export const DOCUMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_MEDIA_REL = /^media\/[A-Za-z0-9._-]+$/;

const MEDIA_EXT: Record<string, { ext: string; mime: string }> = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/gif": { ext: "gif", mime: "image/gif" },
  "image/webp": { ext: "webp", mime: "image/webp" },
};

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function isDocumentKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

function doctrineMatter(title: string, locked: boolean, updatedAt: string) {
  return { title, locked, updatedAt };
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
    title: typeof data.title === "string" ? data.title : DOCUMENT_KIND_LABELS[kind],
    locked: lockedFromFrontmatter(data),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : st.mtime.toISOString(),
    bodyMarkdown: body,
    mtimeMs: st.mtimeMs,
  };
}

export async function readOrCreateDoctrineFile(
  filePath: string,
  kind: DocumentKind,
): Promise<DoctrineDocument> {
  try {
    return await readDoctrineFile(filePath, kind);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const now = new Date().toISOString();
  const title = DOCUMENT_KIND_LABELS[kind];
  const md = serializeFrontmatter(
    doctrineMatter(title, false, now),
    "",
  );
  await atomicWriteFile(filePath, md);
  return readDoctrineFile(filePath, kind);
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
  actor: Actor = USER_ACTOR,
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

    const editable = assertEditable(existing.locked);
    if (!editable.ok) {
      return { ok: false, error: editable.reason };
    }

    const now = new Date().toISOString();
    const nextTitle = title !== undefined ? title : existing.title;
    const md = serializeFrontmatter(
      doctrineMatter(nextTitle, existing.locked, now),
      bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "document.updated",
      summary: `${actorDisplayName(actor)} updated ${DOCUMENT_KIND_LABELS[kind]}`,
      payload: { kind, title: nextTitle },
      actor,
    });
    if (!logRes.ok) return logRes;

    const doc = await readDoctrineFile(filePath, kind);
    return { ok: true, value: doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setDocumentLocked(
  rootPath: string,
  slug: string,
  kind: DocumentKind,
  locked: boolean,
  actor: Actor = USER_ACTOR,
): Promise<Result<DoctrineDocument>> {
  try {
    if (!isDocumentKind(kind)) {
      return { ok: false, error: `Invalid document kind: ${kind}` };
    }
    if (actor.type !== "user") {
      return { ok: false, error: "Only the user can lock or unlock documents" };
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

    if (existing.locked === locked) {
      return { ok: true, value: existing };
    }

    const now = new Date().toISOString();
    const md = serializeFrontmatter(
      doctrineMatter(existing.title, locked, now),
      existing.bodyMarkdown,
    );
    await atomicWriteFile(filePath, md);

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "document.lock_changed",
      summary: `${actorDisplayName(actor)} ${locked ? "locked" : "unlocked"} ${DOCUMENT_KIND_LABELS[kind]}`,
      payload: { kind, locked },
      actor,
    });
    if (!logRes.ok) return logRes;

    const doc = await readDoctrineFile(filePath, kind);
    return { ok: true, value: doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveDocumentMedia(
  rootPath: string,
  slug: string,
  input: { bytes: Uint8Array; mime: string },
): Promise<Result<{ relPath: string }>> {
  try {
    const kind = MEDIA_EXT[input.mime];
    if (!kind) return { ok: false, error: `Unsupported image type: ${input.mime}` };
    if (input.bytes.byteLength === 0) {
      return { ok: false, error: "Image is empty" };
    }
    if (input.bytes.byteLength > DOCUMENT_MEDIA_MAX_BYTES) {
      return { ok: false, error: "Image is larger than 8 MB" };
    }
    const paths = vaultPaths(rootPath);
    try {
      await fs.access(paths.domainJson(slug));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Domain not found: ${slug}` };
      }
      throw e;
    }
    const name = `${randomUUID()}.${kind.ext}`;
    const filePath = paths.domainMediaFile(slug, name);
    await atomicWriteBytes(filePath, input.bytes);
    return { ok: true, value: { relPath: `media/${name}` } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readDocumentMedia(
  rootPath: string,
  slug: string,
  relPath: string,
): Promise<Result<{ bytes: Uint8Array; mime: string }>> {
  try {
    if (!DOCUMENT_MEDIA_REL.test(relPath)) {
      return { ok: false, error: `Invalid media path: ${relPath}` };
    }
    const name = relPath.slice("media/".length);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const mime = EXT_MIME[ext];
    if (!mime) return { ok: false, error: `Unsupported image type: ${ext}` };
    const filePath = vaultPaths(rootPath).domainMediaFile(slug, name);
    const buf = await fs.readFile(filePath);
    return { ok: true, value: { bytes: new Uint8Array(buf), mime } };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: `Media not found: ${slug}/${relPath}` };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
