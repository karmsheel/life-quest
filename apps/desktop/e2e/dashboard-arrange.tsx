/**
 * E2E harness page for arranging the Dashboard's cards (`pages/HomePage`).
 *
 * HomePage is where a board's order becomes something the operator does rather
 * than something the file says: the chrome lifts a card, the board's own reflow
 * shows where it will land, and one drop is one write. That is what this rig
 * renders — the real page, with the IPC bridge stubbed.
 *
 * The board is SEVEN pins on purpose. A rig cannot prove that "move up" used to
 * mean "move left" on a board with one row, and it cannot prove that a wide card
 * is droppable at all without one. So the seeded order contains both wrap points
 * and a span-2 card, and every claim about order is an exact id array:
 *
 *   sys:goal-progress · view:financial:v-weekly (1 cell) · page:financial:ledger ·
 *   sys:today-week · view:financial:v-summary (full row) · sys:pending-decisions ·
 *   sys:recent-log
 *
 * The grid sits in a fixed-height, fixed-width scrollport so the column count is
 * deterministic and a long board is actually scrollable: the auto-scroll claim
 * needs a board taller than the box it is in.
 *
 * The bridge is a recording stub, deliberately small: every method the page
 * calls is listed, and anything else answers `{ ok: false }` and is NAMED in
 * `dashboardArrangeUnexpectedCalls`, so a page that grows a new dependency fails
 * the run loudly instead of rendering a quietly empty board. `pinsSet` records
 * every write in `dashboardArrangePinWrites`, which is how "one drop is one
 * write" and "a hold writes nothing" are falsified; `dashboardArrangeSetRefuse`
 * makes the next write answer `applied: false`, which is the locked-underneath
 * case the page must not lie about.
 *
 * The driver waits on `dashboardArrangeCommits`, bumped from an effect after
 * React has committed, so it never samples a half-painted page.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  ComposedViewRunResult,
  DatabaseMeta,
  DomainRecord,
  PageListEntry,
  Pin,
  PinBoardRead,
  SavedView,
  VaultSnapshot,
} from "@lifequest/vault-core";
import HomePage from "@/pages/HomePage";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the board the operator sees, so it
// has to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

/** The board the harness serves, and every write the page made. */
type BoardState = {
  pins: Pin[];
  locked: boolean;
};

/** One pin as the rig names it: id, and what its card is for. */
const SYS = (system: string): Pin => ({
  id: `sys:${system}`,
  kind: "system",
  system: system as Extract<Pin, { kind: "system" }>["system"],
});

/** The seeded order. Seven pins, one wide card, three columns at this width. */
const SEED: Pin[] = [
  SYS("goal-progress"),
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: "v-weekly", span: 1 },
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "ledger" },
  SYS("today-week"),
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: "v-summary", span: 2 },
  SYS("pending-decisions"),
  SYS("recent-log"),
];

type HarnessWindow = Window & {
  dashboardArrangeReady?: boolean;
  dashboardArrangeCommits?: number;
  dashboardArrangeCalls?: string[];
  dashboardArrangeUnexpectedCalls?: string[];
  dashboardArrangeSkin?: string;
  dashboardArrangeState?: BoardState;
  dashboardArrangePinWrites?: Pin[][];
  dashboardArrangeSetBoard?: (pins: Pin[], locked: boolean) => boolean;
  dashboardArrangeSetRefuse?: (refuse: boolean) => boolean;
  dashboardArrangeRender?: (generation: number) => boolean;
};

const harness = window as HarnessWindow;

harness.dashboardArrangeCalls = [];
harness.dashboardArrangeUnexpectedCalls = [];
harness.dashboardArrangePinWrites = [];

const state: BoardState = { pins: [...SEED], locked: false };
harness.dashboardArrangeState = state;

/** When true, the next `pinsSet` answers `applied: false` — the locked race. */
let refuseWrite = false;

/** When true, `pinsSet` answers `{ ok: false }` — the write that failed. */
let failWrite = false;

/** One live domain, so the board can pin its pages and views. */
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

const NOW = "2026-10-08T00:00:00.000Z";

