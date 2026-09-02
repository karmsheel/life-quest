import type { LucideIcon } from "lucide-react";
import {
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
import type { WingId } from "./wing.ts";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  section?: "main" | "governance";
  wing?: WingId;
};

/** Home: Dashboard, Life-Chain, Personnel. Vision: Dream, Documents. Plan: Life Map, Architecture. Execute: Act. Pinned: Decisions, Log. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    href: "/home",
    label: "Dashboard",
    icon: Home,
    section: "main",
    wing: "home",
  },
  {
    id: "dream",
    href: "/dream",
    label: "Dream",
    icon: Sparkles,
    section: "main",
    wing: "vision",
  },
  {
    id: "chain",
    href: "/chain",
    label: "Life-Chain",
    icon: Radio,
    section: "main",
    wing: "home",
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
    wing: "home",
  },
  {
    id: "chart",
    href: "/chart",
    label: "Life Map",
    icon: Map,
    section: "main",
    wing: "plan",
  },
  {
    id: "track",
    href: "/track",
    label: "Architecture",
    icon: Target,
    section: "main",
    wing: "plan",
  },
  {
    id: "act",
    href: "/act",
    label: "Act",
    icon: Zap,
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
