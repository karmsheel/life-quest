import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";
import { MarkdownView } from "@/components/documents/MarkdownView";
import { DOCUMENT_KIND_COACHING } from "@/lib/doctrine-copy";
import { useDomainLens } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

/**
 * Which page owns a doctrine document's editor. One page per wing surface:
 * Dream carries Premise / Purpose / Strategy, Vision carries Vision & Desire,
 * and Architecture carries Strategy (How) for the Plan wing.
 */
export type DoctrineBasePath = "/dream" | "/vision" | "/track";

function rowHref(kind: DocumentKind, slug: string, basePath: DoctrineBasePath): string {
  return `${basePath}/${slug}/${kind}`;
}

export function DoctrineIndex({
  kinds,
  basePath = "/track",
  layout = "list",
}: {
  kinds: DocumentKind[];
  basePath?: DoctrineBasePath;
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
            <div
              className="doctrine-index__cards"
              /*
                The grid is as wide as the page has cards: Dream carries three,
                Vision one. The count rides a custom property so the narrow-width
                rules in the stylesheet still outrank it.
              */
              style={{ "--doctrine-cols": kinds.length } as CSSProperties}
            >
              {kinds.map((kind) => {
                const doc = domain.documents[kind];
                const body = doc?.bodyMarkdown ?? "";
                const empty = body.trim().length === 0;
                return (
                  <Link
                    key={kind}
                    to={rowHref(kind, domain.slug, basePath)}
                    className="doctrine-index__card"
                  >
                    <div className="doctrine-index__card-head">
                      <span className="doctrine-index__card-title">
                        {DOCUMENT_KIND_LABELS[kind]}
                      </span>
                      <DocumentLockBadge locked={doc?.locked ?? false} />
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
                      to={rowHref(kind, domain.slug, basePath)}
                      className="doctrine-index__label"
                    >
                      {DOCUMENT_KIND_LABELS[kind]}
                    </Link>
                    <DocumentLockBadge locked={doc?.locked ?? false} />
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
