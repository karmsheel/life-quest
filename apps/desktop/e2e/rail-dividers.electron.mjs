/**
 * The left sidebar's three grouping lines, measured in the real shell harness:
 * `e2e/artifacts/rail-dividers.{json,png}`.
 *
 * WHY THIS RIG EXISTS
 *
 * The rail draws three horizontal lines — above **Chats**, above the governance
 * shelf, above the foot. They were painted with `var(--border)`, and every skin
 * derives `--border` from its palette; Forge's palette is steel and low embers,
 * so all three lines read orange in the operator's default theme. The operator
 * asked for one app-wide standard instead: each line exactly **1px** and a
 * **medium gray** (`#808080`), the same in the app whatever theme is worn.
 *
 * WHAT IT MEASURES, AND THE WAYS IT COULD FAIL (written down before the code)
 *
 *  1. Two or four lines. The rail has exactly three grouping lines in its wide
 *     form: one above the Chats section, one above the governance shelf and one
 *     above the foot. A missing or duplicated divider fails before any colour is
 *     read — and each line must be a separate painted box in the column, ordered
 *     top to bottom, not one line measured three times.
 *  2. A different weight. Every line's painted box and computed `height` must be
 *     exactly 1px, and all three must be equal to each other, so a line that is
 *     2px, 0.8px or shrunk by a flex contest fails.
 *  3. A palette-tinted ink. Every line's computed background must be
 *     `rgb(128, 128, 128)` — the medium gray the operator asked for — and the
 *     `--divider` token it reads must resolve to `#808080`. A skin that writes
 *     the token, or a rule that falls back to `--border` (the Forge orange), is
 *     caught by those two reads together.
 *  4. Only one theme measured. Every built-in skin is measured in both modes —
 *     Forge, Nous and Graphite, day and night — so "standard in all themes" is a
 *     table in the artifact rather than a promise. The rig only reads; it is the
 *     suite that cross-checks the table against the skin registry, so a new skin
 *     cannot ship without being measured.
 *  5. A picture of a mock. The picture is this window's own `capturePage()` of
 *     the shell harness, which mounts the REAL AppShell, providers and NavRail
 *     (`e2e/shell-sidebar.html`, the sidebar's own harness — the same one
 *     `brand-logo` reuses). The crop is the rail column in Forge daylight, the
 *     palette the operator reported.
 *
 * Run with the dev server up (`npm run dev`), or through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/rail-dividers-e2e.test.ts`,
 * which puts the checkout's server up and restores the bench afterwards:
 *
 *   node e2e/rail-dividers.electron.mjs
 *
 * Exit code 0 = every divider held. The JSON report is the repeatable artifact.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// A hidden window still paints; an occluded one stops painting and stops firing
// requestAnimationFrame, which would leave the harness's own settle unreliable.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/shell-sidebar.html";
const REPORT = path.join(artifactsDir, "rail-dividers.json");
const DAY_PNG = path.join(artifactsDir, "rail-dividers-day.png");
const NIGHT_PNG = path.join(artifactsDir, "rail-dividers-night.png");
const DAY_SHELL_PNG = path.join(artifactsDir, "rail-dividers-day-shell.png");
const WINDOW = { width: 1280, height: 900 };

/** The standard the operator asked for, named here so the rig can hold it. */
const DIVIDER_INK = "#808080";
const DIVIDER_RGB = "rgb(128, 128, 128)";
const DIVIDER_WIDTH = "1px";
const DIVIDER_COUNT = 3;

/**
 * Every built-in skin, in both modes. Named rather than discovered so a run
 * measures a fixed set; the suite cross-checks this list against the skin
 * registry, so a new skin cannot land without being measured.
 */
const SKINS = ["forge", "nous", "graphite"];
const MODES = ["day", "night"];
const MODE_ATTR = { day: "light", night: "dark" };

const failures = [];
const checks = [];
let step = "boot";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const check = (label, condition, detail) => {
  const pass = Boolean(condition);
  checks.push({ label, pass, detail: detail ?? null });
  if (pass) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(`  FAIL ${label} — ${detail}`);
  failures.push(`${label}: ${detail}`);
};

