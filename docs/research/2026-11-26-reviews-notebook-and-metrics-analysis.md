# Reviews as a notebook, and per-domain metrics — analysis

Research date: 2026-11-26. Scope: the proposed per-scope review pages with tabs
(“a review notebook”), plus per-domain metric definitions and an analytics surface.
Every claim below is marked **[verified]** (read in the code/spec at the cited line) or
**[inference]** (my judgement). No code was changed.

## Verdict

**Yes, the notebook split improves the reviews feature — and it is not merely a fix, it is
the correction of an architecture mismatch.** Today the *interaction* model is per-scope
(“write into the `## Health` section only”), the *storage* model is per-period (one file,
every scope), and the *transport* is whole-document (every save sends the entire file). The
proposal changes the storage and transport to match the interaction model. That is the right
direction, and it also unblocks two things the current shape cannot do at all: per-domain
report tailoring, and safe concurrent area interviews.

I would do it. But three conditions:

1. **Keep the period as one object.** A notebook is still one thing: one lock, one index
   entry, one “reviewed?” answer, one Life review that reads the pages together. If the
   split leaves six unrelated files, the dashboard, the week-start guard, Decisions,
   session binding and the Life review all have to guess. A period-level manifest (or a
   derived aggregator with the same shape as `ReviewRecord`) is not optional polish; it is
   the contract that keeps every existing consumer working.
2. **Fix the write contract, not just the file count.** Six files with no compare-and-swap
   still lose a page when the same scope is edited in two windows or by a page and an agent
   at once, and the MCP door bypasses the renderer’s write queue. The split shrinks the
   blast radius from “lose another area’s report” to “lose this page’s edit”; it does not by
   itself make writes safe. [verified]
3. **Amend the law deliberately.** `LAWS/REVIEWS.md` says, in so many words, that domain
   reviews MUST be sections of one file and MUST NOT be separate files
   (`LAWS/REVIEWS.md:11-19`). This proposal contradicts a written law. That is allowed — but
   it is a governance act with a new spec superseding decision 5 of
   `docs/superpowers/specs/2026-09-21-reviews-design.md:39`, not a refactor that quietly
   leaves the law lying. The wiki’s promise that “one file holds the whole period”
   (`docs/wiki/18-reviews.md:143-148`, and `:3-4`) becomes “one notebook holds the whole period”.

The metrics half is a **second feature that should follow, not ride along**. Most of its
substrate already exists — the review snapshot mechanism *is* a metric runtime, and the
dashboard view engine already queries area databases — so the honest description is “expose
and generalise what the review snapshots already do”, not “build analytics”. Done that way
it is high value and relatively cheap. Done as a general BI/scoreboard layer it would
collide with the product’s own anti-reference (“not a dashboard stuffed with metrics … not a
habit-tracker scoreboard”, `docs/superpowers/plans/2026-09-02-berd-systems-phase-1.md:1411`)
and would be the largest complexity increase the reviews wing has ever taken.

## Decisions taken (2026-11-26)

The operator has settled five questions that were open in the first draft of this analysis.
They are inputs to the spec, and where they overrule a recommendation below, this section wins.

1. **Every area-bearing cadence is a notebook** — Weekly, Monthly, Quarterly, Yearly. Daily
   stays a single page with no tabs. (Confirms the assumption in §2.3.)
2. **The tab is the app-wide area lens, in both directions.** Selecting a tab calls
   `setActiveSlug`, and a lens change elsewhere selects that tab. Consequence, accepted by the
   operator: browsing a review’s tabs also filters Dashboard/Data/Log, and the last review tab
   you had open persists as your lens across restarts (`domainSetActive` is persisted; see
   `apps/desktop/src/state/lens-persistence.ts`). This replaces the “smart default tab” idea in
   §2.5: the page opens on whatever the lens says, and the gated-overall dead end is handled on
   the page itself (progress line + a named next action), not by a different default.
3. **Expenses are gross** — positive, transfers excluded — not net cash flow. That makes the
   filter/sign vocabulary work (§3.2, §3.3, Phase 6) part of the metrics definition of done,
   not a follow-up.
4. **Manual metrics are dated events** — one row per session/read/prayer, not a weekly claim.
   This collapses the “manual source” into the existing database + `ViewSpec` path (§3.3):
   an event log is a table, so count and sum metrics are both ordinary derived metrics, with no
   roll-up or attribution rules. The cost is per-event entry, mitigated by chat logging
   (`log_metric`) and the Analytics page’s log action.
5. **Analytics is one Review-wing page, scoped by the selected domain.** `/review/analytics`
   shows, under a domain lens, that domain’s metrics; under Life, all areas’. It is a
   rows × periods matrix, not a dashboard (see §3.3 and the anti-scoreboard constraint in
   §3.5).

---

## 1. What is actually wrong today

### 1.1 The concurrency loss is structural, and it is exactly as reported

Every writer is whole-document:

- The page holds the entire file in the editor and autosaves the entire body
  (`apps/desktop/src/pages/ReviewPage.tsx:1076-1096`, `:389-433`).
- The agent tool has no scope argument at all: `write_review(cadence, period, body)` writes
  the whole body (`packages/vault-core/src/review-tools.ts:165-199`,
  `packages/vault-core/src/reviews.ts:583-659`).
- `writeReview` has no version, mtime, hash or etag check. It re-reads `scopes` from disk but
  takes all prose from the submitted body, then rebuilds the file from that body
  (`reviews.ts:588-622`, `:342-434`).

So the losses are:

- **(A) Page erases an agent’s area report.** The page loaded the file at T0; an area chat
  writes its report at T1; the operator types one character at T2 and the 700 ms autosave
  sends the T0 body ± one character. `canonicalizeBody` re-emits every scope in the
  (freshly read) `scopes` map under headings from the *stale* body — the area’s prose is
  gone, its status still reads `done`, the page says “Saved”. [verified]
