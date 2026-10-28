import { COLOR_IDS } from "@lifequest/vault-core/map";
import { effectiveDomainSlug } from "@lifequest/vault-core/pure";
import type { DomainRecord } from "@lifequest/vault-core";

export const DEFAULT_EVENT_COLOR = "var(--map-event-default)";

/**
 * A colour a domain record claims to wear, if it is one the app itself writes.
 *
 * `meta.color` is vault data: a synced or hostile `domain.json` can carry any
 * string, and this function's result is painted straight into a CSS
 * `background`. Only the two shapes the product mints are accepted — a map
 * colour id (what the map tools set) or a hex colour (older/hand-written
 * records) — so a value like `url(https://…)`, `image-set(…)` or a stray
 * declaration can never become CSS. Everything else falls back to the theme's
 * default mark colour.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function safeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((COLOR_IDS as readonly string[]).includes(trimmed)) return trimmed;
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

export function eventMarkColor(
  domainSlug: string | null,
  domains: DomainRecord[],
): string {
  const live = domains.filter((d) => !d.meta.archivedAt).map((d) => d.slug);
  const slug = effectiveDomainSlug(domainSlug, live);
  if (!slug) return DEFAULT_EVENT_COLOR;
  const color = domains.find((d) => d.slug === slug)?.meta.color;
  return safeColor(color) ?? DEFAULT_EVENT_COLOR;
}
