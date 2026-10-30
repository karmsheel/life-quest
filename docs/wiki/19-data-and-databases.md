# Data and databases

The Data wing holds your structured records. Each domain owns one SQLite book in
the vault — `domains/<slug>/data/domain.sqlite` — and every database you create
lives in that one file. You define columns, type rows in a table, import a CSV
without trusting it, and link a Google Sheet, Notion database or operator URL
when a database should follow something outside the vault. The single idea:
your data is a file in your vault, and nothing posts until you accept it.

## Where it lives

**Home** wing → **Data** (route `/data`). It opens in the centre pane as a page.

- The top-bar lens filters the list: **Overview** shows every database in every
  live domain; a domain lens shows that domain's databases and lets you create
  into it without picking a domain each time.
- Clicking a database opens `/data/:slug/:dbId` — the database page.
- **Install Finance kit** and the **Capture** default-account selector also live
  on this page when the Financial domain is live; the kit itself is covered in
  [Finance kit](./20-finance-kit.md).

Back to [Wiki home](./index.md).

## What it is for

A domain database is the durable, queryable layer under the written parts of the
vault: the financial ledger is the shipped example, but any domain can have its
own tables. The Data page is the operator's place to create a table, add a
column, type a row, import a statement, and decide which imported rows become
real. The companion can read and propose changes to the same tables through its
tools, but the rules about what lands are the app's, not the model's.

## How to use it

### Create a database

1. Open **Data**. With **Overview** selected, the **New database** panel asks for
   the **Domain**; with a domain lens selected it uses that domain.
2. Type a **Name** and choose **New database**. The database is created empty
   with no columns and opens from the **Databases** list.
3. Open the database. In **Columns**, type a **New column name**, choose a type,
   and choose **Add column**:
   - `text`, `number`, `date`, `checkbox`, `file`
   - `select` — also give **Options (comma-separated)**
   - `relation` — also choose an existing database in the same domain from
     **Select database…**
4. In **Rows**, choose **Add row**, then type into each cell. A cell saves when
   it changes; a `file` cell stores the file in the vault and keeps its relative
   path in the cell. **Delete** removes a row.

### Import a file

1. In **Import**, choose the **Target database** from the current domain's
   databases.
2. Drop a `.csv` or `.pdf` on **Drop a .csv or .pdf file**, or click it to choose
   a file. The original is copied into the vault under `data/files/` before it is
   parsed, and columns are fingerprinted from their names.
3. If this shape of file has no mapping yet, the panel says **Map source
   columns, then submit. The mapping is a Decision; rows are not posted yet.**
   Map each source column to a database column — leave a source as **—** to ignore
   it — then choose **Propose mapping**. The mapping becomes a pending
   [Decision](./23-decisions.md); approve it in **Decisions**, then drop the same
   file again.
4. With a mapping in place, the file stages a batch (the page says
   `Staged <N> rows.`) and opens the database's **Ingest** section. The rows are
   not in the table yet.
5. Review the staged rows. A row already present by its `external_id` is marked
   **Duplicate**. You can edit a staged cell in place before accepting.
6. Choose **Accept** per row or **Accept all** for the batch. Only then do rows
   post into the real table. **Reject** / **Reject all** discard the batch's
   proposed rows and keep the batch out of the way.

A PDF needs its rows extracted before it can be imported; the Data page's
**Import** panel sends the file without an extraction, so a PDF dropped there
returns **Could not extract rows from PDF**. In this build CSV (a spreadsheet
export) is the reliable path from the Data page; a PDF is accepted by the
engine only when the caller supplies the extracted rows.

### Link an outside source

1. Open a database and use **Adapter**.
2. Choose **Google Sheet**, **Notion** or **Operator URL**, supply the binding id
   and token (or the URL), choose the source-of-truth mode, and choose **Link**:
   - **Linked canonical** — the remote is the book; the local rows are a replica.
   - **Local canonical (mirror)** — the local book is authoritative; the adapter
     pushes to the remote.
3. A linked database shows `Linked: <kind> · <mode> · last synced: <date or
   never>` with **Refresh** and **Unlink**. **Refresh** pulls now.
4. If both sides changed the same row, **Conflicts** appears on the database
   page; resolve each with **Keep local**, **Keep remote** or **Skip**.
