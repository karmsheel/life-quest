import {
  SheetOverlay,
  useSheetCloseRequest,
} from "@/components/shell/SheetOverlay";
import { DecisionsInbox } from "./DecisionsInbox";

/**
 * The decisions inbox as a sheet over the app.
 *
 * Approving a proposal is a small interruption in the work the operator was
 * already doing, so the inbox must not replace the page they were on. It is a
 * surface like Settings: the page stays mounted behind a blurred scrim, the
 * proposal is answered in the frame, and closing the frame hands the page back
 * exactly as it was — same route, same scroll, same card under the caret.
 *
 * Two things come from the frame rather than from this file:
 *
 *  - THE CLOSE. Answering the last Decision closes the sheet from the body
 *    (Settings › Decisions › auto-close), and it has to leave in motion like the
 *    cross does. `useSheetCloseRequest` is the frame's own animated close, so the
 *    inbox never gets to unmount the frame from under its exit transition.
 *  - THE ARRIVAL. When the watcher opened this sheet because a Decision was just
 *    filed, it carries that filing's ids in the navigation state. The inbox was
 *    not on screen when the filing happened, so its own live-arrival mark never
 *    saw it; the ids let the first paint mark the card that caused the open.
 */
export function DecisionsOverlay({
  onClose,
  arrivalIds,
}: {
  onClose: () => void;
  /** Pending Decision ids whose filing opened this sheet (see `DecisionInboxAutoOpen`). */
  arrivalIds?: readonly string[];
}) {
  return (
    <SheetOverlay
      sheet="decisions"
      title="Decisions"
      subtitle="Approve a proposal to write it into the vault. Reject it to leave the vault as it is."
      showTitle
      closeLabel="Close decisions"
      onClose={onClose}
      scroll
      bodyClassName="decisions-sheet__body"
    >
      <InboxInSheet arrivalIds={arrivalIds} />
    </SheetOverlay>
  );
}

/**
 * The inbox as a child of the frame, in its own component so it can read the
 * close the frame provides. Rendered inside the portal's provider, it closes
 * exactly the way the cross does — exit motion first, then the route.
 */
function InboxInSheet({ arrivalIds }: { arrivalIds?: readonly string[] }) {
  const requestClose = useSheetCloseRequest();
  return (
    <DecisionsInbox
      showHeader={false}
      onClose={requestClose}
      arrivalIds={arrivalIds}
    />
  );
}
