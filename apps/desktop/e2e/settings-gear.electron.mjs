/**
 * Drives the titlebar's settings gear in a real Electron window and turns the
 * measurements into `e2e/artifacts/settings-gear.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/settings-gear.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: the same presses, the same readings, no eyeballing the app
 * required.
 *
 * What it proves: the gear is a link to the settings sheet and nothing else. It
 * opens the whole sheet — every tab and the search field, not a slimmed-down
 * popover — over the page the operator was on, and it leaves the day/night
 * control's theme quick menu where it was.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/settings-gear.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const attr = (el, name) => (el ? el.getAttribute(name) : null);

  const gear = document.querySelector(".settings-menu__trigger");
  const overlay = document.querySelector("[data-settings-overlay]");
  const panel = document.querySelector(".settings-overlay__panel");
  const nav = Array.from(document.querySelectorAll(".settings-nav-item")).map((el) =>
    text(el.querySelector(".settings-nav-item__label"))
  );
  const quickMenu = document.querySelector(".theme-quick-menu__popover");

  return {
    path: document.body.dataset.rigPath || null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    backgroundPage: Boolean(document.querySelector('[data-rig-page="home"]')),
    overlay: Boolean(overlay),
    panelPresent: Boolean(panel),
    nav,
    searchPresent: Boolean(document.querySelector(".settings-overlay__search-input")),
    quickMenuOpen: Boolean(quickMenu),
    gear: gear
      ? {
          tag: gear.tagName,
          href: attr(gear, "href"),
          label: attr(gear, "aria-label"),
          title: attr(gear, "title"),
          hasPopup: attr(gear, "aria-haspopup"),
          expanded: attr(gear, "aria-expanded"),
          inTitlebar: Boolean(
            document.querySelector(".window-titlebar__trailing")?.contains(gear)
          )
        }
      : null,
    // A popover of the gear's own: the quick menu it used to open. The theme
    // quick menu under the day/night control wears a different class, so this
    // selector finds only the old one.
    gearPopover: Boolean(
      document.querySelector(".settings-menu__popover:not(.theme-quick-menu__popover)")
    ),
    themeControlPresent: Boolean(
      document.querySelector(".window-titlebar__trailing .theme-mode-toggle")
    )
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // A rig runs on a real desktop: paint it in the theme the app itself defaults
  // to, so a run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // This rig shares the dev-server origin with every other rig, so it takes
      // a session of its own rather than reading their localStorage.
      partition: "settings-gear",
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
          if (typeof window.settingsGearReady !== "object") return null;
          await window.settingsGearReady;
          return typeof window.settingsGearVaultName === "string"
            ? window.settingsGearVaultName
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

  const shot = async (name) => {
    await frames();
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `settings-gear-${name}`);
    fs.writeFileSync(file, image.toPNG());
    if (!screenshots.includes(path.basename(file))) screenshots.push(path.basename(file));
    return path.basename(file);
  };

  /** A real press on the gear, so the browser follows the link itself. */
  const pressGear = async () => {
    const point = await run(`(() => {
      const el = document.querySelector(".settings-menu__trigger");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error("no settings gear to press");
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    });
  };

  /** A real rest on the day/night control, so its quick menu opens. */
  const hoverThemeControl = async () => {
    const point = await run(`(() => {
      const el = document.querySelector(".theme-mode-toggle");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error("no day/night control to hover");
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
    await sleep(300);
  };

  /** Take the pointer off the control and its menu, so the menu closes. */
  const parkPointer = async () => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
    await sleep(340);
  };

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    states,
    steps,
    screenshots,
    failures,
    pass: false,
  };

  let timer = null;
  try {
    timer = setTimeout(() => {
      console.error("settings-gear: timed out after 90s");
      app.exit(1);
    }, 90_000);

    await win.loadURL(url);
    await waitForHarness();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();

    // —— 1 — the resting strip: the gear is a link, and no menu is up.
    at("the gear is a link");
    const landing = await settle();
    states.landing = landing;
    check(
      "the gear is an anchor to /settings",
      landing.gear?.tag === "A" && landing.gear?.href === "/settings",
      `gear ${JSON.stringify(landing.gear)}`,
    );
    check(
      "the gear says what it is",
      landing.gear?.label === "Open settings" && landing.gear?.title === "Settings",
      `gear ${JSON.stringify(landing.gear)}`,
    );
    check(
      "the gear does not announce a menu",
      landing.gear?.hasPopup === null && landing.gear?.expanded === null,
      `gear ${JSON.stringify(landing.gear)}`,
    );
    check(
      "the gear sits in the titlebar's trailing cluster",
      landing.gear?.inTitlebar === true,
      `gear ${JSON.stringify(landing.gear)}`,
    );
    check(
      "no settings sheet and no gear popover on arrival",
      landing.overlay === false && landing.gearPopover === false,
      `overlay ${landing.overlay}, popover ${landing.gearPopover}`,
    );
    check(
      "the day/night control is still in the strip",
      landing.themeControlPresent === true,
      `titlebar ${JSON.stringify(landing)}`,
    );
    await shot("resting.png");

    // —— 2 — the day/night control still owns the theme quick menu. Checked
    //        before the gear is pressed, because the settings sheet's scrim
    //        covers the strip once it is up.
    at("the theme quick menu moved to the day/night control");
    await hoverThemeControl();
    const themed = await settle();
    states.themed = themed;
    check(
      "hovering the day/night control opens its quick menu",
      themed.quickMenuOpen === true,
      `quick menu ${themed.quickMenuOpen}`,
    );
    check(
      "the quick menu is not the gear's",
      themed.gearPopover === false,
      `popover ${themed.gearPopover}`,
    );
    await shot("theme-quick-menu.png");

    // —— 3 — pressing the gear opens the whole settings sheet over the page.
    at("the gear opens the settings sheet");
    await parkPointer();
    await pressGear();
    const opened = await settle(400);
    states.opened = opened;
    check(
      "the gear navigates to /settings",
      opened.path === "/settings",
      `path ${opened.path}`,
    );
    check(
      "the settings sheet is up",
      opened.overlay === true && opened.panelPresent === true,
      `overlay ${opened.overlay}, panel ${opened.panelPresent}`,
    );
    check(
      "the sheet is the full one: every tab and the search field",
      opened.nav.length > 1 && opened.searchPresent === true,
      `nav ${JSON.stringify(opened.nav)}, search ${opened.searchPresent}`,
    );
    check(
      "the gear opens no popover of its own",
      opened.gearPopover === false,
      `popover ${opened.gearPopover}`,
    );
    check(
      "the page behind the sheet is still mounted",
      opened.backgroundPage === true,
      `background ${opened.backgroundPage}`,
    );
    await shot("sheet.png");

    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "settings-gear.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["state", "path", "sheet", "gear", "quick menu"]];
  for (const [name, state] of Object.entries(states)) {
    table.push([
      name,
      state?.path ?? "—",
      state?.overlay ? "open" : "closed",
      state?.gear?.href ?? "—",
      state?.quickMenuOpen ? "open" : "closed",
    ]);
  }
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => String(row[i]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "settings gear: PASS" : "settings gear: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(
      `settings-gear: ${error instanceof Error ? error.stack : error}`,
    );
    app.exit(1);
  });
