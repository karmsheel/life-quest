import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  Keyboard,
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
import { VaultSwitcherDialog } from "./VaultSwitcherDialog";
import { vaultTitleName, windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    present: chatPresent,
    side: chatSide,
    surface: chatSurface,
    setSurface: setChatSurface,
    swapSide,
  } = useChatDock();
  const { collapsed: navCollapsed, present: navPresent } = useNavDock();
  const label = windowTitleLabel(snapshot?.lifequest.name);
  const vaultName = vaultTitleName(snapshot?.lifequest.name);
  const [fallbackControls, setFallbackControls] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  /*
   * Whether the switcher has really been open, so the titlebar does not grab the
   * focus on first paint. It is state, not a ref to the open flag: the effect
   * below must also see the mount where the switcher was never up.
   */
  const switcherWasOpen = useRef(false);

  // When the switcher closes — Escape, the scrim, or a completed switch — focus
  // goes back to the chip that raised it. A dialog that hands focus to <body>
  // strands a keyboard operator at the top of the page.
  useEffect(() => {
    if (switcherWasOpen.current && !switcherOpen) chipRef.current?.focus();
    switcherWasOpen.current = switcherOpen;
  }, [switcherOpen]);

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
    <>
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
          {/*
            The chip names the open vault and is the one control that changes it.
            It used to be a NavLink to /home, which made the app's answer to "am I
            in the right vault?" a click that visibly did nothing. Home is on the
            rail, so the chip is free to do the thing only it can: raise the
            switcher. The caret is the chip's own "this opens something" mark.
          */}
          <button
            ref={chipRef}
            type="button"
            className="window-titlebar__vault"
            title="Switch vault"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={switcherOpen}
            onClick={() => setSwitcherOpen(true)}
          >
            <span className="window-titlebar__vault-name">{vaultName}</span>
            <ChevronDown
              className="window-titlebar__vault-chevron"
              size={12}
              aria-hidden
            />
          </button>
        </div>
        {showTrailing ? (
          <div className="window-titlebar__trailing">
            {chatPresent ? (
              <>
                <NavThemeModeToggle className="window-titlebar__btn" />
                {/*
                  The shortcuts reference, beside the settings it belongs with.
                  The dock is where the page lives — the same bar that carries the
                  chat list and the Life-Chain — so this control opens the dock if
                  it is collapsed and puts the reference on it. Pressed when the
                  dock is already showing it.
                */}
                <button
                  type="button"
                  className="window-titlebar__btn window-titlebar__shortcuts"
                  aria-label="Keyboard shortcuts"
                  title="Keyboard shortcuts"
                  aria-pressed={chatOpen && chatSurface === "shortcuts"}
                  onClick={() => {
                    setChatOpen(true);
                    setChatSurface("shortcuts");
                  }}
                >
                  <Keyboard size={15} aria-hidden />
                </button>
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
      <VaultSwitcherDialog
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </>
  );
}
