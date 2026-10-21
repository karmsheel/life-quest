import { MoreVertical } from "lucide-react";

/**
 * The chrome a pin wears, in the app's own icon vocabulary.
 *
 * ONE control: the 3-dot that opens the card's own menu. The menu holds Edit
 * card, Archive, and Delete where there is something behind the card to delete.
 *
 * THE WIDTH BUTTON IS GONE, and Edit card is why. It offered two named widths —
 * "Fill the row" and "Size to the content" — which was the board's coarse
 * vocabulary, not the operator's: the request was to extend a card by hand, in
 * both directions, so a button that could only toggle one axis was the wrong
 * instrument beside a menu that can open the real one. Edit card puts the card in
 * Edit mode, where the right and bottom borders are drag handles; the old button's
 * "fill the row" survives as the far end of the right-edge drag, so the same
 * board state is still reachable, and by a gesture that says what it does.
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
 * This is not a `Button`: that primitive is a pill with a text label, and a
 * 1.55rem square icon well is not. It keeps the board's own `.home-pin__btn`,
 * which is also what the dashboard rigs count.
 *
 * This whole component is board-editing chrome, and the page lock takes it away:
 * a locked board draws no menu — and no tab stop on the cards either, so the lock
 * takes the whole gesture and not just its buttons. The chat control is the
 * page's, not this component's, which is why asking about a card survives the
 * lock while changing one does not.
 */
export function PinChrome({
  busy,
  menuOpen,
  onToggleMenu,
  onEdit,
  onArchive,
  onDelete,
}: {
  busy: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  /** Put this card in Edit mode: its borders become drag handles. */
  onEdit: () => void;
  onArchive: () => void;
  /**
   * Absent for a built-in card. A system card is app furniture, not a record, so
   * there is nothing behind it to delete — and the menu says so by not offering
   * it, rather than by offering an action that cannot work.
   */
  onDelete?: (control: HTMLElement) => void;
}) {
  return (
    <div className="home-pin__chrome">
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
            data-testid="pin-edit"
            title="Resize this card with its right and bottom borders"
            disabled={busy}
            onClick={onEdit}
          >
            Edit card
          </button>
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
