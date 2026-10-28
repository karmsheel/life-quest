import { randomUUID } from "node:crypto";
import { createDecision, listDecisions } from "./decisions.ts";
import { getDocument } from "./domain-documents.ts";
import { libraryGet } from "./library-documents.ts";
import { listDomains } from "./domains.ts";
import { loadGoals } from "./goals.ts";
import { projectGet } from "./projects.ts";
import {
  DOCUMENT_KINDS,
  type Actor,
  type DecisionRecord,
  type DocumentKind,
  type GoalsCommand,
  type ProjectCommand,
  type Result,
} from "./types.ts";
import type { Command as MapCommand } from "./map/types.ts";

/** The actor a companion turn files under. */
export const COMPANION_ACTOR: Actor = { type: "agent", id: "companion", name: "Hermes" };

/**
 * A change a companion turn proposed in its prose, before anything is written.
 *
 * Every kind here exists because an agent can propose it in a turn: doctrine and
 * library edits, goals, day templates, and — the one the old funnel refused —
 * projects. A project is a file in the vault like any other, so a proposal to
 * create or close one is a Decision exactly as a proposal to edit a document is.
 */
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
  | { kind: "day-template"; command: MapCommand }
  | { kind: "project"; command: ProjectCommand };

/**
 * Why a turn filed nothing, or how a whole turn went.
 *
 * `ok` is a turn that produced at least one proposal, even if some of its other
 * fences were malformed — the operator gets the ones that parsed and a notice
 * naming the ones that did not. `invalid` is a turn where every fence it carried
 * was unusable; `none` is a reply with no fence at all.
 */
export type ImpliedTurnReason = "ok" | "disabled" | "none" | "invalid";

/** Why one fence in a turn could not become a proposal. */
export type ImpliedTurnFailureReason =
  | "malformed"
  | "unsupported"
  | "not-template"
  | "invalid";

/** One fence that could not become a proposal, named well enough to tell the operator. */
export type ImpliedTurnFailure = {
  /** 0-based position of the fenced block in the reply. */
  fenceIndex: number;
  reason: ImpliedTurnFailureReason;
  detail: string;
};

export type ImpliedTurnVerdict = {
  /** Every fileable proposal in the turn, in the order the reply made them. */
  changes: ImpliedChange[];
  /** Every fence that could not be filed, so nothing disappears without a word. */
  failures: ImpliedTurnFailure[];
  reason: ImpliedTurnReason;
};

const GOAL_COMMAND_TYPES = ["createGoal", "updateGoal", "deleteGoal"] as const;
const DAY_TEMPLATE_COMMAND_TYPES = [
  "createDayType",
  "updateDayType",
  "deleteDayType",
  "setDefaultWeekdayType",
  "setDefaultWeeklyItems",
] as const;

function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

function isGoalsCommand(value: unknown): value is GoalsCommand {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === "string" && (GOAL_COMMAND_TYPES as readonly string[]).includes(type)
  );
}

function isDayTemplateCommand(value: unknown): value is MapCommand {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    (DAY_TEMPLATE_COMMAND_TYPES as readonly string[]).includes(type)
  );
}

/**
 * What a fenced proposal can say about a project.
 *
 * `createProject` carries the id allocated at propose time so approval writes
 * that exact file — the same shape the `create_project` tool files. `closeProject`
 * names the project to close.
 */
function isProjectCommand(value: unknown): value is ProjectCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.type === "closeProject") {
    return typeof command.id === "string" && command.id.trim().length > 0;
  }
  if (command.type !== "createProject") return false;
  if (typeof command.title !== "string" || !command.title.trim()) return false;
  // A project no longer has to be filed under a goal: the schema made goalId
  // optional so a project can start before it belongs to one.
  if (
    command.goalId !== undefined &&
    command.goalId !== null &&
    typeof command.goalId !== "string"
  ) {
    return false;
  }
  if (
    command.domainSlug !== undefined &&
    command.domainSlug !== null &&
    typeof command.domainSlug !== "string"
  ) {
    return false;
  }
  return command.bodyMarkdown === undefined || typeof command.bodyMarkdown === "string";
}

const FENCE_RE = /```lifequest-decision[^\S\n]*\r?\n([\s\S]*?)```/g;

/** A failed parse, in one shape so the collectors cannot disagree about it. */
type ParseFailure = { reason: ImpliedTurnFailureReason; detail: string };
type ParseOutcome = { change?: ImpliedChange; failure?: ParseFailure };

