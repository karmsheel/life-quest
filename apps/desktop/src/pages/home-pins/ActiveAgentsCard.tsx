import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useVault } from "@/state/VaultProvider";

export function ActiveAgentsCard() {
  const { snapshot } = useVault();

  const activeAgents = useMemo(
    () => (snapshot?.agents ?? []).filter((a) => a.status === "active"),
    [snapshot],
  );

  return (
    <section className="home-card">
      <h2 className="home-card__title">
        Active agents
        {activeAgents.length > 0 ? (
          <span className="home-card__count">{activeAgents.length}</span>
        ) : null}
      </h2>
      {activeAgents.length === 0 ? (
        <p className="muted home-card__empty">
          No active agents. Scan Hermes and hire agents in Personnel.
        </p>
      ) : (
        <ul className="home-mini-list">
          {activeAgents.slice(0, 4).map((a) => (
            <li key={a.id} className="home-mini-list__item">
              <span className="home-mini-list__link">{a.name}</span>
              {a.roleLabel ? (
                <span className="muted home-mini-list__meta">{a.roleLabel}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link to="/personnel" className="home-card__more">
        Open Personnel →
      </Link>
    </section>
  );
}
