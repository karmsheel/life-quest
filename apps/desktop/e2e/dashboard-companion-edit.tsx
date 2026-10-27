/**
 * E2E harness page for the claim that is the operator's own report:
 *
 *   "I selected a card and asked the companion to modify it (change the order of
 *    items). It did the task successfully, but the board lost its position on the
 *    dashboard."
 *
 * This renders the REAL `pages/HomePage` — the real grid, the real `usePinArrange`
 * hook, the real `LiveDataProvider`, the real `ViewCard` — over a stubbed bridge,
 * inside a scrollport SHORTER than the board. That last part is the instrument:
 * a board that fits on screen has no position to lose, and every other dashboard
 * rig here sizes its window so the whole board is visible.
 *
 * WHAT THE BRIDGE STUB IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * The companion's write does not arrive through the page: it happens in the main
 * process (the MCP door) or in the app's own IPC handlers, and the ONLY thing the
 * page is told is `vault:dataChanged`. So the stub plays the main process: it
 * holds the vault's files, it records the writes the renderer makes, and — the
 * part that matters — `dashboardCompanionEditWrite` changes those files and then
 * fires the same event `main.ts` broadcasts, exactly as `noteDataChanged` +
 * `startDataChangeBroadcast` do. A rig that instead called `setPins` or bumped a
 * React state would be testing its own plumbing.
 *
 * A companion TURN is not one write. It is a `save_view`, and then whatever else
 * the turn touched — a Decision filed, a log line posted, a card re-pinned — each
 * of which `main.ts` coalesces to one message per frame. `write` takes a batch for
 * that reason: the board has to survive the turn the operator actually had, not a
 * tidy single-write caricature of it.
 *
 * The board is TEN pins on the operator's own card mix — a deadline banner, two
 * full-row cards, view cards and page cards — because "the board lost its
 * position" is a claim about a board that scrolls, and the cards above the fold
 * have to be able to change height for it to be falsifiable at all.
 */
import { StrictMode, useEffect } from "react";
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
  ViewBlock,
} from "@lifequest/vault-core";
import HomePage from "@/pages/HomePage";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import type { ChatStreamEvent, CompanionStreamFrame } from "@/vite-env";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

/**
 * The pin the companion edits, and the view behind it. Named once because three
 * things address it — the seed, the turn that writes it, and the readers that
 * report where it is on the board.
 */
const EDIT_PIN = "view:financial:v-recent";
const EDIT_VIEW = "v-recent";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

// ── the world the page reads ────────────────────────────────────────────────

const NOW = "2026-10-15T09:00:00.000Z";

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

/**
 * The board as the operator has it: the real Overview shape — four built-in cards,
 * a run of finance pages, two views, the deadline banner — which is long enough to
 * scroll in any window and has both full-row and single-cell cards in it.
 *
 * `view:financial:v-recent` sits FOURTH, deliberately: it is the card the operator
 * selects, and it has to be far enough down the board that "where the board was"
 * is a position worth keeping rather than the top.
 */
const SEED: Pin[] = [
  SYS("goal-progress"),
  SYS("today-week"),
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "finance-page-ledger" },
  { id: "view:financial:v-recent", kind: "view", domainSlug: "financial", viewId: "v-recent", span: 2 },
  { id: "page:financial:spend", kind: "page", domainSlug: "financial", pageId: "finance-page-spend" },
  { id: "page:financial:budget", kind: "page", domainSlug: "financial", pageId: "finance-page-budget" },
  SYS("pending-decisions"),
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: "v-summary", span: 1 },
  SYS("deadline"),
  SYS("recent-log"),
];

const PAGES: PageListEntry[] = [
  { domainSlug: "financial", page: page("finance-page-ledger", "Ledger") },
  { domainSlug: "financial", page: page("finance-page-spend", "Spend") },
  { domainSlug: "financial", page: page("finance-page-budget", "Budget") },
];

