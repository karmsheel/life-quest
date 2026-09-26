import { randomUUID } from "node:crypto";
import { createDecision } from "./decisions.ts";
import { getDocument } from "./domain-documents.ts";
import { libraryGet } from "./library-documents.ts";
import {
  DOCUMENT_KINDS,
  type Actor,
  type DecisionRecord,
  type DocumentKind,
  type GoalsCommand,
  type Result,
} from "./types.ts";
import type { Command as MapCommand } from "./map/types.ts";

/** The actor a companion turn files under. */
export const COMPANION_ACTOR: Actor = { type: "agent", id: "companion", name: "Hermes" };

/**
 * A write tool that already did the work. If one of these completed in a turn, the
 * turn does not get a second Decision out of its prose.
 */
export const WRITE_TOOL_NAMES: readonly string[] = [
  "update_document",
  "create_library_document",
  "create_project",
  "close_project",
  "create_goal",
  "update_goal",
  "delete_goal",
  "create_day_type",
  "update_day_type",
  "delete_day_type",
  "set_default_weekday_type",
  "set_default_weekly_items",
];

const DAY_TEMPLATE_COMMAND_TYPES: readonly string[] = [
  "createDayType",
  "updateDayType",
  "deleteDayType",
  "setDefaultWeekdayType",
  "setDefaultWeeklyItems",
];

const GOAL_COMMAND_TYPES: readonly string[] = ["createGoal", "updateGoal", "deleteGoal"];

export type ImpliedChange =
  | {
      kind: "doctrine";
      domainSlug: string;
      documentKind: DocumentKind;
      title?: string;
      body: string;
    }
  | {
      kind: "library";
      title: string;
      body: string;
      domainSlugs?: string[];
      /** Absent means create. Present means update that note. */
      id?: string;
    }
  | { kind: "goal"; command: GoalsCommand }
  | { kind: "day-template"; command: MapCommand };

export type ImpliedTurnReason =
  | "ok"
  | "disabled"
  | "none"
  | "write-tool"
  | "project"
  | "malformed"
  | "not-template";

export type ImpliedTurnVerdict = {
  change: ImpliedChange | null;
  reason: ImpliedTurnReason;
};

const FENCE_INFO = "lifequest-decision";
const FENCE_RE = /```lifequest-decision[^\S\n]*\r?\n([\s\S]*?)```/g;

function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

function isGoalsCommand(value: unknown): value is GoalsCommand {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && GOAL_COMMAND_TYPES.includes(type);
}

function isDayTemplateCommand(value: unknown): value is MapCommand {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && DAY_TEMPLATE_COMMAND_TYPES.includes(type);
}

/** Parse one fence body into a change, or the reason it files nothing. */
function parseFenceBody(raw: string): { change?: ImpliedChange; reason: ImpliedTurnReason } {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { reason: "malformed" };
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return { reason: "malformed" };
  }

  const kind = parsed.kind;
  if (kind === "project") return { reason: "project" };

  if (kind === "doctrine") {
    if (!isDocumentKind(parsed.documentKind)) return { reason: "malformed" };
    if (typeof parsed.domainSlug !== "string" || !parsed.domainSlug.trim()) {
      return { reason: "malformed" };
    }
    if (typeof parsed.body !== "string") return { reason: "malformed" };
    if (parsed.title !== undefined && typeof parsed.title !== "string") {
      return { reason: "malformed" };
    }
    return {
      reason: "ok",
      change: {
        kind: "doctrine",
        domainSlug: parsed.domainSlug,
        documentKind: parsed.documentKind,
        title: parsed.title as string | undefined,
        body: parsed.body,
      },
    };
  }

  if (kind === "library") {
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      return { reason: "malformed" };
    }
    if (typeof parsed.body !== "string") return { reason: "malformed" };
    if (parsed.id !== undefined && (typeof parsed.id !== "string" || !parsed.id.trim())) {
      return { reason: "malformed" };
    }
    if (
      parsed.domainSlugs !== undefined &&
      (!Array.isArray(parsed.domainSlugs) ||
        !parsed.domainSlugs.every((s) => typeof s === "string"))
    ) {
      return { reason: "malformed" };
    }
    return {
      reason: "ok",
      change: {
        kind: "library",
        title: parsed.title,
        body: parsed.body,
        domainSlugs: parsed.domainSlugs as string[] | undefined,
        id: parsed.id as string | undefined,
      },
    };
  }

  if (kind === "goal") {
    if (!isGoalsCommand(parsed.command)) return { reason: "malformed" };
    return { reason: "ok", change: { kind: "goal", command: parsed.command } };
  }

  if (kind === "day-template") {
    if (parsed.command === undefined) return { reason: "malformed" };
    if (!isDayTemplateCommand(parsed.command)) return { reason: "not-template" };
    return { reason: "ok", change: { kind: "day-template", command: parsed.command } };
  }

  return { reason: "malformed" };
}

