# Life Map on Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Life Map’s year canvas, week architecture, task board, agent lock, tool-using Hermes chat, and loopback MCP into the LifeQuest desktop vault, with Chart labeled Life Map and Track labeled Architecture.

**Architecture:** Copy Life Map’s pure `applyCommand` domain into `packages/vault-core/src/map/`. Persist `StoreState` (minus `aboutMe`) as `.lifequest/map.json` and About me as `.lifequest/about.md`. Electron main serializes `map:apply` on the existing vault queue (`actor: "user"` from the renderer; `"agent"` from chat/MCP). Doctrine stays on the existing document/decision IPC. Renderer pages wrap the ported Map UI and talk to vault-core only through IPC plus pure queries.

**Tech Stack:** Existing LifeQuest Electron + Vite + React 19 + TypeScript; vault-core `node:test`; Life Map domain copied from `C:\Users\karms\projects\Life-Map`; `@modelcontextprotocol/sdk` + `zod` added to `@lifequest/desktop` for MCP only.

**Spec:** `docs/superpowers/specs/2026-08-27-life-map-chart-design.md`

## Global Constraints

- Host is **LifeQuest** Electron + vault. Do not run Life Map’s Vite/Hono server inside Quest.
- Routes stay `/chart` and `/track`. Nav labels: **Life Map** and **Architecture**. Room ids stay `chart` / `track` / `act`.
- One global calendar per vault. Domain switcher does not swap Map state.
- `lifequest.json` `schemaVersion` stays **1**.
- `map.json` is one blob (`locked`, `dayTypes`, `defaultWeek`, `years`, `tasks`). `aboutMe` lives only in `about.md`.
- Renderer Map writes always `actor: "user"`. Chat, Act dispatch, and MCP use `actor: "agent"`.
- Agents cannot write Why / What / How, forge, Decisions, or flip the lock.
- Hermes only. No OpenRouter. Keys stay in `safeStorage`.
- MCP binds `127.0.0.1:8643`. If taken, fail visibly in Settings; do not pick another port.
- No `life-map.json` importer in this plan.
- Unlock: any **live** domain with non-empty Why unlocks `chart`, `track`, and `act`. Act **Run an agent** still requires the active domain’s How body.
- Tests: vault-core uses `node:test` (not Vitest). Windows-safe commands (PowerShell).
- Source of copied domain/UI: `C:\Users\karms\projects\Life-Map` (do not rewrite Map rules).

---

## File Structure

```
packages/vault-core/
  package.json                         # add export "./map"
  src/
    paths.ts                           # mapJson, aboutMd
    types.ts                           # VaultSnapshot.map + mapError
    unlock.ts                          # vault-wide unlock + canDispatchAgent
    pure.ts                            # re-export new unlock helpers
    index.ts                           # persist + map public API
    create-vault.ts                    # seed map files
    open-vault.ts                      # load/seed/rollover map
    map/                               # copied Life Map domain (pure)
      types.ts, errors.ts, dates.ts, palette.ts, empty.ts
      years.ts, lock.ts, writable.ts, period-goals.ts, months.ts
      day-types.ts, default-week.ts, weeks.ts, tasks.ts, about.ts
      commands.ts, queries.ts
      persist.ts                       # NEW Node load/save/apply + log
      log-event.ts                     # NEW command → LifeEvent
      public.ts                        # renderer-safe re-exports (no Result clash)
      tools.ts                         # NEW shared tool names → Command
  tests/
    unlock.test.ts                     # rewrite for vault-wide unlock
    create-vault.test.ts               # map.json + about.md seed
    map-persist.test.ts                # NEW
    map/                               # converted Life Map domain tests
      dates.test.ts, … (see Task 1)

apps/desktop/
  package.json                         # MCP deps in Task 9
  electron/
    main.ts                            # map IPC, MCP start/stop, watch map files
    preload.ts                         # mapGetState, mapApply, hermesChatTools
    vault-service.ts                   # mapApply wrapper
    hermes-proxy.ts                    # chat with tools (Task 8)
    map-tools.ts                       # tool loop (Task 8)
    mcp-server.ts                      # Task 9
  src/
    vite-env.d.ts                      # IPC types
    lib/settings-views.ts              # about section
    state/VaultProvider.tsx            # snapshot already includes map
    state/MapYearProvider.tsx          # session year + month
    components/shell/
      nav-items.ts                     # labels
      TopBar.tsx                       # agent lock
      RoomLockGate.tsx                 # vault-wide unlock copy
      useActiveDomain.ts               # unlock from all domains
    components/map/                    # ported Dashboard, KeyPanel, MonthPage, paintRange, monthGrid
    components/architecture/           # ported DayTypes, DefaultWeek, RealWeek, weekList
    components/tasks/                  # ported TaskBoard, groupTasks
    components/doctrine/DoctrineStrip.tsx
    components/settings/SettingsAbout.tsx
    pages/ChartPage.tsx                # replaces RoomPage for /chart
    pages/ArchitecturePage.tsx         # replaces RoomPage for /track
    pages/ActPage.tsx                  # add TaskBoard
    pages/HomePage.tsx                 # Today / This week cards
    styles/map.css                     # scoped Life Map CSS
    App.tsx                            # routes
```

Do **not** add `packages/map-core`. Do **not** copy Life Map `src/server/http.ts` or OpenRouter settings.

---

## Frozen interfaces

Later tasks must use these names.

```ts
// packages/vault-core/src/map/types.ts  (copied; keep Life Map names internally)
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export type StoreState = {
  locked: boolean;
  dayTypes: DayType[];
  defaultWeek: DefaultWeek;
  years: YearRecord[];
  tasks: Task[];
  aboutMe: string;
};

export type Command =
  | { type: "setLock"; locked: boolean }
  | { type: "setAboutMe"; text: string }
  | /* remaining Life Map Command union, unchanged */;

export function applyCommand(
  state: StoreState,
  command: Command,
  ctx: ApplyContext,
): Result<StoreState>;
```

```ts
// packages/vault-core/src/map/public.ts  (Quest-facing names)
export type {
  StoreState as MapStoreState,
  Command as MapCommand,
  Actor as MapActor,
  DomainError as MapDomainError,
  YearRecord,
  PeriodGoal,
  Task,
  TaskColumn,
  ColorId,
  DayType,
  DetachedWeek,
  ResolvedWeek,
} from "./types.ts";
export { applyCommand as applyMapCommandPure } from "./commands.ts";
export { dashboardDays, periodGoalsOverlappingMonth, periodGoalsOnDate } from "./queries.ts";
export { PALETTE, COLOR_IDS } from "./palette.ts";
export { todayLocalIso, yearOf, mondayOnOrBefore, mondaysInYear, daysInMonth } from "./dates.ts";
export { findYear, liveYears } from "./years.ts";
export { resolveWeek } from "./weeks.ts";
```

Do **not** re-export map `Result` from `public.ts` or `index.ts` (clashes with vault-core `Result`).

```ts
// packages/vault-core/src/types.ts  — add to VaultSnapshot
map: import("./map/types.ts").StoreState | null;
mapError: string | null;
```

```ts
// packages/vault-core/src/map/persist.ts  — vault Result (error: string)
export async function ensureMapOnOpen(
  rootPath: string,
  today: string,
): Promise<import("../types.ts").Result<import("./types.ts").StoreState>>;

export async function applyMapCommand(
  rootPath: string,
  command: import("./types.ts").Command,
  actor: import("./types.ts").Actor,
  today: string,
): Promise<import("../types.ts").Result<import("./types.ts").StoreState>>;
```

On Map domain failure, persist maps `error.code` + `error.message` to the string `${code}: ${message}` (example: `LOCKED: locked, read-only`).

```ts
// packages/vault-core/src/unlock.ts
export type UnlockDoc = { kind: DocumentKind; bodyMarkdown: string };
export type UnlockDomain = {
  archivedAt: string | null;
  documents: UnlockDoc[];
};
export function getUnlockedRooms(domains: UnlockDomain[]): Set<RoomId>;
export function isRoomUnlocked(room: RoomId, domains: UnlockDomain[]): boolean;
export function canDispatchAgent(docs: UnlockDoc[]): boolean;
```

