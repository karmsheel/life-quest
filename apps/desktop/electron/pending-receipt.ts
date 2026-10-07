/**
 * The one receipt waiting to ride the next turn.
 *
 * The slot is why a turn's image and a row's `source_file` cannot drift apart.
 * The renderer is handed the path and a thumbnail it made from the file it was
 * given, and it sends the path back; main resolves the bytes it stored itself.
 * A renderer that named one path and sent another image would be a bug in a
 * file nobody looks at twice, so the pairing is structural instead.
 *
 * One slot, because the composer carries one receipt at a time. An attach
 * replaces whatever was waiting, and a take clears it only when the path
 * matches, so a stale path cannot consume a fresh receipt.
 */
export type PendingReceipt = {
  relPath: string;
  name: string;
  /** The model copy, as the `image_url` part the turn posts. */
  dataUrl: string;
  bytes: number;
};

let slot: PendingReceipt | null = null;

export const pendingReceipt = {
  set(value: PendingReceipt): void {
    slot = value;
  },

  /** The receipt when it is the one named; otherwise null, slot intact. */
  take(relPath: string): PendingReceipt | null {
    if (!slot || slot.relPath !== relPath) return null;
    const taken = slot;
    slot = null;
    return taken;
  },

  peek(): PendingReceipt | null {
    return slot;
  },

  clear(): void {
    slot = null;
  },
};
