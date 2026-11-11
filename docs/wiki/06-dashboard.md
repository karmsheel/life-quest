# Dashboard

The Dashboard is the home pin board: a page of live cards for one lens. There is
one board for **Life** and one for each unlocked area. It is the surface you
land on and the surface you arrange: the companion brief, goals, deadline
pressure, the week, pending Decisions, recent activity, saved database views and
your own pages, all as cards you can move, resize, lock and hand to the
companion.

The board is a control the operator can open and close, not a fixed layout. A
new board starts with the built-in cards, and everything on it is meant to be
arranged by hand.

Return to [Wiki home](./index.md).

## Where it lives

- Rail: **Home → Dashboard**, route `/home`.
- The main pane. It is a page, not a sheet.
- The board follows the **area lens** in the window title bar: the **Life**
  board has its own pins, and each unlocked area has its own. The lens is a
  quiet **Life** label while zero or one area is unlocked and becomes the
  segmented control, starting with **Life**, once a second area opens.

## What it is for

A life has more moving parts than a list can hold. The Dashboard is where the
parts that matter *now* stay visible without opening each feature: what the
companion is telling you (the brief), what you are reaching for (goals,
deadline), what is queued (today and this week), what needs your judgement
(pending Decisions), what just happened (recent activity), and whatever live
view or page you built for this area.

It is a pin board, not a metrics terminal. Cards are the things you chose to
watch; the board does not grade you.

## How to use it

### Read the board

1. Open **Dashboard** on the Home wing.
2. Choose the area lens in the window title bar: **Life** or an unlocked area.
   The page's eyebrow is **Dashboard**, and the title under it is the lens's
   name — **Life** on the base lens — with a **Locked** or **Unlocked** badge
   beside it.
3. Read the cards. Built-in cards update themselves when the vault changes, when
   a Decision is approved, and when the local day turns over. Every card the app
   ships wears a small blocks marker beside its heading (the **Built-in card**
   marker); a card you created from a page or a saved view wears none.

### Read the companion brief

The **Companion brief** card is the companion's reading of your day: the durable
things a daily note would otherwise lose — a decision, a watch, a commitment, a
pattern — written as a short typed list rather than a paragraph. It is seeded
first on every board, including boards written before the card existed, so it is
the thing you read before the rest. The companion writes it, not you: there is
no editor on the card.

Every item has a **kind**, the line you read, and the **why** beneath it in
muted text:

| Kind | What it is |
|---|---|
| **Watch** | Something to keep an eye on: body, money, a risk |
| **Prompt** | A question to think about, not a task to do |
| **Ahead** | A deadline, renewal or follow-up falling due |
| **Commitment** | You said you would do X and have not |
| **Pattern** | The same thing said, done or avoided N times |

- Items are in **priority order**, most important first, and a brief carries at
  most five.
- An item that passes its expiry is drawn **faded with the word expired** for
  one day, then leaves. The companion sees it in its dismissal log as
  `expired-unseen`, so it learns what nobody acted on.
- **Dismiss** opens the four answers — **Done**, **Not useful**, **Wrong** or
  **Later** — and settles one item, removing it from the card and leaving every
  other item in place. Only you dismiss items; the companion cannot clear its
  own mistakes or mark one done.
- If the companion has not refreshed the brief in more than 48 hours, a quiet
  **Not refreshed since <date>** line says so.
- An empty brief still shows the card and says **Nothing on the brief today**,
  so silence is visible rather than hidden.

The brief is one record for the whole studio, not one per lens. An item can name
an area, in which case it shows only on that area's board; vault-wide items show
everywhere. It is never task-work and it is not your own writing — if you want
to keep something the companion says, put it in a page or a note.

### Add a card

1. Choose the area whose board you want to change; **Life** is the board that
   aggregates.
2. Open the three-dot **Dashboard actions** menu at the page's top-right corner
   and choose **Pin board**. (The item is absent on a locked board and when
   every available card is already pinned.)
3. The **Add pin** row opens. Press a built-in card name, a page title, or a
   saved view title to pin it. Built-in cards appear under their internal names
   — `goal-progress`, `deadline`, `today-week`, `pending-decisions`,
   `recent-log`, `companion-brief` — because they are app furniture, not
   records.
4. The card appears on the board. Choose **Hide pin board** in the same menu to
   close the row.

### Move a card

1. On an unlocked board, hold a card and drag it. It lifts, the board makes
   room, and dropping it commits the new order.
2. With the keyboard: focus a card (an unlocked card is a tab stop), press
   **Enter** to lift it, move with the arrow keys, press **Enter** to drop it,
   or **Escape** to cancel. A status line announces each move.
3. The order is saved to the board file. A write that fails puts the board back
   the way the vault says it is.

### Resize a card

1. Open the card's **Card actions** menu (the three-dot control) and choose
   **Edit card**.
2. Drag the card's right border to set its width, or its bottom border to set
   its height. Drag the width all the way to the row edge to make the card fill
   the row.
