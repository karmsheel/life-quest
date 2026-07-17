"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ChatbarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const ChatbarContext = createContext<ChatbarContextValue | null>(null);

export function ChatbarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, toggle }),
    [open, toggle],
  );

  return (
    <ChatbarContext.Provider value={value}>{children}</ChatbarContext.Provider>
  );
}

export function useChatbar(): ChatbarContextValue {
  const ctx = useContext(ChatbarContext);
  if (!ctx) {
    throw new Error("useChatbar must be used within ChatbarProvider");
  }
  return ctx;
}
