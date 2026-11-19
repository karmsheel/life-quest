# Extensions, finished — scope for the next four slices

**Date:** 2026-11-19
**Status:** scope, ready to hand off
**Branch:** `feat/extensions-finish` at `d2b11a2` (first commit on this branch is this document)
**Worktree:** `/root/projects/life-quest/.worktrees/feat/extensions-finish`
**Epic owner after handoff:** a fresh agent context. This document is the brief; it should not have to re-derive any decision in it.

---

## 0. TL;DR for the implementing agent

Finish the Extensions epic with three product outcomes, delivered as four slices, all data-only:

1. **S1 Trust** — version history for every theme file, plus import from a file. (~3–5 days)
2. **S2 Studio: composition** — author the composition layer visually (no JSON) with a live draft preview. (~8–10 days)
3. **S3 Studio: the rest of the look** — chrome, material, scene and palette visually, writing files, not overrides. (~5–7 days)
4. **S4 Gallery** — versioned seeding of three new curated showcase themes, so the possibility space is visible on a fresh profile. (~2–3 days)

Every slice ships with rig checks extending `apps/desktop/e2e/theme-chrome.electron.mjs`, a real `capturePage` artifact, wiki updates, and `docs:check` green. Stop and hand over in the READY shape when the four slices are green. **Do not merge, push, move the bench, or add a theme-file schema field.**

---

## 1. Where the epic stands

The whole theming ladder is on `master`:

| Rung | What it is | Status |
| --- | --- | --- |
| R0 palette | named colours layered over the built-in skin | shipped |
| R1 material | radius / elevation / type scale / density / motion / backdrop | shipped |
| R2 chrome | where wing switcher, domain lens, rail and chat dock live | shipped |
| R3 scene | procedural backdrops and card/canvas frames | shipped |
| R4 composition | closed widget vocabulary on five named regions | shipped |
| — Extensions page | `/extensions`, rail row under Automations: list, try, keep/off, edit JSON, create, remove | shipped |

The companion can already author files through the MCP tools `get_theme`, `validate_theme`, `write_theme`; every write is a ten-second preview with Keep/Revert. The shipped vocabulary is **data only**: no pack code, strict CSP, one privileged window, curated preload, allow-listed IPC, unsigned installer, GitHub-updater only, no accounts and no telemetry.

Naming is settled: **Extensions** is the umbrella and the page; one file is a **theme**.

Evidence of the boundaries already drawn: `DESIGN.md` (Theme file / Extensions rows), `docs/wiki/37-extensions.md`, `docs/research/2026-11-16-r4-composition-spike.md` (the R4 Go/No-Go and the explicit "R5 never planned").

## 2. The gap, and why these three things

The epic's promise — “customise the UX/UI without changing the core, using the built-in agent or an external one” — is technically met. What is missing is the operator's side of it:

- **Authoring.** Today a new look means hand-editing JSON or asking the agent. Settings' Appearance controls write *overrides*, not files. There is no visual way to author a theme file.
- **Confidence.** An edit overwrites the previous file with no undo beyond “Revert the preview”; sharing between profiles means finding the folder by hand.
- **Visibility.** Only two bundled showcase themes exist; a fresh profile shows a list, not a possibility space.

That is the whole remaining scope. Not a marketplace, not code packs, not network features — see §3.

## 3. Non-negotiable ground rules

