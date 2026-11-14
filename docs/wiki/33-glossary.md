# Glossary

Every term this wiki uses, defined once, for LifeQuest 0.2.11. Where a term
belongs to a page, the definition links there for the full story. Old names are
kept where the operator may still meet them in a vault or a saved link, marked
**formerly**.

Return to [Wiki home](./index.md).

**Act** — the fifth wing's label in the rail band. Its internal id is still
`execute`, so saved routes and prompt scopes keep working; the wing holds
**Projects**, **Daily Schedule** and **Task Manager**. The page once called Act
is now [Task Manager](./14-task-manager.md).

**Adapter / linked source** — an area database whose rows come from somewhere
else: a Google Sheet, a Notion database, an operator-chosen URL, or a local file.
Writes queue in the vault while offline and conflicts prompt on reconnect. See
[Data and databases](./19-data-and-databases.md).

**Agent** — a Hermes agent hired in **Agents**, or a client connected over the
MCP door. An agent can be an advisor or serve areas; when it acts, the vault
records which agent. The studio's own companion is not a hire. See
[Agents](./25-agents.md).

**Agent scope** — which areas an agent is offered in, set in Settings → Hermes →
**Agents by area**. **Shown in** narrows where it appears (no chips means every
area); **Default in** makes it the agent selected when you enter an area. Stored
in the vault's `settings.json` under `agentScopes`. See
[Agents](./25-agents.md).

**Agents** — the Home wing's roster (`/personnel`): the companion card, the
agents connected over MCP, and the Hermes agents you have hired. Formerly
**Personnel**. See [Agents](./25-agents.md).

**Area** — a life area. A new vault seeds the base area **Life** (always
unlocked, never a chip, cannot be archived or deleted) plus five locked areas:
Health, Mind, Finance, Business and Relationships. An area owns doctrine,
databases, pages, pins and views under `domains/<slug>/`; the folder name and
routes still say "domain". Formerly **Domain**. See [Areas](./05-areas.md).

**Area lens** — the band in the window title bar that scopes area-owned lists.
At zero or one unlocked area it is a quiet **Life** label; after a second area
opens it becomes a segmented control with **Life** first (every unlocked area)
and then one chip per unlocked area. Formerly **domain lens**. See
[Areas](./05-areas.md).

**Architecture** — the Plan wing page (`/track`) where the operator designs day
types, the default week and the real week, and edits the area's Strategy (How)
document. Not the app's technical architecture; that is
[System architecture](./30-system-architecture.md).

**Automation** — a one-click job on the Automations shelf that reads a page and
opens a chat with the agent. See [Automations](./17-automations.md).

**Board** — the Dashboard pin board for one lens: the Life board (every unlocked
area) or one area's board. See [Dashboard](./06-dashboard.md).

**Card** — one pinned item on a Dashboard board: the companion brief, goals,
deadline pressure, a database view, a page, a recent-log card, and so on.
Clicking a card puts it in the companion chat's context, up to three at once, and
clicking it again takes that card out. See [Dashboard](./06-dashboard.md).

**Capture** — a thought, a picture or a link logged in **Quick Notes** before it
evaporates. Capture is not the studio; it is a signal that can become a task.
See [Quick Notes](./15-quick-notes.md).

**Chat thread** — one conversation with the companion, listed in the rail's
**Chats** sidebar and open in the dock's tab strip. Threads can be renamed,
pinned, archived, restored and deleted. See [Companion](./24-companion.md).

**Companion** — whichever agent harness answers in the chat dock: the built-in
**Pi** or an external **Hermes**. The studio opens with a companion; Hermes is
optional. Pi is the default on a fresh machine; a working Hermes install with no
Pi endpoint configured keeps Hermes until you switch. See
[Companion](./24-companion.md).

**Companion brief** — the Dashboard's first card: the companion's typed, sourced,
expiring items (Watch, Prompt, Ahead, Commitment, Pattern) about the operator's
day, re-derived rather than appended to. Each item is dismissed as **Done**,
**Not useful**, **Wrong** or **Later**; expired items are marked **expired**. See
[Dashboard](./06-dashboard.md).

