/**
 * Theme files, v2 — the model both sides of the app share.
 *
 * A v2 theme is a superset of the Forge skin the app already shares with Hermes
 * Desktop. The palette stays where it is (`ForgeSkin`); this file adds the two
 * sections a theme may carry:
 *
 *  - `chrome`   — *where* the shell's own components live and which variant they
 *                 wear. Only closed enums: a typo is a named error, never a
 *                 shell that cannot find its own controls.
 *  - `material` — radius, density, motion. The first rung above colour.
 *
 * It lives in `shared/` because three callers need the same rules: the renderer
 * that wears a theme, main's theme tools the companion calls, and the E2E rigs.
 * Nothing here touches the vault or the DOM: a theme is presentation, and it is
 * read from the app profile, not the life.
 */
import type { SkinColors } from "../src/lib/themes/types.ts";

export type WingSwitcherPlace =
  | "rail-top"
  | "titlebar-left"
  | "floating-left"
  | "hidden";
export type WingSwitcherVariant = "labels" | "icons" | "compact";
export type DomainSwitcherPlace =
  | "titlebar-center"
  | "left-rail"
  | "below-titlebar"
  | "bottom-center"
  | "floating-bottom-right"
  | "hidden";
export type DomainSwitcherVariant = "segmented" | "pill" | "icons" | "list";

export type NavRailPlace = "left" | "right";
export type NavRailWidth = "narrow" | "default" | "wide";

export type ThemeChrome = {
  wingSwitcher: { place: WingSwitcherPlace; variant: WingSwitcherVariant };
  domainSwitcher: {
    place: DomainSwitcherPlace;
    variant: DomainSwitcherVariant;
  };
  /** The sidebar's own column: which edge it holds and how much room it keeps. */
  navRail: { place: NavRailPlace; width: NavRailWidth };
};

/**
 * The operator's chrome picks, layered over whatever theme is worn. Every
 * field is optional per component: overriding the wing's place leaves the
 * theme's domain placement alone, which is what makes Settings useful without
 * turning into a second theme file.
 */
export type ThemeChromeOverride = {
  wingSwitcher?: Partial<ThemeChrome["wingSwitcher"]>;
  domainSwitcher?: Partial<ThemeChrome["domainSwitcher"]>;
  navRail?: Partial<ThemeChrome["navRail"]>;
};

export type ThemeShadow = "flat" | "soft" | "deep";
export type ThemeTypeScale = "compact" | "default" | "airy";
export type ThemeBackdrop = "plain" | "wash" | "grid";

export type ThemeMaterial = {
  radius: "sharp" | "soft" | "round";
  density: "compact" | "default" | "airy";
  motion: "none" | "calm" | "lively";
  /** Elevation: how far the sheet and its cards stand off the canvas. */
  shadow: ThemeShadow;
  /** Type scale: the whole rem ladder, set on the document root. */
  typeScale: ThemeTypeScale;
  /** Procedural canvas backdrop: flat, a palette wash, or a hairline grid. */
  backdrop: ThemeBackdrop;
};

/** A theme file as it arrives from disk, before defaults fill the gaps. */
export type ThemeFile = {
  name: string;
  label: string;
  description?: string;
  colors?: SkinColors;
  darkColors?: SkinColors;
  chrome?: Partial<ThemeChrome>;
  material?: Partial<ThemeMaterial>;
};

export const DEFAULT_THEME_CHROME: ThemeChrome = {
  wingSwitcher: { place: "rail-top", variant: "labels" },
  domainSwitcher: { place: "titlebar-center", variant: "segmented" },
  navRail: { place: "left", width: "default" },
};

export const DEFAULT_THEME_MATERIAL: ThemeMaterial = {
  radius: "soft",
  density: "default",
  motion: "calm",
  shadow: "soft",
  typeScale: "default",
  backdrop: "plain",
};

