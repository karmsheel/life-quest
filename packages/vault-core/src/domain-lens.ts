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