/**
 * The rail's grouping lines as the engine paints them: one record per
 * `.nav-rail__divider`, plus the two tokens they read and the theme that is on.
 * Nothing is inferred from the markup — every claim is checked against these
 * computed numbers.
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
  const root = getComputedStyle(document.documentElement);
  const rail = document.querySelector(".nav-rail");
  const shell = document.querySelector(".shell");
  const dividers = Array.from(
    document.querySelectorAll(".nav-rail__divider"),
  ).map((el) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      box: box(el),
      height: r.height,
      cssHeight: style.height,
      background: style.backgroundColor,
      display: style.display,
      inRail: Boolean(rail && rail.contains(el))
    };
  });
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      skin: document.documentElement.getAttribute("data-skin")
    },
    tokens: {
      divider: root.getPropertyValue("--divider").trim(),
      dividerWidth: root.getPropertyValue("--divider-width").trim()
    },
    shell: shell
      ? {
          className: shell.className,
          navCollapsed: shell.classList.contains("shell--nav-collapsed")
        }
      : null,
    rail: rail
      ? { box: box(rail), display: getComputedStyle(rail).display }
      : null,
    dividers
  };
})()`;

const run = (win, expression) =>
  win.webContents.executeJavaScript(expression, true);

const runWithTimeout = (win, expression, timeoutMs = 10_000) =>
  Promise.race([
    run(win, expression),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("evaluate timed out")), timeoutMs),
    ),
  ]);

/** Poll the harness globals: Vite may reload the page while the module lands. */
async function waitForHarness(win, timeoutMs = 30_000) {
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
  await sleep(260);
}

const sample = async (win) => {
  const state = await runWithTimeout(win, SAMPLE);
  if (!state) throw new Error("the shell returned no sample");
  return state;
};

const computedRgb = (hex) => {
  const clean = (hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

/**
 * The standard, per palette and mode: three separate lines, each exactly 1px,
 * each the app's medium gray, read from a token the skin did not write.
 * Returns the row the report prints as a table.
 */
function checkDividers(skin, mode, state) {
  const label = `${mode}[${skin}]`;
  const ink = computedRgb(DIVIDER_INK);
  const drawn = (state.dividers ?? []).filter(
    (divider) => divider.display !== "none" && divider.height > 0,
  );

  check(
    `${label}: the wide rail draws its three grouping lines`,
    state.shell?.navCollapsed === false && drawn.length === DIVIDER_COUNT,
    `collapsed ${state.shell?.navCollapsed}, drawn ${drawn.length} of ${(state.dividers ?? []).length}`,
  );
  check(
    `${label}: every grouping line is exactly 1px`,
    drawn.length > 0 &&
      drawn.every(
        (divider) => divider.height === 1 && divider.cssHeight === DIVIDER_WIDTH,
      ),
    `heights ${JSON.stringify(drawn.map((d) => [d.height, d.cssHeight]))}`,
  );
  check(
    `${label}: all three lines are the same thickness`,
    new Set(drawn.map((divider) => divider.height)).size === 1 &&
      new Set(drawn.map((divider) => divider.cssHeight)).size === 1,
    `painted ${JSON.stringify(drawn.map((d) => d.height))}, computed ${JSON.stringify(drawn.map((d) => d.cssHeight))}`,
  );
  check(
    `${label}: every grouping line paints the standard medium gray`,
    drawn.every((divider) => divider.background === ink),
    `inks ${JSON.stringify(drawn.map((d) => d.background))} vs ${ink}`,
  );
  check(
    `${label}: the divider token is the app's own, not a skin ink`,
    state.tokens?.divider === DIVIDER_INK &&
      state.tokens?.dividerWidth === DIVIDER_WIDTH,
    `token ${JSON.stringify(state.tokens?.divider)} @ ${JSON.stringify(state.tokens?.dividerWidth)}`,
  );
  check(
    `${label}: every grouping line lives in the rail column`,
    drawn.every((divider) => divider.inRail === true),
    `inRail ${JSON.stringify(drawn.map((d) => d.inRail))}`,
  );

  // Three different horizontal lines, top to bottom — not one bar counted thrice.
  const tops = drawn.map((divider) => divider.box?.top);
  const ordered =
    tops.every((top) => typeof top === "number") &&
    tops.every((top, index) => index === 0 || top > tops[index - 1]);
  check(
    `${label}: the lines are three distinct lines, top to bottom`,
    ordered && new Set(tops).size === DIVIDER_COUNT,
    `tops ${JSON.stringify(tops)}`,
  );

  return {
    theme: state.theme,
    tokens: state.tokens,
    lineCount: drawn.length,
    lines: drawn.map((divider) => ({
      top: divider.box?.top ?? null,
      left: divider.box?.left ?? null,
      width: divider.box?.width ?? null,
      height: divider.height,
      background: divider.background,
    })),
  };
}

/** A 1:1 crop of the rail column: the artifact the operator can open. */
async function captureRail(win, state, file) {
  const width = Math.max(1, Math.min(state.rail?.box?.width ?? 260, 320) + 24);
  const height = Math.max(1, state.viewport?.height ?? WINDOW.height);
  const shot = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width,
    height,
  });
  fs.writeFileSync(file, shot.toPNG());
  return file;
}

