# Dashboard Multi-Card Chat Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** executing in the `feat/multi-card-chat-context` worktree. The spec and
this plan land first; source, rigs, laws and wiki change in the same branch.

**Goal:** Make the card itself the companion chat's context control — a click
toggles a card in or out, empty board space clears them all, one removable pill
per card sits above the composer — and let the chat hold up to three cards
instead of one.

**Problem:** The only way to point the chat at a card was a small
`MessageSquare` button in the card's corner, and the chat held exactly one card.
The operator's attention is on the card, not the corner, and a conversation about
a board is rarely about a single card. The corner control says nothing about the
card's content; the card itself is the thing to point at.

**Behaviour:**
1. Click anywhere on a card (its body, a heading, a cell, a chart) to add it to
   the chat's context; the ring appears, the dock opens on its thread, and the
   caret lands in the composer. Click a card already held and only that card comes
   out.
2. Click empty board space — the board's background, header text, gap between
   cards — to clear every card at once. Presses on other surfaces (chat dock,
   rail, another page) leave the context alone.
3. Up to three cards hold at once. Each held card keeps its ring, and the composer
   shows one pill per card in the order added; a fourth add is refused with the
   visible status line `Three cards are already in the chat context — take one out
   first.`
4. A card's own controls (3-dot menu, menu item, width/height handle, link, input)
   do their own job and never change the context; the card's context toggle is the
   one control that does.
5. The card carries one visually hidden keyboard/AT toggle
   (`data-testid="pin-context-toggle"`), with `aria-pressed` and an accessible
   name that announces the next press; no visible icon.
6. Locked boards behave the same: selecting and removing context writes nothing.

**Architecture:** `ChatDockProvider` owns `contextCards: ChatCardContext[]`.
`MAX_CONTEXT_CARDS = 3` is the single source of the cap, exported from the
provider; `toggleCardContext` removes a held pin, adds when there is room, and
returns `"full"` without changing anything otherwise. The board draws each ring
from that same array and keeps no second copy, so a pill removal and a card
deselect cannot disagree. The card body mutates nothing: no pin write, no view
write, no vault call. `ChatPanel` renders the pills and puts the flattened
`FocusedCardContext[]` on the turn as `focusedCards`; `companion-client.ts`
renders the one-card wording unchanged and a numbered per-card block with each
card's own kind path for two or three.

**Tech Stack:** React 19, TypeScript, `lucide-react` 0.511.0 (already a
dependency), Electron `webContents.sendInputEvent` for input in the rigs,
`node:test` as the rig wrapper, the `/root/.local/bin/lifequest-e2e` bench
wrapper.

**Spec:** `docs/superpowers/specs/2026-11-05-dashboard-multi-card-context-design.md`.
When this plan and the spec disagree on behavior, follow the spec. This plan
supersedes the chat-control parts of
`docs/superpowers/specs/2026-10-09-dashboard-card-context-design.md` and
`docs/superpowers/specs/2026-10-16-dashboard-card-in-context-mark-design.md`.

## Global Constraints

- The repo's standing rule is E2E as the sole testing mechanism. **Do not add a
  unit test** for the toggle, the cap, the name reader, or the instruction line;
  they are exercised through the real pages in the rigs.
- **No new dependency, no new route, no new dialog.** No `packages/vault-core/`
  change and no schema change: `Pin`, `PinBoard`, `schemaVersion`,
  `setPins` and `setPinBoardLocked` are untouched.
- `MAX_CONTEXT_CARDS = 3`, exported from `ChatDockProvider.tsx`, is the only place
  the number lives. The toggle refuses the fourth add; the renderer never draws a
  fourth pill.
- No compatibility aliases: `contextCard`, `setContextCard`, `livePinId` and
  `setLivePinId` are gone, and every consumer is updated to the array.
- The click target is `[data-pin-id]`. A primary click (button 0) toggles only
  when its event target is inside the card and not inside `a, button, input,
  select, textarea, [role="button"], [role="menu"], [role="menuitem"],
  [role="separator"], [data-pin-handle]`. No toggle while an arrange drag or a
  220 ms hold is in flight: `usePinArrange` gains
  `consumeClickSuppression(): boolean`, set when a gesture lifts the card or
  cancels an armed press by drift, and read before every toggle. No toggle while
  Edit mode is on (`editingPinId !== null`).
