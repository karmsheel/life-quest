/**
 * Drives the titlebar's day/night control and its quick menu in a real Electron
 * window and turns the measurements into
 * `e2e/artifacts/theme-quick-menu.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/theme-quick-menu.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: the same pointer gestures, the same numbers, no eyeballing the app
 * required. It carries the two gestures the control has to answer:
 *
 *   - a click on the icon switches the palette without a menu in the way, and
 *   - a rest on the icon opens the quick menu, whose mode switcher sits above
 *     the starred themes.
 *
 * It also proves the menu is a real menu: the pointer can travel into it, a
 * press outside dismisses it, Escape closes it, a curated favourites list narrows
 * the grid, and a one-palette theme removes the control rather than leaving an
 * inert one.
 *
 * NOT covered here: the platform's own light/dark preference changing under the
 * app. The rig pins `nativeTheme.themeSource` to dark, so "System" is measured
 * as the dark palette; a live OS change is the ThemeProvider's media query, not
 * this control's contract.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/theme-quick-menu.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

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

const SAMPLE = `(() => {
  const round = (n) => Math.round(n);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height)
    };
  };
  const text = (el) => ((el && el.textContent) || "").trim();
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const iconClass = (el) => {
    const svg = el ? el.querySelector("svg") : null;
    if (!svg) return null;
    return Array.from(svg.classList).find((name) => name.startsWith("lucide-")) ?? null;
  };

  const root = document.documentElement;
  const trigger = document.querySelector(".theme-mode-toggle");
  const trailing = document.querySelector(".window-titlebar__trailing");
  const popover = document.querySelector(".theme-quick-menu__popover");
  const triggerBox = box(trigger);
  const menuBox = box(popover);
  const modeSwitcher = popover ? popover.querySelector(".ui-segmented") : null;
  const skinGrid = popover ? popover.querySelector(".settings-menu__skin-grid") : null;
  const empty = popover ? popover.querySelector(".settings-menu__quick-empty") : null;

  const mode = popover
    ? Array.from(popover.querySelectorAll(".ui-segmented__option")).map((el) => ({
        label: text(el),
        active: attr(el, "aria-checked") === "true"
      }))
    : null;

  const tiles = popover
    ? Array.from(popover.querySelectorAll(".skin-tile")).map((tile) => {
        const radio = tile.querySelector(".settings-menu__skin-option");
        return {
          name: attr(tile, "data-skin"),
          label: text(tile.querySelector(".settings-menu__skin-label")),
          active: radio ? attr(radio, "aria-checked") === "true" : null
        };
      })
    : null;

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: {
      attr: attr(root, "data-theme"),
      stored: localStorage.getItem("lifequest-theme"),
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches
    },
    skin: {
      attr: attr(root, "data-skin"),
      stored: localStorage.getItem("lifequest-skin")
    },
    favorites: localStorage.getItem("lifequest-skin-favorites"),
    focused: document.activeElement
      ? document.activeElement.className || document.activeElement.tagName
      : null,
    trigger: trigger
      ? {
          present: true,
          label: attr(trigger, "aria-label"),
          title: attr(trigger, "title"),
          expanded: attr(trigger, "aria-expanded"),
          hasPopup: attr(trigger, "aria-haspopup"),
          icon: iconClass(trigger),
          box: triggerBox,
          inTrailing: Boolean(trailing && trailing.contains(trigger))
        }
      : { present: false },
    titlebar: trailing
      ? {
          classes: Array.from(trailing.children).map((el) =>
            typeof el.className === "string" ? el.className : ""
          ),
          shortcutsInStrip: Boolean(document.querySelector(".window-titlebar__shortcuts")),
          themeInTrailing: Boolean(trailing.querySelector(".theme-mode-toggle"))
        }
      : null,
    menu: popover
      ? {
          box: menuBox,
          role: attr(popover, "role"),
          ariaLabel: attr(popover, "aria-label"),
          aboveControl: Boolean(triggerBox && menuBox && menuBox.top >= triggerBox.bottom),
          withinViewport: Boolean(
            menuBox &&
              menuBox.left >= 0 &&
              menuBox.top >= 0 &&
              menuBox.right <= window.innerWidth &&
              menuBox.bottom <= window.innerHeight
          ),
          sectionTitles: Array.from(
            popover.querySelectorAll(".settings-menu__section-title")
          ).map(text),
          mode,
          hint: text(popover.querySelector(".settings-menu__skin-hint")),
          tiles,
          gridPresent: Boolean(skinGrid),
          gridBox: box(skinGrid),
          modeBox: box(modeSwitcher),
          switcherAboveTiles: Boolean(
            box(modeSwitcher) &&
              box(skinGrid) &&
              box(modeSwitcher).bottom <= box(skinGrid).top
          ),
          empty: empty ? text(empty) : null,
          appearanceLink: Boolean(
            popover.querySelector(".settings-menu__quick-empty-link")
          )
        }
      : null,
    outside: box(document.querySelector("[data-rig-outside]"))
  };
})()`;

const states = {};
const steps = {};
const screenshots = [];
const failures = [];
let step = "boot";

const at = (name) => {
  step = name;
  steps[name] = true;
};

const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // A rig runs on a real desktop: paint it in the theme the app itself defaults
  // to, so a run is not a white sheet flashing across the screen. It also pins
  // "System" to the dark palette, which is the mode the system hint is measured
  // against.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = () =>
    run(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
    );

  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.themeQuickMenuReady !== "object") return null;
          await window.themeQuickMenuReady;
          return typeof window.themeQuickMenuVaultName === "string"
            ? window.themeQuickMenuVaultName
            : null;
        })()`);
        if (typeof ready === "string") return ready;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await sleep(250);
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(250);
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 200) => {
    await sleep(ms);
    await frames();
    return sample();
  };

  const waitFor = async (expression, description, timeoutMs = 6_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await run(expression);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(60);
    }
    throw new Error(
      `[${step}] timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`,
    );
  };

  const record = async (name, readyExpression) => {
    if (readyExpression) await waitFor(readyExpression, `${name} to settle`);
    const state = await settle();
    states[name] = state;
    return state;
  };

  const shot = async (name) => {
    await frames();
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    if (!screenshots.includes(name)) screenshots.push(name);
    return name;
  };

  const click = async (selector) => {
    const clicked = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`[${step}] no element for ${selector}`);
    await frames();
  };

  const clickText = async (containerSelector, label) => {
    const clicked = await run(`(() => {
      const container = document.querySelector(${JSON.stringify(containerSelector)});
      if (!container) return false;
      const el = Array.from(container.querySelectorAll("button")).find(
        (button) => ((button.textContent || "").trim() === ${JSON.stringify(label)})
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`[${step}] no "${label}" button inside ${containerSelector}`);
    await frames();
  };

  /** Real pointer motion, so the control's own pointer handlers fire. */
  const pointerTo = async (x, y) => {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(x),
      y: Math.round(y),
    });
  };

  const hover = async (selector) => {
    const point = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`[${step}] no element for ${selector}`);
    await pointerTo(point.x, point.y);
  };

  const parkPointer = () => pointerTo(2, 2);

  /** A real press outside the menu, not a scripted click: dismissal listens on
   *  `mousedown`, which `el.click()` would skip. */
  const pressAt = async (x, y) => {
    await pointerTo(x, y);
    win.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
    await frames();
  };

  const pressKey = async (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    await sleep(30);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(120);
    await frames();
  };

  const seedAndReload = async ({ theme, skin, favorites }) => {
    await run(`(() => {
      localStorage.clear();
      ${theme ? `localStorage.setItem("lifequest-theme", ${JSON.stringify(theme)});` : ""}
      ${skin ? `localStorage.setItem("lifequest-skin", ${JSON.stringify(skin)});` : ""}
      ${
        favorites === null
          ? ""
          : `localStorage.setItem("lifequest-skin-favorites", ${JSON.stringify(JSON.stringify(favorites))});`
      }
      return true;
    })()`);
    win.webContents.reload();
    await waitForHarness();
    await sleep(250);
    await frames();
  };

  const menuOpen = 'Boolean(document.querySelector(".theme-quick-menu__popover"))';

  let report;
  const timeout = setTimeout(() => {
    console.error("theme-quick-menu: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();

    // A clean install: no preference, no skin, no curation.
    await seedAndReload({ theme: "dark", skin: "forge-os", favorites: null });

    // —— 1 — the resting control: day/night on the titlebar, no menu, and the
    //        keyboard-shortcuts control no longer riding the strip.
    at("resting control");
    const landing = await record("landing");
    check(
      "the titlebar carries the day/night control",
      landing.trigger.present === true &&
        landing.trigger.label === "Switch to day mode" &&
        landing.trigger.title === "Switch to day mode" &&
        landing.trigger.icon === "lucide-sun" &&
        landing.trigger.expanded === "false" &&
        landing.trigger.inTrailing === true,
      `trigger ${JSON.stringify(landing.trigger)}`,
    );
    check(
      "the shipped palette is dark and the quick menu is closed",
      landing.theme.attr === "dark" &&
        landing.theme.stored === "dark" &&
        landing.menu === null,
      `theme ${JSON.stringify(landing.theme)}, menu ${JSON.stringify(landing.menu)}`,
    );
    check(
      "the titlebar's trailing cluster is the theme control and settings",
      same(landing.titlebar.classes, ["theme-mode-toggle window-titlebar__btn", "settings-menu window-titlebar__settings"]) ||
        (landing.titlebar.classes.length === 2 &&
          landing.titlebar.classes[0].includes("theme-mode-toggle") &&
          landing.titlebar.classes[1].includes("settings-menu")),
      `trailing ${JSON.stringify(landing.titlebar)}`,
    );
    check(
      "the keyboard-shortcuts control left the titlebar",
      landing.titlebar.shortcutsInStrip === false,
      `titlebar ${JSON.stringify(landing.titlebar)}`,
    );

    // —— 2 — the pointer rests on the control and the quick menu opens under
    //        it: mode switcher first, starred themes underneath.
    at("hover opens the quick menu");
    await hover(".theme-mode-toggle");
    const nightMenu = await record("nightMenu", menuOpen);
    await shot("theme-quick-menu-night.png");
    check(
      "hovering the control opens its menu",
      nightMenu.menu !== null && nightMenu.trigger.expanded === "true",
      `menu ${JSON.stringify(nightMenu.menu)}, expanded ${nightMenu.trigger.expanded}`,
    );
    check(
      "the menu is anchored below the control and inside the window",
      nightMenu.menu.aboveControl === true &&
        nightMenu.menu.withinViewport === true &&
        nightMenu.menu.role === "menu" &&
        nightMenu.menu.ariaLabel === "Theme",
      `box ${JSON.stringify(nightMenu.menu.box)} vs control ${JSON.stringify(nightMenu.trigger.box)}`,
    );
    check(
      "the mode switcher leads and the starred themes follow",
      same(
        (nightMenu.menu.sectionTitles ?? []).map((title) => title.toLowerCase()),
        ["theme", "starred themes"],
      ) &&
        nightMenu.menu.switcherAboveTiles === true &&
        same(
          nightMenu.menu.mode.map((option) => option.label),
          ["System", "Light", "Dark"],
        ) &&
        nightMenu.menu.mode.filter((option) => option.active).map((option) => option.label).join(",") ===
          "Dark",
      `titles ${JSON.stringify(nightMenu.menu.sectionTitles)}, mode ${JSON.stringify(nightMenu.menu.mode)}`,
    );
    check(
      "the hint names the palette in front",
      nightMenu.menu.hint === "Night palette · LifeQuest themes",
      `hint ${JSON.stringify(nightMenu.menu.hint)}`,
    );
    check(
      "an uncurated install stars every theme, and the grid is in registry order",
      same(
        nightMenu.menu.tiles.map((tile) => tile.label),
        ALL_THEMES,
      ) &&
        nightMenu.menu.gridPresent === true &&
        nightMenu.menu.tiles.filter((tile) => tile.active).map((tile) => tile.name).join(",") ===
          "forge-os",
      `tiles ${JSON.stringify(nightMenu.menu.tiles)}`,
    );

    // —— 3 — a click on the icon is still a switch: it flips the palette now,
    //        and leaves the menu where the pointer put it.
    at("click toggles the palette");
    await click(".theme-mode-toggle");
    const dayToggle = await record("dayToggle", 'document.documentElement.getAttribute("data-theme") === "light"');
    await shot("theme-quick-menu-day.png");
    check(
      "a click switches from night to day",
      dayToggle.theme.attr === "light" &&
        dayToggle.theme.stored === "light" &&
        dayToggle.trigger.label === "Switch to night mode" &&
        dayToggle.trigger.icon === "lucide-moon",
      `theme ${JSON.stringify(dayToggle.theme)}, trigger ${JSON.stringify(dayToggle.trigger)}`,
    );
    check(
      "the menu stays open across the switch",
      dayToggle.menu !== null && dayToggle.trigger.expanded === "true",
      `menu ${dayToggle.menu !== null}, expanded ${dayToggle.trigger.expanded}`,
    );
    check(
      "the day palette narrows the quick grid to the dual-palette themes",
      same(
        dayToggle.menu.tiles.map((tile) => tile.label),
        DUAL_PALETTE_THEMES,
      ) && dayToggle.menu.hint === "Day palette · LifeQuest themes",
      `tiles ${JSON.stringify(dayToggle.menu.tiles)}, hint ${JSON.stringify(dayToggle.menu.hint)}`,
    );

    // —— 4 — the menu's mode switcher writes the preference the click left
    //        behind: System clears the attribute, Dark pins it back.
    at("the mode switcher");
    await clickText(".theme-quick-menu__popover .ui-segmented", "System");
    const systemMode = await record("systemMode", 'document.documentElement.getAttribute("data-theme") === null');
    check(
      "choosing System hands the palette to the platform",
      systemMode.theme.attr === null &&
        systemMode.theme.stored === "system" &&
        systemMode.menu.mode.filter((option) => option.active).map((option) => option.label).join(",") ===
          "System",
      `theme ${JSON.stringify(systemMode.theme)}, mode ${JSON.stringify(systemMode.menu.mode)}`,
    );
    check(
      "the system hint says the platform is deciding",
      systemMode.menu.hint ===
        "Follows system appearance · day & night palettes",
      `hint ${JSON.stringify(systemMode.menu.hint)}`,
    );
    await clickText(".theme-quick-menu__popover .ui-segmented", "Dark");
    const darkMode = await record("darkMode", 'document.documentElement.getAttribute("data-theme") === "dark"');
    check(
      "choosing Dark pins the night palette",
      darkMode.theme.attr === "dark" &&
        darkMode.theme.stored === "dark" &&
        darkMode.menu.mode.filter((option) => option.active).map((option) => option.label).join(",") ===
          "Dark",
      `theme ${JSON.stringify(darkMode.theme)}, mode ${JSON.stringify(darkMode.menu.mode)}`,
    );

    // —— 5 — a starred tile is a quick choice, not a preview: it applies the
    //        theme and persists it.
    at("quick-select a starred theme");
    await click('[data-skin="nous-classic"] .settings-menu__skin-option');
    const skinPicked = await record("skinPicked", 'document.documentElement.getAttribute("data-skin") === "nous-classic"');
    check(
      "a tile press applies and stores the theme",
      skinPicked.skin.attr === "nous-classic" &&
        skinPicked.skin.stored === "nous-classic" &&
        skinPicked.menu.tiles.filter((tile) => tile.active).map((tile) => tile.name).join(",") ===
          "nous-classic",
      `skin ${JSON.stringify(skinPicked.skin)}, tiles ${JSON.stringify(skinPicked.menu.tiles)}`,
    );

    // —— 6 — the pointer can leave the control and enter the menu: the gap
    //        between the two is bridged by the close delay.
    at("the pointer travels into the menu");
    await hover(".theme-quick-menu__popover");
    await sleep(400);
    const bridged = await record("hoverBridged", menuOpen);
    check(
      "the menu survives the pointer moving into it",
      bridged.menu !== null,
      `menu ${JSON.stringify(bridged.menu && bridged.menu.box)}`,
    );

    // —— 7 — leaving both parts closes it.
    at("leaving closes the menu");
    await parkPointer();
    await waitFor(
      'document.querySelector(".theme-quick-menu__popover") === null',
      "the menu to close after the pointer left",
    );
    const leftClosed = await record("leftClosed");
    check(
      "the menu closes when the pointer leaves control and menu",
      leftClosed.menu === null && leftClosed.trigger.expanded === "false",
      `menu ${leftClosed.menu !== null}, expanded ${leftClosed.trigger.expanded}`,
    );

    // —— 8 — a real press outside dismisses it and the page keeps the press.
    at("a press outside closes the menu");
    await hover(".theme-mode-toggle");
    await record("reopenedForOutside", menuOpen);
    const outsidePoint = leftClosed.outside;
    await pressAt(
      outsidePoint.left + outsidePoint.width / 2,
      outsidePoint.top + outsidePoint.height / 2,
    );
    await waitFor(
      'document.querySelector(".theme-quick-menu__popover") === null',
      "the menu to close on an outside press",
    );
    const outsideClosed = await record("outsideClosed");
    check(
      "a press outside the menu dismisses it",
      outsideClosed.menu === null,
      `menu ${outsideClosed.menu !== null}`,
    );

    // —— 9 — Escape closes it too, and hands the focus back to the control.
    at("Escape closes the menu");
    await hover(".theme-mode-toggle");
    await record("reopenedForEscape", menuOpen);
    await pressKey("Escape");
    await waitFor(
      'document.querySelector(".theme-quick-menu__popover") === null',
      "the menu to close on Escape",
    );
    const escaped = await record("escapeClosed");
    check(
      "Escape closes the menu and focuses its control",
      escaped.menu === null &&
        String(escaped.focused).includes("theme-mode-toggle"),
      `menu ${escaped.menu !== null}, focused ${JSON.stringify(escaped.focused)}`,
    );

    // —— 10 — the star is the list: a curated favourites set narrows the grid
    //         to exactly those names.
    at("a curated list narrows the quick grid");
    await seedAndReload({
      theme: "dark",
      skin: "nous",
      favorites: ["nous"],
    });
    await hover(".theme-mode-toggle");
    const favoritesSubset = await record("favoritesSubset", menuOpen);
    await shot("theme-quick-menu-favorites.png");
    check(
      "the quick grid lists exactly the starred themes",
      same(
        favoritesSubset.menu.tiles.map((tile) => tile.label),
        ["Nous"],
      ) &&
        favoritesSubset.menu.tiles[0].active === true &&
        same(favoritesSubset.favorites, JSON.stringify(["nous"])),
      `tiles ${JSON.stringify(favoritesSubset.menu.tiles)}, favorites ${favoritesSubset.favorites}`,
    );

    // —— 11 — an empty curation says what to do about it rather than showing a
    //         hole where the grid was.
    at("an empty curation shows the empty state");
    await seedAndReload({
      theme: "dark",
      skin: "forge-os",
      favorites: [],
    });
    await hover(".theme-mode-toggle");
    const favoritesEmpty = await record("favoritesEmpty", menuOpen);
    check(
      "an empty favourites list shows the empty state and the way to Appearance",
      favoritesEmpty.menu.tiles.length === 0 &&
        favoritesEmpty.menu.gridPresent === false &&
        String(favoritesEmpty.menu.empty).includes("No starred themes") &&
        favoritesEmpty.menu.appearanceLink === true &&
        same(favoritesEmpty.favorites, "[]"),
      `menu ${JSON.stringify(favoritesEmpty.menu)}`,
    );

    // —— 12 — a theme with only one palette has nothing to switch, so the
    //         control is absent, exactly as the old toggle was.
    at("a one-palette theme has no switch");
    await seedAndReload({
      theme: "dark",
      skin: "midnight",
      favorites: null,
    });
    const singleMode = await record("singleModeSkin");
    check(
      "a one-palette theme removes the day/night control",
      singleMode.trigger.present === false && singleMode.menu === null,
      `trigger ${JSON.stringify(singleMode.trigger)}`,
    );
    check(
      "the titlebar keeps the settings menu beside the absent control",
      singleMode.titlebar.classes.length === 1 &&
        singleMode.titlebar.classes[0].includes("settings-menu"),
      `trailing ${JSON.stringify(singleMode.titlebar.classes)}`,
    );

    report = {
      pass: failures.length === 0,
      failures,
      vaultName,
      steps,
      states,
      screenshots,
      expected: { allThemes: ALL_THEMES, dualPaletteThemes: DUAL_PALETTE_THEMES },
    };
  } catch (error) {
    report = {
      pass: false,
      failures: [...failures, `rig crashed: ${error instanceof Error ? error.stack : String(error)}`],
      vaultName: null,
      steps,
      states,
      screenshots,
    };
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "theme-quick-menu.json"),
      JSON.stringify(report, null, 2),
    );
    if (report.failures.length > 0) {
      console.error(`theme-quick-menu: ${report.failures.length} failure(s)`);
      for (const failure of report.failures) console.error(`  - ${failure}`);
    }
    try {
      win.destroy();
    } catch {
      /* already gone */
    }
    app.exit(report.pass ? 0 : 1);
  }
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(
      `theme-quick-menu: ${error instanceof Error ? error.stack : error}`,
    );
    app.exit(1);
  });
