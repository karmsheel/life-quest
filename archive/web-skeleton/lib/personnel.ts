export type ScannedAgent = {
  id: string;
  name: string;
  description?: string;
};

export type AgentHireStatus = "active" | "dismissed";

export const AGENT_HIRE_STATUSES = ["active", "dismissed"] as const;

export function isAgentHireStatus(s: string): s is AgentHireStatus {
  return (AGENT_HIRE_STATUSES as readonly string[]).includes(s);
}

/**
 * Normalize various Hermes list payloads into { id, name, description? }[].
 * Accepts arrays or wrappers like { data }, { agents }, { profiles }, { models }.
 */
export function normalizeScannedAgents(payload: unknown): ScannedAgent[] {
  const items = extractList(payload);
  const agents: ScannedAgent[] = [];
  const seen = new Set<string>();

  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;

    const id = firstString(row, [
      "id",
      "agent_id",
      "agentId",
      "profileKey",
      "profile_key",
      "name",
      "model",
    ]);
    if (!id || seen.has(id)) continue;

    const name =
      firstString(row, [
        "name",
        "displayName",
        "display_name",
        "label",
        "title",
        "id",
        "model",
      ]) ?? id;

    const description =
      firstString(row, ["description", "summary", "text", "role"]) ?? undefined;

    seen.add(id);
    agents.push(
      description !== undefined
        ? { id, name, description }
        : { id, name },
    );
  }

  return agents;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "agents", "profiles", "models", "items", "results"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

function firstString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Paths tried for agent/profile listing (Forge-style then OpenAI-compatible). */
export const HERMES_SCAN_PATHS = [
  "/v1/agents",
  "/agents",
  "/v1/profiles",
  "/v1/models",
] as const;

export function serializeAgentHire(h: {
  id: string;
  userId: string;
  domainId: string | null;
  hermesAgentId: string;
  name: string;
  roleLabel: string | null;
  status: string;
  createdAt: Date;
  dismissedAt: Date | null;
}) {
  return {
    id: h.id,
    userId: h.userId,
    domainId: h.domainId,
    hermesAgentId: h.hermesAgentId,
    name: h.name,
    roleLabel: h.roleLabel,
    status: h.status,
    createdAt: h.createdAt,
    dismissedAt: h.dismissedAt,
  };
}
