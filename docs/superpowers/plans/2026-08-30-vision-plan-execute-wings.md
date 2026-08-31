# Vision / Plan / Execute Wings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TopBar vault name with fixed Vision / Plan / Execute tabs that filter the left rail and remember the last page per wing for the session.

**Architecture:** Keep existing routes. A pure `wing.ts` module owns path → wing, pinned paths, and session transitions. `WingProvider` holds that session in React state, syncs from `location.pathname`, and `navigate`s on tab click. Nav items carry an optional `wing` tag; the rail shows the active wing plus pinned Decisions / Log / Settings.

**Tech Stack:** React 19, React Router 7 HashRouter, existing `.ui-segmented` CSS, `node:test` + `node:assert/strict` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-08-30-vision-plan-execute-wings-design.md`

## Global Constraints

- Do **not** filter Home, Life Map, Log, tasks, or any other surface’s data by wing
- Do **not** encode the wing in the URL (no `/vision/…`, no `?wing=`)
- Do **not** persist last-used to disk, `localStorage`, or the vault
- Do **not** change the window titlebar label
- Do **not** move the domain switcher or agent lock
- Do **not** change room unlock rules
- Do **not** assign Settings or theme to a wing
- Do **not** put a page in more than one wing
- Tabs replace the vault name in the TopBar left slot only
- Pinned paths: `/log`, `/decisions`, `/settings` never change the active wing; they do update `lastPath` for the current wing
- Defaults: Vision → `/home`, Plan → `/chart`, Execute → `/act`
- Cold start: `/` → `/home` (Vision). A leftover hash to a wing-owned path wins and selects that wing
- Tests: `node --experimental-strip-types --test` in `apps/desktop/tests/`
- Commit only files from the current task; leave unrelated dirty files (`hermes-proxy.ts`, `mcp-server.ts`, `map/public.ts`) unstaged

---

## File Structure

```
apps/desktop/
  src/components/shell/wing.ts           # NEW: types, path tables, session transitions
  src/components/shell/WingProvider.tsx  # NEW: session context + navigate
  src/components/shell/WingTabs.tsx      # NEW: tablist in TopBar
  src/components/shell/nav-items.ts      # add wing tags, reorder Vision items
  src/components/shell/NavRail.tsx       # filter by active wing
  src/components/shell/TopBar.tsx        # vault name → WingTabs
  src/components/shell/AppShell.tsx      # mount WingProvider
  src/styles/global.css                  # drop vault-name; add top-bar__wings
  tests/wing.test.ts                     # NEW: session + nav tag tests
  tests/wing-shell.test.ts               # NEW: source asserts for chrome wiring
```

No changes to routes in `App.tsx`, vault-core, Electron main, or page components.

---

### Task 1: Pure wing session module

**Files:**
- Create: `apps/desktop/src/components/shell/wing.ts`
- Create: `apps/desktop/tests/wing.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type WingId = "vision" | "plan" | "execute"`
  - `export const WING_IDS: WingId[]`
  - `export const WING_LABELS: Record<WingId, string>`
  - `export const WING_DEFAULTS: Record<WingId, string>`
  - `export type WingSession = { active: WingId; lastPath: Record<WingId, string> }`
  - `export function initialWingSession(): WingSession`
  - `export function wingForPath(pathname: string): WingId | null`
  - `export function isPinnedPath(pathname: string): boolean`
  - `export function applyPath(session: WingSession, pathname: string): WingSession`
  - `export function selectWing(session: WingSession, wing: WingId): { session: WingSession; pathname: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/wing.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPath,
  initialWingSession,
  isPinnedPath,
  selectWing,
  wingForPath,
  WING_DEFAULTS,
} from "../src/components/shell/wing.ts";

describe("initialWingSession", () => {
  it("starts on Vision with the three defaults", () => {
    const session = initialWingSession();
    assert.equal(session.active, "vision");
    assert.deepEqual(session.lastPath, {
      vision: "/home",
      plan: "/chart",
      execute: "/act",
    });
    assert.deepEqual(WING_DEFAULTS, session.lastPath);
  });
});

