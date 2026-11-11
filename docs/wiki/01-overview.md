# Overview

LifeQuest is a local-first life-management studio for the desktop. It exists so
that one person can hold a whole life in one organising space, from the life they
want down to what they do today: doctrine, goals, projects, the timeline, daily
work, journals, reviews, and the operator's own tables, pages and pictures, all in
one folder on disk.

A new vault opens on one surface, **Life**, with five further areas
already on disk but locked — **Health**, **Mind**, **Finance**, **Business** and
**Relationships**. A first-run interview in the chat dock opens the one to three
areas the conversation actually heard. The built-in **Pi** companion runs the
studio without Hermes; Hermes remains an optional external sidekick. [The wiki
home](./index.md) has the full page index.

## Where it lives

- A **vault** is a folder you choose. Opening it is your identity — there is no
  account and no cloud. The app is the window onto that folder, and the folder is
  the database.
- The **studio** is the desktop app: one window made of three paper panes (the
  rail, the page and the chat dock) with the app's own title bar above them. See
  [The studio](./03-the-studio.md).
- The **companion** is the agent that works inside the studio. **Pi** is built
  into the app; **Hermes** is an optional external companion with its own profile
  and gateway.
- Settings and Decisions are **sheets** over the window, not pages in the rail.
- The packaged product is Windows. The source build runs on Windows, macOS and
  Linux through Node.

## What it is for

Most life apps put your life in their database. LifeQuest puts it in yours.

- A vault is an ordinary folder. You create one or open an existing one.
- Areas, doctrine, goals, projects, the Life Map, the Daily Journal, reviews,
  Decisions, databases, documents and pages are plain files inside it (Markdown,
  JSON, JSONL, and a SQLite file per area for tabular data).
- You can copy the folder, back it up, sync it, or keep it in a private Git
  remote. The app does not need a server to read it.
- API keys and tokens never enter the vault. They live in the operating system's
  secure storage, or in the companion's own profile.
- Removing the app does not remove your life; deleting the folder does.

This is the difference between a product that stores your data and a product that
opens your data. The app is replaceable; the vault is not.

The one surface is the point. A new operator is not asked to design a
taxonomy before living in it: they land on **Life**, and the five narrower areas
stay on disk, invisible, until the interview or the operator reveals them.

## How to use it

### Start with Life, then let the interview open areas

1. Create a vault and land on the Dashboard. The title bar's lens tab reads
   **Life**; the five seeded areas are locked and appear nowhere yet.
2. The chat dock offers the **Welcome to LifeQuest** card. **Begin the
   interview** sends your first turn; the companion asks four to six open
   questions, reflects back what it heard, and opens the one to three areas the
   conversation supports. The card then becomes a receipt with **Continue**.
3. Prefer to drive? Open **Settings → Areas** and press **Unlock** on any row
   under **Unlock another area**. Unlocking is a reveal, not an activation: the
   lens stays where it was, and the band becomes a segmented control once a
   second area is open.

The interview is optional in both directions — the welcome copy says you can
just start talking — and an existing vault never sees a first-run card. See
[Getting started](./02-getting-started.md) and [Areas](./05-areas.md).

### Organise the life

1. **Areas** are the life areas you are organising: **Life** always, plus
   whichever seeded or created areas are unlocked. You can create, rename,
   archive and delete areas.
2. **Doctrine** defines each area in four documents: **Beliefs & Premise**,
   **Vision & Desire**, **Purpose**, and **Strategy (How)**.
3. **Goals** turn the vision into records with a deadline and either a metric and
   target or a written definition of done.
4. **The Life Map** places events on a calendar of years, months and days;
   **Architecture** designs the day templates you want to live by.
5. **Projects** break goals into real work, and record what the idea is, where it
   came from, and any repositories it lives in.
6. **Daily Schedule**, **Task Manager** and **Quick Notes** turn the plan into a
   day: today's blocks, the task board, and a place to catch a thought, a picture
   or a link before it evaporates.
7. **Reviews** (Daily, Weekly, Monthly, Quarterly, Yearly) read the period back,
   with the operator's **Daily Journal** as the journal inside the pack.
8. **Data**, **Pages**, **Documents** and **Images** hold the operator's own
   tables, pages, writing and pictures, area by area.

### Let the companion work, with guardrails

The companion can read almost everything and can act, but the operator stays in
the loop through **Decisions**:

- **Reads** need no approval.
- **The operator writes directly.** There is no agent lock on your own work.
- **Agent writes that change a document** — doctrine, library documents,
  reviews, projects, goal records, Architecture templates, pages other than
  script blocks, pins, ingest mappings, posted ledger edits, kit installs — are
  filed as pending Decisions. You approve or reject them.
- **Some agent actions apply directly**, and the chat names what changed:
  completing and rearranging Daily Schedule tasks, logging a conversational
  capture when the amount and account are unambiguous, creating a database or
  inserting new rows after the chat confirmation, applying a page script block,
  and a connected agent's own `create_signal`.
- **Changing or removing existing data still waits.** A Decision gates updates,
  deletes, column changes, and schema edits.
- **Locks are real.** A locked document or Dashboard is read-only in place; an
  agent's change to a locked target waits in Decisions. Agents cannot lock or
  unlock anything. Approving a change to a locked page does not unlock it.
