/**
 * E2E harness page for the Dashboard's card controls (`pages/HomePage`).
 *
 * Two things are judged here, and they are the two halves of one idea — that the
 * board is the page, and that a card on it can be put in front of the chat:
 *
 *  1. The pin board is a header control now, open on request, sitting above the
 *     grid it adds to. A locked board has no add path at all.
 *  2. Every pinned card carries a chat control beside its editing chrome, and
 *     clicking it puts that card — with the name off its own heading — into the
 *     dock's context.
 *
 * The board is the arrange rig's seven pins on purpose: a view, a page and five
 * built-ins, so "every kind of card offers the control" is a claim about all
 * three kinds rather than about the one the rig happened to seed. The grid is
 * three columns wide at this width, and `view:financial:v-weekly` carries a real
 * title ("Weekly expenses") so the name read off a heading is falsifiable
 * against the id it must not be.
 *
 * The bridge is a recording stub, deliberately small: every method the page
 * calls is listed, and anything else answers `{ ok: false }` and is NAMED in
 * `dashboardCardContextUnexpectedCalls`, so a page that grows a new dependency
 * fails the run loudly instead of rendering a quietly empty board.
 *
 * `ChatDockProbe` is the seam for the second half: it mirrors the dock's context
 * to `window.dashboardCardContextDock` and installs a setter, so a driver can
 * read what the card control handed over.
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
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { ChatDockProbe } from "./chat-dock-probe";
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

/** The seeded order: a view, a page, and five built-ins. */
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
  dashboardCardContextReady?: boolean;
  dashboardCardContextCommits?: number;
  dashboardCardContextCalls?: string[];
  dashboardCardContextUnexpectedCalls?: string[];
  dashboardCardContextSkin?: string;
  dashboardCardContextState?: BoardState;
  dashboardCardContextPinWrites?: Pin[][];
  /** Every destructive write the page made, in order. */
  dashboardCardContextDeletes?: { kind: "view" | "page"; slug: string; id: string }[];
  dashboardCardContextSetBoard?: (pins: Pin[], locked: boolean) => boolean;
  dashboardCardContextRender?: (generation: number) => boolean;
};

const harness = window as HarnessWindow;

harness.dashboardCardContextCalls = [];
harness.dashboardCardContextUnexpectedCalls = [];
harness.dashboardCardContextPinWrites = [];
harness.dashboardCardContextDeletes = [];

const state: BoardState = { pins: [...SEED], locked: false };
harness.dashboardCardContextState = state;

/** One live domain, so the board can list its pages and views to add. */
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
  // Two open goals, so the goals card paints its count badge — the case that
  // proves a card's name is its heading and not its whole subtree. The second
  // carries a deadline three days out, which is what draws the deadline banner:
  // that pin is not a card, and it is the one place the tool row is laid out
  // differently, so it has to be reachable from a claim.
  goals: [
    {
      id: "g-run",
      name: "Run 5k",
      notes: "",
      status: "open",
      domainSlug: null,
      deadline: null,
      metric: null,
      target: null,
      definitionOfDone: null,
      current: null,
    },
    {
      id: "g-renew",
      name: "Renew the passport",
      notes: "",
      status: "open",
      domainSlug: null,
      deadline: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      metric: null,
      target: null,
      definitionOfDone: null,
      current: null,
    },
  ],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const NOW = "2026-10-09T00:00:00.000Z";

/** One page the board can offer, and the page pin's card names. */
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

/** A saved view. Only the title is load-bearing for these claims. */
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
 * The vault this rig serves, as two mutable stores.
 *
 * A delete has to be able to take something *out* of the vault, or "the card
 * leaves the board" would be a claim about a stub's bookkeeping instead of about
 * the read path that really decides it.
 */
const views: SavedView[] = [VIEW_WEEKLY, VIEW_SUMMARY];
const pages: PageListEntry[] = [...PAGES];

/** The database both views read, for the card's own presentation menu. */
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
    ],
    warnings: [],
  },
};

/**
 * The board as the vault would hand it back.
 *
 * The same validation `listPinBoard` applies: a view or page pin whose file is
 * gone is dropped from the read, so deleting the thing behind a card is what
 * takes the card off the board — this rig never rewrites a pin list to make that
 * true. A stub that answered `state.pins` verbatim would let a dead card sit on a
 * board the real app would never draw it on, and every delete claim would be
 * about the rig's own bookkeeping instead.
 */
