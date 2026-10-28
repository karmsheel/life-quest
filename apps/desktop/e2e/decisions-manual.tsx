/**
 * E2E harness page for the operator's own request:
 *
 *   "I want a way for the user to log their decisions, as in manual decisions or
 *    mental decisions. Add an extra sub-tab on the decisions page for manual
 *    decisions and the user to log them, and from there under history the user is
 *    also able to see their manual decisions versus the AI-related decisions."
 *
 * It renders the REAL `components/decisions/DecisionsInbox` — the real tabs, the
 * real form, the real History list, the real source chips and filters — inside
 * the real `VaultProvider` and the real `LiveDataProvider`, so the rig measures
 * the shipped component rather than a mock of it.
 *
 * WHAT THE BRIDGE STUB IS FOR
 *
 * The main process owns the vault. The stub plays it: it holds the proposal
 * Decisions and the manual-decision store, answers `decision:list` /
 * `manualDecision:list` with copies, and answers `manualDecision:create` the way
 * the real handler does (a new record in the store, then the one
 * `vault:dataChanged` event `main.ts` fires for a mutating channel). A rig that
 * called a React setter instead would be testing its own plumbing; a rig that
 * reloaded the page would never see the store read at all.
 *
 * `?seed=` is unused on purpose: the interesting store is the manual one, and it
 * starts empty so "logs a decision" has something to prove. The two resolved AI
 * Decisions and one pending proposal are fixed, so History's merge and the
 * Pending tab's separation are facts rather than a function of the run.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type {
  DecisionRecord,
  DomainRecord,
  ManualDecisionRecord,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { DecisionsInbox } from "@/components/decisions/DecisionsInbox";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
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

const COMPANION = { type: "agent", id: "companion", name: "Hermes" } as const;

/** The pending proposal, and the two resolved AI Decisions History must merge. */
function makeDecision(
  index: number,
  status: DecisionRecord["status"],
  at: string,
  domainSlug: string,
): DecisionRecord {
  const title = `Premise revision ${index}`;
  return {
    id: `decision-${String(index).padStart(3, "0")}`,
    target: { type: "doctrine", domainSlug, kind: "premise" },
    domainSlugs: [domainSlug],
    status,
    title,
    rationale:
      "The last quarter's ledger says the premise costs more than it claims, so the wording should say what it actually costs.",
    proposedTitle: title,
    previousTitle: title,
    proposedBodyMarkdown: `## Premise\n\nRevision ${index}: the monthly cost of staying here is the number the ledger holds, not the number the premise claims.\n`,
    previousBodyMarkdown: `## Premise\n\nRevision ${index - 1}: the monthly cost of staying here.\n`,
    actor: COMPANION,
    createdAt: at,
    resolvedAt: status === "pending" ? null : "2026-10-20T09:30:00.000Z",
    reason: null,
  };
}

const AI_DECISIONS: DecisionRecord[] = [
  makeDecision(1, "approved", "2026-10-20T09:10:00.000Z", "financial"),
  makeDecision(2, "rejected", "2026-10-20T09:05:00.000Z", "health"),
  makeDecision(3, "pending", "2026-10-20T09:20:00.000Z", "financial"),
];

// ── the vault, as the main process holds it ─────────────────────────────────

type CreateInput = {
  title: string;
  rationale?: string | null;
  domainSlug?: string | null;
};

const vault = {
  decisions: AI_DECISIONS.map((d) => ({ ...d })),
  manual: [] as ManualDecisionRecord[],
  /** Every create the page asked the vault for, in order. */
  createCalls: [] as CreateInput[],
  /** Every read of the manual store: proves History reads it rather than reusing state. */
  manualListCalls: 0,
  listCalls: 0,
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: 0,
  listeners: [] as Array<(revision: number) => void>,
  /** Base times are fixed, so the sheet is the same picture on every run. */
  nextManualMinute: 0,
};

