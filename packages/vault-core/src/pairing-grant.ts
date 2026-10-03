// KAR-70: what a connected agent is allowed to read.
//
// A roster row carries the operator's assignment: which live domains the
// agent may see, whether it may write, and whether Schedule is on. This module
// is the whole of that policy in one place, so the door (which decides the
// tool list) and executeTool (which decides one call) can never disagree.
//
// Two rules carry the weight:
//
//  1. A record the grant does not cover reads as `NOT_FOUND`, the same answer
//     as a record that was never there. An agent cannot tell "you may not see
//     this" from "this does not exist", so a missing domain does not confirm
//     that a secret exists.
//  2. The desktop lens is the companion's lens. A connected agent's `activeSlug`
//     is the operator's window, not a permission, and never narrows or widens
//     what the agent may read.
import { listDomains } from "./domains.ts";
import type {
  DecisionRecord,
  DocumentTarget,
  Goal,
  MapEvent,
  PeriodPack,
  ReviewRecord,
  ReviewScopeState,
  Task,
} from "./types.ts";
import type { MapStoreState } from "./map/public.ts";
import type { ConnectedAgent } from "./connected-agents.ts";

export type ConnectedGrant = {
  agentId: string;
  name: string;
  access: "read" | "write";
  domainSlugs: string[];
  schedule: boolean;
};

/**
 * KAR-70: the tools a grant allows at all. Every one of these is a read inside
 * the assigned domains; none of them names the operator's own settings.
 */
export const CONNECTED_READ_TOOLS: ReadonlySet<string> = new Set([
  "get_doctrine",
  "list_documents",
  "get_document",
  "list_databases",
  "get_database",
  "list_rows",
  "get_row",
  "list_decisions",
  "list_goals",
  "get_state",
  "get_review",
  "list_reviews",
  "get_period_pack",
  "run_script_block",
]);

/**
 * KAR-70: tools with no domain of their own. These stay on the companion for
 * good — they configure the vault rather than any domain of it — so a connected
 * agent that calls one is refused rather than filtered.
 */
export const COMPANION_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "create_year",
  "delete_year",
  "set_month_day",
  "set_month_objectives",
  "set_month_notes",
  "set_about_me",
]);

/**
 * KAR-70: the Schedule surface. Task and live-week tools, plus the day-template
 * tools that shape them. They need Schedule on, and the day templates also need
 * Write. The exact lists are fixed by the Schedule task; until then this is the
 * refusal half only.
 */
export const CONNECTED_SCHEDULE_TOOLS: ReadonlySet<string> = new Set([
  "get_week",
  "set_week_day_type",
  "set_week_day_items",
  "set_week_weekly_items",
  "place_grid_block",
  "clear_grid_block",
  "reset_week",
  "create_task",
  "update_task",
  "delete_task",
]);

export const CONNECTED_DAY_TEMPLATE_TOOLS: ReadonlySet<string> = new Set([
  "create_day_type",
  "update_day_type",
  "delete_day_type",
  "set_default_weekday_type",
  "set_default_weekly_items",
]);

/**
 * KAR-70: the writes that file a Decision. They follow the companion's rule
 * exactly — doctrine, library notes, goals, projects, database changes, and
 * review changes never land on their own — so the only thing this task adds is
 * the domain they are allowed to touch.
 */
export const CONNECTED_DECISION_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "update_document",
  "create_library_document",
  "create_goal",
  "update_goal",
  "delete_goal",
  "create_project",
  "close_project",
  "upsert_row",
  "delete_row",
  "create_database",
  "add_column",
  "write_review",
  "mark_review_done",
  "unlock_review",
]);

/**
 * KAR-70: the writes that apply immediately, as they do for the companion:
 * events, script blocks on a page, and the capture thread. Each still needs its
 * domain inside the assignment.
 */
export const CONNECTED_IMMEDIATE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_event",
  "update_event",
  "delete_event",
  "apply_script_block",
  "capture_transaction",
  "undo_capture",
  "correct_capture",
]);

/**
 * KAR-70: the capture tools name no domain argument — the finance ledger is
 * theirs by definition — so `financial` is the domain the grant has to cover.
 */
export const CAPTURE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "capture_transaction",
  "undo_capture",
  "correct_capture",
]);

/** How a write reaches the vault: a pending Decision, or applied at once. */
type ConnectedWriteKind = "decision" | "immediate";

