# BERD Visuals Phase 2 — Design Spec

**Date:** 2026-09-03  
**Status:** Approved — implementation plan at docs/superpowers/plans/2026-09-03-berd-visuals-phase-2.md  
**Product:** LifeQuest — local-first life-management studio  
**Reference:** [block/berd](https://github.com/block/berd) selected visuals (not a visual fork)  
**Depends on:** [BERD Systems Phase 1](./2026-09-02-berd-systems-phase-1-design.md), [Custom window chrome](./2026-08-28-custom-window-chrome-design.md)

Phase 1 installed the design contract without restyling. This spec restyles **a subset**: warm canvas/sheet ladder, concentric 6px radii, pill buttons. Identity stays Grounded life studio.

---

## 1. Purpose

LifeQuest should read as a paper studio sitting on a desk: a warm mat around one sheet, tighter nested corners, and pill controls. It must not become BERD’s gray workbench, glass chrome, or dot-grid.

The existing DOM is the layout. `.app-root`, `.window-titlebar`, `.shell`, and `.welcome` get new paint. No `PageShell`, no `StudioSheet` component.

### Success criteria

- Default skin, Nous, Midnight, light/dark/system: warm mat + paper sheet + pill buttons + `24 / 18 / 12 / 6` corners.
- Titlebar fills canvas; overlay reads `--canvas-base` / `--foreground` hex.
- Life Map keeps the studio frame; the year canvas fills the main pane (no `shell__content` padding).
- Welcome uses the same sheet metrics as `.shell`.
- Settings stays the in-shell split layout (`/settings`). Inner cards use `--radius-md` (18px). No second frame.
- `--accent` still aliases `--primary` (brand). `--muted` still aliases `--muted-foreground` (text).
- `npm test` and `npm run typecheck` in `@lifequest/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Scope | **Subset.** Canvas/sheet + concentric radii + pill buttons. Not the full Phase 1 reserved list. |
| 2 | Identity | Grounded life studio. Warm paper. Not BERD gray workbench. |
| 3 | Surface ladder | Two rungs: `--canvas-base` (mat) behind `--card` (sheet). |
| 4 | Canvas color | **Warm mat.** Deeper cream in the same paper family. Not cool gray. Not same-hex-as-card. |
| 5 | Where the ladder shows | Whole window: body / `.app-root` are canvas. |
| 6 | Page structure | **Page sheet + canvas frame.** Not floating cards. |
| 7 | Sheet membership | Titlebar flush on canvas. **Nav + main + chat** (existing `.shell`) are one paper sheet. |
| 8 | Frame size | Comfortable, **20px** (`--shell-frame`). Range that locked this was 16–24px. |
| 9 | Titlebar | Canvas fill. No hard bottom border. Overlay reads `--canvas-base` hex. |
| 10 | Radii | BERD concentric: `--radius-xs` 6, `--radius-sm` 12, `--radius` 12, `--radius-md` 18, `--radius-lg` 24, `--radius-pill` 999px. |
| 11 | Buttons | `.btn` → `border-radius: var(--radius-pill)`. Leftover `className="btn"` pills too. Variants, padding, terracotta primary stay. |
| 12 | Inputs vs buttons | Inputs/selects `--radius-sm` (12px), not pills. Chips `--radius-xs` (6px). |
| 13 | Implementation | **Restyle existing shell CSS.** No `StudioSheet`. No `PageShell`. No `max-w-5xl`. |
| 14 | `--background` | Stays **paper** (control fill, aliases `--bg`). Not the window backdrop. Paper matches the sheet so outline controls blend. |
| 15 | `--accent` / fonts / glass | **Unchanged.** No hover reclaim, no Inter/Geist, no `card-glass`, no dot-grid. |
| 16 | Map | Studio sheet and frame stay. `shell__content--bleed` on `/chart` only. |
| 17 | Welcome | `.welcome` is the sheet (same margin/radius/fill as `.shell`). Inner `.welcome-card` stays a content column, not a second card. |
| 18 | Settings | `/settings` stays inside `.shell` (split “overlay” layout, not a modal). `settings-card` uses `--radius-md` (18), not `--radius-lg`. |
| 19 | Authoring | CSS-native. Alias-first. Skins write semantic + extension names only. |

### Explicitly out of scope

- `PageShell` / `PageHeader`, `max-w-5xl` content column
- `card-glass`, `--backdrop-panel`, dot-grid, glass top bar / nav
- Inter / Geist Mono as default UI fonts
- Reclaiming `--accent` as hover fill
- Migrating leftover `className="btn"` off `.btn` (pills ride the shared class)
- Pill composer wrappers, Dialog rewrite, `GlassButton`
- New product features
- Phase 1 leftovers (MCP landmark, Button `to` rest forwarding, scanner depth, `packaging-config` test)

---

## 3. Architecture

Chosen: **paint the boxes we already have.** Rejected: new sheet component; split token-only pass; BERD glass/dot atmosphere.

```
.app-root                         → background: var(--canvas-base)
  WindowTitleBar                  → canvas fill; overlay --canvas-base
  .app-root__body
    .shell                        → paper sheet
      NavRail | main | ChatPanel
    .welcome                      → same sheet metrics
    /settings                     → inside .shell; not a second sheet
```

### 3.1 Token layers

Phase 1 layers stay. This phase adds one extension and retokens radii.

**`--canvas-base`** — Life Quest extension. Hex only. Window mat, titlebar fill, overlay color. Not a shadcn semantic. Not an alias of `--background`.

**Two rungs (default light):**

| Token | Hex | Job |
|---|---|---|
| `--canvas-base` | `#faf9f7` (today’s window paper) | Mat / titlebar |
| `--card` | `#fffefc` (today’s elevated) | Studio sheet |
| `--background` | `#fffefc` (same as `--card`) | Paper controls; aliases `--bg` |

Dark:

| Token | Hex | Job |
|---|---|---|
| `--canvas-base` | `#1a1917` (today’s dark window) | Mat / titlebar |
| `--card` / `--background` | `#2a2825` (today’s dark elevated) | Sheet + paper controls |

`--background` **changes meaning slightly**: it is no longer “the window.” It is paper on the sheet. `body` and `.app-root` must stop using `var(--bg)` as the window fill.

Do **not** mix canvas toward `--muted-surface` (`#eef1f5` is cool gray-blue). Warm mat only.

**Radii** in `tokens.css` (light and dark share them):

```css
--radius-xs: 6px;
--radius-sm: 12px;
--radius: 12px;
--radius-md: 18px;
--radius-lg: 24px;
--radius-pill: 999px;
--shell-frame: 20px;
```

Sheet uses `--radius-lg`. Inner settings cards `--radius-md`. Inputs `--radius-sm`. Chips `--radius-xs`. Buttons `--radius-pill`.

### 3.2 Skin write-path (`apply-skin.ts`)

`forgeVarsFromColors`:

- `--card` = elevated (`pickHex(c.card, c.popover, c.background)`) as today.
- `--background` = that same elevated hex (paper = sheet). **No longer** `c.background`.
- `--canvas-base` = `c.background` when it differs from elevated (case-insensitive). If they are equal, mix so the frame still reads:
  - light: `mix(c.background, c.foreground, 0.06)`
  - dark: `mix(c.background, "#000000", 0.15)`
- Still never inline `--bg`, `--accent`, `--muted`, or other alias names.
- `clearSkinVars` removes `--canvas-base`.

Tests that assert `--background === c.background` must expect elevated / `--card` instead, and assert `--canvas-base` is present and distinct from `--card`.

### 3.3 Shell CSS (no new component)

**`.app-root` / `body`** — `background: var(--canvas-base)`; `color: var(--foreground)`.

**Frame** — padding on `.app-root__body` (`var(--shell-frame)`), not margin on `.shell`. `.shell` is `height: 100%` today; extra margin would overflow. Welcome and Shell then share one frame. Boot `.centered-status` stays on the mat (no empty sheet).

**`.window-titlebar`** — `background: var(--canvas-base)`; drop the hard `border-bottom` (the mat *is* the gap). Caption still `--foreground`. `.window-titlebar__btn` stay square (radius 0).

**`.shell`** — the sheet:

- `background: var(--card)`
- `border-radius: var(--radius-lg)`
- `overflow: hidden`
- 1px `var(--border)` and `var(--shadow-sm)` so the sheet separates from the mat
- fills `.app-root__body`’s content box (inside the frame padding)

Nav, TopBar, `shell__content`, and ChatPanel stay children. They are not their own cards. Chat collapsed column stays inside the sheet.

**`.welcome`** — same radius, fill, border, shadow as `.shell`; no extra frame padding of its own. Keep inner centering and `.welcome-card` max-width; do not turn Welcome into a floating 28rem card on the mat.

**Life Map** — `AppShell` uses the route: when pathname is `/chart`, add `shell__content--bleed` (padding 0, overflow as the map needs). Do not remove the body frame. Do not paint Map onto the titlebar.

**Settings** — `/settings` stays inside `.shell`. Keep the split layout and `settings-page-shell` bleed that cancels `shell__content` padding. `settings-card` `border-radius: var(--radius-md)`.

**Shared chrome radii** in `global.css` (shell, nav, settings, welcome, `.btn`, `.field input`): replace hardcoded `0.4rem` / `0.5rem` / `0.65rem` / `0.75rem` on those surfaces with the scale. Feature islands (map cells, signal-chain) only if the radius is chrome, not a unique shape.

**`.btn`**

```css
border-radius: var(--radius-pill);
```

Padding, borders, primary/outline/ghost/danger colors stay. `Button` keeps applying `.btn*`.

### 3.4 Titlebar overlay

`ThemeProvider.syncTitleBarOverlay` reads `--canvas-base` and `--foreground`. Same `overlayColor` `#` / `rgb` guard. `getPropertyValue` on aliases still returns `var(...)` and must not be used.

`apps/desktop/tests/window-chrome.test.ts` expects `--canvas-base`.

### 3.5 Constitution

**`DESIGN.md`**

- Record canvas/sheet ladder, `--canvas-base`, radius scale, pill `.btn`.
- Flat First now *does* change elevation: canvas vs sheet is the ladder; do not add extra drop shadows beyond `--shadow-sm` on the sheet.
- Phase 2 do-not-do shrinks to: glass, dot-grid, Inter/Geist as default fonts, `--accent` reclaim, `PageShell`.

**`apps/desktop/src/components/ui/AGENTS.md`**

- Sheet is `.shell` / `.welcome` CSS, not a primitive. Feature files must not add a second frame.
- Buttons are pills via `.btn`. Do not override radius in features.
- Inputs are 12px, not pills.

No new laws. Token naming is not a law.

### 3.6 Enforcement

`design-system-tokens.mjs` / desktop tests:

- `apply-skin.ts` writes `--canvas-base` and `--background`.
- Still fails on forbidden alias inline keys.
- `tokens.css`: `--canvas-base` is hex; `--background` is paper hex (light `#fffefc`); radii match the table; `--accent: var(--primary)` still.
- `.btn` rule includes `var(--radius-pill)`.
- Overlay source includes `getPropertyValue("--canvas-base")`.
- No hex in `components/ui/*`.

Manual look lock: Welcome, Home, Settings overlay, Life Map, one skin switch (Nous), light/dark.

### 3.7 Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Full reserved Phase 2 list | User chose subset (B) |
| Cool gray mat / glass / dots | Atmosphere pass; fights warm paper |
| Floating cards | Turns Home into a widget scatter |
| Main-only sheet (nav on canvas) | Needs a second rail surface; closer to BERD panes |
| Inset titlebar | Fights Electron drag and overlay |
| `StudioSheet` React wrapper | Extra abstraction; easy to grow into `PageShell` |
| Token-only first pass | Ladder would not show; this phase is visual |
| Mix canvas toward `--muted-surface` | Cool gray-blue, not warm |
| Keep `--background` as window fill | Outline controls would be mat-colored holes on the sheet |
| `max-w-5xl` PageShell | Ruled out in Phase 1; sheet stays full-bleed inside the frame |

---

## 4. Error handling and edge cases

- Overlay: if `--canvas-base` is missing or not `#`/`rgb`, skip `setTitleBarOverlay` (same as today).
- Skin with `background === card`: mix fallback so the frame does not vanish.
- `clearSkinVars` must drop `--canvas-base` so default `tokens.css` restores the mat.
- Hash route `/chart` only for Map bleed — not `/dream` or `/track`.
- Welcome is outside `AppShell`; it still gets the frame via `.app-root__body` padding plus `.welcome` sheet paint.

---

## 5. Open questions

None. Scope (subset), package (depth + corners + pills), whole-window canvas, page sheet, warm mat, concentric radii, 20px frame, nav+main+chat as one sheet, titlebar-on-canvas, and restyle-existing-shell were approved in design review.
