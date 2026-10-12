# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`. Danger is `destructive`, not a new color class.
- Buttons are pills via `.btn`. Do not override `border-radius` on `Button`.
- Inputs are `--radius-sm` (12px), not pills.
- The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) plus Welcome. `.shell` is only the grid, and it carries no gap: the panes abut. The rail and the titlebar wear the window's own mat (`--canvas-base`); the sheet, the dock and Welcome wear the page canvas, `--background`. `--card` is the step above that canvas — cards, panels, menus, the composer. Each pane carries one hairline, at the edge it shares with a neighbour. Feature files must not wrap a second canvas frame around a pane or add glass.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
