import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock,
  Compass,
  Database,
  FileStack,
  FileText,
  FolderKanban,
  Goal,
  Image as ImageIcon,
  Inbox,
  Map,
  Puzzle,
  NotebookPen,
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
   * `bottom` is the governed shelf: Notebox, Decisions, Daily Journal,
   * Automations and Customizations, cordoned above the Log. `footer` is the Log itself — the one
   * row that closes the rail — so the shelf can carry a divider above it without
   * counting the Log as one of its entries.
   */
  pin?: "top" | "bottom" | "footer";
};

/** Home: Dashboard, Data, Pages, Documents, Agents, Images. Define: Dream, Vision, Ideal State. Plan: Goals, Life Map, Blueprints. Act: Projects, Daily Schedule, Task Manager. Review: Daily, Weekly, Monthly, Quarterly, Yearly. Bottom shelf: Notebox, Decisions, Daily Journal, Automations, Customizations. Footer: Log. */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "chain",
    href: "/chain",
    label: "Notebox",
    icon: Inbox,
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
    label: "Daily Journal",
    icon: NotebookPen,
    section: "governance",
    pin: "bottom",
  },
  {
    // Directly under Daily Journal: the shelf of one-click jobs that read a page
    // and open a chat with the agent. The Daily Journal's "Analyze note" is the
    // first of them.
    id: "automations",
    href: "/automations",
    label: "Automations",
    icon: WandSparkles,
    section: "governance",
    pin: "bottom",
  },
  {
    // Directly under Automations: the workshop where the data-only
    // customisation files are selected, switched on or off, edited and created.
    // It is governance like the shelf above it — the look of the app belongs to
    // the operator, not to a wing.
    //
    // The row reads "Customizations" and links to `/customizations`, but its
    // `id` stays "extensions" on purpose: stored rail preferences and pinned
    // shelves resolve rows by id, so renaming it here would forget where every
    // existing operator had put this row (or drop it from a pin). The id is an
    // address for saved state, not the label the operator reads.
    id: "extensions",
    href: "/customizations",
    label: "Customizations",
    icon: Puzzle,
    section: "governance",
    pin: "bottom",
  },
  {
    // The rail row wears the mark a built-in card's heading wears (BuiltInBadge):
    // the Dashboard is the pin board, so its icon is the board's own badge, not
    // the house glyph it used to carry.
    id: "dashboard",
    href: "/home",
    label: "Dashboard",
    icon: Blocks,
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
    label: "Agents",
    icon: Users,
    section: "main",
    wing: "home",
  },
  {
    // The pictures a vision is made of, and the one document they are written
    // beside. Under Home, not Define: the library is part of what the operator
    // already has, not part of what they are defining.
    id: "images",
    href: "/images",
    label: "Images",
    icon: ImageIcon,
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
    // Not doctrine: the operator's own titled documents, as many as they think
    // of. Beside Dream and Vision because that is where the future is defined.
    id: "ideal-state",
    href: "/ideal-state",
    label: "Ideal State",
    icon: Compass,
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
    label: "Blueprints",
    icon: Target,
    section: "main",
    wing: "plan",
  },
  {
    // Execute's first row: a project is the unit of work the operator is
    // actually carrying, so it sits ahead of the schedule and the dispatch page.
    id: "projects",
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    section: "main",
    wing: "execute",
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
    // The task board itself: what to do next, and what the agents are doing
    // about it. The row's id stays "act" — that is the wing's own name in the
    // loop, and it keeps stored paths and settings resolving.
    id: "act",
    href: "/act",
    label: "Task Manager",
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
