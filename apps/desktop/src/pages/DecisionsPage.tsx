import { DecisionsOverlay } from "@/components/decisions/DecisionsOverlay";
import { useSheetClose } from "@/components/shell/useSheetBackground";

/**
 * The decisions sheet, as the router sees it.
 *
 * Like settings, `/decisions` is a surface over the page the operator was on,
 * not a page of its own. Closing unwinds that one navigation and returns them
 * to the route, scroll position, and mounted page they left.
 */
export default function DecisionsPage() {
  const onClose = useSheetClose();
  return <DecisionsOverlay onClose={onClose} />;
}
