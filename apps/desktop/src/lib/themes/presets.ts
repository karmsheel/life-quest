import { isDarkBackground, mix } from "./color.ts";
import type { ForgeSkin, SkinColors } from "./types.ts";

/** Muzli Nous palette — https://colors.muz.li/palette/0000f2/002aa9/bfcfff/809fff/ffffff */
const NOUS = {
  blue: "#0000f2",
  dark: "#002aa9",
  light: "#bfcfff",
  mid: "#809fff",
  white: "#ffffff",
} as const;

function nousLine(pct: number): string {
  return mix(NOUS.blue, NOUS.white, (100 - pct) / 100);
}

/** Subtle wash from brand blue — keeps #0000f2 as the only vivid blue. */
function nousBrandTint(pct: number): string {
  return mix(NOUS.blue, NOUS.white, (100 - pct) / 100);
}

/** Neutral structural borders — avoids competing with the brand blue. */
function nousNeutralLine(pct: number): string {
  return mix("#0A0A12", NOUS.white, (100 - pct) / 100);
}

export const nousSkin: ForgeSkin = {
  name: "nous",
  label: "Nous",
  description: "Crisp blue on white — the Nous palette",
  // Matches hermes-agent.nousresearch.com display face (Sigurd via next/font --font-sigurd).
  typography: {
    fontDisplay: 'var(--font-sigurd), "Times New Roman", serif',
  },
  colors: {
    background: NOUS.white,
    foreground: "#0A0A12",
    card: NOUS.white,
    cardForeground: "#0A0A12",
    muted: nousBrandTint(6),
    mutedForeground: "#5C5C70",
    popover: NOUS.white,
    popoverForeground: "#0A0A12",
    primary: NOUS.blue,
    primaryForeground: NOUS.white,
    secondary: nousBrandTint(8),
    secondaryForeground: NOUS.dark,
    accent: nousBrandTint(10),
    accentForeground: NOUS.dark,
    border: nousNeutralLine(12),
    input: nousNeutralLine(16),
    ring: NOUS.blue,
    midground: NOUS.blue,
    composerRing: NOUS.blue,
    destructive: "#C72E4D",
    destructiveForeground: NOUS.white,
    sidebarBackground: nousBrandTint(5),
    sidebarBorder: nousNeutralLine(12),
    userBubble: NOUS.blue,
    userBubbleBorder: nousLine(32),
    // Match home-composer hint grey (composer-fg-soft) — not cyan on brand blue.
    composerPlaceholder: mix(NOUS.white, NOUS.blue, 0.48),
    info: NOUS.blue,
    success: "#1A7A42",
  },
  // Night mode mirrors hermes-agent.nousresearch.com: solid brand blue + pure white
  // (no cream). Surfaces lift with white tints; wells drop with black tints.
  darkColors: {
    background: NOUS.blue,
    foreground: NOUS.white,
    card: mix(NOUS.blue, NOUS.white, 0.08),
    cardForeground: NOUS.white,
    muted: mix(NOUS.blue, NOUS.white, 0.12),
    mutedForeground: mix(NOUS.white, NOUS.blue, 0.28),
    popover: mix(NOUS.blue, NOUS.white, 0.1),
    popoverForeground: NOUS.white,
    primary: NOUS.white,
    primaryForeground: NOUS.blue,
    secondary: mix(NOUS.blue, NOUS.white, 0.14),
    secondaryForeground: mix(NOUS.white, NOUS.blue, 0.08),
    accent: mix(NOUS.blue, NOUS.white, 0.16),
    accentForeground: NOUS.white,
    // Near-white chrome so home cards (and other surfaces) read with a clear outline
    border: mix(NOUS.white, NOUS.blue, 0.08),
    input: mix(NOUS.blue, "#000000", 0.15),
    ring: NOUS.white,
    midground: NOUS.mid,
    composerRing: NOUS.white,
    destructive: "#C0473A",
    destructiveForeground: NOUS.white,
    // Deeper brand blue for the left nav rail
    sidebarBackground: mix(NOUS.blue, "#000000", 0.32),
    sidebarBorder: mix(NOUS.white, NOUS.blue, 0.22),
    // Inverted from day: white composer/bubble on brand blue
    userBubble: NOUS.white,
    userBubbleBorder: mix(NOUS.white, NOUS.blue, 0.18),
    composerForeground: NOUS.blue,
    composerPlaceholder: mix(NOUS.blue, NOUS.white, 0.42),
    info: NOUS.light,
    success: "#5AD68A",
  },
};

export const midnightSkin: ForgeSkin = {
  name: "midnight",
  label: "Midnight",
  description: "Deep blue-violet with cool accents",
  colors: {
    background: "#08081c",
    foreground: "#ddd6ff",
    card: "#0d0d28",
    cardForeground: "#ddd6ff",
    muted: "#13133a",
    mutedForeground: "#7c7ab0",
    popover: "#0f0f2e",
    popoverForeground: "#ddd6ff",
    primary: "#ddd6ff",
    primaryForeground: "#08081c",
    secondary: "#1a1a4a",
    secondaryForeground: "#c4bff0",
    accent: "#1a1a44",
    accentForeground: "#d0c8ff",
    border: "#1e1e52",
    input: "#1e1e52",
    ring: "#8b80e8",
    midground: "#8b80e8",
    destructive: "#b03060",
    destructiveForeground: "#fef2f2",
    sidebarBackground: "#06061a",
    sidebarBorder: "#12123a",
  },
};

