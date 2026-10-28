import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { isDomainLive } from "./domain-databases.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  USER_ACTOR,
  type Actor,
  type ManualDecisionRecord,
  type Result,
} from "./types.ts";

/**
 * Manual decisions — the ones the operator made, logged by hand.
 *
 * A proposal is a change waiting for an answer; a manual decision is an answer
 * the operator already gave, about something the vault does not write. Keeping
 * the two in separate stores is the whole safety property: the approval path
 * lists `.lifequest/decisions`, so a logged decision can never become a pending
 * card, can never be approved into a document, and can never be resolved twice.
 * History is the one surface that reads both, and it is a read.
 */

/** The input the operator's form sends. */
export type ManualDecisionInput = {
  /** What was decided. Required: a record with no sentence records nothing. */
  title: string;
  /** Why — optional. Blank becomes null. */
  rationale?: string | null;
  /** The domain it belongs to, or null. */
  domainSlug?: string | null;
};

export function normalizeManualDecision(
  raw: Record<string, unknown>,
): ManualDecisionRecord {
  // A stored manual decision was always the operator's. A hand-edited file that
  // names an agent is still read as the operator's record rather than letting
  // the actor drift, because there is no proposer to name.
  const actor: Actor = USER_ACTOR;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    title: typeof raw.title === "string" ? raw.title : "",
    rationale: typeof raw.rationale === "string" ? raw.rationale : null,
    domainSlug:
      typeof raw.domainSlug === "string" && raw.domainSlug ? raw.domainSlug : null,
    actor,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString(),
  };
}

async function readManualDecisionFile(filePath: string): Promise<ManualDecisionRecord> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return normalizeManualDecision(parsed);
}

/**
 * Manual-decision files this process has already reported as unreadable.
 *
 * One broken file must not blank the operator's whole manual history, and it
 * must not report the same breakage on every read either. Same rule as the
 * Decision inbox: report once, leave the file alone, read the rest.
 */
const reportedUnreadableManualDecisions = new Set<string>();

/**
 * Every manual decision in the vault, newest first.
 *
 * Newest first because every caller is a history: the form's own recent list and
 * the History tab both read top-down. A missing directory is the fresh-vault
 * case, and it is an empty history rather than an error.
 */
export async function listManualDecisions(
  rootPath: string,
): Promise<Result<ManualDecisionRecord[]>> {
  try {
    const paths = vaultPaths(rootPath);
    const decisions: ManualDecisionRecord[] = [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(paths.manualDecisionsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: [] };
      }
      throw e;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(/\.json$/, "");
      const filePath = paths.manualDecisionJson(id);
      try {
        decisions.push(await readManualDecisionFile(filePath));
      } catch (e) {
        if (!reportedUnreadableManualDecisions.has(filePath)) {
          reportedUnreadableManualDecisions.add(filePath);
          try {
            await appendLog(rootPath, {
              domainSlug: null,
              type: "manual-decision.unreadable",
              summary: `Could not read the manual decision file ${entry.name}`,
              payload: {
                file: entry.name,
                error: e instanceof Error ? e.message : String(e),
              },
              actor: null,
            });
          } catch {
            // The read path is not a write path; a log failure changes nothing.
          }
        }
      }
    }
    decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, value: decisions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Log a decision the operator made.
 *
 * The title is the decision itself, so an empty one is refused: a record that
 * reads as nothing is worse than no record, because History would show a blank
 * row that the operator cannot correct (this store is append-only). A named
 * domain must be live — logging against an archived domain would file the
 * decision where the lens can never show it.
 */
export async function createManualDecision(
  rootPath: string,
  input: ManualDecisionInput,
): Promise<Result<ManualDecisionRecord>> {
  try {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) {
      return { ok: false, error: "Say what you decided before logging it" };
    }

    const domainSlug =
      typeof input.domainSlug === "string" && input.domainSlug.trim()
        ? input.domainSlug.trim()
        : null;
    if (domainSlug && !(await isDomainLive(rootPath, domainSlug))) {
      return { ok: false, error: `Domain not found or archived: ${domainSlug}` };
    }

    const rationale =
      typeof input.rationale === "string" && input.rationale.trim()
        ? input.rationale.trim()
        : null;

    const paths = vaultPaths(rootPath);
    const decision: ManualDecisionRecord = {
      id: randomUUID(),
      title,
      rationale,
      domainSlug,
      actor: USER_ACTOR,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(paths.manualDecisionsDir, { recursive: true });
    await atomicWriteFile(
      paths.manualDecisionJson(decision.id),
      `${JSON.stringify(decision, null, 2)}\n`,
    );

    // The Life log hears about it like every other act that changes the vault.
    // The decision's real home is its own store; this line is the feed's copy.
    const logRes = await appendLog(paths.root, {
      domainSlug,
      type: "manual-decision.logged",
      summary: `Logged manual decision: ${title}`,
      payload: { id: decision.id, domainSlug, title },
      actor: USER_ACTOR,
    });
    if (!logRes.ok) return logRes;

    return { ok: true, value: decision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
