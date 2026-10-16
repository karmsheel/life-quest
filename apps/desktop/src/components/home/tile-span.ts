/**
 * The board's tiles: how many layout units a card's content needs, and how narrow
 * the board may be while still giving every card that many.
 *
 * THE FIRST FAULT THIS REPAIRED (reported, then measured in the operator's own
 * vault):
 *
 *   "The tables can change size but when made smaller they often compress beyond
 *    the data they hold, causing it to spill over. Right now the Recent
 *    Transactions card is showing that spillover effect."
 *
 * The card's pin said `span: 1` — one cell of 17rem — and its content was a
 * four-column listing whose every cell is `white-space: nowrap`. A table does not
 * shrink below its own min-content width, and nothing in the sheet stopped it
 * from painting outside the card's frame.
 *
 * THE SECOND FAULT, WHICH IS THE FIRST ONE'S TWIN (also reported):
 *
 *   "Some tables are still showing lots of empty space — the space between the
 *    Category and Amount columns is too much."
 *
 * Sizing a card in WHOLE 17rem cells is a coarse instrument: that same card needs
 * 348px, and the next cell up is 605px, so 225px of leftover was handed to the
 * card and then spread across its columns by a table told to fill it. The unit
 * here is a quarter of that cell, so the same card lands at 394px — 46px of
 * leftover rather than 225 — and the layout stays a grid: every card's edges fall
 * on the same fine rhythm, and the sums still work out.
 *
 * THE RULE
 *
 * Four numbers, all of them measurements rather than opinions:
 *
 *   need — the width below which a card's own content would overflow it. The
 *          browser already knows this: it is the card's min-content width, and
 *          `useTileSpans` reads it off the real card.
 *   unit — the layout step, `--home-tile-unit-rem` on the board. A card is a
 *          whole number of these.
 *   gap  — the board's own gutter, read from the same computed style.
 *   min  — the fewest units a card may be, `--home-tile-min-units`: the floor
 *          that keeps a one-number card from collapsing to a sliver.
 *
 * `unitsNeeded` answers "how many units does this card's content need", and
 * `boardWidth` answers "how narrow may the board be and still give every card
 * that many". Both are pure, and both are functions of CONTENT ALONE: a card's
 * width never depends on its neighbours, so the board cannot oscillate — measure,
 * place, and the second measurement is the first one again.
 *
 * WHY THE UNIT IS A CONSTANT, AND NOT THE TRACK WIDTH ON SCREEN
 *
 * A track is `minmax(unit, 1fr)`, so it grows with the window. A card measured
 * against the width it happens to have would want one span on a wide window and
 * another on a narrow one — and once the span changed the track width back, it
 * would want the first answer again, for ever. The unit is the design's floor, so
 * the answer is the same at every window size. Because a track is never narrower
 * than the unit, arithmetic done in units is conservative: a card always gets at
 * least the pixels its content needs.
 */

/**
 * The layout step in rem, as a fallback for a stylesheet that has not loaded.
 * `--home-tile-unit-rem` on `.home-dashboard__grid` is the real number and the
 * only place it is written down: the sheet sizes its tracks from it and this
 * module reads it back, so the two cannot drift.
 *
 * A quarter of the 17rem cell the board used to be built from, which is what makes
 * this a refinement rather than a different board: every width the old grid could
 * draw is still a width this one can draw.
 */
export const TILE_UNIT_REM = 4.25;

/** The fewest units a card may be, as a fallback for the same variable. */
export const TILE_MIN_UNITS = 4;

/**
 * How few cards the board is ever drawn across.
 *
 * Two, because a board of one is not a board: the operator's own words are "we
 * might only fit 2 on a certain line while on the next one fit 3", and a window
 * too narrow for two gets a board that is wider than it is — the sheet scrolls
 * sideways — rather than one card stretched down a column.
 */
export const MIN_TILE_CARDS = 2;

/** A length from the board's own custom properties, or the given fallback. */
function declared(
  boardStyle: CSSStyleDeclaration,
  property: string,
  fallback: number,
): number {
  const value = Number.parseFloat(boardStyle.getPropertyValue(property));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The layout step, in pixels: the track the board is actually drawing.
 *
 * A track is `minmax(unit, 1fr)`, so the resolved value is never narrower than the
 * design's unit and grows with the window. Reading it back rather than using the
 * constant is what lands a card *within* a step instead of one step over: a card
 * whose content needs 398px wants five tracks of 68.9px, and arithmetic against
 * the 68px constant alone asks for six — 481px around a 366px table, which is the
 * empty space this whole module exists to remove.
 *
 * WHY THAT CANNOT OSCILLATE, since a card's span decides how wide the board is and
 * the board decides how wide a track is. A track's width does not depend on any
 * one card's span: it is chosen by the window and the board's floor, and its count
 * is chosen to fit as many whole units as the width allows, so a track lands in
 * [unit, unit + (unit + gap) / count]. Feeding that back in reproduces the same
 * count — which is why `boardWidth` below is written as the exact inverse of the
 * layout — and the rig's `stable` claim is what holds it to that at four widths.
 *
 * The fallback is the constant, for the first pass before the grid has a layout.
 */
export function tileStep(boardStyle: CSSStyleDeclaration, rootFontSizePx: number): number {
  const tracks = boardStyle.gridTemplateColumns.trim();
  const resolved = tracks && tracks !== "none" ? Number.parseFloat(tracks) : Number.NaN;
  if (Number.isFinite(resolved) && resolved > 0) return resolved;
  const rem = declared(boardStyle, "--home-tile-unit-rem", TILE_UNIT_REM);
  const root = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : 16;
  return rem * root;
}

/** The fewest units a card may be, from the board's own style. */
export function minTileUnits(boardStyle: CSSStyleDeclaration): number {
  return Math.max(1, Math.round(declared(boardStyle, "--home-tile-min-units", TILE_MIN_UNITS)));
}

/**
 * How many units a card whose content needs `need` pixels has to have.
 *
 * "How many units, with the gutters between them, add up to at least `need`" —
 * the inverse of the layout, so a card is never given fewer pixels than its
 * content needs and therefore can never paint outside its own frame.
 *
 * The floor is the design's, not the content's: a card that needs 40px is still a
 * card, and one narrower than a few units would be a column of wrapped headlines.
 */
export function unitsNeeded(need: number, step: number, gap: number, minUnits: number): number {
  const floor = Math.max(1, minUnits);
  if (!Number.isFinite(step) || step <= 0) return floor;
  const wanted = Math.ceil((Math.max(0, need) + gap) / (step + gap));
  if (!Number.isFinite(wanted)) return floor;
  return Math.max(floor, wanted);
}

/**
 * The board's own floor, in units: as many as its widest card needs, and never
 * fewer than two cards' worth.
 *
 * This is the whole of "widen the board rather than squeeze a card". A board
 * narrower than this would have to draw some card in fewer units than its content
 * needs — the reported fault, arrived at from the other end — or would stop being
 * a board with two cards on a line. With it, the sheet's own scrollport takes the
 * overflow sideways and no card is ever the thing that gives way.
 */
export function boardUnitsNeeded(cells: readonly number[], minUnits: number): number {
  const floor = MIN_TILE_CARDS * Math.max(1, minUnits);
  return Math.max(floor, ...cells);
}

/** The width, in pixels, of a board of `units` units and the gutters between them. */
export function boardWidth(units: number, step: number, gap: number): number {
  return Math.max(0, units) * (step + gap) - gap;
}
