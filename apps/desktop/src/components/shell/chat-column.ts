/**
 * The dock's column as a width the operator can drag, and the range that drag is
 * held to.
 *
 * The divider between the page and the dock is the same gesture DeepSeek Harness
 * puts on its own side panel, and it is bounded the same way: a floor the panel
 * cannot go under, a ceiling it cannot go over, and a page that keeps enough room
 * to work in between them. Harness solves its frame as `[264, 420]` for the
 * sidebar and `[300, 70% of the frame]` for the right panel, with a 400px centre
 * it will not squeeze; this is that contract for one dock, restated once so the
 * gesture and the shell's own CSS variable cannot disagree about the range.
 *
 * Pure on purpose, and frame-in / frame-out: the shell measures the frame, and
 * the same two numbers answer both "how wide may this be" and "where does a
 * requested width land". Nothing here reads the DOM.
 */

/**
 * The dock's floor, in px.
 *
 * 300px is the width below which the dock stops being a dock: a composer that
 * wraps its own controls and a transcript that fits a sentence per line. It is
 * Harness's own number for the same panel.
 */
export const CHAT_COLUMN_MIN_PX = 300;

/**
 * The dock's ceiling as a share of the frame.
 *
 * Two thirds is not a floor and not a half-but-not-really: past this the page is
 * the minority pane, and a dock that has taken most of the window is what the
 * dock's own collapse control is for. Harness caps its right panel at 0.7 of the
 * frame for the same reason.
 */
export const CHAT_COLUMN_MAX_RATIO = 0.7;

/**
 * The room the page keeps for itself, in px.
 *
 * The dock is capped by whichever bites first, the ratio above or this. Harness
 * hands its centre column a 400px minimum and lets that minimum — not the ratio —
 * decide the ceiling on a narrow window; a page squeezed under it is a page the
 * operator has to scroll sideways to read.
 */
export const CHAT_COLUMN_PAGE_MIN_PX = 400;

/**
 * How far one arrow key moves the divider, in px.
 *
 * A pointer can land on any pixel; a key cannot, and a step that matched the
 * handle's own width would make the keyboard a game of millimetres. One rem is
 * the same step the card width handle takes in its own units — a press is a
 * deliberate nudge, not a nudge-sized nudge.
 */
export const CHAT_COLUMN_KEY_STEP_PX = 16;

/**
 * The frame the dock and the page are sharing.
 *
 * `viewport` is the shell's own content width — the sum of its three tracks, not
 * the window's, because the shell already stands inside the window's frame and
 * the pane gap. `nav` is the rail's track, 0 while the rail is collapsed.
 */
export type ChatColumnFrame = {
  viewport: number;
  nav: number;
};

/** The widths the dock's column may take in one frame, both inclusive. */
export type ChatColumnRange = {
  min: number;
  max: number;
};

/**
 * The range the dock's column may take in one frame.
 *
 * The ceiling is the smaller of the ratio and what the page's own floor leaves
 * over — and never under the floor itself. A window narrow enough for the page's
 * floor to beat the dock's has to give somewhere; the column that is not allowed
 * to shrink is the one that is not allowed to grow, so the dock keeps its floor
 * and the page gives.
 */
export function chatColumnRange(frame: ChatColumnFrame): ChatColumnRange {
  const min = CHAT_COLUMN_MIN_PX;
  const share = Math.round(frame.viewport * CHAT_COLUMN_MAX_RATIO);
  const room = Math.round(frame.viewport - frame.nav - CHAT_COLUMN_PAGE_MIN_PX);
  return { min, max: Math.max(min, Math.min(share, room)) };
}

/**
 * One requested width, whole and inside the range.
 *
 * The rounding lives here rather than at the callers so the drag, the arrow keys
 * and the render-time re-clamp all land on the same integer pixel: a column that
 * measured 419.4 in one place and 419 in another would make the handle and the
 * pane it moves disagree by a fraction on every pass.
 */
export function clampChatColumn(px: number, range: ChatColumnRange): number {
  if (!Number.isFinite(px)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(px)));
}
