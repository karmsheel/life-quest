import { getDatabase, listRows } from "./domain-databases.ts";
import { liveAreas } from "./domain-lens.ts";
import { listDomains } from "./domains.ts";
import {
  compileMetricSpec,
  eventColumnIds,
  getMetric,
  listMetricDefinitions,
  METRICS_DATABASE_ID,
  metricDisplayValue,
  readWeekStartDay,
  runSpecOverWindow,
  type MetricEventColumns,
} from "./metrics.ts";
import {
  currentPeriod,
  isReviewCadence,
  isValidLocalIsoDate,
  periodBounds,
  periodLabel,
  previousPeriod,
} from "./period.ts";
import { formatMetricNumber, metricUnitSuffix } from "./review-figures.ts";
import type {
  MetricAggregation,
  MetricDefinition,
  MetricDirection,
  MetricFormatting,
  Result,
  ReviewCadence,
  WeekStartDay,
} from "./types.ts";

/**
 * The Analytics matrix (2026-11-26 metrics design, §10.5).
 *
 * Phase 4 gave an area its metric definitions and Phase 5 wrote them into review
 * pages. This is the read that turns those definitions into the one genuinely
 * new surface: a rows × periods matrix — one row per definition, one column per
 * recent period, each cell a formatted value and its change from the period
 * before.
 *
 * Three properties are the whole contract:
 *
 *  1. **One engine.** Every cell is computed by `runView`, through the same
 *     compiled spec `getMetricsSummary` and the review figures use. Nothing here
 *     folds a number itself; the only arithmetic in this file is the delta
 *     between two values the engine already answered.
 *  2. **No fabricated zero.** A window with no rows answers `valueText: null`
 *     (the UI draws its no-data marker), never "0". A delta exists only when
 *     BOTH periods it compares have a value.
 *  3. **Tolerant.** A malformed definition file, or one that cannot answer
 *     (its source database was deleted, its spec no longer runs), is reported in
 *     `problems`; the healthy definitions beside it still answer. One bad file
 *     never takes the page down.
 *
 * Cost is one `runView` per definition per window, and a matrix shows the last
 * `count` periods so the oldest column can still carry a delta it also reads the
 * one older window — `count + 1` runs per definition. There is deliberately no
 * extra aggregation pass.
 */

/** The columns the page asks for when it does not say otherwise. */
export const ANALYTICS_DEFAULT_PERIODS = 8;

/** A sanity cap on `count`, so a caller cannot ask the page to run forever. */
export const ANALYTICS_MAX_PERIODS = 52;

/** One period column, as the matrix header draws it. */
export type AnalyticsPeriod = {
  /** The period key, e.g. `2026-10-12` weekly or `2026-10` monthly. */
  period: string;
  /** The operator-facing label, e.g. `12-18 Oct '26 (W42)`. */
  label: string;
  /** First local calendar date the window covers, `YYYY-MM-DD`. */
  start: string;
  /** Last local calendar date the window covers, `YYYY-MM-DD`. */
  end: string;
};

/**
 * One cell of the matrix: a period, the displayed value in that period, and the
 * signed change from the period before it.
 *
 * `valueText` is null when the window held no rows (the UI draws its no-data
 * marker); `deltaText` is null when either the cell or the period before it has
 * no value. The unit lives on the value cell, never on the delta.
 */
export type AnalyticsCell = {
  period: string;
  start: string;
  end: string;
  valueText: string | null;
  deltaText: string | null;
};

/** One definition's row across the matrix's periods. */
export type AnalyticsMetricRow = {
  areaSlug: string;
  areaName: string;
  metricId: string;
  label: string;
  unit: string;
  source: "derived" | "events";
  aggregation: MetricAggregation;
  direction: MetricDirection | null;
  target: number | null;
  cells: AnalyticsCell[];
  /**
   * The derived spec's source database id, so the UI can open it for a cell
   * click; null for an events definition, whose rows live in `metrics`.
   */
  databaseId: string | null;
  /**
   * The derived spec's time column id, so a cell link can ask the Data page to
   * filter the source rows to the cell's period; null for events definitions.
   */
  timeColumnId: string | null;
};

/** The Analytics response: periods oldest → newest, rows grouped by area. */
export type AnalyticsMatrix = {
  cadence: ReviewCadence;
  /** The area lens; null is the Life lens (every live area). */
  lens: string | null;
  periods: AnalyticsPeriod[];
  rows: AnalyticsMetricRow[];
  /** Definitions that could not be read or could not answer, as sentences. */
  problems: string[];
  /** The instant the read ran, ISO — the matrix is a live read, not a snapshot. */
  asOf: string;
};

