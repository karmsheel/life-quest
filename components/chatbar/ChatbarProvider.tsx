"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatbarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  clearError: () => void;
  clearMessages: () => void;
  sendMessage: (content: string) => Promise<void>;
};

const ChatbarContext = createContext<ChatbarContextValue | null>(null);

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function extractAssistantContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const choices = rec.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const choice = first as Record<string, unknown>;
  const message = choice.message;
  if (message && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }
  // Some gateways put text on delta/text fields even for non-stream.
  if (typeof choice.text === "string") return choice.text;
  return null;
}

export function ChatbarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sendingRef = useRef(false);

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const clearMessages = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sendingRef.current) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };

    const next = [...messagesRef.current, userMsg];
    messagesRef.current = next;
    setMessages(next);

    const payload = next.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    sendingRef.current = true;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        choices?: unknown;
      };

      if (!res.ok) {
        setError(
          data.error ??
            (res.status === 502
              ? "Hermes gateway is unreachable. Check Settings → Hermes."
              : "Failed to send message"),
        );
        return;
      }

      const assistantText = extractAssistantContent(data);
      if (assistantText == null) {
        setError("Hermes returned an empty or unexpected chat response.");
        return;
      }

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: assistantText,
      };
      const withAssistant = [...messagesRef.current, assistantMsg];
      messagesRef.current = withAssistant;
      setMessages(withAssistant);
    } catch {
      setError(
        "Network error talking to Hermes. Check Settings → Hermes and that the gateway is running.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle,
      messages,
      sending,
      error,
      clearError,
      clearMessages,
      sendMessage,
    }),
    [
      open,
      toggle,
      messages,
      sending,
      error,
      clearError,
      clearMessages,
      sendMessage,
    ],
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
