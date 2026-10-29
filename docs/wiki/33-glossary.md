# Glossary

Every term this wiki uses, defined once. Where a term belongs to a page, the
definition links there for the full story.

Return to [Wiki home](./README.md).

**Act** — the Execute wing's task board. Columns of tasks, drag and keyboard
reordering, and a task editor. See [Act](./14-act.md).

**Adapter / linked source** — a domain database whose rows come from somewhere
else: a Google Sheet, a Notion database, an operator-chosen URL, or a local file.
Writes queue in the vault while offline and conflicts prompt on reconnect. See
[Data and databases](./19-data-and-databases.md).

**Agent** — a Hermes agent the operator has hired in Personnel. An agent can be
an advisor or own a domain; when it acts, the vault records which agent. See
[Personnel and agents](./25-personnel-and-agents.md).

**Architecture** — the Plan wing page (`/track`) where the operator designs day
types, the default week and the real week, and edits the domain's Strategy (How)
document. Not the app's technical architecture; that is
[System architecture](./30-system-architecture.md).

**Automation** — a one-click job on the Automations shelf that reads a page and
opens a chat with the agent. See [Automations](./17-automations.md).

**Auto-approve inserts** — a vault setting that lets agent row inserts apply
without a Decision. Off by default; stored in vault settings.

**Board** — the Dashboard pin board for one lens. There is one board for
Overview and one for each live domain. See [Dashboard](./03-the-studio.md).

**Card** — one pinned item on a Dashboard board: a goals card, a database view, a
page, a document, a log card, and so on. Cards can be added to companion chat as
context. See [The studio](./03-the-studio.md).

**Capture** — a thought logged in Life-Chain before it evaporates. Capture is not
the studio; it is a signal that can become a task. See
[Life-Chain](./15-life-chain.md).

**Chat thread** — one conversation with the companion, listed in the rail's
**Chats** sidebar. Threads can be renamed, pinned, archived and deleted. See
[Companion](./24-companion.md).

**Companion** — Hermes: the agent loop, memory, skills, model access and chat
transcripts that the studio requires. The studio does not open without it. See
[Companion](./24-companion.md).

**Companion profile** — the named Hermes profile the studio attaches to. The
default is `lifequest`; the app creates it if it does not exist. See
[Getting started](./02-getting-started.md).

**Daily Note** — the operator's journal for one local date, stored at
`notes/daily/{YYYY-MM-DD}.md`. The operator is the only author; reviews read it
back. See [Daily Note](./16-daily-note.md).

**Daily Schedule** — the Execute wing page (`/daily`) that turns a day template
into today's plan and records the day as it actually unfolds. See
[Daily Schedule](./13-daily-schedule.md).

**Database** — a domain-owned table (or set of tables) stored in the domain's
`data/domain.sqlite`. Databases can be local-only, linked-canonical, or
local-canonical with a mirror. See [Data and databases](./19-data-and-databases.md).

**Day template / day type** — a named shape for a day (work day, rest day, and so
on) designed on the Architecture page. A template is picked for a day on Daily
Schedule. See [Architecture](./08-architecture.md).

**Decision** — a proposed change that waits for the operator's approval, with a
status of pending, approved or rejected. Document and kit-install writes by an
agent go through Decisions. See [Decisions](./23-decisions.md).

**Default week** — the repeating weekly shape designed in Architecture, from
which real weeks are planned.

**Domain** — a life area. A new vault seeds Health, Intellectual, Emotional and
Financial. A domain owns doctrine, databases, pages, pins and views. See
[Domains](./05-domains.md).

**Domain lens** — the top-bar filter that scopes domain-owned lists to Overview
or one domain. The wing tabs are navigation; the lens is the data filter. See
[The studio](./03-the-studio.md).

**Doctrine** — the four documents that define a domain: Beliefs & Premise,
Vision & Desire, Purpose, and Strategy (How). See [Doctrine](./07-doctrine.md).

**Dream** — the Define wing page (`/dream`) that carries a domain's Beliefs &
Premise, Purpose and Strategy cards.

**Execute** — the wing that holds Projects, Daily Schedule and Act.

**Frontmatter** — the YAML header on a Markdown document that carries its title,
lock state and update time. Doctrine, documents, reviews, projects and Daily
Notes use it.

**Goal** — a vault record with a domain, a deadline, and either a metric and
target or a written definition of done. Open goals and deadline pressure surface
on the Dashboard, and a Life Map event can link to a goal. See
[Goals](./10-goals.md).

**Home** — the wing that holds the Dashboard, Data, Pages, Documents and
Personnel.

**Ideal State** — any number of titled, freeform Markdown documents describing
the future the operator is aiming at. Not doctrine. See
[Ideal State](./09-ideal-state.md).

**Ingest mapping / batch** — a saved mapping from an external source into a
domain database, and the batch of rows it proposes. A batch posts only after the
operator accepts it. See [Data and databases](./19-data-and-databases.md).

**JSONL** — the line-per-entry format used for the append-only Life log at
`.lifequest/log.jsonl`.

