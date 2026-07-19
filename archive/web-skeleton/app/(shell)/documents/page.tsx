"use client";

import Link from "next/link";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useShell } from "@/components/shell/ShellProvider";
import type { DocumentKind } from "@/lib/document-kinds.ts";

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
  const { documents, activeDomain, loading } = useShell();

  function summaryFor(kind: DocumentKind) {
    return documents.find((d) => d.kind === kind);
  }

  return (
    <div className="documents-page">
      <header className="documents-page__header">
        <h1 className="stub-page__title">Documents</h1>
        <p className="stub-page__desc muted">
          Canonical Why / What / How for{" "}
          {activeDomain?.name ?? "the active domain"}. Open a card to edit in
          its room.
        </p>
      </header>

      {loading ? (
        <p className="muted">Loading documents…</p>
      ) : (
        <div className="doc-cards">
          {DOC_CARDS.map((card) => {
            const summary = summaryFor(card.kind);
            const status = summary?.status ?? "draft";
            const bodyLength = summary?.bodyLength ?? 0;
            return (
              <Link
                key={card.kind}
                href={card.href}
                className="doc-card"
              >
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
