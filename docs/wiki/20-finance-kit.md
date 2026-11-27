# Finance kit

The Finance kit is the first optional kit: a schema, a set of meaning, and six
starter pages installed into the **Finance** area in one step. It
gives you a household ledger — accounts, categories, transactions, budgets,
recurring items, holdings, assumption sets — plus cash in / cash out / net cash
flow figures, spend, budget, net-worth and scenario pages, and a captured
purchase can be logged from chat or from a photo
of the receipt. The kit is not seeded into a new vault: the Finance area ships
locked like the other four, and the kit is installed into it once it is unlocked.

## Where it lives

- **Install**: **Home** wing → **Dashboard** or **Data**, right rail → **Finance**
  card → **Install Finance kit**. Every finance page block also offers the same
  button when the kit is missing.
- Ledgers: Home → **Data** (`/data`), **Life** or **Finance** lens; the seven
  databases open at `/data/financial/<databaseId>`.
- Starter pages: Home → **Pages** (`/pages`), **Finance** lens; each page opens
  at `/pages/financial/<pageId>`.
- Rate and capture account: Home → **Data**, right rail — **Exchange rate**
  and **Capture** panels.
- **Receipts**: the chat dock composer's control row, at the bottom left, beside
  the add control.
- **Restore**: **Settings** → **Vault** → **Books**.

Back to [Wiki home](./index.md).

## What it is for

The kit turns the Finance area from a written life area into a working book:
what you have, what you spend it on, what you planned, what you are worth, and
what the next year looks like under assumptions you can compare. It is installed
rather than assumed, so a vault can use plain databases without inheriting a
ledger it did not ask for. The house currency is ZAR; USD accounts are converted
at one operator-visible rate.

## How to use it

### Install the kit

1. Make sure the **Finance** area is unlocked. A new vault seeds it locked and
   invisible; unlock it in **Settings** → **Areas** with **Unlock another area** (or
   let the first-run interview open it), then come back. The card only appears
   when Finance is live, the kit is not already installed, and the lens is
   **Life** or **Finance**.
2. Choose **Install Finance kit** on the Dashboard card, the Data rail, or a
   finance page block. There is no second confirmation: the card itself is the
   offer.
3. The install creates seven databases in `domains/financial/data/`, the pages
   under `domains/financial/pages/`, two assumption sets, and pins on the
   **Finance** board and the **Life** board. The databases start empty; the two
   assumption sets are named **Scenario 1** and **Scenario 2**.
4. The engine also has an agent-proposed install path: an agent's request files a
   pending [Decision](./23-decisions.md) labelled **Finance kit**, and approving
   it performs the same install. In this build the companion has no install
   tool, so the click on this card is how the kit is installed.

The install is idempotent: running it again on an installed kit reports that it
is already installed and writes nothing. It refuses a missing, locked or archived
**Finance** area.

### Fill the book

Open **Data** with the **Finance** lens. The kit's databases have fixed ids and
columns:

| Database | Columns |
|---|---|
| **Accounts** | `name`, `type` (checking, credit, cash, brokerage, property, other), `currency` (ZAR, USD), `opening_balance`, `opening_as_of`, `apr` |
| **Categories** | `name` |
| **Transactions** | `date`, `amount`, `account` (relation), `category` (relation), `payee`, `notes`, `source_file` (file), `provenance`, `external_id`, `transfer_id` |
| **Budgets** | `period` (`YYYY-MM` or `YYYY`), `category` (relation), `amount`, `currency` |
| **Recurring** | `name`, `amount`, `currency`, `cadence` (weekly, monthly, yearly), `next_date`, `account`, `category`, `kind` (inflow, outflow) |
| **Holdings** | `name`, `account`, `quantity`, `price`, `market_value`, `price_currency`, `as_of`, `expected_return` |
| **Assumption sets** | `name`, `horizon_months`, `deltas` |

