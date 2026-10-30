/**
 * E2E harness for the decision inbox that opens and closes itself (driven by
 * `decision-inbox-auto.electron.mjs`).
 *
 * The feature, as the operator asked for it: a proposal filed while they are
 * working raises the inbox over the page they are on, and answering the last
 * pending proposal puts the sheet away and hands that page back exactly where it
 * was. Two vault settings (`decisionInbox.autoOpen`, `.autoClose`, both on by
 * default) decide whether either half happens.
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The app greets the operator with a sheet.** The rig seeds one pending
 *     Decision BEFORE the first load. The watcher's first read is a baseline, not
 *     an arrival: if landing on `/work` shows the inbox, a backlog pops every
 *     morning and "auto-open" really means "always open".
 *  2. **Opening the inbox is a navigation, not a surface.** If `/decisions`
 *     unmounts the page behind it, the blurred backdrop is a picture of nothing
 *     and closing has nowhere to go. The rig counts the workspace's mounts and
 *     measures its scrollTop and a content marker before and after; a remount or
 *     a moved page cannot pass as "the page stayed".
 *  3. **Auto-close closes too early.** Approving one of two pending cards must
 *     leave the sheet up with one card; only the last answer may close it. The
 *     rig parks the workspace, files, answers twice, and reads each state.
 *  4. **Closing loses the operator's place.** The workspace is deliberately
 *     taller than its scrollport. Closing by auto-close must return the same
 *     route, the same mounted page, the same scrollTop/marker offset, and must
 *     release the body's scroll lock.
 *  5. **The switches are decoration.** Settings › Decisions is rendered through
 *     the REAL settings sheet at the REAL `/settings?tab=decisions` route. The
 *     driver reads the rendered switches and clicks them, and the bridge stub
 *     records the `settingsUpdate` patch the panel actually sent.
 *  6. **Auto-open ignores its switch.** With `autoOpen` off a filing must not
 *     raise the sheet at all; with `autoClose` off the answered sheet must stay
 *     up on its empty state instead of vanishing.
 *  7. **A filing while the sheet is already up pushes a second sheet.** The
 *     route is already `/decisions`, so the watcher must not navigate again; the
 *     card arrives in the open sheet through the live revision, and answering it
 *     then closes the sheet.
 *
 * The bridge stub plays the main process, like `decisions-live.tsx` does: it
 * holds the vault and its settings, announces every write the way `main.ts` does
 * (bump a revision, then tell every window), and the page under test is the real
 * `DecisionInboxAutoOpen`, the real `DecisionsPage`/`SettingsPage`, the real
 * `DecisionsInbox` cards and the real `Toggle` switches under the real
 * `VaultProvider`/`LiveDataProvider`. No part of the feature is mocked here.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  DecisionRecord,
  DecisionInboxSettings,
  DomainRecord,
  VaultSettings,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { DecisionInboxAutoOpen } from "@/components/decisions/DecisionInboxAutoOpen";
import { useSheetBackground } from "@/components/shell/useSheetBackground";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider, useVault } from "@/state/VaultProvider";
import DecisionsPage from "@/pages/DecisionsPage";
import SettingsPage from "@/pages/SettingsPage";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-20T09:00:00.000Z";

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

const DOMAINS = [domain("financial", "Financial", 1), domain("health", "Health", 2)];

/** The companion: the actor a filing is attributed to, and the name the line says. */
const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

function makeDecision(index: number, title: string): DecisionRecord {
  const minute = String(index % 60).padStart(2, "0");
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
    proposedBodyMarkdown: `## Premise\n\n${title}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`,
    previousBodyMarkdown:
      "## Premise\n\nThe monthly cost of staying here.\n",
    actor: COMPANION,
    createdAt: `2026-10-20T09:${minute}:00.000Z`,
    resolvedAt: null,
    reason: null,
  };
}

// ── the vault, as the main process holds it ─────────────────────────────────

type Vault = {
  decisions: DecisionRecord[];
  /** Every resolution the page asked the vault for, in order. */
  resolves: Array<{ id: string; resolution: string }>;
  /** The settings file, including the two switches this feature reads. */
  settings: VaultSettings;
  /** Every `settingsUpdate` patch the page sent, as the main process received it. */
  updates: Array<Record<string, unknown>>;
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: number;
  /** Every listener the page registered through `onVaultDataChanged`. */
  listeners: Array<(revision: number) => void>;
  /** The next id a filing takes. */
  seq: number;
  /** How many times the inbox has been asked for its list. */
  listCalls: number;
};

