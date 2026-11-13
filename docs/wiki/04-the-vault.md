# The vault

A vault is a folder on your computer that holds your life as plain files: doctrine, goals,
projects, the Life Map, journals, reviews, decisions, your own pages and documents, your
pictures and chat attachments, and one SQLite file per area for tabular data. Opening a
vault is how you identify yourself to LifeQuest — there is no account and no hosted copy.
The folder is the database. [The wiki home](./index.md) has the full page index.

## Where it lives

You choose the folder whenever you create or open a vault. LifeQuest has no default vault
location and never creates one on its own:

- **Create vault** on the welcome screen opens a folder picker and seeds the chosen folder.
- **Open vault** on the welcome screen opens a folder picker for an existing vault.
- **Recent vaults** on the welcome screen reopens a path the app already knows.
- The vault chip at the foot of the rail names the open vault and raises a **Switch vault**
  dialog: the recent vaults (the open one marked **Open now** and not re-openable) and
  **Open another folder…** for a folder this computer has never seen.
- **Settings → Vault** shows the open vault's **Name**, **Id** and **Path**, and its **Vault
  folder** row offers **Change folder…** to open another vault in place.

The marker that makes a folder a vault is `lifequest.json` at its root. Nothing else is
required to identify it.

## What it is for

The vault exists so that your life outlives the app. Anything in it can be read with a text
editor, copied with a file manager, versioned with Git, or moved to another machine. Opening
a vault is identity ([LAWS/IDENTITY.md](../../LAWS/IDENTITY.md)): the operator is the person
holding the folder, and the product must not require an account to use it. One operator owns
one vault; there is no multi-user tenancy and no shared area.

A new vault seeds six area folders on disk. **Life** is the base area, always unlocked and
never shown as a chip; the other five — Health, Mind, Finance, Business and Relationships —
are written with their doctrine but stay locked until you open them, from Settings → Areas
or through the first-run interview. See [Areas](./05-areas.md).

## The folder at a glance

```
<vault>/
  lifequest.json
  .lifequest/
  domains/<slug>/
  documents/
  projects/
  images/
  attachments/
  reviews/<cadence>/<period>.md
  planning/<cadence>/<period>.md
  notes/daily/<YYYY-MM-DD>.md
  notes/ideal-state/<id>.md
```

Beside `lifequest.json` and `.lifequest/`, the root holds the feature directories:
`domains/`, `documents/`, `projects/`, `images/`, `attachments/`, `reviews/`, `planning/`
and `notes/`. Everything an operator reads or writes is inside one of those directories or
`.lifequest/`, organized by feature.

### `lifequest.json`

The vault's identity card. It carries `schemaVersion` (currently `1`), a generated `id`, the
vault `name` (a new vault is named `Personal`), and `createdAt`. A vault whose
`schemaVersion` is not `1` is refused rather than half-read.

### `.lifequest/`

| Path | What it holds |
|---|---|
| `.lifequest/settings.json` | Vault settings: `weekStartDay`, `chatQuestions`, the two `decisionInbox` switches and `agentScopes`, plus `hermesBaseUrl` and `theme` keys the current UI does not edit. The old `autoApproveInserts` key is kept as a legacy key and read by nothing |
| `.lifequest/agents.json` | The Agents roster (`{ "hires": [] }` in a new vault) |
| `.lifequest/connected-agents.json` | The connected-agent roster. No secrets live here |
| `.lifequest/log.jsonl` | The Life log, one JSON record per line |
| `.lifequest/decisions/<id>.json` | Pending and decided proposals — the Decisions inbox |
| `.lifequest/manual-decisions/<id>.json` | Decisions the operator records by hand, kept apart from the approval path |
| `.lifequest/signal-chain/<id>.json` | Quick Notes captures, one JSON signal per file |
| `.lifequest/signal-chain/files/<uuid>.<ext>` | Pictures attached to Quick Notes captures (PNG, JPEG, GIF or WebP, up to 8 MB each) |
| `.lifequest/map.json` | The Life Map: years, months, events, tasks and recorded days |
| `.lifequest/goals.json` | Goal records |
| `.lifequest/automations.json` | The Automation shelf |
| `.lifequest/about.md` | The **About me** text agents receive as lifestyle context |
| `.lifequest/overview-pins.json` | The Life board's pins and lock |
| `.lifequest/companion-brief.json` | The companion brief: one record for the whole studio, rewritten wholesale on every write, with the dismissal log beside the active items |
| `.lifequest/onboarding.json` | The first-run interview's record. A new vault writes it as `not_started`; a vault with no file reads as `completed`, so an existing vault is never shown a first-run card |
| `.lifequest/onboarding-proposal.json` | The interview's proposal and then its receipt: what the companion opened, kept until you press **Continue** on the announcement card |
| `.lifequest/reviews/<cadence>.md` | A cadence's standing review rules, read before a review session |
| `.lifequest/cache/` | App cache |

