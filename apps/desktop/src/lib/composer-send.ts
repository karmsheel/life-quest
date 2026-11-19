/**
 * Which key sends a chat message.
 *
 * The message box has one send key, and two reasonable answers to what it is.
 * Writing a prompt is writing a paragraph, so the plain Enter has always broken
 * the line here and the send sat on Ctrl/Cmd+Enter — a send the operator takes
 * on purpose. But a keyboard used to the opposite (Enter sends, Shift+Enter
 * breaks the line) should not have to relearn it for one app, so the choice is
 * the operator's, kept on Settings → Composer and read by the composer itself.
 *
 * The preference is window storage, like the theme and the keyboard bindings: it
 * is about this installation, not about the vault or the companion. `modified`
 * is the default, which is the behaviour the app shipped before this setting
 * existed — an unset window keeps sending on Ctrl/Cmd+Enter.
 *
 * A window without storage (a harness, or storage disabled) is not an error:
 * the choice is remembered for the life of the window and simply not persisted.
 */
import { useCallback, useSyncExternalStore } from "react";

export type ComposerSendKey = "modified" | "enter";

/** Where the choice is kept. Read on every launch; written when it changes. */
export const COMPOSER_SEND_KEY_STORAGE_KEY = "lifequest-composer-send-key";

/**
 * The same-window announcement. `localStorage`'s own `storage` event never fires
 * in the window that wrote the value, so the settings page and the composer — two
 * surfaces in one window — need an event of their own to stay in step.
 */
const COMPOSER_SEND_KEY_EVENT = "lifequest:composer-send-key-change";

/**
 * Enter breaks the line; Ctrl/Cmd+Enter sends. The long-standing behaviour, and
 * the one an unset window gets.
 */
export const DEFAULT_COMPOSER_SEND_KEY: ComposerSendKey = "modified";

/**
 * The value held in memory when the window has no storage. Null while storage is
 * answering, so a value another window wrote is still seen.
 */
let remembered: ComposerSendKey | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** What the operator chose, with an unreadable or missing value reading as the default. */
export function readComposerSendKey(): ComposerSendKey {
  if (remembered !== null) return remembered;
  try {
    const stored = storage()?.getItem(COMPOSER_SEND_KEY_STORAGE_KEY);
    return stored === "enter" ? "enter" : DEFAULT_COMPOSER_SEND_KEY;
  } catch {
    return DEFAULT_COMPOSER_SEND_KEY;
  }
}

/** Store the choice and tell the surfaces that draw it. */
export function writeComposerSendKey(value: ComposerSendKey): void {
  try {
    const store = storage();
    if (store) store.setItem(COMPOSER_SEND_KEY_STORAGE_KEY, value);
    else remembered = value;
  } catch {
    // A window whose storage refuses the write still honours the choice now; it
    // just forgets it on the next launch.
    remembered = value;
  }
  window.dispatchEvent(new Event(COMPOSER_SEND_KEY_EVENT));
}

/** Subscribe to changes from this window (and, defensively, from another one). */
export function subscribeComposerSendKey(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === COMPOSER_SEND_KEY_STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener(COMPOSER_SEND_KEY_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(COMPOSER_SEND_KEY_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The composer's send key, as a React value: the Settings → Composer page writes
 * it, and the composer re-renders when it changes. One store, two readers.
 */
export function useComposerSendKey(): {
  sendKey: ComposerSendKey;
  setSendKey: (value: ComposerSendKey) => void;
} {
  const sendKey = useSyncExternalStore(
    subscribeComposerSendKey,
    readComposerSendKey,
    readComposerSendKey,
  );
  const setSendKey = useCallback((value: ComposerSendKey) => {
    writeComposerSendKey(value);
  }, []);
  return { sendKey, setSendKey };
}
