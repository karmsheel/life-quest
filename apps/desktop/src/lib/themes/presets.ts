import { isDarkBackground, mix } from "./color.ts";
import type { ForgeSkin, SkinColors } from "./types.ts";

/**
 * The two Nous themes, taken verbatim from Hermes Desktop's bundled presets
 * (`apps/shared/src/theme-presets.ts` + `apps/desktop/src/themes/presets.ts`).
 * Hermes ships them as the product's identity — `nous` is its `DEFAULT_SKIN_NAME`
 * — so LifeQuest carries the same two names and the same palettes rather than a
 * re-derivation, and a user moving between the two apps sees one look.
 *
 * Neither ships a font opinion: Hermes's theme model keeps layout, sizing,
 * radius and typography out of the palette (`types.ts`: "Everything else ...
 * lives in styles.css"), and both themes declare only the system stacks. They
 * also carry no imagery and no second accent, so neither skin has a CSS layer.
 */

/* ── Nous ────────────────────────────────────────────────────────────────────
 * "GitHub chrome, Nous blue accent." A fork of the GitHub VS Code theme with
 * only the accent family re-seeded; every neutral is upstream GitHub's.
 *
 * Two seeds, one hue. `#0053fd` is the brand colour and reads 5.4:1 on the
 * light sidebar, but only 3.6:1 on the near-black dark one, so dark carries
 * `#4a84fe` — the same hue (263°) lifted to clear AA at 5.9:1.
 *
 * The soft surfaces (`secondary`, `accent`, `userBubble`) are the author's
 * OKLab blends of those seeds into their backgrounds, which is what keeps a
 * saturated blue from drifting violet on its way to white. They are literals
 * here because they are literals upstream; `mixOklab` in `color.ts` is what the
 * rest of our derived tokens use, for the same reason.
 */
const NOUS_BLUE = "#0053fd";
const NOUS_BLUE_DARK = "#4a84fe";

export const nousSkin: ForgeSkin = {
  name: "nous",
  label: "Nous",
  description: "GitHub chrome, Nous blue accent",
  /**
   * GitHub Dark Default puts its cards **below** its page (`#010409` under
   * `#0d1117`), which is the inverse of LifeQuest's Dark Ladder. The palette is
   * a copy of Hermes's, so the direction is kept and declared rather than bent:
   * see `darkLadder` on `ForgeSkin`, and the exemption named in DESIGN.md.
   */
  darkLadder: "inverted",
  /**
   * `background` and `card` are Hermes's **swapped**, and that is deliberate.
   *
   * LifeQuest's light ladder sinks the mat below the sheet: `colors.background`
   * becomes `--canvas-base` (the rail and titlebar) and `colors.card` becomes
   * `--background` (the sheet). Hermes has no such ladder — its `background` is
   * the page and its `card` is the raised surface. Read straight across, Nous
   * would paint a *white rail around a grey sheet*: GitHub's layout inverted.
   * So Hermes's page white goes in `card` and its grey sidebar goes in
   * `background`, which renders the layout GitHub actually has.
   */
  colors: {
    background: "#f6f8fa", // Hermes `sidebarBackground` — the mat/rail tone
    foreground: "#1f2328",
    card: "#ffffff", // Hermes `background` — the sheet
    cardForeground: "#1f2328",
    muted: "#f6f6f6",
    mutedForeground: "#656d76",
    popover: "#ffffff",
    popoverForeground: "#1f2328",
    primary: NOUS_BLUE,
    primaryForeground: "#ffffff",
    secondary: "#deeaff",
    secondaryForeground: "#1f2328",
    accent: "#e3edff",
    accentForeground: "#1f2328",
    border: "#d0d7de",
    input: "#ffffff",
    ring: NOUS_BLUE,
    midground: NOUS_BLUE,
    midgroundForeground: "#ffffff",
    composerRing: NOUS_BLUE,
    destructive: "#cf222e",
    destructiveForeground: "#ffffff",
    sidebarBackground: "#f6f8fa",
    sidebarBorder: "#d0d7de",
    userBubble: "#dae7fd",
    userBubbleBorder: "#d0d7de",
  },
  darkColors: {
    background: "#0d1117",
    foreground: "#e6edf3",
    card: "#010409",
    cardForeground: "#e6edf3",
    muted: "#1a1e24",
    mutedForeground: "#7d8590",
    popover: "#161b22",
    popoverForeground: "#e6edf3",
    primary: NOUS_BLUE_DARK,
    primaryForeground: "#161616",
    secondary: "#1d2e4f",
    secondaryForeground: "#e6edf3",
    accent: "#17243a",
    accentForeground: "#e6edf3",
    border: "#30363d",
    input: "#0d1117",
    ring: NOUS_BLUE_DARK,
    midground: NOUS_BLUE_DARK,
    midgroundForeground: "#161616",
    composerRing: NOUS_BLUE_DARK,
    destructive: "#f85149",
    destructiveForeground: "#ffffff",
    sidebarBackground: "#010409",
    sidebarBorder: "#30363d",
    userBubble: "#07162c",
    userBubbleBorder: "#30363d",
  },
};

