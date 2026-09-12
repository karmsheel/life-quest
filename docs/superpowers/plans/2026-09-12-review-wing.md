# Review Wing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth Review wing after Execute with five placeholder cadence pages (Daily through Yearly).

**Architecture:** Extend the existing in-memory wing module. `WingId` gains `"review"`; five exact paths own that wing; `NAV_ITEMS` gains five Review rail entries; `App.tsx` mounts five `StubPage` routes. `WingTabs` and `NavRail` already iterate `WING_IDS` / filter by `item.wing`, so they pick up the fifth wing with no structural change.

**Tech Stack:** React 19, React Router 7 HashRouter, Lucide icons, existing `StubPage`, `node:test` + `node:assert/strict` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-12-review-wing-design.md`

## Global Constraints

- Do **not** filter Home, Life Map, Log, tasks, or any other surface’s data by wing
- Do **not** encode the wing as a query (`?wing=`)
- Do **not** add a `/review` hub, inner cadence tabs, or prefix-match every `/review/…` path
- Do **not** persist last-used to disk, `localStorage`, or the vault
- Do **not** write review notes or session UI; pages are `StubPage` only
- Do **not** move or rename Home / Vision / Plan / Execute pages
- Do **not** change domain switcher, chat, theme, Settings, or pinned Life-Chain / Decisions / Log
- Wings: **Home · Vision · Plan · Execute · Review** (Review rightmost)
- Review rail order: Daily, Weekly, Monthly, Quarterly, Yearly
- Review routes: `/review/daily`, `/review/weekly`, `/review/monthly`, `/review/quarterly`, `/review/yearly`
- Review default: `/review/daily`
- Rail label is the cadence (`Daily`); page title is `{Cadence} Review` (`Daily Review`)
- Exact Review paths only: `/review`, `/review/nope`, `/review/daily/extra`, `/daily` are not Review-owned
- Tests: from `apps/desktop`, `node --experimental-strip-types --test tests/<file>.test.ts`
- Full gate: `npm test` and `npm run typecheck` in `apps/desktop`
- Commit only files from the current task; leave unrelated dirty files (`README.md`, `VISION.md`) unstaged

---

## File Structure

```
apps/desktop/
  src/components/shell/wing.ts        # add review to ids, labels, defaults, PATH_WING
  src/components/shell/nav-items.ts   # five Review items + Calendar icons
  src/App.tsx                         # import StubPage; five /review/… routes
  tests/wing.test.ts                  # session, path ownership, NAV_ITEMS
  tests/wing-shell.test.ts            # nested /review/… routes under AppShell