Add rows on each database page. Expenses are negative transaction amounts;
income is positive. A transfer is two rows that share `transfer_id`, and budget
spend ignores both. `opening_balance` plus the transactions give an account's
book at a date; holdings add their market value to net worth.

### Choose the default capture account

In **Data**, the **Capture** panel appears once the kit is installed:

- **Ask each time** (the default) — a chat capture asks which account when more
  than one could fit.
- One of the transactional accounts — checking, credit, cash or other; that
  account is used unless the sentence names another.

Brokerage and property accounts are not offered: they are not where spending
happens.

### Set the USD→ZAR rate

1. In **Data**, find **Exchange rate**.
2. **Source URL** is the endpoint, **Path to the rate** is the dot path inside its
   JSON answer (default `rates.ZAR`), and **Path to the source's date** is
   optional.
3. Choose **Save and read now** to store the source and read it immediately, or
   **Refresh now** to read the stored source again. **Use the default** restores
   the shipped source.
4. The panel shows the **Rate** (`not read yet` until the first successful read),
   **Last read**, and **Last error**. The hint says it: the rate is read once an
   hour and on opening the vault.

### Log a purchase from chat

1. In the chat dock, type what happened — "Bought food for R85 today" — and send.
2. Or attach a photo: choose the plus (**Attach a file**) in the composer's
   control row at the bottom left, drop one image on the form, or paste one into
   the field — the same gesture attaches any file. The picture waits as a chip
   above the field, and a JPEG or PNG chip carries **Use as receipt** while the
   vault has the Finance kit installed and the Financial area live. Press it and
   the picture moves into the receipt chip in the control row, showing its file
   name and size; **Remove receipt** clears it. One receipt rides one turn;
   promoting a second picture replaces the first.
3. The companion reads the turn, including the image when one is attached, and
   calls its capture tool. A posted capture answers with a receipt line naming
   the amount, currency, date, account, category and payee — for example
   `-85 ZAR on 2026-10-29 • Cheque • Food • Woolies`. The row lands in
   **Transactions** with `provenance` set to `chat:<thread>`.
4. If the amount or account is not clear, nothing posts. The tool asks
   **What amount?** or `Which ZAR account? …` and the companion relays it. You
   answer in the thread; the next capture posts. "Actually make it R80" is a
   correction of the same row, not a second purchase.
5. To undo the thread's last capture, ask the companion to undo it. The row is
   deleted; a receipt image it cited stays in the vault.

The payee is the merchant or item only. A date, a known account name, a category
word or filler such as **spent on** is stripped, so `9/28/26 spent on petrol at
Engen` posts with payee **Petrol at Engen**. Your sentence is kept verbatim in
`notes`, so the words you typed are never lost. A leading date in the sentence
sets the transaction date: `9/28/26` and `28/09/2026` both read 2026-09-28,
`03/04/2026` is read day/month, and an explicit `YYYY-MM-DD` still wins.

A category named in the sentence still wins. Otherwise a keyword rule picks a
category that exists in the vault: **petrol**, **fuel**, **diesel**, **garage**,
**Engen**, **Shell** or **Sasol** → **Fuel**; **meat**, **butcher** or **steak** →
**Meat**; **coffee** → **Food**. A rule only matches a category that exists —
the name match is case-insensitive, and **Food** finds **Food & Drink** by its
first word — so a book with no **Fuel** category leaves that row
**Uncategorized**.

### Clean payees

A vault written before payee hygiene holds the old rows: the payee still carries
the date, the account name, the category words and the filler from the sentence.
Opening that vault normalises the history once. Each polluted payee becomes the
merchant or item, and a row that had no `notes` keeps its original wording
there, so nothing the operator typed is destroyed. The repair writes no
Decisions: it is an app-side migration, not a shelf of approvals. It records one
**Normalised payees** line in the [Log](./26-log.md) with the scanned and changed
counts, and the next open finds the work done and writes nothing.

### Work the plan surfaces

The starter pages are pinned on the **Finance** board and the **Life** board:

