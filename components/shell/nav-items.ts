import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  Map,
  ScrollText,
  Settings,
  Sparkles,
  Target,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { RoomId } from "@/lib/document-kinds.ts";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  room?: RoomId;
  section?: "main" | "governance" | "account";
};

export const NAV_ITEMS: NavItem[] = [
  {
    id: "domains",
    href: "/domains",
    label: "Domains",
    icon: Building2,
    section: "main",
  },
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
    label: "Chart",
    icon: Map,
    room: "chart",
    section: "main",
  },
  {
    id: "track",
    href: "/track",
    label: "Track",
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
    id: "personnel",
    href: "/personnel",
    label: "Personnel",
    icon: Users,
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
    label: "Life log",
    icon: ScrollText,
    section: "governance",
  },
  {
    id: "profile",
    href: "/profile",
    label: "Profile",
    icon: User,
    section: "account",
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    section: "account",
  },
];
