import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The companion refusal, end to end, against the real application.
 *
 * `e2e/companion-refusal.mjs` builds a throwaway world — a temp `HERMES_HOME`, a
 * fake `hermes` first on PATH that refuses `gateway ensure` (and every other
 * `gateway` verb) the way the real CLI refuses (the message on STDOUT, an empty
 * stderr, exit 1), an app prefs file that puts the companion on a profile no host
 * on this machine serves — and runs `e2e/companion-refusal.electron.mjs` inside
 * Electron. This file only decides whether the artifact says what the fix
 * claims: that the operator reads the CLI's own sentence, not the exit code it
 * fell back to, and that no gateway was restarted to get there.
 *
 * WHY THIS RIG EXISTS
 *
 * A fresh install on 2026-10-12 stopped at the LifeQuest companion stage showing
 * exactly two lines:
 *
 *   Hermes gateway exited
 *   hermes gateway start exited 1
 *
 * Both were the app's own words, and neither was a diagnosis. The Hermes CLI
 * prints its refusals through `print()` / `print_error()`, which is STDOUT
 * (`hermes_cli/cli_output.py`), and exits non-zero with stderr empty; `runHermes`
 * piped stdout and never read it, so the sentence that named the failure — "Gateway
 * service restart failed.", "Running the gateway as a background service is not
 * available on this platform (no systemd, launchd or Scheduled Tasks)." — was
 * thrown away, and the first of the two commands' failures never even reached the
 * second command's fallback (`catch {}`).
 *
 * The same path also used to reach for `hermes gateway restart`, which restarts
 * the ONE host multiplexer serving every profile on the machine. That is why
 * this rig now refuses `ensure` instead: the app may start the runtime that
 * serves the selected profile, and may not stop or restart anything else.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 * The assertions below are about a run that really happened, and each of these
 * is a way the run could look green while proving nothing.
 *
 *   1. THE RECORDER IS SILENT: the fake CLI only writes markers when the launcher
 *      points it at this run's directory, and a silent recorder makes "the app
 *      asked Hermes to ensure the gateway" true of every run, including one where
 *      the app never called anything. So the artifact must show the `config set`
 *      the app always runs before any gateway verb, and the `ensure` verb.
 *   2. THE APP RAN THE OPERATOR'S REAL HERMES: which would falsify the run and
 *      touch a Hermes this rig must never touch. `where hermes` is recorded and
 *      must name this run's shim.
 *   3. THE APP ATTACHED INSTEAD OF STARTING: a host that answered the attach probe
 *      would take the app down a green-by-accident path. The profile this run
 *      aims at exists only under its temp home, so every `/p/<name>/health` on
 *      the machine is a 404 — and the assertion that the status is
 *      `gateway_exited` is what proves the refusal path is the one that ran. The
 *      profile is seeded in the app's own prefs file, so a reading of the profile
 *      choice that lost it would put the app back on `lifequest`, onto whatever
 *      host is up, and fail this run.
 *   4. THE MESSAGE REACHED THE STATUS AND NOT THE SCREEN: the operator reads the
 *      setup screen. The artifact's `screen.body` is read out of the real window,
 *      and it must carry the CLI's sentence too.
 *   5. THE FIX IS MEASURED BY ACCIDENT: the body must not be an exit-code
 *      fallback, which is the exact string the unfixed app produced. That
 *      assertion is what fails when this rig is run against the old bundle.
 *   6. THE HOST IS RESTARTED: the app may not reach for `gateway restart` or
 *      `gateway start` against a host it did not start. The artifact's CLI log
 *      must show exactly one `ensure` and neither of those verbs.
 *
 * Runs under `npm test` (`node --experimental-strip-types --test`). It skips when
 * the Vite dev server is not listening on 5173, because the app is started from
 * source by `electron .` with cwd `apps/desktop`, which loads the renderer from
 * that server.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = path.join(desktopRoot, "e2e/companion-refusal.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/companion-refusal.json");
const DEV_PORT = 5173;

/** This rig's own door pair; no vault opens, so nothing should bind them. */
const LOCAL_PORT = 18_843;

type CliCall = { at: number; argv: string[]; raw?: string };
type Check = { name: string; pass: boolean; detail: string | null };
type Report = {
  pass: boolean;
  failures: string[];
  notes: string[];
  profile: string;
  fakeCli: string;
  ports: { local: number; invite: number; host: number };
  exit: { code: number | null; signal: string | null };
  cliLog: CliCall[];
  checks: Check[];
  result: {
    ran: boolean;
    kind: string | null;
    detail: string;
    cliPath: string | null;
    cliPathLines: string[];
    screen: {
      heading?: string;
      lead?: string;
      body?: string;
      bodyLines?: number;
      recheck?: string;
      splashHidden?: boolean;
    };
    notes: string[];
  };
};

/** The Vite dev server, without which the app's window has nothing to load. */
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