5. The Data list's **Refresh linked** pulls every linked database in the current
   lens's domain.

### Export and restore the book

1. Open **Settings → Vault → Books**.
2. **Export books** writes a git-portable JSON snapshot of the domain's databases
   and rows to `domains/<slug>/data/books.json`.
3. To restore, tick **Restore replaces the live SQLite book for this domain from
   books.json, then choose Restore books**. The app validates the whole file
   first, backs up the current SQLite to `domain.sqlite.bak`, and only then
   replaces the live book.

## The screen

Data page (`/data`)

| Part | What it does |
|---|---|
| Header | Eyebrow **Data**, title **Databases**, one line of description. |
| **Databases** | The list for the active lens. Each row shows the name, `N columns · Local/Linked/Mirror · updated date`, the domain name on **Overview**, and opens the database. Empty: **No databases yet.** |
| **Refresh linked** | Syncs linked databases in the current domain. |
| **New database** | Name field, domain select on **Overview**, **New database**. |
| **Import** | Target-database select, drop zone, mapping form when a mapping is needed. |
| **Finance** | **Install Finance kit** — shown only when Financial is live and the kit is not installed. |
| **Capture** | **Default capture account** — shown once the kit is installed. **Ask each time** or one of the transactional accounts. |
| **Exchange rate** | The finance rate panel, described on [Finance kit](./20-finance-kit.md). |

Database page (`/data/:slug/:dbId`)

| Part | What it does |
|---|---|
| Header | **← Back to Data**, database name, `Domain · slug`. |
| **Adapter** | Link form, linked state, **Refresh**, **Unlink**, and **Conflicts**. |
| **Columns** | **New column name**, the seven types, options or relation target, **Add column**. |
| **Rows** | The table: every column, then **Actions**. **Add row**; **Delete** per row. |
| **Ingest** | One block per batch with a fingerprint prefix and source kind; proposed rows editable, **Duplicate** flag, **Accept** / **Reject**, **Accept all** / **Reject all**. Empty: **No ingest rows.** |

## Rules and behaviour

The book lives in the vault. The law is that domain databases live in the
vault folder and the product must never require a hosted database; a new or
changed ingest mapping goes through Decisions; batch rows post only after the
operator accepts; conversational capture refuses without an amount and an
account; JSON restore needs an explicit confirmed action. It is restated in
[LAWS/DATABASES.md](../../LAWS/DATABASES.md).

| What | Where |
|---|---|
| Live rows (all databases in the domain) | `domains/<slug>/data/domain.sqlite` |
| Database list, columns, source-of-truth mode, adapter binding, installed kits | `domains/<slug>/data/registry.json` |
| Git-portable JSON export | `domains/<slug>/data/books.json` |
| Original imported files | `domains/<slug>/data/files/<fileId>/<name>` |
| Ingest mappings, one JSON per mapping | `domains/<slug>/data/mappings/<mappingId>.json` |
| Adapter sync state | `domains/<slug>/data/sync-index.json`, `sync-queue.json`, `conflicts.json` |
| Views | `domains/<slug>/views/<viewId>.json` |
| Disposable analytics cache | `.lifequest/cache/` |

The SQLite file (plus its `-wal` / `-shm` companions) and the cache are appended
to the vault's `.gitignore` when the vault is a git repository. JSON is the
git-portable form; the SQLite file is the live book.

Columns and validation. The seven column types are `text`, `number`, `date`,
`select`, `checkbox`, `relation`, `file`. A `select` needs at least one option; a
`relation` must name an existing database in the same domain. `number` cells
reject values that are not finite numbers with `Column <name> expects a number`.
Unknown column ids in a row write are refused. A `file` cell stores a file up to
25 MB and refuses active content (HTML, SVG, scripts, executables).

Ingest is staged, always. A batch starts `awaiting-mapping` with no mapping,
or `staged` when a mapping matched its fingerprint. Its rows start `proposed`. A
batch is `accepted` or `rejected` only when no proposed rows remain. Accepting
posts the rows through the ordinary row writer, so a posted row is the same kind
of row as one typed by hand, with `external_id` filled when the file carried one.
The mapping is a Decision even when you propose it yourself from this page.

The fingerprint. A mapping is keyed by a SHA-256 of the column names, trimmed,
lower-cased and whitespace-collapsed. Rename a source column and it is a new
mapping, which is another Decision.

