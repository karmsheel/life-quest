/**
 * E2E harness page for "amend then approve" in the operator's Decisions inbox.
 *
 * It renders the REAL `components/decisions/DecisionsInbox` — the real pending
 * cards, the real `DecisionEditor`, the real History list — inside the real
 * `VaultProvider` and the real `LiveDataProvider`, so the rig measures the
 * shipped component rather than a mock of it. The bridge stub below plays the
 * main process: it holds the Decisions, answers `decision:list` with copies,
 * applies `decision:amend` with the same record semantics the engine has
 * (first amendment keeps the agent's proposal in `originalProposed*`, a later
 * one does not overwrite it, `revert` restores and clears, project titles are
 * derived from the body), and announces `vault:dataChanged` exactly the way
 * `data-revision.ts` does after a mutating channel.
 *
 * THE WORLD, fixed so every claim is falsifiable
 *
 *  - `decision-deck`: a pending project `createProject` Decision filed by the
 *    companion with the typo title "Buid a garden deck". It has NOT been
 *    amended, so the editor opens on the agent's words.
 *  - `decision-premise`: a pending doctrine Decision ALREADY amended by the
 *    operator, so its card wears the "Edited by you" chip and its editor offers
 *    "Revert to agent's version". Reverting it is how the rig proves the undo
 *    restores the agent's proposal.
 *  - `decision-ai-approved` / `decision-ai-rejected`: two resolved AI Decisions,
 *    so History has a resolved side to read after the deck proposal is approved.
 *
 * The engine's prose targets are `doctrine`, `library`, and `review`; the stub
 * mirrors that list so a prose body is never JSON-validated on its way through
 * the bridge (the engine treats a review body as markdown too).
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type {
  DecisionAmendment,
  DecisionRecord,
  DomainRecord,
  ManualDecisionRecord,
  Result,
  VaultSnapshot,
} from "@lifequest/vault-core";
import { DecisionsInbox } from "@/components/decisions/DecisionsInbox";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

const skinName = applyAppSkin("dark");

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
const USER = { type: "user" } as const;

/** The pending project proposal: the misspelt deck the operator will correct. */
const DECK_BODY = {
  type: "createProject",
  id: "proj-deck",
  title: "Buid a garden deck",
  summary: "Outdoor build",
  domainSlug: null,
  goalId: null,
};

function noAmendment(): Pick<
  DecisionRecord,
  | "amendedAt"
  | "amendedBy"
  | "amendmentNote"
  | "originalProposedTitle"
  | "originalProposedBodyMarkdown"
> {
  return {
    amendedAt: null,
    amendedBy: null,
    amendmentNote: null,
    originalProposedTitle: null,
    originalProposedBodyMarkdown: null,
  };
}

