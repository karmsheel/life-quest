import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ChatDockContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  present: boolean;
  setPresent: (present: boolean) => void;
  requestedSessionId: string | null;
  requestedKickoff: string | null;
  requestSession: (id: string, kickoff?: string) => void;
  clearRequestedSession: () => void;
};

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [present, setPresent] = useState(false);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [requestedKickoff, setRequestedKickoff] = useState<string | null>(null);

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
    }),
    [
      open,
      present,
      requestedSessionId,
      requestedKickoff,
      requestSession,
      clearRequestedSession,
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
