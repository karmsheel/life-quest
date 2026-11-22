/**
 * Drives the real shell and the real splash in real Electron windows and turns
 * the brand's shipping surfaces into `e2e/artifacts/brand-logo.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/brand-logo.electron.mjs
 *
 * What is measured, and why these surfaces:
 *
 *  1. The rail's lockup. It is the operator's pick of four supplied SVGs
 *     (`src/assets/brand/logo/`), drawn inline so its three groups — LIFE, the
 *     Q emblem, UEST — are painted from the theme tokens `--life-color`,
 *     `--icon-color` and `--uest-color`. The rig reads the computed fills, the
 *     tokens they came from, the artwork's own viewBox/aspect, the band's
 *     placement under the window strip, and the default: Modern, no preference
 *     stored.
 *  2. The theme follows. Day, night and a second skin are measured: the fills
 *     always equal the tokens, the forge night palette draws the supplied brand
 *     trio, a day palette derives dark inks, and another skin moves the inks
 *     again. A theme that stops writing these tokens fails here.
 *  3. The Developer pick. The real settings sheet is opened from the titlebar's
 *     gear, the Developer page's logo radio group is clicked through, and the
 *     rail behind the sheet is read: it changes to Classic on the press, the
 *     pick is stored, it survives a reload, and Classic is the variant the next
 *     splash shows.
 *  4. The splash. The boot page is loaded in its own window with the stored
 *     pick; the four variants are in the document, exactly one is visible, and
 *     its three fills are the brand trio on the dark boot.
 *  5. The app icon. The emblem-only 1024px master and the multi-size ICO are
 *     decoded/read here, by the engine that will ship them, and the packaging
 *     config that names both is read as shipped.
 *
 * The shell harness is the sidebar's own (`e2e/shell-sidebar.html`): the REAL
 * AppShell, providers, titlebar and settings page, so this rig measures the
 * shipping rail and the shipping Developer bench rather than mocks of them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeImage, session } from "electron";

// A hidden window still paints; an occluded one stops painting and stops firing
// requestAnimationFrame, which would leave the harness's own settle unreliable.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/shell-sidebar.html";
const indexUrl = new URL("/", url).toString();
const REPORT = path.join(artifactsDir, "brand-logo.json");
const WINDOW = { width: 1280, height: 900 };

/** The supplied Modern lockup's own canvas: the default, and the first check. */
const DEFAULT_VIEWBOX = "-3.8 39 1143 161.78";

const failures = [];
let step = "boot";

const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(`  FAIL ${label} — ${detail}`);
  failures.push(`${label}: ${detail}`);
};

/**
 * Box and computed-style read of the rail's brand band, its lockup, the theme
 * tokens the lockup is painted from, and the shop floor the pick happens on.
 * A rule is checked against these numbers, never inferred from the markup.
 */
