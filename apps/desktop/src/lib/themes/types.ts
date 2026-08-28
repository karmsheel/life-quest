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
  /** Optional display/heading face (e.g. Sigurd for Nous). Maps to --font-display. */
  fontDisplay?: string;
  fontUrl?: string;
}

export interface ForgeSkin {
  name: string;
  label: string;
  description: string;
  colors: SkinColors;
  darkColors?: SkinColors;
  typography?: Partial<SkinTypography>;
}

/** CSS custom properties written by applySkin onto <html>. */
export type ForgeSkinVars = Record<string, string>;