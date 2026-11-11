# Task Manager

**Task Manager** is the task board: six columns from finished work on the left to the
unscheduled backlog on the right, a card per task, and a card editor for everything a task
points at. It is where work is chosen and moved; [Daily Schedule](./13-daily-schedule.md) is
where the day's tasks are actually put on a clock. The page was called Act before 0.2.8; its
route and links are unchanged.

## Where it lives

- Wing: **Act** (the wing id is still `execute`).
- Rail: third row of the Act wing, icon **Zap**, label **Task Manager**.
- Header: the grey **Task Manager** page eyebrow above the page title, which is the active
  area's name, or **Life** on the whole-vault view.
- Route: `/act`. A task link from elsewhere arrives as `/act?task=<task-id>`.
- Surface: a full page in the centre pane: the board, then **Run an agent**, then
  **Recent activity**.

This page is part of the [Wiki home](./index.md).

## What it is for

A task is small enough to move and concrete enough to finish. The board gives every task one
place, and the columns are horizons rather than folders: **Today** is what you are doing,
**This week** is what must land soon, **Next 30 days** is the rolling horizon, and
**Backlog** is everything not yet scheduled. A card can also name the goal, project, date,
week item or capture it belongs to, so the board stays a view of the whole plan without
becoming a filing system.

Two facts are drawn on the cards themselves: a card the companion created wears a bot glyph
and says **Added by agent**, and every card ends in **Send to agent**, which hands that one
card to a fresh companion chat under a confirmation.

## How to use it

1. Open **Act**, then **Task Manager**. The title is the current area's name, or **Life** on
   the whole-vault view.
2. Add a task with the field at the top of the board (placeholder **Add a task…**) and
   choose **Add task**. New tasks from that field go to **Backlog**, and the board scrolls
   to show the new card.
3. Or add a task in a specific column: choose **Add a task** at the bottom of that column,
   type in the field (placeholder **Add to Today…**, **Add to Backlog…**, and so on), and
   choose **Add**. The composer closes on a press outside it or on Escape; **Cancel** also
   closes it, and **Add** keeps it open for the next card in that column.
4. Move a card by dragging it. The drag ghost shows its title and the column it will land
   in; drop it above a card to insert before that card, or on an empty column (which shows
   **Drop here**).
5. Move a card with the keyboard: open the card's three-dot actions menu, choose **Edit
   details**, and change its **Column** select. The board's own hint says the same: "Drag a
   card to move it between columns. Open a card's menu and choose Edit details to change its
   column with the keyboard."
6. Open a card by choosing its title. The editor lets you change:
   - **Notes** — saved when the field loses focus.
   - **Column** — the same six columns the board draws.
   - **Goal**, **Project**, **Date**, and **Week item** (Year, Monday, Item) — what the card
     points at.
7. Use the card's three-dot actions menu for **Edit details** / **Hide details** and
   **Delete**. Deleting is immediate; there is no confirmation dialog on the card menu.
8. A task is completed by moving it to **Done** — by drag, by the editor's **Column**
   select, or by a task tool from the companion. There is no done checkbox on a card.
9. Send one card to an agent: choose **Send to agent** on the card. A confirmation asks
   first — it says a new session starts, the card's context is handed over, and the task
   stays on the board until the agent moves it. Cancel starts nothing; **Send to agent**
   creates a chat named "Task · <title>", opens the dock on it, and sends the kickoff as its
   first message. A failed send prints an error on the board and writes nothing.
10. **Run an agent** below the board dispatches an active agent against the current area's
    doctrine. Choose the **Agent**, optionally fill in **Task (optional)**, and choose
    **Run** `<agent name>`. The reply appears under the section; while it runs the button
    reads **Running…**.
11. **Recent activity** shows the last five life-log entries for the current lens, then
    **View full log →**.

With no tasks at all, the board still draws its six columns, each showing **No tasks**, and
the board count reads `0`.

## The screen

| Part | What it does |
|---|---|
| **Task Manager** eyebrow + title | The page name, then the active area's name or **Life**. |
| **Tasks** heading | The board's name and a count of every task on it. |
| Board quick add | **Add a task…** and **Add task**; new cards land in **Backlog**. |
| Column add | **Add a task** at the foot of each column, opening a composer for that column. |
| Task card | Title, a drag grip, the **Added by agent** glyph when the companion created it, a three-dot actions menu, and metadata chips for the linked goal, project, scheduled date and week item. |
| Card editor | **Notes**, **Column**, **Goal**, **Project**, **Date**, **Week item** (Year / Monday / Item). |
| Card menu | **Edit details** / **Hide details**, and **Delete**. |
| **Send to agent** | A raised key under the card's reading content; disabled while a send is in flight. |
| **Run an agent** | **Manage agents** link, **Agent** select, **Task (optional)** prompt, **Run** `<agent name>` / **Running…**, and a reply block per run marked done or failed. |
| **Recent activity** | The last five life-log entries for the current lens, then **View full log →**. |

Card metadata is drawn as chips: a goal chip shows the goal's name, a project chip the
project's title, a date chip a short date such as "Oct 22", and a week chip the linked week
item's own text. A chip whose target has disappeared is marked **Missing goal**,
**Missing project** or **Week item**, with a warning tooltip — the task still holds the id.
A card's title renders at the column heading's own size, so the board reads as one surface
rather than a page of blocks.

## Rules and behaviour

### The board's columns are the task's status

