import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { getPage } from "./pages.ts";
import { assertPhysicalContainment, vaultPaths } from "./paths.ts";
import { isDomainLive } from "./domain-databases.ts";
import { toSqlBindable } from "./sql-bind.ts";
import { EGRESS_MAX_BODY_BYTES, fetchPublicText } from "./egress.ts";
import type {
  Actor,
  PageBlock,
  PageRecord,
  Result,
  ScriptApplyResult,
  ScriptFetchResult,
  ScriptQueryResult,
  ScriptRunResult,
} from "./types.ts";

const MAX_ROWS = 200;
const MAX_BODY = 65536;
/**
 * KAR-56 script blocks are an operator convenience, not a batch language: five
 * statements and five fetches is far past any block the product has ever shown,
 * and the cap keeps one block from wedging the synchronous main-process call.
 */
const MAX_QUERIES = 5;
const MAX_FETCHES = 5;
/** A script is a statement or a small JSON object, never a document. */
const MAX_SOURCE_LENGTH = 16 * 1024;
const READ_ONLY_ERROR = "Script queries must be a single read-only SELECT";

const FORBIDDEN_WORDS = [
  "attach",
  "detach",
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "replace",
  "vacuum",
  "reindex",
  "pragma",
  "load_extension",
  // `WITH RECURSIVE` starts with `with`, so the statement check above lets it
  // through, and SQLite will happily build an unbounded result set from it. A
  // script block has no legitimate recursive query against the row store.
  "recursive",
];

/**
 * Functions a read-only script has no use for and which can allocate or touch
 * files outside the row store. `randomblob(500_000_000)` measured as a 4 s,
 * 500 MB allocation inside the synchronous main-process call, so the argument is
 * not something a bounds check on the result set can contain.
 */
const BANNED_FUNCTIONS = ["randomblob", "zeroblob", "readfile", "writefile", "load_extension"];

type ScriptParam = string | number | boolean | null;

type ParsedScript = {
  queries: Array<{ sql: string; params: ScriptParam[] }>;
  fetches: Array<{ url: string }>;
};

/** Strip one trailing semicolon and reject a second statement. */
function normalizeSql(raw: string): Result<string> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: READ_ONLY_ERROR };
  let body = trimmed;
  if (body.endsWith(";")) body = body.slice(0, -1).trim();
  if (body.length === 0) return { ok: false, error: READ_ONLY_ERROR };
  if (body.includes(";")) return { ok: false, error: READ_ONLY_ERROR };
  return { ok: true, value: body };
}

function checkReadOnly(sql: string): Result<string> {
  const normalized = normalizeSql(sql);
  if (!normalized.ok) return normalized;
  const body = normalized.value;
  if (!/^(select|with)\b/i.test(body)) return { ok: false, error: READ_ONLY_ERROR };
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(body)) {
      return { ok: false, error: READ_ONLY_ERROR };
    }
  }
  for (const fn of BANNED_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, "i").test(body)) {
      return { ok: false, error: `Script queries cannot use ${fn}()` };
    }
  }
  return { ok: true, value: body };
}

function checkParams(raw: unknown): Result<ScriptParam[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Script query params must be an array" };
  for (const p of raw) {
    const t = typeof p;
    if (p === null) continue;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      return { ok: false, error: "Script query params must be strings, numbers, booleans, or null" };
    }
  }
  return { ok: true, value: raw as ScriptParam[] };
}

