# Overview

LifeQuest is a local-first life-management studio for the desktop. It exists so
that one person can hold a whole life in one organizing space, from the life they
want down to what they do today: doctrine, goals, projects, the timeline, daily
work, journals, reviews, and the operator's own tables and pages, all in one
folder on disk.

There is no account and no cloud. A **vault** is a folder you choose; opening it
is your identity. The app is the window onto that folder, and the folder is the
database.

## The one idea: the vault is identity

Most life apps put your life in their database. LifeQuest puts it in yours.

- A vault is an ordinary folder. You create one or open an existing one.
- Domains, doctrine, goals, projects, the Life Map, Daily Notes, reviews,
  Decisions, databases and pages are plain files inside it (Markdown, JSON,
  JSONL, and a SQLite file per domain for tabular data).
- You can copy the folder, back it up, sync it, or keep it in a private Git
  remote. The app does not need a server to read it.
- API keys and tokens never enter the vault. They live in the operating system's
  secure storage.
- Removing the app does not remove your life; deleting the folder does.

This is the difference between a product that stores your data and a product
that opens your data. The app is replaceable; the vault is not.

## The studio and the companion

LifeQuest is two things working together, and the split is deliberate:

| Part | What it owns |
|---|---|
| **The studio** (the desktop app) | The vault, the files, the MCP door, and every screen you see |
| **The companion** (Hermes) | The agent loop, memory, skills, model access and chat transcripts |

The studio **does not open without the companion**. On launch it looks for the
Hermes CLI and the `lifequest` profile, starts the gateway if it is not running,
and shows a setup screen if it cannot. Hermes is not bundled with LifeQuest, and
the app does not kill a gateway it did not start.

This is why the app is not a chatbot wrapper and the chatbot is not the app. The
companion is a working partner inside a studio that remains useful, legible and
yours. Capture is not the studio; the vault is the point.

## How a life is organised

LifeQuest has a shape, and the shape is the product:

1. **Domains** are the life areas you are organising. A new vault seeds four:
   Health, Intellectual, Emotional and Financial. You can add, rename, archive
   and delete them.
2. **Doctrine** defines each domain in four documents: **Beliefs & Premise**,
   **Vision & Desire**, **Purpose**, and **Strategy (How)**.
3. **Goals** turn the vision into records with a deadline and either a metric and
   target or a written definition of done.
4. **The Life Map** places events on a calendar of years, months and days; a goal
   carries a deadline that surfaces on the Dashboard. **Architecture** designs
   the day templates you want to live by.
5. **Projects** break goals into real work, with attributes, context and
   companion tools.
6. **Daily Schedule**, **Act** and **Life-Chain** turn the plan into a day:
   today's blocks, the task board, and a place to catch a thought before it
   evaporates.
7. **Reviews** (Daily, Weekly, Monthly, Quarterly, Yearly) read the period back,
   with the operator's **Daily Notes** as the journal inside the pack.
8. **Data**, **Pages** and **Documents** hold the operator's own tables, pages
   and writing, domain by domain.

The **Home** wing holds the Dashboard pin board for each lens, plus Data, Pages,
Documents and Personnel. **Decisions**, **Daily Note** and **Automations** sit on
the governance shelf, with the **Log** closing the rail.

## The five wings

The top bar switches the rail between five wings. A wing filters navigation, not
data: switching wings never changes what a page is showing, and each wing
remembers the last page you were on. The domain lens in the top bar is the data
filter for domain-scoped lists.

| Wing | Pages | The question it answers |
|---|---|---|
| **Home** | Dashboard, Data, Pages, Documents, Personnel | What is happening now, and what do I have? |
| **Define** | Dream, Vision, Ideal State | What do I believe, want and aim for? |
| **Plan** | Goals, Life Map, Architecture | What am I reaching for, by when, and in what shape? |
| **Execute** | Projects, Daily Schedule, Act | What am I actually doing? |
| **Review** | Daily, Weekly, Monthly, Quarterly, Yearly | What happened, and what changes? |

**Life-Chain**, **Decisions**, **Daily Note** and **Automations** are pinned above
the Log because they are governance, not a wing: they belong to no domain and
are reachable from everywhere. **Settings** is a sheet over the app, as are
Decisions; closing either returns you to the page you were on.

## The companion is in the loop, with guardrails

The companion can read almost everything and can act, but the operator stays in
the loop through **Decisions**:

- **Reads** need no approval.
- **The operator writes directly.** There is no agent lock on your own work.
- **Agent writes that change a document** — doctrine, library documents,
  reviews, projects, goal records, Architecture templates, pages other than
  script blocks, pins, ingest mappings, posted ledger edits, kit installs — are
  filed as pending Decisions. You approve or reject them.
- **A few agent actions apply directly**, and the chat names what changed:
  completing and rearranging Daily Schedule tasks, logging a conversational
  capture when the amount and account are unambiguous, and applying a page
  script block.
- **Locks are real.** A locked document or Dashboard is read-only in place; an
  agent's change to a locked target waits in Decisions. Agents cannot lock or
  unlock anything. Approving a change to a locked page does not unlock it.

That last set is not bureaucracy. It is the line between a studio that keeps you
coherent and an agent that quietly rewrites your life.

## What LifeQuest is not

- Not a SaaS, a hosted web app, or a multi-user product. One operator per vault,
  no shared domains, no household accounts.
- Not an Obsidian clone, a Notion clone, or a generic note app. The vault layout
  is LifeQuest's contract, not a foreign workspace importer.
- Not a chatbot wrapper with files attached. The studio is the product; the
  companion is required infrastructure and a partner.
- Not a habit-tracker scoreboard, a metrics terminal, or a game HUD. Deadline
  pressure is deliberate; gamification is not.
- Not a bank-login screen or a hosted financial feed. The live ledger stays in
  the vault.
- Not a second work vault. There is one organising space for one life.
- Not a sequential unlock quest. Every wing is reachable from the start; the app
  does not gate features behind progress.

## Reading this wiki

- New to the app? Start with [Getting started](./02-getting-started.md).
- Want the window explained? Read [The studio](./03-the-studio.md).
- Want to know what lands on disk? Read [The vault](./04-the-vault.md).
- Looking for a task, not a feature? See
  [Common workflows](./34-common-workflows.md).
- Stuck? See [Troubleshooting](./32-troubleshooting.md).

## Related

- [Wiki home](./index.md)
- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Common workflows](./34-common-workflows.md)
- [Glossary](./33-glossary.md)
