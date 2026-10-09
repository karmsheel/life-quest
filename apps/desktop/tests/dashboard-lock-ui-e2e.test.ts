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
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-lock-ui.json");

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
      [path.join(desktopRoot, "e2e/dashboard-lock-ui.electron.mjs")],
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

type BoardSample = {
  badge: string | null;
  badgeLocked: string | null;
  toggle: string | null;
  hint: string | null;
  addPinRow: boolean;
  pins: number;
  chrome: number;
  chromeButtons: number;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    unlocked: BoardSample;
    locked: BoardSample;
    toggleCalls: { locked: boolean; boardSlug: string | null }[];
    afterUnlockClick: BoardSample;
    unexpectedBridgeCalls: string[];
    pinWritesWhileLocked: unknown[];
    consoleErrors: string[];
  };
  samples: { unlocked: BoardSample; locked: BoardSample };
};

/**
 * The Dashboard page lock, as the operator sees it: the board is editable while
 * unlocked and read-only — no pin chrome, no Add-pin row — while locked, and the
 * header control is the one way to change that.
 */
describe("dashboard lock ui e2e", () => {
  it("makes the board read-only while locked and editable while unlocked", async (t) => {
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

    // The unlocked board is editable, and says so.
    assert.equal(report.checks.unlocked.badge, "Unlocked");
    assert.equal(report.checks.unlocked.badgeLocked, "false");
    assert.equal(report.checks.unlocked.toggle, "Lock");
    assert.equal(report.checks.unlocked.addPinRow, true, "an unlocked board hid the Add-pin row");
    assert.ok(report.checks.unlocked.chrome > 0, "an unlocked board drew no pin chrome");

    // The locked board is read-only: this is the claim the feature rests on.
    assert.equal(report.checks.locked.badge, "Locked");
    assert.equal(report.checks.locked.badgeLocked, "true");
    assert.equal(report.checks.locked.toggle, "Unlock");
    assert.equal(report.checks.locked.addPinRow, false, "a locked board still offered Add pin");
    assert.equal(report.checks.locked.chrome, 0, "a locked board is still editable");
    assert.equal(report.checks.locked.chromeButtons, 0);
    // The lock hides the chrome; it must not hide the board.
    assert.equal(
      report.checks.locked.pins,
      report.checks.unlocked.pins,
      "the lock changed how many cards the board shows",
    );
    assert.match(report.checks.locked.hint ?? "", /locked/i);
    assert.match(report.checks.locked.hint ?? "", /Decisions/);

    // The control is a real write to the board, and it toggles back.
    assert.deepEqual(report.checks.toggleCalls, [{ locked: false, boardSlug: null }]);
    assert.equal(report.checks.afterUnlockClick.badge, "Unlocked");
    assert.equal(report.checks.afterUnlockClick.addPinRow, true, "unlocking did not restore Add pin");

    // Nothing reached the bridge that this rig does not model, and no pin write
    // was attempted while the board was locked.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.pinWritesWhileLocked, []);
    assert.deepEqual(report.checks.consoleErrors, []);
  });
});
