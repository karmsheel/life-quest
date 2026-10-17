/**
 * E2E harness page for the dashboard's TILES (`pages/HomePage`).
 *
 * The board this renders is the operator's own board, reduced to the shapes that
 * matter, and one of them is the reported fault: a pin stored ONE cell wide whose
 * content is a four-column listing. Measured in the operator's vault, "Recent
 * transactions" is exactly that — the view file says `span: 2` and the pin on the
 * Financial board says `span: 1`, so the card was given one 17rem cell and its
 * nowrap table painted outside the card's frame. This harness keeps that
 * disagreement on purpose: `v-listing` carries `span: 2` in the view, the pin
 * carries `span: 1`, and the board is the thing under test.
 *
 * The rest of the board is the control around it:
 *
 *   sys:goal-progress          a card drawn as furniture (`.home-card--wide`)
 *                              — the row is ITS, and no measurement may take it
 *   view:financial:v-listing   a controlled wide card: 4 columns, every payee a
 *                              single long word, pin span 1
 *   view:financial:v-metric    one number, which fits one cell — a card that must
 *                              NOT be widened just because its neighbour was
 *   page:financial:ledger      a page card: text, one cell
 *   view:financial:v-row       pin span 2 — the operator's "fill the row"
 *   view:financial:v-ledger    a five-column listing: a second card that has to
 *                              ask for more than one cell
 *   sys:pending-decisions      a plain system card
 *   view:financial:v-real      THE REPORTED CARD: the operator's own twelve rows,
 *                              their own four columns, their own view file's
 *                              `span: 2`, and a pin that says `span: 1`
 *
 * Eight pins and the Active-agents card the page draws for itself. A board of
 * every card the same size proves nothing about a board that sizes its cards, so
 * the fixture is deliberately mixed — and the driver's claims are about the mix.
 *
 * The bridge is a recording stub, as in `dashboard-arrange.tsx`: every method the
 * page calls is listed, anything else is NAMED in
 * `dashboardTileUnexpectedCalls` and answered `{ ok: false }`, and `pinsSet`
 * records what it was asked to write. Nothing here writes to a vault: the page is
 * the thing under test, not the store.
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
import { setDeveloperFlag } from "@/state/developer-flags";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the board the operator sees, so it
// has to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const SYS = (system: string): Pin => ({
  id: `sys:${system}`,
  kind: "system",
  system: system as Extract<Pin, { kind: "system" }>["system"],
});

/** The board: the operator's card last, and a mix of widths around it. */
const SEED: Pin[] = [
  SYS("goal-progress"),
  { id: "view:financial:v-listing", kind: "view", domainSlug: "financial", viewId: "v-listing", span: 1 },
  { id: "view:financial:v-metric", kind: "view", domainSlug: "financial", viewId: "v-metric", span: 1 },
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "ledger" },
  { id: "view:financial:v-row", kind: "view", domainSlug: "financial", viewId: "v-row", span: 2 },
  { id: "view:financial:v-ledger", kind: "view", domainSlug: "financial", viewId: "v-ledger", span: 1 },
  SYS("pending-decisions"),
  { id: "view:financial:v-real", kind: "view", domainSlug: "financial", viewId: "v-real", span: 1 },
];

type HarnessWindow = Window & {
  dashboardTileReady?: boolean;
  dashboardTileCommits?: number;
  dashboardTileSkin?: string;
  dashboardTilePins?: Pin[];
  dashboardTileCalls?: string[];
  dashboardTileUnexpectedCalls?: string[];
  dashboardTilePinWrites?: Pin[][];
  dashboardTileSetBoard?: (pins: Pin[], locked: boolean) => boolean;
  dashboardTileSetFlag?: (on: boolean) => boolean;
  dashboardTileRender?: (generation: number) => boolean;
};

const harness = window as HarnessWindow;

harness.dashboardTileCalls = [];
harness.dashboardTileUnexpectedCalls = [];
harness.dashboardTilePinWrites = [];

const state: { pins: Pin[]; locked: boolean } = { pins: [...SEED], locked: false };
harness.dashboardTilePins = state.pins;

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

const NOW = "2026-10-16T00:00:00.000Z";

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

