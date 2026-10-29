import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/ipc";
import { AUTOMATIONS_CHANGED_EVENT } from "@/lib/automations";
import { readPageContext } from "@/lib/page-context";
import { useActiveDomain, useDashboardBoard } from "@/components/shell/useActiveDomain";
import { useChatDock, type ChatCardContext } from "@/state/ChatDockProvider";
import { useVault } from "@/state/VaultProvider";
import type {
  CompanionRuntimeOverride,
  CompanionStreamFrame,
  HermesSession,
} from "@/vite-env";
import type { FocusedCardContext } from "../../electron/companion-client.ts";
import type { ToolCall } from "@/lib/tool-run";

/**
 * One bubble in a chat.
 *
 * The id is the renderer's own: Hermes hands back a transcript on open and then
 * streams deltas with no message id of their own, so the dock mints one per
 * bubble and keeps appending to it.
 */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** When the message was sent or received, as epoch milliseconds. */
  at?: number;
  /** The receipt this turn carried, as the thread remembers it after sending. */
  receipt?: { name: string; size: number };
};

/** The receipt waiting in the composer for one chat's next turn. */
export type ChatReceipt = {
  relPath: string;
  name: string;
  size: number;
  previewUrl: string;
};

/** Everything one chat's turn is doing, kept per session so parallel runs stay apart. */
export type SessionRun = {
  messages: ChatMessage[];
  /** The transcript has been read once for this chat; a revisit keeps it. */
  messagesLoaded: boolean;
  sending: boolean;
  /** Run id of the live turn, learned from `run.started`; stop needs it. */
  runId: string | null;
  /** How the last turn ended, when it did not end cleanly. */
  turnNote: string | null;
  /** This turn's tool calls, in wire order; a live turn's evidence, not messages. */
  tools: ToolCall[];
  toolsOpen: boolean;
  approval: { runId: string; requestId: string; summary: string } | null;
  error: string | null;
};

/**
 * The dock's three surfaces. `list` is the all-chats page, `thread` the open
 * conversation, and `chain` the Life-Chain the same dock can show.
 */
export type ChatSurface = "list" | "thread" | "chain";

const EMPTY_RUN: SessionRun = Object.freeze({
  messages: [] as ChatMessage[],
  messagesLoaded: false,
  sending: false,
  runId: null,
  turnNote: null,
  tools: [] as ToolCall[],
  toolsOpen: false,
  approval: null,
  error: null,
});

/** The client-safe session fields the gateway's PATCH accepts. */
export type CompanionSessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

const LAST_SESSION_KEY = "lifequest.companion.lastSessionId";
const RUNTIME_PINS_KEY = "lifequest.companion.runtimePins";

/** A pin with anything that is not a usable string dropped. */
function cleanRuntimePick(value: unknown): CompanionRuntimeOverride {
  const source = (value ?? {}) as Record<string, unknown>;
  const pick: CompanionRuntimeOverride = {};
  for (const key of ["model", "provider", "reasoningEffort"] as const) {
    const entry = source[key];
    if (typeof entry === "string" && entry.trim()) pick[key] = entry.trim();
  }
  return pick;
}

