import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BUILTIN_SKIN_LIST,
  filterSkinsForMode,
} from "../src/lib/themes/presets.ts";

/**
 * The left sidebar's three grouping lines: exactly one device pixel of the app's
 * neutral divider ink, the same in every built-in theme at each mode's own
 * weight — a light gray by day (`#c8c8c8`) so the line sits quietly on the paper
 * mat, and a darker gray at night (`#3a3a3a`) so it reads on the near-black mat
 * instead of glowing off it.
 *
 * The driver (`e2e/rail-chrome.electron.mjs`) mounts the real shell harness in
 * a real Electron window and reads the computed ink and the painted device rows
 * of every `.nav-rail__divider` in six palettes. This suite runs that driver and
 * then restates the claims over the artifact, so a regression names the palette
 * and the number it broke rather than only failing inside the driver.
 *
 * The line is drawn as a `border-top` because the engine snaps a used border
 * width to whole device pixels; a 1px `background` fill covers one or two device
 * rows depending on its sub-pixel position once the display scale is fractional.
 * The driver is therefore run twice: once at the bench's own scale, and once with
 * `RAIL_DPR=1.25` — the scale the operator's Windows machine runs at, where the
 * fill painted the first and third lines two device rows tall and the middle one
 * one. The 125% run asserts the painted rows, so "all three look the same
 * thickness" is measured at the scale the defect appeared.
 *
 * A skipped rig is evidence of nothing, so this test skips only when the Vite
 * dev server is not listening on 5173; run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/rail-chrome-e2e.test.ts`,
 * which puts that server up under a throwaway profile and restores the bench.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/rail-chrome.electron.mjs");
const REPORT = path.join(ARTIFACTS, "rail-chrome.json");
/**
 * The scale the operator's Windows machine runs at. The bench is a 1x display, so
 * this is forced through Electron; at 125% a 1px background fill covered one or
 * two device rows depending on its sub-pixel position, which is exactly the
 * uneven-three-lines report this run pins.
 */
const OPERATOR_DPR = 1.25;
const DPR_REPORT = path.join(ARTIFACTS, "rail-chrome-dpr125.json");

/**
 * The standard the operator asked for: one device pixel, carried by mode rather
 * than theme. The day ink must be lighter than the night ink — that ordering is
 * asserted below, so a future edit cannot flatten the pair or invert it.
 */
const DIVIDER_INK = { day: "#c8c8c8", night: "#3a3a3a" };
const DIVIDER_RGB = { day: "rgb(200, 200, 200)", night: "rgb(58, 58, 58)" };
const DIVIDER_WIDTH = "1px";
const DIVIDER_COUNT = 3;
const TRANSPARENT = "rgba(0, 0, 0, 0)";
/** A picture smaller than its floor is a blank frame, not the shipped chrome. */
const SCREENSHOTS: Record<string, number> = {
  "rail-chrome-day.png": 4 * 1024,
  "rail-chrome-night.png": 4 * 1024,
  "rail-chrome-day-shell.png": 10 * 1024,
  "rail-chrome-collapsed.png": 4 * 1024,
  // The header and foot bands are flat plates (a lockup, a version, three foot
  // cells): a correct 280px-wide crop is only ~3 KB, so the floor is lower — a
  // blank band of the same size still falls under it.
  "rail-chrome-header.png": 1.5 * 1024,
  "rail-chrome-foot.png": 1.5 * 1024,
};
/** The 125%-scale run's own rail crop, in device pixels. */
const DPR_SCREENSHOT = { name: "rail-chrome-dpr125-day.png", floor: 8 * 1024 };

type DividerLine = {
  top: number | null;
  left: number | null;
  width: number | null;
  height: number;
  cssHeight: string;
  borderTopWidth: string;
  borderTopColor: string;
  background: string;
  /** `borderTopWidth × dpr`, rounded: the rows this line should paint. */
  paintedDevicePx: number;
};