The two onboarding files are the interview's whole memory. Reading never creates either
file, and a missing or corrupt `onboarding.json` reads as `completed` — the rule that keeps
an existing vault out of the first-run card — rather than failing the vault open.

### `domains/<slug>/`

Each area — the base **Life** area and every area you open — owns one directory, named by
its slug (`life`, `health`, `mind`, `financial`, `business`, `relationships`, and any you
add):

| Path | What it holds |
|---|---|
| `domain.json` | Name, description, colour, sort order, `unlockedAt`, `archivedAt`, timestamps |
| `premise.md` | Doctrine: **Beliefs & Premise** |
| `what.md` | Doctrine: **Vision & Desire** |
| `why.md` | Doctrine: **Purpose** |
| `how.md` | Doctrine: **Strategy (How)** |
| `media/` | Images attached to the area's doctrine documents |
| `data/domain.sqlite` | The area's database book — tables, columns and rows |
| `data/registry.json` | The database registry for the area |
| `data/books.json` | The JSON export of the area's tables (created by **Export books**) |
| `data/files/<fileId>/<name>` | Files attached to database rows, including receipt images |
| `data/mappings/` | Ingest mappings, one JSON file each |
| `data/sync-index.json` | Adapter sync state |
| `data/sync-queue.json` | Writes queued while a linked source is unreachable |
| `data/conflicts.json` | Conflicts waiting for the operator to resolve |
| `pages/<pageId>.json` | The area's pages, one JSON file each |
| `pins.json` | The area board's pins and lock |
| `views/<viewId>.json` | Saved views and the cards they draw |

**Locked areas are on disk but not in the app.** A locked area is one whose `domain.json`
has `unlockedAt: null`; an absent field still means unlocked, so a vault written before
areas had a lock state keeps every area it ever had. A locked area's folder holds its
identity and four doctrine documents like any other, but the folder is invisible to every
read and list in the app — no databases, pages, boards or doctrine — and the companion
cannot name it. Locking a seeded area writes no log line, because the Log is
operator-visible; unlocking it appends `area.unlocked` (stored as `domain.unlocked`) and
reveals the whole folder at once. The five seeded areas arrive locked in a new vault; the
first-run interview or Settings → Areas opens one to three of them.

The four doctrine files are created empty and unlocked for every area, locked or not. If a
doctrine file is missing when a vault opens, it is recreated with its title; the other files
are written as the features that own them are used.

### The rest of the root

| Path | What it holds |
|---|---|
| `documents/<id>.md` | Library documents, one Markdown file per document |
| `projects/<id>.md` | Project documents, one Markdown file per project |
| `images/files/<id>.<ext>` | The Images picture library: the uploaded bytes, kept whole |
| `images/library.json` | The library index: id, display name, caption, kind, size and dimensions |
| `images/board.json` | The vision board on the Vision page: an ordered array of text, heading, bullets and picture blocks |
| `attachments/files/<fileId>/<name>` | Files dropped on the chat composer: stored whole so the agent can read a path |
| `reviews/<cadence>/<period>.md` | One review file per cadence and period; areas are sections inside it |
| `planning/<cadence>/<period>.md` | Planning stubs for a period |
| `notes/daily/<YYYY-MM-DD>.md` | One **Daily Journal** entry per local date (route `/notes`) |
| `notes/ideal-state/<id>.md` | Ideal State documents; the id is the filename and the title lives in frontmatter |

