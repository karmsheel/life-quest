import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Monitor, Moon, Palette, Settings, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { ThemePreference } from "@/lib/theme";
import { filterSkinsForPreference, resolveSkinPalette } from "@/lib/themes/presets";

const THEME_OPTIONS = [
  {
    value: "system" as ThemePreference,
    label: "System",
    icon: <Monitor size={14} />,
  },
  {
    value: "light" as ThemePreference,
    label: "Light",
    icon: <Sun size={14} />,
  },
  {
    value: "dark" as ThemePreference,
    label: "Dark",
    icon: <Moon size={14} />,
  },
];

const POPOVER_WIDTH = 16.5 * 16;

export function SettingsMenu({
  className,
  placement = "right-end",
}: {
  className?: string;
  placement?: "bottom-end" | "right-end";
}) {
  const navigate = useNavigate();
  const { preference, setPreference, resolved, skinName, setSkin, availableSkins } =
    useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const skins = useMemo(
    () => filterSkinsForPreference(availableSkins, preference),
    [availableSkins, preference],
  );

  const skinHint =
    preference === "system"
      ? "Follows system appearance · day & night palettes"
      : `${resolved === "dark" ? "Night" : "Day"} palette · LifeQuest themes`;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(POPOVER_WIDTH, vw - 16);

    if (placement === "right-end") {
      let left = rect.right + gap;
      if (left + width > vw - 8) {
        left = Math.max(8, rect.left - width - gap);
      }
      const bottom = Math.max(8, vh - rect.bottom);
      setMenuStyle({
        position: "fixed",
        left,
        bottom,
        top: "auto",
        width,
        maxHeight: Math.max(160, vh - bottom - 8),
      });
      return;
    }

    let top = rect.bottom + gap;
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
    const estimatedMax = Math.min(420, vh - 16);
    if (top + 200 > vh && rect.top > vh - rect.bottom) {
      top = Math.max(8, rect.top - gap - estimatedMax);
    }
    setMenuStyle({
      position: "fixed",
      top,
      left,
      bottom: "auto",
      width,
      maxHeight: Math.max(160, vh - top - 8),
    });
  }, [placement]);

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
          <div className="settings-menu__skin-grid" role="group" aria-label="Built-in skins">
            {skins.map((skin) => {
              const active = skinName === skin.name;
              const palette = resolveSkinPalette(skin, resolved);
              return (
                <button
                  key={skin.name}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={skin.label}
                  title={`${skin.label} — ${skin.description}`}
                  className={`settings-menu__skin-option${active ? " is-active" : ""}`}
                  onClick={() => setSkin(skin.name)}
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
              );
            })}
          </div>
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
