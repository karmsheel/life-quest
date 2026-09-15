# Daily Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Execute Daily Schedule page that copies today’s Architecture day type into a live record, with a timed clock and leftover list (including unplaced Act `today` tasks).

**Architecture:** Extend the Map store (`liveDays` on `StoreState` in `map.json`) and `applyCommand`. The desktop Execute rail gains `/daily` as default; the page calls `ensureLiveDay` for `todayLocalIso()` and edits through existing `mapApply` IPC. Architecture day types, default week, Real Week, and Act’s board stay unchanged.

**Tech Stack:** vault-core (`node:test`), Electron `mapApply`, React 19, React Router 7 HashRouter, Lucide `Clock`, existing CSS tokens. No new libraries. No `schemaVersion` bump.

**Spec:** `docs/superpowers/specs/2026-09-15-daily-schedule-design.md`

## Global Constraints

- Do **not** bump `schemaVersion` (stays `1`)
- Do **not** update `archive/web-skeleton`
- Do **not** add `daily` to `ROOM_IDS` or wrap the page in `RoomLockGate`
- Do **not** mutate Architecture day types, default week, or Real Week from this page
- Do **not** copy default-week weekly items onto the live day
- Do **not** add a date switcher, streaks, calendar sync, overnight agent fill, or Map agent tools for live days
- Do **not** filter the page by domain lens
- Live days are **not** part of archive year snapshots
- Leftover **tasks** are a read-time union (`column === "today"` and not already a block on that date)
- Completing a task-linked block sets the task to `done`; unchecking the block does **not** reopen the task
- Route `/daily` owns Execute; `/review/daily` stays Review
- Execute rail order: **Daily Schedule, Act**; `WING_DEFAULTS.execute` = `/daily`
- Tests: from `packages/vault-core`, `node --experimental-strip-types --test tests/<file>.test.ts`; from `apps/desktop`, `node --experimental-strip-types --test tests/<file>.test.ts`
- Full gate after Task 4: `npm test` in `packages/vault-core`; `npm test` and `npm run typecheck` in `apps/desktop`
- Commit only files from the current task
- Spec status is already approved and points at this plan; do not rewrite the spec unless a task finds a contradiction

---

## File Structure

```
packages/vault-core/src/map/
  types.ts          # LiveSource, LiveLeftoverItem, LiveBlock, LiveDay, liveDays, commands
  empty.ts          # liveDays: {}
  dates.ts          # weekdayOf
  live-days.ts      # NEW: commands + liveDayView + cascade
  commands.ts       # dispatch new command types
  persist.ts        # toFile/fromFile liveDays; missing seeds {}
  log-event.ts      # map.liveDay.*
  public.ts         # export types, weekdayOf, liveDayView
packages/vault-core/tests/map/
  dates.test.ts     # weekdayOf
  live-days.test.ts # NEW
packages/vault-core/tests/
  map-persist.test.ts  # omit liveDays → {}

apps/desktop/src/
  components/shell/wing.ts
  components/shell/nav-items.ts
  App.tsx
  pages/DailySchedulePage.tsx   # NEW
  styles/schedule.css           # NEW
  styles/global.css             # @import schedule.css
apps/desktop/tests/
  wing.test.ts
  wing-shell.test.ts
```

No Map agent tools. No IPC channel. `mapApply` already persists `applyCommand`.

---

### Task 1: Types, weekday, empty state, persist

**Files:**
- Modify: `packages/vault-core/src/map/dates.ts`
- Modify: `packages/vault-core/src/map/types.ts`
- Modify: `packages/vault-core/src/map/empty.ts`
- Modify: `packages/vault-core/src/map/persist.ts`
- Modify: `packages/vault-core/src/map/public.ts`
- Modify: `packages/vault-core/tests/map/dates.test.ts`
- Modify: `packages/vault-core/tests/map-persist.test.ts`