- **Ledger** — a markdown intro and the Transactions table.
- **Spend** — the total spent, and a bar chart of spending by date. (The review
  figures use the ledger's gross vocabulary above, not this page's block.)
- **Budget** — **Budget vs actual**: one row per budget with Category, Period,
  Planned, Spent and Remaining. Empty: **No budgets yet.**
- **Net worth** — the total in ZAR, plus the ZAR and USD components. Until a rate
  exists it says **ZAR conversion requires an FX rate**. Empty: **No accounts or
  holdings yet.**
- **Scenario 1** and **Scenario 2** — a written scenario plus **Scenario compare**.
  The block picks an assumption set and optionally a second one under **Compare
  with** (**Live only** when none), and draws month by month: Live ZAR, Primary
  ZAR, Secondary ZAR.

Edit an assumption set as a row in **Assumption sets**; `deltas` is a JSON array
of changes. The engine also has an **Assumptions** Decision path for an agent's
save of an assumption set, but the editing surface in this build is the row.

### Export and restore

**Settings** → **Vault** → **Books** exports the area's databases to
`domains/<slug>/data/books.json` and restores from it with an explicit
confirmation. The mechanics — validation, backup, registry merge — are covered in
[Data and databases](./19-data-and-databases.md).

## The screen

| Surface | What it is |
|---|---|
| Dashboard **Finance** card | The install offer, with **Install Finance kit**. |
| Data rail **Finance** card | The same install offer; disappears once installed. |
| Data **Capture** panel | **Default capture account** — **Ask each time** or an account. |
| Data **Exchange rate** panel | The rate source, the rate in force, the last read and the last error. |
| Finance databases | Ordinary database pages; no separate finance screen. |
| Starter pages | Ordinary page canvases with finance blocks: ledger table, spend metric and chart, budget vs actual, net worth, scenario compare. |
| Chat composer | The plus (**Attach a file**) in the control row at the bottom left; **Use as receipt** on a JPEG or PNG chip while the kit and Financial area are live; the receipt chip (name, size, **Remove receipt**) in the control row beside the plus; the posted receipt line in the reply. |

## Rules and behaviour

The kit installs, it is not seeded. A new vault has the base area **Life** and
seven locked areas — Health, Mind, Finance, Business, Relationships, Spiritual,
Career — and no finance tables. The kit is a write into the Finance area and the operator
chooses it. The law that matters is in [LAWS/DATABASES.md](../../LAWS/DATABASES.md):
area databases live in the vault, a kit install proposed by an agent goes
through Decisions, ingest rows wait for acceptance, conversational capture must
refuse without an amount and account, capture must name what it logged, and JSON
restore requires an explicit confirmed action.

What the install writes.

| Item | Location |
|---|---|
| Seven databases and their columns | `domains/financial/data/registry.json` |
| `installedKits: ["finance"]` and the finance settings | the same registry |
| Live rows | `domains/financial/data/domain.sqlite` |
| Six starter pages | `domains/financial/pages/<pageId>.json` |
| Two assumption sets | rows in the Assumption sets database |
| Three metric definitions: Cash in, Cash out, Net cash flow | `domains/financial/metrics/<id>.json` |
| Finance board pins | `domains/financial/pins.json` |
| Life board pins | `.lifequest/overview-pins.json` |
| `.gitignore` lines for the SQLite file and cache | vault root |

Install is operator-direct or a Decision. The operator's click installs. The
engine's agent path files a **Finance kit** Decision and writes nothing until it
is approved; the companion's tool surface in this build does not expose that
path, so the operator installs from the card.

Conversational capture needs no Decision. When the amount and the account are
unambiguous, the companion posts the row directly and names what it logged. When
either is ambiguous it asks and posts nothing. The operator's own edits in
**Data** are direct too.

