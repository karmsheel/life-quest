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
