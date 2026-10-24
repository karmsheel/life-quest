import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { isTaskColumn } from "@lifequest/vault-core/map";
import type { Task, TaskColumn } from "@lifequest/vault-core/map";

/** A drop the board can draw and, on release, write. */
export type TaskDrop = {
  column: TaskColumn;
  /** The card the moved one will sit before; null appends to the column. */
  beforeId: string | null;
};

/** What is in the air, and where it was picked up. */
export type TaskDrag = {
  id: string;
  from: TaskColumn;
  title: string;
  /** The lifted card's own box, so the ghost keeps its reading width. */
  width: number;
  height: number;
  startLeft: number;
  startTop: number;
};

export type TaskDragController = {
  drag: TaskDrag | null;
  drop: TaskDrop | null;
  ghostRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  cancel: () => void;
  /** What the last gesture did, for the board's live region. */
  announce: string;
};

type Pending = {
  pointerId: number;
  id: string;
  from: TaskColumn;
  title: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type Active = Pending;

/** How far a press may travel before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 6;
/** How close to the board's horizontal edge a drag starts scrolling it. */
const AUTOSCROLL_BAND_PX = 52;
/** The fastest the board scrolls under a drag, in pixels per frame. */
const AUTOSCROLL_MAX_PX = 14;

/** A drop that would leave the column exactly as it was. */
function isSamePlace(
  task: Task,
  target: TaskDrop,
  tasks: Task[],
): boolean {
  if (target.column !== task.column) return false;
  const column = tasks.filter((candidate) => candidate.column === task.column);
  const index = column.findIndex((candidate) => candidate.id === task.id);
  if (index < 0) return true;
  return target.beforeId === (column[index + 1]?.id ?? null);
}

/**
 * The board's drag gesture: pick a card up, carry it, drop it in a column.
 *
 * The whole card is the handle except its controls — a press that starts on the
 * menu, an editor field, or a link is that control's. A press that moves less
 * than `DRAG_THRESHOLD_PX` stays a click, which is how the title still opens the
 * card; the first move past the threshold takes the card out of the click's way
 * and blocks the click that follows the release.
 *
 * The pointer decides the slot from live geometry rather than from a stored
 * index: the columns are a grid and cards have different heights, so "before
 * the card whose midpoint is below the pointer" is the only rule that survives a
 * card wrapping to a second line. The source card stays in flow as a faded
 * placeholder, which keeps the board from jumping under the hand while a drag is
 * deciding where it will land.
 */
export function useTaskDrag(input: {
  tasks: Task[];
  labels: Record<TaskColumn, string>;
  onMove: (id: string, column: TaskColumn, beforeId: string | null) => void;
}): TaskDragController {
  const { tasks, labels, onMove } = input;
  const [drag, setDrag] = useState<TaskDrag | null>(null);
  const [drop, setDrop] = useState<TaskDrop | null>(null);
  const [announce, setAnnounce] = useState("");

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const pendingRef = useRef<Pending | null>(null);
  const activeRef = useRef<Active | null>(null);
  const dropRef = useRef<TaskDrop | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const blockTimerRef = useRef<number | null>(null);
  /** The pointer's last position and the board's scrollport, for auto-scroll. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  const positionGhost = useCallback((x: number, y: number) => {
    const active = activeRef.current;
    const ghost = ghostRef.current;
    if (!active || !ghost) return;
    ghost.style.transform = `translate3d(${x - active.offsetX}px, ${
      y - active.offsetY
    }px, 0)`;
  }, []);

  const writeDrop = useCallback((next: TaskDrop | null) => {
    const current = dropRef.current;
    if (
      current === next ||
      (current &&
        next &&
        current.column === next.column &&
        current.beforeId === next.beforeId)
    ) {
      return;
    }
    dropRef.current = next;
    setDrop(next);
  }, []);

  /**
   * The column and insertion point under the pointer, if any.
   *
   * Cards in the lifted card's own column are measured without it: a drag that
   * only hovers its own slot is a drop in the same place, and it must not make
   * the card jump over itself.
   */
  const targetAt = useCallback((x: number, y: number): TaskDrop | null => {
    const hit = document.elementFromPoint(x, y);
    const columnEl = hit?.closest<HTMLElement>(".task-column") ?? null;
    const column = columnEl?.dataset.column;
    if (!columnEl || !isTaskColumn(column)) return null;

    const activeId = activeRef.current?.id ?? null;
    const cards = [
      ...columnEl.querySelectorAll<HTMLElement>(
        ".task-list > li > .task-card",
      ),
    ].filter((card) => card.dataset.taskId !== activeId);

    let beforeId: string | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        beforeId = card.dataset.taskId ?? null;
        break;
      }
    }
    return { column, beforeId };
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollFrameRef.current != null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  const end = useCallback(() => {
    pendingRef.current = null;
    activeRef.current = null;
    dropRef.current = null;
    pointerRef.current = null;
    scrollerRef.current = null;
    stopAutoScroll();
    setDrag(null);
    setDrop(null);
    document.body.classList.remove("is-task-dragging");
  }, [stopAutoScroll]);

  /**
   * Swallow the one click a drag produces.
   *
   * The click is the compatibility event that follows a press, and without this
   * a drop on another card opens that card's details. It is captured at the
   * window so no element's own handler sees it, and the listener removes itself
   * the moment the click arrives — or shortly after, if the browser suppressed
   * it because the pointer moved too far.
   */
  const blockNextClick = useCallback(() => {
    const cleanup = () => {
      window.removeEventListener("click", block, true);
      window.removeEventListener("pointerdown", disarm, true);
      if (blockTimerRef.current != null) {
        window.clearTimeout(blockTimerRef.current);
        blockTimerRef.current = null;
      }
    };
    const block = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    };
    // A fresh press is a fresh gesture, not the compatibility click the drag
    // produced. Disarming here keeps the next deliberate click on the board —
    // the quick-add button, a menu — out of the blocker's way.
    const disarm = () => cleanup();
    window.addEventListener("click", block, true);
    window.addEventListener("pointerdown", disarm, true);
    if (blockTimerRef.current != null) window.clearTimeout(blockTimerRef.current);
    blockTimerRef.current = window.setTimeout(cleanup, 500);
  }, []);

  /**
   * Keep the board moving while a drag sits at its left or right edge.
   *
   * At the standard sheet the last columns sit outside the viewport, so a drag
   * to Done has to be able to bring Done to the hand. The ghost follows the
   * pointer, not the scroll, and the drop target is re-resolved each frame
   * because the columns themselves have moved underneath it.
   */
  const autoScrollTickRef = useRef<() => void>(() => {});
  autoScrollTickRef.current = () => {
    scrollFrameRef.current = null;
    const active = activeRef.current;
    const pointer = pointerRef.current;
    const scroller = scrollerRef.current;
    if (!active || !pointer || !scroller) return;

    const box = scroller.getBoundingClientRect();
    const inBand = pointer.y >= box.top && pointer.y <= box.bottom;
    const fromLeft = pointer.x - box.left;
    const fromRight = box.right - pointer.x;
    let delta = 0;
    if (inBand && fromLeft < AUTOSCROLL_BAND_PX) {
      delta = -Math.ceil(
        AUTOSCROLL_MAX_PX *
          Math.min(1, (AUTOSCROLL_BAND_PX - fromLeft) / AUTOSCROLL_BAND_PX),
      );
    } else if (inBand && fromRight < AUTOSCROLL_BAND_PX) {
      delta = Math.ceil(
        AUTOSCROLL_MAX_PX *
          Math.min(1, (AUTOSCROLL_BAND_PX - fromRight) / AUTOSCROLL_BAND_PX),
      );
    }

    if (delta !== 0) {
      const was = scroller.scrollLeft;
      scroller.scrollLeft = was + delta;
      if (scroller.scrollLeft !== was) {
        positionGhost(pointer.x, pointer.y);
        writeDrop(targetAt(pointer.x, pointer.y));
      }
    }
    scrollFrameRef.current = requestAnimationFrame(() =>
      autoScrollTickRef.current(),
    );
  };

  const startAutoScroll = useCallback(() => {
    if (scrollFrameRef.current == null) {
      scrollFrameRef.current = requestAnimationFrame(() =>
        autoScrollTickRef.current(),
      );
    }
  }, []);

  const cancel = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current = null;
      return;
    }
    if (!activeRef.current) return;
    end();
    setAnnounce("Move cancelled.");
  }, [end]);

  /**
   * Start the drag when a held press crosses the threshold.
   *
   * The ghost is rendered by the board after this state change; the transform is
   * written onto it directly on every move, never through a React prop, because
   * a re-render for a new drop target must not snap the ghost back to where the
   * gesture began.
   */
  const lift = useCallback(
    (pending: Pending, x: number, y: number) => {
      const active: Active = { ...pending };
      pendingRef.current = null;
      activeRef.current = active;
      pointerRef.current = { x, y };
      scrollerRef.current =
        document.querySelector<HTMLElement>(".task-board__viewport");
      document.body.classList.add("is-task-dragging");
      setDrag({
        id: active.id,
        from: active.from,
        title: active.title,
        width: active.width,
        height: active.height,
        startLeft: active.startX - active.offsetX,
        startTop: active.startY - active.offsetY,
      });
      setAnnounce(`Moving ${active.title}. Drop it in a column.`);
      requestAnimationFrame(() => positionGhost(x, y));
      startAutoScroll();
    },
    [positionGhost, startAutoScroll],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (pendingRef.current || activeRef.current) return;

      const target = event.target as Element;
      const card = target.closest<HTMLElement>(".task-card[data-task-id]");
      const id = card?.dataset.taskId;
      if (!card || !id) return;

      // A press on one of the card's own controls is that control's, not the
      // board's. The title is the exception: it is the biggest useful handle on
      // the card, and a press that does not move is still a click that opens it.
      if (
        target.closest(
          'a, input, select, textarea, [role="menu"], [data-task-actions], [data-no-drag], .task-editor',
        )
      ) {
        return;
      }
      const button = target.closest("button");
      if (button && !button.classList.contains("task-card__title")) return;

      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;

      const rect = card.getBoundingClientRect();
      pendingRef.current = {
        pointerId: event.pointerId,
        id,
        from: task.column,
        title: task.title,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending) {
        if (event.pointerId !== pending.pointerId) return;
        const moved = Math.hypot(
          event.clientX - pending.startX,
          event.clientY - pending.startY,
        );
        if (moved < DRAG_THRESHOLD_PX) return;
        lift(pending, event.clientX, event.clientY);
      }

      const active = activeRef.current;
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      pointerRef.current = { x: event.clientX, y: event.clientY };
      positionGhost(event.clientX, event.clientY);
      writeDrop(targetAt(event.clientX, event.clientY));
      startAutoScroll();
    };

    const onUp = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending) {
        if (event.pointerId !== pending.pointerId) return;
        // A press that never crossed the threshold is a click; let it happen.
        pendingRef.current = null;
        return;
      }

      const active = activeRef.current;
      if (!active || event.pointerId !== active.pointerId) return;

      const target = targetAt(event.clientX, event.clientY);
      const task = tasksRef.current.find((candidate) => candidate.id === active.id);
      end();
      blockNextClick();
      if (!target) {
        setAnnounce("Move cancelled.");
        return;
      }
      if (task && isSamePlace(task, target, tasksRef.current)) {
        setAnnounce(`${active.title} stayed in ${labelsRef.current[target.column]}.`);
        return;
      }
      onMoveRef.current(active.id, target.column, target.beforeId);
      setAnnounce(`Moved ${active.title} to ${labelsRef.current[target.column]}.`);
    };

    const onCancel = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) cancel();
      else if (pendingRef.current?.pointerId === event.pointerId) {
        pendingRef.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!pendingRef.current && !activeRef.current) return;
      event.preventDefault();
      cancel();
    };

    const onBlur = () => {
      if (pendingRef.current || activeRef.current) cancel();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    blockNextClick,
    cancel,
    end,
    lift,
    positionGhost,
    startAutoScroll,
    targetAt,
    writeDrop,
  ]);

  // Place the ghost where the card was lifted the moment it mounts, so the first
  // painted frame is the card under the pointer rather than a flash at 0,0.
  useLayoutEffect(() => {
    if (!drag) return;
    positionGhost(
      activeRef.current?.startX ?? 0,
      activeRef.current?.startY ?? 0,
    );
  }, [drag?.id, positionGhost]);

  // A gesture in flight when the board goes away must not leave the page with a
  // grabbing cursor or a ghost listener loop behind it.
  useEffect(
    () => () => {
      document.body.classList.remove("is-task-dragging");
      if (blockTimerRef.current != null) {
        window.clearTimeout(blockTimerRef.current);
      }
      stopAutoScroll();
    },
    [stopAutoScroll],
  );

  return { drag, drop, ghostRef, onPointerDown, cancel, announce };
}
