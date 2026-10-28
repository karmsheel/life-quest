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
/**
 * How the four aggregate drawings differ, in the words the model is shown.
 *
 * The important sentence is the first one: `presentation` is a DRAWING. The
 * dataset is the query, and the four aggregate drawings all read the same one,
 * so moving between them must never require the model to rewrite a groupBy.
 */
const PRESENTATION_DESCRIPTION =
  "How this object is DRAWN. It never changes the data: metric, table, bar and line all read the " +
  "same dataset, so a card can be shown as a table and then as a chart without its groupBy or " +
  "measure moving. Choose by what the operator is asking: 'metric' for one headline number; " +
  "'table' when exact values or a lookup matter; 'bar' to compare categories or periods against " +
  "each other; 'line' for a trend over time (best with a date groupBy and a timeBucket); 'list' " +
  "or 'table' with `columns` to print the rows themselves. A line over categories is allowed, but " +
  "say why if the operator asked for a trend and there is no date to plot.";

/**
 * When a card needs several objects, and how to compose them.
 *
 * A model that has never seen `from` will compute an average of monthly totals
 * by hand and paste the number, which is exactly the picture-that-cannot-update
 * the live-dashboard work removed. The guidance is attached to the `blocks`
 * field, where the model is already reading about several objects.
 */
const BLOCKS_DESCRIPTION =
  "A card made of several OBJECTS: one entry each, up to 8. Use it for a summary that needs more " +
  "than one figure (a metric beside its table), for two views of one dataset, or for an object " +
  "built on another. Each object may name another database of the SAME domain as its " +
  "databaseId; an object that omits it reads the card's database. An object with `from` does not read a database at all — it folds an EARLIER " +
  "object's rows, which is how 'the average of these monthly totals' stays live: {\"id\":\"avg\", " +
  "\"title\":\"Average month\",\"presentation\":\"metric\",\"from\":\"months\",\"measure\":\"avg\"}. " +
  "Objects draw under one card title, in order. A summary that is one figure plus one table is " +
  "ONE card, not two views.";

const LIST_COLUMNS_SCHEMA = {
  type: "array",
  description:
    "The columns a ROW object prints, in order — which database columns the rows show, each " +
    "headed by the column's own name. Name 1 to 6, e.g. ['date','payee','category','amount']. " +
    "Naming columns is what makes an object raw: it then draws as 'list' or 'table' and takes no " +
    "groupBy, no timeBucket and no meaningful measure. Omit for an aggregate.",
  items: {
    type: "string",
    description: "A column id of this database, e.g. 'date'. A relation prints its target's name.",
  },
} as const;

