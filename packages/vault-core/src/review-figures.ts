import { listDomains } from "./domains.ts";
import { isDomainLive } from "./domain-databases.ts";
import { unlockedAreas } from "./domain-lens.ts";
import { todayLocalIso } from "./map/dates.ts";
import {
  getMetricsSummary,
  listMetricDefinitions,
  metricDisplayValue,
} from "./metrics.ts";
import {
  type MetricFormatting,
  type MetricSummary,
  type ReviewFigureOutcome,
  type ReviewMetricFigureDirective,
  type ReviewMetricsOverallDirective,
} from "./types.ts";

/**
 * The app-written figures on a review page (2026-11-26 metrics design, §10.4).
 *
 * Phase 4 gave an area its metric definitions. This module turns them into the
 * markdown a review page carries, on Start:
 *
 *  - one figure per definition on that area's page, found by
 *    `<!-- lifequest:metric:<definitionId> -->` and refreshed in place;
 *  - one cross-domain table on the overall page (including daily, which is one
 *    overall page), found by `<!-- lifequest:metrics:overall -->`.
 *
 * Two properties are the point of the design:
 *
 *  1. **Found by marker, never by heading.** The operator's prose in the same
 *     section is never touched, and a second Start rewrites its own block instead
 *     of appending a second copy.
 *  2. **Honest about time.** A review window opens before its period ends, so a
 *     figure prints the window it read, `period to date` when the pass ran
 *     before that window closed, and the as-of minute of the read. A number in
 *     a report with no window is a claim, not a measurement.
 *
 * A figure is deliberately NOT a snapshot directive. A directive is the
 * operator's own fence carrying a view spec; a figure is rendered from the
 * area's metric definition through `getMetricsSummary` — one aggregation path,
 * no second query language. The snapshot machinery still serves hand-written
 * `lifequest-snapshot` fences beside the figures.
 */

/** Per-figure markers: `<!-- lifequest:metric:<definitionId> -->`. */
export function metricOpenMarker(definitionId: string): string {
  return `<!-- lifequest:metric:${definitionId} -->`;
}

export function metricCloseMarker(definitionId: string): string {
  return `<!-- /lifequest:metric:${definitionId} -->`;
}

/** The overall page's cross-domain block. */
export const METRICS_OVERALL_ID = "metrics:overall";

export function metricsOverallOpenMarker(): string {
  return `<!-- lifequest:metrics:overall -->`;
}

export function metricsOverallCloseMarker(): string {
  return `<!-- /lifequest:metrics:overall -->`;
}

/** The marker id a definition's figure is found by. */
export function metricFigureId(definitionId: string): string {
  return `metric:${definitionId}`;
}

/** Figures live under a page's own Look-back, the first common heading. */
export const FIGURE_SECTION = "Look-back";

/** `1234.5` → `1,234.5`, with the definition's decimals and affixes. */
export function formatMetricNumber(
  value: number,
  formatting: MetricFormatting | null = null,
): string {
  if (!Number.isFinite(value)) return "0";
  const max = Math.min(Math.max(Math.trunc(formatting?.decimals ?? 2), 0), 6);
  // Round through toFixed on the ABSOLUTE value so a number that rounds to zero
  // can never print "-0": the sign is decided from the rounded number.
  const rounded = Number(Math.abs(value).toFixed(max));
  const [whole, fraction] = rounded.toFixed(max).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction && /[1-9]/.test(fraction)
    ? `${grouped}.${fraction.replace(/0+$/, "")}`
    : grouped;
  const prefix = formatting?.prefix ?? "";
  const suffix = formatting?.suffix ?? "";
  return `${value < 0 && rounded !== 0 ? "-" : ""}${prefix}${trimmed}${suffix}`;
}

