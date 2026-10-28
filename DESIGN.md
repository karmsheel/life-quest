# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat, and the fill of the chrome that sits on it — the titlebar and the nav rail, which read as one band of mat wrapping the sheet. `--card` is the card step: cards, panels, menus, popovers and the composer, all lifted off the page. `--background` is the page canvas — the sheet and the dock are painted with it — and it aliases `--bg` so outline controls blend. By day skins write `--canvas-base` from the palette background, or mix toward ink when background equals card; at night it is the palette's quiet band.

Day and night run the ladder in opposite directions. By day the mat and the panels sink below the paper, so the sheet reads as the lit surface. At night **every** dark palette inverts: the page canvas is the deepest surface in the window — the sheet, the dock and the boot pane all paint `--background` — the cards and the panels take `--card` and step up off it, and the mat takes the palette's quiet band, the very ink `--muted-surface` gives the dock's bottom action row (`.chat-panel__actions`). So in every night skin the window's frame and that icon row are one material, and nothing in the window paints below the page. A palette earns that by keeping `background` its deepest ink and giving `muted` a step above it; the mat follows both without a per-skin value.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`. `--scrollbar-thumb` is the scrollbar's ink: an alias of `--muted-foreground`, so a skin repaints the bar with the rest of the chrome and the brand cannot reach it.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--canvas-base` and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Dark Ladder — at night the page canvas is the darkest surface: the sheet and the dock paint `--background`, the cards and the panels step up off it, and the mat wears the palette's `--muted-surface` ink. Never paint a card or the mat below the page. **Named exemption:** a skin that is a faithful copy of an upstream theme may declare `darkLadder: "inverted"` and keep that theme's own elevation direction. `nous` does, because GitHub Dark Default puts its cards below its page. The mat still lifts off the page either way; both rigs assert the *declared* direction rather than skipping the claim.
- Palette-Only Skin — a skin carries a palette and, optionally, font stacks. It does not ship layout, radii, motion, imagery or a `[data-skin]` CSS layer. The one exception this file ever granted — Nous's type treatment, orbit art and mat texture — was retired when Nous was replaced by the Hermes Desktop preset.
- Scrollbar Is Chrome — every native scroller wears the app's own bar rather than the platform's: `0.5rem`, a transparent track, and a pill thumb drawn **quietly at rest** and strengthened when its own region is hovered (then again under the pointer). The ink is `--scrollbar-thumb`, the palette's mid ink, so a skin repaints the bar and the accent never tints it. Geometry is fixed at rest and on hover, so strengthening the bar cannot reflow the content it belongs to. **Deliberate difference from Hermes:** Hermes draws no thumb at all until its region is hovered, which reads to an operator as "there is no scrollbar here"; this app keeps the shape and keeps the bar findable. A custom scrollbar follows its own region, never hover anywhere in the app.
- One Frame Per Card — a card draws its own shell, and its container adds none. A wrapper around a card carries layout markers only (`.view-card--span2`); giving it the card's own class nested two shells and put a frame inside a frame on every view pin.
- One Box — a markdown editor is `LiveMarkdownEditor`, one surface where the file renders and the paragraph under the caret does not. Never add a second pane beside it: two surfaces that show the same file can disagree about it, and the operator has to read both to know which one is right.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet.
- Calm Scale — radii are `6 / 12 / 18 / 24 / --radius-pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

**Named exception — the journal's own page.** `Daily Note` (`.daily-note`) wears `.btn` at `--radius-xs` rather than the pill, the same way `.data-studio` and `.pages-studio` already square theirs. The day's page is a page of prose with a pager above it and a strip of days below, and a row of pills around a paragraph reads as chips rather than as the page's own controls. The step is the Calm Scale's own smallest, so the primitive is worn at a different step rather than restyled, and the override lives in `notes.css` with the page's other chrome. Every other wing keeps the pill.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-sm`.

`LiveMarkdownEditor` (`.note-live`) is the studio's one markdown surface. Every editor that writes markdown — a daily note, a doctrine document, a review — is this box: the file reads as prose and the paragraph under the caret is its raw markdown, in place. A locked document renders the same box read-only, with no writing line at all. There is no split editor and no preview pane beside it.

The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) on a `--shell-frame` (12px) canvas mat. The rail and the titlebar wear the mat itself (`--canvas-base`) and read as one band of chrome wrapping the sheet; the sheet, the dock and Welcome wear the page canvas, `--background`. `.shell` carries no gap — the panes abut, so the only mat left on the sheet's edges is the strip under the titlebar. Its leading edge meets the rail, its trailing edge the dock's leading edge, its bottom edge the window's bottom, exactly as the dock is flush to the window's right and bottom. Between panes there is exactly **one** line: the sheet's trailing hairline, the seam with the dock. The sheet's top, leading and bottom edges paint nothing — the rail meets it as a change of fill, and the pane gap under the titlebar is what separates it from the strip. The line under the strip is the top bar's own hairline, drawn under the domain lens; the dock's header wears the same band height (`--shell-topbar-height`), so that line runs on across the right-hand pane as one line rather than two a pixel apart at the seam; it does not cross into the rail, whose band under the wing switcher paints no line of its own. The boot surfaces — the vault picker and the companion setup screen, both `.welcome` — are that same pane with no rail or dock beside them: one pane gap under the titlebar and flush to the window's other three edges, and the one place the pane still draws a full box, because no neighbour's line can be the seam there. The sheet's leading top corner is the studio's one radius (`--radius-sm`), set beside the rail's wing switcher: it is the only corner of the three panes with mat on both sides of it — the rail to its left, the pane gap above — so the curve opens onto the chrome band instead of notching the rail's seam or a window edge. Every other corner is square, and only the sheet keeps `--shadow-sm` (Flat First). `.shell` is the grid tray, not a sheet. Feature files must not add a second frame or extra glass.