**Renamed notes and journals.** The page called Daily Note is now the **Daily Journal** and
Life-Chain is now **Quick Notes**, but the routes (`/notes`, `/chain`) and the files
(`notes/daily/`, `.lifequest/signal-chain/`) did not move. Only the names the operator reads
changed, so a bookmark, a saved question or an automation still lands where it did. [The
Daily Journal](./16-daily-journal.md) and [Quick Notes](./15-quick-notes.md) have their own
pages.

## Prescribed files versus SQLite

Most of the vault is prescribed files — Markdown, JSON and JSONL whose names and locations
are the product's contract. Doctrine, library documents, reviews, Daily Journal entries,
pages, decisions, goals, the map, the companion brief, the onboarding record, the Images
index and board, and the Quick Notes captures' JSON records are all files you can read in a
text editor. Uploaded pictures, Quick Notes images and chat attachments are real files
beside their records — the bytes are never base64 inside JSON, because the vault must hold
what you gave it.

One kind of data is different. An area's tabular data — databases, tables, columns, rows and
their relations — lives in that area's SQLite book at `domains/<slug>/data/domain.sqlite`.
That file is the live book: copy the vault folder and the books come with it. It is not a
LifeQuest-hosted replica, and it is not merged as text in Git.

A JSON export of those tables is the git-portable form, written to that area's
`data/books.json`. Restore from that JSON may rebuild the SQLite file, but only as an
explicit Settings action with confirmation. Restore is never an automatic Git hook, and no
commit silently replaces a live book.

## App user data versus the vault

LifeQuest also keeps state of its own, outside every vault. On Windows this is
`%APPDATA%\LifeQuest` (Electron's per-user data folder).

| Lives in the vault | Lives in app user data |
|---|---|
| All content you author | The recent-vault list, the last area lens per vault, and dismissed deadline notices (`recent.json`) |
| Vault settings (`weekStartDay`, saved questions, inbox switches, agent scopes) | Which agent this vault uses, in `vaultAgents` in `recent.json`: the built-in **Pi**, and the Hermes profile bound to this vault when you added one |
| Area databases, pages, pins, views | The Pi endpoint, model and provider name (`pi-endpoint.json`) and the Pi API key (`pi-endpoint.key`, sealed by the OS) |
| Your pictures and chat attachments | Pi's transcripts, grouped by vault (`pi-sessions/<vault id>/`) |
| `about.md` | Connected-agent pairing secrets (`pairing-secrets/`) |
| The Life log, decisions, Quick Notes captures, the companion brief, the onboarding record | The OS-encrypted vault secret store (`secrets.json`) and the unsolicited-filing preference (`companion-filing.json`) |
| | The theme and skin, keyboard bindings and the dock's open tabs, per vault and agent (window local storage) |

That split has consequences worth knowing:

- Copying a vault to another machine carries your content and vault settings, but not your
  theme, recent list, the agent this vault uses, its Hermes profile, Pi endpoint or key, Pi
  transcripts, keyboard bindings or API keys.
- Deleting app user data resets the app — including the recent-vault list and every vault's
  agent binding — but never deletes a vault.
- Deleting a vault folder deletes your content; the app's own data does not restore it.
- Pi's endpoint key never enters the vault, and Pi's transcripts never do either: both live
  in `%APPDATA%\LifeQuest` ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).

## Recent vaults

The app remembers more than one vault. `recent.json` in app user data holds at most 20
entries, most recent first, each with the vault's name, path and when it was last opened. A
vault is recorded when it is created or opened; opening it again moves it to the top.

