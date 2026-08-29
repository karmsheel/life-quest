import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  Map,
  Radio,
  ScrollText,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import type { RoomId } from "@lifequest/vault-core";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  room?: RoomId;
  section?: "main" | "governance";
};

/** Brief order: Home, Dream, Chart, Track, Act, Documents, Domains, Chain, Decisions, Log, Personnel, Settings */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    href: "/home",
    label: "Home",
    icon: Home,
    section: "main",
  },
  {
    id: "dream",
    href: "/dream",
    label: "Dream",
    icon: Sparkles,
    room: "dream",
    section: "main",
  },
  {
    id: "chart",
    href: "/chart",
    label: "Life Map",
    icon: Map,
    room: "chart",
    section: "main",
  },
  {
    id: "track",
    href: "/track",
    label: "Architecture",
    icon: Target,
    room: "track",
    section: "main",
  },
  {
    id: "act",
    href: "/act",
    label: "Act",
    icon: Zap,
    room: "act",
    section: "main",
  },
  {
    id: "documents",
    href: "/documents",
    label: "Documents",
    icon: FileText,
    section: "main",
  },
  {
    id: "domains",
    href: "/domains",
    label: "Domains",
    icon: Building2,
    section: "main",
  },
  {
    id: "chain",
    href: "/chain",
    label: "Chain",
    icon: Radio,
    section: "main",
  },
  {
    id: "decisions",
    href: "/decisions",
    label: "Decisions",
    icon: ClipboardList,
    section: "governance",
  },
  {
    id: "log",
    href: "/log",
    label: "Log",
    icon: ScrollText,
    section: "governance",
  },
  {
    id: "personnel",
    href: "/personnel",
    label: "Personnel",
    icon: Users,
    section: "main",
  },
];
