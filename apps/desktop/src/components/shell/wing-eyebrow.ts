import { WING_LABELS, type WingId } from "./wing.ts";

/**
 * The eyebrow convention: every page under a wing opens with a small
 * uppercase eyebrow that names the wing it belongs to and then the page
 * itself, separated by a dot — `Home · Dashboard`, `Define · Dream`,
 * `Act · Task Manager`.
 *
 * It is the one piece of chrome every wing page shares, so it lives in one
 * place: a page asks for its label here and never spells the wing out again.
 * The rendered text is the wing's label lowercased followed by the page's own
 * name, both in capitals via CSS `text-transform`, so the DOM keeps the
 * readable form and the style keeps the convention.
 */

/** The page names, in the operator's words. */
export type EyebrowPage =
  // Home
  | "Dashboard"
  | "Data"
  | "Pages"
  | "Documents"
  | "Agents"
  | "Images"
  // Define
  | "Dream"
  | "Vision"
  | "Ideal State"
  // Plan
  | "Goals"
  | "Life Map"
  | "Architecture"
  // Act
  | "Projects"
  | "Daily Schedule"
  | "Task Manager"
  // Review
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "Yearly";

/**
 * Which wing each page lives under. The wing's own label comes from
 * `WING_LABELS`, so the Act wing (whose id is `execute` for stored paths) still
 * reads "Act" in the eyebrow.
 */
export const EYEBROW_PAGE_WING: Record<EyebrowPage, WingId> = {
  // Home
  Dashboard: "home",
  Data: "home",
  Pages: "home",
  Documents: "home",
  Agents: "home",
  Images: "home",
  // Define
  Dream: "define",
  Vision: "define",
  "Ideal State": "define",
  // Plan
  Goals: "plan",
  "Life Map": "plan",
  Architecture: "plan",
  // Act
  Projects: "execute",
  "Daily Schedule": "execute",
  "Task Manager": "execute",
  // Review
  Daily: "review",
  Weekly: "review",
  Monthly: "review",
  Quarterly: "review",
  Yearly: "review",
};

/**
 * The eyebrow text for a page: the wing it sits under, a dot, then the page's
 * own name — `Home · Dashboard`.
 *
 * The wing's label comes from `WING_LABELS`, so the Act wing (whose id is
 * `execute` for stored paths) reads "Act" here without this module repeating
 * that mapping.
 */
export function eyebrowFor(page: EyebrowPage): string {
  return `${WING_LABELS[EYEBROW_PAGE_WING[page]]} · ${page}`;
}
