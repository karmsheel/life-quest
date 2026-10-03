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
import type { DecisionRecord, DocumentTarget, Goal, MapEvent, PeriodPack, Task } from "./types.ts";
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
 * KAR-70: the first gate. `NO_GRANT` means the row itself reaches nothing —
 * approval alone is not a grant. `FORBIDDEN` means the row has a grant and this
 * tool is outside it.
 *
 * A read is allowed as soon as one assigned domain remains; which records it
 * may actually see is settled per call by the projection, not here. The write
 * lists are the write task's to fix: this returns the refusal, and the write
 * task decides which writes an assigned domain opens.
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
  if (isSchedule && !grant.schedule) return "FORBIDDEN";
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