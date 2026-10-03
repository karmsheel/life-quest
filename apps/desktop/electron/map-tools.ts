import {
  applyMapCommand,
  commandForGoalTool,
  commandForTool,
  createDecision,
  GOALS_TOOL_DEFS,
  listDomains,
  loadGoals,
  MAP_TOOL_DEFS,
  openVault,
  resolveWeek,
  DOCUMENT_TOOL_DEFS,
  executeDocumentTool,
  REVIEW_TOOL_DEFS,
  executeReviewTool,
  CAPTURE_TOOL_DEFS,
  executeCaptureTool,
  SCRIPT_TOOL_DEFS,
  executeScriptTool,
  PROJECT_TOOL_DEFS,
  ALL_TOOL_DEFS,
  DATABASE_TOOL_DEFS,
  executeDatabaseTool,
  commandForProjectTool,
  projectGet,
  listDecisions,
  libraryGet,
  connectedDecisionVisible,
  connectedGoalVisible,
  connectedReviewVisible,
  connectedLibraryVisible,
  projectConnectedPack,
  projectConnectedReview,
  projectConnectedState,
  reviewHeadingSlugs,
  toolAllowed,
  type ConnectedGrant,
  type PeriodPack,
  type ReviewIndexEntry,
  type ReviewRecord,
  type ReviewScopeState,
  type ProjectCommand,
  type GoalsCommand,
  type MapCommand,
  type MapToolDef,
  type Result,
  type Actor as VaultActor,
} from "@lifequest/vault-core";
import { hermesChatWithTools } from "./hermes-proxy.ts";

const AGENT_ACTOR = { type: "agent", id: "companion", name: "Hermes" } as const;

const SYSTEM = `You are the LifeQuest planner. Use tools to read and change the map and tasks. About me is lifestyle context, not a command surface. You may update Premise, Vision, Purpose, Strategy (How), and library notes with update_document / create_library_document. If a document is locked, your update becomes a pending Decision. You cannot lock or unlock documents. Goals are vault-wide outcomes in goals.json; Life Map events are single-date deadlines that may link to a Goal.`;

export async function runPlannerLoop(opts: {
  root: string;
  activeSlug: string | null;
  baseUrl: string;
  apiKey: string;
  extraSystem: string;
  messages: { role: string; content: string }[];
  /** KAR-9: who is acting. The companion when no hire is passed. */
  actor?: VaultActor;
}): Promise<Result<{ content: string }>> {
  const actor = opts.actor ?? AGENT_ACTOR;
  // The same composed constant the MCP server registers, so the planner's tool
  // list can never disagree with the server about what exists.
  const openaiTools = ALL_TOOL_DEFS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const history: unknown[] = [
    { role: "system", content: `${SYSTEM}\n${opts.extraSystem}` },
    ...opts.messages,
  ];
  for (let round = 0; round < 8; round++) {
    const step = await hermesChatWithTools(
      opts.baseUrl,
      opts.apiKey,
      history,
      openaiTools,
    );
    if (!step.ok) return step;
    if (step.value.type === "text") {
      return { ok: true, value: { content: step.value.content } };
    }
    const toolResult = await executeTool(
      opts.root,
      opts.activeSlug,
      step.value.name,
      step.value.args,
      actor,
    );
    history.push(step.value.raw);
    history.push({
      role: "tool",
      tool_call_id: step.value.id,
      content: JSON.stringify(toolResult),
    });
  }
  return { ok: true, value: { content: "Stopped after too many tool calls." } };
}

/**
 * KAR-70: the exact tool messages a grant refusal uses. Same shape as the HTTP
 * auth failures, so a client reads one refusal vocabulary.
 */
const GRANT_MESSAGES = {
  NO_GRANT: "No domain or schedule is assigned",
  FORBIDDEN: "Outside this agent's grant",
  NOT_FOUND: "Not found",
} as const;

function grantRefusal(code: keyof typeof GRANT_MESSAGES): unknown {
  return { error: { code, message: GRANT_MESSAGES[code] } };
}