/**
 * KAR-70: which of the two write shapes a tool has, or `null` when the tool is
 * not a write. Split out from `toolAllowed` because the per-call answer also
 * depends on the domains the arguments name, which the gate does not see.
 */
export function connectedWriteKind(name: string): ConnectedWriteKind | null {
  if (CONNECTED_DECISION_WRITE_TOOLS.has(name)) return "decision";
  if (CONNECTED_IMMEDIATE_WRITE_TOOLS.has(name)) return "immediate";
  return null;
}

/**
 * KAR-70: a write names one or more domains, and every one of them must be
 * inside the assignment. A record with no domain stays with the companion, so
 * an empty list is refused rather than waved through: a write with no domain is
 * a write to everything.
 */
export function connectedWriteDomainsAllowed(
  slugs: ReadonlyArray<string | null | undefined>,
  grant: ConnectedGrant,
): boolean {
  if (slugs.length === 0) return false;
  return slugs.every(
    (slug) => typeof slug === "string" && grant.domainSlugs.includes(slug),
  );
}

/**
 * KAR-70: the first gate. `NO_GRANT` means the row itself reaches nothing —
 * approval alone is not a grant. `FORBIDDEN` means the row has a grant and this
 * tool is outside it.
 *
 * A read is allowed as soon as one assigned domain remains; which records it
 * may actually see is settled per call by the projection. A write needs the
 * Write switch, and a capture additionally needs `financial` in the assignment,
 * because that is the domain the capture thread writes. The domains a write
 * *names* are checked per call, before the tool body runs.
 */
export function toolAllowed(
  name: string,
  grant: ConnectedGrant,
): "allow" | "NO_GRANT" | "FORBIDDEN" {
  if (grant.domainSlugs.length === 0 && !grant.schedule) return "NO_GRANT";
  if (COMPANION_ONLY_TOOLS.has(name)) return "FORBIDDEN";
  if (CONNECTED_READ_TOOLS.has(name)) {
    return grant.domainSlugs.length > 0 ? "allow" : "FORBIDDEN";
  }
  const isSchedule =
    CONNECTED_SCHEDULE_TOOLS.has(name) || CONNECTED_DAY_TEMPLATE_TOOLS.has(name);
  if (isSchedule && !grant.schedule) return "FORBIDDEN";
  // Everything else is a write, and a write needs the Write switch.
  if (grant.access !== "write") return "FORBIDDEN";
  // Capture names no domain argument, so the gate settles it here rather than
  // per call: no financial in the assignment means no capture tool at all.
  if (CAPTURE_WRITE_TOOLS.has(name) && !grant.domainSlugs.includes("financial")) {
    return "FORBIDDEN";
  }
  return "allow";
}

/**
 * KAR-70: the row as it stands at call time. A domain archived after it was
 * assigned drops out of the copy, so the roster keeps the operator's intent
 * while the effective grant stops covering a domain that no longer exists.
 */
export async function effectiveGrant(
  rootPath: string,
  agent: ConnectedAgent,
): Promise<ConnectedGrant> {
  const listed = await listDomains(rootPath);
  const live = new Set(
    listed.ok
      ? listed.value.filter((d) => !d.meta.archivedAt).map((d) => d.slug)
      : [],
  );
  return {
    agentId: agent.id,
    name: agent.name,
    access: agent.access,
    domainSlugs: agent.domainSlugs.filter((slug) => live.has(slug)),
    schedule: agent.schedule,
  };
}

/** A record with no domain stays with the companion. */
export function connectedEventVisible(
  event: Pick<MapEvent, "domainSlug">,
  grant: ConnectedGrant,
): boolean {
  return event.domainSlug !== null && grant.domainSlugs.includes(event.domainSlug);
}

export function connectedGoalVisible(
  goal: Pick<Goal, "domainSlug">,
  grant: ConnectedGrant,
): boolean {
  return goal.domainSlug !== null && grant.domainSlugs.includes(goal.domainSlug);
}

/**
 * KAR-70: a library note is visible only when it has at least one domain and
 * every one of those domains is assigned. A note tagged across an assigned and
 * an unassigned domain is not visible: it would carry the other domain's
 * content, and there is no safe way to redact one tag out of a note.
 */
export function connectedLibraryVisible(
  domainSlugs: string[],
  grant: ConnectedGrant,
): boolean {
  if (domainSlugs.length === 0) return false;
  return domainSlugs.every((slug) => grant.domainSlugs.includes(slug));
}

