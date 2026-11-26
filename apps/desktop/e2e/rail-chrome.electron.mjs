/**
 * The left sidebar's chrome, measured in the real shell harness:
 * `e2e/artifacts/rail-chrome.{json,png}`.
 *
 * WHY THIS RIG EXISTS
 *
 * Three things the operator asked to change live on the rail's chrome:
 *
 *  1. The three grouping lines — above **Chats**, above the governance shelf,
 *     above the foot. They were painted with `var(--border)`, and every skin
 *     derives `--border` from its palette; Forge's palette is steel and low embers,
 *     so all three lines read orange in the operator's default theme. The operator
 *     asked for one app-wide standard instead: each line exactly **1px** and a
 *     **neutral gray**, the same in the app whatever theme is worn — and then that
 *     the ink vary by *mode* rather than by theme: a light gray by day
 *     (`#c8c8c8`, so the line sits quietly on the paper mat) and a darker gray at
 *     night (`#3a3a3a`, so it reads on the near-black mat instead of glowing off
 *     it). Then the operator reported the three lines still looked *unequal* —
 *     "the first and third look two pixel thickness, the second one pixel" — and
 *     that report is the display scale, not the palette: a 1px `background` fill
 *     covers one or two device rows depending on its sub-pixel position once the
 *     display scale is fractional (Windows at 125% or 150%). At 125% this exact
 *     harness paints lines 1 and 3 two device rows tall and line 2 one row tall.
 *     The line is a `border-top` now, which the engine snaps to whole device
 *     pixels, so every line paints the same number of device pixels at every
 *     scale.
 *  2. The build number. It lived in the rail's "caption row" — the foot's second
 *     row, bottom-left under the Log. It now sits at the TOP of the column,
 *     directly under the LifeQuest lockup and centred on it, still the same
 *     control (click for the update dialog; glow and "Update available" label
 *     when a release is offered; hidden with the words in the thin rail).
 *  3. The square collapse toggle. It lived in that caption row too, bottom-right
 *     under the vault chip. It now holds the trailing end of the foot's one row,
 *     immediately right of the vault chip; the caption row is retired.
 *
 * WHAT IT MEASURES, AND THE WAYS IT COULD FAIL (written down before the code)
 *
 *  1. Two or four lines. The rail has exactly three grouping lines in its wide
 *     form: one above the Chats section, one above the governance shelf and one
 *     above the foot. A missing or duplicated divider fails before any colour is
 *     read — and each line must be a separate painted box in the column, ordered
 *     top to bottom, not one line measured three times.
 *  2. A different weight. Every line is a `border-top`, and the paint must be
 *     whole device pixels: `borderTopWidth × devicePixelRatio` must round to
 *     `floor(devicePixelRatio)` on every line, all three the same, so a line that
 *     is 2 device px on a 125% display (a fill on the sub-pixel grid) or shrunk
 *     by a flex contest fails. The painted rows are also counted from the
 *     capture, so a line that computes a border but still smears across two
 *     device rows fails even when the CSS looks right.
 *  3. A wrong ink. Every line's computed `border-top-color` must be the day ink
 *     (`rgb(200, 200, 200)`) in daylight and the night ink (`rgb(58, 58, 58)`) at
 *     night, its fill must be transparent (the snapped border is the only paint),
 *     and the `--divider` token must resolve to the matching hex. A skin
 *     that writes the token, a rule that falls back to `--border` (the Forge
 *     orange), or a mode that never switches the ink is caught by those reads;
 *     a separate check pins the ordering — the day ink must be lighter than the
 *     night one — so a future edit cannot quietly invert, or flatten, the pair.
 *  4. Only one theme measured. Every built-in skin is measured in both modes —
 *     Forge, Nous and Graphite, day and night — so "standard in all themes" is a
 *     table in the artifact rather than a promise. The rig only reads; the suite
 *     cross-checks the table against the skin registry, so a new skin cannot ship
 *     without being measured.
 *  5. The version back in the foot, or the toggle back under it. The header's
 *     boxes are read: the version slot must be inside the header, below the
 *     lockup's bottom edge and centred on the column within a pixel; the foot
 *     must be one row with the retired `.nav-rail__meta` gone, and the square
 *     toggle must be inside that row, right of the vault chip, on its line, and
 *     the last control in the column. These are geometry checks, not a grep of
 *     the markup: a layout that "looks right" while the version is still under
 *     the Log fails.
 *  6. A picture of a mock. The pictures are this window's own `capturePage()` of
 *     the shell harness, which mounts the REAL AppShell, providers and NavRail
 *     (`e2e/shell-sidebar.html`, the sidebar's own harness — the same one
 *     `brand-logo` reuses). The crops are the rail column, the header band and
 *     the foot band in Forge daylight, plus the collapsed column.
 *
 * Run with the dev server up (`npm run dev`), or through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/rail-chrome-e2e.test.ts`,
 * which puts the checkout's server up and restores the bench afterwards:
 *
 *   node e2e/rail-chrome.electron.mjs
 *   RAIL_DPR=1.25 node e2e/rail-chrome.electron.mjs   # the operator's scale
 *
 * `RAIL_DPR` forces a device scale factor (the rig's display is 1x, so the
 * 125%-scale defect the operator reported cannot otherwise be reproduced). That
 * run measures the divider standard alone — ink, snapped border and painted
 * device rows — and writes `rail-chrome-dpr<dpr>.json` / `-day.png`, so the
 * fractional-scale claim is a repeatable artifact of its own.
 *
 * Exit code 0 = every rail-chrome claim held. The JSON report is the repeatable
 * artifact.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeImage, nativeTheme, screen } from "electron";

// A hidden window still paints; an occluded one stops painting and stops firing
// requestAnimationFrame, which would leave the harness's own settle unreliable.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

/**
 * The device scale factor the whole app is rendered at. Unset = this display's
 * own scale (1x on the bench). Set = a forced fractional scale, which is the only
 * way to reproduce the uneven-hairline defect on a rig that runs at 100%: at 1.25
 * the shipped fill painted lines 1 and 3 two device rows tall and line 2 one row.
 */
