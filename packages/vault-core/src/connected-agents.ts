// KAR-70: the connected-agent roster. `.lifequest/connected-agents.json` holds
// the roster and no secrets — only the 12-hex fingerprint of a bearer. Raw
// bearers and raw invite codes never reach this file, the life log, or an
// error message.
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { vaultPaths } from "./paths.ts";
import { createDecision } from "./decisions.ts";
import type { Result } from "./types.ts";

export type ConnectedAgentStatus = "pending" | "active" | "rejected" | "revoked";

export type ConnectedAgent = {
  id: string;
  name: string;
  fingerprint: string;
  status: ConnectedAgentStatus;
  access: "read" | "write";
  domainSlugs: string[];
  schedule: boolean;
  door: "local" | "invite";
  createdAt: string;
  decidedAt: string | null;
};

/** KAR-70: at most this many roster rows may sit at status `pending`. */
export const PENDING_PAIRING_CAP = 20;

type ConnectedAgentsFile = { agents: ConnectedAgent[] };

async function readConnectedAgents(rootPath: string): Promise<ConnectedAgentsFile> {
  const paths = vaultPaths(rootPath);
  try {
    const raw = await fs.readFile(paths.connectedAgentsJson, "utf8");
    const parsed = JSON.parse(raw) as { agents?: ConnectedAgent[] };
    return { agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { agents: [] };
    }
    throw e;
  }
}

async function writeConnectedAgents(
  rootPath: string,
  data: ConnectedAgentsFile,
): Promise<void> {
  const paths = vaultPaths(rootPath);
  await fs.mkdir(paths.lifequestDir, { recursive: true });
  await atomicWriteFile(paths.connectedAgentsJson, `${JSON.stringify(data, null, 2)}\n`);
}

/** The full SHA-256 hex of a bearer. The stored field is the first 12 chars. */
export function fingerprintOf(bearer: string): string {
  return createHash("sha256").update(bearer, "utf8").digest("hex");
}

