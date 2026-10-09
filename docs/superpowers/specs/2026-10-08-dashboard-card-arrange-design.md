# Dashboard Card Arrange — Design Spec

**Date:** 2026-10-08
**Status:** Proposed
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Dashboard page lock](./2026-10-08-dashboard-page-lock-design.md), [Overview domain lens](./2026-08-31-overview-domain-lens-design.md), [Domain databases & Finance kit](./2026-09-23-domain-databases-finance-kit-prs.md)

Supersedes:

- The `↑` / `↓` pin-chrome buttons in `pages/HomePage.tsx` and their `onMoveUp` / `onMoveDown` handlers.
- The text-glyph chrome (`✕`, `↑`, `↓`, `◧`, `♭`) as the board's control vocabulary.

---

## 1. Purpose

A dashboard is a pin board, and arranging it is the operator's most frequent act on it. Today the only way is four text glyphs in the card's top-right corner: `✕ ↑ ↓` and, on a view card, `◧` / `♭`.

The arrows do not describe the board they move things in. The board is a **wrapping CSS grid** (`repeat(auto-fill, minmax(17rem, 1fr))`), so array index `n-1` is the *previous cell*, which on a wrapped row is the cell to the **left**, not the card **above**. "Move up" therefore moves a card sideways in most positions, and moving a card from the end of one row to the start of the previous takes one click per cell. The operator's mental model — pick a card up, put it where I want it — has no control that matches it.

This spec makes the board behave like a phone's home screen: **hold a card and it lifts; put it down where it belongs.** It also replaces every text glyph in the card chrome with the standard icon for the job, in the icon set the app already uses.

### Success criteria

- **Hold-to-lift.** Press and hold a card body for 220 ms and it lifts. Release without moving and nothing is written — a hold is not a change.
- **Move it, don't nudge it.** A held card follows the pointer, the rest of the board closes the gap, and the drop lands between the two cards the operator aimed between. One drop is **one** whole-list write.
- **The grip is immediate.** A drag started on the grip handle begins on movement, with no hold — the visible affordance never needs a timer.
- **A short press is still a press.** A press under the hold threshold, or a movement over 8 px before it fires, is a click, a scroll, or a text selection. Card links and buttons keep working.
- **The locked board is inert.** No chrome, no lift, no write. The lock stays the only gate (LAW: a locked Dashboard is not edited in place).
- **A refused write is not a lie.** When the vault refuses the new order, the board goes back to the order it has, and the page says why.
- **Keyboard can arrange too.** The grip is a real button: Enter lifts, arrows move, Enter drops, Escape cancels, and a live region names each move. Removing the arrows must not remove the only non-pointer path.
- **A standard icon for every control.** `PinOff` for unpin (not `✕`), `GripVertical` for move (not `↑ ↓`), `Maximize2` / `Minimize2` for the card's width (not `◧ ♭`), from `lucide-react` — the set the app already draws `Pin` / `PinOff` / `X` with.
- **No schema change.** The board's order already *is* its layout. Nothing in `packages/vault-core` changes.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Layout model | Order only. `Pin[]` order is the layout; no positions are stored. Free placement is a separate, later phase (§8). |
| 2 | Activation | Two paths: the grip handle starts a drag on ≥4 px of movement; the card body starts one after a 220 ms hold with <8 px of movement. |
| 3 | Cancellation of a pending hold | Pointer movement over 8 px before the hold fires, `pointerup`, or a press on an interactive element inside the card. |
| 4 | Lift | The card stays in grid flow and is displaced from its slot by an inline transform; its slot follows the pointer, so the gap it leaves *is* where it will land. |
| 5 | Target slot | The gap is the card's own layout box: the rendered order is the preview order, so the board's reflow shows the drop and the room travels with the drag. |
| 6 | Slot rule | Reading-order scan with a row-band test on the pointer (the first slot whose row band contains the pointer and whose horizontal midpoint is past it, else the first slot whose vertical midpoint is below it). |
| 7 | Drop | Exactly one `pinsSet(boardSlug, next)` per drop, and none if the index did not change. |
| 8 | Optimism | The preview order is committed locally at lift and reverted if the vault refuses or the drag is cancelled. |
| 9 | Cancel | Escape, `pointercancel`, window blur, or a drop on the board's own non-pinnable card → original order, no write. |
| 10 | Locked board | No chrome, no listeners, no lift, no write. |
| 11 | Keyboard | Enter/Space on the grip lifts and drops; Left/Right move one slot; Up/Down move one row (the measured column count); Escape cancels. |
| 12 | Announcements | A `role="status"` line names each keyboard move and the outcome of a drop. |
| 13 | Motion | Sibling cards animate into place over 160 ms, drawn where they were on the reorder frame; the whole board is still under `prefers-reduced-motion: reduce`. |
| 14 | Long boards | Dragging within 56 px of the scrollport's top or bottom edge auto-scrolls, and the lifted card stays under the pointer while it does. |
| 15 | Icons | `PinOff`, `GripVertical`, `Maximize2` / `Minimize2` from `lucide-react`, icon-only, each with an accessible name. |
| 16 | Chrome order | Left to right: move (grip), width (view pins only), unpin. |
| 17 | One-card board | Fewer than two pins renders no grip: there is nothing to arrange. |
| 18 | Class hooks | `.home-pin__chrome` and `.home-pin__btn` survive: two existing rigs count them. |

