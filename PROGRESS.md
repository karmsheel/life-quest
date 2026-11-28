# Progress

Last updated: 2026-11-28 · master `eb4fdc1`

What shipped, what broke, and what is next. This is the in-clone record: the detailed release
notes are assembled in `.scratch/` (gitignored) into GitHub Releases, and the published
Releases page is generated from that feed — so neither survives in a fresh clone. This file
does. It is short on purpose: one section per release, plus the current state at the top.

## State

| | |
|---|---|
| Current release | **0.3.6**, tagged 2026-11-28 |
| Released since | 0.3.1 (11-19), 0.3.2 (11-20), 0.3.3 (11-22), 0.3.4 (11-25), 0.3.5 (11-27) |
| Master | `eb4fdc1` (the release commit) plus this record; the next queue is [`TASKS.md`](TASKS.md) |
| Next | decide the encrypted-context-layer branch, and settle the rigs master was already red on before the phone merge |
| Open gates | `npm run typecheck` and `npm run docs:check` green on master; the packaged smoke and live update feed run at release, not in CI |

## Release history

### 0.3.6 — 2026-11-28

The studio leaves the desktop without taking the vault with it: a **phone client** — an
installable web app the studio serves from a loopback door (`127.0.0.1:8647`) over the
operator's own tunnel — queues a draft transaction while the studio is quit and shows one
pinned metric with the time it was read. The phone holds the draft itself; the companion in
chat is still the only thing that posts it, and the door has no route that writes money. The
desktop side is **Settings → Phone** (the fifteenth tab): the access switch, the address, a
single-use pairing code with its QR, the paired-phone list and the pin. The vault gains two
locked areas, **Spiritual** and **Career**, and the area lens becomes data with five shipped
modes and a four-axis custom recipe. The studio's chrome crosses the rail: **Documents** is a
file tree with one live editor, and Define, Plan, the named Act pages and the shelf pages take
the studio header and 2px panels. A review that has not been started shows its four headings
and their prompts under **Not started**. The rail's **Update available** caption moves under
the build number, centred, and the header grows to fit it. The repository gains the product's
own landing page at `apps/landing` — one page, no framework, no build step.

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

**0.3.6.** No user-facing defect is recorded for this window, but the release was cut over a
red `master` and the gate it failed was `npm run typecheck`: the phone's `tsconfig.json` never
allowed the engine's explicit `.ts` imports, and the sync merge that gave `phone.ts` a
`calendar-date.ts` import turned the check red. It is fixed in the release's own `5763ce9`
(`allowImportingTsExtensions`, which the desktop's other two tsconfigs already had), and the
tag is `eb4fdc1`; the release evidence at tag time is recorded here because the reports are
gitignored:

| Report | State at tag | Reading |
|---|---|---|
| `update-live-feed.json` | `pass: true` after publishing | Red before `gh release create` (feed newest 0.3.5, build 0.3.6), green once v0.3.6 was the newest release: `0.3.6 -> 0.3.6` |
| `packaged-smoke.json` | `pass: false` | The native `.exe` cannot run on this box (no binfmt; `release/win-unpacked/LifeQuest.exe` fails as a shell script and the process exits 2); its door check passed only because the bench app's own door answered on `:8643` |
| `release-0.3.6-packaged-smoke-linux.json` | `pass: true`, 17 checks | Loads the shipped `app.asar` in a packaged layout, reaches `title=LifeQuest`, paints a rail reading `v0.3.6`, and opens a vault over its own bridge; it only passes with the bench stopped, for the same `:8643` reason. Screenshot beside it: `release-0.3.6-packaged-smoke-linux.png` |

**The 11-27 bench sweep is red and predates the phone merge.** Twenty-one reports were written
between 21:07Z and 22:28Z on 11-27 — after the studio-chrome and landing merges, before the
phone and sync merges — so they judge master-before-phone, not `eb4fdc1`: `shell-sidebar`
(23 failures, the same rail-topband and chat-panel surface disagreement recorded at 0.3.4 and
0.3.5), `chat-questions` (5, the settings panel rendered no sections), `daily-note` (2, a
`reviewNotebookGet` bridge call the harness does not model), `automation` and
`dashboard-card-context` (1 each, a driver timeout and an unrerendered column),
`settings-hermes` and `welcome-pane` (1 each, harness never ready). Fifteen other reports in the
sweep are green.

**Rigs for this window's own features.** `phone-engine.json` (35 scenarios) and `phone-ui.json`
(16) passed at 2026-11-27T22:30Z, minutes before the `0335056` merge, with
`phone-settings.png`, `phone-chat-strip.png`, `phone-draft.png` and `phone-home.png`; they live
in `.scratch/phone-client-artifacts/`, not `apps/desktop/e2e/artifacts/`, so
[`TASKS.md`](TASKS.md)'s evidence cell names a path a fresh run would not find. The landing
page's own E2E passed 47 of 47 at 20:31Z. The studio-chrome and update-caption changes have no
report newer than their code (`documents-lock-ui`, `layout-spacing`, `update-badge`,
`update-poll` all predate them), so their evidence is the shipped pages and the rigs that
exercised the shell.

**0.3.5.** Nothing user-facing has been recorded for 0.3.5. The rig evidence at tag time was mixed, and it
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
3. Re-run the phone rigs from the primary checkout so `phone-engine.json` and `phone-ui.json`
   land in `apps/desktop/e2e/artifacts/`, and re-run the studio-chrome and update-caption rigs
   against the shipped look; the sweep's other reds are listed under **Broke**.

## Open limitations

- The phone client is text-only: it queues draft transactions and shows one pinned metric,
  posted by the companion from chat. It has no receipt photos, chat, notifications, or
  account/store distribution, and it needs an HTTPS tunnel the operator configures. Its shipped
  asar boots and opens a vault on this box's Linux probe, but the native Windows `.exe` still
  cannot be run here.
- Whole-vault encryption and an encrypted context layer are researched, not shipped.
- The Rust rewrite was declined; native Rust stays an option for specific hot paths only.
- The archived Next.js + Prisma tree is frozen history, not a runtime.

## How to update

- **At merge:** move the item in [`TASKS.md`](TASKS.md); add nothing here until it ships.
- **At release:** add a `### <version> — <date>` section with the headline (what the operator
  can now do) and, if any, a **Broke** note naming the report, what failed, and whether it
  predates the change it accuses. Keep the older sections; do not delete a red record.
- **At audit:** if `git tag` and this file disagree, the tags are right — fix this file.
