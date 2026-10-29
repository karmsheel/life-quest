# Goals

A Goal is a vault-wide outcome you are trying to reach: a name, optional notes, an optional domain, an optional deadline, and one way of measuring success — either a number (a metric with a target and a current value) or a written definition of done. Goals are not tied to a year and not tied to a page's calendar. They are the "what" that tasks, projects, and Life Map events can point at.

You manage goals on the **Goals** page. The same records appear on the **Dashboard** (`/home`) as a **Goals** card and, when a deadline is close, a **Deadline pressure** banner.

## Where it lives

- Plan wing, rail label **Goals**, icon Goal, route `/goals`. Page, not a sheet.
- Plan wing's default page: opening Plan lands here unless the wing remembers another Plan page.
- The records live in `.lifequest/goals.json`; they are not markdown files and not part of the Life Map's year records.

Return to [Wiki home](./README.md).

## What it is for

Goals keep outcomes separate from activities. A task is something you do; a goal is something that becomes true. A goal can be measured with a number — pages written, kilometres run, sessions booked — or defined in words for outcomes that are not numeric. The page lists open goals, lets you update the current value or close one, and keeps the history of done goals in its **Done** filter.

Goals connect to the rest of the app in three ways: an event on the [Life Map](./11-life-map.md) can link to a goal; a task or project can link to a goal; and the Dashboard surfaces open goals and upcoming deadlines. Unlike doctrine, a goal has no lock and no body document.

## How to use it

1. Open **Goals** from the Plan rail. The list filters to **Open** by default; use **Open**, **Done**, or **All** to change it.
2. Create a goal in the form at the top: give it a **Name** (required), optional **Notes**, an optional **Domain**, and an optional **Deadline**.
3. Choose how it is measured with the **Metric** / **Definition of done** switch.
   - **Metric** asks for **Metric** (`km, pages, sessions`), **Current** (`0`), and **Target**.
   - **Definition of done** asks for a written description.
4. Click **Add**. The goal is created open and appears in the list.
5. Click any row to edit it. The same form fills with its values, a **Status** field appears (**Open** or **Done**), and the actions become **Save**, **Cancel**, and **Delete**.
6. To close a goal, set **Status** to **Done** and click **Save**. It leaves the open list and appears under **Done**.
7. To delete a goal, click the row, then **Delete**, and confirm **Delete goal**. The record leaves the vault and nothing restores it.
8. To start or resume a planning session around the current period, choose a cadence — **Weekly**, **Monthly**, **Quarterly**, or **Yearly** — and click **Plan this period**. The plan opens as a companion session in the chat pane, scoped to the active domain lens if you are in one.

Domain lens behaviour: on **Overview** the list shows every goal, including unassigned ones. With a domain lens, only that domain's goals are listed, and unassigned goals are hidden. A new goal's **Domain** defaults to the active lens, or **Unassigned** on Overview.

Empty states: **No goals yet.** on Overview, **No goals in {domain}.** with a domain lens, **No open goals.** or **No done goals.** when the filter is empty but the lens has goals.

## The screen

| Part | What it does |
|---|---|
| **Goals** heading and description | `Vault-wide outcomes. A deadline and either a metric or a definition of done live on the goal.` |
| Plan cadence switch | **Weekly**, **Monthly**, **Quarterly**, **Yearly** |
| **Plan this period** | Creates or resumes a planning session for the current period in the current scope |
| **Open** / **Done** / **All** | The status filter; **Open** is the default |
| Composer | **Name**, **Notes**, **Domain**, **Deadline**, measure switch, measure fields, and **Add** (or **Save** / **Cancel** / **Delete** while editing) |
| Goal row | Name, **Open** or **Done**, domain or **Unassigned**, deadline, `current/target metric`, the definition of done, the number of linked events, and a truncated notes line |
| Error line | The vault's reason when a write is refused |

The form's measure switch is a segmented control labelled **Metric** and **Definition of done**. The numeric fields accept blanks; a metric and a target must be given together.

**Composer fields.**

| Field | Required | Notes |
|---|---|---|
| **Name** | Yes | The only field the vault will not accept empty |
| **Notes** | No | Free text; the row shows a truncated line |
| **Domain** | No | **Unassigned** plus every live domain; defaults to the active lens |
| **Deadline** | No | A date picker; stored as `YYYY-MM-DD` |
| **Metric** | With **Target** | The unit: `km, pages, sessions`, or your own |
| **Current** | No | Defaults to `0` when a metric exists |
| **Target** | With **Metric** | The number the metric is counting toward |
| **Definition of done** | No | The written alternative to a metric |
| **Status** | Only while editing | **Open** or **Done**; new goals are always open |

**Where a goal shows up.**

| Surface | How the goal appears |
|---|---|
| This page | The full record, with the status filter |
| Dashboard **Goals** card | Open goals in the lens, with inline current value or a done checkbox |
| Dashboard **Deadline pressure** banner | Open goals due in the next seven days, as a dismissible banner |
| Life Map event editor | The event's optional **Goal** picker; open goals are listed |
| Act and Projects | Their own optional goal links, in their own pages |

## Rules and behaviour

