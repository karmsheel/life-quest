import {
  DOCUMENT_KIND_LABELS,
  USER_ACTOR,
  type Actor,
  type DocumentKind,
  type DocumentTarget,
} from "./types.ts";
import { periodTitle } from "./period.ts";

export function lockedFromFrontmatter(data: Record<string, unknown>): boolean {
  if (typeof data.locked === "boolean") return data.locked;
  return data.status === "forged";
}

export function assertEditable(
  locked: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (locked) {
    return {
      ok: false,
      reason: "Document is locked. Unlock to edit, or propose a change.",
    };
  }
  return { ok: true };
}

export function actorDisplayName(actor: Actor): string {
  return actor.type === "user" ? "You" : actor.name;
}

export function documentTargetLabel(
  target: DocumentTarget,
  fallbackTitle: string,
): string {
  if (target.type === "doctrine") return DOCUMENT_KIND_LABELS[target.kind];
  if (target.type === "review") return periodTitle(target.cadence, target.period, "monday");
  if (target.type === "page") return fallbackTitle || "Page";
  if (target.type === "pins") return target.domainSlug ? `${target.domainSlug} pins` : "Overview pins";
  if (target.type === "mapping") return fallbackTitle ? `${fallbackTitle}` : "Ingest mapping";
  if (target.type === "kit-install") return "Finance kit";
  if (target.type === "assumption-set") return "Assumption set";
  if (target.type === "goal") return "Goal";
  if (target.type === "project") return "Project";
  if (target.type === "day-template") return "Day template";
  if (target.type === "database-row") {
    // A row write is reviewed by row label where the proposer named one, else by
    // the database it lands in. Never empty: the inbox renders this subject.
    return fallbackTitle || (target.rowId ? `Row in ${target.databaseId}` : `New row in ${target.databaseId}`);
  }
  if (target.type === "database") {
    return fallbackTitle || `Database in ${target.domainSlug}`;
  }
  // KAR-70: a pairing Decision is named by the caller it introduces, which the
  // proposer supplies as `Connect <name>`. The fallback only shows for a
  // record that somehow lost its title.
  if (target.type === "agent-pairing") {
    return fallbackTitle || "Agent pairing";
  }
  return fallbackTitle;
}

export { USER_ACTOR };
export type { Actor, DocumentKind, DocumentTarget };
