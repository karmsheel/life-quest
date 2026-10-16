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
const PRESENTATIONS = ["table", "bar", "line", "metric", "list"];
const MEASURES = ["sum", "count", "last", "avg", "avg-per"];
const PERIODS = ["day", "week", "month"];
const WINDOWS = ["all", "today", "this-week", "this-month", "last-30-days", "this-year"];

/**
 * What every `timeWindow` description says, in one place.
 *
 * `today` and `this-week` lead the list after `all` because they are the windows
 * a model gets WRONG BY DEFAULT: asked for "today's spending", it has no word for
 * today and writes the date it is looking at into a `filters` entry instead. That
 * card recomputes correctly forever and never changes, which is how the operator
 * came to report "the Today's Expense value hasn't changed in days". The rule
 * against freezing a date is stated here, where the model reads the field.
 *
 * The two month objects are here for the same kind of reason. "The average spend
 * per month over the PREVIOUS 4 months" has no week count that says it honestly
 * — 16 weeks is not 4 months — and a `custom` window would freeze the card on
 * four literal months. A model with no word for "the previous 4 months" answers
 * with the closest thing it has, which is the wrong number said confidently.
 */
const TIME_WINDOW_DESCRIPTION =
  "The window the rows are read from: 'all' (default), 'today', 'this-week' (Monday " +
  "through today), 'this-month', 'last-30-days', 'this-year'. For a trailing week count pass an " +
  'object instead: {"kind":"last-weeks","weeks":8} — 8 Monday-start weeks ending with today\'s. ' +
  'For trailing CALENDAR months, the current one included, pass {"kind":"last-months","months":6}. ' +
  'For the whole months BEFORE the current one — "the previous 4 months, not including this one" ' +
  '— pass {"kind":"previous-months","months":4}; that is the window a monthly average wants, and ' +
  'it moves to the next four months on its own when the month turns. ' +
  'For explicit dates pass {"kind":"custom","start":"2026-01-01","end":"2026-03-31"}. ' +
  "The named windows are LIVE: they are recomputed from the current date every time the card is " +
  "drawn, so 'today' means today and tomorrow it means tomorrow. NEVER write a date into a " +
  "`filters` entry to mean 'today', 'yesterday', or 'this week' — that freezes the card on one " +
  "day forever. Use a filter with a literal date only when the operator names that specific date.";

/**
 * What every `measure` description says, in one place: the distinction between
 * the average ROW and the average PERIOD is the whole reason `avg-per` exists,
 * and it is the one a model conflates.
 */
const MEASURE_DESCRIPTION =
  "'sum' (default), 'count', 'avg' (the average ROW — total divided by how many rows), 'last' " +
  "(the newest row's value), or 'avg-per' (the average PERIOD — the window's total divided by " +
  "the days, weeks or months that window spans). Use 'avg-per' for \"the average spend per " +
  "week/month\": it takes `per` ('day' | 'week' | 'month'), needs a bounded timeWindow, and is a " +
  "metric (presentation 'metric', no groupBy). 'avg' is NOT that — it divides by the number of " +
  "transactions.";

/**
 * The columns a listing prints. Only a `list` uses this: an aggregate's two
 * columns come from its fold, and a listing that named none would draw an empty
 * table, so the shape is refused rather than drawn blank.
 */
