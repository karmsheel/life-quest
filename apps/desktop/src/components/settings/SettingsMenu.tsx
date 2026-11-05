import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Palette, Settings } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { THEME_OPTIONS, themeHint } from "@/components/theme/theme-options";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useMenuPosition } from "@/components/ui/useMenuPosition";
import { filterSkinsForPreference } from "@/lib/themes/presets";
import type { ForgeSkin } from "@/lib/themes/types.ts";
import { SkinTile } from "./SkinTile";

export function SettingsMenu({
  className,
  placement = "right-end",
}: {
  className?: string;
  placement?: "bottom-end" | "right-end";
}) {
  const navigate = useNavigate();
  const {
    preference,
    setPreference,
    resolved,
    skinName,
    setSkin,
    availableSkins,
    favoriteSkins,
  } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { menuStyle, updateMenuPosition } = useMenuPosition(
    triggerRef,
    placement,
  );

  const skins = useMemo(
    () => filterSkinsForPreference(availableSkins, preference),
    [availableSkins, preference],
  );

  /*
   * The quick menu IS the starred list: nothing else is offered here, and an
   * uncurated install has every theme starred, so the menu opens on the full set
   * until the operator starts narrowing it in Appearance. Registry order, not
   * starred order, so the menu and the Appearance grid never disagree.
   */
  const quickSkins = useMemo<ForgeSkin[]>(
    () => skins.filter((skin) => favoriteSkins.includes(skin.name)),
    [favoriteSkins, skins],
  );

  const skinHint = themeHint(preference, resolved);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();

    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const popover =
    open && mounted ? (
      <div
        ref={menuRef}
        className="settings-menu__popover settings-menu__popover--portal"
        role="menu"
        aria-label="Settings"
        style={menuStyle}
      >
        <section className="settings-menu__section">
          <div className="settings-menu__section-title">
            <Palette size={14} />
            <span>Skin</span>
          </div>
          <p className="settings-menu__skin-hint">{skinHint}</p>

          {quickSkins.length > 0 ? (
            <div
              className="settings-menu__skin-grid"
              role="group"
              aria-label="Starred themes"
            >
              {quickSkins.map((skin) => (
                <SkinTile
                  key={skin.name}
                  skin={skin}
                  active={skinName === skin.name}
                  mode={resolved}
                  onSelect={() => setSkin(skin.name)}
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

          <div className="settings-menu__mode-switcher">
            <SegmentedControl
              value={preference}
              options={THEME_OPTIONS}
              ariaLabel="Color mode"
              onChange={setPreference}
            />
          </div>
        </section>

        <footer className="settings-menu__footer">
          <button
            type="button"
            className="settings-menu__all-settings"
            onClick={() => {
              navigate("/settings");
              setOpen(false);
            }}
          >
            <span>All settings</span>
            <ChevronRight size={14} aria-hidden />
          </button>
        </footer>
      </div>
    ) : null;

  return (
    <div className={`settings-menu ${className ?? ""}`.trim()} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open settings"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings"
      >
        <Settings size={17} />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
