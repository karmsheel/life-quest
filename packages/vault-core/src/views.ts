import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { todayLocalIso } from "./map/dates.ts";
import { vaultPaths } from "./paths.ts";
import { isDomainLive, getDatabase, rowDisplayLabel, readRegistry } from "./domain-databases.ts";
import {
  FINANCE_DB_IDS,
  type Actor,
  type ComposedViewRunResult,
  type DatabaseMeta,
  type DatabaseColumn,
  type DomainDatabaseRegistry,
  type Result,
  type ViewBlock,
  type ViewBlockSpec,
  type ViewMeasure,
  type ViewPresentation,
  type ViewQuerySpec,
  type ViewSpec,
  type ViewRunResult,
} from "./types.ts";

/**
 * Agent-built dashboard views (plan.md design, 2026-09-30). Slice 1: the view
 * file, the validator, and runView. The SQL here stays a parameterized read —
 * filters and the time window ride as bound parameters on json_extract; every
 * aggregation, relation label, and currency rule happens in TS where the
 * warnings live. A preview and a dashboard refresh hit this exact same path.
 *
 * Composed views (2026-10-07): a view may carry several `blocks`, so one card
 * can show a metric, its budget table, and its trend line together. Every block
 * runs through the single-block path below, so a panel cannot drift from the
 * behaviour of a one-block view.
 */

export const VIEW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const PRESENTATIONS: readonly ViewPresentation[] = ["table", "bar", "line", "metric"];
export const TIME_WINDOWS = ["all", "this-month", "last-30-days", "this-year"] as const;
export const TIME_BUCKETS = ["day", "week", "month"] as const;
export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export const MEASURES: readonly ViewMeasure[] = ["sum", "count", "last", "avg"];

const DEFAULT_VIEW_LIMIT = 12;
const MAX_VIEW_LIMIT = 50;
/** A composed view is a card, not a report: eight panels is already a lot. */
export const MAX_VIEW_BLOCKS = 8;

type RawSpec = {
  title?: unknown;
  presentation?: unknown;
  measure?: unknown;
  measureColumnId?: unknown;
  groupBy?: unknown;
  timeBucket?: unknown;
  timeColumnId?: unknown;
  timeWindow?: unknown;
  filters?: unknown;
  sort?: unknown;
  limit?: unknown;
  convertToZar?: unknown;
};

function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function validWindow(w: unknown): boolean {
  if (w == null) return true;
  if (typeof w === "string") return (TIME_WINDOWS as readonly string[]).includes(w);
  if (typeof w !== "object") return false;
  const o = w as { kind?: unknown; start?: unknown; end?: unknown; weeks?: unknown };
  if (o.kind === "last-weeks") {
    return typeof o.weeks === "number" && Number.isFinite(o.weeks) && o.weeks >= 1 && o.weeks <= 260;
  }
  return o.kind === "custom" && isDateString(o.start) && isDateString(o.end);
}

/**
 * Validate a view spec against the database's column registry. Shape rules:
 * table and bar aggregate into label/value, so they need a groupBy; a metric
 * is one number and must not group; a line needs a date groupBy collapsed by a
 * timeBucket so its x-axis is time. Every failure names the offending field.
 *
 * A composed view is validated block by block, and its blocks carry their own
 * presentation, so the same three rules apply to every panel. The root query
 * fields are the first block's defaults and are validated only through the
 * blocks that inherit them.
 */
export function validateViewSpec(spec: unknown, db: DatabaseMeta): Result<true> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { ok: false, error: "View spec must be an object" };
  }
  const v = spec as RawSpec & { blocks?: unknown; databaseId?: unknown };
  if (!v.title || typeof v.title !== "string" || !v.title.trim()) {
    return { ok: false, error: "View title is required" };
  }
  // Which database a block reads is the view's, not the block's: every block of
  // a composed view is one panel of the same subject.
  const databaseId = typeof v.databaseId === "string" ? v.databaseId : "";
  const rootBlock = asBlock(v as unknown as Record<string, unknown>);
  if (v.blocks !== undefined) {
    if (!Array.isArray(v.blocks)) return { ok: false, error: "View blocks must be an array" };
    if (v.blocks.length === 0) return { ok: false, error: "A composed view needs at least one block" };
    if (v.blocks.length > MAX_VIEW_BLOCKS) {
      return { ok: false, error: `A composed view holds at most ${MAX_VIEW_BLOCKS} blocks` };
    }
    const seen = new Set<string>();
    for (let i = 0; i < v.blocks.length; i += 1) {
      const raw = v.blocks[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: `Block ${i}: must be an object` };
      }
      const b = raw as RawSpec & { id?: unknown; span?: unknown };
      if (typeof b.id !== "string" || !b.id.trim()) {
        return { ok: false, error: `Block ${i}: id is required` };
      }
      if (seen.has(b.id)) return { ok: false, error: `Block ${i}: duplicate id ${b.id}` };
      seen.add(b.id);
      if (!b.title || typeof b.title !== "string" || !b.title.trim()) {
        return { ok: false, error: `Block ${b.id}: title is required` };
      }
      if (b.span != null && b.span !== 1 && b.span !== 2) {
        return { ok: false, error: `Block ${b.id}: span must be 1 or 2` };
      }
      const blockCheck = validateBlock(
        {
          ...toBlockSpec(
            resolveBlock(rootBlock, {
              ...asBlock(b as unknown as Record<string, unknown>),
              id: b.id,
              title: b.title,
            }),
            i,
          ),
          databaseId,
        },
        db,
        `Block ${b.id}`,
      );
      if (!blockCheck.ok) return blockCheck;
    }
    return { ok: true, value: true };
  }
  return validateBlock(
    {
      ...toBlockSpec(completeBlock(rootBlock, "block-1"), 0),
      databaseId,
    },
    db,
    "",
  );
}

