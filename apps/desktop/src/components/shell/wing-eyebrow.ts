/**
 * The eyebrow convention: every page under a wing opens with a small
 * uppercase eyebrow carrying the page's own name — `Dashboard`, `Dream`,
 * `Task Manager` — and the journal, which belongs to no wing, opens with its
 * own name the same way.
 *
 * It is the one piece of chrome every such page shares, so it lives in one
 * place: a page asks for its label here and never spells its own name out
 * again. The rendered text is the page name in capitals via CSS
 * `text-transform`, so the DOM keeps the readable form and the style keeps
 * the convention.
 *
 * The wing itself is not in the eyebrow — the rail's selected wing tab says
 * which wing the operator is in, and repeating it here would say it twice.
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
  | "Yearly"
  // The bottom shelf — governance pages, which belong to no wing
  | "Daily Journal";

/**
 * The eyebrow text for a page: the page's own name, and nothing else —
 * `Dashboard`, `Dream`, `Task Manager`.
 */
export function eyebrowFor(page: EyebrowPage): string {
  return page;
}
