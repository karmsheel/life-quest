import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Moon, Palette, Star, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { THEME_OPTIONS, themeHint } from "@/components/theme/theme-options";
import { SkinTile } from "@/components/settings/SkinTile";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useMenuPosition } from "@/components/ui/useMenuPosition";
import { filterSkinsForPreference, skinSupportsBothModes } from "@/lib/themes/presets";
import type { ForgeSkin } from "@/lib/themes/types.ts";

const ICON_PROPS = {
  className: "theme-mode-toggle__icon",
  size: 17,
  strokeWidth: 1.75,
  absoluteStrokeWidth: false as const,
};

/** The pointer rests here a moment before the menu appears; a stray crossing
 *  of the titlebar should not open it. */
const OPEN_DELAY_MS = 130;
/** Long enough to cross the gap between the control and the menu, short enough
 *  that leaving the menu feels immediate. */
const CLOSE_DELAY_MS = 220;

/**
 * The titlebar's day/night control.
 *
 * It is two controls on one icon, split by the gesture:
 *
 *  - A click switches the palette now, straight between night and day — the
 *    same press the old toggle made, and the one the operator reaches for
 *    without breaking stride.
 *  - Hovering opens the quick menu the settings button carries: the colour-mode
 *    switcher (System / Light / Dark) first, then the starred themes, so a
 *    theme can be tried without a trip to Settings.
 *
 * The menu is portalled to the body for the same reason the settings popover
 * is: the window strip owns the trigger and must not decide where the menu is
 * drawn. It closes on Escape, on a press outside it, and when the pointer
 * leaves both the control and the menu.
 */
export function ThemeQuickMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const {
    preference,
    setPreference,
    resolved,
    skin,
    skinName,
    setSkin,
    availableSkins,
    favoriteSkins,
  } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Escape closes the menu and hands the focus back to the control. That focus
  // call must not count as "tabbed here" and reopen the menu immediately, so the
  // hand-back is flagged; the next pointer gesture clears it.
  const suppressFocusOpen = useRef(false);
  const { menuStyle, updateMenuPosition } = useMenuPosition(
    triggerRef,
    "bottom-end",
  );

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const showMenu = useCallback(() => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    cancelClose();
    if (open) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [open, cancelClose]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    setMounted(true);
    return clearTimers;
  }, [clearTimers]);

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();

    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        suppressFocusOpen.current = true;
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  /*
   * The menu lists the palettes that match the preference the operator is
   * wearing, the same filter the settings popover applies, and then narrows that
   * to the starred names: the quick menu is the favourites, not a second theme
   * browser.
   */
  const skins = filterSkinsForPreference(availableSkins, preference);
  const quickSkins: ForgeSkin[] = skins.filter((skin) =>
    favoriteSkins.includes(skin.name),
  );
  const skinHint = themeHint(preference, resolved);

  /*
   * A theme that only ships one palette has no day/night switch to offer, so the
   * control is absent exactly as the old toggle was. The quick menu would not
   * have a mode to switch between on such a theme either.
   */
  if (!skinSupportsBothModes(skin)) {
    return null;
  }

  const isDark = resolved === "dark";
  const label = isDark ? "Switch to day mode" : "Switch to night mode";

  function toggleMode() {
    setPreference(isDark ? "light" : "dark");
    // The pointer is still on the control or the menu; the menu stays where it
    // was put. A click is the switch, not a request to close the menu.
  }

  const popover =
    open && mounted ? (
      <div
        ref={menuRef}
        className="settings-menu__popover settings-menu__popover--portal theme-quick-menu__popover"
        role="menu"
        aria-label="Theme"
        data-testid="theme-quick-menu"
        style={menuStyle}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <section className="settings-menu__section">
          <div className="settings-menu__section-title">
            <Palette size={14} />
            <span>Theme</span>
          </div>
          <SegmentedControl
            value={preference}
            options={THEME_OPTIONS}
            ariaLabel="Color mode"
            onChange={setPreference}
          />
          <p className="settings-menu__skin-hint">{skinHint}</p>

          <div className="settings-menu__section-title theme-quick-menu__starred-title">
            <Star size={14} />
            <span>Starred themes</span>
          </div>
          {quickSkins.length > 0 ? (
            <div
              className="settings-menu__skin-grid"
              role="group"
              aria-label="Starred themes"
            >
              {quickSkins.map((quickSkin) => (
                <SkinTile
                  key={quickSkin.name}
                  skin={quickSkin}
                  active={skinName === quickSkin.name}
                  mode={resolved}
                  onSelect={() => setSkin(quickSkin.name)}
                />
              ))}
            </div>
          ) : (
            <p className="settings-menu__quick-empty" role="status">
              {favoriteSkins.length === 0 ? (
                <>
                  No starred themes. Star the ones you want here in{" "}
                  <button
                    type="button"
                    className="settings-menu__quick-empty-link"
                    onClick={() => {
                      navigate("/settings?tab=appearance");
                      setOpen(false);
                    }}
                  >
                    Appearance
                  </button>
                  .
                </>
              ) : (
                "None of your starred themes fits this colour mode."
              )}
            </p>
          )}
        </section>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={["theme-mode-toggle", className].filter(Boolean).join(" ")}
        onClick={toggleMode}
        onPointerEnter={() => {
          suppressFocusOpen.current = false;
          scheduleOpen();
        }}
        onPointerLeave={scheduleClose}
        onFocus={(event) => {
          // Keyboard focus opens the menu; a click's focus does not, so the
          // click above stays a plain palette switch. The Escape hand-back is
          // excluded: it has just closed the menu on purpose.
          if (suppressFocusOpen.current) return;
          if (event.currentTarget.matches(":focus-visible")) showMenu();
        }}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isDark ? <Sun {...ICON_PROPS} /> : <Moon {...ICON_PROPS} />}
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </>
  );
}
