# Editing a card in place: the board holds its place

**Status:** design
**Date:** 2026-10-15
**Touches:** `apps/desktop/src/components/home/board-hold.ts` (new),
`apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/components/ui/ViewCard.tsx`,
`apps/desktop/src/state/ChatDockProvider.tsx`,
`apps/desktop/src/components/hermes/ChatPanel.tsx`, `apps/desktop/src/styles/global.css`,
`apps/desktop/e2e/dashboard-companion-edit.{html,tsx,electron.mjs}` (new),
`apps/desktop/tests/dashboard-companion-edit-e2e.test.ts` (new)

## 1. The problem, as reported

> I recently selected a card and asked the companion to modify it (change the order
> of items). It did the task successfully, but the board lost its position on the
> dashboard.
>
> I want to create the UX that the card is changing while in the same position. i.e.
> the companion is editing in realtime.

The write landed and the card's content did change. The fault is entirely in what the
board did while it happened.

**Measured, not guessed.** `e2e/dashboard-companion-edit.electron.mjs` renders the
real `HomePage` in a 1280×720 window over a stub bridge, parks the board on the card
the operator is reading, and then plays companion turns the way `main.ts` does — the
write, then `vault:dataChanged`. On the pre-fix build:

| Turn | `scrollTop` | The card under the eye | The cards after it |
|---|---|---|---|
| `save_view`, blocks reordered | 566 → 566 | unmoved | unmoved |
| `save_view`, card grew 64px | 566 → **566** | unmoved | **each moved 64px** |
| `save_view` + re-pin | 566 → **415** | unmoved | **each moved 151px** |

One sentence covers both failures, and it is what the operator said: **a card on the
board changed height, and every card after it moved by the difference.** The scroll
offset is a red herring — on the second row it did not change at all, which is why
this does not read as "the page jumped to the top".

The third row is the same fault seen from the other side: a re-pin moves the card, the
offset is corrected to follow it, and the cards around it slide. Chromium's own scroll
anchoring does some of this work and not all of it; which of the two you get depends
on which card the browser chose as its anchor and how much of the board is on screen.

## 2. What the operator gets

1. **A card the companion edits is edited in place.** Whatever changes on the board —
   the card's own box, its blocks, the board's scroll height, the board's order — the
   point the operator is looking at stays the point they are looking at.
2. **The card says it is being worked on.** While a turn is running with a card in
   context, that card wears a quiet ring. Same card, same slot, not replaced, not
   re-mounted, not re-keyed.
3. **A card that changed says so.** When the write lands and the card redraws with
   different content, it pulses once — in place, over, no toast, no reload, no
   fade-to-loading.
4. **A gesture is never corrected.** The whole of (1) is suspended for the duration of
   a drag or a keyboard arrange. An operator who drops a card where they meant to drop
   it gets exactly that board.

## 3. What "the board's place" is

A scroll offset is not a place: `scrollTop` names a pixel, and what the operator cares
about is what is under that pixel. So a place is recorded the way a reader would
describe it — a card, and how far into that card the top of the scrollport falls:

```ts
type BoardHold = { pinId: string; viewportOffset: number };
```

- `pinId` — the last card whose top edge is at or above the fold.
- `viewportOffset` — that edge measured from the scrollport's own top, in CSS pixels.
  Zero or negative by construction. Restoring is one subtraction.

Two properties of that definition do the work, and neither needs a special case:

- **A card scrolled off the top** has a negative `viewportOffset` and a known height,
  so the same subtraction holds the right pixel even though the card is not visible.
  The anchor is "the last card whose top is at or above the fold", not "the topmost
  visible card".
- **A card re-pinned across the fold** carries its identity through the reorder, so the
  anchor is found wherever it landed and the board follows it. The card the operator
  was reading is the one that stays put.

## 4. The rule: hold, correct on every pass, re-take on every scroll

One `useLayoutEffect` in `HomePage`, keyed on the pins the board is showing and on the
live revision. It runs before paint, so the corrected `scrollTop` is what the frame
shows: there is no frame in which the board is wrong. It restores the hold and then
re-takes it from the DOM.

The other half is a **scroll listener**: on any scroll event it re-takes the hold from
wherever the board now is. That is the whole of the manual-scroll story — a scroll event
is the one signal that only ever means "something moved the board", and the operator's
hand is the only thing that can move it without the page already knowing.

