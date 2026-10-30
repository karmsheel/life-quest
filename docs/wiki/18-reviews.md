# Reviews

A review is a look back over a period you have actually lived, written down as
one markdown file, ending in what the next period is for. The Review wing gives
each cadence its own page: you pick the period, the companion interviews you
through **Look-back**, **Keep**, **Change** and **Next-period intent**, and the
file locks when the whole review is marked done. The single idea: a review is a
durable vault document, not a chat transcript — the report outlives the session
that helped write it.

## Where it lives

The Review wing is the last wing in the top bar, after Execute. Its rail has five
rows, each a page at its own route:

| Rail label | Route | Period it covers |
|---|---|---|
| **Daily** | `/review/daily` | One local calendar date |
| **Weekly** | `/review/weekly` | A week, starting Monday or Sunday |
| **Monthly** | `/review/monthly` | One calendar month |
| **Quarterly** | `/review/quarterly` | A calendar quarter |
| **Yearly** | `/review/yearly` | A calendar year |

Each opens in the centre pane as a page, not a sheet. Any other cadence segment
under `/review/` redirects to `/review/weekly`. The top bar lens still applies:
with **Overview** selected the active scope is the overall review; with a domain
selected the active scope is that domain's section.

Back to [Wiki home](./index.md).

## What it is for

Reviews turn a lived period into something you can read back and something the
next period can be planned from. One file holds the whole period — the overall
review is four headings, and each domain you review is a section in the same
file rather than a document of its own. The companion session for a period and
scope resumes the same thread instead of starting a new one, and a review marked
done is locked so the "final" record cannot be quietly rewritten.

## How to use it

1. Choose **Daily**, **Weekly**, **Monthly**, **Quarterly** or **Yearly** in the
   rail. The page opens on the current, still-in-progress period.
2. Move the period with **‹ Prev** and **Next ›**. The centre of the header shows
   the period title, for example `Weekly review · Week of 21 Sep 2026`.
   **Next ›** is disabled while you are on the current period: reviews are past
   and present only.
3. On a period with no file, the page says **No review for this period yet.**
   and offers two ways in:
   - **Start the interview** creates the review file, fills the figures the
     cadence's rules ask for, then opens the companion chat for this review.
   - **Write it myself** creates the review file and puts you in the editor
     without starting a session.
4. Write in **Document** mode. The editor takes the whole file, renders markdown
   as you go, and saves itself after a short pause, when the pointer leaves the
   editor, and on Ctrl/Cmd+S. The status beside the mode buttons reads **Saved**,
   **Saving…**, **Not saved**, or **Locked**.
5. Switch to **Preview** to read the whole file as rendered markdown. Below it,
   **Domains** lists each live domain with **Missing**, **Draft** or **Done** and
   an **Open** button that switches the lens to that domain.
6. To review one domain, select it in the lens and start the interview for that
   scope. The domain's `## <name>` section with its four subsections is added to
   the same file, and the companion session is bound to `(cadence, period,
   scope)`.
7. **Mark done** finishes the active scope. On **Overview** that marks the
   overall review done and locks the file; on a domain it marks only that
   section done. A domain done does not lock the file.
8. On a locked review, **Unlock** appears. Unlock, then edit in place.
9. **Plan next period** takes period N to a planning session for N+1, opens that
   session in the chat dock, and navigates to **Goals**.
10. Open **Review rules** to read or edit the standing rules for this cadence,
    then **Save rules**. This is the file handed to every session of the cadence.

At the bottom of every review page — empty or not — sits **Daily notes in this
period**: the days you wrote in the window, newest first, with a one-line
excerpt. Click a day to read the note. With none, the panel says **No daily
notes in this period. and offers Write today's note**.

## The screen