/** The database every view in this fixture reads. */
const DATABASE: DatabaseMeta = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-only",
  adapter: null,
  columns: [
    { id: "date", name: "Date", type: "date" },
    { id: "payee", name: "Payee", type: "text" },
    { id: "category", name: "Category", type: "relation" },
    { id: "account", name: "Account", type: "relation" },
    { id: "amount", name: "Amount", type: "number" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

/**
 * The reported card's rows, as the operator's ledger actually holds them.
 *
 * Two things in this fixture are load-bearing. Every cell is one the card's CSS
 * refuses to wrap — the date, the category and the amount are nowrap by rule, and
 * the payees are single long words, which is the same thing by content — so the
 * table's min-content width is a real one and the card has to ask for more than
 * one cell. And the dates and amounts are long enough that the four columns
 * together cannot fit a 17rem cell in any font.
 */
const LISTING_ROWS = [
  ["2026-10-14", "PicknPayGroceries", "Groceries", -1284.5],
  ["2026-10-12", "WoolworthsFoodStop", "Groceries", -1102.25],
  ["2026-10-12", "VirginActiveGym", "Fitness", -580],
  ["2026-10-10", "EngenPetrolStation", "Energy", -300.75],
  ["2026-10-10", "BraaiHutRestaurant", "Food", -105],
  ["2026-10-08", "Dis-ChemPharmacy", "Health", -247.4],
];

/** The second wide card: five columns, so it asks for more than one cell too. */
const LEDGER_ROWS = [
  ["2026-10-14", "PicknPayGroceries", "Groceries", "Capitec", -1284.5],
  ["2026-10-12", "WoolworthsFoodStop", "Groceries", "Capitec", -1102.25],
  ["2026-10-10", "EngenPetrolStation", "Energy", "Discovery", -300.75],
  ["2026-10-08", "Dis-ChemPharmacy", "Health", "Capitec", -247.4],
];

/**
 * THE REPORTED CARD, row for row out of the operator's own vault.
 *
 * These twelve lines are what `view:run` returned for
 * `view:financial:4e864d44-4aa6-488d-81ea-3cc63e395434` on the real board, and
 * the title, the four columns and the pin's stored span are that card's own. It
 * is here so the run does not rest on content the rig invented: the claim
 * `operator-card` is made about exactly the data the operator was looking at when
 * they reported the spill.
 */
const OPERATOR_ROWS = [
  ["2026-10-14", "- Weed", "Weed", -25],
  ["2026-10-12", "Food", "Food", -102],
  ["2026-10-12", "Gym", "Fitness", -580],
  ["2026-10-10", "on petrol", "Energy", -300],
  ["2026-10-10", "on weed", "Weed", -105],
  ["2026-10-10", "on Food", "Food", -47],
  ["2026-10-10", "on Groceries", "Groceries", -100],
  ["2026-10-08", "on Food", "Food", -13],
  ["2026-10-08", "on Weed", "Weed", -25],
  ["2026-10-05", "BraaiHut", "Food", -47],
  ["2026-10-05", "PicknPay groceries", "Groceries", -128],
  ["2026-10-04", "food expense", "Food", -12],
];

function savedView(
  id: string,
  title: string,
  presentation: SavedView["presentation"],
  extra: Partial<SavedView> = {},
): SavedView {
  return {
    schemaVersion: 1,
    id,
    title,
    presentation,
    databaseId: "finance:transactions",
    groupBy: presentation === "table" ? "week" : null,
    timeBucket: presentation === "table" ? "week" : null,
    timeColumnId: "date",
    timeWindow: "all",
    filters: [],
    measure: "sum",
    measureColumnId: "amount",
    sort: { by: "label", dir: "asc" },
    limit: 12,
    convertToZar: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const VIEW_LISTING = savedView("v-listing", "Last two weeks", "list", {
  // The view file's own span, exactly as the operator's does — and NOT what the
  // pin says. The board is what decides a card's width; this is the disagreement
  // the rig exists to hold still.
  span: 2,
  columns: ["date", "payee", "category", "amount"],
} as Partial<SavedView>);
const VIEW_METRIC = savedView("v-metric", "This month", "metric");
const VIEW_ROW = savedView("v-row", "Spending by month", "table", { span: 2 });
const VIEW_LEDGER = savedView("v-ledger", "Ledger lines", "list", {
  span: 2,
  columns: ["date", "payee", "category", "account", "amount"],
} as Partial<SavedView>);
/** The operator's own card: their title, their columns, their store's span 2. */
const VIEW_OPERATOR = savedView("v-real", "Recent transactions", "list", {
  span: 2,
  columns: ["date", "payee", "category", "amount"],
} as Partial<SavedView>);

const VIEWS = [VIEW_LISTING, VIEW_METRIC, VIEW_ROW, VIEW_LEDGER, VIEW_OPERATOR];

function listResult(
  columns: string[],
  rows: (string | number)[][],
  currencyColumn: string,
): ComposedViewRunResult {
  return {
    title: "",
    blocks: [
      {
        id: "block-1",
        title: "",
        presentation: "list",
        result: {
          columns,
          rows: [],
          listRows: rows,
          currencyColumn,
          warnings: ["Showing 12 of 60 rows."],
          currency: "ZAR",
        },
      },
    ],
    warnings: ["Showing 12 of 60 rows."],
  };
}

const RUNS: Record<string, ComposedViewRunResult> = {
  "financial::v-listing": listResult(
    ["date", "payee", "category", "amount"],
    LISTING_ROWS,
    "amount",
  ),
  "financial::v-metric": {
    title: VIEW_METRIC.title,
    blocks: [
      {
        id: "total",
        title: "Total",
        presentation: "metric",
        result: {
          columns: ["label", "value"],
          rows: [["value", 4218.9]],
          warnings: [],
          currency: "ZAR",
        },
      },
    ],
    warnings: [],
  },
  "financial::v-row": {
    title: VIEW_ROW.title,
    blocks: [
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
  "financial::v-ledger": listResult(
    ["date", "payee", "category", "account", "amount"],
    LEDGER_ROWS,
    "amount",
  ),
  "financial::v-real": listResult(
    ["date", "payee", "category", "amount"],
    OPERATOR_ROWS,
    "amount",
  ),
};

/**
 * Every bridge method the page uses, with the value it answers. A method the page
 * calls that is not here is recorded and answered `{ ok: false }`, so the run
 * reports it by name.
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
    viewList: async () => ok(VIEWS),
    viewGet: async (_slug: unknown, viewId: unknown) => {
      const view = VIEWS.find((v) => v.id === viewId);
      return view ? ok(view) : { ok: false, error: `View not found: ${String(viewId)}` };
    },
    viewRunSaved: async (slug: unknown, viewId: unknown) => {
      const run = RUNS[`${String(slug)}::${String(viewId)}`];
      return run ? ok(run) : { ok: false, error: `View not found: ${String(viewId)}` };
    },
    dbGet: async () => ok(DATABASE),
    kitList: async () => ok(["finance"]),
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
      harness.dashboardTilePinWrites!.push(pins as Pin[]);
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
        harness.dashboardTileCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.dashboardTileUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/**
 * The app's own page area, to the pixel: same padding as `.shell__content`, and
 * a width that follows the window.
 *
 * The width FOLLOWS the window rather than being fixed, which is the one thing
 * this rig does differently from the arrange harness: the claims are about what
 * the board does when the operator makes the window smaller, so the driver has to
 * be able to make it smaller.
 */
function Harness({ generation }: { generation: number }) {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.dashboardTileCommits = commits.current;
  }, [generation]);
  return (
    <div className="tile-scroll" style={{ height: "calc(100vh)", overflow: "auto", padding: "1.25rem 1.5rem 1.5rem" }}>
      <MemoryRouter initialEntries={["/"]}>
        <VaultProvider>
          {/* The page's cards hand a card to the chat dock, so the dock has to be
              up: `useChatDock` throws without it. The developer flags need no
              provider — they are a store, so a page mounted on its own reads and
              hears them exactly as the app's board does. */}
          <ChatDockProvider>
            <HomePage key={generation} />
          </ChatDockProvider>
        </VaultProvider>
      </MemoryRouter>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

/**
 * Install a board before the page reads it, and re-render.
 *
 * The locked leg needs the same board read-only — a locked dashboard draws no
 * width handle, because the width lives on the pin and a locked board makes no
 * pin writes — and that can only be asked for by handing the page a locked board,
 * which is what this is for.
 */
harness.dashboardTileSetBoard = (pins, locked) => {
  state.pins = pins;
  state.locked = locked;
  return true;
};

/**
 * Turn the card width handle on or off, the way Settings → Developer does.
 *
 * Through the app's OWN writer rather than by poking a key: the flag's storage name
 * is derived in one place (`developerFlagKey`), and a rig that spelled the key out
 * for itself would pass while the settings page wrote somewhere else. The store
 * announces the change, so the board in the window follows this call the same way
 * it follows the switch.
 */
harness.dashboardTileSetFlag = (on) => {
  setDeveloperFlag("cardWidthHandle", on);
  return true;
};

harness.dashboardTileRender = (generation) => {
  root.render(
    <StrictMode>
      <Harness generation={generation} />
    </StrictMode>,
  );
  return true;
};

harness.dashboardTileReady = true;
harness.dashboardTileSkin = skinName;
