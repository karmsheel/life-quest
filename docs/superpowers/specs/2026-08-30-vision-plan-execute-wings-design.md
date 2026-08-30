# Vision / Plan / Execute Wings — Design Spec

**Date:** 2026-08-30  
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-08-30-vision-plan-execute-wings.md`)  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Custom window chrome](./2026-08-28-custom-window-chrome-design.md), [Life Map on Chart](./2026-08-27-life-map-chart-design.md)

Supersedes locked decision 16 of the window-chrome spec (*TopBar unchanged: vault name + domain switcher stay*) for the vault-name slot only. The titlebar, domain switcher, and agent lock are unchanged.

---

## 1. Purpose

The desktop shell currently lists every page in one left rail and shows the vault name (often **Personal**) in the TopBar under the window titlebar. That flattens three different kinds of work — direction, planning, and doing — into one list.

This spec adds three **fixed app wings** — **Vision**, **Plan**, **Execute** — as tabs in that TopBar slot. A wing filters the left rail and remembers the last page visited in that wing for the rest of the session. It does **not** filter Home, Life Map, Log, or any other page’s data. The existing domain switcher remains the data filter.

### Success criteria

- TopBar no longer shows the vault name. Three tabs sit in that left slot: Vision, Plan, Execute.
- Window titlebar still shows `LifeQuest` or `LifeQuest — {vault name}`.
- The left rail shows only the active wing’s pages, plus pinned Decisions, Log, theme, and Settings.
- Clicking a tab goes to that tab’s last page this session, or its default.
- Opening a wing-owned page selects that wing. Log, Decisions, and Settings never change the wing.
- Next cold start of the app lands on Vision → Home (`/` → `/home`). Last-used is memory-only.
- Domain switcher, agent lock, chat, themes, and room-lock rules are unchanged.
- `npm test` and `npm run typecheck` in `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Wings | **Vision · Plan · Execute.** Fixed. Not user-editable. |
| 2 | Placement | **TopBar left slot**, replacing the vault name. Not the window titlebar. |
| 3 | Data filter | **None.** Wings do not scope Home, Map, Log, tasks, or any list. Domain switcher stays the data filter. |
| 4 | Routing | **Keep existing routes** (`/home`, `/chart`, `/act`, …). No nested `/vision/…` URLs. No `?wing=` query. |
| 5 | State | **In-memory session.** React context. Dies on quit. Not written to the vault or `localStorage`. |
| 6 | Tab click | Sets the active wing and **navigates** to that wing’s last path, or its default. |
| 7 | Wing-owned navigation | Navigating to a wing-owned path **selects that wing** and records `lastPath`. In-app links included. |
| 8 | Pinned navigation | `/log`, `/decisions`, `/settings` **do not** change the active wing. They **do** update `lastPath` for the current wing. |
| 9 | Defaults | Vision → `/home`. Plan → `/chart` (Life Map). Execute → `/act`. |
| 10 | Cold start | App default remains `/` → `/home` (Vision). If the renderer loads with a leftover hash to a wing-owned path, **that path wins** and selects its wing. |
| 11 | Unknown last path | Fall back to that wing’s default. |
| 12 | Unknown current path | Do not change the active wing. |
| 13 | Pinned rail | **Decisions, Log**, then existing theme + Settings footer, on **every** wing. |
| 14 | Settings / theme | Stay in the rail footer. Not listed as wing items. Settings does not change the wing. |
| 15 | Brand mark | LifeQuest logo still links to `/home`, which selects Vision via rule 7. |
| 16 | Tab UI | Existing `.ui-segmented` look. Semantics are a **tablist**, not radios. Left/right arrows move and activate. |
| 17 | Welcome | No shell, so no tabs. |
| 18 | Room locks | Unchanged. Locked rooms still appear in their wing with the lock icon. |
| 19 | Persistence of last path | **This session only.** |

### Rail assignment

| Wing | Pages (rail order) |
|------|--------------------|
| Vision | Home, Dream, Domains, Chain, Documents, Personnel |
| Plan | Life Map, Architecture |
| Execute | Act |
| Every wing (pinned, below a divider) | Decisions, Log |
| Every wing (footer) | Theme toggle, Settings |

A page belongs to at most one wing, except pinned pages, which belong to none.

### Explicitly out of scope

- Filtering Home, Life Map, Log, tasks, or any other surface by wing
- Encoding the wing in the URL
- Persisting last-used to disk or the vault
- Retitling the window titlebar
- Moving Domain switcher or agent lock
- Changing room unlock rules
- Assigning Settings or theme to a wing
- Putting a page in more than one wing

---

## 3. Architecture

Chosen: **shell state** (in-memory context + tagged nav items). Rejected nested URLs and a `?wing=` query.

```
┌──────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal          (drag)     │ [_] □ X  │  titlebar (unchanged)
├──────┬───────────────────────────────────┼──────────┤
│ Nav  │ Vision | Plan | Execute   Domain 🔒│  Chat    │  TopBar
│ wing │ page content                       │          │
│ +pin │                                    │          │
└──────┴────────────────────────────────────┴──────────┘
```

### 3.1 Pure module

`apps/desktop/src/components/shell/wing.ts` holds types and session transitions. No React. `node:test` covers it.

