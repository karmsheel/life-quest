import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { vaultPaths } from "./paths.ts";
import {
  actorDisplayName,
  assertEditable,
  lockedFromFrontmatter,
} from "./documents.ts";
import { appendLog } from "./log.ts";
import { USER_ACTOR, type Actor } from "./types.ts";
import type {
  LibraryCreateInput,
  LibraryDocument,
  LibraryListResult,
  LibraryUpdatePatch,
  Result,
} from "./types.ts";

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function asError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

async function domainDirExists(rootPath: string, slug: string): Promise<boolean> {
  try {
    await fs.access(vaultPaths(rootPath).domainDir(slug));
    return true;
  } catch {
    return false;
  }
}

function uniqueSlugs(slugs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of slugs) {
    const slug = raw.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

async function normalizeDomains(
  rootPath: string,
  slugs: string[] | undefined,
): Promise<Result<string[]>> {
  const unique = uniqueSlugs(slugs ?? []);
  for (const slug of unique) {
    if (!(await domainDirExists(rootPath, slug))) {
      return fail(`Unknown domain: ${slug}`);
    }
  }
  return ok(unique);
}

function parseDomainSlugs(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return value as string[];
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseLibraryFile(id: string, raw: string): LibraryDocument | null {
  if (!id.trim()) return null;
  const { data, body } = parseFrontmatter(raw);
  if (typeof data.title !== "string") return null;
  if (!isIso(data.createdAt) || !isIso(data.updatedAt)) return null;
  if (data.deletedAt !== null && !isIso(data.deletedAt)) return null;
  const domainSlugs = parseDomainSlugs(data.domains);
  if (!domainSlugs) return null;
  return {
    id,
    title: data.title,
    bodyMarkdown: body,
    domainSlugs,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    locked: lockedFromFrontmatter(data),
  };
}

async function writeLibraryFile(
  rootPath: string,
  record: LibraryDocument,
): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.documentsDir, { recursive: true });
  const md = serializeFrontmatter(
    {
      title: record.title,
      domains: JSON.stringify(record.domainSlugs),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      locked: record.locked,
    },
    record.bodyMarkdown,
  );
  // formatValue quotes scalars that contain spaces; library notes keep
  // unquoted titles (`title: Inbox note`) which parseFrontmatter still reads.
  const raw = md.replace(/^title: "([^"\\]+)"$/m, "title: $1");
  await atomicWriteFile(paths.libraryDocumentMd(record.id), raw);
}

async function readLiveLibrary(
  rootPath: string,
  id: string,
): Promise<Result<LibraryDocument>> {
  try {
    const filePath = vaultPaths(rootPath).libraryDocumentMd(id);
    const raw = await fs.readFile(filePath, "utf8");
    const record = parseLibraryFile(id, raw);
    if (!record || record.deletedAt) return fail("Document not found");
    return ok(record);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fail("Document not found");
    return fail(asError(e));
  }
}

export async function libraryList(
  rootPath: string,
): Promise<Result<LibraryListResult>> {
  try {
    const paths = vaultPaths(rootPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.documentsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return ok({ records: [], skipped: 0 });
      }
      throw e;
    }

    const records: LibraryDocument[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const id = entry.name.slice(0, -".md".length);
      let filePath: string;
      try {
        filePath = paths.libraryDocumentMd(id);
      } catch {
        skipped += 1;
        continue;
      }
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const record = parseLibraryFile(id, raw);
        if (!record) {
          skipped += 1;
          continue;
        }
        if (record.deletedAt) continue;
        records.push(record);
      } catch {
        skipped += 1;
      }
    }
    records.sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return a.id.localeCompare(b.id);
    });
    return ok({ records, skipped });
  } catch (e) {
    return fail(asError(e));
  }
}

