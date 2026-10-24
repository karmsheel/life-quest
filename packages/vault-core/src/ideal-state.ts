import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { vaultPaths } from "./paths.ts";
import type {
  IdealStateCreateInput,
  IdealStateDocument,
  IdealStateIndexEntry,
  IdealStateUpdatePatch,
  Result,
} from "./types.ts";

/**
 * Ideal State — the operator's titled, freeform documents about the life they
 * are reaching for.
 *
 * Daily Note is one file per day; this page is any number of documents, as and
 * when the operator thinks of one. Each file lives at
 * `notes/ideal-state/{id}.md`, beside the journal and written in the same plain
 * markdown. The id is the filename; the title is the operator's own, carried in
 * the frontmatter so renaming a document is a write and never a move.
 *
 * The title is what makes a document findable, so a write refuses one that is
 * empty, more than one line, or longer than a page's worth of words. The body is
 * free: a document may be titled and left blank until the operator has the
 * words, and prose is trimmed at its end exactly as a daily note is.
 *
 * Failures are `Result`s and reads never create anything. A missing directory is
 * an empty list, not an open-vault failure; a file that cannot be read is an
 * index row with an `error`, so it is visible rather than silently absent.
 * Writing is atomic.
 */

/** The filenames that may hold a document. The id is ours, never a path. */
export const IDEAL_STATE_FILE = /^([A-Za-z0-9][A-Za-z0-9_-]{0,79})\.md$/;

/** A title is a line, not a paragraph. */
export const IDEAL_STATE_TITLE_MAX = 200;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

/** A title in the one form a file holds it, or the reason it cannot be written. */
function normalizeTitle(
  raw: unknown,
): { ok: true; title: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "A title is required" };
  }
  const title = raw.trim();
  if (!title) return { ok: false, error: "A title is required" };
  if (/[\r\n]/.test(title)) {
    return { ok: false, error: "A title is one line" };
  }
  if (title.length > IDEAL_STATE_TITLE_MAX) {
    return {
      ok: false,
      error: `A title is at most ${IDEAL_STATE_TITLE_MAX} characters`,
    };
  }
  return { ok: true, title };
}

/**
 * A body in the one form the file holds it: no CRLF, no trailing blank space,
 * and — when there is prose — exactly one closing newline. An empty body stays
 * empty, because a titled document may be written before its words are.
 */
function canonicalBody(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** The file's own clock, for a hand-written document with no frontmatter dates. */
async function modifiedIso(filePath: string): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function parseDocument(
  id: string,
  raw: string,
  fallbackIso: string,
): IdealStateDocument {
  const { data, body } = parseFrontmatter(raw);
  const createdAt =
    typeof data.createdAt === "string" && data.createdAt
      ? data.createdAt
      : fallbackIso;
  const updatedAt =
    typeof data.updatedAt === "string" && data.updatedAt
      ? data.updatedAt
      : createdAt;
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : "Untitled";
  return { id, title, createdAt, updatedAt, bodyMarkdown: body };
}

function serializeDocument(document: IdealStateDocument): string {
  const md = serializeFrontmatter(
    {
      title: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    },
    document.bodyMarkdown,
  );
  // `formatValue` quotes any scalar containing a space; a document title with
  // spaces reads better unquoted, and `parseFrontmatter` reads it back the same.
  return md.replace(/^title: "([^"\\]+)"$/m, "title: $1");
}

async function writeDocument(
  rootPath: string,
  document: IdealStateDocument,
): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.idealStateDir, { recursive: true });
  await atomicWriteFile(
    paths.idealStateMd(document.id),
    serializeDocument(document),
  );
}

