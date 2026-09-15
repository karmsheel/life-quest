# Life-Chain Make Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Life-Chain row create one Act backlog task that points at the capture (`links.signalId`), then Open that task on `/act?task=<id>`.

**Architecture:** Additive `TaskLinks.signalId` on the existing Map store. Renderer calls existing `mapApply({ type: "createTask" })`. No new IPC. Signal files, `source` / `sourceRef`, and `schemaVersion` stay unchanged.

**Tech Stack:** vault-core (`node:test`), Electron `mapApply`, React 19, React Router 7 HashRouter, existing `Button` (`to` renders a `Link`). No new libraries.

**Spec:** `docs/superpowers/specs/2026-09-15-life-chain-make-task-design.md`

## Global Constraints

- Do **not** bump `schemaVersion` (stays `1`)
- Do **not** write signal-chain files; do **not** set `sourceRef` or add `status` on `SignalRecord`
- Do **not** add IPC (`createTaskFromSignal`, `signalChainMakeTask`, or anything else)
- Do **not** edit `packages/vault-core/src/map/tools.ts` (Hermes `TASK_LINKS` stays as-is)
- Do **not** copy domain onto the task; column is always `"backlog"`
- Do **not** auto-place the new task on Daily Schedule
- Do **not** auto-navigate after Make task; stay on `/chain`
- Do **not** add inbox / processed chrome
- Tests: from `packages/vault-core`, `node --experimental-strip-types --test tests/<file>.test.ts`; from `apps/desktop`, `node --experimental-strip-types --test tests/<file>.test.ts` (helper tests in `src/lib/signal-chain.test.ts` are run by that path — `npm test` only globs `tests/**/*.test.ts`, so Task 4’s full gate also runs the src helper file)
- Full gate after Task 4: `npm test` in `packages/vault-core`; in `apps/desktop`: `node --experimental-strip-types --test src/lib/signal-chain.test.ts`, then `npm test`, then `npm run typecheck`
- Commit only files from the current task
- Spec is approved; do not rewrite it unless a task finds a contradiction

---

## File Structure

```
packages/vault-core/src/map/
  types.ts              # TaskLinks.signalId?
  persist.ts            # normalizeLinks keeps string signalId
packages/vault-core/tests/map/
  tasks.test.ts         # createTask + signalId
packages/vault-core/tests/
  map-persist.test.ts   # round-trip + drop non-string / junk keys

apps/desktop/src/lib/
  signal-chain.ts       # taskFromSignalBody, taskForSignal
  signal-chain.test.ts
apps/desktop/src/components/signal-chain/
  SignalChainFeed.tsx   # Make task / Open task
apps/desktop/src/components/tasks/
  TaskBoard.tsx         # initialOpenId
apps/desktop/src/pages/
  ActPage.tsx           # useSearchParams → initialOpenId
apps/desktop/src/styles/
  global.css            # signal-row__actions wrap (Task 3)
apps/desktop/tests/
  chain-shell.test.ts
  task-board-goals.test.ts
```

No new files except none — helpers go in existing `signal-chain.ts`. No vault-core `signal-chain.ts` edits.

---

### Task 1: Persist `TaskLinks.signalId`

**Files:**
- Modify: `packages/vault-core/src/map/types.ts`
- Modify: `packages/vault-core/src/map/persist.ts`
- Modify: `packages/vault-core/tests/map/tasks.test.ts`
- Modify: `packages/vault-core/tests/map-persist.test.ts`

**Interfaces:**
- Consumes: existing `createTask` / `Command` `links?: TaskLinks`; `normalizeLinks`
- Produces:
  - `TaskLinks.signalId?: string`
  - `normalizeLinks` copies `signalId` when it is a string; non-strings and unknown keys still drop
  - `createTask` with `links: { signalId }` stores it on the task (no command-handler change)

- [ ] **Step 1: Write the failing tests**

In `packages/vault-core/tests/map/tasks.test.ts`, after the `goalId` case, add:

```ts
  it("stores a signalId link on a task", () => {
    const task = applyCommand(
      base(),
      {
        type: "createTask",
        title: "From chain",
        notes: "full body",
        column: "backlog",
        links: { signalId: "sig-1" },
      },
      user,
    );
    assert.equal(task.ok, true);
    if (!task.ok) return;
    assert.equal(task.value.tasks[0].links.signalId, "sig-1");
    assert.equal(task.value.tasks[0].column, "backlog");
    assert.equal(task.value.tasks[0].notes, "full body");
  });
```