export async function libraryCreate(
  rootPath: string,
  input: LibraryCreateInput,
  actor: Actor = USER_ACTOR,
): Promise<Result<LibraryDocument>> {
  try {
    const title = input.title.trim();
    if (!title) return fail("title is required");
    const domains = await normalizeDomains(rootPath, input.domainSlugs);
    if (!domains.ok) return domains;
    const now = new Date().toISOString();
    const record: LibraryDocument = {
      id: input.id ?? randomUUID(),
      title,
      bodyMarkdown: input.bodyMarkdown ?? "",
      domainSlugs: domains.value,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locked: false,
    };
    await writeLibraryFile(rootPath, record);
    const logged = await appendLog(rootPath, {
      domainSlug: record.domainSlugs[0] ?? null,
      type: "document.created",
      summary: `${actorDisplayName(actor)} created ${record.title}`,
      payload: { id: record.id, title: record.title },
      actor,
    });
    if (!logged.ok) return logged;
    return ok(record);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function libraryGet(
  rootPath: string,
  id: string,
): Promise<Result<LibraryDocument>> {
  return readLiveLibrary(rootPath, id);
}

export async function libraryUpdate(
  rootPath: string,
  id: string,
  patch: LibraryUpdatePatch,
  actor: Actor = USER_ACTOR,
): Promise<Result<LibraryDocument>> {
  try {
    const loaded = await readLiveLibrary(rootPath, id);
    if (!loaded.ok) return loaded;
    const editable = assertEditable(loaded.value.locked);
    if (!editable.ok) return fail(editable.reason);
    let title = loaded.value.title;
    if (patch.title !== undefined) {
      title = patch.title.trim();
      if (!title) return fail("title is required");
    }
    let domainSlugs = loaded.value.domainSlugs;
    if (patch.domainSlugs !== undefined) {
      const domains = await normalizeDomains(rootPath, patch.domainSlugs);
      if (!domains.ok) return domains;
      domainSlugs = domains.value;
    }
    const next: LibraryDocument = {
      ...loaded.value,
      title,
      bodyMarkdown:
        patch.bodyMarkdown !== undefined
          ? patch.bodyMarkdown
          : loaded.value.bodyMarkdown,
      domainSlugs,
      updatedAt: new Date().toISOString(),
    };
    await writeLibraryFile(rootPath, next);
    const logged = await appendLog(rootPath, {
      domainSlug: next.domainSlugs[0] ?? null,
      type: "document.updated",
      summary: `${actorDisplayName(actor)} updated ${next.title}`,
      payload: { id: next.id, title: next.title },
      actor,
    });
    if (!logged.ok) return logged;
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function libraryDelete(
  rootPath: string,
  id: string,
): Promise<Result<LibraryDocument>> {
  try {
    const loaded = await readLiveLibrary(rootPath, id);
    if (!loaded.ok) return loaded;
    const now = new Date().toISOString();
    const next: LibraryDocument = {
      ...loaded.value,
      deletedAt: now,
      updatedAt: now,
    };
    await writeLibraryFile(rootPath, next);
    return ok(next);
  } catch (e) {
    return fail(asError(e));
  }
}

export async function setLibraryLocked(
  rootPath: string,
  id: string,
  locked: boolean,
  actor: Actor = USER_ACTOR,
): Promise<Result<LibraryDocument>> {
  if (actor.type !== "user") {
    return fail("Only the user may lock or unlock library notes.");
  }
  const loaded = await readLiveLibrary(rootPath, id);
  if (!loaded.ok) return loaded;
  if (loaded.value.locked === locked) {
    return ok(loaded.value);
  }
  const next: LibraryDocument = {
    ...loaded.value,
    locked,
    updatedAt: new Date().toISOString(),
  };
  await writeLibraryFile(rootPath, next);
  const logged = await appendLog(rootPath, {
    domainSlug: next.domainSlugs[0] ?? null,
    type: "document.lock_changed",
    summary: `${actorDisplayName(actor)} ${locked ? "locked" : "unlocked"} ${next.title}`,
    payload: { id: next.id, locked },
    actor,
  });
  if (!logged.ok) return logged;
  return ok(next);
}