/**
 * Decide whether a finished companion turn implies a document change worth a
 * pending Decision. Never approves anything: the only output is a change plus
 * the reason it was or was not recognised.
 */
export function shouldFileImpliedTurn(input: {
  fileUnsolicited: boolean;
  assistantText: string;
  completedToolNames: readonly string[];
}): ImpliedTurnVerdict {
  if (!input.fileUnsolicited) {
    // The operator turned unsolicited filing off for this session. Do not look at the fence.
    return { change: null, reason: "disabled" };
  }
  if (input.completedToolNames.some((name) => WRITE_TOOL_NAMES.includes(name))) {
    // A write tool already landed this turn. One Decision per turn.
    return { change: null, reason: "write-tool" };
  }

  const bodies: string[] = [];
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(input.assistantText)) !== null) {
    bodies.push(match[1] ?? "");
  }
  if (bodies.length === 0) {
    // Prose outside a fence is not a change.
    return { change: null, reason: "none" };
  }

  // The last valid fence is the proposal.
  let last: ImpliedTurnVerdict = { change: null, reason: "malformed" };
  for (const body of bodies) {
    const parsed = parseFenceBody(body);
    if (parsed.reason === "ok") {
      last = { change: parsed.change ?? null, reason: "ok" };
    } else {
      last = { change: null, reason: parsed.reason };
    }
  }
  return last;
}

/**
 * File one pending Decision for an implied change. This only calls createDecision:
 * no resolveDecision, no saveDocument, no library write, no goal or map command.
 * Approving the Decision is what applies the change.
 */
export async function fileImpliedChange(
  rootPath: string,
  change: ImpliedChange,
  actor: Actor = COMPANION_ACTOR,
): Promise<Result<DecisionRecord>> {
  if (change.kind === "doctrine") {
    const current = await getDocument(rootPath, change.domainSlug, change.documentKind);
    if (!current.ok) return current;
    return createDecision(rootPath, {
      target: { type: "doctrine", domainSlug: change.domainSlug, kind: change.documentKind },
      proposedTitle: change.title?.trim() ? change.title : current.value.title,
      proposedBodyMarkdown: change.body,
      previousTitle: current.value.title,
      previousBodyMarkdown: current.value.bodyMarkdown,
      actor,
    });
  }

  if (change.kind === "library") {
    if (change.id) {
      const existing = await libraryGet(rootPath, change.id);
      if (!existing.ok) return existing;
      return createDecision(rootPath, {
        target: { type: "library", id: change.id },
        proposedTitle: change.title,
        proposedBodyMarkdown: change.body,
        previousTitle: existing.value.title,
        previousBodyMarkdown: existing.value.bodyMarkdown,
        actor,
      });
    }
    // No id means create. The id is allocated now; the file is written on approve.
    return createDecision(rootPath, {
      target: { type: "library", id: randomUUID() },
      proposedTitle: change.title,
      proposedBodyMarkdown: change.body,
      domainSlugs: change.domainSlugs,
      actor,
    });
  }

  if (change.kind === "goal") {
    const slug = (change.command as { domainSlug?: unknown }).domainSlug;
    const domainSlugs = typeof slug === "string" && slug.trim() ? [slug] : undefined;
    return createDecision(rootPath, {
      target: { type: "goal" },
      proposedBodyMarkdown: JSON.stringify(change.command),
      ...(domainSlugs ? { domainSlugs } : {}),
      actor,
    });
  }

  return createDecision(rootPath, {
    target: { type: "day-template" },
    proposedBodyMarkdown: JSON.stringify(change.command),
    actor,
  });
}
