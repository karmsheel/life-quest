import { useSyncExternalStore } from "react";

/**
 * Developer flags: the switches on Settings → Developer that change how the app
 * behaves, kept out of the way of everybody who is not building it.
 *
 * WHY A FLAG AND NOT A PREFERENCE
 *
 * A preference is a question the app is right to ask — light or dark, which folder
 * is the vault. A developer flag is a feature that is not ready to be everybody's:
 * the card width handle (2026-10-16) is the first, and it is gated because dragging
 * a card's edge is a gesture that has to be felt before it can be judged, and until
 * it has been it is an edge on every card in the app that nobody asked for. **The
 * default is off.** A flag that defaults on is not gated; it is a preference with a
 * checkbox.
 *
 * WHY A STORE AND NOT A PROVIDER
 *
 * The first cut of this was a React context, and it was wrong in a way that only
 * showed up in a rig: a mount that forgot the provider fell back to the default
 * value, whose `setFlag` still wrote storage but had no state to re-render, so the
 * switch wrote the flag and the page kept drawing itself off. A store has no tree
 * to be missing from — the switch, the board, and a harness that mounts one page on
 * its own all read the same key and all hear the same change — and the flag is not
 * a value that belongs to a subtree anyway. It belongs to the app's storage.
 *
 * WHERE THEY LIVE, AND WHY NOT IN THE VAULT
 *
 * `localStorage`, like the update preview beside it: a developer flag is a fact
 * about this install and this person, not about the vault. Two people opening the
 * same vault are not agreeing to run an unfinished gesture, and a flag written into
 * `settings.json` would be a change to a file the vault's own tools describe as the
 * operator's settings. A window with no storage still runs the flag for the
 * session; it just forgets on restart, which is the right failure for a switch like
 * this.
 *
 * The update preview is deliberately NOT here even though it is drawn on the same
 * page: it is not a preference about the app, it is a stand-in for a feed, and it
 * belongs to the provider that owns the feed.
 */

/** The flags the app knows how to read. One name per feature, spelled out. */
export const DEVELOPER_FLAGS = ["cardWidthHandle"] as const;

export type DeveloperFlag = (typeof DEVELOPER_FLAGS)[number];

/**
 * The storage key for one flag, derived rather than listed: a flag's key is its
 * name, so a switch, a reader, and a rig cannot disagree about where it is kept.
 * `lifequest-dev-card-width-handle`, and so on.
 */
export function developerFlagKey(flag: DeveloperFlag): string {
  return `lifequest-dev-${flag.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Read one flag. A missing key is off, which is the gate. */
export function readDeveloperFlag(flag: DeveloperFlag): boolean {
  try {
    return window.localStorage.getItem(developerFlagKey(flag)) === "1";
  } catch {
    // A window with no storage runs everything at its default.
    return false;
  }
}

/**
 * The readers, and the one place a write is announced from.
 *
 * The `storage` event covers another window changing a flag; `listeners` covers
 * this one, because the DOM does not fire `storage` in the window that wrote it.
 * Neither is a nicety: without the second, the switch on the Developer page would
 * move the key and not itself.
 */
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("lifequest-dev-")) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Turn one flag on or off, and remember it. */
export function setDeveloperFlag(flag: DeveloperFlag, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(developerFlagKey(flag), "1");
    else window.localStorage.removeItem(developerFlagKey(flag));
  } catch {
    // Nothing to do: the flag is off for this session and forgets later.
  }
  announce();
}

/**
 * One flag, live.
 *
 * A boolean snapshot, so React can compare it by value and only re-render when the
 * answer really changed — which is what makes this cheap enough to read on a board
 * of twenty cards.
 */
export function useDeveloperFlag(flag: DeveloperFlag): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readDeveloperFlag(flag),
    () => false,
  );
}