const LIST_COLUMNS_SCHEMA = {
  type: "array",
  description:
    "The `list` presentation's columns, in order — which database columns the listing prints, " +
    "each headed by the column's own name. Name 1 to 6, e.g. ['date','payee','category','amount']. " +
    "Omit for every other presentation.",
  items: {
    type: "string",
    description: "A column id of this database, e.g. 'date'. A relation prints its target's name.",
  },
} as const;

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
        "groupBy; 'line' needs a date groupBy plus a timeBucket; 'list' is not an aggregate at all " +
        "— it prints one line per row, newest first, in its own `columns`, and takes no measure and " +
        "no groupBy. Use 'list' for \"show me the recent transactions\", and 'table' for \"a table " +
        "of totals\".",
    },
    measure: {
      type: "string",
      enum: MEASURES,
      description: MEASURE_DESCRIPTION,
    },
    measureColumnId: {
      type: "string",
      description:
        "The number column to measure, e.g. 'amount'. Omit for a count measure, or for an " +
        "'avg-per' that averages the NUMBER OF ROWS per period rather than an amount.",
    },
    per: {
      type: "string",
      enum: PERIODS,
      description:
        "The period an 'avg-per' measure divides the window's total by: 'day', 'week' or " +
        "'month'. Required by 'avg-per' (e.g. per 'month' with timeWindow " +
        '{"kind":"previous-months","months":4} gives the average spend per month over the ' +
        "previous 4 months) and refused on every other measure.",
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
      description: TIME_WINDOW_DESCRIPTION,
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
    columns: LIST_COLUMNS_SCHEMA,
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
      description:
        "1 = the board sizes the card to its content, 2 = the card's full width. Omit unless the " +
        "card needs the full row.",
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
        "date groupBy plus a timeBucket; 'list' is not an aggregate at all — it prints one line per " +
        "row, newest first, in its own `columns`, and takes no measure and no groupBy. Use 'list' " +
        'for "show me the recent transactions", and \'table\' for "a table of totals".',
    },
    measure: {
      type: "string",
      enum: MEASURES,
      description: MEASURE_DESCRIPTION,
    },
    measureColumnId: {
      type: "string",
      description:
        "The number column to measure, e.g. 'amount'. Omit for a count measure, or for an " +
        "'avg-per' that averages the NUMBER OF ROWS per period rather than an amount.",
    },
    per: {
      type: "string",
      enum: PERIODS,
      description:
        "The period an 'avg-per' measure divides the window's total by: 'day', 'week' or " +
        "'month'. Required by 'avg-per' (e.g. per 'month' with timeWindow " +
        '{"kind":"previous-months","months":4} gives the average spend per month over the ' +
        "previous 4 months) and refused on every other measure.",
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
      description: TIME_WINDOW_DESCRIPTION,
    },
    filters: {
      type: "array",
      description: "Rows must match every filter. Empty is the normal case.",
      items: VIEW_BLOCK_SCHEMA.properties.filters.items,
    },
    sort: VIEW_BLOCK_SCHEMA.properties.sort,
    limit: VIEW_BLOCK_SCHEMA.properties.limit,
    convertToZar: VIEW_BLOCK_SCHEMA.properties.convertToZar,
    columns: LIST_COLUMNS_SCHEMA,
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
  /** The `per` of an `avg-per` measure: how long the period being averaged is. */
  per: PERIODS,
  timeBucket: BUCKETS,
  timeWindow: [
    ...WINDOWS,
    { kind: "last-weeks", weeks: 8 },
    { kind: "last-months", months: 6 },
    { kind: "previous-months", months: 4 },
    { kind: "custom", start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
  ],
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
  list: Record<string, unknown>;
  today: Record<string, unknown> | null;
  averagePerWeek: Record<string, unknown> | null;
  averagePerMonth: Record<string, unknown> | null;
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

  // The listing is the third shape a spec can take, and the one a model reaches
  // for when the operator says "recent" without saying "totals": it names the
  // columns it prints instead of a measure and a groupBy, and carries no
  // measure at all. Built from this database's own columns so the ids are real.
  const listColumns = [
    date?.id,
    ...db.columns
      .filter((c) => c.type === "relation" || c.type === "text")
      .slice(0, 2)
      .map((c) => c.id),
    number?.id,
  ].filter((id): id is string => Boolean(id));
  const list: Record<string, unknown> = {
    databaseId: db.id,
    title: "Recent rows",
    presentation: "list",
    ...(listColumns.length > 0 ? { columns: listColumns.slice(0, 4) } : {}),
    ...windowed,
  };

  // The fourth shape, and the one the reported bug needed: a metric over TODAY,
  // as a window rather than as a date written into a filter. It is only possible
  // when the database has a date column to anchor the window on, and it is
  // deliberately shown beside the other three — a model that has never seen the
  // word "today" in this vocabulary is a model that freezes a literal date.
  const today: Record<string, unknown> | null = date
    ? {
        databaseId: db.id,
        title: "Today",
        presentation: "metric",
        measure: number ? "sum" : "count",
        ...(number ? { measureColumnId: number.id } : {}),
        timeColumnId: date.id,
        timeWindow: "today",
      }
    : null;

  // The two shapes the reported limitations needed, and the reason they are shown
  // beside the others: a model that has never seen "avg-per" or
  // "previous-months" in this vocabulary cannot build the card the operator
  // asked for, and will answer with the nearest thing it has — `avg` (the average
  // transaction) over `this-year`, which is a different number said confidently.
  //
  // The week example takes an explicit `last-weeks` window rather than a month,
  // and the month example takes `previous-months` so the current, partial month
  // is not averaged in. Both are needed: a per-period average is only as honest
  // as the window it divides by.
  const periodAverage = (per: "week" | "month"): Record<string, unknown> | null =>
    date
      ? {
          databaseId: db.id,
          title: per === "week" ? "Average per week" : "Average per month",
          presentation: "metric",
          measure: "avg-per",
          per,
          ...(number ? { measureColumnId: number.id } : {}),
          timeColumnId: date.id,
          timeWindow:
            per === "week"
              ? { kind: "last-weeks", weeks: 4 }
              : { kind: "previous-months", months: 4 },
        }
      : null;

  return {
    metric,
    table,
    list,
    today,
    averagePerWeek: periodAverage("week"),
    averagePerMonth: periodAverage("month"),
    dateColumnId: date?.id ?? null,
    numberColumnId: number?.id ?? null,
  };
}
