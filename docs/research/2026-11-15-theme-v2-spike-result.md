# Theme files v2 — spike result (2026-11-15)

**Verdict: the slice works. Theme as data can move the shell's chrome and the
player cannot get lost, because the window asks before it keeps a theme.** The
spike's gate question — "does relocatable chrome survive real app behavior?" — is
answered yes on the shipped app, with one architectural lesson recorded below.
UI SDK adoption is confirmed for the wing switcher only; the library is a good
fit where its own primitive is the control, and a poor fit where the app's
control has domain behavior the library does not model.

This is the result of the 5–7 day spike approved in
`2026-11-15-ui-malleability-theme-scope.md` (written on the docs branch; this
checkout is the feature branch `feat/ui-theme-spike`, so that file is not in this
tree). The spike built **R2 (chrome) plus a thin material layer (a slice of R1)**;
R3 scene and R4 widget composition were not attempted.

## What the slice ships [read]

- **Theme file v2** (`apps/desktop/src/lib/themes/theme-file.ts`): a JSON file
  with `name`, `label`, optional `description`, optional `colors`/`darkColors`
  (layered over the worn skin), and two closed-enum sections:
  - `chrome.wingSwitcher`: `place` ∈ `rail-top | titlebar-left | floating-left |
    hidden`, `variant` ∈ `labels | icons`
  - `chrome.domainSwitcher`: `place` ∈ `titlebar-center | below-titlebar |
    bottom-center | floating-bottom-right | hidden`, `variant` ∈ `segmented | pill`
  - `material`: `radius` (`sharp | soft | round`), `density`
    (`compact | default | airy`), `motion` (`none | calm | lively`).
  Unknown placements are refused by naming the field; the file is never
  partially applied.
- **App-level storage and hot reload**: files live in
  `<userData>/themes/*.json` — never the vault, so a theme is not part of the
  repository the operator syncs or hands to the companion. Main watches the
  directory (`fs.watch`) and pushes `theme:changed`; the renderer re-reads
  through `theme:list`. The companion's authoring gesture is therefore "write a
  file", not "call an installer".
- **Preview → keep or revert**: a newly written (or changed) file is worn at once
  as a preview; a bar names the file and offers **Keep theme** / **Revert**, and
  after ten seconds the window reverts by itself. Keeping persists the file name
  in renderer storage; the chrome is re-applied from the file on the next launch.
  No Decision is filed: presentation-only and fully reversible.
- **Chrome hosts**: `ChromeHosts` paints moved controls as overlays over the
  shell. `WingTabs` (first UI SDK adoption) and `DomainSwitcher` render in all
  supported placements; the rail's top band and the strip's centred lens remain
  the defaults when no theme file is worn.
- **Material**: radius (inline CSS variables on `<html>`), density/motion as
  `data-material-*` attributes the stylesheet maps to a named step. A theme
  cannot ship arbitrary CSS or free-form values.

## Gate answers [read]

1. **Does the behavior survive relocation?** Yes on the shipped app: the E2E rig
   boots the real main process, preload and renderer, writes a theme file, and
   asserts the wing switcher leaves the rail for the window strip, the area lens
   leaves the strip for a bottom dock, the rail's band and the strip lens
   disappear, and the chrome survives a reload after Keep. Keyboard/ARIA after
   relocation is **not yet asserted** by the rig (the control is the same
   component instance, but the next rig must press arrows in each placement).
2. **Does the UI SDK seam work?** Yes for `WingTabs`, rebuilt from
   `@ui-sdk/react/segmented-control` (pinned `0.1.0-beta.5`, Apache-2.0, zero
   runtime deps). The library supplies roving focus and radio semantics; the app
   keeps its classes and palette. Adopting it took one component and a handful
   of CSS rules.