const DECISIONS: DecisionRecord[] = [
  {
    id: "decision-deck",
    target: { type: "project", id: "proj-deck" },
    domainSlugs: [],
    status: "pending",
    title: "Proposed change to the project Buid a garden deck",
    rationale: "The garden has no deck yet.",
    proposedTitle: "Buid a garden deck",
    previousTitle: null,
    proposedBodyMarkdown: JSON.stringify(DECK_BODY),
    previousBodyMarkdown: null,
    actor: COMPANION,
    createdAt: "2026-10-20T09:20:00.000Z",
    resolvedAt: null,
    reason: null,
    ...noAmendment(),
  },
  {
    id: "decision-premise",
    target: { type: "doctrine", domainSlug: "health", kind: "premise" },
    domainSlugs: ["health"],
    status: "pending",
    title: "Premise revision",
    rationale: "The premise should say what actually happens, not what used to.",
    proposedTitle: "Sleep eight hours",
    previousTitle: "Sleep more",
    proposedBodyMarkdown: "Rest is when the body repairs. Aim for eight hours a night.",
    previousBodyMarkdown: "Rest when you can.",
    actor: COMPANION,
    createdAt: "2026-10-20T09:10:00.000Z",
    resolvedAt: null,
    reason: null,
    amendedAt: "2026-10-20T09:25:00.000Z",
    amendedBy: USER,
    amendmentNote: "Be specific",
    originalProposedTitle: "Sleep more",
    originalProposedBodyMarkdown: "Rest when you can.",
  },
  {
    id: "decision-ai-approved",
    target: { type: "doctrine", domainSlug: "financial", kind: "premise" },
    domainSlugs: ["financial"],
    status: "approved",
    title: "Premise revision 1",
    rationale: null,
    proposedTitle: "Premise revision 1",
    previousTitle: "Premise revision 0",
    proposedBodyMarkdown: "The monthly cost of staying here is the number the ledger holds.",
    previousBodyMarkdown: "The monthly cost of staying here.",
    actor: COMPANION,
    createdAt: "2026-10-20T09:00:00.000Z",
    resolvedAt: "2026-10-20T09:30:00.000Z",
    reason: null,
    ...noAmendment(),
  },
  {
    id: "decision-ai-rejected",
    target: { type: "doctrine", domainSlug: "health", kind: "what" },
    domainSlugs: ["health"],
    status: "rejected",
    title: "Premise revision 2",
    rationale: null,
    proposedTitle: "Premise revision 2",
    previousTitle: "Premise revision 1",
    proposedBodyMarkdown: "A premise the operator declined.",
    previousBodyMarkdown: "A premise the operator declined.",
    actor: COMPANION,
    createdAt: "2026-10-20T08:50:00.000Z",
    resolvedAt: "2026-10-20T09:35:00.000Z",
    reason: null,
    ...noAmendment(),
  },
];

const PROSE_TARGET_TYPES = new Set(["doctrine", "library", "review"]);

