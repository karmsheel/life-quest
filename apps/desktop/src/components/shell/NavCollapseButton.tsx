import { PanelLeftClose } from "lucide-react";
import { useNavDock } from "@/state/NavDockProvider";
import { LifeQuestEmblem } from "@/components/brand/LifeQuestEmblem";
import { LifeQuestLogo } from "@/components/brand/LifeQuestLogo";
import { useLogoVariant } from "@/components/brand/useLogoVariant";

/**
 * The state and copy the rail's two collapse controls share.
 *
 * The rail has two ways to collapse: the lockup at the top of the header and the
 * square control at the foot. Both do the same thing and both must announce the
 * same thing, so the collapsed flag, the verb and the toggle come from one place
 * rather than being restated twice and drifting.
 */
function useCollapseControl() {
  const { collapsed, toggle } = useNavDock();
  return {
    collapsed,
    toggle,
    label: collapsed ? "Expand sidebar" : "Collapse sidebar",
  };
}

/**
 * The sidebar's foot control, at the trailing end of the rail's foot at either
 * width.
 *
 * It used to close the header row at the rail's top, opposite the lockup. It now
 * sits level with the Log and the vault chip — the last control in the column,
 * where the sidebar ends. Collapsing narrows the rail to its icon column but never
 * removes it, so this control stays where the operator left it: wide, it is the
 * collapse chevron at the foot's trailing edge; thin, the foot stacks it under the
 * vault's initials and it becomes the brand's Q emblem — the pure mark, no
 * wordmark — and a press reopens the rail.
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
  const { collapsed, toggle, label } = useCollapseControl();

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

/**
 * The rail's lockup, wearing the rail's collapse control: a press on the mark
 * folds the sidebar to its icon column, exactly as the foot's square control does.
 *
 * The whole lockup is the target rather than its Q emblem alone. The Q is a shape
 * inside the inlined art, not its own element with its own box, so a Q-only
 * target would mean hit-testing SVG geometry (or painting a second, transparent
 * hit box over part of the mark) for a control the operator reaches for with the
 * pointer at a glance: the mark is where they look for the sidebar's identity, so
 * making the whole mark the door gives them the largest honest target and one
 * accessible name rather than a hit region that changes with the font.
 *
 * `no-drag` is load-bearing here: the header row is the window's drag band, and a
 * drag region wins hit-testing over the DOM, so without the carve-out the press
 * would start a window drag and the button would never fire. The air around the
 * mark is still the band's — the mark is the only carved-out control in it.
 *
 * Collapsed, the lockup leaves the column (56px cannot hold a word), so this
 * control is hidden with it and the foot's emblem is the way back.
 */
export function NavBrandButton({ className }: { className?: string }) {
  const { collapsed, toggle, label } = useCollapseControl();
  const logoVariant = useLogoVariant();

  return (
    <button
      type="button"
      className={["nav-rail__brand-button", className].filter(Boolean).join(" ")}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="nav-rail"
      data-nav-brand-toggle={collapsed ? "brand" : "chevron"}
      onClick={toggle}
    >
      <LifeQuestLogo variant={logoVariant} className="nav-rail__brand" crop />
    </button>
  );
}
