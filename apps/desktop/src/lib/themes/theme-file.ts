/**
 * Theme files, v2: the app chrome a theme may change, loaded from the vault
 * app's `themes/` directory and hot-reloaded as the files change.
 *
 * A v2 theme is a superset of the Forge skin the app already shares with Hermes
 * Desktop. The palette stays where it is (`ForgeSkin`); this file adds two
 * sections a theme may carry:
 *
 *  - `chrome`  — *where* the shell's own components live and which variant they
 *                wear. Only closed enums: a typo is a named error, never a shell
 *                that cannot find its own controls.
 *  - `material` — radius, density, motion. The first rung above colour.
 *
 * Nothing here touches the vault or the main process's data: a theme is
 * presentation, and it is read from the app profile, not the life.
 */
import type { SkinColors } from "./types";

export type WingSwitcherPlace =
  | "rail-top"
  | "titlebar-left"
  | "floating-left"
  | "hidden";
export type WingSwitcherVariant = "labels" | "icons";
export type DomainSwitcherPlace =
  | "titlebar-center"
  | "below-titlebar"
  | "bottom-center"
  | "floating-bottom-right"
  | "hidden";
export type DomainSwitcherVariant = "segmented" | "pill";

export type ThemeChrome = {
  wingSwitcher: { place: WingSwitcherPlace; variant: WingSwitcherVariant };
  domainSwitcher: {
    place: DomainSwitcherPlace;
    variant: DomainSwitcherVariant;
  };
};

export type ThemeMaterial = {
  radius: "sharp" | "soft" | "round";
  density: "compact" | "default" | "airy";
  motion: "none" | "calm" | "lively";
};

/** A theme file as it arrives from disk, before defaults fill the gaps. */
export type ThemeFile = {
  name: string;
  label: string;
  description?: string;
  colors?: Partial<SkinColors>;
  darkColors?: Partial<SkinColors>;
  chrome?: Partial<ThemeChrome>;
  material?: Partial<ThemeMaterial>;
};

export const DEFAULT_THEME_CHROME: ThemeChrome = {
  wingSwitcher: { place: "rail-top", variant: "labels" },
  domainSwitcher: { place: "titlebar-center", variant: "segmented" },
};

export const DEFAULT_THEME_MATERIAL: ThemeMaterial = {
  radius: "soft",
  density: "default",
  motion: "calm",
};

const WING_PLACES: readonly WingSwitcherPlace[] = [
  "rail-top",
  "titlebar-left",
  "floating-left",
  "hidden",
];
const WING_VARIANTS: readonly WingSwitcherVariant[] = ["labels", "icons"];
const DOMAIN_PLACES: readonly DomainSwitcherPlace[] = [
  "titlebar-center",
  "below-titlebar",
  "bottom-center",
  "floating-bottom-right",
  "hidden",
];
const DOMAIN_VARIANTS: readonly DomainSwitcherVariant[] = ["segmented", "pill"];
const RADII: readonly ThemeMaterial["radius"][] = ["sharp", "soft", "round"];
const DENSITIES: readonly ThemeMaterial["density"][] = [
  "compact",
  "default",
  "airy",
];
const MOTIONS: readonly ThemeMaterial["motion"][] = ["none", "calm", "lively"];

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

/**
 * Prove one theme file. The message names the field so the preview bar can say
 * what is wrong instead of silently ignoring a theme the operator just wrote.
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
    return { ok: false, error: "label must be a non-empty string of at most 80 chars" };
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  const chrome: Partial<ThemeChrome> = {};
  if (raw.chrome !== undefined) {
    if (!isRecord(raw.chrome)) return { ok: false, error: "chrome must be an object" };
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
    ] as const) {
      const value = raw.material[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
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
      ...(isRecord(raw.colors) ? { colors: raw.colors as Partial<SkinColors> } : {}),
      ...(isRecord(raw.darkColors)
        ? { darkColors: raw.darkColors as Partial<SkinColors> }
        : {}),
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
  };
}

export function resolveMaterial(
  material?: Partial<ThemeMaterial>,
): ThemeMaterial {
  return { ...DEFAULT_THEME_MATERIAL, ...material };
}

const RADIUS_SCALES: Record<ThemeMaterial["radius"], string[]> = {
  sharp: ["2px", "4px", "4px", "6px", "8px"],
  soft: ["6px", "12px", "12px", "18px", "24px"],
  round: ["12px", "16px", "16px", "22px", "28px"],
};

/**
 * Write the material layer onto the document, exactly where `applySkin` writes
 * the palette. Radius is set inline because no skin owns it; density and motion
 * are state attributes the stylesheet reads, so a theme cannot invent arbitrary
 * CSS.
 */
export function applyMaterial(
  material: ThemeMaterial,
  root: HTMLElement,
): void {
  const [xs, sm, base, md, lg] = RADIUS_SCALES[material.radius];
  root.style.setProperty("--radius-xs", xs!);
  root.style.setProperty("--radius-sm", sm!);
  root.style.setProperty("--radius", base!);
  root.style.setProperty("--radius-md", md!);
  root.style.setProperty("--radius-lg", lg!);
  root.dataset.materialDensity = material.density;
  root.dataset.materialMotion = material.motion;
}
