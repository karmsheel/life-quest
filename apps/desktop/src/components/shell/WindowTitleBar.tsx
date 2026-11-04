import { useEffect, useState } from "react";
import { Copy, Keyboard, Minus, Square, X } from "lucide-react";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { useVault } from "@/state/VaultProvider";
import { DomainSwitcher } from "./DomainSwitcher";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
  const { collapsed: navCollapsed } = useNavDock();
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    present: chatPresent,
    surface: chatSurface,
    setSurface: setChatSurface,
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

  return (
    <header
      className="window-titlebar"
      data-nav-collapsed={navCollapsed ? "true" : undefined}
    >
      {/*
        The domain lens, raised into the window's strip. It is not a control
        floating in the chrome: it is painted on the page canvas and reaches the
        sheet's own top edge, with the page flaring into the strip at its bottom
        corners, so the operator reads one tab of the page rather than a second
        band above it. Only a mounted shell has a workspace to lens — the welcome
        and companion screens get the empty strip.
      */}
      {chatPresent ? (
        <div className="window-titlebar__lens">
          <DomainSwitcher />
        </div>
      ) : null}
      {/*
        What is left of the strip's leading half is the window's drag handle: the
        vault that used to be named here lives at the foot of the sidebar, with
        the rest of the navigation. The box stays because the macOS titlebar area
        is carved out of this half with `env(titlebar-area-*)`, and because it
        keeps the trailing controls on the trailing edge.
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
                Life-Chain and the dock's own controls — so this control opens
                the dock if it is collapsed and puts the reference on it. Pressed
                when the dock is already showing it.
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