- **(B) Agent A erases agent B.** Same mechanism without the page: both sessions run
  `get_review` → edit their section → `write_review` with a whole body. Last write wins
  wholesale. This is the reported concurrent-review failure. [verified]
- **(C) `prepopulateReview` also writes the whole body** when it plants snapshot figures
  (`packages/vault-core/src/review-skills.ts:908-913`), so pressing Start on one area can
  revert another area’s just-written text. [verified]
- **(D) Ensure / markDone / sessionId / unlock / Decision apply** are each whole-file
  read-modify-writes too (`reviews.ts:440-573`, `:661-724`, `:736-814`, `:860-925`).
  `atomicWriteFile` guarantees no torn bytes, not no lost update
  (`packages/vault-core/src/atomic-write.ts:21-69`). [verified]

Two doors exist, and only one is serialized: renderer IPC goes through the single vault
write queue (`apps/desktop/electron/vault-service.ts:301-336`), while the MCP/agent tool door
does not (`packages/vault-core/src/atomic-write.ts:10-16`). [verified]

### 1.2 The prompt already promises per-scope writes; the tool cannot deliver them

The review kickoff tells each area session: “Write into the `## Health` section only and
leave the other sections alone” (`apps/desktop/electron/review-sessions.ts:144-156`,
`:204-208`). The tool it is given writes the entire file. The model is being asked to
behave section-scoped on a whole-file API, and every such round trip is a
read-modify-write with no guard. This is the strongest argument that the proposal is not a
new architecture but the architecture the feature already assumes.

### 1.3 The fixed skeleton blocks the “tailored per domain” ambition

`canonicalizeBody` rebuilds every file into one shape: the overall four `##` headings, then
each scoped domain as `## <Name>` with exactly four `###` headings, then any other headings
appended **at the end of the file** (`reviews.ts:342-434`). And every write is rejected
unless it contains all four `##` headings (`reviews.ts:609-617`, `:881-889`). [verified]

Consequence: a Health page with `### Training`, `### Sleep`, `### Energy` cannot exist as
structure today. The extra headings are preserved but ejected out of the domain section, and
the required four are always re-imposed. Per-domain tailoring is not a matter of adding a
template; it requires the validator and canonicalizer to become per-page, which requires
per-page files. The proposal is therefore a *prerequisite* for the tailoring goal, not
merely compatible with it.

### 1.4 What one file buys, and what the split must replace

These are real, and a split that ignores them will be worse than the status quo:

1. **One lock for the period** — one boolean makes the whole review final
   (`reviews.ts:595-597`, `:685-687`).
2. **A gate that cannot race itself** — “every area is done” and “lock the file” are read
   and written from the same record (`reviews.ts:677-686`;
   `apps/desktop/src/components/reviews/AreaReviewsPanel.tsx:59-78`).
3. **The Life review reads one consistent snapshot** — one `get_review` returns the whole
   body (`review-sessions.ts:144-152`). Across N files, an area autosave during the overall
   read gives a torn synthesis.
4. **One index entry per period** for the dashboard, bound-session lookup, composition
   widgets and `list_reviews` (`packages/vault-core/src/types.ts:398-407`).
5. **One durable artifact** to diff, back up, print, or point an external tool at.
6. **One canonicalizer** — no duplicate headings, no ambiguity about which `## Health` is
   the area.
7. **Cheap invariants** — `listReviewIndex` is a directory scan (`reviews.ts:816-858`), the
   week-start guard is a file count, and opening a vault needs no migration step.

The replacement is a period container with a stable identity: one manifest (or a derived
aggregate with the same shape as `ReviewRecord`) that owns title, cadence, period,
week-start, lock, scope order and per-scope status/sessionId; six page files that own only
their prose and page-local state. Every consumer above then reads the container, not the
files.

---

## 2. Assessment of the notebook proposal

### 2.1 Correctness

**Cross-scope clobbering: solved structurally.** Once Health, Finance and the Life review are
different files, three concurrent interviews cannot overwrite each other’s prose, and the
page autosaving the Health tab cannot touch Finance. That is the reported pain, and the
split removes it at the root rather than by serialising the symptom.

**But same-scope races remain**, and they are not hypothetical: the operator may keep the
page open on Health while the Health chat writes; two windows can be on the same tab; a
locked-review Decision can carry a stale body. The necessary guards — independent of the
split, and worth doing even if the split slipped:

- **Per-file compare-and-swap**: every write carries the version it read (content hash in
  frontmatter, not just `updatedAt`); a mismatch returns `CONFLICT` with the current body so
  the page can rebase or say “changed elsewhere”.
- **One serialized write path per page**, shared by IPC and the MCP door. The in-process
  queue exists; the MCP door must join it.
- **Scope-addressed writes**: `write_review` must take `scope`, and the engine must refuse a
  body for a page it was not addressed to. Without this, an agent can still delete another
  page by sending a whole file.
- **A period lock that cannot disagree**: either the manifest holds it, or
  `markDone(overall)` writes every page’s lock in one queued pass. Never derive it from
  “some files say locked”.
- **Read-consistency rule for the Life review**: read the container version first; if a page
  hash changes during the synthesis read, re-read (or pin the version in the kickoff so the
  summary is reproducible).

Estimate: the CAS/queue/scope guards are a small, high-value change; the split is the larger
one. I would ship the guards first (see sequencing) because they fix today’s losses while
the notebook is designed.

### 2.2 Readability and browsing

The current document for a five-area vault is one vertical file with 1 H1, 4 overall H2s,
and 5 × (H2 + 4 H3s) — roughly 30 headings plus prose, all inside one internally-scrolling
box. There is no outline and no anchor: the only jump to an area is a post-Start
`scrollIntoView` keyed on the exact heading text (`ReviewPage.tsx:699-724`), and there is no
in-page mode row to switch to a scope (`ReviewPage.tsx:1071-1096`). [verified] Reading back
“what did Health say in week 39” means finding a section in a long box; the era of a review
being a *report you read* is weakened by the document being an *interview transcript
assembled in place*.