/** A page pin's card names the page the board lists, so the list has to have it. */
const PAGES: PageListEntry[] = [
  {
    domainSlug: "financial",
    page: {
      id: "ledger",
      domainSlug: "financial",
      title: "Ledger",
      blocks: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  },
];

/** A saved view: the card draws the run below, so only the title is load-bearing here. */
function savedView(id: string, title: string, presentation: SavedView["presentation"]): SavedView {
  return {
    schemaVersion: 1,
    id,
    title,
    presentation,
    databaseId: "finance:transactions",
    groupBy: presentation === "table" ? "week" : null,
    timeBucket: presentation === "table" ? "week" : null,
    timeColumnId: "occurred_on",
    timeWindow: { kind: "last-weeks", weeks: 5 },
    filters: [],
    measure: "sum",
    measureColumnId: "amount",
    sort: { by: "label", dir: "asc" },
    limit: 12,
    convertToZar: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const VIEW_WEEKLY = savedView("v-weekly", "Weekly expenses", "table");
const VIEW_SUMMARY = savedView("v-summary", "Spending by month", "metric");

/**
 * The database both views read. `ViewCard` asks for it to decide which
 * presentations a block may switch to, so answering it is what makes the board's
 * cards the app's cards rather than a reduced version of them.
 */
const DATABASE: DatabaseMeta = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-only",
  adapter: null,
  columns: [
    { id: "occurred_on", name: "Occurred on", type: "date" },
    { id: "amount", name: "Amount", type: "number" },
    { id: "week", name: "Week", type: "text" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const RUNS: Record<string, ComposedViewRunResult> = {
  "financial::v-weekly": {
    title: VIEW_WEEKLY.title,
    blocks: [
      {
        id: "week-by-week",
        title: "Week by week",
        presentation: "table",
        result: {
          columns: ["label", "value"],
          rows: [
            ["2026-W36", 1111],
            ["2026-W37", 1114],
            ["2026-W38", 1148],
            ["2026-W39", 1265],
            ["2026-W40", 2390.34],
          ],
          warnings: [],
          currency: "ZAR",
        },
      },
    ],
    warnings: [],
  },
  "financial::v-summary": {
    title: VIEW_SUMMARY.title,
    blocks: [
      {
        id: "total",
        title: "Total",
        presentation: "metric",
        result: {
          columns: ["label", "value"],
          rows: [["value", 7028.34]],
          warnings: [],
          currency: "ZAR",
        },
      },
      {
        id: "by-month",
        title: "Month by month",
        presentation: "table",
        result: {
          columns: ["label", "value"],
          rows: [
            ["2026-06", 1204],
            ["2026-07", 1310],
            ["2026-08", 1180],
          ],
          warnings: [],
          currency: "ZAR",
        },
      },
    ],
    warnings: [],
  },
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
    pageList: async () => ok(PAGES),
    viewList: async () => ok([VIEW_WEEKLY, VIEW_SUMMARY] as SavedView[]),
    viewGet: async (_slug: unknown, viewId: unknown) => {
      const view = [VIEW_WEEKLY, VIEW_SUMMARY].find((v) => v.id === viewId);
      return view ? ok(view) : { ok: false, error: `View not found: ${String(viewId)}` };
    },
    viewRunSaved: async (slug: unknown, viewId: unknown) => {
      const run = RUNS[`${String(slug)}::${String(viewId)}`];
      return run ? ok(run) : { ok: false, error: `View not found: ${String(viewId)}` };
    },
    dbGet: async () => ok(DATABASE),
    kitList: async () => ok([]),
    deadlineGetDismissed: async () => ok(false),
    deadlineMaybeNotify: async () => ok(null),
    deadlineDismiss: async () => ok(true),
    goalsApply: async () => ok({}),
    pinsList: async () => ok({ pins: state.pins, locked: state.locked } satisfies PinBoardRead),
    pinsSetLocked: async (_boardSlug: unknown, locked: unknown) => {
      state.locked = locked === true;
      return ok({ pins: state.pins, locked: state.locked } satisfies PinBoardRead);
    },
    pinsSet: async (_boardSlug: unknown, pins: unknown) => {
      harness.dashboardArrangePinWrites!.push(pins as Pin[]);
      if (failWrite) return { ok: false, error: "the vault refused the write" };
      if (refuseWrite) return ok({ applied: false, decision: { id: "d1" }, locked: true });
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
        harness.dashboardArrangeCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.dashboardArrangeUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/** Install a board before the page reads it; re-render with `renderDashboard`. */
harness.dashboardArrangeSetBoard = (pins, locked) => {
  state.pins = pins;
  state.locked = locked;
  return true;
};

harness.dashboardArrangeSetRefuse = (refuse) => {
  refuseWrite = refuse;
  return true;
};

/** The write that fails outright, as distinct from the one that is refused. */
(window as unknown as { dashboardArrangeSetFail?: (fail: boolean) => boolean }).dashboardArrangeSetFail = (
  fail,
) => {
  failWrite = fail;
  return true;
};

function Harness({ generation }: { generation: number }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.dashboardArrangeCommits = commits.current;
  }, [generation]);
  /**
   * A fixed-width, fixed-height scrollport: the column count has to be the same
   * on every machine for a row claim to mean anything, and the board has to be
   * taller than its box for auto-scroll to have somewhere to go.
   *
   * 700 px is not arbitrary either: it is tall enough that the board's first
   * three rows — including the side-by-side pair a "cell to the left" claim needs
   * — are on screen, so a drag can start and end on real, hittable cards. The
   * board's own scroll height is over twice that, which is what the auto-scroll
   * claim uses.
   */
  return (
    <div style={{ width: 1000, margin: "0 auto" }}>
      <div className="arrange-scroll" style={{ height: 700, overflowY: "auto" }}>
        <MemoryRouter initialEntries={["/"]}>
          <VaultProvider>
            {/* `key` forces VaultProvider to re-read the board, so a driver can
                change the board behind the page and see it applied. */}
            <HomePage key={generation} />
          </VaultProvider>
        </MemoryRouter>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.dashboardArrangeRender = (generation) => {
  root.render(
    <StrictMode>
      <Harness generation={generation} />
    </StrictMode>,
  );
  return true;
};

harness.dashboardArrangeReady = true;
harness.dashboardArrangeSkin = skinName;

