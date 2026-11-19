import { PanelLeftClose } from "lucide-react";
import { useNavDock } from "@/state/NavDockProvider";
import { LifeQuestEmblem } from "@/components/brand/LifeQuestEmblem";

/**
 * The control at the top of the sidebar, at either width. Collapsing narrows the
 * rail to its icon column but never removes it, so this control stays where the
 * operator left it: wide, it is the collapse chevron at the strip's trailing end;
 * thin, it becomes the brand's Q emblem — the pure mark, no wordmark — and a
 * press reopens the rail. That is the DSH arrangement: the icon column keeps the
 * studio's mark where the toggle was, rather than a chevron pointing at a word
 * the column cannot hold.
 *
 * There is no second copy in the titlebar — the old one landed on top of the
 * vault chip once the column went away.
 *
 * `no-drag` because the header sits inside the window's drag band: without the
 * carve-out the region swallows the click on Windows and the button never fires.
 */
export function NavCollapseButton({ className }: { className?: string }) {
  const { collapsed, toggle } = useNavDock();
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <button
      type="button"
      className={["nav-toggle", className].filter(Boolean).join(" ")}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="nav-rail"
      data-nav-toggle={collapsed ? "brand" : "chevron"}
      onClick={toggle}
    >
      {collapsed ? (
        <LifeQuestEmblem className="nav-toggle__brand" />
      ) : (
        <PanelLeftClose size={16} aria-hidden />
      )}
    </button>
  );
}