3. **What did the architecture learn?** The shell's providers are *inside*
   `AppShell` (`WingProvider`), while `WindowTitleBar` is rendered above them.
   A titlebar that mounts `WingTabs` directly throws `useWing` out of context
   and takes the whole React tree down. Relocated chrome therefore belongs to a
   host **inside** the provider tree, painted over the strip, not inside the
   header. This is the seam the Phase 1 plan should assume.
4. **Effort calibration.** The slice (model, IPC, watch, preview/revert, two
   relocatable components, material, rig) is a single working session. The
   Phase 1 estimate of 6–8 weeks for R1+R2 stands; the preview/keep loop is the
   cheap part, and Settings/authoring/contrast work is where the weeks go.
5. **What the spike deliberately left out.** Scene layer (R3), widget
   composition (R4), a Settings surface for theme management, export of the
   current theme, WCAG contrast enforcement, and a real companion **tool** for
   writing themes (the rig writes the file to stand in for the agent). The
   showcase theme in the artifact is written by the rig, not by a turn.
   **All of those except R3/R4 are now closed — see the closure below.**

## Closure — the authoring loop (next task, same branch)

The spike left two gate questions open: whether a real agent can author a theme
without seeing pixels, and whether moving chrome stays correct for keyboard and
aria in every placement. Both are now answered on the same branch.

What changed:

- **Contrast is enforced, not suggested.** The shared model
  (`apps/desktop/shared/theme-file.ts`) proves a palette against WCAG AA on the
  eight text pairs the shell paints and refuses it with the failing pair and
  ratio named. The renderer, main's tools and the rigs share that one rule.
- **The companion has the tools.** `get_theme`, `validate_theme` and
  `write_theme` are registered on the same MCP door the companion already uses
  (`electron/theme-tools.ts`, wired in `pairing-door.ts` and `map-tools.ts`);
  paired agents are refused by name because a theme belongs to the studio, not
  a domain. Every turn's instructions carry the theme vocabulary, so the agent
  can compose from it.
- **Settings → Appearance is the operator's side.** Theme files are listed with
  Try / Keep / Kept / Remove (two presses), Open folder, and Export current
  theme. Try enters the same ten-second preview gate; Remove deletes the file
  and, if it was the kept one, returns the shell to the default chrome.
- **The kept name lives in main** (`theme-state.json`), not localStorage, so the
  tools and the window agree; the v1 key is migrated once.
- **The restart bug is fixed.** An installed skin is now an accepted stored
  choice (`storage.ts`), not silently reverted to the default.
- **The rig presses the keys.** It now exercises every wing place
  (`rail-top` / `titlebar-left` / `floating-left` / `hidden`) and every area
  place (`titlebar-center` / `below-titlebar` / `bottom-center` /
  `floating-bottom-right` / `hidden`), both variants, arrow keys in the two
  moved controls, the hidden-chrome escape hatch, the contrast refusal, and the
  whole agent loop through the real MCP door: list tools → `get_theme` →
  `validate_theme` (refused pair) → `write_theme` → live preview → operator
  Keep → state. Settings is exercised in the real sheet.

## Evidence

- Rig: `apps/desktop/e2e/theme-chrome.electron.mjs`; wrapper
  `apps/desktop/tests/theme-chrome-e2e.test.ts`.
- Report: `apps/desktop/e2e/artifacts/themes-v2.json` (27 checks, 0 failures).
- Pictures: `themes-v2-preview.png` (preview bar over moved chrome),
  `themes-v2-kept.png` (after Keep and a reload), `themes-v2-floating.png`
  (floating-left wing + floating-bottom-right pill), and
  `themes-v2-settings.png` (Settings → Appearance's theme-file list).
- Run: `/root/.local/bin/lifequest-e2e <checkout> tests/theme-chrome-e2e.test.ts`.

## Next step

Phase 1 (R1 material tokens, R2 chrome placements as first-class theming) per
the design doc, starting with the "chrome host lives inside the shell providers"
constraint. R3 (scenes) and R4 (widget composition) remain unbuilt.
