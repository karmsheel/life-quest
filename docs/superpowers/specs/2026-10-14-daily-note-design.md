# Daily Note — Design Spec

**Date:** 2026-10-14
**Status:** Approved — implemented
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Reviews](./2026-09-21-reviews-design.md) (the period pack), [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md) (the vault is the source of truth), [Generic vault database MCP tools](./2026-09-28-vault-database-mcp-tools.md) (the read-only tool surface)

One journal entry per day, written by the operator, kept as a plain markdown file in the
vault, and read back by the Reviews that look over the days it covers.

---

## 1. Purpose

The operator needs one place to write down the day while it is happening, and the Reviews
need the operator's own account of the period they are looking back over. Today the
period pack carries the log, tasks, goals, schedule actuals, map events and the previous
review — everything *about* the days except the days themselves.

A Daily Note is that missing voice: one note for the day, written by the operator, filed
where a review can find it.

### Success criteria

- The left rail carries **Daily Note** directly under **Decisions**.
- One note exists per local date, at `notes/daily/{YYYY-MM-DD}.md`. A second write edits
  that one file; there is no second file and no "new note" control.
- The page lands on today, opens past days so a day that got away can still be written,
  and closes the future.
- A Review's period pack carries the notes whose date falls inside the period window, and
  the companion's review instructions carry them too.
- The companion can read the journal (`list_daily_notes`, `get_daily_note`) and cannot
  write it.
- `npm test` runs two rigs that prove the storage/review chain and the rail/page chain,
  each writing an artifact under `apps/desktop/e2e/artifacts/`.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Identity | The date is the identity, twice over: the filename and the frontmatter `date`. "One note for the day" is structural, not a rule the writer remembers. |
| 2 | Storage | Vault-root `notes/daily/{YYYY-MM-DD}.md` — markdown, git-friendly, beside `reviews/` and `planning/`. Not under `.lifequest/`, not Library `documents/`, not a database. |
| 3 | Scope | Vault-level. A note belongs to no domain and carries no domain tags; every scope of a review sees the same journal, narrowed only by the period window. |
| 4 | Author | The operator. There is no agent write path and no Decision for a note. |
| 5 | Empty | A note must have something written in it. An empty body is refused by the write path, so a day has exactly two states: a note with prose, or no note. |
| 6 | Removing a day | Delete its file, as with a review. There is no in-app delete. |
| 7 | Past and future | Past days are writable (a journal can be backfilled). The future is closed **in the engine**: a write for a day after today is refused, and the page never offers one. |
| 8 | Review query | `getPeriodPack` carries `dailyNotes` for the window, oldest first, capped at 92 with `truncated`. |
| 9 | Agent surface | Read-only: `list_daily_notes` (index, newest first) and `get_daily_note` (one body). The pack is the range read. |
| 10 | Connected agents | Refused. A note is not domain-scoped, so no pairing grant can contain it; the tools are absent from `CONNECTED_READ_TOOLS` and a paired agent is refused by name. |
| 11 | Rail | `NAV_ITEMS` entry `note` → `/notes`, `pin: "top"`, immediately after `decisions`, governance section, `NotebookPen` icon. |
| 12 | Browser route | `/notes` (not `/daily`, which is Daily Schedule). One route, no per-date URL. |

### Explicitly out of scope