function page(id: string, title: string): PageListEntry["page"] {
  return {
    id,
    domainSlug: "financial",
    title,
    blocks: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * A composed card: a total over the ledger, then the rows it totals. The two
 * blocks are what "change the order of items" moves, and they are what makes the
 * edited card's HEIGHT a live thing — the listing is many rows tall, the metric is
 * one line, so whichever block ends up first changes the card's box.
 */
function block(id: string, title: string, presentation: ViewBlock["presentation"]): ViewBlock {
  return {
    id,
    title,
    presentation,
    measure: "sum",
    measureColumnId: "amount",
    groupBy: presentation === "table" || presentation === "list" ? "date" : null,
    timeBucket: "month",
    timeColumnId: "date",
    timeWindow: { kind: "last-weeks", weeks: 26 },
    filters: [],
    sort: { by: "label", dir: "desc" },
    limit: 12,
    convertToZar: false,
    columns: [],
  } as ViewBlock;
}

const RECENT_BLOCKS: ViewBlock[] = [
  block("months", "Month by month", "table"),
  block("total", "Last 6 months", "metric"),
];
const SUMMARY_BLOCKS: ViewBlock[] = [
  block("total", "Total", "metric"),
  block("months", "Month by month", "table"),
];

function savedView(id: string, title: string, blocks: ViewBlock[]): SavedView {
  return {
    schemaVersion: 1,
    id,
    title,
    presentation: "composed",
    databaseId: "finance:transactions",
    blocks,
    groupBy: null,
    timeBucket: "month",
    timeColumnId: "date",
    timeWindow: { kind: "last-weeks", weeks: 26 },
    filters: [],
    measure: "sum",
    measureColumnId: "amount",
    sort: { by: "label", dir: "desc" },
    limit: 12,
    convertToZar: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const ROW_LABELS = [
  "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04",
  "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10",
];

const DATABASE: DatabaseMeta = {
  id: "finance:transactions",
  name: "Transactions",
  sotMode: "local-only",
  adapter: null,
  columns: [
    { id: "date", name: "Date", type: "date" },
    { id: "amount", name: "Amount", type: "number" },
    { id: "payee", name: "Payee", type: "text" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

/** The run a view produces, from the view's OWN block order. */
function runOf(view: SavedView): ComposedViewRunResult {
  const blocks = (view.blocks ?? []).map((spec) => ({
    id: spec.id,
    title: spec.title,
    presentation: spec.presentation,
    span: spec.span,
    result: {
      columns: ["label", "value"],
      rows:
        spec.presentation === "metric"
          ? [["value", 7028.34] as [string, number]]
          : ROW_LABELS.map((label, index) => [label, 1000 + index * 37] as [string, number]),
      warnings: [],
      currency: "ZAR",
    },
  }));
  return { title: view.title, blocks, warnings: [] };
}

// ── the vault, as the main process holds it ─────────────────────────────────

type Vault = {
  pins: Pin[];
  locked: boolean;
  views: Map<string, SavedView>;
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: number;
  /** Every listener the page registered through `onVaultDataChanged`. */
  listeners: Array<(revision: number) => void>;
};

const vault: Vault = {
  pins: [...SEED],
  locked: false,
  views: new Map<string, SavedView>([
    ["v-recent", savedView("v-recent", "Spending by month", RECENT_BLOCKS)],
    ["v-summary", savedView("v-summary", "Spending by month", SUMMARY_BLOCKS)],
  ]),
  revision: 0,
  listeners: [],
};

/**
 * Publish a change the way `main.ts` does: bump the revision once, then tell every
 * open window. The coalescing `setTimeout(send, 16)` that `main.ts` wraps this in
 * is deliberately NOT reproduced — it exists to merge a burst of writes inside one
 * frame, and this harness has only one window to tell.
 */
function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
}

type HarnessWindow = Window & {
  dashboardCompanionEditReady?: boolean;
  dashboardCompanionEditSkin?: string;
  dashboardCompanionEditCalls?: string[];
  dashboardCompanionEditUnexpectedCalls?: string[];
  /** One companion turn: the writes, then the one event the page hears about them. */
  dashboardCompanionEditWrite?: (kind: "blocks" | "board" | "quiet") => boolean;
  /**
   * A turn that makes a card TALLER by one block: `v-recent` is the card the
   * operator is parked on, `v-summary` is a card further down the board.
   *
   * The two are different claims, not two flavours of one. Growing the card under
   * the operator's eye is the case Chromium's own scroll anchoring often absorbs
   * on its own; growing a card ABOVE the card they are reading is the case it
   * cannot, because the card in view does not move relative to the board at all —
   * the board's whole content slides, and only an anchor can hold it.
   */
  dashboardCompanionEditGrow?: (viewId: "v-recent" | "v-summary") => boolean;
  /** Put the scrollport somewhere with a card's top edge just under its own top. */
  dashboardCompanionEditScrollToCard?: (pinId: string) => boolean;
  /** Nudge the board's offset, for parking off the very end of a clamped board. */
  dashboardCompanionEditScrollBy?: (delta: number) => boolean;
  /**
   * Record the board's offset, and the board's own height with it, on a timer.
   *
   * A timer and not `requestAnimationFrame`: a hidden window throttles frames, and
   * a throttled sampler reports an empty history as if nothing had moved. It is the
   * evidence for the one claim that cannot be read from two endpoints — that the
   * offset MOVED by the growth while the operator stayed still.
   */
  dashboardCompanionEditWatchBoard?: () => boolean;
  dashboardCompanionEditBoardFrames?: () => Array<{
    at: number;
    top: number;
    max: number;
    recent: number;
  }>;
  /** The board's pins in the order the live DOM has them. */
  dashboardCompanionEditOrder?: () => string[];
  /** The edited card's blocks, by the shape each is drawn in, in DOM order. */
  dashboardCompanionEditBlockKey?: () => string;
  /**
   * Send a companion turn frame, exactly as the main process does.
   *
   * `started` is what the board hears first — the turn opens before any write — and
   * `completed` is what it hears last, after the writes have landed.
   */
  dashboardCompanionEditTurn?: (phase: "started" | "completed") => boolean;
  /** The pins whose card is wearing the "being worked on" ring, in board order. */
  dashboardCompanionEditLiveCards?: () => string[];
  /** Hand the chat the card an operator would hand it, through the card's own button. */
  dashboardCompanionEditFocusCard?: (pinId: string) => boolean;
};

const harness = window as HarnessWindow;

harness.dashboardCompanionEditCalls = [];
harness.dashboardCompanionEditUnexpectedCalls = [];

/**
 * The chat stream, as the main process sends it.
 *
 * The ring the board draws around the card being worked on is the CHAT's state, not
 * the vault's: it is set when a turn starts and cleared when the turn settles. So
 * the only honest way to test it is to drive the stream — the same frames
 * `companion-client.ts` emits — rather than to poke the dock's own setter, which
 * would be testing the rig's opinion of how the app works.
 */
const streamListeners: Array<(frame: CompanionStreamFrame) => void> = [];
/** The one chat this board's dock opens, named on every frame main would stamp. */
const STREAM_SESSION_ID = "harness-session";

function emitTurn(event: ChatStreamEvent): void {
  for (const listener of [...streamListeners]) {
    listener({ sessionId: STREAM_SESSION_ID, event });
  }
}

const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  vaultGetSnapshot: async () => ok(SNAPSHOT),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: (cb: unknown) => {
    const listener = cb as (revision: number) => void;
    vault.listeners.push(listener);
    return () => {
      const index = vault.listeners.indexOf(listener);
      if (index >= 0) vault.listeners.splice(index, 1);
    };
  },
  decisionList: async () => ok([]),
  logList: async () => ok([]),
  pageList: async () => ok(PAGES),
  viewList: async () => ok([...vault.views.values()]),
  viewGet: async (_slug: unknown, viewId: unknown) => {
    const view = vault.views.get(String(viewId));
    return view ? ok(view) : { ok: false, error: `View not found: ${String(viewId)}` };
  },
  viewRunSaved: async (_slug: unknown, viewId: unknown) => {
    const view = vault.views.get(String(viewId));
    return view ? ok(runOf(view)) : { ok: false, error: `View not found: ${String(viewId)}` };
  },
  dbGet: async () => ok(DATABASE),
  kitList: async () => ok([]),
  deadlineGetDismissed: async () => ok(false),
  deadlineMaybeNotify: async () => ok(null),
  deadlineDismiss: async () => ok(true),
  goalsApply: async () => ok({}),
  pinsList: async () => ok({ pins: vault.pins, locked: vault.locked } satisfies PinBoardRead),
  pinsSet: async (_boardSlug: unknown, pins: unknown) => {
    vault.pins = pins as Pin[];
    return ok({ applied: true, pins: vault.pins, locked: vault.locked });
  },
  pinsSetLocked: async (_boardSlug: unknown, locked: unknown) => {
    vault.locked = locked === true;
    return ok({ pins: vault.pins, locked: vault.locked } satisfies PinBoardRead);
  },
  // The operator's own presentation switch, which is the app's `view:save`.
  viewSave: async (_slug: unknown, spec: unknown) => {
    const next = spec as SavedView;
    vault.views.set(next.id, next);
    announce();
    return ok(next);
  },
  /*
   * The chat panel's own calls, so that the REAL panel can mount behind the board.
   * A card's ring is the chat's state, and a rig that faked the dock's setter would
   * be asserting its own idea of when a turn starts. These answer in the shapes the
   * panel expects and record their own names like every other stub here.
   */
  companionSessionsList: async () => ok([]),
  companionSessionMessages: async () => ok([]),
  companionSessionCreate: async () => ok({ id: "harness-session", title: "Harness" }),
  companionSessionPatch: async () => ok(null),
  companionSessionDelete: async () => ok(true),
  companionModelOptions: async () => ok({ providers: [], current: { model: "", provider: "" } }),
  onCompanionStream: (cb: unknown) => {
    const listener = cb as (frame: CompanionStreamFrame) => void;
    streamListeners.push(listener);
    return () => {
      const index = streamListeners.indexOf(listener);
      if (index >= 0) streamListeners.splice(index, 1);
    };
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.dashboardCompanionEditCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.dashboardCompanionEditUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/**
 * One companion turn against the vault.
 *
 *  - `blocks` — the write the operator reported: `save_view` with the card's two
 *    blocks reordered, so the listing moves above the metric. Every other card is
 *    left alone, which is what makes any movement of the board attributable to
 *    this one card changing shape.
 *  - `board` — plus a re-pin, the other thing a turn can do to a dashboard.
 *  - `quiet` — nothing but the event, the control case: a board that moves when
 *    nothing was written is moving for a reason this rig has not found.
 */
harness.dashboardCompanionEditWrite = (kind) => {
  if (kind === "blocks" || kind === "board") {
    const view = vault.views.get("v-recent");
    if (!view) return false;
    const blocks = [...(view.blocks ?? [])].reverse();
    vault.views.set("v-recent", { ...view, blocks, updatedAt: NOW });
  }
  if (kind === "board") {
    // The companion moves the edited card one slot earlier, as a re-pin would.
    const from = vault.pins.findIndex((pin) => pin.id === "view:financial:v-recent");
    if (from > 0) {
      const pins = [...vault.pins];
      const [moved] = pins.splice(from, 1);
      pins.splice(from - 1, 0, moved!);
      vault.pins = pins;
    }
  }
  // The companion's tool call is answered first; the window is told afterwards,
  // which is the order the real write path has.
  setTimeout(announce, 0);
  return true;
};

/**
 * A turn that makes a card TALLER: the companion adds a block to it.
 *
 * The block is numbered rather than named, so the turn can be run on the same card
 * more than once — the legs below grow one card under the operator's eye and then
 * grow it again from above them, and both have to be real additions.
 */
harness.dashboardCompanionEditGrow = (viewId) => {
  const view = vault.views.get(viewId);
  if (!view) return false;
  const blocks = view.blocks ?? [];
  const index = blocks.filter((spec) => spec.id.startsWith("detail")).length + 1;
  vault.views.set(viewId, {
    ...view,
    blocks: [...blocks, block(`detail-${index}`, `Month by month (detail ${index})`, "list")],
    updatedAt: NOW,
  });
  setTimeout(announce, 0);
  return true;
};

/**
 * The board's scrollport, resolved the way `board-hold.ts` resolves it.
 *
 * The scrollability test matters as much as the overflow test: the harness's own
 * wrapper is `.shell__content` with the app's class, and inside it `.home-dashboard`
 * is `overflow: visible` but may not have laid out yet when a driver asks — so a
 * walk that stopped at the first `auto`/`scroll` ancestor without checking that the
 * box actually overflows would park the board on an element that cannot scroll and
 * silently do nothing.
 */
function scrollport(): HTMLElement | null {
  const grid = document.querySelector<HTMLElement>(".home-dashboard__grid");
  let node = grid?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight - node.clientHeight > 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * Move the board's offset the way a real scroll does.
 *
 * A programmatic `scrollTop` assignment in this window does not deliver a scroll
 * event to a listener on the same element — measured, and the reason the rig's
 * manual-parking legs dispatch the event themselves. The app's own scroll handling
 * lives on that event, so a harness that only assigned the offset would be testing a
 * world where nobody ever scrolls. This is what makes parking here mean the same
 * thing as parking with a wheel.
 */
function scrollBoardTo(port: HTMLElement, top: number): void {
  port.scrollTop = top;
  port.dispatchEvent(new Event("scroll"));
}

harness.dashboardCompanionEditScrollToCard = (pinId) => {
  const port = scrollport();
  const card = document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(pinId)}"]`);
  if (!port || !card) return false;
  // Park the card's top a little ABOVE the fold, not exactly on it. "Exactly on
  // it" is a rounding coin-toss: a fractional layout can leave the top at +0.4,
  // and the page's hold only counts a card whose top has reached the fold — so
  // it would hold the card before this one. Twelve pixels of extra scroll moves
  // the card's top to -12, unambiguous on both sides of the rule.
  scrollBoardTo(
    port,
    port.scrollTop + card.getBoundingClientRect().top - port.getBoundingClientRect().top + 12,
  );
  return true;
};

harness.dashboardCompanionEditScrollBy = (delta) => {
  const port = scrollport();
  if (!port) return false;
  scrollBoardTo(port, port.scrollTop + delta);
  return true;
};

type BoardFrameSample = { at: number; top: number; max: number; recent: number };

harness.dashboardCompanionEditWatchBoard = () => {
  const port = scrollport();
  if (!port) return false;
  const frames: BoardFrameSample[] = [];
  (window as unknown as { __boardFrames?: BoardFrameSample[] }).__boardFrames = frames;
  const sample = () => {
    const card = document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(EDIT_PIN)}"]`);
    frames.push({
      at: Math.round(performance.now()),
      top: Math.round(port.scrollTop),
      max: Math.round(port.scrollHeight - port.clientHeight),
      recent: card ? Math.round(card.getBoundingClientRect().height) : -1,
    });
  };
  sample();
  (window as unknown as { __boardIv?: number }).__boardIv = window.setInterval(sample, 50);
  return true;
};

/** The distinct states the board passed through, oldest first. */
harness.dashboardCompanionEditBoardFrames = () => {
  const frames = (window as unknown as { __boardFrames?: BoardFrameSample[] }).__boardFrames ?? [];
  const seen: BoardFrameSample[] = [];
  for (const frame of frames) {
    const last = seen[seen.length - 1];
    if (last && last.top === frame.top && last.max === frame.max && last.recent === frame.recent) {
      continue;
    }
    seen.push(frame);
  }
  return seen;
};

harness.dashboardCompanionEditOrder = () =>
  [...document.querySelectorAll<HTMLElement>(".home-dashboard__grid > .home-pin")]
    .map((card) => card.dataset.pinId ?? "")
    .filter(Boolean);

/**
 * The edited card's blocks as the DOM draws them, named by the shape each one is
 * drawn in — `metric`, `table`, `list`. A driver waits on this rather than on "a
 * metric exists somewhere", because the metric block is on the card before the
 * turn as well as after it.
 */
harness.dashboardCompanionEditBlockKey = () =>
  JSON.stringify(
    [...document.querySelectorAll(`[data-pin-id="${CSS.escape(EDIT_PIN)}"] .view-card__block`)].map(
      (block) => {
        const shape = [...block.classList].find((name) =>
          name.startsWith("view-card__block--"),
        );
        return shape ? shape.replace("view-card__block--", "") : "unknown";
      },
    ),
  );

// ── the turn, and the ring it puts on a card ────────────────────────────────

harness.dashboardCompanionEditTurn = (phase) => {
  emitTurn(phase === "started" ? { type: "run.started", runId: "harness-run" } : { type: "run.completed" });
  return true;
};

harness.dashboardCompanionEditLiveCards = () =>
  [...document.querySelectorAll<HTMLElement>(".home-dashboard__grid > .home-pin.is-live")]
    .map((card) => card.dataset.pinId ?? "")
    .filter(Boolean);

/**
 * Hand a card to the chat the way the operator does: press the card's own chat
 * control. Reaching into the dock's setter instead would assert the rig's idea of
 * how a card becomes context, which is the one thing this rig is here to avoid.
 */
harness.dashboardCompanionEditFocusCard = (pinId) => {
  const button = document.querySelector<HTMLElement>(
    `[data-pin-id="${CSS.escape(pinId)}"] [data-testid="pin-chat"]`,
  );
  if (!button) return false;
  button.click();
  return true;
};

function Harness() {
  useEffect(() => {
    harness.dashboardCompanionEditReady = true;
    return () => {
      harness.dashboardCompanionEditReady = false;
    };
  }, []);
  /**
   * The window's own shape: a fixed-height column that scrolls, with the app's
   * `.shell__content` overflow. Fixed, so the claims below are about the board and
   * not about a window that happened to be a different size.
   *
   * `LiveDataProvider` is the load-bearing wrap and is in the app's own position
   * (`App.tsx`: inside `VaultProvider`, outside every page). Without it the cards
   * would still be drawn — `useLiveData` has a default, deliberately — but they
   * would never re-run on a write, the companion's edit would never appear, and
   * this rig would "prove" the board holds still by proving nothing happened.
   *
   * The real `ChatPanel` is mounted INSIDE the grid — hidden, and zero-sized — for
   * one reason: the card the companion is working on is the chat's own state, and
   * the only way to reach it honestly is to let the panel listen to the stream and
   * have the rig send the frames. `position: absolute` and `visibility: hidden` keep
   * it out of the board's layout entirely, so the geometry claims are unaffected;
   * `display: none` would unmount nothing but would stop the panel's effects from
   * running, which is the whole point of having it here.
   */
  return (
    <div
      className="shell__content"
      style={{ height: "100%", width: 1100, margin: "0 auto", overflowY: "auto" }}
    >
      <MemoryRouter initialEntries={["/"]}>
        <VaultProvider>
          <LiveDataProvider>
            <ChatDockProvider>
              <HomePage />
              <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}>
                <ChatPanel open onOpenChange={() => {}} />
              </div>
            </ChatDockProvider>
          </LiveDataProvider>
        </VaultProvider>
      </MemoryRouter>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.dashboardCompanionEditSkin = skinName;
