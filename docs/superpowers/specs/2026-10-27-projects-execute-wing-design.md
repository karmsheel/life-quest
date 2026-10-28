# Projects on the Execute Wing — built-in, rich, agent-readable

**Status:** implementation contract, 2026-10-27
**Branch:** `feat/projects-execute-wing`

## Why

The companion was asked to analyse a Daily Note and could not answer the
operator's simplest question — "where are my projects?" A task named a project
id, `get_document` on it answered "Document not found", and there was no
`list_projects` / `get_project` at all. Projects existed in the vault as five
fields on a markdown file, on the Plan wing, and the companion had only
`create_project` and `close_project`.

The operator's decision: Projects is a first-class surface that ships with the
app. It lives on **Execute**, carries enough attributes to hold a project's
context and progress, and collates the work around it. It is not a database the
operator has to build first, and the companion must be able to read and propose
to it.

Four harness gaps named in the same pass are fixed here too:

1. `create_database` returned only a `decisionId` and took no columns.
2. No `list_projects` / `get_project`.
3. No Life-Chain (signal) read tools.
4. No `list_pages` / `get_page`.

## Data model — still one markdown file per project

`projects/<id>.md`. Frontmatter is the fixed schema; the body is the project's
context document. Backwards compatible: an existing 5-field project parses with
defaults for every new field.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | filename, never written into frontmatter |
| `title` | string | required |
| `summary` | string | one line, default `""` |
| `stateNote` | string | "where it stands right now", default `""` |
| `bodyMarkdown` | body | context document |
| `goalId` | string \| null | **now optional**; validated live when set |
| `domainSlug` | string \| null | frontmatter key `domain`; validated live when set |
| `status` | enum | `open`, `active`, `paused`, `blocked`, `done`, `closed` |
| `priority` | enum \| null | `low`, `normal`, `high` |
| `startDate` | `YYYY-MM-DD` \| null | |
| `targetDate` | `YYYY-MM-DD` \| null | |
| `progress` | number | 0–100, integer |
| `nextAction` | string \| null | |
| `updates` | `ProjectUpdate[]` | JSON array in frontmatter; newest last |
| `createdAt` / `updatedAt` | ISO string | |

`ProjectUpdate = { id, at, note, progress: number | null, actorName: string | null }`.

Adding `addUpdate: { note, progress? }` to a patch appends an update (mint id,
stamp `at`, record actor name) and, when `progress` is supplied, sets the
project's progress in the same write.

Operator writes stay direct (KAR-7). Agent writes stay Decision-gated:
`create_project`, `update_project`, `close_project` each file one pending
Decision; the file changes only on approve. Reads are direct.

## Companion tools

Reads (direct, no Decision):

- `list_projects` — optional `status`, `goalId`, `domainSlug`; returns compact
  records (no body/updates) plus `total`.
- `get_project` — `{ id }`; returns the full project plus the collated context:
  `tasks` linked by `links.projectId`, `signals` linked through those tasks,
  `decisions` whose project target names this id, and recent project log lines.

Writes (Decision-gated):

- `create_project` — title, summary?, goalId?, domainSlug?, body?, status?,
  priority?, startDate?, targetDate?, progress?, nextAction?, stateNote?
- `update_project` — id plus any field, plus `addUpdate`.
- `close_project` — id (unchanged).

`get_document` on a project id is not the fix path: the companion should call
`get_project`. A project is not a document.

## Harness fixes

### `create_database` takes its columns, returns its id

- params: `{ domainSlug, name, columns?: [{ name, type, options?, relationDatabaseId? }] }`
- one Decision creates the database **and** its columns on approve;
- validation at propose time: non-empty unique names, known column types,
  select options, relation targets that already exist;
- result: `{ decisionId, databaseId, status, columns }`.

### Pages

`list_pages` (`{ domainSlug? }`) and `get_page` (`{ domainSlug, pageId }`), read
only, built on `listPages` / `getPage`.

### Life-Chain

`list_signals` (`{ domainSlug?, type?, limit? }`), `get_signal` (`{ id }`) and
`create_signal` (`{ type, body, title?, domainSlug? }`, applied immediately and
logged, like a task write). Duplicate checking is `list_signals` plus the
operator's eye; the companion is not asked to dedupe unsupervised.

## UI

- Nav: Projects moves from **Plan** to **Execute** (first row), route stays
  `/projects`; `wingForPath("/projects")` becomes `execute`; the eyebrow reads
  Execute.
- `ProjectsPage` (`/projects`): filter by status and domain lens; rows show
  state note, status, priority, progress, goal, domain, target date, next
  action; a composer creates a project with every attribute.
- `ProjectPage` (`/projects/:id`): the central place.
  - header: title, status, state note, goal, domain, priority, dates, progress,
    next action, summary;
  - progress: percent control and "log progress" (note + percent) writing
    `addUpdate`;
  - context: `LiveMarkdownEditor` over `bodyMarkdown`, saved through
    `projectsUpdate`;
  - collated: linked tasks (by `links.projectId`), signals (through those
    tasks), Decisions (project target id), and project log lines; goal and
    domain names resolved from the snapshot.
- A project is written through the existing IPC (`projectsList`, `projectsGet`,
  `projectsCreate`, `projectsUpdate`); no new channel.

## Acceptance (E2E)

Artifacts under `apps/desktop/e2e/artifacts/`:

1. `projects-tools.json` — a temp real vault driven through the real propose
   path: create with all attributes → approve → list/get; update state note and
   progress via `addUpdate` → approve → read back; `create_database` with three
   columns returns a `databaseId`, approves once, and `get_database` shows the
   columns; `list_pages`/`get_page`; `list_signals`/`get_signal`/`create_signal`.
2. `projects.json` + `projects-*.png` — the real Projects list and Project
   detail in the shell, on the Execute wing: the rail puts Projects under
   Execute and not Plan, the built-in attributes render, logging progress
   changes the timeline and percent, and the detail collates tasks, signals,
   decisions and log.
