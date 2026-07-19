import type { DocumentStatus } from "./types.ts";

export function canTransitionStatus(from: DocumentStatus, to: DocumentStatus): boolean {
  if (from === to) return false;
  if (from === "forged") return false;
  if (to === "draft") return false;
  if (from === "draft" && (to === "refined" || to === "forged")) return true;
  if (from === "refined" && to === "forged") return true;
  return false;
}

export function assertEditable(
  status: DocumentStatus,
): { ok: true } | { ok: false; reason: string } {
  if (status === "forged") {
    return {
      ok: false,
      reason: "Forged documents are read-only; propose a change via Decisions.",
    };
  }
  return { ok: true };
}