// ── the vault, as the main process holds it ─────────────────────────────────

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const vault = {
  decisions: DECISIONS.map((decision) => clone(decision)),
  /** Every `decision:amend` the page asked for, in order; the claims read these. */
  amendmentCalls: [] as Array<{ id: string; input: DecisionAmendment }>,
  /** Every `decision:resolve`, in order. */
  resolveCalls: [] as Array<{ id: string; resolution: string }>,
  /** Both, interleaved: proves "Approve with changes" amends BEFORE it resolves. */
  callLog: [] as Array<{ method: string } & Record<string, unknown>>,
  listCalls: 0,
  manualListCalls: 0,
  /** The vault's live revision, exactly like the one `data-revision.ts` counts. */
  revision: 0,
  listeners: [] as Array<(revision: number) => void>,
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
    decisions: vault.decisions.map((decision) => clone(decision)),
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
 * The engine's amend semantics, played by the stub.
 *
 * Mirrors `amendDecision` in `packages/vault-core/src/decisions.ts`: only a
 * pending Decision amends; the first amendment keeps the agent's proposal, a
 * later one keeps that same original; `revert` restores it and clears the
 * amendment; the project create title is derived from the body; a non-prose
 * body has to parse as JSON or the call is refused. The page's own local
 * validation is what keeps the last case from ever reaching here, which is the
 * point of the invalid-JSON claim.
 */
function amend(id: string, input: DecisionAmendment): Result<DecisionRecord> {
  const found = vault.decisions.find((decision) => decision.id === id);
  if (!found) return { ok: false, error: `Decision not found: ${id}` };
  if (found.status !== "pending") {
    return { ok: false, error: `Decision is already ${found.status}` };
  }
  if (input.revert) {
    if (found.amendedAt === null || found.originalProposedBodyMarkdown === null) {
      return { ok: false, error: "This Decision has no original proposal to restore" };
    }
    found.proposedTitle = found.originalProposedTitle;
    found.proposedBodyMarkdown = found.originalProposedBodyMarkdown;
    found.originalProposedTitle = null;
    found.originalProposedBodyMarkdown = null;
    found.amendedAt = null;
    found.amendedBy = null;
    found.amendmentNote = null;
    return ok(clone(found));
  }
  if (input.proposedTitle === undefined && input.proposedBodyMarkdown === undefined) {
    return { ok: false, error: "An amendment needs a new title or a new proposal body" };
  }
  const firstAmendment = found.amendedAt === null;
  if (firstAmendment) {
    found.originalProposedTitle = found.proposedTitle;
    found.originalProposedBodyMarkdown = found.proposedBodyMarkdown;
  }
  if (input.proposedTitle !== undefined && input.proposedTitle !== null) {
    if (!input.proposedTitle.trim()) {
      return { ok: false, error: "proposedTitle must be a non-empty string" };
    }
    found.proposedTitle = input.proposedTitle.trim();
  }
  if (input.proposedBodyMarkdown !== undefined) {
    if (!PROSE_TARGET_TYPES.has(found.target.type)) {
      try {
        JSON.parse(input.proposedBodyMarkdown);
      } catch {
        return {
          ok: false,
          error: "The proposal body must be valid JSON for this Decision",
        };
      }
    }
    found.proposedBodyMarkdown = input.proposedBodyMarkdown;
  }
  // Where approval writes the title from the body, the body is authoritative.
  if (found.target.type === "project") {
    try {
      const body = JSON.parse(found.proposedBodyMarkdown) as {
        type?: unknown;
        title?: unknown;
      };
      if (body?.type === "createProject" && typeof body.title === "string") {
        found.proposedTitle = body.title;
      }
    } catch {
      // The body was already validated above for a JSON target.
    }
  }
  found.amendedAt = "2026-10-20T09:40:00.000Z";
  found.amendedBy = USER;
  found.amendmentNote =
    typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  return ok(clone(found));
}

// ── the instrument ──────────────────────────────────────────────────────────

type Card = {
  id: string;
  title: string;
  /** The status pill's text: pending / approved / rejected / approved · edited. */
  status: string;
  kind: string | null;
  /** The "Edited by you" chip's text, or null when the card wears none. */
  chip: string | null;
  hasEdit: boolean;
  hasApprove: boolean;
  hasReject: boolean;
  /** True while this card's proposal is open in the editor. */
  editing: boolean;
};

type Editor = {
  title: string;
  note: string;
  /** The exact-proposal JSON text, or the markdown text for a prose target. */
  json: string;
  /** True when `json` is the prose markdown textarea, not the JSON textarea. */
  prose: boolean;
  /** The typed field controls, keyed by the testid suffix (`summary`, `patch.title`). */
  fields: Record<string, string>;
  /** How many typed field controls there are (zero for a prose target). */
  fieldInputCount: number;
  /** Whether the collapsed "Exact proposal" disclosure is open. */
  exactOpen: boolean;
  error: string | null;
  saveDisabled: boolean;
  approveChangesDisabled: boolean;
  revertVisible: boolean;
};

type Screen = {
  tabs: string[];
  activeTab: string | null;
  rows: Card[];
  editor: Editor | null;
  message: string | null;
  error: string | null;
  amendmentCalls: Array<{ id: string; input: DecisionAmendment }>;
  resolveCalls: Array<{ id: string; resolution: string }>;
  callLog: Array<{ method: string } & Record<string, unknown>>;
  listCalls: number;
  unexpectedCalls: string[];
};

type HarnessWindow = Window & {
  decisionsAmendReady?: boolean;
  decisionsAmendMounts?: () => number;
  decisionsAmendTab?: (label: string) => boolean;
  decisionsAmendEdit?: (id: string) => boolean;
  decisionsAmendOpenExact?: () => boolean;
  decisionsAmendSetTitle?: (value: string) => boolean;
  decisionsAmendSetNote?: (value: string) => boolean;
  decisionsAmendSetField?: (key: string, value: string) => boolean;
  decisionsAmendSetJson?: (value: string) => boolean;
  decisionsAmendClick?: (action: "save" | "approve-changes" | "cancel" | "revert") => boolean;
  decisionsAmendScreen?: () => Screen;
  decisionsAmendDecision?: (id: string) => DecisionRecord | null;
};

const harness = window as HarnessWindow;

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function cardState(card: HTMLElement): Card {
  return {
    id: card.dataset.decisionId ?? "",
    title: text(card.querySelector(".decision-card__title")),
    status: text(card.querySelector(".decision-status")),
    kind: text(card.querySelector(".decision-kind")) || null,
    chip: text(card.querySelector('[data-testid="decision-edited-chip"]')) || null,
    hasEdit: Boolean(card.querySelector('[data-testid="btn-decision-edit"]')),
    hasApprove: Boolean(card.querySelector('[data-testid="btn-decision-approve"]')),
    hasReject: Boolean(card.querySelector('[data-testid="btn-decision-reject"]')),
    editing: Boolean(card.querySelector('[data-testid="decision-editor"]')),
  };
}

function editorState(): Editor | null {
  const form = document.querySelector<HTMLElement>('[data-testid="decision-editor"]');
  if (!form) return null;
  const jsonEl = form.querySelector<HTMLTextAreaElement>(
    '[data-testid="decision-editor-json"]',
  );
  const titleEl = form.querySelector<HTMLInputElement>(
    '[data-testid="decision-editor-title"]',
  );
  const noteEl = form.querySelector<HTMLInputElement>(
    '[data-testid="decision-editor-note"]',
  );
  const save = form.querySelector<HTMLButtonElement>('[data-testid="btn-decision-save"]');
  const approveChanges = form.querySelector<HTMLButtonElement>(
    '[data-testid="btn-decision-approve-changes"]',
  );
  const exact = form.querySelector<HTMLDetailsElement>("details.decision-editor__exact");
  const fields: Record<string, string> = {};
  for (const field of form.querySelectorAll<HTMLElement>(
    '[data-testid^="decision-editor-field-"]',
  )) {
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      const key = (field.getAttribute("data-testid") ?? "").replace(
        "decision-editor-field-",
        "",
      );
      fields[key] = field.value;
    }
  }
  return {
    title: titleEl?.value ?? "",
    note: noteEl?.value ?? "",
    json: jsonEl?.value ?? "",
    prose: Boolean(jsonEl?.classList.contains("decision-editor__markdown")),
    fields,
    fieldInputCount: Object.keys(fields).length,
    exactOpen: Boolean(exact?.open),
    error: text(form.querySelector('[data-testid="decision-editor-error"]')) || null,
    saveDisabled: Boolean(save?.disabled),
    approveChangesDisabled: Boolean(approveChanges?.disabled),
    revertVisible: Boolean(form.querySelector('[data-testid="btn-decision-revert"]')),
  };
}

