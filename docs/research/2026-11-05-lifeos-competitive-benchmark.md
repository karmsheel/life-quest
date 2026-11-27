# Competitive benchmark: Edi Life OS vs LifeQuest

**Prepared:** 2026-11-05
**For:** feature planning and upgrades in LifeQuest
**Products compared**

| | LifeQuest (ours) | Edi Life OS (theirs) |
|---|---|---|
| Repo | `karmsheel/life-quest`, HEAD `0599009`, v0.2.5 | `edrisranjbar/lifeos`, HEAD `25fe400`, after v1.2.0 (2026-11-04) |
| Stack | Electron 44 + React 19 + Vite 6 + TypeScript; vault folder on disk; SQLite per domain | PHP 8.1 + MySQL 8; vanilla ES modules, no build step; JSON documents in `app_state` |
| Host | Desktop app, Windows x64 packaged; no server | Self-hosted web app: Docker, multi-arch image, or 50 MB shared-hosting zip |
| Identity | Opening a vault is identity; no account | Username/password; multiple admin accounts, private workspaces |
| Agent | Hermes companion is required; embedded chat; MCP doors; Decisions approval queue | Optional external MCP server (stdio) over a bearer HTTP API; no embedded chat |
| Data ownership | Vault folder is the database; portable, Git-friendly, offline | MySQL database you host; backup via `mysqldump` + files |
| License | `UNLICENSED` / README contradicts (public repo, no license) | MIT |

**How to read this report**

- **§1** is the one-page answer: what to take, what to leave, what to defend.
- **§4** is the reference matrix. Every row has a stable ID (`BM-nn`), a verdict
  (`ADOPT` / `ADAPT` / `DEFEND` / `IGNORE` / `WATCH`), a priority and a rough effort.
  Use these IDs in tickets.
- **§6** is the design detail behind the ten decisions that matter most; **§7** turns
  the gaps into a sequenced backlog with acceptance criteria.
- **§8** is the "do not build" list that keeps the product coherent with `VISION.md`,
  `PRODUCT.md` and `LAWS/`.
- Evidence is cited inline as `file:line` (LifeOS) or wiki/code paths (LifeQuest).
  The three full inventories behind this report are archived beside it in
  [`docs/research/2026-11-05-lifeos-benchmark/`](./2026-11-05-lifeos-benchmark/README.md):
  `competitor-features.md` (148 rows), `lifequest-features.md` (101 rows),
  `competitor-product-ux.md` (88 rows).

**Confidence and limits**

- LifeOS was analysed from source, docs, screenshots and CI metadata. It was **not
  booted** (no PHP/MySQL runtime in the analysis environment), so runtime behaviour is
  read from code and docs.
- LifeQuest features were verified against code and existing E2E artifacts at
  `0599009`; the suites were not re-run for this report.
- Both products drift between their docs and their code; where that matters it is called
  out, because "the docs say so" is not evidence.
- GitHub numbers are a 2026-11-05 snapshot: LifeOS 114 stars / 14 forks / 6 contributors
  (one author made 156 of 173 commits); LifeQuest 0 stars, public repo, no license field.

---

## 1. The one-page answer

**They are not a clone of us, and we are not a clone of them.** They built a
**self-hosted daily life dashboard**: habits, tasks, focus timer, money, goals and a
score, all in one web app your AI can call. We are building a **local-first life
studio**: a vault that holds doctrine, goals, projects, the day, reviews and your own
tables and pages, with an agent that works through an approval queue.

Same job family — "hold a whole life in one place" — different centre of gravity:

- **Their spine is a daily feedback loop.** Check a habit → progress a goal → log an
  expense → the Overview score moves → a review says what to change. Everything is
  wired to make today measurable and to make tomorrow's glance at the Overview useful.
- **Our spine is a life architecture plus governance.** Define the life in doctrine →
  extract goals → break into projects and days → review the period → let an agent help
  without letting it silently rewrite you. Everything is wired to keep the record
  coherent and yours.

That difference should decide what we copy. **We should take their loop mechanics and
their presentation discipline, not their scoreboard or their breadth race.**

### Ten decisions

| # | Decision | Why | Where |
|---|---|---|---|
| 1 | **Build global search / a command palette now** | Both products lack cross-workspace retrieval. Our vault has more record types than their whole app; this is the highest-leverage missing verb. `M` | BM-32, §7 P0 |
| 2 | **Add a Today queue with task due dates and one attention surface** | Their Todo + due alerts are the bridge from plan to day that our Act board lacks. It is also the natural home for Decisions, deadlines and review-due. `M` | BM-14/22, §6.4 |
| 3 | **Adopt habits as a scoped Execute page, with goal evidence — never a score** | Their habit model is clean and their habit→goal link is the best "connected, not collected" idea. `VISION.md` already welcomes a habit page. `L` | BM-19, §6.2 |
| 4 | **Add goal depth: horizon/parent, priority, start date, multiple measures, evidence links** | Their SMART goal system is materially deeper than our one-measure record, and goals are the hinge between doctrine and work. Do **not** replace written progress with a computed score. `M` | BM-03/05/06, §6.2 |
| 5 | **Build finance commitments (debts/credits, recurring dues) in phases** | Their deepest domain; our Finance kit is a ledger, not a commitments system. Highest functional gap for a life-management product. `XL` | BM-40/41/42, §6.3 |
| 6 | **Add document/version history and export/print** | Their Notepad history is transactional and cheap; export is the missing "get my life out" verb in our vault. `M` each | BM-29/35, §6.7 |
| 7 | **Create a front door: README as a sales page, one landing page, light/dark screenshots, one 20-second demo** | Their presentation is far better than ours; we have a wiki where they have a product page. Cheapest credibility we can buy. `S/M` | BM-73, §6.9 |
| 8 | **Make claims generated and tested (docs drift + CI)** | Their most visible defects are claim drift (10/11/12 workspaces, 15 tools vs 18) and a red suite behind a green demo. We already have the drift. `S/M` | BM-74/75/77, §6.10 |
| 9 | **Consolidate the MCP read surface and publish it** | 76 tools is a context and discoverability problem; their `lifeos_query` pattern and npm/registry distribution are better packaging. Keep our server-side approval model. `M` | BM-49/50, §6.6 |
| 10 | **Do not copy the productivity score, iframe shell, sticker-canvas, or multi-user** | Each conflicts with our anti-references or our laws and would spend the product's coherence on someone else's shape. | §8 |

### At a glance: where each product leads

| Domain | Who leads | Margin | One-line read |
|---|---|---|---|
| Life architecture (doctrine, domains, day templates, life map) | **Us** | Large | They have no equivalent; this is our identity |
| Governance (locks, approvals, agent grants, audit log) | **Us** | Large | Their approvals are client-side; ours are a product subsystem |
| Reviews and reflection | **Us** | Medium | Five cadences, period packs, app-computed snapshots vs an 8-step growth review |
| Data ownership, offline, local security | **Us** | Large | Vault vs a PHP host that still calls Google/CDN at runtime |
| Extensibility of records (pages, script blocks, custom DBs, views) | **Us** | Large | They have no user-defined data model |
| Goal system | **Them** | Medium | SMART wizard, priorities, multiple measures, progress sources, draft persistence |
| Daily execution (todo, habits, focus, calendar, alerts) | **Them** | Large | We have a board and a schedule, not a day system |
| Money | **Them** | Large | Obligations/dues depth vs our ledger + plan pages |
| Knowledge capture | **Split** | — | Our capture + daily note + governance; their editor + version history + canvas |
| AI safety and agent identity | **Us** | Large | Pairing grants, domain scoping, Decisions; theirs is one token and client-side approval |
| AI reach / packaging | **Them** | Small | 18 tools cover half their app but ship on npm + MCP registry; ours covers the app but is 76 tools |
| Onboarding, presentation, distribution | **Them** | Large | Three install paths, landing page, demo GIF vs Electron + Hermes + unsigned installer |
| i18n / RTL / Jalali / mobile web | **Them** | Large | Persian-first product; not our market today |
| CI breadth / quality process | **Them** (breadth) | — | Broad workflows but red at HEAD; we have deep E2E and no CI |

---

## 2. What each product actually is

### 2.1 Edi Life OS (theirs)

A single-user (multi-account later) self-hosted web dashboard. Eleven app workspaces —
Overview, Growth, Focus, Finance, Habittify, Todo, Kanban, Calendar, Goals, Notes,
Notepad — plus Settings, behind one hash-routed shell (`public_html/index.html`,
`assets/os.js`). Each workspace is a separate page loaded in an iframe; the Overview is
the product's home and its emotional centre: a productivity ring (0–100, six grade
bands), four KPI cards, six life-dimension cards, focus/habit charts, a 16-week habit
heatmap, goal and workload lists, finance, weather and an AI email summary
(`public_html/assets/dashboard.js`; `docs/media/dashboard.webp`).

Persistence is pragmatic: MySQL tables for relational things (habits, habit logs,
attachments, users, mail, notepad revisions) and **20 JSON documents per user** in
`app_state` for everything else. Saves are whole-document compare-and-swap on a SHA-256
revision, with 2 MB caps and multi-document transactions under key-sorted row locks
(`lib/state_store.php:61-110`). The AI surface is an optional stdio MCP server that only
talks to `/api/v1` with a bearer token — no database or filesystem access
(`mcp/src/*.js`, `docs/api.md`).

Marketing claims are ambitious and mostly true, but several counts are stale: README
says "ten workspaces" while its table lists twelve; the Persian README and site say
eleven; the code has eleven apps plus Settings. README says "15 MCP tools" while 18 are
registered. Habittify advertises streaks but has no per-habit streak counter (only a
completion-density heatmap). Focus advertises session history but stores sessions only
for charts. The suite is red at HEAD (6 of 39 Node tests fail). None of this erases the
product's real strengths; it is a useful warning for our own claims.

### 2.2 LifeQuest (ours)

A desktop studio over a vault folder. Domains hold four doctrine documents (Beliefs &
Premise, Vision & Desire, Purpose, Strategy/How) with operator-only locks; goals,
projects, the Life Map, Architecture (day templates), Daily Schedule, Act (task board),
Life-Chain capture, Daily Notes, five review cadences with period packs, Decisions,
Pages, Documents, domain databases and the Finance kit. The Hermes companion is
required; the studio will not open without it. Agents write through Decisions, with a
small named set of direct writes; pairing grants scope what a connected agent can read
and write (`LAWS/`, `VISION.md`, `docs/wiki/`).

The structural asset is `packages/vault-core`: a pure Node library that owns vault
paths, records, SQLite, MCP tools and validation, with the Electron main as the only
writer. The product is deliberately one operator per vault, local-first, no account, no
hosted copy, no multi-user, no mobile client (the phone is future scope in `VISION.md`).

### 2.3 The same job, different physics

| Question | LifeOS | LifeQuest |
|---|---|---|
| Where does the day start? | Overview score + KPIs | Dashboard pin board per lens |
| What is the unit of progress? | A computed percentage from linked records | A record you update, plus a deadline and a review |
| How does the agent help? | External client edits via API/MCP; approval is the client's job | Embedded companion; approval is the product's job (Decisions) |
| What makes it trustworthy? | You host the database | You own a folder; nothing leaves the machine |
| What makes it feel alive? | Motion, score, charts, focus landscape | Quiet chrome, live markdown, pins, draft-and-approve |
| What is the growth path? | More workspaces and integrations | More depth in the vault's own model |

This is why a feature-by-feature count is misleading: they can add a workspace in a
day because it is a new JSON document; we add a record type only if it fits the vault
contract. Copy the *mechanics* where they compound; refuse the *surface area*.

