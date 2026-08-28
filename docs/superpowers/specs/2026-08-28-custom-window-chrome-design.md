# Custom Window Chrome — Design Spec

**Date:** 2026-08-28  
**Status:** Approved — implementation plan at `docs/superpowers/plans/2026-08-28-custom-window-chrome.md`  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Local vault (Electron) design](./2026-07-19-local-vault-electron-design.md)

---

## 1. Purpose

LifeQuest currently stacks three bars of chrome: the Windows title bar, Electron’s default File / Edit / View menu, and the in-app TopBar (vault name + domain switcher). That wastes vertical space and looks like a stock Electron shell rather than a product.

This spec replaces the OS title bar and application menu with a thin in-app titlebar, while keeping native Windows caption buttons (including Snap Layouts). The existing TopBar stays.

### Success criteria

- No File / Edit / View menu bar on Windows or Linux (including no Alt-to-reveal).
- No native OS title-bar caption strip; the window still has a native frame (resize, shadow, snap).
- A 32px in-app titlebar at the top of every screen (Welcome, loading, vault shell) shows `LifeQuest` or `LifeQuest — {vault name}`.
- Native min / max / close remain (Windows overlay). The window is draggable from the in-app titlebar.
- In-app TopBar (vault name + domain switcher) is unchanged.
- Nav rail and chat sit below the titlebar; caption buttons do not cover chat UI.
- Overlay caption colors follow `--bg` / `--text` when theme or skin changes.
- Ctrl+R, Ctrl+Shift+I, F12, F11, and Ctrl+Q still work. Copy / paste still work.
- `npm test` and `npm run typecheck` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Layout | **Thin full-width titlebar above** the existing TopBar. Do not merge them. |
| 2 | Caption buttons | **Native Windows overlay** (`titleBarOverlay`). Not HTML buttons as the primary path. |
| 3 | Titlebar label | `LifeQuest` with no vault; `LifeQuest — {vault name}` when a vault is open |
| 4 | Overlay height | **32px**, same as `--window-titlebar-height` |
| 5 | Native frame | Keep the frame. **Do not** set `frame: false` |
| 6 | Title bar style | `titleBarStyle: "hidden"` |
| 7 | Menu (Windows/Linux) | **Removed** (`removeMenu`). Not auto-hide / Alt-to-reveal |
| 8 | Menu (macOS) | Keep the system app menu and traffic lights |
| 9 | Overlay platforms | Windows and Linux create the window with `titleBarOverlay`. macOS does not |
| 10 | Overlay default colors | `#1a1917` background, `#e8e4dc` symbols (dark-theme `--bg` / `--text`) |
| 11 | Theme sync | Renderer reads computed `--bg` and `--text` and calls `setTitleBarOverlay` |
| 12 | Drag | Entire in-app titlebar is `-webkit-app-region: drag` |
| 13 | Fallback controls | HTML min / max / close only when overlay is unavailable **and** platform is not macOS |
| 14 | Accelerators | Ctrl/Cmd+R reload; Ctrl/Cmd+Shift+I and F12 DevTools (including packaged); F11 fullscreen; Ctrl/Cmd+Q quit |
| 15 | Zoom shortcuts | **Not** re-implemented |
| 16 | TopBar | Unchanged (vault name + domain switcher stay) |
| 17 | Titlebar scope | App root — Welcome, loading, and shell |
| 18 | Restore-OS-chrome setting | **Not included** |
| 19 | In-titlebar app menu | **Not included** |
| 20 | `document.title` | Matches the titlebar label |

### Explicitly out of scope

- Merging TopBar into the window titlebar
- Custom caption buttons as the primary path
- An in-titlebar File menu (Open / Create vault, etc.)
- A Settings toggle to restore OS chrome
- Zoom menu roles
- A new Electron E2E harness
- macOS pixel-perfect traffic-light inset beyond `env(titlebar-area-*)`

---

## 3. Architecture

```
┌──────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal          (drag)     │ [_] □ X  │  32px overlay
├──────┬───────────────────────────────────┼──────────┤
│ Nav  │ TopBar (vault + domain)           │  Chat    │
│      │ page content                      │          │
└──────┴───────────────────────────────────┴──────────┘
```

Net space recovered: the application menu (~22–30px). OS title-bar height is reused by the 32px strip.

### 3.1 Main process

`BrowserWindow` is created with `titleBarStyle: "hidden"` and, on Windows/Linux, `titleBarOverlay: { color, symbolColor, height: 32 }`. The native frame stays.

On Windows/Linux, `win.removeMenu()` after create. Keyboard shortcuts that used to live on View / Window are handled on `webContents` `before-input-event` (keydown only). `globalShortcut` is not used.

