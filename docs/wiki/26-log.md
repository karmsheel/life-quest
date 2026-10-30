# Log

The Log is the vault's own history: an append-only feed of what changed, when,
who changed it, and which domain it belonged to. It is the one surface in the
studio that is purely a record. Nothing on it can be edited, deleted or
reordered, because the file behind it has exactly one writer and that writer only
appends. See also [Wiki home](./index.md).

## Where it lives

- Rail: the footer row that closes the rail, label **Log**, scroll icon. The
  route is `/log`.
- It is a page, not a sheet, and it is filtered by the domain lens like most
  other pages.
- The page is headed **Life log**, with the line "Append-only feed of domain,
  document, decision, and agent events."
- On disk the feed is `.lifequest/log.jsonl` — one JSON object per line, inside
  the vault.

## What it is for

Every meaningful write in the vault leaves a line: a domain created, a document
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
   actor, and the domain slug (`unassigned` when the entry belongs to no domain).
3. Use the lens in the top bar to scope the feed. **Overview** shows every entry;
   a domain lens shows only that domain's rows. The toolbar names what you are
   looking at: "Overview" or "Scoped to: <domain name>".
4. Choose **Refresh** after a write to re-read the feed. The page reads on
   arrival and when the lens changes; it is not a live tail.
5. With no events at all the page says "No events yet." While a read is in
   flight it says "Loading events…". A failed read is a red error line, and the
   list is left empty rather than stale.

## The screen

| Column | What it shows |
|---|---|
| Time | The entry's timestamp, formatted in your locale. |
| Type | The entry type, exactly as written, such as `decision.created` or `map.task.completed`. |
| Summary | The feature's own one-line sentence, for example "Created decision: Proposed change to Purpose". |
| Actor | **You** when the operator wrote it, the agent's name when an agent did. Entries written before actors were recorded show no name. |
| Domain | The domain slug, or `unassigned` for entries that belong to no domain. |

The payload that some entries carry — ids, before/after values, counts — is
stored in the file but not drawn on this page. It is for repair and diagnosis,
not for reading.

## What writes an entry

The entry types are plain strings written by the feature that made the change,
grouped by prefix. The families you will see:

| Family | Examples and when they are written |
|---|---|
| `domain.*` | `domain.created`, `domain.archived`, `domain.unarchived`, `domain.deleted` — the lifecycle of a domain. |
| `document.*`, `page.*` | `document.created`, `document.updated` for library documents; `page.created`; `page.script-applied` when a script block runs. |
| `decision.*` | `decision.created` when a proposal is filed, `decision.resolved` when you approve or reject it, `decision.unfiled` when a proposal is withdrawn, `decision.unreadable` when a malformed decision file is skipped. |
| `manual-decision.*` | `manual-decision.logged` when you record a decision yourself, `manual-decision.unreadable` for a malformed file. |
| `capture.*` | `capture.posted` and `capture.undone` — the conversational ledger thread. |
| `goal.*`, `map.*` | `goal.created`, `goal.updated`, `goal.deleted`; the Life Map's own entries such as `map.year.created`, `map.event.updated`, `map.task.created`, `map.liveDay.blockCompleted`, `map.about.updated`. |
| `review.*`, `review-skill.*` | `review.ensured`, `review.written`, `review.marked-done`, `review.unlocked`, `review.applied`, `review-skill.written`. |
| `project.*` | `project.created`, `project.updated`, `project.closed`. |
| `database.*`, `view.*`, `board.*` | `database.created`; `view.created`, `view.updated`, `view.deleted`; `board.pins-updated`, `board.lock_changed`. |
| `ingest.*`, `mapping.*`, `adapter.*` | `ingest.accepted`, `mapping.accepted`, `adapter.linked`, `adapter.unlinked`. |
| `books.*`, `kit.*` | `books.exported`, `books.restored`, `kit.installed`. |
| `signal.*` | `signal.created` — a Life-Chain capture. |

Two things deliberately do not write a line: a change that did not change
anything (a card dragged back to where it started, a review saved with identical
content), and the Daily Note, which is the operator's journal and has no Log
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
- **The domain lens is a strict filter.** An entry with a domain slug appears
  only under that domain's lens; an entry with no domain appears only under
  **Overview**. Review entries carry no domain because a review spans domains, so
  they are visible in Overview and hidden under a domain lens.
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

- **Review history looks missing under a domain lens.** It is not: reviews are
  vault-wide and carry no domain, so scope to **Overview** to see them.
- **Unassigned is not "no domain yet".** A line with `unassigned` is an entry
  that is genuinely vault-wide — a domain lifecycle change, a review, a kit
  install — rather than one waiting to be filed.
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
- [Domains](./05-domains.md)
- [Reviews](./18-reviews.md)
- [The Companion](./24-companion.md)