- **Locked areas are invisible.** No read, list or write reaches a locked area,
  and the companion cannot leak one before the interview or the operator opens
  it.

That last set is not bureaucracy. It is the line between a studio that keeps you
coherent and an agent that quietly rewrites your life.

## The screen

The rail's **wing band** switches the rail between five wings. A wing filters
navigation, not data: switching wings never changes what a page is showing, and
each wing remembers the last page you were on. The area lens — the tab centred in
the window title bar — is the data filter for area-scoped lists.

| Wing | Pages | The question it answers |
|---|---|---|
| **Home** | Dashboard, Data, Pages, Documents, Agents, Images | What is happening now, and what do I have? |
| **Define** | Dream, Vision, Ideal State | What do I believe, want and aim for? |
| **Plan** | Goals, Life Map, Architecture | What am I reaching for, by when, and in what shape? |
| **Act** | Projects, Daily Schedule, Task Manager | What am I actually doing? |
| **Review** | Daily, Weekly, Monthly, Quarterly, Yearly | What happened, and what changes? |

The wing whose id is `execute` reads **Act**; its routes and the companion's
question scopes stay `execute`, so saved links and prompts keep working.
**Personnel** is renamed **Agents**, the Act page is renamed **Task Manager**, and
**Images** moved from Define to Home (route `/images`).

**Quick Notes**, **Decisions**, **Daily Journal** and **Automations** are pinned
above the **Log** because they are governance, not a wing: they belong to no area
and are reachable from everywhere. The version badge lives in the chat dock's
bottom bar, not at the foot of the rail.

The chat dock holds the companion. Its strip carries the open chats as tabs,
pinned chats as squares, and a **+** for a new tab; a vertical agent switcher
names which companion answers; the bottom bar leads with **New chat**, **Quick
Notes**, the **Keyboard shortcuts** reference, the side switch, **Collapse chat**
and the version badge. See [Companion](./24-companion.md).

## Rules and behaviour

- Opening a vault is identity. No account, sign-in or hosted database is required
  ([LAWS/IDENTITY.md](../../LAWS/IDENTITY.md)).
- The studio does not open without a companion
  ([LAWS/COMPANION.md](../../LAWS/COMPANION.md)). Pi is built in, so a fresh
  machine has a companion without installing anything; Hermes is an optional
  external one.
- Wings filter the rail, never a page's data ([LAWS/WINGS.md](../../LAWS/WINGS.md)).
- The area lens is the data filter for area-scoped lists
  ([LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md)). **Life** is the union
  lens; the base `life` area is where records with no narrower home land.
- A locked area is absent from every read, list and write. An absent `unlockedAt`
  field means unlocked, so a vault written before the lock state keeps every area
  it ever had.
- API keys never enter the vault ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).
  Pi's key is sealed by the OS in app user data; Hermes' key belongs to its
  profile.
- Agent writes that change what the vault already holds go through
  [Decisions](./23-decisions.md). Direct applies are named in the chat.
- The app works offline against the files on disk. Features that need the
  companion say so; nothing silently writes your data to a server.

## Tips and edge cases

- A vault from 0.2.7 or earlier keeps its areas exactly as they were: the lock
  state is additive, and an area with no `unlockedAt` field reads as unlocked.
  Such a vault has no onboarding file either, so it is never shown a first-run
  card.
- The interview opens at most three areas. A first session that opened all five
  would be a taxonomy delivery in disguise, so the engine refuses that proposal.
- Unlocking an area does not switch the lens. After a second area opens, choose
  it in the title bar's lens tab.
- Pi's transcripts live in app user data, never in the vault. Switching companions
  changes the set of chats you see, because a chat belongs to the companion that
  made it.
- Images is a Home-wing library at `/images`; the vision board itself is a
  document on **Vision**, not on Images. See [Doctrine](./07-doctrine.md).
- Hermes remains a first-class companion on a machine that already has it
  working; you can switch at any time from the dock or from Settings → Hermes.

## What LifeQuest is not

- Not a SaaS, a hosted web app, or a multi-user product. One operator per vault,
  no shared areas, no household accounts.
- Not an Obsidian clone, a Notion clone, or a generic note app. The vault layout
  is LifeQuest's contract, not a foreign workspace importer.
- Not a chatbot wrapper with files attached. The studio is the product; the
  companion is a partner inside it.
- Not a habit-tracker scoreboard, a metrics terminal, or a game HUD. Deadline
  pressure is deliberate; gamification is not.
- Not a bank-login screen or a hosted financial feed. The live ledger stays in
  the vault.
- Not a second work vault. There is one organising space for one life.
- Not a sequential unlock quest. Every wing is reachable from the start, and the
  locked areas are a quiet reveal offered by the interview — not a progression
  gate on features. You can unlock every area yourself in Settings.

## Reading this wiki

- New to the app? Start with [Getting started](./02-getting-started.md).
- Want the window explained? Read [The studio](./03-the-studio.md).
- Want to know what lands on disk? Read [The vault](./04-the-vault.md).
- Want to know how Life and the areas work? Read [Areas](./05-areas.md).
- Looking for a task, not a feature? See
  [Common workflows](./34-common-workflows.md).
- Stuck? See [Troubleshooting](./32-troubleshooting.md).

## Related

- [Wiki home](./index.md)
- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Companion](./24-companion.md)
- [Glossary](./33-glossary.md)
