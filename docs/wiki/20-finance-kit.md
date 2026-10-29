# Finance kit

The Finance kit is the first optional kit: a schema, a set of meaning, and six
starter pages installed into the **Financial** domain in one step. It
gives you a household ledger — accounts, categories, transactions, budgets,
recurring items, holdings, assumption sets — plus spend, budget, net-worth and
scenario pages, and a captured purchase can be logged from chat or from a photo
of the receipt. Nothing is seeded into a new vault; the kit is installed into an
existing domain.

## Where it lives

- **Install**: **Home** wing → **Dashboard** or **Data**, right rail → **Finance**
  card → **Install Finance kit**. Every finance page block also offers the same
  button when the kit is missing.
- Ledgers: Home → **Data** (`/data`), Financial lens; the seven databases
  open at `/data/financial/<databaseId>`.
- Starter pages: Home → **Pages** (`/pages`), Financial lens; each page opens
  at `/pages/financial/<pageId>`.
- Rate and capture account: Home → **Data**, right rail — **Exchange rate**
  and **Capture** panels.
- **Receipts**: the chat dock composer, beside the field.
- **Restore**: **Settings → Vault → Books**.

Back to [Wiki home](./README.md).

## What it is for

The kit turns the Financial domain from a written life area into a working book:
what you have, what you spend it on, what you planned, what you are worth, and
what the next year looks like under assumptions you can compare. It is installed
rather than assumed, so a vault can use plain databases without inheriting a
ledger it did not ask for. The house currency is ZAR; USD accounts are converted
at one operator-visible rate.

## How to use it

### Install the kit

1. Make sure the Financial domain is live. The card only appears when it is, and
   only when the kit is not already installed, and only on **Overview** or the
   Financial lens.
2. Choose **Install Finance kit** on the Dashboard card, the Data rail, or a
   finance page block. There is no second confirmation: the card itself is the
   offer.
3. The install creates seven databases in `domains/financial/data/`, the pages
   under `domains/financial/pages/`, two assumption sets, and pins on the
   Financial and Overview dashboards. The databases start empty; the two
   assumption sets are named **Scenario 1** and **Scenario 2**.
4. The engine also has an agent-proposed install path: an agent's request files a
   pending [Decision](./23-decisions.md) labelled **Finance kit**, and approving
   it performs the same install. In this build the companion has no install
   tool, so the click on this card is how the kit is installed.

The install is idempotent: running it again on an installed kit reports that it
is already installed and writes nothing. It refuses a missing or archived
Financial domain.

### Fill the book

Open **Data** with the Financial lens. The kit's databases have fixed ids and
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
2. Or attach a photo: use **Attach a receipt** (the image button at the left of
   the composer's footer), drop one image on the form, or paste one into the
   field. One receipt rides one turn; a second attach replaces the first. The
   chip shows the file name and size, and **Remove receipt** clears it.
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

### Work the plan surfaces

The starter pages are pinned on the Financial board and the Overview board:

- **Ledger** — a markdown intro and the Transactions table.
- **Spend** — the total spent, and a bar chart of spending by date.
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

**Settings → Vault → Books** exports the domain's databases to
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
| Chat composer | **Attach a receipt**, the chip, **Remove receipt**; the posted receipt line in the reply. |

## Rules and behaviour

The kit installs, it is not seeded. A new vault has four domains and no
finance tables. The kit is a write into the Financial domain and the operator
chooses it. The law that matters is in [LAWS/DATABASES.md](../../LAWS/DATABASES.md):
domain databases live in the vault, a kit install proposed by an agent goes
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
| Financial board pins | `domains/financial/pins.json` |
| Overview board pins | `.lifequest/overview-pins.json` |
| `.gitignore` lines for the SQLite file and cache | vault root |

Install is operator-direct or a Decision. The operator's click installs. The
engine's agent path files a **Finance kit** Decision and writes nothing until it
is approved; the companion's tool surface in this build does not expose that
path, so the operator installs from the card.

Conversational capture needs no Decision — and is the only finance write that
does not. When the amount and the account are unambiguous, the companion posts
the row directly and names what it logged. When either is ambiguous it asks and
posts nothing. The operator's own edits in **Data** are direct too. Every other
agent write to the ledger — `upsert_row`, `insert_rows`, `delete_row`, creating a
column or database, a budget or accounting change — is filed as a Decision; a
create in a database on the insert allowlist may post, an update always waits.

How a capture is resolved. The amount may be written `R85`, `ZAR 85`,
`$20`, `USD 20`, with a leading minus for a spend. The date is an explicit
`YYYY-MM-DD`, **yesterday**, or today. Income words such as **received**,
**income**, **salary**, **refund** or **got paid** make the value positive;
otherwise it is a spend and negative. The category is matched by name against
**Categories**, and **Uncategorized** is created if the book has none. The
account is chosen in this order: one named in the sentence, the default capture
account, the sole transactional account in that currency; otherwise it asks. The
provenance is the chat thread, which is what undo and correct key on.

Receipt images. The attach control accepts one JPEG or PNG per turn, up to
25 MB, sniffed from the bytes rather than trusted from the file name. The
original goes into `domains/financial/data/files/<fileId>/<name>` exactly as it
arrived, and the row cites that vault-relative path in `source_file`. The copy
the agent sees is a re-encoded JPEG at the 1600 px / quality 80 rung, stepping
down to 1600/60 and 1200/55 until it is at or under 2 MB; if none fits, the
attach is refused with **This receipt could not be prepared for the agent.**
and nothing is written. Refusals are specific: **Receipts must be JPEG or PNG
images.**, **That receipt is larger than 25 MB.**, **Install the Finance kit
first**. The agent may only cite a path that already exists in the finance file
store; a made-up or escaping path refuses the whole capture. Undo deletes the
row and leaves the file; correct preserves `source_file`.

The FX rate. Only USD→ZAR exists; the house currency is ZAR and USD amounts
are converted at the stored rate. The default source is
`https://open.er-api.com/v6/latest/USD` with `rates.ZAR`. A read must answer a
positive finite number; anything else keeps the last good rate and records the
error rather than writing nonsense. A refresh is refused when the kit is not
installed or Financial is archived. The rate is read on vault open and hourly
while the app is running. Until a rate exists, USD figures are left unconverted
and the cards say so.

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
bar chart, budget vs actual, net worth, and scenario compare. There is no gauge
block and no kanban view.

## Tips and edge cases

- The kit is not required to use the Financial domain's own databases. Install it
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
- [Decisions](./23-decisions.md) — the install, ledger edits and assumption saves
  that wait for approval
- [The Companion](./24-companion.md) — the chat composer and the attach control
- [The Vault](./04-the-vault.md) — where the kit's files sit
- [Settings](./28-settings.md) — the **Books** export and restore
