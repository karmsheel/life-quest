import { Navigate, useNavigate } from "react-router-dom";
import { useVault } from "@/state/VaultProvider";

export default function WelcomePage() {
  const navigate = useNavigate();
  const {
    createVault,
    openVault,
    openRecent,
    recent,
    error,
    busy,
    clearError,
    snapshot,
  } = useVault();

  // Already open (e.g. refresh while vault loaded) → home
  if (snapshot) {
    return <Navigate to="/home" replace />;
  }

  async function handleCreate() {
    clearError();
    const ok = await createVault();
    if (ok) navigate("/home", { replace: true });
  }

  async function handleOpen() {
    clearError();
    const ok = await openVault();
    if (ok) navigate("/home", { replace: true });
  }

  async function handleRecent(path: string) {
    clearError();
    const ok = await openRecent(path);
    if (ok) navigate("/home", { replace: true });
  }

  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>LifeQuest</h1>
        <p className="muted welcome-lead">
          Your local vault is your identity. Create a new vault or open an
          existing one to continue.
        </p>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleCreate()}
          >
            Create vault
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void handleOpen()}
          >
            Open vault
          </button>
        </div>

        {error ? (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="welcome-recent" aria-label="Recent vaults">
          <h2>Recent vaults</h2>
          {recent.length === 0 ? (
            <p className="muted">No recent vaults yet.</p>
          ) : (
            <ul className="recent-list">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="recent-item"
                    disabled={busy}
                    onClick={() => void handleRecent(entry.path)}
                  >
                    <span className="recent-name">{entry.name}</span>
                    <span className="recent-path muted">{entry.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
