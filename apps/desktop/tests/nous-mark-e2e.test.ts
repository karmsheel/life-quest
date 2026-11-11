import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Nous girl's ink, end to end.
 *
 * The rig boots the real app against a throwaway profile and vault and measures
 * the one mark Hermes wears in two places — the agent switcher's block and the
 * collapsed dock's floating launcher — in the night palette, the day palette and
 * under the `system` preference. The colour is read off the rendered window, not
 * off the stylesheet alone: each mark is cropped 1:1 and its ink pixels counted,
 * because a mark that is painted the field's own colour is exactly the bug.
 *
 * The assertions below restate the report's important fields by name:
 *   - night: the artwork is inverted to its white version and the block/launcher
 *     paint bright ink instead of disappearing into the dark field;
 *   - day: the shipped black artwork and the launcher's dark-gray mask are
 *     unchanged — the day themes were already right;
 *   - system night: the no-`data-theme` palette takes the white version too.
 *
 * The rig must run through the bench wrapper, because the rigs load the renderer
 * the shared dev server on 127.0.0.1:5173 serves and the wrapper is what puts
 * THIS checkout there:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/nous-mark-e2e.test.ts
 *
 * A skipped rig is evidence of nothing, so a missing dev server fails loudly.
 */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DRIVER = path.join(desktopRoot, "e2e/nous-mark.electron.mjs");
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const REPORT = path.join(ARTIFACTS, "nous-mark.json");
const DEV_SERVER = { host: "127.0.0.1", port: 5173 };

/** Kept in step with the rig; the report carries the actual counts. */
const MIN_INK_PIXELS = 40;

type Ink = {
  pixels: number;
  brightPixels: number;
  darkPixels: number;
  maxLuma: number;
  minLuma: number;
};

type Box = { x: number; y: number; width: number; height: number };

type MarkState = {
  dataTheme: string | null;
  skin: string | null;
  viewport: { width: number; height: number };
  switcher: {
    shown: boolean;
    items: string[];
    hermes: {
      box: Box | null;
      decoded: boolean;
      src: string | null;
      filter: string;
    } | null;
  };
  launcher: {
    box: Box | null;
    color: string;
    background: string;
    markMask: string | null;
    label: string | null;
  } | null;
};

type Report = {
  ok: boolean;
  configured: { settings: string | null; engaged: string; openedOk: boolean };
  marks: {
    night: { state: MarkState; ink: Ink; launcher: { state: MarkState; ink: Ink } };
    day: { state: MarkState; ink: Ink; launcher: { state: MarkState; ink: Ink } };
    systemNight: MarkState;
  };
  captureScale: number;
  checks: { label: string; pass: boolean; detail: string | null }[];
  failures: { label: string; pass: boolean; detail: string | null }[];
  screenshots: string[];
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_SERVER, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1500);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [DRIVER],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: {
          ...process.env,
          // Electron hosts export this; left in place the rig runs as plain
          // Node and never opens a window.
          ELECTRON_RUN_AS_NODE: undefined,
        } as NodeJS.ProcessEnv,
      },
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

