import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { isDomainLive, getDatabase, rowDisplayLabel, readRegistry } from "./domain-databases.ts";
import {
  FINANCE_DB_IDS,
  type Actor,
  type DatabaseMeta,
  type DatabaseColumn,
  type DomainDatabaseRegistry,
  type Result,
  type ViewPresentation,
  type ViewSpec,
  type ViewRunResult,
} from "./types.ts";

/**
 * Agent-built dashboard views (plan.md design, 2026-09-30). Slice 1: the view
 * file, the validator, and runView. The SQL here stays a parameterized read —
 * filters and the time window ride as bound parameters on json_extract; every
 * aggregation, relation label, and currency rule happens in TS where the
 * warnings live. A preview and a dashboard refresh hit this exact same path.
 */

export const VIEW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const PRESENTATIONS: readonly ViewPresentation[] = ["table", "bar", "line", "metric"];
export const TIME_WINDOWS = ["all", "this-month", "last-30-days", "this-year"] as const;
export const TIME_BUCKETS = ["day", "week", "month"] as const;
export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export const MEASURES = ["sum", "count", "last"] as const;

const DEFAULT_VIEW_LIMIT = 12;
const MAX_VIEW_LIMIT = 50;

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
  const o = w as { kind?: unknown; start?: unknown; end?: unknown };
  return o.kind === "custom" && isDateString(o.start) && isDateString(o.end);
}

/**
 * Validate a view spec against the database's column registry. Shape rules:
 * table and bar aggregate into label/value, so they need a groupBy; a metric
 * is one number and must not group; a line needs a date groupBy collapsed by a
 * timeBucket so its x-axis is time. Every failure names the offending field.
 */
export function validateViewSpec(spec: unknown, db: DatabaseMeta): Result<true> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { ok: false, error: "View spec must be an object" };
  }
  const v = spec as RawSpec;
  if (!v.title || typeof v.title !== "string" || !v.title.trim()) {
    return { ok: false, error: "View title is required" };
  }
  const presentation = v.presentation as ViewPresentation;
  if (!(PRESENTATIONS as readonly string[]).includes(presentation)) {
    return { ok: false, error: `Unknown view presentation: ${String(v.presentation)}` };
  }
  const measure = (v.measure ?? "sum") as string;
  if (!(MEASURES as readonly string[]).includes(measure)) {
    return { ok: false, error: `Unknown view measure: ${String(v.measure)}` };
  }

  const colById = new Map(db.columns.map((c) => [c.id, c]));
  const col = (id: unknown): DatabaseColumn | null =>
    typeof id === "string" && colById.has(id) ? (colById.get(id) as DatabaseColumn) : null;

  const groupCol = v.groupBy != null ? col(v.groupBy) : null;
  if (v.groupBy != null && !groupCol) {
    return { ok: false, error: `View groupBy column does not exist: ${String(v.groupBy)}` };
  }

  if ((presentation === "table" || presentation === "bar") && !groupCol) {
    return { ok: false, error: `A ${presentation} view requires a groupBy column` };
  }
  if (presentation === "metric" && groupCol) {
    return { ok: false, error: "A metric view is one number and must not group" };
  }
  if (presentation === "line") {
    if (!groupCol) return { ok: false, error: "A line view requires a date groupBy" };
    if (groupCol.type !== "date" || v.timeBucket == null) {
      return {
        ok: false,
        error:
          "A line view requires a date groupBy with a timeBucket (day, week, or month)",
      };
    }
  }
  if (v.timeBucket != null && !(TIME_BUCKETS as readonly string[]).includes(v.timeBucket as string)) {
    return { ok: false, error: `Unknown timeBucket: ${String(v.timeBucket)}` };
  }
  if (v.timeBucket != null && groupCol && groupCol.type !== "date") {
    return { ok: false, error: "timeBucket applies only to a date groupBy" };
  }

  if (v.timeColumnId != null) {
    const timeCol = col(v.timeColumnId);
    if (!timeCol) {
      return { ok: false, error: `View timeColumnId does not exist: ${String(v.timeColumnId)}` };
    }
    if (timeCol.type !== "date") {
      return { ok: false, error: `View timeColumnId must be a date column: ${timeCol.name}` };
    }
  }
  if (!validWindow(v.timeWindow ?? "all")) {
    return { ok: false, error: "View timeWindow is invalid" };
  }

  if (measure === "count") {
    if (v.measureColumnId != null) {
      return { ok: false, error: "A count measure takes no measureColumnId" };
    }
  } else {
    const mCol = v.measureColumnId != null ? col(v.measureColumnId) : null;
    if (!mCol) {
      return { ok: false, error: `A ${measure} measure needs an existing measureColumnId` };
    }
    if (mCol.type !== "number") {
      return { ok: false, error: `Measure column ${mCol.name} must be a number column` };
    }
  }

  const filters = v.filters ?? [];
  if (!Array.isArray(filters)) {
    return { ok: false, error: "View filters must be an array" };
  }
  for (const f of filters as Array<Record<string, unknown>>) {
    if (!f || typeof f !== "object") {
      return { ok: false, error: "Each view filter must be an object" };
    }
    if (!col(f.columnId)) {
      return { ok: false, error: `Filter column does not exist: ${String(f.columnId)}` };
    }
    if (!(FILTER_OPS as readonly string[]).includes(String(f.op))) {
      return { ok: false, error: `Unknown filter op: ${String(f.op)}` };
    }
    if (f.op === "in") {
      if (!Array.isArray(f.value)) {
        return { ok: false, error: "The in filter op requires an array value" };
      }
      if (f.value.length === 0) {
        return { ok: false, error: "The in filter op requires a non-empty array" };
      }
    }
  }

  if (v.sort != null) {
    const s = v.sort as { by?: unknown; dir?: unknown };
    if (s.by !== "label" && s.by !== "value") {
      return { ok: false, error: "View sort.by must be 'label' or 'value'" };
    }
    if (s.dir !== "asc" && s.dir !== "desc") {
      return { ok: false, error: "View sort.dir must be 'asc' or 'desc'" };
    }
  }
  if (v.limit != null) {
    const limit = v.limit as unknown;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_VIEW_LIMIT) {
      return {
        ok: false,
        error: `View limit must be an integer between 1 and ${MAX_VIEW_LIMIT}`,
      };
    }
  }
  if (v.convertToZar != null && typeof v.convertToZar !== "boolean") {
    return { ok: false, error: "View convertToZar must be a boolean" };
  }

  return { ok: true, value: true };
}

