/**
 * E2E harness page for the operator's own report:
 *
 *   "When I'm already on the Decisions page and a new decision is filed, it does
 *    not pop up on the screen. I have to click elsewhere and then come back for it
 *    to show. Need to make it feel like once the agent files the decision to be
 *    seen on the page itself."
 *
 * It renders the REAL `components/decisions/DecisionsInbox` — the real list, the
 * real arrival line, the real New chip, the real Approve button — inside the real
 * `VaultProvider` and the real `LiveDataProvider`, in a scrollport shorter than
 * the list so that "does it land in view" is a question with an answer.
 *
 * WHAT THE BRIDGE STUB IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * A companion's filing does not arrive through this page: it happens in the main
 * process — the MCP door for a tool call, and `fileImpliedChange` inside the chat
 * handler for a fenced proposal — and the ONLY thing the page is told is
 * `vault:dataChanged`. So the stub plays the main process: it holds the vault's
 * decisions, and `decisionsLiveFile` writes one and then fires the same event
 * `noteDataChanged` + `startDataChangeBroadcast` fire, after the call is answered,
 * which is the order the real write path has.
 *
 * A rig that instead called a React setter would be testing its own plumbing. And
 * a rig that reloaded the page would be testing the workaround the operator
 * reported rather than the fix — so the harness counts its own mounts, the driver
 * asserts that number never moved, and the page under test is never remounted.
 *
 * `?seed=<n>` fills the vault before the first load: 0 is the operator's own case
 * (an empty inbox, "No pending proposals.", and then one arrives), and 8 is a list
 * taller than the scrollport, which is the only way "the arrival landed in view"
 * and "the operator's place was held" can be told apart from "there was nothing to
 * scroll".
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { domainLens, overviewLens } from "@lifequest/vault-core/pure";
import { DecisionsInbox } from "@/components/decisions/DecisionsInbox";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-16T09:00:00.000Z";

// ── the world the page reads ────────────────────────────────────────────────

function domain(slug: string, name: string, sortOrder: number): DomainRecord {
  return {
    slug,
    meta: {
      name,
      description: null,
      color: null,
      sortOrder,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: {} as DomainRecord["documents"],
  };
}

/** Two domains, so a proposal filed for one of them can be hidden by the lens. */
const DOMAINS = [domain("financial", "Financial", 1), domain("health", "Health", 2)];

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Harness",
    createdAt: NOW,
  },
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: DOMAINS,
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

/** The companion: the actor a turn files under, and the name the line says. */
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

/**
 * One proposal, as the fence path files it: a doctrine body the vault would hold
 * before and after, which is what makes the card two panes of prose and therefore
 * a card with a height worth scrolling past.
 *
 * `createdAt` is a minute apart per index so "newest first" is a fact rather than
 * a file-order accident, and so the driver can name the card it expects at the top.
 */
function makeDecision(index: number, domainSlug: string): DecisionRecord {
  const minute = String(index % 60).padStart(2, "0");
  const title = `Premise revision ${index}`;
  return {
    id: `decision-${String(index).padStart(3, "0")}`,
    target: { type: "doctrine", domainSlug, kind: "premise" },
    domainSlugs: [domainSlug],
    status: "pending",
    title,
    rationale:
      "The last quarter's ledger says the premise costs more than it claims, so the wording should say what it actually costs.",
    proposedTitle: title,
    previousTitle: title,
    proposedBodyMarkdown: `## Premise\n\nRevision ${index}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`,
    previousBodyMarkdown: `## Premise\n\nRevision ${index - 1}: the monthly cost of staying here.\n`,
    actor: COMPANION,
    createdAt: `2026-10-16T09:${minute}:00.000Z`,
    resolvedAt: null,
    reason: null,
  };
}

// ── the vault, as the main process holds it ─────────────────────────────────

type Vault = {
  decisions: DecisionRecord[];
  /** The next id a filing takes. */
  seq: number;
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: number;
  /** Every listener the page registered through `onVaultDataChanged`. */
  listeners: Array<(revision: number) => void>;
  /** How many times the inbox has been asked for the list: the re-read itself. */
  listCalls: number;
  /** How many reads have STARTED, which is not the same as finished. */
  listStarts: number;
};

