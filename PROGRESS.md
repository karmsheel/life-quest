# Progress

Last updated: 2026-11-27 · master `5c6ee13`

What shipped, what broke, and what is next. This is the in-clone record: the detailed release
notes are assembled in `.scratch/` (gitignored) into GitHub Releases, and the published
Releases page is generated from that feed — so neither survives in a fresh clone. This file
does. It is short on purpose: one section per release, plus the current state at the top.

## State

| | |
|---|---|
| Current release | **0.3.4**, tagged 2026-11-25 |
| Released since | 0.3.0 (11-16), 0.3.1 (11-19), 0.3.2 (11-20), 0.3.3 (11-22) |
| Master | unreleased, commits past `v0.3.4` (`git log --oneline v0.3.4..HEAD`) — the agent picker, the composer's one attach control, the dock's shortcut/display doors, `Ctrl+Tab` over dock tabs, the six-file plan pack, and the Plan page renamed **Blueprints** (now at `/blueprints`, with `/track` redirecting) |
| Next | **0.3.5** after [`TASKS.md`](TASKS.md) items 1–2 land |
| Open gates | `npm run typecheck` and `npm run docs:check` green on master; the packaged smoke and live update feed run at release, not in CI |

## Release history

### 0.3.4 — 2026-11-25

The studio starts wearing the operator's own room: a picture behind the whole shell with
fit/position/dim/blur and per-panel shade, authorable by a theme file and by the companion; a
layouts picker (Studio, Page · Agent, Agent · Page, Full agent) derived from the dock's state;
the rail's chrome settles (three 1px dividers that follow day/night, build number under the
lockup, collapse square beside the vault chip); a chat another surface owns continues in the
dock as the same transcript, with that platform's mark. Also: Notebox refinements, Review pages
open header-first, and the Dashboard's Recurring block draws only what is overdue or due today.

### 0.3.3 — 2026-11-22

The capture chain becomes the vault's Inbox: the page is the **Notebox**, one box that takes
any file and a pasted link, rows worked in place (area, project, status, priority, origin) and
turned into board work without leaving the list; the companion gains `update_signal`. Behind
the pages, the studio stops waiting: answering a Decision leaves the sheet on the write itself,
and History draws fifty at a time.

### 0.3.2 — 2026-11-20

Memory for things that come round: recurring tasks as standing records (never cards), a
Dashboard **Recurring** block, a Task Manager section, and four companion tools; the five
review cadences as built-in unticked rows. The chat draws pictures in both directions through
one guarded read door. Dock tabs behave like a browser band.

### 0.3.1 — 2026-11-19

The Extensions workshop is finished: theme saves are undoable ten deep, themes import between
profiles, the whole file is authored visually on a live draft, and five bundled examples ship
(removing one keeps it removed). The supplied LifeQuest lockup moves into the rail's header;
Review becomes the period itself.

### 0.3.0 — 2026-11-16

The studio's look becomes data the app holds to a contract: a theme file sets six material
axes, moves the rail and the dock, names a sky and a frame, and places a closed vocabulary of
widgets; the companion authors those files through its own tools and the Extensions workshop
lists, previews, edits and creates them. The shell is rebuilt around the conversation
(full-screen chat, name chip, composer measure).

## Broke

Nothing user-facing has been recorded for 0.3.4. The rig evidence at tag time was mixed, and it
is recorded here because the reports themselves are gitignored:

| Report | State at tag | Reading |
|---|---|---|
| `shell-sidebar.json` | `pass: false`, 23 failures (rail topband mat, chat panel surface, dark-ladder repeats) | Ran 11-24, before its rig's last change; not a judgement of the shipped revision |
| `chat-side.json` | `pass: false`, 5 dock-surface failures | Same — ran 11-24, predates the rig change |
| `automation.json` | driver stopped: timed out waiting for `automationReady` | Rig unchanged from 0.3.3; no feature attribution recorded |
| `review.json` | `pass: false`, old (11-21) | Predates the release; the rig last changed 11-24 |
| `layouts`, `foreign-chat` | no report | Written by design; the two new rigs had not produced one in that checkout |

Lesson that is now a rule: a skipped or stale rig is evidence of nothing
([`RULES.md`](RULES.md)), and a red report must name the change that supersedes it.

**Unreleased, rig only (2026-11-27):** two harnesses under `apps/desktop/e2e/` were missing the
ThemeProvider stubs (`themesList`, `themeGetState`, `onThemesChanged`), so the shell unmounted
before any page rendered, and `wing-eyebrow.electron.mjs` still read the wing tabs as
`aria-selected` when the segmented control had moved to `aria-checked`. Both fixed; the
`wing-eyebrow` rig now passes against `master`. The `projects` rig got the same harness fix but
its driver died in the GPU process on this host before writing a report — rerun it before
leaning on it.

## Next

1. Land [`TASKS.md`](TASKS.md) item 1 (the review notebook) on top of `master`.
2. Cut 0.3.5: version bump, wiki "Version covered", release notes, `npm run release`,
   `packaged-smoke.mjs`, `update-live-feed.mjs`, `gh release create`.
3. Decide the two stale docs branches (phone client, encrypted context layer) — keep or park.

## Open limitations

- The phone client is specified and planned, not built; it queues drafts and shows pinned
  metrics only.
- Whole-vault encryption and an encrypted context layer are researched, not shipped.
- The Rust rewrite was declined; native Rust stays an option for specific hot paths only.
- The archived Next.js + Prisma tree is frozen history, not a runtime.

## How to update

- **At merge:** move the item in [`TASKS.md`](TASKS.md); add nothing here until it ships.
- **At release:** add a `### <version> — <date>` section with the headline (what the operator
  can now do) and, if any, a **Broke** note naming the report, what failed, and whether it
  predates the change it accuses. Keep the older sections; do not delete a red record.
- **At audit:** if `git tag` and this file disagree, the tags are right — fix this file.