export type GetAnalyticsMatrixInput = {
  cadence: ReviewCadence;
  /** Null is the Life lens: every live area, in vault order. */
  lens: string | null;
  /** How many period columns; defaults to 8, capped at `ANALYTICS_MAX_PERIODS`. */
  count?: number;
};

/** One logged event row, as the cell panel lists and edits it. */
export type MetricEventRow = {
  rowId: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  value: number;
  /** Empty string when the row carries no note. */
  note: string;
};

/**
 * One events metric's rows for one window, plus the ids the UI needs to edit a
 * row through the standard row path.
 *
 * `columns` are the metrics database's MINTED column ids — the renderer hands
 * them straight to `dbUpsertRow`, so the panel never has to guess a column id or
 * read the registry itself. `eventKey` is the value a row's `metric` cell must
 * carry for the definition to read it.
 */
export type MetricEvents = {
  areaSlug: string;
  metricId: string;
  eventKey: string;
  databaseId: string;
  columns: MetricEventColumns;
  rows: MetricEventRow[];
};

export type ListMetricEventsInput = {
  area: string;
  metricId: string;
  /** Inclusive local calendar date, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive local calendar date, `YYYY-MM-DD`. */
  end: string;
};

function normaliseCount(count: number | undefined): number {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return ANALYTICS_DEFAULT_PERIODS;
  }
  return Math.min(Math.max(Math.trunc(count), 1), ANALYTICS_MAX_PERIODS);
}

/**
 * The `wanted` period windows, oldest first, ending at `cadence`'s current
 * period.
 *
 * One extra older window is included (`wanted + 1` windows) so the oldest
 * DISPLAYED column still has a period before it to compare with; the caller
 * slices it off for the column list.
 */
async function buildPeriods(
  root: string,
  cadence: ReviewCadence,
  wanted: number,
  weekStartDay: WeekStartDay,
): Promise<Result<AnalyticsPeriod[]>> {
  const periods: string[] = [];
  let cursor = currentPeriod(cadence, weekStartDay);
  for (let index = 0; index < wanted + 1; index += 1) {
    periods.push(cursor);
    const previous = previousPeriod(cadence, cursor, weekStartDay);
    if (!previous.ok) return { ok: false, error: previous.error };
    cursor = previous.value;
  }
  periods.reverse();
  const out: AnalyticsPeriod[] = [];
  for (const period of periods) {
    const bounds = periodBounds(cadence, period, weekStartDay);
    if (!bounds.ok) return { ok: false, error: bounds.error };
    out.push({
      period,
      label: periodLabel(cadence, period, weekStartDay),
      start: bounds.value.start,
      end: bounds.value.end,
    });
  }
  return { ok: true, value: out };
}

/** A value as the operator reads it: magnitude, formatting, then the unit. */
function formatCellValue(value: number, definition: MetricDefinition): string {
  return `${formatMetricNumber(value, definition.formatting ?? null)}${metricUnitSuffix(
    definition.unit,
  )}`;
}

/**
 * The signed change between two DISPLAYED values, grouped, with no unit: the
 * value cells already carry the unit. A magnitude rule is not applied to the
 * delta — it describes the difference of what is shown, not a second number.
 */
function formatCellDelta(delta: number, formatting: MetricFormatting | null): string {
  const text = formatMetricNumber(Math.abs(delta), { decimals: formatting?.decimals });
  if (delta > 0) return `+${text}`;
  if (delta < 0) return `-${text}`;
  return text;
}

/** The vault-relative definition file, so a problem can be opened. */
function definitionFile(areaSlug: string, metricId: string): string {
  return `domains/${areaSlug}/metrics/${metricId}.json`;
}

/**
 * One definition answered over every window the matrix needs.
 *
 * The windows arrive oldest first and include the extra older one, so
 * `values[index + 1]` is the displayed column's value and `values[index]` is the
 * period before it. A run failure is reported once and answers nulls for the
 * rest of the definition's cells — a broken spec fails every window, and running
 * it eight more times would only repeat the same failure.
 */
