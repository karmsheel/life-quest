import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { useVault } from "@/state/VaultProvider";
import { DomainSwitcher } from "./DomainSwitcher";
import { ThemeQuickMenu } from "./ThemeQuickMenu";
import { windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
  const { collapsed: navCollapsed } = useNavDock();
  const { present: chatPresent } = useChatDock();
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
        The leading track is the window's drag handle and nothing else: the vault
        that used to be named here lives at the foot of the sidebar, with the rest
        of the navigation. The box stays because the tab is centred by the two
        outer tracks sharing the slack equally, and this is the leading one of
        that pair.
      */}
      <div className="window-titlebar__leading" />
      {showTrailing ? (
        <div className="window-titlebar__trailing">
          {chatPresent ? (
            <>
              {/*
                The day/night control, and the settings it belongs with. The
                keyboard-shortcuts reference moved into the dock's own bottom
                bar, where the surfaces it switches between live: the strip no
                longer carries a second way to change what the dock shows.
              */}
              <ThemeQuickMenu className="window-titlebar__btn" />
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