There is a second, subtler cost: **selecting a scope is currently only possible by starting
an interview.** `activeScope` is the app-wide area lens (`ReviewPage.tsx:191-196`), and a
checklist row calls `startFromRail`, which sets the lens and starts the session
(`ReviewPage.tsx:690-697`; `AreaReviewsPanel.tsx:112,142`). There is no “just show me this
area’s prose” action. Tabs make selection a view action, which is a genuine interaction
improvement independent of concurrency — and it lets each tab expose the per-scope session
id that already exists (`types.ts:388-397`).

Tabs fix the reading experience in the specific way the user describes: the overall report is
the front page (the synthesis, and the thing you most often want), and each area page is one
click away, with its own measure and no vertical search. It also maps to how the operator
already works — one interview at a time.

What is lost, and should be answered in the design:

- **At-a-glance completeness**: “is this period fully reviewed?” moves from scroll-length to
  the tab row / progress line. The tab row must carry state (Not started / In progress /
  Done / Locked), or the operator has to click six tabs to find out.
- **Cross-domain reading**: the Life review is the synthesis *by design*, so reading across
  areas should stay the Life review’s job. A “read all pages” / print view is worth having
  later, but it should not be the default.
- **Search/anchor within the period**: all blocks are mounted today, so the browser’s find
  searches the whole review; with tabs only one slice is mounted and find silently misses the
  rest. A read-only “All” tab (rendered concatenation, no editor) is the cheap mitigation and
  also answers the cross-domain-reading loss. If it is not built, say so in the wiki — do not
  rely on Ctrl+F. [verified current behaviour; inference on mitigation]
- **Keyboard flow**: tabs need arrow-key roving focus and the standard tablist semantics;
  otherwise the checklist rail is still the faster path for a keyboard user. The app already
  has the right pattern to copy: `StudioFields` is a static tablist with roving focus
  (`apps/desktop/src/components/theme/studio/StudioFields.tsx:95-155`), and `DecisionsInbox`
  and `ExtensionsPage` use the same shape. Do **not** copy the chat dock’s tab strip: that is
  a closable, pinnable, persisted working set of sessions with status marks and a menu
  (`apps/desktop/src/components/hermes/ChatPanel.tsx:2030-2125`;
  `apps/desktop/src/state/chat-tabs-persistence.ts`). Review tabs are a *derived, fixed* set —
  one per scope, no add, no close, no persistence — which is simpler and avoids a tab that
  can be lost.

### 2.3 The “mini notebook” model

The metaphor is sound, with one distinction worth keeping: a review page is **not** a Pages
canvas. Pages are area-owned boards of live blocks (`docs/wiki/21-pages.md`); review pages are
prose documents with an enforced contract, a companion session, a status and a lock. Reusing
the Pages *feature* would import a block model that does not fit. Reusing the *container*
idea — a period with titled pages, tabs as page edges, a front page — is exactly right.

Recommended naming and shape, for spec clarity:

- **Review notebook** = `(cadence, period)`, the container. One lock, one index entry, one
  dashboard row, one “done” answer.
- **Review page** = one scope inside it: `overall` plus one per live area. A page is a real
  file with its own frontmatter, status and session binding.
- **Daily** is the degenerate notebook: one page, no tabs. Keeping daily out of the tab
  model avoids an empty tab row and keeps `DAILY_REVIEW_NO_AREAS` true
  (`reviews.ts:448-450`).

Layout recommendation: `reviews/{cadence}/{period}/overall.md`, `.../{domainSlug}.md`, with
the manifest at `.../review.json` **or** no manifest and a derived container. I lean to a
small manifest for the lock and order (writing six locks in one pass on
`markDone(overall)` is the alternative, but a manifest is one write and one version). Whichever
is chosen, the container is the only thing that answers “is this period done/locked”, and the
page files never disagree with it. [inference]

Naming the files by **slug** (`health.md`) rather than display name (`Health.md`) matters:
domains can be renamed, and a review is history. The page’s H1 can carry the display name as
of the review, while the filename stays stable. [inference]

### 2.4 The tab row and the existing checklist rail

Today the rail is three things at once: scope switcher (it sets the lens), status display, and
the Start control (`AreaReviewsPanel.tsx:51-165`; `ReviewPage.tsx:1225-1236`). Tabs would
duplicate the first two. Three options:

1. **Rail remains, tabs added** — duplicative navigation; bad.
2. **Tabs replace the rail** — one navigation surface; progress becomes a line under the tab
   row (“2 of 5 areas done · Life review unlocks when all are done”); Start moves into the
   active page’s empty state (“Start the Health interview”). This is my recommendation.
3. **Tabs carry status only, rail becomes a progress card** — only if the rail has a
   non-duplicative job left (it does not, in my reading of the current code).

One layout correction to the mental picture: the rail is **not** a persistent right column.
Side-by-side needs 1108.8px of sheet — 48rem page + 17rem rail + gap + padding
(`notes.css:1746-1820`). With the chat dock open (22.5rem) on a 1440×900 window the sheet is
~824px, and the checklist is *already* a full-width row above the document. So inserting a
tab row “above the document” lands in the same band the checklist occupies: there is no
second column to free on ordinary windows, and if both survive you get two stacked rows of
the same six things. Retiring the rail is the layout-correct choice, not just the tidy one.
On a wide sheet (dock collapsed, ≥ ~1737px with the dock open) the column does come back,
and the prose gets the full measure — a bonus, not the main argument. [verified against the
CSS and the checked-in artifact; inference on the recommendation]