---

## 3. Method and evidence

Three parallel analysts produced code-level inventories:

| Inventory | Scope | Rows | Notable methods |
|---|---|---|---|
| `competitor-features.md` | All LifeOS code: 12 `lib/*.php`, 11 workspaces, MCP server, API, schema, deploy, tests | 148 | Every claim tied to `file:line`; status `shipped` / `shipped-partial` / `dead-code`; README claims cross-checked |
| `lifequest-features.md` | All 35 wiki pages + `LAWS/` + `VISION.md` verified against `packages/vault-core/src` and `apps/desktop/src` | 101 | Status `shipped` / `shipped-partial` / `docs-only` / `code-only`; docs drift catalogued |
| `competitor-product-ux.md` | Positioning, landing page, README, IA, design system, i18n, mobile, GitHub/CI signals, screenshots | 88 | GitHub API snapshot; local Node test run; image evidence from `docs/media/*.webp` and demo GIF frames |

Scores in §5 are judgments on a 0–3 scale (0 absent, 1 partial, 2 solid, 3
best-in-class for that job), not measurements. They are there to show shape, not to be
averaged into a false precision.

**Known gaps in evidence**

- LifeOS runtime was not booted: PHP endpoints, IMAP/AI/weather calls, Docker builds and
  rendered UI are code/doc-read, not executed.
- LifeQuest's E2E suite was not re-run; feature claims are code-verified and backed by
  the artefacts already in `apps/desktop/e2e/artifacts/` (107 JSON reports, 300
  screenshots, 100/107 reporting pass at the time of the inventory).
- LifeOS PHP tests could not run here; only its Node suite was run (33/39 pass at HEAD).
- Star counts and issue counts are a point-in-time GitHub snapshot.

---

## 4. Reference matrix

**Verdicts**

| Verdict | Meaning |
|---|---|
| `ADOPT` | Take the capability essentially as-is, adapted to our stack |
| `ADAPT` | Take the mechanism or interaction, change its shape to fit our laws |
| `DEFEND` | We already lead; protect and sharpen rather than rebuild |
| `WATCH` | Interesting, but not now; revisit when a dependency lands (habits, mobile, i18n) |
| `IGNORE` | Deliberately out of scope; reason recorded in §8 |

**Priority:** P0 = next two weeks · P1 = this quarter · P2 = later · P3 = opportunistic.
**Effort:** S ≤ 2 days · M 3–7 days · L 2–3 weeks · XL > 3 weeks.

### 4.1 Direction and planning

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-01 | Life areas | 6 fixed dimensions with icons/colours/hints (`growth-model.js:6-16`), not editable | Configurable Domains, seeded 4, add/archive/delete, domain lens filters data (`docs/wiki/05-domains.md`, `LAWS/DOMAIN-FILTER.md`) | DEFEND | — | — | Our model is richer and user-owned. Their fixed taxonomy is a values statement; a screenshot reads instantly. Consider a read-only "areas wall" card derived from domains, not a second taxonomy. |
| BM-02 | Values / doctrine | No equivalent | Four doctrine docs per domain, locks, decide to change (`LAWS/DOCTRINE.md`) | DEFEND | — | — | Deepest structural difference. Their goals have a "why" field; that is the only values capture they have. |
| BM-03 | Long-term goal layer | Growth plan per dimension: title, why, target date, status, linked goals + habits (`docs/growth.md:11-17`) | No layer between vision docs and goal records; goals are flat | ADAPT | P1 | M | Add an optional **horizon** on goals (`long-term` / `period`) or a `parentGoalId` so long-term outcomes can hold measurable goals. Keep one record type; do not add a second "plan" object. |
| BM-04 | SMART goal wizard | 5-step wizard, S/M/A/R/T prompts, draft autosaves per goal (`goals/index.html:58-150`; `edi_goals_drafts_v1`) | Single form: name, notes, domain, deadline, one measure (`docs/wiki/10-goals.md:52-64`) | ADAPT | P2 | M | Keep the one-form speed; add **draft persistence** and optional prompt copy for the four questions. A wizard is friction for repeat use. |
| BM-05 | Goal fields | Priority, category/tag, start date, multiple measures, tasks, archive; derived completion (`lib/goals.php:47-110`) | Deadline, domain, one measure (metric+target+current *or* definition of done), open/done | ADAPT | P1 | M | Add **priority**, **start date**, and **multiple measures** (the last only if we keep a written headline); add archive vs done. Goal tasks should link to Act tasks, not live inside the goal record. |
| BM-06 | Goal progress | Computed from checklist, measures or habit attendance; 99% cap until complete (`lib/goals.php:20-37`) | Written by the operator; explicitly "progress is what you write, not a formula" (`docs/wiki/10-goals.md:82`) | ADAPT | P1 | M | Do **not** replace written progress. Show **evidence** next to it: linked tasks completed, linked practice days, linked measures. If the operator wants, a second "derived" figure may be shown but never silently written. Aligns with `VISION.md` "not a scoreboard". |
| BM-07 | Habit-linked goal progress | Goal points at a habit + completed-day target; attendance stays in `habit_logs` (`docs/growth.md:54-58`) | None (no habits) | WATCH | P1 | — | Adopt only when BM-19 lands. Single-source the attendance; never duplicate tasks. Cap at "in progress" until met, as they do. |
| BM-08 | Completed/archived states | Status active/archived; completed derived | Open/done; delete is destructive | ADAPT | P2 | S | Add **Archive** separate from Done so history survives and lists stay clean. Low cost, real quality-of-life. |
| BM-09 | Review cadences | Weekly/monthly/quarterly only | Daily/weekly/monthly/quarterly/yearly, one file per period, domain sections (`docs/wiki/18-reviews.md`) | DEFEND | — | — | Our review system is in a different class. Do not dilute it with their simpler flow. |
| BM-10 | Review mechanics | 8-step modal, per-dimension reflection + next step, previous next step shown, save-time snapshot, share image; draft lost on reload (`growth/review-stepper.js`) | Interview with period pack, app-computed snapshots, locks, planning stubs, one thread per scope (`18-reviews.md:103-192`) | DEFEND | — | — | Steal two details: (a) show **previous next step** in the domain section; (b) a **review due / up to date** strip. Both S. |
| BM-11 | Timeline / Life Map | Calendar of kanban cards + finance dues only; no life timeline | Year canvas + month grid, events, day text, objectives, goal links (`11-life-map.md`) | DEFEND | — | — | Our Life Map is a category they do not have. Keep it visual and calm. |
| BM-12 | Day templates / architecture | None | Day types, default week, real week, 06:00–22:00 grid (`08-architecture.md`) | DEFEND | — | — | Unique. Their Focus timer is the nearest thing to "design a day" and it is a timer, not a template. |
| BM-13 | Planning stubs | None | `planning/{cadence}/{period}.md`, no plan body, created by review/goals | DEFEND | — | — | Do not merge planning into reviews; the separation is correct. |

### 4.2 Execution

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-14 | Everyday task views | Inbox/Today/Upcoming/All/Completed, custom lists with colours, search, sort, shortcuts (`/`, `n`), 6 s undo toast (`public_html/todo/static/app.js`) | One 6-column board (Done → Backlog), quick add to Backlog, no search, no due date, no subtasks (`14-act.md`) | ADAPT | P0 | M | Add **dueDate** to tasks, **Today/Upcoming views**, **search**, and undo. Keep the board as the planning view; the list views are for the day. This is the single most valuable execution upgrade. |
| BM-15 | Subtasks | First-class, editable in detail pane | None; notes only | ADAPT | P2 | M | Add lightweight subtasks (title+done) if tasks become the day unit; do not add a project-management hierarchy. |
| BM-16 | Task undo / undo clear | Completion toast, clear-completed restores only removed ids | None | ADOPT | P1 | S | Undo the last destructive action in the UI (delete task, remove pin, delete note). A generic toast+undo primitive pays across the app. |
| BM-17 | Kanban depth | Boards, columns, drag, labels, priority, dates, recurrence, reminders, checklists, comments, members, custom fields, attachments (`kanban/assets/scripts/*`) | Fixed Act board; tasks have links (goal/project/date/weekItem/signal), no labels/comments/checklists/attachments | WATCH | P2 | L | We are not a Trello. Take only: **priority**, **due date** (BM-14), and a **checklist inside a task** if evidence shows demand. Do not build custom fields on tasks; our custom data model is Pages/DBs. |
| BM-18 | Projects | Kanban boards double as projects | Dedicated project register: attributes, goal link, status, progress, next action, context, collated tasks/signals/decisions/activity (`12-projects.md`) | DEFEND | — | — | Our project page is deeper for planning. Consider one board-like view of projects? Not needed; the Act board already covers execution. |
| BM-19 | Habits | Daily check-in, categories, month grid, 7-day bars, monthly %, Jalali rendering, backfill; no editable colour/icon, no archive (`lib/habits.php`, `habittify/static/app.js`) | None. `VISION.md:74-75` welcomes a habit tracker as its own Execute page; streaks must not live on Daily Schedule | ADOPT | P1 | L | Build a **practice** page: habit + cadence, one-tap check-in, month grid, current streak, longest streak. Link to goals as evidence (BM-07). No score, no grade, no composite. |
| BM-20 | Focus timer | Pomodoro with modes, editable durations, round cycle, warning on switch, 14-day chart, session stats, soundtrack, time-of-day scene (`assets/os.js:61-115`, `focus-audio.js`) | None | ADAPT | P2 | M | A plain timer + session log that can place a **focus block on the Daily Schedule** fits our architecture better than a separate ritual. Skip the soundtrack/scene unless we want a signature moment. |
| BM-21 | Calendar | Read-only projection of kanban cards + finance dues, month + schedule, filters, search, overdue; clicking opens the source (`public_html/calendar/app.js`) | Life Map is events + day text, not tasks or dues; no unified calendar | ADAPT | P2 | L | Once tasks have due dates and commitments exist, add a **Due** lens to the Life Map month page (cards + dues), read-only, opening the source. Do not build a second calendar app. |
| BM-22 | Due alerts / notifications | Bell + grouped panel + optional browser Notification, 09:00 for date-only, dedup per device; only while the tab is open (`assets/due-alerts.js`) | Two OS notifications only: deadline pressure and update (`main.ts`); no task due dates | ADAPT | P1 | M | Add an **Attention** card to the Dashboard (overdue tasks, goals due ≤7 days, reviews due, pending Decisions, finance dues) and one OS notification for due tasks. Keep it in-app first; no notification centre. |
| BM-23 | Recurring tasks | Card recurrence (daily/weekly/monthly) advances the same card on completion; no audit series (`lib/tasks.php:113-123`) | None for tasks; recurring rows exist in Finance kit but are never posted | ADAPT | P2 | S | Recurring **commitments** matter more than recurring tasks (BM-42). Add simple recurrence to tasks only if the day system asks for it. |
| BM-24 | Automations | None (only cron for the email digest) | Agent jobs: manual/daily/weekly at HH:MM, prompt, host, last-run status; runs create chats (`17-automations.md`) | DEFEND | — | — | Unique. Consider surfacing suggested automations (e.g. "weekly review prep") from the review system. |
| BM-25 | Voice capture | Web Speech dictation in Notes/Notepad only; no server audio (`assets/voice-input.js`) | None; OS dictation works in the editor | WATCH | P3 | S | If we add it, use the same Web Speech approach; do not store audio. Not a differentiator. |