In `packages/vault-core/tests/map-persist.test.ts`, add at the end of the `describe` (before the closing `});`):

```ts
  it("persists task links.signalId across openVault", async () => {
    const root = path.join(dir, "signal-link");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const applied = await applyMapCommand(
      root,
      {
        type: "createTask",
        title: "From chain",
        notes: "full body",
        column: "backlog",
        links: { signalId: "sig-1" },
      },
      "user",
      "2026-09-15",
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.value.tasks.at(-1)?.links.signalId, "sig-1");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const task = opened.value.map?.tasks.find((t) => t.links.signalId === "sig-1");
    assert.ok(task);
    assert.equal(task.title, "From chain");
    assert.equal(task.notes, "full body");
    assert.equal(task.column, "backlog");
  });

  it("keeps string signalId and drops junk link keys", async () => {
    const root = path.join(dir, "signal-link-junk");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    const raw = JSON.parse(await fs.readFile(p, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    raw.tasks = [
      {
        id: "t1",
        title: "Old",
        notes: "",
        column: "backlog",
        links: { signalId: "sig-1", periodGoalId: "old", signalIdNum: 1 },
      },
      {
        id: "t2",
        title: "Bad",
        notes: "",
        column: "backlog",
        links: { signalId: 99 },
      },
    ];
    await fs.writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const t1 = opened.value.map?.tasks.find((t) => t.id === "t1");
    const t2 = opened.value.map?.tasks.find((t) => t.id === "t2");
    assert.equal(t1?.links.signalId, "sig-1");
    assert.equal(
      (t1?.links as Record<string, unknown>).periodGoalId,
      undefined,
    );
    assert.equal(t2?.links.signalId, undefined);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

From `packages/vault-core`:

```
node --experimental-strip-types --test tests/map/tasks.test.ts
```

The `tasks.test.ts` case may already PASS: `createTask` stores `links` as given, so in-memory `signalId` survives without a type or persist change. That is OK. Still add the type field so later tasks typecheck.

```
node --experimental-strip-types --test tests/map-persist.test.ts
```

Expected: FAIL — `signalId` is missing after `openVault` because `normalizeLinks` does not copy it. The junk-key test fails the same way (`t1.links.signalId` undefined).

- [ ] **Step 3: Implement types + persist**

In `packages/vault-core/src/map/types.ts`, change `TaskLinks` to:

```ts
export type TaskLinks = {
  goalId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
  signalId?: string;
};
```

In `packages/vault-core/src/map/persist.ts`, `normalizeLinks`:

```ts
function normalizeLinks(links: Record<string, unknown> | undefined): Task["links"] {
  const next: Task["links"] = {};
  if (!links || typeof links !== "object") return next;
  if (typeof links.goalId === "string") next.goalId = links.goalId;
  if (typeof links.date === "string") next.date = links.date;
  if (links.weekItem && typeof links.weekItem === "object") {
    next.weekItem = links.weekItem as Task["links"]["weekItem"];
  }
  if (typeof links.signalId === "string") next.signalId = links.signalId;
  return next;
}
```

Do not change `createTask` in `tasks.ts` — it already assigns `links` onto the task. Do not change `commands.ts`. Do not change `map/tools.ts`.

- [ ] **Step 4: Run tests to verify they pass**

From `packages/vault-core`:

```
node --experimental-strip-types --test tests/map/tasks.test.ts
node --experimental-strip-types --test tests/map-persist.test.ts
```

Expected: PASS (both files).

- [ ] **Step 5: Commit**

```
git add packages/vault-core/src/map/types.ts packages/vault-core/src/map/persist.ts packages/vault-core/tests/map/tasks.test.ts packages/vault-core/tests/map-persist.test.ts
git commit -m "feat(vault-core): persist TaskLinks.signalId"
```

---

### Task 2: Title and lookup helpers

**Files:**
- Modify: `apps/desktop/src/lib/signal-chain.ts`
- Modify: `apps/desktop/src/lib/signal-chain.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (plain strings / `{ id, links.signalId }`)
- Produces:
  - `taskFromSignalBody(body: string): { title: string; notes: string }`
  - `taskForSignal(tasks: readonly { id: string; links: { signalId?: string } }[], signalId: string): { id: string } | undefined`

Rules for `taskFromSignalBody` (spec §3):

1. `notes` = `body` with no extra trim.
2. Split `body` on `/\r?\n/`. First line whose `trim()` is non-empty is the candidate.
3. `title` = that trimmed candidate, or `""` if none.
4. If `title.length > 80` (UTF-16 code units), `title = title.slice(0, 80) + "..."`.

