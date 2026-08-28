import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { useVault } from "@/state/VaultProvider";
import { windowTitleLabel } from "./window-title";

export function WindowTitleBar() {
  const { snapshot } = useVault();
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

  return (
    <header className="window-titlebar">
      <span className="window-titlebar__label">{label}</span>
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
    </header>
  );
}
