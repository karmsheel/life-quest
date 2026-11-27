import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { isDomainLive, getDatabase } from "./domain-databases.ts";
import { applyViewDefaults, validateViewSpecForVault } from "./views.ts";
import {
  USER_ACTOR,
  type Actor,
  type MetricDefinition,
  type MetricDefinitionProblem,
  type MetricFormatting,
  type MetricMagnitude,
  type Result,
  type ViewSpec,
} from "./types.ts";

/**
 * Metric definitions (2026-11-26 metrics design, §10).
 *
 * A definition is the operator's named measurement — label, unit, source,
 * aggregation, target, formatting — stored as ONE JSON per metric under
 * `domains/<slug>/metrics/<id>.json`, exactly like a saved view. That shape is
 * deliberate: a per-area `metrics.json` would be rewritten wholesale and could
 * drop a concurrent edit, and rows in the SQLite book would put config in data
 * (the book is exported, not git-committed). One file per metric is the pattern
 * the tree already trusts for views, and it keeps definition history in git.
 *
 * The rows a metric reads are ordinary rows: an `events` metric logs dated rows
 * into the area's `metrics` database, and a `derived` metric runs the view spec
 * the definition carries. Both are folded by the same view engine, so a figure,
 * the Analytics matrix and a dashboard card can never disagree about a number.
 */

/** A metric id is a filename segment: one leading alphanumeric, then safe chars. */
export const METRIC_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** The id and name of the per-area table that carries manually logged events. */
export const METRICS_DATABASE_ID = "metrics";
export const METRICS_DATABASE_NAME = "Metrics";

const MAX_LABEL_CHARS = 120;
const MAX_UNIT_CHARS = 40;
const MAX_FORMAT_CHARS = 12;

/**
 * A refused metric operation, in the vocabulary the tool door can hand back.
 *
 * `EXISTS` is its own code rather than a string a caller has to match: creating
 * a definition applies immediately (spec §10.6), but CHANGING one goes through a
 * Decision and that governance is still open (spec §17.1), so the store refuses
 * an overwrite outright instead of inventing a path the product has not decided.
 */
export type MetricErrorCode = "MALFORMED" | "EXISTS" | "NOT_FOUND" | "FAILED";

export type MetricResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MetricErrorCode; error: string };

export type DefineMetricInput = Omit<
  MetricDefinition,
  "schemaVersion" | "domainSlug" | "createdBy" | "createdAt" | "updatedAt"
>;

/** The display sign rule a metric's number is printed with; never affects a query. */
export function metricMagnitude(
  formatting: MetricFormatting | null | undefined,
): MetricMagnitude | null {
  return formatting?.magnitude ?? null;
}

/**
 * `value` as the operator sees it: the magnitude rule applied, nothing else.
 * Formatting (decimals, prefix, suffix, grouping) is the renderer's business;
 * this is the one transformation that changes the sign of the number shown, and
 * it is kept here so a figure and the Analytics matrix cannot apply it twice.
 */
export function metricDisplayValue(
  value: number | null,
  formatting: MetricFormatting | null | undefined,
): number | null {
  if (value === null) return null;
  const magnitude = metricMagnitude(formatting);
  if (magnitude === "abs") return Math.abs(value);
  if (magnitude === "negate") return -value;
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function validFormatting(raw: unknown): MetricFormatting | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) return null;
  const out: MetricFormatting = {};
  if (raw.decimals !== undefined && raw.decimals !== null) {
    if (typeof raw.decimals !== "number" || !Number.isInteger(raw.decimals)) return null;
    if (raw.decimals < 0 || raw.decimals > 6) return null;
    out.decimals = raw.decimals;
  }
  for (const key of ["prefix", "suffix"] as const) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.length > MAX_FORMAT_CHARS) return null;
    out[key] = v;
  }
  if (raw.magnitude !== undefined && raw.magnitude !== null) {
    if (raw.magnitude !== "abs" && raw.magnitude !== "negate") return null;
    out.magnitude = raw.magnitude;
  }
  return out;
}

/**
 * One definition read out of a file, checked tolerantly.
 *
 * A malformed definition is REPORTED — `getMetric`/`listMetricDefinitions` say
 * which file and why — never thrown: one bad file must not take a list, a
 * review Start or the Analytics page down with it. Only the fields the design
 * names are kept, so an unknown key someone typed does not travel onwards.
 */
