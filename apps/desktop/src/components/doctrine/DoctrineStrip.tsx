import { Link } from "react-router-dom";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";
import { DocumentLockBadge } from "@/components/documents/DocumentLockBadge";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

export function DoctrineStrip({ kind }: { kind: DocumentKind }) {
  const domain = useActiveDomain();
  if (!domain) return null;
  const doc = domain.documents[kind];
  const label = DOCUMENT_KIND_LABELS[kind];
  const body = doc?.bodyMarkdown.trim() ?? "";
  const preview = body ? body.slice(0, 180) : `No ${label} yet.`;
  const editTo =
    kind === "what"
      ? `/dream/${domain.slug}/what`
      : `/track/${domain.slug}/how`;

  return (
    <aside className="doctrine-strip">
      <div className="doctrine-strip__head">
        <span className="doctrine-strip__label">
          {label}
          {` · ${domain.meta.name}`}
        </span>
        <DocumentLockBadge locked={doc?.locked ?? false} />
        <Link to={editTo} className="doctrine-strip__edit">
          Edit
        </Link>
      </div>
      <p className="doctrine-strip__preview muted">{preview}</p>
    </aside>
  );
}