**Companion harness** — the implementation behind the chat dock. **Pi** is built
in and reaches the vault through the MCP door; **Hermes** is the external
sidekick with its own CLI, profile and gateway. The choice is per vault: Pi is
every vault's default, and a vault gains Hermes only when you add a Hermes agent
to it under Settings → Hermes → **Agents in this vault**. Each vault keeps its own
chats. See [Companion](./24-companion.md).

**Companion profile** — a named Hermes profile, which is one Hermes agent's memory,
skills and transcript store. A vault can bind one profile (a fresh one, or
explicitly one that already works on another vault, which shares its memory). The
app's own profile is `lifequest`, adopted by the vault that was open when the
per-vault agent model arrived. Profiles belong to Hermes only. See
[Getting started](./02-getting-started.md) and [Agents](./25-agents.md).

**Daily Journal** — the operator's journal for one local date, stored at
`notes/daily/{YYYY-MM-DD}.md` and headed by its date. The operator is the only
author; reviews read it back. Formerly **Daily Note**. See
[Daily Journal](./16-daily-journal.md).

**Daily Schedule** — the Act wing page (`/daily`) that turns a day template into
today's plan and records the day as it actually unfolds. See
[Daily Schedule](./13-daily-schedule.md).

**Database** — an area-owned table (or set of tables) stored in the area's
`data/domain.sqlite`. Databases can be local-only, linked-canonical, or
local-canonical with a mirror. See [Data and databases](./19-data-and-databases.md).

**Database write policy** — how agent database writes land. A new database, a new
row and a batch of new rows apply directly after the confirmation in chat;
changing or deleting existing data, and adding a column, still file a Decision.
The old `autoApproveInserts` allowlist is retired and read by nothing.

**Day template / day type** — a named shape for a day (work day, rest day, and so
on) designed on the Architecture page. A template is picked for a day on Daily
Schedule. See [Architecture](./08-architecture.md).

**Decision** — a proposed change that waits for the operator's approval, with a
status of pending, approved or rejected. The inbox is one global shelf: it is not
filtered by the area lens, and its rail badge counts every pending Decision. A
pending card can be edited before approval, and **Approve all** answers the
queue. See [Decisions](./23-decisions.md).

**Default week** — the repeating weekly shape designed in Architecture, from
which real weeks are planned.

**Doctrine** — the four documents that define an area: Beliefs & Premise, Vision
& Desire, Purpose, and Strategy (How). See [Doctrine](./07-doctrine.md).

**Dream** — the Define wing page (`/dream`) that carries an area's Beliefs &
Premise, Purpose and Strategy cards.

**Focus mode** — the Daily Journal written on its own: a 56rem sheet of paper
over a harder-blurred page, headed by the day, with the day's act (**Analyze
note**) at its foot. It edits the page's own draft through the page's own
autosave. See [Daily Journal](./16-daily-journal.md).

**Frontmatter** — the YAML header on a Markdown document that carries its title,
lock state, area tags and update time. Doctrine, documents, reviews, projects and
Daily Journal files use it.

**Goal** — a vault record with an area, a deadline, and either a metric and
target or a written definition of done. Open goals and deadline pressure surface
on the Dashboard, and a Life Map event can link to a goal. See
[Goals](./10-goals.md).

**Harness** — see **companion harness**.

**Home** — the wing that holds the Dashboard, Data, Pages, Documents, Agents and
Images.

**Ideal State** — any number of titled, freeform Markdown documents describing
the future the operator is aiming at. Not doctrine. See
[Ideal State](./09-ideal-state.md).

**Images** — the Home wing's vault picture library (`/images`), holding uploaded
pictures as files with a JSON index. The vision board is written on the **Vision**
page and reads this library. Not Finance receipts and not doctrine media. See
[Images](./35-images.md).

**Ingest mapping / batch** — a saved mapping from an external source into an
area database, and the batch of rows it proposes. A batch posts only after the
operator accepts it. See [Data and databases](./19-data-and-databases.md).

**JSONL** — the line-per-entry format used for the append-only Life log at
`.lifequest/log.jsonl`.

