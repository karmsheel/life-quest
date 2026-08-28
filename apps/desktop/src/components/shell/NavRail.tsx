import { Lock } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { useActiveDomain, useUnlockedRooms } from "./useActiveDomain";

export function NavRail() {
  const unlockedRooms = useUnlockedRooms();
  const activeDomain = useActiveDomain();

  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const governance = NAV_ITEMS.filter((i) => i.section === "governance");

  function renderItem(item: NavItem) {
    const locked = Boolean(item.room && !unlockedRooms.has(item.room));
    const Icon = item.icon;

    return (
      <NavLink
        key={item.id}
        to={item.href}
        className={({ isActive }) =>
          [
            "nav-rail__link",
            isActive ? "nav-rail__link--active" : "",
            locked ? "nav-rail__link--locked" : "",
          ]
            .filter(Boolean)
            .join(" ")
        }
        title={
          locked
            ? `${item.label} (locked — fill prior pillar document)`
            : item.label
        }
        aria-disabled={locked || undefined}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
          {locked ? (
            <Lock size={10} className="nav-rail__lock" aria-hidden />
          ) : null}
        </span>
        <span className="nav-rail__label">{item.label}</span>
      </NavLink>
    );
  }

  return (
    <nav className="nav-rail" aria-label="Main">
      <NavLink
        to="/home"
        className="nav-rail__brand"
        title={
          activeDomain
            ? `LifeQuest — active: ${activeDomain.meta.name}`
            : "LifeQuest"
        }
      >
        <span className="nav-rail__logo" aria-hidden>
          LQ
        </span>
        <span className="nav-rail__brand-text">LifeQuest</span>
      </NavLink>

      <div className="nav-rail__section">{main.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section">{governance.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section nav-rail__section--bottom">
        <div className="nav-rail__settings-wrap">
          <NavThemeModeToggle />
          <SettingsMenu className="nav-rail__settings" placement="right-end" />
        </div>
      </div>
    </nav>
  );
}
