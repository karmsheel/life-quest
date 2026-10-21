/**
 * E2E harness for the decisions sheet (driven by `decisions-sheet.electron.mjs`).
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The inbox is still a page.** If `/decisions` unmounts the page behind it,
 *     the blurred backdrop is a picture of nothing and closing has nowhere to
 *     return to. The rig mounts the same `useSheetBackground` + route shape the
 *     app renders, and counts the workspace's mounts so a remount cannot pass as
 *     "the page stayed".
 *  2. **Closing loses the operator's place.** The workspace is deliberately
 *     taller than its scrollport. The driver scrolls it, opens the sheet,
 *     approves a Decision, closes, and reads the same `scrollTop` and the same
 *     marker offset — not just the same route.
 *  3. **The sheet is the column's 90%, not the window's.** A panel sized inside a
 *     padded, scrolling column measures its parent. The driver reads the panel's
 *     box against the window.
 *  4. **The scrim is a plain dim.** `backdrop-filter` is a computed property a
 *     stylesheet typo silently drops, so the driver reads it back.
 *  5. **A press inside dismisses it.** The panel's own fields and cards must not
 *     reach the scrim's `mousedown`.
 *  6. **Escape or the cross leaves the route behind.** Both must unwind the one
 *     navigation into the sheet, hand back the same mounted workspace, and
 *     restore the body's scroll lock.
 *  7. **Approving does not work from the surface.** The real `DecisionResolve`
 *     bridge is called from the real card, and the card leaves Pending.
 *
 * The bridge stub plays the main process: it holds the vault's decisions and
 * answers the two calls this surface makes. A read hands back copies, so the page
 * cannot edit the vault by holding on to what it was given.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { useSheetBackground } from "@/components/shell/useSheetBackground";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
import DecisionsPage from "@/pages/DecisionsPage";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-20T09:00:00.000Z";

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

type Vault = {
  decisions: DecisionRecord[];
  resolves: Array<{ id: string; resolution: string }>;
};

const vault: Vault = {
  decisions: [makeDecision(1), makeDecision(2), makeDecision(3)],
  resolves: [],
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
    },
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

const stubs: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
  vaultGetSnapshot: async () => ok(snapshot()),
  vaultListRecent: async () => [],
  domainGetActive: async () => null,
  domainSetActive: async () => ok(null),
  onVaultFileChanged: () => () => {},
  onVaultDataChanged: () => () => {},
  decisionList: async () => ok(vault.decisions.map((d) => ({ ...d }))),
  decisionResolve: async (id: unknown, resolution: unknown) => {
    vault.resolves.push({ id: String(id), resolution: String(resolution) });
    const found = vault.decisions.find((d) => d.id === String(id));
    if (!found) return { ok: false, error: `No such decision: ${String(id)}` };
    found.status = resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-20T10:30:00.000Z";
    return ok({ ...found });
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) return found;
    return (..._args: unknown[]) =>
      Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
  },
});

const harness = window as HarnessWindow;

/** Every mount of the background page. Closing must not add one. */
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
          The page the operator was reading. It stays mounted behind the sheet and
          returns exactly where it was.
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
            Approving a Decision is a detour, not a move. The sheet opens over this
            page and closing it must put the operator back on this paragraph.
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