```ts
// IPC
mapGetState: () => Promise<Result<StoreState>>;
mapApply: (command: Command) => Promise<Result<StoreState>>;
// Task 8
hermesChatTools: (messages: { role: string; content: string }[]) => Promise<Result<{ content: string }>>;
```

`mapGetState` / `mapApply` fail with `"No vault is open"` or `"Map store unreadable: …"` when `snapshot.map` is null.

---

### Task 1: Port Life Map domain into vault-core

**Files:**
- Create: `packages/vault-core/src/map/*` (copied domain modules listed below)
- Create: `packages/vault-core/src/map/public.ts`
- Create: `packages/vault-core/tests/map/*.test.ts`
- Modify: `packages/vault-core/package.json` (export `./map`; test script)
- Modify: `packages/vault-core/src/index.ts`

**Interfaces:**
- Consumes: Life Map domain at `C:\Users\karms\projects\Life-Map\src\domain\`
- Produces: `applyCommand`, `StoreState`, `Command`, `public.ts` aliases

- [ ] **Step 1: Point vault-core tests at the whole `tests/` tree**

In `packages/vault-core/package.json` set:

```json
"exports": {
  ".": "./src/index.ts",
  "./pure": "./src/pure.ts",
  "./map": "./src/map/public.ts"
},
"scripts": {
  "test": "node --experimental-strip-types --test tests/"
}
```

- [ ] **Step 2: Convert Life Map domain tests (they must fail — sources missing)**

Create `packages/vault-core/tests/map/`. For each Life Map test file, copy and convert:

| From `C:\Users\karms\projects\Life-Map\src\domain\` | To `packages/vault-core/tests/map/` |
|---|---|
| `dates.test.ts` | `dates.test.ts` |
| `palette.test.ts` | `palette.test.ts` |
| `lock.test.ts` | `lock.test.ts` |
| `years.test.ts` | `years.test.ts` |
| `period-goals.test.ts` | `period-goals.test.ts` |
| `months.test.ts` | `months.test.ts` |
| `day-types.test.ts` | `day-types.test.ts` |
| `weeks.test.ts` | `weeks.test.ts` |
| `tasks.test.ts` | `tasks.test.ts` |
| `queries.test.ts` | `queries.test.ts` |
| `archive-resolve.test.ts` | `archive-resolve.test.ts` |

Conversion recipe (apply to every file):

1. Replace `import { describe, expect, it } from "vitest"` (and any `beforeEach`) with:

```ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
```

2. Rewrite imports from `./foo` to `../../src/map/foo.ts` (keep the `.ts` extension, matching other vault-core tests).
3. Replace assertions:

| Vitest | node:assert |
|--------|-------------|
| `expect(x).toBe(y)` | `assert.equal(x, y)` |
| `expect(x).toEqual(y)` | `assert.deepEqual(x, y)` |
| `expect(x).toBeTruthy()` | `assert.ok(x)` |
| `expect(x).toBeFalsy()` | `assert.equal(Boolean(x), false)` |
| `expect(x).toBeNull()` | `assert.equal(x, null)` |
| `expect(fn).toThrow(/re/)` | `assert.throws(fn, /re/)` |
| `expect(arr).toHaveLength(n)` | `assert.equal(arr.length, n)` |
| `expect(x).toContain(y)` | `assert.ok(x.includes(y))` |

Do not copy test files into `src/map/`.

- [ ] **Step 3: Run tests — expect missing module**

Run:

```
npm test -w @lifequest/vault-core
```

Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../../src/map/dates.ts` (or the first converted import).

- [ ] **Step 4: Copy domain sources (no test files)**

PowerShell from repo root:

```
New-Item -ItemType Directory -Force packages/vault-core/src/map | Out-Null
Copy-Item C:\Users\karms\projects\Life-Map\src\domain\about.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\commands.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\dates.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\day-types.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\default-week.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\empty.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\errors.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\lock.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\months.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\palette.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\period-goals.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\queries.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\tasks.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\types.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\weeks.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\writable.ts,`
  C:\Users\karms\projects\Life-Map\src\domain\years.ts `
  packages/vault-core/src/map/
```

If any copied file uses extensionless relative imports (`from "./dates"`), change them to `from "./dates.ts"` so Node `--experimental-strip-types` matches the rest of vault-core.

- [ ] **Step 5: Add `public.ts`**

Create `packages/vault-core/src/map/public.ts` with the frozen export list above. Do not export map `Result`, `fail`, or `ok`.

- [ ] **Step 6: Export map from vault-core index (Node entry)**

Append to `packages/vault-core/src/index.ts`:

```ts
export {
  applyMapCommandPure,
  dashboardDays,
  periodGoalsOverlappingMonth,
  periodGoalsOnDate,
  PALETTE,
  COLOR_IDS,
  todayLocalIso,
  yearOf,
  mondayOnOrBefore,
  mondaysInYear,
  daysInMonth,
  findYear,
  liveYears,
  resolveWeek,
} from "./map/public.ts";
export type {
  MapStoreState,
  MapCommand,
  MapActor,
  MapDomainError,
  YearRecord,
  PeriodGoal,
  Task,
  TaskColumn,
  ColorId,
  DayType,
  DetachedWeek,
  ResolvedWeek,
} from "./map/public.ts";
```

Do not `export * from "./map/types.ts"`.

- [ ] **Step 7: Run tests — expect domain tests pass**

```
npm test -w @lifequest/vault-core
```

Expected: PASS (existing unlock/create-vault tests still pass; new map tests pass). If a Life Map test imported Vitest-only APIs, convert them; do not change domain rules to make a test pass.

- [ ] **Step 8: Commit**

```
git add packages/vault-core
git commit -m "feat(vault-core): port Life Map domain into src/map"
```

---

### Task 2: Persist map.json + about.md; seed; rollover; snapshot

**Files:**
- Create: `packages/vault-core/src/map/persist.ts`
- Create: `packages/vault-core/src/map/log-event.ts`
- Create: `packages/vault-core/tests/map-persist.test.ts`
- Modify: `packages/vault-core/src/paths.ts`
- Modify: `packages/vault-core/src/types.ts`
- Modify: `packages/vault-core/src/create-vault.ts`
- Modify: `packages/vault-core/src/open-vault.ts`
- Modify: `packages/vault-core/src/index.ts`
- Modify: `packages/vault-core/tests/create-vault.test.ts`

**Interfaces:**
- Consumes: `applyCommand`, `emptyState`, `ensureCurrentYear`, `rollover` from Task 1; `atomicWriteFile`, `appendLog`, `vaultPaths`
- Produces: `ensureMapOnOpen`, `applyMapCommand`, `VaultSnapshot.map`, `VaultSnapshot.mapError`

- [ ] **Step 1: Write failing persist tests**

Create `packages/vault-core/tests/map-persist.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVault } from "../src/create-vault.ts";
import { openVault } from "../src/open-vault.ts";
import { applyMapCommand } from "../src/map/persist.ts";
import { vaultPaths } from "../src/paths.ts";

describe("map persist", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lq-map-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("createVault writes map.json without aboutMe and empty about.md", async () => {
    const root = path.join(dir, "seeded");
    const res = await createVault(root, "Personal");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.map);
    assert.equal(res.value.mapError, null);
    assert.equal(res.value.map?.locked, false);
    assert.ok(res.value.map?.years.some((y) => y.status === "live"));
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).mapJson, "utf8")) as {
      aboutMe?: unknown;
    };
    assert.equal("aboutMe" in raw, false);
    const about = await fs.readFile(vaultPaths(root).aboutMd, "utf8");
    assert.equal(about, "");
  });

  it("openVault seeds missing map files on an existing vault", async () => {
    const root = path.join(dir, "late-seed");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    await fs.unlink(vaultPaths(root).mapJson);
    await fs.unlink(vaultPaths(root).aboutMd);
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.ok(opened.value.map);
    await fs.access(vaultPaths(root).mapJson);
    await fs.access(vaultPaths(root).aboutMd);
  });

  it("malformed map.json does not get overwritten", async () => {
    const root = path.join(dir, "bad-map");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    await fs.writeFile(p, "{not-json", "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.value.map, null);
    assert.ok(opened.value.mapError);
    const still = await fs.readFile(p, "utf8");
    assert.equal(still, "{not-json");
  });

  it("applyMapCommand setAboutMe writes about.md not map.json aboutMe", async () => {
    const root = path.join(dir, "about");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const applied = await applyMapCommand(
      root,
      { type: "setAboutMe", text: "early nights" },
      "user",
      "2026-08-27",
    );
    assert.equal(applied.ok, true);
    const about = await fs.readFile(vaultPaths(root).aboutMd, "utf8");
    assert.equal(about, "early nights");
    const raw = JSON.parse(await fs.readFile(vaultPaths(root).mapJson, "utf8")) as {
      aboutMe?: unknown;
    };
    assert.equal("aboutMe" in raw, false);
  });

  it("agent setLock is refused; user setLock persists", async () => {
    const root = path.join(dir, "lock");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const agent = await applyMapCommand(
      root,
      { type: "setLock", locked: true },
      "agent",
      "2026-08-27",
    );
    assert.equal(agent.ok, false);
    if (agent.ok) return;
    assert.match(agent.error, /AGENT_CANNOT_LOCK/);
    const user = await applyMapCommand(
      root,
      { type: "setLock", locked: true },
      "user",
      "2026-08-27",
    );
    assert.equal(user.ok, true);
    if (!user.ok) return;
    assert.equal(user.value.locked, true);
  });
});
```

