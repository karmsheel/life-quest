import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  ImagePlus,
  MoreVertical,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Radio,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import type { SignalRecord } from "@lifequest/vault-core/pure";
import { api } from "@/lib/ipc";
import { signalStampWhen, signalVisible } from "@/lib/signal-chain";
import { summarizeToolRun, toolRowLabel, type ToolCall } from "@/lib/tool-run";
import { onComposerKeyDown } from "@/components/signal-chain/SignalChainFeed";
import { ComposerModelControls } from "@/components/hermes/ComposerModelControls";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { useConfirm } from "@/components/ui/useConfirm";
import { useChatDock } from "@/state/ChatDockProvider";
import { useVault } from "@/state/VaultProvider";
import type {
  ChatStreamEvent,
  CompanionModelCatalog,
  CompanionRuntimeOverride,
  HermesSession,
} from "@/vite-env";
import {
  formatSessionWhen,
  sessionLabel,
} from "../../../electron/companion-client.ts";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The receipt this turn carried, as the thread remembers it after sending. */
  receipt?: { name: string; size: number };
};

/** Bytes as the chip says them: 287 B, 41 KB, 1.2 MB. */
function formatReceiptSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const LAST_SESSION_KEY = "lifequest.companion.lastSessionId";
/**
 * The composer's model / thinking pick, **per chat**. Hermes Desktop keeps the
 * choice on the chat's own view state (`view.$model`, `view.$reasoningEffort`)
 * rather than on the client, so the pins are keyed by session id here too: a
 * chat comes back on the model it was left on, and a new chat opens unpinned.
 *
 * The turn still carries the pin — that is the transport's only path. The
 * gateway's own `POST /api/sessions/{id}/model` lock is write-only (no unpin
 * route, and `model_config` never crosses the client API), and Desktop does not
 * call it either.
 */
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

/** Every chat's pin, keyed by session id; an empty pin is not remembered. */
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

