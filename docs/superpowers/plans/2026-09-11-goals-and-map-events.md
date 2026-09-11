# Goals Page and Life Map Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Plan a vault-wide Goals page (own `goals.json`) above Life Map, and turn Life Map Keys into single-date events with optional domain and Goal link.

**Architecture:** New `goals.json` store with its own apply/persist path. `map.json` years replace `periodGoals` with `events`. Domain lens filters Goals and event marks only. Desktop adds `/goals`, Event panel, and a task `goalId` picker. Old Keys are stripped on map load, never migrated.

**Tech Stack:** vault-core (`node:test`), Electron IPC, React 19, React Router 7 HashRouter, existing CSS tokens. No new libraries. No `schemaVersion` bump.

**Spec:** `docs/superpowers/specs/2026-09-11-goals-and-map-events-design.md`

## Global Constraints

- Do **not** bump `schemaVersion` (stays `1`)
- Do **not** migrate old Keys — strip `periodGoals` on load and never write them back
- Goals file: `.lifequest/goals.json`. Missing file ⇒ `[]`. Malformed ⇒ `goalsError`, do not overwrite
- Events live on `YearRecord` in `map.json` (one date, not a range). Color from domain (or default token). No event swatch
- Goal domain and event domain are optional (`null` = unassigned)
- Task `links.periodGoalId` becomes `links.goalId`; old ids are dropped, not mapped
- Plan rail: Goals → Life Map → Architecture. `WING_DEFAULTS.plan` = `/goals`. Session last-path memory unchanged
- Route `/goals`. Life Map stays `/chart`. No nested `/plan/…`. No new `RoomId`
- Do **not** add an agent lock field
- Do **not** update `archive/web-skeleton`
- Out of this pass: event times/recurrence/ranges, Goal → Map click-through, Goal reorder, markdown goal files
- After Tasks 3–5, `apps/desktop` typecheck will fail until Tasks 6–8 land. Run vault-core tests after each vault-core task; run desktop tests/typecheck after Task 8
- Commit only files from the current task
- Tests: `npm test -w @lifequest/vault-core -- tests/<file>` and `npm test -w @lifequest/desktop -- tests/<file>`

---

## File Structure

```
packages/vault-core/src/
  types.ts                 # Goal, GoalsCommand, VaultSnapshot.goals / goalsError
  paths.ts                 # goalsJson
  domain-lens.ts           # filterByLens, effectiveDomainSlug, liveDomainSlugs
  goals.ts                 # NEW: applyGoalCommand, loadGoals, applyGoalsCommand
  open-vault.ts            # load goals into snapshot
  index.ts                 # export goals + event queries; drop PeriodGoal
  map/types.ts             # MapEvent, events[], TaskLinks.goalId, event commands
  map/empty.ts             # events: []
  map/events.ts            # NEW (replaces period-goals.ts)
  map/period-goals.ts      # DELETE
  map/commands.ts          # create/update/deleteEvent
  map/queries.ts           # eventsOnDate, eventsInMonth, dashboardDays
  map/persist.ts           # normalize years/tasks; ApplyContext live slugs + goalIds
  map/log-event.ts         # map.event.*
  map/tools.ts             # event tools; task goalId; GOALS_TOOL_DEFS
  map/public.ts            # export MapEvent, event queries

packages/vault-core/tests/
  goals.test.ts            # NEW
  domain-lens.test.ts      # filterByLens / effectiveDomainSlug
  create-vault.test.ts     # snapshot.goals
  map-persist.test.ts      # strip periodGoals; events persist
  map-tools.test.ts        # event + goal tools
  map/events.test.ts       # NEW (replaces period-goals.test.ts)
  map/period-goals.test.ts # DELETE
  map/queries.test.ts
  map/tasks.test.ts

apps/desktop/electron/
  vault-service.ts         # goalsApply; watch goals.json
  preload.ts / main.ts     # goals:apply
  map-tools.ts / mcp-server.ts
apps/desktop/src/
  vite-env.d.ts            # goalsApply; snapshot types
  App.tsx                  # /goals
  components/shell/nav-items.ts, wing.ts
  pages/GoalsPage.tsx      # NEW
  pages/ChartPage.tsx / ActPage.tsx
  components/map/EventPanel.tsx  # NEW (replaces KeyPanel.tsx)
  components/map/KeyPanel.tsx    # DELETE
  components/map/Dashboard.tsx / MonthPage.tsx
  components/architecture/RealWeek.tsx
  components/tasks/TaskBoard.tsx
  styles/map.css / goals.css
apps/desktop/tests/
  wing.test.ts / wing-shell.test.ts / map-dashboard.test.ts
```

---

### Task 1: Goals apply + persist

**Files:**
- Modify: `packages/vault-core/src/types.ts`
- Modify: `packages/vault-core/src/paths.ts`
- Create: `packages/vault-core/src/goals.ts`
- Create: `packages/vault-core/tests/goals.test.ts`

**Interfaces:**
- Consumes: `Result` from `types.ts`, `atomicWriteFile`, `appendLog`, `vaultPaths`, `listDomains`
- Produces: `Goal`, `GoalStatus`, `GoalsCommand`, `applyGoalCommand`, `loadGoals`, `applyGoalsCommand`, `vaultPaths().goalsJson`

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/goals.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyGoalCommand,
  applyGoalsCommand,
  loadGoals,
} from "../src/goals.ts";
import { createVault } from "../src/create-vault.ts";
import { vaultPaths } from "../src/paths.ts";
import type { Goal, GoalsApplyContext } from "../src/types.ts";

const ctx: GoalsApplyContext = {
  id: () => "g1",
  liveDomainSlugs: ["health", "intellectual"],
};