The **title-bar area lens** is now the tab model itself (decision 2). Today a rail press sets
the app-wide lens (`ReviewPage.tsx:691-697`), and `activeScope` already derives from it
(`ReviewPage.tsx:191-196`). The change is one line of intent: a tab press calls
`setActiveSlug(scope === "overall" ? null : scope)`, and the tab row derives from the lens as
it does today. Consequences the spec must state plainly: browsing a review’s tabs filters
Dashboard/Data/Log; the last tab persists as the lens across restarts (the lens is persisted
per vault — `apps/desktop/src/state/lens-persistence.ts`); daily still ignores the lens; and a
lens on an archived/locked area is already impossible (a saved lens falls back to Life).

Status on the tab itself is important: without it the tab row is a blind switcher. A
dot/`✓` per tab reusing the existing `data-status` vocabulary (done / in progress / not
started) and ink (`AreaReviewsPanel.tsx:47-52`; `notes.css:1939-1958`) keeps the tab row
honest. Done/In progress/Not started should survive at a glance, and Locked should be
visible on every tab of a locked notebook (read-only pages). Counts (`n of N areas done`)
belong in one place — the row’s trailing edge or beside the period — not repeated six times.

### 2.5 Default tab and empty states — the one real UX trap

The user’s intent is clear: the front page is the overall review. But the overall review is
the *last* thing written and is gated on every area
(`reviews.ts:677-686`; `ReviewPage.tsx:904-909`). So if the page always opens on the overall
tab:

- for a period that has not been started, the operator lands on a gated empty page every
  time — a dead end at the moment they came to *do* the review;
- for a period in progress, the useful next action (continue the Health interview) is one
  click away behind a page that cannot be written yet.

Recommendation, now constrained by decision 2: **overall is always tab 1 and the front page,
and the selection is the lens**. A Life-lens visitor therefore does land on the gated overall
page — that is the accepted cost of one truth. The mitigation is on the page, not in a hidden
default: the overall page carries the progress line (“2 of 5 areas done · Life review unlocks
when all are done”), a named next action (“Start the Health review”), and a button that moves
the lens to that area. Once the lens is a domain (from the title bar or a previous session),
the review opens on that tab — which is the “vice versa” the operator asked for. [decision 2]

The other states to specify: Not started (no page content yet — the tab is selectable, the
panel offers Start/Write it myself), In progress, Done, Locked/read-only (every tab read-only,
no Start/Plan controls), and “area was archived after the review” (page must still be
readable; archived areas are not listed for new reviews but history survives). Do **not**
disable not-started tabs: disabled tabs are skipped by keyboard and announce nothing; select
the tab and gate the panel with the reason in text. [inference]

Two smaller placement questions the spec should answer rather than leave to implementation:
the page also renders the period’s **daily notes** below the document
(`DailyNotesPanel`, `ReviewPage.tsx:1211-1218`), which are scope-independent — they belong on
the overall/front page (or a period-level band), not repeated under every tab; and “Write it
myself” must create only the notebook plus the selected page, not pre-create all six, so a
period’s file set reflects what was actually worked on. [inference]

One more reading-experience point, because the user framed this as a document *viewer*: a
finished period should look like a report, not like an editor with the interview controls
still attached. Today the page always shows Start/Plan/Mark-done/Skill panel under the box
(`ReviewPage.tsx:1106-1207`). In a locked notebook those authoring controls should disappear
(or collapse), leaving the tab row, the prose and the status line. That is a small change but
it is the difference between “a set of reports” and “a form”. There is no print/export path
anywhere today (`window.print`, `@media print`, export IPC all absent), so “print the
notebook” is new work, not a gap being preserved. [verified]

### 2.6 Navigation, deep links, and live updates

- The current route is `/review/:cadence` with the period held in component state
  (`ReviewPage.tsx:142`, `App.tsx:148`); there is no URL for “week 39, Health”. Tabs make
  deep-linking valuable: the companion should be able to open the page it just wrote, and a
  reload should return to the same page. Recommend `?period=…&scope=…` search params
  (`useSearchParams`, `replace: true` so tab presses do not fill the back stack) rather than
  new path segments — no new route label to document, and the pager keeps working. [inference]
- Keyboard: do **not** bind Ctrl+Tab — it is already the chat strip’s
  (`ShortcutRunner.tsx:286-300`, reserved in `shortcuts.ts:533-545`). Use a roving tablist
  (Arrow/Home/End, one tab in the tab order) copied from `StudioFields.tsx:100-157`, which is
  the app’s established static-tab pattern.
- Live updates: the page already re-reads on the vault change signal
  (`ReviewPage.tsx:371-383`, `:323-365`). With pages, the change signal should be
  per-page (or the page should re-read only the active page), otherwise every review write
  repaints every open reviewer. The checklist becomes live too, but it is now a tab row —
  which is an improvement, because the row is always visible.
- Cursor/draft safety: the current page has careful epoch/token logic to avoid adopting a
  stale body over an unsaved draft (`ReviewPage.tsx:213-252`, `:323-365`). That logic becomes
  simpler per page but must not be dropped: the same rule (unsaved local prose outranks a
  background read; a locked page overrides the draft) applies to the active tab.

### 2.7 Tailoring per domain — the payoff, and its guardrail

Once pages are files, a page can have its own structure — and that is not just a nice
consequence, it is the part of the user’s proposal the current code cannot express. The
tailoring surface does not exist today: the standing rules are **one markdown file per
cadence** (`.lifequest/reviews/<cadence>.md`, `review-skills.ts:313-333`), not per area; the
area skeleton is fixed at the same four `###` headings (`reviews.ts:181-187`); and prose typed
outside that skeleton is preserved only as an “extra” heading at the end of the file
(`reviews.ts:413-434`) — in a tabbed-but-unsplit UI it would have no tab at all. Per-domain
tailoring therefore needs three things the split makes possible: a page-per-scope file, a
per-domain authoring surface (a page template and/or per-domain rules), and a page-level
canonicaliser. The four-heading rule can stay as the *recommended* shape for area pages (it
is also the synthesis contract) while the engine stops enforcing it per area.

