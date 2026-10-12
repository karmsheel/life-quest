# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat, and the fill of the chrome that sits on it — the titlebar and the nav rail, which read as one band of mat wrapping the sheet. `--card` is the card step: cards, panels, menus, popovers and the composer, all lifted off the page. `--background` is the page canvas — the sheet and the dock are painted with it — and it aliases `--bg` so outline controls blend. Skins write `--canvas-base` from the palette background, or mix toward ink when background equals card; a night palette may instead name a `canvas` ink, and Forge OS points that at the dock's own quiet band.

Day and night run the ladder in opposite directions. By day the mat and the panels sink below the paper, so the sheet reads as the lit surface. At night the page canvas is the **deepest** surface in the window: the palette's `background` is the page, `card` is the step above it, and a palette that names its dark `canvas` puts the mat — rail, titlebar, window frame — on whatever ink it names, so long as it stays off the page's floor. Forge OS names `--muted-surface`, the fill of `.chat-panel__actions`: the frame and the icon menu at the foot of the chat bar are one material, and the sidebar and strip are the darkest chrome in the window after the page itself. That inversion is opt-in per palette: Nous's night is a deliberately deeper brand-blue rail over a lighter sheet, and it leaves `canvas` out and keeps the day order.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--canvas-base` and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Dark Ladder — at night the page canvas is the darkest surface: the sheet and the dock paint `--background`, the cards and the panels step up off it, and the mat sits between the two. Never paint a card or the mat below the page.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet.
- Calm Scale — radii are `6 / 12 / 18 / 24 / --radius-pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-sm`.

The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) on a `--shell-frame` (12px) canvas mat. The rail and the titlebar wear the mat itself (`--canvas-base`) and read as one band of chrome wrapping the sheet; the sheet, the dock and Welcome wear the page canvas, `--background`. `.shell` carries no gap — the panes abut, and every seam is the sheet's own hairline — so the only mat left on the sheet's edges is the strip under the titlebar. Its leading edge meets the rail, its trailing edge the dock's leading edge, its bottom edge the window's bottom, exactly as the dock is flush to the window's right and bottom. The boot surfaces — the vault picker and the companion setup screen, both `.welcome` — are that same pane with no rail or dock beside them: one pane gap under the titlebar, flush to the window's other three edges. The sheet is the one pane boxed on all four sides, and its frame is the only line at each seam: neither the rail nor the dock paints an edge of its own, so no divider is ever doubled. The sheet's top hairline is the line the titlebar reads as its own, and the dock carries the same hairline on its top edge so that line runs across the right-hand pane too. None is rounded — a radius on a pane flush with the window's edge would leave a notch the canvas shows through — and only the sheet keeps `--shadow-sm` (Flat First). `.shell` is the grid tray, not a sheet. Feature files must not add a second frame or extra glass.

## Remaining visual do-not-do

Do not add dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.
