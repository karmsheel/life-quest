# Reviews — the notebook, and per-domain metrics · Design Spec

**Date:** 2026-11-26
**Status:** Draft — for review
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Reviews](./2026-09-21-reviews-design.md), [Review wing](./2026-09-12-review-wing-design.md), [Overview / domain lens](./2026-08-31-overview-domain-lens-design.md), [Domain databases & finance kit](./2026-09-23-domain-databases-finance-kit-prs.md), [Direct database writes](./2026-10-28-direct-database-writes-design.md)
**Supersedes:** `LAWS/REVIEWS.md` as written (one file per period, domains as sections), and decision 5 of `2026-09-21-reviews-design.md:39`. Wing tabs, rail rows, routes, review windows, and session-binding rules from that spec stay in force.
**Analysis behind it:** [reviews notebook & metrics analysis](../../research/2026-11-26-reviews-notebook-and-metrics-analysis.md).

A review period becomes a **notebook**: one container with one page for the overall
review and one page per reviewed area, browsed by a tab row that is also the app-wide area
lens. The overall review stays the front page. Per-domain **metrics** become first-class
definitions printed as figures on each area page and rolled up on the overall page, with an
Analytics page in the Review wing. The single idea: a period is still one review, but it is
read and written as a set of focused reports instead of one long document.

---

## 1. Purpose

### What is wrong today

1. **Concurrent area reviews lose each other's prose.** Every writer sends the whole file —
   the page autosave, `write_review`, ensure, snapshot prepopulate, mark-done, session-id.
   There is no version check, so the last whole-body write wins and silently erases another
   area's report while its status still reads `done`. [analysis §1.1]
2. **The document is hard to read back.** A five-area weekly review is one internally-scrolling
   box with ~30 headings and no outline or anchors; selecting an area is only possible by
   starting an interview. [analysis §2.2]
3. **Per-domain tailoring is impossible.** The canonicaliser forces the same four headings on
   every area and parks anything else at the end of the file. [analysis §1.3]
4. **Figures are ad hoc.** The one shipped finance figure is an unfiltered `sum(amount)` —
   net cash flow — labelled "Spending this period". The operator cannot define, see the
   history of, or trust the provenance of a metric. [analysis §3.2]

### Success criteria

- Two area interviews and the page can write at the same time without losing a word; a race
  on the **same** page returns a conflict instead of overwriting.
- Reading week 39's Health review is one click from the period, on its own page, with tabs
  carrying status.
- A locked period still reads as one review; the dashboard, week-start guard, Decisions,
  session binding and `list_reviews` keep working unchanged in behaviour.
- Each area's report can eventually carry its own structure and figures; the Life review
  still synthesises every area page.
- The operator can define metrics per area, log dated events for the ones with no database,
  see the figures in each area's report, the cross-domain table on the overall page, and a
  period × metric matrix on Analytics.
- `npm run docs:check` passes; the wiki describes the shipped screen; the law says what the
  engine does.

---

## 2. Locked product decisions

The operator settled these on 2026-11-26; they outrank anything else in this document.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Every area-bearing cadence is a notebook** (Weekly, Monthly, Quarterly, Yearly). Daily is a single page. | Tab row exists only when `cadence !== "daily"`; daily is a notebook of one page in storage, with no tab strip. |
| D2 | **Tab and app-wide area lens are one binding, both directions.** | Active tab derives from the lens; tab press calls `setActiveSlug`; lens change elsewhere selects that tab. Browsing tabs filters Dashboard/Data/Log; the last tab persists as the lens across restarts. Daily ignores the lens, as today. |
| D3 | **Expenses are gross** — positive, transfers excluded — not net cash flow. | The is-set/not-set filter op and a magnitude presentation are part of the metrics definition of done. The shipped "Spending" figure is replaced by Cash in / Cash out / Net cash flow. |
| D4 | **Manual metrics are dated events** — one row per session/read/prayer. | "Manual" becomes an events source; every metric is a `ViewSpec` run over rows. No period claims, no roll-up vocabulary, no attribution rule. |
| D5 | **Analytics is one Review-wing page, scoped by the selected domain.** | `/review/analytics` shows the lens domain's metrics, or every area's under Life. |

### Derived decisions (this spec proposes them)

| # | Decision | Rationale |
|---|---|---|
| S1 | Storage is **uniform across cadences**: every review is `reviews/{cadence}/{period}/` with a `review.json` and one markdown page per scope. | One code path for index/lock/gating/migration; daily is a notebook of one. Avoids a flat→directory transition the first time an area page is added to an overall-only period. |
| S2 | The **manifest is the single authority** for notebook identity, order, week-start and lock; page files own their prose, status and session id. | One lock cannot disagree with itself; a page write cannot change the notebook's structure. |
| S3 | Page writes are **compare-and-swap on a per-page `rev`**; structural operations take a per-notebook mutex and a manifest `rev`. | Cross-page concurrency stays parallel; same-page races are detected, not silently lost. |
| S4 | Area pages require the same four headings as the overall page in this phase; **extra headings are first-class** and preserved in place. | Keeps the Life review's synthesis contract while making per-domain tailoring (Phase 3) a template change, not an engine change. |
| S5 | A notebook **locked** state makes every page read-only and closes the period; `markReviewDone(overall)` is the gate and the lock. Unlock is operator-only and unlocks the notebook. | Preserves today's semantics exactly, across more files. |
| S6 | Definitions live in `domains/<slug>/metrics/<id>.json`; events live as rows in a per-area `metrics` database. | Mirrors saved views for config; reuses the database engine for data; keeps git-portable definition history. |