/**
 * KAR-70: a pairing Decision is the operator's own business, not the agent's —
 * the agent may not read who else is connected. Any other Decision needs a
 * non-empty domain list entirely inside the assignment.
 */
export function connectedDecisionVisible(
  decision: Pick<DecisionRecord, "target" | "domainSlugs">,
  grant: ConnectedGrant,
): boolean {
  const target = decision.target as DocumentTarget | undefined;
  if (target?.type === "agent-pairing") return false;
  const slugs = decision.domainSlugs ?? [];
  if (slugs.length === 0) return false;
  return slugs.every((slug) => grant.domainSlugs.includes(slug));
}

/**
 * KAR-70: `get_state` for a connected agent is events only, inside the assigned
 * domains. Everything else in the map store — About me, the years, the month
 * cells, the day-type catalogue, tasks, the live week — is either the operator's
 * own configuration or the Schedule surface, and neither is this grant's.
 *
 * `tasks` and `week` are added only when Schedule is on, and the Schedule task
 * fills their contents. Until then they are absent even for a Schedule grant,
 * so the shape cannot be mistaken for "the week was empty".
 */
export function projectConnectedState(
  state: MapStoreState,
  grant: ConnectedGrant,
): { events: MapEvent[]; tasks?: Task[]; week?: unknown } {
  const events: MapEvent[] = [];
  for (const year of state.years) {
    for (const event of year.events) {
      if (connectedEventVisible(event, grant)) events.push(event);
    }
  }
  return { events };
}

/**
 * KAR-70: the domain slice of a period pack. Tasks and live days are the
 * Schedule surface and go empty unless Schedule is on; the previous review and
 * the overall section list belong to the `overall` scope, which a connected
 * agent never has.
 */
export function projectConnectedPack(pack: PeriodPack, grant: ConnectedGrant): PeriodPack {
  return {
    ...pack,
    tasks: [],
    liveDays: [],
    previousReview: null,
    domainSections: [],
  };
}

/** Lower-cased domain name to slug, the key the review body headings use. */
export function reviewHeadingSlugs(
  domains: readonly { slug: string; meta: { name: string } }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of domains) map.set(d.meta.name.toLowerCase(), d.slug);
  return map;
}

/**
 * KAR-70: a review body is one H1, then the `overall` preamble and its required
 * headings, then one H2 per domain. A connected agent gets the H1 and the H2
 * sections of its assigned domains, and nothing else — dropping the preamble as
 * well as the other domains' sections, because the preamble is the operator's
 * own cross-domain view.
 *
 * Only whole sections are kept or dropped. A section is never partially redacted:
 * a half-removed `### Keep` list would leave the agent reading a conclusion with
 * the evidence removed.
 */
export function projectConnectedReviewBody(
  body: string,
  grant: ConnectedGrant,
  headingSlugs: Map<string, string>,
): string {
  const out: string[] = [];
  let keep = false;
  for (const line of body.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      if (level === 1) {
        // The title names the period, not a domain, so it is not a leak.
        out.push(line);
        continue;
      }
      if (level === 2) {
        const slug = headingSlugs.get(text.toLowerCase());
        keep = slug !== undefined && grant.domainSlugs.includes(slug);
      }
      if (keep) out.push(line);
      continue;
    }
    if (keep) out.push(line);
  }
  return out.join("\n");
}

/**
 * KAR-70: a review record reduced to the assigned domains. `scopes` keeps only
 * granted slugs — the `overall` scope belongs to the companion — so the agent
 * cannot learn that another domain's review exists.
 */
export function projectConnectedReview(
  review: ReviewRecord,
  grant: ConnectedGrant,
  headingSlugs: Map<string, string>,
): ReviewRecord {
  const scopes: Record<string, ReviewScopeState> = {};
  for (const [slug, state] of Object.entries(review.scopes)) {
    if (grant.domainSlugs.includes(slug)) scopes[slug] = state;
  }
  return {
    ...review,
    scopes,
    bodyMarkdown: projectConnectedReviewBody(review.bodyMarkdown, grant, headingSlugs),
  };
}

/** True when a review still has at least one scope the agent may read. */
export function connectedReviewVisible(
  scopes: Record<string, { status: string; sessionId: string | null }>,
  grant: ConnectedGrant,
): boolean {
  return Object.keys(scopes).some((slug) => grant.domainSlugs.includes(slug));
}