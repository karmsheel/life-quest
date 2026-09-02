import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
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
    <SettingsSection
      icon={<Palette size={16} />}
      title="Appearance"
      subtitle="Color mode and themes"
    >
      <SettingsRow
        className="settings-card__row--theme"
        label="Theme"
        description="Pick a built-in skin. System shows themes with both day and night palettes; Light and Dark show only matching skins."
        action={
          <SegmentedControl
            value={preference}
            options={THEME_OPTIONS}
            ariaLabel="Color mode"
            onChange={setPreference}
          />
        }
      />
      <SkinPicker />
    </SettingsSection>
  );
}