**Suspended while a gesture is in flight** (`arrange.isArranging`). A drag that reorders
the board moves the anchor card as part of the operator's own intent, and holding the
anchor then would be the page overruling them. **Suspended for a board that never
scrolled**: a board shorter than its scrollport has no place to hold.

### What was tried and rejected, and why it is worth writing down

Two obvious ways to make the correction "safe" were built, run, and measured, and both
are wrong in the same direction — they drop the hold at exactly the moment the hold is
needed:

| Rejected signal | Why it fails |
|---|---|
| "The offset is not the one I last wrote" | A card re-running moves the offset **inside React's own commit**, before any layout pass runs, so the page reads its own reflow as the operator's navigation. |
| "The anchor is not where the hold says it is" | The same failure, one level up: every reflow displaces the anchor, so every reflow looks like navigation. |

Measured, with the browser's own anchoring switched off, both slid the anchor 64px on
the rig's above-the-eye leg where the plain rule holds it. The lesson is in the spec
because the shape is tempting: a "validated" hold sounds strictly safer than an enforced
one, and it is strictly worse whenever the thing being validated is the very thing the
correction exists to change.

**Chromium's own anchoring is left on, deliberately.** It frequently absorbs a reflow
before a layout pass of ours runs; when it has, the hold already matches the board and
our correction is a no-op. The two are not in conflict — the browser reacts inside the
frame, this is the exact named correction that always runs — and the rig is what says
that between them no frame is wrong.

## 5. Being edited, and having changed

Two attributes on the pin wrapper, both presentational. Neither writes to the vault,
and neither is a second write path.

- **`.is-live`** — from the dock's own state. `ChatDockProvider` gains `livePinId`, set
  on `run.started` when a card is in context and cleared when the turn settles. It is
  the same fact as the context pill, seen from the board, and it is the window the
  operator actually waits through: the turn opens before the first write and closes
  after the last, so the card wears the ring while it is being worked on, not only
  after.
- **`.is-changed`** — set by `ViewCard` itself, when a re-run answers with a different
  spec or result than the one it was already drawing. The card is the only component
  that knows both, so nothing has to tell it. The comparison is over the *drawing*
  (`JSON.stringify({view, result})`), so a revision that leaves the numbers alone — and
  every write anywhere in the vault is a revision a card hears about — is not a change.

The pulse is keyed on a tick so two edits in a row are two animations, and both
animations are dropped under `prefers-reduced-motion`.

## 6. What this is NOT

- **Not a patch to `pins`, and not a narrower `load()`.** Those are separate concerns,
  and a hold that only worked because the board stopped re-reading would stop working
  the moment anything else wrote.
- **Not a scroll lock, and not a "restore my scroll position" button.** The operator
  scrolls freely during and after a turn.
- **Not the drag's own FLIP.** `usePinArrange` animates the cards that moved in a
  gesture it owns; the hold does nothing during that gesture.
- **Not a change to what a card draws.** A card is still the same card, one edit later.

## 7. How it is falsified

`tests/dashboard-companion-edit-e2e.test.ts` reads
`e2e/artifacts/dashboard-companion-edit.json` and the rig writes it. Each leg is a claim
a wrong implementation cannot pass:

| Leg | Claim |
|---|---|
| `blocks` | The card redraws with its blocks in the new order, nothing on the board moves, and exactly that card wears `.is-changed`. |
| `grow` | The edited card gets 64px taller, no card is rebuilt (no `.view-card` ever falls back to "Loading…", every pin is the same DOM node), and the cards after it keep their distance from the anchor. |
| `above` | A card above the fold grows 64px; the board's offset moves by exactly the growth and the anchor stays put — recorded frame by frame, because the claim is about the offset *moving*, and a board that pinned it would show one frame. |
| `board` | The card is re-pinned; the board's offset moves by the card's own change of slot and nothing slides under the eye. |
| `quiet` | A bare `vault:dataChanged` with nothing written moves nothing — the control that stops "held still because nothing happened" from passing. |

The artifact is `e2e/artifacts/dashboard-companion-edit.json`: same command, same
numbers, no eyeballing the app.
