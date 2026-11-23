import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { ChatPanel } from "@/components/hermes/ChatPanel";
import { ChatSessionsProvider } from "@/state/ChatSessionsProvider";
import { useChatDock } from "@/state/ChatDockProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { ChatDivider } from "./ChatDivider";
import { ChromeHosts } from "./ChromeHosts";
import { ThemePreviewBar } from "./ThemePreviewBar";
import { NavRail } from "./NavRail";
import { SceneBackdrop } from "./SceneBackdrop";
import { CompositionSlot } from "@/components/composition/CompositionSlot";
import { PageCoverHold } from "./PageCoverHold";
import { WingProvider } from "./WingProvider";
import { useChatColumn } from "./useChatColumn";
import { MapYearProvider } from "@/state/MapYearProvider";
import { ShortcutRunner } from "./ShortcutRunner";

export function AppShell() {
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    setPresent: setChatPresent,
    side: chatSide,
    setThemeSide,
    focus: chatFocus,
    split: chatSplit,
    layout: chatLayout,
  } = useChatDock();
  const { chrome } = useTheme();
  const { collapsed: navCollapsed, setPresent: setNavPresent } = useNavDock();
  // The tray itself: the frame the dock's column is solved in, and the element a
  // dragged width is written to.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const chatColumn = useChatColumn(shellRef);

  // The worn theme proposes which side the dock lives on. The dock's own swap
  // control still wins for the session once the operator touches it.
  useEffect(() => {
    setThemeSide(chrome.chatDock.side);
  }, [chrome.chatDock.side, setThemeSide]);

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
          {/*
            The runner sits inside the chat store because one of its keys is the
            dock's own: Mod+W closes the tab in front, and the strip it closes
            from is the store's.
          */}
          <ShortcutRunner />
          <div
            ref={shellRef}
            style={chatColumn.shellStyle}
            /*
              While the hand owns the seam every other cursor in the tray is the
              resize cursor, so the operator can see the gesture running even when
              the pointer has run off the handle it started on.
            */
            data-divider-dragging={chatColumn.dragging || undefined}
            /*
              Which of the layouts picker's four arrangements the window is
              wearing, published for the same reason the classes below are: the
              arrangement is one fact, and everything that draws it — the
              stylesheet, the rigs, the picker's own card — reads that one fact
              instead of reconstructing it from flags.
            */
            data-layout={chatLayout}
            className={[
              "shell",
              chatOpen ? "shell--chat-open" : "shell--chat-collapsed",
              // Which of the two trailing panes the dock takes: the last column,
              // or the one beside the rail with the sheet pushed out to the
              // window's own trailing edge. The rail holds its column either way.
              chatSide === "left" ? "shell--chat-left" : "shell--chat-right",
              navCollapsed ? "shell--nav-collapsed" : "",
              // Full-screen chat: the page pane is not drawn and the dock takes
              // the workspace beside the rail. The rail stays — it is the
              // window's chrome and holds the chats list — so the tray keeps its
              // leading track and the dock starts where the page used to.
              chatFocus ? "shell--chat-focus" : "",
              // The even split: the page and the dock take a half each of the
              // frame beside the rail, and `shell--chat-left` above says which
              // of the two leads. It is a fixed preset, not a width, so the
              // seam's handle is withdrawn while it is on (see below). Full
              // screen holds the split underneath in the provider, but only the
              // arrangement on screen is announced: the mode's own rules win,
              // and leaving it puts the split back.
              chatSplit && !chatFocus ? "shell--layout-split" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <NavRail />
            <div className="shell__main">
              {/* The theme's decoration layer, behind the page and under the
                  content; it is not part of the page's structure. */}
              <SceneBackdrop />
              {/* The theme's composition widgets for the page's top band. They
                  are page furniture, not chrome: they stand inside the sheet,
                  above the routed content, and never take the way out. */}
              <CompositionSlot region="page.masthead" />
              <div
                className="shell__content"
                /*
                  This column is the page. The dock reads it off this attribute
                  when the operator sends a turn, so what the agent is told about
                  the screen is exactly this subtree — never the rail, the title
                  bar, or the chat panel sitting beside it.
                */
                data-page-context-root=""
              >
                {/* The page's own live view. While a sheet is over this page the
                    subtree keeps the revision and snapshot it last showed, so a
                    queue of answers does not re-run every card query behind a
                    scrim nobody can read through; the sheet leaving hands it the
                    current ones in a single catch-up pass. See `PageCoverHold`. */}
                <PageCoverHold>
                  <Outlet />
                </PageCoverHold>
              </div>
              <CompositionSlot region="page.footer" />
              {/* The polar/quick-action ring: an overlay above the page, not a
                  band in it. It is navigation the theme placed, drawn behind
                  nothing and blocking nothing. */}
              <CompositionSlot region="page.orbit" />
            </div>
            <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
            {/* The handle on the seam, drawn only while there is a column to drag:
                a collapsed dock is one floating mark, not a pane, a full-screen
                dock has no page on its leading side to share a seam with, and an
                even split is a preset rather than a width — its halves are the
                frame's, so there is no number for the handle to move. The
                layouts picker is that arrangement's only door, and the studio
                card brings the handle back. */}
            {chatOpen && !chatFocus && !chatSplit ? (
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
            {/* The chrome the worn theme moved here, and the bar that asks
                before a previewed theme stays. Both paint over the shell, not
                in its grid: a theme may move a control without relaying out the
                page underneath it. */}
            <ChromeHosts />
            <ThemePreviewBar />
          </div>
        </ChatSessionsProvider>
      </WingProvider>
    </MapYearProvider>
  );
}
