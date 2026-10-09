# The Dashboard card menu: Archive, and Delete

**Status:** design
**Date:** 2026-10-09
**Touches:** `apps/desktop/src/components/home/PinChrome.tsx`, `apps/desktop/src/pages/HomePage.tsx`,
`apps/desktop/src/styles/global.css`, `LAWS/DASHBOARD.md`

## 1. The problem

A card has no way to be taken off the board except a pin-off glyph, and no way to
get rid of the thing behind it at all. The glyph is the board's least legible
control — `PinOff` reads as "unpin", which is a word about pins, not about the
card in front of the operator — and it is the only removal the board offers: a
saved view the operator has stopped wanting can be unpinned, but it comes back in
the Add-pin list forever, and a page they no longer want is a page they cannot
remove from the board they are looking at.

## 2. What the operator does

```
  ┌────────────────────────┐
  │ 💬 ⠿ ⛶ ⋯             │      ⋯ opens:
  │ WEEKLY EXPENSES        │      ┌───────────────┐
  │ …                      │      │ Archive       │
  └────────────────────────┘      │ Delete        │
                                  └───────────────┘
```

- **Archive** — the card leaves this dashboard. This is what the pin-off glyph
  did, and it is what the Add-pin list offers again. No question: it is
  reversible by re-pinning, and a confirm on a reversible act trains the operator
  to click through the one that is not.
- **Delete** — the thing the card *draws* is deleted from the vault: the saved
  view, or the page and its blocks. It is asked for by name first, and it is the
  only item in the menu that wears the destructive token.

The menu replaces the pin-off glyph rather than joining it: one removal
vocabulary, and the card's corner keeps four controls (chat, move, width, menu)
instead of growing to five.

## 3. Delete, precisely

| Card kind | What Delete removes | Offered? |
|---|---|---|
| `view` | `viewDelete(pin.domainSlug, pin.viewId)` — the saved view file | yes |
| `page` | `pageDelete(pin.domainSlug, pin.pageId)` — the page and its blocks | yes |
| `system` | nothing: a built-in card is app furniture, not a record | **no** |

A built-in card's menu therefore holds Archive alone. That is the honest menu, and
it is the same honesty the companion's own instructions carry for a built-in card.

**Nothing has to be re-pinned by hand.** `listPinBoard` already validates every pin
against the vault and silently drops a view or page pin whose file is gone, and
`deletePage` additionally strips its page pins from the domain board and the
Overview board. So a deleted view or page leaves *every* board that showed it —
including boards the operator is not looking at — without this feature writing a
second file. HomePage's job after a delete is one `load()`.

## 4. The menu is editing chrome

The menu lives inside `.home-pin__chrome`, which means it inherits the lock: **a
locked board draws no menu**, exactly as it draws no grip, no width control, and
no Add-pin row. The lock's own hint already says so ("Unlock to add, move, or
remove cards"), and a Delete offered from a board that calls itself read-only
would be the one hole in it.

The chat control stays, because asking about a card is not changing it — the rule
the previous change established, unchanged.

## 5. One menu at a time

`menuPinId` is a single id, the same rule the chat list and the chain follow: two
open menus on one board is not a state worth supporting. It closes when the
trigger is pressed again, when any other menu is opened, on Escape, on any press
outside the menu (including a press that starts an arrange gesture), and when
either item is chosen.

## 6. Failure modes this design is written against

1. **Delete without a question.** The write happens only in the confirm's `run`,
   and the rig asserts the bridge saw nothing after the menu item was clicked and
   before the dialog was confirmed.
2. **A confirm that names nothing.** The title names the card, read off the card's
   own heading by the same reader the chat uses — `Delete "Weekly expenses"?`, not
   `Delete card?`.
3. **A deleted thing that leaves a dead card behind.** The rig's stub drops the
   view from the vault the way the real one does, so the card leaving the board is
   proven through `listPinBoard`'s own validation rather than asserted.
4. **A destructive item on a built-in card.** The rig asserts a system card's menu
   has no Delete item at all.
5. **A menu on a locked board.** Asserted in both states.
6. **A menu that outlives its card.** The trigger, the popup and the open id all
   key off the pin, so a card removed by any path takes its menu with it.

## 7. Not in this design

- No Delete for built-in cards, no "reset the board", and no multi-select.
- No undo. The confirm is the guard, and the life log records both writes
  (`view.deleted` / the page's own line) as it already does.
