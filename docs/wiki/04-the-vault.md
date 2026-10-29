# The vault

A vault is a folder on your computer that holds your life as plain files: doctrine,
goals, projects, the Life Map, journals, reviews, decisions, your own pages and
documents, and one SQLite file per domain for tabular data. Opening a vault is how
you identify yourself to LifeQuest — there is no account and no hosted copy. The
folder is the database. [The wiki home](./README.md) has the full page index.

## Where it lives

You choose the folder whenever you create or open a vault. LifeQuest has no default
vault location and never creates one on its own:

- **Create vault** on the welcome screen opens a folder picker and seeds the
  chosen folder.
- **Open vault** opens a folder picker for an existing vault.
- **Recent vaults** on the welcome screen reopens a path the app already knows.
- **Settings → Vault** shows the open vault's name, id and absolute path, and
  **Change folder…** opens another vault in place.

The marker that makes a folder a vault is `lifequest.json` at its root. Nothing
else is required to identify it.

## What it is for

The vault exists so that your life outlives the app. Anything in it can be read
with a text editor, copied with a file manager, versioned with Git, or moved to
another machine. Opening a vault is identity
([LAWS/IDENTITY.md](../../LAWS/IDENTITY.md)): the operator is the person holding
the folder, and the product must not require an account to use it. One operator
owns one vault; there is no multi-user tenancy and no shared domain.

## The folder at a glance

```
<vault>/
  lifequest.json
  .lifequest/
  domains/<slug>/
  documents/
  projects/
  reviews/<cadence>/<period>.md
  planning/<cadence>/<period>.md
  notes/daily/<YYYY-MM-DD>.md
  notes/ideal-state/<id>.md
```

Beside `lifequest.json` and `.lifequest/`, the root holds the feature directories:
`domains/`, `documents/`, `projects/`, `reviews/`, `planning/` and `notes/`.
Everything an operator reads or writes is inside one of those directories or
`.lifequest/`, organized by feature.

### `lifequest.json`

The vault's identity card. It carries `schemaVersion` (currently `1`), a generated
`id`, the vault `name` (a new vault is named `Personal`), and `createdAt`. A vault
whose `schemaVersion` is not `1` is refused rather than half-read.

### `.lifequest/`

| Path | What it holds |
|---|---|
| `.lifequest/settings.json` | Vault settings: `weekStartDay`, `autoApproveInserts`, `chatQuestions`, plus `hermesBaseUrl` and `theme` keys the current UI does not edit |
| `.lifequest/agents.json` | The Personnel roster (`{ "hires": [] }` in a new vault) |
| `.lifequest/connected-agents.json` | The connected-agent roster. No secrets live here |
| `.lifequest/log.jsonl` | The Life log, one JSON record per line |
| `.lifequest/decisions/<id>.json` | Pending and decided proposals — the Decisions inbox |
| `.lifequest/manual-decisions/<id>.json` | Decisions the operator records by hand, kept apart from the approval path |
| `.lifequest/signal-chain/<id>.json` | Life-Chain captures |
| `.lifequest/map.json` | The Life Map: years, months, events, tasks and recorded days |
| `.lifequest/goals.json` | Goal records |
| `.lifequest/automations.json` | The Automation shelf |
| `.lifequest/about.md` | The **About me** text agents receive as lifestyle context |
| `.lifequest/overview-pins.json` | The Overview board's pins and lock |
| `.lifequest/reviews/<cadence>.md` | A cadence's standing review rules, read before a review session |
| `.lifequest/cache/` | App cache |

### `domains/<slug>/`

Each live or archived domain owns one directory, named by its slug (`health`,
`intellectual`, `emotional`, `financial`, and any you add):