### Out of scope

- Changing review windows, period maths, or the week-start setting's behaviour.
- A second query engine, a chart farm, streaks/badges/scores, dashboard metric cards by default.
- Reworking Decisions, session binding, or the Plan hook beyond the target/scope changes named here.
- Per-day tracking of every metric; Analytics charts beyond the matrix.
- Real-time multi-process editing outside the app (external editors are not guarded; the app
  detects only its own writes through CAS).

---

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Review notebook** | `(cadence, period)`. The container: manifest + pages. One lock, one index entry, one dashboard row. |
| **Review page** | One scope inside a notebook: `overall` or a domain slug. A markdown file with frontmatter, status and a session id. |
| **Scope** | `"overall"` or a live area slug. The tab identity. |
| **Book of record** | The notebook as read back: period title, week start, lock, page statuses and prose. |
| **Figure** | App-written markdown inside `<!-- lifequest:... -->` markers: a metric value/table with its window and as-of. |
| **Metric definition** | The operator's named measurement: label, unit, source, aggregation, target, formatting. |
| **Metric event** | One dated row (`date`, `metric`, `value`, `note`) in an area's `metrics` database. |
| **Analytics matrix** | Rows = metric definitions, columns = recent periods, cells = value and delta. |
| **Lens binding** | Tab selection and `setActiveSlug` are the same state (D2). |

---

## 4. Architecture

### 4.1 Paths

```
reviews/{cadence}/{period}/review.json      # manifest: identity, order, weekStartDay, lock
reviews/{cadence}/{period}/overall.md       # the front page (four H2s)
reviews/{cadence}/{period}/{slug}.md        # one area page per started scope
.lifequest/reviews/{cadence}.md             # review skill (per cadence) — unchanged
.lifequest/legacy-reviews/{cadence}/{period}.md   # archived pre-migration files
.lifequest/migrations/reviews-notebook-v1.json    # migration marker + results
domains/{slug}/metrics/{metricId}.json      # metric definition (git-portable)
domains/{slug}/views/{viewId}.json           # saved views — unchanged
```

`vaultPaths` gains `reviewNotebookDir(cadence, period)`, `reviewManifest(...)`,
`reviewPageMd(..., scope)`, `reviewLegacyArchiveDir`, and the metrics builders. Every segment
goes through the existing `assertSafeSegment`/`assertDomainSlug` guards; `overall` is a
reserved scope name and a domain may not be named `overall` (validate at creation).

### 4.2 `review.json` (manifest)

```json
{
  "schemaVersion": 1,
  "cadence": "weekly",
  "period": "2026-11-16",
  "weekStartDay": "monday",
  "title": "16-22 Nov '26 (W47)",
  "locked": false,
  "order": ["overall", "health", "mind", "financial", "business", "relationships"],
  "rev": 3,
  "createdAt": "2026-11-22T08:00:04.120Z",
  "updatedAt": "2026-11-22T18:12:44.001Z"
}
```

- `order` is the canonical tab order. `overall` is always first. A page added later is
  inserted at its area's vault sort position at creation time; removing an area from the
  vault does not remove its page or its position (history).