const vault: Vault = {
  decisions: [],
  seq: 0,
  revision: 0,
  listeners: [],
  listCalls: 0,
  listStarts: 0,
};

/**
 * A one-shot delay on the next read, for the out-of-order claim.
 *
 * A read is a round trip and the tab can move inside it, so the only way to ask
 * what the page does when an earlier read lands LAST is to make an earlier read
 * land last on purpose.
 */
let slowNextListMs = 0;

/**
 * Publish a write the way `main.ts` does: bump the revision once, then tell every
 * open window. The coalescing `setTimeout(send, 16)` `main.ts` wraps this in is
 * deliberately NOT reproduced — it exists to merge a burst of writes inside one
 * frame, and this harness has one window and one write to tell.
 */
function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
}

// ── the instrument ──────────────────────────────────────────────────────────

type Frame = {
  at: number;
  /** The first paint's own word, which must never come back. */
  loading: boolean;
  empty: boolean;
  cards: number;
  arrival: string | null;
  top: number;
};

type HarnessWindow = Window & {
  decisionsLiveReady?: boolean;
  decisionsLiveSkin?: string;
  decisionsLiveCalls?: string[];
  decisionsLiveUnexpectedCalls?: string[];
  /** How many times the page has mounted: the workaround the operator reported. */
  decisionsLiveMounts?: () => number;
  /** Fill the vault before the driver does anything else. */
  decisionsLiveSeed?: (count: number) => void;
  /**
   * The agent's filing: a Decision written, then the one event the page hears
   * about it. Returns the id it filed, so the driver can name the card.
   */
  decisionsLiveFile?: (kind: "financial" | "health", title?: string) => string;
  /** A Decision resolved in another window: status flipped, then the event. */
  decisionsLiveResolveElsewhere?: (id: string) => boolean;
  /** The app's own lens setter, so a lens switch is the real one. */
  decisionsLiveSetLens?: (slug: string | null) => boolean;
  /** What the page shows, and where the cards sit in the scrollport. */
  decisionsLiveScreen?: () => Screen;
  /** The scrollport's own numbers. */
  decisionsLiveScroll?: () => { top: number; max: number; height: number };
  decisionsLiveScrollTo?: (top: number) => boolean;
  /** Press the card's own Approve control, exactly as the operator does. */
  decisionsLiveApprove?: (id: string) => boolean;
  /** Press the Pending / History tab by its own label. */
  decisionsLiveTab?: (label: string) => boolean;
  /** Make the NEXT read of the list take this long, for the out-of-order claim. */
  decisionsLiveSlowNextList?: (ms: number) => boolean;
  /** Sample the page's visible state on a timer, for the flicker claim. */
  decisionsLiveStartWatch?: () => boolean;
  decisionsLiveFrames?: () => Frame[];
  /** Every resolution the page asked the vault for, in order. */
  decisionsLiveResolves?: Array<{ id: string; resolution: string }>;
};

type Screen = {
  calls: string[];
  mounts: number;
  listCalls: number;
  /** Reads begun, which is what says a slow one is in flight. */
  listStarts: number;
  tabs: string[];
  activeTab: string | null;
  empty: string | null;
  loading: boolean;
  arrival: string | null;
  ids: string[];
  titles: string[];
  arrived: string[];
  newChips: number;
  /** Each card's top edge, measured from the scrollport's own top. */
  tops: number[];
  /** The ids whose box intersects the scrollport: what the operator can see. */
  visible: string[];
  /** Each card's status pill text, so a resolved card can be told apart. */
  statuses: string[];
  top: number;
};

const harness = window as HarnessWindow;

harness.decisionsLiveCalls = [];
harness.decisionsLiveUnexpectedCalls = [];
harness.decisionsLiveResolves = [];

let mounts = 0;

/**
 * The page's scrollport, and the cards inside it.
 *
 * `.decisions-inbox`'s nearest scrollable ancestor, which in the app is
 * `.shell__content` and in this rig is the box below — the same resolution
 * `pageScroller` does inside the inbox, done again here because the instrument
 * must not borrow the thing it is measuring.
 */
