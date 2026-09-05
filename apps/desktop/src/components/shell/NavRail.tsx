import { NavLink } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { useWing } from "./WingProvider";

export function NavRail() {
  const { active } = useWing();

  const topPinned = NAV_ITEMS.filter((item) => item.pin === "top");
  const wingItems = NAV_ITEMS.filter((item) => item.wing === active);
  const bottomPinned = NAV_ITEMS.filter((item) => item.pin === "bottom");

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
      <div className="nav-rail__section">{topPinned.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section">{wingItems.map(renderItem)}</div>
      <div className="nav-rail__section nav-rail__section--bottom">
        <div className="nav-rail__divider" role="separator" />
        <div className="nav-rail__section">{bottomPinned.map(renderItem)}</div>
      </div>
    </nav>
  );
}