/** One block's own shape rules, with `where` naming it in every failure. */
function validateBlock(block: ViewBlockSpec & { databaseId: string }, db: DatabaseMeta, where: string): Result<true> {
  const at = where ? `${where}: ` : "";
  const v = block as unknown as RawSpec;
  const presentation = v.presentation as ViewPresentation;
  if (!(PRESENTATIONS as readonly string[]).includes(presentation)) {
    return { ok: false, error: `${at}Unknown view presentation: ${String(v.presentation)}` };
  }
  const measure = (v.measure ?? "sum") as string;
  if (!(MEASURES as readonly string[]).includes(measure)) {
    return { ok: false, error: `${at}Unknown view measure: ${String(v.measure)}` };
  }

  const colById = new Map(db.columns.map((c) => [c.id, c]));
  const col = (id: unknown): DatabaseColumn | null =>
    typeof id === "string" && colById.has(id) ? (colById.get(id) as DatabaseColumn) : null;

  const groupCol = v.groupBy != null ? col(v.groupBy) : null;
  if (v.groupBy != null && !groupCol) {
    return { ok: false, error: `${at}View groupBy column does not exist: ${String(v.groupBy)}` };
  }

  if ((presentation === "table" || presentation === "bar") && !groupCol) {
    return { ok: false, error: `${at}A ${presentation} view requires a groupBy column` };
  }
  if (presentation === "metric" && groupCol) {
    return { ok: false, error: `${at}A metric view is one number and must not group` };
  }
  if (presentation === "line") {
    if (!groupCol) return { ok: false, error: `${at}A line view requires a date groupBy` };
    if (groupCol.type !== "date" || v.timeBucket == null) {
      return {
        ok: false,
        error: `${at}A line view requires a date groupBy with a timeBucket (day, week, or month)`,
      };
    }
  }
  if (v.timeBucket != null && !(TIME_BUCKETS as readonly string[]).includes(v.timeBucket as string)) {
    return { ok: false, error: `${at}Unknown timeBucket: ${String(v.timeBucket)}` };
  }
  if (v.timeBucket != null && groupCol && groupCol.type !== "date") {
    return { ok: false, error: `${at}timeBucket applies only to a date groupBy` };
  }

  if (v.timeColumnId != null) {
    const timeCol = col(v.timeColumnId);
    if (!timeCol) {
      return { ok: false, error: `${at}View timeColumnId does not exist: ${String(v.timeColumnId)}` };
    }
    if (timeCol.type !== "date") {
      return { ok: false, error: `${at}View timeColumnId must be a date column: ${timeCol.name}` };
    }
  }
  if (!validWindow(v.timeWindow ?? "all")) {
    return { ok: false, error: `${at}View timeWindow is invalid` };
  }

  if (measure === "count") {
    if (v.measureColumnId != null) {
      return { ok: false, error: `${at}A count measure takes no measureColumnId` };
    }
  } else {
    const mCol = v.measureColumnId != null ? col(v.measureColumnId) : null;
    if (!mCol) {
      return { ok: false, error: `${at}A ${measure} measure needs an existing measureColumnId` };
    }
    if (mCol.type !== "number") {
      return { ok: false, error: `${at}Measure column ${mCol.name} must be a number column` };
    }
  }

  const filters = v.filters ?? [];
  if (!Array.isArray(filters)) {
    return { ok: false, error: `${at}View filters must be an array` };
  }
  for (const f of filters as Array<Record<string, unknown>>) {
    if (!f || typeof f !== "object") {
      return { ok: false, error: `${at}Each view filter must be an object` };
    }
    if (!col(f.columnId)) {
      return { ok: false, error: `${at}Filter column does not exist: ${String(f.columnId)}` };
    }
    if (!(FILTER_OPS as readonly string[]).includes(String(f.op))) {
      return { ok: false, error: `${at}Unknown filter op: ${String(f.op)}` };
    }
    if (f.op === "in") {
      if (!Array.isArray(f.value)) {
        return { ok: false, error: `${at}The in filter op requires an array value` };
      }
      if (f.value.length === 0) {
        return { ok: false, error: `${at}The in filter op requires a non-empty array` };
      }
    }
  }

  if (v.sort != null) {
    const s = v.sort as { by?: unknown; dir?: unknown };
    if (s.by !== "label" && s.by !== "value") {
      return { ok: false, error: `${at}View sort.by must be 'label' or 'value'` };
    }
    if (s.dir !== "asc" && s.dir !== "desc") {
      return { ok: false, error: `${at}View sort.dir must be 'asc' or 'desc'` };
    }
  }
  if (v.limit != null) {
    const limit = v.limit as unknown;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_VIEW_LIMIT) {
      return {
        ok: false,
        error: `${at}View limit must be an integer between 1 and ${MAX_VIEW_LIMIT}`,
      };
    }
  }
  if (v.convertToZar != null && typeof v.convertToZar !== "boolean") {
    return { ok: false, error: `${at}View convertToZar must be a boolean` };
  }

  return { ok: true, value: true };
}