3. The keyboard path: focus a border (it is a separator) and use the arrow keys.
4. Press anywhere outside the card, or **Escape**, to leave Edit mode. One drop
   is one write; a drag that ends where it started writes nothing.

### Take a card off the board

1. Open the card's **Card actions** menu.
2. Choose **Archive**. The pin is removed; what the card draws — the page, the
   saved view, the underlying record — is untouched, and the card is offered
   again in **Add pin**.
3. **Delete** is only offered where there is something behind the card (a page
   or a saved view). It asks for confirmation, because it deletes that page or
   view from the vault and from every board that shows it. A built-in card has
   no **Delete**.

### Hand a card to the companion

1. Click anywhere on a card — its body, a heading, a table cell, a chart — and
   it goes into the companion chat's context. The chat dock opens, the card
   gains a ring, and the caret lands in the composer.
2. Click a card already in context and **that card only** comes back out. Click
   another card to add it; the chat holds up to **three** cards at once.
3. Each held card keeps its ring and gets its own pill above the composer,
   carrying the card's name and the words **in context**, in the order you
   picked it. Click a fourth card and nothing is added: a status line says
   **Three cards are already in the chat context — take one out first.**
4. Click empty board space — the board's background, its header text, the gap
   between cards — and every card leaves the context at once. Pressing another
   surface (the chat dock, the rail, another page) leaves the context alone.
5. A card's own controls do their own job: its 3-dot menu, a link, a width or
   height handle, an input, and so on never add or remove the card. The same is
   true on a locked board: asking about a card is not editing the board.
6. With the keyboard, each card carries one hidden context toggle. There is no
   visible icon: focus it and press **Enter** or **Space**. Its accessible name
   says what the press will do — **Add "<card name>" to the chat context**, or
   **Take "<card name>" out of the chat context** when the card is held.

### Lock the board

