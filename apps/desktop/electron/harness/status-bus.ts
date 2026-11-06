// The status bus, shared by every harness.
//
// The renderer subscribes once, when the app mounts, before any harness has
// been chosen. So the listener set cannot belong to a harness: it belongs to
// the app, and whichever harness is active publishes into it.
import type { HarnessStatus } from "./types.ts";

type Listener = (status: HarnessStatus) => void;

const listeners = new Set<Listener>();

/**
 * Tell every listener. A listener that throws is caught: this runs inside an
 * ensure's success path, and a broken consumer must not be able to turn a
 * working companion into a failed one. Same rule as `data-revision.ts`.
 */
export function publishHarnessStatus(status: HarnessStatus): HarnessStatus {
  for (const listener of [...listeners]) {
    try {
      listener(status);
    } catch {
      // The consumer's failure is its own; the status it heard about is true.
    }
  }
  return status;
}

/** Listen for status changes. Returns the unsubscribe. */
export function onHarnessStatusChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
