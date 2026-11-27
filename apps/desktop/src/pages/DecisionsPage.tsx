import { useLocation } from "react-router-dom";
import { DecisionsOverlay } from "@/components/decisions/DecisionsOverlay";
import { useSheetClose } from "@/components/shell/useSheetBackground";

/**
 * The decisions sheet, as the router sees it.
 *
 * Like settings, `/decisions` is a surface over the page the operator was on,
 * not a page of its own. Closing unwinds that one navigation and returns them
 * to the route, scroll position, and mounted page they left.
 *
 * A filing that opened the sheet itself arrives with the ids of what was filed
 * in the navigation state (`DecisionInboxAutoOpen`), because the inbox was not on
 * screen when the Decision was written and so never saw it arrive. The ids are
 * handed to the sheet so the first paint can mark the card that caused the open.
 */
type DecisionsLocationState = { decisionArrivalIds?: string[] } | null;

export default function DecisionsPage() {
  const onClose = useSheetClose();
  const location = useLocation();
  const arrivalIds = (location.state as DecisionsLocationState)?.decisionArrivalIds;
  return <DecisionsOverlay onClose={onClose} arrivalIds={arrivalIds} />;
}
