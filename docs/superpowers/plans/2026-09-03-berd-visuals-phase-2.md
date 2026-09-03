# BERD Visuals Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle LifeQuest onto a warm canvas/sheet ladder, concentric 6/12/18/24 radii, and pill buttons, using the existing shell DOM.

**Architecture:** Paint boxes that already exist. `--canvas-base` is the mat; `--card` is the studio sheet; `--background` matches the sheet so outline controls blend. `.app-root__body` padding is the 20px frame. `.shell` and `.welcome` are the sheet. `.btn` becomes `var(--radius-pill)`. No new layout component.

**Tech Stack:** Electron + Vite + React 19, CSS custom properties, `node:test` + `--experimental-strip-types`. No Tailwind, CVA, Radix, or new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md`

## Global Constraints

- Do **not** add Tailwind, CVA, shadcn, Radix Slot, or an in-app design explorer
- Do **not** add `PageShell`, `PageHeader`, `StudioSheet`, or `max-w-5xl`
- Do **not** add `card-glass`, `--backdrop-panel`, dot-grid, or glass top bar / nav
- Do **not** change default UI fonts to Inter / Geist Mono
- Do **not** reclaim `--accent` as hover; `--accent` aliases `--primary`
- Do **not** make `--muted` a surface; `--muted` aliases `--muted-foreground`
- Do **not** mix `--canvas-base` toward `--muted-surface` (cool gray-blue)
- Do **not** inset the titlebar; it stays flush and paints `--canvas-base`
- Do **not** migrate leftover `className="btn"` off `.btn` (pills ride the shared class)
- Do **not** invent a filled red button
- ThemeProvider must not synthesize a palette from one primary hex
- Titlebar overlay must read `--canvas-base` / `--foreground` (hex), never `var()` aliases
- Desktop tests: `node --experimental-strip-types --test` under `apps/desktop/tests/`
- Commit only files from the current task; leave unrelated dirty files unstaged
- Work in a git worktree; do not implement on `master`

---

## File Structure

```
apps/desktop/
  src/styles/tokens.css                      # --canvas-base, paper --background, radii, --shell-frame
  src/lib/themes/apply-skin.ts               # write --canvas-base; --background = elevated
  src/components/theme/ThemeProvider.tsx     # overlay reads --canvas-base
  src/styles/global.css                      # body/app-root canvas; body frame; sheet; pills
  src/components/shell/AppShell.tsx          # shell__content--bleed on /chart
  src/components/ui/AGENTS.md                # sheet is CSS; buttons are pills
  scripts/design-system-tokens.mjs           # require --canvas-base write
  tests/tokens.test.ts
  tests/apply-skin.test.ts
  tests/window-chrome.test.ts
  tests/shell-visuals.test.ts                # NEW CSS contract for frame/sheet/pills
  tests/constitution.test.ts
  tests/design-system-tokens.test.ts         # already runs the scanner

DESIGN.md
README.md
docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md  # status → Approved
```

No vault-core, Electron main, new React primitives, or font/loader changes.

---

### Task 1: Canvas token, paper `--background`, concentric radii

**Files:**
- Modify: `apps/desktop/tests/tokens.test.ts`
- Modify: `apps/desktop/src/styles/tokens.css`

**Interfaces:**
- Consumes: Phase 1 semantic tokens and aliases
- Produces: `--canvas-base` hex extension; `--background` paper hex matching `--card`; `--radius-xs: 6px`, `--radius-sm: 12px`, `--radius: 12px`, `--radius-md: 18px`, `--radius-lg: 24px`, `--radius-pill: 999px`; `--shell-frame: 20px`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/tokens.test.ts`, change the light hex assertion for `--background` and add canvas / radius / frame coverage. Replace the existing `"defines semantic tokens with the current light hex values"` body and add two tests:

