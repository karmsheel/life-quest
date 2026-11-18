# Reviews

A review is a look back over a period you have actually lived, written down as
one markdown file, ending in what the next period is for. The Review wing gives
each cadence its own page. **Daily** is one general review of the day. **Weekly**,
**Monthly**, **Quarterly** and **Yearly** add a **Review checklist** on the right:
one button per life area, each opening that area's own interview and its section
of the same review file, and a **Life review** that opens only once every area is
done and that sums the area reviews up through the whole-life — life-vision —
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
Journal's, at a period's scale: the grey cadence eyebrow — **Daily**,
**Weekly**, **Monthly**, **Quarterly** or **Yearly** — names the page, and the
period itself is the page's one heading, centred over the prose. A calendar key
beside the heading jumps to another period, and wordless arrow keys on the
column's edges step one period at a time. The cadence is never repeated as a
second title.

**Daily is one general review of the day.** It has no checklist and no area
sections, and the area lens does not narrow it: a day is reviewed as a day,
because a day is too short to be cut into six interviews.

**Weekly, monthly, quarterly and yearly carry the Review checklist** in a column
to the right of the reading column:

- **Life review** sits first — the overall review, the whole-life view the area
  reviews feed.
- Then one row per live area, labelled **Health review**, **Mind review**,
  **Finance review**, **Business review**, **Relationships review** for a vault
  with those areas open. A locked or archived area is not listed.
- Every row is a button, and every row reads **Not started**, **In progress** or
  **Done**. The row for the active scope is highlighted.
- The area lens in the window title bar still selects the active area, and
  pressing a checklist row moves the lens to that area. The checklist is the
  control; the lens shows what is selected.

On a wide window the reading column keeps its 48rem measure and the checklist
sits beside it, the pair centred in the sheet. When the sheet has room for the
pair only by giving up some of that measure — an open chat dock beside the page,
for instance — the column narrows rather than pushing the checklist away. Below
roughly 78rem of window the checklist stacks above the reading column instead.

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

## What it is for

Reviews turn a lived period into something you can read back and something the
next period can be planned from. One file holds the whole period — the overall
review is four headings, and each area you review is a section in the same file
rather than a document of its own. Splitting a period into an interview per area
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
   the period, for example `Week of 21 Sep 2026`. **Next** is disabled on the
   open period: reviews are past and present only, and a review that has not
   opened yet cannot be paged to. The calendar offers only periods whose window
   has opened, and choosing any day inside a week takes you to that week.