### 4.3 Capture and knowledge

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-26 | Quick capture | Todo quick-add only | Life-Chain: text/picture/link, autofocus, one file per signal, make-task (`15-life-chain.md`) | DEFEND | — | — | Capture is one of our strongest verbs. Consider a global shortcut to capture from anywhere. |
| BM-27 | Journal | None (only Notepad) | One markdown file per local date, autosave, focus mode, review integration (`16-daily-note.md`) | DEFEND | — | — | Their "reflection" is a quarterly-ish modal; ours is a daily practice. Keep. |
| BM-28 | Note editor | Notepad: 1,000 docs, markdown + HTML source, Write/Split/Preview, fullscreen, toolbar, word count, autosave, export, RTL detection per block, transactional version history (`lib/notepad_history.php`) | Documents: live markdown editor (one box), locks, propose-change, wiki links; no autosave, no version history, no HTML, no export (`22-documents.md`) | ADAPT | P1 | M | Add **version history** (BM-66) and **export**. Skip HTML notes; our security posture is better without authoring raw HTML. |
| BM-29 | Version history | In-transaction snapshot on content change, deleted text retained, paging, restore with a revision precondition, no pruning (`notepad_history.php`) | None | ADOPT | P1 | M | Implement per-document snapshots in the vault (e.g. `.lifequest/history/<kind>/<id>/<ts>.json` or a SQLite table) with a retention policy. Restore must be explicit and keep the overwritten version. |
| BM-30 | Sticky-note canvas | Infinite canvas, note connections, zoom/pan, drag-to-connect, secret notes (`notes/static/app.js`) | None (Images board is a linear picture board) | IGNORE | — | — | Not our shape. Visual thinking is covered by Images and Pages; a canvas invites a second note app. |
| BM-31 | Pages / blocks | None | 12 block kinds, domain-owned pages, script blocks with read-only SQL + https fetch, view refs (`21-pages.md`) | DEFEND | — | — | Their lack of a user data model is their biggest ceiling. Keep pages simple and let databases grow. |
| BM-32 | Global search | Per-workspace only (Todo, Notes, Notepad, Finance) | Local filters only (Pages titles, chat, Settings); no cross-vault search (`14-act.md`, `21-pages.md`) | ADOPT | P0 | M | `Mod+K` palette over page/document/goal/project/signal/task/review titles and markdown bodies, plus DB rows by title. Build an index in `.lifequest/cache/` (gitignored) and rebuild on vault open; never write it to a synced path. Results show domain; keyboard-first. |
| BM-33 | Backlinks / graph | Note connections only | Wiki links resolve but no backlinks panel (`22-documents.md:52-78`) | ADAPT | P2 | M | A "Referenced by" panel for documents/pages/goals is cheap after search exists (reuse the index). No force-directed graph. |
| BM-34 | Attachments / media | Kanban attachments; files outside web root; 8 MB cap (`attachments.php`) | Domain media 8 MB; receipt images 25 MB re-encoded; DB file cells 25 MB; images library (`29-security.md`) | DEFEND | — | — | Ours is broader and safer (sniffing, containment, no public path). |
| BM-35 | Export / print | Notepad `.md`/`.html`; Finance Excel + print; Growth share image | `books.json` export only; no markdown/PDF/print of notes, pages or reviews (`19-data-and-databases.md`) | ADAPT | P1 | M | Add **Export** on a document/review/page (markdown + PDF via print stylesheet) and a "Print" affordance. "I can get it out" is part of ownership. |
| BM-36 | Import | Excel finance import (SheetJS from CDN), legacy SQLite import | CSV/PDF ingest into domain DBs with mapping Decisions; linked adapters (`19-data-and-databases.md`) | DEFEND | — | — | Ours is more general and governed. Add a finance-shaped CSV template later (BM-48). |
| BM-37 | Secret notes | A visibility flag, explicitly "not encryption"; hidden from API reads with a second server gate (`lib/notes.php`) | No secret notes; locks are "finished", not confidentiality | IGNORE | — | — | Do not add a false-security feature. Whole-vault encryption is the honest answer (`VISION.md` already accepts it). |

### 4.4 Money

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-38 | Ledger capture | Monthly Persian periods, 12 default categories, expense/income, quick log, recent entries, import/export (`finance/`) | Finance kit: 7 databases (Accounts, Categories, Transactions, Budgets, Recurring, Holdings, Assumptions) + starter pages; chat receipt capture (`20-finance-kit.md`) | DEFEND | — | — | Our model is more general (accounts, holdings, provenance, transfers) and better owned. Their capture flow is faster; borrow the **quick-log** affordance. |
| BM-39 | Budgets | Caps per category, unlimited budgets, usage/remaining, charts, Excel | Budgets DB + Budget vs actual page; no unlimited; correct arithmetic (`finance-plan.ts`) | ADAPT | P2 | S | Add **Unlimited** (or "no cap") flag and usage bars; then add the monthly close view (BM-44). |
| BM-40 | Debts / credits | First-class: two directions, separate totals, three schedule types, statuses, payment linking, reconciliation, audit (`lib/obligations.php`) | None | ADAPT | P1 | XL | Biggest functional gap in the whole benchmark. Phase it: (1) debts/credits list + one-time due + link to transaction; (2) recurring/split schedules + statuses; (3) calendar/reconciliation. See §6.3. |
| BM-41 | Recurring commitments | Generated at read time from a plan; stable occurrence ids; month-end clamp; no cron (`lib/obligations.php:34-42`) | Recurring rows exist and feed projections, but are never posted or turned into dues (`finance-plan.ts`) | ADAPT | P1 | L | When BM-40 lands, make recurring rows generate **dues** (not transactions) with stable ids, and let the operator pay one into a transaction. |
| BM-42 | Payment ↔ ledger link | Atomic: decision + ledger entry + both revisions in one transaction; undo removes only an unchanged created entry; retries idempotent (`lib/obligations.php:270-311`) | No commitment concept; manual transaction edits | ADAPT | P1 | M | Copy the transactionality: paying a due must write the transaction and the due status together, and undo must not delete edited entries. |
| BM-43 | Status / reconciliation | pending, paid, rejected-optional, deferred/late, needs reconciliation; restore; payment history (`docs/financial-commitments.md`) | None | ADAPT | P1 | M | Same feature. Keep the status set smaller for v1 (pending/paid/skipped/overdue). |
| BM-44 | Monthly close | Period selector with create/navigate, copies categories only, no carryover (`docs/finance-periods.md`) | No period object; budgets carry `YYYY-MM` strings | ADAPT | P2 | M | Add a **Month close** page: month picker, spend by category, unbudgeted, uncategorized, carry-forward prompt. Ties Finance to Reviews. |
| BM-45 | FX / currency | 31 display currencies, labels only, never converts (`assets/currency.js`) | One configurable USD→ZAR rate with source URL, hourly refresh, stale/error state (`20-finance-kit.md:91-103`) | DEFEND | — | — | Ours is real FX, theirs is a label. But our **ZAR-only** house currency is a locale assumption; make the base currency configurable (S) before any non-ZAR user. |
| BM-46 | Receipt capture | Card attachments only | Chat photo → re-encoded for model, original stored, provenance, undo/correct (`20-finance-kit.md:104-121`) | DEFEND | — | — | Genuinely ahead. Add a receipt gallery per month later (P3). |
| BM-47 | Planning / scenarios | None | Assumption sets, projection, scenario compare, net worth (`20-finance-kit.md:123-141`) | DEFEND | — | — | Unique. Their money stops at the current month. |
| BM-48 | Money reports | Excel export, charts, print | Ledger/Spend/Budget/Net worth pages; no export/print | ADAPT | P2 | M | Reuse BM-35's export machinery for finance pages. |

### 4.5 AI and agents

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-49 | Agent surface | 18 MCP tools (1 generic `lifeos_query` + 17 typed writes), stdio only, npm + MCP registry (`mcp/src/tools.js`) | 76 tools across 12 modules, two HTTP doors, same executor for Hermes and paired agents (`packages/vault-core/src/index.ts:362-376`) | ADAPT | P1 | M | Consolidate reads behind a few **query** tools with a `type` discriminator and strict per-type argument refinement; keep writes typed. Reduces context cost and mis-selection. |
| BM-50 | Agent safety / approval | Client-side approval prompts only; one static bearer token bound to account 1; no scopes or per-user tokens (`docs/api.md:5,22`) | Pairing invites, per-agent grants (domains / write / schedule), NOT_FOUND masking, Decisions for meaning-changing writes, companion-only tools (`pairing-grant.ts`) | DEFEND | — | — | Our strongest intellectual property. Keep the model; document it as a differentiator. |
| BM-51 | Read coverage | Roughly half the app is invisible to AI (no Todo, Growth, obligations, Calendar, Focus, Email, boards/labels/comments) (`lib/api_router.php`) | Every major surface has tools (goals, tasks, docs, reviews, capture, scripts, projects, DBs, views, daily notes, pages, signals) | DEFEND | — | — | We win on reach; do not trade it for their narrow simplicity. |
| BM-52 | Embedded assistant | None; user brings Claude/Codex | Hermes chat dock: threads, tabs, models, thinking level, stop, page context, card context, questions (`24-companion.md`) | DEFEND | — | — | Their product has no in-app intelligence; it is a target for external agents. Ours is a studio with a partner. |
| BM-53 | Context awareness | Whatever the client sends | Page in front of the operator rides each turn (4k chars, quoted as untrusted), card context, explicit opt-out (`LAWS/COMPANION.md`) | DEFEND | — | — | Keep; add a "what the companion can see" preview per turn later. |
| BM-54 | Ambient input / digest | IMAP inbox + AI summary of last 24 h, four sections, BYO key, prompt-injection guards (`docs/email.md`) | None (companion could use skills) | WATCH | P2 | M | If we want this, ship it as a **Hermes skill/tool**, not a studio inbox: the studio should not own mail credentials or an inbox. |
| BM-55 | Model/provider config | BYO key for digest only | Hermes profile catalog, model pill, Automatic, reasoning level | DEFEND | — | — | Ours is broader. |
| BM-56 | Automations / scheduled agents | cron digest script only | Automations shelf + scheduler; runs as chats; last-run status | DEFEND | — | — | Unique. Add suggested automation templates after reviews land (e.g. "prep weekly review"). |

### 4.6 Reflection and insight

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-57 | Home surface | Score ring + 4 KPIs + 6 dimensions + 2 charts + heatmap + 3 lists + weather + email (`dashboard.js`) | Pin board per lens: six system cards + pins, quiet, rearrangeable, card→chat (`06-dashboard.md`) | ADAPT | P1 | M | Keep the quiet board; add **one "Today" card** that names the next thing (due task, deadline, pending Decision, review due, due bill) instead of a score. |
| BM-58 | Composite score | 0–100 average of non-zero parts + grade + delta vs last week (`dashboard.js:304-310`) | Explicitly refused: no score, streak, grade or analytics screen (`PRODUCT.md:15-17`, `VISION.md:92-96`) | IGNORE | — | — | Do not copy. It is gameable (zero components dropped), partly like-for-like (goal progress omitted from the baseline), and conflicts with our anti-reference. |
| BM-59 | Trends / heatmaps | 14-day focus and habit charts, 16-week heatmap, insight cards | None; computed facts only (goal pace, review snapshots) | WATCH | P2 | M | If habits land, a **private** month grid and streak are enough. No scoreboard, no composite, no "strong days" language. |
| BM-60 | Review history | Growth review list with per-dimension reflections | Pager only, no review list screen (`18-reviews.md:97-99`) | ADAPT | P2 | S | Add a compact "Past reviews" index on the Review wing; it makes the archive visible and helps the companion. |
| BM-61 | Share / export insight | Canvas image of dimension scores (reflections excluded) | None | WATCH | P3 | S | A share image of a review summary could be a nice review habit; not core. |
| BM-62 | Log / audit | Partial (payment history, revisions) | Append-only life log with actor, domain, type, payload; log page (`26-log.md`) | DEFEND | — | — | Keep. Ensure every new feature writes a log line (habits, obligations, search actions are not actions). |