type DividerSample = {
  theme: { dataTheme: string | null; skin: string | null };
  tokens: { divider: string; dividerWidth: string };
  dpr: number;
  paintedDevicePx: number;
  lineCount: number;
  lines: DividerLine[];
};

/** The rows each line actually painted, counted in the rig's own capture. */
type PixelScanLine = {
  top: number | null;
  paintedRows: number;
  rows: number[];
  partialRows: { y: number; coverage: number }[];
};

type PixelScan = {
  dpr: number;
  scale: number;
  expectedRows: number;
  lines: PixelScanLine[];
};

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** The two moves, as the driver measured them in Forge daylight. */
type ChromeLayout = {
  header: Box | null;
  brand: Box | null;
  version: Box | null;
  versionDisplay: string | null;
  versionInHeader: boolean | null;
  versionCentreOffset: number | null;
  badge: { text: string; tag: string; box: Box | null } | null;
  headerControls: number | null;
  foot: Box | null;
  footRows: number | null;
  footRow: Box | null;
  chip: Box | null;
  collapse: {
    box: Box | null;
    label: string | null;
    isLastControl: boolean;
  } | null;
  metaRowRetired: boolean | null;
};

type CollapsedLayout = {
  headerCollapse: { label: string | null; mode: string | null; box: Box | null } | null;
  versionDisplay: string | null;
  footHasCollapse: boolean;
  headerControls: number | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  url: string;
  vaultName: string | null;
  forcedDeviceScaleFactor?: number | null;
  standard: {
    ink: { day: string; night: string };
    rgb: { day: string; night: string };
    width: string;
    lines: number;
    token: string;
    widthToken: string;
    devicePixels: number;
    devicePixelRatio: number;
  };
  samples: Record<string, DividerSample>;
  pixelScan: PixelScan;
  layout?: { wide: ChromeLayout; collapsed: CollapsedLayout };
  screenshots: string[];
};

