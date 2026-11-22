/**
 * The decisions inbox's read cache, in the main process.
 *
 * THE FAULT THIS REPAIRS (reported, not imagined):
 *
 *   "When the user is approving decisions, it takes a long time to approve."
 *
 * Measured on the operator's own vault (819 Decision files, 6 areas, 41 MB):
 * one `decision:list` — read every Decision file, then resolve display labels
 * for all of them — costs 1.1–2.1 s, and a single approve press asked for it
 * five or six times. Every surface that draws Decisions hears the same
 * `vault:dataChanged` announcement (the rail's badge, the auto-open watcher, the
 * dashboard behind the sheet, the inbox itself) and each one re-read the whole
 * store; on top of that the inbox read it again for its own answer and once
 * more to decide whether the queue was empty. All of those reads are serialized
 * behind the vault's one write queue, so the NEXT approve press waited behind
 * them — the queue of answers grew slower with every card answered.
 *
 * WHAT THIS HOLDS
 *
 * The labeled list, for the vault that is open. `decision:list` answers from it
 * when it is valid, so a burst of approvals does no disk reading at all: the
 * renderer's live re-reads all answer from one cached array.
 *
 * WHY IT IS NOT A SECOND SOURCE OF TRUTH
 *
 * The app already has one change signal — `data-revision.ts`'s `noteDataChanged`,
 * fired by both write doors (the IPC registrar and the MCP tool door) and by a
 * window regaining focus, which is how external edits to a synced folder
 * surface. The cache is invalidated from exactly those points, so it is valid
 * precisely while the app's own live architecture says nothing has been written,
 * and stale for exactly as long as any other live reader of the same signal.
 *
 * A Decision write is the one mutation that does NOT throw the list away. The
 * write returns the record it wrote, so the cached list is patched in place with
 * that record instead of being re-read from disk: an approve burst would
 * otherwise invalidate the cache on every card and pay a full read for each one.
 * That patch also moves the generation below, which is what stops a read that
 * left before the write from storing its superseded answer afterwards.
 *
 * THE ONE THING IT DOES NOT SEE
 *
 * A Decision file changed on disk by something other than this process — a sync
 * client, a hand repair — is not noticed until the next invalidation (a write
 * from any door, or the window regaining focus). That is the same moment the
 * rest of the app notices external changes, and `noteDataChanged()` is already
 * fired on focus for exactly this reason.
 */
import type { DecisionRecord } from "@lifequest/vault-core";

/** The valid cached list, and the vault it belongs to. */
let cache: { root: string; records: DecisionRecord[] } | null = null;

/**
 * Moves whenever the cached answer stops being current.
 *
 * A read that started when the generation was N may only store its result if
 * the generation is still N: a write that landed while the read was in flight
 * makes that read's answer older than the write, and storing it would hand every
 * later reader a resolved card that is still pending.
 */
let generation = 0;

/** The current generation, captured by a read before it starts. */
export function decisionListGeneration(): number {
  return generation;
}

/** The cached list for this vault, or null when it must be read from disk. */
export function cachedDecisionList(root: string): DecisionRecord[] | null {
  return cache !== null && cache.root === root ? cache.records : null;
}

/**
 * Store a read that finished — unless a write superseded it while it ran.
 *
 * Returns whether the list was stored, which is only ever a diagnostic: a
 * superseded read is discarded, and the next caller simply reads again.
 */
export function storeDecisionList(
  root: string,
  records: DecisionRecord[],
  startedAtGeneration: number,
): boolean {
  if (startedAtGeneration !== generation) return false;
  cache = { root, records };
  return true;
}

/**
 * Patch one Decision into the cached list after a write of it landed.
 *
 * No cache means nothing to keep true, but the generation still moves: a read
 * already in flight must not store the pre-write answer it is carrying when the
 * later callers will be asking about the world after the write.
 */
export function patchCachedDecision(
  root: string,
  record: DecisionRecord,
): void {
  generation += 1;
  if (cache === null || cache.root !== root) return;
  const index = cache.records.findIndex((existing) => existing.id === record.id);
  if (index === -1) {
    // A Decision filed after the cached read. Newest-first is the page's own
    // sort, so where it sits here does not matter; it only has to be present.
    cache = { root, records: [...cache.records, record] };
    return;
  }
  const records = cache.records.slice();
  records[index] = record;
  cache = { root, records };
}

/**
 * Throw the cached list away.
 *
 * Called from every door that can change what a `decision:list` would answer:
 * a non-Decision write through the IPC registrar, an MCP tool call that writes,
 * a vault open or switch, and a window regaining focus.
 */
export function invalidateDecisionList(): void {
  cache = null;
  generation += 1;
}
