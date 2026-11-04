import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useNavDock } from "@/state/NavDockProvider";

/**
 * The one icon at the top of the sidebar, at either width. Collapsing narrows the
 * rail to its icon column but never removes it, so this control stays where the
 * operator left it and simply turns around: collapse while the rail is wide,
 * expand while it is thin. There is no second copy in the titlebar — the old one
 * landed on top of the vault chip once the column went away.
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
      onClick={toggle}
    >
      {collapsed ? (
        <PanelLeftOpen size={16} aria-hidden />
      ) : (
        <PanelLeftClose size={16} aria-hidden />
      )}
    </button>
  );
}
