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
  clearStoredLastSessionId,
  readStoredChatTabs,
  readStoredLastSessionId,
  restoredChatTabs,
  writeStoredChatTabs,
  writeStoredLastSessionId,
} from "@/state/chat-tabs-persistence";
import { useOptionalCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import type {
  CompanionRuntimeOverride,
  CompanionStreamFrame,
  HarnessId,
  HermesSession,
} from "@/vite-env";
import type { FocusedCardContext } from "../../electron/companion-client.ts";
import {
  applyTurnEvent,
  buildTurnTimeline,
  normalizeCapabilities,
  openTurn,
  settleProvisionally,
  type TurnRecord,
} from "@/lib/turn-timeline";
import type { HarnessTurnCapabilities } from "@/vite-env";

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
  /** True when this guidance was injected into the live turn instead of starting one. */
  steer?: boolean;
};

/** The receipt waiting in the composer for one chat's next turn. */
export type ChatReceipt = {
  relPath: string;
  name: string;
  size: number;
  previewUrl: string;
};

/**
 * One file waiting in the composer. The renderer keeps only the metadata and a
 * local preview; the bytes stay in main, addressed by `relPath`.
 */
export type ChatAttachment = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  name: string;
  size: number;
  mime: string;
  previewUrl?: string;
  relPath?: string;
};

/** A message the operator lined up to send after the current turn settles. */
export type QueuedMessage = {
  id: string;
  text: string;
  at: number;
};

/** Everything one chat's turn is doing, kept per session so parallel runs stay apart. */
export type SessionRun = {
  /**
   * Flat message bubbles, kept for callers that still read them. The panel no
   * longer renders these: a conversation is a list of turns (below), because a
   * reply, its work log and its outcome have to stay together. Tool rows are
   * excluded here — they are evidence, not something the companion said.
   */
  messages: ChatMessage[];
  /** The transcript has been read once for this chat; a revisit keeps it. */
  messagesLoaded: boolean;
  /** Every turn in the chat, oldest first; the live one is last. */
  turns: TurnRecord[];
  /** Id of the turn currently streaming, when one is. */
  liveTurnId: string | null;
  sending: boolean;
  /** Run id of the live turn, learned from `run.started`; stop needs it. */
  runId: string | null;
  approval: { runId: string; requestId: string; summary: string } | null;
  error: string | null;
};

/** Replace one turn in a run's list without disturbing the others. */
function replaceTurn(
  turns: readonly TurnRecord[],
  turnId: string,
  next: TurnRecord,
): TurnRecord[] {
  return turns.map((turn) => (turn.turnId === turnId ? next : turn));
}

/**
 * The turn a stream frame belongs to: the one this run opened, else the newest
 * turn still running. `run.started` renames the pending turn, and a late frame
 * may land after that bookkeeping — both are the same live turn.
 */
function liveTurnOf(run: SessionRun): TurnRecord | null {
  if (run.liveTurnId) {
    const byId = run.turns.find((turn) => turn.turnId === run.liveTurnId);
    if (byId) return byId;
  }
  for (let i = run.turns.length - 1; i >= 0; i -= 1) {
    const turn = run.turns[i]!;
    if (turn.status === "running") return turn;
  }
  return null;
}

/** The newest turn, settled or not: where late notes and terminals land. */
function lastTurnOf(run: SessionRun): TurnRecord | null {
  return run.turns.length > 0 ? run.turns[run.turns.length - 1]! : null;
}

/**
 * The dock's three surfaces — the open conversation, the Life-Chain the same
 * dock can show, and the keyboard-shortcuts reference — live on
 * `ChatDockProvider`, beside its open state, because the dock's own bottom bar
 * switches them. The chat store reads the surface it is on and moves it as
 * chats open and close.
 */
const EMPTY_RUN: SessionRun = Object.freeze({
  messages: [] as ChatMessage[],
  messagesLoaded: false,
  turns: [] as TurnRecord[],
  liveTurnId: null,
  sending: false,
  runId: null,
  approval: null,
  error: null,
});

/** The client-safe session fields the gateway's PATCH accepts. */
export type CompanionSessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

const RUNTIME_PINS_KEY = "lifequest.companion.runtimePins";

/**
 * The guard key for one landing: a landing belongs to a vault and an agent.
 *
 * Two landings for the same pair must not fight (the dock's mount landing and
 * the agent switch's landing race on purpose), but a landing for another vault
 * or another agent is a different question and must not be skipped because the
 * old one has not finished. The vault is part of the key so a same-harness vault
 * switch — Pi to Pi, the common case — still lands on the new vault's chats
 * instead of being mistaken for the landing already in flight.
 */
function landingKeyFor(vaultId: string | null, agent: HarnessId | null): string {
  return `${vaultId ?? "none"}:${agent ?? "legacy"}`;
}

/**
 * The refusal a Hermes transport answers while a vault switch is repointing the
 * companion, verbatim from the main process (`companion.ts`).
 *
 * It is not a failure the operator caused or can act on — it is the switch still
 * running — so the reads that answer it wait for the ready status instead of
 * painting a banner over the dock.
 */
const COMPANION_SWITCHING_ERROR = "The companion is switching to this vault's agent.";

