# Reviews — Laws

A review period is a **notebook**: a directory under `reviews/{cadence}/{period}/`
holding `review.json` (identity, order, lock) and one markdown page per scope —
`overall.md` and `{area-slug}.md`. Domains are pages, not sections.
The companion assembles them; the notebook locks when the overall review is done.
Planning stubs live under `planning/` and do not hold a plan body yet.
Week start is a vault setting and cannot change while weekly review or planning files exist.

## MUST / MUST NOT

- A review period MUST be a notebook at `reviews/{cadence}/{period}/` with a
  `review.json` manifest and one markdown page per scope in it.
- A domain review MUST be its own page (`{area-slug}.md`), not a section in another page.
- Each page MUST carry its own `scope`, `title`, `status` (`draft` or `done`),
  optional `sessionId` and `rev`; `rev` starts at 1 and increments on every accepted
  body write.
- The manifest MUST own identity, page order, `weekStartDay`, the lock and the
  structural `rev`; a page body write MUST NOT change the manifest's `rev`.
- A page write MUST compare-and-swap on that page's `rev`, and MUST NOT be accepted
  while the notebook is locked (`LOCKED`) or before its review window (`NOT_OPEN`).
- A daily review MUST be one general review with one `overall` page and no area pages.
- An overall review on a weekly-or-longer cadence MUST NOT be marked done until every
  live area's page is done. Completing an area page MUST NOT lock anything.
- The notebook MUST lock when the overall review is marked done; a locked notebook
  refuses every page and compatibility write. A change to a locked review goes
  through a Decision targeting `{ type: "review-page", cadence, period, scope, rev }`.
- The compatibility projection (`getReview`) and the whole-body write exist for one
  release only: reads assemble the pages, writes split the body and land only the
  pages whose text changed. New code MUST write pages.
- A review in the pre-notebook layout (one `.md` per period) MUST be read-only in
  the app until `migrateLegacyReviews` has split and archived it; a write MUST refuse
  with `LEGACY_LAYOUT`.
- The migration MUST verify the split (prose and headings) before archiving the
  legacy file under `.lifequest/legacy-reviews/`, MUST leave an unverified file in
  place, and MUST be idempotent behind
  `.lifequest/migrations/reviews-notebook-v1.json`.
- Planning stubs MUST live under `planning/` and MUST NOT hold a plan body.
- Week start MUST NOT change while weekly review or planning files exist.

- Review figures MUST be written by the app on Start only, never on page open;
  a locked notebook MUST NOT refresh or change any figure.
- An area page's figures MUST be app-written blocks found by marker, never by
  heading: one figure per metric definition under `Look-back`, inside
  `<!-- lifequest:metric:<definitionId> -->` and
  `<!-- /lifequest:metric:<definitionId> -->`, in definition order.
- The overall page (daily included, which has only an overall page) MUST carry a
  single cross-domain table inside `<!-- lifequest:metrics:overall -->` and
  `<!-- /lifequest:metrics:overall -->`, with one row per definition of every
  live area in notebook order: area, metric, this period, previous period, delta.
- A figure MUST print its label, value with unit, the window it read, the as-of
  instant at local minute precision, and its provenance (the events key or the
  source database). A window with no rows MUST print the no-rows sentence or
  `—`, never a fabricated 0; a delta MUST be the signed change of the two
  DISPLAYED values and MUST be `—` when either side has no data.
- A figure's window MUST say `(period to date)` while the pass runs before the
  window's end date, because a review window opens before its period ends.
- Placement MUST replace a block by its own markers and MUST preserve every
  other line of the page, including operator prose before and after the figures.
  A second Start with unchanged content MUST NOT duplicate a block.
- A per-definition block whose definition no longer exists MUST be removed by
  the next pass while the notebook is unlocked.
- A hand-written ```lifequest-snapshot``` fence in the cadence rules MUST keep
  working beside the app-written figures and MUST be refreshed by the same pass.
- A shipped default review skill MUST be replaced by the current default exactly
  once only when the file on disk is byte-identical to a previously shipped
  default (0.3.4 and Phase 4); an operator-edited file MUST NOT be matched or
  touched. The shipped default MUST NOT carry finance fences — figures come from
  the metric definitions.

## Page contract

- Every page MUST carry the four common H2 headings `Look-back`, `Keep`,
  `Change`, `Next-period intent`, in that fixed order. They are the Life
  review's synthesis contract and MUST NOT be tailored away or reordered.
- A live area MAY have a page contract at
  `.lifequest/reviews/pages/{area-slug}.md`: an optional single `#` title, then
  one `##` heading per extra section, in the order the page keeps them. A
  contract names the area's own sections only; the four common headings MUST
  NOT appear in it.
- A new area page MUST be seeded with the four common headings, then the
  contract's sections, empty and in contract order. An area with no contract
  MUST be seeded with the four common headings only.
- A page write MUST emit, in order: the four common headings; the contract's
  sections the page already holds, in contract order; then any other extra
  heading in the order the page held it. Extras are first-class — a heading no
  contract names MUST be preserved — and prose under every heading MUST be
  preserved. A heading deeper than H2 MUST stay inside the H2 section it was
  written under, in its original order, and MUST NOT be moved to the end of the
  page.
- Writing or changing a contract MUST NOT rewrite an existing page. The contract
  seeds pages created after it, and its order applies at that page's next
  accepted write.
- A contract write MUST refuse an H3-or-deeper heading, a duplicate heading, one
  of the four common headings, a contract naming no extra heading, more than 12
  extras, `overall`, and any area that is not live.
- The overall page MUST have no area sections. The Life review MUST read every
  area page's four common headings and synthesise them under the four common
  headings, MUST NOT copy an area's extras, and MUST NOT rewrite an area page.
- A contract write MUST append one `review.template-written` life-log line
  naming the actor.

## Figures

A review page's numbers are app-written blocks, delimited by markers so a pass
finds its own writing and nothing else. One per metric definition on an area
page:

```markdown
<!-- lifequest:metric:cash-in -->
**Cash in** · 2026-10-12 → 2026-10-18 (period to date)

5,000 (ZAR)

_As of 2026-11-27 15:59 · Source: the finance:transactions database_
<!-- /lifequest:metric:cash-in -->
```

And one cross-domain table on the overall page (daily included):

```markdown
<!-- lifequest:metrics:overall -->
**Metrics this period** · 2026-10-12 → 2026-10-18 (period to date)

| Area | Metric | This period | Previous period | Δ |
| --- | --- | --- | --- | --- |
| Health | Training sessions | 3 sessions | 2 sessions | +1 |
| Finance | Cash in | 5,000 (ZAR) | 4,000 (ZAR) | +1,000 |

_As of 2026-11-27 15:59 · Previous period: 2026-10-05 → 2026-10-11_
<!-- /lifequest:metrics:overall -->
```

- A currency unit prints in parentheses (` (ZAR)`), any other unit after the
  number (` 3 sessions`); a definition's display formatting (decimals, prefix,
  suffix, magnitude) is applied to the printed value only, never to the query.
- Figures are written from the area's metric definitions through one
  `getMetricsSummary` read per definition; there is no second aggregation path.
- Figures refresh on Start while the notebook is unlocked and freeze at lock.
- A `lifequest-snapshot` fence the operator wrote still runs in the same pass and
  writes its own marker block, so a custom figure and the definitions' figures
  share the page.
