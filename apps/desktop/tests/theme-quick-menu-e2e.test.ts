import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(
  desktopRoot,
  "e2e/artifacts/theme-quick-menu.json",
);

/** The themes the app ships, in registry order; the two with both palettes. */
const ALL_THEMES = [
  "Forge OS",
  "Nous",
  "Nous Classic",
  "Midnight",
  "Ember",
  "Mono",
  "Cyberpunk",
];
const DUAL_PALETTE_THEMES = ["Forge OS", "Nous", "Nous Classic"];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ThemeOption = { label: string; active: boolean };
type ThemeTile = { name: string; label: string; active: boolean | null };

type Sample = {
  viewport: { width: number; height: number };
  theme: { attr: string | null; stored: string | null; prefersDark: boolean };
  skin: { attr: string | null; stored: string | null };
  favorites: string | null;
  focused: string | null;
  trigger: {
    present: boolean;
    label?: string | null;
    title?: string | null;
    expanded?: string | null;
    hasPopup?: string | null;
    icon?: string | null;
    box?: Box;
    inTrailing?: boolean;
  };
  titlebar: {
    classes: string[];
    shortcutsInStrip: boolean;
    themeInTrailing: boolean;
  } | null;
  menu: {
    box: Box;
    role: string | null;
    ariaLabel: string | null;
    aboveControl: boolean;
    withinViewport: boolean;
    sectionTitles: string[];
    mode: ThemeOption[];
    hint: string;
    tiles: ThemeTile[];
    gridPresent: boolean;
    gridBox: Box | null;
    modeBox: Box | null;
    switcherAboveTiles: boolean;
    empty: string | null;
    appearanceLink: boolean;
  } | null;
  outside: Box;
};

const activeModes = (menu: Sample["menu"]): string =>
  (menu?.mode ?? [])
    .filter((option) => option.active)
    .map((option) => option.label)
    .join(",");
const activeTiles = (menu: Sample["menu"]): string =>
  (menu?.tiles ?? [])
    .filter((tile) => tile.active)
    .map((tile) => tile.name)
    .join(",");
const tileLabels = (menu: Sample["menu"]): string[] =>
  (menu?.tiles ?? []).map((tile) => tile.label);

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string | null;
  steps: Record<string, unknown>;
  states: Record<string, Sample>;
  screenshots: string[];
  expected: { allThemes: string[]; dualPaletteThemes: string[] };
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/theme-quick-menu.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

