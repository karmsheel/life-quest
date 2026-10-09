# Dashboard Page Lock — Design Spec

**Date:** 2026-10-08
**Status:** Implemented
**Product:** LifeQuest — local-first life-management studio
**Depends on:** [Document lock](./2026-09-12-document-lock-design.md), [Overview domain lens](./2026-08-31-overview-domain-lens-design.md), [Domain databases & Finance kit](./2026-09-23-domain-databases-finance-kit-prs.md)

Supersedes:

- Plan slice 3 (`propose_view` files a Decision, approval saves the view, **then** the operator pins it).
- The actor-shaped gate in `setPins`: the companion applied board changes by name while any other agent filed a Decision.

---

## 1. Purpose

The Dashboard is the home pin board — one per lens (the Overview board, plus one per domain). It was the last operator-owned surface with an **actor-shaped** write rule: what happened to a change depended on *who asked*, not on anything the operator could see or set. Saving a dashboard card was worse: it took two separate acts (`propose_view`, then wait for approval, then `arrange_dashboard`), and the companion could not complete the second one without the first finishing.

This spec gives the Dashboard the same **page lock** a doctrine document or library note already has, and makes "put a table on my dashboard" one call.

### Success criteria

- A board file may carry `locked: boolean`. Missing reads as `false`; `schemaVersion` stays `1`; the flag persists on the next write. No vault-wide rewrite.
- **Unlocked:** the operator and any agent change the board in place. Saving a new card applies immediately.
- **Locked:** the board is read-only. The operator unlocks to edit; every agent change — a pin list, a new card — becomes **one pending Decision**, and approval writes it.
- The lock is **per board**: locking Overview does not freeze a domain's dashboard.
- Only the user locks or unlocks. No agent tool exists for it, and the IPC path passes the user actor.
- Saving a card and pinning it is **one tool call** (`save_view`), which is lock-aware: it applies when the board is unlocked and files one Decision when it is locked.
- The approval of a saved-card Decision **pins the card too**, and does not change `locked`.
- The UI shows Locked / Unlocked on the board, hides the pin chrome and the Add-pin row while locked, and offers the toggle in the header.
- The companion is told the board and its lock state before it writes, so it does not promise a card that is really a pending Decision.
- Logs name the actor on a lock toggle.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Scope | The board: pin changes **and** a new saved view pinned to that board. |
| 2 | Flag | `locked: boolean` on the board JSON. Optional on read; absent = unlocked. No schema bump. |
| 3 | Gate | The lock, and only the lock. Actor no longer decides. |
| 4 | Unlocked | Operator and agent write in place. No Decision is filed. |
| 5 | Locked | Board read-only. Agent change → one pending Decision. Operator change → unlock first. |
| 6 | Who toggles | User only. An agent lock/unlock call is rejected. |
| 7 | Board scope | Per board, not vault-wide. |
| 8 | Save + pin | One atomic tool, `save_view`, so a card is never saved-but-invisible. |
| 9 | Approval | Writes the view and the pin, in that order, and leaves `locked` untouched. |
| 10 | Legacy decision bodies | A `save-view` body with no `boardSlug` still saves the view and pins nothing. |
| 11 | `propose_view` | Removed as a working path; it answers with the `save_view` instruction. |
| 12 | `arrange_dashboard` | Unchanged in shape; applies when unlocked, files a Decision when locked. |
| 13 | UI while locked | Pin chrome and the Add-pin row are absent; the header carries the Unlock control and a hint. |
| 14 | Companion prompt | The turn carries the board slug and its lock, and the tool reply repeats which happened. |
| 15 | Log | `board.lock_changed` with the actor. No new log event for pins. |

### Explicitly out of scope

- Locking a saved view file on its own (a view is domain data; the board is the page).
- Per-pin locks.
- Agent lock/unlock, even as a Decision.
- Presence-aware gating (the lock is the gate, not who is at the keyboard).
- Schema version bump or vault-wide rewrite.
- Changing page locks on doctrine, library notes, or reviews.

---

## 3. Architecture

```
                  operator (IPC, user actor)          agent (MCP tool, agent actor)
                            │                                     │
                            ▼                                     ▼
                   pinsSetLocked(board, locked)          save_view / arrange_dashboard
                            │                                     │
                            ▼                                     ▼
                   write board.locked                  board.locked?
                                                         │            │
                                                       false         true
                                                         │            │
                                                         ▼            ▼
                                                   write board    one pending Decision
                                                  (view + pin)    (view + pin in the body)
                                                                       │
                                                          operator approves
                                                                       ▼
                                                        write view, then pin
                                                        board stays locked
```

### 3.1 Types (vault-core)

```ts
export type PinBoard = { schemaVersion: 1; pins: Pin[]; locked?: boolean };
export type PinBoardRead = { pins: Pin[]; locked: boolean };
export type PinWriteResult =
  | { applied: true; pins: Pin[]; locked: boolean }
  | { applied: false; decision: DecisionRecord; locked: boolean };
```

