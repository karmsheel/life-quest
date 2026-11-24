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
 *  - `scene`    — the decoration layer behind the page. Data names a preset and
 *                 an intensity; the app owns the pixels.
 *  - `composition` — R4: a closed widget vocabulary on named regions. Data only;
 *                 the widgets and their data bindings are closed sets (see
 *                 `composition.ts`).
 *
 * It lives in `shared/` because three callers need the same rules: the renderer
 * that wears a theme, main's theme tools the companion calls, and the E2E rigs.
 * Nothing here touches the vault or the DOM: a theme is presentation, and it is
 * read from the app profile, not the life.
 */
import type { SkinColors } from "../src/lib/themes/types.ts";
import {
  COMPOSITION_VOCABULARY,
  parseComposition,
  type ThemeComposition,
} from "./composition.ts";

export * from "./composition.ts";

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
export type DomainSwitcherFrame = "pill" | "bare";

export type NavRailPlace = "left" | "right" | "floating";
export type TitlebarSize = "compact" | "default" | "tall";
export type ChatDockSide = "left" | "right";
export type NavRailWidth = "narrow" | "default" | "wide";

export type ThemeChrome = {
  wingSwitcher: { place: WingSwitcherPlace; variant: WingSwitcherVariant };
  domainSwitcher: {
    place: DomainSwitcherPlace;
    variant: DomainSwitcherVariant;
    /** The dock's own frame: the pill container, or a bare stack of rows. */
    frame: DomainSwitcherFrame;
  };
  /** The sidebar's own column: which edge it holds and how much room it keeps. */
  navRail: { place: NavRailPlace; width: NavRailWidth };
  /** The dock's edge: which side of the page the operator's chat lives on. */
  chatDock: { side: ChatDockSide };
  /** The window strip's height: how much of the top the chrome takes. */
  titlebar: { size: TitlebarSize };
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
  chatDock?: Partial<ThemeChrome["chatDock"]>;
  titlebar?: Partial<ThemeChrome["titlebar"]>;
};

export type SceneBackdropPreset =
  | "plain"
  | "starfield"
  | "orbit"
  | "aurora"
  | "horizon"
  | "mesh";
export type SceneIntensity = "calm" | "default" | "lively";
export type SceneCanvasFrame = "none" | "hairline" | "double" | "halo";
export type SceneCardFrame = "theme" | "outline" | "raised";

export type BackgroundImageFit = "cover" | "contain" | "tile";
export type BackgroundImagePosition = "center" | "top" | "bottom";
export type BackgroundImageDim = "none" | "soft" | "strong";
export type BackgroundImageBlur = "none" | "soft" | "deep";

/**
 * How much of the backdrop shows through one shell panel.
 *
 * The words name a step, not a colour: the stylesheet maps each one to a veil
 * percentage over the panel's own paint. `solid` is the opaque panel the app had
 * before the background layer existed; `clear` lets the whole backdrop through.
 */
export type PanelOcclusion = "solid" | "heavy" | "medium" | "light" | "clear";

/** The two shell panels a background can show through. */
export type ThemeBackgroundPanels = {
  /** The left sidebar (nav rail). */
  navRail: PanelOcclusion;
  /** The right chat bar (the dock panel). */
  chat: PanelOcclusion;
};

/**
 * A picture behind the page, named by its file in the app profile.
 *
 * The theme carries the *choices* — which stored picture and how it sits — not
 * the bytes. Main copies the operator's pick into `<app profile>/backgrounds/`
 * under a content-hashed name, so `file` is a name in that directory, never a
 * path or a URL: a theme can travel between profiles without carrying an image,
 * and a picture that is gone falls back to the drawn preset at paint time.
 */
export type ThemeBackgroundImage = {
  /** A file name inside `<app profile>/backgrounds/`, never a path or a URL. */
  file: string;
  fit: BackgroundImageFit;
  position: BackgroundImagePosition;
  dim: BackgroundImageDim;
  blur: BackgroundImageBlur;
};

/**
 * The scene layer: decoration, never structure.
 *
 * A theme names one of the bundled procedural backgrounds and how lively it
 * runs, and may name a picture already stored in the profile's `backgrounds/`.
 * It cannot ship an image, a canvas, or a shader — the vocabulary is closed and
 * the renderer is the app's, which is what keeps the page legible, the CSP
 * narrow and the frame budget honest.
 */