```ts
  it("defines semantic tokens with the current light hex values", () => {
    const css = readTokens();
    assert.match(css, /--canvas-base:\s*#faf9f7/);
    assert.match(css, /--background:\s*#fffefc/);
    assert.match(css, /--foreground:\s*#1a1916/);
    assert.match(css, /--card:\s*#fffefc/);
    assert.match(css, /--muted-surface:\s*#eef1f5/);
    assert.match(css, /--muted-foreground:\s*#74716b/);
    assert.match(css, /--primary:\s*#c96442/);
    assert.match(css, /--primary-foreground:\s*#ffffff/);
    assert.match(css, /--destructive:\s*#9c2a25/);
    assert.match(css, /--input:\s*#c9d0da/);
    assert.match(css, /--ring:\s*#2563eb/);
    assert.match(css, /--accent-fill:\s*rgba\(37,\s*99,\s*235,\s*0\.16\)/);
    assert.match(css, /--primary-hover:\s*#b45a3b/);
  });

  it("keeps dark paper values on semantic tokens", () => {
    const css = readTokens();
    assert.match(css, /\[data-theme="dark"\][\s\S]*--canvas-base:\s*#1a1917/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--background:\s*#2a2825/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--card:\s*#2a2825/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--primary:\s*#d97a56/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--foreground:\s*#e8e4dc/);
  });

  it("defines concentric radii and the shell frame", () => {
    const css = readTokens();
    assert.match(css, /--radius-xs:\s*6px/);
    assert.match(css, /--radius-sm:\s*12px/);
    assert.match(css, /--radius:\s*12px/);
    assert.match(css, /--radius-md:\s*18px/);
    assert.match(css, /--radius-lg:\s*24px/);
    assert.match(css, /--radius-pill:\s*999px/);
    assert.match(css, /--shell-frame:\s*20px/);
  });

  it("does not alias --canvas-base through --background", () => {
    const css = readTokens();
    assert.equal(/--canvas-base:\s*var\(/.test(css), false);
    assert.match(css, /--bg:\s*var\(--background\)/);
    assert.match(css, /--accent:\s*var\(--primary\)/);
  });
```

Keep the existing `"aliases legacy names instead of storing a second hex vocabulary"` test unchanged.

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: FAIL — `--background` is still `#faf9f7`, no `--canvas-base`, radii still `4px`/`8px`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/styles/tokens.css` `:root`:

1. After `--window-titlebar-height: 32px;` add `--shell-frame: 20px;`
2. Change `--background: #faf9f7;` to:

```css
  --canvas-base: #faf9f7;
  --background: #fffefc;
```

3. Replace the radius block:

```css
  --radius-xs: 6px;
  --radius-sm: 12px;
  --radius: 12px;
  --radius-md: 18px;
  --radius-lg: 24px;
  --radius-pill: 999px;
```

In `[data-theme="dark"]` and in `@media (prefers-color-scheme: dark) html:not([data-theme])`, insert `--canvas-base: #1a1917;` immediately before `--background`, and change `--background` to `#2a2825` (same as `--card`). Do not copy radii into the dark blocks.

Do not add `--canvas-base` as an alias of `--background`. Do not change `--accent` / `--muted` aliases.

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/tokens.test.ts apps/desktop/src/styles/tokens.css
git commit -m "feat(desktop): add canvas-base token and concentric radii"
```

---

### Task 2: Skin writer emits `--canvas-base`; paper `--background`

**Files:**
- Modify: `apps/desktop/tests/apply-skin.test.ts`
- Modify: `apps/desktop/src/lib/themes/apply-skin.ts`
- Modify: `apps/desktop/scripts/design-system-tokens.mjs`

**Interfaces:**
- Consumes: `forgeVarsFromColors(c: SkinColors): ForgeSkinVars`; `mix(a, b, amount)`; `isDarkBackground(hex)`
- Produces: `--card` = elevated (unchanged); `--background` = elevated; `--canvas-base` = `c.background` when it differs from elevated (case-insensitive), else `mix(c.background, c.foreground, 0.06)` in light or `mix(c.background, "#000000", 0.15)` in dark; `clearSkinVars` removes `--canvas-base`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/apply-skin.test.ts`, change the existing write assertion (`--background` is no longer `c.background`) and add canvas coverage. Import `mix` from `../src/lib/themes/color.ts`.

Replace the body of `"writes semantic tokens from SkinColors fields"`:

```ts
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--card"], "#222222");
    assert.equal(vars["--background"], "#222222");
    assert.equal(vars["--canvas-base"], "#111111");
    assert.equal(vars["--foreground"], "#eeeeee");
    assert.equal(vars["--primary"], "#ff0000");
    assert.equal(vars["--primary-foreground"], "#ffffff");
    assert.equal(vars["--destructive"], "#990000");
    assert.equal(vars["--border"], "#666666");
    assert.equal(vars["--input"], "#969696");
    assert.equal(vars["--ring"], "#0000ff");
    assert.equal(vars["--muted-foreground"], "#aaaaaa");
    assert.equal(vars["--muted-surface"], "#333333");
    assert.match(vars["--accent-fill"] ?? "", /#0000ff|0,\s*0,\s*255/);
```