function scrollport(): HTMLElement | null {
  const inbox = document.querySelector<HTMLElement>(".decisions-inbox");
  let node = inbox?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".decision-card")];
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function screen(): Screen {
  const port = scrollport();
  const fold = port?.getBoundingClientRect().top ?? 0;
  const bottom = port?.getBoundingClientRect().bottom ?? 0;
  const list = cards();
  return {
    calls: [...(harness.decisionsLiveCalls ?? [])],
    mounts,
    listCalls: vault.listCalls,
    listStarts: vault.listStarts,
    tabs: [...document.querySelectorAll(".decisions-inbox__tab")].map((t) => text(t)),
    activeTab:
      text(document.querySelector('.decisions-inbox__tab[aria-selected="true"]')) || null,
    empty: text(document.querySelector(".decisions-inbox__empty")) || null,
    loading: /Loading decisions/.test(text(document.querySelector(".decisions-inbox"))),
    arrival: text(document.querySelector('[data-testid="decisions-arrival"]')) || null,
    ids: list.map((card) => card.dataset.decisionId ?? ""),
    titles: list.map((card) => text(card.querySelector(".decision-card__title"))),
    arrived: list
      .filter((card) => card.dataset.arrived === "true")
      .map((card) => card.dataset.decisionId ?? ""),
    newChips: document.querySelectorAll(".decision-new").length,
    tops: list.map((card) => Math.round(card.getBoundingClientRect().top - fold)),
    visible: list
      .filter((card) => {
        const box = card.getBoundingClientRect();
        return box.bottom > fold && box.top < bottom;
      })
      .map((card) => card.dataset.decisionId ?? ""),
    statuses: list.map((card) => text(card.querySelector(".decision-status"))),
    top: Math.round(port?.scrollTop ?? 0),
  };
}

harness.decisionsLiveMounts = () => mounts;
harness.decisionsLiveScreen = screen;
harness.decisionsLiveScroll = () => {
  const port = scrollport();
  return {
    top: Math.round(port?.scrollTop ?? 0),
    max: Math.round((port?.scrollHeight ?? 0) - (port?.clientHeight ?? 0)),
    height: Math.round(port?.clientHeight ?? 0),
  };
};
harness.decisionsLiveScrollTo = (top) => {
  const port = scrollport();
  if (!port) return false;
  port.scrollTop = top;
  return true;
};

harness.decisionsLiveSeed = (count) => {
  vault.decisions = Array.from({ length: count }, (_, i) =>
    makeDecision(i + 1, "financial"),
  );
  vault.seq = count;
};

harness.decisionsLiveFile = (domainSlug, title) => {
  vault.seq += 1;
  const decision = makeDecision(vault.seq, domainSlug);
  if (title) {
    decision.title = title;
    decision.proposedTitle = title;
  }
  vault.decisions.push(decision);
  // The tool call is answered first; the window is told afterwards, which is the
  // order the real write path has.
  setTimeout(announce, 0);
  return decision.id;
};

harness.decisionsLiveResolveElsewhere = (id) => {
  const found = vault.decisions.find((d) => d.id === id);
  if (!found) return false;
  found.status = "approved";
  found.resolvedAt = "2026-10-16T10:00:00.000Z";
  setTimeout(announce, 0);
  return true;
};

harness.decisionsLiveSlowNextList = (ms) => {
  slowNextListMs = ms;
  return true;
};

harness.decisionsLiveApprove = (id) => {
  const card = document.querySelector<HTMLElement>(
    `[data-decision-id="${CSS.escape(id)}"]`,
  );
  const button = [...(card?.querySelectorAll("button") ?? [])].find(
    (b) => text(b) === "Approve",
  );
  if (!button) return false;
  button.click();
  return true;
};

harness.decisionsLiveTab = (label) => {
  const tab = [...document.querySelectorAll<HTMLElement>(".decisions-inbox__tab")].find(
    (t) => text(t) === label,
  );
  if (!tab) return false;
  tab.click();
  return true;
};

/**
 * The page's own state, sampled on a timer: the evidence for the one claim that
 * cannot be read from two endpoints — that the list was never swapped for the
 * word "Loading", and that the count only ever went up.
 *
 * A timer rather than `requestAnimationFrame`: a hidden window throttles frames
 * and a throttled sampler reports an empty history as if nothing had happened.
 */