/** Read one document. A missing id is `Ideal state document not found`. */
export async function getIdealState(
  rootPath: string,
  id: string,
): Promise<Result<IdealStateDocument>> {
  if (!IDEAL_STATE_FILE.test(`${id}.md`)) {
    return { ok: false, error: `Invalid ideal state document id: ${id}` };
  }
  try {
    const filePath = vaultPaths(rootPath).idealStateMd(id);
    const raw = await fs.readFile(filePath, "utf8");
    return {
      ok: true,
      value: parseDocument(id, raw, await modifiedIso(filePath)),
    };
  } catch (e) {
    if (isMissing(e)) return { ok: false, error: "Ideal state document not found" };
    return { ok: false, error: message(e) };
  }
}

/**
 * Every document in the page, newest first. Missing `notes/ideal-state/` is an
 * empty page, not a failure; a file that cannot be read is an index row with an
 * `error` and is never overwritten on read.
 */
export async function listIdealStates(
  rootPath: string,
): Promise<Result<IdealStateIndexEntry[]>> {
  let names: string[];
  try {
    const entries = await fs.readdir(vaultPaths(rootPath).idealStateDir, {
      withFileTypes: true,
    });
    names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (e) {
    if (isMissing(e)) return { ok: true, value: [] };
    return { ok: false, error: message(e) };
  }

  const ids = names
    .map((name) => IDEAL_STATE_FILE.exec(name)?.[1])
    .filter((id): id is string => typeof id === "string");

  const index: IdealStateIndexEntry[] = [];
  for (const id of ids) {
    const document = await getIdealState(rootPath, id);
    index.push(
      document.ok
        ? {
            id,
            title: document.value.title,
            updatedAt: document.value.updatedAt,
          }
        : { id, title: null, updatedAt: null, error: document.error },
    );
  }
  // Newest first — the document the operator just wrote leads the page. The id
  // breaks a tie so two writes in the same millisecond have a stable order.
  index.sort((a, b) => {
    const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (byUpdated !== 0) return byUpdated;
    return a.id.localeCompare(b.id);
  });
  return { ok: true, value: index };
}

/** Create one document. The operator names it; the vault mints the id. */
export async function createIdealState(
  rootPath: string,
  input: IdealStateCreateInput,
): Promise<Result<IdealStateDocument>> {
  const title = normalizeTitle(input.title);
  if (!title.ok) return title;
  try {
    const now = new Date().toISOString();
    const document: IdealStateDocument = {
      id: randomUUID(),
      title: title.title,
      createdAt: now,
      updatedAt: now,
      bodyMarkdown: canonicalBody(input.bodyMarkdown ?? ""),
    };
    await writeDocument(rootPath, document);
    return { ok: true, value: document };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Rewrite a document's title and/or body. A title is never allowed to become
 * empty; a body may be, because the document is still named and still exists.
 */
export async function updateIdealState(
  rootPath: string,
  id: string,
  patch: IdealStateUpdatePatch,
): Promise<Result<IdealStateDocument>> {
  const existing = await getIdealState(rootPath, id);
  if (!existing.ok) return existing;

  let title = existing.value.title;
  if (patch.title !== undefined) {
    const normalized = normalizeTitle(patch.title);
    if (!normalized.ok) return normalized;
    title = normalized.title;
  }

  try {
    const document: IdealStateDocument = {
      ...existing.value,
      title,
      updatedAt: new Date().toISOString(),
      bodyMarkdown:
        patch.bodyMarkdown === undefined
          ? existing.value.bodyMarkdown
          : canonicalBody(patch.bodyMarkdown),
    };
    await writeDocument(rootPath, document);
    return { ok: true, value: document };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Remove a document from the page and from the vault. */
export async function deleteIdealState(
  rootPath: string,
  id: string,
): Promise<Result<IdealStateDocument>> {
  const existing = await getIdealState(rootPath, id);
  if (!existing.ok) return existing;
  try {
    await fs.unlink(vaultPaths(rootPath).idealStateMd(id));
    return { ok: true, value: existing.value };
  } catch (e) {
    if (isMissing(e)) return { ok: false, error: "Ideal state document not found" };
    return { ok: false, error: message(e) };
  }
}
