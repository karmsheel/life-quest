/**
 * User-installed themes: the Forge skin JSON, dropped into the app.
 *
 * LifeQuest ships seven themes and shares its preset format with Hermes Desktop
 * (`types.ts`: "so presets and user-installed themes can be shared between
 * products"), so an operator who has a theme in that shape can bring it here and
 * curate it alongside the built-ins. This module is the whole of that path: read
 * the file's JSON, prove it is a skin, keep it, take it away again.
 *
 * Two rules shape the validator:
 *
 *  - **Hex only.** `applySkin` derives most of the token ladder with `pickHex`,
 *    which accepts `#…` and silently substitutes a default for anything else. A
 *    theme whose `background` is `rgb(20 20 20)` would be applied as *some other
 *    colour* in half the tokens and look broken in a way the operator cannot
 *    attribute. Rejecting the file at install time, with the field named, is the
 *    only outcome that leaves the app telling the truth.
 *  - **Revalidated on every read.** The list lives in `localStorage`, which is
 *    shared with every other thing that can write a key: a stored skin is proved
 *    again when it is loaded, so a hand-edited or half-written entry is dropped
 *    instead of being applied to the window.
 *
 * Nothing here touches the vault or the main process: a theme is presentation,
 * and it lives beside the chosen skin and the starred list.
 */
import { BUILTIN_SKIN_NAMES, isBuiltinSkinName } from "./presets.ts";
import type { ForgeSkin, SkinColors } from "./types.ts";

export const INSTALLED_THEMES_STORAGE_KEY = "lifequest-installed-themes";

/** Enough room to curate, few enough that the grid stays readable. */
export const MAX_INSTALLED_THEMES = 24;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Every colour `applySkin` reads without a fallback. */
const REQUIRED_COLORS = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "muted",
  "mutedForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "accent",
  "accentForeground",
  "border",
  "input",
  "ring",
  "destructive",
  "destructiveForeground",
] as const;

/** Colours a theme may carry that the ladder can do without. */
const OPTIONAL_COLORS = [
  "midground",
  "midgroundForeground",
  "composerRing",
  "sidebarBackground",
  "sidebarBorder",
  "userBubble",
  "userBubbleBorder",
  "composerForeground",
  "composerPlaceholder",
  "success",
  "info",
] as const;

const TYPOGRAPHY_KEYS = ["fontSans", "fontMono", "fontDisplay", "fontUrl"] as const;

export type InstallResult =
  | { ok: true; skin: ForgeSkin }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function colorsFrom(
  raw: unknown,
  path: string,
): { ok: true; colors: SkinColors } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: `${path} must be an object of colours.` };
  }

  for (const key of REQUIRED_COLORS) {
    const value = raw[key];
    if (typeof value !== "string" || !HEX.test(value.trim())) {
      return {
        ok: false,
        error: `${path}.${key} must be a hex colour like #0d1117.`,
      };
    }
  }

  for (const key of OPTIONAL_COLORS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !HEX.test(value.trim())) {
      return {
        ok: false,
        error: `${path}.${key} must be a hex colour like #0d1117.`,
      };
    }
  }

  // Copy only the known names: whatever else the file carries (a README, a
  // screenshot URL, a `$schema`) has no business reaching the window.
  const colors: Record<string, string> = {};
  for (const key of [...REQUIRED_COLORS, ...OPTIONAL_COLORS]) {
    const value = raw[key];
    if (typeof value === "string") colors[key] = value.trim();
  }
  return { ok: true, colors: colors as unknown as SkinColors };
}

function typographyFrom(
  raw: unknown,
): ForgeSkin["typography"] | undefined {
  if (!isRecord(raw)) return undefined;
  const typography: Record<string, string> = {};
  for (const key of TYPOGRAPHY_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) typography[key] = value.trim();
  }
  return Object.keys(typography).length
    ? (typography as ForgeSkin["typography"])
    : undefined;
}

