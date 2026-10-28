import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { mondayOnOrBefore, todayLocalIso } from "./map/dates.ts";
import { isoWeekOf } from "./period.ts";
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
  type ViewListCell,
  type ViewMeasure,
  type ViewPalette,
  type ViewPeriod,
  type ViewPresentation,
  type ViewQuerySpec,
  type ViewSpec,
  type ViewRunResult,
} from "./types.ts";
import { toSqlBindable, type SqlBindable } from "./sql-bind.ts";

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

export const PRESENTATIONS: readonly ViewPresentation[] = ["table", "bar", "line", "metric", "list"];
/**
 * The windows a card can read, in the order the vocabulary teaches them.
 *
 * `today` and `this-week` are here because their absence was a measured failure.
 * Every other window is anchored on a period the OPERATOR names; a card asking
 * for today's spending or this week's totals had no way to say so, and an agent
 * asked for one therefore wrote the date it happened to be looking at into a
 * `filters` entry — producing a card that recomputes correctly and can never
 * change, which is exactly how "the Today's Expense value hasn't changed in
 * days" was reported. A window that moves with the clock is the fix; a literal
 * date is still legal, because "the trip on 2026-10-10" is a real question.
 */
export const TIME_WINDOWS = [
  "all",
  "today",
  "this-week",
  "this-month",
  "last-30-days",
  "this-year",
] as const;
export const TIME_BUCKETS = ["day", "week", "month"] as const;
export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export const MEASURES: readonly ViewMeasure[] = ["sum", "count", "last", "avg", "avg-per"];
/**
 * The periods an `avg-per` measure can divide a window by. One vocabulary with
 * `timeBucket` on purpose: "per week" and a week bucket mean the same week.
 */
export const PERIODS: readonly ViewPeriod[] = ["day", "week", "month"];

const DEFAULT_VIEW_LIMIT = 12;
const MAX_VIEW_LIMIT = 50;
/** Ten years of months is already more history than a vault holds. */
const MAX_WINDOW_MONTHS = 120;
/** A composed view is a card, not a report: eight panels is already a lot. */
export const MAX_VIEW_BLOCKS = 8;
/**
 * A listing is one line per row on a card, not a spreadsheet: past this many
 * columns there is no room left for the values themselves.
 */
export const MAX_LIST_COLUMNS = 6;
/**
 * How many series a chart or table will draw before the tail is pooled into
 * "Other". A card has room for a handful of coloured lines; a category column
 * with forty values is a table problem, not a chart problem, and drawing forty
 * hairlines is not a more informative picture than five and an "Other".
 */
export const MAX_VIEW_SERIES = 6;
/** The palettes a card may name; `VIEW_PALETTES` in types.ts is the one list. */
export const VIEW_PALETTE_NAMES = ["accent", "warm", "cool", "mono"] as const;

/** The ways an object can be drawn, split by what its dataset is. */
export const ROW_PRESENTATIONS: readonly ViewPresentation[] = ["list", "table"];
export const AGGREGATE_PRESENTATIONS: readonly ViewPresentation[] = ["metric", "table", "bar", "line"];

type RawSpec = {
  title?: unknown;
  presentation?: unknown;
  measure?: unknown;
  measureColumnId?: unknown;
  per?: unknown;
  groupBy?: unknown;
  timeBucket?: unknown;
  timeColumnId?: unknown;
  timeWindow?: unknown;
  filters?: unknown;
  sort?: unknown;
  limit?: unknown;
  convertToZar?: unknown;
  columns?: unknown;
  databaseId?: unknown;
  from?: unknown;
  seriesBy?: unknown;
  display?: unknown;
};

function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function validWindow(w: unknown): boolean {
  if (w == null) return true;
  if (typeof w === "string") return (TIME_WINDOWS as readonly string[]).includes(w);
  if (typeof w !== "object") return false;
  const o = w as { kind?: unknown; start?: unknown; end?: unknown; weeks?: unknown; months?: unknown };
  if (o.kind === "last-weeks") {
    return typeof o.weeks === "number" && Number.isFinite(o.weeks) && o.weeks >= 1 && o.weeks <= 260;
  }
  if (o.kind === "last-months" || o.kind === "previous-months") {
    return (
      typeof o.months === "number" &&
      Number.isFinite(o.months) &&
      o.months >= 1 &&
      o.months <= MAX_WINDOW_MONTHS
    );
  }
  return o.kind === "custom" && isDateString(o.start) && isDateString(o.end);
}

/** How a spec's block finds the database it names, when that is not the card's. */
export type ViewDatabaseLookup = (databaseId: string) => DatabaseMeta | null;

/**
 * Whether an object prints ROWS rather than folding them.
 *
 * The presence of `columns` is the signal, not the presentation. A listing and a
 * raw table are the same dataset drawn two ways, so switching between them is a
 * display change; a card that had to rewrite its query to move between them is
 * the bug this rule removes.
 */
export function isRowObject(block: ViewBlock): boolean {
  return (
    !block.from &&
    ((Array.isArray(block.columns) && block.columns.length > 0) || block.presentation === "list")
  );
}

/**
 * Validate a view spec against the database's column registry.
 *
 * Since cards can hold objects from more than one database, a block that names
 * its own `databaseId` is validated against THAT database. `lookup` is what
 * supplies it; a caller that only knows the card's database passes neither, and
 * a block naming another database is then refused by name rather than checked
 * against the wrong columns.
 *
 * The shape rules are about the DATA, not the drawing. `presentation` names how
 * the object is drawn, and every aggregate's dataset can be drawn four ways, so
 * a table does not need a groupBy and a metric may have one. What is refused is
 * a spec that means two different things at once: a row object with a groupBy, a
 * derived object with a window, a series split on a measure that cannot sum.
 */
export function validateViewSpec(
  spec: unknown,
  db: DatabaseMeta,
  lookup?: ViewDatabaseLookup,
): Result<true> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { ok: false, error: "View spec must be an object" };
  }
  const v = spec as RawSpec & { blocks?: unknown; databaseId?: unknown };
  if (!v.title || typeof v.title !== "string" || !v.title.trim()) {
    return { ok: false, error: "View title is required" };
  }
  const databaseId = typeof v.databaseId === "string" ? v.databaseId : "";
  const rootBlock = asBlock(v as unknown as Record<string, unknown>);
  rootBlock.databaseId = databaseId;
  /** Earlier objects, by id → whether that object prints rows (a derived object cannot). */
  const prior = new Map<string, boolean>();

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
      const resolved = resolveBlock(rootBlock, {
        ...asBlock(b as unknown as Record<string, unknown>),
        id: b.id,
        title: b.title,
      });
      const block = toBlockSpec(resolved, i);
      const wants = resolved.databaseId ?? databaseId;
      const blockDb =
        wants === db.id
          ? db
          : (lookup?.(wants) ?? null);
      if (!blockDb) {
        return {
          ok: false,
          error:
            `Block ${b.id}: database not found: ${wants || "(none)"}. Omit databaseId to use the ` +
            "card's own database, or name a database that exists in this domain.",
        };
      }
      const blockCheck = validateBlock(
        { ...block, databaseId: blockDb.id },
        blockDb,
        `Block ${b.id}`,
        prior,
      );
      if (!blockCheck.ok) return blockCheck;
      prior.set(b.id, isRowObject(resolved));
    }
    return { ok: true, value: true };
  }
  return validateBlock(
    { ...toBlockSpec(completeBlock(rootBlock, "block-1"), 0), databaseId },
    db,
    "",
    prior,
  );
}

