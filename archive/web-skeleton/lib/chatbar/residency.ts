/**
 * Global chatbar panel residency.
 * Mirrors open-vs-collapsed residency without browser tab attachment.
 */

export const CHATBAR_RESIDENCY_MODES = Object.freeze({
  OPEN: "open",
  COLLAPSED: "collapsed",
} as const);

export type ChatbarResidency = (typeof CHATBAR_RESIDENCY_MODES)[keyof typeof CHATBAR_RESIDENCY_MODES];

export const CHATBAR_RESIDENCY_STORAGE_KEY = "lifequest.chatbar.residency";

/** First-run default so the elevated dock is discoverable. */
export const DEFAULT_CHATBAR_RESIDENCY: ChatbarResidency = CHATBAR_RESIDENCY_MODES.OPEN;

export function normalizeChatbarResidency(value: unknown): ChatbarResidency {
  if (value === CHATBAR_RESIDENCY_MODES.COLLAPSED) return CHATBAR_RESIDENCY_MODES.COLLAPSED;
  if (value === CHATBAR_RESIDENCY_MODES.OPEN) return CHATBAR_RESIDENCY_MODES.OPEN;
  return DEFAULT_CHATBAR_RESIDENCY;
}

export function loadChatbarResidency(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null,
): ChatbarResidency {
  if (!storage) return DEFAULT_CHATBAR_RESIDENCY;
  try {
    return normalizeChatbarResidency(storage.getItem(CHATBAR_RESIDENCY_STORAGE_KEY));
  } catch {
    return DEFAULT_CHATBAR_RESIDENCY;
  }
}

export function saveChatbarResidency(
  residency: ChatbarResidency,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(CHATBAR_RESIDENCY_STORAGE_KEY, normalizeChatbarResidency(residency));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function toggleChatbarResidency(current: ChatbarResidency): ChatbarResidency {
  return normalizeChatbarResidency(current) === CHATBAR_RESIDENCY_MODES.OPEN
    ? CHATBAR_RESIDENCY_MODES.COLLAPSED
    : CHATBAR_RESIDENCY_MODES.OPEN;
}

/** Dock side of the main content area (nav rail stays outermost left). */
export const CHATBAR_SIDES = Object.freeze({
  RIGHT: "right",
  LEFT: "left",
} as const);

export type ChatbarSide = (typeof CHATBAR_SIDES)[keyof typeof CHATBAR_SIDES];

export const CHATBAR_SIDE_STORAGE_KEY = "lifequest.chatbar.side";

export const DEFAULT_CHATBAR_SIDE: ChatbarSide = CHATBAR_SIDES.RIGHT;

export function normalizeChatbarSide(value: unknown): ChatbarSide {
  if (value === CHATBAR_SIDES.LEFT) return CHATBAR_SIDES.LEFT;
  if (value === CHATBAR_SIDES.RIGHT) return CHATBAR_SIDES.RIGHT;
  return DEFAULT_CHATBAR_SIDE;
}

export function loadChatbarSide(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null,
): ChatbarSide {
  if (!storage) return DEFAULT_CHATBAR_SIDE;
  try {
    return normalizeChatbarSide(storage.getItem(CHATBAR_SIDE_STORAGE_KEY));
  } catch {
    return DEFAULT_CHATBAR_SIDE;
  }
}

export function saveChatbarSide(
  side: ChatbarSide,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(CHATBAR_SIDE_STORAGE_KEY, normalizeChatbarSide(side));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function toggleChatbarSide(current: ChatbarSide): ChatbarSide {
  return normalizeChatbarSide(current) === CHATBAR_SIDES.LEFT
    ? CHATBAR_SIDES.RIGHT
    : CHATBAR_SIDES.LEFT;
}
