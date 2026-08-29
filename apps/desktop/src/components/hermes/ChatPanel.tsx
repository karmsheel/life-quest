import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import { MessageSquare, PanelRightClose, PanelRightOpen } from "lucide-react";
import { api } from "@/lib/ipc";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { useVault } from "@/state/VaultProvider";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatPanel({ open, onOpenChange }: ChatPanelProps) {
  const activeDomain = useActiveDomain();
  const { refresh } = useVault();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages, sending, error]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || sending) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);
    setError(null);

    try {
      const payload = nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const result = await api().hermesChatTools(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Map mutations performed by the agent loop should surface in the UI.
      void refresh();
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: result.value.content,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach Hermes");
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending || !draft.trim()) return;
    const text = draft.trim();
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

  function clearMessages() {
    setMessages([]);
    setError(null);
  }

  // Expand control stays outside any aria-hidden region so it remains
  // keyboard/AT reachable when the panel is collapsed.
  return (
    <aside
      className={[
        "chat-panel",
        open ? "chat-panel--open" : "chat-panel--collapsed",
      ].join(" ")}
      role="complementary"
      aria-label="Hermes chat"
    >
      {open ? (
        <div className="chat-panel__open">
          <div className="chat-panel__header">
            <div className="chat-panel__brand">
              <MessageSquare className="chat-panel__brand-icon" aria-hidden size={16} />
              <div className="chat-panel__brand-copy">
                <p className="chat-panel__eyebrow">Agent</p>
                <span className="chat-panel__title">Hermes</span>
              </div>
              {activeDomain ? (
                <span
                  className="chat-panel__domain-chip"
                  title="Active domain context"
                >
                  {activeDomain.meta.name}
                </span>
              ) : null}
            </div>
            <div className="chat-panel__header-actions">
              {messages.length > 0 ? (
                <button
                  type="button"
                  className="chat-panel__text-btn"
                  onClick={clearMessages}
                  disabled={sending}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="chat-panel__icon-btn"
                onClick={() => onOpenChange(false)}
                aria-label="Collapse chat"
                title="Collapse"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
          </div>

          <div className="chat-panel__body" ref={listRef}>
            {error ? (
              <div className="chat-panel__error" role="alert">
                <p>{error}</p>
                <div className="chat-panel__error-actions">
                  <Link to="/settings" className="chat-panel__link">
                    Open Settings
                  </Link>
                  <button
                    type="button"
                    className="chat-panel__text-btn"
                    onClick={() => setError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            {messages.length === 0 && !sending ? (
              <div className="chat-panel__empty">
                <div className="chat-panel__empty-orb" aria-hidden />
                <p className="chat-panel__empty-title">Ask Hermes</p>
                <p className="chat-panel__empty-copy">
                  Send a message to your Hermes gateway.
                  {activeDomain
                    ? ` Active domain: ${activeDomain.meta.name}.`
                    : ""}
                </p>
                <Link to="/settings" className="chat-panel__link chat-panel__cta">
                  Configure in Settings
                </Link>
              </div>
            ) : (
              <div className="chat-panel__messages" aria-live="polite">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`chat-panel__message chat-panel__message--${m.role}`}
                  >
                    <span className="chat-panel__message-role">
                      {m.role === "user" ? "You" : "Hermes"}
                    </span>
                    <div className="chat-panel__message-content">{m.content}</div>
                  </div>
                ))}
                {sending ? (
                  <div className="chat-panel__message chat-panel__message--assistant">
                    <span className="chat-panel__message-role">Hermes</span>
                    <div className="chat-panel__message-content">
                      <span className="chat-panel__thinking muted">
                        Thinking…
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="chat-panel__footer">
            <form className="chat-panel__composer" onSubmit={(e) => void onSubmit(e)}>
              <label className="chat-panel__composer-label" htmlFor={inputId}>
                Message
              </label>
              <div className="chat-panel__composer-row">
                <textarea
                  id={inputId}
                  ref={inputRef}
                  className="chat-panel__composer-input"
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
                  className="chat-panel__send"
                  disabled={sending || !draft.trim()}
                  aria-label="Send message"
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
              <p className="chat-panel__composer-help">
                <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline
              </p>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="chat-panel__expand"
          onClick={() => onOpenChange(true)}
          aria-label="Open Hermes chat"
          title="Open Hermes chat"
        >
          <PanelRightOpen size={16} />
          <span>Chat</span>
        </button>
      )}
    </aside>
  );
}
