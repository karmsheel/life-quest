import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Pin } from "@lifequest/vault-core";
import { insertionIndex, movePin, type SlotRect } from "@/components/home/pin-order";
import { cardNameIn } from "@/components/home/card-name";

/** How far into the scrollport's edge a drag starts scrolling the board. */
const AUTOSCROLL_BAND_PX = 56;
/** The fastest the board scrolls under a drag, in pixels per frame. */
const AUTOSCROLL_MAX_PX = 14;

/** What the board does for an operator who has asked for less movement. */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The nearest ancestor the board actually scrolls inside.
 *
 * Resolved rather than assumed: in the app this is `.shell__content`, and in a
 * rig it is the rig's own box. A board that guessed would scroll the wrong thing
 * — or nothing — in whichever of the two it was not written for.
 */
function scrollParentOf(start: HTMLElement | null): HTMLElement | null {
  let node = start?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * A card's *layout* box: where it sits in the board, with its own transform
 * taken back off.
 *
 * The lifted card is displaced from its layout position by a transform, and the
 * layout position is the truth: it is the slot the card occupies, the slot the
 * board has made room for, and the slot the pointer is aiming at. Measuring the
 * displaced box instead would let a drag aim at a card that is still flying to
 * where it is going.
 */
function layoutBox(card: HTMLElement): SlotRect {
  const rect = card.getBoundingClientRect();
  let tx = 0;
  let ty = 0;
  const transform = getComputedStyle(card).transform;
  const matrix = transform && transform !== "none" ? transform.match(/matrix\(([^)]+)\)/) : null;
  if (matrix) {
    const parts = matrix[1]!.split(",").map((value) => Number(value.trim()));
    tx = parts[4] ?? 0;
    ty = parts[5] ?? 0;
  }
  return {
    left: rect.left - tx,
    top: rect.top - ty,
    right: rect.right - tx,
    bottom: rect.bottom - ty,
    width: rect.width,
    height: rect.height,
  };
}

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

/**
 * What the board's one write path did with a new order.
 *
 * The gesture has to tell these apart because they read differently to the
 * operator: a locked board is a thing they can fix in one click, a refusal is
 * the vault saying no, and only `applied` means the order is on disk.
 */
export type CommitOutcome = "applied" | "locked" | "refused";

/** What the live region says when a drag ends. */
function announceOutcome(outcome: CommitOutcome): string {
  if (outcome === "applied") return "Card order saved.";
  if (outcome === "locked") return "This board is locked; unlock it to arrange it.";
  return "Could not save the new order.";
}

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
  /** The pointer that owns the gesture; null when the keyboard raised the card. */
  pointerId: number | null;
  /** The pointer's offset inside the card when it was lifted. */
  grabX: number;
  grabY: number;
  /** True once the pointer has moved, which is when the card leaves its slot. */
  moved: boolean;
  /** Where the card would land: an index into the board without it. */
  to: number;
  /** A keyboard lift stays in the flow: an arrow key reorders it, it does not fly. */
  keyboard: boolean;
};

export type PinArrange = {
  gridRef: React.RefObject<HTMLDivElement | null>;
  gridHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
  /** The board's order while a card is in the air, and its order at rest. */
  order: Pin[];
  isArranging: boolean;
  isLifted: (pinId: string) => boolean;
  /** What to say about the last gesture: a live region reads this out. */
  announce: string;
};

/**
 * One card in the grid, by id. `CSS.escape` because a pin id holds a colon:
 * `view:financial:v-weekly` is a valid id and an invalid selector fragment.
 */
function cardIn(grid: HTMLElement | null, pinId: string): HTMLElement | null {
  return grid?.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(pinId)}"]`) ?? null;
}

/**
 * What a card is called, for the one place a card is spoken rather than drawn.
 * The reader itself lives in `card-name.ts`, because the chat names a card too
 * and the two must not drift; a card that painted no heading falls back to its
 * id, which is what a screen reader would have had before this existed.
 */
function cardName(grid: HTMLElement | null, pinId: string): string {
  return cardNameIn(cardIn(grid, pinId)) || pinId;
}

/**
 * How many tracks the board has, which is what "down" means to the keyboard.
 *
 * Read from the grid's resolved `grid-template-columns` rather than by counting
 * the cards in a row: several home cards are legitimately full-row, so a row of
 * the board is not a row of the grid and counting cards gives 1.
 */
function trackCount(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
  if (!tracks || tracks === "none") return 1;
  return Math.max(1, tracks.split(/\s+/).length);
}

