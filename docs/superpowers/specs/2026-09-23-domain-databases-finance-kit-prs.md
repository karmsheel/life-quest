# Domain databases, pages, and Finance kit — Product requirements

**Date:** 2026-09-23  
**Status:** Approved — Linear tickets filed (KAR-53–KAR-62)  
**Product:** LifeQuest — local-first life-management studio  
**Vision:** [VISION.md](../../../VISION.md) (approved 2026-09-23 delta)  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [Overview / domain lens](./2026-08-31-overview-domain-lens-design.md), [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md), [Hermes companion](./2026-09-04-hermes-companion-profile-design.md), [Decisions](./2026-09-12-document-lock-design.md)

Chosen approach: **one SQLite engine per domain for all databases** (generic and kit), living in the vault folder. Registry, pages, pins, and mappings stay git-native JSON. Sheets, Notion, and operator URLs are adapters. Analytics cache is disposable. No LifeQuest-hosted replica.

This spec is the PRS for one upgrade with three subsystems: **domain databases**, **pages / Home pin board**, **Finance kit** (household finance, first kit).

---

## 1. Purpose

The operator should treat LifeQuest as the vault for structured life data, starting with money: a transactions ledger fed from Google Sheets, PDF statements, chat, and optional linked sources; then spend, budget vs actual, net worth, and written planning scenarios. Every domain can add its own databases and pages the way one adds a database in a workspace. Finance is the first **kit** (schema + meaning + starter pages), installed into Financial, not silently seeded.

### Success (this upgrade)

The operator can:

1. One-click **Install Finance kit** on an existing vault (slug `financial`).
2. Drop a PDF statement and a Sheet/CSV; mapping is a Decision; rows are an ingest table; posted ledger holds the history.
3. Say “Bought food for R85 today” in chat and see the posted row named in the reply (or be asked for account if it is ambiguous).
4. Pin **Spend, Budget, Net worth**, and **two written scenarios** on Financial Home, and (per vision) on Overview as well.
5. Compare two planning scenarios (prose + numbers) against live books in ZAR, with USD accounts converted at the operator rate (or URL-refreshed rate).
6. Create a generic database and a page in any live domain.

### Non-goals (this upgrade)

- Embedded bank-login (Plaid/TrueLayer OAuth UI).
- Shared household / multi-operator vault.
- Tax lots, split transactions, auto-posting bills, dated FX curves, per-scenario FX.
- Column/tab layout engine, nested page embeds, gauges, scoreboard Home.
- Formulas/rollups and Notion board/calendar views on the table itself.
- Cross-domain relations or cross-domain block binds.
- Phone money UI beyond vision (draft queue + pinned metric) — phone client is a follow-on spec.
- A second storage engine for generic databases.
- Seeding Finance on every new vault without install.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Source of truth | **Per database:** local-only, linked-canonical, or local-canonical + mirror. |
| 2 | Primitive | **Two layers:** generic row store + kits. Finance is the first kit. Further kits (including business books) are welcome later in the same vault. |
| 3 | Finance kit objects | Accounts, Categories, Transactions, Budgets, Recurring (inflow/outflow), Holdings, Assumption sets. |
| 4 | Ingest | Files (CSV, Sheet export, PDF) + live link (Sheet, Notion, operator URL). Agent extract. **No embedded bank login.** |
| 5 | Mapping / rows | New or changed mapping → **Decision**. Batch rows → **ingest table**. |
| 6 | Posted edits | Operator-direct. Hermes → **Decision**. |
| 7 | Conversational capture | No Decision. Post when **amount and account** are unambiguous; chat names what was logged. Else ask in chat, do not post. Same-thread undo/correct is capture. |
| 8 | Pages | Generic canvases. Operator-direct. Hermes page writes → **Decision**, except **script blocks** (apply, then chat names the change). |
| 9 | IA | Databases and pages are **domain-owned**. **Data** and **Pages** rails on the **Home** wing. |
| 10 | Dashboard | **Pin board** per lens. Goal progress and deadline remain available as pins. System pins reify today’s extra Home modules so Overview does not get thinner. |
| 11 | Success line | **Full plan loop:** ledger, spend, budget vs actual, net worth, two comparable written scenarios. |
| 12 | Scenario | A **page**: written plan + projection blocks bound to an **assumption set**. Ledger is not forked. |
| 13 | Generic columns | Text, number, date, select, checkbox, relation (same domain), file. No formulas/rollups/board views on the table. |
| 14 | Kit install | **Install into Financial**, one-click on existing vault. Not seeded. Hermes may only **propose** install (Decision). |
| 15 | After install | Empty kit, local-canonical. Starter pages created. Pins on **Financial and Overview** (vision). Link Sheet later. |
| 16 | Blocks | Core + finance. **No gauges.** No column/tab layout. No nested embeds. Script block is in vision (see §8). |
| 17 | Net worth | **Books plus marks.** Hermes mark/FX via Decision **or** operator URL refresh on open (no Decision). |
| 18 | Currency | Per-account **ZAR \| USD**. Home currency **ZAR**. Operator USD→ZAR rate + as-of. Reports convert at current rate. |
| 19 | Engine | **SQLite in the domain folder** is the live book. JSON registry/pages/pins/mappings. Disposable analytics cache. JSON export is git-portable; restore is Settings + confirm, not a git hook. |
| 20 | Offline linked | Writes **queue**; conflicts prompt on reconnect. Do not freeze the studio. |
| 21 | Recurring | Do **not** auto-post. They feed projections. `kind: inflow \| outflow`. |
| 22 | Transfers | Two posted rows sharing `transfer_id`. No splits. |

