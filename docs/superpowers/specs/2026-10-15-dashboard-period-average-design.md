# The two figures the vocabulary could not name: a month window, and a period average

**Status:** implemented
**Date:** 2026-10-15
**Touches:** `packages/vault-core/src/views.ts`, `packages/vault-core/src/types.ts`,
`packages/vault-core/src/view-schema.ts`, `packages/vault-core/src/views-tools.ts`,
`apps/desktop/electron/companion-profile.ts`, `apps/desktop/electron/companion-client.ts`,
`apps/desktop/src/components/ui/view-block-edit.ts`,
`apps/desktop/src/components/decisions/DecisionBody.tsx`,
`apps/desktop/e2e/live-dashboard.mjs`, `apps/desktop/e2e/live-dashboard.electron.mjs`

## 1. The two reports, and what each one actually was

> This needs an additional metric - the average spend per month, based on the
> previous 4 months (not including current one). Every month it gets recalculated.
> Can you add it in?

The companion answered, correctly and at length, that it could not. It listed the
live windows it had — `all`, `this-month`, `this-year`, `last-30-days`,
`last-weeks` — and said what is missing: nothing names *the previous 4 months*.
`last-weeks: 16` is roughly four months and not four months; a `custom` window
would pin June–September and never move, which is the opposite of "every month it
gets recalculated". Every option it offered was a worse version of the thing
asked for, so it offered them and waited.

> In the other table (weekly spend), I asked the agent to calculate the average
> spend per week across the last 4 weeks. It was also unable to do this properly.

This one is quieter, because the agent *could* build something. What it could
build was `measure: "avg"` over the last four weeks, and `avg` is the average
**row** — the window's total divided by how many transactions there were. Asked
for the average week, the card answered with the average transaction. That is not
a missing feature arriving as an error; it is a wrong number arriving as a right
one, which is worse.

Both reports are the same fault seen from two sides: the view vocabulary could
describe a total and a row average, and it could count weeks, but it had no word
for a whole-month window and no notion that averaging can be over the calendar
rather than over the rows.

### 1.1 The operator's own two cards, read out of their vault

Both cards are on the Overview board, and both show the fault rather than
describing it.

**"Rolling 4-week expenses"** (the weekly spend table) carries a metric block
with `id: "avg"`, `title: "Average per week"`, `measure: "avg"`,
`measureColumnId: "amount"`, `timeWindow: {"kind":"last-weeks","weeks":4}`. The
companion did exactly what it was asked, with the only measure it had, and the
card says "Average per week" while showing the average **transaction**:

| Figure on that window | Value (operator's vault, 2026-10-15) |
|---|---|
| The average ROW — what the card shows today | **-143.77** |
| The average WEEK — what the title promises | **-1222.09** |

That is not a card that failed to appear. It is a card that is wrong by a factor
of eight and a half, which is worse.

**"Spending by month"** (the monthly spend table) is a composed card whose
panels both carry `timeWindow: {"kind":"last-weeks","weeks":26}` — six months
approximated as twenty-six weeks, so its "Month by month" rows are sliced at
whatever the week grid happens to hit. Its metric panel is a `sum` ("Last 6
months"), because an average per month was not expressible. This is the card the
operator was asking to have a metric added to, and the workaround it already
carries — 26 weeks standing in for 6 months — is the same missing word.

### 1.2 What was then applied to those two cards

Both were repaired in the operator's own vault, through the running app's MCP
door — the companion's own `save_view`, with the view ids from `get_dashboard`,
so each card kept its identity and its pin. `save_view` appends a card's pin, so
the Overview board's order was put back with one `arrange_dashboard` carrying the
pin list read before the writes.

| Card | Block | Before | After |
|---|---|---|---|
| Rolling 4-week expenses | `avg`, "Average per week" | `measure: "avg"` → **-143.77** (the average transaction) | `measure: "avg-per"`, `per: "week"` → **-1222.09** (the average week: -4888.34 over the four week rows beside it) |
| Spending by month | new `average-month`, "Average per month" | absent | `measure: "avg-per"`, `per: "month"`, `{"kind":"previous-months","months":4}` → **-6089.09** (June + July + August + September over four, which are exactly the four whole months of that card's own table) |

The weekly card's own file also carried a `viewId` key inside the spec, left by
the old propose-then-approve flow that wrote a database id where a view id
belonged; it is not a field the app's writer emits and nothing reads it, so it was
dropped in the same pass.

## 2. Two additions, and why each has the shape it has

### 2.1 `{"kind":"last-months","months":n}` and `{"kind":"previous-months","months":n}`

Both are computed from the local calendar day each time the card is drawn, like
every other named window, so neither can freeze.

| Window | On 28 October 2026 | Why |
|---|---|---|
| `{"kind":"last-months","months":4}` | 1 July – 28 October | Trailing calendar months, today's among them and partial. The month-shaped sibling of `last-weeks`. |
| `{"kind":"previous-months","months":4}` | 1 June – 30 September | The whole months BEFORE today's. Steps to 1 July – 31 October on 1 November by itself. |

`previous-months` is the one the operator asked for and the one the card's
divisor depends on. A monthly average computed over a window that contains the
current, partial month reads low on the 1st and climbs all month; excluding the
current month is not a nicety, it is what makes the number comparable with the
month before it.

`last-months` exists because the pair is needed: "the last 6 months" and "the 6
months before this one" are different questions, and a vocabulary that offers
only one of them is a vocabulary a model answers with the wrong one.

### 2.2 `measure: "avg-per"` with `per: "day" | "week" | "month"`

`avg-per` is the average **period**: the window's total divided by the number of
days, weeks or months the window spans. It is the sentence "the average spend per
month" written down.

- It is a **metric**. `presentation` must be `metric` and there is no `groupBy`:
  one number for the whole window. A table grouped by week with a per-week
  average is either a table of totals (`sum` + `timeBucket`) or an average of one
  value per group, and both of those already exist; what did not exist is the
  window-level number, so that is the whole of what this adds.
- The divisor is the **calendar**, not the rows. It comes from the window bounds,
  and it is exactly the number of periods a table over the same window and the
  same `timeBucket` would draw as rows. A month with no spending is a month of
  R0, not a month that did not happen, so it stays in the divisor. That is also
  what keeps the metric honest next to the table beside it: the average times the
  number of buckets is the total.
- `measureColumnId` is **optional**: with one it is the average amount per period,
  without one the average number of ROWS per period ("how many transactions a
  week"). Naming no column is how the second is asked, which is why this measure
  does not follow the `sum`-requires-a-column / `count`-forbids-one split.
- `per` is required by `avg-per` and **refused** on every other measure rather
  than ignored. A spec that says `per` and gets a plain sum back is a card
  quietly showing a different number from the one asked for.
- The window must be bounded: `avg-per` over `"all"` has no period count to
  divide by, so it is refused by name.
- A metric over an empty window is **0**, joining `sum` and `count`: R0 spread
  over four months is R0 a month. (`avg` of no rows stays undefined and `last` of
  no rows stays absent — zero is not the true answer for either.)

The two averages are now distinguishable in the vocabulary, which is the part
that matters: `avg` is the average ROW and `avg-per` is the average PERIOD. The
refusal for a `per` on a `sum`, the refusal for an `avg-per` with no `per`, the
refusal for one over `"all"`, and the refusal for one on a grouped presentation
each name the fix rather than the rule.

## 3. How the model is told

A capability a model cannot see is a capability that does not exist — the whole
lesson of the 2026-10-08 schema failure. The additions are therefore written into
every surface the companion reads:

| Surface | What it now carries |
|---|---|
| `VIEW_SPEC_SCHEMA` (the door's advertised schema) | `"avg-per"` in the measure enum, a `per` field with its own description, both month windows in the `timeWindow` description |
| `VIEW_VOCABULARY` (inside every failure's `fix`) | `measure`, `per`, and both window kinds |
| `viewSpecTemplate` → `fix.workingSpecs` | `averagePerWeek` and `averagePerMonth`, built from the database's own date and number columns |
| `fix.rules` | the `avg` / `avg-per` distinction, the `per` rule, and the live month windows |
| `save_view`'s description | the same distinction, with both example windows |
| `COMPANION_SOUL` (stamp 6) | an average is its own one-number card, with the operator's exact spec spelled out |
| The in-app chat prompt | the same, per turn |
| `DecisionBody` (a locked board's proposal) | "avg-per per month of amount", because on a locked board that line is the operator's only description of the card they are approving |

## 4. What happens to a card that already exists

An `avg-per` metric switched to a table through the card's own presentation
control drops the measure to the total it was averaging and clears `per`. The
validator refuses a period average that groups, and the operator's own click must
not come back as a validation error; "show me this as a table" means the totals.
Everything else round-trips unchanged: `per` is a block's own field, like the
measure pair, so a composed card's table panel never inherits its metric panel's
divisor.

## 5. What is tested, and how each claim can fail

`npm test`. Two rigs, two artifacts.

**`tests/view-period-average-e2e.test.ts`** → `e2e/artifacts/view-period-average.json`
— the engine, on a real vault, at injected instants.

- The window bounds themselves: `previous-months: 4` on 28 October is 1 June–30
  September, on 1 November it is 1 July–31 October, on 31 March with `months: 1`
  it is February's real last day, and across a year boundary it is December's.
- The average is 250 (four months of 400/300/200/100), and the divisor is the four
  WINDOW months whether or not each one holds a row — a divisor counted from the
  rows cannot produce that number.
- The same saved card run on 31 October, 1 November and 1 December reads 250,
  425 and 350 with nothing written between the three runs. That is "every month
  it gets recalculated" observed rather than argued.
- The weekly question: `avg-per` per week over `last-weeks: 4` is 275, while
  `avg` over the same window is 220. Both numbers are asserted, and they differ,
  which is the recorded reason the second report happened.
- A per-day average over `this-month` divides by 28 days, not by the 5 rows.
- `avg-per` with no `measureColumnId` averages the row COUNT per period (1.25).
- The door: `preview_view` returns the number, and `save_view` applies the card,
  carries the figure in its reply, and the saved card recalculates when the month
  turns.
- The four refusals, each asserted to carry a `fix` with both copyable average
  specs.

**`tests/live-dashboard-ui-e2e.test.ts`** → `e2e/live-dashboard-ui.json` +
screenshots — the join, in the REAL app: the product's main process, preload,
`ViewCard` and `LiveDataProvider`, against a throwaway vault and profile. A fourth
card, "Average monthly spend", is the operator's own spec, saved through the real
writer:

1. It draws **-250** (four months of -400/-300/-200/-100 over four).
2. It does **not** move when the agent's -25 is captured, nor when the operator
   types -7: both are inside the current month, which this window does not read.
   A window that leaked the current month fails here.
3. The last leg moves both clocks to the first of the NEXT month. The `today` card
   falls to 0 as it always did, and the average card moves to **-164** — July,
   August, September and the whole of October over four — with no write anywhere.
   A card that was never asked again fails here, which is why the average card and
   not the `today` card is what this leg waits on: `today` reads 0 on any empty
   day, so it cannot tell a re-run from a stale draw.

The launcher computes the expected averages from its own seeded rows and its own
month boundaries, so the numbers asserted are the fixture's and not the engine's
read back to it; it also refuses to run a fixture whose month turn would change
nothing.

## 6. Not covered

- **A period average over a grouped presentation** ("average spend per month by
  category"). Refused by name rather than approximated: the window-level divisor
  is the only definition that cannot disagree with the table beside it, and a
  per-group divisor would have to decide what a quiet month means for a category
  that did not exist yet.
- **`avg-per` over `"all"`.** There is no period count to divide by; the refusal
  names a bounded window instead.
- **`npm run typecheck` remains red at HEAD** (47 errors, unchanged by this
  change: `node:sqlite` types, and `MapEvent`/`Task`/`LiveDay` not exported from
  `types.ts`). Recorded rather than fixed here, because fixing it is a change to
  the type surface of vault-core and not to the dashboard.
- **`settings-vault-e2e`** fails on this machine for an unrelated reason: the
  window manager will not take the rig's 1280x900 content size
  (`the window would not take 1280x900 — the rig cannot assert geometry`), which
  is a display constraint and not a code path this change touches.
