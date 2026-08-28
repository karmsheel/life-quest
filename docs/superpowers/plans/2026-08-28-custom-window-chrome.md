# Custom Window Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the OS title bar and File/Edit/View menu; replace them with a thin in-app titlebar (`LifeQuest` / `LifeQuest — {vault name}`) while keeping native Windows min/max/close (Snap Layouts included). Existing TopBar stays.

**Architecture:** Electron `titleBarStyle: "hidden"` + `titleBarOverlay` (32px). A root `WindowTitleBar` sits above Welcome and the shell. Overlay colors follow `--bg` / `--text` over IPC. Windows/Linux menu bar is removed (not Alt-to-reveal); shortcuts are handled in main. HTML min/max/close only if overlay is unavailable and the platform is not macOS.

**Tech Stack:** Electron 35, existing Vite + React renderer, `node:test` source/helper tests. No titlebar library.

**Spec:** `docs/superpowers/specs/2026-08-28-custom-window-chrome-design.md`

## Global Constraints

- Do **not** set `frame: false`
- Overlay height **32px**, matching `--window-titlebar-height`
- Titlebar label: `LifeQuest` with no vault; `LifeQuest — {name}` when a vault is open
- Existing TopBar (vault name + domain switcher) **unchanged**
- Titlebar is full-window width, above nav / main / chat
- Windows/Linux: no menu bar, no Alt-to-reveal
- Keep shortcuts: Ctrl+R reload, Ctrl+Shift+I and F12 DevTools (including packaged), F11 fullscreen, Ctrl+Q quit
- Copy/paste/select-all stay Chromium-native
- macOS: keep the system app menu and traffic lights; same in-app titlebar
- Overlay default colors: `#1a1917` / `#e8e4dc` (dark-theme `--bg` / `--text`)
- HTML window controls are fallback only (`!darwin && !overlay`)
- No setting to restore OS chrome
- No merge of TopBar into the titlebar
- No in-titlebar File menu
- Tests: `node --experimental-strip-types --test` in `apps/desktop/tests/`

---

## Current vs after

Today `BrowserWindow` uses the default native frame and Electron’s default application menu. The renderer already has `TopBar`. After:

```
┌──────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal          (drag)     │ [_] □ X  │  32px overlay
├──────┬───────────────────────────────────┼──────────┤
│ Nav  │ TopBar (vault + domain)           │  Chat    │
│      │ page content                      │          │
└──────┴───────────────────────────────────┴──────────┘
```

Net space recovered: the File/Edit/View menu (~22–30px). OS title bar height is reused by our 32px strip.

---

## File map

| File | Role |
|------|------|
| `apps/desktop/electron/main.ts` | hidden title bar, overlay, remove menu, accelerators, window IPC |
| `apps/desktop/electron/preload.ts` | expose `windowChrome` on `window.lifequest` |
| `apps/desktop/src/vite-env.d.ts` | types for the new IPC |
| `apps/desktop/src/lib/ipc.ts` | unchanged helper; types flow from vite-env |
| `apps/desktop/src/components/shell/window-title.ts` | `windowTitleLabel()` pure helper |
| `apps/desktop/src/components/shell/WindowTitleBar.tsx` | titlebar UI, drag region, fallback controls |
| `apps/desktop/src/App.tsx` | wrap routes with titlebar + `app-root` |
| `apps/desktop/src/components/theme/ThemeProvider.tsx` | push overlay colors after skin/theme apply |
| `apps/desktop/src/styles/tokens.css` | `--window-titlebar-height: 32px` |
| `apps/desktop/src/styles/global.css` | titlebar + `app-root`; shell/nav/welcome `100vh` → fill remainder |
| `apps/desktop/tests/window-title.test.ts` | label helper |
| `apps/desktop/tests/window-chrome.test.ts` | source asserts on main/preload/App |
| `docs/superpowers/specs/2026-08-28-custom-window-chrome-design.md` | spec from this design |

---

## IPC surface

Add to the existing `window.lifequest` object (do not create a second preload bridge):

```ts
windowChrome: {
  get: () => Promise<{ overlay: boolean; platform: NodeJS.Platform }>;
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => Promise<void>;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
};
```

Main handlers (all operate on `BrowserWindow.fromWebContents(event.sender)`):

