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

export function liveDomainSlugs(
  domains: readonly { slug: string; meta: { archivedAt: string | null } }[],
): string[] {
  return domains.filter((d) => !d.meta.archivedAt).map((d) => d.slug);
}
