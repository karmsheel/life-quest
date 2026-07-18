"use client";

import type { ReactNode } from "react";
import { ChatbarCollapsedTab } from "@/components/chatbar/ChatbarCollapsedTab";
import { ChatbarPanel } from "@/components/chatbar/ChatbarPanel";
import { useChatbar } from "@/components/chatbar/ChatbarProvider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { useShell } from "./ShellProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const { isOpen, isLeft, side } = useChatbar();
  const { loading, error } = useShell();

  const layoutClass = [
    "app-shell",
    isOpen ? "app-shell--chat-open" : "app-shell--chat-collapsed",
    `app-shell--chat-side-${side}`,
  ].join(" ");

  return (
    <div className={layoutClass}>
      <NavRail />
      {isLeft ? <ChatbarPanel /> : null}
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
      {!isLeft ? <ChatbarPanel /> : null}
      <ChatbarCollapsedTab />
    </div>
  );
}
