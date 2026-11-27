import {
  DEFAULT_SKIN_NAME,
  isBuiltinSkinName,
  resolveLegacySkinName,
} from "./presets.ts";
import { isInstalledSkin } from "./user-themes.ts";

export const SKIN_STORAGE_KEY = "lifequest-skin";

export function getStoredSkinName(): string {
  if (typeof window === "undefined") return DEFAULT_SKIN_NAME;
  try {
    const stored = resolveLegacySkinName(localStorage.getItem(SKIN_STORAGE_KEY));
    // An installed skin is as real a choice as a shipped one. The old check
    // only accepted built-ins, so the operator's picked theme silently reverted
    // to the default on the next launch — the one restart bug the spike found.
    if (stored && (isBuiltinSkinName(stored) || isInstalledSkin(stored))) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SKIN_NAME;
}

export function persistSkinName(name: string): void {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, name);
  } catch {
    /* ignore */
  }
}