const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const rail = document.querySelector(".nav-rail");
  const header = document.querySelector(".nav-rail__header");
  const brand = document.querySelector(".nav-rail__brand");
  const brandButton = document.querySelector(".nav-rail__brand-button");
  const svg = brand ? brand.querySelector("svg") : null;
  const lifeText = brand ? brand.querySelector(".life-text") : null;
  const toggle = document.querySelector(".nav-rail .nav-toggle");
  const firstLink = document.querySelector(".nav-rail__link");
  const wings = document.querySelector(".nav-rail__wings");
  const wingOption = wings ? wings.querySelector(".ui-segmented__option") : null;
  const wingText = wingOption
    ? (() => {
        const range = document.createRange();
        range.selectNodeContents(wingOption);
        const r = range.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      })()
    : null;
  const firstIcon = document.querySelector(
    ".nav-rail__link .nav-rail__icon-wrap svg",
  );
  const rootStyle = getComputedStyle(document.documentElement);
  const token = (name) => rootStyle.getPropertyValue(name).trim();
  const fillOf = (el) => (el ? getComputedStyle(el).fill : null);
  // The supplied art's two flanking rules: still in the markup, not drawn.
  const ruleOf = (el) =>
    el
      ? { display: getComputedStyle(el).display, fill: getComputedStyle(el).fill }
      : null;
  const picker = document.querySelector(".logo-picker");
  const options = picker
    ? Array.from(picker.querySelectorAll("[data-logo-option]"))
    : [];
  const checkedOption = options.find(
    (option) => option.getAttribute("aria-checked") === "true"
  );
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rail: box(rail),
    header: box(header),
    toggle: box(toggle),
    firstLink: box(firstLink),
    wings: box(wings),
    wingText,
    icon: box(firstIcon),
    rowPad: firstLink ? parseFloat(getComputedStyle(firstLink).paddingLeft) : null,
    lifeLeft: lifeText
      ? Math.round(lifeText.getBoundingClientRect().left)
      : null,
    brand: brand
      ? {
          box: box(brand),
          variant: brand.getAttribute("data-logo-variant"),
          role: brand.getAttribute("role"),
          label: brand.getAttribute("aria-label"),
          viewBox: svg ? svg.getAttribute("viewBox") : null,
          inHeader: Boolean(header && header.contains(brand)),
          display: getComputedStyle(brand).display,
          fills: {
            life: fillOf(brand.querySelector(".life-text")),
            icon: fillOf(brand.querySelector(".quest-icon")),
            uest: fillOf(brand.querySelector(".uest-text"))
          },
          rules: {
            life: ruleOf(brand.querySelector(".life-rule")),
            uest: ruleOf(brand.querySelector(".uest-rule"))
          }
        }
      : null,
    // The lockup's collapse button: the control the thin rail hides with the mark.
    brandButtonDisplay: brandButton
      ? getComputedStyle(brandButton).display
      : null,
    toggleMode: toggle ? toggle.getAttribute("data-nav-toggle") : null,
    toggleEmblem: Boolean(toggle && toggle.querySelector(".lifequest-emblem")),
    tokens: {
      life: token("--life-color"),
      icon: token("--icon-color"),
      uest: token("--uest-color")
    },
    storedLogo: (() => {
      try {
        return localStorage.getItem("lifequest-logo");
      } catch (error) {
        return null;
      }
    })(),
    overlay: Boolean(document.querySelector(".settings-overlay")),
    developer: picker
      ? {
          optionCount: options.length,
          labels: options.map((option) => option.getAttribute("aria-label")),
          ids: options.map((option) => option.getAttribute("data-logo-option")),
          active: checkedOption
            ? checkedOption.getAttribute("data-logo-option")
            : null
        }
      : null
  };
})()`;

/** The boot page: the four injected lockups, and the one on stage. */
const SPLASH_SAMPLE = `(() => {
  const splash = document.getElementById("splash");
  const wrap = splash ? splash.querySelector(".splash__logo") : null;
  const variants = wrap
    ? Array.from(wrap.querySelectorAll("[data-splash-logo]"))
    : [];
  const visible = variants.find(
    (variant) => getComputedStyle(variant).display !== "none"
  );
  const style = wrap ? getComputedStyle(wrap) : null;
  const fillOf = (selector) => {
    const el = visible ? visible.querySelector(selector) : null;
    return el ? getComputedStyle(el).fill : null;
  };
  const ruleOf = (selector) => {
    const el = visible ? visible.querySelector(selector) : null;
    return el
      ? { display: getComputedStyle(el).display, fill: getComputedStyle(el).fill }
      : null;
  };
  const token = (name) => (style ? style.getPropertyValue(name).trim() : null);
  return {
    hasSplash: Boolean(splash),
    dataLogo: document.documentElement.getAttribute("data-logo"),
    variantCount: variants.length,
    variants: variants.map((variant) => variant.getAttribute("data-splash-logo")),
    visibleVariant: visible ? visible.getAttribute("data-splash-logo") : null,
    role: wrap ? wrap.getAttribute("role") : null,
    label: wrap ? wrap.getAttribute("aria-label") : null,
    fills: {
      life: fillOf(".life-text"),
      icon: fillOf(".quest-icon"),
      uest: fillOf(".uest-text")
    },
    rules: {
      life: ruleOf(".life-rule"),
      uest: ruleOf(".uest-rule")
    },
    tokens: {
      life: token("--life-color"),
      icon: token("--icon-color"),
      uest: token("--uest-color")
    },
    hidden: Boolean(splash && splash.hasAttribute("hidden"))
  };
})()`;

/** A `run` that cannot wedge the whole rig on a renderer that stops answering. */
const runWithTimeout = (win, expression, timeoutMs = 15_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("renderer did not answer in 15s")),
      timeoutMs,
    );
    win.webContents.executeJavaScript(expression, true).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A computed token as the `rgb()` string a computed `fill` reports, so the pair
 * ("the fill equals the token") is a string comparison and not a colour guess.
 * A token that is already an rgb()/color() string passes through.
 */
function cssColor(value) {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(valueTrimmed);
  if (!hex) return valueTrimmed;
  const full =
    hex[1].length === 3
      ? hex[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The harness's own readiness promise, polled. Vite may re-optimise its
 * dependencies and reload the page mid-wait, clearing the globals the harness
 * sets, so a single read is not enough. The 90s ceiling is generous because the
 * first load of the shell on a cold dev server can spend a while optimising the
 * app's dependency graph; it keeps a crashed harness a failure, not a hang.
 */
async function waitForHarness(win, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "harness globals never appeared";
  while (Date.now() < deadline) {
    try {
      const ready = await runWithTimeout(
        win,
        `(async () => {
          if (typeof window.shellHarnessReady !== "object") return null;
          const settled = await Promise.race([
            window.shellHarnessReady.then(() => "ready", () => "rejected"),
            new Promise((resolve) => setTimeout(() => resolve("pending"), 1500))
          ]);
          if (settled !== "ready") return null;
          return typeof window.shellHarnessVaultName === "string"
            ? window.shellHarnessVaultName
            : null;
        })()`,
        8000,
      );
      if (typeof ready === "string") return ready;
      lastError = "harness not ready yet";
    } catch (error) {
      lastError = String(error);
    }
    await sleep(250);
  }
  throw new Error(`harness never became ready: ${lastError}`);
}

const sample = async (win) => {
  const state = await runWithTimeout(win, SAMPLE);
  if (!state) throw new Error("the shell returned no sample");
  return state;
};

/** Poll a selector until it exists (or the deadline passes). */
async function waitForSelector(win, selector, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const found = await runWithTimeout(
        win,
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        5000,
      );
      if (found) return true;
    } catch {
      /* The page may be navigating; try again. */
    }
    await sleep(100);
  }
  return false;
}

/** Click one element through its own handler; true when it was found. */
const clickSelector = (win, selector) =>
  runWithTimeout(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );

/** Click the first element of `selector` whose trimmed text equals `text`. */
const clickByText = (win, selector, text) =>
  runWithTimeout(
    win,
    `(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = els.find((node) => (node.textContent || "").trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );

/** The harness's own palette switch: the same two calls the provider makes. */
async function applyTheme(win, skin, mode) {
  const applied = await runWithTimeout(
    win,
    `window.shellHarnessApplyTheme?.(${JSON.stringify(skin)}, ${JSON.stringify(mode)}) ?? null`,
  );
  check(
    `the harness switched to ${skin} ${mode}`,
    applied === skin,
    `harness resolved ${JSON.stringify(applied)}`,
  );
  await sleep(300);
}

/**
 * The picture of the shipped rail in the current state: the header while the rail
 * is wide (the centred lockup), and the foot while it is thin — the collapse
 * toggle's home, where the expand emblem now sits under the vault's initials.
 * The header holds no control at the thin width, so a crop of it would show the
 * drag band and nothing else.
 */
async function captureHeader(win, state, name) {
  const file = path.join(artifactsDir, name);
  const thin = state.toggleMode === "brand";
  const height = Math.min(state.viewport.height, thin ? 180 : 110);
  const shot = await win.webContents.capturePage({
    x: 0,
    y: thin ? Math.max(0, state.viewport.height - height) : 0,
    width: Math.max(1, state.rail?.width ?? WINDOW.width),
    height,
  });
  fs.writeFileSync(file, shot.toPNG());
  return file;
}

/**
 * Open the boot page in its own window and read the splash's lockup.
 *
 * The root page is loaded without the app's bridge (a rig window has no
 * preload), so the app's own mount may fail — the splash is static markup and
 * is exactly what is being read. `theme-boot.js` has already set `data-logo`
 * from localStorage, which is the wiring under test.
 */
async function readSplash(picture) {
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    show: false,
    backgroundColor: "#111214",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadURL(indexUrl);
    await sleep(600);
    const state = await runWithTimeout(win, SPLASH_SAMPLE, 10_000);
    // The app may have started and dismissed the splash behind a failed mount;
    // for the artifact, put the static overlay back (the real app's own boot is
    // the startup rig's claim, not this one's).
    if (picture) {
      await runWithTimeout(
        win,
        `(() => {
          const splash = document.getElementById("splash");
          if (!splash) return false;
          splash.removeAttribute("hidden");
          splash.classList.remove("splash--done", "splash--out");
          return true;
        })()`,
      );
      await sleep(500);
      fs.writeFileSync(picture, (await win.webContents.capturePage()).toPNG());
    }
    return state;
  } finally {
    win.destroy();
  }
}

