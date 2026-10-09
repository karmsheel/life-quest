/**
 * The chat dock, made readable and writable from a driver.
 *
 * Both halves of the card-context rig need the same two things: a way to see
 * what a page put in the dock's context, and — on the chat half, where the
 * Dashboard is not mounted — a way to put a card there in the first place. This
 * probe is that seam, and it is the only place a driver reaches into React
 * state.
 *
 * `channel` namespaces the two globals, so the two rigs cannot read each
 * other's dock even if they were ever mounted on one page.
 */
import { useEffect } from "react";
import { useChatDock, type ChatCardContext } from "@/state/ChatDockProvider";

export function ChatDockProbe({ channel }: { channel: string }) {
  const { open, contextCard, setContextCard } = useChatDock();

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w[`${channel}Dock`] = { open, contextCard };
    w[`${channel}SetContext`] = (card: ChatCardContext | null) =>
      setContextCard(card);
  }, [channel, open, contextCard, setContextCard]);

  return null;
}
