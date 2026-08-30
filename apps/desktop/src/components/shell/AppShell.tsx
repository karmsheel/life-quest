import { useState } from "react";
import { Outlet } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell() {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <MapYearProvider>
      <WingProvider>
        <div
          className={[
            "shell",
            chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
          ].join(" ")}
        >
          <NavRail />
          <div className="shell__main">
            <TopBar />
            <div className="shell__content">
              <Outlet />
            </div>
          </div>
          <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
        </div>
      </WingProvider>
    </MapYearProvider>
  );
}
