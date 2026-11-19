# Extensions, finished — S1 trust, S2 studio, S3 look, S4 gallery

- **Date:** 2026-11-19
- **Branch:** `feat/extensions-finish` (off master `d2b11a2`)
- **Brief:** `docs/superpowers/specs/2026-11-19-extensions-finish-scope.md` §7 (S1), §8 (S2),
  §9 (S3) and §10 (S4); interfaces in `.scratch/extensions-finish/contract.md` §3 (S1), §4
  (S2), §5 (S3) and §6 (S4).
- **Decision it serves:** the epic's operator side — *confidence*, *authorship*, *control of
  the whole file* and *visibility*. S1 made an edit safe to take back and a theme file
  portable between profiles; S2 made the composition authorable without JSON; S3 made the
  rest of the file — chrome, material, scene and palette — authorable in the same studio,
  refusing an unsafe palette before it can be saved; S4 put five curated examples in a fresh
  profile and versioned the seeding so a removed file stays removed. None adds a schema
  field: all four are gestures over the data model the ladder already proved.

## S1 result (2026-11-19)

### What shipped

**One write path.** New main-process module `apps/desktop/electron/theme-store.ts` now owns
every write to `userData/themes/*.json` — the `theme:write` handler, the companion's
`write_theme` tool, `theme:restore` and `theme:import` all call `saveThemeFile(file, raw)`.
It validates the file name with the shared `THEME_FILE` rule and the bytes with
`JSON.parse` + `parseThemeFile` (same messages as before, including the contrast pair),
snapshots the previous bytes when the file exists, and writes atomically (`.tmp` + rename).
No second validate-then-write path exists.

**History.** Each save over an existing file copies the bytes it replaces to
`userData/theme-history/<file-stem>/<ISO-8601>--<sha8>.json` before writing; the newest ten
per file are kept and older ones pruned. History lives **outside** `themes/`, so the watcher
and the theme list never see a snapshot as a theme. New IPC `theme:history` and
`theme:restore`; the renderer gained `readThemeHistory` / `restoreThemeVersion`, and the
existing editor panel gained a **History** section (version rows with relative time, label
and byte size, a **Restore** per row, and an empty state: *No saved versions yet — the first
save starts history.*). A restore re-validates the stored snapshot and writes it back
**through the same store**, so it snapshots the bytes it replaces: an undo that is itself
undoable. The restored bytes then ride the normal ten-second preview with Keep/Revert.

**Import.** `theme:import` is a main-process gesture: in the product it opens a JSON-filter
file dialog; the chosen file is read (≤ 256 KB), parsed with `parseThemeFile`, and copied
into `themes/` under the file name the theme's own `name` slug demands (`night-runway` →
`night-runway.json`). A collision becomes `<slug>-imported.json`, then `-imported-2`, … — an
import never overwrites an operator file. The copy is not kept: the watcher previews it like
any new file. The page header gained **Import from file** with a busy state and a status
line; refusals land in the existing error banner. The dialog itself is not rig-drivable, so
the rig fills an E2E-only queue (`LIFEQUEST_E2E.themeImportSources`) behind the existing
`__LIFEQUEST_E2E_SEAM__ && !app.isPackaged` gate; the shipped bundle compiles that branch
away, and the handler only consults the queue under `E2E_ACTIVE`.

Both gestures are operator-only: the companion keeps `get_theme`, `validate_theme` and
`write_theme` and gains neither. No `ThemeFile` or composition field was added, no route,
rail row or Settings tab, and nothing is written into the vault.

### Rig evidence (new section `12i`)

The theme rig (`apps/desktop/e2e/theme-chrome.electron.mjs`) gains a section after `12h`
that carries the slice's claims:

- `history-is-kept-and-a-version-can-be-restored` — three distinct saves through the editor
  seam; history lists at least two versions newest-first with matching labels; restoring the
  oldest puts its label back on disk and the preview bar names the file; the editor's
  History rows render time/label/bytes; `theme:list` contains no history entry.
