# Pages

A page is a domain-owned canvas: a title and an ordered list of blocks that shows
live pieces of the vault — markdown, a bound database table, a metric, a chart,
goal progress, finance reports, a script — arranged by you. Pages live in the
vault as JSON, one file per page under the domain that owns it, and a page can be
pinned to a Dashboard so one click gets you back to it.

## Where it lives

**Home** wing → **Pages** (route `/pages`). It opens in the centre pane as a page.

- The top-bar lens filters the list: **Overview** shows pages from every live
  domain, a domain lens shows that domain's pages and creates into it.
- Clicking a page opens `/pages/:slug/:pageId` — the page canvas.
- A page pin appears on a Dashboard board and opens the same canvas. Pins are
  added from the Dashboard, not from the Pages page.

Back to [Wiki home](./README.md).

## What it is for

The Dashboard is the board the app draws for you; a page is the board you draw
yourself. It is the place for a domain's own working surface — "what my money did
this month", "my health numbers" — assembled from blocks that read the vault
rather than from prose copied out of it. The blocks are live: a table bound to a
database re-reads when rows change, a metric recomputes, and a script runs
against the domain's SQLite.

## How to use it

### Create and find a page

1. Open **Pages**. With **Overview** selected, the **New page** panel asks for a
   **Domain**; with a domain lens selected it uses that domain.
2. Type a **Title** and choose **New page**. The page is created empty and opens
   from the list.
3. The **All pages** list is ordered most recently updated first, shows each
   page's block count and update date, and carries the domain name on
   **Overview**. **Filter by title…** narrows the list. Empty: **No pages yet.**
   with the hint to create one from the panel beside the list. No match: `No pages match “…”`.
4. On **Overview**, **By domain** counts the pages in each live domain.

### Build the canvas

1. Open a page. The header has **← Pages** and an editable title.
2. At the bottom, choose a block kind from the picker and choose **Add block**.
   The block is appended after the existing blocks.
3. Fill the block in place:
   - **Markdown** — a plain text area. It is stored as the block's markdown and
     is not rendered on the canvas.
   - **Bound table** — choose a database; the block draws every row and column.
   - **Metric** — choose a database, a column and `sum` / `count` / `last`, and
     tick **Convert to ZAR** if the figures are money.
   - **Date range** — **Start** and **End** dates. One per page; it filters the
     bound-table, metric and chart blocks on the same page.
   - **Chart** — `bar` or `line`, a database, an X column and a Y column.
   - **Goal progress**, **Deadline**, **Budget vs actual**, **Net worth**,
     **Scenario compare** — no configuration except the scenario pair; they read
     the vault as it stands. Finance blocks offer **Install Finance kit** until
     the kit exists.
   - **Script** — a human name, a read-only SQL `SELECT` (or a small JSON object
     of queries and https fetches), and **Run** to read the domain's database
     without saving. **Save** is what writes the page; **Run** only reads.
4. Choose **Remove** on a block to take it out.
5. Choose **Save** to write the title and the whole block list to
   `domains/<slug>/pages/<pageId>.json`.

There is no autosave on a page. Editing blocks changes only the screen until
**Save**; leaving the page discards what was not saved.

### Pin a page to a Dashboard

1. Open the Dashboard board you want the page on — Overview or a domain.
2. Choose **Pin board** in the header, then, under **Add pin**, choose the page's
   title. The card appears at the end of the board.
3. The card shows the page's title, its domain, and **Open page →**. The card's
   card-actions menu offers **Edit card**, **Archive** and **Delete**.
4. **Delete** on a page pin asks `Delete “<title>”?` and then deletes the page
   and its blocks; the card leaves every board that showed it. This cannot be
   undone. **Archive** only takes the card off that board.

A locked Dashboard board has no **Pin board** control and no card menu; its pins
are arranged only after **Unlock**.

## The screen

Pages list (`/pages`)

| Part | What it does |
|---|---|
| Header | Eyebrow **Pages**, title **Pages**, one line of description. |
| **All pages** | The list for the active lens, with a count and the title filter. |
| **New page** | **Title** field, **Domain** select on **Overview**, **New page**. |
| **By domain** | Counts per live domain (shown on **Overview**). |

Page canvas (`/pages/:slug/:pageId`)

| Part | What it does |
|---|---|
| **← Pages** | Back to the list. |
| Title input | The page title, saved with **Save**. |
| Block list | Each block with its kind label, its fields, and **Remove**. |
| Block picker | The twelve block kinds, then **Add block**. |
| **Save** | Writes title and blocks; the only write. |

## Rules and behaviour

A page is JSON in its domain. One file per page at
`domains/<slug>/pages/<pageId>.json` with `id`, `domainSlug`, `title`, `blocks`,
`createdAt` and `updatedAt`. A page belongs to a live domain; an archived domain's
pages are not listed. Deleting a page removes the file and strips its pins from
that domain's board and the Overview board.

Block kinds. The stored schema has twelve kinds, and the picker offers all of
them: **Markdown**, **Bound table**, **Metric**, **Date range**, **Chart**,
**Goal progress**, **Deadline**, **Budget vs actual**, **Net worth**,
**Scenario compare**, **Script**, **Saved view**.