export type ThemeScene = {
  background: {
    preset: SceneBackdropPreset;
    intensity: SceneIntensity;
    /** null = drawn preset only. */
    image: ThemeBackgroundImage | null;
    /** How much of the backdrop shows through the sidebar and the chat bar. */
    panels: ThemeBackgroundPanels;
  };
  /**
   * The frame layer: how the page's edge and its cards are drawn. Still a closed
   * vocabulary — the theme picks a named treatment, the stylesheet owns what it
   * looks like, so a frame can never become an arbitrary outline.
   */
  frames: {
    canvas: SceneCanvasFrame;
    cards: SceneCardFrame;
  };
};

/** What a theme file may say about one scene background. */
export type ThemeBackgroundFile = {
  preset?: SceneBackdropPreset;
  intensity?: SceneIntensity;
  /** null means "no picture" and, in an override, hides the theme's picture. */
  image?: ThemeBackgroundImage | null;
  /** Only the panels the file changes; the rest stay at their layered value. */
  panels?: Partial<ThemeBackgroundPanels>;
};

/** What a theme file may say about the scene: any field left out is defaulted. */
export type ThemeSceneFile = {
  background?: ThemeBackgroundFile;
  frames?: Partial<ThemeScene["frames"]>;
};

/** The operator's own scene picks, layered over the theme's. */
export type ThemeSceneOverride = ThemeSceneFile;

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
  scene?: ThemeSceneFile;
  /** R4: widgets on named regions; absent means a theme with no widgets. */
  composition?: ThemeComposition;
};

export const DEFAULT_THEME_CHROME: ThemeChrome = {
  wingSwitcher: { place: "rail-top", variant: "labels" },
  domainSwitcher: { place: "titlebar-center", variant: "segmented", frame: "pill" },
  navRail: { place: "left", width: "default" },
  chatDock: { side: "right" },
  titlebar: { size: "default" },
};

/** A picture's sitting defaults: fit the whole page, softened so text reads. */
export const DEFAULT_BACKGROUND_IMAGE: Omit<ThemeBackgroundImage, "file"> = {
  fit: "cover",
  position: "center",
  dim: "soft",
  blur: "none",
};

/** Both panels opaque by default: exactly the look the app had before R2. */
export const DEFAULT_BACKGROUND_PANELS: ThemeBackgroundPanels = {
  navRail: "solid",
  chat: "solid",
};

export const DEFAULT_THEME_SCENE: ThemeScene = {
  background: {
    preset: "plain",
    intensity: "calm",
    image: null,
    panels: { ...DEFAULT_BACKGROUND_PANELS },
  },
  frames: { canvas: "none", cards: "theme" },
};

export const SCENE_BACKDROPS: readonly SceneBackdropPreset[] = [
  "plain",
  "starfield",
  "orbit",
  "aurora",
  "horizon",
  "mesh",
];
export const SCENE_INTENSITIES: readonly SceneIntensity[] = [
  "calm",
  "default",
  "lively",
];
export const SCENE_CANVAS_FRAMES: readonly SceneCanvasFrame[] = [
  "none",
  "hairline",
  "double",
  "halo",
];
export const SCENE_CARD_FRAMES: readonly SceneCardFrame[] = [
  "theme",
  "outline",
  "raised",
];

export const BACKGROUND_IMAGE_FITS: readonly BackgroundImageFit[] = [
  "cover",
  "contain",
  "tile",
];
export const BACKGROUND_IMAGE_POSITIONS: readonly BackgroundImagePosition[] = [
  "center",
  "top",
  "bottom",
];
export const BACKGROUND_IMAGE_DIMS: readonly BackgroundImageDim[] = [
  "none",
  "soft",
  "strong",
];
export const BACKGROUND_IMAGE_BLURS: readonly BackgroundImageBlur[] = [
  "none",
  "soft",
  "deep",
];
export const PANEL_OCCLUSIONS: readonly PanelOcclusion[] = [
  "solid",
  "heavy",
  "medium",
  "light",
  "clear",
];

/** The file-name rule shared by main's store, the parser and the rigs. */
export const BACKGROUND_IMAGE_FILE =
  /^[a-z0-9][a-z0-9-]{0,79}\.(png|jpe?g|webp|gif)$/;
/** Main refuses a source picture larger than this. */
export const MAX_BACKGROUND_IMAGE_BYTES = 16 * 1024 * 1024;

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
export const DOMAIN_FRAMES: readonly DomainSwitcherFrame[] = ["pill", "bare"];
export const NAV_RAIL_PLACES: readonly NavRailPlace[] = [
  "left",
  "right",
  "floating",
];
export const TITLEBAR_SIZES: readonly TitlebarSize[] = [
  "compact",
  "default",
  "tall",
];
export const CHAT_DOCK_SIDES: readonly ChatDockSide[] = ["left", "right"];
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