describe("titlebar theme quick menu", () => {
  it("switches the palette on click and opens the starred-theme menu on hover", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);
    assert.deepEqual(report.expected.allThemes, ALL_THEMES);

    const state = (name: string): Sample => {
      const found = report.states[name];
      assert.ok(found, `the report carries no "${name}" state`);
      return found;
    };

    // —— 1. The resting control: a day/night switch on the titlebar, no menu,
    //       and no keyboard-shortcuts copy in the strip.
    const landing = state("landing");
    assert.equal(landing.trigger.present, true, "the titlebar has no day/night control");
    assert.equal(landing.trigger.label, "Switch to day mode");
    assert.equal(landing.trigger.title, "Switch to day mode");
    assert.equal(landing.trigger.icon, "lucide-sun");
    assert.equal(landing.trigger.expanded, "false");
    assert.equal(landing.trigger.hasPopup, "menu");
    assert.equal(landing.trigger.inTrailing, true, "the control left the titlebar's trailing cluster");
    assert.equal(landing.theme.attr, "dark", "the shipped palette is not night");
    assert.equal(landing.menu, null, "the menu is open before the pointer arrives");
    assert.equal(landing.titlebar?.shortcutsInStrip, false, "a shortcuts control is still in the strip");
    assert.deepEqual(
      landing.titlebar?.classes.map((className) =>
        className.includes("theme-mode-toggle")
          ? "theme"
          : className.includes("settings-menu")
            ? "settings"
            : className,
      ),
      ["theme", "settings"],
      "the titlebar's trailing cluster is not theme + settings",
    );

    // —— 2. Hover opens the menu: the mode switcher leads, the starred themes
    //       follow underneath it.
    const nightMenu = state("nightMenu");
    const night = nightMenu.menu;
    assert.ok(night, "hovering the day/night control opened no menu");
    assert.equal(nightMenu.trigger.expanded, "true", "the control does not report its menu open");
    assert.equal(night.role, "menu");
    assert.equal(night.ariaLabel, "Theme");
    assert.equal(night.aboveControl, true, "the menu is not drawn under its control");
    assert.equal(night.withinViewport, true, "the menu spilled out of the window");
    assert.deepEqual(
      night.sectionTitles.map((title) => title.toLowerCase()),
      ["theme", "starred themes"],
      `menu headings ${JSON.stringify(night.sectionTitles)}`,
    );
    assert.deepEqual(
      night.mode.map((option) => option.label),
      ["System", "Light", "Dark"],
      "the mode switcher is not System / Light / Dark",
    );
    assert.equal(activeModes(night), "Dark", "the night palette is not the selected mode");
    assert.equal(night.switcherAboveTiles, true, "the starred grid leads instead of the switcher");
    assert.equal(night.hint, "Night palette · LifeQuest themes");
    assert.deepEqual(tileLabels(night), ALL_THEMES, "an uncurated install does not star every theme");
    assert.equal(night.gridPresent, true, "the starred grid is missing");
    assert.equal(activeTiles(night), "forge-os", "the worn theme's tile is not marked active");

    // —— 3. A click is a switch, not a menu request: it flips the palette and
    //       leaves the open menu alone.
    const dayToggle = state("dayToggle");
    assert.equal(dayToggle.theme.attr, "light", "a click did not switch night to day");
    assert.equal(dayToggle.theme.stored, "light", "the day choice was not persisted");
    assert.equal(dayToggle.trigger.label, "Switch to night mode");
    assert.equal(dayToggle.trigger.icon, "lucide-moon");
    assert.ok(dayToggle.menu, "the click closed the menu instead of switching the palette");
    assert.deepEqual(
      tileLabels(dayToggle.menu),
      DUAL_PALETTE_THEMES,
      "the day palette offered themes that cannot wear it",
    );
    assert.equal(dayToggle.menu?.hint, "Day palette · LifeQuest themes");

    // —— 4. The mode switcher writes the explicit preference: System clears the
    //       attribute, Dark pins the night palette again.
    const systemMode = state("systemMode");
    assert.equal(systemMode.theme.attr, null, "System did not hand the palette to the platform");
    assert.equal(systemMode.theme.stored, "system", "System was not persisted");
    assert.equal(activeModes(systemMode.menu), "System");
    assert.equal(
      systemMode.menu?.hint,
      "Follows system appearance · day & night palettes",
      `system hint ${JSON.stringify(systemMode.menu?.hint)}`,
    );

    const darkMode = state("darkMode");
    assert.equal(darkMode.theme.attr, "dark", "Dark did not pin the night palette");
    assert.equal(darkMode.theme.stored, "dark");
    assert.equal(activeModes(darkMode.menu), "Dark");

    // —— 5. A tile is a quick choice: it applies the theme, persists it, and
    //       reports itself active.
    const skinPicked = state("skinPicked");
    assert.equal(skinPicked.skin.attr, "nous-classic", "the tile did not apply its theme");
    assert.equal(skinPicked.skin.stored, "nous-classic", "the chosen theme was not persisted");
    assert.equal(activeTiles(skinPicked.menu), "nous-classic");

    // —— 6. The menu is a real menu: the pointer can travel into it, and
    //       leaving both parts closes it.
    const bridged = state("hoverBridged");
    assert.ok(bridged.menu, "the menu closed while the pointer moved into it");

    const leftClosed = state("leftClosed");
    assert.equal(leftClosed.menu, null, "the menu survived the pointer leaving it");
    assert.equal(leftClosed.trigger.expanded, "false", "the control still reports an open menu");

    // —— 7. A press outside dismisses it, and Escape closes it and focuses the
    //       control.
    const outsideClosed = state("outsideClosed");
    assert.equal(outsideClosed.menu, null, "a press outside did not dismiss the menu");

    const escaped = state("escapeClosed");
    assert.equal(escaped.menu, null, "Escape did not close the menu");
    assert.match(
      String(escaped.focused),
      /theme-mode-toggle/,
      `Escape did not hand the focus back to the control (${JSON.stringify(escaped.focused)})`,
    );

    // —— 8. The starred list is the quick list: a curated set narrows the grid,
    //       and an empty set shows the empty state with its way to Appearance.
    const favoritesSubset = state("favoritesSubset");
    assert.deepEqual(
      tileLabels(favoritesSubset.menu),
      ["Nous"],
      "the quick grid is not exactly the starred themes",
    );
    assert.equal(activeTiles(favoritesSubset.menu), "nous");
    assert.equal(favoritesSubset.favorites, JSON.stringify(["nous"]));

    const favoritesEmpty = state("favoritesEmpty");
    assert.deepEqual(tileLabels(favoritesEmpty.menu), []);
    assert.equal(favoritesEmpty.menu?.gridPresent, false, "the empty curation still drew a grid");
    assert.match(String(favoritesEmpty.menu?.empty), /No starred themes/);
    assert.equal(favoritesEmpty.menu?.appearanceLink, true, "the empty state has no way to Appearance");

    // —— 9. A one-palette theme has nothing to switch: the control is absent.
    const singleMode = state("singleModeSkin");
    assert.equal(singleMode.trigger.present, false, "a one-palette theme still offers a day/night switch");
    assert.equal(singleMode.menu, null);
    assert.equal(singleMode.titlebar?.classes.length, 1, "the titlebar kept a control for the absent toggle");
    assert.match(singleMode.titlebar?.classes[0] ?? "", /settings-menu/);

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(path.join(desktopRoot, "e2e/artifacts", file)), true, `driver wrote no screenshot ${file}`);
    }
  });
});
