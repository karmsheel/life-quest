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
import type { WingId } from "./wing.ts";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  room?: RoomId;
  section?: "main" | "governance";
  wing?: WingId;
};

/** Vision: Home, Dream, Domains, Chain, Documents, Personnel. Plan: Life Map, Architecture. Execute: Act. Pinned: Decisions, Log. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    href: "/home",
    label: "Home",
    icon: Home,
    section: "main",
    wing: "vision",
  },
  {
    id: "dream",
    href: "/dream",
    label: "Dream",
    icon: Sparkles,
    room: "dream",
    section: "main",
    wing: "vision",
  },
  {
    id: "domains",
    href: "/domains",
    label: "Domains",
    icon: Building2,
    section: "main",
    wing: "vision",
  },
  {
    id: "chain",
    href: "/chain",
    label: "Chain",
    icon: Radio,
    section: "main",
    wing: "vision",
  },
  {
    id: "documents",
    href: "/documents",
    label: "Documents",
    icon: FileText,
    section: "main",
    wing: "vision",
  },
  {
    id: "personnel",
    href: "/personnel",
    label: "Personnel",
    icon: Users,
    section: "main",
    wing: "vision",
  },
  {
    id: "chart",
    href: "/chart",
    label: "Life Map",
    icon: Map,
    room: "chart",
    section: "main",
    wing: "plan",
  },
  {
    id: "track",
    href: "/track",
    label: "Architecture",
    icon: Target,
    room: "track",
    section: "main",
    wing: "plan",
  },
  {
    id: "act",
    href: "/act",
    label: "Act",
    icon: Zap,
    room: "act",
    section: "main",
    wing: "execute",
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
];
