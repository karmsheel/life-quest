/**
 * The vault's change signal: one number that moves whenever something a
 * dashboard card reads has been written, and one way to hear about it.
 *
 * WHY THIS EXISTS (reported, not imagined): the operator told the companion to
 * log an expense, then looked at the pinned "Recent transactions" card and the
 * expense was not on it. The card's spec was a live query and the engine had
 * always re-run it correctly — but nothing ever ASKED it to run again. A card
 * re-ran on mount and when its own presentation switch was clicked, and never
 * when the rows underneath it changed. The Life log agreed: the capture was
 * posted at 19:59:33, and the card's view file had last been touched at 19:54:42.
 *
 * The signal is drawn from the app's two write doors, which are the two places a
 * change is knowable in the main process without instrumenting every writer in
 * vault-core:
 *
 *  - the MCP door, which is the only way the companion writes rows. Every tool
 *    call it serves funnels through `executeTool` in `map-tools.ts`.
 *  - the IPC door, which is the only way the renderer writes anything. Every
 *    channel it serves is registered in one function in `main.ts`.
 *
 * Both are classified by NAME below, and the two classifications fail in
 * opposite directions on purpose:
 *
 *  - IPC: a fixed list of channels that can write. A channel this list does not
 *    name is assumed to only read. That direction is the safe one here, because
 *    the renderer's re-render itself issues reads — and a read that announced a
 *    change would drive the cards to re-run forever. A missed entry costs a
 *    stale card until the next write, focus, or day change.
 *  - MCP: a fixed list of tools that only read. Anything else is assumed to have
 *    changed something. That direction is safe there because a tool call is
 *    never caused by a card re-running, so there is no loop to fear — and the
 *    cost of the wrong guess is one wasted repaint, against a missed write
 *    being exactly the bug this module exists to fix.
 *
 * This module is deliberately free of Electron imports: it is a counter and two
 * functions, so a test can drive it in plain Node.
 */

let revision = 0;
const listeners = new Set<(revision: number) => void>();

/** How many changes have been noted. Monotonic; only its movement matters. */
export function dataRevision(): number {
  return revision;
}

/**
 * Note that the vault changed, and tell everyone listening.
 *
 * A listener that throws is caught rather than propagated: this is called from
 * inside a write's success path, and a broken listener must not be able to turn
 * a posted expense into a failed one.
 */
export function noteDataChanged(): number {
  revision += 1;
  for (const listener of [...listeners]) {
    try {
      listener(revision);
    } catch {
      // A listener's failure is its own; the write it heard about already landed.
    }
  }
  return revision;
}

/** Listen for changes. Returns the unsubscribe. */
export function onDataChanged(listener: (revision: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The IPC channels that can change what a dashboard card draws.
 *
 * The rule for membership: if a successful call could move a number, a row, a
 * label, or a board, it belongs here. Reads do not — see the note at the top of
 * this file for why that direction is the one that has to be explicit.
 *
 * `settings:update` is here for a reason that is easy to miss: it carries the
 * finance home currency and the operator's USD→ZAR rate, and those change what
 * every money card on the board says without a single row being written.
 */
export const MUTATING_CHANNELS: ReadonlySet<string> = new Set([
  // the vault itself
  "vault:create",
  // domains
  "domain:create",
  "domain:update",
  "domain:archive",
  "domain:unarchive",
  "domain:delete",
  // databases, their schema, their rows, and the adapter sync that writes rows
  "db:create",
  "db:addColumn",
  "db:upsertRow",
  "db:deleteRow",
  "db:fileSave",
  "db:restoreBooks",
  "db:linkAdapter",
  "db:unlinkAdapter",
  "db:sync",
  "db:resolveConflict",
  // ingest: a batch is written when it is accepted, and edited before that
  "ingest:file",
  "ingest:proposeMapping",
  "ingest:editRow",
  "ingest:accept",
  "ingest:reject",
  // pages, their blocks, and the script a page applies
  "page:create",
  "page:update",
  "page:delete",
  "script:apply",
  // the boards themselves
  "pins:set",
  "pins:setLocked",
  // saved view cards
  "view:save",
  "view:delete",
  // doctrine documents and library notes
  "document:save",
  "document:setLocked",
  "document:mediaSave",
  "library:create",
  "library:update",
  "library:delete",
  "library:setLocked",
  // the finance kit and what it reads
  "kit:installFinance",
  "kit:setCaptureAccount",
  "fx:refresh",
  "fx:setSource",
  "finance:saveAssumptionSet",
  // Decisions: creating one and resolving one both change what is pending
  "decision:create",
  "decision:resolve",
  // A logged manual decision changes History and the manual tab's own list.
  "manualDecision:create",
  // the chain, projects, the roster, the map, goals, reviews, daily notes
  "signalChain:create",
  "signalChain:update",
  "signalChain:delete",
  "projects:create",
  "projects:update",
  "agents:hire",
  "agents:dismiss",
  "connectedAgents:update",
  "connectedAgents:revoke",
  "connectedAgents:invite",
  "connectedAgents:dropInvite",
  "map:apply",
  "goals:apply",
  "review:ensure",
  "review:write",
  "review:markDone",
  "review:unlock",
  "review:prepopulate",
  "review:skillWrite",
  "note:write",
  "planning:ensure",
  // settings carry the currency and the FX rate
  "settings:update",
]);

/** Whether a successful call on this channel could have changed the data. */
export function channelMayChangeData(channel: string): boolean {
  return MUTATING_CHANNELS.has(channel);
}

/**
 * The MCP tools that only read.
 *
 * These are the discovery and inspection tools, and they are the ones a model
 * calls in bursts — a dozen `list_rows` and `preview_view` calls while it works
 * out what a database holds. Skipping them saves a repaint per call; missing one
 * from this set would only cost a repaint, which is the direction this list is
 * allowed to be wrong in.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "get_state",
  "get_doctrine",
  "get_week",
  "list_goals",
  "list_domains",
  "list_databases",
  "get_database",
  "list_rows",
  "get_row",
  "list_decisions",
  "list_views",
  "get_view",
  "get_dashboard",
  "preview_view",
  "list_documents",
  "get_document",
  "list_daily_notes",
  "get_daily_note",
  "get_review",
  "list_reviews",
  "get_period_pack",
  "get_review_skill",
  "list_projects",
  "get_project",
  "library_list",
  "library_get",
  "list_library_notes",
  "get_library_note",
  "list_connected_agents",
]);

/**
 * Whether a tool call could have changed what a dashboard card draws.
 *
 * Inverted on purpose: a tool this list does not know about is treated as a
 * write, because a wrong guess here costs one repaint, and the other wrong guess
 * is the stale dashboard this module was written to fix.
 */
export function toolMayChangeData(name: string): boolean {
  return !READ_ONLY_TOOLS.has(name);
}