function coerceDefinition(
  raw: unknown,
  slug: string,
  fileId: string,
): { definition: MetricDefinition } | { reason: string } {
  if (!isPlainObject(raw)) return { reason: "the file does not hold a JSON object" };
  if (raw.schemaVersion !== 1) {
    return { reason: `unsupported schemaVersion: ${String(raw.schemaVersion)}` };
  }
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!METRIC_ID_PATTERN.test(id)) return { reason: `invalid id: ${JSON.stringify(raw.id)}` };
  if (id !== fileId) return { reason: `the id "${id}" does not match its file name "${fileId}"` };
  const domainSlug = typeof raw.domainSlug === "string" ? raw.domainSlug : "";
  if (!domainSlug) return { reason: "domainSlug is required" };
  if (domainSlug !== slug) {
    return { reason: `domainSlug "${domainSlug}" does not match its area "${slug}"` };
  }
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) return { reason: "label is required" };
  const unit = typeof raw.unit === "string" ? raw.unit.trim() : "";
  if (!unit) return { reason: "unit is required" };
  const source = raw.source;
  if (source !== "derived" && source !== "events") {
    return { reason: `source must be "derived" or "events"` };
  }
  const aggregation = raw.aggregation;
  if (
    aggregation !== "sum" &&
    aggregation !== "count" &&
    aggregation !== "last" &&
    aggregation !== "avg"
  ) {
    return { reason: `aggregation must be sum, count, last or avg` };
  }
  let direction: MetricDefinition["direction"];
  if (raw.direction !== undefined && raw.direction !== null) {
    if (
      raw.direction !== "higher-is-better" &&
      raw.direction !== "lower-is-better" &&
      raw.direction !== "neutral"
    ) {
      return { reason: "direction is not one of higher-is-better, lower-is-better, neutral" };
    }
    direction = raw.direction;
  }
  let target: number | null | undefined;
  if (raw.target !== undefined) {
    if (raw.target === null) target = null;
    else if (typeof raw.target === "number" && Number.isFinite(raw.target)) target = raw.target;
    else return { reason: "target must be a finite number or null" };
  }
  const formatting =
    raw.formatting === undefined ? null : validFormatting(raw.formatting);
  if (raw.formatting !== undefined && formatting === null) {
    return { reason: "formatting has an unknown shape" };
  }
  let spec: Omit<ViewSpec, "schemaVersion"> | undefined;
  if (source === "derived") {
    if (!isPlainObject(raw.spec)) return { reason: "a derived metric needs a spec object" };
    spec = raw.spec as unknown as Omit<ViewSpec, "schemaVersion">;
  } else {
    if (raw.spec !== undefined) return { reason: "an events metric takes no spec" };
    if (typeof raw.eventKey !== "string" || !raw.eventKey.trim()) {
      return { reason: "an events metric needs a non-empty eventKey" };
    }
  }
  const createdBy = raw.createdBy;
  if (createdBy !== "user" && createdBy !== "agent") {
    return { reason: `createdBy must be "user" or "agent"` };
  }
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  if (!createdAt || !updatedAt) return { reason: "createdAt and updatedAt are required" };

  return {
    definition: {
      schemaVersion: 1,
      id,
      domainSlug,
      label,
      unit,
      source,
      ...(spec ? { spec } : {}),
      ...(source === "events"
        ? { eventKey: (raw.eventKey as string).trim() }
        : {}),
      aggregation,
      ...(direction ? { direction } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(formatting ? { formatting } : {}),
      createdBy,
      createdAt,
      updatedAt,
    },
  };
}

/** The vault-relative file name for a read failure the operator has to open. */
function relMetricsFile(slug: string, id: string): string {
  return `domains/${slug}/metrics/${id}.json`;
}

/**
 * Read one definition. `NOT_FOUND` covers both "no such file" and "this id is
 * not a legal file name", because neither names a metric the operator can fix;
 * an unreadable file is reported with its own reason rather than thrown.
 */
