# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`. Danger is `destructive`, not a new color class.
- Buttons are pills via `.btn`. Do not override `border-radius` on `Button`.
- Inputs are `--radius-sm` (12px), not pills.
- The studio sheet is `.shell` / `.welcome` CSS. Feature files must not add a second canvas frame.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