- `window:getChrome` → `{ overlay, platform }` where `overlay` is true iff this window was created with `titleBarOverlay`
- `window:setTitleBarOverlay` → `win.setTitleBarOverlay({ color, symbolColor, height: 32 })`; swallow errors
- `window:minimize` / `window:close` / `window:toggleMaximize` / `window:isMaximized`
- `win.on("maximize"|"unmaximize")` → `webContents.send("window:maximizeChanged", win.isMaximized())`

---

### Task 1: Spec + title label helper

**Files:**
- Create: `docs/superpowers/specs/2026-08-28-custom-window-chrome-design.md`
- Create: `apps/desktop/src/components/shell/window-title.ts`
- Create: `apps/desktop/tests/window-title.test.ts`

**Produces:** `windowTitleLabel(vaultName?: string | null): string`

- [ ] Write the spec from the locked decisions in this plan (purpose, chrome, layout, IPC, accelerators, fallback, testing, out of scope, key decisions).
- [ ] Write failing tests:

```ts
assert.equal(windowTitleLabel(null), "LifeQuest");
assert.equal(windowTitleLabel(undefined), "LifeQuest");
assert.equal(windowTitleLabel(""), "LifeQuest");
assert.equal(windowTitleLabel("   "), "LifeQuest");
assert.equal(windowTitleLabel("Personal"), "LifeQuest — Personal");
```

- [ ] Implement:

```ts
export function windowTitleLabel(vaultName?: string | null): string {
  const name = vaultName?.trim();
  return name ? `LifeQuest — ${name}` : "LifeQuest";
}
```

- [ ] Run: `npm test -w @lifequest/desktop` — label tests pass.
- [ ] Commit spec + helper + tests.

---

### Task 2: Main-process chrome (frame, overlay, menu, accelerators, IPC)

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Create: `apps/desktop/tests/window-chrome.test.ts`

**Window options** (keep `webPreferences` as they are):

```ts
const TITLEBAR_OVERLAY_HEIGHT = 32;
const DEFAULT_OVERLAY_COLOR = "#1a1917";
const DEFAULT_OVERLAY_SYMBOL = "#e8e4dc";

const useOverlay =
  process.platform === "win32" || process.platform === "linux";

const win = new BrowserWindow({
  width: 1280,
  height: 800,
  titleBarStyle: "hidden",
  ...(useOverlay
    ? {
        titleBarOverlay: {
          color: DEFAULT_OVERLAY_COLOR,
          symbolColor: DEFAULT_OVERLAY_SYMBOL,
          height: TITLEBAR_OVERLAY_HEIGHT,
        },
      }
    : {}),
  webPreferences: { /* existing */ },
});
```

Do not set `frame: false`.

After create, if `process.platform !== "darwin"`, call `win.removeMenu()`.

Accelerators on `win.webContents` `before-input-event` (keydown only):

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+R (no Shift/Alt) | `win.reload()` |
| Ctrl/Cmd+Shift+I | `toggleDevTools()` |
| F12 | `toggleDevTools()` |
| F11 | toggle fullscreen |
| Ctrl/Cmd+Q (no Shift/Alt) | `app.quit()` |

Do not register zoom shortcuts. Do not use `globalShortcut` (would fire without focus).

Track `overlay: useOverlay` per window for `window:getChrome`.

- [ ] Write `tests/window-chrome.test.ts` that reads `electron/main.ts` and `electron/preload.ts` and asserts:
  - `titleBarStyle: "hidden"` (or `'hidden'`)
  - `titleBarOverlay`
  - `height: 32` / `TITLEBAR_OVERLAY_HEIGHT = 32`
  - `removeMenu`
  - `before-input-event`
  - `window:setTitleBarOverlay`
  - preload exposes `windowChrome`
  - file does **not** contain `frame: false`
- [ ] Run tests — fail on current main.ts.
- [ ] Implement main + preload + `LifequestApi.windowChrome` types.
- [ ] Run tests — pass. `npm run typecheck -w @lifequest/desktop` passes.
- [ ] Commit.

---

### Task 3: Renderer titlebar + layout