/**
 * A unit suffix, the way the snapshot renderer already writes one: a currency
 * code prints in parentheses (`5,000 (ZAR)`), a word unit after the number
 * (`3 sessions`). Unit words are free text (spec §10.1); a three-letter
 * uppercase code is the ledger's own convention for a currency.
 */
export function metricUnitSuffix(unit: string): string {
  const trimmed = unit.trim();
  if (!trimmed) return "";
  if (/^[A-Z]{3}$/.test(trimmed)) return ` (${trimmed})`;
  return ` ${trimmed}`;
}

function shownValue(summary: MetricSummary): number | null {
  return metricDisplayValue(summary.value, summary.formatting);
}

/** The one value line of a figure; `null` is "no rows", never a fabricated 0. */
export function metricValueText(summary: MetricSummary): string {
  const shown = shownValue(summary);
  if (shown === null) return "_No rows in this window._";
  return `${formatMetricNumber(shown, summary.formatting)}${metricUnitSuffix(summary.unit)}`;
}

/** `2026-11-27T15:59:xx` → `2026-11-27 15:59`, local, minute precision. */
export function formatMetricAsOf(asOf: string): string {
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return asOf;
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${todayLocalIso(at)} ${hh}:${mm}`;
}

/**
 * True when the read ran before the window closed. The review window opens
 * before the period ends (weekly on its last day, monthly on the second-last,
 * …), so the honest label is "period to date" — the as-of line says how far the
 * data reaches.
 */
export function isPeriodToDate(asOf: string, windowEnd: string): boolean {
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return false;
  return todayLocalIso(at) < windowEnd;
}

export function metricWindowLabel(
  window: { start: string; end: string },
  asOf: string,
): string {
  return `${window.start} → ${window.end}${
    isPeriodToDate(asOf, window.end) ? " (period to date)" : ""
  }`;
}

/** Where a figure's rows came from, in the operator's words. */
export function metricProvenanceText(summary: MetricSummary): string {
  if (summary.source === "events") {
    const key = summary.provenance.eventKey?.trim();
    return key
      ? `the metrics database (metric \`${key}\`)`
      : "the metrics database";
  }
  const database = summary.provenance.databaseId;
  return database ? `the ${database} database` : "the source database";
}

/**
 * One figure's markdown, between its markers.
 *
 * The shape is the contract in the design's §10.4: bold label and the window on
 * one line, the value (or the honest "no rows" line) under it, then the as-of
 * instant and the source. The label is the definition's own label — a figure
 * whose heading disagrees with the definition it reads is the drift Phase 4
 * removed.
 */
export function renderMetricFigure(summary: MetricSummary): string {
  return [
    `**${summary.label}** · ${metricWindowLabel(summary.window, summary.asOf)}`,
    "",
    metricValueText(summary),
    "",
    `_As of ${formatMetricAsOf(summary.asOf)} · Source: ${metricProvenanceText(summary)}_`,
  ].join("\n");
}

/** One table row of the overall block. */
export type MetricOverviewRow = {
  /** The live area's name, as the notebook's tab carries it. */
  area: string;
  summary: MetricSummary;
};

function tableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function overviewValueCell(summary: MetricSummary): string {
  const shown = metricDisplayValue(summary.value, summary.formatting);
  if (shown === null) return "—";
  return `${formatMetricNumber(shown, summary.formatting)}${metricUnitSuffix(summary.unit)}`;
}

/**
 * The delta is the sign of the change between the two DISPLAYED values, with no
 * unit (`+1`, `-1,000`): the value cells already carry the unit, and a delta
 * with a magnitude rule applied to it would describe a different number.
 */
function overviewDeltaCell(summary: MetricSummary): string {
  if (summary.delta === null || summary.delta === undefined) return "—";
  const decimals = summary.formatting?.decimals;
  const text = formatMetricNumber(Math.abs(summary.delta), { decimals });
  if (summary.delta > 0) return `+${text}`;
  if (summary.delta < 0) return `-${text}`;
  return text;
}