/**
 * One `scene.background.image` object.
 *
 * `file` is required and must be a name main could have stored; the four axes
 * default from `DEFAULT_BACKGROUND_IMAGE` and a declared one must be in its
 * allow-list. Existence is deliberately not checked: the picture lives in this
 * profile, and a theme can be imported on a machine before its picture is, so a
 * missing file is a paint-time fallback rather than a parse error.
 */
function parseBackgroundImage(
  raw: unknown,
): { ok: true; image: ThemeBackgroundImage } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "scene.background.image must be an object or null" };
  }
  const file = raw.file;
  if (typeof file !== "string" || !BACKGROUND_IMAGE_FILE.test(file)) {
    return {
      ok: false,
      error:
        "scene.background.image.file must be a lowercase picture name ending in .png, .jpg, .jpeg, .webp or .gif",
    };
  }
  const image: ThemeBackgroundImage = { file, ...DEFAULT_BACKGROUND_IMAGE };
  for (const [key, allowed] of [
    ["fit", BACKGROUND_IMAGE_FITS],
    ["position", BACKGROUND_IMAGE_POSITIONS],
    ["dim", BACKGROUND_IMAGE_DIMS],
    ["blur", BACKGROUND_IMAGE_BLURS],
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      !(allowed as readonly string[]).includes(value)
    ) {
      return {
        ok: false,
        error: `scene.background.image.${key} must be one of ${allowed.join(", ")}`,
      };
    }
    (image as unknown as Record<string, string>)[key] = value;
  }
  return { ok: true, image };
}

/**
 * One `scene.background.panels` object.
 *
 * A theme names only the panels it shades; the ones it leaves out keep whatever
 * the layer below says. Unknown keys are ignored like the rest of the parser —
 * the vocabulary is read from the two axes the shell actually has, and a typo in
 * an axis name is not a value to trust.
 */
