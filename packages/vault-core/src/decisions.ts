import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { getDocument } from "./domain-documents.ts";
import { libraryGet } from "./library-documents.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  USER_ACTOR,
  type Actor,
  type DatabaseColumnType,
  type DatabaseDecisionBody,
  type DecisionRecord,
  type DocumentKind,
  type DocumentTarget,
  type GoalsCommand,
  type Result,
} from "./types.ts";
import type { Command as MapCommand } from "./map/types.ts";
import { getDatabase, isDomainLive, readRegistry } from "./domain-databases.ts";
import { checkDatabaseCells } from "./domain-databases.ts";
import { documentTargetLabel } from "./documents.ts";
import { getReview, applyLockedReviewBody } from "./reviews.ts";
import { isReviewCadence } from "./period.ts";

function isDocumentKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

function isLibraryTarget(t: DocumentTarget): t is Extract<DocumentTarget, { type: "library" }> {
  return t.type === "library";
}

function isDoctrineTarget(t: DocumentTarget): t is Extract<DocumentTarget, { type: "doctrine" }> {
  return t.type === "doctrine";
}

// Normalize raw decision JSON (legacy or new) into DecisionRecord.
export function normalizeDecision(raw: Record<string, unknown>): DecisionRecord {
  const id = typeof raw.id === "string" ? raw.id : randomUUID();
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();

  // Target: prefer explicit target, fall back to legacy documentKind + domainSlug.
  let target: DocumentTarget;
  const explicitTarget = raw.target;
  if (
    explicitTarget &&
    typeof explicitTarget === "object" &&
    "type" in explicitTarget &&
    (isDoctrineExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isLibraryExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isReviewExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isPageExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isPinsExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isMappingExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isKitInstallExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isAssumptionSetExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isGoalExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isDayTemplateExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isProjectExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isDatabaseRowExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isDatabaseExplicitTarget(explicitTarget as Record<string, unknown>) ||
      isAgentPairingExplicitTarget(explicitTarget as Record<string, unknown>))
  ) {
    const t = explicitTarget as Record<string, unknown>;
    if (t.type === "review") {
      target = { type: "review", cadence: String(t.cadence), period: String(t.period) };
    } else if (t.type === "doctrine") {
      target = {
        type: "doctrine",
        domainSlug: String(t.domainSlug),
        kind: String(t.kind) as DocumentKind,
      };
    } else if (t.type === "page") {
      target = {
        type: "page",
        domainSlug: String(t.domainSlug),
        pageId: String(t.pageId),
      };
    } else if (t.type === "pins") {
      target = { type: "pins", domainSlug: t.domainSlug === null ? null : String(t.domainSlug) };
    } else if (t.type === "mapping") {
      target = {
        type: "mapping",
        domainSlug: String(t.domainSlug),
        mappingId: String(t.mappingId),
      };
    } else if (t.type === "kit-install") {
      target = { type: "kit-install", kit: "finance" as const };
    } else if (t.type === "assumption-set") {
      target = {
        type: "assumption-set",
        rowId: String(t.rowId),
      };
    } else if (t.type === "goal") {
      target = { type: "goal" };
    } else if (t.type === "project") {
      target = { type: "project" };
    } else if (t.type === "day-template") {
      target = { type: "day-template" };
    } else if (t.type === "database-row") {
      // Without this branch a persisted database-row target falls through to the
      // legacy library path and rehydrates as { type: "library", id: "undefined" }.
      target = {
        type: "database-row",
        domainSlug: String(t.domainSlug),
        databaseId: String(t.databaseId),
        rowId: t.rowId === null ? null : String(t.rowId),
      };
    } else if (t.type === "database") {
      target = {
        type: "database",
        domainSlug: String(t.domainSlug),
        databaseId: String(t.databaseId),
      };
    } else if (t.type === "library") {
      // The library branch used to be the fallthrough. KAR-70 replaces that
      // fallthrough with a throw, so library now needs a branch of its own.
      target = { type: "library", id: String(t.id) };
    } else if (t.type === "agent-pairing") {
      target = { type: "agent-pairing", agentId: String(t.agentId) };
    } else {
      // KAR-70: an explicit target that got past the guard but has no branch
      // here is a target type this build does not know. Mapping it to a library
      // note would file it against a document the operator never named.
      throw new Error(`Unknown decision target type: ${String(t.type)}`);
    }
  } else if (
    typeof raw.documentKind === "string" &&
    isDocumentKind(raw.documentKind) &&
    typeof raw.domainSlug === "string"
  ) {
    target = { type: "doctrine", domainSlug: raw.domainSlug, kind: raw.documentKind as DocumentKind };
  } else {
    // Should not happen in practice; fallback to a safe doctrine target.
    target = { type: "doctrine", domainSlug: "", kind: "why" };
  }

  // domainSlugs: array of strings if present, else doctrine/page/pins [domainSlug], else [].
  let domainSlugs: string[];
  if (Array.isArray(raw.domainSlugs) && raw.domainSlugs.every((s) => typeof s === "string")) {
    domainSlugs = raw.domainSlugs as string[];
  } else if (target.type === "doctrine") {
    domainSlugs = [target.domainSlug];
  } else if (target.type === "page") {
    domainSlugs = [target.domainSlug];
  } else if (target.type === "pins") {
    domainSlugs = target.domainSlug ? [target.domainSlug] : [];
  } else if (target.type === "mapping") {
    domainSlugs = [target.domainSlug];
  } else if (target.type === "database-row" || target.type === "database") {
    domainSlugs = [target.domainSlug];
  } else {
    domainSlugs = [];
  }

  // actor: default to user when missing.
  const actor: Actor =
    typeof raw.actor === "object" && raw.actor !== null && "type" in raw.actor
      ? (raw.actor as Actor)
      : USER_ACTOR;

  const status: DecisionRecord["status"] =
    raw.status === "approved" || raw.status === "rejected" ? raw.status : "pending";

  const proposedTitle =
    typeof raw.proposedTitle === "string" ? raw.proposedTitle : null;
  const previousTitle =
    typeof raw.previousTitle === "string" ? raw.previousTitle : null;
  const rationale =
    typeof raw.rationale === "string" ? raw.rationale : null;
  const proposedBodyMarkdown =
    typeof raw.proposedBodyMarkdown === "string" ? raw.proposedBodyMarkdown : "";
  const previousBodyMarkdown =
    typeof raw.previousBodyMarkdown === "string" ? raw.previousBodyMarkdown : null;
  const resolvedAt =
    typeof raw.resolvedAt === "string" ? raw.resolvedAt : null;
  // KAR-64: reason must be in the rebuilt field set, not just on write, or it is
  // dropped on every subsequent read.
  const reason = typeof raw.reason === "string" ? raw.reason : null;

  // For legacy records missing proposedTitle, keep the file title as the decision title.
  const title =
    typeof raw.title === "string" ? raw.title : `Proposed change to ${documentTargetLabel(target, "")}`;

  return {
    id,
    target,
    domainSlugs,
    status,
    title,
    rationale,
    proposedTitle,
    previousTitle,
    proposedBodyMarkdown,
    previousBodyMarkdown,
    actor,
    createdAt,
    resolvedAt,
    reason,
  };
}

function isDoctrineExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "doctrine" &&
    typeof raw.domainSlug === "string" &&
    typeof raw.kind === "string" &&
    isDocumentKind(raw.kind)
  );
}

function isLibraryExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "library" && typeof raw.id === "string" && raw.id.length > 0;
}

function isReviewExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "review" &&
    typeof raw.cadence === "string" &&
    isReviewCadence(raw.cadence) &&
    typeof raw.period === "string" &&
    raw.period.length > 0
  );
}

function isPageExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "page" &&
    typeof raw.domainSlug === "string" &&
    typeof raw.pageId === "string" &&
    raw.pageId.length > 0
  );
}

function isPinsExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "pins" &&
    (raw.domainSlug === null || typeof raw.domainSlug === "string")
  );
}

function isMappingExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "mapping" &&
    typeof raw.domainSlug === "string" &&
    raw.domainSlug.length > 0 &&
    typeof raw.mappingId === "string" &&
    raw.mappingId.length > 0
  );
}

function isKitInstallExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "kit-install" && raw.kit === "finance";
}

function isAssumptionSetExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "assumption-set" && typeof raw.rowId === "string" && raw.rowId.length > 0;
}

function isGoalExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "goal";
}

function isDayTemplateExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "day-template";
}

function isProjectExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "project";
}

function isDatabaseRowExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "database-row" &&
    typeof raw.domainSlug === "string" &&
    raw.domainSlug.length > 0 &&
    typeof raw.databaseId === "string" &&
    raw.databaseId.length > 0 &&
    (raw.rowId === null || (typeof raw.rowId === "string" && raw.rowId.length > 0))
  );
}

function isAgentPairingExplicitTarget(raw: Record<string, unknown>): boolean {
  return raw.type === "agent-pairing" && typeof raw.agentId === "string" && raw.agentId.length > 0;
}

function isDatabaseExplicitTarget(raw: Record<string, unknown>): boolean {
  return (
    raw.type === "database" &&
    typeof raw.domainSlug === "string" &&
    raw.domainSlug.length > 0 &&
    typeof raw.databaseId === "string" &&
    raw.databaseId.length > 0
  );
}

async function readDecisionFile(filePath: string): Promise<DecisionRecord> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return normalizeDecision(parsed);
}

