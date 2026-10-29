# Act

**Act** is the task board: six columns from finished work on the left to the unscheduled
backlog on the right, a card per task, and a card editor for everything a task points at.
It is where work is chosen and moved; [Daily Schedule](./13-daily-schedule.md) is where the
day's tasks are actually put on a clock.

## Where it lives

- Wing: Execute.
- Rail: third row of the Execute wing, icon **Zap**, label **Act**.
- Route: `/act`.
- Surface: a full page in the centre pane: the board, then **Run an agent**, then
  **Recent activity**.

This page is part of the [Wiki home](./README.md).

## What it is for

A task is small enough to move and concrete enough to finish. The board gives every task one
place, and the columns are horizons rather than folders: **Today** is what you are doing,
**This week** is what must land soon, **Next 30 days** is the rolling horizon, and
**Backlog** is everything not yet scheduled. A card can also name the goal, project, date,
week item or capture it belongs to, so the board stays a view of the whole plan without
becoming a filing system.

## How to use it

1. Open **Execute**, then **Act**. The heading is the current domain's name, or
   **Overview** when the lens is Overview.
2. Add a task with the field at the top of the board (placeholder **Add a task…**) and
   choose **Add task**. New tasks from that field go to **Backlog**, and the board scrolls
   to show the new card.
3. Or add a task in a specific column: choose **Add a task** at the bottom of that column,
   type in the field (placeholder **Add to Today…**, **Add to Backlog…**, and so on), and
   choose **Add**. **Cancel** or Escape closes the small composer; it stays open after a
   card is added so you can add several.
4. Move a card by dragging it. The drag ghost shows its title and the column it will land
   in; drop it above a card to insert before that card, or on an empty column (which shows
   **Drop here**).
5. Move a card with the keyboard: open the card's three-dot actions menu, choose **Edit details**, and change
   its **Column** select. This is the board's documented keyboard path.
6. Open a card by choosing its title. The editor lets you change:
   - **Notes** — saved when the field loses focus.
   - **Column** — the same six columns the board draws.
   - **Goal**, **Project**, **Date**, and **Week item** (Year, Monday, Item) — what the card
     points at.
7. Use the card's three-dot actions menu for **Edit details** / **Hide details** and **Delete**. Deleting is
   immediate; there is no confirmation dialog on the card menu.
8. A task is completed by moving it to **Done** — by drag, by the editor's **Column**
   select, or by a task tool from the companion. There is no done checkbox on a card.
9. **Run an agent** below the board dispatches an active agent against the current domain's
   doctrine. Choose the **Agent**, optionally fill in **Task (optional)**, and choose
   **Run** `<agent name>`. The reply appears under the section; while it runs the button reads
   **Running…**.

With no tasks at all, the board still draws its six columns, each showing **No tasks**, and
the heading count reads `0`.

## The screen

| Part | What it does |
|---|---|
| **Act** eyebrow + domain title | **Act**, then the active domain's name or **Overview**. |
| **Tasks** board | Six columns in this order: **Done**, **In-progress**, **Today**, **This week**, **Next 30 days**, **Backlog**. Each column shows its count. |
| Board quick add | **Add a task…** and **Add task**; new cards land in **Backlog**. |
| Column add | **Add a task** at the foot of each column, opening a composer for that column. |
| Task card | Title, a drag grip, and a three-dot actions menu; metadata chips for the linked goal, project, scheduled date and week item. |
| Card editor | **Notes**, **Column**, **Goal**, **Project**, **Date**, **Week item** (Year / Monday / Item). |
| Card menu | **Edit details** / **Hide details**, and **Delete**. |
| **Run an agent** | **Manage agents** link, **Agent** select, **Task (optional)** prompt, **Run** `<agent name>` / **Running…**, and a reply block per run marked done or failed. |
| **Recent activity** | The last five life-log entries for the current lens, then **View full log →**. |