function failed(
  detail: string,
  reason: ImpliedTurnFailureReason = "malformed",
): ParseOutcome {
  return { failure: { reason, detail } };
}

/**
 * A project proposal, from either envelope.
 *
 * The explicit `command` is the same object the `create_project` / `close_project`
 * tools file, so a project proposed in prose and one proposed by a tool are one
 * kind of Decision. The flat shorthand exists because the other proposal kinds
 * are flat, and making projects the only kind that needs a nested command is how
 * a model ends up emitting `{"kind":"project"}` — which the old funnel answered
 * by silently filing nothing, the exact "it said it created a decision and
 * nothing was there" report this module was rewritten for.
 */
function parseProjectFence(parsed: Record<string, unknown>): ParseOutcome {
  if (parsed.command !== undefined) {
    if (!isProjectCommand(parsed.command)) {
      return failed(
        "A project proposal needs a command of type createProject (title, optional goalId) or closeProject (id).",
        "invalid",
      );
    }
    const command = parsed.command as ProjectCommand;
    if (command.type === "closeProject") {
      return { change: { kind: "project", command } };
    }
    if (command.type !== "createProject") {
      // A fence can propose a create or a close; an update is something the
      // companion files through the `update_project` tool, with a patch.
      return failed(
        "A project proposal can only create or close a project.",
        "invalid",
      );
    }
    const create = command as Extract<ProjectCommand, { type: "createProject" }>;
    // The schema the companion is given does not include an id — a model cannot
    // mint a uuid it has no way to know — so the id is allocated here, at propose
    // time. The approve path writes the file under `command.id`; without this the
    // project would be created as "undefined.md" and every later create would
    // collide with it. `proposalIdentity` leaves the id out, so dedupe still sees
    // the same project proposed twice. The links are normalized to null when the
    // fence omitted them, which is the schema's own shape.
    return {
      change: {
        kind: "project",
        command: {
          ...create,
          type: "createProject",
          id:
            typeof create.id === "string" && create.id.trim()
              ? create.id
              : randomUUID(),
          goalId:
            typeof create.goalId === "string" && create.goalId.trim()
              ? create.goalId.trim()
              : null,
          domainSlug:
            typeof create.domainSlug === "string" && create.domainSlug.trim()
              ? create.domainSlug.trim()
              : null,
        },
      },
    };
  }
  if (typeof parsed.id === "string" && parsed.id.trim() && parsed.title === undefined) {
    return {
      change: { kind: "project", command: { type: "closeProject", id: parsed.id.trim() } },
    };
  }
  if (typeof parsed.title === "string" && parsed.title.trim()) {
    // goalId is optional now; a present one still has to be a string.
    if (
      parsed.goalId !== undefined &&
      parsed.goalId !== null &&
      typeof parsed.goalId !== "string"
    ) {
      return failed("A project's goalId must be a string or null.", "malformed");
    }
    if (
      parsed.domainSlug !== undefined &&
      parsed.domainSlug !== null &&
      typeof parsed.domainSlug !== "string"
    ) {
      return failed("A project's domainSlug must be a string or null.", "malformed");
    }
    if (parsed.body !== undefined && typeof parsed.body !== "string") {
      return failed("A project's body must be a string.", "malformed");
    }
    return {
      change: {
        kind: "project",
        command: {
          type: "createProject",
          // Allocated now so approval writes the exact file this proposal named.
          id: randomUUID(),
          title: parsed.title.trim(),
          goalId:
            typeof parsed.goalId === "string" && parsed.goalId.trim()
              ? parsed.goalId.trim()
              : null,
          domainSlug:
            typeof parsed.domainSlug === "string" && parsed.domainSlug.trim()
              ? parsed.domainSlug.trim()
              : null,
          ...(typeof parsed.body === "string" ? { bodyMarkdown: parsed.body } : {}),
        },
      },
    };
  }
  return failed(
    "A project proposal needs either a command, a new title (goalId optional), or an id to close.",
    "invalid",
  );
}

