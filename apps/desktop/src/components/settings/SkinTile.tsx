/**
 * One theme swatch, in both places it is offered: the full Appearance page and
 * the quick settings popover.
 *
 * They were the same markup twice, and the star is the reason they cannot drift:
 * the full page is where a theme is starred, the popover is where the starred
 * ones are handy, and both must paint the active theme, the applied palette and
 * the star's state identically. The popover passes no `onToggleFavorite`, so its
 * compact grid stays a picker; the full page passes one, so each tile grows a
 * star.
 *
 * The star is a sibling of the tile rather than a child: a button inside a button
 * is invalid, and the tile is already a radio.
 */
import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import { resolveSkinPalette } from "@/lib/themes/presets";
import type { ForgeSkin } from "@/lib/themes/types";

export function SkinTile({
  skin,
  active,
  mode,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  skin: ForgeSkin;
  /** Whether this is the theme the app is wearing. */
  active: boolean;
  /** Which palette of the skin to preview. */
  mode: "light" | "dark";
  favorite?: boolean;
  onSelect: () => void;
  /**
   * Present only where a theme can be starred. The star's label says what the
   * press does to the quick menu, not what state the tile is in.
   */
  onToggleFavorite?: () => void;
}) {
  const palette = resolveSkinPalette(skin, mode);
  const starrable = typeof onToggleFavorite === "function";

  return (
    <div
      className={`skin-tile${starrable ? " skin-tile--starrable" : ""}`}
      data-skin={skin.name}
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={skin.label}
        title={`${skin.label} — ${skin.description}`}
        className={`settings-menu__skin-option${active ? " is-active" : ""}`}
        onClick={onSelect}
      >
        <span
          className="settings-menu__skin-swatch"
          style={
            {
              "--skin-bg": palette.background,
              "--skin-primary": palette.primary,
            } as CSSProperties
          }
        />
        <span className="settings-menu__skin-label">{skin.label}</span>
      </button>
      {starrable ? (
        <button
          type="button"
          className={`skin-tile__star${favorite ? " is-on" : ""}`}
          aria-pressed={favorite === true}
          aria-label={
            favorite
              ? `Remove ${skin.label} from quick settings`
              : `Add ${skin.label} to quick settings`
          }
          title={
            favorite
              ? `${skin.label} is in the quick settings menu — press to remove it`
              : `Star ${skin.label} to keep it in the quick settings menu`
          }
          onClick={onToggleFavorite}
        >
          <Star size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
