import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useUpdate } from "@/state/UpdateProvider";
import { UpdateDialog } from "./UpdateDialog";

/**
 * The in-app notice for a release the app learned about while it was open.
 *
 * THE FAULT THIS REPAIRS (reported, not imagined): the rail's build number glows
 * when a newer release exists, but it sits at the foot of a column of icons and
 * is easy to miss — the operator only found out about an update if they happened
 * to click it. And until main read the feed on a clock, a release published while
 * the studio was open produced no glow at all until the next launch.
 *
 * So this is the unmissable half: a card at the foot of the content column, shown
 * once per release, with the one action that matters (open the offer) and a
 * dismissal for the operator who is in the middle of something. It is news, not a
 * decision: it never takes focus, never covers the composer, and never blocks the
 * page. The rail stays the quiet, always-there sign; this is the tap on the
 * shoulder.
 *
 * It draws the same `UpdateDialog` the build number opens, from the same provider
 * state, so "View update" is not a second, weaker offer — it is the offer.
 *
 * The ways this can fail, before the code:
 *  1. No notice — nothing is rendered at all: no empty floating card over the
 *     page.
 *  2. A notice dismissed — the card goes and stays gone for that release, because
 *     `announce` in the provider remembers what was already announced.
 *  3. A release that was announced and then withdrawn — the provider clears the
 *     notice, so the card cannot outlive the offer it describes.
 *  4. The dialog open while the notice is dismissed under it — the dismissal
 *     control is only on the card, and the card is the dialog's opener; a closed
 *     dialog re-renders with the card exactly as it was.
 *  5. A screen reader — the card is a polite status region labelled with the
 *     release it announces, so it is heard once without interrupting a turn.
 */
export function UpdateNotice() {
  const { current, notice, dismissNotice } = useUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!notice) return null;

  return createPortal(
    <>
      <section
        className="update-notice"
        role="status"
        aria-live="polite"
        aria-label={`LifeQuest ${notice.latest} is available`}
        data-update-notice={notice.latest}
      >
        <span className="update-notice__icon" aria-hidden="true">
          <Download size={16} />
        </span>
        <div className="update-notice__text">
          <p className="update-notice__title">
            LifeQuest {notice.latest} is available
          </p>
          <p className="update-notice__body">
            You are running v{current}. The new release is ready to download.
          </p>
        </div>
        <div className="update-notice__actions">
          <Button
            type="button"
            variant="outline"
            aria-label={`Open the LifeQuest ${notice.latest} update`}
            onClick={() => setDialogOpen(true)}
          >
            View update
          </Button>
          <button
            type="button"
            className="update-notice__dismiss"
            aria-label="Dismiss the update notice"
            title="Dismiss"
            onClick={dismissNotice}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </section>
      <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>,
    document.body,
  );
}