- `history-retention-caps-at-ten` — eleven writes of one file leave exactly ten versions.
- `an-imported-theme-is-validated-and-copied` — a queued valid fixture lands at
  `themes/<name>.json`; an invalid one is refused with the failing field named and adds no
  file; a valid one colliding on `name` lands at `<name>-imported.json`; the bundled showcase
  files are untouched and nothing is auto-kept.
- `theme:list` stays history-blind — a snapshot lives in `theme-history/`, never under
  `themes/`, so no version can appear as a theme (also asserted by the first check).

Artifact: `apps/desktop/e2e/artifacts/themes-v2-trust.png` — the Extensions editor with the
History list open after a restore, captured with `capturePage` at 1280×800. Report:
`apps/desktop/e2e/artifacts/themes-v2.json`, wrapped by
`apps/desktop/tests/theme-chrome-e2e.test.ts` (artifact key and existence loop added with
the section).

**Check count:** the report is the source of truth. The gate started from the **109** checks
the R4.5 run left; `12i` adds the S1 checks and the measured total is **115 checks, all
passing** (`report.pass: true`, `failures: []`, 27 artifacts) in the slice's authoritative run
on 2026-11-19. A skipped rig is evidence of nothing: the run counts only when `pass: true` and
the artifact above exists.

### Risks, and how the rig falsifies them

| Risk | Falsified by |
| --- | --- |
| History files pollute the theme list or the watcher | `theme:list` has no history entries; history lives outside `themes/`; list count unchanged |
| A restore silently writes an unvalidated snapshot | restore re-parses via `parseThemeFile` and writes through the store; a bad id or snapshot is refused with the parse error |
| Import overwrites an operator file | collision suffix check; both files present afterwards |
| Import seam leaks into production | only read behind `E2E_ACTIVE`; `bundle-electron.mjs` compiles the seam away; no renderer-supplied path in the product branch |
| An import is auto-kept | `theme:getState().keptFile` unchanged; the copy previews through the watcher instead |
| A snapshot is treated as a theme by the watcher | history is written under `theme-history/`, never under `themes/`; the rig asserts `theme:list` has no version entries |

### Limits — what S1 does not claim

- Versions are made only by the app's own writes. A file hand-edited outside the app has no
  version added by that edit; a snapshot is only taken when the app itself writes the file.
- Ten versions per file is a retention default, not a guarantee for older history; snapshots
  are whole files, not diffs.
- Import is one file at a time, ≤ 256 KB, into the profile only. It does not merge, does not
  switch the file on, and does not touch the vault.
- Restore previews exactly like a save: Keep makes it the window's theme. Letting the preview
  expire or pressing Revert hands the window back to the look it was wearing, but the restored
  bytes remain the file on disk — as with any save, the gate decides the window's look, not
  whether the write happened.
- No companion surface for either gesture (spec §14, open decision 6 — default no).
- No schema field, no new route/tab/rail row, no packed code, no network.

### Open notes

- Retention stays ten (spec §14.2); the store's prune loop is the single place to change it.
- Import collision uses the suffix policy (spec §14.3) rather than refuse/overwrite.
- The dialog path and the E2E seam are reviewed rather than separately boot-tested; the seam
  is compiled out of the shipped bundle, which is the boundary that matters.
- Snapshot ids replace `:` with `-` so the name is portable to Windows; the real ISO time
  travels in the version record's `savedAt`, not only in the path.
- `theme:list` intentionally stays history-blind: the store's history helpers are the only
  reader of `theme-history/`.

## S2 result (2026-11-19)

**The claim:** "An operator can build a page composition — widgets on regions, layout,
labels — without opening JSON, see it live, and save exactly what the contract allows."

### What shipped

**Two editor tabs.** The existing editor gained **Fields** (`extension-editor-tab-fields`,
the default when the raw parses) and **JSON** (`extension-editor-tab-json`, the existing
textarea). A tab switch keeps the draft: Fields → JSON serialises the draft into the textarea
(pretty, 2-space + newline), and JSON → Fields parses the text back only when it is valid —
otherwise the parser's error is shown and the editor stays on JSON. A file that does not
parse opens on JSON, because the studio has nothing valid to paint.