describe("wingForPath", () => {
  it("maps wing-owned paths", () => {
    assert.equal(wingForPath("/home"), "vision");
    assert.equal(wingForPath("/dream"), "vision");
    assert.equal(wingForPath("/domains"), "vision");
    assert.equal(wingForPath("/chain"), "vision");
    assert.equal(wingForPath("/documents"), "vision");
    assert.equal(wingForPath("/personnel"), "vision");
    assert.equal(wingForPath("/chart"), "plan");
    assert.equal(wingForPath("/track"), "plan");
    assert.equal(wingForPath("/act"), "execute");
  });

  it("returns null for pinned and unknown paths", () => {
    assert.equal(wingForPath("/log"), null);
    assert.equal(wingForPath("/decisions"), null);
    assert.equal(wingForPath("/settings"), null);
    assert.equal(wingForPath("/unknown"), null);
  });
});

describe("isPinnedPath", () => {
  it("is true only for log, decisions, and settings", () => {
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
    assert.equal(next.lastPath.vision, "/home");
  });

  it("keeps Vision on /log and records it as Vision last path", () => {
    const next = applyPath(initialWingSession(), "/log");
    assert.equal(next.active, "vision");
    assert.equal(next.lastPath.vision, "/log");
    assert.equal(next.lastPath.plan, "/chart");
  });

  it("does not change the session for an unknown path", () => {
    const session = initialWingSession();
    const next = applyPath(session, "/nope");
    assert.equal(next, session);
    assert.equal(next.active, "vision");
  });
});

describe("selectWing", () => {
  it("navigates to the last path, or the default if none usable", () => {
    const fromHome = selectWing(initialWingSession(), "plan");
    assert.equal(fromHome.session.active, "plan");
    assert.equal(fromHome.pathname, "/chart");
  });

  it("after Log then Plan, returning to Vision goes to Log", () => {
    const afterLog = applyPath(initialWingSession(), "/log");
    const afterPlan = selectWing(afterLog, "plan");
    assert.equal(afterPlan.pathname, "/chart");
    const back = selectWing(afterPlan.session, "vision");
    assert.equal(back.pathname, "/log");
    assert.equal(back.session.active, "vision");
  });

  it("falls back to the wing default when last path is unknown", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        vision: "/home",
        plan: "/nope",
        execute: "/act",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/chart");
    assert.equal(next.session.active, "plan");
  });

  it("falls back when last path belongs to a different wing", () => {
    const broken = {
      ...initialWingSession(),
      lastPath: {
        vision: "/home",
        plan: "/home",
        execute: "/act",
      },
    };
    const next = selectWing(broken, "plan");
    assert.equal(next.pathname, "/chart");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/desktop`:

```
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: FAIL with `Cannot find module` for `../src/components/shell/wing.ts` (or `wingForPath` / `initialWingSession` is not a function).

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/components/shell/wing.ts`:

```ts
export type WingId = "vision" | "plan" | "execute";

export const WING_IDS: WingId[] = ["vision", "plan", "execute"];

export const WING_LABELS: Record<WingId, string> = {
  vision: "Vision",
  plan: "Plan",
  execute: "Execute",
};

export const WING_DEFAULTS: Record<WingId, string> = {
  vision: "/home",
  plan: "/chart",
  execute: "/act",
};

const PINNED_PATHS = new Set(["/log", "/decisions", "/settings"]);

const PATH_WING: Record<string, WingId> = {
  "/home": "vision",
  "/dream": "vision",
  "/domains": "vision",
  "/chain": "vision",
  "/documents": "vision",
  "/personnel": "vision",
  "/chart": "plan",
  "/track": "plan",
  "/act": "execute",
};

export type WingSession = {
  active: WingId;
  lastPath: Record<WingId, string>;
};

export function initialWingSession(): WingSession {
  return {
    active: "vision",
    lastPath: { ...WING_DEFAULTS },
  };
}

export function isPinnedPath(pathname: string): boolean {
  return PINNED_PATHS.has(pathname);
}

export function wingForPath(pathname: string): WingId | null {
  return PATH_WING[pathname] ?? null;
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

- [ ] **Step 4: Run the tests and make sure they pass**

```
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/wing.ts apps/desktop/tests/wing.test.ts
git commit -m "feat(desktop): add Vision/Plan/Execute wing session helper" -m "Pure path-to-wing tables and session transitions so the shell can filter the rail and remember the last page per tab without putting the wing in the URL."
```

---

### Task 2: Tag and reorder nav items

**Files:**
- Modify: `apps/desktop/src/components/shell/nav-items.ts`
- Modify: `apps/desktop/tests/wing.test.ts` (append a describe)

**Interfaces:**
- Consumes: `WingId` from `./wing.ts`
- Produces: `NavItem.wing?: WingId`. `NAV_ITEMS` order: Vision pages, then Plan, then Execute, then pinned Decisions / Log.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/tests/wing.test.ts`:

```ts
import { NAV_ITEMS } from "../src/components/shell/nav-items.ts";

describe("NAV_ITEMS wings", () => {
  it("assigns Vision, Plan, Execute, and pinned items", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "vision").map((i) => i.id),
      ["home", "dream", "domains", "chain", "documents", "personnel"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "plan").map((i) => i.id),
      ["chart", "track"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing === "execute").map((i) => i.id),
      ["act"],
    );
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.wing == null).map((i) => i.id),
      ["decisions", "log"],
    );
  });
});
```

Keep the existing `wing.ts` imports at the top of the file; add the `NAV_ITEMS` import next to them.

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: FAIL — `wing` is undefined, so the Vision list is empty (or does not equal the expected ids).

- [ ] **Step 3: Write minimal implementation**

Replace `apps/desktop/src/components/shell/nav-items.ts` with:

```ts
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  Map,
  Radio,
  ScrollText,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import type { RoomId } from "@lifequest/vault-core";
