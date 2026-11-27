# Reviews

A review is a look back over a period you have actually lived, written down in
the vault, ending in what the next period is for. The Review wing gives
each cadence its own page. **Daily** is one general review of the day. **Weekly**,
**Monthly**, **Quarterly** and **Yearly** add a **Review checklist** on the right:
one button per life area, each opening that area's own interview and its own
page of the period's review notebook, and a **Life review** that opens only once
every area is done and that sums the area reviews up through the whole-life — life-vision —
perspective. The single idea: a review is a durable vault document, not a chat
transcript — the report outlives the session that helped write it.

The new period's review is not available the instant the period starts. Each
cadence has its own **review window**: the page opens on the latest period whose
window has opened, and until then it keeps showing the previous period. Daily
opens at 18:00 on its own day; weekly opens at 08:00 on the week's last day;
monthly opens on the second-last day of the month; quarterly on the third-last
day of the quarter; yearly in the last week of the year. All five are editable in
**Settings → Review**.

## Where it lives

The Review wing is the last wing in the rail's wing switcher, after **Act**. Its
rail has five rows, each a page at its own route:

| Rail label | Route | Period it covers |
|---|---|---|
| **Daily** | `/review/daily` | One local calendar date |
| **Weekly** | `/review/weekly` | A week, starting Monday or Sunday |
| **Monthly** | `/review/monthly` | One calendar month |
| **Quarterly** | `/review/quarterly` | A calendar quarter |
| **Yearly** | `/review/yearly` | A calendar year |

Each opens in the centre pane as a page, not a sheet. Any other cadence segment
under `/review/` redirects to `/review/weekly`. The header is the Daily
Journal's, at a period's scale: the grey eyebrow names the wing and the cadence
— **Review / Daily**, **Review / Weekly**, **Review / Monthly**,
**Review / Quarterly** or **Review / Yearly** — and the period itself is the
page's one heading, centred over the prose. A week's heading names both of its
ends and its calendar-week number, for example
`21-27 Sep '26 (W39)`. A calendar key beside the heading
jumps to another period, and wordless arrow keys on the column's edges step one
period at a time. The cadence is never repeated as a second title.

**Daily is one general review of the day.** It has no checklist and no area
sections, and the area lens does not narrow it: a day is reviewed as a day,
because a day is too short to be cut into six interviews.

**Weekly, monthly, quarterly and yearly carry the Review checklist** in a
vertical column to the right of the report:

- **Life review** sits first — the overall review, the whole-life view the area
  reviews feed.
- Then one row per live area, labelled **Health review**, **Mind review**,
  **Finance review**, **Business review**, **Relationships review** for a vault
  with those areas open. A locked or archived area is not listed.
- Every row is a button, and every row reads **Not started**, **In progress** or
  **Done**. The row for the active scope is highlighted.
- The checklist is **live**. When the companion finishes an interview and marks
  an area — or the life review — complete, the row on the page you already have
  open flips to **Done** and the `n of 5 areas done` count moves with it, with no
  navigating away and back. The same is true of the Life review unlocking once
  the last area is finished, and of the **Locked** badge when the life review is
  completed.
- The **report is live too**. The companion writes the review body as you answer
  its interview, and the open page fills with what it wrote as it goes; when it
  marks the review complete, the locked file's final text is what the box shows.
  You do not have to leave the page and come back to see the review the agent
  wrote. An unsaved sentence of your own is kept until the file is locked; a
  finished review shows the file, because the box is read-only from then on.
- The area lens in the window title bar still selects the active area, and
  pressing a checklist row moves the lens to that area. The checklist is the
  control; the lens shows what is selected.

The page keeps the Daily Journal's 48rem measure. The eyebrow and the period
pager sit across the top of the page in that measure, and the report and the
checklist come under them. Where the sheet has room for the two together they
sit side by side, the pair centred in the page's own side padding with the same
margin on both sides. Where it does not — an open chat dock beside the page, or
a narrow window — the checklist takes its own row between the header and the
report, and the document keeps its full measure (or the room the sheet has, with
equal margins either side). The prose is never narrowed to make room for the
checklist; when the sheet widens again, the checklist returns to the side.

