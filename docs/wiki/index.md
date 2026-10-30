# LifeQuest wiki

LifeQuest is a local-first life-management studio for the desktop. A **vault** is a
folder on your machine; opening it is your identity. Domains, doctrine, goals,
projects, the Life Map, Daily Notes, reviews, Decisions, your own databases and
pages all live in that folder as plain files, beside a **companion** (Hermes) that
sits in the chat pane and helps you keep the whole thing coherent.

This wiki explains the app and how to use it. It is written for the operator, not
the developer, though the system pages at the end go under the hood for anyone who
wants to know what is on disk and what runs where.

- **Version covered:** LifeQuest 0.2.0 (desktop, Windows).
- **Product host:** Electron + Vite + React. There is no cloud account and no
  hosted copy of your vault.
- **Companion:** required. The studio does not open without Hermes.
- **Source of truth:** the vault folder on disk.

## Start here

| If you want to… | Read |
|---|---|
| Understand what LifeQuest is and is not | [Overview](./01-overview.md) |
| Install it and open your first vault | [Getting started](./02-getting-started.md) |
| Learn the window, rail, wings and chat pane | [The studio](./03-the-studio.md) |
| Know exactly what lands on disk | [The vault](./04-the-vault.md) |
| Set up your life areas | [Domains](./05-domains.md) |
| Arrange the home board | [Dashboard](./06-dashboard.md) |

## All pages

### Foundations

| Page | What it covers |
|---|---|
| [01 · Overview](./01-overview.md) | The idea, the studio/companion split, local-first identity, scope |
| [02 · Getting started](./02-getting-started.md) | Prerequisites, Hermes, install, create/open a vault, first run |
| [03 · The studio](./03-the-studio.md) | Window chrome, rail, wings, lens, three panes, sheets, splash |
| [04 · The vault](./04-the-vault.md) | Vault layout, settings, recent vaults, moving, backup, git, restore |
| [05 · Domains](./05-domains.md) | Seeded domains, adding and archiving, the domain lens, Overview |

### Home

| Page | What it covers |
|---|---|
| [06 · Dashboard](./06-dashboard.md) | The pin board per lens: cards, arranging, resizing, locking, card context |

### Define

| Page | What it covers |
|---|---|
| [07 · Doctrine](./07-doctrine.md) | Dream and Vision: premise, vision, purpose, strategy; the editor, locks and proposals |
| [09 · Ideal State](./09-ideal-state.md) | Freeform titled documents for the future you are aiming at |

### Plan

| Page | What it covers |
|---|---|
| [08 · Architecture](./08-architecture.md) | Strategy (How) plus day types, the default week and the real week |
| [10 · Goals](./10-goals.md) | Goal records, metrics vs definitions of done, progress, deadline pressure |
| [11 · Life Map](./11-life-map.md) | The year canvas and month calendar: years, events, day text, month objectives |

### Execute

| Page | What it covers |
|---|---|
| [12 · Projects](./12-projects.md) | Projects list and project page, attributes, goal link, collated context |
| [13 · Daily Schedule](./13-daily-schedule.md) | Picking a day template, recording the actual day, placing and unplacing blocks |
| [14 · Act](./14-act.md) | The task board: columns, drag and keyboard, task editor, menu |

### Daily capture and review

| Page | What it covers |
|---|---|
| [15 · Life-Chain](./15-life-chain.md) | Quick-fire capture, unassigned vs domain, edit/delete, make a task |
| [16 · Daily Note](./16-daily-note.md) | One journal note per local date, saving, analysis, review pack |
| [17 · Automations](./17-automations.md) | One-click jobs that read a page and open a chat with the agent |
| [18 · Reviews](./18-reviews.md) | Daily through yearly cadences, period packs, companion sessions, done/lock, planning stubs |

### Data and knowledge

| Page | What it covers |
|---|---|
| [19 · Data and databases](./19-data-and-databases.md) | Databases, tables, rows, imports, adapters, conflicts, book export/restore |
| [20 · Finance kit](./20-finance-kit.md) | Installing the Finance kit, ledgers, FX, plan surfaces, receipt capture |
| [21 · Pages](./21-pages.md) | Operator-built pages, blocks, script blocks, wiki links, pins |
| [22 · Documents](./22-documents.md) | The library, markdown editing, locks, proposed changes, wiki links |

### Companion and governance

| Page | What it covers |
|---|---|
| [23 · Decisions](./23-decisions.md) | The approval inbox, pending/approved/rejected, manual decisions, auto-approve |
| [24 · Companion](./24-companion.md) | Hermes, chat, composer, models, threads, context, page context, questions |
| [25 · Personnel and agents](./25-personnel-and-agents.md) | Scanning Hermes, hiring agents, roles, MCP pairing, connected agents |
| [26 · Log](./26-log.md) | The Life log feed and what writes to it |
| [27 · Updates](./27-updates.md) | The version badge, release check, update dialog, preview flag |

### System

| Page | What it covers |
|---|---|
| [28 · Settings](./28-settings.md) | Every settings tab and the settings search |
| [29 · Security](./29-security.md) | Secrets, vault containment, update trust, MCP door auth |
| [30 · System architecture](./30-system-architecture.md) | Processes, IPC, vault-core, MCP, companion lifecycle, repo layout |
| [31 · Development](./31-development.md) | Scripts, dev loop, E2E rigs, build/package/release, typecheck |
| [32 · Troubleshooting](./32-troubleshooting.md) | Common failures and how to fix them |

### Reference

| Page | What it covers |
|---|---|
| [33 · Glossary](./33-glossary.md) | Every product term, defined once |
| [34 · Common workflows](./34-common-workflows.md) | End-to-end recipes for the things you will actually do |

## Conventions

- **Bold** marks a control, page or label exactly as it appears in the app.
- `code` marks a route, file, setting key or command.
- Every page ends with **Related** links; the rail path is always named in
  **Where it lives**.
- The wiki describes the app as it ships. Design documents under
  `docs/superpowers/` are linked only where the reasoning helps.
- The app's own invariants live in [`LAWS/`](../../LAWS/). Where a law is
  user-visible, the relevant page restates it in plain language.

## Keeping this wiki true

The wiki is versioned with the app. When a feature changes, change its page in
the same branch. If a page and the code disagree, the code is right — fix the
page.
