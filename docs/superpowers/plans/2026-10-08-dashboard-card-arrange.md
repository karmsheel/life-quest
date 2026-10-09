# Dashboard Card Arrange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard's `↑` / `↓` card nudges with hold-to-lift drag reordering, and replace every text glyph in the card chrome with the standard icon for the job.

**Architecture:** The board's order is already its layout, so nothing persisted changes. A controller hook on the grid takes a delegated `pointerdown`, arms either on the grip (4 px) or on a hold (220 ms, cancelled by 8 px of movement), lifts the card by taking it out of grid flow as an absolutely positioned child of the grid, and lets the grid's own reflow show the drop: the rendered order **is** the preview order, so the gap the operator sees is where the card lands. The resolver is one function, `insertionIndex(rects, point)`. A drop makes exactly one `pinsSet` call, through the page's existing `persistPins`, so the lock gate and the "one write path" rule stay where they are.

**Tech Stack:** React 19, TypeScript, CSS Grid, Pointer Events, `lucide-react` 0.511.0 (already a dependency), Electron `webContents.sendInputEvent` for input in the rig, `node:test` as the rig wrapper.

**Spec:** `docs/superpowers/specs/2026-10-08-dashboard-card-arrange-design.md`. When this plan and the spec disagree on behavior, follow the spec.

## Global Constraints

- The repo's standing rule is E2E as the sole testing mechanism. **Do not add a unit test**, a `node:test` file that imports `pin-order.ts` or the hook, or a second harness page. `pin-order.ts` is exercised through the real page in the rig, like every other module in this repo.
- **No new dependency.** `lucide-react@0.511.0` is already a devDependency of `apps/desktop` and already draws the app's chrome icons.
- **No `packages/vault-core/` change and no schema change.** `Pin`, `PinBoard`, `schemaVersion: 1`, `setPins`, and `setPinBoardLocked` are all untouched.
- Constants, and they are exact: hold **220 ms**, movement-cancel **8 px**, grip activation **4 px**, FLIP duration **160 ms**, auto-scroll edge band **56 px**, auto-scroll maximum **14 px per frame**.
- Icons, and they are exact: `PinOff` (unpin), `GripVertical` (move), `Maximize2` / `Minimize2` (width). Every chrome button is icon-only — one `<svg>`, no text node.
- Class hooks that MUST survive, because two existing rigs count them: `.home-pin__chrome`, `.home-pin__btn`, `.home-pin`, `.home-dashboard__grid`, `.home-pin--span2`. New hooks: `data-pin-id` on the card wrapper, `data-testid` `pin-grip` / `pin-span` / `pin-unpin` on the buttons.
- The controller MUST NOT call the bridge itself. Its only write is the page's `persistPins`, so `dashboard-lock-ui`'s "no unexpected bridge call" claim keeps holding.
- A locked board renders no chrome and attaches no arrange listener. The lock remains the only gate (LAW).
- Primary button only. Ignore right-click, middle-click, and any modifier.
- The rig drives input with `webContents.sendInputEvent` (real mouse and key events), never with a synthesized `dispatchEvent(new PointerEvent(…))`. The claims are about activation timing, hit-testing, and pointer capture, and only real input proves those. If this Electron build turns out not to synthesize `pointerdown` / `pointermove` from `sendInputEvent`, switch the same helper bodies to CDP `Input.dispatchMouseEvent` through `win.webContents.debugger.attach("1.3")` — the same browser input pipeline, so the claims survive — and say so in the rig's doc comment. Do not fall back to `dispatchEvent`.
- The rig renders the real `HomePage` behind the recording bridge stub, on a board of exactly seven pins in this order, so every order assertion is an exact array:
  `sys:goal-progress` · `view:financial:v-weekly` (span 1) · `page:financial:ledger` · `sys:today-week` · `view:financial:v-summary` (span 2) · `sys:pending-decisions` · `sys:recent-log`.
- The rig applies the app's own skin before its first render (`e2e/apply-app-skin.ts`), exposes it as `window.dashboardArrangeSkin`, and the driver fails the run if `document.documentElement.dataset.skin` disagrees.
- The rig writes `e2e/artifacts/dashboard-arrange.json`, `dashboard-arrange.png` (the resting board, chrome visible), and `dashboard-arrange-lift.png` (mid-drag, one card lifted). `apps/desktop/e2e/artifacts/` is gitignored — never `git add` an artifact.
- The rig's doc comment names the seam it cannot cross: a dev-server page has no preload, so the page's bridge is a stub and the drop's `pinsSet` ends there. The vault-core half of a write is `dashboard-lock-e2e`'s, and the wired-app half is `dashboard-live-app`'s.
- Focused loop, with `npm run dev` up: from `apps/desktop`, run the rig **under Electron**, never under plain node — it is an Electron main script, and `node` dies on `import { BrowserWindow } from "electron"`. This host also exports `ELECTRON_RUN_AS_NODE`, which makes the same command run as plain node, so clear it first:

  ```powershell
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & (node -p "require('electron')") e2e/dashboard-arrange.electron.mjs
  ```

  Every "run the rig" step below means exactly that command. Full proof: from the repo root, `npm test`. That script ignores extra argv and runs every rig, so do not pass it a file path.