| Path | What it holds |
|---|---|
| `domain.json` | Name, description, colour, sort order, `archivedAt`, timestamps |
| `premise.md` | Doctrine: **Beliefs & Premise** |
| `what.md` | Doctrine: **Vision & Desire** |
| `why.md` | Doctrine: **Purpose** |
| `how.md` | Doctrine: **Strategy (How)** |
| `media/` | Images attached to the domain's doctrine documents |
| `data/domain.sqlite` | The domain's database book — tables, columns and rows |
| `data/registry.json` | The database registry for the domain |
| `data/books.json` | The JSON export of the domain's tables (created by **Export books**) |
| `data/files/<fileId>/<name>` | Files attached to database rows, including receipt images |
| `data/mappings/` | Ingest mappings, one JSON file each |
| `data/sync-index.json` | Adapter sync state |
| `data/sync-queue.json` | Writes queued while a linked source is unreachable |
| `data/conflicts.json` | Conflicts waiting for the operator to resolve |
| `pages/<pageId>.json` | The domain's pages, one JSON file each |
| `pins.json` | The domain board's pins and lock |
| `views/<viewId>.json` | Saved views and the cards they draw |

The four doctrine files are created empty and unlocked for every new domain. If a
doctrine file is missing when a vault opens, it is recreated with its title; the
other files are written as the features that own them are used.

### The rest of the root

| Path | What it holds |
|---|---|
| `documents/<id>.md` | Library documents, one Markdown file per document |
| `projects/<id>.md` | Project documents, one Markdown file per project |
| `reviews/<cadence>/<period>.md` | One review file per cadence and period; domains are sections inside it |
| `planning/<cadence>/<period>.md` | Planning stubs for a period |
| `notes/daily/<YYYY-MM-DD>.md` | One Daily Note per local date |
| `notes/ideal-state/<id>.md` | Ideal State documents; the id is the filename and the title lives in frontmatter |

## Prescribed files versus SQLite

Most of the vault is prescribed files — Markdown, JSON and JSONL whose names and
locations are the product's contract. Doctrine, library documents, reviews, Daily
Notes, pages, decisions, goals and the map are all files you can read in a text
editor.

One kind of data is different. A domain's tabular data — databases, tables,
columns, rows and their relations — lives in that domain's SQLite book at
`domains/<slug>/data/domain.sqlite`. That file is the live book: copy the vault
folder and the books come with it. It is not a LifeQuest-hosted replica, and it is
not merged as text in Git.

A JSON export of those tables is the git-portable form, written to that domain's
`data/books.json`. Restore from that JSON may rebuild the SQLite file, but only as
an explicit Settings action with confirmation. Restore is never an automatic Git
hook, and no commit silently replaces a live book.

## App user data versus the vault

