/**
 * How the chat dock's text is set: the size the agent's prose is drawn at and
 * the line spacing between its lines.
 *
 * Two gestures write one of these settings — the Settings → Chat display page
 * and the dock's own zoom keys (`Ctrl` plus wheel, `Ctrl` `+` / `-` / `0`) — and
 * the transcript reads it through two CSS custom properties, so every surface
 * that sets chat prose looks the same. The values belong to the window, not the
 * vault: a big monitor and a small laptop want different reading sizes, and the
 * same vault should not have to be told twice.
 *
 * The defaults are the reading settings the dock was asked to wear: normal
 * size, 1.5 line spacing.
 */

export type ChatLineSpacingId = "tight" | "normal" | "relaxed" | "double";

export interface ChatLineSpacingOption {
  id: ChatLineSpacingId;
  /** The word on the settings page's button. */
  label: string;
  /** The CSS `line-height` the option means. */
  value: number;
}

/**
 * The line spacings the page offers. `normal` is the default and the one the
 * dock ships with; the others are one step either side of it and double.
 */
export const CHAT_LINE_SPACING_OPTIONS: readonly ChatLineSpacingOption[] = [
  { id: "tight", label: "Tight", value: 1.3 },
  { id: "normal", label: "Normal", value: 1.5 },
  { id: "relaxed", label: "Relaxed", value: 1.75 },
  { id: "double", label: "Double", value: 2 },
];

/** The size range the zoom gesture walks, in percent of the dock's base size. */
export const CHAT_ZOOM_MIN = 80;
export const CHAT_ZOOM_MAX = 200;
export const CHAT_ZOOM_STEP = 10;

export interface ChatDisplaySettings {
  /** Chat text size, in percent of the dock's base reading size. */
  zoom: number;
  /** The transcript prose's `line-height`. */
  lineSpacing: number;
}

export const DEFAULT_CHAT_DISPLAY_SETTINGS: ChatDisplaySettings = {
  zoom: 100,
  lineSpacing: 1.5,
};

/** The one key this window's reading settings live under. */
export const CHAT_DISPLAY_STORAGE_KEY = "lifequest-chat-display";

/** A zoom the dock can draw, whatever was stored or asked for. */
export function clampChatZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CHAT_DISPLAY_SETTINGS.zoom;
  const stepped = Math.round(zoom / CHAT_ZOOM_STEP) * CHAT_ZOOM_STEP;
  return Math.min(CHAT_ZOOM_MAX, Math.max(CHAT_ZOOM_MIN, stepped));
}

/** A line spacing the page offers, or the default for anything else. */
export function resolveChatLineSpacing(value: number): number {
  return (
    CHAT_LINE_SPACING_OPTIONS.find((option) => option.value === value)?.value ??
    DEFAULT_CHAT_DISPLAY_SETTINGS.lineSpacing
  );
}

/** Read a stored shape defensively: one bad field must not lose the other. */
export function normalizeChatDisplaySettings(value: unknown): ChatDisplaySettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CHAT_DISPLAY_SETTINGS };
  }
  const stored = value as Partial<Record<keyof ChatDisplaySettings, unknown>>;
  return {
    zoom:
      typeof stored.zoom === "number"
        ? clampChatZoom(stored.zoom)
        : DEFAULT_CHAT_DISPLAY_SETTINGS.zoom,
    lineSpacing:
      typeof stored.lineSpacing === "number"
        ? resolveChatLineSpacing(stored.lineSpacing)
        : DEFAULT_CHAT_DISPLAY_SETTINGS.lineSpacing,
  };
}

/** The window's settings, or the defaults when nothing usable is stored. */
export function readChatDisplaySettings(): ChatDisplaySettings {
  if (typeof window === "undefined") return { ...DEFAULT_CHAT_DISPLAY_SETTINGS };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CHAT_DISPLAY_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_CHAT_DISPLAY_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_CHAT_DISPLAY_SETTINGS };
  try {
    return normalizeChatDisplaySettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAT_DISPLAY_SETTINGS };
  }
}

/** Persist the settings. A storage failure is reported, never swallowed. */
export function writeChatDisplaySettings(settings: ChatDisplaySettings): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      CHAT_DISPLAY_STORAGE_KEY,
      JSON.stringify(settings),
    );
    return true;
  } catch {
    return false;
  }
}