const FORCED_DPR = process.env.RAIL_DPR ? Number(process.env.RAIL_DPR) : null;
if (FORCED_DPR) {
  // Must be set before the app is ready to reach the renderer's raster scale.
  app.commandLine.appendSwitch("force-device-scale-factor", String(FORCED_DPR));
}
const DPR_SUFFIX = FORCED_DPR ? `-dpr${String(FORCED_DPR).replace(".", "")}` : "";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
// The captures are written as they are taken, so the directory must exist before
// the first one — a fresh worktree has no `e2e/artifacts/` yet.
fs.mkdirSync(artifactsDir, { recursive: true });
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/shell-sidebar.html";
const REPORT = path.join(artifactsDir, `rail-chrome${DPR_SUFFIX}.json`);
const DAY_PNG = path.join(artifactsDir, `rail-chrome${DPR_SUFFIX}-day.png`);
const NIGHT_PNG = path.join(artifactsDir, `rail-chrome${DPR_SUFFIX}-night.png`);
const DAY_SHELL_PNG = path.join(
  artifactsDir,
  `rail-chrome${DPR_SUFFIX}-day-shell.png`,
);
const HEADER_PNG = path.join(artifactsDir, `rail-chrome${DPR_SUFFIX}-header.png`);
const FOOT_PNG = path.join(artifactsDir, `rail-chrome${DPR_SUFFIX}-foot.png`);
const COLLAPSED_PNG = path.join(
  artifactsDir,
  `rail-chrome${DPR_SUFFIX}-collapsed.png`,
);
const WINDOW = { width: 1280, height: 900 };

/**
 * The standard the operator asked for, named here so the rig can hold it.
 *
 * One neutral, carried by mode rather than by theme: a light gray in daylight so
 * the line sits quietly on the paper mat, and a darker gray at night so it reads
 * on the near-black mat instead of glowing off it. Both are the app's own ink —
 * no skin writes either.
 */
