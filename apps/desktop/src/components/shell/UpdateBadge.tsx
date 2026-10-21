import { useRef, useState } from "react";
import { useUpdate } from "@/state/UpdateProvider";
import { UpdateDialog } from "./UpdateDialog";

/**
 * The build number at the foot of the rail, and the app's one manual update
 * affordance.
 *
 * It is a control at all times, so the operator can always ask. What it opens
 * depends on what is already known:
 *
 *  · a release is being offered (or the Developer preview is on) — the popup is
 *    that offer, and no request is made: the answer is already in hand;
 *  · nothing is being offered — the popup opens on "checking", the feed is read
 *    with `force`, and the popup becomes whichever answer came back: the offer,
 *    "you're up to date", or why the check could not answer.
 *
 * At rest it stays the quiet line it has always been — the rail's muted ink, no
 * fill, no halo. It gains the glow (and the words above it) only when there is
 * something to install, because the glow is a state, not a button style. The one
 * thing it gains from being a control everywhere is the affordance a control
 * needs: hover ink, a focus ring, and a pointer.
 */
export function UpdateBadge() {
  const { current, available, phase, shown, previewing, refresh } = useUpdate();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const latest = shown?.state === "available" ? shown.latest : null;

  function openPanel() {
    setOpen(true);
    // An offer in hand is the answer: showing it costs nothing and re-reading the
    // feed under an open popup would only replace it while the operator reads.
    if (shown?.state === "available") return;
    // Everything else is a question the operator just asked. `force` reaches the
    // network rather than replaying the session's cached answer, and a request
    // already in flight (the launch's own check) is joined rather than doubled.
    void refresh({ force: true });
  }

  function closePanel() {
    setOpen(false);
    // The popup takes the focus when it opens, so dismissing it comes back to the
    // control that opened it rather than dropping the keyboard on the page.
    trigger.current?.focus();
  }

  return (
    <>
      {available ? (
        <p
          className="nav-rail__update-label"
          data-update-label={previewing ? "preview" : "available"}
        >
          Update available
        </p>
      ) : null}
      <button
        type="button"
        ref={trigger}
        className={
          available
            ? "nav-rail__version nav-rail__version--available"
            : "nav-rail__version"
        }
        data-update-state={available ? "available" : phase}
        {...(latest === null ? {} : { "data-update-version": latest })}
        data-update-preview={previewing ? "true" : "false"}
        aria-label={
          previewing
            ? `Version ${current}. Previewing the update badge — no release is being offered.`
            : available
              ? `Version ${current}. LifeQuest ${latest} is available to download.`
              : `Version ${current}. Check for updates.`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          previewing
            ? "Preview of the update badge"
            : available
              ? `LifeQuest ${latest} is available`
              : "Check for updates"
        }
        onClick={openPanel}
      >
        v{current}
      </button>
      <UpdateDialog open={open} onClose={closePanel} />
    </>
  );
}
