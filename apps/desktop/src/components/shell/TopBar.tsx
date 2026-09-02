import { DomainSwitcher } from "./DomainSwitcher";
import { WingTabs } from "./WingTabs";

export function TopBar() {
  return (
    <header className="top-bar">
      <WingTabs />
      <div className="top-bar__controls">
        <DomainSwitcher />
      </div>
    </header>
  );
}
