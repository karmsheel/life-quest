# Log

The Log is the vault's own history: an append-only feed of what changed, when,
who changed it, and which area it belonged to. It is the one surface in the
studio that is purely a record. Nothing on it can be edited, deleted or
reordered, because the file behind it has exactly one writer and that writer only
appends. See also [Wiki home](./index.md).

## Where it lives

- Rail: the footer row that closes the rail, label **Log**, scroll icon. The
  route is `/log`.
- It is a page, not a sheet. Its rows are filtered by the lens in the window
  strip, which reads **Life** until a second area is unlocked and becomes the
  area band after that.
- The page is headed **Life log**, with the line "Append-only feed of area,
  document, decision, and agent events."
- On disk the feed is `.lifequest/log.jsonl` — one JSON object per line, inside
  the vault.

## What it is for

Every meaningful write in the vault leaves a line: an area unlocked, a document
saved, a proposal filed, a review marked done, a database row posted, a pin board
rearranged. The Log answers "what happened here?" without making you open eight
features, and it names the actor — **You** or the agent's name — because in a
vault that both a person and agents write, content alone does not say who did it.

It is a history, not a to-do list and not an undo stack. Nothing in the app reads
the Log back to reconstruct state; the documents, databases and files are the
state. The Log is the record of how they got there.

## How to use it

1. Choose **Log** at the foot of the rail.
2. Read newest first. Each row is: when, an entry type, a one-line summary, the
   actor, and the area slug (`unassigned` when the entry belongs to no area).
3. Use the lens to scope the feed. **Life** shows every entry; an unlocked area
   shows only that area's rows. The toolbar names what you are looking at:
   "Life" or "Scoped to: <area name>".
4. Choose **Refresh** after a write to re-read the feed. The page reads on
   arrival and when the lens changes; it is not a live tail.
5. With no events at all the page says "No events yet." While a read is in
   flight it says "Loading events…". A failed read is a red error line, and the
   list is left empty rather than stale.

## The screen

| Column | What it shows |
|---|---|
| Time | The entry's timestamp, formatted in your locale. |
| Type | The entry type, translated for display — `area.unlocked`, `Onboarding started`, `database.row.created`. |
| Summary | The feature's own one-line sentence, for example "Added a row to Expenses". |
| Actor | **You** when the operator wrote it, the agent's name when an agent did. Entries written before actors were recorded show no name. |
| Area | The area slug, or `unassigned` for entries that belong to no area. |

The payload that some entries carry — ids, before/after values, counts — is
stored in the file but not drawn on this page. It is for repair and diagnosis,
not for reading.

## What writes an entry

The entry types are plain strings written by the feature that made the change,
grouped by prefix. The Log column translates the vocabulary on the way out:
`domain.*` prints as `area.*`, so the file's `domain.unlocked` reads
**area.unlocked** and the operator never learns a second word for the same
thing. The onboarding events are the one exception with no concept word behind
them, and they print in full.