- [ ] **Step 2: Run persist tests — expect fail**

```
npm test -w @lifequest/vault-core
```

Expected: FAIL (`ensureMapOnOpen` / `applyMapCommand` / `mapJson` not found, or snapshot missing `map`).

- [ ] **Step 3: Extend paths**

In `packages/vault-core/src/paths.ts` `vaultPaths`, add:

```ts
mapJson: path.join(rootPath, ".lifequest", "map.json"),
aboutMd: path.join(rootPath, ".lifequest", "about.md"),
```

- [ ] **Step 4: Extend VaultSnapshot**

In `packages/vault-core/src/types.ts`:

```ts
import type { StoreState as MapStoreState } from "./map/types.ts";

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
};
```

If a circular import appears, use a type-only import (`import type`) as above — `types.ts` must not import persist.

- [ ] **Step 5: Implement log-event + persist**

Create `packages/vault-core/src/map/log-event.ts`:

```ts
import type { Command } from "./types.ts";

export function mapLogEvent(command: Command): {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
} {
  switch (command.type) {
    case "setLock":
      return {
        type: "map.lock.set",
        summary: command.locked ? "Agents locked" : "Agents unlocked",
        payload: { locked: command.locked },
      };
    case "setAboutMe":
      return { type: "map.about.updated", summary: "Updated About me", payload: {} };
    case "createYear":
      return {
        type: "map.year.created",
        summary: `Created year ${command.year}`,
        payload: { year: command.year },
      };
    case "deleteYear":
      return {
        type: "map.year.deleted",
        summary: `Deleted year ${command.year}`,
        payload: { year: command.year },
      };
    case "createPeriodGoal":
      return {
        type: "map.period_goal.created",
        summary: `Created period goal ${command.name}`,
        payload: { year: command.year, name: command.name },
      };
    case "updatePeriodGoal":
      return {
        type: "map.period_goal.updated",
        summary: "Updated period goal",
        payload: { year: command.year, id: command.id },
      };
    case "deletePeriodGoal":
      return {
        type: "map.period_goal.deleted",
        summary: "Deleted period goal",
        payload: { year: command.year, id: command.id },
      };
    case "setMonthDay":
    case "setMonthObjectives":
    case "setMonthNotes":
      return {
        type: "map.month.updated",
        summary: `Updated month ${command.month} ${command.year}`,
        payload: { year: command.year, month: command.month },
      };
    case "createTask":
      return {
        type: "map.task.created",
        summary: `Created task ${command.title}`,
        payload: { title: command.title },
      };
    case "updateTask":
      return {
        type: "map.task.updated",
        summary: "Updated task",
        payload: { id: command.id },
      };
    case "deleteTask":
      return {
        type: "map.task.deleted",
        summary: "Deleted task",
        payload: { id: command.id },
      };
    default:
      return {
        type: `map.${command.type}`,
        summary: command.type,
        payload: {},
      };
  }
}
```

Create `packages/vault-core/src/map/persist.ts`:

```ts
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../atomic-write.ts";
import { appendLog } from "../log.ts";
import { vaultPaths } from "../paths.ts";
import type { Result } from "../types.ts";
import { applyCommand } from "./commands.ts";
import { emptyState } from "./empty.ts";
import { mapLogEvent } from "./log-event.ts";
import { todayLocalIso } from "./dates.ts";
import type { Actor, Command, StoreState } from "./types.ts";
import { ensureCurrentYear, rollover } from "./years.ts";

type MapFile = Omit<StoreState, "aboutMe">;

function toFile(state: StoreState): MapFile {
  return {
    locked: state.locked,
    dayTypes: state.dayTypes,
    defaultWeek: state.defaultWeek,
    years: state.years,
    tasks: state.tasks,
  };
}

function fromFile(file: MapFile, aboutMe: string): StoreState {
  return { ...file, aboutMe };
}

function isMapFile(value: unknown): value is MapFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<MapFile>;
  return (
    typeof v.locked === "boolean" &&
    Array.isArray(v.dayTypes) &&
    !!v.defaultWeek &&
    Array.isArray(v.years) &&
    Array.isArray(v.tasks)
  );
}

export async function readAboutMe(rootPath: string): Promise<string> {
  try {
    return await fs.readFile(vaultPaths(rootPath).aboutMd, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

export async function writeMapState(
  rootPath: string,
  state: StoreState,
): Promise<Result<true>> {
  try {
    const paths = vaultPaths(rootPath);
    await fs.mkdir(paths.lifequestDir, { recursive: true });
    await atomicWriteFile(paths.mapJson, `${JSON.stringify(toFile(state), null, 2)}\n`);
    await atomicWriteFile(paths.aboutMd, state.aboutMe);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadMapState(rootPath: string): Promise<
  Result<StoreState> | { ok: false; error: string; malformed: true }
> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.mapJson, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Map store is not valid JSON", malformed: true };
    }
    if (!isMapFile(parsed)) {
      return { ok: false, error: "Map store has invalid shape", malformed: true };
    }
    const aboutMe = await readAboutMe(rootPath);
    return { ok: true, value: fromFile(parsed, aboutMe) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "ENOENT" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ensureMapOnOpen(
  rootPath: string,
  today: string = todayLocalIso(),
): Promise<Result<StoreState>> {
  const loaded = await loadMapState(rootPath);
  if (loaded.ok) {
    const next = ensureCurrentYear(rollover(loaded.value, today), today);
    const persistNeeded =
      JSON.stringify(toFile(next)) !== JSON.stringify(toFile(loaded.value));
    if (persistNeeded) {
      const saved = await writeMapState(rootPath, next);
      if (!saved.ok) return saved;
    }
    return { ok: true, value: next };
  }
  if ("malformed" in loaded && loaded.malformed) {
    return { ok: false, error: loaded.error };
  }
  const seeded = ensureCurrentYear(rollover(emptyState(), today), today);
  const saved = await writeMapState(rootPath, seeded);
  if (!saved.ok) return saved;
  return { ok: true, value: seeded };
}

export async function applyMapCommand(
  rootPath: string,
  command: Command,
  actor: Actor,
  today: string = todayLocalIso(),
): Promise<Result<StoreState>> {
  const ensured = await ensureMapOnOpen(rootPath, today);
  if (!ensured.ok) return ensured;
  const result = applyCommand(ensured.value, command, {
    actor,
    today,
    id: () => randomUUID(),
  });
  if (!result.ok) {
    return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  }
  const saved = await writeMapState(rootPath, result.value);
  if (!saved.ok) return saved;
  const ev = mapLogEvent(command);
  const logRes = await appendLog(rootPath, {
    domainSlug: null,
    type: ev.type,
    summary: ev.summary,
    payload: ev.payload,
  });
  if (!logRes.ok) return logRes;
  return { ok: true, value: result.value };
}
```

If `appendLog` after a successful map write fails, still return the new state (map already persisted). Prefer: if you can write map+about first, then log; do not roll back map.json on log failure. Tests above do not assert log failure.

