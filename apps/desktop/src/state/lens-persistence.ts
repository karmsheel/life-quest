import {
  domainLens,
  overviewLens,
  type DomainLens,
} from "@lifequest/vault-core/pure";

/** Enough of a vault snapshot to decide which lens to show. */
export type LensSnapshot = {
  lifequest: { id: string };
  domains: readonly { slug: string; meta: { archivedAt: string | null } }[];
};

export function domainStillLive(snapshot: LensSnapshot, slug: string): boolean {
  return snapshot.domains.some((d) => d.slug === slug && !d.meta.archivedAt);
}

export type RestoredLens = {
  lens: DomainLens;
  /** Saved slug is not a live domain, so the pref for this vault should be cleared. */
  clearSaved: boolean;
};

/**
 * Lens to show for the vault that was just opened.
 * A missing pref is Overview. A saved slug that is gone is also Overview,
 * and the caller should forget that pref.
 */
export function resolveRestoredLens(
  persistedSlug: string | null,
  snapshot: LensSnapshot,
): RestoredLens {
  if (persistedSlug !== null && domainStillLive(snapshot, persistedSlug)) {
    return { lens: domainLens(persistedSlug), clearSaved: false };
  }
  return { lens: overviewLens(), clearSaved: persistedSlug !== null };
}

/**
 * Same-vault refresh may drop a lens whose domain was archived.
 * Opening a different vault must not write Overview onto that vault;
 * `resolveRestoredLens` applies its own saved lens afterward.
 */
export function shouldClearLensForSnapshot(
  previousVaultId: string | null,
  next: LensSnapshot | null,
  current: DomainLens,
): boolean {
  if (!next) return false;
  if (previousVaultId !== null && previousVaultId !== next.lifequest.id) {
    return false;
  }
  return current.kind === "domain" && !domainStillLive(next, current.slug);
}
