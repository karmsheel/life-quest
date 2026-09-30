import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import { PanelRightOpen } from "lucide-react";
import { api } from "@/lib/ipc";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { useChatDock } from "@/state/ChatDockProvider";
import { useVault } from "@/state/VaultProvider";
import type { ChatStreamEvent, HermesSession } from "@/vite-env";
import {
  formatSessionWhen,
  sessionLabel,
} from "../../../electron/companion-client.ts";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const LAST_SESSION_KEY = "lifequest.companion.lastSessionId";

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionTimeValue(lastActive: number | null): string | undefined {
  if (lastActive == null || !Number.isFinite(lastActive)) return undefined;
  const date = new Date(lastActive * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function ChatPanel({ open, onOpenChange }: ChatPanelProps) {
  const activeDomain = useActiveDomain();
  const domainName = activeDomain?.meta.name ?? "Overview";
  const { snapshot, refresh } = useVault();
  const {
    requestedSessionId,
    requestedKickoff,
    clearRequestedSession,
  } = useChatDock();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<{
    runId: string;
    requestId: string;
    summary: string;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const assistantId = useRef<string | null>(null);
  const inputId = useId();

  const loadSession = useCallback(async (id: string) => {
    const result = await api().companionSessionMessages(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSessionId(id);
    window.localStorage.setItem(LAST_SESSION_KEY, id);
    setMessages(
      result.value.map((m) => ({
        id: nextId(),
        role: m.role,
        content: m.content,
      })),
    );
    const firstUser = result.value.find((m) => m.role === "user" && m.content.trim());
    if (firstUser) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id && !s.preview?.trim() ? { ...s, preview: firstUser.content } : s,
        ),
      );
    }
  }, []);

  const ensureSession = useCallback(async () => {
    const listed = await api().companionSessionsList();
    if (!listed.ok) {
      setError(listed.error);
      return;
    }
    setSessionsLoaded(true);
    setSessions(listed.value);
    const stored = window.localStorage.getItem(LAST_SESSION_KEY);
    const existing =
      listed.value.find((s) => s.id === stored) ?? listed.value[0] ?? null;
    if (existing) {
      await loadSession(existing.id);
      return;
    }
    const created = await api().companionSessionCreate("");
    if (!created.ok) {
      setError(created.error);
      return;
    }
    setSessions((prev) => [created.value, ...prev.filter((s) => s.id !== created.value.id)]);
    await loadSession(created.value.id);
  }, [loadSession]);

  useEffect(() => {
    if (!open) return;
    if (requestedSessionId) return;
    void ensureSession();
  }, [open, ensureSession, requestedSessionId]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages, sending, error]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    return api().onCompanionStream((evt: ChatStreamEvent) => {
      if (evt.type === "assistant.delta") {
        const id = assistantId.current ?? nextId();
        assistantId.current = id;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === id);
          if (idx === -1) {
            return [...prev, { id, role: "assistant", content: evt.text }];
          }
          const copy = prev.slice();
          const cur = copy[idx]!;
          copy[idx] = { ...cur, content: cur.content + evt.text };
          return copy;
        });
        return;
      }
      if (evt.type === "tool.started") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: `tool: ${evt.name}`,
          },
        ]);
        return;
      }
      if (evt.type === "tool.completed") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: evt.ok ? `tool done: ${evt.name}` : `tool failed: ${evt.name}`,
          },
        ]);
        return;
      }
      if (evt.type === "approval.request") {
        setApproval({
          runId: evt.runId,
          requestId: evt.requestId,
          summary: evt.summary,
        });
        return;
      }
      if (evt.type === "error") {
        setError(evt.message);
        return;
      }
      if (evt.type === "run.completed") {
        void refresh();
      }
    });
  }, [refresh]);

  async function sendMessage(text: string, overrideSessionId?: string) {
    const content = text.trim();
    const activeId = overrideSessionId ?? sessionId;
    if (!content || sending || !activeId) return;

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content },
    ]);
    setSessions((prev) =>
      prev
        .map((s) => {
          if (s.id !== activeId) return s;
          return {
            ...s,
            preview: s.preview?.trim() ? s.preview : content,
            lastActive: Date.now() / 1000,
          };
        })
        .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
    );
    setSending(true);
    setError(null);
    assistantId.current = null;

    try {
      const result = await api().companionChatStream({
        sessionId: activeId,
        input: content,
        instructionsContext: {
          domainName: activeDomain?.meta.name ?? null,
          domainSlug: activeDomain?.slug ?? null,
          aboutMe: snapshot?.map?.aboutMe ?? "",
          locked: false,
          vaultOpen: Boolean(snapshot),
        },
      });
      if ("ok" in result && result.ok === false) {
        setError(result.error);
      }
      void refresh();
      const listed = await api().companionSessionsList();
      if (listed.ok) setSessions(listed.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach Hermes");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!requestedSessionId) return;
    let cancelled = false;
    const targetId = requestedSessionId;
    const kickoff = requestedKickoff;
    (async () => {
      onOpenChange(true);
      const listed = await api().companionSessionsList();
      if (cancelled) return;
      if (listed.ok) {
        setSessionsLoaded(true);
        setSessions(listed.value);
      }
      await loadSession(targetId);
      if (cancelled) return;
      clearRequestedSession();
      if (kickoff?.trim()) {
        await sendMessage(kickoff, targetId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Kickoff/send intentionally tied to the request id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId]);

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

  async function newSession() {
    const created = await api().companionSessionCreate("");
    if (!created.ok) {
      setError(created.error);
      return;
    }
    setSessions((prev) => [created.value, ...prev.filter((s) => s.id !== created.value.id)]);
    setMessages([]);
    await loadSession(created.value.id);
  }

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
            <p className="chat-panel__heading">Chats</p>
            <button
              type="button"
              className="chat-panel__text-btn"
              onClick={() => void newSession()}
              disabled={sending}
            >
              New
            </button>
          </div>
          {sessionsLoaded && sessions.length === 0 ? (
            <p className="chat-panel__sessions-empty">No chats yet</p>
          ) : sessions.length > 0 ? (
            <ul className="chat-panel__sessions" aria-label="Previous chats">
              {sessions.map((s) => {
                const label = sessionLabel(s);
                const when = formatSessionWhen(s.lastActive);
                const active = s.id === sessionId;
                return (
                  <li key={s.id} className="chat-panel__session-item">
                    <button
                      type="button"
                      className={
                        active
                          ? "chat-panel__session chat-panel__session--active"
                          : "chat-panel__session"
                      }
                      aria-current={active ? "true" : undefined}
                      disabled={sending}
                      title={label}
                      onClick={() => {
                        if (s.id !== sessionId) void loadSession(s.id);
                      }}
                    >
                      <span className="chat-panel__session-label">{label}</span>
                      {when ? (
                        <time className="chat-panel__session-when" dateTime={sessionTimeValue(s.lastActive)}>
                          {when}
                        </time>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

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

            {approval ? (
              <div className="chat-panel__error" role="alertdialog">
                <p>{approval.summary}</p>
                <div className="chat-panel__error-actions">
                  <button
                    type="button"
                    className="chat-panel__text-btn"
                    onClick={() => {
                      void api().companionApproval({
                        runId: approval.runId,
                        requestId: approval.requestId,
                        allow: true,
                      });
                      setApproval(null);
                    }}
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    className="chat-panel__text-btn"
                    onClick={() => {
                      void api().companionApproval({
                        runId: approval.runId,
                        requestId: approval.requestId,
                        allow: false,
                      });
                      setApproval(null);
                    }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ) : null}

            {messages.length === 0 && !sending ? (
              <div className="chat-panel__empty">
                <div className="chat-panel__empty-orb" aria-hidden />
                <p className="chat-panel__empty-title">Ask Hermes</p>
                <p className="chat-panel__empty-copy">
                  This is your LifeQuest companion on the lifequest Hermes
                  profile. Active domain: {domainName}.
                </p>
                <Link to="/settings" className="chat-panel__link chat-panel__cta">
                  Companion status
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
                  disabled={sending || !sessionId}
                  rows={2}
                  aria-label="Message Hermes"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="chat-panel__send"
                  disabled={sending || !draft.trim() || !sessionId}
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
