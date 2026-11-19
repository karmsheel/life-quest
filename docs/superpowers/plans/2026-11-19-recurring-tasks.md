# Recurring tasks — design contract

**Status:** implemented on `feat/recurring-tasks`. This file is the shared
contract for the engine, the renderer and the E2E rigs; they were built against
it in parallel, so a change here is a change to three surfaces at once.

**The request**

> How can I keep track of certain tasks that are recurring? For example, weekly
> review is a recurring task and should pop up under the "today and this week"
> Dashboard card right? We need to create the tools to allow for these recurring
> tasks to be created easily and so the user can easily understand from the
> dashboard what needs to be done and navigate there.

**The three decisions the operator made**

1. **Scope** — generic recurring tasks, plus the five review cadences as
   built-in recurring items (the weekly review needs no setup).
2. **Done behaviour** — completing an occurrence records it (a short history)
   and advances the item to its next due date. It does **not** create a Done
   card on the Act board.
3. **Placement** — a *Recurring tasks* section on the Task Manager page (create,
   edit, pause, delete), companion tools for the same, and the Dashboard's
   *Today & this week* card shows what is due with a link to the manager.

## Shape of the feature

- A recurring task is a **small standing record** (title, cadence, next due
  date, optional link, pause flag, short completion history). It is not a Task
  and never appears in the Act board's six columns. The board's columns stay
  horizons of work; recurrence is a schedule.
- It lives in the map store (`.lifequest/map.json`), beside `tasks`, because the
  Dashboard already reads that store and the map command bus already logs every
  write with its actor. Nothing new on the IPC bridge is needed: the renderer
  and the companion both write it with `mapApply` / the map tools.
- **Due is derived, never materialised.** A row is drawn from the record's
  `dueDate` and today's date; opening the app does not create cards or files.
- The five review cadences are **built-in recurring items derived at read time**
  from the vault's review index: the latest period whose review window has
  opened, when its overall review is not done, is a due row linking to
  `/review/<cadence>`. A review row carries no tick — the review file is the
  truth, and the row clears when the review is marked done.

## Engine — `@lifequest/vault-core`

### Types (`packages/vault-core/src/map/types.ts`)

```ts
/** How a recurring task comes round. The fields each unit needs are the
 *  fields the editor and the tools show for it. */
export type Recurrence =
  | { unit: "day" }
  | { unit: "week"; weekday: Weekday }        // 0 = Monday … 6 = Sunday
  | { unit: "month"; dayOfMonth: number }     // 1..31, clamped to a short month
  | { unit: "year"; month: number; day: number }; // month 1..12; Feb 29 allowed

/** One occurrence the operator finished, newest first. */
export type RecurringCompletion = {
  due: IsoDate;          // the occurrence that was due
  completedOn: IsoDate;  // the local day the tick landed
};

export type RecurringTask = {
  id: string;
  title: string;
  notes: string;
  recurrence: Recurrence;
  dueDate: IsoDate;                  // the next occurrence
  link?: string;                     // an internal route, e.g. "/review/weekly"
  paused: boolean;
  history: RecurringCompletion[];    // newest first, capped at RECURRING_HISTORY_LIMIT
  origin?: TaskOrigin;               // same meaning as a Task's origin
};
```

`StoreState` gains `recurring: RecurringTask[]`. `Command` gains:

```ts
| { type: "createRecurring"; title: string; notes?: string; recurrence: Recurrence;
    dueDate?: IsoDate; link?: string }
| { type: "updateRecurring"; id: string; title?: string; notes?: string;
    recurrence?: Recurrence; dueDate?: IsoDate; link?: string; paused?: boolean }
| { type: "deleteRecurring"; id: string }
| { type: "completeRecurring"; id: string }
```

### Cadence helpers (`packages/vault-core/src/map/recurring.ts`, new)

```ts
export const RECURRING_HISTORY_LIMIT = 12;

export function isRecurrence(value: unknown): value is Recurrence;

/** First occurrence on or after `date`. */
export function occurrenceOnOrAfter(recurrence: Recurrence, date: IsoDate): IsoDate;

/** First occurrence strictly after `after`. */
export function nextOccurrenceAfter(recurrence: Recurrence, after: IsoDate): IsoDate;

/** Which window a record falls in for `today`, given the vault's week start:
 *  "paused" | "overdue" | "today" | "this-week" | "later". */
export function recurringState(
  item: Pick<RecurringTask, "dueDate" | "paused">,
  today: IsoDate,
  weekStartDay: WeekStartDay,
): "paused" | "overdue" | "today" | "this-week" | "later";
```

