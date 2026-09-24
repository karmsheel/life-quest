import { useMemo } from "react";
import { DOCUMENT_KIND_LABELS, filterByLens } from "@lifequest/vault-core/pure";
import { Link } from "react-router-dom";
import { useVault } from "@/state/VaultProvider";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";
import type { DomainLens } from "@lifequest/vault-core/pure";

const DOCTRINE_ROWS = (["premise", "what", "why", "how"] as const).map((kind) => ({
  kind,
  label: DOCUMENT_KIND_LABELS[kind],
}));

function doctrineHref(kind: string, slug: string): string {
  if (kind === "how") return `/track/${slug}/how`;
  return `/dream/${slug}/${kind}`;
}

export function DoctrineCard() {
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const visibleDomains = useMemo(() => {
    return (snapshot?.domains ?? [])
      .filter((d) => !d.meta.archivedAt && filterByLens([{ domainSlug: d.slug } as never], lens).length > 0)
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot, lens]);

  // Recompute filterByLens for domain records
  const filteredDomains = useMemo(() => {
    return (snapshot?.domains ?? [])
      .filter((d) => {
        if (d.meta.archivedAt) return false;
        if (lens.kind === "overview") return true;
        return d.slug === lens.slug;
      })
      .slice()
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  }, [snapshot, lens]);

  return (
    <section className="home-card home-card--doctrine">
      <h2 className="home-card__title">Doctrine</h2>
      {filteredDomains.length === 0 ? (
        <p className="muted home-card__empty">No live domains yet.</p>
      ) : (
        <ul className="home-doctrine-list">
          {filteredDomains.flatMap((domain) =>
            DOCTRINE_ROWS.map((row) => {
              const doc = domain.documents[row.kind];
              const chars = doc?.bodyMarkdown.trim().length ?? 0;
              const label =
                filteredDomains.length > 1
                  ? `${domain.meta.name} · ${row.label}`
                  : row.label;
              return (
                <li key={`${domain.slug}-${row.kind}`} className="home-doctrine-row">
                  <Link
                    to={doctrineHref(row.kind, domain.slug)}
                    className="home-doctrine-row__main"
                  >
                    <span className="home-doctrine-row__label">{label}</span>
                    <span className="home-doctrine-row__meta muted">
                      {chars > 0 ? `${chars} chars` : "empty body"}
                    </span>
                  </Link>
                  <DocumentLockBadge locked={doc?.locked ?? false} />
                </li>
              );
            }),
          )}
        </ul>
      )}
      <Link to="/dream" className="home-card__more">
        View documents →
      </Link>
    </section>
  );
}
