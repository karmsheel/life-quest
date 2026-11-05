import { isDarkBackground, mix } from "./color.ts";
import type { ForgeSkin, SkinColors } from "./types.ts";

/**
 * The Nous theme, taken verbatim from Hermes Desktop's bundled presets
 * (`apps/shared/src/theme-presets.ts` + `apps/desktop/src/themes/presets.ts`).
 * Hermes ships it as its product identity — `nous` is its `DEFAULT_SKIN_NAME` —
 * so LifeQuest carries the same name and the same palette rather than a
 * re-derivation, and a user moving between the two apps sees one look.
 *
 * It ships no font opinion: Hermes's theme model keeps layout, sizing, radius
 * and typography out of the palette (`types.ts`: "Everything else ...
 * lives in styles.css"), and the theme declares only the system stacks. It also
 * carries no imagery and no second accent, so the skin has no CSS layer.
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

/* ── Grayscale ───────────────────────────────────────────────────────────────
 * The old dark-only `mono` grown into a two-palette grayscale: paper and graphite
 * by day, charcoal and ash by night. Every token is neutral — including the
 * semantic success/info inks, which is the one place the old mono still leaked
 * colour — so the theme is what it says it is at both times of day.
 */
export const grayscaleSkin: ForgeSkin = {
  name: "grayscale",
  label: "Grayscale",
  description: "Paper and graphite by day, charcoal and ash by night — no colour at all",
  colors: {
    background: "#E7E7E7",
    foreground: "#1B1B1B",
    card: "#FAFAFA",
    cardForeground: "#1B1B1B",
    muted: "#EFEFEF",
    mutedForeground: "#6B6B6B",
    popover: "#FFFFFF",
    popoverForeground: "#1B1B1B",
    primary: "#2E2E2E",
    primaryForeground: "#F7F7F7",
    secondary: "#DCDCDC",
    secondaryForeground: "#242424",
    accent: "#D4D4D4",
    accentForeground: "#141414",
    border: "#C8C8C8",
    input: "#BEBEBE",
    ring: "#5A5A5A",
    midground: "#5A5A5A",
    midgroundForeground: "#FFFFFF",
    destructive: "#3F3F3F",
    destructiveForeground: "#FFFFFF",
    sidebarBackground: "#E3E3E3",
    sidebarBorder: "#CDCDCD",
    success: "#4E4E4E",
    info: "#4E4E4E",
  },
  darkColors: {
    background: "#0E0E0E",
    foreground: "#EAEAEA",
    card: "#141414",
    cardForeground: "#EAEAEA",
    muted: "#1E1E1E",
    mutedForeground: "#808080",
    popover: "#181818",
    popoverForeground: "#EAEAEA",
    primary: "#EAEAEA",
    primaryForeground: "#0E0E0E",
    secondary: "#262626",
    secondaryForeground: "#C8C8C8",
    accent: "#222222",
    accentForeground: "#D8D8D8",
    border: "#2A2A2A",
    input: "#2A2A2A",
    ring: "#9A9A9A",
    midground: "#9A9A9A",
    midgroundForeground: "#0E0E0E",
    destructive: "#A0A0A0",
    destructiveForeground: "#0E0E0E",
    sidebarBackground: "#0A0A0A",
    sidebarBorder: "#202020",
    success: "#C0C0C0",
    info: "#C0C0C0",
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
  grayscale: grayscaleSkin,
};

export const BUILTIN_SKIN_LIST = Object.values(BUILTIN_SKINS);

export const DEFAULT_SKIN_NAME = "forge-os";

/**
 * The theme the window hands itself to when the one it is wearing cannot paint
 * the colour mode it is being asked for — a one-palette installed theme met by a
 * day/night switch. Nous ships both palettes, so the switch always lands on a
 * theme that can show the answer instead of leaving a light palette in the dark.
 */
export const FALLBACK_SKIN_NAME = "nous";

/**
 * Names that moved when themes were renamed or retired. Storage is read through
 * this map before validation: an operator who was wearing `mono` opens on
 * `grayscale`, a theme taken out of the product hands the window back to the
 * fallback theme the day/night switch uses, and neither kind of old name leaves
 * a hole in the quick menu.
 */
const LEGACY_SKIN_NAMES: Record<string, string> = {
  mono: "grayscale",
  "nous-classic": FALLBACK_SKIN_NAME,
  midnight: FALLBACK_SKIN_NAME,
  ember: FALLBACK_SKIN_NAME,
  cyberpunk: FALLBACK_SKIN_NAME,
};

export function resolveLegacySkinName(name: string | null): string | null {
  if (!name) return null;
  return LEGACY_SKIN_NAMES[name] ?? name;
}

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

