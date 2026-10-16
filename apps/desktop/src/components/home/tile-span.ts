/**
 * The board's tiles: how many cells a card's content needs, and how narrow the
 * board may be while still giving every card that many.
 *
 * THE FAULT THIS REPAIRS (reported, then measured in the operator's own vault):
 *
 *   "The tables can change size but when made smaller they often compress beyond
 *    the data they hold, causing it to spill over. Right now the Recent
 *    Transactions card is showing that spillover effect."
 *
 * The card's pin says `span: 1` — one cell of 17rem — and its content is a
 * four-column listing (date, payee, category, amount) whose every cell is
 * `white-space: nowrap`. A table does not shrink below its own min-content
 * width, and nothing in the sheet stopped it from painting outside the card's
 * frame. It did; the operator saw it.
 *
 * THE RULE
 *
 * Three numbers, all of them measurements rather than opinions:
 *
 *   need — the width below which a card's own content would overflow it. The
 *          browser already knows this: it is the card's min-content width, and
 *          `useTileSpans` reads it off the real card rather than guessing it
 *          from the query behind it.
 *   cell — the design's one-cell floor, `--home-tile-rem` on the board.
 *   gap  — the board's own gutter, read from the same computed style.
 *
 * `cellsNeeded` answers "how many cells does this card's content need", and
 * `boardWidth` answers "how narrow may the board be and still give every card
 * that many". Both are pure, and both are functions of CONTENT ALONE: a card's
 * width never depends on its neighbours. That is what makes the board stable —
 * measure, place, and the second measurement is the first one again — and it is
 * also what the operator asked for, in the two sizes it produces: a row of two
 * wide cards here, a row of three narrow ones below it.
 *
 * WHY THE CELL IS A CONSTANT, AND NOT THE TRACK WIDTH ON SCREEN
 *
 * `minmax(17rem, 1fr)` tracks grow with the window, so a card measured against
 * the width it happens to have would want one cell on a wide window and two on a
 * narrow one — and once the span changed the track width back, it would want the
 * first answer again. The cell is the design's floor, so the answer is the same
 * at every window size and the board cannot oscillate. A card that ends up with
 * slack in its cells is the same card the operator already had: the board has
 * always given a one-cell card whatever the window gave it.
 */

/**
 * The board's one-cell floor in rem, as a fallback for a stylesheet that has not
 * loaded. `--home-tile-rem` on `.home-dashboard__grid` is the real number and the
 * only place it is written down: the sheet sizes its tracks from it and this
 * module reads it back, so the two cannot drift.
 */
export const TILE_CELL_REM = 17;

/**
 * The fewest cells the board ever draws.
 *
 * Two, because a board of one is not a board: the operator's own words are "we
 * might only fit 2 on a certain line while on the next one fit 3", and a window
 * too narrow for two cells gets a board that is wider than it is — the sheet
 * scrolls sideways — rather than one card stretched down a column.
 */
export const MIN_TILE_CELLS = 2;

/**
 * The cell, in pixels: the sheet's `--home-tile-rem` times the root font size.
 *
 * Read from the board's own computed style rather than hard-coded, because a
 * theme may set a different root size and a cell that disagreed with the tracks
 * it is measuring would size every card by the wrong arithmetic.
 */
export function tileCell(boardStyle: CSSStyleDeclaration, rootFontSizePx: number): number {
  const declared = Number.parseFloat(boardStyle.getPropertyValue("--home-tile-rem"));
  const rem = Number.isFinite(declared) && declared > 0 ? declared : TILE_CELL_REM;
  const root = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : 16;
  return rem * root;
}

/**
 * How many cells a card whose content needs `need` pixels has to have.
 *
 * "How many cells, with the gutters between them, add up to at least `need`" —
 * the inverse of the layout, so a card is never given fewer pixels than its
 * content needs and therefore can never paint outside its own frame.
 *
 * At least one cell, whatever the content measures: a card is a tile, and a tile
 * that asked for zero columns would be a card the board could not place at all.
 */
export function cellsNeeded(need: number, cell: number, gap: number): number {
  if (!Number.isFinite(cell) || cell <= 0) return 1;
  const wanted = Math.ceil((Math.max(0, need) + gap) / (cell + gap));
  if (!Number.isFinite(wanted)) return 1;
  return Math.max(1, wanted);
}

/**
 * The board's own floor, in cells: as many as its widest card needs, and never
 * fewer than two.
 *
 * This is the whole of "widen the board rather than squeeze a card". A board
 * narrower than this would have to draw some card in fewer cells than its
 * content needs — which is the reported fault, arrived at from the other end.
 * With it, the sheet's own scrollport takes the overflow sideways and no card is
 * ever the thing that gives way.
 */
export function boardCellsNeeded(cells: readonly number[]): number {
  return Math.max(MIN_TILE_CELLS, ...cells);
}

/** The width, in pixels, of a board of `cells` cells and the gutters between them. */
export function boardWidth(cells: number, cell: number, gap: number): number {
  return Math.max(0, cells) * (cell + gap) - gap;
}
