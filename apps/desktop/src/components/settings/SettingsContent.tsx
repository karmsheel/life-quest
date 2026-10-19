import { useCallback, useEffect, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsViewId,
} from "@/lib/settings-views";
import { normalizeSettingsQuery, searchSettingsSections } from "@/lib/settings-search";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsCompanionPrompts } from "./SettingsCompanionPrompts";
import { SettingsDomains } from "./SettingsDomains";
import { SettingsHermes } from "./SettingsHermes";
import { SettingsVault } from "./SettingsVault";
import { SettingsUpdates } from "./SettingsUpdates";
import { SettingsDeveloper } from "./SettingsDeveloper";
import { SettingsAbout } from "./SettingsAbout";

function SettingsNavItem({
  active,
  icon: Icon,
  label,
  matched,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  /**
   * What the search matched beyond the label — the word that made this row
   * appear, which the row's own label does not show.
   */
  matched?: string;
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
      <span className="settings-nav-item__label">{label}</span>
      {matched ? <span className="settings-nav-item__match">{matched}</span> : null}
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
    case "updates":
      return <SettingsUpdates />;
    case "about":
      return <SettingsAbout />;
    case "developer":
      return <SettingsDeveloper />;
    default:
      return <SettingsAppearance />;
  }
}

/** The words of a section's own haystack that a query landed on. */
function matchedWords(section: SettingsSection, query: string): string | null {
  const words = normalizeSettingsQuery(query).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const label = section.label.toLowerCase();
  const hit = words.find(
    (word) => word.length > 2 && !label.includes(word),
  );
  return hit ?? null;
}

export function SettingsContent({
  activeView,
  onViewChange,
  query = "",
}: {
  activeView: SettingsViewId;
  onViewChange: (view: SettingsViewId) => void;
  /** The overlay's search bar; empty means "every section". */
  query?: string;
}) {
  const searching = normalizeSettingsQuery(query).length > 0;
  const matches = useMemo(() => searchSettingsSections(query), [query]);
  const sections = searching ? matches : SETTINGS_SECTIONS;

  /**
   * A search that leaves the open page behind lands on the page it found. The
   * alternative — filtering the list while the panel still shows something the
   * operator can no longer see in it — is a sheet with an invisible subject.
   */
  const jumpToFirstMatch = useCallback(() => {
    if (!searching || matches.length === 0) return;
    if (matches.some((section) => section.id === activeView)) return;
    onViewChange(matches[0].id);
  }, [activeView, matches, onViewChange, searching]);

  useEffect(() => {
    jumpToFirstMatch();
  }, [jumpToFirstMatch]);

  return (
    <div className="settings-overlay__layout settings-overlay__layout--split">
      <aside className="settings-overlay__nav" aria-label="Settings sections">
        <div className="settings-overlay__nav-header">
          <div className="settings-overlay__kicker">App</div>
          <h2 className="settings-overlay__nav-title">Settings</h2>
        </div>
        <nav className="settings-overlay__nav-list">
          {sections.map((section) => (
            <SettingsNavItem
              key={section.id}
              active={activeView === section.id}
              icon={section.icon}
              label={section.label}
              matched={
                searching ? (matchedWords(section, query) ?? undefined) : undefined
              }
              onClick={() => onViewChange(section.id)}
            />
          ))}
          {searching && sections.length === 0 ? (
            <p className="settings-overlay__nav-empty" role="status">
              No settings match “{query.trim()}”.
            </p>
          ) : null}
        </nav>
      </aside>

      <div className="settings-overlay__mobile-nav">
        <SegmentedControl
          value={activeView}
          options={sections.map((section) => ({
            value: section.id,
            label: section.label,
            icon: <section.icon size={14} />,
          }))}
          ariaLabel="Settings section"
          onChange={onViewChange}
        />
      </div>

      <main className="settings-overlay__main" data-settings-view={activeView}>
        <div className="settings-overlay__main-scroll">
          <SettingsPanel view={activeView} />
        </div>
      </main>
    </div>
  );
}