describe("the Nous girl's mark follows the palette", () => {
  it("paints white at night, keeps the shipped black by day, and follows system dark", async (t) => {
    const up = await devServerUp();
    assert.equal(
      up,
      true,
      `no dev server on ${DEV_SERVER.host}:${DEV_SERVER.port} — this rig must run through ` +
        "`/root/.local/bin/lifequest-e2e <checkout> tests/nous-mark-e2e.test.ts`, which puts " +
        "this checkout on the bench. A skipped rig is evidence of nothing.",
    );
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — run this rig through `lifequest-e2e`, which builds the e2e seam",
    );

    for (const shot of [
      "nous-mark.json",
      "nous-mark-both-themes.png",
      "nous-mark-night-window.png",
      "nous-mark-day-window.png",
      "nous-mark-night-switcher.png",
      "nous-mark-night-launcher.png",
      "nous-mark-day-switcher.png",
      "nous-mark-day-launcher.png",
    ]) {
      fs.rmSync(path.join(ARTIFACTS, shot), { force: true });
    }

    const exitCode = await runRig();
    assert.equal(fs.existsSync(REPORT), true, "the rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(
      report.ok,
      true,
      `the report is not ok:\n${report.checks
        .filter((entry) => !entry.pass)
        .map((entry) => `  ${entry.label} — ${entry.detail}`)
        .join("\n")}`,
    );
    assert.equal(exitCode, 0, `the rig exited ${exitCode}`);

    // ── The world the rig built ────────────────────────────────────────────
    // The save answers with the ensure of whichever harness was active when it
    // ran (at first boot, Hermes' gateway, which this world does not provide);
    // the explicit switch after it is what makes Pi ready.
    assert.equal(typeof report.configured.settings, "string", "the rig never saved Pi's endpoint");
    assert.equal(report.configured.engaged, "ready", "the rig never engaged Pi");
    assert.equal(report.configured.openedOk, true, "the rig never opened its vault");
    assert.ok(
      report.captureScale > 0 && Number.isFinite(report.captureScale),
      `the capture scale is not a number: ${report.captureScale}`,
    );

    const hermesOn = (state: MarkState) => {
      assert.deepEqual(state.switcher.items, ["Hermes", "Pi"], "the block strip changed");
      assert.ok(state.switcher.hermes, "Hermes' block wore no mark");
      return state.switcher.hermes;
    };

    // ── Night: the white version ───────────────────────────────────────────
    const night = report.marks.night;
    assert.equal(night.state.dataTheme, "dark", "the night leg is not the dark palette");
    const nightMark = hermesOn(night.state);
    assert.equal(nightMark.decoded, true, "Hermes' artwork did not load at night");
    assert.equal(
      nightMark.filter,
      "invert(1)",
      "the night artwork is not inverted to its white version",
    );
    assert.ok(
      night.ink.brightPixels >= MIN_INK_PIXELS,
      `the night block paints no white ink: ${JSON.stringify(night.ink)}`,
    );
    assert.ok(
      night.ink.maxLuma > 200,
      `the night block tops out below white: ${JSON.stringify(night.ink)}`,
    );
    assert.equal(
      night.launcher.state.launcher?.color,
      "rgb(255, 255, 255)",
      `the night launcher is not white (${night.launcher.state.launcher?.color})`,
    );
    assert.ok(
      night.launcher.ink.brightPixels >= MIN_INK_PIXELS,
      `the night launcher paints no white ink: ${JSON.stringify(night.launcher.ink)}`,
    );
    assert.match(
      String(night.launcher.state.launcher?.markMask),
      /girl_steampunk/,
      "the floating mark is no longer the Nous girl",
    );

    // ── Day: exactly what shipped ──────────────────────────────────────────
    const day = report.marks.day;
    assert.equal(day.state.dataTheme, "light", "the day leg is not the light palette");
    const dayMark = hermesOn(day.state);
    assert.equal(dayMark.decoded, true, "Hermes' artwork did not load by day");
    assert.equal(dayMark.filter, "none", "the day artwork lost its shipped black");
    assert.ok(
      day.ink.darkPixels >= MIN_INK_PIXELS,
      `the day block paints no dark ink: ${JSON.stringify(day.ink)}`,
    );
    assert.equal(
      day.launcher.state.launcher?.color,
      "rgb(51, 51, 51)",
      `the day launcher lost its shipped dark gray (${day.launcher.state.launcher?.color})`,
    );
    assert.ok(
      day.launcher.ink.darkPixels >= MIN_INK_PIXELS,
      `the day launcher paints no dark ink: ${JSON.stringify(day.launcher.ink)}`,
    );

    // ── System dark: the palette with no `data-theme` ──────────────────────
    const system = report.marks.systemNight;
    assert.equal(
      system.dataTheme,
      null,
      "the system leg forced a data-theme instead of leaving the media query to decide",
    );
    const systemMark = hermesOn(system);
    assert.equal(systemMark.decoded, true, "Hermes' artwork did not load under system dark");
    assert.equal(
      systemMark.filter,
      "invert(1)",
      "system dark does not invert the artwork to its white version",
    );
    assert.equal(
      system.launcher?.color,
      "rgb(255, 255, 255)",
      `the system-dark launcher is not white (${system.launcher?.color})`,
    );

    // ── The artifact ───────────────────────────────────────────────────────
    for (const name of report.screenshots) {
      const file = path.join(ARTIFACTS, name);
      assert.equal(fs.existsSync(file), true, `no ${name}`);
      assert.ok(fs.statSync(file).size > 500, `${name} is empty`);
    }
    t.diagnostic(`artifact: ${REPORT}`);
  });
});