**Keyboard movement** — one of fourteen bindable navigation actions in Settings →
**Keyboard**, grouped Wings, Pages, Panels and Surfaces. A movement has a
portable default key, can be rebound or cleared to **Unassigned**, and lives in
the browser's `localStorage` on this installation. See
[Keyboard shortcuts](./36-keyboard-shortcuts.md).

**Kit** — optional schema, meaning and starter pages installed into an area.
Finance is the first kit and installs into **Finance**. A kit install proposed by
an agent goes through Decisions. See [Finance kit](./20-finance-kit.md).

**Life** — the base area every vault has: the first surface a new vault opens on,
always unlocked, never a chip in the area lens, and impossible to archive or
delete. It is the container for the vault-wide material and the area a legacy
vault's root data keeps. See [Areas](./05-areas.md).

**Life Map** — the Plan wing's year canvas and month calendar (`/chart`): years,
months, days and single-date events. It draws no tasks and no goal deadlines;
weeks belong to Architecture and goal pressure to the Dashboard. See
[Life Map](./11-life-map.md).

**Library document** — a Markdown document in the vault's `documents/` folder,
shown on the Documents page. See [Documents](./22-documents.md).

**Lock** — a state on a lockable page (a doctrine document, a library note, a
review, the Dashboard board) that makes it read-only in place. On the Dashboard,
doctrine documents and library notes the lock is the first item in the page's
three-dot menu and is a switch, not a command; a locked review shows its
**Locked** badge and an **Unlock** button. The operator can lock and unlock;
agents cannot. An agent change to a locked target waits in Decisions. See
[Doctrine](./07-doctrine.md).

**Locked area** — an area whose `unlockedAt` is `null`. A locked area is invisible
to every read, list and write — doctrine, databases, pages, boards, goals — and
the companion cannot leak one. Unlocking is a reveal, not an activation: the lens
stays where it was. An absent lock field on an older vault means unlocked. See
[Areas](./05-areas.md).

**Log** — the append-only Life log at `.lifequest/log.jsonl`, shown on the Log
page. See [Log](./26-log.md).

**MCP** — Model Context Protocol, the door through which paired agents read and
write the vault. The studio runs the MCP server; the door is protected by pairing
secrets. See [Agents](./25-agents.md).

**Onboarding interview** — the first-run conversation offered by the **Welcome to
LifeQuest.** card in the chat dock. **Begin the interview** starts it; the
companion hears the operator out and opens one to three areas itself (never all
five), writing their doctrine drafts, at most one table and a
`First conversation — <date>` note. The card then becomes a receipt with **Continue**.
Files: `.lifequest/onboarding.json` and `.lifequest/onboarding-proposal.json`.
See [Getting started](./02-getting-started.md).

**Page** — an operator-built surface at `domains/{slug}/pages/{id}.json`, made of
blocks and shown on the Pages page. See [Pages](./21-pages.md).

**Page context** — the fact that the companion is told what the page in front of
the operator is showing. Every page is in context by default; the operator can
take the current page out of context, and it comes back on the next page opened.
See [Companion](./24-companion.md).

**Page menu** — the three-dot menu in the top-right corner of a lockable page. Its
first item is the lock; the page's own actions follow (for example **Pin board**,
**Propose change**, **Delete note**).

**Period / period pack** — the date window a review covers, and the bundle of
vault data (goals, log, Daily Journal entries, reviews, and so on) the companion
is handed for that window. See [Reviews](./18-reviews.md).

