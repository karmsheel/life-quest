import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  ArrowLeftRight,
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  X,
} from "lucide-react";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { useVault } from "@/state/VaultProvider";
import { NavCollapseButton } from "./NavCollapseButton";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { vaultTitleName, windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    present: chatPresent,
    side: chatSide,
    swapSide,
  } = useChatDock();
  const { collapsed: navCollapsed, present: navPresent } = useNavDock();
  const label = windowTitleLabel(snapshot?.lifequest.name);
  const vaultName = vaultTitleName(snapshot?.lifequest.name);
  const [fallbackControls, setFallbackControls] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // The sidebar's column is reserved while it is up, so the chip starts where the
  // sheet does. Collapsed, the column goes back and the chip takes the window's
  // leading edge with the re-open toggle in front of it. The welcome flow has no
  // sidebar, so nothing is reserved there.
  const navColumn = navPresent;
  const navToggle = navPresent && navCollapsed;

  useEffect(() => {
    document.title = label;
  }, [label]);

  useEffect(() => {
    const chrome = window.lifequest?.windowChrome;
    if (!chrome) return;

    let cancelled = false;
    void chrome.get().then((info) => {
      if (!cancelled) {
        setFallbackControls(!info.overlay && info.platform !== "darwin");
      }
    });
    void chrome.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    const unsub = chrome.onMaximizeChange(setMaximized);

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const chrome = window.lifequest?.windowChrome;
  const showTrailing = chatPresent || (fallbackControls && Boolean(chrome));
  const chatOnLeft = chatSide === "left";

  return (
    <header
      className={[
        "window-titlebar",
        navColumn ? "window-titlebar--nav-column" : "",
        navColumn && navCollapsed ? "window-titlebar--nav-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="window-titlebar__leading">
        {navToggle ? (
          <NavCollapseButton className="window-titlebar__nav-toggle" />
        ) : null}
        <NavLink
          to="/home"
          className="window-titlebar__vault"
          title={label}
          aria-label={label}
        >
          {vaultName}
        </NavLink>
      </div>
      {showTrailing ? (
        <div className="window-titlebar__trailing">
          {chatPresent ? (
            <>
              <NavThemeModeToggle className="window-titlebar__btn" />
              <SettingsMenu
                className="window-titlebar__settings"
                placement="bottom-end"
              />
              {/*
                The switch position control, beside the settings it belongs
                with: one click trades the dock's column for the sheet's, so the
                chat panel sits just past the rail and the page takes the
                window's trailing edge. The icon is the two panes swapping sides
                rather than the side they are on — the state it is in is read
                off the layout in front of the operator.
              */}
              <button
                type="button"
                className="window-titlebar__btn window-titlebar__side-switch"
                aria-label={
                  chatOnLeft
                    ? "Move chat to the right of the page"
                    : "Move chat to the left of the page"
                }
                title={
                  chatOnLeft
                    ? "Move chat to the right of the page"
                    : "Move chat to the left of the page"
                }
                aria-pressed={chatOnLeft}
                onClick={swapSide}
              >
                <ArrowLeftRight size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="window-titlebar__btn window-titlebar__chat-toggle"
                aria-label={chatOpen ? "Collapse chat" : "Expand chat"}
                title={chatOpen ? "Collapse chat" : "Expand chat"}
                onClick={() => setChatOpen(!chatOpen)}
              >
                {chatOpen ? (
                  chatOnLeft ? (
                    <PanelLeftClose size={14} aria-hidden />
                  ) : (
                    <PanelRightClose size={14} aria-hidden />
                  )
                ) : chatOnLeft ? (
                  <PanelLeftOpen size={14} aria-hidden />
                ) : (
                  <PanelRightOpen size={14} aria-hidden />
                )}
              </button>
            </>
          ) : null}
          {fallbackControls && chrome ? (
            <div className="window-titlebar__controls">
              <button
                type="button"
                className="window-titlebar__btn"
                aria-label="Minimize"
                onClick={() => chrome.minimize()}
              >
                <Minus size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="window-titlebar__btn"
                aria-label={maximized ? "Restore" : "Maximize"}
                onClick={() => chrome.toggleMaximize()}
              >
                {maximized ? (
                  <Copy size={12} aria-hidden />
                ) : (
                  <Square size={12} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="window-titlebar__btn window-titlebar__btn--close"
                aria-label="Close"
                onClick={() => chrome.close()}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
