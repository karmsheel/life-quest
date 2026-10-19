/**
 * Starred themes: the quick settings menu's whole list.
 *
 * The full settings page owns the star, and the popover the titlebar opens shows
 * nothing but the starred ones — that is the curation the sheet exists for. A
 * fresh install has never curated anything, so `null` from storage means "every
 * theme is starred": the quick menu opens on the whole set, and the first star
 * the operator clears or adds is what turns that default into an explicit list.
 *
 * Names are validated on read against the themes that actually exist: a theme
 * removed from the product (or an installed one that was taken away) must not
 * leave a hole in the quick grid, and nothing else in the array is trusted enough
 * to be applied.
 */
import { isBuiltinSkinName } from "./presets.ts";
import { isInstalledSkin } from "./user-themes.ts";

export const SKIN_FAVORITES_STORAGE_KEY = "lifequest-skin-favorites";

/** Whether a name is a theme this install can wear. */
export function isKnownSkinName(name: string): boolean {
  return isBuiltinSkinName(name) || isInstalledSkin(name);
}

/**
 * The curated list, or `null` when the operator has never curated anything —
 * the caller turns that into "all of them".
 */
export function getStoredSkinFavorites(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SKIN_FAVORITES_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    return parsed.filter((name): name is string => {
      if (typeof name !== "string" || seen.has(name)) return false;
      if (!isKnownSkinName(name)) return false;
      seen.add(name);
      return true;
    });
  } catch {
    /* unreadable or not JSON: fall back to the default, which is the full set */
  }
  return null;
}

export function persistSkinFavorites(names: string[]): void {
  try {
    localStorage.setItem(SKIN_FAVORITES_STORAGE_KEY, JSON.stringify(names));
  } catch {
    /* ignore */
  }
}

/** The list with `name` added at its end, or removed; never both. */
export function toggleSkinFavorite(names: string[], name: string): string[] {
  return names.includes(name)
    ? names.filter((candidate) => candidate !== name)
    : [...names, name];
}

/** The list without `name`, for a theme that is being taken away. */
export function withoutSkinFavorite(names: string[], name: string): string[] {
  return names.filter((candidate) => candidate !== name);
}