function readStoredRuntimePins(): Record<string, CompanionRuntimeOverride> {
  try {
    const raw = window.localStorage.getItem(RUNTIME_PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pins: Record<string, CompanionRuntimeOverride> = {};
    for (const [sessionId, value] of Object.entries(parsed ?? {})) {
      if (!sessionId) continue;
      const pick = cleanRuntimePick(value);
      if (Object.keys(pick).length > 0) pins[sessionId] = pick;
    }
    return pins;
  } catch {
    return {};
  }
}

function writeStoredRuntimePins(pins: Record<string, CompanionRuntimeOverride>): void {
  try {
    window.localStorage.setItem(RUNTIME_PINS_KEY, JSON.stringify(pins));
  } catch {
    // A storage refusal costs the pins their memory, not the current chat.
  }
}

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The chats, their open tabs, and every live turn — one store for the whole app.
 *
 * The dock is not the only surface that needs a chat any more: the left
 * sidebar lists them and the tab strip names the ones in flight, and a run must
 * keep streaming while the operator looks at another thread, another page, or a
 * collapsed dock. So the state lives here, above both, and `ChatPanel` is one
 * view of it.
 *
 * Parallelism is the reason the map exists at all. A turn's deltas arrive on one
 * channel, tagged with the chat that owns them (see `CompanionStreamFrame`), and
 * are folded into that chat's run: the operator can type in one thread, switch
 * to another, and both keep arriving. Nothing here serialises the chats — the
 * gateway's own cap does that, and it is generous.
 */
type ChatSessionsContextValue = {
  sessions: HermesSession[];
  sessionsLoaded: boolean;
  /** A list-level failure, as opposed to a turn's own error. */
  listError: string | null;

  surface: ChatSurface;
  setSurface: (surface: ChatSurface) => void;

  activeId: string | null;
  /** The chats the operator has open, in the order the tabs were made. */
  openTabs: string[];
  activeSession: HermesSession | null;

  runOf: (id: string | null | undefined) => SessionRun;
  updateRun: (id: string, update: (run: SessionRun) => SessionRun) => void;

  draftOf: (id: string | null | undefined) => string;
  setDraftFor: (id: string, text: string) => void;
  receiptOf: (id: string | null | undefined) => ChatReceipt | null;
  setReceiptFor: (id: string, receipt: ChatReceipt | null) => void;

  runtimePins: Record<string, CompanionRuntimeOverride>;
  updateRuntimePick: (id: string, pick: CompanionRuntimeOverride) => void;

  /**
   * The sidebar's view option: when true the list also carries archived chats.
   * They are shown greyed and restorable, never openable, and the dock's own
   * working list stays live-only.
   */
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;

  loadSessions: () => Promise<HermesSession[] | null>;
  /** Navigate the active tab to a chat, the way a link navigates a browser tab. */
  openChat: (id: string) => Promise<void>;
  /** Give a chat a tab of its own, keeping the one in front. */
  openChatInNewTab: (id: string) => Promise<void>;
  resumeLast: () => Promise<void>;
  newChat: () => Promise<string | null>;
  closeTab: (id: string) => void;
  patchSession: (id: string, patch: CompanionSessionPatch) => Promise<boolean>;
  deleteChat: (id: string) => Promise<void>;
  sendMessage: (id: string, text: string) => Promise<void>;
  stopRun: (id: string) => Promise<void>;
  approve: (id: string, runId: string, requestId: string, allow: boolean) => void;
  dismissError: (id?: string | null) => void;
  /** A failure with no turn behind it: a list read, a receipt, the chain. */
  reportError: (message: string | null) => void;
  setErrorFor: (id: string, message: string | null) => void;
  setToolsOpen: (id: string, open: boolean) => void;
  setAutomationContext: (id: string, context: string) => void;
};

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(null);

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const { snapshot, refresh } = useVault();
  const activeDomain = useActiveDomain();
  const { slug: boardSlug, locked: boardLocked } = useDashboardBoard();
  const {
    requestedAutomationContext,
    contextCard,
    setLivePinId,
    pageContext,
  } = useChatDock();

  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [surface, setSurface] = useState<ChatSurface>("thread");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [runs, setRuns] = useState<Record<string, SessionRun>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, ChatReceipt | null>>({});
  const [runtimePins, setRuntimePins] = useState<Record<string, CompanionRuntimeOverride>>(
    () => readStoredRuntimePins(),
  );
  const [showArchived, setShowArchivedState] = useState(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const runtimePinsRef = useRef(runtimePins);
  runtimePinsRef.current = runtimePins;
  const showArchivedRef = useRef(showArchived);
  showArchivedRef.current = showArchived;
  const contextCardRef = useRef<ChatCardContext | null>(contextCard);
  contextCardRef.current = contextCard;
  /**
   * The assistant bubble each chat's live turn is writing into. A delta carries
   * no message id, so the first one mints the bubble and the rest append to it;
   * one id per chat is what keeps two parallel replies from sharing a bubble.
   */
  const assistantIds = useRef(new Map<string, string>());
  /** Chats whose tab was deliberately closed while their turn was still live. */
  const closedTabs = useRef(new Set<string>());
  /** The automation material each chat was opened with, carried by every turn. */
  const automationContexts = useRef(new Map<string, string>());
  const receiptPreviews = useRef(new Map<string, string>());
  const resuming = useRef(false);

  const runOf = useCallback(
    (id: string | null | undefined): SessionRun =>
      (id ? runs[id] : undefined) ?? EMPTY_RUN,
    [runs],
  );

  const updateRun = useCallback(
    (id: string, update: (run: SessionRun) => SessionRun) => {
      setRuns((prev) => {
        const current = prev[id] ?? EMPTY_RUN;
        const next = update(current);
        return next === current ? prev : { ...prev, [id]: next };
      });
    },
    [],
  );

  const draftOf = useCallback(
    (id: string | null | undefined) => (id ? drafts[id] ?? "" : ""),
    [drafts],
  );

  const setDraftFor = useCallback((id: string, text: string) => {
    setDrafts((prev) => (prev[id] === text ? prev : { ...prev, [id]: text }));
  }, []);

  const receiptOf = useCallback(
    (id: string | null | undefined) => (id ? receipts[id] ?? null : null),
    [receipts],
  );

  const setReceiptFor = useCallback((id: string, receipt: ChatReceipt | null) => {
    const previous = receiptPreviews.current.get(id) ?? null;
    if (previous && previous !== receipt?.previewUrl) {
      URL.revokeObjectURL(previous);
      receiptPreviews.current.delete(id);
    }
    if (receipt?.previewUrl) receiptPreviews.current.set(id, receipt.previewUrl);
    setReceipts((prev) => {
      if ((prev[id] ?? null) === receipt) return prev;
      return { ...prev, [id]: receipt };
    });
  }, []);

  const updateRuntimePick = useCallback(
    (id: string, next: CompanionRuntimeOverride) => {
      const pick = cleanRuntimePick(next);
      setRuntimePins((prev) => {
        const pins = { ...prev };
        if (Object.keys(pick).length > 0) pins[id] = pick;
        else delete pins[id];
        writeStoredRuntimePins(pins);
        return pins;
      });
    },
    [],
  );

  const loadSessions = useCallback(async (): Promise<HermesSession[] | null> => {
    const listed = await api().companionSessionsList({
      includeArchived: showArchivedRef.current,
    });
    if (!listed.ok) {
      setListError(listed.error);
      return null;
    }
    setSessionsLoaded(true);
    setListError(null);
    setSessions(listed.value);
    return listed.value;
  }, []);

  /**
   * Turn the sidebar's archived view on or off. The list is re-read rather than
   * filtered from what is held: whether archived rows exist at all is the
   * gateway's answer, and the read also refreshes the live rows beside them.
   */
  const setShowArchived = useCallback(
    (show: boolean) => {
      if (show === showArchivedRef.current) return;
      showArchivedRef.current = show;
      setShowArchivedState(show);
      void loadSessions();
    },
    [loadSessions],
  );

  /** Put a chat in the tab strip without moving the operator's focus. */
  const ensureTab = useCallback((id: string) => {
    if (closedTabs.current.has(id)) return;
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  /**
   * Read one chat's transcript. The gateway is the store of record — LifeQuest
   * keeps no copy — so opening a chat reads it again, which is also how a chat
   * edited in Hermes Desktop shows up here. A live turn is the one case that
   * must not be replaced: its bubbles are arriving, not yet written down.
   */
  const loadMessages = useCallback(
    async (id: string) => {
      const run = runs[id] ?? EMPTY_RUN;
      if (run.sending) return;
      const result = await api().companionSessionMessages(id);
      if (!result.ok) {
        updateRun(id, (current) => ({ ...current, error: result.error }));
        return;
      }
      updateRun(id, (current) => {
        // A turn may have begun while the transcript was in flight; replacing
        // its bubbles with the stored page would drop what is already streaming.
        if (current.sending) return current;
        return {
          ...current,
          messagesLoaded: true,
          messages: result.value.map((m) => ({
            id: nextId(),
            role: m.role,
            content: m.content,
            at: m.at,
          })),
        };
      });
      const firstUser = result.value.find((m) => m.role === "user" && m.content.trim());
      if (firstUser) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id && !s.preview?.trim() ? { ...s, preview: firstUser.content } : s,
          ),
        );
      }
    },
    [runs, updateRun],
  );

  /**
   * Open one chat in the dock's working view.
   *
   * A plain click is navigation, the way a link is: the chat takes over the tab
   * the operator is looking at, and a chat that already has a tab is simply
   * activated. A second tab exists only when it was asked for — a middle click,
   * the row's "Open in new tab", or a run nobody opened — which is the whole
   * difference between "look at this chat" and "keep this chat".
   */
  const openChat = useCallback(
    async (id: string) => {
      closedTabs.current.delete(id);
      setActiveId(id);
      setSurface("thread");
      window.localStorage.setItem(LAST_SESSION_KEY, id);
      setListError(null);
      const tabs = openTabsRef.current;
      if (!tabs.includes(id)) {
        const active = activeIdRef.current;
        const index = active ? tabs.indexOf(active) : -1;
        if (index >= 0) {
          // The clicked chat takes over the tab on screen. If that tab is
          // mid-turn, the running chat is split into its own tab first: a live
          // reply is never hidden by navigation, and it is exactly the parallel
          // session the tab strip exists to show.
          const next = tabs.slice();
          if (active && (runs[active]?.sending ?? false)) next.push(active);
          next[index] = id;
          setOpenTabs(next);
        } else {
          setOpenTabs([...tabs, id]);
        }
      }
      await loadMessages(id);
    },
    [loadMessages, runs],
  );

  /** Give one chat a tab of its own, without disturbing the one in front. */
  const openChatInNewTab = useCallback(
    async (id: string) => {
      closedTabs.current.delete(id);
      setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setActiveId(id);
      setSurface("thread");
      window.localStorage.setItem(LAST_SESSION_KEY, id);
      setListError(null);
      await loadMessages(id);
    },
    [loadMessages],
  );

  /**
   * Landing behaviour, once per mount: resume the chat this dock opened last,
   * else the most recent one, else show the list. Never mints a session — an
   * empty chat made on every open is how the list filled with "New chat" rows.
   */
  const resumeLast = useCallback(async () => {
    if (resuming.current || activeIdRef.current) return;
    resuming.current = true;
    try {
      const listed = sessionsRef.current.length
        ? sessionsRef.current
        : await loadSessions();
      if (!listed) return;
      const stored = window.localStorage.getItem(LAST_SESSION_KEY);
      const resume = listed.find((s) => s.id === stored) ?? listed[0] ?? null;
      if (resume) await openChat(resume.id);
      else setSurface("list");
    } finally {
      resuming.current = false;
    }
  }, [loadSessions, openChat]);

  const closeTab = useCallback(
    (id: string) => {
      // A run left behind a closed tab would keep streaming into a chat nobody
      // can see, so closing one stops it. The frame stream continues until the
      // gateway acknowledges, which is why `closedTabs` also suppresses the
      // tab being re-made by those last frames.
      const run = runs[id] ?? EMPTY_RUN;
      if (run.sending && run.runId) void api().companionRunStop(run.runId);
      closedTabs.current.add(id);
      const current = openTabsRef.current;
      const index = current.indexOf(id);
      if (index === -1) {
        setReceiptFor(id, null);
        return;
      }
      const next = current.filter((tab) => tab !== id);
      setOpenTabs(next);
      setReceiptFor(id, null);
      if (activeIdRef.current !== id) return;
      const neighbor = next[Math.min(index, next.length - 1)] ?? null;
      if (neighbor) {
        setActiveId(neighbor);
        window.localStorage.setItem(LAST_SESSION_KEY, neighbor);
        void loadMessages(neighbor);
      } else {
        setActiveId(null);
        setSurface("list");
        window.localStorage.removeItem(LAST_SESSION_KEY);
      }
    },
    [runs, loadMessages, setReceiptFor],
  );

  /**
   * Rename, pin or archive one chat. All three are durable Hermes-side flags, so
   * the write goes back to the gateway and Hermes Desktop sees the same state.
   * The row is patched from the patch itself, never from the reply: the reply
   * carries no `preview` and no `last_active` (the list query computes those).
   */
  const patchSession = useCallback(
    async (id: string, patch: CompanionSessionPatch): Promise<boolean> => {
      const result = await api().companionSessionPatch(id, patch);
      if (!result.ok) {
        setListError(result.error);
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
                  archived:
                    typeof patch.archived === "boolean"
                      ? patch.archived
                      : s.archived,
                }
              : s,
          )
          // Archiving hides the row from the working view. The archived view
          // keeps it, greyed: that view exists so the chat can be found and
          // restored. Hermes keeps every message either way.
          .filter(
            (s) =>
              !(
                patch.archived === true &&
                s.id === id &&
                !showArchivedRef.current
              ),
          ),
      );
      if (patch.archived === true) {
        const wasActive = activeIdRef.current === id;
        closeTab(id);
        // Archiving the chat on screen puts the list up, as it always has: the
        // chat is no longer part of the working set, and the list is where the
        // remaining ones are managed. A non-active row's archive leaves the open
        // thread exactly where it was.
        if (wasActive) setSurface("list");
      }
      return true;
    },
    [closeTab],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      const result = await api().companionSessionDelete(id);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      closedTabs.current.add(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setOpenTabs((prev) => prev.filter((tab) => tab !== id));
      setRuns((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setDrafts((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      automationContexts.current.delete(id);
      setRuntimePins((prev) => {
        if (!(id in prev)) return prev;
        const pins = { ...prev };
        delete pins[id];
        writeStoredRuntimePins(pins);
        return pins;
      });
      if (activeIdRef.current === id) {
        const remaining = openTabsRef.current.filter((tab) => tab !== id);
        setActiveId(remaining[remaining.length - 1] ?? null);
        if (remaining.length === 0) {
          setSurface("list");
          window.localStorage.removeItem(LAST_SESSION_KEY);
        }
      }
      setReceiptFor(id, null);
    },
    [setReceiptFor],
  );

  const newChat = useCallback(async (): Promise<string | null> => {
    // A chat that was created and never written in is already a "New chat" row:
    // an empty transcript, no preview. Clicking the slot again navigates to it
    // rather than minting a second empty chat.
    const listed = await loadSessions();
    const blank = listed?.find((s) => !s.preview?.trim());
    if (blank) {
      await openChat(blank.id);
      return blank.id;
    }

    const created = await api().companionSessionCreate("");
    if (!created.ok) {
      setListError(created.error);
      return null;
    }
    setSessions((prev) => [created.value, ...prev.filter((s) => s.id !== created.value.id)]);
    await openChat(created.value.id);
    return created.value.id;
  }, [loadSessions, openChat]);

  const setAutomationContext = useCallback((id: string, context: string) => {
    if (context.trim()) automationContexts.current.set(id, context);
    else automationContexts.current.delete(id);
  }, []);

  /**
   * One turn: the operator's text, the vault context, and — when the composer's
   * pills carry a pick — the model and thinking level that turn runs under.
   *
   * The user's bubble is appended to *that chat's* run before the request goes
   * out, so a chat that is switched away from still shows what was asked when
   * the operator comes back.
   */
  const sendMessage = useCallback(
    async (id: string, text: string) => {
      const content = text.trim();
      const attached = receipts[id] ?? null;
      if ((!content && !attached) || !id) return;
      const run = runs[id] ?? EMPTY_RUN;
      if (run.sending) return;

      const page = pageContext.on ? readPageContext(pageContext.route) : null;
      const automationContext = automationContexts.current.get(id);
      const pick = runtimePinsRef.current[id] ?? {};

      const sentAt = Date.now();
      updateRun(id, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: nextId(),
            role: "user",
            content,
            at: sentAt,
            ...(attached ? { receipt: { name: attached.name, size: attached.size } } : {}),
          },
        ],
        sending: true,
        error: null,
        runId: null,
        turnNote: null,
        tools: [],
        toolsOpen: false,
        approval: null,
      }));
      assistantIds.current.delete(id);
      setReceiptFor(id, null);
      setSessions((prev) =>
        prev
          .map((s) => {
            if (s.id !== id) return s;
            const preview = content || attached?.name || "";
            return {
              ...s,
              preview: s.preview?.trim() ? s.preview : preview,
              lastActive: Date.now() / 1000,
            };
          })
          .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
      );

      try {
        const result = await api().companionChatStream({
          sessionId: id,
          input: content,
          instructionsContext: {
            domainName: activeDomain?.meta.name ?? null,
            domainSlug: activeDomain?.slug ?? null,
            viewingBoard: boardSlug,
            viewingBoardLocked: boardLocked,
            ...(contextCardRef.current
              ? { focusedCard: focusedCardOf(contextCardRef.current) }
              : {}),
            ...(page ? { pageContext: page } : {}),
            ...(automationContext ? { automationContext } : {}),
            aboutMe: snapshot?.map?.aboutMe ?? "",
            locked: false,
            vaultOpen: Boolean(snapshot),
          },
          runtime: pick,
          receiptRelPath: attached?.relPath ?? null,
        });
        if ("ok" in result && result.ok === false) {
          updateRun(id, (current) => ({ ...current, error: result.error }));
        }
      } catch (err) {
        updateRun(id, (current) => ({
          ...current,
          error: err instanceof Error ? err.message : "Failed to reach Hermes",
        }));
      } finally {
        void refresh();
        const listed = await api().companionSessionsList();
        if (listed.ok) setSessions(listed.value);
        // The stream's terminal frame clears `sending` when it arrives; if the
        // transport settled without one, the composer must not stay stopped.
        updateRun(id, (current) => (current.sending ? { ...current, sending: false } : current));
      }
    },
    [
      activeDomain,
      boardLocked,
      boardSlug,
      pageContext,
      receipts,
      refresh,
      setReceiptFor,
      snapshot,
      updateRun,
      runs,
    ],
  );

  const stopRun = useCallback(async (id: string) => {
    const run = runs[id] ?? EMPTY_RUN;
    if (!run.runId) return;
    const result = await api().companionRunStop(run.runId);
    if (!result.ok) updateRun(id, (current) => ({ ...current, error: result.error }));
  }, [runs, updateRun]);

  const approve = useCallback(
    (id: string, runId: string, requestId: string, allow: boolean) => {
      void api().companionApproval({ runId, requestId, allow });
      updateRun(id, (current) =>
        current.approval?.requestId === requestId
          ? { ...current, approval: null }
          : current,
      );
    },
    [updateRun],
  );

  const dismissError = useCallback(
    (id?: string | null) => {
      setListError(null);
      const target = id ?? activeIdRef.current;
      if (target) updateRun(target, (current) => ({ ...current, error: null }));
    },
    [updateRun],
  );

  const reportError = useCallback((message: string | null) => setListError(message), []);

  const setErrorFor = useCallback(
    (id: string, message: string | null) => {
      updateRun(id, (current) =>
        current.error === message ? current : { ...current, error: message },
      );
    },
    [updateRun],
  );

  const setToolsOpen = useCallback(
    (id: string, open: boolean) => {
      updateRun(id, (current) =>
        current.toolsOpen === open ? current : { ...current, toolsOpen: open },
      );
    },
    [updateRun],
  );

  /* ——— the stream ————————————————————————————————————————————————
   *
   * Installed once, for the provider's whole life, and routed by the frame's
   * session id. This is the piece that makes parallel chats work: a delta for a
   * chat the operator is not looking at lands in that chat's run anyway, and
   * the tab strip grows a tab for a turn nobody opened (a scheduled automation,
   * for instance) so it can be found when it finishes.
   */
  useEffect(() => {
    const off = api().onCompanionStream((frame: CompanionStreamFrame) => {
      const { sessionId: id, event: evt } = frame;
      if (!id) return;
      const isActive = () => activeIdRef.current === id;

      if (evt.type === "run.started") {
        // A new turn is a new reason to show the chat: a tab the operator closed
        // after the last run belongs to that run, not to this one. (The marks
        // exist only to keep the frames still on the wire from resurrecting it.)
        closedTabs.current.delete(id);
        ensureTab(id);
        updateRun(id, (current) => ({
          ...current,
          runId: evt.runId || null,
          sending: true,
          error: null,
          turnNote: null,
          approval: null,
        }));
        if (isActive()) setLivePinId(contextCardRef.current?.pin.id ?? null);
        return;
      }
      if (evt.type === "assistant.delta") {
        const bubble = assistantIds.current.get(id) ?? nextId();
        assistantIds.current.set(id, bubble);
        const startedAt = Date.now();
        updateRun(id, (current) => {
          const index = current.messages.findIndex((m) => m.id === bubble);
          if (index === -1) {
            return {
              ...current,
              messages: [
                ...current.messages,
                { id: bubble, role: "assistant", content: evt.text, at: startedAt },
              ],
            };
          }
          const messages = current.messages.slice();
          const cur = messages[index]!;
          messages[index] = { ...cur, content: cur.content + evt.text };
          return { ...current, messages };
        });
        return;
      }
      if (evt.type === "tool.started") {
        updateRun(id, (current) => ({
          ...current,
          tools: [
            ...current.tools,
            { id: nextId(), name: evt.name, target: evt.target, done: false },
          ],
        }));
        return;
      }
      if (evt.type === "tool.completed") {
        updateRun(id, (current) => {
          const index = current.tools.findIndex(
            (call) => !call.done && call.name === evt.name,
          );
          if (index === -1) return current;
          const tools = current.tools.slice();
          tools[index] = { ...tools[index]!, done: true };
          return { ...current, tools };
        });
        return;
      }
      if (evt.type === "approval.request") {
        updateRun(id, (current) => ({
          ...current,
          approval: {
            runId: evt.runId,
            requestId: evt.requestId,
            summary: evt.summary,
          },
        }));
        return;
      }
      if (evt.type === "run.stopped") {
        updateRun(id, (current) => ({
          ...current,
          sending: false,
          runId: null,
          turnNote: "Stopped — the reply above is only what arrived before the interrupt",
        }));
        closedTabs.current.delete(id);
        if (isActive()) setLivePinId(null);
        return;
      }
      if (evt.type === "run.incomplete") {
        updateRun(id, (current) => ({
          ...current,
          sending: false,
          runId: null,
          turnNote: evt.reason
            ? `Ended before finishing — ${evt.reason}`
            : "Ended before finishing",
        }));
        closedTabs.current.delete(id);
        if (isActive()) setLivePinId(null);
        return;
      }
      if (evt.type === "error") {
        updateRun(id, (current) => ({ ...current, sending: false, error: evt.message }));
        return;
      }
      if (evt.type === "run.completed") {
        updateRun(id, (current) => ({
          ...current,
          sending: false,
          runId: null,
        }));
        closedTabs.current.delete(id);
        if (isActive()) setLivePinId(null);
        void refresh();
        return;
      }
      /**
       * The app's own frames arrive after the stream has finished: the main
       * process reads the turn's fenced proposals and files them, and a turn that
       * said "here are the changes" also says what became of them. Without this
       * line the operator had to take the agent's word for it — the reported bug
       * was the agent saying it filed decisions while the Inbox (rightly, because
       * the old funnel dropped them) showed nothing.
       *
       * The note lands on the chat the frame names, not on whichever chat is
       * open: a scheduled automation that files proposals keeps its own record of
       * having done so in its own tab.
       */
      if (evt.type === "decisions.filed") {
        const count = evt.ids.length;
        const named = evt.titles
          .slice(0, 2)
          .map((title) => (title.length > 64 ? `${title.slice(0, 63)}…` : title));
        const more =
          evt.titles.length > named.length
            ? ` and ${evt.titles.length - named.length} more`
            : "";
        updateRun(id, (current) => ({
          ...current,
          turnNote: `Filed ${count} ${count === 1 ? "proposal" : "proposals"} — review ${
            count === 1 ? "it" : "them"
          } in Decisions${named.length > 0 ? `: ${named.join(", ")}${more}` : ""}.`,
        }));
        return;
      }
      if (evt.type === "decisions.problem") {
        // A proposal that could not be filed is said out loud, not left for the
        // operator to notice as an absence in the Inbox.
        updateRun(id, (current) => ({ ...current, turnNote: evt.message }));
        return;
      }
    });
    return off;
  }, [ensureTab, refresh, setLivePinId, updateRun]);

  /**
   * The dock's landing is the provider's to arrange: the sidebar lists chats
   * from the first paint, but which chat the dock opens is still the last one
   * the operator left.
   */
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // A scheduled automation writes its run to the vault and fires the shelf's
    // change event; re-reading the list picks up the chat it started.
    const reload = () => void loadSessions();
    window.addEventListener(AUTOMATIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AUTOMATIONS_CHANGED_EVENT, reload);
  }, [loadSessions]);

  useEffect(() => {
    return () => {
      for (const url of receiptPreviews.current.values()) URL.revokeObjectURL(url);
      receiptPreviews.current.clear();
    };
  }, []);

  // The dock handed this chat to the companion with material the operator never
  // typed (an automation's page). Bind it before the first turn is sent.
  useEffect(() => {
    if (!activeId || !requestedAutomationContext?.trim()) return;
    automationContexts.current.set(activeId, requestedAutomationContext);
  }, [activeId, requestedAutomationContext]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const value = useMemo<ChatSessionsContextValue>(
    () => ({
      sessions,
      sessionsLoaded,
      listError,
      surface,
      setSurface,
      activeId,
      openTabs,
      activeSession,
      runOf,
      updateRun,
      draftOf,
      setDraftFor,
      receiptOf,
      setReceiptFor,
      runtimePins,
      updateRuntimePick,
      showArchived,
      setShowArchived,
      loadSessions,
      openChat,
      openChatInNewTab,
      resumeLast,
      newChat,
      closeTab,
      patchSession,
      deleteChat,
      sendMessage,
      stopRun,
      approve,
      dismissError,
      reportError,
      setErrorFor,
      setToolsOpen,
      setAutomationContext,
    }),
    [
      approve,
      activeId,
      activeSession,
      closeTab,
      deleteChat,
      dismissError,
      draftOf,
      reportError,
      listError,
      loadSessions,
      newChat,
      openChat,
      openChatInNewTab,
      openTabs,
      patchSession,
      receiptOf,
      resumeLast,
      runOf,
      runtimePins,
      sendMessage,
      sessions,
      sessionsLoaded,
      setShowArchived,
      showArchived,
      setAutomationContext,
      setDraftFor,
      reportError,
      setErrorFor,
      setReceiptFor,
      setToolsOpen,
      stopRun,
      surface,
      updateRun,
      updateRuntimePick,
    ],
  );

  return (
    <ChatSessionsContext.Provider value={value}>
      {children}
    </ChatSessionsContext.Provider>
  );
}

export function useChatSessions(): ChatSessionsContextValue {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) {
    throw new Error("useChatSessions must be used within ChatSessionsProvider");
  }
  return ctx;
}

/** The provider, or null — for a panel that may be mounted on its own. */
export function useChatSessionsOptional(): ChatSessionsContextValue | null {
  return useContext(ChatSessionsContext);
}

/** The focused-card shape the turn's instructions carry. */
function focusedCardOf(card: ChatCardContext): FocusedCardContext {
  const pin = card.pin;
  const shared = { label: card.label, pinId: pin.id, boardSlug: card.boardSlug };
  if (pin.kind === "view") {
    return { ...shared, kind: "view", domainSlug: pin.domainSlug, viewId: pin.viewId };
  }
  if (pin.kind === "page") {
    return { ...shared, kind: "page", domainSlug: pin.domainSlug, pageId: pin.pageId };
  }
  return {
    ...shared,
    kind: "system",
    domainSlug: null,
    system: pin.system,
  };
}

export { EMPTY_RUN };
