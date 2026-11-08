import { BASE_AREA_SLUG } from "./types.ts";

export type DomainLens =
  | { kind: "overview" }
  | { kind: "domain"; slug: string };

export function overviewLens(): DomainLens {
  return { kind: "overview" };
}

export function domainLens(slug: string): DomainLens {
  return { kind: "domain", slug };
}

export function lensSlug(lens: DomainLens): string | null {
  return lens.kind === "domain" ? lens.slug : null;
}

export function recordVisible(
  lens: DomainLens,
  domainSlug: string | null,
): boolean {
  if (lens.kind === "overview") return true;
  return domainSlug === lens.slug;
}

export function recordVisibleMulti(
  lens: DomainLens,
  domainSlugs: readonly string[],
): boolean {
  if (lens.kind === "overview") return true;
  return domainSlugs.includes(lens.slug);
}

export function filterByLens<T extends { domainSlug: string | null }>(
  items: readonly T[],
  lens: DomainLens,
): T[] {
  return items.filter((item) => recordVisible(lens, item.domainSlug));
}

export function effectiveDomainSlug(
  domainSlug: string | null,
  liveSlugs: ReadonlySet<string> | readonly string[],
): string | null {
  if (!domainSlug) return null;
  const set = liveSlugs instanceof Set ? liveSlugs : new Set(liveSlugs);
  return set.has(domainSlug) ? domainSlug : null;
}

/** The slice of a domain record the visibility rules need. */
export type AreaLike = {
  meta: { archivedAt: string | null; unlockedAt?: string | null };
};

/**
 * A seeded area is locked only when `unlockedAt` is explicitly null. An absent
 * field means unlocked, which is how every vault written before the lock state
 * existed keeps every one of its areas.
 */
export function isAreaLocked(area: AreaLike): boolean {
  return area.meta.unlockedAt === null;
}

/** The operator can see this area: it is unlocked and not archived. */
export function isAreaLive(area: AreaLike): boolean {
  return !isAreaLocked(area) && area.meta.archivedAt == null;
}

/** The same rule for a `domain.json` read straight off disk. */
export function isLiveAreaMeta(meta: {
  archivedAt?: string | null;
  unlockedAt?: string | null;
}): boolean {
  return meta.archivedAt == null && meta.unlockedAt !== null;
}

/** The vault's always-unlocked base area, `life`. */
export function isBaseAreaSlug(slug: string): boolean {
  return slug === BASE_AREA_SLUG;
}

type SortableArea = AreaLike & { slug: string; meta: { sortOrder: number } };

/** Every visible area, base included, in the vault's own order. */
export function liveAreas<T extends SortableArea>(domains: readonly T[]): T[] {
  return domains
    .filter(isAreaLive)
    .slice()
    .sort((a, b) =>
      a.meta.sortOrder !== b.meta.sortOrder
        ? a.meta.sortOrder - b.meta.sortOrder
        : a.slug.localeCompare(b.slug),
    );
}

/**
 * The areas the operator chooses between: `liveAreas` without the base area.
 * The base area is where unscoped records live; it is not a chip.
 */
export function unlockedAreas<T extends SortableArea>(domains: readonly T[]): T[] {
  return liveAreas(domains).filter((d) => !isBaseAreaSlug(d.slug));
}

export function findBaseArea<T extends { slug: string }>(
  domains: readonly T[],
): T | undefined {
  return domains.find((d) => isBaseAreaSlug(d.slug));
}

export function liveDomainSlugs(
  domains: readonly {
    slug: string;
    meta: { archivedAt: string | null; unlockedAt?: string | null };
  }[],
): string[] {
  return domains.filter(isAreaLive).map((d) => d.slug);
}
