# Dashboard Card Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every unlocked card a 3-dot menu holding **Archive** (off this board) and **Delete** (the saved view or page itself, behind a confirm).

**Architecture:** The menu is the fourth control in the card's existing editing chrome, so it inherits the page lock and needs no gate of its own. `PinChrome` draws the trigger and the popup; `HomePage` owns which menu is open, asks the app's own `useConfirm` dialog, and runs the one write. Nothing re-pins by hand: `listPinBoard` already drops a pin whose view or page is gone, so a delete needs one `load()`.

**Tech Stack:** React 19, TypeScript, `lucide-react` 0.511.0, `useConfirm` / `ConfirmDialog` (existing primitives), Electron `webContents.sendInputEvent` for input in the rig.

**Spec:** `docs/superpowers/specs/2026-10-09-dashboard-card-menu-design.md`. When this plan and the spec disagree, follow the spec.

## Global Constraints

- E2E is the sole testing mechanism. **No unit test**, and no new dependency.
- **No `packages/vault-core/` change.** `viewDelete`, `pageDelete`, `listPinBoard`'s validation and `setPins`' lock gate are all untouched.
- The menu is **inside `.home-pin__chrome`**, so a locked board draws no menu and no `.home-pin__menu`. Do not gate it a second time.
- The menu replaces `pin-unpin` in the chrome. The chrome's button set becomes exactly `pin-grip`, `pin-span` (view pins), `pin-menu-toggle`, and the count stays at three (four on a view pin) — the title's `7.4rem` reserve is unchanged.
- New hooks, exact: `.home-pin__menu`, `data-testid` `pin-menu-toggle` / `pin-menu` / `pin-archive` / `pin-delete`, and `.home-pin__menu-danger` on Delete.
- The dialog is the app's own: `useConfirm()` → `{ ask, dialog }`, `{dialog}` rendered once at the end of `.home-dashboard`. Never `window.confirm`.
- Delete is offered **only** for `view` and `page` pins. A `system` pin's menu holds Archive alone.
- The card's name in the dialog title is read off the card's own heading with `cardNameIn` — never rebuilt from the pin.
- The delete write goes through `moveBusy` (renamed `boardBusy`, since it now guards a delete as well as a pin write) so the arrange gesture stays locked out while it is in flight.
- The rig's `viewDelete` stub must **remove the view from the harness's vault**, so "the card leaves the board" is proven through `listPinBoard`'s real validation rather than asserted.
- Focused loop: from `apps/desktop`, with `npm run dev` up, clear `ELECTRON_RUN_AS_NODE` and run the rig under Electron:
  `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; & (node -p "require('electron')") e2e/<rig>.electron.mjs`
  Full proof: from the repo root, `npm test`.
- Rigs apply the app skin first and the driver fails if `document.documentElement.dataset.skin` disagrees; artifacts land in the gitignored `e2e/artifacts/` and are never staged.
- Windows commits use two `-m` flags, staged paths only, no `git add -A`.

---

### Task 1: The menu, and Archive

**Files:**
- Modify: `apps/desktop/src/components/home/PinChrome.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/e2e/dashboard-card-context.electron.mjs`
- Modify: `apps/desktop/tests/card-context-e2e.test.ts`

**Interfaces:**
- Produces: `PinChrome` props `menuOpen: boolean`, `onToggleMenu: () => void`, `onArchive: () => void`, `onDelete?: (control: HTMLElement) => void`
- Produces: `.home-pin__menu` and the four new `data-testid`s

- [ ] **Step 1: Extend the failing rig**

In `dashboard-card-context.electron.mjs`:

- the `CHROME` fixture loses `pin-unpin` and gains `pin-menu-toggle`;
- new scenarios:
  - `every-card-offers-the-menu` — every unlocked card has exactly one `pin-menu-toggle` drawing `lucide-more-vertical`, icon-only, with an `aria-label` and a `title`; no card offers `pin-unpin` anywhere any more.
  - `the-menu-holds-archive` — click a card's trigger → exactly one `.home-pin__menu` exists, `role="menu"`, its items are `["Archive"]` for a built-in card and `["Archive", "Delete"]` for a view and for a page card.
  - `archive-takes-the-card-off-the-board` — open a built-in card's menu, click `pin-archive` → one `pinsSet` carrying the seeded board minus that pin, the card is gone from the DOM, and the menu is closed.
  - `one-menu-at-a-time` — open one card's menu, then another's → exactly one menu, on the second card.
  - `escape-closes-the-menu` and `a-press-away-closes-the-menu` — Escape, and a real `mouseDown` on the board's background, each leave zero menus open.
  - `a-locked-board-has-no-menu` — re-render locked → zero `pin-menu-toggle`, zero `.home-pin__menu`, and still the chat control on every card.

