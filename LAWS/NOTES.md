# Daily Notes — Laws

A daily note is the operator's journal for one local date: a plain markdown file in the
vault, written by the operator, read back by the Reviews whose window covers it.

## MUST / MUST NOT

- A daily note MUST be one markdown file per local date at `notes/daily/{YYYY-MM-DD}.md`.
- A date MUST hold at most one note; a later write MUST edit that one file.
- The filename date MUST be the note's identity, so a note cannot claim another day.
- The operator MUST be the only author of a daily note.
- A daily note MUST hold prose; an empty body MUST NOT be stored as a note.
- Daily notes MUST live in the vault folder, not in a hosted store.
- A review's period pack MUST carry the daily notes whose date falls inside the period window.
- A review MUST NOT be handed a day that has not happened, even inside its window.
- A daily note MUST NOT be filtered by domain: every scope of a review sees the same journal.
- Removing a day MUST be deleting its file; the studio MUST NOT delete a note on its own.
- A daily note MUST NOT be written for a day that has not happened.