/**
 * Monday-start weeks, anchored on today, bounded for sanity. Week one INCLUDES
 * today, so `{ weeks: 4 }` covers today's Monday back through the Monday four
 * weeks earlier minus a day — exactly the trailing window a weekly table asks
 * for, and it stays correct as today moves.
 */
function lastWeeksBounds(
  w: { weeks: number },
  today: string,
): { start: string; end: string } {
  const weeks = Math.min(260, Math.max(1, Math.floor(w.weeks)));
  const d = new Date(today + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7; // 1..7, Monday first
  d.setUTCDate(d.getUTCDate() - (dayNum - 1) - (weeks - 1) * 7);
  return { start: d.toISOString().slice(0, 10), end: today };
}

/**
 * Fill the query fields a proposal may omit, so every block's query is complete
 * and a stored file can never hold a half-specified panel.
 *
 * A block's own fields are the only source: omission falls back to the
 * single-view default, NOT to a sibling block. `resolveViewBlocks` is what
 * layers the view's root fields underneath a block, so this stays one rule.
 */
function fillBlockDefaults(block: ViewBlock): Omit<ViewBlock, "id" | "title" | "span"> {
  const measure = block.measure ?? "sum";
  return {
    presentation: block.presentation,
    measure,
    measureColumnId: measure === "count" ? null : (block.measureColumnId ?? null),
    groupBy: block.groupBy ?? null,
    timeBucket: block.timeBucket ?? null,
    timeColumnId: block.timeColumnId ?? null,
    timeWindow: block.timeWindow ?? "all",
    filters: block.filters ?? [],
    sort: block.sort ?? { by: "label", dir: "asc" },
    limit: block.limit ?? DEFAULT_VIEW_LIMIT,
    convertToZar: block.convertToZar ?? false,
  };
}

/** One complete block: ident, title, span, and a fully specified query. */
function completeBlock(block: ViewBlock, fallbackId: string): ViewBlock {
  const out: ViewBlock = {
    ...fillBlockDefaults(block),
    id: block.id || fallbackId,
    title: block.title || fallbackId,
  };
  if (block.span === 1 || block.span === 2) out.span = block.span;
  return out;
}

/**
 * A block read off the wire, keeping only the fields it actually names, so
 * "did the author name this?" is still answerable. Two readers depend on that
 * distinction, and each supplies what is missing its own way:
 * `resolveViewBlocks` layers the view's root fields underneath for DRAWING, and
 * `applyViewDefaults` does the same before WRITING the file, so what is stored
 * is already complete and a later reader never has to infer anything.
 *
 * A nullable field accepts an explicit `null` as a VALUE rather than as
 * "absent": `groupBy: null` is how a composed view asks for a metric panel, and
 * dropping it would make that panel inherit the root's groupBy and then fail
 * validation as "a metric view is one number and must not group".
 */
function asBlock(raw: Record<string, unknown>): ViewBlock {
  const out: Record<string, unknown> = {
    id: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.title === "string" ? raw.title : "",
  };
  for (const key of ["groupBy", "timeBucket", "timeColumnId", "measureColumnId"]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  // The rest carry only their own type; `null` is not a value a writer means.
  for (const key of [
    "presentation", "measure", "timeWindow", "filters", "sort", "limit", "convertToZar", "span",
  ]) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key];
  }
  return out as unknown as ViewBlock;
}

/**
 * A block that may be partial: anything it does not name is taken from `parent`
 * (the view's root query fields). The measure pair is the exception — it is
 * always the block's own, because a metric panel must not inherit the root's
 * measure column or it would fail its own "one number must not group" check.
 *
 * `parent` may itself be partial: a root built from a proposal has only the
 * fields the author wrote. `completeBlock` supplies the rest.
 */