---

## 3. Architecture

**One engine.** `domains/{slug}/data/domain.sqlite` holds every database in that domain (generic and kit). Created on first database (install or New database).

**Git-native JSON.** `registry.json` (databases, columns, SoT, adapter binding, installed kits), `pages/{id}.json`, `pins.json`, `mappings/{id}.json`, Overview pins at `.lifequest/overview-pins.json`.

**Cache.** `.lifequest/cache/` is disposable, gitignored, rebuilt on open / invalidated on write.

**Git.** On kit install (and first sqlite create), append `domains/*/data/domain.sqlite*` and `.lifequest/cache/` to vault `.gitignore` if the vault is a git repo. Recovery of the live book is **copy the vault folder** or **Settings → Restore from JSON** (confirm).

**Process.** Electron main owns SQLite, adapters, and URL fetches. Renderer talks through vault APIs. Hermes never gets a raw SQL socket.

**Tokens.** Google OAuth, Notion integration, and any URL-feed secrets stay in OS secure storage. Registry stores ids, mapping id, SoT, last-synced-at only.

---

## 4. Vault layout and studio IA

```
domains/{slug}/
  domain.json
  why.md  what.md  how.md  premise.md
  media/
  data/
    domain.sqlite
    registry.json
    mappings/{id}.json
    files/{id}/…
  pages/{id}.json
  pins.json
.lifequest/overview-pins.json
.lifequest/cache/
```

**Home wing rail:** Dashboard (`/home`) · Data (`/data`) · Pages (`/pages`) · Personnel.

**Lens.** Overview = union. Domain tab = that domain only. No unassigned database or page. Create-from-Overview requires a domain. Opening a DB/page does not change the lens. URLs: `/data/{slug}/{dbId}`, `/pages/{slug}/{pageId}`.

**Install Finance kit** (Data empty-state and Financial Dashboard), slug `financial` only:

1. Create `data/` + `pages/` if needed.
2. SQLite + registry: seven kit databases, empty, local-canonical, home currency ZAR, empty rate until set.
3. Starter pages: Ledger, Spend, Budget, Net worth, Scenario 1, Scenario 2 (each scenario bound to an empty assumption set).
4. Pin on Financial **and** Overview: goal-progress, deadline, then those starters. Existing Overview system pins (doctrine-progress, today-week, pending-decisions, recent-log) stay unless the operator unpins them.
5. Log `kit.installed`. Second click is a no-op. Missing `financial` → refuse with a clear error.

**New generic database** is allowed in any live domain without the kit.

---

## 5. Record model (Finance kit)

**Accounts.** Name, type (checking, credit, cash, brokerage, property, other), currency (`ZAR` \| `USD`), opening balance + as-of, optional APR (projection-only). Transactional accounts are books; brokerage/property hold holdings.

**Categories.** Shared taxonomy. Visible in Data.

