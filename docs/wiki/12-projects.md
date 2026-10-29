# Projects

A **Project** is a piece of work you are carrying: a fixed set of attributes plus one
markdown file that holds its context document. The Projects page is the register of every
project; each project's own page is where the work around it is gathered — its tasks, the
signals those tasks came from, the Decisions filed against it and its life-log lines.

Projects are built into the app. You do not create a database first; every vault already
has the schema, and a new project becomes a file the moment you create it.

## Where it lives

- Wing: Execute (the third wing tab, between Plan and Review).
- Rail: first row of the Execute wing, icon **FolderKanban**, label **Projects**.
- Routes: the register is `/projects`; one project is `/projects/:id`.
- Surface: both are full pages in the centre pane, not sheets. The chat dock stays
  beside them.

This page is part of the [Wiki home](./README.md).

## What it is for

Most work that matters is bigger than one task and longer than one day. A Project keeps
that unit in one place: status and dates tell you where it stands, progress lets you log
what moved, the context document holds the background, and the page collates the tasks and
Decisions that already point at it. The companion reads projects directly, so it can answer
"where are my projects?" and propose changes without guessing.

## How to use it

1. Open **Execute** in the wing tabs, then choose **Projects** in the rail. The register
   lists every project visible in the current lens, newest-updated first.
2. Choose **New project**. A modal opens over the register with the focus already in
   **Title**; every attribute is optional except the title.
3. Fill in as much as you know: **Title**, **Summary**, **Goal**, **Domain**, **Status**,
   **Priority**, **Start date**, **Target date**, **Next action**, **State note**, and the
   **Context** document (a small markdown editor). The modal hint reads: "Every attribute
   is optional except the title. A project can start before it is filed under a goal."
4. Choose **Create project**. The modal closes and the file is written to the vault. While
   the write is in flight the button reads **Creating…** and the modal cannot be dismissed
   with Escape.
5. Choose a row to open the project's page. From there:
   - **Where it stands** — type a **State note** and a **Next action**, then choose
     **Save standing**.
   - **Progress** — set **New percent** (0 to 100), write a **Note** in the box whose
     placeholder is "What moved since last time?", and choose **Log progress**. The note
     is appended to the project's timeline and the percent is set in the same write.
   - **Context** — edit the markdown body, then **Save context**, or **Discard** the draft.
   - **Details** — change any attribute and choose **Save details**.
6. To put a task against the project, open [Act](./14-act.md), expand a card, and set its
   **Project** field. The task then appears in the project page's **Tasks** section, and
   choosing its title opens the board with that card expanded.

With no projects yet, the register shows: "No projects yet. Use New project above — it
becomes a markdown file in the vault the moment you create it."

## The screen

| Part | What it does |
|---|---|
| **Projects** heading | Eyebrow **Execute**, the title, the count ("N projects"), and **New project**. |
| Status filter | Segmented control: **All**, **Open**, **Active**, **Paused**, **Blocked**, **Done**, **Closed**. |
| Scope line | "Overview — every domain" or `Scoped to <domain>` — the lens, not a second filter. |
| Project row | Title, status chip, priority, state note (or summary), goal, domain, target date, next action, and a progress bar with its percent. |
| Status chip / priority | Readable labels: **Open**, **Active**, **Paused**, **Blocked**, **Done**, **Closed**; **Low priority**, **Normal priority**, **High priority**. |
| Project header | Back link **← Projects**, eyebrow **Execute · Project**, title, status chip, summary, and the meta line (goal, domain, priority, "Started …", "Target …", "Updated …"). |
| Next action strip | The current next action, or "Nothing chosen yet." |
| **Where it stands** | State note and next action fields with **Save standing**. |
| **Progress** | Percent control, note box, **Log progress**, and the timeline of updates (each with its time, note, percent and actor). |
| **Context** | The project's markdown body in a live markdown editor, with **Save context** and **Discard**. |
| **Details** | Title, summary, status, priority, goal, domain, start date, target date, with **Save details**. |
| **Around this project** | The collated sections: **Tasks**, **Signals**, **Decisions**, **Activity**. |

