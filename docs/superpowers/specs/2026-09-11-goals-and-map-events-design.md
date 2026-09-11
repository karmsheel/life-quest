# Goals Page and Life Map Events — Design Spec

**Date:** 2026-09-11  
**Status:** Approved — awaiting implementation plan  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Life Map on Chart](./2026-08-27-life-map-chart-design.md), [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md), [Home wing](./2026-09-02-home-wing-design.md), [Overview Domain Lens](./2026-08-31-overview-domain-lens-design.md)

Supersedes:

- Life Map spec: period goals (Keys) as colored date ranges; “per-domain calendars or domain-tagged Keys” out of merge; Life Map unfiltered because map data had no domain tags.
- Domain lens spec locked decision 16 (*Life Map unfiltered this spec*).
- Wings / Home wing: Plan rail is only Life Map + Architecture; Plan default is `/chart`.
- Task `links.periodGoalId` (Act board picker against year Keys).

Period goals are **discarded**. They are not migrated into Goals or events.

---

## 1. Purpose

Plan currently shows outcomes only as **period goals** painted onto the Life Map year. That mixes “what I want” with “when something happens.”

Goals become a **vault-wide outcome list** with their own page and file, sitting **above** Life Map in Plan. Life Map adding is **events / deadlines**: a single date, notes, a domain picker, and an optional link to a Goal. Tasks may link to a Goal.

### Success criteria

- Plan rail is **Goals → Life Map → Architecture**. Plan default is `/goals`; session memory of the last Plan page is unchanged.
- Goals live in `.lifequest/goals.json`, not in `map.json`.
- Life Map no longer creates or shows period goals. Click-drag range paint is gone.
- Life Map creates **single-date events** with title, date, optional domain, notes, optional Goal link.
- Domain lens filters Goals and event marks; the year/month canvas itself stays one calendar.
- Act’s task picker links to Goals (`goalId`). Old `periodGoalId` values are dropped.
- Existing `periodGoals` in `map.json` are stripped on load and never written back.
- `npm test` in `packages/vault-core` and `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Goal meaning | **Outcome.** Name, notes, status, optional domain. No date. |
| 2 | Event meaning | **Single-date** deadline/event on a year. Title, date, notes, optional domain, optional `goalId`. |
| 3 | Goal scope | **Vault-wide.** Not year-scoped. Dates live only on events. |
| 4 | Goal domain | **Optional.** `null` = unassigned (Overview-only). |
| 5 | Goal status | `open` \| `done`. |
| 6 | Event domain | **Optional.** Same `null` = unassigned. Picker lists live domains + Unassigned. |
| 7 | Event color | From the domain’s `DomainMeta.color`. Unassigned, missing domain, or `color: null` → one default mark token. No event swatch. |
| 8 | Event ↔ Goal | Optional. Dangling `goalId` after Goal delete is kept and labeled “missing”. |
| 9 | Task ↔ Goal | Optional `links.goalId`. Replaces `periodGoalId`. |
| 10 | Old Keys | **Discard.** No Goal, no event, no date guess. |
| 11 | Storage | Goals: `.lifequest/goals.json`. Events: replace `periodGoals` on each `YearRecord` in `map.json`. |
| 12 | Schema | **No bump.** `schemaVersion` stays `1`. |
| 13 | Plan rail | Goals, Life Map, Architecture (that order). |
| 14 | Route | `/goals`. Life Map stays `/chart`. No nested `/plan/…`. |
| 15 | Plan default | `WING_DEFAULTS.plan` = `/goals`. Session last-path memory unchanged. |
| 16 | Room id | **None.** Do not add `goals` to `ROOM_IDS`. Page is always in the rail. |
| 17 | Domain lens | Overview = all + unassigned. Domain tab = that slug only. Unassigned hidden in a domain tab. |
| 18 | Life Map canvas | Year grids, month text, objectives, notes: **unfiltered**. Event marks and the Events panel: **filtered**. |
| 19 | Apply paths | `goalsApply` writes `goals.json`. `mapApply` writes events in `map.json`. One vault queue; one file per command. |
| 20 | Agent lock | Same as map writes today. Do **not** add a new lock field; `StoreState` has none. |
| 21 | Archive years | Events read-only, same as today’s map. Goals are not year-bound; still editable. |
| 22 | Name uniqueness | Not required. |
| 23 | Several events on one day | Allowed. |
| 24 | Reorder Goals | **Out.** Array order = insertion order. New goals append. |
| 25 | Click-through Goal → Map | **Out.** Count of linked events may show; no year jump. |
| 26 | Archive web-skeleton | **Not** updated. |

### Explicitly out of scope

- Migrating old Keys to Goals or events
- Event times of day, recurrence, or date ranges
- Click-through from a Goal row to Life Map
- Filtering the year grid cells themselves (only event marks)
- Goals as markdown files
- Schema version bump
- Goal reorder / ranking
- Per-domain calendars

---

## 3. Information architecture

```
Plan rail:  Goals (/goals)  →  Life Map (/chart)  →  Architecture (/track)
Plan tab:   last Plan path this session, else /goals
```

Wings still do not filter data. The domain switcher is the data filter for Goals and for **events**. `LAWS/DOMAIN-FILTER.md` applies to those lists.

| Surface | Overview | A domain tab |
|---------|----------|----------------|
| Goals list | All goals, including unassigned | Only `domainSlug === lens` |
| Life Map events (panel + marks) | All events, including unassigned | Only that domain |
| Life Map year / months / day text | Unfiltered | Unfiltered |
| Unassigned goals / events | Visible | Hidden |

Unknown or archived `domainSlug` on a stored Goal or event is treated as **unassigned** for lens and color.

New Goal / Event: domain defaults to the current lens, or unassigned in Overview. The user can clear it to Unassigned.

---

## 4. Data model

### 4.1 Goals file

Path: `.lifequest/goals.json`

```ts
type GoalStatus = "open" | "done";