The guardrail is that the Life review must keep working across pages: its prompt reads each
area’s Look-back, Keep, Change and Next-period intent (`review-sessions.ts:144-152`). So the
page contract should be:

- the four common headings remain **required** on every page (they are the synthesis
  contract);
- domain-specific headings are **allowed after** them, per a per-domain template
  (Health: Training / Sleep / Energy; Finance: Income / Expenses / Net worth);
- the Life review reads the four common headings from every page, and optionally the
  domain-specific ones when it is told they exist.

That keeps “the areas are put back together” true while giving each page room to evolve. A
per-domain template is a later phase (it needs its own authoring surface and a Decision path
if agents can change it), but the split is what makes it possible, and this contract is what
keeps it safe. The likely home is a page template beside the cadence skills —
`.lifequest/reviews/pages/<slug>.md` — with the cadence skill keeping the cross-cutting rules
and the snapshot directives keeping their `domain` field. [inference]

### 2.8 Migration and the real vault

This changes storage for real data, including **locked historical reviews**. The migration
must: parse the existing frontmatter (`scopes` is inline JSON — `frontmatter.ts:108-116`),
split the body at H2 boundaries, preserve `status`, `sessionId`, `updatedAt`, `locked`,
extra headings, and scopes that have a state but no section; archive the old file **outside**
`reviews/` (anything left in a cadence directory becomes a phantom index entry —
`reviews.ts:830-833`); never go through `writeReview` (it refuses `LOCKED`, re-canonicalises
and would log spurious writes); be idempotent; and fix the weekly file count in the same
change (`agents.ts:120-134`), or the week-start guard silently unlocks. A one-release
read-only legacy shim (read the old file, present it as a legacy notebook, never write it)
is the safer half-step for a build that might be run against the real vault. Test the
migration on a copy; the bench opens the operator’s real profile. [inference, with verified
citations]

### 2.9 Effort and blast radius

Approximately **30 files**, concentrated in one vertical: the reviews engine (~925 lines
today), the path builders, the agent tool schema (and the grants that name tools), the IPC
surface and preload, decisions’ review target, the review page and checklist, the docs/wiki
and law, and five review E2E rigs. No database schema change. The riskiest contracts are the
agent-facing tool schema (`write_review` gaining a `scope`; external paired agents may be
granted it) and the decision target (a locked-review proposal must name its page). This is a
medium-large change, not a rewrite of the app. [verified counts, inference on effort]

---

## 3. Assessment of the metrics proposal

### 3.1 Judge it against what already exists — it is more than it sounds

The user frames this as a new feature; technically, **the review snapshot mechanism is
already a metric runtime** and the app already has the query engine and the storage substrate.

- **Snapshot directives** are per-cadence rules that name a domain, a target heading, a
  title, a period window and a full view spec; the app runs them before the interview, renders
  markdown, and upserts it inside `<!-- lifequest:snapshot:<id> -->` marker pairs, logging
  written/skipped/failed (`packages/vault-core/src/review-skills.ts:124-154`, `:441-514`,
  `:648-709`, `:720-961`; types at `packages/vault-core/src/types.ts:416-461`).
- **The one shipped figure is a finance metric**: “Spending this period”, over
  `finance:transactions`, with its window rewritten to the review’s own bounds, so a weekly
  review gets the week and a yearly review gets the year (`review-skills.ts:122-154`,
  `:969-995`).
- **The query engine is general**: `ViewSpec` supports sum/count/last/avg/avg-per, groupBy,
  day/week/month buckets, time windows, filters, series, currency conversion and composed
  blocks, over any area’s SQLite book (`packages/vault-core/src/types.ts:1975-2220`,
  `packages/vault-core/src/views.ts`). It is the same vocabulary dashboard cards use.
- **Any area can have databases**: the Data page creates them in any unlocked area, and the
  companion can read/write them (`docs/wiki/19-data-and-databases.md`). Only Finance ships a
  kit, though — Health, Mind, Relationships and Business have no tables by default
  (`packages/vault-core/src/types.ts:248`; no other kit exists in `packages/vault-core/src`).
  [verified]
- **There is already a metric-ish UI**: Pages have metric, chart, table and `view-ref` blocks
  (`types.ts:1385-1430`), and Goals carry a numeric `metric`/`target`/`current`
  (`types.ts:1080-1095`). Saved views live at `domains/<slug>/views/<viewId>.json`
  (`docs/wiki/19-data-and-databases.md:195`).

So the honest gap list is short and specific:

1. **No first-class, operator-owned metric definition.** A figure exists only as a fenced
   JSON directive inside a cadence’s review-rules file, per cadence, agent-editable, with no
   name/unit/target identity and no way to see it as “a metric”.
2. **No manual (“tracked directly”) source.** There is no place to record “9 training
   sessions” for a period; every existing figure is computed from a database or typed into a
   goal.
3. **No period-keyed history.** Derived figures are recomputed at review Start and frozen in
   the prose; nothing stores a series, so there are no deltas, trends or comparisons across
   periods.
4. **No operator-facing definition/entry surface.** Editing a `lifequest-snapshot` fence by
   hand (or asking the companion to) is the only path today
   (`ReviewPage.tsx:1154-1207`).
5. **No cross-domain roll-up page.** The period’s figures live scattered in each area’s
   Look-back, or in Pages blocks that are not period-scoped.
6. **The renderer/vocabulary is one notch too small** for the examples the user wants — see
   §3.2.

### 3.2 Corroboration with the finance snapshot — and a real bug it exposes

The user’s two finance metrics are derivable today, but the shipped snapshot does not
actually compute them, and the difference matters:

