# Data and databases

The Data page holds your structured records. Each area owns one SQLite book in the vault —
`domains/<slug>/data/domain.sqlite` — and every database you create in that area lives in
that one file. You define columns, type rows in a table, import a CSV without trusting it,
and link a Google Sheet, Notion database or operator URL when a database should follow
something outside the vault. The single idea: your data is a file in your vault, and nothing
posts from an import until you accept it.

## Where it lives

**Home** wing → **Data** (route `/data`). It opens in the centre pane as a page, with the
grey eyebrow **Data** and the title **Databases**.

- The area lens in the window title bar filters the list: **Life** shows every database in
  every live area; an area lens shows that area's databases.
- **New database** creates into the area lens when one is active. On **Life** it lands in the
  vault's base area, **Life**, with no area selector. A legacy vault with no base area keeps
  the area selector it always had.
- Clicking a database opens `/data/:slug/:dbId` — the database page.
- **Install Finance kit**, the **Capture** default-account selector and the **Exchange rate**
  panel also live on this page when the **Finance** area is live; the kit itself is covered in
  [Finance kit](./20-finance-kit.md).

Back to [Wiki home](./index.md).

## What it is for

An area database is the durable, queryable layer under the written parts of the vault: the
financial ledger is the shipped example, but any unlocked area can have its own tables. The
Data page is the operator's place to create a table, add a column, type a row, import a
statement, and decide which imported rows become real. The companion can read and write the
same tables through its tools; the rules about what lands are the app's, not the model's.

## How to use it

### Create a database

1. Open **Data**. With **Life** selected, the **New database** panel asks only for a **Name**
   and creates into the base area; an area lens creates into that area.
2. Type a **Name** and choose **New database**. The database is created empty with no columns
   and opens from the **Databases** list.
3. Open the database. In **Columns**, type a **New column name**, choose a type, and choose
   **Add column**:
   - `text`, `number`, `date`, `checkbox`, `file`
   - `select` — also give **Options (comma-separated)**
   - `relation` — also choose an existing database in the same area from **Select database…**
4. In **Rows**, choose **Add row**, then type into each cell. A cell saves when it changes; a
   `file` cell stores the file in the vault and keeps its relative path in the cell.
   **Delete** removes a row.

### Import a file

1. In **Import**, choose the **Target database** from the current area's databases.
2. Drop a `.csv` or `.pdf` on **Drop a .csv or .pdf file**, or click it to choose a file. The
   original is copied into the vault under `data/files/` before it is parsed, and columns are
   fingerprinted from their names.
3. If this shape of file has no mapping yet, the panel says "Map each source column to a
   database column." Map each source column — leave a source as **—** to ignore it — then
   choose **Propose mapping**. The mapping becomes a pending [Decision](./23-decisions.md)
   and the page says "Mapping proposed as a Decision. Approve it, then drop the file again
   to stage rows." Approve it in **Decisions**, then drop the same file again.
4. With a mapping in place, the file stages a batch (the page says `Staged <N> rows.`) and
   opens the database's **Ingest** section. The rows are not in the table yet.
5. Review the staged rows. A row already present by its `external_id` is marked **Duplicate**.
   You can edit a staged cell in place before accepting.
6. Choose **Accept** per row or **Accept all** for the batch. Only then do rows post into the
   real table. **Reject** / **Reject all** discard the batch's proposed rows and keep the
   batch out of the way.

A PDF needs its rows extracted before it can be imported; the Data page's **Import** panel
sends the file without an extraction, so a PDF dropped there returns **Could not extract rows
from PDF**. In this build CSV (a spreadsheet export) is the reliable path from the Data page;
a PDF is accepted by the engine only when the caller supplies the extracted rows.

### Link an outside source

1. Open a database and use **Adapter**.
2. Choose **Google Sheet**, **Notion** or **Operator URL**, supply the binding id and token
   (or the URL), choose the source-of-truth mode, and choose **Link**:
   - **Linked canonical** — the remote is the book; the local rows are a replica.
   - **Local canonical (mirror)** — the local book is authoritative; the adapter pushes to
     the remote.
3. A linked database shows `Linked: <kind> · <mode> · last synced: <date or never>` with
   **Refresh** and **Unlink**. **Refresh** pulls now.
4. If both sides changed the same row, **Conflicts** appears on the database page; resolve
   each with **Keep local**, **Keep remote** or **Skip**.
5. The Data list's **Refresh linked** pulls linked databases in the active area.

### Export and restore the book

1. Open **Settings** → **Vault** → **Books**.
2. **Export books** writes a git-portable JSON snapshot of the area's databases and rows to
   `domains/<slug>/data/books.json`.
3. To restore, switch on **Allow restore** for that area, then choose **Restore books**. The
   app validates the whole file first, backs up the current SQLite to `domain.sqlite.bak`, and
   only then replaces the live book. Restoring disarms the switch again when it completes.

## The screen

Data page (`/data`)