```ts
export type WingId = "vision" | "plan" | "execute";

export const WING_DEFAULTS: Record<WingId, string> = {
  vision: "/home",
  plan: "/chart",
  execute: "/act",
};

export type WingSession = {
  active: WingId;
  lastPath: Record<WingId, string>;
};

export function initialWingSession(): WingSession;
export function wingForPath(pathname: string): WingId | null;
export function isPinnedPath(pathname: string): boolean;
export function applyPath(session: WingSession, pathname: string): WingSession;
export function selectWing(
  session: WingSession,
  wing: WingId,
): { session: WingSession; pathname: string };
```

`wingForPath` returns the owning wing for a wing-owned path, or `null` for pinned and unknown paths.

Pinned paths: `/log`, `/decisions`, `/settings`. Match `location.pathname` (HashRouter, no hash in the pathname).

`applyPath`:

- If `wingForPath(pathname)` is a wing: set `active` to it and `lastPath[wing] = pathname`.
- If pinned: keep `active`, set `lastPath[active] = pathname`.
- If unknown: return `session` unchanged.

`selectWing`: set `active` to `wing`. Path to navigate is `lastPath[wing]` if it is still a known path for that wing **or** a pinned path; otherwise `WING_DEFAULTS[wing]`.

A **known path** is any `href` on a nav item (including pinned Decisions/Log) plus `/settings` and the three defaults. Path ownership and the known-path set live in `wing.ts` so it does not import `nav-items.ts`. The `wing` tags on `NAV_ITEMS` must match that table.

### 3.2 Nav items

`apps/desktop/src/components/shell/nav-items.ts`: add optional `wing?: WingId`.

- Home, Dream, Domains, Chain, Documents, Personnel → `vision` (that order).
- Life Map (`/chart`), Architecture (`/track`) → `plan`.
- Act → `execute`.
- Decisions, Log → omit `wing` (pinned). Keep `section: "governance"` so the rail divider stays.

Settings is not a `NAV_ITEMS` entry.

`NavRail` renders:

1. Brand (unchanged).
2. Items with `item.wing === active`.
3. Divider.
4. Items with no `wing` (Decisions, Log).
5. Divider.
6. Existing theme + Settings footer.

### 3.3 React wiring

`WingProvider` lives in `AppShell` (already under `HashRouter`). It:

- Holds `WingSession` in `useState`, seeded by `initialWingSession()`.
- On `location.pathname` change, `setSession(s => applyPath(s, pathname))`.
- On first mount, if the current path is wing-owned, `applyPath` selects that wing (leftover hash).
- `selectWing` calls `navigate(pathname)` with the path returned by the pure helper.

`TopBar` drops `top-bar__vault-name`. New `WingTabs` in that slot: three tabs, `role="tablist"` / `role="tab"`, `aria-label="App wing"`, existing `.ui-segmented` classes, arrow keys move and activate. Domain switcher and agent lock stay in `top-bar__controls`.

Welcome and the loading screen do not mount `AppShell`.

### 3.4 Error handling

No new user-facing errors. Stale `lastPath` values fall back to the wing default. Unknown routes do not move the wing. Room-lock gates on Dream / Life Map / Architecture / Act are unchanged.

---

## 4. Components

| Unit | Responsibility |
|------|----------------|
| `wing.ts` | Types, path ownership, session transitions |
| `nav-items.ts` | `wing` tags and Vision rail order |
| `WingProvider` | Session state, sync from `location`, `selectWing` + `navigate` |
| `WingTabs` | Tablist UI in TopBar |
| `TopBar` | Tabs left; domain + lock right; no vault name |
| `NavRail` | Filter by `active` wing; pinned + footer unchanged |

Each unit is understandable from its exports. The provider is the only consumer of `navigate`. Tests import `wing.ts` and `nav-items.ts`.

---

## 5. Testing

New file: `apps/desktop/tests/wing.test.ts` (`node:assert/strict`, `node:test`).

Cases:

- `initialWingSession` is Vision with the three defaults.
- `wingForPath("/home")` → `vision`; `"/chart"` / `"/track"` → `plan`; `"/act"` → `execute`; `"/log"` / `"/decisions"` / `"/settings"` / `"/unknown"` → `null`.
- `applyPath` on `/chart` selects Plan and records it.
- `applyPath` on `/log` while Vision is active keeps Vision and sets `lastPath.vision` to `/log`.
- `selectWing(plan)` after that still navigates to `/chart`.
- `selectWing(vision)` after Log then Plan returns `/log`.
- `selectWing` with a last path that is not known falls back to the default.
- `NAV_ITEMS` tags match the rail assignment: six Vision pages, two Plan, one Execute; Decisions and Log have no `wing`.

No new Electron E2E. Manual check in the running app: tabs replace the vault name; rails filter; Log does not steal the wing; quit/reopen lands on Home.

`npm test` and `npm run typecheck` in `apps/desktop` must pass.

---

## 6. Files to touch

| File | Change |
|------|--------|
| `apps/desktop/src/components/shell/wing.ts` | **Create** — pure session module |
| `apps/desktop/src/components/shell/WingProvider.tsx` | **Create** — context |
| `apps/desktop/src/components/shell/WingTabs.tsx` | **Create** — tablist |
| `apps/desktop/src/components/shell/nav-items.ts` | Add `wing`, reorder Vision items |
| `apps/desktop/src/components/shell/NavRail.tsx` | Filter by active wing |
| `apps/desktop/src/components/shell/TopBar.tsx` | Replace vault name with `WingTabs` |
| `apps/desktop/src/components/shell/AppShell.tsx` | Mount `WingProvider` |
| `apps/desktop/src/styles/global.css` | Drop unused `.top-bar__vault-name` if nothing else uses it |
| `apps/desktop/tests/wing.test.ts` | **Create** — session tests |
