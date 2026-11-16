import type { ThemeFile } from "./theme-file.ts";

/**
 * The bundled showcase theme(s).
 *
 * R3's ladder asked for one theme that shows the whole ladder at once — a
 * "solar system" the operator can wear without asking an agent to author
 * anything. It is data, exactly like an operator- or companion-authored file:
 * a complete palette, the chrome placements, the material steps and the scene
 * layer (orbit backdrop, halo edge, raised cards). The app copies it into the
 * profile's `themes/` directory once, on the profile's first run, and from then
 * on it is just a theme file the operator owns: wear it, override it, or
 * delete it — a deleted showcase stays deleted (the seed is remembered in
 * `theme-state.json`).
 *
 * It stays in `shared/` so both the main process (seeding) and any test can
 * read the same data; it is never worn implicitly and never part of the vault.
 * It carries both palettes (`colors` and `darkColors`): the studio picks the one
 * the operator's colour mode asks for, so a showcase that only named `colors`
 * would be ignored in dark mode.
 */
export const SHOWCASE_THEMES: readonly ThemeFile[] = [
  {
    name: "showcase-solar-system",
    label: "Solar System",
    description:
      "A dark-orbit sky, a haloed page and raised cards; the rail and the dock ride the edges.",
    colors: {
      background: "#0a0e1f",
      foreground: "#e8ecff",
      card: "#131a33",
      cardForeground: "#dfe6ff",
      muted: "#0f1530",
      mutedForeground: "#b6c0e4",
      popover: "#121933",
      popoverForeground: "#e8ecff",
      primary: "#f2a33c",
      primaryForeground: "#171003",
      secondary: "#24304f",
      secondaryForeground: "#dfe6ff",
      accent: "#7fd4ff",
      accentForeground: "#04121c",
      border: "#2a3654",
      input: "#1a2340",
      ring: "#7fd4ff",
      destructive: "#ff6b6b",
      destructiveForeground: "#2a0808",
    },
    darkColors: {
      background: "#070b17",
      foreground: "#e8ecff",
      card: "#131a33",
      cardForeground: "#dfe6ff",
      muted: "#0f1530",
      mutedForeground: "#b6c0e4",
      popover: "#121933",
      popoverForeground: "#e8ecff",
      primary: "#f2a33c",
      primaryForeground: "#171003",
      secondary: "#24304f",
      secondaryForeground: "#dfe6ff",
      accent: "#7fd4ff",
      accentForeground: "#04121c",
      border: "#2a3654",
      input: "#1a2340",
      ring: "#7fd4ff",
      destructive: "#ff6b6b",
      destructiveForeground: "#2a0808",
    },
    chrome: {
      wingSwitcher: { place: "floating-left", variant: "icons" },
      domainSwitcher: { place: "bottom-center", variant: "pill" },
      navRail: { place: "floating", width: "wide" },
      chatDock: { side: "left" },
      titlebar: { size: "tall" },
    },
    material: {
      radius: "round",
      shadow: "deep",
      typeScale: "airy",
      density: "airy",
      motion: "calm",
      backdrop: "grid",
    },
    scene: {
      background: { preset: "orbit", intensity: "calm" },
      frames: { canvas: "halo", cards: "raised" },
    },
  },
  {
    name: "showcase-helios",
    label: "Helios",
    description:
      "A solar HUD: warm dust, a golden ring of quick actions standing on the page, and a haloed sheet. The whole R4 ladder in one file.",
    colors: {
      background: "#120b06",
      foreground: "#ffeeda",
      card: "#1f1409",
      cardForeground: "#ffeeda",
      muted: "#171008",
      mutedForeground: "#d9b98f",
      popover: "#1b1109",
      popoverForeground: "#ffeeda",
      primary: "#ffb341",
      primaryForeground: "#241201",
      secondary: "#2c1c0d",
      secondaryForeground: "#ffeeda",
      accent: "#ff7d4d",
      accentForeground: "#2a0d02",
      border: "#3d2717",
      input: "#241608",
      ring: "#ffb341",
      destructive: "#ff6b5a",
      destructiveForeground: "#2a0603",
    },
    darkColors: {
      background: "#0b0704",
      foreground: "#ffeeda",
      card: "#1a1008",
      cardForeground: "#ffeeda",
      muted: "#120c06",
      mutedForeground: "#d9b98f",
      popover: "#1b1109",
      popoverForeground: "#ffeeda",
      primary: "#ffb341",
      primaryForeground: "#241201",
      secondary: "#2c1c0d",
      secondaryForeground: "#ffeeda",
      accent: "#ff7d4d",
      accentForeground: "#2a0d02",
      border: "#3d2717",
      input: "#120c06",
      ring: "#ffb341",
      destructive: "#ff6b5a",
      destructiveForeground: "#2a0603",
    },
    chrome: {
      wingSwitcher: { place: "floating-left", variant: "icons" },
      domainSwitcher: { place: "titlebar-center", variant: "pill" },
      navRail: { place: "floating", width: "wide" },
      chatDock: { side: "right" },
      titlebar: { size: "tall" },
    },
    material: {
      radius: "round",
      shadow: "deep",
      typeScale: "airy",
      density: "airy",
      motion: "calm",
      backdrop: "wash",
    },
    scene: {
      background: { preset: "orbit", intensity: "default" },
      frames: { canvas: "halo", cards: "raised" },
    },
    composition: {
      layout: "polar",
      radius: "wide",
      widgets: [
        { type: "quickAction", region: "page.orbit", route: "home", label: "Home", tone: "accent" },
        { type: "quickAction", region: "page.orbit", route: "goals", label: "Goals", tone: "accent" },
        { type: "quickAction", region: "page.orbit", route: "projects", label: "Projects", tone: "warning" },
        { type: "quickAction", region: "page.orbit", route: "notes", label: "Notes", tone: "warning" },
        { type: "badge", region: "page.orbit", data: "decisions.count", label: "Decisions", tone: "muted" },
        { type: "meter", region: "page.orbit", data: "weekly.files", label: "Week", max: 7, tone: "success" },
      ],
    },
  },
];