function livePins(): Pin[] {
  return state.pins.filter((pin) => {
    if (pin.kind === "system") return true;
    if (pin.kind === "view") return views.some((v) => v.id === pin.viewId);
    return pages.some((e) => e.page.id === pin.pageId && e.domainSlug === pin.domainSlug);
  });
}

/**
 * Every bridge method the page uses, with the value it answers. A method the
 * page calls that is not here is recorded and answered `{ ok: false }`, so the
 * run reports it by name.
 */
function bridge(): Record<string, (...args: unknown[]) => Promise<unknown>> {  return {
    vaultGetSnapshot: async () => ok(SNAPSHOT),
    vaultListRecent: async () => [],
    domainGetActive: async () => null,
    onVaultFileChanged: () => () => {},
    decisionList: async () => ok([]),
    logList: async () => ok([]),
    pageList: async () => ok(pages),
    viewList: async () => ok(views.slice()),
    viewGet: async (_slug: unknown, viewId: unknown) => {
      const view = views.find((v) => v.id === viewId);
      return view ? ok(view) : { ok: false, error: `View not found: ${String(viewId)}` };
    },    viewRunSaved: async (slug: unknown, viewId: unknown) => {
      const run = RUNS[`${String(slug)}::${String(viewId)}`];
      return run ? ok(run) : { ok: false, error: `View not found: ${String(viewId)}` };
    },
    dbGet: async () => ok(DATABASE),
    kitList: async () => ok([]),
    deadlineGetDismissed: async () => ok(false),
    deadlineMaybeNotify: async () => ok(null),
    deadlineDismiss: async () => ok(true),
    goalsApply: async () => ok({}),
    pinsList: async () => ok({ pins: livePins(), locked: state.locked } satisfies PinBoardRead),
    pinsSetLocked: async (_boardSlug: unknown, locked: unknown) => {
      state.locked = locked === true;
      return ok({ pins: state.pins, locked: state.locked } satisfies PinBoardRead);
    },
    pinsSet: async (_boardSlug: unknown, pins: unknown) => {
      harness.dashboardCardContextPinWrites!.push(pins as Pin[]);
      state.pins = pins as Pin[];
      return ok({ applied: true, pins: state.pins, locked: state.locked });
    },
    /**
     * The two destructive writes, stubbed the way the vault behaves rather than
     * the way a mock would: the view or the page is taken out of the harness's
     * own store and nothing else is touched. `pinsList` then stops answering for
     * the pin that pointed at it, which is `listPinBoard`'s own rule — so "the
     * card leaves the board" is the read path's doing, not the rig's.
     */
    viewDelete: async (slug: unknown, viewId: unknown) => {
      harness.dashboardCardContextDeletes!.push({ kind: "view", slug: String(slug), id: String(viewId) });
      const index = views.findIndex((v) => v.id === viewId);
      if (index === -1) return { ok: false, error: `View not found: ${String(viewId)}` };
      views.splice(index, 1);
      return ok({ id: String(viewId) });
    },
    pageDelete: async (slug: unknown, pageId: unknown) => {
      harness.dashboardCardContextDeletes!.push({ kind: "page", slug: String(slug), id: String(pageId) });
      const index = pages.findIndex((e) => e.page.id === pageId && e.domainSlug === slug);
      if (index === -1) return { ok: false, error: `Page not found: ${String(pageId)}` };
      pages.splice(index, 1);
      return ok({ id: String(pageId) });
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
        harness.dashboardCardContextCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.dashboardCardContextUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/** Install a board before the page reads it; re-render with `render`. */
harness.dashboardCardContextSetBoard = (pins, locked) => {
  state.pins = pins;
  state.locked = locked;
  return true;
};

function Harness({ generation }: { generation: number }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.dashboardCardContextCommits = commits.current;
  }, [generation]);
  return (
    <div style={{ width: 1180, margin: "0 auto" }}>
      <MemoryRouter initialEntries={["/"]}>
        <VaultProvider>
          <ChatDockProvider>
            <ChatDockProbe channel="dashboardCardContext" />
            {/* `key` forces VaultProvider to re-read the board, so a driver can
                change the board behind the page and see it applied. */}
            <HomePage key={generation} />
          </ChatDockProvider>
        </VaultProvider>
      </MemoryRouter>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

harness.dashboardCardContextRender = (generation) => {
  root.render(
    <StrictMode>
      <Harness generation={generation} />
    </StrictMode>,
  );
  return true;
};

harness.dashboardCardContextReady = true;
harness.dashboardCardContextSkin = skinName;
