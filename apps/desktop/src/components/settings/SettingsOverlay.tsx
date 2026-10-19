import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import type { SettingsViewId } from "@/lib/settings-views";
import { SettingsContent } from "./SettingsContent";

/**
 * The settings sheet: Hermes Desktop's full-page overlay, worn by LifeQuest.
 *
 * Settings are not a page in this app — they are a surface over the page you were
 * on. The whole window dims and blurs behind a panel that takes ~90% of it, the
 * section list and the panel scroll inside that frame, and the app underneath is
 * still the app: the rail, the titlebar and the dock stay where they were, out of
 * reach behind the scrim.
 *
 * Three ways out, because a sheet this large has no close-button muscle memory
 * yet: the cross at the top right, a click on the scrim, and Escape. The search
 * bar beside it is the sheet's one field — it narrows the section list in place
 * (`settings-search.ts`) rather than opening a second surface.
 *
 * Portalled to `<body>`: `.shell__content` is a scrolling, padded column, and a
 * fixed scrim painted inside it would be clipped by its scroll box and would
 * still have to outrank the titlebar. The portal makes "90% of the page" mean the
 * window.
 */
export function SettingsOverlay({
  activeView,
  onViewChange,
  onClose,
}: {
  activeView: SettingsViewId;
  onViewChange: (view: SettingsViewId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Escape unwinds one step at a time: a search in progress clears, and only an
   * empty search closes the sheet. Closing a 90% frame by reflex while a query is
   * half-typed is the one dismissal the operator did not ask for.
   *
   * A question asked over the sheet — the app's own confirm, or the update dialog
   * — takes the Escape first: those listen on `window` too, and this listener was
   * registered earlier, so `defaultPrevented` cannot be relied on to tell whose
   * key it is.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".confirm-dialog-backdrop, .update-dialog-backdrop")) {
        return;
      }
      if (query) {
        event.preventDefault();
        setQuery("");
        searchRef.current?.focus();
        return;
      }
      event.preventDefault();
      onClose();
    },
    [onClose, query],
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /**
   * `aria-modal` is a promise that the rest of the app is inert, so the caret has
   * to stay in the frame too: without this, Tab walks off the sheet's last control
   * and into the blurred page behind it, where the operator cannot see what they
   * are about to press.
   *
   * A dialog raised over the sheet (a confirmation) is a `role="dialog"` of its
   * own and owns the caret while it is up — including the sheet's own panel, which
   * is the other dialog in the document.
   */
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[role="dialog"]')) return;
      searchRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  /** The scrim is the frame's negative space: a press that starts there closes. */
  const onScrimMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      onClose();
    },
    [onClose],
  );

  const overlay = (
    <div
      className="settings-overlay"
      role="presentation"
      data-settings-overlay=""
      onMouseDown={onScrimMouseDown}
    >
      <div
        className="settings-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-overlay-title"
      >
        <header className="settings-overlay__chrome">
          <h2 id="settings-overlay-title" className="visually-hidden">
            Settings
          </h2>
          <div className="settings-overlay__search" role="search">
            <Search size={14} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className="settings-overlay__search-input"
              placeholder="Search settings"
              aria-label="Search settings"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="settings-overlay__search-clear"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <X size={12} aria-hidden />
              </button>
            ) : null}
          </div>
          {/* The cross is the sheet's last control, at its top right: the corner
              a hand goes to when the frame has no title bar to close from. */}
          <button
            type="button"
            className="settings-overlay__close"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <SettingsContent
          activeView={activeView}
          onViewChange={onViewChange}
          query={query}
        />
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
