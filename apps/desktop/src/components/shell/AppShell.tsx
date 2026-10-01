import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell() {
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    setPresent: setChatPresent,
  } = useChatDock();
  const {
    collapsed: navCollapsed,
    setPresent: setNavPresent,
  } = useNavDock();
  const { pathname } = useLocation();
  const chartBleed = pathname === "/chart";

  useEffect(() => {
    setChatPresent(true);
    return () => setChatPresent(false);
  }, [setChatPresent]);

  useEffect(() => {
    setNavPresent(true);
    return () => setNavPresent(false);
  }, [setNavPresent]);

  return (
    <MapYearProvider>
      <WingProvider>
        <div
          className={[
            "shell",
            chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
            navCollapsed ? "shell--nav-collapsed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
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