**Interfaces:**
- Consumes: `isIsoDate`, `utc` helper already in `dates.ts` (keep it file-private; add `weekdayOf` next to it)
- Produces:
  - `weekdayOf(date: IsoDate): Weekday` — Monday = 0 (`(getUTCDay() + 6) % 7`)
  - `LiveSource`, `LiveLeftoverItem`, `LiveBlock`, `LiveDay`
  - `StoreState.liveDays: Record<IsoDate, LiveDay>`
  - Command union members listed in Task 2 (add the type variants now so Task 2 compiles)
  - Missing `liveDays` in `map.json` → `{}`

- [ ] **Step 1: Write the failing tests**

In `packages/vault-core/tests/map/dates.test.ts`, add the import `weekdayOf` and this case:

```ts
  it("weekdayOf is Monday = 0", () => {
    assert.equal(weekdayOf("2026-09-14"), 0);
    assert.equal(weekdayOf("2026-09-15"), 1);
    assert.equal(weekdayOf("2026-09-20"), 6);
  });
```

In `packages/vault-core/tests/map-persist.test.ts`, add:

```ts
  it("loads map.json that omits liveDays as empty", async () => {
    const root = path.join(dir, "no-live-days");
    const created = await createVault(root, "Personal");
    assert.equal(created.ok, true);
    const p = vaultPaths(root).mapJson;
    const raw = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    delete raw.liveDays;
    await fs.writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const opened = await openVault(root);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.deepEqual(opened.value.map?.liveDays, {});
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/vault-core`:

```
node --experimental-strip-types --test tests/map/dates.test.ts
```

Expected: FAIL (`weekdayOf` is not exported).

```
node --experimental-strip-types --test tests/map-persist.test.ts
```

Expected: FAIL (`liveDays` undefined vs `{}`) **or** the omit test fails after `delete raw.liveDays` because `fromFile` does not default it. If createVault already writes `liveDays` after you implement, the omit path is the one that must still seed `{}`.

- [ ] **Step 3: Implement types, weekday, empty, persist**

Add to `packages/vault-core/src/map/dates.ts`:

```ts
import type { IsoDate, Weekday } from "./types.ts";

export function weekdayOf(date: IsoDate): Weekday {
  const day = utc(date).getUTCDay();
  return ((day + 6) % 7) as Weekday;
}
```

(`utc` already exists in this file.)

In `packages/vault-core/src/map/types.ts`, add before `StoreState`:

```ts
export type LiveSource =
  | { type: "template"; dayTypeItemId: string }
  | { type: "ad-hoc" }
  | { type: "task"; taskId: string };

export type LiveLeftoverItem = {
  id: string;
  text: string;
  done: boolean;
  source: Exclude<LiveSource, { type: "task" }>;
};

export type LiveBlock = {
  id: string;
  text: string;
  startMinutes: number;
  durationMinutes: number;
  done: boolean;
  source: LiveSource;
};

export type LiveDay = {
  date: IsoDate;
  dayTypeId: string | null;
  leftover: LiveLeftoverItem[];
  blocks: LiveBlock[];
};
```

Add `liveDays: Record<IsoDate, LiveDay>` to `StoreState` (after `tasks`).

Append these variants to `Command` (after `setAboutMe`):

```ts
  | { type: "ensureLiveDay"; date: IsoDate }
  | { type: "setLiveDayType"; date: IsoDate; dayTypeId: string | null }
  | { type: "addLiveAdHoc"; date: IsoDate; text: string }
  | {
      type: "placeLiveBlock";
      date: IsoDate;
      leftoverId?: string;
      taskId?: string;
      startMinutes: number;
      durationMinutes: number;
    }
  | {
      type: "updateLiveBlock";
      date: IsoDate;
      blockId: string;
      startMinutes?: number;
      durationMinutes?: number;
    }
  | { type: "unplaceLiveBlock"; date: IsoDate; blockId: string }
  | { type: "completeLiveLeftover"; date: IsoDate; leftoverId: string }
  | { type: "completeLiveBlock"; date: IsoDate; blockId: string }
  | { type: "deleteLiveAdHoc"; date: IsoDate; leftoverId: string };
```

