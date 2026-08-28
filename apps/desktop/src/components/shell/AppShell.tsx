import { useState, type ReactNode } from "react";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div
      className={[
        "shell",
        chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
      ].join(" ")}
    >
      <NavRail />
      <div className="shell__main">
        <TopBar />
        <div className="shell__content">{children}</div>
      </div>
      <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
