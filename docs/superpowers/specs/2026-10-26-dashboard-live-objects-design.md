# Cards as live data objects: the query is the data, the drawing is a choice

**Status:** implemented
**Date:** 2026-10-26
**Touches:** `packages/vault-core/src/types.ts`, `views.ts`, `view-schema.ts`,
`views-tools.ts`, `apps/desktop/src/components/ui/ViewCard.tsx`,
`view-block-edit.ts`, `apps/desktop/src/styles/global.css`,
`apps/desktop/electron/companion-profile.ts`,
`apps/desktop/electron/companion-client.ts`,
`apps/desktop/e2e/dashboard-objects.*`, `apps/desktop/tests/dashboard-objects-*`

## 1. The report, and what it actually was

> when I look at the spending by month card and I click these various tabs which
> oscillate between table and bar and line and then come back, the data seems to
> be lost and now it's just showing plain transactions with no details.

The card had not lost its numbers. Its **query had been rewritten to ask a
different question**. A presentation switch was implemented as a retarget:
choosing Bar on a one-number object gave it the database's first date column as a
`groupBy` and left `timeBucket` null, so the object became one bar per
transaction date. Choosing Table afterwards kept that grouping. The operator saw
a table of dates and amounts — "plain transactions" — and a metric that no
longer matched the table beside it.

The old design was internally consistent about the wrong thing: `presentation`
was both "what this object computes" and "how it is drawn". A metric had to have
no groupBy; a bar had to have one; a line had to have a date groupBy with a
bucket. Moving between them therefore had to move the query.

The same shape also made three things the operator asked for impossible without
a human doing arithmetic: an average of monthly totals, two figures from
different databases in one card, and a chart with a legend, colours and axis
captions.

## 2. The model

A card is a list of **objects** (the stored field is still `blocks`, so old files
keep working). Each object has three separable parts:

| Part | Fields | Changes when |
|---|---|---|
| What it reads | `databaseId`, `filters`, `timeWindow`, `timeColumnId`, `columns` | the operator wants different rows |
| What it computes | `groupBy`, `timeBucket`, `measure`, `measureColumnId`, `per`, `convertToZar`, `seriesBy`, `from` | the operator wants a different calculation |
| How it is drawn | `presentation`, `display` | the operator wants a different picture, **and nothing else** |

One card may hold up to 8 objects. An object that omits `databaseId` reads the
card's database; an object that names one reads that database instead — within
the same domain, because a view and its databases belong to one domain.

There are two kinds of object:

- a **database object** reads rows and either prints them (an object with
  `columns`, drawn as `list` or `table`) or folds them into label/value groups;
- a **derived object** names an earlier object in `from` and folds THAT object's
  rows. It reads no database and takes no grouping, window or filter of its own.
  This is how "the average of these monthly totals" is expressed as a query
  rather than as a number someone computed once.

A derived object's fold uses the same measure vocabulary: `sum` adds the source's
rows, `avg` averages them (the average of the monthly totals), `count` counts
them, `last` takes the last. The rows are kept as well as the summary, so the
derived object can still be drawn as a table; a metric draws the summary.

## 3. Presentation is a drawing

`presentation` no longer determines whether an object is valid. The data rules
are:

- an object with `columns` is a ROW object and must not group, bucket or split;
- any other object is an aggregate; it may group or not, and all four aggregate
  drawings (`metric`, `table`, `bar`, `line`) read the exact same result;
- `timeBucket` requires a date `groupBy`;
- `avg-per` is one number for one window: no grouping, no series, bounded window.

An aggregate result now carries, from the same run:

- `rows`: one label/value pair per group (the same rows for every drawing);
- `summary`: the headline number the groups fold to (total, average of totals,
  latest), which a metric draws;
- `series` / `seriesRows`: the per-series detail when `seriesBy` split a group.

The switch is now a small menu behind one control on each object, not a row of
tabs: the object IS the drawing the operator asked for, so the alternatives are
an option rather than furniture on the card. Choosing one writes only
`presentation`. The operator's click can no longer change the query, and a
drawing the data cannot hold (a chart of a row object) is not offered.

