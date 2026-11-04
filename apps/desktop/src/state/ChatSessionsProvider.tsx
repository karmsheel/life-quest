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
import {
  useChatDock,
  type ChatCardContext,
  type ChatSurface,
} from "@/state/ChatDockProvider";
import {
  readStoredChatTabs,
  restoredChatTabs,
  writeStoredChatTabs,
} from "@/state/chat-tabs-persistence";
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
 * The dock's three chat surfaces — the all-chats list, the open conversation,
 * and the Life-Chain the same dock can show — live on `ChatDockProvider` now,
 * beside the dock's open state, because the titlebar's shortcuts control opens
 * the dock onto a fourth one. The chat store reads the surface it is on and
 * moves it as chats open and close.
 */
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
 * The strip's tabs in drawing order: the pinned live chats first, then the open
 * unpinned tabs.
 *
 * A pin is a durable Hermes flag, not a strip-local decoration: it says "keep
 * this chat in front" on every channel. So a pinned chat is drawn as a tab even
 * when this app never opened it this run — that is what makes the squares come
 * back after a restart, with no second store to keep in step. The unpinned band
 * is the provider's own `openTabs`, in the order the operator made them.
 *
 * The pinned band keeps tab order for the pins that already have a tab, and
 * falls back to the list order for a pin that arrived without one (a pin made in
 * Hermes Desktop, or on this profile while the app was shut), so the band is
 * stable across renders instead of shuffling with activity.
 */