/**
 * Validate a spec whose objects may read several databases.
 *
 * The validator is synchronous and takes a lookup for exactly this reason: the
 * caller that writes a card can afford to read the databases it names, while a
 * reader that already has them can pass a map. Reading them here, once, is what
 * lets `save_view` refuse a card that names a database it cannot draw.
 */
export async function validateViewSpecForVault(
  root: string,
  slug: string,
  spec: ViewSpec,
  rootDb: DatabaseMeta,
): Promise<Result<true>> {
  const wanted = new Set<string>([rootDb.id]);
  for (const block of resolveViewBlocks(spec)) {
    if (block.from) continue;
    wanted.add(block.databaseId ?? rootDb.id);
  }
  const found = new Map<string, DatabaseMeta>([[rootDb.id, rootDb]]);
  for (const id of wanted) {
    if (found.has(id)) continue;
    const read = await getDatabase(root, slug, id);
    if (!read.ok) {
      return {
        ok: false,
        error: `Database not found: ${id}. ${read.error}`,
      };
    }
    found.set(id, read.value);
  }
  return validateViewSpec(spec, rootDb, (id) => found.get(id) ?? null);
}

/** One block's own shape rules, with `where` naming it in every failure. */
function validateBlock(
  block: ViewBlockSpec & { databaseId: string },
  db: DatabaseMeta,
  where: string,
  prior: Map<string, boolean>,
): Result<true> {
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

  if (v.from != null && typeof v.from !== "string") {
    return { ok: false, error: `${at}from must be the id of an earlier object` };
  }
  const fromId = typeof v.from === "string" && v.from.trim() ? v.from.trim() : null;
  const isDerived = fromId !== null;
  const isRow = !isDerived && isRowObject(block as never);

  // ── a derived object: another object's rows, folded again ────────────────
  //
  // "The average of these monthly totals" is a fold over an object, not over a
  // column, and it must name an EARLIER object so the card can run in one pass
  // and cannot hold a cycle.
  if (isDerived) {
    if (!prior.has(fromId)) {
      return {
        ok: false,
        error:
          `${at}from must name an EARLIER object in this card. "${fromId}" is not one — ` +
          "an object can only build on one that comes before it.",
      };
    }
    if (prior.get(fromId) === true) {
      return {
        ok: false,
        error:
          `${at}"${fromId}" prints rows, so there is no label/value fold to build on. Point ` +
          "from at an aggregate object (one with a groupBy or a measure, not `columns`).",
      };
    }
    if (!(AGGREGATE_PRESENTATIONS as readonly string[]).includes(presentation)) {
      return {
        ok: false,
        error: `${at}A derived object is an aggregate: presentation must be metric, table, bar or line.`,
      };
    }
    if (v.groupBy != null || v.timeBucket != null || v.timeColumnId != null) {
      return {
        ok: false,
        error:
          `${at}A derived object folds "${fromId}" and cannot group or window again: drop ` +
          "groupBy, timeBucket and timeColumnId. The source object already chose them.",
      };
    }
    if ((Array.isArray(v.filters) && v.filters.length > 0) || (v.timeWindow != null && v.timeWindow !== "all")) {
      return {
        ok: false,
        error:
          `${at}A derived object has no rows of its own to filter or window: put filters and ` +
          `timeWindow on "${fromId}" instead.`,
      };
    }
    if (v.seriesBy != null) {
      return {
        ok: false,
        error: `${at}A derived object inherits its source's series; drop seriesBy.`,
      };
    }
    if (measure === "avg-per") {
      return {
        ok: false,
        error:
          `${at}avg-per divides a WINDOW's total by its periods, and a derived object has no ` +
          "window of its own. Use measure 'avg' for the average of the source's rows.",
      };
    }
    if (v.measureColumnId != null) {
      return {
        ok: false,
        error:
          `${at}A derived object measures the source's VALUES, so it takes no measureColumnId. ` +
          "Name the column on the source object.",
      };
    }
    const displayCheck = validateDisplay(v.display);
    if (!displayCheck.ok) return { ok: false, error: `${at}${displayCheck.error}` };
    return { ok: true, value: true };
  }

  const groupCol = v.groupBy != null ? col(v.groupBy) : null;
  if (v.groupBy != null && !groupCol) {
    return { ok: false, error: `${at}View groupBy column does not exist: ${String(v.groupBy)}` };
  }

  // The period average, and the three things it has to be told. Each refusal
  // names the shape that would pass rather than the rule alone, because this is
  // the measure an agent reaches for when an operator asks for "the average
  // spend per month" and the one it will otherwise get wrong by writing `avg`.
  if (!isRow && measure === "avg-per") {
    if (presentation !== "metric") {
      return {
        ok: false,
        error:
          `${at}An 'avg-per' measure is a metric: one number for the whole window, the total ` +
          'divided by the periods that window spans. Set presentation: "metric". For a table ' +
          "OF periods use measure 'sum' with a date groupBy and a timeBucket.",
      };
    }
    if (!(PERIODS as readonly string[]).includes(String(v.per))) {
      return {
        ok: false,
        error:
          `${at}An 'avg-per' measure needs per: 'day', 'week' or 'month' — the period the ` +
          'window\'s total is divided by. E.g. {"presentation":"metric","measure":"avg-per",' +
          '"per":"month","measureColumnId":"<amount>","timeColumnId":"<date>",' +
          '"timeWindow":{"kind":"previous-months","months":4}}.',
      };
    }
    if (v.timeWindow == null || v.timeWindow === "all") {
      return {
        ok: false,
        error:
          `${at}An 'avg-per' measure divides by the periods the window spans, so it needs a ` +
          'bounded timeWindow — "this-month", {"kind":"last-weeks","weeks":4}, ' +
          '{"kind":"previous-months","months":4} — never "all", which spans no known number ' +
          "of periods.",
      };
    }
    if (groupCol || v.seriesBy != null) {
      return {
        ok: false,
        error:
          `${at}An 'avg-per' measure is one number for one window, so it cannot group or split ` +
          "into series. Drop groupBy and seriesBy, or use measure 'sum' for a table of periods.",
      };
    }
  } else if (!isRow && v.per != null) {
    return {
      ok: false,
      error:
        `${at}per belongs to the 'avg-per' measure: it names the period that measure divides ` +
        "the window's total by. Set measure to 'avg-per' with per 'day' | 'week' | 'month', or " +
        "drop per.",
    };
  }

  if (isRow) {
    if (!(ROW_PRESENTATIONS as readonly string[]).includes(presentation)) {
      return {
        ok: false,
        error:
          `${at}An object with \`columns\` prints rows, so it draws as a list or a table — not ` +
          `a ${presentation}. For a chart, drop \`columns\` and give the object a groupBy and ` +
          "a measure.",
      };
    }
    if (groupCol) {
      return {
        ok: false,
        error:
          `${at}This object prints one line per row and must not group. Drop groupBy (a table of ` +
          "totals is an aggregate: remove `columns` and name a groupBy and a measure), or drop " +
          "`columns` to make it an aggregate.",
      };
    }
    if (v.timeBucket != null) {
      return {
        ok: false,
        error:
          `${at}A row object shows rows, not periods: drop timeBucket. A date column may still be ` +
          "the timeColumnId a timeWindow acts on.",
      };
    }
    if (v.seriesBy != null) {
      return {
        ok: false,
        error: `${at}A row object prints its own columns; series only apply to a grouped aggregate.`,
      };
    }
    const cols = v.columns;
    if (!Array.isArray(cols) || cols.length === 0) {
      return {
        ok: false,
        error: `${at}A row object needs a non-empty columns array naming the database columns it prints`,
      };
    }
    if (cols.length > MAX_LIST_COLUMNS) {
      return { ok: false, error: `${at}A row object prints at most ${MAX_LIST_COLUMNS} columns` };
    }
    const seenCols = new Set<string>();
    for (const c of cols) {
      if (typeof c !== "string" || !col(c)) {
        return {
          ok: false,
          error: `${at}View columns must name existing columns of this database: ${String(c)}`,
        };
      }
      if (seenCols.has(c)) return { ok: false, error: `${at}View columns repeats ${c}` };
      seenCols.add(c);
    }
  } else {
    if (!(AGGREGATE_PRESENTATIONS as readonly string[]).includes(presentation)) {
      return {
        ok: false,
        error:
          `${at}This object is an aggregate, so it draws as metric, table, bar or line — not a ` +
          `${presentation}. A row listing is an object with \`columns\`.`,
      };
    }
    if (Array.isArray(v.columns) && v.columns.length > 0) {
      return {
        ok: false,
        error:
          `${at}Naming \`columns\` makes this a row object, not an aggregate. Set presentation ` +
          `to "table" or "list" to print the rows, or drop columns and give the object a groupBy.`,
      };
    }
  }

  if (v.timeBucket != null && !(TIME_BUCKETS as readonly string[]).includes(v.timeBucket as string)) {
    return { ok: false, error: `${at}Unknown timeBucket: ${String(v.timeBucket)}` };
  }
  if (v.timeBucket != null && !groupCol) {
    return {
      ok: false,
      error: `${at}timeBucket collapses a date groupBy into periods, so it needs a groupBy.`,
    };
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

  // Splitting a group into series is a second dimension of the same fold. It
  // only makes sense for a measure that adds up (or counts): a split of an
  // average has no meaning at the label level, and a split of "last" would sum
  // one series' latest value into another's.
  if (v.seriesBy != null) {
    if (isRow) {
      return { ok: false, error: `${at}A row object prints its own columns; series only apply to an aggregate.` };
    }
    const seriesCol = col(v.seriesBy);
    if (!seriesCol) {
      return { ok: false, error: `${at}View seriesBy column does not exist: ${String(v.seriesBy)}` };
    }
    if (seriesCol.type === "number") {
      return {
        ok: false,
        error: `${at}seriesBy must be a category column (select, relation, text or boolean), not a number.`,
      };
    }
    if (v.groupBy != null && String(v.seriesBy) === String(v.groupBy)) {
      return {
        ok: false,
        error: `${at}seriesBy repeats groupBy, so every group would hold one series. Split by a different column.`,
      };
    }
    if (measure !== "sum" && measure !== "count") {
      return {
        ok: false,
        error:
          `${at}A series split needs measure 'sum' or 'count'; '${measure}' is a per-group shape ` +
          "and cannot be split into series. Use 'sum' for the spending by ${seriesCol.name}.",
      };
    }
  }

  // A row object takes no measure: it prints the rows, it does not fold them.
  // The measure fields it inherits are inert rather than absent, which is why
  // this check is skipped rather than satisfied.
  if (!isRow) {
    if (measure === "count") {
      if (v.measureColumnId != null) {
        return { ok: false, error: `${at}A count measure takes no measureColumnId` };
      }
    } else if (measure === "avg-per") {
      // The column is optional HERE, and that is the one place this measure
      // differs from the rest: with a number column it is the average AMOUNT per
      // period, without one the average NUMBER OF ROWS per period. Both are real
      // questions, and naming no column is how the second one is asked.
      const mCol = v.measureColumnId != null ? col(v.measureColumnId) : null;
      if (v.measureColumnId != null && !mCol) {
        return { ok: false, error: `${at}An avg-per measure needs an existing measureColumnId` };
      }
      if (mCol && mCol.type !== "number") {
        return { ok: false, error: `${at}Measure column ${mCol.name} must be a number column` };
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
  const displayCheck = validateDisplay(v.display);
  if (!displayCheck.ok) return { ok: false, error: `${at}${displayCheck.error}` };

  return { ok: true, value: true };
}

/**
 * The drawing options, checked rather than trusted. They are all cosmetic, but
 * a palette name that no stylesheet knows is a card drawn in one flat colour
 * with no way for the operator to see why.
 */
function validateDisplay(raw: unknown): Result<true> {
  if (raw == null) return { ok: true, value: true };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "display must be an object" };
  }
  const v = raw as Record<string, unknown>;
  if (v.palette != null && !(VIEW_PALETTE_NAMES as readonly string[]).includes(String(v.palette))) {
    return {
      ok: false,
      error: `display.palette must be one of ${VIEW_PALETTE_NAMES.join(", ")}`,
    };
  }
  for (const key of ["legend", "valueLabels"] as const) {
    if (v[key] != null && typeof v[key] !== "boolean") {
      return { ok: false, error: `display.${key} must be a boolean` };
    }
  }
  for (const key of ["xLabel", "yLabel"] as const) {
    if (v[key] != null) {
      if (typeof v[key] !== "string") return { ok: false, error: `display.${key} must be a string` };
      if ((v[key] as string).length > 60) {
        return { ok: false, error: `display.${key} must be 60 characters or fewer` };
      }
    }
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

/** A month as a whole number of months since year 0, so months can be counted. */
function monthIndex(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

/** The `YYYY-MM` a month index names. */
function monthOf(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12; // 0..11, and non-negative for any index
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
}

/** The last calendar day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one.
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function clampMonths(months: number): number {
  return Math.min(MAX_WINDOW_MONTHS, Math.max(1, Math.floor(months)));
}

/**
 * The trailing calendar months, today's month among them and partial: `{ months:
 * 4 }` on 14 October spans 1 July .. 14 October. It ends at TODAY rather than at
 * the month's last day for the reason `this-month` does — a spend that has not
 * happened yet is not a spend.
 */
function lastMonthsBounds(months: number, today: string): { start: string; end: string } {
  const n = clampMonths(months);
  return { start: `${monthOf(monthIndex(today) - (n - 1))}-01`, end: today };
}

/**
 * The whole calendar months BEFORE today's month: `{ months: 4 }` on any day of
 * October spans 1 June .. 30 September, and on the first day of November it
 * spans 1 July .. 31 October with no write and nothing remembered.
 *
 * This is the window an operator means by "the previous 4 months, not including
 * the current one", and it is the shape a monthly average has to divide by: the
 * current month is partial, so a period average that included it would read low
 * on the 1st and climb all month.
 */
function previousMonthsBounds(months: number, today: string): { start: string; end: string } {
  const n = clampMonths(months);
  const last = monthOf(monthIndex(today) - 1);
  const first = monthOf(monthIndex(today) - n);
  return { start: `${first}-01`, end: monthEnd(last) };
}

/**
 * How many `period`-long buckets a window touches, both ends inclusive.
 *
 * This is the divisor an `avg-per` measure uses, and it is deliberately the
 * number of CALENDAR periods rather than the number of periods that happen to
 * hold rows: "average spend per month over the previous 4 months" divides by 4
 * even when one of those months was quiet, because a quiet month is a month of
 * R0 rather than a month that did not happen. It is also exactly the number of
 * rows a table over the same window and the same `timeBucket` would draw, so a
 * period average can never disagree with the table printed beside it.
 *
 * The bucket that CONTAINS the start is counted whole, as is the one containing
 * the end, so a partial month counts as a month. That is the same rule the
 * `timeBucket` fold uses when it labels a row by its month or week.
 */
export function periodsInWindow(start: string, end: string, period: ViewPeriod): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  if (period === "day") return Math.max(1, Math.round((b - a) / 86400000) + 1);
  if (period === "week") {
    // The Monday that opens each date's own week, counted in whole days.
    const monday = (ms: number): number => {
      const d = new Date(ms);
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() - (dayNum - 1));
      return d.getTime();
    };
    return Math.max(1, Math.round((monday(b) - monday(a)) / 86400000 / 7) + 1);
  }
  return Math.max(1, monthIndex(end) - monthIndex(start) + 1);
}

/**
 * A block's drawing options, with every field spelled the same way in the file.
 *
 * `undefined` and `null` both mean "not named" and are stored as `null`, so a
 * reader never has to guess whether an absent palette means the default palette
 * or a bug. A display with nothing named is stored as `null` rather than an
 * object full of nulls, because a card with no styling is the normal case.
 */
function normalizeDisplay(raw: unknown): ViewBlock["display"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const display = {
    // Kept as written, even when it is not a known palette: validation is what
    // refuses a name no stylesheet can draw, and normalizing it to null here
    // would silently replace the operator's choice with the default.
    palette: typeof v.palette === "string" ? (v.palette as ViewPalette) : null,
    legend: typeof v.legend === "boolean" ? v.legend : null,
    xLabel: typeof v.xLabel === "string" && v.xLabel.trim() ? v.xLabel.trim() : null,
    yLabel: typeof v.yLabel === "string" && v.yLabel.trim() ? v.yLabel.trim() : null,
    valueLabels: typeof v.valueLabels === "boolean" ? v.valueLabels : null,
  } as NonNullable<ViewBlock["display"]>;
  if (
    display.palette == null &&
    display.legend == null &&
    display.xLabel == null &&
    display.yLabel == null &&
    display.valueLabels == null
  ) {
    return null;
  }
  return display;
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
    databaseId: block.databaseId ?? null,
    from: block.from ?? null,
    seriesBy: block.seriesBy ?? null,
    display: normalizeDisplay(block.display),
    measure,
    measureColumnId: measure === "count" ? null : (block.measureColumnId ?? null),
    // Kept as written rather than cleared for the other measures: `per` on a
    // `sum` is a spec that meant `avg-per`, and validation says so instead of
    // drawing a total the author did not ask for.
    per: block.per ?? null,
    groupBy: block.groupBy ?? null,
    timeBucket: block.timeBucket ?? null,
    timeColumnId: block.timeColumnId ?? null,
    timeWindow: block.timeWindow ?? "all",
    filters: block.filters ?? [],
    sort: block.sort ?? { by: "label", dir: "asc" },
    limit: block.limit ?? DEFAULT_VIEW_LIMIT,
    convertToZar: block.convertToZar ?? false,
    columns: block.columns ?? [],
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
  // A one-number card written before presentations were separated often carries
  // the group's bucket with no group. The bucket is inert there, and dropping it
  // is what keeps an operator's existing card drawing instead of failing a new
  // rule on the next read. A ROW object keeps it so the validator can refuse a
  // listing that asked for periods.
  if (out.groupBy == null && (!Array.isArray(out.columns) || out.columns.length === 0)) {
    out.timeBucket = null;
  }
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
 * "absent": `groupBy: null` is how a composed view asks for one total, and
 * dropping it would make that object inherit the root's groupBy and draw a table
 * where the author asked for a number.
 */
function asBlock(raw: Record<string, unknown>): ViewBlock {
  const out: Record<string, unknown> = {
    id: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.title === "string" ? raw.title : "",
  };
  for (const key of [
    "groupBy", "timeBucket", "timeColumnId", "measureColumnId", "per",
    "databaseId", "from", "seriesBy",
  ]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  // The rest carry only their own type; `null` is not a value a writer means.
  for (const key of [
    "presentation", "measure", "timeWindow", "filters", "sort", "limit", "convertToZar", "span",
    "columns", "display",
  ]) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key];
  }
  return out as unknown as ViewBlock;
}

/**
 * A block that may be partial: anything it does not name is taken from `parent`
 * (the view's root query fields), except the fields that make it a different
 * KIND of object. The measure pair is the block's own, because a one-number
 * object must not inherit a sibling's measured column; a ROW object must not
 * inherit a grouping it cannot honour; and an object that names another
 * database cannot inherit column ids chosen against the card's.
 *
 * Only INHERITED fields are dropped. A block that names a grouping on a row
 * object, or a window on a derived object, is kept as written so the validator
 * can refuse the contradiction rather than silently dropping half of it.
 *
 * `parent` may itself be partial: a root built from a proposal has only the
 * fields the author wrote. `completeBlock` supplies the rest.
 */
function resolveBlock(parent: ViewBlock, raw: ViewBlock): ViewBlock {
  const layered: ViewBlock = { ...parent, ...raw, id: raw.id, title: raw.title } as ViewBlock;
  layered.measure = raw.measure ?? "sum";
  layered.measureColumnId = raw.measureColumnId ?? null;
  // `per` rides with the measure pair rather than with the inherited query
  // fields: a period average is one panel's own shape, and a sibling table must
  // not be handed a divisor it never asked for.
  layered.per = raw.per ?? null;
  // A block that explicitly says `groupBy: null` is asking for one total, so it
  // cannot also inherit the root's timeBucket. The bucket belonged to the root's
  // grouping, and carrying it over produced a spec that meant "group by nothing,
  // by week" — the old validator let that through because it only checked a
  // bucket against a grouping that existed.
  if (raw.groupBy === null && raw.timeBucket === undefined) layered.timeBucket = null;
  // Where this object reads. Only a block that names its own database changes
  // it; the card's database is the default for every object in it.
  layered.databaseId = raw.databaseId !== undefined ? raw.databaseId : (parent.databaseId ?? null);
  // `from` is the block's own switch: a derived object never inherits another
  // panel's source, or two panels would silently become one.
  layered.from = raw.from ?? null;
  // Drawing details are the card's default and the block's own, in that order.
  layered.display =
    raw.display !== undefined ? normalizeDisplay(raw.display) : normalizeDisplay(parent.display);
  // `seriesBy` is a query field like groupBy: inherit unless the block names it,
  // including an explicit null that turns the split off.
  layered.seriesBy =
    raw.seriesBy !== undefined ? raw.seriesBy : (raw.from ? null : (parent.seriesBy ?? null));

  // An object that names a DIFFERENT database cannot inherit the card's column
  // ids: the date column, the grouping and the filters were chosen against the
  // other database and mean nothing here. Such an object starts from its own
  // fields and the ordinary defaults, which is what lets one card hold a
  // transactions table and an accounts count side by side.
  const switchesDatabase =
    typeof raw.databaseId === "string" &&
    raw.databaseId !== "" &&
    raw.databaseId !== (parent.databaseId ?? null);
  if (switchesDatabase) {
    layered.groupBy = raw.groupBy ?? null;
    layered.timeBucket = raw.timeBucket ?? null;
    layered.timeColumnId = raw.timeColumnId ?? null;
    layered.timeWindow = raw.timeWindow ?? "all";
    layered.filters = raw.filters ?? [];
    layered.columns = raw.columns ?? [];
    layered.seriesBy = raw.seriesBy ?? null;
    layered.sort = raw.sort ?? { by: "label", dir: "asc" };
    layered.limit = raw.limit ?? DEFAULT_VIEW_LIMIT;
    layered.convertToZar = raw.convertToZar ?? false;
  }

  if (layered.from) {
    // A derived object folds another object's rows. It cannot also read a
    // database, choose a window, or group: those were the source's decisions.
    // Its OWN fields are kept rather than blanked, so the validator can refuse a
    // spec that named them instead of silently dropping what it asked for.
    layered.groupBy = raw.groupBy ?? null;
    layered.timeBucket = raw.timeBucket ?? null;
    layered.timeColumnId = raw.timeColumnId ?? null;
    layered.timeWindow = raw.timeWindow ?? "all";
    layered.filters = raw.filters ?? [];
    layered.seriesBy = null;
    layered.databaseId = null;
  } else {
    // A ROW object prints rows; it is not an aggregate, so it must not inherit
    // the root's grouping. Only an INHERITED grouping is dropped: a row object
    // that names one itself is refused by the validator, because that is a spec
    // whose author meant two different things.
    const isRowObject =
      (Array.isArray(raw.columns) && raw.columns.length > 0) || raw.presentation === "list";
    if (isRowObject) {
      layered.groupBy = raw.groupBy ?? null;
      layered.timeBucket = raw.timeBucket ?? null;
      layered.seriesBy = raw.seriesBy ?? null;
    }
  }
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
    const root = asBlock(written);
    // A single view's database is the card's, and `fillBlockDefaults` must not
    // overwrite it with the block-level "not named" null.
    root.databaseId = typeof written.databaseId === "string" ? written.databaseId : null;
    return { ...single, ...fillBlockDefaults(root) } as Omit<ViewSpec, "schemaVersion">;
  }
  // A composed view's root query fields are the defaults its blocks inherit and
  // are never read directly. They are kept exactly as written so the composer's
  // form still round-trips; each block is then layered over them and made
  // complete, exactly as `resolveViewBlocks` does when it draws the card.
  const rootFields: Record<string, unknown> = { ...written };
  delete rootFields.blocks;
  const rootBlock = asBlock(written);
  // The card's database is the default every block inherits; `asBlock` only
  // carries a block's own fields, so it is supplied here rather than guessed
  // later by a runner that cannot see the file's root.
  rootBlock.databaseId = typeof written.databaseId === "string" ? written.databaseId : null;
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
  root.databaseId = spec.databaseId;
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

/**
 * Window bounds as YYYY-MM-DD strings; null bounds mean "all time".
 *
 * Every named window is computed from `today` — the LOCAL calendar day of the
 * instant the card is drawn — so the same spec reads a different span tomorrow.
 * That is the whole point of the anchored windows: a card is a live query, and a
 * query that cannot move is a picture of one.
 *
 * The two period windows end at TODAY rather than at the period's last day.
 * "This month" and "this week" are asked by an operator looking at actuals, and
 * a spend that has not happened yet is not a spend; a window that ran to the end
 * of the month would also silently include a row someone dated ahead by mistake.
 */
export function windowBounds(
  w: ViewSpec["timeWindow"],
  today: string,
): { start: string | null; end: string | null } {
  if (typeof w === "object" && w.kind === "custom") return { start: w.start, end: w.end };
  if (typeof w === "object" && w.kind === "last-weeks") return lastWeeksBounds(w, today);
  if (typeof w === "object" && w.kind === "last-months") return lastMonthsBounds(w.months, today);
  if (typeof w === "object" && w.kind === "previous-months") {
    return previousMonthsBounds(w.months, today);
  }
  switch (w) {
    case "today":
      return { start: today, end: today };
    case "this-week":
      return { start: mondayOnOrBefore(today), end: today };
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
  const week = isoWeekOf(date);
  if (!week) return date;
  return `${week.year}-W${String(week.week).padStart(2, "0")}`;
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
): { sql: string; params: SqlBindable[] } {
  const conds: string[] = ["database_id = ?"];
  const params: SqlBindable[] = [spec.databaseId];

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
      params.push(`$.${f.columnId}`, ...(f.value as unknown[]).map(toSqlBindable));
    } else {
      // Comparisons CAST to REAL so a number filter compares number-wise even
      // though json_extract may return text; eq/neq keep JSON's own type rules.
      conds.push(opSql[f.op]);
      params.push(`$.${f.columnId}`, toSqlBindable(f.value));
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
    const rootDb = dbRes.value;

    const blocks = resolveViewBlocks(spec);
    /**
     * Every database this card names, read once. A card with objects side by
     * side can now hold a transactions table and an accounts count; the cache is
     * what keeps that from becoming one registry read per panel.
     */
    const databases = new Map<string, DatabaseMeta>([[rootDb.id, rootDb]]);
    const databaseFor = async (id: string): Promise<Result<DatabaseMeta>> => {
      const cached = databases.get(id);
      if (cached) return { ok: true, value: cached };
      const read = await getDatabase(root, slug, id);
      if (read.ok) databases.set(id, read.value);
      return read;
    };

    const registry = await readRegistry(vaultPaths(root).domainRegistry(slug));
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    const labelCache = new Map<string, Map<string, string>>();
    const labelsFor = async (db: DatabaseMeta): Promise<Map<string, string>> => {
      const cached = labelCache.get(db.id);
      if (cached) return cached;
      const labels = await buildRelationLabels(root, slug, db, registry);
      labelCache.set(db.id, labels);
      return labels;
    };

    /** Objects already validated and run, by id; `from` can only name one of these. */
    const priorRow = new Map<string, boolean>();
    const priorResults = new Map<string, ViewRunResult>();
    const today = todayLocalIso(now);

    // Validate every block against ITS database before reading anything, so a
    // card with one bad panel writes nothing and reads nothing.
    for (const block of blocks) {
      const wants = block.databaseId ?? rootDb.id;
      const blockDbRes = await databaseFor(wants);
      if (!blockDbRes.ok) {
        return {
          ok: false,
          error:
            `Block ${block.id}: database not found: ${wants}. Omit databaseId to use the card's ` +
            "own database, or name a database that exists in this domain.",
        };
      }
      const blockDb = blockDbRes.value;
      const check = validateBlock(
        { ...block, databaseId: blockDb.id },
        blockDb,
        blocks.length > 1 ? `Block ${block.id}` : "",
        priorRow,
      );
      if (!check.ok) return check;
      const isDerived = Boolean(block.from);
      if (!isDerived && block.timeColumnId == null && isWindowed(block.timeWindow)) {
        // The refusal names the column to use, not just the rule. This is the
        // one required field a model leaves out on its own — a windowed panel
        // reads as complete without it — and across the recorded sessions it
        // cost a whole extra round trip every time. Naming the database's own
        // date column here is what makes the retry certain rather than likely.
        const dates = blockDb.columns.filter((c) => c.type === "date");
        const suggestion =
          dates.length === 1
            ? ` This database's date column is "${dates[0]!.id}" — set timeColumnId: "${dates[0]!.id}" on that block.`
            : dates.length > 1
              ? ` This database's date columns are ${dates.map((c) => `"${c.id}"`).join(", ")} — name the one the window acts on.`
              : " This database has no date column, so a time window cannot be applied to it.";
        return {
          ok: false,
          error: `${blocks.length > 1 ? `Block ${block.id}: ` : ""}A timeWindow needs a timeColumnId, or the window silently does nothing.${suggestion} Or set timeWindow to "all".`,
        };
      }
      priorRow.set(block.id, isRowObject(block as never));
    }

    const results: ComposedViewRunResult["blocks"] = [];
    const warnings: string[] = [];
    for (const block of blocks) {
      let result: Result<ViewRunResult>;
      try {
        if (block.from) {
          const source = priorResults.get(block.from);
          if (!source) {
            return {
              ok: false,
              error: `Block ${block.id}: from names "${block.from}", which is not an earlier object.`,
            };
          }
          result = { ok: true, value: derivedResult(block, source) };
        } else {
          const blockDbRes = await databaseFor(block.databaseId ?? rootDb.id);
          if (!blockDbRes.ok) return blockDbRes;
          const blockDb = blockDbRes.value;
          result = await runBlock(
            root, slug, blockDb, registry, sqlitePath, await labelsFor(blockDb),
            { ...block, databaseId: blockDb.id }, today,
          );
        }
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
      priorResults.set(block.id, result.value);
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

/**
 * A derived object's result: the source object's rows, plus the one number its
 * measure folds them into.
 *
 * The rows are kept so the object can still be drawn as a table, a bar or a
 * line; the summary is what a metric draws. That is the whole reason a card can
 * show "the monthly totals" and "the average month" beside each other without
 * either being computed by hand and frozen.
 *
 * The fold is over the source's ROWS, not its groups: `sum` adds them, `avg`
 * divides by how many there are, `count` counts them, `last` takes the last. A
 * quiet month is already a row of zero in the source, so it stays in the
 * denominator — which is what makes the average agree with the table beside it.
 */
function derivedResult(spec: ViewBlockSpec, source: ViewRunResult): ViewRunResult {
  const warnings: string[] = [];
  const rows = source.rows;
  let summary: ViewRunResult["summary"] = null;
  if (rows.length > 0) {
    if (spec.measure === "sum") {
      summary = {
        label: "total",
        value: rows.reduce((sum, [, value]) => sum + value, 0),
      };
    } else if (spec.measure === "count") {
      summary = { label: "count", value: rows.length };
    } else if (spec.measure === "avg") {
      summary = {
        label: "average",
        value: rows.reduce((sum, [, value]) => sum + value, 0) / rows.length,
      };
    } else if (spec.measure === "last") {
      summary = { label: "latest", value: rows[rows.length - 1]![1] };
    }
  } else if (spec.measure === "sum" || spec.measure === "count") {
    summary = { label: spec.measure, value: 0 };
  }

  // The source's own order, optionally re-sorted and trimmed for the drawing.
  const sort = spec.sort ?? { by: "label", dir: "asc" };
  const sorted = [...rows].sort((a, b) => {
    const cmp =
      sort.by === "label" ? a[0].localeCompare(b[0]) : a[1] - b[1] || a[0].localeCompare(b[0]);
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const limit = spec.limit ?? DEFAULT_VIEW_LIMIT;
  if (sorted.length > limit) {
    warnings.push(`Showing ${limit} of ${sorted.length} rows.`);
  }

  return {
    columns: ["label", "value"],
    rows: sorted.slice(0, limit),
    ...(summary ? { summary } : {}),
    ...(source.series ? { series: source.series } : {}),
    ...(source.seriesRows ? { seriesRows: source.seriesRows } : {}),
    warnings,
    currency: source.currency,
  };
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
  /**
   * The period average's divisor, computed from the WINDOW and not from the
   * rows: it is the number of calendar periods the window spans, so a month with
   * no spending still counts as a month of zero. Validation has already refused
   * an `avg-per` with no `per` or no bounded window, so both are present here.
   */
  const per = spec.measure === "avg-per" ? spec.per : null;
  const periods = per && start && end ? periodsInWindow(start, end, per) : 0;
  /** A `count` of rows, taken either way: by the measure or by the average of one. */
  const countsRows = spec.measure === "count" || (spec.measure === "avg-per" && spec.measureColumnId == null);

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
  //
  // A listing draws the amount as a COLUMN and an aggregate measures it, so the
  // two ask different questions and must still reach the same answer: a listing
  // whose rows were converted differently from the total printed beside them
  // would be lying about one of the two.
  const isRow = isRowObject(spec as ViewBlock);
  const amountColumnId = db.columns.find((c) => c.name === "amount")?.id ?? "";
  const drawsAmount =
    isRow ? amountColumnId !== "" && spec.columns.includes(amountColumnId) : measureCol?.name === "amount";
  const isFinanceAmount =
  slug === "financial" &&
  spec.databaseId === FINANCE_DB_IDS.transactions &&
  drawsAmount;
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

  // A listing keeps the rows the read above matched instead of folding them, so
  // it shares every part of the query — the database, the filters, the window —
  // and only the fold differs. The rows it prints are therefore the same rows a
  // table over the same window would have counted.
  if (isRow) {
    return {
      ok: true,
      value: listResult(
        rawRows, db, spec, relationLabels, accountColId, amountColumnId,
        accountCurrency, usdZarRate, isFinanceAmount, warnings,
      ),
    };
  }

  // Aggregate in TS: every rule the design pins as a warning lives here, one
  // loop, no silent bucket. Conversion happens per row at aggregation time,
  // so a group sum is already in home currency when conversion applies.
  //
  // A group carries its per-series split when `seriesBy` names a category
  // column. `value` stays the per-label TOTAL across every series, so the
  // dataset has one number per label whatever the drawing does with the split:
  // a metric folds the totals, a table can print a column per series, and a
  // chart draws one line or bar cluster per series.
  type SeriesBucket = { value: number; count: number };
  type GroupBucket = {
    label: string;
    value: number;
    count: number;
    series: Map<string, SeriesBucket>;
  };
  const groups = new Map<string, GroupBucket>();
  let undatedCount = 0;
  const seenCurrencies = new Set<string>();
  const seriesCol = spec.seriesBy
    ? (db.columns.find((c) => c.id === spec.seriesBy) as DatabaseColumn | undefined)
    : undefined;

  /** A column cell as the label a reader sees: relation ids resolved, dates bucketless. */
  const cellLabel = (column: DatabaseColumn, cells: Record<string, unknown>): string => {
    const raw = cells[column.id];
    if (column.type === "relation") {
      const rid = typeof raw === "string" && raw ? raw : null;
      return rid ? (relationLabels.get(`${column.relationDatabaseId}::${rid}`) ?? rid) : "(none)";
    }
    return labelForValue(raw);
  };

  for (const raw of rawRows) {
    const cells = parseCells(raw.cells);
    if (!cells) continue;

    let value: number | null = null;
    let rowCurrency: string | null = null;
    if (countsRows) {
      value = 1;
    } else if (isFinanceAmount && accountColId) {
      const resolved = financeAmount(cells, measureCol!.id, accountColId, accountCurrency, usdZarRate);
      if (resolved.value === null) continue;
      value = resolved.value;
      rowCurrency = resolved.currency;
      if (rowCurrency) seenCurrencies.add(rowCurrency);
    } else {
      const mv = cells[measureCol!.id];
      if (typeof mv !== "number" || !Number.isFinite(mv)) continue;
      value = mv;
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

    const seriesKey = seriesCol ? cellLabel(seriesCol, cells) : "";
    let bucket = groups.get(label);
    if (!bucket) {
      bucket = { label, value: 0, count: 0, series: new Map() };
      groups.set(label, bucket);
    }
    let seriesBucket = seriesCol ? bucket.series.get(seriesKey) : undefined;
    if (seriesCol && !seriesBucket) {
      seriesBucket = { value: 0, count: 0 };
      bucket.series.set(seriesKey, seriesBucket);
    }

    if (spec.measure === "last") {
      // rows arrive oldest-first, so plain assignment leaves the newest row.
      bucket.value = value;
      bucket.count = 1;
      if (seriesBucket) {
        seriesBucket.value = value;
        seriesBucket.count = 1;
      }
    } else if (spec.measure === "avg") {
      bucket.value += value;
      bucket.count += 1;
      if (seriesBucket) {
        seriesBucket.value += value;
        seriesBucket.count += 1;
      }
    } else {
      bucket.value += value;
      bucket.count += 1;
      if (seriesBucket) {
        seriesBucket.value += value;
        seriesBucket.count += 1;
      }
    }
  }
  // avg divides after the fold: sum/count per label. An empty group cannot
  // happen (count starts at 1), so no zero-division guard is needed here.
  if (spec.measure === "avg") {
    for (const group of groups.values()) {
      group.value = group.value / Math.max(1, group.count);
      for (const series of group.series.values()) {
        series.value = series.value / Math.max(1, series.count);
      }
    }
  }
  // A period average divides by the CALENDAR, not by the rows: the window's
  // total over the periods it spans. `avg` above answers "what does a row
  // usually look like"; this answers "what does a week usually cost", and
  // pressing one into the other is what made "the average spend per week across
  // the last 4 weeks" come back as the average transaction.
  if (per && periods > 0) {
    for (const group of groups.values()) {
      group.value = group.value / periods;
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

  // A metric over an empty window is a real number, not a blank one.
  //
  // This is what makes a "today" card usable: a day with no spending is the
  // normal case, and it must read 0 rather than "no rows" — the same thing a
  // spreadsheet says for SUM over nothing. Only the measures for which zero is
  // the true answer qualify: a count of no rows IS 0, a sum of no rows IS 0, and
  // a period average of no rows is 0 per period for the same reason (R0 spread
  // over four months is R0 a month, not an unknown). An `avg` of no rows is
  // undefined and a `last` of no rows does not exist, so those keep drawing
  // nothing, which is the honest answer for them.
  const isEmptyMetric =
    spec.presentation === "metric" &&
    spec.groupBy == null &&
    shown.length === 0 &&
    (spec.measure === "sum" || spec.measure === "count" || spec.measure === "avg-per");
  const rows: Array<[string, number]> = isEmptyMetric
    ? [["value", 0]]
    : shown.map((e) => [e.label, e.value]);

  // The headline number this dataset folds to. It is computed from ALL groups,
  // not just the ones the card has room to draw: a metric is the total of the
  // data, never the total of the visible page of it.
  const summary = summarizeGroups(entries, spec.measure);
  const summaryForResult =
    spec.groupBy == null
      ? summarizeGroups(rows.map(([label, value]) => ({ label, value })), spec.measure)
      : summary;

  // Series: keep the biggest MAX_VIEW_SERIES and pool the tail as "Other", so a
  // category column with forty values still yields a readable legend and a
  // total that still adds up.
  let seriesNames: string[] | undefined;
  let seriesRows: Array<[string, string, number]> | undefined;
  if (seriesCol) {
    const totals = new Map<string, number>();
    // Ranked over the labels the card will actually draw, not the whole result:
    // a series that exists only beyond the limit would otherwise take a legend
    // slot and draw no mark.
    for (const group of shown) {
      for (const [name, bucket] of group.series) {
        totals.set(name, (totals.get(name) ?? 0) + bucket.value);
      }
    }
    const ranked = [...totals.entries()]
      .filter(([, total]) => Math.abs(total) > 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]));
    const kept = ranked.slice(0, MAX_VIEW_SERIES).map(([name]) => name);
    const pooled = ranked.slice(MAX_VIEW_SERIES).map(([name]) => name);
    if (pooled.length > 0) {
      kept.push("Other");
      warnings.push(
        `Showing ${MAX_VIEW_SERIES} of ${ranked.length} ${seriesCol.name} values; the rest are pooled as "Other".`,
      );
    }
    if (kept.length > 0) {
      seriesNames = kept;
      seriesRows = [];
      for (const group of shown) {
        for (const name of kept) {
          if (name === "Other") {
            const value = pooled.reduce(
              (sum, dropped) => sum + (group.series.get(dropped)?.value ?? 0),
              0,
            );
            if (pooled.length > 0) seriesRows.push([group.label, name, value]);
            continue;
          }
          const bucket = group.series.get(name);
          if (bucket) seriesRows.push([group.label, name, bucket.value]);
        }
      }
    }
  }

  return {
    ok: true,
    value: {
      columns: ["label", "value"],
      rows,
      ...(summaryForResult ? { summary: summaryForResult } : {}),
      ...(seriesNames ? { series: seriesNames } : {}),
      ...(seriesRows ? { seriesRows } : {}),
      warnings,
      currency,
    },
  };
}

/**
 * The one number a dataset folds to.
 *
 * The measure means the same thing here as it does per group, applied to the
 * groups themselves: `sum` and `count` add up, `avg` averages the group values
 * (the average of the monthly totals), and `last` takes the newest group in the
 * card's own sort order. `avg-per` has already divided by its window, so it
 * reads its one row rather than folding again.
 */
function summarizeGroups(
  entries: Array<{ label: string; value: number }>,
  measure: ViewMeasure,
): { label: string; value: number } | null {
  if (entries.length === 0) return null;
  if (measure === "avg") {
    return { label: "average", value: entries.reduce((sum, e) => sum + e.value, 0) / entries.length };
  }
  if (measure === "last") {
    // "Latest" is the newest GROUP, not the last row of whatever display order
    // the card happens to use: sorting a table newest-first must not turn the
    // headline into the oldest month.
    const newest = [...entries].sort((a, b) => a.label.localeCompare(b.label)).at(-1)!;
    return { label: "latest", value: newest.value };
  }
  if (measure === "avg-per") {
    return entries.length === 1 ? { label: "value", value: entries[0]!.value } : null;
  }
  return {
    label: entries.length === 1 ? "value" : "total",
    value: entries.reduce((sum, e) => sum + e.value, 0),
  };
}

// ---------------------------------------------------------------------------
// Listings: `presentation: "list"` — the rows themselves, not a fold of them
// ---------------------------------------------------------------------------

/**
 * A row's amount, and the currency it ends up in after the finance rule.
 *
 * One function because two callers must not disagree: an aggregate folds these
 * values into a bucket and a listing prints them side by side, and a card that
 * showed a total at one rate and the rows behind it at another would be lying
 * about one of the two. `null` means "this row has no usable amount" — which an
 * aggregate skips and a listing still prints, as an empty cell.
 */
function financeAmount(
  cells: Record<string, unknown>,
  measureColId: string,
  accountColId: string,
  accountCurrency: Map<string, string>,
  usdZarRate: number | null,
): { value: number | null; currency: string | null } {
  const mv = cells[measureColId];
  if (typeof mv !== "number" || !Number.isFinite(mv)) return { value: null, currency: null };
  const acctId = cells[accountColId];
  const rowCurrency = typeof acctId === "string" ? (accountCurrency.get(acctId) ?? null) : null;
  if (rowCurrency === "USD" && usdZarRate != null) {
    return { value: mv * usdZarRate, currency: "ZAR" };
  }
  return { value: mv, currency: rowCurrency };
}

/**
 * A listing: every row the query matched, one line each, newest first.
 *
 * Ordered by the block's own time column when it names one, because the reason a
 * listing exists is that "recent" is at the top; without a date to order by, the
 * read's own order (created_at ascending) is reversed, which puts the newest
 * ENTERED rows first instead. Either way it is a listing's order, which is why
 * the block's `sort` — a field about comparing aggregate groups — is not
 * consulted here.
 *
 * A relation cell is resolved to its target's label, exactly as a relation
 * groupBy is in the fold: an operator reading a ledger wants "Groceries", not
 * the uuid of the row it points at. A cell the row does not have is left empty
 * rather than dropped, because a listing's job is to show the rows as they are.
 */
function listResult(
  rawRows: Array<{ id: string; cells: string }>,
  db: DatabaseMeta,
  spec: ViewBlockSpec & ViewQuerySpec,
  relationLabels: Map<string, string>,
  accountColId: string,
  amountColumnId: string,
  accountCurrency: Map<string, string>,
  usdZarRate: number | null,
  isFinanceAmount: boolean,
  warnings: string[],
): ViewRunResult {
  const colById = new Map(db.columns.map((c) => [c.id, c]));
  const listed = spec.columns
    .map((id) => colById.get(id))
    .filter((c): c is DatabaseColumn => Boolean(c));
  const timeCol = spec.timeColumnId ? colById.get(spec.timeColumnId) : undefined;

  const projected: Array<{ cells: ViewListCell[]; sortKey: string }> = [];
  const seenCurrencies = new Set<string>();

  for (const raw of rawRows) {
    const cells = parseCells(raw.cells);
    if (!cells) continue;

    let rowCurrency: string | null = null;
    const line: ViewListCell[] = [];
    for (const column of listed) {
      if (isFinanceAmount && column.id === amountColumnId) {
        const resolved = financeAmount(cells, amountColumnId, accountColId, accountCurrency, usdZarRate);
        if (resolved.currency) {
          rowCurrency = resolved.currency;
          seenCurrencies.add(resolved.currency);
        }
        line.push(resolved.value ?? "");
        continue;
      }
      const value = cells[column.id];
      if (column.type === "relation") {
        const rid = typeof value === "string" && value ? value : null;
        line.push(
          rid ? (relationLabels.get(`${column.relationDatabaseId}::${rid}`) ?? rid) : "",
        );
        continue;
      }
      line.push(cellText(value));
    }

    const key = timeCol ? cells[timeCol.id] : undefined;
    projected.push({ cells: line, sortKey: typeof key === "string" ? key : "" });
  }

  // Newest first by the time column. Equal dates keep the read's order — the
  // sort is stable — so the card never shuffles rows that share a day.
  if (timeCol) {
    projected.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  } else {
    projected.reverse();
  }

  let currency: ViewRunResult["currency"] = null;
  if (isFinanceAmount) {
    if (seenCurrencies.size === 1 && seenCurrencies.has("ZAR")) {
      currency = "ZAR";
    } else if (seenCurrencies.has("USD") && seenCurrencies.has("ZAR")) {
      // An aggregate says "series kept separate", because it draws one line per
      // currency. A listing has no series to keep apart: it prints the rows, so
      // the useful thing to say is which currencies are on the card and that the
      // amounts were not converted — the money column cannot carry a unit when
      // its rows do not share one, and this warning is the only place left that
      // can say so.
      currency = "mixed";
      warnings.push(
        `Rows span more than one currency (${[...seenCurrencies].sort().join(", ")}); each amount ` +
          "is shown exactly as its row stores it.",
      );
    } else if (seenCurrencies.has("USD")) {
      currency = "mixed";
      warnings.push("USD amounts could not convert to ZAR; shown as-is.");
    }
  }

  const limit = spec.limit ?? DEFAULT_VIEW_LIMIT;
  if (projected.length > limit) {
    warnings.push(`Showing ${limit} of ${projected.length} rows.`);
  }

  const headers = listed.map((c) => c.name);
  const moneyIndex = listed.findIndex((c) => c.id === amountColumnId);

  return {
    columns: headers,
    rows: [],
    listRows: projected.slice(0, limit).map((p) => p.cells),
    // Which column the `currency` above actually describes, so a card can put
    // the unit on the money column instead of guessing at the last one.
    ...(currency !== null && moneyIndex >= 0 ? { currencyColumn: headers[moneyIndex] } : {}),
    warnings,
    currency,
  };
}

/** One cell as text: a value the row stores, never a formatted one. */
function cellText(value: unknown): ViewListCell {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
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
    const check = await validateViewSpecForVault(root, slug, out as ViewSpec, dbRes.value);
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