Add:

```ts
  it("mixes canvas-base when background equals card", () => {
    const light = forgeVarsFromColors({
      ...sample,
      background: "#faf9f7",
      card: "#faf9f7",
      popover: "#faf9f7",
      foreground: "#1a1916",
    });
    assert.equal(light["--background"], "#faf9f7");
    assert.equal(light["--card"], "#faf9f7");
    assert.equal(light["--canvas-base"], mix("#faf9f7", "#1a1916", 0.06));
    assert.notEqual(light["--canvas-base"], light["--card"]);

    const darkSame = forgeVarsFromColors({
      ...sample,
      background: "#111111",
      card: "#111111",
      popover: "#111111",
    });
    assert.equal(darkSame["--canvas-base"], mix("#111111", "#000000", 0.15));
    assert.notEqual(darkSame["--canvas-base"], darkSame["--card"]);
  });
```

In `"emits --background and --primary for forge-os"` also assert:

```ts
    assert.ok(vars["--canvas-base"]);
    assert.equal(vars["--background"], vars["--card"]);
    assert.notEqual(vars["--canvas-base"], vars["--card"]);
```

In `apps/desktop/scripts/design-system-tokens.mjs`, after the `--primary` write check, add:

```js
  if (!applySkin.includes('"--canvas-base"') && !applySkin.includes("'--canvas-base'")) {
    findings.push("apply-skin.ts does not write --canvas-base");
  }
```

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/apply-skin.test.ts tests/design-system-tokens.test.ts
```

Expected: FAIL — `--background` is still `#111111`, no `--canvas-base`, scanner reports missing write.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/lib/themes/apply-skin.ts`, after `pickHex`, add:

```ts
function canvasBaseFromColors(
  c: SkinColors,
  elevated: string,
  dark: boolean,
): string {
  if (c.background.toLowerCase() !== elevated.toLowerCase()) return c.background;
  return dark ? mix(c.background, "#000000", 0.15) : mix(c.background, c.foreground, 0.06);
}
```

In `forgeVarsFromColors`, `bg` stays `c.background` for mix math (`dark`, `accentTint`, `subtle`, etc.). Change the vars object:

- `"--background": elevated` (not `bg`)
- add `"--canvas-base": canvasBaseFromColors(c, elevated, dark)` immediately after `"--background"`

In `clearSkinVars` `toRemove`, add `"--canvas-base"` next to `"--background"`.

Do not inline `--bg` or `--accent`. Do not mix canvas toward `c.muted`.

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/apply-skin.test.ts tests/design-system-tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/apply-skin.test.ts apps/desktop/src/lib/themes/apply-skin.ts apps/desktop/scripts/design-system-tokens.mjs
git commit -m "feat(desktop): write canvas-base from skin palettes"
```

---

### Task 3: Titlebar overlay reads `--canvas-base`

**Files:**
- Modify: `apps/desktop/tests/window-chrome.test.ts`
- Modify: `apps/desktop/src/components/theme/ThemeProvider.tsx`

**Interfaces:**
- Consumes: `--canvas-base` hex from Task 1/2; existing `overlayColor(value: string): string | null`
- Produces: `syncTitleBarOverlay` calls `getPropertyValue("--canvas-base")` and `getPropertyValue("--foreground")`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/window-chrome.test.ts`, replace the overlay token assertion inside `"syncs overlay caption colors from theme tokens"`:

```ts
    assert.match(src, /getPropertyValue\(["']--canvas-base["']\)/);
    assert.match(src, /getPropertyValue\(["']--foreground["']\)/);
    assert.equal(src.includes('getPropertyValue("--background")'), false);
    assert.equal(src.includes("getPropertyValue('--background')"), false);
    assert.equal(src.includes('getPropertyValue("--bg")'), false);
    assert.equal(src.includes("getPropertyValue('--bg')"), false);
    assert.equal(src.includes('getPropertyValue("--text")'), false);
```

Keep `window.lifequest?.windowChrome` and `setTitleBarOverlay` matches.

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/window-chrome.test.ts
```

Expected: FAIL — source still reads `--background`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/components/theme/ThemeProvider.tsx` `syncTitleBarOverlay`, change:

