import { useMemo } from "react";
import { recordVisibleMulti, DOCUMENT_KIND_LABELS } from "@lifequest/vault-core/pure";
import type { DecisionRecord } from "@lifequest/vault-core";
import { Link } from "react-router-dom";
import { useDomainLens } from "@/components/shell/useActiveDomain";

export function PendingDecisionsCard({ decisions }: { decisions: DecisionRecord[] }) {
  const lens = useDomainLens();

  const pendingForDomain = useMemo(
    () => decisions.filter((d) => recordVisibleMulti(lens, d.domainSlugs)),
    [decisions, lens],
  );

  return (
    <section className="home-card">
      <h2 className="home-card__title">
        Pending decisions
        {pendingForDomain.length > 0 ? (
          <span className="home-card__count">{pendingForDomain.length}</span>
        ) : null}
      </h2>
      {pendingForDomain.length === 0 ? (
        <p className="muted home-card__empty">No pending proposals.</p>
      ) : (
        <ul className="home-mini-list">
          {pendingForDomain.slice(0, 4).map((d) => (
            <li key={d.id} className="home-mini-list__item">
              <Link to="/decisions" className="home-mini-list__link">
                {d.title}
              </Link>
              <span className="muted home-mini-list__meta">
                {d.target.type === "doctrine"
                  ? DOCUMENT_KIND_LABELS[(d.target as { kind: string }).kind as keyof typeof DOCUMENT_KIND_LABELS]
                  : d.proposedTitle ?? d.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/decisions" className="home-card__more">
        Open inbox →
      </Link>
    </section>
  );
}
