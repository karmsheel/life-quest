import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { recordVisibleMulti } from "@lifequest/vault-core/pure";
import { version } from "../../../package.json";
import { useVault } from "@/state/VaultProvider";
import { NAV_ITEMS, type NavItem } from "./nav-items";
import { useDomainLens } from "./useActiveDomain";
import { useWing } from "./WingProvider";

export function NavRail() {
  const { active } = useWing();
  const { snapshot } = useVault();
  const lens = useDomainLens();

  const pendingCount = useMemo(() => {
    const decisions = snapshot?.decisions ?? [];
    return decisions.filter((decision) => {
      if (decision.status !== "pending") return false;
      const slugs = Array.isArray(decision.domainSlugs) ? decision.domainSlugs : [];
      return recordVisibleMulti(lens, slugs);
    }).length;
  }, [snapshot, lens]);

  const topPinned = NAV_ITEMS.filter((item) => item.pin === "top");
  const wingItems = NAV_ITEMS.filter((item) => item.wing === active);
  const bottomPinned = NAV_ITEMS.filter((item) => item.pin === "bottom");

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    const count = item.id === "decisions" ? pendingCount : 0;
    const name = count > 0 ? `${item.label}, ${count} pending` : item.label;

    return (
      <NavLink
        key={item.id}
        to={item.href}
        className={({ isActive }) =>
          ["nav-rail__link", isActive ? "nav-rail__link--active" : ""]
            .filter(Boolean)
            .join(" ")
        }
        title={name}
        aria-label={name}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
          {count > 0 ? (
            <span className="nav-rail__badge" aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
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
        <p className="nav-rail__version">v{version}</p>
      </div>
    </nav>
  );
}
