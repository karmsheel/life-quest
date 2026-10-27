import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatSessionsProvider } from "@/state/ChatSessionsProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { ChatDivider } from "./ChatDivider";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { WingProvider } from "./WingProvider";
import { useChatColumn } from "./useChatColumn";
import { MapYearProvider } from "@/state/MapYearProvider";

export function AppShell() {
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    setPresent: setChatPresent,
    side: chatSide,
  } = useChatDock();
  const { collapsed: navCollapsed, setPresent: setNavPresent } = useNavDock();
  const { pathname } = useLocation();
  const chartBleed = pathname === "/chart";
  // The tray itself: the frame the dock's column is solved in, and the element a
  // dragged width is written to.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const chatColumn = useChatColumn(shellRef);

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
        {/*
          The chats outlive the panel: the sidebar lists them, the dock's tabs
          name them, and a running turn must keep streaming while the operator
          is on another page or another thread. The store therefore sits above
          both surfaces, inside the providers it reads the vault and the dock
          from.
        */}
        <ChatSessionsProvider>
          <div
            ref={shellRef}
            style={chatColumn.shellStyle}
            /*
              While the hand owns the seam every other cursor in the tray is the
              resize cursor, so the operator can see the gesture running even when
              the pointer has run off the handle it started on.
            */
            data-divider-dragging={chatColumn.dragging || undefined}
            className={[
              "shell",
              chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
              // Which of the two trailing panes the dock takes: the last column,
              // or the one beside the rail with the sheet pushed out to the
              // window's own trailing edge. The rail holds its column either way.
              chatSide === "left" ? "shell--chat-left" : "shell--chat-right",
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
            {/* The handle on the seam, drawn only while there is a column to drag:
                a collapsed dock is one floating mark, not a pane. */}
            {chatOpen ? (
              <ChatDivider side={chatSide} props={chatColumn.dividerProps} />
            ) : null}
            {/* What the gesture says out loud. A drag has no button to come back
                to, and the handle's own value is only read while it has focus. */}
            <p
              className="visually-hidden"
              role="status"
              aria-live="polite"
              data-testid="chat-divider-status"
            >
              {chatColumn.announce}
            </p>
          </div>
        </ChatSessionsProvider>
      </WingProvider>
    </MapYearProvider>
  );
}