| Part | What it does |
|---|---|
| Header | Eyebrow **Data**, title **Databases**, lead "Area books in this vault. Create one here, or import rows from a file." |
| **Databases** | The list for the active lens, with a count. Each row shows the name, `N columns · Local/Linked/Mirror · updated date`, the area name under **Life**, and opens the database. Empty: **No databases yet.** |
| **Refresh linked** | Syncs linked databases in the active area. |
| **New database** | **Name** field (placeholder **New database name**), **Area** select (only in a legacy vault with no base area), **New database**. |
| **Import** | **Target database** select, **Drop a .csv or .pdf file** drop zone, the mapping form when a mapping is needed. |
| **Finance** | **Install Finance kit**, shown only when the **Finance** area is live and the kit is not installed. |
| **Capture** | **Default capture account** — shown once the kit is installed. **Ask each time** or one of the transactional accounts. |
| **Exchange rate** | The finance rate panel, described on [Finance kit](./20-finance-kit.md). |

Database page (`/data/:slug/:dbId`)

| Part | What it does |
|---|---|
| Header | **← Back to Data**, database name, `Area name · slug`. |
| **Adapter** | Link form, linked state, **Refresh**, **Unlink**, and **Conflicts**. |
| **Columns** | **New column name**, the seven types, options or relation target, **Add column**. |
| **Rows** | The table: every column, then **Actions**. **Add row**; **Delete** per row. |
| **Ingest** | One block per batch with a fingerprint prefix and source kind; proposed rows editable, **Duplicate** column, **Accept** / **Reject**, **Accept all** / **Reject all**. Empty: **No ingest rows.** |

## Rules and behaviour

The book lives in the vault. The law is that area databases live in the vault folder and the
product must never require a hosted database; adding data — a new database, a new row, a batch
of new rows — is the operator's agreement in chat and applies at once, while changing or
deleting data that already exists waits in Decisions, and adding a column to an existing
database is a schema change that waits too; a new or changed ingest mapping goes through
Decisions; batch rows post only after the operator accepts;
conversational capture refuses without an amount and an account; JSON restore needs an
explicit confirmed action. It is restated in [LAWS/DATABASES.md](../../LAWS/DATABASES.md).

| What | Where |
|---|---|
| Live rows (all databases in the area) | `domains/<slug>/data/domain.sqlite` |
| Database list, columns, source-of-truth mode, adapter binding, installed kits | `domains/<slug>/data/registry.json` |
| Git-portable JSON export | `domains/<slug>/data/books.json` |
| Original imported files | `domains/<slug>/data/files/<fileId>/<name>` |
| Ingest mappings, one JSON per mapping | `domains/<slug>/data/mappings/<mappingId>.json` |
| Adapter sync state | `domains/<slug>/data/sync-index.json`, `sync-queue.json`, `conflicts.json` |
| Views | `domains/<slug>/views/<viewId>.json` |
| Disposable analytics cache | `.lifequest/cache/` |

The SQLite file (plus its `-wal` / `-shm` companions) and the cache are appended to the
vault's `.gitignore` when the vault is a git repository. JSON is the git-portable form; the
SQLite file is the live book. The area slug keeps its historical spelling: the Finance area is
**Finance** at `domains/financial/`.

### Locked areas

A locked area is absent from everything that reads the vault: its databases are not listed,
its folders are not offered, and the companion cannot see or name it. Unlock the area first —
[Areas](./05-areas.md), or the first-run interview in [Getting started](./02-getting-started.md).
The base area **Life** is always unlocked and owns records that name no narrower area.

### Adding data from chat is direct; changing it waits

This is the 0.2.1 split, and it is the one rule that matters most on this page:

- Writes that apply immediately after the chat confirmation. `create_database` (with its
  columns, validated first), a new row through `upsert_row` without an `id`, and a batch
  of new rows through `insert_rows` (at most 200, no row ids) are written at once. The
  operator's agreement in the chat is the confirmation; there is no Decision card afterwards,
  so each write is logged instead: `database.created`, `database.row.created` or
  `database.rows.created`. The reply may claim a database or row exists only when the result
  said `applied: true` / `posted: true`.
- Writes that still wait in Decisions. `upsert_row` with an `id` (an update),
  `delete_row`, and `add_column` file one pending Decision and write nothing until you approve
  it. A rejected proposal must not be silently retried.
- A `create_database` schema is validated before anything is written, and `insert_rows`
  validates every row and applies the batch in one transaction — a bad row is named in the
  error and nothing lands.
- Paired agents follow the same split inside their granted areas.

The old `autoApproveInserts` allowlist is retired. Vaults that still carry the key open
normally and the value is ignored rather than deleted; nothing reads it for a decision.
Settings → Hermes describes the behaviour instead, in a **Database writes** row whose text
says a new database, row or batch is written when you agree to it in chat and that changing
or deleting existing data still waits in Decisions.

### Decisions are one global shelf

The Decisions inbox and the rail's badge are **not** filtered by the area lens: a pending
Decision filed in any area is visible and counted, whichever lens you are standing in. The
lens-scoped view of decisions is the Dashboard's **Pending decisions** card, not the inbox.
Approve, reject and the inbox's edit path are covered on [Decisions](./23-decisions.md).