export async function executeTool(
  root: string,
  activeSlug: string | null,
  name: string,
  args: unknown,
  /** KAR-9: the acting vault actor. Defaults to the companion. */
  actor: VaultActor = AGENT_ACTOR,
  /**
   * KAR-70: the connected agent's grant. Present only for a paired agent: it
   * decides what the call may read, and it names the actor. Absent for the
   * companion, which keeps the desktop lens.
   */
  grant?: ConnectedGrant,
): Promise<unknown> {
  const rec =
    args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (grant) {
    // The gate runs before anything else, so a refused call never reaches a tool
    // that could write or file a Decision.
    const verdict = toolAllowed(name, grant);
    if (verdict !== "allow") return grantRefusal(verdict);
    // A connected agent acts as itself. `activeSlug` is the operator's open
    // window, not a permission, and is ignored for every decision below.
    return executeConnectedTool(root, name, rec, {
      grant,
      actor: { type: "agent", id: grant.agentId, name: grant.name },
    });
  }
  const snap = await openVault(root);
  if (!snap.ok) return { error: { code: "NOT_FOUND", message: snap.error } };

  if (DOCUMENT_TOOL_DEFS.some((t) => t.name === name)) {
    return executeDocumentTool(root, actor, name, rec);
  }

  // get_review, list_reviews, write_review, mark_review_done, unlock_review, get_period_pack
  if (REVIEW_TOOL_DEFS.some((t) => t.name === name)) {
    return executeReviewTool(root, actor, name, rec);
  }

  // capture_transaction, undo_capture, correct_capture
  if (CAPTURE_TOOL_DEFS.some((t) => t.name === name)) {
    return executeCaptureTool(root, actor, name, rec);
  }

  // apply_script_block, run_script_block
  if (SCRIPT_TOOL_DEFS.some((t) => t.name === name)) {
    return executeScriptTool(root, actor, name, rec);
  }

  // list_databases, get_database, list_rows, get_row, and the Decision-gated
  // write tools (upsert_row, delete_row, create_database, add_column) plus the
  // read-only list_decisions. The actor is passed in from executeTool and is
  // never read from args.
  if (DATABASE_TOOL_DEFS.some((t) => t.name === name)) {
    return executeDatabaseTool(root, actor, name, rec);
  }

  if (name === "get_state") return { state: snap.value.map };
  if (name === "get_doctrine") {
    const requested = rec.domainSlug as string | undefined;
    const live = snap.value.domains.filter((d) => !d.meta.archivedAt);
    if (requested) {
      const domain = snap.value.domains.find((d) => d.slug === requested);
      if (!domain) return { error: { code: "NOT_FOUND", message: "Domain not found" } };
      return {
        slug: domain.slug,
        name: domain.meta.name,
        why: domain.documents.why,
        what: domain.documents.what,
        how: domain.documents.how,
        premise: domain.documents.premise,
      };
    }
    if (activeSlug) {
      const domain = live.find((d) => d.slug === activeSlug);
      if (!domain) return { error: { code: "NOT_FOUND", message: "Domain not found" } };
      return {
        slug: domain.slug,
        name: domain.meta.name,
        why: domain.documents.why,
        what: domain.documents.what,
        how: domain.documents.how,
        premise: domain.documents.premise,
      };
    }
    return {
      domains: live.map((domain) => ({
        slug: domain.slug,
        name: domain.meta.name,
        why: domain.documents.why,
        what: domain.documents.what,
        how: domain.documents.how,
        premise: domain.documents.premise,
      })),
    };
  }
  if (name === "get_week") {
    if (!snap.value.map) {
      return { error: { code: "NOT_FOUND", message: snap.value.mapError } };
    }
    return {
      week: resolveWeek(snap.value.map, rec.year as number, rec.monday as string),
    };
  }
  if (name === "list_goals") return { goals: snap.value.goals, goalsError: snap.value.goalsError };
  const projectCmd = commandForProjectTool(name, rec);
  if (projectCmd) {
    // KAR-7: agent project create and close wait for approval. File a pending
    // Decision; the markdown file is written only on approve.
    return proposeProjectDecision(root, projectCmd, actor);
  }
  const goalCmd = commandForGoalTool(name, rec);
  if (goalCmd) {
    // Agent goal writes wait for approval: file a pending Decision, do not touch goals.json.
    return proposeGoalDecision(root, goalCmd, actor);
  }
  const command = commandForTool(name, rec) as MapCommand | null;
  if (!command) return { error: { code: "MALFORMED", message: `Unknown tool ${name}` } };
  if (DAY_TEMPLATE_TOOLS.has(name)) {
    // Agent Architecture day-template writes wait for approval too.
    return proposeDayTemplateDecision(root, command, actor);
  }
  // Every other map tool (tasks, the live week, years, events, month cells) applies now.
  // KAR-9: the map actor stays the string, but the life-log line records the
  // named vault actor that ran it.
  const applied = await applyMapCommand(root, command, "agent", undefined, actor);
  if (!applied.ok) {
    const [code, ...rest] = applied.error.split(": ");
    return { error: { code, message: rest.join(": ") } };
  }
  return { state: applied.value };
}