async function answerDefinition(
  root: string,
  areaSlug: string,
  definition: MetricDefinition,
  windows: ReadonlyArray<AnalyticsPeriod>,
  eventColumns: MetricEventColumns | null,
  now: Date,
  problems: string[],
): Promise<AnalyticsMetricRow> {
  const values: Array<number | null> = [];
  let failed: string | null = null;
  for (const window of windows) {
    if (failed !== null) {
      values.push(null);
      continue;
    }
    try {
      // An events definition reads rows in the area's `metrics` database. When
      // that database is not there, the honest answer is "no rows" — a read must
      // not create it (and did not: it was read with `getDatabase`).
      if (definition.source === "events" && !eventColumns) {
        values.push(null);
        continue;
      }
      const spec = compileMetricSpec(
        definition,
        { start: window.start, end: window.end },
        eventColumns ?? undefined,
      );
      const run = await runSpecOverWindow(root, areaSlug, spec, now);
      if (!run.ok) {
        failed = run.error;
        values.push(null);
        continue;
      }
      values.push(metricDisplayValue(run.value, definition.formatting ?? null));
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
      values.push(null);
    }
  }
  if (failed !== null) {
    problems.push(`${definitionFile(areaSlug, definition.id)}: ${failed}`);
  }
  // Drop the extra older window: it exists for the oldest column's delta only.
  const displayed = windows.slice(1);
  const shown = values.slice(1);
  const previousShown = values.slice(0, -1);
  const cells: AnalyticsCell[] = displayed.map((window, index) => {
    const value = shown[index] ?? null;
    const previous = previousShown[index] ?? null;
    return {
      period: window.period,
      start: window.start,
      end: window.end,
      valueText: value === null ? null : formatCellValue(value, definition),
      deltaText:
        value === null || previous === null
          ? null
          : formatCellDelta(value - previous, definition.formatting ?? null),
    };
  });
  return {
    areaSlug,
    areaName: "",
    metricId: definition.id,
    label: definition.label,
    unit: definition.unit,
    source: definition.source,
    aggregation: definition.aggregation,
    direction: definition.direction ?? null,
    target: definition.target ?? null,
    cells,
    databaseId:
      definition.source === "derived"
        ? typeof definition.spec?.databaseId === "string"
          ? definition.spec.databaseId
          : null
        : null,
    timeColumnId:
      definition.source === "derived" &&
      typeof definition.spec?.timeColumnId === "string"
        ? definition.spec.timeColumnId
        : null,
  };
}

/**
 * The Analytics matrix: one row per metric definition, one column per recent
 * period, scoped by the selected lens.
 *
 * `lens: null` is the Life lens — every LIVE area (unlocked, not archived) in
 * vault order, its definitions in definition order. A named lens answers that
 * one live area; an archived or unknown slug answers an empty matrix with a
 * problem instead of throwing, because a stale link is not a server fault.
 *
 * `count` is how many columns the caller wants (the page asks for 8); one extra
 * older window is read so the oldest column can still show a delta.
 */
