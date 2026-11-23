# App background — design contract

**Branch:** `feat/app-background` · **Base:** `e2cfb38` · **Status:** implementation contract

The app gains a **background layer**: a picture (wallpaper) the operator can put behind the
page, plus two more drawn procedural skies. The layer is part of the theme model: a theme
file may carry it, Settings → Appearance may override it (marked "yours", Reset to theme),
and the Extensions studio authors it in Fields/JSON. This document is the shared contract
for the parallel implementation; if code and this file disagree, the code review fixes one
of them — do not silently diverge.

## Decisions already taken (from the operator)

1. **Both kinds** — an image wallpaper *and* more procedural presets.
2. **Theme file carries it, Appearance overrides it** — exactly the Material/Scene ladder:
   theme first, operator second, "yours" marker, **Reset to theme**.
3. **File picker, copied into the app profile** — never a path reference, never the vault.
   Pictures live in `<app profile>/backgrounds/`; the theme file names one by file name.

## 1. Shared model — `apps/desktop/shared/theme-file.ts`

Extend the scene layer. Keep the closed vocabulary and parser discipline.

```ts
export type SceneBackdropPreset =
  | "plain" | "starfield" | "orbit" | "aurora" | "horizon" | "mesh";

export const SCENE_BACKDROPS: readonly SceneBackdropPreset[] = [
  "plain", "starfield", "orbit", "aurora", "horizon", "mesh",
];

export type BackgroundImageFit = "cover" | "contain" | "tile";
export type BackgroundImagePosition = "center" | "top" | "bottom";
export type BackgroundImageDim = "none" | "soft" | "strong";
export type BackgroundImageBlur = "none" | "soft" | "deep";

export const BACKGROUND_IMAGE_FITS: readonly BackgroundImageFit[] = ["cover", "contain", "tile"];
export const BACKGROUND_IMAGE_POSITIONS: readonly BackgroundImagePosition[] = ["center", "top", "bottom"];
export const BACKGROUND_IMAGE_DIMS: readonly BackgroundImageDim[] = ["none", "soft", "strong"];
export const BACKGROUND_IMAGE_BLURS: readonly BackgroundImageBlur[] = ["none", "soft", "deep"];

/** The file-name rule shared by main's store, the parser and the rigs. */
export const BACKGROUND_IMAGE_FILE = /^[a-z0-9][a-z0-9-]{0,79}\.(png|jpe?g|webp|gif)$/;
/** Main refuses a source picture larger than this. */
export const MAX_BACKGROUND_IMAGE_BYTES = 16 * 1024 * 1024;

export type ThemeBackgroundImage = {
  /** A file name inside `<app profile>/backgrounds/`, never a path or a URL. */
  file: string;
  fit: BackgroundImageFit;
  position: BackgroundImagePosition;
  dim: BackgroundImageDim;
  blur: BackgroundImageBlur;
};

export const DEFAULT_BACKGROUND_IMAGE: Omit<ThemeBackgroundImage, "file"> = {
  fit: "cover",
  position: "center",
  dim: "soft",
  blur: "none",
};

export type ThemeBackgroundFile = {
  preset?: SceneBackdropPreset;
  intensity?: SceneIntensity;
  /** null means "no picture" and, in an override, hides the theme's picture. */
  image?: ThemeBackgroundImage | null;
};

export type ThemeScene = {
  background: {
    preset: SceneBackdropPreset;
    intensity: SceneIntensity;
    /** null = drawn preset only. */
    image: ThemeBackgroundImage | null;
  };
  frames: { canvas: SceneCanvasFrame; cards: SceneCardFrame };
};

export type ThemeSceneFile = { background?: ThemeBackgroundFile; frames?: Partial<ThemeScene["frames"]> };
export type ThemeSceneOverride = ThemeSceneFile;
```

**Parser** (`parseThemeFile`): `scene.background.image` may be an object or `null`.
An object must have `file` (string matching `BACKGROUND_IMAGE_FILE`) and every other field
defaults from `DEFAULT_BACKGROUND_IMAGE`; a declared field must be one of its allow-list.
Errors name the field, e.g.
`scene.background.image.fit must be one of cover, contain, tile`.
`null`/absent normalises to no image key in the parsed file.
`image.file` is *not* existence-checked by the parser (the file lives in the profile, and a
theme can be imported before its picture is). Missing files fall back at paint time.

**Resolvers:** `resolveScene` returns `image: scene?.background?.image ?? null`.
`layerScene` merges with the override last, where an explicit `image: null` in the override
means "hide the theme's picture":
`image: override?.background?.image !== undefined ? override.background.image : theme?.background?.image ?? null`.
`DEFAULT_THEME_SCENE` gains `image: null`.