### Explicitly out of scope

- Free x/y placement, a fixed-size board canvas, zoom, or per-card sizes beyond span 1 / span 2 (§8).
- Dragging a card **between** boards (Overview → a domain board). The board file is the unit of ordering, and cross-board motion is a pin add plus a pin remove, not a reorder.
- Board sections, headings, or grouped rows.
- Optimistic concurrency on the board file (a `rev`, `updatedAt`, or ETag). Writes stay whole-list last-write-wins, exactly as they are now; see §7.
- Undo history, multi-select, rubber-band selection, or drag-to-trash.
- A resize handle on the card corner; the width control stays a button in this phase.
- Any `packages/vault-core` change, any schema version bump, and any new dependency.

---

## 3. Architecture

```
   pointerdown on the board (one delegated listener)
        │
        ├── target is a link / button / input / [role=button]  → ignore
        ├── board is locked, or fewer than 2 pins              → ignore
        ├── target is inside [data-pin-grip]                   → armed (drag on ≥4 px)
        └── otherwise                                          → armed (drag on 220 ms hold, <8 px)
                     │
                     ▼
            LIFT:  measure the card's layout box
                   card stays in flow, marked lifted, displaced by transform
                   grid → .is-arranging,  card → .is-lifted
                     │
                     ▼  pointermove (captured) + rAF + scroll
            SLOT:  insertionIndex(rects of the other pins, pointer)
                   ≠ current index → new preview order → React re-render
                   FLIP: siblings invert their delta, then animate to 0
                     │
                     ▼  pointerup
            DROP:  index unchanged → nothing, no write
                   else → persistPins(previewOrder)
                            applied:true  → keep
                            applied:false → revert + status line
```

### 3.1 Types

No new persisted types. The controller works on the existing list:

```ts
export type PinOrder = Pin[];                      // unchanged
export type ArrangeState =
  | { phase: "idle" }
  | { phase: "armed"; id: string; mode: "grip" | "hold"; pointerId: number }
  | { phase: "lifted"; id: string; from: number; to: number; grab: { dx: number; dy: number };
      rect: { left: number; top: number; width: number; height: number } };
```

`Pin` and `PinBoard` are untouched. `schemaVersion` stays `1`.

### 3.2 Modules

| Module | Owns |
|--------|------|
| `apps/desktop/src/components/home/pin-order.ts` | `movePin(pins, from, to)` and `insertionIndex(slots, point, columns)` — pure, no DOM, no React. |
| `apps/desktop/src/components/home/usePinArrange.ts` | The controller: delegated `pointerdown`, capture, rAF loop, scroll parenting, auto-scroll, keyboard, FLIP, commit and revert. Returns `{ gridRef, gridHandlers, gridClassName, order, cardState(id), announce }`. |
| `apps/desktop/src/components/home/PinChrome.tsx` | The three icon buttons, their accessible names, and their `data-testid`s. |
| `apps/desktop/src/pages/HomePage.tsx` | Renders `order` instead of `pins`, passes the board lock and `moveBusy` down, and keeps `persistPins` as the one write path. |

`HomePage` keeps `persistPins` and the lock gate exactly as they are. The controller never talks to the bridge itself: it calls back into `persistPins`, so the lock check, the `moveBusy` guard, and the "one write path" rule stay in one place.

### 3.3 The slot rule

The lifted card is out of flow, so the DOM order *is* the preview and the gap is where the card will land. The resolver therefore only has to answer one question: **which index does the pointer sit at?**

