import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { Pin } from "@lifequest/vault-core";
import { pageLabelFor } from "@/lib/page-context";
import type { HermesSession } from "@/vite-env";

/**
 * One chat a page asks the dock to show.
 *
 * The id is the conversation; the rest is material only the page has. `kickoff`
 * is the first turn, sent once the chat is on screen. `automationContext` is the
 * page the operator was reading, riding inside that first turn as hidden
 * reference. `session` is the chat's own row when the page has just created it:
 * Hermes holds it from the moment it is made, while the renderer's list only
 * learns about it on the next read — so the request carries it and the dock
 * adopts it, and the chat is named and listed from its first paint rather than
 * showing up as a bare "Chat".
 */
export type ChatSessionRequest = {
  id: string;
  kickoff?: string;
  automationContext?: string;
  session?: HermesSession;
};

/**
 * One dashboard card the operator has put in front of the chat.
 *
 * The pin travels whole rather than as a flattened shape: it already carries the
 * identity the companion's tools address a card by (`viewId` and its own
 * `domainSlug`, or a page id, or a built-in kind), so there is no second
 * vocabulary to keep in step. `label` is what the board calls the card, read off
 * the card's own heading at the moment the operator asked for it; `boardSlug` is
 * the board it sits on, which is not the same thing as the pin's own domain on
 * the Overview board.
 */
export type ChatCardContext = {
  pin: Pin;
  label: string;
  boardSlug: string | null;
};

/**
 * Which side of the workspace the dock sits on.
 *
 * `right` is the shipped arrangement — rail, sheet, dock, one pane abutting the
 * next. `left` is the same three panes with the last two swapped: the dock takes
 * the middle column and the sheet becomes the trailing one. The rail does not
 * move, because it is not a pane of this tray — it is the window's chrome, and
 * it stays flush to the window's leading edge either way.
 *
 * Like the rail's own collapse, this is session state rather than a stored
 * preference: it is a way of looking at the workspace for a moment, and the
 * dock's bottom action bar puts the control one click away.
 */
export type ChatDockSide = "left" | "right";

/**
 * What the dock is showing: the open thread, the Life-Chain the dock can carry,
 * or the keyboard-shortcuts reference.
 *
 * The all-chats list is not one of them: it lives in the sidebar, where the
 * whole history belongs and where it stays visible beside every page. The dock
 * keeps one chat in front of the operator rather than a second copy of the
 * history.
 *
 * It lives on the dock rather than in the chat store because the titlebar's
 * shortcuts control opens the dock straight onto the reference, and the titlebar
 * stands above the chat store's provider. The chat store still moves it — a
 * chat opening or closing lands the dock on its thread — but the fact itself is
 * "what is this pane showing", which is the dock's business.
 */
export type ChatSurface = "thread" | "chain" | "shortcuts";

type ChatDockContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  present: boolean;
  setPresent: (present: boolean) => void;
  side: ChatDockSide;
  surface: ChatSurface;
  setSurface: (surface: ChatSurface) => void;
  /**
   * The dock's one control over it: the two panes trade places. There is no
   * setter beside it — nothing else in the app has an opinion about which side
   * the dock is on, and a side the operator cannot see is not worth a second
   * entry point.
   */
  swapSide: () => void;
  /**
   * How wide the operator has dragged the dock's column, in px, or null while it
   * is still the width the tokens ask for.
   *
   * The drag writes here rather than into a store on purpose. It is session state
   * exactly as `side` is — a way of looking at the workspace for a moment, set by
   * a handle one gesture away — and the number is a *request*, not the width on
   * screen: the shell clamps it against the frame the dock is standing in when it
   * draws, so a window that shrinks under a wide dock re-caps the pane instead of
   * carrying the old width off the edge. The divider is the one writer.
   */
  width: number | null;
  setWidth: (px: number) => void;
  requestedSessionId: string | null;
  requestedKickoff: string | null;
  /**
   * The chat's own row when the page created it for this request. The dock
   * adopts it into the chat store, so the new conversation has a name, a tab
   * label and a row in the sidebar from the first paint instead of waiting for
   * the gateway's list to be re-read. Null when the page is opening a chat that
   * already exists.
   */
  requestedSession: HermesSession | null;
  /**
   * The page material an automation hands its new chat, if this request came
   * from one. It rides the session request rather than a composer field: it is
   * the page's own content, not something the operator types, and it belongs to
   * the first send of that chat.
   */
  requestedAutomationContext: string | null;
  requestSession: (request: ChatSessionRequest) => void;
  clearRequestedSession: () => void;
  /**
   * The card this chat is about, or null. It is the dock's live state like the
   * pending receipt: it belongs to the conversation in front of the operator,
   * not to a file, and it lasts until they take it off the composer.
   */
  contextCard: ChatCardContext | null;
  setContextCard: (card: ChatCardContext | null) => void;
  /**
   * The card a running companion turn is working on, by pin id, or null.
   *
   * This is the donut, not the filling: it says a turn is under way and which card
   * it is about, and it changes nothing about the card's content. The card redraws
   * itself off the vault's own change signal, exactly as it does for any other
   * write — so a board that was told "this one is being edited" and a board that
   * was not are drawing the same picture. This exists so the operator can see that
   * the quiet card in front of them is the one being worked on rather than one
   * that failed to update.
   *
   * It is set from the chat's own turn events rather than from the vault: the turn
   * begins before any write and ends after the last one, which is the window the
   * operator actually waits through.
   */
  livePinId: string | null;
  setLivePinId: (pinId: string | null) => void;
  /**
   * The screen the operator is on, and whether the next turn will quote it.
   *
   * `on` re-arms on every navigation: walking to another page is the operator
   * saying "this is what I am looking at now", and the page they just arrived
   * on is the one they will ask about. Turning the pill off is about the screen
   * in front of them, so it does not survive the walk to the next one.
   */
  pageContext: { route: string; label: string; on: boolean };
  setPageContextOn: (on: boolean) => void;
};

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [present, setPresent] = useState(false);
  const [side, setSide] = useState<ChatDockSide>("right");
  const [surface, setSurface] = useState<ChatSurface>("thread");
  const [width, setWidth] = useState<number | null>(null);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [requestedKickoff, setRequestedKickoff] = useState<string | null>(null);
  const [requestedSession, setRequestedSession] =
    useState<HermesSession | null>(null);
  const [requestedAutomationContext, setRequestedAutomationContext] = useState<
    string | null
  >(null);
  const [contextCard, setContextCard] = useState<ChatCardContext | null>(null);
  const [livePinId, setLivePinId] = useState<string | null>(null);
  const { pathname } = useLocation();
  const [pageContextOn, setPageContextOn] = useState(true);

  // The page changed, so the page in context changed with it: the operator is
  // looking at something new, and the pill says so from the moment it draws.
  useEffect(() => {
    setPageContextOn(true);
  }, [pathname]);

  const requestSession = useCallback((request: ChatSessionRequest) => {
    setRequestedSessionId(request.id);
    setRequestedKickoff(request.kickoff?.trim() ? request.kickoff : null);
    setRequestedSession(request.session ?? null);
    setRequestedAutomationContext(
      request.automationContext?.trim() ? request.automationContext : null,
    );
  }, []);

  const clearRequestedSession = useCallback(() => {
    setRequestedSessionId(null);
    setRequestedKickoff(null);
    setRequestedSession(null);
    setRequestedAutomationContext(null);
  }, []);

  const swapSide = useCallback(() => {
    setSide((current) => (current === "left" ? "right" : "left"));
  }, []);

  const pageLabel = useMemo(() => pageLabelFor(pathname), [pathname]);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      present,
      setPresent,
      side,
      surface,
      setSurface,
      swapSide,
      width,
      setWidth,
      requestedSessionId,
      requestedKickoff,
      requestedSession,
      requestedAutomationContext,
      requestSession,
      clearRequestedSession,
      contextCard,
      setContextCard,
      livePinId,
      setLivePinId,
      pageContext: { route: pathname, label: pageLabel, on: pageContextOn },
      setPageContextOn,
    }),
    [
      open,
      present,
      side,
      surface,
      swapSide,
      width,
      requestedSessionId,
      requestedKickoff,
      requestedSession,
      requestedAutomationContext,
      requestSession,
      clearRequestedSession,
      contextCard,
      livePinId,
      pathname,
      pageLabel,
      pageContextOn,
    ],
  );

  return (
    <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>
  );
}

export function useChatDock(): ChatDockContextValue {
  const ctx = useContext(ChatDockContext);
  if (!ctx) {
    throw new Error("useChatDock must be used within ChatDockProvider");
  }
  return ctx;
}
