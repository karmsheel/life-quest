/**
 * The attachments waiting to ride the next turn.
 *
 * This is the general-attachment twin of `pending-receipt.ts`, and it exists
 * for the same reason: the renderer is handed an id and a description of the
 * file, and it sends the id back; main resolves the bytes it stored itself. A
 * renderer that named one file and sent another would be a bug in a file
 * nobody looks at twice, so the pairing is structural rather than a matter of
 * trust.
 *
 * A LIST, not a slot, because the composer may hold several attachments at
 * once. The receipt keeps its own single slot: a receipt is one image with one
 * meaning, and its path rides the turn as `receiptRelPath`, which is a
 * different field on a different wire.
 *
 * The id is the join key. It is minted here, at attach time, and it is what
 * the renderer sends back; the stored path never crosses the boundary twice,
 * so a stale id cannot make the agent read a file the operator did not attach.
 */
import type { AttachmentKind } from "./attachment-store.js";

/**
 * One attachment, as the turn needs to describe it.
 *
 * `relPath` and the data URL are main's own facts and never travel to the
 * renderer: the renderer sends the id back and main resolves the rest, so the
 * path the agent is told about and the file on disk cannot come from two
 * different places.
 */
export type PendingAttachment = {
  /** The join key the renderer sends back with the turn. */
  id: string;
  kind: AttachmentKind;
  /** The stored file name, safe and readable. */
  name: string;
  /** The byte length of the original. */
  size: number;
  /** The mime the store settled on. */
  mime: string;
  /** Where the original lives in the vault, relative to the vault root. */
  relPath: string;
  /**
   * The inline copy for an image, or null for everything else.
   *
   * Only the two formats the model providers decode (JPEG and PNG) get one.
   * A GIF or a WEBP is stored and named, but it cannot ride the turn as an
   * image part, so the agent is pointed at its path instead.
   */
  dataUrl: string | null;
};

/** The attachments attached so far, in the order they were attached. */
let slot: PendingAttachment[] = [];

/**
 * The pending-attachment store.
 *
 * `set` replaces the whole list: an attach is a fresh set of files, and the
 * composer's own state is what says which ones are still on screen. `take`
 * removes exactly the attachments the turn named and leaves the rest, so a
 * turn that carries two of three attachments does not strand the third.
 */
export const pendingAttachments = {
  /** Record the attachments just attached. */
  set(values: PendingAttachment[]): void {
    slot = values.map((value) => ({ ...value }));
  },

  /** Add one attachment to the pending set. */
  add(value: PendingAttachment): void {
    slot = [...slot, { ...value }];
  },

  /**
   * The attachments the turn named, removed from the pending set.
   *
   * An id that is not pending yields nothing rather than an error: the turn
   * that asks for an attachment the app no longer holds is a turn whose
   * attachments could not be described, and the caller reports that.
   */
  take(ids: string[]): PendingAttachment[] {
    const wanted = new Set(ids);
    const taken = slot.filter((value) => wanted.has(value.id));
    if (taken.length > 0) {
      slot = slot.filter((value) => !wanted.has(value.id));
    }
    return taken;
  },

  /** What is waiting, without taking it. */
  peek(): PendingAttachment[] {
    return slot.map((value) => ({ ...value }));
  },

  /** One attachment by id, without taking it. */
  find(id: string): PendingAttachment | null {
    return slot.find((value) => value.id === id) ?? null;
  },

  clear(): void {
    slot = [];
  },
};