Every other agent write follows the app-wide database split. A new database and
new rows — `create_database`, `insert_rows`, `upsert_row` without an id — are
written at once after you agree to them in the chat, and are logged as
`database.created`, `database.row.created` or `database.rows.created`. Changing
what the ledger already holds still waits: `upsert_row` with an id, `delete_row`
and `add_column` file a pending Decision and write nothing until you approve it.
The old insert allowlist is retired; Settings → Hermes explains the split in its
**Database writes** row.

Decisions is one global shelf: a Finance kit or ledger proposal is visible and
counted in the inbox and on the rail badge whatever area lens you are standing
in. The lens-scoped view is the Dashboard's **Pending decisions** card. See
[Decisions](./23-decisions.md).

How a capture is resolved. The amount may be written `R85`, `ZAR 85`,
`$20`, `USD 20`, with a leading minus for a spend. The date is an explicit
`YYYY-MM-DD`, a leading date in the sentence (`9/28/26`, `28/09/2026`,
`28 Sep 2026`; an ambiguous day/month reads day/month), **yesterday**, or today.
The payee is the merchant or item, and the sentence is kept verbatim in `notes`.
Income words such as **received**, **income**, **salary**, **refund** or **got
paid** make the value positive; otherwise it is a spend and negative. The
category is one named in the sentence; otherwise the keyword rules pick an
existing category, and **Uncategorized** is created if the book has none. The
account is chosen in this order: one named in the sentence, the default capture
account, the sole transactional account in that currency; otherwise it asks. The
provenance is the chat thread, which is what undo and correct key on.

Receipt images. Attach the picture with the composer's plus (**Attach a file**) —
the same control takes any file — then press **Use as receipt** on its chip. That
press is what makes the picture a receipt: its original goes into
`domains/financial/data/files/<fileId>/<name>` exactly as it arrived, and the row
cites that vault-relative path in `source_file`. A receipt is one JPEG or PNG, up
to 25 MB, by picker, drag-and-drop or a pasted screenshot, sniffed from the bytes
rather than trusted from the file name. The copy the agent sees is a re-encoded
JPEG at the 1600 px / quality 80 rung, stepping down to 1600/60 and 1200/55 until
it is at or under 2 MB; if none fits, the press is refused with **This receipt
could not be prepared for the agent.** and nothing is written. The offer cannot
foresee the canvas, so a picture over 12,000 px a side or 40 MP is refused when
you press, with **That picture has more pixels than a receipt can hold.** A chip
that is not a JPEG or PNG carries no **Use as receipt**, and neither does any
picture while the Finance kit is missing or the Financial area is archived, so
the offer is absent rather than a dead-end press. A file over 25 MB is refused
when you attach it, with **That file is larger than 25 MB.** The agent may only
cite a path that already exists in the finance file store; a made-up or escaping
path refuses the whole capture. Undo deletes the row and leaves the file; correct
preserves `source_file`.

The FX rate. Only USD→ZAR exists; the house currency is ZAR and USD amounts
are converted at the stored rate. The default source is
`https://open.er-api.com/v6/latest/USD` with `rates.ZAR`. A read must answer a
positive finite number; anything else keeps the last good rate and records the
error rather than writing nonsense. A refresh is refused when the kit is not
installed or the Finance area is locked or archived. The rate is read on vault open and hourly
while the app is running. Until a rate exists, USD figures are left unconverted
and the cards say so.

### Review figures: gross cash in, gross cash out, net

The Finance page of a review carries three figures, written by the app on Start
from the three metric definitions below (the old single "Spending this period"
fence in the review rules is gone). All three read the Transactions database
over the review period and the period before it:

- **Cash in** — the sum of the positive amounts. This is gross income.
- **Cash out** — the sum of the negative amounts, printed as the positive size of
  what went out. The figure's display flips the sign; the ledger rows are never
  changed.
- **Net cash flow** — the sum of every amount, and its heading says "transfers
  included", because that is what net means.

