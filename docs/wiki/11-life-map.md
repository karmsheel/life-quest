# Life Map

The Life Map is the year canvas: one page that shows a year as four quarters and twelve month grids, opens any month as a Monday–Sunday calendar, and keeps the year's events. It is the place a single date lives — a deadline, a trip, a launch, a birthday — with notes, an optional domain, and an optional link to a Goal. Months also carry their own short text and a Main Objectives / Notes pair.

The Life Map draws events, not tasks and not goal records. Tasks are on [Act](./14-act.md), [Daily Schedule](./13-daily-schedule.md), and the Dashboard's **Today & this week** card. A goal's deadline pressure is a Dashboard banner; an event linked to a goal is how a goal's date appears on the calendar. Weeks as a rhythm belong to [Architecture](./08-architecture.md).

## Where it lives

- Plan wing, rail label **Life Map**, icon Map, route `/chart`.
- Page, not a sheet. The year dashboard and the month view are two states of the same page; a **Back to dashboard** button returns from the month.
- The selected year is session state shared with Architecture; it is not written into the vault.
- Map data lives in `.lifequest/map.json`: the years, their events, their month text, and the detached weeks that Architecture edits.

Return to [Wiki home](./README.md).

## What it is for

Life Map answers "when". The year dashboard gives you the macro scope — the shape of the year, the quarters, which days already carry something. The month page gives you the near view: a calendar with a text field for every day, the month's events listed under the grid, and two free-text fields for objectives and notes. It is a calendar, not a task board: it records what happens and what a day means, and leaves doing to the Execute wing.

## How to use it

1. Open **Life Map** from the Plan rail. The **Year** selector sits in the header; live years come first, oldest to newest, then archived years newest first, each archive labelled `YYYY (archive)`.
2. To change years, use the **Year** selector. Life Map and Architecture follow the same selection for the session.
3. To add a future year, click **Add {YYYY}**. The button appears only when a live year can still be added and a year in the current year's range is missing. The vault allows at most three live years: the current calendar year and up to two future years.
4. To delete a year, use **Delete year** (a live year that is not the current year) or **Delete archive** (an archived year). A live future year with content asks first; an empty one deletes on the click. The current calendar year cannot be deleted and shows no button.
5. To read a month, click its name in a quarter block. The month page opens with **Back to dashboard** at the top.
6. To add an event from the dashboard, click **Add event** in the **Events** panel, fill in **Title**, **Date**, **Notes**, **Domain**, and **Goal**, then click **Add**. Clicking a day cell in the quarter grid also opens the form with that date filled in.
7. To edit an event, change any field in its row; the change commits on blur or on the select change. To remove one, click **Delete** on its row.
8. To write a day, open the month page and type in that day's text field; the text saves when the field loses focus.
9. To write the month's objectives and notes, use **Main Objectives** and **Notes** at the bottom of the month page; both save on blur.
10. To open the active domain's vision from the map, use the **Vision & Desire** strip at the top; **Edit** opens that document on the [Vision](./07-doctrine.md) page.

With no events, the panel says **No events this year.** on Overview or **No events in {domain}.** with a domain lens. A month with none says **No events this month.**

## The screen

**Year dashboard.** The header has the **Life Map** heading, the **Year** selector, and the year's buttons. Below it, the **Vision & Desire** strip appears when a domain lens is active. The dashboard is headed `{year} Dashboard (Macro Scope)` and holds four quarter blocks — **Q1** through **Q4** — each with a month-name button and a compact day-number grid where event colour marks stack under the day. An **Events** panel sits beside the quarters.

**Month page.** **Back to dashboard** and the heading `{Month} {year}`; then a Monday–Sunday grid. Each in-month cell has the day number, its event marks, and a text field. Below the grid: the month's **Events** list, **Main Objectives**, and **Notes**.

**Event panel.**

| Field | What it is |
|---|---|
| **Title** | The event's name |
| **Date** | A single date inside the selected year |
| **Notes** | Free text |
| **Domain** | **Unassigned** plus every live domain; a domain lens preselects it |
| **Goal** | **None** plus open goals; an event may point at one |

The **Add event** and **Add** buttons are shown only on a live year. On an archived year the panel is read-only: the fields are disabled and no add or delete is offered.

**Event marks.** A day with events shows one small mark per event, coloured from the event's domain colour. Unassigned events, events whose domain is missing or archived, and domains with no colour use the theme's default mark. There is no event colour picker; the colour belongs to the domain.

**The two views.**

| | Year dashboard | Month page |
|---|---|---|
| Scope | One year, all twelve months in four quarters | One month, Monday–Sunday |
| Navigation in | The **Life Map** rail row | Click a month name |
| Navigation out | The **Year** selector and the year buttons | **Back to dashboard** |
| Events | Marks on every day, plus the year's **Events** panel | Marks on each day, plus the month's **Events** list |
| Free text | None | A field per day, **Main Objectives**, **Notes** |
| Editable? | Live year only | Live year only |

**The year record.** Each year in `map.json` carries its `year`, its `status` (`live` or `archive`), an `events` array, twelve `months` records (each with `objectives`, `notes`, and a `days` map keyed by day number), and `detachedWeeks` keyed by Monday date. An archived year also carries the frozen `snapshot` that [Architecture](./08-architecture.md) reads for its templates.

