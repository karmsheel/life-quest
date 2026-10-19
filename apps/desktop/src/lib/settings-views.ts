import type { LucideIcon } from "lucide-react";
import {
  Building2,
  FlaskConical,
  Layers,
  Palette,
  RefreshCw,
  ScrollText,
  Sparkles,
  User,
} from "lucide-react";

export type SettingsViewId =
  | "appearance"
  | "domains"
  | "vault"
  | "hermes"
  | "agent"
  | "updates"
  | "about"
  | "developer";

export interface SettingsSection {
  id: SettingsViewId;
  label: string;
  icon: LucideIcon;
  /**
   * What the overlay's search bar matches besides the label: the words an
   * operator would type for what the page holds. Kept beside the section so a
   * new settings page cannot be added without saying how it is found.
   */
  keywords: string[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    keywords: [
      "theme",
      "themes",
      "skin",
      "skins",
      "colour",
      "color",
      "mode",
      "dark",
      "light",
      "system",
      "palette",
      "look",
    ],
  },
  {
    id: "domains",
    label: "Domains",
    icon: Layers,
    keywords: ["domain", "lens", "area", "archive", "life area", "focus"],
  },
  {
    id: "vault",
    label: "Vault",
    icon: Building2,
    keywords: ["vault", "folder", "path", "storage", "open", "recent", "name"],
  },
  {
    id: "hermes",
    label: "Hermes",
    icon: Sparkles,
    keywords: [
      "hermes",
      "connection",
      "gateway",
      "model",
      "provider",
      "port",
      "agent",
      "chat",
    ],
  },
  {
    id: "agent",
    label: "Agent",
    icon: ScrollText,
    keywords: [
      "agent",
      "prompt",
      "prompts",
      "skill",
      "skills",
      "companion",
      "persona",
      "instruction",
    ],
  },
  {
    id: "updates",
    label: "Updates",
    icon: RefreshCw,
    keywords: ["update", "updates", "version", "release", "upgrade", "channel"],
  },
  {
    id: "about",
    label: "About me",
    icon: User,
    keywords: ["about", "me", "profile", "operator", "identity", "who", "name"],
  },
  // Last on purpose: it is a bench, not a setting, and it is the only page here
  // that changes what the app would otherwise show.
  {
    id: "developer",
    label: "Developer",
    icon: FlaskConical,
    keywords: ["developer", "flag", "flags", "bench", "experimental", "debug", "preview"],
  },
];

export const DEFAULT_SETTINGS_VIEW: SettingsViewId = "appearance";

export function resolveSettingsView(
  value: string | null | undefined,
): SettingsViewId {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
    ? (value as SettingsViewId)
    : DEFAULT_SETTINGS_VIEW;
}
