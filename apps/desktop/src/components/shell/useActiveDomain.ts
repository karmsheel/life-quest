import { useEffect, useMemo, useState } from "react";
import type {
  DomainLens,
  DomainRecord,
  DoctrineDocument,
  DocumentKind,
  UnlockDoc,
} from "@lifequest/vault-core/pure";
import { DOCUMENT_KINDS, isAreaLive } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { useVault } from "@/state/VaultProvider";

export function useDomainLens(): DomainLens {
  const { lens } = useVault();
  return lens;
}

/**
 * Live area for an area lens; null on the Life lens (no first-live fallback).
 * A locked or archived area is not live, so the lens never resolves to one.
 */
export function useActiveDomain(): DomainRecord | null {
  const { snapshot, lens } = useVault();
  return useMemo(() => {
    if (!snapshot || lens.kind === "overview") return null;
    return (
      snapshot.domains.find((d) => d.slug === lens.slug && isAreaLive(d)) ??
      null
    );
  }, [snapshot, lens]);
}

/**
 * The board the operator has open, and its page lock.
 *
 * The lock lives on the board file, not in the vault snapshot, so it is read
 * over the bridge and re-read whenever the lens or the vault changes. HomePage
 * already reads the whole board and passes its own copy in; the chat panel needs
 * the same fact to tell the companion whether a change will land or become a
 * Decision, and reading it here keeps the two from drifting.
 */
export function useDashboardBoard(): { slug: string | null; locked: boolean } {
  const { lens, reloadGeneration } = useVault();
  const slug = lens.kind === "domain" ? lens.slug : null;
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api().pinsList(slug);
        if (!cancelled) setLocked(res.ok ? res.value.locked : false);
      } catch {
        if (!cancelled) setLocked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, reloadGeneration]);

  return { slug, locked };
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