`empty.ts`: `liveDays: {}` on `emptyState()`.

`persist.ts`:

- `toFile` includes `liveDays: state.liveDays`.
- `fromFile` includes `liveDays: normalizeLiveDays(file.liveDays)`.
- Treat missing/non-object `liveDays` as `{}`.
- `normalizeLiveDays` copies well-shaped days keyed by valid ISO dates; skip junk rows.

```ts
function isLiveSource(value: unknown): value is LiveSource {
  if (!value || typeof value !== "object") return false;
  const s = value as LiveSource;
  if (s.type === "ad-hoc") return true;
  if (s.type === "template" && typeof s.dayTypeItemId === "string") return true;
  if (s.type === "task" && typeof s.taskId === "string") return true;
  return false;
}

function normalizeLiveDays(raw: unknown): Record<string, LiveDay> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, LiveDay> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isIsoDate(date) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const leftover = Array.isArray(v.leftover) ? v.leftover : [];
    const blocks = Array.isArray(v.blocks) ? v.blocks : [];
    out[date] = {
      date,
      dayTypeId: typeof v.dayTypeId === "string" ? v.dayTypeId : null,
      leftover: leftover.filter((row) => {
        const r = row as LiveLeftoverItem;
        return (
          r &&
          typeof r.id === "string" &&
          typeof r.text === "string" &&
          typeof r.done === "boolean" &&
          isLiveSource(r.source) &&
          r.source.type !== "task"
        );
      }),
      blocks: blocks.filter((row) => {
        const r = row as LiveBlock;
        return (
          r &&
          typeof r.id === "string" &&
          typeof r.text === "string" &&
          typeof r.done === "boolean" &&
          Number.isInteger(r.startMinutes) &&
          Number.isInteger(r.durationMinutes) &&
          isLiveSource(r.source)
        );
      }),
    };
  }
  return out;
}
```

Import `isIsoDate` and the live types in `persist.ts`. `isMapFile` stays as-is (do **not** require `liveDays`).

`public.ts`: export `LiveDay`, `LiveBlock`, `LiveLeftoverItem`, `LiveSource`, and `weekdayOf`.

`commands.ts` will not compile until Task 2 because the `Command` union is exhaustive. **Do not** add a dummy default. Land Task 1 types + persist + weekday, then immediately Task 2 in the same session if typecheck of vault-core map is needed — or add the Task 2 dispatch before committing Task 1. Prefer: implement Task 1 persist/types/weekday, add stub `fail("MALFORMED", "not implemented")` cases in `commands.ts` only if you must commit Task 1 alone. Better: finish Task 2 before the Task 1 commit if the exhaustive switch blocks `tsc`. This repo’s vault-core package has **no typecheck script**; `node --test` loads `commands.ts` only when tests import it. Task 1 tests do not import `commands.ts`. Leave `commands.ts` until Task 2.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/map/dates.test.ts
node --experimental-strip-types --test tests/map-persist.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/vault-core/src/map/dates.ts packages/vault-core/src/map/types.ts packages/vault-core/src/map/empty.ts packages/vault-core/src/map/persist.ts packages/vault-core/src/map/public.ts packages/vault-core/tests/map/dates.test.ts packages/vault-core/tests/map-persist.test.ts
git commit -m "feat(vault-core): persist liveDays on the map store"
```

---

### Task 2: Live-day commands

**Files:**
- Create: `packages/vault-core/src/map/live-days.ts`
- Create: `packages/vault-core/tests/map/live-days.test.ts`
- Modify: `packages/vault-core/src/map/commands.ts`
- Modify: `packages/vault-core/src/map/log-event.ts`
- Modify: `packages/vault-core/src/map/public.ts`

**Interfaces:**
- Consumes: `StoreState`, `ApplyContext`, `weekdayOf`, `isIsoDate`, `updateTask`, `fail`, `ok`
- Produces:
  - `liveDayView(state, date)` → `{ day: LiveDay | null; leftover: LiveLeftoverView[] }`
  - All live-day commands via `applyCommand`

`LiveLeftoverView`:

```ts
export type LiveLeftoverView = {
  id: string;
  text: string;
  done: boolean;
  kind: "stored" | "task";
  source: LiveSource;
};
```

Stored leftover first, then `today` tasks whose id is not a `source.taskId` on that date’s blocks. `id` for task rows is the task id.

- [ ] **Step 1: Write the failing test**

Create `packages/vault-core/tests/map/live-days.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommand } from "../../src/map/commands.ts";
import { emptyState } from "../../src/map/empty.ts";
import { liveDayView } from "../../src/map/live-days.ts";
import type { ApplyContext, Result, StoreState } from "../../src/map/types.ts";

