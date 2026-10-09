# Dashboard card context: the pin board on top, and a card handed to the chat

**Status:** design
**Date:** 2026-10-09
**Touches:** `apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/state/ChatDockProvider.tsx`,
`apps/desktop/src/components/hermes/ChatPanel.tsx`, `apps/desktop/src/components/home/*`,
`apps/desktop/src/styles/global.css`, `apps/desktop/electron/companion-client.ts`,
`apps/desktop/src/vite-env.d.ts`, `apps/desktop/electron/preload.ts`, `LAWS/DASHBOARD.md`

## 1. The two problems

**The pin board is in the way and in the wrong place.** `HomePage` renders its
"Add pin" row *below* the grid. On a board of seven cards it is off the bottom of
the window, so the operator has to scroll past everything they own to add
something, and the row is permanent furniture for a control used once in a
while. It belongs at the top, where the page's controls already are, and behind a
toggle so the board is the page.

**A card has no way into the conversation.** The companion already knows which
*board* the operator is looking at — `viewingBoard` carries the lens into every
turn's instructions, and `buildInstructions` anchors "the Dashboard" to it. It
knows nothing about a *card*. So "make this shorter", "why is this week so high",
"change that to a bar chart" all need the operator to name the card in prose, and
the model has to guess which of seven cards on the board they mean. The board
draws the card; the chat should be able to be *pointed at* it.

## 2. What the operator does

```
Dashboard  Financial                        [Pin board ▾]   [Lock]
──────────────────────────────────────────────────────────────────
  Pin board (open)
  ┌──────────────────────────────────────────────────────────────┐
  │ 📌 Add pin                                                   │
  │ [deadline] [today-week] [Weekly expenses] [Ledger] …          │
  └──────────────────────────────────────────────────────────────┘
──────────────────────────────────────────────────────────────────
  ┌────────────────────────┐  ┌────────────────────────┐
  │ 💬 ⠿ ⛶ 📌              │  │ 💬 ⠿ 📌                │
  │ GOALS                  │  │ WEEKLY EXPENSES        │
  │ …                      │  │ …                      │
  └────────────────────────┘  └────────────────────────┘
```

1. **The pin board is a toggle at the top of the header.** Closed on landing; the
   button carries `aria-expanded`. Open, the row renders *above* the grid. A
   locked board has no toggle at all, exactly as it had no Add-pin row: the lock
   already says the board is not editable here.
2. **Every card grows a chat control** — the first button in the card's own
   control row, wearing `MessageSquare`. It is *not* board-editing chrome: it is
   present on a locked board too, because asking about a card is not changing it.
3. **Clicking it hands that card to the chat.** The dock opens, and a pill appears
   above the composer naming the card. The operator types "make this a bar chart"
   with no card named, and the turn carries the card.
4. **The pill is removable**, and it persists across turns while it is there: the
   follow-up "why is that number so high?" is about the same card.

## 3. The card's name

The name the model is given, and the name the pill shows, is read **off the
card's own heading** at the moment the control is clicked — the same rule
`usePinArrange` already follows for what it speaks aloud: *a card's heading is the
only name it has, and a name that disagrees with the screen is worse than no name.*

`cardNameIn(card)` reads `.home-card__title, .view-card__title,
.deadline-banner__label` and joins the heading's **own text nodes**, so
`<h2>Goals<span class="home-card__count">3</span></h2>` is "Goals" and not
"Goals3". A card whose heading did not paint falls back to the pin's own id.

The control's own accessible name is the generic one every other per-card control
uses ("Move card", "Unpin card"): `Ask the companion about this card`. It does
not need the card's name, because the name that matters is the one that travels
with the card.

## 4. What crosses to the model

`ChatDockProvider` holds the pair — the `Pin` and the name read off its card —
plus the board slug the pin sits on. The flattened, IPC-serializable form is
`FocusedCardContext`:

```ts
type FocusedCardContext = {
  label: string;                 // "Weekly expenses"
  pinId: string;                 // "view:financial:v-weekly"
  kind: "system" | "view" | "page";
  boardSlug: string | null;      // null = the Overview board
  domainSlug: string | null;     // the view's/page's own domain, not the board's
  viewId?: string;               // a view card: the key save_view updates in place
  pageId?: string;               // a page card
  system?: string;               // a built-in card: "goal-progress", …
};
```

`ChatPanel` puts it on the turn as `instructionsContext.focusedCard`, absent when
no card is in context — a turn with no card is byte-for-byte the turn it was
before this feature. `buildInstructions` renders **one** line, chosen by kind,
because the three kinds can be changed in three different ways and a model told
the wrong one will promise something it cannot do:

- **view** — `get_view` for its spec, then `save_view` with the *same* `viewId`
  and the same `boardSlug`, which is the documented in-place edit; explain the
  figures from the rows it already returns.
- **system** — a built-in card with no spec and no `viewId`. `save_view` cannot
  change it and must not be offered; say what it draws from the records behind it,
  and change those records with the tool that owns them.
- **page** — a page card, not a view: read the page and edit it; `save_view`
  cannot change it.

Every one of the three ends by naming the card and saying that "this card", "it"
and "this block" mean it, so the operator never has to describe the card they are
looking at.

## 5. Where the card control lives in the DOM

```
.home-pin
  .home-pin__tools            ← new: absolute, top-right, one flex row
    [pin-chat]                ← always present
    .home-pin__chrome         ← editing chrome; absent while locked
      [grip] [span] [unpin]
  …the card…
```

The wrapper is what makes the two kinds of control one row **and** keeps the
existing rig claim intact: `.home-pin__chrome` still means *board-editing chrome*,
so a locked board still draws zero of them, and `dashboard-lock-ui` still proves
it. `.home-pin:has(.home-pin__tools)` now carries the title's right-hand reserve
(the four buttons, up from three), and the deadline banner's static-row exception
moves from `.home-pin__chrome` to the wrapper.

## 6. Failure modes this design is written against

1. **The pill shows a card the turn does not carry.** The pill and the turn read
   the same `FocusedCardContext`; the driver asserts the payload's `focusedCard`
   against the pill's own words.
2. **The name disagrees with the screen.** The name is read off the rendered
   heading at click time, never rebuilt from the pin.
3. **The model is told to `save_view` a card that has no spec.** The line is
   per-kind, and the system-card leg says in as many words that it cannot be.
4. **A turn with no card changes shape.** `focusedCard` is optional and omitted,
   and the driver asserts its absence.
5. **The chat control is mistaken for board-editing chrome.** It is outside
   `.home-pin__chrome`, so a locked board draws zero chrome bars and zero chrome
   buttons while still offering the chat control; a hold on it does not lift the
   card and writes nothing.
6. **The pin board moves to the top and disappears.** The toggle's
   `aria-expanded` and the section's presence are asserted in both states, and the
   section's DOM order against the grid is asserted, not eyeballed.
7. **A locked board grows an add path.** The toggle is absent while locked.

## 7. Not in this design

- No persistence of the context card, and no per-chat context. It is the dock's
  live state, like the pending receipt.
- No change to `Pin`, `PinBoard`, `schemaVersion`, or any vault file. The card is
  addressed by the ids the pin already carries.
- No new dependency.
