import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useChatDock, type ChatDockSide } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import {
  CHAT_COLUMN_KEY_STEP_PX,
  chatColumnRange,
  clampChatColumn,
  type ChatColumnFrame,
  type ChatColumnRange,
} from "./chat-column";

/**
 * The seam between the page and the dock, as a width the operator drags.
 *
 * The whole gesture lives here and produces two things the shell draws with: the
 * style that carries the column's bounds, and the props the handle wears. What it
 * deliberately does NOT do is put a width in React state on every pointer move.
 * The page is a child of the shell, so a state change per move would reconcile
 * the whole mounted route sixty times a second to move one grid track; the move
 * writes `--chatbar-width` straight onto the shell instead — the same choice the
 * card width handle makes, and for the same reason — and the committed width
 * lands in the dock's own state once, when the pointer comes up.
 *
 * Ways this can fail, written down before it was written:
 *
 *  1. The frame is guessed rather than measured, and the clamp refuses a width
 *     the pane actually has room for (or allows one it does not).
 *  2. The rail's collapse changes the grid without changing the shell's box, so a
 *     ResizeObserver alone never hears about it and the ceiling goes stale.
 *  3. The drag direction is hard-coded to one side, so the swapped dock grows
 *     when it is dragged towards the page.
 *  4. A move lands on the window rather than the handle and the drag dies the
 *     moment the pointer leaves an eight-pixel strip.
 *  5. A cancel (Escape, a lost window) leaves the pane drawn at a width nobody
 *     chose, or commits it.
 *  6. The imperative write and React's own style disagree, so the pane snaps
 *     back on the next unrelated render.
 *  7. The arrow keys move the divider the wrong way for the side it is on, or
 *     push past the range the pointer is held to.
 *  8. The dock's own width is read from the wrong edge: on the trailing side the
 *     box carries the window frame's slack, on the leading side it does not.
 */

/** What one drag in progress is holding. */
type Drag = {
  /** The pointer that owns the gesture; moves by any other are somebody else's. */
  pointerId: number;
  /** Where the pointer was when the gesture began. */
  originX: number;
  /** The column the dock had when the gesture began. */
  base: number;
  /** What the gesture would leave it at: whole, and inside the frame's range. */
  width: number;
};