function visibleTabOrder(
  sessions: readonly HermesSession[],
  openTabs: readonly string[],
): string[] {
  const pinned = sessions.filter((s) => s.pinned && !s.archived);
  const pinnedIds = pinned.map((s) => s.id);
  const pinnedRank = new Map(pinnedIds.map((id, index) => [id, index]));
  const tabRank = new Map(openTabs.map((id, index) => [id, index]));
  const pinnedTabs = pinnedIds.slice().sort((a, b) => {
    const aTab = tabRank.get(a);
    const bTab = tabRank.get(b);
    if (aTab !== undefined && bTab !== undefined) return aTab - bTab;
    if (aTab !== undefined) return -1;
    if (bTab !== undefined) return 1;
    return (pinnedRank.get(a) ?? 0) - (pinnedRank.get(b) ?? 0);
  });
  const rest = openTabs.filter((id) => !pinnedRank.has(id));
  return [...pinnedTabs, ...rest];
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

  activeId: string | null;
  /** The chats the operator has open, in the order the tabs were made. */
  openTabs: string[];
  /**
   * The strip's tabs in drawing order: every pinned live chat first (a pinned
   * chat is always a tab, even on a launch where it was never opened), then the
   * open unpinned tabs in the order they were made. This is what the dock draws
   * and what "the next tab" means when one closes; `openTabs` stays the explicit
   * working set, so the two differ exactly by the pinned chats.
   */
  tabIds: string[];
  /** The ids in `tabIds` that are pinned chats: the ones drawn as squares. */
  pinnedTabIds: string[];
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
    surface,
    setSurface,
  } = useChatDock();

  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
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
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
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
  /**
   * The blank-chat request in flight, shared by every gesture that asks for one.
   * Two archives whose replies land before React commits — or a press of New
   * chat during one — would otherwise each mint a blank chat.
   */
  const newChatInFlight = useRef<Promise<string | null> | null>(null);
  /**
   * Whether the landing has read the profile's remembered tab strip. Writes are
   * held off until it has: the first commit of a fresh mount has no tabs yet, and
   * persisting that would erase the very strip the landing is about to restore.
   * A failed list read leaves it false, so a gateway hiccup cannot cost the memory
   * either.
   */
  const tabsHydrated = useRef(false);

  /**
   * The strip the dock draws, and the pinned subset of it. Both are derived:
   * the pins are Hermes state, the open tabs are this store's, and drawing the
   * union is what makes a pinned chat a tab without a second persisted list.
   */
  const tabIds = useMemo(
    () => visibleTabOrder(sessions, openTabs),
    [sessions, openTabs],
  );
  const pinnedTabIds = useMemo(() => {
    const pinned = new Set(
      sessions.filter((s) => s.pinned && !s.archived).map((s) => s.id),
    );
    return tabIds.filter((id) => pinned.has(id));
  }, [sessions, tabIds]);
  /**
   * The same order for callbacks that run before their state change commits:
   * closing a tab, archiving the one in front or deleting the open chat all have
   * to name the neighbour the operator can actually see.
   */
  const visibleTabsNow = useCallback(
    () => visibleTabOrder(sessionsRef.current, openTabsRef.current),
    [],
  );

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
   * the row's "Open in new tab", the New chat slot, or a run nobody opened —
   * which is the whole difference between "look at this chat" and "keep this
   * chat".
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
        const clicked = sessionsRef.current.find((s) => s.id === id) ?? null;
        if (clicked?.pinned) {
          // A pinned chat already has a tab in the strip even though it is not
          // in the explicit working set. Opening it adds that tab to the set and
          // leaves the tab in front alone: the operator asked to look at the
          // pinned chat, not to throw the current conversation away.
          setOpenTabs([...tabs, id]);
        } else {
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
   * Landing behaviour, once per mount: bring back the tab strip the operator
   * left (every open chat, in tab order, with the tab that was in front), else
   * resume the chat this dock opened last, else the most recent one, else the
   * thread's blank slate. Never mints a session — an empty chat made on every
   * open is how the working set filled with "New chat" tabs nobody wrote in.
   *
   * The remembered strip is reconciled against the list just read, so a chat
   * deleted or archived elsewhere while the app was shut cannot come back as a
   * tab pointing at nothing. The rest of the restored transcripts are read when
   * their tab is clicked, as any other unopened chat's is.
   */
  const resumeLast = useCallback(async () => {
    if (resuming.current || activeIdRef.current) return;
    resuming.current = true;
    try {
      const listed = sessionsRef.current.length
        ? sessionsRef.current
        : await loadSessions();
      // No list, no landing: leave the memory alone and let the store finish the
      // mount it already started rather than clearing the strip over a hiccup.
      if (!listed) return;
      const stored = readStoredChatTabs();
      const lastSessionId = window.localStorage.getItem(LAST_SESSION_KEY);
      const landing = restoredChatTabs(
        stored,
        new Set(listed.map((s) => s.id)),
        { openNow: openTabsRef.current, lastSessionId },
      );
      if (landing.closedStrip) {
        // Every tab was closed before the app quit. That is a decision about the
        // working set, so the landing is the thread's blank slate — not a chat
        // resumed over the top of it, which is what made a closed chat look
        // reopened. A pinned chat is the exception the operator made: its tab is
        // permanent, so landing on one is not reopening what they closed.
        tabsHydrated.current = true;
        const pinned = visibleTabOrder(listed, openTabsRef.current);
        const first = pinned[0] ?? null;
        if (first) {
          setActiveId(first);
          setSurface("thread");
          setListError(null);
          window.localStorage.setItem(LAST_SESSION_KEY, first);
          await loadMessages(first);
          return;
        }
        setSurface("thread");
        return;
      }
      if (landing.activeId) {
        tabsHydrated.current = true;
        setOpenTabs(landing.tabs);
        setActiveId(landing.activeId);
        setSurface("thread");
        setListError(null);
        window.localStorage.setItem(LAST_SESSION_KEY, landing.activeId);
        await loadMessages(landing.activeId);
        return;
      }
      // No strip to restore: a first landing, or a profile from before the strip
      // was remembered. The old rule still holds — the last chat, the most
      // recent one, else the thread's blank slate.
      tabsHydrated.current = true;
      const resume = listed.find((s) => s.id === lastSessionId) ?? listed[0] ?? null;
      if (resume) await openChat(resume.id);
      else setSurface("thread");
    } finally {
      resuming.current = false;
    }
  }, [loadMessages, loadSessions, openChat, setSurface]);

  /**
   * The "New chat" slot: a blank conversation, always in a tab of its own.
   *
   * Asking for a new chat is the gesture that keeps the one in front — a fresh
   * conversation is a second thing to work in, not a replacement for the thread
   * on screen. So this takes the same path as a middle click, `openChatInNewTab`,
   * and not the navigating `openChat` a plain row click uses. A blank chat that
   * already exists still wins: it is a "New chat" row with an empty transcript
   * and no preview, and the slot lands on the tab it already has rather than
   * minting a second empty chat beside it. An archived blank chat does not
   * count: the archived view is where it is restorable, not where it is opened.
   *
   * `excludeId` is the chat being archived when this call is the archive's
   * landing. A list read that still carries it — a stale answer, or a second
   * archive racing this one — must not hand it back as the blank to open.
   */
  const newChat = useCallback(
    async (excludeId?: string): Promise<string | null> => {
      // One blank chat at a time: every gesture asking while the first request
      // is still out shares its answer instead of minting a second blank.
      if (newChatInFlight.current) return newChatInFlight.current;
      const work = (async (): Promise<string | null> => {
        const listed = await loadSessions();
        const blank = listed?.find(
          (s) => s.id !== excludeId && !s.archived && !s.preview?.trim(),
        );
        if (blank) {
          await openChatInNewTab(blank.id);
          return blank.id;
        }

        const created = await api().companionSessionCreate("");
        if (!created.ok) {
          setListError(created.error);
          return null;
        }
        setSessions((prev) => [
          created.value,
          ...prev.filter((s) => s.id !== created.value.id),
        ]);
        await openChatInNewTab(created.value.id);
        return created.value.id;
      })();
      newChatInFlight.current = work;
      try {
        return await work;
      } finally {
        newChatInFlight.current = null;
      }
    },
    [loadSessions, openChatInNewTab],
  );

  /**
   * Close one chat's tab.
   *
   * When the tab closed was the one in front, the strip hands the screen to its
   * neighbour — the tab that takes its place, or the one before it when it was
   * last — and the operator keeps working. With no tab left the dock falls back
   * to `emptySurface`, which is the thread's blank slate for a plain close: the
   * working set is empty, and the next step is the New chat slot. An archive
   * passes the surface the operator was already on instead, so it can land on
   * that same blank slate rather than being thrown out of the dock.
   */
  const closeTab = useCallback(
    (id: string, emptySurface: ChatSurface = "thread") => {
      // A pinned chat's square is the operator's chosen permanent tab: closing
      // it is what Unpin is for, and nothing may drop it behind their back.
      if (sessionsRef.current.find((s) => s.id === id)?.pinned) return;
      // A run left behind a closed tab would keep streaming into a chat nobody
      // can see, so closing one stops it. The frame stream continues until the
      // gateway acknowledges, which is why `closedTabs` also suppresses the
      // tab being re-made by those last frames.
      const run = runs[id] ?? EMPTY_RUN;
      if (run.sending && run.runId) void api().companionRunStop(run.runId);
      closedTabs.current.add(id);
      const current = openTabsRef.current;
      // The neighbour is read from the drawn order, not from `openTabs`: pinned
      // chats sit in that order without being in this state, and the tab beside
      // the one closing is a fact about the strip.
      const visible = visibleTabsNow();
      const visibleIndex = visible.indexOf(id);
      const index = current.indexOf(id);
      if (index === -1) {
        setReceiptFor(id, null);
        return;
      }
      const next = current.filter((tab) => tab !== id);
      setOpenTabs(next);
      setReceiptFor(id, null);
      if (activeIdRef.current !== id) return;
      const remaining = visible.filter((tab) => tab !== id);
      const at =
        visibleIndex === -1
          ? remaining.length - 1
          : Math.min(visibleIndex, remaining.length - 1);
      const neighbor = remaining[at] ?? null;
      if (neighbor) {
        setActiveId(neighbor);
        window.localStorage.setItem(LAST_SESSION_KEY, neighbor);
        void loadMessages(neighbor);
      } else {
        setActiveId(null);
        setSurface(emptySurface);
        window.localStorage.removeItem(LAST_SESSION_KEY);
      }
    },
    [runs, loadMessages, setReceiptFor, setSurface, visibleTabsNow],
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
        // Read the strip and the surface before the close: this callback's own
        // state updates are not visible until the next render.
        const remaining = visibleTabsNow().filter((tab) => tab !== id);
        const landingSurface = surfaceRef.current;
        // The archived chat leaves the working set, and its tab goes with it.
        // When it was the tab in front, the strip hands the screen to the tab
        // that takes its place; a background row's archive leaves the open
        // thread exactly where it was. Either way the dock stays on the thread:
        // the history is the sidebar's, and the operator did not ask to be sent
        // there.
        closeTab(id, landingSurface);
        if (wasActive && remaining.length === 0 && landingSurface === "thread") {
          // The last chat in the strip was the one archived. The thread stays
          // up and opens a blank conversation: the blank slate the New chat
          // slot lands on. The archived chat is excluded from the blank search;
          // a gateway that refuses to make one leaves the thread empty, which is
          // the honest state — the New chat slot is right there in the bar.
          void newChat(id);
        }
      }
      if (typeof patch.pinned === "boolean") {
        // An unpin keeps the chat on screen: the square it wore as a pinned tab
        // becomes an ordinary tab, so the operator can still see the
        // conversation they just un-pinned (and reach Rename/Archive/Delete on
        // it). A pin clears the same suppression, so a chat closed in an earlier
        // frame can still be drawn again by its pin.
        closedTabs.current.delete(id);
        if (!patch.pinned) {
          setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        }
      }
      return true;
    },
    [closeTab, newChat, visibleTabsNow],
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
        // The same neighbour rule as closing a tab: the next one to its right in
        // the drawn strip, else the last one left. Pinned chats count — they are
        // tabs — so deleting the chat in front never empties a strip that still
        // has a square in it.
        const visible = visibleTabsNow();
        const at = visible.indexOf(id);
        const remaining = visible.filter((tab) => tab !== id);
        const neighbor =
          remaining[at === -1 ? remaining.length - 1 : Math.min(at, remaining.length - 1)] ??
          null;
        setActiveId(neighbor);
        if (neighbor) {
          window.localStorage.setItem(LAST_SESSION_KEY, neighbor);
          // A pinned chat may be the neighbour without ever having been opened
          // this run (it is a tab because of the pin), so its transcript has to
          // be read here the way closing a tab reads its neighbour's.
          if (!(runs[neighbor] ?? EMPTY_RUN).messagesLoaded) void loadMessages(neighbor);
        } else {
          setSurface("thread");
          window.localStorage.removeItem(LAST_SESSION_KEY);
        }
      }
      setReceiptFor(id, null);
    },
    [loadMessages, runs, setReceiptFor, visibleTabsNow],
  );

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

  /**
   * Remember the strip for the next run: the chats that were open, in tab order,
   * and the one in front.
   *
   * Written here rather than from each gesture so every path that changes the
   * strip is covered — opening, navigating, splitting, closing, deleting,
   * archiving, a run opening a tab of its own. The pair is written together: an
   * active id naming a tab the strip does not carry is not a memory to restore,
   * it is a landing into nothing. Held off until the first landing has read the
   * profile (`tabsHydrated`), because the mount before it has no tabs yet.
   */
  useEffect(() => {
    if (!tabsHydrated.current) return;
    writeStoredChatTabs(openTabs, activeId);
    if (activeId) window.localStorage.setItem(LAST_SESSION_KEY, activeId);
  }, [openTabs, activeId]);

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
      activeId,
      openTabs,
      tabIds,
      pinnedTabIds,
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
      pinnedTabIds,
      tabIds,
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