type Goal = {
  id: string;
  name: string;
  notes: string;
  status: GoalStatus;
  domainSlug: string | null;
};

type GoalsFile = { goals: Goal[] };
```

- Missing file ⇒ empty list. Do **not** write until the first successful `goalsApply` (create vault may omit the file).
- Extra JSON keys ignored.
- Invalid JSON or invalid shape ⇒ `goalsError`, empty list in the snapshot, **do not overwrite** the bad file.

### 4.2 Events on the year

`YearRecord.periodGoals` is removed. Replaced by:

```ts
type MapEvent = {
  id: string;
  title: string;
  date: IsoDate;         // YYYY-MM-DD, must fall in YearRecord.year
  notes: string;
  domainSlug: string | null;
  goalId: string | null;
};
```

`YearRecord.events: MapEvent[]`.

Load of `map.json`: if `periodGoals` is present, drop it. If `events` is missing, use `[]`. Never persist `periodGoals`.

`yearHasContent` counts events (and the existing month/week checks), not period goals.

Queries: `eventsOnDate(year, date)`, `eventsInMonth(year, month)` replace `periodGoalsOnDate` / `periodGoalsOverlappingMonth`. Dashboard day marks use domain colors of **visible** events (after lens), not range bands.

### 4.3 Tasks

```ts
type TaskLinks = {
  goalId?: string;
  date?: IsoDate;
  weekItem?: { year: number; monday: IsoDate; itemId: string };
};
```

Load: if `periodGoalId` is present, omit it. Do not map it to `goalId`.

### 4.4 Soft vs hard integrity

| Situation | Behavior |
|-----------|----------|
| `domainSlug` set to a new non-null slug that is not a live domain | `MALFORMED` |
| `domainSlug` unknown/archived on **read** | Treat as unassigned. Updates that omit `domainSlug` preserve the stored value. |
| `goalId` set to a new non-null id whose Goal is missing | `NOT_FOUND` |
| `goalId` already stored, Goal later deleted | Keep id; UI label “missing”. Updates that omit `goalId` preserve it. |
| Delete Goal | Leave event/task `goalId`s dangling |
| Delete year | Events on that year go with it |

---

## 5. Commands

### 5.1 Goals (`goalsApply`)

```ts
type GoalsCommand =
  | { type: "createGoal"; name: string; notes?: string; domainSlug?: string | null }
  | { type: "updateGoal"; id: string; name?: string; notes?: string; status?: GoalStatus; domainSlug?: string | null }
  | { type: "deleteGoal"; id: string };