export function usePinArrange(input: {
  pins: Pin[];
  locked: boolean;
  busy: boolean;
  onCommit: (next: Pin[]) => Promise<CommitOutcome>
}): PinArrange {
  const { pins, locked, busy, onCommit } = input;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const armRef = useRef<Arm | null>(null);
  const liftRef = useRef<Lift | null>(null);
  const geometryRef = useRef<HTMLElement | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [announce, setAnnounce] = useState("");
  /** The pointer's last position, for the auto-scroll loop. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  /** The box the board scrolls inside, resolved when a gesture starts. */
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  /** Every card's box before a reorder, so the reflow can be animated (FLIP). */
  const flipRef = useRef<Map<string, DOMRect> | null>(null);
  /** The board's order as the operator sees it: committed pins, plus the drag. */
  const order = useMemo(() => {
    if (!lift) return pins;
    const from = pins.findIndex((pin) => pin.id === lift.pinId);
    if (from < 0) return pins;
    return movePin(pins, from, lift.to);
  }, [lift, pins]);

  /**
   * The cards the pointer is measured against: every pin but the lifted one, at
   * their *layout* positions in the order the board currently shows them.
   *
   * The lifted card is excluded because the pointer is choosing a slot *among*
   * the others, and their layout positions are read rather than their drawn ones
   * because a sibling mid-animation is not where it lives.
   */
  const slots = useCallback(
    (liftedId: string): SlotRect[] => {
      const grid = gridRef.current;
      if (!grid) return [];
      return [...grid.querySelectorAll<HTMLElement>("[data-pin-id]")]
        .filter((card) => card.dataset.pinId !== liftedId)
        .map((card) => layoutBox(card));
    },
    [],
  );

  /**
   * Every card's box, for the reflow that is about to happen (FLIP's "first").
   *
   * Captured *before* the state change, because after it the old positions are
   * gone and a card that moved would simply appear in its new place.
   */
  const captureRects = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const map = new Map<string, DOMRect>();
    for (const card of grid.querySelectorAll<HTMLElement>("[data-pin-id]")) {
      const id = card.dataset.pinId;
      if (id) map.set(id, card.getBoundingClientRect());
    }
    flipRef.current = map;
  }, []);

  /**
   * Animate the cards that moved.
   *
   * A grid reflow is instant, so the card that changed places would teleport.
   * This inverts the delta on each card that moved and lets the CSS transition
   * carry it home — the "invert" and "play" halves of FLIP. The lifted card is
   * left alone when a pointer owns it: it is following a hand, not a slot.
   */
  useLayoutEffect(() => {
    const before = flipRef.current;
    flipRef.current = null;
    if (!before || prefersReducedMotion()) return;
    const grid = gridRef.current;
    if (!grid) return;
    const lifted = liftRef.current;
    for (const card of grid.querySelectorAll<HTMLElement>("[data-pin-id]")) {
      const id = card.dataset.pinId;
      const previous = id ? before.get(id) : undefined;
      if (!id || !previous) continue;
      // The lifted card is following a hand, not a slot: followPointer owns it.
      if (lifted?.pinId === id) continue;
      const now = card.getBoundingClientRect();
      const dx = previous.left - now.left;
      const dy = previous.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      card.style.transition = "none";
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        card.style.transition = "";
        card.style.transform = "";
      });
    }
  }, [order]);

  /** Hand the lifted card's transform back to the stylesheet on the way out. */
  const clearGeometry = useCallback(() => {
    const card = geometryRef.current;
    if (card) card.style.transform = "";
    geometryRef.current = null;
  }, []);

  /**
   * The lifted card's box, for the FLIP pass and for the drag's own geometry.
   *
   * Nothing is written here: the card never leaves the grid's flow. It is
   * displaced from its slot by a transform, so the board has already made room
   * for it exactly where it will land and the operator can see that room.
   */
  const claimGeometry = useCallback((): HTMLElement | null => {
    const card = cardIn(gridRef.current, liftRef.current?.pinId ?? "");
    if (!card) return null;
    geometryRef.current = card;
    return card;
  }, []);

  /**
   * Put the card under the pointer.
   *
   * The translate is recomputed from the pointer and the card's *current* layout
   * box on every frame, never accumulated: the card's slot moves as the board
   * reflows and the board itself moves when it scrolls, so a delta added to a
   * stored offset would drift the moment either happened.
   */
  const followPointer = useCallback(
    (current: Lift, clientX: number, clientY: number) => {
      const card = geometryRef.current ?? claimGeometry();
      if (!card) return;
      const box = layoutBox(card);
      const dx = clientX - current.grabX - box.left;
      const dy = clientY - current.grabY - box.top;
      card.style.transform = `translate(${dx}px, ${dy}px) scale(1.015)`;
    },
    [claimGeometry],
  );

  const disarm = useCallback(() => {
    const arm = armRef.current;
    if (arm?.timer != null) window.clearTimeout(arm.timer);
    armRef.current = null;
  }, []);

  /** Stop the board scrolling under a drag. */
  const stopAutoScroll = useCallback(() => {
    if (scrollFrameRef.current != null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  /**
   * Keep the board moving while a drag sits at its edge, and keep the card under
   * the pointer while it does.
   *
   * The board scrolls under a stationary hand, so the card's position is
   * recomputed from the pointer each frame rather than nudged by however much the
   * board moved — the latter drifts the moment two things move at once. Declared
   * after `followPointer` and `slots` because it calls them: a callback that runs
   * later still has to be *created* after what it closes over.
   */
  const autoScrollFrame = useCallback(() => {
    scrollFrameRef.current = null;
    const current = liftRef.current;
    const pointer = pointerRef.current;
    const scroller = scrollRef.current;
    if (!current || !pointer || !scroller || !current.moved || current.keyboard) return;
    const box = scroller.getBoundingClientRect();
    const fromTop = pointer.y - box.top;
    const fromBottom = box.bottom - pointer.y;
    let delta = 0;
    if (fromTop < AUTOSCROLL_BAND_PX) {
      delta = -Math.ceil(
        AUTOSCROLL_MAX_PX * Math.min(1, (AUTOSCROLL_BAND_PX - fromTop) / AUTOSCROLL_BAND_PX),
      );
    } else if (fromBottom < AUTOSCROLL_BAND_PX) {
      delta = Math.ceil(
        AUTOSCROLL_MAX_PX * Math.min(1, (AUTOSCROLL_BAND_PX - fromBottom) / AUTOSCROLL_BAND_PX),
      );
    }
    if (delta !== 0) {
      const was = scroller.scrollTop;
      scroller.scrollTop = was + delta;
      if (scroller.scrollTop !== was) {
        followPointer(current, pointer.x, pointer.y);
        const to = insertionIndex(slots(current.pinId), pointer);
        if (to !== current.to) {
          const next: Lift = { ...current, to };
          liftRef.current = next;
          setLift(next);
        }
      }
    }
    scrollFrameRef.current = requestAnimationFrame(autoScrollFrame);
  }, [followPointer, slots]);

  const startAutoScroll = useCallback(() => {
    if (scrollFrameRef.current == null) {
      scrollFrameRef.current = requestAnimationFrame(autoScrollFrame);
    }
  }, [autoScrollFrame]);

  const endLift = useCallback(() => {
    stopAutoScroll();
    pointerRef.current = null;
    clearGeometry();
    liftRef.current = null;
    setLift(null);
  }, [clearGeometry, stopAutoScroll]);

  const cancel = useCallback(() => {
    disarm();
    // A cancelled drag is worth saying out loud only when there was something to
    // cancel: a bare Escape on a resting board is not an event.
    if (liftRef.current?.moved) setAnnounce("Move cancelled.");
    endLift();
  }, [disarm, endLift]);

  /** Put the grip's focus back after the board has re-rendered around it. */
  const refocusGrip = useCallback((pinId: string) => {
    requestAnimationFrame(() => {
      cardIn(gridRef.current, pinId)?.querySelector<HTMLElement>("[data-pin-grip]")?.focus();
    });
  }, []);

  /**
   * Finish a gesture — the one place a drop becomes a write.
   *
   * The order is rebuilt from the pins the page holds right now, not from the
   * ones the gesture began with, so a board that changed underneath it still ends
   * up with the operator's intent applied to it. The page owns everything after
   * this: it puts the new order on screen, and it is the page that takes it back
   * down if the vault refuses.
   */
  const finishLift = useCallback(
    (current: Lift, options: { focus: boolean }) => {
      const from = pins.findIndex((pin) => pin.id === current.pinId);
      const to = current.to;
      const pinId = current.pinId;
      endLift();
      if (from < 0 || to === from) {
        if (options.focus) refocusGrip(pinId);
        return;
      }
      const next = movePin(pins, from, to);
      void onCommit(next).then((outcome) => {
        setAnnounce(announceOutcome(outcome));
        if (options.focus) refocusGrip(pinId);
      });
    },
    [endLift, onCommit, pins, refocusGrip],
  );

  /** Take the card out of the board's flow, frozen where it stood. */
  const liftCard = useCallback(
    (arm: Arm, point: { x: number; y: number }) => {
      const grid = gridRef.current;
      const card = cardIn(grid, arm.pinId);
      if (!grid || !card) {
        disarm();
        return;
      }
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
        moved: false,
        to: pins.findIndex((pin) => pin.id === arm.pinId),
        keyboard: false,
      };
      // The box the board scrolls inside, resolved once per gesture: it is what
      // auto-scroll moves, and it does not change while a card is in the air.
      scrollRef.current = scrollParentOf(grid);
      pointerRef.current = point;
      liftRef.current = next;
      setLift(next);
    },
    [disarm, pins],
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
      // The card follows the pointer, and the pointer decides the slot. The slot
      // is resolved against the other cards' *live* rects, so the order the board
      // is showing is the order the operator is aiming at.
      pointerRef.current = { x: event.clientX, y: event.clientY };
      followPointer(current, event.clientX, event.clientY);
      const to = insertionIndex(slots(current.pinId), { x: event.clientX, y: event.clientY });
      if (!current.moved || to !== current.to) {
        captureRects();
        const next: Lift = { ...current, moved: true, to };
        liftRef.current = next;
        setLift(next);
      }
      startAutoScroll();
    },
    [captureRects, disarm, followPointer, liftCard, slots, startAutoScroll],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const arm = armRef.current;
      if (arm && arm.pointerId === event.pointerId) {
        disarm();
        return;
      }
      const current = liftRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      finishLift(current, { focus: false });
    },
    [disarm, finishLift],
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

  /**
   * Arranging from the keyboard, which is not a fallback but a second way to do
   * the same thing: the grip is a real button, so Enter lifts the card it belongs
   * to, the arrows move it, and Enter drops it.
   *
   * The listener is on the window rather than on the grid because a reorder moves
   * the focused grip through the DOM, and a moved node can lose focus — a keydown
   * that then went to the body would never reach a grid handler. Only the *start*
   * needs the grip under the event, and after that the gesture is the page's.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = liftRef.current;
      if (!current) {
        if (locked || busy || pins.length < 2) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== "function") return;
        const card = target.closest<HTMLElement>("[data-pin-id]");
        const pinId = card?.dataset.pinId;
        if (!pinId || !target.closest("[data-pin-grip]")) return;
        event.preventDefault();
        const from = pins.findIndex((candidate) => candidate.id === pinId);
        if (from < 0) return;
        const next: Lift = {
          pinId,
          pointerId: null,
          grabX: 0,
          grabY: 0,
          moved: false,
          to: from,
          keyboard: true,
        };
        liftRef.current = next;
        setLift(next);
        setAnnounce(`Moving ${cardName(gridRef.current, pinId)}. Use the arrow keys, then Enter to drop.`);
        return;
      }
      if (!current.keyboard) return;

      const lastIndex = pins.length - 1;
      const clamp = (value: number) => Math.max(0, Math.min(value, lastIndex));

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        finishLift(current, { focus: true });
        return;
      }
      let to: number | null = null;
      if (event.key === "ArrowLeft") to = clamp(current.to - 1);
      else if (event.key === "ArrowRight") to = clamp(current.to + 1);
      else if (event.key === "ArrowUp") to = clamp(current.to - trackCount(gridRef.current));
      else if (event.key === "ArrowDown") to = clamp(current.to + trackCount(gridRef.current));
      if (to == null) return;
      event.preventDefault();
      captureRects();
      const next: Lift = { ...current, moved: true, to };
      liftRef.current = next;
      setLift(next);
      setAnnounce(
        `Moved ${cardName(gridRef.current, current.pinId)} to position ${to + 1} of ${pins.length}. Enter to drop, Escape to cancel.`,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, captureRects, finishLift, locked, pins]);

  // A card that leaves the board mid-drag (an unpin, a re-read) must not leave
  // the gesture hanging over an element that is gone, and must not leave its
  // inline geometry behind on whatever the board renders next.
  useEffect(() => {
    if (lift && !pins.some((pin) => pin.id === lift.pinId)) cancel();
  }, [cancel, lift, pins]);

  // React never writes these properties, so the unmount path has to — and a
  // gesture in flight when the page goes away must not leave a rAF loop behind.
  useEffect(
    () => () => {
      clearGeometry();
      stopAutoScroll();
    },
    [clearGeometry, stopAutoScroll],
  );

  const isLifted = useCallback((pinId: string) => lift?.pinId === pinId, [lift]);

  return {
    gridRef,
    gridHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    order,
    isArranging: lift !== null,
    isLifted,
    announce,
  };
}