Date arithmetic rules (all pure, ISO strings, no clocks except the ones passed
in):

- **day** — every day; `occurrenceOnOrAfter(d) = d`.
- **week** — the next date whose `weekdayOf` equals `weekday`.
- **month** — the next `min(dayOfMonth, daysInMonth(y, m))` on or after `d`;
  the *day-of-month is the anchor*, so Jan 31 → Feb 28 → Mar 31.
- **year** — the next `month/day` on or after `d`, day clamped to the month
  (Feb 29 → Feb 28 in a non-leap year). Validation allows Feb 29 and refuses a
  day the month never has (e.g. Feb 30).
- `"this-week"` means after today and on or before the last day of the current
  week (`weekStartOnOrBefore(today, weekStartDay)` + 6 days).

`recurringState` skips paused first, then overdue/today/this-week/later.

### Command semantics (`packages/vault-core/src/map/recurring.ts`)

- **createRecurring** — trims the title (refuses empty with `MALFORMED`,
  "A recurring task needs a title."); validates `recurrence` (`MALFORMED`,
  "Invalid recurrence …" naming what the unit needs); validates an optional link
  (must start with `/` and must not contain `://`); `dueDate` defaults to
  `occurrenceOnOrAfter(recurrence, ctx.today)`; new id from `ctx.id()`; empty
  history; `paused: false`; `origin` from `ctx.actor` (same rule as a Task).