In `dashboard-arrange.electron.mjs`: `expectedIcons` swaps `"pin-unpin": "lucide-pin-off"` for `"pin-menu-toggle": "lucide-more-vertical"`.

- [ ] **Step 2: Run the rigs and confirm they fail**

Both → FAIL: there is no `pin-menu-toggle`, and `chrome-identity` reports `pin-unpin` as an unexpected control.

- [ ] **Step 3: Implement the menu and Archive**

`PinChrome.tsx`: the trigger is the chrome's last button (`MoreVertical`, `data-testid="pin-menu-toggle"`, `aria-haspopup="menu"`, `aria-expanded={menuOpen}`), and the popup hangs under the chrome (`role="menu"`, one `role="menuitem"` button per action). Archive is `onArchive`; Delete renders only when `onDelete` is given, wears `.home-pin__menu-danger`, and passes its own element up so the dialog can name the card.

`HomePage.tsx`: `menuPinId` state; `onArchive(pinId)` is the existing unpin plus closing the menu; a `pointerdown`/`keydown` effect closes the menu on any press outside `.home-pin__menu` or a trigger, and on Escape.

`global.css`: `.home-pin__chrome { position: relative }`, and `.home-pin__menu` styled on the chat list's menu idiom — the same hairline, `--radius-sm`, `--card`, `--shadow-sm`, 0.75rem items, `--selected-soft` hover, `--danger` for the destructive item.

- [ ] **Step 4: Run the rigs and the suite, and confirm both pass**

- [ ] **Step 5: Commit**

---

### Task 2: Delete, and the question it asks

**Files:**
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/e2e/dashboard-card-context.tsx`
- Modify: `apps/desktop/e2e/dashboard-card-context.electron.mjs`
- Modify: `apps/desktop/tests/card-context-e2e.test.ts`
- Modify: `LAWS/DASHBOARD.md`

**Interfaces:**
- Consumes: `useConfirm`, `api().viewDelete`, `api().pageDelete`
- Produces: the harness stubs `viewDelete` / `pageDelete`, which record the call and drop the view from the harness's vault

- [ ] **Step 1: Extend the failing rig**

The harness's `viewDelete` records `{slug, viewId}` in `dashboardCardContextDeletes` and removes the view from its own list, so `viewList`/`viewGet`/`viewRunSaved` stop answering for it and `listPinBoard`'s validation drops the pin. `pageDelete` does the same for the page.

New scenarios:

- `delete-asks-before-it-writes` — open the view card's menu, click `pin-delete` → the app's own dialog is up (`role="dialog"`, `aria-modal="true"`), its title names the card (`Delete "Weekly expenses"?`), the confirming control is marked destructive, and **no delete reached the bridge**.
- `cancelling-deletes-nothing` — press Cancel → the dialog is gone, the card is still on the board, `dashboardCardContextDeletes` is empty.
- `deleting-a-view-takes-the-card-with-it` — confirm → exactly one `viewDelete` with `{slug: "financial", viewId: "v-weekly"}`, and after the reload the card is gone from the grid (proven through the pin board's own validation, not asserted), and no `pinsSet` was needed.
- `deleting-a-page-takes-the-card-with-it` — the same through a page pin, with `pageDelete`.
- `a-built-in-card-has-no-delete` — a system card's menu has one item, and it is Archive.

- [ ] **Step 2: Run the rig and confirm it fails**

→ FAIL on all five: there is no Delete item and no dialog.

- [ ] **Step 3: Implement the question and the writes**

`HomePage.tsx`: `useConfirm()`; `onDeleteRequest(pin, control)` builds the title from `cardNameIn(control.closest(".home-pin"))` and the message from the pin's kind, and passes `run: () => void runDelete(pin)`. `runDelete` calls `viewDelete` or `pageDelete`, then `await load()` and `refresh()`, guarded by `boardBusy`. `{dialog}` renders once at the end of `.home-dashboard`.

- [ ] **Step 4: Add the law**

`LAWS/DASHBOARD.md`:

```
Deleting what a Dashboard card draws MUST be confirmed by the operator first.
```

- [ ] **Step 5: Run the rigs and the suite, and confirm both pass**

- [ ] **Step 6: Commit**

---

## Done means

- Every unlocked card has a 3-dot menu; a locked board has none.
- Archive takes the card off this board, with one `pinsSet`, no question.
- Delete is offered only where there is something behind the card, asks by name, and writes nothing until the question is answered.
- A deleted view or page takes its card off every board it was on, without this feature writing a second file.
- `e2e/artifacts/dashboard-card-context.json` carries the claims.