- `rev` increments on every structural change: page creation, status change, lock/unlock,
  order change, title change. It does **not** increment on page body writes (those bump the
  page's own `rev`).
- A missing/unreadable manifest with a non-empty directory is an error the index reports; it
  is never silently recreated over existing pages.

### 4.3 Page file

```markdown
---
schemaVersion: 1
scope: health
title: Health
status: draft
sessionId: null
rev: 7
updatedAt: 2026-11-22T18:10:02.004Z
---
# Health · 16-22 Nov '26 (W47)

## Look-back

## Keep

## Change

## Next-period intent
```

- `status`: `draft` | `done`. Absent page = `missing` (not started), exactly like today's
  absent scope. `done` for an area is a page status only; it never locks.
- `rev` starts at 1 and increments on every accepted body write (snapshot passes included).
- `title` is the display name recorded at creation; a later area rename does not rewrite
  history. Tabs label with the live area name when the area is live, else the recorded title.
- Required headings: the same four `##` for overall and area pages (S4). A page body is
  rejected if any is missing, with the missing names in the error. Extra `##`/`###` headings
  are kept **in place** and never reordered; they are the hook for Phase 3 tailoring.
- The H1 is canonicalised from the page title and the notebook title; the four H2 order is
  fixed; everything else is preserved verbatim.

### 4.4 Lock, status and gating

- `manifest.locked = true` ⇒ every page is read-only, no page may be created, no status may
  change; the UI draws the notebook as a report.
- `markReviewDone(overall)`:
  - daily ⇒ sets `overall.status = done`, `locked = true`;
  - area-bearing ⇒ refuses with `GATED` listing the areas not yet done, unless every **live**
    area page is `done` (archived areas are not in the gate; a page that exists for an
    archived area still displays);
  - success sets `overall.status = done`, `locked = true`, bumps manifest `rev`.
- `unlockReview` clears `locked` (keeps `overall.status = done`), bumps `rev`. Operator-only:
  the agent tool refuses it, as today.
- Area `markReviewDone` sets that page's status and bumps manifest `rev` (status is structural).

### 4.5 Index, dashboard, week-start guard

- `listReviewIndex` scans each `reviews/{cadence}/` for notebook **directories** (plus legacy
  `*.md` during the compatibility release) and returns one `ReviewIndexEntry` per period:
  cadence, period, title, locked, `updatedAt` = max of manifest and pages, and a new
  `scopes` map assembled from the pages so existing consumers keep working.
- `ReviewIndexEntry` gains `pageCount` and `doneCount`; `scopes` is derived, not stored twice.
- The weekly-file count that guards the week-start setting counts weekly notebooks, not `.md`
  files (`agents.ts` `countWeeklyVaultFiles`); legacy `.md` still counts until migrated.
- The dashboard and composition widgets keep consuming the index unchanged.

### 4.6 Compatibility view

`getReview(cadence, period)` returns the existing `ReviewRecord` shape, assembled read-only:
`title`, `weekStartDay`, `locked`, `scopes` (map), and `bodyMarkdown` =
`overall page` + each area page demoted (`# X` → `## X`, `## Y` → `### Y`). This keeps
period-pack slicing, pairing projection and older read consumers working for one release.
It is a **read-only projection**: no writes go through it, and the new code paths use pages.
`ReviewRecord` gains `pages: ReviewPageSummary[]` and `notebookRev: number`.

---

## 5. Concurrency

### 5.1 One write path per file, two doors

- A per-notebook async mutex in vault-core (the `domain-databases.ts` per-database mutex is
  the precedent) guards structural operations and every lock check.
- The renderer's vault write queue and the MCP/agent tool door both call the same engine
  functions; the engine mutex, not the IPC queue, is what makes them safe together.
- No write is accepted while `locked`, checked inside the mutex (a lock that lands during a
  page write wins; the write returns `LOCKED`).

### 5.2 Compare-and-swap

- `writeReviewPage` requires `baseRev` (the page `rev` the caller read). Inside the mutex the
  engine re-reads the page; if `page.rev !== baseRev` it returns `CONFLICT` with the current
  page (body, rev, status) and writes nothing.
- **Phase 0 shape (today's one-file storage):** a page has no rev of its own yet, so scoped
  writes merge the scope's headings under the mutex and ignore `baseRev` — cross-scope edits
  are other people's work, not a conflict. The file `rev` is checked by the whole-body writers
  (page autosave, snapshot pass, legacy `write_review`) and returned as `CONFLICT` with the
  current record. Phase 1 moves the rev onto each page file and turns the scoped check on.
- Two writes to **different** pages never contend (different files, different revs) — which
  is the reported concurrent-review case.
- Two writes to the **same** page conflict and are surfaced, never silently merged in the
  engine. The renderer may offer a reload; the agent re-reads and retries.
- Structural operations (ensure page, mark done, unlock, session id) take the mutex and use
  the manifest rev only as an optimistic check when the caller supplies it; they do not
  require a page rev.

### 5.3 Conflict surface

| Caller | Behaviour |
|---|---|
| Page autosave | Keeps the operator's text, shows "This page changed on disk while you were writing" with **Reload** (adopts the file) and keeps the draft until the operator chooses. Never auto-merges. |
| Agent `write_review` | Returns `{error:{code:"CONFLICT", message, current}}`; the session prompt says "read the page again and re-apply your section only". |
| Snapshot/prepopulate | Runs inside the mutex and writes with a fresh read; it is app-generated, so it retries once then reports `failed` in the outcome. |
| Decision apply | Carries the page rev at propose time; if it has changed, the apply refuses `STALE` and leaves the Decision pending with a "the review changed" notice. |

---

## 6. Engine API (vault-core)

New/changed exports in `packages/vault-core/src/reviews.ts` (split into `review-notebook.ts`
if it grows past comfort; keep the public names in `index.ts`):

```
getReviewNotebook(root, cadence, period)                        -> Result<ReviewNotebook>
getReviewPage(root, cadence, period, scope)                     -> Result<ReviewPage>
ensureReviewPage(root, {cadence, period, scope})                -> Result<ReviewNotebook>
writeReviewPage(root, {cadence, period, scope, bodyMarkdown,
                       baseRev, actor})                          -> ReviewWriteOutcome
markReviewDone(root, {cadence, period, scope, actor})           -> Result<ReviewNotebook>
unlockReview(root, cadence, period, actor)                      -> Result<ReviewNotebook>
setReviewSessionId(root, {cadence, period, scope, sessionId})   -> Result<ReviewNotebook>
listReviewIndex(root)                                           -> Result<ReviewIndexEntry[]>
prepopulateReview(root, {cadence, period, scope, actor})        -> Result<ReviewPrepopulateResult>
getReview(root, cadence, period)                                -> Result<ReviewRecord>   // compat projection
migrateLegacyReviews(root)                                      -> Result<MigrationReport>
```

```ts
type ReviewPageSummary = { scope: string; title: string; status: "draft"|"done";
                           sessionId: string|null; rev: number; updatedAt: string;
                           chars: number };
type ReviewNotebook = { cadence: ReviewCadence; period: string; title: string;
                        weekStartDay: WeekStartDay; locked: boolean;
                        order: string[]; rev: number; pages: ReviewPageSummary[];
                        path: string; legacy: boolean };
type ReviewPage = ReviewPageSummary & { cadence; period; bodyMarkdown: string;
                                        locked: boolean };
type ReviewWriteOutcome =
  | { ok: true; page: ReviewPage; notebookRev: number }
  | { ok: false; code: "CONFLICT"|"LOCKED"|"GATED"|"NOT_OPEN"|"NOT_FOUND"|"MALFORMED";
      message: string; current?: ReviewPage };
```

- Body canonicalisation is per page (`canonicalizePageBody`): H1 from title, exactly one H2
  per required heading in fixed order, extras preserved in place, `rev`/`updatedAt` rewritten.
  It must be a fixed point: `canonicalize(canonicalize(x)) === canonicalize(x)`, asserted in
  the engine test.
- Snapshot placement resolves the directive's `section` directly on the page (no
  `## <Area>` wrapper); the directive shape is unchanged, so the operator's existing
  `.lifequest/reviews/<cadence>.md` fences keep working. A directive runs only when its
  `domain` is the page's scope; on the overall page no domain directive runs (the
  cross-domain table is an app-rendered block, not per-area snapshots), and a directive
  naming an area that is not live is skipped with a reason.
