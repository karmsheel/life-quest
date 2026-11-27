The Dashboard MUST be a pin board per lens: the Overview board, and one board for each live domain.

An unlocked Dashboard MUST be editable in place by the operator and by the companion.

A locked Dashboard MUST NOT be edited in place by an agent.

Agents MUST NOT lock or unlock a Dashboard.

An agent change to a locked Dashboard MUST appear as a pending Decision.

Approving a Decision that puts a card on a locked Dashboard MUST NOT unlock the Dashboard.

An unlocked Dashboard MUST be reorderable by dragging a card to the position it is dropped in.

Every card on an unlocked Dashboard MUST be reorderable from the keyboard.

The Dashboard's pin board MUST be a control the operator can open and close.

Every pinned card on a Dashboard MUST be addable to the companion chat as context.

The companion chat MUST hold at most three cards in context at once.

A card in context MUST be named in the companion chat before the turn is sent.

A card in the companion chat's context MUST be marked as such on the Dashboard.

Pressing a card already in the companion chat's context MUST take that card out of the context, and MUST leave every other card in it.

A card MUST NOT carry a chat control of its own; the card itself is the control.

Pressing empty board space MUST take every card out of the companion chat's context.

A card's own controls other than its context toggle MUST NOT change the companion chat's context.

Taking a card into or out of the companion chat's context MUST NOT edit the Dashboard, and MUST be possible on a locked Dashboard.

Deleting what a Dashboard card draws MUST be confirmed by the operator first.

Taking a card off a Dashboard MUST NOT delete what the card draws.

The companion brief MUST be written only by the companion.

Only the operator MUST be able to dismiss a brief item, and the companion MUST NOT be able to dismiss, complete or hide one.

A brief item MUST stop being active when it expires, and its lapse MUST be recorded as an `expired-unseen` dismissal for the companion.

The companion brief card MUST be offered first on every Dashboard, and a brief the operator removes MUST stay removed until they pin it again.

A locked Dashboard MUST NOT stop the companion writing the companion brief: the lock governs the cards, and the brief is a record a card draws.