**`THEME_VOCABULARY`**: update the preset list and add one line describing
`scene.background.image: { file, fit, position, dim, blur }` (a picture already stored in the
app profile's `backgrounds/`; the operator picks the file) and the two new presets.

## 2. Main process

### New module `apps/desktop/electron/theme-background.ts`

No Electron imports beyond what it needs (it may use `app` for the profile path; keep parsing
and validation pure so the rigs can lean on it).

- `BACKGROUNDS_DIR()` → `path.join(app.getPath("userData"), "backgrounds")`.
- `storeBackground(sourcePath: string): Promise<Result<{ file: string }>>`
  - reject non-string/empty; `stat` must be a regular file; size ≤ `MAX_BACKGROUND_IMAGE_BYTES`.
  - extension allow-list (png/jpg/jpeg/gif/webp) + magic-byte check (same signatures as
    `electron/chat-image.ts`; duplicate the small helper here with a comment, or export it
    from a shared module — do not import Electron into chat-image).
  - store as `<slug>-<sha256 first 12 hex>.<ext>` where `slug` is the source stem lowercased
    to `[a-z0-9-]` (fallback `picture`); write through a `.tmp` + rename.
  - a file that already exists with the same name is reused (content hash makes that safe).
  - failure sentences are operator-readable, e.g. "that picture is larger than 16 MB",
    "only PNG, JPEG, GIF and WebP pictures can be used", "that file is not a picture".
- `readBackground(file: string): Promise<Result<{ bytes: Uint8Array; mime: string }>>`
  - file must match `BACKGROUND_IMAGE_FILE`; resolve under `BACKGROUNDS_DIR()` and assert
    containment; regular file; size cap; magic check; `"That picture could not be read."` on
    any failure (one quiet sentence, dialogue with chat image's refusal).

### `apps/desktop/electron/main.ts`

- New E2E seam field `themeBackgroundSources?: string[]` in the `E2E` type and the
  `LIFEQUEST_E2E` parser (mirror `themeImportSources`, absolute paths, seam-gated).
- `ipcMain.handle("theme:pickBackground", …)`: inside the seam, shift a queued source;
  otherwise open a native `dialog.showOpenDialog` filtered to the four image types
  (title "Choose a background picture"). Cancelled → `{ ok: true, value: null }`.
  Then `storeBackground` and return `{ ok: true, value: { file } }`.
- `ipcMain.handle("theme:readBackground", …)`: validate the argument (string) through
  `readBackground` and return `{ ok: true, value: { file, mime, bytes } }`.
- Do **not** change any other handler.

### `apps/desktop/electron/preload.ts`

Add next to the other theme bridges, mirroring the result envelopes:

```ts
themePickBackground: () =>
  ipcRenderer.invoke("theme:pickBackground") as Promise<Result<{ file: string } | null>>,
themeReadBackground: (file: string) =>
  ipcRenderer.invoke("theme:readBackground", file) as Promise<
    Result<{ file: string; mime: string; bytes: Uint8Array }>
  >,
```

### `apps/desktop/src/vite-env.d.ts`

Declare the same two methods on the `lifequest` API interface.

## 3. Renderer

### `apps/desktop/src/lib/themes/theme-file.ts` — `applyScene`

`root.dataset.sceneBackdrop = scene.background.image ? "image" : scene.background.preset;`
This is deliberate: the existing CSS (`:root:not([data-scene-backdrop=plain]) .shell__main`)
already positions the decorative layer, so an image over a `plain` preset is still anchored.
Also write the picture axes onto the document for CSS/testability:
`dataset.sceneImageFit`, `sceneImagePosition`, `sceneImageDim`, `sceneImageBlur` (delete
`sceneImageFit`/… when there is no picture). Keep intensity/frames as they are.

### `ThemeProvider`

- Parse the stored scene override (`readStoredSceneOverride`) with the new image object:
  accept `image: null` or a valid object (file regex + allow-lists), drop anything malformed.
- New context fields:
  - `sceneImageUrl: string | null` — an object URL for the worn picture, `null` when there
    is none or the file cannot be read.
  - `sceneImageStatus: "none" | "loading" | "ready" | "missing"` — `none` when no picture is
    named, `loading` once the read starts, `ready` when the URL is set, `missing` when the
    read was refused or threw (the backdrop then falls back to the drawn preset).
- An effect keyed on `scene.background.image?.file` loads the bytes through
  `window.lifequest.themeReadBackground(file)`, builds a `Blob` and `URL.createObjectURL`,
  sets the URL, and revokes the previous URL on change/unmount. Guard against stale async
  resolves. A read failure sets the status to `missing` (the drawn preset paints instead).
- New context method `resetBackgroundOverride()`: delete only `background.image` from the
  operator's scene override (keep preset/intensity picks), persist and repaint.
- `setSceneOverride` continues to merge patches; `image: null` is a real value and must
  survive the merge (do not drop a null image as "empty").

### `apps/desktop/src/components/settings/BackgroundControls.tsx` (new)

Copy the shape and conventions of `MaterialControls.tsx` / `SceneControls.tsx`.

```ts
export interface BackgroundControlsProps {
  value?: ThemeScene;                              // controlled: the scene to describe
  onChange?: (patch: ThemeSceneOverride) => void;  // controlled: report picks
  testIdPrefix?: string;                           // "" keeps the Settings ids
}
```

Rows (all rows are the existing `settings-card__row theme-material__row` shape):

1. **Picture** — `data-testid="background-picture"`.
   - With no picture: button **Choose picture…** (`background-choose`).
   - With a picture: the file name (`background-picture-name`), **Replace…**
     (`background-choose` again is acceptable) and **Remove** (`background-remove`).
   - Choosing calls `window.lifequest.themePickBackground()`; on success builds
     `{ file, ...DEFAULT_BACKGROUND_IMAGE }` (in controlled mode reuse the current picture's
     fit/position/dim/blur when present) and emits `{ background: { image } }`.
     A cancelled dialog changes nothing. A refusal shows its sentence in a `role="alert"`
     line under the row.
2. **Fit** — `background-fit`, options `cover | contain | tile`
   (`background-option-fit-<value>`).
3. **Position** — `background-position`, options `center | top | bottom`.
4. **Dim** — `background-dim`, options `none | soft | strong`.
5. **Blur** — `background-blur`, options `none | soft | deep`.

Rows 2–5 are disabled while there is no picture. In Settings mode (no `value` prop) the
section reads `useTheme()`'s `scene`/`sceneOverride`; a picture that is the operator's pick
shows the **yours** marker (`background-picture-yours`) and a **Reset to theme** button
(`background-reset`) calls `resetBackgroundOverride()`. Section test id `theme-background`
(matching `theme-material` / `theme-scene`); in controlled mode `studio-background-panel` and
`studio-background-option-…`.

Hint copy: the picture is stored in this installation's profile, never the vault; it replaces
the drawn sky while it is set; Reset to theme hands the theme's picture (or sky) back.

### `SettingsAppearance.tsx`

Render `<BackgroundControls />` between `<SceneControls />` and `<CompositionControls />` (the
section stack is Material → Scene → Background → Composition → Layout → Theme files).

### `SceneControls.tsx`

Add the two presets to `PRESET_LABELS` (`horizon: "Horizon"`, `mesh: "Mesh"`) and update the
Background hint to say the drawn skies are procedural and a picture lives in the Background
section below. No other behaviour change.

### `apps/desktop/src/components/shell/SceneBackdrop.tsx`

- If `scene.background.image` is set: render a decorative layer
  `<div className="scene-backdrop scene-backdrop--image" data-testid="scene-backdrop"
   data-scene-preset="image" aria-hidden="true">` containing one picture span
  (`data-testid="scene-backdrop-image"`, class `scene-backdrop__picture`, inline
  `backgroundImage: url("${sceneImageUrl}")`), plus data attributes
  `data-image-fit`, `data-image-position`, `data-image-dim`, `data-image-blur`.
  Nothing is rendered for the procedural preset while the picture is loading or ready.
  The provider also exposes a picture status (`none | loading | ready | missing`): while it is
  `loading` the container paints empty (no flash of a sky), and when it is `missing` (the
  bytes could not be read) the component falls back to the theme's drawn preset — the file
  name is not a promise that the file still exists on this machine, and the theme's sky is
  the declared decoration. Root `data-scene-backdrop` stays `image` (it anchors the layer);
  the backdrop layer's own `data-scene-preset` then names the drawn preset it fell back to.
- New procedural presets:
  - `horizon`: deterministic bands + a sun disc (≤ 6 nodes).
  - `mesh`: 3 deterministic blurred colour blobs (≤ 5 nodes).
  Both animate `transform`/`opacity` only and obey the existing reduced-motion rule.
- Keep the 90-node budget, `pointer-events: none`, and `aria-hidden`.

### `apps/desktop/src/styles/global.css`

Add, next to the existing `.scene-backdrop` rules:

- `.scene-backdrop__picture` — absolute fill, `background-size: cover|contain|auto`,
  `background-repeat: no-repeat|repeat`, `background-position: center|top|bottom`,
  blur filters (e.g. `blur(6px)` / `blur(14px)` with a small scale to hide the edges).
- `.scene-backdrop--image::after` scrim keyed by dim (`none` = transparent, `soft` ≈ 55–65%
  `--background`, `strong` ≈ 82%).
- `.scene-backdrop__horizon` / `.scene-backdrop__sun` / `.scene-backdrop__ridge` and
  `.scene-backdrop__mesh` / `.scene-backdrop__blob` (drifting gradients).
- `:root[data-scene-backdrop=image]` needs no new positioning rule (it already matches
  `:not([data-scene-backdrop=plain])`), but keep `.shell__content` above the layer.

## 4. Extensions studio

- `StudioFields.tsx`: in the **Scene** tab, under `<SceneControls … />`, render
  `<BackgroundControls value={resolveScene(draft.scene)} onChange={(patch) => onChange(withScenePatch(draft, patch))} testIdPrefix="studio-" />`.
  Update `SECTION_INTROS.scene` to mention the picture layer.
- `draft-theme.ts` `withScenePatch`: preserve the current merge, but an explicit
  `patch.background.image === null` removes the `image` key from the merged background
  (and drops `scene.background` if it becomes empty). A patch with an image object merges the
  whole object (file + axes), never leaves a half image.
- `ExtensionsPage.tsx`: the theme card chips append `picture` when
  `theme.scene?.background?.image` is set (next to `sky <preset>`).
- The JSON tab needs no special code: the shared parser validates the new fields and its
  message reaches `studio-status`; Save stays disabled while the draft is invalid.

## 5. E2E — the only test we write (no unit tests after code)

- `apps/desktop/tests/theme-background-e2e.test.ts` — wrapper in the shape of
  `tests/theme-chrome-e2e.test.ts`: skip when the dev server is not up; run the rig with a
  throwaway world env; require the report and assert `pass`.
- `apps/desktop/e2e/theme-background.electron.mjs` — real app via `bootForE2e()`, its own
  world/profile/vault and stub host (reuse the seeding approach from the theme-chrome rig;
  copy what it needs, do not import its script). Queue the picker seam:
  `LIFEQUEST_E2E = { userData, showWindow, mcpPorts, themeBackgroundSources: [fixture] }`.
- Fixture: `apps/desktop/e2e/fixtures/background-ridge.png` — a small valid PNG (≤ 200 KB)
  with real colour bands, generated once (not a 1×1 pixel) so the capture shows a wallpaper.
- Checks (each a named check in the report, with a screenshot where noted):
  1. Settings → Appearance shows the **Background** section; choose the fixture through the
     real button; the picture lands in `<profile>/backgrounds/`; the shell paints
     `[data-testid=scene-backdrop][data-scene-preset=image]` with a `blob:` URL and the
     default fit/position/dim/blur; screenshot `theme-background-settings.png`.
  2. Fit/position/dim/blur picks repaint the document/backdrop datasets; the picture row
     shows **yours**; reload keeps the picks (operator override persists).
  3. **Reset to theme** clears the override and the drawn preset returns.
  4. A theme file written into the profile with `scene.background.image` (same stored file)
     previews, Keep keeps it, reload still wears it; preview/Keep bar still works.
  5. A theme with `preset: "horizon"` and another with `preset: "mesh"` paint their layers
     (`scene-backdrop--horizon` / `--mesh`); the Settings preset row lists both.
  6. Extensions studio → Edit a theme → Fields → Scene shows the picture rows
     (`studio-background-*`), choosing a picture updates the draft, **Save** writes a file
     whose JSON carries `scene.background.image` (read it back from the profile).
  7. A theme naming a missing picture file falls back to the drawn preset with the shell
     still painted (no crash, no error screen).
  8. Invalid JSON (`scene.background.image.file: "../escape.png"` and a bad `fit`) is refused
     with the field named in the studio verdict / write refusal.
- Report artifact: `apps/desktop/e2e/artifacts/theme-background.json` plus PNGs. The Lead runs
  the rig only through `/root/.local/bin/lifequest-e2e <worktree> tests/theme-background-e2e.test.ts`
  (one bench, one lock — no teammate starts a dev server).

## 6. Docs (same branch; `npm run docs:check` must pass)

- `docs/wiki/28-settings.md` — Appearance: update the **Scene** paragraph (six presets:
  Plain, Starfield, Orbit, Aurora, Horizon, Mesh) and add a **Background** paragraph between
  Scene and Composition: picture from disk copied into the app profile's `backgrounds/` (never
  the vault), Fit/Position/Dim/Blur, "yours", Reset to theme, replaces the drawn sky while set.
  Update the "no images" sentence so it means *the drawn presets* ship no image; the picture is
  the operator's own layer.
- `docs/wiki/37-extensions.md` — Look without JSON: Scene now includes the picture rows; JSON
  shape `scene.background.image: { file, fit, position, dim, blur }`; file name must be a
  picture stored in the profile; exporting a theme does not copy the picture (another machine
  falls back to the drawn preset); validation names the field.
- `docs/wiki/30-system-architecture.md` (or whichever page lists the app profile's folders) —
  add `backgrounds/` beside `themes/` **if** that page lists profile folders; otherwise leave
  it.
- No route/tab/rail/version change → no version bump; `docs:check` is still the gate.

## 7. File ownership (disjoint scopes — do not edit outside yours)

| Owner | Files |
|---|---|
| model-main | `shared/theme-file.ts`, `electron/theme-background.ts` (new), `electron/main.ts`, `electron/preload.ts`, `src/vite-env.d.ts` |
| appearance | `src/components/theme/ThemeProvider.tsx`, `src/lib/themes/theme-file.ts`, `src/components/settings/BackgroundControls.tsx` (new), `src/components/settings/SettingsAppearance.tsx`, `src/components/settings/SceneControls.tsx`, `src/components/shell/SceneBackdrop.tsx`, `src/styles/global.css` |
| studio | `src/components/theme/studio/StudioFields.tsx`, `src/components/theme/studio/draft-theme.ts`, `src/pages/ExtensionsPage.tsx`, `src/styles/extensions.css` (only if needed) |
| e2e-rig | `tests/theme-background-e2e.test.ts` (new), `e2e/theme-background.electron.mjs` (new), `e2e/fixtures/background-ridge.png` (new) |
| docs | `docs/wiki/28-settings.md`, `docs/wiki/37-extensions.md`, `docs/wiki/30-system-architecture.md` (only if it lists profile folders) |
| Lead | integration, typecheck, docs:check, E2E run, fixes, handover |

**Coordination:** `model-main` lands the shared model first and tells the Lead; `appearance`
and `studio` import from it and should write against this contract meanwhile. The Lead runs
`npm run typecheck` for integration (teammates may run it read-only; never start a dev server
or E2E).

---

# Round 2 — shell-wide backdrop and per-panel shading

**Status:** implementation contract, second pass on the same branch.

The operator asked for the background to show **under the left sidebar and the right chat
bar** too, with an adjustable amount of occlusion per panel — from completely blocking (the
panel opaque, as today) through intermediate shading to completely clear (the full backdrop
shows through). This adds two per-panel shade axes to the same background layer, carried by
the theme file, overridable in Settings → Appearance, authorable in the Extensions studio.

## R2.1 Model — `apps/desktop/shared/theme-file.ts`

```ts
/** How much of the backdrop shows through one shell panel. */
export type PanelOcclusion = "solid" | "heavy" | "medium" | "light" | "clear";

export const PANEL_OCCLUSIONS: readonly PanelOcclusion[] = [
  "solid", "heavy", "medium", "light", "clear",
];

export type ThemeBackgroundPanels = {
  /** The left sidebar (nav rail). */
  navRail: PanelOcclusion;
  /** The right chat bar (the dock panel). */
  chat: PanelOcclusion;
};

export const DEFAULT_BACKGROUND_PANELS: ThemeBackgroundPanels = {
  navRail: "solid",
  chat: "solid",
};
```

- `ThemeScene.background.panels: ThemeBackgroundPanels` (always resolved; defaults `solid`
  for both, which is exactly today's look).
- `ThemeBackgroundFile.panels?: Partial<ThemeBackgroundPanels>` so a theme file names only
  the panels it changes.
- Parser: `scene.background.panels` must be an object; each declared axis must be one of
  `PANEL_OCCLUSIONS`, with the field named in the error, e.g.
  `scene.background.panels.navRail must be one of solid, heavy, medium, light, clear`.
- `resolveScene`: `panels: { ...DEFAULT_BACKGROUND_PANELS, ...scene?.background?.panels }`.
- `layerScene`: theme first, operator second, **per axis**:
  `panels: { ...DEFAULT_BACKGROUND_PANELS, ...theme?.background?.panels, ...override?.background?.panels }`.
- `THEME_VOCABULARY`: add
  `scene.background.panels.navRail / .chat: solid | heavy | medium | light | clear (how much of the backdrop shows through the sidebar / chat bar; solid is the opaque panel).`

Meaning of the words (CSS owns the pixels, the model only names the step):

| value | panel surface |
|---|---|
| `solid` | 100% panel paint — opaque, the current look |
| `heavy` | 80% panel paint |
| `medium` | 58% panel paint |
| `light` | 34% panel paint |
| `clear` | 0% panel paint — the full backdrop shows through |

## R2.2 Renderer — the backdrop moves behind the whole shell

- `AppShell.tsx`: render `<SceneBackdrop />` as the **first child of `.shell`**, before
  `<NavRail />` (it leaves `.shell__main`). One layer behind the whole tray, not one per pane.
- `global.css`:
  - `.shell { background: var(--background); }` — the page canvas base now lives on the tray,
    under the scene.
  - `.shell__main { position: relative; z-index: 1; background: transparent; }` — the page
    draws above the scene; the old `:root:not([data-scene-backdrop=plain]) .shell__main
    { position: relative }` rule is folded into this (position is always relative now).
    Keep the border/shadow. The material `wash`/`grid` background-images still paint on the
    page and remain transparent gradients, so they tint rather than hide the scene.
  - `.nav-rail` background becomes
    `color-mix(in srgb, var(--canvas-base) var(--scene-panel-sidebar-veil, 100%), transparent)`.
  - `.chat-panel` background becomes
    `color-mix(in srgb, var(--background) var(--scene-panel-chat-veil, 100%), transparent)`.
  - Root maps the model's words to veil percentages:
    `:root[data-scene-panel-sidebar="solid"] { --scene-panel-sidebar-veil: 100%; }` … `clear`
    → 0%; the same five for `data-scene-panel-chat` / `--scene-panel-chat-veil`.
  - Panels keep their hairlines, their z-index (rail/chat already 20, above the scene), and
    their inner chrome bands (tab strip, composer/footer/actions bars) — those are content
    surfaces, not the panel veil.
  - The window strip and the rail's over-titlebar band stay chrome (the scene covers the
    shell tray below the strip, not the window titlebar). The layer does reach past the
    tray's right and bottom by `--shell-frame` (`top: 0`, `right/bottom:
    calc(-1 * var(--shell-frame))`, `left: 0`), because the sheet and the dock escape the
    tray into the window frame; without that, a clear panel would stop short of the window
    edge and the frame's mat would show as a seam under the glass.
- `src/lib/themes/theme-file.ts` `applyScene`: always write
  `root.dataset.scenePanelSidebar = scene.background.panels.navRail` and
  `root.dataset.scenePanelChat = scene.background.panels.chat`.
- `ThemeProvider`: `readStoredSceneOverride` parses `background.panels` (partial; unknown
  values dropped, not half-trusted); `resetBackgroundOverride()` clears **both**
  `background.image` and `background.panels` from the operator's override (the section's one
  Reset hands the whole background back).

## R2.3 Settings UI — `BackgroundControls.tsx`

Two new rows after **Blur** (always enabled — the shade applies to whatever backdrop is set,
picture or drawn sky):

1. **Sidebar** — `data-testid="background-panel-sidebar"`, options
   `background-option-panel-sidebar-<value>` for `solid | heavy | medium | light | clear`.
2. **Chat bar** — `data-testid="background-panel-chat"`, options
   `background-option-panel-chat-<value>`.

Labels: **Solid**, **Heavy**, **Medium**, **Light**, **Clear**. Hints: Solid = the panel is
painted fully, as before; Clear = the whole background shows through; the steps between shade
it. A row shows the **yours** pill (`background-panel-sidebar-yours` /
`background-panel-chat-yours`) when the operator's override names that axis. Settings'
existing **Reset to theme** (`background-reset`) clears image + panels.

## R2.4 Extensions studio

`BackgroundControls` renders the same rows in controlled mode under `studio-` ids
(`studio-background-panel-sidebar`, `studio-background-option-panel-sidebar-<value>`, …), so
no new component is needed. `draft-theme.ts` `withScenePatch` deep-merges the panels object
per axis (a single-axis patch must not wipe the other axis), and drops `scene.background`
only when it becomes empty. Update `SECTION_INTROS.scene` to mention the panel shades.

## R2.5 E2E — extend `tests/theme-background-e2e.test.ts` / `e2e/theme-background.electron.mjs`

Add checks (the rig remains the only test):
1. A fresh profile is `solid` on both panels: root datasets `data-scene-panel-sidebar=`
   `data-scene-panel-chat=solid`, nav rail and chat panel computed backgrounds are effectively
   opaque (alpha ≥ 0.99).
2. Settings → Appearance shows the **Sidebar** and **Chat bar** rows; picking **Clear** for
   the sidebar and **Heavy** for the chat bar repaints root datasets, the rows show **yours**,
   the nav rail becomes fully transparent and the chat panel ~80% opaque (computed alpha).
3. With **Clear** on both panels the picture is visibly behind rail and chat — the panel
   screenshots/computed styles prove it; reload keeps the picks.
4. Reset to theme restores both panels to `solid`.
5. A theme file carrying `scene.background.panels { navRail: "clear", chat: "light" }`
   previews, Keep keeps it, reload still wears it.
6. Extensions studio Fields → Scene shows the two rows and Save writes the panels object;
   read the saved JSON back.
7. Invalid panel value (e.g. `panels.chat: "translucent"`) is refused with the field named.
8. Existing 16 checks stay green (the scene layer moved but its testids/attributes and the
   drawn-sky fallback are unchanged).

## R2.6 Docs

- `docs/wiki/28-settings.md` **Background** paragraph: add the two shade rows — **Sidebar** and
  **Chat bar**, five steps from **Solid** (the panel painted fully) through **Heavy**,
  **Medium**, **Light** to **Clear** (the background shows through), marked "yours", Reset
  to theme hands the whole background back. Note the shading applies to the backdrop (picture
  or drawn sky) and the window strip stays chrome.
- `docs/wiki/37-extensions.md`: JSON shape gains
  `scene.background.panels: { navRail, chat }` with the five values; validation names the
  axis; studio Scene section includes the rows.
- No route/tab/rail/version change.

## R2.7 Ownership (round 2)

| Owner | Files |
|---|---|
| model-main | `apps/desktop/shared/theme-file.ts` |
| appearance | `AppShell.tsx`, `ThemeProvider.tsx`, `src/lib/themes/theme-file.ts`, `BackgroundControls.tsx`, `styles/global.css` |
| studio | `studio/draft-theme.ts`, `studio/StudioFields.tsx` (intro copy only) |
| e2e-rig | `e2e/theme-background.electron.mjs` |
| docs | `docs/wiki/28-settings.md`, `docs/wiki/37-extensions.md` |
| Lead | integration, typecheck, docs:check, both E2E rigs, commit, handover |

---

# Round 3 — the agent's background tooling

**Status:** implementation contract, third pass on the same branch.

The operator asked whether the companion has tools for these settings. Audit: `write_theme` /
`validate_theme` already accept `scene.background.image` and `scene.background.panels` (same
shared parser), and `THEME_VOCABULARY` is injected into every companion turn — so authoring
works. Two gaps remain: `get_theme` reports no scene at all (no picture, no panel shades, no
inventory of stored pictures), and the agent cannot put a picture into the profile
(`backgrounds/` is written only by the operator's picker). This round closes both.

## R3.1 `get_theme` reports the background layer and the picture inventory

`apps/desktop/electron/theme-tools.ts`, `get_theme` response gains:

- For the kept theme's `current` and for every `themes[]` summary: a resolved
  `scene: { preset, intensity, frames, image, panels }` — exactly `resolveScene(theme.scene)`
  from the shared model (defaults filled in, so the agent reads the real worn values; a theme
  that names nothing still shows `plain`/`calm`, `image: null`, both panels `solid`).
- Top-level `backgrounds: Array<{ file: string; bytes: number; mime: string }>` — every file in
  `<app profile>/backgrounds/` whose name matches `BACKGROUND_IMAGE_FILE`, sorted by name
  (stat'ed; a file that vanished between read and stat is skipped). The agent can name any of
  these in `scene.background.image.file`.
- `get_theme`'s description updated: it now returns the resolved scene, the pictures stored in
  the profile, and the kept file.

Add an inventory helper beside the store in `electron/theme-background.ts`:
`listBackgrounds(): Promise<Array<{ file: string; bytes: number; mime: string }>>` (mkdir the
directory if absent; filter `BACKGROUND_IMAGE_FILE`; stat; map extension→mime with the module's
existing table; skip vanished/!file entries). `theme-background.ts` is the one module that knows
the store, so the tool imports the list from there rather than re-reading the folder.

## R3.2 A tool that stores a picture from the vault

New tool in `THEME_TOOL_DEFS`:

```ts
{
  name: "store_background_picture",
  description:
    "Copy a picture from the open vault into the app profile's backgrounds/ folder and return the stored file name. The source must be an image file inside the vault (e.g. images/files/<id>.png) — never a URL or a path outside the vault. Nothing the operator sees changes until a theme names the returned file in scene.background.image.file; write_theme then previews and Keep/Revert is still the consent.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "Vault-relative image path, e.g. images/files/<id>.png" },
    },
    required: ["source"],
  },
}
```

Handler (in `theme-tools.ts`):

1. `source` string, trimmed, no NUL, no scheme (the `chat-image.ts` rule: a Windows drive
   letter is a path; `https:`/`file:` are not). Relative resolves against the vault root;
   absolute is kept.
2. Vault root comes from the dispatcher (see R3.3). No root / empty → `{ error: { code:
   "NOT_FOUND", message: "open a vault before storing a background picture" } }`.
3. Prove containment with `assertPhysicalContainment(vaultRoot, resolved)` (vault-core, read) —
   the source must be a real file inside the vault; a symlink out is refused.
4. `storeBackground(contained)` from `electron/theme-background.ts` — its existing checks apply
   (regular file, 16 MB, png/jpeg/gif/webp extension + magic bytes, content-addressed copy,
   `.tmp`+rename).
5. Answer `{ stored: "<file>", image: { file, fit: "cover", position: "center", dim: "soft",
   blur: "none" }, note: "write_theme with scene.background.image = image to wear it; the operator's Settings override still outranks the theme." }`.
   Refusal sentences: "source must be a picture inside the vault" for containment/scheme
   problems; `storeBackground`'s own sentences otherwise (size/type/magic/read).

The tool never touches the vault (read only) and writes only the profile's `backgrounds/
folder. It does not write, preview or keep a theme by itself.

