# LifeQuest wiki

LifeQuest is a local-first life-management studio for the desktop. A **vault** is a
folder on your machine; opening it is your identity. Areas, doctrine, goals,
projects, the Life Map, the Daily Journal, reviews, Decisions, your own databases,
pages and images all live in that folder as plain files, beside a **companion**
that sits in the chat pane and helps you keep the whole thing coherent.

This wiki explains the app and how to use it. It is written for the operator, not
the developer, though the system pages at the end go under the hood for anyone who
wants to know what is on disk and what runs where.

- **Version covered:** LifeQuest 0.2.9 (desktop, Windows).
- **Product host:** Electron + Vite + React. There is no cloud account and no
  hosted copy of your vault.
- **Companion:** the built-in **Pi** companion opens the studio on its own;
  **Hermes** is an optional external companion you can switch to.
- **Source of truth:** the vault folder on disk.

## Start here

| If you want to… | Read |
|---|---|
| Understand what LifeQuest is and is not | [Overview](./01-overview.md) |
| Install it and open your first vault | [Getting started](./02-getting-started.md) |
| Learn the window, rail, wings and chat pane | [The studio](./03-the-studio.md) |
| Know exactly what lands on disk | [The vault](./04-the-vault.md) |
| Open your first life areas | [Areas](./05-areas.md) |
| Arrange the home board | [Dashboard](./06-dashboard.md) |

## All pages

### Foundations

| Page | What it covers |
|---|---|
| [01 · Overview](./01-overview.md) | The idea, the studio/companion split, Life and areas, local-first identity, scope |
| [02 · Getting started](./02-getting-started.md) | Pi or Hermes, install, create/open a vault, the first-run interview |
| [03 · The studio](./03-the-studio.md) | Window chrome, rail, wings, area lens, three panes, sheets, splash |
| [04 · The vault](./04-the-vault.md) | Vault layout, settings, recent vaults, moving, backup, git, restore |
| [05 · Areas](./05-areas.md) | Life and the five seed areas, locking, unlocking, the area lens |

### Home

| Page | What it covers |
|---|---|
| [06 · Dashboard](./06-dashboard.md) | The pin board per area: companion brief, cards, arranging, locking, card context |
| [19 · Data and databases](./19-data-and-databases.md) | Databases, tables, rows, imports, adapters, conflicts, book export/restore |
| [20 · Finance kit](./20-finance-kit.md) | Installing the Finance kit, ledgers, FX, plan surfaces, receipt capture |
| [21 · Pages](./21-pages.md) | Operator-built pages, blocks, script blocks, wiki links, pins |
| [22 · Documents](./22-documents.md) | The library, markdown editing, locks, proposed changes, wiki links |
| [25 · Agents](./25-agents.md) | The roster, hiring, area-scoped agents, MCP pairing, connected agents |
| [35 · Images](./35-images.md) | The vault picture library, and the vision board it feeds |

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

### Act

| Page | What it covers |
|---|---|
| [12 · Projects](./12-projects.md) | Projects list and project page, attributes, repositories, goal link, collated context |
| [13 · Daily Schedule](./13-daily-schedule.md) | Picking a day template, recording the actual day, placing and unplacing blocks |
| [14 · Task Manager](./14-task-manager.md) | The task board: six columns, drag and keyboard, agent-added cards, send to agent |

### Review

| Page | What it covers |
|---|---|
| [18 · Reviews](./18-reviews.md) | Daily through yearly cadences, period packs, companion sessions, done/lock, planning stubs |

### Shelf

| Page | What it covers |
|---|---|
| [15 · Quick Notes](./15-quick-notes.md) | Quick-fire capture of text, pictures and links; edit/delete, make a task |
| [16 · Daily Journal](./16-daily-journal.md) | One journal note per local date, the day's acts, calendar, focus mode |
| [17 · Automations](./17-automations.md) | One-click jobs that read a page and open a chat with the agent |
| [23 · Decisions](./23-decisions.md) | The approval inbox, approve all, manual decisions, the Decision editor |
| [26 · Log](./26-log.md) | The Life log feed and what writes to it |

### Companion

| Page | What it covers |
|---|---|
| [24 · Companion](./24-companion.md) | Pi and Hermes, chat tabs, composer, attachments, context, questions |

### System

| Page | What it covers |
|---|---|
| [27 · Updates](./27-updates.md) | The version badge, hourly release watch, update notice and dialog |
| [28 · Settings](./28-settings.md) | All eleven settings tabs and the settings search |
| [29 · Security](./29-security.md) | Secrets, vault containment, update trust, MCP door auth |
| [30 · System architecture](./30-system-architecture.md) | Processes, harness seam, IPC, vault-core, MCP, repo layout |
| [31 · Development](./31-development.md) | Scripts, dev loop, E2E rigs, build/package/release, docs gate |
| [32 · Troubleshooting](./32-troubleshooting.md) | Common failures and how to fix them |

### Reference

| Page | What it covers |
|---|---|
| [33 · Glossary](./33-glossary.md) | Every product term, defined once |
| [34 · Common workflows](./34-common-workflows.md) | End-to-end recipes for the things you will actually do |
| [36 · Keyboard shortcuts](./36-keyboard-shortcuts.md) | The movements, their defaults, and how to rebind them |
| [Releases](https://karmsheel.github.io/life-quest/releases/) | Every published release, generated from the GitHub Releases feed |

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

The wiki is versioned with the app and gated by `npm run docs:check`: it compares
the version line, routes, rail labels, Settings tabs, links and navigation against
the code. CI runs it on every pull request and weekly, and `npm run release` will
not build a stale wiki. If a page and the code disagree, the code is right — fix
the page.

Every published release also appears on the site's **Releases** page, which is
generated from the GitHub Releases feed when the site is built, so the release
history stays current even between wiki edits.