- The ledger convention is documented: **expenses are negative amounts, income is positive**;
  transfers are two rows sharing `transfer_id` and must be excluded from spend
  (`docs/wiki/20-finance-kit.md`, budget spend implements exactly that:
  `packages/vault-core/src/finance-plan.ts:222-252`). [verified]
- The shipped review figure is a plain `sum(amount)` over the period with **no filters**
  (`review-skills.ts:122-154`). That is **net cash flow** (income − expenses, transfers
  included), not “Spending”. A week with R5 000 in and R3 000 out displays “R2 000” under
  the heading “Spending this period”. [verified] This is a concrete, user-visible weakness
  in the one metric the reviews already have, and it is the best argument for the proposal:
  a metric needs an explicit, named definition, not a spec buried in a prompt file.
- Deriving the two metrics properly needs: `amount > 0` (income) and `amount < 0`
  (expenses, rendered as an absolute), plus **exclusion of transfer rows**. `ViewFilter`
  supports `eq/neq/gt/gte/lt/lte/in` (`types.ts:1979-1994`) but has **no is-null/not-null
  operator**, so “`transfer_id` is empty” cannot be expressed in a view spec today — and
  `neq ""` would exclude rows where the cell is absent, because SQL NULL comparisons are
  false. [verified] A metrics layer therefore needs a small vocabulary extension (a
  not-set/is-set filter, or a finance-aware source that reuses the ledger’s own transfer
  rule) rather than pretending a spec is enough.
- Net worth already exists and is a good precedent for the right split between *report
  figure* and *live analytics*: `netWorth` recomputes as of a date from opening balances +
  transactions + holdings (`finance-plan.ts:266-343`) and is exposed as a page block. It is
  not frozen anywhere unless a review writes it.

**Conclusion (decision 3: gross):** the finance half is corroborated — two definitions on
proven machinery — but **gross expenses are not buildable without the vocabulary extension**
(an is-set/not-set filter, and a magnitude/negate presentation on the definition so the result
renders positive). That extension is now part of the metrics definition of done, not a
follow-up. The shipped “Spending” figure is replaced by **Cash in**, **Cash out** and **Net**
(all transfers excluded), each of which can be checked against the ledger by hand. Health/other domains are
*not* corroborated by existing data: with no health database, “training sessions” and
“training minutes” need either a user/agent-created database (possible today, via Data and the
companion’s database tools) or manual per-period entry. That makes the manual source
**essential, not optional**, and it is the clearest signal that this should not be bolted on
as more snapshot fences.

### 3.3 Recommended model (so the metric is one object, not three features)

A **metric definition** is a small vault object, operator-owned, per area, agent-editable
through a tool, mirroring the existing saved-view pattern. Store it per area and per metric,
exactly like views (`domains/<slug>/views/<viewId>.json`, `paths.ts:457-462`;
`views.ts:2095-2248`):

```
domains/<slug>/metrics/<id>.json        // one definition per file, schemaVersion, validated
{ id, domainSlug, label, unit,
  source: "derived" | "events",
  spec?: <ViewSpec>,                    // derived: compiled through validateViewSpecForVault
  eventKey?: string,                    // events: the metric key rows carry
  aggregation: "sum"|"count"|"last"|"avg",
  direction?: "higher-is-better"|"lower-is-better"|"neutral",
  target?: number, formatting?: {decimals, prefix, suffix, magnitude?: "abs"|"negate"},
  createdBy: "user"|"agent", createdAt, updatedAt }
```

Decision 4 makes the “manual” source disappear: an event-logged metric is a **derived metric
over an events table**, so there is one query path, one renderer, one window rule. The
definition’s `source` only says where the rows come from and which UI logs them.

Why not the alternatives: a per-area `metrics.json` rewrites wholesale and can drop a
concurrent edit; rows in `domain.sqlite` are data (and the SQLite book is not even
git-committed — `docs/wiki/19-data-and-databases.md:303`), wrong for config; the domain
registry is already rewritten by kit/merge paths and mixing config in risks the DB registry;
vault-wide `.lifequest/metrics.json` loses area ownership; review frontmatter is rebuilt on
every autosave and would destroy custom keys (`reviews.ts:625-636`); markdown tables have no
parser in the engine. Per-metric JSON is the pattern the tree already trusts. [verified
precedents; inference on choice]

- **Derived** metrics run through the *same* `runViewBlocks` path the snapshots use. Do not
  build on the older client-side page-block engine (`PageCanvasPage.tsx:536-650`, only
  sum/count/last, no grouping/series) — it is a second, weaker engine and duplicating
  aggregation is the trap the view design already avoided. Validate the spec at definition
  time with `validateViewSpecForVault` (`views.ts:267-290`) so a bad spec is refused before
  it reaches a review, instead of surfacing as a `failed` snapshot at Start.
- **Dated events** (decision 4): one row per event in an events table in the area’s own book
  — `date`, `metric` (the definition’s `eventKey`), `value` (number; 1 for a pure count),
  `note`. A per-area `metrics` database is created on the first definition (or an existing
  table can be pointed at by a `derived` spec). Then “training sessions” is `count` over
  `metric = training`, “training minutes” is `sum(value)` over the same rows, and “prayers
  completed” / “minutes prayed” are the same pair — no roll-up vocabulary and no attribution
  rule, because every event has a date and the period window is the engine’s existing one.
  Rows live in `domains/<slug>/data/domain.sqlite`, which is not git-committed (the book is
  exported to `books.json`; consistent with every other row in the app) — the *definitions*
  stay git-portable JSON. [decision 4 + verified storage convention]
