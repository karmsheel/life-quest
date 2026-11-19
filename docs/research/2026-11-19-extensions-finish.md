# Extensions, finished — S1 trust and S2 studio

- **Date:** 2026-11-19
- **Branch:** `feat/extensions-finish` (off master `d2b11a2`)
- **Brief:** `docs/superpowers/specs/2026-11-19-extensions-finish-scope.md` §7 (S1) and §8
  (S2); interfaces in `.scratch/extensions-finish/contract.md` §3 (S1) and §4 (S2).
- **Decision it serves:** the epic's operator side — *confidence* and *authorship*. S1 made
  an edit safe to take back and a theme file portable between profiles; S2 made the
  composition authorable without JSON. Neither slice adds a schema field: both are gestures
  over the data model the ladder already proved.

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

## What comes next (this doc is appended per slice)

- **S3 Studio: the rest of the look** — chrome, material, scene and palette visually, with
  the palette verdict refusing unsafe colours before a write.
- **S4 Gallery** — three more bundled showcase themes, seeded versionally so a fresh profile
  shows the possibility space and a removed file stays removed.

The R4 record stays in `docs/research/2026-11-16-r4-composition-spike.md` and is not edited;
this document is the S1–S4 record for the epic.