On launch, the most recent vault is reopened automatically. If it cannot be opened, the
welcome screen appears with the rest of the list. The **Switch vault** dialog and the
welcome list are the two places that show recent vaults; **Settings → Vault** shows the open
vault's path and offers **Change folder…**, not the list.

The last area lens is stored per vault id in `recent.json`, so a vault returns to the lens
you left it on. It is app state, not a vault file.

## Chats and agents belong to the vault

The vault is the profile the app loads: its chats, its open tabs and the agent that answers
in the dock are all scoped to it, and a vault only ever shows its own. Choose another vault
with **Switch vault** and the chat rail, the tab strip and the agent switcher follow the new
vault — the other vault's chats and agent are not carried across.

Every vault starts on the built-in **Pi** agent and with no chats. If you want a Hermes agent
for that vault, add one in **Settings → Hermes → Agents in this vault**: by default the app
creates a fresh Hermes profile for the vault, with its own memory and skills. Reusing a
profile that already works on another vault is a separate, explicit choice and warns that the
two vaults then share that agent's memory and knowledge. See [Companion](./24-companion.md).

Transcripts stay in app user data, grouped by vault, never in the vault folder: a copied
vault carries your content, not your conversations.

## How to use it

Opening, switching, moving, backing up and restoring the vault, in the order you are likely
to need them.

### Moving a vault

1. Quit LifeQuest (**Ctrl+Q** or the window's close control).
2. Move or copy the whole folder. Keep its contents together: `lifequest.json`,
   `.lifequest/`, `domains/` and the feature directories are one unit.
3. Start LifeQuest and choose **Open vault** from the welcome screen, or **Change folder…**
   in **Settings → Vault**. Pick the folder's new path.

The old recent entry now points at nothing and fails to open; the new path becomes the entry
the app reopens. Nothing inside the vault mentions its absolute location, so a moved vault
needs no edits.

### Backing up, and Git as backup

The simplest backup is a copy of the folder made while the app is quit. That copy is a
complete vault.

A private Git remote you own is welcome as a backup, and it is the reason the vault is made
of text files. A few rules keep it honest:

- Make the vault folder its own repository. The vault layout is LifeQuest's contract; it
  does not expect to live inside a larger project's repository.
- Commit Markdown and JSON freely: doctrine, notes, reviews, decisions, goals, pages, the
  map, the brief and the onboarding record all diff as text.
- Pictures and attachments are ordinary binary files under `images/files/` and
  `attachments/files/`. Git keeps them but cannot merge two different versions of one; a
  picture replaced on two machines produces a conflicted binary, not a combined image.
- Do not expect Git to merge the SQLite books. `domain.sqlite` is a binary file; two
  machines changing it produce a conflicted blob, not a merge. Commit the area's
  `data/books.json` export when you want a diffable, restorable form of the tables.
- When you create a database in a vault that is already a Git repository, LifeQuest adds
  `domains/*/data/domain.sqlite*` and `.lifequest/cache/` to the vault's `.gitignore`. The
  live book is local; the JSON export is what travels.
- A vault in a sync folder works only for one studio at a time. Two copies of LifeQuest
  writing the same folder can overwrite each other's files; the app has no lock for that.

### Export and restore the books

In **Settings → Vault**, the **Books** section lists each live area with one row per area:

- **Export books** writes that area's tables to `data/books.json`.
- **Allow restore** is a switch that arms the destructive control on its row; until it is
  on, **Restore books** is disabled. The row's note says it plainly: *Restore replaces the
  live SQLite book for this area from books.json.* A restore disarms itself when it
  completes, so the next one is a deliberate act again.

Restore is deliberately manual and confirmed ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).
It reads the exported JSON and replaces the live SQLite book; it is not a Git hook, a file
watcher or an automatic repair. Ingest mappings and ingest batches have their own review
rules on [Data and databases](./19-data-and-databases.md).

## The screen