function screen(): Screen {
  const rows = [...document.querySelectorAll<HTMLElement>(
    ".decisions-inbox__list .decision-card",
  )].map(cardState);
  return {
    tabs: [...document.querySelectorAll(".decisions-inbox__tab")].map((tab) => text(tab)),
    activeTab:
      text(document.querySelector('.decisions-inbox__tab[aria-selected="true"]')) || null,
    rows,
    editor: editorState(),
    message: text(document.querySelector(".doc-editor__message")) || null,
    error: text(document.querySelector(".form-error")) || null,
    amendmentCalls: clone(vault.amendmentCalls),
    resolveCalls: clone(vault.resolveCalls),
    callLog: clone(vault.callLog),
    listCalls: vault.listCalls,
    unexpectedCalls: [...(harness.decisionsAmendUnexpectedCalls ?? [])],
  };
}

/** The app's own lens provider, counted so the rig can say the page never remounted. */
let mounts = 0;

harness.decisionsAmendMounts = () => mounts;
harness.decisionsAmendScreen = screen;
harness.decisionsAmendDecision = (id) => {
  const found = vault.decisions.find((decision) => decision.id === id);
  return found ? clone(found) : null;
};

harness.decisionsAmendTab = (label) => {
  const tab = [...document.querySelectorAll<HTMLElement>(".decisions-inbox__tab")].find(
    (candidate) => text(candidate) === label,
  );
  if (!tab) return false;
  tab.click();
  return true;
};

harness.decisionsAmendEdit = (id) => {
  const card = document.querySelector<HTMLElement>(`[data-decision-id="${id}"]`);
  const button = card?.querySelector<HTMLButtonElement>('[data-testid="btn-decision-edit"]');
  if (!button) return false;
  button.click();
  return true;
};