**The Fields view** (`extension-studio`) is three parts:

1. **Schematic** — the shell drawn as the five closed regions (`page.masthead`,
   `page.footer`, `page.orbit`, `rail.top`, `rail.footer`), each with a chip per widget placed
   there; a chip press selects that widget. It is decorative (`aria-hidden`) and not a canvas:
   no drag, no free placement. A live `role="status"` summary reads the surface back —
   *"3 widgets: 1 badge, 1 quick action, 1 brief."*
2. **Widget form** — the selected widget's type (the eight closed types), region (the five),
   label (≤ 32) and the fields that type needs: count source, text source, tone, route,
   caption (≤ 48), list limit (1–5), clock format (24h/12h), meter maximum. Controls offer
   legal values only, and a new widget starts with a default for its required field, so the
   form cannot assemble a widget the parser would call incomplete. Tones are named families,
   never colours.
3. **Layout controls** — `stack`, `grid` (`columns` 2 or 3) or `polar` (`radius`
   `tight`/`default`/`wide`), with the region rules said inline: `page.orbit` only draws in
   polar, and a quick action needs a route. Hints, not silent drops.

**Add / remove / reorder.** Add takes a type and a region, appends a widget with that type's
defaults, and is disabled at `MAX_COMPOSITION_WIDGETS` (8) with its reason shown. Each widget
can be removed, or moved up/down; array order inside a region is the order `stack` and
`polar` draw. The studio writes the same closed vocabulary as the JSON tab — no new region,
no new type, no new field, no free CSS.

**The draft rule (D2).** The provider gained `setDraftTheme(theme | null)` and a
`draftDiscarded` counter. Entering Fields, changing a field, or switching tabs rebuilds the
schema-only draft and paints it: `paintTheme(draft)` with no write, no keep, no preview and
**no preview bar**. If a preview is already on screen it is cleared without repainting the
kept theme first. The draft is held in page state; `keptFile`, the localStorage overrides and
the preview state are untouched. **Cancel** / closing the editor calls `setDraftTheme(null)`,
which paints the kept theme back and writes nothing — a true undo. **Save** serialises the
draft and calls the existing `writeThemeFile`, so the bytes go through the S1 store's parse
gate and the write then previews through the ten-second watcher gate like any save; the
studio clears draft mode after a successful save (the new preview is kept by the operator,
not by the studio). If an external write lands while editing, `loadThemeFiles` abandons the
draft first, paints the kept theme, bumps `draftDiscarded`, and the page shows the notice
*"the file changed on disk — your draft was discarded."* The studio never fights a newer file.

No backend work, no IPC channel, no persistence and no new route/tab/rail row: the studio is
a UI over the contract the ladder already proved, and `parseThemeFile` is still the only
referee.

### Rig evidence (new section `12j`)

The theme rig gains a section after `12i` that carries the slice's claims:

- `the-studio-paints-a-draft-before-any-write` — open Edit on a valid file → Fields; add a
  badge to `page.masthead`; the badge renders in the shell **while the file bytes on disk are
  unchanged and no preview bar appears**.
- `the-studio-saves-the-composition-it-built` — add a quick action to `page.orbit`, switch to
  polar (or grid with 3 columns), change a label, Save; the file on disk holds exactly the
  draft's composition, the preview bar appears, and the widgets render.
- `cancelling-a-draft-leaves-the-file-and-shell-alone` — reopen, change a label, Cancel; the
  disk bytes are unchanged and the shell is back on the kept look.
- `the-composition-editor-obeys-the-contract` — Add is disabled at eight widgets, the label
  input caps at 32, the region list is the five names, and the saved file carries no JSON
  keys outside the schema.

Artifact: `apps/desktop/e2e/artifacts/themes-v2-studio.png` — the Fields tab with the
schematic and a visible draft, captured with `capturePage` at 1280×800. Report:
`apps/desktop/e2e/artifacts/themes-v2.json`, wrapped by
`apps/desktop/tests/theme-chrome-e2e.test.ts` (artifact key and existence loop added with
the section).