- [ ] **Step 6: Wire createVault + openVault**

`create-vault.ts`: after `agents.json` / `log.jsonl`, you may skip explicit map writes and let `openVault` → `ensureMapOnOpen` seed. That satisfies “create writes map files” as long as `createVault` returns `openVault` (it already does). Keep that: **do not duplicate seed in createVault** if `openVault` always calls `ensureMapOnOpen`.

`open-vault.ts` after domains are loaded:

```ts
let map: VaultSnapshot["map"] = null;
let mapError: string | null = null;
const mapRes = await ensureMapOnOpen(paths.root);
if (mapRes.ok) {
  map = mapRes.value;
} else {
  mapError = mapRes.error;
}

return {
  ok: true,
  value: {
    rootPath: paths.root,
    lifequest,
    settings,
    domains,
    agents,
    decisions,
    log: logRes.value,
    map,
    mapError,
  },
};
```

Re-read log **after** `ensureMapOnOpen` if seed/rollover appended nothing (it does not append on seed). Existing `readLog` before map load is fine.

- [ ] **Step 7: Export persist from index.ts**

```ts
export { applyMapCommand, ensureMapOnOpen, loadMapState } from "./map/persist.ts";
```

- [ ] **Step 8: Extend create-vault tests**

In the existing “seeds four domains” test, after success:

```ts
assert.ok(res.value.map);
assert.equal(res.value.mapError, null);
await fs.access(path.join(root, ".lifequest/map.json"));
await fs.access(path.join(root, ".lifequest/about.md"));
```

- [ ] **Step 9: Run tests — expect pass**

```
npm test -w @lifequest/vault-core
```

Expected: PASS.

- [ ] **Step 10: Commit**

```
git add packages/vault-core
git commit -m "feat(vault-core): persist Life Map state as map.json and about.md"
```

---

### Task 3: Vault-wide room unlock + canDispatchAgent

**Files:**
- Modify: `packages/vault-core/src/unlock.ts`
- Modify: `packages/vault-core/tests/unlock.test.ts`
- Modify: `apps/desktop/src/components/shell/useActiveDomain.ts`
- Modify: `apps/desktop/src/components/shell/RoomLockGate.tsx`
- Modify: `apps/desktop/src/components/shell/nav-items.ts`
- Modify: `apps/desktop/src/components/shell/NavRail.tsx` (lock title copy if it still says “fill prior pillar”)

**Interfaces:**
- Consumes: `UnlockDomain` frozen signature
- Produces: new `getUnlockedRooms(domains)`, `canDispatchAgent(docs)`

- [ ] **Step 1: Rewrite unlock tests to the new signature (they will fail)**

Replace `packages/vault-core/tests/unlock.test.ts` with:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canDispatchAgent,
  getUnlockedRooms,
  isNonEmptyBody,
  isRoomUnlocked,
  type UnlockDomain,
} from "../src/unlock.ts";

const whyLive = (body: string): UnlockDomain => ({
  archivedAt: null,
  documents: [{ kind: "why", bodyMarkdown: body }],
});

describe("isNonEmptyBody", () => {
  it("rejects empty and whitespace", () => {
    assert.equal(isNonEmptyBody(""), false);
    assert.equal(isNonEmptyBody("  \n\t"), false);
  });
  it("accepts content", () => {
    assert.equal(isNonEmptyBody("growth"), true);
  });
});

describe("getUnlockedRooms", () => {
  it("unlocks only dream when no live Why exists", () => {
    const rooms = getUnlockedRooms([]);
    assert.ok(rooms.has("dream"));
    assert.equal(rooms.has("chart"), false);
    assert.equal(rooms.has("track"), false);
    assert.equal(rooms.has("act"), false);
  });

  it("unlocks chart, track, and act when any live Why has a body", () => {
    const rooms = getUnlockedRooms([whyLive("reason")]);
    assert.deepEqual([...rooms].sort(), ["act", "chart", "dream", "track"]);
  });

  it("ignores archived domains with a Why", () => {
    const rooms = getUnlockedRooms([
      {
        archivedAt: "2026-01-01T00:00:00.000Z",
        documents: [{ kind: "why", bodyMarkdown: "old" }],
      },
    ]);
    assert.equal(rooms.has("chart"), false);
  });

  it("does not require What or How to unlock operational rooms", () => {
    const rooms = getUnlockedRooms([whyLive("w")]);
    assert.ok(rooms.has("track"));
    assert.ok(rooms.has("act"));
  });
});

describe("canDispatchAgent", () => {
  it("is false until How has a body", () => {
    assert.equal(canDispatchAgent([{ kind: "how", bodyMarkdown: "" }]), false);
    assert.equal(canDispatchAgent([{ kind: "how", bodyMarkdown: "habit" }]), true);
  });
});

describe("isRoomUnlocked", () => {
  it("uses the domain list, not a single doc array", () => {
    assert.equal(isRoomUnlocked("chart", [whyLive("x")]), true);
    assert.equal(isRoomUnlocked("chart", [whyLive("  ")]), false);
  });
});
```

- [ ] **Step 2: Run unlock tests — expect fail**

```
npm test -w @lifequest/vault-core
```

Expected: FAIL (signature still takes `UnlockDoc[]`).

- [ ] **Step 3: Implement unlock.ts**

Replace `packages/vault-core/src/unlock.ts` with:

```ts
import type { DocumentKind, RoomId } from "./types.ts";

export type UnlockDoc = { kind: DocumentKind; bodyMarkdown: string };

export type UnlockDomain = {
  archivedAt: string | null;
  documents: UnlockDoc[];
};

export function isNonEmptyBody(body: string): boolean {
  return body.trim().length > 0;
}

function bodyOf(docs: UnlockDoc[], kind: DocumentKind): string {
  return docs.find((d) => d.kind === kind)?.bodyMarkdown ?? "";
}

export function getUnlockedRooms(domains: UnlockDomain[]): Set<RoomId> {
  const rooms = new Set<RoomId>(["dream"]);
  const hasLiveWhy = domains.some(
    (d) => !d.archivedAt && isNonEmptyBody(bodyOf(d.documents, "why")),
  );
  if (hasLiveWhy) {
    rooms.add("chart");
    rooms.add("track");
    rooms.add("act");
  }
  return rooms;
}

export function isRoomUnlocked(room: RoomId, domains: UnlockDomain[]): boolean {
  return getUnlockedRooms(domains).has(room);
}

export function canDispatchAgent(docs: UnlockDoc[]): boolean {
  return isNonEmptyBody(bodyOf(docs, "how"));
}
```

`pure.ts` already re-exports `./unlock.ts` — no change required besides the new types/functions.

- [ ] **Step 4: Update desktop callers**

`useActiveDomain.ts` — change `useUnlockedRooms`:

```ts
export function useUnlockedRooms(): Set<import("@lifequest/vault-core/pure").RoomId> {
  const { snapshot } = useVault();
  return useMemo(() => {
    const domains = (snapshot?.domains ?? []).map((d) => ({
      archivedAt: d.meta.archivedAt,
      documents: documentsToUnlockDocs(d.documents),
    }));
    return getUnlockedRooms(domains);
  }, [snapshot]);
}

export function useUnlockDomains() {
  const { snapshot } = useVault();
  return useMemo(
    () =>
      (snapshot?.domains ?? []).map((d) => ({
        archivedAt: d.meta.archivedAt,
        documents: documentsToUnlockDocs(d.documents),
      })),
    [snapshot],
  );
}
```

Import `getUnlockedRooms` from `@lifequest/vault-core/pure`.

`RoomLockGate.tsx`:

```ts
import { isRoomUnlocked, type RoomId } from "@lifequest/vault-core/pure";
import { useUnlockDomains } from "./useActiveDomain";

const ROOM_LABELS: Record<RoomId, string> = {
  dream: "Dream",
  chart: "Life Map",
  track: "Architecture",
  act: "Act",
};

const UNLOCK_HINTS: Record<RoomId, string> = {
  dream: "Dream is always open.",
  chart: "Save a non-empty Why in any domain to unlock Life Map.",
  track: "Save a non-empty Why in any domain to unlock Architecture.",
  act: "Save a non-empty Why in any domain to unlock Act.",
};