describe("applyGoalCommand", () => {
  it("creates an open unassigned goal", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "Ship the guide" },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value, [
      {
        id: "g1",
        name: "Ship the guide",
        notes: "",
        status: "open",
        domainSlug: null,
      } satisfies Goal,
    ]);
  });

  it("rejects an empty name", () => {
    const res = applyGoalCommand([], { type: "createGoal", name: "   " }, ctx);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("rejects a domain that is not live", () => {
    const res = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", domainSlug: "archived" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("update can change status and preserve a stored archived domain when omitted", () => {
    const created = applyGoalCommand(
      [],
      { type: "createGoal", name: "X", domainSlug: "health" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyGoalCommand(
      created.value,
      { type: "updateGoal", id: "g1", status: "done" },
      { ...ctx, liveDomainSlugs: [] },
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value[0].status, "done");
    assert.equal(updated.value[0].domainSlug, "health");
  });

  it("delete removes only that goal", () => {
    const twoCtx: GoalsApplyContext = {
      liveDomainSlugs: ["health"],
      id: (() => {
        let n = 0;
        return () => `g${++n}`;
      })(),
    };
    const a = applyGoalCommand([], { type: "createGoal", name: "A" }, twoCtx);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = applyGoalCommand(a.value, { type: "createGoal", name: "B" }, twoCtx);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    const del = applyGoalCommand(b.value, { type: "deleteGoal", id: "g1" }, twoCtx);
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.map((g) => g.id), ["g2"]);
  });
});

describe("goals persist", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-goals-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing file loads as empty and does not write", async () => {
    const root = path.join(dir, "missing");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.value, []);
    await assert.rejects(fs.access(vaultPaths(root).goalsJson));
  });

  it("applyGoalsCommand writes goals.json and appends a log line", async () => {
    const root = path.join(dir, "write");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const applied = await applyGoalsCommand(root, {
      type: "createGoal",
      name: "Run",
      domainSlug: "health",
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.value[0].name, "Run");
    assert.equal(applied.value[0].domainSlug, "health");
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).goalsJson, "utf8")) as {
      goals: Goal[];
    };
    assert.equal(raw.goals[0].name, "Run");
    const log = await fs.readFile(vaultPaths(root).logJsonl, "utf8");
    assert.match(log, /"type":"goal.created"/);
  });

  it("malformed goals.json is not overwritten", async () => {
    const root = path.join(dir, "bad");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).goalsJson;
    await fs.writeFile(p, "{not-json", "utf8");
    const loaded = await loadGoals(root);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal("malformed" in loaded && loaded.malformed, true);
    const applied = await applyGoalsCommand(root, { type: "createGoal", name: "X" });
    assert.equal(applied.ok, false);
    const still = await fs.readFile(p, "utf8");
    assert.equal(still, "{not-json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/goals.test.ts`

Expected: FAIL (`applyGoalCommand` / `GoalsApplyContext` / `goalsJson` not found).

- [ ] **Step 3: Write minimal implementation**

Add to `packages/vault-core/src/types.ts` (near `VaultSnapshot` is fine; Goal types can sit above it):

```ts
export type GoalStatus = "open" | "done";

export type Goal = {
  id: string;
  name: string;
  notes: string;
  status: GoalStatus;
  domainSlug: string | null;
};

export type GoalsCommand =
  | { type: "createGoal"; name: string; notes?: string; domainSlug?: string | null }
  | {
      type: "updateGoal";
      id: string;
      name?: string;
      notes?: string;
      status?: GoalStatus;
      domainSlug?: string | null;
    }
  | { type: "deleteGoal"; id: string };

export type GoalsApplyContext = {
  id: () => string;
  liveDomainSlugs: readonly string[];
};
```

Add `goalsJson: path.join(rootPath, ".lifequest", "goals.json")` to `vaultPaths` in `packages/vault-core/src/paths.ts`.

Create `packages/vault-core/src/goals.ts`. Pure apply uses map `Result` (`error.code`). Persist `loadGoals` / `applyGoalsCommand` use vault `Result` (`error: string`), same split as map persist.

```ts
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write.ts";
import { listDomains } from "./domains.ts";
import { appendLog } from "./log.ts";
import { fail, ok } from "./map/errors.ts";
import type { Result as MapResult } from "./map/types.ts";
import { vaultPaths } from "./paths.ts";
import type {
  Goal,
  GoalStatus,
  GoalsApplyContext,
  GoalsCommand,
  Result,
} from "./types.ts";

const STATUSES: GoalStatus[] = ["open", "done"];

function assertDomain(
  slug: string | null,
  live: ReadonlySet<string>,
): MapResult<void> {
  if (slug === null) return ok(undefined);
  if (!live.has(slug)) return fail("MALFORMED", "Domain is not a live domain");
  return ok(undefined);
}

export function applyGoalCommand(
  goals: Goal[],
  command: GoalsCommand,
  ctx: GoalsApplyContext,
): MapResult<Goal[]> {
  const live = new Set(ctx.liveDomainSlugs);
  switch (command.type) {
    case "createGoal": {
      const name = command.name.trim();
      if (!name) return fail("MALFORMED", "Goal name is required");
      const domainSlug = command.domainSlug ?? null;
      const domain = assertDomain(domainSlug, live);
      if (!domain.ok) return domain;
      const goal: Goal = {
        id: ctx.id(),
        name,
        notes: command.notes ?? "",
        status: "open",
        domainSlug,
      };
      return ok([...goals, goal]);
    }
    case "updateGoal": {
      const idx = goals.findIndex((g) => g.id === command.id);
      if (idx < 0) return fail("NOT_FOUND", "Goal not found");
      const next: Goal = { ...goals[idx] };
      if (command.name !== undefined) {
        const name = command.name.trim();
        if (!name) return fail("MALFORMED", "Goal name is required");
        next.name = name;
      }
      if (command.notes !== undefined) next.notes = command.notes;
      if (command.status !== undefined) {
        if (!STATUSES.includes(command.status)) {
          return fail("MALFORMED", "Invalid status");
        }
        next.status = command.status;
      }
      if (command.domainSlug !== undefined) {
        const domain = assertDomain(command.domainSlug, live);
        if (!domain.ok) return domain;
        next.domainSlug = command.domainSlug;
      }
      const copy = goals.slice();
      copy[idx] = next;
      return ok(copy);
    }
    case "deleteGoal": {
      if (!goals.some((g) => g.id === command.id)) {
        return fail("NOT_FOUND", "Goal not found");
      }
      return ok(goals.filter((g) => g.id !== command.id));
    }
    default: {
      const _exhaustive: never = command;
      return fail("MALFORMED", `Unhandled command ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function isGoal(value: unknown): value is Goal {
  if (!value || typeof value !== "object") return false;
  const g = value as Partial<Goal>;
  return (
    typeof g.id === "string" &&
    typeof g.name === "string" &&
    typeof g.notes === "string" &&
    (g.status === "open" || g.status === "done") &&
    (g.domainSlug === null || typeof g.domainSlug === "string")
  );
}

export async function loadGoals(
  rootPath: string,
): Promise<Result<Goal[]> | { ok: false; error: string; malformed: true }> {
  const p = vaultPaths(rootPath).goalsJson;
  try {
    const raw = await fs.readFile(p, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Goals store is not valid JSON", malformed: true };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { goals?: unknown }).goals) ||
      !(parsed as { goals: unknown[] }).goals.every(isGoal)
    ) {
      return { ok: false, error: "Goals store has invalid shape", malformed: true };
    }
    return { ok: true, value: (parsed as { goals: Goal[] }).goals };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: [] };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function liveDomainSlugsFromDisk(rootPath: string): Promise<Result<string[]>> {
  const listed = await listDomains(rootPath);
  if (!listed.ok) return listed;
  return {
    ok: true,
    value: listed.value.filter((d) => !d.meta.archivedAt).map((d) => d.slug),
  };
}

function logFor(
  command: GoalsCommand,
  after: Goal[],
  prior: Goal | undefined,
): {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  domainSlug: string | null;
} {
  if (command.type === "createGoal") {
    const g = after[after.length - 1];
    return {
      type: "goal.created",
      summary: `Created goal ${g.name}`,
      payload: { id: g.id, name: g.name },
      domainSlug: g.domainSlug,
    };
  }
  if (command.type === "updateGoal") {
    const g = after.find((x) => x.id === command.id);
    return {
      type: "goal.updated",
      summary: "Updated goal",
      payload: { id: command.id },
      domainSlug: g?.domainSlug ?? null,
    };
  }
  return {
    type: "goal.deleted",
    summary: "Deleted goal",
    payload: { id: command.id },
    domainSlug: prior?.domainSlug ?? null,
  };
}

export async function applyGoalsCommand(
  rootPath: string,
  command: GoalsCommand,
): Promise<Result<Goal[]>> {
  const loaded = await loadGoals(rootPath);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const live = await liveDomainSlugsFromDisk(rootPath);
  if (!live.ok) return live;
  const prior =
    command.type === "deleteGoal"
      ? loaded.value.find((g) => g.id === command.id)
      : undefined;
  const result = applyGoalCommand(loaded.value, command, {
    id: () => randomUUID(),
    liveDomainSlugs: live.value,
  });
  if (!result.ok) {
    return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  }
  try {
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await atomicWriteFile(
      paths.goalsJson,
      `${JSON.stringify({ goals: result.value }, null, 2)}\n`,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const ev = logFor(command, result.value, prior);
  await appendLog(rootPath, {
    domainSlug: ev.domainSlug,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
  });
  return { ok: true, value: result.value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @lifequest/vault-core -- tests/goals.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/types.ts packages/vault-core/src/paths.ts packages/vault-core/src/goals.ts packages/vault-core/tests/goals.test.ts
git commit -m "feat(vault-core): add vault-wide goals store"
```

---

### Task 2: Snapshot + lens helpers

**Files:**
- Modify: `packages/vault-core/src/types.ts` (`VaultSnapshot`)
- Modify: `packages/vault-core/src/open-vault.ts`
- Modify: `packages/vault-core/src/domain-lens.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `packages/vault-core/tests/domain-lens.test.ts`
- Modify: `packages/vault-core/tests/create-vault.test.ts`

**Interfaces:**
- Consumes: `loadGoals` from Task 1, `recordVisible`
- Produces: `VaultSnapshot.goals: Goal[]`, `goalsError: string | null`; `filterByLens`; `effectiveDomainSlug`; `liveDomainSlugs`

- [ ] **Step 1: Write the failing tests**

Append to `packages/vault-core/tests/domain-lens.test.ts`:

```ts
import { effectiveDomainSlug, filterByLens, liveDomainSlugs } from "../src/domain-lens.ts";

describe("filterByLens", () => {
  const items = [
    { id: "1", domainSlug: "health" },
    { id: "2", domainSlug: null },
    { id: "3", domainSlug: "gone" },
  ];
  it("overview includes assigned, unassigned, and unknown", () => {
    assert.deepEqual(
      filterByLens(items, overview).map((i) => i.id),
      ["1", "2", "3"],
    );
  });
  it("domain tab hides unassigned and unknown", () => {
    assert.deepEqual(
      filterByLens(items, health).map((i) => i.id),
      ["1"],
    );
  });
});

describe("effectiveDomainSlug", () => {
  it("unknown or archived slug becomes unassigned", () => {
    assert.equal(effectiveDomainSlug("health", ["health"]), "health");
    assert.equal(effectiveDomainSlug("gone", ["health"]), null);
    assert.equal(effectiveDomainSlug(null, ["health"]), null);
  });
});

describe("liveDomainSlugs", () => {
  it("drops archived domains", () => {
    assert.deepEqual(
      liveDomainSlugs([
        { slug: "health", meta: { archivedAt: null } },
        { slug: "old", meta: { archivedAt: "2026-01-01T00:00:00.000Z" } },
      ]),
      ["health"],
    );
  });
});
```

In `packages/vault-core/tests/create-vault.test.ts`, inside the first test after `assert.equal(res.value.mapError, null);` add:

```ts
    assert.deepEqual(res.value.goals, []);
    assert.equal(res.value.goalsError, null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/vault-core -- tests/domain-lens.test.ts tests/create-vault.test.ts`

Expected: FAIL (`filterByLens` missing and/or `goals` missing on snapshot).

- [ ] **Step 3: Write minimal implementation**

`packages/vault-core/src/domain-lens.ts` — add:

```ts
export function filterByLens<T extends { domainSlug: string | null }>(
  items: readonly T[],
  lens: DomainLens,
): T[] {
  return items.filter((item) => recordVisible(lens, item.domainSlug));
}

export function effectiveDomainSlug(
  domainSlug: string | null,
  liveSlugs: ReadonlySet<string> | readonly string[],
): string | null {
  if (!domainSlug) return null;
  const set = liveSlugs instanceof Set ? liveSlugs : new Set(liveSlugs);
  return set.has(domainSlug) ? domainSlug : null;
}

export function liveDomainSlugs(
  domains: readonly { slug: string; meta: { archivedAt: string | null } }[],
): string[] {
  return domains.filter((d) => !d.meta.archivedAt).map((d) => d.slug);
}
```

`VaultSnapshot` in `types.ts`:

```ts
export type VaultSnapshot = {
  rootPath: string;
  lifequest: LifequestJson;
  settings: VaultSettings;
  domains: DomainRecord[];
  agents: AgentHire[];
  decisions: DecisionRecord[];
  log: LifeEvent[];
  map: MapStoreState | null;
  mapError: string | null;
  goals: Goal[];
  goalsError: string | null;
};
```

`open-vault.ts` — import `loadGoals`. Before the `return { ok: true, value: { ... } }`:

```ts
    let goals: Goal[] = [];
    let goalsError: string | null = null;
    const goalsRes = await loadGoals(paths.root);
    if (goalsRes.ok) {
      goals = goalsRes.value;
    } else {
      goalsError = goalsRes.error;
    }
```

Include `goals` and `goalsError` on the snapshot object.

`index.ts` — add `export { applyGoalCommand, applyGoalsCommand, loadGoals } from "./goals.ts";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @lifequest/vault-core -- tests/domain-lens.test.ts tests/create-vault.test.ts tests/goals.test.ts`

Expected: PASS. Also run full `npm test -w @lifequest/vault-core` and fix any snapshot construction in other tests that build a fake `VaultSnapshot` (add `goals: []`, `goalsError: null`).

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/types.ts packages/vault-core/src/open-vault.ts packages/vault-core/src/domain-lens.ts packages/vault-core/src/index.ts packages/vault-core/tests/domain-lens.test.ts packages/vault-core/tests/create-vault.test.ts
git commit -m "feat(vault-core): load goals into vault snapshot"
```

---

### Task 3: Map events replace period goals (pure)

**Files:**
- Modify: `packages/vault-core/src/map/types.ts`
- Modify: `packages/vault-core/src/map/empty.ts`
- Create: `packages/vault-core/src/map/events.ts`
- Delete: `packages/vault-core/src/map/period-goals.ts`
- Modify: `packages/vault-core/src/map/commands.ts`
- Modify: `packages/vault-core/src/map/queries.ts`
- Modify: `packages/vault-core/src/map/public.ts`
- Modify: `packages/vault-core/src/index.ts`
- Create: `packages/vault-core/tests/map/events.test.ts`
- Delete: `packages/vault-core/tests/map/period-goals.test.ts`
- Modify: `packages/vault-core/tests/map/queries.test.ts`
- Modify: `packages/vault-core/tests/map/tasks.test.ts`

**Interfaces:**
- Consumes: `writableYear`, `isIsoDate`, `isDateInYear`, `ApplyContext` (extended)
- Produces: `MapEvent`; `YearRecord.events`; `TaskLinks.goalId`; commands `createEvent` / `updateEvent` / `deleteEvent`; `eventsOnDate`; `eventsInMonth`; `dashboardDays` → `{ day, events: MapEvent[] }`; `ApplyContext.liveDomainSlugs?`, `goalIds?`

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/map/events.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { ensureCurrentYear } from "../../src/map/years.ts";
import type { ApplyContext } from "../../src/map/types.ts";

const ctx: ApplyContext = {
  actor: "user",
  today: "2026-08-18",
  id: () => "e1",
  liveDomainSlugs: ["health"],
  goalIds: ["goal-1"],
};

function base() {
  return ensureCurrentYear(emptyState(), ctx.today);
}

describe("map events", () => {
  it("creates a single-date event", () => {
    const res = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "File taxes",
        date: "2026-04-15",
        domainSlug: "health",
        goalId: "goal-1",
        notes: "bring PDF",
      },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.years[0].events, [
      {
        id: "e1",
        title: "File taxes",
        date: "2026-04-15",
        notes: "bring PDF",
        domainSlug: "health",
        goalId: "goal-1",
      },
    ]);
  });

  it("rejects a date outside the year", () => {
    const res = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "X", date: "2027-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "INVALID_RANGE");
  });

  it("rejects empty title", () => {
    const res = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "  ", date: "2026-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "MALFORMED");
  });

  it("rejects a new goalId that is missing", () => {
    const res = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "X",
        date: "2026-01-01",
        goalId: "nope",
      },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "NOT_FOUND");
  });

  it("update that omits goalId keeps a dangling link", () => {
    const created = applyCommand(
      base(),
      {
        type: "createEvent",
        year: 2026,
        title: "X",
        date: "2026-01-01",
        goalId: "goal-1",
      },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = applyCommand(
      created.value,
      { type: "updateEvent", year: 2026, id: "e1", title: "Y" },
      { ...ctx, goalIds: [] },
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.years[0].events[0].title, "Y");
    assert.equal(updated.value.years[0].events[0].goalId, "goal-1");
  });

  it("allows two events on the same day; delete removes one", () => {
    let n = 0;
    const c: ApplyContext = { ...ctx, id: () => `e${++n}` };
    const a = applyCommand(
      base(),
      { type: "createEvent", year: 2026, title: "A", date: "2026-04-10" },
      c,
    );
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = applyCommand(
      a.value,
      { type: "createEvent", year: 2026, title: "B", date: "2026-04-10" },
      c,
    );
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.equal(b.value.years[0].events.length, 2);
    const del = applyCommand(
      b.value,
      { type: "deleteEvent", year: 2026, id: "e1" },
      c,
    );
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.deepEqual(del.value.years[0].events.map((e) => e.id), ["e2"]);
  });

  it("refuses writes to an archive", () => {
    const s = {
      ...base(),
      years: base().years.map((y) => ({ ...y, status: "archive" as const })),
    };
    const res = applyCommand(
      s,
      { type: "createEvent", year: 2026, title: "A", date: "2026-01-01" },
      ctx,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "ARCHIVE_READ_ONLY");
  });
});
```

Replace `packages/vault-core/tests/map/queries.test.ts` with:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyYear } from "../../src/map/empty.ts";
import {
  dashboardDays,
  eventsInMonth,
  eventsOnDate,
} from "../../src/map/queries.ts";
import type { MapEvent } from "../../src/map/types.ts";

const ev: MapEvent = {
  id: "e1",
  title: "File taxes",
  date: "2026-04-15",
  notes: "",
  domainSlug: "health",
  goalId: null,
};

describe("event queries", () => {
  it("lists events in a month", () => {
    const year = { ...emptyYear(2026), events: [ev] };
    assert.deepEqual(eventsInMonth(year, 4).map((e) => e.id), ["e1"]);
    assert.deepEqual(eventsInMonth(year, 5), []);
  });

  it("stacks events on one day in dashboardDays", () => {
    const year = {
      ...emptyYear(2026),
      events: [
        ev,
        { ...ev, id: "e2", title: "Other", date: "2026-04-15", domainSlug: null },
      ],
    };
    assert.deepEqual(eventsOnDate(year, "2026-04-15").map((e) => e.id), ["e1", "e2"]);
    const days = dashboardDays(year, 4);
    assert.equal(days.length, 30);
    assert.deepEqual(days[14].events.map((e) => e.id), ["e1", "e2"]);
  });
});
```

In `packages/vault-core/tests/map/tasks.test.ts`, replace the period-goal dangling test with:

```ts
  it("stores a goalId link on a task", () => {
    const task = applyCommand(
      base(),
      { type: "createTask", title: "Write guide", links: { goalId: "goal-1" } },
      user,
    );
    assert.equal(task.ok, true);
    if (!task.ok) return;
    assert.equal(task.value.tasks[0].links.goalId, "goal-1");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/vault-core -- tests/map/events.test.ts tests/map/queries.test.ts tests/map/tasks.test.ts`

Expected: FAIL (`createEvent` unhandled / `periodGoals` still on year).

- [ ] **Step 3: Write minimal implementation**

`ApplyContext` in `map/types.ts`:

```ts
export type ApplyContext = {
  actor: Actor;
  today: IsoDate;
  id: () => string;
  liveDomainSlugs?: readonly string[];
  goalIds?: readonly string[];
};
```

Replace `PeriodGoal` with:

```ts
export type MapEvent = {
  id: string;
  title: string;
  date: IsoDate;
  notes: string;
  domainSlug: string | null;
  goalId: string | null;
};
```

`YearRecord.periodGoals` → `events: MapEvent[]`.

`TaskLinks`:

```ts
export type TaskLinks = {
  goalId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
};
```

Replace the three period-goal command variants with:

```ts
  | {
      type: "createEvent";
      year: number;
      title: string;
      date: IsoDate;
      notes?: string;
      domainSlug?: string | null;
      goalId?: string | null;
    }
  | {
      type: "updateEvent";
      year: number;
      id: string;
      title?: string;
      date?: IsoDate;
      notes?: string;
      domainSlug?: string | null;
      goalId?: string | null;
    }
  | { type: "deleteEvent"; year: number; id: string }
```

`empty.ts`: `events: []` instead of `periodGoals: []`.

Create `map/events.ts` (mirror `period-goals.ts` structure):

- `createEvent`: `writableYear`; trim title; `isIsoDate` + `isDateInYear` else `INVALID_RANGE`; `domainSlug` default `null`, if non-null must be in `ctx.liveDomainSlugs ?? []`; `goalId` default `null`, if non-null must be in `ctx.goalIds ?? []` else `NOT_FOUND`; append to `events`.
- `updateEvent`: same date/title/domain checks **only for fields present in the patch**. If `goalId` is omitted, keep stored value even when `ctx.goalIds` no longer contains it. If `goalId` is provided and non-null, it must be in `ctx.goalIds`.
- `deleteEvent`: `NOT_FOUND` if missing.
- Export `isMapEvent(value: unknown): value is MapEvent` for persist normalize.

`commands.ts`: swap period-goal cases for event cases; pass `ctx` into create/update.

`queries.ts`:

```ts
export function eventsInMonth(year: YearRecord, month: number): MapEvent[] {
  const prefix = `${year.year}-${String(month).padStart(2, "0")}-`;
  return year.events.filter((e) => e.date.startsWith(prefix));
}

export function eventsOnDate(year: YearRecord, date: IsoDate): MapEvent[] {
  return year.events.filter((e) => e.date === date);
}

export function dashboardDays(
  year: YearRecord,
  month: number,
): { day: number; events: MapEvent[] }[] {
  const n = daysInMonth(year.year, month);
  const out: { day: number; events: MapEvent[] }[] = [];
  for (let day = 1; day <= n; day++) {
    const date = `${year.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ day, events: eventsOnDate(year, date) });
  }
  return out;
}
```

`public.ts` / `index.ts`: export `MapEvent`, `eventsOnDate`, `eventsInMonth`; drop `PeriodGoal`, `periodGoalsOnDate`, `periodGoalsOverlappingMonth`.

Delete `period-goals.ts` and `period-goals.test.ts`.

- [ ] **Step 4: Run vault-core map tests**

Run: `npm test -w @lifequest/vault-core -- tests/map/events.test.ts tests/map/queries.test.ts tests/map/tasks.test.ts tests/map/years.test.ts tests/map/archive-resolve.test.ts`

Expected: PASS. `map/tools.ts` and `map/log-event.ts` still name period-goal commands after the `Command` union change — update them in this task so `npm test -w @lifequest/vault-core` passes. Goal-tool defs stay for Task 5.

Minimal log-event cases:

```ts
    case "createEvent":
      return {
        type: "map.event.created",
        summary: `Created event ${command.title}`,
        payload: { year: command.year, title: command.title, date: command.date },
      };
    case "updateEvent":
      return {
        type: "map.event.updated",
        summary: "Updated event",
        payload: { year: command.year, id: command.id },
      };
    case "deleteEvent":
      return {
        type: "map.event.deleted",
        summary: "Deleted event",
        payload: { year: command.year, id: command.id },
      };
```

Minimal tools: remove the three `*_period_goal` defs and `commandForTool` cases; add `create_event` / `update_event` / `delete_event` that return the new commands. Task 5 fleshes descriptions and Goal tools.

`TASK_LINKS` in tools: `goalId` instead of `periodGoalId`.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/map packages/vault-core/src/index.ts packages/vault-core/tests/map
git commit -m "feat(vault-core): replace period goals with single-date events"
```

---

### Task 4: Map load normalize + apply context from disk

**Files:**
- Modify: `packages/vault-core/src/map/persist.ts`
- Modify: `packages/vault-core/tests/map-persist.test.ts`

**Interfaces:**
- Consumes: `loadGoals`, `listDomains` / `liveDomainSlugs`, `isMapEvent`, `applyCommand` with `liveDomainSlugs` + `goalIds`
- Produces: load strips `periodGoals` and `links.periodGoalId`; first persist after open writes the stripped map; `applyMapCommand` fills ApplyContext from disk

- [ ] **Step 1: Write the failing test**

Append to `packages/vault-core/tests/map-persist.test.ts`:

```ts
  it("strips periodGoals and periodGoalId on load and does not write them back", async () => {
    const root = path.join(dir, "strip-keys");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    const raw = JSON.parse(await fs.readFile(p, "utf8")) as {
      years: Array<Record<string, unknown>>;
      tasks: Array<Record<string, unknown>>;
    };
    raw.years[0].periodGoals = [
      {
        id: "old",
        name: "Legacy Key",
        color: "gold",
        start: "2026-01-01",
        end: "2026-01-02",
      },
    ];
    raw.years[0].events = undefined;
    raw.tasks = [
      {
        id: "t1",
        title: "Old",
        notes: "",
        column: "backlog",
        links: { periodGoalId: "old" },
      },
    ];
    await fs.writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const year = opened.value.map?.years[0];
    assert.ok(year);
    assert.equal("periodGoals" in year, false);
    assert.deepEqual(year.events, []);
    assert.equal(opened.value.map?.tasks[0].links.periodGoalId, undefined);
    assert.equal(opened.value.map?.tasks[0].links.goalId, undefined);
    const saved = JSON.parse(await fs.readFile(p, "utf8")) as {
      years: Array<Record<string, unknown>>;
      tasks: Array<{ links: Record<string, unknown> }>;
    };
    assert.equal("periodGoals" in saved.years[0], false);
    assert.ok(Array.isArray(saved.years[0].events));
    assert.equal(saved.tasks[0].links.periodGoalId, undefined);
  });

  it("applyMapCommand createEvent validates goalId against goals.json", async () => {
    const root = path.join(dir, "event-goal");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const goals = await applyGoalsCommand(root, { type: "createGoal", name: "Outcome" });
    assert.equal(goals.ok, true);
    if (!goals.ok) return;
    const id = goals.value[0].id;
    const applied = await applyMapCommand(
      root,
      {
        type: "createEvent",
        year: 2026,
        title: "Deadline",
        date: "2026-04-15",
        goalId: id,
        domainSlug: "health",
      },
      "user",
      "2026-08-18",
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.value.years[0].events[0].goalId, id);
    const missing = await applyMapCommand(
      root,
      {
        type: "createEvent",
        year: 2026,
        title: "Nope",
        date: "2026-04-16",
        goalId: "missing",
      },
      "user",
      "2026-08-18",
    );
    assert.equal(missing.ok, false);
  });
```

Import `applyGoalsCommand` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/map-persist.test.ts`

Expected: FAIL (legacy `periodGoals` still round-trip, or `goalIds` not passed into apply).

- [ ] **Step 3: Write minimal implementation**

In `persist.ts` `fromFile`, normalize:

```ts
function normalizeLinks(links: Record<string, unknown> | undefined): Task["links"] {
  const next: Task["links"] = {};
  if (!links || typeof links !== "object") return next;
  if (typeof links.goalId === "string") next.goalId = links.goalId;
  if (typeof links.date === "string") next.date = links.date;
  if (links.weekItem && typeof links.weekItem === "object") {
    next.weekItem = links.weekItem as Task["links"]["weekItem"];
  }
  return next;
}

function normalizeYear(raw: Record<string, unknown>): YearRecord {
  const events = Array.isArray(raw.events)
    ? raw.events.filter(isMapEvent)
    : [];
  return {
    year: raw.year as number,
    status: raw.status as YearRecord["status"],
    events,
    months: raw.months as YearRecord["months"],
    detachedWeeks: (raw.detachedWeeks as YearRecord["detachedWeeks"]) ?? {},
    snapshot: raw.snapshot as YearRecord["snapshot"],
  };
}
```

Use these in `fromFile` (map each year/task). Do **not** copy `periodGoals`.

`ensureMapOnOpen` already persists when `JSON.stringify(toFile(next)) !== JSON.stringify(toFile(loaded.value))`. After normalize, that inequality is true and the stripped file is written. Keep that behavior.

`applyMapCommand` context:

```ts
  const domains = await listDomains(rootPath);
  const live = domains.ok
    ? domains.value.filter((d) => !d.meta.archivedAt).map((d) => d.slug)
    : [];
  const goals = await loadGoals(rootPath);
  const goalIds = goals.ok ? goals.value.map((g) => g.id) : [];
  const result = applyCommand(ensured.value, command, {
    actor,
    today,
    id: () => randomUUID(),
    liveDomainSlugs: live,
    goalIds,
  });
```

For event log lines, pass `domainSlug` from the command when present:

```ts
  await appendLog(rootPath, {
    domainSlug:
      "domainSlug" in command ? ((command.domainSlug as string | null | undefined) ?? null) : null,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
  });
```

Non-event map commands keep `domainSlug: null` (today’s behavior) — only event commands have the field. Implementing the `"domainSlug" in command` check is enough.

- [ ] **Step 4: Run tests**

Run: `npm test -w @lifequest/vault-core -- tests/map-persist.test.ts tests/goals.test.ts`

Expected: PASS. Then full `npm test -w @lifequest/vault-core`.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/map/persist.ts packages/vault-core/tests/map-persist.test.ts
git commit -m "feat(vault-core): strip legacy keys and bind event goal ids"
```

---

### Task 5: MCP / planner tools

**Files:**
- Modify: `packages/vault-core/src/map/tools.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `packages/vault-core/tests/map-tools.test.ts`
- Modify: `apps/desktop/electron/map-tools.ts`
- Modify: `apps/desktop/electron/mcp-server.ts`

**Interfaces:**
- Consumes: `GoalsCommand`, `applyGoalsCommand`, event `MapCommand`s
- Produces: `GOALS_TOOL_DEFS`; `commandForGoalTool`; `create_event` / `update_event` / `delete_event`; `list_goals` / `create_goal` / `update_goal` / `delete_goal`; no `*_period_goal` tools; task links `goalId`

- [ ] **Step 1: Write the failing test**

Replace/extend `packages/vault-core/tests/map-tools.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  commandForGoalTool,
  commandForTool,
  GOALS_TOOL_DEFS,
  MAP_TOOL_DEFS,
} from "../src/map/tools.ts";

describe("commandForTool", () => {
  it("maps create_event", () => {
    const cmd = commandForTool("create_event", {
      year: 2026,
      title: "File",
      date: "2026-04-15",
    });
    assert.deepEqual(cmd, {
      type: "createEvent",
      year: 2026,
      title: "File",
      date: "2026-04-15",
    });
  });
  it("maps create_task links.goalId", () => {
    const cmd = commandForTool("create_task", {
      title: "Run",
      links: { goalId: "g1" },
    });
    assert.deepEqual(cmd, {
      type: "createTask",
      title: "Run",
      links: { goalId: "g1" },
    });
  });
  it("returns null for get_state, get_doctrine, list_goals", () => {
    assert.equal(commandForTool("get_state", {}), null);
    assert.equal(commandForTool("get_doctrine", {}), null);
    assert.equal(commandForGoalTool("list_goals", {}), null);
  });
  it("returns null for unknown and removed period-goal tools", () => {
    assert.equal(commandForTool("create_period_goal", {}), null);
    assert.equal(commandForTool("forge_document", {}), null);
  });
});

describe("tool defs", () => {
  it("exposes event tools and goal tools, not period goals", () => {
    const mapNames = MAP_TOOL_DEFS.map((t) => t.name);
    const goalNames = GOALS_TOOL_DEFS.map((t) => t.name);
    assert.equal(mapNames.includes("create_event"), true);
    assert.equal(mapNames.includes("create_period_goal"), false);
    assert.deepEqual(goalNames, [
      "list_goals",
      "create_goal",
      "update_goal",
      "delete_goal",
    ]);
  });
});

describe("commandForGoalTool", () => {
  it("maps create_goal", () => {
    assert.deepEqual(commandForGoalTool("create_goal", { name: "Ship" }), {
      type: "createGoal",
      name: "Ship",
    });
  });
});
```

Add `GOALS_TOOL_DEFS` + `commandForGoalTool` at the bottom of `map/tools.ts` (same `MapToolDef` shape) so MCP can iterate both arrays.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/vault-core -- tests/map-tools.test.ts`

Expected: FAIL (`GOALS_TOOL_DEFS` / `create_event` missing, or period-goal tools still present).

- [ ] **Step 3: Write minimal implementation**

`MAP_TOOL_DEFS`: delete the three period-goal entries. Add:

```ts
  {
    name: "create_event",
    description: "Create a single-date Life Map event / deadline",
    parameters: {
      type: "object",
      properties: {
        year: NUMBER,
        title: STRING,
        date: STRING,
        notes: STRING,
        domainSlug: STRING,
        goalId: STRING,
      },
      required: ["year", "title", "date"],
    },
  },
  // update_event: required year+id; optional title, date, notes, domainSlug, goalId
  // delete_event: required year+id
```

`TASK_LINKS.properties`: `goalId: STRING` (no `periodGoalId`).

`commandForTool` cases for the three event tools (mirror create/update/delete period goal, with the new fields). `omitUndefined` already drops missing optionals.

`GOALS_TOOL_DEFS`:

```ts
export const GOALS_TOOL_DEFS: MapToolDef[] = [
  { name: "list_goals", description: "List vault-wide Goals", parameters: { type: "object", properties: {} } },
  {
    name: "create_goal",
    description: "Create a vault-wide Goal outcome",
    parameters: {
      type: "object",
      properties: { name: STRING, notes: STRING, domainSlug: STRING },
      required: ["name"],
    },
  },
  {
    name: "update_goal",
    description: "Update a Goal",
    parameters: {
      type: "object",
      properties: {
        id: STRING,
        name: STRING,
        notes: STRING,
        status: { type: "string", enum: ["open", "done"] },
        domainSlug: STRING,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_goal",
    description: "Delete a Goal",
    parameters: { type: "object", properties: { id: STRING }, required: ["id"] },
  },
];
```

`commandForGoalTool(name, args)` → `GoalsCommand | null`. `list_goals` → `null`.

Export both from `index.ts`.

`apps/desktop/electron/mcp-server.ts`: `for (const def of [...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS])`.

`apps/desktop/electron/map-tools.ts` `executeTool`:

```ts
  if (name === "list_goals") return { goals: snap.value.goals };
  const goalCmd = commandForGoalTool(name, rec);
  if (goalCmd) {
    const applied = await applyGoalsCommand(root, goalCmd);
    if (!applied.ok) return { error: { message: applied.error } };
    return { goals: applied.value };
  }
```

Keep existing `get_state` / `get_doctrine` / `commandForTool` + `applyMapCommand` path.

Planner `openaiTools`: `[...MAP_TOOL_DEFS, ...GOALS_TOOL_DEFS]`. Update SYSTEM one sentence: “Goals are vault-wide outcomes in goals.json; Life Map events are single-date deadlines that may link to a Goal.”

- [ ] **Step 4: Run tests**

Run: `npm test -w @lifequest/vault-core -- tests/map-tools.test.ts`

Expected: PASS. Full `npm test -w @lifequest/vault-core`.

- [ ] **Step 5: Commit**

```bash
git add packages/vault-core/src/map/tools.ts packages/vault-core/src/index.ts packages/vault-core/tests/map-tools.test.ts apps/desktop/electron/map-tools.ts apps/desktop/electron/mcp-server.ts
git commit -m "feat: add goal and event agent tools"
```

---

### Task 6: Desktop Goals page, nav, IPC

**Files:**
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/shell/nav-items.ts`
- Modify: `apps/desktop/src/components/shell/wing.ts`
- Create: `apps/desktop/src/pages/GoalsPage.tsx`
- Create: `apps/desktop/src/styles/goals.css` (imported from `apps/desktop/src/styles/global.css` next to `map.css`)
- Modify: `apps/desktop/tests/wing.test.ts`
- Modify: `apps/desktop/tests/wing-shell.test.ts`

**Interfaces:**
- Consumes: `applyGoalsCommand`, `GoalsCommand`, `filterByLens`, `Goal`
- Produces: `api().goalsApply(command)`; route `/goals`; `WING_DEFAULTS.plan = "/goals"`; Plan nav `[goals, chart, track]`

- [ ] **Step 1: Write the failing tests**

`apps/desktop/tests/wing.test.ts` changes:

- `session.lastPath.plan` and `WING_DEFAULTS.plan` → `"/goals"`
- `wingForPath("/goals")` → `"plan"`
- `selectWing(initialWingSession(), "plan").pathname` → `"/goals"`
- `applyPath(..., "/log")` keeps `lastPath.plan === "/goals"`
- NAV plan ids → `["goals", "chart", "track"]`
- Add: after `applyPath(session, "/chart")`, `selectWing(..., "plan").pathname` is `"/chart"` (session memory)

`apps/desktop/tests/wing-shell.test.ts`: assert nested routes include `/goals` as well as `/chart`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @lifequest/desktop -- tests/wing.test.ts tests/wing-shell.test.ts`

Expected: FAIL (plan default still `/chart`, no Goals nav item).

- [ ] **Step 3: Write minimal implementation**

IPC (mirror `mapApply`):

```ts
export async function goalsApply(
  command: GoalsCommand,
): Promise<Result<VaultSnapshot>> {
  return withVault(async (root) => {
    const applied = await applyGoalsCommand(root, command);
    if (!applied.ok) return applied;
    return openVault(root);
  });
}
```

`captureDoctrineMtimes`: watch `paths.goalsJson` alongside `mapJson` and `about.md`.

preload: `goalsApply: (command) => ipcRenderer.invoke("goals:apply", command)`

main: `ipcMain.handle("goals:apply", (_e, command) => vault.goalsApply(command))`

`vite-env.d.ts`: `goalsApply: (command: GoalsCommand) => Promise<Result<VaultSnapshot>>` and import `GoalsCommand`.

`wing.ts`: `"/goals": "plan"` in `PATH_WING`; `plan: "/goals"` in `WING_DEFAULTS`.

`nav-items.ts`: add `Goal` to the `lucide-react` import. Insert before Life Map:

```ts
  {
    id: "goals",
    href: "/goals",
    label: "Goals",
    icon: Goal,
    section: "main",
    wing: "plan",
  },
```

`styles/global.css`: `@import "./goals.css";` next to the map import.

Update the file’s top comment: `Plan: Goals, Life Map, Architecture.`

`App.tsx`: `import GoalsPage from "@/pages/GoalsPage";` and `<Route path="/goals" element={<GoalsPage />} />` next to `/chart`.

`GoalsPage.tsx` (renderer-only lens filter):

- `useVault()`, `useDomainLens()`, `filterByLens(snapshot.goals, lens)`
- Status filter buttons: Open (default) / Done / All
- List rows: name, status, domain name or “Unassigned”, truncated notes, count of `map.years.flatMap(y => y.events).filter(e => e.goalId === goal.id).length` labeled “N events” (no navigation)
- Add form: name (required), notes textarea, domain `<select>`: Unassigned + live domains by `sortOrder`. Default domain = `lensSlug(lens)` or Unassigned. Submit `goalsApply({ type: "createGoal", name, notes, domainSlug })`
- Edit: same fields + status select; Save `updateGoal`; Delete with `window.confirm` then `deleteGoal`
- `goalsError`: `<p className="form-error" role="alert">`; hide Add
- Empty Overview: “No goals yet.” Empty domain: `No goals in ${domainName}.`

Domain picker values: empty string → `null`. Never write `"overview"`.

- [ ] **Step 4: Run tests**

Run: `npm test -w @lifequest/desktop -- tests/wing.test.ts tests/wing-shell.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron apps/desktop/src/vite-env.d.ts apps/desktop/src/App.tsx apps/desktop/src/components/shell apps/desktop/src/pages/GoalsPage.tsx apps/desktop/src/styles apps/desktop/tests/wing.test.ts apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): add Plan Goals page and IPC"
```

---

### Task 7: Life Map events UI

**Files:**
- Create: `apps/desktop/src/components/map/EventPanel.tsx`
- Delete: `apps/desktop/src/components/map/KeyPanel.tsx`
- Modify: `apps/desktop/src/components/map/Dashboard.tsx`
- Modify: `apps/desktop/src/components/map/MonthPage.tsx`
- Modify: `apps/desktop/src/pages/ChartPage.tsx`
- Modify: `apps/desktop/src/components/architecture/RealWeek.tsx`
- Modify: `apps/desktop/src/styles/map.css`
- Modify: `apps/desktop/tests/map-dashboard.test.ts`

**Interfaces:**
- Consumes: `MapEvent`, `eventsInMonth`, `eventsOnDate`, `dashboardDays`, `filterByLens`, `effectiveDomainSlug`, `Goal[]`
- Produces: click-a-day add event (no drag range); Events panel; month Events list; day marks colored from domain (or `--map-event-default`)

- [ ] **Step 1: Write the failing test**

Replace `apps/desktop/tests/map-dashboard.test.ts` Life Map dashboard describe with:

```ts
describe("Life Map dashboard", () => {
  it("imports dashboardDays from vault-core/map and has no period-goal paint", () => {
    const src = read("src/components/map/Dashboard.tsx");
    assert.match(
      src,
      /import \{[^}]*\bdashboardDays\b[^}]*\} from ["']@lifequest\/vault-core\/map["']/,
    );
    assert.equal(src.includes("createPeriodGoal"), false);
    assert.equal(src.includes("startPaint"), false);
    assert.equal(src.includes("KeyPanel"), false);
    assert.match(src, /EventPanel/);
  });

  it("EventPanel adds createEvent with a domain picker", () => {
    const panel = read("src/components/map/EventPanel.tsx");
    assert.match(panel, /type: "createEvent"/);
    assert.match(panel, /domainSlug/);
    assert.match(panel, /goalId/);
    assert.equal(panel.includes("createPeriodGoal"), false);
    assert.equal(panel.includes("PALETTE"), false);
  });
});
```

Keep the theme describe that forbids leftover hex and requires `[data-map-color="gold"]` (day types still use it). Add:

```ts
    assert.match(src, /--map-event-default/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/map-dashboard.test.ts`

Expected: FAIL (`EventPanel` missing, `startPaint` still present).

- [ ] **Step 3: Write minimal implementation**

Shared mark color helper in `apps/desktop/src/components/map/eventColor.ts`:

```ts
import { effectiveDomainSlug } from "@lifequest/vault-core/pure";
import type { DomainRecord } from "@lifequest/vault-core";

export const DEFAULT_EVENT_COLOR = "var(--map-event-default)";

export function eventMarkColor(
  domainSlug: string | null,
  domains: DomainRecord[],
): string {
  const live = domains.filter((d) => !d.meta.archivedAt).map((d) => d.slug);
  const slug = effectiveDomainSlug(domainSlug, live);
  if (!slug) return DEFAULT_EVENT_COLOR;
  const color = domains.find((d) => d.slug === slug)?.meta.color;
  return color && color.trim() ? color : DEFAULT_EVENT_COLOR;
}
```

`map.css`:

```css
.life-map {
  --map-event-default: var(--fg-muted);
}
.life-map .event-mark {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--map-event-default);
  display: inline-block;
}
```

`EventPanel.tsx`:
- Props: `year`, `readOnly`, `onCommand`, `goals: Goal[]`, `domains: DomainRecord[]`, `lens`, `seedDate: string | null`, `onConsumedSeed: () => void`
- Visible events: `filterByLens(year.events, lens)` sorted by `date` then `title`
- Heading `{year} Events`, button **Add event** (hidden if `readOnly`)
- Form fields: title, `input type="date"` min=`${year}-01-01` max=`${year}-12-31`, notes, domain select (Unassigned + live domains), Goal select (open goals vault-wide; if current `goalId` is done/missing, extra option `{name} (done)` or `{id} (missing)`)
- When `seedDate` is set, open add form with that date and call `onConsumedSeed`
- Submit create/update `createEvent` / `updateEvent`; delete is immediate `deleteEvent` (no confirm)
- Empty: “No events this year.” (or “No events in {domain}.” when lens is a domain)

`Dashboard.tsx`:
- Remove drag state, `COLOR_IDS` paint dialog, `KeyPanel`
- `onPointerDown` on a day → if not `readOnly`, `setSeedDate(date)` (click, not drag)
- `dashboardDays(year, month)` then `filterByLens(events, lens)` for marks
- Marks: `<span className="event-mark" style={{ background: eventMarkColor(ev.domainSlug, domains) }} />`
- Need `domains`, `goals`, `lens` props from `ChartPage` (ChartPage already has `useVault`)

`MonthPage.tsx`: `eventsInMonth` + `filterByLens`; heading **Events**; empty “No events this month.”; day marks same as dashboard. Pass `domains` + `lens`.

`ChartPage.tsx` `yearHasContent`: `year.events.length > 0` instead of `periodGoals`. Confirm copy: “It has events, month text, or detached weeks.”

`RealWeek.tsx`: replace `periodGoalsOnDate` with `eventsOnDate`; unique events across the week by id; render title + mark color (not `data-map-color` ColorId). Pass domains from the parent if RealWeek currently has no vault hook — add `useVault()` inside or pass props. Prefer `useVault()` + `useDomainLens()` so Architecture stays lens-filtered on event chips only.

- [ ] **Step 4: Run tests**

Run: `npm test -w @lifequest/desktop -- tests/map-dashboard.test.ts tests/shell-visuals.test.ts`

Expected: PASS (`shell-visuals` still bleeds `/chart` only — Goals page does **not** bleed).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/map apps/desktop/src/pages/ChartPage.tsx apps/desktop/src/components/architecture/RealWeek.tsx apps/desktop/src/styles/map.css apps/desktop/tests/map-dashboard.test.ts
git commit -m "feat(desktop): Life Map single-date events with domain marks"
```

---

### Task 8: Task board Goal picker + verify

**Files:**
- Modify: `apps/desktop/src/components/tasks/TaskBoard.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Create: `apps/desktop/tests/task-board-goals.test.ts` (source scan)

**Interfaces:**
- Consumes: `Goal[]` from snapshot, `TaskLinks.goalId`
- Produces: task picker lists vault-wide open Goals (+ current dangling/done); writes `links.goalId`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/task-board-goals.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/tasks/TaskBoard.tsx"),
  "utf8",
);

describe("TaskBoard goal picker", () => {
  it("links tasks to vault Goals, not period goals", () => {
    assert.match(src, /goalId/);
    assert.equal(src.includes("periodGoalId"), false);
    assert.equal(src.includes("periodGoals"), false);
    assert.match(src, /goals: Goal\[\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @lifequest/desktop -- tests/task-board-goals.test.ts`

Expected: FAIL (`periodGoalId` still in TaskBoard).

- [ ] **Step 3: Write minimal implementation**

`TaskBoard` props:

```ts
type Props = {
  state: StoreState;
  goals: Goal[];
  onCommand: (command: MapCommand) => void;
};
```

Replace `liveGoals` / `goalExists` / `findGoalName` to use the `goals` prop:

```ts
function openGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status === "open");
}
```

Picker: options = open goals; if `task.links.goalId` is set and the Goal is missing, option `value={id}` label `{id} (missing)`; if found but `done`, option `{name} (done)`.

`patchLinks`: `if ("goalId" in patch && !patch.goalId) delete next.goalId;`

`ActPage.tsx`: `<TaskBoard state={snapshot.map} goals={snapshot.goals} onCommand={...} />`

- [ ] **Step 4: Run full verification**

Run:

```
npm test -w @lifequest/vault-core
npm test -w @lifequest/desktop
npm run typecheck -w @lifequest/desktop
```

Expected: all PASS, typecheck clean. Grep the repo (except `archive/` and this plan/spec) for `periodGoal` / `PeriodGoal` / `createPeriodGoal` / `KeyPanel` and delete leftovers.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/tasks/TaskBoard.tsx apps/desktop/src/pages/ActPage.tsx apps/desktop/tests/task-board-goals.test.ts
git commit -m "feat(desktop): point Act tasks at vault Goals"
```

---

## Self-review (author)

1. Spec coverage: Goals file/page, events on year, domain picker, optional Goal link, discard Keys, task `goalId`, Plan default `/goals` + session memory, lens filter, MCP tools, log types, file watch, no schema bump — each has a task.
2. Placeholders: none remaining. Task 1 persist writes once via `atomicWriteFile`. Goal tools live in `map/tools.ts` (`GOALS_TOOL_DEFS`).
3. Types: `MapEvent`, `GoalsCommand`, `goalId`, `eventsOnDate` / `eventsInMonth` used consistently after Task 3.
