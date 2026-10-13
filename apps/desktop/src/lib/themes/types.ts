/**
 * Forge skin model — aligned with Hermes Desktop `DesktopTheme` so presets
 * and user-installed themes can be shared between products.
 */

export interface SkinColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  ring: string;
  midground?: string;
  midgroundForeground?: string;
  composerRing?: string;
  destructive: string;
  destructiveForeground: string;
  sidebarBackground?: string;
  sidebarBorder?: string;
  userBubble?: string;
  userBubbleBorder?: string;
  /** Text on userBubble / home composer surfaces (defaults to white). */
  composerForeground?: string;
  /** Placeholder text in the home composer (defaults to a faint mix of composer foreground). */
  composerPlaceholder?: string;
  /** Semantic success (maps to --green tokens when set). */
  success?: string;
  /** Semantic info (maps to --blue tokens when set). */
  info?: string;
}

export interface SkinTypography {
  fontSans: string;
  fontMono: string;
  /** Optional display/heading face. Maps to --font-display. */
  fontDisplay?: string;
  fontUrl?: string;
}

export interface ForgeSkin {
  name: string;
  label: string;
  description: string;
  colors: SkinColors;
  darkColors?: SkinColors;
  /**
   * Which way this skin's night ladder runs. Omitted means the standard one.
   *
   * Every first-party LifeQuest skin steps **up**: the page canvas is the
   * deepest surface and the cards and panels rise off it. A faithful copy of an
   * upstream theme can inherit the opposite from its source — GitHub Dark
   * Default, which `nous` forks, paints its cards (`#010409`) *below* its page
   * (`#0d1117`) — and bending the palette to fit would stop it being a copy.
   *
   * Declaring `"inverted"` keeps the palette faithful and tells the shell rig to
   * assert the inverted direction rather than skip the claim, so a palette that
   * drifts either way still fails.
   */
  darkLadder?: "inverted";
  typography?: Partial<SkinTypography>;
}

/** CSS custom properties written by applySkin onto <html>. */
export type ForgeSkinVars = Record<string, string>;