### 4.7 Platform, data and operations

| ID | Capability | LifeOS | LifeQuest | Verdict | Pri | Effort | Notes / what to do |
|---|---|---|---|---|---|---|---|
| BM-63 | Storage model | MySQL; 20 JSON docs/user + relational tables; 2 MB doc cap; no cross-doc query (`lib/schema.php`, `state_store.php`) | Vault files (markdown/JSON/JSONL) + one SQLite per domain; registry + books export; Git-friendly (`paths.ts`, `19-data-and-databases.md`) | DEFEND | — | — | Ours is the better ownership model. Their untyped documents are their long-term liability; ours are typed and inspectable. |
| BM-64 | Conflict handling | Whole-document CAS; stale save → 409 "copy your edits and reload"; no merge (`docs/api.md:49-51`) | Single writer, one write queue, data-revision counter; file-changed banner; Decisions reconcile agent writes (`30-system-architecture.md`) | DEFEND | — | — | Our model is the better answer for one operator + agents. Note the cost: no multi-device concurrency, by design. |
| BM-65 | Revision / undo history | Notepad transactional history; no general document history | None | ADOPT | P1 | M | See BM-29. Also add **undo** for destructive UI actions (BM-16) — small, high trust. |
| BM-66 | HTTP API | `/api/v1`: ~16 route groups, bearer token, documented contract (`docs/api.md`) | MCP only; no REST/HTTP API (`30-system-architecture.md:199-227`) | WATCH | P2 | M | Our deliberate choice avoided a second contract. If we add one, make it **read-only**, local, token-gated, and generated from the same tool schemas. |
| BM-67 | Import / export / portability | Excel import/export, per-note export, `mysqldump` backup; no whole-app export | CSV ingest, books.json export/restore, vault is portable; no user-facing markdown/PDF export | ADAPT | P1 | M | Add document/review/page export (BM-35) and a "vault health" report (counts, last backup, git status). Avoid a proprietary archive. |
| BM-68 | Multi-user | Schema v3 multi-account private workspaces; all admins; API still bound to account 1 (`docs/accounts.md`) | None by design; one operator per vault (`LAWS/IDENTITY.md`) | IGNORE | — | — | Their multi-user is a trust caveat (admins can reset each other). Do not add tenancy; revisit only for a household edition with a real isolation design. |
| BM-69 | i18n / RTL / Jalali | Persian UI (1,664 keys), RTL, Persian digits, Vazirmatn, optional Jalali in Habittify; Arabic offered but empty; docs drift (`i18n.js`) | English only, Gregorian | IGNORE | — | — | Not our market today. Two caveats to fix cheaply: the Finance kit's ZAR/USD assumption (BM-45), and date/number formatting that assumes en-US. |
| BM-70 | Mobile / PWA | Responsive web + mobile drawer; no manifest, service worker or offline | Desktop only | IGNORE | — | — | `VISION.md` puts a phone client in future scope. When it happens, its job is queue-and-view, not a second studio. |
| BM-71 | Onboarding / time-to-value | Config file → browser → sign in; schema self-creates; three documented install paths; Docker workflow tests the README path | Electron installer → companion check → create/open vault; Hermes is a hard prerequisite; unsigned Windows build | ADAPT | P1 | M | Add a **sample vault** ("Explore a demo life"), a first-run checklist card, and a one-click diagnostics copy on the companion setup screen. Measure time-to-first-page. |
| BM-72 | Distribution | Docker compose, multi-arch GHCR image, shared-host zip; npm-published MCP | Windows installer + zip via GitHub Releases; no signing, no auto-publish pipeline | ADAPT | P2 | M | Decide platforms (Windows only? macOS?) and sign the installer; publish SHA-256 and a manifest. Do not build a hosted service. |
| BM-73 | Docs shape | 11 user docs, README as a hub, landing page, demo GIF, troubleshooting with six real failures; no index in `docs/` | 35-page wiki (7,395 lines), LAWS, VISION/PRODUCT/DESIGN, 51 specs; no front door, no demo, wiki pinned at 0.2.0 | ADAPT | P0 | S/M | Keep the wiki depth; add the outward surface: README as a sales page, one landing page, screenshots (light/dark pairs from **one** commit), a 20 s demo of one real story, and a "limits" section. See §6.9. |
| BM-74 | Claims integrity | Visible drift: workspace count 10/11/12, "15 tools" vs 18, "streaks", "session history", "Asia/Tehran" (`README.md` vs code) | Visible drift: wiki 0.2.0 vs 0.2.5, retired `autoApproveInserts`, "Execute" vs **Act**, Decisions lens claim, update poll, Settings tab count, README Hermes fields, license contradiction | ADOPT | P0 | S | Generate counts from code; add a docs-drift test; fix the wiki truth pass; decide the license. This is cheap and it protects every other claim we make. |
| BM-75 | Testing / CI | Five workflows (unit, integration, MySQL migration, Docker install-path smoke, release), but Node suite red at HEAD | 72 Electron E2E rigs, JSON + screenshot artifacts, no CI except docs deploy; 100/107 reports pass but stale ones mixed in | ADAPT | P0 | M | Add CI for `typecheck`, a docs-drift check, and a fast E2E subset; prune stale artifacts. Copy their **Docker test of the README path** idea as an install-path E2E. |
| BM-76 | Security posture | CSRF everywhere, AES-256-GCM third-party secrets with AAD, per-user row scoping, CSP, sandboxed HTML preview; but one static token, `unsafe-inline` scripts, Google Fonts/jsDelivr at runtime | Vault containment, safeStorage, loopback MCP doors with auth-before-transport, pairing grants, CSP, hardened window, update trust chain, unsigned installer as the one gap (`29-security.md`) | DEFEND | — | — | Ours is stronger and better documented. Their third-party runtime calls are a good reminder: keep the no-CDN, no-font-CDN rule. |
| BM-77 | License / public posture | MIT, consistent | Public repo, `license: null`, package `UNLICENSED`, README says "Private / unpublished" | ADOPT | P0 | S | Choose the license (MIT or source-available) and state it once in README + package.json. This is a prerequisite to any public-facing claim or contribution. |

---

## 5. Where the products actually differ (scorecard)

Judgment scores 0–3, "how well does this product serve the job", not a feature count.

| Job | LifeOS | LifeQuest | Read |
|---|---|---|---|
| Define a life (values, vision, areas) | 1 | 3 | We have doctrine, domains and locks; they have six fixed dimensions and a "why" field |
| Turn vision into goals | 3 | 2 | Their wizard, priorities, measures and progress sources are deeper; our record is cleaner |
| Run a day | 3 | 1 | Todo + habits + focus + calendar + alerts vs a board and a schedule |
| Reflect on a period | 2 | 3 | Their 8-step review is pleasant; our period packs and locks are a system |
| Manage money | 3 | 1.5 | Their commitments model is the deepest finance feature in either product |
| Capture knowledge | 2.5 | 2.5 | Their editor/history/canvas; our capture/daily note/pages/DBs |
| Work with an agent safely | 1.5 | 3 | Our Decisions/pairing model is far ahead; their approval is client-side |
| Own and port the data | 1.5 | 3 | Vault + offline + no CDN vs MySQL + Google fonts + jsDelivr |
| Onboard and distribute | 3 | 1 | Three install paths and a landing page vs Electron + Hermes |
| Work in another language / RTL | 3 | 0 | Persian-first; not our market |
| Multi-user / household | 1.5 | 0 | Multi-account with admin caveats; we are deliberately single-operator |
| Quality process | 2 | 1.5 | They run more CI but it is red; we run deeper E2E but no CI |
| Extensibility of the life model | 0.5 | 3 | Pages, custom DBs, script blocks vs fixed workspaces |
| Presentation / explainability | 3 | 1 | Score + visuals + README/landing vs wiki + quiet UI |

**What the shape says:** they win the *operational* layer (day, money, habits, focus),
we win the *architectural* layer (definition, governance, ownership, extensibility).
A feature race on their terms would be a mistake: it would add operational breadth
while our structural advantages are still under-explained and under-presented.

The strategic move is to **close the operational gaps that feed our architecture**
(due dates → day → reviews → goal evidence; commitments → finance → monthly close;
habits → goal evidence; search → every record), and **sell the architecture clearly**
(front door, demo, docs truth). Do not build a second product to compete with theirs.

---

## 6. Deep dives

### 6.1 Two spines: the daily score versus the life structure

Their Overview is the product. It computes a 0–100 score as the unweighted mean of
non-zero parts — focus minutes toward 90, seven-day habit completion, average goal
progress, done share of Kanban cards — then adds a grade ("Building", "Strong"), a
delta against last week, and a sentence that interprets it
(`public_html/assets/dashboard.js:304-373`). Below it: four KPI cards, six life
dimensions, two charts, a heatmap, goal/workload/finance lists, weather and an email
summary. It is dense, alive and immediately legible in a screenshot.

That number is also the most gameable artifact in their product. Components equal to
zero are filtered out, so missing data *raises* the average; goal progress is forced to
zero in the baseline, so the week-over-week delta compares unlike things; and the grade
bands are arbitrary. The docs even say elsewhere "these indicators are not a wellbeing
score" (`docs/growth.md:41-42`), which is the right instinct applied to Growth but not
to the Overview.

Our Dashboard refuses this on principle (`PRODUCT.md:15-17`, `VISION.md:92-96`): a pin
board per lens, quiet cards, no score, no grade, no gauges. That remains correct. What
we can take without breaking the principle is the **legibility of one sentence**: a
single "Today" card that says what needs attention now — the next due task, a goal
deadline inside seven days, a review due, pending Decisions, a due bill — and a short
narrative line ("Two decisions waiting; weekly review due tomorrow"). No number, no
grade, no delta, no ring. The card is a **signpost**, not a scoreboard, and it uses facts
the vault already knows.

**Decision:** ADAPT the one-glance narrative; IGNORE the score and grade.

### 6.2 Growth: the six dimensions, long-term plans and the review that carries forward

Their Growth workspace is the best-designed feature in their product, even though it is
built on top of Goals and Habittify rather than owning data. Four ideas are worth
separating:

1. **A fixed, opinionated life taxonomy.** Six dimensions with icons, colours and hints
   (Religion & Spirituality, Health, Relationships & Family, Finance, Self Growth, Fun &
   Rest). Not editable. It gives the product a values statement and a screenshot that
   reads in two seconds (`public_html/assets/growth-model.js:6-16`).
2. **A long-term plan layer.** Each plan has a dimension, title, "why", target date,
   status (active/achieved/archived), and links to existing SMART goals and habits. The
   sources stay owned by their own workspaces; Growth only references them
   (`docs/growth.md:11-17`).
