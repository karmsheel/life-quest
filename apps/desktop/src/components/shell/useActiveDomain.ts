import { useMemo } from "react";
import type {
  DomainLens,
  DomainRecord,
  DoctrineDocument,
  DocumentKind,
  UnlockDoc,
} from "@lifequest/vault-core/pure";
import { DOCUMENT_KINDS, getUnlockedRooms } from "@lifequest/vault-core/pure";
import { useVault } from "@/state/VaultProvider";

export function useDomainLens(): DomainLens {
  const { lens } = useVault();
  return lens;
}

/** Live domain for a domain lens; null in Overview (no first-live fallback). */
export function useActiveDomain(): DomainRecord | null {
  const { snapshot, lens } = useVault();
  return useMemo(() => {
    if (!snapshot || lens.kind === "overview") return null;
    return (
      snapshot.domains.find(
        (d) => d.slug === lens.slug && !d.meta.archivedAt,
      ) ?? null
    );
  }, [snapshot, lens]);
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