| Part | What it does |
|---|---|
| Title and pager | `<Cadence> review` plus **‹ Prev**, the period title, **Next ›**, and a **Locked** badge when locked. |
| **Document** / **Preview** | Two modes over the same file; **Document** edits and autosaves, **Preview** renders the whole body. |
| Status text | **Saved**, **Saving…**, **Not saved**, **Locked**, or **No review for this period yet**. |
| Editor | The shared live markdown editor, placeholder **Write this review.**, read-only while locked. |
| Action buttons | **Start interview** (resumes the scope's session), **Plan next period**, **Mark done**, **Unlock** when locked. |
| **Review rules** | A collapsible panel: the cadence's standing rules and its `lifequest-snapshot` directives, with a count and whether they come from your file or the shipped defaults. |
| **Daily notes in this period** | The journal entries whose dates fall inside the review window. |

The review page has no list of past reviews. You reach a period with the pager;
the vault index of all review files exists for the companion and the snapshot,
not as a screen.

## Rules and behaviour

One file per cadence and period. The law is short and enforced by the
engine: a review is one markdown file at `reviews/{cadence}/{period}.md`, domain
reviews are sections in it, the file locks when the overall review is done,
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
started domain with `status` (`draft` or `done`) and a companion `sessionId`.
The body starts with `# <period title>`, then `## Look-back`, `## Keep`,
`## Change`, `## Next-period intent`; a started domain adds `## <Domain name>`
with the same four as `###` subsections. Extra headings you type are kept after
the required blocks. A save canonicalises this skeleton and preserves the prose
under each heading.

Future periods are refused. Creating a review for a period that has not
started fails with `Cannot create a future review`, and the page snaps to the
current period with the notice that the period was in the future. Planning may
create the next period's stub; reviews may not.

Snapshots are filled by the app, not the model. A cadence's rules can carry
fenced `lifequest-snapshot` directives naming a database view (`{id, domain,
section, title, window: "period" | "all", spec}`). Before the interview starts,
the app runs each directive and writes the figures inside marker comments under
the named section, with `window: "period"` meaning this review's own dates. The
shipped rules include the finance snapshot, so a weekly review already shows the
week's spending under the Financial section whether or not the companion is
running. A locked review is never touched by the snapshot pass.

Review rules. The rules are read from `.lifequest/reviews/<cadence>.md` when
that file exists and from the shipped defaults otherwise; the read does not
create the file. A session's rules are written on first start. A
```lifequest-snapshot``` block that cannot be parsed is reported in the panel
rather than silently dropped, so a typo shows as a line under the editor.
Snapshot blocks are refreshed in place on every **Start interview**.

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
review of the same cadence, and on an overall review the domain sections already
drafted. A domain scope filters log, tasks, goals and events to that domain;
daily notes stay unscoped because a note belongs to no domain. Doctrine is not
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
new one is created and the kickoff message names the review and asks for the
interview. The chat opens on the session — the review page itself never pastes
the pack into the transcript.

Every write is logged. Starting a review, writing one, marking a scope done,
unlocking, and applying an approved locked-review change each append a life-log
entry (`review.ensured`, `review.written`, `review.marked-done`,
`review.unlocked`, `review.applied`) naming the actor.

## Tips and edge cases

- A brand-new period has no file, so there is no editor yet. Use **Start the
  interview** or **Write it myself**; typing into a period with no file cannot
  save because the vault refuses a write to a review that does not exist.
- A failed save holds the page: the status reads **Not saved**, and leaving the
  period is blocked because the app does not know what reached the disk. Fix the
  error, or retry with Ctrl/Cmd+S, before paging away.
- The file is the truth. Editing it outside the app is visible on the next load;
  the page reloads the body from disk when the period changes.
- A domain **Mark done** is a status change, not a lock — the file stays
  editable until the overall scope is done.
- Unlocking does not reset the overall scope's `done` status; it only makes the
  file editable again.
- A section for a domain that has since been archived remains in the file and is
  not listed as **Missing**; its H2 keeps the domain's current name on the next
  canonicalising save.
- If the companion gateway is down, **Start the interview** still creates the
  file and fills snapshots; the failure is reported as the one step that failed,
  not as a lost review.
- Daily notes are read from `notes/daily/YYYY-MM-DD.md` and only for dates in the
  window. A review of a future period cannot exist, so it never reads a note that
  is not allowed to exist either.
- With no lenses or domains, the Domains list under **Preview** is empty and the
  review is overall only.

## Related

- [Daily Note](./16-daily-note.md) — the journal a review reads back
- [Goals](./10-goals.md) — where planning sessions start and where intent lands
- [Decisions](./23-decisions.md) — where an edit to a locked review waits
- [The Companion](./24-companion.md) — the interview, sessions and models
- [Data and Databases](./19-data-and-databases.md) — the database views snapshots read
- [Settings](./28-settings.md) — **Week starts on** lives in the Vault tab