### 3.2 Write APIs

| Call | Unlocked | Locked |
|------|----------|--------|
| `setPins(root, board, pins, actor)` | write + return `applied: true` | file one pending Decision, write nothing |
| `setPins(..., { approvedChange: true })` | write | write (the Decision applier only) |
| `setPinBoardLocked(root, board, locked, userActor)` | persist flag + log | same |
| `setPinBoardLocked(..., agentActor)` | reject | reject |
| `save_view` (tool) | save view, pin it | one Decision carrying both |
| `arrange_dashboard` (tool) | write the pin list | one Decision |

### 3.3 Decision body

`target: { type: "view", domainSlug, viewId: "" }`, `proposedBodyMarkdown`:

```json
{ "op": "save-view", "domainSlug": "financial", "spec": { … }, "preview": { … }, "boardSlug": null, "span": 2 }
```

`boardSlug: null` is the Overview board and is meaningful — it is what pins the card. An absent `boardSlug` is a body from before this spec and only saves the view.

### 3.4 UI

- Header: `Locked` / `Unlocked` badge beside the board title, the toggle (`Lock` / `Unlock`), and a one-line hint that says where an agent's changes go.
- Unlocked: pin chrome (unpin, move, span) and the Add-pin row, as before.
- Locked: no chrome, no Add-pin row; the cards themselves are unchanged.

### 3.5 Agent surface

| Tool | Behaviour |
|------|-----------|
| `get_dashboard` | Pins **and** `locked`. |
| `preview_view` | Same, plus (when `boardSlug` is given) whether the board is locked and therefore what `save_view` will do. |
| `save_view` | Validate, save, pin — one call. `applied: true` or `proposed: true` with a `decisionId`. |
| `arrange_dashboard` | The complete pin list; applies or files a Decision. |
| `list_views` | Unchanged. |

The companion prompt names `save_view` as the way to add a card, says not to call `arrange_dashboard` afterwards, and carries the lock state of the board in view.

### 3.6 The card draws itself (design system)

A companion can create a table; it must never invent that table's look. `ViewCard` is the one drawing path for a saved view, and it owns every visual decision:

| Concern | Rule |
|---------|------|
| Card shell | The same shell as every other home pin: `--bg-panel` paper, `--border` hairline, `--radius-xs`, `--shadow-xs`, the same 0.72rem uppercase title. A pinned view is a card on the board, not a drawing dropped onto it. |
| Page canvas | `ViewRef` blocks already sit inside `.page-block`, which owns the frame; `.page-block .view-card` drops the shell so no frame is ever doubled. |
| Table | Hairline header row, hairline rules, label column sized to its content, value column right-aligned with `tabular-nums` so a column of money can be compared at a glance. |
| Table headers | Derived from the query, because the run returns only `[label, value]`: a `timeBucket` names the period (Day / Week / Month), a `groupBy` names the column it grouped by, and otherwise the card says Total. Never the placeholder "Group". |
| Metric | One number at 1.5rem, `--text-strong`, `tabular-nums`, with the currency as a small unit after it — the card's headline, not larger than the board's own headings. |
| Chart | One baseline, accent bars or an accent line with dots, drawn on a fixed 480×180 viewBox with its aspect preserved. Labels truncate to the slot they sit in rather than to a character guess, and scaling the card scales the whole drawing so a tick stays the size it was designed at. |
| Empty / missing | Product copy, not a blank box: "No rows in this window." and "This view is missing and can be unpinned." |
| Warnings | A quiet footnote at the bottom, under a hairline. A run's caveat must never push the numbers it is about off the card. |

Everything comes from tokens, so a skin repaint reaches a saved view with no spec change. The companion is told the corollary: a spec carries data, never formatting (no currency symbols, separators, markdown, or prose in a title), because the card supplies the look.

**The rigs must paint in a skin.** The studio's look is a *skin*: `ThemeProvider` writes the chosen palette's variables onto `<html>`, so a page that relies only on `tokens.css` renders a palette nobody runs — and a design review there would pass a card that looks wrong in the app. Every harness page applies the product's own `applySkin` before its first render (`e2e/apply-app-skin.ts`), exposes the skin it used, and the driver fails the run if it was not applied. The wired-app rig additionally compares the card's paper against a sibling `.home-card` and records the live `--accent`, `--bg-panel`, `--border`, and dataset skin/theme, so a claim about the card is always a claim about the palette the operator is actually running.

---

## 4. Error handling

- Lock toggle by an agent → `Only the user can lock or unlock a dashboard`. No flag change.
- `save_view` on a missing database or invalid spec → the validator's message; nothing written.
- A view pinned to a foreign domain board → `View pin belongs to different domain`, as before.
- Approve when the view's database is gone → the Decision stays pending with the error.
- A board file with `locked` absent → unlocked. Vault open never fails on it.
- `setPins` with `{ approvedChange: true }` is the only path that writes a locked board, and it is not reachable from a tool.

---

## 5. Testing