const vault: Vault = {
  // Seeded BEFORE the first load: a queue that was already waiting at launch
  // must not pop the inbox. The driver proves that on landing.
  decisions: [makeDecision(1, "Premise revision 1")],
  resolves: [],
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    chatQuestions: [],
    decisionInbox: { autoOpen: true, autoClose: true },
  },
  updates: [],
  revision: 0,
  listeners: [],
  seq: 1,
  listCalls: 0,
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
      ...vault.settings,
      decisionInbox: { ...vault.settings.decisionInbox },
    },
    domains: DOMAINS,
    agents: [],
    decisions: vault.decisions.map((decision) => ({ ...decision })),
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
 * open window. This is the ONLY way a page hears about a filing; a rig that
 * called a React setter would be testing its own plumbing.
 */
function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
}

/**
 * Apply a settings patch the way the vault engine does: the whole
 * `decisionInbox` object is replaced with what the patch carries, everything
 * else is merged onto the settings file.
 */
function applySettingsPatch(patch: Record<string, unknown>): VaultSettings {
  vault.updates.push(copy(patch));
  const next: VaultSettings = {
    ...vault.settings,
    ...(patch as Partial<VaultSettings>),
  };
  if (patch.decisionInbox && typeof patch.decisionInbox === "object") {
    next.decisionInbox = {
      ...vault.settings.decisionInbox,
      ...(patch.decisionInbox as Partial<DecisionInboxSettings>),
    };
  }
  vault.settings = next;
  return copy(next);
}

const stubs: Record<string, (...args: never[]) => unknown> = {
  vaultGetSnapshot: async () => ok(snapshot()),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: (callback: never) => {
    const listener = callback as unknown as (revision: number) => void;
    vault.listeners.push(listener);
    return () => {
      const index = vault.listeners.indexOf(listener);
      if (index >= 0) vault.listeners.splice(index, 1);
    };
  },
  decisionList: async () => {
    vault.listCalls += 1;
    // A read hands back copies: the page must never be able to edit the vault by
    // holding on to what it was given, and `decisionResolve` is the only writer.
    return ok(vault.decisions.map((decision) => ({ ...decision })));
  },
  decisionResolve: async (id: never, resolution: never) => {
    const decisionId = String(id);
    const verdict = String(resolution);
    vault.resolves.push({ id: decisionId, resolution: verdict });
    const found = vault.decisions.find((decision) => decision.id === decisionId);
    if (!found) {
      return { ok: false, error: `No such decision: ${decisionId}` };
    }
    found.status = verdict === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-20T10:30:00.000Z";
    // The write is announced after the call is answered, which is the order the
    // real write path has.
    setTimeout(announce, 0);
    return ok({ ...found });
  },
  settingsUpdate: (patch: never) =>
    ok(
      applySettingsPatch(
        JSON.parse(JSON.stringify(patch)) as Record<string, unknown>,
      ),
    ),
  manualDecisionList: async () => ok([]),
};

// The backstop is the app's own bridge contract: a channel this page does not
// exercise answers `ok(null)` rather than throwing.
(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) return found;
    return () => Promise.resolve(ok(null));
  },
});

// ── the instrument ──────────────────────────────────────────────────────────

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Screen = {
  /** The MemoryRouter's path plus query: a MemoryRouter never writes the window. */
  path: string | null;
  /** Which sheet is up, read from the DOM's own markers. */
  sheet: "decisions" | "settings" | null;
  decisionsOpen: boolean;
  settingsOpen: boolean;
  /** The decisions scrim, measured: a real fixed surface over the window. */
  overlay: {
    box: Box;
    position: string;
    backdropFilter: string | null;
  } | null;
  title: string | null;
  /** The pending cards on screen, in the order the inbox draws them. */
  cards: {
    id: string;
    title: string;
    status: string;
    actions: string[];
  }[];
  inboxEmpty: string | null;
  actionMessage: string | null;
  /** The settings page the sheet is actually on, and its section heading. */
  settingsView: string | null;
  settingsTitle: string | null;
  navLabels: string[];
  rowLabels: string[];
  /** The two Decisions switches as rendered, by their own test ids. */
  switches: Array<{
    testId: string;
    present: boolean;
    label: string | null;
    checked: boolean;
  }>;
  bodyOverflow: string;
  backgroundPage: boolean;
  workspace: {
    mounts: number;
    top: number;
    max: number;
    height: number;
    markerTop: number | null;
  };
  /** The vault's settings as the stub holds them (the switch that was written). */
  settings: DecisionInboxSettings;
  /** Every settingsUpdate patch the page has sent, oldest first. */
  updates: Array<Record<string, unknown>>;
  resolveCalls: Array<{ id: string; resolution: string }>;
  listCalls: number;
};

function round(value: number): number {
  return Math.round(value);
}

function box(el: Element | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: round(r.left),
    top: round(r.top),
    width: round(r.width),
    height: round(r.height),
  };
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-work-scroller]");
}