The six columns are the task's only status field: `done`, `in-progress`, `today`,
`this-week`, `next-30-days`, `backlog`. The board draws them in that order: **Done**,
**In-progress**, **Today**, **This week**, **Next 30 days**, **Backlog**. The order of cards
inside a column is persisted as their order in the task list, not as a separate sort field,
so a drop above a card is a real write and a no-op drop is not a write at all.

### What a task carries, and who added it

A task is `{ id, title, notes, column, links }`, plus a stored `origin`. The links are
optional and single-valued: `goalId`, `projectId`, `date`, a `weekItem` of year + Monday +
item id, and `signalId` (the Quick Notes capture a task was made from). Tasks have no area
field, so the board itself is vault-global; the lens names the page title and filters the
recent-activity strip, not the columns.

`origin` is written once, when the task is created, from the actor that created it. A card
the companion made reads `agent` and keeps the **Added by agent** glyph after it is renamed
or dragged; a card the operator made reads `operator`. Map files written before provenance
existed, and hand-edited ones, read as operator. This is the wings law: wing tabs switch the
rail and never filter page data — [`LAWS/WINGS.md`](../../LAWS/WINGS.md).

### Who writes what

- Your board actions go through the same map command bus as Architecture and Daily
  Schedule: create, update, move and delete apply immediately and write the map store.
- Tasks live in `.lifequest/map.json` in the map store's `tasks` list — there is no
  per-task file.
- The companion's task tools — **create_task**, **update_task**, **move_task**,
  **delete_task** — also apply immediately rather than waiting in
  [Decisions](./23-decisions.md). A companion that marks a task done by moving it to
  **Done**, or a dispatched agent that adds a card, is visible on the board on the next
  vault refresh. A card the companion creates this way wears the **Added by agent** glyph.
- That is different from Architecture's day-template tools (day types, the default week and
  weekly items), which are Decision-gated and wait for approval.

### Send to agent

Sending starts work outside the board, so the card's **Send to agent** key asks first in the
app's own confirmation. The question names the three facts: a new session starts, this
card's context is handed to the agent, and the task stays on the board until the agent moves
it to **Done**. Only **Send to agent** in the question does anything.

A confirmed send creates a chat titled `Task · <title>`, opens the dock on that chat, and
sends a kickoff as its first message carrying the task's id, title, notes, column, and its
goal, project and week-item names. The agent is told to call `move_task` with `done` only on
genuine completion, and otherwise to leave the card and say what blocked it. A failed send
prints on the board and writes no map command; the card does not move by itself.

### Run an agent

The **Run an agent** section is the older, prompt-driven dispatch: it sends a task prompt to
the chosen agent together with the active area's doctrine. **Run** is disabled until the
current scope has a non-empty Strategy (How) document; the hint under the button reads: "Add
a Strategy (How) in Track to enable dispatch." With no active agents, the section offers
**Manage agents** and a link to **Go to Agents →**.

### Where tasks appear outside this page

- **Daily Schedule** shows every unplaced task in the **Today** column in its **Leftover**
  list, prefixed **Task ·** and the task's title, and placing one creates a live block.
  Completing it there sets the task to **Done**. See [Daily Schedule](./13-daily-schedule.md).
- A task made from a Quick Notes capture is created in **Backlog** with its `signalId` set;
  the capture then reads **Open task** and links back to `/act?task=<id>`. See
  [Quick Notes](./15-quick-notes.md).
- Projects collate the tasks that point at them on the project page. See
  [Projects](./12-projects.md).
- The [Life Map](./11-life-map.md) does not draw task cards in this release. Dates on a task
  are its own `links.date`; the calendar's events are separate records.

## Tips and edge cases

- The quick add at the top always creates in **Backlog**. If you want the card in **Today**,
  add it from that column's own **Add a task** instead of dragging it afterwards.
- The column composer is a popup: a press anywhere outside it, or Escape, closes it. **Add**
  deliberately keeps it open so several cards can be entered into one column in a row.
- A task with no goal, project, date, week item or signal shows no metadata chips at all;
  the card is its title and notes.
- **Notes** save on blur, not on every keystroke. Click out of the box before closing the
  card if you want the write to land immediately — closing the card does not discard what
  you typed, because the blur happens first.
- The **Added by agent** glyph is provenance, not a live status: it does not clear when you
  rename, recategorise or move the card, and it never appears on cards that existed before
  0.2.3.
- The week-item picker only offers weeks that exist in the current map years. A stored link
  whose year or week has gone is kept and shown as missing rather than silently cleared.
- Opening `/act?task=<id>` for a task that no longer exists opens the board; there is no
  error alert for a stale link.
- **Send to agent** is disabled while any send is in flight, so two cards cannot start two
  chats from one press.
- **Run an agent** is disabled until the current scope has a non-empty Strategy (How)
  document. The reply shown in the run block is the agent's words; what it *wrote* is in the
  vault and the log.
- The task board was renamed **Task Manager** in 0.2.8, but the route still matches `/act`
  and a task link still arrives as `/act?task=<task-id>`.

## Related

- [Daily Schedule](./13-daily-schedule.md) — the day's clock, fed by the **Today** column.
- [Quick Notes](./15-quick-notes.md) — captures that become backlog tasks.
- [Projects](./12-projects.md) — the project a task can point at.
- [Goals](./10-goals.md) — the goal a task can point at.
- [Agents](./25-agents.md) — hiring the agents **Run an agent** dispatches.