**vault-core + tool surface** — `apps/desktop/tests/dashboard-lock-e2e.test.ts`, artifact `e2e/artifacts/dashboard-lock.json`:

- Fresh board reads unlocked.
- `save_view` on an unlocked board applies, pins with the right span, saves the view, and files **no** Decision.
- The saved card runs the composed summary table it claims (real rows, real totals).
- An agent lock call is refused and does not change the file.
- After the operator locks: `save_view` files one Decision, changes nothing on the board, and writes no view file.
- The Decision body carries the board and the span.
- `arrange_dashboard` on the locked board files a Decision and moves nothing.
- Approval saves the view **and** pins it, and the board is still locked.
- Locking Overview leaves the financial board writable.

**desktop UI** — `apps/desktop/tests/dashboard-lock-ui-e2e.test.ts`, artifact `e2e/artifacts/dashboard-lock-ui.{json,png}`:

- Unlocked: badge `Unlocked`, control `Lock`, Add-pin row present, pin chrome present.
- Locked: badge `Locked`, control `Unlock`, no Add-pin row, **zero** pin chrome, same cards.
- The toggle records one `pinsSetLocked(boardSlug: null, locked)` call and re-renders.
- Unlocking restores the chrome.
- No unexpected bridge calls, no pin write while locked, no console errors.

Unlocked save + cross-domain pin agreement stays in `dashboard-views-e2e.test.ts`; the card's own rendering stays in the `view-card` rig.

**Acceptance, against the operator's own vault** — not part of `npm test`, because it writes to a real vault and cannot be re-run blindly:

- `apps/desktop/e2e/dashboard-live-summary.mts` calls `preview_view` and `save_view` with the companion's actor and pins a real summary table on the real Overview board. Artifact: `dashboard-live-summary.json`.
- `apps/desktop/e2e/dashboard-live-app.mjs` boots the **built app** against a throwaway profile seeded from the operator's `recent.json`, then asserts through the real IPC bridge that the card renders (`Spending by month`, five month rows, a ZAR headline), that `Lock`/`Unlock` flips the live board to read-only and back, and that the board keeps its cards. Artifact: `dashboard-live-app.json`.
- `apps/desktop/e2e/dashboard-live-card.electron.mjs` draws that exact card in the real layout engine. Artifact: `dashboard-live-summary.png`.

The rig needs a hidden, isolated profile, which only the main process can set; `LIFEQUEST_E2E={"userData":…,"showWindow":false}` is the single seam in `main.ts` that makes that possible, and `bootForE2e()` hands a rig the app's own window and IPC handlers instead of a copy. Both are inert unless a rig asks.

---

## 6. Files

| Area | Touch |
|------|--------|
| `packages/vault-core/src/types.ts` | `PinBoard.locked`, `PinBoardRead`, `PinWriteResult` |
| `packages/vault-core/src/pins.ts` | read board, `listPinBoard`, `setPinBoardLocked`, lock gate in `setPins` |
| `packages/vault-core/src/views-tools.ts` | `save_view`, lock-aware `arrange_dashboard`, `preview_view` board line |
| `packages/vault-core/src/views.ts` | drop `fileViewDecision` |
| `packages/vault-core/src/decisions.ts` | `applyViewDecision` saves and pins |
| `packages/vault-core/src/documents.ts` | pins target label reads "dashboard" |
| `packages/vault-core/src/finance-kit.ts` | kit merge preserves `locked` |
| `packages/vault-core/src/pairing-grant.ts` | `save_view` replaces `propose_view` |
| `apps/desktop/electron/{main,preload,vault-service,map-tools,companion-client}.ts` | `pins:setLocked`, grant check, prompt, the `LIFEQUEST_E2E` seam |
| `apps/desktop/src/pages/HomePage.tsx` | lock badge, toggle, chrome gating |
| `apps/desktop/src/components/shell/useActiveDomain.ts` | `useDashboardBoard` |
| `apps/desktop/src/components/hermes/ChatPanel.tsx` | carry the board's lock on the turn |
| `apps/desktop/src/components/decisions/DecisionBody.tsx` | pin copy names the board |
| `apps/desktop/e2e/dashboard-lock*.{html,tsx,electron.mjs}` | the UI rig |
| `apps/desktop/e2e/dashboard-live-*.{mts,mjs,electron.mjs}` | the acceptance run against a real vault |
| `apps/desktop/tests/dashboard-{lock,lock-ui,views}-e2e.test.ts` | the rigs `npm test` runs |

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| A user click on a locked board files a Decision | The chrome is not rendered while locked; `persistPins` refuses locally too |
| A kit install silently unlocks the board | The merge preserves `locked` and is asserted by the existing kit path |
| Old vaults have boards with no `locked` | Absent reads as unlocked; the flag is written on the next write |
| An approval writes a board the operator re-locked | Approval is the consent the lock was waiting for; it never changes `locked` |
| A body written before this spec pins nothing | `boardSlug` absent = save only, which is the old behaviour |