LifeQuest also keeps state of its own, outside every vault. On Windows this is
`%APPDATA%\LifeQuest` (Electron's per-user data folder).

| Lives in the vault | Lives in app user data |
|---|---|
| All content you author | The recent-vault list (`recent.json`) |
| Vault settings (`weekStartDay`, saved questions, auto-approve list) | The last domain lens per vault, and dismissed deadline notices |
| Domain databases, pages, pins, views | The chosen Hermes profile |
| `about.md` | The theme, skin and installed-theme list (window local storage) |
| Life log, decisions, signals | The OS-encrypted secret store (`secrets.json`) |

That split has consequences worth knowing:

- Copying a vault to another machine carries your content and vault settings, but
  not your theme, recent list, chosen Hermes profile or API keys.
- Deleting app user data resets the app — including the recent-vault list — but
  never deletes a vault.
- Deleting a vault folder deletes your content; the app's own data does not
  restore it.

## Recent vaults

The app remembers more than one vault. `recent.json` in app user data holds at
most 20 entries, most recent first, each with the vault's name, path and when it
was last opened. A vault is recorded when it is created or opened; opening it
again moves it to the top.

On launch, the most recent vault is reopened automatically. If it cannot be
opened, the welcome screen appears with the rest of the list. The
welcome list is the only place that shows recent vaults; **Settings → Vault**
shows the open vault's path and offers **Change folder…**, not the list.

The last domain lens is stored per vault id, so a vault returns to the lens you
left it on. It is app state, not a vault file.

## How to use it

Opening, switching, moving, backing up and restoring the vault, in the order you
are likely to need them.

### Moving a vault

1. Quit LifeQuest (**Ctrl+Q** or the window's close control).
2. Move or copy the whole folder. Keep its contents together: `lifequest.json`,
   `.lifequest/` and the feature directories are one unit.
3. Start LifeQuest and choose **Open vault** from the welcome screen, or **Change
   folder…** in **Settings → Vault**. Pick the folder's new path.

The old recent entry now points at nothing and fails to open; the new path becomes
the entry the app reopens. Nothing inside the vault mentions its absolute location,
so a moved vault needs no edits.

### Backing up, and Git as backup

The simplest backup is a copy of the folder made while the app is quit. That copy
is a complete vault.

A private Git remote you own is welcome as a backup, and it is the reason the vault
is made of text files. A few rules keep it honest:

- Make the vault folder its own repository. The vault layout is LifeQuest's
  contract; it does not expect to live inside a larger project's repository.
- Commit Markdown and JSON freely: doctrine, notes, reviews, decisions, goals,
  pages and the map diff as text.
- Do not expect Git to merge the SQLite books. `domain.sqlite` is a binary file;
  two machines changing it produce a conflicted blob, not a merge. Commit the
  domain's `data/books.json` export when you want a diffable, restorable form of
  the tables.
- When you create a database in a vault that is already a Git repository,
  LifeQuest adds `domains/*/data/domain.sqlite*` and `.lifequest/cache/` to the
  vault's `.gitignore`. The live book is local; the JSON export is what travels.
- A vault in a sync folder works only for one studio at a time. Two copies of
  LifeQuest writing the same folder can overwrite each other's files; the app has
  no lock for that.

### Export and restore the books

In **Settings → Vault**, the **Books** section lists each live domain with two
controls:

- **Export books** writes that domain's tables to `data/books.json`.
- A confirmation checkbox — *Restore replaces the live SQLite book for this domain
  from books.json* — arms **Restore books**. Until it is checked, the button is
  disabled.

Restore is deliberately manual and confirmed
([LAWS/DATABASES.md](../../LAWS/DATABASES.md)). It reads the exported JSON and
replaces the live SQLite book; it is not a Git hook, a file watcher or an
automatic repair. Ingest mappings and ingest batches have their own review rules
on [Data and databases](./19-data-and-databases.md).

## Whole-vault encryption

`VISION.md` treats whole-vault encryption as welcome, on by default for new
vaults, and skippable — and explicitly says creating a vault does not require a
passphrase. The current build does not encrypt the vault: its files are plaintext
on disk, and their confidentiality is your operating-system account's. API keys
are the exception and are not in the vault at all; they live in the OS-encrypted
secret store described in [Security](./29-security.md).

## Rules and behaviour

- The vault layout is the product's contract, not an import format for another
  app ([VISION.md](../../VISION.md)).
- There is no LifeQuest-hosted copy of the vault
  ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).
- API keys, calendar tokens and Sheet or Notion tokens never enter the vault
  ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)).
- Chat transcripts stay with Hermes, not in the vault.
- Reads need no approval; the operator writes directly. Agent writes that change
  prescribed documents go through [Decisions](./23-decisions.md).
- A path that names something inside the vault is checked twice: the segment
  grammar refuses traversal and reserved characters, and every read and write is
  walked against the real directory tree so a symlink inside the vault is refused
  rather than followed. The vault root itself may be a symlink. See
  [Security](./29-security.md).
- Log entries and Decision records carry the actor — operator or agent — so the
  vault's history says who changed what.

## Tips and edge cases

- Quit before making a copy or a commit if you want a clean snapshot; the app
  writes files while it runs.
- Never edit `lifequest.json`'s `schemaVersion` to make an older build open a
  newer vault. It is checked on open and refused.
- Archiving a domain keeps its folder and database; deleting it removes the folder
  recursively, and only archived domains can be deleted. See
  [Domains](./05-domains.md).
- Removing the app, or `%APPDATA%\LifeQuest`, does not remove a vault. Only the
  folder itself does.
- The vault's `theme` and `hermesBaseUrl` settings keys are not what the current
  UI reads: theme and skin come from the window's local storage, and the Hermes
  endpoint comes from the companion profile.

## Related

- [Getting started](./02-getting-started.md)
- [The studio](./03-the-studio.md)
- [Domains](./05-domains.md)
- [Data and databases](./19-data-and-databases.md)
- [Decisions](./23-decisions.md)
- [Security](./29-security.md)
