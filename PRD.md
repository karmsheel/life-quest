# Product requirements: LifeQuest

Last verified: 2026-11-27 · LifeQuest 0.3.4

LifeQuest is a local-first life-management studio for the desktop: one folder on your machine
holds the life — doctrine, goals, projects, timeline, daily work, your own databases and pages —
and a companion sits in the chat pane to keep it coherent.

This file says **what the product is, who it is for, and which requirements a change must
keep**. It is the first of six planning documents (`PRD`, [`ARCHITECTURE`](ARCHITECTURE.md),
[`DESIGN`](DESIGN.md), [`RULES`](RULES.md), [`TASKS`](TASKS.md), [`PROGRESS`](PROGRESS.md)).
For depth it points at [`VISION.md`](VISION.md) (the acceptance policy), [`LAWS/`](LAWS/README.md)
(observable invariants, RFC 2119) and [`docs/wiki/`](docs/wiki/index.md) (how the shipped
product behaves). If this file and a law disagree, the law wins.

## The product

One person's whole life in one organizing space, from the life they want down to what they do
today. Opening a vault is identity: no account, no hosted database, no LifeQuest copy of the
vault. The desktop studio is the daily surface; capture is not the studio; the companion is
required for the studio and is not the product.

## Who it is for

- **The operator** — one person per vault, working on a Windows desktop, who wants their
  vision, goals, projects, days and private numbers in files they own.
- **Other operators** — anyone who downloads a published Windows build and runs their own
  local vault. The repo may be public; vaults stay on each operator's disk.
- **Not** — a team, a household, a SaaS tenant, or a second "work" persona. There is no
  multi-user tenancy and no shared domain.

## Brand

**Personality:** focused, capable, companionable. Calm enough for daily use; not cryptic; not a
toy.

**Anti-references:** do not make LifeQuest feel like a generic chatbot wrapper, a dark terminal
skin, a dashboard stuffed with metrics, a marketing site wearing product chrome, a habit-tracker
scoreboard, or a game HUD. Live goal progress on Home is not a scoreboard. Avoid novelty-first
AI visuals, oversized decorative cards, and vague assistant-magic copy.

**Design principles:**

1. Make context legible — domain, wing, room and vault should be obvious.
2. Keep the work surface quiet. Chrome is useful, dense and calm, except for the deadline
   pressure the timeline is asked to apply.
3. Treat settings, skins and the companion as part of the workflow, not admin leftovers.
4. Show operational truth plainly: connection failures, empty vaults, companion not ready,
   stale files.
5. Design for continuity: the vault on disk is the source of truth.

How those principles become tokens, components and motion is [`DESIGN.md`](DESIGN.md).

## Jobs to be done

1. Decide what the life is for (doctrine), then turn it into goals, projects, and today.
2. See the year and the month without leaving the studio; let deadlines apply pressure.
3. Run the day: daily schedule, task board, reviews, journal.
4. Keep private numbers and lists in tables the operator owns, beside the prose.
5. Ask a companion that already sees the page, and approve its changes instead of policing it.
6. Restore the whole thing from a folder copy or a git remote, offline.

## Requirements

Each requirement is testable and names what makes it binding.

### Identity and the vault

- **P1 — Opening a vault is identity.** No account, sign-up, or hosted database is required to
  use a vault. ([`LAWS/IDENTITY.md`](LAWS/IDENTITY.md))
- **P2 — The vault is the life database.** Doctrine, goals, projects, map, library, capture,
  decisions, log, domain databases and pages live in the vault folder as prescribed files; a
  domain's rows live in a SQLite file inside that domain folder. There is no LifeQuest-hosted
  replica. ([`VISION.md`](VISION.md) "Vault is identity", [`LAWS/DATABASES.md`](LAWS/DATABASES.md))
- **P3 — Secrets never enter the vault.** API keys, calendar tokens and sheet tokens live in
  OS secure storage; chat transcripts stay with the companion. ([`LAWS/SECRETS.md`](LAWS/SECRETS.md))

### The life model

- **P4 — Four doctrine sections per domain, locked when final.** Agent changes to a locked
  document appear as a pending Decision; agents never lock or unlock. ([`LAWS/DOCTRINE.md`](LAWS/DOCTRINE.md))
- **P5 — Goals, projects and tasks form one chain.** A goal is a vault record with a name, and
  may carry a domain, a deadline and either a metric and target or a written definition of done;
  a project is a vault document that may be linked to a goal; a task may be completed by the
  operator or handed to an agent.
- **P6 — Reviews are the cadence.** Daily through yearly, assembled from vault files; a daily
  note is one markdown file per local date, written only by the operator.
  ([`LAWS/REVIEWS.md`](LAWS/REVIEWS.md), [`LAWS/NOTES.md`](LAWS/NOTES.md))
