# A card the companion edits keeps its slot

**Status:** design
**Date:** 2026-10-16
**Touches:** `packages/vault-core/src/pins.ts`,
`packages/vault-core/src/views-tools.ts`, `packages/vault-core/src/decisions.ts`,
`apps/desktop/e2e/dashboard-card-slot.{html,tsx,mjs,electron.mjs}` (new),
`apps/desktop/tests/dashboard-card-slot-e2e.test.ts` (new)

## 1. The problem, as reported

> I edited a card on the dashboard. After the change, the card moved to the bottom
> of the dashboard — though it communicated it had stayed in place. I want the
> actual behaviour to be the card does not leave the dashboard and the elements
> change within.

That is one report and two claims, and the previous change on this board
(`2026-10-15-dashboard-card-edit-in-place-design.md`) fixed neither of them. It
fixed the *scroll*: a card that re-runs, changes height, and reflows the grid under
a stationary operator. This is the *slot*: the card is not where it was at all, and
`scrollTop` was never the thing that moved.

**Measured, not guessed.** The new rig boots the real app's main process, renders the
real `HomePage` over the real preload, opens a throwaway vault, and plays the
companion's own turn — an HTTP `tools/call` naming `save_view` with a `viewId`,
through the MCP door the app bound, with the token the app minted. On the pre-fix
build, on a board of seven pins with the edited card third:

| Read from | Before the turn | After the turn |
|---|---|---|
| the pins file | `[…, edit, ledger, list, payee, deadline]` | `[…, ledger, list, payee, deadline, **edit**]` |
| the board on screen | edit at index **2** of 7 | edit at index **6** of 7 |
| the card's width on disk | `span 2` | **`span 1`** |
| the card's panels | `table, metric` | `metric, table` |
| the reply to the companion | — | *"was updated in place and **stays pinned** on Overview dashboard"* |

The last row is the "it communicated it had stayed in place": the reply said so
whether or not it had. The fourth is a second, quieter way the card leaves its place
— an edit that names no width was read as *one cell*, so a full-row card was halved
by a change that only meant to reorder its panels.

The panels themselves are the control. They moved, in order, on the pre-fix build:
the write was never the fault, and the card's *contents* were edited correctly the
whole time. Only its place was lost.

## 2. The cause, and why it survived a fix

`writeViewAndPin` rebuilt the board as:

```ts
const pins = [...board.value.pins.filter((p) => !isThisCard(p)), pin];
```

**Every pin except this one, then this one.** That is a correct way to put a *new*
card on the end of a board and a wrong way to change one that is already on it. A
pin's index in the array *is* its place on the board — the grid's auto-placement has
no coordinate to store — so filtering the card out and appending it moves it to the
bottom, every time, by construction.

The same expression was written out a second time in `applyViewDecision`, which is
how an approved Decision on a **locked** board pins what it saved. That is the copy a
fix to the first would have left behind: the card would have kept its place on an
unlocked board and gone to the bottom on approval. Both were measured; both failed.

## 3. The rule

One function, `placeViewPin`, in `pins.ts`, called by both write paths: **a card
that is already pinned keeps its index in the array; only a pin the board does not
already carry is appended.**

It returns what it did — `existed`, `position`, `span` — because the reply to the
companion has to be able to say the truth about the board rather than a reassuring
sentence. `save_view` now answers with `cardKeptItsPlace` and `cardPosition`, and the
note reads *"updated in place and stays where it was on the Overview dashboard — card
3 of 7"*, which is a claim about the board and one that can be false.

Two details that are not incidental:

- **A duplicate is dropped, not replaced.** Two pins for one view on one board is a
  state nothing should produce, but a board that has one must not be left with a
  *third* after an edit. The FIRST occurrence is kept, because it is the one the
  operator has been looking at.
- **A missing `span` means one cell for a card being created, and the card's own
  width for a card being changed.** `spanNamed` travels with the call because "what
  does an absent span resolve to" and "did the caller say anything about width" are
  different questions, and only the second one can tell an edit from a creation.

## 4. What this is NOT

- **Not a scroll fix.** That was the previous change, and it is still in place: the
  hold corrects the board when the edited card changes height, and it is what keeps
  the operator's place inside a leg where the card's box *does* change.
- **Not a freeze on the board's order.** A brand new card still lands at the end —
  asserted in the same run, as the control, because a board that never moves would
  pass "the card did not move" for the wrong reason.
- **Not a patch to `ViewCard`, and not a re-key.** The card was already the same
  React element; it was being asked to be a *different place*.
- **Not a change to what `arrange_dashboard` does.** That tool sets the whole board
  deliberately, and an operator's own ordering is not something to protect from
  itself.

## 5. How it is falsified

`tests/dashboard-card-slot-e2e.test.ts` reads
`e2e/artifacts/dashboard-card-slot.json`, and the rig writes it. The run is
falsified on the pre-fix build — measured, above — and the legs are:

| Leg | Claim |
|---|---|
| `edit` | The board's order is unchanged on disk **and** on screen; the edited card is at the same index; it is the same DOM node; it is drawing different panels; its width survived an edit that named none; the page never reloaded. |
| `reply` | `cardKeptItsPlace` is true and `cardPosition` is the index that was measured — the sentence the companion says is checked against the board rather than trusted. |
| `newCard` | A card created with the same call and no `viewId` lands **last**, reports that it kept no place, and does not disturb the edited card. The control that stops "held still because nothing happened" from passing. |
| `locked` | The board is locked, the same edit files one Decision, and approving it leaves the card at the same index. The second implementation of the rule, through the other door. |

Two preconditions are asserted rather than assumed, because on a board where they do
not hold the whole run proves nothing: the edited card is **third of seven** (a card
already last has nowhere to move to), and the board **scrolls**.

The artifact is `e2e/artifacts/dashboard-card-slot.json`, with a screenshot beside
it: same command, same numbers, no eyeballing the app.
