/**
 * The board's ordering arithmetic: where a card goes, and where the pointer says
 * it should go.
 *
 * Two pure functions, no DOM and no React, because this is the part of arranging
 * that has to be *reasoned* about rather than felt: the board is a wrapping grid
 * with full-row cards in it, so "the cell to the left" and "the next slot in the
 * list" are different things and only one of them is what the operator aimed at.
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
