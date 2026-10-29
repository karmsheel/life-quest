# LifeQuest brand assets

One source image, one generator, every icon and logo the desktop app wears:
the window/exe/bundle icon, the favicons, the circular in-app mark and the two
lockups. Nothing here is drawn by hand; if an asset is wrong, fix this document
or the generator and rebuild.

The palette lives in code — `apps/desktop/src/lib/themes/presets.ts` (skin
`lifequest`, see [DESIGN.md](../../DESIGN.md)) — not in the images. The images
carry the mark; the theme carries the colours.

## Provenance

| | |
| --- | --- |
| Source art | [`docs/brand/source/lifequest-emblem.jpg`](source/lifequest-emblem.jpg) |
| Source size | 768 × 1152 px JPEG, sRGB |
| Source sha256 | `80ef4e73e9794f2e642d0be8770281a077bb270fb9cd6d89103150fa53f80d1b` |
| Art | compass rose / pinwheel: dark indigo field, two thin white orbits, eight kite-shaped blades, and a three-band hub running aqua → periwinkle → violet |
| Rose bbox | x 82–681, y 282–877 (600 × 596 px), centre (381.5, 579.5) |
| Generator | [`apps/desktop/scripts/brand-assets.mjs`](../../apps/desktop/scripts/brand-assets.mjs) |

Hexes measured from the image: field `#191B4C` → `#0F0C2B`, aqua blades
`#4ADEFC`/`#51F1FF`, sky `#5CA9F8`/`#43C4FD`, hub `#688CFC`, periwinkle
`#6E69F4`, violet `#A264FA`, lilac `#D19DFC`. The palette itself is fixed in
the section below — do not invent new hexes for imagery or UI.

![LifeQuest horizontal lockup](lifequest-lockup-horizontal@2x.png)

## Regenerate

```bash
node apps/desktop/scripts/brand-assets.mjs
```

Run from anywhere; paths resolve from the script. It rewrites every file in the
asset ladder below, prints the files and their byte sizes, and exits non-zero if
an output is not a valid, correctly-sized icon. A rerun on the same source is
byte-identical (verified by hashing all outputs across two runs), so a diff only
ever means the generator or the source changed.

Tooling — no npm dependencies are added, and none are needed:

- **ImageMagick `convert`/`identify`** (required) — crop, Lanczos resampling,
  the circular alpha masks and the multi-size ICO container.
- **Node's `fs`** (required) — the ICNS container is assembled by hand, because
  `png2icns`/`iconutil` do not exist on this Linux build machine.
- **Headless Chromium** (required only for the two SVG lockups' `@2x` exports;
  the SVG text has to be rendered by a real text engine). The generator discovers
  `chromium`/`google-chrome`/Playwright's cached Chromium; override with
  `LIFEQUEST_CHROMIUM=/path/to/chrome`, or install `rsvg-convert` as a fallback.
- **python3 / Pillow are not used by the generator.** (Pillow was used once, by hand, as an independent read-only check that the assembled ICNS decodes; it is not a build dependency.)

`icon.icns` cannot be opened on this machine, so the generator validates it
structurally instead: `icns` magic, declared length equal to file length, every
chunk a decodable PNG of the expected pixel size, no trailing bytes. The first
macOS `npm run release` should confirm it dresses the bundle; the chunk set is
the modern `icp4`…`ic14` PNG set, which macOS 10.13+ reads. As an independent
check, Pillow's ICNS reader opens the file as a 1024 × 1024 RGBA icon and lists
all eleven representations (16, 32, 64, 128, 256, 512, 1024 plus the @2x set).

## Geometry

The two crops are taken from the image's **own field** — never from a synthetic
background — so the soft radial glow around the rose stays continuous and there
is no pasted-square seam.

| | crop | why |
| --- | --- | --- |
| App icon | native 768 × 768 at (0, 196) | the largest native square; the rose keeps ≈11 % breathing room on every side (10.7 % left, 11.2 % top, 11.3 % right/bottom) |
| Badge | native 698 × 698 at (33, 231), centred on the rose | the rose is 600/698 = **86.0 %** of the disc, which is the contract's ~86 %; the circle masks only field, never a blade tip |

Only one upscale exists: the native 768 px square is Lanczos-resampled to
1024 px for `icon.png` (1.33×). Nothing is generated larger than 1024 px, and
all smaller sizes are single-step downscales of the native art — no upscale is
ever downscaled back down.

ICO is a standard modern multi-image container: BMP (DIB) frames for
16/24/32/48/64/128 and a PNG-compressed 256 frame, which is what Windows shell
and electron-builder expect. All frames are 32-bit truecolor except the 16 px
one, which is 8-bit paletted because a 16 × 16 frame cannot exceed 256 colours
anyway (a valid, classic ICO arrangement). `favicon.ico` follows the same recipe at 16/32/48.