/**
 * The overall page's cross-domain table.
 *
 * Rows arrive already ordered — live areas in notebook order, each area's
 * definitions in definition order — because ordering is a calling decision (the
 * notebook knows it, this renderer does not). A window with no rows prints `—`
 * in every numeric cell and never a fabricated 0, and the delta is `—` when
 * either side is missing.
 */
export function renderMetricsOverall(
  rows: ReadonlyArray<MetricOverviewRow>,
): string {
  if (rows.length === 0) return "";
  const first = rows[0]!.summary;
  const out: string[] = [];
  out.push(
    `**Metrics this period** · ${metricWindowLabel(first.window, first.asOf)}`,
  );
  out.push("");
  out.push("| Area | Metric | This period | Previous period | Δ |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const summary = row.summary;
    out.push(
      `| ${tableCell(row.area)} | ${tableCell(summary.label)} | ${overviewValueCell(
        summary,
      )} | ${overviewValueCell({
        ...summary,
        value: summary.previousValue,
        formatting: summary.formatting,
      })} | ${overviewDeltaCell(summary)} |`,
    );
  }
  out.push("");
  out.push(
    `_As of ${formatMetricAsOf(first.asOf)} · Previous period: ${first.previousWindow.start} → ${first.previousWindow.end}_`,
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Placement: by marker, keeping every other line
// ---------------------------------------------------------------------------

type FigureSpan = { headingIndex: number; endIndex: number };

function findFigureSection(lines: string[]): FigureSpan | null {
  for (let i = 0; i < lines.length; i += 1) {
    const h2 = /^##\s+(.+?)\s*$/.exec(lines[i]!);
    if (!h2 || h2[1] !== FIGURE_SECTION) continue;
    let endIndex = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^#{1,2}\s/.test(lines[j]!)) {
        endIndex = j;
        break;
      }
    }
    return { headingIndex: i, endIndex };
  }
  return null;
}

/** Any app-written block's closing marker: where the next block goes after. */
const FIGURE_CLOSE_MARKER =
  /^<!-- \/(?:lifequest:snapshot:.+|lifequest:metric:.+|lifequest:metrics:overall) -->$/;

function blockLines(open: string, close: string, markdown: string): string[] {
  return [open, ...markdown.split("\n"), close];
}

/**
 * Put one block where it belongs: replace it by its own markers, or open the
 * page's Look-back ahead of the operator's prose and after any block a previous
 * pass wrote.
 *
 * Placement is a pure function of the body and the rendered markdown, which is
 * what makes the write retryable: a conflict re-reads the page and places the
 * same figures into the newer body.
 */
export function upsertFigureBlock(
  body: string,
  input: { open: string; close: string; markdown: string },
): { body: string; status: "written" | "unchanged" | "skipped"; reason?: string } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const block = blockLines(input.open, input.close, input.markdown);

  const openAt = lines.indexOf(input.open);
  if (openAt !== -1) {
    const closeAt = lines.indexOf(input.close, openAt + 1);
    const end = closeAt === -1 ? openAt + 1 : closeAt + 1;
    const next = [...lines.slice(0, openAt), ...block, ...lines.slice(end)];
    const joined = next.join("\n");
    return { body: joined, status: joined === body ? "unchanged" : "written" };
  }

  const found = findFigureSection(lines);
  if (!found) {
    return {
      body,
      status: "skipped",
      reason: `this page has no "${FIGURE_SECTION}" section`,
    };
  }

  let at = found.headingIndex + 1;
  while (at < lines.length && lines[at]!.trim() === "") at += 1;
  for (let i = found.headingIndex + 1; i < found.endIndex && i < lines.length; i += 1) {
    if (!FIGURE_CLOSE_MARKER.test(lines[i]!)) continue;
    at = i + 1;
    while (at < lines.length && lines[at]!.trim() === "") at += 1;
  }

  const before = lines.slice(0, at);
  if (before.length > 0 && before[before.length - 1]!.trim() !== "") before.push("");
  const after = lines.slice(at);
  const next = [...before, ...block];
  if (after.length > 0 && after[0]!.trim() !== "") next.push("");
  next.push(...after);
  return { body: next.join("\n"), status: "written" };
}

