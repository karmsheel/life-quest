# Daily Journal

**Daily Journal** is your journal: one markdown note per local date, written by you, saved
as you type. It is the only page in the studio that is purely yours: the companion can read
it but cannot write it. A review's period pack carries the notes whose dates fall inside the
period it covers.

## Where it lives

- Wing: none. The Daily Journal is on the bottom shelf of the rail, directly under
  **Decisions**.
- Rail: icon **NotebookPen**, label **Daily Journal**.
- Route: `/notes`. The route and the files did not change when the page was renamed from
  Daily Note; there is no per-date URL, and the date is page state.
- Surface: a full page in the centre pane, with the editor and the **Earlier notes** strip
  beside it (the strip moves to the page's other edge when the chat dock swaps sides).

This page is part of the [Wiki home](./index.md).

## What it is for

A plan describes the days you meant to have. The Daily Journal is the day you actually had,
in your own words, and it is what a review reads back when it looks at a period. It is also
the raw material for the companion's analysis: the built-in **Analyze note** automation reads
today's note and breaks it into tasks, goals and context worth filing.

The page is headed by the day, not by its own name: the grey eyebrow reads **Daily Journal**,
and the date is the page's one heading. One note per day is structural, not a rule you have
to remember, because the date is the filename.

## How to use it

1. Choose **Daily Journal** in the rail. The page lands on today and opens an empty editor
   with the cursor in it, or the day's existing note.
2. Write. The note saves itself: shortly after you stop typing (about 0.7 seconds), when the
   pointer leaves the editor, when you leave the day, and on **Ctrl/Cmd+S**. There is no
   save button.
3. Watch the status line under the editor: **Saving…**, then **Saved**, or
   **No note for this day yet** for an empty day. A refused body reads **Not saved**.
4. Move between days with the two chevron keys on the box's leading and trailing edges
   (**Previous day** and **Next day**). The date between them is the heading and reads like
   "Monday, 9 Nov 2026 (Today)". The forward key is not drawn on today at all: the future is
   closed, so there is no disabled control to click. The three tracks are declared, so the
   date keeps the box's centre line whichever keys are drawn.
5. Jump to another day with the calendar key beside the day (**Choose a day**, title
   "Choose a day — earlier days only"). It opens the month in a small popover, Monday first;
   every future day is drawn inert, the next-month arrow stops at the month today is in, and
   choosing a day writes the day you are leaving first. A write that failed holds you where
   you are; a refused one does not.
6. The day's acts sit at the trailing end of the title row, in the order a day happens:
   - **Today** — only when you are on a day that is not today (title "Go to today").
   - **Analyze note** — the day's built-in manual job, wearing the raised key that commits
     the note. While the chat opens it reads **Opening chat…**.
   - **Focus mode** — the square framed key at the trailing end (accessible name
     **Focus mode**). See step 7.
7. Choose **Focus mode** to write the day on its own. The page blurs behind a sheet of paper
   56rem wide: the day prints at the top as the page's heading, the editor fills the rest,
   and the autosave band and the day's acts sit at the foot. The sheet's own title, **Daily
   Journal**, is hidden but still names the surface for a screen reader, so the date is the
   only heading you see. Choose an act at the foot — **Analyze note**, or another manual job
   hosted on the day — and the sheet closes, hands the page back and opens that act's chat in
   the dock with its first turn already sent. Close with the cross, a click outside the
   sheet, or **Escape**; the day is written on the way out and the page is where you left it.
8. Jump to any earlier day from the **Earlier notes** list: this week's days are listed
   directly and every earlier week folds under its own toggle such as
   `W36 (31 Aug - 5 Sep)`. A day with a note is a button; the date, its weekday and the
   moment it was last edited are its three columns.

With no notes at all, **Earlier notes** shows: "No notes yet. Today's page is the first one."
An empty day is an empty editor, not an error and not a page of instructions.

## The screen

| Part | What it does |
|---|---|
| **Daily Journal** eyebrow | The page's name as the shell's one grey label; the day below is the page's heading. |
| Day heading | The date and weekday, with "(Today)" on today — the page's one `h1`. |
| Act row | **Today** (only off today), the day's manual jobs (**Analyze note** by default), then **Focus mode**, at the trailing end of the title row. They wrap rather than squeeze when the column is narrow. |
| Pager | Two chevron keys on the box's own edges: **Previous day** on the leading edge, **Next day** on the trailing edge, the latter drawn only when there is a day to go to. |
| **Choose a day** | The calendar key beside the date; opens the month with the future disabled and the next-month arrow stopping at today's month. |
| Editor | A live markdown box, focused on an empty day. |
| Status line | **Saving…**, **Saved**, **Not saved**, or **No note for this day yet**; the box's foot holds only the autosave line. |
| **Earlier notes** | The journal index: **Date**, **Day**, **Last edited**; this week open, earlier weeks folded; unreadable files shown in place as "unreadable". |
| **Focus mode** | A 56rem page of paper over the blurred page: the date as its one heading, the editor filling the measure, a reserved autosave band and the day's acts at the foot. |

## Rules and behaviour

### One file, one date

- The note is a vault file at `notes/daily/YYYY-MM-DD.md`. Its frontmatter carries `date`,
  `createdAt` and `updatedAt`; its body is your prose.
- The filename date is the identity. A hand-edited `date:` that disagrees with the filename
  cannot make the note claim another day's window; the filename wins on read.
- A second write edits the same file and keeps its `createdAt`. There is no "new note"
  control because a second note cannot exist.
- The note is vault-level: it belongs to no area and is not filtered by the area lens. Every
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
  The calendar's jump obeys the same rule.
- Writes are queued one at a time, so the day cannot be read while a write to it is still in
  the air. Closing focus mode flushes the pending debounce on the way out.

### What the vault refuses

- An empty body. A note must have something written in it. The refusal is "A daily note
  needs something written in it", and the empty body is not stored. A day therefore has two
  states: a note with prose, or no note.
- A future day. A note cannot be written for a day that has not happened: "A daily note
  cannot be written for a future day: YYYY-MM-DD". The page never offers a future day — the
  forward key is absent on today and the calendar draws every future day inert — and the
  engine refuses one even if a caller tries. Backfilling a past day is welcome; tomorrow is
  not. The reason is stated as a law: a journal is written, not scheduled, and a review must
  never read a day in its future.

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

- The built-in **Analyze note** automation is a manual automation hosted on the Daily
  Journal. It asks the agent to break the note into tasks for the board, goals at different
  horizons, and details that could update documents — and to name a new document or database
  only when an existing home does not fit.
- Choosing it writes the day first, then creates a new chat named after the automation and
  the date. The chat opens in a tab of its own in the dock — the conversation already on
  screen keeps its tab, and the new chat is listed in **Chats** under its name from its first
  paint — and the prompt is sent with the note quoted as hidden context marked as reference,
  not as instructions.
- The button is disabled while the day is empty or still loading. If the note has no prose
  when the run starts, the page says: "Write something in the note before running an
  automation."
- The prompt is editable on [Automations](./17-automations.md); the button always wears the
  automation's own name.
- From focus mode the same act leaves the sheet first, so the chat it opens is on screen in
  the dock rather than hidden under the paper.

## Tips and edge cases

- A day with an existing note opens with that note; the future is not offered, and the past
  is always writable, so a day that got away can still be written.
- Erasing every character and pausing does not delete the note: the vault refuses the empty
  body, the file keeps its last written prose, and the status line reads **Not saved**.
- The **Earlier notes** strip is a convenience; if it cannot be read, the editor still works.
  Only one day is loaded at a time.
- A note's date is a *local* calendar date. The filename is the local day, not a UTC day.
- The calendar's days are the Life Map's weeks: Monday first, the same month grid.
- The journal is not area-filtered: switching the lens does not change the page or the notes
  a review receives.
- The autosave band in focus mode always reserves its height, so **Saving…** arrives in a
  place that was already there instead of moving the page under your hands.

## Related

- [Reviews](./18-reviews.md) — period packs and the **Daily notes in this period** panel.
- [Automations](./17-automations.md) — the **Analyze note** job and its prompt.
- [The vault](./04-the-vault.md) — `notes/daily/` in the on-disk layout.
- [Companion](./24-companion.md) — the chat the analysis opens in.
- [Log](./26-log.md) — what a note does and does not write there.