3. **An eight-step review.** Cadence → one panel per dimension (showing the linked goals'
   and habits' evidence and the *previous* next step) → editable summary. Only "Save
   review" writes; snapshots are frozen at save time.
4. **Review due logic.** Weekly 7 / monthly 30 / quarterly 90 days from the last review
   of the same cadence; due today if there is none; a strip on the Overview shows which
   cadence is due.

Our counterparts: configurable Domains (richer), doctrine (deeper than "why"), five
review cadences with period packs and locks (deeper), but **no layer between doctrine
and goals**, and no "next step" that carries forward per domain. The goal record is flat.

**What to take**

- **A horizon on goals, not a second plan object.** Add an optional `horizon`
  (`long-term` / `period`) plus an optional `parentGoalId`, so an outcome ("be healthy at
  45") can own measurable goals. This preserves our one-record model and the "goal has a
  deadline or a definition of done" rule.
- **A "why" field.** Their plan's `why` is cheap and gives goals emotional context. Our
  goal record has `notes`; a distinct one-line why is better for display and for the
  companion's context.
- **Carry-forward next step per domain.** In our review skeleton, the domain section
  already has `Look-back / Keep / Change / Next-period intent`. Add the previous period's
  "Next-period intent" as a quoted line under `Look-back`, and a "review due / up to date"
  strip on the Review wing. Both are small and high-value.
- **A life-areas view derived from our domains.** Do not invent a second taxonomy. A
  read-only card row on the Dashboard showing each live domain with its open goals,
  last review date and doctrine state gives the same "six cards" glance without a fixed
  six.

**What to leave**

- The fixed six dimensions. Our domains are configurable and carry doctrine; a fixed
  taxonomy would contradict "each domain holds four sections".
- The share image of scores. A share artefact that exports *reflections* would be
  interesting; one that exports percentages is a scoreboard by another route.
- Their snapshot model, which stores a numeric snapshot per dimension. Ours already
  computes figures from the vault at review time; if we add history, store the facts we
  used, not a derived percentage.

### 6.3 Finance commitments: the biggest functional gap

Their obligations module is the deepest domain in either product and the clearest
functional gap for a life-management app. In `lib/obligations.php` and
`docs/financial-commitments.md`:

- Two directions: **I owe** (payment → expense) and **owed to me** (receipt → income),
  never mixed, separate totals.
- Three schedule types: one-time; recurring same amount (daily/weekly/monthly/yearly,
  interval 1–12, no end / payment count / end date), with optional-subscription skips;
  and split-total installments (whole units, remainder in the last payment).
- Occurrences are **derived at read time** from the plan with stable ids
  (`planUUID:index`), monthly/yearly dates anchored and clamped to short months, no cron
  or placeholder rows. Refreshing cannot duplicate dues.
- Statuses: pending, paid (linked to a specific ledger entry in a chosen period),
  rejected-optional (skipped), rejected otherwise (deferred debt / late credit, still
  owed), plus derived overdue and **needs reconciliation** when a linked entry disappears
  or its amount changes.
- Paying is **atomic**: the decision, the ledger entry and both documents' revisions
  commit in one MySQL transaction under key-sorted row locks. Undo removes only an
  unchanged created entry; linked pre-existing entries are retained; retries are
  idempotent (`lib/obligations.php:270-311`).
- Calendar overlays generated dues with status labels; clicking opens the Finance
  occurrence.

Our Finance kit is a **ledger**, not a commitments system: accounts, categories,
transactions, budgets, recurring rows, holdings, assumptions, plan pages. Recurring rows
feed projections but are never posted and never become something you can pay. There is
no debt/credit concept, no due generation, no payment linking, no statuses, no
reconciliation.

**Phased design that fits the vault**

*Phase 1 — the list and the link (L, 1–2 weeks).* Two databases in the Financial domain:
`Commitments` (`direction` debt/credit, `counterparty`, `amount`, `currency`, `due_date`,
`status`, `notes`, `transaction_id` relation, `recurrence` optional) and keep the
existing Transactions. A due is a row in the database, not a generated ghost — simpler
than their derived model and consistent with our "the book is the database" law. A
"Pay" action writes a Transaction and sets the due's status + link atomically in
vault-core; "Undo" reverses only if the transaction is unchanged. A "Commitments" page
shows I owe / Owed to me, this month, overdue, and next 30 days. The Dashboard gets a
`Due bills` card.

*Phase 2 — recurrence and splits (L, 2–3 weeks).* A recurring plan row generates due rows
on vault open (idempotent by `planId + sequence`, persisted, so no duplicate on refresh).
Split-total: a plan plus N dues; the remainder goes to the last one. Statuses:
pending/paid/skipped/overdue. No projection yet.

*Phase 3 — integration and reporting (M, 1 week).* Calendar/Life Map due lens, monthly
close report, reconciliation warnings, and companion tools: `list_commitments`,
`create_commitment`, `pay_commitment`, `undo_commitment_payment` — all through the same
database row machinery, with pay/undo as direct writes only when unambiguous, otherwise
a Decision.

**What not to copy:** their session-only endpoint and missing MCP tool (the assistant
cannot answer "what do I owe this month?") — a good reminder that every new surface must
be added to our tool set and pairing grants. Also skip their 200-plan/600-payment caps
as product rules; use validation and performance data instead.

### 6.4 Execution ergonomics: what to take from Todo, Kanban and Focus

Their execution surface is broad: Todo (five views, custom lists, subtasks, priorities,
due dates, search, shortcuts, undo), Kanban (boards, labels, dates, recurrence,
reminders, checklists, comments, members, custom fields, attachments, card→goal),
Focus (timer, breaks, soundtrack, generated landscape), Calendar (projection of cards
and dues), due alerts (bell, panel, browser notifications).

Our Act is a six-column board with cards that can link to a goal, project, date, week
item or signal — strong for planning, thin for a day. Specifically missing:

- **A due date on a task.** Our `Task` has `links.date` but that is a link, not a due
  date, and nothing surfaces it as "today".
- **A Today/Upcoming view.** The board shows columns, not time.
- **Search.** No way to find a task among hundreds.
- **Undo.** Delete is immediate and permanent.
- **Subtasks and priority.** Their Todo has both; ours has neither.

The temptation is to build their Kanban. Don't. Our product is not a project management
app, and our Act board already covers the planning dimension. The right scope is the
**day unit**:

1. Add `dueDate` (optional) and `priority` to tasks (M).
2. Add two read-only views over the same tasks — **Today** (due today + overdue) and
   **Upcoming** (dated) — as tabs or a filter on Act (S/M).
3. Add a Dashboard **Today** card (BM-57) that lists them, plus pending Decisions and
   review due.
4. Add a single undo toast for destructive task actions (S).
5. Add subtasks only if user evidence says they are needed (P2).

Focus timer is a different question. Their timer is genuinely good — it survives
reloads, handles the four-round cycle, logs only completed focus intervals, and pairs
with a soundtrack and a time-of-day scene. A simple version could fit our Daily
Schedule: start a timer from a scheduled block, log actual minutes, and let the review
pack read them. That is more coherent than a standalone Pomodoro ritual. Build it as a
Daily Schedule enhancement (P2), not a new wing.

### 6.5 Connective tissue: their loops are automatic, ours are agent-mediated

Their README's promise is "connected, not just collected". The connections are real and
mostly automatic:

| Loop | How it works |
|---|---|
| Habit → goal | Goal stores `habitProgress`; progress derives from `habit_logs` |
| Kanban → goal | "Move to goal" converts a card into a checklist goal in one transaction, deleting the card |
| Kanban/dues → calendar | Calendar is a read-only projection; clicking deep-links to the source |
| Any data → score | Overview recomputes from cached documents |
| Due → alert | Due alerts read cards, goals and commitments |
| Review → source workspaces | Growth links goals/habits and deep-links to edit them |

Our connections are also real, but many are either records pointing at each other
(goalId/projectId/signalId links, event→goal) or agent-mediated (the companion collates
context and files Decisions). The automatic loops we do have are strong: tasks↔Daily
Schedule, daily notes→review packs, review snapshots→vault queries, pins→chat context,
page blocks→domain SQLite.

The gap is **evidence flow without the agent**: because our goal progress is written, a
completed linked task does not show up anywhere near the goal. Because our reviews are
computed at review time, there is no living "this period's evidence" surface. Because
our commitments don't exist, finance cannot flow into the day or the review.

**Recommendation:** add read-only **evidence rows** to records that already have links:

- Goal page: "Linked tasks: 4/7 done · linked practice: 12 days · linked events: 2" and
  a small "Evidence" panel. Not used to change `current`; the operator still writes it.
- Review pack: already includes tasks/log/events; add the previous period's next intent
  and a "figures the app computed" block for any snapshot rules (already exists).
- Today card: pulls due tasks, commitments, Decisions, review due, deadlines — all
  already in the vault.

This is the honest version of their score: **show the evidence, let the human judge.**

### 6.6 The AI surface: 18 tools vs 76, and what each gets right

| | LifeOS | LifeQuest |
|---|---|---|
| Transport | stdio MCP only, separate Node package | Two loopback HTTP MCP doors (local + invite), same process |
| Tools | 18: one `lifeos_query` read tool + 17 typed writes | 76 across 12 modules: map/tasks, goals, documents, reviews, capture, scripts, projects, databases, views, daily notes, pages, signals |
| Read coverage | Goals, tasks, habits, finance, notes, notepad | Every major vault surface |
| Write safety | Typed writes; destructive ones annotated; approval is the MCP client's job | Decisions queue for meaning-changing writes; immediate writes for a named small set; pairing grants scope domains and capabilities |
| Identity | One static bearer token bound to account 1; no scopes, no rate limit | Invite → first-contact Decision → per-agent grants; secrets outside the vault |
| Distribution | Published to npm and the MCP registry; no clone needed | Not published; the companion connects locally |
| Context cost | Deliberate: 12 read tools collapsed into 1 to save context | 76 tool definitions is a large context and selection burden |

**What to take**

1. **The query-tool pattern.** Add a small number of read tools with a `type`
   discriminator and strict per-type argument refinement, e.g. `query_life` for
   goals/tasks/reviews/signals, `query_data` for databases/rows/views, `query_docs` for
   pages/documents/daily notes. Keep writes typed. This is not just context hygiene; it
   also makes the tool list explainable to the operator and to paired agents.
2. **Publish the companion's MCP server.** Our local/invite doors are localhost-only, so
   an external Claude/Codex cannot use them today. If we want the "your AI can use it"
   story, a thin stdio package that talks to the invite door (or to a future read-only
   HTTP API) is the same move they made — without weakening the approval model.
3. **Docs that state the contract.** Their `docs/api.md` is a model of an integration
   contract: routes, envelope, statuses, per-domain semantics, concurrency, limits. Our
   MCP tools deserve a generated reference (from `MapToolDef`) in the wiki.

**What to defend**

- Server-side approval. Their model relies on the client to ask; a misconfigured client
  can delete data. Ours enforces Decisions in the writer.
- Per-agent identity and scoping. A single token bound to one account means every client
  is the owner. Our grants are a real product feature.
- Reach. Their AI cannot see Todo, Growth, obligations, Calendar or Focus. Ours can see
  every major surface; don't trade that for a smaller tool list — consolidate, don't cut.

### 6.7 Data and trust: compare-and-swap versus the vault

Their persistence is the best-engineered part of the product. Every document write is a
SHA-256 revision CAS; stale writes get a 409 and the client stops saving. Multi-document
mutations insert placeholders for missing rows, lock all rows in key order with
`SELECT ... FOR UPDATE`, check all expected revisions, run one mutator, then write. The
obligations pay path and kanban→goal conversion use this to commit across documents
atomically (`lib/state_store.php:61-110`). Notepad history is written in the same
transaction as the content change, with restore guarded by a revision precondition
(`lib/notepad_history.php`).

Ours is more ambitious in ownership and weaker in per-record history. The vault is
typed, portable, diffable and offline; the single-writer queue plus data-revision counter
means one operator + agents cannot corrupt it. But there is no per-document version
history, no general undo, and no "restore an earlier version" affordance outside Git and
books restore.

**What to take**

- **Version history for documents, notes, reviews and pages** (`bm-66`). Store snapshots
  in the vault, not a hidden service: e.g. `.lifequest/history/<kind>/<id>/<timestamp>.json`
  with a content hash to dedupe. Restore is explicit, keeps the overwritten version, and
  logs `document.restored` with the actor. Retention: keep last N + all versions that
  were approved/reviewed; prune on vault open with a documented policy.
- **Undo for destructive UI actions** (`bm-16`): a generic toast with an inverse command
  for delete task, remove pin, delete note, delete decision file. Cheap trust.
- **Transactional multi-record writes** for the features that need them (obligations
  payment, goal evidence, review marking): vault-core already has atomic write helpers;
  use them rather than a sequence of independent writes.
- **A visible revision/health surface**: the file-changed banner exists; add "last
  saved", "modified on disk", and a "check vault" action that validates JSON/JSONL and
  SQLite integrity.

**What to leave**

- Whole-document JSON documents with 2 MB caps and no schema. Our typed records are the
  reason the vault can be inspected and scripted.
- Their "409, copy your edits, reload" concurrency UX. For one desktop operator it is
  rarely hit; when it is, our file-changed banner plus Decisions is the better story.

### 6.8 Onboarding and time-to-value: their front door is their biggest win

Their install paths: `docker compose up -d` with a `.env`, a published multi-arch image,
a 50 MB shared-hosting zip, or `php -S`. Configure credentials, open the browser, sign in
— inside the product in minutes. Their Docker workflow actually boots the stack, signs in
and follows the README instructions (`docker.yml`), which is the single best quality idea
in their repo.

Ours: install an unsigned Windows app, install/discover Hermes, get the companion
profile working, create or open a vault, then the studio opens. The companion failure
states are named and the setup card is honest, but time-to-value is long and the first
run depends on an external agent host.

**Recommendations**

1. **A sample vault** the operator can open without committing ("Explore a demo life"):
   four domains, a few goals, a project, a week of daily notes, a review, a finance book.
   It demonstrates the loop in the first two minutes and is safe to delete.
2. **A first-run checklist card** on the Dashboard: companion ready → vault open → write
   doctrine for one domain → add a goal → capture a thought → place a task on the
   schedule. Each item links to its surface and disappears when done.
3. **One-click diagnostics** on the companion setup screen ("Copy diagnostics") with
   version, profile, port state and last error. Their troubleshooting doc lists six real
   first-run failures; ours has seven named states but no export.
4. **A "what you need" page** in the README/wiki that states the Hermes prerequisite up
   front, how to check it, and what to do if it fails.
5. **Measure it**: add one E2E rig that follows the README's install path on a clean
   profile and asserts the studio reaches the Dashboard. That is how their Docker test
   keeps the documented path honest.

### 6.9 Presentation: the README/landing/demo gap

This is not vanity. Their README is a sales page: a hero GIF that tells one micro-story
(tick a habit → ask Claude to log an expense → see it in Finance), light/dark screenshots
selected by `prefers-color-scheme`, a capability table, three copy-paste install paths,
an honest limits section, and links to docs. Their landing page adds a problem framing,
feature cards, a simulated tool-call transcript and a FAQ.

Ours is an engineering index: strong on specs and laws, weak on "why would I want this".
The wiki is genuinely good and should stay as the operator's manual; it is not the front
door.

**Minimum viable front door (P0, S/M):**

- README hero: one sentence, one screenshot (light + dark), three proof bullets (vault on
  disk, Decisions, reviews), one "what it is not" list, one link to the wiki.
- One static landing page (can live in the docs site): problem, three screens, one
  20-second demo, download, "what it is not", limits.
- A demo GIF/MP4 of one real story in the real app. Their 22-second GIF is the most
  persuasive artefact they have; ours should show the **Decision loop** because that is
  our signature: capture → agent proposes → approve → review.
- Screenshots generated from one commit, both themes, with the app in a representative
  state. Do not let marketing assets drift from the build (their light and dark
  screenshots show different nav orders — visible sloppiness).

### 6.10 Claims, docs and CI: their most visible defect is our opportunity

Their claims drift in ways a careful reader finds in minutes: "ten workspaces" vs twelve
rows vs eleven in the Persian README; "15 MCP tools" vs 18; "streaks" without a streak
counter; "session history" that is chart data; "dates follow Asia/Tehran" while Todo uses
the browser's local day; Arabic selectable with no dictionary. Their Node suite is red on
main for four consecutive pushes while release notes and a demo ship. The cause is
predictable: no generated claims, no docs drift check, no gate that a public artefact
must be backed by a green build.

We have the same disease in a different place: the wiki is pinned at 0.2.0 while the app
is 0.2.5; the retired `autoApproveInserts` allowlist is still documented as live; the
wing is called "Execute" in the wiki and "Act" in the app; Decisions is documented as
lens-filtered but is global; update polling is documented as once-per-launch but runs
hourly; Settings has 11 tabs, not 9; `README.md` still describes Hermes fields that no
longer exist; the repo is public with no license while the README says "Private /
unpublished".

**Fix (P0, S/M):**

1. A `docs:check` script that verifies: wiki version line matches `package.json`, every
   route in `App.tsx` appears in the wiki index, every tool in `ALL_TOOL_DEFS` appears in
   the tool reference, every Settings tab is listed, and README claims (workspace/route
   counts) are generated or checked.
2. A truth pass on the wiki: version, Act, Images page, Decisions global, database write
   rules, update polling, Settings tabs, project fields, README Hermes section.
3. Decide the license and state it in `README.md`, `package.json` and the repo.
4. CI: `typecheck` + `docs:check` on every PR, and a fast E2E subset (not the full bench)
   that covers routes, Decisions apply, and vault open. Keep the full bench for releases.

This is unglamorous and it protects every claim the product makes. Their red CI behind a
green demo is exactly what we should not become.

### 6.11 What "docs as a product" looks like on their side

Their `docs/` are engineering decision records: `growth.md` defines the progress math and
states the refusals; `financial-commitments.md` defines statuses, edge cases and
transactionality; `accounts.md` states the admin-reset risk in plain language;
`troubleshooting.md` lists six real first-run failures with causes and fixes.

Ours already does this in `docs/superpowers/specs` and in `LAWS/`, but the operator-facing
wiki is the place a new user lands. The gap is not depth, it is **orientation**: start
here, what this is not, how to do the five core workflows, what to do when it breaks.
`34-common-workflows.md` exists and is good; it needs to be linked from the front door,
not buried in a 35-page wiki.

---

## 7. Gap backlog

Priority is about sequencing for **our** product, not about what is missing in absolute
terms. P0 items unblock later work or protect claims; P1 items close the gaps that
compound; P2 items are bets that should wait for evidence.

### 7.0 Upgrade existing vs build new

The cheapest value is in upgrading records and surfaces we already ship; the largest
value is in the three new loops (search/day, practice, commitments). Sequence upgrades
first where they are prerequisites, then the new loops.

| Existing feature | Upgrade | New capability it enables |
|---|---|---|
| **Goals** | horizon/parent, why, priority, start date, multiple measures, evidence links, archive | long-term layer without a second plan object |
| **Act** | due date, priority, Today/Upcoming, search, undo | the day unit; attention card |
| **Documents** | version history, backlinks, export/print | trust + portability |
| **Reviews** | carry-forward next intent, due strip, past reviews index | continuity between periods |
| **Dashboard** | one "Today" signpost card | legible daily entry without a score |
| **Finance kit** | configurable base currency, unlimited budgets, export/print | locale-neutral money, month close |
| **MCP tools** | consolidate reads behind query tools; generated reference | context budget + discoverability |
| **Wiki / README** | truth pass, generated counts, front door, demo | explainability and trust |
| **New** | global search, practice/habits, commitments, focus block, calendar due lens, backlinks, share image | the three loops and the retrieval layer |

### 7.1 P0 — next two weeks

| # | Item | Matrix | Effort | Why now | Acceptance criteria |
|---|---|---|---|---|---|
| P0-1 | **Global search and command palette** | BM-32 | M | The vault has more record types than their whole app; retrieval is the missing verb and it makes every existing feature more valuable. | `Mod+K` opens a palette from any page; searches titles and markdown bodies of pages/documents/goals/projects/signals/tasks/reviews/daily notes and DB rows by title; results show kind + domain, are keyboard-navigable, and open the record; index lives in `.lifequest/cache/` and never blocks a vault open; a search action writes nothing. |
| P0-2 | **Docs truth pass + `docs:check` in CI** | BM-74, BM-75 | S/M | Every claim we make is currently at risk; the drift is visible to anyone who reads the repo. | Wiki version line matches `package.json`; Act/Images/Decisions/update/Settings gaps fixed; `docs:check` fails on route/tool/settings/version drift and runs in CI; README Hermes section corrected. |
| P0-3 | **Decide the license and state it** | BM-77 | S | Public repo + no license + "Private/unpublished" README is a contradiction that undermines the ownership story. | One license choice in `README.md`, `package.json`, and the GitHub repo; no conflicting statement anywhere. |
| P0-4 | **Front door: README, landing page, demo, screenshots** | BM-73 | S/M | Their presentation is far stronger; we cannot explain the product in one screen today. | README hero with one sentence, light/dark screenshots from one commit, three proof bullets, "what it is not", link to wiki; one landing page; one 20 s demo recording of the Decision loop with a caption; no stale assets. |
| P0-5 | **Task due dates + Today/Upcoming + Dashboard attention card** | BM-14, BM-22, BM-57 | M | The bridge from plan to day; also the home for Decisions, deadlines and review-due. | Tasks accept an optional `dueDate`; Act gains Today (due today + overdue) and Upcoming views; Dashboard "Today" card lists due tasks, goal deadlines ≤7 days, reviews due, pending Decisions and due commitments (when they exist); each row opens its source; no score or grade. |

### 7.2 P1 — this quarter, by stream

**Execution stream** (depends on P0-5)

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-1 | **Practice/habit page** | BM-19, BM-07 | L | New Execute page: create practice (name, cadence, optional domain), one-tap check-in, month grid with backfill, current streak and longest streak; a goal can link a practice as **evidence** (read-only, never auto-writes `current`); no composite score, no grade. |
| P1-2 | **Undo toast for destructive actions** | BM-16 | S | Delete task/note/signal/pin shows an undo toast for ~6 s; undo restores the exact prior state and logs it; no undo for any action that already wrote outside the vault. |
| P1-3 | **Simple focus block timer** | BM-20 | S/M | Start a timer from a Daily Schedule block; on stop, log actual minutes on the block; the review pack includes focus minutes; no standalone soundtrack/scene in v1. |

**Money stream** (phased; see §6.3)

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-4 | **Commitments phase 1** | BM-40, BM-42 | L | Commitments database + page (I owe / Owed to me), one-time dues with due date, pay → creates a linked transaction atomically, undo reverses only an unchanged transaction, Dashboard card, companion tools `list_commitments` / `create_commitment` / `pay_commitment` / `undo_payment`; all writes logged. |
| P1-5 | **Configurable base currency** | BM-45 | S | Finance kit base currency is a setting (default ZAR for existing vaults); one FX source per non-base currency; all existing pages use the setting; no other locale assumptions added. |

**Knowledge stream**

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-6 | **Document version history** | BM-29, BM-65 | M | Every content-changing save of a document, note, page or review writes a snapshot (hash-deduped) under `.lifequest/history/`; a History panel lists versions with time/actor, previews, and restores with confirmation; restore keeps the overwritten version; retention policy documented; a `history.restored` log entry names the actor. |
| P1-7 | **Export and print** | BM-35, BM-67 | M | Export a document/review/page as Markdown, and any reading surface as PDF/print with a clean stylesheet; export includes metadata (title, period, domain); no proprietary archive. |
| P1-8 | **Backlinks from the search index** | BM-33 | S | A "Referenced by" panel on documents/pages/goals shows incoming wiki links from the index; clicking opens the source; no graph view. |

**Agent stream**

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-9 | **Consolidate MCP reads** | BM-49 | M | Read tools collapse into a small query surface with `type` discriminators and strict per-type argument validation; tool count drops materially; every existing read capability remains reachable; the tool reference is generated from the definitions; paired-agent grants still classify every tool (no unclassified tool by default). |
| P1-10 | **Tool reference in the wiki** | BM-49 | S | A generated page lists every tool, its arguments, its permission class (read / immediate / decision / companion-only) and an example; `docs:check` fails if a tool is missing. |

**Growth/reflection stream**

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-11 | **Goal depth** | BM-03, BM-05, BM-06 | M | Goals gain optional `why`, `priority`, `startDate`, `horizon` (long-term/period) and optional `parentGoalId`; multiple measures are allowed but one is the headline; a goal can link tasks and a practice as **evidence**; `current` stays written; Done and Archived are distinct. |
| P1-12 | **Review carry-forward and due strip** | BM-10, BM-60 | S | The previous period's Next-period intent appears in the domain section of the next review; the Review wing shows "due / up to date" per cadence; a Past reviews index lists periods with status. |

**Onboarding/quality stream**

| # | Item | Matrix | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-13 | **Sample vault + first-run checklist** | BM-71 | M | Welcome offers "Explore a demo life"; the demo vault opens read-only-ish with a clear "this is sample data" banner and a reset; the Dashboard shows a first-run checklist that disappears as items are completed. |
| P1-14 | **CI gates and install-path E2E** | BM-75 | M | CI runs typecheck, `docs:check`, and a fast E2E subset on PRs; a dedicated rig follows the README install path on a clean profile and asserts the Dashboard renders; full bench runs on release; stale artefacts pruned. |
| P1-15 | **Companion diagnostics export** | BM-71 | S | Companion setup screen has "Copy diagnostics" with version, profile, port state, last error; no secrets; pasteable into an issue. |

### 7.3 P2 — bets and follow-ons

| Item | Matrix | Why wait |
|---|---|---|
| Commitments phase 2–3 (recurrence, splits, statuses, calendar due lens, monthly close) | BM-41, BM-43, BM-44, BM-21 | Needs phase 1 data and feedback |
| Calendar **Due** lens on the Life Map (tasks + commitments, read-only) | BM-21 | Needs due dates + commitments |
| Focus timer full version (breaks, soundtrack, scene) | BM-20 | Nice-to-have; validate the simple timer first |
| Kanban card depth (checklists, priority, labels; no custom fields) | BM-17 | Wait for evidence from Act usage |
| Finance import template + reports/print | BM-36, BM-48 | After export/print and commitments |
| Daily brief from the companion (not an email inbox) | BM-54 | Could be a Hermes skill; validate desire |
| Read-only local HTTP API generated from tool schemas | BM-66 | Only when an external integration demands it |
| Growth share image of a review summary (reflections, not scores) | BM-61 | After reviews are exported |
| Voice dictation in editors | BM-25 | OS dictation covers it; not a differentiator |

### 7.4 Quick wins (each under a day)

1. A single `EmptyState` primitive (icon, title, one warm line, one CTA) and use it on
   every empty list — their empty-state copy is warm but there are six different
   containers; ours should be one primitive with good copy.
2. Toast + undo for delete actions (BM-16).
3. "Previous next step" line in the review domain section (BM-10).
4. Review due / up-to-date strip on the Review wing.
5. Archive (distinct from Done) for goals.
6. Print stylesheet for reviews and documents.
7. README light/dark screenshot pairs rendered from one commit.
8. Companion setup "Copy diagnostics".
9. `docs:check` first version (version line + route list + tool count).
10. A "start here" block at the top of the wiki index pointing at Getting started,
    Common workflows and Troubleshooting.

### 7.5 Dependencies and sequencing

```
P0-2 docs/CI ──────────────────────────────► protects all later claims
P0-3 license ──────────────────────────────► before any public push
P0-1 search ──────────────► P1-8 backlinks (index reuse)
P0-5 due dates/Today ─────► P1-3 focus block ─► calendar due lens (P2)
                     └────► P1-1 habits (evidence) ─► P1-11 goal evidence
P1-6 history ─────────────► P1-7 export (both reuse content model)
P1-9 MCP reads ───────────► P1-10 tool reference (generated from defs)
P1-4 commitments phase 1 ─► phase 2 ─► phase 3 (calendar/close)
P1-13 sample vault ───────► P1-14 install-path E2E (same fixture)
```

### 7.6 How we will know it worked

- Time from install to first page: target under 5 minutes with the checklist; measure via
  the install-path E2E and a manual stopwatch.
- Search: used in the first session; median results-to-open under 5 s (local telemetry is
  not allowed, so test with the operator's own workflow and E2E).
- Day loop: tasks with due dates are completed from Today, not from the board.
- Reviews: the review wing shows due/up-to-date and previous intent is read at least once
  per review (manual check).
- Money: at least one commitment paid and undone correctly in a real vault, with the
  ledger entry reversed.
- Claims: zero docs-drift failures for two consecutive releases.
- AI: tool count reduced with no capability lost; a paired agent can still do a full
  read of every grant-scoped surface.

---

## 8. Do not build (and why)

These are not "never"; they are "not now, and not this shape". Each is tied to our own
product contract so the decision can be re-argued rather than re-litigated.

| Tempting feature | Why we refuse it now |
|---|---|
| **Productivity score, grade, delta, "strong days"** | `PRODUCT.md` anti-reference: "a dashboard stuffed with metrics", "a habit-tracker scoreboard". Their score is gameable and its baseline is not like-for-like. A signpost card is the honest substitute. |
| **Gauges / progress rings** | `LAWS/DATABASES.md` explicitly refuses gauge blocks; `VISION.md` refuses gauges on Home. |
| **Streaks on the Daily Schedule** | `VISION.md`: a habit tracker may show consecutive-day streaks on its own Execute page; streaks must not live on Daily Schedule. |
| **The iframe-per-workspace shell, parallel CSS, runtime CDN fonts** | Their architecture buys fast parallel workspaces and costs a design system. Our single React shell and token contract are better; adding a CDN would break the no-server ownership story. |
| **Multi-user, household accounts, cloud sync, hosted copy** | `VISION.md` and `LAWS/IDENTITY.md`: one operator per vault; a LifeQuest-hosted copy is refused. Their multi-account is a trust caveat, not a model to copy. |
| **A mobile app now** | `VISION.md` puts a phone client in future scope and defines it as queue-and-view, not a second studio. Do not spend the coherence budget. |
| **Full i18n / RTL now** | Not our market; their Persian-first moat is real but expensive to replicate. Do fix locale-neutral assumptions (base currency, date/number formatting) cheaply. |
| **An email inbox workspace** | Capture is not the studio; mail credentials belong in OS storage and agent skills, not in a vault app. If wanted, ship a Hermes skill that reads mail into capture. |
| **Sticky-note canvas** | A second note app with pan/zoom/connections. Our Images board and Pages cover visual thinking; the canvas would fork "where do notes live". |
| **Trello-depth Kanban** (custom fields, members, comments, labels, attachments on cards) | We are not a project management tool. Take priority, due date and (maybe) a checklist; leave the rest. |
| **Secret notes** | A visibility flag that reads like security. The honest answer is whole-vault encryption, which `VISION.md` already welcomes. |
| **Editing raw HTML notes** | Authoring HTML in a local app is an attack surface for little benefit; our Markdown plus sandboxed previews is the safer shape. |
| **A second "plan" object for long-term goals** | Their Growth plan exists because their goals are flat. We should add a horizon/parent to goals, not a parallel record type that needs its own screens, tools and reviews. |
| **Destructive Kanban→goal conversion** | Their "Move to goal" deletes the card and loses comments/activity. If we bridge tasks and goals, keep the source and a link; never delete to convert. |
| **An AI that writes without approval** | Decisions is the product's trust story. The only exceptions stay the named direct-write families (tasks/live day, capture, script block, new DB/rows). |
| **Feature-count marketing** | Their "10/11/12 workspaces" and "15 tools" drift is the cautionary tale. Count what the build generates, not what a badge says. |

---

## 9. Positioning and messaging implications

Their product is easy to describe in one line: *"Your habits, goals, focus, money and
projects in one self-hosted dashboard that your AI assistant can use too."* Ours is not,
yet. The benchmark exposes why: we have more structure and less surface, so the sentence
has to name the structure.

**Candidate one-liner**

> **LifeQuest is a local-first life studio: your vault, your doctrine, your days — with
> an agent that asks before it changes anything.**

**Three proof points** (each backed by a shipped mechanic)

1. **The vault is the database.** Your life is a folder you own: Markdown, JSON, SQLite.
   Copy it, back it up, put it in Git. No account, no server, no CDN. (Their product is
   self-hosted but still needs a PHP host, MySQL, Google Fonts and jsDelivr.)
2. **Nothing changes behind your back.** Agents read freely; writes that change meaning
   wait in Decisions. You can see the diff, approve or reject, and the vault records who
   wrote what. (Their approvals are client-side prompts with one static token.)
3. **A life has a shape, and the app keeps it.** Domains → doctrine → goals → projects →
   days → reviews. A review is a durable document with a period pack, not a modal. (Their
   reflection is a quarterly review over six fixed dimensions.)

**What it is not** (mirrors their honesty, keeps us coherent): not a hosted dashboard,
not a habit scoreboard, not a Notion/Obsidian clone, not a chatbot wrapper, not a
multi-user service.

**Demo story to record (20 s):** open a vault → capture a thought in Life-Chain → make it
a task → drop it on today's schedule → companion proposes a goal update → approve the
Decision → open the weekly review and see the day's note quoted in the pack. That single
arc shows capture, execution, governance and reflection — four things they cannot show
in one flow.

**Against LifeOS specifically:** do not punch down on their bugs. Contrast on model:
"self-hosted dashboard" vs "local-first studio"; "your server" vs "your folder"; "AI via
a token" vs "agents with grants and approvals"; "a score" vs "a record you can trust".
Their breadth is real; our depth and ownership are real. Compete on what a screenshot
cannot show.

---

## 10. Roadmap suggestion

**Horizon 0 — two weeks: truth and retrieval.** P0-1 search, P0-2 docs/CI, P0-3 license,
P0-4 front door, P0-5 due dates + Today. Nothing new is added to the life model; the app
becomes findable, explainable and honest, and the day gets a unit.

**Horizon 1 — this quarter: the three loops.**
- *Day loop:* due dates → Today card → habits (practice) → focus block → review evidence.
- *Money loop:* commitments phase 1 → base currency → pay/undo → Dashboard due card.
- *Growth loop:* goal depth (horizon/why/priority/evidence) → review carry-forward and due
  strip → version history → export.
Plus the agent stream (read consolidation + tool reference), onboarding (sample vault,
checklist, diagnostics) and CI gates.

**Horizon 2 — six months: depth where the data is.**
Commitments phases 2–3 and the Life Map due lens; monthly close and finance exports;
backlinks; optional full focus experience; finance import; a companion daily brief;
read-only local API only if an integration demands it. Re-evaluate i18n and phone only if
there is a market decision, not because a competitor has them.

**What success looks like in one year:** a vault that explains itself in one screen, a
day that starts from Today, a review that shows evidence without a score, money that knows
what is owed, and an agent whose every meaningful change is a decision the operator can
read. That is a different product from theirs — and a defensible one.

---

## Appendix A — LifeOS workspaces at a glance

| Workspace | What it does | Depth | Notable weakness |
|---|---|---|---|
| Overview | Score ring, 4 KPIs, 6 dimension cards, focus/habit charts, heatmap, insights, goals, workload, finance, weather, email | Very high (the product's home) | Score is gameable; dashboard is dense; weather/email are region-specific |
| Growth | 6 fixed dimensions, long-term plans linked to goals/habits, 8-step reviews with snapshot + share image | High (best idea) | No API/MCP; fixed taxonomy |
| Focus | Pomodoro, breaks, durations, session stats, soundtrack, time-of-day scene | High | Session history not browsable; no task link; tab must stay open |
| Finance | Persian monthly periods, expenses, income, budgets incl. unlimited, Excel import/export/print, charts, debts & credits with schedules/statuses/reconciliation | Very high (deepest domain) | Obligations invisible to AI; no multi-currency conversion; Excel needs CDN |
| Habittify | Daily check-in, categories, month grid, 7-day bars, monthly %, Jalali | High | No per-habit streak; no archive; colour/icon dead |
| Todo | 5 views, lists, subtasks, due dates, priorities, descriptions, search, sort, shortcuts, undo | High | Browser-local "today"; no API/MCP |
| Kanban | Boards/lists/cards, drag, labels, priority, dates, recurrence, reminders, checklists, comments, members, custom fields, attachments, all-projects, card→goal | Very high | Completion depends on column names; no touch fallback; no API for card depth |
| Calendar | Read-only projection of cards + finance dues; month/schedule, filters, search, overdue | Medium | No event creation; no life events |
| Goals | SMART wizard, draft persistence, categories, priorities, multiple measures, tasks, 3 progress sources, archive | High | No API/MCP for drafts; progress auto-derived |
| Notes | Sticky-note infinite canvas, connections, colours/fonts, zoom/pan, secret flag, voice | Medium-high | Isolated from everything else; no global search |
| Notepad | 1,000 markdown/HTML docs, sidebar, tabs, Write/Split/Preview, toolbar, fullscreen, autosave, export, RTL per block, transactional history | Very high | No images/attachments; history unbounded |
| Settings | Preferences (theme, currency, calendar, language), email/AI, accounts, about | Medium | Arabic offered but empty; admin caveats |

**Cross-cutting:** 18 MCP tools, `/api/v1` REST, 20 JSON docs/user, revision CAS,
multi-account (all admin), Persian/RTL, responsive but no PWA, browser notifications only,
no global search, no whole-app export.

## Appendix B — LifeOS API and MCP inventory

**HTTP `/api/v1`** (`docs/api.md`, `lib/api_router.php`)

- `GET /health`, `GET /dashboard`
- Goals: `GET/POST /goals`, `GET/PATCH/DELETE /goals/{id}`
- Tasks: `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/complete`
- Habits: `GET /habits`, `GET /habits/today`, `POST/DELETE /habits/{id}/complete`
- Finance: `GET /finance`, `GET/POST /finance/expenses`, `GET/POST /finance/incomes`
- Notes: `GET/POST /notes`, `GET/PATCH/DELETE /notes/{id}`
- Notepad: `GET/POST /notepad`, `GET/PATCH/DELETE /notepad/{id}`

Not exposed: Todo, Growth, obligations, Calendar, Focus, Email, boards/columns/labels/
comments/checklists/custom fields/attachments, accounts.

**MCP tools (18)** — one read tool plus 17 writes:

- `lifeos_query` (dashboard, goals, goal, tasks, task, habits, today_habits,
  finance_summary, expenses, incomes, notes, note, notepad_documents, notepad_document)
- Goals: `lifeos_create_goal`, `lifeos_update_goal`, `lifeos_delete_goal`
- Tasks: `lifeos_create_task`, `lifeos_update_task`, `lifeos_complete_task`,
  `lifeos_delete_task`
- Habits: `lifeos_complete_habit`, `lifeos_uncomplete_habit`
- Finance: `lifeos_log_expense`, `lifeos_set_income`
- Notes: `lifeos_create_note`, `lifeos_update_note`, `lifeos_delete_note`
- Notepad: `lifeos_create_notepad_document`, `lifeos_update_notepad_document`,
  `lifeos_delete_notepad_document`

Delivery: stdio only, `@edicodes/lifeos-mcp` v2.0.0 on npm and the MCP registry; strict
Zod schemas; destructive annotations; one static bearer token bound to `api_user_id`
(default 1); no scopes, per-user tokens or rate limiting.

## Appendix C — LifeQuest surface index (for mapping work)

| Surface | Route / home | Shipped depth | Relevant matrices |
|---|---|---|---|
| Dashboard pin board | `/home` | Cards per lens, drag/keyboard, locks, card→chat | BM-57, BM-22 |
| Domains | rail lens | 4 seeded, add/archive/delete | BM-01 |
| Doctrine | `/domain/.../premise` etc. | 4 docs, locks, propose-change, media | BM-02 |
| Goals | `/goals` | flat record, 1 measure, deadline, dashboard cards | BM-03–08 |
| Life Map | `/map` | year canvas + month grid, events, objectives | BM-11 |
| Architecture | `/architecture` | day types, default/real week, grid | BM-12 |
| Projects | `/projects` | attributes, context, collation, progress | BM-18 |
| Daily Schedule | `/daily` | template copy, clock, cascade, Act coupling | BM-14 |
| Act | `/act` | 6-column board, links, no due date/search | BM-14–17 |
| Life-Chain | `/chain` | text/picture/link, make task | BM-26 |
| Daily Note | `/note` | one per date, autosave, focus mode | BM-27 |
| Reviews | `/review/*` | 5 cadences, packs, snapshots, locks | BM-10, BM-60 |
| Data / databases | `/data` | SQLite, 7 column types, CSV ingest, adapters | BM-63–67 |
| Pages | `/pages` | 12 block kinds, script blocks, view refs | BM-31 |
| Documents | `/documents` | live markdown, locks, wiki links | BM-28 |
| Finance kit | `/data/financial` | 7 DBs, 6 pages, FX, receipts, books | BM-38–48 |
| Decisions | sheet | 16 target kinds, approve/reject/all, manual | BM-50 |
| Companion | chat dock | threads, models, context, questions | BM-52–55 |
| Personnel | `/personnel` | hires, connected agents, grants | BM-50 |
| Automations | `/automations` | scheduled agent jobs | BM-56 |
| Log | `/log` | append-only, actor | BM-62 |
| Settings | sheet | 11 tabs, security, updates | BM-73–75 |

## Appendix D — Reusable patterns ("steal sheet")

Fifteen small patterns worth copying in our idiom, independent of feature bets:

1. **One sentence of interpretation next to a number.** Their score copy turns a metric
   into meaning. Use it for goal pace and review summaries, never for a grade.
2. **Empty states as invitations.** "Begin with something small", "Nothing due today",
   "Your first review starts here" — one primitive, warm copy, a CTA.
3. **Toast with undo.** 6 seconds, inverse action, no modal. For deletes and clears.
4. **Previous next step at the top of a review.** Continuity without a new field.
5. **Review due / up to date strip.** Cadence roll (7/30/90) is easy; ours can be real
   calendar periods, which is better.
6. **Draft persistence in a long form.** Their goal wizard keeps a draft document; our
   goal form is short, but pages/documents could keep an unsaved draft.
7. **Stable occurrence identity for generated records.** `planId:sequence` prevents
   duplicates on refresh. Use it for commitments.
8. **Read-time derivation over cron.** Their dues are derived, not stored. For our
   commitments, prefer stored dues with idempotent generation.
9. **Atomic multi-record write + undo that respects later edits.** The obligations
   payment/undo logic is the model.
10. **One query tool with a type discriminator.** Cuts agent context and mis-selection.
11. **Destructive annotations on tools.** Mark deletes; let clients warn; still enforce
    server-side.
12. **A Docker/CI test that follows the README.** Tests the documented path, not a
    parallel path.
13. **Honest limit statements in docs.** "Not encryption", "no per-user tokens", "Arabic
    unfinished" builds trust; we should state Hermes requirement, local-only, unsigned
    installer just as plainly.
14. **Per-block text direction.** If we ever do i18n, Their Notepad implementation is the
    reference; no need to reinvent.
15. **A generated feature list.** Counts in badges/README should come from code, or not
    exist.

## Appendix E — Evidence, sources and drift findings

**Primary sources**

- LifeOS: `README.md`, `README.es.md`, `README.fa.md`, `docs/*.md` (api, accounts,
  deployment, development, email, financial-commitments, finance-periods, growth,
  languages, ownership, troubleshooting), `CONTRIBUTING.md`, `lib/*.php`,
  `public_html/{index.html,assets/*,*/}`, `mcp/{README.md,src/*}`, `tests/`,
  `.github/workflows/*`, `Dockerfile`, `docker-compose*.yml`, `config.example.php`,
  `.env.example`, git tags/history, GitHub API.
- LifeQuest: `README.md`, `VISION.md`, `PRODUCT.md`, `DESIGN.md`, `LAWS/*.md`,
  `docs/wiki/*.md` (35 pages), `packages/vault-core/src/*`, `apps/desktop/src/{pages,
  components,lib,state}`, `apps/desktop/electron/*`, `apps/desktop/e2e/*`,
  `docs/superpowers/specs/*` where needed.
- Repos: `https://github.com/edrisranjbar/lifeos` @ `25fe400`,
  `https://github.com/karmsheel/life-quest` @ `0599009`.

**Their claims vs their code (for our own discipline)**

- "Ten workspaces" (README) vs 11 apps + Settings; README table lists 12 including an
  Email row with no page; Persian README/site say eleven.
- "15 MCP tools" vs 18 registered; notepad tools added after the badge.
- Habittify "streaks" — no per-habit streak; Overview heatmap is completion density.
- Focus "session history" — data for charts, no browsable session list.
- "Dates follow Asia/Tehran" — Todo uses the browser-local day; Kanban reminders local.
- Arabic selectable in Settings with no `ar.json`.
- `docs/ownership.md` still claims a single-owner install after schema v3 multi-account.
- Node suite red at HEAD: 33/39 pass (money formatting, Persian coverage, missing Arabic
  dictionary).
- No PWA/service worker; no global search; no whole-app export; no notifications outside
  an open tab.

**Our own drift (fix in P0-2)**

- Wiki pinned at 0.2.0 while the app is 0.2.5 (Images page missing entirely; Settings 9 vs
  11 tabs; wing "Execute" vs "Act"; batch Approve all undocumented).
- `autoApproveInserts` allowlist documented as live but retired in 0.2.1; database inserts
  and new databases now apply directly.
- Decisions inbox documented as lens-filtered but global since 0.2.1.
- Update check documented as once per launch but polls hourly and notifies when unfocused.
- `README.md` describes Hermes base-URL/API-key/Test-connection fields that no longer
  exist; README says "Private / unpublished" on a public repo with no license.
- `VISION.md` describes future features (habits, calendar sync, phone, encryption, signed
  installer, overnight schedule prep) that do not ship yet — correct as vision, dangerous
  as a feature claim.

**Verification caveats**

- LifeOS was not booted; runtime claims are code/doc inference.
- LifeQuest's E2E suite was not re-run; existing artifacts were inspected (107 reports,
  100 passing) and code was read.
- Neither product's mobile/RTL rendering was tested on a device.
- GitHub counts drift; treat the numbers as a snapshot.

---

*This report is a decision tool, not a feature census. When a row and the code disagree
later, the code wins; update the row and the matrix with the change.*
