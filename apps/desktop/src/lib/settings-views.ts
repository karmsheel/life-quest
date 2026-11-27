import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
  FlaskConical,
  Inbox,
  Keyboard,
  Layers,
  MessageCircleQuestion,
  MessageSquareText,
  Palette,
  RefreshCw,
  ScrollText,
  Sparkles,
  Type,
  User,
} from "lucide-react";

export type SettingsViewId =
  | "appearance"
  | "shortcuts"
  | "reading"
  | "composer"
  | "domains"
  | "vault"
  | "hermes"
  | "agent"
  | "review"
  | "questions"
  | "decisions"
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
    id: "shortcuts",
    label: "Keyboard",
    icon: Keyboard,
    keywords: [
      "keyboard",
      "shortcut",
      "shortcuts",
      "key",
      "keys",
      "binding",
      "bindings",
      "hotkey",
      "hotkeys",
      "movement",
      "movements",
      "navigate",
      "navigation",
      "toggle",
      "panel",
    ],
  },
  {
    id: "reading",
    label: "Chat display",
    icon: Type,
    keywords: [
      "chat",
      "display",
      "text",
      "font",
      "type",
      "typography",
      "size",
      "zoom",
      "line",
      "spacing",
      "line spacing",
      "reading",
      "prose",
      "dock",
      "transcript",
    ],
  },
  {
    id: "composer",
    label: "Composer",
    icon: MessageSquareText,
    keywords: [
      "composer",
      "message",
      "messages",
      "chat",
      "box",
      "send",
      "sends",
      "enter",
      "return",
      "ctrl",
      "control",
      "cmd",
      "command",
      "modifier",
      "newline",
      "line break",
      "keyboard",
      "key",
      "keys",
    ],
  },
  {
    id: "domains",
    label: "Areas",
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
      "mcp",
      "door",
      "doors",
      "profile",
      "profiles",
      "filing",
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
    id: "review",
    label: "Review",
    icon: CalendarClock,
    keywords: [
      "review",
      "reviews",
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
      "cadence",
      "opens",
      "window",
      "schedule",
      "time",
      "available",
      "availability",
    ],
  },
  {
    id: "questions",
    label: "Questions",
    icon: MessageCircleQuestion,
    keywords: [
      "question",
      "questions",
      "prompt",
      "prompts",
      "starter",
      "starters",
      "saved",
      "new chat",
      "chat",
      "ask",
      "suggested",
    ],
  },
  {
    id: "decisions",
    label: "Decisions",
    icon: Inbox,
    keywords: [
      "decision",
      "decisions",
      "inbox",
      "proposal",
      "proposals",
      "approve",
      "approval",
      "auto",
      "automatic",
      "open",
      "close",
      "popup",
      "sheet",
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
    keywords: [
      "developer",
      "flag",
      "flags",
      "bench",
      "experimental",
      "debug",
      "preview",
      "logo",
      "brand",
      "wordmark",
      "lockup",
    ],
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
