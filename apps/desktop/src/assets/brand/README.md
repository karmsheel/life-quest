# LifeQuest brand assets

The company mark, as it ships. These are the source files every surface draws
from; nothing here is generated at build time and nothing here is a copy of a
copy.

| File | What it is | Where it is used |
| --- | --- | --- |
| `lifequest-emblem.svg` | The emblem alone, the mountain-inside-a-Q mark. Official icon. | The app icon's master art (`apps/desktop/build/icon.png` and `icon.ico` are rendered from it). |
| `lifequest-wordmark.svg` | The "LifeQuest" wordmark alone, letterforms only, no mark. Official text logo. | The top-left brand mark in the left sidebar (`NavRail`), painted as a CSS mask. |
| `lifequest-lockup.svg` | The full lockup: emblem over wordmark, at the source's own spacing. Official primary logo. | Media, docs and anything outside the app chrome that needs the whole logo. |

`build/icon.png` (1024px, rounded black tile) and `build/icon.ico` (16–256px)
live outside `src/` because electron-builder requires the app icon there; they
are the emblem at 700/1024 of the tile, centred, on the brand's black.

## Ink

The artwork is one flat warm cream: **`#F9E5C8`**. In the app chrome the
wordmark is painted as a mask, not as a coloured image, so it takes the rail's
current text colour — a day skin inks it dark, a night skin lights it cream. The
emblem keeps the cream on its own black tile, which is how the source logo is
presented and what keeps the app icon legible on light and dark taskbars.

## Provenance

Extracted from the operator-supplied `LifeQuest Mountain Emblem.png`
(sha256 `aeff51ec350b7e68b51f4b54aabd004fbf2646679df25e91b8a4c71aecbb5390`,
1254×1254 RGBA). The source's alpha channel is the artwork itself, so the 50%
alpha contour was supersampled 4× and traced (potrace) into these SVGs: clean
curves at any size, no raster halo. The wordmark's ink box is 872.25×162.45
units, the emblem's 705.28×646.53, and the lockup's 872.25×868.03 — the same
proportions as the source image.

## Rules of thumb

- Icon without the word: app icon, favicon, avatars. Wordmark without the icon:
  the sidebar's own header. Both: external material, never the app's chrome.
- Leave the wordmark at least half its cap height of clear space on all sides.
- Do not recolour the emblem's tile or stretch either file; both carry their
  own aspect ratio in the `viewBox`.
