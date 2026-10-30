# Dashboard

The Dashboard is the home pin board: a page of live cards for one lens. There is
one board for **Overview** and one for each live domain. It is the surface you
land on and the surface you arrange: goals, deadline pressure, the week, pending
Decisions, recent activity, doctrine progress, saved database views and your own
pages, all as cards you can move, resize, lock and hand to the companion.

The board is a control the operator can open and close, not a fixed layout. A new
board starts with the built-in cards, and everything on it is meant to be
arranged by hand.

Return to [Wiki home](./index.md).

## Where it lives

- Rail: **Home → Dashboard**, route `/home`.
- The main pane. It is a page, not a sheet.
- The board follows the **domain lens** in the top bar: Overview has its own
  board; each domain has its own.

## What it is for

A life has more moving parts than a list can hold. The Dashboard is where the
parts that matter *now* stay visible without opening each feature: what you are
reaching for (goals, deadline), what is queued (today and this week), what needs
your judgement (pending Decisions), what just happened (recent activity), and
whatever live view or page you built for this domain.

It is a pin board, not a metrics terminal. Cards are the things you chose to
watch; the board does not grade you.

## How to use it

### Read the board

1. Open **Dashboard** on the Home wing.
2. Choose a lens in the top bar: **Overview** or a domain. The title under
   **Dashboard** changes to the lens name, with a **Locked** or **Unlocked** badge
   beside it.
3. Read the cards. Built-in cards update themselves when the vault changes, when
   a Decision is approved, and when the local day turns over.

### Add a card

1. Choose the lens whose board you want to change.
2. Press **Pin board** in the header. (The control is absent on a locked board,
   and when every available card is already pinned.)
3. The **Add pin** row opens. Press a built-in card name, a page title, or a saved
   view title to pin it. Built-in cards appear under their internal names —
   `goal-progress`, `deadline`, `today-week`, `pending-decisions`, `recent-log`,
   `doctrine-progress` — because they are app furniture, not records.
4. The card appears on the board. Press **Hide pin board** to close the row.

### Move a card

1. On an unlocked board, hold a card and drag it. It lifts, the board makes room,
   and dropping it commits the new order.
2. With the keyboard: focus a card (an unlocked card is a tab stop), press
   **Enter** to lift it, move with the arrow keys, press **Enter** to drop it, or
   **Escape** to cancel. A status line announces each move.
3. The order is saved to the board file. A write that fails puts the board back
   the way the vault says it is.

### Resize a card

1. Open the card's **Card actions** menu (the three-dot control) and choose
   **Edit card**.
2. Drag the card's right border to set its width, or its bottom border to set its
   height. Drag the width all the way to the row edge to make the card fill the
   row.
3. The keyboard path: focus a border (it is a separator) and use the arrow keys.
4. Press anywhere outside the card, or **Escape**, to leave Edit mode. One drop is
   one write; a drag that ends where it started writes nothing.

### Take a card off the board

1. Open the card's **Card actions** menu.
2. Choose **Archive**. The pin is removed; what the card draws — the page, the
   saved view, the underlying record — is untouched, and the card is offered
   again in **Add pin**.
3. **Delete** is only offered where there is something behind the card (a page or
   a saved view). It asks for confirmation, because it deletes that page or view
   from the vault and from every board that shows it. A built-in card has no
   **Delete**.

### Hand a card to the companion

1. Press the chat control in a card's corner. Its accessible name is **Ask the
   companion about this card**.
2. The chat pane opens with the card named in its context pill, and the card gains
   a ring on the board so you can see which one the chat is holding.
3. Press the control again — now named **Take this card out of the chat** — to
   take it back off. Pressing another card's control puts *that* card in context
   instead.
4. The control works on a locked board too: asking about a card is not editing the
   board.

### Lock the board

1. Press **Lock** in the header. The badge changes to **Locked** and the hint
   explains that the companion's changes now wait in Decisions.
