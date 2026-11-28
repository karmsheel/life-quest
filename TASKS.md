# Tasks

Last updated: 2026-11-28 · master `eb4fdc1`

The live queue. One **Now** per person or agent; **Next** is ordered but may be worked in
parallel when each has its own worktree; **Blocked** says why and who can unblock it. Close an
item by moving it to **Done this cycle** with its merge commit and artifact — an item that
merges but is not closed here is how a plan's `Status:` line goes stale the day it lands.

Each item names four things: **branch**, **scope** (the files it may touch), **proof** (the
command and artifact that show it works), and the **plan** or spec it follows.

## Now

- Nothing in flight. The ordered queue is under **Next**; the release that closed the phone
  window is in **Done this cycle** with its tag and its artifacts.

## Next

1. **Encrypted context layer: decide its fate.**
   branch: `docs/encrypted-context-layer` (1 commit, 509 behind master) · scope: one research
   decision commit · decision needed: promote to a spec + plan, or park it with a one-line
   status in [`PROGRESS.md`](PROGRESS.md) · proof: the decision names what ships and what does
   not.
2. **Prune the empty audit worktree.**
   branch: `audit/implicit-invariants` (0 commits ahead, 309 behind master) · it holds no work;
   either start the audit it was made for or remove the worktree so `git worktree list` is the
   real queue again.

## Blocked

- **None** with a stated blocker. The stale docs branch above is a *decision*, not blocked
  work; nobody should keep coding it until it is rebased.

## Done this cycle

| When | What | Where |
|---|---|---|
| 2026-11-28 | v0.3.6 shipped: the phone client (draft queue, pinned metric, pairing door, companion tools, Settings → Phone), Spiritual and Career with the area lens as data, the studio chrome on Documents and the wings, the unwritten review sheet, the centred update caption, and the landing page | tag `v0.3.6` (`eb4fdc1`) · `.scratch/phone-client-artifacts/{phone-engine,phone-ui}.json`, `e2e/artifacts/release-0.3.6-packaged-smoke-linux.json`, `update-live-feed.json` |
| 2026-11-27 | v0.3.5 shipped (review notebook, per-domain metrics, figures, Analytics, the plan pack, Blueprints and Customizations) | tag `v0.3.5` |
| 2026-11-27 | The phone client: an installable PWA served by its own loopback door, a draft queue that survives the studio being quit, one pinned metric with its age, the companion's three draft tools, the Settings → Phone panel, the dock strip, the phone law and its wiki page — built on the 2026-10-26 spec and plan, synced over 632+ commits | merge `0335056` · `.scratch/phone-client-artifacts/{phone-engine,phone-ui}.json` + `phone-*.png` |
| 2026-11-27 | The review notebook, per-domain metrics, figures and Analytics: tabbed notebook pages with per-domain contracts, metric definitions and dated events, app-written figures and the overall table, the Analytics matrix with logging/editing/new-metric doors, definition edits through Decisions, the whole review/metrics/analytics IPC surface, law/spec/wiki and ten engine rigs + three renderer rigs | merge `e124a34` · `e2e/artifacts/{analytics,review,database-period}.json` |
| 2026-11-27 | The six-file plan pack, the `DESIGN.md` restructure, the `AGENTS.md` repair, the docs gate for both, and the Plan page renamed **Blueprints** (with the wing-eyebrow harness repaired and its rig green) | merge `692bb72` |
| 2026-11-27 | The Plan page's identifiers follow its name: `BlueprintsPage`, `components/blueprints/`, the `.blueprints` class, and route `/blueprints` with the old `/track` address redirecting | merge `840781b` |
| 2026-11-25 | v0.3.4 shipped (Review page, background picture, layouts picker, Notebox dock links, rail dividers, recurring due-today) | tag `v0.3.4` |
| 2026-11-27 | The agent picker as data: three shipped modes, custom recipe, Customizations page | `5c6ee13` (unreleased) |
| 2026-11-26 | One attach control in the composer; a picture's chip offers "Use as receipt" | `9cea303` (unreleased) |
| 2026-11-26 | Dock shortcut reference and chat-display page toggle from the bar | `01bdad0` (unreleased) |

## Definition of done

A feature is done when **all** of these hold, in the branch that changes it:

1. `npm run typecheck` is green.
2. Its E2E rig ran against *this* checkout and left a report artifact; the picture shows the
   shipped screen. A skipped rig is not proof.
3. The user-visible change is in [`docs/wiki/`](docs/wiki/index.md), and `npm run docs:check`
   is green.
4. If it changed product behavior, the relevant law in [`LAWS/`](LAWS/README.md) says so.
5. If it changed the system's shape, [`ARCHITECTURE.md`](ARCHITECTURE.md) says so; if it
   changed the look, [`DESIGN.md`](DESIGN.md) says so.
6. It was handed over in the `READY FOR TESTING` shape ([`AGENTS.md`](AGENTS.md)), and the
   operator said the branch is good before the `--no-ff` merge.

## How to keep this true

- At the start of a task: move it to **Now** (and demote anything that is not actually being
  worked on).
- At handover: leave it in **Now** with the artifact path.
- At merge: move it to **Done this cycle** with the merge commit.
- At release: prune **Done this cycle** to the release line; the release history lives in
  [`PROGRESS.md`](PROGRESS.md) and on the published Releases page.
- If the queue and `git worktree list` disagree, the worktrees are right — fix this file.
