# Dashboard cards: the card itself is the chat control, and the chat holds three

**Status:** design
**Date:** 2026-11-05
**Supersedes:** `2026-10-09-dashboard-card-context-design.md` (the chat control)
and `2026-10-16-dashboard-card-in-context-mark-design.md` (the one-card lockstep)
for everything below. The pin board, the per-card menu, the ring, and the turn
instruction keep their shape; only the way a card is chosen changes.
**Touches:** `apps/desktop/src/pages/HomePage.tsx`,
`apps/desktop/src/state/ChatDockProvider.tsx`,
`apps/desktop/src/state/ChatSessionsProvider.tsx`,
`apps/desktop/src/components/hermes/ChatPanel.tsx`,
`apps/desktop/src/components/home/usePinArrange.ts`,
`apps/desktop/src/styles/global.css`, `apps/desktop/src/vite-env.d.ts`,
`apps/desktop/electron/preload.ts`, `apps/desktop/electron/companion-client.ts`,
`apps/desktop/e2e/*`, `apps/desktop/tests/*`, `LAWS/DASHBOARD.md`, `docs/wiki/*`.

## 1. The problem, as reported

> On the dashboard pages, we have the icon button to add the card as context
> into the chat. I want you to remove that icon, and instead, if the user just
> clicks the card anywhere on the card, it adds that card as context. And if the
> user clicks outside that card, it removes it from context, and the user can
> select up to three cards to add to the context window.

The card was a picture with one small button in its corner. The operator's
attention is on the card, not on its corner, and the corner control says nothing
about the card's content. The card itself is the thing to point at — so the card
is the control. And a chat about a board is rarely about one card, so the context
holds up to three.

## 2. What the operator does

1. **Click anywhere on a card** — its body, a heading, a table cell, a chart —
   and the card goes into the chat's context. The ring appears around it, the
   dock opens on its thread, and the caret lands in the composer. If the card is
   already in context, the same click takes **that card only** back out.
2. **Click empty board space** (the board's own background, its header text, the
   gap between cards) and **every card leaves the context at once**. Presses on
   another app surface — the chat dock, the rail, another page — do not clear it;
   the operator is allowed to work while the context is held.
3. **Select up to three cards.** Each selected card keeps its ring, and the
   composer shows one pill per card, in the order they were chosen. Clicking a
   fourth card is refused: nothing is added, and a visible status line says
   `Three cards are already in the chat context — take one out first.`
4. **Press a control inside a card** — its 3-dot menu, a menu item, a width or
   height handle, a link, an input, or the card's keyboard context toggle — and
   that control does its own job. It does not add or remove the card from
   context, and on a locked board the same holds: asking the companion about a
   card is not editing the board.

There is no chat icon left on any card.

## 3. The rules this is built on

- **One fact, drawn twice.** The dock's `contextCards` array is the chat's state.
  The board derives each ring from it (`contextCards.some(c => c.pin.id ===
  pin.id)`) and keeps no second copy. Removing a card from the pill clears its
  ring for the same reason; nothing has to be reconciled.
- **A card is named before the turn is sent** (LAWS/DASHBOARD.md): the pill
  above the composer carries the name read off the card's own heading at the
  moment of the click. The turn carries the same array.
- **The cap is a rule, not an accident.** `MAX_CONTEXT_CARDS = 3`,
  exported from `ChatDockProvider.tsx`, is the single source of the number; the
  toggle refuses the fourth add and the renderer never draws a fourth pill.
- **The card body mutates nothing.** Selecting and deselecting are dock state
  only; no pin write, no view write, no vault call. The ring appears on a
  **locked** board too.

## 4. The dock's state (contract)

`apps/desktop/src/state/ChatDockProvider.tsx`:

