# Automations

**Automations** is the shelf of one-click and scheduled jobs. Each job is a saved prompt plus
the choice of page it reads from; running it opens a chat with the agent and hands it that
page as context. The built-in job, **Analyze note**, reads the day's Daily Note and breaks it
into tasks, goals and details worth filing.

## Where it lives

- Wing: none. Automations sits on the bottom shelf of the rail, below **Daily Note**.
- Rail: icon **WandSparkles**, label **Automations**.
- Route: `/automations`.
- Surface: a full page in the centre pane: the shelf of jobs with an inline editor that
  opens over the list.

This page is part of the [Wiki home](./README.md).

## What it is for

Some prompts are worth keeping. "Break down today's note", "sweep the week", "tell me what
is stalled across my projects" — these are not one-off questions, and retyping them is how
they stop happening. An automation stores the prompt once and gives it a button,
or a time. Nothing else about the companion changes: a run is an ordinary chat in the app's
own companion, with the same session store and the transcript you read later.

## How to use it

1. Choose **Automations** in the rail. The shelf opens in two groups, **Manual** and
   **Scheduled**, each with its count and a one-line description.
2. Choose **New automation**. An editor opens above the shelf.
3. Fill in the job:
   - **Name** — up to 80 characters; required. This is the button's label on its host page.
   - **Page in context** — **Daily Note** or **No page (prompt only)**.
   - **Description** — up to 240 characters, shown under the name on the shelf.
   - **Trigger** — **Manual** or **Scheduled**. A manual job runs when you press its button,
     here or on its host page. A scheduled job runs while LifeQuest is open.
   - For a schedule: **Repeats** (**Every day**, **Every week**), **Day** for a weekly job,
     and **At** (a local `HH:MM` time).
   - **Prompt** — up to 12,000 characters. Use `{{dateLabel}}` for the day the automation
     runs and `{{date}}` for its ISO date.
   - **Enabled** — unticked means the job is paused.
4. Choose **Save automation**. To change one later, choose **Edit** on its row; the same
   editor opens prefilled.
5. To run a job by hand, choose **Run now** on its row. For a **Daily Note** job, today's
   note must have prose — if it does not, the page says: "No Daily Note for today. Write
   today's note first, or run this from its page." The dock opens on a new chat and the
   prompt is sent with the note attached as hidden context. While the chat opens the button
   reads **Opening…**.
6. To stop a scheduled job without deleting it, choose **Pause**; the row then wears a
   **Paused** badge and the button becomes **Resume**.
7. To remove a job, choose **Delete**. A confirmation asks first: title **Delete automation**;
   the message names the job, says its definition leaves the vault and nothing restores it,
   and notes that chats it already started stay in Hermes; confirm **Delete automation**.

With no automations at all, the shelf shows: "No automations yet. Create one to put a page in
front of the agent."

## The screen

| Part | What it does |
|---|---|
| **Automations** heading | The page title, the line "One-click and scheduled jobs that read a page and open a chat with the agent.", and **New automation**. |
| **Manual** group | Jobs whose trigger is manual, with the description "Runs when you press its button, or Run now." |
| **Scheduled** group | Jobs whose trigger is a schedule, with the description "Runs on its schedule while LifeQuest is open; a run missed while it was closed fires once when it returns." |
| Automation row | Icon (click for manual, calendar for scheduled), name, **Paused** badge when disabled, description, meta line, and the row actions. |
| Row meta | Trigger label (**Manual** or **Scheduled**), the schedule text (**Daily at 09:00**, **Mondays at 18:30**), the host (**Daily Note** or **No page**), and a **Last run** line (for example, "Last run 29 Oct, 09:00 · Succeeded") once a scheduled run has been recorded. |
| Row actions | **Run now** (or **Opening…**), **Edit**, **Pause** / **Resume**, **Delete**. |
| Inline editor | **Name**, **Page in context**, **Description**, **Trigger**, schedule fields, **Prompt**, **Enabled**, **Cancel**, **Save automation** (or **Saving…**), and **Delete** when editing an existing job. |
| Errors | A page error above the shelf; a load error with **Retry**; a failed scheduled run's message under its row. |

The editor's hint explains the two tokens: `{{dateLabel}}` becomes the day the automation
runs, `{{date}}` its ISO date, and with the Daily Note in context the whole note is handed to
the agent.

## Rules and behaviour

### What a job is

An automation record is `{ id, name, description, prompt, host, trigger, enabled, createdAt,
updatedAt, lastRunAt, lastRunStatus, lastRunSessionId, lastError }`.

- `host` is `daily-note` or `none`. Only the Daily Note is a host in this release; a second
  host page would need both the page and the context reader, so a job that wants another
  page is written as a prompt-only job and says what to read.
