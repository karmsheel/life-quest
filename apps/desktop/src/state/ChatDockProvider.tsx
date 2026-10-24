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
 * titlebar control that flips it is one click away.
 */
export type ChatDockSide = "left" | "right";

type ChatDockContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  present: boolean;
  setPresent: (present: boolean) => void;
  side: ChatDockSide;
  /**
   * The titlebar's one control over it: the two panes trade places. There is no
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
   * The page material an automation hands its new chat, if this request came
   * from one. It rides the session request rather than a composer field: it is
   * the page's own content, not something the operator types, and it belongs to
   * the first send of that chat.
   */
  requestedAutomationContext: string | null;
  requestSession: (
    id: string,
    kickoff?: string,
    automationContext?: string,
  ) => void;
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
  const [width, setWidth] = useState<number | null>(null);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [requestedKickoff, setRequestedKickoff] = useState<string | null>(null);
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

  const requestSession = useCallback(
    (id: string, kickoff?: string, automationContext?: string) => {
      setRequestedSessionId(id);
      setRequestedKickoff(kickoff?.trim() ? kickoff : null);
      setRequestedAutomationContext(
        automationContext?.trim() ? automationContext : null,
      );
    },
    [],
  );

  const clearRequestedSession = useCallback(() => {
    setRequestedSessionId(null);
    setRequestedKickoff(null);
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
      swapSide,
      width,
      setWidth,
      requestedSessionId,
      requestedKickoff,
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
      swapSide,
      width,
      requestedSessionId,
      requestedKickoff,
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
