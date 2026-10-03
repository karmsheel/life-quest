# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`. Danger is `destructive`, not a new color class.
- Buttons are pills via `.btn`. Do not override `border-radius` on `Button`.
- Inputs are `--radius-sm` (12px), not pills.
- The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) plus Welcome. `.shell` is only the grid. The rail is `--card-glass`; the sheet, the dock and Welcome are `--card`. Each pane carries one hairline, at the edge it shares with a neighbour. Feature files must not wrap a second canvas frame around a pane or add glass.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