/* ── Nous Classic ────────────────────────────────────────────────────────────
 * Hermes calls this `nous-alt`: "the hand-authored Nous from before the GitHub
 * fork. Light is glass neutrals with brand blue; dark is cream on
 * mission-blue." It is the older Nous, kept because it is a different idea —
 * here the brand blue *is* the surface, where `nous` uses it only as an accent.
 *
 * Hermes declares its soft surfaces as CSS `color-mix(in srgb, …)` and lets the
 * browser blend them, so these are that mix computed to hex (LifeQuest's token
 * pipeline needs literals). Worth knowing: measured against the seed's OKLCH hue
 * of 262.7°, those particular sRGB blends land 1.7–4.0° violet. That drift is
 * Hermes's own, kept deliberately — the palette is a copy, not a correction.
 */
const NOUS_CLASSIC_BLUE = "#0053fd";
const NOUS_CLASSIC_NAVY = "#1540b1";
const NOUS_CLASSIC_CREAM = "#ffe6cb";

export const nousClassicSkin: ForgeSkin = {
  name: "nous-classic",
  label: "Nous Classic",
  description: "Glass neutrals by day, cream on mission-blue by night",
  // Same swap as `nous`, for the same reason: LifeQuest's light ladder reads
  // `background` as the mat and `card` as the sheet, so Hermes's sidebar tone
  // (`#F3F7FF`) lands in `background` and its page (`#F8FAFF`) in `card`.
  colors: {
    background: "#f3f7ff",
    foreground: "#17171a",
    card: "#f8faff",
    cardForeground: "#17171a",
    muted: "#f2f6ff",
    mutedForeground: "#666678",
    popover: "#ffffff",
    popoverForeground: "#17171a",
    primary: NOUS_CLASSIC_BLUE,
    primaryForeground: "#fcfcfc",
    secondary: "#edf3ff",
    secondaryForeground: "#242432",
    accent: "#e6eeff",
    accentForeground: "#202030",
    border: "#c1d5ff",
    input: "#aec8fe",
    ring: NOUS_CLASSIC_BLUE,
    midground: NOUS_CLASSIC_BLUE,
    composerRing: NOUS_CLASSIC_BLUE,
    destructive: "#c72e4d",
    destructiveForeground: "#ffffff",
    sidebarBackground: "#f3f7ff",
    sidebarBorder: "#c7d9ff",
    userBubble: "#f0f5ff",
    userBubbleBorder: "#bcd2ff",
  },
  darkColors: {
    background: "#0d2f86",
    foreground: NOUS_CLASSIC_CREAM,
    card: "#12378f",
    cardForeground: NOUS_CLASSIC_CREAM,
    muted: "#183f9a",
    mutedForeground: "#b5c7f3",
    popover: "#123a96",
    popoverForeground: NOUS_CLASSIC_CREAM,
    primary: NOUS_CLASSIC_CREAM,
    primaryForeground: "#0d2f86",
    secondary: "#1b45a4",
    secondaryForeground: "#e0e8ff",
    accent: NOUS_CLASSIC_NAVY,
    accentForeground: "#f0f4ff",
    border: "#3158ad",
    input: "#0b2566",
    ring: NOUS_CLASSIC_CREAM,
    midground: NOUS_CLASSIC_BLUE,
    composerRing: NOUS_CLASSIC_CREAM,
    destructive: "#c0473a",
    destructiveForeground: "#fef2f2",
    sidebarBackground: "#09286f",
    sidebarBorder: "#234a9c",
    userBubble: "#143b91",
    userBubbleBorder: "#3a63bd",
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

/**
 * Night on the cooling floor: the page canvas is the deepest ink (`background`),
 * and `card` is the one step above it that the cards and the panels wear. The day
 * palette runs the other way — there the mat sinks below the paper — because night
 * inverts the ladder in every skin.
 */
const FORGE_OS_DARK = {
  background: "#111214",
  card: "#1A1D22",
  primary: "#A8552D",
  accent: "#E86A33",
  highlight: "#FFB56B",
  text: "#F3F3F3",
  muted: "#8B8B8B",
} as const;

/**
 * The quiet ink between the page and the cards: the dock's own bottom action band
 * (`.chat-panel__actions`), the hover fills, and — because night hangs the mat on
 * this band — the rail and the titlebar too. Both read as one material rather than
 * two greys that nearly match, and moving the band moves the frame with it.
 */
const FORGE_OS_DARK_BAND = mix(
  FORGE_OS_DARK.background,
  FORGE_OS_DARK.card,
  0.36,
);

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
    // The quiet band the mat reads: the rail and the titlebar wear the dock's own
    // bottom action row's ink, a step under the cards and clear of the page.
    muted: FORGE_OS_DARK_BAND,
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
  "nous-classic": nousClassicSkin,
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

