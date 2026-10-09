/**
 * E2E harness page for a dashboard card in the chat's context.
 *
 * This page renders BOTH ends of the feature at once — the real `HomePage` in the
 * shell's main column and the real `ChatPanel` in its dock column — because the
 * claim that matters is the one that crosses them: clicking a card's chat control
 * is what puts the card in the pill and on the next turn. Two rigs, one per page,
 * would each prove their own half and neither would prove the join.
 *
 * The Dashboard is still judged on its own page (`dashboard-card-context`), where
 * the pin board's toggle and the control on every card kind are the subject. Here
 * the board is one saved view, because that is all the join needs.
 *
 * This is a system-in-isolation rig: the real pages, the real dock provider, the
 * real CSS and layout engine, with only the IPC bridge stubbed (there is no
 * preload on a dev-server page). `companionChatStream` records whole payloads
 * rather than a summary, because the claim is about the instruction context the
 * turn carries, field by field.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
import { ChatDockProbe } from "./chat-dock-probe";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Card context harness",
  lastActive: 1_700_000_000,
  pinned: false,
};

const NOW = "2026-10-09T00:00:00.000Z";

/** The board the Dashboard column reads: one saved view, and nothing else. */
const BOARD: Pin[] = [
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: "v-weekly", span: 1 },
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
          ["2026-W36", 1111],
          ["2026-W37", 1114],
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

/** One turn as the panel sent it — the whole payload, not a summary of it. */
type ChatCall = {
  sessionId: string;
  input: string;
  instructionsContext: Record<string, unknown>;
};

type HarnessWindow = Window & {
  __cardChatCalls?: ChatCall[];
  cardContextReady?: Promise<void>;
  cardContextSkin?: string;
};

const harness = window as unknown as HarnessWindow;
harness.__cardChatCalls = [];

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
      { role: "user" as const, content: "Card context harness" },
      { role: "assistant" as const, content: "Ready." },
    ]),
  // No catalog, so the composer draws its plain footer line: this rig is about
  // the card, and a model pill row would only add noise to the geometry claim.
  companionModelOptions: () => Promise.resolve({ ok: false as const, error: "no catalog" }),
  companionChatStream: async (payload: ChatCall) => {
    harness.__cardChatCalls = [...(harness.__cardChatCalls ?? []), payload];
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

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from card-context.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <VaultProvider>
        <ChatDockProvider>
          <ChatDockProbe channel="cardContext" />
          {/* The app's own three panes, so the join is judged where it lives. */}
          <div className="shell shell--chat-open">
            <div className="nav-rail" />
            <div className="shell__main">
              <div className="shell__content">
                <HomePage />
              </div>
            </div>
            <ChatPanel open onOpenChange={() => {}} />
          </div>
        </ChatDockProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

harness.cardContextSkin = skinName;

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the page never rendered". It waits for both
// ends: the composer, and the card whose chat control is clicked.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForBoth = () => {
  const composer = document.querySelector(".chat-panel__composer-input");
  const control = document.querySelector('[data-testid="pin-chat"]');
  if (!composer || !control) {
    requestAnimationFrame(waitForBoth);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForBoth);

harness.cardContextReady = ready;
