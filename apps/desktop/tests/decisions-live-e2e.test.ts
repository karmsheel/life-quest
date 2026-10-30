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
 * The Decisions inbox, live.
 *
 * The operator's own report is what this wraps: sitting on the Decisions page, a
 * Decision filed by the agent did not appear until they navigated away and back.
 * The rig replays exactly that on the real page component over a stubbed bridge
 * that plays the main process — it writes a Decision and fires the one event
 * `main.ts` fires — and this test is what says the claims in its artifact held.
 *
 * It renders a real page in a real layout engine, so it needs the Vite dev server.
 * With the server down the test skips; `npm run dev` in another terminal brings it
 * up.
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

type Report = {
  pass: boolean;
  failures: string[];
  claims: string;
  checks: { scenarios: Scenario[] } & Record<string, unknown>;
};

describe("decisions inbox live e2e", () => {
  it("shows a Decision filed while the operator is on the page", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      throw new Error("dev server down");
    }

    const driver = "decisions-live";
    const reportPath = path.join(desktopRoot, `e2e/artifacts/${driver}.json`);
    fs.rmSync(reportPath, { force: true });
    const exitCode = await runDriver(driver);
    assert.equal(fs.existsSync(reportPath), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // Every claim the rig exists to make, by name, so a silently dropped claim is
    // a failure rather than a report that happens to have fewer lines in it.
    const wanted = [
      "the-empty-inbox-says-so",
      "a-filing-appears-without-leaving-the-page",
      "the-arrival-line-names-who-filed-it",
      "the-new-card-wears-the-mark",
      "the-list-is-never-swapped-for-a-spinner",
      "the-mark-is-a-pulse",
      "two-filings-read-as-a-plural",
      "the-page-can-scroll-at-all",
      "the-arrival-lands-on-screen-where-the-list-starts",
      "reading-further-down-keeps-your-place",
      "a-decision-resolved-elsewhere-leaves-the-list",
      "a-cross-domain-filing-is-shown-at-once",
      "moving-the-lens-does-not-duplicate-or-drop-the-card",
      "an-approve-still-works-after-an-arrival",
      "history-draws-it-as-approved",
      "a-slow-read-cannot-land-under-the-wrong-tab",
      "the-page-asks-the-bridge-for-nothing-else",
      "the-page-logs-no-errors",
    ];
    const byName = new Map(report.checks.scenarios.map((s) => [s.name, s]));
    for (const name of wanted) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig never ran the claim ${name}`);
      assert.equal(scenario.pass, true, `${name}: ${scenario.detail ?? ""}`);
    }

    // The two facts the claims above are made of, read straight off the artifact:
    // the page re-read the vault on the write, and nothing remounted it.
    const after = report.checks.afterFirst as {
      ids: string[];
      titles: string[];
      mounts: number;
      listCalls: number;
      arrived: string[];
      arrival: string | null;
    };
    assert.equal(after.ids[0], report.checks.filedId, "the arrival is not the newest card");
    assert.equal(after.titles[0], "Premise revision 1");
    assert.equal(after.mounts, (report.checks.before as { mounts: number }).mounts);
    assert.equal(after.arrived.length, 1, "the arrival is not exactly one marked card");
    assert.match(after.arrival ?? "", /^New decision filed by Hermes\.$/);
    assert.ok(
      after.listCalls > (report.checks.before as { listCalls: number }).listCalls,
      "the page did not re-read the vault",
    );

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);
  });
});