export function RoomLockGate({ room, children }: { room: RoomId; children: ReactNode }) {
  const domains = useUnlockDomains();
  const unlocked = isRoomUnlocked(room, domains);
  // …existing lock UI, keep active-domain line as context only
}
```

`nav-items.ts`: chart label `"Life Map"`, track label `"Architecture"`. Keep `href: "/chart"` and `"/track"`, `room: "chart"` / `"track"`.

NavRail lock title: `` `${item.label} (locked — write a Why in any domain)` `` for rooms other than dream.

- [ ] **Step 5: Run vault-core tests**

```
npm test -w @lifequest/vault-core
```

Expected: PASS.

- [ ] **Step 6: Typecheck desktop**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS (fix any leftover `getUnlockedRooms(docs)` calls).

- [ ] **Step 7: Commit**

```
git add packages/vault-core/src/unlock.ts packages/vault-core/tests/unlock.test.ts apps/desktop/src/components/shell
git commit -m "feat: unlock Life Map, Architecture, and Act from any live Why"
```

---

### Task 4: IPC mapApply + agent lock in TopBar

**Files:**
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/src/components/shell/TopBar.tsx`
- Modify: `apps/desktop/electron/vault-service.ts` `captureDoctrineMtimes` (also watch map.json + about.md)

**Interfaces:**
- Consumes: `applyMapCommand`, `StoreState` from Task 2
- Produces: `window.lifequest.mapApply`, `mapGetState`; TopBar lock switch

- [ ] **Step 1: Add vault-service helpers**

In `vault-service.ts`:

```ts
import {
  applyMapCommand,
  type MapActor,
  type MapCommand,
  type MapStoreState,
} from "@lifequest/vault-core";

export async function mapGetState(): Promise<Result<MapStoreState>> {
  return withVault(async (root) => {
    const snap = await openVault(root);
    if (!snap.ok) return snap;
    if (!snap.value.map) {
      return { ok: false, error: snap.value.mapError ?? "Map store unreadable" };
    }
    return { ok: true, value: snap.value.map };
  });
}

export async function mapApply(
  command: MapCommand,
  actor: MapActor = "user",
): Promise<Result<VaultSnapshot>> {
  return withVault(async (root) => {
    const applied = await applyMapCommand(root, command, actor);
    if (!applied.ok) return applied;
    return openVault(root);
  });
}
```

Renderer always calls `mapApply(command)` with default `actor: "user"`. Chat/MCP (later) call `applyMapCommand` in main with `"agent"` and then `openVault` / push snapshot if needed.

Extend `captureDoctrineMtimes` to also `stat` `paths.mapJson` and `paths.aboutMd` when present so the existing focus reload prompt covers Map files.

- [ ] **Step 2: Register IPC**

`main.ts` inside `registerIpcHandlers`:

```ts
ipcMain.handle("map:getState", () => vault.mapGetState());
ipcMain.handle("map:apply", (_e, command: Parameters<typeof vault.mapApply>[0]) =>
  vault.mapApply(command, "user"),
);
```

`preload.ts`:

```ts
mapGetState: () =>
  ipcRenderer.invoke("map:getState") as Promise<Result<unknown>>,
mapApply: (command: unknown) =>
  ipcRenderer.invoke("map:apply", command) as Promise<Result<unknown>>,
```

`vite-env.d.ts` — import `MapCommand`, `MapStoreState` from `@lifequest/vault-core` and add:

```ts
mapGetState: () => Promise<Result<MapStoreState>>;
mapApply: (command: MapCommand) => Promise<Result<VaultSnapshot>>;
```

- [ ] **Step 3: Agent lock switch on TopBar**

`TopBar.tsx`:

```tsx
import { api } from "@/lib/ipc";

export function TopBar() {
  const { snapshot, refresh, busy } = useVault();
  const locked = snapshot?.map?.locked ?? false;
  const mapReady = Boolean(snapshot?.map);

  async function onLock(next: boolean) {
    const result = await api().mapApply({ type: "setLock", locked: next });
    if (!result.ok) return;
    await refresh();
  }

  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <span className="top-bar__vault-name">
          {snapshot?.lifequest.name ?? "LifeQuest"}
        </span>
      </div>
      <div className="top-bar__controls">
        <DomainSwitcher />
        <label className="lock-switch">
          <span className="lock-label">Agent locked</span>
          <input
            type="checkbox"
            role="switch"
            checked={locked}
            disabled={!mapReady || busy}
            onChange={(e) => void onLock(e.target.checked)}
          />
        </label>
      </div>
    </header>
  );
}
```

Reuse existing switch styles if any (Life Map used `.lock-switch`). Add a compact version in `apps/desktop/src/styles/global.css` using current tokens (`--fg`, `--muted`, `--border`):

```css
.lock-switch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.lock-label { color: var(--muted); }
```

If `snapshot.map` is null and `mapError` is set, do not crash TopBar; leave the switch disabled.

- [ ] **Step 4: Typecheck**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/electron apps/desktop/src/vite-env.d.ts apps/desktop/src/components/shell/TopBar.tsx apps/desktop/src/styles/global.css
git commit -m "feat(desktop): Map IPC and agent lock in the top bar"
```

---

### Task 5: Life Map page on `/chart`

**Files:**
- Create: `apps/desktop/src/state/MapYearProvider.tsx`
- Create: `apps/desktop/src/pages/ChartPage.tsx`
- Create: `apps/desktop/src/components/doctrine/DoctrineStrip.tsx`
- Create: `apps/desktop/src/components/map/` (ported files)
- Create: `apps/desktop/src/styles/map.css`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/global.css` (import map.css)
- Modify: `apps/desktop/src/components/shell/AppShell.tsx` (wrap MapYearProvider)

**Interfaces:**
- Consumes: `snapshot.map`, `mapApply`, queries from `@lifequest/vault-core/map`
- Produces: Chart page with dashboard, month, North Star strip, year chrome

- [ ] **Step 1: MapYearProvider**

Create `apps/desktop/src/state/MapYearProvider.tsx`:

```tsx
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { findYear, todayLocalIso, yearOf } from "@lifequest/vault-core/map";
import { useVault } from "./VaultProvider";

type MapYearContextValue = {
  yearNum: number | null;
  month: number | null;
  setYearNum: (y: number) => void;
  setMonth: (m: number | null) => void;
};

const MapYearContext = createContext<MapYearContextValue | null>(null);

export function MapYearProvider({ children }: { children: ReactNode }) {
  const { snapshot } = useVault();
  const map = snapshot?.map ?? null;
  const [yearNum, setYearNumState] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);

  const resolvedYear = useMemo(() => {
    if (!map) return null;
    const todayYear = yearOf(todayLocalIso());
    if (yearNum != null && findYear(map, yearNum)) return yearNum;
    if (findYear(map, todayYear)) return todayYear;
    const live = map.years.filter((y) => y.status === "live").sort((a, b) => a.year - b.year);
    return live[0]?.year ?? map.years[0]?.year ?? todayYear;
  }, [map, yearNum]);

  function setYearNum(y: number) {
    setYearNumState(y);
    setMonth(null);
  }

  return (
    <MapYearContext.Provider
      value={{ yearNum: resolvedYear, month, setYearNum, setMonth }}
    >
      {children}
    </MapYearContext.Provider>
  );
}

export function useMapYear(): MapYearContextValue {
  const ctx = useContext(MapYearContext);
  if (!ctx) throw new Error("useMapYear requires MapYearProvider");
  return ctx;
}
```

Wrap with `AppShell` (inside vault shell, not Welcome):

```tsx
<MapYearProvider>
  <NavRail />
  …
</MapYearProvider>
```

- [ ] **Step 2: DoctrineStrip**