- **Attribution is the hard part**, and it must be a stated rule, not an implementation
  accident: a weekly value inside a monthly review needs a fixed rule (week-start inside the
  month, majority overlap, or the period the operator chose), the aggregate must print “4
  weekly entries”, a metric coarser than the review must show “not tracked weekly” instead of
  a fabricated zero, and a metric finer than the review rolls up by `rollup`. Week start is
  already frozen while weekly files exist (`LAWS/REVIEWS.md:9`), so historical windows stay
  stable. [verified constraint; inference on rule]
- **Review integration**: synthesize one snapshot directive per metric definition per cadence
  at prepopulate time (`id = "metric:<definitionId>"`, `domain`, `section: "Look-back"`,
  `window: "period"`, spec from the definition). That reuses marker upsert, placement,
  planting, lock-skip and logging verbatim, and keeps hand-written fences working. With
  per-page review files the figure becomes a page-local write instead of a whole-notebook
  rewrite — another reason to sequence the split first. [verified mechanics; inference on
  synthesis]
- **The overall page needs a different block.** A `ViewSpec` runs **one domain per call**
  (`views.ts:1305-1325`), so a cross-domain table cannot be one directive; a fake
  “overall domain” directive would be planted as a bogus area section. The overall page
  therefore gets its own marker namespace (e.g. `lifequest:metrics:overall`) rendered
  app-side from the same per-metric runs — a table formatter over N results, not a new query
  language or a second engine.
- **Frozen vs live**: a review is history, so a locked page’s figures are frozen, and an
  unlocked page may refresh on Start (today’s behaviour: refresh until lock). Every figure
  should print its window **and an as-of instant** plus its source, because (a) the review
  window opens before the period ends (daily 18:00, weekly the last day at 08:00, monthly the
  second-last day, quarterly the third-last, yearly six days early —
  `review-availability.ts:61-67`), so the number is “period to date”, and (b) today’s block
  carries no provenance or timestamp at all (`review-skills.ts:451-477`). The analytics
  surface stays live, so the operator can compare the report’s frozen number with today’s
  truth. [verified defaults; inference on policy]
- **Analytics surface**: the genuinely new UI is a **matrix** — rows = metrics by area,
  columns = recent periods, cells = value + delta vs the previous period, inline entry for
  manual metrics, jump to that period’s review. A Review-wing sixth row
  (`/review/analytics`, lens-scoped) is the natural home: it is period comparison, which is
  review work, and it keeps Home a pin board. Adding a rail row means a literal route beside
  `/review/:cadence`, a `PATH_WING` entry, the wiki’s “five rows” text and `npm run
  docs:check` all move together. The matrix component is new (`ViewCard` draws one card, not
  a matrix); charts and group-bys already exist in Pages/views and must not be duplicated.
  [verified navigation and gate; inference on placement]
- **Agent tools**: `define_metric`, `log_metric`, `list_metrics`, and a read-only
  `metrics_summary`. Registration is not free: a new `metrics-tools.ts` mirrors
  `review-tools.ts`, then `ALL_TOOL_DEFS` (`packages/vault-core/src/index.ts:428-444`), the
  dispatch chain in `map-tools.ts:233-290`, and the connected-agent grant sets in
  `pairing-grant.ts` all need the names — otherwise a paired agent never sees them.
  Governance should follow the app’s existing split: a new definition or a new value applies
  immediately (like inserting a row), an **edit to an existing definition or value** waits in
  Decisions (like editing a row) — and either way the write is attributable in the log.
  [verified registration points; inference on governance]

### 3.4 Measured cost, so the “many specs” worry is grounded

A local benchmark (temp vault, finance kit, 5,000 transactions, 12 directives) put one full
snapshot pass at **192 ms** for a weekly window and **713 ms** for a yearly one; a second
Start re-runs all 12 even when every block is unchanged (281 ms / 481 ms), because the runner
reads and folds before the upsert discovers the block is unchanged. [verified measurement on
this host, with the caveat that it is one machine and a cold-ish cache]

Two conclusions: 12 directives for a six-area review is **~0.2–0.7 s per Start**, which is
acceptable for a gesture that already starts an interview; and the cost that would not be
acceptable is running the pass on every page open (it does not happen today — it runs on
Start, `ReviewPage.tsx:596-640`). Keep that invariant, cap definitions per area (e.g. 8),
and only if it becomes a problem add a cache keyed by (spec hash, database revision).

### 3.5 Risks

- **Product drift**: the anti-reference is explicit — not a dashboard stuffed with metrics,
  not a habit-tracker scoreboard (`docs/superpowers/plans/2026-09-02-berd-systems-phase-1.md:1411`).
  The vision says it twice: “A pin board of spend and net worth is welcome. A Home that feels
  like a metrics terminal is not” (`VISION.md:94-95`), and the dashboard page promises “the
  board does not grade you” (`docs/wiki/06-dashboard.md:34-35`). Metrics here must stay
  *inputs to the written review*: no streaks, no badges, no composite score, no red/green
  judgement unless the operator sets a direction/target.
- **Metric proliferation and honesty**: a metric with no unit, no period, no source is
  decoration. Units/formatting are new fields (`ViewSpec` has none), mixed currency already
  warns (`views.ts:1619-1622`), and `convertToZar` is currently **inert** — declared,
  validated and documented, but never read by the runner; conversion of finance amount
  measures happens automatically regardless of the flag (`views.ts:1594-1622`,
  `:1948-1963`). [verified] A metric UI that offers a switch that does nothing is worse than
  no switch; either wire it or drop it.
- **Manual entry is a second data-entry chore**; if it is not part of the review flow (enter
  the week’s number while writing the Health page) it will rot. The figure block being
  editable in place is not a nicety — it is the difference between a living metric and an
  abandoned one.
- **Config in the wrong store**: the failure mode is subtle and permanent (values in
  frontmatter wiped by autosave; definitions in the registry damaged by kit operations). The
  model above is chosen specifically to avoid it.