## Rules and behaviour

**What the year holds.** Each year has a status (`live` or `archive`). The vault ensures the current calendar year exists when it opens and archives any live year that has ended, freezing a snapshot of that year's day types, default week, and materialised weeks. Archives are unlimited and read-only.

**Years.** At most three live years can exist: the current year plus two future ones. The current calendar year cannot be deleted; a future live year with content asks before deleting; an archive can be deleted from the Life Map. Adding is only offered on the Life Map dashboard, not on Architecture.

**Events are single-date.** An event has one date, no time of day, no recurrence, and no end date. Several events may share a day and are all listed and marked. Events belong to their year: the date picker is bounded to January 1 through December 31 of the selected year.

**Goal links.** An event's **Goal** is optional. The picker lists open goals and labels a done goal `(done)`; an event whose goal was deleted keeps its stored id and the picker shows that id as `(missing)`. Deleting a goal does not delete its events. The goal's own deadline is a goal field; the map does not paint it — the Dashboard's **Deadline pressure** card is where goal deadlines surface, and an event is how a date is drawn on the calendar. See [Goals](./10-goals.md).

**No tasks on the map.** This release draws no task cards here. Tasks live on the Act board, the Daily Schedule's clock and leftover list, the Projects page, and the Dashboard's **Today & this week** card. A task can carry a date link, but the Life Map does not render task rows.

**No period goals.** Older builds painted named, coloured date ranges onto the year. That model is gone: the map's dated objects are the single-date events described above, and goals are vault-wide records with optional deadlines.

**Archived years are read-only.** In an archived year the month grid, day text, objectives, notes, and events are all view-only. The banner **Read-only archive** says so, and only **Delete archive** changes anything about the year. Opening a year's archive does not alter its snapshot.

**The domain lens.** The lens filters the event marks and the **Events** panel; the year grid, quarter layout, month text, objectives, and notes stay unfiltered. Unassigned events are visible on Overview and hidden in a domain lens; a new event's **Domain** defaults to the active lens. This is the filter law for domain-scoped lists: [LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md). The wings themselves never filter data: [LAWS/WINGS.md](../../LAWS/WINGS.md).

**Navigation.** There is no zoom control: the page scrolls vertically, the month calendar and quarter grids fit the content width, and the browser's own scrolling moves you through it. There is no calendar-specific keyboard navigation; the arrow keys belong to the rail's wing and lens switching. Mouse paths are the month-name button, the day cell, the **Back to dashboard** button, and the year's delete and add buttons. There is no drag-to-paint range on the year grid.

**What the vault refuses.** Every edit is a map command validated against the store:

- Writing to an archived year fails with `Archive is read-only`.
- An event needs a non-empty title, a valid ISO date inside its own year, a live domain, and an existing goal if one is named.
- A year can only be created in the current year's range, and only while fewer than three live years exist.
- The current calendar year cannot be deleted; a missing year or event is a not-found error rather than a silent write.
- A malformed map file is reported and left alone rather than overwritten with empty state.

**Where it fits the rest of the plan.** The Life Map is the calendar; [Architecture](./08-architecture.md) is the weekly template; [Daily Schedule](./13-daily-schedule.md) is today's live copy; [Goals](./10-goals.md) is the outcome list. They share the vault and the domain lens, but they write to different records: events to the year, templates to the map store, goals to `goals.json`.

**Companion.** The map tools let a companion read the map, create and edit years and events, and write month text. Event writes apply directly; goal records (including their deadlines) go through Decisions, as described on [Goals](./10-goals.md). Reads need no approval.

## Tips and edge cases

- **A month view is not a separate page.** **Back to dashboard** or changing the year clears the month selection; coming back to the Life Map without either reopens the month you were reading.
- **The year dashboard is the only place to add or delete years.** Architecture's year selector only reads.
- **Clicking a day opens the event form, not a day editor.** Day text is edited with the small field in the month grid, which appears only on the month page.
- **No event times.** Two events on the same day are both drawn; the map cannot order them by time because it does not store one.
- **Archives keep what the year actually had.** The archived snapshot includes the day types, default week, and weeks that existed when the year was rolled over, which is why Architecture shows a frozen plan for it.
- **A goal deadline is not an event.** Creating a goal with a deadline adds nothing to the calendar; add an event and link it if you want it drawn.
- **The Events panel is sorted, not draggable.** The list is ordered by date, then title; there is no manual event order.
- **Works with an empty vault.** An empty map still opens on the current year with no events; the dashboard and month pages render their empty states.
- **The map is per vault, not per domain.** There is one global calendar; the lens filters events and marks, never the years or the days.
- **Nothing here writes to Architecture.** Month text, objectives, notes, and events are separate records from day types, the default week, and real weeks.

## Related

- [Wiki home](./README.md)
- [Architecture](./08-architecture.md)
- [Goals](./10-goals.md)
- [Daily Schedule](./13-daily-schedule.md)
- [Act](./14-act.md)
- [Projects](./12-projects.md)