/** Parse the pasted source into queries + fetches. Never evaluates code. */
export function parseScriptSource(source: string): Result<ParsedScript> {
  if (typeof source !== "string") {
    return { ok: false, error: "Script source must be a string" };
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    return { ok: false, error: `Script source is longer than ${MAX_SOURCE_LENGTH} characters` };
  }
  const trimmed = source.trim();
  if (!trimmed) return { ok: true, value: { queries: [], fetches: [] } };

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: "Script JSON is unreadable" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Script must be a read-only SELECT or JSON" };
    }
    const obj = parsed as { queries?: unknown; fetches?: unknown };

    const queries: Array<{ sql: string; params: ScriptParam[] }> = [];
    if (obj.queries !== undefined) {
      if (!Array.isArray(obj.queries)) {
        return { ok: false, error: "Script queries must be an array" };
      }
      if (obj.queries.length > MAX_QUERIES) {
        return { ok: false, error: `A script may run at most ${MAX_QUERIES} queries` };
      }
      for (const entry of obj.queries) {
        if (!entry || typeof entry !== "object") {
          return { ok: false, error: "Script query must be an object" };
        }
        const q = entry as { sql?: unknown; params?: unknown };
        if (typeof q.sql !== "string") {
          return { ok: false, error: "Script query requires a sql string" };
        }
        const sql = checkReadOnly(q.sql);
        if (!sql.ok) return sql;
        const params = checkParams(q.params);
        if (!params.ok) return params;
        queries.push({ sql: sql.value, params: params.value });
      }
    }

    const fetches: Array<{ url: string }> = [];
    if (obj.fetches !== undefined) {
      if (!Array.isArray(obj.fetches)) {
        return { ok: false, error: "Script fetches must be an array" };
      }
      if (obj.fetches.length > MAX_FETCHES) {
        return { ok: false, error: `A script may fetch at most ${MAX_FETCHES} URLs` };
      }
      for (const entry of obj.fetches) {
        if (!entry || typeof entry !== "object") {
          return { ok: false, error: "Script fetch must be an object" };
        }
        const url = (entry as { url?: unknown }).url;
        if (typeof url !== "string" || !url.startsWith("https://")) {
          return { ok: false, error: "Script fetch requires https" };
        }
        fetches.push({ url });
      }
    }

    return { ok: true, value: { queries, fetches } };
  }

  if (/^(select|with)\b/i.test(trimmed)) {
    const sql = checkReadOnly(trimmed);
    if (!sql.ok) return sql;
    return { ok: true, value: { queries: [{ sql: sql.value, params: [] }], fetches: [] } };
  }

  return { ok: false, error: "Script must be a read-only SELECT or JSON" };
}

async function defaultFetch(url: string): Promise<{ status: number; body: string }> {
  // https only, public host only, manual re-validated redirects, streamed byte
  // cap. See `egress.ts`: this is the same guard the FX refresh uses, because
  // both fetch a URL that came from data the attacker may control.
  const res = await fetchPublicText(url, {
    timeoutMs: 5_000,
    maxBytes: Math.min(MAX_BODY, EGRESS_MAX_BODY_BYTES),
    maxRedirects: 3,
  });
  return { status: res.status, body: res.body };
}

