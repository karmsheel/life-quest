# Home Wing — Design Spec

**Date:** 2026-09-02  
**Status:** Draft — awaiting review  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Vision / Plan / Execute wings](./2026-08-30-vision-plan-execute-wings-design.md)

Supersedes locked decisions 1, 9, 10, and 15 of the wings spec, and that spec’s Vision rail assignment, for the following only: a fourth **Home** wing sits left of Vision; Dashboard (formerly the Home page), Life-Chain (formerly Chain), and Personnel move onto it; cold start lands on Home → Dashboard; the brand mark still links to `/home`, which now selects Home.

Everything else in the wings spec remains in force: in-memory session, existing routes, pinned Decisions / Log, domain switcher as the data filter, no nested URLs, no last-used persistence.

---

## 1. Purpose

Vision currently mixes orientation (Dashboard, Life-Chain, Personnel) with doctrine work (Dream, Documents). The user wants a **Home** tab for the daily overview and people, left of Vision / Plan / Execute.

### Success criteria

- TopBar tabs are **Home | Vision | Plan | Execute**, same segmented tablist as today.
- Home’s rail is Dashboard, Life-Chain, Personnel (that order).
- Vision’s rail is Dream, Documents.
- Plan and Execute rails are unchanged.
- The former Home page is labeled **Dashboard** in the rail and on the page eyebrow. Route stays `/home`.
- The former Chain rail item is labeled **Life-Chain**. Route stays `/chain`. The page heading matches the rail.
- Cold start and `/` land on Dashboard (`/home`) with Home selected.
- Clicking Home goes to that tab’s last page this session, or Dashboard.
- `npm test` in `apps/desktop` still passes.

---

## 2. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Wings | **Home · Vision · Plan · Execute.** Fixed. Home is leftmost. |
| 2 | Home rail | **Dashboard, Life-Chain, Personnel.** |
| 3 | Vision rail | **Dream, Documents.** |
| 4 | Plan / Execute | Unchanged: Life Map + Architecture; Act. |
| 5 | Routes | **Keep** `/home`, `/chain`, `/personnel`, `/dream`, `/documents`. No `/dashboard` or `/life-chain`. |
| 6 | Dashboard naming | Rail label and page eyebrow **Dashboard**. File may stay `HomePage.tsx`. Nav `id` becomes `dashboard`. Keep the current Home icon. |
| 7 | Life-Chain naming | Rail label and page `<h1>` **Life-Chain**. File may stay `ChainPage.tsx` / `SignalChainFeed.tsx`. Nav `id` stays `chain`. Keep the current Radio icon. |
| 8 | Defaults | Home → `/home`. Vision → `/dream`. Plan → `/chart`. Execute → `/act`. |
| 9 | Cold start | App default remains `/` → `/home`, which now selects **Home**. Leftover hash to a wing-owned path still wins and selects that wing. |
| 10 | Brand mark | LQ logo still links to `/home`, which selects Home via path ownership. |
| 11 | Session | Unchanged: in-memory React context. Dies on quit. |
| 12 | Pinned | Decisions, Log, theme, Settings stay on every wing. They do not change the active wing. |
| 13 | Data filter | None. Domain switcher stays the data filter. |
| 14 | Tab UI | Existing `.ui-segmented` tablist. Arrow keys move and activate across all four tabs. |
| 15 | Welcome | No shell, so no tabs. |

A page belongs to at most one wing, except pinned pages, which belong to none.

### Explicitly out of scope

- Renaming URL paths
- Renaming `HomePage.tsx` or `ChainPage.tsx`
- Filtering page data by wing
- Persisting last-used
- Moving Dream, Documents, Decisions, or Log
- Changing room unlock, chat, or the domain switcher

---

## 3. Architecture

Chosen: **extend the existing wing module**. Rejected nested URLs and a Home tab outside the wing system.

### 3.1 Pure module (`wing.ts`)

```ts
export type WingId = "home" | "vision" | "plan" | "execute";

export const WING_IDS: WingId[] = ["home", "vision", "plan", "execute"];

export const WING_LABELS: Record<WingId, string> = {
  home: "Home",
  vision: "Vision",
  plan: "Plan",
  execute: "Execute",
};

export const WING_DEFAULTS: Record<WingId, string> = {
  home: "/home",
  vision: "/dream",
  plan: "/chart",
  execute: "/act",
};
```

Path ownership:

