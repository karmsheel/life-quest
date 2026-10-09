import type { LucideIcon } from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsViewId } from "@/lib/settings-views";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsCompanionPrompts } from "./SettingsCompanionPrompts";
import { SettingsDomains } from "./SettingsDomains";
import { SettingsHermes } from "./SettingsHermes";
import { SettingsVault } from "./SettingsVault";
import { SettingsAbout } from "./SettingsAbout";

function SettingsNavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-nav-item${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={16} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function SettingsPanel({ view }: { view: SettingsViewId }) {
  switch (view) {
    case "appearance":
      return <SettingsAppearance />;
    case "domains":
      return <SettingsDomains />;
    case "vault":
      return <SettingsVault />;
    case "hermes":
      return <SettingsHermes />;
    case "agent":
      return <SettingsCompanionPrompts />;
    case "about":
      return <SettingsAbout />;
    default:
      return <SettingsAppearance />;
  }
}

export function SettingsContent({
  activeView,
  onViewChange,
}: {
  activeView: SettingsViewId;
  onViewChange: (view: SettingsViewId) => void;
}) {
  return (
    <div className="settings-overlay__layout settings-overlay__layout--split">
      <aside className="settings-overlay__nav" aria-label="Settings sections">
        <div className="settings-overlay__nav-header">
          <div className="settings-overlay__kicker">App</div>
          <h2 className="settings-overlay__nav-title">Settings</h2>
        </div>
        <nav className="settings-overlay__nav-list">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsNavItem
              key={section.id}
              active={activeView === section.id}
              icon={section.icon}
              label={section.label}
              onClick={() => onViewChange(section.id)}
            />
          ))}
        </nav>
      </aside>

      <div className="settings-overlay__mobile-nav">
        <SegmentedControl
          value={activeView}
          options={SETTINGS_SECTIONS.map((section) => ({
            value: section.id,
            label: section.label,
            icon: <section.icon size={14} />,
          }))}
          ariaLabel="Settings section"
          onChange={onViewChange}
        />
      </div>

      <main className="settings-overlay__main">
        <div className="settings-overlay__main-scroll">
          <SettingsPanel view={activeView} />
        </div>
      </main>
    </div>
  );
}
