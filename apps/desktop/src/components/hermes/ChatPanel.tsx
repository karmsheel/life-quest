import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  Keyboard,
  Link2,
  MessageCircleQuestion,
  MessageSquare,
  MoreVertical,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Radio,
  SquarePen,
  X,
} from "lucide-react";
import {
  matchingChatQuestions,
  unlockedAreas,
  type ChatQuestion,
  type DomainRecord,
  type SignalRecord,
} from "@lifequest/vault-core/pure";
import { copyText } from "@/lib/clipboard";
import { api } from "@/lib/ipc";
import { pageLabelFor } from "@/lib/page-context";
import { WING_LABELS, wingForPath } from "@/components/shell/wing";
import {
  linkHost,
  signalStampWhen,
  signalVisible,
} from "@/lib/signal-chain";
import { onComposerKeyDown } from "@/components/signal-chain/SignalChainFeed";
import { useSignalImageUrls } from "@/components/signal-chain/useSignalImageUrls";
import { ComposerModelControls } from "@/components/hermes/ComposerModelControls";
import { OnboardingCards } from "@/components/hermes/OnboardingCards";
import { ChatShortcutsPage } from "@/components/hermes/ChatShortcutsPage";
import { useActiveDomain } from "@/components/shell/useActiveDomain";
import { UpdateBadge } from "@/components/shell/UpdateBadge";
import { useConfirm } from "@/components/ui/useConfirm";
import { useChatDock } from "@/state/ChatDockProvider";
import { useOptionalCompanion } from "@/state/CompanionProvider";
import { AgentSwitcher } from "@/components/hermes/AgentSwitcher";
import {
  ChatSessionsProvider,
  useChatSessions,
  useChatSessionsOptional,
  type ChatReceipt,
} from "@/state/ChatSessionsProvider";
import { normalizeCapabilities } from "@/lib/turn-timeline";
import { TurnTimeline } from "@/components/hermes/turn/TurnTimeline";
import { useVault } from "@/state/VaultProvider";
import type {
  CompanionModelCatalog,
  CompanionRuntimeOverride,
} from "@/vite-env";
import {
  formatMessageWhen,
  sessionLabel,
} from "../../../electron/companion-client.ts";

/**
 * Bytes as the chip says them: 287 B, 41 KB, 1.2 MB.
 */
function formatReceiptSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where a saved question belongs, in the words the settings page uses for it.
 * The dock shows the chip because the same thread can offer questions from two
 * scopes at once — a domain prompt and one written for this page — and the
 * operator should be able to tell which is which without opening Settings.
 */
function starterScopeLabel(
  question: ChatQuestion,
  domains: readonly DomainRecord[],
): string {
  if (question.scope === "everywhere") return "Everywhere";
  if (question.scope === "wing") {
    const wing = question.value ?? "";
    return `${WING_LABELS[wing as keyof typeof WING_LABELS] ?? wing} wing`;
  }
  if (question.scope === "domain") {
    const domain = domains.find((row) => row.slug === question.value);
    return domain ? domain.meta.name : (question.value ?? "Area");
  }
  return `${pageLabelFor(question.value ?? "/")} page`;
}

type ChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** One shared empty pin, so an unpinned chat keeps a stable identity. */
const NO_RUNTIME_PICK: CompanionRuntimeOverride = {};

/** The composer may eat at most half the panel before it scrolls in place. */
const COMPOSER_MAX_PANEL_RATIO = 0.5;
/** Floor for that cap so a very short panel still shows a usable field. */
const COMPOSER_MIN_VISIBLE_PX = 72;
/**
 * How near the transcript's end still counts as reading the end. A wheel tick or
 * a dragged scrollbar can leave a pixel or two; growth inside that slack is not
 * the operator having scrolled away.
 */
const TRANSCRIPT_END_SLACK_PX = 8;

/**
 * Whether the caret sits in a field somebody is typing in — ours or another
 * surface's. The dock's composer only ever takes the caret from a control (a
 * button, a row, the window itself), never from under a keystroke.
 */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * The dock, with the chats it shares with the sidebar and the tabs.
 *
 * The state lives in `ChatSessionsProvider` because a chat outlives this panel:
 * the left sidebar lists it, the tab strip names it, and a parallel turn keeps
 * streaming while the operator is somewhere else. A harness that mounts the
 * panel on its own gets a provider of its own, so the component still works
 * without the shell around it.
 */
export function ChatPanel(props: ChatPanelProps) {
  const mounted = useChatSessionsOptional();
  if (mounted) return <ChatPanelView {...props} />;
  return (
    <ChatSessionsProvider>
      <ChatPanelView {...props} />
    </ChatSessionsProvider>
  );
}

