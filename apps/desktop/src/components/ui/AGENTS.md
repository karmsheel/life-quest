# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`, `raised`. Danger is `destructive`, not a new color class. `raised` is the one filled, bevelled control — the page's own act (the Daily Note's Analyze note), named as the Flat First exemption in `DESIGN.md`; do not reach for it as a generic emphasis style.
- Buttons are pills via `.btn`. Do not override `border-radius` on `Button`. The named exceptions are the journal's own page, the Decisions card's answers, and a settings row's control (`.settings-card__control .btn`), all written down in `DESIGN.md`.
- Inputs are `--radius-sm` (12px), not pills. The settings search is the one pill-shaped field (see `DESIGN.md`): it crosses a panel edge and has no panel corner to agree with.
- Use `Toggle` for a bit that takes effect the moment it is flipped (arming a destructive action, turning a mode on). A settings row's label names it, so it carries no caption by default; pass `caption` when the switch stands beside a name that does not describe it (a domain's `Allow restore`). Use a checkbox when the choice is read on submit.
- The studio is three square panes (`.nav-rail`, `.shell__main`, `.chat-panel`) plus Welcome. `.shell` is only the grid, and it carries no gap: the panes abut. The rail and the titlebar wear the window's own mat (`--canvas-base`); the sheet, the dock and Welcome wear the page canvas, `--background`. `--card` is the step above that canvas — cards, panels, menus, the composer. Between panes, the sheet carries the one hairline, on its trailing edge (the seam with the dock); the rail, the dock and the sheet's other edges paint no line at all. The top bar and the dock's header are one band height (`--shell-topbar-height`), so their underlines meet as a single line — do not give either its own vertical padding. The sheet's leading top corner is the studio's one radius (`--radius-sm`); every other corner is square. Feature files must not wrap a second canvas frame around a pane or add glass.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
