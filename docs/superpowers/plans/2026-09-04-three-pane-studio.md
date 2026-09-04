# Three-pane studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the one-sheet studio into three 12px paper cards (rail, main, chat) on a 12px mat, without new layout components.

**Architecture:** Keep `AppShell`’s three-column grid. `--shell-frame` is 12px for both `.app-root__body` padding and `.shell` gap. `.shell` is a transparent tray. `.nav-rail`, `.shell__main`, and `.chat-panel` each paint `--card` at `--radius-sm`.

**Tech Stack:** Electron + Vite + React 19, CSS custom properties, `node:test` + `--experimental-strip-types`. No Tailwind, no new React primitives.

**Spec:** `docs/superpowers/specs/2026-09-04-three-pane-studio-design.md`

## Global Constraints

- Do **not** add Tailwind, CVA, shadcn, Radix Slot, or an in-app design explorer
- Do **not** add `PageShell`, `PageHeader`, `StudioPane`, or `max-w-5xl`
- Do **not** add `card-glass`, `--backdrop-panel`, dot-grid, or glass top bar / nav
- Do **not** change default UI fonts to Inter / Geist Mono
- Do **not** reclaim `--accent` as hover; `--accent` aliases `--primary`
- Do **not** make `--muted` a surface; `--muted` aliases `--muted-foreground`
- Do **not** inset the titlebar; it stays flush and paints `--canvas-base`
- Do **not** migrate leftover `className="btn"` off `.btn`
- Do **not** delete `--radius-lg` from `tokens.css`
- Do **not** change `AppShell.tsx` DOM (no extra wrappers)
- Desktop tests: `node --experimental-strip-types --test` under `apps/desktop/tests/`
- Commit only files from the current task; leave unrelated dirty files unstaged
- Work in a git worktree; do not implement on `master`

---

## File Structure

```
apps/desktop/
  src/styles/tokens.css                 # --shell-frame: 12px
  src/styles/global.css                 # tray + three pane cards; welcome/settings radius
  tests/tokens.test.ts
  tests/shell-visuals.test.ts
  tests/constitution.test.ts
  src/components/ui/AGENTS.md

DESIGN.md
README.md
docs/superpowers/specs/2026-09-04-three-pane-studio-design.md  # status → Approved
```

No Electron main, no AppShell.tsx, no map.css bleed changes.

---

### Task 1: `--shell-frame` 12px

**Files:**
- Modify: `apps/desktop/tests/tokens.test.ts`
- Modify: `apps/desktop/src/styles/tokens.css`

**Interfaces:**
- Consumes: existing `--shell-frame` (20px) used as `.app-root__body` padding
- Produces: `--shell-frame: 12px` in `:root`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/tokens.test.ts`, in `"defines concentric radii and the shell frame"`, change:

```ts
    assert.match(css, /--shell-frame:\s*20px/);
```

to:

```ts
    assert.match(css, /--shell-frame:\s*12px/);
```

Leave the radius assertions (`6 / 12 / 12 / 18 / 24 / pill`) unchanged.

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: FAIL — `--shell-frame` is still `20px`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/styles/tokens.css` `:root`, change `--shell-frame: 20px;` to `--shell-frame: 12px;`. Do not copy it into dark blocks. Do not change radius tokens.

- [ ] **Step 4: Run test to verify it passes**

```
node --experimental-strip-types --test tests/tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/tokens.test.ts apps/desktop/src/styles/tokens.css
git commit -m "feat(desktop): tighten shell-frame to 12px"
```

---

### Task 2: Three pane cards