function announce(): void {
  vault.revision += 1;
  for (const listener of [...vault.listeners]) listener(vault.revision);
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

// ── the instrument ──────────────────────────────────────────────────────────

type Card = {
  id: string;
  title: string;
  /** "Manual" or "AI" (the source chip), null where the tab draws none. */
  source: string | null;
  sourceKind: string | null;
  /** The status pill's text: approved / rejected / Logged. */
  status: string;
  kind: string | null;
};

type Form = {
  labels: string[];
  title: string;
  rationale: string;
  domain: string;
  domainOptions: string[];
};

type Screen = {
  tabs: string[];
  activeTab: string | null;
  filterButtons: Array<{ label: string; pressed: boolean }>;
  form: Form | null;
  /** History's list (also the Pending list: it is the same element). */
  rows: Card[];
  /** The form's own "Your manual decisions" list. */
  manualRows: Card[];
  empty: string | null;
  manualEmpty: string | null;
  message: string | null;
  error: string | null;
  createCalls: CreateInput[];
  manualListCalls: number;
  listCalls: number;
  unexpectedCalls: string[];
};

type HarnessWindow = Window & {
  decisionsManualReady?: boolean;
  decisionsManualMounts?: () => number;
  decisionsManualTab?: (label: string) => boolean;
  decisionsManualFilter?: (label: string) => boolean;
  decisionsManualType?: (field: "title" | "rationale", value: string) => boolean;
  decisionsManualDomain?: (slug: string) => boolean;
  decisionsManualSubmit?: () => boolean;
  decisionsManualScreen?: () => Screen;
};

const harness = window as HarnessWindow;

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function cardsIn(scope: ParentNode | null): Card[] {
  if (!scope) return [];
  return [...scope.querySelectorAll<HTMLElement>(".decision-card")].map((card) => ({
    id:
      card.dataset.manualDecisionId ??
      card.dataset.decisionId ??
      "",
    title: text(card.querySelector(".decision-card__title")),
    source: text(card.querySelector(".decision-source")) || null,
    sourceKind: card.querySelector(".decision-source")?.getAttribute("data-source") ?? null,
    status: text(card.querySelector(".decision-status")),
    kind: text(card.querySelector(".decision-kind")) || null,
  }));
}

function manualForm(): Form | null {
  const form = document.querySelector<HTMLElement>(".manual-decisions__form");
  if (!form) return null;
  const areas = [...form.querySelectorAll("textarea")];
  const select = form.querySelector("select");
  return {
    labels: [...form.querySelectorAll(".field > span")].map((el) => text(el)),
    title: areas[0]?.value ?? "",
    rationale: areas[1]?.value ?? "",
    domain: select?.value ?? "",
    domainOptions: [...(select?.options ?? [])].map((o) => text(o)),
  };
}

function screen(): Screen {
  const rows = cardsIn(document.querySelector(".decisions-inbox__list"));
  const form = manualForm();
  return {
    tabs: [...document.querySelectorAll(".decisions-inbox__tab")].map((t) => text(t)),
    activeTab:
      text(document.querySelector('.decisions-inbox__tab[aria-selected="true"]')) || null,
    filterButtons: [
      ...document.querySelectorAll<HTMLElement>(".decisions-inbox__filter"),
    ].map((button) => ({
      label: text(button),
      pressed: button.getAttribute("aria-pressed") === "true",
    })),
    form,
    rows: document.querySelector(".manual-decisions") ? [] : rows,
    manualRows: cardsIn(document.querySelector(".manual-decisions__list")),
    empty: text(document.querySelector(".decisions-inbox__empty")) || null,
    manualEmpty: text(document.querySelector(".manual-decisions__empty")) || null,
    message: text(document.querySelector(".doc-editor__message")) || null,
    error: text(document.querySelector(".form-error")) || null,
    createCalls: vault.createCalls.map((input) => ({ ...input })),
    manualListCalls: vault.manualListCalls,
    listCalls: vault.listCalls,
    unexpectedCalls: [...(harness.decisionsManualUnexpectedCalls ?? [])],
  };
}

let mounts = 0;

harness.decisionsManualMounts = () => mounts;
harness.decisionsManualScreen = screen;

harness.decisionsManualTab = (label) => {
  const tab = [...document.querySelectorAll<HTMLElement>(".decisions-inbox__tab")].find(
    (t) => text(t) === label,
  );
  if (!tab) return false;
  tab.click();
  return true;
};

harness.decisionsManualFilter = (label) => {
  const button = [
    ...document.querySelectorAll<HTMLElement>(".decisions-inbox__filter"),
  ].find((b) => text(b) === label);
  if (!button) return false;
  button.click();
  return true;
};

/**
 * Type into a controlled textarea the way a keyboard does: the native value
 * setter, then the `input` event React listens for. Assigning `.value` alone
 * updates the DOM but not the component, which would make the rig type into a
 * field the form never sees.
 */
function setValue(
  element: HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

harness.decisionsManualType = (field, value) => {
  const areas = [
    ...(document.querySelectorAll<HTMLTextAreaElement>(
      ".manual-decisions__form textarea",
    ) ?? []),
  ];
  const target = field === "title" ? areas[0] : areas[1];
  if (!target) return false;
  setValue(target, value);
  return true;
};

harness.decisionsManualDomain = (slug) => {
  const select = document.querySelector<HTMLSelectElement>(
    ".manual-decisions__form select",
  );
  if (!select) return false;
  setValue(select, slug);
  return true;
};

harness.decisionsManualSubmit = () => {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-testid="manual-decision-submit"]',
  );
  if (!button) return false;
  button.click();
  return true;
};