/**
 * Remove one marker-delimited block, leaving surrounding prose untouched.
 * Also eats the blank line after it so a removal does not leave a hole.
 */
function removeBlockAt(
  lines: string[],
  open: string,
  close: string,
): { lines: string[]; removed: boolean } {
  const openAt = lines.indexOf(open);
  if (openAt === -1) return { lines, removed: false };
  const closeAt = lines.indexOf(close, openAt + 1);
  const end = closeAt === -1 ? openAt + 1 : closeAt + 1;
  const next = [...lines.slice(0, openAt), ...lines.slice(end)];
  if (next[openAt] !== undefined && next[openAt]!.trim() === "" && closeAt !== -1) {
    next.splice(openAt, 1);
  }
  return { lines: next, removed: true };
}

/** Remove the overall block (no definitions to show, or nothing left to say). */
export function removeMetricsOverallBlock(body: string): {
  body: string;
  removed: boolean;
} {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const result = removeBlockAt(
    lines,
    metricsOverallOpenMarker(),
    metricsOverallCloseMarker(),
  );
  return {
    body: result.removed ? result.lines.join("\n") : body,
    removed: result.removed,
  };
}

/**
 * Remove every per-definition figure whose definition no longer exists, while
 * the notebook is unlocked. A figure is the app's own writing, so a definition
 * the operator deleted must stop appearing; the operator's prose around it
 * stays exactly where it was.
 */
export function removeStaleMetricFigures(
  body: string,
  liveDefinitionIds: ReadonlySet<string>,
): { body: string; removed: string[] } {
  let lines = body.replace(/\r\n/g, "\n").split("\n");
  const removed: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^<!-- lifequest:metric:([^ ]+) -->$/.exec(lines[i]!);
    if (!open) continue;
    const id = open[1]!;
    if (liveDefinitionIds.has(id)) continue;
    const result = removeBlockAt(lines, lines[i]!, metricCloseMarker(id));
    if (!result.removed) continue;
    lines = result.lines;
    removed.push(id);
    i -= 1;
  }
  return { body: lines.join("\n"), removed };
}

// ---------------------------------------------------------------------------
// Planning: the definitions a page's pass reads
// ---------------------------------------------------------------------------

/** One rendered figure, with the directive that names it in the pass's result. */
export type PlannedMetricFigure = {
  directive: ReviewMetricFigureDirective;
  markdown: string;
  open: string;
  close: string;
};

export type PlannedOverallBlock = {
  directive: ReviewMetricsOverallDirective;
  markdown: string;
  open: string;
  close: string;
};

/** What a page's figures are, and which figures no longer have a definition. */
export type MetricFigurePlan = {
  figures: PlannedMetricFigure[];
  overall: PlannedOverallBlock | null;
  /** Definitions that exist on this page's area; null when the area is not live. */
  liveDefinitionIds: string[] | null;
  /** True when the overall page has no definitions at all and its block must go. */
  removeOverall: boolean;
  /** Definitions that could not answer, reported rather than thrown. */
  outcomes: ReviewFigureOutcome[];
};

function emptyPlan(): MetricFigurePlan {
  return {
    figures: [],
    overall: null,
    liveDefinitionIds: null,
    removeOverall: false,
    outcomes: [],
  };
}

function failedOutcome(
  definitionId: string,
  reason: string,
  domain: string,
  title: string,
): ReviewFigureOutcome {
  return {
    kind: "metric",
    id: metricFigureId(definitionId),
    definitionId,
    domain,
    section: FIGURE_SECTION,
    title,
    status: "failed",
    reason,
  };
}