```

Create: `status` is always `open`. `name` trimmed, non-empty. `notes` default `""`. `domainSlug` default `null`. `id` from apply context.

### 5.2 Map events (`mapApply`)

Remove `createPeriodGoal` / `updatePeriodGoal` / `deletePeriodGoal`.

```ts
| { type: "createEvent"; year: number; title: string; date: IsoDate; notes?: string; domainSlug?: string | null; goalId?: string | null }
| { type: "updateEvent"; year: number; id: string; title?: string; date?: IsoDate; notes?: string; domainSlug?: string | null; goalId?: string | null }
| { type: "deleteEvent"; year: number; id: string }
```

Date must be in `year`. Title trimmed, non-empty. Clearing `goalId` / `domainSlug` uses `null`.

### 5.3 Validation

| Rule | Code |
|------|------|
| Empty Goal name / event title after trim | `MALFORMED` |
| Event date not ISO or outside its year | `INVALID_RANGE` |
| Unknown Goal / event id | `NOT_FOUND` |
| Archive year (event commands) | `ARCHIVE_READ_ONLY` |
| Create/update sets a **new** non-null `domainSlug` that is not a live domain | `MALFORMED` |
| Create/update sets a **new** non-null `goalId` whose Goal is missing | `NOT_FOUND` |

Failed apply: no file write, no log line.

---

## 6. Page surfaces

### 6.1 Goals (`/goals`)

List for the current lens: name, status, domain label or “Unassigned”, truncated notes. Optional count of events (all years) whose `goalId` matches.

Filter: **Open** (default) / Done / All.

**Add:** name (required), notes, optional domain (default = lens), status open.

**Edit:** same fields plus Open/Done. **Delete:** confirm.

Empty Overview: “No goals yet.” Empty domain tab: “No goals in {domain}.”

`goalsError`: show the error; do not offer Add that would clobber the file.

### 6.2 Life Map dashboard

Key panel becomes **Events** for the selected year, lens-filtered, sorted by date then title.

- Heading: `{year} Events`. Button: **Add event**.
- Form: title, date (`type="date"`, min/max that year), notes, domain picker (live domains + Unassigned), Goal picker (**vault-wide open Goals**, not lens-filtered, plus the current linked Goal if it is done or missing).
- Click a day (not drag) opens the add form with that date filled.
- Click-drag range paint is **removed**.
- Day cells: domain-colored marks for visible events on that date. No range highlight.
- Archive: read-only list; no add.

### 6.3 Month page

“Period goals” section becomes **Events** this month (lens-filtered). Day cells may show the same marks. Main Objectives and Notes unchanged.

### 6.4 Act task board

Period-goal picker → Goal picker: vault-wide open Goals (and current dangling/done link). Labels use Goal name. Missing link still shows as missing, does not crash.

### 6.5 Domain pickers

Live domains by `sortOrder`, plus Unassigned. Never list Overview as a stored slug. Never list archived domains. Composer default: current lens, or Unassigned in Overview.

---

## 7. Architecture and data flow

```
Goals:  renderer → IPC goals:apply → applyGoalsCommand → goals.json → log
Events: renderer → IPC map:apply   → applyCommand      → map.json  → log
Lens:   renderer-only filter; IPC does not take a domain
```

### 7.1 Snapshot

`VaultSnapshot` gains `goals: Goal[]` and `goalsError: string | null`. `map` years expose `events`, not `periodGoals`.

Open vault / create vault / refresh load both files. Create vault does not need to write `goals.json` (missing = empty).

### 7.2 Queue

Electron vault queue already serializes work. `goalsApply` and `mapApply` both enqueue. One command writes one file.

No new agent lock. Goal writes follow the same actor rules as map writes in this repo today (no `locked` field on `StoreState`).

### 7.3 Life log

Append only after a successful persist. `domainSlug` on the log event is the record’s slug or `null`.

| Type | When |
|------|------|
| `goal.created` / `goal.updated` / `goal.deleted` | Goals CRUD |
| `map.event.created` / `updated` / `deleted` | Events CRUD |

Task `goalId` changes stay `map.task.updated` (no extra line). Drop `map.period_goal.*`.

Payload: ids, short title/name, year/date for events — not a copy of the files.

### 7.4 File watch

Watch `.lifequest/goals.json` with `map.json` / `about.md` (focus/mtime reload prompt).

### 7.5 Modules (vault-core)

| Unit | Job |
|------|-----|
| `src/goals.ts` (or `src/goals/*`) | Types, apply, persist, empty seed |
| `src/map/events.ts` | Replace `period-goals.ts` |
| `src/map/types.ts` | `MapEvent`, drop `PeriodGoal` from `YearRecord` |
| `src/map/queries.ts` | Date/month event queries |
| `src/map/tools.ts` | Event + task `goalId` tools; no period-goal tools |
| Goal MCP tools | `create_goal` / `update_goal` / `delete_goal` / `list_goals` (or equivalent names) |

Pure lens helper in vault-core (no React): given items with `domainSlug` and lens `string | null` (null = Overview), return the visible subset. Unknown slugs count as unassigned.

### 7.6 Desktop

| Unit | Job |
|------|-----|
| `pages/GoalsPage.tsx` | Plan Goals surface |
| `components/map/EventPanel.tsx` | Replaces `KeyPanel.tsx` |
| `components/map/Dashboard.tsx` | Click-to-add event; marks; no drag paint |
| `components/map/MonthPage.tsx` | Events this month |
| `components/tasks/TaskBoard.tsx` | Goal picker |
| `nav-items.ts` / `wing.ts` | Goals first in Plan; default `/goals` |
| `App.tsx` | Route `/goals` |
| IPC + preload | `goalsApply` |

---

## 8. Agents and MCP

Remove tools: `create_period_goal`, `update_period_goal`, `delete_period_goal`.

Add:

- Goal tools against `goals.json` (list/create/update/delete).
- Event tools against the map (`create_event`, `update_event`, `delete_event`) with `year`, title, date, optional domain, optional `goalId`.

`get_state` (map) returns `events` on years, not `periodGoals`. Task tool `periodGoalId` parameter becomes `goalId`.

No extra agent lock beyond whatever map apply already does.

---

## 9. Error handling (UI)

- `goalsError` / `mapError`: alert on the affected page; other rooms still work.
- Command fail: keep the form; surface `error.message`.
- Missing Goal on a picker: extra option “{id} (missing)” so a save without touching the picker does not have to clear it; changing the picker to a real Goal or Unassigned/none is an explicit edit.

---

## 10. Testing

### vault-core

- Goals: create/update/delete; empty name; optional domain; reject non-live domain; missing file ⇒ `[]`; malformed file ⇒ error, no clobber.
- Events: single date in year; optional domain/goal; reject archive, bad date, empty title; reject unknown `goalId` on write.
- Load strips `periodGoals`; tasks drop `periodGoalId`.
- Queries: events on a date / in a month.
- Lens helper: Overview vs domain vs unassigned; unknown slug as unassigned.
- Tool defs: no period-goal tools; goal + event tools present; task links use `goalId`.

### desktop

- `wingForPath("/goals")` → `plan`; `WING_DEFAULTS.plan` → `/goals`; `selectWing("plan")` still honors session last path.
- `NAV_ITEMS` Plan order: Goals, Life Map, Architecture.
- Dashboard: add event, not period goal; no drag-range create.
- Task board: Goal picker.

`npm test` in both packages and `npm run typecheck` in `apps/desktop` pass.

---

## 11. Rollout notes

Older vaults: first open after this change loads Goals as empty (no file). Map load drops `periodGoals` and treats `events` as `[]`. If `ensureMapOnOpen` already persists when the in-memory map differs from disk, that first open **writes** the stripped file — that is the discard (locked decision 10). Users who had Keys see a clean calendar.
