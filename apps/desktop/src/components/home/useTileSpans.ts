import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { Pin } from "@lifequest/vault-core";
import {
  boardUnitsNeeded,
  boardWidth,
  minTileUnits,
  tileStep,
  unitsForWidth,
  unitsNeeded,
  widthForUnits,
} from "@/components/home/tile-span";

/**
 * Sizing the board's tiles from what the cards actually hold.
 *
 * The page renders cards; this hook asks each one how wide it has to be and
 * writes the answer back as a grid span — a whole number of layout units, as many
 * as the card's content needs — and as the board's own floor, so a window too
 * small for those units gets a board that is wider than it is instead of a card
 * squeezed until its content spills over the frame.
 *
 * The unit is a quarter of the 17rem cell the board used to be built from, and
 * that is not a detail: a card measured in whole cells is either too narrow for
 * its table or hundreds of pixels too wide, and the operator sees the difference
 * as empty space inside the card they are reading. See `tile-span.ts`.
 *
 * WHAT "HOW WIDE IT HAS TO BE" MEANS, EXACTLY
 *
 * The card's min-content width: the width below which its own content would
 * overflow it. It is the browser's answer, not a model of the table behind the
 * card, and it is read by asking the browser directly — every card is put at
 * `width: min-content` for the length of one layout, and the boxes are read in
 * one pass afterwards (write all, read all, restore all) so the whole board
 * costs two layouts rather than two per card.
 *
 * WHY IT RE-RUNS
 *
 * A card is a live query and its content arrives asynchronously: the board first
 * draws "Loading…", then a table. The span therefore cannot be decided once at
 * mount. Three signals bring the hook back:
 *
 *  1. The page's own commit — the order changed, or the vault's revision moved.
 *     In a layout effect, so the corrected board is what gets painted.
 *  2. A card's box changed — a taller table in a row that had to grow, a window
 *     resized. A `ResizeObserver` on the cards themselves.
 *  3. The cards' insides changed without any box changing: React hands a card
 *     twelve rows where it had two, the card is stretched by a taller neighbour
 *     in its row, and its box is byte-for-byte the same box. Only a
 *     `MutationObserver` sees that one, and it is exactly the write the operator
 *     is waiting on when they ask the companion to log an expense.
 *
 * `2` and `3` are coalesced into one measurement per frame, and every pass is
 * idempotent — it writes nothing when the answer has not changed — so the
 * observers cannot chase their own tail: a board that is already right produces
 * no writes, no layout of ours, and no further callbacks.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not measure while a gesture owns the board — a card in the air, or a
 * width being dragged. Both write geometry directly, and a measurement pass
 * writes `width` on every card on the board; the board is re-measured the moment
 * the gesture ends. It also does not touch a card that already owns the row — the
 * operator's own `span: 2`, and the cards that are drawn as banners — which the
 * sheet paints `1 / -1` and this hook leaves alone.
 */
