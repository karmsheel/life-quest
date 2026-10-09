# Dashboard Card Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Dashboard's pin board to the top of the page behind a toggle, and give every card a chat control that hands that card to the companion as the subject of the conversation.

**Architecture:** The board's add row becomes a header toggle plus a section rendered above the grid. Each pin's wrapper grows a `.home-pin__tools` row holding the new chat control beside the existing (lock-gated) editing chrome, so "chrome" keeps meaning *editing* and a locked board keeps drawing none of it. The chat control reads the card's own heading, puts `{ pin, label, boardSlug }` into `ChatDockProvider`, and opens the dock; `ChatPanel` renders that as a pill above the composer and sends the flattened `FocusedCardContext` on the turn, where `buildInstructions` renders one per-kind line telling the companion how that card can be changed.

**Tech Stack:** React 19, TypeScript, `lucide-react` 0.511.0 (already a dependency), CSS Grid/Flex, Electron `webContents.sendInputEvent` for input in the rigs, `node:test` as the rig wrapper.

**Spec:** `docs/superpowers/specs/2026-10-09-dashboard-card-context-design.md`. When this plan and the spec disagree on behavior, follow the spec.

## Global Constraints

- The repo's standing rule is E2E as the sole testing mechanism. **Do not add a unit test** and do not import `card-name.ts` from a `node:test` file; it is exercised through the real page in the rig.
- **No new dependency.** Icons come from `lucide-react@0.511.0`, already a devDependency.
- **No `packages/vault-core/` change and no schema change.** `Pin`, `PinBoard`, `schemaVersion: 1`, `pinsSet` and `setPinBoardLocked` are untouched. The card is addressed by ids the pin already carries.
- Exact class/testid hooks that MUST survive, because existing rigs count or read them: `.home-pin__chrome`, `.home-pin__chrome .home-pin__btn`, `.home-pin`, `.home-pin__btn`, `.home-dashboard__grid`, `.home-pin--span2`, `.home-pin-add__btn`, `data-pin-id`, and `data-testid` `pin-grip` / `pin-span` / `pin-unpin` / `board-add-pin` / `board-lock-badge` / `board-lock-toggle` / `board-lock-hint` / `pin-arrange-status`.
- New hooks, and they are exact: `.home-pin__tools` (the row), `.home-pin__chat` (the control), `data-testid` `pin-chat` on the control, `data-testid` `board-add-toggle` on the header toggle, `data-testid` `chat-context-pill` and `chat-context-remove` on the composer's pill.
- **`.home-pin__chrome` keeps meaning board-editing chrome.** The chat control is a sibling of it inside `.home-pin__tools`, never inside it. A locked board draws zero `.home-pin__chrome` and zero `.home-pin__chrome .home-pin__btn` — and still draws the chat control.
- The chat control is a `<button>` inside the card, so `usePinArrange`'s existing press guard (`button:not([data-pin-grip])`) already refuses to lift on it. Do not weaken that guard.
- The card's name is read off the rendered heading at click time (`.home-card__title, .view-card__title, .deadline-banner__label`), joining the heading's own text nodes so a count badge is not part of the name. Never rebuild the name from the pin except as a fallback when the heading is empty.
- The toggle state is the page's own live state, defaulting to closed. It is not persisted; there is no schema for it and this plan adds none.
- Focused loop, with `npm run dev` up: from `apps/desktop`, run a rig **under Electron**, never under plain node — it is an Electron main script, and `node` dies on `import { BrowserWindow } from "electron"`. This host also exports `ELECTRON_RUN_AS_NODE`, which makes the same command run as plain node, so clear it first:

  ```powershell
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & (node -p "require('electron')") e2e/<rig>.electron.mjs
  ```

  Full proof: from the repo root, `npm test`. That script ignores extra argv and runs every rig, so do not pass it a file path.
