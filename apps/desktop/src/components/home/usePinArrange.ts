import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Pin } from "@lifequest/vault-core";

/**
 * Arranging the dashboard: pick a card up, put it down where it belongs.
 *
 * The board is a wrapping grid, so a card's position in the array is its layout
 * and there is no coordinate to store. That makes this a controller over one
 * list and one DOM order:
 *
 * - **Arming.** One delegated `pointerdown` on the grid. A press that starts on
 *   a link, a button, or a field is that control's and is left alone. A press
 *   that starts on the grip is armed to drag on 4 px of movement; a press
 *   anywhere else on the card is armed to drag on a 220 ms hold, and any drift
 *   over 8 px before then cancels it — so a short press is still a press, and a
 *   drag across a card's text is still a text selection.
 * - **Lifting.** The card is marked lifted the moment the hold fires, but it
 *   stays *in* its grid cell until the pointer actually moves. Taking it out of
 *   flow at the hold would reflow the board under a hand that has not moved yet,
 *   sliding the next card up into the cell the operator is still holding — the
 *   board would appear to jump on a gesture that meant nothing.
 * - **Moving.** Once the pointer moves, the card leaves grid flow as an
 *   absolutely positioned child of the grid, frozen at the size it had, and the
 *   grid's own auto-placement closes the gap behind it. The gap is therefore
 *   always where the card would land: no placeholder element, no reparented
 *   clone, no second copy of a card that owns state.
 * - **Geometry.** Position and size are written straight onto the element, never
 *   through a React `style` prop, so a re-render in the middle of a drag cannot
 *   snap the card back to where it was lifted from.
 *
 * The hook owns the gesture and nothing else. It never talks to the bridge: the
 * page's own `persistPins` is the one write path, so the board's lock gate and
 * the "one write" rule stay in one place.
 */

/** How long a press on a card must hold before it lifts. */
export const HOLD_MS = 220;
/** How far a press may drift before the hold is cancelled and it stays a press. */
export const HOLD_CANCEL_PX = 8;
/** How far a press on the grip must move to begin a drag — a grip needs no hold. */
export const GRIP_ACTIVATE_PX = 4;

type Arm = {
  pinId: string;
  pointerId: number;
  mode: "grip" | "hold";
  startX: number;
  startY: number;
  timer: number | null;
};

type Lift = {
  pinId: string;
  pointerId: number;
  /** The pointer's offset inside the card when it was lifted. */
  grabX: number;
  grabY: number;
  /** The card's resting box, in the grid's own coordinates. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** True once the pointer has moved, which is when the card leaves the flow. */
  moved: boolean;
};

export type PinArrange = {
  gridRef: React.RefObject<HTMLDivElement | null>;
  gridHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
  isArranging: boolean;
  isLifted: (pinId: string) => boolean;
};

/**
 * One card in the grid, by id. `CSS.escape` because a pin id holds a colon:
 * `view:financial:v-weekly` is a valid id and an invalid selector fragment.
 */
function cardIn(grid: HTMLElement | null, pinId: string): HTMLElement | null {
  return grid?.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(pinId)}"]`) ?? null;
}