Create `apps/desktop/src/components/doctrine/DoctrineStrip.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { DocumentKind } from "@lifequest/vault-core/pure";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

export function DoctrineStrip({ kind }: { kind: DocumentKind }) {
  const domain = useActiveDomain();
  const doc = domain?.documents[kind];
  const label = kind === "what" ? "North Star" : "How";
  const body = doc?.bodyMarkdown.trim() ?? "";
  const preview = body ? body.slice(0, 180) : `No ${kind} yet.`;

  return (
    <aside className="doctrine-strip">
      <div className="doctrine-strip__head">
        <span className="doctrine-strip__label">
          {label}
          {domain ? ` · ${domain.meta.name}` : ""}
        </span>
        <DocumentStatusBadge status={doc?.status ?? "draft"} />
        <Link to="/documents" className="doctrine-strip__edit">
          Edit in Documents
        </Link>
      </div>
      <p className="doctrine-strip__preview muted">{preview}</p>
    </aside>
  );
}
```

Add `.doctrine-strip` layout CSS in `map.css` (border, padding, using existing tokens).

- [ ] **Step 3: Port Map UI files**

Copy from `C:\Users\karms\projects\Life-Map\src\map\`:

- `Dashboard.tsx`, `KeyPanel.tsx`, `MonthPage.tsx`, `paintRange.ts`, `monthGrid.ts`
- tests `paintRange.test.ts`, `monthGrid.test.ts` only if you place them under vault-core; **do not** add Vitest to desktop. Skip those tests in desktop; `paintRange` / `monthGrid` stay as copied TS modules next to the components.

Change imports:

- `../domain/dates` → `@lifequest/vault-core/map`
- `../domain/palette` → `@lifequest/vault-core/map`
- `../domain/queries` → `@lifequest/vault-core/map`
- `../domain/types` → `@lifequest/vault-core/map` (`Command` → `MapCommand`, `YearRecord` stays)

Keep component props `{ year, onSelectMonth, onCommand }` and `{ year, month, onBack, onCommand }`.

Copy matching CSS from `C:\Users\karms\projects\Life-Map\src\styles.css` for dashboard/key/month into `apps/desktop/src/styles/map.css`, wrapping rules under `.life-map` where possible. Import `map.css` from `global.css`.

- [ ] **Step 4: ChartPage + year chrome**

Create `apps/desktop/src/pages/ChartPage.tsx`:

```tsx
import { Dashboard } from "@/components/map/Dashboard";
import { MonthPage } from "@/components/map/MonthPage";
import { DoctrineStrip } from "@/components/doctrine/DoctrineStrip";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useVault } from "@/state/VaultProvider";
import { useMapYear } from "@/state/MapYearProvider";
import { api } from "@/lib/ipc";
import { findYear, liveYears, todayLocalIso, yearOf, type MapCommand } from "@lifequest/vault-core/map";

export default function ChartPage() {
  return (
    <RoomLockGate room="chart">
      <ChartContent />
    </RoomLockGate>
  );
}

function ChartContent() {
  const { snapshot, refresh } = useVault();
  const { yearNum, month, setYearNum, setMonth } = useMapYear();
  const map = snapshot?.map ?? null;

  async function onCommand(command: MapCommand) {
    const result = await api().mapApply(command);
    if (result.ok) await refresh();
  }

  if (snapshot?.mapError && !map) {
    return <p className="form-error" role="alert">{snapshot.mapError}</p>;
  }
  if (!map || yearNum == null) return <p className="muted">Loading map…</p>;

  const selected = findYear(map, yearNum);
  const todayYear = yearOf(todayLocalIso());
  const live = liveYears(map);
  const addYear =
    live.length >= 3
      ? null
      : [todayYear, todayYear + 1, todayYear + 2].find((y) => !findYear(map, y)) ??
        null;

  return (
    <div className="life-map">
      <header className="life-map__chrome">
        <h1>Life Map</h1>
        <label>
          Year
          <select
            value={yearNum}
            onChange={(e) => setYearNum(Number(e.target.value))}
          >
            {map.years
              .slice()
              .sort((a, b) =>
                a.status === b.status
                  ? a.status === "live"
                    ? a.year - b.year
                    : b.year - a.year
                  : a.status === "live"
                    ? -1
                    : 1,
              )
              .map((y) => (
                <option key={y.year} value={y.year}>
                  {y.status === "archive" ? `${y.year} (archive)` : String(y.year)}
                </option>
              ))}
          </select>
        </label>
        {selected?.status === "archive" && (
          <button type="button" onClick={() => void onCommand({ type: "deleteYear", year: selected.year })}>
            Delete archive
          </button>
        )}
        {selected?.status === "live" && selected.year !== todayYear && (
          <button type="button" onClick={() => void onCommand({ type: "deleteYear", year: selected.year })}>
            Delete year
          </button>
        )}
        {addYear != null && (
          <button type="button" onClick={() => void onCommand({ type: "createYear", year: addYear })}>
            Add {addYear}
          </button>
        )}
      </header>
      <DoctrineStrip kind="what" />
      {selected && month == null && (
        <Dashboard year={selected} onSelectMonth={setMonth} onCommand={onCommand} />
      )}
      {selected && month != null && (
        <MonthPage
          year={selected}
          month={month}
          onBack={() => setMonth(null)}
          onCommand={onCommand}
        />
      )}
    </div>
  );
}
```

Confirm delete of a future year **with content** using `window.confirm` as Life Map did (`yearHasContent` helper: periodGoals length, detached weeks, or any month text). Put that helper in ChartPage (copy the function from Life Map `App.tsx`).

`App.tsx`: `/chart` renders `<ChartPage />` instead of `<RoomPage room="chart" />`.

- [ ] **Step 5: Typecheck**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

- [ ] **Step 6: Manual check**

`npm run dev`. Open a vault, write a Why, open Life Map, paint a Key, open a month, type a cell. Confirm Documents still edits What. Confirm Home/Dream unchanged.

- [ ] **Step 7: Commit**

```
git add apps/desktop
git commit -m "feat(desktop): Life Map year canvas on the Chart route"
```

---

### Task 6: Architecture page on `/track`

**Files:**
- Create: `apps/desktop/src/pages/ArchitecturePage.tsx`
- Create: `apps/desktop/src/components/architecture/` from Life Map
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/map.css` (architecture rules)

**Interfaces:**
- Consumes: `useMapYear`, `mapApply`, `snapshot.map`
- Produces: Architecture page; shared year with Life Map; How strip; no add/delete year

- [ ] **Step 1: Port architecture components**

Copy `C:\Users\karms\projects\Life-Map\src\architecture\DayTypes.tsx`, `DefaultWeek.tsx`, `RealWeek.tsx`, `weekList.ts` into `apps/desktop/src/components/architecture/`.

Rewrite imports to `@lifequest/vault-core/map` and local `./weekList`. Props stay `{ state, year, onCommand }` as in Life Map (`state` is `MapStoreState`).

Copy architecture CSS from Life Map `styles.css` into `map.css` under `.architecture`.

- [ ] **Step 2: ArchitecturePage**

```tsx
import { DayTypes } from "@/components/architecture/DayTypes";
import { DefaultWeek } from "@/components/architecture/DefaultWeek";
import { RealWeek } from "@/components/architecture/RealWeek";
import { DoctrineStrip } from "@/components/doctrine/DoctrineStrip";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useVault } from "@/state/VaultProvider";
import { useMapYear } from "@/state/MapYearProvider";
import { api } from "@/lib/ipc";
import { findYear, type MapCommand } from "@lifequest/vault-core/map";

export default function ArchitecturePage() {
  return (
    <RoomLockGate room="track">
      <ArchitectureContent />
    </RoomLockGate>
  );
}

function ArchitectureContent() {
  const { snapshot, refresh } = useVault();
  const { yearNum, setYearNum } = useMapYear();
  const map = snapshot?.map ?? null;

  async function onCommand(command: MapCommand) {
    const result = await api().mapApply(command);
    if (result.ok) await refresh();
  }

  if (snapshot?.mapError && !map) {
    return <p className="form-error" role="alert">{snapshot.mapError}</p>;
  }
  if (!map || yearNum == null) return <p className="muted">Loading map…</p>;
  const selected = findYear(map, yearNum);

  return (
    <div className={selected?.status === "archive" ? "architecture is-archive" : "architecture"}>
      <header className="life-map__chrome">
        <h1>Architecture</h1>
        <label>
          Year
          <select value={yearNum} onChange={(e) => setYearNum(Number(e.target.value))}>
            {map.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.status === "archive" ? `${y.year} (archive)` : String(y.year)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {selected?.status === "archive" && <p className="archive-banner">Read-only archive</p>}
      <DoctrineStrip kind="how" />
      {selected && (
        <>
          <DayTypes state={map} year={selected} onCommand={onCommand} />
          <DefaultWeek state={map} year={selected} onCommand={onCommand} />
          <RealWeek state={map} year={selected} onCommand={onCommand} />
        </>
      )}
    </div>
  );
}
```

