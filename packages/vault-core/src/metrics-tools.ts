import type { MapToolDef } from "./map/tools.ts";
import { listDomains } from "./domains.ts";
import { isLiveAreaMeta } from "./domain-lens.ts";
import {
  defineMetric,
  getMetricsSummary,
  listMetricDefinitions,
  logMetric,
  type DefineMetricInput,
} from "./metrics.ts";
import { isReviewCadence } from "./period.ts";
import type { Actor, MetricAggregation, MetricSource } from "./types.ts";

/**
 * The metric tools (2026-11-26 metrics design, §10.3/§10.6).
 *
 * Four verbs, mirroring the review and database tools: define a metric, log one
 * dated event, list the area's metrics, and read the period summary the review
 * figures and the Analytics matrix will draw. They own no UI and no query
 * engine — every number comes from the same `runView` path a dashboard card
 * uses, so a figure, a matrix cell and a card cannot disagree.
 */
export const METRICS_TOOL_DEFS: MapToolDef[] = [
  {
    name: "define_metric",
    description:
      "Define a metric for one area: a named measurement the operator owns, with a label, a unit, a source and an aggregation. " +
      'source "derived" runs ONE view spec over any database in the area — pass spec {databaseId, title, presentation:"metric", ' +
      'groupBy:null, timeColumnId, filters, measure, measureColumnId} (one number per period; no blocks, grouping, series or ' +
      'limit). source "events" logs dated rows with log_metric: pass eventKey (the metric cell value those rows carry) and no ' +
      'spec. aggregation is sum, count, last or avg. Creating applies immediately and is logged; redefining an existing id is ' +
      "REFUSED (EXISTS) because editing a definition goes through a Decision — use a new id.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string", description: "The live area the metric belongs to, e.g. 'health'." },
        id: {
          type: "string",
          description: "Stable id and file name: letters, digits, dots, dashes, underscores, starting with a letter or digit.",
        },
        label: { type: "string", description: "The operator-facing name, e.g. 'Training minutes'." },
        unit: { type: "string", description: "Display-only unit: 'minutes', 'sessions', 'pages', 'ZAR', …" },
        source: { type: "string", enum: ["derived", "events"] },
        aggregation: { type: "string", enum: ["sum", "count", "last", "avg"] },
        spec: {
          type: "object",
          description:
            'derived metrics only: one view spec with presentation "metric", groupBy null, a timeColumnId and a measure. ' +
            "Its window is rewritten to the review period at read time.",
        },
        eventKey: {
          type: "string",
          description: 'events metrics only: the metric cell value logged rows carry, e.g. "training".',
        },
        direction: { type: "string", enum: ["higher-is-better", "lower-is-better", "neutral"] },
        target: { type: "number", description: "Optional target number; null means none." },
        formatting: {
          type: "object",
          description:
            "Display only: {decimals?: 0..6, prefix?: string, suffix?: string, magnitude?: 'abs' | 'negate'}. " +
            "magnitude prints the sign differently (Cash out) and never changes the query or the stored number.",
          properties: {
            decimals: { type: "number" },
            prefix: { type: "string" },
            suffix: { type: "string" },
            magnitude: { type: "string", enum: ["abs", "negate"] },
          },
        },
      },
      required: ["domainSlug", "id", "label", "unit", "source", "aggregation"],
    },
  },
  {
    name: "log_metric",
    description:
      "Log ONE dated event on an events metric: one training session, one hour read, one prayer. " +
      "date defaults to today (YYYY-MM-DD), value defaults to 1, note is optional. The row lands in the area's Metrics " +
      "database under the definition's eventKey; two definitions on the same eventKey (sessions = count, minutes = sum) " +
      "read the same rows. Applies immediately and is logged. A derived metric cannot be logged — it reads its own database.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        metricId: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD; defaults to today." },
        value: { type: "number", description: "Defaults to 1." },
        note: { type: "string" },
      },
      required: ["domainSlug", "metricId"],
    },
  },
  {
    name: "list_metrics",
    description:
      "List metric definitions from the vault (not values). With domainSlug: that area's metrics; without it: every live " +
      "area's. A malformed definition file is reported in problems rather than thrown. Read-only.",
    parameters: {
      type: "object",
      properties: { domainSlug: { type: "string" } },
    },
  },
  {
    name: "get_metrics_summary",
    description:
      "Read each metric's value for a review period and the previous period of the same cadence, with delta, direction, " +
      "target, formatting, window and as-of. Values come from the same view engine the review figures use. A metric with no " +
      "rows in a window answers value null (and delta null) — never a fabricated zero — and a definition that cannot answer " +
      "(its source database is gone, its spec is no longer runnable) is reported in problems with value null while its healthy " +
      "neighbours still answer. Read-only.",
    parameters: {
      type: "object",
      properties: {
        domainSlug: { type: "string" },
        cadence: { type: "string" },
        period: { type: "string", description: "The period key, e.g. '2026-10-12' weekly or '2026-10' monthly." },
        metricIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of metric ids; omitted reads every definition in the area.",
        },
      },
      required: ["domainSlug", "cadence", "period"],
    },
  },
];

type MetricsToolError = { error: { code: string; message: string } };
type MetricsToolResult = Record<string, unknown> | MetricsToolError;

function toolError(code: string, message: string): MetricsToolError {
  return { error: { code, message } };
}

function requireDomain(args: Record<string, unknown>): string | MetricsToolError {
  const slug = args.domainSlug;
  if (typeof slug !== "string" || !slug.trim()) {
    return toolError("MALFORMED", "domainSlug is required");
  }
  return slug.trim();
}

