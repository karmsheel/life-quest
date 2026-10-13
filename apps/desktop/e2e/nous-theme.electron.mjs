/**
 * Drives the two Nous skins in a real Electron window and turns the
 * measurements into `e2e/artifacts/nous-theme.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/nous-theme.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: five passes (Nous light and dark, Nous Classic light and dark, and
 * Forge OS as the isolation control) plus screenshots of the real shell.
 *
 * The assertion that matters most is the OKLab one. Both palettes are copies of
 * Hermes Desktop's, so their hexes are correct by construction; what can silently
 * regress is the *derivation* — blending a saturated blue toward a surface in
 * gamma-encoded sRGB rotates its hue, which is how a clean blue accent produces a
 * lavender selection row. That happens after the palette, so no amount of reading
 * palette values can catch it. The rig measures the blend itself.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/nous-theme.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(async () => {
  await document.fonts.ready;

  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const tok = (name) => (cs.getPropertyValue(name) || "").trim();

  // A custom property keeps its literal text, so every colour assertion goes
  // through a real element and reads back the browser's own computed rgb().
  const resolveVar = (name) => {
    const d = document.createElement("div");
    d.style.color = "var(" + name + ")";
    document.body.appendChild(d);
    const out = getComputedStyle(d).color;
    d.remove();
    return out;
  };

  const pane = document.querySelector(".welcome");
  const paneStyle = pane ? getComputedStyle(pane) : null;
  const card = document.querySelector(".welcome-card");
  const h1 = document.querySelector(".welcome-card h1");

  return {
    skin: root.getAttribute("data-skin"),
    theme: root.getAttribute("data-theme"),
    tokens: {
      background: tok("--background"),
      canvasBase: tok("--canvas-base"),
      card: tok("--card"),
      mutedSurface: tok("--muted-surface"),
      foreground: tok("--foreground"),
      primary: tok("--primary"),
      ring: tok("--ring"),
      border: tok("--border"),
      input: tok("--input"),
      sidebarBorder: tok("--sidebar-border"),
      accentTint: tok("--accent-tint"),
      fontDisplay: tok("--font-display"),
      fontSans: tok("--font-sans"),
    },
    resolved: {
      primary: resolveVar("--primary"),
      background: resolveVar("--background"),
      foreground: resolveVar("--foreground"),
    },
    painted: {
      pane: paneStyle ? paneStyle.backgroundColor : null,
      title: h1 ? getComputedStyle(h1).color : null,
      titleFont: h1 ? getComputedStyle(h1).fontFamily : null,
      cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
    },
    supports: {
      nous: window.nousHarness.supportsModes("nous"),
      classic: window.nousHarness.supportsModes("nous-classic"),
    },
    oklab: {
      // Two seeds, because the metric only means something for a saturated one.
      // Near white, OKLCH chroma collapses and the hue angle is numerically
      // unstable: 0053fd at 88% toward white has almost no chroma left, so its
      // "drift" is noise in either direction. 0000f2 still has colour to
      // preserve, and that is where the two mixers visibly part company.
      // NB: no backticks in this comment — it lives inside a template literal.
      brand: window.nousHarness.oklabCheck("#0053fd"),
      saturated: window.nousHarness.oklabCheck("#0000f2"),
    },
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** A watchdog over the WHOLE run: `executeJavaScript` can stop settling during a
 *  Vite reload, which is a hang this file cannot otherwise escape. */
const WATCHDOG_MS = 180_000;
const watchdog = setTimeout(() => {
  console.error(`nous-theme: hard timeout after ${WATCHDOG_MS / 1000}s`);
  app.exit(1);
}, WATCHDOG_MS);
if (typeof watchdog.unref === "function") watchdog.unref();

