# Daily Note

**Daily Note** is your journal: one markdown note per local date, written by you, saved as
you type. It is the only page in the studio that is purely yours: the companion can read it but
cannot write it. A review's period pack carries the notes whose dates
fall inside the period it covers.

## Where it lives

- Wing: none. The Daily Note is on the bottom shelf of the rail, directly under
  **Decisions**.
- Rail: icon **NotebookPen**, label **Daily Note**.
- Route: `/notes`. There is one route and no per-date URL; the date is page state.
- Surface: a full page in the centre pane, with the editor and the **Earlier notes**
  strip beside it (the strip moves to the page's other edge when the chat dock swaps sides).

This page is part of the [Wiki home](./README.md).

## What it is for

A plan describes the days you meant to have. The Daily Note is the day you actually had, in
your own words, and it is what a review reads back when it looks at a period. It is also the
raw material for the companion's analysis: the built-in **Analyze note** automation reads
today's note and breaks it into tasks, goals and context worth filing.

One note per day is structural, not a rule you have to remember: the date is the filename,
so a second note for a day cannot exist.

## How to use it

1. Choose **Daily Note** in the rail. The page lands on today and opens an empty editor with
   the cursor in it, or the day's existing note.
2. Write. The note saves itself: shortly after you stop typing (about 0.7 seconds), when the
   pointer leaves the editor, when you leave the day, and on **Ctrl/Cmd+S**. There is no
   save button.
3. Watch the status line under the editor: **Saving…**, then **Saved**, or
   **No note for this day yet** for an empty day. A refused body reads **Not saved**.
4. Move between days with **‹ Prev day** and **Next day ›**. The date in the middle reads
   like "Wednesday, 29 Oct 2026 (Today)". **Today** appears beside **‹ Prev day** whenever
   you are on another date, and **Next day ›** is disabled while you are on today.
5. Jump to any earlier day from the **Earlier notes** list: this week's days are listed
   directly and every earlier week folds under its own toggle such as
   `W36 (31 Aug - 5 Sep)`. A day with a note is a button; the date, its weekday and the
   moment it was last edited are its three columns.
6. If you have a manual automation hosted on the Daily Note — the built-in one is called
   **Analyze note** — choose it to open a new chat with the day in context. While the chat
   opens, the button reads **Opening chat…**.

With no notes at all, **Earlier notes** shows: "No notes yet. Today's page is the first one."
An empty day is an empty editor, not an error and not a page of instructions.

## The screen

| Part | What it does |
|---|---|
| **Daily Note** heading | The page title. |
| Pager | **‹ Prev day**, the date and weekday with "(Today)" on today, **Next day ›**, and a **Today** button when you are away from today. |
| Automation buttons | One button per enabled manual automation whose page is **Daily Note**; the built-in is **Analyze note**. Disabled while there is no prose. |
| Editor | A live markdown box opening at twice the height of the studio's other note boxes, focused on an empty day. |
| Status line | **Saving…**, **Saved**, **Not saved**, or **No note for this day yet**. |
| **Earlier notes** | The journal index: **Date**, **Day**, **Last edited**; this week open, earlier weeks folded; unreadable files shown in place as "unreadable". |

## Rules and behaviour

### One file, one date

- The note is a vault file at `notes/daily/YYYY-MM-DD.md`. Its frontmatter carries `date`,
  `createdAt` and `updatedAt`; its body is your prose.
- The filename date is the identity. A hand-edited `date:` that disagrees with the filename
  cannot make the note claim another day's window; the filename wins on read.
- A second write edits the same file and keeps its `createdAt`. There is no "new note"
  control because a second note cannot exist.
- The note is vault-level: it belongs to no domain and is not filtered by the lens. Every
  scope of a review sees the same journal, narrowed only by the period window.

### Saving

- There is no save control. Autosave fires on a short debounce, on the editor losing focus,
  when you change day, and on **Ctrl/Cmd+S**.
- A load reads the day back from the vault, and a write keeps the file's own normalized body.
  The page compares bodies as notes rather than as raw strings, so trailing whitespace the
  vault trims does not keep the status line at **Saving…** and does not re-cut the paragraph
  under your caret mid-sentence.
- Leaving a day is gated on that day's write completing. A write that *failed* keeps you on
  the day, with the draft intact, because nobody knows what reached the disk. A body the
  vault *refused* does not hold you: the vault has answered, and the day's file is untouched.
- Writes are queued one at a time, so the day cannot be read while a write to it is still in
  the air.

### What the vault refuses

- An empty body. A note must have something written in it. The refusal is "A daily note
  needs something written in it", and the empty body is not stored. A day therefore has two
  states: a note with prose, or no note.
- A future day. A note cannot be written for a day that has not happened: "A daily note
  cannot be written for a future day: YYYY-MM-DD". The page never offers a future day, and
  the engine refuses one even if a caller tries. Backfilling a past day is welcome; tomorrow
  is not. The reason is stated as a law: a journal is written, not scheduled, and a review
  must never read a day in its future.

### Authorship and deletion

- You are the only author. The companion's daily-note tools — **list_daily_notes** and
  **get_daily_note** — are read-only by design. There is no agent write path and no Decision
  for a note.
- There is no in-app delete. Removing a day means deleting its file, as with a review; the
  studio never deletes a note on its own.
- A file in `notes/daily/` whose name is not a real `YYYY-MM-DD.md` date is not shown as a
  note. A note file that cannot be parsed is reported as "unreadable" where it sits.

These rules are the Daily Notes law:
[`LAWS/NOTES.md`](../../LAWS/NOTES.md).

### How reviews read it

- A review's period pack carries the daily notes whose date falls inside the period window,
  oldest first. The pack caps them at 92 notes and marks the list truncated; a long period's
  notes are an instruction-payload budget, not a display rule.
- Only days inside the window are read, and two kinds of day on disk are not handed to a
  review: a day whose body holds no prose (the hand-edited empty case), and a day that has
  not happened.
- The Review page shows the same notes in its **Daily notes in this period** panel, read
  directly from the window. See [Reviews](./18-reviews.md).

### Analyze note

- The built-in **Analyze note** automation is a manual automation hosted on the Daily Note.
  It asks the agent to break the note into tasks for the board, goals at different horizons,
  and details that could update documents — and to name a new document or database only when
  an existing home does not fit.
- Choosing it writes the day first, then creates a new chat named after the automation and
  the date, opens the dock, and sends the prompt with the note quoted as hidden context
  marked as reference, not as instructions.
- The button is disabled while the day is empty or still loading. If the note has no prose
  when the run starts, the page says: "Write something in the note before running an
  automation."
- The prompt is editable on [Automations](./17-automations.md); the button always wears the
  automation's own name.

## Tips and edge cases

- A day with an existing note opens with that note; the future is not offered, and the past
  is always writable, so a day that got away can still be written.
- Erasing every character and pausing does not delete the note: the vault refuses the empty
  body, the file keeps its last written prose, and the status line reads **Not saved**.
- The **Earlier notes** strip is a convenience; if it cannot be read, the editor still works.
  Only today's page is loaded at a time.
- A note's date is a *local* calendar date. The filename is the local day, not a UTC day.
- The journal is not domain-filtered: switching the lens does not change the page or the
  notes a review receives.

## Related

- [Reviews](./18-reviews.md) — period packs and the **Daily notes in this period** panel.
- [Automations](./17-automations.md) — the **Analyze note** job and its prompt.
- [The vault](./04-the-vault.md) — `notes/daily/` in the on-disk layout.
- [Companion](./24-companion.md) — the chat the analysis opens in.
- [Log](./26-log.md) — what a note does and does not write there.