1. Open the three-dot **Dashboard actions** menu at the page's top-right corner.
   The lock is its **first item**, a switch that reports the state rather than
   naming an action: it reads **Lock**, flips across when the board is locked,
   and says **Saving…** while the write runs. Its accessible name is **Lock this
   dashboard** or **Unlock this dashboard**, and the **Locked**/**Unlocked**
   badge beside the title stays in step with it.
2. While locked: no **Pin board** item, no card menu, no Edit mode, no tab stop
   on the card itself. The hint under the title explains that the companion's
   changes now wait in Decisions. Cards still go into and out of the chat's
   context — by clicking them, by clicking empty board space, and from the
   hidden keyboard toggle.
3. Choose the lock item again to unlock the board and make it editable in place.

The lock is one item in the page's one menu, and every lockable page's menu
leads with its own lock. The Dashboard's **Pin board** action follows it in the
same menu.

## The screen

| Part | What it does |
|---|---|
| **Dashboard** eyebrow + lens title | Names the board; the badge says **Locked** or **Unlocked** |
| Lock hint | One sentence on what the current lock state means |
| **Dashboard actions** menu (three-dot) | The page's one control: the **Lock** switch first, then **Pin board** / **Hide pin board** |
| **Add pin** row | Built-in cards, page titles and saved views not yet on this board |
| Cards | The pinned content: the companion brief, goals, deadline, today & this week, pending decisions, recent activity, views, pages |
| Card context | Click a card to add or remove it as companion chat context, up to three; empty board space clears them all |
| **Card actions** menu | **Edit card**, **Archive**, **Delete** (where applicable) |
| **Built-in card** marker | A small blocks icon in the card's heading row, on the cards the app ships; a view or page you created yourself has none |
| Card borders in Edit mode | Width (right) and height (bottom) handles |
| **Finance** install card | Shown on the Life board and the Finance board while the Finance area is unlocked and the kit is not installed: **Install the kit into the Finance area. It adds the ledger databases and starter pages.** with **Install Finance kit** |

### The built-in cards

| Card | Shows |
|---|---|
| Companion brief (`companion-brief`) | The companion's typed items — watch, prompt, ahead, commitment, pattern — in priority order with the reason beneath; items expire and you dismiss them. Seeded first on the board; an empty brief says so |
| Goals (`goal-progress`) | A count of open goals in the lens. Each goal names the area it is filed under (or **No area**) and, for a metric goal, its current value, pace and a progress bar — a reading, not a score |
| Deadline (`deadline`) | A **Deadline pressure** banner when an open goal in the lens is due within seven days or already overdue: the first goal's name (or that name and "N others") and **Dismiss**, which hides it until tomorrow |
| Today & this week (`today-week`) | Two labelled groups, **Today** and **This week**, each with its task count, and each task with a tick that marks it done |
| Pending decisions (`pending-decisions`) | A count, then up to four pending Decisions visible in this lens, linked to the inbox |
| Recent activity (`recent-log`) | The five newest Life log entries in the lens, one line each: the summary, then the event type and its time |

A saved **view** card draws its blocks — a number, a table, a trend — from an
area database and re-runs when the vault changes. A **page** card shows a page's
title, the area it belongs to, and an **Open page →** link. The built-in cards
wear a small blocks marker in their heading row, so you can tell the app's own
furniture from a card you created; a view or page card has no marker and its
menu offers **Delete**.

**Two cards are gone.** The old **Active agents** and **Doctrine** cards were
removed from the app: they could not be arranged, resized, archived or handed to
the companion, and the Doctrine card duplicated the Dream, Vision and Documents
pages. A board file written by an older build simply stops drawing them on read;
there is no migration write.

## Rules and behaviour

- The Dashboard is a pin board **per lens**: the **Life** board and one board
  for each unlocked area. A locked area has no board in the app, because a
  locked area is invisible to every read.
- An **unlocked** board is editable in place by the operator and by the
  companion. A **locked** board must not be edited in place by an agent, and a
  change to it becomes a pending Decision; the walkthrough is
  [Decisions](./23-decisions.md).
- Agents cannot lock or unlock a board. Approving a Decision that puts a card on
  a locked board does not unlock it. The lock item is operator-only.
- An unlocked board is reorderable by dragging a card to the position it is
  dropped in, and every card is reorderable from the keyboard.
- Every pinned card can be added to companion chat as context, up to three at a
  time; a card in context is named in the chat before the turn is sent and
  ringed on the board. Clicking a card toggles it, clicking empty board space
  takes every card out, and a card's own controls never change the context.
- Selecting or removing context is not a board edit: it writes nothing and works
  on a locked board too.
- Removing a card from the board does not delete what the card draws. Deleting
  what a card draws is confirmed first.
- The board file is `.lifequest/overview-pins.json` for the Life board and
  `domains/<slug>/pins.json` for an area. It stores the pins, their order and
  sizes, and the board's lock state; the board's Decision headline names it,
  e.g. **Life dashboard pins**.
- The **companion brief** is one record for the studio, at
  `.lifequest/companion-brief.json`. It is rewritten wholesale each time — a
  write replaces the active set rather than appending to it — while the
  dismissal log (last 200, kept 90 days) survives so the companion keeps its
  feedback. The card is seeded first on every board; if you remove it, it stays
  removed (the board remembers that it has been offered the card), and **Pin
  board** offers it again by name.
- Only the companion writes the brief, and only you dismiss its items. An item
  lapses at its expiry; the next reader records it as `expired-unseen`. A locked
  board does not stop the companion writing the brief: the lock governs the
  cards, and the brief is a record a card draws. Locking keeps the companion
  from moving, adding, resizing or removing cards.
- The brief's items store an area as `domainSlug` beside their text; the field
  name is legacy, the wording the app uses is area.

These are the Dashboard laws; [`LAWS/DASHBOARD.md`](../../LAWS/DASHBOARD.md) is
the contract.

## Tips and edge cases

- A card's numbers are a function of the vault and the clock: a running
  companion turn marks the cards it is working on (a quiet live state), and a
  view card that redraws with different content pulses once rather than
  animating every vault write.
- The context is live dock state, not a saved setting: it survives turns while
  you hold it, and nothing about it is written to the vault.
- If a card's saved view or page is deleted from the vault, the card leaves
  every board that showed it on the next read. You do not have to unpin it by
  hand. A built-in card the app no longer ships — the removed **Active agents**
  and **Doctrine** cards — leaves the board the same way.
- The board keeps your place when cards reflow: a write that changes a card's
  height does not scroll you away from what you were reading.
- A tick on **Today & this week** finishes the task: it writes the same move to
  Done that the Task Manager board's drag makes, and the task leaves the card
  with the group's count following it.
- A locked board is read-only *here*; the operator can still unlock it from the
  same menu. Locking is not encryption and not a permission system — it is a
  statement that this board is finished for now.
- The blocks marker on a built-in card is information, not chrome: a locked
  board keeps it while the card menu goes away, so you can still tell the app's
  own cards from the ones you created.
- The **Pending decisions** card is the one lens-scoped view of decisions. The
  inbox itself is global: every tab reads the whole vault and the rail badge
  counts every pending Decision, whichever lens you stand in.
- The lens is the filter, not the wing. Switching to another wing and back
  returns you to the same board.
- The Finance install card only appears while the Finance area is unlocked;
  locking Finance takes the offer away with it.
- On a board with no unlocked areas besides Life, the Built-in cards and Life's
  own pages and views are the whole board; unlocking Health, Mind, Finance,
  Business or Relationships gives each its own board and its own pins.

## Related

- [Areas](./05-areas.md)
- [Goals](./10-goals.md)
- [Task Manager](./14-task-manager.md)
- [Data and databases](./19-data-and-databases.md)
- [Pages](./21-pages.md)
- [Decisions](./23-decisions.md)
- [Companion](./24-companion.md)
