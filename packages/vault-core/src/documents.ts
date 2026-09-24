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
  return fallbackTitle;
}

export { USER_ACTOR };
export type { Actor, DocumentKind, DocumentTarget };
