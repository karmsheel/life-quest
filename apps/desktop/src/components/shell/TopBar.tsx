import { useVault } from "@/state/VaultProvider";
import { DomainSwitcher } from "./DomainSwitcher";

export function TopBar() {
  const { snapshot } = useVault();

  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <span className="top-bar__vault-name">
          {snapshot?.lifequest.name ?? "LifeQuest"}
        </span>
      </div>
      <div className="top-bar__controls">
        <DomainSwitcher />
      </div>
    </header>
  );
}