- The harness's scrollport is the window's height (`calc(100vh - 2rem)`) at a fixed 1000 px width, and the driver sizes the window to the claim: tall (1280×1200) for the board's own claims, so a drag can start on one card and end on another, and short for the auto-scroll claim, so the board actually overflows its box. The width is fixed because the column count is what makes a row claim mean anything.
- The driver disables background throttling (`webPreferences.backgroundThrottling: false`). The lift is a real 220 ms timer, and this rig runs beside every other Electron window in the suite; Chromium throttles timers and stops painting in an occluded window, which is exactly what a background rig is. Without it, "hold a card and it lifts" is really "hold a card and it lifts if this window happens to be in front" — the first suite run of this rig failed on precisely that, and on `capturePage` throwing `UnknownVizError` for want of a painted frame.
- The working tree this plan was written against carried uncommitted work (`view-card`, `receipt-attach`). Before starting, check `git status`: if it is dirty, do not disturb it — branch, stage only this feature's paths, and never `git stash` or `git checkout --` a path this plan does not own. If it is clean, branch off `master` and carry on.
- The wrapper follows its siblings: probe `127.0.0.1:5173`, and `t.skip("dev server not listening on 5173 — run \`npm run dev\` to include this e2e")` when it is down; `fs.rmSync` the report first; `execFile(electron, [...], { cwd: desktopRoot, timeout: 120_000 })`; then assert the report exists, `report.pass` is true, `failures` is `[]`, the exit code is 0, and every scenario name this plan adds is present with `pass: true`.
- The driver follows its siblings: `nativeTheme.themeSource = "dark"`, `show: false` then `win.showInactive()` before any input is dispatched (a hidden window can swallow input), a 90 s timeout that exits 1, `app.exit(report.pass ? 0 : 1)`, and a printed summary line.
- Spec and plan land as their own commit before Task 1. Do not edit `LAWS`, `README`, `PRODUCT`, or `VISION` except in Task 7, and keep them out of the feature commits.
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`. Do not merge or push.

---

### Task 1: The arrange rig, and the card chrome in standard icons

**Files:**
- Create: `apps/desktop/e2e/dashboard-arrange.html`
- Create: `apps/desktop/e2e/dashboard-arrange.tsx`
- Create: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Create: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`
- Create: `apps/desktop/src/components/home/PinChrome.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: `HomePage`, `VaultProvider`, `applyAppSkin`, `Pin`, `PinBoardRead`, `PageListEntry`, `SavedView`, `VaultSnapshot`
- Produces:
  - `window` hooks for the driver: `dashboardArrangeReady`, `dashboardArrangeCommits`, `dashboardArrangeCalls`, `dashboardArrangeUnexpectedCalls`, `dashboardArrangeSkin`, `dashboardArrangeState`, `dashboardArrangeSetBoard(pins, locked)`, `dashboardArrangeSetRefuse(boolean)`, `dashboardArrangeRender(generation)`, `dashboardArrangePinWrites`
  - `export function PinChrome(props: { pin: Pin; busy: boolean; onUnpin: () => void; onCycleSpan: () => void }): JSX.Element` in `components/home/PinChrome.tsx`
  - The card wrapper carries `data-pin-id={pin.id}`

- [ ] **Step 1: Write the harness page**

Create `apps/desktop/e2e/dashboard-arrange.html` exactly like `dashboard-lock.html` (title "LifeQuest dashboard arrange harness", `#root`, module script). Create `apps/desktop/e2e/dashboard-arrange.tsx` from `dashboard-lock.tsx`'s shape, with these differences:

