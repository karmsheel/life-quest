"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeftRight,
  MessageSquare,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import { useHermesConnection } from "@/components/hermes/HermesConnectionProvider";
import { useShell } from "@/components/shell/ShellProvider";
import { ChatMarkdown } from "@/components/ui/ChatMarkdown";
import { useChatbar } from "./ChatbarProvider";

/**
 * Global Hermes chat dock — adapted Forge panel (no workshop/process/studio).
 */
export function ChatbarPanel() {
  const {
    isOpen,
    collapse,
    isLeft,
    side,
    swapSide,
    messages,
    sending,
    error,
    clearError,
    clearMessages,
    sendMessage,
  } = useChatbar();
  const { activeDomain } = useShell();
  const hermes = useHermesConnection();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [isOpen, messages, sending, error]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sending || !draft.trim()) return;
      const text = draft.trim();
      setDraft("");
      void sendMessage(text);
    }
  }

  const connected = hermes.isConnected;
  const busy =
    hermes.status.state === "discovering" || hermes.status.state === "testing";
  const pillClass = connected
    ? "chatbar-panel__pill chatbar-panel__pill--ok"
    : hermes.status.state === "error"
      ? "chatbar-panel__pill chatbar-panel__pill--error"
      : "chatbar-panel__pill chatbar-panel__pill--warn";
  const pillLabel = connected
    ? "Connected"
    : hermes.status.state === "error"
      ? "Error"
      : busy
        ? "Connecting"
        : "Offline";

  const CollapseIcon = isLeft ? PanelLeftClose : PanelRightClose;

  return (
    <aside
      className={[
        "chatbar-panel",
        `chatbar-panel--side-${side}`,
        isOpen ? "is-open" : "is-collapsed",
      ].join(" ")}
      role="complementary"
      aria-label="Hermes chat"
      aria-hidden={!isOpen}
    >
      <div className="chatbar-panel__header">
        <div className="chatbar-panel__brand">
          <MessageSquare className="chatbar-panel__brand-icon" aria-hidden />
          <div className="chatbar-panel__brand-copy">
            <p className="chatbar-panel__eyebrow">Agent</p>
            <span className="chatbar-panel__title">Hermes</span>
          </div>
          {activeDomain ? (
            <span
              className="chatbar-panel__domain-chip"
              title="Active domain context"
            >
              {activeDomain.name}
            </span>
          ) : null}
        </div>
        <div className="chatbar-panel__header-actions">
          <span className={pillClass} title={hermes.status.error ?? pillLabel}>
            {pillLabel}
          </span>
          {messages.length > 0 ? (
            <button
              type="button"
              className="chatbar-panel__text-btn"
              onClick={clearMessages}
              disabled={sending}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="chatbar-panel__icon-btn"
            onClick={swapSide}
            aria-label={isLeft ? "Move chat to right" : "Move chat to left"}
            title="Swap side"
          >
            <ArrowLeftRight size={14} />
          </button>
          <button
            type="button"
            className="chatbar-panel__icon-btn chatbar-panel__collapse-btn"
            onClick={collapse}
            aria-label="Collapse chat"
            title="Collapse"
          >
            <CollapseIcon size={14} />
          </button>
        </div>
      </div>

      <div className="chatbar-panel__body" ref={listRef}>
        {error ? (
          <div className="chatbar-panel__error" role="alert">
            <p>{error}</p>
            <div className="chatbar-panel__error-actions">
              <Link href="/settings" className="chatbar-panel__link">
                Open Settings
              </Link>
              <button
                type="button"
                className="chatbar-panel__text-btn"
                onClick={clearError}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {!connected && messages.length === 0 && !sending ? (
          <div className="chatbar-panel__empty">
            <div className="chatbar-panel__empty-orb" aria-hidden />
            <p className="chatbar-panel__empty-title">Hermes is offline</p>
            <p className="chatbar-panel__empty-copy">
              Connect from the home screen or Settings before chatting.
            </p>
            <Link href="/settings" className="chatbar-panel__cta chatbar-panel__link">
              Open Settings
            </Link>
          </div>
        ) : messages.length === 0 && !sending ? (
          <div className="chatbar-panel__empty">
            <div className="chatbar-panel__empty-orb" aria-hidden />
            <p className="chatbar-panel__empty-title">Ask Hermes</p>
            <p className="chatbar-panel__empty-copy">
              Send a message to your Hermes gateway.
              {activeDomain
                ? ` Active domain: ${activeDomain.name} (name only — documents are not injected).`
                : " Active domain name is shown as context only."}
            </p>
          </div>
        ) : (
          <div className="chatbar-panel__messages" aria-live="polite">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`chatbar-panel__message chatbar-panel__message--${m.role}`}
              >
                <span className="chatbar-panel__message-role">
                  {m.role === "user" ? "You" : "Hermes"}
                </span>
                {m.role === "assistant" ? (
                  <div className="chatbar-panel__message-content chatbar-panel__message-content--md">
                    <ChatMarkdown markdown={m.content} />
                  </div>
                ) : (
                  <div className="chatbar-panel__message-content">{m.content}</div>
                )}
              </div>
            ))}
            {sending ? (
              <div className="chatbar-panel__message chatbar-panel__message--assistant">
                <span className="chatbar-panel__message-role">Hermes</span>
                <div className="chatbar-panel__message-content">
                  <span className="chatbar-panel__thinking muted">Thinking…</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="chatbar-panel__footer">
        <form className="chatbar-panel__composer-shell" onSubmit={onSubmit}>
          <label className="chatbar-panel__composer-label" htmlFor="chatbar-input">
            Message
          </label>
          <div className="chatbar-panel__composer-row">
            <textarea
              id="chatbar-input"
              ref={inputRef}
              className="chatbar-panel__composer-input chatbar-panel__composer-input--live"
              placeholder="Message Hermes…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
              rows={2}
              aria-label="Message Hermes"
              autoComplete="off"
            />
            <button
              type="submit"
              className="chatbar-panel__send"
              disabled={sending || !draft.trim()}
              aria-label="Send message"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
          <p className="chatbar-panel__composer-help">
            <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline
          </p>
        </form>
      </div>
    </aside>
  );
}
