import { Link } from "react-router-dom";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { DOCUMENT_KIND_COACHING } from "@/lib/doctrine-copy";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

function rowHref(
  kind: DocumentKind,
  slug: string,
  howHref: "dream" | "track",
): string {
  if (kind === "how") {
    return howHref === "dream"
      ? `/dream/${slug}/how`
      : `/track/${slug}/how`;
  }
  return `/dream/${slug}/${kind}`;
}

export function DoctrineIndex({
  kinds,
  howHref = "track",
  layout = "list",
}: {
  kinds: DocumentKind[];
  howHref?: "dream" | "track";
  layout?: "list" | "cards";
}) {
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
          {layout === "cards" ? (
            <div className="doctrine-index__cards">
              {kinds.map((kind) => {
                const doc = domain.documents[kind];
                const body = doc?.bodyMarkdown ?? "";
                const empty = body.trim().length === 0;
                return (
                  <Link
                    key={kind}
                    to={rowHref(kind, domain.slug, howHref)}
                    className="doctrine-index__card"
                  >
                    <div className="doctrine-index__card-head">
                      <span className="doctrine-index__card-title">
                        {DOCUMENT_KIND_LABELS[kind]}
                      </span>
                      <DocumentStatusBadge status={doc?.status ?? "draft"} />
                    </div>
                    <div className="doctrine-index__card-body">
                      {empty ? (
                        <p className="doctrine-index__help muted">
                          {DOCUMENT_KIND_COACHING[kind]}
                        </p>
                      ) : (
                        <MarkdownView markdown={body} slug={domain.slug} />
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <ul className="doctrine-index__list">
              {kinds.map((kind) => {
                const doc = domain.documents[kind];
                return (
                  <li key={kind} className="doctrine-index__row">
                    <Link
                      to={rowHref(kind, domain.slug, howHref)}
                      className="doctrine-index__label"
                    >
                      {DOCUMENT_KIND_LABELS[kind]}
                    </Link>
                    <DocumentStatusBadge status={doc?.status ?? "draft"} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
