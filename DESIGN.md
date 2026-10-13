# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat, and the fill of the chrome that sits on it — the titlebar and the nav rail, which read as one band of mat wrapping the sheet. `--card` is the card step: cards, panels, menus, popovers and the composer, all lifted off the page. `--background` is the page canvas — the sheet and the dock are painted with it — and it aliases `--bg` so outline controls blend. By day skins write `--canvas-base` from the palette background, or mix toward ink when background equals card; at night it is the palette's quiet band.

Day and night run the ladder in opposite directions. By day the mat and the panels sink below the paper, so the sheet reads as the lit surface. At night **every** dark palette inverts: the page canvas is the deepest surface in the window — the sheet, the dock and the boot pane all paint `--background` — the cards and the panels take `--card` and step up off it, and the mat takes the palette's quiet band, the very ink `--muted-surface` gives the dock's bottom action row (`.chat-panel__actions`). So in every night skin the window's frame and that icon row are one material, and nothing in the window paints below the page. A palette earns that by keeping `background` its deepest ink and giving `muted` a step above it; the mat follows both without a per-skin value.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--canvas-base` and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Dark Ladder — at night the page canvas is the darkest surface: the sheet and the dock paint `--background`, the cards and the panels step up off it, and the mat wears the palette's `--muted-surface` ink. Never paint a card or the mat below the page.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet.
- Calm Scale — radii are `6 / 12 / 18 / 24 / --radius-pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-sm`.

The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) on a `--shell-frame` (12px) canvas mat. The rail and the titlebar wear the mat itself (`--canvas-base`) and read as one band of chrome wrapping the sheet; the sheet, the dock and Welcome wear the page canvas, `--background`. `.shell` carries no gap — the panes abut, so the only mat left on the sheet's edges is the strip under the titlebar. Its leading edge meets the rail, its trailing edge the dock's leading edge, its bottom edge the window's bottom, exactly as the dock is flush to the window's right and bottom. Between panes there is exactly **one** line: the sheet's trailing hairline, the seam with the dock. The sheet's top, leading and bottom edges paint nothing — the rail meets it as a change of fill, and the pane gap under the titlebar is what separates it from the strip. The line under the strip is the top bar's own hairline, drawn under the wing and domain selectors; the dock's header wears the same band height (`--shell-topbar-height`), so that line runs on across the right-hand pane as one line rather than two a pixel apart at the seam. The boot surfaces — the vault picker and the companion setup screen, both `.welcome` — are that same pane with no rail or dock beside them: one pane gap under the titlebar and flush to the window's other three edges, and the one place the pane still draws a full box, because no neighbour's line can be the seam there. The sheet's leading top corner is the studio's one radius (`--radius-sm`), set beside the wing selector's first tab: it is the only corner of the three panes with mat on both sides of it — the rail to its left, the pane gap above — so the curve opens onto the chrome band instead of notching the rail's seam or a window edge. Every other corner is square, and only the sheet keeps `--shadow-sm` (Flat First). `.shell` is the grid tray, not a sheet. Feature files must not add a second frame or extra glass.

## Remaining visual do-not-do

Do not add dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.
