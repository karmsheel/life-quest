# LifeQuest brand assets

The company mark, as it ships. These are the source files every surface draws
from; nothing here is generated at build time and nothing here is a copy of a
copy.

| File | What it is | Where it is used |
| --- | --- | --- |
| `lifequest-emblem.svg` | The emblem alone, the mountain-inside-a-Q mark. Official icon. | The app icon's master art (`apps/desktop/build/icon.png` and `icon.ico` are rendered from it). |
| `lifequest-wordmark.svg` | The "LifeQuest" wordmark alone, letterforms only, no mark. | Media and docs that need the text alone; the app chrome draws the supplied lockups below. |
| `lifequest-lockup.svg` | The full lockup: emblem over wordmark, at the source image's own spacing. | Media, docs and anything outside the app chrome that needs the whole logo. |
| `logo/01-modern.svg` | Supplied lockup: LIFE · emblem · UEST, neutral sans. **The shipped default.** | The rail's top band and the splash screen (`LogoVariant` `modern`). |
| `logo/02-athletic.svg` | Supplied lockup, heavy slanted sans, words leaning apart. | Settings → Developer → Logo (`athletic`). |
| `logo/03-classic.svg` | Supplied lockup, serif. | Settings → Developer → Logo (`classic`). |
| `logo/04-minimal.svg` | Supplied lockup, light wide-tracked sans. | Settings → Developer → Logo (`minimal`). |

`build/icon.png` (1024px, rounded black tile) and `build/icon.ico` (16–256px)
live outside `src/` because electron-builder requires the app icon there; they
are the emblem at 700/1024 of the tile, centred, on the brand's black.

## The four lockups

The operator supplied these as SVGs. Each one names its three groups with the
same classes — `life-text` (the LIFE word), `quest-icon` (the Q emblem) and
`uest-text` (the UEST word) — and the app colours them from three theme tokens:

| Token | Paints | Supplied default |
| --- | --- | --- |
| `--life-color` | the LIFE word | `#F8E5C8` cream |
| `--icon-color` | the Q emblem | `#C66A3D` ember |
| `--uest-color` | the UEST word | `#FFFFFF` white |

The supplied files carried their own `:root` defaults and class fills. Those
were removed when the art was brought in (`logo/` files have no `<style>` and no
`fill` attributes) because the theme owns the inks now: Forge's night palette
declares the supplied trio, every other palette derives foreground / primary /
foreground, and a theme file may override any of the three with
`colors.logoLife` / `logoIcon` / `logoUest`. The rail (`LifeQuestLogo`) and the
splash (injected by `vite.config.ts` from these same files) draw from the tokens
only, so the mark follows the active theme and cannot go invisible on a day
skin. The picker (Settings → Developer) stores the variant in localStorage under
`lifequest-logo`; `theme-boot.js` reads the same key for the splash.

The emblem/wordmark/lockup SVGs above are the earlier extraction of the single
supplied PNG, kept as static brand art (app icon, media).

## Ink

The PNG-extracted art is one flat warm cream: **`#F9E5C8`**. The emblem keeps
that cream on its own black tile, which is how the source logo is presented and
what keeps the app icon legible on light and dark taskbars. The supplied
lockups take their ink from the theme tokens above instead of a baked colour.

## Provenance

`lifequest-emblem.svg`, `lifequest-wordmark.svg` and `lifequest-lockup.svg` were
extracted from the operator-supplied `LifeQuest Mountain Emblem.png`
(sha256 `aeff51ec350b7e68b51f4b54aabd004fbf2646679df25e91b8a4c71aecbb5390`,
1254×1254 RGBA). The source's alpha channel is the artwork itself, so the 50%
alpha contour was supersampled 4× and traced (potrace) into these SVGs: clean
curves at any size, no raster halo. The wordmark's ink box is 872.25×162.45
units, the emblem's 705.28×646.53, and the lockup's 872.25×868.03 — the same
proportions as the source image.

The `logo/` lockups are the operator's second supplied set (four SVGs: Modern,
Athletic, Classic, Minimal). Their path data is untouched; only the internal
`<style>` block, `<title>`/`<desc>` and `transform-origin` attributes were
removed so the app's CSS owns the fills and the accessible name.

## Rules of thumb

- Icon without the word: app icon, favicon, avatars. A lockup: the rail and the
  splash — the app's own chrome. Both the lockup and the extracted logo: external
  material.
- Leave a lockup at least half its cap height of clear space on all sides.
- Do not recolour the emblem's tile or stretch any file; every SVG carries its
  own aspect ratio in the `viewBox`.