**Kit** — optional schema, meaning and starter pages installed into a domain.
Finance is the first kit. An agent-proposed kit install goes through Decisions.
See [Finance kit](./20-finance-kit.md).

**Life-Chain** — the capture surface on the governance shelf (`/chain`). See
[Life-Chain](./15-life-chain.md).

**Life Map** — the Plan wing's year canvas and month calendar (`/chart`): years,
months, days and single-date events. It draws no tasks and no goal deadlines;
weeks belong to Architecture and goal pressure to the Dashboard. See
[Life Map](./11-life-map.md).

**Library document** — a Markdown document in the vault's `documents/` folder,
shown on the Documents page. See [Documents](./22-documents.md).

**Lock** — a state on a document, page or Dashboard that makes it read-only in
place. The operator can lock and unlock; agents cannot. An agent change to a
locked target waits in Decisions. See [Doctrine](./07-doctrine.md).

**Log** — the append-only Life log at `.lifequest/log.jsonl`, shown on the Log
page. See [Log](./26-log.md).

**MCP** — Model Context Protocol, the door through which paired agents read and
write the vault. The studio runs the MCP server; the door is protected by pairing
secrets. See [Personnel and agents](./25-personnel-and-agents.md).

**Overview** — the virtual lens that shows the union of databases and pages
across domains. It is not a vault folder. See [Domains](./05-domains.md).

**Page** — an operator-built surface at `domains/{slug}/pages/{id}.json`, made of
blocks and shown on the Pages page. See [Pages](./21-pages.md).

**Page context** — the fact that the companion is told what the page in front of
the operator is showing. Every page is in context by default; the operator can
take the current page out of context, and it comes back on the next page opened.
See [Companion](./24-companion.md).

**Period / period pack** — the date window a review covers, and the bundle of
vault data (goals, log, Daily Notes, reviews, and so on) the companion is handed
for that window. See [Reviews](./18-reviews.md).

**Personnel** — the Home wing's roster of agents (`/personnel`). See
[Personnel and agents](./25-personnel-and-agents.md).

**Pin** — a card placed on a Dashboard board. Taking a card off a board does not
delete what the card draws.

**Planning stub** — a file under `planning/` that reserves a period for planning
without holding a plan body yet. See [Reviews](./18-reviews.md).

**Premise / Beliefs & Premise** — the doctrine document holding the beliefs a
domain rests on.

**Project** — a vault document linked to a goal and shown on the Projects page,
with attributes, collated context and companion tools. See
[Projects](./12-projects.md).

**Purpose** — the doctrine document holding the reasons a domain matters.

**Rail** — the left navigation column of the studio.

**Real week** — a particular week as it is planned, as opposed to the repeating
default week. Edited in Architecture; it is a plan view and does not feed the
Daily Schedule, which copies the default week's day type when a day first opens.

**Review** — a cadence review file at `reviews/{cadence}/{period}.md`, with
domains as sections. The overall file locks when the review is marked done. See
[Reviews](./18-reviews.md).

**Review cadence** — one of Daily, Weekly, Monthly, Quarterly, Yearly.

**Review skill / rules** — the standing instructions a cadence's review sessions
use, stored under `.lifequest/reviews/`.

**Script block** — a page block containing operator-authored script that can
query the domain's databases and call `fetch`. An agent may apply a script block
directly, and the chat names the change. See [Pages](./21-pages.md).

**Secret** — an API key or token. Secrets live in OS secure storage, never in the
vault. See [Security](./29-security.md).

**Sheet** — an overlay over the app rather than a page: Settings and Decisions
are sheets, and closing one returns you to the page you were on.

**Signal** — a Life-Chain capture record, stored under
`.lifequest/signal-chain/`.

**Skin / theme** — the visual palette of the studio, chosen in Settings →
Appearance. Themes can be light or dark and include Nous, Nous Classic, Midnight,
Ember, Mono, Cyberpunk and Forge OS.

**Splash** — the launch surface shown while the vault and companion are coming
up. It does not wait indefinitely on the companion.

**Strategy (How)** — the doctrine document holding the actions that turn a
domain's vision into reality. It is edited on both Dream and Architecture.

**Studio** — the desktop app: Electron main process, preload bridge and React
renderer. See [The studio](./03-the-studio.md).

**Task** — a unit of work on the Act board and on a Daily Schedule day. Tasks do
not appear on the Life Map in this release.

**userData** — the app's own storage directory (not the vault) that holds recent
vault paths, the active lens and other app state.

**Vault** — the folder that is the operator's life database and identity. See
[The vault](./04-the-vault.md).

**View** — a saved way of looking at a database or a set of cards, pinnable to a
Dashboard.

**Vision** — the Define wing page (`/vision`) carrying a domain's Vision &
Desire document.

**Wing** — one of the five navigation groupings: Home, Define, Plan, Execute,
Review. A wing filters the rail, not page data.

**Week start** — the vault setting that decides which day begins a week. It
cannot change while weekly review or planning files exist.

## Related

- [Wiki home](./README.md)
- [Common workflows](./34-common-workflows.md)
- [Overview](./01-overview.md)
