import { BUILTIN_SKIN_LIST, BUILTIN_SKINS, DEFAULT_SKIN_NAME } from "./presets.ts";
import type { ForgeSkin } from "./types.ts";

export function resolveSkin(name: string | null | undefined): ForgeSkin {
  if (name && BUILTIN_SKINS[name]) return BUILTIN_SKINS[name];
  return BUILTIN_SKINS[DEFAULT_SKIN_NAME];
}

export function listAllSkins(): ForgeSkin[] {
  return BUILTIN_SKIN_LIST;
}