**Check count:** the report is the source of truth. The gate started from the S1 run's **115**
checks; `12j` adds the S2 checks and the measured total is **119 checks, all passing**
(`report.pass: true`, `failures: []`) in the slice's authoritative run on 2026-11-19, with the
existing 12g/12i checks still green after the tab adaptation. A skipped rig is evidence of
nothing: the run counts only when `pass: true` and the artifact above exists.

### Risks, and how the rig falsifies them

| Risk | Falsified by |
| --- | --- |
| The draft is accidentally persisted or kept | disk bytes unchanged while drafting; no preview bar; `keptFile` unchanged; Cancel then reopen leaves file and shell alone |
| The draft fights an external write | the watcher abandons the draft with the notice instead of painting over the newer file; the normal preview path is unchanged |
| The studio writes schema drift | saved-file key audit (no keys outside the schema); the draft is assembled from schema keys only; Save still runs `parseThemeFile` |
| Caps are violated by the UI | Add disabled at 8 with the reason; label input max 32; type/region lists are the closed sets; the saved file parses |
| Drafting disturbs Settings overrides | draft mode never touches the localStorage overrides, `keptFile` or the preview bar; existing Appearance checks stay green in the same run |

### Limits — what S2 does not claim

- Fields authors the **composition** only. Palette, chrome, material and scene stay in the
  JSON tab until S3.
- The schematic is decorative: no drag, no free positioning, no theme-defined region, no
  custom layout. Order within a region is changed with up/down, not by dragging.
- The draft is valid by construction (closed sets and caps), but Save is still disabled for a
  draft that fails `parseThemeFile` — the studio does not get its own write path.
- A composition must hold 1–8 widgets: the parser refuses an empty list, so a draft that
  removes every widget cannot be saved from the studio (the JSON tab can remove the block).
- No new persistence, no new schema field, no new route/tab/rail row, no unit tests — the
  rig is the evidence.

### Open notes

- Default tab is Fields when the file parses, JSON otherwise (spec §14.4).
- An external write abandons the draft rather than merging; that is deliberate — the file the
  operator can see on disk wins over an unsaved edit.
- The studio's canvas is a map, not a direct-manipulation surface; drag authoring remains
  outside the epic (spec §7 non-goals).
- No animation was added, so reduced motion has nothing to stop; every control is labelled and
  keyboard operable, and the schematic is announced through its summary rather than as a
  control.

## S3 result (2026-11-19)

**The claim:** "The same editor can change chrome, material, scene and palette, with
validation that refuses unsafe palettes before the file is saved."

### What shipped

**Settings' controls, made reusable (D9).** `MaterialControls`, `LayoutControls`,
`SceneControls` and `CompositionControls` accept optional `value` / `onChange` (plus a
test-id prefix). Without those props they are exactly today's override-bound controls with
the same Settings ids and behaviour; the studio passes the draft's values, so both surfaces
render one control set from one implementation. The existing Appearance rig checks staying
green is the behaviour-preservation proof.

**The studio now authors the whole file.** Below the composition, the Fields view gained
four sections: `studio-chrome` (wing place/variant, domain place/variant, rail place/width,
dock side, titlebar size), `studio-material` (radius, elevation, type scale, density, motion,
backdrop), `studio-scene` (backdrop preset and intensity, page edge, card frame) and
`studio-palette`.

**The palette editor.** Light (`colors`) and dark (`darkColors`) groups over the complete
`THEME_REQUIRED_COLORS` set — 19 colours: surfaces, each surface's paired text colour, and
the border/input/ring/destructive entries. Per colour: a `<input type="color">` plus a hex
text field. **Copy current palette** (`studio-palette-copy`) seeds both groups from the
palette the window is wearing, so the operator edits deltas instead of typing nineteen
values. Each palette has its own include toggle: turning one off removes that palette from
the file, so that half inherits the skin (light and dark are independent). A live verdict
(`studio-palette-verdict`) runs the same `checkThemeContrast` the parser uses and lists
**every failing text-on-surface pair with its measured ratio and the 4.5:1 minimum**.
`studio-save` is disabled while the assembled file fails `parseThemeFile`, and a main-side
refusal is shown with the exact sentence — `… fails WCAG AA contrast on <pair>: <ratio>:1
(needs 4.5:1)` — so the studio has no way to write an unreadable window.