const DIVIDER_INK = { day: "#c8c8c8", night: "#3a3a3a" };
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
  // The rail's chrome around the three dividers: the header pair (lockup and the
  // build number under it) and the foot row (Log, vault chip, collapse toggle).
  const header = document.querySelector(".nav-rail__header");
  const brand = document.querySelector(".nav-rail__brand-button");
  const version = document.querySelector(".nav-rail__version");
  const badge = version ? version.querySelector(".update-badge") : null;
  const headerCollapse = document.querySelector(
    ".nav-rail__header > .nav-toggle",
  );
  const foot = document.querySelector('.nav-rail__foot[data-nav-group="footer"]');
  const footRow = foot ? foot.querySelector(".nav-rail__foot-row") : null;
  const chip = document.querySelector(".nav-rail__vault");
  const collapse = document.querySelector(
    ".nav-rail__foot-row > .nav-rail__collapse",
  );
  const metaRow = document.querySelector(".nav-rail__meta");
  const visibleRailControls = Array.from(
    document.querySelectorAll(".nav-rail button"),
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const controls = header
    ? Array.from(header.querySelectorAll("button")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
    : [];
  const dividers = Array.from(
    document.querySelectorAll(".nav-rail__divider"),
  ).map((el) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      box: box(el),
      height: r.height,
      cssHeight: style.height,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      background: style.backgroundColor,
      display: style.display,
      inRail: Boolean(rail && rail.contains(el))
    };
  });
  const controlAt = (el) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute("aria-label"),
          toggleMode: el.getAttribute("data-nav-toggle"),
          box: box(el),
          display: getComputedStyle(el).display,
          isLastControl: visibleRailControls[visibleRailControls.length - 1] === el
        }
      : null;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
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
    chrome: {
      header: header ? { box: box(header) } : null,
      brand: brand ? { box: box(brand), display: getComputedStyle(brand).display } : null,
      version: version
        ? {
            box: box(version),
            display: getComputedStyle(version).display,
            inHeader: Boolean(header && header.contains(version))
          }
        : null,
      badge: badge
        ? {
            tag: badge.tagName.toLowerCase(),
            text: (badge.textContent || "").trim(),
            box: box(badge),
            display: getComputedStyle(badge).display
          }
        : null,
      headerControls: controls.length,
      headerCollapse: controlAt(headerCollapse),
      foot: foot
        ? {
            box: box(foot),
            childCount: foot.children.length,
            display: getComputedStyle(foot).display
          }
        : null,
      footRow: footRow
        ? { box: box(footRow), direction: getComputedStyle(footRow).flexDirection }
        : null,
      chip: chip ? { box: box(chip) } : null,
      collapse: controlAt(collapse),
      metaRowRetired: metaRow === null,
      badgeInHeader: Boolean(header && badge && header.contains(badge)),
      badgeInFoot: Boolean(foot && badge && foot.contains(badge)),
      collapseInFootRow: Boolean(footRow && collapse && footRow.contains(collapse))
    },
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

