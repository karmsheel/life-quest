import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Pin } from "@lifequest/vault-core";
import {
  boardCellsNeeded,
  boardWidth,
  cellsNeeded,
  tileCell,
} from "@/components/home/tile-span";

/**
 * Sizing the board's tiles from what the cards actually hold.
 *
 * The page renders cards; this hook asks each one how wide it has to be and
 * writes the answer back as a grid span — one cell, two, or as many as a table
 * with six nowrap columns needs — and as the board's own floor, so a window too
 * small for those cells gets a board that is wider than it is instead of a card
 * squeezed until its content spills over the frame.
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
 * It does not measure while a card is in the air. A drag owns the geometry of the
 * card under it, and a measurement pass writes `width` on every card on the
 * board; the board is re-measured the moment the gesture ends. It also does not
 * touch a card that already owns the row — the operator's own `span: 2`, and the
 * cards that are drawn as banners — which the sheet paints `1 / -1` and this hook
 * leaves alone.
 */
export function useTileSpans(input: {
  gridRef: RefObject<HTMLDivElement | null>;
  /** The board's order: the cards, and the page that decides them. */
  pins: Pin[];
  /** The vault's live revision: what makes a card re-run and take a new shape. */
  live: number;
  /** True while a card is lifted: the gesture owns the geometry and this stands down. */
  arranging: boolean;
}): void {
  const { gridRef, pins, live, arranging } = input;
  const frameRef = useRef<number | null>(null);
  const arrangingRef = useRef(arranging);
  arrangingRef.current = arranging;

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
    const cell = tileCell(
      boardStyle,
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    const gap = Number.parseFloat(boardStyle.columnGap) || 0;

    // Write all, read all, restore all. Interleaving would make the browser
    // lay the board out once per card; this is one layout for the measurements
    // and one for the restore.
    for (const card of cards) card.style.width = "min-content";
    const needs = cards.map((card) => card.getBoundingClientRect().width);
    for (const card of cards) card.style.removeProperty("width");

    const cells = needs.map((need) => cellsNeeded(need, cell, gap));

    // The board's floor first: it decides how many tracks there are, and a span
    // wider than the track count would create an implicit track instead — a
    // column of the board that is not part of the board's rhythm.
    const minWidth = `${Math.ceil(boardWidth(boardCellsNeeded(cells), cell, gap))}px`;
    if (grid.style.minWidth !== minWidth) grid.style.minWidth = minWidth;

    cards.forEach((card, index) => {
      // An empty string puts a row card back on the sheet's own rule.
      const count = cells[index];
      const span = widthFollowsContent(card) ? `span ${count}` : "";
      if (card.style.gridColumn !== span) card.style.gridColumn = span;
    });
  }, [gridRef]);

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
}

/**
 * Whether the board decides this card's width, or the card already owns the row.
 *
 * Two kinds of card own the row. The operator's own choice — a pin whose stored
 * span is 2, which `HomePage` marks `home-pin--span2` — and the cards that are
 * furniture drawn across the board (`.home-card--wide`, the deadline banner).
 * Both are read off the card the sheet is actually painting from, so the rule and
 * the markup cannot drift: a card that says it wants the row is not measured, and
 * its inline span is cleared so that the sheet's own `1 / -1` stands.
 */
function widthFollowsContent(card: HTMLElement): boolean {
  return (
    !card.classList.contains("home-pin--span2") &&
    card.querySelector(".home-card--wide, .deadline-banner") === null
  );
}
