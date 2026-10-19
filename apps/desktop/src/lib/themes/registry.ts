import { BUILTIN_SKIN_LIST, BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "./presets.ts";
import type { ForgeSkin } from "./types.ts";
import { getInstalledSkins } from "./user-themes.ts";

/**
 * What the app can wear: the themes it ships, then the ones the operator
 * installed, in the order they arrived.
 *
 * Installed themes are read from storage here rather than cached, because this
 * module answers "what is available *now*" for three different callers — the
 * provider's list, `resolveSkin` during a repaint, and the settings search — and a
 * cache would leave one of them a reload behind an install.
 */
export function listAllSkins(): ForgeSkin[] {
  return [...BUILTIN_SKIN_LIST, ...getInstalledSkins()];
}

export function resolveSkin(name: string | null | undefined): ForgeSkin {
  if (name) {
    const builtin = BUILTIN_SKINS[name];
    if (builtin) return builtin;
    const installed = getInstalledSkins().find((skin) => skin.name === name);
    if (installed) return installed;
  }
  return BUILTIN_SKINS[DEFAULT_SKIN_NAME];
}
