"use client";

import { MessageSquare } from "lucide-react";
import { useChatbar } from "./ChatbarProvider";

/**
 * Edge restore control when the chatbar is collapsed.
 * Sits on the same side as the dock (right or left of the content).
 */
export function ChatbarCollapsedTab() {
  const { isOpen, open, isLeft } = useChatbar();
  if (isOpen) return null;

  return (
    <button
      type="button"
      className={`chatbar-collapsed-tab chatbar-collapsed-tab--${isLeft ? "left" : "right"}`}
      onClick={open}
      title="Open Hermes chat (Alt+H)"
      aria-label="Open Hermes chat"
    >
      <MessageSquare className="chatbar-collapsed-tab__icon" aria-hidden />
      <span className="chatbar-collapsed-tab__label">
        <span>Ask</span>
        <span>Hermes</span>
      </span>
    </button>
  );
}