**Pi** — the built-in companion. It runs inside Electron and reaches the vault
only through the MCP door, on an OpenAI-compatible endpoint and model. Its
endpoint and model live in `%APPDATA%\LifeQuest\pi-endpoint.json`, its API key is
sealed by the OS, and its transcripts are in `%APPDATA%\LifeQuest\pi-sessions\`.
See [Companion](./24-companion.md).

**Pin** — a card placed on a Dashboard board. Taking a card off a board does not
delete what the card draws.

**Planning stub** — a file under `planning/` that reserves a period for planning
without holding a plan body yet. See [Reviews](./18-reviews.md).

**Premise / Beliefs & Premise** — the doctrine document holding the beliefs an
area rests on.

**Project** — a vault document linked to a goal and shown on the Projects page,
with attributes (including type, source, source link and **Repositories**),
collated context and companion tools. See [Projects](./12-projects.md).

**Purpose** — the doctrine document holding the reasons an area matters.

**Quick Notes** — the capture surface on the governance shelf (`/chain`). It
takes text, one picture or one absolute `http`/`https` link per capture, and a
capture may be attachment-only. Formerly **Life-Chain**. See
[Quick Notes](./15-quick-notes.md).

**Rail** — the left navigation column of the studio. It collapses to a 56px icon
column in place.

**Real week** — a particular week as it is planned, as opposed to the repeating
default week. Edited in Architecture; it is a plan view and does not feed the
Daily Schedule, which copies the default week's day type when a day first opens.

**Review** — a cadence review file at `reviews/{cadence}/{period}.md`, with areas
as sections. The overall file locks when the review is marked done. See
[Reviews](./18-reviews.md).

**Review cadence** — one of Daily, Weekly, Monthly, Quarterly, Yearly.

**Review skill / rules** — the standing instructions a cadence's review sessions
use, stored under `.lifequest/reviews/`.

**Script block** — a page block containing operator-authored script that can
query the area's databases and call `fetch`. An agent may apply a script block
directly, and the chat names the change. See [Pages](./21-pages.md).

**Secret** — an API key or token. Secrets live in OS secure storage, never in the
vault. See [Security](./29-security.md).

**Sheet** — an overlay over the app rather than a page: Settings and Decisions
are sheets, and closing one returns you to the page you were on.

**Signal** — a Quick Notes capture record, stored under
`.lifequest/signal-chain/` with any attachment's bytes under
`.lifequest/signal-chain/files/`.

**Skin / theme** — the visual palette of the studio: **Forge** (default),
**Nous**, or **Graphite**, each shipping a day and a night palette. The
titlebar's day/night control also opens a starred-theme quick menu. Chosen in
Settings → Appearance.

**Splash** — the launch surface shown while the vault and companion are coming
up. It does not wait indefinitely on the companion.

**Strategy (How)** — the doctrine document holding the actions that turn an
area's vision into reality. It is edited on both Dream and Architecture.

**Studio** — the desktop app: Electron main process, preload bridge and React
renderer. See [The studio](./03-the-studio.md).

**Task** — a unit of work on the **Task Manager** board and on a Daily Schedule
day. The board has six columns: Done, In-progress, Today, This week, Next 30
days, Backlog. A card created by an agent wears the **Added by agent** mark, and
every card ends in **Send to agent**. Tasks do not appear on the Life Map in this
release. See [Task Manager](./14-task-manager.md).

**Task Manager** — the Act wing's task board (`/act`), formerly the page called
**Act**. See [Task Manager](./14-task-manager.md).

**userData** — the app's own storage directory (not the vault) that holds recent
vault paths, the active lens, and the Pi companion's endpoint, sealed key and
transcripts.

**Vault** — the folder that is the operator's life database and identity. See
[The vault](./04-the-vault.md).

**View** — a saved way of looking at a database or a set of cards, pinnable to a
Dashboard.

**Vision** — the Define wing page (`/vision`) carrying an area's Vision & Desire
document and, below it, the **Vision board**. See [Doctrine](./07-doctrine.md)
and [Images](./35-images.md).

**Vision board** — the Notion-shaped document on the Vision page: ordered text,
heading, bullets and picture blocks, autosaved to `images/board.json`. Pictures
come from the Images library; a block whose picture was removed draws **This
picture is no longer in the library.** See [Images](./35-images.md).

**Wing** — one of the five navigation groupings: Home, Define, Plan, Act, Review.
A wing filters the rail, not page data. The Act wing's id is still `execute`.

**Week start** — the vault setting that decides which day begins a week. It
cannot change while weekly review or planning files exist.

## Related

- [Wiki home](./index.md)
- [Common workflows](./34-common-workflows.md)
- [Keyboard shortcuts](./36-keyboard-shortcuts.md)
- [Overview](./01-overview.md)