`taskForSignal` returns the **first** task whose `links.signalId === signalId`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/lib/signal-chain.test.ts`, add the helpers to the import from `./signal-chain.ts`, then append:

```ts
describe("taskFromSignalBody", () => {
  it("uses the first non-empty line as title and the full body as notes", () => {
    const body = "\n  Inbox zero  \nmore\n";
    assert.deepEqual(taskFromSignalBody(body), {
      title: "Inbox zero",
      notes: body,
    });
  });

  it("caps title at 80 characters with an ellipsis", () => {
    const line = "a".repeat(81);
    const body = `${line}\nrest`;
    const derived = taskFromSignalBody(body);
    assert.equal(derived.title, `${"a".repeat(80)}...`);
    assert.equal(derived.title.length, 83);
    assert.equal(derived.notes, body);
  });

  it("returns an empty title when the body is only whitespace", () => {
    assert.deepEqual(taskFromSignalBody("  \n\t\n"), {
      title: "",
      notes: "  \n\t\n",
    });
  });
});

describe("taskForSignal", () => {
  it("returns the first task with a matching signalId", () => {
    const tasks = [
      { id: "a", links: { goalId: "g" } },
      { id: "b", links: { signalId: "sig-1" } },
      { id: "c", links: { signalId: "sig-1" } },
    ];
    assert.equal(taskForSignal(tasks, "sig-1")?.id, "b");
    assert.equal(taskForSignal(tasks, "missing"), undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

From `apps/desktop`:

```
node --experimental-strip-types --test src/lib/signal-chain.test.ts
```

Expected: FAIL (`taskFromSignalBody` / `taskForSignal` is not exported).

- [ ] **Step 3: Implement helpers**

Append to `apps/desktop/src/lib/signal-chain.ts`:

```ts
export function taskFromSignalBody(body: string): { title: string; notes: string } {
  const notes = body;
  let title = "";
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      title = trimmed;
      break;
    }
  }
  if (title.length > 80) title = `${title.slice(0, 80)}...`;
  return { title, notes };
}

export function taskForSignal(
  tasks: readonly { id: string; links: { signalId?: string } }[],
  signalId: string,
): { id: string } | undefined {
  return tasks.find((t) => t.links.signalId === signalId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

From `apps/desktop`:

```
node --experimental-strip-types --test src/lib/signal-chain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/lib/signal-chain.ts apps/desktop/src/lib/signal-chain.test.ts
git commit -m "feat(desktop): derive Act title from a chain body"
```

---

### Task 3: Make task / Open task on the chain

**Files:**
- Modify: `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx`
- Modify: `apps/desktop/src/styles/global.css` (`.signal-row__actions` wrap)
- Modify: `apps/desktop/tests/chain-shell.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `links.signalId` on `snapshot.map.tasks`
  - Task 2: `taskFromSignalBody`, `taskForSignal`
  - `useVault().refresh` (already used on Act)
  - `api().mapApply`
  - `Button` `to` prop (renders `Link`)
- Produces: row control **Make task** or **Open task**; Make calls `createTask` then `refresh()`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/tests/chain-shell.test.ts`, add cases at the end of the describe (keep the existing pencil/trash case):

```ts
  it("row has Make task or Open task before Edit", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    assert.match(src, />Make task</);
    assert.match(src, />Open task</);
    assert.match(src, /taskForSignal/);
    assert.match(src, /taskFromSignalBody/);
    assert.match(src, /mapApply/);
    assert.match(src, /type:\s*"createTask"/);
    assert.match(src, /column:\s*"backlog"/);
    assert.match(src, /signalId/);
    assert.match(src, /\/act\?task=/);
    assert.equal(src.includes("sourceRef"), false);
    const makeIdx = src.indexOf(">Make task<");
    const editIdx = src.indexOf('aria-label="Edit"');
    assert.ok(makeIdx > 0 && editIdx > makeIdx);
  });

  it("Make task uses busyRef and does not flash Loading chain", () => {
    const src = read("src/components/signal-chain/SignalChainFeed.tsx");
    const fn = src.match(
      /async function onMakeTask[\s\S]*?finally \{[\s\S]*?\n  \}/,
    );
    assert.ok(fn, "onMakeTask function");
    assert.match(fn[0], /busyRef\.current = true/);
    assert.match(fn[0], /busyRef\.current = false/);
    assert.match(fn[0], /refresh\(/);
    assert.equal(fn[0].includes("setLoading(true)"), false);
    assert.equal(fn[0].includes("signalChainUpdate"), false);
    assert.equal(fn[0].includes("signalChainCreate"), false);
  });
```

In the existing `"refresh load is quiet"` test, add `"onMakeTask"` to the `for (const name of [...])` array:

```ts
    for (const name of ["onAdd", "onSave", "onAssign", "onDelete", "onMakeTask"]) {
```

- [ ] **Step 2: Run tests to verify they fail**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/chain-shell.test.ts
```

Expected: FAIL (Make task / onMakeTask missing).

- [ ] **Step 3: Implement the row controls**

In `apps/desktop/src/lib` import path, `SignalChainFeed.tsx` currently imports `formatSignalWhen, signalVisible` from `@/lib/signal-chain`. Change that import to:

```ts
import {
  formatSignalWhen,
  signalVisible,
  taskForSignal,
  taskFromSignalBody,
} from "@/lib/signal-chain";
```

Change `const { snapshot } = useVault();` to:

```ts
  const { snapshot, refresh } = useVault();
```

After `onDelete`, add:

```ts
  async function onMakeTask(signal: SignalRecord) {
    if (busyRef.current) return;
    const existing = taskForSignal(snapshot?.map?.tasks ?? [], signal.id);
    if (existing) return;
    const derived = taskFromSignalBody(signal.body);
    if (!derived.title) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api().mapApply({
        type: "createTask",
        title: derived.title,
        notes: derived.notes,
        column: "backlog",
        links: { signalId: signal.id },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to make task");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
```

In the JSX, next to the existing `{error ? ...}` block, also show map errors:

```tsx
      {snapshot?.mapError ? (
        <p className="form-error" role="alert">
          {snapshot.mapError}
        </p>
      ) : null}
```

When rendering `SignalRow`, pass:

```tsx
            <SignalRow
              key={item.id}
              signal={item}
              liveDomains={liveDomains.map((d) => ({
                slug: d.slug,
                name: d.meta.name,
              }))}
              allDomains={allDomains}
              editing={editingId === item.id}
              busy={busy}
              mapReady={Boolean(snapshot?.map)}
              linkedTaskId={taskForSignal(snapshot?.map?.tasks ?? [], item.id)?.id}
              onEdit={() => setEditingId(item.id)}
              onCancel={() => setEditingId(null)}
              onSave={onSave}
              onAssign={(id, slug) => void onAssign(id, slug)}
              onDelete={() => void onDelete(item.id)}
              onMakeTask={() => void onMakeTask(item)}
            />
```

Extend `SignalRow` props:

```ts
function SignalRow(props: {
  signal: SignalRecord;
  liveDomains: { slug: string; name: string }[];
  allDomains: { slug: string; name: string }[];
  editing: boolean;
  busy: boolean;
  mapReady: boolean;
  linkedTaskId: string | undefined;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (id: string, patch: SignalUpdatePatch) => Promise<void>;
  onAssign: (id: string, domainSlug: string | null) => void;
  onDelete: () => void;
  onMakeTask: () => void;
}) {
```

In the non-editing `signal-row__actions` div, **before** the Edit button, add visible-label ghost controls (do **not** use `signal-row__icon-btn` on these two):

```tsx
        <div className="signal-row__actions">
          {props.linkedTaskId ? (
            <Button
              variant="ghost"
              to={"/act?task=" + encodeURIComponent(props.linkedTaskId)}
            >
              Open task
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={props.onMakeTask}
              disabled={props.busy || !props.mapReady || !s.body.trim()}
            >
              Make task
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="signal-row__icon-btn"
            aria-label="Edit"
            onClick={props.onEdit}
            disabled={props.busy}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            destructive
            className="signal-row__icon-btn"
            aria-label="Delete"
            onClick={props.onDelete}
            disabled={props.busy}
          >
            <Trash2 size={16} aria-hidden />
          </Button>
        </div>
```

In `apps/desktop/src/styles/global.css`, change `.signal-row__actions` to allow wrap so the labels fit:

```css
.signal-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  justify-content: flex-end;
  align-items: center;
}
```

Do not call `load()` from `onMakeTask`. Do not navigate after success. Do not write the signal.

- [ ] **Step 4: Run tests to verify they pass**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/chain-shell.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/signal-chain/SignalChainFeed.tsx apps/desktop/src/styles/global.css apps/desktop/tests/chain-shell.test.ts
git commit -m "feat(desktop): Make task from a Life-Chain row"
```

---

### Task 4: Open task expands the Act card

**Files:**
- Modify: `apps/desktop/src/components/tasks/TaskBoard.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Modify: `apps/desktop/tests/task-board-goals.test.ts`

**Interfaces:**
- Consumes: Open task URL from Task 3 (`/act?task=<id>`)
- Produces:
  - `TaskBoard` prop `initialOpenId?: string | null`
  - If that id exists in `state.tasks`, `openId` becomes it
  - Unknown id: leave `openId` alone (nothing expanded), no toast
  - `ActPage` reads `useSearchParams().get("task")` and passes it through
  - Closing the card does **not** clear the query this slice

- [ ] **Step 1: Write the failing tests**

Replace `apps/desktop/tests/task-board-goals.test.ts` contents with:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf8");
}

const src = read("src/components/tasks/TaskBoard.tsx");
const act = read("src/pages/ActPage.tsx");

describe("TaskBoard goal picker", () => {
  it("links tasks to vault Goals, not period goals", () => {
    assert.match(src, /goalId/);
    assert.equal(src.includes("periodGoalId"), false);
    assert.equal(src.includes("periodGoals"), false);
    assert.match(src, /goals: Goal\[\]/);
  });
});

describe("TaskBoard open from query", () => {
  it("expands initialOpenId when the task exists", () => {
    assert.match(src, /initialOpenId/);
    assert.match(src, /setOpenId\(initialOpenId\)/);
    assert.match(src, /state\.tasks\.some/);
  });

  it("ActPage passes the task search param into TaskBoard", () => {
    assert.match(act, /useSearchParams/);
    assert.match(act, /params\.get\("task"\)/);
    assert.match(act, /initialOpenId=/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/task-board-goals.test.ts
```

Expected: FAIL (`initialOpenId` / `useSearchParams` missing).

- [ ] **Step 3: Implement expand**

In `apps/desktop/src/components/tasks/TaskBoard.tsx`, change `Props` and the component start:

```ts
type Props = {
  state: StoreState;
  goals: Goal[];
  onCommand: (command: MapCommand) => void;
  initialOpenId?: string | null;
};

export function TaskBoard({
  state,
  goals,
  onCommand,
  initialOpenId = null,
}: Props) {
  const grouped = useMemo(() => groupTasks(state.tasks), [state.tasks]);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialOpenId) return;
    if (state.tasks.some((t) => t.id === initialOpenId)) {
      setOpenId(initialOpenId);
    }
  }, [initialOpenId, state.tasks]);
```

`useEffect` is already imported from `react`.

Do not add `signalId` to `patchLinks`. Do not clear the URL when the card closes.

In `apps/desktop/src/pages/ActPage.tsx`, change the `react-router-dom` import to:

```ts
import { Link, useSearchParams } from "react-router-dom";
```

Inside `ActContent`, after `const { snapshot, reloadGeneration, refresh } = useVault();` add:

```ts
  const [params] = useSearchParams();
  const taskParam = params.get("task");
```

Change the `TaskBoard` call to:

```tsx
        <TaskBoard
          state={snapshot.map}
          goals={snapshot.goals}
          onCommand={(c) => void onMapCommand(c)}
          initialOpenId={taskParam}
        />
```

- [ ] **Step 4: Run tests to verify they pass**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/task-board-goals.test.ts
```

Expected: PASS.

Then the full gate:

From `packages/vault-core`:

```
npm test
```

Expected: PASS.

From `apps/desktop`:

```
node --experimental-strip-types --test src/lib/signal-chain.test.ts
npm test
npm run typecheck
```

Expected: PASS (all three).

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/tasks/TaskBoard.tsx apps/desktop/src/pages/ActPage.tsx apps/desktop/tests/task-board-goals.test.ts
git commit -m "feat(desktop): expand Act task from ?task="
```

---

## Spec coverage

| Spec decision | Task |
|---------------|------|
| `TaskLinks.signalId`, persist, no schema bump | 1 |
| `createTask` stores the link | 1 |
| `taskFromSignalBody` / `taskForSignal` | 2 |
| Make task → backlog, notes = body, no domain, no signal write | 3 |
| Stay on chain; flip to Open; `busyRef`; mapError | 3 |
| Open → `/act?task=` | 3 |
| Expand card; unknown id ignored | 4 |
| Out of scope (IPC, tools.ts, sourceRef, Daily Schedule place) | constraints |

## Placeholder scan

No TBD / implement later / “add tests for the above” without code. Helper signatures in Task 2 match Task 3 imports.