The badge is a circular alpha mask inscribed in that 698 px square, supersampled
and downscaled, so the rim is cleanly anti-aliased: transparent outside the disc,
opaque inside, corner alpha exactly 0.

## Palette — final, do not invent new hexes

Hexes were measured from the image: `#191B4C`/`#0F0C2B` field, `#4ADEFC`/`#51F1FF`
aqua blades, `#5CA9F8`/`#43C4FD` sky, `#688CFC` hub, `#6E69F4` periwinkle,
`#A264FA` violet, `#D19DFC` lilac.

### `lifequest` night (`darkColors`) — the hero

| token | hex | role |
| --- | --- | --- |
| background | `#0A0920` | page canvas, deepest ink |
| card | `#151438` | cards / panels, one step up |
| muted | `#0F0E2A` | mat band = the dock's quiet band |
| mutedForeground | `#9A97C9` | quiet ink |
| foreground | `#E8E6FB` | body ink (lavender white) |
| popover | `#1A1942` | menus |
| primary | `#4ADEFC` | brand aqua |
| primaryForeground | `#06122B` | ink on aqua |
| secondary | `#26255C` | chips / soft fill |
| accent | `#1E1D48` | quieter fill |
| border | `#272659` | hairlines |
| input | `#3A3878` | input edge |
| ring | `#8F86FF` | focus / selection (periwinkle) |
| midground | `#8CEBFB` | hover lift (light aqua → dark ink via readableOn) |
| composerRing | `#2E2A66` | line ink: tints lines indigo, keeps shadows dark |
| destructive | `#FF5C7A` | |
| success | `#3DDC9A` | |
| info | `#5CA9F8` | |
| sidebarBackground | `#0D0C28` | |
| sidebarBorder | `#2A2960` | |
| userBubble | `#1B1A46` | composer surface |
| userBubbleBorder | `#3A3975` | |
| composerForeground | `#EDEBFF` | |
| composerPlaceholder | `#8E8BC2` | |

### `lifequest` day (`colors`)

| token | hex |
| --- | --- |
| background | `#EDEEFB` (mat) |
| card | `#FBFBFF` (sheet) |
| muted | `#E4E6F7` |
| mutedForeground | `#5F6089` |
| foreground | `#171735` |
| popover | `#FFFFFF` |
| primary | `#4B4FE0` (indigo, white ink) |
| primaryForeground | `#FFFFFF` |
| secondary | `#E2E3FA` |
| secondaryForeground | `#262650` |
| accent | `#EAEBFB` |
| accentForeground | `#2A2A55` |
| border | `#D2D4EF` |
| input | `#BCC0E8` |
| ring | `#4B4FE0` |
| midground | `#3B3FCB` |
| composerRing | `#8B8CF0` |
| destructive | `#C22A4A` |
| destructiveForeground | `#FFFFFF` |
| success | `#21794F` |
| info | `#1E6F9E` |
| sidebarBackground | `#E9EBF9` |
| sidebarBorder | `#CFD2EE` |
| userBubble | `#EEF0FF` |
| userBubbleBorder | `#C7CBEF` |
| composerForeground | `#1B1B3D` |
| composerPlaceholder | `#8A8CB4` |

The skin carries no font opinion: system stacks only.

## Asset ladder

Every path is relative to the repo root. Sizes are the actual pixel dimensions
of the file on disk.