2. While locked: no **Pin board** row, no card menu, no Edit mode, no tab stop on
   the cards. The chat control stays.
3. Press **Unlock** to make it editable in place again.

## The screen

| Part | What it does |
|---|---|
| **Dashboard** eyebrow + lens title | Names the board; the badge says **Locked** or **Unlocked** |
| Lock hint | One sentence on what the current lock state means |
| **Pin board** / **Hide pin board** | Opens the **Add pin** row; absent on a locked or fully-pinned board |
| **Lock** / **Unlock** | Flips the board's page lock |
| **Add pin** row | Built-in cards, page titles and saved views not yet on this board |
| Cards | The pinned content: goals, deadline, today & this week, pending decisions, recent activity, doctrine progress, views, pages |
| Card chat control | Adds or removes the card as companion chat context |
| **Card actions** menu | **Edit card**, **Archive**, **Delete** (where applicable) |
| Card borders in Edit mode | Width (right) and height (bottom) handles |
| **Active agents** card | Always shown; lists hired agents and links to Personnel |
| **Finance** install card | Shown on Overview and the Financial board when the kit is not installed yet |

### The built-in cards

| Card | Shows |
|---|---|
| Goals (`goal-progress`) | Open goals in this lens with current value, pace and definition of done; a progress bar, not a score |
| Deadline (`deadline`) | Deadline pressure for the lens; can be dismissed until tomorrow |
| Today & this week (`today-week`) | Tasks scheduled for today and queued this week |
| Pending decisions (`pending-decisions`) | Pending Decisions visible in this lens, linked to the inbox |
| Recent activity (`recent-log`) | The newest Life log entries |
| Doctrine (`doctrine-progress`) | How much of the lens's doctrine is filled and locked |

A saved **view** card draws its blocks — a number, a table, a trend — from a
domain database and re-runs when the vault changes. A **page** card shows a page's
title and domain and opens it.

## Rules and behaviour

- The Dashboard is a pin board **per lens**: the Overview board and one board for
  each live domain.
- An **unlocked** board is editable in place by the operator and by the
  companion. A **locked** board must not be edited in place by an agent, and an
  agent change to it appears as a pending Decision.
- Agents cannot lock or unlock a board. Approving a Decision that puts a card on
  a locked board does not unlock it.
- An unlocked board is reorderable by dragging a card to the position it is
  dropped in, and every card is reorderable from the keyboard.
- Every pinned card can be added to companion chat as context; a card in context
  is named in the chat before the turn is sent and marked on the board.
- Removing a card from the board does not delete what the card draws. Deleting
  what a card draws is confirmed first.
- The board file is `.lifequest/overview-pins.json` for Overview and
  `domains/<slug>/pins.json` for a domain. It stores the pins, their order and
  sizes, and the board's lock state.
- The **Active agents** card is always present and is not a pin.

These are the Dashboard laws; [`LAWS/DASHBOARD.md`](../../LAWS/DASHBOARD.md) is
the contract.

## Tips and edge cases

- A card's numbers are a function of the vault and the clock: a running companion
  turn marks the card it is working on (a quiet live state), and a view card that
  redraws with different content pulses once rather than animating every vault
  write.
- If a card's saved view or page is deleted from the vault, the card leaves every
  board that showed it on the next read. You do not have to unpin it by hand.
- The board keeps your place when cards reflow: a write that changes a card's
  height does not scroll you away from what you were reading.
- A locked board is read-only *here*; the operator can still unlock it. Locking is
  not encryption and not a permission system — it is a statement that this board
  is finished for now.
- The lens is the filter, not the wing. Switching to another wing and back returns
  you to the same board.

## Related

- [Domains](./05-domains.md)
- [Goals](./10-goals.md)
- [Data and databases](./19-data-and-databases.md)
- [Pages](./21-pages.md)
- [Decisions](./23-decisions.md)
- [Companion](./24-companion.md)