/** Parse one fence body into a change, or the reason it files nothing. */
function parseFenceBody(raw: string): ParseOutcome {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return failed("A lifequest-decision block must hold one JSON object.");
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return failed(
      "A lifequest-decision block must hold one JSON object; this one is not valid JSON.",
    );
  }

  const kind = parsed.kind;

  if (kind === "doctrine") {
    if (!isDocumentKind(parsed.documentKind)) {
      return failed(
        "A doctrine proposal needs documentKind: premise, what, why or how.",
        "invalid",
      );
    }
    if (typeof parsed.domainSlug !== "string" || !parsed.domainSlug.trim()) {
      return failed("A doctrine proposal needs the domain's slug.", "invalid");
    }
    if (typeof parsed.body !== "string") {
      return failed("A doctrine proposal needs a body string.", "invalid");
    }
    if (parsed.title !== undefined && typeof parsed.title !== "string") {
      return failed("A doctrine proposal's title must be a string.", "malformed");
    }
    return {
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
      return failed("A library proposal needs a title.", "invalid");
    }
    if (typeof parsed.body !== "string") {
      return failed("A library proposal needs a body string.", "invalid");
    }
    if (parsed.id !== undefined && (typeof parsed.id !== "string" || !parsed.id.trim())) {
      return failed(
        "A library proposal's id must be a non-empty string when present.",
        "malformed",
      );
    }
    if (
      parsed.domainSlugs !== undefined &&
      (!Array.isArray(parsed.domainSlugs) ||
        !parsed.domainSlugs.every((s) => typeof s === "string"))
    ) {
      return failed("A library proposal's domainSlugs must be a list of strings.", "malformed");
    }
    return {
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
    if (!isGoalsCommand(parsed.command)) {
      return failed(
        "A goal proposal needs a command: createGoal, updateGoal or deleteGoal.",
        "invalid",
      );
    }
    return { change: { kind: "goal", command: parsed.command } };
  }

  if (kind === "day-template") {
    if (parsed.command === undefined) {
      return failed("A day-template proposal needs a command.", "invalid");
    }
    if (!isDayTemplateCommand(parsed.command)) {
      return failed(
        "A day-template proposal's command must be a day-type write (createDayType, updateDayType, deleteDayType, setDefaultWeekdayType, setDefaultWeeklyItems).",
        "not-template",
      );
    }
    return { change: { kind: "day-template", command: parsed.command } };
  }

  if (kind === "project") {
    return parseProjectFence(parsed);
  }

  return failed(
    `Unknown proposal kind ${
      typeof kind === "string" ? `"${kind}"` : "(missing)"
    }; use doctrine, library, goal, day-template or project.`,
    "unsupported",
  );
}

/** One fenced block, expanded: the array form yields several proposals per block. */
type FenceEntry = {
  fenceIndex: number;
  /** Where inside the block, for the operator-facing detail ("block 2, item 3"). */
  position: number;
  raw: string;
};

/**
 * Every proposal-shaped entry a reply carries.
 *
 * A fenced block is one proposal; a block whose body is `{"decisions":[...]}`
 * is several. The array form is accepted because a model asked for a breakdown
 * of a note naturally wants to propose the whole breakdown at once, and the
 * alternative — five separate fences the funnel used to drop four of — is the
 * defect this file exists to end.
 */
function fenceEntries(assistantText: string): FenceEntry[] {
  const blocks: string[] = [];
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(assistantText)) !== null) {
    blocks.push(match[1] ?? "");
  }
  const entries: FenceEntry[] = [];
  blocks.forEach((raw, fenceIndex) => {
    let expanded: unknown = undefined;
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        expanded = (value as Record<string, unknown>).decisions;
      }
    } catch {
      // Not JSON — one entry, so the parse below reports it as malformed.
    }
    if (Array.isArray(expanded)) {
      (expanded as unknown[]).forEach((item, position) => {
        entries.push({
          fenceIndex,
          position,
          raw: typeof item === "string" ? item : JSON.stringify(item ?? null),
        });
      });
      return;
    }
    entries.push({ fenceIndex, position: 0, raw });
  });
  return entries;
}

/**
 * Decide what a finished companion turn proposed. Never approves anything: the
 * only output is the proposals the prose contained, plus the fences that could
 * not be read.
 *
 * THE FAULT THIS REPAIRS (reported, not imagined):
 *
 *   "I asked the agent to analyse my daily note. It said it created a few
 *    decisions, but in the decisions log nothing popped up."
 *
 * The reply carried several proposals, and the old funnel filed exactly one of
 * them: it kept the LAST fenced block only, and a later malformed (or project)
 * block overwrote every valid one before it. So three proposals could file
 * zero, and one bad fence at the end could erase two good ones — while the agent
 * truthfully said it had proposed them. The funnel now reads every fence, files
 * every valid proposal, and reports every one it could not read, so a turn can
 * no longer lose a proposal without the operator being told.
 *
 * A completed write tool does not suppress the fences any more either. The old
 * rule ("one Decision per turn") assumed a tool call and a fence were the same
 * change; in fact a turn can apply one task with a tool and still propose two
 * documents in prose, and suppressing the prose silently dropped those two.
 * `completedToolNames` is still accepted so callers keep their shape, but the
 * duplicate that rule was guarding against is now handled where it belongs: at
 * filing time, by identity (`fileImpliedChanges` skips a proposal identical to
 * one already pending).
 */
