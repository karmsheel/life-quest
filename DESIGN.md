# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench. Phase 2 owns selected visual elements.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First / Calm Scale — recorded for Phase 2; do not change elevation or type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). 8px radius. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome.

## Phase 2 do-not-do

Do not add canvas/glass/dot-grid, 6px concentric radii, `rounded-full` buttons, Inter/Geist as default UI fonts, a pill composer, or reclaim `--accent` as hover in this phase.