- **updateRecurring** — refuses a missing id (`NOT_FOUND`, "Recurring task not
  found."). Title/link/dueDate validated as above. When `recurrence` changes and
  no `dueDate` is supplied, the due date is re-anchored to
  `occurrenceOnOrAfter(newRecurrence, max(oldDueDate, ctx.today))`, so changing
  the rule cannot leave a date that contradicts it.
- **completeRecurring** — refuses a missing id (`NOT_FOUND`) and a paused item
  (`MALFORMED`, "A paused recurring task is not due."). Records
  `{ due: item.dueDate, completedOn: ctx.today }` at the head of `history`,
  capped at `RECURRING_HISTORY_LIMIT`, and advances `dueDate` with
  `nextOccurrenceAfter(recurrence, max(item.dueDate, ctx.today))`. The max is the
  backlog rule: finishing a task that was due two weeks ago schedules the next
  one *after today*, never a chain of past dates.
- **deleteRecurring** — refuses a missing id (`NOT_FOUND`).

### Persistence (`packages/vault-core/src/map/persist.ts`)

- `toFile` writes `recurring`.
- `fromFile` reads it tolerantly: a map file written before this feature has no
  key and loads as `[]`; id/title/recurrence/dueDate must be well-formed or the
  record is dropped; link, paused, history and origin are coerced (invalid link
  drops the link, invalid entries are skipped, `origin` follows the Task rule —
  only the literal `"agent"` survives).
- `ensureMapOnOpen`'s "needs persisting" comparison includes `recurring`.

### Due model (`packages/vault-core/src/recurrence.ts`, new; browser-safe)

```ts
export type RecurringDueState = "overdue" | "today" | "this-week";

export type RecurringDueItem = {
  /** A record id, or `review:<cadence>` for a built-in review row. */
  id: string;
  kind: "task" | "review";
  title: string;
  /** The occurrence's date. For a review: the local day its window opened. */
  dueDate: IsoDate;
  state: RecurringDueState;
  daysLate: number;              // 0 unless state is "overdue"
  /** Only operator tasks can be ticked; a review clears on its own page. */
  completable: boolean;
  /** The route the row's title links to, or null. */
  link: string | null;
};

/** Due operator tasks plus the built-in review rows, in one sorted list. */
export function dueRecurringItems(
  items: RecurringTask[],
  reviews: ReviewIndexEntry[],
  settings: {
    weekStartDay: WeekStartDay;
    reviewAvailability: ReviewAvailability;
    /** Local day the vault was created; older review periods are not owed. */
    since?: IsoDate;
  },
  now?: Date,
): RecurringDueItem[];
```

- Operator records: paused and `later` are omitted; `dueDate` is the occurrence;
  `link` is the record's own link or null; `completable: true`.
- Built-in review rows: for each cadence, take
  `openReviewPeriod(cadence, weekStartDay, availability, now)`; skip it when the
  review index reports that period's overall scope done (or the record locked),
  and skip a period that ended before `settings.since` (the vault's creation
  day) — a vault cannot owe a review for a period it did not exist in, which is
  what stops a brand-new vault opening on five "overdue" rows. Otherwise it is
  due: `title` is `"Daily review"` / `"Weekly review"` /
  `"Monthly review"` / `"Quarterly review"` / `"Yearly review"`, `link` is
  `/review/<cadence>`, `completable: false`, `dueDate` is the local date
  `reviewOpensAt` lands on, `state` is `"today"` when it opened today and
  `"overdue"` otherwise, `daysLate` counts whole days from that local date.
  The renderer passes `since` as the local calendar day of
  `snapshot.lifequest.createdAt`.
- Sorting: `overdue` first (oldest due first), then `today`, then `this-week`;
  ties by due date, then id.

`packages/vault-core/src/pure.ts` re-exports `dueRecurringItems` and the two
types (the renderer may import only browser-safe runtime). The root
`packages/vault-core/src/index.ts` also exports the module, so the engine E2E can
import it. `map/public.ts` exports the map types plus `isRecurrence`,
`occurrenceOnOrAfter`, `nextOccurrenceAfter`, `recurringState`,
`RECURRING_HISTORY_LIMIT`, and `isIsoDate` (the renderer's editor uses these).

### Life log (`packages/vault-core/src/map/log-event.ts`)

| command | type | summary |
|---|---|---|
| createRecurring | `map.recurring.created` | `Created recurring task <title>` |
| updateRecurring | `map.recurring.updated` | `Updated recurring task` |
| deleteRecurring | `map.recurring.deleted` | `Deleted recurring task` |
| completeRecurring | `map.recurring.completed` | `Completed recurring task` (payload: the record `id`; the advanced date is in the map) |

### Companion / connected-agent tools (`packages/vault-core/src/map/tools.ts`)

Four tools, snake_case like the task tools, applied immediately (not Decisions):

| tool | arguments | description it advertises |
|---|---|---|
| `create_recurring_task` | `title` (required), `notes`, `cadence` (required: `daily`\|`weekly`\|`monthly`\|`yearly`), `weekday` (weekly), `dayOfMonth` (monthly), `month` + `day` (yearly), `dueDate` (optional `YYYY-MM-DD`; defaults to the next occurrence), `link` (optional internal route) | "Create a recurring task that appears on the Dashboard's Today & this week card when due. cadence weekly needs weekday (0=Monday…6=Sunday); monthly needs dayOfMonth (1-31); yearly needs month (1-12) and day. dueDate defaults to the next occurrence." |
| `update_recurring_task` | `id` (required) + any create field + `paused` | "Update a recurring task. Changing cadence re-anchors the due date unless dueDate is given." |
| `delete_recurring_task` | `id` | "Delete a recurring task" |
| `complete_recurring_task` | `id` | "Complete a recurring task's current occurrence; it advances to the next due date and records the completion" |

`commandForTool` maps them to the commands above. `get_state` already returns the
whole map store, so the companion reads them without a new read tool. Add the
four names to `CONNECTED_SCHEDULE_TOOLS` in `pairing-grant.ts` (Schedule + Write
gates them, the same as the task tools) and mention recurring tasks in the
planner's `SYSTEM` prompt in `apps/desktop/electron/map-tools.ts`.

## Renderer — `apps/desktop/src`

### The Dashboard card (`pages/home-pins/TodayWeekCard.tsx`)

The card keeps its two task columns and gains a **Recurring** block beneath them:

- Data: `snapshot.map.recurring ?? []`, `snapshot.reviews`,
  `snapshot.settings` → `dueRecurringItems(..., { weekStartDay,
  reviewAvailability, since: <local day of snapshot.lifequest.createdAt> },
  new Date())`.
- Heading **Recurring** with the due count; a footer link **Manage recurring →**
  (`data-testid="today-week-recurring-manage"`, `to="/act?manage=recurring"`).
- One row per due item (`data-testid={`recurring-row-${item.id}`}`):
  - operator rows (`completable`): a checkbox
    (`data-testid={`recurring-done-${item.id}`}`,
    `aria-label={`Mark "${title}" done`}`) that sends exactly one
    `{ type: "completeRecurring", id }` through `api().mapApply`, then
    `refresh()`. The row leaves the card because the due date advanced. A failed
    write prints on the card in `.form-error[role="alert"]`; ticks are disabled
    while a write is in flight.
  - every row: the title (a `Link` when `link` is set) and a state label —
    **Overdue** (`overdue`, destructive ink), **Due today** (`today`), **This
    week** (`this-week`). Review rows have no checkbox.
- Empty state: **Nothing recurring due.** (the manage link still shows).
- The block is inside the same card, after `.home-task-cols`.

### The manager (`pages/ActPage.tsx` + new `components/recurring/`)

- New files: `components/recurring/RecurringTasksSection.tsx` (section, list,
  rows, confirm-delete) and `components/recurring/RecurringTaskEditor.tsx`
  (inline create/edit form). Copy helpers live in
  `apps/desktop/src/lib/recurring-copy.ts`.
- Mounted in `ActPage` **directly after `<TaskBoard>`** and before *Run an
  agent*. It is a full section, visible even with no rows.
- Section: `data-testid="recurring-section"`, heading **Recurring tasks** with a
  count, **Add recurring task** button (`data-testid="recurring-add"`).
  Empty list text: **No recurring tasks yet.**
- Row (`data-testid={`recurring-item-${item.id}`}`) shows the title, a cadence
  line (**Every day** / **Every Monday** / **Every month on the 12th** /
  **Every year on 5 Nov**), **Next due <date>**, a **Paused** badge when paused
  and an **Overdue**/**Due today** badge when it is due, **Last done <date>**
  when `history[0]` exists, and the actions **Edit**
  (`recurring-edit-<id>`), **Pause**/**Resume** (`recurring-pause-<id>`),
  **Delete** (`recurring-delete-<id>`). Pause/Resume sends exactly one
  `updateRecurring { id, paused }`. Delete opens the app's own confirmation
  (`useConfirm`) titled **Delete recurring task?**, naming the title, confirm
  button **Delete**; only the confirm sends `deleteRecurring`.
- Editor (`data-testid="recurring-editor"`): Title (`recurring-title`), Repeats
  select (`recurring-cadence`: Daily / Weekly / Monthly / Yearly), the cadence's
  own fields — weekday select `recurring-weekday` (Monday…Sunday), day-of-month
  number `recurring-day-of-month`, month select `recurring-month` + day number
  `recurring-day` — **First due**/**Next due** date input `recurring-due-date`,
  **Page it opens (optional)** `recurring-link` (placeholder `/review/weekly`),
  **Notes (optional)** `recurring-notes`, then **Save recurring task**
  (`recurring-save`) and **Cancel** (`recurring-cancel`). A new task's due date
  defaults to `occurrenceOnOrAfter(recurrence, today)` and is recomputed when
  the cadence fields change; the operator may then set their own date. Save
  sends exactly one `createRecurring`/`updateRecurring`; a refusal prints beside
  the form.
- With `?manage=recurring` on `/act`, the section is scrolled into view on
  mount (that is where the Dashboard's manage link goes). The section is on the
  page regardless of the parameter.
- Act page child order stays: `header`, `board`, then the recurring section,
  then *Run an agent* / *Recent activity* — the existing task-board rig asserts
  the first two children.

## E2E — the only tests written

Two rigs, both producing an artifact that can be re-read without eyeballing.

### 1. Engine + tools — `apps/desktop/tests/recurring-engine-e2e.test.ts`

Plain `node:test` over a real vault (`createVault` + `applyMapCommand` with an
explicit `today`) and over the real MCP door (`startPairingDoors` + companion
token), like `dashboard-card-e2e.test.ts`. Artifact:
`e2e/artifacts/recurring-engine.json`. Claims:

1. `createRecurring` writes `map.json`; reopening the vault (`loadMapState`)
   reads the same record; a map file with no `recurring` key loads as `[]`.
2. Defaults: `dueDate` defaults to the next occurrence on/after today; a weekly
   record created without a weekday is refused with a message naming the field;
   an external link is refused; an invalid date is refused.
3. `recurringState`/`dueRecurringItems` bucket overdue/today/this-week, omit
   paused and later, and sort overdue first.
4. `completeRecurring` records `{ due, completedOn }`, caps history at 12, and
   advances to the next occurrence after today when the item was overdue. A
   paused record is refused; an unknown id is `NOT_FOUND`.
5. Cadence arithmetic: weekly lands on the chosen weekday; monthly Jan 31 →
   Feb 28 → Mar 31 (anchor preserved); yearly Feb 29 → Feb 28; daily+1.
6. Built-in review rows: with an empty review index the open periods are due;
   marking the weekly review's overall scope done removes its row; the row's
   link is `/review/weekly` and it is not completable.
7. Over the real MCP door: `tools/list` advertises the four tools with their
   fields named; `create_recurring_task` writes the record; `get_state` returns
   it; `complete_recurring_task` advances it and records the completion;
   `toolAllowed` allows the four for a Schedule+Write grant and refuses them
   without Schedule.

### 2. Shipped UI — `apps/desktop/e2e/recurring-tasks.{html,tsx,electron.mjs}` + `apps/desktop/tests/recurring-tasks-e2e.test.ts`

An Electron harness rendering the real **Today & this week** card inside the
real **HomePage** board at `/home`, and the real **ActPage** at `/act`, in one
MemoryRouter so the manage link's navigation is real. The bridge is a recording
stub that really applies the recurring commands (like `task-board.tsx`).
Fixture due dates are computed from the run's own local today so the claims hold
on any day; the harness publishes them on `window` for the driver.

Artifact: `e2e/artifacts/recurring-tasks.json` + `recurring-tasks-card.png`,
`recurring-tasks-manager.png`, `recurring-tasks-editor.png`.

Scenario names (the test wrapper asserts this exact order):

| # | name | claim |
|---|---|---|
| 1 | `card-recurring` | The card's Recurring block lists the overdue, due-today and this-week fixtures with their labels; the later and paused fixtures are absent; the count matches. |
| 2 | `review-row` | With the weekly review's open period unfinished the card shows **Weekly review** as a link to `/review/weekly` with no checkbox; with it done (second mount, `?reviews=done`) the row is gone. |
| 3 | `card-tick` | Ticking the due-today row sends exactly one `completeRecurring` with that id; the harness applies it; the row leaves the card and the manager reads the advanced date; a failed write (a `?write=refuse` mount) prints on the card. |
| 4 | `card-manage` | **Manage recurring →** is a link to `/act?manage=recurring`; pressing it reaches the real Act page and the `recurring-section` is inside the viewport. |
| 5 | `manager-list` | The Act section lists every record (including paused and later), with cadence labels, next due, Paused/Overdue badges and Last done. |
| 6 | `manager-create` | Add → fill title/cadence → Save sends exactly one `createRecurring` (correct recurrence and a due date) and the new row appears. |
| 7 | `manager-pause` | Pause sends one `updateRecurring { paused: true }`, the badge reads Paused, Resume reverses it. |
| 8 | `manager-delete` | Delete asks first (dialog, no command yet), confirming sends exactly one `deleteRecurring`, the row leaves; cancel sends nothing. |
| 9 | `clean` | No unexpected bridge call and no console error. |

## Docs

`docs/wiki/06-dashboard.md` (the card's Recurring block), `docs/wiki/14-task-manager.md`
(the Recurring tasks section, create/edit/pause/delete, completion semantics) and
`docs/wiki/18-reviews.md` (reviews appear as built-in recurring rows) are updated
on this branch, plus a new `LAWS/RECURRING.md` stating the musts. The wiki links
the law file (docs:check validates the link). No route, rail label, Settings tab
or version changes.

## File ownership (disjoint write scopes)

- **Lead** — `packages/vault-core/**`, `apps/desktop/electron/**`, this file,
  merge/commit/release checks.
- **ui** — `apps/desktop/src/components/recurring/**`,
  `apps/desktop/src/pages/home-pins/TodayWeekCard.tsx`,
  `apps/desktop/src/pages/ActPage.tsx`, `apps/desktop/src/lib/recurring-copy.ts`,
  `apps/desktop/src/styles/global.css`.
- **e2e** — `apps/desktop/e2e/recurring-*`, `apps/desktop/e2e/artifacts/recurring-*`,
  `apps/desktop/tests/recurring-*`.
- **docs** — `docs/wiki/06-dashboard.md`, `docs/wiki/14-task-manager.md`,
  `docs/wiki/18-reviews.md`, `LAWS/RECURRING.md`.

## Verification

```bash
# from the worktree root
npm run typecheck -w @lifequest/desktop
npm run docs:check
# engine rig (no dev server needed)
cd apps/desktop && node --experimental-strip-types --test tests/recurring-engine-e2e.test.ts
# shipped-UI rig (owns the bench for its run)
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/recurring-tasks \
  tests/recurring-tasks-e2e.test.ts
```