export const WING_PLACES: readonly WingSwitcherPlace[] = [
  "rail-top",
  "titlebar-left",
  "floating-left",
  "hidden",
];
export const WING_VARIANTS: readonly WingSwitcherVariant[] = [
  "labels",
  "icons",
  "compact",
];
export const DOMAIN_PLACES: readonly DomainSwitcherPlace[] = [
  "titlebar-center",
  "left-rail",
  "below-titlebar",
  "bottom-center",
  "floating-bottom-right",
  "hidden",
];
export const DOMAIN_VARIANTS: readonly DomainSwitcherVariant[] = [
  "segmented",
  "pill",
  "icons",
  "list",
];
export const NAV_RAIL_PLACES: readonly NavRailPlace[] = ["left", "right"];
export const NAV_RAIL_WIDTHS: readonly NavRailWidth[] = [
  "narrow",
  "default",
  "wide",
];
export const RADII: readonly ThemeMaterial["radius"][] = [
  "sharp",
  "soft",
  "round",
];
export const DENSITIES: readonly ThemeMaterial["density"][] = [
  "compact",
  "default",
  "airy",
];
export const MOTIONS: readonly ThemeMaterial["motion"][] = [
  "none",
  "calm",
  "lively",
];
export const SHADOWS: readonly ThemeShadow[] = ["flat", "soft", "deep"];
export const TYPE_SCALES: readonly ThemeTypeScale[] = [
  "compact",
  "default",
  "airy",
];
export const BACKDROPS: readonly ThemeBackdrop[] = ["plain", "wash", "grid"];

/** Every colour `applySkin` reads without a fallback. */
export const THEME_REQUIRED_COLORS: readonly (keyof SkinColors)[] = [
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
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;

export type ParseResult =
  | { ok: true; theme: ThemeFile }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | string {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return `${field} must be one of ${allowed.join(", ")}`;
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** WCAG 2.x relative luminance, 0..1. */
export function relativeLuminance(hex: string): number | null {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.length === 4
        ? clean
            .slice(0, 3)
            .split("")
            .map((c) => c + c)
            .join("")
        : clean.length === 8
          ? clean.slice(0, 6)
          : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Null when either colour is not readable hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The pairs the shell actually paints text on. WCAG AA normal text is 4.5:1. */
export const TEXT_CONTRAST_PAIRS: readonly [
  keyof SkinColors,
  keyof SkinColors,
][] = [
  ["background", "foreground"],
  ["card", "cardForeground"],
  ["muted", "mutedForeground"],
  ["popover", "popoverForeground"],
  ["primary", "primaryForeground"],
  ["secondary", "secondaryForeground"],
  ["accent", "accentForeground"],
  ["destructive", "destructiveForeground"],
];

export type ContrastFailure = {
  pair: string;
  ratio: number;
  minimum: number;
};

/**
 * Every text pair a palette fails, with the ratio that makes it a failure.
 *
 * Enforced, not suggested: a theme that cannot be read is refused with the pair
 * named, so the companion gets a sentence it can act on instead of a silent
 * unreadable window.
 */
export function checkThemeContrast(
  colors: SkinColors,
  minimum = 4.5,
): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const [surface, ink] of TEXT_CONTRAST_PAIRS) {
    const surfaceColor = colors[surface];
    const inkColor = colors[ink];
    if (typeof surfaceColor !== "string" || typeof inkColor !== "string") {
      continue;
    }
    const ratio = contrastRatio(surfaceColor, inkColor);
    if (ratio !== null && ratio < minimum) {
      failures.push({
        pair: `${surface}/${ink}`,
        ratio: Math.round(ratio * 10) / 10,
        minimum,
      });
    }
  }
  return failures;
}

function parseColors(
  raw: unknown,
  field: "colors" | "darkColors",
): { ok: true; colors: SkinColors } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `${field} must be an object` };
  for (const key of THEME_REQUIRED_COLORS) {
    const value = raw[key];
    if (typeof value !== "string" || !HEX.test(value.trim())) {
      return {
        ok: false,
        error: `${field}.${key} must be a hex colour (#rgb, #rgba, #rrggbb or #rrggbbaa)`,
      };
    }
  }
  const colors = {} as SkinColors;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      (colors as unknown as Record<string, string>)[key] = value.trim();
    }
  }
  const failures = checkThemeContrast(colors);
  if (failures.length > 0) {
    const [first] = failures;
    return {
      ok: false,
      error: `${field} fails WCAG AA contrast on ${first!.pair}: ${first!.ratio}:1 (needs ${first!.minimum}:1)`,
    };
  }
  return { ok: true, colors };
}