/** The same ink as the three channels a captured pixel is compared against. */
const rgbChannels = (hex) => {
  const clean = (hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
};

/** WCAG relative luminance of a `#rrggbb` ink, for the day/night ordering. */
const luminanceOf = (hex) => {
  const clean = (hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return Number.NaN;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(clean.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The standard, per palette and mode: three separate lines, each painted as a
 * border (`--divider-width` of the app's mode ink, light by day and dark at
 * night, read from a token the skin did not write) whose used width the engine
 * snaps to whole device pixels — one device pixel on a 125% or 150% display, two
 * at 200%, the same number on all three lines. Returns the row the report prints
 * as a table.
 */
function checkDividers(skin, mode, state) {
  const label = `${mode}[${skin}]`;
  const expectedInk = DIVIDER_INK[mode];
  const ink = computedRgb(expectedInk);
  const dpr = state.devicePixelRatio ?? 1;
  // Chromium floors a used border width to whole device px, so the paint is
  // floor(dpr) device pixels — 1 at 125%/150%, 2 at 200%, 1 at 100%.
  const expectedDevicePx = Math.max(1, Math.floor(dpr + 1e-9));
  const paintedDevicePx = (divider) =>
    Math.round(parseFloat(divider.borderTopWidth) * dpr);
  const drawn = (state.dividers ?? []).filter(
    (divider) => divider.display !== "none" && divider.height > 0,
  );
  const transparent = "rgba(0, 0, 0, 0)";

  check(
    `${label}: the wide rail draws its three grouping lines`,
    state.shell?.navCollapsed === false && drawn.length === DIVIDER_COUNT,
    `collapsed ${state.shell?.navCollapsed}, drawn ${drawn.length} of ${(state.dividers ?? []).length}`,
  );
  check(
    `${label}: every grouping line is a snapped border, not a fill`,
    drawn.length > 0 &&
      drawn.every(
        (divider) =>
          divider.borderTopStyle === "solid" &&
          parseFloat(divider.borderTopWidth) > 0 &&
          divider.background === transparent,
      ),
    `borders ${JSON.stringify(drawn.map((d) => [d.borderTopStyle, d.borderTopWidth, d.background]))}`,
  );
  check(
    `${label}: every grouping line paints ${expectedDevicePx} device pixel(s) at DPR ${dpr}`,
    drawn.length > 0 &&
      drawn.every((divider) => paintedDevicePx(divider) === expectedDevicePx),
    `device pixels ${JSON.stringify(drawn.map((d) => [d.borderTopWidth, paintedDevicePx(d)]))}, expected ${expectedDevicePx}`,
  );
  check(
    `${label}: all three lines paint the same number of device pixels`,
    drawn.length === DIVIDER_COUNT &&
      new Set(drawn.map((divider) => paintedDevicePx(divider))).size === 1,
    `painted ${JSON.stringify(drawn.map(paintedDevicePx))}`,
  );
  check(
    `${label}: every grouping line still occupies 1px of layout`,
    drawn.length > 0 &&
      drawn.every(
        (divider) => divider.height === 1 && divider.cssHeight === DIVIDER_WIDTH,
      ),
    `heights ${JSON.stringify(drawn.map((d) => [d.height, d.cssHeight]))}`,
  );
  check(
    `${label}: every grouping line paints the ${mode} ink`,
    drawn.every(
      (divider) =>
        divider.borderTopColor === ink && divider.background === transparent,
    ),
    `border inks ${JSON.stringify(drawn.map((d) => d.borderTopColor))} vs ${ink} (${expectedInk})`,
  );
  check(
    `${label}: the divider token is the app's own, not a skin ink`,
    state.tokens?.divider === expectedInk &&
      state.tokens?.dividerWidth === DIVIDER_WIDTH,
    `token ${JSON.stringify(state.tokens?.divider)} @ ${JSON.stringify(state.tokens?.dividerWidth)}, expected ${expectedInk}`,
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
    dpr,
    paintedDevicePx: expectedDevicePx,
    lineCount: drawn.length,
    lines: drawn.map((divider) => ({
      top: divider.box?.top ?? null,
      left: divider.box?.left ?? null,
      width: divider.box?.width ?? null,
      height: divider.height,
      cssHeight: divider.cssHeight,
      borderTopWidth: divider.borderTopWidth,
      borderTopColor: divider.borderTopColor,
      background: divider.background,
      paintedDevicePx: paintedDevicePx(divider),
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

/** A 1:1 crop of one band of the rail: the header, or the foot. */
async function captureBand(win, state, { y, height }, file) {
  const width = Math.max(1, Math.min(state.rail?.box?.width ?? 260, 320) + 24);
  const top = Math.max(0, Math.round(y));
  const shot = await win.webContents.capturePage({
    x: 0,
    y: top,
    width,
    height: Math.max(1, Math.min(Math.round(height), (state.viewport?.height ?? WINDOW.height) - top)),
  });
  fs.writeFileSync(file, shot.toPNG());
  return file;
}

/**
 * How many device rows each grouping line actually paints — counted in the
 * rig's own capture of the rail column, not read from the stylesheet. This is
 * the operator's report ("the first and third look two pixel thickness, the
 * second one pixel") turned into numbers: after the fix every line must cover
 * exactly `floor(devicePixelRatio)` rows of the exact ink, with no half-covered
 * row beside it.
 *
 * A row counts as painted when at least 95% of the sampled pixels inside the
 * line's span are the expected ink; a row that is partly ink and partly mat is
 * recorded as a partial row, which is the other way a hairline smears.
 */
function scanDividerRows(file, state, mode) {
  const image = nativeImage.createFromPath(file);
  const size = image.getSize();
  const bmp = image.toBitmap(); // BGRA, row-major, top-left origin
  const cropWidth =
    Math.max(1, Math.min(state.rail?.box?.width ?? 260, 320) + 24);
  const scale = size.width / cropWidth;
  const ink = rgbChannels(DIVIDER_INK[mode]);
  const dpr = state.devicePixelRatio ?? scale;
  const drawn = (state.dividers ?? []).filter(
    (divider) => divider.display !== "none" && divider.height > 0,
  );
  const at = (x, y) => {
    const i = (y * size.width + x) * 4;
    return [bmp[i + 2], bmp[i + 1], bmp[i]]; // r, g, b
  };

  const lines = drawn.map((divider) => {
    const left = Math.max(0, Math.round(((divider.box?.left ?? 0) + 6) * scale));
    const right = Math.min(
      size.width - 1,
      Math.round(((divider.box?.right ?? 0) - 6) * scale),
    );
    const from = Math.max(
      0,
      Math.round((divider.box?.top ?? 0) * scale) - 4,
    );
    const to = Math.min(
      size.height - 1,
      Math.round((divider.box?.bottom ?? 0) * scale) + 4,
    );
    const rows = [];
    for (let y = from; y <= to; y += 1) {
      let hits = 0;
      for (let x = left; x <= right; x += 1) {
        const [r, g, b] = at(x, y);
        if (r === ink[0] && g === ink[1] && b === ink[2]) hits += 1;
      }
      const coverage = hits / Math.max(1, right - left + 1);
      if (coverage >= 0.95) rows.push({ y, coverage: 1 });
      else if (coverage > 0.05) rows.push({ y, coverage: Number(coverage.toFixed(3)) });
    }
    const full = rows.filter((row) => row.coverage === 1).map((row) => row.y);
    const partial = rows.filter((row) => row.coverage !== 1);
    return {
      top: divider.box?.top ?? null,
      paintedRows: full.length,
      rows: full,
      partialRows: partial,
    };
  });

  return {
    dpr,
    scale: Number(scale.toFixed(4)),
    expectedRows: Math.max(1, Math.floor(dpr + 1e-9)),
    lines,
  };
}

/** The pixel claim, checked per line: same rows on all three, no smear. */
function checkDividerPixels(scan, mode) {
  const expected = scan.expectedRows;
  const counts = scan.lines.map((line) => line.paintedRows);
  const partial = scan.lines.flatMap((line) => line.partialRows);
  check(
    `pixels[${mode}]: every grouping line paints ${expected} device row(s) at DPR ${scan.dpr}`,
    scan.lines.length === DIVIDER_COUNT &&
      scan.lines.every((line) => line.paintedRows === expected),
    `painted rows ${JSON.stringify(counts)}, expected ${expected}`,
  );
  check(
    `pixels[${mode}]: the three lines paint the same number of device rows`,
    new Set(counts).size === 1,
    `painted rows ${JSON.stringify(counts)}`,
  );
  check(
    `pixels[${mode}]: no line smears into a half-covered row`,
    partial.length === 0,
    `partial rows ${JSON.stringify(partial)}`,
  );
}

/**
 * The rail's chrome around the dividers. Two moves are asserted here, both from
 * the operator's own report:
 *
 *  1. The build number lives under the lockup, centred on the column — not in the
 *     foot. The badge must be a control inside the header, below the lockup's
 *     bottom edge, its centre within a pixel of the column's centre, and out of
 *     the foot entirely.
 *  2. The collapse toggle lives in the foot row, at the trailing end beside the
 *     vault chip — not in a caption row under it. The foot must be one row, the
 *     retired `.nav-rail__meta` must be gone from the DOM, the toggle must sit
 *     right of the chip and be the last control in the column.
 *
 * Only measured geometry is used; a rule that "looks right" in a screenshot but
 * moves the version into the Log's row fails here.
 */
function checkChrome(state) {
  const { chrome, rail } = state;
  const railBox = rail?.box ?? null;
  const railCentre = railBox ? railBox.left + railBox.width / 2 : Number.NaN;
  const centreOf = (b) => (b ? b.left + b.width / 2 : Number.NaN);
  const overlapsVertically = (a, b) => {
    if (!a || !b) return false;
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlap > Math.min(a.height, b.height) * 0.6;
  };

  const version = chrome?.version;
  const badge = chrome?.badge;
  const brand = chrome?.brand;
  const collapse = chrome?.collapse;
  const chip = chrome?.chip;
  const header = chrome?.header;
  const foot = chrome?.foot;

  check(
    "the version slot is in the header and visible",
    version?.inHeader === true && version?.display !== "none",
    `version ${JSON.stringify(version)}, header ${JSON.stringify(header)}`,
  );
  check(
    "the build number is a button that names the version",
    badge?.tag === "button" && /^v\d+\.\d+\.\d+$/.test(badge?.text ?? ""),
    `badge ${JSON.stringify(badge)}`,
  );
  check(
    "the version sits under the lockup",
    Boolean(version?.box && brand?.box) &&
      version.box.top >= brand.box.bottom - 1,
    `version ${JSON.stringify(version?.box)}, brand ${JSON.stringify(brand?.box)}`,
  );
  check(
    "the version is centred on the column",
    Number.isFinite(railCentre) &&
      Math.abs(centreOf(version?.box) - railCentre) <= 1,
    `version centre ${centreOf(version?.box)?.toFixed(1)} vs rail centre ${railCentre.toFixed(1)}`,
  );
  check(
    "the version is not in the foot",
    chrome?.badgeInFoot === false,
    `badgeInFoot ${JSON.stringify(chrome?.badgeInFoot)}`,
  );
  check(
    "the header holds the lockup and the build number, nothing else",
    chrome?.headerControls === 2,
    `header controls ${JSON.stringify(chrome?.headerControls)}`,
  );

  check(
    "the foot is one row",
    foot?.childCount === 1,
    `foot children ${JSON.stringify(chrome?.foot)}`,
  );
  check(
    "the retired caption row is gone",
    chrome?.metaRowRetired === true,
    `meta row retired ${JSON.stringify(chrome?.metaRowRetired)}`,
  );
  check(
    "the collapse toggle is inside the foot row",
    chrome?.collapseInFootRow === true && collapse?.display !== "none",
    `collapse ${JSON.stringify(collapse)}, in foot row ${JSON.stringify(chrome?.collapseInFootRow)}`,
  );
  check(
    "the collapse toggle sits right of the vault chip, on the same line",
    Boolean(collapse?.box && chip?.box) &&
      collapse.box.left >= chip.box.right - 1 &&
      overlapsVertically(collapse.box, chip.box),
    `toggle ${JSON.stringify(collapse?.box)}, chip ${JSON.stringify(chip?.box)}`,
  );
  check(
    "the collapse toggle is the last control in the column",
    collapse?.isLastControl === true &&
      collapse?.label === "Collapse sidebar",
    `toggle ${JSON.stringify(collapse)}`,
  );
  check(
    "the collapse toggle's box stays inside the rail's padding",
    Boolean(collapse?.box && railBox) &&
      collapse.box.right <= railBox.right - 1 &&
      collapse.box.left > railBox.left,
    `toggle ${JSON.stringify(collapse?.box)}, rail ${JSON.stringify(railBox)}`,
  );

  return {
    header: header?.box ?? null,
    brand: brand?.box ?? null,
    version: version?.box ?? null,
    versionDisplay: version?.display ?? null,
    versionInHeader: version?.inHeader ?? null,
    versionCentreOffset:
      version?.box && railBox
        ? Number((centreOf(version.box) - railCentre).toFixed(2))
        : null,
    badge: badge
      ? { text: badge.text, tag: badge.tag, box: badge.box }
      : null,
    headerControls: chrome?.headerControls ?? null,
    foot: foot?.box ?? null,
    footRows: foot?.childCount ?? null,
    footRow: chrome?.footRow?.box ?? null,
    chip: chip?.box ?? null,
    collapse: collapse
      ? { box: collapse.box, label: collapse.label, isLastControl: collapse.isLastControl }
      : null,
    metaRowRetired: chrome?.metaRowRetired ?? null,
  };
}

/** The collapsed rail: the version retires and the way back moves to the topband. */
function checkCollapsedChrome(state) {
  const { chrome } = state;
  const headerCollapse = chrome?.headerCollapse;

  check(
    "collapsed: the rail is the icon column",
    state.shell?.navCollapsed === true,
    `shell ${JSON.stringify(state.shell)}`,
  );
  check(
    "collapsed: the version retires with the words",
    chrome?.version?.display === "none",
    `version ${JSON.stringify(chrome?.version)}`,
  );
  check(
    "collapsed: the foot loses the square toggle",
    chrome?.collapse === null,
    `collapse ${JSON.stringify(chrome?.collapse)}`,
  );
  check(
    "collapsed: the way back is the Q emblem in the topband",
    Boolean(headerCollapse) &&
      headerCollapse.label === "Expand sidebar" &&
      headerCollapse.toggleMode === "brand",
    `header collapse ${JSON.stringify(headerCollapse)}`,
  );
  check(
    "collapsed: the topband holds only that emblem",
    chrome?.headerControls === 1,
    `header controls ${JSON.stringify(chrome?.headerControls)}`,
  );

  return {
    headerCollapse: headerCollapse
      ? {
          label: headerCollapse.label,
          mode: headerCollapse.toggleMode,
          box: headerCollapse.box,
        }
      : null,
    versionDisplay: chrome?.version?.display ?? null,
    footHasCollapse: chrome?.collapse !== null,
    headerControls: chrome?.headerControls ?? null,
  };
}

/** Click one element through its own handler, then let two frames settle. */
async function clickSelector(win, selector) {
  const clicked = await runWithTimeout(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
  await sleep(260);
  return clicked;
}

async function main() {
  // A hidden rig window would otherwise flash a white sheet while the shell
  // mounts; nativeTheme is the same call the shell-sidebar rig makes.
  nativeTheme.themeSource = "dark";
  // At a forced fractional scale the window must fit the display: capturePage
  // returns the visible surface, so an oversized window would crop the bottom of
  // the rail out of the artifact. `screen` reports in DIP, i.e. device pixels
  // already divided by the scale factor.
  const displaySize = screen.getPrimaryDisplay().size;
  const contentWidth = Math.max(320, Math.min(WINDOW.width, displaySize.width - 8));
  const contentHeight = Math.max(
    320,
    Math.min(WINDOW.height, displaySize.height - 8),
  );
  const win = new BrowserWindow({
    width: contentWidth,
    height: contentHeight,
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
    console.error("rail-chrome: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness(win);
    win.setContentSize(contentWidth, contentHeight);
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

    // The pair's ordering, stated once rather than only implied by the two exact
    // hexes: the day ink must be lighter than the night ink, so a future edit
    // cannot flatten the pair to one gray or invert the two.
    const dayLuminance = luminanceOf(DIVIDER_INK.day);
    const nightLuminance = luminanceOf(DIVIDER_INK.night);
    check(
      "the day ink is lighter than the night ink",
      dayLuminance > nightLuminance,
      `day ${DIVIDER_INK.day} (${dayLuminance.toFixed(4)}) vs night ${DIVIDER_INK.night} (${nightLuminance.toFixed(4)})`,
    );

    // The operator's palette, 1:1: Forge by day. The capture is the rig's own,
    // and the painted rows are counted from it — the same claim the operator
    // made by eye, turned into device rows.
    step = "capture and scan the day rail";
    await applyTheme(win, "forge", "light");
    const day = await sample(win);
    await captureRail(win, day, DAY_PNG);
    const pixelScan = scanDividerRows(DAY_PNG, day, "day");
    checkDividerPixels(pixelScan, "day");

    const standard = {
      ink: { ...DIVIDER_INK },
      rgb: {
        day: computedRgb(DIVIDER_INK.day),
        night: computedRgb(DIVIDER_INK.night),
      },
      width: DIVIDER_WIDTH,
      lines: DIVIDER_COUNT,
      token: "--divider",
      widthToken: "--divider-width",
      // The paint the operator reads as "one pixel": a used border width snapped
      // to whole device pixels, so this is the same number on all three lines at
      // any display scale (1 at 125%/150%, 2 at 200%, 1 at 100%).
      devicePixels: pixelScan.expectedRows,
      devicePixelRatio: pixelScan.dpr,
    };

    if (FORCED_DPR) {
      // A fractional-scale run measures the divider standard alone: the chrome
      // geometry tolerances are written for the 1:1 bench window, and the
      // question this run answers is what the lines paint, not where the boxes
      // sit.
      report = {
        url,
        ranAt: new Date().toISOString(),
        window: { width: contentWidth, height: contentHeight },
        forcedDeviceScaleFactor: FORCED_DPR,
        vaultName,
        standard,
        samples,
        pixelScan,
        screenshots: [DAY_PNG],
        checks,
        failures,
        pass: failures.length === 0,
      };
    } else {
      // The chrome checks run on the day sample — the layout does not depend on
      // the palette, so it is asserted once and pictured in the palette the
      // operator reported.
      step = "read the rail chrome";
      const layout = checkChrome(day);
      const dayShell = await win.webContents.capturePage();
      fs.writeFileSync(DAY_SHELL_PNG, dayShell.toPNG());
      // The two bands the operator asked to change, 1:1: the header (lockup over
      // the version) and the foot (Log, chip and the collapse square beside it).
      if (layout.header) {
        await captureBand(
          win,
          day,
          { y: 0, height: layout.header.bottom + 12 },
          HEADER_PNG,
        );
      }
      if (layout.foot) {
        await captureBand(
          win,
          day,
          { y: layout.foot.top - 12, height: layout.foot.height + 24 },
          FOOT_PNG,
        );
      }

      // Night: the day ink's darker counterpart on the dark mat, so the pair is
      // visible in the pictures and not only in the report.
      step = "capture the night rail";
      await applyTheme(win, "forge", "dark");
      const night = await sample(win);
      await captureRail(win, night, NIGHT_PNG);

      // Collapsed: the version retires with the words and the way back moves up
      // to the topband as the Q emblem. The toggle is clicked, not re-rendered by
      // hand — the same button the operator presses.
      step = "collapse the rail";
      await applyTheme(win, "forge", "light");
      check(
        "the foot's collapse toggle is the one clicked",
        await clickSelector(win, ".nav-rail__foot-row > .nav-rail__collapse"),
        "no .nav-rail__collapse in the foot row",
      );
      const collapsedState = await sample(win);
      const collapsedLayout = checkCollapsedChrome(collapsedState);
      await captureRail(win, collapsedState, COLLAPSED_PNG);
      await clickSelector(win, ".nav-rail__header > .nav-toggle");
      const restored = await sample(win);
      check(
        "expanding from the topband brings the header pair and the foot toggle back",
        restored.shell?.navCollapsed === false &&
          restored.chrome?.version?.display !== "none" &&
          restored.chrome?.collapse !== null,
        `shell ${JSON.stringify(restored.shell)}, version ${JSON.stringify(restored.chrome?.version?.display)}, collapse ${JSON.stringify(Boolean(restored.chrome?.collapse))}`,
      );

      report = {
        url,
        ranAt: new Date().toISOString(),
        window: { ...WINDOW },
        vaultName,
        standard,
        samples,
        pixelScan,
        // The two moves the operator asked for, as measured boxes: the version
        // under the lockup and the collapse toggle beside the vault chip, wide and
        // thin.
        layout: { wide: layout, collapsed: collapsedLayout },
        screenshots: [
          DAY_PNG,
          NIGHT_PNG,
          DAY_SHELL_PNG,
          HEADER_PNG,
          FOOT_PNG,
          COLLAPSED_PNG,
        ],
        checks,
        failures,
        pass: failures.length === 0,
      };
    }
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { width: contentWidth, height: contentHeight },
      forcedDeviceScaleFactor: FORCED_DPR,
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
  const rows = [["palette", "lines", "box", "device px", "ink", "token"]];
  for (const [key, sample] of Object.entries(report.samples ?? {})) {
    rows.push([
      key,
      String(sample.lineCount),
      [...new Set(sample.lines.map((line) => `${line.height}px`))].join("/"),
      [...new Set(sample.lines.map((line) => `${line.paintedDevicePx}px`))].join(
        "/",
      ),
      [...new Set(sample.lines.map((line) => line.borderTopColor))].join(" | "),
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

  // The painted rows: the pixel claim the operator made by eye, as numbers.
  if (report.pixelScan) {
    const scan = report.pixelScan;
    console.log("");
    console.log(
      `${FORCED_DPR ? `forced DPR ${FORCED_DPR}: ` : ""}painted device rows at DPR ${scan.dpr} — expected ${scan.expectedRows} per line`,
    );
    for (const [index, line] of scan.lines.entries()) {
      console.log(
        `  line ${index + 1} (top ${line.top}px): ${line.paintedRows} row(s) [${line.rows.join(", ")}], partial ${JSON.stringify(line.partialRows)}`,
      );
    }
  }

  // The two moves, printed as the measured boxes they are.
  const wide = report.layout?.wide;
  if (wide) {
    console.log("");
    console.log(
      `wide: header ${JSON.stringify(wide.header)} | brand ${JSON.stringify(wide.brand)} | version ${JSON.stringify(wide.version)} (offset ${wide.versionCentreOffset}px) | badge ${JSON.stringify(wide.badge?.text ?? null)}`,
    );
    console.log(
      `wide: foot ${JSON.stringify(wide.foot)} | rows ${wide.footRows} | chip ${JSON.stringify(wide.chip)} | collapse ${JSON.stringify(wide.collapse)} | caption row retired ${wide.metaRowRetired}`,
    );
  }
  if (report.layout?.collapsed) {
    console.log(`collapsed: ${JSON.stringify(report.layout.collapsed)}`);
  }

  console.log("");
  console.log(`report: ${REPORT}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "rail chrome: PASS" : "rail chrome: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`rail-chrome: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
