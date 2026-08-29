import { Link } from "react-router-dom";
import type { DocumentKind } from "@lifequest/vault-core/pure";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

export function DoctrineStrip({ kind }: { kind: DocumentKind }) {
  const domain = useActiveDomain();
  const doc = domain?.documents[kind];
  const label = kind === "what" ? "North Star" : "How";
  const body = doc?.bodyMarkdown.trim() ?? "";
  const preview = body ? body.slice(0, 180) : `No ${kind} yet.`;

  return (
    <aside className="doctrine-strip">
      <div className="doctrine-strip__head">
        <span className="doctrine-strip__label">
          {label}
          {domain ? ` · ${domain.meta.name}` : ""}
        </span>
        <DocumentStatusBadge status={doc?.status ?? "draft"} />
        <Link to="/documents" className="doctrine-strip__edit">
          Edit in Documents
        </Link>
      </div>
      <p className="doctrine-strip__preview muted">{preview}</p>
    </aside>
  );
}