/**
 * KAR-70: one call from a connected agent.
 *
 * Two shapes of rule, applied in this order:
 *
 *  - A single-record read whose `domainSlug` argument is outside the grant
 *    answers NOT_FOUND without the tool running. This is what makes an
 *    unassigned domain indistinguishable from one that does not exist.
 *  - A list tool runs and then has rows outside the grant dropped, because a
 *    list is defined by its scope rather than by one record.
 *
 * `activeSlug` is deliberately absent: the desktop lens is the operator's open
 * window, and a connected agent's window is its own grant. Passing it here
 * would let whatever domain the operator happens to be looking at decide what a
 * remote agent can read.
 */
async function executeConnectedTool(
  root: string,
  name: string,
  rec: Record<string, unknown>,
  ctx: { grant: ConnectedGrant; actor: VaultActor },
): Promise<unknown> {
  const { grant, actor } = ctx;
  const granted = (slug: unknown): boolean =>
    typeof slug === "string" && grant.domainSlugs.includes(slug);

  // ── single-record reads: refuse before the tool runs ──────────────────────
  if (name === "get_doctrine") {
    const requested = rec.domainSlug;
    if (requested !== undefined && requested !== null && !granted(requested)) {
      return grantRefusal("NOT_FOUND");
    }
    const snap = await openVault(root);
    if (!snap.ok) return { error: { code: "NOT_FOUND", message: snap.error } };
    const live = snap.value.domains.filter((d) => !d.meta.archivedAt);
    const pick = (d: (typeof live)[number]) => ({
      slug: d.slug,
      name: d.meta.name,
      why: d.documents.why,
      what: d.documents.what,
      how: d.documents.how,
      premise: d.documents.premise,
    });
    if (requested !== undefined && requested !== null) {
      const domain = live.find((d) => d.slug === requested);
      if (!domain) return grantRefusal("NOT_FOUND");
      return pick(domain);
    }
    // No domain named: the granted domains are the whole answer.
    return { domains: live.filter((d) => granted(d.slug)).map(pick) };
  }

  if (
    name === "get_database" ||
    name === "list_rows" ||
    name === "get_row" ||
    name === "run_script_block"
  ) {
    if (!granted(rec.domainSlug)) return grantRefusal("NOT_FOUND");
  }

  // A list scoped to one domain is still a read of that domain: an ungranted
  // domain answers as missing rather than as a successful empty list, which
  // would confirm the domain exists.
  if (name === "list_databases" && rec.domainSlug !== undefined && rec.domainSlug !== null) {
    if (!granted(rec.domainSlug)) return grantRefusal("NOT_FOUND");
  }

  if (name === "get_document") {
    const id = rec.id;
    if (typeof id === "string" && id.length > 0) {
      const lib = await libraryGet(root, id);
      // A miss and an ungranted note are the same answer. Passing the engine's
      // "Document not found" through would tell the agent which of the two it
      // hit, and that difference is the whole point of the shape.
      if (!lib.ok) return grantRefusal("NOT_FOUND");
      if (!connectedLibraryVisible(lib.value.domainSlugs, grant)) {
        return grantRefusal("NOT_FOUND");
      }
    } else if (rec.domainSlug !== undefined && rec.domainSlug !== null) {
      if (!granted(rec.domainSlug)) return grantRefusal("NOT_FOUND");
    }
  }

  if (name === "get_review" || name === "list_reviews") {
    const result = await executeReviewTool(root, actor, name, rec);
    if (isGrantError(result)) return result;
    const headings = await reviewHeadingMap(root);
    if (name === "get_review") {
      const review = (result as { review: ReviewRecord }).review;
      if (!connectedReviewVisible(review.scopes, grant)) return grantRefusal("NOT_FOUND");
      return { review: projectConnectedReview(review, grant, headings) };
    }
    const { reviews } = result as { reviews: ReviewIndexEntry[] };
    return {
      // An entry with no granted scope is dropped rather than returned empty:
      // an entry is the fact that a period was reviewed at all.
      reviews: reviews
        .filter((entry) => connectedReviewVisible(entry.scopes, grant))
        .map((entry) => ({ ...entry, scopes: pickGrantedScopes(entry.scopes, grant) })),
    };
  }

  // A period pack is the domain slice or nothing. `overall` spans every domain
  // and so has no slice a connected agent could be given.
  if (name === "get_period_pack") {
    const scope = typeof rec.scope === "string" ? rec.scope : "overall";
    if (!granted(scope)) return grantRefusal("FORBIDDEN");
    const result = await executeReviewTool(root, actor, name, rec);
    if (!isGrantError(result)) {
      const pack = (result as { pack: PeriodPack }).pack;
      return { pack: projectConnectedPack(pack, grant) };
    }
    return result;
  }

  // ── list reads: run, then drop what the grant does not cover ─────────────
  if (name === "list_databases") {
    const result = await executeDatabaseTool(root, actor, name, rec);
    if (isGrantError(result)) return result;
    const { kits, databases } = result as {
      kits: Array<{ domainSlug: string }>;
      databases: Array<{ domainSlug: string }>;
    };
    return {
      kits: kits.filter((k) => granted(k.domainSlug)),
      databases: databases.filter((d) => granted(d.domainSlug)),
    };
  }

  if (name === "list_documents") {
    const result = await executeDocumentTool(root, actor, name, rec);
    if (isGrantError(result)) return result;
    const { records } = result as {
      records: Array<Record<string, unknown>>;
    };
    return {
      records: records.filter((record) =>
        record.type === "doctrine"
          ? granted(record.domainSlug)
          : connectedLibraryVisible((record.domainSlugs as string[]) ?? [], grant),
      ),
    };
  }

  if (name === "list_goals") {
    const snap = await openVault(root);
    if (!snap.ok) return { error: { code: "NOT_FOUND", message: snap.error } };
    return {
      goals: snap.value.goals.filter((g) => connectedGoalVisible(g, grant)),
      goalsError: snap.value.goalsError,
    };
  }

  if (name === "get_state") {
    const snap = await openVault(root);
    if (!snap.ok) return { error: { code: "NOT_FOUND", message: snap.error } };
    if (!snap.value.map) {
      return { error: { code: "NOT_FOUND", message: snap.value.mapError } };
    }
    return { state: projectConnectedState(snap.value.map, grant) };
  }

  if (name === "list_decisions") {
    // listDecisions is read here rather than through executeDatabaseTool because
    // the tool's own result carries no domainSlugs, and a Decision is filtered by
    // its domain list.
    const listed = await listDecisions(root);
    if (!listed.ok) return { error: { code: "FAILED", message: listed.error } };
    let items = listed.value.filter((d) => connectedDecisionVisible(d, grant));
    if (typeof rec.status === "string") {
      items = items.filter((d) => d.status === rec.status);
    }
    const limit = typeof rec.limit === "number" && rec.limit >= 1 && rec.limit <= 100 ? rec.limit : 20;
    const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      decisions: ordered.slice(0, limit).map((d) => ({
        id: d.id,
        status: d.status,
        proposedTitle: d.proposedTitle,
        createdAt: d.createdAt,
        reason: d.reason,
      })),
    };
  }

  // Everything the grant allows but this task does not project: the database and
  // document tools whose records are already inside the grant.
  if (DATABASE_TOOL_DEFS.some((t) => t.name === name)) {
    return executeDatabaseTool(root, actor, name, rec);
  }
  if (DOCUMENT_TOOL_DEFS.some((t) => t.name === name)) {
    return executeDocumentTool(root, actor, name, rec);
  }
  if (REVIEW_TOOL_DEFS.some((t) => t.name === name)) {
    return executeReviewTool(root, actor, name, rec);
  }
  if (SCRIPT_TOOL_DEFS.some((t) => t.name === name)) {
    return executeScriptTool(root, actor, name, rec);
  }
  return { error: { code: "MALFORMED", message: `Unknown tool ${name}` } };
}