/**
 * Prove one theme file. The message names the field so the preview bar and the
 * companion both get a sentence they can act on instead of a silent refusal.
 */
export function parseThemeFile(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: "theme must be a JSON object" };
  const name = raw.name;
  if (typeof name !== "string" || !NAME.test(name)) {
    return {
      ok: false,
      error: "name must be a lowercase slug (a-z, 0-9, dash; 2–40 chars)",
    };
  }
  const label = raw.label;
  if (typeof label !== "string" || label.trim() === "" || label.length > 80) {
    return {
      ok: false,
      error: "label must be a non-empty string of at most 80 chars",
    };
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  let colors: SkinColors | undefined;
  if (raw.colors !== undefined) {
    const parsed = parseColors(raw.colors, "colors");
    if (!parsed.ok) return parsed;
    colors = parsed.colors;
  }
  let darkColors: SkinColors | undefined;
  if (raw.darkColors !== undefined) {
    const parsed = parseColors(raw.darkColors, "darkColors");
    if (!parsed.ok) return parsed;
    darkColors = parsed.colors;
  }

  const chrome: Partial<ThemeChrome> = {};
  if (raw.chrome !== undefined) {
    if (!isRecord(raw.chrome)) {
      return { ok: false, error: "chrome must be an object" };
    }
    const wing = raw.chrome.wingSwitcher;
    if (wing !== undefined) {
      if (!isRecord(wing)) {
        return { ok: false, error: "chrome.wingSwitcher must be an object" };
      }
      const place = oneOf(wing.place, WING_PLACES, "chrome.wingSwitcher.place");
      if (!WING_PLACES.includes(place as WingSwitcherPlace)) {
        return { ok: false, error: place };
      }
      const variant = oneOf(
        wing.variant,
        WING_VARIANTS,
        "chrome.wingSwitcher.variant",
      );
      if (typeof variant !== "string" && wing.variant !== undefined) {
        return { ok: false, error: variant };
      }
      chrome.wingSwitcher = {
        place: place as WingSwitcherPlace,
        variant: (variant as WingSwitcherVariant) ?? "labels",
      };
    }
    const domain = raw.chrome.domainSwitcher;
    if (domain !== undefined) {
      if (!isRecord(domain)) {
        return { ok: false, error: "chrome.domainSwitcher must be an object" };
      }
      const place = oneOf(
        domain.place,
        DOMAIN_PLACES,
        "chrome.domainSwitcher.place",
      );
      if (!DOMAIN_PLACES.includes(place as DomainSwitcherPlace)) {
        return { ok: false, error: place };
      }
      const variant = oneOf(
        domain.variant,
        DOMAIN_VARIANTS,
        "chrome.domainSwitcher.variant",
      );
      if (typeof variant !== "string" && domain.variant !== undefined) {
        return { ok: false, error: variant };
      }
      chrome.domainSwitcher = {
        place: place as DomainSwitcherPlace,
        variant: (variant as DomainSwitcherVariant) ?? "segmented",
      };
    }
    const navRail = raw.chrome.navRail;
    if (navRail !== undefined) {
      if (!isRecord(navRail)) {
        return { ok: false, error: "chrome.navRail must be an object" };
      }
      const place = navRail.place;
      if (place !== undefined) {
        if (
          typeof place !== "string" ||
          !(NAV_RAIL_PLACES as readonly string[]).includes(place)
        ) {
          return {
            ok: false,
            error: `chrome.navRail.place must be one of ${NAV_RAIL_PLACES.join(", ")}`,
          };
        }
      }
      const width = navRail.width;
      if (width !== undefined) {
        if (
          typeof width !== "string" ||
          !(NAV_RAIL_WIDTHS as readonly string[]).includes(width)
        ) {
          return {
            ok: false,
            error: `chrome.navRail.width must be one of ${NAV_RAIL_WIDTHS.join(", ")}`,
          };
        }
        chrome.navRail = {
          place: (place as NavRailPlace) ?? "left",
          width: width as NavRailWidth,
        };
      }
    }
  }

  const material: Partial<ThemeMaterial> = {};
  if (raw.material !== undefined) {
    if (!isRecord(raw.material)) {
      return { ok: false, error: "material must be an object" };
    }
    for (const [key, allowed] of [
      ["radius", RADII],
      ["density", DENSITIES],
      ["motion", MOTIONS],
      ["shadow", SHADOWS],
      ["typeScale", TYPE_SCALES],
      ["backdrop", BACKDROPS],
    ] as const) {
      const value = raw.material[key];
      if (value === undefined) continue;
      if (
        typeof value !== "string" ||
        !(allowed as readonly string[]).includes(value)
      ) {
        return {
          ok: false,
          error: `material.${key} must be one of ${allowed.join(", ")}`,
        };
      }
      (material as Record<string, string>)[key] = value;
    }
  }

  return {
    ok: true,
    theme: {
      name,
      label,
      ...(typeof raw.description === "string"
        ? { description: raw.description }
        : {}),
      ...(colors ? { colors } : {}),
      ...(darkColors ? { darkColors } : {}),
      ...(Object.keys(chrome).length > 0 ? { chrome } : {}),
      ...(Object.keys(material).length > 0 ? { material } : {}),
    },
  };
}