- Deleting or archiving a note from the studio.
- A note per domain, or domain tags on a note.
- Reminders, prompts, or a "you have not written today" nudge.
- Templates, mood/structure fields, or attachments.
- Agent writes, agent drafts, or a Decision for a note.
- Markdown linking between notes and other vault records.
- Search across the journal (the agent's list plus `get_daily_note` is the surface).
- Writing a note from the phone client.

---

## 3. Architecture

`vault-core` owns the path, the parse, the canonical body, the one-file rule, the index,
and the window query. The desktop main process exposes it over IPC; the renderer page and
the companion's MCP tools call the same functions.

```
DailyNotePage  →  IPC (note:get / note:write / note:list / note:window)  →  vault-core daily-notes
Review period pack (getPeriodPack)  →  dailyNotesInWindow  →  companion instructions
MCP list_daily_notes / get_daily_note  →  same vault-core
```

### 3.1 File shape

```markdown
---
date: 2026-10-14
createdAt: "2026-10-14T08:55:28.022Z"
updatedAt: "2026-10-14T18:02:11.004Z"
---

How the day went.
```

- The filename wins on read: a hand-edited `date:` cannot make a note claim another day's
  window.
- The body is canonicalized on write — no CRLF, no trailing blank space, exactly one
  closing newline — and a write reports the body in that same form, so the writer's answer
  and the next read's answer are one string rather than two spellings of one note.
- `createdAt` is stamped by the first write and preserved by every later one.
- A malformed file still yields its prose: a frontmatter typo must not cost the operator
  their writing. Only the stamps fall back.

### 3.2 Engine

| Function | Contract |
|----------|----------|
| `getDailyNote(root, date)` | One day's note. A day with no file is `Daily note not found`; an invalid date is refused. |
| `writeDailyNote(root, { date, bodyMarkdown })` | Create or edit the one file for that date, atomically. An empty body is refused; a day after today is refused. |
| `listDailyNotes(root)` | Index rows `{ date, updatedAt, error? }`, oldest first. Missing `notes/daily/` is an empty journal. A file that names no real day (or cannot be read) is an error row — visible, never overwritten. |
| `dailyNotesInWindow(root, { start, end })` | The notes inside an inclusive window, oldest first. Reads only the days in the window. Skips error rows and hand-emptied files. |

`isValidLocalIsoDate`, `shiftLocalIsoDate` and `formatLocalIsoDate` live in `period.ts`
(pure, renderer-safe) so the page and the engine agree on what a date is.

### 3.3 Review integration

`getPeriodPack` gains `dailyNotes: DailyNote[]`:

- Window = the period's own bounds, so a Daily review carries one day and a Yearly review
  carries the year.
- Not domain-filtered (decision 3): every scope sees the same journal.
- A day that has not happened is not carried, even inside the window: a period may be
  reviewed before it ends, and a review must never be handed a day in its own future.
- A day whose file holds no prose is not carried (the hand-edited case; the write path
  refuses an empty body).
- Cap 92 notes, keeping the **most recent** days, with `truncated: true`. A capped yearly
  review wants the end of the year it is looking back on.
- An unreadable journal is a `missingSources: ["daily-notes"]` entry, and the rest of the
  pack still assembles.

Because `formatReviewContext` serializes the pack into the instructions Hermes receives on
every turn of a review session, no separate companion wiring is needed: the notes reach the
review conversation the moment they are in the pack.

### 3.4 Agent surface

| Tool | Returns |
|------|---------|
| `list_daily_notes` (`start?`, `end?`, `limit?`) | `{ days: [{ date, updatedAt }], total, truncated, unreadable }`, newest first, no bodies. |
| `get_daily_note` (`date`) | `{ date, found, note }`. A day with no note is `found: false`, not an error. |

`limit` is 1–400 (default 60). An invalid or impossible date is `MALFORMED`.

### 3.5 Page

`/notes` → `DailyNotePage`:

- Lands on today; header reads `Today · Wednesday, 14 Oct 2026`.
- Pager: Prev day / Next day (inert on today) / Today (only when away from today).
- **One box, live preview** — `LiveMarkdownEditor`, the Obsidian model and not the
  studio's `doc-editor__split` primitive: the day reads as prose, the paragraph under the
  caret is its own markdown, and there is no second pane to keep in step. The box and the
  file agree by construction — every keystroke re-serializes the block into the draft, so
  the page's value is never behind the screen. Enter ends the paragraph (the blank line
  markdown needs is the editor's business, not the operator's); Shift+Enter is a soft
  break; Backspace at the start of a paragraph deletes the blank line above it; a day with
  no note opens its writing line with the invitation in it.
