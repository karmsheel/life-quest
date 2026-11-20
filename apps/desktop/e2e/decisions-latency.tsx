/**
 * E2E harness for the operator's reported defect:
 *
 *   "When it's approving the last decision, the user is forced to sit and wait
 *    while that last decision is approved before that decision page gets
 *    dismissed." — and, on the same screen, "when the user is approving
 *    decisions, it takes a long time to approve".
 *
 * THE DEFECT, MEASURED
 *
 * `DecisionsInbox.resolve()` used to await three round trips after the write
 * returned before it asked the sheet to close:
 *
 *   decisionResolve → load() (a full `decision:list`, ~1.2 s on the operator's
 *   819-decision vault) → refresh() (`vaultGetSnapshot`, ~0.5 s) →
 *   closeIfAnswered() (ANOTHER `decision:list`) → `onClose()`.
 *
 * The fix is an ORDER, not a different set of calls: the write returns, the
 * card leaves, the sheet's animated close starts on the page's own knowledge of
 * the queue, and only then do the list read and the snapshot refresh run. This
 * page renders the real `DecisionsPage` → `DecisionsOverlay` → `SheetOverlay` →
 * `DecisionsInbox` chain inside the real `VaultProvider` + `LiveDataProvider`,
 * with the app's own CSS and skin, so the claim is about the shipped components
 * and not about a re-implementation.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The timing is measured on the wrong clock.** The interval has to run
 *     inside the page, from the operator's own click to the frame leaving the
 *     document, not from the driver's `executeJavaScript` round trips — a
 *     harness that sampled over IPC would measure the driver, not the app.
 *  2. **The sheet is "gone" but the page behind it is blank.** Closing is only
 *     correct if the workspace is still mounted underneath; the sample at the
 *     moment the sheet leaves names the route AND the workspace page.
 *  3. **The reads are deleted rather than deferred.** A fix that skips the
 *     `decision:list` re-read and the `vaultGetSnapshot` refresh passes the
 *     latency check and silently leaves the rail badge and the editors behind
 *     the sheet stale. The stub records every call's start AND completion time,
 *     so "deferred" is distinguishable from "never asked".
 *  4. **The close is bought with a read storm.** The old path asked for three or
 *     four list reads around one answer. The call log, timestamped, lets the
 *     judge count the reads whose start falls inside the answer window.
 *  5. **Auto-close OFF is ignored.** Settings › Decisions › auto-close must keep
 *     the sheet up when the last card is answered; the switch is read from the
 *     stubbed snapshot, exactly as it is in the app.
 *  6. **A failed write closes the sheet anyway.** A refused `decisionResolve`
 *     must keep the card pending and say why, in the same surface.
 *  7. **A resolved card comes back.** The background re-read races the write by
 *     construction, so a read that left before the answer must not repaint the
 *     answered card as pending.
 *
 * WHAT IS STUBBED, AND WHAT IS NOT
 *
 * Only `window.lifequest` — the same boundary the real app crosses. `decisionList`
 * and `vaultGetSnapshot` take configurable delays and are timestamped on entry
 * and exit; `decisionResolve` is fast and mutates the in-memory vault; every
 * write then fires `vault:dataChanged` through the captured listener, which is
 * what `main.ts` does. The page, the routes, the frame, the providers, the CSS
 * and the animations are the app's own.
 *
 * URL knobs (the driver sets them per leg):
 *
 *   ?seed=2              pending Decisions in the fixture vault (default 2)
 *   ?listDelay=900       ms a `decision:list` takes to answer (default 900)
 *   ?snapshotDelay=800   ms a `vaultGetSnapshot` takes to answer (default 800)
 *   ?autoClose=off       seed Settings › Decisions › auto-close as off
 *   ?failResolve=1       make `decisionResolve` refuse, without mutating
 *   ?resolveDelay=0      ms the simulated write takes (the "fast" side)
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { useSheetBackground } from "@/components/shell/useSheetBackground";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import DecisionsPage from "@/pages/DecisionsPage";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-20T09:00:00.000Z";

/** The fixture settings the driver asks for, read before the first render. */
const params = new URLSearchParams(window.location.search);
const seedCount = Math.max(
  0,
  Number.isFinite(Number(params.get("seed"))) ? Number(params.get("seed") ?? "2") : 2,
);
const listDelayMs = Number(params.get("listDelay") ?? "900");
const snapshotDelayMs = Number(params.get("snapshotDelay") ?? "800");
const autoClose = params.get("autoClose") !== "off";
const failResolve = params.get("failResolve") === "1";
const resolveDelayMs = Number(params.get("resolveDelay") ?? "0");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── the vault the stub plays the main process for ───────────────────────────

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

