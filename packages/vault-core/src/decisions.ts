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
  type DecisionRecord,
  type DocumentKind,
  type DocumentTarget,
  type GoalsCommand,
  type Result,
} from "./types.ts";
import type { Command as MapCommand } from "./map/types.ts";
import { getDatabase, isDomainLive, readRegistry } from "./domain-databases.ts";
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
      isDayTemplateExplicitTarget(explicitTarget as Record<string, unknown>))
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
    } else if (t.type === "day-template") {
      target = { type: "day-template" };
    } else {
      target = { type: "library", id: String(t.id) };
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
    } else if (input.target.type === "goal" || input.target.type === "day-template") {
      // Goals and day templates are not documents. No shape to validate beyond the type.
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
    } else if (input.target.type === "goal" || input.target.type === "day-template") {
      // Neither goals nor day templates are lockable or pre-existing files.
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
                  : input.target.type === "review"
                    ? []
                    : input.target.type === "goal"
                      ? input.domainSlugs ?? []
                      : input.target.type === "day-template"
                        ? []
                        : libraryNote
                          ? libraryNote.value.domainSlugs
                          : (input.domainSlugs ?? []);

    const title = `Proposed change to ${documentTargetLabel(
      input.target,
      input.proposedTitle ?? "",
    )}`;

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
async function applyApprovedBody(
  rootPath: string,
  decision: DecisionRecord,
): Promise<Result<void>> {
  try {
    if (decision.target.type === "review") {
      const res = await applyLockedReviewBody(
        rootPath,
        decision.target.cadence,
        decision.target.period,
        decision.proposedBodyMarkdown,
      );
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "page") {
      const { getPage, updatePage } = await import("./pages.ts");
      const { USER_ACTOR } = await import("./types.ts");
      const pageRes = await getPage(rootPath, decision.target.domainSlug, decision.target.pageId);
      if (!pageRes.ok) return pageRes;
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
      if (!updateRes.ok) return updateRes;
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
      if (!setRes.ok) return setRes;
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "mapping") {
      const paths = vaultPaths(rootPath);
      // Parse proposedBodyMarkdown as JSON mapping
      let mapping: Record<string, unknown>;
      try {
        mapping = JSON.parse(decision.proposedBodyMarkdown) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Mapping proposedBody must be valid JSON" };
      }
      // Validate columns
      const columns = mapping.columns;
      if (!Array.isArray(columns)) {
        return { ok: false, error: "Mapping must have columns array" };
      }
      const databaseId = String(mapping.databaseId ?? "");
      const fingerprint = String(mapping.fingerprint ?? "");
      if (!databaseId) return { ok: false, error: "Mapping missing databaseId" };
      if (!fingerprint) return { ok: false, error: "Mapping missing fingerprint" };
      // Validate each columnId exists on database
      const dbRes = await getDatabase(rootPath, decision.target.domainSlug, databaseId);
      if (!dbRes.ok) return dbRes;
      const dbMeta = dbRes.value;
      const validColIds = new Set(dbMeta.columns.map((c) => c.id));
      for (const col of columns) {
        const c = col as { source?: string; columnId?: string };
        if (!c.source || typeof c.source !== "string" || !c.source.trim()) {
          return { ok: false, error: "Every mapping column needs a non-empty source" };
        }
        // Empty columnId is allowed (unmapped column); non-empty must be valid
        if (c.columnId && (typeof c.columnId !== "string" || !validColIds.has(c.columnId))) {
          return { ok: false, error: `Mapping column for source "${c.source}" needs a valid columnId` };
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
      });
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "kit-install") {
      // Approved kit-install Decision → run the install write path (user-level writes).
      const { applyFinanceKitInstall } = await import("./finance-kit.ts");
      const installRes = await applyFinanceKitInstall(rootPath);
      if (!installRes.ok) return installRes;
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "assumption-set") {
      // Approved assumption-set Decision → upsert the row before the library else.
      let payload: { rowId: string; name: string; horizonMonths: number; deltas: unknown[] };
      try {
        payload = JSON.parse(decision.proposedBodyMarkdown);
      } catch {
        return { ok: false, error: "Assumption set proposedBody must be valid JSON" };
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
      if (!res.ok) return res;
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "goal") {
      let command: GoalsCommand;
      try {
        command = JSON.parse(decision.proposedBodyMarkdown) as GoalsCommand;
      } catch {
        return { ok: false, error: "Goal proposedBody must be valid JSON" };
      }
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        return { ok: false, error: "Goal proposedBody must be a GoalsCommand object" };
      }
      const { applyGoalsCommand } = await import("./goals.ts");
      const res = await applyGoalsCommand(rootPath, command);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "day-template") {
      let command: MapCommand;
      try {
        command = JSON.parse(decision.proposedBodyMarkdown) as MapCommand;
      } catch {
        return { ok: false, error: "Day template proposedBody must be valid JSON" };
      }
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        return { ok: false, error: "Day template proposedBody must be a map Command object" };
      }
      const { applyMapCommand } = await import("./map/persist.ts");
      // Approved by the operator, so the map actor is "user" even when the agent proposed it.
      const res = await applyMapCommand(rootPath, command, "user");
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, value: undefined };
    }
    if (decision.target.type === "doctrine") {
      const paths = vaultPaths(rootPath);
      const docPath = paths.documentMd(decision.target.domainSlug, decision.target.kind);

      let raw: string;
      try {
        raw = await fs.readFile(docPath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          return { ok: false, error: `Document not found: ${decision.target.domainSlug}/${decision.target.kind}` };
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
          return { ok: false, error: "Document not found" };
        }
        const { libraryCreate } = await import("./library-documents.ts");
        const created = await libraryCreate(rootPath, {
          id: decision.target.id,
          title: decision.proposedTitle,
          bodyMarkdown: decision.proposedBodyMarkdown,
          domainSlugs: decision.domainSlugs,
        });
        if (!created.ok) return { ok: false, error: created.error };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
      if (!applyRes.ok) return applyRes;
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