Card metadata is drawn as chips: a goal chip shows the goal's name, a project chip the
project's title, a date chip a short date such as "Oct 22", and a week chip the linked week
item's own text. A chip whose target has disappeared is marked **Missing goal**,
**Missing project** or **Week item**, with a warning tooltip — the task still holds the id.

## Rules and behaviour

### The board's columns are the task's status

The six columns are the task's only status field: `done`, `in-progress`, `today`,
`this-week`, `next-30-days`, `backlog`. The board draws them in that order. The order of
cards inside a column is persisted as their order in the task list, not as a separate sort
field, so a drop above a card is a real write and a no-op drop is not a write at all.

### What a task carries

A task is `{ id, title, notes, column, links }`. The links are optional and always
single-valued: `goalId`, `projectId`, `date`, a `weekItem` of year + Monday + item id, and
`signalId` (the Life-Chain capture a task was made from). Tasks have no domain field, so the
board itself is vault-global; the lens names the page heading and filters the recent-log
strip, not the columns. This is the wings law: wing tabs switch the rail and never filter
page data — [`LAWS/WINGS.md`](../../LAWS/WINGS.md). A dangling goal, project or week-item id
is stored, not rejected, and shown as missing until you clear it.

### Who writes what

- Your board actions go through the same map command bus as Architecture and Daily
  Schedule: create, update, move and delete apply immediately and write the map store.
- Tasks live in `.lifequest/map.json` in the map store's `tasks` list — there is no
  per-task file.
- The companion's task tools — **create_task**, **update_task**, **move_task**,
  **delete_task** — also apply immediately rather than waiting in
  [Decisions](./23-decisions.md). A companion that marks a task done by moving it to
  **Done**, or a dispatched agent that adds a card, is visible on the board on the next
  vault refresh.
- That is different from Architecture's day-template tools (day types, the default week and
  weekly items), which are Decision-gated and wait for approval.

### Where tasks appear outside Act

- **Daily Schedule** shows every unplaced task in the **Today** column in its **Leftover**
  list, prefixed **Task ·** and the task's title, and placing one creates a live block. Completing it
  there sets the task to **Done**. See [Daily Schedule](./13-daily-schedule.md).
- A task made from a Life-Chain signal is created in **Backlog** with its `signalId` set;
  the chain row then reads **Open task** and links back to `/act?task=<id>`, which opens the
  board with that card expanded. See [Life-Chain](./15-life-chain.md).
- Projects collate the tasks that point at them on the project page. See
  [Projects](./12-projects.md).
- The [Life Map](./11-life-map.md) does not draw task cards in this release. Dates on a task
  are its own `links.date`; the calendar's events are separate records.

## Tips and edge cases

- The quick add at the top always creates in **Backlog**. If you want the card in **Today**,
  add it from that column's own **Add a task** instead of dragging it afterwards.
- A task with no goal, project, date, week item or signal shows no metadata chips at all;
  the card is its title and notes.
- **Notes** save on blur, not on every keystroke. Click out of the box before closing the
  card if you want the write to land immediately — closing the card does not discard what
  you typed, because the blur happens first.
- The week-item picker only offers weeks that exist in the current map years. A stored link
  whose year or week has gone is kept and shown as missing rather than silently cleared.
- Opening `/act?task=<id>` for a task that no longer exists opens the board; there is
  no error alert for a stale link.
- **Run an agent** is disabled until the current scope has a non-empty Strategy (How)
  document. The hint under the button reads: "Add a Strategy (How) in Track to enable
  dispatch."
- The agent's reply is shown in the run block; what it *wrote* is in the vault and the log,
  not in the reply text.

## Related

- [Daily Schedule](./13-daily-schedule.md) — the day's clock, fed by the **Today** column.
- [Life-Chain](./15-life-chain.md) — captures that become backlog tasks.
- [Projects](./12-projects.md) — the project a task can point at.
- [Goals](./10-goals.md) — the goal a task can point at.
- [Personnel and agents](./25-personnel-and-agents.md) — hiring the agents **Run an agent**
  dispatches.