function resolveBlock(parent: ViewBlock, raw: ViewBlock): ViewBlock {
  const layered: ViewBlock = { ...parent, ...raw, id: raw.id, title: raw.title } as ViewBlock;
  layered.measure = raw.measure ?? "sum";
  layered.measureColumnId = raw.measureColumnId ?? null;
  return layered;
}

/** Fill the fields a proposal may omit, so a stored file is always complete. */
export function applyViewDefaults(
  spec: Omit<ViewSpec, "schemaVersion">,
): Omit<ViewSpec, "schemaVersion"> {
  const written = spec as unknown as Record<string, unknown> & { blocks?: unknown[] };
  const blocks = Array.isArray(written.blocks) ? written.blocks : null;
  if (!blocks || blocks.length === 0) {
    const { blocks: _blocks, ...single } = written;
    void _blocks;
    return { ...single, ...fillBlockDefaults(asBlock(written)) } as Omit<ViewSpec, "schemaVersion">;
  }
  // A composed view's root query fields are the defaults its blocks inherit and
  // are never read directly. They are kept exactly as written so the composer's
  // form still round-trips; each block is then layered over them and made
  // complete, exactly as `resolveViewBlocks` does when it draws the card.
  const rootFields: Record<string, unknown> = { ...written };
  delete rootFields.blocks;
  const rootBlock = asBlock(written);
  return {
    ...rootFields,
    title: written.title,
    databaseId: written.databaseId,
    blocks: blocks.map((b, i) =>
      completeBlock(resolveBlock(rootBlock, asBlock(b as Record<string, unknown>)), `block-${i + 1}`),
    ),
  } as unknown as Omit<ViewSpec, "schemaVersion">;
}

/**
 * The blocks a spec actually draws: the whole of a composed view, or the single
 * implicit block of the original one-aggregate shape. Every reader uses this, so
 * the two shapes cannot be interpreted differently in two places.
 */
export function resolveViewBlocks(spec: ViewSpec): ViewBlockSpec[] {
  const root = asBlock(spec as unknown as Record<string, unknown>);
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  if (blocks.length === 0) {
    return [toBlockSpec(completeBlock(root, "block-1"), 0)];
  }
  return blocks.map((b, i) =>
    toBlockSpec(resolveBlock(root, asBlock(b as unknown as Record<string, unknown>)), i),
  );
}

/** A complete block as the runner consumes it: ident plus the full query. */
function toBlockSpec(block: ViewBlock, index: number): ViewBlockSpec {
  return {
    ...fillBlockDefaults(block),
    id: block.id || `block-${index + 1}`,
    title: block.title || `Block ${index + 1}`,
    ...(block.span === 1 || block.span === 2 ? { span: block.span } : {}),
  };
}

/** Window bounds as YYYY-MM-DD strings; null bounds mean "all time". */
export function windowBounds(
  w: ViewSpec["timeWindow"],
  today: string,
): { start: string | null; end: string | null } {
  if (typeof w === "object" && w.kind === "custom") return { start: w.start, end: w.end };
  if (typeof w === "object" && w.kind === "last-weeks") return lastWeeksBounds(w, today);
  switch (w) {
    case "this-month":
      return { start: today.slice(0, 8) + "01", end: today };
    case "this-year":
      return { start: today.slice(0, 4) + "-01-01", end: today };
    case "last-30-days": {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 29);
      return { start: d.toISOString().slice(0, 10), end: today };
    }
    default:
      return { start: null, end: null };
  }
}

