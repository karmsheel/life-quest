import { Link, useParams } from "react-router-dom";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  type DocumentKind,
} from "@lifequest/vault-core/pure";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useVault } from "@/state/VaultProvider";

function isKind(value: string | undefined): value is DocumentKind {
  return DOCUMENT_KINDS.includes(value as DocumentKind);
}

export function DoctrineEditorPage({ backTo }: { backTo: string }) {
  const { slug, kind } = useParams();
  const { snapshot } = useVault();
  const domain = snapshot?.domains.find(
    (d) => d.slug === slug && !d.meta.archivedAt,
  );
  if (!slug || !isKind(kind) || !domain) {
    return (
      <p className="muted">
        Document not found. <Link to={backTo}>Back</Link>
      </p>
    );
  }
  return (
    <div>
      <p>
        <Link to={backTo}>Back</Link>
        {" · "}
        {domain.meta.name} · {DOCUMENT_KIND_LABELS[kind]}
      </p>
      <DocumentEditor kind={kind} slug={slug} />
    </div>
  );
}
