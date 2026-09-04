import { NavLink } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { useActiveDomain } from "./useActiveDomain";
import { useWing } from "./WingProvider";

export function NavRail() {
  const activeDomain = useActiveDomain();
  const { active } = useWing();

  const wingItems = NAV_ITEMS.filter((item) => item.wing === active);
  const pinned = NAV_ITEMS.filter((item) => !item.wing);

  function renderItem(item: NavItem) {
    const Icon = item.icon;

    return (
      <NavLink
        key={item.id}
        to={item.href}
        className={({ isActive }) =>
          ["nav-rail__link", isActive ? "nav-rail__link--active" : ""]
            .filter(Boolean)
            .join(" ")
        }
        title={item.label}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
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

      <div className="nav-rail__section">{wingItems.map(renderItem)}</div>
      <div className="nav-rail__section nav-rail__section--bottom">
        <div className="nav-rail__divider" role="separator" />
        <div className="nav-rail__section">{pinned.map(renderItem)}</div>
      </div>
    </nav>
  );
}