- Hooks that MUST survive, because existing rigs count or read them:
  `data-pin-id`, `.home-pin__chrome`, `.home-pin__chrome .home-pin__btn`,
  `.home-pin`, `.home-dashboard__grid`, `.home-pin--span2`,
  `data-testid` `pin-grip` / `pin-span` / `pin-unpin` / `pin-menu-toggle` /
  `board-add-pin` / `board-lock-badge` / `board-lock-toggle` /
  `board-lock-hint` / `pin-arrange-status`.
- Hooks that MUST be gone: `[data-testid="pin-chat"]`, `.home-pin__chat`, and any
  visible `MessageSquare` icon on a card. A rig asserting their absence is part of
  the claim.
- New hooks, and they are exact: `data-testid="pin-context-toggle"` on the hidden
  keyboard control; `data-testid="pin-context-status"` on the fourth-card refusal;
  `data-context-pin-id` on each `chat-context-pill` and its
  `chat-context-remove` button.
- The pill's remove button is named `Remove "<label>" from context`; the keyboard
  toggle is named `Add "<card name>" to the chat context` when out and
  `Take "<card name>" out of the chat context` when in. The name is read off the
  card's own heading at click time (never rebuilt from the pin), as before.
- A card's ring is `.is-in-context` on any number of cards at once; a card a
  running turn is working on also wears `.is-live`, derived from `livePinIds`.
- The empty-board handler lives on the Dashboard root only, and only clears when
  `contextCards.length > 0`. It ignores presses inside `[data-pin-id]` and inside
  the control selectors above, so header, menu and dialog controls keep their
  behaviour.
- The context is the dock's live state: not persisted, not per-chat, no vault
  file. Removing every card does not close the dock or change its surface.
- A turn with no cards has **no** `focusedCards` key at all, exactly as a no-card
  turn had no `focusedCard` before. A one-card turn's wording is unchanged.
- Work in the worktree with its own `npm ci`; never symlink the primary
  checkout's `node_modules`. E2E goes through the bench wrapper, never a bare
  `npm test` (it may run another branch), and a skipped rig is evidence of
  nothing.
- Rigs apply the app's own skin before their first render
  (`e2e/apply-app-skin.ts`) and the driver fails if
  `document.documentElement.dataset.skin` disagrees. Artifacts land in the
  gitignored `apps/desktop/e2e/artifacts/` — never stage one.
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`.
  Do not merge or push.

## Files Touched

| Area | Files |
|---|---|
| Dock state | `apps/desktop/src/state/ChatDockProvider.tsx` |
| Board interaction | `apps/desktop/src/pages/HomePage.tsx`, `apps/desktop/src/components/home/usePinArrange.ts`, `apps/desktop/src/styles/global.css` |
| Composer | `apps/desktop/src/components/hermes/ChatPanel.tsx`, `apps/desktop/src/styles/global.css` |
| Turn payload | `apps/desktop/electron/preload.ts`, `apps/desktop/electron/companion-client.ts`, `apps/desktop/src/vite-env.d.ts` |
| Rig pages and probes | `apps/desktop/e2e/dashboard-card-context.{html,tsx}`, `apps/desktop/e2e/card-context.{html,tsx}`, `apps/desktop/e2e/chat-dock-probe.tsx` |
| Drivers | `apps/desktop/e2e/dashboard-card-context.electron.mjs`, `apps/desktop/e2e/card-context.electron.mjs`, `apps/desktop/e2e/dashboard-companion-edit.electron.mjs`, `apps/desktop/e2e/dashboard-arrange.electron.mjs`, `apps/desktop/e2e/dashboard-lock-ui.electron.mjs` |
| Existing rigs that must stay green | `apps/desktop/e2e/dashboard-tile.electron.mjs` and the lock/turn rigs (verify only unless a removed selector breaks them) |
| Wrappers | `apps/desktop/tests/card-context-e2e.test.ts`, `apps/desktop/tests/agent-prompts-e2e.test.ts`, `apps/desktop/tests/dashboard-companion-edit-e2e.test.ts` |
| Laws and wiki | `LAWS/DASHBOARD.md`, `docs/wiki/06-dashboard.md`, `docs/wiki/24-companion.md`, `docs/wiki/33-glossary.md` |
| Specs and plan | the new spec, this plan, and the superseded-spec status lines |

---

### Task 1: The dock holds three cards, not one

**Files:**
- Modify: `apps/desktop/src/state/ChatDockProvider.tsx`
- Modify: `apps/desktop/e2e/chat-dock-probe.tsx`

**Interfaces:**
- Produces: `export const MAX_CONTEXT_CARDS = 3`
- Produces: `contextCards: ChatCardContext[]`,
  `toggleCardContext(card): "added" | "removed" | "full"`,
  `removeCardContext(pinId)`, `clearCardContext()`,
  `livePinIds: string[]`, `setLivePinIds(pinIds)`
- Produces: `ChatDockProbe` mirroring `{ open, contextCards, livePinIds }` and the
  three actions under its `channel`
- Consumes: `Pin` and the existing dock value shape

- [ ] **Step 1: Replace the single card with the ordered array**

Keep `ChatCardContext` (`pin`, `label`, `boardSlug`). Replace `contextCard` /
`setContextCard` with the array and the three actions. `toggleCardContext` checks
the held pin ids first (remove), then `MAX_CONTEXT_CARDS` (return `"full"` without
a change), then appends. A pin id appears at most once. Set `livePinIds` from the
same array on `run.started`, empty it on every terminal frame.

- [ ] **Step 2: Fail the probe until it mirrors the array**

`ChatDockProbe` exposes `contextCards` and the actions so both rigs can read and
seed the dock without reaching into React. Both context rigs fail against the
stale one-card probe; that failure is the first evidence the state changed.

### Task 2: The card is the control

**Files:**
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-card-context.{tsx,electron.mjs}`