export function useTileSpans(input: {
  gridRef: RefObject<HTMLDivElement | null>;
  /** The board's order: the cards, and the page that decides them. */
  pins: Pin[];
  /** The vault's live revision: what makes a card re-run and take a new shape. */
  live: number;
  /** True while a gesture owns the geometry: the board stands down and re-measures after. */
  arranging: boolean;
}): TileBoard {
  const { gridRef, pins, live, arranging } = input;
  const frameRef = useRef<number | null>(null);
  const arrangingRef = useRef(arranging);
  arrangingRef.current = arranging;

  /**
   * What the last measurement found, for the card that is about to be dragged.
   *
   * The resize gesture has to know the same three things this pass does — what a
   * card's content needs, how wide one unit is, and how many units the board has
   * room for — and it must know them as live numbers rather than as the values
   * React last rendered with. So the measurement is written here, in a ref, and
   * read back through the accessors below.
   */
  const measured = useRef({
    need: new Map<string, number>(),
    units: new Map<string, number>(),
    contentHeight: new Map<string, number>(),
    step: 0,
    gap: 0,
    minUnits: 1,
    tracks: 0,
    root: 16,
  });

  /**
   * Size the board, once.
   *
   * Everything here is derived from the live DOM and written straight to it —
   * never through React state — for the same reason the arrange gesture does it
   * that way: a card's width is geometry, and a re-render between the measurement
   * and the write would be a frame drawn at the wrong size.
   */
  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>(":scope > .home-pin")];
    if (cards.length === 0) return;

    const boardStyle = getComputedStyle(grid);
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const step = tileStep(boardStyle, root);
    const gap = Number.parseFloat(boardStyle.columnGap) || 0;
    const minUnits = minTileUnits(boardStyle);
    const tracks = boardStyle.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;

    /**
     * The operator's own hand on a card: a width in rem, which a card is never
     * drawn narrower than its content to honour.
     *
     * `max(need, dragged)` is the whole of the safety here. The dragged width is
     * taken as the nearest whole number of units — it is a target the operator
     * aimed at and can see — while the content's floor is rounded up, because a
     * card that guessed low would spill. The larger wins, so dragging a card's
     * edge can make it wider than its table needs and can never make it narrower.
     */
    const dragged = new Map<string, number>();
    for (const pin of pins) {
      if (pin.width !== undefined) dragged.set(pin.id, pin.width * root);
    }

    // Write all, read all, restore all. Interleaving would make the browser
    // lay the board out once per card; this is one layout for the measurements
    // and one for the restore.
    const saved = cards.map((card) => ({
      width: card.style.width,
      minHeight: card.style.minHeight,
    }));
    for (const card of cards) card.style.width = "min-content";
    const needs = cards.map((card) => card.getBoundingClientRect().width);
    for (const [index, card] of cards.entries()) card.style.width = saved[index]?.width ?? "";
    /**
     * What each card's CONTENT is tall when the operator's own height is taken
     * off it.
     *
     * A stored height is a floor on the card, so measuring the card as it stands
     * would report the floor back as the content's height and the bottom-edge drag
     * could never come back down. `minHeight: 0` for one read gives the content's
     * own answer; the inline value is restored afterwards because React owns it.
     */
    for (const card of cards) card.style.minHeight = "0px";
    const contentHeights = cards.map((card) => card.getBoundingClientRect().height);
    for (const [index, card] of cards.entries()) {
      card.style.minHeight = saved[index]?.minHeight ?? "";
    }

    const units = cards.map((card, index) => {
      const need = needs[index] ?? 0;
      const floor = unitsNeeded(need, step, gap, minUnits);
      const id = card.dataset.pinId;
      const target = id === undefined ? undefined : dragged.get(id);
      return target === undefined
        ? floor
        : Math.max(floor, unitsForWidth(target, step, gap, minUnits));
    });

    // The board's floor first: it decides how many tracks there are, and a span
    // wider than the track count would create an implicit track instead — a
    // column of the board that is not part of the board's rhythm.
    const minWidth = `${Math.ceil(boardWidth(boardUnitsNeeded(units, minUnits), step, gap))}px`;
    if (grid.style.minWidth !== minWidth) grid.style.minWidth = minWidth;

    cards.forEach((card, index) => {
      // An empty string puts a row card back on the sheet's own rule.
      const count = units[index];
      const span = widthFollowsContent(card) ? `span ${count}` : "";
      if (card.style.gridColumn !== span) card.style.gridColumn = span;

      /**
       * The card's handles, told what they are holding.
       *
       * Written here rather than rendered, for the same reason the span is: the
       * measurement happens after React has rendered, so attributes rendered from
       * it would be a value behind — and `aria-valuenow` saying zero until the next
       * unrelated re-render is worse than saying nothing. This runs in a layout
       * effect, so the first painted frame already carries the right numbers.
       *
       * Both axes are separators with a range: width in layout units, height in
       * rem. The height range's minimum is the content's own height, because that
       * is the floor the bottom-edge drag stops at.
       */
      const max = Math.max(1, tracks);
      const floor = Math.max(1, unitsNeeded(needs[index] ?? 0, step, gap, minUnits));
      const value = count ?? floor;
      const widthHandle = card.querySelector<HTMLElement>('[data-pin-handle-axis="width"]');
      if (widthHandle) {
        const wanted: Array<[string, string]> = [
          ["aria-valuemin", String(Math.min(max, floor))],
          ["aria-valuemax", String(max)],
          ["aria-valuenow", String(value)],
          ["aria-valuetext", `${value} of ${max} columns`],
        ];
        for (const [name, text] of wanted) {
          if (widthHandle.getAttribute(name) !== text) widthHandle.setAttribute(name, text);
        }
      }
      const heightHandle = card.querySelector<HTMLElement>('[data-pin-handle-axis="height"]');
      if (heightHandle) {
        const floorRem = Math.round(((contentHeights[index] ?? 0) / root) * 100) / 100;
        const nowRem = Math.round((card.getBoundingClientRect().height / root) * 100) / 100;
        const wanted: Array<[string, string]> = [
          ["aria-valuemin", String(floorRem)],
          ["aria-valuemax", String(Math.round(4000 / root))],
          ["aria-valuenow", String(nowRem)],
          ["aria-valuetext", `${nowRem} of at least ${floorRem} rem`],
        ];
        for (const [name, text] of wanted) {
          if (heightHandle.getAttribute(name) !== text) heightHandle.setAttribute(name, text);
        }
      }
    });

    const found = measured.current;
    found.need.clear();
    found.units.clear();
    found.contentHeight.clear();
    cards.forEach((card, index) => {
      const id = card.dataset.pinId;
      if (!id) return;
      found.need.set(id, needs[index] ?? 0);
      found.units.set(id, units[index] ?? minUnits);
      found.contentHeight.set(id, contentHeights[index] ?? 0);
    });
    found.step = step;
    found.gap = gap;
    found.minUnits = minUnits;
    found.tracks = tracks;
    found.root = root;
  }, [gridRef, pins]);

  /**
   * One measurement per frame, at most.
   *
   * Both observers below can fire many times for one turn — a card's twelve rows
   * are twelve child-list records — and none of that is worth a layout each.
   */
  const schedule = useCallback(() => {
    if (arrangingRef.current || frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  // 1. Every commit that can change the cards, before the frame is painted.
  useLayoutEffect(() => {
    if (!arranging) measure();
  }, [measure, pins, live, arranging]);

  /**
   * 2 and 3. The two ways a card's content changes without the page committing:
   * its box moves, or its insides are replaced inside a box that does not.
   */
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const resized = new ResizeObserver(schedule);
    const watchCards = () => {
      // Disconnected and re-taken rather than added to, because a pin can be
      // removed from the board while the page is up and an observation outlives
      // the element it was taken on. Twenty cards, on a mutation: the cheapest
      // way to have no list of its own to keep in step.
      resized.disconnect();
      for (const card of grid.querySelectorAll(":scope > .home-pin")) resized.observe(card);
    };
    watchCards();
    // The grid's own children are watched rather than a fixed list, because a
    // pin can be added or removed while the board is up. `observe` on a card that
    // is already observed is a no-op, so re-running this is free.
    const mutated = new MutationObserver(() => {
      watchCards();
      schedule();
    });
    mutated.observe(grid, { childList: true, subtree: true, characterData: true });
    return () => {
      resized.disconnect();
      mutated.disconnect();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [gridRef, schedule]);

  /**
   * What this pass measured, for the gesture that resizes a card by hand.
   *
   * Accessors rather than values, and memoized once, because the resize gesture's
   * handlers must not be re-created every time a card's content changes — they are
   * attached to elements that are re-rendered on the board's own schedule, and a
   * handler that changed identity under a drag in progress would be a drag that
   * stops mid-gesture.
   */
  return useMemo<TileBoard>(
    () => ({
      needOf: (pinId) => measured.current.need.get(pinId) ?? 0,
      unitsOf: (pinId) => measured.current.units.get(pinId) ?? 0,
      contentHeightOf: (pinId) => measured.current.contentHeight.get(pinId) ?? 0,
      minUnitsFor: (pinId) => {
        const found = measured.current;
        return unitsNeeded(found.need.get(pinId) ?? 0, found.step, found.gap, found.minUnits);
      },
      step: () => measured.current.step,
      gap: () => measured.current.gap,
      minUnits: () => measured.current.minUnits,
      trackCount: () => measured.current.tracks,
      rootFontSize: () => measured.current.root,
      widthOf: (units) => {
        const found = measured.current;
        return widthForUnits(units, found.step, found.gap);
      },
    }),
    [],
  );
}

/**
 * What the board measured, as the rest of the page reads it.
 *
 * A card's own width is decided here and nowhere else, so a gesture that wants to
 * change it — the drag on a card's right edge — asks this rather than measuring a
 * second time and risking a second answer.
 */
export type TileBoard = {
  /** What this card's content needs, in pixels, as of the last measurement. */
  needOf: (pinId: string) => number;
  /** What this card is drawn at, in units, as of the last measurement. */
  unitsOf: (pinId: string) => number;
  /**
   * What this card's content is tall, in pixels, with the operator's own height
   * floor taken off. The bottom-edge drag stops here.
   */
  contentHeightOf: (pinId: string) => number;
  /** The fewest units this card may have: its own content's floor. */
  minUnitsFor: (pinId: string) => number;
  /** One layout unit, in pixels. */
  step: () => number;
  /** The board's gutter, in pixels. */
  gap: () => number;
  /** The design's floor for any card, in units. */
  minUnits: () => number;
  /** How many units the board is drawing across: the whole row. */
  trackCount: () => number;
  /** The root font size, for turning a width in rem into pixels. */
  rootFontSize: () => number;
  /** The drawn width, in pixels, of a card of `units` units. */
  widthOf: (units: number) => number;
};

/**
 * Whether the board decides this card's width, or the card already owns the row.
 *
 * Two kinds of card own the row. The operator's own choice — a pin whose stored
 * span is 2, which `HomePage` marks `home-pin--span2` — and the cards that are
 * furniture drawn across the board (`.home-card--wide`, the deadline banner).
 * Both are read off the card the sheet is actually painting from, so the rule and
 * the markup cannot drift: a card that says it wants the row is not measured, and
 * its inline span is cleared so that the sheet's own `1 / -1` stands.
 *
 * `home-pin--sized` is the exception that makes Edit card work on those furniture
 * cards: once the operator has actually dragged a width onto one, their hand
 * outranks the sheet's default, and the card takes the measured span like every
 * other. The class is only present when a pin carries a `width`, so an untouched
 * banner is still drawn across the row.
 */
function widthFollowsContent(card: HTMLElement): boolean {
  return (
    !card.classList.contains("home-pin--span2") &&
    (card.classList.contains("home-pin--sized") ||
      card.querySelector(".home-card--wide, .deadline-banner") === null)
  );
}