1. **Data only.** No executable content, no new runtime, no URL/CSS injection. The only new persisted shapes are: theme history snapshots, an import source (rig-only), a seeded-names list in `theme-state.json`, and three more bundled `ThemeFile`s. **Do not add fields to `ThemeFile` or `composition.ts`.** The studio is a UI over the existing contract.
2. **One write path.** All writes to `userData/themes/*.json` go through one new main-process module (`electron/theme-store.ts`), used by the IPC handler and by `theme-tools.ts`. Never duplicate the validate-then-write logic. Renderer never writes files.
3. **The vault is untouched.** Themes, history, import and seeding live under `userData`. No vault writes, no provenance entries for appearance.
4. **The preview gate stays.** Writes still surface as a ten-second preview with Keep/Revert. Studio's draft paint is *not* a write: it must never be kept, never persisted, and never show the preview bar. Import previews through the same watcher as any write; it must not auto-keep.
5. **Settings' override semantics stay.** Appearance controls continue to layer operator overrides over themes. The studio writes files. Keep both; do not unify them.
6. **E2E-first.** Add checks to the existing theme rig and wrapper. Never write unit tests after code; a rig skipped is evidence of nothing. Pictures come from the rig's own `capturePage`, 1280×800.
7. **Docs in the same branch.** Any user-visible change updates the wiki (`docs/wiki/37-extensions.md` at minimum, `28-settings.md`/`DESIGN.md`/a research doc where noted). `npm run docs:check` must pass; it checks routes, rail labels, Settings tabs, nav and version coverage.
8. **Handover rules.** Do not merge, push, or move the bench until the operator says the branch is good. READY shape:
   `READY FOR TESTING — <one line>; branch: <branch> at <sha>; artifact: <path> — <what it shows>; try: <interaction>`.
9. **Accessibility.** Every new control has a label and is keyboard operable. The studio's schematic canvas is decorative; the form fields are the source of truth. Respect `prefers-reduced-motion`.
10. **No schema drift in storage.** `theme-state.json` may grow `seededShowcase` and `themeImportSources`/history are separate; keep backward reads for the old `showcaseSeeded` boolean (§10).

## 4. Decisions already made — implement these, don't re-litigate

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | The studio lives in the **Extensions page editor**, as tabs **Fields** (new) and **JSON** (existing raw editor), defaulting to Fields when the file parses. | One surface, one list, no new route. JSON stays for power users and companion parity. |
| D2 | A **draft theme** is painted by the provider without being written, kept or previewed. Provider gains `setDraftTheme(theme \| null)`. Entering the editor cancels any active preview and paints the draft; Cancel/close paints the kept theme; Save writes the file and leaves draft mode, which then previews as a normal write. | Lets the shell show the edit before save without inventing a second preview mechanism. |
| D3 | History snapshots live **outside** `themes/`, at `userData/theme-history/<file-stem>/<ISO-8601>--<sha8>.json`, 10 per file, capturing the **previous** bytes before a write. | If history files were inside `themes/`, the watcher and the theme list would treat them as themes. |
| D4 | Restore re-validates the stored snapshot and writes it through the same store, so a restore itself creates a version of the bytes it replaced. | One path, undoable forever. |
| D5 | Import is a main-process dialog (JSON filter), validated with `parseThemeFile`; destination name is the theme's `name` slug; a collision becomes `<slug>-imported`, `<slug>-imported-2`, …. | Never overwrite the operator's file, never trust the renderer with a path in production. |
| D6 | Import is testable through an E2E-only seam: `LIFEQUEST_E2E` gains `themeImportSources: string[]` (a queue the rig fills before boot). The handler uses the queued path only when `E2E_ACTIVE` (the existing build-time seam + `!app.isPackaged` + env gate). The shipped bundle must contain no such branch. | Same pattern as `updateFeedUrl` / `streamIdleMs`; the dialog itself is not rig-drivable. |
| D7 | Gallery = data additions to `SHOWCASE_THEMES` plus **versioned seeding**: `theme-state.json` grows `seededShowcase: string[]`; the legacy `showcaseSeeded: true` migrates to the two pre-existing names, then new bundled names are seeded with `wx` (never overwriting) and recorded. A name recorded at seed time is never re-added, so removal stays final. | Existing profiles get the three new gallery files; deleted files stay deleted; fresh profiles get all five. |
| D8 | The studio writes the **existing** schema: composition (regions/widgets/layouts/sources/limits), chrome enums, material axes, scene presets, palette (`colors`/`darkColors`, complete when present, WCAG AA). No new fields, no free CSS. | The contract is already proven; the value is in the interface, not the vocabulary. |
| D9 | Settings' existing Appearance controls are refactored to accept optional controlled `value`/`onChange` props. Without props they behave exactly as today (override-bound). Studio passes draft values. | Reuse without changing Settings behaviour or its test ids. |
| D10 | New user-visible test ids use the `extension-*` and `studio-*` prefixes; existing `extension-editor-*`, `extension-toggle`, `extension-try`, `extension-remove` ids stay stable. | The rig and the wrapper already key off them. |
| D11 | Keep the preview at 10 s (`THEME_PREVIEW_MS`) and the composition caps (`MAX_COMPOSITION_WIDGETS = 8`, label 32, caption 48, list 1–5). | Proven behaviour; not part of this scope. |
| D12 | No new route, rail row, or Settings tab is introduced. The studio is inside `/extensions`. | `docs:check` would otherwise demand more nav/wiki churn for no product gain. |