Back to [Wiki home](./index.md).

## When a review opens

Every cadence has a window: the period's review becomes available part-way
through the period, never at its first instant. Before the window opens, the
page shows the **previous** period — where you can still write or edit, exactly
as before. The defaults are the ones below; **Settings → Review** changes each
one, including the wall-clock time.

| Cadence | Default window | What the page shows before it opens |
|---|---|---|
| **Daily** | Opens on its own day at **18:00** | Yesterday's daily review |
| **Weekly** | Opens on the week's **last day at 08:00** (Sunday for a Monday start) | The previous week's review |
| **Monthly** | Opens on the **second-last day of the month** at 00:00 | The previous month's review |
| **Quarterly** | Opens on the **third-last day of the quarter** at 00:00 | The previous quarter's review |
| **Yearly** | Opens in the **last week of the year** (25 December) at 00:00 | The previous year's review |

The window has two halves: a number of days before the period's last day, and a
local time of day. A weekly review with 0 days and 08:00 opens on the last day at
8 a.m.; a monthly review with 1 day and 00:00 opens on the second-last day at
midnight. A pager note says when the calendar-current period opens, for example
*The daily review for the current period opens 15 Nov 2026 at 18:00.* Until then,
**Next** stops at the open period, because the newer review does not exist to
page to. The vault engine enforces the same rule, so a companion or connected
agent that asks to create the unopened period's review is refused with the
opening time, not silently allowed.

The window follows the vault's **Week starts on** setting: with a Sunday start,
the weekly review opens on Saturday at 08:00. See [Settings](./28-settings.md).

## Reviews on the Dashboard

A review is also a recurring item. The Dashboard's **Today & this week** card
leads with its **Recurring** block, above the task columns, and each cadence that is due
appears there as one row: **Daily review**, **Weekly review**, **Monthly
review**, **Quarterly review**, **Yearly review**.

- A cadence is due once its review window has opened for the latest period and
  that period's overall review is not marked done. The row links to the cadence's
  page — `/review/weekly` for **Weekly review** — and says where it stands: **Due
  today** when the window opened today, **Overdue** when it opened earlier.
- The row has **no tick**. The review file is the record, so the Dashboard cannot
  mark a review done: you finish the review on its page, and marking the overall
  review done clears the row. A locked review is one whose overall review is
  done, so its row is gone too.
- Nothing is added to the Task Manager's **Recurring tasks** list for a review:
  the five cadences are built in, and their rows are derived from the vault's
  review index. See [Task Manager](./14-task-manager.md).
- A cadence whose overall review is done is silent on the card until its next
  window opens, and a cadence whose window has not opened yet is silent too — the
  card shows only what is actually due.

[`LAWS/RECURRING.md`](../../LAWS/RECURRING.md) is the contract for these rows.

## What it is for

Reviews turn a lived period into something you can read back and something the
next period can be planned from. A period is a **notebook**: one markdown page
per area plus the overall page, all inside the vault under the period's own
directory. The overall review is four headings, and each area you review is a
page rather than a document of its own — which is also what lets two area
interviews be written at the same time without overwriting each other. Splitting a period into an interview per area
keeps each segment of a life small enough to think about on its own — health on
its own terms, money on its own terms — and the **Life review** is where the
segments are put back together. It reads every area section and says what they
mean together, through the life vision, rather than repeating one area.

The companion session for a period and scope resumes the same thread instead of
starting a new one, and a review marked done is locked so the "final" record
cannot be quietly rewritten.

## How to use it

