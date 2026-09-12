import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { readOrCreateDoctrineFile } from "./domain-documents.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DoctrineDocument,
  type DomainMeta,
  type DomainRecord,
  type Result,
} from "./types.ts";

export function slugifyDomainName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "domain";
}

async function slugExists(rootPath: string, slug: string): Promise<boolean> {
  const paths = vaultPaths(rootPath);
  try {
    await fs.access(paths.domainDir(slug));
    return true;
  } catch {
    return false;
  }
}

async function uniqueSlug(rootPath: string, base: string): Promise<string> {
  if (!(await slugExists(rootPath, base))) return base;
  let n = 2;
  while (await slugExists(rootPath, `${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

export async function loadDomainRecord(
  rootPath: string,
  slug: string,
): Promise<DomainRecord> {
  const paths = vaultPaths(rootPath);
  // safeJoin via domainJson / documentMd guards traversal
  const metaRaw = await fs.readFile(paths.domainJson(slug), "utf8");
  const meta = JSON.parse(metaRaw) as DomainMeta;
  const documents = {} as Record<DocumentKind, DoctrineDocument>;
  for (const kind of DOCUMENT_KINDS) {
    documents[kind] = await readOrCreateDoctrineFile(
      paths.documentMd(slug, kind),
      kind,
    );
  }
  return { slug, meta, documents };
}

export async function listDomains(rootPath: string): Promise<Result<DomainRecord[]>> {
  try {
    const paths = vaultPaths(rootPath);
    const domains: DomainRecord[] = [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.domainsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: [] };
      }
      throw e;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      domains.push(await loadDomainRecord(paths.root, entry.name));
    }
    domains.sort((a, b) => {
      if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
      return a.slug.localeCompare(b.slug);
    });
    return { ok: true, value: domains };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createDomain(
  rootPath: string,
  input: { name: string; slug?: string },
): Promise<Result<DomainRecord>> {
  try {
    const paths = vaultPaths(rootPath);
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Domain name is required" };

    const base = slugifyDomainName(input.slug?.trim() || name);
    const slug = await uniqueSlug(paths.root, base);

    // Determine next sortOrder
    const listed = await listDomains(paths.root);
    if (!listed.ok) return listed;
    const maxOrder = listed.value.reduce((m, d) => Math.max(m, d.meta.sortOrder), -1);
    const now = new Date().toISOString();
    const meta: DomainMeta = {
      name,
      description: null,
      color: null,
      sortOrder: maxOrder + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(paths.domainDir(slug), { recursive: true });
    await atomicWriteFile(paths.domainJson(slug), `${JSON.stringify(meta, null, 2)}\n`);

    for (const kind of DOCUMENT_KINDS) {
      const md = serializeFrontmatter(
        {
          title: DOCUMENT_KIND_LABELS[kind],
          locked: false,
          updatedAt: now,
        },
        "",
      );
      await atomicWriteFile(paths.documentMd(slug, kind), md);
    }

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "domain.created",
      summary: `Created domain ${name}`,
      payload: { name },
    });
    if (!logRes.ok) return logRes;

    const record = await loadDomainRecord(paths.root, slug);
    return { ok: true, value: record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDomain(
  rootPath: string,
  slug: string,
  patch: Partial<Pick<DomainMeta, "name" | "description" | "color" | "sortOrder">>,
): Promise<Result<DomainRecord>> {
  try {
    const paths = vaultPaths(rootPath);
    // Throws if slug escapes root
    const metaPath = paths.domainJson(slug);
    let meta: DomainMeta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as DomainMeta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Domain not found: ${slug}` };
      }
      throw e;
    }

    const now = new Date().toISOString();
    if (patch.name !== undefined) meta.name = patch.name;
    if (patch.description !== undefined) meta.description = patch.description;
    if (patch.color !== undefined) meta.color = patch.color;
    if (patch.sortOrder !== undefined) meta.sortOrder = patch.sortOrder;
    meta.updatedAt = now;

    await atomicWriteFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    const record = await loadDomainRecord(paths.root, slug);
    return { ok: true, value: record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function archiveDomain(
  rootPath: string,
  slug: string,
): Promise<Result<DomainRecord>> {
  try {
    const paths = vaultPaths(rootPath);
    const metaPath = paths.domainJson(slug);
    let meta: DomainMeta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as DomainMeta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Domain not found: ${slug}` };
      }
      throw e;
    }

    const now = new Date().toISOString();
    meta.archivedAt = now;
    meta.updatedAt = now;
    await atomicWriteFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    const logRes = await appendLog(paths.root, {
      domainSlug: slug,
      type: "domain.archived",
      summary: `Archived domain ${meta.name}`,
      payload: { name: meta.name },
    });
    if (!logRes.ok) return logRes;

    const record = await loadDomainRecord(paths.root, slug);
    return { ok: true, value: record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