// ── the instrument ──────────────────────────────────────────────────────────

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Screen = {
  path: string | null;
  overlay: {
    box: Box;
    position: string;
    zIndex: string;
    backdropFilter: string | null;
    background: string;
    panel: {
      box: Box;
      radius: string;
      background: string;
      borderColor: string;
    } | null;
    chrome: Box | null;
  } | null;
  close: { box: Box; label: string | null; title: string | null } | null;
  title: string | null;
  subtitle: string | null;
  /** The newest card, so the driver can measure the frame's side gutters. */
  cardBox: Box | null;
  cards: {
    id: string;
    title: string;
    status: string;
    actions: string[];
  }[];
  actionMessage: string | null;
  bodyOverflow: string;
  backgroundPage: boolean;
  workspace: {
    mounts: number;
    top: number;
    max: number;
    height: number;
    markerTop: number | null;
  };
  resolveCalls: Array<{ id: string; resolution: string }>;
  focus: {
    tag: string;
    className: string;
    label: string | null;
    insideSheet: boolean;
    openTrigger: boolean;
  } | null;
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
    right: round(r.right),
    bottom: round(r.bottom),
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

function screen(): Screen {
  const overlay = document.querySelector("[data-decisions-overlay]");
  const panel = document.querySelector(".sheet-overlay__panel--decisions");
  const chrome = document.querySelector(".sheet-overlay__chrome");
  const close = document.querySelector(".decisions-overlay__close");
  const firstCard = document.querySelector(".decision-card");
  const overlayStyle = overlay ? getComputedStyle(overlay) : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const port = scroller();
  const marker = document.querySelector("[data-work-marker]");
  const focus = document.activeElement;
  const box_ = box(port);
  const markerBox = box(marker);

  return {
    path: document.body.dataset.rigPath || null,
    overlay: overlay
      ? {
          box: box(overlay)!,
          position: overlayStyle!.position,
          zIndex: overlayStyle!.zIndex,
          backdropFilter:
            overlayStyle!.backdropFilter ||
            overlayStyle!.webkitBackdropFilter ||
            null,
          background: overlayStyle!.backgroundColor,
          panel: panel
            ? {
                box: box(panel)!,
                radius: panelStyle!.borderRadius,
                background: panelStyle!.backgroundColor,
                borderColor: panelStyle!.borderColor,
              }
            : null,
          chrome: box(chrome),
        }
      : null,
    close: close
      ? {
          box: box(close)!,
          label: close.getAttribute("aria-label"),
          title: close.getAttribute("title"),
        }
      : null,
    title: text(document.querySelector(".sheet-overlay__title")) || null,
    subtitle: text(document.querySelector(".sheet-overlay__subtitle")) || null,
    cardBox: box(firstCard),
    cards: Array.from(document.querySelectorAll(".decision-card")).map((card) => ({
      id: card.getAttribute("data-decision-id") ?? "",
      title: text(card.querySelector(".decision-card__title")),
      status: text(card.querySelector(".decision-status")),
      actions: Array.from(card.querySelectorAll("button")).map(text),
    })),
    actionMessage: text(document.querySelector(".doc-editor__message")) || null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    backgroundPage: Boolean(document.querySelector("[data-work-page]")),
    workspace: {
      mounts,
      top: round(port?.scrollTop ?? 0),
      max: round((port?.scrollHeight ?? 0) - (port?.clientHeight ?? 0)),
      height: round(port?.clientHeight ?? 0),
      markerTop:
        box_ && markerBox ? round(markerBox.top - box_.top) : null,
    },
    resolveCalls: vault.resolves.map((call) => ({ ...call })),
    focus:
      focus instanceof HTMLElement
        ? {
            tag: focus.tagName,
            className: String(focus.className || ""),
            label: focus.getAttribute("aria-label"),
            insideSheet: Boolean(focus.closest("[data-decisions-overlay]")),
            openTrigger: focus.hasAttribute("data-open-decisions"),
          }
        : null,
  };
}

harness.decisionsSheetScreen = screen;
harness.decisionsSheetScrollTo = (top) => {
  const port = scroller();
  if (!port) return false;
  port.scrollTop = top;
  return true;
};

type HarnessWindow = Window & {
  decisionsSheetReady?: Promise<void>;
  decisionsSheetSkin?: string;
  decisionsSheetScreen?: () => Screen;
  decisionsSheetScrollTo?: (top: number) => boolean;
};

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from decisions-sheet.html");

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

// The runner waits on this rather than on a timer, so a slow first Vite transform
// cannot be mistaken for "the workspace never painted".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});
const waitForBackground = () => {
  if (!document.querySelector("[data-work-page]") || !scroller()) {
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

harness.decisionsSheetReady = ready;
harness.decisionsSheetSkin = skinName;