`App.tsx`: `/track` → `<ArchitecturePage />`.

- [ ] **Step 3: Typecheck + manual**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

Manual: set year  on Life Map, open Architecture — same year. Create a day type, assign default week, detach a week. No add/delete year on this page.

- [ ] **Step 4: Commit**

```
git add apps/desktop
git commit -m "feat(desktop): week Architecture on the Track route"
```

---

### Task 7: Act task board, Home cards, Settings About me

**Files:**
- Create: `apps/desktop/src/components/tasks/TaskBoard.tsx` (port)
- Create: `apps/desktop/src/components/tasks/groupTasks.ts` (port)
- Create: `apps/desktop/src/components/settings/SettingsAbout.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`
- Modify: `apps/desktop/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/lib/settings-views.ts`
- Modify: `apps/desktop/src/components/settings/SettingsContent.tsx`
- Modify: `apps/desktop/src/styles/map.css`

**Interfaces:**
- Consumes: `map.tasks`, `mapApply`, `canDispatchAgent`
- Produces: board on Act; Today/This week on Home; About me settings tab

- [ ] **Step 1: Port TaskBoard**

Copy `C:\Users\karms\projects\Life-Map\src\tasks\TaskBoard.tsx` and `groupTasks.ts` into `apps/desktop/src/components/tasks/`. Point types at `@lifequest/vault-core/map`. Copy task-board CSS into `map.css`.

- [ ] **Step 2: ActPage**

At the top of `ActContent` (inside `RoomLockGate room="act"`), render:

```tsx
{snapshot?.map ? (
  <TaskBoard state={snapshot.map} onCommand={(c) => void onMapCommand(c)} />
) : snapshot?.mapError ? (
  <p className="form-error" role="alert">{snapshot.mapError}</p>
) : null}
```

Keep the execution brief and run-agent block below.

Gate the Run button with `canDispatchAgent(documentsToUnlockDocs(activeDomain.documents))` **and** existing “no agents / running” checks. Import `canDispatchAgent` from `@lifequest/vault-core/pure`.

`onMapCommand`: `api().mapApply` then `refresh()`.

Do not add a year switcher on Act.

- [ ] **Step 3: Home Today / This week**

In `HomePage` grid, add a wide card:

```tsx
const todayTasks = (snapshot?.map?.tasks ?? []).filter((t) => t.column === "today");
const weekTasks = (snapshot?.map?.tasks ?? []).filter((t) => t.column === "this-week");
```

List titles, link “Open Act →” to `/act`. Empty copy: “No tasks today.” / “Nothing queued this week.” Do not render quarter grids.

- [ ] **Step 4: Settings About me**

`settings-views.ts`:

```ts
import { Building2, Palette, Sparkles, User } from "lucide-react";

export type SettingsViewId = "appearance" | "vault" | "hermes" | "about";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "vault", label: "Vault", icon: Building2 },
  { id: "hermes", label: "Hermes", icon: Sparkles },
  { id: "about", label: "About me", icon: User },
];
```

`SettingsAbout.tsx`: textarea bound to `snapshot.map?.aboutMe ?? ""`, Save calls `mapApply({ type: "setAboutMe", text })` then `refresh()`. Helper copy: “Agents treat this as lifestyle context. They cannot edit it while Agent locked is on.”

`SettingsContent` switch: `case "about": return <SettingsAbout />`.

- [ ] **Step 5: Typecheck + manual**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

Manual: create a task, move Today, see it on Home; edit About me; lock does not block user About edits.

- [ ] **Step 6: Commit**

```
git add apps/desktop
git commit -m "feat(desktop): task board, Home task cards, and About me"
```

---

### Task 8: Hermes tool loop + Act dispatch

**Files:**
- Create: `packages/vault-core/src/map/tools.ts`
- Create: `packages/vault-core/tests/map-tools.test.ts`
- Create: `apps/desktop/electron/map-tools.ts`
- Modify: `apps/desktop/electron/hermes-proxy.ts`
- Modify: `apps/desktop/electron/vault-service.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/src/components/hermes/ChatPanel.tsx`
- Modify: `apps/desktop/src/pages/ActPage.tsx`

**Interfaces:**
- Consumes: `applyMapCommand` with `actor: "agent"`; Hermes `/v1/chat/completions`
- Produces: `hermesChatTools`; chat and Act use it; `get_doctrine` read-only

- [ ] **Step 1: Failing tools test**

Create `packages/vault-core/src/map/tools.ts` after the test exists. First write `packages/vault-core/tests/map-tools.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandForTool } from "../src/map/tools.ts";

describe("commandForTool", () => {
  it("maps create_task", () => {
    const cmd = commandForTool("create_task", { title: "Run" });
    assert.deepEqual(cmd, { type: "createTask", title: "Run" });
  });
  it("returns null for get_state and get_doctrine", () => {
    assert.equal(commandForTool("get_state", {}), null);
    assert.equal(commandForTool("get_doctrine", {}), null);
  });
  it("returns null for unknown tools", () => {
    assert.equal(commandForTool("forge_document", {}), null);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
npm test -w @lifequest/vault-core
```

Expected: FAIL module not found `tools.ts`.

- [ ] **Step 3: Implement tools.ts**

Port `commandFor` from `C:\Users\karms\projects\Life-Map\src\server\mcp.ts` into `packages/vault-core/src/map/tools.ts` as `commandForTool(name, args): Command | null`. Keep the same tool names (`create_task`, `set_about_me`, …). `get_state` and `get_week` return `null` (handled by the Electron loop as reads). Do not add document-write tools.

Also export `MAP_TOOL_DEFS`: array of `{ name, description, parameters }` JSON-schema objects copied from Life Map `TOOLS` (use the same fields). Add:

```ts
{
  name: "get_doctrine",
  description: "Read Why / What / How for a domain (default: active domain)",
  parameters: {
    type: "object",
    properties: { domainSlug: { type: "string" } },
  },
}
```

Export `MAP_TOOL_DEFS` and `commandForTool` from `packages/vault-core/src/index.ts`.

- [ ] **Step 4: Run tests — expect pass**

```
npm test -w @lifequest/vault-core
```

Expected: PASS.

- [ ] **Step 5: hermesChatWithTools**

In `hermes-proxy.ts` add (keep existing `hermesChat` for any leftover caller):

```ts
export async function hermesChatWithTools(
  baseUrl: string,
  apiKey: string,
  messages: unknown[],
  tools: unknown[],
  timeoutMs = 60_000,
): Promise<
  Result<
    | { type: "text"; content: string }
    | { type: "tool"; id: string; name: string; args: unknown; raw: unknown }
  >
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await hermesFetchWithConfig(baseUrl, apiKey, "/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        model: "default",
        messages,
        tools,
        stream: false,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).trim();
      return {
        ok: false,
        error: detail || `Hermes chat failed (${res.status}).`,
      };
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall && toolCall.type === "function") {
      let args: unknown = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }
      return {
        ok: true,
        value: {
          type: "tool",
          id: toolCall.id,
          name: toolCall.function.name,
          args,
          raw: message,
        },
      };
    }
    const content = extractChatContent(data);
    if (content === null) {
      return { ok: false, error: "Hermes chat response missing content" };
    }
    return { ok: true, value: { type: "text", content } };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Chat request timed out." : err instanceof Error ? err.message : "Could not reach Hermes.",
    };
  }
}
```

- [ ] **Step 6: Electron tool loop**

Create `apps/desktop/electron/map-tools.ts`:

```ts
import {
  applyMapCommand,
  commandForTool,
  MAP_TOOL_DEFS,
  openVault,
  resolveWeek,
  type MapCommand,
} from "@lifequest/vault-core";
import { hermesChatWithTools } from "./hermes-proxy.js";
import { getHermesKey } from "./secrets.js";

const SYSTEM = `You are the LifeQuest planner. Use tools to read and change the map and tasks. About me is lifestyle context, not a command surface. Do not flip the agent lock. If a tool returns LOCKED, tell the user the map is locked. Do not rewrite Why, What, or How; use get_doctrine to read them.`;

export async function runPlannerLoop(opts: {
  root: string;
  activeSlug: string | null;
  baseUrl: string;
  apiKey: string;
  extraSystem: string;
  messages: { role: string; content: string }[];
}): Promise<Result<{ content: string }>> {
  const openaiTools = MAP_TOOL_DEFS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const history: unknown[] = [
    { role: "system", content: `${SYSTEM}\n${opts.extraSystem}` },
    ...opts.messages,
  ];
  for (let round = 0; round < 8; round++) {
    const step = await hermesChatWithTools(opts.baseUrl, opts.apiKey, history, openaiTools);
    if (!step.ok) return step;
    if (step.value.type === "text") return { ok: true, value: { content: step.value.content } };
    const toolResult = await executeTool(
      opts.root,
      opts.activeSlug,
      step.value.name,
      step.value.args,
    );
    if (
      toolResult &&
      typeof toolResult === "object" &&
      "error" in toolResult &&
      (toolResult as { error?: { code?: string } }).error?.code === "LOCKED"
    ) {
      return { ok: true, value: { content: "The map is locked." } };
    }
    history.push(step.value.raw);
    history.push({
      role: "tool",
      tool_call_id: step.value.id,
      content: JSON.stringify(toolResult),
    });
  }
  return { ok: true, value: { content: "Stopped after too many tool calls." } };
}

export async function executeTool(
  root: string,
  activeSlug: string | null,
  name: string,
  args: unknown,
): Promise<unknown> {
  const rec = args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const snap = await openVault(root);
  if (!snap.ok) return { error: { code: "NOT_FOUND", message: snap.error } };
  if (name === "get_state") return { state: snap.value.map };
  if (name === "get_doctrine") {
    const slug =
      (rec.domainSlug as string | undefined) ??
      activeSlug ??
      snap.value.domains.find((d) => !d.meta.archivedAt)?.slug;
    const domain = snap.value.domains.find((d) => d.slug === slug);
    if (!domain) return { error: { code: "NOT_FOUND", message: "Domain not found" } };
    return {
      slug: domain.slug,
      name: domain.meta.name,
      why: domain.documents.why,
      what: domain.documents.what,
      how: domain.documents.how,
    };
  }
  if (name === "get_week") {
    if (!snap.value.map) return { error: { code: "NOT_FOUND", message: snap.value.mapError } };
    return {
      week: resolveWeek(snap.value.map, rec.year as number, rec.monday as string),
    };
  }
  const command = commandForTool(name, rec) as MapCommand | null;
  if (!command) return { error: { code: "MALFORMED", message: `Unknown tool ${name}` } };
  const applied = await applyMapCommand(root, command, "agent");
  if (!applied.ok) {
    const [code, ...rest] = applied.error.split(": ");
    return { error: { code, message: rest.join(": ") } };
  }
  return { state: applied.value };
}
```

Pass `active domain slug` into `extraSystem` from vault-service (read `getActiveDomain(vaultId)`). Also inject `About me: ${map.aboutMe}` and `Agent lock: ${map.locked}`.

Wire `vault.hermesChatToolsCall(messages)` to load settings URL + key, then `runPlannerLoop`. If no key, return the existing missing-key error.

IPC `hermes:chatTools`. ChatPanel `sendMessage` calls `api().hermesChatTools` instead of `hermesChat`. After success, `refresh()` so Map mutations show up.

Act `runAgent`: use `hermesChatTools` with the existing brief as the user message (not a second chat-only completion). Keep showing the reply in the run list.

- [ ] **Step 7: Typecheck + vault-core tests**

```
npm test -w @lifequest/vault-core
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

Manual: unlocked chat “add a task titled stretch”; task appears on Act. Toggle Agent locked; same request must not create a task; assistant reports locked.

- [ ] **Step 8: Commit**

```
git add packages/vault-core apps/desktop
git commit -m "feat: Hermes tool loop for Map writes with agent lock"
```

---

### Task 9: MCP on 127.0.0.1:8643

**Files:**
- Modify: `apps/desktop/package.json` (dependencies)
- Create: `apps/desktop/electron/mcp-server.ts`
- Modify: `apps/desktop/electron/vault-service.ts` (start/stop with vault open/close)
- Modify: `apps/desktop/src/components/settings/SettingsHermes.tsx` or SettingsVault — show URL
- Modify: `apps/desktop/electron/main.ts` if listen must start after app ready

**Interfaces:**
- Consumes: same `executeTool` / `commandForTool` as Task 8 (`actor: "agent"`)
- Produces: `http://127.0.0.1:8643/mcp` while a vault is open

- [ ] **Step 1: Add dependencies**

From `apps/desktop`:

```
npm install @modelcontextprotocol/sdk zod --workspace=@lifequest/desktop
```

Use versions compatible with Life Map (`@modelcontextprotocol/sdk` ^1.30, `zod` ^4) unless install fails on the desktop TS target — then the latest 1.x / 4.x that `npm install` resolves.

- [ ] **Step 2: mcp-server.ts**

Port `createMcpServer` from `C:\Users\karms\projects\Life-Map\src\server\mcp.ts` to `apps/desktop/electron/mcp-server.ts`:

- `McpServer` name `"lifequest-map"`.
- Register every `MAP_TOOL_DEFS` name plus `get_doctrine` / `get_state` / `get_week`.
- Handler calls the same `executeTool(root, activeSlug, name, args)` as Task 8 (export `executeTool` from `map-tools.ts`; read `activeSlug` from `getActiveDomain` for the open vault).
- HTTP: `node:http` `createServer` listening on `127.0.0.1`, port **8643**, path `/mcp` using `StreamableHTTPServerTransport` like Life Map.
- `startMcp(root: string): Promise<Result<{ url: string }>>`
- If `EADDRINUSE`, return `{ ok: false, error: "MCP port 8643 is in use. Close the other process or quit LifeQuest." }`. Do not try 8644.
- `stopMcp(): Promise<void>` closes the server.

- [ ] **Step 3: Lifecycle**

On successful `vaultCreate` / `vaultOpen` (`rememberOpen`): `await startMcp(root)`. If start fails, keep the vault open and store `mcpError` in module state for Settings.

On `clearVault` / app `before-quit`: `await stopMcp()`.

- [ ] **Step 4: Settings copy**

On Hermes or Vault settings panel, show:

```
MCP (while a vault is open): http://127.0.0.1:8643/mcp
```

If `mcpError`, show it with `role="alert"`.

- [ ] **Step 5: Typecheck**

```
npm run typecheck -w @lifequest/desktop
```

Expected: PASS.

Manual: with vault open, another MCP client hitting `/mcp` `get_state` works; with Agent locked, a write tool returns LOCKED; quit app, port is free.

- [ ] **Step 6: Commit**

```
git add apps/desktop package-lock.json
git commit -m "feat(desktop): loopback MCP door for the Life Map store"
```

---

## Self-review (spec coverage)

| Spec section | Task |
|--------------|------|
| Chart `/chart` labeled Life Map, global calendar, What strip | 3, 5 |
| Architecture `/track`, How strip, shared year, no year CRUD | 6 |
| Act tasks + How-gated dispatch | 7, 8 |
| About me in Settings, `about.md` | 2, 7 |
| `map.json` one blob, schema 1, seed, malformed no clobber | 2 |
| `applyCommand` port, actor user vs agent | 1, 2, 4, 8 |
| Doctrine not through Map commands | 8 (`commandForTool` null for forge) |
| Unlock any live Why; dispatch needs How | 3, 7 |
| Agent lock in top bar | 4 |
| Hermes-only tool loop, `get_doctrine`, 8 rounds, 60s | 8 |
| MCP 8643, last slice | 9 |
| Home Today / This week | 7 |
| Life log on Map writes | 2 `mapLogEvent` |
| File watch map.json / about.md | 4 |
| No importer, no OpenRouter, no Hono | constraints; not tasked |
| Domain tests ported | 1 |
| Persist / lock / about tests | 2 |

No open spec requirements without a task.
