import { Building2 } from "lucide-react";
import { useVault } from "@/state/VaultProvider";

export function SettingsVault() {
  const { snapshot } = useVault();

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const { lifequest, rootPath } = snapshot;

  return (
    <section>
      <div className="settings-panel__heading">
        <div className="settings-panel__icon">
          <Building2 size={16} />
        </div>
        <div>
          <h2 className="settings-panel__title">Vault</h2>
          <p className="settings-panel__subtitle">Identity and location on disk</p>
        </div>
      </div>

      <div className="settings-card">
        <dl className="settings-vault">
          <div>
            <dt className="muted">Name</dt>
            <dd>{lifequest.name}</dd>
          </div>
          <div>
            <dt className="muted">Id</dt>
            <dd className="settings-vault__mono">{lifequest.id}</dd>
          </div>
          <div>
            <dt className="muted">Path</dt>
            <dd className="settings-vault__mono">{rootPath}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
