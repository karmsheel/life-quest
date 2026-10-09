import { GripVertical, Maximize2, Minimize2, PinOff } from "lucide-react";
import type { Pin } from "@lifequest/vault-core";

/**
 * The chrome a pin wears, in the app's own icon vocabulary.
 *
 * Three controls, icon-only, in the order the board reads left to right:
 *
 *   move (grip)  — picks the card up, and is a real button so the keyboard can
 *                  arrange the board too (Enter lifts, arrows move, Enter drops)
 *   width        — view pins only: one cell, or the whole row
 *   unpin        — takes the card off this board
 *
 * The glyphs these replace (`✕ ↑ ↓ ◧ ♭`) were the board's whole control
 * vocabulary and none of them said what they did: a `✕` reads as *close*, and
 * an arrow reads as a list, which a wrapping grid is not. Icons come from
 * `lucide-react`, the same set the titlebar and the chat panel draw with, so a
 * pin's controls and a chat's pin look like the same product.
 *
 * These are not `Button`s: that primitive is a pill with a text label, and a
 * 1.55rem square icon well is not. They keep the board's own `.home-pin__btn`,
 * which is also what the dashboard rigs count.
 *
 * The grip is deliberately the *first* control and the only one with no
 * `onClick`: a drag that starts and ends on it fires a trailing click, and a
 * handler there would make a drop do a second, invisible thing.
 */
export function PinChrome({
  pin,
  busy,
  onUnpin,
  onCycleSpan,
}: {
  pin: Pin;
  busy: boolean;
  onUnpin: () => void;
  onCycleSpan: () => void;
}) {
  const widen = pin.kind === "view" && pin.span !== 2;
  const spanLabel = pin.kind === "view" && pin.span === 2 ? "Shrink to one cell" : "Widen to full row";

  return (
    <div className="home-pin__chrome">
      <button
        type="button"
        className="home-pin__btn home-pin__grip"
        data-pin-grip=""
        data-testid="pin-grip"
        aria-label="Move card"
        title="Move card"
        disabled={busy}
      >
        <GripVertical size={14} aria-hidden />
      </button>

      {pin.kind === "view" ? (
        <button
          type="button"
          className="home-pin__btn"
          data-testid="pin-span"
          aria-label={spanLabel}
          title={spanLabel}
          disabled={busy}
          onClick={onCycleSpan}
        >
          {widen ? <Maximize2 size={14} aria-hidden /> : <Minimize2 size={14} aria-hidden />}
        </button>
      ) : null}

      <button
        type="button"
        className="home-pin__btn"
        data-testid="pin-unpin"
        aria-label="Unpin card"
        title="Unpin card"
        disabled={busy}
        onClick={onUnpin}
      >
        <PinOff size={14} aria-hidden />
      </button>
    </div>
  );
}