/** ISO-8601 week label for a YYYY-MM-DD date, e.g. 2026-W09. */
export function isoWeekLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function labelForValue(value: unknown): string {
  if (value == null) return "(none)";
  if (typeof value === "string" && !value.trim()) return "(none)";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Read-only read: the database id, every filter, and the time window ride as
 * bound parameters, so no string ever concatenates into the SQL. A missing
 * relation cell matches no selective filter and drops out of the aggregate.
 */
export function buildReadSql(
  spec: ViewQuerySpec,
  timeColId: string | null,
  windowStart: string | null,
  windowEnd: string | null,
): { sql: string; params: unknown[] } {
  const conds: string[] = ["database_id = ?"];
  const params: unknown[] = [spec.databaseId];

  const opSql: Record<string, string> = {
    eq: "json_extract(cells, ?) = ?",
    neq: "json_extract(cells, ?) != ?",
    gt: "CAST(json_extract(cells, ?) AS REAL) > ?",
    gte: "CAST(json_extract(cells, ?) AS REAL) >= ?",
    lt: "CAST(json_extract(cells, ?) AS REAL) < ?",
    lte: "CAST(json_extract(cells, ?) AS REAL) <= ?",
  };
  for (const f of spec.filters) {
    if (f.op === "in") {
      const placeholders = (f.value as unknown[]).map(() => "?").join(",");
      conds.push(`json_extract(cells, ?) IN (${placeholders})`);
      params.push(`$.${f.columnId}`, ...(f.value as unknown[]));
    } else {
      // Comparisons CAST to REAL so a number filter compares number-wise even
      // though json_extract may return text; eq/neq keep JSON's own type rules.
      conds.push(opSql[f.op]);
      params.push(`$.${f.columnId}`, f.value);
    }
  }

  if (timeColId && windowStart) {
    conds.push("json_extract(cells, ?) >= ?");
    params.push(`$.${timeColId}`, windowStart);
  }
  if (timeColId && windowEnd) {
    conds.push("json_extract(cells, ?) <= ?");
    params.push(`$.${timeColId}`, windowEnd);
  }

  // Deterministic order, the listRows rule; the `last` measure depends on it.
  return {
    sql:
      "SELECT id, cells FROM rows WHERE " +
      conds.join(" AND ") +
      " ORDER BY created_at ASC, id ASC",
    params,
  };
}

function parseCells(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Relation groupBy: one pass over each relation target builds id -> label for
 * the whole run, instead of a row lookup per group.
 */
async function buildRelationLabels(
  root: string,
  slug: string,
  db: DatabaseMeta,
  registry: DomainDatabaseRegistry,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const targetIds = new Set(
    db.columns
      .filter((c) => c.type === "relation" && c.relationDatabaseId)
      .map((c) => c.relationDatabaseId as string),
  );
  if (targetIds.size === 0) return labels;

  const sqlitePath = vaultPaths(root).domainSqlite(slug);
  try {
    await fs.access(sqlitePath);
  } catch {
    return labels;
  }
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    for (const targetId of targetIds) {
      const target = registry.databases.find((d) => d.id === targetId);
      if (!target) continue;
      const rows = sqlite
        .prepare(
          "SELECT id, cells FROM rows WHERE database_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(targetId) as Array<{ id: string; cells: string }>;
      for (const r of rows) {
        const cells = parseCells(r.cells);
        if (!cells) continue;
        labels.set(`${targetId}::${r.id}`, rowDisplayLabel(target, cells) || r.id);
      }
    }
  } finally {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
  }
  return labels;
}

/** Map each referenced account row id to its `currency` cell, in one read. */
async function readAccountCurrenciesMap(
  root: string,
  slug: string,
  registry: DomainDatabaseRegistry,
  accountsDbId: string | undefined,
  accountRowIds: Set<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!accountsDbId || accountRowIds.size === 0) return out;
  const accountsDb = registry.databases.find((d) => d.id === accountsDbId);
  if (!accountsDb) return out;
  const currencyColId = accountsDb.columns.find((c) => c.name === "currency")?.id;
  if (!currencyColId) return out;

  const sqlitePath = vaultPaths(root).domainSqlite(slug);
  try {
    await fs.access(sqlitePath);
  } catch {
    return out;
  }
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    for (const acctId of accountRowIds) {
      const r = sqlite
        .prepare("SELECT cells FROM rows WHERE database_id = ? AND id = ?")
        .get(accountsDbId, acctId) as { cells: string } | undefined;
      if (!r) continue;
      const cells = parseCells(r.cells);
      const cur = cells ? cells[currencyColId] : undefined;
      if (typeof cur === "string" && cur) out.set(acctId, cur);
    }
  } finally {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
  }
  return out;
}

/**
 * Run one saved or proposed view. Reads only; writes nothing and logs nothing,
 * so a preview and the dashboard card agree.
 *
 * Every view runs as a list of blocks — a composed view's panels in order, or
 * the single implicit block of a one-aggregate view — so the card has exactly
 * one shape to draw and a panel cannot behave differently from a whole view.
 */
