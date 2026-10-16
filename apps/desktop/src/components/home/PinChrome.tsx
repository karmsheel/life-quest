import { Maximize2, Minimize2, MoreVertical } from "lucide-react";
import type { Pin } from "@lifequest/vault-core";

/**
 * The chrome a pin wears, in the app's own icon vocabulary.
 *
 * Two controls at most, icon-only, in the order the board reads left to right:
 *
 *   width        — view pins only: one cell, or the whole row
 *   menu (3-dot) — the card's own actions: Archive, and Delete where there is
 *                  something behind the card to delete
 *
 * THE GRIP IS GONE, and it is not a loss. It was the chrome's drag handle: it
 * picked a card up on four pixels of movement instead of on the hold the rest of
 * the card asks for, so the board offered two ways to start one gesture — one of
 * them a 1.55rem box the operator had to find before the board would move at
 * all. Holding the card does all of it now, anywhere on the card. What the grip
 * alone could do is keep the gesture reachable without a pointer, and that is
 * kept: the card itself is the handle. `HomePage` makes an unlocked card a tab
 * stop, and `usePinArrange` lifts it on Enter, places it with the arrows and
 * drops it on Enter again.
 *
 * The glyphs these replace (`✕ ↑ ↓ ◧ ♭`) were the board's whole control
 * vocabulary and none of them said what they did: a `✕` reads as *close*, and
 * an arrow reads as a list, which a wrapping grid is not. Icons come from
 * `lucide-react`, the same set the titlebar and the chat panel draw with, so a
 * pin's controls and a chat's row look like the same product.
 *
 * The pin-off glyph that used to sit here is gone: it was the board's least
 * legible control — "unpin" is a word about pins, not about the card in front of
 * the operator — and it was the only removal the board offered, so the one thing
 * an operator most needs to find was the one thing it was hardest to read. Both
 * removals live in the menu now, named.
 *
 * These are not `Button`s: that primitive is a pill with a text label, and a
 * 1.55rem square icon well is not. They keep the board's own `.home-pin__btn`,
 * which is also what the dashboard rigs count.
 *
 * This whole component is board-editing chrome, and the page lock takes it away:
 * a locked board draws no width control and no menu — and no tab stop on the
 * cards either, so the lock takes the whole gesture and not just its buttons. The
 * chat control is the page's, not this component's, which is why asking about a
 * card survives the lock while changing one does not.
 */
export function PinChrome({
  pin,
  busy,
  menuOpen,
  onToggleMenu,
  onArchive,
  onDelete,
  onCycleSpan,
}: {
  pin: Pin;
  busy: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onArchive: () => void;
  /**
   * Absent for a built-in card. A system card is app furniture, not a record, so
   * there is nothing behind it to delete — and the menu says so by not offering
   * it, rather than by offering an action that cannot work.
   */
  onDelete?: (control: HTMLElement) => void;
  onCycleSpan: () => void;
}) {
  const widen = pin.kind === "view" && pin.span !== 2;
  const spanLabel = pin.kind === "view" && pin.span === 2 ? "Shrink to one cell" : "Widen to full row";

  return (
    <div className="home-pin__chrome">
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
        data-testid="pin-menu-toggle"
        aria-label="Card actions"
        title="Card actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={onToggleMenu}
      >
        <MoreVertical size={14} aria-hidden />
      </button>

      {/*
        The popup hangs under the chrome, over the cards below: the board is a
        grid, so an inline menu would push its own card's neighbours around. It
        is inside the chrome rather than beside it for one reason that matters —
        the chrome is what the lock takes away, so the menu inherits the lock
        without a second gate that could drift from it.
      */}
      {menuOpen ? (
        <div className="home-pin__menu" role="menu" data-testid="pin-menu">
          <button
            type="button"
            role="menuitem"
            data-testid="pin-archive"
            title="Take the card off this dashboard"
            disabled={busy}
            onClick={onArchive}
          >
            Archive
          </button>
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              data-testid="pin-delete"
              className="home-pin__menu-danger"
              title="Delete what this card draws, everywhere"
              disabled={busy}
              onClick={(e) => onDelete(e.currentTarget)}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
