import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-arrange.json");

/** Every claim the driver must have recorded, by name. */
const SCENARIOS = ["skin", "chrome-identity"];

/**
 * The rig renders the real Dashboard in a real layout engine, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` in another
 * terminal brings it up.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
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
      [path.join(desktopRoot, "e2e/dashboard-arrange.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
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

type Scenario = { name: string; pass: boolean; detail: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  checks: { scenarios: Scenario[]; order: string[] };
};

/**
 * Arranging the Dashboard: the chrome draws the standard icon for each control,
 * and — as this rig grows — a card lifts, moves, and lands where it was aimed,
 * writing once and reverting when the vault refuses.
 */
describe("dashboard arrange e2e", () => {
  it("draws standard icons in the card chrome", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The board is the seven pins the rig seeds, in the seeded order: every
    // claim about order in this rig is an exact array.
    assert.deepEqual(report.checks.order, [
      "sys:goal-progress",
      "view:financial:v-weekly",
      "page:financial:ledger",
      "sys:today-week",
      "view:financial:v-summary",
      "sys:pending-decisions",
      "sys:recent-log",
    ]);

    const recorded = report.checks.scenarios.map((s) => s.name);
    for (const name of SCENARIOS) {
      assert.ok(recorded.includes(name), `the driver never recorded the ${name} scenario`);
    }
    for (const scenario of report.checks.scenarios) {
      assert.equal(scenario.pass, true, `${scenario.name}: ${scenario.detail ?? ""}`);
    }
  });
});