**The draft rule carries over.** Every chrome, material, scene or palette change rebuilds the
schema-only draft and paints it through `setDraftTheme`: nothing is written, kept or
previewed, and no preview bar appears. Cancel hands the kept look back. Save serialises the
file and calls the existing `writeThemeFile`, which runs the S1 store's parser and write gate
and then previews through the ten-second watcher gate like any save. Draft mode still never
touches the localStorage overrides, `keptFile` or the preview bar.

No backend work, no new IPC, no persistence beyond the file, no new route/tab/rail row.
Settings' overrides keep their own semantics and test ids.

### Rig evidence (new section `12k`)

The theme rig gains a section after `12j` that carries the slice's claims:

- `the-studio-moves-chrome-and-material-in-a-draft` — change the wing switcher's place in
  Fields; the shell repaints while the file bytes on disk are unchanged. Change material
  radius; the document's `--radius` family changes without a save.
- `the-studio-refuses-a-palette-that-fails-contrast` — start from **Copy current palette**,
  break a text/surface pair: the verdict names the pair and its ratio, Save is refused with
  that message and no file changes; fix the pair and save: the file carries the complete
  palette and the preview appears.
- `the-studio-can-hand-the-palette-back-to-the-skin` — remove a palette and save;
  `colors`/`darkColors` are absent from the file and the window is back on the skin palette.
- The existing Settings Appearance checks stay green in the same run — the D9 refactor is
  behaviour-preserving.

Artifact: `apps/desktop/e2e/artifacts/themes-v2-studio-look.png` — the studio with the palette
verdict visible, captured with `capturePage` at 1280×800. Report:
`apps/desktop/e2e/artifacts/themes-v2.json`, wrapped by
`apps/desktop/tests/theme-chrome-e2e.test.ts` (artifact key and existence loop added with
the section).

**Check count:** the report is the source of truth. The gate started from the S2 run's **119**
checks; `12k` adds the S3 checks and the measured total is **122 checks, all passing**
(`report.pass: true`, `failures: []`) in the slice's authoritative run on 2026-11-19, with all
119 earlier checks — including the Settings Appearance / controlled-control checks — green in
the same run. A skipped rig is evidence of nothing: the run counts only when `pass: true` and
the artifact above exists.

### Risks, and how the rig falsifies them

| Risk | Falsified by |
| --- | --- |
| The palette editor writes an unsafe palette | a live verdict names the pair and ratio; Save disabled pre-write; a save through the JSON tab is refused by main with the same sentence and no file change |
| Studio edits persist without Save | disk bytes unchanged while chrome/material/scene/palette change; no preview bar; `keptFile` unchanged |
| The verdict and the file disagree | the verdict runs the same `checkThemeContrast` the parser uses, and the saved file is re-parsed by main before it lands |
| A partial palette or schema drift is written | an enabled palette is written as the complete required set, a disabled one is absent; the saved file parses and carries no keys outside the schema |
| The Settings refactor changes Appearance | existing Settings Appearance checks stay green in the same run; without controlled props the controls are override-bound and unchanged |

### Limits — what S3 does not claim

- The studio writes a palette only as the complete required set, or not at all; the schema
  has no partial palette.
- The palette editor is a hex field plus a colour picker. There is no eyedropper, no palette
  import/export and no colour outside the declared set.
- Chrome, material and scene options are the same closed enums Settings already offers; no
  free CSS, no image, no animation, no new token.
- Settings stays the override layer; a draft never touches it, and the two layers are not
  unified.
- No new persistence, no new schema field, no new route/tab/rail row, no unit tests — the rig
  is the evidence.

### Open notes