Sync and conflicts. **Linked canonical** means the remote is the truth; local
edits are written up and remote changes pulled down. **Local canonical (mirror)**
means the local book is the truth and the adapter pushes to it. If a pull finds
both sides changed, the row is recorded as a conflict rather than silently
overwritten, and the database page asks per conflict. With no network, linked
writes queue in `sync-queue.json` instead of failing the studio.

Views are cards, not a table screen. A saved view is a live query spec
stored as JSON and drawn as a Dashboard card or a page block. The available
presentations are `table`, `bar`, `line`, `metric` and `list` — there is no
kanban or calendar view. You can change a card's drawing with the presentation
buttons on the card itself; creating or rewriting a view is done by the
companion. On an unlocked Dashboard board its change lands at once; on a locked
board it files one pending Decision. See [Pages](./21-pages.md) for view blocks
inside a page.

**SQL.** The studio has no SQL console, and no Data screen accepts a query. The
engine's own reads are parameterized, and the only operator-facing SQL is a
**script block** on a page: a read-only `SELECT` (or a `{sql, params}` list)
against the domain's SQLite. An agent never gets a raw SQL socket; it works
through the database tools. Script blocks are described in
[Pages](./21-pages.md).

Linked-source links are operator-only. An agent cannot link or unlink an
adapter and cannot read the secret; adapters are a bridge to a remote book, not
an agent capability.

What the companion can do. Read tools (no approval): `list_databases`,
`get_database`, `list_rows`, `get_row`, `list_decisions`, dashboard reads, view
previews. Write tools file a Decision for the operator: `upsert_row`,
`insert_rows`, `delete_row`, `create_database`, `add_column`, and mapping
changes. A create in a database on the operator's insert allowlist may post
without a Decision; an update always waits. The reply names the Decision, and
the companion must not claim rows landed before `posted` is true. Views saved to
an unlocked Dashboard board are applied directly; on a locked board they wait in
Decisions. Conversational capture is the other direct write, and only when the
amount and account are clear — see [Finance kit](./20-finance-kit.md).

JSON restore is deliberate. `books.json` is not watched or auto-imported. A
restore validates schema version, database ids, column types, timestamps and
every cell before it touches anything, then backs the SQLite file up and
replaces it. The registry merge keeps databases that are not in the export.

## Tips and edge cases

- A database has no rename or delete control in the studio. The list and the
  column set are managed through the app and the companion; the SQLite file is
  not meant to be edited with an external SQLite browser while the app is open.
- Column deletion is not offered; new columns append to the right. If you need a
  different column set, create a new database and move rows through the
  companion.
- A dropped PDF is not extracted by this page. If the import says **Could not
  extract rows from PDF**, export the statement as a CSV and drop that instead;
  the Data page does not run PDF extraction.
- Accepting rows is per batch. An accepted batch leaves the **Ingest** section;
  only non-accepted batches are listed. The source file stays under `data/files/`
  as provenance.
- Duplicate flags are advice, not a block: accepting a row marked **Duplicate**
  posts it, and the table will then hold both.
- The import target list only offers databases in the selected domain. Change
  the lens or pick another domain before importing into another domain's table.
- **Refresh linked** on **Overview** has no single domain to sync; use the
  database page's **Refresh** there.
- Restoring `books.json` only adds databases that are missing from the registry
  and overwrites the live SQLite rows with the exported ones. It is not a merge
  of rows; anything typed after the export and absent from it is gone from the
  live book, which is why the confirmation checkbox and the `.bak` backup exist.
- `domain.sqlite` is not a file to commit. JSON (`registry.json`, `books.json`,
  `mappings/`, `views/`) is what a git-backed vault should carry.

## Related

- [Finance kit](./20-finance-kit.md) — the shipped ledgers, receipts and FX that
  ride on this machinery
- [Pages](./21-pages.md) — page canvases, view blocks and script blocks that read
  a database
- [Decisions](./23-decisions.md) — where an agent's row, column or mapping change
  waits
- [The Vault](./04-the-vault.md) — the folder layout these files sit in
- [Settings](./28-settings.md) — **Books** export/restore and the insert
  allowlist
- [The Companion](./24-companion.md) — how the agent reaches the tables
