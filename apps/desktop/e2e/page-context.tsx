/**
 * E2E harness page for the page-context pill.
 *
 * The claim this rig exists for crosses two panes: the screen the operator is
 * looking at is the screen the next turn quotes. So this page mounts BOTH ends
 * at once — a real `HomePage` (and a second, deliberately small Goals screen) in
 * the shell's content column, and the real `ChatPanel` beside it — inside the
 * app's own three-pane layout, with the real CSS and the real layout engine.
 * Only the IPC bridge is stubbed, because a dev-server page has no preload.
 *
 * `data-page-context-root` is on the content column here exactly as `AppShell`
 * puts it on the real one; the nav rail carries a marker that must never reach
 * the agent, so "the outline is the page and not the chrome" is a claim about
 * this document rather than about a selector someone liked.
 *
 * The stub records whole turns, and each record carries the instruction string
 * `buildInstructions` would build for that turn — the same call main makes
 * before it posts. That is what lets the rig assert the final text the model
 * reads, not just the field the renderer sent.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type {
  ComposedViewRunResult,
  DatabaseMeta,
  DomainRecord,
  Pin,
  PinBoardRead,
  SavedView,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import HomePage from "@/pages/HomePage";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import {
  buildInstructions,
  type CompanionInstructionsInput,
} from "../electron/companion-client.ts";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** The chrome marker: text that belongs to the rail, never to a page. */
const RAIL_MARKER = "RAIL-CHROME-MARKER";

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Page context harness",
  lastActive: 1_700_000_000,
  pinned: false,
};

const NOW = "2026-10-09T00:00:00.000Z";

/**
 * The board the Dashboard reads: one expense summary, which is exactly the card
 * the reported failure offered to build a second time.
 */
const BOARD: Pin[] = [
  {
    id: "view:financial:v-weekly",
    kind: "view",
    domainSlug: "financial",
    viewId: "v-weekly",
    span: 2,
  },
];

const VIEW_WEEKLY: SavedView = {
  schemaVersion: 1,
  id: "v-weekly",
  title: "Weekly expenses",
  presentation: "table",
  databaseId: "finance:transactions",
  groupBy: "week",
  timeBucket: "week",
  timeColumnId: "occurred_on",
  timeWindow: { kind: "last-weeks", weeks: 3 },
  filters: [],
  measure: "sum",
  measureColumnId: "amount",
  sort: { by: "label", dir: "asc" },
  limit: 12,
  convertToZar: true,
  createdAt: NOW,
  updatedAt: NOW,
};

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

const RUN: ComposedViewRunResult = {
  title: VIEW_WEEKLY.title,
  blocks: [
    {
      id: "week-by-week",
      title: "Week by week",
      presentation: "table",
      result: {
        columns: ["label", "value"],
        rows: [
          ["2026-W38", 1111],
          ["2026-W39", 1114],
        ],
        warnings: [],
        currency: "ZAR",
      },
    },
  ],
  warnings: [],
};

/** One live domain, so the Dashboard's lens lines have something to read. */
const SNAPSHOT = {
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
} as unknown as VaultSnapshot;

/** One turn as the panel sent it, plus the instruction text main would post. */
type ChatCall = {
  sessionId: string;
  input: string;
  instructionsContext: CompanionInstructionsInput;
  runtime?: unknown;
  receiptRelPath?: string | null;
  instructions: string;
};

type HarnessWindow = Window & {
  __pageContextChatCalls?: ChatCall[];
  pageContextReady?: Promise<void>;
  pageContextSkin?: string;
  /** Set by `RouterProbe`: walk the harness to another screen. */
  pageContextGo?: (to: string) => void;
};

const harness = window as unknown as HarnessWindow;
harness.__pageContextChatCalls = [];

