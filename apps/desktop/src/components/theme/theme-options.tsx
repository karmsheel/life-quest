import { Monitor, Moon, Sun } from "lucide-react";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import type { ThemePreference } from "@/lib/theme";

/**
 * The three colour modes, in the order both quick menus offer them: the system
 * answer first, then the two explicit palettes. The settings popover and the
 * titlebar's day/night menu are the two places the operator meets this choice,
 * and they must never disagree about its order, wording or icons.
 */
export const THEME_OPTIONS: SegmentedOption<ThemePreference>[] = [
  {
    value: "system",
    label: "System",
    icon: <Monitor size={14} />,
  },
  {
    value: "light",
    label: "Light",
    icon: <Sun size={14} />,
  },
  {
    value: "dark",
    label: "Dark",
    icon: <Moon size={14} />,
  },
];

/**
 * The one line under the mode switcher: what the current setting means, in the
 * palette the window is actually wearing rather than the preference's name.
 */
export function themeHint(
  preference: ThemePreference,
  resolved: "light" | "dark",
): string {
  return preference === "system"
    ? "Follows system appearance · day & night palettes"
    : `${resolved === "dark" ? "Night" : "Day"} palette · LifeQuest themes`;
}
