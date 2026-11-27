# Evidence appendices — LifeOS benchmark (2026-11-05)

Raw inventories behind [../2026-11-05-lifeos-competitive-benchmark.md](../2026-11-05-lifeos-competitive-benchmark.md).

| File | Subject | Rows | Method |
|---|---|---|---|
| `competitor-features.md` | Edi Life OS code-level feature inventory | 148 | Every capability tied to `file:line` in `edrisranjbar/lifeos` @ `25fe400`; status shipped/shipped-partial/dead-code |
| `lifequest-features.md` | LifeQuest shipped-feature inventory | 101 | `docs/wiki/` + `LAWS/` verified against `packages/vault-core/src` and `apps/desktop/src` @ `0599009`; status shipped/shipped-partial/docs-only |
| `competitor-product-ux.md` | LifeOS positioning, UX, design system, market signals | 88 | Repo docs, landing page, screenshots/demo GIF, GitHub/CI APIs |

These are working notes, not the report. The synthesis, decisions and backlog live in
the main report. Where a note and the code disagree later, the code wins — update both.

Known limits: LifeOS was not booted (no PHP/MySQL runtime available), so runtime claims
are code/doc inference; LifeQuest's E2E suites were not re-run; GitHub counts are a
2026-11-05 snapshot.