/** Fill the fields a proposal may omit, so a stored file is always complete. */
export function applyViewDefaults(
  spec: Omit<ViewSpec, "schemaVersion">,
): Omit<ViewSpec, "schemaVersion"> {
  const measure = spec.measure ?? "sum";
  return {
    ...spec,
    measure,
    measureColumnId: measure === "count" ? null : (spec.measureColumnId ?? null),
    groupBy: spec.groupBy ?? null,
    timeBucket: spec.timeBucket ?? null,
    timeColumnId: spec.timeColumnId ?? null,
    timeWindow: spec.timeWindow ?? "all",
    filters: spec.filters ?? [],
    sort: spec.sort ?? { by: "label", dir: "asc" },
    limit: spec.limit ?? DEFAULT_VIEW_LIMIT,
    convertToZar: spec.convertToZar ?? false,
  };
}

/** Window bounds as YYYY-MM-DD strings; null bounds mean "all time". */
export function windowBounds(
  w: ViewSpec["timeWindow"],
  today: string,
): { start: string | null; end: string | null } {
  if (typeof w === "object") return { start: w.start, end: w.end };
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
  spec: ViewSpec,
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
 * Run one validated view against its domain's sqlite. Reads only; writes
 * nothing and logs nothing, so a preview and the dashboard card agree.
 */
export async function runView(
  root: string,
  slug: string,
  spec: ViewSpec,
): Promise<Result<ViewRunResult>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const dbRes = await getDatabase(root, slug, spec.databaseId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;
    const check = validateViewSpec(spec, db);
    if (!check.ok) return check;

    const registry = await readRegistry(vaultPaths(root).domainRegistry(slug));
    const warnings: string[] = [];

    const timeColId = spec.timeColumnId ?? null;
    const today = new Date().toISOString().slice(0, 10);
    const { start, end } = windowBounds(spec.timeWindow, today);

    const sqlitePath = vaultPaths(root).domainSqlite(slug);
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

    const relationLabels = await buildRelationLabels(root, slug, db, registry);
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
      } else if (existing) {
        existing.value += value;
      } else {
        groups.set(label, { label, value });
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
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

/** Run a saved view by id; validation runs against the file contents. */
export async function runSavedView(
  root: string,
  slug: string,
  id: string,
): Promise<Result<ViewRunResult>> {
  const viewRes = await getView(root, slug, id);
  if (!viewRes.ok) return viewRes;
  const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = viewRes.value;
  return runView(root, slug, spec as ViewSpec);
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