/** A malformed definition's file name still names its marker id. */
function idFromProblemFile(file: string): string | null {
  const match = /\/metrics\/([^/]+)\.json$/.exec(file);
  return match ? match[1]! : null;
}

function figureDirective(
  definitionId: string,
  summary: MetricSummary,
  domain: string,
): { directive: ReviewMetricFigureDirective; markdown: string; open: string; close: string } {
  return {
    directive: {
      kind: "metric",
      id: metricFigureId(definitionId),
      definitionId,
      domain,
      section: FIGURE_SECTION,
      title: summary.label,
      unit: summary.unit,
      formatting: summary.formatting,
    },
    markdown: renderMetricFigure(summary),
    open: metricOpenMarker(definitionId),
    close: metricCloseMarker(definitionId),
  };
}

/**
 * The figures on one area page: that area's definitions, in definition order.
 *
 * An archived (not live) area is skipped outright — its page still reads, and
 * its figures stay frozen exactly as they were, because a review of an area the
 * operator has closed is history.
 */
export async function planAreaFigures(
  root: string,
  input: { cadence: "daily" | "weekly" | "monthly" | "quarterly" | "yearly"; period: string; scope: string },
): Promise<MetricFigurePlan> {
  if (!(await isDomainLive(root, input.scope))) return emptyPlan();

  const listed = await listMetricDefinitions(root, input.scope);
  if (!listed.ok) {
    return {
      ...emptyPlan(),
      // A list failure is not per-definition; report it as one failed figure so
      // the operator hears why the area's figures did not refresh.
      outcomes: [
        {
          kind: "metric",
          id: `metrics:${input.scope}`,
          domain: input.scope,
          section: FIGURE_SECTION,
          title: "Figures",
          status: "failed",
          reason: listed.error,
        },
      ],
    };
  }
  const definitions = listed.value.metrics;
  /**
   * Every definition FILE that exists, malformed ones included: a file that
   * cannot answer keeps its last written block frozen (and reports a failure)
   * rather than being swept as "deleted". Only an id with no file at all is
   * stale.
   */
  const liveDefinitionIds = [
    ...definitions.map((definition) => definition.id),
    ...listed.value.problems
      .map((problem) => idFromProblemFile(problem.file))
      .filter((id): id is string => id !== null),
  ];
  const outcomes: ReviewFigureOutcome[] = [];
  for (const problem of listed.value.problems) {
    const id = idFromProblemFile(problem.file);
    if (id) outcomes.push(failedOutcome(id, problem.reason, input.scope, id));
  }
  if (definitions.length === 0) {
    return { ...emptyPlan(), liveDefinitionIds, outcomes };
  }

  const summary = await getMetricsSummary(root, input.scope, {
    cadence: input.cadence,
    period: input.period,
    metricIds: liveDefinitionIds,
  });
  if (!summary.ok) {
    for (const definition of definitions) {
      outcomes.push(
        failedOutcome(definition.id, summary.error, input.scope, definition.label),
      );
    }
    return { ...emptyPlan(), liveDefinitionIds, outcomes };
  }
  const problemsById = new Map(
    summary.value.problems
      .filter((problem) => typeof problem.metricId === "string")
      .map((problem) => [problem.metricId!, problem.reason]),
  );
  const figures: PlannedMetricFigure[] = [];
  for (const metric of summary.value.metrics) {
    const problem = problemsById.get(metric.id);
    if (problem !== undefined) {
      outcomes.push(failedOutcome(metric.id, problem, input.scope, metric.label));
      continue;
    }
    figures.push(figureDirective(metric.id, metric, input.scope));
  }
  return {
    figures,
    overall: null,
    liveDefinitionIds,
    removeOverall: false,
    outcomes,
  };
}

/**
 * The overall page's cross-domain block: one row per definition of every live
 * area, in notebook order then vault order, definitions in definition order.
 *
 * A daily review has no area pages but still gets this table — a day's numbers
 * across the areas are exactly what its one review should show.
 */