- `applyAppSkin("dark")` before the first render; expose `harness.dashboardArrangeSkin`.
- The seeded board is the seven pins from Global Constraints, in that order, `locked: false`.
- The grid sits in a fixed-height scrollport so auto-scroll is testable: render `HomePage` inside `<div className="arrange-scroll" style={{ height: 420, overflowY: "auto" }}>`, with the harness's page width making the grid resolve to **three** columns (measure it; the driver asserts `columns >= 2` so the row claim is never vacuous).
- Extend the bridge stub with everything the seven pins pull in, and nothing else: `pinsList`, `pinsSet`, `pinsSetLocked`, `pageList` (one `PageListEntry` for `financial/ledger`, title "Ledger"), `viewList` (the two saved views), `viewGet`, `viewRunSaved` (a small composed result per view, in the shape `e2e/view-card.tsx` fixtures use), plus the card-level reads the lock rig already lists (`vaultGetSnapshot`, `vaultListRecent`, `domainGetActive`, `decisionList`, `logList`, `kitList`, `deadlineGetDismissed`, `deadlineMaybeNotify`, `deadlineDismiss`, `goalsApply`, `onVaultFileChanged`). `ActiveAgentsCard` reads the snapshot and needs no call of its own. An unmodelled name is recorded in `dashboardArrangeUnexpectedCalls` and answered `{ ok: false }`.
- `pinsSet` records into `dashboardArrangePinWrites` and answers `{ ok: true, value: { applied: <refuse ? false : true>, pins, locked } }`, where `refuse` is what `dashboardArrangeSetRefuse` set. When it refuses, keep `state.pins` unchanged.
- `dashboardArrangeSetBoard(pins, locked)` + `dashboardArrangeRender(generation)` exactly as the lock rig's pair, so a driver can install a board and force a re-read.

- [ ] **Step 2: Write the driver's skeleton and the chrome-identity scenario**

Create `apps/desktop/e2e/dashboard-arrange.electron.mjs` with the standard shape. Add:

- A `dispatch` helper wrapping `win.webContents.sendInputEvent`, with `mouseDown(x, y)`, `mouseMove(x, y)`, `mouseUp(x, y)` (left button, `clickCount: 1`), and `key(keyCode)`.
- A `center(selector)` helper reading a `getBoundingClientRect` and returning the point in CSS pixels — `sendInputEvent` takes the same coordinate space, so no DPR conversion is applied.
- A `restingOrder()` reader: `[...document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]')].map((el) => el.dataset.pinId)`.
- A `columns()` reader: the number of tracks in the grid's resolved `grid-template-columns` (three at this width). Not a count of the cards sharing a row — a full-row card makes that read 1.

Scenario `chrome-identity`, which this task turns green, for every `.home-pin__chrome` on the board:

- every `.home-pin__btn` contains exactly one `svg` and its `textContent.trim()` is `""`,
- the grip's svg class list contains `lucide-grip-vertical`, the unpin's contains `lucide-pin-off`, and a view pin's width button contains `lucide-maximize-2` (span 1) or `lucide-minimize-2` (span 2),
- every button has a non-empty `aria-label` **and** `title`,
- `[...document.querySelectorAll('.home-pin__chrome')].map((el) => el.textContent).join('')` contains none of `✕ ↑ ↓ ◧ ♭`,
- the Add-pin section's heading contains an `svg` whose classes include `lucide-pin`.

Record `{ name, pass, detail }` per scenario, write the JSON report, capture `dashboard-arrange.png`, print the summary, and `app.exit(errors.length === 0 ? 0 : 1)`.

- [ ] **Step 3: Write the wrapper test**

Create `apps/desktop/tests/dashboard-arrange-e2e.test.ts` mirroring `dashboard-lock-ui-e2e.test.ts`: the dev-server probe with the skip message, `REPORT = e2e/artifacts/dashboard-arrange.json`, `runDriver()`, and one `it` that asserts the report exists, `failures` deep-equals `[]`, `pass` is true, the driver exited 0, and `["chrome-identity"]` are all present with `pass: true`. Later tasks extend both the scenario list and this array.

- [ ] **Step 4: Run the rig and confirm it fails**

Run the rig (Global Constraints), under Electron and with `ELECTRON_RUN_AS_NODE` cleared.

Expected: **FAIL** on `chrome-identity` — the chrome draws `✕`, `↑`, `↓`, `◧`, `♭` as text, so no button holds an `svg` and the glyph sweep finds characters.

- [ ] **Step 5: Implement the chrome**

Create `components/home/PinChrome.tsx`: the three buttons in the spec's order (move, width for view pins only, unpin), `lucide-react` icons at `size={14}` with `aria-hidden`, `aria-label` + `title` from the spec's table, `data-testid` `pin-grip` / `pin-span` / `pin-unpin`, and `disabled={busy}` on all three. It renders inside the existing `.home-pin__chrome` div, which stays where it is so both counting rigs keep working.

In `HomePage.tsx`:

