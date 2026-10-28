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

/**
 * The Decisions badge, live.
 *
 * The complaint this wraps: the rail's Decisions badge only ever showed the count
 * the vault had when the app started, so a Decision filed while the app was open
 * was invisible until something happened to remount the rail. The rig renders the
 * real `NavRail` over a stub bridge that plays the main process — it writes a
 * Decision into the vault and fires the one event `main.ts` fires — and this test
 * is what says the claims in its artifact held.
 *
 * It renders a real page in a real layout engine, so it needs the Vite dev server.
 * With the server down the test skips; `npm run dev` in another terminal brings it
 * up. A skipped rig is evidence of nothing.
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

function runDriver(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, `e2e/${name}.electron.mjs`)],
      { cwd: desktopRoot, timeout: 180_000 },
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

type BadgeScreen = {
  badgePresent: boolean;
  badgeText: string | null;
  ariaLabel: string | null;
  title: string | null;
  arrived: string | null;
  arrivedClass: boolean;
  mounts: number;
  nonce: string;
  linkToken: string | null;
  sameLinkNode: boolean;
  decisionListCalls: number;
  snapshotDecisions: number;
  unexpected: string[];
  harnessErrors: string[];
};

type Report = {
  pass: boolean;
  failures: string[];
  claims: string;
  checks: {
    scenarios: Scenario[];
    before: BadgeScreen;
    afterFirst: BadgeScreen;
    afterSecond: BadgeScreen;
    afterDecrease: BadgeScreen;
    afterEmpty: BadgeScreen;
    filedId: string;
    secondId: string;
    pulseFirst: {
      arrivedAt: number | null;
      goneAt: number | null;
      durationMs: number | null;
      samples: number;
    };
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
    harnessErrors: string[];
    screenshot: string;
  } & Record<string, unknown>;
};

describe("decisions nav badge live e2e", () => {
  it("counts a Decision filed while the rail is mounted, pulses, and clears", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      throw new Error("dev server down");
    }

    const driver = "decisions-badge";
    const artifacts = path.join(desktopRoot, "e2e/artifacts");
    const reportPath = path.join(artifacts, `${driver}.json`);
    const pngPath = path.join(artifacts, `${driver}.png`);
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(pngPath, { force: true });
    const exitCode = await runDriver(driver);
    assert.equal(fs.existsSync(reportPath), true, "driver wrote no report artifact");
    assert.equal(fs.existsSync(pngPath), true, "driver captured no screenshot artifact");
    // A zero-byte PNG is "the capture failed after the file was opened", not a
    // screenshot of the rail. The rig captures the whole window, so a real one is
    // tens of kilobytes.
    assert.ok(
      fs.statSync(pngPath).size > 20_000,
      `screenshot is too small to be the window: ${fs.statSync(pngPath).size} bytes`,
    );

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // Every claim the rig exists to make, by name, so a silently dropped claim is
    // a failure rather than a report that happens to have fewer lines in it.
    const wanted = [
      "the-rail-starts-with-no-badge",
      "a-filing-while-mounted-appears-as-a-count",
      "the-link-says-how-many-are-pending",
      "the-arrival-mark-is-on-the-badge",
      "the-count-arrives-without-a-remount-or-a-reload",
      "the-mark-is-a-pulse-and-the-count-stays",
      "a-second-filing-bumps-the-count",
      "a-decrease-updates-without-a-pulse",
      "the-badge-disappears-when-nothing-is-pending",
      "nothing-was-rebuilt-between-the-baseline-and-the-end",
      "the-page-asks-the-bridge-for-nothing-else",
      "the-page-logs-no-errors",
    ];
    const byName = new Map(report.checks.scenarios.map((s) => [s.name, s]));
    for (const name of wanted) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig never ran the claim ${name}`);
      assert.equal(scenario.pass, true, `${name}: ${scenario.detail ?? ""}`);
    }

    // The facts the claims are made of, read straight off the artifact: the badge
    // was fed by a re-read of the vault (the snapshot held nothing), the mark was
    // up for seconds rather than a frame, and nothing was rebuilt to make it so.
    assert.equal(report.checks.before.badgePresent, false);
    assert.equal(report.checks.before.snapshotDecisions, 0);
    assert.equal(report.checks.afterFirst.badgePresent, true);
    assert.equal(report.checks.afterFirst.badgeText, "1");
    assert.equal(report.checks.afterFirst.ariaLabel, "Decisions, 1 pending");
    assert.equal(report.checks.afterFirst.arrived, "true");
    assert.equal(report.checks.afterFirst.arrivedClass, true);
    assert.ok(
      report.checks.afterFirst.decisionListCalls >
        report.checks.before.decisionListCalls,
      "the rail did not re-read the decision list",
    );
    assert.equal(
      report.checks.afterFirst.mounts,
      report.checks.before.mounts,
      "the count arrived via a remount",
    );
    assert.equal(report.checks.afterFirst.nonce, report.checks.before.nonce);
    assert.ok(
      report.checks.afterFirst.sameLinkNode &&
        report.checks.afterFirst.linkToken === report.checks.before.linkToken,
      "the Decisions link was replaced",
    );
    assert.ok(
      (report.checks.pulseFirst.durationMs ?? 0) >= 2_500 &&
        (report.checks.pulseFirst.durationMs ?? 0) <= 7_000,
      `the arrival mark lasted ${report.checks.pulseFirst.durationMs}ms`,
    );
    assert.equal(report.checks.afterSecond.badgeText, "2");
    assert.equal(report.checks.afterDecrease.badgeText, "1");
    assert.equal(report.checks.afterDecrease.arrived, null);
    assert.equal(report.checks.afterDecrease.arrivedClass, false);
    assert.equal(report.checks.afterEmpty.badgePresent, false);
    assert.equal(report.checks.afterEmpty.ariaLabel, "Decisions");
    assert.equal(report.checks.afterEmpty.mounts, report.checks.before.mounts);
    assert.equal(report.checks.afterEmpty.nonce, report.checks.before.nonce);
    assert.ok(report.checks.screenshot.endsWith("decisions-badge.png"));
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);
    assert.deepEqual(report.checks.harnessErrors, []);
  });
});