async function main() {
  // A hidden rig window would otherwise flash a white sheet while the shell
  // mounts; nativeTheme is the same call the shell-sidebar rig makes.
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  let report;
  const timeout = setTimeout(() => {
    console.error("rail-dividers: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness(win);
    win.setContentSize(WINDOW.width, WINDOW.height);
    await sleep(320);
    win.showInactive();

    const samples = {};
    for (const mode of MODES) {
      for (const skin of SKINS) {
        step = `read ${skin} ${mode}`;
        await applyTheme(win, skin, MODE_ATTR[mode]);
        const state = await sample(win);
        check(
          `${mode}[${skin}]: the harness painted the palette it was told to`,
          state.theme?.dataTheme === MODE_ATTR[mode] &&
            state.theme?.skin === skin,
          `data-theme ${JSON.stringify(state.theme?.dataTheme)}, data-skin ${JSON.stringify(state.theme?.skin)}`,
        );
        samples[`${mode}:${skin}`] = checkDividers(skin, mode, state);
      }
    }

    // The operator's palette, 1:1: Forge by day, the rail column with its three
    // lines, plus the whole window for context.
    step = "capture the day rail";
    await applyTheme(win, "forge", "light");
    const day = await sample(win);
    await captureRail(win, day, DAY_PNG);
    const dayShell = await win.webContents.capturePage();
    fs.writeFileSync(DAY_SHELL_PNG, dayShell.toPNG());

    // And the same rail at night, so the standard is visibly the same ink on the
    // dark mat rather than only a number in the report.
    step = "capture the night rail";
    await applyTheme(win, "forge", "dark");
    const night = await sample(win);
    await captureRail(win, night, NIGHT_PNG);

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...WINDOW },
      vaultName,
      standard: {
        ink: DIVIDER_INK,
        rgb: DIVIDER_RGB,
        width: DIVIDER_WIDTH,
        lines: DIVIDER_COUNT,
        token: "--divider",
        widthToken: "--divider-width",
      },
      samples,
      screenshots: [DAY_PNG, NIGHT_PNG, DAY_SHELL_PNG],
      checks,
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
    clearTimeout(timeout);
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  // The standard as a table: one row per palette and mode, the numbers the
  // operator can read without opening the JSON.
  const rows = [["palette", "lines", "heights", "ink", "token"]];
  for (const [key, sample] of Object.entries(report.samples ?? {})) {
    rows.push([
      key,
      String(sample.lineCount),
      [...new Set(sample.lines.map((line) => `${line.height}px`))].join("/"),
      [...new Set(sample.lines.map((line) => line.background))].join(" | "),
      `${sample.tokens?.divider} @ ${sample.tokens?.dividerWidth}`,
    ]);
  }
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => row[i].length)),
  );
  console.log("");
  for (const row of rows) {
    console.log(row.map((value, i) => value.padEnd(widths[i])).join("  "));
  }

  console.log("");
  console.log(`report: ${REPORT}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "rail dividers: PASS" : "rail dividers: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`rail-dividers: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