**Transactions.** Date, signed amount in the account’s currency, account, category, payee, notes, optional source file, provenance, `external_id`. Proposed ingest rows are not posted until accept.

**Budgets.** Period (month or year), category, amount + currency. Actuals from posted transactions. Not auto-spent in projections.

**Recurring.** Name, amount + currency, cadence, next date, account, category, `kind: inflow \| outflow`.

**Holdings.** Name, account, quantity, price or market value, price currency, as-of, optional expected_return (projection-only).

**Assumption sets.** Named deltas: income change, extra payment, contribution, one-time, spending change. Horizon default 12 months, max 60, monthly steps. FX constant at current operator (or URL) rate.

**FX.** Kit setting home currency ZAR; USD→ZAR rate + as-of. No FX history series in this upgrade.

**Files.** `data/files/` — PDFs and receipts. File columns store vault-relative pointers.

**Ingest staging.** `ingest_batches` / `ingest_rows` until accept.

---

## 6. Ingest, adapters, conflicts

**Files.** Drop CSV / Sheet export / PDF onto Data. Copy into `data/files/`. Hermes extracts. Fingerprint match reuses mapping; layout change → new mapping Decision.

**PDF.** Best-effort. Ingest table is the correction surface. Fail closed on garbage. File remains whether or not rows are accepted.

**Live link.** One remote per database: Google Sheet, Notion database, or operator URL. Sync on vault open, Data refresh, and after ingest — not realtime push. Unmapped remote columns ignored; extra LifeQuest columns do not round-trip.

**Operator URL.** Same family as a linked Sheet. May refresh FX, marks, balances, and new transactions on open **without a Decision**. Not an embedded bank-login screen. New rows from a URL still carry provenance and `external_id`; duplicates warn. If the URL returns a shape Hermes has not mapped, that mapping is a Decision once; later pulls reuse it.

**SoT.** Local-only: sqlite only. Linked-canonical: remote is the book; sqlite is replica; LifeQuest edits write-through when online. Mirror: sqlite is the book; adapter pushes.

**Conflicts.** Per row: keep local, keep remote, skip. No silent merge of amounts/dates/categories. Linked-canonical defaults to remote; mirror defaults to local.

**Chat.** “Bought food for R85 today” → parse → post if amount + account clear (default capture account or sole transactional account in that currency) → chat receipt. Missing amount or account → ask. Category may be Uncategorized, named in the receipt.

---

## 7. Pages, pins, blocks

**Page.** Domain JSON: title + vertical stack.

**Canvas blocks:** markdown, bound table, metric (sum/count/last, optional ZAR), date range (one per page; siblings listen), bar/line chart, goal progress, deadline, budget vs actual, net worth, scenario compare, **script** (vision: query that domain’s SQLite; may `fetch`).

**Dashboard-only system pins:** goal-progress, deadline, today-week, pending-decisions, recent-log, doctrine-progress.

**Default Overview** (missing file): current Home modules as system pins. After Finance install: those remain, plus starter page pins (vision). **Default Financial after install:** goal-progress, deadline, Ledger → Spend → Budget → Net worth → Scenario 1 → Scenario 2.

**Finance blocks** bind only Financial kit databases. A finance block in a domain without the kit shows Install, not a fake chart.

**Projections.** Start from books + marks. Each month: optional APR, recurring in/out, assumption deltas, optional holding expected_return. Output per month, per currency and ZAR. Missing APR/return/rate is labeled, not invented.

**Script.** Operator may paste directly. Hermes applies a script block, then names it in chat (no Decision). Other page edits from Hermes still go through Decisions.

---

## 8. Hermes write paths

| Intent | Path |
|---|---|
| Mapping (new/changed) | Decision |
| PDF/CSV/Sheet batch | Ingest table |
| Operator URL pull after mapping | Write-through like Sheet (no Decision) |
| Kit install | Operator-direct, or Decision if Hermes proposes |
| Page (except script), pins, assumption set | Operator-direct; Hermes → Decision |
| Script block | Operator-direct; Hermes applies then chat-names |
| Posted row / transfer / category / account | Operator-direct; Hermes → Decision |
| Mark / statement balance / FX typed in studio | Operator-direct; Hermes → Decision |
| Mark / FX / balances / new rows from operator URL | On open, no Decision |
| Conversational expense/income | Post + chat receipt, or ask; no Decision |