- Both palettes are independent: handing one half back to the skin leaves the other in the
  file.
- **Copy current palette** starts from the palette the window wears, so deltas are relative
  to the visible baseline rather than to the bundled skin's raw values.
- The live verdict is advisory-plus-blocking (Save disabled); main remains the final gate and
  names the pair in the same words the verdict uses.
- The spec's open decision §14.5 (palette editor depth) shipped as the full required set for
  both palettes with hex and picker, not a reduced editor.
- Tab defaults and the draft-abandon notice are S2's and unchanged.

## S4 result (2026-11-19)

**The claim:** "A fresh profile shows what is possible, and an existing profile gets the new
examples without being handed back files it removed."

### What shipped

**Three more curated, data-only themes.** `shared/showcase-themes.ts` now exports five
bundles; the existing `showcase-solar-system` and `showcase-helios` are unchanged, and three
new files join them — each parse-valid under `parseThemeFile`, with a complete WCAG AA palette
in both colour modes, and a composition across the three layouts:

- **Paper Trail** (`showcase-paper-trail`) — daylight, editorial: light palette, sharp
  radius, compact density, wash backdrop, the wing switcher at the titlebar's left with the
  area lens centred, and a `stack` composition of a brief and a list.
- **Night Shift** (`showcase-night-shift`) — night, calm: dark palette, round radius, calm
  motion, starfield backdrop, floating rail, and a `polar` composition of quick actions and a
  meter.
- **Control Room** (`showcase-control-room`) — instrument panel: grid backdrop, hairline page
  edge, tall titlebar, and a `grid` composition of a badge, a meter and a quick action.

They are ordinary theme files: the shared bundle holds them as `ThemeFile` values, the boot
loop copies them into the profile with `wx`, and the rig re-reads each file and runs
`parseThemeFile` on it — the complete palettes pass the same WCAG AA check — so the "valid
data" claim is machine-checked rather than asserted.

**Versioned seeding (D7).** `theme-state.json` becomes
`{ keptFile: string | null, seededShowcase: string[] }`. The list holds theme **names**
(`showcase-solar-system`), not file names. `readThemeStateFile` accepts the legacy
`showcaseSeeded: true` and folds it to `["showcase-solar-system", "showcase-helios"]` (the
names that existed when the boolean was written), validating each name with the theme-file
rule; `writeThemeState(keptFile)` preserves the list; `seedShowcaseThemes` writes each bundled
name not already recorded with `{ flag: "wx" }` (EEXIST is fine), appends the name, and
persists once at the end. Name and file are deliberately separate: if the operator already
has a file under a gallery name, it is never overwritten — the name is recorded as offered
and the operator's bytes stay. In operator terms: the app remembers which examples it has
already offered, so an update adds new ones without resurrecting a removed one. A recorded
name is never re-added; a fresh profile gets all five; an existing profile gets the three new
ones and keeps its removals.

**Presentation.** No new page or section: a bundled card wears a small **Gallery** chip
(`extension-gallery-chip`) and the line *Bundled example — remove it and it stays gone.*
(`extension-gallery-note`); an operator-authored card wears neither. Nothing else on the page
changes.

No new route/tab/rail row, no file-schema change; the only new persisted shape is the
seeded-names list in `theme-state.json`.

### Rig evidence (new section `12l`)

- `a-fresh-profile-seeds-the-whole-gallery` — after first boot all five `showcase-*.json`
  files exist, each parses, and `theme-state.json` holds a five-entry `seededShowcase`.
- `removing-a-gallery-theme-does-not-bring-it-back` — Remove `showcase-control-room` through
  the UI, reload the window: still absent, still recorded in `seededShowcase`.
- `the-gallery-chip-marks-the-bundled-examples` — the **Gallery** chip (and its note) is on
  the five bundled cards and nowhere else; no operator-authored file is labelled Gallery.
- The existing checks stay green in the same run, including the R3 showcase-seeding check.