## R3.3 Wiring

- `executeThemeTool(name, args, vaultRoot?: string | null)` gains the optional root.
  `map-tools.ts` passes its `root` argument at the theme branch (the pairing door goes through
  the same dispatcher); the tools still dispatch before `openVault`, so a theme remains
  readable with no vault open and only the store tool requires one.
- Connected/pairing agents stay refused: `THEME_TOOL_DEFS` are only advertised/dispatched on
  the companion path, as before. No new name is added to any grant vocabulary.
- `THEME_VOCABULARY` gains one line:
  `get_theme lists the pictures stored in the app profile's backgrounds/ (file, bytes, mime) and the resolved scene (preset, intensity, frames, image, panels); name one in scene.background.image.file. store_background_picture copies a vault image into that folder and returns the file name; write_theme then wears it (preview/Keep). The operator's Settings override outranks a theme.`

## R3.4 E2E — extend the background rig

In `e2e/theme-background.electron.mjs`, after the existing 24 checks, open the real companion
door (`e2eCompanionDoor()` + MCP SDK client, exactly as the theme-chrome rig does) and add:

1. `the-companion-door-offers-the-background-tools` — `listTools` contains `get_theme`,
   `validate_theme`, `write_theme`, `store_background_picture`.
2. `get-theme-reports-the-background-layer` — `get_theme` returns the kept theme's resolved
   `scene` (picture file + panel shades as worn), each file's `scene`, a `backgrounds` array
   containing the picture the rig stored through Settings, and `vocabulary` containing
   `scene.background.panels`.
