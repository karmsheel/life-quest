# The Dashboard as a live surface: the clock, the window, and the repaint

**Status:** design
**Date:** 2026-10-14
**Touches:** `packages/vault-core/src/views.ts`, `packages/vault-core/src/types.ts`,
`packages/vault-core/src/view-schema.ts`, `packages/vault-core/src/views-tools.ts`,
`apps/desktop/electron/data-revision.ts`, `apps/desktop/electron/main.ts`,
`apps/desktop/electron/map-tools.ts`, `apps/desktop/electron/preload.ts`,
`apps/desktop/electron/companion-client.ts`, `apps/desktop/electron/companion-profile.ts`,
`apps/desktop/src/state/LiveDataProvider.tsx`, `apps/desktop/src/components/ui/ViewCard.tsx`,
`apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/pages/PageCanvasPage.tsx`,
`apps/desktop/src/pages/DatabasePage.tsx`

## 1. The problem, as reported

> I just told the agent to log an expense, but it didn't show up on the recent
> transactions table. I also noticed the "Today's Expense" table value hasn't
> changed in days.

Two different faults were behind those two sentences, and the operator's own
vault holds the evidence for both.

**The card was never asked again.** `capture.posted` at `19:59:33` wrote the row
(`-111 ZAR`, `2026-10-13`); the view file for the pinned "Recent transactions"
card had last been touched at `19:54:42`. The card had been drawn once, at mount,
and never again. Nothing was wrong with the query: `runViewBlocks` re-runs a spec
correctly every time it is called. Nothing was calling it.

**One card could not move even if it were asked.** "Today's expenses" was saved
with the date spelled into a filter:

```json
"timeWindow": "all",
"filters": [{ "columnId": "date", "op": "eq", "value": "2026-10-10" }]
```

That is a correct query about one day, and it is frozen on that day for ever. The
view vocabulary had no way to say *today* — every window it offered (`this-month`,
`last-30-days`, `this-year`, `last-weeks`, `custom`) was either a period the
operator names or a trailing count — so an agent asked for "today's spending" did
the only thing it could and wrote down the date it was looking at.

## 2. What the operator gets

A card is a query, and a query over a vault the operator is still filling in has
to answer for the vault **now**:

- A card re-runs when anything it could be showing changes, whoever changed it:
  the companion's tools, the operator's own edits, an approved Decision, an
  ingest batch, the FX rate landing.
- A card anchored on `today` or `this-week` follows the calendar with no write at
  all. A board left open overnight reads the new day within half a minute.
- Coming back to the window re-reads the board, which is how an edit made by
  another program, a sync client, or a second copy of the app arrives.
- `today` is a first-class window, so "today's spending" is a live query rather
  than a date written down.

Nothing about the drawing changes. A card still shows the same table, chart, or
number; it is the same card, one edit later.

## 3. The vocabulary: `today` and `this-week`

`TIME_WINDOWS` gains two names, both computed from the LOCAL calendar day of the
instant the card is drawn (`todayLocalIso`), and both ending at today:

| Window | Span |
|---|---|
| `today` | that day, alone |
| `this-week` | that day's Monday through that day |

They end at today rather than at the period's last day for the same reason
`this-month` always has: an operator looking at actuals does not want a spend that
has not happened yet, and a row someone dated ahead by mistake should not land in
the current period's total.

A literal date in a filter stays legal — "what did I spend on 12 October" is a
real question with a real answer. What changes is that the model is now TOLD, in
the schema description, in the tool's `fix` object and its rules, and in the
companion's own instructions, that a named window is live and that a date written
into `filters` to mean "today" freezes the card. `viewSpecTemplate` grows a
fourth example beside metric/table/list: a metric over `today`, built from the
database's own date column, because a vocabulary a model has never seen the word
in is a vocabulary it will work around.

### 3.1 A metric over an empty window is 0

A live `today` card is empty every morning, and under the old rule it read "No
rows in this window." instead of **0**. A spreadsheet says `SUM()` of nothing is
0, and so does this one — for `sum` and `count` only, which are the two measures
for which zero is the true answer. An `avg` of no rows is undefined and a `last`
of no rows does not exist, so those still draw nothing, which is the honest
answer for them.

## 4. The signal: who announces a change

`apps/desktop/electron/data-revision.ts` is a counter and two functions. It is
free of Electron imports so a test can drive it in plain Node, and it holds the
two classifications that decide who announces a change.

```
   agent tool ──▶ pairing-door ──▶ executeTool ─┐
                                                 ├──▶ noteDataChanged() ──▶ vault:dataChanged ──▶ LiveDataProvider ──▶ ViewCard re-runs
   renderer edit ──▶ ipcMain.handle ──▶ vault ───┘
```

`main.ts` registers every channel through one wrapper that notes a change after a
handler resolves, so the decision lives in one list instead of at a hundred
registration sites — and a channel added later is covered by what that list says
about it rather than by whether its author remembered.

The two lists fail in **opposite directions**, both deliberately:

