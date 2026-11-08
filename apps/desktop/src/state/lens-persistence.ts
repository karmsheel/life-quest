import {
  domainLens,
  isAreaLive,
  overviewLens,
  type DomainLens,
} from "@lifequest/vault-core/pure";

/** Enough of a vault snapshot to decide which lens to show. */
export type LensSnapshot = {
  lifequest: { id: string };
  domains: readonly {
    slug: string;
    meta: { archivedAt: string | null; unlockedAt?: string | null };
  }[];
};

/**
 * An area is a valid lens target only while the operator can see it: unlocked
 * and not archived. A locked area is invisible everywhere, so a saved lens on
 * one falls back to Life like a saved lens on an archived one.
 */
export function domainStillLive(snapshot: LensSnapshot, slug: string): boolean {
  return snapshot.domains.some((d) => d.slug === slug && isAreaLive(d));
}

export type RestoredLens = {
  lens: DomainLens;
  /** Saved slug is neither unlocked nor live, so the pref for this vault should be cleared. */
  clearSaved: boolean;
};

/**
 * Lens to show for the vault that was just opened.
 * A missing pref is Life. A saved slug that is gone, locked or archived is also
 * Life, and the caller should forget that pref.
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
 * Same-vault refresh may drop a lens whose area was archived, or whose unlock
 * was undone by an external write.
 * Opening a different vault must not write Life onto that vault;
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