```

No new components. `WingTabs.tsx`, `NavRail.tsx`, `WingProvider.tsx`, and `StubPage.tsx` stay as they are.

---

### Task 1: Review wing session tables

**Files:**
- Modify: `apps/desktop/tests/wing.test.ts`
- Modify: `apps/desktop/src/components/shell/wing.ts`

**Interfaces:**
- Consumes: existing `applyPath`, `selectWing`, `wingForPath`, `initialWingSession`
- Produces:
  - `export type WingId = "home" | "vision" | "plan" | "execute" | "review"`
  - `WING_IDS` includes `"review"` last
  - `WING_LABELS.review === "Review"`
  - `WING_DEFAULTS.review === "/review/daily"`
  - `wingForPath("/review/daily" | "/review/weekly" | "/review/monthly" | "/review/quarterly" | "/review/yearly") === "review"`
  - `wingForPath("/review" | "/review/nope" | "/review/daily/extra" | "/daily") === null`

- [ ] **Step 1: Write the failing test**

Replace `apps/desktop/tests/wing.test.ts` with:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_ITEMS } from "../src/components/shell/nav-items.ts";
import {
  applyPath,
  initialWingSession,
  isPinnedPath,
  selectWing,
  wingForPath,
  WING_DEFAULTS,
  WING_IDS,
} from "../src/components/shell/wing.ts";

describe("initialWingSession", () => {
  it("starts on Home with the five defaults", () => {
    const session = initialWingSession();
    assert.deepEqual(WING_IDS, [
      "home",
      "vision",
      "plan",
      "execute",
      "review",
    ]);
    assert.equal(session.active, "home");
    assert.deepEqual(session.lastPath, {
      home: "/home",
      vision: "/dream",
      plan: "/goals",
      execute: "/act",
      review: "/review/daily",
    });
    assert.deepEqual(WING_DEFAULTS, session.lastPath);
  });
});

describe("wingForPath", () => {
  it("maps wing-owned paths", () => {
    assert.equal(wingForPath("/home"), "home");
    assert.equal(wingForPath("/personnel"), "home");
    assert.equal(wingForPath("/dream"), "vision");
    assert.equal(wingForPath("/documents"), "vision");
    assert.equal(wingForPath("/goals"), "plan");
    assert.equal(wingForPath("/chart"), "plan");
    assert.equal(wingForPath("/track"), "plan");
    assert.equal(wingForPath("/act"), "execute");
    assert.equal(wingForPath("/review/daily"), "review");
    assert.equal(wingForPath("/review/weekly"), "review");
    assert.equal(wingForPath("/review/monthly"), "review");
    assert.equal(wingForPath("/review/quarterly"), "review");
    assert.equal(wingForPath("/review/yearly"), "review");
    assert.equal(wingForPath("/dream/health/why"), "vision");
    assert.equal(wingForPath("/dream/health/what"), "vision");
    assert.equal(wingForPath("/track/health/how"), "plan");
  });

  it("returns null for pinned and unknown paths", () => {
    assert.equal(wingForPath("/chain"), null);
    assert.equal(wingForPath("/log"), null);
    assert.equal(wingForPath("/decisions"), null);
    assert.equal(wingForPath("/settings"), null);
    assert.equal(wingForPath("/domains"), null);
    assert.equal(wingForPath("/unknown"), null);
    assert.equal(wingForPath("/review"), null);
    assert.equal(wingForPath("/review/nope"), null);
    assert.equal(wingForPath("/review/daily/extra"), null);
    assert.equal(wingForPath("/daily"), null);
  });
});

describe("isPinnedPath", () => {
  it("is true for Life-Chain, Decisions, Log, and settings", () => {
    assert.equal(isPinnedPath("/chain"), true);
    assert.equal(isPinnedPath("/log"), true);
    assert.equal(isPinnedPath("/decisions"), true);
    assert.equal(isPinnedPath("/settings"), true);
    assert.equal(isPinnedPath("/home"), false);
    assert.equal(isPinnedPath("/unknown"), false);
  });
});

describe("applyPath", () => {
  it("selects Plan and records /chart", () => {
    const next = applyPath(initialWingSession(), "/chart");
    assert.equal(next.active, "plan");
    assert.equal(next.lastPath.plan, "/chart");
    assert.equal(next.lastPath.home, "/home");
  });

  it("selects Home on /home", () => {
    const next = applyPath(initialWingSession(), "/home");
    assert.equal(next.active, "home");
    assert.equal(next.lastPath.home, "/home");
  });

  it("selects Review and records /review/weekly", () => {
    const next = applyPath(initialWingSession(), "/review/weekly");
    assert.equal(next.active, "review");
    assert.equal(next.lastPath.review, "/review/weekly");
    assert.equal(next.lastPath.home, "/home");
  });

  it("keeps Home on /log and records it as Home last path", () => {
    const next = applyPath(initialWingSession(), "/log");
    assert.equal(next.active, "home");
    assert.equal(next.lastPath.home, "/log");
    assert.equal(next.lastPath.plan, "/goals");
  });

  it("keeps Review on /log and records it as Review last path", () => {
    const onReview = applyPath(initialWingSession(), "/review/weekly");
    const next = applyPath(onReview, "/log");
    assert.equal(next.active, "review");
    assert.equal(next.lastPath.review, "/log");
  });

  it("does not change the session for an unknown path", () => {
    const session = initialWingSession();
    const next = applyPath(session, "/nope");
    assert.equal(next, session);
    assert.equal(next.active, "home");
  });

  it("does not change the session for unknown /review paths", () => {
    const session = initialWingSession();
    assert.equal(applyPath(session, "/review"), session);
    assert.equal(applyPath(session, "/review/nope"), session);
    assert.equal(applyPath(session, "/daily"), session);
  });
});

describe("selectWing", () => {
  it("navigates to the last path, or the default if none usable", () => {
    const fromHome = selectWing(initialWingSession(), "plan");
    assert.equal(fromHome.session.active, "plan");
    assert.equal(fromHome.pathname, "/goals");
  });

  it("keeps session memory of the last Plan path", () => {
    const afterChart = applyPath(initialWingSession(), "/chart");
    const back = selectWing(afterChart, "plan");
    assert.equal(back.pathname, "/chart");
  });

  it("selects Vision at /dream from a fresh session", () => {
    const next = selectWing(initialWingSession(), "vision");
    assert.equal(next.session.active, "vision");
    assert.equal(next.pathname, "/dream");
  });

  it("selects Review at /review/daily from a fresh session", () => {
    const next = selectWing(initialWingSession(), "review");
    assert.equal(next.session.active, "review");
    assert.equal(next.pathname, "/review/daily");
  });

  it("after Log then Plan, returning to Home goes to Log", () => {
    const afterLog = applyPath(initialWingSession(), "/log");
    const afterPlan = selectWing(afterLog, "plan");
    assert.equal(afterPlan.pathname, "/goals");
    const back = selectWing(afterPlan.session, "home");
    assert.equal(back.pathname, "/log");
    assert.equal(back.session.active, "home");
  });

  it("after Weekly then Plan, returning to Review goes to Weekly", () => {
    const afterWeekly = applyPath(initialWingSession(), "/review/weekly");
    const afterPlan = selectWing(afterWeekly, "plan");
    assert.equal(afterPlan.pathname, "/goals");
    const back = selectWing(afterPlan.session, "review");
    assert.equal(back.pathname, "/review/weekly");
    assert.equal(back.session.active, "review");
  });

  it("falls back to the wing default when last path is unknown", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        home: "/home",
        vision: "/dream",
        plan: "/nope",
        execute: "/act",
        review: "/review/daily",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/goals");
    assert.equal(next.session.active, "plan");
  });

  it("falls back when last path belongs to a different wing", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        home: "/home",
        vision: "/dream",
        plan: "/home",
        execute: "/act",
        review: "/home",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/goals");
    const review = selectWing(broken, "review");
    assert.equal(review.pathname, "/review/daily");
    assert.equal(review.session.active, "review");
  });
});

describe("NAV_ITEMS wings", () => {
  it("assigns Home, Vision, Plan, Execute, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "home").map((i) => i.id),
      ["dashboard", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["dream", "documents"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "plan").map((i) => i.id),
      ["goals", "chart", "track"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "execute").map((i) => i.id),
      ["act"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "top").map((i) => i.id),
      ["chain", "decisions"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "bottom").map((i) => i.id),
      ["log"],
    );
  });

  it("labels Dashboard and Life-Chain", () => {
    const dashboard = NAV_ITEMS.find((i) => i.id === "dashboard");
    const chain = NAV_ITEMS.find((i) => i.id === "chain");
    assert.equal(dashboard?.label, "Dashboard");
    assert.equal(dashboard?.href, "/home");
    assert.equal(chain?.label, "Life-Chain");
    assert.equal(chain?.href, "/chain");
  });
});
```