export function collectImpliedTurn(input: {
  fileUnsolicited: boolean;
  assistantText: string;
  /** Kept for the callers' shape; no longer decides what gets filed. */
  completedToolNames?: readonly string[];
}): ImpliedTurnVerdict {
  if (!input.fileUnsolicited) {
    // The operator turned unsolicited filing off for this session. Do not look at the fence.
    return { changes: [], failures: [], reason: "disabled" };
  }

  const entries = fenceEntries(input.assistantText);
  if (entries.length === 0) {
    // Prose outside a fence is not a change.
    return { changes: [], failures: [], reason: "none" };
  }

  const changes: ImpliedChange[] = [];
  const failures: ImpliedTurnFailure[] = [];
  for (const entry of entries) {
    const result = parseFenceBody(entry.raw);
    if (result.change) {
      changes.push(result.change);
      continue;
    }
    const where =
      entry.position > 0
        ? `Block ${entry.fenceIndex + 1}, item ${entry.position + 1}`
        : `Block ${entry.fenceIndex + 1}`;
    failures.push({
      fenceIndex: entry.fenceIndex,
      reason: result.failure?.reason ?? "malformed",
      detail: `${where}: ${result.failure?.detail ?? "could not be read."}`,
    });
  }

  return {
    changes,
    failures,
    reason: changes.length > 0 ? "ok" : "invalid",
  };
}

/**
 * File one pending Decision for an implied change. This only calls createDecision:
 * no resolveDecision, no saveDocument, no library write, no goal, map or project
 * command. Approving the Decision is what applies the change.
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

  if (change.kind === "day-template") {
    return createDecision(rootPath, {
      target: { type: "day-template" },
      proposedBodyMarkdown: JSON.stringify(change.command),
      actor,
    });
  }

  // A project proposal is validated before it is filed, the way the
  // `create_project` / `close_project` tools validate theirs: a project naming a
  // goal or domain that does not exist would file a Decision that can never
  // apply. Both links are optional; only a present one is checked.
  const command = change.command;
  if (command.type === "createProject") {
    if (command.goalId) {
      const goals = await loadGoals(rootPath);
      if (!goals.ok) return goals;
      if (!goals.value.some((goal) => goal.id === command.goalId)) {
        return { ok: false, error: `Goal not found: ${command.goalId}` };
      }
    }
    if (command.domainSlug) {
      const domains = await listDomains(rootPath);
      if (!domains.ok) return domains;
      const live = domains.value.some(
        (domain) => domain.slug === command.domainSlug && !domain.meta.archivedAt,
      );
      if (!live) {
        return { ok: false, error: `Domain not found or archived: ${command.domainSlug}` };
      }
    }
    return createDecision(rootPath, {
      // The target carries the project id so the Decisions surface and the
      // project's own page can collate the proposal onto it.
      target: { type: "project", id: command.id },
      proposedTitle: command.title,
      proposedBodyMarkdown: JSON.stringify(command),
      previousBodyMarkdown: null,
      domainSlugs: command.domainSlug ? [command.domainSlug] : [],
      actor,
    });
  }
  const project = await projectGet(rootPath, command.id);
  if (!project.ok) return project;
  return createDecision(rootPath, {
    target: { type: "project", id: command.id },
    proposedTitle: project.value.title,
    proposedBodyMarkdown: JSON.stringify(command),
    previousBodyMarkdown: JSON.stringify(project.value),
    domainSlugs: project.value.domainSlug ? [project.value.domainSlug] : [],
    actor,
  });
}

// ---------------------------------------------------------------------------
// One turn, many proposals
// ---------------------------------------------------------------------------

/**
 * A proposal's identity, for skipping a fence that describes a change already
 * pending. Two turns that both say "add a note called X with body Y" are the same
 * proposal and must be one card, or the operator approves the same write twice.
 *
 * The identity is the change the operator would approve, not the envelope around
 * it: a project's propose-time id is deliberately not part of it, because the
 * same project proposed twice is the same project even though each parse mints a
 * fresh id.
 */
