import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/dev-watch.json");
const DRIVER = path.join(desktopRoot, "e2e/dev-watch.mjs");

/**
 * `npm run dev` rebuilds the main process when the main process's own sources
 * change, and relaunches the app — so the code under development is the code
 * being run, without anybody knowing they have to restart it.
 *
 * The rig starts a REAL `npm run dev` (on its own port and profile, so the
 * operator's is untouched) and edits REAL source files. Nothing is stubbed and
 * nothing is simulated: the app it drives is the app, and the claim is read out
 * of that app's own stdout.
 *
 * Falsification, and why each leg bites:
 *
 *  - The probe is a line the rig appended to a module the main process bundles,
 *    and it prints its own `process.pid`. It cannot pass without a rebundle (the
 *    token was in no earlier bundle) AND a relaunch (a process evaluated it). A
 *    rig that read the script, or that watched for a log line, would pass on
 *    code that never ran.
 *  - The `boot` leg refuses a probe printed before the edit, so the marker is
 *    demonstrably the rig's and not something the app does anyway.
 *  - The `renderer` leg is the control: a change under `src/` must NOT relaunch
 *    the main process. Without it, a script that restarted Electron on every file
 *    change would pass everything above while being worse than the bug.
 *  - The `broken` leg asserts the app that was already up is STILL up after a
 *    source file that cannot build. A naive watcher takes a running dev session
 *    and kills it over a typo.
 *  - The `recover` leg asserts the next good save relaunches again, from the
 *    broken state, with a new pid — which is what makes that failure survivable.
 */
function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      process.execPath,
      [DRIVER],
      { cwd: desktopRoot, timeout: 300_000, env },
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

type Probe = { token: string; pid: number };

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    sourceRestored: boolean;
    legs: {
      boot: { watcherInstalled: boolean; relaunches: number; probes: Probe[] };
      change: {
        rebundleAnnounced: boolean;
        bundleRewritten: boolean;
        probePrinted: boolean;
        relaunches: number;
        probes: Probe[];
        pid: number | null;
      };
      renderer: { probesBefore: number; probesAfter: number; relaunched: boolean };
      broken: {
        failureReported: boolean;
        pidBefore: number | null;
        appStillAlive: boolean | null;
        newProbes: number;
        devStillRunning: boolean;
      };
      recover: { probePrinted: boolean; probes: Probe[] };
      restore: { relaunched: boolean };
    };
  };
};

describe("dev script watches the main process", () => {
  it("rebundles and relaunches on a main-process change, and leaves the app alone otherwise", async () => {
    // The driver edits source files, so it is run from a checkout it may rewrite.
    // It restores what it touched, and it asserts that it did.
    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "the driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the driver exited non-zero");

    const { boot, change, renderer, broken, recover, restore } = report.checks.legs;

    // ── the marker is ours ─────────────────────────────────────────────────
    assert.equal(boot.watcherInstalled, true, "the dev script never installed a watcher");
    assert.deepEqual(boot.probes, [], "a probe was printed before the rig edited anything");
    assert.equal(boot.relaunches, 0, "the app was relaunched before anything was edited");

    // ── the claim: an edit to the main process reaches a RUNNING app ────────
    assert.equal(change.rebundleAnnounced, true, "a main-process edit did not trigger a rebundle");
    assert.equal(change.bundleRewritten, true, "the main bundle was not rewritten");
    assert.equal(change.relaunches >= 1, true, "the app was not relaunched");
    assert.equal(change.probes.length > 0, true, "the edit never reached a running process");
    assert.equal(typeof change.pid, "number", "the relaunched app never reported its pid");

    // ── the control: a renderer edit must not restart the main process ─────
    assert.equal(
      renderer.relaunched,
      false,
      "a change under src/ relaunched the main process: the watcher is too broad",
    );
    assert.equal(renderer.probesAfter, renderer.probesBefore, "a renderer edit produced a new app process");

    // ── a bundle that cannot build must not cost the running app ───────────
    assert.equal(broken.failureReported, true, "a source file that cannot build was not reported");
    assert.equal(broken.appStillAlive, true, "a broken build killed the app that was already running");
    assert.equal(broken.newProbes, 0, "a broken build was launched anyway");
    assert.equal(broken.devStillRunning, true, "a broken build ended the dev session");

    // ── and the next good save brings it back with no manual restart ───────
    assert.equal(recover.probePrinted, true, "the app did not recover on the next good save");
    assert.notEqual(
      recover.probes[0]?.pid,
      broken.pidBefore,
      "the recovering bundle was evaluated by the old process, so nothing was relaunched",
    );

    // ── the checkout is left as it was found ───────────────────────────────
    assert.equal(restore.relaunched, true, "restoring the source did not rebuild the app");
    assert.equal(report.checks.sourceRestored, true, "the driver left an edited source file behind");
  });
});
