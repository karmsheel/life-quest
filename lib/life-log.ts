export const LIFE_EVENT_TYPES = [
  "domain.created",
  "domain.renamed",
  "domain.archived",
  "domain.restored",
  "document.created",
  "document.updated",
  "document.status_changed",
  "decision.created",
  "decision.approved",
  "decision.rejected",
  "agent.hired",
  "agent.dismissed",
] as const;

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number];

export function isLifeEventType(s: string): s is LifeEventType {
  return (LIFE_EVENT_TYPES as readonly string[]).includes(s);
}
