/**
 * Design surface for the Dashboard with the chatbar open.
 *
 * What is real here: the shipping `AppShell`, the shipping `HomePage`
 * (the Dashboard), the shipping `ChatPanel`, the shipping CSS, the shipping
 * layout engine and the app's own dark skin. The chat dock starts open because
 * that is the shipping default in `ChatDockProvider` (`useState(true)`).
 *
 * What is stubbed, and why: the app only renders inside Electron, where a
 * preload hands the page `window.lifequest`. A browser page has no preload, so
 * the IPC bridge is replaced with seeded answers — the same seam the app's own
 * rigs use. Stub rules:
 *  1. Bridge stubs masking real calls — anything the shell reaches for that is
 *     not named here must not throw (hence the Proxy fallback).
 *  2. Seeded vault — one domain, two saved views and their runs, so the board's
 *     cards are the app's real cards drawing real content.
 *  3. Ready flag — a reader waits on `dashboardChatbarReady` rather than a
 *     timer, so a slow first Vite transform cannot be mistaken for a blank
 *     canvas.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ComposedViewRunResult,
  DatabaseMeta,
  DomainRecord,
  PageListEntry,
  Pin,
  SavedView,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import HomePage from "@/pages/HomePage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first, so the canvas paints the palette the operator runs.
const skinName = applyAppSkin("dark");

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const NOW = "2026-10-08T00:00:00.000Z";

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Design Vault",
    createdAt: NOW,
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
        createdAt: NOW,
        updatedAt: NOW,
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

const SYS = (system: string): Pin => ({
  id: `sys:${system}`,
  kind: "system",
  system: system as Extract<Pin, { kind: "system" }>["system"],
});

const SEED: Pin[] = [
  SYS("goal-progress"),
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: "v-weekly", span: 1 },
  SYS("today-week"),
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: "v-summary", span: 2 },
  SYS("pending-decisions"),
  SYS("recent-log"),
];

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
            ["2026-W37", 1148],
            ["2026-W38", 1180],
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
        result: { columns: ["label", "value"], rows: [["value", 7028.34]], warnings: [], currency: "ZAR" },
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

const SESSION = {
  id: "harness-session",
  title: "Design review",
  preview: "Dashboard and chatbar",
  lastActive: 1_700_000_000,
};

const TRANSCRIPT = [
  { role: "user" as const, content: "How is the quarter tracking?" },
  {
    role: "assistant" as const,
    content:
      "Spending is up 14% month on month, mostly transport. Three goals are on pace; the writing goal is two weeks behind. Nothing needs a decision yet.",
  },
];

/**
 * The chat panel's composer needs a model catalog, or the pills render no row.
 * One reasoning-capable model and one without, matching the shapes the control
 * branches on.
 */
const MODEL_CATALOG = {
  providers: [
    {
      slug: "nous",
      name: "Nous Portal",
      authenticated: true,
      models: [
        { id: "stealth/space-bunny-alpha", reasoning: true, canDisableReasoning: true, fast: false },
        { id: "openai/gpt-6-sol", reasoning: true, canDisableReasoning: true, fast: true },
      ],
    },
  ],
  current: { model: "stealth/space-bunny-alpha", provider: "nous" },
};

const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainGetActive: () => ok(null),
  decisionList: () => ok([]),
  logList: () => ok([]),
  pageList: () => ok(PAGES),
  viewList: () => ok([VIEW_WEEKLY, VIEW_SUMMARY] as SavedView[]),
  viewGet: (_slug: unknown, viewId: unknown) => {
    const view = [VIEW_WEEKLY, VIEW_SUMMARY].find((v) => v.id === viewId);
    return view ? ok(view) : { ok: false, error: `View not found: ${String(viewId)}` };
  },
  viewRunSaved: (slug: unknown, viewId: unknown) => {
    const run = RUNS[`${String(slug)}::${String(viewId)}`];
    return run ? ok(run) : { ok: false, error: `View not found: ${String(viewId)}` };
  },
  dbGet: () => ok(DATABASE),
  kitList: () => ok([]),
  deadlineGetDismissed: () => ok(false),
  deadlineMaybeNotify: () => ok(null),
  deadlineDismiss: () => ok(true),
  goalsApply: () => ok({}),
  pinsList: () => ok({ pins: SEED, locked: false }),
  pinsSetLocked: (_boardSlug: unknown, locked: unknown) =>
    ok({ pins: SEED, locked: locked === true }),
  pinsSet: (_boardSlug: unknown, pins: unknown) => ok({ applied: true, pins: pins as Pin[], locked: false }),
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok(TRANSCRIPT),
  companionModelOptions: () => ok(MODEL_CATALOG),
  companionChatStream: () => ok(true),
  companionRunStop: () => ok(true),
  onCompanionStream: () => () => {},
  // Mirrors the shipped window: overlay caption buttons, so the titlebar shows
  // its trailing cluster (theme, settings, chat) and not the fallback controls.
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from dashboard-chatbar.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <ThemeProvider>
        <VaultProvider>
          {/* The dock is open by shipping default; nothing here closes it. */}
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/home" element={<HomePage />} />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

/**
 * Settles once the shell, the board and the chat panel are all mounted, so a
 * reader never samples a half-painted page. Two frames because the first commit
 * and the first paint are not the same moment.
 */
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForShell = () => {
  const shell = document.querySelector(".shell");
  const chat = document.querySelector(".chat-panel");
  const board = document.querySelector(".home-dashboard");
  if (!shell || !chat || !board) {
    requestAnimationFrame(waitForShell);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForShell);

type HarnessWindow = Window & {
  dashboardChatbarReady?: Promise<void>;
  dashboardChatbarSkin?: string;
};

const harness = window as HarnessWindow;
harness.dashboardChatbarReady = ready;
harness.dashboardChatbarSkin = skinName;
