import { useMemo, type CSSProperties } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { filterSkinsForPreference, resolveSkinPalette } from "@/lib/themes/presets";

export function SkinPicker() {
  const { preference, resolved, skinName, setSkin, availableSkins } = useTheme();

  const skins = useMemo(
    () => filterSkinsForPreference(availableSkins, preference),
    [availableSkins, preference],
  );

  const skinHint =
    preference === "system"
      ? "Follows system appearance · day & night palettes"
      : `${resolved === "dark" ? "Night" : "Day"} palette · LifeQuest themes`;

  return (
    <div className="settings-appearance__skins">
      <p className="settings-appearance__skin-hint">{skinHint}</p>
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
    </div>
  );
}