Leave the `NAV_ITEMS` Review assertion out of this task so the suite can pass after `wing.ts` only.

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/desktop`:

```bash
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: FAIL. `WING_IDS` deepEqual fails because the array is still `["home", "vision", "plan", "execute"]`. `lastPath` is missing `review`.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/desktop/src/components/shell/wing.ts` with:

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

const PINNED_PATHS = new Set(["/chain", "/log", "/decisions", "/settings"]);

const PATH_WING: Record<string, WingId> = {
  "/home": "home",
  "/personnel": "home",
  "/dream": "vision",
  "/documents": "vision",
  "/goals": "plan",
  "/chart": "plan",
  "/track": "plan",
  "/act": "execute",
  "/review/daily": "review",
  "/review/weekly": "review",
  "/review/monthly": "review",
  "/review/quarterly": "review",
  "/review/yearly": "review",
};

export type WingSession = {
  active: WingId;
  lastPath: Record<WingId, string>;
};

export function initialWingSession(): WingSession {
  return {
    active: "home",
    lastPath: { ...WING_DEFAULTS },
  };
}

export function isPinnedPath(pathname: string): boolean {
  return PINNED_PATHS.has(pathname);
}

export function wingForPath(pathname: string): WingId | null {
  if (PATH_WING[pathname]) return PATH_WING[pathname];
  if (pathname.startsWith("/dream/")) return "vision";
  if (pathname.startsWith("/track/")) return "plan";
  return null;
}

function isUsableLastPath(pathname: string, wing: WingId): boolean {
  if (isPinnedPath(pathname)) return true;
  return wingForPath(pathname) === wing;
}

export function applyPath(
  session: WingSession,
  pathname: string,
): WingSession {
  const wing = wingForPath(pathname);
  if (wing) {
    return {
      active: wing,
      lastPath: { ...session.lastPath, [wing]: pathname },
    };
  }
  if (isPinnedPath(pathname)) {
    return {
      ...session,
      lastPath: { ...session.lastPath, [session.active]: pathname },
    };
  }
  return session;
}

export function selectWing(
  session: WingSession,
  wing: WingId,
): { session: WingSession; pathname: string } {
  const candidate = session.lastPath[wing];
  const pathname = isUsableLastPath(candidate, wing)
    ? candidate
    : WING_DEFAULTS[wing];
  return {
    session: { ...session, active: wing },
    pathname,
  };
}
```

