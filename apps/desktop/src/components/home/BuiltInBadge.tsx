import { Blocks } from "lucide-react";

/**
 * The marker a built-in card wears beside its heading.
 *
 * The Dashboard's cards are two kinds. A built-in card (goals, deadline, today &
 * this week, pending decisions, recent activity) is app furniture: there is no
 * view or page file behind it, the operator cannot delete it, and its pin is not
 * a record. A card the operator made — a saved view or a page — is the other
 * kind. They behave differently, so the card says which it is, in its first row:
 * a small blocks glyph after the heading, and a card the operator created wears
 * none. The absence is the other half of the fact.
 *
 * It lives in the heading rather than in the chrome because it is INFORMATION,
 * not a board control: a locked board takes the card menu away and keeps this.
 * It takes no presses of its own (`pointer-events: none`) — a press on the
 * marker is a press on the card, which is the chat-context toggle.
 */
export function BuiltInBadge() {
  return (
    <span
      className="home-pin__builtin"
      role="img"
      aria-label="Built-in card"
      title="Built-in card — part of the app, not a card you created"
    >
      <Blocks size={12} aria-hidden />
    </span>
  );
}
