import type { LucideIcon } from "lucide-react";
import { Building2, Palette, Sparkles, User } from "lucide-react";

export type SettingsViewId = "appearance" | "vault" | "hermes" | "about";

export interface SettingsSection {
  id: SettingsViewId;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "vault", label: "Vault", icon: Building2 },
  { id: "hermes", label: "Hermes", icon: Sparkles },
  { id: "about", label: "About me", icon: User },
];

export const DEFAULT_SETTINGS_VIEW: SettingsViewId = "appearance";

export function resolveSettingsView(
  value: string | null | undefined,
): SettingsViewId {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
    ? (value as SettingsViewId)
    : DEFAULT_SETTINGS_VIEW;
}
