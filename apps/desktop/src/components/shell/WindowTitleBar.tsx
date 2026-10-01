import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Copy, Minus, PanelRightClose, PanelRightOpen, Square, X } from "lucide-react";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { useChatDock } from "@/state/ChatDockProvider";
import { useNavDock } from "@/state/NavDockProvider";
import { useVault } from "@/state/VaultProvider";
import { NavCollapseButton } from "./NavCollapseButton";
import { NavThemeModeToggle } from "./NavThemeModeToggle";
import { vaultTitleName, windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
  const { open: chatOpen, setOpen: setChatOpen, present: chatPresent } =
    useChatDock();
  const { collapsed: navCollapsed, present: navPresent } = useNavDock();
  const label = windowTitleLabel(snapshot?.lifequest.name);
  const vaultName = vaultTitleName(snapshot?.lifequest.name);
  const [fallbackControls, setFallbackControls] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // The rail's column is reserved for the whole shell, collapsed or not: that is
  // what keeps the toggle and the vault chip from sliding when it opens and
  // closes. The welcome flow has no rail, so nothing is reserved there.
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

  return (
    <header
      className={[
        "window-titlebar",
        navColumn ? "window-titlebar--nav-column" : "",
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
              <button
                type="button"
                className="window-titlebar__btn"
                aria-label={chatOpen ? "Collapse chat" : "Expand chat"}
                title={chatOpen ? "Collapse chat" : "Expand chat"}
                onClick={() => setChatOpen(!chatOpen)}
              >
                {chatOpen ? (
                  <PanelRightClose size={14} aria-hidden />
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