## 5. Environment and commands

```bash
cd /root/projects/life-quest/.worktrees/feat/extensions-finish
npm ci                                  # once; do NOT symlink the primary checkout's node_modules
npm run typecheck                       # tsc for renderer + node configs
npm run docs:check                      # wiki/nav/routes/tabs/version gate

# The only E2E entry point. It holds the lock, puts this checkout on 5173 under a
# throwaway profile, and restores the previous bench even on failure.
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/extensions-finish \
  tests/theme-chrome-e2e.test.ts
```

Warnings learned the hard way in this epic:

- `npm run build` produces the **shipped** bundle (`__LIFEQUEST_E2E_SEAM__ = false`). Do not use it to judge E2E: `lifequest-e2e` starts `npm run dev`, whose `dev.mjs` bundles main/preload with the seam **true** and relaunches. The rig imports `dist-electron/main.js` after that rebuild.
- A bare `npm test` can test whatever is on 5173 (the bench) or pass by skipping rigs. Use the wrapper; a run counts only when the report exists and `pass: true`.
- `const report = {` appears **twice** in the rig (the main report and the `main().catch` failure report). Insert new sections before the first one using a unique anchor; the R4.5 insertion used `const report = {\n    ranAt: new Date().toISOString(),\n    world,\n    checks,`.
- The wrapper (`tests/theme-chrome-e2e.test.ts`) asserts **every** file in `report.artifacts` exists. Add the new key to the report object, the wrapper's `artifacts` type, and the existence loop in the same commit.
- The SAMPLE probe is a template literal evaluated in the page: escape `\\s` in regexes, avoid nested backticks, and add fields to the SAMPLE object rather than ad-hoc evaluates where possible (the R4.5 probes are at the tail of SAMPLE: `extensionsPage`, `extensionsRows`, `extensionsCountText`, `extensionsActive`).
- Keep the watcher subscription stable (`loadThemeFilesRef` pattern). The R4.3 defect — writes silently swallowed — came from re-running the subscription effect; do not reintroduce it.
- `theme:write` currently returns `{ ok: true, value: { file } }`; preserve that envelope. New handlers return the same `Result` shape (`{ ok: true, value }` / `{ ok: false, error }`) so the preload and `vite-env.d.ts` types stay uniform.
- Every new renderer method needs: `main` handler → `preload.ts` bridge → `vite-env.d.ts` type → provider method → page usage, in the same commit.

## 6. Current state map