let n = 0;
const ctx: ApplyContext = {
  actor: "user",
  today: "2026-09-15",
  id: () => `x${++n}`,
};

function base() {
  n = 0;
  return emptyState();
}

function must(res: Result<StoreState>): StoreState {
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

describe("ensureLiveDay", () => {
  it("copies the weekday default type into leftover and is idempotent", () => {
    let s = base();
    const created = applyCommand(
      s,
      { type: "createDayType", name: "Deep work", color: "blue" },
      ctx,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    s = created.value;
    const typed = applyCommand(
      s,
      {
        type: "updateDayType",
        id: "x1",
        items: [{ id: "i1", text: "Write" }],
      },
      ctx,
    );
    assert.equal(typed.ok, true);
    if (!typed.ok) return;
    s = typed.value;
    const week = applyCommand(
      s,
      { type: "setDefaultWeekdayType", weekday: 1, dayTypeId: "x1" },
      ctx,
    );
    assert.equal(week.ok, true);
    if (!week.ok) return;
    s = week.value;
    const first = applyCommand(
      s,
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    s = first.value;
    const day = s.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, "x1");
    assert.equal(day.leftover.length, 1);
    assert.equal(day.leftover[0].text, "Write");
    assert.equal(day.leftover[0].source.type, "template");
    if (day.leftover[0].source.type === "template") {
      assert.equal(day.leftover[0].source.dayTypeItemId, "i1");
    }
    assert.deepEqual(day.blocks, []);
    const leftoverId = day.leftover[0].id;
    const second = applyCommand(
      s,
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.liveDays["2026-09-15"].leftover[0].id, leftoverId);
  });

  it("seeds empty leftover when the weekday has no type", () => {
    const res = applyCommand(
      base(),
      { type: "ensureLiveDay", date: "2026-09-15" },
      ctx,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const day = res.value.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, null);
    assert.deepEqual(day.leftover, []);
  });
});

describe("setLiveDayType", () => {
  it("replaces leftover template rows only", () => {
    let s = base();
    s = must(
      applyCommand(s, { type: "createDayType", name: "A", color: "blue" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "createDayType", name: "B", color: "blue" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "updateDayType", id: "x1", items: [{ id: "i1", text: "Old" }] },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "updateDayType", id: "x2", items: [{ id: "i2", text: "New" }] },
        ctx,
      ),
    );
    s = must(applyCommand(s, { type: "ensureLiveDay", date: "2026-09-15" }, ctx));
    s = must(
      applyCommand(
        s,
        { type: "setLiveDayType", date: "2026-09-15", dayTypeId: "x1" },
        ctx,
      ),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "Call" }, ctx),
    );
    const leftoverId = s.liveDays["2026-09-15"].leftover.find(
      (r) => r.source.type === "template",
    )!.id;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "setLiveDayType", date: "2026-09-15", dayTypeId: "x2" },
        ctx,
      ),
    );
    const day = s.liveDays["2026-09-15"];
    assert.equal(day.dayTypeId, "x2");
    assert.equal(day.blocks.length, 1);
    assert.equal(day.blocks[0].text, "Old");
    assert.equal(day.leftover.some((r) => r.text === "Call"), true);
    assert.equal(day.leftover.some((r) => r.text === "New"), true);
    assert.equal(day.leftover.some((r) => r.text === "Old"), false);
  });
});

