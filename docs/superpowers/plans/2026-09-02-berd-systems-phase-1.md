# BERD Systems Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a CSS-native design contract (semantic tokens, skin writer, Button/settings primitives, PRODUCT/DESIGN/LAWS, token audit) without changing how LifeQuest looks.

**Architecture:** Alias-first. `tokens.css` defines semantic tokens and keeps `--bg` / `--accent` / `--muted` as aliases. `apply-skin.ts` writes only semantic and extension vars so aliases follow. Shared React primitives wrap existing `.btn` and settings CSS. No Tailwind.

**Tech Stack:** Electron + Vite + React 19, CSS custom properties, `node:test` + `--experimental-strip-types`. No Tailwind, CVA, Radix Slot, or new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md`

## Global Constraints

- Do **not** change the visual identity (skins, warm paper, Nous, terracotta, 8px buttons)
- Do **not** add Tailwind, CVA, shadcn, Radix Slot, or an in-app design explorer
- Do **not** reclaim `--accent` as hover fill; `--accent` aliases `--primary`
- Do **not** make `--muted` a surface; `--muted` aliases `--muted-foreground`
- Do **not** add `PageShell`, pill buttons, canvas/glass, 6px radius scale, Inter/Geist, or migrate leftover `.btn` outside Settings
- Do **not** invent a filled red button; `destructive` is `.btn-danger`
- ThemeProvider must not synthesize a palette from one primary hex
- Titlebar overlay must read `--background` / `--foreground` (hex), never `var()` aliases
- Desktop tests: `node --experimental-strip-types --test` under `apps/desktop/tests/`
- Commit only files from the current task; leave unrelated dirty files unstaged

---

## File Structure

```
apps/desktop/
  src/styles/tokens.css                         # three layers + aliases
  src/lib/themes/apply-skin.ts                  # write semantic + extensions
  src/components/theme/ThemeProvider.tsx        # overlay reads --background/--foreground
  src/components/ui/Button.tsx                  # NEW
  src/components/ui/SettingsSection.tsx         # NEW
  src/components/ui/SettingsRow.tsx             # NEW
  src/components/ui/AGENTS.md                   # NEW
  src/styles/global.css                         # .btn-ghost; list-row semantic vars
  src/components/settings/*.tsx                 # section/row/Button
  scripts/design-system-tokens.mjs              # NEW scanner
  tests/tokens.test.ts                          # NEW alias contract
  tests/apply-skin.test.ts                      # NEW writer contract
  tests/theme.test.ts                           # NEW (moved from src/lib/theme.test.ts)
  tests/design-system-tokens.test.ts            # NEW scanner runner
  tests/ui-primitives.test.ts                   # NEW Button/settings source
  tests/settings-shell.test.ts                  # settings use primitives
  tests/window-chrome.test.ts                   # overlay token names
  package.json                                  # test globs already cover tests/**

PRODUCT.md                                      # NEW
DESIGN.md                                       # NEW
LAWS/README.md                                  # NEW
LAWS/IDENTITY.md                                # NEW
LAWS/SECRETS.md                                 # NEW
LAWS/DOMAIN-FILTER.md                           # NEW
LAWS/WINGS.md                                   # NEW
LAWS/DOCTRINE.md                                # NEW
README.md                                       # link constitution
docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md  # status → Approved
```

No vault-core, Electron main, or page-level `.btn` migrations.

---

### Task 1: Token layers and compatibility aliases

**Files:**
- Create: `apps/desktop/tests/tokens.test.ts`
- Modify: `apps/desktop/src/styles/tokens.css`

**Interfaces:**
- Consumes: nothing
- Produces: `:root` / `[data-theme="dark"]` / system-dark semantic tokens `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--muted-surface`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent-fill`, `--accent-fill-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--primary-hover`, `--primary-hover-foreground`; aliases `--bg`, `--bg-app`, `--bg-elevated`, `--bg-muted`, `--text`, `--fg`, `--text-muted`, `--muted`, `--accent`, `--accent-fg`, `--accent-hover`, `--accent-strong`, `--accent-hover-fg`, `--danger`, `--red`, `--success`, `--selected`, `--selected-soft`, `--border-strong`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/tokens.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readTokens(): string {
  return fs.readFileSync(path.join(desktopRoot, "src/styles/tokens.css"), "utf8");
}

describe("token contract", () => {
  it("defines semantic tokens with the current light hex values", () => {
    const css = readTokens();
    assert.match(css, /--background:\s*#faf9f7/);
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

  it("aliases legacy names instead of storing a second hex vocabulary", () => {
    const css = readTokens();
    assert.match(css, /--bg:\s*var\(--background\)/);
    assert.match(css, /--bg-app:\s*var\(--background\)/);
    assert.match(css, /--bg-elevated:\s*var\(--card\)/);
    assert.match(css, /--bg-muted:\s*var\(--muted-surface\)/);
    assert.match(css, /--text:\s*var\(--foreground\)/);
    assert.match(css, /--fg:\s*var\(--foreground\)/);
    assert.match(css, /--text-muted:\s*var\(--muted-foreground\)/);
    assert.match(css, /--muted:\s*var\(--muted-foreground\)/);
    assert.match(css, /--accent:\s*var\(--primary\)/);
    assert.match(css, /--accent-fg:\s*var\(--primary-foreground\)/);
    assert.match(css, /--accent-hover:\s*var\(--primary-hover\)/);
    assert.match(css, /--accent-strong:\s*var\(--primary-hover\)/);
    assert.match(css, /--danger:\s*var\(--destructive\)/);
    assert.match(css, /--red:\s*var\(--destructive\)/);
    assert.match(css, /--selected:\s*var\(--ring\)/);
    assert.match(css, /--selected-soft:\s*var\(--accent-fill\)/);
    assert.match(css, /--border-strong:\s*var\(--input\)/);
    assert.equal(/--accent:\s*#/.test(css), false);
    assert.equal(/--bg:\s*#/.test(css), false);
    assert.equal(/--muted:\s*#/.test(css), false);
  });

  it("keeps dark paper values on semantic tokens", () => {
    const css = readTokens();
    assert.match(css, /\[data-theme="dark"\][\s\S]*--background:\s*#1a1917/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--primary:\s*#d97a56/);
    assert.match(css, /\[data-theme="dark"\][\s\S]*--foreground:\s*#e8e4dc/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/desktop`:

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: FAIL — `--background` / `--primary` not defined; `--accent` is still a hex.

- [ ] **Step 3: Rewrite `tokens.css`**

Replace `apps/desktop/src/styles/tokens.css` with:

```css
/* Semantic contract + legacy aliases. Hex lives in semantic/extension tokens only. */