async function runQueries(
  root: string,
  domainSlug: string,
  queries: Array<{ sql: string; params: ScriptParam[] }>,
  warnings: string[],
): Promise<Result<ScriptQueryResult[]>> {
  if (queries.length === 0) return { ok: true, value: [] };

  // Reject any slug that tries to walk. safeJoin alone only catches escapes past
  // the vault root; a "../health" slug would silently resolve to a real folder.
  if (
    !domainSlug ||
    domainSlug === "." ||
    domainSlug === ".." ||
    /[/\\]/.test(domainSlug) ||
    domainSlug.includes("..")
  ) {
    return { ok: false, error: `Invalid domain slug: ${domainSlug}` };
  }

  // safeJoin throws on traversal — a bad slug fails closed here.
  let sqlitePath: string;
  try {
    sqlitePath = vaultPaths(root).domainSqlite(domainSlug);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    await assertPhysicalContainment(root, sqlitePath, "read");
    await fs.access(sqlitePath);
  } catch {
    // Never create the file. Queries stay empty; fetches still run.
    warnings.push("No database for this domain yet.");
    return { ok: true, value: [] };
  }

  const out: ScriptQueryResult[] = [];
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    for (const q of queries) {
      const stmt = db.prepare(q.sql);
      const columns = stmt.columns().map((c: { name: string }) => c.name);
      // Bind through `toSqlBindable`: a script may write `true` for a flag, and
      // node:sqlite refuses a boolean at bind time (see `sql-bind.ts`).
      //
      // Iterate rather than `.all()`: the cap must bound the WORK, not just the
      // answer. `.all()` builds the entire result set in memory before the slice
      // (200k rows measured 375 ms and a hostile query can be far larger), while
      // stopping the iterator at MAX_ROWS finalises the statement with the same
      // cheap `LIMIT`-like effect.
      const rows: Array<Array<unknown>> = [];
      let truncated = false;
      for (const row of stmt.iterate(...q.params.map(toSqlBindable)) as Iterable<
        Record<string, unknown>
      >) {
        if (rows.length >= MAX_ROWS) {
          truncated = true;
          break;
        }
        rows.push(columns.map((c: string) => row[c] ?? null));
      }
      if (truncated) warnings.push("Query truncated to 200 rows");
      out.push({ sql: q.sql, columns, rows });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  return { ok: true, value: out };
}

export async function runScriptBlock(
  root: string,
  input: {
    domainSlug: string;
    source: string;
    fetchImpl?: (url: string) => Promise<{ status: number; body: string }>;
  },
): Promise<Result<ScriptRunResult>> {
  try {
    if (typeof input.source !== "string") {
      return { ok: false, error: "Script source must be a string" };
    }
    const trimmed = input.source.trim();
    const warnings: string[] = [];
    if (!trimmed) {
      return { ok: true, value: { queries: [], fetches: [], warnings: ["No script yet."] } };
    }

    const parsed = parseScriptSource(input.source);
    if (!parsed.ok) return parsed;

    const queries = await runQueries(root, input.domainSlug, parsed.value.queries, warnings);
    if (!queries.ok) return queries;

    const fetchImpl = input.fetchImpl ?? defaultFetch;
    const fetches: ScriptFetchResult[] = [];
    for (const f of parsed.value.fetches) {
      try {
        const res = await fetchImpl(f.url);
        fetches.push({ url: f.url, status: res.status, body: res.body.slice(0, MAX_BODY) });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return { ok: true, value: { queries: queries.value, fetches, warnings } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Write one script block straight to the page file. Creates no Decision,
 * for a user or an agent. Any other page edit still goes through updatePage.
 */
export async function applyScriptBlock(
  root: string,
  input: {
    domainSlug: string;
    pageId: string;
    blockId?: string;
    name: string;
    source: string;
    actor: Actor;
  },
): Promise<Result<ScriptApplyResult>> {
  try {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return { ok: false, error: "Script name is required" };
    if (typeof input.source !== "string") {
      return { ok: false, error: "Script source must be a string" };
    }

    if (!(await isDomainLive(root, input.domainSlug))) {
      return { ok: false, error: `Domain not found or archived: ${input.domainSlug}` };
    }

    const existing = await getPage(root, input.domainSlug, input.pageId);
    if (!existing.ok) return existing;
    const page = existing.value;

    let blocks: PageBlock[];
    let blockId: string;
    if (input.blockId) {
      const target = page.blocks.find((b) => b.id === input.blockId);
      if (!target) return { ok: false, error: `Block not found: ${input.blockId}` };
      if (target.kind !== "script") return { ok: false, error: "Block is not a script" };
      blockId = input.blockId;
      blocks = page.blocks.map((b) =>
        b.id === input.blockId ? ({ ...b, kind: "script", name, source: input.source } as PageBlock) : b,
      );
    } else {
      blockId = randomUUID();
      const block: PageBlock = { id: blockId, kind: "script", name, source: input.source };
      blocks = [...page.blocks, block];
    }

    const updated: PageRecord = {
      ...page,
      blocks,
      updatedAt: new Date().toISOString(),
    };

    const filePath = vaultPaths(root).domainPage(input.domainSlug, input.pageId);
    await assertPhysicalContainment(root, filePath, "write");
    await atomicWriteFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);

    await appendLog(root, {
      domainSlug: input.domainSlug,
      type: "page.script-applied",
      summary: `Applied script block ${name}`,
      payload: { pageId: input.pageId, blockId, name, actor: input.actor?.type ?? "user" },
      // KAR-9: the life-log line names the writer, not just the actor type.
      actor: input.actor,
    });

    return { ok: true, value: { applied: true, name, blockId, decision: null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