/** `#rrggbb` → `[r, g, b]`, or null for anything else. */
function rgbOf(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** True when an ink reads blue: its blue channel clearly leads red and green. */
function isBlue(value, minLead = 20) {
  const rgb = rgbOf(value);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return b - r >= minLead && b - g >= minLead;
}

/** True when a colour is the lavender failure mode: LIGHT, red === green, blue lead. */
function isLavender(value, minBlueLead = 20, minLightness = 0.7) {
  const rgb = rgbOf(value);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  return r === g && b - r >= minBlueLead && lightness >= minLightness;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "light";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.nousHarnessReady !== "object") return null;
          await window.nousHarnessReady;
          return document.querySelector(".welcome") ? true : null;
        })()`);
        if (ready === true) return;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 320));

  /** Photograph the skin in the real shell — Welcome alone hides most of it. */
  const shootShell = async () => {
    const shell = new BrowserWindow({
      ...DEFAULT_SIZE,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const shellRun = (e) => shell.webContents.executeJavaScript(e, true);
    const files = [];
    try {
      await shell.loadURL(url.replace(/nous-theme\.html$/, "shell-sidebar.html"));
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const ready = await shellRun(`(async () => {
          if (typeof window.shellHarnessReady !== "object") return null;
          await window.shellHarnessReady;
          return !!document.querySelector(".nav-rail");
        })()`);
        if (ready === true) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      shell.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
      await settle();
      shell.showInactive();
      await settle();
      for (const [skin, mode, name] of [
        ["nous", "light", "shell-nous-light"],
        ["nous", "dark", "shell-nous-dark"],
        ["nous-classic", "dark", "shell-classic-dark"],
      ]) {
        await shellRun(
          `window.shellHarnessApplyTheme(${JSON.stringify(skin)}, ${JSON.stringify(mode)})`,
        );
        await settle();
        const image = await shell.webContents.capturePage();
        const file = path.join(artifactsDir, `nous-theme-${name}.png`);
        fs.writeFileSync(file, image.toPNG());
        files.push(file);
      }
    } finally {
      shell.destroy();
    }
    return files;
  };

  const stages = {};
  let screenshots = [];

  try {
    await win.loadURL(url);
    await waitForHarness();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await settle();
    win.showInactive();
    await settle();

    // --- Pass 1: Nous, light. The harness seeded "nous" + "light", so this is
    // what ThemeProvider produced on its own.
    const nousLight = await sample();
    stages.nousLight = nousLight;

    check(
      "nous/light: the skin is applied",
      nousLight.skin === "nous",
      `data-skin is ${JSON.stringify(nousLight.skin)}`,
    );
    check(
      "nous/light: the GitHub Light chrome lands on LifeQuest's ladder",
      nousLight.tokens.background === "#ffffff" &&
        nousLight.tokens.canvasBase === "#f6f8fa" &&
        nousLight.tokens.foreground === "#1f2328" &&
        nousLight.tokens.border === "#d0d7de",
      `--background ${nousLight.tokens.background} (sheet, expected white), --canvas-base ${nousLight.tokens.canvasBase} (mat, expected GitHub grey), --foreground ${nousLight.tokens.foreground}, --border ${nousLight.tokens.border}`,
    );
    check(
      "nous/light: the accent is the brand seed",
      nousLight.tokens.primary === "#0053fd" && nousLight.tokens.ring === "#0053fd",
      `--primary ${nousLight.tokens.primary}, --ring ${nousLight.tokens.ring}`,
    );
    check(
      "nous/light: the input edge is derived blue, not the neutral border",
      isBlue(nousLight.tokens.input, 20),
      `--input ${nousLight.tokens.input} (${JSON.stringify(rgbOf(nousLight.tokens.input))})`,
    );
    check(
      "nous/light: no derived token came out lavender",
      ![nousLight.tokens.accentTint, nousLight.tokens.mutedSurface, nousLight.tokens.input].some(
        (v) => isLavender(v),
      ),
      `accent-tint ${nousLight.tokens.accentTint}, muted ${nousLight.tokens.mutedSurface}, input ${nousLight.tokens.input}`,
    );
    check(
      "nous/light: the retired site faces are gone (palette-only skin)",
      !/Rules|Aeonik|sigurd/i.test(nousLight.tokens.fontDisplay),
      `--font-display ${nousLight.tokens.fontDisplay}`,
    );
    check(
      "nous/light: the welcome card is the real one",
      nousLight.painted.cardWidth > 200,
      `card width ${nousLight.painted.cardWidth}`,
    );

    // --- Pass 2: Nous, dark.
    await run(`window.nousHarness.apply("nous", "dark")`);
    await settle();
    const nousDark = await sample();
    stages.nousDark = nousDark;
    check(
      "nous/dark: the GitHub Dark chrome lands",
      nousDark.tokens.background === "#0d1117" &&
        nousDark.tokens.foreground === "#e6edf3" &&
        nousDark.tokens.card === "#010409" &&
        nousDark.tokens.border === "#30363d",
      `--background ${nousDark.tokens.background}, --foreground ${nousDark.tokens.foreground}, --card ${nousDark.tokens.card}, --border ${nousDark.tokens.border}`,
    );
    check(
      "nous/dark: the accent is the lifted second seed",
      nousDark.tokens.primary === "#4a84fe",
      `--primary ${nousDark.tokens.primary} — expected the AA-lifted #4a84fe, not the light seed`,
    );

    // --- Pass 3 & 4: Nous Classic, both modes.
    await run(`window.nousHarness.apply("nous-classic", "light")`);
    await settle();
    const classicLight = await sample();
    stages.classicLight = classicLight;
    check(
      "classic/light: glass neutrals under brand blue",
      classicLight.skin === "nous-classic" &&
        classicLight.tokens.background === "#f8faff" &&
        classicLight.tokens.canvasBase === "#f3f7ff" &&
        classicLight.tokens.foreground === "#17171a" &&
        classicLight.tokens.border === "#c1d5ff",
      `data-skin ${classicLight.skin}, --background ${classicLight.tokens.background}, --canvas-base ${classicLight.tokens.canvasBase}, --border ${classicLight.tokens.border}`,
    );

    await run(`window.nousHarness.apply("nous-classic", "dark")`);
    await settle();
    const classicDark = await sample();
    stages.classicDark = classicDark;
    check(
      "classic/dark: cream on mission-blue",
      classicDark.tokens.background === "#0d2f86" &&
        classicDark.tokens.foreground === "#ffe6cb" &&
        classicDark.tokens.card === "#12378f" &&
        classicDark.tokens.border === "#3158ad",
      `--background ${classicDark.tokens.background}, --foreground ${classicDark.tokens.foreground}, --card ${classicDark.tokens.card}, --border ${classicDark.tokens.border}`,
    );
    check(
      "classic/dark: the brand blue is the surface, not the accent",
      classicDark.tokens.primary === "#ffe6cb",
      `--primary ${classicDark.tokens.primary} — Classic inverts what Nous does with the blue`,
    );

    // --- The design-style invariant, measured on a seed that still has chroma.
    const o = nousDark.oklab.saturated;
    check(
      "oklab: the sRGB blend drifts the brand hue",
      o.srgbDrift >= 12,
      `${o.seed} 88%→white in sRGB landed ${o.srgbDrift.toFixed(1)}° from its ${o.seedHue.toFixed(1)}° hue (${o.srgb}) — if this is small the mixer changed`,
    );
    check(
      "oklab: the OKLab blend holds it",
      o.oklabDrift <= 6 && o.oklabDrift < o.srgbDrift / 3,
      `OKLab landed ${o.oklabDrift.toFixed(1)}° off (${o.oklab}) vs sRGB's ${o.srgbDrift.toFixed(1)}° (${o.srgb})`,
    );

    // --- Both skins ship both palettes.
    for (const name of ["nous", "classic"]) {
      const s = nousDark.supports[name];
      check(
        `${name}: ships both palettes`,
        s.light === true && s.dark === true && s.both === true,
        `supportsModes ${JSON.stringify(s)}`,
      );
    }

    check(
      "nothing spills past the window",
      nousDark.overflow.scrollWidth <= nousDark.overflow.clientWidth,
      `scrollWidth ${nousDark.overflow.scrollWidth} vs clientWidth ${nousDark.overflow.clientWidth}`,
    );

    screenshots = await shootShell();

    // --- Pass 5: the control. Forge OS must be exactly what it was.
    await run(`window.nousHarness.apply("forge-os", "dark")`);
    await settle();
    const control = await sample();
    stages.control = control;
    check(
      "control: Forge OS keeps its own background and accent",
      control.tokens.background !== "#0d1117" && control.tokens.primary !== "#0053fd",
      `Forge OS --background ${control.tokens.background}, --primary ${control.tokens.primary}`,
    );
    check(
      "control: Forge OS titles take no Nous face",
      !/Rules|Aeonik/i.test(control.painted.titleFont ?? ""),
      `title font ${control.painted.titleFont}`,
    );
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(watchdog);
  }

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    stages,
    screenshots,
    failures,
    pass: failures.length === 0,
  };

  const reportFile = path.join(artifactsDir, "nous-theme.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const n = report.stages?.nousLight;
  const c = report.stages?.classicDark;
  if (n) {
    console.log(
      `nous light  --background ${n.tokens.background}  --primary ${n.tokens.primary}  --border ${n.tokens.border}  input ${n.tokens.input}`,
    );
  }
  if (report.stages?.nousDark) {
    const d = report.stages.nousDark;
    console.log(`nous dark   --background ${d.tokens.background}  --primary ${d.tokens.primary}  --border ${d.tokens.border}`);
  }
  if (c) {
    console.log(
      `classic dark --background ${c.tokens.background}  --primary ${c.tokens.primary}  --foreground ${c.tokens.foreground}`,
    );
  }
  if (n?.oklab) {
    const b = n.oklab.brand;
    const s = n.oklab.saturated;
    console.log(
      `oklab       ${b.seed} ${b.seedHue.toFixed(1)}° (near-white, noisy): sRGB ${b.srgbDrift.toFixed(1)}° / OKLab ${b.oklabDrift.toFixed(1)}°`,
    );
    console.log(
      `            ${s.seed} ${s.seedHue.toFixed(1)}° (saturated): sRGB ${s.srgb} ${s.srgbDrift.toFixed(1)}° off / OKLab ${s.oklab} ${s.oklabDrift.toFixed(1)}° off`,
    );
  }
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "nous themes: PASS" : "nous themes: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`nous-theme: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