| Path | Wing |
|------|------|
| `/home`, `/chain`, `/personnel` | home |
| `/dream`, `/dream/…`, `/documents` | vision |
| `/chart`, `/track`, `/track/…` | plan |
| `/act` | execute |
| `/log`, `/decisions`, `/settings` | pinned (none) |

`initialWingSession()`: `active: "home"`, `lastPath` copied from `WING_DEFAULTS`.

`applyPath` / `selectWing` / `isPinnedPath` keep today’s rules. The only behavior change is the ownership table, the four-entry `lastPath`, and the Vision default (`/dream` instead of `/home`).

If Home’s last path is a pinned page (e.g. Log), clicking Home returns there, same as Vision does today.

`WingTabs` already maps `WING_IDS`; four tabs fall out of the array. No new tab component.

### 3.2 Nav items

`nav-items.ts`:

- Dashboard (`id: "dashboard"`, `href: "/home"`, label `Dashboard`) → `home`
- Life-Chain (`id: "chain"`, `href: "/chain"`, label `Life-Chain`) → `home`
- Personnel → `home`
- Dream, Documents → `vision`
- Life Map, Architecture → `plan`
- Act → `execute`
- Decisions, Log → omit `wing`

`NAV_ITEMS` `wing` tags must match the ownership table in `wing.ts`.

### 3.3 Labels on screens

- `HomePage` eyebrow `"Home"` → `"Dashboard"`. The `<h1>` stays the active lens name (Overview or a domain).
- `SignalChainFeed` heading `"Life Signal Chain"` → `"Life-Chain"`.

### 3.4 React wiring

Unchanged: `WingProvider` in `AppShell`, pathname → `applyPath`, tab click → `selectWing` + `navigate`. `NavRail` still filters `item.wing === active`. Brand link stays `to="/home"`.

Welcome and vault-open still `navigate("/home")`. That path now owns the Home wing, so cold start and “open vault” both land on Home → Dashboard without extra code.

### 3.5 Error handling

No new user-facing errors. Stale `lastPath` falls back to that wing’s default. Unknown routes do not move the wing. A leftover hash `/home` selects Home, not Vision.

---

## 4. Components

| Unit | Responsibility |
|------|----------------|
| `wing.ts` | Add `home`; new defaults and path table |
| `nav-items.ts` | Re-tag and relabel Dashboard / Life-Chain / Personnel |
| `WingTabs` | Renders four tabs from `WING_IDS` (no structural change) |
| `NavRail` | Unchanged filter; brand still `/home` |
| `HomePage` | Eyebrow Dashboard |
| `SignalChainFeed` | Heading Life-Chain |

---

## 5. Testing

Update `apps/desktop/tests/wing.test.ts` and `wing-shell.test.ts`. No new E2E.

Cases that must change:

- `initialWingSession` is Home with four defaults (`home: "/home"`, `vision: "/dream"`, `plan: "/chart"`, `execute: "/act"`).
- `wingForPath("/home")` / `"/chain"` / `"/personnel"` → `home`.
- `wingForPath("/dream")` / `"/documents"` / `"/dream/health/why"` → `vision`.
- `applyPath` on `/home` selects Home. `applyPath` on `/log` while Home is active keeps Home and records `lastPath.home = "/log"`.
- `selectWing("vision")` from a fresh session navigates to `/dream`.
- `selectWing("home")` after Log then Plan returns `/log`.
- `NAV_ITEMS`: Home wing `["dashboard", "chain", "personnel"]`; Vision `["dream", "documents"]`; Plan and Execute unchanged; Decisions and Log still have no `wing`.
- Dashboard label is `"Dashboard"`; Chain label is `"Life-Chain"`.
- Page copy: HomePage eyebrow is Dashboard; SignalChainFeed title is Life-Chain.

Manual check: four tabs, Home first; Home rail is the three pages; Vision is Dream + Documents; quit/reopen lands on Dashboard.

`npm test` in `apps/desktop` must pass.

---

## 6. Files to touch

| File | Change |
|------|--------|
| `apps/desktop/src/components/shell/wing.ts` | `WingId`, ids, labels, defaults, `PATH_WING` |
| `apps/desktop/src/components/shell/nav-items.ts` | Tags, labels, Dashboard `id` |
| `apps/desktop/src/pages/HomePage.tsx` | Eyebrow |
| `apps/desktop/src/components/signal-chain/SignalChainFeed.tsx` | Page heading |
| `apps/desktop/tests/wing.test.ts` | Session and nav assertions |
| `apps/desktop/tests/wing-shell.test.ts` | Any Home/Vision wiring strings that would go stale |