export function usePinArrange(input: {
  pins: Pin[];
  locked: boolean;
  busy: boolean;
}): PinArrange {
  const { pins, locked, busy } = input;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const armRef = useRef<Arm | null>(null);
  const liftRef = useRef<Lift | null>(null);
  const geometryRef = useRef<HTMLElement | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);

  /** Hand the lifted card's box to the DOM, and give it back on the way out. */
  const clearGeometry = useCallback(() => {
    const card = geometryRef.current;
    if (card) {
      card.style.position = "";
      card.style.left = "";
      card.style.top = "";
      card.style.width = "";
      card.style.height = "";
    }
    geometryRef.current = null;
  }, []);

  /** Leave grid flow at the size the card already had. */
  const beginGeometry = useCallback((current: Lift): HTMLElement | null => {
    const card = cardIn(gridRef.current, current.pinId);
    if (!card) return null;
    card.style.position = "absolute";
    card.style.width = `${current.width}px`;
    card.style.height = `${current.height}px`;
    geometryRef.current = card;
    return card;
  }, []);

  /**
   * Put the card under the pointer.
   *
   * The offset is recomputed from the pointer's client position every time, and
   * never accumulated: the grid's own box moves when the board scrolls, so a
   * delta added to a stored position would drift as soon as the board moved
   * under a stationary hand.
   */
  const followPointer = useCallback(
    (current: Lift, clientX: number, clientY: number) => {
      const grid = gridRef.current;
      const card = geometryRef.current ?? beginGeometry(current);
      if (!grid || !card) return;
      const gridRect = grid.getBoundingClientRect();
      card.style.left = `${clientX - gridRect.left - current.grabX}px`;
      card.style.top = `${clientY - gridRect.top - current.grabY}px`;
    },
    [beginGeometry],
  );

  const disarm = useCallback(() => {
    const arm = armRef.current;
    if (arm?.timer != null) window.clearTimeout(arm.timer);
    armRef.current = null;
  }, []);

  const endLift = useCallback(() => {
    clearGeometry();
    liftRef.current = null;
    setLift(null);
  }, [clearGeometry]);

  const cancel = useCallback(() => {
    disarm();
    endLift();
  }, [disarm, endLift]);

  /** Take the card out of the board's flow, frozen where it stood. */
  const liftCard = useCallback(
    (arm: Arm, point: { x: number; y: number }) => {
      const grid = gridRef.current;
      const card = cardIn(grid, arm.pinId);
      if (!grid || !card) {
        disarm();
        return;
      }
      const gridRect = grid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      try {
        // Capture so the drag keeps its moves outside the card it started on.
        grid.setPointerCapture(arm.pointerId);
      } catch {
        // A refusal costs the drag its moves outside the grid, not its start:
        // the window's own `blur` still ends it cleanly.
      }
      disarm();
      const next: Lift = {
        pinId: arm.pinId,
        pointerId: arm.pointerId,
        grabX: point.x - cardRect.left,
        grabY: point.y - cardRect.top,
        left: cardRect.left - gridRect.left,
        top: cardRect.top - gridRect.top,
        width: cardRect.width,
        height: cardRect.height,
        moved: false,
      };
      liftRef.current = next;
      setLift(next);
    },
    [disarm],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (locked || busy || pins.length < 2) return;
      if (armRef.current || liftRef.current) return;
      const target = event.target as Element;
      const card = target.closest<HTMLElement>("[data-pin-id]");
      const pinId = card?.dataset.pinId;
      if (!card || !pinId) return;
      // A press on a control inside the card is that control's, not the board's.
      if (target.closest('a, input, select, textarea, [role="button"], button:not([data-pin-grip])')) {
        return;
      }
      const mode: Arm["mode"] = target.closest("[data-pin-grip]") ? "grip" : "hold";
      const arm: Arm = {
        pinId,
        pointerId: event.pointerId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        timer: null,
      };
      if (mode === "hold") {
        // The hold fires where the press began: by definition the pointer has not
        // moved more than the cancel threshold, so there is no later point to use.
        arm.timer = window.setTimeout(() => {
          const current = armRef.current;
          if (current && current.pointerId === arm.pointerId) {
            liftCard(current, { x: current.startX, y: current.startY });
          }
        }, HOLD_MS);
      }
      armRef.current = arm;
    },
    [busy, liftCard, locked, pins.length],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const arm = armRef.current;
      if (arm && arm.pointerId === event.pointerId) {
        const drift = Math.hypot(event.clientX - arm.startX, event.clientY - arm.startY);
        if (arm.mode === "grip") {
          if (drift >= GRIP_ACTIVATE_PX) liftCard(arm, { x: event.clientX, y: event.clientY });
        } else if (drift > HOLD_CANCEL_PX) {
          disarm();
        }
        return;
      }
      const current = liftRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.moved) {
        // The first movement is what takes the card out of the board's flow.
        const moved: Lift = { ...current, moved: true };
        liftRef.current = moved;
        setLift(moved);
        followPointer(moved, event.clientX, event.clientY);
        return;
      }
      followPointer(current, event.clientX, event.clientY);
    },
    [disarm, followPointer, liftCard],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const arm = armRef.current;
      if (arm && arm.pointerId === event.pointerId) {
        disarm();
        return;
      }
      const current = liftRef.current;
      if (current && current.pointerId === event.pointerId) endLift();
    },
    [disarm, endLift],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const arm = armRef.current;
      if (arm && arm.pointerId === event.pointerId) disarm();
      const current = liftRef.current;
      if (current && current.pointerId === event.pointerId) cancel();
    },
    [cancel, disarm],
  );

  /**
   * Escape and a lost window end the gesture. Attached for the hook's lifetime
   * rather than on arming, because arming is a ref change and does not re-render
   * — an effect keyed on it would never run.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  // A card that leaves the board mid-drag (an unpin, a re-read) must not leave
  // the gesture hanging over an element that is gone, and must not leave its
  // inline geometry behind on whatever the board renders next.
  useEffect(() => {
    if (lift && !pins.some((pin) => pin.id === lift.pinId)) cancel();
  }, [cancel, lift, pins]);

  // React never writes these properties, so the unmount path has to.
  useEffect(() => clearGeometry, [clearGeometry]);

  const isLifted = useCallback((pinId: string) => lift?.pinId === pinId, [lift]);

  return {
    gridRef,
    gridHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    isArranging: lift !== null,
    isLifted,
  };
}
