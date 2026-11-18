/**
 * The chat dock's reading settings, held for the window.
 *
 * The settings page edits them, the dock's zoom gestures edit them, and every
 * chat prose surface reads them through the two CSS custom properties the
 * provider publishes as context. One provider above the routes means the page
 * behind the settings sheet and the sheet itself cannot disagree — a line
 * spacing picked in the sheet is already worn by the dock under it.
 *
 * The gestures themselves live here rather than in the dock because they are
 * app-wide keys, not a control of the panel:
 *
 *  - `Ctrl` (or `Cmd`) plus the mouse wheel over the chat dock steps the size,
 *    which is the gesture every reader already knows;
 *  - `Ctrl` `+`, `Ctrl` `-` and `Ctrl` `0` step it up, down and back to normal
 *    from anywhere, including while the settings page is open, so the preview
 *    moves with the keys the page documents.
 *
 * `Ctrl` `+`/`-`/`0` are in `lib/shortcuts.ts`'s reserved list, so a movement
 * cannot be bound over them.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  CHAT_ZOOM_STEP,
  DEFAULT_CHAT_DISPLAY_SETTINGS,
  clampChatZoom,
  readChatDisplaySettings,
  resolveChatLineSpacing,
  writeChatDisplaySettings,
  type ChatDisplaySettings,
} from "@/lib/chat-display";

type ChatDisplayContextValue = {
  /** The two settings as one object, for callers that read both. */
  settings: ChatDisplaySettings;
  /** Chat text size in percent of the dock's base reading size. */
  zoom: number;
  /** The transcript prose's `line-height`. */
  lineSpacing: number;
  /** Set the size directly; out-of-range values are clamped and stepped. */
  setZoom: (zoom: number) => void;
  /** Step the size one notch up (`1`) or down (`-1`). */
  stepZoom: (direction: 1 | -1) => void;
  /** Pick one of the offered line spacings. */
  setLineSpacing: (lineSpacing: number) => void;
  /** Back to 100% and 1.5 line spacing. */
  reset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

const ChatDisplayContext = createContext<ChatDisplayContextValue | null>(null);

export function ChatDisplayProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ChatDisplaySettings>(() =>
    readChatDisplaySettings(),
  );

  // Every change lands in the window's storage, so a reload (and the settings
  // page's own reload in the rigs) wears the same reading size.
  useEffect(() => {
    writeChatDisplaySettings(settings);
  }, [settings]);

  const apply = useCallback((next: Partial<ChatDisplaySettings>) => {
    setSettings((current) => {
      const zoom =
        next.zoom === undefined ? current.zoom : clampChatZoom(next.zoom);
      const lineSpacing =
        next.lineSpacing === undefined
          ? current.lineSpacing
          : resolveChatLineSpacing(next.lineSpacing);
      if (zoom === current.zoom && lineSpacing === current.lineSpacing) {
        return current;
      }
      return { zoom, lineSpacing };
    });
  }, []);

  const setZoom = useCallback(
    (zoom: number) => apply({ zoom }),
    [apply],
  );

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      setSettings((current) => ({
        ...current,
        zoom: clampChatZoom(current.zoom + direction * CHAT_ZOOM_STEP),
      }));
    },
    [],
  );

  const setLineSpacing = useCallback(
    (lineSpacing: number) => apply({ lineSpacing }),
    [apply],
  );

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_CHAT_DISPLAY_SETTINGS });
  }, []);

  /*
   * The keys. The listener is on the window in the capture phase so a sheet
   * that swallows Escape does not also swallow a zoom; the combinations are
   * reserved in the keyboard table, so no movement can be bound over them. The
   * wheel needs `preventDefault` and therefore a non-passive listener; it only
   * acts when the pointer is over the dock, so scrolling a page with Ctrl held
   * is still the platform's own gesture.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key;
      if (key === "+" || key === "=") {
        event.preventDefault();
        stepZoom(1);
        return;
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        stepZoom(-1);
        return;
      }
      if (key === "0") {
        event.preventDefault();
        reset();
      }
    }

    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".chat-panel")) return;
      if (event.deltaY === 0) return;
      event.preventDefault();
      stepZoom(event.deltaY < 0 ? 1 : -1);
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [reset, stepZoom]);

  const value = useMemo<ChatDisplayContextValue>(
    () => ({
      settings,
      zoom: settings.zoom,
      lineSpacing: settings.lineSpacing,
      setZoom,
      stepZoom,
      setLineSpacing,
      reset,
      canZoomIn: settings.zoom < CHAT_ZOOM_MAX,
      canZoomOut: settings.zoom > CHAT_ZOOM_MIN,
    }),
    [reset, setLineSpacing, setZoom, settings, stepZoom],
  );

  return (
    <ChatDisplayContext.Provider value={value}>
      {children}
    </ChatDisplayContext.Provider>
  );
}

/** The reading settings. A page that renders must sit inside the provider. */
export function useChatDisplay(): ChatDisplayContextValue {
  const context = useContext(ChatDisplayContext);
  if (!context) {
    throw new Error("useChatDisplay must be used inside ChatDisplayProvider");
  }
  return context;
}

/**
 * The reading settings when there is a provider, and `null` when there is not.
 * The chat dock is mounted by harness pages without the app's provider stack;
 * those pages get the shipped defaults and no zoom, and the app itself always
 * has the provider, so the fallback cannot mask a missing one in production.
 */
export function useOptionalChatDisplay(): ChatDisplayContextValue | null {
  return useContext(ChatDisplayContext);
}
