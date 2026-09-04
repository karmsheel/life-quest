# Startup splash — Design Spec

**Date:** 2026-09-04  
**Status:** Draft — review before implementation plan  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron)](./2026-07-19-local-vault-electron-design.md), [BERD Visuals Phase 2](./2026-09-03-berd-visuals-phase-2-design.md), [Three-pane studio](./2026-09-04-three-pane-studio-design.md)

Cold start today is a muted “Loading…” after React mounts, and a blank canvas before that. This spec adds a branded splash: large block **LIFE QUEST** and a quiet loading bar, then fades into Welcome, the studio, or companion setup when that screen needs an action.

---

## 1. Purpose

The first thing you see when LifeQuest opens should be the name, not an empty window or “Loading…”. The splash is cold-start only. It must not cover companion install/error UI.

### Success criteria

- From window open, **LIFE QUEST** is on canvas in extra-bold block letters, one line, wide tracking.
- Letters stagger in; a thin `--primary` bar under the title pulses until dismiss.
- Splash holds until vault is not booting, companion is `ready` (or needs an action), **and** at least **800ms** have elapsed since first splash paint.
- Fade out (~200ms), no hard cut.
- `CompanionSetupScreen` still appears for `needs_install` and other blocking kinds.
- Titlebar is visible once React mounts. No new fonts, spinner, or second BrowserWindow.
- `npm test` and `npm run typecheck` in `@lifequest/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | When | **Cold start only.** Not every in-app wait. |
| 2 | Duration | Until ready **plus 800ms floor** from first splash paint. Then fade. |
| 3 | Copy | **LIFE QUEST** — two words, one line, extra-bold, wide tracking. |
| 4 | Motion | Letters stagger fade-in (~40ms per glyph). Then bar opacity pulse (~1.2s ease-in-out infinite). |
| 5 | Bar | Thin `--primary` underline (~8rem × 2px), centered under the title. |
| 6 | Surfaces | Canvas (`--canvas-base`). Ink `--foreground`. Bar `--primary`. |
| 7 | Implementation | **HTML first paint + React gate.** Splash is a sibling of `#root`. |
| 8 | Companion | Hold splash while `ensuring` / no status. **Dismiss immediately** (after fade) when status is a blocking kind (`needs_install`, `profile_error`, `port_busy`, `gateway_exited`, `hermes_too_old`, `auth_error`, `disconnected`). |
| 9 | Titlebar | Stays; splash does not cover `WindowTitleBar` after React mounts. |
| 10 | Fonts | No Inter/Geist. System / `--font-sans`, weight 800. |
| 11 | Out of scope | Native splash window, logo mark, sound, skip button, per-route loaders. |

---

## 3. Architecture

Chosen: **sibling `#splash` + React `SplashGate`.** Rejected: React-only (blank until JS); native second window.

```
body
  #splash.splash          HTML first paint; React adds splash--out
  #root
    ThemeProvider …
      .app-root
        WindowTitleBar
        .app-root__body     routes or CompanionSetupScreen
```

`index.html` sets `window.__LQ_SPLASH_T0 = performance.now()` when the splash node exists.

React `createRoot(#root)` must **not** unmount `#splash`.

### 3.1 Hold / dismiss

Let `t0 = window.__LQ_SPLASH_T0`.

**Hold** if any of:

- `Date.now`/`performance.now() - t0 < 800`
- companion `ensuring` or `status` is null
- companion `status.kind === "ready"` **and** vault `booting`

**Dismiss** (add `splash--out`, then hide after 200ms) if:

- companion `status.kind` is set and not `"ready"` and not ensuring, **or**
- companion is `ready` and vault is not `booting` and elapsed ≥ 800ms

Replace both `centered-status` “Loading…” branches in `App.tsx` (`AppRoutes` and `RequireVault`). While the splash is up, those branches render `null` (splash is outside `#root`). After dismiss, normal routes run.

`RequireVault` must not show “Loading…”; splash already covered boot.

### 3.2 Markup and CSS

`public/splash.css` (linked from `index.html`, works before the Vite bundle):

- `.splash` — fixed, inset below `var(--window-titlebar-height, 32px)` once the app chrome exists; until then full viewport is acceptable for first paint. Background `var(--canvas-base, #faf9f7)`. `[data-theme="dark"]` fallback `#1a1917`.
- `.splash__title` — `font-weight: 800`; large clamp (e.g. `clamp(2.5rem, 8vw, 4.5rem)`); `letter-spacing: 0.12em`; uppercase is already the copy.
- `.splash__letter` — inline-block; animation `splash-letter` 320ms ease-out forwards; delay `calc(var(--i, 0) * 40ms)`. Space glyph still a span (nbsp or min-width).
- `.splash__bar` — height 2px, width 8rem, `background: var(--primary, #c96442)`; animation `splash-bar` 1.2s ease-in-out infinite; delay after last letter (~400ms).
- `.splash--out` — opacity 0, 200ms; then `hidden` attribute or `.splash--done { visibility: hidden; pointer-events: none }`.

No hex in `components/ui`. Fallbacks in `splash.css` are allowed (loads before `tokens.css`).

### 3.3 React

`apps/desktop/src/components/shell/SplashGate.tsx`:

- On mount, if `#splash` exists, do not recreate letters.
- Subscribes to vault `booting` and companion `status` / `ensuring`.
- Applies dismiss class on `#splash` per 3.1.
- Renders `null`.

`App.tsx` mounts `<SplashGate />` next to providers (inside them so it can read context), still not inside `#splash`.

### 3.4 Tests

- `index.html` contains `id="splash"`, `LIFE QUEST`, `__LQ_SPLASH_T0`.
- `App.tsx` does not contain the vault-boot `Loading…` copy; contains `SplashGate`.
- Companion setup test still requires `CompanionSetupScreen` and `needs_install`.
- Helper `shouldHoldSplash({ elapsedMs, booting, ensuring, kind })` unit-tested: hold at 0ms even if ready; hold while booting; hold while ensuring; release when ready + 800ms; release immediately on `needs_install`.

### 3.5 Rejected alternatives

| Alternative | Why rejected |
|---|---|
| React-only splash | Misses the blank-window gap |
| Native BrowserWindow | Second window, theme desync |
| Splash over companion errors | Hides install/recheck |
| Fixed 2s duration | Traps a slow boot twice |
| New display font | Phase 2 remaining do-not-do |

---

## 4. Edge cases

- Missing `#splash` (tests / odd loads): `SplashGate` no-ops; app still boots.
- StrictMode double mount: `t0` is on `window`, not React state.
- Reduced motion: if `prefers-reduced-motion: reduce`, skip stagger/pulse; show title + bar at full opacity; still honor 800ms floor and fade.

---

## 5. Open questions

None. Cold start, 800ms floor, letter stagger + bar pulse, HTML sibling + React gate were approved in design review.