- The rigs' wrappers follow their siblings: probe `127.0.0.1:5173`, `t.skip("dev server not listening on 5173 — run \`npm run dev\` to include this e2e")` when it is down, `fs.rmSync` the report first, `execFile(electron, [...], { cwd: desktopRoot, timeout: 120_000 })`, then assert the report exists, `report.pass` is true, `failures` deep-equals `[]`, the exit code is 0, and every scenario name this plan adds is present with `pass: true`.
- The drivers follow their siblings: `nativeTheme.themeSource = "dark"`, `show: false` then `win.showInactive()` before any input is dispatched, `webPreferences.backgroundThrottling: false`, a 90 s timeout that exits 1, `app.exit(report.pass ? 0 : 1)`, and a printed summary line.
- Every rig applies the app's own skin before its first render (`e2e/apply-app-skin.ts`) and the driver fails the run if `document.documentElement.dataset.skin` disagrees.
- The rigs write `e2e/artifacts/*.json` plus a matching `.png`. `apps/desktop/e2e/artifacts/` is gitignored — never `git add` an artifact.
- Three existing rigs read the Add-pin row and MUST be updated in the same change that hides it: `dashboard-arrange.electron.mjs` (its `chrome-identity` scenario reads the row's heading), `dashboard-lock-ui.electron.mjs` + `tests/dashboard-lock-ui-e2e.test.ts` (its `addPinRow` sample), and `dashboard-live-app.electron.mjs` (its `addPin` sample).
- Windows commits use two `-m` flags. Stage explicit paths. Do not `git add -A`. Do not merge or push.

---

### Task 1: The pin board at the top, behind a toggle

**Files:**
- Create: `apps/desktop/e2e/dashboard-card-context.html`
- Create: `apps/desktop/e2e/dashboard-card-context.tsx`
- Create: `apps/desktop/e2e/dashboard-card-context.electron.mjs`
- Create: `apps/desktop/tests/card-context-e2e.test.ts`
- Create: `apps/desktop/src/components/home/card-name.ts`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-arrange.electron.mjs`
- Modify: `apps/desktop/e2e/dashboard-lock-ui.electron.mjs`
- Modify: `apps/desktop/tests/dashboard-lock-ui-e2e.test.ts`
- Modify: `apps/desktop/e2e/dashboard-live-app.electron.mjs`

**Interfaces:**
- Produces: `export function cardNameIn(card: Element | null): string` in `components/home/card-name.ts`
- Produces: `data-testid="board-add-toggle"` on the header toggle, `aria-expanded`, and `data-testid="board-add-pin"` only while it is open
- Consumes: `Pin`, `PageListEntry`, `SavedView`, `SYSTEM_PIN_KINDS`

- [ ] **Step 1: Write the harness page and the driver's first scenarios**

Create the harness from `dashboard-arrange.tsx`'s shape — the same recording bridge stub, the same seven-pin seed, the same `applyAppSkin("dark")` first — with these differences:

- Render `HomePage` inside `<ChatDockProvider>` plus a `ChatDockProbe` (Task 2 adds the probe; this task's scenarios only need the page).
- Expose `dashboardCardContextReady`, `dashboardCardContextCommits`, `dashboardCardContextSkin`, `dashboardCardContextSetBoard(pins, locked)`, `dashboardCardContextRender(generation)`, `dashboardCardContextPinWrites`.
- The bridge stub is the arrange rig's, minus nothing: whatever that page calls, this one calls.

Driver scenarios for this task:

- `add-toggle-is-closed-on-landing`: `[data-testid="board-add-pin"]` is absent, `[data-testid="board-add-toggle"]` carries `aria-expanded="false"`, and its label does not claim the board is open.
- `add-toggle-opens-and-closes`: click the toggle → the section exists, `aria-expanded="true"`, and the section's buttons are the ones the board can add; click again → the section is gone and `aria-expanded` is back to `"false"`.
- `pin-board-sits-above-the-grid`: with the section open, `compareDocumentPosition` proves the section precedes `.home-dashboard__grid`, and the toggle precedes both.
- `locked-board-has-no-add-path`: re-render with `locked: true` → no toggle, no section, and no `.home-pin-add__btn` anywhere.
- `add-pin-still-writes`: with the section open, click an add button → exactly one `pinsSet`, and the payload is the seeded board plus that pin.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all five: the section is below the grid, permanent, and there is no toggle.

- [ ] **Step 3: Move it, and gate it**

In `HomePage.tsx`:

- add `const [addOpen, setAddOpen] = useState(false)`,
- render the toggle as a `Button` (`variant="outline"`) in the header's control group, before the lock button, with `data-testid="board-add-toggle"`, `aria-expanded={addOpen}`, a `PinIcon` at `size={13}` and the label `Pin board` / `Hide pin board`,
- render the existing `<section className="home-card home-pin-add" data-testid="board-add-pin">` block unchanged, moved to immediately **below the header and above `.home-dashboard__grid`**, behind `addOpen &&` and the existing `!locked &&` + "something to add" guard,
- the toggle renders under the same guard the section does (`!locked` and something addable), so a locked board and a fully-pinned board both have no toggle.

In `global.css`:

- `.home-pin-add` gains nothing structural; the row it holds is already styled,
- give the toggle's icon the row's own spacing: `.home-pin-add__heading svg` is not needed — the header toggle draws its `PinIcon` beside its text and the `Button`'s own gap handles it.

- [ ] **Step 4: Update the three rigs that read the Add-pin row**

- `dashboard-arrange.electron.mjs`: after the page is ready, click `[data-testid="board-add-toggle"]` and wait for `[data-testid="board-add-pin"]` before the first sample, so `chrome-identity` still reads the heading. Say in the driver's doc comment that the row is behind a toggle now.
- `dashboard-lock-ui.electron.mjs`: the `SAMPLE` reads `addToggle: Boolean(document.querySelector('[data-testid="board-add-toggle"]'))` instead of `addPinRow`, and the run records both `addToggle` and `addPinRow`. Unlocked → toggle true and row false (closed on landing); locked → toggle false, row false. Update the `dashboard-lock-ui-e2e.test.ts` assertions to those four facts, and to "unlocking restores the toggle".
- `dashboard-live-app.electron.mjs`: click the toggle before reading `addPin`, so the live leg keeps asserting the row is offered.

- [ ] **Step 5: Run the rigs and the suite, and confirm both pass**

Run the new rig (Global Constraints) → PASS on all five. From the repo root, `npm test` → PASS, with `dashboard-arrange`, `dashboard-lock-ui` and (if it boots) `dashboard-live-app` green.

- [ ] **Step 6: Commit**

```powershell
git add -- docs/superpowers/specs/2026-10-09-dashboard-card-context-design.md docs/superpowers/plans/2026-10-09-dashboard-card-context.md apps/desktop/src/pages/HomePage.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/dashboard-card-context.html apps/desktop/e2e/dashboard-card-context.tsx apps/desktop/e2e/dashboard-card-context.electron.mjs apps/desktop/tests/card-context-e2e.test.ts apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/e2e/dashboard-lock-ui.electron.mjs apps/desktop/tests/dashboard-lock-ui-e2e.test.ts apps/desktop/e2e/dashboard-live-app.electron.mjs
git commit -m "feat(desktop): put the dashboard's pin board at the top, behind a toggle" -m "The add row is a header control now instead of permanent furniture below the grid; a locked board still has no add path at all."
```

---

### Task 2: The card's chat control

**Files:**
- Create: `apps/desktop/e2e/chat-dock-probe.tsx`
- Create: `apps/desktop/src/components/home/card-name.ts` (if Task 1 did not already create it)
- Modify: `apps/desktop/src/state/ChatDockProvider.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/components/home/usePinArrange.ts`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/dashboard-card-context.tsx`
- Modify: `apps/desktop/e2e/dashboard-card-context.electron.mjs`

**Interfaces:**
- Produces: `export type ChatCardContext = { pin: Pin; label: string; boardSlug: string | null }` and `contextCard` / `setContextCard` on `useChatDock()`
- Produces: `export function ChatDockProbe({ channel }: { channel: string }): null`, which mirrors `{ open, contextCard }` to `window[`${channel}Dock`]` and installs `window[`${channel}SetContext`]` / `window[`${channel}ClearContext`]` from the live `useChatDock()`
- Produces: `.home-pin__tools`, `.home-pin__chat`, `data-testid="pin-chat"`

- [ ] **Step 1: Extend the failing rig**

Add a `ChatDockProbe` to the harness (channel `dashboardCardContext`) and these scenarios:

- `every-card-offers-the-chat-control`: each `[data-pin-id]` carries exactly one `[data-testid="pin-chat"]`, it draws one `svg` (class `lucide-message-square`), its text is empty, and it has both an `aria-label` and a `title`.
- `the-chat-control-is-not-editing-chrome`: the control is not inside any `.home-pin__chrome`, and the chrome's own button testids per card are unchanged (`pin-grip`, `pin-span` for view pins, `pin-unpin`).
- `chat-control-hands-over-the-card`: click the weekly view's control → the probe reports `contextCard.pin.id === "view:financial:v-weekly"`, `contextCard.label === "Weekly expenses"`, `contextCard.boardSlug === null`, and `open === true`.
- `the-name-comes-off-the-heading`: click the goals card's control → the label is `"Goals"`, not `"Goals3"` and not the pin id; click the page card's → `"Ledger"`; click the today-week card's → `"Today & this week"`.
- `a-locked-board-still-offers-it`: `setBoard(<the seven pins>, true)`, re-render → zero `.home-pin__chrome`, zero chrome buttons, seven `pin-chat` controls; clicking one still hands the card over; `dashboardCardContextPinWrites` is empty.
- `the-chat-control-does-not-lift-the-card`: press and hold one for 400 ms → no `.is-lifted`, no write.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all six: there is no `pin-chat` anywhere.

- [ ] **Step 3: Implement the provider field, the name reader, and the control**

`ChatDockProvider.tsx` gains `contextCard: ChatCardContext | null`, `setContextCard`, and both on the memoized value.

`card-name.ts` holds the one name reader (moved out of `usePinArrange`, which now calls it, so the announced name and the handed-over name cannot drift):

```ts
export function cardNameIn(card: Element | null): string
```

`HomePage.tsx`:

- `const { setContextCard, setOpen: setChatOpen } = useChatDock();`
- one handler, used by every card's control:

  ```ts
  function onChatAbout(pin: Pin, control: HTMLElement) {
    const card = control.closest(".home-pin");
    setContextCard({ pin, label: cardNameIn(card) || pin.id, boardSlug });
    setChatOpen(true);
  }
  ```

- render the control per pin, before `PinChrome`, inside the new `.home-pin__tools` row:

  ```tsx
  <div className="home-pin__tools">
    <button type="button" className="home-pin__btn home-pin__chat" data-testid="pin-chat"
      aria-label="Ask the companion about this card"
      title="Ask the companion about this card"
      onClick={(e) => onChatAbout(pin, e.currentTarget)}>
      <MessageSquare size={14} aria-hidden />
    </button>
    {locked ? null : <PinChrome … />}
  </div>
  ```

`usePinArrange.ts` keeps its own `cardIn` and calls `cardNameIn`, falling back to the pin id.

`global.css`:

- `.home-pin__tools { position: absolute; z-index: 1; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.2rem; }`
- `.home-pin__chrome { position: static; }` — the wrapper is the positioned box now, and the chrome is a row inside it,
- `.home-pin:has(.deadline-banner) .home-pin__tools { position: static; justify-content: flex-end; margin-bottom: 0.35rem; }` replacing the same rule on `.home-pin__chrome`,
- `.home-pin:has(.home-pin__tools) .home-card__title, .home-pin:has(.home-pin__tools) .home-dashboard__progress { padding-right: 7.4rem; }` replacing the 5.6rem reserve (four buttons now, not three), with the comment saying so,
- `.home-pin__chat` is not given a color of its own: it wears `.home-pin__btn` like the rest of the row.

- [ ] **Step 4: Fix every selector that assumed the chrome was the positioned direct child**

`dashboard-arrange.electron.mjs`'s `SAMPLE` reads the chrome one level deeper: `:scope > .home-pin__tools > .home-pin__chrome`. Nothing else in that driver changes, and its `chrome-identity` scenario must stay green — that is the check that the four-button row did not eat the chrome's identity.

- [ ] **Step 5: Run the rigs and the suite, and confirm both pass**

Run the new rig → PASS on eleven scenarios. From the repo root, `npm test` → PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/desktop/src/state/ChatDockProvider.tsx apps/desktop/src/components/home/card-name.ts apps/desktop/src/components/home/usePinArrange.ts apps/desktop/src/pages/HomePage.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/chat-dock-probe.tsx apps/desktop/e2e/dashboard-card-context.tsx apps/desktop/e2e/dashboard-card-context.electron.mjs apps/desktop/e2e/dashboard-arrange.electron.mjs apps/desktop/tests/card-context-e2e.test.ts
git commit -m "feat(desktop): hand a dashboard card to the companion chat" -m "Every card grows a chat control beside its editing chrome; it names the card off its own heading and puts it in the dock's context, and a locked board still offers it."
```

---

### Task 3: The pill, and the turn that carries the card

**Files:**
- Create: `apps/desktop/e2e/card-context.html`
- Create: `apps/desktop/e2e/card-context.tsx`
- Create: `apps/desktop/e2e/card-context.electron.mjs`
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/companion-client.ts`
- Modify: `apps/desktop/tests/agent-prompts-e2e.test.ts`

**Interfaces:**
- Produces: `export type FocusedCardContext` and the optional `focusedCard?: FocusedCardContext | null` on `CompanionInstructionsInput`, plus `CompanionInstructionsContext` in `vite-env.d.ts`
- Produces: `data-testid="chat-context-pill"` and `data-testid="chat-context-remove"`
- Consumes: the stubbed `companionChatStream`, which records the whole payload

- [ ] **Step 1: Write the harness page and the failing scenarios**

Create the ChatPanel harness from `chat-panel.tsx`'s shape — same bridge stub, same two sessions, same ready promise — plus `ChatDockProbe` on channel `cardContext`, and a `companionChatStream` stub that records whole payloads in `__lqChatCalls`.

Driver scenarios:

- `no-card-no-pill-no-line`: with no card in context, the pill is absent and a sent turn's `instructionsContext` has no `focusedCard` key at all.
- `the-pill-names-the-card`: set the context to a view card, send nothing → the pill exists, names the card, and draws one `svg`.
- `the-pill-sits-above-the-composer`: geometry — the pill's bottom is at or above the composer field's top, and the pill's left edge is inside the composer's own box.
- `the-turn-carries-the-card`: set the context, send a turn → `__lqChatCalls[0].instructionsContext.focusedCard` deep-equals the expected object, including `viewId` and `boardSlug`.
- `removing-the-pill-clears-the-context`: click `[data-testid="chat-context-remove"]` → the pill is gone, the probe reports `contextCard === null`, and the next turn carries no `focusedCard`.
- `the-pill-survives-the-turn`: set the context, send two turns → both carry the card and the pill is still there, which is the claim that a follow-up question needs no second click.

- [ ] **Step 2: Run the rig and confirm it fails**

Run the rig (Global Constraints) → FAIL on all six: there is no pill.

- [ ] **Step 3: Implement the pill and the line**

In `ChatPanel.tsx`:

- `const { contextCard, setContextCard } = useChatDock();`
- render the pill as the composer form's first child, above `.chat-panel__composer-row`, only on the thread surface:

  ```tsx
  {contextCard ? (
    <div className="chat-panel__context" data-testid="chat-context-pill">
      <MessageSquare size={12} aria-hidden />
      <span className="chat-panel__context-label">{contextCard.label}</span>
      <span className="chat-panel__context-kind">in context</span>
      <button type="button" className="chat-panel__context-remove"
        data-testid="chat-context-remove"
        aria-label="Remove card from context" title="Remove card from context"
        onClick={() => setContextCard(null)}>
        <X size={12} aria-hidden />
      </button>
    </div>
  ) : null}
  ```

- on `sendMessage`, add `focusedCard: contextCard ? focusedCardOf(contextCard) : undefined` to `instructionsContext`, where `focusedCardOf` is one small local mapper from `ChatCardContext` to `FocusedCardContext`,
- keep the pill across turns (do not clear it on send).

In `companion-client.ts`: the `FocusedCardContext` type and one `focusedCardLine` in `buildInstructions`, chosen by kind, exactly as the spec's §4. Add it to the `base` array immediately after `boardLock`.

In `vite-env.d.ts`: `focusedCard?: FocusedCardContext | null` on `CompanionInstructionsContext`, and re-export the type. In `preload.ts`: the same field on the inline payload type.

In `global.css`: the pill's own rules under the composer block — its own hairline tinted with the accent, `--radius-pill`, `--bg-muted`, ellipsized label, and a remove button that is a 1.05 rem hit area like the receipt's.

- [ ] **Step 4: Extend the instruction test**

In `tests/agent-prompts-e2e.test.ts` (which already builds the real instructions for a real board), add §8:

- a **view** card's line names the card, its `viewId`, its `domainSlug` and the board, and teaches `get_view` + `save_view` with the same `viewId`;
- a **system** card's line says it has no `viewId` and that `save_view` cannot change it;
- a **page** card's line says it is a page, not a view;
- no card → the text has no card line, and the words `focusedCard` never appear in any of them;
- record each as a `checks` entry, and add them to the artifact.

- [ ] **Step 5: Run the rigs and the suite, and confirm both pass**

Run both rigs → PASS. From the repo root, `npm test` → PASS, with `agent-prompts` green and its artifact carrying the new checks.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/desktop/src/components/hermes/ChatPanel.tsx apps/desktop/src/styles/global.css apps/desktop/src/vite-env.d.ts apps/desktop/electron/preload.ts apps/desktop/electron/companion-client.ts apps/desktop/e2e/card-context.html apps/desktop/e2e/card-context.tsx apps/desktop/e2e/card-context.electron.mjs apps/desktop/tests/card-context-e2e.test.ts apps/desktop/tests/agent-prompts-e2e.test.ts
git commit -m "feat(desktop): show the card in context above the composer" -m "The pill names the card the turn carries, and the companion is told how that kind of card can actually be changed."
```

---

### Task 4: The laws

**Files:**
- Modify: `LAWS/DASHBOARD.md`

- [ ] **Step 1: Add the laws**

```
The Dashboard's pin board MUST be a control the operator can open and close.

Every pinned card on a Dashboard MUST be addable to the companion chat as context.

A card in context MUST be named in the companion chat before the turn is sent.
```

The third law is the one that makes the first two useful: the pin board is a
control and every card can be handed over, but a card handed over with nothing
saying *which* card would leave the operator describing it anyway — which is the
problem this feature exists to remove.

- [ ] **Step 2: Run the whole suite**

From the repo root: `npm test` → PASS, every rig green.

- [ ] **Step 3: Commit**

```powershell
git add -- LAWS/DASHBOARD.md
git commit -m "feat(laws): a card must be able to be put in front of the companion" -m "The pin board is a control, every card can be handed to the chat, and the chat says which card it is holding before the turn goes."
```

---

## Done means

- The pin board sits above the grid, closed on landing, behind a header toggle, and a locked board has no add path at all.
- Every card carries a chat control that survives the lock, names the card off its own heading, and opens the dock on that card.
- The composer shows a removable pill naming the card, and every turn sent while it is there carries the card's ids.
- The companion is told, per card kind, how that card can be changed — and told plainly when it cannot be.
- `e2e/artifacts/dashboard-card-context.json` and `e2e/artifacts/card-context.json` are the repeatable artifacts: same commands, same claims.