function isCompanionSwitching(error: string | null | undefined): boolean {
  return error === COMPANION_SWITCHING_ERROR;
}

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
/** The sidebar's archived-row visibility, the three view options the menu offers. */
export type ArchivedView = "hide" | "show" | "only";

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
  /** The single finance receipt waiting for one chat's next turn. */
  receiptOf: (id: string | null | undefined) => ChatReceipt | null;
  /** Replace (or drop) that single receipt, preserving its chip semantics. */
  setReceiptFor: (id: string, receipt: ChatReceipt | null) => void;
  /** Every general attachment waiting on one chat's next turn, in composer order. */
  attachmentsOf: (id: string | null | undefined) => ChatAttachment[];
  setAttachmentsFor: (id: string, attachments: ChatAttachment[]) => void;
  addAttachmentFor: (id: string, attachment: ChatAttachment) => void;
  removeAttachmentFor: (id: string, attachmentId: string) => void;

  runtimePins: Record<string, CompanionRuntimeOverride>;
  updateRuntimePick: (id: string, pick: CompanionRuntimeOverride) => void;

  /**
   * The sidebar's archived view. "hide" is the working list; "show" adds the
   * greyed archived band below it; "only" drops the live rows so the archive
   * itself is the list. Archived rows are restorable, never openable, and the
   * dock's own working list stays live-only in all three.
   */
  archivedView: ArchivedView;
  setArchivedView: (view: ArchivedView) => void;

  loadSessions: () => Promise<HermesSession[] | null>;
  /** Navigate the active tab to a chat, the way a link navigates a browser tab. */
  openChat: (id: string) => Promise<void>;
  /**
   * Give a chat a tab of its own, keeping the one in front.
   *
   * `session` is the chat's own row for a chat the caller has just created. The
   * store lists it under that name from the first paint, because the gateway's
   * list has not been re-read yet — without it the new chat's tab would be a
   * bare "Chat" and its row would be missing from the sidebar.
   */
  openChatInNewTab: (id: string, session?: HermesSession) => Promise<void>;
  resumeLast: () => Promise<void>;
  newChat: () => Promise<string | null>;
  closeTab: (id: string) => void;
  patchSession: (id: string, patch: CompanionSessionPatch) => Promise<boolean>;
  deleteChat: (id: string) => Promise<void>;
  sendMessage: (id: string, text: string) => Promise<void>;
  /** Inject guidance into the live turn without starting another turn. */
  steerMessage: (id: string, text: string) => Promise<boolean>;
  /** Line a message up to send when the current turn settles. */
  queueMessage: (id: string, text: string) => void;
  queuedMessages: (id: string | null | undefined) => QueuedMessage[];
  removeQueued: (id: string, queuedId: string) => void;
  /** Send the head of one chat's queue, if that chat is idle. */
  drainQueue: (id: string) => Promise<void>;
  stopRun: (id: string) => Promise<void>;
  approve: (id: string, runId: string, requestId: string, allow: boolean) => void;
  dismissError: (id?: string | null) => void;
  /** A failure with no turn behind it: a list read, a receipt, the chain. */
  reportError: (message: string | null) => void;
  setErrorFor: (id: string, message: string | null) => void;
  /** Open or close one turn's process fold. */
  setTurnFoldOpen: (id: string, turnId: string, open: boolean) => void;
  setAutomationContext: (id: string, context: string) => void;
};

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(null);

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const { snapshot, refresh } = useVault();
  const activeDomain = useActiveDomain();
  const { slug: boardSlug, locked: boardLocked } = useDashboardBoard();
  const {
    requestedAutomationContext,
    contextCards,
    setLivePinIds,
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
  const [attachments, setAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>({});
  const [runtimePins, setRuntimePins] = useState<Record<string, CompanionRuntimeOverride>>(
    () => readStoredRuntimePins(),
  );
  const [archivedView, setArchivedViewState] = useState<ArchivedView>("hide");

  /**
   * The open vault's stable identity (`lifequest.id`, never the path: a copied
   * vault keeps its identity). Null on a harness page, which mounts this store
   * with no vault at all.
   *
   * Kept in a ref beside the state because a landing, a turn's settle and the
   * storage writes all read it after an await: they must write the key of the
   * vault the work belongs to, not whatever vault happens to be open when the
   * answer arrives.
   */
  const vaultId = snapshot?.lifequest.id ?? null;
  const vaultIdRef = useRef<string | null>(vaultId);
  vaultIdRef.current = vaultId;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const runtimePinsRef = useRef(runtimePins);
  runtimePinsRef.current = runtimePins;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const archivedViewRef = useRef(archivedView);
  archivedViewRef.current = archivedView;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const contextCardsRef = useRef<ChatCardContext[]>(contextCards);
  contextCardsRef.current = contextCards;
  /** Chats whose tab was deliberately closed while their turn was still live. */
  const closedTabs = useRef(new Set<string>());
  /** The automation material each chat was opened with, carried by every turn. */
  const automationContexts = useRef(new Map<string, string>());
  const receiptPreviews = useRef(new Map<string, string>());
  const attachmentPreviews = useRef(new Map<string, Set<string>>());
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

  const attachmentsOf = useCallback(
    (id: string | null | undefined) => (id ? attachments[id] ?? [] : []),
    [attachments],
  );

  const setAttachmentsFor = useCallback((id: string, next: ChatAttachment[]) => {
    const previews = attachmentPreviews.current.get(id) ?? new Set<string>();
    for (const item of attachments[id] ?? []) {
      if (item.previewUrl && !next.some((kept) => kept.id === item.id)) {
        URL.revokeObjectURL(item.previewUrl);
        previews.delete(item.previewUrl);
      }
    }
    for (const item of next) {
      if (item.previewUrl) previews.add(item.previewUrl);
    }
    if (previews.size > 0) attachmentPreviews.current.set(id, previews);
    else attachmentPreviews.current.delete(id);
    setAttachments((prev) => {
      const current = prev[id] ?? [];
      if (
        current.length === next.length &&
        current.every((item, index) => item === next[index])
      ) {
        return prev;
      }
      return { ...prev, [id]: next };
    });
  }, [attachments]);

  const addAttachmentFor = useCallback(
    (id: string, attachment: ChatAttachment) => {
      setAttachments((prev) => ({
        ...prev,
        [id]: [...(prev[id] ?? []), attachment],
      }));
      if (attachment.previewUrl) {
        const previews = attachmentPreviews.current.get(id) ?? new Set<string>();
        previews.add(attachment.previewUrl);
        attachmentPreviews.current.set(id, previews);
      }
    },
    [],
  );

  const removeAttachmentFor = useCallback((id: string, attachmentId: string) => {
    setAttachments((prev) => {
      const current = prev[id] ?? [];
      const removed = current.find((item) => item.id === attachmentId);
      const next = current.filter((item) => item.id !== attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        const previews = attachmentPreviews.current.get(id);
        previews?.delete(removed.previewUrl);
        if (previews?.size === 0) attachmentPreviews.current.delete(id);
      }
      if (next.length === current.length) return prev;
      return { ...prev, [id]: next };
    });
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

  /**
   * The chat list, from whichever agent is in front.
   *
   * The read carries the agent it was started for. A switch can land while it is
   * in flight, and the answer for the agent that is no longer in front must be
   * dropped rather than painted over the new one's list.
   */
  const loadSessions = useCallback(async (): Promise<HermesSession[] | null> => {
    const epoch = listEpoch.current;
    const vault = vaultEpoch.current;
    const agent = harnessRef.current;
    const listed = await api().companionSessionsList({
      includeArchived: archivedViewRef.current !== "hide",
    });
    if (epoch !== listEpoch.current) return null;
    // A vault switch while this read was in flight: the answer names the old
    // vault's chats, whatever the main process says its scope is now.
    if (vault !== vaultEpoch.current) return null;
    if (!listed.ok) {
      // A read that failed while the agent was still coming up is not an error
      // to paint: the rail says "loading", and the list is read again when the
      // agent reports ready. The same goes for the transport's own "switching"
      // refusal, which the main process sends while a vault switch repoints the
      // companion. Anything else is the agent's own answer.
      if (isCompanionSwitching(listed.error)) return null;
      if (agent && switchingRef.current === agent) return null;
      setListError(listed.error);
      return null;
    }
    if (agent) {
      for (const session of listed.value) agentOfSession.current.set(session.id, agent);
    }
    // A chat the new vault's list carries is that vault's own, so it stops being
    // retired: a vault the operator switches back to can open its chats again and
    // a stopped run's trailing frames for them land normally. Only ids no
    // current list claims stay retired, and those are exactly the ones whose
    // stopped frames could still arrive.
    for (const session of listed.value) retiredSessions.current.delete(session.id);
    setSessionsLoaded(true);
    setListError(null);
    setSessions(listed.value);
    return listed.value;
  }, []);

  /**
   * A chat belongs to the agent that made it.
   *
   * So a switch changes the sessions list and the tab strip, and nothing else:
   * the transcripts, drafts, receipts and queued turns stay where they are,
   * keyed by session id, because an agent that is not in front is not gone. A
   * turn that is streaming on the other agent keeps landing in its own chat's
   * run while the operator works here.
   */
  const companion = useOptionalCompanion();
  const harness = companion?.harness ?? null;
  /**
   * What the active companion can put in a work log. The panel renders the
   * descriptor, never the harness id; a stub with no summary falls back to the
   * full set so an old rig sees the whole experience rather than a disabled one.
   */
  const capabilities: HarnessTurnCapabilities = useMemo(
    () =>
      normalizeCapabilities(
        companion?.harnesses?.find((entry) => entry.active)?.capabilities,
      ),
    [companion?.harnesses],
  );
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const harnessStatus = companion?.status ?? null;
  const switching = companion?.switching ?? null;
  const harnessRef = useRef<HarnessId | null>(harness);
  harnessRef.current = harness;
  const switchingRef = useRef<HarnessId | null>(switching);
  switchingRef.current = switching;
  /**
   * Which agent's store this is. Bumped on every switch so a list read that was
   * started for the agent being left cannot set state for the one being entered.
   */
  const listEpoch = useRef(0);
  /**
   * Which vault's store this is. Bumped on every vault change, before anything
   * is cleared and before the new vault's chats are read. Every read that can
   * outlive a vault switch (the list, a transcript, a created chat, a turn's
   * settle) carries the epoch it started under and drops its answer when it
   * moved: the previous vault's answer must not paint over the new vault.
   */
  const vaultEpoch = useRef(0);
  /**
   * Chats the previous vault's store owned, retired when the vault changed.
   *
   * Stopping a live run is not instantaneous: the gateway keeps streaming its
   * terminal frames for a moment after `companionRunStop`, and those frames name
   * a session id from the vault that is no longer open. They are dropped, so a
   * stopped turn cannot grow a tab or a run in the new vault. The pair is only
   * skipped while the new vault's list does not carry that id — a vault the
   * operator switches back to keeps its chats, and their new turns land.
   */
  const retiredSessions = useRef(new Set<string>());
  /** The most recent landing, so an older one's cleanup cannot clear its guard. */
  const landingToken = useRef(0);
  /** Draws in flight, per chat: a second settle frame must not send twice. */
  const draining = useRef(new Set<string>());
  /**
   * The last list and strip seen for each agent, so switching back paints that
   * agent's chats at once and refreshes underneath, instead of showing an empty
   * rail while the store is read.
   */
  const harnessSnapshots = useRef(
    new Map<HarnessId, { sessions: HermesSession[]; openTabs: string[]; activeId: string | null }>(),
  );
  /** The agent a landing is in flight for, so two landings cannot fight. */
  const landingFor = useRef<string | null>(null);
  const seenHarness = useRef<HarnessId | null>(null);
  /**
   * Which agent each chat belongs to.
   *
   * A turn that is still streaming on the agent the operator left must keep
   * landing in its own chat's run — and must not grow a tab in the strip of the
   * agent they switched to. The frames carry a session id, not an agent, so the
   * list read is what says whose chat it is.
   */
  const agentOfSession = useRef(new Map<string, HarnessId>());
  const ownsSession = useCallback((id: string): boolean => {
    const owner = agentOfSession.current.get(id);
    const current = harnessRef.current;
    if (!owner || !current) return true;
    return owner === current;
  }, []);

  /**
   * Turn the sidebar's archived view on, off, or to archived-only. The list is
   * re-read rather than filtered from what is held: whether archived rows exist
   * at all is the store's answer (the gateway's page plus the profile's own
   * archived rows, see `companion-archived.ts`), and the read also refreshes the
   * live rows beside them.
   */
  const setArchivedView = useCallback(
    (view: ArchivedView) => {
      if (view === archivedViewRef.current) return;
      archivedViewRef.current = view;
      setArchivedViewState(view);
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
    async (id: string, force = false) => {
      const run = runs[id] ?? EMPTY_RUN;
      // `force` exists for the one caller that re-reads a transcript straight
      // after a turn has been settled: the settle is a state update, so this
      // callback's own `runs` is still the pre-settle value for one commit, and
      // an unforced read would refuse to repair a transcript the turn left
      // behind. The in-flight guard inside the update below still applies, so a
      // forced read can never paint over a newer turn's live bubbles.
      if (run.sending && !force) return;
      // The transcript is the old vault's if the vault changed while it was in
      // flight. Its chat id no longer belongs to the open store, so the answer is
      // dropped rather than opening a run for a chat nobody can see.
      const vault = vaultEpoch.current;
      const result = await api().companionSessionMessages(id);
      if (vault !== vaultEpoch.current) return;
      if (!result.ok) {
        // The read raced the vault switch's repoint: the dock keeps what it had
        // and reads again once the agent is ready.
        if (isCompanionSwitching(result.error)) return;
        updateRun(id, (current) => ({ ...current, error: result.error }));
        return;
      }
      const transcript = result.value;
      updateRun(id, (current) => {
        // A turn may have begun while the transcript was in flight; replacing
        // it with the stored page would drop what is already streaming.
        if (current.sending) return current;
        // Tool rows are evidence inside a turn, never bubbles of their own. The
        // flat list is kept besides the turns for the callers that still read it.
        const messages = transcript.flatMap((m) =>
          m.role === "tool"
            ? []
            : [
                {
                  id: nextId(),
                  role: m.role as "user" | "assistant",
                  content: m.content,
                  ...(m.at === undefined ? {} : { at: m.at }),
                },
              ],
        );
        return {
          ...current,
          messagesLoaded: true,
          messages,
          turns: buildTurnTimeline(transcript, {
            sessionId: id,
            ...(harnessRef.current ? { harness: harnessRef.current } : {}),
          }),
          liveTurnId: null,
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
      writeStoredLastSessionId(vaultIdRef.current, harnessRef.current, id);
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

  /**
   * Give one chat a tab of its own, without disturbing the one in front.
   *
   * A caller that has just created the chat hands its row along: the row is
   * adopted into the list before the strip draws, so the tab wears the chat's
   * own name and the sidebar carries it at once. Re-reading the gateway's list
   * instead would leave both blank for as long as that round trip takes.
   */
  const openChatInNewTab = useCallback(
    async (id: string, session?: HermesSession) => {
      closedTabs.current.delete(id);
      if (session) {
        const owner = harnessRef.current;
        if (owner) agentOfSession.current.set(session.id, owner);
        setSessions((prev) =>
          prev.some((s) => s.id === id) ? prev : [session, ...prev],
        );
      }
      setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setActiveId(id);
      setSurface("thread");
      writeStoredLastSessionId(vaultIdRef.current, harnessRef.current, id);
      setListError(null);
      await loadMessages(id);
    },
    [loadMessages],
  );

  /**
   * Land on one agent's chats: bring back the tab strip that agent last had
   * open (every open chat, in tab order, with the tab that was in front), else
   * resume the chat this dock opened last, else the most recent one, else the
   * thread's blank slate. Never mints a session — an empty chat made on every
   * open is how the working set filled with "New chat" tabs nobody wrote in.
   *
   * The remembered strip is reconciled against the list just read, so a chat
   * deleted or archived elsewhere while the app was shut cannot come back as a
   * tab pointing at nothing. The rest of the restored transcripts are read when
   * their tab is clicked, as any other unopened chat's is.
   *
   * `agent` is null only on a harness page, which has no companion provider at
   * all; those pages keep the pre-agent memory slot, exactly as before.
   * `fresh` forces a list read (a switch always does one), while a mount landing
   * takes the list the provider has already read. `allowSurface` lets a landing
   * put the dock on the thread; a switch leaves the dock's surface where the
   * operator put it — only the chats under the agent are supposed to move.
   */
  const landOnAgent = useCallback(
    async (
      agent: HarnessId | null,
      cached: { sessions: HermesSession[]; openTabs: string[]; activeId: string | null } | null,
      fresh: boolean,
      allowSurface: boolean,
    ) => {
      // A landing belongs to a vault and an agent. The epoch pair is captured
      // with the guard: the vault can change while the list is out, and then
      // this landing's whole basis — the list, the remembered strip, the ids —
      // is the previous vault's.
      const vault = vaultIdRef.current;
      const vaultAtStart = vaultEpoch.current;
      const key = landingKeyFor(vault, agent);
      if (landingFor.current === key) return;
      const token = ++landingToken.current;
      landingFor.current = key;
      try {
        // Read the remembered strip BEFORE the list goes out. The strip is the
        // last thing the dock wrote for this agent and vault, and a write from
        // the in-flight switch could otherwise land first and blank it.
        const stored = readStoredChatTabs(vault, agent);
        const listed =
          !fresh && sessionsRef.current.length
            ? sessionsRef.current
            : await loadSessions();
        // No list, no landing: leave the memory alone and let the store finish
        // the mount it already started rather than clearing the strip over a
        // hiccup.
        if (!listed) return;
        // The vault moved while the list was in flight: this landing would now
        // read the previous vault's strip and chats onto the new one.
        if (vaultAtStart !== vaultEpoch.current) return;
        const lastSessionId = readStoredLastSessionId(vault, agent);
        const live = new Set(listed.map((s) => s.id));
        // A tab a live turn opened while the list was in flight belongs to the
        // run that is happening now. On a switch, the strip already carried is
        // the incoming agent's own cached strip.
        const openNow = cached ? cached.openTabs : openTabsRef.current;
        const landing = restoredChatTabs(stored, live, { openNow, lastSessionId });
        if (landing.closedStrip) {
          // Every tab was closed before the app quit. That is a decision about
          // the working set, so the landing is the thread's blank slate — not a
          // chat resumed over the top of it, which is what made a closed chat
          // look reopened. A pinned chat is the exception the operator made:
          // its tab is permanent, so landing on one is not reopening what they
          // closed.
          tabsHydrated.current = true;
          const pinned = visibleTabOrder(listed, openNow);
          const first = pinned[0] ?? null;
          setOpenTabs([]);
          setActiveId(first);
          if (first) {
            writeStoredLastSessionId(vault, agent, first);
            setListError(null);
            await loadMessages(first);
          } else if (allowSurface) {
            setSurface("thread");
          }
          return;
        }
        if (landing.activeId) {
          tabsHydrated.current = true;
          setOpenTabs(landing.tabs);
          setActiveId(landing.activeId);
          writeStoredLastSessionId(vault, agent, landing.activeId);
          setListError(null);
          if (allowSurface) setSurface("thread");
          // A live turn's bubbles are arriving, not yet written down: its run is
          // already on screen and must not be replaced by the stored page.
          if (!runOf(landing.activeId).messagesLoaded) await loadMessages(landing.activeId);
          return;
        }
        // Nothing remembered: the cached tab in front if the agent still has
        // it, else the chat this dock opened last, else the most recent one,
        // else the thread's blank slate.
        tabsHydrated.current = true;
        const resumeId =
          (cached?.activeId && live.has(cached.activeId) ? cached.activeId : null) ??
          (lastSessionId && live.has(lastSessionId) ? lastSessionId : null) ??
          listed[0]?.id ??
          null;
        // The chat in front is a tab, like every other landing in this dock: an
        // active chat with no square in the strip is the strip having lost it.
        // Built from the target agent's own strip rather than from
        // `openTabsRef`, which still holds the agent being left in this frame.
        const kept = (cached?.openTabs ?? []).filter((id) => live.has(id));
        setOpenTabs(
          resumeId && !kept.includes(resumeId) ? [...kept, resumeId] : kept,
        );
        setActiveId(resumeId);
        if (resumeId) {
          writeStoredLastSessionId(vault, agent, resumeId);
          setListError(null);
          if (!runOf(resumeId).messagesLoaded) await loadMessages(resumeId);
        } else if (allowSurface) {
          setSurface("thread");
        }
      } finally {
        // An older landing's cleanup must not clear the guard of a newer one:
        // a vault switch resets the guard and starts its own landing while this
        // one is still unwinding.
        if (landingToken.current === token) landingFor.current = null;
      }
    },
    [loadMessages, loadSessions, runOf, setSurface],
  );

  /** The mount landing, asked for by the dock when it opens. */
  const resumeLast = useCallback(async () => {
    if (resuming.current || activeIdRef.current) return;
    resuming.current = true;
    try {
      const agent = harnessRef.current;
      await landOnAgent(
        agent,
        agent ? harnessSnapshots.current.get(agent) ?? null : null,
        false,
        true,
      );
    } finally {
      resuming.current = false;
    }
  }, [landOnAgent]);

  /**
   * The vault changed: this store is a different vault's store now.
   *
   * The dock keeps per-agent tab strips, transcripts, drafts, receipts, queued
   * turns, running turns and runtime pins — and every one of them names
   * something in the vault that is no longer open. None of that may survive the
   * switch: a run that outlived it would keep writing through doors that now
   * serve the other vault, and a restored strip would put the previous vault's
   * chats on screen. So the reset comes first and it is complete — live runs
   * stopped, the epochs moved (which drops the answers already in flight), then
   * every map and guard cleared. Only after that does the new vault land on its
   * own chats, when its agent is known.
   */
  const resetForVault = useCallback(() => {
    // Stop the live turns BEFORE the store forgets them: a run left running
    // keeps streaming through the doors, and those doors serve the new vault
    // now. The old vault's chats are retired so the stopped run's last frames
    // cannot reopen one of them here; the guard lifts once the new vault's own
    // list carries the id again (a vault the operator switches back to).
    for (const run of Object.values(runsRef.current)) {
      if (run.sending && run.runId) void api().companionRunStop(run.runId);
    }
    for (const id of Object.keys(runsRef.current)) retiredSessions.current.add(id);
    for (const session of sessionsRef.current) retiredSessions.current.add(session.id);
    // The epochs move FIRST: every read already in flight (a list, a transcript,
    // a created chat, a turn's settle) drops its answer from here on.
    vaultEpoch.current += 1;
    listEpoch.current += 1;
    // The refs mirror the state synchronously, before the new vault's landing
    // reads them: a landing's `openNow` is the tabs a live turn opened while the
    // list was out, and for this landing that must be none of the vault being
    // left. React updates the refs from state on the next render; the landing's
    // first await may resolve first.
    sessionsRef.current = [];
    activeIdRef.current = null;
    openTabsRef.current = [];
    runsRef.current = {};
    runtimePinsRef.current = {};
    harnessSnapshots.current.clear();
    agentOfSession.current.clear();
    closedTabs.current.clear();
    automationContexts.current.clear();
    draining.current.clear();
    newChatInFlight.current = null;
    resuming.current = false;
    landingFor.current = null;
    landingToken.current = 0;
    tabsHydrated.current = false;
    for (const url of receiptPreviews.current.values()) URL.revokeObjectURL(url);
    receiptPreviews.current.clear();
    for (const urls of attachmentPreviews.current.values()) {
      for (const url of urls) URL.revokeObjectURL(url);
    }
    attachmentPreviews.current.clear();
    setSessions([]);
    setSessionsLoaded(false);
    setListError(null);
    setActiveId(null);
    setOpenTabs([]);
    setRuns({});
    setDrafts({});
    setReceipts({});
    setAttachments({});
    setQueues({});
    setRuntimePins({});
    writeStoredRuntimePins({});
    // The archived view is a way of looking at one vault's history; the new
    // vault starts on its working list.
    archivedViewRef.current = "hide";
    setArchivedViewState("hide");
    setLivePinIds([]);
  }, [setLivePinIds]);

  /** The vault this store was last keyed to; `undefined` before the first read. */
  const seenVault = useRef<string | null | undefined>(undefined);
  if (seenVault.current === undefined) seenVault.current = vaultId;
  /** Whether a real vault has ever been open in this mount. */
  const everHadVault = useRef(vaultId !== null);
  useEffect(() => {
    const previous = seenVault.current ?? null;
    if (seenVault.current === vaultId) return;
    seenVault.current = vaultId;
    // The first vault a mounted store learns about is the one it was mounted for,
    // not a switch — a harness page resolves its stubbed snapshot after mount,
    // while the app's studio only mounts once the vault exists. That first read
    // must not reset the landing the dock already began.
    const initialRead = previous === null && !everHadVault.current;
    if (vaultId) everHadVault.current = true;
    if (initialRead) return;
    resetForVault();
    // The vault was closed: the store is empty and there is nothing to land on.
    if (!vaultId) return;
    const agent = harnessRef.current;
    if (!agent) return;
    resuming.current = true;
    void landOnAgent(agent, null, true, false).finally(() => {
      resuming.current = false;
    });
  }, [vaultId, landOnAgent, resetForVault]);

  /**
   * The swap, when the operator changes agent.
   *
   * A chat belongs to the agent that made it, so the sessions list and the tab
   * strip follow the new agent — but nothing is erased. The agent being left
   * keeps its strip in memory and in storage, the per-session transcripts and
   * drafts stay put, and the agent being entered paints its own cached strip at
   * once and refreshes underneath. What this used to do — blank the list, clear
   * the strip, write an empty strip to storage — is what made a switch read as
   * the chat column reloading and lost the other agent's tabs for good.
   */
  useEffect(() => {
    if (!harness) return;
    const previous = seenHarness.current;
    if (previous === harness) return;
    seenHarness.current = harness;
    // The dock's own landing can already be in flight for this very agent:
    // `ChatSessionsProvider` mounts after the harness list arrives, so the
    // panel's resume effect runs before this effect, starts the list read, and
    // is the first paint. Bumping the epoch under it cancels that read and the
    // dock lands on nothing (the list renders, no chat opens). A landing for
    // the legacy no-agent slot is not this one — it is cancelled below and
    // replaced by this agent's landing.
    if (
      resuming.current &&
      landingFor.current === landingKeyFor(vaultIdRef.current, harness)
    ) {
      return;
    }
    listEpoch.current += 1;
    if (previous) {
      harnessSnapshots.current.set(previous, {
        sessions: sessionsRef.current,
        openTabs: openTabsRef.current,
        activeId: activeIdRef.current,
      });
      // The strip is written for the vault it belongs to, which is the one open
      // now: after a vault change the previous agent's strip was already stored
      // under that vault's key by the write-through effect.
      writeStoredChatTabs(
        vaultIdRef.current,
        previous,
        openTabsRef.current,
        activeIdRef.current,
      );
    }
    const cached = harnessSnapshots.current.get(harness) ?? null;
    // The incoming agent's remembered strip is read HERE, before any state is
    // written for it: the persistence effect would otherwise write this empty
    // seed under the new agent's key and the landing would read back a strip the
    // operator never closed.
    const stored = readStoredChatTabs(vaultIdRef.current, harness);
    const seedTabs = cached?.openTabs ?? (stored.known ? stored.tabs : []);
    const seedActive = cached?.activeId ?? stored.activeId ?? null;
    setListError(null);
    setSessionsLoaded(Boolean(cached));
    setSessions(cached?.sessions ?? []);
    setOpenTabs(seedTabs);
    setActiveId(seedActive);
    resuming.current = true;
    void landOnAgent(harness, cached, true, false).finally(() => {
      resuming.current = false;
    });
  }, [harness, landOnAgent]);

  /**
   * The agent that a switch entered was still coming up, so its list read could
   * not answer. Now it is ready: read it again, and the chats appear without the
   * operator seeing an error banner for a state that was only "still starting".
   */
  const harnessReady =
    Boolean(harness) &&
    harnessStatus?.kind === "ready" &&
    harnessStatus.harness === harness;
  useEffect(() => {
    if (!harness || !harnessReady || sessionsLoaded) return;
    void landOnAgent(harness, harnessSnapshots.current.get(harness) ?? null, true, false);
  }, [harness, harnessReady, sessionsLoaded, landOnAgent]);

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
      // A blank chat is minted in whichever vault is open when the call goes out:
      // one asked for before a switch must not land in the new vault as if the
      // operator had asked for it here.
      const vaultAtStart = vaultEpoch.current;
      const work = (async (): Promise<string | null> => {
        const listed = await loadSessions();
        if (vaultAtStart !== vaultEpoch.current) return null;
        const blank = listed?.find(
          (s) => s.id !== excludeId && !s.archived && !s.preview?.trim(),
        );
        if (blank) {
          await openChatInNewTab(blank.id);
          return blank.id;
        }

        const created = await api().companionSessionCreate("");
        if (vaultAtStart !== vaultEpoch.current) return null;
        if (!created.ok) {
          if (!isCompanionSwitching(created.error)) setListError(created.error);
          return null;
        }
        const creator = harnessRef.current;
        if (creator) agentOfSession.current.set(created.value.id, creator);
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
        writeStoredLastSessionId(vaultIdRef.current, harnessRef.current, neighbor);
        void loadMessages(neighbor);
      } else {
        setActiveId(null);
        setSurface(emptySurface);
        clearStoredLastSessionId(vaultIdRef.current, harnessRef.current);
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
          // Archiving hides the row from the working view. The archived views
          // keep it, greyed: they exist so the chat can be found and restored.
          // Hermes keeps every message either way.
          .filter(
            (s) =>
              !(
                patch.archived === true &&
                s.id === id &&
                archivedViewRef.current === "hide"
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
          writeStoredLastSessionId(vaultIdRef.current, harnessRef.current, neighbor);
          // A pinned chat may be the neighbour without ever having been opened
          // this run (it is a tab because of the pin), so its transcript has to
          // be read here the way closing a tab reads its neighbour's.
          if (!(runs[neighbor] ?? EMPTY_RUN).messagesLoaded) void loadMessages(neighbor);
        } else {
          setSurface("thread");
          clearStoredLastSessionId(vaultIdRef.current, harnessRef.current);
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
  /**
   * A turn that never got its stream. The transport failing is not the same as
   * the agent finishing: the turn reads as failed and says so, rather than
   * settling as a completed turn with no reply and a red box underneath.
   */
  const failTurn = useCallback(
    (id: string, message: string) => {
      updateRun(id, (current) => {
        const live = liveTurnOf(current);
        const turns = live
          ? replaceTurn(
              current.turns,
              live.turnId,
              applyTurnEvent(live, { type: "error", message }, capabilitiesRef.current),
            )
          : current.turns;
        return { ...current, turns, error: message };
      });
    },
    [updateRun],
  );

  const sendMessageRef = useRef<(id: string, text: string) => Promise<void>>(async () => {});
  const settleTurnRef = useRef<(id: string) => void>(() => {});
  const sendMessage = useCallback(
    async (id: string, text: string): Promise<void> => {
      const content = text.trim();
      const attached = attachments[id] ?? [];
      const receipt = receipts[id] ?? null;
      if ((!content && attached.length === 0 && !receipt) || !id) return;
      const run = runs[id] ?? EMPTY_RUN;
      if (run.sending) return;
      // The agent whose store this turn's chat lives in, as of the send. The turn
      // is not cancelled by a switch (it is already running in that agent), but
      // its settle must not write the old agent's list over the new one's.
      const turnEpoch = listEpoch.current;
      // The same for the vault: a vault switch clears the store this turn was
      // opened in, so its settle must not put a run back for a chat the new
      // vault does not have.
      const turnVault = vaultEpoch.current;

      const page = pageContext.on ? readPageContext(pageContext.route) : null;
      const automationContext = automationContexts.current.get(id);
      const pick = runtimePinsRef.current[id] ?? {};

      const sentAt = Date.now();
      // The turn is opened here, with the operator's own words in it, so the
      // bubble is visible before the first frame lands and a chat switched away
      // from still shows what was asked. `run.started` adopts this turn and gives
      // it the harness's run id.
      const turn = openTurn({
        sessionId: id,
        ...(harnessRef.current ? { harness: harnessRef.current } : {}),
        at: sentAt,
        user: {
          text: content,
          at: sentAt,
          ...(receipt ? { receipt: { name: receipt.name, size: receipt.size } } : {}),
        },
      });
      updateRun(id, (current) => ({
        ...current,
        // A newer turn folds any turn the app had closed on its own guess: the
        // guess is done, and the work log it kept visible can fold now.
        turns: [
          ...current.turns.map((row) =>
            row.provisional ? { ...row, provisional: false } : row,
          ),
          turn,
        ],
        liveTurnId: turn.turnId,
        sending: true,
        error: null,
        runId: null,
        approval: null,
      }));
      setReceiptFor(id, null);
      setAttachmentsFor(id, []);
      setSessions((prev) =>
        prev
          .map((s) => {
            if (s.id !== id) return s;
            const preview = content || receipt?.name || attached[0]?.name || "";
            return {
              ...s,
              preview: s.preview?.trim() ? s.preview : preview,
              lastActive: Date.now() / 1000,
            };
          })
          .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
      );

      // Whether this turn ended without a clean completion. A failed or lost
      // stream can still have left the answer on the companion's side, so the
      // finally below reads the transcript back when this is true.
      let failed = false;
      try {
        const result = await api().companionChatStream({
          sessionId: id,
          input: content,
          instructionsContext: {
            domainName: activeDomain?.meta.name ?? null,
            domainSlug: activeDomain?.slug ?? null,
            viewingBoard: boardSlug,
            viewingBoardLocked: boardLocked,
            ...(contextCardsRef.current.length > 0
              ? { focusedCards: contextCardsRef.current.map(focusedCardOf) }
              : {}),
            ...(page ? { pageContext: page } : {}),
            ...(automationContext ? { automationContext } : {}),
            // The interview's state rides every turn while it is unfinished:
            // the companion offers it, continues it and revises the proposal
            // from here, and knows when a card is already in front of the
            // operator. Absent once complete, so no later turn re-offers a
            // finished interview.
            onboarding:
              snapshot?.onboarding &&
              snapshot.onboarding.status !== "completed"
                ? {
                    status: snapshot.onboarding.status,
                    proposalPending: snapshot.onboardingProposal !== null,
                  }
                : null,
            aboutMe: snapshot?.map?.aboutMe ?? "",
            locked: false,
            vaultOpen: Boolean(snapshot),
          },
          runtime: pick,
          receiptRelPath: receipt?.relPath ?? null,
          attachments: attached.map(({ id, kind, name, mime, size }) => ({
            id,
            kind,
            name,
            mime,
            size,
          })),
        });
        if ("ok" in result && result.ok === false) {
          failed = true;
          if (turnVault === vaultEpoch.current) failTurn(id, result.error);
        }
      } catch (err) {
        failed = true;
        if (turnVault === vaultEpoch.current) {
          failTurn(id, err instanceof Error ? err.message : "Failed to reach Hermes");
        }
      } finally {
        // The vault moved while this turn's transport was out: the store it
        // painted into is gone (the vault reset cleared it), and every write in
        // this block — the settle, the repair read, the refresh, the list —
        // belongs to the other vault. The turn was stopped by the reset.
        if (turnVault !== vaultEpoch.current) return;
        // THE TURN IS SETTLED FIRST, BEFORE ANYTHING THAT CAN WAIT.
        //
        // `sending` is the composer's lock and the rail's dot. The stream's
        // terminal frame normally clears it, but a transport that settles
        // without one (the gateway wedged mid-turn, the connection was cut) has
        // nobody else to do it. Settling it after the list read below is what
        // used to leave a finished turn pulsing as running for as long as the
        // read took — and forever, when the read waited on a companion that was
        // not answering. The refresh is a nicety; the settle is the promise.
        settleTurnRef.current(id);
        if (failed) {
          // Repair what the operator can see: a turn that failed its transport
          // may still have written its reply down. The forced read is skipped
          // by the provider when a queued message has already opened the next
          // turn in this chat.
          void loadMessages(id, true);
        }
        void refresh();
        // The list this turn's chat lives in is only re-read if the operator is
        // still on that agent. After a switch the new agent's own list is the
        // one on screen, and writing this answer over it would hand the new
        // agent's rail the old agent's chats. A read that fails is not an error
        // to paint here: the turn is settled, and the rail keeps its rows.
        try {
          if (turnEpoch === listEpoch.current) {
            const listed = await api().companionSessionsList();
            if (listed.ok && turnEpoch === listEpoch.current) {
              const owner = harnessRef.current;
              if (owner) {
                for (const session of listed.value) {
                  agentOfSession.current.set(session.id, owner);
                }
              }
              setSessions(listed.value);
            }
          }
        } catch {
          // The rail keeps the rows it already has.
        }
      }
    },
    [
      activeDomain,
      boardLocked,
      boardSlug,
      pageContext,
      attachments,
      failTurn,
      receipts,
      loadMessages,
      refresh,
      setAttachmentsFor,
      setReceiptFor,
      snapshot,
      updateRun,
      runs,
    ],
  );

  /**
   * Inject guidance into the turn that is already running.
   *
   * A steer is not another turn: the gateway folds the text into the live run,
   * so the reply continues in the same bubble stream. The bubble is still
   * recorded locally because the operator must see what they changed the agent's
   * course with.
   */
  const steerMessage = useCallback(
    async (id: string, text: string): Promise<boolean> => {
      const content = text.trim();
      if (!content || !id) return false;
      const run = runs[id] ?? EMPTY_RUN;
      if (!run.sending || !run.runId) {
        updateRun(id, (current) => ({
          ...current,
          error: "There is no live turn to steer",
        }));
        return false;
      }
      try {
        const result = await api().companionRunSteer(run.runId, content);
        if (!result.ok) {
          updateRun(id, (current) => ({ ...current, error: result.error }));
          return false;
        }
        updateRun(id, (current) => {
          const live = liveTurnOf(current);
          if (!live) return current;
          return {
            ...current,
            turns: replaceTurn(current.turns, live.turnId, {
              ...live,
              steers: [
                ...(live.steers ?? []),
                { text: content, at: Date.now(), steer: true },
              ],
            }),
          };
        });
        return true;
      } catch (err) {
        updateRun(id, (current) => ({
          ...current,
          error: err instanceof Error ? err.message : "Failed to steer Hermes",
        }));
        return false;
      }
    },
    [runs, updateRun],
  );

  const queuedMessages = useCallback(
    (id: string | null | undefined) => (id ? queues[id] ?? [] : []),
    [queues],
  );

  const queueMessage = useCallback((id: string, text: string) => {
    const content = text.trim();
    if (!id || !content) return;
    const queued: QueuedMessage = { id: nextId(), text: content, at: Date.now() };
    setQueues((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), queued] }));
  }, []);

  const removeQueued = useCallback((id: string, queuedId: string) => {
    setQueues((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const next = current.filter((queued) => queued.id !== queuedId);
      if (next.length === current.length) return prev;
      return { ...prev, [id]: next };
    });
  }, []);

  /**
   * Send the head of one chat's queue, but only when that chat is idle.
   *
   * The head is removed before the request goes out. A failed turn keeps the
   * operator's text rather than silently losing it: it is put back at the front
   * of the queue, and the next settled turn tries it again.
   *
   * A drain in flight claims its head by id, so a second settle frame cannot
   * send the same entry twice, and the chat is marked busy before the turn
   * starts so a third settle cannot overtake it.
   */
  const drainQueue = useCallback(
    async (id: string): Promise<void> => {
      // Queued text belongs to the chat that queued it, and a chat belongs to the
      // agent that made it. Switching agent must not hand the old agent's queued
      // turn to the new one's channel.
      if (!ownsSession(id)) return;
      // The chat belonged to the vault that was open when it was queued. Its
      // queue was cleared by the vault reset; this closes the window in which a
      // settle frame from the stopped run could still ask for a drain.
      if (
        retiredSessions.current.has(id) &&
        !sessionsRef.current.some((session) => session.id === id)
      ) {
        return;
      }
      if (draining.current.has(id)) return;
      // A turn that is still sending owns the composer: the queue waits for its
      // terminal frame rather than racing it.
      if ((runs[id] ?? EMPTY_RUN).sending) return;
      const head = queues[id]?.[0];
      if (!head) return;
      draining.current.add(id);
      setQueues((prev) => {
        const current = prev[id];
        if (!current || current[0]?.id !== head.id) return prev;
        return { ...prev, [id]: current.slice(1) };
      });
      try {
        await sendMessageRef.current(id, head.text);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send queued message";
        updateRun(id, (current) => ({ ...current, error: message }));
        setQueues((prev) => {
          const current = prev[id] ?? [];
          if (current.some((queued) => queued.id === head.id)) return prev;
          return { ...prev, [id]: [head, ...current] };
        });
      } finally {
        draining.current.delete(id);
      }
    },
    [queues, runs, updateRun, ownsSession],
  );

  // The drain and the turn reach each other through refs, so neither callback's
  // initializer has to name the other.
  sendMessageRef.current = sendMessage;

  /**
   * Drain a queue once a turn has settled.
   *
   * The terminal stream frame normally does this. This fallback covers a turn
   * whose transport ended without a terminal frame: the composer was reopened,
   * so the queue must not sit there until the next unrelated frame arrives.
   */
  const settleTurn = useCallback(
    (id: string) => {
      updateRun(id, (current) => {
        if (!current.sending && !current.liveTurnId) return current;
        const live = liveTurnOf(current);
        // The transport closed without a terminal frame. The renderer cannot
        // know why, so it closes the turn it opened rather than leaving a
        // spinner forever; a terminal frame that arrives after this one still
        // says what actually happened (the reducer lets it correct the status).
        const turns =
          live && live.status === "running"
            ? replaceTurn(current.turns, live.turnId, settleProvisionally(live))
            : current.turns;
        return {
          ...current,
          turns,
          liveTurnId: null,
          sending: false,
          runId: null,
        };
      });
      void drainQueue(id);
    },
    [drainQueue, updateRun],
  );

  settleTurnRef.current = settleTurn;

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

  const setTurnFoldOpen = useCallback(
    (id: string, turnId: string, open: boolean) => {
      updateRun(id, (current) => {
        const turn = current.turns.find((row) => row.turnId === turnId);
        if (!turn || turn.foldOpen === open) return current;
        return {
          ...current,
          turns: replaceTurn(current.turns, turnId, { ...turn, foldOpen: open }),
        };
      });
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
      // A frame for a chat the previous vault owned. Stopping a run is not
      // instantaneous, so its last frames still arrive after the reset; they
      // must not grow a run or a tab in this vault. Once the new list carries
      // the id — the operator switched back to the vault it belongs to — the
      // frame is that vault's own and lands normally.
      if (
        retiredSessions.current.has(id) &&
        !sessionsRef.current.some((session) => session.id === id)
      ) {
        return;
      }
      const isActive = () => activeIdRef.current === id;
      // A frame for a chat belonging to the agent the operator has switched
      // away from still lands in that chat's run — the turn is not cancelled by
      // looking elsewhere — but it must not grow a tab in the strip of the agent
      // now in front, nor clear a closed-tab mark there.
      const onThisAgent = ownsSession(id);

      if (evt.type === "run.started") {
        // A new turn is a new reason to show the chat: a tab the operator closed
        // after the last run belongs to that run, not to this one. (The marks
        // exist only to keep the frames still on the wire from resurrecting it.)
        if (onThisAgent) {
          closedTabs.current.delete(id);
          ensureTab(id);
        }
        const runId = evt.runId || null;
        updateRun(id, (current) => {
          const pending = liveTurnOf(current);
          if (pending) {
            // Adopt the turn `sendMessage` opened: the harness has now named the
            // run and owns its identity. The user text is already in it.
            const adopted: TurnRecord = {
              ...pending,
              turnId: runId ?? pending.turnId,
              ...(runId ? { runId } : {}),
            };
            return {
              ...current,
              turns: replaceTurn(current.turns, pending.turnId, adopted),
              liveTurnId: adopted.turnId,
              runId,
              sending: true,
              error: null,
              approval: null,
            };
          }
          // A turn nobody here typed: a scheduled automation. It has no user
          // text, so its timeline starts with the work log.
          const opened = openTurn({
            sessionId: id,
            ...(runId ? { turnId: runId } : {}),
            ...(harnessRef.current ? { harness: harnessRef.current } : {}),
          });
          return {
            ...current,
            turns: [...current.turns, opened],
            liveTurnId: opened.turnId,
            runId,
            sending: true,
            error: null,
            approval: null,
          };
        });
        if (isActive()) setLivePinIds(contextCardsRef.current.map((card) => card.pin.id));
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

      const terminal =
        evt.type === "run.completed" ||
        evt.type === "run.stopped" ||
        evt.type === "run.incomplete" ||
        evt.type === "error";
      const appNote =
        evt.type === "decisions.filed" || evt.type === "decisions.problem";

      updateRun(id, (current) => {
        const live = liveTurnOf(current);
        // A terminal or an app note can trail the turn's own end through IPC, so
        // when nothing is live it still lands on the newest turn instead of
        // opening a phantom one. Content without a send is the one case where a
        // turn has to be created: the frame is evidence something ran.
        let target: TurnRecord | null = live;
        let turns = current.turns;
        if (!target && (terminal || appNote)) target = lastTurnOf(current);
        if (!target) {
          const opened = openTurn({
            sessionId: id,
            ...(harnessRef.current ? { harness: harnessRef.current } : {}),
          });
          turns = [...turns, opened];
          target = opened;
        }
        const next = applyTurnEvent(target, evt, capabilitiesRef.current);
        if (next === target) return current;
        return { ...current, turns: replaceTurn(turns, target.turnId, next) };
      });

      if (!terminal) return;
      closedTabs.current.delete(id);
      if (isActive()) setLivePinIds([]);
      updateRun(id, (current) => {
        const live = liveTurnOf(current);
        const error =
          evt.type === "error" ? evt.message : current.error;
        return {
          ...current,
          sending: false,
          runId: null,
          // Only the turn that was live stops being live; a late terminal for a
          // previous run must not steal the marker from a newer one.
          liveTurnId:
            live && current.liveTurnId === live.turnId ? null : current.liveTurnId,
          error,
        };
      });
      if (evt.type === "run.completed") void refresh();
      void drainQueue(id);
    });
    return off;
  }, [drainQueue, ensureTab, ownsSession, refresh, setLivePinIds, updateRun]);

  /**
   * The dock's landing is the provider's to arrange: the sidebar lists chats
   * from the first paint, but which chat the dock opens is still the last one
   * the operator left.
   */
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  /**
   * Remember the strip for the agent in front, for the next run.
   *
   * Written here rather than from each gesture so every path that changes the
   * strip is covered — opening, navigating, splitting, closing, deleting,
   * archiving, a run opening a tab of its own. The pair is written together: an
   * active id naming a tab the strip does not carry is not a memory to restore,
   * it is a landing into nothing. Held off until the first landing has read the
   * profile (`tabsHydrated`), because the mount before it has no tabs yet. The
   * key carries the agent, so the strip a switch leaves behind is written by the
   * switch itself (before this store moves on) and never overwrites the other
   * agent's.
   */
  useEffect(() => {
    if (!tabsHydrated.current) return;
    // A landing is still deciding what this agent's strip is. Writing the seed
    // it started from would persist an empty strip over the memory it is about
    // to restore (and a mid-landing tab would be written under a strip the
    // landing is about to replace).
    if (landingFor.current) return;
    writeStoredChatTabs(vaultIdRef.current, harnessRef.current, openTabs, activeId);
    if (activeId) writeStoredLastSessionId(vaultIdRef.current, harnessRef.current, activeId);
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
      for (const urls of attachmentPreviews.current.values()) {
        for (const url of urls) URL.revokeObjectURL(url);
      }
      attachmentPreviews.current.clear();
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
      attachmentsOf,
      setAttachmentsFor,
      addAttachmentFor,
      removeAttachmentFor,
      runtimePins,
      updateRuntimePick,
      archivedView,
      setArchivedView,
      loadSessions,
      openChat,
      openChatInNewTab,
      resumeLast,
      newChat,
      closeTab,
      patchSession,
      deleteChat,
      sendMessage,
      steerMessage,
      queueMessage,
      queuedMessages,
      removeQueued,
      drainQueue,
      stopRun,
      approve,
      dismissError,
      reportError,
      setErrorFor,
      setTurnFoldOpen,
      setAutomationContext,
    }),
    [
      approve,
      addAttachmentFor,
      attachmentsOf,
      activeId,
      activeSession,
      closeTab,
      deleteChat,
      dismissError,
      drainQueue,
      draftOf,
      reportError,
      listError,
      loadSessions,
      queueMessage,
      queuedMessages,
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
      setArchivedView,
      archivedView,
      setAutomationContext,
      setDraftFor,
      reportError,
      removeAttachmentFor,
      removeQueued,
      setErrorFor,
      setAttachmentsFor,
      setReceiptFor,
      setTurnFoldOpen,
      steerMessage,
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