/** The review body headings are domain names, so the name to slug map is needed. */
async function reviewHeadingMap(root: string): Promise<Map<string, string>> {
  const listed = await listDomains(root);
  return reviewHeadingSlugs(listed.ok ? listed.value : []);
}

/** Keep only the scope keys the grant covers, with their states. */
function pickGrantedScopes(
  scopes: Record<string, ReviewScopeState>,
  grant: ConnectedGrant,
): Record<string, ReviewScopeState> {
  const out: Record<string, ReviewScopeState> = {};
  for (const [slug, state] of Object.entries(scopes)) {
    if (grant.domainSlugs.includes(slug)) out[slug] = state;
  }
  return out;
}

/** True for the `{ error: { code } }` shape every tool refusal shares. */
function isGrantError(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const err = (value as { error?: unknown }).error;
  return err !== null && typeof err === "object";
}

/** Agent map tools that write the Architecture day templates and therefore need approval. */
const DAY_TEMPLATE_TOOLS = new Set<string>([
  "create_day_type",
  "update_day_type",
  "delete_day_type",
  "set_default_weekday_type",
  "set_default_weekly_items",
]);

async function proposeGoalDecision(
  root: string,
  command: GoalsCommand,
  actor: VaultActor,
): Promise<unknown> {
  const loaded = await loadGoals(root);
  if (!loaded.ok) return { error: { message: loaded.error } };
  const goalId = "id" in command ? command.id : null;
  const existing = goalId ? loaded.value.find((g) => g.id === goalId) : undefined;
  const proposedTitle =
    "name" in command && typeof command.name === "string" && command.name.trim()
      ? command.name
      : (existing?.name ?? "Goal");
  const domainSlug = "domainSlug" in command ? command.domainSlug : undefined;
  const created = await createDecision(root, {
    target: { type: "goal" },
    proposedTitle,
    proposedBodyMarkdown: JSON.stringify(command),
    previousBodyMarkdown: existing ? JSON.stringify(existing) : null,
    domainSlugs: typeof domainSlug === "string" && domainSlug ? [domainSlug] : [],
    actor,
  });
  if (!created.ok) return { error: { message: created.error } };
  return { decisionId: created.value.id, status: created.value.status };
}

