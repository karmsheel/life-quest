/**
 * The renderer's half of the theme model: the shared vocabulary, plus the one
 * piece that needs the DOM — writing a theme's material layer onto `<html>`.
 *
 * Everything a scheme can be *proved* against lives in `apps/desktop/shared/`
 * so main's theme tools, the renderer and the rigs all agree on the same rules.
 */
export * from "../../../shared/theme-file.ts";
import type {
  ThemeChrome,
  ThemeMaterial,
} from "../../../shared/theme-file.ts";

const RADIUS_SCALES: Record<ThemeMaterial["radius"], string[]> = {
  sharp: ["2px", "4px", "4px", "6px", "8px"],
  soft: ["6px", "12px", "12px", "18px", "24px"],
  round: ["12px", "16px", "16px", "22px", "28px"],
};

/**
 * The type scale is the whole rem ladder, so it is set once on the document
 * root and every `rem` in every stylesheet follows. Pixels stay pixels: the
 * window strip and other fixed chrome keep their exact size, which is what
 * makes a scale feel like type instead of a zoom.
 */
const TYPE_SCALES: Record<ThemeMaterial["typeScale"], string> = {
  compact: "15px",
  default: "16px",
  airy: "17px",
};

/** The strip's three declared heights, in the token's own unit. */
const TITLEBAR_SIZES: Record<ThemeChrome["titlebar"]["size"], string> = {
  compact: "26px",
  default: "32px",
  tall: "40px",
};

/** The sidebar's three declared widths, in the token's own unit. */
const NAV_RAIL_WIDTHS: Record<ThemeChrome["navRail"]["width"], string> = {
  narrow: "13.5rem",
  default: "16rem",
  wide: "19rem",
};

/**
 * Write the chrome layout onto the document: one variable and one state
 * attribute, because the pane arrangements are already grid rules the shell
 * owns. The React side reads the same resolved chrome for the hosts it paints.
 */
export function applyChrome(chrome: ThemeChrome, root: HTMLElement): void {
  root.style.setProperty(
    "--shell-sidebar-width",
    NAV_RAIL_WIDTHS[chrome.navRail.width],
  );
  root.dataset.chromeNavWidth = chrome.navRail.width;
  root.dataset.chromeNavPlace = chrome.navRail.place;
  root.style.setProperty("--window-titlebar-height", TITLEBAR_SIZES[chrome.titlebar.size]);
  root.dataset.chromeTitlebarSize = chrome.titlebar.size;
}

/**
 * Write the material layer onto the document, exactly where `applySkin` writes
 * the palette.
 *
 * Radius and type size are written inline because no skin owns them; the
 * shadow family, density, motion and backdrop are state attributes the
 * stylesheet reads, so a theme picks a named step and the stylesheet owns what
 * each step means. A theme therefore cannot ship arbitrary CSS.
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
  root.style.fontSize = TYPE_SCALES[material.typeScale];
  root.dataset.materialDensity = material.density;
  root.dataset.materialMotion = material.motion;
  root.dataset.materialShadow = material.shadow;
  root.dataset.materialBackdrop = material.backdrop;
  root.dataset.materialTypeScale = material.typeScale;
}
