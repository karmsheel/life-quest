import { Building2 } from "lucide-react";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useVault } from "@/state/VaultProvider";

export function SettingsVault() {
  const { snapshot } = useVault();

  if (!snapshot) {
    return <p className="muted">No vault open.</p>;
  }

  const { lifequest, rootPath } = snapshot;

  return (
    <SettingsSection
      icon={<Building2 size={16} />}
      title="Vault"
      subtitle="Identity and location on disk"
    >
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
    </SettingsSection>
  );
}