- `prepopulateReview(scope)` runs only that page's directives and writes that page.

**Phase 1 note (shipped).** The notebook storage, migration and compatibility projection land
before the tabbed UI, so three engine functions keep returning the compatibility `ReviewRecord`
rather than `ReviewNotebook` for one release (`markReviewDone`, `unlockReview`,
`setReviewSessionId`); the renderer's IPC and the Review page consume that shape unchanged until
Phase 2. `writeReviewPage`'s failure variant carries the sentence as both `message` (this spec)
and `error` (the Phase 0 outcome shape the tool door already reads). The migration lives in
`reviews.ts` rather than a separate `review-migrate.ts`: it shares the page parser, the splitter
and the projection, and the public name `migrateLegacyReviews` is unchanged.

---

## 7. Agent tools and prompts

| Tool | Change |
|---|---|
| `get_review` | New optional `scope`. Without it: notebook summary + overall page body (compat). With it: that page (body, rev, status). |
| `write_review` | **Breaking**: `scope` and `baseRev` required. Writes one page. Locked ⇒ files a Decision targeting the page. |
| `mark_review_done` | Unchanged args; `scope` required as today. Area sets page status; overall gates and locks. |
| `unlock_review` | Unchanged; unlocks the notebook; agent calls refused. |
| `list_reviews` | Unchanged response, one row per period.
| `get_period_pack` | Includes the notebook's page summaries and, for the overall scope, every page's prose (it already includes domain sections for overall). |
| `define_metric`, `log_metric`, `list_metrics`, `get_metrics_summary` | New in Phase 4 (see §10). |

Prompt changes in `apps/desktop/electron/review-sessions.ts`: every kickoff names the page
and tells the session to `get_review(scope)` first and `write_review(scope, body, baseRev)`;
the overall kickoff tells it to read every page (and the pages are listed in the kickoff), not
"the file". The review default skill text loses "read the review file" in favour of "read the
page the app opened".