const DOMAINS = [domain("financial", "Financial", 1), domain("health", "Health", 2)];

const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

function makeDecision(index: number): DecisionRecord {
  const minute = String(index % 60).padStart(2, "0");
  const title = `Premise revision ${index}`;
  return {
    id: `decision-${String(index).padStart(3, "0")}`,
    target: { type: "doctrine", domainSlug: "financial", kind: "premise" },
    domainSlugs: ["financial"],
    status: "pending",
    title,
    rationale:
      "The last quarter's ledger says the premise costs more than it claims, so the wording should say what it actually costs.",
    proposedTitle: title,
    previousTitle: title,
    proposedBodyMarkdown: `## Premise\n\nRevision ${index}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`,
    previousBodyMarkdown: `## Premise\n\nRevision ${index - 1}: the monthly cost of staying here.\n`,
    actor: COMPANION,
    createdAt: `2026-10-20T09:${minute}:00.000Z`,
    resolvedAt: null,
    reason: null,
  };
}

/** One bridge call, as the page made it: start and (once answered) end. */
type Call = { at: number; end: number | null; delayMs: number };

type Vault = {
  decisions: DecisionRecord[];
  /** The vault's live revision, exactly like `data-revision.ts` counts it. */
  revision: number;
  /** Every listener the page registered through `onVaultDataChanged`. */
  listeners: Array<(revision: number) => void>;
  /** Every answer the vault accepted, in order. */
  resolves: Array<{ id: string; resolution: string }>;
  /** Every refused answer (the bridge is alive but the vault says no). */
  resolveFailures: number;
  listCalls: Call[];
  snapshotCalls: Call[];
  /** Calls started and not yet answered: the "background is still working" tell. */
  inflight: number;
};

const vault: Vault = {
  decisions: Array.from({ length: seedCount }, (_, index) => makeDecision(index + 1)),
  revision: 0,
  listeners: [],
  resolves: [],
  resolveFailures: 0,
  listCalls: [],
  snapshotCalls: [],
  inflight: 0,
};

function snapshot(): VaultSnapshot {
  return {
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
      decisionInbox: { autoOpen: true, autoClose },
    } as VaultSettings,
    domains: DOMAINS,
    agents: [],
    decisions: vault.decisions.map((d) => ({ ...d })),
    log: [],
    map: null,
    mapError: null,
    goals: [],
    goalsError: null,
    reviews: [],
    planning: [],
    weeklyFileCount: 0,
  };
}

/**
 * Publish a write the way `main.ts` does: bump the revision once, then tell every
 * open window. The coalescing `setTimeout(send, 16)` is not reproduced — this rig
 * has one window and one write to tell, so the event lands after the write
 * returns, which is the order the page actually receives.
 */
function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
}

/** Every bridge call name the page asked for, in order. */
const bridgeCalls: Array<{ name: string; at: number }> = [];
const unexpectedCalls: Array<{ name: string; at: number }> = [];

function beginCall(call: Call, delayMs: number): void {
  call.at = performance.now();
  call.end = null;
  call.delayMs = delayMs;
  vault.inflight += 1;
}

function endCall(call: Call): void {
  call.end = performance.now();
  vault.inflight -= 1;
}