Do **not** add `pathname.startsWith("/review/")`. Unknown `/review/…` must stay `null`.

- [ ] **Step 4: Run tests and make sure they pass**

```bash
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: PASS. All session tests green. `NAV_ITEMS` still has no Review items; that describe is unchanged and still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/shell/wing.ts apps/desktop/tests/wing.test.ts
git commit -m "feat(desktop): add Review wing to session tables"
```

---

### Task 2: Review rail nav items

**Files:**
- Modify: `apps/desktop/tests/wing.test.ts`
- Modify: `apps/desktop/src/components/shell/nav-items.ts`

**Interfaces:**
- Consumes: `WingId` including `"review"` from Task 1
- Produces: five `NAV_ITEMS` with `wing: "review"`, ids `daily`, `weekly`, `monthly`, `quarterly`, `yearly`, hrefs `/review/{cadence}`, labels `Daily` … `Yearly`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/wing.test.ts`, rename the first `NAV_ITEMS` test and add the Review filter plus a labels test.

Replace the `NAV_ITEMS wings` describe with:

```ts
describe("NAV_ITEMS wings", () => {
  it("assigns Home, Vision, Plan, Execute, Review, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "home").map((i) => i.id),
      ["dashboard", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["dream", "documents"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "plan").map((i) => i.id),
      ["goals", "chart", "track"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "execute").map((i) => i.id),
      ["act"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "review").map((i) => i.id),
      ["daily", "weekly", "monthly", "quarterly", "yearly"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "top").map((i) => i.id),
      ["chain", "decisions"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.pin === "bottom").map((i) => i.id),
      ["log"],
    );
  });

  it("labels Dashboard and Life-Chain", () => {
    const dashboard = NAV_ITEMS.find((i) => i.id === "dashboard");
    const chain = NAV_ITEMS.find((i) => i.id === "chain");
    assert.equal(dashboard?.label, "Dashboard");
    assert.equal(dashboard?.href, "/home");
    assert.equal(chain?.label, "Life-Chain");
    assert.equal(chain?.href, "/chain");
  });

  it("labels Review cadences and points at /review/…", () => {
    const expected = [
      ["daily", "Daily", "/review/daily"],
      ["weekly", "Weekly", "/review/weekly"],
      ["monthly", "Monthly", "/review/monthly"],
      ["quarterly", "Quarterly", "/review/quarterly"],
      ["yearly", "Yearly", "/review/yearly"],
    ] as const;
    for (const [id, label, href] of expected) {
      const item = NAV_ITEMS.find((i) => i.id === id);
      assert.equal(item?.label, label);
      assert.equal(item?.href, href);
      assert.equal(item?.wing, "review");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: FAIL. Review filter is `[]`, not the five ids.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/components/shell/nav-items.ts`:

1. Add these Lucide imports next to the existing icon imports: `Calendar`, `CalendarCheck`, `CalendarClock`, `CalendarDays`, `CalendarRange`.
2. Update the file comment to mention Review.
3. Insert the five Review items after Act and before Log.

The import block becomes:

```ts
import {
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Goal,
  Home,
  Map,
  Radio,
  ScrollText,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
```

The comment above `NAV_ITEMS` becomes:

```ts
/** Top: Life-Chain, Decisions. Home: Dashboard, Personnel. Vision: Dream, Documents. Plan: Goals, Life Map, Architecture. Execute: Act. Review: Daily, Weekly, Monthly, Quarterly, Yearly. Bottom: Log. */
```

Insert immediately after the `act` item and before the `log` item:

```ts
  {
    id: "daily",
    href: "/review/daily",
    label: "Daily",
    icon: Calendar,
    section: "main",
    wing: "review",
  },
  {
    id: "weekly",
    href: "/review/weekly",
    label: "Weekly",
    icon: CalendarDays,
    section: "main",
    wing: "review",
  },
  {
    id: "monthly",
    href: "/review/monthly",
    label: "Monthly",
    icon: CalendarRange,
    section: "main",
    wing: "review",
  },
  {
    id: "quarterly",
    href: "/review/quarterly",
    label: "Quarterly",
    icon: CalendarClock,
    section: "main",
    wing: "review",
  },
  {
    id: "yearly",
    href: "/review/yearly",
    label: "Yearly",
    icon: CalendarCheck,
    section: "main",
    wing: "review",
  },
```

Do not change Home, Vision, Plan, Execute, or pinned items.

- [ ] **Step 4: Run tests and make sure they pass**

```bash
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/shell/nav-items.ts apps/desktop/tests/wing.test.ts
git commit -m "feat(desktop): add Review cadence items to the rail"
```

---

### Task 3: Review stub routes

**Files:**
- Modify: `apps/desktop/tests/wing-shell.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `StubPage` from `apps/desktop/src/pages/StubPage.tsx` (unchanged)
- Produces: five nested `AppShell` routes, each `<StubPage title="{Cadence} Review" />`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/tests/wing-shell.test.ts`, inside `uses one layout AppShell with nested page routes`, after the `/act` assertion and before `/log`, add:

```ts
    assert.match(nested, /<Route\s+path=["']\/review\/daily["']/);
    assert.match(nested, /<Route\s+path=["']\/review\/weekly["']/);
    assert.match(nested, /<Route\s+path=["']\/review\/monthly["']/);
    assert.match(nested, /<Route\s+path=["']\/review\/quarterly["']/);
    assert.match(nested, /<Route\s+path=["']\/review\/yearly["']/);
    assert.match(nested, /StubPage title=["']Daily Review["']/);
    assert.match(nested, /StubPage title=["']Weekly Review["']/);
    assert.match(nested, /StubPage title=["']Monthly Review["']/);
    assert.match(nested, /StubPage title=["']Quarterly Review["']/);
    assert.match(nested, /StubPage title=["']Yearly Review["']/);
```

Also add this new test in the same `describe("wing shell wiring")` block:

```ts
  it("imports StubPage for Review cadence routes", () => {
    const src = read("src/App.tsx");
    assert.match(
      src,
      /import StubPage from ["']@\/pages\/StubPage["']/,
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/wing-shell.test.ts
```

Expected: FAIL. Nested routes do not include `/review/daily`. `StubPage` is not imported.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/App.tsx`:

Add this import next to the other page imports:

```ts
import StubPage from "@/pages/StubPage";
```

Inside the `AppShell` layout route, immediately after the `/act` route and before `/documents`, add:

```tsx
        <Route path="/review/daily" element={<StubPage title="Daily Review" />} />
        <Route path="/review/weekly" element={<StubPage title="Weekly Review" />} />
        <Route path="/review/monthly" element={<StubPage title="Monthly Review" />} />
        <Route path="/review/quarterly" element={<StubPage title="Quarterly Review" />} />
        <Route path="/review/yearly" element={<StubPage title="Yearly Review" />} />
```

Do not add a `/review` index route. Do not add a Review page component. Do not change the `*` redirect.

- [ ] **Step 4: Run tests and typecheck**

From `apps/desktop`:

```bash
node --experimental-strip-types --test tests/wing.test.ts tests/wing-shell.test.ts
npm test
npm run typecheck
```

Expected: all PASS. `npm test` is the full desktop suite. `typecheck` is `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): route Review cadence stub pages"
```

---

## Self-review (plan vs spec)

**1. Spec coverage**

| Spec requirement | Task |
|------------------|------|
| Tabs Home \| Vision \| Plan \| Execute \| Review | Task 1 (`WING_IDS`); `WingTabs` already maps the array |
| Review rail Daily → Yearly | Task 2 |
| Other rails unchanged | Task 2 (assertions keep existing ids) |
| Stub titles `{Cadence} Review` + “Coming soon.” | Task 3 (`StubPage`) |
| Default `/review/daily` | Task 1 |
| Session last-path, pinned does not steal wing | Task 1 (`applyPath` on `/log` while Review active) |
| Exact paths only; `/review` and `/daily` not owned | Task 1 |
| No hub, no vault writes, no data filter | Global constraints; no tasks add them |
| `npm test` and `typecheck` | Task 3 Step 4 |

**2. Placeholder scan:** No TBD / “implement later” / “similar to Task N”. Each step has the code.

**3. Type consistency:** `WingId` includes `"review"` in Task 1; Task 2 nav items use `wing: "review"`; Task 3 hrefs match `PATH_WING` and `NAV_ITEMS` hrefs.

No spec requirement without a task.
