# Areas

Areas are the life areas LifeQuest organises around. Every vault has one base
area, **Life**, and may have any number of narrower areas — the five seeded ones
(**Health**, **Mind**, **Finance**, **Business**, **Relationships**) plus any you
create. An area owns doctrine, a database, pages, saved views and its own
Dashboard board in one folder in the vault. The **area lens** in the window title
bar chooses which area the area-scoped screens are showing. [The wiki
home](./index.md) has the full page index.

## Where it lives

- **The lens**: in the window title bar's lens tab, centred on the strip between
  the rail and the trailing controls. It reads **Life** — the union lens — then
  each unlocked area. With fewer than two unlocked areas the tab is a quiet,
  inert **Life** label rather than a control; it becomes a segmented control once
  a second area opens.
- **Managing areas**: the **Settings** sheet, tab **Areas**, at
  `/settings?tab=domains`. The legacy path `/domains` redirects there.
- **Area content**: each area's folder is `domains/<slug>/`; doctrine is read and
  written through **Dream**, **Vision** and **Architecture**; Data, Pages, the
  Dashboard and Quick Notes are filtered by the lens.
- **The Life lens** is the union: Data and Pages span every live area, and the
  Dashboard shows the Life board. New databases and pages created while the lens
  is on Life land in the base `life` area with no selector.
- **The seeded areas**: a new vault writes all six area folders at creation,
  including the five locked ones, each with its four empty doctrine documents.

## What it is for

A whole life is too large to hold as one undifferentiated list, and splitting it
into apps is worse than splitting it into areas. An area gives one part of a life
a place to say what it believes, what it wants, why, and how — the four doctrine
documents — and then a place for the work and the numbers that follow from them.
The lens lets the same pages answer a narrower question without a second set of
pages.

0.2.8 adds a lock state so that a new vault is not handed a taxonomy to fill in
before it has been lived in. The five narrow areas exist on disk from the first
minute but stay invisible until the onboarding interview or the operator reveals
them in Settings. **Life** is always available, and the whole-life container is a
real base area — not a virtual lens.

## The six seeded areas

A new vault creates these six, in this order:

| Area | Slug | Unlocked at creation |
|---|---|---|
| **Life** | `life` | Always — it is the base area and never a chip |
| **Health** | `health` | No — locked |
| **Mind** | `mind` | No — locked |
| **Finance** | `financial` | No — locked |
| **Business** | `business` | No — locked |
| **Relationships** | `relationships` | No — locked |

The four doctrine documents are **Beliefs & Premise** (`premise.md`), **Vision &
Desire** (`what.md`), **Purpose** (`why.md`) and **Strategy (How)** (`how.md`).
Seed order becomes each area's `sortOrder` (0–5), and that order is what the lens
and the Areas page show.

**Finance** is the area the Finance kit installs into. The area is seeded locked;
unlock `financial`, then Data offers the kit. The kit is optional and is offered
on Data when the area is live and the kit is not installed; see
[Finance kit](./20-finance-kit.md).

## What an area owns

Everything under `domains/<slug>/` belongs to that area:

| It owns | Where it lives | What it is |
|---|---|---|
| Identity | `domain.json` | Name, description, colour, sort order, lock state, archive timestamp |
| Doctrine | `premise.md`, `what.md`, `why.md`, `how.md` | The four documents, with lock state in frontmatter |
| Database | `data/domain.sqlite` | Tables, columns and rows for this area |
| Database support | `data/registry.json`, `data/books.json`, `data/files/`, `data/mappings/`, `data/sync-*.json`, `data/conflicts.json` | Registry, JSON export, attachments, ingest mappings and sync state |
| Pages | `pages/<pageId>.json` | Canvases of blocks you author |
| Board | `pins.json` | The area's Dashboard pin board and its lock |
| Views | `views/<viewId>.json` | Saved views, some of which appear as board cards |
| Media | `media/` | Images attached to its doctrine documents |

The `life` area owns the same kinds of files. Its lens is the union of every live
area; its own folder is where unscoped records land.

## How to use it

### Switch the lens

1. Click **Life** or an unlocked area name in the window title bar's lens tab. The
   current page stays the same; the data it lists changes.
2. **←** and **→** move between lens options when the lens has focus.
3. The choice is remembered per vault, so the app reopens on the lens you left it
   on. A saved lens naming a locked or archived area resolves to Life and the
   saved preference is cleared.

