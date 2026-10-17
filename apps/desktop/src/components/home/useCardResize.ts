import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { unitsForWidth } from "@/components/home/tile-span";
import type { TileBoard } from "@/components/home/useTileSpans";

/**
 * The operator's own hand on a card's width.
 *
 * The board sizes a card from what it holds, and the operator asked for more
 * control than that: "is there a way to give the user more control over the width
 * of the tables/cards?" — answered with the most direct gesture there is. The
 * right edge of a card is a handle; dragging it makes the card as wide as the hand
 * says, and the width is saved on the pin so the card is that wide tomorrow.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS THE POINT
 *
 * A drag can never make a card narrower than its own content needs. The floor is
 * read from the same measurement that sizes every card on the board
 * (`useTileSpans`), and the drag stops there — because a card narrower than its
 * table is the spill this whole feature was reported for, and rebuilding that
 * fault as a gesture would be absurd. So the handle's range is
 * [the content's own units, the whole row], and dragging to the far end means
 * "fill the row", which is the same thing the chrome's width button means.
 *
 * THE PREVIEW IS GEOMETRY, THE DROP IS THE WRITE — the same split the arrange
 * gesture makes. While the pointer is down the card's `grid-column` is written
 * straight onto the element, so the operator sees the card they are dragging and
 * the board reflows around it; nothing reaches the vault until the pointer comes
 * up, and a drag that ends where it started writes nothing at all.
 *
 * KEYBOARD. The handle is a `separator` and a tab stop: the left and right arrows
 * step the width one unit at a time and each step is saved. That is deliberately
 * not the arrange gesture's "lift, aim, drop" — a width is a number, and stepping
 * a number is what arrows are for.
 */

/** What a drag in progress is holding. */
type Drag = {
  pinId: string;
  pointerId: number;
  /** The card's own left edge on screen, so the pointer names a width. */
  left: number;
  /** The layout step and gutter the board is drawing with, read when the drag began. */
  step: number;
  gap: number;
  /** The width the card had when the drag began, in units. */
  from: number;
  /** What the drag would leave it at, in units. */
  units: number;
  minUnits: number;
  maxUnits: number;
};

export type CardResize = {
  /** True while a width is being dragged: the board stands down and re-measures after. */
  isResizing: boolean;
  /** Which card is under the hand, so that card can be drawn as the one being resized. */
  resizingPinId: string | null;
  /**
   * The handle's own handlers: the press that starts a drag, and the keys that step
   * one. The drag's MOVE and UP are not here — they are on the window, because the
   * pointer leaves the handle almost immediately (it is six pixels wide) and a
   * gesture that stopped hearing the pointer at the card's edge would be a gesture
   * that only worked while the operator stayed inside the card they were resizing.
   */
  handleProps: (pinId: string) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** What the last gesture said, for the board's live region. */
  announce: string;
};

/**
 * A card's box, and the units a pointer position names for it.
 *
 * Snapping is to whole units, because a width is a whole number of them: a card
 * halfway between two is a card the board cannot place. The clamp is what keeps
 * the gesture honest — see the note above — and `maxUnits` is the whole row, where
 * the answer stops being a width in units at all and becomes "fill the row".
 */
function unitsAtPointer(
  clientX: number,
  left: number,
  board: { minUnits: number; maxUnits: number; step: number; gap: number },
): number {
  const wanted = unitsForWidth(clientX - left, board.step, board.gap, board.minUnits);
  return Math.max(board.minUnits, Math.min(board.maxUnits, wanted));
}

