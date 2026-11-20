import { PanelLeftClose } from "lucide-react";
import { useNavDock } from "@/state/NavDockProvider";
import { LifeQuestEmblem } from "@/components/brand/LifeQuestEmblem";

/**
 * The sidebar's collapse control, at the foot of the rail, at either width.
 *
 * It used to close the header row at the rail's top, opposite the lockup. It now
 * sits at the trailing end of the rail's foot, level with the Log and the vault
 * chip — the last control in the column, where the sidebar ends. Collapsing
 * narrows the rail to its icon column but never removes it, so this control stays
 * where the operator left it: wide, it is the collapse chevron at the foot's
 * trailing edge; thin, the foot stacks it under the vault's initials and it
 * becomes the brand's Q emblem — the pure mark, no wordmark — and a press reopens
 * the rail.
 *
 * There is no second copy in the titlebar — the old one landed on top of the
 * vault chip once the column went away.
 *
 * The shared `.nav-toggle` rule keeps its `no-drag` carve-out though the foot is
 * outside the window's drag band: the class is the sidebar control's, and a
 * placement that puts it back inside a drag region must not inherit the region's
 * hit-testing.
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