/** Both switches by the test ids the feature promises, read from the real DOM. */
function switches(): Screen["switches"] {
  return ["settings-decision-auto-open", "settings-decision-auto-close"].map(
    (testId) => {
      const wrap = document.querySelector(`[data-testid="${testId}"]`);
      const control =
        wrap && wrap.matches('[role="switch"]')
          ? wrap
          : wrap?.querySelector('[role="switch"]') ?? null;
      return {
        testId,
        present: control !== null,
        label: control?.getAttribute("aria-label") ?? null,
        checked: control?.getAttribute("aria-checked") === "true",
      };
    },
  );
}

function screen(): Screen {
  const decisionsOverlay = document.querySelector("[data-decisions-overlay]");
  const settingsOverlay = document.querySelector("[data-settings-overlay]");
  const overlayStyle = decisionsOverlay
    ? getComputedStyle(decisionsOverlay)
    : null;
  const port = scroller();
  const portBox = box(port);
  const markerBox = box(document.querySelector("[data-work-marker]"));
  const view = document.querySelector("[data-settings-view]");

  return {
    path: document.body.dataset.rigPath || null,
    sheet: decisionsOverlay ? "decisions" : settingsOverlay ? "settings" : null,
    decisionsOpen: Boolean(decisionsOverlay),
    settingsOpen: Boolean(settingsOverlay),
    overlay: decisionsOverlay
      ? {
          box: box(decisionsOverlay)!,
          position: overlayStyle!.position,
          backdropFilter:
            overlayStyle!.backdropFilter ||
            overlayStyle!.webkitBackdropFilter ||
            null,
        }
      : null,
    title: text(document.querySelector(".sheet-overlay__title")) || null,
    cards: Array.from(
      document.querySelectorAll<HTMLElement>(".decision-card[data-decision-id]"),
    ).map((card) => ({
      id: card.dataset.decisionId ?? "",
      title: text(card.querySelector(".decision-card__title")),
      status: text(card.querySelector(".decision-status")),
      actions: Array.from(card.querySelectorAll("button")).map((button) =>
        text(button),
      ),
    })),
    inboxEmpty: text(document.querySelector(".decisions-inbox__empty")) || null,
    actionMessage: text(document.querySelector(".doc-editor__message")) || null,
    settingsView: view?.getAttribute("data-settings-view") ?? null,
    settingsTitle: text(document.querySelector(".settings-panel__title")) || null,
    navLabels: Array.from(
      document.querySelectorAll(".settings-nav-item__label"),
    ).map((label) => text(label)),
    rowLabels: Array.from(
      document.querySelectorAll(".settings-card__label"),
    ).map((label) => text(label)),
    switches: switches(),
    bodyOverflow: getComputedStyle(document.body).overflow,
    backgroundPage: Boolean(document.querySelector("[data-work-page]")),
    workspace: {
      mounts,
      top: round(port?.scrollTop ?? 0),
      max: round((port?.scrollHeight ?? 0) - (port?.clientHeight ?? 0)),
      height: round(port?.clientHeight ?? 0),
      markerTop:
        portBox && markerBox ? round(markerBox.top - portBox.top) : null,
    },
    settings: { ...vault.settings.decisionInbox },
    updates: copy(vault.updates),
    resolveCalls: copy(vault.resolves),
    listCalls: vault.listCalls,
  };
}

// ── the harness page ────────────────────────────────────────────────────────

const harness = window as HarnessWindow;

/** Every mount of the background page. A sheet must never add one. */
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
      <div data-work-page="" style={{ padding: "1.5rem", minHeight: 1800 }}>
        <p className="decisions-inbox__eyebrow">Workspace</p>
        <h1 className="stub-page__title">Quarterly planning</h1>
        <p className="stub-page__desc muted">
          The page the operator was reading. It stays mounted behind the inbox
          and is handed back exactly where it was.
        </p>
        <div
          data-work-note=""
          style={{
            marginTop: "14rem",
            padding: "1rem 1.25rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--card)",
          }}
        >
          <h2 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>
            Keep this paragraph in view
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
            Approving a proposal is a detour, not a move. The inbox opens over
            this page and closing it must put the operator back on this
            paragraph.
          </p>
        </div>
        <div style={{ marginTop: "22rem" }}>
          <p data-work-marker="" className="muted">
            A marker far down the workspace, for measuring the operator's place.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The app's own settings write, lent to the driver.
 *
 * Turning a switch from the driver is the REAL `useVault().updateSettings`, the
 * same call the Settings panel makes, including the whole `decisionInbox` object
 * the engine expects. Reaching into the stub directly would be asserting this
 * rig's idea of what a settings write is.
 */
