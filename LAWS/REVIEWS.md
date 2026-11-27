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