**Files:**
- Modify: `apps/desktop/tests/shell-visuals.test.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: `--shell-frame` 12px from Task 1; `--radius-sm`; `--card`
- Produces: `.shell` as a gapped tray; `.nav-rail`, `.shell__main`, `.chat-panel` as 12px cards; `.welcome` and `.settings-card` at `--radius-sm`

- [ ] **Step 1: Write the failing test**

Replace `"paints the window as canvas and the studio as a sheet"` in `apps/desktop/tests/shell-visuals.test.ts` with:

```ts
  it("paints three studio panes on a gapped canvas tray", () => {
    const css = readCss();
    assert.match(css, /body\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root\s*\{[\s\S]*?background:\s*var\(--canvas-base\)/);
    assert.match(css, /\.app-root__body\s*\{[\s\S]*?padding:\s*var\(--shell-frame\)/);
    assert.match(css, /\.shell\s*\{[\s\S]*?gap:\s*var\(--shell-frame\)/);
    assert.equal(/\.shell\s*\{[^}]*background:\s*var\(--card\)/.test(css), false);
    assert.equal(/\.shell\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/.test(css), false);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.nav-rail\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.shell__main\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.shell__main\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?background:\s*var\(--card\)/);
    assert.match(css, /\.chat-panel\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
  });
```

In `"pills buttons and uses the concentric scale on shared chrome"`, change:

```ts
    assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-md\)/);
```

to:

```ts
    assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
```

In `"lets Welcome scroll long content inside the sheet"`, change `--radius-lg` to `--radius-sm`:

```ts
    assert.match(css, /\.welcome\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
```

Keep the titlebar, boot-status, Map bleed, pill, and Welcome `overflow: hidden` absent assertions.

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/shell-visuals.test.ts
```

Expected: FAIL — `.shell` still has `--card` / `--radius-lg`; panes are not 12px cards.

- [ ] **Step 3: Write minimal implementation**

Replace the `.shell` rule in `apps/desktop/src/styles/global.css` with:

```css
.shell {
  display: grid;
  grid-template-columns: var(--shell-nav-width) 1fr var(--chatbar-width);
  height: 100%;
  color: var(--fg);
  gap: var(--shell-frame);
}
```

Keep `.shell--chat-collapsed` as:

```css
.shell--chat-collapsed {
  grid-template-columns: var(--shell-nav-width) 1fr 2.75rem;
}
```

Replace `.shell__main` with:

```css
.shell__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: var(--card);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}
```

On `.nav-rail`:

- Remove `border-right: 1px solid var(--sidebar-border, var(--border));`
- Change `background: var(--bg-panel, var(--bg));` to `background: var(--card);`
- Add `border-radius: var(--radius-sm);`, `border: 1px solid var(--border);`, `box-shadow: var(--shadow-sm);`
- Keep `overflow-y: auto`, `overflow-x: hidden`, flex layout, padding, sticky.

On `.chat-panel`:

- Remove `border-left: 1px solid var(--border);`
- Change `background: var(--bg);` to `background: var(--card);`
- Add `border-radius: var(--radius-sm);`, `border: 1px solid var(--border);`, `box-shadow: var(--shadow-sm);`
- Keep `overflow: hidden` (already present).

`.welcome`: change `border-radius: var(--radius-lg);` to `border-radius: var(--radius-sm);`. Keep fill, border, shadow, `overflow: auto`.

`.settings-card`: change `border-radius: var(--radius-md);` to `border-radius: var(--radius-sm);`.

Do not edit `AppShell.tsx`. Do not edit `map.css`. Do not put `overflow: hidden` back on `.shell`.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/shell-visuals.test.ts tests/window-chrome.test.ts tests/wing-shell.test.ts tests/tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/desktop/tests/shell-visuals.test.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): split studio into three 12px panes"
```

---

### Task 3: Constitution

**Files:**
- Modify: `DESIGN.md`
- Modify: `apps/desktop/src/components/ui/AGENTS.md`
- Modify: `apps/desktop/tests/constitution.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-04-three-pane-studio-design.md`

**Interfaces:**
- Consumes: shipped three-pane CSS from Task 2
- Produces: DESIGN.md / AGENTS.md describe three 12px cards; spec status Approved

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/constitution.test.ts`, in `"has DESIGN.md with canvas ladder and remaining Phase 2 do-not-do"`, add:

```ts
    assert.match(src, /--shell-frame/);
    assert.match(src, /\.nav-rail/);
    assert.match(src, /\.chat-panel/);
```

In `"documents shared UI rules"`, add:

```ts
    assert.match(src, /pane/);
```

- [ ] **Step 2: Run test to verify it fails**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/constitution.test.ts
```

Expected: FAIL — DESIGN.md has no `--shell-frame` / pane selectors.

- [ ] **Step 3: Write the docs**

In `DESIGN.md`:

- Replace “`--card` is the studio sheet” with “`--card` is paper for the three studio panes and Welcome.”
- Replace “The studio sheet is `.shell` / `.welcome` CSS, not a primitive.” with:

```md
The studio is three `--card` panes (`.nav-rail`, `.shell__main`, `.chat-panel`) at `--radius-sm` on a `--shell-frame` (12px) canvas mat. `.shell` is the grid tray, not a sheet. Welcome is one card at the same radius. Feature files must not add a second frame.
```

- Change “Settings cards use `--radius-md`.” to “Settings cards use `--radius-sm`.”

Replace the studio-sheet bullet in `apps/desktop/src/components/ui/AGENTS.md` with:

```md
- The studio is three panes (`.nav-rail`, `.shell__main`, `.chat-panel`) plus Welcome. `.shell` is only the grid. Feature files must not wrap a second canvas frame around a pane.
```

In `README.md` Design table, after the Phase 2 row, add:

```md
| [Three-pane studio](docs/superpowers/specs/2026-09-04-three-pane-studio-design.md) | Rail, main, and chat as separate 12px cards |
```

Set the spec status line to:

```md
**Status:** Approved — implementation plan at docs/superpowers/plans/2026-09-04-three-pane-studio.md
```

- [ ] **Step 4: Run tests**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/constitution.test.ts tests/shell-visuals.test.ts tests/tokens.test.ts tests/window-chrome.test.ts
npm test
npm run typecheck
```

Expected: constitution + visual tests PASS. `npm test` 89/89 (or only pre-existing failures — there should be none after the hygiene merge). Typecheck exit 0.

- [ ] **Step 5: Commit**

```
git add DESIGN.md apps/desktop/src/components/ui/AGENTS.md apps/desktop/tests/constitution.test.ts README.md docs/superpowers/specs/2026-09-04-three-pane-studio-design.md
git commit -m "docs: record three-pane studio contract"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| `--shell-frame: 12px` mat and gap | 1, 2 |
| Three `--card` panes at `--radius-sm` | 2 |
| `.shell` tray: no fill/radius/border/shadow; has gap | 2 |
| Drop rail `border-right` / chat `border-left` | 2 |
| Collapsed chat still third column | 2 (CSS template unchanged) |
| Welcome one card at 12px | 2 |
| Settings cards `--radius-sm` | 2 |
| No AppShell DOM change; no PageShell | Global + Task 2 |
| Map bleed unchanged | Task 2 does not touch map.css / AppShell |
| Titlebar unchanged | Task 2 does not touch titlebar |
| DESIGN.md / AGENTS.md | 3 |
| Keep `--radius-lg` token | Task 1 does not delete it |