function parseBackgroundPanels(
  raw: unknown,
): { ok: true; panels: Partial<ThemeBackgroundPanels> } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "scene.background.panels must be an object" };
  }
  const panels: Partial<ThemeBackgroundPanels> = {};
  for (const axis of ["navRail", "chat"] as const) {
    const value = raw[axis];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      !(PANEL_OCCLUSIONS as readonly string[]).includes(value)
    ) {
      return {
        ok: false,
        error: `scene.background.panels.${axis} must be one of ${PANEL_OCCLUSIONS.join(", ")}`,
      };
    }
    panels[axis] = value as PanelOcclusion;
  }
  return { ok: true, panels };
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
  // The logo inks are optional (a palette that predates the lockup derives
  // them), but a palette that does name one is painting the mark: a non-hex
  // string there would reach CSS as an invalid fill and drop the group.
  for (const key of ["logoLife", "logoIcon", "logoUest"] as const) {
    const value = raw[key];
    if (value !== undefined && (typeof value !== "string" || !HEX.test(value.trim()))) {
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
      const frame = domain.frame;
      if (
        frame !== undefined &&
        (typeof frame !== "string" ||
          !(DOMAIN_FRAMES as readonly string[]).includes(frame))
      ) {
        return {
          ok: false,
          error: `chrome.domainSwitcher.frame must be one of ${DOMAIN_FRAMES.join(", ")}`,
        };
      }
      chrome.domainSwitcher = {
        place: place as DomainSwitcherPlace,
        variant: (variant as DomainSwitcherVariant) ?? "segmented",
        frame: (frame as DomainSwitcherFrame | undefined) ?? "pill",
      };
    }
    const titlebar = raw.chrome.titlebar;
    if (titlebar !== undefined) {
      if (!isRecord(titlebar)) {
        return { ok: false, error: "chrome.titlebar must be an object" };
      }
      const size = titlebar.size;
      if (size !== undefined) {
        if (
          typeof size !== "string" ||
          !(TITLEBAR_SIZES as readonly string[]).includes(size)
        ) {
          return {
            ok: false,
            error: `chrome.titlebar.size must be one of ${TITLEBAR_SIZES.join(", ")}`,
          };
        }
        chrome.titlebar = { size: size as TitlebarSize };
      }
    }
    const chatDock = raw.chrome.chatDock;
    if (chatDock !== undefined) {
      if (!isRecord(chatDock)) {
        return { ok: false, error: "chrome.chatDock must be an object" };
      }
      const side = chatDock.side;
      if (side !== undefined) {
        if (
          typeof side !== "string" ||
          !(CHAT_DOCK_SIDES as readonly string[]).includes(side)
        ) {
          return {
            ok: false,
            error: `chrome.chatDock.side must be one of ${CHAT_DOCK_SIDES.join(", ")}`,
          };
        }
        chrome.chatDock = { side: side as ChatDockSide };
      }
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

  const scene: ThemeSceneFile = {};
  if (raw.scene !== undefined) {
    if (!isRecord(raw.scene)) {
      return { ok: false, error: "scene must be an object" };
    }
    const background = raw.scene.background;
    if (background !== undefined) {
      if (!isRecord(background)) {
        return { ok: false, error: "scene.background must be an object" };
      }
      const preset = background.preset;
      const intensity = background.intensity;
      if (
        preset !== undefined &&
        (typeof preset !== "string" ||
          !(SCENE_BACKDROPS as readonly string[]).includes(preset))
      ) {
        return {
          ok: false,
          error: `scene.background.preset must be one of ${SCENE_BACKDROPS.join(", ")}`,
        };
      }
      if (
        intensity !== undefined &&
        (typeof intensity !== "string" ||
          !(SCENE_INTENSITIES as readonly string[]).includes(intensity))
      ) {
        return {
          ok: false,
          error: `scene.background.intensity must be one of ${SCENE_INTENSITIES.join(", ")}`,
        };
      }
      // A null picture and an absent one are the same file: no image key at all.
      // The distinction only matters in the operator's override, which the
      // renderer parses on its own (see `layerScene`).
      let image: ThemeBackgroundImage | null = null;
      if (background.image !== undefined && background.image !== null) {
        const parsedImage = parseBackgroundImage(background.image);
        if (!parsedImage.ok) return parsedImage;
        image = parsedImage.image;
      }
      let panels: Partial<ThemeBackgroundPanels> | undefined;
      if (background.panels !== undefined) {
        const parsedPanels = parseBackgroundPanels(background.panels);
        if (!parsedPanels.ok) return parsedPanels;
        panels = parsedPanels.panels;
      }
      scene.background = {
        ...(preset ? { preset: preset as SceneBackdropPreset } : {}),
        ...(intensity ? { intensity: intensity as SceneIntensity } : {}),
        ...(image ? { image } : {}),
        ...(panels && Object.keys(panels).length > 0 ? { panels } : {}),
      };
    }
    const frames = raw.scene.frames;
    if (frames !== undefined) {
      if (!isRecord(frames)) {
        return { ok: false, error: "scene.frames must be an object" };
      }
      const canvas = frames.canvas;
      const cards = frames.cards;
      if (
        canvas !== undefined &&
        (typeof canvas !== "string" ||
          !(SCENE_CANVAS_FRAMES as readonly string[]).includes(canvas))
      ) {
        return {
          ok: false,
          error: `scene.frames.canvas must be one of ${SCENE_CANVAS_FRAMES.join(", ")}`,
        };
      }
      if (
        cards !== undefined &&
        (typeof cards !== "string" ||
          !(SCENE_CARD_FRAMES as readonly string[]).includes(cards))
      ) {
        return {
          ok: false,
          error: `scene.frames.cards must be one of ${SCENE_CARD_FRAMES.join(", ")}`,
        };
      }
      scene.frames = {
        ...(canvas ? { canvas: canvas as SceneCanvasFrame } : {}),
        ...(cards ? { cards: cards as SceneCardFrame } : {}),
      };
    }
  }

  let composition: ThemeComposition | undefined;
  if (raw.composition !== undefined) {
    const parsed = parseComposition(raw.composition);
    if (!parsed.ok) return parsed;
    composition = parsed.composition;
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
      ...(scene.background || scene.frames ? { scene } : {}),
      ...(colors ? { colors } : {}),
      ...(darkColors ? { darkColors } : {}),
      ...(Object.keys(chrome).length > 0 ? { chrome } : {}),
      ...(Object.keys(material).length > 0 ? { material } : {}),
      ...(composition ? { composition } : {}),
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
    chatDock: {
      ...DEFAULT_THEME_CHROME.chatDock,
      ...chrome?.chatDock,
    },
    titlebar: {
      ...DEFAULT_THEME_CHROME.titlebar,
      ...chrome?.titlebar,
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
    chatDock: { ...theme?.chatDock, ...override?.chatDock },
    titlebar: { ...theme?.titlebar, ...override?.titlebar },
  } as Partial<ThemeChrome>);
}

export function resolveScene(scene?: ThemeSceneFile): ThemeScene {
  return {
    background: {
      preset: scene?.background?.preset ?? DEFAULT_THEME_SCENE.background.preset,
      intensity:
        scene?.background?.intensity ?? DEFAULT_THEME_SCENE.background.intensity,
      image: scene?.background?.image ?? null,
      panels: { ...DEFAULT_BACKGROUND_PANELS, ...scene?.background?.panels },
    },
    frames: {
      canvas: scene?.frames?.canvas ?? DEFAULT_THEME_SCENE.frames.canvas,
      cards: scene?.frames?.cards ?? DEFAULT_THEME_SCENE.frames.cards,
    },
  };
}

/**
 * Layer the operator's scene picks over the worn theme's scene.
 *
 * The picture is the one field where "absent" and "null" differ: omitting
 * `image` inherits the theme's picture, while an explicit `image: null` is the
 * operator's "no picture", which also hides the theme's. That is what makes
 * Reset to theme a plain deletion and Remove a real override. The panel shades
 * layer per axis, so an operator who only touches the sidebar keeps the theme's
 * choice for the chat bar.
 */
export function layerScene(
  theme?: ThemeSceneFile,
  override?: ThemeSceneOverride,
): ThemeScene {
  return resolveScene({
    background: {
      ...theme?.background,
      ...override?.background,
      image:
        override?.background?.image !== undefined
          ? override.background.image
          : theme?.background?.image ?? null,
      panels: {
        ...DEFAULT_BACKGROUND_PANELS,
        ...theme?.background?.panels,
        ...override?.background?.panels,
      },
    },
    frames: { ...theme?.frames, ...override?.frames },
  });
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
  "Shape: { name (slug), label, description?, chrome?, material?, scene?, colors?, darkColors? }.",
  "chrome.wingSwitcher.place: rail-top | titlebar-left | floating-left | hidden (variant labels | icons).",
  "chrome.domainSwitcher.place: titlebar-center | below-titlebar | bottom-center | floating-bottom-right | hidden (variant segmented | pill | icons | list; frame pill | bare — bare drops the dock's container so the rows are the whole control).",
  "chrome.titlebar.size: compact | default | tall; chrome.chatDock.side: left | right; chrome.navRail.place: left | right | floating; chrome.navRail.width: narrow | default | wide; material.radius: sharp | soft | round; material.density: compact | default | airy; material.motion: none | calm | lively; material.shadow: flat | soft | deep; material.typeScale: compact | default | airy; material.backdrop: plain | wash | grid.",
  "scene.background.preset: plain | starfield | orbit | aurora | horizon | mesh (procedural, bundled: no images, no CSS); scene.background.intensity: calm | default | lively. The scene paints behind the whole shell — sidebar, page and dock — behind a scrim, and stops dead under prefers-reduced-motion.",
  "scene.background.image: { file, fit, position, dim, blur } — a picture already stored in the app profile's backgrounds/ directory, which the operator picks; a theme names the stored file, never a path or URL. fit: cover | contain | tile; position: center | top | bottom; dim: none | soft | strong; blur: none | soft | deep. It replaces the drawn sky while set, and a missing file falls back to it.",
  "scene.background.panels.navRail / .chat: solid | heavy | medium | light | clear (how much of the backdrop shows through the sidebar / chat bar; solid is the opaque panel).",
  "get_theme lists the pictures stored in the app profile's backgrounds/ (file, bytes, mime) and the resolved scene (preset, intensity, frames, image, panels); name one in scene.background.image.file. store_background_picture copies a vault image into that folder and returns the file name; write_theme then wears it (preview/Keep). The operator's Settings override outranks a theme.",
  "scene.frames.canvas: none | hairline | double | halo (the page's decorative edge); scene.frames.cards: theme | outline | raised (how the page's cards are drawn).",
  COMPOSITION_VOCABULARY,
  "Colours are optional; when present the palette must be complete and pass WCAG AA, or the theme is refused with the failing pair named.",
  "Tools: get_theme (files + the one being worn), validate_theme (dry run: field errors and contrast), write_theme (write it; the operator sees a 10-second preview with Keep and Revert). Never take the window away: placement moves controls, it never removes Settings, window controls or the reset.",
].join("\n");
