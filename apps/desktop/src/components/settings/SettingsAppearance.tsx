import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { ThemePreference } from "@/lib/theme";
import { SkinPicker } from "./SkinPicker";

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

export function SettingsAppearance() {
  const { preference, setPreference } = useTheme();

  return (
    <section>
      <div className="settings-panel__heading">
        <div className="settings-panel__icon">
          <Palette size={16} />
        </div>
        <div>
          <h2 className="settings-panel__title">Appearance</h2>
          <p className="settings-panel__subtitle">Color mode and themes</p>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card__row settings-card__row--theme">
          <div className="settings-card__copy">
            <div className="settings-card__label">Theme</div>
            <p className="settings-card__desc">
              Pick a built-in skin. System shows themes with both day and night
              palettes; Light and Dark show only matching skins.
            </p>
          </div>
          <SegmentedControl
            value={preference}
            options={THEME_OPTIONS}
            ariaLabel="Color mode"
            onChange={setPreference}
            className="settings-card__control"
          />
        </div>
        <SkinPicker />
      </div>
    </section>
  );
}