### Unlock a seeded area

1. Open **Settings → Areas**.
2. Under **Unlock another area**, each area that is seeded and still locked is
   listed by name and slug with a plain **Unlock** button. There is no
   confirmation: unlocking is a reveal, not an activation.
3. The area moves into **Your areas** and appears in the lens. The lens does not
   switch to it; you choose it when you want to work in it.
4. The vault logs `area.unlocked` (the stored event is `domain.unlocked`), and
   the Log prints the operator-facing words.

### Create an area

1. Open **Settings → Areas** and scroll to **Create area**.
2. Type a name in **Name** (the placeholder is *e.g. Woodworking*) and press
   **Create**.
3. The area is appended to the end of the list with four empty, unlocked doctrine
   documents and its own folder. Its slug is derived from the name: lowercase
   letters and digits, runs of anything else become `-`, leading and trailing
   hyphens are trimmed, and an empty result falls back to `domain`. A duplicate
   slug gets a numeric suffix (`career`, then `career-2`).

A created area is unlocked from the start — there is no draft or locked state for
it.

### Rename an area

1. On the area's card, press **Rename**.
2. The name becomes an input. Edit it, then press **Enter** or **Save**. **Escape**
   or **Cancel** abandons the change.
3. Renaming changes the display name only. The slug — the folder name and every
   path under it — never changes, so existing links, saved questions, pinned cards
   and files stay valid.

### Activate an area

Each live card has an **Activate** button. It sets the lens to that area, which is
the same as choosing it in the window title bar. The card of the active area wears
an **Active** badge and hides its **Activate** button. The title bar's lens and
the Areas page always show the same state.

### Archive an area

1. On the area's card, press **Archive**.
2. Confirm in the app's dialog: the title is **Archive area**, the message is
   *The area leaves the active switcher list. Its folder and everything in it
   stay in the vault.* Press **Archive area** to confirm, or cancel.

Archiving is the soft removal. The area leaves the lens list, the doctrine index
and every area-scoped list, but its folder, doctrine, pages, database and history
stay in the vault. If the archived area was the active lens, the app returns to
**Life**. **Life** itself cannot be archived — the vault refuses with *The Life
area cannot be archived*.

### Unarchive an area

**Settings → Areas** keeps an **Archived** section at the bottom. Each row shows
the name and slug with **Unarchive** and **Delete**. **Unarchive** makes the area
live again and restores it to the lens list and the boards.

### Delete an area

1. In the **Archived** section, press **Delete** on an area.
2. Confirm in the app's dialog: the title is **Delete area**, the message names
   the area and warns that doctrine, pages and its database are removed and that
   it cannot be undone. The confirm button is destructive.
3. The area's folder is removed recursively.

Only archived areas can be deleted; the vault refuses to delete a live one, and
**Life** cannot be deleted at all. If the deleted area was the active lens, the
app returns to **Life**.

## The screen

**Settings → Areas** has four parts:

- **Unlock another area** — only while something is still locked: rows with the
  area's name, its slug, and **Unlock**. The five seeded names appear here and
  nowhere else until they are opened.
- **Your areas** — a card per live, unlocked area, in sort order. Each card shows
  the name (or the rename input), an **Active** badge when it is the current lens,
  the description (*No description* until one is set), `slug: <slug>`, and a
  one-line doctrine summary such as *Beliefs & Premise: unlocked (empty)*,
  including the body character count when it is not empty. The buttons are
  **Activate** (hidden on the active card), **Rename** and **Archive**; while
  renaming, **Save** and **Cancel**. The base `life` area is the vault container,
  not a choice, so it never appears as a card.
- **Archived** — only when something is archived: rows with **Unarchive** and
  **Delete**, plus the confirmation dialog.
- **Create area** — the name field and **Create**. Errors from the vault appear
  under the form.

The lens in the window title bar is either a quiet **Life** label or, once a
second area is unlocked, a segmented control: **Life**, then every live area by
name. A lens-switch failure appears beside the control rather than as a dialog.
The lens only appears while the shell is mounted; it is absent on the welcome and
companion screens.

## The lens as a filter

**Life** is the unfiltered view: the union of databases and pages across all live
areas, the Life pin board, and every Decision regardless of area. It is the base
area on disk, and it is also the whole-life lens.

Choosing an area narrows the area-scoped screens to that area:

| Screen | With an area lens |
|---|---|
| **Dashboard** | Shows that area's board (`domains/<slug>/pins.json`) |
| **Data** | Lists that area's databases; the area selector disappears |
| **Pages** | Lists that area's pages; the area selector disappears |
| **Dream**, **Vision**, **Architecture** | Show only that area's documents |
| **Quick Notes** | Shows unassigned signals plus signals tagged to that area |
| **Decisions** (rail badge) | Counts every pending Decision in the vault — the badge is global, not lens-filtered; the Dashboard's Pending card is the lens-scoped view |
| **Goals**, **Projects**, **Documents** | Lists narrow to that area; new records default to it |
| **Task Manager** | The task board narrows to that area |
| **Reviews** | Opens its session scope on that area |

Wings are not a filter: switching wings changes the rail, never the data
([LAWS/WINGS.md](../../LAWS/WINGS.md)). The area lens is the data filter for
area-scoped lists, and the Quick Notes rule is exact: an area lens includes the
unassigned captures as well as the ones tagged to that area
([LAWS/DOMAIN-FILTER.md](../../LAWS/DOMAIN-FILTER.md)).

## Rules and behaviour

- The vault seeds **Life** plus the five locked areas; **Life** is always
  unlocked, is never a chip, and cannot be archived or deleted.
- Locked means exactly `unlockedAt: null`. An **absent** `unlockedAt` field means
  unlocked, so a vault written before areas had a lock state keeps every area it
  ever had. A locked area is invisible to every read, list and write — no
  database list, no page list, no board, no doctrine — and the companion cannot
  leak one: `list_documents` skips it, `get_document` answers not found, a
  doctrine Decision cannot be filed for it or applied into it, and a goal fence
  naming it is refused where it is filed.
- Unlocking is a flag flip. The folder, its four doctrine documents and its
  database already exist, so nothing is created or moved, and unlocking does not
  change the lens.
- A created area needs only a name and gets a derived, immutable slug. Creating
  writes a `domain.created` log line and unlocking a `domain.unlocked` one (the
  Log prints them as `area.created` / `area.unlocked`), while seeding a locked
  area writes none.
- Every area starts with four empty, unlocked doctrine documents. Locking is a
  document action, not an area action; see [Doctrine](./07-doctrine.md).
- A live area appears in the lens; an archived or locked one does not. Archiving
  never deletes files or data.
- Deleting is available only for archived areas and removes the folder and
  everything under it. It cannot be undone by the app; a backup or a Git history
  is the only way back.
- An area board holds only that area's pins and views. Pins whose area was
  archived are dropped from the board read, so unarchiving is what brings the
  data back, not a manual file edit.
- There is no reorder control. Order is `sortOrder`, which the seed assigns 0–5
  and creation appends as "last". The lens, the Areas page and every area picker
  sort by it.
- Creating, renaming, archiving, unlocking and deleting an area are operator
  actions taken in Settings. Agent writes to an area's doctrine go through
  [Decisions](./23-decisions.md); agents cannot lock or unlock documents or
  areas.
- The main process refuses to activate a locked area at all, so a stale link or a
  hand-edited preference cannot surface one.

## Tips and edge cases

- The lens never navigates. Switching it leaves you on the page you are on; only
  the area-scoped lists on that page change.
- The interview opens at most three areas, and only seeded areas that are still
  locked. Unlocking never takes an area away, and a retry is safe: the unlock is
  idempotent and the doctrine write is an overwrite.
- A vault from 0.2.7 or earlier has no lock state, no `life` base area and no
  onboarding file. It keeps its existing areas, shows no first-run card, and Data
  and Pages keep their area selector because there is no base area to create
  into.
- An area whose slug is `financial` is the one Data offers the Finance kit for.
  Renaming it does not change that; the slug stays.
- Archiving the last live area leaves **Life** as the only lens, and the doctrine
  index says *No live areas yet.*
- Rename does not move files, so renaming an area never breaks a saved path, a
  pinned card or a review section heading.
- Two areas can have the same display name. Their slugs differ, and the slug is
  what paths and the area card show.
- If a lens switch fails to persist, the control shows the error beside itself.
  The window has already switched, but the choice may not be remembered for the
  next launch.

## Related

- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Doctrine](./07-doctrine.md)
- [Data and databases](./19-data-and-databases.md)
- [Goals](./10-goals.md)
- [Settings](./28-settings.md)
