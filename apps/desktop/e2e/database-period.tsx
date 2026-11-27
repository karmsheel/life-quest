/**
 * E2E harness for the Data page's period deep link, driven by
 * `database-period.electron.mjs`.
 *
 * The real shell, the real `DatabasePage` and the real stylesheet render here,
 * so what the driver reads is what the operator gets. Only the IPC bridge is
 * stubbed, and it is a *recording* stub: every method the page calls is modelled
 * and anything else answers `{ ok: false }` and is NAMED in
 * `databasePeriodUnexpectedCalls`, so a page that grows a dependency this rig
 * does not model fails the run loudly.
 *
 * The stub is also the database: `dbGet` serves one fixture `DatabaseMeta`
 * (a date column, a text column, a number column), `dbListRows` serves six rows
 * across three weeks, and `dbUpsertRow` appends to those rows so "Add row" is a
 * write the later reads can see. The three in-range rows are what a period link
 * must leave on screen; the other three are what it must not.
 *
 * ── How this can fail (written before the assertions) ─────────────────────────
 *
 *  1. The page ignores `?from=&to=&columnId=` and draws all six rows: the link
 *     proves nothing and the Analytics derived cell still opens a whole ledger.
 *  2. The page filters by the wrong column, by a prefix, or by the wrong bounds:
 *     the wrong three rows draw, or an out-of-range row stays.
 *  3. The chip is absent, names the wrong range or the wrong separator, or it is
 *     not in the Rows panel the operator is reading.
 *  4. Clearing the chip re-reads the URL and re-filters to nothing, or leaves
 *     the three params in the URL, so the link can never be widened back.
 *  5. A `columnId` that is not a date column (here the number column) is trusted:
 *     the page hides every row, or throws, instead of behaving as it does today.
 *  6. A malformed date is trusted (or crashes the page) instead of being
 *     ignored.
 *  7. The filter leaks into the edit/create path: Add row does not reach
 *     `dbUpsertRow`, does not reload, or the new row is dropped from the page
 *     entirely rather than simply being outside the period.
 *  8. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 *
 * ── How to read this file ────────────────────────────────────────────────────
 *
 * `FIXTURE` is the data. `bridge` is the recording stub over it. The driver
 * loads this page once per case, with the entry route in `?route=` because
 * `MemoryRouter` owns the URL inside the harness — a cold load is the only way
 * to exercise "the link is read as the page opens".
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  DatabaseColumn,
  DatabaseListEntry,
  DatabaseMeta,
  DatabaseRow,
} from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import DatabasePage from "@/pages/DatabasePage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/* ── the fixture database ──────────────────────────────────────────────────── */

const SLUG = "financial";
const DB_ID = "finance:transactions";

/** The range the deep-link cases ask for: the week of Mon 12 Oct 2026. */
const RANGE = { from: "2026-10-12", to: "2026-10-18", columnId: "date" };

const COLUMNS: DatabaseColumn[] = [
  { id: "date", name: "Date", type: "date" },
  { id: "payee", name: "Payee", type: "text" },
  { id: "amount", name: "Amount", type: "number" },
];