export async function getAnalyticsMatrix(
  root: string,
  input: GetAnalyticsMatrixInput,
): Promise<Result<AnalyticsMatrix>> {
  try {
    if (!isReviewCadence(input.cadence)) {
      return { ok: false, error: `Unknown review cadence: ${String(input.cadence)}` };
    }
    const cadence = input.cadence;
    const now = new Date();
    const asOf = now.toISOString();
    const weekStartDay = await readWeekStartDay(root);
    const count = normaliseCount(input.count);

    const periodChain = await buildPeriods(root, cadence, count, weekStartDay);
    if (!periodChain.ok) return { ok: false, error: periodChain.error };
    const windows = periodChain.value;
    // The head is the extra older window; the columns are everything after it.
    const periods = windows.slice(1);

    const listed = await listDomains(root);
    if (!listed.ok) return { ok: false, error: listed.error };
    const lens = typeof input.lens === "string" && input.lens.trim() ? input.lens.trim() : null;

    const problems: string[] = [];
    const areas: Array<{ slug: string; name: string }> = [];
    if (lens === null) {
      for (const area of liveAreas(listed.value)) {
        areas.push({ slug: area.slug, name: area.meta.name });
      }
    } else {
      const found = listed.value.find((area) => area.slug === lens);
      if (!found) {
        return {
          ok: true,
          value: {
            cadence,
            lens,
            periods,
            rows: [],
            problems: [`Area not found: ${lens}`],
            asOf,
          },
        };
      }
      if (!liveAreas([found]).length) {
        return {
          ok: true,
          value: {
            cadence,
            lens,
            periods,
            rows: [],
            problems: [
              `Area ${found.meta.name} (${found.slug}) is not a live area (it is locked or archived); its metrics are not shown.`,
            ],
            asOf,
          },
        };
      }
      areas.push({ slug: found.slug, name: found.meta.name });
    }

    const rows: AnalyticsMetricRow[] = [];
    for (const area of areas) {
      const definitions = await listMetricDefinitions(root, area.slug);
      if (!definitions.ok) {
        problems.push(`${area.slug}: ${definitions.error}`);
        continue;
      }
      for (const problem of definitions.value.problems) problems.push(problem.reason);
      if (definitions.value.metrics.length === 0) continue;
      // Read the events table's minted column ids ONCE per area, without
      // creating it: a read must not write. A missing database simply means
      // every events definition in this area has no rows yet.
      const metricsDb = await getDatabase(root, area.slug, METRICS_DATABASE_ID);
      const eventColumns = metricsDb.ok ? eventColumnIds(metricsDb.value) : null;
      for (const definition of definitions.value.metrics) {
        const row = await answerDefinition(
          root,
          area.slug,
          definition,
          windows,
          eventColumns,
          now,
          problems,
        );
        row.areaName = area.name;
        rows.push(row);
      }
    }

    return { ok: true, value: { cadence, lens, periods, rows, problems, asOf } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A stored event cell read as a finite number; a corrupt cell reads as 0. */
function eventNumber(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * One events metric's logged rows for one window, newest first.
 *
 * This is the cell panel's read: it answers only for an `events` definition
 * (a derived metric has no rows of its own), reads the area's `metrics` database
 * WITHOUT creating it, filters by the definition's `eventKey` and returns the
 * dates inside `[start, end]` inclusive. The minted column ids ride along so the
 * renderer can edit a row through the standard row path without knowing the
 * registry.
 */
export async function listMetricEvents(
  root: string,
  input: ListMetricEventsInput,
): Promise<Result<MetricEvents>> {
  try {
    const area = typeof input.area === "string" ? input.area.trim() : "";
    if (!area) return { ok: false, error: "An area slug is required" };
    const metricId = typeof input.metricId === "string" ? input.metricId.trim() : "";
    if (!metricId) return { ok: false, error: "A metric id is required" };
    if (!isValidLocalIsoDate(input.start) || !isValidLocalIsoDate(input.end)) {
      return {
        ok: false,
        error: `Invalid date window: ${String(input.start)} → ${String(input.end)} — use YYYY-MM-DD`,
      };
    }
    if (input.start > input.end) {
      return { ok: false, error: `Invalid date window: start ${input.start} is after end ${input.end}` };
    }

    const read = await getMetric(root, area, metricId);
    if (!read.ok) return { ok: false, error: read.error };
    const definition = read.value;
    if (definition.source !== "events") {
      return {
        ok: false,
        error: `"${definition.label}" is a derived metric: it reads its own database and has no logged events. Only events metrics list events.`,
      };
    }
    const eventKey = definition.eventKey ?? "";

    const database = await getDatabase(root, area, METRICS_DATABASE_ID);
    if (!database.ok) {
      return {
        ok: false,
        error: `The ${area} Metrics database is not there (${database.error}); a definition's rows live in it.`,
      };
    }
    const columns = eventColumnIds(database.value);
    if (!columns) {
      return {
        ok: false,
        error:
          "The metrics database is missing one of its columns (date, metric, value, note); " +
          "restore the database before listing events.",
      };
    }

    const listed = await listRows(root, area, METRICS_DATABASE_ID);
    if (!listed.ok) return { ok: false, error: listed.error };
    const rows: Array<MetricEventRow & { createdAt: string }> = [];
    for (const row of listed.value) {
      const key = String(row.cells[columns.metric] ?? "");
      if (key !== eventKey) continue;
      const date = String(row.cells[columns.date] ?? "");
      if (!isValidLocalIsoDate(date) || date < input.start || date > input.end) continue;
      const note = row.cells[columns.note];
      rows.push({
        rowId: row.id,
        date,
        value: eventNumber(row.cells[columns.value]),
        note: typeof note === "string" ? note : "",
        createdAt: row.createdAt,
      });
    }
    // Newest first: the event date decides, and two events on one date keep the
    // order they were logged in, newest first.
    rows.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      return b.rowId.localeCompare(a.rowId);
    });
    return {
      ok: true,
      value: {
        areaSlug: area,
        metricId: definition.id,
        eventKey,
        databaseId: METRICS_DATABASE_ID,
        columns,
        rows: rows.map(({ rowId, date, value, note }) => ({ rowId, date, value, note })),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