export async function listConnectedAgents(rootPath: string): Promise<Result<ConnectedAgent[]>> {
  try {
    const data = await readConnectedAgents(rootPath);
    return { ok: true, value: data.agents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getConnectedAgentByFingerprint(
  rootPath: string,
  fingerprint: string,
): Promise<Result<ConnectedAgent | null>> {
  const list = await listConnectedAgents(rootPath);
  if (!list.ok) return list;
  return {
    ok: true,
    value: list.value.find((a) => a.fingerprint === fingerprint) ?? null,
  };
}

/**
 * KAR-70: file the pairing row and its one Decision for a first contact. A row
 * with the same fingerprint is reused (never a second row, never a second
 * Decision), and a new introduction past the pending cap is refused with
 * `PAIRING_LIMIT` before anything is written.
 */
export async function introduceConnectedAgent(
  rootPath: string,
  input: { name: string; fingerprint: string; door: "local" | "invite" },
): Promise<Result<{ agent: ConnectedAgent; decisionId: string }>> {
  try {
    const name = input.name.trim();
    if (!name) {
      return { ok: false, error: "name is required" };
    }
    const fingerprint = input.fingerprint.trim();
    if (!fingerprint) {
      return { ok: false, error: "fingerprint is required" };
    }

    const data = await readConnectedAgents(rootPath);

    const existing = data.agents.find((a) => a.fingerprint === fingerprint);
    if (existing) {
      const decisions = await listPairingDecisions(rootPath);
      const open = decisions.find((d) => d.target.type === "agent-pairing" && d.target.agentId === existing.id);
      if (open) return { ok: true, value: { agent: existing, decisionId: open.id } };
      // A row with no Decision behind it (hand-edited file, say) still needs
      // one before the operator can act on it.
      const filed = await filePairingDecision(rootPath, existing);
      if (!filed.ok) return filed;
      return { ok: true, value: { agent: existing, decisionId: filed.value } };
    }

    const pending = data.agents.filter((a) => a.status === "pending").length;
    if (pending >= PENDING_PAIRING_CAP) {
      return { ok: false, error: "PAIRING_LIMIT" };
    }

    const agent: ConnectedAgent = {
      id: randomUUID(),
      name,
      fingerprint,
      status: "pending",
      access: "read",
      domainSlugs: [],
      schedule: false,
      door: input.door,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };

    const decisionId = await filePairingDecision(rootPath, agent);
    if (!decisionId.ok) return decisionId;

    data.agents.push(agent);
    try {
      await writeConnectedAgents(rootPath, data);
    } catch (e) {
      // The Decision is filed but nothing points at it: approving it later
      // would land on the terminal "Agent not found" path. Take it back out
      // rather than leave an orphan the operator can resolve into a rejection.
      await deletePairingDecision(rootPath, decisionId.value);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, value: { agent, decisionId: decisionId.value } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * KAR-70: undo an introduction. The invite door calls this when it cannot
 * complete its own half of the introduction (the bearer hash, or the code
 * consume), so a partial write never survives as a pending Decision.
 */
export async function removeConnectedAgent(
  rootPath: string,
  id: string,
): Promise<Result<true>> {
  try {
    const data = await readConnectedAgents(rootPath);
    const idx = data.agents.findIndex((a) => a.id === id);
    if (idx === -1) return { ok: true, value: true };
    data.agents.splice(idx, 1);
    await writeConnectedAgents(rootPath, data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Remove one Decision file. Used only to roll back a failed introduction. */
export async function removeDecision(
  rootPath: string,
  decisionId: string,
): Promise<Result<true>> {
  try {
    await deletePairingDecision(rootPath, decisionId);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The operator decided this caller: active, rejected, or revoked. `active` is
 * idempotent — a second approve changes nothing, and in particular never
 * touches `access`, `domainSlugs`, or `schedule`.
 */
export async function markConnectedAgent(
  rootPath: string,
  id: string,
  status: "active" | "rejected" | "revoked",
): Promise<Result<ConnectedAgent>> {
  try {
    const data = await readConnectedAgents(rootPath);
    const idx = data.agents.findIndex((a) => a.id === id);
    if (idx === -1) {
      return { ok: false, error: `Agent not found: ${id}` };
    }
    const existing = data.agents[idx]!;
    if (existing.status === status) {
      return { ok: true, value: existing };
    }
    const updated: ConnectedAgent = {
      ...existing,
      status,
      decidedAt: new Date().toISOString(),
    };
    data.agents[idx] = updated;
    await writeConnectedAgents(rootPath, data);
    return { ok: true, value: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Operator grant edit (KAR-70 domain grants; the write/schedule switches). */
export async function updateConnectedAgentGrant(
  rootPath: string,
  id: string,
  patch: { access?: "read" | "write"; domainSlugs?: string[]; schedule?: boolean },
): Promise<Result<ConnectedAgent>> {
  try {
    const data = await readConnectedAgents(rootPath);
    const idx = data.agents.findIndex((a) => a.id === id);
    if (idx === -1) {
      return { ok: false, error: `Agent not found: ${id}` };
    }
    const existing = data.agents[idx]!;
    const updated: ConnectedAgent = {
      ...existing,
      access: patch.access ?? existing.access,
      domainSlugs: Array.isArray(patch.domainSlugs) ? [...patch.domainSlugs] : existing.domainSlugs,
      schedule: patch.schedule ?? existing.schedule,
    };
    data.agents[idx] = updated;
    await writeConnectedAgents(rootPath, data);
    return { ok: true, value: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type PairingDecision = {
  id: string;
  target: { type: string; agentId?: string };
  status: string;
};

async function listPairingDecisions(rootPath: string): Promise<PairingDecision[]> {
  const paths = vaultPaths(rootPath);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(paths.decisionsDir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: PairingDecision[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await fs.readFile(paths.decisionJson(entry.name.replace(/\.json$/, "")), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const target = parsed.target as { type?: string; agentId?: string } | undefined;
    if (target?.type !== "agent-pairing") continue;
    out.push({
      id: String(parsed.id ?? entry.name.replace(/\.json$/, "")),
      target: { type: target.type, agentId: target.agentId },
      status: String(parsed.status ?? "pending"),
    });
  }
  return out;
}

/** One Decision per introduced agent: title `Connect <name>`, body the JSON. */
async function filePairingDecision(
  rootPath: string,
  agent: ConnectedAgent,
): Promise<Result<string>> {
  const res = await createDecision(rootPath, {
    target: { type: "agent-pairing", agentId: agent.id },
    proposedTitle: `Connect ${agent.name}`,
    proposedBodyMarkdown: `${JSON.stringify(
      { fingerprint: agent.fingerprint, door: agent.door },
      null,
      2,
    )}\n`,
    domainSlugs: [],
    actor: { type: "agent", id: agent.id, name: agent.name },
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, value: res.value.id };
}

async function deletePairingDecision(rootPath: string, decisionId: string): Promise<void> {
  const paths = vaultPaths(rootPath);
  try {
    await fs.unlink(paths.decisionJson(decisionId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}