function Instrument() {
  const { snapshot: current, updateSettings } = useVault();
  const snapshotRef = useRef(current);
  snapshotRef.current = current;
  const updateRef = useRef(updateSettings);
  updateRef.current = updateSettings;

  useEffect(() => {
    harness.decisionAutoSet = (key, value) => {
      const saved = snapshotRef.current?.settings.decisionInbox ?? {
        autoOpen: true,
        autoClose: true,
      };
      return updateRef.current({
        decisionInbox: { ...saved, [key]: value },
      });
    };
    return () => {
      harness.decisionAutoSet = undefined;
    };
  }, []);

  return null;
}

function Harness() {
  const location = useLocation();
  const { background, sheet, sheetOverBackground } = useSheetBackground();

  // The path a MemoryRouter never writes to the window; the driver reads it.
  useEffect(() => {
    document.body.dataset.rigPath = `${location.pathname}${location.search}`;
  }, [location]);

  return (
    <div className="app-root">
      <header className="rig-chrome">
        <Link to="/decisions" className="rig-link" data-open-decisions="">
          Decisions
        </Link>
        <Link
          to="/settings?tab=decisions"
          className="rig-link"
          data-open-settings=""
        >
          Settings
        </Link>
        <Link to="/work" className="rig-link" data-back-work="">
          Work
        </Link>
      </header>
      <div className="app-root__body">
        {/* The same shape App.tsx uses: the background page stays mounted while a
            sheet path is in the address bar, and the sheet is painted above it. */}
        <Routes location={background}>
          <Route path="/work" element={<WorkspacePage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        {sheetOverBackground && sheet === "decisions" ? <DecisionsPage /> : null}
        {sheetOverBackground && sheet === "settings" ? <SettingsPage /> : null}
        {/* Inside the router and the vault, outside every page — the app's own
            mount point for the watcher. */}
        <DecisionInboxAutoOpen />
      </div>
      <Instrument />
    </div>
  );
}

// ── what the driver can call ────────────────────────────────────────────────

harness.decisionAutoScreen = screen;

harness.decisionAutoScrollTo = (top) => {
  const port = scroller();
  if (!port) return false;
  port.scrollTop = top;
  return true;
};

harness.decisionAutoSettings = () => copy(vault.settings);

harness.decisionAutoResolveCalls = () => copy(vault.resolves);

/**
 * The companion's filing: a pending Decision written into the vault, then the
 * one event the page hears about it, asynchronously — the order the real write
 * path has (the tool call is answered first, the window is told afterwards).
 */
harness.decisionAutoFile = (title) => {
  vault.seq += 1;
  const decision = makeDecision(
    vault.seq,
    title ?? `Premise revision ${vault.seq}`,
  );
  vault.decisions.push(decision);
  setTimeout(announce, 0);
  return decision.id;
};

/** Press the card's own answer control, exactly as the operator does. */
function clickCardAction(id: string | undefined, label: string): boolean {
  const cards = [
    ...document.querySelectorAll<HTMLElement>(
      ".decision-card[data-decision-id]",
    ),
  ];
  const card = id
    ? cards.find((candidate) => candidate.dataset.decisionId === id)
    : cards[0];
  if (!card) return false;
  const button = [...card.querySelectorAll("button")].find(
    (candidate) => text(candidate) === label,
  );
  if (!button) return false;
  button.click();
  return true;
}

harness.decisionAutoApprove = (id) => clickCardAction(id, "Approve");
harness.decisionAutoReject = (id) => clickCardAction(id, "Reject");

type HarnessWindow = Window & {
  decisionAutoReady?: Promise<void>;
  decisionAutoSkin?: string;
  decisionAutoScreen?: () => Screen;
  decisionAutoScrollTo?: (top: number) => boolean;
  decisionAutoFile?: (title?: string) => string;
  decisionAutoApprove?: (id?: string) => boolean;
  decisionAutoReject?: (id?: string) => boolean;
  decisionAutoSet?: (key: keyof DecisionInboxSettings, value: boolean) => Promise<
    Result<VaultSettings>
  >;
  decisionAutoSettings?: () => VaultSettings;
  decisionAutoResolveCalls?: () => Array<{ id: string; resolution: string }>;
};

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from decision-inbox-auto.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/work"]}>
      <VaultProvider>
        <LiveDataProvider>
          <Harness />
        </LiveDataProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The runner waits on this rather than on a timer, so a slow first Vite
// transform cannot be mistaken for "the workspace never painted" — and it waits
// for the watcher's FIRST read, because landing before the baseline exists would
// make the pre-existing queue indistinguishable from a filing.
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
const waitForBoot = () => {
  if (
    !document.querySelector("[data-work-page]") ||
    !scroller() ||
    vault.listCalls < 1
  ) {
    requestAnimationFrame(waitForBoot);
    return;
  }
  Promise.resolve(document.fonts.ready).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => settle())),
    );
  });
};
requestAnimationFrame(waitForBoot);

harness.decisionAutoReady = ready;
harness.decisionAutoSkin = skinName;
