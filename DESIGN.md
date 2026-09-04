# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat. `--card` is paper for the three studio panes and Welcome. `--background` is paper on the sheet (aliases `--bg`) so outline controls blend. Skins write `--canvas-base` from the palette background, or mix toward ink when background equals card.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--canvas-base` and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet.
- Calm Scale — radii are `6 / 12 / 18 / 24 / --radius-pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-sm`.

The studio is three `--card` panes (`.nav-rail`, `.shell__main`, `.chat-panel`) at `--radius-sm` on a `--shell-frame` (12px) canvas mat. `.shell` is the grid tray, not a sheet. Welcome is one card at the same radius. Feature files must not add a second frame.

## Remaining visual do-not-do

Do not add `card-glass`, dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.