```ts
export const MAX_CONTEXT_CARDS = 3;

export type ChatCardContext = {
  pin: Pin;
  label: string;            // read off the card's heading at click time
  boardSlug: string | null; // null = the Overview board
};

type ChatDockContextValue = {
  // …unchanged fields…
  contextCards: ChatCardContext[];              // in the order they were added
  toggleCardContext: (card: ChatCardContext) => "added" | "removed" | "full";
  removeCardContext: (pinId: string) => void;   // one card, by pin id
  clearCardContext: () => void;                 // every card
  livePinIds: string[];                         // cards a running turn is on
  setLivePinIds: (pinIds: string[]) => void;
};
```

- `contextCard`, `setContextCard`, `livePinId`, `setLivePinId` are gone; no
  compatibility aliases. Every consumer is updated.
- `toggleCardContext` removes when the pin id is already held, adds when there
  is room, and returns `"full"` without changing anything when the array already
  holds `MAX_CONTEXT_CARDS` cards.
- A pin id appears at most once.
- `livePinIds` is set from the same array when a companion run starts
  (`run.started`) and is emptied when the run settles (`run.completed`,
  `run.failed`, and the other terminal frames).

- `ChatDockProbe` (`apps/desktop/e2e/chat-dock-probe.tsx`) is updated to expose
  `{ open, contextCards, livePinIds }` and the three actions, namespaced by its
  `channel`, so both rigs can read and seed the dock without reaching into React.

## 5. What the operator sees on the card (contract)

- No `[data-testid="pin-chat"]`, no `.home-pin__chat`, no visible
  `MessageSquare` icon on any card. A rig asserting their absence is part of the
  claim.
- `[data-pin-id]` is the click target. A primary click (button 0) whose event
  target is inside the card and not inside `a, button, input, select, textarea,
  [role="button"], [role="menu"], [role="menuitem"], [role="separator"],
  [data-pin-handle]` toggles the card.
- No toggle while an arrange drag or a 220 ms hold is in flight, and no toggle
  from the click a drag leaves behind: `usePinArrange` gains
  `consumeClickSuppression(): boolean`, set when a gesture lifts the card or
  cancels an armed press by drift, and read by the page's click handlers.
- No toggle while Edit mode is on (`editingPinId !== null`).
- Each card carries one keyboard/AT control:
  `<button data-testid="pin-context-toggle">`, visually hidden until focused
  (the operator sees no icon), with `aria-pressed` and an accessible name that
  names the card and the action:
  `Add "<card name>" to the chat context` when out, and
  `Take "<card name>" out of the chat context` when in. Activating it toggles the
  card and stops the click from bubbling to the card body. On a locked board the
  card is still not a tab stop, but this control is, so the context is reachable
  from the keyboard there too.
- Each held card wears `.is-in-context` (same solid `2px` accent `outline` as
  before); several cards may wear it at once. A held card a run is working on
  also wears `.is-live`.
- `cursor: pointer` on `.home-pin[data-pin-id]` (and not on the static
  `ActiveAgentsCard` wrapper, which has no pin id).
- The fourth-card refusal renders
  `<p role="status" data-testid="pin-context-status">Three cards are already in
  the chat context — take one out first.</p>` visibly on the board, cleared by
  the next successful toggle/clear and after 6 s. It is a status, not a dialog:
  nothing is blocked, and no write is attempted.

## 6. Empty-board clicks (contract)

The dashboard root's click handler, after a card click has had its chance:

