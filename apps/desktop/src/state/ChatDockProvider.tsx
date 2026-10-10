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

type ChatDockContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  present: boolean;
  setPresent: (present: boolean) => void;
  requestedSessionId: string | null;
  requestedKickoff: string | null;
  requestSession: (id: string, kickoff?: string) => void;
  clearRequestedSession: () => void;
  /**
   * The card this chat is about, or null. It is the dock's live state like the
   * pending receipt: it belongs to the conversation in front of the operator,
   * not to a file, and it lasts until they take it off the composer.
   */
  contextCard: ChatCardContext | null;
  setContextCard: (card: ChatCardContext | null) => void;
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
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [requestedKickoff, setRequestedKickoff] = useState<string | null>(null);
  const [contextCard, setContextCard] = useState<ChatCardContext | null>(null);
  const { pathname } = useLocation();
  const [pageContextOn, setPageContextOn] = useState(true);

  // The page changed, so the page in context changed with it: the operator is
  // looking at something new, and the pill says so from the moment it draws.
  useEffect(() => {
    setPageContextOn(true);
  }, [pathname]);

  const requestSession = useCallback((id: string, kickoff?: string) => {
    setRequestedSessionId(id);
    setRequestedKickoff(kickoff?.trim() ? kickoff : null);
  }, []);

  const clearRequestedSession = useCallback(() => {
    setRequestedSessionId(null);
    setRequestedKickoff(null);
  }, []);

  const pageLabel = useMemo(() => pageLabelFor(pathname), [pathname]);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      present,
      setPresent,
      requestedSessionId,
      requestedKickoff,
      requestSession,
      clearRequestedSession,
      contextCard,
      setContextCard,
      pageContext: { route: pathname, label: pageLabel, on: pageContextOn },
      setPageContextOn,
    }),
    [
      open,
      present,
      requestedSessionId,
      requestedKickoff,
      requestSession,
      clearRequestedSession,
      contextCard,
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