export async function getMetric(
  root: string,
  slug: string,
  id: string,
): Promise<MetricResult<MetricDefinition>> {
  if (!METRIC_ID_PATTERN.test(id)) {
    return { ok: false, code: "NOT_FOUND", error: `Metric not found: ${id}` };
  }
  try {
    // The builder validates the segment and throws on a traversing slug/id
    // (VAULT-06); inside the try so this read keeps its Result contract.
    const file = vaultPaths(root).domainMetric(slug, id);
    const raw = await fs.readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return {
        ok: false,
        code: "FAILED",
        error: `Metric definition ${relMetricsFile(slug, id)} is malformed: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      };
    }
    const coerced = coerceDefinition(parsed, slug, id);
    if ("reason" in coerced) {
      return {
        ok: false,
        code: "FAILED",
        error: `Metric definition ${relMetricsFile(slug, id)} is malformed: ${coerced.reason}`,
      };
    }
    return { ok: true, value: coerced.definition };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, code: "NOT_FOUND", error: `Metric not found: ${id}` };
    }
    return { ok: false, code: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Every definition in one area, plus the files that could not be read.
 *
 * A bad file is skipped and named in `problems`; the list itself still answers,
 * because the alternative — one malformed definition hiding every good one — is
 * exactly the failure a tolerant read exists to prevent.
 */
export async function listMetricDefinitions(
  root: string,
  slug: string,
): Promise<MetricResult<{ metrics: MetricDefinition[]; problems: MetricDefinitionProblem[] }>> {
  let names: string[];
  try {
    names = (await fs.readdir(vaultPaths(root).domainMetricsDir(slug)))
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch {
    // No metrics directory yet is an empty list: a fresh area has no metrics.
    return { ok: true, value: { metrics: [], problems: [] } };
  }
  const metrics: MetricDefinition[] = [];
  const problems: MetricDefinitionProblem[] = [];
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    const read = await getMetric(root, slug, id);
    if (read.ok) {
      metrics.push(read.value);
    } else {
      problems.push({ file: relMetricsFile(slug, id), reason: read.error });
    }
  }
  return { ok: true, value: { metrics, problems } };
}

/**
 * Whether a spec answers ONE value.
 *
 * A metric is a single number, so a composed card, a grouped table, a series
 * split, a row listing or a top-N limit are all refused with the shape that
 * would pass named in the message. The field checks run before the full view
 * validation so the operator hears the metric-shaped reason rather than a
 * generic view error; `validateViewSpecForVault` then checks the query itself
 * (the database, its columns, the filters, the window).
 */
async function validateDerivedSpec(
  root: string,
  slug: string,
  rawSpec: unknown,
): Promise<MetricResult<Omit<ViewSpec, "schemaVersion">>> {
  if (!isPlainObject(rawSpec)) {
    return { ok: false, code: "MALFORMED", error: "A derived metric needs a spec object" };
  }
  const written = rawSpec;
  if (Array.isArray(written.blocks) && written.blocks.length > 0) {
    return {
      ok: false,
      code: "MALFORMED",
      error:
        "A metric spec is ONE query, so it cannot be a composed view. Drop `blocks` and give the " +
        "definition the single query that answers its one number.",
    };
  }
  if (written.groupBy !== undefined && written.groupBy !== null) {
    return {
      ok: false,
      code: "MALFORMED",
      error:
        "A metric answers one value, so its spec cannot group: drop groupBy (a table of groups " +
        "is a dashboard card, not a metric).",
    };
  }
  if (written.seriesBy !== undefined && written.seriesBy !== null) {
    return {
      ok: false,
      code: "MALFORMED",
      error: "A metric answers one value, so its spec cannot split into series: drop seriesBy.",
    };
  }
  if (written.presentation !== "metric") {
    return {
      ok: false,
      code: "MALFORMED",
      error: 'A metric spec must draw as one number: set presentation to "metric".',
    };
  }
  if (
    written.limit !== undefined &&
    written.limit !== null &&
    written.limit !== 12
  ) {
    return {
      ok: false,
      code: "MALFORMED",
      error: "A metric answers one value, not a ranked list: drop the spec's limit.",
    };
  }
  if (written.timeWindow !== undefined && written.timeWindow !== null) {
    // A metric is always read over a review period (and the one before it), so
    // its window is rewritten at read time; a date column is what that rewrite
    // needs. Refusing here means a spec cannot be saved that will fail at the
    // first figure instead.
    const windowed =
      typeof written.timeWindow !== "string" || written.timeWindow !== "all";
    if (windowed && (written.timeColumnId === undefined || written.timeColumnId === null)) {
      return {
        ok: false,
        code: "MALFORMED",
        error:
          "A metric is read over a period, so its spec needs a timeColumnId (the date column the " +
          "period window acts on).",
      };
    }
  }
  let spec: Omit<ViewSpec, "schemaVersion">;
  try {
    spec = applyViewDefaults(rawSpec as Omit<ViewSpec, "schemaVersion">);
  } catch (e) {
    return {
      ok: false,
      code: "MALFORMED",
      error: `The metric spec could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!(await isDomainLive(root, slug))) {
    return { ok: false, code: "NOT_FOUND", error: `Domain not found or archived: ${slug}` };
  }
  if (typeof spec.databaseId !== "string" || !spec.databaseId) {
    return { ok: false, code: "MALFORMED", error: "The metric spec needs a databaseId" };
  }
  const dbRes = await getDatabase(root, slug, spec.databaseId);
  if (!dbRes.ok) {
    return { ok: false, code: "MALFORMED", error: `Database not found: ${spec.databaseId}` };
  }
  const checked = await validateViewSpecForVault(root, slug, {
    ...(spec as Omit<ViewSpec, "schemaVersion">),
    schemaVersion: 1,
  } as ViewSpec, dbRes.value);
  if (!checked.ok) return { ok: false, code: "MALFORMED", error: checked.error };
  return { ok: true, value: spec };
}

/**
 * A malformed write input is refused before anything touches disk. The checks
 * are the §10.1 field contract: an id that is a safe filename segment, a live
 * area, a label and unit, the source's required half (spec or eventKey, never
 * both), the allowed aggregations, and typed target/formatting.
 */
async function validateDefinitionInput(
  root: string,
  slug: string,
  input: DefineMetricInput,
): Promise<MetricResult<MetricDefinition>> {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!METRIC_ID_PATTERN.test(id)) {
    return {
      ok: false,
      code: "MALFORMED",
      error:
        `Invalid metric id: ${JSON.stringify(input.id)}. Use letters, digits, dots, dashes and ` +
        "underscores, starting with a letter or digit — it is also the definition's file name.",
    };
  }
  if (!(await isDomainLive(root, slug))) {
    return { ok: false, code: "NOT_FOUND", error: `Domain not found or archived: ${slug}` };
  }
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) return { ok: false, code: "MALFORMED", error: "A metric needs a label" };
  if (label.length > MAX_LABEL_CHARS) {
    return { ok: false, code: "MALFORMED", error: `The metric label is longer than ${MAX_LABEL_CHARS} characters` };
  }
  const unit = typeof input.unit === "string" ? input.unit.trim() : "";
  if (!unit) {
    return {
      ok: false,
      code: "MALFORMED",
      error: 'A metric needs a unit ("minutes", "sessions", "ZAR", …): a number with no unit is decoration.',
    };
  }
  if (unit.length > MAX_UNIT_CHARS) {
    return { ok: false, code: "MALFORMED", error: `The metric unit is longer than ${MAX_UNIT_CHARS} characters` };
  }
  const source = input.source;
  if (source !== "derived" && source !== "events") {
    return { ok: false, code: "MALFORMED", error: 'source must be "derived" or "events"' };
  }
  const aggregation = input.aggregation;
  if (
    aggregation !== "sum" &&
    aggregation !== "count" &&
    aggregation !== "last" &&
    aggregation !== "avg"
  ) {
    return {
      ok: false,
      code: "MALFORMED",
      error: "aggregation must be one of sum, count, last, avg",
    };
  }
  if (input.direction !== undefined && input.direction !== null) {
    if (
      input.direction !== "higher-is-better" &&
      input.direction !== "lower-is-better" &&
      input.direction !== "neutral"
    ) {
      return {
        ok: false,
        code: "MALFORMED",
        error: "direction must be higher-is-better, lower-is-better or neutral",
      };
    }
  }
  if (input.target !== undefined && input.target !== null) {
    if (typeof input.target !== "number" || !Number.isFinite(input.target)) {
      return { ok: false, code: "MALFORMED", error: "target must be a finite number or null" };
    }
  }
  let formatting: MetricFormatting | null = null;
  if (input.formatting !== undefined) {
    formatting = validFormatting(input.formatting);
    if (input.formatting !== null && formatting === null) {
      return {
        ok: false,
        code: "MALFORMED",
        error:
          "formatting must be {decimals?: 0..6, prefix?: string, suffix?: string, " +
          'magnitude?: "abs" | "negate" | null}',
      };
    }
  }

  let spec: Omit<ViewSpec, "schemaVersion"> | undefined;
  if (source === "derived") {
    if (input.spec === undefined || input.spec === null) {
      return {
        ok: false,
        code: "MALFORMED",
        error: "A derived metric needs a spec — the query that answers it.",
      };
    }
    if (input.eventKey !== undefined) {
      return { ok: false, code: "MALFORMED", error: "A derived metric takes no eventKey" };
    }
    const checked = await validateDerivedSpec(root, slug, input.spec);
    if (!checked.ok) return checked;
    spec = checked.value;
  } else {
    if (input.spec !== undefined) {
      return { ok: false, code: "MALFORMED", error: "An events metric takes no spec" };
    }
    if (typeof input.eventKey !== "string" || !input.eventKey.trim()) {
      return {
        ok: false,
        code: "MALFORMED",
        error:
          "An events metric needs an eventKey — the `metric` cell value its logged rows carry, " +
          'e.g. "training".',
      };
    }
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      id,
      domainSlug: slug,
      label,
      unit,
      source,
      ...(spec ? { spec } : {}),
      ...(source === "events" ? { eventKey: (input.eventKey as string).trim() } : {}),
      aggregation,
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(formatting ? { formatting } : {}),
      // Attribution is the caller's, never the payload's: a tool that let a
      // request field set createdBy could have an agent's write read as the
      // operator's.
      createdBy: "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * In-process serialisation per definition file.
 *
 * `defineMetric` is a check-then-write on one path: two concurrent creates of
 * the same id must not both pass the existence check. The engine runs in one
 * Electron main process, so a promise chain keyed by the target file is enough
 * — the same reasoning (and shape) as the registry lock in domain-databases.ts.
 */
const metricLocks = new Map<string, Promise<unknown>>();

async function withMetricLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = metricLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  metricLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    return await run;
  } finally {
    if (metricLocks.get(key) === undefined) metricLocks.delete(key);
  }
}

