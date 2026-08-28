import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { skinSupportsBothModes } from "@/lib/themes/presets";

const ICON_PROPS = {
  className: "theme-mode-toggle__icon",
  size: 17,
  strokeWidth: 1.75,
  absoluteStrokeWidth: false as const,
};

export function NavThemeModeToggle({ className }: { className?: string }) {
  const { skin, resolved, setPreference } = useTheme();

  if (!skinSupportsBothModes(skin)) {
    return null;
  }

  const isDark = resolved === "dark";
  const label = isDark ? "Switch to day mode" : "Switch to night mode";

  return (
    <button
      type="button"
      className={["theme-mode-toggle", className].filter(Boolean).join(" ")}
      onClick={() => setPreference(isDark ? "light" : "dark")}
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun {...ICON_PROPS} /> : <Moon {...ICON_PROPS} />}
    </button>
  );
}
