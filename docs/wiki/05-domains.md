# Domains

Domains are the life areas LifeQuest organises around. A domain owns doctrine, a
database, pages, saved views and its own Dashboard board, all in one folder in the
vault. The **domain lens** in the top bar chooses which life area the domain-scoped
screens are showing, and **Overview** is the virtual lens that shows all of them
together. A new vault seeds four domains; you can add, rename, archive and delete
them. [The wiki home](./README.md) has the full page index.

## Where it lives

- **The lens**: in the top bar, immediately right of the wing tabs. It reads
  **Overview** followed by every live domain.
- **Managing domains**: the **Settings** sheet, tab **Domains**, at
  `/settings?tab=domains`. The legacy path `/domains` redirects there.
- **Domain content**: each domain's folder in the vault is
  `domains/<slug>/`; doctrine is read and written through **Dream**, **Vision**
  and **Architecture**; Data, Pages and the Dashboard are filtered by the lens.
- **The Overview board**: `.lifequest/overview-pins.json`. Overview has no
  `domains/overview/` folder — it is a lens, not a domain.

## What it is for

A whole life is too large to hold as one undifferentiated list, and splitting it
into apps is worse than splitting it into areas. A domain gives one area a place to
say what it believes, what it wants, why, and how — the four doctrine documents —
and then a place for the work and the numbers that follow from them. The lens lets
the same pages answer a narrower question without a second set of pages.

Domains are deliberately few. The seed set covers a life in four parts, and adding
a fifth should mean a life area the four do not cover, not a tag.

## The four seeded domains

A new vault creates these four, in this order:

| Domain | Slug | Doctrine |
|---|---|---|
| **Health** | `health` | Four empty, unlocked documents |
| **Intellectual** | `intellectual` | Four empty, unlocked documents |
| **Emotional** | `emotional` | Four empty, unlocked documents |
| **Financial** | `financial` | Four empty, unlocked documents |

The four doctrine documents are **Beliefs & Premise** (`premise.md`), **Vision &
Desire** (`what.md`), **Purpose** (`why.md`) and **Strategy (How)** (`how.md`).
Seed order becomes each domain's `sortOrder` (0–3), and that order is what the
lens and the Domains page show.

**Financial** is the domain the Finance kit installs into. The kit is optional and
is offered on Data when the domain is live and the kit is not installed; see
[Finance kit](./20-finance-kit.md).

## What a domain owns

Everything under `domains/<slug>/` belongs to that domain:

| It owns | Where it lives | What it is |
|---|---|---|
| Identity | `domain.json` | Name, description, colour, sort order, archive timestamp |
| Doctrine | `premise.md`, `what.md`, `why.md`, `how.md` | The four documents, with lock state in frontmatter |
| Database | `data/domain.sqlite` | Tables, columns and rows for this area |
| Database support | `data/registry.json`, `data/books.json`, `data/files/`, `data/mappings/`, `data/sync-*.json`, `data/conflicts.json` | Registry, JSON export, attachments, ingest mappings and sync state |
| Pages | `pages/<pageId>.json` | Canvases of blocks you author |
| Board | `pins.json` | The domain's Dashboard pin board and its lock |
| Views | `views/<viewId>.json` | Saved views, some of which appear as board cards |
| Media | `media/` | Images attached to its doctrine documents |

The **Overview** lens is the union: its board is the Overview board, and its Data
and Pages lists span every live domain.

## How to use it

### Switch the lens

1. Click **Overview** or a domain name in the top bar. The current page stays the
   same; the data it lists changes.
2. **←** and **→** move between lens options when the lens has focus.
3. The choice is remembered per vault, so the app reopens on the lens you left it
   on.

### Add a domain

1. Open **Settings → Domains**.
2. Under **Create domain**, type a name in **Name** (the placeholder is *e.g.
   Health, Career*) and press **Create**.
3. The domain is appended to the end of the list with an empty, unlocked set of
   four doctrine documents and its own folder in the vault. Its slug is derived
   from the name: lowercase letters and digits, runs of anything else become `-`.
   A duplicate slug gets a numeric suffix (`career`, then `career-2`).

### Rename a domain

1. On the domain's card, press **Rename**.
2. The name becomes an input. Edit it, then press **Enter** or **Save**. **Escape**
   or **Cancel** abandons the change.
3. Renaming changes the display name only. The slug — the folder name and every
   path under it — never changes, so existing links and files stay valid.

### Activate a domain

Each live card has an **Activate** button. It sets the lens to that domain, which
is the same as choosing it in the top bar. The card of the active domain wears an
**Active** badge and hides its **Activate** button.

### Archive a domain

1. On the domain's card, press **Archive**.
2. Confirm in the app's dialog: the title is **Archive domain**, the message is
   *The domain leaves the active switcher list. Its folder and everything in it
   stay in the vault.* Press **Archive domain** to confirm, or cancel.

