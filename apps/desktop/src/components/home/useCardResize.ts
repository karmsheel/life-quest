import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { unitsForWidth } from "@/components/home/tile-span";
import type { TileBoard } from "@/components/home/useTileSpans";

/**
 * The operator's own hand on a card's size, while the card is in Edit mode.
 *
 * Edit card puts one card in Edit mode, and its right and bottom borders become
 * drag handles. Right makes the card wider, bottom makes it taller, and the size
 * is saved on the pin so the card is that size tomorrow. The old chrome button
 * could only say "fill the row" or "size to the content"; this is the same pins
 * carrying the same numbers, with a hand on both axes instead of a two-state
 * button.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS THE POINT
 *
 * A drag can never make a card narrower than its own content needs, nor shorter
 * than its own content is tall. Both floors are read from the same measurement
 * that sizes every card on the board (`useTileSpans`), and each drag stops there
 * — because a card smaller than its table is the spill this board was reported
 * for, and rebuilding that fault as a gesture would be absurd. The width range is
 * [the content's own units, the whole row], and the far end means "fill the row".
 * Height has no ceiling of its own: it is a floor on the card, so an operator can
 * give a short card room to breathe without ever making its content spill.
 *
 * THE PREVIEW IS GEOMETRY, THE DROP IS THE WRITE — the same split the arrange
 * gesture makes. While the pointer is down the card's `grid-column` (width) or
 * `min-height` (height) is written straight onto the element, so the operator sees
 * the card they are dragging and the board reflows around it; nothing reaches the
 * vault until the pointer comes up, and a drag that ends where it started writes
 * nothing at all.
 *
 * KEYBOARD. Each handle is a `separator` and a tab stop: the left and right arrows
 * step the width one unit at a time, the up and down arrows step the height one
 * rem at a time, and each step is saved. That is deliberately not the arrange
 * gesture's "lift, aim, drop" — a size is a number, and stepping a number is what
 * arrows are for.
 */

/** Which border the operator has hold of. */
export type ResizeAxis = "width" | "height";

/** The size one gesture chose, as the page's write path takes it. */
export type CardSizePatch = {
  span?: 1 | 2;
  width?: number;
  height?: number;
};

/** What a drag in progress is holding. */
type Drag = {
  pinId: string;
  axis: ResizeAxis;
  pointerId: number;
  /** The card's own left and top edges on screen, so the pointer names a size. */
  left: number;
  top: number;
  /** The layout step and gutter the board is drawing with, read when the drag began. */
  step: number;
  gap: number;
  /** The width the card had when the drag began, in units. */
  fromUnits: number;
  units: number;
  minUnits: number;
  maxUnits: number;
  /** The height the card had when the drag began, in pixels. */
  fromHeight: number;
  height: number;
  minHeight: number;
  maxHeight: number;
  /** What the element looked like before the preview, for a cancel. */
  fromGridColumn: string;
  fromMinHeight: string;
  /** The root font size, for turning a pixel height into rem. */
  root: number;
};

