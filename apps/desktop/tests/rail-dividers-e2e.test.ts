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
 * The left sidebar's three grouping lines: exactly 1px of the app's neutral
 * divider ink, the same in every built-in theme at each mode's own weight — a
 * light gray by day (`#bdbdbd`) so the line sits quietly on the paper mat, and a
 * darker gray at night (`#454545`) so it reads on the near-black mat instead of
 * glowing off it.
 *
 * The driver (`e2e/rail-dividers.electron.mjs`) mounts the real shell harness in
 * a real Electron window and reads the computed ink and thickness of every
 * `.nav-rail__divider` in six palettes. This suite runs that driver and then
 * restates the claims over the artifact, so a regression names the palette and
 * the number it broke rather than only failing inside the driver.
 *
 * A skipped rig is evidence of nothing, so this test skips only when the Vite
 * dev server is not listening on 5173; run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/rail-dividers-e2e.test.ts`,
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
const DRIVER = path.join(desktopRoot, "e2e/rail-dividers.electron.mjs");
const REPORT = path.join(ARTIFACTS, "rail-dividers.json");

/**
 * The standard the operator asked for: 1px, carried by mode rather than theme.
 * The day ink must be lighter than the night ink — that ordering is asserted
 * below, so a future edit cannot flatten the pair or invert it.
 */
const DIVIDER_INK = { day: "#bdbdbd", night: "#454545" };
const DIVIDER_RGB = { day: "rgb(189, 189, 189)", night: "rgb(69, 69, 69)" };
const DIVIDER_WIDTH = "1px";
const DIVIDER_COUNT = 3;
const SCREENSHOTS = [
  "rail-dividers-day.png",
  "rail-dividers-night.png",
  "rail-dividers-day-shell.png",
];
/** A picture smaller than this is a blank frame, not the shipped rail. */
const SCREENSHOT_MIN_BYTES = 4 * 1024;

type DividerLine = {
  top: number | null;
  left: number | null;
  width: number | null;
  height: number;
  background: string;
};

type DividerSample = {
  theme: { dataTheme: string | null; skin: string | null };
  tokens: { divider: string; dividerWidth: string };
  lineCount: number;
  lines: DividerLine[];
};

type Report = {
  pass: boolean;
  failures: string[];
  url: string;
  vaultName: string | null;
  standard: {
    ink: { day: string; night: string };
    rgb: { day: string; night: string };
    width: string;
    lines: number;
    token: string;
    widthToken: string;
  };
  samples: Record<string, DividerSample>;
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

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 150_000 },
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

describe("rail dividers (1px neutral gray, lighter by day, every theme)", () => {
  it("draws the sidebar's three grouping lines at 1px of the mode's ink in every palette", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    // The driver's own failures first: a report that threw before the first
    // sample has no measurements, and destructuring it would hide that.
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The standard is named in the artifact, not just satisfied implicitly — and
    // the pair's ordering is restated from its own inks: the day ink is lighter
    // than the night ink, so a future edit cannot flatten the two or invert them.
    assert.deepEqual(report.standard, {
      ink: DIVIDER_INK,
      rgb: DIVIDER_RGB,
      width: DIVIDER_WIDTH,
      lines: DIVIDER_COUNT,
      token: "--divider",
      widthToken: "--divider-width",
    });
    assert.ok(
      luminanceOf(report.standard.ink.day) >
        luminanceOf(report.standard.ink.night),
      `the day divider ink (${report.standard.ink.day}, ${luminanceOf(report.standard.ink.day).toFixed(4)}) is not lighter than the night ink (${report.standard.ink.night}, ${luminanceOf(report.standard.ink.night).toFixed(4)})`,
    );

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
    // must paint the same value.
    for (const mode of ["day", "night"] as const) {
      const inks = new Set(
        (mode === "day" ? lightSkins : darkSkins).flatMap((name) =>
          report.samples[`${mode}:${name}`].lines.map((line) => line.background),
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

        // Three lines, each exactly 1px, each the mode's ink.
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
            `${mode}[${name}]: a grouping line is ${line.height}px thick, not 1px`,
          );
          assert.equal(
            line.background,
            expectedRgb,
            `${mode}[${name}]: a grouping line paints ${line.background} — a palette ink leaked into the divider (expected ${expectedRgb}, the ${mode} ink ${expectedInk})`,
          );
        }
        assert.equal(
          new Set(sample.lines.map((line) => line.height)).size,
          1,
          `${mode}[${name}]: the three lines are not the same thickness (${JSON.stringify(sample.lines.map((line) => line.height))})`,
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

    // The pictures are this window's own capturePage of the shell harness: the
    // rail column by day and by night, and the whole window for context. A
    // picture that is missing or blank is not evidence the screen ships.
    for (const name of SCREENSHOTS) {
      const file = path.join(ARTIFACTS, name);
      assert.equal(fs.existsSync(file), true, `missing screenshot ${name}`);
      const size = fs.statSync(file).size;
      assert.ok(
        size > SCREENSHOT_MIN_BYTES,
        `screenshot ${name} is ${size} bytes — a blank frame, not the shipped rail`,
      );
    }
  });
});
