import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Pin } from "@lifequest/vault-core";

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

  const requestSession = useCallback((id: string, kickoff?: string) => {
    setRequestedSessionId(id);
    setRequestedKickoff(kickoff?.trim() ? kickoff : null);
  }, []);

  const clearRequestedSession = useCallback(() => {
    setRequestedSessionId(null);
    setRequestedKickoff(null);
  }, []);

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
    }),
    [
      open,
      present,
      requestedSessionId,
      requestedKickoff,
      requestSession,
      clearRequestedSession,
      contextCard,
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