/** The one shape a tool result uses for a definition, so list and define agree. */
function definitionView(definition: {
  id: string;
  domainSlug: string;
  label: string;
  unit: string;
  source: MetricSource;
  aggregation: MetricAggregation;
  direction?: string;
  target?: number | null;
  formatting?: unknown;
  eventKey?: string;
  spec?: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    id: definition.id,
    domainSlug: definition.domainSlug,
    label: definition.label,
    unit: definition.unit,
    source: definition.source,
    aggregation: definition.aggregation,
    direction: definition.direction ?? null,
    target: definition.target ?? null,
    formatting: definition.formatting ?? null,
    ...(definition.eventKey !== undefined ? { eventKey: definition.eventKey } : {}),
    ...(definition.spec !== undefined ? { spec: definition.spec } : {}),
    createdBy: definition.createdBy,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export async function executeMetricsTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<MetricsToolResult> {
  switch (name) {
    case "define_metric": {
      const slug = requireDomain(args);
      if (typeof slug !== "string") return slug;
      const mapError = (code: string, error: string): MetricsToolError =>
        toolError(code, error);
      const input: DefineMetricInput = {
        id: typeof args.id === "string" ? args.id : "",
        label: typeof args.label === "string" ? args.label : "",
        unit: typeof args.unit === "string" ? args.unit : "",
        source: (typeof args.source === "string" ? args.source : "") as MetricSource,
        aggregation: (typeof args.aggregation === "string"
          ? args.aggregation
          : "") as MetricAggregation,
        ...(args.spec !== undefined && args.spec !== null
          ? { spec: args.spec as DefineMetricInput["spec"] }
          : {}),
        ...(typeof args.eventKey === "string" ? { eventKey: args.eventKey } : {}),
        ...(typeof args.direction === "string"
          ? { direction: args.direction as DefineMetricInput["direction"] }
          : {}),
        ...(args.target !== undefined
          ? { target: typeof args.target === "number" ? args.target : (args.target as null) }
          : {}),
        ...(args.formatting !== undefined && args.formatting !== null
          ? { formatting: args.formatting as DefineMetricInput["formatting"] }
          : {}),
      };
      const defined = await defineMetric(root, slug, input, actor);
      if (!defined.ok) return mapError(defined.code, defined.error);
      return { metric: definitionView(defined.value) };
    }

    case "log_metric": {
      const slug = requireDomain(args);
      if (typeof slug !== "string") return slug;
      const metricId = args.metricId;
      if (typeof metricId !== "string" || !metricId.trim()) {
        return toolError("MALFORMED", "metricId is required");
      }
      const logged = await logMetric(
        root,
        slug,
        metricId.trim(),
        {
          ...(typeof args.date === "string" ? { date: args.date } : {}),
          ...(args.value !== undefined && args.value !== null
            ? { value: args.value as number }
            : {}),
          ...(typeof args.note === "string" ? { note: args.note } : {}),
        },
        actor,
      );
      if (!logged.ok) return toolError(logged.code, logged.error);
      const event = logged.value;
      return {
        event: {
          metricId: event.definition.id,
          eventKey: event.definition.eventKey ?? null,
          rowId: event.rowId,
          date: event.date,
          value: event.value,
          note: event.note,
        },
        metric: definitionView(event.definition),
        databaseId: event.databaseId,
      };
    }

    case "list_metrics": {
      const requested = args.domainSlug;
      if (requested !== undefined && requested !== null) {
        if (typeof requested !== "string" || !requested.trim()) {
          return toolError("MALFORMED", "domainSlug must be a non-empty string");
        }
        const listed = await listMetricDefinitions(root, requested.trim());
        if (!listed.ok) return toolError(listed.code, listed.error);
        return {
          metrics: listed.value.metrics.map(definitionView),
          problems: listed.value.problems,
        };
      }
      // Every live area at once: the Life-scoped Analytics view's inventory.
      const domains = await listDomains(root);
      const liveSlugs = domains.ok
        ? domains.value.filter((d) => isLiveAreaMeta(d.meta)).map((d) => d.slug)
        : [];
      const metrics: Array<Record<string, unknown>> = [];
      const problems: Array<Record<string, unknown>> = [];
      for (const liveSlug of liveSlugs) {
        const listed = await listMetricDefinitions(root, liveSlug);
        if (!listed.ok) continue;
        metrics.push(...listed.value.metrics.map(definitionView));
        problems.push(...listed.value.problems);
      }
      return { metrics, problems };
    }

    case "get_metrics_summary": {
      const slug = requireDomain(args);
      if (typeof slug !== "string") return slug;
      const cadence = args.cadence;
      if (typeof cadence !== "string" || !isReviewCadence(cadence)) {
        return toolError("MALFORMED", `Invalid cadence: ${String(cadence)}`);
      }
      const period = args.period;
      if (typeof period !== "string" || !period.trim()) {
        return toolError("MALFORMED", "period is required");
      }
      let metricIds: string[] | null = null;
      if (args.metricIds !== undefined && args.metricIds !== null) {
        if (!Array.isArray(args.metricIds)) {
          return toolError("MALFORMED", "metricIds must be an array of metric ids");
        }
        metricIds = args.metricIds.filter((id): id is string => typeof id === "string");
      }
      const summary = await getMetricsSummary(root, slug, {
        cadence,
        period: period.trim(),
        metricIds,
      });
      if (!summary.ok) return toolError(summary.code, summary.error);
      return {
        metrics: summary.value.metrics,
        problems: summary.value.problems,
        window: summary.value.window,
        previousWindow: summary.value.previousWindow,
        asOf: summary.value.asOf,
      };
    }

    default:
      return toolError("MALFORMED", "Unknown tool");
  }
}
