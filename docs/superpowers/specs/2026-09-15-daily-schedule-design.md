# Daily Schedule — Design Spec

**Date:** 2026-09-15  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-09-15-daily-schedule.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Issue:** [KAR-12](https://linear.app/karmsheel/issue/KAR-12/execute-daily-schedule)  
**Depends on:** [Life Map on Chart](./2026-08-27-life-map-chart-design.md), [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md), [Home wing](./2026-09-02-home-wing-design.md), [Review wing](./2026-09-12-review-wing-design.md)

Supersedes:

- Wings / Home / Review: Execute rail is only Act; Execute default is `/act`.
- Review locked decision 3 (Execute: Act) and the note that flat `/daily` is reserved for this page.

Architecture day types, default week, Real Week, and Act’s task board stay. This issue is the **live day**, not a new Architecture model.

---

## 1. Purpose

Execute currently does tasks and agent dispatch on Act. Architecture already holds day types and a default week. There is no place to **run today**: pick (or inherit) a template, put items on a clock, and rearrange as the day overruns or finishes early.

Daily Schedule is that page. It copies today’s template into a live record. Living the day does not rewrite Architecture.

### Success criteria

- Execute rail is **Daily Schedule, Act**. Execute default is `/daily`.
- Opening `/daily` ensures a live day for the local calendar date and shows it. No date switcher.
- Today’s default-week day type is copied into leftover on first ensure. A type picker can switch; switch replaces leftover template items only.
- The page has a **clock** (timed blocks) and a **leftover** list (untimed template copies, ad-hoc items, unplaced Act `today` tasks).
- Placing a leftover item or a `today` task onto the clock creates a block. Changing start or duration **pushes later overlapping blocks**. Finish early does not pull the next block forward.
- Completing a task-linked leftover row or block sets that Act task to `done`.
- No streak UI.
- `schemaVersion` stays **1**. Missing `liveDays` seeds `{}`.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Record | **Live copy of today.** Architecture templates, default week, and Real Week stay the plan. |
| 2 | Storage | `liveDays` on Map `StoreState` in `.lifequest/map.json`, next to `tasks`. Not on `YearRecord`. Not a library document. |
| 3 | Key | ISO date `YYYY-MM-DD` (local). Past days stay on disk. The page is today only. |
| 4 | Schema | **No bump.** Missing `liveDays` → `{}`. |
| 5 | Execute rail | **Daily Schedule, Act** (that order). |
| 6 | Route | `/daily`. Exact path owns Execute. `/review/daily` stays Review. |
| 7 | Execute default | `WING_DEFAULTS.execute` = `/daily`. Session last-path memory unchanged. |
| 8 | Room id | **None.** Do not add `daily` to `ROOM_IDS`. Page is always in the rail. |
| 9 | Seed | `ensureLiveDay` is idempotent. If missing, copy that weekday’s default-week type items into leftover (Monday = 0, same as Architecture). No type → empty leftover, `dayTypeId: null`. |
| 10 | Switch type | Replaces leftover rows with `source.type === "template"` only. Clock, ad-hoc leftover, and task blocks stay. Same id is a no-op. `null` clears template leftover. |
| 11 | Clock | Integer minutes. No 30-minute snap. `startMinutes >= 0`, `durationMinutes >= 1`. Cascade may push start past midnight. |
| 12 | Cascade | Edited block keeps its new start/duration. Blocks with a later start that overlap are shifted so each starts at the previous end. Finish early does **not** pull forward. Overlap with an *earlier* block is left for the operator. |
| 13 | Leftover stored | Template copies and ad-hoc items, with `done`. |
| 14 | Leftover tasks | **Read-time union.** Act tasks in column `today` that are not a block on this date. Not written onto the live day until placed. |
| 15 | Place | Template/ad-hoc leftover moves onto the clock. A `today` task becomes a block with `source.type === "task"`. Default start = end of last block, or 09:00 if none. Default duration 30. |
| 16 | Unplace | Template/ad-hoc returns to leftover (`done` kept). Task block is removed; the task reappears in the leftover union if it is still `today`. |
| 17 | Complete | Toggle `done` on leftover or block. Task source also `updateTask` → `column: "done"`. Unplaced task rows call `updateTask` only. Missing task: still mark the live item `done`, do not crash. |
| 18 | Done visibility | Done clock blocks stay on the clock. Done template/ad-hoc leftover stays in leftover. Done tasks leave the leftover union. |
| 19 | Weekly items | **Out.** Default-week weekly items are not copied onto the live day. |
| 20 | Domain lens | **Unfiltered.** Live day is vault-global, like the calendar. |
| 21 | Actor | Renderer `user`. Same Map command bus. Agents may call these commands later; this issue does not add overnight fill. |
| 22 | Year snapshot | Live days are **not** part of archive year snapshots. |
| 23 | Archive web-skeleton | **Not** updated. |

### Explicitly out of scope

- Overnight agent fill or agent auto-rearrange
- Habit-tracker page and consecutive-day streaks
- Calendar sync
- Date switcher, Review notes, or browsing yesterday on this page
- Timed schedules on Architecture day types
- Mutating Real Week from Daily Schedule
- Copying default-week weekly items onto today
- Phone capture
- Schema version bump

---

## 3. Data model

```ts
type LiveSource =
  | { type: "template"; dayTypeItemId: string }
  | { type: "ad-hoc" }
  | { type: "task"; taskId: string };

type LiveLeftoverItem = {
  id: string;
  text: string;
  done: boolean;
  source: Exclude<LiveSource, { type: "task" }>;
};

type LiveBlock = {
  id: string;
  text: string;
  startMinutes: number;
  durationMinutes: number;
  done: boolean;
  source: LiveSource;
};

type LiveDay = {
  date: IsoDate;
  dayTypeId: string | null;
  leftover: LiveLeftoverItem[];
  blocks: LiveBlock[];
};

// on StoreState / map.json (not YearRecord)
liveDays: Record<IsoDate, LiveDay>;
```

Weekday for a date uses the same Monday = 0 mapping as Architecture (`UTCDay === 0` → 6, else `UTCDay - 1`).

Query helper `liveDayView(state, date)` returns the record plus leftover display rows: stored leftover, then unplaced `today` tasks (id = task id, text = title, source task). Tasks already referenced by a block on that date are omitted.

---

## 4. Commands

Same `applyCommand` bus and existing `mapApply` IPC. No new channel.

Unknown date on a mutating command (other than `ensureLiveDay`) → `NOT_FOUND`. Invalid ISO date or bad minutes → `MALFORMED`. Unknown type / leftover / block / task → `NOT_FOUND`. A `taskId` that is not column `today`, or is already a block on this date, → `MALFORMED`.

| Command | Effect |
|---------|--------|
| `ensureLiveDay` `{ date }` | If `liveDays[date]` exists, no-op. Else create: `dayTypeId` from default week for that weekday; leftover = copies of that type’s `items` (`source.template`, `done: false`); `blocks: []`. |
| `setLiveDayType` `{ date, dayTypeId }` | `dayTypeId` null or a known type. Replace leftover template rows with copies of the new type (or `[]`). |
| `addLiveAdHoc` `{ date, text }` | Trimmed non-empty text. Append leftover `{ source: ad-hoc, done: false }`. |
| `placeLiveBlock` `{ date, leftoverId?, taskId?, startMinutes, durationMinutes }` | Exactly one of `leftoverId` or `taskId`. Move leftover off the list onto a block (`done` copied), or pin a `today` task (`done: false`). Then cascade from that block. |
| `updateLiveBlock` `{ date, blockId, startMinutes?, durationMinutes? }` | Patch; cascade from that block. |
| `unplaceLiveBlock` `{ date, blockId }` | See decision 16. |
| `completeLiveLeftover` `{ date, leftoverId }` | Toggle `done` on a stored leftover row. |
| `completeLiveBlock` `{ date, blockId }` | Toggle `done`. If task source, set that task’s column to `done` when marking done (do not reopen the task when unchecking). |
| `deleteLiveAdHoc` `{ date, leftoverId }` | Only `source.type === "ad-hoc"`. |

Cascade after place/update:

1. Apply the new start/duration to the edited block.
2. Sort blocks by `startMinutes`, then `id`.
3. Let `end` be the edited block’s end.
4. For each following block in that sort: if `start < end`, set `start = end`; then `end = start + duration`.

Log: `mapLogEvent` gains explicit cases (`map.liveDay.ensured`, `map.liveDay.typeSet`, `map.liveDay.adHocAdded`, `map.liveDay.blockPlaced`, `map.liveDay.blockUpdated`, `map.liveDay.blockUnplaced`, `map.liveDay.leftoverCompleted`, `map.liveDay.blockCompleted`, `map.liveDay.adHocDeleted`). Actor is already recorded on Map writes.

Opening `/daily` calls `ensureLiveDay({ date: todayLocalIso() })`. No date query param.

---

## 5. Page

Heading **Daily Schedule**. Today’s date as text, not a control.

Type picker: live Architecture day types plus **None**. Change → `setLiveDayType`.

**Clock** (sorted by start): start–end, title, duration, done, unplace. Edit start or duration in place; cascade on submit.

**Leftover:** stored leftover rows, then unplaced `today` tasks (labeled as tasks). Title, done, Place. Place asks start + duration (defaults: decision 15). Add-ad-hoc field at the bottom of leftover.

No streaks, no week grid, no year switcher, no Act brief or agent dispatch.

Chrome: three panes unchanged. Domain switcher does not filter this page.

---

## 6. Errors

- Unreadable / missing map: same alert as Architecture and Act. Do not show an empty fake clock.
- `ensureLiveDay` / command failure: keep the previous view; surface the error.
- Completing a task-linked row whose task is gone: mark the live item `done`; no throw.
- Dangling `dayTypeId` after type delete: picker shows the missing id; leftover template rows stay until the operator picks another type.

---

## 7. Tests

**vault-core**

- `ensureLiveDay` copies the weekday type; second call is a no-op.
- No type for that weekday → empty leftover, `dayTypeId: null`.
- `setLiveDayType` replaces template leftover only.
- Place leftover / place `today` task; unplace returns correctly.
- Cascade pushes later overlaps; shortening does not pull forward.
- Leftover task union omits tasks already on the clock and omits non-`today` columns.
- `completeLiveBlock` on a task source sets the task to `done`.

**desktop**

- `/daily` owns Execute; `/review/daily` still owns Review.
- Rail order Daily Schedule then Act; `WING_DEFAULTS.execute === "/daily"`.

Full gate: `npm test` and `npm run typecheck` in `apps/desktop`; `npm test` in `packages/vault-core`.

---

## 8. Architecture sketch

```
┌──────────────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal                  (drag)     │ [_] □ X  │
├──────┬───────────────────────────────────────────┼──────────┤
│ Nav  │ Home | Vision | Plan | Execute | Review   │  Chat    │
│ Exec │ Daily Schedule                            │          │
│ Sched│ 2026-09-15    Type: [Deep work        ▾]  │          │
│ Act  │ Clock                                     │          │
│      │ 09:00–10:30  Write  [60m]  [done] [↩]     │          │
│      │ 10:30–11:00  Call   [30m]                 │          │
│      │ Leftover                                  │          │
│      │ Stretch           [done] [Place]          │          │
│      │ Task · Inbox zero        [Place]          │          │
└──────┴───────────────────────────────────────────┴──────────┘
```
