"use client";

import type { ReactNode } from "react";
import { ChatbarPanel } from "@/components/chatbar/ChatbarPanel";
import { useChatbar } from "@/components/chatbar/ChatbarProvider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { useShell } from "./ShellProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const { open: chatOpen } = useChatbar();
  const { loading, error } = useShell();

  return (
    <div
      className={[
        "app-shell",
        chatOpen ? "app-shell--chat-open" : "app-shell--chat-collapsed",
      ].join(" ")}
    >
      <NavRail />
      <div className="app-shell__main">
        <TopBar />
        <div className="app-shell__content">
          {loading ? (
            <p className="muted shell-status">Loading workspace…</p>
          ) : null}
          {error && !loading ? (
            <p className="shell-status shell-status--error" role="alert">
              {error}
            </p>
          ) : null}
          {children}
        </div>
      </div>
      <ChatbarPanel />
    </div>
  );
}