| file | size / form | where it is used |
| --- | --- | --- |
| `apps/desktop/build/icon.png` | 1024 × 1024, opaque indigo field + full rose, ≈11 % margin | Electron window icon; packaged into the asar (`files` in `electron-builder.yml`); source of the ICO/ICNS ladder |
| `apps/desktop/build/icon.ico` | 16/24/32/48/64/128/256 multi-image (32-bit BMP frames + PNG 256) | Windows exe, taskbar, Start-menu/desktop shortcuts, file association (`win.icon`) |
| `apps/desktop/build/icon.icns` | macOS set: `icp4` 16, `icp5` 32, `icp6` 64, `ic07` 128, `ic08` 256, `ic09` 512, `ic10` 1024, plus `@2x` variants `ic11` 32, `ic12` 64, `ic13` 256, `ic14` 512 | macOS app-bundle icon |
| `apps/desktop/build/installerIcon.ico` | byte-identical to `icon.ico` (same 256 art) | NSIS installer window, header strip and uninstaller (`nsis.installerIcon`, `uninstallerIcon`, `installerHeaderIcon`) |
| `apps/desktop/public/favicon.png` | 64 × 64 circular badge, transparent outside the disc | route favicon (`<link rel="icon" type="image/png">` in `index.html`) |
| `apps/desktop/public/favicon.ico` | 16/32/48 square art (opaque field) | browser tab fallback for `/favicon.ico` |
| `apps/desktop/public/brand/lq-mark-32.png` | 32 × 32 circular badge | smallest in-app mark slot |
| `apps/desktop/public/brand/lq-mark-64.png` | 64 × 64 circular badge | the named copy of the nav-rail mark (drawn at 22 px) |
| `apps/desktop/public/brand/lq-mark-128.png` | 128 × 128 circular badge | `apple-touch-icon` |
| `apps/desktop/src/assets/brand/lq-mark-64.png` | byte copy of the 64 badge | **what `BrandLockup` imports** for the rail via Vite |
| `apps/desktop/src/assets/brand/lq-mark-128.png` | byte copy of the 128 badge | **what `BrandLockup` imports** for the board's stacked lockup |
| `apps/desktop/public/brand/lq-mark-256.png` | 256 × 256 circular badge | splash mark (88 px); embedded as the mark inside both SVG lockups |
| `apps/desktop/public/brand/lq-mark-512.png` | 512 × 512 circular badge | high-DPI boards, decks and exports |
| `docs/brand/lifequest-lockup-horizontal.svg` | 467 × 121 vector; 96 px mark + live `<text>` wordmark | docs, README, decks, anything that wants the name set beside the mark |
| `docs/brand/lifequest-lockup-horizontal@2x.png` | 934 × 242 PNG, transparent | the horizontal lockup where SVG cannot be used |
| `docs/brand/lifequest-lockup-stacked.svg` | 364 × 249 vector; 128 px mark above the centred wordmark | square-ish placements: covers, title slides |
| `docs/brand/lifequest-lockup-stacked@2x.png` | 728 × 498 PNG, transparent | the stacked lockup where SVG cannot be used |

![LifeQuest circular mark](../../apps/desktop/public/brand/lq-mark-512.png)

Why the mark exists twice: the `public/brand` files are addressable URLs for
things outside the bundle (the splash in `index.html`, `apple-touch-icon`, this
guide), while the `src/assets/brand` copies are imported by `BrandLockup` so
Vite resolves them from any page — the e2e harness pages live under `/e2e/`, and
a document-relative `./brand/…` URL painted a broken image there — and hashes
them into the packaged `file://` build. Both are written by the same generator
from the same 64/128 renders, so there is still one drawing of the mark.

### The wordmark

- In the app the wordmark is **live text**, never baked into an image:
  `BrandLockup` sets `LifeQuest` in `--font-sans` at weight 650, tracking
  −0.015em, tinted by `--text-strong` (periwinkle accent for `Quest` in the
  `twotone` variant). The mark beside it is `lq-mark-64.png`.
- The two SVG lockups set the same word in the app's own system stack —
  `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica,
  Arial, sans-serif` — as a real `<text>` element at weight 650 and −0.015em
  tracking. They are self-contained: the mark is embedded in the SVG as a PNG
  data URI, so the file still renders when moved alone.
- Lockup ink is the palette periwinkle `#6E69F4` — the one brand hex that clears
  both surfaces these files land on: 4.7:1 on the night page `#0A0920` and
  4.2:1 on the day sheet `#FBFBFF`. One transparent lockup serves dark and light
  docs; on-app surfaces should use the live `BrandLockup` instead, so the
  wordmark follows the theme tokens.
- The `@2x` PNGs are rendered from the SVG at 2× by a headless Chromium — a real
  vector render, not an upscaled raster. They will pick up whatever system font
  the build machine resolves the stack to (DejaVu Sans here); the SVG is the
  source of truth and renders in the viewer's own system font.

## Readability checks

- The app icon is square, centred, and keeps ≈11 % margin; `icon.ico` carries
  every size 16–256.
- **At 32 px the circular mark reads as a compass star** — aqua north spear,
  aqua west/east blades, violet south blade and hub ring are all distinguishable
  — and so does the 32 px square icon frame in `icon.ico`; the 16 px frame reads
  as a four-point star. Checked by extracting the ICO frames and zooming the
  32 px PNG ×8 rather than trusting the size table alone.
- Badge alpha is exact: corner pixel `srgba(0,0,0,0)`, centre `srgba(…,1)`, rim
  anti-aliased from the supersampled mask.

## Rules

- Do not add glow, gradients, bevels, text or extra shapes to the raster art.
  The only gradients present are the ones the source image already has.
- Do not bake the wordmark into the raster icons or the badge; use the SVG
  lockups or the live component.
- Do not upscale beyond 1024 px, and do not hand-edit a generated file: change
  the generator (or the source) and rerun it, so the whole ladder stays in sync.
- Do not introduce new hexes: the palette above is the complete brand palette.
