import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const DEV_HOST = new URL(DEV_SERVER).hostname;
const DEV_PORT = Number(new URL(DEV_SERVER).port || 80);
const REPORT = path.join(desktopRoot, "e2e/artifacts/phone-ui.json");
const SETTINGS_SHOT = path.join(desktopRoot, "e2e/artifacts/phone-settings.png");

/**
 * Every scenario the UI rig must report as passing, for the Settings surface.
 * The phone-window legs add their own names with the PWA.
 */
const SETTINGS_SCENARIOS = [
  "settings shows the phone door",
  "toggle turns access off and on",
  "http address is refused",
  "https address is saved",
  "pairing shows a real QR and expires",
  "cancel clears the pairing code",
  "metric select writes",
  "forget removes the device",
];

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: { name: string; pass: boolean; detail: string | null }[];
  screens: string[];
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: DEV_HOST });
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
      [path.join(desktopRoot, "e2e/phone-ui.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
      (error, _stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(new Error(`${error.message}\n${stderr}`));
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

describe("phone ui", { concurrency: false }, () => {
  it("renders the Settings section and its pairing controls", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SETTINGS_SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(
      exitCode,
      0,
      `the phone UI rig exited ${exitCode}: ${report.failures.join("; ")}`,
    );
    assert.equal(
      report.pass,
      true,
      `the rig reported failures: ${report.failures.join("; ")}`,
    );

    const byName = new Map(report.scenarios.map((s) => [s.name, s]));
    for (const name of SETTINGS_SCENARIOS) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig reported no scenario named "${name}"`);
      assert.equal(
        scenario.pass,
        true,
        `"${name}" failed: ${scenario.detail ?? "no detail"}`,
      );
    }

    assert.equal(
      fs.existsSync(SETTINGS_SHOT),
      true,
      "the rig wrote no Settings screenshot",
    );
    assert.ok(
      fs.statSync(SETTINGS_SHOT).size > 10_000,
      "the Settings screenshot is too small to be the shipped panel",
    );
  });
});