/**
 * Create one definition. Applies immediately — creating is the "define it now"
 * act (spec §10.6) — but an existing id is REFUSED with `EXISTS`: editing or
 * deleting a definition changes what a review measures, and that goes through a
 * Decision the product has not settled yet (spec §17.1). Refusing is the only
 * honest answer until it has.
 */
export async function defineMetric(
  root: string,
  slug: string,
  input: DefineMetricInput,
  actor: Actor = USER_ACTOR,
): Promise<MetricResult<MetricDefinition>> {
  let file: string;
  try {
    file = vaultPaths(root).domainMetric(slug, typeof input.id === "string" ? input.id.trim() : "");
  } catch (e) {
    return { ok: false, code: "MALFORMED", error: e instanceof Error ? e.message : String(e) };
  }
  return withMetricLock(file, async () => {
    try {
      const validated = await validateDefinitionInput(root, slug, input);
      if (!validated.ok) return validated;
      try {
        await fs.access(file);
        return {
          ok: false,
          code: "EXISTS",
          error: `A metric with id "${validated.value.id}" already exists in ${slug}. Editing or deleting a definition waits on a Decision, so this was not changed.`,
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const now = new Date().toISOString();
      const definition: MetricDefinition = {
        ...validated.value,
        createdBy: actor.type === "user" ? "user" : "agent",
        createdAt: now,
        updatedAt: now,
      };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteFile(file, `${JSON.stringify(definition, null, 2)}\n`);
      await appendLog(root, {
        domainSlug: slug,
        type: "metric.created",
        summary: `Defined metric "${definition.label}" in ${slug}`,
        payload: {
          metricId: definition.id,
          source: definition.source,
          aggregation: definition.aggregation,
        },
        actor,
      });
      return { ok: true, value: definition };
    } catch (e) {
      return { ok: false, code: "FAILED", error: e instanceof Error ? e.message : String(e) };
    }
  });
}
