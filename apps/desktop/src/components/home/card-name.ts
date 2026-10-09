/**
 * What a card is called.
 *
 * One reader, because a card is named in exactly two places now — the arrange
 * gesture's spoken announcement, and the card the chat is handed — and a name
 * that disagrees between them is worse than no name at all.
 *
 * The name is read off the card's own heading rather than rebuilt from the pin:
 * the heading is what the operator can see, so it cannot drift from what they
 * are being told. A card's heading is the only name it has.
 */

/** The heading a card draws its name in. The deadline banner's is its label. */
const CARD_HEADING =
  ".home-card__title, .view-card__title, .deadline-banner__label";

/**
 * A card's own words, or `""` when it painted no heading.
 *
 * Only the heading's **own** text nodes count: a card's count badge is a number
 * the card draws beside its name, not part of it, so `Goals 3` is "Goals" — the
 * card is called what its heading says, not what its subtree contains.
 */
export function cardNameIn(card: Element | null): string {
  const heading = card?.querySelector<HTMLElement>(CARD_HEADING);
  if (!heading) return "";
  const own = Array.from(heading.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("");
  return (own.trim() || heading.textContent?.trim() || "").trim();
}
