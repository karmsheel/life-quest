"use client";

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
import {
  CHATBAR_RESIDENCY_MODES,
  CHATBAR_SIDES,
  DEFAULT_CHATBAR_RESIDENCY,
  DEFAULT_CHATBAR_SIDE,
  loadChatbarResidency,
  loadChatbarSide,
  normalizeChatbarResidency,
  normalizeChatbarSide,
  saveChatbarResidency,
  saveChatbarSide,
  toggleChatbarResidency,
  toggleChatbarSide,
  type ChatbarResidency,
  type ChatbarSide,
} from "@/lib/chatbar/residency";
import { hermesApiBody } from "@/lib/hermes-models";
import { loadHermesConfig } from "@/lib/hermes-storage";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatbarContextValue = {
  residency: ChatbarResidency;
  isOpen: boolean;
  open: () => void;
  collapse: () => void;
  toggle: () => void;
  setResidency: (r: ChatbarResidency) => void;

  side: ChatbarSide;
  isLeft: boolean;
  isRight: boolean;
  setSide: (side: ChatbarSide) => void;
  swapSide: () => void;

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
  const [residency, setResidencyState] = useState<ChatbarResidency>(
    DEFAULT_CHATBAR_RESIDENCY,
  );
  const [side, setSideState] = useState<ChatbarSide>(DEFAULT_CHATBAR_SIDE);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sendingRef = useRef(false);

  // Hydrate residency + side from localStorage after mount (SSR-safe).
  useEffect(() => {
    setResidencyState(loadChatbarResidency());
    setSideState(loadChatbarSide());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveChatbarResidency(residency);
  }, [residency, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveChatbarSide(side);
  }, [side, hydrated]);

  const setResidency = useCallback((r: ChatbarResidency) => {
    setResidencyState(normalizeChatbarResidency(r));
  }, []);

  const setSide = useCallback((s: ChatbarSide) => {
    setSideState(normalizeChatbarSide(s));
  }, []);

  const open = useCallback(() => {
    setResidencyState(CHATBAR_RESIDENCY_MODES.OPEN);
  }, []);

  const collapse = useCallback(() => {
    setResidencyState(CHATBAR_RESIDENCY_MODES.COLLAPSED);
  }, []);

  const toggle = useCallback(() => {
    setResidencyState((current) => toggleChatbarResidency(current));
  }, []);

  const swapSide = useCallback(() => {
    setSideState((current) => toggleChatbarSide(current));
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

    const config = loadHermesConfig();
    if (!config?.apiKey) {
      setError(
        "Not connected to Hermes. Open Settings or reconnect from the home screen.",
      );
      return;
    }

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
        body: JSON.stringify({
          messages: payload,
          ...hermesApiBody(config),
        }),
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

  const isOpen = residency === CHATBAR_RESIDENCY_MODES.OPEN;
  const isLeft = side === CHATBAR_SIDES.LEFT;
  const isRight = side === CHATBAR_SIDES.RIGHT;

  const value = useMemo(
    () => ({
      residency,
      isOpen,
      open,
      collapse,
      toggle,
      setResidency,
      side,
      isLeft,
      isRight,
      setSide,
      swapSide,
      messages,
      sending,
      error,
      clearError,
      clearMessages,
      sendMessage,
    }),
    [
      residency,
      isOpen,
      open,
      collapse,
      toggle,
      setResidency,
      side,
      isLeft,
      isRight,
      setSide,
      swapSide,
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