:root {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-display: var(--font-sans);

  --shell-nav-width: 4.25rem;
  --shell-sidebar-width: 16rem;
  --shell-chatbar-height: 3rem;
  --shell-max-width: 80rem;
  --shell-topbar-height: 2.75rem;
  --window-titlebar-height: 32px;
  --chatbar-width: 22.5rem;

  --background: #faf9f7;
  --foreground: #1a1916;
  --card: #fffefc;
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --muted-surface: #eef1f5;
  --muted-foreground: #74716b;
  --primary: #c96442;
  --primary-foreground: #ffffff;
  --secondary: #f5d8cb;
  --secondary-foreground: var(--foreground);
  --accent-fill: rgba(37, 99, 235, 0.16);
  --accent-fill-foreground: var(--foreground);
  --destructive: #9c2a25;
  --destructive-foreground: #ffffff;
  --border: #e1e5eb;
  --input: #c9d0da;
  --ring: #2563eb;

  --bg-panel: #fdfcfa;
  --bg-subtle: #f4f5f7;
  --bg-fill-tertiary: rgba(0, 0, 0, 0.03);
  --bg-fill-secondary: rgba(0, 0, 0, 0.06);
  --border-soft: #edf0f4;
  --line: var(--border);
  --sidebar-border: var(--border);
  --text-strong: #0d0c0a;
  --text-soft: #989590;
  --text-faint: #b3b0a8;
  --primary-hover: #b45a3b;
  --primary-hover-foreground: #ffffff;
  --accent-soft: #f5d8cb;
  --accent-tint: #fbeee5;

  --composer-bg: var(--card);
  --composer-fg: var(--foreground);
  --composer-fg-muted: var(--muted-foreground);
  --composer-fg-soft: var(--text-soft);
  --composer-fg-faint: var(--text-faint);
  --composer-border: var(--line);
  --composer-border-soft: var(--border-soft);
  --composer-border-strong: var(--input);

  --green: #1f7a3a;
  --green-bg: #e8f7ee;
  --green-border: #c6ead2;
  --blue: #2348b8;
  --blue-bg: #e8efff;
  --blue-border: #c8d6ff;
  --amber: #b26200;
  --amber-bg: #fff3e0;
  --red-bg: #fdecea;
  --red-border: #f5c6c2;

  --shadow-xs: 0 1px 0 rgba(28, 27, 26, 0.04);
  --shadow-sm: 0 1px 2px rgba(28, 27, 26, 0.05), 0 1px 3px rgba(28, 27, 26, 0.04);
  --shadow-md: 0 6px 24px rgba(28, 27, 26, 0.07), 0 2px 6px rgba(28, 27, 26, 0.04);
  --shadow-nous:
    0 0.125rem 0.25rem -0.125rem color-mix(in srgb, #000 7%, transparent),
    0 0.5rem 0.75rem -0.375rem color-mix(in srgb, #000 6%, transparent),
    0 1.25rem 1.75rem -0.875rem color-mix(in srgb, #000 6%, transparent),
    0 2.25rem 3rem -1.75rem color-mix(in srgb, #000 0%, transparent);
  --stroke-nous: color-mix(in srgb, var(--foreground) 8%, transparent);

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-pill: 999px;

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --dur-quick: 120ms;
  --dur-enter: 200ms;
  --dur-exit: 140ms;

  --map-gold: #d4a84b;
  --map-red: #c45c58;
  --map-blue: #4d7ec8;
  --map-green: #4d8f5a;
  --map-orange: #d4893a;
  --map-purple: #8b5cad;
  --map-teal: #3d8a92;
  --map-pink: #c45d8a;

  --bg: var(--background);
  --bg-app: var(--background);
  --bg-elevated: var(--card);
  --bg-muted: var(--muted-surface);
  --text: var(--foreground);
  --fg: var(--foreground);
  --text-muted: var(--muted-foreground);
  --muted: var(--muted-foreground);
  --accent: var(--primary);
  --accent-fg: var(--primary-foreground);
  --accent-hover: var(--primary-hover);
  --accent-strong: var(--primary-hover);
  --accent-hover-fg: var(--primary-hover-foreground);
  --danger: var(--destructive);
  --red: var(--destructive);
  --success: var(--green);
  --selected: var(--ring);
  --selected-soft: var(--accent-fill);
  --border-strong: var(--input);
  --color-bg: var(--background);
  --color-text: var(--foreground);
  --color-muted: var(--muted-foreground);
  --color-focus: var(--ring);

  color-scheme: light;
}

[data-theme="dark"] {
  color-scheme: dark;

  --background: #1a1917;
  --foreground: #e8e4dc;
  --card: #2a2825;
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --muted-surface: #2e2c29;
  --muted-foreground: #9a9690;
  --primary: #d97a56;
  --primary-foreground: #1a1917;
  --secondary: #3d2318;
  --secondary-foreground: var(--foreground);
  --accent-fill: rgba(217, 122, 86, 0.18);
  --accent-fill-foreground: var(--foreground);
  --destructive: #e06b65;
  --destructive-foreground: #1a1917;
  --border: #333128;
  --input: #46433c;
  --ring: #2563eb;

  --bg-panel: #222120;
  --bg-subtle: #252321;
  --bg-fill-tertiary: rgba(255, 255, 255, 0.06);
  --bg-fill-secondary: rgba(255, 255, 255, 0.1);
  --border-soft: #2a2825;
  --line: var(--border);
  --sidebar-border: var(--border);
  --text-strong: #f2ede4;
  --text-soft: #6e6b65;
  --text-faint: #4e4b46;
  --primary-hover: #e8896a;
  --primary-hover-foreground: #1a1917;
  --accent-soft: #3d2318;
  --accent-tint: #2e1a12;

  --map-gold: #e0c36a;
  --map-red: #e06b65;
  --map-blue: #6b8fe8;
  --map-green: #4caf72;
  --map-orange: #e09a40;
  --map-purple: #b794d4;
  --map-teal: #5eb3b8;
  --map-pink: #d489b0;

  --green: #4caf72;
  --green-bg: #0f2a18;
  --green-border: #1a4028;
  --blue: #6b8fe8;
  --blue-bg: #0f1a38;
  --blue-border: #1a2c58;
  --amber: #e09a40;
  --amber-bg: #2a1a04;
  --red-bg: #2a0e0c;
  --red-border: #451714;

  --shadow-xs: 0 1px 0 rgba(0, 0, 0, 0.2);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 6px 24px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25);
  --shadow-nous:
    0 0.125rem 0.25rem -0.125rem color-mix(in srgb, #000 12%, transparent),
    0 0.5rem 0.75rem -0.375rem color-mix(in srgb, #000 10%, transparent),
    0 1.25rem 1.75rem -0.875rem color-mix(in srgb, #000 10%, transparent),
    0 2.25rem 3rem -1.75rem color-mix(in srgb, #000 0%, transparent);
  --stroke-nous: color-mix(in srgb, var(--foreground) 6%, transparent);
}

@media (prefers-color-scheme: dark) {
  html:not([data-theme]) {
    color-scheme: dark;

    --background: #1a1917;
    --foreground: #e8e4dc;
    --card: #2a2825;
    --card-foreground: var(--foreground);
    --popover: var(--card);
    --popover-foreground: var(--foreground);
    --muted-surface: #2e2c29;
    --muted-foreground: #9a9690;
    --primary: #d97a56;
    --primary-foreground: #1a1917;
    --secondary: #3d2318;
    --secondary-foreground: var(--foreground);
    --accent-fill: rgba(217, 122, 86, 0.18);
    --accent-fill-foreground: var(--foreground);
    --destructive: #e06b65;
    --destructive-foreground: #1a1917;
    --border: #333128;
    --input: #46433c;
    --ring: #2563eb;

    --bg-panel: #222120;
    --bg-subtle: #252321;
    --bg-fill-tertiary: rgba(255, 255, 255, 0.06);
    --bg-fill-secondary: rgba(255, 255, 255, 0.1);
    --border-soft: #2a2825;
    --text-strong: #f2ede4;
    --text-soft: #6e6b65;
    --text-faint: #4e4b46;
    --primary-hover: #e8896a;
    --primary-hover-foreground: #1a1917;
    --accent-soft: #3d2318;
    --accent-tint: #2e1a12;

    --map-gold: #e0c36a;
    --map-red: #e06b65;
    --map-blue: #6b8fe8;
    --map-green: #4caf72;
    --map-orange: #e09a40;
    --map-purple: #b794d4;
    --map-teal: #5eb3b8;
    --map-pink: #d489b0;

    --green: #4caf72;
    --green-bg: #0f2a18;
    --green-border: #1a4028;
    --blue: #6b8fe8;
    --blue-bg: #0f1a38;
    --blue-border: #1a2c58;
    --amber: #e09a40;
    --amber-bg: #2a1a04;
    --red-bg: #2a0e0c;
    --red-border: #451714;

    --shadow-xs: 0 1px 0 rgba(0, 0, 0, 0.2);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 6px 24px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25);
    --shadow-nous:
      0 0.125rem 0.25rem -0.125rem color-mix(in srgb, #000 12%, transparent),
      0 0.5rem 0.75rem -0.375rem color-mix(in srgb, #000 10%, transparent),
      0 1.25rem 1.75rem -0.875rem color-mix(in srgb, #000 10%, transparent),
      0 2.25rem 3rem -1.75rem color-mix(in srgb, #000 0%, transparent);
    --stroke-nous: color-mix(in srgb, var(--foreground) 6%, transparent);
  }
}
```

Do not repeat alias declarations inside the dark blocks; they inherit from `:root` (`--bg: var(--background)` still follows the overridden `--background`).

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/tokens.test.ts apps/desktop/src/styles/tokens.css
git commit -m "feat(desktop): add semantic token layers with legacy aliases"
```

---

### Task 2: Skin writer emits semantic tokens

**Files:**
- Create: `apps/desktop/tests/apply-skin.test.ts`
- Create: `apps/desktop/tests/theme.test.ts`
- Modify: `apps/desktop/src/lib/themes/apply-skin.ts`
- Delete: `apps/desktop/src/lib/theme.test.ts` (coverage moves into `tests/theme.test.ts` so `npm test` runs it)

**Interfaces:**
- Consumes: `SkinColors` from `apps/desktop/src/lib/themes/types.ts` (unchanged field names)
- Produces: `forgeVarsFromColors(c: SkinColors): ForgeSkinVars` with semantic keys (`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--muted-surface`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent-fill`, `--accent-fill-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--primary-hover`, `--primary-hover-foreground`) plus extensions (`--bg-panel`, `--bg-subtle`, `--border-soft`, `--line`, `--sidebar-border`, `--text-strong`, `--text-soft`, `--text-faint`, `--accent-soft`, `--accent-tint`, `--red-bg`, `--red-border`, composer, greens/blues/ambers, optional shadows). Do **not** emit alias keys `--bg`, `--accent`, `--muted`, `--text`, `--selected`, `--selected-soft`, `--accent-hover`, `--accent-strong`, `--danger`, `--red`, `--bg-elevated`, `--bg-muted`, `--text-muted`, `--input` is written (semantic); `--border-strong` is not.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/tests/apply-skin.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgeVarsFromColors, forgeVarsFromSkin } from "../src/lib/themes/apply-skin.ts";
import { BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "../src/lib/themes/presets.ts";
import type { SkinColors } from "../src/lib/themes/types.ts";

const sample: SkinColors = {
  background: "#111111",
  foreground: "#eeeeee",
  card: "#222222",
  cardForeground: "#eeeeee",
  muted: "#333333",
  mutedForeground: "#aaaaaa",
  popover: "#222222",
  popoverForeground: "#eeeeee",
  primary: "#ff0000",
  primaryForeground: "#ffffff",
  secondary: "#444444",
  secondaryForeground: "#eeeeee",
  accent: "#555555",
  accentForeground: "#eeeeee",
  border: "#666666",
  input: "#777777",
  ring: "#0000ff",
  destructive: "#990000",
  destructiveForeground: "#ffffff",
};

const FORBIDDEN = [
  "--bg",
  "--bg-app",
  "--text",
  "--fg",
  "--accent",
  "--accent-fg",
  "--accent-hover",
  "--accent-strong",
  "--muted",
  "--danger",
  "--red",
  "--selected",
  "--selected-soft",
  "--bg-elevated",
  "--bg-muted",
  "--text-muted",
];

describe("forgeVarsFromColors", () => {
  it("writes semantic tokens from SkinColors fields", () => {
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--background"], "#111111");
    assert.equal(vars["--foreground"], "#eeeeee");
    assert.equal(vars["--card"], "#222222");
    assert.equal(vars["--primary"], "#ff0000");
    assert.equal(vars["--primary-foreground"], "#ffffff");
    assert.equal(vars["--destructive"], "#990000");
    assert.equal(vars["--border"], "#666666");
    assert.equal(vars["--input"], "#777777");
    assert.equal(vars["--ring"], "#0000ff");
    assert.equal(vars["--muted-foreground"], "#aaaaaa");
    assert.equal(vars["--muted-surface"], "#333333");
    assert.match(vars["--accent-fill"] ?? "", /#0000ff|0,\s*0,\s*255/);
  });

  it("does not treat Forge accent as brand primary", () => {
    const vars = forgeVarsFromColors(sample);
    assert.equal(vars["--primary"], "#ff0000");
    assert.notEqual(vars["--primary"], "#555555");
  });

  it("does not inline legacy alias names", () => {
    const vars = forgeVarsFromColors(sample);
    for (const key of FORBIDDEN) {
      assert.equal(vars[key], undefined, key);
    }
  });
});

describe("forgeVarsFromSkin", () => {
  it("emits --background and --primary for forge-os", () => {
    const vars = forgeVarsFromSkin(BUILTIN_SKINS[DEFAULT_SKIN_NAME], "light");
    assert.ok(vars["--background"]);
    assert.ok(vars["--primary"]);
    assert.equal(vars["--bg"], undefined);
    assert.equal(vars["--accent"], undefined);
  });
});
```

Create `apps/desktop/tests/theme.test.ts` by copying `apps/desktop/src/lib/theme.test.ts` and changing imports to `../src/lib/theme.ts` and `../src/lib/themes/presets.ts`.

- [ ] **Step 2: Run tests to verify they fail**

```
node --experimental-strip-types --test tests/apply-skin.test.ts
```

Expected: FAIL — vars still contain `--bg` / `--accent`; `--background` missing.

- [ ] **Step 3: Change `forgeVarsFromColors` and `clearSkinVars`**

In `composerVars`, when there is no `userBubble`, return:

```ts
return {
  "--composer-bg": "var(--card)",
  "--composer-fg": "var(--foreground)",
  "--composer-fg-muted": "var(--muted-foreground)",
  "--composer-fg-soft": "var(--text-soft)",
  "--composer-fg-faint": "var(--text-faint)",
  "--composer-border": "var(--line)",
  "--composer-border-soft": "var(--border-soft)",
  "--composer-border-strong": "var(--input)",
};
```

Replace the `vars` object inside `forgeVarsFromColors` (keep the same local math: `bg`, `dark`, `panel`, `elevated`, `primary`, `accentHover`, `accentSoft`, `accentTint`, `border`, `borderStrong`, `structuralLine`, `sidebarBorder`, `borderSoft`, `muted`, `subtle`, `selected`, `destructive`, `ink`, `chromaticFg`):

```ts
  const vars: ForgeSkinVars = {
    "--background": bg,
    "--foreground": c.foreground,
    "--card": elevated,
    "--card-foreground": c.cardForeground ?? c.foreground,
    "--popover": pickHex(c.popover, elevated),
    "--popover-foreground": c.popoverForeground ?? c.foreground,
    "--muted-surface": muted,
    "--muted-foreground": pickHex(c.mutedForeground, mix(c.foreground, bg, 0.45)),
    "--primary": primary,
    "--primary-foreground": c.primaryForeground,
    "--secondary": accentSoft,
    "--secondary-foreground": c.secondaryForeground ?? c.foreground,
    "--accent-fill": `color-mix(in srgb, ${selected} 16%, transparent)`,
    "--accent-fill-foreground": c.foreground,
    "--destructive": destructive,
    "--destructive-foreground": c.destructiveForeground ?? readableOn(destructive),
    "--border": border,
    "--input": borderStrong,
    "--ring": selected,
    "--bg-panel": panel,
    "--bg-subtle": subtle,
    "--border-soft": borderSoft,
    "--line": structuralLine,
    "--sidebar-border": sidebarBorder,
    "--text-strong": dark
      ? mix(c.foreground, "#ffffff", 0.12)
      : chromaticFg
        ? c.foreground
        : mix(c.foreground, "#000000", 0.15),
    "--text-soft": mix(c.mutedForeground ?? c.foreground, bg, 0.55),
    "--text-faint": mix(c.mutedForeground ?? c.foreground, bg, 0.7),
    "--primary-hover": accentHover,
    "--primary-hover-foreground": readableOn(accentHover),
    "--accent-soft": accentSoft,
    "--accent-tint": accentTint,
    "--red-bg": mix(destructive, bg, dark ? 0.82 : 0.9),
    "--red-border": mix(destructive, bg, dark ? 0.65 : 0.75),
    ...composerVars(c, border),
  };
```

Keep the `composerRing` shadow/fill block and the dark/light `--green` / `--blue` / `--amber` block unchanged (still write those extension names).

Replace `clearSkinVars` `toRemove` with the keys this function now writes (semantic + extensions), including `--font-display`. Do not list `--bg` or `--accent`.

Delete `apps/desktop/src/lib/theme.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/apply-skin.test.ts tests/theme.test.ts tests/tokens.test.ts
```

Expected: PASS. `--accent-fill` for `sample` is `color-mix(in srgb, #0000ff 16%, transparent)` — the test regex `/#0000ff|0,\s*0,\s*255/` matches `#0000ff`.

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/apply-skin.test.ts apps/desktop/tests/theme.test.ts apps/desktop/src/lib/themes/apply-skin.ts apps/desktop/src/lib/theme.test.ts
git commit -m "feat(desktop): write semantic tokens from Forge skins"
```

---

### Task 3: Titlebar overlay reads semantic hex

**Files:**
- Modify: `apps/desktop/src/components/theme/ThemeProvider.tsx`
- Modify: `apps/desktop/tests/window-chrome.test.ts`

**Interfaces:**
- Consumes: `--background` / `--foreground` hex from Task 1–2
- Produces: `syncTitleBarOverlay` calls `getPropertyValue("--background")` and `getPropertyValue("--foreground")`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/window-chrome.test.ts`, change the overlay test to:

```ts
  it("syncs overlay caption colors from theme tokens", () => {
    const src = read("src/components/theme/ThemeProvider.tsx");
    assert.match(src, /window\.lifequest\?\.windowChrome/);
    assert.match(src, /setTitleBarOverlay/);
    assert.match(src, /getPropertyValue\(["']--background["']\)/);
    assert.match(src, /getPropertyValue\(["']--foreground["']\)/);
    assert.equal(src.includes('getPropertyValue("--bg")'), false);
    assert.equal(src.includes("getPropertyValue('--bg')"), false);
    assert.equal(src.includes('getPropertyValue("--text")'), false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/window-chrome.test.ts
```

Expected: FAIL on `--background`.

- [ ] **Step 3: Update ThemeProvider**

In `syncTitleBarOverlay`:

```ts
  const color = overlayColor(styles.getPropertyValue("--background"));
  const symbolColor = overlayColor(styles.getPropertyValue("--foreground"));
```

Keep `overlayColor`’s `#` / `rgb` guard and swallowed `setTitleBarOverlay` errors.

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/window-chrome.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/theme/ThemeProvider.tsx apps/desktop/tests/window-chrome.test.ts
git commit -m "fix(desktop): sync titlebar overlay from semantic tokens"
```

---

### Task 4: Token scanner

**Files:**
- Create: `apps/desktop/scripts/design-system-tokens.mjs`
- Create: `apps/desktop/tests/design-system-tokens.test.ts`

**Interfaces:**
- Consumes: `apply-skin.ts` output from Task 2; `src/components/ui/*`
- Produces: `export function auditDesignSystem(root: string): string[]` returning finding strings; exit 1 when run as CLI with findings

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/design-system-tokens.test.ts`:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { auditDesignSystem } from "../scripts/design-system-tokens.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("design-system-tokens", () => {
  it("reports no findings on the current tree", () => {
    const findings = auditDesignSystem(desktopRoot);
    assert.deepEqual(findings, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/design-system-tokens.test.ts
```

Expected: FAIL — cannot find `auditDesignSystem`.

- [ ] **Step 3: Implement the scanner**

Create `apps/desktop/scripts/design-system-tokens.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_INLINE_KEYS = [
  "--bg",
  "--bg-app",
  "--text",
  "--fg",
  "--accent",
  "--accent-fg",
  "--accent-hover",
  "--accent-strong",
  "--muted",
  "--danger",
  "--red",
];

const HEX = /#[0-9A-Fa-f]{3,8}/g;
const FUNC_COLOR = /(?:rgba?|hsla?)\(/g;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkUiFiles(uiDir) {
  if (!fs.existsSync(uiDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(uiDir, { withFileTypes: true })) {
    const full = path.join(uiDir, entry.name);
    if (entry.isDirectory()) out.push(...walkUiFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name) && entry.name !== "AGENTS.md") {
      out.push(full);
    }
  }
  return out;
}

export function auditDesignSystem(root) {
  const findings = [];
  const applySkin = fs.readFileSync(path.join(root, "src/lib/themes/apply-skin.ts"), "utf8");
  for (const key of FORBIDDEN_INLINE_KEYS) {
    const pattern = new RegExp(`["']${key}["']\\s*:`);
    if (pattern.test(applySkin)) {
      findings.push(`apply-skin.ts inlines alias ${key}`);
    }
  }
  if (!applySkin.includes('"--background"') && !applySkin.includes("'--background'")) {
    findings.push("apply-skin.ts does not write --background");
  }
  if (!applySkin.includes('"--primary"') && !applySkin.includes("'--primary'")) {
    findings.push("apply-skin.ts does not write --primary");
  }

  for (const file of walkUiFiles(path.join(root, "src/components/ui"))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const body = stripComments(fs.readFileSync(file, "utf8"));
    HEX.lastIndex = 0;
    FUNC_COLOR.lastIndex = 0;
    if (HEX.test(body)) findings.push(`${rel} contains raw hex`);
    if (FUNC_COLOR.test(body)) findings.push(`${rel} contains rgb/hsl()`);
  }
  return findings;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const findings = auditDesignSystem(root);
  if (findings.length) {
    for (const finding of findings) console.error(finding);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/design-system-tokens.test.ts tests/apply-skin.test.ts
```

Expected: PASS (ui folder has no hex; apply-skin no longer inlines aliases).

- [ ] **Step 5: Commit**

```
git add apps/desktop/scripts/design-system-tokens.mjs apps/desktop/tests/design-system-tokens.test.ts
git commit -m "test(desktop): audit semantic token writes and ui hex"
```

---

### Task 5: Button primitive

**Files:**
- Create: `apps/desktop/src/components/ui/Button.tsx`
- Create: `apps/desktop/tests/ui-primitives.test.ts`
- Modify: `apps/desktop/src/styles/global.css` (add `.btn-ghost` after `.btn-danger`)

**Interfaces:**
- Consumes: existing `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`
- Produces:

```ts
export type ButtonVariant = "primary" | "outline" | "ghost";
export type ButtonProps = {
  variant?: ButtonVariant;
  destructive?: boolean;
  to?: string;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "href">;
export function Button(props: ButtonProps): JSX.Element;
export function buttonClassName(props: Pick<ButtonProps, "variant" | "destructive" | "className">): string;
```

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/ui-primitives.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buttonClassName } from "../src/components/ui/Button.tsx";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("buttonClassName", () => {
  it("maps variants onto existing btn classes", () => {
    assert.equal(buttonClassName({}), "btn btn-secondary");
    assert.equal(buttonClassName({ variant: "outline" }), "btn btn-secondary");
    assert.equal(buttonClassName({ variant: "primary" }), "btn btn-primary");
    assert.equal(buttonClassName({ variant: "ghost" }), "btn btn-ghost");
    assert.equal(buttonClassName({ destructive: true }), "btn btn-danger");
    assert.equal(
      buttonClassName({ variant: "primary", destructive: true }),
      "btn btn-danger",
    );
    assert.equal(
      buttonClassName({ variant: "primary", className: "ml-auto" }),
      "btn btn-primary ml-auto",
    );
  });
});

describe("Button source", () => {
  it("renders Link when to is set and defaults type to button", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src/components/ui/Button.tsx"),
      "utf8",
    );
    assert.match(src, /from ["']react-router-dom["']/);
    assert.match(src, /to\?:/);
    assert.match(src, /type = ["']button["']/);
    assert.equal(src.includes("@radix-ui"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/ui-primitives.test.ts
```

Expected: FAIL — `Button.tsx` missing.

- [ ] **Step 3: Implement Button and `.btn-ghost`**

Create `apps/desktop/src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

export type ButtonVariant = "primary" | "outline" | "ghost";

export type ButtonProps = {
  variant?: ButtonVariant;
  destructive?: boolean;
  to?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "href">;

export function buttonClassName({
  variant = "outline",
  destructive = false,
  className = "",
}: Pick<ButtonProps, "variant" | "destructive" | "className">): string {
  const classes = ["btn"];
  if (destructive) classes.push("btn-danger");
  else if (variant === "primary") classes.push("btn-primary");
  else if (variant === "ghost") classes.push("btn-ghost");
  else classes.push("btn-secondary");
  if (className.trim()) classes.push(className.trim());
  return classes.join(" ");
}

export function Button({
  variant = "outline",
  destructive = false,
  to,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = buttonClassName({ variant, destructive, className });
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
```

Add after `.btn-danger:hover` in `apps/desktop/src/styles/global.css`:

```css
.btn-ghost {
  background: transparent;
  border-color: transparent;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--accent-fill);
}
```

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/ui-primitives.test.ts tests/design-system-tokens.test.ts
```

Expected: PASS (Button.tsx has no hex).

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/ui/Button.tsx apps/desktop/tests/ui-primitives.test.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): add Button primitive on existing btn classes"
```

---

### Task 6: Settings primitives

**Files:**
- Create: `apps/desktop/src/components/ui/SettingsSection.tsx`
- Create: `apps/desktop/src/components/ui/SettingsRow.tsx`
- Modify: `apps/desktop/tests/ui-primitives.test.ts`
- Modify: `apps/desktop/src/styles/global.css` (`.ui-list-row__label` / `__desc` to `--foreground` / `--muted-foreground`)

**Interfaces:**
- Consumes: existing `settings-panel__*` / `settings-card*` classes
- Produces:

```ts
export function SettingsSection(props: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  banner?: React.ReactNode;
  contentClassName?: string; // default "settings-card"
  children: React.ReactNode;
}): JSX.Element;

export function SettingsRow(props: {
  label: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element;
```

- [ ] **Step 1: Extend the failing tests**

Append to `apps/desktop/tests/ui-primitives.test.ts`:

```ts
describe("settings primitives source", () => {
  it("SettingsSection uses existing heading and card classes", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src/components/ui/SettingsSection.tsx"),
      "utf8",
    );
    assert.match(src, /settings-panel__heading/);
    assert.match(src, /settings-panel__title/);
    assert.match(src, /settings-card/);
    assert.match(src, /contentClassName/);
    assert.match(src, /banner/);
  });

  it("SettingsRow is not a button", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src/components/ui/SettingsRow.tsx"),
      "utf8",
    );
    assert.match(src, /settings-card__row/);
    assert.match(src, /settings-card__label/);
    assert.equal(/<button/.test(src), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/ui-primitives.test.ts
```

Expected: FAIL — files missing.

- [ ] **Step 3: Implement primitives**

`apps/desktop/src/components/ui/SettingsSection.tsx`:

```tsx
import type { ReactNode } from "react";

export function SettingsSection({
  icon,
  title,
  subtitle,
  banner,
  contentClassName = "settings-card",
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  banner?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="settings-panel__heading">
        <div className="settings-panel__icon">{icon}</div>
        <div>
          <h2 className="settings-panel__title">{title}</h2>
          {subtitle ? <p className="settings-panel__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {banner}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
```

`apps/desktop/src/components/ui/SettingsRow.tsx`:

```tsx
import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  action,
  className = "",
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["settings-card__row", className].filter(Boolean).join(" ")}>
      <div className="settings-card__copy">
        <div className="settings-card__label">{label}</div>
        {description ? <p className="settings-card__desc">{description}</p> : null}
      </div>
      {action ? <div className="settings-card__control">{action}</div> : null}
    </div>
  );
}
```

In `global.css` change:

```css
.ui-list-row__label {
  font-size: 0.8125rem;
  color: var(--foreground);
}

.ui-list-row__desc {
  font-size: 0.6875rem;
  color: var(--muted-foreground);
}
```

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/ui-primitives.test.ts tests/design-system-tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/ui/SettingsSection.tsx apps/desktop/src/components/ui/SettingsRow.tsx apps/desktop/tests/ui-primitives.test.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): add SettingsSection and SettingsRow primitives"
```

---

### Task 7: Migrate settings views onto primitives

**Files:**
- Modify: `apps/desktop/src/components/settings/SettingsAppearance.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsVault.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsHermes.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsAbout.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsDomains.tsx`
- Modify: `apps/desktop/tests/settings-shell.test.ts`

**Interfaces:**
- Consumes: `SettingsSection`, `SettingsRow`, `Button` from Task 5–6
- Produces: settings views with no raw `settings-panel__heading` markup and no `className="btn` in those five files

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/tests/settings-shell.test.ts`:

```ts
describe("settings primitives migration", () => {
  const files = [
    "src/components/settings/SettingsAppearance.tsx",
    "src/components/settings/SettingsVault.tsx",
    "src/components/settings/SettingsHermes.tsx",
    "src/components/settings/SettingsAbout.tsx",
    "src/components/settings/SettingsDomains.tsx",
  ];

  it("uses SettingsSection in every settings view", () => {
    for (const file of files) {
      const src = read(file);
      assert.match(src, /SettingsSection/, file);
      assert.equal(src.includes("settings-panel__heading"), false, file);
    }
  });

  it("replaces raw btn classes with Button", () => {
    for (const file of files) {
      const src = read(file);
      assert.equal(src.includes('className="btn'), false, file);
    }
    const hermes = read("src/components/settings/SettingsHermes.tsx");
    assert.match(hermes, /from ["']@\/components\/ui\/Button["']/);
    assert.match(hermes, /variant=["']primary["']/);
    assert.match(hermes, /destructive/);
    const appearance = read("src/components/settings/SettingsAppearance.tsx");
    assert.match(appearance, /SettingsRow/);
  });
});
```

Keep the existing "about me copy" test — after migration it still reads `SettingsAbout.tsx` for the lifestyle-context sentence.

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/settings-shell.test.ts
```

Expected: FAIL — heading markup still present.

- [ ] **Step 3: Migrate each view**

`SettingsAppearance.tsx` return:

```tsx
  return (
    <SettingsSection
      icon={<Palette size={16} />}
      title="Appearance"
      subtitle="Color mode and themes"
    >
      <SettingsRow
        className="settings-card__row--theme"
        label="Theme"
        description="Pick a built-in skin. System shows themes with both day and night palettes; Light and Dark show only matching skins."
        action={
          <SegmentedControl
            value={preference}
            options={THEME_OPTIONS}
            ariaLabel="Color mode"
            onChange={setPreference}
          />
        }
      />
      <SkinPicker />
    </SettingsSection>
  );
```

`SettingsVault.tsx`: wrap the existing `dl` in `SettingsSection` with `icon={<Building2 size={16} />}` title `Vault` subtitle `Identity and location on disk`. Do not force `dl` into rows.

`SettingsHermes.tsx`: wrap with `SettingsSection` (`Sparkles`, `Hermes`, `Local BYOK gateway connection`). Put the error/message paragraphs in `banner`. Keep `.settings-field` inputs. Replace the four action buttons:

```tsx
<Button type="submit" variant="primary" disabled={savingSettings}>
  {savingSettings ? "Saving…" : "Save base URL"}
</Button>
<Button
  type="button"
  variant="primary"
  disabled={savingKey || !apiKeyDraft.trim()}
  onClick={() => void onSetKey()}
>
  {savingKey ? "…" : hasKey ? "Replace key" : "Store key"}
</Button>
{hasKey ? (
  <Button type="button" destructive disabled={savingKey} onClick={() => void onClearKey()}>
    Clear key
  </Button>
) : null}
<Button type="button" disabled={testing} onClick={() => void onTest()}>
  {testing ? "Testing…" : "Test connection"}
</Button>
```

`SettingsAbout.tsx`: `SettingsSection` with `icon={<User size={16} />}` (import `User` from lucide-react), title `About me`, subtitle `Agents treat this as lifestyle context, not a command surface.` Card children: the textarea field + `Button variant="primary"` Save. Remove the duplicate `h3` / hint if they duplicate the section heading.

`SettingsDomains.tsx`: wrap with `SettingsSection` (`Layers`, `Domains`, subtitle `Activate a domain to filter the app. Overview shows everything.`, `contentClassName="domains-manager"`). Drop the extra inner `domains-manager` wrapper so the section content div is the manager. Replace every `className="btn …"` with `Button` (`primary` / `outline` / `destructive`). Leave domain-card layout otherwise unchanged.

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/settings-shell.test.ts tests/ui-primitives.test.ts tests/design-system-tokens.test.ts
```

Expected: PASS. Also `npm run typecheck` from `apps/desktop`.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/settings apps/desktop/tests/settings-shell.test.ts
git commit -m "feat(desktop): migrate settings views onto design primitives"
```

---

### Task 8: Constitution and agent docs

**Files:**
- Create: `PRODUCT.md`, `DESIGN.md`, `LAWS/README.md`, `LAWS/IDENTITY.md`, `LAWS/SECRETS.md`, `LAWS/DOMAIN-FILTER.md`, `LAWS/WINGS.md`, `LAWS/DOCTRINE.md`, `apps/desktop/src/components/ui/AGENTS.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md` (status → Approved)
- Create: `apps/desktop/tests/constitution.test.ts` (repo root is `path.resolve(testsDir, "..", "..", "..")` from `apps/desktop/tests`)

**Interfaces:**
- Consumes: spec sections 3.4
- Produces: the files above with the required headings/laws

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/constitution.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("product constitution", () => {
  it("has PRODUCT.md with purpose and anti-references", () => {
    const src = read("PRODUCT.md");
    assert.match(src, /## Users/);
    assert.match(src, /## Product Purpose/);
    assert.match(src, /## Anti-references/);
    assert.match(src, /chatbot wrapper/);
  });

  it("has DESIGN.md with token collisions and Phase 2 do-not-do", () => {
    const src = read("DESIGN.md");
    assert.match(src, /Grounded life studio/);
    assert.match(src, /--accent-fill/);
    assert.match(src, /--muted-surface/);
    assert.match(src, /Phase 2/);
    assert.match(src, /rounded-full/);
  });

  it("has RFC-style laws", () => {
    const readme = read("LAWS/README.md");
    assert.match(readme, /MUST/);
    assert.match(read("LAWS/IDENTITY.md"), /MUST NOT require an account/);
    assert.match(read("LAWS/SECRETS.md"), /MUST NOT be stored in the vault/);
    assert.match(read("LAWS/DOMAIN-FILTER.md"), /domain switcher MUST/);
    assert.match(read("LAWS/WINGS.md"), /MUST NOT filter/);
    assert.match(read("LAWS/DOCTRINE.md"), /MUST NOT be edited in place/);
  });

  it("documents shared UI rules", () => {
    const src = read("apps/desktop/src/components/ui/AGENTS.md");
    assert.match(src, /Button/);
    assert.match(src, /hex/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/constitution.test.ts
```

Expected: FAIL — `PRODUCT.md` missing.

- [ ] **Step 3: Write the documents**

`PRODUCT.md`:

```md
# Product

## Users

LifeQuest is for one person running a local vault on their desktop: organizing life into Domains, forging Why → What → How, reviewing Decisions, keeping a Life log, and optionally talking to Hermes agents.

## Product Purpose

A local-first life-management studio. Opening a vault is identity. Doctrine, decisions, log, and roster live as files on disk. Success is trusting the app as the daily surface for direction, planning, and doing without an account or a cloud copy of the vault.

## Brand Personality

Focused, capable, companionable. Calm enough for daily use; not cryptic; not a toy.

## Anti-references

Do not make LifeQuest feel like a generic chatbot wrapper, a dark terminal skin, a dashboard stuffed with metrics, a marketing site wearing product chrome, a habit-tracker scoreboard, or a game HUD. Avoid novelty-first AI visuals, oversized decorative cards, and vague assistant-magic copy.

## Design Principles

Make context legible: domain, wing, room, and vault should be obvious.

Keep the work surface quiet. Chrome is useful, dense, and calm.

Treat settings, skins, and Hermes as part of the workflow, not admin leftovers.

Show operational truth plainly: connection failures, empty vaults, locked rooms, stale files.

Design for continuity: the vault on disk is the source of truth.
```

`DESIGN.md` (required sections, keep tight):

```md
# Design System: LifeQuest

Creative North Star: **Grounded life studio**.

This file is the contract for tokens and primitives. It is not a license to restyle toward BERD’s gray workbench. Phase 2 owns selected visual elements.

## Token layers

Primitives (hex in `tokens.css` and skin palettes) → semantic CSS variables → Life Quest extensions. Legacy `--bg`, `--text`, `--accent`, `--muted` are aliases only.

`--accent` is brand (`var(--primary)`). Hover fill is `--accent-fill`. `--muted` is text (`var(--muted-foreground)`). Quiet fill is `--muted-surface`.

Skins write semantic and extension names onto `<html>`. They must not inline alias names.

ThemeProvider may apply a named skin and light/dark/system. It must not generate a palette from one primary hex.

## Named rules

- Token Contract — new UI uses semantic names.
- State Color — red/green/blue/amber mean state, not decoration.
- Theme Provider — named skins fill the contract.
- Raw Color — hex only in primitives and palettes.
- Closed Primitive — extend `Button` / settings primitives; do not restyle in features.
- Flat First / Calm Scale — recorded for Phase 2; do not change elevation or type scale here.

## Primitives

`Button`: `primary` | `outline` | `ghost`, plus `destructive` (maps to `.btn-danger`). 8px radius. Links via `to`. No Radix.

`SettingsSection` / `SettingsRow` own settings heading and row chrome.

## Phase 2 do-not-do

Do not add canvas/glass/dot-grid, 6px concentric radii, `rounded-full` buttons, Inter/Geist as default UI fonts, a pill composer, or reclaim `--accent` as hover in this phase.
```

`LAWS/README.md`:

```md
# Architectural laws

Laws define required product behavior, independent of implementation.

The key words **MUST** and **MUST NOT** are RFC 2119 when they appear in all capitals.

- Laws MUST describe observable product or UX behavior, not implementation details.
- Each law MUST state one requirement.
- Code and tests MUST conform to the laws.
- Token naming and CSS architecture MUST NOT be written as laws.
```

One requirement per file:

`LAWS/IDENTITY.md`: `Opening a vault MUST be identity. The product MUST NOT require an account to use a vault.`

`LAWS/SECRETS.md`: `API keys MUST NOT be stored in the vault.`

`LAWS/DOMAIN-FILTER.md`: `The domain switcher MUST be the data filter for domain-scoped lists.`

`LAWS/WINGS.md`: `Wings MUST NOT filter Home, Life Map, Log, tasks, or any page's data.`

`LAWS/DOCTRINE.md`: `Forged doctrine MUST NOT be edited in place. Changes MUST go through Decisions.`

`apps/desktop/src/components/ui/AGENTS.md`:

```md
# Shared UI

Prefer primitives in this folder over custom markup.

- Use `Button` for clickable controls in new or migrated surfaces. Variants: `primary`, `outline`, `ghost`. Danger is `destructive`, not a new color class.
- Do not pass `bg-*`, `color`, or hover classes into `Button`. Layout classes are fine.
- Use `SettingsSection` and `SettingsRow` for settings views.
- No raw hex, `rgb()`, or `hsl()` in this folder. Tokens live in `tokens.css` and skin palettes.
```

Add constitution rows to the README Design table:

```md
| [PRODUCT.md](PRODUCT.md) | Users, purpose, anti-references |
| [DESIGN.md](DESIGN.md) | Token contract and primitives |
| [LAWS/](LAWS/) | Observable product invariants |
| [BERD systems phase 1](docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md) | CSS-native design contract |
```

Set the spec status line to `Approved — implementation plan at docs/superpowers/plans/2026-09-02-berd-systems-phase-1.md`.

- [ ] **Step 4: Run tests**

```
node --experimental-strip-types --test tests/constitution.test.ts tests/design-system-tokens.test.ts
```

From `apps/desktop`: `npm test` and `npm run typecheck`.

Expected: PASS

- [ ] **Step 5: Commit**

```
git add PRODUCT.md DESIGN.md LAWS apps/desktop/src/components/ui/AGENTS.md README.md docs/superpowers/specs/2026-09-02-berd-systems-phase-1-design.md apps/desktop/tests/constitution.test.ts
git commit -m "docs: add PRODUCT, DESIGN, and LAWS constitution"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Token layers + aliases + collisions | 1 |
| Skin writer semantic-only; clearSkinVars; Forge accent ≠ primary | 2 |
| Default skin / dual-palette tests under `tests/` | 2 (`theme.test.ts`) |
| Titlebar `--background` / `--foreground` | 3 |
| Scanner + no hex in `components/ui` | 4, 5 |
| Button + `.btn` compatibility + no Radix + no filled danger | 5 |
| SettingsSection / SettingsRow | 6 |
| Settings views migrated; leftover `.btn` elsewhere untouched | 7 |
| PRODUCT / DESIGN / LAWS / AGENTS.md / README | 8 |
| No Tailwind, PageShell, Phase 2 visuals | Global constraints |

`--accent-fill` regex in Task 2 matches `color-mix(..., #0000ff 16%, ...)`.
