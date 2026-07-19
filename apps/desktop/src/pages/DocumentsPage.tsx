import { Link } from "react-router-dom";
import type { DocumentKind } from "@lifequest/vault-core";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useActiveDomain } from "@/components/shell/useActiveDomain";

const DOC_CARDS: {
  kind: DocumentKind;
  label: string;
  room: string;
  href: string;
  description: string;
}[] = [
  {
    kind: "why",
    label: "Why",
    room: "Dream",
    href: "/dream",
    description: "Why pursue growth in this domain?",
  },
  {
    kind: "what",
    label: "What",
    room: "Chart",
    href: "/chart",
    description: "What is your North Star for this domain?",
  },
  {
    kind: "how",
    label: "How",
    room: "Track",
    href: "/track",
    description: "Strategy, tactics, and habits.",
  },
];

export default function DocumentsPage() {
  const activeDomain = useActiveDomain();

  return (
    <div className="documents-page">
      <header className="documents-page__header">
        <h1 className="stub-page__title">Documents</h1>
        <p className="stub-page__desc muted">
          Canonical Why / What / How for{" "}
          {activeDomain?.meta.name ?? "the active domain"}. Open a card to edit
          in its room.
        </p>
      </header>

      {!activeDomain ? (
        <p className="muted">Select or create a domain to view documents.</p>
      ) : (
        <div className="doc-cards">
          {DOC_CARDS.map((card) => {
            const doc = activeDomain.documents[card.kind];
            const status = doc?.status ?? "draft";
            const bodyLength = doc?.bodyMarkdown.trim().length ?? 0;
            return (
              <Link key={card.kind} to={card.href} className="doc-card">
                <div className="doc-card__top">
                  <span className="doc-card__label">{card.label}</span>
                  <DocumentStatusBadge status={status} />
                </div>
                <p className="doc-card__desc muted">{card.description}</p>
                <div className="doc-card__meta">
                  <span className="doc-card__room">{card.room}</span>
                  <span className="muted">
                    {bodyLength > 0 ? `${bodyLength} chars` : "empty body"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
