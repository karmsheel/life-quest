/**
 * Put a harness page in the app's own theme, and prove it.
 *
 * The studio's look is a **skin**: `ThemeProvider` writes the chosen palette's
 * variables onto `<html>`, so a page that only relies on `tokens.css` renders a
 * palette nobody runs. A rig that reviewed a card in that state would be judging
 * colors the operator never sees — which is how a card can pass a design check
 * and still look wrong in the app.
 *
 * `applySkin` is the product function, given the product defaults (Forge OS,
 * dark). It runs at module scope, before the first React render, so nothing is
 * ever painted in the wrong palette.
 *
 * Returns the skin name so a driver can assert the theme actually landed: an
 * unstyled harness must fail the run, not quietly pass a design claim.
 */
import { applySkin } from "@/lib/themes/apply-skin";
import { DEFAULT_SKIN_NAME, BUILTIN_SKINS } from "@/lib/themes/presets";

export function applyAppSkin(mode: "light" | "dark" = "dark"): string {
  const stored = (() => {
    try {
      return localStorage.getItem("lifequest-skin");
    } catch {
      return null;
    }
  })();
  const name = stored && BUILTIN_SKINS[stored] ? stored : DEFAULT_SKIN_NAME;
  const skin = BUILTIN_SKINS[name] ?? BUILTIN_SKINS[DEFAULT_SKIN_NAME]!;
  // `data-theme` is tokens.css's own switch; the skin supplies the palette on
  // top of it, exactly as ThemeProvider does in the app.
  document.documentElement.setAttribute("data-theme", mode);
  applySkin(skin, mode);
  return skin.name;
}
