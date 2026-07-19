import { Link } from "react-router-dom";
import { RoomLockGate } from "@/components/shell/RoomLockGate";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

function ActContent() {
  const { snapshot } = useVault();
  const activeDomain = useActiveDomain();
  const agents =
    snapshot?.agents.filter((a) => a.status === "active") ?? [];

  return (
    <div className="act-page">
      <header>
        <h1 className="stub-page__title">Act</h1>
        <p className="stub-page__desc muted">
          Agents run your How. Hire Hermes agents in Personnel and keep doctrine
          forged so execution stays aligned with Why → What → How
          {activeDomain ? ` for ${activeDomain.meta.name}` : ""}.
        </p>
      </header>

      <section className="act-page__section">
        <div className="act-page__section-head">
          <h2 className="act-page__section-title">Active agents</h2>
          <Link to="/personnel" className="btn btn-primary">
            Open Personnel
          </Link>
        </div>

        {agents.length === 0 ? (
          <div className="act-page__empty">
            <p className="muted">
              No active agents yet. Scan Hermes and hire agents from Personnel.
            </p>
            <Link to="/personnel" className="act-page__link">
              Go to Personnel →
            </Link>
          </div>
        ) : (
          <ul className="act-page__hire-list">
            {agents.map((h) => (
              <li key={h.id} className="act-hire">
                <strong className="act-hire__name">{h.name}</strong>
                {h.roleLabel ? (
                  <span className="muted"> · {h.roleLabel}</span>
                ) : null}
                <p className="muted act-hire__meta">
                  {h.hermesAgentId}
                  {h.domainSlug ? ` · ${h.domainSlug}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ActPage() {
  return (
    <RoomLockGate room="act">
      <ActContent />
    </RoomLockGate>
  );
}