export async function runViewBlocks(
  root: string,
  slug: string,
  spec: ViewSpec,
  now: Date = new Date(),
): Promise<Result<ComposedViewRunResult>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const dbRes = await getDatabase(root, slug, spec.databaseId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;

    const blocks = resolveViewBlocks(spec);
    for (const block of blocks) {
      const check = validateBlock(
        { ...block, databaseId: spec.databaseId },
        db,
        blocks.length > 1 ? `Block ${block.id}` : "",
      );
      if (!check.ok) return check;
      if (block.timeColumnId == null && isWindowed(block.timeWindow)) {
        return {
          ok: false,
          error: `${blocks.length > 1 ? `Block ${block.id}: ` : ""}A timeWindow needs a timeColumnId, or the window silently does nothing. Set timeColumnId to the date column the window acts on, or set timeWindow to "all".`,
        };
      }
    }

    // One registry read, one relation-label pass, one sqlite path for every
    // block: a composed view must not re-read the domain once per panel.
    const registry = await readRegistry(vaultPaths(root).domainRegistry(slug));
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    const relationLabels = await buildRelationLabels(root, slug, db, registry);
    const today = todayLocalIso(now);

    const results: ComposedViewRunResult["blocks"] = [];
    const warnings: string[] = [];
    for (const block of blocks) {
      let result: Result<ViewRunResult>;
      try {
        result = await runBlock(
          root, slug, db, registry, sqlitePath, relationLabels,
          { ...block, databaseId: spec.databaseId }, today,
        );
      } catch (e) {
        // One panel's fault must not blank the whole card: the failure is
        // reported as that block's own warning and the other panels still draw.
        const message = e instanceof Error ? e.message : String(e);
        result = {
          ok: true,
          value: { columns: ["label", "value"], rows: [], warnings: [message], currency: null },
        };
      }
      if (!result.ok) return result;
      results.push({
        id: block.id,
        title: block.title,
        presentation: block.presentation,
        ...(block.span === 1 || block.span === 2 ? { span: block.span } : {}),
        result: result.value,
      });
      for (const warning of result.value.warnings) {
        warnings.push(blocks.length > 1 ? `${block.title}: ${warning}` : warning);
      }
    }

    return { ok: true, value: { title: spec.title, blocks: results, warnings } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** True for any window that actually narrows the read. */
function isWindowed(w: ViewSpec["timeWindow"]): boolean {
  if (w == null) return false;
  if (typeof w === "string") return w !== "all";
  return true;
}

/**
 * The single-aggregate result, for a caller that has no use for blocks (the
 * first block, or a failure when a composed view is asked for one number).
 */
export async function runView(
  root: string,
  slug: string,
  spec: ViewSpec,
  now: Date = new Date(),
): Promise<Result<ViewRunResult>> {
  const blocks = await runViewBlocks(root, slug, spec, now);
  if (!blocks.ok) return blocks;
  const only = blocks.value.blocks[0];
  if (!only) return { ok: false, error: "The view produced no blocks" };
  return { ok: true, value: { ...only.result, warnings: blocks.value.warnings } };
}

/**
 * One block of a view, already resolved and validated. Reads only.
 *
 * This is the whole of the aggregation: the SQL is one parameterized SELECT,
 * and every label, currency, and warning rule lives in the single fold below.
 */
async function runBlock(
  root: string,
  slug: string,
  db: DatabaseMeta,
  registry: DomainDatabaseRegistry,
  sqlitePath: string,
  relationLabels: Map<string, string>,
  spec: ViewBlockSpec & ViewQuerySpec,
  today: string,
): Promise<Result<ViewRunResult>> {
  // Past validation, so a throw here is a genuine fault (an unreadable sqlite
  // file, a malformed cell blob). It is caught at the call site and reported
  // as the block's failure rather than taking the whole card down.
  const warnings: string[] = [];

  const timeColId = spec.timeColumnId ?? null;
  const { start, end } = windowBounds(spec.timeWindow, today);

  let rawRows: Array<{ id: string; cells: string }> = [];
  let sqliteMissing = false;
  try {
    await fs.access(sqlitePath);
  } catch {
    sqliteMissing = true;
  }
  if (sqliteMissing) {
    warnings.push("No database for this domain yet.");
  } else {
    const { sql, params } = buildReadSql(spec, timeColId, start, end);
    const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      rawRows = sqlite.prepare(sql).all(...params) as Array<{ id: string; cells: string }>;
    } finally {
      try {
        sqlite.close();
      } catch {
        // already closed
      }
    }
  }

  const groupCol = spec.groupBy
  ? (db.columns.find((c) => c.id === spec.groupBy) as DatabaseColumn | undefined)
  : undefined;
  const measureCol = spec.measureColumnId
  ? (db.columns.find((c) => c.id === spec.measureColumnId) as DatabaseColumn | undefined)
  : undefined;

  // Finance amount path: resolve account currencies once, before the
  // aggregation loop, so the loop stays a single pass.
  const isFinanceAmount =
  slug === "financial" &&
  spec.databaseId === FINANCE_DB_IDS.transactions &&
  measureCol?.name === "amount";
  const accountColId = isFinanceAmount
  ? (db.columns.find((c) => c.name === "account")?.id ?? "")
  : "";
  const accountsDbId = isFinanceAmount
  ? (db.columns.find((c) => c.id === accountColId)?.relationDatabaseId as string | undefined)
  : undefined;
  const accountRowIds = new Set<string>();
  if (isFinanceAmount && accountColId) {
    for (const raw of rawRows) {
      const cells = parseCells(raw.cells);
      const v = cells ? cells[accountColId] : undefined;
      if (typeof v === "string" && v) accountRowIds.add(v);
    }
  }
  const accountCurrency = isFinanceAmount
  ? await readAccountCurrenciesMap(root, slug, registry, accountsDbId, accountRowIds)
  : new Map<string, string>();
  const usdZarRate = registry.finance?.usdZarRate ?? null;
  if (isFinanceAmount && usdZarRate == null) {
    warnings.push("usdZarRate is unset; USD amounts cannot convert to ZAR.");
  }

  // Aggregate in TS: every rule the design pins as a warning lives here, one
  // loop, no silent bucket. Conversion happens per row at aggregation time,
  // so a group sum is already in home currency when conversion applies.
  const groups = new Map<string, { label: string; value: number }>();
  let undatedCount = 0;
  const seenCurrencies = new Set<string>();

  for (const raw of rawRows) {
    const cells = parseCells(raw.cells);
    if (!cells) continue;

    let value: number | null = null;
    let rowCurrency: string | null = null;
    if (spec.measure === "count") {
      value = 1;
    } else {
      const mv = cells[measureCol!.id];
      if (typeof mv !== "number" || !Number.isFinite(mv)) continue;
      if (isFinanceAmount && accountColId) {
        const acctId = cells[accountColId];
        rowCurrency =
        typeof acctId === "string" ? (accountCurrency.get(acctId) ?? null) : null;
        if (rowCurrency === "USD" && usdZarRate != null) {
          value = mv * usdZarRate;
          rowCurrency = "ZAR";
        } else {
          value = mv;
        }
        if (rowCurrency) seenCurrencies.add(rowCurrency);
      } else {
        value = mv;
      }
    }

    let label: string;
    if (!groupCol) {
      label = "value";
    } else {
      const gval = cells[groupCol.id];
      if (groupCol.type === "relation") {
        const rid = typeof gval === "string" && gval ? gval : null;
        label = rid
        ? (relationLabels.get(`${groupCol.relationDatabaseId}::${rid}`) ?? rid)
        : "(none)";
      } else if (groupCol.type === "date") {
        if (!isDateString(gval)) {
          // An unparseable date is a visible group plus a counted warning,
          // never a silent extra bucket.
          undatedCount += 1;
          label = "Undated";
        } else if (spec.timeBucket === "month") {
          label = gval.slice(0, 7);
        } else if (spec.timeBucket === "week") {
          label = isoWeekLabel(gval);
        } else {
          label = gval;
        }
      } else {
        label = labelForValue(gval);
      }
    }

    const existing = groups.get(label);
    if (spec.measure === "last") {
      // rows arrive oldest-first, so plain assignment leaves the newest row.
      groups.set(label, { label, value });
    } else if (spec.measure === "avg") {
      if (existing) {
        existing.value += value;
        (existing as { count?: number }).count = ((existing as { count?: number }).count ?? 1) + 1;
      } else {
        groups.set(label, { label, value, count: 1 } as { label: string; value: number; count: number });
      }
    } else if (existing) {
      existing.value += value;
    } else {
      groups.set(label, { label, value });
    }
  }
  // avg divides after the fold: sum/count per label. An empty group cannot
  // happen (count starts at 1), so no zero-division guard is needed here.
  if (spec.measure === "avg") {
    for (const g of groups.values()) {
      const count = (g as { count?: number }).count ?? 1;
      g.value = g.value / count;
    }
  }

  // seenCurrencies is post-conversion: a converted USD row counts as ZAR, so
  // a surviving USD entry is one the rate could not reach — no rate set, or
  // the operator did not ask to convert. Either way the card says "mixed".
  let currency: ViewRunResult["currency"] = null;
  if (isFinanceAmount) {
    if (seenCurrencies.size === 1 && seenCurrencies.has("ZAR")) {
      currency = "ZAR";
    } else if (seenCurrencies.has("USD") && seenCurrencies.has("ZAR")) {
      currency = "mixed";
      warnings.push("Rows span more than one currency; series kept separate.");
    } else if (seenCurrencies.has("USD")) {
      currency = "mixed";
      warnings.push("USD amounts could not convert to ZAR; shown as-is.");
    }
  }

  if (undatedCount > 0) {
    warnings.push(
    `${undatedCount} row${undatedCount === 1 ? " has" : "s have"} an unparseable ${groupCol?.name ?? "date"}; grouped under "Undated".`,
  );
  }

  const sort = spec.sort ?? { by: "label", dir: "asc" };
  const entries = [...groups.values()].sort((a, b) => {
    // Secondary label tiebreak: equal values land in a stable, named order.
    const cmp =
      sort.by === "label"
        ? a.label.localeCompare(b.label)
        : a.value - b.value || a.label.localeCompare(b.label);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const limit = spec.limit ?? DEFAULT_VIEW_LIMIT;
  if (entries.length > limit) {
    warnings.push(`Showing ${limit} of ${entries.length} groups.`);
  }
  const shown = entries.slice(0, limit);

  return {
    ok: true,
    value: {
      columns: ["label", "value"],
      rows: shown.map((e) => [e.label, e.value]),
      warnings,
      currency,
    },
  };
}

// ---------------------------------------------------------------------------
// View files: domains/{slug}/views/{id}.json
// ---------------------------------------------------------------------------

export type SavedView = ViewSpec & { id: string; createdAt: string; updatedAt: string };

export async function saveView(
  root: string,
  slug: string,
  spec: Omit<ViewSpec, "schemaVersion">,
  opts?: { id?: string },
): Promise<Result<SavedView>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const dbRes = await getDatabase(root, slug, spec.databaseId);
    if (!dbRes.ok) return dbRes;

    if (opts?.id && !VIEW_ID_PATTERN.test(opts.id)) {
      return { ok: false, error: `Invalid view id: ${opts.id}` };
    }

    const out = applyViewDefaults(spec);
    const check = validateViewSpec(out, dbRes.value);
    if (!check.ok) return check;

    const now = new Date().toISOString();
    const existing = opts?.id ? await getView(root, slug, opts.id) : null;
    const id = existing?.ok ? existing.value.id : (opts?.id ?? randomUUID());

    const view: SavedView = {
      ...(out as ViewSpec),
      id,
      createdAt: existing?.ok ? existing.value.createdAt : now,
      updatedAt: now,
    };
    await atomicWriteFile(
      vaultPaths(root).domainView(slug, id),
      `${JSON.stringify(view, null, 2)}\n`,
    );

    const updated = existing?.ok === true;
    await appendLog(root, {
      domainSlug: slug,
      type: updated ? "view.updated" : "view.created",
      summary: `${updated ? "Updated" : "Created"} view "${view.title}" in ${slug}`,
      payload: { viewId: id, presentation: view.presentation, databaseId: view.databaseId },
    });

    return { ok: true, value: view };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listViews(
  root: string,
  slug: string,
): Promise<Result<SavedView[]>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const dir = vaultPaths(root).domainViewsDir(slug);
    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return { ok: true, value: [] }; // no views dir yet is an empty list
    }
    const views: SavedView[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(
          await fs.readFile(`${dir}/${name}`, "utf8"),
        ) as SavedView;
        if (parsed && typeof parsed === "object" && parsed.id && parsed.title) {
          views.push(parsed);
        }
      } catch {
        // unreadable file is skipped, same rule as the registry read
      }
    }
    return { ok: true, value: views };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getView(
  root: string,
  slug: string,
  id: string,
): Promise<Result<SavedView>> {
  if (!VIEW_ID_PATTERN.test(id)) {
    return { ok: false, error: `Invalid view id: ${id}` };
  }
  try {
    const raw = await fs.readFile(vaultPaths(root).domainView(slug, id), "utf8");
    const parsed = JSON.parse(raw) as SavedView;
    if (!parsed || typeof parsed !== "object" || !parsed.id || !parsed.title) {
      return { ok: false, error: `Unreadable view file: ${id}` };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: `View not found: ${id}` };
  }
}

/**
 * Run a saved view by id; validation runs against the file contents.
 *
 * The saved title is carried into the run so a card never has to read the view
 * file twice to title itself.
 */
export async function runSavedView(
  root: string,
  slug: string,
  id: string,
  now: Date = new Date(),
): Promise<Result<ComposedViewRunResult>> {
  const viewRes = await getView(root, slug, id);
  if (!viewRes.ok) return viewRes;
  const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = viewRes.value;
  return runViewBlocks(root, slug, spec as ViewSpec, now);
}

export async function deleteView(
  root: string,
  slug: string,
  id: string,
): Promise<Result<{ id: string }>> {
  if (!VIEW_ID_PATTERN.test(id)) {
    return { ok: false, error: `Invalid view id: ${id}` };
  }
  try {
    await fs.rm(vaultPaths(root).domainView(slug, id), { force: false });
  } catch {
    return { ok: false, error: `View not found: ${id}` };
  }
  await appendLog(root, {
    domainSlug: slug,
    type: "view.deleted",
    summary: `Deleted view ${id} in ${slug}`,
    payload: { viewId: id },
  });
  return { ok: true, value: { id } };
}

/**
 * Slice 3: propose_view files exactly one Decision carrying the full spec plus
 * the preview rows, so the operator approves what they can see. Nothing is
 * saved at propose time; Approval applies the spec through saveView as the
 * user actor (decisions.ts applyViewDecision).
 */
export async function fileViewDecision(
  root: string,
  actor: Actor,
  slug: string,
  spec: ViewSpec,
  preview: unknown,
): Promise<Result<{ viewId: string; decisionId: string }>> {
  const { createDecision } = await import("./decisions.ts");
  const title = typeof spec.title === "string" && spec.title.trim() ? spec.title : "Saved view";
  const body = {
    op: "save-view" as const,
    domainSlug: slug,
    spec,
    preview,
  };
  const created = await createDecision(root, {
    target: { type: "view", domainSlug: slug, viewId: "" },
    proposedTitle: title,
    proposedBodyMarkdown: JSON.stringify(body, null, 2),
    actor,
  });
  if (!created.ok) return created;
  return { ok: true, value: { viewId: spec.databaseId, decisionId: created.value.id } };
}
