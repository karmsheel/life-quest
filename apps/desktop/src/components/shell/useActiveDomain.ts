import { useMemo } from "react";
import type {
  DomainRecord,
  DoctrineDocument,
  DocumentKind,
  UnlockDoc,
} from "@lifequest/vault-core/pure";
import { DOCUMENT_KINDS, getUnlockedRooms } from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";

/** Active domain from snapshot + activeSlug (falls back to first non-archived). */
export function useActiveDomain(): DomainRecord | null {
  const { snapshot, activeSlug } = useVault();
  return useMemo(() => {
    if (!snapshot) return null;
    const live = snapshot.domains.filter((d) => !d.meta.archivedAt);
    if (activeSlug) {
      const match = live.find((d) => d.slug === activeSlug);
      if (match) return match;
    }
    return live[0] ?? null;
  }, [snapshot, activeSlug]);
}

export function documentsToUnlockDocs(
  documents: Record<DocumentKind, DoctrineDocument> | undefined,
): UnlockDoc[] {
  if (!documents) return [];
  return DOCUMENT_KINDS.map((kind) => ({
    kind,
    bodyMarkdown: documents[kind]?.bodyMarkdown ?? "",
  }));
}

export function useUnlockedRooms(): Set<import("@lifequest/vault-core/pure").RoomId> {
  const { snapshot } = useVault();
  return useMemo(() => {
    const domains = (snapshot?.domains ?? []).map((d) => ({
      archivedAt: d.meta.archivedAt,
      documents: documentsToUnlockDocs(d.documents),
    }));
    return getUnlockedRooms(domains);
  }, [snapshot]);
}

export function useUnlockDomains() {
  const { snapshot } = useVault();
  return useMemo(
    () =>
      (snapshot?.domains ?? []).map((d) => ({
        archivedAt: d.meta.archivedAt,
        documents: documentsToUnlockDocs(d.documents),
      })),
    [snapshot],
  );
}