- Save is inert until the day is dirty; Ctrl/Cmd+S saves.
- Status line: the save's own notice ("Saved 14 Oct 2026."), else "Unsaved changes", else
  "Saved", else "No note for this day yet". The notice outranks the dirty flag so a refusal
  is never hidden behind "Unsaved changes".
- A refused write keeps the draft and names the reason.
- Earlier notes strip: days up to today, newest first, jumping to that day. A day that
  cannot be read is text ("unreadable"), not a link; a future-dated file is not offered.
  A note written after its own day says so; the ordinary case says nothing.

### 3.6 The panel on a Review

Every Review page (`/review/daily` … `/review/yearly`) carries **Daily notes in this
period** under the review body and its controls — so the controls stay put and a long year
of prose never pushes them off the screen.

- It reads `dailyNoteWindow(period start, period end)` directly rather than the period
  pack, so a long period shows every day the operator wrote: the pack's 92-note cap is an
  instruction-payload budget, not a display rule.
- Scope-independent, like the pack: a note belongs to no domain.
- Rows are one line — the date and the first line of prose — newest first, and a row
  renders its markdown **only when opened**. A collapsed year is a list of dates, not a
  year of parsed markdown.
- Empty period: "No daily notes in this period." and a quiet link to `/notes`.

---

## 4. Error handling

| Case | Behavior |
|------|----------|
| No vault | The page reports "No vault open."; the tools and the pack are inert as before. |
| Day with no note | Empty editor, "No note for this day yet". Not an error. |
| Empty body | Refused by the engine: "A daily note needs something written in it". No file, no index row. The draft stays. |
| A day after today | Refused by the engine: "A daily note cannot be written for a future day". The page never offers one. |
| Invalid or impossible date | `MALFORMED` from the tool; the engine refuses; no file is written. |
| Write I/O failure | Atomic write; the page keeps the draft and shows the error. |
| Unreadable file | An index row with `error`; the page reports "unreadable"; a review skips it; the file is never overwritten. |
| Hand-emptied file | On disk and in the index, never in a pack. |
| Stale read | A load for a day the operator has left does not land in the editor. |
| Missing `notes/daily/` | Empty journal, not an open-vault failure. |

---

## 5. Laws

`LAWS/NOTES.md` carries the observable invariants: one file per local date at
`notes/daily/{YYYY-MM-DD}.md`, one note per day, the operator as the only author, prose as a
requirement, the vault-root location, and the period pack carrying the window.

---

## 6. Testing

Two E2E rigs, both in `npm test`:

| Rig | Command | Artifact |
|-----|---------|----------|
| `tests/daily-note-e2e.test.ts` — the storage and review chain against a real vault on disk, plus the companion's instruction payload and the read-only tool surface | `npm test` | `e2e/artifacts/daily-note-engine.json` |
| `tests/daily-note-ui-e2e.test.ts` → `e2e/daily-note.electron.mjs` — the real shell, rail, page and Review panel in a real layout engine | `npm test` (needs `npm run dev`) | `e2e/artifacts/daily-note.json` + `.png` (the day's page) + `daily-note-editing.png` (the box with one paragraph open as its own markdown) + `daily-note-panel.png` (the Review panel) |

Each file opens with the list of ways its system can fail, written before the assertions.
Both rigs found real defects while being written: an index that counted a file naming no
real day, a refusal that the status line hid behind "Unsaved changes", a "blank save" branch
that turned out to be unreachable, and a harness whose window read disagreed with the vault
about a day that had not happened. The UI rig's own later defect was the file's final
newline: the vault stores a note as its prose plus one newline, and the parser was handing
that newline to the last paragraph instead of to the file.

Not covered by either rig: that the note reaches the *packaged* build. That is
`packaged-smoke.mjs`'s territory and is unchanged by this feature.
