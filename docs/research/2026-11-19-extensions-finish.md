# Extensions, finished — S1 trust: history and import

- **Date:** 2026-11-19
- **Branch:** `feat/extensions-finish` (off master `d2b11a2`)
- **Brief:** `docs/superpowers/specs/2026-11-19-extensions-finish-scope.md` §7; interfaces in
  `.scratch/extensions-finish/contract.md` §3.
- **Decision it serves:** the epic's operator side — *confidence*. The look was already
  authorable as data; what was missing is that an edit could be taken back and a theme file
  could move between profiles without opening a folder. S1 adds the two gestures, not a
  vocabulary.

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

## What comes next (this doc is appended per slice)

- **S2 Studio: composition** — author the composition layer visually (Fields tab, live draft
  paint, no JSON), saving the existing schema through the same preview gate.
- **S3 Studio: the rest of the look** — chrome, material, scene and palette visually, with
  the palette verdict refusing unsafe colours before a write.
- **S4 Gallery** — three more bundled showcase themes, seeded versionally so a fresh profile
  shows the possibility space and a removed file stays removed.

The R4 record stays in `docs/research/2026-11-16-r4-composition-spike.md` and is not edited;
this document is the S1–S4 record for the epic.