**Interfaces:**
- Produces: `consumeClickSuppression(): boolean` on the arrange controller
- Produces: `data-testid="pin-context-toggle"` and
  `data-testid="pin-context-status"`, `.is-in-context` on held cards,
  `cursor: pointer` on `.home-pin[data-pin-id]`
- Removes: `data-testid="pin-chat"`, `.home-pin__chat`, the `MessageSquare` import
  and the `.home-pin__tools` chat button (the wrapper itself may stay if the
  chrome still needs it)
- Consumes: `contextCards`, `toggleCardContext`, `removeCardContext`,
  `clearCardContext`, `MAX_CONTEXT_CARDS`; `cardNameIn`

- [ ] **Step 1: Add the failing card-interaction scenarios**

In `dashboard-card-context.electron.mjs`, on the real board: no `pin-chat` and no
visible `MessageSquare` anywhere; every `[data-pin-id]` is a click target with
exactly one hidden `pin-context-toggle`; a click adds, a second click removes only
that card; three cards hold at once and a fourth is refused with the status line
(text and visible paint); empty-board clicks clear all and card presses do not; a
card's own controls (menu trigger, grip, handle) do not toggle; a drag or hold
does not toggle; the label still comes off the heading; a locked board still
adds, holds and removes context and writes nothing. Keep the existing pin-board,
menu, archive and delete claims green.

- [ ] **Step 2: Run the rig and confirm it fails**

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/card-context-e2e.test.ts
```

Expected: **FAIL** — the chat icon is still the only way in, and the probe still
reports one card.

- [ ] **Step 3: Implement the toggle, the keyboard control, the status line and the clear**

In `HomePage.tsx`: one `togglePinContext(pin, card)` handler (reads the label off
the heading, calls `toggleCardContext`, opens the dock and focuses the composer on
`"added"`, sets the refusal message on `"full"`), one delegated click handler on
the dashboard root for card vs empty-space presses (with the control-selector and
suppression guards), one root handler for empty space calling `clearCardContext`,
and the visually-hidden `<button data-testid="pin-context-toggle">` per card with
`aria-pressed` and the action-specific accessible name. Render
`<p role="status" data-testid="pin-context-status">` while the refusal is set,
cleared by the next successful toggle/clear and after 6 s.

In `usePinArrange.ts`: set a click-suppression flag when a gesture lifts a card or
cancels an armed press by drift, and expose `consumeClickSuppression()`.

In `global.css`: delete the chat-button rules; `.home-pin[data-pin-id] {
cursor: pointer; }`; keep `.is-in-context` as the existing solid `2px` accent
outline (now allowed on several cards); add the visually-hidden toggle (hidden
until focused) and the status line's placement, and the `.is-live` pairing.

- [ ] **Step 4: Run the rig and confirm it passes**

Same command → **PASS**, with the existing dashboard claims still listed in the
same artifact.

### Task 3: One pill per card, in order

**Files:**
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/card-context.{tsx,electron.mjs}`

**Interfaces:**
- Produces: `.chat-panel__contexts` container, one
  `[data-testid="chat-context-pill"]` per held card with
  `data-context-pin-id`, each holding a `[data-testid="chat-context-remove"]`
  named `Remove "<label>" from context`
- Consumes: `contextCards`, `removeCardContext`

- [ ] **Step 1: Add the failing pill scenarios**