import type { WingId } from "./wing.ts";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  room?: RoomId;
  section?: "main" | "governance";
  wing?: WingId;
};

/** Vision: Home, Dream, Domains, Chain, Documents, Personnel. Plan: Life Map, Architecture. Execute: Act. Pinned: Decisions, Log. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    href: "/home",
    label: "Home",
    icon: Home,
    section: "main",
    wing: "vision",
  },
  {
    id: "dream",
    href: "/dream",
    label: "Dream",
    icon: Sparkles,
    room: "dream",
    section: "main",
    wing: "vision",
  },
  {
    id: "domains",
    href: "/domains",
    label: "Domains",
    icon: Building2,
    section: "main",
    wing: "vision",
  },
  {
    id: "chain",
    href: "/chain",
    label: "Chain",
    icon: Radio,
    section: "main",
    wing: "vision",
  },
  {
    id: "documents",
    href: "/documents",
    label: "Documents",
    icon: FileText,
    section: "main",
    wing: "vision",
  },
  {
    id: "personnel",
    href: "/personnel",
    label: "Personnel",
    icon: Users,
    section: "main",
    wing: "vision",
  },
  {
    id: "chart",
    href: "/chart",
    label: "Life Map",
    icon: Map,
    room: "chart",
    section: "main",
    wing: "plan",
  },
  {
    id: "track",
    href: "/track",
    label: "Architecture",
    icon: Target,
    room: "track",
    section: "main",
    wing: "plan",
  },
  {
    id: "act",
    href: "/act",
    label: "Act",
    icon: Zap,
    room: "act",
    section: "main",
    wing: "execute",
  },
  {
    id: "decisions",
    href: "/decisions",
    label: "Decisions",
    icon: ClipboardList,
    section: "governance",
  },
  {
    id: "log",
    href: "/log",
    label: "Log",
    icon: ScrollText,
    section: "governance",
  },
];
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
node --experimental-strip-types --test tests/wing.test.ts
```

Expected: PASS, including `NAV_ITEMS wings`.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/nav-items.ts apps/desktop/tests/wing.test.ts
git commit -m "feat(desktop): tag nav items with Vision/Plan/Execute wings" -m "Each rail page belongs to one wing, or to none if it is pinned. Vision order is Home, Dream, Domains, Chain, Documents, Personnel."
```

---

### Task 3: WingProvider in the shell

**Files:**
- Create: `apps/desktop/src/components/shell/WingProvider.tsx`
- Modify: `apps/desktop/src/components/shell/AppShell.tsx`
- Create: `apps/desktop/tests/wing-shell.test.ts`

**Interfaces:**
- Consumes: `applyPath`, `initialWingSession`, `selectWing` as `selectWingSession`, `WingId`, `WingSession` from `./wing.ts`. `useLocation`, `useNavigate` from `react-router-dom`.
- Produces:
  - `export function WingProvider({ children }: { children: ReactNode }): JSX.Element`
  - `export function useWing(): { active: WingId; selectWing: (wing: WingId) => void }`
  - `AppShell` wraps the shell in `WingProvider` inside `MapYearProvider` (HashRouter already wraps `AppShell`).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/wing-shell.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relFromDesktop: string): string {
  return fs.readFileSync(path.join(desktopRoot, relFromDesktop), "utf8");
}

describe("wing shell wiring", () => {
  it("mounts WingProvider inside AppShell", () => {
    const src = read("src/components/shell/AppShell.tsx");
    assert.match(
      src,
      /import \{ WingProvider \} from ["']\.\/WingProvider["']/,
    );
    assert.match(src, /<WingProvider>/);
    assert.match(src, /<\/WingProvider>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/wing-shell.test.ts
```

Expected: FAIL — `AppShell.tsx` has no `WingProvider`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/components/shell/WingProvider.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  applyPath,
  initialWingSession,
  selectWing as selectWingSession,
  type WingId,
  type WingSession,
} from "./wing.ts";

type WingContextValue = {
  active: WingId;
  selectWing: (wing: WingId) => void;
};

const WingContext = createContext<WingContextValue | null>(null);

export function WingProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<WingSession>(() =>
    applyPath(initialWingSession(), location.pathname),
  );

  useEffect(() => {
    setSession((current) => applyPath(current, location.pathname));
  }, [location.pathname]);

  const value = useMemo<WingContextValue>(
    () => ({
      active: session.active,
      selectWing: (wing: WingId) => {
        const next = selectWingSession(session, wing);
        setSession(next.session);
        if (next.pathname !== location.pathname) {
          navigate(next.pathname);
        }
      },
    }),
    [session, location.pathname, navigate],
  );

  return (
    <WingContext.Provider value={value}>{children}</WingContext.Provider>
  );
}

export function useWing(): WingContextValue {
  const ctx = useContext(WingContext);
  if (!ctx) throw new Error("useWing requires WingProvider");
  return ctx;
}
```

Replace `apps/desktop/src/components/shell/AppShell.tsx` with:

```tsx
import { useState, type ReactNode } from "react";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <MapYearProvider>
      <WingProvider>
        <div
          className={[
            "shell",
            chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
          ].join(" ")}
        >
          <NavRail />
          <div className="shell__main">
            <TopBar />
            <div className="shell__content">{children}</div>
          </div>
          <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
        </div>
      </WingProvider>
    </MapYearProvider>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
node --experimental-strip-types --test tests/wing-shell.test.ts tests/wing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/WingProvider.tsx apps/desktop/src/components/shell/AppShell.tsx apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): add WingProvider to the app shell" -m "Session state syncs from the current path so a leftover hash to Life Map selects Plan, and tab clicks can navigate to the last path for that wing."
```

---

### Task 4: Wing tabs replace the vault name

**Files:**
- Create: `apps/desktop/src/components/shell/WingTabs.tsx`
- Modify: `apps/desktop/src/components/shell/TopBar.tsx`
- Modify: `apps/desktop/src/styles/global.css` (`.top-bar__title` / `.top-bar__vault-name` → `.top-bar__wings`)
- Modify: `apps/desktop/tests/wing-shell.test.ts`

**Interfaces:**
- Consumes: `useWing()` from `./WingProvider.tsx`. `WING_IDS`, `WING_LABELS`, `WingId` from `./wing.ts`. Existing `.ui-segmented` / `.ui-segmented__option` / `.is-active` classes.
- Produces: `export function WingTabs(): JSX.Element` — `role="tablist"` labelled `App wing`, three `role="tab"` buttons, roving `tabIndex`, ArrowLeft / ArrowRight move and activate.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("wing shell wiring")` in `apps/desktop/tests/wing-shell.test.ts`:

```ts
  it("replaces the TopBar vault name with WingTabs", () => {
    const topBar = read("src/components/shell/TopBar.tsx");
    assert.match(
      topBar,
      /import \{ WingTabs \} from ["']\.\/WingTabs["']/,
    );
    assert.match(topBar, /<WingTabs\s*\/>/);
    assert.equal(topBar.includes("top-bar__vault-name"), false);
    assert.equal(topBar.includes("lifequest.name"), false);

    const tabs = read("src/components/shell/WingTabs.tsx");
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /aria-label="App wing"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /ArrowLeft/);
    assert.match(tabs, /ArrowRight/);

    const css = read("src/styles/global.css");
    assert.match(css, /\.top-bar__wings\s*\{/);
    assert.equal(css.includes(".top-bar__vault-name"), false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/wing-shell.test.ts
```

Expected: FAIL — TopBar still has `top-bar__vault-name`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/components/shell/WingTabs.tsx`:

```tsx
import { useRef, type KeyboardEvent } from "react";
import { WING_IDS, WING_LABELS, type WingId } from "./wing.ts";
import { useWing } from "./WingProvider";

export function WingTabs() {
  const { active, selectWing } = useWing();
  const refs = useRef<Partial<Record<WingId, HTMLButtonElement | null>>>({});

  function move(from: WingId, key: "ArrowLeft" | "ArrowRight") {
    const index = WING_IDS.indexOf(from);
    const next =
      key === "ArrowRight"
        ? WING_IDS[(index + 1) % WING_IDS.length]
        : WING_IDS[(index - 1 + WING_IDS.length) % WING_IDS.length];
    selectWing(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(wing: WingId, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(wing, event.key);
    }
  }

  return (
    <div
      className="ui-segmented top-bar__wings"
      role="tablist"
      aria-label="App wing"
    >
      {WING_IDS.map((wing) => {
        const selected = wing === active;
        return (
          <button
            key={wing}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`ui-segmented__option${selected ? " is-active" : ""}`}
            ref={(el) => {
              refs.current[wing] = el;
            }}
            onClick={() => selectWing(wing)}
            onKeyDown={(event) => onKeyDown(wing, event)}
          >
            {WING_LABELS[wing]}
          </button>
        );
      })}
    </div>
  );
}
```

Replace `apps/desktop/src/components/shell/TopBar.tsx` with:

```tsx
import { useVault } from "@/state/VaultProvider";
import { api } from "@/lib/ipc";
import { DomainSwitcher } from "./DomainSwitcher";
import { WingTabs } from "./WingTabs";

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
      <WingTabs />
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

In `apps/desktop/src/styles/global.css`, replace:

```css
.top-bar__title {
  flex: 1 1 auto;
  min-width: 0;
}

.top-bar__vault-name {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

with:

```css
.top-bar__wings {
  flex: 0 1 auto;
  min-width: 0;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
node --experimental-strip-types --test tests/wing-shell.test.ts tests/wing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/WingTabs.tsx apps/desktop/src/components/shell/TopBar.tsx apps/desktop/src/styles/global.css apps/desktop/tests/wing-shell.test.ts
git commit -m "feat(desktop): replace TopBar vault name with wing tabs" -m "Vision, Plan, and Execute sit in the old vault-name slot as a tablist. Domain switcher and agent lock stay on the right."
```

---

### Task 5: Filter the nav rail by active wing

**Files:**
- Modify: `apps/desktop/src/components/shell/NavRail.tsx`
- Modify: `apps/desktop/tests/wing-shell.test.ts`
- Modify: `docs/superpowers/specs/2026-08-30-vision-plan-execute-wings-design.md` (status line only)

**Interfaces:**
- Consumes: `useWing()` from `./WingProvider.tsx`. `NAV_ITEMS` with `wing`.
- Produces: Rail section 1 = `item.wing === active`. Section 2 = items with no `wing` (Decisions, Log). Footer unchanged (theme + Settings). Brand still links to `/home`. Lock icons unchanged.

- [ ] **Step 1: Write the failing test**

Append inside `describe("wing shell wiring")` in `apps/desktop/tests/wing-shell.test.ts`:

```ts
  it("filters the nav rail by the active wing and keeps pinned items", () => {
    const src = read("src/components/shell/NavRail.tsx");
    assert.match(src, /useWing/);
    assert.match(src, /item\.wing === active/);
    assert.match(src, /!item\.wing/);
    assert.match(src, /to=["']\/home["']/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
node --experimental-strip-types --test tests/wing-shell.test.ts
```

Expected: FAIL — `NavRail.tsx` still filters by `section === "main"`.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/desktop/src/components/shell/NavRail.tsx` with:

```tsx
import { Lock } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { useActiveDomain, useUnlockedRooms } from "./useActiveDomain";
import { useWing } from "./WingProvider";

export function NavRail() {
  const unlockedRooms = useUnlockedRooms();
  const activeDomain = useActiveDomain();
  const { active } = useWing();

  const wingItems = NAV_ITEMS.filter((item) => item.wing === active);
  const pinned = NAV_ITEMS.filter((item) => !item.wing);

  function renderItem(item: NavItem) {
    const locked = Boolean(item.room && !unlockedRooms.has(item.room));
    const Icon = item.icon;

    return (
      <NavLink
        key={item.id}
        to={item.href}
        className={({ isActive }) =>
          [
            "nav-rail__link",
            isActive ? "nav-rail__link--active" : "",
            locked ? "nav-rail__link--locked" : "",
          ]
            .filter(Boolean)
            .join(" ")
        }
        title={
          locked
            ? `${item.label} (locked — write a Why in any domain)`
            : item.label
        }
        aria-disabled={locked || undefined}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
          {locked ? (
            <Lock size={10} className="nav-rail__lock" aria-hidden />
          ) : null}
        </span>
        <span className="nav-rail__label">{item.label}</span>
      </NavLink>
    );
  }

  return (
    <nav className="nav-rail" aria-label="Main">
      <NavLink
        to="/home"
        className="nav-rail__brand"
        title={
          activeDomain
            ? `LifeQuest — active: ${activeDomain.meta.name}`
            : "LifeQuest"
        }
      >
        <span className="nav-rail__logo" aria-hidden>
          LQ
        </span>
        <span className="nav-rail__brand-text">LifeQuest</span>
      </NavLink>

      <div className="nav-rail__section">{wingItems.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section">{pinned.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section nav-rail__section--bottom">
        <div className="nav-rail__settings-wrap">
          <NavThemeModeToggle />
          <SettingsMenu className="nav-rail__settings" placement="right-end" />
        </div>
      </div>
    </nav>
  );
}
```

Change the spec status line from:

```
**Status:** Approved for implementation planning
```

to:

```
**Status:** Approved — implementation plan ready (`docs/superpowers/plans/2026-08-30-vision-plan-execute-wings.md`)
```

- [ ] **Step 4: Run tests and typecheck**

From `apps/desktop`:

```
node --experimental-strip-types --test tests/wing.test.ts tests/wing-shell.test.ts
npm test
npm run typecheck
```

Expected: all PASS / `tsc` exits 0.

Manual check in the running desktop app (dev server already in the neighbor pane; restart only if HMR missed the new files):

- TopBar shows Vision / Plan / Execute, not the vault name.
- Window titlebar still shows `LifeQuest — Personal` (or the vault name).
- Vision rail: Home, Dream, Domains, Chain, Documents, Personnel, then Decisions, Log, then theme + Settings.
- Plan rail: Life Map, Architecture, then the same pinned footer.
- Execute rail: Act, then the same pinned footer.
- Click Plan → Life Map. Click Execute → Act. Click Vision → Home (or last Vision page).
- Open Log while on Plan; Plan stays selected. Click Vision; if Log was last on Vision, return to Log.
- Domain switcher and agent lock still work. Locked rooms still show the lock icon.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/shell/NavRail.tsx apps/desktop/tests/wing-shell.test.ts docs/superpowers/specs/2026-08-30-vision-plan-execute-wings-design.md
git commit -m "feat(desktop): filter nav rail by active wing" -m "The left rail shows only the current wing plus pinned Decisions and Log. Settings and theme stay in the footer on every tab."
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Tabs replace vault name; titlebar unchanged | 4 |
| Rail assignment + pinned Decisions/Log/Settings | 2, 5 |
| Tab click → last path or default | 1, 3, 4 |
| Wing-owned navigation selects wing | 1, 3 |
| Pinned paths do not change wing; they update lastPath | 1 |
| Defaults / leftover hash / unknown last path | 1, 3 |
| Session-only, no URL encoding, no data filter | Global constraints |
| Tablist + arrow keys | 4 |
| Welcome has no tabs | 3 (`AppShell` only) |
| Room locks unchanged | 5 |
| `wing.ts` owns path tables; `NAV_ITEMS` tags match | 1, 2 |
| `npm test` / `typecheck` | 5 |