| Door | List | An unlisted name means | Why |
|---|---|---|---|
| IPC | `MUTATING_CHANNELS` — channels that can write | "reads only" | The card's own repaint re-enters this registrar to read (`view:runSaved`, `db:get`). A READ that announced a change would repaint the cards for ever. A missed entry costs a stale card until the next write, focus, or day change. |
| MCP | `READ_ONLY_TOOLS` — tools that only read | "may have written" | A tool call is never caused by a card re-running, so there is no loop to fear. A wrong guess costs one wasted repaint; the other wrong guess is this bug. |

Two more sources move the counter, because neither is a write:

- **The day.** `LiveDataProvider` checks the local date every 30 seconds and
  bumps when it changes. This is what makes `today` mean today on a window that
  was opened yesterday.
- **Focus.** Main notes a change whenever the window regains focus. The vault is a
  folder the operator syncs and opens in other tools; coming back to the window is
  the moment to re-read, and one repaint per focus is cheaper than showing a stale
  figure.

The FX refresh notes a change too, but only when it actually refreshed: a rate
moves every USD amount on the board without a single row being written.

## 5. Who listens

`LiveDataProvider` publishes the revision as context. It has a **default value**
rather than a throwing hook, because `ViewCard` is rendered by e2e harness pages
that mount it alone; a missing provider means "nothing is live", not a crash.

| Surface | What it re-reads |
|---|---|
| `ViewCard` | the whole card: `viewGet`, `viewRunSaved`, `dbGet` |
| `HomePage` | the built-in cards' data — the log, pending Decisions, pages, views |
| `PageCanvasPage` | every block's database, the finance extras, and the three finance reports |
| `DatabasePage` | the ledger table and its ingest batches |

`PageCanvasPage`'s `rowsByDb` is a cache, so the revision is what invalidates it.
The finance reports are re-fetched rather than recomputed locally for the same
reason the cards are: the figure is the engine's, and the only way for it to be
live is to ask again.

## 6. The operator's own card

The saved view `e1698877-…` ("Today's expenses") was rewritten through the app's
own `saveView`, so it validated against the live registry, kept its id — and
therefore its pin — bumped `updatedAt`, and left a `view.updated` line in the log.
Both of its panels now carry `timeWindow: "today"` with `timeColumnId: "date"` and
no filters. Run against the operator's vault it reports **-25 ZAR** for today,
which is the expense that was invisible.

## 7. What is tested, and how each claim can fail

`npm test`. Two files, one artifact each.

**`tests/live-dashboard-e2e.test.ts`** — the engine, against a real vault on disk,
at injected instants. One spec run on a Wednesday and on the Thursday reads two
different numbers; a `this-week` spec crosses a real Monday boundary; a metric over
an empty window is 0. Beside them, the reported bug is held still: a card with
`date = 2026-05-13` in a filter reads the same number on both days, which is what
"it hasn't changed in days" was. And the saved-and-repaired shape agrees with
itself panel for panel.

**`tests/live-dashboard-ui-e2e.test.ts`** → `e2e/live-dashboard.mjs` +
`e2e/live-dashboard.electron.mjs` — the join, in the REAL app: the product's main
process, the product's preload, the product's `ViewCard` and `LiveDataProvider`,
against a throwaway vault, profile, and fake `hermes` CLI (so no run can restart
the operator's own assistant). Three legs, one artifact:

1. **The agent's door.** A real HTTP `tools/call` carrying the token the app
   minted, to the door the app bound — the same request Hermes makes. The listing
   gains the row and "Today's expenses" moves `0 → -25`.
2. **The operator's door.** A row written from the page's own bridge over
   `db:upsertRow`, the channel `DatabasePage` uses. The listing gains that row too
   and the metric moves `-25 → -32`.
3. **The day.** The clock is moved a day on both sides — the renderer's day check
   and the engine's window — and the card falls to `0` with no write anywhere.

A third card spells its date in a filter and must **not** move in any leg, which is
what makes "the live one moved" a claim about the window rather than about
everything repainting. The page counts its own module evaluations and must read 1,
so an update cannot be a reload wearing an update's clothes. The cards' DOM is
sampled while nothing is happening and must not move, so the repaint after the
write is attributable to the write.

**Falsified, not assumed.** With the notice removed from `executeTool` and the
bundle rebuilt, the rig fails and reports the operator's own symptom: `listing 2
rows, today [0]` after a capture that posted. The artifact is
`e2e/artifacts/live-dashboard-ui.json`.

## 8. Not covered

- **A write by a program the app cannot see.** Another editor, a sync client, a
  script: focus is the trigger, so the board is correct the next time the operator
  looks at the window and not before. A filesystem watcher was rejected as the
  mechanism: it fires on partial writes, needs a debounce it cannot justify, and
  would still miss the case that matters most — a window nobody has looked at.
- **A card re-running while its tab is closed.** The revision is per window, so a
  window that is not open simply reads fresh when it opens.
- **`npm run typecheck` remains red at HEAD** (47 errors, unchanged by this
  change: `node:sqlite` types, and `MapEvent`/`Task`/`LiveDay` not exported from
  `types.ts`). Recorded rather than fixed here, because fixing it is a change to
  the type surface of vault-core and not to the dashboard.