describe("place, cascade, unplace", () => {
  it("pushes later overlaps and does not pull forward", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "A" }, ctx),
    );
    s = must(
      applyCommand(s, { type: "addLiveAdHoc", date: "2026-09-15", text: "B" }, ctx),
    );
    const [a, b] = s.liveDays["2026-09-15"].leftover;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId: a.id,
          startMinutes: 540,
          durationMinutes: 60,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId: b.id,
          startMinutes: 600,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        {
          type: "updateLiveBlock",
          date: "2026-09-15",
          blockId: a.id,
          durationMinutes: 90,
        },
        ctx,
      ),
    );
    const pushed = s.liveDays["2026-09-15"].blocks.find((x) => x.id === b.id);
    assert.equal(pushed?.startMinutes, 630);
    s = must(
      applyCommand(
        s,
        {
          type: "updateLiveBlock",
          date: "2026-09-15",
          blockId: a.id,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    const stayed = s.liveDays["2026-09-15"].blocks.find((x) => x.id === b.id);
    assert.equal(stayed?.startMinutes, 630);
  });

  it("unplaces ad-hoc leftover back onto the list", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "addLiveAdHoc", date: "2026-09-15", text: "Stretch" },
        ctx,
      ),
    );
    const leftoverId = s.liveDays["2026-09-15"].leftover[0].id;
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          leftoverId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    s = must(
      applyCommand(
        s,
        { type: "unplaceLiveBlock", date: "2026-09-15", blockId: leftoverId },
        ctx,
      ),
    );
    assert.equal(s.liveDays["2026-09-15"].blocks.length, 0);
    assert.equal(s.liveDays["2026-09-15"].leftover[0].text, "Stretch");
  });
});

