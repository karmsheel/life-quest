# Review Wing — Design Spec

**Date:** 2026-09-12  
**Status:** Approved — placeholders shipped. Page body superseded by [Reviews](./2026-09-21-reviews-design.md). Wing tabs, rails, routes, and session rules in this spec remain in force.  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md), [Home wing](./2026-09-02-home-wing-design.md)

Supersedes locked decision 1 of the Home-wing spec (wings are **Home · Vision · Plan · Execute**) for the following only: a fifth **Review** wing sits right of Execute. Home, Vision, Plan, and Execute rails, defaults, and routes stay as they are in the running app.

Everything else in the wings specs remains in force: in-memory session, existing routes, pinned Life-Chain / Decisions / Log, domain switcher as the data filter, no `?wing=` query, no last-used persistence.

---

## 1. Purpose

The studio already splits orientation, direction, planning, and doing across **Home · Vision · Plan · Execute**. There is no place to look back. This spec adds a **Review** wing with five cadence pages so the operator can open a review session later. This change ships placeholders only.

### Success criteria

- TopBar tabs are **Home | Vision | Plan | Execute | Review**, same segmented tablist as today.
- Review’s rail is Daily, Weekly, Monthly, Quarterly, Yearly (that order).
- Home, Vision, Plan, and Execute rails are unchanged.
- Each Review page is the existing stub: title `{Cadence} Review` and “Coming soon.”
- Clicking Review goes to that tab’s last page this session, or Daily (`/review/daily`).
- Opening a Review path selects Review. Life-Chain, Decisions, Log, and Settings do not change the wing.
- `npm test` and `npm run typecheck` in `apps/desktop` still pass.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Wings | **Home · Vision · Plan · Execute · Review.** Fixed. Review is rightmost. |
| 2 | Review rail | **Daily, Weekly, Monthly, Quarterly, Yearly.** |
| 3 | Other rails | Unchanged. Home: Dashboard, Personnel. Vision: Dream, Documents. Plan: Goals, Life Map, Architecture. Execute: Act. |
| 4 | Routes | `/review/daily`, `/review/weekly`, `/review/monthly`, `/review/quarterly`, `/review/yearly`. No `/review` hub. No `/daily`. |
| 5 | Page copy | Rail label is the cadence (`Daily`). Page title is `{Cadence} Review` (`Daily Review`). |
| 6 | Page body | Existing `StubPage`: title + “Coming soon.” No session UI, no vault writes. |
| 7 | Defaults | Home → `/home`. Vision → `/dream`. Plan → `/goals`. Execute → `/act`. Review → `/review/daily`. |
| 8 | Tab click | Sets the active wing and navigates to that wing’s last path, or its default. |
| 9 | Path ownership | Each of the five Review paths owns Review. Unknown `/review/…` is not Review-owned. |
| 10 | Session | Unchanged: in-memory React context. Dies on quit. |
| 11 | Pinned | Life-Chain, Decisions (top); Log (bottom); theme + Settings footer. They do not change the active wing. They do update `lastPath` for the current wing. |
| 12 | Data filter | None. Domain switcher stays the data filter. `LAWS/WINGS.md` unchanged. |
| 13 | Tab UI | Existing `.ui-segmented` tablist. Arrow keys move and activate across all five tabs. |
| 14 | Welcome | No shell, so no tabs. |
| 15 | Cold start | Unchanged: `/` → `/home` (Home). A leftover hash to a Review path selects Review. |

A page belongs to at most one wing, except pinned pages, which belong to none.

### Rail assignment (Review only)

| Wing | Pages (rail order) |
|------|--------------------|
| Review | Daily, Weekly, Monthly, Quarterly, Yearly |

### Explicitly out of scope

- Running a review session, prompt, or checklist
- Writing review notes or history into the vault
- A Review hub, inner cadence tabs, or `/review` index
- Filtering Home, Life Map, Log, tasks, or any other surface by wing
- Encoding the wing in the URL (`?wing=`)
- Persisting last-used to disk or the vault
- Moving or renaming Home / Vision / Plan / Execute pages
- Changing domain switcher, chat, theme, Settings, or room-lock rules

---

## 3. Architecture

Chosen: **extend the existing wing module**. Rejected a Review hub, inner page tabs, and flat `/daily` routes (those collide with Execute’s future Daily Schedule).

```
┌──────────────────────────────────────────────────┬──────────┐
│ LifeQuest — Personal                  (drag)     │ [_] □ X  │
├──────┬───────────────────────────────────────────┼──────────┤
│ Nav  │ Home | Vision | Plan | Execute | Review   │  Chat    │
│ Review│ Daily Review — Coming soon.              │          │
│ +pin │                                           │          │
└──────┴───────────────────────────────────────────┴──────────┘
```

### 3.1 Pure module (`wing.ts`)

```ts
export type WingId = "home" | "vision" | "plan" | "execute" | "review";

export const WING_IDS: WingId[] = [
  "home",
  "vision",
  "plan",
  "execute",
  "review",
];

export const WING_LABELS: Record<WingId, string> = {
  home: "Home",
  vision: "Vision",
  plan: "Plan",
  execute: "Execute",
  review: "Review",
};

export const WING_DEFAULTS: Record<WingId, string> = {
  home: "/home",
  vision: "/dream",
  plan: "/goals",
  execute: "/act",
  review: "/review/daily",
};
```

