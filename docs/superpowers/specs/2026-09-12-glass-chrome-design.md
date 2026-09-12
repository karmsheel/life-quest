# Glass chrome — Design Spec

**Date:** 2026-09-12  
**Status:** Approved — implemented on master  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Three-pane studio](./2026-09-04-three-pane-studio-design.md), [BERD Visuals Phase 2](./2026-09-03-berd-visuals-phase-2-design.md)

Three-pane studio paints rail, main, and chat as opaque `--card` panes. This spec frosts **floating chrome only** (nav rail and chat panel) with quiet `card-glass` over the warm mat. Main, Welcome, and the titlebar stay paper / canvas.

---

## 1. Purpose

Rail and chat should read as frosted paper over the desk, not solid cards. Content stays opaque. Identity stays Grounded life studio — not BERD’s gray workbench or dot-grid.

### Success criteria

- `.nav-rail` and `.chat-panel` use `--card-glass` + `--backdrop-panel`. Radius, 1px `--border`, and `--shadow-sm` stay.
- `.shell__main`, `.welcome`, and `.window-titlebar` do not use glass.
- Canvas stays `--canvas-base`. No dot-grid.
- Quiet frost that actually reads: light mix is 52% `--card`; dark mix is 60%. Blur is 18px. Rail and chat keep a 1px inset highlight so the pane edge is visible on a warm mat with no grid.
- Skins write `--card-glass` from `--card`. They do not write `--backdrop-panel`.
- Missing `backdrop-filter` falls back to solid `--card` on those two panes.
- `npm test` and `npm run typecheck` in `@lifequest/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Where | **BERD chrome only.** Nav rail and chat panel. |
| 2 | Not glass | Main pane, Welcome, titlebar. Composer stays in-panel (not a floating pill). |
| 3 | Canvas | **Warm mat only.** No BERD dot-grid. |
| 4 | Density | **Visible frost.** Light: `color-mix(in srgb, var(--card) 52%, transparent)`. Dark: 60%. 90% was optically identical to opaque paper on the warm mat. |
| 5 | Blur | `--backdrop-panel`: light `blur(18px) saturate(160%) brightness(1.02)`; dark `blur(18px) saturate(160%) brightness(1.08)`. |
| 6 | Implementation | **Token + restyle existing panes.** No `.card-glass` utility class, no `PageShell`, no `GlassButton`. |
| 7 | Skins | Write `--card-glass` from the skin card hex. Do not write `--backdrop-panel`. |
| 8 | Fallback | `@supports not` backdrop-filter → `background: var(--card)` on rail and chat. |
| 9 | Out of scope | Dot-grid, Inter/Geist, `--accent` reclaim, `PageShell`, pill composer, leftover `.btn` migration, glass titlebar. |

---

## 3. Architecture

Chosen: **two extension tokens, paint the two chrome panes.** Rejected: a reusable `.card-glass` class; overlay/pseudo trick.

```
.app-root                         → --canvas-base
  WindowTitleBar                  → canvas (unchanged)
  .app-root__body
    .shell                        → transparent tray
      .nav-rail                   → --card-glass + --backdrop-panel
      .shell__main                → --card (unchanged)
      .chat-panel                 → --card-glass + --backdrop-panel
    .welcome                      → --card (unchanged)
```

### 3.1 Tokens

Life Quest extensions in `tokens.css` (`:root`, `[data-theme="dark"]`, and system-dark):

```css
--card-glass: color-mix(in srgb, var(--card) 52%, transparent);
--backdrop-panel: blur(18px) saturate(160%) brightness(1.02);
```

Dark blocks use 60% mix and `brightness(1.08)`. Rail and chat add `inset 0 1px 0` highlight on top of `--shadow-sm`.

`--card-glass` is not an alias of `--card`. `--backdrop-panel` is a filter recipe, not a color.

### 3.2 Pane CSS

`.nav-rail` and `.chat-panel`:

- `background: var(--card-glass)`
- `backdrop-filter: var(--backdrop-panel)`
- `-webkit-backdrop-filter: var(--backdrop-panel)`
- Keep `border-radius: var(--radius-sm)`, `border: 1px solid var(--border)`, `box-shadow: var(--shadow-sm)`

`.shell__main` and `.welcome` keep `background: var(--card)`.

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .nav-rail,
  .chat-panel {
    background: var(--card);
  }
}
```

### 3.3 Skins

`forgeVarsFromColors` writes:

```ts
"--card-glass": `color-mix(in srgb, ${elevated} ${dark ? 92 : 90}%, transparent)`
```

`clearSkinVars` removes `--card-glass`. It does not set or clear `--backdrop-panel`.

### 3.4 Constitution

**`DESIGN.md`**

- Canvas / paper / glass: `--canvas-base` mat; `--card` for main and Welcome; `--card-glass` for rail and chat.
- Remaining do-not-do drops `card-glass`. Still: no dot-grid, Inter/Geist as default fonts, pill composer, `PageShell`, `--accent` reclaim.

**`apps/desktop/src/components/ui/AGENTS.md`**

- Rail and chat are glass chrome. Main and Welcome stay paper. Feature files must not add glass.

---

## 4. Error handling and edge cases

- No `backdrop-filter`: opaque `--card` on rail and chat.
- Skin with unusual card hex: mix still uses that hex at 90%/92%.
- Collapsed chat: same glass chrome, still the third grid column.

---

## 5. Testing

- `tokens.css` defines `--card-glass` 90% light / 92% dark and `--backdrop-panel` blur recipes.
- `apply-skin.ts` writes `--card-glass`, not `--backdrop-panel`, and not alias keys.
- Scanner requires `--card-glass` write.
- `.nav-rail` / `.chat-panel` use `--card-glass` + `--backdrop-panel`. `.shell__main` / `.welcome` / `.window-titlebar` do not.
- `DESIGN.md` records `--card-glass` and the shrunk do-not-do list.

Manual look lock: Welcome (paper), vault-open rail + chat frost over mat, main opaque, titlebar canvas, one skin switch (Nous), light/dark.

---

## 6. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| All three panes glass | Main is contained content; BERD keeps those opaque |
| Glass titlebar | Titlebar stays canvas fill; overlay reads `--canvas-base` |
| BERD 78% mix | Nearly invisible on cream without a grid |
| Dot-grid canvas | Identity; locked warm mat only |
| `.card-glass` utility class | Easy to splash onto Welcome/main |
| Overlay/pseudo on `--card` | Two surfaces; no real token |