- **P7 — Recurring tasks are standing records.** Title, cadence, next due date; never cards on
  the Task Manager board; due rows derive from the date and the local day.
  ([`LAWS/RECURRING.md`](LAWS/RECURRING.md))

### The studio

- **P8 — Three paper panes.** Rail, main and chat; wings filter the rail, not page data; the
  domain switcher is the data filter for domain-scoped lists.
  ([`LAWS/WINGS.md`](LAWS/WINGS.md), [`LAWS/DOMAIN-FILTER.md`](LAWS/DOMAIN-FILTER.md))
- **P9 — Home is a pin board per lens.** It carries the same page lock as any page; the
  companion brief is written only by the companion; at most three cards ride in chat context.
  ([`LAWS/DASHBOARD.md`](LAWS/DASHBOARD.md))
- **P10 — Data and pages are operator-owned.** Domain databases and pages live in the vault;
  kits (Finance first) are optional schema installed through a Decision.
  ([`LAWS/DATABASES.md`](LAWS/DATABASES.md))

### The companion

- **P11 — The studio does not open without the companion.** The built-in companion is Pi; Hermes
  is an optional external sidekick. The renderer never holds a raw key.
  ([`LAWS/COMPANION.md`](LAWS/COMPANION.md))
- **P12 — Agents act through the same door and the same rules.** An agent may advise or own a
  domain; agent writes to doctrine, library, reviews, projects, goal records, Architecture
  templates, pages other than script blocks, pins, ingest mappings, posted ledger edits and kit
  installs go through Decisions; conversational capture posts only when amount and account are unambiguous and the
  chat names what was written. ([`VISION.md`](VISION.md) "Doctrine, goals, and the day")

### Shipping and trust

- **P13 — Windows is the product surface.** An NSIS installer plus a portable zip (the
  build is unsigned today; code signing is planned); the app checks for releases and never
  installs without asking; using it needs no Node.
  ([`README.md`](README.md) "Build and ship")
- **P14 — The wiki is part of the product.** A user-visible change updates its wiki page in the
  same branch; `npm run docs:check` is the gate, and a release refuses to build over a stale
  wiki. ([`AGENTS.md`](AGENTS.md))

## Out of scope

Not a SaaS, not a hosted web app, not an Obsidian clone, not a Notion clone, not a household
calendar or shared budget, not an embedded bank-login product, not a second work vault, not a
Hermes GUI that happens to have files. No multi-user tenancy. No other desktop OS as the
product. The phone client queues drafts and shows pinned metrics; it is not the studio. The
archived Next.js + Prisma tree is not a runtime.

## Constraints

- **Stack:** Electron + Vite + React + TypeScript. No Next.js or Prisma at runtime; the
  archived web skeleton stays frozen under `archive/web-skeleton/`.
- **Local-first:** works offline; linked databases queue writes in the vault and prompt on
  conflict.
- **Vault schema:** versioned (`SCHEMA_VERSION = 1`). A vault whose schema version is not the
  current one is refused, never silently migrated.
- **Testing:** E2E is the testing mechanism, and every passing run leaves a reproducible
  artifact. No unit tests written after the code.
- **Privacy:** no account, no hosted copy of the vault, no telemetry of vault content.

## Success signals

Observable proxies, not KPIs — the product exists for one operator and is dogfooded daily.

- A new operator installs a published build, creates a vault, and finishes a first day
  without leaving the studio.
- A vault copied to another machine opens intact — files, locks, decisions and SQLite books.
- A feature is done only when its rig produced a report artifact and the picture shows the
  shipped screen.
- `npm run typecheck` and `npm run docs:check` pass on master, and a release never ships over a
  stale wiki.
- The update check never claims "up to date" without reading the feed, and never offers a
  version that is not strictly newer.

## How a change is accepted

A change aligns when it deepens the vault's hold on vision, goals, projects, timeline, daily
doing or operator-owned data, keeps the companion in the studio loop, routes document and
kit-install writes through Decisions, names conversational capture in chat, and keeps the live
ledger inside the vault folder. [`VISION.md`](VISION.md) ends with the inverse list — the
changes to resist — and [`LAWS/README.md`](LAWS/README.md) defines how laws are written.

## Where the detail lives

| Question | Read |
|---|---|
| Is this change in the product's spirit? | [`VISION.md`](VISION.md) |
| What must never happen? | [`LAWS/`](LAWS/README.md) |
| How does the shipped feature behave? | [`docs/wiki/`](docs/wiki/index.md) |
| How is the system built? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| How does it look and feel? | [`DESIGN.md`](DESIGN.md) |
| What may I write, and how? | [`RULES.md`](RULES.md) |
| What is being built next? | [`TASKS.md`](TASKS.md) — and what happened, [`PROGRESS.md`](PROGRESS.md) |