Rejected Decisions do nothing. Hermes must not retry a rejected mapping as silent ingest.

Life log: kit install, mapping accept, batch accept (counts), adapter link/unlink. Not every cell edit.

---

## 9. Implementation slices (ticket groups)

Team **Karmsheel**, project **LifeQuest**, status **Backlog**.

| # | Issue | Blocked by |
|---|---|---|
| 1 | [KAR-55](https://linear.app/karmsheel/issue/KAR-55) Domain database engine | — |
| 2 | [KAR-60](https://linear.app/karmsheel/issue/KAR-60) Pages and Home pin board | KAR-55 |
| 3 | [KAR-61](https://linear.app/karmsheel/issue/KAR-61) Finance kit install | KAR-55, KAR-60 |
| 4 | [KAR-53](https://linear.app/karmsheel/issue/KAR-53) Finance ingest (PDF, CSV, mapping) | KAR-55 |
| 5 | [KAR-59](https://linear.app/karmsheel/issue/KAR-59) Database adapters (Sheet, Notion, URL) | KAR-55, KAR-53 |
| 6 | [KAR-62](https://linear.app/karmsheel/issue/KAR-62) Conversational transaction capture | KAR-61 |
| 7 | [KAR-57](https://linear.app/karmsheel/issue/KAR-57) Finance plan loop | KAR-61 |
| 8 | [KAR-58](https://linear.app/karmsheel/issue/KAR-58) Database JSON export and restore | KAR-55 |
| 9 | [KAR-56](https://linear.app/karmsheel/issue/KAR-56) Page script block | KAR-60 |
| 10 | [KAR-54](https://linear.app/karmsheel/issue/KAR-54) Align README, PRODUCT, and LAWS | KAR-53, KAR-55–62 |

Use these as Linear parents; children can be vault-core vs desktop vs adapters.

1. **Domain database engine** — sqlite + registry + generic CRUD + Data rail + lens filter + gitignore.
2. **Pages + pin board** — page JSON, block renderer (core blocks), Pages rail, Dashboard as pins, goal/deadline pins, Overview defaults.
3. **Finance kit install** — kit schema, starter pages, finance blocks, Financial + Overview pins, one-click existing vault.
4. **Ingest** — file copy, mapping Decisions, ingest table, PDF/CSV extract, provenance/dedup.
5. **Adapters** — Google Sheet, Notion, operator URL; SoT modes; conflict UI; offline queue.
6. **Conversational capture** — chat parse, default account, receipt/undo, ask-when-ambiguous.
7. **Plan loop** — budgets vs actual, net worth books+marks, assumption sets, scenario compare, ZAR conversion, projections.
8. **JSON export/restore** — Settings export; restore with confirm (not a git hook).
9. **Script block** — query API + fetch; Hermes apply-and-name.
10. **Docs alignment** — README/PRODUCT/LAWS for sqlite-in-vault, Data/Pages rails, conversational money.

Phone draft-queue and phone pinned metric are **not** in these slices.

---

## 10. Laws and follow-on docs

New or extended laws (observable only):

- Domain databases MUST live in the vault folder. The product MUST NOT require a LifeQuest-hosted database.
- A new or changed ingest mapping MUST go through Decisions. Batch rows MUST NOT post until ingest accept.
- Conversational capture MUST NOT post when amount or account is missing. It MUST name what was logged when it posts.
- Kit install proposed by an agent MUST go through Decisions.
- JSON restore MUST require an explicit confirmed Settings action.
- Home MUST keep goal progress and deadline available as pins. Gauges MUST NOT ship as page blocks.

README currently says there is no SQLite in the desktop path. After this ships, that line is false: sqlite is the domain book, not Prisma, not hosted.

---

## 11. Test bar

- vault-core: create/open with and without kit; install idempotence; generic DB in Health; SoT modes; ingest accept/reject; mapping Decision payload; JSON export/restore confirm; path escape.
- desktop: Home wing Data/Pages; lens filter; pin board; conversational capture happy path and ask path; finance starter pages render empty without lying.
- No test may require a live Google/Notion account; adapters use fakes.

`npm test` in `packages/vault-core` and `apps/desktop`, plus `npm run typecheck`, must pass.
