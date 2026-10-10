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
              /*
                This column is the page. The dock reads it off this attribute
                when the operator sends a turn, so what the agent is told about
                the screen is exactly this subtree — never the rail, the title
                bar, or the chat panel sitting beside it.
              */
              data-page-context-root=""
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