## 4. Series and display

`seriesBy` names a category column (select, relation, text or boolean) and splits
a `sum` or `count` into series. Up to six series are drawn, ranked by absolute
total; the tail is pooled as "Other" with a warning, so a wide category column
still has a readable legend and a total that adds up.

A series table gets one column per series plus the row total. A chart gets one
bar cluster or one polyline per series, a legend, and one colour per series.
A missing (label, series) pair is an em dash in a table and zero on a chart —
"no spend here" is not "spend of nothing".

`display` is styling only:

```json
{ "palette": "accent | warm | cool | mono",
  "legend": true, "xLabel": "Month", "yLabel": "Spend (ZAR)",
  "valueLabels": true }
```

Palettes are names, not hex, so a skin repaint recolours a saved card. The chart
now draws a zero line for negative values, four y-axis ticks with compact
labels, grid lines, optional axis captions, optional value labels, and per-series
colours with a legend.

## 5. What the agent is told

A capability a model cannot see is one it will work around. The additions are on
every surface the companion reads:

| Surface | What it now carries |
|---|---|
| `VIEW_SPEC_SCHEMA` | `databaseId` (per object), `from`, `seriesBy`, `display`; presentation described as a drawing; chart-choice guidance |
| `viewSpecTemplate` | `rowTable`, `seriesChart`, and `averageOfMonths` — a composed card with a months table and a derived average |
| `specFix.rules` | presentation is a drawing; row objects vs aggregates; `from`; `seriesBy`; display; chart choice |
| `save_view` / `get_view` / `preview_view` | objects and transformations, the `from` pattern, display, and the rule that a presentation edit changes nothing else |
| `COMPANION_SOUL` (stamp 7) and the in-app prompt | the same, in the operator's words |

`preview_view` and `save_view` replies now carry each object's `summary` and
`series`, so the companion can report the headline and the split without a second
round trip.

## 6. Live, still

The card re-runs on the vault revision, on focus, and when the local day turns —
unchanged from the live-dashboard work. What changed is that a DERIVED object is
part of that run, so an average of monthly totals follows a new row with no write
to the card. The new rig asserts that by writing a row and re-running the same
file.

## 7. What is tested, and how each claim can fail

**`tests/dashboard-objects-e2e.test.ts`** → `e2e/artifacts/dashboard-objects.json`
— the engine, on a real vault:

- four months of totals (200/300/300/100), an October row outside every window,
  a derived average of 225, a series split Food/Travel/Rent, a metric from a
  second database, and a six-row listing;
- Table → Bar → Line → Metric → Table leaves the rows and the summary identical
  and leaves `groupBy`, `timeBucket`, `measure`, `measureColumnId` and
  `timeWindow` untouched on disk;
- the reported regression as its own case: a one-number object cycled through
  every drawing stays one row of 900, never a row per transaction date;
- a new row moves the months table and the derived average with no write to the
  card;
- the door advertises the new fields and `preview_view` answers with `summary`
  and `series`;
- four refusals each name the fix: an unknown `from`, a row object that groups,
  a series split on `avg`, and a derived object that groups.

**`tests/dashboard-objects-ui-e2e.test.ts`** →
`e2e/artifacts/dashboard-objects-ui.json` + `.png` — the renderer in a real
Electron layout engine: five objects in one card, a series table with a total
column, a line chart with three distinct palette colours, a legend, y-axis ticks,
grid lines, axis captions and value labels, the derived metric saying "average",
the second-database metric, and the raw listing. It presses Table → Bar → Line →
Table and requires the table to return unchanged while every saved block keeps
its query and its display.

## 8. Deliberately not in this slice

- A per-card refresh button: the card already re-runs on writes, focus and the
  day, so a manual refresh would be a second, weaker path to the same read.
- Arbitrary formulas or cross-object arithmetic beyond `from`'s fold.
- Multiple measures in one object, annotations, and conditional formatting.
- A pie/donut drawing: the chart-choice guidance recommends bar for
  composition, which reads better than a pie at card size.