| Family | Examples and when they are written |
|---|---|
| `domain.*` (prints as `area.*`) | `area.created`, `area.archived`, `area.unarchived`, `area.deleted`, and `area.unlocked` when an area opens. A new vault logs only **Life**'s creation; the five seeded areas arrive locked and write nothing until they are unlocked. |
| `onboarding.*` | `onboarding.started` prints **Onboarding started**; `onboarding.completed` prints **Onboarding complete** and carries the manifest of what the interview opened. |
| `document.*`, `page.*` | `document.created`, `document.updated`, `document.lock_changed` for doctrine and library documents; `page.created`; `page.script-applied` when a script block runs. |
| `decision.*` | `decision.created` when a proposal is filed, `decision.resolved` when you approve or reject it, `decision.amended` when you save a correction onto a pending card, `decision.unfiled` when a proposal is withdrawn, `decision.unreadable` when a malformed decision file is skipped. |
| `manual-decision.*` | `manual-decision.logged` when you record a decision yourself, `manual-decision.unreadable` for a malformed file. |
| `capture.*` | `capture.posted` and `capture.undone` — the conversational ledger thread. |
| `goal.*`, `map.*` | `goal.created`, `goal.updated`, `goal.deleted`; the Life Map's own entries such as `map.year.created`, `map.event.updated`, `map.task.created`, `map.liveDay.blockCompleted`, `map.about.updated`. |
| `review.*`, `review-skill.*` | `review.ensured`, `review.marked-done`, `review.unlocked`, `review.applied`, `review-skill.written`. |
| `project.*` | `project.created`, `project.updated`, `project.closed`. |
| `database.*` | `database.created` when a database is made, `database.row.created` for one added row, `database.rows.created` for a batch. These write immediately after the chat's confirmation, so the Log line is the only record the write happened. |
| `view.*`, `board.*` | `view.created`, `view.updated`, `view.deleted`; `board.pins-updated`, `board.lock_changed`. |
| `ingest.*`, `mapping.*`, `adapter.*` | `ingest.accepted`, `mapping.accepted`, `adapter.linked`, `adapter.unlinked`. |
| `books.*`, `kit.*`, `finance.*` | `books.exported`, `books.restored`, `kit.installed`, `finance.fx_source_changed`. |
| `signal.*` | `signal.created` — a signal the companion created with its `create_signal` tool; the operator's own captures in Quick Notes are not logged. |
| `brief.*` | `brief.written` — the companion replaced the Dashboard brief; `brief.dismissed` — the operator settled one item (done, not-useful, wrong or later). |

Two things deliberately do not write a line: a change that did not change
anything (a card dragged back to where it started, a review saved with identical
content), and the Daily Journal, which is the operator's journal and has no Log
entry of its own.

## Rules and behaviour

- **The log is append-only.** `appendLog` opens `.lifequest/log.jsonl` and
  appends one line; there is no update call, no delete call and no compaction.
  A correction is a new entry, never an edit of an old one. That is what makes
  the feed usable as a record: a line means the event happened, in that order.
- **One JSON object per line.** Each line is `{ id, domainSlug, type, summary,
  payload, createdAt, actor }`. The vault is the source of truth and the file is
  plain text, so it diffs and syncs with the rest of the folder.
- **It names the writer.** `actor` is either the operator or an agent (id and
  name). The page renders **You** for the operator and the agent's name
  otherwise. Older lines recorded no actor and show none.
- **The lens is a strict filter.** An entry with an area slug appears only under
  that area's lens; an entry with no area appears only under **Life**. Review
  entries carry no area because a review spans areas, so they are visible under
  **Life** and hidden under an area lens.
- **Locked areas leave no trace here.** The five seeded areas get no
  `area.created` line while they are locked, because the Log is
  operator-visible. Unlocking one writes `area.unlocked`.
- **A logged failure does not fail the write.** Where the Log is written after a
  successful vault write (map commands, reviews), a log failure is tolerated so
  the change that already landed is not reported as failed. Where a Decision
  filing requires its log line, the call returns the failure instead.
- **Nothing leaves the vault.** The Log is local, like every other file. It is
  not uploaded, and the companion reads it only through its own tools.
- **A malformed line stops the read.** Unlike the Decisions inbox, which skips a
  broken file and reads the rest, `readLog` parses every line and a bad line
  fails the read with an error. If the Log page shows an error where entries
  used to be, look at the file rather than at a feature.

## Tips and edge cases

- **Review history looks missing under an area lens.** It is not: reviews are
  vault-wide and carry no area, so scope to **Life** to see them.
- **Unassigned is not "no area yet".** A line with `unassigned` is an entry that
  is genuinely vault-wide — an area lifecycle change, a review, a kit install —
  rather than one waiting to be filed.
- **The actor tells you where a change came from.** A line with an agent's name
  for a document change means it was applied through an approved
  [Decision](./23-decisions.md); the matching `decision.resolved` line is the
  approval that did it.
- **The feed grows forever.** There is no rotation. A long-lived vault has a long
  log; read it through the lens and by the type prefix you care about.
- **It is not a live tail.** After approving a decision or running an automation,
  choose **Refresh** to see the new lines.
- **Do not hand-edit the file.** A hand-written line is a claim the app never
  made, and a malformed one makes the whole page fail to load.

## Related

- [Decisions](./23-decisions.md)
- [The Vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Reviews](./18-reviews.md)
- [The Companion](./24-companion.md)