1. Choose **Daily**, **Weekly**, **Monthly**, **Quarterly** or **Yearly** in the
   rail. The page opens on the latest period whose review window is open — often
   the previous period, because the new one opens part-way through
   ([When a review opens](#when-a-review-opens)).
2. Move the period with the two arrow keys on either side of the header, or
   jump with the **calendar** key beside the centred period. The heading reads
   the period, for example `21-27 Sep '26 (W39)` on Weekly.
   **Next** is disabled on the open period: reviews are past and present only,
   and a review that has not opened yet cannot be paged to. The calendar offers
   only periods whose window has opened, and choosing any day inside a week
   takes you to that week.
3. On **Daily**, a period with no file says **No review for this period yet.**
   and offers **Start the interview** (create the file, fill the figures the
   cadence's rules ask for, open the companion chat) or **Write it myself**
   (create the file and edit it without starting a session).
4. On **Weekly** and longer, the checklist is the way in. Press an area row — say
   **Health review** — and:
   - the period's notebook is created if it has none, with the overall page and
     a Health page;
   - the figures this cadence's rules ask for are filled by the app;
   - the Health interview opens in the chat pane, bound to this period's Health
     scope — in a tab of its own, and listed in **Chats** under its name from
     its first paint, even while the agent is still writing;
   - the **Health review** row becomes the checklist's selected row, and the
     review is on the Health scope.
5. Write in **Document** mode. The editor takes the whole file, renders markdown

   as you go, and saves itself after a short pause, when the pointer leaves the
   editor, and on Ctrl/Cmd+S. The status under the document reads **Saved**,
   **Saving…**, **Not saved**, or **Locked**.
6. Press **Mark Health review complete** when that area's section says what you
   wanted. The checklist row flips to **Done**; the notebook stays editable and
   the other areas stay open. An area you have not started reads **Not started**, and
   one you opened reads **In progress**.
7. Work through the areas. The **Life review** row counts them — `2 of 5 areas
   done` — and stays disabled until every live area reads **Done**.
8. When the last area is done the page says **Every area is reviewed — the life
   review is ready.** Press **Life review**. Its interview reads every area's
   page and summarises across them — what the
   areas say together, where they pull against each other, and what that means
   for the life vision — into the overall **Look-back**, **Keep**, **Change** and
   **Next-period intent**.
9. **Mark life review complete** finishes the overall scope and locks the file.
   The companion normally marks a review complete itself once you have answered
   its interview, so on a locked review the mark-complete button is gone — the
   row keeps **Unlock**. On a locked review the pager shows a **Locked** badge,
   the checklist is read-only, and **Unlock** appears in the action row. Unlock,
   then edit in place.
10. **Plan next period** takes period N to a planning session for N+1, opens that
    session in the chat dock, and navigates to **Goals**.
11. Open **Review rules** to read or edit the standing rules for this cadence,
    then **Save rules**. This is the file handed to every session of the cadence.

At the bottom of every review page — empty or not — sits **Daily notes in this
period**: the days you wrote in the window, newest first, with a one-line
excerpt. Click a day to read the note. With none, the panel says **No daily
notes in this period.** and offers **Write today's note**.

## The screen

| Part | What it does |
|---|---|
| Eyebrow, period heading and pager | The grey eyebrow naming the wing and cadence (for example **Review / Weekly**); the period as the page's one heading (for example `21-27 Sep '26 (W39)`), centred with a **calendar** key beside it; wordless arrow keys on the column's edges; a **Locked** badge when locked. |
| **Review checklist** | Weekly and longer only; a vertical column beside the report where the sheet has room for the 48rem page and the rail together, and a full-width row between the header and the report where it does not — the reading column is never narrowed to make room for it. **Life review** first, then one button per live area with **Not started** / **In progress** / **Done**, a `<done> of <total> areas done` count, and the hint that the life review waits for every area. |
| Status text | Under the document: **Saved**, **Saving…**, **Not saved**, **Locked**, or **No review for this period yet**. There is no scope line above the body — the checklist's selected row says which review the page is on. |
| Editor | The Daily Journal's live markdown box at the journal's height, with square corners and its own review title as the first line — `W46 Review: 9-15 Nov '26` — placeholder **Write this review.**, read-only while locked. |
| Action buttons | **Start interview** (resumes the active scope's session), **Plan next period**, a mark-complete button — **Mark life review complete** / **Mark Health review complete** / **Mark review complete** on Daily — while the review is open, and **Unlock** once it is locked. The mark-complete button is gone on a locked review: the companion marks the review complete itself once you have answered its interview. **Start interview** and **Mark life review complete** are disabled for Life until every area is done. |
| **Review rules** | A collapsible panel: the cadence's standing rules and its `lifequest-snapshot` directives, with a count and whether they come from your file or the shipped defaults. |
| **Daily notes in this period** | The journal entries whose dates fall inside the review window. |

The review page has no page menu and no lock switch of its own: a locked review
shows the **Locked** badge in the pager and an **Unlock** button in the action
row. The lock is set by **Mark life review complete** on the overall scope, not
by a separate control.

All five cadences open the same page, and the report column is the Daily
Journal's measure: the title and pager, the body, the actions and the daily-notes
strip share one 48rem column, inset from the sheet's edges by the page's own side
padding. On a wide monitor the checklist rides beside that column and the pair is
centred; a narrow window only shrinks the column to fit and puts the checklist
above it.

The review page has no list of past reviews. You reach a period with the pager;
the vault index of all review files exists for the companion and the snapshot,
not as a screen.

## Rules and behaviour

A notebook per cadence and period. The laws are short and enforced by the
engine: a review period is a directory at `reviews/{cadence}/{period}/` holding a
`review.json` manifest and one page per scope; an area review is its own page, a
daily review is one general review with only an overall page, an overall review
on a weekly-or-longer cadence cannot be finished before every live area's page
is done, the notebook locks when the overall review is done, planning stubs live
under `planning/` with no plan body, and week start cannot change while weekly
review or planning files exist. It is restated in
[LAWS/REVIEWS.md](../../LAWS/REVIEWS.md).

| Cadence | Period string | Example notebook |
|---|---|---|
| Daily | `YYYY-MM-DD` | `reviews/daily/2026-10-29/` |
| Weekly | week-start date | `reviews/weekly/2026-10-26/` |
| Monthly | `YYYY-MM` | `reviews/monthly/2026-10/` |
| Quarterly | `YYYY-Qn` | `reviews/quarterly/2026-Q4/` |
| Yearly | `YYYY` | `reviews/yearly/2026/` |

Notebook shape. `review.json` carries `cadence`, `period`, `weekStartDay`,
`title`, `locked`, `order` (`overall` first, then the area slugs), and a `rev`
that moves only when pages are added or the lock changes. `overall.md` and each
`{area-slug}.md` page start with `# <title>`, then `## Look-back`, `## Keep`,
`## Change`, `## Next-period intent`. A page's frontmatter carries its `scope`,
`title`, `status` (`draft` or `done`), an optional companion `sessionId`, and a
`rev` that increments on every accepted body write; a write quotes the rev it
read, so two interviews on two pages never fight and a write to the same page
that missed a change is refused rather than overwriting it. Extra headings you
type are kept after the required blocks, and a save canonicalises this skeleton
and preserves the prose under each heading.

The page the app shows is assembled from the notebook's pages, which is also how
the editor works for this release: the overall page and each area page are laid
out as one document, and a save is split back into pages by heading. A vault
from the previous release (one `.md` per period) is read through the same
projection until its first open splits it into notebooks; that migration verifies
the split, archives the old file under `.lifequest/legacy-reviews/`, and writes
`.lifequest/migrations/reviews-notebook-v1.json` so it never runs twice.

The daily review is one general review. Asking for an area section on a daily
review is refused with `The daily review is one general review — it has no area
sections.`, and a daily review is completed on its own without an area checklist.

The life review waits for the areas. Marking an overall review done on weekly,
monthly, quarterly or yearly first reads the live areas; if any is not done the
engine refuses with the areas and how far each one got — `Finish every area
review first — Health: in progress; Business: not started.` Marking an area done
changes only that area's status and does not lock the file. The life review's
session is told that every area review is complete, reads each area section from
the same file, and is asked for the summary through the life vision rather than
for another area report.

Unopened periods are refused. A review's own window is the gate: creating or
writing one before it opens fails with the opening time (*This review is not
available yet: it opens 15 Nov 2026 at 08:00.*), and the page does not offer the
period at all — it stays on the latest open one. Past periods are always
writable, and reading a period's file is never blocked, so a review started
earlier is still editable after its window passes. Planning may create the next
period's stub; reviews may not.

Snapshots are filled by the app, not the model. A cadence's rules can carry
fenced `lifequest-snapshot` directives naming a database view (`{id, domain,
section, title, window: "period" | "all", spec}`). Before the interview starts,
the app runs each directive and writes the figures inside marker comments under
the named section, with `window: "period"` meaning this review's own dates. A
directive's section is resolved in two steps: first the area's `## <Area name>`
then `### <section>` (a Finance review's `## Financial` → `### Look-back`), and
only when that area section is absent, the overall skeleton's `## <section>`.
The order is the rule — a review that carries both never has the figure drift
out of its area — and that one resolution is what lets the shipped finance
snapshot serve an area review and a daily review, which is one general review
with no area sections, without a per-cadence copy. On a weekly-or-longer review
that lacks the area section, it is still added so the figure stays under the area
it belongs to. A directive the pass cannot place is reported as **Skipped: …**
in the Start notice rather than dropped in silence, so a review that filled
nothing does not read as a clean start. A locked review is never touched by the
snapshot pass.

Review rules. The rules are read from `.lifequest/reviews/<cadence>.md` when
that file exists and from the shipped defaults otherwise; the read does not
create the file. A session's rules are written on first start. A
```lifequest-snapshot``` block that cannot be parsed is reported in the panel
rather than silently dropped, so a typo shows as a line under the editor.
Snapshot blocks are refreshed in place on every Start.

Lock, unlock and Decisions. A locked review refuses writes: the editor is
read-only and the engine answers `LOCKED`. Only the operator can unlock a review
— an agent's unlock call is refused. An agent edit to an unlocked review applies
directly; an agent edit to a locked review never writes through and instead
files a pending [Decision](./23-decisions.md) carrying the full proposed body.
Approving that Decision applies the body and leaves the review locked; approving
a Decision does not unlock a page. A review is normally unlocked while the
interview drafts it, which is why the lock, not the actor, is the gate: a session
that could not write an unlocked review could not help you write it. The product
framing that agent review changes wait in [Decisions](../../VISION.md) describes
the locked case.

The period pack. The companion session is given a prescribed pack for the
period and scope: life-log events, tasks, open goals and goals due in the window,
Daily Schedule actuals, map events, the period's daily notes, the previous
review of the same cadence, and on an overall review the area sections already
drafted. An area scope filters log, tasks, goals and events to that area;
daily notes stay unscoped because a note belongs to no area. Doctrine is not
in the pack, and the pack carries no table rows — the only database figures are
the snapshots the rules ask for. Lists are capped and a `truncated` flag says so.

Planning stubs. `planning/{cadence}/{period}.md` holds frontmatter only —
`cadence`, `period`, `updatedAt`, `scopes` with companion session ids — and no
plan body, lock or **Mark done**. The review's **Plan next period** creates or
resumes the N+1 stub and opens its session; the Goals page's **Plan this period**
creates or resumes the current period's stub for the active lens.

Week start. Settings → Vault has **Week starts on** with **Monday** and
**Sunday** (default Monday). A weekly review's filename is the week's start date
and its window is that start plus six days, so the setting changes the period
boundaries. While any weekly review or weekly planning file exists the control is
disabled with the note **Cannot change while weekly review or planning files
exist.**, and the engine refuses the change with a counted reason. The Life Map's
own weeks stay Monday-based.

Session binding. Each `(cadence, period, scope)` has one companion thread.
If the stored `sessionId` still exists in Hermes the session resumes; otherwise a
new one is created. The kickoff message names the scope: a daily review opens as
one general review of the day, an area review opens on that area's section of
this period's life review, and the life review opens once the areas are done and
asks for the summary across them. The chat opens on the session — the review
page itself never pastes the pack into the transcript.

Every write is logged. Starting a review, writing one, marking a scope done,
unlocking, and applying an approved locked-review change each append a life-log
entry (`review.ensured`, `review.written`, `review.marked-done`,
`review.unlocked`, `review.applied`) naming the actor. A snapshot pass that
changes the body appends its own `review.snapshots` line carrying the `written`,
`skipped` and `failed` counts; a Start that changed nothing appends none, so the
log stays a record of changes rather than of Starts.

## Tips and edge cases

- A brand-new period has no file, so there is no editor yet. On Weekly and longer
  press an area row in the checklist to create the file with that area's section;
  on Daily use **Start the interview** or **Write it myself**. Typing into a
  period with no file cannot save because the vault refuses a write to a review
  that does not exist.
- The checklist is per period. Finishing **Health review** this week does not
  tick it for next week: every period has its own file and its own statuses.
- The **Life review** row is disabled while any live area is not done. If an area
  is not relevant this period, review it briefly rather than leaving it open: the
  life review is what closes the period.
- **Start interview** and **Mark life review complete** act on the active scope.
  With **Life** active and the areas unfinished they are disabled; with an area
  active they open and complete that area only.
- A failed save holds the page: the status reads **Not saved**, and leaving the
  period is blocked because the app does not know what reached the disk. Fix the
  error, or retry with Ctrl/Cmd+S, before paging away.
- The file is the truth. Editing it outside the app is visible on the next load;
  the page reloads the body from disk when the period changes.
- A review has more than one writer — the page, the companion's interview, the
  snapshot pass. If the file changes while you have unsaved text in the box, the
  page stops saving rather than overwrite the other writer: a **changed on disk**
  banner offers **Reload**, which adopts the file's version; re-apply your text on
  top of it. The draft stays in the box until you reload. Two area interviews on
  the same period write only their own sections, so they no longer erase each
  other.
- An area **Mark … complete** is a status change, not a lock — the file stays
  editable until the overall scope is done.
- Unlocking does not reset the overall scope's `done` status; it only makes the
  file editable again.
- A section for an area that has since been archived remains in the file and is
  not listed in the checklist; its H2 keeps the area's current name on the next
  canonicalising save.
- If the companion gateway is down, pressing an area row still creates the file
  and fills snapshots; the failure is reported as the one step that failed, not
  as a lost review.
- Daily notes are read from `notes/daily/YYYY-MM-DD.md` and only for dates in the
  window. A review that has not opened yet cannot exist, so it never reads a note
  that is not allowed to exist either.
- Before today's daily review opens at 18:00 the page shows yesterday's. That is
  the window working, not a lost review: the current day's file appears once the
  clock passes the configured time. A window left open across the boundary picks
  the new period up the next time the Review page is opened or the period is
  paged.
- With no areas open, the checklist holds only **Life review** and it is ready
  straight away: the life review is the whole review.
- The Dashboard's review row is a reminder, not another place to finish the
  review: it carries no tick, and marking the overall review done on the review
  page is what clears it.
- A review appears on the Dashboard card once its window has opened; before
  that the cadence has no row, because the review is not available yet.

## Related

- [Daily Journal](./16-daily-journal.md) — the journal a review reads back
- [Areas](./05-areas.md) — the areas the checklist reviews
- [Goals](./10-goals.md) — where planning sessions start and where intent lands
- [Dashboard](./06-dashboard.md) — the Today & this week card's **Recurring**
  block, where an open review shows as a row
- [Decisions](./23-decisions.md) — where an edit to a locked review waits
- [The Companion](./24-companion.md) — the interview, sessions and models
- [Settings](./28-settings.md) — **Week starts on** lives in the Vault tab, and
  the per-cadence review windows live in the **Review** tab