**The record.** A goal is a JSON record with `id`, `name`, `notes`, `status` (`open` or `done`), `domainSlug` (or `null` for unassigned), `deadline` (or `null`), `metric`, `target`, `current`, and `definitionOfDone`. New goals are always `open`; **Status** only appears while editing. The whole store is written atomically to `.lifequest/goals.json` as `{ "goals": [ … ] }`.

**Validation.** The vault refuses a goal with no name, a domain that is not live, a deadline that is not `YYYY-MM-DD`, a non-numeric target or current value, or a metric without a target (or the other way round). The reasons appear in the form's error line rather than as a modal.

**Progress is what you write, not a formula.** The **Current** field is the progress: the row shows `current/target metric`, and the Dashboard adds a pace line calculated from the deadline. Nothing counts completed tasks into a goal automatically; if you want the current value to move, update it. A goal with no metric or target stays Open until you mark it Done.

**Pace and deadlines.** For a numeric goal with a deadline, the Dashboard computes the pace from today's date and the deadline in UTC calendar days: remaining units are `target − current` (never below zero), and the label ends in one of `N days left · R metric remaining`, `1 day left · R metric remaining`, or `X days overdue · R metric remaining`. A deadline is a date, not a time; it is not drawn on the Life Map by itself.

**Definition of done.** A written definition is stored as text and shown on the row. It has no auto-check: closing the goal is your act, either from the **Status** field here or from the Dashboard card's checkbox for that goal.

**Deleting.** Deleting asks first, in the app's own dialog: `The goal leaves the vault, and so does everything it measures.` with the confirm button **Delete goal**. The goal disappears from `goals.json`; events that linked to it keep their stored `goalId`, and the event editor shows that goal as `(missing)`.

**The domain lens filters goals, not the calendar.** Goals are a domain-scoped list, so the lens filters this page and the Dashboard cards. The Life Map's event editor is the exception: its **Goal** picker lists every open goal, whatever the lens. The filter law is [LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md). Wings do not filter data ([LAWS/WINGS.md](../../LAWS/WINGS.md)); being in Plan does not mean the list ignores the lens.

**History.** Create, update, and delete append `goal.created`, `goal.updated`, and `goal.deleted` to the Life log, with the goal's domain when it has one. They appear on the [Log](./26-log.md).

## Goals on the Dashboard

The Dashboard is a pin board per lens. Every board starts with the built-in cards pinned, and the goal-related ones are:

**The Goals card.** It is headed **Goals** with a count of open goals in the current lens. Each open goal is a row:

- A numeric goal shows an input bound to its **Current** value. Changing it and leaving the field, or pressing Enter, writes the new current value; `/ target metric` and the pace line sit beside it.
- A goal with a definition of done shows that text with a checkbox. Checking it sets the goal **Done** and the goal leaves the open list. The card does not reopen a done goal; do that with **Status** on the Goals page.
- Otherwise the row says **Open**.
- Empty state: `No open goals in this lens.` The card ends with **Open Goals →**, which opens this page.

**The Deadline pressure banner.** It is a separate card. When an open goal in the lens has a deadline within the next seven days — including goals already overdue — it shows **Deadline pressure**, the first goal's name (or that name and "N others"), and a **Dismiss** button whose tooltip is `Dismiss until tomorrow`. Dismissing hides it for the rest of the local day. It is a banner, not a link: it does not open the goal.

Because these are cards, they can be moved, resized, removed, and added back from the Dashboard's pin board; the board's lock governs the board's own arrangement and the companion's edits there, not the goal records themselves. Removing a card does not delete any goal.

## Companion proposals

The companion can read goals with `list_goals`, but its writes do not land directly. An agent's create, update, or delete of a goal is filed as a pending Decision with the target kind **Goal**; the pending card's headline is the proposed goal name. **Approve** runs the goal command against `goals.json`; **Reject** leaves the file untouched. This applies to goal records exactly as it does to doctrine: see [Decisions](./23-decisions.md). Operator edits on this page are written directly.

## Tips and edge cases

- **A goal has no year.** It is vault-wide and unchanged when the calendar year rolls over; only events, weeks, and month text belong to a year.
- **A deadline does not create an event.** If you want a date on the Life Map, add an event and link it to the goal; the goal's own deadline is not painted on the calendar.
- **The list is in insertion order.** New goals append; there is no manual reordering or ranking.
- **One measure at a time.** A saved goal carries one measure: choosing **Definition of done** sends the numeric fields as null, and choosing **Metric** sends the definition as null.
- **Events are counted, not shown.** A row's "N events" is the number of Life Map events whose `goalId` points at it. Deleting the goal does not delete those events.
- **The pace line is quiet.** It states days and remaining units; it never draws a projected finish date or an expected linear track, because the vault does not know the start date.
- **Plan this period is not a goal editor.** The cadence switch and **Plan this period** open a review/planning session in chat; they do not create a goal. See [Reviews](./18-reviews.md).

## Related

- [Wiki home](./README.md)
- [Life Map](./11-life-map.md)
- [Projects](./12-projects.md)
- [Reviews](./18-reviews.md)
- [Decisions](./23-decisions.md)
- [The Log](./26-log.md)
