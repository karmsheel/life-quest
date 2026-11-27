/**
 * E2E harness for answering several Decisions at once (driven by
 * `decisions-batch.electron.mjs`).
 *
 * The operator's report this rig is for:
 *
 *   "I need an approve-all button and the ability to click approve on multiple
 *    decisions and have them applied in parallel. If I click on a second one
 *    while one is still processing, it actually stops processing. Also move the
 *    ‘Decision approved’ text to the right of the pill switcher, next to an
 *    approve-all button on the far right, so the cards don't shift up and down."
 *
 * The ways this can fail, written before the assertions:
 *
 *  1. **The bar is a stack, not a row.** If the notice and the approve-all
 *     control are laid out under the tab switcher, a message changes the height
 *     above the list and every card under it moves. The rig measures the list's
 *     top against the bar across every state that carries a message.
 *  2. **The approve-all control is not in line with the switcher.** It must sit
 *     on the switcher's row, flush with the list's trailing edge.
 *  3. **The notice is not where the operator asked.** The message and the error
 *     must be to the RIGHT of the pill switcher, not under it.
 *  4. **A second approve cancels the first.** The page kept ONE "resolving" id,
 *     so pressing approve on a second card while the first was still writing
 *     wiped the first card's "…" and re-enabled it — the operator watching saw
 *     the first answer stop processing. The stub holds every resolve open until
 *     the driver releases it, so two cards must show their own "…" at once.
 *  5. **Only the first answer reaches the vault.** Every clicked card must call
 *     `decisionResolve` for its own id, and all of them must be in flight
 *     together before any is released.
 *  6. **Approve all is one-at-a-time behind the UI.** The button must dispatch a
 *     resolve for every pending card without waiting for the previous one, so
 *     the stub sees every pending id in flight simultaneously.
 *  7. **Approve all leaves stragglers.** After every resolve lands the pending
 *     list is empty and the status is `approved` in the store.
 *
 * The real `DecisionsOverlay` / `DecisionsInbox` is rendered in a real Electron
 * window; only `window.lifequest` is stubbed, playing the main process. The stub
 * deliberately serializes nothing on its own — the page's fan-out is what the
 * rig measures.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DecisionRecord,
  DomainRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { DecisionsOverlay } from "@/components/decisions/DecisionsOverlay";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

const NOW = "2026-10-22T09:00:00.000Z";
const RESOLVED_AT = "2026-10-22T10:30:00.000Z";

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
    createdAt: `2026-10-22T09:${minute}:00.000Z`,
    resolvedAt: null,
    reason: null,
  };
}

type Vault = {
  decisions: DecisionRecord[];
  resolves: Array<{ id: string; resolution: string; at: number }>;
};

const vault: Vault = {
  decisions: [makeDecision(1), makeDecision(2), makeDecision(3), makeDecision(4)],
  resolves: [],
};

/** Resolves held open until the driver releases them, one or all. */
const waiters: Array<() => void> = [];
/** A card whose next answer the stub refuses, so the error path can be measured. */
let failNextId: string | null = null;

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
      chatQuestions: [],
      // The rig keeps the sheet up after the last answer so the message and the
      // bar can be measured; auto-close is covered by its own rig.
      decisionInbox: { autoOpen: true, autoClose: false },
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
  manualDecisionList: async () => ok([]),
  /**
   * Every answer is held at the gate until the driver releases it. The page is
   * supposed to fan several of these out at once; if it only ever has one in
   * flight, the waiters list says so.
   */
  decisionResolve: async (id: unknown, resolution: unknown) => {
    const record = {
      id: String(id),
      resolution: String(resolution),
      at: Math.round(performance.now()),
    };
    vault.resolves.push(record);
    await new Promise<void>((resolve) => waiters.push(resolve));
    if (failNextId === record.id) {
      failNextId = null;
      return { ok: false, error: "The proposal no longer applies (stub)." };
    }
    const found = vault.decisions.find((decision) => decision.id === record.id);
    if (!found) return { ok: false, error: `No such decision: ${record.id}` };
    if (found.status !== "pending") {
      return { ok: false, error: `Decision is already ${found.status}` };
    }
    found.status = record.resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = RESOLVED_AT;
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

// ── the instrument ──────────────────────────────────────────────────────────

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Notice = { box: Box; text: string } | null;

type CardSample = {
  id: string;
  title: string;
  box: Box;
  actions: Array<{ label: string; disabled: boolean }>;
  /** True while this card's own answer is in flight (its approve/reject says "…"). */
  busy: boolean;
};

type Screen = {
  skin: string;
  theme: string | null;
  bar: Box | null;
  tabs: Box | null;
  approveAll: { box: Box; text: string; disabled: boolean; title: string | null } | null;
  notices: { box: Box; message: Notice; error: Notice } | null;
  list: Box | null;
  empty: string | null;
  activeTab: string | null;
  cards: CardSample[];
  /** Answers the page has dispatched and the stub is still holding open. */
  inflight: number;
  resolves: Array<{ id: string; resolution: string; at: number }>;
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

function noticeWithin(container: Element | null, selector: string): Notice {
  const el = container?.querySelector(selector) ?? null;
  return el ? { box: box(el)!, text: text(el) } : null;
}

function screen(): Screen {
  const bar = document.querySelector(".decisions-inbox__bar");
  const tabs = document.querySelector(".decisions-inbox__tabs");
  const approveAll = document.querySelector<HTMLButtonElement>(
    '[data-testid="btn-decisions-approve-all"]',
  );
  const notices = document.querySelector(".decisions-inbox__notices");
  const list = document.querySelector(".decisions-inbox__list");
  const empty = document.querySelector(".decisions-inbox__empty");
  return {
    skin: skinName,
    theme: document.documentElement.getAttribute("data-theme"),
    bar: box(bar),
    tabs: box(tabs),
    approveAll: approveAll
      ? {
          box: box(approveAll)!,
          text: text(approveAll),
          disabled: approveAll.disabled,
          title: approveAll.getAttribute("title"),
        }
      : null,
    notices: notices
      ? {
          box: box(notices)!,
          message: noticeWithin(notices, ".doc-editor__message"),
          error: noticeWithin(notices, ".form-error"),
        }
      : null,
    list: box(list),
    empty: text(empty) || null,
    activeTab:
      text(document.querySelector('.decisions-inbox__tab[aria-selected="true"]')) ||
      null,
    cards: Array.from(document.querySelectorAll<HTMLElement>(".decision-card")).map(
      (card) => ({
        id: card.getAttribute("data-decision-id") ?? "",
        title: text(card.querySelector(".decision-card__title")),
        box: box(card)!,
        actions: Array.from(card.querySelectorAll("button")).map((button) => ({
          label: text(button),
          disabled: (button as HTMLButtonElement).disabled,
        })),
        busy: Array.from(card.querySelectorAll("button")).some(
          (button) => text(button) === "…",
        ),
      }),
    ),
    inflight: waiters.length,
    resolves: vault.resolves.map((call) => ({ ...call })),
  };
}

type HarnessWindow = Window & {
  decisionsBatchReady?: boolean;
  decisionsBatchScreen?: () => Screen;
  decisionsBatchReleaseOne?: () => boolean;
  decisionsBatchReleaseAll?: () => number;
  decisionsBatchFailNext?: (id: string | null) => string | null;
};

const harness = window as HarnessWindow;

harness.decisionsBatchScreen = screen;
harness.decisionsBatchReleaseOne = () => {
  const next = waiters.shift();
  if (!next) return false;
  next();
  return true;
};
harness.decisionsBatchReleaseAll = () => {
  const count = waiters.length;
  while (waiters.length > 0) waiters.shift()!();
  return count;
};
harness.decisionsBatchFailNext = (id) => {
  failNextId = id ?? null;
  return failNextId;
};

function MountProbe() {
  useEffect(() => {
    let alive = true;
    Promise.resolve(document.fonts.ready).then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (alive) harness.decisionsBatchReady = true;
        }),
      );
    });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/decisions"]}>
      <VaultProvider>
        <LiveDataProvider>
          <MountProbe />
          {/* The shipped sheet over the app, with a no-op close: the rig is not
              about the sheet's own exit, and auto-close is off in the settings. */}
          <DecisionsOverlay onClose={() => {}} />
        </LiveDataProvider>
      </VaultProvider>
    </MemoryRouter>
  </StrictMode>,
);