On the real panel: no card → no pill and a sent turn with no `focusedCards` key; a
seeded dock → one pill per card in added order, each named; each pill's remove
button removes only its own card; a seeded three-card turn carries
`focusedCards` exactly and no `focusedCard`; the click join (real Dashboard + real
panel) puts the card in the pill and the caret in the composer; removing the last
pill restores the ordinary turn.

- [ ] **Step 2: Run the rig and confirm it fails**

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/card-context-e2e.test.ts
```

Expected: **FAIL** — the panel still draws the one-card pill.

- [ ] **Step 3: Implement the pill list**

Render the `.chat-panel__contexts` container above the composer row, one pill per
`contextCards` entry in order, each removable through `removeCardContext(pinId)`.
The container wraps onto more than one line rather than squeezing the field.
Removing cards does not close the dock or change its surface. Keep the field's
placeholder `Message Hermes…`.

- [ ] **Step 4: Run the rig and confirm it passes**

Same command → **PASS**, with the JSON and PNG artifacts written.

### Task 4: The turn carries `focusedCards`

**Files:**
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/companion-client.ts`
- Modify: `apps/desktop/tests/agent-prompts-e2e.test.ts`

**Interfaces:**
- Produces: `focusedCards?: FocusedCardContext[] | null` on
  `CompanionInstructionsInput` (and the renderer's mirrored type), replacing
  `focusedCard`; `FocusedCardContext` keeps its shape
- Consumes: the stubbed `companionChatStream`, which records the whole payload

- [ ] **Step 1: Extend the instruction test to the multi-card text**

In `tests/agent-prompts-e2e.test.ts`: a one-card turn keeps the old wording
byte-for-byte; a two- and a three-card turn name every card, each card's board,
ids and own kind path (view → `get_view` + `save_view` with the same `viewId` and
`boardSlug`; page → a page, not a saved view, no `viewId`; system → a built-in
card, no `viewId`, described from the records behind it); the block says
`"these cards"` means all of them and asks which named card is meant rather than
which cards are in context; a no-card turn has no card line and no `focusedCards`
key. Record each check in `e2e/artifacts/agent-prompts.json`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd apps/desktop && node --experimental-strip-types --test tests/agent-prompts-e2e.test.ts
```

Expected: **FAIL** — the instructions render one card.

- [ ] **Step 3: Implement the payload and the line**

Replace `focusedCard` with `focusedCards` in `vite-env.d.ts`, `preload.ts` and
`companion-client.ts`. Pass the flattened array from `ChatPanel.tsx` only while it
is non-empty. Render the one-card wording unchanged for one card; for two or
three, one numbered line per card with its label, board, ids and kind path, and
the closing ambiguity rule. Do not change the rest of `buildInstructions`.

- [ ] **Step 4: Run the test and confirm it passes**

Same command → **PASS**.

### Task 5: Amend the rigs that already know the card control

**Files:**
- Modify: `apps/desktop/e2e/dashboard-companion-edit.electron.mjs`
  (`tests/dashboard-companion-edit-e2e.test.ts` if its claim list moves)
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/e2e/dashboard-lock-ui.electron.mjs`
- Verify only: `apps/desktop/e2e/dashboard-tile.electron.mjs` (change it only
  if a removed selector leaves a stale claim)
- Read-only: `apps/desktop/tests/card-context-e2e.test.ts` (scenario lists)

- [ ] **Step 1: Hand the card over by clicking the card itself**

`dashboard-companion-edit`'s harness hands a card to the chat before a run: click
the card, not a control, assert the pill appears, and keep the live-ring claim.

- [ ] **Step 2: Keep the selectors honest**

`dashboard-arrange` and `dashboard-lock-ui` count `.home-pin__chrome` and read
`[data-pin-id]`; they must still pass with no `pin-chat`. `dashboard-tile`
asserts the tile geometry and must not assume the old corner button. Update only
selectors the removed control leaves stale; do not weaken a claim.

- [ ] **Step 3: Run the affected wrappers and confirm they pass**

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/card-context-e2e.test.ts tests/dashboard-companion-edit-e2e.test.ts tests/dashboard-arrange-e2e.test.ts tests/dashboard-lock-ui-e2e.test.ts tests/dashboard-tile-e2e.test.ts
```

Then the full suite:

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context
```

- [ ] **Step 4: Commit the source, rigs and tests together**

Stage explicit paths; two `-m` flags; no artifacts.

### Task 6: Laws, wiki, and the superseded specs

**Files:**
- Modify: `LAWS/DASHBOARD.md`
- Modify: `docs/wiki/06-dashboard.md`, `docs/wiki/24-companion.md`,
  `docs/wiki/33-glossary.md`
- Modify: the status lines of
  `docs/superpowers/specs/2026-10-09-dashboard-card-context-design.md` and
  `docs/superpowers/specs/2026-10-16-dashboard-card-in-context-mark-design.md`
  (amendment note only; no history rewritten)
- Create: this plan

- [ ] **Step 1: Put the contract in the laws**

`LAWS/DASHBOARD.md` keeps "Every pinned card … MUST be addable", "A card in
context MUST be named …", "… MUST be marked as such on the Dashboard" and the
locked-board semantics, and now also says:

```
The companion chat MUST hold at most three cards in context at once.

Pressing a card already in the companion chat's context MUST take that card out of the context, and MUST leave every other card in it.

A card MUST NOT carry a chat control of its own; the card itself is the control.

Pressing empty board space MUST take every card out of the companion chat's context.

A card's own controls other than its context toggle MUST NOT change the companion chat's context.

Taking a card into or out of the companion chat's context MUST NOT edit the Dashboard, and MUST be possible on a locked Dashboard.
```

- [ ] **Step 2: Correct the wiki to the shipped interaction**

`06-dashboard.md`: replace the "press the corner chat control" section and the
screen-table row with click-to-toggle, three-card cap plus the exact refusal line,
empty-board clear, untouched card controls, the hidden keyboard toggle, and a
locked board that still hands cards over. `24-companion.md`: the composer holds
one removable pill per card in order (not a single card pill), the pills come from
the Dashboard, and three cards ride a turn. `33-glossary.md`: the **Card** entry
says clicking a card puts it in the companion chat's context, up to three at once,
and clicking again takes that card out.

- [ ] **Step 3: Amend the superseded specs**

Add one status-line amendment to each old spec pointing at
`2026-11-05-dashboard-multi-card-context-design.md`; leave their bodies intact.

- [ ] **Step 4: Validate the docs**

```bash
./bin/agent-cli docs show laws/dashboard
./bin/agent-cli docs search "chat control"
node scripts/build-docs.mjs
```

The `search` must return no stale hit inside this feature's scope; the staged
`.docs-build/` is gitignored. There is no docs lint or docs npm script beyond
`scripts/build-docs.mjs`; report that if it is still true.

- [ ] **Step 5: Commit the docs**

Stage the laws, the three wiki pages, the two status lines, the new spec and this
plan; no source.

---

## Test and Artifact Commands

Focused loop (one wrapper, lock held by the bench):

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/card-context-e2e.test.ts
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/agent-prompts-e2e.test.ts
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context tests/dashboard-companion-edit-e2e.test.ts
```

Full proof (all rigs, same wrapper):

```bash
/root/.local/bin/lifequest-e2e /root/projects/life-quest/.worktrees/feat/multi-card-chat-context
```

Typecheck:

```bash
./bin/agent-cli check typecheck
```

Artifacts, each JSON carrying the scenario list plus a `.png` of the real screen:

- `apps/desktop/e2e/artifacts/dashboard-card-context.json` / `.png`
- `apps/desktop/e2e/artifacts/card-context.json` / `.png`
- `apps/desktop/e2e/artifacts/dashboard-companion-edit.json` / `.png`
- `apps/desktop/e2e/artifacts/agent-prompts.json`

`apps/desktop/e2e/artifacts/` is gitignored. A skipped rig is evidence of
nothing; count only a run whose report exists and whose picture shows the shipped
screen.

## Done Means

- No card draws a chat icon, and `[data-testid="pin-chat"]` /
  `.home-pin__chat` are absent from the shipped Dashboard.
- A click toggles one card; a second click removes only that card; empty board
  space clears every card; a card's other controls and a drag toggle nothing.
- Three cards hold at once, one pill per card in added order sits above the
  composer, and a fourth add is refused with the visible status line and no
  write.
- The turn carries `focusedCards` (or no key at all when empty), one-card wording
  is unchanged, and the two- and three-card block names every card and its own
  kind path.
- A locked board still selects and removes context and writes nothing.
- The keyboard toggle is reachable, hidden until focused, and announces the
  correct action.
- `LAWS/DASHBOARD.md` states the three-card cap, the empty-board clear and the
  controls-never-toggle rules; the wiki describes the shipped interaction; the
  two superseded specs point at the new one.
- The rig reports above exist, pass, and show the shipped UI; nothing outside the
  feature's files changed.