The collated sections show exactly four kinds of material:

- **Tasks** — board tasks whose `links.projectId` is this project, with their column label.
  Empty text: "No tasks on the board point at this project yet. Link one from Act."
- **Signals** — the Life-Chain captures reached through those tasks' `links.signalId`.
  Empty text: "No signals are linked through this project's tasks yet."
- **Decisions** — Decisions whose target is this project, newest first, each linking to the
  Decisions sheet. Empty text: "No Decisions have been filed for this project."
- **Activity** — life-log entries whose payload names this project. Empty text: "No
  life-log lines for this project yet."

The project page does not collate Daily Notes or library documents.

## Rules and behaviour

### One markdown file per project

A project is a vault file at `projects/<id>.md`. The id is the filename and is not written
into the frontmatter. The frontmatter carries the fixed schema (title, summary, stateNote,
goalId, domain, status, priority, startDate, targetDate, progress, nextAction, updates,
createdAt, updatedAt); the markdown body is the context document. The `updates` timeline is
stored as a one-line JSON array in the frontmatter. Older project files with only the
first fields read with every new field defaulted, so opening an old vault migrates nothing.

### Operator writes are direct; agent writes wait for approval

- Your create, edit, status change, progress log and context save write the file
  immediately. No Decision is filed.
- The companion's **create_project**, **update_project** and **close_project** tools file a
  pending Decision; the file changes only when you approve it in
  [Decisions](./23-decisions.md).
- The companion's reads are direct: **list_projects** (compact records, filterable by
  status, goal or domain) and **get_project** (the full record plus the collated tasks,
  signals, Decisions and recent project log lines). A project is not a document, so
  `get_document` is the wrong read for it.

### Values the app enforces

- A title is required and must be a single line. Free-text single-line fields are trimmed.
- Status is one of `open`, `active`, `paused`, `blocked`, `done`, `closed`.
- Priority is `low`, `normal`, `high`, or none.
- Progress is a whole number from 0 to 100. Logging progress with a percent sets the bar;
  the timeline and the bar never disagree.
- Dates must be real `YYYY-MM-DD` days, not strings that merely parse as a date.
- A goal or domain is checked for liveness only when you set it. If the goal or domain is
  later deleted, the project keeps the id and the page shows it as "(missing)" or
  "(archived)" rather than clearing it.
- There is no delete action for a project. To retire one, set **Status** to **Closed**; the
  file stays in `projects/`.

### Filtering

The project list is domain-scoped: the domain lens is the data filter, so Overview shows
every project and a domain lens shows that domain's projects. An unassigned project appears
only in Overview, because a domain lens shows exactly its own slug. This is the domain-filter
law: the switcher is the data filter for domain-scoped lists. See
[`LAWS/DOMAIN-FILTER.md`](../../LAWS/DOMAIN-FILTER.md) and [Domains](./05-domains.md). Wing
tabs only switch the rail and never filter page data
([`LAWS/WINGS.md`](../../LAWS/WINGS.md)).

## Tips and edge cases

- The **New project** modal opens on the lens's domain until you choose another domain in
  the form; choosing one stops it following the lens.
- If the list cannot be read, the error appears above the filter. A project id in the address
  that the vault cannot read shows the vault's error, with the **← Projects** link still
  available.
- "No goal" and "Unassigned" are real states, not errors. Only a stored id whose goal or
  domain has disappeared is marked missing.
- A goal's status is shown in the goal picker: a finished goal reads `"<name> (done)"`.
- The project page's tasks link to `/act?task=<task-id>`; closing the expanded card does not
  clear the query, so a reload lands on the same card.
- The project's context body is what the companion receives from **get_project**; keep the
  background you want an agent to reason from there rather than in a summary field.

## Related

- [Act](./14-act.md) — the task board whose cards can point at a project.
- [Life-Chain](./15-life-chain.md) — the captures that reach a project through its tasks.
- [Goals](./10-goals.md) — the goal a project can be filed under.
- [Domains](./05-domains.md) — the domain lens that filters the register.
- [Decisions](./23-decisions.md) — where the companion's project proposals wait.