- A page may hold at most one **Date range** block. Its start and end must be
  `YYYY-MM-DD` and start must not be after end. Bound-table, metric and chart
  blocks filter their rows by it, using the database's `date` columns.
- A **Bound table** needs an existing database in the same domain. A **Metric**
  needs an existing database and one of its columns. A **Chart** needs an
  existing database plus X and Y columns. A **Scenario compare** block needs a
  non-empty assumption set id.
- A **Saved view** block holds a `viewId` and draws the saved card through the
  same card code as the Dashboard. The canvas has no view picker in this build,
  so adding one from the picker draws **This view is missing and can be
  unpinned.** rather than a card; saved views are pinned to a Dashboard, not
  authored inside a page. Its block kind exists in the stored schema and is drawn
  when the id is present.
- **Script** blocks are the one kind the companion may write itself; everything
  else on a page is the operator's arrangement. The block's name must be
  non-empty and its source a string. Source is capped at 16 KB.

Order is append-only. Blocks render in the order stored, and the canvas
offers add and remove — there is no drag or move control. To reorder, remove and
re-add in the order you want.

The canvas does not render markdown. A **Markdown** block is an editable text
area; the page has no preview mode. Rendered markdown with `[[wiki links]]` is a
[Documents](./22-documents.md) feature, not a page feature; a `[[target]]` typed
into a page block stays literal text.

Pages have no lock of their own. A page canvas has no **Lock** control in this
build: it is an operator surface, and the companion has no general page write.
The "page lock" in the app is the Dashboard board's lock, and it governs pins and
cards on that board — see [Dashboard](./06-dashboard.md). Its law is
[LAWS/DASHBOARD.md](../../LAWS/DASHBOARD.md): a locked board is read-only for
agents, their changes wait in Decisions, and approving a Decision does not unlock
the board. Page pins inherit the board's lock because adding or removing one is a
board change.

What the companion can do with pages.

| Path | Behaviour |
|---|---|
| `list_pages`, `get_page` | Reads. No approval. Returns the full page including blocks. |
| `apply_script_block` | Writes one **Script** block — appends it or replaces a named script block. Applies immediately, files no Decision, and the companion must name the script in its reply. |
| `run_script_block` | Runs a script without saving. An agent may run read-only queries only; https fetches are refused for agents. |

There is no companion tool that adds a markdown block, a table, a metric or any
other page block in this build. The engine can file a **Page** Decision when an
update arrives from an agent, and the companion is told that every page edit
other than a script block goes through Decisions — but the tool surface the
companion actually has is reads plus script blocks.

Script blocks are SQL, read-only, and bounded. A script is one `SELECT` (or a
JSON object with `queries` and `fetches`):

- Read-only statements only; a second statement, a write keyword, `PRAGMA`, and
  functions such as `randomblob()`, `readfile()` or `load_extension()` are
  refused. A recursive CTE is refused too.
- At most five queries and five https fetches per run. Query results are capped
  at 200 rows (with a truncation warning) and each fetch body at 64 KB.
- A query runs against `domains/<slug>/data/domain.sqlite` read-only. When the
  domain has no database yet, the queries come back empty with the warning
  **No database for this domain yet.**
- On the canvas, **Run** calls the same engine the page renders with. **Run**
  does not save the source; **Save** writes the page.
- A script block is the one page change the companion applies itself; it must
  say which script it applied and must not claim a run happened unless
  `run_script_block` returned queries or fetches.
- A script's https fetch is the operator's, not the agent's: on the canvas
  **Run** may fetch, through the app's egress guard (https only, public hosts,
  re-validated redirects, byte caps); an agent caller's fetch is refused.

Live updates. A page's tables, metrics, charts and finance blocks re-read when
the vault's data revision changes, so a row posted by the companion appears on the
open page without a reload. Page JSON itself is only re-read when the page loads.

## Tips and edge cases

- A page with no blocks saves and opens as an empty canvas. There is no required
  block.
- **Save** writes title and blocks together. If a block is invalid — a database
  that no longer exists, a date range whose start is after its end, a second date
  range — the save is refused with the engine's message and nothing is written.
- Removing a block and saving does not touch what it read. Deleting the page does
  not delete its databases or their rows.
- A bound table draws every row, with no row cap in the block itself; a table
  bound to a large database is a long page. The Dashboard's view language (filters,
  group-by, limits) is the instrument for summarised cards.
- A metric over an empty column shows **—**; a metric with **Convert to ZAR**
  shows its number and notes that ZAR conversion needs the Finance kit, because
  the engine converts, not the block.
- **Delete** on a page pin is the only page-delete path in the studio. Removing a
  page from the Pages list is not offered.
- Pages survive a restart as files. If the vault is in git, the page JSON moves
  with the vault; the SQLite data it reads is gitignored.

## Related

- [Dashboard](./06-dashboard.md) — the board a page can be pinned to, and the
  lock that governs it
- [Data and databases](./19-data-and-databases.md) — the tables and views the
  blocks read
- [Finance kit](./20-finance-kit.md) — the starter pages this page list contains
- [Documents](./22-documents.md) — the other knowledge surface, where markdown
  and wiki links are rendered
- [The Companion](./24-companion.md) — how the companion reaches pages and
  scripts
- [The Vault](./04-the-vault.md) — where page JSON sits in the folder layout