- **Complexity budget**: definitions + values + page contracts + analytics + agent tools is
  a larger surface than the notebook itself. Sequence it; ship one derived finance metric,
  one manual metric, and the figures block before the analytics page.

### 3.6 What I would *not* build

- A general charting/BI page that duplicates Pages and the view engine.
- Metrics on the dashboard as a default (the dashboard is a pin board; metrics belong to
  reviews, which is where the user says they matter).
- Automatic metric suggestions from every database (vanity metrics by construction).
- Per-day tracking for every metric (prayers/meditation) before the per-period flow works;
  offer day-granularity only where the source database is daily, and let roll-up do the rest.
- A second aggregation engine for metrics. One query engine is the design; the page-block
  engine is a trap, not a model.

## 4. Combined judgement

| Question | Answer |
|---|---|
| Does the notebook split improve reviews? | **Yes — materially.** It fixes the concurrency loss at the root, fixes the reading experience, aligns the tool contract with the interview contract, and is the prerequisite for per-domain tailoring. |
| Is it a defining-feature-level improvement? | **Yes.** Reviews are named in the vision as one of the prescribed durable artifacts (`VISION.md:13`); today the artifact is shaped like an interview transcript. The notebook makes it shaped like a report set you can read. |
| Is the cost justified? | **Yes, with the period container and CAS guards.** ~30 files, one vertical, no schema migration for databases. The risk is concentration in the reviews engine, not breadth. |
| Are metrics corroborated by the finance snapshot? | **Partly.** The machinery is proven (spec → run → render → plant), and income/expenses are derivable from the ledger. But the current shipped figure is net cash flow mislabelled as spend, transfer exclusion is not expressible today, and non-finance domains have no data source — so metrics need a real definition object and manual entry, not just more fences. |
| Should they ship together? | **No.** Split + guards first (correctness and reading), metrics second (value, on a safer substrate). Tailoring third. |

### Suggested sequencing

1. **Phase 0 — write guards (small, immediate relief).** Scope-addressed `write_review`, a
   per-file CAS/version, one serialized write path for both doors, and a conflict result the
   page can surface. This alone stops (A)–(D) in §1.1 without touching storage — and nothing
   auto-written (a snapshot, a metric figure) should ship on the current whole-file contract.

   *A tempting shortcut to reject as the concurrency answer:* renderer-only tabs that slice
   and splice one canonical body (no engine change). It is genuinely cheap and gives the
   reading benefit alone, but it writes the whole body, so it does **not** fix the clobbering
   and would make the operator believe it did. If it is built as a stopgap, ship it as a
   reading feature only, after Phase 0, and say so.

2. **Phase 1 — notebook storage + page model.** Period container, per-page files, lock and
   gating bookkeeping, migration + legacy read, tool/IPC/Decision changes, Law + wiki + spec.
   Keep the UI temporarily rendering each page as a section if that shortens the phase; a
   page-level editor can follow immediately.
3. **Phase 2 — tabbed reviewer, lens-bound.** Tabs derive from and write the app-wide lens
   (decision 2); progress line replaces the checklist rail; per-page editor and live refresh;
   daily unchanged; locked notebooks read as reports.
4. **Phase 3 — page contracts / tailoring.** Per-domain required + optional headings,
   templates, and the Life review’s cross-page synthesis contract.
5. **Phase 4 — metrics substrate (can run in parallel with 1–3; touches no review file).**
   Definitions as per-area JSON, the per-area events database and `define_metric` /
   `log_metric` / `list_metrics`, the is-set filter op and magnitude presentation, and the
   first three definitions: **Cash in**, **Cash out** (gross, transfers excluded), **Net**,
   plus one event metric (training minutes) to prove the other source. Replace the mislabelled
   “Spending” default.
6. **Phase 5 — review figures (hard dependency on Phase 1).** One figure per definition on its
   area page, the cross-domain block on the overall page, window + as-of + provenance, frozen
   at lock.
7. **Phase 6 — Analytics page.** `/review/analytics` as a Review-wing sixth row, a rows ×
   periods matrix scoped by the lens (decision 5), deltas and targets, inline event logging,
   jump-to-review; wiki + `docs:check` in the same branch.

### Decisions taken — and the two still open

Settled (2026-11-26): all area cadences are notebooks (daily isn’t); tab and lens are one
two-way binding; expenses are gross; manual metrics are dated events; Analytics is one
Review-wing page scoped by the selected domain. See “Decisions taken” above.

Still open — both can be settled in the spec without blocking Phase 0–1:

1. **Definition edit governance.** I recommend: creating a definition and logging an event
   apply immediately (they are new data); editing or deleting an existing definition goes
   through a Decision (it changes what the review measures). This matches the app’s
   add-vs-change split.
2. **Analytics cadence.** Does the page have its own weekly/monthly/quarterly/yearly selector
   (my recommendation), or does it follow the rail’s current review cadence? A selector is one
   more control but lets the operator compare a quarter without leaving Analytics.

---

## 5. Evidence notes

- Everything in §1, §2.2–2.6, §3.1–3.2 is read from the files cited, not inferred; the
  citations are to the current master checkout at the research date.
- The layout claim in §2.4 (the rail is already a row when the dock is open) comes from the
  CSS container query (`notes.css:1746-1820`) plus the checked-in review artifact’s measured
  page/rail geometry — not from a live run.
- The snapshot cost figures in §3.4 are a local measurement on this host (temp vault, finance
  kit, 5,000 transactions, 12 directives); no app was run and no vault was modified.
- The migration, sequencing, effort and UX recommendations are judgement ([inference]), but
  each rests on a verified constraint above.
- Deliberately not claimed: that the split removes all write races (it does not); that
  metrics can be built without new storage (manual values need a durable home); that the
  current “Spending” figure is correct (it is not — it is net cash flow); that a tabbed UI
  alone fixes concurrent interviews (it does not).
- No code or vault file was changed in producing this analysis.