const META: DatabaseMeta = {
  id: DB_ID,
  name: "Transactions",
  sotMode: "local-only",
  adapter: null,
  columns: COLUMNS,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Six rows over three weeks: two in the week before the asked-for period, the
 * three the period holds, one in the week after. The in-range dates are the
 * claim — `2026-10-12`, `2026-10-14`, `2026-10-16` — and the payees make an
 * out-of-range row recognisable even if its date is misread.
 */
const FIXTURE_ROWS: DatabaseRow[] = [
  row("tx-1", "2026-10-03", "Grocer", -412.5),
  row("tx-2", "2026-10-08", "Fuel", -880),
  row("tx-3", "2026-10-12", "Rent", -12000),
  row("tx-4", "2026-10-14", "Coffee", -42),
  row("tx-5", "2026-10-16", "Salary", 24000),
  row("tx-6", "2026-10-21", "Books", -320),
];

function row(id: string, date: string, payee: string, amount: number): DatabaseRow {
  return {
    id,
    databaseId: DB_ID,
    domainSlug: SLUG,
    cells: { date, payee, amount },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** The rows the page reads; a write replaces this array so the next read sees it. */
let rows: DatabaseRow[] = FIXTURE_ROWS.map(copyRow);
let nextRowNumber = 7;

function copyRow(source: DatabaseRow): DatabaseRow {
  return { ...source, cells: { ...source.cells } };
}

function copyMeta(): DatabaseMeta {
  return { ...META, columns: META.columns.map((column) => ({ ...column })) };
}

/* ── the vault snapshot the shell draws ────────────────────────────────────── */

const SNAPSHOT = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "database-period-rig-vault",
    name: "Database Period Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: [
    {
      slug: SLUG,
      meta: {
        name: "Finance",
        description: null,
        color: null,
        sortOrder: 1,
        archivedAt: null,
        unlockedAt: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {},
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

const SESSION = {
  id: "database-period-rig-session",
  title: "Harness",
  preview: null,
  lastActive: 1_700_000_000,
  pinned: false,
  archived: false,
  model: null,
  source: "desktop",
};

/* ── the harness surface the driver reads ──────────────────────────────────── */

type WriteCall = {
  kind: "upsert";
  slug: string;
  dbId: string;
  id: string | null;
  cells: Record<string, unknown>;
};

type HarnessWindow = Window & {
  databasePeriodReady?: Promise<void>;
  databasePeriodSkin?: string;
  /** The MemoryRouter location as one string, e.g. `/data/financial/...#?from=`. */
  databasePeriodLocation?: string;
  databasePeriodCalls?: string[];
  databasePeriodUnexpectedCalls?: string[];
  /** Every successful `dbGet`: one per page load, however it was triggered. */
  databasePeriodLoads?: number;
  /** The row count the LAST `dbListRows` served. */
  databasePeriodRowsServed?: number;
  databasePeriodWrites?: WriteCall[];
  databasePeriodExpected?: {
    columns: Array<{ id: string; name: string; type: string }>;
    range: { from: string; to: string; columnId: string };
    dates: string[];
    inRangeDates: string[];
  };
  databasePeriodDataListenerCount?: () => number;
};

const harness = window as HarnessWindow;
harness.databasePeriodCalls = [];
harness.databasePeriodUnexpectedCalls = [];
harness.databasePeriodLoads = 0;
harness.databasePeriodRowsServed = 0;
harness.databasePeriodWrites = [];
harness.databasePeriodExpected = {
  columns: COLUMNS.map((column) => ({
    id: column.id,
    name: column.name,
    type: column.type,
  })),
  range: { ...RANGE },
  dates: FIXTURE_ROWS.map((entry) => String(entry.cells.date)),
  inRangeDates: FIXTURE_ROWS.filter((entry) => {
    const date = entry.cells.date;
    return typeof date === "string" && date >= RANGE.from && date <= RANGE.to;
  }).map((entry) => String(entry.cells.date)),
};
harness.databasePeriodSkin = skinName;

function record(call: string) {
  harness.databasePeriodCalls?.push(call);
}

/**
 * The vault's change signal. Every modelled write fires it after the data has
 * moved, exactly as main does once the IPC call has settled; `LiveDataProvider`
 * listens and bumps the page's live revision, which is one of the ways a write
 * reaches the screen.
 */
const dataChangeListeners = new Set<(revision: number) => void>();

function announceDataChanged(): number {
  for (const listener of [...dataChangeListeners]) {
    try {
      listener(Date.now());
    } catch {
      // A listener's failure is its own; the change it heard about still landed.
    }
  }
  return dataChangeListeners.size;
}

harness.databasePeriodDataListenerCount = () => dataChangeListeners.size;

/* ── the bridge: every method the page is allowed to reach ──────────────────── */

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: (cb: (revision: number) => void) => {
    dataChangeListeners.add(cb);
    return () => {
      dataChangeListeners.delete(cb);
    };
  },
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  // The dock's receipt chip asks main whether the kit is installed; this rig
  // runs without a finance kit, so the chip stays out of the way. It must be a
  // promise: ChatPanel chains `.then` on it.
  receiptReady: () => Promise.resolve({ ok: true as const, value: false }),
  themesList: () => ok([]),
  themeGetState: () => ok({ keptFile: null }),
  onThemesChanged: () => () => {},
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok([]),
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  pinsList: () => ok({ pins: [], locked: false }),
  decisionList: () => ok([]),
  onCompanionStream: () => () => {},
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },

  /* ── the DatabasePage's own reads and writes ─────────────────────────────── */

  dbGet: (slug: string, dbId: string) => {
    record(`dbGet:${slug}:${dbId}`);
    if (slug !== SLUG || dbId !== DB_ID) {
      return Promise.resolve(fail(`Unknown database: ${slug}/${dbId}`));
    }
    harness.databasePeriodLoads = (harness.databasePeriodLoads ?? 0) + 1;
    return Promise.resolve(ok(copyMeta()));
  },
  dbListRows: (slug: string, dbId: string) => {
    record(`dbListRows:${slug}:${dbId}`);
    if (slug !== SLUG || dbId !== DB_ID) {
      return Promise.resolve(fail(`Unknown database: ${slug}/${dbId}`));
    }
    harness.databasePeriodRowsServed = rows.length;
    return Promise.resolve(ok(rows.map(copyRow)));
  },
  dbList: (slug: string | null) => {
    record(`dbList:${slug ?? ""}`);
    const entry: DatabaseListEntry = { domainSlug: SLUG, database: copyMeta() };
    return Promise.resolve(ok([entry]));
  },
  ingestListBatches: (slug: string, dbId?: string) => {
    record(`ingestListBatches:${slug}:${dbId ?? ""}`);
    return Promise.resolve(ok([]));
  },
  dbListConflicts: (slug: string, dbId?: string) => {
    record(`dbListConflicts:${slug}:${dbId ?? ""}`);
    return Promise.resolve(ok([]));
  },
  dbUpsertRow: (
    slug: string,
    dbId: string,
    input: { id?: string; cells: Record<string, unknown> },
  ) => {
    record(`dbUpsertRow:${slug}:${dbId}:${input.id ?? "new"}`);
    harness.databasePeriodWrites?.push({
      kind: "upsert",
      slug,
      dbId,
      id: input.id ?? null,
      cells: { ...input.cells },
    });
    if (slug !== SLUG || dbId !== DB_ID) {
      return Promise.resolve(fail(`Unknown database: ${slug}/${dbId}`));
    }
    const existing = input.id ? rows.find((entry) => entry.id === input.id) : undefined;
    if (input.id && !existing) {
      return Promise.resolve(fail(`Row not found: ${input.id}`));
    }
    let id: string;
    let cells: Record<string, unknown>;
    if (existing) {
      id = existing.id;
      cells = { ...existing.cells, ...input.cells };
      rows = rows.map((entry) =>
        entry.id === existing.id
          ? { ...entry, cells, updatedAt: "2026-10-19T00:00:00.000Z" }
          : entry,
      );
    } else {
      id = `tx-${nextRowNumber}`;
      nextRowNumber += 1;
      cells = { ...input.cells };
      rows = [
        ...rows,
        {
          id,
          databaseId: DB_ID,
          domainSlug: SLUG,
          cells,
          createdAt: "2026-10-19T00:00:00.000Z",
          updatedAt: "2026-10-19T00:00:00.000Z",
        },
      ];
    }
    announceDataChanged();
    return Promise.resolve(ok({ id, cells: { ...cells } }));
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.databasePeriodUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

/* ── routing: the real page, entered cold from the route the driver names ───── */

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from database-period.html");

/**
 * A cold load carries the whole entry, search and all, in `?route=` because
 * `MemoryRouter` owns the URL in here. It is the deep link under test.
 */
const entry =
  new URLSearchParams(window.location.search).get("route") ??
  `/data/${SLUG}/${DB_ID}`;

/** Records the MemoryRouter's location for the driver to read after a click. */
function RouterControl() {
  const location = useLocation();
  // Written from an effect, not from render: `navigate` runs in a transition,
  // and a render-phase write would publish the new path before the page commits.
  useEffect(() => {
    harness.databasePeriodLocation = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[entry]}>
      <RouterControl />
      <ThemeProvider>
        <VaultProvider>
          <LiveDataProvider>
            <ChatDockProvider>
              <NavDockProvider>
                <div className="app-root">
                  <WindowTitleBar />
                  <div className="app-root__body">
                    <Routes>
                      <Route element={<AppShell />}>
                        <Route
                          path="/home"
                          element={
                            <div className="stub-page">
                              <h1 className="stub-page__title">Dashboard</h1>
                            </div>
                          }
                        />
                        <Route path="/data/:slug/:dbId" element={<DatabasePage />} />
                        <Route
                          path="/data"
                          element={
                            <div className="stub-page">
                              <h1 className="stub-page__title">Data</h1>
                            </div>
                          }
                        />
                      </Route>
                    </Routes>
                  </div>
                </div>
              </NavDockProvider>
            </ChatDockProvider>
          </LiveDataProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

/**
 * Ready means the shell AND the opened database committed AND its first row
 * read landed: a page that has drawn its table but not yet filled it would let
 * the first sample read zero rows as a filter result.
 */
const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const page = document.querySelector(".database-page");
  const table = document.querySelector(".database-page table.data-table");
  const drawn = table ? table.querySelectorAll("tbody tr").length > 0 : false;
  if (!rail || !page || !table || !drawn) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);
harness.databasePeriodReady = ready;