### Columns and validation

The seven column types are `text`, `number`, `date`, `select`, `checkbox`, `relation`, `file`.
A `select` needs at least one option; a `relation` must name an existing database in the same
area. `number` cells reject values that are not finite numbers with `Column <name> expects a
number`. Unknown column ids in a row write are refused. A `file` cell stores a file up to
25 MB and refuses active content (HTML, SVG, scripts, executables).

### Ingest is staged, always

A batch starts `awaiting-mapping` with no mapping, or `staged` when a mapping matched its
fingerprint. Its rows start `proposed`. A batch is `accepted` or `rejected` only when no
proposed rows remain. Accepting posts the rows through the ordinary row writer, so a posted
row is the same kind of row as one typed by hand, with `external_id` filled when the file
carried one. The mapping is a Decision even when you propose it yourself from this page.

The fingerprint is a SHA-256 of the column names, trimmed, lower-cased and whitespace-
collapsed. Rename a source column and it is a new mapping, which is another Decision.

### Sync and conflicts

**Linked canonical** means the remote is the truth; local edits are written up and remote
changes pulled down. **Local canonical (mirror)** means the local book is the truth and the
adapter pushes to it. If a pull finds both sides changed, the row is recorded as a conflict
rather than silently overwritten, and the database page asks per conflict. With no network,
linked writes queue in `sync-queue.json` instead of failing the studio.

Linked-source links are operator-only. An agent cannot link or unlink an adapter and cannot
read the secret; adapters are a bridge to a remote book, not an agent capability.

### Views, SQL and the companion's reads

Views are cards, not a table screen. A saved view is a live query spec stored as JSON and
drawn as a Dashboard card or a page block. The available presentations are `table`, `bar`,
`line`, `metric` and `list` — there is no kanban or calendar view. You can change a card's
drawing with the presentation buttons on the card itself; creating or rewriting a view is done
by the companion. On an unlocked Dashboard board its change lands at once; on a locked board
it files one pending Decision. See [Pages](./21-pages.md) for view blocks inside a page.

The studio has no SQL console, and no Data screen accepts a query. The engine's own reads are
parameterized, and the only operator-facing SQL is a **script block** on a page: a read-only
`SELECT` (or a `{sql, params}` list) against the area's SQLite. An agent never gets a raw SQL
socket; it works through the database tools.

The companion's read tools need no approval: `list_databases`, `get_database`, `list_rows`,
`get_row`, `list_decisions`, dashboard reads and view previews. Its write tools follow the
split above. Views saved to an unlocked Dashboard board are applied directly; on a locked
board they wait in Decisions. Conversational capture is the other direct write, and only when
the amount and account are clear — see [Finance kit](./20-finance-kit.md).

### JSON restore is deliberate

`books.json` is not watched or auto-imported. A restore validates schema version, database
ids, column types, timestamps and every cell before it touches anything, then backs the
SQLite file up and replaces it. The registry merge keeps databases that are not in the
export.

## Tips and edge cases

- A database has no rename or delete control in the studio. The list and the column set are
  managed through the app and the companion; the SQLite file is not meant to be edited with an
  external SQLite browser while the app is open.
- Column deletion is not offered; new columns append to the right. If you need a different
  column set, create a new database and move rows through the companion.
- A dropped PDF is not extracted by this page. If the import says **Could not extract rows
  from PDF**, export the statement as a CSV and drop that instead.
- Accepting rows is per batch. An accepted batch leaves the **Ingest** section; only
  non-accepted batches are listed. The source file stays under `data/files/` as provenance.
- Duplicate flags are advice, not a block: accepting a row marked **Duplicate** posts it, and
  the table will then hold both.
- The import target list only offers databases in the selected area. Change the lens before
  importing into another area's table.
- With **Life** showing every area, there is no single area for **Refresh linked** to sync;
  open the database and use its **Refresh**.
- Restoring `books.json` overwrites the live SQLite rows with the exported ones. It is not a
  merge of rows; anything typed after the export and absent from it is gone from the live
  book, which is why the **Allow restore** switch and the `.bak` backup exist.
- `domain.sqlite` is not a file to commit. JSON (`registry.json`, `books.json`, `mappings/`,
  `views/`) is what a git-backed vault should carry.
- A vault written before areas had locks keeps every area it ever had: an absent `unlockedAt`
  means unlocked.

## Related

- [Finance kit](./20-finance-kit.md) — the shipped ledgers, receipts and FX that ride on this
  machinery
- [Pages](./21-pages.md) — page canvases, view blocks and script blocks that read a database
- [Decisions](./23-decisions.md) — the global inbox, and where an update, delete, column or
  mapping change waits
- [Areas](./05-areas.md) — Life, locked areas and the lens that filters this page
- [The Vault](./04-the-vault.md) — the folder layout these files sit in
- [The Companion](./24-companion.md) — how the agent reaches the tables