harness.decisionsAmendOpenExact = () => {
  const exact = document.querySelector<HTMLDetailsElement>(
    '[data-testid="decision-editor"] details.decision-editor__exact',
  );
  if (!exact) return false;
  exact.open = true;
  return true;
};

/**
 * Type into a controlled input the way a keyboard does: the native value setter,
 * then the event React listens for. Assigning `.value` alone updates the DOM but
 * not the component, which would make the rig type into a field the editor never
 * sees.
 */
function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

harness.decisionsAmendSetTitle = (value) => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="decision-editor-title"]',
  );
  if (!input) return false;
  setValue(input, value);
  return true;
};

harness.decisionsAmendSetNote = (value) => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="decision-editor-note"]',
  );
  if (!input) return false;
  setValue(input, value);
  return true;
};

harness.decisionsAmendSetField = (key, value) => {
  const field = document.querySelector<HTMLElement>(
    `[data-testid="decision-editor-field-${key}"]`,
  );
  if (
    !(
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    )
  ) {
    return false;
  }
  setValue(field, value);
  return true;
};

harness.decisionsAmendSetJson = (value) => {
  const area = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="decision-editor-json"]',
  );
  if (!area) return false;
  setValue(area, value);
  return true;
};

harness.decisionsAmendClick = (action) => {
  const testId =
    action === "save"
      ? "btn-decision-save"
      : action === "approve-changes"
        ? "btn-decision-approve-changes"
        : action === "cancel"
          ? "btn-decision-cancel"
          : "btn-decision-revert";
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button || button.disabled) return false;
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
    // it was handed. `decisionAmend` is the only writer here.
    return ok(vault.decisions.map((decision) => clone(decision)));
  },
  decisionAmend: async (id: unknown, input: unknown) => {
    const amendment = clone((input ?? {}) as DecisionAmendment);
    const decisionId = String(id);
    vault.amendmentCalls.push({ id: decisionId, input: amendment });
    vault.callLog.push({ method: "decisionAmend", id: decisionId, input: amendment });
    const result = amend(decisionId, amendment);
    if (result.ok) setTimeout(announce, 0);
    return result;
  },
  decisionResolve: async (id: unknown, resolution: unknown) => {
    const decisionId = String(id);
    vault.resolveCalls.push({ id: decisionId, resolution: String(resolution) });
    vault.callLog.push({
      method: "decisionResolve",
      id: decisionId,
      resolution: String(resolution),
    });
    const found = vault.decisions.find((decision) => decision.id === decisionId);
    if (!found) return { ok: false, error: `Decision not found: ${decisionId}` };
    if (found.status !== "pending") {
      return { ok: false, error: `Decision is already ${found.status}` };
    }
    found.status = resolution === "approved" ? "approved" : "rejected";
    found.resolvedAt = "2026-10-20T10:30:00.000Z";
    setTimeout(announce, 0);
    return ok(clone(found));
  },
  manualDecisionList: async () => {
    vault.manualListCalls += 1;
    return ok([] as ManualDecisionRecord[]);
  },
};

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => found(...args);
    }
    return (..._args: unknown[]) => {
      harness.decisionsAmendUnexpectedCalls!.push(prop);
      return Promise.resolve({ ok: false, error: `unexpected bridge call: ${prop}` });
    };
  },
});

// The Proxy's unexpected-call sink, declared after the harness type above so the
// page's stubs can be as small as the surface needs.
declare global {
  interface Window {
    decisionsAmendUnexpectedCalls?: string[];
  }
}
harness.decisionsAmendUnexpectedCalls = [];

// ── the page ────────────────────────────────────────────────────────────────

/** One mount of the page, counted: the rig must never reload it to see a record. */
function MountProbe() {
  useEffect(() => {
    mounts += 1;
    harness.decisionsAmendReady = true;
    return () => {
      harness.decisionsAmendReady = false;
    };
  }, []);
  return null;
}

function Harness() {
  return (
    <div
      className="shell__content"
      style={{ height: 900, width: 1100, margin: "0 auto", overflowY: "auto" }}
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