harness.decisionsLiveStartWatch = () => {
  const frames: Frame[] = [];
  (window as unknown as { __decisionFrames?: Frame[] }).__decisionFrames = frames;
  const sample = () => {
    const now = screen();
    frames.push({
      at: Math.round(performance.now()),
      loading: now.loading,
      empty: now.empty !== null,
      cards: now.ids.length,
      arrival: now.arrival,
      top: now.top,
    });
  };
  sample();
  (window as unknown as { __decisionIv?: number }).__decisionIv = window.setInterval(
    sample,
    40,
  );
  return true;
};

/** The distinct states the page passed through, oldest first. */
harness.decisionsLiveFrames = () => {
  const frames =
    (window as unknown as { __decisionFrames?: Frame[] }).__decisionFrames ?? [];
  const seen: Frame[] = [];
  for (const frame of frames) {
    const last = seen[seen.length - 1];
    if (
      last &&
      last.loading === frame.loading &&
      last.empty === frame.empty &&
      last.cards === frame.cards &&
      last.arrival === frame.arrival
    ) {
      continue;
    }
    seen.push(frame);
  }
  return seen;
};

// ── the page ────────────────────────────────────────────────────────────────

const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  vaultGetSnapshot: async () => ok(SNAPSHOT),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: (cb: unknown) => {
    const listener = cb as (revision: number) => void;
    vault.listeners.push(listener);
    return () => {
      const index = vault.listeners.indexOf(listener);
      if (index >= 0) vault.listeners.splice(index, 1);
    };
  },
  decisionList: async () => {
    vault.listStarts += 1;
    const delay = slowNextListMs;
    slowNextListMs = 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    vault.listCalls += 1;
    // A read hands back copies: the page must never be able to edit the vault by
    // holding on to what it was given, and `decisionResolve` is the only writer.
    return ok(vault.decisions.map((d) => ({ ...d })));
  },
  decisionResolve: async (id: unknown, resolution: unknown) => {
    harness.decisionsLiveResolves!.push({
      id: String(id),
      resolution: String(resolution),
    });
    const found = vault.decisions.find((d) => d.id === String(id));
    if (!found) return { ok: false, error: `No such decision: ${String(id)}` };
    found.status = resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-16T10:30:00.000Z";
    setTimeout(announce, 0);
    return ok({ ...found });
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.decisionsLiveCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.decisionsLiveUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

/**
 * The app's own lens setter, lent to the harness.
 *
 * Reaching into the provider's state instead would be asserting this rig's idea of
 * what a lens is; the operator's switch goes through `domain:setActive`, and so
 * does this.
 */
function LensBridge() {
  const { setLens } = useVault();
  useEffect(() => {
    harness.decisionsLiveSetLens = (slug) => {
      void setLens(slug ? domainLens(slug) : overviewLens());
      return true;
    };
    return () => {
      harness.decisionsLiveSetLens = undefined;
    };
  }, [setLens]);
  return null;
}

/** One mount of the page, counted: leaving and coming back is the old workaround. */
function MountProbe() {
  useEffect(() => {
    mounts += 1;
    harness.decisionsLiveReady = true;
    return () => {
      harness.decisionsLiveReady = false;
    };
  }, []);
  return null;
}

/**
 * The window's own shape: a fixed-height column that scrolls, with the app's
 * `.shell__content` overflow, around the real inbox. Fixed, so the claims below
 * are about the inbox and not about a window that happened to be a different size.
 *
 * `LiveDataProvider` is the load-bearing wrap and is in the app's own position
 * (`App.tsx`: inside `VaultProvider`, outside every page). Without it nothing would
 * ever ask the inbox to re-read, and this rig would "prove" the fix by proving the
 * page was asleep.
 */
function Harness() {
  return (
    <div
      className="shell__content"
      style={{ height: 560, width: 1100, margin: "0 auto", overflowY: "auto" }}
    >
      <MemoryRouter initialEntries={["/decisions"]}>
        <VaultProvider>
          <LiveDataProvider>
            <MountProbe />
            <LensBridge />
            <DecisionsInbox />
          </LiveDataProvider>
        </VaultProvider>
      </MemoryRouter>
    </div>
  );
}

// The seed has to be in place before the first read, or the empty-state claim and
// the overflow claim would be measuring the same page.
const seedCount = Number(
  new URLSearchParams(window.location.search).get("seed") ?? "0",
);
harness.decisionsLiveSeed(Number.isFinite(seedCount) ? seedCount : 0);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.decisionsLiveSkin = skinName;