export type CardResize = {
  /** True while a size is being dragged: the board stands down and re-measures after. */
  isResizing: boolean;
  /** Which card is under the hand, so that card can be drawn as the one being resized. */
  resizingPinId: string | null;
  /** Which border is being dragged, so the board's cursor can follow it. */
  resizingAxis: ResizeAxis | null;
  /**
   * A handle's own handlers: the press that starts a drag, and the keys that step
   * one. The drag's MOVE and UP are not here — they are on the window, because the
   * pointer leaves the handle almost immediately and a gesture that stopped
   * hearing the pointer at the card's edge would only work while the operator
   * stayed inside the card they were resizing.
   */
  handleProps: (pinId: string, axis: ResizeAxis) => {
    "data-pin-handle": string;
    "data-pin-handle-axis": ResizeAxis;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** What the last gesture said, for the board's live region. */
  announce: string;
};

/**
 * A card's width box, and the units a pointer position names for it.
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

/**
 * The width a card is drawn at when a gesture begins.
 *
 * A measured card is `tiles.unitsOf`. A card that owns the row by design — the
 * operator's stored span 2, or a card drawn as furniture across the board — is at
 * the row's width even though the measurement pass deliberately leaves its inline
 * span alone. Starting such a card at its content floor would make the first
 * pixel of a leftward drag jump it from the whole row to the narrowest it can be;
 * starting at the row makes the gesture continuous.
 */
function unitsOfCard(
  card: HTMLElement,
  pinId: string,
  tiles: TileBoard,
  maxUnits: number,
): number {
  const ownsRow =
    card.classList.contains("home-pin--span2") ||
    (!card.classList.contains("home-pin--sized") &&
      card.querySelector(".home-card--wide, .deadline-banner") !== null);
  if (ownsRow) return maxUnits;
  return Math.max(1, Math.min(maxUnits, tiles.unitsOf(pinId)));
}

export function useCardResize(input: {
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** What the board measured: the step, the gutters, and each card's own floor. */
  tiles: TileBoard;
  /** Locked boards have no handles at all; this is the second gate. */
  locked: boolean;
  /**
   * Whether Edit mode is on. The handles are only rendered while it is, and this
   * is the gate a stale render or a rig would otherwise slip past.
   */
  enabled: boolean;
  /** A board write in flight: a drag must not start or continue. */
  busy: boolean;
  /** Told when a size gesture starts and ends, so the board can stand down. */
  onGesture: (active: boolean) => void;
  /** The board's one write path, told what the operator chose. */
  onCommit: (pinId: string, patch: CardSizePatch) => Promise<unknown>;
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
   * Draw the drag: the card's span or its height, straight onto the element.
   *
   * At the far end of the width range the answer is the row itself, which is the
   * sheet's own `1 / -1` — the same mark a span-2 pin wears, so a drag that fills
   * the row and a companion that stores one leave the board in one state.
   */
  const preview = useCallback(
    (current: Drag) => {
      const card = cardIn(current.pinId);
      if (!card) return;
      if (current.axis === "width") {
        const span = current.units >= current.maxUnits ? "1 / -1" : `span ${current.units}`;
        if (card.style.gridColumn !== span) card.style.gridColumn = span;
      } else {
        const height = `${Math.round(current.height)}px`;
        if (card.style.minHeight !== height) card.style.minHeight = height;
      }
    },
    [cardIn],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !enabled || locked || busy || dragRef.current) return;
      const pinId = event.currentTarget.dataset.pinHandle;
      const axis = event.currentTarget.dataset.pinHandleAxis;
      const card = pinId ? cardIn(pinId) : null;
      if (!pinId || !card || (axis !== "width" && axis !== "height")) return;
      // The handle is the gesture's, not the board's: the arrange gesture is armed
      // by a press on the grid, and a resize that also picked the card up would be
      // two gestures from one press. `usePinArrange` skips `[data-pin-handle]` on
      // its own side as well; this is the same rule stated where the press lands.
      event.preventDefault();
      event.stopPropagation();
      const box = card.getBoundingClientRect();
      const maxUnits = Math.max(1, tiles.trackCount());
      const minUnits = Math.min(maxUnits, Math.max(tiles.minUnits(), tiles.minUnitsFor(pinId)));
      const fromUnits = Math.max(minUnits, unitsOfCard(card, pinId, tiles, maxUnits));
      const contentHeight = tiles.contentHeightOf(pinId);
      const minHeight = Math.min(box.height, contentHeight > 0 ? contentHeight : box.height);
      const root = tiles.rootFontSize();
      const current: Drag = {
        pinId,
        axis,
        pointerId: event.pointerId,
        left: box.left,
        top: box.top,
        step: tiles.step(),
        gap: tiles.gap(),
        fromUnits,
        units: fromUnits,
        minUnits,
        maxUnits,
        fromHeight: box.height,
        height: box.height,
        minHeight,
        // A height is a floor, not a fixed box: the operator can give a card as
        // much room as they like, and its content still decides the minimum.
        maxHeight: 4000,
        fromGridColumn: card.style.gridColumn,
        fromMinHeight: card.style.minHeight,
        root,
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
   * The drop: one write, and only when the size actually changed.
   *
   * The card's own geometry is left where the drag put it — the page's write path
   * puts the same size back through React, and a card that snapped back to where
   * it started while the write was in flight would undo the gesture the operator
   * just made.
   */
  const finish = useCallback(
    (current: Drag) => {
      dragRef.current = null;
      setDrag(null);
      onGesture(false);
      if (current.axis === "width") {
        if (current.units === current.fromUnits) {
          setAnnounce("Width unchanged.");
          return;
        }
        const filled = current.units >= current.maxUnits;
        setAnnounce(
          filled
            ? "Card set to fill the row."
            : `Card width set to ${current.units} of ${current.maxUnits} columns.`,
        );
        void onCommit(
          current.pinId,
          filled
            ? { span: 2, width: undefined }
            : {
                span: 1,
                width: Math.round((tiles.widthOf(current.units) / current.root) * 100) / 100,
              },
        );
        return;
      }
      if (Math.abs(current.height - current.fromHeight) < 1) {
        setAnnounce("Height unchanged.");
        return;
      }
      const height = Math.round((current.height / current.root) * 100) / 100;
      setAnnounce(`Card height set to ${height} rem.`);
      void onCommit(current.pinId, { height });
    },
    [onCommit, onGesture, tiles],
  );

  /** Put a card back where a cancelled drag found it: a cancelled drag is not a size. */
  const cancel = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    setDrag(null);
    onGesture(false);
    const card = cardIn(current.pinId);
    if (card) {
      if (current.axis === "width") card.style.gridColumn = current.fromGridColumn;
      else card.style.minHeight = current.fromMinHeight;
    }
    setAnnounce("Size change cancelled.");
  }, [cardIn, onGesture]);

  /**
   * The drag's own listeners: on the WINDOW, not on the handle.
   *
   * The handle is only a few pixels wide and the pointer leaves it on the first
   * move, so a drag that only heard the pointer while it was over the handle would
   * stop the moment it began. Pointer capture is the usual answer and it is asked
   * for below — but capture is a convenience here and never the mechanism: this is
   * the same choice the arrange gesture makes when it puts its moves on the grid
   * rather than on the card, one level further out, because a size can be dragged
   * past the edge of the board.
   *
   * Gated on `dragRef` rather than on the drag state, so a handler is never torn
   * down and re-attached in the middle of the gesture it is serving.
   */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.axis === "width") {
        const units = unitsAtPointer(event.clientX, current.left, current);
        if (units === current.units) return;
        const next: Drag = { ...current, units };
        dragRef.current = next;
        setDrag(next);
        preview(next);
        return;
      }
      const height = Math.max(
        current.minHeight,
        Math.min(current.maxHeight, event.clientY - current.top),
      );
      if (Math.round(height) === Math.round(current.height)) return;
      const next: Drag = { ...current, height };
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
   * The keyboard's half: one unit (width) or one rem (height) per press, saved as
   * it is pressed.
   *
   * The arrows are the same gesture the pointer makes, in the same range — the
   * content's floor at one end and the row at the other for width — and a press is
   * a whole gesture, so each one is written. A separator's arrows are also how a
   * screen reader's owner resizes a column, which is what this is.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled || locked || busy || dragRef.current) return;
      const pinId = event.currentTarget.dataset.pinHandle;
      const axis = event.currentTarget.dataset.pinHandleAxis;
      if (!pinId || (axis !== "width" && axis !== "height")) return;
      const card = cardIn(pinId);
      if (!card) return;
      if (axis === "width") {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const maxUnits = Math.max(1, tiles.trackCount());
        const minUnits = Math.min(maxUnits, Math.max(tiles.minUnits(), tiles.minUnitsFor(pinId)));
        const fromUnits = Math.max(minUnits, unitsOfCard(card, pinId, tiles, maxUnits));
        const units = Math.max(
          minUnits,
          Math.min(maxUnits, fromUnits + (event.key === "ArrowRight" ? 1 : -1)),
        );
        if (units === fromUnits) {
          setAnnounce(
            event.key === "ArrowRight"
              ? "This card already fills the row."
              : "This card is already as narrow as its content allows.",
          );
          return;
        }
        const filled = units >= maxUnits;
        setAnnounce(
          filled
            ? "Card set to fill the row."
            : `Card width set to ${units} of ${maxUnits} columns.`,
        );
        void onCommit(
          pinId,
          filled
            ? { span: 2, width: undefined }
            : {
                span: 1,
                width: Math.round((tiles.widthOf(units) / tiles.rootFontSize()) * 100) / 100,
              },
        );
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopPropagation();
      const box = card.getBoundingClientRect();
      const contentHeight = tiles.contentHeightOf(pinId);
      const minHeight = Math.min(box.height, contentHeight > 0 ? contentHeight : box.height);
      const step = tiles.rootFontSize();
      const from = box.height;
      const height = Math.max(
        minHeight,
        Math.min(4000, from + (event.key === "ArrowDown" ? step : -step)),
      );
      if (Math.round(height) === Math.round(from)) {
        setAnnounce(
          event.key === "ArrowDown"
            ? "This card already has room to grow."
            : "This card is already as short as its content allows.",
        );
        return;
      }
      const rem = Math.round((height / step) * 100) / 100;
      setAnnounce(`Card height set to ${rem} rem.`);
      void onCommit(pinId, { height: rem });
    },
    [busy, cardIn, enabled, locked, onCommit, tiles],
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
  // must not leave a rAF, a listener, or a card drawn at a size nobody chose.
  useEffect(() => () => cancel(), [cancel]);

  const handleProps = useCallback(
    (pinId: string, axis: ResizeAxis) => ({
      /**
       * `data-pin-handle`, NOT `data-pin-id`: the board's own gestures and the
       * scroll hold all find cards with `[data-pin-id]`, and a handle wearing it
       * would be read as a card — a second slot in the drop geometry, a second
       * anchor for the hold. The pin it belongs to rides in the value instead.
       */
      "data-pin-handle": pinId,
      "data-pin-handle-axis": axis,
      onPointerDown,
      onKeyDown,
    }),
    [onKeyDown, onPointerDown],
  );

  return {
    isResizing: drag !== null,
    resizingPinId: drag?.pinId ?? null,
    resizingAxis: drag?.axis ?? null,
    handleProps,
    announce,
  };
}