const stubs: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
  vaultGetSnapshot: async () => {
    const call: Call = { at: 0, end: null, delayMs: snapshotDelayMs };
    vault.snapshotCalls.push(call);
    beginCall(call, snapshotDelayMs);
    try {
      await sleep(snapshotDelayMs);
      return ok(snapshot());
    } finally {
      endCall(call);
    }
  },
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
    const call: Call = { at: 0, end: null, delayMs: listDelayMs };
    vault.listCalls.push(call);
    beginCall(call, listDelayMs);
    try {
      await sleep(listDelayMs);
      // A read hands back copies: the page must never be able to edit the vault
      // by holding on to what it was given, and `decisionResolve` is the writer.
      return ok(vault.decisions.map((d) => ({ ...d })));
    } finally {
      endCall(call);
    }
  },
  // The History tab also reads the operator's own manual decisions. This rig is
  // about the answer path; the manual store has its own rig.
  manualDecisionList: async () => ok([]),
  decisionResolve: async (id: unknown, resolution: unknown) => {
    if (resolveDelayMs > 0) await sleep(resolveDelayMs);
    if (failResolve) {
      vault.resolveFailures += 1;
      return {
        ok: false,
        error: "The vault refused the answer: the Decision file is read-only.",
      };
    }
    const found = vault.decisions.find((d) => d.id === String(id));
    if (!found) return { ok: false, error: `No such decision: ${String(id)}` };
    vault.resolves.push({ id: String(id), resolution: String(resolution) });
    found.status = resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-20T10:30:00.000Z";
    // The write is answered first; the window is told afterwards, like main.
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
        bridgeCalls.push({ name: prop, at: performance.now() });
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      unexpectedCalls.push({ name: prop, at: performance.now() });
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

// ── the instrument ───────────────────────────────────────────────────────────

/**
 * One answered card, timed from the click to the frame leaving the document.
 *
 * `overlayGoneAt` is the frame's own disappearance (the scrim and the panel are
 * one portal node, so its removal is the moment the sheet is no longer on
 * screen). `sheetGoneAt` is the stricter, shipped fact: the frame is gone AND
 * the router is back on the workspace route. Both are read in the page, off the
 * same `performance.now()` clock as the click.
 */
type Probe = {
  id: string;
  resolution: "approved" | "rejected";
  clickAt: number;
  cardGoneAt: number | null;
  overlayGoneAt: number | null;
  sheetGoneAt: number | null;
  pathAtSheetGone: string | null;
  workspaceAtSheetGone: boolean | null;
  bodyOverflowAtSheetGone: string | null;
};

type HarnessWindow = Window & {
  decisionsLatencyReady?: Promise<void>;
  decisionsLatencySkin?: string;
  decisionsLatencyVault?: () => {
    booting: boolean;
    hasSnapshot: boolean;
    decisionInboxAutoClose: boolean | null;
  };
  decisionsLatencyScreen?: () => Screen;
  decisionsLatencyAnswer?: (
    id: string,
    resolution: "approved" | "rejected",
  ) => { clicked: boolean; clickAt: number | null; reason?: string };
  decisionsLatencyProbe?: () => Probe | null;
  decisionsLatencyCalls?: () => {
    bridge: Array<{ name: string; at: number }>;
    unexpected: Array<{ name: string; at: number }>;
    list: Call[];
    snapshot: Call[];
    resolves: Array<{ id: string; resolution: string }>;
    resolveFailures: number;
    inflight: number;
  };
  decisionsLatencyTab?: (label: string) => boolean;
  decisionsLatencyClose?: () => boolean;
};

type CardRow = {
  id: string;
  title: string;
  status: string;
  actions: string[];
};

type Screen = {
  path: string | null;
  overlay: {
    closing: boolean;
    panel: boolean;
  } | null;
  title: string | null;
  subtitle: string | null;
  cards: CardRow[];
  /** Any control still reading "…": the stuck-processing defect. */
  ellipsisButtons: string[];
  empty: string | null;
  error: string | null;
  actionMessage: string | null;
  bodyOverflow: string;
  workspace: {
    present: boolean;
    heading: string | null;
  };
  autoClose: boolean;
  resolves: Array<{ id: string; resolution: string }>;
};

const harness = window as HarnessWindow;

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function screen(): Screen {
  const overlay = document.querySelector("[data-decisions-overlay]");
  const panel = document.querySelector(".sheet-overlay__panel--decisions");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  return {
    path: document.body.dataset.rigPath || null,
    overlay: overlay
      ? {
          closing: overlay.classList.contains("is-closing"),
          panel: panel !== null,
        }
      : null,
    title: text(document.querySelector(".sheet-overlay__title")) || null,
    subtitle: text(document.querySelector(".sheet-overlay__subtitle")) || null,
    cards: [...document.querySelectorAll(".decision-card")].map((card) => ({
      id: card.getAttribute("data-decision-id") ?? "",
      title: text(card.querySelector(".decision-card__title")),
      status: text(card.querySelector(".decision-status")),
      actions: [...card.querySelectorAll("button")].map((button) => text(button)),
    })),
    ellipsisButtons: buttons
      .filter((button) => (button.textContent ?? "").trim() === "…")
      .map((button) => button.getAttribute("data-testid") ?? text(button)),
    empty: text(document.querySelector(".decisions-inbox__empty")) || null,
    error: text(document.querySelector(".decisions-inbox__notices .form-error")) || null,
    actionMessage:
      text(document.querySelector(".decisions-inbox__notices .doc-editor__message")) ||
      null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    workspace: {
      present: Boolean(document.querySelector("[data-work-page]")),
      heading: text(document.querySelector("[data-work-title]")) || null,
    },
    autoClose,
    resolves: vault.resolves.map((call) => ({ ...call })),
  };
}

/** The card whose answer is being timed, and the watches that stop on it. */
let probe: Probe | null = null;
let observer: MutationObserver | null = null;
let pollTimer: number | null = null;

function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function cardPresent(id: string): boolean {
  return document.querySelector(`[data-decision-id="${CSS.escape(id)}"]`) !== null;
}

/**
 * Read the probe's two facts off the live DOM.
 *
 * A `MutationObserver` catches the removal in the same task the commit ran in;
 * the 4 ms poll is the fallback for the one fact a mutation cannot announce —
 * `data-rig-path`, which React writes from an effect after the commit. The
 * interval stops as soon as both facts are recorded, so a passing run leaves no
 * timer behind.
 */
function checkProbe(): void {
  if (!probe) return;
  const at = performance.now();
  if (probe.cardGoneAt === null && !cardPresent(probe.id)) {
    probe.cardGoneAt = at;
  }
  if (
    probe.overlayGoneAt === null &&
    !document.querySelector("[data-decisions-overlay]")
  ) {
    probe.overlayGoneAt = at;
  }
  if (
    probe.overlayGoneAt !== null &&
    probe.sheetGoneAt === null &&
    document.body.dataset.rigPath === "/work"
  ) {
    probe.sheetGoneAt = at;
    probe.pathAtSheetGone = document.body.dataset.rigPath ?? null;
    probe.workspaceAtSheetGone = Boolean(document.querySelector("[data-work-page]"));
    probe.bodyOverflowAtSheetGone = getComputedStyle(document.body).overflow;
    stopWatching();
  }
}

harness.decisionsLatencyScreen = screen;
harness.decisionsLatencyProbe = () => (probe ? { ...probe } : null);
harness.decisionsLatencyCalls = () => ({
  bridge: bridgeCalls.map((call) => ({ ...call })),
  unexpected: unexpectedCalls.map((call) => ({ ...call })),
  list: vault.listCalls.map((call) => ({ ...call })),
  snapshot: vault.snapshotCalls.map((call) => ({ ...call })),
  resolves: vault.resolves.map((call) => ({ ...call })),
  resolveFailures: vault.resolveFailures,
  inflight: vault.inflight,
});

/**
 * Press one card's answer, exactly as the operator does, and start the clock.
 *
 * The click runs inside the page so the timestamps share one clock with the
 * DOM observations; the driver only reads the integers back.
 */
harness.decisionsLatencyAnswer = (id, resolution) => {
  const card = document.querySelector(
    `[data-decision-id="${CSS.escape(id)}"]`,
  );
  if (!card) return { clicked: false, clickAt: null, reason: "no such card" };
  const label = resolution === "approved" ? "Approve" : "Reject";
  const button = [...card.querySelectorAll("button")].find(
    (candidate) => text(candidate) === label,
  );
  if (!button) {
    return { clicked: false, clickAt: null, reason: `no ${label} control on ${id}` };
  }
  stopWatching();
  probe = {
    id,
    resolution,
    clickAt: performance.now(),
    cardGoneAt: null,
    overlayGoneAt: null,
    sheetGoneAt: null,
    pathAtSheetGone: null,
    workspaceAtSheetGone: null,
    bodyOverflowAtSheetGone: null,
  };
  observer = new MutationObserver(checkProbe);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-rig-path"],
  });
  pollTimer = window.setInterval(checkProbe, 4);
  button.click();
  checkProbe();
  return { clicked: true, clickAt: probe.clickAt };
};

