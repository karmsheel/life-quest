/**
 * E2E harness page for the Dashboard page lock (`pages/HomePage`).
 *
 * HomePage is where the lock is a control rather than a rule: the board read
 * carries `locked`, the pin chrome and the Add-pin row are gone while it is set,
 * and the header toggle is the operator's only way to change it. That is what
 * this rig renders — the real page, with the IPC bridge stubbed.
 *
 * The bridge is a recording stub, deliberately small: every method the page
 * calls is listed, and anything else answers `{ ok: false }` and is NAMED in
 * `dashboardLockUnexpectedCalls` so a page that grows a new dependency fails the
 * run loudly instead of rendering a quietly empty board.
 *
 * The driver waits on `dashboardLockCommits`, bumped from an effect after React
 * has committed, so it never samples a half-painted page.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DomainRecord,
  Pin,
  PinBoardRead,
  SavedView,
  VaultSnapshot,
} from "@lifequest/vault-core";
import HomePage from "@/pages/HomePage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the Dashboard the operator sees, so
// it has to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

/** The board the harness serves, and every write the page made. */
type BoardState = {
  pins: Pin[];
  locked: boolean;
};

type HarnessWindow = Window & {
  dashboardLockReady?: boolean;
  dashboardLockCommits?: number;
  dashboardLockCalls?: string[];
  dashboardLockUnexpectedCalls?: string[];
  dashboardLockState?: BoardState;
  dashboardLockSetBoard?: (pins: Pin[], locked: boolean) => boolean;
  dashboardLockRender?: (generation: number) => boolean;
  dashboardLockLockCalls?: { locked: boolean; boardSlug: string | null }[];
  dashboardLockPinWrites?: Pin[][];
  /** The skin the page painted in, so a driver can refuse an unstyled run. */
  dashboardLockSkin?: string;
};

const harness = window as HarnessWindow;

harness.dashboardLockCalls = [];
harness.dashboardLockUnexpectedCalls = [];
harness.dashboardLockLockCalls = [];
harness.dashboardLockPinWrites = [];

/** The board the page reads: two system pins and nothing else. */
const state: BoardState = {
  pins: [
    { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
    { id: "sys:recent-log", kind: "system", system: "recent-log" },
  ],
  locked: false,
};
harness.dashboardLockState = state;

/** One live domain, so the Overview board has something to list views from. */
const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Harness",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: [
    {
      slug: "financial",
      meta: {
        name: "Financial",
        description: null,
        color: null,
        sortOrder: 3,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {} as DomainRecord["documents"],
    },
  ],
  agents: [],
  decisions: [],
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

/**
 * Every bridge method the page uses, with the value it answers. A method the
 * page calls that is not here is recorded and answered `{ ok: false }`, so the
 * run reports it by name.
 */
function bridge(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return {
    vaultGetSnapshot: async () => ok(SNAPSHOT),
    vaultListRecent: async () => [],
    domainGetActive: async () => null,
    onVaultFileChanged: () => () => {},
    decisionList: async () => ok([]),
    logList: async () => ok([]),
    pageList: async () => ok([]),
    viewList: async () => ok([] as SavedView[]),
    kitList: async () => ok([]),
    deadlineGetDismissed: async () => ok(false),
    deadlineMaybeNotify: async () => ok(null),
    deadlineDismiss: async () => ok(true),
    goalsApply: async () => ok({}),
    // The two calls this rig is about.
    pinsList: async () => ok({ pins: state.pins, locked: state.locked } satisfies PinBoardRead),
    pinsSetLocked: async (_boardSlug: unknown, locked: unknown) => {
      const next = locked === true;
      harness.dashboardLockLockCalls!.push({
        locked: next,
        boardSlug: (_boardSlug as string | null) ?? null,
      });
      state.locked = next;
      return ok({ pins: state.pins, locked: state.locked } satisfies PinBoardRead);
    },
    pinsSet: async (_boardSlug: unknown, pins: unknown) => {
      harness.dashboardLockPinWrites!.push(pins as Pin[]);
      state.pins = pins as Pin[];
      return ok({ applied: true, pins: state.pins, locked: state.locked });
    },
  };
}

const stubs = bridge();

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.dashboardLockCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.dashboardLockUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/** Install a board before the page reads it; re-render with `renderDashboard`. */
harness.dashboardLockSetBoard = (pins, locked) => {
  state.pins = pins;
  state.locked = locked;
  return true;
};

function Harness({ generation }: { generation: number }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.dashboardLockCommits = commits.current;
  }, [generation]);
  return (
    <MemoryRouter initialEntries={["/"]}>
      <VaultProvider>
        {/* The board's cards hand a card to the chat dock, so the dock has to be
            up: `useChatDock` throws without it. */}
        <ChatDockProvider>
          {/* `key` forces VaultProvider to re-read the board, so a driver can
              change the lock behind the page and see it applied. */}
          <HomePage key={generation} />
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.dashboardLockRender = (generation) => {
  root.render(
    <StrictMode>
      <Harness generation={generation} />
    </StrictMode>,
  );
  return true;
};

harness.dashboardLockReady = true;
harness.dashboardLockSkin = skinName;