async function proposeProjectDecision(
  root: string,
  command: ProjectCommand,
  actor: VaultActor,
): Promise<unknown> {
  let proposedTitle: string;
  let previousBodyMarkdown: string | null = null;
  const domainSlugs: string[] = [];

  if (command.type === "createProject") {
    // A create that names an already-invalid goal or domain is an error, not a Decision.
    const goals = await loadGoals(root);
    if (!goals.ok) return { error: { message: goals.error } };
    if (!goals.value.some((g) => g.id === command.goalId)) {
      return { error: { message: `Goal not found: ${command.goalId}` } };
    }
    if (command.domainSlug) {
      const domains = await listDomains(root);
      if (!domains.ok) return { error: { message: domains.error } };
      const live = domains.value.some(
        (d) => d.slug === command.domainSlug && !d.meta.archivedAt,
      );
      if (!live) {
        return {
          error: {
            message: `Domain not found or archived: ${command.domainSlug}`,
          },
        };
      }
      domainSlugs.push(command.domainSlug);
    }
    proposedTitle = command.title;
  } else {
    // A close needs the project to exist; file nothing if it does not.
    const loaded = await projectGet(root, command.id);
    if (!loaded.ok) return { error: { message: loaded.error } };
    proposedTitle = loaded.value.title;
    previousBodyMarkdown = JSON.stringify(loaded.value);
    if (loaded.value.domainSlug) domainSlugs.push(loaded.value.domainSlug);
  }

  const created = await createDecision(root, {
    target: { type: "project" },
    proposedTitle,
    proposedBodyMarkdown: JSON.stringify(command),
    previousBodyMarkdown,
    domainSlugs,
    actor,
  });
  if (!created.ok) return { error: { message: created.error } };
  return { decisionId: created.value.id, status: created.value.status };
}

async function proposeDayTemplateDecision(
  root: string,
  command: MapCommand,
  actor: VaultActor,
): Promise<unknown> {
  const name = "name" in command && typeof command.name === "string" ? command.name : "";
  const created = await createDecision(root, {
    target: { type: "day-template" },
    proposedTitle: name && name.trim() ? name : "Day template",
    proposedBodyMarkdown: JSON.stringify(command),
    actor,
  });
  if (!created.ok) return { error: { message: created.error } };
  return { decisionId: created.value.id, status: created.value.status };
}