function proposalIdentity(change: ImpliedChange): string {
  if (change.kind === "doctrine") {
    // The body is the change; a title is display. Two fences proposing the same
    // body for the same document are one card even if one names a title and the
    // other leaves it to the document's current one.
    return `doctrine|${change.domainSlug}|${change.documentKind}|${change.body}`;
  }
  if (change.kind === "library") {
    return `library|${change.id ?? "create"}|${change.title}|${(change.domainSlugs ?? []).join(",")}|${change.body}`;
  }
  // (A create's allocated id is not part of its identity: the same note proposed
  // twice is the same note, and the id is minted fresh each parse. `decisionIdentity`
  // reads that case back by asking whether the note exists yet.)
  if (change.kind === "goal") {
    return `goal|${JSON.stringify(change.command)}`;
  }
  if (change.kind === "day-template") {
    return `day-template|${JSON.stringify(change.command)}`;
  }
  const command = change.command;
  if (command.type === "closeProject") return `project-close|${command.id}`;
  if (command.type === "updateProject") {
    // A fenced update is not produced by this parser today, but the command union
    // can carry one; key it on the change the operator would approve.
    return `project-update|${command.id}|${JSON.stringify(command.patch)}`;
  }
  return `project-create|${command.title}|${command.goalId}|${command.domainSlug ?? ""}|${command.bodyMarkdown ?? ""}`;
}

/** The same identity, read back off a Decision already in the vault. */
async function decisionIdentity(
  rootPath: string,
  decision: DecisionRecord,
): Promise<string | null> {
  const { target } = decision;
  if (target.type === "doctrine") {
    return `doctrine|${target.domainSlug}|${target.kind}|${decision.proposedBodyMarkdown}`;
  }
  if (target.type === "library") {
    // A create's id was allocated at propose time and the note is only written on
    // approve, so "the note does not exist yet" is what tells the two apart.
    const note = await libraryGet(rootPath, target.id);
    const tag = note.ok ? target.id : "create";
    return `library|${tag}|${decision.proposedTitle ?? ""}|${decision.domainSlugs.join(",")}|${decision.proposedBodyMarkdown}`;
  }
  if (target.type === "goal") {
    return `goal|${decision.proposedBodyMarkdown}`;
  }
  if (target.type === "day-template") {
    return `day-template|${decision.proposedBodyMarkdown}`;
  }
  if (target.type === "project") {
    let command: ProjectCommand;
    try {
      command = JSON.parse(decision.proposedBodyMarkdown) as ProjectCommand;
    } catch {
      return null;
    }
    if (!command || typeof command !== "object") return null;
    if (command.type === "closeProject") return `project-close|${command.id}`;
    if (command.type !== "createProject") return null;
    return `project-create|${command.title}|${command.goalId}|${command.domainSlug ?? ""}|${command.bodyMarkdown ?? ""}`;
  }
  return null;
}

/** What one turn's filing actually did, so the caller can tell the operator. */
export type ImpliedFilingOutcome = {
  filed: DecisionRecord[];
  /** Proposals identical to one already pending — no second card for the same write. */
  skipped: number;
  errors: { change: ImpliedChange; error: string }[];
};

/**
 * File every proposal a turn made. One decision per proposal, nothing dropped:
 * a proposal that fails to file comes back in `errors` rather than disappearing,
 * because the caller says so in the chat and in the log.
 */
export async function fileImpliedChanges(
  rootPath: string,
  changes: readonly ImpliedChange[],
  actor: Actor = COMPANION_ACTOR,
): Promise<ImpliedFilingOutcome> {
  const filed: DecisionRecord[] = [];
  const errors: { change: ImpliedChange; error: string }[] = [];
  let skipped = 0;
  /** Identities of proposals already pending, read once for the whole turn. */
  let known: Set<string> | null = null;

  for (const change of changes) {
    if (known === null) {
      known = new Set<string>();
      const listed = await listDecisions(rootPath);
      if (listed.ok) {
        for (const decision of listed.value) {
          if (decision.status !== "pending") continue;
          const identity = await decisionIdentity(rootPath, decision);
          if (identity) known.add(identity);
        }
      }
    }
    const identity = proposalIdentity(change);
    if (known.has(identity)) {
      skipped += 1;
      continue;
    }
    const result = await fileImpliedChange(rootPath, change, actor);
    if (result.ok) {
      filed.push(result.value);
      known.add(identity);
    } else {
      errors.push({ change, error: result.error });
    }
  }
  return { filed, skipped, errors };
}