/** One shared empty pin, so an unpinned chat keeps a stable identity. */
const NO_RUNTIME_PICK: CompanionRuntimeOverride = {};

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
  const { snapshot, refresh, reloadGeneration, lens } = useVault();
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
   * The receipt waiting to ride the next turn. Main keeps the original and the
   * copy it built for the model, so what lives here is a name to show and the
   * path to name on the turn — the bytes never come back through the bridge.
   */
  const [receipt, setReceipt] = useState<{
    relPath: string;
    name: string;
    size: number;
    previewUrl: string;
  } | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  /** The live thumbnail URL, held in a ref so it can always be released. */
  const receiptPreviewRef = useRef<string | null>(null);

  /** Replace (or drop) the pending receipt, releasing the old thumbnail. */
  const putReceipt = useCallback(
    (next: { relPath: string; name: string; size: number; previewUrl: string } | null) => {
      if (receiptPreviewRef.current) {
        URL.revokeObjectURL(receiptPreviewRef.current);
        receiptPreviewRef.current = null;
      }
      if (next) receiptPreviewRef.current = next.previewUrl;
      setReceipt(next);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (receiptPreviewRef.current) URL.revokeObjectURL(receiptPreviewRef.current);
    };
  }, []);

  /**
   * Take one image from the composer. Main stores the original and answers with
   * the path the turn has to cite — the bytes are never handed back, so the
   * thumbnail is made here from the operator's own file.
   *
   * One receipt at a time: a second attach replaces the first, and a refusal
   * from main leaves the previous one exactly where it was.
   */
  async function attachReceipt(file: File) {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await api().receiptAttach({
        bytes,
        mime: file.type,
        name: file.name,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      putReceipt({
        relPath: result.value.relPath,
        name: result.value.name,
        size: result.value.size,
        previewUrl: URL.createObjectURL(file),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach that receipt");
    }
  }

  /** The first image in a drop or a paste, if the gesture carried one. */
  function imageFrom(files: FileList | null): File | null {
    if (!files) return null;
    for (const file of Array.from(files)) {
      if (file.type === "image/png" || file.type === "image/jpeg") return file;
    }
    return null;
  }
  /**
   * The composer's model and thinking pills. The catalog is the gateway's own
   * inventory for this profile, so the menu cannot offer a model the gateway
   * cannot route; the pick is the *chat's*, remembered across launches so a
   * thread comes back on the model it was left on.
   */
  const [modelCatalog, setModelCatalog] = useState<CompanionModelCatalog | null>(null);
  const [runtimePins, setRuntimePins] = useState<Record<string, CompanionRuntimeOverride>>(() =>
    readStoredRuntimePins(),
  );
  const runtimePick = (sessionId && runtimePins[sessionId]) || NO_RUNTIME_PICK;
  /**
   * Which of the dock's three surfaces is up. The list is a real page now — with
   * twenty chats an 11rem strip was not navigable — and a thread replaces it
   * once a chat is opened. The chain is the third, swapped in from the bottom
   * bar: the same vault records the Life-Chain page reads, so the two surfaces
   * are one chain seen twice, not two chains.
   */
  const [view, setView] = useState<"list" | "thread" | "chain">("thread");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /**
   * The list's own row UI: the row the 3-dot menu is open on, and the row being
   * renamed in place. One row at a time, the same rule the chain's rows follow.
   * `renameDraft` is shared with the thread header's rename because the two
   * fields never coexist — one lives in the list, the other in the thread.
   */
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  /**
   * The dock's questions — a chat delete, a signal delete — are asked in the
   * app's own dialog, and gated on the dock being open: a question asked from
   * the list cannot float over the window once the panel is collapsed.
   */
  const { ask, dialog } = useConfirm(open);
  /** Drives the inline control: the arrow needs text, the stop square needs a run. */
  const sendable = draft.trim().length > 0 || receipt !== null;
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
  /** The chain's records, as the vault returned them: newest first. */
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [signalsLoaded, setSignalsLoaded] = useState(false);
  const [chainDraft, setChainDraft] = useState("");
  const [chainBusy, setChainBusy] = useState(false);
  const chainBusyRef = useRef(false);
  /**
   * The row the 3-dot menu is open on, the row being edited, and the signal
   * being written to. One row at a time, for all three: two editors open in a
   * 20rem column is not a state worth supporting.
   */
  const [signalMenuId, setSignalMenuId] = useState<string | null>(null);
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null);
  const [signalDraft, setSignalDraft] = useState("");
  const [signalBusyId, setSignalBusyId] = useState<string | null>(null);
  /** The same two-state rule as the chat field: the arrow needs some text. */
  const chainSendable = chainDraft.trim().length > 0;
  const chainControlVisible = chainBusy || chainSendable;
  const listRef = useRef<HTMLDivElement | null>(null);
  const activityRef = useRef<HTMLUListElement | null>(null);
  /** The chain's own scroller: the view follows the newest signal. */
  const chainRef = useRef<HTMLDivElement | null>(null);
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
   * The chain, lensed the way the Life-Chain page lenses it: everything in
   * Overview, and unassigned plus the open domain in a domain tab. Logging here
   * files a signal unassigned, so what the panel writes is never hidden from it.
   */
  const visibleSignals = useMemo(
    () => signals.filter((s) => signalVisible(lens, s.domainSlug)),
    [signals, lens],
  );
  /**
   * Rendered oldest first, which is the order the list paints in: the chain
   * reads like a chat — oldest at the top, the newest just above the composer —
   * and the stack still rests there, growing upward, while it fits. The vault
   * hands records back newest first, hence the flip.
   */
  const chainItems = useMemo(() => visibleSignals.slice().reverse(), [visibleSignals]);
  /** What a signal can be assigned to: live domains, as the picker offers them. */
  const domainNames = (snapshot?.domains ?? [])
    .filter((d) => !d.meta.archivedAt)
    .map((d) => ({
      slug: d.slug,
      name: d.meta.name,
    }));

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
  }, [draft, chainDraft, open, view, syncComposerHeight]);

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
    // behind, so it goes with it. The pending receipt is part of that: it was
    // attached to the chat being left, and its original stays in the vault.
    putReceipt(null);
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
  }, [putReceipt]);

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

  /** Read the chain — the same call the Life-Chain page makes. */
  const loadChain = useCallback(async () => {
    try {
      const result = await api().signalChainList();
      if (!result.ok) {
        setError(result.error);
        setSignals([]);
        return;
      }
      setSignals(result.value.records);
      setSignalsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach the chain");
      setSignals([]);
    }
  }, []);

  /**
   * Read it on landing on the chain, and again whenever the vault reloads: a
   * signal filed on the Life-Chain page, or written by Hermes, shows up here
   * without reopening the panel. Nothing else clears the error banner, so a
   * failed read keeps its message until the next successful one.
   *
   * Landing also drops any row UI: a menu or an editor left open on a row that
   * has since moved is worse than making the user open it again.
   */
  useEffect(() => {
    if (!open || view !== "chain") return;
    setSignalMenuId(null);
    setEditingSignalId(null);
    setSignalDraft("");
    void loadChain();
  }, [open, view, loadChain, reloadGeneration]);

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

  /**
   * Leaving the list drops its row UI: a menu, or a rename field, left open on a
   * row that has since moved is worse than making the user open it again — the
   * same rule the chain's landing reset follows.
   */
  useEffect(() => {
    if (view === "list") return;
    setSessionMenuId(null);
    setRenamingSessionId(null);
    setRenameDraft("");
  }, [view]);

  useEffect(() => {
    if (!open || view !== "thread" || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
    // The disclosure scrolls inside the transcript, so it takes the same pass:
    // the block is capped, and a capped block left at its first row would hide
    // the calls the operator opened it to watch arrive. `toolsOpen` is in the
    // deps because opening it mounts a fresh list at scrollTop 0.
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight;
  }, [open, view, messages, sending, error, turnNote, tools, toolsOpen]);

  /**
   * The chain's own stick-to-the-bottom pass, in a layout effect so a freshly
   * swapped-in chain never paints its oldest entries first. The newest signal is
   * the last row and the composer is right below it: without this, a chain
   * longer than the panel would open on the oldest, and a signal you just logged
   * would land below the fold.
   */
  useLayoutEffect(() => {
    if (!open || view !== "chain" || !chainRef.current) return;
    chainRef.current.scrollTop = chainRef.current.scrollHeight;
  }, [open, view, chainItems, chainBusy]);

  useEffect(() => {
    if (open && view !== "list") inputRef.current?.focus();
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

  /**
   * Read the model inventory once, when the dock is first opened.
   *
   * Failure is silent and deliberate: a companion that is not up yet, or a
   * profile with no providers configured, leaves the catalog null — and a null
   * catalog means the control row is simply absent, so the composer is exactly
   * what it was before the pills existed.
   */
  useEffect(() => {
    if (!open || modelCatalog) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api().companionModelOptions();
        if (cancelled || !result.ok) return;
        setModelCatalog(result.value);
      } catch {
        // No catalog, no row.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, modelCatalog]);

  /** Pin this chat — or, with every field cleared, un-pin it back to the default. */
  function updateRuntimePick(next: CompanionRuntimeOverride) {
    const activeId = sessionId;
    if (!activeId) return;
    const pick = cleanRuntimePick(next);
    setRuntimePins((prev) => {
      const pins = { ...prev };
      if (Object.keys(pick).length > 0) pins[activeId] = pick;
      else delete pins[activeId];
      writeStoredRuntimePins(pins);
      return pins;
    });
  }

  async function sendMessage(text: string, overrideSessionId?: string) {
    const content = text.trim();
    const activeId = overrideSessionId ?? sessionId;
    // A receipt can carry the turn on its own: the operator photographs a
    // receipt and sends it without typing anything.
    const attached = receipt;
    if ((!content && !attached) || sending || !activeId) return;

    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "user",
        content,
        ...(attached ? { receipt: { name: attached.name, size: attached.size } } : {}),
      },
    ]);
    // The path goes with the turn and the chip goes away. Main took the copy out
    // of its slot, so the receipt now lives on the row the agent writes.
    putReceipt(null);
    setSessions((prev) =>
      prev
        .map((s) => {
          if (s.id !== activeId) return s;
          const preview = content || attached?.name || "";
          return {
            ...s,
            preview: s.preview?.trim() ? s.preview : preview,
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
          // What the operator is looking at: the home board's domain, null on
          // Overview. This anchors "the Dashboard" in the agent's instructions.
          viewingBoard: lens.kind === "domain" ? lens.slug : null,
          aboutMe: snapshot?.map?.aboutMe ?? "",
          locked: false,
          vaultOpen: Boolean(snapshot),
        },
        // The composer's pills, if the operator has picked anything: absent
        // fields leave the turn on the gateway's own defaults.
        runtime: runtimePick,
        // The receipt waiting in main for this turn. Absent means a text turn.
        receiptRelPath: attached?.relPath ?? null,
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

  /**
   * Log one signal through the same call the page makes. It files `thought` with
   * no title and no domain — the chain is for capture, and the type/title/domain
   * calls belong on the page, where there is room to make them. Unassigned also
   * means the record stays visible in every lens, including this one.
   */
  async function onChainSubmit(e: FormEvent) {
    e.preventDefault();
    const body = chainDraft.trim();
    if (!body || chainBusyRef.current) return;
    chainBusyRef.current = true;
    setChainBusy(true);
    setError(null);
    try {
      const result = await api().signalChainCreate({
        type: "thought",
        title: null,
        body,
        domainSlug: null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChainDraft("");
      await loadChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log the signal");
    } finally {
      chainBusyRef.current = false;
      setChainBusy(false);
    }
  }

  /** Open the 3-dot menu on a row, or close the one already open. */
  function toggleSignalMenu(id: string) {
    setSignalMenuId((current) => (current === id ? null : id));
  }

  /** Edit starts from what the signal says now, so a no-op save is a no-op. */
  function startEditSignal(s: SignalRecord) {
    setSignalMenuId(null);
    setEditingSignalId(s.id);
    setSignalDraft(s.body);
  }

  function cancelEditSignal() {
    setEditingSignalId(null);
    setSignalDraft("");
  }

  /**
   * The row's own writes: assign, edit, delete. They go through the same vault
   * calls the Life-Chain page makes, so both surfaces write one chain, and they
   * take the composer's write lock — one chain write at a time, whichever
   * control asked for it.
   */
  async function onAssignSignal(id: string, nextDomain: string | null) {
    const current = signals.find((s) => s.id === id)?.domainSlug ?? null;
    if (current === nextDomain || chainBusyRef.current) return;
    chainBusyRef.current = true;
    setSignalBusyId(id);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, { domainSlug: nextDomain });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await loadChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign the signal");
    } finally {
      chainBusyRef.current = false;
      setSignalBusyId(null);
    }
  }

  async function onSaveSignal(id: string) {
    const body = signalDraft.trim();
    if (!body || chainBusyRef.current) return;
    chainBusyRef.current = true;
    setSignalBusyId(id);
    setError(null);
    try {
      const result = await api().signalChainUpdate(id, { body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      cancelEditSignal();
      await loadChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the signal");
    } finally {
      chainBusyRef.current = false;
      setSignalBusyId(null);
    }
  }

  /** Ask first: the signal leaves the chain, the row goes, and the record stays. */
  function onDeleteSignal(id: string) {
    setSignalMenuId(null);
    ask({
      title: "Delete signal",
      message: "The signal is hidden from the chain. Its record and messages stay in the vault.",
      confirmLabel: "Delete signal",
      destructive: true,
      run: () => void runDeleteSignal(id),
    });
  }

  async function runDeleteSignal(id: string) {
    if (chainBusyRef.current) return;
    chainBusyRef.current = true;
    setSignalBusyId(id);
    setError(null);
    try {
      const result = await api().signalChainDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editingSignalId === id) cancelEditSignal();
      setSignalMenuId(null);
      await loadChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the signal");
    } finally {
      chainBusyRef.current = false;
      setSignalBusyId(null);
    }
  }

  /**
   * The domains a signal can be assigned to: the live ones, plus the one it
   * already names when that domain has since been archived — the page makes the
   * same exception, so an archived assignment is shown rather than silently
   * dropped the moment this panel renders it.
   */
  function assignOptions(s: SignalRecord) {
    const options = domainNames.slice();
    if (s.domainSlug && !options.some((d) => d.slug === s.domainSlug)) {
      options.push({ slug: s.domainSlug, name: s.domainSlug });
    }
    return options;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending || (!draft.trim() && !receipt)) return;
    const text = draft.trim();
    setDraft("");
    await sendMessage(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sending || (!draft.trim() && !receipt)) return;
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

  /** Open the 3-dot menu on a chat row, or close the one already open. */
  function toggleSessionMenu(id: string) {
    setSessionMenuId((current) => (current === id ? null : id));
  }

  /**
   * Rename starts on the row, not in the thread header: the list is where chats
   * are managed, and the name it edits is the name the row shows.
   */
  function startSessionRename(s: HermesSession) {
    setSessionMenuId(null);
    setRenamingSessionId(s.id);
    setRenameDraft(sessionLabel(s));
  }

  function cancelSessionRename() {
    setRenamingSessionId(null);
    setRenameDraft("");
  }

  async function commitSessionRename(e: FormEvent, id: string) {
    e.preventDefault();
    const title = renameDraft.trim();
    cancelSessionRename();
    await patchSession(id, { title });
  }

  /**
   * Delete one chat outright. Unlike archive — a flag Hermes Desktop can bring
   * the chat back from — this drops the row and every message under it, so it
   * asks first, through the dock's own dialog. The row menu closes on the way in:
   * the question is the surface now, and it names the chat it will take.
   */
  function deleteSession(id: string) {
    const row = sessions.find((s) => s.id === id);
    const label = row ? sessionLabel(row) : "this chat";
    setSessionMenuId(null);
    ask({
      title: "Delete chat",
      message: `Delete "${label}"? Its messages leave Hermes everywhere, and this cannot be undone.`,
      confirmLabel: "Delete chat",
      destructive: true,
      run: () => void runDeleteSession(id),
    });
  }

  async function runDeleteSession(id: string) {
    const result = await api().companionSessionDelete(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // The pin belonged to the chat: a deleted chat takes its pin with it.
    setRuntimePins((prev) => {
      if (!(id in prev)) return prev;
      const pins = { ...prev };
      delete pins[id];
      writeStoredRuntimePins(pins);
      return pins;
    });
    // The open chat cannot outlive its own row: fall back to the list rather
    // than showing a thread for a chat that no longer exists.
    if (id === sessionId) {
      setSessionId(null);
      setMessages([]);
      window.localStorage.removeItem(LAST_SESSION_KEY);
      setView("list");
    }
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

  /**
   * One signal: its stamp on the rail, the message beside it, and the
   * assignment picker under the message. Two blocks and a picker — the date
   * box is the only thing that repeats down the column, so it is what the
   * dashed thread runs through.
   */
  function signalRow(s: SignalRecord) {
    const when = signalStampWhen(s.createdAt);
    const editing = editingSignalId === s.id;
    const menuOpen = signalMenuId === s.id;
    const busy = signalBusyId === s.id;
    return (
      <li key={s.id} className="chat-panel__chain-item">
        <div className="chat-panel__chain-rail">
          <time className="chat-panel__chain-stamp" dateTime={s.createdAt}>
            <span className="chat-panel__chain-stamp-day">{when.day}</span>
            <span className="chat-panel__chain-stamp-time">{when.time}</span>
          </time>
        </div>
        <div className="chat-panel__chain-message">
          {s.title ? (
            <h3 className="chat-panel__chain-title">{s.title}</h3>
          ) : null}
          {editing ? (
            <form
              className="chat-panel__chain-edit"
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveSignal(s.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                cancelEditSignal();
              }}
            >
              <textarea
                className="chat-panel__chain-edit-input"
                aria-label="Edit signal"
                value={signalDraft}
                rows={3}
                autoFocus
                onChange={(e) => setSignalDraft(e.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <div className="chat-panel__chain-edit-actions">
                <button
                  type="submit"
                  className="chat-panel__text-btn"
                  disabled={busy || signalDraft.trim().length === 0}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="chat-panel__text-btn"
                  disabled={busy}
                  onClick={cancelEditSignal}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="chat-panel__chain-body">{s.body}</p>
              <button
                type="button"
                className="chat-panel__chain-menu-btn"
                aria-label="Signal actions"
                title="Signal actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => toggleSignalMenu(s.id)}
              >
                <MoreVertical size={14} aria-hidden />
              </button>
              {menuOpen ? (
                <div className="chat-panel__chain-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Edit signal"
                    disabled={busy}
                    onClick={() => startEditSignal(s)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Delete signal"
                    disabled={busy}
                    onClick={() => void onDeleteSignal(s.id)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
        <select
          className="chat-panel__chain-assign"
          aria-label="Assign to domain"
          value={s.domainSlug ?? ""}
          disabled={busy || editing}
          onChange={(e) => void onAssignSignal(s.id, e.target.value.trim() || null)}
        >
          <option value="">- unassigned -</option>
          {assignOptions(s).map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
      </li>
    );
  }

  /**
   * One chat row: the chat itself, its 3-dot menu, and — while the menu's Edit
   * is up — the field the name is edited in. Clicking the open chat comes back
   * to its thread; the row's own management lives behind the 3-dot control,
   * because the list is the surface that can see every chat at once.
   */
  function sessionRow(s: HermesSession) {
    const label = sessionLabel(s);
    const when = formatSessionWhen(s.lastActive);
    const active = s.id === sessionId;
    const menuOpen = sessionMenuId === s.id;
    const renamingRow = renamingSessionId === s.id;
    return (
      <li key={s.id} className="chat-panel__session-item">
        {renamingRow ? (
          <form
            className="chat-panel__session-rename"
            onSubmit={(e) => void commitSessionRename(e, s.id)}
          >
            <input
              className="chat-panel__rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelSessionRename();
                }
              }}
              aria-label="Chat name"
              autoFocus
            />
            <button
              type="submit"
              className="chat-panel__text-btn"
              aria-label="Save chat name"
            >
              Save
            </button>
            <button
              type="button"
              className="chat-panel__text-btn"
              aria-label="Cancel rename"
              onClick={cancelSessionRename}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
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
            <button
              type="button"
              className="chat-panel__session-menu-btn"
              aria-label="Chat actions"
              title="Chat actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={sending}
              onClick={() => toggleSessionMenu(s.id)}
            >
              <MoreVertical size={14} aria-hidden />
            </button>
            {menuOpen ? (
              <div className="chat-panel__session-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Edit chat"
                  onClick={() => startSessionRename(s)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Archive chat"
                  onClick={() => {
                    setSessionMenuId(null);
                    void patchSession(s.id, { archived: true });
                  }}
                >
                  Archive
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Delete chat"
                  className="chat-panel__session-menu-danger"
                  onClick={() => void deleteSession(s.id)}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </>
        )}
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
          ) : view === "chain" ? (
            <div className="chat-panel__header">
              <p className="chat-panel__heading">Life-Chain</p>
            </div>
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
                    <div className="chat-panel__message-content">
                      {m.receipt ? (
                        <span className="chat-panel__message-receipt">
                          <ImagePlus size={12} aria-hidden />
                          {m.receipt.name}
                          <span className="chat-panel__receipt-size">
                            {formatReceiptSize(m.receipt.size)}
                          </span>
                        </span>
                      ) : null}
                      {m.content}
                    </div>
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
                      <ul className="chat-panel__activity-list" ref={activityRef}>
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

          {/*
            The chain, as the dock's third surface: its own composer below, and
            the same records the Life-Chain page shows. Rows carry their own
            controls — edit, delete, assign — because at two blocks per row they
            fit; the page still owns everything else a signal can become.
          */}
          <div
            className="chat-panel__body chat-panel__body--chain"
            ref={chainRef}
            hidden={view !== "chain"}
          >
            {errorBanner}
            {signalsLoaded && chainItems.length === 0 ? (
              <p className="chat-panel__chain-empty muted">
                {signals.length === 0
                  ? "Nothing on the chain yet. Write something below."
                  : "No unassigned or matching signals in this domain."}
              </p>
            ) : (
              <ul
                className="chat-panel__chain-list"
                aria-label="Life-Chain signals"
              >
                {chainItems.map(signalRow)}
              </ul>
            )}
          </div>

          <div className="chat-panel__footer" hidden={view === "list"}>
            {view === "chain" ? (
              /*
                The chain's composer: the same field, the same inline arrow, the
                same auto-grow cap — one composer idiom in the dock, two
                subjects. Only one of the two fields is ever mounted, so both
                can share `inputRef` and one height pass.
              */
              <form
                className="chat-panel__composer"
                onSubmit={(e) => void onChainSubmit(e)}
              >
                <div
                  className={
                    chainControlVisible
                      ? "chat-panel__composer-row chat-panel__composer-row--control"
                      : "chat-panel__composer-row"
                  }
                >
                  <textarea
                    ref={inputRef}
                    className="chat-panel__composer-input"
                    placeholder="Log a signal…"
                    value={chainDraft}
                    onChange={(e) => setChainDraft(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    disabled={chainBusy}
                    rows={2}
                    aria-label="Log a signal"
                    autoComplete="off"
                  />
                  {chainControlVisible ? (
                    <button
                      type="submit"
                      className="chat-panel__send"
                      data-state="send"
                      disabled={chainBusy || !chainSendable}
                      aria-label="Log signal"
                      title="Log signal"
                    >
                      <ArrowUp size={15} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <form
                className="chat-panel__composer"
                onSubmit={(e) => void onSubmit(e)}
                onDragOver={(e) => {
                  // Only a file drag needs the drop; text drags keep their
                  // native behaviour over the field.
                  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
                }}
                onDrop={(e) => {
                  const file = imageFrom(e.dataTransfer.files);
                  if (!file) return;
                  e.preventDefault();
                  void attachReceipt(file);
                }}
              >
                {/*
                  One slim row above the field, so the attach control costs the
                  textarea no width: the composer has to stay narrower than the
                  side column it replaced, and a second control inside the field
                  would not. The chip lives here beside it when a receipt is
                  waiting.
                */}
                <div className="chat-panel__receipts">
                  <input
                    ref={receiptInputRef}
                    className="chat-panel__receipt-input"
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Receipt image"
                    onChange={(e) => {
                      const file = imageFrom(e.target.files);
                      if (file) void attachReceipt(file);
                      // Clear the picker so choosing the same file twice still
                      // fires a change event.
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="chat-panel__attach"
                    disabled={sending || !sessionId}
                    aria-label="Attach a receipt"
                    title="Attach a receipt"
                    onClick={() => receiptInputRef.current?.click()}
                  >
                    <ImagePlus size={15} aria-hidden />
                  </button>
                  {receipt ? (
                    <div className="chat-panel__receipt">
                      <img
                        className="chat-panel__receipt-thumb"
                        src={receipt.previewUrl}
                        alt=""
                      />
                      <span className="chat-panel__receipt-name">{receipt.name}</span>
                      <span className="chat-panel__receipt-size">
                        {formatReceiptSize(receipt.size)}
                      </span>
                      <button
                        type="button"
                        className="chat-panel__receipt-remove"
                        aria-label="Remove receipt"
                        title="Remove receipt"
                        onClick={() => putReceipt(null)}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>
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
                    onPaste={(e) => {
                      // A pasted screenshot is a receipt too: take the image and
                      // leave any pasted text to the field's own handling.
                      const file = imageFrom(e.clipboardData?.files ?? null);
                      if (!file) return;
                      e.preventDefault();
                      void attachReceipt(file);
                    }}
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
                {/*
                  The turn's runtime pick, under the field: the dock's version of
                  the Hermes Desktop composer's model and reasoning pills. It is
                  inside the form so it rides the composer's own column gap, and
                  every control in it is `type="button"` — nothing here can
                  submit the field above it. Absent entirely when the gateway
                  served no catalog.
                */}
                <ComposerModelControls
                  catalog={modelCatalog}
                  disabled={sending || !sessionId}
                  pick={runtimePick}
                  onChange={updateRuntimePick}
                />
              </form>
            )}
          </div>

          {/*
            The dock's own actions, pinned to the bottom of the bar and shared by
            all three surfaces: the list is where most navigation happens, so its
            entry point cannot live inside the thread it replaces. Slot three is
            still reserved — disabled rather than absent, so the row keeps the
            shape it will end up as — and slot four is the chain: the dock's
            second way into the Life-Chain, alongside the rail's.
          */}
          <nav className="chat-panel__actions" aria-label="Chat and chain actions">
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Chat history"
              title="Chat history"
              aria-pressed={view === "list"}
              onClick={() => setView(view === "list" ? "thread" : "list")}
            >
              <History size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="New chat"
              title="New chat"
              disabled={sending}
              onClick={() => void newSession()}
            >
              <SquarePen size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Search chats (coming soon)"
              title="Search chats — coming soon"
              disabled
            >
              <Search size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Life-Chain"
              title="Life-Chain"
              aria-pressed={view === "chain"}
              onClick={() => setView(view === "chain" ? "thread" : "chain")}
            >
              <Radio size={20} aria-hidden />
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

      {/* The dock's own confirmation. It is drawn over the window, not the panel:
          the question is about a chat, and a platform dialog would put it on the
          display instead of in the window the application is running in. */}
      {dialog}
    </aside>
  );
}