A **transfer** is two rows sharing a `transfer_id` — money moving between your own
accounts, not income and not spend. Cash in and Cash out exclude both transfer
legs, so a R1,000 move between accounts neither inflates income nor spend; Net
includes them and cancels to zero. The exclusion is the general
`is-not-set` filter (a cell that was never filled), which is why it is part of the
metrics engine rather than a finance special case.

The three definitions are shipped with the kit and stored as one JSON per metric
at `domains/financial/metrics/cash-in.json`, `cash-out.json` and
`net-cash-flow.json`. A vault that installed the kit before the figures existed
gets them on its first review Start; either way only ABSENT files are written, so
an operator's edit of a definition is never overwritten. Defining a new metric
applies immediately; editing or deleting an existing definition is filed as a
Decision (from **Analytics**, or through the companion) and applies when you
approve it.

A review's figures are the app writing those definitions: one block per
definition on the **Finance** page under **Look-back**, carrying its label, the
value and unit, the review window it read, the local as-of minute and
`Source: the finance:transactions database`; the **Overall** page carries the
same numbers in its cross-domain table with the previous period and the change
between the two displayed values. Figures refresh on Start while the review is
open and freeze when it is locked. They do not come from the cadence's review
rules any more — the rules may still keep custom `lifequest-snapshot` fences, and
those keep working, but Cash in / Cash out / Net are definitions.

Plan arithmetic, in plain terms. Budget spend is the sum of negative
transactions in the budget's category, period and currency, excluding transfers;
remaining is planned minus spent. Net worth is each account's opening balance
plus its transactions at the as-of date, plus holdings valued at
`market_value` (or quantity × price), with a fallback to the account's currency
when the holding names none. Projection starts from those cash books and adds
recurring items month by month; recurring rows are never auto-posted. A
projection horizon is clamped to 1–60 months. Scenario compare runs the live book
and the chosen assumption set(s) through the same projection.

No gauges, no board views. Finance blocks are a ledger table, a metric, a
bar chart, budget vs actual, net worth, and scenario compare. The three review
figures are metric definitions read over a period, not a dashboard: there are no
streaks, scores or colour judgements. There is no gauge
block and no kanban view.

## Tips and edge cases

- The kit is not required to use the Finance area's own databases. Install it
  when you want the ledger and pages; plain databases work without it.
- Installing twice is harmless but pointless: the second call reports already
  installed and writes nothing.
- The starter pages are ordinary pages. You can edit their markdown, remove a
  block, or add your own; the finance blocks only need the kit's database ids,
  not a special page type.
- The rate is one number for all USD accounts. There is no per-account or
  per-scenario FX, and no dated rate curve.
- The rate panel shows a stale rate and a failed read as different facts. If the
  source moved, fix **Source URL** and **Path to the rate** and choose **Save and
  read now**; the last good rate stays until a new read succeeds.
- A receipt photo is stored only from the desktop companion composer. A connected
  or phone agent cannot store bytes, so a receipt sent there cannot become
  `source_file`.
- One receipt may back several rows, and deleting a transaction never deletes the
  stored file. The file store is the provenance, not a cache.
- Undo removes only the last capture in that thread. A correction to an earlier
  row is an ordinary edit in **Transactions**, and that edit is the operator's own
  direct write.
- Restoring `books.json` replaces the live ledger rows with the export. Export
  before any hand-editing of the vault's files, and never while the app is
  writing.
- A budget's `currency` must match the account currency for spend to count; a USD
  budget does not measure ZAR-account spending.

## Related

- [Data and databases](./19-data-and-databases.md) — the generic machinery the
  kit is built on
- [Pages](./21-pages.md) — the starter pages and the finance blocks
- [Decisions](./23-decisions.md) — the install, and the ledger updates, deletes,
  columns and assumption saves that wait for approval
- [The Companion](./24-companion.md) — the chat composer and the attach control
- [The Vault](./04-the-vault.md) — where the kit's files sit
- [Settings](./28-settings.md) — the **Books** export and restore
