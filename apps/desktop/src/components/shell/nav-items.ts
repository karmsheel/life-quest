import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock,
  Database,
  FileStack,
  FileText,
  FolderKanban,
  Goal,
  Home,
  Map,
  NotebookPen,
  Radio,
  ScrollText,
  Sparkles,
  Target,
  Telescope,
  Users,
  WandSparkles,
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
  /**
   * Where the row sits on the rail.
   *
   * `bottom` is the governed shelf: Life-Chain, Decisions, Daily Note and
   * Automations, cordoned above the Log. `footer` is the Log itself — the one
   * row that closes the rail — so the shelf can carry a divider above it without
   * counting the Log as one of its entries.
   */
  pin?: "top" | "bottom" | "footer";
};

/** Home: Dashboard, Data, Pages, Documents, Personnel. Define: Dream, Vision. Plan: Goals, Projects, Life Map, Architecture. Execute: Daily Schedule, Act. Review: Daily, Weekly, Monthly, Quarterly, Yearly. Bottom shelf: Life-Chain, Decisions, Daily Note, Automations. Footer: Log. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "chain",
    href: "/chain",
    label: "Life-Chain",
    icon: Radio,
    section: "main",
    pin: "bottom",
  },
  {
    id: "decisions",
    href: "/decisions",
    label: "Decisions",
    icon: ClipboardList,
    section: "governance",
    pin: "bottom",
  },
  {
    // Directly under Decisions: the day's own page, and the journal a review
    // reads back. Governance, not a wing — it belongs to no domain.
    id: "note",
    href: "/notes",
    label: "Daily Note",
    icon: NotebookPen,
    section: "governance",
    pin: "bottom",
  },
  {
    // Directly under Daily Note: the shelf of one-click jobs that read a page
    // and open a chat with the agent. The Daily Note's "Analyze note" is the
    // first of them.
    id: "automations",
    href: "/automations",
    label: "Automations",
    icon: WandSparkles,
    section: "governance",
    pin: "bottom",
  },
  {
    id: "dashboard",
    href: "/home",
    label: "Dashboard",
    icon: Home,
    section: "main",
    wing: "home",
  },
  {
    id: "data",
    href: "/data",
    label: "Data",
    icon: Database,
    section: "main",
    wing: "home",
  },
  {
    id: "pages",
    href: "/pages",
    label: "Pages",
    icon: FileStack,
    section: "main",
    wing: "home",
  },
  {
    id: "documents",
    href: "/documents",
    label: "Documents",
    icon: FileText,
    section: "main",
    wing: "home",
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
    id: "dream",
    href: "/dream",
    label: "Dream",
    icon: Sparkles,
    section: "main",
    wing: "define",
  },
  {
    id: "vision",
    href: "/vision",
    label: "Vision",
    icon: Telescope,
    section: "main",
    wing: "define",
  },
  {
    id: "goals",
    href: "/goals",
    label: "Goals",
    icon: Goal,
    section: "main",
    wing: "plan",
  },
  {
    id: "projects",
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    section: "main",
    wing: "plan",
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
    id: "schedule",
    href: "/daily",
    label: "Daily Schedule",
    icon: Clock,
    section: "main",
    wing: "execute",
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
    id: "daily",
    href: "/review/daily",
    label: "Daily",
    icon: Calendar,
    section: "main",
    wing: "review",
  },
  {
    id: "weekly",
    href: "/review/weekly",
    label: "Weekly",
    icon: CalendarDays,
    section: "main",
    wing: "review",
  },
  {
    id: "monthly",
    href: "/review/monthly",
    label: "Monthly",
    icon: CalendarRange,
    section: "main",
    wing: "review",
  },
  {
    id: "quarterly",
    href: "/review/quarterly",
    label: "Quarterly",
    icon: CalendarClock,
    section: "main",
    wing: "review",
  },
  {
    id: "yearly",
    href: "/review/yearly",
    label: "Yearly",
    icon: CalendarCheck,
    section: "main",
    wing: "review",
  },
  {
    id: "log",
    href: "/log",
    label: "Log",
    icon: ScrollText,
    section: "governance",
    pin: "footer",
  },
];