The tray's last two panes trade places — the titlebar's switch-position control, beside the settings, swaps the dock's column for the sheet's (`.shell--chat-left`, one click and one click back). The rail never moves: it is the window's chrome, not a pane of this tray, so it holds the leading edge and the dock sits just past it, with the sheet taking the trailing column and the `--shell-frame` slack out to the window's own right edge, exactly as the dock does from the other side. Everything the two panes own travels with them: the sheet paints the seam on whichever edge faces the dock and never on both, and keeps its one radius on the leading top, because the corner the swap puts on the window's edge is no place for a notch. It is session state like the rail's own collapse — a way of looking at the workspace for a moment, not a stored preference.

## Remaining visual do-not-do

Do not add dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.

## Nous and Nous Classic

Both are **copies of Hermes Desktop's bundled presets**, taken from
`apps/shared/src/theme-presets.ts` in the Hermes install. Hermes ships them as its
product identity — `nous` is its `DEFAULT_SKIN_NAME` — so LifeQuest carries the
same two names and the same palettes rather than a re-derivation of them, and a
user moving between the two apps sees one look. Re-import from Hermes rather than
hand-editing hexes here.

Neither is a special skin. Both are **palettes and nothing else**: Hermes's theme
model keeps layout, sizing, radius and typography out of the palette, and both
themes declare only the system font stacks, no imagery and no second accent. So
neither has a `[data-skin]` CSS layer, and the type treatment, orbit art and mat
texture that this file once specified for Nous are retired.

| | **Nous** | **Nous Classic** |
| --- | --- | --- |
| Hermes id | `nous` | `nous-alt` |
| Idea | "GitHub chrome, Nous blue accent" | "Glass neutrals, cream on mission-blue" |
| Light | GitHub Light Default + `#0053fd` | `#f8faff` glass + `#0053fd` |
| Dark | GitHub Dark Default + `#4a84fe` | `#ffe6cb` cream on `#0d2f86` |
| Brand blue | the accent only | the surface itself |

Two mapping notes, both deliberate:

- **`background` and `card` are swapped in the light palettes.** LifeQuest's light
  ladder sinks the mat below the sheet: `background` becomes `--canvas-base` (the
  rail and titlebar) and `card` becomes `--background` (the sheet). Hermes has no
  such ladder. Read straight across, Nous would paint a white rail around a grey
  sheet — GitHub's layout inverted — so Hermes's page white goes in `card` and its
  grey sidebar in `background`.
- **`nous` declares `darkLadder: "inverted"`.** GitHub Dark Default puts its cards
  (`#010409`) below its page (`#0d1117`). See the exemption under Dark Ladder
  above.

Classic's declared `color-mix(in srgb, …)` values are resolved to hex **in sRGB**,
faithfully, so the violet cast Hermes's own preset carries is preserved rather
than corrected. Fixing it would be a re-derivation, not a copy.

### Blending: OKLab, not sRGB

The one piece of Hermes's design style that is not a palette entry, and the piece
that matters most here.

`mix()` lerps gamma-encoded sRGB channels, which bends hue on the way: a saturated
blue mixed 88% toward white lands **~21° violet** of where it started
(`#0000f2` → `#e0e0fd`, measured). That is how a clean blue accent produced a
lavender selected row, a lilac chip border and a periwinkle mat — and it is a
property of the blend, not of the palette, so **no palette hex can fix it**. The
drift happens after the palette.

`mixOklab()` in `src/lib/themes/color.ts` (ported from Hermes's
`apps/desktop/src/themes/color.ts`) walks chroma and lightness instead and holds
the hue: the same blend lands **0.3°** off. `apply-skin.ts` uses it for the blends
whose ink is the brand — `--accent-tint`, the input edge and `--line`. Everything
else there blends neutrals, where `mix` is correct and there is no hue to
preserve.

Two things worth remembering when reading those numbers:

- Hermes's comment says 7.6°; that is for a different reference blue. The figure to
  trust is the one the rig measures, and it measures both mixers every run.
- Near white the metric stops meaning anything: OKLCH chroma collapses, so the hue
  angle of `#0053fd` at 88% is numerically unstable in either direction. The rig
  therefore asserts on a saturated seed (`#0000f2`) where the two mixers visibly
  part company, and only reports the near-white case.
