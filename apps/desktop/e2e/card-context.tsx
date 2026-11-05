/**
 * E2E harness page for dashboard cards in the chat's context.
 *
 * This page renders BOTH ends of the feature at once — the real `HomePage` in the
 * shell's main column and the real `ChatPanel` in its dock column — because the
 * claim that matters is the one that crosses them: clicking a card is what puts
 * it in a pill and on the next turn. Two rigs, one per page, would each prove
 * their own half and neither would prove the join.
 *
 * THE BOARD IS THREE CARDS ON PURPOSE. The chat holds at most three, so a board
 * of one could not tell "one pill per card" from "one pill"; a board of three
 * makes the order claim, the per-pill removal claim and the three-card turn all
 * falsifiable against a board that really has that many cards on it. Each card is
 * a saved view with a DIFFERENT title, so a pill that read the wrong heading —
 * or the pin id instead of the heading — fails by name.
 *
 * The Dashboard's own card-as-control claims (no icon, the keyboard toggle, the
 * fourth-card status, empty-board clears) live on `dashboard-card-context`, where
 * the board is the subject. Here the board is the way in and the chat is the
 * subject.
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
  ViewBlock,
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

/**
 * The three cards the board offers, in the order the board draws them. Every
 * title is different so a pill's name is a fact about the card it was clicked
 * on, not about the only card there is.
 */
const V_WEEKLY = "v-weekly";
const V_SUMMARY = "v-summary";
const V_CASHFLOW = "v-cashflow";

export const BOARD: Pin[] = [
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: V_WEEKLY, span: 1 },
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: V_SUMMARY, span: 1 },
  { id: "view:financial:v-cashflow", kind: "view", domainSlug: "financial", viewId: V_CASHFLOW, span: 1 },
];

function savedView(id: string, title: string): SavedView {
  return {
    schemaVersion: 1,
    id,
    title,
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
}

const VIEWS: SavedView[] = [
  savedView(V_WEEKLY, "Weekly expenses"),
  savedView(V_SUMMARY, "Spending by month"),
  savedView(V_CASHFLOW, "Cash flow"),
];

function runOf(view: SavedView): ComposedViewRunResult {
  return {
    title: view.title,
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
      } as ViewBlock & { result: unknown },
    ],
    warnings: [],
  } as ComposedViewRunResult;
}

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
  viewList: () => ok(VIEWS),
  viewGet: (_slug: unknown, viewId: unknown) => {
    const view = VIEWS.find((entry) => entry.id === viewId);
    return view ? ok(view) : { ok: false as const, error: `View not found: ${String(viewId)}` };
  },
  viewRunSaved: (_slug: unknown, viewId: unknown) => {
    const view = VIEWS.find((entry) => entry.id === viewId);
    return view ? ok(runOf(view)) : { ok: false as const, error: `View not found: ${String(viewId)}` };
  },
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

// The dock remembers its tab strip between runs; an earlier rig's strip would
// open tabs this one never made.
window.localStorage.removeItem("lifequest.companion.openTabs");

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
// ends and for the whole board: three cards, because a board of one makes this
// rig's cap and pill claims unfalsifiable.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForBoth = () => {
  const composer = document.querySelector(".chat-panel__composer-input");
  const cards = document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]');
  if (!composer || cards.length < BOARD.length) {
    requestAnimationFrame(waitForBoth);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForBoth);

harness.cardContextReady = ready;