The vault is managed through three surfaces, not one page:

| Surface | What it does |
|---|---|
| Welcome screen | **Create vault**, **Open vault**, and the recent vaults list. It is the window's first screen when no vault is open |
| **Switch vault** dialog (rail-foot vault chip) | The recent vaults, the open one marked **Open now**, and **Open another folder…**. A refused folder is reported inline so the picker opens again without the dialog closing |
| **Settings → Vault** | The identity rows — **Name**, **Id**, **Path** — the **Vault folder** row and **Change folder…**, **Week starts on**, and the **Books** section for export and restore |

The dialog's hint says the whole rule: a vault is a folder on this computer, and switching
loads that folder's files in place — nothing is moved or deleted.

## Whole-vault encryption

`VISION.md` treats whole-vault encryption as welcome, on by default for new vaults, and
skippable — and explicitly says creating a vault does not require a passphrase. The current
build does not encrypt the vault: its files are plaintext on disk, and their confidentiality
is your operating-system account's. API keys are the exception and are not in the vault at
all; they live in the OS-encrypted secret store, or for Pi in
`%APPDATA%\LifeQuest\pi-endpoint.key`, described in [Security](./29-security.md).

## Rules and behaviour

- The vault layout is the product's contract, not an import format for another app
  ([VISION.md](../../VISION.md)).
- There is no LifeQuest-hosted copy of the vault
  ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).
- API keys, calendar tokens and Sheet or Notion tokens never enter the vault
  ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).
- Chat transcripts never enter the vault. With Hermes they stay with Hermes; the built-in Pi
  keeps its transcripts in `%APPDATA%\LifeQuest\pi-sessions\<vault id>\`, grouped by the
  vault that made them.
- Reads need no approval; the operator writes directly. Agent writes that change prescribed
  documents go through [Decisions](./23-decisions.md).
- A path that names something inside the vault is checked twice: the segment grammar refuses
  traversal and reserved characters, and every read and write is walked against the real
  directory tree so a symlink inside the vault is refused rather than followed. The vault
  root itself may be a symlink. See [Security](./29-security.md).
- Log entries and Decision records carry the actor — operator or agent — so the vault's
  history says who changed what.
- A locked area's folder is not a privacy boundary inside the app; it is a visibility rule.
  The files are on disk like any others, so a locked area is hidden from the app's lists,
  not encrypted.

## Tips and edge cases

- Quit before making a copy or a commit if you want a clean snapshot; the app writes files
  while it runs.
- Never edit `lifequest.json`'s `schemaVersion` to make an older build open a newer vault.
  It is checked on open and refused.
- An archived area keeps its folder and database; deleting it removes the folder
  recursively, and only archived areas can be deleted. Life cannot be archived or deleted.
  See [Areas](./05-areas.md).
- Unlocking a seeded area is a reveal, not a restore: its doctrine files were already there,
  so there is nothing to import and no confirmation dialog.
- Removing the app, or `%APPDATA%\LifeQuest`, does not remove a vault. Only the folder
  itself does. Removing `%APPDATA%\LifeQuest` does discard the Pi endpoint, its sealed key,
  its transcripts and every vault's agent binding.
- The vault's `theme` and `hermesBaseUrl` settings keys are not what the current UI reads:
  theme and skin come from the window's local storage, and the companion endpoint comes from
  the Pi endpoint file or the Hermes profile bound to the open vault.
- `images/` appears in a vault the first time you upload a picture; `attachments/files/`
  appears the first time you drop a file on the composer. Neither is seeded into a fresh
  vault.
- The companion brief and the onboarding record are studio-level single records, not
  per-area files: one brief serves every board, and the interview happens once per vault.

## Related

- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [Areas](./05-areas.md)
- [Quick Notes](./15-quick-notes.md)
- [The Daily Journal](./16-daily-journal.md)
- [Data and databases](./19-data-and-databases.md)
- [Decisions](./23-decisions.md)
- [Security](./29-security.md)