```ts
/** Slots: the other pins' rects, in current DOM order. Point: client coords. */
export function insertionIndex(slots: Rect[], point: { x: number; y: number }): number {
  for (let i = 0; i < slots.length; i += 1) {
    const r = slots[i];
    const inBand = point.y >= r.top && point.y <= r.bottom;
    if (inBand) {
      if (point.x < r.left + r.width / 2) return i;     // same row: decide by x midpoint
    } else if (point.y < r.top + r.height / 2) {
      return i;                                          // another row: decide by row
    }
  }
  return slots.length;                                   // past the last pin, before the agents card
}
```

A wide (`span 2`) card's rect is the full row, so its own midpoint is the row's midpoint: the left half of a wide card inserts before it and the right half after it. That is predictable, and it is the one rule that keeps a wide card from being an insertion dead zone.

`movePin` is the identity-preserving move both the preview and the write use:

```ts
export function movePin<T>(list: T[], from: number, to: number): T[];
```

### 3.4 Lift and the ghost

The lifted card **never leaves the grid's flow**, and this is the correction the
board itself forced. The first design took it out of flow as an absolutely
positioned child. That version works, and it has a hole in it: the in-flow items
keep their relative order no matter where the lifted card's index goes, so the
board never reflows during a drag, the "gap" never travels, and the operator gets
no visual answer to *where will this land* — only a card hovering over a board
that has already closed up. FLIP had nothing to animate either, which is what
gave the hole away.

What the board does instead:

- The lifted card keeps its slot, **and its slot follows the pointer**: the
  rendered order is `movePin(pins, from, to)`, so the board's own auto-placement
  puts the card's box where it will land and moves every other card aside. The
  **gap is the card's layout box**, and it travels with the drag.
- The card is displaced from that box by an inline `transform`, so it is drawn
  under the pointer while its layout stays in the slot:
  `translate(dx, dy)`, where `dx = pointer.x - grabX - layoutBox.left`, recomputed
  from the pointer and the card's *current* layout box on every frame, never
  accumulated.
- `layoutBox(card)` is the card's drawn box minus its own transform. That
  distinction is load-bearing twice over: the pointer must aim at where cards
  *live* — a sibling mid-animation is somewhere else — and the lifted card must be
  displaced from where it *lives*, not from where it is drawn.
- The lifted look is `outline: 2px solid var(--accent); outline-offset: 1px`, with
  `box-shadow: var(--shadow-sm)`, `z-index: 2`, `pointer-events: none`.
- Before the pointer has moved, the card is lifted *in place*: same slot, same
  outline, no reflow. A hold that means nothing must not move the board.

`outline` rather than `border` is load-bearing: a border would change the box and
nudge the layout it is sitting in, and it would double the inner card's own
hairline. `--shadow-sm` is the ceiling DESIGN.md sets for the sheet, so the lift
stays inside the elevation ladder.

This needs no clone, no reparent, and no placeholder element: the one card the
operator is holding is the card in the slot and the card under the hand, at once.

### 3.5 Sibling motion (FLIP)

A slot change reflows the grid — cards really do move, which is the whole point
of §3.4 — and a grid reflow is instant. The controller:

1. keeps the last measured layout box per pin id, captured *before* the state update,
2. in a layout effect, measures again and, for every pin that moved, sets
   `transform: translate(dx, dy)` with `transition: none`,
3. clears both on the next frame, so the CSS `transition: transform 160ms` plays
   each card from where it was drawn to where it now lives.

The effect is that the reorder frame draws every card exactly where it already
was — no jump — and the animation carries it to its new place. The lifted card is
excluded: it is following a hand, and its transform belongs to the drag.
Cards whose delta is zero are left alone, and the whole step is skipped under
`prefers-reduced-motion: reduce`.

### 3.6 Auto-scroll

The scrollport is resolved at lift time by walking up from the grid for the first ancestor whose computed `overflow-y` is `auto` or `scroll`, falling back to `document.scrollingElement`. In the app that is `.shell__content` (`overflow: auto`); a harness page supplies its own.

While the pointer sits within 56 px of that scrollport's top or bottom edge, a `requestAnimationFrame` loop scrolls it by up to 14 px per frame (scaled by how deep into the band the pointer is), and the lifted card's transform is recomputed in that same frame — from the pointer and the card's current layout box, which the scroll has just moved. The loop stops on drop, cancel, or when the pointer leaves both bands.

### 3.7 Keyboard

