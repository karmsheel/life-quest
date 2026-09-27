import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@lifequest/vault-core/pure";

const KINDS: readonly DocumentKind[] = ["premise", "what", "why", "how"];

const KIND_ALIASES: Record<string, DocumentKind> = (() => {
  const map: Record<string, DocumentKind> = {};
  for (const kind of KINDS) {
    map[kind.toLowerCase()] = kind;
    map[DOCUMENT_KIND_LABELS[kind].toLowerCase()] = kind;
  }
  return map;
})();

/** A resolved wiki target. `data` carries the extras the renderer needs. */
export type WikiLink = {
  href: string;
  /** `library` links are handled in the page, not by the hash router. */
  kind: "doctrine" | "library";
  libraryId?: string;
};

export type WikiDomain = {
  slug: string;
  meta: { name: string; archivedAt: string | null };
};

export type WikiNote = { id: string; title: string };

export type WikiResolver = (target: string) => WikiLink | null;

function doctrineLink(slug: string, kind: DocumentKind): WikiLink {
  const href =
    kind === "how"
      ? `#/track/${slug}/how`
      : `#/dream/${slug}/${kind}`;
  return { href, kind: "doctrine" };
}

/** `slug/kind` or `Domain name/Doctrine label`, matched case-insensitively. */
function resolveDoctrine(
  target: string,
  domains: readonly WikiDomain[],
): WikiLink | null {
  const slash = target.indexOf("/");
  if (slash <= 0) return null;
  const domainKey = target.slice(0, slash).trim().toLowerCase();
  const kindKey = target.slice(slash + 1).trim().toLowerCase();
  const kind = KIND_ALIASES[kindKey];
  if (!kind) return null;
  const domain = domains.find(
    (d) =>
      !d.meta.archivedAt &&
      (d.slug.toLowerCase() === domainKey ||
        d.meta.name.toLowerCase() === domainKey),
  );
  return domain ? doctrineLink(domain.slug, kind) : null;
}

export function createWikiResolver(input: {
  domains: readonly WikiDomain[];
  notes: readonly WikiNote[];
}): WikiResolver {
  const { domains, notes } = input;
  return (target) => {
    const trimmed = target.trim();
    if (!trimmed) return null;

    const doctrine = resolveDoctrine(trimmed, domains);
    if (doctrine) return doctrine;

    const needle = trimmed.toLowerCase();
    const matches = notes.filter(
      (n) => n.title.trim().toLowerCase() === needle,
    );
    if (matches.length !== 1) return null;
    return {
      href: "#/documents",
      kind: "library",
      libraryId: matches[0]!.id,
    };
  };
}