| Path | Role |
| --- | --- |
| `apps/desktop/shared/theme-file.ts` | `ThemeFile`, `SkinColors`, chrome/material/scene enums + defaults, `parseThemeFile`, `checkThemeContrast`, `contrastRatio`, `THEME_REQUIRED_COLORS`, `THEME_FILE` slug regex, preview constant |
| `apps/desktop/shared/composition.ts` | closed regions, widget types, layouts, data/text sources, routes, tones, polar radii, caps, widget field types |
| `apps/desktop/shared/showcase-themes.ts` | bundled `SHOWCASE_THEMES` (currently `showcase-solar-system`, `showcase-helios`) |
| `apps/desktop/electron/main.ts` | IPC handlers (`theme:list/getState/setKept/delete/read/write/openFolder/export`), `startThemeWatcher`, `seedShowcaseThemes`, `readThemeStateFile`/`writeThemeStateFile`, `E2E_ACTIVE` seam |
| `apps/desktop/electron/theme-tools.ts` | companion `get_theme`/`validate_theme`/`write_theme`; its `writeTheme` currently writes directly and must call the new store |
| `apps/desktop/electron/preload.ts` | curated bridge (`themeRead`, `themeWrite`, `themeSetKept`, …) |
| `apps/desktop/src/vite-env.d.ts` | `LifequestApi` result-typed methods |
| `apps/desktop/src/components/theme/ThemeProvider.tsx` | `themeFiles`, `themeFile`, `keptFile`, preview timer, `paintTheme`, `showPreview`, `keepThemePreview`, `revertThemePreview`, `readThemeFile`, `writeThemeFile`, `clearKeptTheme`, watcher subscription |
| `apps/desktop/src/pages/ExtensionsPage.tsx` | list/create/inline JSON editor/toggle/try/remove |
| `apps/desktop/src/styles/extensions.css` | page styles; container query collapse |
| `apps/desktop/src/components/settings/` | `MaterialControls`, `LayoutControls` (chrome), `SceneControls`, `CompositionControls` — override-bound, to be made controlled (D9) |
| `apps/desktop/src/App.tsx`, `src/components/shell/nav-items.ts` | `/extensions` route and rail row |
| `apps/desktop/e2e/theme-chrome.electron.mjs` | the theme rig: ~109 checks across 12a–12g, SAMPLE probe, report + artifacts |
| `apps/desktop/tests/theme-chrome-e2e.test.ts` | wrapper: world setup, report schema, artifact existence |
| `docs/wiki/37-extensions.md`, `28-settings.md`, `docs/wiki/index.md`, `mkdocs.yml` | operator docs |
| `DESIGN.md` | design rules incl. the Theme file / Extensions rows |
| `docs/research/2026-11-16-r4-composition-spike.md` | R4 record; leave intact, add a new research doc for this work |

## 7. Slice S1 — Trust: history and import (~3–5 days)

### What it claims

“Any save can be undone, and a theme file can move between profiles without touching a folder.”

### Design

**One store module** — new `apps/desktop/electron/theme-store.ts`:

```
saveThemeFile(file, raw): Promise<{ ok: true; file: string } | { ok: false; error: string }>
```