describe("tasks on the live day", () => {
  it("unions today tasks into leftover and completes the Act task from a block", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "createTask", title: "Inbox zero", column: "today" },
        ctx,
      ),
    );
    const taskId = s.tasks[0].id;
    const view = liveDayView(s, "2026-09-15");
    assert.equal(view.leftover.some((r) => r.id === taskId && r.kind === "task"), true);
    s = must(
      applyCommand(
        s,
        {
          type: "placeLiveBlock",
          date: "2026-09-15",
          taskId,
          startMinutes: 540,
          durationMinutes: 30,
        },
        ctx,
      ),
    );
    assert.equal(
      liveDayView(s, "2026-09-15").leftover.some((r) => r.id === taskId),
      false,
    );
    const blockId = s.liveDays["2026-09-15"].blocks[0].id;
    s = must(
      applyCommand(s, { type: "completeLiveBlock", date: "2026-09-15", blockId }, ctx),
    );
    assert.equal(s.tasks[0].column, "done");
    assert.equal(s.liveDays["2026-09-15"].blocks[0].done, true);
    s = must(
      applyCommand(s, { type: "completeLiveBlock", date: "2026-09-15", blockId }, ctx),
    );
    assert.equal(s.liveDays["2026-09-15"].blocks[0].done, false);
    assert.equal(s.tasks[0].column, "done");
  });

  it("omits non-today tasks from leftover", () => {
    let s = must(
      applyCommand(base(), { type: "ensureLiveDay", date: "2026-09-15" }, ctx),
    );
    s = must(
      applyCommand(
        s,
        { type: "createTask", title: "Later", column: "this-week" },
        ctx,
      ),
    );
    assert.equal(liveDayView(s, "2026-09-15").leftover.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/map/live-days.test.ts
```

Expected: FAIL (`live-days.ts` missing or unhandled command).

- [ ] **Step 3: Implement `live-days.ts` and dispatch**

Create `packages/vault-core/src/map/live-days.ts` with:

- `putDay(state, day)`
- `requireDay(state, date)` → `NOT_FOUND` if missing; `MALFORMED` if date is not ISO
- `copyTypeItems(state, dayTypeId, ctx)` → leftover rows (`done: false`, `source.template`, new ids)
- `cascadeFrom(blocks, editedId)`:
  1. Sort by `startMinutes`, then `id`
  2. Find the edited block; `end = start + duration`
  3. For each following block: if `start < end`, set `start = end`; then `end = start + duration`
- `assertMinutes(start, duration)` → `start >= 0`, `duration >= 1`, both integers

Commands:

| Command | Rules |
|---------|--------|
| `ensureLiveDay` | Invalid date → `MALFORMED`. Exists → no-op. Else leftover from `defaultWeek.dayTypeByWeekday[weekdayOf(date)]`. |
| `setLiveDayType` | Same id → no-op. Unknown id → `NOT_FOUND`. Replace leftover where `source.type === "template"` with copies (or `[]` if `null`). Keep ad-hoc leftover and all blocks. |
| `addLiveAdHoc` | Trim; empty → `MALFORMED`. |
| `placeLiveBlock` | Exactly one of `leftoverId` / `taskId`. Leftover: move onto a block with the **same id**, `done` copied. Task: must be `column === "today"` and not already a block on this date (`MALFORMED` otherwise); new block id from `ctx.id()`, `done: false`, `text` from task title. Then cascade. |
| `updateLiveBlock` | Patch provided fields; cascade. |
| `unplaceLiveBlock` | Template/ad-hoc → leftover with same id/`done`. Task → drop the block only. |
| `completeLiveLeftover` | Toggle `done`. |
| `completeLiveBlock` | Toggle `done`. If becoming `true` and `source.type === "task"`, `updateTask(..., { column: "done" })`; if that task is missing, still keep the block `done`. Unchecking does not change the task. |
| `deleteLiveAdHoc` | Only `source.type === "ad-hoc"` leftover; else `MALFORMED`. |

`liveDayView`: if no day, `day: null` and leftover = today-task rows only.

Wire every command in `commands.ts` (import from `./live-days.ts`).

`log-event.ts` explicit cases:

- `ensureLiveDay` → `map.liveDay.ensured` / `Ensured live day`
- `setLiveDayType` → `map.liveDay.typeSet` / `Set live day type`
- `addLiveAdHoc` → `map.liveDay.adHocAdded` / `Added schedule item`
- `placeLiveBlock` → `map.liveDay.blockPlaced` / `Placed schedule block`
- `updateLiveBlock` → `map.liveDay.blockUpdated` / `Updated schedule block`
- `unplaceLiveBlock` → `map.liveDay.blockUnplaced` / `Unplaced schedule block`
- `completeLiveLeftover` → `map.liveDay.leftoverCompleted` / `Toggled leftover item`
- `completeLiveBlock` → `map.liveDay.blockCompleted` / `Toggled schedule block`
- `deleteLiveAdHoc` → `map.liveDay.adHocDeleted` / `Deleted schedule item`

Payload includes `date` (and `blockId` / `leftoverId` / `taskId` when present).

`public.ts`: export `liveDayView`, `LiveLeftoverView`.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/map/live-days.test.ts
node --experimental-strip-types --test tests/map/dates.test.ts tests/map/tasks.test.ts tests/map-persist.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/vault-core/src/map/live-days.ts packages/vault-core/src/map/commands.ts packages/vault-core/src/map/log-event.ts packages/vault-core/src/map/public.ts packages/vault-core/tests/map/live-days.test.ts
git commit -m "feat(vault-core): live day schedule commands"
```

---

### Task 3: Execute rail and `/daily` route

**Files:**
- Modify: `apps/desktop/tests/wing.test.ts`
- Modify: `apps/desktop/tests/wing-shell.test.ts`
- Modify: `apps/desktop/src/components/shell/wing.ts`
- Modify: `apps/desktop/src/components/shell/nav-items.ts`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/pages/DailySchedulePage.tsx` (minimal mount: heading only is OK if Task 4 follows immediately; prefer the full page in Task 4 — this task must compile, so create a page that renders `h1` Daily Schedule)

**Interfaces:**
- Consumes: existing `wingForPath`, `NAV_ITEMS`, `App` nested routes
- Produces:
  - `WING_DEFAULTS.execute === "/daily"`
  - `wingForPath("/daily") === "execute"`
  - `wingForPath("/review/daily") === "review"`
  - Execute nav ids `["schedule", "act"]` in that order
  - Nav item `id: "schedule"`, `href: "/daily"`, `label: "Daily Schedule"`, icon `Clock`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/tests/wing.test.ts`:

- `session.lastPath.execute` and fallback fixtures: `"/daily"` instead of `"/act"` where they represent the **default** (keep `execute: "/act"` only in “last path belongs to a different wing” if you still need an Execute-owned last path — `/act` remains Execute-owned).
- `wingForPath("/daily")` → `"execute"` in the maps-owned-paths test.
- Remove `wingForPath("/daily") === null` from the unknown-paths test.
- Execute nav ids: `["schedule", "act"]`.

In `apps/desktop/tests/wing-shell.test.ts`:

- Nested routes include `/daily`.
- `DailySchedulePage` is imported and used.
- Add `src/pages/DailySchedulePage.tsx` to the “does not gate Plan or Execute pages behind a room lock” file list.

- [ ] **Step 2: Run tests to verify they fail**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/wing.test.ts tests/wing-shell.test.ts
```

Expected: FAIL (`/daily` still null; Execute nav still `["act"]`).

- [ ] **Step 3: Wire shell**

`wing.ts`: `WING_DEFAULTS.execute = "/daily"`; `PATH_WING["/daily"] = "execute"`.

`nav-items.ts`: import `Clock`; insert **before** Act:

```ts
  {
    id: "schedule",
    href: "/daily",
    label: "Daily Schedule",
    icon: Clock,
    section: "main",
    wing: "execute",
  },
```

Update the `NAV_ITEMS` comment: `Execute: Daily Schedule, Act.`

`DailySchedulePage.tsx` (minimal):

```tsx
export default function DailySchedulePage() {
  return (
    <div className="schedule">
      <h1>Daily Schedule</h1>
    </div>
  );
}
```

`App.tsx`: import `DailySchedulePage`; add `<Route path="/daily" element={<DailySchedulePage />} />` next to `/act`.

- [ ] **Step 4: Run tests to verify they pass**

```
node --experimental-strip-types --test tests/wing.test.ts tests/wing-shell.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/wing.ts apps/desktop/src/components/shell/nav-items.ts apps/desktop/src/App.tsx apps/desktop/src/pages/DailySchedulePage.tsx apps/desktop/tests/wing.test.ts apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): Execute Daily Schedule rail"
```

---

### Task 4: Daily Schedule page

**Files:**
- Modify: `apps/desktop/src/pages/DailySchedulePage.tsx`
- Create: `apps/desktop/src/styles/schedule.css`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/tests/wing-shell.test.ts` (assert Clock / Leftover copy if you add a source-scan; optional)

**Interfaces:**
- Consumes: `api().mapApply`, `todayLocalIso`, `liveDayView`, `DayType` list from `snapshot.map`
- Produces: the page in spec §5

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/tests/wing-shell.test.ts`:

```ts
  it("Daily Schedule page has clock and leftover", () => {
    const src = read("src/pages/DailySchedulePage.tsx");
    assert.match(src, />Daily Schedule</);
    assert.match(src, />Clock</);
    assert.match(src, />Leftover</);
    assert.match(src, /ensureLiveDay/);
    assert.match(src, /liveDayView/);
    assert.equal(src.includes("RoomLockGate"), false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/wing-shell.test.ts
```

Expected: FAIL (heading-only page).

- [ ] **Step 3: Implement the page**

`DailySchedulePage.tsx`:

- If `snapshot.mapError && !snapshot.map`: `<p className="form-error" role="alert">`.
- On mount, if map loaded and `!map.liveDays[todayLocalIso()]`, `mapApply({ type: "ensureLiveDay", date })` then `refresh()`. Surface apply errors; do not clear the previous view.
- Header: `h1` Daily Schedule, today’s date as text (`todayLocalIso()`), type `<select>` of `map.dayTypes` plus option value `""` label `None`. On change → `setLiveDayType` (`null` if `""`). If `dayTypeId` is missing from the list, still render an option `{id} (missing)`.
- `const view = liveDayView(map, date)` after ensure.
- **Clock:** `day.blocks` sorted by start then id. Row: `formatMinutes(start)–formatMinutes(start+duration)`, title, number input duration, number input start, Done checkbox (`completeLiveBlock`), Unplace button. Submit start/duration on blur or a small Apply control; `updateLiveBlock` then refresh.
- **Leftover:** `view.leftover`. Stored rows: checkbox (`completeLiveLeftover` or `updateTask` to `done` when `kind === "task"`), Place. Place reveals start + duration inputs (default start = max block end, or `540`; default duration `30`) and confirms `placeLiveBlock` with `leftoverId` or `taskId`. Task rows labeled `Task · {title}`.
- Add-ad-hoc: text field + Add at the bottom of leftover (`addLiveAdHoc`).
- Ad-hoc leftover: include a Remove control (`deleteLiveAdHoc`).
- `formatMinutes`: hours may exceed 23 (`padStart` hours and minutes). No `input type="time"` (cannot show past-midnight cascade).
- No year switcher, no streaks, no Act dispatch.

`schedule.css` (quiet, tokens only):

```css
.schedule {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 40rem;
}

.schedule h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0;
}

.schedule__chrome,
.schedule__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.schedule__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.schedule__list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border);
}

.schedule input,
.schedule select {
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
```

`global.css`: `@import "./schedule.css";` after `goals.css`.

Use `@/components/ui/Button` for Place / Unplace / Add.

- [ ] **Step 4: Run tests and typecheck**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/wing.test.ts tests/wing-shell.test.ts
npm run typecheck
```

From `packages/vault-core`:

```
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/pages/DailySchedulePage.tsx apps/desktop/src/styles/schedule.css apps/desktop/src/styles/global.css apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): Daily Schedule clock and leftover"
```

---

## Self-review

**Spec coverage**

| Spec | Task |
|------|------|
| `liveDays` on Map store, schema 1, missing → `{}` | 1 |
| `weekdayOf` Monday = 0 | 1 |
| `ensureLiveDay` copy / idempotent / empty type | 2 |
| `setLiveDayType` leftover template only | 2 |
| Place leftover + today task, unplace | 2 |
| Cascade push, no pull-forward | 2 |
| Task leftover union + complete → Act `done` | 2 |
| Log `map.liveDay.*` | 2 |
| Execute rail Daily Schedule then Act; `/daily`; default | 3 |
| `/review/daily` still Review | 3 |
| No room id / lock | 3–4 |
| Page clock + leftover + picker + ad-hoc + defaults | 4 |
| Map error alert | 4 |
| Out of scope (tools, streaks, Real Week, weekly items) | not tasked |

**Placeholders:** none.

**Types:** `LiveDay` / commands in Task 1 match Task 2; `liveDayView` leftover `id` is leftover id or task id; place uses `leftoverId` vs `taskId`. Nav id is `schedule` so it does not collide with Review `daily`.
