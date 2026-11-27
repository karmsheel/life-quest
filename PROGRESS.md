# Progress

Last updated: 2026-11-27 · master `d305a9c`

What shipped, what broke, and what is next. This is the in-clone record: the detailed release
notes are assembled in `.scratch/` (gitignored) into GitHub Releases, and the published
Releases page is generated from that feed — so neither survives in a fresh clone. This file
does. It is short on purpose: one section per release, plus the current state at the top.

## State

| | |
|---|---|
| Current release | **0.3.5**, tagged 2026-11-27 |
| Released since | 0.3.1 (11-19), 0.3.2 (11-20), 0.3.3 (11-22), 0.3.4 (11-25) |
| Master | `d305a9c`; the phone client merged after `v0.3.5` and is unreleased; the next queue is [`TASKS.md`](TASKS.md) |
| Next | decide the encrypted-context-layer branch, and settle the rigs master was already red on before the phone merge |
| Open gates | `npm run typecheck` and `npm run docs:check` green on master; the packaged smoke and live update feed run at release, not in CI |

## Release history

### 0.3.5 — 2026-11-27

A review becomes a notebook: one period is stored as a page per scope — the overall review and
each area — with the period as a tab row, each area tailoring its own page contract, and the
old single-file `## <Area>` review migrated once and kept as evidence. Metrics become the
vault's data: each area defines what it measures, dated events are logged into an events
database, and every area's review is seeded with its period's figures (including cash in, out
and net). The **Review** wing gains **Analytics**, a cross-area matrix whose cells pin the
period they measured and whose definition edits arrive as Decisions. Plan is renamed
**Blueprints** (`/blueprints`, with `/track` redirecting); Extensions becomes
**Customizations**; the chat's agent picker becomes data (three shipped modes, a custom
recipe, a Customizations page); the composer keeps one attach control; the dock bar opens the
shortcut reference and the chat display page, and `Ctrl+Tab` walks its tabs.

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

Nothing user-facing has been recorded for 0.3.5. The rig evidence at tag time was mixed, and it
is recorded here because the reports themselves are gitignored:

| Report | State at tag | Reading |
|---|---|---|
| `shell-sidebar.json` | `pass: false`, 23 failures (rail topband mat, chat panel surface, dark-ladder repeats) | Ran 11-27, after the rig's last change — it judges this revision, and it is the same disagreement as at 0.3.4: the dock and rail surface rules (`--scene-panel-*` veils, `.chat-panel`'s own fill) were not touched in this window |
| `chat-side.json` | `pass: false`, 5 dock-surface failures | Same five dock-surface expectations as at 0.3.4, same untouched rules; either the rigs or the shipped look is wrong, and neither changed here — a standing red to settle, not a regression from this window |
| `update-live-feed.json` | `pass: true` after publishing | Was red before `gh release create` (feed newest 0.3.4, build 0.3.5), green once v0.3.5 was the newest release: `0.3.5 -> 0.3.5` |
| `packaged-smoke.json` | `pass: false` | The native `.exe` cannot run on this box (no binfmt; wine 9.0 cannot render); release proof is `release-0.3.5-packaged-smoke-linux.json` instead |
| `release-0.3.5-packaged-smoke-linux.json` | `pass: true`, 17 checks | Loads the shipped `app.asar` from `release/win-unpacked` in a packaged layout; it only passes with the bench stopped, because the probe's door check (`:8643`) would otherwise be satisfied by the bench app's own door |

Lesson that is now a rule: a skipped or stale rig is evidence of nothing
([`RULES.md`](RULES.md)), and a red report must name the change that supersedes it.

**Landed with 0.3.5, rig only:** two harnesses under `apps/desktop/e2e/` were missing the
ThemeProvider stubs (`themesList`, `themeGetState`, `onThemesChanged`), so the shell unmounted
before any page rendered, and `wing-eyebrow.electron.mjs` still read the wing tabs as
`aria-selected` when the segmented control had moved to `aria-checked`. Both fixed
(`30bb24c`, `1b512ca`, `ff0866a`), and the `wing-eyebrow` rig passes against `master` (186
checks). The `projects` rig got the same harness fix but its driver died in the GPU process on
this host before writing a report — rerun it before leaning on it.

## Next

1. Settle the dock/rail surface red: either repaint the dock and the rail topband to what
   `chat-side` and `shell-sidebar` expect, or change the two rigs to the shipped look.
2. Decide the encrypted-context-layer branch — keep or park.

## Open limitations

- The phone client exists and is text-only: it queues draft transactions and shows one pinned
  metric, posted by the companion from chat. It has no receipt photos, chat, notifications, or
  account/store distribution, and the packaged Windows asar path is unverified.
- Whole-vault encryption and an encrypted context layer are researched, not shipped.
- The Rust rewrite was declined; native Rust stays an option for specific hot paths only.
- The archived Next.js + Prisma tree is frozen history, not a runtime.

## How to update

- **At merge:** move the item in [`TASKS.md`](TASKS.md); add nothing here until it ships.
- **At release:** add a `### <version> — <date>` section with the headline (what the operator
  can now do) and, if any, a **Broke** note naming the report, what failed, and whether it
  predates the change it accuses. Keep the older sections; do not delete a red record.
- **At audit:** if `git tag` and this file disagree, the tags are right — fix this file.
