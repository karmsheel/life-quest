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
  type Result,
} from "./types.ts";
import { documentTargetLabel } from "./documents.ts";

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
      isLibraryExplicitTarget(explicitTarget as Record<string, unknown>))
  ) {
    const t = explicitTarget as Record<string, unknown>;
    target =
      t.type === "doctrine"
        ? {
            type: "doctrine",
            domainSlug: String(t.domainSlug),
            kind: String(t.kind) as DocumentKind,
          }
        : { type: "library", id: String(t.id) };
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

  // domainSlugs: array of strings if present, else doctrine [domainSlug], else [].
  let domainSlugs: string[];
  if (Array.isArray(raw.domainSlugs) && raw.domainSlugs.every((s) => typeof s === "string")) {
    domainSlugs = raw.domainSlugs as string[];
  } else if (target.type === "doctrine") {
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

    // Load the target and confirm it is locked.
    let docLocked: boolean;
    let domainSlugForLog: string | null = null;
    let libraryNote: { value: { domainSlugs: string[] } } | null = null;
    if (input.target.type === "doctrine") {
      const docRes = await getDocument(rootPath, input.target.domainSlug, input.target.kind);
      if (!docRes.ok) return docRes;
      docLocked = docRes.value.locked;
      domainSlugForLog = docRes.value.locked ? input.target.domainSlug : null;
      if (!docLocked) {
        return {
          ok: false,
          error: "Document must be locked before proposing a change",
        };
      }
    } else {
      const noteRes = await libraryGet(rootPath, input.target.id);
      if (!noteRes.ok) return noteRes;
      docLocked = noteRes.value.locked;
      domainSlugForLog = noteRes.value.locked ? (noteRes.value.domainSlugs[0] ?? null) : null;
      libraryNote = noteRes;
      if (!docLocked) {
        return {
          ok: false,
          error: "Document must be locked before proposing a change",
        };
      }
    }

    const domainSlugs: string[] =
      input.target.type === "doctrine"
        ? [input.target.domainSlug]
        : libraryNote!.value.domainSlugs;

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
        return { ok: false, error: "Document not found" };
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
