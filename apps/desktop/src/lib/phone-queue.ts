/**
 * The phone's queue, as the dock reads it.
 *
 * The bridge is the product's own `window.lifequest.phone`. A harness page has
 * no preload: its stub is a Proxy that answers an unknown name with a function
 * returning a Promise, so calling `api().phone.queue` there is a TypeError and
 * calling its "unsubscribe" in a cleanup is the same crash on unmount. A page
 * with no real bridge has no phone surface, and the dock must then behave as it
 * did before the strip existed — no read, no listener, no error.
 */
import { api } from "@/lib/ipc";
import type { PhoneDraftView } from "@/vite-env";

type PhoneBridge = {
  queue: () => Promise<{ drafts: PhoneDraftView[]; count: number }>;
  onChanged: (cb: () => void) => () => void;
};

export function phoneBridge(): PhoneBridge | null {
  const bridge = (api() as unknown as { phone?: Partial<PhoneBridge> }).phone;
  if (
    !bridge ||
    typeof bridge.queue !== "function" ||
    typeof bridge.onChanged !== "function"
  ) {
    return null;
  }
  return bridge as PhoneBridge;
}

/** Read the waiting drafts; an absent bridge or a refusal is an empty queue. */
export async function readPhoneQueue(): Promise<PhoneDraftView[]> {
  const bridge = phoneBridge();
  if (!bridge) return [];
  try {
    const queue = await bridge.queue();
    return Array.isArray(queue?.drafts) ? queue.drafts : [];
  } catch {
    return [];
  }
}

/** Subscribe to the door's own changes, when the bridge can unsubscribe. */
export function onPhoneQueueChanged(listener: () => void): () => void {
  const bridge = phoneBridge();
  if (!bridge) return () => {};
  try {
    const off = bridge.onChanged(listener);
    return typeof off === "function" ? off : () => {};
  } catch {
    return () => {};
  }
}