/**
 * Prove one parsed JSON value is a skin this app can wear.
 *
 * `taken` is the set of names already in use (the built-ins plus installed
 * themes), so a file cannot quietly shadow a shipped theme — a name is the
 * identity `applySkin` writes onto `<html>` and the name the storage keys use.
 */
export function parseInstalledSkin(
  raw: unknown,
  taken: string[],
): InstallResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "That file is not a theme — it should hold a JSON object." };
  }

  const name = typeof raw.name === "string" ? raw.name.trim().toLowerCase() : "";
  if (!NAME.test(name)) {
    return {
      ok: false,
      error: '`name` must be a short id in lower case, like "midnight-blue" (letters, digits and dashes).',
    };
  }
  if (taken.includes(name) || isBuiltinSkinName(name)) {
    return {
      ok: false,
      error: `A theme called “${name}” is already installed.`,
    };
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label || label.length > 48) {
    return { ok: false, error: "`label` must be the theme's name, 1–48 characters." };
  }

  if (raw.description !== undefined && typeof raw.description !== "string") {
    return { ok: false, error: "`description` must be text." };
  }
  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 200)
      : `${label} · installed theme`;

  const colors = colorsFrom(raw.colors, "colors");
  if (!colors.ok) return colors;

  let darkColors: SkinColors | undefined;
  if (raw.darkColors !== undefined) {
    const dark = colorsFrom(raw.darkColors, "darkColors");
    if (!dark.ok) return dark;
    darkColors = dark.colors;
  }

  if (raw.darkLadder !== undefined && raw.darkLadder !== "inverted") {
    return { ok: false, error: '`darkLadder`, when given, is "inverted".' };
  }

  const typography = typographyFrom(raw.typography);
  const skin: ForgeSkin = {
    name,
    label,
    description,
    colors: colors.colors,
    ...(darkColors ? { darkColors } : {}),
    ...(raw.darkLadder === "inverted" ? { darkLadder: "inverted" as const } : {}),
    ...(typography ? { typography } : {}),
  };
  return { ok: true, skin };
}

/** The installed themes this window can wear, proved again on every read. */
export function getInstalledSkins(): ForgeSkin[] {
  if (typeof window === "undefined") return [];
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(INSTALLED_THEMES_STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const accepted: ForgeSkin[] = [];
  for (const entry of parsed.slice(0, MAX_INSTALLED_THEMES)) {
    const result = parseInstalledSkin(entry, [
      ...BUILTIN_SKIN_NAMES,
      ...accepted.map((skin) => skin.name),
    ]);
    if (result.ok) accepted.push(result.skin);
  }
  return accepted;
}

function persist(skins: ForgeSkin[]): void {
  try {
    localStorage.setItem(INSTALLED_THEMES_STORAGE_KEY, JSON.stringify(skins));
  } catch {
    /* ignore */
  }
}

/** Prove, keep, and hand back the skin — or say why it cannot be kept. */
export function installTheme(raw: unknown): InstallResult {
  const installed = getInstalledSkins();
  if (installed.length >= MAX_INSTALLED_THEMES) {
    return {
      ok: false,
      error: `You can install up to ${MAX_INSTALLED_THEMES} themes. Remove one first.`,
    };
  }

  const result = parseInstalledSkin(raw, [
    ...BUILTIN_SKIN_NAMES,
    ...installed.map((skin) => skin.name),
  ]);
  if (!result.ok) return result;

  persist([...installed, result.skin]);
  return result;
}

/** Take an installed theme out of the list; built-ins are never touched. */
export function uninstallTheme(name: string): void {
  const installed = getInstalledSkins();
  const next = installed.filter((skin) => skin.name !== name);
  if (next.length !== installed.length) persist(next);
}

/** A theme the operator brought in, as opposed to one the app ships. */
export function isInstalledSkin(name: string): boolean {
  return getInstalledSkins().some((skin) => skin.name === name);
}
