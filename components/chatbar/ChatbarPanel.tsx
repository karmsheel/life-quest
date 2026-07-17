"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { useChatbar } from "./ChatbarProvider";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * Global Hermes chatbar: collapsed tab + expanded message list / composer.
 * Context chip shows active Domain **name** only (no document injection).
 */
export function ChatbarPanel() {
  const {
    open,
    toggle,
    setOpen,
    messages,
    sending,
    error,
    clearError,
    clearMessages,
    sendMessage,
  } = useChatbar();
  const { activeDomain } = useShell();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to latest message when open / messages change.
  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages, sending, error]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  }

  const domainChip = activeDomain ? (
    <span className="chatbar__domain muted" title="Active domain context">
      · {activeDomain.name}
    </span>
  ) : null;

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
          <span>Chat</span>
          {domainChip}
          {messages.length > 0 ? (
            <span className="chatbar__badge muted">{messages.length}</span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div
      className="chatbar chatbar--open"
      role="complementary"
      aria-label="Hermes chat"
    >
      <div className="chatbar__header">
        <div className="chatbar__title">
          <MessageSquare size={16} aria-hidden />
          <span>Hermes</span>
          {domainChip}
        </div>
        <div className="chatbar__header-actions">
          {messages.length > 0 ? (
            <button
              type="button"
              className="chatbar__text-btn"
              onClick={clearMessages}
              disabled={sending}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="chatbar__icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="chatbar__body" ref={listRef}>
        {error ? (
          <div className="chatbar__error" role="alert">
            <p>{error}</p>
            <div className="chatbar__error-actions">
              <Link href="/settings" className="chatbar__link">
                Open Settings
              </Link>
              <button
                type="button"
                className="chatbar__text-btn"
                onClick={clearError}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {messages.length === 0 && !sending ? (
          <p className="muted chatbar__placeholder">
            Send a message to your Hermes gateway. Active domain name is shown
            as context only — documents are not injected.
          </p>
        ) : (
          <ul className="chatbar__messages" aria-live="polite">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`chatbar__msg chatbar__msg--${m.role}`}
              >
                <span className="chatbar__msg-role">
                  {m.role === "user" ? "You" : "Hermes"}
                </span>
                <div className="chatbar__msg-content">{m.content}</div>
              </li>
            ))}
            {sending ? (
              <li className="chatbar__msg chatbar__msg--assistant chatbar__msg--pending">
                <span className="chatbar__msg-role">Hermes</span>
                <div className="chatbar__msg-content muted">Thinking…</div>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <form className="chatbar__composer" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chatbar__input"
          placeholder="Message Hermes…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
          aria-label="Message Hermes"
          autoComplete="off"
        />
        <button
          type="submit"
          className="chatbar__send"
          disabled={sending || !draft.trim()}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
