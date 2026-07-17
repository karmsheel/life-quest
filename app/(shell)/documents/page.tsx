"use client";

import { StubPage } from "@/components/shell/StubPage";
import { useShell } from "@/components/shell/ShellProvider";

export default function DocumentsPage() {
  const { documents, activeDomain } = useShell();

  return (
    <StubPage
      title="Documents"
      description={`Canonical Why / What / How for ${activeDomain?.name ?? "the active domain"}. Editors land in Task 9.`}
    >
      <ul className="doc-summary">
        {documents.length === 0 ? (
          <li className="muted">No documents loaded yet.</li>
        ) : (
          documents.map((doc) => (
            <li key={doc.kind} className="doc-summary__item">
              <strong className="doc-summary__kind">{doc.kind}</strong>
              <span className="doc-summary__status">{doc.status}</span>
              <span className="muted">
                {doc.bodyLength > 0
                  ? `${doc.bodyLength} chars`
                  : "empty body"}
              </span>
            </li>
          ))
        )}
      </ul>
    </StubPage>
  );
}