- render `<PinChrome … />` in place of the four hand-written buttons for each pin, and delete `onMoveUp` / `onMoveDown` (the grip and the keyboard replace them in Tasks 2–5),
- add `data-pin-id={pin.id}` to the card wrapper (leave the wrapper's className logic exactly as it is, `home-pin--span2` included),
- give the Add-pin section's `<h2>` a `Pin` icon from `lucide-react` before its text.

In `global.css`, under the existing `.home-pin__btn` rules:

- `.home-pin__btn { position: relative; display: grid; place-items: center; }` and `.home-pin__btn svg { width: 0.9rem; height: 0.9rem; display: block; }`,
- `.home-pin__btn::after { content: ""; position: absolute; inset: -0.25rem; }` so the hit area is 2.05 rem while the visual box stays 1.55 rem,
- `.home-pin__grip { cursor: grab; }`,
- drop `.home-pin:has(.home-pin__chrome) .home-card__title,
  .home-pin:has(.home-pin__chrome) .home-dashboard__progress { padding-right: 5.2rem; }` to `5.6rem` and say in the comment that three buttons need what four used to,
- `.home-pin-add__row + .home-card__title`-style heading icon spacing if the `Pin` icon needs it — size it with `svg { width: 0.85rem; height: 0.85rem }` on the heading.

Optional in the same step: refresh the stale glyphs in `apps/desktop/data-preview.html` (an unreferenced static mock) so it does not document a chrome that no longer exists.

- [ ] **Step 6: Run the rig and the suite, and confirm both pass**

From `apps/desktop`: Run the rig (Global Constraints) → PASS on `chrome-identity`.

From the repo root: `npm test` → PASS, with the new describe green and `dashboard-lock-ui` / `dashboard-live-app` untouched and still green.

- [ ] **Step 7: Commit**

```powershell
git add -- apps/desktop/src/components/home/PinChrome.tsx apps/desktop/src/pages/HomePage.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/dashboard-arrange.html apps/desktop/e2e/dashboard-arrange.tsx apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): standard icons in the dashboard card chrome" -m "Unpin is PinOff, move is a GripVertical handle, width is Maximize2/Minimize2. The glyph buttons are gone; the new rig proves which lucide icon each control draws."
```

---

### Task 2: The lift — grip drag and hold-to-drag

**Files:**
- Create: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`

**Interfaces:**
- Consumes: the board's `pins`, `locked`, `moveBusy`
- Produces:
  - `export type ArrangePhase = "idle" | "armed" | "lifted"`
  - `export type CommitOutcome = "applied" | "locked" | "refused"`
  - `export function usePinArrange(input: { pins: Pin[]; locked: boolean; busy: boolean; labelOf: (pin: Pin) => string; onCommit: (next: Pin[]) => Promise<CommitOutcome> }): { gridRef: RefObject<HTMLDivElement | null>; gridHandlers: { onPointerDown: PointerEventHandler<HTMLDivElement> }; isLifted: (id: string) => boolean; isArranging: boolean; order: Pin[]; announce: string; cardProps: (id: string) => { "data-pin-id": string; className: string } }`
  - The hook registers `pointermove` / `pointerup` / `pointercancel` on the grid element through `setPointerCapture`, and `blur` on `window`

- [ ] **Step 1: Extend the failing rig**

Add these scenarios to the driver, each failing before the hook exists:

Presses go on the card's own `<h2>` heading — `.home-card__title` or `.view-card__title` — and never on the card's centre, because every home card ends in a link and a press on an interactive element is deliberately not a drag. The title is in every card, is never interactive, and is the card's own name.

- `short-press-is-not-a-drag`: mouseDown on `sys:today-week`'s heading, 80 ms, mouseUp → no `.is-lifted`, `dashboardArrangePinWrites` empty.
- `movement-cancels-the-hold`: mouseDown on `sys:today-week`'s heading, mouseMove +20 px at 60 ms, then hold 400 ms → no `.is-lifted`.
- `hold-lifts`: mouseDown on `sys:today-week`'s heading, 400 ms → that card has `.is-lifted` and the grid has `.is-arranging`.
- `grip-lifts-at-once`: mouseDown on `[data-testid="pin-grip"]` of `sys:pending-decisions`, mouseMove +6 px → that card lifted, with no hold.
- `press-on-a-link-is-not-a-drag`: mouseDown on the page card's "Open page →" link, 400 ms → no `.is-lifted` and no write. The control still gets its click.
- `lift-leaves-a-gap`: while `sys:goal-progress` is lifted, its computed `position` is `absolute`, and the board has closed up behind it: the card that followed it (`view:financial:v-weekly`) now sits at the lifted card's resting `top` and `left`. That card is full-row, so the whole first row is what closes — which is the strongest form of the claim.
- `locked-is-inert`: `dashboardArrangeSetBoard(<the seven pins>, true)`, re-render, then mouseDown + hold 400 ms on a card → no `.is-lifted`, no chrome, zero writes.

Add a `lift(mouseDown …, wait, …)` helper so the timing constants live in one place, and add these names to the wrapper's expected-scenario array.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all six (no `.is-lifted` ever appears).

- [ ] **Step 3: Implement the activation half of the controller**

Create `usePinArrange.ts` with the arming and lifting half only — no reordering yet:

- one delegated `onPointerDown` on the grid; `if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return`;
- `const card = (e.target as Element).closest<HTMLElement>("[data-pin-id]")`; return when there is none, when `locked`, when `pins.length < 2`, or when `busy`;
- return when the press is on an interactive element inside the card: `(e.target as Element).closest('a, input, select, textarea, [role="button"], button:not([data-pin-grip])')`;
- arm in `mode: "grip"` when `(e.target as Element).closest("[data-pin-grip]")` exists, else in `mode: "hold"` with a 220 ms timer;
- on `pointermove` while armed: `mode === "grip"` lifts once the pointer has moved 4 px; `mode === "hold"` cancels the timer once it has moved 8 px. Measure from the press point, never accumulated;
- on lift: `setPointerCapture(e.pointerId)` on the grid, record the grid rect and the card's resting rect, and set state to `lifted`;
- on `pointerup` / `pointercancel` / `Escape` / `window.blur` before the lift: disarm and clear the timer. In this task a lift that ends simply clears itself with no write.

The grip gets **no** `onClick`: a drag that starts and ends on it still fires a trailing click, and the grip's only other job is the keyboard path (Task 5). A click handler there would make a drop do a second, invisible thing.

In `HomePage.tsx`, wire the hook: `ref={arrange.gridRef}` and `{...arrange.gridHandlers}` on `.home-dashboard__grid`, `className={"home-dashboard__grid" + (arrange.isArranging ? " is-arranging" : "")}` not clobbering anything else, and each card's wrapper merged with `arrange.cardProps(pin.id)` (keep the existing `home-pin` / `home-pin--span2` className logic — the hook's `className` adds `is-lifted` to it).

In `global.css`:

```css
.home-dashboard__grid { position: relative; }
.home-dashboard__grid.is-arranging,
.home-dashboard__grid.is-arranging * { cursor: grabbing; }
.home-dashboard__grid.is-arranging { user-select: none; }
.home-pin.is-lifted {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  transform: scale(1.015);
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  box-shadow: var(--shadow-sm);
}
```

`outline`, not `border`: a border would change the box the lift is sitting in and would double the inner card's own hairline. `--shadow-sm` is the ceiling DESIGN.md sets for the sheet.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run the rig (Global Constraints) → PASS on the six new scenarios plus `chrome-identity`. From the repo root, `npm test` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/pages/HomePage.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): lift a dashboard card on a hold or the grip" -m "A delegated pointerdown arms on the grip (4px) or a 220ms hold (cancelled by 8px); the lifted card leaves grid flow and the board closes the gap."
```

---

### Task 3: The target slot, and one write per drop

**Files:**
- Create: `apps/desktop/src/components/home/pin-order.ts`
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`

**Interfaces:**
- Produces:
  - `export function movePin<T>(list: T[], from: number, to: number): T[]` — a new array, order preserved, `from` removed and reinserted at `to`
  - `export function insertionIndex(slots: Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>, point: { x: number; y: number }): number`
  - The hook's returned order: `order: Pin[]` — the preview order HomePage renders

- [ ] **Step 1: Extend the failing rig**

The block above is the shape the tasks were written to; it was checked against the board as built, and three things moved:

- `drop-past-the-last` became **`drop-on-the-agents-card`**: the board's only non-pinnable card is the natural "end of the pins", so dropping on it *is* the claim that the end is a real slot and that no pin lands after that card.
- `one-write-per-drop` is not its own scenario: every ordering scenario asserts its own write count and payload, because "one write" is only meaningful next to the order that write carried.
- `same-row-targets-by-x`, `drop-past-a-full-row-card` and `wide-card-left-and-right` (below) are the three that survived contact with the real board.

**Aim at the live board, not at the resting one.** Taking a card out of the flow changes the height of the row it was in, so every card below it moves up the moment the drag begins. A drop point measured before the lift is a point at a card that is no longer there — the first version of this rig aimed at resting coordinates and dropped the card on the wrong side of a full-row card. `dragCard` therefore takes a *function* that resolves the target after the board has reflowed, which is also what an operator does: they watch the board move, then put the card where the card now is. The rig records the order after each drop, so a resolver that gets this wrong fails on the exact id array rather than looking plausible.

Add these scenarios to the driver, each failing before the resolver exists:

- `same-row-targets-by-x`: assert `columns() === 3` first, so the claim cannot pass vacuously. Drag `view:financial:v-weekly` (index 1, first cell of the board's second row) to a point past the horizontal midpoint of `page:financial:ledger` (index 2, the cell beside it) but inside its row band, drop → order is `[goal-progress, ledger, v-weekly, …]`: the two swapped, and the card landed where it was aimed. Assert exactly one write, carrying that order.

  Note which cards a drag may target. `sys:goal-progress` (row 1), `sys:today-week` (row 3), `view:financial:v-summary` (row 4) and `sys:recent-log` (row 6) are all full-row cards — `home-card--wide` or a span-2 view — so the board's only side-by-side pair is `v-weekly` beside `ledger` in row 2. A claim about "the cell to the left" has to be made there, which is why the seeded order puts those two together.
- `drop-past-a-full-row-card`: drag `view:financial:v-weekly` past the horizontal midpoint of `sys:today-week`, the full-row card on the next row → it lands **after** `today-week` and before `v-summary`. A full-row card must not be an insertion dead zone, and this is the claim that the row band and the x midpoint are both doing work.
- `wide-card-left-and-right`: drag `sys:pending-decisions` onto the left half of the span-2 card (`view:financial:v-summary`) → it lands immediately **before** `v-summary` (one write); drag the same card onto the same half again → the order is unchanged and the write count does **not** move, which is the claim that a drop at the card's own index never reaches the vault; drag it onto the right half → immediately **after** `v-summary` (a second write).
- `drop-on-the-agents-card`: scroll the board to its end, then drag `sys:pending-decisions` onto the Active-agents card → it lands last **among the pins**, and that card is still the grid's last child. The board never places a pin after it.
- `hold-then-release-writes-nothing`: lift `view:financial:v-weekly` and release without moving → the resting order is untouched and the write log is empty.
- `grip-drags-and-writes-once`: the same reorder through the grip rather than the hold, asserting one write. The grip needs 6 px of movement before it lifts, so this also proves the grip path is armed on movement rather than on the press.

Add a `drag(fromSelector, toPoint)` helper: mouseDown on the source, 400 ms (or +6 px from the grip), mouseMove in **three** steps to the target so the slot resolver runs more than once, wait a frame, mouseUp, then wait for the write or a short settle. Add the scenario names to the wrapper's array.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL: the card lifts but never moves, and no write is recorded.

- [ ] **Step 3: Implement the resolver and the commit**

Create `pin-order.ts` with `movePin` and `insertionIndex` exactly as the spec's §3.3 pseudocode.

In the hook:

- keep a `preview: Pin[]` derived from `pins` and the lifted pin's index (`movePin(pins, from, to)`), recomputed on every pointermove from the **current DOM** rects of `[data-pin-id]` minus the lifted one (this is what makes the gap the visible truth rather than a prediction);
- position the lifted card each frame from **client** coordinates: `left = pointer.clientX - gridRect.left - grab.dx`, `top = pointer.clientY - gridRect.top - grab.dy`, `width`/`height` frozen from the resting rect (set as inline style);
- on `pointerup` after a lift: if `to === from`, clear the lift and write nothing; otherwise clear the lift and `await onCommit(preview)` — the only bridge call this feature makes, and the one `moveBusy` in HomePage already guards;
- map by pin id whenever `pins` changes mid-drag, and cancel the lift if the lifted id is gone.

In `HomePage.tsx`, render `arrange.order` instead of `pins`, and keep the `availableSystemKinds` / `availablePagePins` / `availableViewPins` computations reading `pins` (the vault's list), not the preview.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run the rig (Global Constraints) → PASS on all twelve scenarios, with `one-write-per-drop` green. From the repo root, `npm test` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/home/pin-order.ts apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/pages/HomePage.tsx apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): drop a dashboard card into the gap it belongs in" -m "The rendered order is the preview order, so the grid's own reflow shows the drop; insertionIndex decides by row band and x midpoint, and one drop is one pinsSet."
```

---

### Task 4: Cancel, refusal, and the status line

**Files:**
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`

**Interfaces:**
- Produces: `announce: string` from the hook, and the hook's `onCommit` is now awaited with the outcome known to it
- Produces: `.visually-hidden` in `global.css` if the app does not already have one (check first; reuse it if it does)

- [ ] **Step 1: Extend the failing rig**

Add:

- `escape-cancels`: start a drag, move card 1 to the end, press Escape before mouseUp → `restingOrder()` equals the pre-drag order and `dashboardArrangePinWrites` is empty.
- `blur-cancels`: start a drag, then dispatch a `blur` on the window (or `win.blur()`), then mouseUp → same result.
- `refusal-reverts`: `dashboardArrangeSetRefuse(true)`, drag card 1 to the end, drop → `restingOrder()` equals the pre-drag order, `dashboardArrangePinWrites.length` is 1, and the status element's text matches `/locked/i`.
- `refusal-is-announced`: with `refuse` on and a `pinsSet` that answers `{ ok: false, error: "boom" }` (a second flag), the status element's text matches `/could not save/i` and the order is unchanged.

Add a `status()` reader for `[data-testid="pin-arrange-status"]` and the scenario names to the wrapper's array.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all four.

- [ ] **Step 3: Implement revert and announcements**

In the hook:

- `Escape` and `window.blur` during a lift restore the pre-drag order, clear the lift, and write nothing;
- the commit path distinguishes three outcomes and reverts the preview on the two that are not a write: `{ ok: false }` → "Could not save the new order."; `{ ok: true, value: { applied: false } }` → "This board is locked; unlock it to arrange it."; applied → "Card order saved." The revert is local immediately, because a board showing an order the vault does not have is worse than the write never happening;
- expose the message as `announce`;
- `persistPins` in `HomePage.tsx` now answers the outcome the hook needs: `{ ok: false }` → `"refused"`, `{ ok: true, value: { applied: false } }` → `"locked"`, applied → `"applied"`. Keep `setPins` on the applied branch exactly as it is, and keep the `locked` early return: a local refusal is still the first gate.

In `HomePage.tsx`, render one `<p className="visually-hidden" role="status" aria-live="polite" data-testid="pin-arrange-status">{arrange.announce}</p>` at the end of `.home-dashboard`. Do not give it `aria-live="assertive"`: an arrangement is not an emergency.

`global.css` already carries `.visually-hidden` (used by `RealWeek` and `GoalProgressCard`): reuse it. Do not repurpose `.muted` — the line must be readable to a screen reader and invisible to the eye.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run the rig (Global Constraints) → PASS on all sixteen scenarios. From the repo root, `npm test` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/pages/HomePage.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): revert a refused card order and say why" -m "Escape and blur cancel a drag, and a refused or locked write puts the board back in the order the vault actually has instead of leaving the preview on screen."
```

---

### Task 5: The keyboard path

**Files:**
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/components/home/PinChrome.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`

**Interfaces:**
- Produces: the grip's `onKeyDown` handling, and focus restoration to the same card's grip after a drop

- [ ] **Step 1: Extend the failing rig**

Using real key events (`sendInputEvent({ type: "keyDown", keyCode: "Return" })` and the matching `keyUp` — `"Left"`, `"Right"`, `"Up"`, `"Down"`, `"Space"`, `"Escape"`):

- `keyboard-moves-and-writes`: focus card 4's grip (`.focus()` from the driver), press Return, press Left twice, press Return → the order moved card 4 two slots toward the start, `dashboardArrangePinWrites.length` is 1, and the payload is the exact expected array.
- `keyboard-up-down-moves-a-row`: with three columns measured, focus card 5's grip, Return, Down, Return → card 5 moved **three** slots (one row), not one.
- `keyboard-escape-writes-nothing`: Return, Right, Escape → order unchanged, zero writes.
- `keyboard-is-announced`: after the first Left the status text matches `/position 3 of 7/i`, and after the drop it reads "Card order saved".
- `focus-returns-to-the-grip`: after a drop, `document.activeElement` is the grip of the card that moved.

Add the scenario names to the wrapper's array.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all five: Return on the grip does nothing.

- [ ] **Step 3: Implement the keyboard contract**

In the hook, add `onKeyDown` for the grip's `keydown` (the delegated grid listener already sees it if you handle it there, or pass a handler through `PinChrome` — pick one and keep it in the hook so all arrange state is in one place):

- Return / Space with no lift: lift, `preventDefault`, announce "Moving <card>. Use the arrow keys, then Enter to drop.";
- ArrowLeft / ArrowRight: `movePin(preview, index, index ∓ 1)`, clamped, `preventDefault`, announce "Moved <card> to position i of n";
- ArrowUp / ArrowDown: ± the column count measured from the lifted card's row in the current DOM, clamped, same announcement;
- Return / Space while lifted: commit exactly as a pointer drop does;
- Escape while lifted: cancel with no write;
- after a commit or a cancel, restore focus to `[data-pin-id="<id>"] [data-testid="pin-grip"]`.

Announcements must carry the card's name, not its id: a system pin's humanised kind, a view pin's view title when the page has it, a page pin's page title. The page already resolves page titles; pass a `labelOf(pin)` into the hook rather than duplicating it.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run the rig (Global Constraints) → PASS on all twenty-one scenarios. From the repo root, `npm test` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/components/home/PinChrome.tsx apps/desktop/src/pages/HomePage.tsx apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): arrange a dashboard card from the keyboard" -m "The grip is a real button: Enter lifts, arrows move by a slot or a row, Enter drops, Escape cancels, and a polite live region names each step."
```

---

### Task 6: Sibling motion and auto-scroll

**Files:**
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-arrange-e2e.test.ts`

**Interfaces:**
- Produces: the FLIP pass in a layout effect, and the auto-scroll rAF loop, both inside the hook

- [ ] **Step 1: Extend the failing rig**

Add:

- `siblings-animate`: start a drag that changes the slot, and immediately after the change read every pin's `transform` and rect: at least one sibling has a non-identity `transform`, and its rect is strictly between its old and new resting positions. After 260 ms every pin's `transform` is `none`/identity and its rect equals its resting rect. Then drop and re-assert identity, so a stale transform cannot survive the drop.
- `auto-scroll-follows-the-pointer`: with the scrollport shorter than the board, drag into the bottom 56 px and hold → `scrollTop` increases, and the lifted card's rect still contains the pointer's y.
- `reduced-motion-is-still`: attach CDP on the window (`win.webContents.debugger.attach("1.3")`) and send `Emulation.setEmulatedMedia` with `features: [{ name: "prefers-reduced-motion", value: "reduce" }]`, then repeat the slot change → no pin ever carries a non-identity transform.

If `Emulation.setEmulatedMedia` cannot be attached in this Electron build, **drop the `reduced-motion-is-still` scenario and say so in the rig's doc comment** rather than faking it with an injected stylesheet. An uncovered CSS guard is honest; a falsely covered one is not.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on the three: cards snap with no transform, and a drag near the edge does not scroll.

- [ ] **Step 3: Implement FLIP and auto-scroll**

FLIP, exactly as spec §3.5: keep the last measured rect per pin id before the state update; in a layout effect, measure again, and for each pin that moved set `transform: translate(dx, dy)` with `transition: none`, then on the next frame clear both so `.home-pin { transition: transform 160ms }` runs the card home. Add that transition to `global.css` under a `.home-dashboard__grid.is-arranging` scope so an idle board never pays for it, and add `@media (prefers-reduced-motion: reduce) { .home-pin { transition: none; } }`.

Auto-scroll, exactly as spec §3.6: resolve the scrollport at lift time by walking up from the grid for the first ancestor whose computed `overflow-y` is `auto` or `scroll`, falling back to `document.scrollingElement`; while the pointer is inside the 56 px band, scroll by up to 14 px per frame scaled by depth into the band; recompute the lifted card's `left`/`top` from the current frame's client coordinates on every frame, so the card stays under a stationary pointer while the board scrolls.

- [ ] **Step 4: Run the rig and the suite, and confirm both pass**

Run the rig (Global Constraints) → PASS on all twenty-four scenarios (or twenty-three, with the reduced-motion seam named). From the repo root, `npm test` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/styles/global.css apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/dashboard-arrange-e2e.test.ts
git commit -m "feat(desktop): animate the reflow and auto-scroll a long board" -m "Cards FLIP into place over 160ms, a drag near the scrollport edge scrolls it, and the lifted card stays under the pointer while it does. Reduced motion turns the animation off."
```

---

### Task 7: Acceptance against a real vault, and the laws

**Files:**
- Modify: `apps/desktop/e2e/dashboard-live-app.electron.mjs`
- Modify: `apps/desktop/e2e/dashboard-live-app.mjs` if the runner needs a new leg
- Modify: `LAWS/DASHBOARD.md` (this task only)

**Interfaces:**
- Consumes: the built app, `LIFEQUEST_E2E={"userData":…,"showWindow":false}`, `bootForE2e()`

- [ ] **Step 1: Add the live leg and run it**

Extend `dashboard-live-app.electron.mjs` with one leg against the built app and a throwaway profile: read the board's order through the real IPC bridge, drag the second card to the first position with real input, assert the board file on disk now holds that order, then lock the board and assert a hold on a card neither lifts nor writes. Record it in `dashboard-live-app.json`.

Expected: **PASS**. This leg is written after the feature exists, so a failure here is a real defect (most likely `setPointerCapture` or the scroll-parent resolution behaving differently under the real shell), not a missing feature. Fix the code, not the assertion.

- [ ] **Step 2: Add the two laws, or decline them**

`LAWS/DASHBOARD.md` gains, if the operator wants the behavior locked in (one requirement per law, per `LAWS/README.md`):

```
An unlocked Dashboard MUST be reorderable by dragging a card to a new position.

Every card on an unlocked Dashboard MUST be reorderable from the keyboard.
```

This is the one step in the plan that may be declined: the feature is complete without it, and the laws are the product contract rather than the implementation's. Ask before writing.

- [ ] **Step 3: Run the whole suite**

From the repo root: `npm test` → PASS, every rig green, `dashboard-lock-ui` and `dashboard-views` unchanged.

- [ ] **Step 4: Commit**

```powershell
git add -- apps/desktop/e2e/dashboard-live-app.electron.mjs LAWS/DASHBOARD.md
git commit -m "test(desktop): arrange a real dashboard through the live bridge" -m "The built app reorders a card by drag and the board file follows; a locked board neither lifts nor writes."
```

---

## Done means

- Holding a card lifts it, dragging it drops it where it was aimed, and the board writes once per drop.
- The grip drags immediately; the keyboard arranges without a mouse; Escape always puts everything back.
- A locked board is inert, and a refused write is reverted and named.
- Every control in the card chrome is one standard `lucide-react` icon with an accessible name, and the rig proves which icon it is.
- `e2e/artifacts/dashboard-arrange.json` is the repeatable artifact: same command, same claims, no eyeballing the app.