3. `the-agent-stores-a-vault-picture` — the rig copies its fixture into
   `<vault>/images/files/agent-background.png`, calls `store_background_picture` with that
   vault-relative path, gets a stored file name under `<profile>/backgrounds/`, and
   `get_theme` now lists it.
4. `the-agent-wears-the-picture-it-stored` — `validate_theme` then `write_theme` with
   `scene.background.image = { ...returned image }` and `scene.background.panels
   { navRail: "light", chat: "medium" }`; the real window previews the picture and the panel
   datasets, Keep keeps it, reload still wears it.
5. `store-background-refuses-a-path-outside-the-vault` — `"../escape.png"` and a non-image vault
   file are refused with the tool's sentence; no profile file appears.
Keep the existing 24 checks green; add one artifact screenshot of the agent-authored wallpaper
if cheap (the existing app screenshot may be reused).

## R3.5 Docs

- `docs/wiki/37-extensions.md`: the companion-tools sentences (intro and the "Import and
  History are page gestures" bullet) now name four tools — `get_theme` (files, kept theme,
  resolved scene, stored pictures), `validate_theme`, `write_theme`, and
  `store_background_picture` (copies a vault image into the profile's `backgrounds/`; the theme
  still previews and Keep is the consent; the operator's Settings override wins). Mention the
  scene/panels/picture fields it can author.
- `docs/wiki/28-settings.md`: one clause in the Background paragraph — a theme (and so the
  companion) names a picture already stored in the profile; the agent can copy one out of the
  vault with its tool, and Settings still outranks it.
- No route/tab/rail/version change.

## R3.6 Ownership (round 3)

| Owner | Files |
|---|---|
| model-main | `electron/theme-tools.ts`, `electron/theme-background.ts` (list helper), `electron/map-tools.ts` (root pass-through), `shared/theme-file.ts` (vocabulary line) |
| e2e-rig | `e2e/theme-background.electron.mjs` (+ wrapper artifact list if needed) |
| docs | `docs/wiki/37-extensions.md`, `docs/wiki/28-settings.md` |
| Lead | integration, typecheck, docs:check, both E2E rigs, commit, handover |