Tool registration: `REVIEW_TOOL_DEFS`, `ALL_TOOL_DEFS`, `map-tools.ts` dispatch, and the
connected-agent grant sets in `pairing-grant.ts` (new signal/write classification for
`get_review` with scope and for `write_review`'s required `scope`). A connected agent that is
not re-granted the new arguments fails closed with the tool description's error, not a silent
fallback.

---

## 8. Decisions

- Target becomes `{ type: "review-page", cadence, period, scope }`. The proposed/previous
  body is the **page** body; approval applies via `writeReviewPage` inside the notebook mutex
  with the recorded `baseRev`; mismatch → `STALE`, Decision stays pending.
- Legacy pending Decisions targeting `{type:"review"}` are read as scope `overall` (one
  release), and applying one writes the overall page.
- `review.applied` log line gains `scope`.
- The Decision card's title/label includes the page ("Weekly review · Health"), so two
  proposals for the same period are distinguishable.

---

## 9. UI — the Review page

### 9.1 Layout and tab row

- Route stays `/review/:cadence`; rail rows unchanged; Daily is unchanged (single document,
  no tabs, no checklist).
- A **tab row** sits inside the 48rem page column, under the period header/pager and flush
  on top of the editor (no divider under it, no gap to the box): `role="tablist"`,
  `aria-label="Review pages"`, roving `tabIndex` and
  Arrow/Home/End per the `StudioFields` pattern (never Ctrl+Tab — the chat strip owns it).
- Tabs: `Overall` first, then each scope in manifest order; label = live area name (else the
  recorded title); a `data-status` dot/`✓` reuses the existing not-started / in-progress /
  done vocabulary; the active tab is the one and only scope selection.
- Six tabs at a narrow sheet wrap to a second row inside the column; the strip never hides a
  tab behind horizontal scroll, and the label truncates with a tooltip before that happens.
  No close/add affordances, no persistence beyond the lens.
- The checklist rail is **retired**. In its place, one progress line above the tab row:
  `2 of 5 areas done · Life review unlocks when every area is done`, or
  `Every area is reviewed — the life review is ready`, or `Review complete — read-only`.
  `Start`, `Mark … complete`, `Unlock`, `Plan next period` move to the actions row below the
  editor and act on the active page.

### 9.2 The lens binding (D2)

- `activeScope` stays derived from the lens (today's `activeScope` is already this). A tab
  press calls `setActiveSlug(scope === "overall" ? null : scope)`.
- A lens change from the title bar, keyboard, or another page moves the active tab.
- Daily ignores the lens (as today).
- `?scope=` on mount sets the lens once (`replace: true`) so external links and the companion
  can address a page; no other URL state is added. Reloads already restore the lens because
  it is persisted per vault.

### 9.3 Page editor and autosave

- One `LiveMarkdownEditor` per page; `key={scope}` so switching remounts blocks and caret
  cleanly. Value = the page body; the whole page is still the editor's unit.
- Autosave: 700 ms debounce, blur, Ctrl+S, unmount — unchanged. Timer and queue are per page;
  switching tabs flushes the page being left (a failed flush holds the switch, as period
  changes do today). Unsaved text belongs to the page it was typed on.
- Live updates: the vault change signal re-reads the open page and the notebook summary; the
  tab dots update from the summary. If the open page changed and the local draft is clean,
  adopt it; if the draft is dirty, keep the draft and show the conflict banner. Only the
  open page is re-read.
- Locked: editor read-only; tabs still switch (reading is the point); authoring controls are
  hidden; `Unlock` remains available to the operator. Figures render as markdown.
- Daily notes panel stays, once, on the overall page (not repeated per tab).

### 9.4 Empty and start states

- No notebook: the page-level empty state offers `Start the life review` (creates the
  notebook + overall page, runs overall snapshots, starts the session) and `Write it myself`
  (creates only the notebook + overall page).
- An area tab with no page: a page-scoped empty state offers `Start the Health review`
  (creates that page + runs its snapshots + session) and `Write it myself` (creates the page).
  It does **not** pre-create other pages.
- Overall tab while gated: the progress line names the areas still open and the primary
  action starts the first one.

**Phase 2 note (shipped).** The Review page is the tabbed notebook this section describes:
the tab row sits inside the 48rem column with `role="tablist"` / `aria-label="Review pages"`,
roving `tabIndex` and Arrow/Home/End; the tabs are `Overall` then each live area, and the lens
and the selected tab are one selection in both directions. The progress line carries the three
sentences above, the actions live under the editor and act on the active page, each page has
its own keyed `LiveMarkdownEditor` and autosave queue, and switching tabs or periods flushes the
page being left (a failed flush holds the switch). The checklist rail and
`AreaReviewsPanel.tsx` are deleted, weekly-plus cadences show the tab row, and Daily is the
single general page it was. The empty states, `?scope=` one-shot binding with `replace`, the
locked read-only editor with tabs still switching, and the once-only Daily notes panel are all
as specified. The `review-ui` rig was rewritten for this surface and its report/screenshots are
the phase artifact; metrics, Analytics and figures are still Phase 3+.

---

## 10. Metrics

### 10.1 Definition

`domains/{slug}/metrics/{id}.json`, validated on write:

```ts
type MetricDefinition = {
  schemaVersion: 1;
  id: string;                  // stable; marker id is `metric:<id>`
  domainSlug: string;
  label: string;               // "Training minutes"
  unit: string;                // "minutes" | "sessions" | "pages" | "ZAR" | free text, display only
  source: "derived" | "events";
  spec?: Omit<ViewSpec, "schemaVersion">;   // derived: validated by validateViewSpecForVault
  eventKey?: string;           // events: the `metric` cell value rows carry
  aggregation: "sum" | "count" | "last" | "avg";
  direction?: "higher-is-better" | "lower-is-better" | "neutral";
  target?: number | null;
  formatting?: { decimals?: number; prefix?: string; suffix?: string;
                 magnitude?: "abs" | "negate" | null };  // display only, never in ViewSpec
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt: string;
};
```

- `derived` specs are validated at definition time; a bad spec is refused before it can reach
  a share or report.
- `events` definitions are compiled to a spec at read time (see 10.2), so figures, Analytics
  and the view engine all run the same query path.
- A definition with `aggregation` alone is display metadata; the query stays in `spec`.

### 10.2 Events source

- A per-area database id `metrics` (name **Metrics**) is created on the first event
  definition: columns `date` (date), `metric` (text), `value` (number), `note` (text). Creation
  is idempotent and only in a live area.
- `log_metric(metricId, {date?, value?, note?})` inserts one row (`metric = eventKey`,
  `value` default 1, `date` default today) — immediate, per the add-vs-change law. Editing or
  deleting an event goes through the existing database row path (Decision for edits).
- Compiled spec for a definition: `databaseId: "metrics"`, `timeColumnId: "date"`,
  `filters: [{columnId:"metric", op:"eq", value: eventKey}]`,
  `measure` = the definition's `aggregation`, `measureColumnId: "value"` for non-count
  measures (count takes none). The window is rewritten to the period's bounds at run time —
  exactly what `prepopulateReview` already does to directive specs today — so there is no
  new window vocabulary and Analytics uses the ordinary `this-month`/`custom` windows.
- “Training sessions” and “training minutes” are two definitions on the same `eventKey`;
  “prayers completed”/“minutes prayed” likewise. No roll-up rules, no week-attribution rules —
  the event date is the truth.

### 10.3 Finance metrics and the new vocabulary (D3)

Two small engine additions, both general:

1. **`is-set` / `is-not-set` filter ops** in `FILTER_OPS` (validation + SQL). Semantics: a
   value is set when it is non-null and not the empty string; used to exclude transfer legs
   (`transfer_id is-not-set`) and to count only complete rows.
2. **Definition-level magnitude** (`formatting.magnitude`) applied by the figure renderer and
   Analytics: `abs` (gross display of a negative sum) and `negate`. It never changes the query
   or the stored number.

Shipped finance definitions (installed with the finance kit; also created on first review
figure pass for a vault that has the kit):

| Label | Source | Query |
|---|---|---|
| **Cash in** | derived | `finance:transactions`, `amount > 0`, `transfer_id is-not-set`, `sum(amount)` |
| **Cash out** | derived | `finance:transactions`, `amount < 0`, `transfer_id is-not-set`, `sum(amount)`, magnitude `abs` |
| **Net cash flow** | derived | `finance:transactions`, `sum(amount)` (transfers included, labelled as such) |

The shipped default review skill replaces the single "Spending this period" snapshot with
three directives (`finance-in`, `finance-out`, `finance-net`). An existing skill file is
rewritten **only** when its content is byte-identical to the previous shipped default (so an
operator's edits are never silently replaced); otherwise the release note says to reset it.

### 10.4 Figures in reports

- A figure is markdown inside `<!-- lifequest:metric:<id> -->` … `<!-- /lifequest:metric:<id> -->`,
  written by the app, found by marker (never by heading), refreshed on Start while unlocked,
  frozen at lock.
- Each figure prints: bold label with the unit, the value (or the small table if the
  aggregation is grouped — not in this phase), the **window**, the **as-of** instant, and a
  provenance line naming the source database/event key. Because review windows open before
  the period ends, the window is "period to date" and the as-of is what makes it honest.
- Placement: the area figure block goes in that area page's `Look-back`;
  the overall page gets a separate cross-domain block
  `<!-- lifequest:metrics:overall -->`: a table of area · metric · this period · previous
  period · delta. It is rendered app-side from one run per metric (a `ViewSpec` runs one
  domain per call), not a single query.
- Snapshot cost: measured at 0.2–0.7 s per Start for 12 directives on a 5k-row ledger; the
  pass runs on Start only, never on page open. Analytics computes live per open (see 10.5)
  with a small session cache.

### 10.5 Analytics page

- Route `/review/analytics`; Review wing sixth row **Analytics** (after Yearly); `PATH_WING`
  entry; wiki + `docs:check` in the same branch. The literal route sits beside
  `/review/:cadence` (React Router ranks it higher; assert in a test).
- Scoped by the lens (D2/D5): domain lens ⇒ that area's metrics; Life ⇒ all live areas'
  metrics grouped by area. Archived areas' definitions are not shown.
- A cadence selector on the page (weekly default; month/quarter/year) drives the column
  periods; columns = the last 8 periods. Each cell = formatted value + delta vs the previous
  column, with a marker for "no data" (never a fabricated zero).
- Cell interaction: for an `events` metric, click opens the period's events with `Log event`
  (date defaults to today, value, note) and edit/delete through the standard row path; for a
  derived metric, the cell opens the source database filtered to the period.
- `New metric`: a shortcut that opens the companion with a prepared prompt ("define a metric
  for …"), plus a small form fallback (label, unit, source, aggregation, target). Definitions
  are the same objects either way.
- The page is a matrix, not a dashboard: no composite score, no streaks, no colour judgement
  beyond the `direction`/`target` the operator set. It links each cell's period to that
  review's page (`/review/<cadence>?scope=<area>`).
- Listings use the existing design system (48rem content measure is not the constraint here;
  the matrix is a table surface, like Data), tokens, and `data-testid`s.

### 10.6 Governance and logs

- Creating a definition and logging an event apply immediately; **editing or deleting an
  existing definition goes through a Decision** (it changes what a review measures). This is
  the one remaining open question (§13), recorded here as the recommendation.
- Log lines: `metric.created`, `metric.updated`, `metric.logged`, `review.figures` (counts of
  written/unchanged/skipped/failed and the page). Readers ignore unknown types.
- Definition writes are attributed (`createdBy`/actor in the log); event rows keep the
  database path's `provenance` convention (`metric:<id>`).

---

## 11. Migration

`migrateLegacyReviews(root)` runs once at vault open, before the UI's first snapshot read, and
is idempotent.

1. If `.lifequest/migrations/reviews-notebook-v1.json` exists, stop (report stored counts).
2. For every `reviews/{cadence}/{period}.md` (five cadences):
   a. Parse with the existing frontmatter/`scopes` parser (inline JSON). Unreadable files are
      **left in place and reported**, never deleted.
   b. Split the body: the H1 + the four overall H2s (+ any extra headings that are not an area
      section) → `overall.md`; each `## <Name>` that maps to a scope key → that scope's page,
      with `###` subsections re-headed to `##`; a scope key with no section gets the four
      empty headings; extra headings inside an area section stay with that page.
   c. Frontmatter per page: `scope`, `title` (recorded display name), `status` from
      `scopes[key].status` (absent ⇒ `draft`), `sessionId`, `updatedAt` = the legacy file's,
      `rev: 1`.
   d. Manifest: cadence, period, `weekStartDay` (as recorded), title, `locked` (as recorded),
      `order` = `["overall", …scopes insertion order]`, `rev: 1`, timestamps from the legacy
      file.
   e. Write the notebook, then **verify** by re-assembling the compatibility projection and
      comparing heading text and every non-whitespace prose chunk with the original (heading
      level changes excepted). On mismatch: delete nothing, report the period, keep legacy.
   f. On success move the legacy file to
      `.lifequest/legacy-reviews/{cadence}/{period}.md` (outside every scanned directory so it
      is not a phantom index entry and does not inflate the weekly count).
3. Write the marker with per-period results; append one `review.migrated` log line per period.
4. On any unexpected error: leave all legacy files in place, write no marker, return
   `{ok:false,error}`; the app keeps working through the read-only legacy projection, and the
   migration retries on the next open (or from Settings → Vault, Phase 2).

Rules: never go through `writeReview` (it refuses `LOCKED`, re-canonicalises and would log
spurious writes); preserve locked state and `done` statuses; preserve a scope that has state
but no section; never drop extra headings. Test on a copied vault, never the operator's real
one.

---

## 12. Error handling

| Code | When | UI |
|---|---|---|
| `CONFLICT` | page rev mismatch | banner + Reload; keeps the draft |
| `LOCKED` | write to a locked notebook | read-only state; agent writes file a Decision |
| `GATED` | overall marked done with open areas | progress line names them; button disabled with reason |
| `NOT_OPEN` | period before its review window | existing window note |
| `NOT_FOUND` | page/notebook absent | page-scoped empty state |
| `MALFORMED` | missing required headings, bad scope, bad manifest | error line; nothing written |
| `STALE` | Decision apply whose page changed | Decision stays pending with the notice |
| `LEGACY_LAYOUT` | write to a period the migration has not reached | "this review is being migrated" + retry |

Every error names the page it is about ("weekly review · Health") and nothing is written on a
failed outcome.

---

## 13. Implementation units

1. **vault-core**
   - `paths.ts`: notebook/page/manifest/metric builders.
   - `reviews.ts` → notebook engine: manifest read/write, page parse/canonicalise, mutex, CAS,
     status/lock/gating, index, compat projection, legacy read.
   - `review-migrate.ts`: the migration + marker + report.
   - `review-tools.ts`: scope/rev tool schema and outcomes.
   - `review-skills.ts`: page-scoped prepopulate, placement by section within a page, figure
     markers; metric directives synthesis (Phase 5).
   - `metrics.ts`, `metrics-tools.ts` (Phase 4): definitions, events DB, validation, tools.
   - `views.ts`: `is-set`/`is-not-set` filter ops (+ validation and SQL).
   - `decisions.ts`: `review-page` target, apply with rev, legacy mapping.
   - `period-pack.ts`, `pairing-grant.ts`, `recurrence.ts`, `agents.ts`: consume the index /
     pages projection.
   - `index.ts`, `types.ts`: exports and types.
2. **electron**: `vault-service.ts` (channels + outcomes), `main.ts`, `preload.ts`,
   `vite-env.d.ts`, `review-sessions.ts` (kickoffs, page context), `map-tools.ts` (dispatch),
   `data-revision.ts` (new mutation channels).
3. **renderer**: `ReviewPage.tsx` (tabs, lens binding, per-page editor/autosave/conflicts,
   reading state), new `ReviewTabs`/`ReviewProgress` components, retire `AreaReviewsPanel`,
   `AnalyticsPage.tsx` (Phase 6), IPCs in `lib/ipc.ts`, styles in `notes.css` (tab row, page
   column, locked state, matrix), `App.tsx` route, `nav-items.ts` + `wing.ts` row,
   `ShortcutRunner` (no new reserved keys).
4. **docs/governance**: `LAWS/REVIEWS.md` rewrite; new spec (this file); wiki `18-reviews.md`
   rewrite, `19-data-and-databases.md` (metrics DB), `20-finance-kit.md` (cash in/out), `33-glossary.md`,
   `index.md` version when released; `mkdocs.yml` nav unchanged.
5. **tests/rigs**: five review rigs updated; new notebook rig, migration rig, metrics rig,
   analytics rig; artifacts.

Effort: ~35–40 files including tests; concentrated in the review vertical; no Prisma/SQLite
schema migration (the events database is created through the existing databases API).

---

## 14. Testing

E2E only, per repo policy; unit tests only where the E2E cannot reach (the canonicaliser
fixed-point may be a node test *before* the UI exists, and the migration verification is a
node test over fixture vaults).

| Rig | Proves |
|---|---|
| `review-notebook` (new; extends `review.tsx`) | tab row renders for weekly and not daily; lens→tab and tab→lens; status dots; gating message; start from an area tab; lock turns every page read-only; progress line replaces the rail; reading a finished period hides authoring controls. |
| `review-conflict` (new, engine-level node test + UI banner) | two writes to different pages both land; two writes to one page → `CONFLICT`, first body intact, banner shown; locked write refused; Decision apply stale refused. |
| `review-migrate` (new) | fixture vault with: a plain weekly file, a locked file, a file with `draft`/`done`/missing scopes, extra headings, and scopes with no section → split, verify, archive, idempotent second run, index/count correct. |
| `review-areas`, `review-ui`, `review-snapshot`, `review-window`, `review-live-app` | updated to the notebook APIs; snapshot placement lands on the area page, not a section of one file; window gate unchanged. |
| `review-metrics` (new) | define a metric with the agent; log dated events; figure on the area page with window + as-of; figure frozen after lock; overall cross-domain table; finance cash-in/cash-out gross and transfers excluded; default skill replacement only when byte-identical. |
| `review-analytics` (new) | `/review/analytics` route and rail row; lens scoping; cadence selector; matrix cell values/deltas; log from a cell; docs-check green. |

Every rig writes a report artifact with a capture of the shipped screen; a skipped rig counts
as nothing. Run through `/root/.local/bin/lifequest-e2e <worktree> …` so the checkout under
test is the one served.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Migration touches real locked history | verify-then-archive, never delete on mismatch, idempotent, tested on a copy; the compatibility read keeps the app usable if it aborts. |
| Two files per tab plus a manifest drift | manifest owns structure/lock only; page owns prose/status/session; invariants asserted on read (a page for a scope must have a manifest entry). |
| The lens binding surprises the operator | it is the chosen model (D2); the tab row and the title-bar lens show the same state, so the filter change is visible where it happens. |
| Tab overflow on narrow sheets | wrap to two rows inside the 48rem column; measured in the rig at dock-open widths. |
| Tool-schema break for paired agents | new args documented in the tool descriptions and kilter error messages; grants updated; the app fails closed rather than silently writing the wrong page. |
| Per-event entry rots | chat logging (`log_metric`) and Analytics log action; the review figure's page is the natural place to log the period's events while writing. |
| Metrics become a scoreboard | matrix only, no streaks/scores; `direction`/`target` set by the operator; the wiki says the page is for period comparison. |
| Figure cost on Start | measured 0.2–0.7 s for 12 directives; per-page only; never on page open; Analytics has a session cache. |
| `convertToZar` stays inert | either wire it or remove it in the same phase that ships the metrics UI (do not offer a switch that does nothing). |

---

## 16. Rollout

1. **Phase 0 — write guards.** Scope-addressed `write_review`, one engine mutex shared by
   both doors, conflict surface, and a content `rev` on today's single-file review. In Phase 0
   the CAS is on the **file** rev and is checked by whole-body writers (the page's autosave,
   the snapshot pass, legacy `write_review`); the scoped `write_review` merges that scope's
   headings under the mutex instead, so two area sessions never see a false cross-scope
   CONFLICT before Phase 1 gives each page a file and a rev of its own (§5.2). Ships alone;
   stops today's losses. UI unchanged except the conflict banner.
2. **Phase 1 — notebook engine + migration.** Storage, index, lock/gating, Decisions, tools,
   IPC, compat projection, law + spec + wiki, migration with E2E on a copy.
3. **Phase 2 — tabbed reviewer.** Tab row + lens binding, per-page editor/autosave/conflict,
   progress line, locked reading state; checklist rail retired; daily unchanged.
4. **Phase 3 — page contracts / tailoring.** Per-domain templates (required four + allowed
   extras), the Life review's cross-page synthesis contract, per-page prompts.
5. **Phase 4 — metrics substrate** (parallel with 1–3): definitions, events database,
   `define_metric`/`log_metric`/`list_metrics`, is-set filter + magnitude, finance gross
   definitions, default-skill replacement.
6. **Phase 5 — review figures:** per-page figure blocks + overall cross-domain table, window
   and as-of, frozen at lock.
7. **Phase 6 — Analytics page:** route, rail row, matrix, logging, wiki/docs-check.

Each phase is a branch from master, E2E-verified against its own checkout, and handed over
with an artifact; merge only on the operator's word. The bench opens the real vault, so the
migration branch is tested against a copy before it is put there.

---

## 17. Open questions

1. **Definition edit governance** — recommendation above: create + log immediately, edit/delete
   through a Decision. Confirm.
2. **Analytics cadence** — own selector on the page (recommended) vs follows the last review
   cadence opened.

---

## 18. Acceptance criteria

- [ ] `write_review(scope, body, baseRev)` on Health and Finance concurrently both land; a
      second write to Health with a stale `baseRev` returns `CONFLICT` and leaves the first
      body intact; a write after lock returns `LOCKED`.
- [ ] A migrated fixture vault reads back with every prose chunk, status, session id, lock and
      extra heading preserved; the second migration run writes nothing; the weekly count and
      index match the pre-migration period count.
- [ ] Weekly review shows the tab row (Overall + live areas); pressing a tab changes the
      title-bar lens and the Dashboard filter; changing the lens changes the tab; Daily shows
      no tab row; the checklist rail is gone.
- [ ] A finished weekly review opens read-only with no Start/Mark/Plan controls, and its tabs
      still switch.
- [ ] The Health page carries "Training sessions" and "Training minutes" from logged events;
      the figure shows the period window and as-of; the same figures appear frozen after lock.
- [ ] Cash in / Cash out for a period with income, expense and a transfer match gross income
      and gross spend, excluding both transfer legs; the default "Spending" figure is gone.
- [ ] Analytics under the Health lens lists only Health metrics; under Life, all areas; a cell
      logs an event and the next figure reflects it; `/review/analytics` is reachable from the
      rail and documented, and `npm run docs:check` passes.
- [ ] `LAWS/REVIEWS.md` describes the notebook and page contract; the wiki's Reviews page
      describes the shipped tabs, lock and figures; no leftover "one file holds the whole
      period" claim.
