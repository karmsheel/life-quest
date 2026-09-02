import { Link } from "react-router-dom";
import { type DocumentKind } from "@lifequest/vault-core/pure";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

const KIND_LABELS: Record<DocumentKind, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

function rowHref(kind: DocumentKind, slug: string): string {
  if (kind === "how") return `/track/${slug}/how`;
  return `/dream/${slug}/${kind}`;
}

export function DoctrineIndex({ kinds }: { kinds: DocumentKind[] }) {
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const domains = (snapshot?.domains ?? [])
    .filter((d) => !d.meta.archivedAt)
    .filter((d) => (lens.kind === "domain" ? d.slug === lens.slug : true))
    .slice()
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);

  if (domains.length === 0) {
    return <p className="muted">No live domains yet.</p>;
  }

  return (
    <div className="doctrine-index">
      {domains.map((domain) => (
        <section key={domain.slug} className="doctrine-index__group">
          <h2 className="doctrine-index__heading">{domain.meta.name}</h2>
          <ul className="doctrine-index__list">
            {kinds.map((kind) => {
              const doc = domain.documents[kind];
              const label = KIND_LABELS[kind];
              return (
                <li key={kind} className="doctrine-index__row">
                  <Link
                    to={rowHref(kind, domain.slug)}
                    className="doctrine-index__label"
                  >
                    {label}
                  </Link>
                  <DocumentStatusBadge status={doc?.status ?? "draft"} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