/** WCAG relative luminance of a `#rrggbb` ink, for the day/night ordering. */
function luminanceOf(hex: string): number {
  const clean = hex.trim().replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(clean.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

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

function runDriver(env: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 150_000, env: { ...process.env, ...env } },
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

/** Run the driver and read its report, failing loudly if it wrote none. */
async function runAndRead(
  file: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Report> {
  fs.rmSync(file, { force: true });
  const exitCode = await runDriver(env);
  assert.equal(
    fs.existsSync(file),
    true,
    `driver wrote no report artifact (${path.basename(file)})`,
  );
  const report = JSON.parse(fs.readFileSync(file, "utf8")) as Report;
  // The driver's own failures first: a report that threw before the first
  // sample has no measurements, and destructuring it would hide that.
  assert.deepEqual(report.failures, []);
  assert.equal(exitCode, 0, "driver exited non-zero");
  assert.equal(report.pass, true);
  return report;
}

describe("rail chrome (dividers, header, foot)", () => {
  it("draws the sidebar's three grouping lines at 1px of the mode's ink in every palette", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    const report = await runAndRead(REPORT);

    // The standard is named in the artifact, not just satisfied implicitly — and
    // the pair's ordering is restated from its own inks: the day ink is lighter
    // than the night ink, so a future edit cannot flatten the two or invert them.
    assert.deepEqual(
      {
        ink: report.standard.ink,
        rgb: report.standard.rgb,
        width: report.standard.width,
        lines: report.standard.lines,
        token: report.standard.token,
        widthToken: report.standard.widthToken,
      },
      {
        ink: DIVIDER_INK,
        rgb: DIVIDER_RGB,
        width: DIVIDER_WIDTH,
        lines: DIVIDER_COUNT,
        token: "--divider",
        widthToken: "--divider-width",
      },
    );
    // The paint is a whole number of device pixels per line: one at 100%, two at
    // 200%. A rule that paints a fractional amount is the bug this rig exists for.
    assert.equal(
      report.standard.devicePixels,
      Math.max(1, Math.floor(report.standard.devicePixelRatio)),
      `the standard claims ${report.standard.devicePixels} painted device px at DPR ${report.standard.devicePixelRatio}`,
    );
    assert.ok(
      luminanceOf(report.standard.ink.day) >
        luminanceOf(report.standard.ink.night),
      `the day divider ink (${report.standard.ink.day}, ${luminanceOf(report.standard.ink.day).toFixed(4)}) is not lighter than the night ink (${report.standard.ink.night}, ${luminanceOf(report.standard.ink.night).toFixed(4)})`,
    );

    // The rows the driver counted in its own capture: every line paints the same
    // whole number of device rows, with no half-covered row beside it.
    assert.equal(
      report.pixelScan.lines.length,
      DIVIDER_COUNT,
      `the capture holds ${report.pixelScan.lines.length} line scans`,
    );
    assert.equal(
      report.pixelScan.expectedRows,
      Math.max(1, Math.floor(report.pixelScan.dpr)),
      `the scan expected ${report.pixelScan.expectedRows} device rows at DPR ${report.pixelScan.dpr}`,
    );
    for (const [index, line] of report.pixelScan.lines.entries()) {
      assert.equal(
        line.paintedRows,
        report.pixelScan.expectedRows,
        `line ${index + 1} painted ${line.paintedRows} device row(s) (${JSON.stringify(line.rows)}), expected ${report.pixelScan.expectedRows}`,
      );
      assert.deepEqual(
        line.partialRows,
        [],
        `line ${index + 1} smeared into a partial row: ${JSON.stringify(line.partialRows)}`,
      );
    }

    // Every built-in skin in both modes — cross-checked against the registry, so
    // a new skin cannot ship without being measured. "All themes" is only true
    // if the table has a row for every one of them.
    const darkSkins = filterSkinsForMode(BUILTIN_SKIN_LIST, "dark")
      .map((skin) => skin.name)
      .sort();
    const lightSkins = filterSkinsForMode(BUILTIN_SKIN_LIST, "light")
      .map((skin) => skin.name)
      .sort();
    const expectedKeys = [
      ...darkSkins.map((name) => `night:${name}`),
      ...lightSkins.map((name) => `day:${name}`),
    ].sort();
    assert.deepEqual(
      Object.keys(report.samples).sort(),
      expectedKeys,
      "the sweep did not cover every skin in both modes",
    );

    // The ink is carried by the mode, not by the palette: every theme in a mode
    // must paint the same border colour.
    for (const mode of ["day", "night"] as const) {
      const inks = new Set(
        (mode === "day" ? lightSkins : darkSkins).flatMap((name) =>
          report.samples[`${mode}:${name}`].lines.map(
            (line) => line.borderTopColor,
          ),
        ),
      );
      assert.deepEqual(
        [...inks],
        [DIVIDER_RGB[mode]],
        `${mode}: the themes do not share one divider ink (${JSON.stringify([...inks])})`,
      );
    }

    for (const mode of ["day", "night"] as const) {
      const expectedInk = DIVIDER_INK[mode];
      const expectedRgb = DIVIDER_RGB[mode];
      for (const name of mode === "day" ? lightSkins : darkSkins) {
        const sample = report.samples[`${mode}:${name}`];
        assert.ok(sample, `${mode}[${name}]: no sample in the report`);
        assert.equal(
          sample.theme.dataTheme,
          mode === "day" ? "light" : "dark",
          `${mode}[${name}]: measured in the wrong mode (${sample.theme.dataTheme})`,
        );

        // The ink is the app's own mode token, and no skin wrote it.
        assert.equal(
          sample.tokens.divider,
          expectedInk,
          `${mode}[${name}]: --divider resolved to ${JSON.stringify(sample.tokens.divider)}, expected the ${mode} ink ${expectedInk}`,
        );
        assert.equal(
          sample.tokens.dividerWidth,
          DIVIDER_WIDTH,
          `${mode}[${name}]: --divider-width resolved to ${JSON.stringify(sample.tokens.dividerWidth)}`,
        );

        // Three lines, each a snapped border of the mode's ink, each still
        // occupying 1px of layout.
        assert.equal(
          sample.lineCount,
          DIVIDER_COUNT,
          `${mode}[${name}]: the wide rail drew ${sample.lineCount} grouping lines`,
        );
        assert.equal(
          sample.lines.length,
          DIVIDER_COUNT,
          `${mode}[${name}]: the report holds ${sample.lines.length} line readings`,
        );
        for (const line of sample.lines) {
          assert.equal(
            line.height,
            1,
            `${mode}[${name}]: a grouping line is ${line.height}px of layout, not 1px`,
          );
          assert.equal(
            line.cssHeight,
            DIVIDER_WIDTH,
            `${mode}[${name}]: a grouping line's computed height is ${line.cssHeight}`,
          );
          assert.equal(
            line.borderTopColor,
            expectedRgb,
            `${mode}[${name}]: a grouping line paints the border ${line.borderTopColor} — a palette ink leaked into the divider (expected ${expectedRgb}, the ${mode} ink ${expectedInk})`,
          );
          assert.equal(
            line.background,
            TRANSPARENT,
            `${mode}[${name}]: a grouping line still has a background fill (${line.background}) — the snapped border must be its only paint`,
          );
          assert.equal(
            line.paintedDevicePx,
            sample.paintedDevicePx,
            `${mode}[${name}]: a grouping line paints ${line.paintedDevicePx} device px (${line.borderTopWidth} at DPR ${sample.dpr})`,
          );
        }
        assert.equal(
          new Set(sample.lines.map((line) => line.height)).size,
          1,
          `${mode}[${name}]: the three lines are not the same thickness (${JSON.stringify(sample.lines.map((line) => line.height))})`,
        );
        assert.equal(
          new Set(sample.lines.map((line) => line.paintedDevicePx)).size,
          1,
          `${mode}[${name}]: the three lines paint a different number of device pixels (${JSON.stringify(sample.lines.map((line) => line.paintedDevicePx))})`,
        );

        // Three distinct lines in the column, top to bottom.
        const tops = sample.lines.map((line) => line.top);
        assert.equal(
          tops.every((top) => typeof top === "number"),
          true,
          `${mode}[${name}]: a grouping line has no painted top edge (${JSON.stringify(tops)})`,
        );
        assert.deepEqual(
          [...tops].sort((a, b) => (a as number) - (b as number)),
          tops,
          `${mode}[${name}]: the grouping lines are not ordered top to bottom (${JSON.stringify(tops)})`,
        );
        assert.equal(
          new Set(tops).size,
          DIVIDER_COUNT,
          `${mode}[${name}]: two grouping lines share a top edge (${JSON.stringify(tops)})`,
        );
      }
    }

    // The two moves the operator asked for, restated from the driver's boxes.
    // These are geometry claims, not a grep of the markup: a version that is
    // still under the Log, or a toggle still under the chip, fails here.
    assert.ok(report.layout, "the 1x driver wrote no chrome layout");
    const wide = report.layout.wide;
    assert.ok(wide.header, "the rail rendered no header");
    assert.equal(
      wide.versionInHeader,
      true,
      "the build number is not inside the rail's header",
    );
    assert.notEqual(
      wide.versionDisplay,
      "none",
      "the wide rail hides the build number",
    );
    assert.ok(wide.version, "the header holds no version slot");
    assert.ok(wide.brand, "the header holds no lockup");
    assert.ok(
      wide.version.top >= wide.brand.bottom - 1,
      `the version (${JSON.stringify(wide.version)}) is not under the lockup (${JSON.stringify(wide.brand)})`,
    );
    assert.ok(
      wide.versionCentreOffset !== null &&
        Math.abs(wide.versionCentreOffset) <= 1,
      `the version is ${wide.versionCentreOffset}px off the column's centre`,
    );
    assert.equal(
      wide.headerControls,
      2,
      `the header holds ${wide.headerControls} controls, expected the lockup and the build number`,
    );
    assert.ok(
      wide.badge && /^v\d+\.\d+\.\d+$/.test(wide.badge.text),
      `the version slot holds no version button (${JSON.stringify(wide.badge)})`,
    );
    assert.equal(
      wide.footRows,
      1,
      `the foot is ${wide.footRows} rows, not the one row the collapse toggle sits in`,
    );
    assert.equal(
      wide.metaRowRetired,
      true,
      "the retired caption row is still in the DOM",
    );
    assert.ok(wide.chip, "the foot holds no vault chip");
    assert.ok(wide.collapse, "the foot row holds no collapse toggle");
    assert.ok(
      wide.collapse.box && wide.chip
        ? wide.collapse.box.left >= wide.chip.right - 1
        : false,
      `the collapse toggle (${JSON.stringify(wide.collapse.box)}) is not right of the vault chip (${JSON.stringify(wide.chip)})`,
    );
    assert.equal(
      wide.collapse.label,
      "Collapse sidebar",
      `the foot's square control is named ${JSON.stringify(wide.collapse.label)}`,
    );
    assert.equal(
      wide.collapse.isLastControl,
      true,
      "the collapse toggle is not the last control in the column",
    );

    // Collapsed, the version retires and the way back is the Q emblem in the
    // topband — the other half of the same two controls.
    const collapsedLayout = report.layout.collapsed;
    assert.equal(
      collapsedLayout.versionDisplay,
      "none",
      "the thin rail still paints the build number",
    );
    assert.equal(
      collapsedLayout.footHasCollapse,
      false,
      "the thin rail still draws the square toggle in the foot",
    );
    assert.equal(
      collapsedLayout.headerControls,
      1,
      `the thin topband holds ${collapsedLayout.headerControls} controls, expected only the Q emblem`,
    );
    assert.ok(
      collapsedLayout.headerCollapse &&
        collapsedLayout.headerCollapse.label === "Expand sidebar" &&
        collapsedLayout.headerCollapse.mode === "brand",
      `the thin topband's control is ${JSON.stringify(collapsedLayout.headerCollapse)}`,
    );

    // The pictures are this window's own capturePage of the shell harness: the
    // rail column by day and by night, the whole window, the two bands that
    // moved, and the collapsed column. A picture that is missing or blank is not
    // evidence the screen ships.
    for (const [name, floor] of Object.entries(SCREENSHOTS)) {
      const file = path.join(ARTIFACTS, name);
      assert.equal(fs.existsSync(file), true, `missing screenshot ${name}`);
      const size = fs.statSync(file).size;
      assert.ok(
        size > floor,
        `screenshot ${name} is ${size} bytes — a blank frame, not the shipped rail`,
      );
    }
  });

  it("paints all three grouping lines as the same single device pixel at 125%", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    // The operator's display scale, forced: on a 1x bench the defect this run
    // pins cannot be reproduced, and a fill that spreads over two device rows
    // would pass every 1x assertion.
    const report = await runAndRead(DPR_REPORT, {
      RAIL_DPR: String(OPERATOR_DPR),
    });

    assert.equal(
      report.forcedDeviceScaleFactor,
      OPERATOR_DPR,
      `the 125% run did not force the scale factor (${report.forcedDeviceScaleFactor})`,
    );
    assert.equal(
      report.standard.devicePixelRatio,
      OPERATOR_DPR,
      `the harness rendered at DPR ${report.standard.devicePixelRatio}, not ${OPERATOR_DPR}`,
    );
    assert.equal(
      report.standard.devicePixels,
      1,
      `the standard claims ${report.standard.devicePixels} painted device px at 125%`,
    );

    // The ink and the tokens are scale-independent: the same standard as 1x.
    assert.deepEqual(
      {
        ink: report.standard.ink,
        rgb: report.standard.rgb,
        width: report.standard.width,
        lines: report.standard.lines,
        token: report.standard.token,
        widthToken: report.standard.widthToken,
      },
      {
        ink: DIVIDER_INK,
        rgb: DIVIDER_RGB,
        width: DIVIDER_WIDTH,
        lines: DIVIDER_COUNT,
        token: "--divider",
        widthToken: "--divider-width",
      },
    );

    // Every palette and mode still draws three snap-to-border lines, each one
    // device pixel, and none of them a background fill.
    for (const [key, sample] of Object.entries(report.samples)) {
      const mode = key.startsWith("day:") ? "day" : "night";
      const expectedRgb = DIVIDER_RGB[mode];
      assert.equal(
        sample.dpr,
        OPERATOR_DPR,
        `${key}: sampled at DPR ${sample.dpr}, not ${OPERATOR_DPR}`,
      );
      assert.equal(
        sample.lineCount,
        DIVIDER_COUNT,
        `${key}: the wide rail drew ${sample.lineCount} grouping lines at 125%`,
      );
      assert.equal(
        sample.paintedDevicePx,
        1,
        `${key}: the driver expected ${sample.paintedDevicePx} device px per line at 125%`,
      );
      for (const [index, line] of sample.lines.entries()) {
        assert.equal(
          line.borderTopColor,
          expectedRgb,
          `${key}: line ${index + 1} paints the border ${line.borderTopColor}, expected ${expectedRgb}`,
        );
        assert.equal(
          line.background,
          TRANSPARENT,
          `${key}: line ${index + 1} still has a background fill (${line.background})`,
        );
        assert.equal(
          line.paintedDevicePx,
          1,
          `${key}: line ${index + 1} paints ${line.paintedDevicePx} device px (${line.borderTopWidth} at DPR ${sample.dpr}) — the uneven-line defect`,
        );
        // The used border is 1/1.25 CSS px: 1 device px, not 1.25 rounded to 2.
        assert.equal(
          Math.round(parseFloat(line.borderTopWidth) * sample.dpr * 1000) / 1000,
          1,
          `${key}: line ${index + 1} has a used border of ${line.borderTopWidth} (${parseFloat(line.borderTopWidth) * sample.dpr} device px)`,
        );
      }
    }

    // The rows counted in the capture: all three lines one row, no smear — the
    // operator's "they all look one pixel" at 125%, as a number.
    assert.equal(
      report.pixelScan.dpr,
      OPERATOR_DPR,
      `the pixel scan ran at DPR ${report.pixelScan.dpr}`,
    );
    assert.equal(
      report.pixelScan.expectedRows,
      1,
      `the pixel scan expected ${report.pixelScan.expectedRows} device rows at 125%`,
    );
    assert.equal(
      report.pixelScan.lines.length,
      DIVIDER_COUNT,
      `the capture holds ${report.pixelScan.lines.length} line scans`,
    );
    assert.deepEqual(
      report.pixelScan.lines.map((line) => line.paintedRows),
      [1, 1, 1],
      `the three lines painted ${JSON.stringify(report.pixelScan.lines.map((line) => line.paintedRows))} device rows at 125%`,
    );
    for (const [index, line] of report.pixelScan.lines.entries()) {
      assert.deepEqual(
        line.partialRows,
        [],
        `line ${index + 1} smeared into a partial row at 125%: ${JSON.stringify(line.partialRows)}`,
      );
    }

    // A picture of the 125%-scale rail, in device pixels — the crop the operator
    // can open to see three one-pixel lines.
    const file = path.join(ARTIFACTS, DPR_SCREENSHOT.name);
    assert.equal(
      fs.existsSync(file),
      true,
      `missing screenshot ${DPR_SCREENSHOT.name}`,
    );
    assert.ok(
      fs.statSync(file).size > DPR_SCREENSHOT.floor,
      `screenshot ${DPR_SCREENSHOT.name} is ${fs.statSync(file).size} bytes — a blank frame, not the shipped rail`,
    );
  });
});