const bridge: Record<string, unknown> = {
  // ── the Dashboard's own reads ─────────────────────────────────────────────
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  pinsList: () => ok({ pins: BOARD, locked: false } satisfies PinBoardRead),
  pinsSet: () => ok({ applied: true, pins: BOARD, locked: false }),
  pinsSetLocked: () => ok({ pins: BOARD, locked: false } satisfies PinBoardRead),
  pageList: () => ok([]),
  viewList: () => ok([VIEW_WEEKLY]),
  viewGet: () => ok(VIEW_WEEKLY),
  viewRunSaved: () => ok(RUN),
  dbGet: () => ok(DATABASE),
  decisionList: () => ok([]),
  logList: () => ok([]),
  kitList: () => ok([]),
  deadlineGetDismissed: () => ok(false),
  deadlineMaybeNotify: () => ok(null),
  deadlineDismiss: () => ok(true),
  goalsApply: () => ok({}),
  // ── the chat's own reads ──────────────────────────────────────────────────
  companionSessionsList: () => ok([SESSION]),
  companionSessionMessages: () =>
    ok([
      { role: "user" as const, content: "Page context harness" },
      { role: "assistant" as const, content: "Ready." },
    ]),
  // No catalog, so the composer keeps its plain footer line: this rig is about
  // the pill beside the attach control, and a model row would only add noise.
  companionModelOptions: () =>
    Promise.resolve({ ok: false as const, error: "no catalog" }),
  companionChatStream: async (payload: {
    sessionId: string;
    input: string;
    instructionsContext: CompanionInstructionsInput;
  }) => {
    const call: ChatCall = {
      ...payload,
      instructions: buildInstructions(payload.instructionsContext),
    };
    harness.__pageContextChatCalls = [...(harness.__pageContextChatCalls ?? []), call];
    return ok(true);
  },
  companionSessionCreate: () => ok(SESSION),
  onCompanionStream: () => () => {},
};

(window as unknown as { lifequest: unknown }).lifequest = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return () => ok(null);
  },
  has: () => true,
});

/**
 * The second screen, kept deliberately small: a heading, a sentence, a list and
 * a table are one of each thing the outline knows how to say, so a reader can
 * see the whole shape of the reader in one glance.
 */
function GoalsScreen() {
  return (
    <section className="home-dashboard">
      <header className="home-dashboard__header">
        <h1 className="home-dashboard__title">Goals</h1>
        <p className="muted">Three goals are live in this domain.</p>
      </header>
      <ul>
        <li>Run a half marathon</li>
        <li>Ship the vault sync</li>
        <li>Read twelve books</li>
      </ul>
      <table>
        <caption>Progress</caption>
        <thead>
          <tr>
            <th scope="col">Goal</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Run a half marathon</td>
            <td>62%</td>
          </tr>
          <tr>
            <td>Ship the vault sync</td>
            <td>20%</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** The seam the driver walks the app through. */
function RouterProbe() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    (window as unknown as HarnessWindow).pageContextGo = (to: string) =>
      navigate(to);
  }, [navigate]);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).pageContextPath = pathname;
  }, [pathname]);
  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from page-context.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/home"]}>
      <VaultProvider>
        <ChatDockProvider>
          <RouterProbe />
          {/* The app's own three panes, so the join is judged where it lives. */}
          <div className="shell shell--chat-open">
            <div className="nav-rail">{RAIL_MARKER}</div>
            <div className="shell__main">
              <div className="shell__content" data-page-context-root="">
                <Routes>
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/goals" element={<GoalsScreen />} />
                </Routes>
              </div>
            </div>
            <ChatPanel open onOpenChange={() => {}} />
          </div>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

harness.pageContextSkin = skinName;

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the page never rendered". It waits for both
// ends: the composer, and the card whose title the outline has to quote.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
harness.pageContextReady = ready;

const waitForBoth = () => {
  const composer = document.querySelector(".chat-panel__composer-input");
  const card = document.querySelector(".view-card__title");
  if (!composer || !card) {
    requestAnimationFrame(waitForBoth);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForBoth);