- ignore the press when `arrange.consumeClickSuppression()` is true;
- ignore it when the target is inside `[data-pin-id]`;
- ignore it when the target is inside `a, button, input, select, textarea,
  [role="button"], [role="menu"], [role="menuitem"], [role="separator"],
  [data-pin-handle]` (so header controls, the page menu, add-pin buttons and the
  confirm dialog's own controls keep their behaviour);
- otherwise, when `contextCards.length > 0`, `clearCardContext()`.

Only the Dashboard page does this. Presses on the chat, the rail, or another
route leave the context alone. The same rule holds on a locked board, where it
writes nothing.

## 7. What the chat shows (contract)

`apps/desktop/src/components/hermes/ChatPanel.tsx`:

- One pill per card above the composer, in `contextCards` order, wrapped in a
  `.chat-panel__contexts` container that wraps onto more than one line rather
  than squeezing the field.
- Each pill keeps `data-testid="chat-context-pill"` and gains
  `data-context-pin-id="<pin id>"`; its remove button keeps
  `data-testid="chat-context-remove"`, gains the same `data-context-pin-id`, and
  has the accessible name `Remove "<label>" from context`. It calls
  `removeCardContext(pinId)`.
- When the number of held cards grows: the dock opens, the thread surface is
  shown (creating a chat if there is none), and the composer takes the caret.
  Removing cards does not close the dock or change its surface.
- The composer field's placeholder stays `Message Hermes…`; the pills are what
  name the cards.

## 8. What crosses to the model (contract)

- `CompanionInstructionsInput.focusedCard` becomes
  `focusedCards?: FocusedCardContext[] | null`; `FocusedCardContext` keeps its
  existing shape. `preload.ts` and `vite-env.d.ts` carry the same change.
- `card-context`'s payload for a turn with no cards has **no** `focusedCards`
  key at all, exactly as a no-card turn had none before.
- `apps/desktop/electron/companion-client.ts` renders the turn's card line:
  - 1 card: the old one-card wording, unchanged ("The operator has put ONE
    dashboard card in front of this chat as context: the card titled …").
  - 2–3 cards: one numbered line per card, each with its label, board, ids and
    its **own kind path**:
    - view → `get_view`, then `save_view` with the same `viewId` and
      `boardSlug`; explain figures from the rows `save_view` returns.
    - page → a page card, not a saved view; no `viewId`; read and edit the page.
    - system → a built-in board card, not a saved view; no `viewId`; say what it
      draws from the records behind it and change those records.
    The block ends with: `"these cards"` means all of them; `"this card"`, "it"
    and "this block" mean the one the operator clearly refers to, and if more
    than one could be meant, ask which of the named cards is meant. It never
    asks which cards are in context.
- The rest of `buildInstructions` must not change: a turn with no card is still
  byte-for-byte the turn it was, apart from the removed `focusedCard` branch.

## 9. Falsification

The existing rigs are amended, not bypassed; every claim is read from the real
pages in a real layout engine, and the JSON + screenshot artifacts are the
record.

| Rig | Claims |
|---|---|
| `dashboard-card-context` | no chat icon remains; every card is a click target and has one keyboard toggle; a click adds, a second click removes only that card; three cards hold at once and a fourth is refused with the status line; empty-board clicks clear all; a card's own controls and a drag do not toggle; the locked board still adds/holds/removes without a write; the label comes off the heading; the existing pin-board, menu, archive and delete claims still hold. |
| `card-context` | one pill per card in order, each named; each pill removes only its card; a three-card turn carries `focusedCards` exactly and no `focusedCard`; the click join (real Dashboard + real panel) puts the card in the pill and the caret in the composer; removing the last pill restores the ordinary turn. |
| `dashboard-companion-edit` | the harness hands a card over by clicking the card itself (not a control), the pill appears, and the run's live ring still lands. |
| `agent-prompts-e2e` | one-card wording unchanged; two- and three-card wording names each card, each kind path, and the ambiguity rule; no-card turns carry no card line. |
| Existing dashboard rigs | `dashboard-arrange`, `dashboard-lock-ui`, `dashboard-tile` and the lock/turn rigs still pass: the card is still its own arrange handle and its own tab stop; selecting is not arranging. |

## 10. Not in this design

- No persistence of context cards and no per-chat context: it is the dock's live
  state, as before.
- No change to `Pin`, `PinBoard`, `schemaVersion`, or any vault file. The cards
  are addressed by the ids the pins already carry.
- No new dependency, no new route, no new dialog.
- No drag-to-select, no checkbox mode, no reorder of the held cards: the order
  is the order they were clicked.