export function useCardResize(input: {
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** What the board measured: the step, the gutters, and each card's own floor. */
  tiles: TileBoard;
  /** Locked boards have no handle at all; this is the second gate. */
  locked: boolean;
  /**
   * Whether the feature is switched on at all — Settings → Developer's card width
   * handle flag. It needs saying here as well as on the board, because the handle
   * is only one of the ways a press can arrive: a tab stop left behind, a stale
   * render, or a rig reaching for `[data-pin-handle]` all have to find a gesture
   * that refuses to start.
   */
  enabled: boolean;
  /** A board write in flight: a drag must not start or continue. */
  busy: boolean;
  /** Told when a width gesture starts and ends, so the board can stand down. */
  onGesture: (active: boolean) => void;
  /** The board's one write path, told what the operator chose. */
  onCommit: (pinId: string, units: number, maxUnits: number) => Promise<unknown>;
}): CardResize {
  const { gridRef, tiles, locked, busy, enabled, onGesture, onCommit } = input;
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState("");

  /** The card a pin is drawn as. `CSS.escape` because a pin id holds a colon. */
  const cardIn = useCallback(
    (pinId: string): HTMLElement | null =>
      gridRef.current?.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(pinId)}"]`) ?? null,
    [gridRef],
  );

  /**
   * Draw the drag: the card's span, straight onto the element.
   *
   * At the far end of the range the answer is the row itself, which is the sheet's
   * own `1 / -1` — the same mark a span-2 pin wears, so a drag that fills the row
   * and the chrome button that fills it leave the board in one state, not two.
   */
  const preview = useCallback(
    (current: Drag) => {
      const card = cardIn(current.pinId);
      if (!card) return;
      const span = current.units >= current.maxUnits ? "1 / -1" : `span ${current.units}`;
      if (card.style.gridColumn !== span) card.style.gridColumn = span;
    },
    [cardIn],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !enabled || locked || busy || dragRef.current) return;
      const pinId = event.currentTarget.dataset.pinHandle;
      const card = pinId ? cardIn(pinId) : null;
      if (!pinId || !card) return;
      // The handle is the gesture's, not the board's: the arrange gesture is armed
      // by a press on the grid, and a resize that also picked the card up would be
      // two gestures from one press. `usePinArrange` skips `[data-pin-handle]` on
      // its own side as well; this is the same rule stated where the press lands.
      event.preventDefault();
      event.stopPropagation();
      const maxUnits = Math.max(1, tiles.trackCount());
      const minUnits = Math.min(maxUnits, Math.max(tiles.minUnits(), tiles.minUnitsFor(pinId)));
      const from = Math.max(minUnits, Math.min(maxUnits, tiles.unitsOf(pinId)));
      const current: Drag = {
        pinId,
        pointerId: event.pointerId,
        left: card.getBoundingClientRect().left,
        step: tiles.step(),
        gap: tiles.gap(),
        from,
        units: from,
        minUnits,
        maxUnits,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Without capture the drag still works inside the card; the window's own
        // blur still ends it cleanly.
      }
      dragRef.current = current;
      setDrag(current);
      onGesture(true);
    },
    [busy, cardIn, enabled, locked, onGesture, tiles],
  );

  /**
   * The drag's own listeners: on the WINDOW, not on the handle.
   *
   * The handle is six pixels wide and the pointer leaves it on the first move, so
   * a drag that only heard the pointer while it was over the handle would be a
   * drag that stopped the moment it began. Pointer capture is the usual answer and
   * it is asked for below — but capture is a convenience here and never the
   * mechanism: this is the same choice the arrange gesture makes when it puts its
   * moves on the grid rather than on the card, one level further out, because a
   * width can be dragged past the edge of the board.
   *
   * Registered once for the hook's life and gated on `dragRef` being set, which
   * keeps a handler from being torn down and re-attached in the middle of the
   * gesture it is serving.
   */
  /**
   * The drop: one write, and only when the width actually changed.
   *
   * The card's own width on screen is left where the drag put it — the page's
   * write path puts the same width back through React, and a card that snapped
   * back to where it started while the write was in flight would undo the gesture
   * the operator just made.
   */
  const finish = useCallback(
    (current: Drag) => {
      dragRef.current = null;
      setDrag(null);
      onGesture(false);
      if (current.units === current.from) {
        setAnnounce("Width unchanged.");
        return;
      }
      const filled = current.units >= current.maxUnits;
      setAnnounce(
        filled
          ? "Card set to fill the row."
          : `Card width set to ${current.units} of ${current.maxUnits} columns.`,
      );
      void onCommit(current.pinId, current.units, current.maxUnits);
    },
    [onCommit, onGesture],
  );

  /** Put a card back where a cancelled drag found it: a cancelled drag is not a width. */
  const cancel = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    setDrag(null);
    onGesture(false);
    const card = cardIn(current.pinId);
    if (card) {
      card.style.gridColumn =
        current.from >= current.maxUnits ? "1 / -1" : `span ${current.from}`;
    }
    setAnnounce("Width change cancelled.");
  }, [cardIn, onGesture]);

  /**
   * The drag's own listeners: on the WINDOW, not on the handle.
   *
   * The handle is six pixels wide and the pointer leaves it on the first move, so
   * a drag that only heard the pointer while it was over the handle would be a
   * drag that stopped the moment it began. Pointer capture is the usual answer and
   * it is asked for below — but capture is a convenience here and never the
   * mechanism: this is the same choice the arrange gesture makes when it puts its
   * moves on the grid rather than on the card, one level further out, because a
   * width can be dragged past the edge of the board.
   *
   * Gated on `dragRef` rather than on the drag state, so a handler is never torn
   * down and re-attached in the middle of the gesture it is serving.
   */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const units = unitsAtPointer(event.clientX, current.left, current);
      if (units === current.units) return;
      const next: Drag = { ...current, units };
      dragRef.current = next;
      setDrag(next);
      preview(next);
    };
    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      finish(current);
    };
    const onCancel = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current && current.pointerId === event.pointerId) cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [cancel, finish, preview]);

  /**
   * The keyboard's half: one unit per press, saved as it is pressed.
   *
   * The arrows are the same gesture the pointer makes, in the same range — the
   * content's floor at one end and the row at the other — and a press is a whole
   * gesture, so each one is written. A separator's arrows are also how a screen
   * reader's owner resizes a column, which is what this is.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (!enabled || locked || busy || dragRef.current) return;
      const pinId = event.currentTarget.dataset.pinHandle;
      if (!pinId) return;
      event.preventDefault();
      event.stopPropagation();
      const maxUnits = Math.max(1, tiles.trackCount());
      const minUnits = Math.min(maxUnits, Math.max(tiles.minUnits(), tiles.minUnitsFor(pinId)));
      const from = Math.max(minUnits, Math.min(maxUnits, tiles.unitsOf(pinId)));
      const units = Math.max(
        minUnits,
        Math.min(maxUnits, from + (event.key === "ArrowRight" ? 1 : -1)),
      );
      if (units === from) {
        setAnnounce(
          event.key === "ArrowRight"
            ? "This card already fills the row."
            : "This card is already as narrow as its content allows.",
        );
        return;
      }
      const current: Drag = {
        pinId,
        pointerId: -1,
        left: 0,
        step: tiles.step(),
        gap: tiles.gap(),
        from,
        units,
        minUnits,
        maxUnits,
      };
      preview(current);
      setAnnounce(`Card width set to ${units} of ${maxUnits} columns.`);
      void onCommit(pinId, units, maxUnits);
    },
    [busy, enabled, locked, onCommit, preview, tiles],
  );

  /** Escape and a lost window end a drag the way the arrange gesture ends one. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  // Nothing may be left mid-drag: a gesture in flight when the page goes away
  // must not leave a rAF, a listener, or a card drawn at a width nobody chose.
  useEffect(() => () => cancel(), [cancel]);

  const handleProps = useCallback(
    (pinId: string) => ({
      /**
       * `data-pin-handle`, NOT `data-pin-id`: the board's own gestures and the
       * scroll hold all find cards with `[data-pin-id]`, and a handle wearing it
       * would be read as a card — a second slot in the drop geometry, a second
       * anchor for the hold. The pin it belongs to rides in the value instead.
       */
      "data-pin-handle": pinId,
      onPointerDown,
      onKeyDown,
    }),
    [onKeyDown, onPointerDown],
  );

  return { isResizing: drag !== null, resizingPinId: drag?.pinId ?? null, handleProps, announce };
}
