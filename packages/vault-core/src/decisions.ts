import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DOCUMENT_KINDS,
  type DecisionRecord,
  type DocumentKind,
  type DocumentStatus,
  type Result,
} from "./types.ts";

function isDocumentKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

async function readDecisionFile(filePath: string): Promise<DecisionRecord> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as DecisionRecord;
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
      // decisionJson via safeJoin guards traversal on id-shaped names
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
  input: Omit<DecisionRecord, "id" | "status" | "createdAt" | "resolvedAt"> & {
    id?: string;
  },
): Promise<Result<DecisionRecord>> {
  try {
    if (!isDocumentKind(input.documentKind)) {
      return { ok: false, error: `Invalid document kind: ${input.documentKind}` };
    }
    const domainSlug = input.domainSlug?.trim();
    if (!domainSlug) {
      return { ok: false, error: "domainSlug is required" };
    }
    const title = input.title?.trim();
    if (!title) {
      return { ok: false, error: "title is required" };
    }
    if (typeof input.proposedBodyMarkdown !== "string") {
      return { ok: false, error: "proposedBodyMarkdown is required" };
    }

    const paths = vaultPaths(rootPath);
    // Ensure decision path is under root (safeJoin)
    const id = input.id ?? randomUUID();
    const filePath = paths.decisionJson(id);

    await fs.mkdir(paths.decisionsDir, { recursive: true });

    const now = new Date().toISOString();
    const decision: DecisionRecord = {
      id,
      domainSlug,
      documentKind: input.documentKind,
      status: "pending",
      title,
      rationale: input.rationale ?? null,
      proposedBodyMarkdown: input.proposedBodyMarkdown,
      previousBodyMarkdown: input.previousBodyMarkdown ?? null,
      createdAt: now,
      resolvedAt: null,
    };

    await writeDecisionFile(filePath, decision);

    const logRes = await appendLog(paths.root, {
      domainSlug,
      type: "decision.created",
      summary: `Created decision: ${title}`,
      payload: {
        id,
        documentKind: input.documentKind,
        title,
      },
    });
    if (!logRes.ok) return logRes;

    return { ok: true, value: decision };
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
      const docPath = paths.documentMd(decision.domainSlug, decision.documentKind);
      let raw: string;
      try {
        raw = await fs.readFile(docPath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            ok: false,
            error: `Document not found: ${decision.domainSlug}/${decision.documentKind}`,
          };
        }
        throw e;
      }

      const { data } = parseFrontmatter(raw);
      const title =
        typeof data.title === "string"
          ? data.title
          : decision.documentKind[0]!.toUpperCase() + decision.documentKind.slice(1);
      const status = (data.status as DocumentStatus) || "forged";
      const forgedAt = (data.forgedAt as string | null) ?? now;

      // Apply proposed body; keep status forged (or whatever it was), bump updatedAt
      const md = serializeFrontmatter(
        {
          title,
          status,
          forgedAt,
          updatedAt: now,
        },
        decision.proposedBodyMarkdown,
      );
      await atomicWriteFile(docPath, md);
    }

    decision = {
      ...decision,
      status: resolution,
      resolvedAt: now,
    };
    await writeDecisionFile(filePath, decision);

    const logRes = await appendLog(paths.root, {
      domainSlug: decision.domainSlug,
      type: "decision.resolved",
      summary: `Decision ${resolution}: ${decision.title}`,
      payload: {
        id: decision.id,
        resolution,
        documentKind: decision.documentKind,
        title: decision.title,
      },
    });
    if (!logRes.ok) return logRes;

    return { ok: true, value: decision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
