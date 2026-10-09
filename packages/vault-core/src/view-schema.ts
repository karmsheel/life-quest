import type { DatabaseMeta } from "./types.ts";

/**
 * The JSON Schema the LifeQuest MCP door advertises for a view spec.
 *
 * This exists because of a measured failure, not for tidiness. Every tool the
 * door registered carried `inputSchema: z.looseObject({})` — a schema with no
 * properties — so a client saw 62 LifeQuest tools that took no arguments at all.
 * The companion then had to invent the vocabulary from prose, and what it
 * invented was wrong in the same way every time: `measure: { field, operator }`,
 * `timeWindow: { operator: "last_7_days" }`, `groupBy: "week"`, and — on every
 * single preview_view and save_view call across six sessions — `spec` passed as a
 * JSON *string* rather than an object, which failed as `spec must be an object`
 * before any of the rest could be judged.
 *
 * So the shape below is the contract the model is shown, and `validateViewSpec`
 * is the contract it is held to. They are deliberately written in the same order
 * and with the same vocabulary so a reader can diff them by eye.
 *
 * House style, matching `DATABASE_TOOL_DEFS`: plain draft-07, `type` always a
 * single string, `required` for documentation, and no `additionalProperties:
 * false` — a stray key is the tool's business to ignore, not the client's to
 * refuse, and the teaching errors in `views-tools.ts` are what correct a wrong
 * one. Nullable fields say "omit" in their description rather than declaring a
 * `["string","null"]` union, because not every function-calling provider accepts
 * a union type.
 */

const BUCKETS = ["day", "week", "month"];
const PRESENTATIONS = ["table", "bar", "line", "metric"];
const MEASURES = ["sum", "count", "last", "avg"];
const WINDOWS = ["all", "this-month", "last-30-days", "this-year"];

/**
 * One panel of a composed card. Every query field is optional here on purpose:
 * a block that omits one inherits it from the spec's top-level query fields, and
 * the schema says so rather than forcing a model to repeat itself.
 */
const VIEW_BLOCK_SCHEMA = {
  type: "object",
  description: "One panel of the card. A spec with `blocks` is one card with several panels.",
  required: ["id", "title", "presentation"],
  properties: {
    id: {
      type: "string",
      description: "A short stable name for this panel, unique in the card, e.g. 'weeks'. Not shown.",
    },
    title: {
      type: "string",
      description: "This panel's own heading, e.g. 'Week by week'. A name, not a sentence.",
    },
    presentation: {
      type: "string",
      enum: PRESENTATIONS,
      description:
        "How this panel draws. 'metric' is one number and must not group; 'table' and 'bar' need a " +
        "groupBy; 'line' needs a date groupBy plus a timeBucket.",
    },
    measure: {
      type: "string",
      enum: MEASURES,
      description: "'sum' (default), 'count', 'avg', or 'last' (the newest row's value).",
    },
    measureColumnId: {
      type: "string",
      description: "The number column to measure, e.g. 'amount'. Omit only for a count measure.",
    },
    groupBy: {
      type: "string",
      description:
        "The column whose values become the rows, e.g. 'date' or 'category'. Omit for a metric panel.",
    },
    timeBucket: {
      type: "string",
      enum: BUCKETS,
      description:
        "Collapse a date groupBy into periods: 'day', 'week' (Monday start, labelled 2026-W41) or " +
        "'month' (labelled 2026-10). Only valid when groupBy is a date column.",
    },
    timeColumnId: {
      type: "string",
      description: "The date column a timeWindow acts on, e.g. 'date'. Required whenever timeWindow is set.",
    },
    timeWindow: {
      type: "string",
      enum: WINDOWS,
      description:
        "The window the rows are read from: 'all' (default), 'this-month', 'last-30-days', " +
        "'this-year'. For a trailing week count pass an object instead: " +
        '{"kind":"last-weeks","weeks":8} — 8 Monday-start weeks ending with today\'s. ' +
        'For explicit dates pass {"kind":"custom","start":"2026-01-01","end":"2026-03-31"}.',
    },
    filters: {
      type: "array",
      description: "Rows must match every filter. Empty is the normal case.",
      items: {
        type: "object",
        required: ["columnId", "op", "value"],
        properties: {
          columnId: { type: "string", description: "A column id of this database, e.g. 'category'." },
          op: {
            type: "string",
            enum: ["eq", "neq", "gt", "gte", "lt", "lte", "in"],
            description: "Comparison. 'in' takes an array value; the others take one value.",
          },
          value: {
            description: "The value to compare against. For a relation column this is the target row id.",
          },
        },
      },
    },
    sort: {
      type: "object",
      description: "Order of the rows the card shows. Defaults to label ascending.",
      required: ["by", "dir"],
      properties: {
        by: { type: "string", enum: ["label", "value"], description: "Sort by the row's label or its number." },
        dir: { type: "string", enum: ["asc", "desc"] },
      },
    },
    limit: {
      type: "number",
      description: "How many rows the card shows, 1 to 50. Default 12; a card has room for about 12.",
    },
    convertToZar: {
      type: "boolean",
      description: "finance:transactions amount measures only: convert USD rows to ZAR at the vault rate.",
    },
    span: {
      type: "number",
      description: "1 = one grid cell, 2 = the card's full width. Omit unless the card needs the full row.",
    },
  },
};

