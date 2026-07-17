"use client";

import { MessageSquare, X } from "lucide-react";
import { useChatbar } from "./ChatbarProvider";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * Shell-only chatbar (Task 8). No network / Hermes wiring yet (Task 12).
 */
export function ChatbarPanel() {
  const { open, toggle, setOpen } = useChatbar();
  const { activeDomain } = useShell();

  if (!open) {
    return (
      <div className="chatbar chatbar--collapsed">
        <button
          type="button"
          className="chatbar__toggle"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Open Hermes chat"
        >
          <MessageSquare size={16} aria-hidden />
          <span>Hermes chat</span>
          {activeDomain ? (
            <span className="chatbar__domain muted">· {activeDomain.name}</span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="chatbar chatbar--open" role="complementary" aria-label="Hermes chat">
      <div className="chatbar__header">
        <div className="chatbar__title">
          <MessageSquare size={16} aria-hidden />
          <span>Hermes</span>
          {activeDomain ? (
            <span className="chatbar__domain muted">· {activeDomain.name}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="chatbar__icon-btn"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
        >
          <X size={16} />
        </button>
      </div>
      <div className="chatbar__body">
        <p className="muted chatbar__placeholder">
          Chat connects in a later task. Configure Hermes under Settings when ready.
        </p>
      </div>
      <div className="chatbar__composer">
        <input
          type="text"
          className="chatbar__input"
          placeholder="Message Hermes…"
          disabled
          aria-label="Message Hermes (coming soon)"
        />
        <button type="button" className="chatbar__send" disabled>
          Send
        </button>
      </div>
    </div>
  );
}