Path ownership (additions only):

| Path | Wing |
|------|------|
| `/review/daily` | review |
| `/review/weekly` | review |
| `/review/monthly` | review |
| `/review/quarterly` | review |
| `/review/yearly` | review |

Exact paths only. Do **not** treat every `/review/…` prefix as Review-owned. `/review`, `/review/daily/extra`, and `/daily` return `null` from `wingForPath` and do not move the wing.

`initialWingSession()`: `active: "home"`, `lastPath` copied from `WING_DEFAULTS` (five keys).

`applyPath` / `selectWing` / `isPinnedPath` keep today’s rules. The only behavior change is the fifth wing in the tables.

`WingTabs` already maps `WING_IDS`; five tabs fall out of the array. No new tab component.

### 3.2 Nav items

`nav-items.ts` — append five items tagged `wing: "review"`, after Act, before Log:

| id | href | label | icon |
|----|------|-------|------|
| `daily` | `/review/daily` | Daily | `Calendar` |
| `weekly` | `/review/weekly` | Weekly | `CalendarDays` |
| `monthly` | `/review/monthly` | Monthly | `CalendarRange` |
| `quarterly` | `/review/quarterly` | Quarterly | `CalendarClock` |
| `yearly` | `/review/yearly` | Yearly | `CalendarCheck` |

Icons are Lucide. `NAV_ITEMS` `wing` tags must match the ownership table in `wing.ts`.

### 3.3 Routes and pages

`App.tsx` nested under `AppShell`:

```tsx
<Route path="/review/daily" element={<StubPage title="Daily Review" />} />
<Route path="/review/weekly" element={<StubPage title="Weekly Review" />} />
<Route path="/review/monthly" element={<StubPage title="Monthly Review" />} />
<Route path="/review/quarterly" element={<StubPage title="Quarterly Review" />} />
<Route path="/review/yearly" element={<StubPage title="Yearly Review" />} />
```

Reuse `apps/desktop/src/pages/StubPage.tsx`. Do not add a Review page component. Import `StubPage` in `App.tsx`.

Unknown hashes, including `/review` and `/review/nope`, still hit the existing `*` → `/home` redirect and do not select Review (`wingForPath` is `null` before the redirect; after redirect, Home is selected).

### 3.4 React wiring

Unchanged: `WingProvider` in `AppShell`, pathname → `applyPath`, tab click → `selectWing` + `navigate`. `NavRail` still filters `item.wing === active`.

Welcome still has no tabs. Cold start still lands on Home → Dashboard.

### 3.5 Error handling

No new user-facing errors. Stale `lastPath` falls back to that wing’s default. Unknown routes do not move the wing. A leftover hash `/review/weekly` selects Review and records that path.

---

## 4. Components

| Unit | Responsibility |
|------|----------------|
| `wing.ts` | Add `review`; defaults and five Review paths |
| `nav-items.ts` | Five Review rail items |
| `WingTabs` | Renders five tabs from `WING_IDS` (no structural change) |
| `NavRail` | Unchanged filter |
| `App.tsx` | Five `StubPage` routes |
| `StubPage.tsx` | Unchanged placeholder |

Each unit is understandable from its exports. Tests import `wing.ts` and `nav-items.ts`.

---

## 5. Testing

Update `apps/desktop/tests/wing.test.ts` and `wing-shell.test.ts`. No new E2E.

Cases that must change or be added:

- `initialWingSession` is Home with five defaults, including `review: "/review/daily"`.
- `WING_IDS` is `["home", "vision", "plan", "execute", "review"]`.
- `wingForPath("/review/daily")` (and the other four cadences) → `review`.
- `wingForPath("/review")`, `"/review/nope"`, `"/daily"` → `null`.
- `applyPath` on `/review/weekly` selects Review and records it.
- `applyPath` on `/log` while Review is active keeps Review and sets `lastPath.review` to `/log`.
- `selectWing("review")` from a fresh session navigates to `/review/daily`.
- `selectWing("review")` after Weekly then Plan returns `/review/weekly`.
- `selectWing` with a last path that is not a Review or pinned path falls back to `/review/daily`.
- `NAV_ITEMS` Review tags: `["daily", "weekly", "monthly", "quarterly", "yearly"]`. Other wings unchanged. Life-Chain and Decisions stay `pin: "top"`; Log stays `pin: "bottom"`.
- `App.tsx` nested routes include the five `/review/…` paths.

Manual check: five tabs, Review last; Review rail is the five cadences; Daily stub title is “Daily Review”; Log does not steal the wing; quit/reopen still lands on Dashboard.

`npm test` and `npm run typecheck` in `apps/desktop` must pass.

---

## 6. Files to touch

| File | Change |
|------|--------|
| `apps/desktop/src/components/shell/wing.ts` | `WingId`, ids, labels, defaults, `PATH_WING` |
| `apps/desktop/src/components/shell/nav-items.ts` | Five Review items + Calendar icons |
| `apps/desktop/src/App.tsx` | Import `StubPage`; five routes |
| `apps/desktop/tests/wing.test.ts` | Session and nav assertions |
| `apps/desktop/tests/wing-shell.test.ts` | Nested `/review/…` routes under `AppShell` |
