/**
 * The renderer's half of the theme model: the shared vocabulary, plus the one
 * piece that needs the DOM — writing a theme's material layer onto `<html>`.
 *
 * Everything a scheme can be *proved* against lives in `apps/desktop/shared/`
 * so main's theme tools, the renderer and the rigs all agree on the same rules.
 */
export * from "../../../shared/theme-file.ts";
import type { ThemeMaterial } from "../../../shared/theme-file.ts";

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
