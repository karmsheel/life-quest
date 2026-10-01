import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useNavDock } from "@/state/NavDockProvider";

/**
 * The one icon at the top of the sidebar — and, once the rail is collapsed, the
 * same icon at the leading edge of the titlebar. Both ends of the toggle share
 * this component so the icon, label and state cannot disagree.
 *
 * `no-drag` because both placements overlap the window's drag band: without the
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