/** The drawing details a model can name, and the only values that will draw. */
const VIEW_DISPLAY_SCHEMA = {
  type: "object",
  description:
    "How the object looks, never what it holds. Omit for the app's defaults. Set these when the " +
    "operator asks for a colour scheme, a legend, axis captions, or values printed on the marks. " +
    "Colours are a NAMED palette, not hex values, so a skin repaint still reaches the card.",
  properties: {
    palette: {
      type: "string",
      enum: ["accent", "warm", "cool", "mono"],
      description:
        "'accent' (default: the product's own colours), 'warm' (terracotta/amber/red), 'cool' " +
        "(blue/green), or 'mono' (one ink at six strengths). Series take the palette in order.",
    },
    legend: {
      type: "boolean",
      description:
        "Draw a colour key under the chart. Defaults to true when the object has several series.",
    },
    xLabel: {
      type: "string",
      description: "A short caption for the x-axis, e.g. 'Month'. Not the card's title.",
    },
    yLabel: {
      type: "string",
      description: "A short caption for the y-axis, e.g. 'Spend (ZAR)'.",
    },
    valueLabels: {
      type: "boolean",
      description: "Print each value on its bar or beside its point. Useful for a short series.",
    },
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
      description: PRESENTATION_DESCRIPTION,
    },
    databaseId: {
      type: "string",
      description:
        "The database THIS object reads, when it is not the card's. It must belong to the same " +
        "domain as the card (a view lives in one domain). Omit to read the card's database. Use " +
        "it to put two subjects in one card (a transactions table and an accounts count), but " +
        "keep each object's column ids inside its own database.",
    },
    from: {
      type: "string",
      description:
        "Build this object on another object's rows instead of a database. Name an EARLIER " +
        "object's id. The object folds those rows with its own `measure`: 'sum' adds them, 'avg' " +
        "averages them (the average of monthly totals), 'count' counts them, 'last' takes the " +
        "last. A derived object takes no groupBy, timeWindow, filters, seriesBy or " +
        "measureColumnId. This is how an average of totals stays live.",
    },
    seriesBy: {
      type: "string",
      description:
        "Split each group into series by this category column (select, relation, text or " +
        "boolean), e.g. groupBy 'date' with timeBucket 'month' and seriesBy 'category' for one " +
        "line per category. Requires measure 'sum' or 'count' and an aggregate. A chart gets a " +
        "legend and one colour per series; a table gets a column per series plus a total.",
    },
    display: VIEW_DISPLAY_SCHEMA,
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
        "The column whose values become the rows, e.g. 'date' or 'category'. Omit for one total " +
        "(and omit for a row object, which prints its own rows). A metric may group: the number " +
        "it draws is then the fold over those groups, so the same object can be a table and a " +
        "headline. A row object must not group.",
    },
    timeBucket: {
      type: "string",
      enum: BUCKETS,
      description:
        "Collapse a date groupBy into periods: 'day', 'week' (Monday start, labelled 2026-W41) or " +
        "'month' (labelled 2026-10). Needs a groupBy that is a date column. Use it for any table " +
        "or chart whose x-axis is time.",
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
    "A saved dashboard card, described as LIVE DATA OBJECTS — never as a picture. The card re-runs " +
    "this every time it is drawn or the vault changes, so a spec carries no totals and no " +
    "formatting: no currency symbols, no thousands separators, no markdown, and no prose in a " +
    "title. " +
    "ONE object: set the query fields at the top level. SEVERAL objects: add a non-empty `blocks` " +
    "array; each entry is one object of the same card, and each may read a different database or " +
    "build on an earlier object with `from`. Whatever an object omits is inherited from the " +
    "top-level fields (except when it names its own database, or is derived). " +
    "The QUERY is the data; `presentation` and `display` are only how it is drawn, which is why " +
    "the operator can switch a card between table and chart without losing its grouping. Choose " +
    "the drawing for the question: a metric for one headline number, a table for exact values, " +
    "bars to compare categories or periods, a line for a trend over time, rows (`columns`) when " +
    "the operator wants the transactions themselves. If the operator asks what chart to use, say " +
    "which and why before saving it.",
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
        "e.g. 'finance:transactions'. It is the default for every object; an object may name its " +
        "own databaseId instead.",
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
        "How the card draws when it has no blocks, and the default for objects that omit their " +
        "own. " +
        PRESENTATION_DESCRIPTION,
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
        "The column whose values become the rows, e.g. 'date' or 'category'. Omit for one total. " +
        "A metric may group; the number it draws is then the fold over those groups.",
    },
    timeBucket: {
      type: "string",
      enum: BUCKETS,
      description:
        "Collapse a date groupBy into periods: 'day', 'week' (Monday start, labelled 2026-W41) or " +
        "'month' (labelled 2026-10). Needs a date groupBy. This is how a weekly table is asked for.",
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
    seriesBy: VIEW_BLOCK_SCHEMA.properties.seriesBy,
    display: VIEW_DISPLAY_SCHEMA,
    span: VIEW_BLOCK_SCHEMA.properties.span,
    blocks: {
      type: "array",
      description: BLOCKS_DESCRIPTION,
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
  palette: ["accent", "warm", "cool", "mono"],
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
  rowTable: Record<string, unknown>;
  today: Record<string, unknown> | null;
  averagePerWeek: Record<string, unknown> | null;
  averagePerMonth: Record<string, unknown> | null;
  seriesChart: Record<string, unknown> | null;
  averageOfMonths: Record<string, unknown> | null;
  dateColumnId: string | null;
  numberColumnId: string | null;
  categoryColumnId: string | null;
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

  // The same rows, under a table caption: a row object's other drawing. Shown
  // beside the listing because "table" and "list" are the same dataset, and a
  // model that thought a table had to be an aggregate would rewrite the query.
  const rowTable: Record<string, unknown> = {
    ...list,
    title: "Recent rows (table)",
    presentation: "table",
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

  // A category column, for the two objects that need a second dimension: a
  // chart split into series, and the months table a derived average folds.
  const category =
    db.columns.find(
      (c) => c.type === "select" || c.type === "relation" || c.type === "text",
    ) ?? null;

  // The composition the operator's own question asks for — a table of monthly
  // totals, and beside it the average of THOSE totals. It is one card, and the
  // metric is an object with `from`, not a number computed by hand.
  const averageOfMonths: Record<string, unknown> | null =
    date && number
      ? {
          databaseId: db.id,
          title: "Monthly spend and its average",
          presentation: "table",
          groupBy: date.id,
          timeBucket: "month",
          timeColumnId: date.id,
          timeWindow: { kind: "previous-months", months: 4 },
          measure: "sum",
          measureColumnId: number.id,
          blocks: [
            {
              id: "months",
              title: "Month by month",
              presentation: "table",
              groupBy: date.id,
              timeBucket: "month",
              timeColumnId: date.id,
              timeWindow: { kind: "previous-months", months: 4 },
              measure: "sum",
              measureColumnId: number.id,
            },
            {
              id: "average",
              title: "Average month",
              presentation: "metric",
              from: "months",
              measure: "avg",
            },
          ],
        }
      : null;

  // A trend split by category, with the chart details a model can otherwise
  // forget to offer: a legend, axis captions, and values printed on the marks.
  const seriesChart: Record<string, unknown> | null =
    date && number && category
      ? {
          databaseId: db.id,
          title: "Spending by month and category",
          presentation: "line",
          groupBy: date.id,
          timeBucket: "month",
          timeColumnId: date.id,
          timeWindow: { kind: "last-months", months: 6 },
          measure: "sum",
          measureColumnId: number.id,
          seriesBy: category.id,
          display: { legend: true, xLabel: "Month", yLabel: "Spend", palette: "accent" },
        }
      : null;

  return {
    metric,
    table,
    list,
    rowTable,
    today,
    averagePerWeek: periodAverage("week"),
    averagePerMonth: periodAverage("month"),
    seriesChart,
    averageOfMonths,
    dateColumnId: date?.id ?? null,
    numberColumnId: number?.id ?? null,
    categoryColumnId: category?.id ?? null,
  };
}
