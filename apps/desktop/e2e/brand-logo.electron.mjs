/**
 * Drives the real shell in a real Electron window and checks the brand's two
 * shipping surfaces, then turns the measurements into
 * `e2e/artifacts/brand-logo.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/brand-logo.electron.mjs
 *
 * What is measured, and why these surfaces:
 *
 *  1. The wordmark in the rail's header. It is the official
 *     `src/assets/brand/lifequest-wordmark.svg`, painted as a CSS mask so the
 *     rail's own ink carries it. The rig reads the computed mask URL (the asset,
 *     not a baked data URL), the ink pair (`background === --fg`), the box ratio
 *     against the artwork's own 872.25:162.45, and the inset against the rail's
 *     first navigation row — the word sits on the rail's content edge, not
 *     floating in the strip.
 *  2. The thin rail. 56px cannot hold a word: the wordmark leaves the band, the
 *     toggle keeps it, and the rail stays the icon column.
 *  3. The app icon. The emblem-only 1024px master and the multi-size ICO are
 *     decoded/read here, by the engine that will ship them, and the packaging
 *     config that names both is read as shipped.
 *
 * The harness page is the shell sidebar's own (`e2e/shell-sidebar.html`): it
 * mounts the REAL AppShell with the real providers, so this rig measures the
 * shipping rail rather than a mock of it. The screenshots are the shipped
 * header at 1:1 — the wide strip with the wordmark and toggle, and the thin
 * column that has left the word out.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeImage } from "electron";

// A hidden window still paints; an occluded one stops painting and stops firing
// requestAnimationFrame, which would leave the harness's own settle unreliable.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/shell-sidebar.html";
const REPORT = path.join(artifactsDir, "brand-logo.json");
const WINDOW = { width: 1280, height: 900 };

/** The wordmark artwork's own ink box, in its SVG's units. */
const WORDMARK_RATIO = 872.25 / 162.45;

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
 * One `getBoundingClientRect` + computed-style read of the rail's header, its
 * wordmark, and the rail's first navigation row (the content edge the wordmark
 * must share). A rule is checked against the numbers here, never inferred from
 * the markup.
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
  const toggle = header ? header.querySelector(".nav-toggle") : null;
  const brand = document.querySelector(".nav-rail__brand");
  const firstLink = document.querySelector(".nav-rail__link");
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;height:0;width:0;color:var(--fg)";
  document.body.appendChild(probe);
  const ink = getComputedStyle(probe).color;
  probe.remove();
  const style = brand ? getComputedStyle(brand) : null;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rail: box(rail),
    header: box(header),
    toggle: box(toggle),
    firstLink: box(firstLink),
    brand: brand
      ? {
          box: box(brand),
          role: brand.getAttribute("role"),
          label: brand.getAttribute("aria-label"),
          inHeader: Boolean(header && header.contains(brand)),
          display: style.display,
          background: style.backgroundColor,
          ink,
          maskImage: style.maskImage || style.webkitMaskImage,
          maskRepeat: style.maskRepeat,
          maskPosition: style.maskPosition,
          maskSize: style.maskSize
        }
      : null
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
 * The harness's own readiness promise, polled. Vite may re-optimise its
 * dependencies and reload the page mid-wait, clearing the globals the harness
 * sets, so a single read is not enough. The 90s ceiling is generous because the
 * first load of the shell on a cold dev server can spend a while optimising the
 * app's dependency graph; it still keeps a crashed harness a failure instead of
 * a hang, and stays inside the driver's own 150s watchdog.
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

