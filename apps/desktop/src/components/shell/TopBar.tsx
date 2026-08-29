import { useVault } from "@/state/VaultProvider";
import { api } from "@/lib/ipc";
import { DomainSwitcher } from "./DomainSwitcher";

export function TopBar() {
  const { snapshot, refresh, busy } = useVault();
  const locked = snapshot?.map?.locked ?? false;
  const mapReady = Boolean(snapshot?.map);

  async function onLock(next: boolean) {
    const result = await api().mapApply({ type: "setLock", locked: next });
    if (!result.ok) return;
    await refresh();
  }

  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <span className="top-bar__vault-name">
          {snapshot?.lifequest.name ?? "LifeQuest"}
        </span>
      </div>
      <div className="top-bar__controls">
        <DomainSwitcher />
        <label className="lock-switch">
          <span className="lock-label">Agent locked</span>
          <input
            type="checkbox"
            role="switch"
            checked={locked}
            disabled={!mapReady || busy}
            onChange={(e) => void onLock(e.target.checked)}
          />
        </label>
      </div>
    </header>
  );
}
