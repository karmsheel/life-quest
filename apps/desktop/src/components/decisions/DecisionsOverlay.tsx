import { SheetOverlay } from "@/components/shell/SheetOverlay";
import { DecisionsInbox } from "./DecisionsInbox";

/**
 * The decisions inbox as a sheet over the app.
 *
 * Approving a proposal is a small interruption in the work the operator was
 * already doing, so the inbox must not replace the page they were on. It is a
 * surface like Settings: the page stays mounted behind a blurred scrim, the
 * proposal is answered in the frame, and closing the frame hands the page back
 * exactly as it was — same route, same scroll, same card under the caret.
 */
export function DecisionsOverlay({ onClose }: { onClose: () => void }) {
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
      <DecisionsInbox showHeader={false} />
    </SheetOverlay>
  );
}