### 3.2 Renderer

`App` wraps routes:

```
.app-root (column, height 100%)
  WindowTitleBar
  .app-root__body (flex 1, min-height 0)
    Welcome | loading | AppShell
```

`WindowTitleBar` uses `windowTitleLabel(vaultName)` and Electron CSS env vars (`titlebar-area-x/width/height`) so text never sits under caption buttons or traffic lights.

Shell, nav rail, Welcome, and loading screens fill the remaining height (`100%`, not `100vh`).

### 3.3 IPC

Added on the existing `window.lifequest` bridge (no second preload object):

```ts
windowChrome: {
  get: () => Promise<{ overlay: boolean; platform: NodeJS.Platform }>;
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => Promise<void>;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
}
```

`overlay` is true iff that window was created with `titleBarOverlay`. Overlay color updates swallow errors. Window control methods target `BrowserWindow.fromWebContents(event.sender)`.

### 3.4 Theme

`ThemeProvider` already applies skins in `useLayoutEffect`. After apply, it reads computed `--bg` and `--text` from `document.documentElement` and, when the values look like `#hex` or `rgb(...)`, calls `windowChrome.setTitleBarOverlay`. First mount covers light-theme users who would otherwise keep the dark overlay defaults.

---

## 4. Components

### 4.1 `windowTitleLabel(vaultName?: string | null): string`

Pure helper. Trim; empty / null / undefined → `LifeQuest`; otherwise `LifeQuest — {name}`.

### 4.2 `WindowTitleBar`

- Always mounted at the app root.
- Sets `document.title` to the same label.
- Drag region; no product controls.
- Fallback HTML window buttons only for `!overlay && platform !== "darwin"`. Those buttons are `no-drag`.

### 4.3 Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Merge TopBar into window chrome | User chose a dedicated thin titlebar |
| `frame: false` + HTML caption buttons | User chose native Windows buttons / Snap Layouts |
| `autoHideMenuBar` only | Not “our own titlebar”; least space saved |
| In-titlebar app menu | YAGNI; File menu was never wired to vault commands |

---

## 5. Error handling

- `setTitleBarOverlay` failures are swallowed; the in-app titlebar still renders.
- If overlay is unavailable on Windows/Linux, HTML min / max / close appear so the window remains closable.
- Missing `window.lifequest` (should not happen in Electron) is ignored by theme sync.
- Accelerator handling is keydown-only so key-repeat / keyup do not double-fire.

---

## 6. Testing

No new E2E framework. Verification is unit/source tests plus a running `npm run dev` window.

| Check | Pass |
|-------|------|
| `windowTitleLabel` | null / empty / whitespace → `LifeQuest`; `"Personal"` → `LifeQuest — Personal` |
| Source tests on `main.ts` | `titleBarStyle: "hidden"`, overlay height 32, `removeMenu`, no `frame: false`, accelerators, overlay IPC |
| Preload / App | `windowChrome` exposed; `WindowTitleBar` mounted |
| `npm test` / typecheck | Pass |
| Welcome in `npm run dev` | No menu, no OS title bar, `LifeQuest`, drag, native caption buttons |
| Open vault | Label becomes `LifeQuest — {name}`; TopBar still shows vault + domain |
| Theme / skin change | Overlay caption colors follow `--bg` / `--text` |
| Shortcuts | Ctrl+R reloads; F12 opens DevTools; edges still resize |
| Layout | Nav and chat sit below the titlebar; close does not cover chat |

---

## 7. Key Decisions

| Decision | Rationale |
|----------|-----------|
| `titleBarStyle: "hidden"` + `titleBarOverlay`, not `frame: false` | Native caption buttons and Snap Layouts without a second OS title strip |
| Thin titlebar **plus** existing TopBar | User preference: conventional chrome, vault/domain controls stay where they are |
| Remove the menu rather than auto-hide | User asked to hide File / Edit / View, not tuck it behind Alt |
| Overlay colors from CSS variables | Caption buttons must track theme and skin without a new settings field |
| HTML controls as fallback only | Window must stay closable if overlay is missing; macOS already has traffic lights |
| Keep DevTools shortcuts in packaged builds | Dogfood; the default View menu used to expose them |

---

## 8. Spec self-review checklist

| Check | Result |
|-------|--------|
| Placeholders | None |
| Internal consistency | Overlay 32px, keep TopBar, remove menu, native buttons, fallback only off-overlay non-macOS all agree |
| Scope | Window chrome only; no vault/IA/product changes |
| Ambiguity | Label format, IPC names, accelerators, and `frame: false` prohibition are explicit |