export const emberSkin: ForgeSkin = {
  name: "ember",
  label: "Ember",
  description: "Warm crimson and bronze — forge vibes",
  colors: {
    background: "#160800",
    foreground: "#ffd8b0",
    card: "#1e0e04",
    cardForeground: "#ffd8b0",
    muted: "#2a1408",
    mutedForeground: "#aa7a56",
    popover: "#221008",
    popoverForeground: "#ffd8b0",
    primary: "#ffd8b0",
    primaryForeground: "#160800",
    secondary: "#341800",
    secondaryForeground: "#f0c090",
    accent: "#301600",
    accentForeground: "#e8c080",
    border: "#3a1c08",
    input: "#3a1c08",
    ring: "#d97316",
    midground: "#d97316",
    destructive: "#c43010",
    destructiveForeground: "#fef2f2",
    sidebarBackground: "#100600",
    sidebarBorder: "#2a1004",
  },
};

export const monoSkin: ForgeSkin = {
  name: "mono",
  label: "Mono",
  description: "Clean grayscale — minimal and focused",
  colors: {
    background: "#0e0e0e",
    foreground: "#eaeaea",
    card: "#141414",
    cardForeground: "#eaeaea",
    muted: "#1e1e1e",
    mutedForeground: "#808080",
    popover: "#181818",
    popoverForeground: "#eaeaea",
    primary: "#eaeaea",
    primaryForeground: "#0e0e0e",
    secondary: "#262626",
    secondaryForeground: "#c8c8c8",
    accent: "#222222",
    accentForeground: "#d8d8d8",
    border: "#2a2a2a",
    input: "#2a2a2a",
    ring: "#9a9a9a",
    midground: "#9a9a9a",
    destructive: "#a84040",
    destructiveForeground: "#fef2f2",
    sidebarBackground: "#0a0a0a",
    sidebarBorder: "#202020",
  },
};

export const cyberpunkSkin: ForgeSkin = {
  name: "cyberpunk",
  label: "Cyberpunk",
  description: "Neon green on black — matrix terminal",
  colors: {
    background: "#000a00",
    foreground: "#00ff41",
    card: "#001200",
    cardForeground: "#00ff41",
    muted: "#001a00",
    mutedForeground: "#1a8a30",
    popover: "#001000",
    popoverForeground: "#00ff41",
    primary: "#00ff41",
    primaryForeground: "#000a00",
    secondary: "#002800",
    secondaryForeground: "#00cc34",
    accent: "#002000",
    accentForeground: "#00e038",
    border: "#003000",
    input: "#003000",
    ring: "#00ff41",
    midground: "#00ff41",
    destructive: "#ff003c",
    destructiveForeground: "#000a00",
    sidebarBackground: "#000600",
    sidebarBorder: "#001800",
  },
};

/** Forge OS — cooling forge: steel, ash, and low embers. */
const FORGE_OS_LIGHT = {
  background: "#F0EEEA",
  card: "#F8F7F5",
  primary: "#B4532A",
  accent: "#E86A33",
  highlight: "#9A4A24",
  text: "#1E1E22",
  muted: "#6E6C68",
} as const;

const FORGE_OS_DARK = {
  background: "#111214",
  card: "#1A1D22",
  primary: "#A8552D",
  accent: "#E86A33",
  highlight: "#FFB56B",
  text: "#F3F3F3",
  muted: "#8B8B8B",
} as const;

function forgeOsLine(
  tokens: typeof FORGE_OS_LIGHT | typeof FORGE_OS_DARK,
  pct: number,
): string {
  return mix(tokens.primary, tokens.background, (100 - pct) / 100);
}

/**
 * Dark structural lines need more luminance than primary-on-black alone
 * provides — blend a warmer ember ink so sidebars/cards stay readable.
 */
function forgeOsDarkLine(pct: number): string {
  const ink = mix(FORGE_OS_DARK.primary, FORGE_OS_DARK.highlight, 0.42);
  return mix(ink, FORGE_OS_DARK.background, (100 - pct) / 100);
}

function forgeOsSurface(
  tokens: typeof FORGE_OS_LIGHT | typeof FORGE_OS_DARK,
  pct: number,
): string {
  return mix(tokens.accent, tokens.card, (100 - pct) / 100);
}

