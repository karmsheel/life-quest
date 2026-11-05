/**
 * The chat dock, made readable and writable from a driver.
 *
 * Both halves of the card-context rig need the same things: a way to see what a
 * page put in the dock's context, and — on the chat half, where the Dashboard is
 * not necessarily the surface being clicked — a way to put a card there in the
 * first place. This probe is that seam, and it is the only place a driver
 * reaches into React state.
 *
 * It exposes the facts the turn is built from and the three actions the feature
 * has, nothing else:
 *
 *   `${channel}Dock`       — `{ open, contextCards, livePinIds }`, the dock's
 *                            own state, re-published after every render.
 *   `${channel}ToggleCard` — the operator's card click: add, remove, or refuse
 *                            (returns `"added" | "removed" | "full"`).
 *   `${channel}RemoveCard` — one card out, by pin id: the pill's own door.
 *   `${channel}ClearCards` — every card out: the empty board's own door.
 *
 * `channel` namespaces the globals, so two rigs cannot read each other's dock
 * even if they were ever mounted on one page.
 */
import { useEffect } from "react";
import { useChatDock, type ChatCardContext } from "@/state/ChatDockProvider";

export function ChatDockProbe({ channel }: { channel: string }) {
  const {
    open,
    contextCards,
    livePinIds,
    toggleCardContext,
    removeCardContext,
    clearCardContext,
  } = useChatDock();

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w[`${channel}Dock`] = { open, contextCards, livePinIds };
    w[`${channel}ToggleCard`] = (card: ChatCardContext) => toggleCardContext(card);
    w[`${channel}RemoveCard`] = (pinId: string) => removeCardContext(pinId);
    w[`${channel}ClearCards`] = () => clearCardContext();
  }, [
    channel,
    open,
    contextCards,
    livePinIds,
    toggleCardContext,
    removeCardContext,
    clearCardContext,
  ]);

  return null;
}