export async function planOverallFigures(
  root: string,
  input: {
    cadence: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
    period: string;
    /** The notebook's page order (manifest order); `overall` is skipped. */
    notebookOrder: ReadonlyArray<string>;
  },
): Promise<MetricFigurePlan> {
  const listedDomains = await listDomains(root);
  if (!listedDomains.ok) {
    return {
      ...emptyPlan(),
      outcomes: [
        {
          kind: "overall",
          id: METRICS_OVERALL_ID,
          domain: "",
          section: FIGURE_SECTION,
          title: "Metrics this period",
          status: "failed",
          reason: listedDomains.error,
        },
      ],
    };
  }
  const liveAreas = unlockedAreas(listedDomains.value).map((area) => ({
    slug: area.slug,
    name: area.meta.name,
  }));
  const ordered: Array<{ slug: string; name: string }> = [];
  for (const slug of input.notebookOrder) {
    if (slug === "overall") continue;
    const area = liveAreas.find((candidate) => candidate.slug === slug);
    if (area && !ordered.some((candidate) => candidate.slug === area.slug)) {
      ordered.push(area);
    }
  }
  for (const area of liveAreas) {
    if (!ordered.some((candidate) => candidate.slug === area.slug)) ordered.push(area);
  }

  const outcomes: ReviewFigureOutcome[] = [];
  const rows: MetricOverviewRow[] = [];
  let anyDefinitions = false;

  for (const area of ordered) {
    const listed = await listMetricDefinitions(root, area.slug);
    if (!listed.ok) {
      outcomes.push({
        kind: "overall",
        id: METRICS_OVERALL_ID,
        domain: area.slug,
        section: FIGURE_SECTION,
        title: area.name,
        status: "failed",
        reason: listed.error,
      });
      continue;
    }
    for (const problem of listed.value.problems) {
      const id = idFromProblemFile(problem.file);
      if (id) outcomes.push(failedOutcome(id, problem.reason, area.slug, id));
    }
    const definitions = listed.value.metrics;
    // A malformed definition file still EXISTS — it is not "there are no
    // definitions any more", so the overall table must not be swept away.
    if (listed.value.problems.length > 0) anyDefinitions = true;
    if (definitions.length === 0) continue;
    anyDefinitions = true;
    const summary = await getMetricsSummary(root, area.slug, {
      cadence: input.cadence,
      period: input.period,
      metricIds: definitions.map((definition) => definition.id),
    });
    if (!summary.ok) {
      for (const definition of definitions) {
        outcomes.push(
          failedOutcome(definition.id, summary.error, area.slug, definition.label),
        );
      }
      continue;
    }
    const problemsById = new Map(
      summary.value.problems
        .filter((problem) => typeof problem.metricId === "string")
        .map((problem) => [problem.metricId!, problem.reason]),
    );
    for (const metric of summary.value.metrics) {
      const problem = problemsById.get(metric.id);
      if (problem !== undefined) {
        outcomes.push(failedOutcome(metric.id, problem, area.slug, metric.label));
        continue;
      }
      rows.push({ area: area.name, summary: metric });
    }
  }

  const markdown = renderMetricsOverall(rows);
  const overall: PlannedOverallBlock | null = markdown
    ? {
        directive: {
          kind: "overall",
          id: METRICS_OVERALL_ID,
          domain: "",
          section: FIGURE_SECTION,
          title: "Metrics this period",
        },
        markdown,
        open: metricsOverallOpenMarker(),
        close: metricsOverallCloseMarker(),
      }
    : null;
  return {
    figures: [],
    overall,
    liveDefinitionIds: null,
    // "No definitions at all" is the removal rule; an area that exists but
    // could not answer leaves its frozen block alone rather than erasing it.
    removeOverall: !anyDefinitions,
    outcomes,
  };
}