harness.decisionsLatencyTab = (label) => {
  const tab = [...document.querySelectorAll<HTMLElement>(".decisions-inbox__tab")].find(
    (candidate) => text(candidate) === label,
  );
  if (!tab) return false;
  tab.click();
  return true;
};

harness.decisionsLatencyClose = () => {
  const control = document.querySelector<HTMLElement>(".decisions-overlay__close");
  if (!control) return false;
  control.click();
  return true;
};

// ── the page the sheet is drawn over ────────────────────────────────────────

/** Every mount of the background page: closing must not remount it. */
let mounts = 0;

function WorkspacePage() {
  useEffect(() => {
    mounts += 1;
  }, []);

  return (
    <div
      className="shell__content"
      data-work-scroller=""
      style={{ height: 620, width: 1100, margin: "0 auto", overflowY: "auto" }}
    >
      <div data-work-page="" style={{ padding: "1.5rem", minHeight: 1400 }}>
        <p className="decisions-inbox__eyebrow">Workspace</p>
        <h1 className="stub-page__title" data-work-title="">
          Quarterly planning
        </h1>
        <p className="stub-page__desc muted">
          The page the operator was reading when the Decisions sheet opened. It
          stays mounted behind the sheet, and closing hands it back exactly where
          it was.
        </p>
        <div
          style={{
            marginTop: "10rem",
            padding: "1rem 1.25rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--card)",
          }}
        >
          <h2 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>
            The sheet is a detour, not a move
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
            Approving the last proposal must return the operator here — the moment
            the write lands, not after two full vault reads have answered.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The vault as the provider holds it, lent to the driver.
 *
 * The driver has to know the fixture snapshot has landed before it opens the
 * sheet: a sheet opened before `vaultGetSnapshot` answers reads the default
 * auto-close value, and the off-switch leg would then be measuring the default.
 */
function VaultProbe() {
  const { snapshot: vaultSnapshot, booting } = useVault();
  useEffect(() => {
    harness.decisionsLatencyVault = () => ({
      booting,
      hasSnapshot: vaultSnapshot !== null,
      decisionInboxAutoClose:
        vaultSnapshot?.settings.decisionInbox?.autoClose ?? null,
    });
    return () => {
      harness.decisionsLatencyVault = undefined;
    };
  }, [vaultSnapshot, booting]);
  return null;
}

function Harness() {
  const location = useLocation();
  const { background, sheet, sheetOverBackground } = useSheetBackground();

  useEffect(() => {
    document.body.dataset.rigPath = location.pathname;
  }, [location]);

  return (
    <div className="app-root">
      <header className="rig-chrome">
        <Link to="/decisions" className="rig-link" data-open-decisions="">
          Decisions
        </Link>
      </header>
      <div className="app-root__body">
        <Routes location={background}>
          <Route path="/work" element={<WorkspacePage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
        </Routes>
        {sheetOverBackground && sheet === "decisions" ? <DecisionsPage /> : null}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from decisions-latency.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/work"]}>
      <VaultProvider>
        <LiveDataProvider>
          <VaultProbe />
          <Harness />
        </LiveDataProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the workspace never painted".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
const waitForBackground = () => {
  if (!document.querySelector("[data-work-page]") || !document.querySelector("[data-work-scroller]")) {
    requestAnimationFrame(waitForBackground);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForBackground);

harness.decisionsLatencyReady = ready;
harness.decisionsLatencySkin = skinName;

// The mount counter is a claim the rig makes about the background page staying
// mounted across the sheet; keep it readable for the report.
Object.defineProperty(window, "decisionsLatencyMounts", {
  get: () => mounts,
  configurable: true,
});
