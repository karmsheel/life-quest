import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  History,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import { api } from "@/lib/ipc";
import { summarizeToolRun, toolRowLabel, type ToolCall } from "@/lib/tool-run";
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

/** The composer may eat at most half the panel before it scrolls in place. */
const COMPOSER_MAX_PANEL_RATIO = 0.5;
/** Floor for that cap so a very short panel still shows a usable field. */
const COMPOSER_MIN_VISIBLE_PX = 72;

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
  /**
   * Which of the dock's two surfaces is up. The list is a real page now — with
   * twenty chats an 11rem strip was not navigable — and a thread replaces it
   * once a chat is opened.
   */
  const [view, setView] = useState<"list" | "thread">("thread");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /** Drives the inline control: the arrow needs text, the stop square needs a run. */
  const sendable = draft.trim().length > 0;
  const controlVisible = sending || sendable;
  const [approval, setApproval] = useState<{
    runId: string;
    requestId: string;
    summary: string;
  } | null>(null);
  /** Run id of the live turn, learned from `run.started`; the stop needs it. */
  const [runId, setRunId] = useState<string | null>(null);
  /**
   * How the last turn ended, when it did not end cleanly. `Thinking…` and the
   * synthetic `tool:` rows are already live-only turn evidence; this sits in the
   * same family — LifeQuest stores no chat history, so it is not persisted and
   * does not claim to be.
   */
  const [turnNote, setTurnNote] = useState<string | null>(null);
  /**
   * This turn's tool calls, in the order the wire reported them. They are a
   * live turn's in-flight evidence and deliberately NOT messages: a reloaded
   * transcript has no tool rows (the store's own are never read back), so
   * pushing them into `messages` made Hermes look like it had said "tool:
   * read_file" and buried the conversation under one bubble per event.
   *
   * They collapse to a single grey line — see `lib/tool-run.ts`.
   */
  const [tools, setTools] = useState<ToolCall[]>([]);
  /** Whether that line is opened to show the calls it stands for. */
  const [toolsOpen, setToolsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const assistantId = useRef<string | null>(null);
  /** Bottom for the composer: the box height it rests at with an empty draft. */
  const restingHeightRef = useRef(0);

  /** The open chat's row, when it is still listed (an archived one is not). */
  const activeSession = sessions.find((s) => s.id === sessionId) ?? null;
  const activeLabel = activeSession ? sessionLabel(activeSession) : "Chat";
  const pinnedSessions = sessions.filter((s) => s.pinned);
  const recentSessions = sessions.filter((s) => !s.pinned);

  /**
   * Grow the composer with its text, then scroll inside it once it reaches half
   * the panel. Sizing is read back off the DOM (not `draft`) so the same
   * callback can serve the per-keystroke pass and the panel ResizeObserver
   * without re-binding on every character.
   *
   * The field is never shorter than the shape it rests at (the `rows`
   * attribute), so an empty or one-line draft keeps the composer's original
   * footprint — growth starts on the line that actually outgrows it.
   */
  const syncComposerHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Drop the inline height first: a clamped field reports the clamp through
    // scrollHeight, so the content height is only readable with the override
    // gone. Clearing overflow too means the box measured below carries no
    // scrollbar.
    el.style.height = "";
    el.style.overflowY = "";
    const resting = el.offsetHeight;
    if (resting > 0) restingHeightRef.current = resting;
    const baseline = restingHeightRef.current;
    const borderY = el.offsetHeight - el.clientHeight;
    const content = el.scrollHeight + borderY;
    if (content <= baseline) return;
    const panel = panelRef.current;
    const cap = panel
      ? Math.max(panel.clientHeight * COMPOSER_MAX_PANEL_RATIO, COMPOSER_MIN_VISIBLE_PX)
      : content;
    const height = Math.min(content, cap);
    el.style.height = `${height}px`;
    el.style.overflowY = content > height ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncComposerHeight();
  }, [draft, open, view, syncComposerHeight]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    // The panel is a stretched grid cell, so window resizes change the cap
    // without touching the draft. Re-clamp from the observer, not a listener.
    const observer = new ResizeObserver(() => syncComposerHeight());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, syncComposerHeight]);

  const loadSession = useCallback(async (id: string) => {
    const result = await api().companionSessionMessages(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSessionId(id);
    window.localStorage.setItem(LAST_SESSION_KEY, id);
    // Everything below describes the turn running in the chat being left
    // behind, so it goes with it.
    setTools([]);
    setToolsOpen(false);
    setTurnNote(null);
    setApproval(null);
    setRunId(null);
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

  /** Refresh the list and hand it back, so a caller can pick a row off it. */
  const loadSessions = useCallback(async (): Promise<HermesSession[] | null> => {
    const listed = await api().companionSessionsList();
    if (!listed.ok) {
      setError(listed.error);
      return null;
    }
    setSessionsLoaded(true);
    setSessions(listed.value);
    return listed.value;
  }, []);

  /** Open one chat: the thread takes the panel over from the list. */
  const openSession = useCallback(
    async (id: string) => {
      setView("thread");
      await loadSession(id);
    },
    [loadSession],
  );

  /**
   * Landing behaviour: resume the chat this dock opened last, else the most
   * recent one, else show the list. Never mints a session — an empty chat made
   * on every open is how the list filled up with "New chat" rows.
   */
  useEffect(() => {
    if (!open) return;
    if (requestedSessionId) return;
    let cancelled = false;
    void (async () => {
      const listed = await loadSessions();
      if (cancelled || !listed) return;
      const stored = window.localStorage.getItem(LAST_SESSION_KEY);
      const resume = listed.find((s) => s.id === stored) ?? listed[0] ?? null;
      if (resume) {
        await openSession(resume.id);
        return;
      }
      setView("list");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadSessions, openSession, requestedSessionId]);

  useEffect(() => {
    if (!open || view !== "thread" || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, view, messages, sending, error, turnNote, tools]);

  useEffect(() => {
    if (open && view === "thread") inputRef.current?.focus();
  }, [open, view]);

  useEffect(() => {
    return api().onCompanionStream((evt: ChatStreamEvent) => {
      if (evt.type === "run.started") {
        // First frame of every turn: this is the id `stop` has to name.
        setRunId(evt.runId || null);
        return;
      }
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
        setTools((prev) => [
          ...prev,
          { id: nextId(), name: evt.name, target: evt.target, done: false },
        ]);
        return;
      }
      if (evt.type === "tool.completed") {
        // Oldest first, by name: the frame names the call it ends and carries
        // nothing else, so a run that called the same tool twice resolves in
        // the order it started.
        setTools((prev) => {
          const idx = prev.findIndex((call) => !call.done && call.name === evt.name);
          if (idx === -1) return prev;
          const copy = prev.slice();
          copy[idx] = { ...copy[idx]!, done: true };
          return copy;
        });
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
      if (evt.type === "run.stopped") {
        setTurnNote(
          "Stopped — the reply above is only what arrived before the interrupt",
        );
        return;
      }
      if (evt.type === "run.incomplete") {
        setTurnNote(
          evt.reason
            ? `Ended before finishing — ${evt.reason}`
            : "Ended before finishing",
        );
        return;
      }
      if (evt.type === "error") {
        setError(evt.message);
        return;
      }
      if (evt.type === "run.completed") {
        setRunId(null);
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
    // A new turn's run id arrives with its own `run.started`; never carry the
    // previous turn's id — or its outcome note — into this one.
    setRunId(null);
    setTurnNote(null);
    setTools([]);
    setToolsOpen(false);

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
      const listed = await loadSessions();
      if (cancelled) return;
      if (listed) setSessionsLoaded(true);
      await openSession(targetId);
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

  /**
   * Interrupt the live turn. The gateway stops the run cooperatively and the
   * stream closes on its own, which is what clears `sending` — nothing here
   * pretends the turn ended locally.
   */
  async function stopRun() {
    if (!runId) return;
    const result = await api().companionRunStop(runId);
    if (!result.ok) setError(result.error);
  }

  /**
   * Rename, pin or archive one chat. All three are durable Hermes-side flags:
   * the write goes back to the gateway, so Hermes Desktop and every other
   * channel on this profile see the same state.
   *
   * The row is patched from the patch itself, never from the reply. The reply
   * carries the raw session row, which has no `preview` and no `last_active`
   * (the list query computes those), so merging it would blank the row's name
   * fallback and its timestamp.
   */
  async function patchSession(
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ): Promise<boolean> {
    const result = await api().companionSessionPatch(id, patch);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setSessions((prev) =>
      prev
        .map((s) =>
          s.id === id
            ? {
                ...s,
                title: typeof patch.title === "string" ? patch.title : s.title,
                pinned: typeof patch.pinned === "boolean" ? patch.pinned : s.pinned,
              }
            : s,
        )
        // An archived chat leaves this list. Hermes keeps every message, and
        // Hermes Desktop is where it can be unarchived.
        .filter((s) => !(patch.archived === true && s.id === id)),
    );
    if (patch.archived === true && id === sessionId) setView("list");
    return true;
  }

  async function togglePin() {
    if (!activeSession) return;
    await patchSession(activeSession.id, { pinned: !activeSession.pinned });
  }

  async function archiveActive() {
    if (!sessionId) return;
    await patchSession(sessionId, { archived: true });
  }

  function startRename() {
    if (!activeSession) return;
    setRenameDraft(sessionLabel(activeSession));
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameDraft("");
  }

  async function commitRename(e: FormEvent) {
    e.preventDefault();
    const id = sessionId;
    if (!id) return;
    const title = renameDraft.trim();
    setRenaming(false);
    setRenameDraft("");
    await patchSession(id, { title });
  }

  async function newSession() {
    // A chat that was created and never written in is already a "New chat"
    // row: an empty transcript, no preview. Clicking the slot again is
    // navigation to it, not a second empty chat — that is what kept the
    // list filling with identical "New chat" rows.
    const listed = await loadSessions();
    const blank = listed?.find((s) => !s.preview?.trim());
    if (blank) {
      await openSession(blank.id);
      return;
    }

    const created = await api().companionSessionCreate("");
    if (!created.ok) {
      setError(created.error);
      return;
    }
    setSessions((prev) => [created.value, ...prev.filter((s) => s.id !== created.value.id)]);
    await openSession(created.value.id);
  }

  /** One chat row. Clicking the open chat comes back to its thread. */
  function sessionRow(s: HermesSession) {
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
            if (s.id === sessionId) setView("thread");
            else void openSession(s.id);
          }}
        >
          {s.pinned ? (
            <span className="chat-panel__session-pin" title="Pinned">
              <Pin size={12} aria-hidden />
            </span>
          ) : null}
          <span className="chat-panel__session-label">{label}</span>
          {when ? (
            <time className="chat-panel__session-when" dateTime={sessionTimeValue(s.lastActive)}>
              {when}
            </time>
          ) : null}
        </button>
      </li>
    );
  }

  const errorBanner = error ? (
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
  ) : null;

  return (
    <aside
      ref={panelRef}
      className={[
        "chat-panel",
        open ? "chat-panel--open" : "chat-panel--collapsed",
      ].join(" ")}
      role="complementary"
      aria-label="Hermes chat"
    >
      {open ? (
        <div className="chat-panel__open">
          {view === "list" ? (
            <>
              <div className="chat-panel__header">
                <p className="chat-panel__heading">Chats</p>
              </div>
              <div className="chat-panel__list">
                {errorBanner}
                {sessionsLoaded && sessions.length === 0 ? (
                  <p className="chat-panel__sessions-empty">No chats yet</p>
                ) : (
                  <ul
                    className="chat-panel__sessions chat-panel__sessions--full"
                    aria-label="Previous chats"
                  >
                    {pinnedSessions.length > 0 ? (
                      <>
                        <li className="chat-panel__sessions-group">Pinned</li>
                        {pinnedSessions.map(sessionRow)}
                      </>
                    ) : null}
                    {recentSessions.length > 0 ? (
                      <>
                        {pinnedSessions.length > 0 ? (
                          <li className="chat-panel__sessions-group">Recent</li>
                        ) : null}
                        {recentSessions.map(sessionRow)}
                      </>
                    ) : null}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="chat-panel__header chat-panel__header--thread">
              <button
                type="button"
                className="chat-panel__icon-btn"
                aria-label="All chats"
                title="All chats"
                onClick={() => setView("list")}
              >
                <ArrowLeft size={16} aria-hidden />
              </button>
              {renaming ? (
                <form
                  className="chat-panel__rename"
                  onSubmit={(e) => void commitRename(e)}
                >
                  <input
                    className="chat-panel__rename-input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    aria-label="Chat name"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="chat-panel__icon-btn"
                    aria-label="Save name"
                    title="Save name"
                  >
                    <Check size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="chat-panel__icon-btn"
                    aria-label="Cancel rename"
                    title="Cancel rename"
                    onClick={cancelRename}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </form>
              ) : (
                <>
                  <p
                    className="chat-panel__heading chat-panel__heading--thread"
                    title={activeLabel}
                  >
                    {activeLabel}
                  </p>
                  <div className="chat-panel__header-actions">
                    <button
                      type="button"
                      className="chat-panel__icon-btn"
                      aria-label={activeSession?.pinned ? "Unpin chat" : "Pin chat"}
                      title={activeSession?.pinned ? "Unpin chat" : "Pin chat"}
                      onClick={() => void togglePin()}
                    >
                      {activeSession?.pinned ? (
                        <PinOff size={16} aria-hidden />
                      ) : (
                        <Pin size={16} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="chat-panel__icon-btn"
                      aria-label="Rename chat"
                      title="Rename chat"
                      onClick={startRename}
                    >
                      <Pencil size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="chat-panel__icon-btn"
                      aria-label="Archive chat"
                      title="Archive chat"
                      onClick={() => void archiveActive()}
                    >
                      <Archive size={16} aria-hidden />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="chat-panel__body" ref={listRef} hidden={view !== "thread"}>
            {errorBanner}

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
                {sending && tools.length === 0 ? (
                  <div className="chat-panel__message chat-panel__message--assistant">
                    <span className="chat-panel__message-role">Hermes</span>
                    <div className="chat-panel__message-content">
                      <span className="chat-panel__thinking muted">
                        Thinking…
                      </span>
                    </div>
                  </div>
                ) : null}
                {tools.length > 0 ? (
                  <div className="chat-panel__activity">
                    {tools.length > 1 ? (
                      <button
                        type="button"
                        className="chat-panel__activity-line"
                        aria-expanded={toolsOpen}
                        onClick={() => setToolsOpen((wasOpen) => !wasOpen)}
                      >
                        <ChevronRight
                          size={12}
                          aria-hidden
                          className={toolsOpen ? "chat-panel__activity-caret chat-panel__activity-caret--open" : "chat-panel__activity-caret"}
                        />
                        <span>{summarizeToolRun(tools, sending)}</span>
                      </button>
                    ) : (
                      <p className="chat-panel__activity-line">
                        {summarizeToolRun(tools, sending)}
                      </p>
                    )}
                    {tools.length > 1 && toolsOpen ? (
                      <ul className="chat-panel__activity-list">
                        {tools.map((call) => (
                          <li key={call.id} className="chat-panel__activity-row">
                            {toolRowLabel(call)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {turnNote ? (
                  <p className="chat-panel__turn-note" role="status">
                    {turnNote}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="chat-panel__footer" hidden={view !== "thread"}>
            <form className="chat-panel__composer" onSubmit={(e) => void onSubmit(e)}>
              <div
                className={
                  controlVisible
                    ? "chat-panel__composer-row chat-panel__composer-row--control"
                    : "chat-panel__composer-row"
                }
              >
                <textarea
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
                {controlVisible ? (
                  <button
                    type={sending ? "button" : "submit"}
                    className="chat-panel__send"
                    data-state={sending ? "stop" : "send"}
                    disabled={sending ? !runId : !sessionId}
                    aria-label={sending ? "Stop this run" : "Send message"}
                    title={sending ? "Stop this run" : "Send message"}
                    onClick={sending ? () => void stopRun() : undefined}
                  >
                    {sending ? (
                      <span className="chat-panel__send-stop" aria-hidden />
                    ) : (
                      <ArrowUp size={15} aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {/*
            The dock's own actions, pinned to the bottom of the bar and shared by
            both views: the list is where most navigation happens, so its entry
            point cannot live inside the thread it replaces. The last two are
            reserved — disabled rather than absent, so the row is the shape it
            will end up as.
          */}
          <nav className="chat-panel__actions" aria-label="Chat actions">
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Chat history"
              title="Chat history"
              aria-pressed={view === "list"}
              onClick={() => setView(view === "list" ? "thread" : "list")}
            >
              <History size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="New chat"
              title="New chat"
              disabled={sending}
              onClick={() => void newSession()}
            >
              <SquarePen size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Search chats (coming soon)"
              title="Search chats — coming soon"
              disabled
            >
              <Search size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="More chat actions (coming soon)"
              title="More chat actions — coming soon"
              disabled
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
          </nav>
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