export const VIEW_SPEC_SCHEMA = {
  type: "object",
  description:
    "A saved dashboard card, described as a live query — never as a picture. The card re-runs this " +
    "every time it is drawn, so a spec carries no totals and no formatting: no currency symbols, no " +
    "thousands separators, no markdown, and no prose in a title. " +
    "ONE aggregate: set the query fields at the top level (a metric, or a table/bar/line that groups). " +
    "SEVERAL panels: add a non-empty `blocks` array and each entry is one panel of the same card, " +
    "reading the same database — a metric panel for the headline number plus a table panel for the " +
    "detail is ONE card, not two views. Whatever a block omits is inherited from the top-level fields.",
  required: ["databaseId", "title", "presentation"],
  properties: {
    schemaVersion: {
      type: "number",
      description: "Always 1. Safe to omit: the tool fills it in.",
    },
    databaseId: {
      type: "string",
      description:
        "The database this card reads, exactly as list_databases or get_database reports it, " +
        "e.g. 'finance:transactions'. Every block of a composed card reads this one database.",
    },
    title: {
      type: "string",
      description:
        "The card's heading, e.g. 'Weekly expenses'. A name, not a sentence: no currency symbols, " +
        "no totals, no markdown.",
    },
    presentation: {
      type: "string",
      enum: PRESENTATIONS,
      description:
        "How the card draws when it has no blocks, and the default for blocks that omit their own. " +
        "'metric' is one number and must not group; 'table' and 'bar' need a groupBy; 'line' needs a " +
        "date groupBy plus a timeBucket.",
    },
    measure: {
      type: "string",
      enum: MEASURES,
      description: "'sum' (default), 'count', 'avg', or 'last' (the newest row's value).",
    },
    measureColumnId: {
      type: "string",
      description: "The number column to measure, e.g. 'amount'. Omit only for a count measure.",
    },
    groupBy: {
      type: "string",
      description:
        "The column whose values become the rows, e.g. 'date' or 'category'. Omit for a metric view.",
    },
    timeBucket: {
      type: "string",
      enum: BUCKETS,
      description:
        "Collapse a date groupBy into periods: 'day', 'week' (Monday start, labelled 2026-W41) or " +
        "'month' (labelled 2026-10). This is how a weekly table is asked for.",
    },
    timeColumnId: {
      type: "string",
      description: "The date column a timeWindow acts on, e.g. 'date'. Required whenever timeWindow is set.",
    },
    timeWindow: {
      type: "string",
      enum: WINDOWS,
      description:
        "The window the rows are read from: 'all' (default), 'this-month', 'last-30-days', " +
        "'this-year'. For a trailing week count pass an object instead: " +
        '{"kind":"last-weeks","weeks":8} — 8 Monday-start weeks ending with today\'s. ' +
        'For explicit dates pass {"kind":"custom","start":"2026-01-01","end":"2026-03-31"}.',
    },
    filters: {
      type: "array",
      description: "Rows must match every filter. Empty is the normal case.",
      items: VIEW_BLOCK_SCHEMA.properties.filters.items,
    },
    sort: VIEW_BLOCK_SCHEMA.properties.sort,
    limit: VIEW_BLOCK_SCHEMA.properties.limit,
    convertToZar: VIEW_BLOCK_SCHEMA.properties.convertToZar,
    span: VIEW_BLOCK_SCHEMA.properties.span,
    blocks: {
      type: "array",
      description:
        "A composed card: one panel per entry, at most 8. Use it whenever the operator asks for a " +
        '"summary" that needs more than one figure. Omit it for a single-aggregate card.',
      items: VIEW_BLOCK_SCHEMA,
    },
  },
} as const;

/**
 * The vocabulary every validation failure repeats, so a model that got one field
 * wrong has everything it needs to fix it without another discovery call.
 */
export const VIEW_VOCABULARY = {
  presentation: PRESENTATIONS,
  measure: MEASURES,
  timeBucket: BUCKETS,
  timeWindow: [...WINDOWS, { kind: "last-weeks", weeks: 8 }, { kind: "custom", start: "YYYY-MM-DD", end: "YYYY-MM-DD" }],
} as const;

/**
 * A minimal spec that would validate against THIS database, built from its live
 * columns. It is the "do this instead" half of a validation failure: the model
 * sees the real column ids in a shape it can copy, rather than the enums alone.
 *
 * Two shapes, because the two ways to get it wrong are different: a metric needs
 * a number column and no groupBy, and a table needs a groupBy — preferably the
 * date column with a week bucket, which is what a "summary over time" asks for.
 */
export function viewSpecTemplate(db: DatabaseMeta): {
  metric: Record<string, unknown>;
  table: Record<string, unknown>;
  dateColumnId: string | null;
  numberColumnId: string | null;
} {
  const number = db.columns.find((c) => c.type === "number") ?? null;
  const date = db.columns.find((c) => c.type === "date") ?? null;
  const groupable =
    date ?? db.columns.find((c) => c.type === "select" || c.type === "relation" || c.type === "text") ?? null;

  // Both examples carry the window AND the column it acts on when the database
  // has a date, because "a timeWindow needs a timeColumnId" is the one rule a
  // model gets wrong on its own — it is the only field whose absence makes a
  // windowed card un-runnable — and an example that omits it teaches the mistake.
  const windowed = date
    ? { timeColumnId: date.id, timeWindow: { kind: "last-weeks", weeks: 8 } }
    : {};

  const metric: Record<string, unknown> = {
    databaseId: db.id,
    title: "Total",
    presentation: "metric",
    measure: number ? "sum" : "count",
    ...(number ? { measureColumnId: number.id } : {}),
    ...windowed,
  };

  const table: Record<string, unknown> = {
    databaseId: db.id,
    title: date ? "By week" : "By group",
    presentation: "table",
    measure: number ? "sum" : "count",
    ...(number ? { measureColumnId: number.id } : {}),
    ...(groupable ? { groupBy: groupable.id } : {}),
    ...(date ? { ...windowed, timeBucket: "week" } : {}),
  };

  return {
    metric,
    table,
    dateColumnId: date?.id ?? null,
    numberColumnId: number?.id ?? null,
  };
}
