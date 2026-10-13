/** Color helpers ported from Hermes Desktop `apps/desktop/src/themes/color.ts`. */

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number];
}

export const rgbToHex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b]
    .map((n) =>
      Math.round(Math.min(255, Math.max(0, n)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex([
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]);
}

export function mix(a: string, b: string, amount: number): string {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return a;
  return rgbToHex([
    ar[0] + (br[0] - ar[0]) * amount,
    ar[1] + (br[1] - ar[1]) * amount,
    ar[2] + (br[2] - ar[2]) * amount,
  ]);
}

/* ── OKLab ───────────────────────────────────────────────────────────────────
 *
 * `mix` lerps gamma-encoded sRGB channels, which bends hue on the way: a
 * saturated blue mixed 88% toward white lands ~7.6° violet of where it started.
 * That is the whole reason a clean blue accent produced a lavender selection
 * row, and it is a property of the blend, not of the palette — no hex can fix
 * it, because the drift happens after the palette. OKLab is near-perceptually
 * uniform, so the same blend walks chroma and lightness and keeps the hue: the
 * soft surface reads as a pale version of the accent rather than a new colour.
 *
 * Ported from Hermes Desktop's `apps/desktop/src/themes/color.ts`, which hit
 * this exact bug and fixed it here. `mix` remains correct for blending
 * neutrals, where there is no hue to preserve; use `mixOklab` for anything
 * derived from a brand seed.
 */

/** Perceptual lightness 0..1, chroma, hue 0..360. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const delinearize = (channel: number): number =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** 0–255 sRGB triple → OKLab [L, a, b]. */
function rgbToOklab([r255, g255, b255]: readonly number[]): [number, number, number] {
  const [r, g, b] = [r255, g255, b255].map((v) => linearize(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Raw (possibly out-of-gamut) 0–255 sRGB triple for an OKLCH colour. */
function oklchToRgbRaw({ l: okL, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const okA = c * Math.cos(rad);
  const okB = c * Math.sin(rad);

  const l = (okL + 0.3963377774 * okA + 0.2158037573 * okB) ** 3;
  const m = (okL - 0.1055613458 * okA - 0.0638541728 * okB) ** 3;
  const s = (okL - 0.0894841775 * okA - 1.291485548 * okB) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => delinearize(channel) * 255) as [number, number, number];
}

const inSrgbGamut = (rgb: readonly number[]): boolean =>
  rgb.every((channel) => channel >= -0.25 && channel <= 255.25);

/**
 * OKLCH → `#rrggbb`, reducing chroma until the colour fits sRGB.
 *
 * Clipping the channels instead would shift hue and lightness — a saturated blue
 * clips to a different blue. Binary-searching chroma holds hue and perceived
 * lightness exactly and gives up only the colourfulness the display cannot show.
 */
export function oklchToHex(color: Oklch): string {
  if (inSrgbGamut(oklchToRgbRaw(color))) return rgbToHex(oklchToRgbRaw(color));

  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(oklchToRgbRaw({ ...color, c: mid }))) lo = mid;
    else hi = mid;
  }
  return rgbToHex(oklchToRgbRaw({ ...color, c: lo }));
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [okL, okA, okB] = rgbToOklab(rgb);
  return {
    l: okL,
    c: Math.hypot(okA, okB),
    h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360,
  };
}

/** Blend two colours in OKLab — the hue-stable counterpart to `mix`. */
export function mixOklab(a: string, b: string, amount: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;

  const la = rgbToOklab(ra);
  const lb = rgbToOklab(rb);
  const t = Math.min(1, Math.max(0, amount));
  const blended = la.map((v, i) => v + (lb[i] - v) * t) as [number, number, number];
  return oklchToHex({
    l: blended[0],
    c: Math.hypot(blended[1], blended[2]),
    h: ((Math.atan2(blended[2], blended[1]) * 180) / Math.PI + 360) % 360,
  });
}


const linearize = (channel: number): number =>
  channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG relative luminance (gamma-corrected), 0..1. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => linearize(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Naive luminance for light/dark bucketing (VS Code import). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return la >= lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
}

export function readableOn(hex: string): string {
  return relativeLuminance(hex) > 0.58 ? "#161616" : "#ffffff";
}

export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrastRatio(color, bg) >= min) return color;

  const towards = relativeLuminance(bg) < 0.5 ? "#ffffff" : "#000000";
  let best = color;

  for (let amount = 0.2; amount <= 1.0001; amount += 0.2) {
    best = mix(color, towards, Math.min(amount, 1));
    if (contrastRatio(best, bg) >= min) return best;
  }

  return best;
}

export function isDarkBackground(hex: string): boolean {
  return relativeLuminance(hex) < 0.45;
}

/**
 * Coerce VS Code theme hex tokens into flat 6-digit `#rrggbb`,
 * compositing alpha over `backdrop`.
 */
export function normalizeHex(input: string | undefined | null, backdrop = "#000000"): string | null {
  if (typeof input !== "string") return null;

  let clean = input.trim().replace(/^#/, "");

  if (clean.length === 3 || clean.length === 4) {
    clean = clean
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }

  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(clean)) return null;

  const rgb = hexToRgb(`#${clean.slice(0, 6)}`);
  if (!rgb) return null;

  if (clean.length === 6) return rgbToHex(rgb);

  const alpha = parseInt(clean.slice(6, 8), 16) / 255;
  const base = hexToRgb(backdrop) ?? [0, 0, 0];

  return rgbToHex([
    base[0] + (rgb[0] - base[0]) * alpha,
    base[1] + (rgb[1] - base[1]) * alpha,
    base[2] + (rgb[2] - base[2]) * alpha,
  ]);
}