/**
 * Holding the board's place while the vault changes under it.
 *
 * THE FAULT THIS REPAIRS (reported, then measured):
 *
 *   "I selected a card and asked the companion to modify it. It did the task
 *    successfully, but the board lost its position on the dashboard."
 *
 * Nothing was wrong with the write, and nothing threw the board to the top: the
 * board was still scrolled to the same pixel. What moved was everything the
 * operator was looking at, because the card the companion had just edited changed
 * height — the grid below it reflowed, and the cards after it slid by the
 * difference. On the pre-fix build, parked on the edited card, a card that grew
 * 64px moved every card below it by exactly 64px while `scrollTop` stood still at
 * 566; a re-pin of the same card slid them 151px and took the operator's place with
 * them.
 *
 * Chromium's own scroll anchoring is meant to absorb precisely this, and it does
 * some of it — which is exactly why a fix cannot be a matter of taste. What the app
 * needs is a rule it can state, measure, and be held to; that is this module, and
 * the rig is what says whether the two together ever leave a frame wrong.
 *
 * WHAT A PLACE IS
 *
 * Not a scroll offset. A pixel of `scrollTop` names nothing the operator can
 * recognise; the thing they were reading is a *card*, and how far into it the top
 * of the scrollport falls. So:
 *
 *   { pinId, viewportOffset }
 *
 * `pinId` is the last card whose top edge is at or above the fold, and
 * `viewportOffset` is that edge measured from the scrollport's own top — zero or
 * negative, by construction. Restoring re-measures that card and folds the
 * difference back into `scrollTop`.
 *
 * WHY THE TARGET IS RE-DERIVED AND NEVER STORED
 *
 * The correction is a measurement, not an accumulation: the card is found in the
 * DOM again and compared with where the hold says it was, every time. A stored
 * delta drifts the moment two things move at once — and two things moving at once
 * is the normal case here, because the board reflows and the vault re-reads on the
 * same turn.
 *
 * WHY IT IS WRITTEN STRAIGHT TO THE ELEMENT
 *
 * `scrollTop` is the browser's geometry, not React state. Writing it from a
 * layout effect (before the frame is painted) means there is no frame in which the
 * board is wrong; writing it through a re-render would be a frame late by
 * definition, and would fight the arrange gesture, which owns its own geometry.
 *
 * AND WHY THE PAGE RE-TAKES IT RATHER THAN ONLY RESTORING IT
 *
 * A hold is a claim about where the operator is, and only one thing keeps that
 * claim honest: re-taking it. A manual scroll changes no React state, so a hold
 * taken at the top of the board would still be on the books after the operator had
 * scrolled six screens down — and the next write would drag them back to where they
 * used to be, which is a worse bug than the one this module exists to fix. It is
 * the page, in `HomePage`, that re-takes the hold from the DOM on the one signal
 * that only ever means "the board moved": a scroll event.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * It is not a scroll lock and it is not a "restore my scroll position" button. A
 * hold is only ever consulted where the anchor card is still on the board: a card
 * the operator scrolled away from is a card they navigated away from, and a hold
 * aimed at a card that has gone is dropped rather than re-aimed at whatever took
 * its place.
 */

/** The scrollport the board scrolls inside, and the grid whose cards are cards. */
export type BoardFrame = {
  grid: HTMLElement;
  scrollport: HTMLElement;
};

/**
 * The place the board was in: one card, and how far the board's top edge sits into
 * it. `viewportOffset` is measured from the scrollport's own top edge, so it is
 * independent of where the window is on the screen.
 */
export type BoardHold = {
  pinId: string;
  viewportOffset: number;
};

/**
 * The board's frame, or null when there is nothing to hold.
 *
 * The scrollport is resolved rather than assumed: in the app it is
 * `.shell__content`, and in a rig it is the rig's own box. This is the same
 * resolution `usePinArrange` does for its auto-scroll, and for the same reason — a
 * board that guessed would correct the scroll of the wrong element.
 */
export function boardFrame(grid: HTMLElement | null): BoardFrame | null {
  if (!grid) return null;
  let node: HTMLElement | null = grid.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return { grid, scrollport: node };
    node = node.parentElement;
  }
  const scroller = (document.scrollingElement as HTMLElement | null) ?? null;
  return scroller ? { grid, scrollport: scroller } : null;
}

/**
 * The card the operator is reading: the last one whose top edge has reached the
 * fold.
 *
 * "Last whose top is above the fold" rather than "first whose box straddles it",
 * because a card scrolled clean off the top is still the card the operator scrolled
 * past to get where they are — and if it grows, the board has to absorb that too.
 * The lifted card is skipped: it is following a hand, not a slot.
 */
export function anchorOf(frame: BoardFrame): BoardHold | null {
  const fold = frame.scrollport.getBoundingClientRect().top;
  let anchor: BoardHold | null = null;
  for (const card of frame.grid.querySelectorAll<HTMLElement>("[data-pin-id]")) {
    const pinId = card.dataset.pinId;
    if (!pinId || card.classList.contains("is-lifted")) continue;
    const top = card.getBoundingClientRect().top - fold;
    if (top <= 0) anchor = { pinId, viewportOffset: top };
  }
  return anchor;
}

/**
 * Correct the board so the card in `hold` is where the hold says it was.
 *
 * Returns the correction in pixels: positive when the board had to move down (the
 * card had drifted up, or the board grew above it), negative when it had to move
 * up. Zero means the board was already right, which is the common case and the one
 * worth being quiet about — this runs on every layout pass of the board.
 *
 * A hold whose card is no longer on the board returns 0 and changes nothing.
 */
export function restoreBoardHold(frame: BoardFrame, hold: BoardHold | null): number {
  if (!hold) return 0;
  const card = frame.grid.querySelector<HTMLElement>(
    `[data-pin-id="${CSS.escape(hold.pinId)}"]`,
  );
  if (!card) return 0;
  const fold = frame.scrollport.getBoundingClientRect().top;
  const drift = card.getBoundingClientRect().top - fold - hold.viewportOffset;
  // Sub-pixel drift is rounding, not movement. Snapping to it would make `scroll`
  // events fire on a board nobody touched, and a scrollbar twitch is visible.
  if (Math.abs(drift) < 0.5) return 0;
  frame.scrollport.scrollTop += drift;
  return drift;
}

/** Whether the board has anywhere to scroll. A short board has no place to hold. */
export function boardScrolls(frame: BoardFrame): boolean {
  return frame.scrollport.scrollHeight - frame.scrollport.clientHeight > 1;
}

/**
 * Re-take the hold every time the board scrolls, and return the unsubscribe.
 *
 * A scroll is one of exactly two things: the operator moving the board, or this page
 * correcting it. The first has to re-take the hold — it is a place the hold does not
 * know about — and the second is a no-op, because at that instant the hold and the
 * board agree. One listener answers both without having to tell them apart.
 *
 * That indistinguishability is the point. The page cannot work out which it is from
 * the board, because a card re-running displaces the board inside React's own commit,
 * with no scroll event and no render of the page to notice it. The event is the one
 * signal that only ever means "something moved the board", and the operator's hand is
 * the only thing that can do so without the page already knowing.
 *
 * Passive: it reads, and never prevents anything.
 */
export function watchBoardHold(
  frame: BoardFrame,
  onHold: (hold: BoardHold) => void,
): () => void {
  const update = () => {
    const next = anchorOf(frame);
    if (next) onHold(next);
  };
  frame.scrollport.addEventListener("scroll", update, { passive: true });
  return () => frame.scrollport.removeEventListener("scroll", update);
}
