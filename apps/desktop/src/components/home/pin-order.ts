/**
 * The board's ordering arithmetic: where a card goes, and where the pointer — or
 * the keyboard — says it should go.
 *
 * Three pure functions, no DOM and no React, because this is the part of
 * arranging that has to be *reasoned* about rather than felt: the board is a
 * wrapping grid with full-row cards in it and with card widths measured from
 * their content, so "the cell to the left", "the next slot in the list" and "the
 * line below" are three different things, and only one of them is what the
 * operator aimed at.
 */

/** A card's box, as the resolver needs it. */
export type SlotRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * The list with one item moved.
 *
 * `from` is the item's index in `list`; `to` is where it belongs in the list
 * that remains once it is taken out — which is exactly the index a drop resolves
 * to, because the lifted card is not one of the slots the pointer is measured
 * against. A no-op move returns the same array, so callers can compare identity
 * rather than contents to decide whether anything happened.
 */
export function movePin<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(to, list.length - 1));
  if (from === target) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/**
 * Which slot the pointer is over.
 *
 * The rule, in reading order:
 *
 * - Inside a card's own row band, the horizontal midpoint decides — left half
 *   means "before this card", right half means "after it". This is the claim the
 *   old `↑` / `↓` buttons could never make: in a wrapping grid the previous slot
 *   is usually the cell to the *left*, so "up" moved cards sideways.
 * - Above a card's vertical midpoint and outside its band, that card is the
 *   insertion point. This is what lets a pointer travel a row at a time: a wide
 *   (full-row) card is not a dead zone, and a pointer over an empty cell still
 *   resolves to the row it is nearest.
 * - Past every card, the answer is the end of the board.
 *
 * `slots` are the *other* cards' rects in their current DOM order, so the answer
 * is an index into the list without the lifted card — the same index `movePin`
 * takes as `to`.
 */
export function insertionIndex(slots: SlotRect[], point: { x: number; y: number }): number {
  for (let i = 0; i < slots.length; i += 1) {
    const rect = slots[i] as SlotRect;
    const inBand = point.y >= rect.top && point.y <= rect.bottom;
    if (inBand) {
      if (point.x < rect.left + rect.width / 2) return i;
    } else if (point.y < rect.top + rect.height / 2) {
      return i;
    }
  }
  return slots.length;
}

/** Two cards are on the same line when their top edges are within this. */
const SAME_LINE_PX = 4;

/**
 * The slot the keyboard's Up and Down should move a card to: the start of the
 * line above or below it.
 *
 * IT USED TO BE ARITHMETIC, AND ARITHMETIC STOPPED BEING TRUE. The board was a
 * grid of equal cells, so "one row down" was "the number of tracks along" and the
 * count was read off `grid-template-columns`. A card's width is now measured from
 * its content and expressed in layout units of a quarter of a cell, so the tracks
 * are four times as many and no longer say anything about how many cards are on a
 * line: `+ trackCount` would move a card twenty slots, or off the end of the
 * board.
 *
 * What is true, and was always the thing meant, is geometric. A line is the cards
 * that share a top edge — which is how the board lays them out, whatever their
 * widths — so:
 *
 *  - down: the first card, in board order, that starts on a line below this one.
 *    `slots` are the OTHER cards in board order, and an index into them is
 *    exactly what `movePin` takes as `to`, so "before that card" is the answer.
 *  - up: the same move onto the line above — the first card of the nearest line
 *    whose top edge is above this one. A card already on the top line has nowhere
 *    above it and goes to the start of the board, which is what an operator
 *    pressing Up again expects to happen rather than a dead key.
 */
export function rowTarget(slots: SlotRect[], from: SlotRect, direction: 1 | -1): number {
  if (direction === 1) {
    for (let i = 0; i < slots.length; i += 1) {
      if ((slots[i] as SlotRect).top > from.top + SAME_LINE_PX) return i;
    }
    return slots.length;
  }
  // The nearest line above: the greatest top edge that is still above this card,
  // and then the first slot standing on it.
  let lineTop: number | null = null;
  for (const rect of slots) {
    if (rect.top >= from.top - SAME_LINE_PX) continue;
    if (lineTop === null || rect.top > lineTop) lineTop = rect.top;
  }
  if (lineTop === null) return 0;
  const found = slots.findIndex((rect) => Math.abs(rect.top - lineTop) <= SAME_LINE_PX);
  return found < 0 ? 0 : found;
}