export function resolveChrome(chrome?: Partial<ThemeChrome>): ThemeChrome {
  return {
    wingSwitcher: {
      ...DEFAULT_THEME_CHROME.wingSwitcher,
      ...chrome?.wingSwitcher,
    },
    domainSwitcher: {
      ...DEFAULT_THEME_CHROME.domainSwitcher,
      ...chrome?.domainSwitcher,
    },
    navRail: {
      ...DEFAULT_THEME_CHROME.navRail,
      ...chrome?.navRail,
    },
  };
}

/** Layer the operator's chrome picks over the worn theme's chrome. */
export function layerChrome(
  theme?: Partial<ThemeChrome>,
  override?: ThemeChromeOverride,
): ThemeChrome {
  return resolveChrome({
    wingSwitcher: { ...theme?.wingSwitcher, ...override?.wingSwitcher },
    domainSwitcher: { ...theme?.domainSwitcher, ...override?.domainSwitcher },
    navRail: { ...theme?.navRail, ...override?.navRail },
  } as Partial<ThemeChrome>);
}

export function resolveMaterial(
  material?: Partial<ThemeMaterial>,
): ThemeMaterial {
  return { ...DEFAULT_THEME_MATERIAL, ...material };
}

/**
 * The vocabulary a companion needs to author a theme without seeing pixels.
 *
 * One paragraph, appended to every turn's instructions when the companion may
 * write; the tools carry the details of the file itself.
 */
export const THEME_VOCABULARY = [
  "A theme is presentation only: a JSON file at <app profile>/themes/<name>.json, never in the vault, and it needs no Decision.",
  "Shape: { name (slug), label, description?, chrome?, material?, colors?, darkColors? }.",
  "chrome.wingSwitcher.place: rail-top | titlebar-left | floating-left | hidden (variant labels | icons).",
  "chrome.domainSwitcher.place: titlebar-center | below-titlebar | bottom-center | floating-bottom-right | hidden (variant segmented | pill).",
  "chrome.navRail.place: left | right; chrome.navRail.width: narrow | default | wide; material.radius: sharp | soft | round; material.density: compact | default | airy; material.motion: none | calm | lively; material.shadow: flat | soft | deep; material.typeScale: compact | default | airy; material.backdrop: plain | wash | grid.",
  "Colours are optional; when present the palette must be complete and pass WCAG AA, or the theme is refused with the failing pair named.",
  "Tools: get_theme (files + the one being worn), validate_theme (dry run: field errors and contrast), write_theme (write it; the operator sees a 10-second preview with Keep and Revert). Never take the window away: placement moves controls, it never removes Settings, window controls or the reset.",
].join("\n");