/** The handle's own props, spread onto the seam element by `ChatDivider`. */
export type ChatColumnDividerProps = {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: number;
  "data-dragging"?: true;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

export type ChatColumn = {
  /** The dragged column clamped to the frame, or null while the tokens own it. */
  width: number | null;
  /** The column the dock has right now, dragged or not: the handle's own value. */
  current: number;
  /** The frame's range, which the CSS also clamps the token's width against. */
  range: ChatColumnRange;
  dragging: boolean;
  /** The shell's inline style: the bounds, and the dragged width when there is one. */
  shellStyle: CSSProperties;
  dividerProps: ChatColumnDividerProps;
  /** What a screen reader is told about the last gesture. */
  announce: string;
};

/**
 * Own the dock's column and the handle that sets it.
 *
 * The shell element is the handle's world: its content box is the frame the
 * range is solved in, the grid tracks are all measured off it, and it is the
 * element the dragged width is written to.
 */
export function useChatColumn(
  shellRef: RefObject<HTMLDivElement | null>,
): ChatColumn {
  const { open, side, width: preferred, setWidth } = useChatDock();
  const { collapsed: navCollapsed, chatsOpen } = useNavDock();

  // Seeded from the window so the very first render has a ceiling that is already
  // in the right country; the layout effect below measures the real frame before
  // anything is painted.
  const [frame, setFrame] = useState<ChatColumnFrame>(() => ({
    viewport: typeof window === "undefined" ? 0 : Math.round(window.innerWidth),
    nav: 0,
  }));
  const frameRef = useRef(frame);
  frameRef.current = frame;

  /**
   * The shell's own content width, and the leading chrome's tracks standing in
   * it: the rail's column plus the chats list beside it. Both are measured off
   * their boxes rather than derived from tokens, because either can be collapsed
   * to `display: none` and its box is the honest answer for "how much of the
   * frame is not the page and not the dock".
   */
  const measureFrame = useCallback((): ChatColumnFrame => {
    const el = shellRef.current;
    if (!el) return frameRef.current;
    const rail = el.querySelector<HTMLElement>(":scope > .nav-rail");
    const chats = el.querySelector<HTMLElement>(":scope > .chats-rail");
    const widthOf = (node: HTMLElement | null) =>
      node ? Math.round(node.getBoundingClientRect().width) : 0;
    return {
      viewport: Math.round(el.clientWidth),
      nav: widthOf(rail) + widthOf(chats),
    };
  }, [shellRef]);

  /**
   * The frame the shell is standing in.
   *
   * The observer hears the window change; the `navCollapsed` dependency is what
   * hears the rail leave the grid, because that narrows the page and widens the
   * range without touching a single one of the shell's own edges.
   */
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const sync = () => {
      const next = measureFrame();
      setFrame((prev) =>
        prev.viewport === next.viewport && prev.nav === next.nav ? prev : next,
      );
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureFrame, navCollapsed, chatsOpen, shellRef]);

  const range = useMemo(() => chatColumnRange(frame), [frame]);
  const width = preferred === null ? null : clampChatColumn(preferred, range);

  /**
   * The dock's column as it is actually drawn.
   *
   * Measured off the dock's own box rather than derived, because before the first
   * drag the width belongs to a token (22.5rem) that this hook has no number for,
   * and after one the CSS clamp — not this hook — has the last word on what the
   * pane can be. The frame's slack is on the box only on the trailing side; on the
   * leading side the box is the column itself.
   */
  const measureTrack = useCallback((): number => {
    const el = shellRef.current;
    const dock = el?.querySelector<HTMLElement>(":scope > .chat-panel");
    if (!el || !dock) return 0;
    const frame = parseFloat(getComputedStyle(el).getPropertyValue("--shell-frame")) || 0;
    const wide = dock.getBoundingClientRect().width;
    return Math.max(0, Math.round(side === "right" ? wide - frame : wide));
  }, [shellRef, side]);

  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    if (width !== null) return;
    const next = measureTrack();
    setMeasured((prev) => (prev === next ? prev : next));
  }, [measureTrack, width, frame.viewport, frame.nav, side, open]);

  const current = width ?? measured;

  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");
  const dragRef = useRef<Drag | null>(null);

  // Live readings for the window listeners, which are registered once for the
  // hook's life: a handler torn down and re-attached in the middle of a gesture
  // is a drag that stops the moment it began.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const renderedRef = useRef<number | null>(width);
  renderedRef.current = width;
  /**
   * Which way the width moves for one pixel of pointer travel.
   *
   * Measured from the seam, not from the pane: dragging the leading dock to the
   * right makes it wider, and dragging the trailing dock to the right makes it
   * narrower. One sign, read in one place, so the two arrangements cannot drift
   * apart — and the arrow keys use the same sign as the pointer, so an arrow
   * moves the divider the way it points.
   */
  const outwardRef = useRef(1);
  outwardRef.current = side === "left" ? 1 : -1;

  /** Draw the gesture: the column, straight onto the shell the grid reads it from. */
  const preview = useCallback(
    (px: number) => {
      shellRef.current?.style.setProperty("--chatbar-width", `${px}px`);
    },
    [shellRef],
  );

  const finish = useCallback(
    (drag: Drag) => {
      dragRef.current = null;
      setDragging(false);
      if (drag.width === drag.base) {
        setAnnounce("Width unchanged.");
        return;
      }
      // The last move already drew this width; handing it to React makes it the
      // dock's own answer, so the next render and the pane on screen agree.
      setWidth(drag.width);
      setAnnounce(`Chat dock ${drag.width} pixels wide.`);
    },
    [setWidth],
  );

  /** Put the column back where a cancelled gesture found it: a cancel is not a width. */
  const cancel = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    const committed = renderedRef.current;
    if (committed === null) {
      shellRef.current?.style.removeProperty("--chatbar-width");
    } else {
      preview(clampChatColumn(committed, rangeRef.current));
    }
    setAnnounce("Width change cancelled.");
  }, [preview, shellRef]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      // The press is the handle's: it must not also begin a text selection in the
      // page or the dock standing behind the seam.
      event.preventDefault();
      const drawn = measureTrack();
      const base = clampChatColumn(
        drawn > 0 ? drawn : (renderedRef.current ?? rangeRef.current.min),
        rangeRef.current,
      );
      dragRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        base,
        width: base,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a convenience here, never the mechanism: the moves arrive on
        // the window below whether or not the pointer is still over six pixels.
      }
      setDragging(true);
    },
    [measureTrack],
  );

  /**
   * The drag's own listeners: on the WINDOW, not on the handle.
   *
   * The handle is a few pixels wide and the pointer leaves it on the first move,
   * so a drag that only heard the pointer over the handle would be a drag that
   * stopped the moment it began. Gated on `dragRef` rather than on the drag state
   * so the listeners are never torn down mid-gesture.
   */
  useEffect(() => {
    const widthAt = (event: PointerEvent, drag: Drag) =>
      clampChatColumn(
        drag.base + outwardRef.current * (event.clientX - drag.originX),
        rangeRef.current,
      );
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = widthAt(event, drag);
      if (next === drag.width) return;
      dragRef.current = { ...drag, width: next };
      preview(next);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      finish({ ...drag, width: widthAt(event, drag) });
    };
    const onCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) cancel();
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
   * The keyboard's half: one step per press, committed as it is pressed.
   *
   * A separator's arrows are how a screen reader's owner resizes a column, which
   * is exactly what this is, and they take the same direction as the pointer —
   * the divider moves the way the arrow points, in the same range.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const drawn = measureTrack();
      const from = clampChatColumn(
        drawn > 0 ? drawn : (renderedRef.current ?? rangeRef.current.min),
        rangeRef.current,
      );
      const towards = event.key === "ArrowRight" ? 1 : -1;
      const next = clampChatColumn(
        from + outwardRef.current * towards * CHAT_COLUMN_KEY_STEP_PX,
        rangeRef.current,
      );
      if (next === from) {
        const wider = outwardRef.current * towards > 0;
        setAnnounce(
          `The chat dock is already as ${wider ? "wide" : "narrow"} as it goes.`,
        );
        return;
      }
      preview(next);
      setWidth(next);
      setAnnounce(`Chat dock ${next} pixels wide.`);
    },
    [measureTrack, preview, setWidth],
  );

  /** Escape and a lost window end a drag the way they end every other gesture. */
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

  // Nothing may be left mid-drag: a gesture in flight when the shell goes away
  // must not leave a listener behind or a pane drawn at a width nobody chose.
  useEffect(() => () => cancel(), [cancel]);

  const shellStyle = useMemo((): CSSProperties => {
    const style: Record<string, string> = {
      // The frame's answer to the request, and the bounds the stylesheet clamps
      // the token's own width against — so the dock respects the page's floor
      // even before anybody has dragged it.
      "--chat-min": `${range.min}px`,
      "--chat-max": `${range.max}px`,
    };
    if (width !== null) style["--chatbar-width"] = `${width}px`;
    return style as CSSProperties;
  }, [range.max, range.min, width]);

  const dividerProps = useMemo(
    (): ChatColumnDividerProps => ({
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize the chat dock",
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": current,
      tabIndex: 0,
      "data-dragging": dragging || undefined,
      onPointerDown,
      onKeyDown,
    }),
    [current, dragging, onKeyDown, onPointerDown, range.max, range.min],
  );

  return {
    width,
    current,
    range,
    dragging,
    shellStyle,
    dividerProps,
    announce,
  };
}