- validate `file` with the existing `THEME_FILE` rule and `raw` with `JSON.parse` + `parseThemeFile` (reuse the exact error messages, including the contrast pair message);
- if `themes/<file>` exists, snapshot its bytes to `theme-history/<stem>/<ISO>--<sha8>.json` before writing (atomic write, prune to the newest 10);
- write atomically (`.tmp` → rename), return `{file}`;
- callers: `main.ts` `theme:write` (after which it sends `theme:changed`) and `theme-tools.ts` `writeTheme` (remove its own write, use the store; keep the tool's returned shape);
- history helpers in the same module: `listThemeHistory(file)`, `readThemeSnapshot(file, id)`, retention/prune. Never place history under `themes/`.

**IPC (main, same `Result` envelope):**

| Channel | Args | Returns |
| --- | --- | --- |
| `theme:history` | `file` | `{ ok, value: { file, versions: [{ id, savedAt, label, bytes }] } }` |
| `theme:restore` | `file`, `id` | `{ ok, value: { file, label } }` (restore validates + writes through the store; sends `theme:changed`) |

- Validate `id` against an allow-list pattern (`/^[A-Za-z0-9:._-]+$/`, no `/`, `\`, `..`); resolve paths with `path.join` only.
- `preload.ts`: `themeHistory(file)`, `themeRestore(file, id)`. `vite-env.d.ts`: typed `Result`s.
- `ThemeProvider`: `readThemeHistory(file)`, `restoreThemeVersion(file, id)`; refresh `themeFiles` after restore.

**Import**

- IPC `theme:import` (no args in the product): if `E2E_ACTIVE` and `E2E.themeImportSources` has an entry, shift it; else `dialog.showOpenDialog` with a JSON filter. Read the file (≤ 256 KB), `JSON.parse`, `parseThemeFile`; on failure return the parse error verbatim.
- Destination: slug from `theme.name` (`a-z0-9-`, 2–40), collision → `-imported`, `-imported-2`, …; write via the store (new file ⇒ no history); return `{file,label}`. Do **not** call `themeSetKept`; the watcher previews it like any write.
- Extend the `E2E` typed object in `main.ts` with `themeImportSources?: string[]` inside the existing seam gate (same two gates; shipped bundle compiles it away).
- `ExtensionsPage`: header button `extensions-import`; busy state; success line in `extensions-status`; failures in the existing error banner; after success the list refreshes.

**Editor UI**

- The editor panel gains a **History** section: `extension-history`, rows `extension-history-row` (data `version-id`) showing relative time, label, bytes; each row has `extension-history-restore`. Restoring updates the list and (when the raw editor is open) the textarea, and becomes the preview. Empty state: “No saved versions yet — the first save starts history.”
- Keep the raw editor exactly as it is otherwise.

### Rig (new section 12h)

Checks:

1. `history-is-kept-and-a-version-can-be-restored` — save a file three times with distinct labels through the existing editor seam; assert ≥ 2 versions, newest first, labels match; restore the oldest; assert disk content is the restored label, the preview bar names the file, and `theme:list` has no history entries (history lives outside `themes/`).
2. `history-retention-caps-at-ten` — write the same file 11 times; assert 10 versions.
3. `an-imported-theme-is-validated-and-copied` — rig queues a valid fixture path, then an invalid one, then a colliding valid one (same `name`); call `window.lifequest.themeImport()` from the page; assert: first copies to `themes/<name>.json`; second is refused with the failing field named and adds no file; third lands at `<name>-imported.json`; `showcase`/existing files untouched.
4. Editor history UI: rows render with times/labels; restore button works (covered by 1's UI half).

Artifact: `themes-v2-trust.png` — Extensions editor with the History list open after a restore.

### Docs

`37-extensions.md` gains “History” and “Import” subsections; `28-settings.md` gets one cross-reference sentence; new research doc `docs/research/2026-11-19-extensions-finish.md` started with the S1 result.

### Acceptance

- A save creates a restorable version; history never appears in the theme list; import validates, copies, refuses bad files, never overwrites; restore previews and can be kept; existing 109 checks stay green.

---

## 8. Slice S2 — Studio: composition (~8–10 days)

### What it claims

“An operator can build a page composition — widgets on regions, layout, labels — without opening JSON, see it live, and save exactly what the contract allows.”

### Design

- Editor tabs inside the existing `extension-editor`: `extension-editor-tab-fields` (default when the file parses) and `extension-editor-tab-json` (existing textarea). Tab switch keeps the draft; Fields→JSON serialises the draft; JSON→Fields parses if valid, otherwise shows the parse error and stays.
- Fields view (`extension-studio`) has three parts:
  1. **Schematic** — the shell drawn as regions (page masthead, page footer, page orbit, rail top, rail footer), each with chips for its widgets; chips select a widget. `data-testid="studio-region-<region>"`, `data-testid="studio-widget-chip"`. Decorative (`aria-hidden`), with a live summary in a `role="status"` (“3 widgets: 1 badge, 1 quick action, 1 brief”).
  2. **Widget form** — the selected widget: type (`studio-widget-type`), region (`studio-widget-region`), label (`studio-widget-label`, max 32), and type-specific fields driven by the shared composition types: data source, text source, tone, route, caption, list limit, clock format, meter max. Use the existing caps; disable “Add” at 8 with the reason shown.
  3. **Layout controls** — layout stack/grid/polar (`studio-layout-*`), grid columns 2–3, polar radius tight/default/wide. Region visibility rules (e.g. page.orbit is only drawn in polar; quick actions need routes) surface as inline hints, not silent drops.
- Add/remove/reorder: `studio-add-widget` (type picker + region, defaults per type), `studio-widget-remove`, `studio-widget-up`/`studio-widget-down` (array order within the region matters for stack/polar).
- **Draft preview (D2):** provider `setDraftTheme(theme | null)`.
  - When setting: if an active preview exists, clear its timer and preview state *without repainting kept first*; then `setThemeFile(draft)` and `paintTheme(draft)`.
  - When clearing (`null`): `setThemeFile(keptTheme.current)`, `paintTheme(keptTheme.current)`.
  - Expose on the context; the page calls it on open, on every valid field change (the assembled draft is valid by construction: closed sets + length limits), and on Cancel/close. Save calls the existing `writeThemeFile` then clears draft mode; the write then previews through the watcher as usual.
  - If an external write lands while editing (watcher reload), abandon the draft with a visible notice (“the file changed on disk — your draft was discarded”) rather than fighting it.
- The studio must not touch localStorage overrides, `keptFile`, or the preview bar while drafting.

### Rig (new section 12i)

1. `the-studio-paints-a-draft-before-any-write` — open Edit on a valid file → Fields tab; add a badge to `page.masthead`; assert a composition widget (badge) appears in the shell **and** the file bytes on disk are unchanged, with no preview bar.
2. `the-studio-saves-the-composition-it-built` — add a quick action to `page.orbit`, switch layout to polar (or grid with 3 columns), change a label; click save; assert the file on disk contains exactly the draft’s composition, the preview bar appears, and the widgets render.
3. `cancelling-a-draft-leaves-the-file-and-shell-alone` — reopen, change a label, Cancel; assert disk unchanged and the shell is back on the kept look.
4. `the-composition-editor-obeys-the-contract` — Add disabled at 8 widgets; labels capped at 32; region list is the five names; no new JSON keys appear in the saved file.

Artifact: `themes-v2-studio.png` — the Fields tab with the schematic and a draft visible.

### Docs

`37-extensions.md` gains “Edit without JSON (Fields)”; `DESIGN.md`’s workshop paragraph gains the studio sentence; research doc records the result.

### Acceptance

- A composition can go from empty to saved without JSON; the draft is visibly temporary; cancel is a true undo; the saved file is byte-valid for the existing parser; keyboard-only operation works; reduced motion respected; existing checks green.

---

## 9. Slice S3 — Studio: the rest of the look (~5–7 days)

### What it claims

“The same editor can change chrome, material, scene and palette, with validation that refuses unsafe palettes before the file is saved.”

### Design

- Make the existing Settings controls reusable in controlled mode (D9): `MaterialControls`, `LayoutControls`, `SceneControls`, `CompositionControls` accept optional `value`/`onChange`; without them they keep today's override behaviour and test ids. Studio test ids are prefixed `studio-` (e.g. `studio-material-radius`) so the rig can tell the surfaces apart.
- Studio sections: `studio-chrome` (wing place/variant, domain place/variant, nav rail place/width, chat dock side, titlebar size), `studio-material` (six axes), `studio-scene` (backdrop preset, intensity, canvas frame, card frame), `studio-palette`.
- **Palette editor:** light (`colors`) and dark (`darkColors`) groups, each the complete `THEME_REQUIRED_COLORS` set. Controls: colour input plus hex text per colour; “Copy current palette” seeds from the window's effective palette so the operator edits deltas; toggles include/remove each palette (removed ⇒ inherits the skin). Live verdict: run `checkThemeContrast` on the edited palette and show every failing pair with its ratio and required minimum; the Save control stays enabled only when the assembled file passes `parseThemeFile`, and on a main-side refusal the exact error string is shown (it names the failing pair).
- Every change paints the draft (§S2 D2). No new persistence beyond the existing file fields.

### Rig (new section 12j)

1. `the-studio-moves-chrome-and-material-in-a-draft` — change the wing switcher place in Fields; assert the shell repaints while the file is unchanged; change material radius; assert the document's `--radius`-family variable changes without a save.
2. `the-studio-refuses-a-palette-that-fails-contrast` — start from “Copy current palette”, set a failing text/surface pair; assert the inline verdict names the pair and Save is refused with that message and no file change; fix the pair and save; assert the file carries the complete palette and the preview appears.
3. `the-studio-can-hand-the-palette-back-to-the-skin` — remove the palette, save; assert `colors`/`darkColors` are absent and the window is back on the skin palette.
4. Existing Settings Appearance checks must remain green (the refactor is behaviour-preserving).

Artifact: `themes-v2-studio-look.png` — the studio with palette verdict visible.

### Docs

`37-extensions.md` “Look, without JSON”; `28-settings.md` clarifies the division (“Settings = your overrides; Extensions = the file”); `DESIGN.md` boundary line; research doc.

### Acceptance

- Chrome/material/scene/palette editable visually; draft never persisted; contrast failures refused with the exact pair; Settings still behaves as before; existing checks green.

---

## 10. Slice S4 — Gallery (~2–3 days)

### What it claims

“A fresh profile shows what is possible, and an existing profile gets the new examples without being handed back files it removed.”

### Design

**Versioned seeding (D7).** `theme-state.json` becomes `{ keptFile: string | null, seededShowcase: string[] }`. Read both shapes: `showcaseSeeded: true` (legacy) migrates to `["showcase-solar-system", "showcase-helios"]` (the names that existed when that boolean was written). Boot loop: for each `SHOWCASE_THEMES` name not in `seededShowcase`, write with `{ flag: "wx" }` (EEXIST is fine), then append the name and persist. A recorded name is never re-added, so Remove stays final; fresh profiles get all five.

**Three curated data-only themes** added to `shared/showcase-themes.ts` (labels/moods are open decisions, defaults below), each parse-valid, WCAG AA, `showcase-` names, composition examples across layouts:

| Name | Mood | Look |
| --- | --- | --- |
| `showcase-paper-trail` | daylight, editorial | light palette, sharp radius, compact density, wash backdrop, titlebar-centred chrome, stack layout with a brief + list |
| `showcase-night-shift` | night, calm | dark palette, round radius, calm motion, starfield backdrop, floating rail, polar quick actions + meter |
| `showcase-control-room` | instrument panel | grid backdrop, hairline canvas, grid layout with badge/meter/quickAction, tall titlebar |

**Presentation.** Bundled files appear in the normal list (seeded), and their cards carry a small `Gallery` chip (`extension-gallery-chip`) with the line “Bundled example — remove it and it stays gone.” No new page or section.

### Rig (new section 12k)

1. `a-fresh-profile-seeds-the-whole-gallery` — on first boot, assert all five `showcase-*.json` files exist, each parses, and `theme-state.json` holds a five-entry `seededShowcase`.
2. `removing-a-gallery-theme-does-not-bring-it-back` — Remove `showcase-control-room` via the UI, reload the window, assert it is still absent and still listed in `seededShowcase`.
3. The gallery chip appears on bundled cards and nowhere else.

Artifact: `themes-v2-gallery.png` — Extensions page with the gallery themes and chips.

Note: the legacy-boolean migration path is not separately boot-testable in this rig (single boot, and the R3 showcase check depends on the real seeded content); cover it by writing the state file at world setup only if it does not break earlier sections, otherwise note it in the research doc as exercised by the fresh-profile path plus review. Do not add a unit test for it.

### Docs

`37-extensions.md` gallery paragraph; `DESIGN.md` showcase paragraph (now five bundles); `28-settings.md` mentions; research doc.

### Acceptance

- Fresh profile: five gallery files, chips, no overwrite of operator files; removal survives reload; existing checks green.

---

## 11. Cross-slice rig plan

- Extend SAMPLE with fields the new checks need (`editorTab`, `studioWidgetCount`, `studioOffers`, `draftPainted`, `historyRows`, `galleryChips`, `seededNames`) — add to the SAMPLE object, not one-off evaluates.
- The wrapper (`tests/theme-chrome-e2e.test.ts`) needs, per slice: a new key in `Report["artifacts"]`, the rig's `artifacts` object, and the existence loop.
- Keep the existing 12a–12g sections untouched except where a shared helper changes. Expect the report to grow from 109 checks to roughly 125–135; all must pass in one run.
- Artifacts must be PNGs from `win.webContents.capturePage()` at 1280×800 and written before the report is serialised.
- Run the full wrapper (not only the new tests) after every slice: the watcher, preview gate, seeding and editor paths interact.

## 12. Docs obligations (per slice, same commit)

- `docs/wiki/37-extensions.md` — the new capabilities and their limits.
- `docs/wiki/28-settings.md` — Settings overrides vs file authoring, when the studio lands.
- `DESIGN.md` — the Theme file / workshop rows: studio, history, import, gallery; keep the “data, not code” line.
- `docs/research/2026-11-19-extensions-finish.md` — one new research doc, appended per slice with the rig result and any Go/No-Go note; do not edit the R4 doc.
- No new wiki page unless a new route/tab/rail label appears (D12 says none should).
- `npm run docs:check` green before each slice commit.

## 13. Risks and how the rig falsifies them

| Risk | Falsified by |
| --- | --- |
| Draft preview accidentally persists/keeps | cancel + reload checks; disk bytes unchanged; no preview bar while drafting |
| History files pollute the theme list or the watcher | list count check; `theme:list` has no history entries |
| Import overwrites an operator file | collision suffix check, both files present |
| Import seam leaks into production | uses `E2E_ACTIVE`; `bundle-electron.mjs` compiles the seam away; no renderer-supplied path in the product branch |
| Palette editor writes an unsafe palette | main refuses with the pair named; Save disabled pre-write; rig asserts exact message |
| Seeding re-adds a removed gallery file | remove + reload check |
| Studio refactor changes Settings behaviour | existing appearance checks stay green in the same run |
| Studio writes schema drift | saved-file key audit in S2 check 4 and `parseThemeFile` on save |
| New IPC without full plumbing | typecheck (renderer + node configs) plus rig call paths |

## 14. Open decisions (defaults chosen; confirm or change before starting)

1. **Gallery names/labels** — defaults above (Paper Trail, Night Shift, Control Room). Cheap to rename before S4.
2. **History retention** — 10 per file (default; 20 if the operator prefers).
3. **Import collision** — suffix (`-imported`) rather than refuse/overwrite.
4. **Studio default tab** — Fields for parseable files; JSON always reachable.
5. **Palette editor depth** — full required-colour set for both palettes (default); if this grows too large, ship the editor for light+dark with hex inputs only and no colour picker, still in S3.
6. **Should Import/History also be exposed to the companion?** — default no (operator gestures only; the companion already has `get_theme`/`write_theme`).
7. **Gallery visual** — chip + one-line note only (default), no separate gallery carousel.

## 15. Commit rhythm

- One commit per slice (S1, S2, S3, S4) on `feat/extensions-finish`; each commit passes typecheck + `docs:check` + the full theme rig, with its artifact committed/present.
- If a slice grows, split within the slice but keep every commit green.
- At the end: one READY handover for the whole epic (or one per slice if the operator prefers to test incrementally — ask at the start).
- Never merge/push/move the bench independently; the operator merges `--no-ff` in the primary checkout and pushes.

## 16. Handoff prompt (copy-paste for the fresh agent)

> You are implementing the Extensions-finish epic on this machine.
>
> Work in `/root/projects/life-quest/.worktrees/feat/extensions-finish` (branch `feat/extensions-finish`, based on master `d2b11a2`; the worktree already exists and is clean). Read `docs/superpowers/specs/2026-11-19-extensions-finish-scope.md` end to end first — it is your brief and the first commit on the branch; do not re-derive its decisions. Read `AGENTS.md` for the worktree, bench, E2E and handover rules.
>
> Build the four slices in order: **S1 Trust** (file history + import), **S2 Studio: composition**, **S3 Studio: the look**, **S4 Gallery**. Each slice ends with: a new rig section + checks in `apps/desktop/e2e/theme-chrome.electron.mjs`, its artifact wired into `apps/desktop/tests/theme-chrome-e2e.test.ts`, the wiki/DESIGN/research updates, a green `npm run typecheck`, green `npm run docs:check`, and a green full run of `/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/extensions-finish tests/theme-chrome-e2e.test.ts`. Commit each slice when green.
>
> Hard rules: data-only (no executable content, no theme-schema fields, no new routes); one write path through the new main-side store; the preview gate and Settings overrides stay as they are; E2E is the only test mechanism; no merge, push, or bench move. When the epic is green, hand over in the READY shape from AGENTS.md and stop.

## 17. Definition of done

- [ ] S1: history + restore + import, rig-proven, artifact `themes-v2-trust.png`
- [ ] S2: composition authored and saved visually, draft is temporary, `themes-v2-studio.png`
- [ ] S3: chrome/material/scene/palette visually, contrast refusal exact, `themes-v2-studio-look.png`
- [ ] S4: five gallery themes seeded versionally, removal final, `themes-v2-gallery.png`
- [ ] One full rig run green (existing + new checks), report artifact present, all artifact files exist
- [ ] `npm run typecheck` and `npm run docs:check` green on the final commit
- [ ] Wiki updates in the same branch; research doc records each slice
- [ ] READY handover delivered; branch not merged/pushed; bench unmoved
