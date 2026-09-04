import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { useChatDock } from "@/state/ChatDockProvider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell() {
  const { open: chatOpen, setOpen: setChatOpen, setPresent } = useChatDock();
  const { pathname } = useLocation();
  const chartBleed = pathname === "/chart";

  useEffect(() => {
    setPresent(true);
    return () => setPresent(false);
  }, [setPresent]);

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
            <div
              className={[
                "shell__content",
                chartBleed ? "shell__content--bleed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Outlet />
            </div>
          </div>
          <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
        </div>
      </WingProvider>
    </MapYearProvider>
  );
}
