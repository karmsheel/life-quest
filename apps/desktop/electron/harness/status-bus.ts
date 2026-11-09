// The status bus, shared by every harness.
//
// The renderer subscribes once, when the app mounts, before any harness has
// been chosen. So the listener set cannot belong to a harness: it belongs to
// the app, and whichever harness is active publishes into it.
//
// The bus is also the app's status ledger. Every status is tagged with the
// agent that produced it and remembered per agent, because a switch made while
// the app is already on screen must not wait for the target to come up: the
// switch answers at once with whatever is known, and a late publish from the
// agent the operator just left can still arrive (a Hermes gateway restart
// outlives the click). Tagging is what lets the renderer drop that late answer
// instead of painting it over the agent the operator is now on.
import type { HarnessId, HarnessStatus } from "./types.ts";

/** A status with the agent that produced it. `ready` already carries one. */
export type TaggedHarnessStatus = HarnessStatus & { harness?: HarnessId };

type Listener = (status: TaggedHarnessStatus) => void;

const listeners = new Set<Listener>();

/** The last status each agent reported, for the fast switch to answer with. */
const lastByHarness = new Map<HarnessId, TaggedHarnessStatus>();

/**
 * Tell every listener which agent reported what.
 *
 * A listener that throws is caught: this runs inside an ensure's success path,
 * and a broken consumer must not be able to turn a working companion into a
 * failed one. Same rule as `data-revision.ts`.
 */
export function publishHarnessStatus(
  harness: HarnessId,
  status: HarnessStatus,
): TaggedHarnessStatus {
  const tagged: TaggedHarnessStatus = { ...status, harness };
  lastByHarness.set(harness, tagged);
  for (const listener of [...listeners]) {
    try {
      listener(tagged);
    } catch {
      // The consumer's failure is its own; the status it heard about is true.
    }
  }
  return tagged;
}

/** What this agent last said, or null when it has never answered. */
export function lastHarnessStatus(harness: HarnessId): TaggedHarnessStatus | null {
  return lastByHarness.get(harness) ?? null;
}

/** Listen for status changes. Returns the unsubscribe. */
export function onHarnessStatusChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
