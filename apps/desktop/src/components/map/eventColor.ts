import { effectiveDomainSlug } from "@lifequest/vault-core/pure";
import type { DomainRecord } from "@lifequest/vault-core";

export const DEFAULT_EVENT_COLOR = "var(--map-event-default)";

export function eventMarkColor(
  domainSlug: string | null,
  domains: DomainRecord[],
): string {
  const live = domains.filter((d) => !d.meta.archivedAt).map((d) => d.slug);
  const slug = effectiveDomainSlug(domainSlug, live);
  if (!slug) return DEFAULT_EVENT_COLOR;
  const color = domains.find((d) => d.slug === slug)?.meta.color;
  return color && color.trim() ? color : DEFAULT_EVENT_COLOR;
}