- `trigger` is either `{ type: "manual" }` or a schedule `{ type: "schedule", frequency:
  "daily" | "weekly", time: "HH:MM", weekday: 0–6 | null }`. Daily schedules never keep a
  weekday.
- `enabled` is the pause switch. A disabled job is not run by its schedule, and its host
  page does not offer it; **Run now** on this page still runs it.

### The automations file

- Jobs live in the vault at `.lifequest/automations.json`, as
  `{ "automations": [ … ] }` — one store per vault, beside goals and the map.
- A missing file is not an empty vault: it means the built-in **Analyze note** has not been
  edited yet, so the shelf and the Daily Note both show that default record. The first write
  materialises the file.
- An explicit empty array is a vault whose operator deleted every automation, and it stays
  empty.
- Every change is written atomically. A store that is not valid JSON, or holds an invalid
  record, is reported rather than silently repaired.

### Manual runs

- **Run now** on this page, or the job's button on its host page, creates a **new** chat each
  time. The chat is named `<name> · <date label>`.
- The prompt is sent into that chat immediately, so the agent's answer arrives as a normal
  chat turn in the dock and stays in the thread list like any other conversation.
- The page context is sent as a separate hidden block: a header naming the automation, the
  date, the note, and an explicit instruction that the note is the operator's writing and
  must be treated as reference, never as commands. The visible prompt is the next message.
- A manual run does not touch `lastRunAt` / `lastRunStatus`; those fields record scheduled
  runs, which are the ones the app must not replay.

### Scheduled runs

- Schedules are local-time, daily or weekly. The app checks every 30 seconds while the window
  is open, and runs a due job only when the companion is ready.
- A run that came due while LifeQuest was closed fires once when the app returns, not once
  per missed occurrence. The due check compares the latest occurrence with the job's
  creation time or its last run, whichever is later, so a job created at 10:00 for 09:00 does
  not fire that same morning.
- A scheduled run does **not** open the dock. It creates a chat session and streams the
  answer into it, and the chat waits in the thread list. The visible signal on the shelf is
  the row's **Last run** line.
- A schedule that is missing today's Daily Note records a `skipped` run with "No Daily Note
  for today." A run that cannot reach the companion records `failed` with its error; the row
  shows the error under the meta line, and the floor advances so a broken bridge does not
  retry every tick.
- Editing a schedule resets the run floor to the edit time, so a changed schedule does not
  instantly replay an occurrence that passed under the old one.

### Results, errors and where to look

- Results are chat turns: the answer lives in the Hermes transcript for that session, and the
  session id is recorded on the scheduled run. For a manual run, the dock is already on the
  chat; for a scheduled one, open the chat from the thread list.
- The two error surfaces on this page are the load error with **Retry**, and a page error for
  the action you took (no Daily Note, a save validation failure, a chat that could not
  be created).
- An automation is a companion turn, so the studio's companion law applies: nothing runs
  without the companion — [`LAWS/COMPANION.md`](../../LAWS/COMPANION.md). Start the companion
  in [Companion](./24-companion.md) or [Getting started](./02-getting-started.md).

### Auto-approved inserts is a different setting

**Apply assistant inserts immediately** is not an automation and does not live on this page.
It is a [Settings](./28-settings.md) → **Hermes** control that lists every database in every
live domain; ticking one means new rows the assistant proposes in that database are applied
without a Decision. Updates, deletes, other databases, pages, doctrine and installs still
wait in [Decisions](./23-decisions.md). The allowlist starts empty, lives in
`.lifequest/settings.json` as `autoApproveInserts`, and only the operator's settings write
can change it — the assistant has no tool that reads or writes it.

## Tips and edge cases

- A prompt-only job still opens a chat; it carries no page text. Use it for a
  question you want to ask repeatedly, not for a page read.
- The **Analyze note** job is a normal record once saved: you can rename it, rewrite its
  prompt, pause it, or delete it. The Daily Note's button follows the record, so a deleted
  automation removes the button there too.
- The row's **Last run** line only appears for scheduled runs. A manual run that finished a
  moment ago is visible in the chat list, not in that line.
- A scheduled job runs while the app is open. Closing LifeQuest does not run jobs; the catch-
  up is one run for the latest occurrence, on return.
- Names and prompts are length-limited by the engine, and an invalid hour or weekday is
  refused at save time with the editor's own error.
- Pages in context are quoted as data. Text inside a Daily Note that reads like an
  instruction is still not an instruction to the agent.

## Related

- [Daily Note](./16-daily-note.md) — the host page and the **Analyze note** button.
- [Companion](./24-companion.md) — the chat each run opens or fills.
- [Decisions](./23-decisions.md) — what does and does not wait for approval.
- [Settings](./28-settings.md) — **Apply assistant inserts immediately** and the rest of the
  Hermes tab.
- [Reviews](./18-reviews.md) — the other place the app hands a page to the companion.