The grip is `<button type="button" data-pin-grip aria-label="Move card">`. With it focused:

| Key | Act |
|-----|-----|
| Enter / Space | Lift (announce "Moving <card>. Use the arrow keys, then Enter to drop.") |
| ArrowLeft / ArrowRight | Move one slot toward the start / end of the order |
| ArrowUp / ArrowDown | Move one row: the column count measured from the lifted card's own row |
| Enter / Space | Drop and write, once |
| Escape | Cancel, restore the original order, no write |

Arrow keys `preventDefault` so the sheet does not scroll under the card. Focus returns to the grip of the same card after a drop, which is the element the operator was holding. The `role="status"` line (visually hidden, `aria-live="polite"`) names each step: "Moved Weekly expenses to position 3 of 7", then "Card order saved", or "Card order not saved: this board is locked."

### 3.8 The card chrome

| Position | Control | Icon | Accessible name | `data-testid` |
|----------|---------|------|-----------------|---------------|
| 1 | Move | `GripVertical` | "Move card" (or "Arrange card" while lifted) | `pin-grip` |
| 2 | Width (view pins only) | `Maximize2` / `Minimize2` | "Widen to full row" / "Shrink to one cell" | `pin-span` |
| 3 | Unpin | `PinOff` | "Unpin card" | `pin-unpin` |

- Every button is icon-only: one `<svg>` and **no** text node. The glyph characters `✕ ↑ ↓ ◧ ♭` leave the board.
- The icons are `lucide-react`, matching the app's existing chrome iconography (`Pin` / `PinOff` in the chat panel, `X` / `Minus` / `Square` in the titlebar). `lucide-react`'s default classes (`lucide-pin-off`, `lucide-grip-vertical`, …) are what makes "which icon is drawn" falsifiable in the rig.
- The visual box stays 1.55 rem; the hit area grows to 2.05 rem through a `::after` overlay (`inset: -0.25rem`), because these are now the controls a hold-and-drag operator aims at.
- The title clearance (`.home-pin:has(.home-pin__chrome) .home-card__title`) drops from 5.2 rem to what three buttons need.
- `home-pin-add`'s heading gains a `Pin` icon, so the board has one pin vocabulary: the row that puts a card on and the control that takes it off.
- Chrome stays visible at rest. Hiding it until hover would re-create the discoverability problem the grip exists to solve.

### 3.9 The board's other grid child

`ActiveAgentsCard` is rendered as a `.home-pin` after the pins and is not a pin. It is never lifted, never a slot, and always last: the resolver only reads `[data-pin-id]`, and every pin's insertion index stays below `pins.length`.

### 3.10 Skin and tokens

The scheme needs no new token: `--accent`, `--shadow-sm`, `--home-radius`, and `--bg-panel` are all existing semantic names, so this feature repaints with a skin for free. Under `prefers-reduced-motion: reduce` no transform transition runs at all.

---

## 4. Locked-board behavior

The lock is unchanged and is enforced in two places, as now:

1. **The page** renders no chrome and attaches no arrange listeners while `locked`, so a pointer press cannot lift a card even by accident.
2. **`persistPins`** refuses locally, and `setPins` in vault-core files a Decision instead of writing if the board locked underneath us mid-drag.

The second case is the one this spec tightens. Today `persistPins` silently keeps the old state when `applied` is false, which for a whole-list reorder would leave the board showing an order the vault does not have until the next read. A refusal now **reverts the preview** and says so.

---

## 5. Error handling

| Case | Behaviour |
|------|-----------|
| Press on a link / button / input inside a card | No arming. The control gets the click. |
| Movement > 8 px before the hold fires | Pending hold cancelled; the gesture stays a scroll or a selection. |
| Pointer leaves the window mid-drag | `pointercancel` or `blur` cancels: original order, no write. |
| Drop on the card's own index | No write, no status change. |
| `pinsSet` answers `ok: false` | Preview reverts, status reads "Could not save the new order." |
| `pinsSet` answers `applied: false` (locked underneath) | Preview reverts, status reads "This board is locked; unlock it to arrange it." |
| The board changes under a drag (`reloadGeneration`, file change) | The drag remaps by pin id; a lifted pin that no longer exists cancels the drag. |
| Board has fewer than 2 pins | No grip, no arming. |
| Middle-click, right-click, or a modifier-drag | Ignored: primary button only. |
| `setPointerCapture` refuses | The move/up listeners fall back to `window`, and a missed `pointerup` is caught by `blur`. |

