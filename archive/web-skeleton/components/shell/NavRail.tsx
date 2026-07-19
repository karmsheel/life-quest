"use client";

import { Lock } from "lucide-react";
import { usePathname } from "next/navigation";
import { MouseEvent } from "react";
import { useShell } from "./ShellProvider";
import { useTabs } from "./TabProvider";
import { NAV_ITEMS, type NavItem } from "./nav-items.ts";

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavRail() {
  const pathname = usePathname() || "/home";
  const { unlockedRooms, activeDomain } = useShell();
  const { openTab, navigateInActive } = useTabs();

  function onNavClick(e: MouseEvent<HTMLAnchorElement>, item: NavItem) {
    if (item.room && !unlockedRooms.has(item.room)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    const newTab = e.metaKey || e.ctrlKey;
    if (newTab) {
      openTab(item.href, { title: item.label });
    } else {
      navigateInActive(item.href, item.label);
    }
  }

  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const governance = NAV_ITEMS.filter((i) => i.section === "governance");
  const account = NAV_ITEMS.filter((i) => i.section === "account");

  function renderItem(item: NavItem) {
    const locked = Boolean(item.room && !unlockedRooms.has(item.room));
    const active = isActivePath(pathname, item.href);
    const Icon = item.icon;
    const className = [
      "nav-rail__link",
      active ? "nav-rail__link--active" : "",
      locked ? "nav-rail__link--locked" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <a
        key={item.id}
        href={item.href}
        className={className}
        title={
          locked
            ? `${item.label} (locked — fill prior pillar document)`
            : item.label
        }
        aria-current={active ? "page" : undefined}
        aria-disabled={locked || undefined}
        onClick={(e) => onNavClick(e, item)}
      >
        <span className="nav-rail__icon-wrap">
          <Icon size={18} aria-hidden />
          {locked ? (
            <Lock size={10} className="nav-rail__lock" aria-hidden />
          ) : null}
        </span>
        <span className="nav-rail__label">{item.label}</span>
      </a>
    );
  }

  return (
    <nav className="nav-rail" aria-label="Main">
      <a
        href="/domains"
        className="nav-rail__brand"
        title={
          activeDomain
            ? `Domains — active: ${activeDomain.name}`
            : "Domains"
        }
        onClick={(e) => {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            openTab("/domains", { title: "Domains" });
          } else {
            navigateInActive("/domains", "Domains");
          }
        }}
      >
        <span className="nav-rail__logo" aria-hidden>
          LQ
        </span>
        <span className="nav-rail__brand-text">LifeQuest</span>
      </a>

      <div className="nav-rail__section">{main.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section">{governance.map(renderItem)}</div>
      <div className="nav-rail__divider" role="separator" />
      <div className="nav-rail__section nav-rail__section--bottom">
        {account.map(renderItem)}
      </div>
    </nav>
  );
}