3. On **Daily**, a period with no file says **No review for this period yet.**
   and offers **Start the interview** (create the file, fill the figures the
   cadence's rules ask for, open the companion chat) or **Write it myself**
   (create the file and edit it without starting a session).
4. On **Weekly** and longer, the checklist is the way in. Press an area row — say
   **Health review** — and:
   - the review file is created if this period has none, with the overall
     skeleton and the `## Health` section;
   - the figures this cadence's rules ask for are filled by the app;
   - the Health interview opens in the chat pane, bound to this period's Health
     scope — in a tab of its own, and listed in **Chats** under its name from
     its first paint, even while the agent is still writing;
   - the scope line above the body reads **Reviewing Health**.
5. Write in **Document** mode. The editor takes the whole file, renders markdown

   as you go, and saves itself after a short pause, when the pointer leaves the
   editor, and on Ctrl/Cmd+S. The status beside the mode buttons reads **Saved**,
   **Saving…**, **Not saved**, or **Locked**.
6. Press **Mark Health review complete** when that area's section says what you
   wanted. The checklist row flips to **Done**; the file stays editable and the
   other areas stay open. An area you have not started reads **Not started**, and
   one you opened reads **In progress**.
7. Work through the areas. The **Life review** row counts them — `2 of 5 areas
   done` — and stays disabled until every live area reads **Done**.
8. When the last area is done the page says **Every area is reviewed — the life
   review is ready.** Press **Life review**. Its interview reads every area's
   `## <Area>` section in the same file and summarises across them — what the
   areas say together, where they pull against each other, and what that means
   for the life vision — into the overall **Look-back**, **Keep**, **Change** and
   **Next-period intent**.
9. **Mark life review complete** finishes the overall scope and locks the file.
   On a locked review the pager shows a **Locked** badge, the checklist is
   read-only, and **Unlock** appears in the action row. Unlock, then edit in
   place.
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
| Cadence eyebrow, period heading and pager | The grey cadence eyebrow; the period as the page's one heading (for example `Week of 21 Sep 2026`), centred with a **calendar** key beside it; wordless arrow keys on the column's edges; a **Locked** badge when locked. |
| **Review checklist** | Weekly and longer only; the column right of the reading column. **Life review** first, then one button per live area with **Not started** / **In progress** / **Done**, a `<done> of <total> areas done` count, and the hint that the life review waits for every area. |
| Scope line | **Reviewing Health** (or **Reviewing Life**) above the body, with **Whole-life review** to move the lens back to Life without starting a session. |
| **Document** / **Preview** | Two modes over the same file; **Document** edits and autosaves, **Preview** renders the whole body. |
| Status text | **Saved**, **Saving…**, **Not saved**, **Locked**, or **No review for this period yet**. |
| Editor | The shared live markdown editor, placeholder **Write this review.**, read-only while locked. |
| Action buttons | **Start interview** (resumes the active scope's session), **Plan next period**, **Mark life review complete** / **Mark Health review complete** / **Mark review complete** on Daily, **Unlock** when locked. **Start interview** and **Mark life review complete** are disabled for Life until every area is done. |
| **Review rules** | A collapsible panel: the cadence's standing rules and its `lifequest-snapshot` directives, with a count and whether they come from your file or the shipped defaults. |
| **Daily notes in this period** | The journal entries whose dates fall inside the review window. |

The review page has no page menu and no lock switch of its own: a locked review
shows the **Locked** badge in the pager and an **Unlock** button in the action
row. The lock is set by **Mark life review complete** on the overall scope, not
by a separate control.

All five cadences open the same page, and the reading column is one centred
measure: the title and pager, the body, the actions and the daily-notes strip
share a single 48rem column. On a wide monitor the checklist rides beside that
column and the pair is centred; a narrow window only shrinks the column to fit
and puts the checklist above it.

The review page has no list of past reviews. You reach a period with the pager;
the vault index of all review files exists for the companion and the snapshot,
not as a screen.

## Rules and behaviour

One file per cadence and period. The laws are short and enforced by the engine:
a review is one markdown file at `reviews/{cadence}/{period}.md`, area reviews
are sections in it, a daily review is one general review with no area sections,
an overall review on a weekly-or-longer cadence cannot be finished before every
live area's section is done, the file locks when the overall review is done,
planning stubs live under `planning/` with no plan body, and week start cannot
change while weekly review or planning files exist. It is restated in
[LAWS/REVIEWS.md](../../LAWS/REVIEWS.md).

| Cadence | Period string | Example path |
|---|---|---|
| Daily | `YYYY-MM-DD` | `reviews/daily/2026-10-29.md` |
| Weekly | week-start date | `reviews/weekly/2026-10-26.md` |
| Monthly | `YYYY-MM` | `reviews/monthly/2026-10.md` |
| Quarterly | `YYYY-Qn` | `reviews/quarterly/2026-Q4.md` |
| Yearly | `YYYY` | `reviews/yearly/2026.md` |

File shape. Frontmatter carries `cadence`, `period`, `weekStartDay`,
`locked`, `updatedAt`, `title` and `scopes` — `overall` plus one entry per
started area with `status` (`draft` or `done`) and a companion `sessionId`.
The body starts with `# <period title>`, then `## Look-back`, `## Keep`,
`## Change`, `## Next-period intent`; a started area adds `## <Area name>`
with the same four as `###` subsections. Extra headings you type are kept after
the required blocks. A save canonicalises this skeleton and preserves the prose
under each heading.

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
the named section, with `window: "period"` meaning this review's own dates. The
shipped rules include the finance snapshot, so a Finance review already shows
the period's spending under the Financial section whether or not the companion is
running. A locked review is never touched by the snapshot pass.

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
`review.unlocked`, `review.applied`) naming the actor.

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

## Related

- [Daily Journal](./16-daily-journal.md) — the journal a review reads back
- [Areas](./05-areas.md) — the areas the checklist reviews
- [Goals](./10-goals.md) — where planning sessions start and where intent lands
- [Decisions](./23-decisions.md) — where an edit to a locked review waits
- [The Companion](./24-companion.md) — the interview, sessions and models
- [Settings](./28-settings.md) — **Week starts on** lives in the Vault tab, and
  the per-cadence review windows live in the **Review** tab