export const forgeOsSkin: ForgeSkin = {
  name: "forge-os",
  label: "Forge OS",
  description: "Cooling steel and ash with low ember glow — modern industrial warmth",
  colors: {
    background: FORGE_OS_LIGHT.background,
    foreground: FORGE_OS_LIGHT.text,
    card: FORGE_OS_LIGHT.card,
    cardForeground: FORGE_OS_LIGHT.text,
    muted: mix(FORGE_OS_LIGHT.background, FORGE_OS_LIGHT.card, 0.42),
    mutedForeground: FORGE_OS_LIGHT.muted,
    popover: "#FFFFFF",
    popoverForeground: FORGE_OS_LIGHT.text,
    primary: FORGE_OS_LIGHT.primary,
    primaryForeground: "#FFFFFF",
    secondary: forgeOsSurface(FORGE_OS_LIGHT, 14),
    secondaryForeground: FORGE_OS_LIGHT.highlight,
    accent: forgeOsSurface(FORGE_OS_LIGHT, 26),
    accentForeground: FORGE_OS_LIGHT.highlight,
    border: forgeOsLine(FORGE_OS_LIGHT, 14),
    input: forgeOsLine(FORGE_OS_LIGHT, 20),
    ring: FORGE_OS_LIGHT.accent,
    midground: FORGE_OS_LIGHT.accent,
    composerRing: FORGE_OS_LIGHT.accent,
    destructive: "#C43010",
    destructiveForeground: "#FFFFFF",
    sidebarBackground: "#EBE8E4",
    sidebarBorder: forgeOsLine(FORGE_OS_LIGHT, 10),
    // Day composer / user bubble: paper white with a firm dark outline
    userBubble: "#FFFFFF",
    userBubbleBorder: FORGE_OS_LIGHT.text,
    composerForeground: FORGE_OS_LIGHT.text,
    composerPlaceholder: mix(FORGE_OS_LIGHT.muted, "#FFFFFF", 0.22),
    success: "#2F7A4A",
    info: "#3D6F94",
  },
  darkColors: {
    background: FORGE_OS_DARK.background,
    foreground: FORGE_OS_DARK.text,
    card: FORGE_OS_DARK.card,
    cardForeground: FORGE_OS_DARK.text,
    muted: mix(FORGE_OS_DARK.background, FORGE_OS_DARK.card, 0.36),
    mutedForeground: FORGE_OS_DARK.muted,
    popover: "#1E2229",
    popoverForeground: FORGE_OS_DARK.text,
    primary: FORGE_OS_DARK.primary,
    primaryForeground: FORGE_OS_DARK.text,
    secondary: forgeOsSurface(FORGE_OS_DARK, 16),
    secondaryForeground: FORGE_OS_DARK.highlight,
    accent: forgeOsSurface(FORGE_OS_DARK, 28),
    accentForeground: FORGE_OS_DARK.highlight,
    border: forgeOsDarkLine(28),
    input: forgeOsDarkLine(34),
    ring: FORGE_OS_DARK.accent,
    midground: FORGE_OS_DARK.accent,
    composerRing: FORGE_OS_DARK.accent,
    destructive: "#D64545",
    destructiveForeground: FORGE_OS_DARK.text,
    sidebarBackground: "#0D0E10",
    sidebarBorder: forgeOsDarkLine(30),
    userBubble: FORGE_OS_DARK.card,
    userBubbleBorder: forgeOsDarkLine(42),
    success: "#5A9E6F",
    info: "#6B8FA8",
  },
};

export const BUILTIN_SKINS: Record<string, ForgeSkin> = {
  "forge-os": forgeOsSkin,
  nous: nousSkin,
  midnight: midnightSkin,
  ember: emberSkin,
  mono: monoSkin,
  cyberpunk: cyberpunkSkin,
};

export const BUILTIN_SKIN_LIST = Object.values(BUILTIN_SKINS);

export const DEFAULT_SKIN_NAME = "forge-os";

export const BUILTIN_SKIN_NAMES = BUILTIN_SKIN_LIST.map((s) => s.name);

export function isBuiltinSkinName(value: string | null): value is string {
  return Boolean(value && BUILTIN_SKINS[value]);
}

export function resolveSkinPalette(skin: ForgeSkin, mode: "light" | "dark"): SkinColors {
  if (mode === "dark" && skin.darkColors) return skin.darkColors;
  return skin.colors;
}

/** Whether a skin has a palette appropriate for the given color mode. */
export function skinSupportsMode(skin: ForgeSkin, mode: "light" | "dark"): boolean {
  const dark = isDarkBackground(resolveSkinPalette(skin, mode).background);
  return mode === "dark" ? dark : !dark;
}

export function filterSkinsForMode(skins: ForgeSkin[], mode: "light" | "dark"): ForgeSkin[] {
  return skins.filter((skin) => skinSupportsMode(skin, mode));
}

/** Whether a skin has distinct palettes for both day and night. */
export function skinSupportsBothModes(skin: ForgeSkin): boolean {
  return skinSupportsMode(skin, "light") && skinSupportsMode(skin, "dark");
}

export function filterSkinsForPreference(
  skins: ForgeSkin[],
  preference: "system" | "light" | "dark",
): ForgeSkin[] {
  if (preference === "system") {
    return skins.filter(skinSupportsBothModes);
  }
  return filterSkinsForMode(skins, preference);
}