// ── the bridge ──────────────────────────────────────────────────────────────

const stubs: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
  vaultGetSnapshot: async () => ok(snapshot()),
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
    vault.listCalls += 1;
    // Copies: the page must not be able to edit the vault by holding on to what
    // it was handed. `manualDecisionCreate` is the only writer here.
    return ok(vault.decisions.map((d) => ({ ...d })));
  },
  decisionResolve: async (id: unknown, resolution: unknown) => {
    const found = vault.decisions.find((d) => d.id === String(id));
    if (!found) return { ok: false, error: `No such decision: ${String(id)}` };
    found.status = resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-20T10:30:00.000Z";
    setTimeout(announce, 0);
    return ok({ ...found });
  },
  manualDecisionList: async () => {
    vault.manualListCalls += 1;
    return ok(vault.manual.map((d) => ({ ...d })));
  },
  manualDecisionCreate: async (input: unknown) => {
    const raw = (input ?? {}) as CreateInput;
    vault.createCalls.push({
      title: String(raw.title ?? ""),
      rationale: raw.rationale ?? null,
      domainSlug: raw.domainSlug ?? null,
    });
    const title = String(raw.title ?? "").trim();
    if (!title) {
      return { ok: false, error: "Say what you decided before logging it" };
    }
    vault.nextManualMinute += 5;
    const record: ManualDecisionRecord = {
      id: `manual-${String(vault.manual.length + 1).padStart(3, "0")}`,
      title,
      rationale:
        typeof raw.rationale === "string" && raw.rationale.trim()
          ? raw.rationale.trim()
          : null,
      domainSlug:
        typeof raw.domainSlug === "string" && raw.domainSlug ? raw.domainSlug : null,
      actor: { type: "user" },
      createdAt: new Date(
        Date.UTC(2026, 9, 20, 11, 50 + vault.nextManualMinute, 0),
      ).toISOString(),
    };
    vault.manual.unshift(record);
    setTimeout(announce, 0);
    return ok({ ...record });
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.decisionsManualUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

// The Proxy's unexpected-call sink, declared after the harness type above so the
// page's stubs can be as small as the surface needs.
declare global {
  interface Window {
    decisionsManualUnexpectedCalls?: string[];
  }
}
harness.decisionsManualUnexpectedCalls = [];

// ── the page ────────────────────────────────────────────────────────────────

/** One mount of the page, counted: the rig must never reload it to see a record. */
function MountProbe() {
  useEffect(() => {
    mounts += 1;
    harness.decisionsManualReady = true;
    return () => {
      harness.decisionsManualReady = false;
    };
  }, []);
  return null;
}

function Harness() {
  return (
    <div
      className="shell__content"
      style={{ height: 760, width: 1100, margin: "0 auto", overflowY: "auto" }}
    >
      <VaultProvider>
        <LiveDataProvider>
          <MountProbe />
          <DecisionsInbox />
        </LiveDataProvider>
      </VaultProvider>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// The skin name is reported by the rig's screenshot step, never used to pick a
// page behaviour: this page is the app's, not the skin's.
void skinName;
