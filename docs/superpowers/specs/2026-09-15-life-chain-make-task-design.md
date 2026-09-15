# Life-Chain Make Task — Design Spec

**Date:** 2026-09-15  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-09-15-life-chain-make-task.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Issue:** [KAR-11](https://linear.app/karmsheel/issue/KAR-11/life-chain-make-task)  
**Depends on:** [Life Signal Chain](./2026-08-27-life-signal-chain-design.md), [Life-Chain Quick-Fire Capture](./2026-09-04-life-chain-quick-fire-capture-design.md), [Life Map on Chart](./2026-08-27-life-map-chart-design.md)

Life-Chain stays a dump. Act’s task board stays the operator. This issue is the **one-way assignment** from a capture onto a backlog task.

Does not change: signal files, `source` / `sourceRef`, domain lens on the chain, Daily Schedule leftover union, composer, Edit/Delete.

---

## 1. Purpose

Capture can land a thought. Act can hold a task. There is no path from a Life-Chain row to the Map/Act board. The operator either retypes the thought as a task or leaves it on the chain.

Make task is that path. One click creates a backlog task that points at the capture. The signal stays on the chain. The chain does not become an inbox.

### Success criteria

- Each live chain row has **Make task** or **Open task** next to Edit and Delete.
- Make task creates one Map/Act task in **backlog** with `links.signalId` set to the capture id.
- Title is the first non-empty line of the body (trim; 80-character cap + ellipsis). Notes are the full body.
- The signal file is not written. `source` / `sourceRef` stay ingest-only. No `status` field.
- A second click on that row is **Open task** → `/act?task=<id>` with that card expanded.
- Deleting the task restores **Make task**.
- `schemaVersion` stays **1**.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Link | **Task → capture.** `TaskLinks.signalId?: string`. Signal is unchanged. |
| 2 | Ingest fields | `SignalRecord.source` / `sourceRef` stay ingest-only (manual / later Notion). Do not store the task id on the signal. |
| 3 | Command | Existing `createTask`. No new IPC. No `createTaskFromSignal`. |
| 4 | Column | Always **backlog**. Operator moves it to today / this-week. Daily Schedule leftover is unchanged (still the `today` union). |
| 5 | Title | First non-empty line of `body`, trimmed. If longer than 80 UTF-16 code units, `line.slice(0, 80) + "..."`. |
| 6 | Notes | Full `body` as stored on the signal (not truncated). |
| 7 | Domain | **Not copied.** Tasks have no domain field. |
| 8 | Idempotency | At most one live task per capture. Lookup: first `snapshot.map.tasks` entry with `links.signalId === signal.id` (any column, including `done`). |
| 9 | After create | Stay on `/chain`. Control flips to **Open task**. No auto-navigation. |
| 10 | Open task | `Link` to `/act?task=<taskId>`. Execute wing opens because `/act` already maps to Execute. |
| 11 | Expand | Act expands that task card (`openId`). Unknown or deleted id: board as usual, no alert. |
| 12 | Query | `?task=` stays in the URL on refresh. Closing the card this slice does not have to clear the query. |
| 13 | Deleted task | Make task returns. Dangling `signalId` on a deleted task does not exist because the task row is gone. |
| 14 | Deleted signal | Soft-deleted captures leave the chain. Their tasks stay on Act with the `signalId` link. |
| 15 | Multi match | If a race created two, **Open** uses the first match in `tasks`. Do not create a third. |
| 16 | Map missing | Make task disabled. Show existing `snapshot.mapError`. Open is N/A. |
| 17 | Actor | Renderer `user` via `mapApply` (same as Act). |
| 18 | Schema | **No bump.** Missing `signalId` on old tasks is absent / `{}`. |
| 19 | Life log | Existing `map.task.created` from `createTask`. Chain still does not write the log. |
| 20 | Lens | Unchanged. Life-Chain remains a global dump. |

### Explicitly out of scope

- `status` / processed / inbox UI on the chain
- Automations, skills, Notion, HTTP ingest
- Hermes `create_task` tool schema (`map/tools.ts` `TASK_LINKS`) — renderer-only this issue
- Capture-while-quit, phone client
- Assigning captures onto doctrine, library notes, or Decisions
- Copying domain onto the task
- Auto-placing the new task on Daily Schedule
- Bidirectional link (`sourceRef` = task id)
- New IPC channel
- `SCHEMA_VERSION` bump

---

## 3. Data model

```ts
// packages/vault-core/src/map/types.ts — additive
export type TaskLinks = {
  goalId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
  signalId?: string;
};
```

`createTask` already takes `links?: TaskLinks`. Persist `normalizeLinks` keeps `signalId` when it is a string; unknown keys still drop (same as `periodGoalId` today).

```ts
// apps/desktop/src/lib/signal-chain.ts
export function taskFromSignalBody(body: string): { title: string; notes: string };

export function taskForSignal(
  tasks: readonly { id: string; links: { signalId?: string } }[],
  signalId: string,
): { id: string } | undefined;
```

`taskFromSignalBody`:

1. `notes` = `body` (no extra trim).
2. Split `body` on `\r?\n`. First line whose `trim()` is non-empty is the candidate.
3. `title` = trimmed candidate, or `""` if none.
4. If `title.length > 80`, `title = title.slice(0, 80) + "..."`.

`taskForSignal` returns the first task whose `links.signalId === signalId`.

Make-task payload:

```ts
mapApply({
  type: "createTask",
  title: derived.title,
  notes: derived.notes,
  column: "backlog",
  links: { signalId: signal.id },
});
```

Empty derived title (`MALFORMED`) must not be sent. Live signals already require a body; disable Make task when `!signal.body.trim()`.

---

## 4. Architecture

```
┌─ Life-Chain /chain ─────────────────────────────────────┐
│  row: body · when · domain · [Make task|Open task] Edit Delete
│         │
│         │ lookup snapshot.map.tasks by links.signalId
│         ├─ none → mapApply(createTask) → refresh() → Open
│         └─ hit  → Link /act?task=<id>
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              existing map:apply IPC
                          │
                          ▼
         vault-core applyCommand → map.json tasks[]
                          │
                          ▼
┌─ Act /act?task=<id> ────────────────────────────────────┐
│  TaskBoard initialOpenId = search param if id exists    │
└─────────────────────────────────────────────────────────┘
```

Renderer-only orchestration. Map commands stay pure on `StoreState`. Signal-chain files are not read by `applyCommand`.

`VaultSnapshot.map` is already on `useVault()`. Chain does not add a second map fetch.

---

## 5. UI wiring

### 5.1 Life-Chain row

`SignalChainFeed` already calls `useVault()` for `snapshot`. Pull `refresh` as well (Act already does this after `mapApply`). `SignalRow` gains a third control in `signal-row__actions`, **before** Edit:

- **Make task** — `<Button type="button" variant="ghost">` when `taskForSignal` is undefined and map is present. Disabled while `busy` or map is missing.
- **Open task** — `<Link to={"/act?task=" + encodeURIComponent(task.id)}>` when a match exists. Same ghost-button look as the other actions.

Visible text labels, not icon-only: Make vs Open is state, not a glyph.

On Make task:

1. If `busyRef.current` or no derived title, return.
2. `busyRef.current = true`.
3. `api().mapApply(createTask…)`.
4. Failure → `role="alert"` with `error.message` (or existing error string). Keep Make task. Do not navigate.
5. Success → `await refresh()` (VaultProvider snapshot), then the row re-renders as Open task.
6. Clear `busyRef`. Do not `setLoading(true)` on the chain list.

Composer, domain picker, Edit, Delete, quiet re-list after chain mutations: unchanged.

### 5.2 Act expand

`ActPage` reads `useSearchParams().get("task")` and passes `initialOpenId` to `TaskBoard`.

`TaskBoard` keeps `openId` state. If `initialOpenId` matches a task id in `state.tasks`, that card starts (or becomes) expanded. If it does not match, ignore — no toast.

Toggling a card closed leaves `?task=` in the URL this slice.

### 5.3 Wings

`PATH_WING["/act"]` is already `execute`. Open task does not add a route.

---

## 6. Errors

| Case | Behavior |
|------|----------|
| Empty / whitespace body | Make task disabled. |
| `mapApply` not ok | Alert, stay on chain, still Make task. |
| `snapshot.map` null | Make task disabled; show `mapError` if present. |
| `?task=` unknown | Act board, nothing expanded. |
| Task moved to today/done | Still Open task (lookup ignores column). |
| Two tasks same `signalId` | Open the first in `tasks`. Do not create another. |
| Signal soft-deleted | Row gone; task remains. |
| Double-click Make | `busyRef` + post-refresh lookup. |

---

## 7. Tests

### vault-core

- `createTask` with `links: { signalId: "sig-1" }` stores that id. Other link keys still work.
- Persist round-trip: `signalId` survives `openVault`. Unknown link keys still drop. Old tasks without `signalId` still parse.

### desktop `lib/signal-chain`

- `taskFromSignalBody`: first non-empty line; leading blank lines skipped; trim; 80-char cap + `"..."`; notes = full body including newlines.
- `taskForSignal`: first match; ignores other tasks; undefined when none.

### desktop UI (string / existing shell tests)

- Chain row source includes **Make task** / **Open task**.
- `TaskBoard` accepts `initialOpenId` and expands that card (or Act page reads `?task=`).

Existing chain, task, persist, and Act tests still pass.

---

## 8. Files (expected)

| File | Change |
|------|--------|
| `packages/vault-core/src/map/types.ts` | `TaskLinks.signalId?` |
| `packages/vault-core/src/map/persist.ts` | `normalizeLinks` keeps `signalId` |
| `packages/vault-core/tests/map/tasks.test.ts` | createTask + signalId |
| `packages/vault-core/tests/map-persist.test.ts` | round-trip + drop junk |
| `apps/desktop/src/lib/signal-chain.ts` | `taskFromSignalBody`, `taskForSignal` |
| `apps/desktop/src/lib/signal-chain.test.ts` | helper tests |
| `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx` | Make / Open, mapApply, refresh |
| `apps/desktop/src/pages/ActPage.tsx` | pass `initialOpenId` from search |
| `apps/desktop/src/components/tasks/TaskBoard.tsx` | `initialOpenId` → `openId` |
| `apps/desktop/src/styles/global.css` | only if the labeled control needs a row tweak |

No new IPC, no `signal-chain.ts` vault-core edits, no `SCHEMA_VERSION` bump.

---

## 9. Key decisions (this spec)

1. **Link lives on the task.** Capture stays a dump; ingest `sourceRef` stays free.
2. **Renderer + existing `createTask`.** Map commands stay pure. No cross-store I/O in `applyCommand`.
3. **One task, then Open.** Not an inbox; not unbounded duplicates. Open deep-links to Act.
4. **Title from body, notes = body.** No title prompt. No domain copy. Always backlog.
)
