import { DEFAULT_SKIN_NAME, isBuiltinSkinName } from "./presets.ts";

export const SKIN_STORAGE_KEY = "lifequest-skin";

export function getStoredSkinName(): string {
  if (typeof window === "undefined") return DEFAULT_SKIN_NAME;
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    if (stored && isBuiltinSkinName(stored)) return stored;
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