Archiving is the soft removal. The domain leaves the top-bar lens list, the
doctrine index and every domain-scoped list, but its folder, doctrine, pages,
database and history stay in the vault. If the archived domain was the active
lens, the app returns to **Overview**.

### Unarchive a domain

**Settings → Domains** keeps an **Archived** section at the bottom. Each row shows
the name and slug with **Unarchive** and **Delete**. **Unarchive** makes the domain
live again and restores it to the lens list and the boards.

### Delete a domain

1. In the **Archived** section, press **Delete** on a domain.
2. Confirm in the app's dialog: the title is **Delete domain**, the message names
   the domain and warns that doctrine, pages and its database are removed and that
   it cannot be undone. The confirm button is destructive.
3. The domain's folder is removed recursively.

Only archived domains can be deleted; the vault refuses to delete a live one. If
the deleted domain was the active lens, the app returns to **Overview**.

## The screen

**Settings → Domains** has three parts:

- **Create domain** — the name field and **Create**. Errors from the vault appear
  under the form.
- **Your domains** — a card per live domain, in sort order. Each card shows the
  name (or the rename input), an **Active** badge when it is the current lens, the
  description (*No description* until one is set), `slug: <slug>`, and a one-line
  doctrine summary such as *Beliefs & Premise: unlocked (empty)*, including the
  body character count when it is not empty. The buttons are **Activate** (hidden
  on the active card), **Rename** and **Archive**; while renaming, **Save** and
  **Cancel**.
- **Archived** — only when something is archived: rows with **Unarchive** and
  **Delete**, plus the confirmation dialog.

The top-bar lens itself is a segmented control: **Overview**, then each live
domain by name. It shows a loading state (*Loading domains…*) while the vault is
still booting, and a domain-switch failure appears beside it rather than as a
dialog.

## Overview and the lens as a filter

**Overview** is the unfiltered view: the union of databases and pages across all
live domains, the Overview pin board, and every Decision regardless of domain. It
is not a folder and has no doctrine, no database and no pages of its own.

Choosing a domain narrows the domain-scoped screens to that domain:

| Screen | With a domain lens |
|---|---|
| **Dashboard** | Shows that domain's board (`domains/<slug>/pins.json`) |
| **Data** | Lists that domain's databases; the domain selector disappears |
| **Pages** | Lists that domain's pages; the domain selector disappears |
| **Dream**, **Vision**, **Architecture** | Show only that domain's documents |
| **Life-Chain** | Shows unassigned signals plus signals tagged to that domain |
| **Decisions** (rail badge) | Counts pending Decisions tagged to that domain |
| **Goals**, **Projects**, **Documents** | Lists narrow to that domain; new records default to it |
| **Act** | The task board narrows to that domain |
| **Reviews** | Opens its session scope on that domain |

Wings are not a filter: switching wings changes the rail, never the data
([LAWS/WINGS.md](../../LAWS/WINGS.md)). The domain lens is the data filter for
domain-scoped lists, and the Life-Chain rule is exact: a domain lens includes the
unassigned signals as well as the ones tagged to that domain
([LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md)).

## Rules and behaviour

- Four domains are seeded; a domain needs a name and gets a derived, immutable
  slug.
- Every domain starts with four empty, unlocked doctrine documents. Locking is a
  document action, not a domain action; see [Doctrine](./07-doctrine.md).
- A live domain appears in the lens; an archived one does not. Archiving never
  deletes files or data.
- Deleting is available only for archived domains and removes the folder and
  everything under it. It cannot be undone by the app; a backup or a Git history
  is the only way back.
- A domain board holds only that domain's pins and views. On the Overview board,
  cards from any live domain may be pinned. Pins whose domain was archived are
  dropped from the board read, so unarchiving is what brings the data back, not a
  manual file edit.
- There is no reorder control. Order is `sortOrder`, which the seed assigns 0–3
  and creation appends as "last". The lens, the Domains page and every domain
  picker sort by it.
- Creating, renaming, archiving and deleting a domain are operator actions taken
  in Settings. Agent writes to a domain's doctrine go through
  [Decisions](./23-decisions.md); agents cannot lock or unlock documents.

## Tips and edge cases

- The lens never navigates. Switching it leaves you on the page you are on; only
  the domain-scoped lists on that page change.
- A domain whose slug is `financial` is the one Data offers the Finance kit for.
  Renaming it does not change that; the slug stays.
- Archiving the last live domain leaves **Overview** as the only lens, and the
  doctrine index says *No live domains yet.*
- Rename does not move files, so renaming a domain never breaks a saved path,
  a pinned card or a review section heading.
- Two domains can have the same display name. Their slugs differ, and the slug is
  what paths and the domain card show.
- If a domain switch fails to persist, the lens control shows the error beside
  itself. The window has already switched, but the choice may not be remembered
  for the next launch.

## Related

- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Doctrine](./07-doctrine.md)
- [Data and databases](./19-data-and-databases.md)
- [Goals](./10-goals.md)
- [Settings](./28-settings.md)