function runLauncher(): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      process.execPath,
      [LAUNCHER],
      { cwd: desktopRoot, timeout: 200_000, env, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

const verbOf = (call: CliCall): string => call.argv[0] ?? "";
const subOf = (call: CliCall): string => call.argv[1] ?? "";
const isCall = (call: CliCall, verb: string, sub: string): boolean =>
  verbOf(call) === verb && subOf(call) === sub;

/** The sentence Hermes prints for a failed gateway ensure, on stdout, before exit 1. */
const ENSURE_SENTENCE = "Gateway runtime did not become ready.";
/** The whole diagnosis the app had before this fix. */
const BARE_FALLBACK = /^hermes [^\n]* exited \d+$/;

describe("companion refusal e2e", () => {
  it("shows the operator what Hermes said, not the exit code it fell back to", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const run = await runLauncher();
    assert.equal(fs.existsSync(REPORT), true, "the launcher wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(report.pass, true, `the launcher's own verdict failed: ${report.failures.join("; ")}`);
    assert.equal(run.code, 0, `the launcher exited ${run.code}: ${run.stderr.slice(-2000)}`);
    assert.deepEqual(
      report.checks.filter((c) => !c.pass).map((c) => c.name),
      [],
      "the artifact carries a failing check",
    );

    // ── the run was real ──────────────────────────────────────────────────────
    //
    // The recorder is proved live FIRST. Its markers only exist if the launcher
    // wired the directory into the app's environment, and the app always runs a
    // `config set` before touching the gateway — so its presence is what turns
    // the counts that follow into evidence rather than a silent zero. One, not
    // two: the app runs that command twice with identical argv, and the marker
    // name can only carry those atoms, so the judge asks for liveness, not a
    // count it cannot honestly make.
    const configCalls = report.cliLog.filter((call) => isCall(call, "config", "set"));
    assert.ok(
      configCalls.length >= 1,
      `the rig's CLI recorder never fired: ${JSON.stringify(report.cliLog.map((c) => c.raw))}`,
    );
    assert.equal(
      report.result.cliPath,
      report.fakeCli,
      `the app ran ${report.result.cliPath}, not this run's shim (${report.result.cliPathLines.join(", ")})`,
    );
    assert.equal(report.ports.local, LOCAL_PORT, "the run did not use this rig's door pair");
    assert.equal(report.result.ran, true, "the driver never reported");

    // ── the refusal path is the one that ran ─────────────────────────────────
    //
    // `ensure` is the only gateway verb that starts anything now. A run that
    // reaches for `restart` — the shared host's restart, which took every other
    // profile down — fails here even if the screen looks right.
    const ensures = report.cliLog.filter((call) => isCall(call, "gateway", "ensure"));
    const restarts = report.cliLog.filter((call) => isCall(call, "gateway", "restart"));
    const starts = report.cliLog.filter((call) => isCall(call, "gateway", "start"));
    assert.equal(ensures.length, 1, `the app ran \`gateway ensure\` ${ensures.length} times, not once`);
    assert.equal(restarts.length, 0, `the app restarted the shared host gateway ${restarts.length} times`);
    assert.equal(
      starts.length,
      0,
      "the app started a gateway that was already running",
    );
    assert.equal(
      report.result.kind,
      "gateway_exited",
      `the app reported ${report.result.kind} instead of the refusal; it attached where it should have started a gateway`,
    );

    // ── the operator gets the CLI's own words ────────────────────────────────
    //
    // The refusal is printed on stdout, which the app used to leave unread.
    assert.ok(
      report.result.detail.includes(ENSURE_SENTENCE),
      `the ensure refusal the app used to swallow is missing: ${JSON.stringify(report.result.detail)}`,
    );
    assert.doesNotMatch(
      report.result.detail.trim(),
      BARE_FALLBACK,
      "the detail is still nothing but an exit-code fallback",
    );

    // ── and the SCREEN shows it, which is where the operator was reading ─────
    assert.equal(
      report.result.screen.heading,
      "LifeQuest companion",
      `the setup screen did not render: ${JSON.stringify(report.result.screen)}`,
    );
    assert.equal(
      report.result.screen.lead,
      "Hermes gateway exited",
      `the setup screen's lead line changed: ${JSON.stringify(report.result.screen.lead)}`,
    );
    assert.ok(
      (report.result.screen.body ?? "").includes(ENSURE_SENTENCE),
      `the setup screen did not show Hermes' ensure refusal: ${JSON.stringify(report.result.screen.body)}`,
    );
    assert.notEqual(
      report.result.screen.body,
      "hermes gateway start exited 1",
      "the setup screen still shows the bare exit code the operator reported",
    );
    // The screen keeps the operator's way out of a stuck connect.
    assert.equal(report.result.screen.recheck, "Recheck", "the Recheck control is missing");
    // A refusal is a blocking kind, so the cold-start splash stands down and this
    // message is the thing on screen rather than something behind it.
    assert.equal(
      report.result.screen.splashHidden,
      true,
      "the cold-start splash never stood down, so none of this text is on screen",
    );
  });
});
