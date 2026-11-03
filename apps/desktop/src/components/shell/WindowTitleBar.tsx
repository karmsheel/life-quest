import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
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
import { useVault } from "@/state/VaultProvider";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { windowTitleLabel } from "./window-title";

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
  const label = windowTitleLabel(snapshot?.lifequest.name);
  const [fallbackControls, setFallbackControls] = useState(false);
  const [maximized, setMaximized] = useState(false);

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
    <header className="window-titlebar">
      {/*
        The strip's leading half is just the window's drag handle now: the vault
        that used to be named here lives at the foot of the sidebar, with the rest
        of the navigation. The box stays because the macOS titlebar area is
        carved out of this half with `env(titlebar-area-*)`, and because it keeps
        the trailing controls on the trailing edge.
      */}
      <div className="window-titlebar__leading" />
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
  );
}