Artifact: `apps/desktop/e2e/artifacts/themes-v2-gallery.png` — the Extensions page with the
gallery themes and chips, captured with `capturePage` at 1280×800. Report:
`apps/desktop/e2e/artifacts/themes-v2.json`, wrapped by
`apps/desktop/tests/theme-chrome-e2e.test.ts` (artifact key and existence loop added with
the section).

**Check count:** the report is the source of truth. The gate started from the S3 run's **122**
checks; `12l` adds the S4 checks and the epic's final authoritative run is **125 checks, all
passing** (`report.pass: true`, `failures: []`, all 30 artifacts present) on 2026-11-19 — with
all 122 earlier checks green in the same run. A skipped rig is evidence of nothing: the run
counts only when `pass: true` and the artifact above exists.

### Risks, and how the rig falsifies them

| Risk | Falsified by |
| --- | --- |
| A removed gallery file is re-added | remove + reload: the file stays absent and stays recorded in `seededShowcase`; a recorded name is never written again |
| Seeding overwrites an operator file | each seed uses `wx` (`EEXIST` is fine); the fresh-profile check asserts the seeded files and the recorded list, and an operator file at the same name is never replaced |
| A fresh profile misses a gallery theme | all five files exist, each parses, and `seededShowcase` has five entries |
| The Gallery chip appears on operator files | the chip test id is asserted on bundled cards and absent elsewhere |
| The legacy boolean migration loses a removal | the migration folds `showcaseSeeded: true` to the two names that existed; covered by review plus the fresh-profile path (see below) |

### Limits — what S4 does not claim

- The gallery is five seeded data files and a chip: no carousel, no gallery route or section,
  no marketplace, no download.
- Bundled files are ordinary files after seeding: the operator can edit, keep or remove them;
  removal is final.
- No new theme fields: the three new files use the existing schema (palette, chrome, material,
  scene, composition) and nothing else.
- **The legacy-boolean migration is not boot-tested separately.** The rig is a single boot and
  the R3 showcase check depends on the real seeded content, so the migration is covered by
  review of `readThemeStateFile` plus the fresh-profile path — as spec §10 explicitly asks. No
  unit test was added for it.
- No network, no executable content, no vault writes.

### Open notes

- The labels and moods are the spec's defaults (*Paper Trail*, *Night Shift*, *Control Room*);
  renaming any of them is a data-only change before the branch merges.
- The seeded-names list is the only new persisted shape; `theme:getState` still returns
  `keptFile` only, and the rig reads the state file from the profile itself.
- Fresh and existing profiles differ only by what is not yet in `seededShowcase`: both end
  with five files unless the operator removed one.
- `seededShowcase` is written whenever non-empty, and the legacy `showcaseSeeded` key is
  dropped on the next write.

## Definition of done (S1–S4)

The four slices, against spec §17, with the evidence this document records:

- [x] **S1 trust** — history, restore and import, rig-proven; artifact `themes-v2-trust.png`;
  **115 checks** in the slice's run.
- [x] **S2 studio: composition** — a composition authored and saved visually, the draft
  visibly temporary; artifact `themes-v2-studio.png`; **119 checks**.
- [x] **S3 studio: the look** — chrome, material, scene and palette visually, contrast refusal
  exact; artifact `themes-v2-studio-look.png`; **122 checks**.
- [x] **S4 gallery** — five gallery themes seeded versionally, removal final; artifact
  `themes-v2-gallery.png`; check total in the epic's final run (the Lead's number).
- [x] Every slice's run was one full rig run with the existing checks green (`pass: true`), and
  its artifact exists at the path above.
- [x] The wiki, DESIGN.md and this document record each slice in the same branch;
  `npm run docs:check` was green at every slice (38 pages).
- [x] Data-only held throughout: no schema field, no new route/tab/rail row, no executable
  content, no vault writes; every theme write went through the one main-side store.
- [ ] The final full-rig total, `npm run typecheck` on the final commit, the READY handover,
  and the merge/push are the Lead's steps — the branch is not merged, pushed, or on the bench.

The R4 record stays in `docs/research/2026-11-16-r4-composition-spike.md` and is not edited;
this document is the S1–S4 record for the epic.