function ChatPanelView({ open, onOpenChange }: ChatPanelProps) {
  const activeDomain = useActiveDomain();
  const domainName = activeDomain?.meta.name ?? "Life";
  const { snapshot, reloadGeneration, lens, refresh } = useVault();
  const {
    requestedSessionId,
    requestedKickoff,
    requestedSession,
    requestedAutomationContext,
    clearRequestedSession,
    contextCards,
    removeCardContext,
    pageContext,
    setPageContextOn,
    // The dock's side is the shell's business — it is the shell that swaps the
    // two panes — but the bottom bar's collapse arrow points out of the side it
    // collapses toward, so it reads the side too.
    side: dockSide,
    // The two-pane move, in the bottom bar beside the collapse control: the
    // titlebar no longer carries a copy of it.
    swapSide,
    // What the pane is showing. The dock's own bottom bar switches it, so the
    // store sits above the panel whose bar reads it.
    surface: view,
    setSurface: setView,
  } = useChatDock();
  const chat = useChatSessions();
  // What this dock calls the agent that answers. The setup screen and Settings
  // choose it; here it is only a name.
  const companionContext = useOptionalCompanion();
  const knownHarnesses = Array.isArray(companionContext?.harnesses)
    ? companionContext.harnesses
    : null;
  const companionName =
    knownHarnesses?.find((entry) => entry.active)?.name ?? "Hermes";
  /**
   * What the active companion can show in a work log. Absent on an old stub or
   * before the list arrives, and absent means "the full experience": the dock
   * must not hide evidence it was given just because a descriptor is missing.
   */
  const capabilities = normalizeCapabilities(
    knownHarnesses?.find((entry) => entry.active)?.capabilities,
  );
  const sessions = chat.sessions;
  const sessionId = chat.activeId;
  /*
    The strip's tabs, as the store draws them: the pinned band first, then the
    open unpinned tabs. `tabIds` already comes in that order — a pinned chat is a
    tab even on a launch where it was never opened — but the two bands are put
    back together here so the strip never depends on the provider's ordering
    being the only thing keeping a square in front.
  */
  const tabIds = chat.tabIds;
  const pinnedTabIds = chat.pinnedTabIds;
  const orderedTabIds = useMemo(() => {
    const pinned = new Set(pinnedTabIds);
    return [...pinnedTabIds, ...tabIds.filter((id) => !pinned.has(id))];
  }, [tabIds, pinnedTabIds]);
  const run = chat.runOf(sessionId);
  const turns = run.turns;
  const sending = run.sending;
  const runId = run.runId;
  const approval = run.approval;
  const error = run.error ?? chat.listError;
  const draft = sessionId ? chat.draftOf(sessionId) : "";
  const receipt = chat.receiptOf(sessionId);
  /** The files waiting to ride this chat's next turn. */
  const attachments = sessionId ? chat.attachmentsOf(sessionId) : [];
  /** The messages lined up behind the turn that is running now. */
  const queued = sessionId ? chat.queuedMessages(sessionId) : [];
  const requestIdRef = useRef(requestedSessionId);
  requestIdRef.current = requestedSessionId;
  /** The store as of this render, for effects that must not re-bind per delta. */
  const chatRef = useRef(chat);
  chatRef.current = chat;
  /**
   * The receipt waiting to ride one chat's next turn. Main keeps the original
   * and the copy it built for the model, so what lives in the store is a name to
   * show and the path to name on the turn — the bytes never come back.
   */
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The general attachment picker: the plus at the composer's bottom left. It
   * takes any media or file the operator picks — a picture, a clip, a
   * recording, a document — because a prompt is not only words and the
   * composer used to be able to carry nothing else.
   */
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The bubble whose text was last copied, and whether the clipboard took it.
   * `ok: false` is shown for a moment too: a copy control that silently does
   * nothing is worse than one that admits it failed.
   */
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  /**
   * One of the onboarding card's writes is in flight. It disables the card's
   * buttons so a double click cannot start the interview twice or confirm a
   * batch that is already being applied.
   */
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraft = useCallback(
    (text: string) => {
      if (sessionId) chat.setDraftFor(sessionId, text);
    },
    [chat, sessionId],
  );

  /** Replace (or drop) the receipt waiting on the open chat. */
  const putReceipt = useCallback(
    (next: ChatReceipt | null) => {
      if (sessionId) chat.setReceiptFor(sessionId, next);
    },
    [chat, sessionId],
  );

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  /**
   * Copy one bubble's text as the operator sees it. A receipt-only turn has no
   * typed text, so the attached file's name is the content there.
   */
  async function copyMessage(id: string, content: string) {
    const ok = await copyText(content);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopied({ id, ok });
    copyTimerRef.current = setTimeout(() => setCopied(null), 1600);
  }

  /**
   * Take one image from the composer. Main stores the original and answers with
   * the path the turn has to cite — the bytes are never handed back, so the
   * thumbnail is made here from the operator's own file.
   *
   * One receipt at a time: a second attach replaces the first, and a refusal
   * from main leaves the previous one exactly where it was.
   */
  async function attachReceipt(file: File) {
    chat.reportError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await api().receiptAttach({
        bytes,
        mime: file.type,
        name: file.name,
      });
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      putReceipt({
        relPath: result.value.relPath,
        name: result.value.name,
        size: result.value.size,
        previewUrl: URL.createObjectURL(file),
      });
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Could not attach that receipt");
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
   * Take one file into the composer as an attachment.
   *
   * Main stores the original and answers with what the turn has to name; the
   * bytes never come back to the renderer, so the chip's picture is made here
   * from the operator's own file.
   *
   * A refusal leaves the attachments exactly as they were: an attach that
   * failed must not take the files that worked with it.
   */
  async function attachFile(file: File) {
    if (!sessionId) return;
    chat.reportError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await api().attachmentAttach({
        bytes,
        mime: file.type,
        name: file.name,
      });
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      chat.addAttachmentFor(sessionId, {
        id: result.value.id,
        kind: result.value.kind,
        name: result.value.name,
        size: result.value.size,
        mime: result.value.mime,
        relPath: result.value.relPath,
        ...(result.value.kind === "image"
          ? { previewUrl: URL.createObjectURL(file) }
          : {}),
      });
    } catch (err) {
      chat.reportError(
        err instanceof Error ? err.message : "Could not attach that file",
      );
    }
  }

  /** Take one attachment off the composer. */
  function removeAttachment(id: string) {
    if (!sessionId) return;
    chat.removeAttachmentFor(sessionId, id);
  }
  /**
   * The composer's model and thinking pills. The catalog is the gateway's own
   * inventory for this profile, so the menu cannot offer a model the gateway
   * cannot route; the pick is the *chat's*, remembered across launches so a
   * thread comes back on the model it was left on.
   */
  const [modelCatalog, setModelCatalog] = useState<CompanionModelCatalog | null>(null);
  const runtimePick = (sessionId && chat.runtimePins[sessionId]) || NO_RUNTIME_PICK;
  /**
   * The thread header's rename field. The list is not this dock's surface any
   * more, so this is the only rename field it carries.
   */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /**
   * A rename asked for from a tab's context menu. The tab may not be the one in
   * front, so the field cannot open until that chat has been activated; this
   * says which chat the field is owed to. It is consumed (or dropped) by the
   * session-change effect below, which is also what stops the field following
   * the header onto a chat nobody asked to rename.
   */
  const pendingRenameRef = useRef<string | null>(null);
  /**
   * The tab strip's context menu: the tab it was opened on, whether that tab is
   * pinned, and the pointer point it anchors to. The strip scrolls sideways, so
   * the menu is drawn fixed at the cursor rather than inside the strip — a menu
   * inside a scroll port is clipped by it. One tab's menu at a time.
   */
  const [tabMenu, setTabMenu] = useState<{
    id: string;
    pinned: boolean;
    x: number;
    y: number;
  } | null>(null);
  /** Where the menu lands once the window's own edges have clamped it. */
  const [tabMenuPos, setTabMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  /**
   * The dock's questions — a chat delete, a signal delete — are asked in the
   * app's own dialog, and gated on the dock being open: a question asked from
   * the dock cannot float over the window once the panel is collapsed.
   */
  const { ask, dialog, asking } = useConfirm(open);
  /** Drives the inline control: the arrow needs text, the stop square needs a run. */
  const sendable =
    draft.trim().length > 0 || receipt !== null || attachments.length > 0;
  const controlVisible = sending || sendable;
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
  /**
   * A capture may be a picture; the dock draws the same records the page does,
   * so it reads their bytes through the same blob-URL path.
   */
  const signalImagePaths = useMemo(
    () =>
      signals
        .map((s) =>
          s.attachment?.kind === "image" ? s.attachment.relPath : null,
        )
        .filter((path): path is string => path !== null),
    [signals],
  );
  const { urls: signalImageUrls, missing: missingSignalImages } =
    useSignalImageUrls(signalImagePaths);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** The chain's own scroller: the view follows the newest signal. */
  const chainRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bottom for the composer: the box height it rests at with an empty draft. */
  const restingHeightRef = useRef(0);

  /**
   * Put the caret back in the dock's composer — the one field all three of its
   * surfaces share, since only one of them is ever mounted.
   *
   * Every write the composer starts disables its own field while the write is in
   * flight (the arrow becomes the stop square, the chain's field goes inert), and
   * a disabled field cannot hold the caret: the browser drops it on `body`.
   * Capture is one gesture — type, Enter, type again — so the field takes the
   * caret back the moment it is usable again. It is never taken from a field the
   * operator is typing in, which is what keeps an eager rule from being a rude
   * one.
   */
  const focusComposer = useCallback(() => {
    const field = inputRef.current;
    if (!field || field.disabled) return;
    if (isTypingTarget(document.activeElement)) return;
    field.focus();
  }, []);

  /**
   * The chat in front. It is read from the store's list rather than held here:
   * the sidebar is where the history is picked, so this panel only needs the
   * row for the open chat's header (its name, pin and archive state).
   */
  const activeSession = sessions.find((s) => s.id === sessionId) ?? null;
  const activeLabel = activeSession ? sessionLabel(activeSession) : "Chat";

  /**
   * The chain, lensed the way the Life-Chain page lenses it: everything in
   * Life, and unassigned plus the open area in an area tab. Logging here
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
  /** What a signal can be assigned to: unlocked areas, as the picker offers them. */
  const domainNames = unlockedAreas(snapshot?.domains ?? []).map((d) => ({
    slug: d.slug,
    name: d.meta.name,
  }));
  /**
   * The saved questions that belong on the screen in front of the operator.
   *
   * Read live from the vault snapshot, so a question added in Settings is in
   * the dock the moment the sheet closes — no reload, no second list to keep in
   * step. The scope is matched here rather than filtered by the page: the dock
   * is the one place that knows the wing, the area lens and the route at once.
   */
  const starters = useMemo(
    () =>
      matchingChatQuestions(snapshot?.settings.chatQuestions ?? [], {
        wing: wingForPath(pageContext.route),
        domainSlug: activeDomain?.slug ?? null,
        route: pageContext.route,
      }),
    [snapshot, activeDomain, pageContext.route],
  );

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

  /** Open one chat, and hand the composer the caret the gesture implies. */
  const openSession = useCallback(
    async (id: string) => {
      await chat.openChat(id);
      focusComposer();
    },
    [chat, focusComposer],
  );

  /** Read the chain — the same call the Life-Chain page makes. */
  const loadChain = useCallback(async () => {
    try {
      const result = await api().signalChainList();
      if (!result.ok) {
        chat.reportError(result.error);
        setSignals([]);
        return;
      }
      setSignals(result.value.records);
      setSignalsLoaded(true);
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Failed to reach the chain");
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
   * recent one, else show the list. The store guards the "already landed" case,
   * so a run's deltas re-rendering this panel cannot resume it a second time.
   *
   * A surface the operator asked for by name — the dock bar's shortcuts
   * reference — is not a landing: opening the dock onto it must not have a chat
   * resume over the top of it. The check reads a ref rather than a dependency:
   * landing is "the dock opened", not "the surface changed", and re-running
   * when the surface changes would make closing the last tab resume a chat
   * again off a list that has not been re-read yet.
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!open || requestedSessionId || viewRef.current === "shortcuts") return;
    void chatRef.current.resumeLast();
  }, [open, requestedSessionId]);

  /**
   * A rename field belongs to the chat it was opened on. When the chat in front
   * changes — another chat is opened, a tab closes, or an archive hands the
   * header to its neighbour — the field must not follow the header onto the new
   * chat: saving it would write one chat's name onto another.
   *
   * The exception is a rename asked for from a tab's menu: that gesture named
   * its chat first, so the field opens on the chat the gesture has just
   * activated, prefilled from it — the same field the header's pencil opens.
   */
  useEffect(() => {
    const pending = pendingRenameRef.current;
    pendingRenameRef.current = null;
    if (pending && pending === sessionId) {
      const row = chatRef.current.sessions.find((s) => s.id === sessionId) ?? null;
      setRenameDraft(row ? sessionLabel(row) : "");
      setRenaming(true);
      return;
    }
    setRenaming(false);
    setRenameDraft("");
  }, [sessionId]);

  /**
   * The tab menu is fixed at the pointer, then pulled back inside the window:
   * a right-click on the last tab must not open a menu that hangs off the right
   * or bottom edge with its commands unreachable. It is measured after it mounts
   * — a layout effect, so no frame paints in the wrong place — and only the
   * first pass needs the anchor, after which the clamped position stands.
   */
  useLayoutEffect(() => {
    if (!tabMenu) {
      setTabMenuPos(null);
      return;
    }
    const menu = tabMenuRef.current;
    if (!menu) return;
    const gap = 8;
    const rect = menu.getBoundingClientRect();
    setTabMenuPos({
      left: Math.max(gap, Math.min(tabMenu.x, window.innerWidth - rect.width - gap)),
      top: Math.max(gap, Math.min(tabMenu.y, window.innerHeight - rect.height - gap)),
    });
  }, [tabMenu]);

  /**
   * Every way a signal menu closes, the tab menu closes too: a press anywhere
   * outside it (a tab, a transcript, another menu), Escape, a window resize, or
   * a scroll of the strip it points at — the anchor would be stale after any of
   * them. Choosing an item closes it in the item's own handler.
   */
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const menu = tabMenuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
    };
    const strip = tabsRef.current;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    strip?.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      strip?.removeEventListener("scroll", close);
    };
  }, [tabMenu]);

  /** The strip is gone off the thread; a menu anchored to it has nothing to point at. */
  useEffect(() => {
    if (!open || view !== "thread") setTabMenu(null);
  }, [open, view]);

  useEffect(() => {
    if (!open || view !== "thread" || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
    // The disclosure scrolls inside the transcript, so it takes the same pass:
    // the block is capped, and a capped block left at its first row would hide
    // the calls the operator opened it to watch arrive. `toolsOpen` is in the
    // deps because opening it mounts a fresh list at scrollTop 0.
  }, [open, view, turns, sending, error]);

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

  /**
   * Keep the transcript's end where the operator put it while the dock's column
   * changes shape under it.
   *
   * The dock is a flex column — header, tab strip, transcript, composer, action
   * bar — so anything that grows below the transcript takes its height from the
   * transcript's scroll port. That part is right: the border between them moves
   * up, the transcript gives the height up, and the composer's half-panel cap
   * bounds the whole thing. What is not right is the port's `scrollTop`. The
   * browser has no reason to touch it — the content did not change, only the
   * port's height — so a transcript being read at its end suddenly ends *below*
   * the new bottom edge: the last thing the operator was reading disappears
   * under the composer, and the composer reads as having grown over the chat
   * instead of having pushed the border up. The browser's own scroll anchoring
   * repairs content that moves inside the port; a port that *shrinks* is the
   * case it does not touch, so the dock does.
   *
   * The composer is the loudest source of that growth — it grows with the draft,
   * up to half the panel — which is why the report is "typing a long paragraph
   * eats the bottom of the chat". It is not the only source: the context cards,
   * the attachment chips, the queued rows and the interview card all sit above
   * the field in the same column and push the same border. Watching the
   * transcript's port covers all of them at once, because the port's height is
   * what each of them moves.
   *
   * Only an operator who was already at the end is followed. Someone reading
   * scrollback may type without being pulled back down to the live turn: the
   * reading position is theirs, and a correction that took it would be a worse
   * bug than the one this repairs. "Was at the end" is kept from the operator's
   * own scroll events and from the moment the watch starts, so it describes
   * where they were *before* the resize. The observation itself runs after
   * layout and before paint, so the frame that paints the grown composer is the
   * frame that already has the transcript at its end — there is no frame in
   * between to see.
   */
  useEffect(() => {
    if (!open || view === "shortcuts") return;
    // Both bodies stay mounted — only the one in front is visible; the other is
    // `hidden` (`display: none`), so it has no height and nothing to keep. The
    // watch follows the visible one.
    const scroller = view === "chain" ? chainRef.current : listRef.current;
    if (!scroller) return;
    const atEnd = () =>
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
      TRANSCRIPT_END_SLACK_PX;
    let wasAtEnd = atEnd();
    const onScroll = () => {
      wasAtEnd = atEnd();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => scroller.removeEventListener("scroll", onScroll);
    }
    const observer = new ResizeObserver(() => {
      // A body that is not on screen has no end to keep: a cleanup can land
      // after this delivery, so the hidden twin may still be observed for a
      // beat. Zero height means "not in front", and writing scrollTop there
      // would be a write to nobody.
      if (scroller.clientHeight === 0) return;
      // The resize that fired this observation has already happened, so
      // `wasAtEnd` is the reading from before it. Following the end here is not
      // a jump: the transcript is being put back where it was already sitting.
      if (!wasAtEnd) return;
      scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
    // `sessionId` is here because the flag belongs to the transcript in front:
    // opening another chat re-arms the watch, so a switch to a transcript that
    // happens to sit at the same offset cannot leave it reading "scrolled away".
  }, [open, view, sessionId]);

  /**
   * How many cards are in front of this conversation, and whether the latest
   * render brought one in. The effects below react to a card *arriving* — the
   * operator pressed a card and expects the chat to come to them — and not to a
   * card leaving, which must not reopen or re-surface anything.
   */
  const contextCount = contextCards.length;
  const lastContextCount = useRef(0);

  /**
   * When the composer is handed the caret: the panel opens, a surface swaps in,
   * a chat finishes loading, or a write that disabled the field settles. Those
   * are exactly the moments the field goes from unusable to usable, which is why
   * they are what this effect waits on. The dock's own question gates all of it:
   * while a dialog is up it is the surface, so the composer must not reach behind
   * it for a caret the operator has already given to the answer.
   */
  useEffect(() => {
    if (!open || view === "shortcuts" || asking) return;
    if (view === "thread" && (sending || !sessionId)) return;
    if (view === "chain" && chainBusy) return;
    focusComposer();
    // The number of cards is in the list because a card handed over from the
    // Dashboard is that same moment: the field goes from "not what I am writing
    // in" to "where I describe these cards", and the operator should not have to
    // click twice to start.
  }, [open, view, sessionId, sending, chainBusy, asking, focusComposer, contextCount]);

  /**
   * Cards handed over from the Dashboard bring the chat with them.
   *
   * The pills live above the thread's composer, so a dock sitting on the chain
   * or the shortcuts reference would take the cards and show the operator
   * nothing — the click would look like it did nothing at all. The thread takes
   * over, and a vault with no chats gets the empty one "New chat" would have
   * made, because a composer with no session cannot be typed in.
   *
   * Only the arrival is reacted to. Taking a card off, or leaving the rest
   * there, changes no surface: the operator is already where they need to be.
   */
  useEffect(() => {
    const arrived = contextCount > lastContextCount.current;
    lastContextCount.current = contextCount;
    if (!arrived) return;
    onOpenChange(true);
    if (view === "thread") return;
    if (sessionId) setView("thread");
    else void newSession();
    // Deliberately keyed on the count alone: this is "a card arrived", not "the
    // view or the session changed" — reacting to those would fight the
    // operator's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextCount]);

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

  /** Pin this chat's model and thinking level, or clear the pin back to default. */
  function updateRuntimePick(next: CompanionRuntimeOverride) {
    if (!sessionId) return;
    chat.updateRuntimePick(sessionId, next);
  }

  /**
   * Send one turn in a chat. The store owns the bubble, the receipt and the run;
   * this is the gesture's thin end.
   */
  async function sendMessage(text: string, overrideSessionId?: string) {
    // A first turn typed before the interview was opened starts the record
    // silently: the welcome card is an offer, and it must not fight the message
    // the operator was already writing.
    const target =
      overrideSessionId ?? sessionId ?? (await chat.newChat());
    if (!target) return;
    if (snapshot?.onboarding?.status === "not_started") {
      try {
        await api().onboardingStart();
      } catch {
        // The turn still sends; the card waits for the next visit.
      }
    }
    await chat.sendMessage(target, text);
  }

  /**
   * Steer the live turn: the operator's words go into the run that is already
   * working, so a thought that arrives halfway through a long answer is not
   * lost waiting for the next turn.
   *
   * The draft is cleared only when the steer lands. A refusal (the run ended
   * between the keypress and the call) must leave the words in the field, or
   * the operator loses them.
   */
  async function steerMessage(text: string) {
    if (!sessionId || !text) return;
    const ok = await chat.steerMessage(sessionId, text);
    if (ok) setDraft("");
  }

  /**
   * Line the message up behind the turn that is running. The queue lives in the
   * store, so it survives a chat switch: the operator can write the next
   * question now and find it waiting when the answer lands.
   */
  function queueMessage(text: string) {
    if (!sessionId || !text) return;
    chat.queueMessage(sessionId, text);
    setDraft("");
  }

  /** Take one queued message off the queue. */
  function removeQueued(queuedId: string) {
    if (!sessionId) return;
    chat.removeQueued(sessionId, queuedId);
  }

  /**
   * An automation, a review or a saved question hands the dock a chat outside
   * the panel's own navigation.
   *
   * The chat gets a tab of its own, beside the conversation on screen, rather
   * than taking that tab over: the page asked the dock to start a conversation,
   * and the one the operator was reading is not the price of it. A chat the page
   * has just created also hands its own row along, so the tab and the sidebar
   * carry its name from the first paint instead of showing a bare "Chat".
   *
   * The request is cleared only after the kickoff, so the landing pass cannot
   * replace the prompt bubble with a transcript the gateway has not written yet.
   */
  useEffect(() => {
    if (!requestedSessionId) return;
    let cancelled = false;
    const targetId = requestedSessionId;
    const kickoff = requestedKickoff;
    (async () => {
      onOpenChange(true);
      await chatRef.current.openChatInNewTab(targetId, requestedSession ?? undefined);
      if (cancelled) return;
      // Bind the automation's page material before the first turn is sent, so
      // that turn carries the same context every later turn in the chat will.
      if (requestedAutomationContext?.trim()) {
        chatRef.current.setAutomationContext(targetId, requestedAutomationContext);
      }
      if (kickoff?.trim()) {
        await chatRef.current.sendMessage(targetId, kickoff);
      }
      if (cancelled) return;
      clearRequestedSession();
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
    chat.reportError(null);
    try {
      const result = await api().signalChainCreate({
        type: "thought",
        title: null,
        body,
        domainSlug: null,
      });
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      setChainDraft("");
      await loadChain();
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Failed to log the signal");
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
    chat.reportError(null);
    try {
      const result = await api().signalChainUpdate(id, { domainSlug: nextDomain });
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      await loadChain();
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Failed to assign the signal");
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
    chat.reportError(null);
    try {
      const result = await api().signalChainUpdate(id, { body });
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      cancelEditSignal();
      await loadChain();
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Failed to save the signal");
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
    chat.reportError(null);
    try {
      const result = await api().signalChainDelete(id);
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      if (editingSignalId === id) cancelEditSignal();
      setSignalMenuId(null);
      await loadChain();
    } catch (err) {
      chat.reportError(err instanceof Error ? err.message : "Failed to delete the signal");
    } finally {
      chainBusyRef.current = false;
      setSignalBusyId(null);
    }
  }

  /**
   * The areas a signal can be assigned to: the unlocked ones, plus the one it
   * already names when that area has since been archived — the page makes the
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
    if (sending || (!draft.trim() && !receipt && attachments.length === 0)) return;
    const text = draft.trim();
    setDraft("");
    await sendMessage(text);
  }

  /**
   * The keyboard: Enter is a newline, Ctrl/Cmd+Enter sends.
   *
   * A prompt is a paragraph, not a telegram, so the key the operator reaches for
   * while writing has to break the line rather than throw the thought away
   * half-written. Sending moved to the modified key for the same reason: the
   * send is now a decision, taken on purpose, and the plain key stays the
   * writing key it has always been in every other editor.
   *
   * While a turn is running, the same modified key steers: the words go into
   * the live turn instead of starting a second one, which is the answer to
   * "the user is unable to steer the prompt once it's already sent".
   */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (sending) {
      void steerMessage(draft.trim());
      return;
    }
    if (!draft.trim() && !receipt && attachments.length === 0) return;
    const text = draft.trim();
    setDraft("");
    void sendMessage(text);
  }

  /**
   * Interrupt the open chat's live turn. The gateway stops the run cooperatively
   * and the stream closes on its own, which is what clears `sending` — nothing
   * here pretends the turn ended locally.
   */
  async function stopRun() {
    if (!sessionId) return;
    await chat.stopRun(sessionId);
  }

  /**
   * Rename, pin or archive one chat. All three are durable Hermes-side flags, so
   * the store writes them back to the gateway and Hermes Desktop sees the same
   * state. The row is patched from the patch itself, never from the reply: the
   * reply carries no `preview` and no `last_active`.
   */
  async function patchSession(
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ): Promise<boolean> {
    return chat.patchSession(id, patch);
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

  /**
   * Right-clicking a tab opens its verbs where the pointer is. The browser's own
   * menu never draws over the app: these are the same commands the sidebar's row
   * menu names, scoped to the tab — a pinned tab offers only the way out of the
   * band, because pinning, renaming, archiving and deleting are the unpinned
   * tab's business here.
   */
  function openTabMenu(
    event: MouseEvent<HTMLDivElement>,
    id: string,
    pinned: boolean,
  ): void {
    event.preventDefault();
    setTabMenu({ id, pinned, x: event.clientX, y: event.clientY });
  }

  /**
   * The browser's other tab gesture: the middle button closes the tab under the
   * pointer. A pinned square is not a closable tab — Unpin is the way out of the
   * band, exactly as the close control's absence says — so that press is
   * swallowed but closes nothing. Swallowing matters on Linux, where a middle
   * press otherwise starts X11's primary-selection paste or autoscroll.
   */
  function closeTabOnMiddlePress(
    event: MouseEvent<HTMLDivElement>,
    id: string,
    pinned: boolean,
  ): void {
    if (event.button !== 1) return;
    event.preventDefault();
    if (!pinned) chat.closeTab(id);
  }

  /** Close the tab menu, whether or not it was up. */
  function closeTabMenu(): void {
    setTabMenu(null);
  }

  /** Drop one chat out of the pinned band: the square goes back to a tab. */
  function unpinTab(id: string): void {
    closeTabMenu();
    void patchSession(id, { pinned: false });
  }

  /** Raise one chat into the pinned band: its tab becomes a square. */
  function pinTab(id: string): void {
    closeTabMenu();
    void patchSession(id, { pinned: true });
  }

  /**
   * Rename from a tab's menu. The field lives in the thread header, so the chat
   * is brought to the front first and the pending id tells the session-change
   * effect above to open the field on it — the same field, and the same write,
   * the header's pencil uses.
   */
  function renameTab(id: string): void {
    closeTabMenu();
    if (id === sessionId) {
      startRename();
      return;
    }
    pendingRenameRef.current = id;
    void openSession(id);
  }

  /** Archive one chat from its tab, as the sidebar's menu does. */
  function archiveTab(id: string): void {
    closeTabMenu();
    void patchSession(id, { archived: true });
  }

  /**
   * Delete one chat from its tab. The question is the app's own dialog and says
   * exactly what the sidebar's delete says: the chat leaves Hermes everywhere,
   * and there is no undo.
   */
  function deleteTab(id: string): void {
    closeTabMenu();
    const row = sessions.find((s) => s.id === id) ?? null;
    const label = row ? sessionLabel(row) : "Chat";
    ask({
      title: "Delete chat",
      message: `Delete "${label}"? Its messages leave Hermes everywhere, and this cannot be undone.`,
      confirmLabel: "Delete chat",
      destructive: true,
      run: () => void chat.deleteChat(id),
    });
  }

  /**
   * The id of the blank chat the "New chat" slot lands on, or null when the
   * gateway refused to make one. Returning the id is what lets a saved question
   * be sent in the same gesture: the state setter would not be visible to the
   * caller until the next render.
   */
  async function newSession(): Promise<string | null> {
    const id = await chat.newChat();
    // The slot has one case no state change can signal: the blank chat it lands
    // on may already be the open one, so neither the surface nor the session
    // moves and the caret effect never fires. The gesture still asked for the
    // field, so hand it over here.
    focusComposer();
    return id;
  }

  /**
   * One-click start: send a saved question as the first turn of the blank chat
   * the operator is looking at. If the dock is on the thread with no session
   * yet — a card handover, or a list view that lost its chat — the chat is made
   * first, so the button never looks like it did nothing.
   */
  async function askStarter(question: ChatQuestion): Promise<void> {
    if (sending) return;
    const target = sessionId ?? (await chat.newChat());
    if (!target) return;
    await sendMessage(question.text, target);
  }

  /**
   * The onboarding cards' three writes, and the two interview kickoffs.
   *
   * The dock's own turns are the operator speaking: *Begin* starts the record
   * and then sends "I'm ready to begin the interview." through the composer's
   * send path, so the transcript shows the operator's own bubble and the
   * companion answers it like any other turn. Nothing here fabricates a reply.
   */
  async function beginOnboarding(): Promise<void> {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    chat.reportError(null);
    try {
      const result = await api().onboardingStart();
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      await refresh();
      await sendMessage("I'm ready to begin the interview.");
    } catch (err) {
      chat.reportError(
        err instanceof Error ? err.message : "Could not begin the interview",
      );
    } finally {
      setOnboardingBusy(false);
    }
  }

  async function continueOnboarding(): Promise<void> {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    chat.reportError(null);
    try {
      // Idempotent on the engine side: an open record is left exactly as it is.
      const result = await api().onboardingStart();
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      await refresh();
      await sendMessage("Let's continue the interview.");
    } catch (err) {
      chat.reportError(
        err instanceof Error ? err.message : "Could not continue the interview",
      );
    } finally {
      setOnboardingBusy(false);
    }
  }

  /**
   * Acknowledge the announcement: the companion has already opened the areas
   * and written the receipt, so this only clears the receipt. The record stays
   * completed and the card never returns.
   */
  async function acknowledgeOnboarding(): Promise<void> {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    chat.reportError(null);
    try {
      const result = await api().onboardingDiscard();
      if (!result.ok) {
        chat.reportError(result.error);
        return;
      }
      await refresh();
    } catch (err) {
      chat.reportError(
        err instanceof Error ? err.message : "Could not close the announcement",
      );
    } finally {
      setOnboardingBusy(false);
    }
  }

  /**
   * The companion opens the areas through its own tool, in the main process,
   * not through an IPC call the dock made, so the vault's data revision is the
   * only announcement that the receipt (and with it the opened card) exists.
   *
   * Listen while the record is unfinished or a receipt is still on screen.
   * A re-read is cheap, and the announcement keeps no local state to lose: the
   * old confirmation card's ticked lines were the only thing a refresh could
   * have reset. Once the receipt is acknowledged and the record is completed the
   * watcher detaches for good.
   */
  useEffect(() => {
    if (!open || view !== "thread") return;
    const record = snapshot?.onboarding;
    if (!record) return;
    if (record.status === "completed" && snapshot.onboardingProposal === null) {
      return;
    }
    let stopped = false;
    let stop: (() => void) | undefined;
    try {
      stop = api().onVaultDataChanged(() => {
        if (!stopped) void refresh();
      });
    } catch {
      // No bridge (a harness page): the card still appears on the next turn or
      // the next launch, which is the old behaviour.
      stop = undefined;
    }
    return () => {
      stopped = true;
      stop?.();
    };
  }, [open, view, snapshot?.onboarding?.status, snapshot?.onboardingProposal, refresh]);

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
              {s.attachment?.kind === "image" ? (
                <span className="chat-panel__chain-image-wrap">
                  {signalImageUrls[s.attachment.relPath] ? (
                    <img
                      className="chat-panel__chain-image"
                      src={signalImageUrls[s.attachment.relPath]}
                      alt={s.body.trim() || s.attachment.name}
                      loading="lazy"
                      width={s.attachment.width ?? undefined}
                      height={s.attachment.height ?? undefined}
                    />
                  ) : (
                    <span className="chat-panel__chain-image-missing muted">
                      {missingSignalImages[s.attachment.relPath]
                        ? "Picture missing from the vault."
                        : "Loading picture…"}
                    </span>
                  )}
                </span>
              ) : null}
              {s.attachment?.kind === "link" ? (
                <a
                  className="chat-panel__chain-link"
                  href={s.attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.attachment.url}
                >
                  <Link2 size={13} aria-hidden />
                  <span>{linkHost(s.attachment.url) || s.attachment.url}</span>
                </a>
              ) : null}
              {s.body ? (
                <p className="chat-panel__chain-body">{s.body}</p>
              ) : null}
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
          aria-label="Assign to area"
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
          onClick={() => chat.dismissError(sessionId)}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  /*
    Collapsed, the dock is not a narrow pane: it leaves the grid entirely and
    becomes one floating mark on the page it gave its column back to. The mark is
    the agent's own — the Nous girl — and the button is the way back in; the
    dock's bottom action bar carries the matching way out. Keeping the component
    mounted here is deliberate: the thread, the draft and the pending receipt
    survive the collapse, because only the chip's paint changes, not its state.
  */
  if (!open) {
    return (
      <>
        <button
          type="button"
          className="chat-launcher"
          data-testid="chat-launcher"
          onClick={() => onOpenChange(true)}
          aria-label="Open Hermes chat"
          title="Open Hermes chat"
        >
          <span className="chat-launcher__mark" aria-hidden />
        </button>
        {/* The dock's own confirmation, rendered beside the launcher so a
            question already asked is not stranded by a collapse. */}
        {dialog}
      </>
    );
  }

  return (
    <aside
      ref={panelRef}
      className="chat-panel"
      role="complementary"
      aria-label={`${companionName} chat`}
      data-chat-surface={view}
    >
        <AgentSwitcher />
        <div className="chat-panel__open">
          {/*
            The open chats, as tabs, in the dock's top band. The strip leads the
            dock — above the thread's header — so the chats in the air are the
            first thing the operator sees, and the name row below belongs to the
            tab in front, the way a browser draws its tabs above the page. The
            browser's tab gestures come with it: a middle click on a tab closes
            it, and Ctrl/Cmd+W closes the one in front (that key lives in the
            shortcut runner, because only it can see the strip and stand down
            under a modal or a recording row).

            It is drawn whenever the thread has a tab, even a single one: the
            plus at its trailing edge is the second tab's door, and a strip that
            only appeared once a second tab existed would hide that door behind
            the very gesture it exists for.

            A live tab's dot pulses, a tab waiting on an approval keeps a ring,
            and the close control stops a turn before it drops the tab. The
            pinned band leads the strip and is drawn as squares. A pin is a
            durable Hermes flag rather than a strip-local decoration, so a pinned
            chat has a tab even on a launch where it was never opened — which is
            why the strip shows with a single pinned chat and nothing else open.
            A square carries the label's first letter and a filled pin in the
            room the dot and label would take, and no close control: the way out
            of the band is the menu's Unpin, so a pin is never dropped by a stray
            press. Right-click opens that menu on any tab.
          */}
          {view === "thread" && tabIds.length > 0 ? (
            <div
              className="chat-panel__tabs"
              role="tablist"
              aria-label="Open chats"
              ref={tabsRef}
            >
              {orderedTabIds.map((id) => {
                const row = sessions.find((s) => s.id === id) ?? null;
                const tabRun = chat.runOf(id);
                const label = row ? sessionLabel(row) : "Chat";
                const pinned = row?.pinned === true;
                const live = tabRun.sending;
                const waiting = tabRun.approval !== null;
                // The square has room for one glyph, so it takes the first
                // letter of the whitespace-trimmed label, uppercased.
                const letter = (Array.from(label.trim())[0] ?? "?").toUpperCase();
                return (
                  <div
                    key={id}
                    role="presentation"
                    className={[
                      "chat-panel__tab",
                      pinned ? "chat-panel__tab--pinned" : "",
                      id === sessionId ? "chat-panel__tab--active" : "",
                      live ? "chat-panel__tab--live" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-pinned={pinned || undefined}
                    data-live={live || undefined}
                    data-approval={waiting || undefined}
                    onContextMenu={(e) => openTabMenu(e, id, pinned)}
                    onAuxClick={(e) => closeTabOnMiddlePress(e, id, pinned)}
                    onMouseDown={(e) => {
                      // The press half of the middle-click close: without this
                      // the browser's autoscroll quest starts under the strip.
                      if (e.button === 1) e.preventDefault();
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={id === sessionId}
                      className="chat-panel__tab-main"
                      aria-label={pinned ? `${label} — pinned tab` : undefined}
                      title={
                        pinned
                          ? `${label} — pinned tab`
                          : `${label} — middle-click to close`
                      }
                      onClick={() => {
                        if (id === sessionId) {
                          setView("thread");
                          return;
                        }
                        void openSession(id);
                      }}
                    >
                      {pinned ? (
                        <>
                          <span className="chat-panel__tab-letter" aria-hidden>
                            {letter}
                          </span>
                          <Pin
                            className="chat-panel__tab-pin"
                            size={10}
                            fill="currentColor"
                            aria-hidden
                          />
                        </>
                      ) : (
                        <>
                          <span className="chat-panel__tab-dot" aria-hidden />
                          <span className="chat-panel__tab-label">{label}</span>
                        </>
                      )}
                    </button>
                    {pinned ? null : (
                      <button
                        type="button"
                        className="chat-panel__tab-close"
                        aria-label={`Close ${label}`}
                        title={`Close ${label}`}
                        onClick={() => chat.closeTab(id)}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    )}
                  </div>
                );
              })}
              {/*
                The strip's own door: a new blank conversation in a tab of its
                own, beside the chat in front. It is the sidebar's New chat slot
                in miniature — the same store action, the same one-blank-at-a-
                time rule — set after the last tab the way a browser sets its
                plus. It sticks to the band's trailing edge while the strip
                scrolls, so a full strip never hides the way to a new one.
              */}
              <button
                type="button"
                className="chat-panel__tab-new"
                aria-label="New chat tab"
                title="New chat tab"
                onClick={() => void newSession()}
              >
                <Plus size={13} aria-hidden />
              </button>
            </div>
          ) : null}
          {view === "chain" ? (
            <div className="chat-panel__header">
              <p className="chat-panel__heading">Quick Notes</p>
            </div>
          ) : view === "shortcuts" ? (
            /*
              The dock's bottom bar opens this page onto the panel. It
              shares the thread's header shape — a way back, the page's name, and
              the one control the page needs — but its body is a reference, not a
              conversation, so there is no composer under it and the tab strip
              is not drawn with it.
            */
            <div className="chat-panel__header chat-panel__header--shortcuts">
              <button
                type="button"
                className="chat-panel__icon-btn"
                aria-label="Back to chat"
                title="Back to chat"
                onClick={() => setView("thread")}
              >
                <ArrowLeft size={16} aria-hidden />
              </button>
              <p className="chat-panel__heading chat-panel__heading--thread">
                Keyboard shortcuts
              </p>
              <div className="chat-panel__header-actions">
                <Link
                  to="/settings?tab=shortcuts"
                  className="chat-panel__icon-btn"
                  aria-label="Change keyboard shortcuts in Settings"
                  title="Change in Settings"
                >
                  <Pencil size={16} aria-hidden />
                </Link>
              </div>
            </div>
          ) : (
            <div className="chat-panel__header chat-panel__header--thread">
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
                </>
              )}
            </div>
          )}
          {/*
            The tab's menu, drawn at the pointer in the window's own coordinates.
            It is portalled to the document because the strip is a horizontal
            scroll port and the dock is a z-indexed column: a menu laid out
            inside either is clipped by the strip's edge or ordered under the
            shell's own paint. The layout effect above clamps it inside the
            window, and the stylesheet keeps it under the app's dialogs.
          */}
          {tabMenu
            ? createPortal(
                <div
                  className="chat-panel__tab-menu"
                  role="menu"
                  aria-label="Tab actions"
                  ref={tabMenuRef}
                  data-menu-for={tabMenu.pinned ? "pinned" : "unpinned"}
                  data-tab-id={tabMenu.id}
                  style={{
                    left: tabMenuPos?.left ?? tabMenu.x,
                    top: tabMenuPos?.top ?? tabMenu.y,
                    visibility: tabMenuPos ? "visible" : "hidden",
                  }}
                >
                  {tabMenu.pinned ? (
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Unpin chat"
                      onClick={() => unpinTab(tabMenu.id)}
                    >
                      <Pin size={12} fill="currentColor" aria-hidden /> Unpin
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Pin chat"
                        onClick={() => pinTab(tabMenu.id)}
                      >
                        <Pin size={12} aria-hidden /> Pin
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Rename chat"
                        onClick={() => renameTab(tabMenu.id)}
                      >
                        <Pencil size={12} aria-hidden /> Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Archive chat"
                        onClick={() => archiveTab(tabMenu.id)}
                      >
                        <Archive size={12} aria-hidden /> Archive
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Delete chat"
                        className="chat-panel__tab-menu-danger"
                        onClick={() => deleteTab(tabMenu.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>,
                document.body,
              )
            : null}

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
                      if (!sessionId) return;
                      chat.approve(
                        sessionId,
                        approval.runId,
                        approval.requestId,
                        true,
                      );
                    }}
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    className="chat-panel__text-btn"
                    onClick={() => {
                      if (!sessionId) return;
                      chat.approve(
                        sessionId,
                        approval.runId,
                        approval.requestId,
                        false,
                      );
                    }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ) : null}

            {turns.length === 0 && !sending ? (
              <div className="chat-panel__empty">
                <div className="chat-panel__empty-orb" aria-hidden />
                <p className="chat-panel__empty-title">{`Ask ${companionName}`}</p>
                <p className="chat-panel__empty-copy">
                  {companionContext?.harness === "pi"
                    ? `This is the built-in LifeQuest companion. Active area: ${domainName}.`
                    : `This is your LifeQuest companion on the ${
                        companionContext?.profile ?? "lifequest"
                      } Hermes profile. Active area: ${domainName}.`}
                </p>
                {/*
                  The saved questions that fit this screen. One click sends the
                  question as the first turn, so a new chat can start from a
                  thought the operator has already phrased well. The chip names
                  the scope because a domain prompt and a page prompt can sit
                  side by side here.
                */}
                {starters.length > 0 ? (
                  <div className="chat-panel__starters" data-testid="chat-starters">
                    <p className="chat-panel__starters-title">Start with a question</p>
                    <ul className="chat-panel__starters-list">
                      {starters.map((question) => (
                        <li key={question.id}>
                          <button
                            type="button"
                            className="chat-panel__starter"
                            data-testid="chat-starter"
                            data-question-id={question.id}
                            disabled={sending}
                            onClick={() => void askStarter(question)}
                          >
                            <MessageCircleQuestion size={14} aria-hidden />
                            <span className="chat-panel__starter-text">
                              {question.text}
                            </span>
                            <span className="chat-panel__starter-scope">
                              {starterScopeLabel(question, snapshot?.domains ?? [])}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/*
                      The way back to the page that writes these prompts. The
                      operator is looking at saved questions, so editing one —
                      or adding another — should not mean hunting through the
                      settings root for them. The link stays under the list,
                      where the choice was just made.
                    */}
                    <Link
                      to="/settings?tab=questions"
                      className="chat-panel__link chat-panel__starters-edit"
                      data-testid="chat-questions-settings-link"
                      aria-label="Edit the saved questions in Settings"
                    >
                      <Pencil size={12} aria-hidden />
                      Edit questions
                    </Link>
                  </div>
                ) : null}
                {/*
                  No saved question fits this screen. The way out is the page
                  that writes them, linked where the operator is already
                  looking — not the settings root, which opens Appearance and
                  says nothing about questions.
                */}
                {starters.length === 0 ? (
                  <div
                    className="chat-panel__empty-questions"
                    data-testid="chat-empty-questions"
                  >
                    <p className="chat-panel__empty-questions-title">
                      No questions set
                    </p>
                    <p className="chat-panel__empty-copy">
                      You can set your custom questions{" "}
                      <Link
                        to="/settings?tab=questions"
                        className="chat-panel__link"
                        data-testid="chat-questions-settings-link"
                        aria-label="Set your custom questions in Settings"
                      >
                        here
                      </Link>
                      .
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="chat-panel__messages" aria-live="polite">
                <TurnTimeline
                  turns={turns}
                  capabilities={capabilities}
                  companionName={companionName}
                  latestTurnId={turns[turns.length - 1]?.turnId ?? null}
                  copied={copied}
                  onCopy={(id, content) => void copyMessage(id, content)}
                  onToggleFold={(turnId, open) => {
                    if (sessionId) chat.setTurnFoldOpen(sessionId, turnId, open);
                  }}
                />
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
                  : "No unassigned or matching signals in this area."}
              </p>
            ) : (
              <ul
                className="chat-panel__chain-list"
                aria-label="Quick Notes signals"
              >
                {chainItems.map(signalRow)}
              </ul>
            )}
          </div>

          {/*
            The shortcuts reference, as the dock's fourth surface: every movement
            and the keys it currently answers to, read from the same table the
            Settings page edits. It has no composer — there is nothing to send
            from a reference — and its one write path is the pencil in the header,
            which opens the editable page over the app.
          */}
          <div
            className="chat-panel__body chat-panel__body--shortcuts"
            hidden={view !== "shortcuts"}
          >
            {/* Mounted only while it is the surface: the page reads the
                shortcuts provider, and a shell mounted without one should not
                pay for a page it cannot show. */}
            {view === "shortcuts" ? <ChatShortcutsPage /> : null}
          </div>

          <div
            className="chat-panel__footer"
            hidden={view === "shortcuts"}
          >
            {/*
              The interview, above the composer rather than in the transcript:
              it is the app speaking, it must not scroll away with the
              conversation, and the thread's `aria-live` must not announce it as
              if the companion had said it. Thread surface only — the chain and
              the shortcuts reference have no interview to open.
            */}
            {view === "thread" ? (
              <OnboardingCards
                status={snapshot?.onboarding?.status ?? "completed"}
                proposal={snapshot?.onboardingProposal ?? null}
                busy={onboardingBusy}
                onBegin={() => void beginOnboarding()}
                onContinue={() => void continueOnboarding()}
                onAcknowledge={() => void acknowledgeOnboarding()}
              />
            ) : null}
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
                  // A dropped picture is a receipt, the way a pasted one is:
                  // the finance flow reads that chip. Anything else is a
                  // general attachment, so a clip or a document dropped on the
                  // composer is not silently ignored.
                  const files = Array.from(e.dataTransfer?.files ?? []);
                  if (files.length === 0) return;
                  e.preventDefault();
                  const picture = imageFrom(e.dataTransfer.files);
                  if (picture) {
                    void attachReceipt(picture);
                    return;
                  }
                  for (const file of files) void attachFile(file);
                }}
              >
                {/*
                  The cards this chat is about, above the field.

                  They sit here rather than in the transcript because they are
                  not something either side said: they are what the next turn
                  will be about, and they stay until the operator takes each off.
                  The field below keeps the placeholder it always had — cards in
                  context do not change what the composer is for, only what
                  "this card" means inside it.
                */}
                {contextCards.length > 0 ? (
                  <div className="chat-panel__contexts" data-testid="chat-context-pills">
                    {contextCards.map((card) => (
                      <div
                        key={card.pin.id}
                        className="chat-panel__context"
                        data-testid="chat-context-pill"
                        data-context-pin-id={card.pin.id}
                      >
                        <MessageSquare size={12} aria-hidden />
                        <span className="chat-panel__context-label" title={card.label}>
                          {card.label}
                        </span>
                        <span className="chat-panel__context-kind">in context</span>
                        <button
                          type="button"
                          className="chat-panel__context-remove"
                          data-testid="chat-context-remove"
                          data-context-pin-id={card.pin.id}
                          aria-label={`Remove "${card.label}" from context`}
                          title="Remove card from context"
                          onClick={() => removeCardContext(card.pin.id)}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {/*
                  The attachments waiting to ride this chat's next turn, above the
                  field: one chip per file, each with its own remove. They ride
                  the field rather than a panel of their own, because they belong
                  to the message being written — removing one is a small edit to
                  that message, not a change to the chat.
                */}
                {attachments.length > 0 ? (
                  <div
                    className="chat-panel__attachments"
                    data-testid="chat-attachments"
                  >
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="chat-panel__attachment"
                        data-testid="chat-attachment"
                        data-attachment-kind={attachment.kind}
                      >
                        {attachment.kind === "image" && attachment.previewUrl ? (
                          <img
                            className="chat-panel__attachment-thumb"
                            src={attachment.previewUrl}
                            alt=""
                          />
                        ) : (
                          <span className="chat-panel__attachment-icon" aria-hidden>
                            <Paperclip size={12} />
                          </span>
                        )}
                        <span className="chat-panel__attachment-name">
                          {attachment.name}
                        </span>
                        <span className="chat-panel__receipt-size">
                          {formatReceiptSize(attachment.size)}
                        </span>
                        <button
                          type="button"
                          className="chat-panel__attachment-remove"
                          aria-label={`Remove ${attachment.name}`}
                          title={`Remove ${attachment.name}`}
                          onClick={() => removeAttachment(attachment.id)}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {/*
                  The composer's own surface: one box around the field the
                  operator writes in and the control row that belongs to it.
                  The field rests on top; the row sits inside the box's bottom
                  edge. That is what makes the model and thinking picks, the
                  send control, the add/receipt controls and the page pill part
                  of the composer rather than a footer line under it — and it is
                  why the accent ring is on this box instead of on the field.
                */}
                <div className="chat-panel__composer-box">
                  <textarea
                    ref={inputRef}
                    className="chat-panel__composer-input chat-panel__composer-input--frameless"
                    placeholder={
                      sending
                        ? "Steer the turn that is running…"
                        : `Message ${companionName}…`
                    }
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={(e) => {
                      // A pasted screenshot is a receipt too: take the image and
                      // leave any pasted text to the field's own handling. The
                      // paste is a receipt and not a general attachment
                      // because a receipt is what the finance flow reads: the
                      // file is cited as a transaction's source, and that is a
                      // different promise from "the agent may look at this".
                      const file = imageFrom(e.clipboardData?.files ?? null);
                      if (!file) return;
                      e.preventDefault();
                      void attachReceipt(file);
                    }}
                    disabled={!sessionId}
                    rows={2}
                    aria-label={`Message ${companionName}`}
                    autoComplete="off"
                  />
                  {/*
                    The row inside the box's bottom edge: the composer's own
                    controls, split by the work they do. The leading cluster is
                    what a turn can carry — the add control, the receipt
                    control, the page pill and the waiting receipt — so they sit
                    at the bottom left where the field starts. The trailing
                    cluster is what the turn runs on and how it goes — the
                    model and thinking picks, then the send/stop control — at
                    the bottom right.
                  */}
                  <div className="chat-panel__composer-dock">
                    <div className="chat-panel__composer-lead">
                      {/*
                        The two file pickers stay mounted here, hidden, so the
                        controls beside them can open one and the change still
                        lands on the composer's own handlers. They are the two
                        flows, not one: this field takes any media or file as a
                        general attachment, the image-plus beside it takes one
                        picture as a finance receipt. A receipt is what the
                        ledger cites as a transaction's source; an attachment is
                        only something the agent may look at. They share a
                        corner, not a job.
                      */}
                      <input
                        ref={attachmentInputRef}
                        className="chat-panel__attachment-input"
                        type="file"
                        multiple
                        aria-label="Attach a file"
                        data-testid="chat-attachment-input"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          for (const file of files) void attachFile(file);
                          // Clear the picker so choosing the same file twice
                          // still fires a change event.
                          e.target.value = "";
                        }}
                      />
                      <input
                        ref={receiptInputRef}
                        className="chat-panel__receipt-input"
                        type="file"
                        accept="image/png,image/jpeg"
                        aria-label="Receipt image"
                        onChange={(e) => {
                          const file = imageFrom(e.target.files);
                          if (file) void attachReceipt(file);
                          // Clear the picker so choosing the same file twice
                          // still fires a change event.
                          e.target.value = "";
                        }}
                      />
                      {/*
                        The add control, at the bottom left of the composer: it
                        is the first gesture of the row, so it wears a circular
                        background — the one control-shaped spot the eye lands
                        on in a mostly type-only row — and takes any media or
                        file the operator picks.
                      */}
                      <button
                        type="button"
                        className="chat-panel__composer-plus"
                        data-testid="chat-attachment-button"
                        disabled={!sessionId}
                        aria-label="Attach a file"
                        title="Attach a file"
                        onClick={() => attachmentInputRef.current?.click()}
                      >
                        <Plus size={15} aria-hidden />
                      </button>
                      <div className="chat-panel__receipts">
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

                        {/*
                          The page, beside the receipt control and wearing its shape:
                          one pill that says which screen rides the next turn.

                          It defaults to on and re-arms on every navigation, because
                          the failure it answers is an agent that offered to build a
                          card the screen was already showing. The operator can turn
                          it off — sometimes the question is about something else —
                          and the pill stays on the line in its off state, because a
                          control that vanished when used could not be turned back
                          on.
                        */}
                        <button
                          type="button"
                          className="chat-panel__page"
                          data-state={pageContext.on ? "on" : "off"}
                          data-testid="chat-page-context"
                          aria-pressed={pageContext.on}
                          aria-label={
                            pageContext.on
                              ? `Page context on: the ${pageContext.label} screen rides your next message`
                              : `Page context off: the ${pageContext.label} screen will not be sent`
                          }
                          title={
                            pageContext.on
                              ? `The ${pageContext.label} screen is sent with your message — click to stop sending it`
                              : `The ${pageContext.label} screen is not sent — click to send it again`
                          }
                          onClick={() => setPageContextOn(!pageContext.on)}
                        >
                          {pageContext.on ? (
                            <Eye size={12} aria-hidden />
                          ) : (
                            <EyeOff size={12} aria-hidden />
                          )}
                          <span
                            className="chat-panel__page-label"
                            data-testid="chat-page-context-label"
                          >
                            {pageContext.label}
                          </span>
                          <span className="chat-panel__page-kind">
                            {pageContext.on ? "in context" : "off"}
                          </span>
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
                    </div>
                    {/*
                      The turn's runtime pick and the send control: the trailing
                      end of the composer's control row. The model and thinking
                      pills are what the next turn runs on; the send/stop control is
                      how it goes. They sit at the bottom right, where the operator
                      finishes a thought, and the send only appears once there is
                      something to send — an empty composer is a writing surface
                      first.
                    */}
                    <div className="chat-panel__composer-trail">
                      {/*
                        The dock's version of the Hermes Desktop composer's model
                        and reasoning pills. Every control in it is
                        `type="button"` - nothing here can submit the field above
                        it. Absent entirely when the gateway served no catalog,
                        which leaves the add and receipt controls carrying the left
                        end of the row alone.
                      */}
                      <ComposerModelControls
                        catalog={modelCatalog}
                        disabled={sending || !sessionId}
                        pick={runtimePick}
                        onChange={updateRuntimePick}
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
                  </div>
                </div>
                {/*
                  While a turn is running, the composer stays open and gains the
                  two ways a thought can follow the one that is already working:
                  steer it into the live turn, or line it up to run next. The
                  line only appears while there is something to say — an idle
                  composer under a live turn is just the field.
                */}
                {sending && draft.trim() ? (
                  <div className="chat-panel__composer-live">
                    <button
                      type="button"
                      className="chat-panel__composer-live-action"
                      data-testid="chat-steer-button"
                      disabled={!runId}
                      aria-label="Steer this turn"
                      title="Send this to the turn that is running now"
                      onClick={() => void steerMessage(draft.trim())}
                    >
                      Steer
                    </button>
                    <button
                      type="button"
                      className="chat-panel__composer-live-action"
                      data-testid="chat-queue-button"
                      aria-label="Queue this message"
                      title="Run this message after the turn that is running now"
                      onClick={() => queueMessage(draft.trim())}
                    >
                      Queue
                    </button>
                  </div>
                ) : null}
                {queued.length > 0 ? (
                  <ul
                    className="chat-panel__queued"
                    data-testid="chat-queued"
                    aria-label="Queued messages"
                  >
                    {queued.map((entry) => (
                      <li
                        key={entry.id}
                        className="chat-panel__queued-row"
                        data-testid="chat-queued-row"
                      >
                        <span className="chat-panel__queued-label">Queued</span>
                        <span className="chat-panel__queued-text">{entry.text}</span>
                        <button
                          type="button"
                          className="chat-panel__queued-remove"
                          aria-label="Remove queued message"
                          title="Remove queued message"
                          onClick={() => removeQueued(entry.id)}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </form>
            )}
          </div>

          {/*
            The dock's own actions, pinned to the bottom of the bar and shared by
            every surface. The bar leads with the new-chat slot: the whole
            history lives in the sidebar, so this bar does not carry a second
            entry point to it. The chain is the dock's second way into the
            Life-Chain, alongside the rail's, and the side-switch and collapse
            controls trail the group at the bar's far right.
          */}
          <nav className="chat-panel__actions" aria-label="Dock actions">
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="New chat"
              title="New chat"
              onClick={() => void newSession()}
            >
              <SquarePen size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action"
              aria-label="Quick Notes"
              title="Quick Notes"
              aria-pressed={view === "chain"}
              onClick={() => setView(view === "chain" ? "thread" : "chain")}
            >
              <Radio size={20} aria-hidden />
            </button>
            {/*
              The keyboard-shortcuts reference, at the head of the trailing
              group and beside the switch it now shares the corner with: it is a
              surface selector like the chain, and the dock is the only place it
              belongs now that the titlebar no longer carries it. Pressed while
              the reference is the surface in front of the operator.
            */}
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action chat-panel__action--shortcuts"
              data-testid="chat-shortcuts-action"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
              aria-pressed={view === "shortcuts"}
              onClick={() => setView("shortcuts")}
            >
              <Keyboard size={20} aria-hidden />
            </button>
            {/*
              The switch-position control, beside the collapse it belongs with:
              one click trades the dock's column for the sheet's, so the chat
              panel sits just past the rail and the page takes the window's
              trailing edge. The icon is the two panes swapping sides rather
              than the side they are on — the state it is in is read off the
              layout in front of the operator. It is a move, not a toggle, so
              it carries no pressed state: a dock living on the leading edge is
              an arrangement to work in, not a mode left switched on, and the
              bar must rest as plain chrome on either side.
            */}
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action chat-panel__action--side"
              data-testid="chat-side-switch"
              aria-label={
                dockSide === "left"
                  ? "Move chat to the right of the page"
                  : "Move chat to the left of the page"
              }
              title={
                dockSide === "left"
                  ? "Move chat to the right of the page"
                  : "Move chat to the left of the page"
              }
              onClick={swapSide}
            >
              <ArrowLeftRight size={20} aria-hidden />
            </button>
            {/*
              The way out, at the trailing end of the bar: where the operator's
              hand already is when they are done with the dock, the bottom-right
              corner, one click from the icon that brings it back.
            */}
            <button
              type="button"
              className="chat-panel__icon-btn chat-panel__action chat-panel__action--collapse"
              data-testid="chat-collapse"
              aria-label="Collapse chat"
              title="Collapse chat"
              onClick={() => onOpenChange(false)}
            >
              {dockSide === "left" ? (
                <PanelLeftClose size={20} aria-hidden />
              ) : (
                <PanelRightClose size={20} aria-hidden />
              )}
            </button>
            {/*
              The build number, and the app's manual update check, at the bar's
              trailing end: the operator's hand is already here when they are done
              with the dock, and the number is chrome, not a page. It stays a
              control in every state; the glow is what says a release is waiting.
            */}
            <UpdateBadge />
          </nav>
        </div>

      {/* The dock's own confirmation. It is drawn over the window, not the panel:
          the question is about a chat, and a platform dialog would put it on the
          display instead of in the window the application is running in. */}
      {dialog}
    </aside>
  );
}
