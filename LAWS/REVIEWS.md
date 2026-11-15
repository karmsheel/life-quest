# Reviews — Laws

Reviews are vault markdown under `reviews/{cadence}/{period}.md`.
One file per period; domains are sections.
The companion assembles them; the file locks when the overall review is done.
Planning stubs live under `planning/` and do not hold a plan body yet.
Week start is a vault setting and cannot change while weekly review or planning files exist.

## MUST / MUST NOT

- A review MUST be one markdown file per cadence and period at `reviews/{cadence}/{period}.md`.
- Domain reviews MUST be sections in that file, not separate files.
- A daily review MUST be one general review and MUST NOT have area sections.
- An overall review on a weekly-or-longer cadence MUST NOT be marked done until every live area's
  section is done. Area reviews remain sections in that one file, and completing one MUST complete
  only that area.
- The overall review file MUST lock when overall is marked done.
- Planning stubs MUST live under `planning/` and MUST NOT hold a plan body.
- Week start MUST NOT change while weekly review or planning files exist.