/** Click the rail's own collapse toggle, through React's handler, then settle. */
const clickToggle = (win) =>
  runWithTimeout(
    win,
    `(async () => {
      const el = document.querySelector(".nav-rail .nav-toggle");
      if (!el) return false;
      el.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return true;
    })()`,
  );

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
  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: "#171614",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden window would otherwise let Chromium throttle its timers, and
      // the measured settle after the toggle click would become a coin toss.
      backgroundThrottling: false,
    },
  });
  // Keep the window alive after the report: the harness owns the page, and a
  // closed window would end the run before the summary prints.
  win.on("closed", () => {});

  let report;
  const watchdog = setTimeout(() => {
    console.error("brand-logo: timed out after 150s");
    app.exit(1);
  }, 150_000);

  try {
    step = "load the shell harness";
    await win.loadURL(url);
    const vaultName = await waitForHarness(win);
    win.setContentSize(WINDOW.width, WINDOW.height);
    await sleep(300);
    win.showInactive();

    // Pin the palette: the wordmark must be read in a known ink, not in whatever
    // skin this shared profile last wore.
    step = "pin the forge night palette";
    const applied = await runWithTimeout(
      win,
      `window.shellHarnessApplyTheme?.("forge", "dark") ?? null`,
    );
    check(
      "the harness switched to forge dark",
      applied === "forge",
      `harness resolved ${JSON.stringify(applied)}`,
    );
    await sleep(300);

    step = "measure the wide rail";
    const expanded = await sample(win);
    const brand = expanded.brand;
    check("the rail exists", Boolean(expanded.rail), "no .nav-rail in the shell");
    check(
      "the wordmark is the official wordmark file, in the rail's header",
      Boolean(brand) &&
        brand.inHeader === true &&
        brand.role === "img" &&
        brand.label === "LifeQuest",
      `brand ${JSON.stringify(brand)}`,
    );
    check(
      "the wordmark is painted as a mask of the wordmark SVG",
      Boolean(brand) &&
        typeof brand.maskImage === "string" &&
        brand.maskImage.includes("lifequest-wordmark") &&
        !brand.maskImage.includes("data:") &&
        brand.maskRepeat === "no-repeat" &&
        brand.maskSize === "contain",
      `mask ${JSON.stringify(brand?.maskImage)} repeat ${JSON.stringify(brand?.maskRepeat)} size ${JSON.stringify(brand?.maskSize)}`,
    );
    check(
      "the wordmark wears the rail's ink, not a baked-in colour",
      Boolean(brand) && brand.background === brand.ink,
      `background ${JSON.stringify(brand?.background)} vs --fg ${JSON.stringify(brand?.ink)}`,
    );
    check(
      "the wordmark keeps the artwork's aspect ratio",
      Boolean(brand) &&
        Math.abs(brand.box.width / brand.box.height - WORDMARK_RATIO) < 0.15,
      `box ${JSON.stringify(brand?.box)} ratio ${brand ? (brand.box.width / brand.box.height).toFixed(3) : "—"} vs ${WORDMARK_RATIO.toFixed(3)}`,
    );
    check(
      "the wordmark sits on the rail's content edge, before the toggle",
      Boolean(brand && expanded.firstLink && expanded.toggle) &&
        Math.abs(brand.box.left - expanded.firstLink.left) <= 1 &&
        brand.box.right < expanded.toggle.left,
      `brand ${JSON.stringify(brand?.box)} first row ${JSON.stringify(expanded.firstLink)} toggle ${JSON.stringify(expanded.toggle)}`,
    );
    check(
      "the wordmark sits inside the window strip",
      Boolean(brand && expanded.header) &&
        brand.box.top >= expanded.header.top &&
        brand.box.bottom <= expanded.header.bottom &&
        brand.box.height >= 18 &&
        brand.box.height <= 24,
      `brand ${JSON.stringify(brand?.box)} header ${JSON.stringify(expanded.header)}`,
    );

    const wideShot = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.max(1, expanded.rail?.width ?? WINDOW.width),
      height: Math.min(expanded.viewport.height, 50),
    });
    const wideFile = path.join(artifactsDir, "brand-logo-wide.png");
    fs.writeFileSync(wideFile, wideShot.toPNG());
    const shellFile = path.join(artifactsDir, "brand-logo-shell.png");
    fs.writeFileSync(shellFile, (await win.webContents.capturePage()).toPNG());

    // The ink is the rail's, not the artwork's: the same mask must be dark on a
    // day palette and light on a night one, or the wordmark would be a baked
    // cream that vanishes from the day skin. Measured on the same element, so
    // "theme-adaptive" is a pair of colours in the report rather than a claim.
    step = "read the wordmark in the day palette";
    await runWithTimeout(
      win,
      `window.shellHarnessApplyTheme?.("forge", "light") ?? null`,
    );
    await sleep(350);
    const day = await sample(win);
    check(
      "the wordmark takes the day palette's ink too",
      Boolean(day.brand && brand) &&
        day.brand.display !== "none" &&
        day.brand.background === day.brand.ink &&
        day.brand.background !== brand.ink,
      `day background ${JSON.stringify(day.brand?.background)} day --fg ${JSON.stringify(day.brand?.ink)} night --fg ${JSON.stringify(brand?.ink)}`,
    );
    // Back to the night palette so the thin artifact wears the same look as the
    // wide one.
    await runWithTimeout(
      win,
      `window.shellHarnessApplyTheme?.("forge", "dark") ?? null`,
    );
    await sleep(350);

    // The thin rail: the word cannot fit in 56px, so it leaves and the toggle
    // keeps the whole band. The rail itself must stay the icon column.
    step = "collapse the rail";
    const clicked = await clickToggle(win);
    check("the rail's collapse toggle clicked", clicked === true, "no toggle to click");
    await sleep(400);
    step = "measure the thin rail";
    const collapsed = await sample(win);
    check(
      "the thin rail is the icon column",
      Boolean(collapsed.rail) && collapsed.rail.width === 56,
      `rail ${JSON.stringify(collapsed.rail)}`,
    );
    check(
      "the thin rail leaves the wordmark out",
      Boolean(collapsed.brand) && collapsed.brand.display === "none",
      `wordmark display ${JSON.stringify(collapsed.brand?.display)}`,
    );
    check(
      "the toggle keeps the thin band, centred",
      Boolean(collapsed.header && collapsed.toggle) &&
        Math.abs(
          (collapsed.toggle.left + collapsed.toggle.right) / 2 -
            (collapsed.header.left + collapsed.header.right) / 2,
        ) <= 1,
      `toggle ${JSON.stringify(collapsed.toggle)} header ${JSON.stringify(collapsed.header)}`,
    );

    const thinShot = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.max(1, expanded.rail?.width ?? WINDOW.width),
      height: Math.min(collapsed.viewport.height, 50),
    });
    const thinFile = path.join(artifactsDir, "brand-logo-collapsed.png");
    fs.writeFileSync(thinFile, thinShot.toPNG());

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
      ranAt: new Date().toISOString(),
      vaultName,
      window: { ...WINDOW },
      expanded,
      day,
      collapsed,
      icon,
      screenshots: [wideFile, shellFile, thinFile],
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
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nwordmark ${report.expanded?.brand?.box?.width ?? "—"}x${report.expanded?.brand?.box?.height ?? "—"}px, ` +
      `ink ${report.expanded?.brand?.background ?? "—"}, ` +
      `left ${report.expanded?.brand?.box?.left ?? "—"}px vs first row ${report.expanded?.firstLink?.left ?? "—"}px`,
  );
  console.log(`app icon ${JSON.stringify(report.icon?.png ?? null)}, ico ${JSON.stringify(report.icon?.ico?.sizes ?? null)}`);
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