---

## 6. Testing

The repo's rule is E2E as the sole testing mechanism, and every claim below is falsifiable from the DOM of the real page in a real layout engine. **No unit tests, and no `node:test` file that calls `pin-order.ts` directly.**

**New rig** — `apps/desktop/e2e/dashboard-arrange.{html,tsx,electron.mjs}`, wrapped by `apps/desktop/tests/dashboard-arrange-e2e.test.ts`, artifacts `e2e/artifacts/dashboard-arrange.{json,png}` plus `dashboard-arrange-lift.png`.

The harness renders the real `HomePage` with the recording bridge stub, on a board of **seven** pins whose order is the assertion's alphabet:

```
sys:goal-progress · view:financial:v-weekly (span 1) · page:financial:ledger ·
sys:today-week · view:financial:v-summary (span 2) · sys:pending-decisions · sys:recent-log
```

The stub models `pinsList`, `pinsSet`, `pinsSetLocked`, `pageList`, `viewList`, `viewGet`, `viewRunSaved`, `decisionList`, `logList`, `kitList`, `vaultGetSnapshot`, and the card-level reads the stub already needs (`ActiveAgentsCard`, `DeadlineBanner`, `GoalProgressCard`, …), and names every other call in `dashboardArrangeUnexpectedCalls`. The grid sits in a fixed-height scrollport so auto-scroll is testable.

The driver dispatches **real input** through `webContents.sendInputEvent` (mouse-down / move / up and real key events) rather than synthetic `dispatchEvent`, because the claims are about activation timing, hit-testing, and pointer capture — none of which a hand-built `PointerEvent` proves. Timing constants: hold 220 ms, driver holds 400 ms for the positive case and releases at 80 ms for the negative ones.

| # | Claim | Falsified by |
|---|-------|--------------|
| 1 | Chrome identity | Each chrome button holds exactly one `<svg>`, its classes name the expected lucide icon, its text is empty, and no glyph character survives in the chrome. A leftover `✕` fails. |
| 2 | A short press is not a drag | Press, release at 80 ms → no `.is-lifted`, no write. |
| 3 | Movement cancels a hold | Press, move 20 px in <80 ms, hold → no lift. |
| 4 | Hold lifts | Press on a card body, wait 400 ms → `.is-lifted` on that card and `.is-arranging` on the grid. |
| 5 | Grip drags at once | Press the grip and move 6 px → lifted, with no hold. |
| 6 | The lift leaves a gap | While lifted, the lifted card is out of flow (`position: absolute`) and the other pins' rects have closed up to its slot. |
| 7 | Same-row targeting | Drag card *i* past the midpoint of card *i+1* in the same row → the final order is `i+1, i` and not `i+3` — the exact bug the arrows had. |
| 8 | Wide cards are droppable | Drop on the left half of the span-2 card → before it; on the right half → after it. |
| 9 | One write per drop | After the whole sequence the stub recorded exactly one `pinsSet` per committed drop, carrying the full list in the expected order. |
| 10 | A hold with no move writes nothing | Lift then release in place → zero writes. |
| 11 | Escape cancels | Escape mid-drag → the DOM order equals the pre-drag order, zero writes. |
| 12 | A refusal is not a lie | Stub answers `applied: false` → the DOM order reverts and the status line says the board is locked. |
| 13 | Locked boards are inert | With `locked: true`: no chrome, press-and-hold produces no lift, zero writes. |
| 14 | Keyboard arranges | Real key events: Enter, ArrowLeft ×2, Enter → order moved two slots, exactly one write. Escape path writes nothing. |
| 15 | Keyboard is announced | The `role="status"` line names the position after each arrow and the outcome after the drop. |
| 16 | Motion | Immediately after a slot change a moved sibling carries a non-identity transform at a mid-animation rect; after 260 ms every card's transform is identity and its rect equals its resting rect. Under CDP `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`, no transform is ever applied. |
| 17 | Auto-scroll | On a board taller than the scrollport, dragging into the bottom 56 px increases `scrollTop`, and the lifted card's rect still contains the pointer. |
| 18 | Nothing else moved | No console errors, no unexpected bridge call, the skin was applied, and the non-pinnable `ActiveAgentsCard` is still the last grid child with its content intact. |