```ts
  const color = overlayColor(styles.getPropertyValue("--canvas-base"));
  const symbolColor = overlayColor(styles.getPropertyValue("--foreground"));
```

Leave the `#` / `rgb` guard and `.catch` skip unchanged. Do not read `--bg` or `--background`.

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/window-chrome.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/window-chrome.test.ts apps/desktop/src/components/theme/ThemeProvider.tsx
git commit -m "feat(desktop): sync titlebar overlay from canvas-base"
```

---

### Task 4: Canvas frame and paper sheet on existing shell

**Files:**
- Create: `apps/desktop/tests/shell-visuals.test.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: `--canvas-base`, `--card`, `--shell-frame`, `--radius-lg`, `--shadow-sm`, `--border`
- Produces: `body` / `.app-root` paint canvas; `.app-root__body` padding `var(--shell-frame)`; `.shell` and `.welcome` are the sheet; `.window-titlebar` paints canvas with no hard bottom border; `.window-titlebar__btn` radius 0; `.centered-status` is not a sheet

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/shell-visuals.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readCss(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/global.css"), "utf8");
}

describe("shell visuals", () => {
  it("paints the window as canvas and the studio as a sheet", () => {
    const css = readCss();
    assert.match(css, /body\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root__body\s*\{[\s\S]*?padding:\s*var\(--shell-frame\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-sm\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.welcome\s*\{[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
  });

  it("keeps the titlebar flush on canvas", () => {
    const css = readCss();
    assert.match(css, /\.window-titlebar\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.equal(
      /\.window-titlebar\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/.test(css),
      false,
    );
    assert.match(css, /\.window-titlebar__btn\s*\{[\s\S]*?border-radius:\s*0/);
  });

  it("does not turn boot status into a sheet", () => {
    const css = readCss();
    assert.equal(/\.centered-status\s*\{[\s\S]*?border-radius:\s*var\(--radius-lg\)/.test(css), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/shell-visuals.test.ts
```

Expected: FAIL — `body` still uses `var(--bg)`, `.shell` still uses `var(--bg)`, no `--shell-frame` padding.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/styles/global.css`:

`body` rule: `background: var(--canvas-base);` (keep `color: var(--fg)`).

`.app-root` add `background: var(--canvas-base);`.

`.app-root__body` add `padding: var(--shell-frame);`. Change `.app-root__body > *` from `height: 100%` to `flex: 1 1 auto` so the padded column does not overflow:

```css
.app-root__body > * {
  flex: 1 1 auto;
  min-height: 0;
}
```

`.window-titlebar`: `background: var(--canvas-base);` and **delete** `border-bottom: 1px solid var(--border);`.

`.window-titlebar__btn` add `border-radius: 0;`.

`.shell`: change `background: var(--bg)` to `var(--card)` and add:

```css
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
```

Keep the grid columns and `height: 100%`.

`.welcome`: add the same fill/radius/border/shadow as `.shell`. Keep `min-height: 100%`, flex centering, and `padding: 2rem`. Do not add a second `--shell-frame` margin.

Do not wrap ChatPanel or NavRail in extra cards. Do not style `.centered-status` as a sheet.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts tests/window-chrome.test.ts
```

Expected: PASS. The window-chrome test still requires `.welcome { min-height: 100% }` and no `100vh` on `.shell`.

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/shell-visuals.test.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): paint canvas frame and paper studio sheet"
```

---

### Task 5: Pill buttons and concentric chrome radii

**Files:**
- Modify: `apps/desktop/tests/shell-visuals.test.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: `--radius-pill`, `--radius-md`, `--radius-sm`, `--radius-xs`
- Produces: `.btn` uses `var(--radius-pill)`; `.field input` uses `var(--radius-sm)`; `.settings-card` uses `var(--radius-md)`; listed nav/welcome/settings chrome uses the scale; leftover `className="btn"` pills automatically

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/tests/shell-visuals.test.ts`:

```ts
  it("pills buttons and uses the concentric scale on shared chrome", () => {
    const css = readCss();
    assert.match(css, /\.btn\s*\{[\s\S]*?border-radius:\s*var\(--radius-pill\)/);
    assert.match(css, /\.field input\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-md\)/);
    assert.match(css, /\.nav-rail__link\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.recent-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-panel__icon\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.settings-nav-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts
```

Expected: FAIL — `.btn` is still `0.5rem`; `.settings-card` is still `var(--radius-lg)`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/styles/global.css`, change **only** these radii (leave map / signal-chain / home islands):

| Selector | New value |
|---|---|
| `.btn` | `var(--radius-pill)` |
| `.field input` | `var(--radius-sm)` |
| `.recent-item` | `var(--radius-sm)` |
| `.nav-rail__brand` | `var(--radius-sm)` |
| `.nav-rail__logo` | `var(--radius-sm)` |
| `.nav-rail__link` | `var(--radius-sm)` |
| `.settings-nav-item` | `var(--radius-sm)` |
| `.settings-panel__icon` | `var(--radius-sm)` |
| `.settings-card` | `var(--radius-md)` |

Do not change `.btn` padding, colors, or variants. Do not change `.window-titlebar__btn` (stays 0 from Task 4).

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts tests/ui-primitives.test.ts
```

Expected: PASS. `buttonClassName` still maps onto `.btn*`.

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/shell-visuals.test.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): pill buttons and concentric chrome radii"
```

---

### Task 6: Life Map content bleed inside the sheet

**Files:**
- Modify: `apps/desktop/tests/shell-visuals.test.ts`
- Modify: `apps/desktop/src/components/shell/AppShell.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: React Router `useLocation().pathname`; existing `shell__content` class
- Produces: `shell__content--bleed` when `pathname === "/chart"`; CSS `padding: 0`; studio frame and `.shell` margin/padding stay

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/tests/shell-visuals.test.ts`:

```ts
  it("bleeds Life Map inside the studio sheet on /chart only", () => {
    const css = readCss();
    assert.match(css, /\.shell__content--bleed\s*\{[\s\S]*?padding:\s*0/);
    const shell = fs.readFileSync(
      path.join(desktopRoot, "src/components/shell/AppShell.tsx"),
      "utf8",
    );
    assert.match(shell, /useLocation/);
    assert.match(shell, /pathname === ["']\/chart["']/);
    assert.match(shell, /shell__content--bleed/);
    assert.equal(shell.includes('pathname === "/dream"'), false);
    assert.equal(shell.includes('pathname === "/track"'), false);
  });
```

Add `fs` usage — the file already imports `fs` from Step 1 of Task 4.

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts
```

Expected: FAIL — no `--bleed` class, AppShell has no `useLocation`.

- [ ] **Step 3: Write minimal implementation**

`apps/desktop/src/styles/global.css` after `.shell__content`:

```css
.shell__content--bleed {
  padding: 0;
  overflow: hidden;
}
```

`apps/desktop/src/components/shell/AppShell.tsx`:

```tsx
import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell() {
  const [chatOpen, setChatOpen] = useState(true);
  const { pathname } = useLocation();
  const chartBleed = pathname === "/chart";

  return (
    <MapYearProvider>
      <WingProvider>
        <div
          className={[
            "shell",
            chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
          ].join(" ")}
        >
          <NavRail />
          <div className="shell__main">
            <TopBar />
            <div
              className={[
                "shell__content",
                chartBleed ? "shell__content--bleed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Outlet />
            </div>
          </div>
          <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
        </div>
      </WingProvider>
    </MapYearProvider>
  );
}
```

Do not remove `.app-root__body` padding on `/chart`. Do not change `/dream` or `/track`.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts
npm run typecheck
```

From `apps/desktop`. Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/shell-visuals.test.ts apps/desktop/src/components/shell/AppShell.tsx apps/desktop/src/styles/global.css
git commit -m "feat(desktop): bleed Life Map inside the studio sheet"
```

---

### Task 7: Constitution and spec status

**Files:**
- Modify: `DESIGN.md`
- Modify: `apps/desktop/src/components/ui/AGENTS.md`
- Modify: `apps/desktop/tests/constitution.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md`

**Interfaces:**
- Consumes: shipped canvas/sheet/radius/pill contract from Tasks 1–6
- Produces: DESIGN.md records the ladder and remaining do-not-do; AGENTS.md forbids a second frame and button radius overrides; constitution tests match the new copy

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/constitution.test.ts`, replace `"has DESIGN.md with token collisions and Phase 2 do-not-do"`:

```ts
  it("has DESIGN.md with canvas ladder and remaining Phase 2 do-not-do", () => {
    const src = read("DESIGN.md");
    assert.match(src, /Grounded life studio/);
    assert.match(src, /--accent-fill/);
    assert.match(src, /--muted-surface/);
    assert.match(src, /--canvas-base/);
    assert.match(src, /PageShell/);
    assert.match(src, /card-glass/);
    assert.match(src, /--radius-pill/);
  });
```

In `"documents shared UI rules"` add:

```ts
    assert.match(src, /pill/);
    assert.match(src, /\.shell/);
```

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/constitution.test.ts
```

Expected: FAIL — DESIGN.md has no `--canvas-base`; AGENTS.md has no pill/`.shell`.

- [ ] **Step 3: Write the docs**

Replace `DESIGN.md` with:

```md
# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--canvas-base` is the window mat. `--card` is the studio sheet. `--background` is paper on the sheet (aliases `--bg`) so outline controls blend. Skins write `--canvas-base` from the palette background, or mix toward ink when background equals card.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex. Titlebar overlay reads `--canvas-base` and `--foreground` hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First — canvas vs sheet is the elevation ladder; do not add shadows beyond `--shadow-sm` on the sheet.
- Calm Scale — radii are `6 / 12 / 18 / 24 / pill`. Do not change the type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). Pill radius via `.btn`. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome. Settings cards use `--radius-md`.

The studio sheet is `.shell` / `.welcome` CSS, not a primitive.

## Remaining visual do-not-do

Do not add `card-glass`, dot-grid, Inter/Geist as default UI fonts, a pill composer, `PageShell`, or reclaim `--accent` as hover.
```

Replace `apps/desktop/src/components/ui/AGENTS.md` with:

```md
# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`. Danger is `destructive`, not a new color class.
- Buttons are pills via `.btn`. Do not override `border-radius` on `Button`.
- Inputs are `--radius-sm` (12px), not pills.
- The studio sheet is `.shell` / `.welcome` CSS. Feature files must not add a second canvas frame.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
```

In `README.md` Design table, after the Phase 1 row, add:

```md
| [BERD visuals phase 2](docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md) | Canvas/sheet, concentric radii, pill buttons |
```

Set the spec status line to:

```md
**Status:** Approved — implementation plan at docs/superpowers/plans/2026-09-03-berd-visuals-phase-2.md
```

- [ ] **Step 4: Run tests**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/constitution.test.ts tests/design-system-tokens.test.ts tests/tokens.test.ts tests/apply-skin.test.ts tests/window-chrome.test.ts tests/shell-visuals.test.ts tests/ui-primitives.test.ts
npm test
npm run typecheck
```

Expected: PASS. Known pre-existing `packaging-config` failure is out of scope — if `npm test` fails only on that, record it and do not “fix” it in this task.

Manual look lock (if the desktop app can run): Welcome, Home, Settings, Life Map, Nous skin, light/dark.

- [ ] **Step 5: Commit**

```
git add DESIGN.md apps/desktop/src/components/ui/AGENTS.md apps/desktop/tests/constitution.test.ts README.md docs/superpowers/specs/2026-09-03-berd-visuals-phase-2-design.md
git commit -m "docs: record canvas/sheet ladder and remaining visual do-not-do"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| `--canvas-base` hex; `--background` paper = `--card` | 1, 2 |
| Radii `6 / 12 / 18 / 24 / pill`; `--shell-frame: 20px` | 1 |
| Skin writer canvas mix fallback; `clearSkinVars` | 2 |
| Scanner requires `--canvas-base` write | 2 |
| Overlay `--canvas-base` / `--foreground` | 3 |
| Frame = padding on `.app-root__body`; sheet = `.shell` / `.welcome` | 4 |
| Titlebar canvas, no hard border, square caption buttons | 4 |
| Boot `.centered-status` not a sheet | 4 |
| Pill `.btn`; inputs 12px; settings-card 18px; nav/welcome chrome | 5 |
| Map `/chart` bleed only; frame stays | 6 |
| DESIGN.md / AGENTS.md / remaining do-not-do | 7 |
| No PageShell, glass, dots, fonts, `--accent` reclaim | Global constraints |

`--background` write-path change is Task 2; default CSS hex change is Task 1. Both are required so unsinned `tokens.css` and skinned `<html>` agree.

Chat stays a `.shell` column (Task 4 does not wrap it). Settings stays `/settings` inside `.shell` (Task 5 only changes card radius).
