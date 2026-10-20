import { useCallback, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SettingsViewId } from "@/lib/settings-views";
import { SheetOverlay } from "@/components/shell/SheetOverlay";
import { SettingsContent } from "./SettingsContent";

/**
 * The settings sheet: Hermes Desktop's full-page overlay, worn by LifeQuest.
 *
 * Settings are not a page in this app — they are a surface over the page you were
 * on (see `SheetOverlay` for the frame and its three ways out). This file is the
 * settings-specific part: the one field in the chrome, which narrows the section
 * list in place (`settings-search.ts`) rather than opening a second surface.
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
   * Escape clears a search in progress before it closes the sheet. Returning
   * true consumes the key, so `SheetOverlay` leaves the frame up.
   */
  const onEscape = useCallback(() => {
    if (!query) return false;
    setQuery("");
    searchRef.current?.focus();
    return true;
  }, [query]);

  return (
    <SheetOverlay
      sheet="settings"
      title="Settings"
      closeLabel="Close settings"
      onClose={onClose}
      onEscape={onEscape}
      initialFocusRef={searchRef}
      header={
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
      }
    >
      <SettingsContent
        activeView={activeView}
        onViewChange={onViewChange}
        query={query}
      />
    </SheetOverlay>
  );
}