**Existing rigs must stay green untouched.** `dashboard-lock-ui.electron.mjs` counts `.home-pin__chrome` and `.home-pin__chrome .home-pin__btn` and its test asserts `chrome > 0` unlocked, `0` locked; both class hooks survive (decision 18), and the controller makes no bridge call except the drop's `pinsSet`. `dashboard-live-app.electron.mjs` counts chrome the same way. If either rig needs an edit, that is a signal the chrome was renamed, not a test to relax.

**Acceptance, against the operator's own vault** — not part of `npm test`, because it writes to a real vault:

- `apps/desktop/e2e/dashboard-live-app.mjs` gains one leg: on the built app against a throwaway profile, drag the second card to the first position through the real IPC bridge, assert the board file's order changed, and assert the lock still gates a drag. Artifact: `dashboard-live-app.json`.

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| A hold fights text selection or scrolling | The 8 px movement cancel, the interactive-element skip, and `user-select: none` only once lifted. On touch, `touch-action: none` is set on the grip only, so the card body still scrolls the board; a hold that never moves never becomes a drag. |
| The ghost is clipped by the scrolling sheet | The lifted card is positioned in the grid and clipped like any card at the scrollport's edges — the same edge the operator is dragging toward, which is what auto-scroll is for. |
| Absolute positioning inside a grid reflows oddly | The grid gains `position: relative` for a containing block; the lifted card is `width`/`height`-frozen from its resting rect, so an auto-placed row cannot resize it. Claim 6 covers it. |
| FLIP leaves a stale transform after a drop | Transforms are cleared on drop, on cancel, and on unmount; claim 16 asserts identity transforms at rest. |
| A concurrent agent `arrange_dashboard` clobbers a drop, or a drop clobbers the agent | Unchanged from today: whole-list last-write-wins. The board is re-read on `reloadGeneration` and on the vault file-change event, so the board converges on the vault rather than on the last writer. Optimistic concurrency is deliberately out of scope, not overlooked. |
| Removing the arrows loses the only a11y path | The keyboard contract (§3.7) replaces it, and claim 14 proves it with real key events. |
| A rig that synthesizes its own pointer events passes while real input fails | The driver uses `webContents.sendInputEvent` only. |
| Icon-only buttons become unlabelled | Every chrome button carries both `aria-label` and `title`, asserted by claim 1. |

---

## 8. The later phase: free placement

Deferred, but the shape is recorded so this phase does not foreclose it.

A positions layer would add an optional field to the board file — `layout?: { version: 1; items: Record<string, { x: number; y: number; w: 1 | 2 }> }` — read-migrated exactly like `locked` is today (`absent = grid order`), and preserved by `setPins`, `setPinBoardLocked`, and the Finance kit merge for the same reason `locked` is. `schemaVersion` would stay `1`.

Phase 1 leaves that door open on purpose:

- The single write path stays `persistPins`, so a positions map has one place to be carried through.
- The order stays the layout's fallback, so a narrow window, a board with no positions, and any vault written before the field exists all render exactly as they do today.
- The controller's seam is `insertionIndex(slots, point)`: phase 2 replaces that one function with a snap-to-grid resolver and sets inline `grid-column` / `grid-row` instead of DOM order, and nothing about activation, lift, cancel, keyboard, or commit changes.

Free placement also needs three things this spec does not: a bounded canvas with a defined empty-space rule, a decision about what a resize does to neighbours, and a zoom/pan story that a wrapping grid never needed. Those are the phase-2 spec's problem, not this one's.

---

## 9. Files

| Area | Touch |
|------|--------|
| `apps/desktop/src/components/home/pin-order.ts` | New: `movePin`, `insertionIndex` |
| `apps/desktop/src/components/home/usePinArrange.ts` | New: the controller |
| `apps/desktop/src/components/home/PinChrome.tsx` | New: the three icon buttons |
| `apps/desktop/src/pages/HomePage.tsx` | Render the preview order; drop `onMoveUp` / `onMoveDown`; use `PinChrome`; status line |
| `apps/desktop/src/styles/global.css` | `.home-pin.is-lifted`, `.is-arranging`, grip cursor, `::after` hit area, icon sizing, title clearance |
| `apps/desktop/e2e/dashboard-arrange.{html,tsx,electron.mjs}` | New rig |
| `apps/desktop/tests/dashboard-arrange-e2e.test.ts` | New wrapper |
| `apps/desktop/e2e/dashboard-live-app.mjs` | One acceptance leg against a real vault |
| `apps/desktop/data-preview.html` | Optional: the static mock still draws the old glyphs |

No file under `packages/vault-core/` changes. No `package.json` changes.