/** Reads the committed app icon and the packaging config, in the shipping engine. */
function iconFacts() {
  const png = nativeImage.createFromPath(path.join(desktopRoot, "build", "icon.png"));
  const ico = fs.readFileSync(path.join(desktopRoot, "build", "icon.ico"));
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => {
    const width = ico[6 + i * 16];
    return width === 0 ? 256 : width;
  });
  const builderYml = fs.readFileSync(
    path.join(desktopRoot, "electron-builder.yml"),
    "utf8",
  );
  return {
    png: png.isEmpty() ? null : png.getSize(),
    ico: { signature: ico.readUInt16LE(0), type: ico.readUInt16LE(2), count, sizes },
    builder: {
      masterNamed: /^icon:\s*build\/icon\.png$/m.test(builderYml),
      windowsNamed: /^\s+icon:\s*build\/icon\.ico$/m.test(builderYml),
    },
  };
}

async function main() {
  await app.whenReady();

  // The dev-server origin keeps its storage between rigs and runs. Start from a
  // known shop floor: no logo pick, and the dark boot the splash defaults to.
  await session.defaultSession.clearStorageData({
    origin: new URL(url).origin,
    storages: ["localstorage"],
  });

  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: "#171614",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.on("closed", () => {});
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  let report;
  const watchdog = setTimeout(() => {
    console.error("brand-logo: timed out after 180s");
    app.exit(1);
  }, 180_000);

  try {
    step = "load the shell harness";
    await win.loadURL(url);
    const vaultName = await waitForHarness(win);
    win.setContentSize(WINDOW.width, WINDOW.height);
    await sleep(300);
    win.showInactive();

    step = "pin the forge night palette";
    await applyTheme(win, "forge", "dark");

    step = "measure the rail's lockup";
    const expanded = await sample(win);
    const brand = expanded.brand;
    check("the rail exists", Boolean(expanded.rail), "no .nav-rail in the shell");
    check(
      "the lockup is the shipped default (Minimal) before any pick",
      Boolean(brand) &&
        brand.variant === "minimal" &&
        expanded.storedLogo === null,
      `variant ${JSON.stringify(brand?.variant)} stored ${JSON.stringify(expanded.storedLogo)}`,
    );
    check(
      "the lockup is the official artwork, in the rail's header",
      Boolean(brand) &&
        brand.inHeader === true &&
        brand.role === "img" &&
        brand.label === "LifeQuest" &&
        brand.viewBox === DEFAULT_VIEWBOX,
      `brand ${JSON.stringify(brand)} header ${JSON.stringify(expanded.header)}`,
    );
    check(
      "the lockup is centred on the rail's column",
      Boolean(brand && expanded.header && expanded.rail) &&
        brand.box.top >= expanded.header.top - 1 &&
        brand.box.bottom <= expanded.header.bottom + 1 &&
        Math.abs(
          (brand.box.left + brand.box.right) / 2 -
            (expanded.rail.left + expanded.rail.right) / 2,
        ) <= 1 &&
        brand.box.height >= 24 &&
        brand.box.height <= 31,
      `brand ${JSON.stringify(brand?.box)} in rail ${JSON.stringify(expanded.rail)} under header ${JSON.stringify(expanded.header)}`,
    );
    check(
      "the lockup's painted box holds equal air on the column's two sides",
      Boolean(brand && expanded.rail) &&
        Math.abs(
          brand.box.left -
            expanded.rail.left -
            (expanded.rail.right - brand.box.right),
        ) <= 2,
      `lockup ${JSON.stringify(brand?.box)} in rail ${JSON.stringify(expanded.rail)}`,
    );
    check(
      "the rail keeps its collapse chevron",
      expanded.toggleMode === "chevron",
      `toggle mode ${JSON.stringify(expanded.toggleMode)}`,
    );
    check(
      "the lockup keeps the artwork's aspect ratio",
      Boolean(brand) &&
        Math.abs(brand.box.width / brand.box.height - 1143 / 161.78) < 0.15,
      `box ${JSON.stringify(brand?.box)} ratio ${brand ? (brand.box.width / brand.box.height).toFixed(3) : "—"}`,
    );
    check(
      "the lockup's three groups are painted from the theme tokens",
      Boolean(brand) &&
        brand.fills.life === cssColor(expanded.tokens.life) &&
        brand.fills.icon === cssColor(expanded.tokens.icon) &&
        brand.fills.uest === cssColor(expanded.tokens.uest),
      `fills ${JSON.stringify(brand?.fills)} tokens ${JSON.stringify(expanded.tokens)}`,
    );
    check(
      "the lockup's flanking rules are present but not drawn",
      Boolean(brand?.rules?.life && brand?.rules?.uest) &&
        brand.rules.life.display === "none" &&
        brand.rules.uest.display === "none",
      `rules ${JSON.stringify(brand?.rules)}`,
    );
    check(
      "the forge night palette draws both words cream and the emblem ember",
      expanded.tokens.life.toLowerCase() === "#f8e5c8" &&
        expanded.tokens.icon.toLowerCase() === "#c66a3d" &&
        expanded.tokens.uest.toLowerCase() === "#f8e5c8",
      `tokens ${JSON.stringify(expanded.tokens)}`,
    );
    // The toggle's home is the rail's foot now, at the sidebar's bottom trailing
    // corner — not the header row beside the lockup.
    check(
      "the collapse chevron lives in the rail's foot",
      Boolean(expanded.toggle && expanded.header && expanded.rail) &&
        expanded.toggle.top > expanded.header.bottom &&
        Math.abs(expanded.rail.bottom - expanded.toggle.bottom) <= 16 &&
        expanded.toggle.right > expanded.rail.left + (expanded.rail.width ?? 0) * 0.7,
      `toggle ${JSON.stringify(expanded.toggle)} header ${JSON.stringify(expanded.header)} rail ${JSON.stringify(expanded.rail)}`,
    );

    const wideFile = await captureHeader(win, expanded, "brand-logo-wide.png");
    const shellFile = path.join(artifactsDir, "brand-logo-shell.png");
    fs.writeFileSync(shellFile, (await win.webContents.capturePage()).toPNG());

    // The lockup follows the day palette: derived from the palette (ink for the
    // words, the brand primary for the emblem), and the fills follow the tokens.
    step = "read the lockup in the day palette";
    await applyTheme(win, "forge", "light");
    const day = await sample(win);
    check(
      "the day palette re-inks the lockup from its own tokens",
      Boolean(day.brand) &&
        day.brand.fills.life === cssColor(day.tokens.life) &&
        day.brand.fills.icon === cssColor(day.tokens.icon) &&
        day.brand.fills.uest === cssColor(day.tokens.uest) &&
        day.tokens.life.toLowerCase() === "#1e1e22" &&
        day.tokens.icon.toLowerCase() === "#b4532a" &&
        day.tokens.uest.toLowerCase() === "#1e1e22",
      `day tokens ${JSON.stringify(day.tokens)} fills ${JSON.stringify(day.brand?.fills)}`,
    );
    check(
      "day and night draw different inks",
      Boolean(day.brand && brand) &&
        day.brand.fills.life !== brand.fills.life &&
        day.brand.fills.uest !== brand.fills.uest,
      `day ${JSON.stringify(day.brand?.fills)} night ${JSON.stringify(brand?.fills)}`,
    );

    // A second palette moves the inks again — the logo follows the active skin,
    // not a fixed brand trio baked into the component.
    step = "read the lockup in another skin";
    await applyTheme(win, "nous", "dark");
    const nous = await sample(win);
    check(
      "another skin's palette moves the lockup's inks",
      Boolean(nous.brand) &&
        nous.brand.fills.life === cssColor(nous.tokens.life) &&
        nous.brand.fills.icon === cssColor(nous.tokens.icon) &&
        nous.brand.fills.uest === cssColor(nous.tokens.uest) &&
        nous.tokens.life !== expanded.tokens.life &&
        nous.tokens.icon !== expanded.tokens.icon,
      `nous tokens ${JSON.stringify(nous.tokens)} fills ${JSON.stringify(nous.brand?.fills)}`,
    );
    await applyTheme(win, "forge", "dark");

    // The splash, before any pick: the default lockup, brand trio on the dark
    // boot. Storage is written from the shell window so the boot is deterministic.
    step = "read the default splash";
    await runWithTimeout(
      win,
      `(() => {
        localStorage.setItem("lifequest-theme", "dark");
        localStorage.removeItem("lifequest-logo");
        return true;
      })()`,
    );
    const splashDefaultFile = path.join(artifactsDir, "brand-logo-splash-default.png");
    const splashDefault = await readSplash(splashDefaultFile);
    check(
      "the splash wears the shipped default before any pick",
      splashDefault.hasSplash === true &&
        splashDefault.dataLogo === "minimal" &&
        splashDefault.visibleVariant === "minimal" &&
        splashDefault.variantCount === 4,
      `splash ${JSON.stringify(splashDefault)}`,
    );
    check(
      "the splash's lockup is the brand trio on the dark boot",
      splashDefault.role === "img" &&
        splashDefault.label === "LifeQuest" &&
        splashDefault.fills.life === "rgb(248, 229, 200)" &&
        splashDefault.fills.icon === "rgb(198, 106, 61)" &&
        splashDefault.fills.uest === "rgb(248, 229, 200)" &&
        splashDefault.tokens.life.toLowerCase() === "#f8e5c8",
      `splash fills ${JSON.stringify(splashDefault.fills)} tokens ${JSON.stringify(splashDefault.tokens)}`,
    );
    check(
      "the splash hides the lockup's flanking rules too",
      splashDefault.rules?.life?.display === "none" &&
        splashDefault.rules?.uest?.display === "none",
      `splash rules ${JSON.stringify(splashDefault.rules)}`,
    );

    // The thin rail leaves the lockup out and keeps the toggle.
    step = "collapse the rail";
    const clicked = await clickSelector(win, ".nav-rail .nav-toggle");
    check("the rail's collapse toggle clicked", clicked === true, "no toggle to click");
    await sleep(400);
    const collapsed = await sample(win);
    check(
      "the thin rail is the icon column and hides the lockup",
      Boolean(collapsed.rail) &&
        collapsed.rail.width === 56 &&
        Boolean(collapsed.brand) &&
        collapsed.brand.box.width === 0 &&
        collapsed.brandButtonDisplay === "none",
      `rail ${JSON.stringify(collapsed.rail)} brand ${JSON.stringify(collapsed.brand?.box)}, button display ${JSON.stringify(collapsed.brandButtonDisplay)}`,
    );
    check(
      "the thin rail's expand control is the pure emblem",
      collapsed.toggleMode === "brand" && collapsed.toggleEmblem === true,
      `toggle mode ${JSON.stringify(collapsed.toggleMode)} emblem ${collapsed.toggleEmblem}`,
    );
    const thinFile = await captureHeader(win, collapsed, "brand-logo-collapsed.png");
    // Expand again for the Developer flow.
    await clickSelector(win, ".nav-rail .nav-toggle");
    await sleep(400);

    // The Developer bench: open the shipping settings sheet from the titlebar's
    // gear, reach the shipping Developer page, pick Classic, and read the rail
    // behind the sheet.
    step = "open Settings → Developer";
    const opened = await clickSelector(win, 'a[aria-label="Open settings"]');
    check("the titlebar's settings control clicked", opened === true, "no settings link");
    const overlayUp = await waitForSelector(win, ".settings-overlay");
    check("the settings sheet opened over the shell", overlayUp, "no .settings-overlay in the tree");
    const developerClicked = await clickByText(win, ".settings-nav-item", "Developer");
    check("the Developer page clicked", developerClicked === true, "no Developer nav item");
    const pickerUp = await waitForSelector(win, "[data-developer-logo]");
    check("the Developer page holds the logo bench", pickerUp, "no [data-developer-logo]");
    await sleep(250);
    const developerOpen = await sample(win);
    check(
      "the bench offers the four shipped lockups, Minimal active",
      Boolean(developerOpen.developer) &&
        developerOpen.developer.optionCount === 4 &&
        JSON.stringify(developerOpen.developer.ids) ===
          JSON.stringify(["modern", "athletic", "classic", "minimal"]) &&
        developerOpen.developer.active === "minimal" &&
        JSON.stringify(developerOpen.developer.labels) ===
          JSON.stringify(["Modern", "Athletic", "Classic", "Minimal"]),
      `picker ${JSON.stringify(developerOpen.developer)}`,
    );
    const developerFile = path.join(artifactsDir, "brand-logo-developer.png");
    fs.writeFileSync(developerFile, (await win.webContents.capturePage()).toPNG());

    step = "pick Classic in the Developer bench";
    const picked = await clickSelector(win, '[data-logo-option="classic"]');
    check("the Classic option clicked", picked === true, "no Classic option");
    await sleep(350);
    const afterPick = await sample(win);
    check(
      "the pick is stored and the picker marks it",
      afterPick.storedLogo === "classic" && afterPick.developer?.active === "classic",
      `stored ${JSON.stringify(afterPick.storedLogo)} picker ${JSON.stringify(afterPick.developer)}`,
    );
    check(
      "the rail behind the sheet repaints to Classic on the press",
      Boolean(afterPick.brand) &&
        afterPick.brand.variant === "classic" &&
        afterPick.brand.viewBox === "14.4 38 1017 173.77",
      `rail brand ${JSON.stringify(afterPick.brand)}`,
    );

    step = "close the settings sheet";
    const closed = await clickSelector(win, '[aria-label="Close settings"]');
    check("the sheet's close control clicked", closed === true, "no close control");
    const overlayGone = async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const stillUp = await runWithTimeout(
          win,
          `Boolean(document.querySelector(".settings-overlay"))`,
        );
        if (!stillUp) return true;
        await sleep(100);
      }
      return false;
    };
    check("the sheet closed and left the rail", await overlayGone(), "the overlay stayed up");
    const afterClose = await sample(win);
    check(
      "the rail keeps Classic after the sheet closes",
      Boolean(afterClose.brand) && afterClose.brand.variant === "classic",
      `rail brand ${JSON.stringify(afterClose.brand)}`,
    );

    // The pick survives a reload: the rail reads the stored value on mount.
    step = "reload the shell";
    await win.reload();
    await waitForHarness(win);
    await sleep(400);
    const reloaded = await sample(win);
    check(
      "the pick survives a reload",
      Boolean(reloaded.brand) &&
        reloaded.brand.variant === "classic" &&
        reloaded.storedLogo === "classic",
      `rail brand ${JSON.stringify(reloaded.brand)} stored ${JSON.stringify(reloaded.storedLogo)}`,
    );

    // The next launch's splash wears the picked lockup.
    step = "read the picked splash";
    await runWithTimeout(
      win,
      `(() => { localStorage.setItem("lifequest-theme", "dark"); return true; })()`,
    );
    const splashFile = path.join(artifactsDir, "brand-logo-splash.png");
    const splashSelected = await readSplash(splashFile);
    check(
      "the splash wears the picked lockup",
      splashSelected.dataLogo === "classic" &&
        splashSelected.visibleVariant === "classic" &&
        splashSelected.variantCount === 4,
      `splash ${JSON.stringify(splashSelected)}`,
    );

    // Put Modern back so the rig's own profile is not left on a pick nobody made.
    await runWithTimeout(
      win,
      `(() => { localStorage.removeItem("lifequest-logo"); return true; })()`,
    );

    // The app icon: the emblem-only master and the multi-size ICO, decoded/read
    // in the engine that ships them, plus the config that names both.
    step = "read the app icon";
    const icon = iconFacts();
    check(
      "the app icon master is a 1024px square the engine can decode",
      Boolean(icon.png) && icon.png.width === 1024 && icon.png.height === 1024,
      `png ${JSON.stringify(icon.png)}`,
    );
    check(
      "the Windows icon is a multi-size ICO that reaches 256px",
      icon.ico.signature === 0 &&
        icon.ico.type === 1 &&
        icon.ico.count >= 6 &&
        Math.max(...icon.ico.sizes) === 256 &&
        icon.ico.sizes.includes(16) &&
        icon.ico.sizes.includes(32),
      `entries ${JSON.stringify(icon.ico.sizes)}`,
    );
    check(
      "electron-builder is told to use both icon files",
      icon.builder.masterNamed && icon.builder.windowsNamed,
      JSON.stringify(icon.builder),
    );

    report = {
      url,
      indexUrl,
      ranAt: new Date().toISOString(),
      vaultName,
      window: { ...WINDOW },
      expanded,
      day,
      nous,
      collapsed,
      afterPick,
      reloaded,
      splashDefault,
      splashSelected,
      icon,
      screenshots: [
        wideFile,
        shellFile,
        thinFile,
        developerFile,
        splashDefaultFile,
        splashFile,
      ],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw at ${step}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(watchdog);
    win.destroy();
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nlockup ${report.expanded?.brand?.box?.width ?? "—"}x${report.expanded?.brand?.box?.height ?? "—"}px, ` +
      `variant ${report.expanded?.brand?.variant ?? "—"}, ` +
      `night inks ${JSON.stringify(report.expanded?.tokens ?? null)}`,
  );
  console.log(
    `splash ${report.splashDefault?.visibleVariant ?? "—"} → ${report.splashSelected?.visibleVariant ?? "—"}, ` +
      `app icon ${JSON.stringify(report.icon?.png ?? null)}`,
  );
  console.log(`\nreport: ${REPORT}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "brand logo: PASS" : "brand logo: FAIL");
  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`brand-logo: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
