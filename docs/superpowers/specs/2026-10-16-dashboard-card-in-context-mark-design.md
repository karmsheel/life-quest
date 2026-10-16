# A card in the chat's context is marked, and the control takes it back

**Status:** design
**Date:** 2026-10-16
**Touches:** `apps/desktop/src/pages/HomePage.tsx`,
`apps/desktop/src/styles/global.css`, `LAWS/DASHBOARD.md`,
`apps/desktop/e2e/dashboard-card-context.electron.mjs`,
`apps/desktop/e2e/card-context.electron.mjs`,
`apps/desktop/tests/card-context-e2e.test.ts`

## 1. The problem, as reported

> When the user is editing a card on the dashboard, he clicks the card context
> button to add it to the chat. The card should also have a highlight around it
> when it's added to the chat. Clicking on the button should deselect the card
> from the chat.

Two claims about one press. The control already handed the card over, and the only
thing that said so was the pill above the composer — in the other pane, and behind
a collapsed dock entirely. Nothing said it on the board, where the operator's
attention is, and the press was one-way: the only way back was the pill's ✕, a
control on the other side of the window from the one that was pressed.

## 2. The rule

**One fact, drawn twice.** The dock's context card is the chat's state, not the
board's, so the mark is *derived* from it — `contextCard?.pin.id === pin.id` — and
never kept in a second piece of board state. The card wears the same `outline`
ring as the lifted card and the card a turn is working on, because all three mean
the same thing: this one is the card being addressed. The chat control becomes a
toggle: `aria-pressed` carries the state, its accessible name and tooltip say what
the next press will do, and pressing it on the card the chat already holds sets
the context to `null`.

There is deliberately no third state to reconcile. Taking the card off with the
pill's ✕ clears the ring for the same reason the control does — the ring is not
stored anywhere, so there is nothing that can disagree with the chat.

## 3. What this is NOT

- **Not a per-chat or persisted context.** It is the dock's live state, as before;
  the mark lasts exactly as long as the context does.
- **Not a second control.** The pill keeps its ✕, and nothing about the turn
  changed: the card's ids still ride the next turn only while it is in context.
- **Not an edit of the board.** Deselecting writes nothing, and the ring appears on
  a **locked** board too — asking the companion about a card, and changing your
  mind about it, are not board edits.
- **Not an animation.** The ring is the state and does not move; nothing here is
  lost under `prefers-reduced-motion`.

## 4. How it is falsified

Both existing rigs grew the claim rather than a new rig, because this is the same
feature seen from the same two ends:

| Rig | Claim |
|---|---|
| `dashboard-card-context` | `the-card-in-context-wears-a-highlight` — read as the browser paints it (`outline-style: solid`, a real width), so a class that draws nothing fails; no card is ringed before the press, exactly the pressed card after it, and the ring moves rather than accumulating when another card's control is pressed. `the-highlight-follows-the-card-the-chat-is-about` and `pressing-the-control-again-takes-the-card-off-the-chat` — the second press empties the dock, clears the ring, leaves the chat open, and writes nothing. The locked-board claim now also asserts the ring is drawn there. |
| `card-context` | `pressing-the-card-control-again-takes-it-off-the-chat` — the join, with the real panel: the ring the card wore, the pill, and the `focusedCard` on the next turn all go together. |

Artifacts: `e2e/artifacts/dashboard-card-context.{json,png}` and
`e2e/artifacts/card-context.{json,png}`, read by
`tests/card-context-e2e.test.ts`. Same command, same claims, no eyeballing the app.
