import { useState } from "react";
import { useUpdate } from "@/state/UpdateProvider";
import { UpdateDialog } from "./UpdateDialog";

/**
 * The build number at the foot of the rail.
 *
 * At rest it is what it has always been: one line of text in the rail's own
 * muted ink, not a control — nothing to click, nothing to tab into, no focus
 * ring in a column of nav rows. It becomes a *button* only when the feed named a
 * newer version, and then it carries the glow: the one affordance in the rail
 * that appears out of nowhere, which is the point.
 *
 * The glow is a state, so it wears the state ink (`--accent`) rather than a
 * decoration colour, and it is the only thing about the rail that moves.
 */
export function UpdateBadge() {
  const { current, available, phase, shown, previewing } = useUpdate();
  const [open, setOpen] = useState(false);

  if (!available) {
    return (
      <p className="nav-rail__version" data-update-state={phase}>
        v{current}
      </p>
    );
  }

  const latest = shown?.state === "available" ? shown.latest : null;

  return (
    <>
      <button
        type="button"
        className="nav-rail__version nav-rail__version--available"
        data-update-state="available"
        data-update-version={latest ?? ""}
        data-update-preview={previewing ? "true" : "false"}
        aria-label={
          previewing
            ? `Version ${current}. Previewing the update badge — no release is being offered.`
            : `Version ${current}. LifeQuest ${latest} is available to download.`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          previewing
            ? "Preview of the update badge"
            : `LifeQuest ${latest} is available`
        }
        onClick={() => setOpen(true)}
      >
        v{current}
      </button>
      <UpdateDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