**Files:**
- Create: `apps/desktop/src/components/shell/WindowTitleBar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/tokens.css`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/window-chrome.test.ts` (assert App.tsx mounts `WindowTitleBar`)

**App.tsx structure:**

```tsx
<HashRouter>
  <ThemeProvider>
    <VaultProvider>
      <div className="app-root">
        <WindowTitleBar />
        <div className="app-root__body">
          <AppRoutes />
        </div>
      </div>
    </VaultProvider>
  </ThemeProvider>
</HashRouter>
```

**WindowTitleBar:**

- `useVault()` for `snapshot?.lifequest.name`
- `label = windowTitleLabel(...)`
- `useEffect` → `document.title = label`
- Entire header: `-webkit-app-region: drag`, `user-select: none`
- Fallback controls (minimize / maximize / close) only when `windowChrome.get()` returns `{ overlay: false, platform !== "darwin" }`. Those buttons are `no-drag`. Maximize icon swaps on `onMaximizeChange`.
- No other controls. Domain switcher stays on TopBar.

**CSS:**

- `--window-titlebar-height: 32px`
- `.app-root`: flex column, `height: 100%`
- `.app-root__body`: `flex: 1; min-height: 0;` children `height: 100%`
- `.window-titlebar`: height `env(titlebar-area-height, var(--window-titlebar-height))`; label boxed to `env(titlebar-area-width, 100%)` and offset `env(titlebar-area-x, 0px)` so text never sits under caption buttons or traffic lights
- `.shell`: `height: 100%` (drop `min-height: 100vh`)
- `.nav-rail`: `height: 100%` (drop `height: 100vh`)
- `.welcome` and `.centered-status`: `min-height: 100%` instead of `100vh`

Leave `.top-bar` rules unchanged.

- [ ] Extend window-chrome tests to require `WindowTitleBar` in `App.tsx` and `app-root` in `global.css`.
- [ ] Implement component + layout CSS.
- [ ] `npm test -w @lifequest/desktop` and typecheck pass.
- [ ] Commit.

---

### Task 4: Theme-sync overlay colors

**Files:**
- Modify: `apps/desktop/src/components/theme/ThemeProvider.tsx`

After `applyThemePreference` / `applyCurrentSkin` (existing `useLayoutEffect`s), read:

```ts
const styles = getComputedStyle(document.documentElement);
const color = styles.getPropertyValue("--bg").trim();
const symbolColor = styles.getPropertyValue("--text").trim();
```

If both look like `#hex` or `rgb(...)`, call `api().windowChrome.setTitleBarOverlay({ color, symbolColor })`. Ignore missing `window.lifequest` (shouldn't happen in Electron) and rejected IPC.

Also run once on mount so the first paint after boot replaces the dark defaults when the user is on light theme.

- [ ] Implement. Typecheck passes.
- [ ] Commit.

---

### Task 5: Verify in the running app

There is no Electron E2E harness. Verification is the running desktop window.

- [ ] `npm run dev -w @lifequest/desktop`
- [ ] Welcome: no File/Edit/View, no OS title bar, thin bar says `LifeQuest`, window drags from the bar, native min/max/close work, Snap Layouts on maximize hover (Windows).
- [ ] Open a vault: label becomes `LifeQuest — {name}`; in-app TopBar still shows vault name + domain switcher.
- [ ] Light/dark and skin change: caption button colors follow `--bg` / `--text`.
- [ ] Ctrl+R reloads; F12 opens DevTools; window still resizes from edges.
- [ ] Chat panel and nav sit **below** the titlebar; close button does not cover chat UI.
- [ ] If anything fails, fix and re-verify before claiming done.

---

## Testing (summary)

| Test | What it locks |
|------|----------------|
| `tests/window-title.test.ts` | label helper |
| `tests/window-chrome.test.ts` | hidden title bar, overlay 32px, no `frame: false`, removeMenu, accelerators, IPC names, App mounts titlebar |
| typecheck | preload/renderer API match |
| manual `npm run dev` | real window chrome, drag, overlay, theme, layout |

---

## Out of scope

- Merging TopBar into the window titlebar
- Custom caption buttons as the primary path
- In-titlebar app menu (Open/Create vault, etc.)
- Settings toggle to restore OS chrome
- Zoom menu roles
- New Playwright/Spectron E2E stack
- macOS pixel-perfect inset beyond `env(titlebar-area-*)`