async function writeDecisionFile(filePath: string, decision: DecisionRecord): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(decision, null, 2)}\n`);
}

export async function listDecisions(rootPath: string): Promise<Result<DecisionRecord[]>> {
  try {
    const paths = vaultPaths(rootPath);
    const decisions: DecisionRecord[] = [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.decisionsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: [] };
      }
      throw e;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(/\.json$/, "");
      const decision = await readDecisionFile(paths.decisionJson(id));
      decisions.push(decision);
    }
    decisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, value: decisions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createDecision(
  rootPath: string,
  input: {
    target: DocumentTarget;
    rationale?: string | null;
    proposedTitle?: string | null;
    previousTitle?: string | null;
    proposedBodyMarkdown: string;
    previousBodyMarkdown?: string | null;
    /**
     * Domain slugs for a target that does not carry them itself. Only used for an
     * agent library target whose file does not exist yet, and for a goal target.
     */
    domainSlugs?: string[];
    actor: Actor;
  },
): Promise<Result<DecisionRecord>> {
  try {
    // Validate target shape.
    if (input.target.type === "doctrine") {
      if (!isDocumentKind(input.target.kind)) {
        return { ok: false, error: `Invalid document kind: ${input.target.kind}` };
      }
      if (!input.target.domainSlug.trim()) {
        return { ok: false, error: "domainSlug is required" };
      }
    } else if (input.target.type === "library") {
      if (!input.target.id.trim()) {
        return { ok: false, error: "library id is required" };
      }
    } else if (input.target.type === "review") {
      if (!isReviewCadence(input.target.cadence)) {
        return { ok: false, error: `Invalid review cadence: ${input.target.cadence}` };
      }
      if (!input.target.period.trim()) {
        return { ok: false, error: "period is required" };
      }
    } else if (input.target.type === "page") {
      if (!input.target.domainSlug.trim()) {
        return { ok: false, error: "domainSlug is required" };
      }
      if (!input.target.pageId.trim()) {
        return { ok: false, error: "pageId is required" };
      }
    } else if (input.target.type === "pins") {
      // domainSlug null = overview, or a string. Both valid.
    } else if (input.target.type === "mapping") {
      if (!input.target.domainSlug.trim() || !input.target.mappingId.trim()) {
        return { ok: false, error: "domainSlug and mappingId are required" };
      }
    } else if (input.target.type === "kit-install") {
      if (input.target.kit !== "finance") {
        return { ok: false, error: `Invalid kit: ${String(input.target.kit)}` };
      }
    } else if (input.target.type === "assumption-set") {
      if (!input.target.rowId.trim()) {
        return { ok: false, error: "rowId is required" };
      }
    } else if (input.target.type === "database-row") {
      // rowId null is a create; an empty-string rowId is a malformed target.
      if (!input.target.domainSlug.trim() || !input.target.databaseId.trim()) {
        return { ok: false, error: "domainSlug and databaseId are required" };
      }
      if (input.target.rowId !== null && !input.target.rowId.trim()) {
        return { ok: false, error: "rowId is required" };
      }
    } else if (input.target.type === "database") {
      if (!input.target.domainSlug.trim() || !input.target.databaseId.trim()) {
        return { ok: false, error: "domainSlug and databaseId are required" };
      }
    } else if (input.target.type === "agent-pairing") {
      if (!input.target.agentId.trim()) {
        return { ok: false, error: "agentId is required" };
      }
    } else if (
      input.target.type === "goal" ||
      input.target.type === "day-template" ||
      input.target.type === "project"
    ) {
      // Goals, day templates, and projects are not lockable documents.
      // No shape to validate beyond the type.
    } else {
      return { ok: false, error: "Invalid target type" };
    }

    // proposedTitle, when provided, must be a non-empty string.
    if (input.proposedTitle !== undefined && input.proposedTitle !== null) {
      if (typeof input.proposedTitle !== "string" || !input.proposedTitle.trim()) {
        return { ok: false, error: "proposedTitle must be a non-empty string" };
      }
    }

    // proposedBodyMarkdown must be a string.
    if (typeof input.proposedBodyMarkdown !== "string") {
      return { ok: false, error: "proposedBodyMarkdown is required" };
    }

    // Load the target and confirm it is locked (pages/pins/goals/day templates are NOT lockable).
    // An agent actor skips the lock check for doctrine and library: the whole point of an
    // agent write is to propose a change to a document the operator has not locked yet.
    const isAgent = input.actor.type === "agent";
    let docLocked: boolean;
    let domainSlugForLog: string | null = null;
    let libraryNote: { value: { domainSlugs: string[] } } | null = null;
    if (input.target.type === "doctrine") {
      const docRes = await getDocument(rootPath, input.target.domainSlug, input.target.kind);
      if (!docRes.ok) return docRes;
      docLocked = docRes.value.locked;
      domainSlugForLog = docRes.value.locked || isAgent ? input.target.domainSlug : null;
      if (!docLocked && !isAgent) {
        return {
          ok: false,
          error: "Document must be locked before proposing a change",
        };
      }
    } else if (
      input.target.type === "goal" ||
      input.target.type === "day-template" ||
      input.target.type === "project"
    ) {
      // Neither goals, day templates, nor projects are lockable or pre-existing files.
      // A project create is allowed to name a file that does not exist yet: approve creates it.
      docLocked = false;
      domainSlugForLog = null;
    } else if (input.target.type === "agent-pairing") {
      // A roster row is not a document: nothing to lock, no domain for the log.
      docLocked = false;
      domainSlugForLog = null;
    } else if (input.target.type === "review") {
      const reviewRes = await getReview(rootPath, input.target.cadence, input.target.period);
      if (!reviewRes.ok) return reviewRes;
      docLocked = reviewRes.value.locked;
      if (!docLocked) {
        return {
          ok: false,
          error: "Review must be locked before proposing a change",
        };
      }
    } else if (input.target.type === "page") {
      // Pages are not lockable. Verify the page exists.
      const { getPage } = await import("./pages.ts");
      const pageRes = await getPage(rootPath, input.target.domainSlug, input.target.pageId);
      if (!pageRes.ok) return pageRes;
      docLocked = false;
      domainSlugForLog = input.target.domainSlug;
    } else if (input.target.type === "pins") {
      // Pins are not lockable. Target is always valid for live domain / overview.
      docLocked = false;
      domainSlugForLog = input.target.domainSlug;
    } else if (input.target.type === "mapping") {
      // Mappings are not lockable. Domain must be live; database in proposed JSON must exist.
      const live = await isDomainLive(rootPath, input.target.domainSlug);
      if (!live) {
        return { ok: false, error: `Domain not found or archived: ${input.target.domainSlug}` };
      }
      // Validate database exists in proposed JSON
      try {
        const proposed = JSON.parse(input.proposedBodyMarkdown);
        if (!proposed || typeof proposed !== "object" || !proposed.databaseId) {
          return { ok: false, error: "Mapping proposedBody must be JSON with databaseId" };
        }
        const dbRes = await getDatabase(rootPath, input.target.domainSlug, proposed.databaseId);
        if (!dbRes.ok) return dbRes;
      } catch {
        return { ok: false, error: "Mapping proposedBody must be valid JSON" };
      }
      docLocked = false;
      domainSlugForLog = input.target.domainSlug;
    } else if (input.target.type === "kit-install") {
      // Kit install is not lockable. Financial domain must be live.
      const live = await isDomainLive(rootPath, "financial");
      if (!live) {
        return { ok: false, error: "Domain not found or archived: financial" };
      }
      docLocked = false;
      domainSlugForLog = "financial";
    } else if (input.target.type === "assumption-set") {
      // Assumption sets are not lockable. Financial domain must be live and kit installed.
      const live = await isDomainLive(rootPath, "financial");
      if (!live) {
        return { ok: false, error: "Domain not found or archived: financial" };
      }
      const registry = await readRegistry(vaultPaths(rootPath).domainRegistry("financial"));
      if (!registry.installedKits.includes("finance")) {
        return { ok: false, error: "Install the Finance kit first" };
      }
      docLocked = false;
      domainSlugForLog = "financial";
    } else if (input.target.type === "database-row" || input.target.type === "database") {
      // Databases are not lockable documents. For a row write the database must
      // already exist; for a `database` target it must NOT (a create_database
      // mints its id at propose time and the database appears only on approve).
      const live = await isDomainLive(rootPath, input.target.domainSlug);
      if (!live) {
        return { ok: false, error: `Domain not found or archived: ${input.target.domainSlug}` };
      }
      if (input.target.type === "database-row") {
        const dbRes = await getDatabase(
          rootPath,
          input.target.domainSlug,
          input.target.databaseId,
        );
        if (!dbRes.ok) return dbRes;
      }
      docLocked = false;
      domainSlugForLog = input.target.domainSlug;
    } else {
      const noteRes = await libraryGet(rootPath, input.target.id);
      if (!noteRes.ok) {
        // An agent may propose a note that does not exist yet; approve creates it.
        // A user proposing a missing note is still an error.
        if (!isAgent) return noteRes;
        docLocked = false;
        domainSlugForLog = input.domainSlugs?.[0] ?? null;
      } else {
        docLocked = noteRes.value.locked;
        domainSlugForLog = noteRes.value.locked ? (noteRes.value.domainSlugs[0] ?? null) : null;
        libraryNote = noteRes;
        if (!docLocked && !isAgent) {
          return {
            ok: false,
            error: "Document must be locked before proposing a change",
          };
        }
      }
    }

    const domainSlugs: string[] =
      input.target.type === "doctrine"
        ? [input.target.domainSlug]
        : input.target.type === "page"
          ? [input.target.domainSlug]
          : input.target.type === "pins"
            ? input.target.domainSlug
              ? [input.target.domainSlug]
              : []
            : input.target.type === "mapping"
              ? [input.target.domainSlug]
              : input.target.type === "kit-install"
                ? ["financial"]
                : input.target.type === "assumption-set"
                  ? ["financial"]
                  : input.target.type === "database-row" || input.target.type === "database"
                    ? [input.target.domainSlug]
                  : input.target.type === "review"
                    ? []
                    : input.target.type === "goal"
                      ? input.domainSlugs ?? []
                      : input.target.type === "day-template"
                        ? []
                        : input.target.type === "project"
                          ? (input.domainSlugs ?? [])
                          : libraryNote
                            ? libraryNote.value.domainSlugs
                            : (input.domainSlugs ?? []);

    // KAR-70: the pairing Decision title is already a sentence. Wrapping it in
    // "Proposed change to" would make the inbox read "Proposed change to
    // Finance bot".
    const title =
      input.target.type === "agent-pairing" && input.proposedTitle
        ? input.proposedTitle
        : `Proposed change to ${documentTargetLabel(input.target, input.proposedTitle ?? "")}`;

    const paths = vaultPaths(rootPath);
    const id = randomUUID();
    const now = new Date().toISOString();
    const decision: DecisionRecord = {
      id,
      target: input.target,
      domainSlugs,
      status: "pending",
      title,
      rationale: input.rationale ?? null,
      proposedTitle: input.proposedTitle ?? null,
      previousTitle: input.previousTitle ?? null,
      proposedBodyMarkdown: input.proposedBodyMarkdown,
      previousBodyMarkdown: input.previousBodyMarkdown ?? null,
      actor: input.actor,
      createdAt: now,
      resolvedAt: null,
      reason: null,
    };

    await fs.mkdir(paths.decisionsDir, { recursive: true });
    await writeDecisionFile(paths.decisionJson(id), decision);

    const logRes = await appendLog(paths.root, {
      domainSlug: domainSlugForLog,
      type: "decision.created",
      summary: `Created decision: ${title}`,
      payload: { id, targetType: input.target.type, title },
      actor: input.actor,
    });
    if (!logRes.ok) return logRes;

    return { ok: true, value: decision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Apply an approved decision's body/title directly to the target file,
// without going through saveDocument / libraryUpdate (which reject locked).
/**
 * KAR-64: the validateCells failures that no retry can fix. Anything else from
 * upsertRow (I/O, SQLite, a full disk) is transient and stays retryable.
 */
function isTerminalCellError(error: string): boolean {
  return /Unknown column id in cells:| expects |value not in options|relation target missing|invalid file path/.test(
    error,
  );
}

/**
 * KAR-64: the outcome of applying an approved Decision. `Result<T>` has no room
 * for a terminal flag, so failures carry one here. The success arm is declared
 * with `value?: undefined` so the existing `{ ok: true, value: undefined }`
 * literals below stay assignable without editing each of them.
 *
 * `terminal: true` means re-approving can never succeed, so resolveDecision
 * records the failure as a rejection instead of stranding the record pending.
 */
type ApplyOutcome =
  | { ok: true; value?: undefined }
  | { ok: false; error: string; terminal: boolean };

async function applyApprovedBody(
  rootPath: string,
  decision: DecisionRecord,
): Promise<ApplyOutcome> {
  try {
    if (decision.target.type === "agent-pairing") {
      // Approval only flips the row to active. It must not touch access,
      // domainSlugs, or schedule: those are operator grants, set in Personnel.
      const { markConnectedAgent } = await import("./connected-agents.ts");
      const res = await markConnectedAgent(rootPath, decision.target.agentId, "active");
      if (!res.ok) {
        // The row is gone, so no retry can ever resolve this Decision.
        return { ok: false, error: "Agent not found", terminal: true };
      }
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "review") {
      const res = await applyLockedReviewBody(
        rootPath,
        decision.target.cadence,
        decision.target.period,
        decision.proposedBodyMarkdown,
      );
      if (!res.ok) return { ok: false, error: res.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "page") {
      const { getPage, updatePage } = await import("./pages.ts");
      const { USER_ACTOR } = await import("./types.ts");
      const pageRes = await getPage(rootPath, decision.target.domainSlug, decision.target.pageId);
      if (!pageRes.ok) return { ok: false, error: pageRes.error, terminal: false };
      const existing = pageRes.value;
      const now = new Date().toISOString();
      const nextTitle = decision.proposedTitle !== null ? decision.proposedTitle : existing.title;
      // Parse proposedBodyMarkdown as JSON { title, blocks }
      let blocks = existing.blocks;
      try {
        const parsed = JSON.parse(decision.proposedBodyMarkdown);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.blocks)) {
          blocks = parsed.blocks;
        }
      } catch {
        // If not valid JSON, keep existing blocks
      }
      const updateRes = await updatePage(
        rootPath,
        decision.target.domainSlug,
        decision.target.pageId,
        { title: nextTitle, blocks },
        USER_ACTOR,
      );
      if (!updateRes.ok) return { ok: false, error: updateRes.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "pins") {
      const { setPins, defaultPins } = await import("./pins.ts");
      const { USER_ACTOR } = await import("./types.ts");
      // Parse proposedBodyMarkdown as JSON { pins }
      let pins = defaultPins();
      try {
        const parsed = JSON.parse(decision.proposedBodyMarkdown);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.pins)) {
          pins = parsed.pins;
        }
      } catch {
        // If not valid JSON, fall back to defaults
      }
      const setRes = await setPins(rootPath, decision.target.domainSlug, pins, USER_ACTOR);
      if (!setRes.ok) return { ok: false, error: setRes.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "mapping") {
      const paths = vaultPaths(rootPath);
      // Parse proposedBodyMarkdown as JSON mapping
      let mapping: Record<string, unknown>;
      try {
        mapping = JSON.parse(decision.proposedBodyMarkdown) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Mapping proposedBody must be valid JSON", terminal: false };
      }
      // Validate columns
      const columns = mapping.columns;
      if (!Array.isArray(columns)) {
        return { ok: false, error: "Mapping must have columns array", terminal: false };
      }
      const databaseId = String(mapping.databaseId ?? "");
      const fingerprint = String(mapping.fingerprint ?? "");
      if (!databaseId) return { ok: false, error: "Mapping missing databaseId", terminal: false };
      if (!fingerprint) return { ok: false, error: "Mapping missing fingerprint", terminal: false };
      // Validate each columnId exists on database
      const dbRes = await getDatabase(rootPath, decision.target.domainSlug, databaseId);
      if (!dbRes.ok) return { ok: false, error: dbRes.error, terminal: false };
      const dbMeta = dbRes.value;
      const validColIds = new Set(dbMeta.columns.map((c) => c.id));
      for (const col of columns) {
        const c = col as { source?: string; columnId?: string };
        if (!c.source || typeof c.source !== "string" || !c.source.trim()) {
          return { ok: false, error: "Every mapping column needs a non-empty source", terminal: false };
        }
        // Empty columnId is allowed (unmapped column); non-empty must be valid
        if (c.columnId && (typeof c.columnId !== "string" || !validColIds.has(c.columnId))) {
          return { ok: false, error: `Mapping column for source "${c.source}" needs a valid columnId`, terminal: false };
        }
      }
      // Write mapping file
      const mappingPath = paths.domainMapping(decision.target.domainSlug, decision.target.mappingId);
      await atomicWriteFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
      // Log
      await appendLog(rootPath, {
        domainSlug: decision.target.domainSlug,
        type: "mapping.accepted",
        summary: `Mapping accepted: ${decision.target.mappingId} (${databaseId})`,
        payload: { mappingId: decision.target.mappingId, databaseId, fingerprint },
        // KAR-9: the life-log line names the agent that proposed this mapping.
        actor: decision.actor,
      });
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "kit-install") {
      // Approved kit-install Decision → run the install write path (user-level writes).
      const { applyFinanceKitInstall } = await import("./finance-kit.ts");
      const installRes = await applyFinanceKitInstall(rootPath, decision.actor);
      if (!installRes.ok) return { ok: false, error: installRes.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "assumption-set") {
      // Approved assumption-set Decision → upsert the row before the library else.
      let payload: { rowId: string; name: string; horizonMonths: number; deltas: unknown[] };
      try {
        payload = JSON.parse(decision.proposedBodyMarkdown);
      } catch {
        return { ok: false, error: "Assumption set proposedBody must be valid JSON", terminal: false };
      }
      const { upsertRow } = await import("./domain-databases.ts");
      const res = await upsertRow(rootPath, "financial", "finance:assumption-sets", {
        id: String(payload.rowId),
        cells: {
          name: String(payload.name ?? ""),
          horizon_months: Number.isFinite(payload.horizonMonths) ? Math.max(1, Math.min(60, payload.horizonMonths)) : 12,
          deltas: JSON.stringify(Array.isArray(payload.deltas) ? payload.deltas : []),
        },
      });
      if (!res.ok) return { ok: false, error: res.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "goal") {
      let command: GoalsCommand;
      try {
        command = JSON.parse(decision.proposedBodyMarkdown) as GoalsCommand;
      } catch {
        return { ok: false, error: "Goal proposedBody must be valid JSON", terminal: false };
      }
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        return { ok: false, error: "Goal proposedBody must be a GoalsCommand object", terminal: false };
      }
      const { applyGoalsCommand } = await import("./goals.ts");
      const res = await applyGoalsCommand(rootPath, command, decision.actor);
      if (!res.ok) return { ok: false, error: res.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "project") {
      // Approved project Decision → run the project write path. The command carries
      // the id allocated at propose time, so approve writes that exact file.
      const { projectClose, projectCreate } = await import("./projects.ts");
      // Parsed from JSON on disk, so treat it as untrusted rather than as the union:
      // the runtime guards below must stay reachable for a body that is not a
      // createProject/closeProject command.
      let command: { type?: unknown; [key: string]: unknown };
      try {
        command = JSON.parse(decision.proposedBodyMarkdown);
      } catch {
        return { ok: false, error: "Project proposedBody must be valid JSON", terminal: false };
      }
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        return { ok: false, error: "Project proposedBody must be a ProjectCommand object", terminal: false };
      }
      if (command.type === "createProject") {
        const res = await projectCreate(rootPath, {
          id: String(command.id),
          title: String(command.title),
          goalId: String(command.goalId),
          domainSlug:
            typeof command.domainSlug === "string" && command.domainSlug
              ? command.domainSlug
              : null,
          bodyMarkdown:
            typeof command.bodyMarkdown === "string" ? command.bodyMarkdown : undefined,
        }, decision.actor);
        if (!res.ok) return { ok: false, error: res.error, terminal: false };
        return { ok: true, value: undefined };
      }
      if (command.type === "closeProject") {
        const res = await projectClose(rootPath, String(command.id), decision.actor);
        if (!res.ok) return { ok: false, error: res.error, terminal: false };
        return { ok: true, value: undefined };
      }
      return { ok: false, error: `Unknown project command: ${String(command.type)}`, terminal: false };
    }
    if (decision.target.type === "day-template") {
      let command: MapCommand;
      try {
        command = JSON.parse(decision.proposedBodyMarkdown) as MapCommand;
      } catch {
        return { ok: false, error: "Day template proposedBody must be valid JSON", terminal: false };
      }
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        return { ok: false, error: "Day template proposedBody must be a map Command object", terminal: false };
      }
      const { applyMapCommand } = await import("./map/persist.ts");
      // Approved by the operator, so the map actor is "user" even when the agent proposed it.
      const res = await applyMapCommand(rootPath, command, "user");
      if (!res.ok) return { ok: false, error: res.error, terminal: false };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "database-row") {
      const { getRow, upsertRow, deleteRow } = await import("./domain-databases.ts");
      let body: DatabaseDecisionBody;
      try {
        body = JSON.parse(decision.proposedBodyMarkdown) as DatabaseDecisionBody;
      } catch {
        return { ok: false, error: "Database row proposedBody must be valid JSON", terminal: false };
      }
      if (!body || typeof body !== "object" || typeof body.op !== "string") {
        return { ok: false, error: "Database row proposedBody must be a DatabaseDecisionBody", terminal: false };
      }
      const { domainSlug, databaseId, rowId } = decision.target;

      // Archived is terminal: isDomainLive will not un-archive on a retry.
      if (!(await isDomainLive(rootPath, domainSlug))) {
        return {
          ok: false,
          error: `Domain not found or archived: ${domainSlug}`,
          terminal: true,
        };
      }

      if (body.op === "delete") {
        if (!rowId) {
          return { ok: false, error: "A delete Decision needs a rowId", terminal: false };
        }
        const deleted = await deleteRow(rootPath, domainSlug, databaseId, rowId);
        if (!deleted.ok) {
          // The row is gone for good: a retry cannot find it either.
          return { ok: false, error: deleted.error, terminal: deleted.error.startsWith("Row not found") };
        }
        return { ok: true, value: undefined };
      }

      if (body.op !== "upsert") {
        return { ok: false, error: `Unknown database row op: ${body.op}`, terminal: false };
      }
      if (!body.cells || typeof body.cells !== "object" || Array.isArray(body.cells)) {
        return { ok: false, error: "Database row proposedBody needs a cells object", terminal: false };
      }

      // Staleness guard. upsertRow is a full replace, so applying cells captured
      // before an intervening edit would erase everything that happened since.
      if (typeof body.expectedUpdatedAt === "string" && body.expectedUpdatedAt) {
        if (!rowId) {
          return { ok: false, error: "expectedUpdatedAt given for a create", terminal: false };
        }
        const current = await getRow(rootPath, domainSlug, databaseId, rowId);
        if (!current.ok) {
          return {
            ok: false,
            error: `Row changed: the row this Decision proposed against is gone (${rowId})`,
            terminal: true,
          };
        }
        if (current.value.updatedAt !== body.expectedUpdatedAt) {
          return {
            ok: false,
            error:
              `Row changed since this was proposed (expected ${body.expectedUpdatedAt}, ` +
              `found ${current.value.updatedAt}). Re-read the row and propose again.`,
            terminal: true,
          };
        }
      }

      // Finance referential + posted-row rules, re-checked at apply time.
      const referential = await checkDatabaseCells(rootPath, domainSlug, databaseId, body.cells);
      if (!referential.ok) {
        return { ok: false, error: referential.error, terminal: true };
      }

      const written = await upsertRow(rootPath, domainSlug, databaseId, {
        id: rowId ?? undefined,
        cells: body.cells,
      });
      if (!written.ok) {
        // validateCells rejects unknown column ids and bad values; re-approving
        // the same cells re-validates identically. Everything else is I/O.
        return { ok: false, error: written.error, terminal: isTerminalCellError(written.error) };
      }
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "database") {
      const { createDatabase, addDatabaseColumn } = await import("./domain-databases.ts");
      let body: DatabaseDecisionBody;
      try {
        body = JSON.parse(decision.proposedBodyMarkdown) as DatabaseDecisionBody;
      } catch {
        return { ok: false, error: "Database proposedBody must be valid JSON", terminal: false };
      }
      if (!body || typeof body !== "object" || typeof body.op !== "string") {
        return { ok: false, error: "Database proposedBody must be a DatabaseDecisionBody", terminal: false };
      }
      const { domainSlug, databaseId } = decision.target;

      if (!(await isDomainLive(rootPath, domainSlug))) {
        return {
          ok: false,
          error: `Domain not found or archived: ${domainSlug}`,
          terminal: true,
        };
      }

      if (body.op === "create-database") {
        // The id was minted at propose time, so the target can name the database
        // it proposes. No name-uniqueness check is added (spec Open Question 6).
        const created = await createDatabase(rootPath, domainSlug, {
          name: String(body.name ?? ""),
          id: databaseId,
        });
        if (!created.ok) {
          return { ok: false, error: created.error, terminal: created.error === "Database name is required" };
        }
        return { ok: true, value: undefined };
      }

      if (body.op === "add-column") {
        if (!(await isDomainLive(rootPath, domainSlug))) {
          return { ok: false, error: `Domain not found or archived: ${domainSlug}`, terminal: true };
        }
        const added = await addDatabaseColumn(rootPath, domainSlug, databaseId, {
          name: String(body.name ?? ""),
          type: body.type as DatabaseColumnType,
          options: Array.isArray(body.options) ? body.options.map(String) : undefined,
          relationDatabaseId:
            typeof body.relationDatabaseId === "string" ? body.relationDatabaseId : undefined,
        });
        if (!added.ok) {
          // A bad type, a select with no options, a missing relation target, or a
          // missing name: re-approving re-validates identically.
          const terminal = /Unknown column type|select requires|relation requires|Target database not found|Column name is required/.test(
            added.error,
          );
          return { ok: false, error: added.error, terminal };
        }
        return { ok: true, value: undefined };
      }

      return { ok: false, error: `Unknown database op: ${body.op}`, terminal: false };
    }
    if (decision.target.type === "doctrine") {
      const paths = vaultPaths(rootPath);
      const docPath = paths.documentMd(decision.target.domainSlug, decision.target.kind);

      let raw: string;
      try {
        raw = await fs.readFile(docPath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          return { ok: false, error: `Document not found: ${decision.target.domainSlug}/${decision.target.kind}`, terminal: false };
        }
        throw e;
      }

      const { data, body } = parseFrontmatter(raw);
      const existingLocked = typeof data.locked === "boolean" ? data.locked : data.status === "forged";
      const existingTitle =
        typeof data.title === "string" ? data.title : DOCUMENT_KIND_LABELS[decision.target.kind];
      const now = new Date().toISOString();

      // Write proposed title when proposedTitle is non-null; otherwise keep existing title.
      const nextTitle = decision.proposedTitle !== null ? decision.proposedTitle : existingTitle;

      const md = serializeFrontmatter(
        {
          title: nextTitle,
          locked: existingLocked,
          updatedAt: now,
        },
        decision.proposedBodyMarkdown,
      );
      await atomicWriteFile(docPath, md);
      return { ok: true, value: undefined };
    } else {
      // Library: load record (including locked), write title + body, keep locked.
      const noteRes = await libraryGet(rootPath, decision.target.id);
      if (!noteRes.ok) {
        // Agent-proposed note that did not exist at propose time. Approve creates it
        // under the id the decision was filed with.
        if (decision.proposedTitle === null) {
          return { ok: false, error: "Document not found", terminal: false };
        }
        const { libraryCreate } = await import("./library-documents.ts");
        const created = await libraryCreate(rootPath, {
          id: decision.target.id,
          title: decision.proposedTitle,
          bodyMarkdown: decision.proposedBodyMarkdown,
          domainSlugs: decision.domainSlugs,
        });
        if (!created.ok) return { ok: false, error: created.error, terminal: false };
        return { ok: true, value: undefined };
      }
      const existing = noteRes.value;
      const now = new Date().toISOString();
      const nextTitle =
        decision.proposedTitle !== null ? decision.proposedTitle : existing.title;
      const md = serializeFrontmatter(
        {
          title: nextTitle,
          domains: JSON.stringify(existing.domainSlugs),
          createdAt: existing.createdAt,
          updatedAt: now,
          deletedAt: existing.deletedAt,
          locked: existing.locked,
        },
        decision.proposedBodyMarkdown,
      );
      // Keep unquoted title style for titles without spaces.
      const raw = md.replace(/^title: "([^"\\]+)"$/m, "title: $1");
      const paths = vaultPaths(rootPath);
      await atomicWriteFile(paths.libraryDocumentMd(decision.target.id), raw);
      return { ok: true, value: undefined };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), terminal: false };
  }
}

export async function resolveDecision(
  rootPath: string,
  id: string,
  resolution: "approved" | "rejected",
): Promise<Result<DecisionRecord>> {
  try {
    if (resolution !== "approved" && resolution !== "rejected") {
      return { ok: false, error: `Invalid resolution: ${String(resolution)}` };
    }

    const paths = vaultPaths(rootPath);
    const filePath = paths.decisionJson(id);

    let decision: DecisionRecord;
    try {
      decision = await readDecisionFile(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `Decision not found: ${id}` };
      }
      throw e;
    }

    if (decision.status !== "pending") {
      return {
        ok: false,
        error: `Decision is already ${decision.status}`,
      };
    }

    const now = new Date().toISOString();

    if (resolution === "approved") {
      const applyRes = await applyApprovedBody(rootPath, decision);
      if (!applyRes.ok) {
        if (applyRes.terminal) {
          // Permanent: record the outcome instead of stranding the decision
          // pending forever with no way for anyone to act on it. The operator
          // did approve this, so `reason` is what tells the two rejections apart.
          decision = {
            ...decision,
            status: "rejected",
            reason: applyRes.error,
            resolvedAt: now,
          };
          await writeDecisionFile(filePath, decision);
          const failedLog = await appendLog(paths.root, {
            domainSlug: decision.domainSlugs[0] ?? null,
            type: "decision.resolved",
            summary: `Decision rejected: proposal no longer applies (${decision.title})`,
            payload: { id: decision.id, resolution: "rejected", documentKind: decision.target.type },
            actor: decision.actor,
          });
          if (!failedLog.ok) return failedLog;
        }
        // Transient: the record is untouched and the operator can approve again.
        return { ok: false, error: applyRes.error };
      }
    }

    decision = {
      ...decision,
      status: resolution,
      resolvedAt: now,
    };
    await writeDecisionFile(filePath, decision);

    const logRes = await appendLog(paths.root, {
      domainSlug: decision.domainSlugs[0] ?? null,
      type: "decision.resolved",
      summary: `Decision ${resolution}: ${decision.title}`,
      payload: { id: decision.id, resolution, documentKind: decision.target.type },
      actor: decision.actor,
    });
    if (!logRes.ok) return logRes;

    return { ok: true, value: decision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
