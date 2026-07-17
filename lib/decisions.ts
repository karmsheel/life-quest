import type { DocumentStatus } from "./document-kinds.ts";

export const DECISION_STATUSES = ["pending", "approved", "rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const RESOLVE_ACTIONS = ["approve", "reject"] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

export function parseDecisionStatus(s: string): DecisionStatus | null {
  return (DECISION_STATUSES as readonly string[]).includes(s)
    ? (s as DecisionStatus)
    : null;
}

export function parseResolveAction(s: unknown): ResolveAction | null {
  if (s === "approve" || s === "reject") return s;
  return null;
}

/** Proposals are only allowed against forged documents. */
export function canProposeOnDocument(
  status: DocumentStatus | string,
): { ok: true } | { ok: false; reason: string } {
  if (status !== "forged") {
    return {
      ok: false,
      reason: "Document must be forged to propose a change",
    };
  }
  return { ok: true };
}

/** Only pending decisions can be resolved. */
export function canResolveDecision(
  status: DecisionStatus | string,
): { ok: true } | { ok: false; reason: string } {
  if (status !== "pending") {
    return {
      ok: false,
      reason: `Decision is already ${status}`,
    };
  }
  return { ok: true };
}

/** List filter: `pending` or `all` (default pending when absent from query handled by caller). */
export function parseListStatusFilter(
  raw: string | null,
): "pending" | "all" | null {
  if (raw === null || raw === undefined || raw === "") return "pending";
  if (raw === "pending" || raw === "all") return raw;
  return null;
}
