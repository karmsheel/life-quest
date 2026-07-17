"use client";

import { StubPage } from "@/components/shell/StubPage";
import { useShell } from "@/components/shell/ShellProvider";

export default function DomainsPage() {
  const { domains, activeDomainId, activateDomain, loading } = useShell();

  return (
    <StubPage
      title="Domains"
      description="Manage life domains. Activate a domain to scope rooms, documents, and log context."
    >
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="domain-list">
          {domains.map((d) => {
            const active = d.id === activeDomainId;
            return (
              <li key={d.id} className="domain-list__item">
                <div>
                  <strong>{d.name}</strong>
                  {active ? (
                    <span className="domain-list__badge">Active</span>
                  ) : null}
                  {d.description ? (
                    <p className="muted domain-list__desc">{d.description}</p>
                  ) : null}
                </div>
                {!active ? (
                  <button
                    type="button"
                    className="domain-list__activate"
                    onClick={() => void activateDomain(d.id)}
                  >
                    Activate
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </StubPage>
  );
}
