import type { ChatDockSide } from "@/state/ChatDockProvider";
import type { ChatColumnDividerProps } from "./useChatColumn";

/**
 * The seam between the page and the dock, wearing a handle.
 *
 * The studio's panes abut, and the only line between them is the sheet's own
 * hairline — so the handle is deliberately not a second line: at rest it is an
 * invisible strip straddling the seam, and the seam itself is what the operator
 * sees. The column-resize cursor is the offer to drag it; an accent bar appears
 * only on focus and under the hand, the same mark the board uses for a card's
 * width, because it is the same offer. Hover alone draws nothing.
 *
 * It is drawn a little to the page's side of the seam rather than centred on it.
 * Whichever pane sits to the left of the seam scrolls there — the page's own
 * scrollbar when the dock trails, the dock's transcript when it leads — and a
 * handle that covered the middle of an eight-pixel bar would eat the one thing
 * the operator aims at to scroll.
 *
 * The width, the range and the gesture all arrive through `props`; this component
 * is the element they are worn by. It is only rendered while the dock is open:
 * a collapsed dock is a tab, and there is no column in it to drag.
 */
export function ChatDivider({
  side,
  props,
}: {
  side: ChatDockSide;
  props: ChatColumnDividerProps;
}) {
  return (
    <div
      {...props}
      className="chat-divider"
      data-side={side}
      data-testid="chat-divider"
      title="Drag to resize the chat dock"
    />
  );
}
