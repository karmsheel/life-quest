import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The companion door race, end to end, against the real application.
 *
 * `e2e/companion-door-race.mjs` builds a throwaway world — a temp `HERMES_HOME`,
 * a fake `hermes` CLI first on PATH, a fake host answering the attach probes, a
 * real throwaway vault — and runs `e2e/companion-door-race.electron.mjs` inside
 * Electron twice, once per case. This file only decides whether the artifact
 * says what the feature claims, and it re-derives the timing verdict from the
 * raw invocation log rather than trusting the launcher's own `checks`.
 *
 * WHY THIS RIG EXISTS
 *
 * On 2026-10-08 the operator's session had no `mcp__lifequest__*` tools. The
 * host (python, started 17:07:50) tried the `lifequest` MCP server at 17:08:27
 * and 17:08:54, before the app's doors existed (17:38:44), and Hermes parked it:
 * "failed initial connection after 3 attempts, parking until a reconnect is
 * requested". The app's one-shot startup check ran with no vault open, found no
 * door, and concluded nothing; the parked server only revived at 17:42:44, after
 * the operator's turn had already been answered without tools. The fix is a
 * post-bind check on the vault-open path, and this rig is the proof that it
 * fires when the host was already running and stays out of the way when it was
 * not.
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE CODE
 *
 * The point of the runs below is to make each of these impossible to do quietly.
 * Every one of them has a step in the artifact that fails if it happens.
 *
 *   1. The app never binds the doors the rig moved it to, and every assertion
 *      below passes vacuously against a host and a vault that never met. The
 *      driver never reports a serving door and the run fails on that.
 *   2. The rig attaches to the OPERATOR'S host, or restarts it. `HERMES_HOME` is
 *      a temp dir and the fake `hermes` is first on PATH; the artifact records
 *      which CLI the app resolved and the test fails if it is not this run's
 *      shim. Ports 8642/8643/8646 are never bound and never used as a fallback,
 *      because the fake host answers the configured port first.
 *   3. `credentialChanged` is true, so the restart the rig observes is
 *      `ensureCompanion`'s own and says nothing about the door check — it lands
 *      ~80ms after the vault opens, long before any window. The PROFILE config,
 *      the ROOT config and the secrets file are all pre-seeded with the exact
 *      credential the app will mint: the app reads the profile and the root
 *      together for that decision, so seeding only the profile file reproduces
 *      this trap exactly (it did, in this rig's first version), and the parked
 *      run then fails on "no restart before the window" rather than passing on
 *      the wrong one. The control run — same world, no restart — is the second
 *      thing that fails if the seeding is wrong.
 *   4. The restart is real but LATE: a host left tool-less for minutes is the
 *      bug, not a smaller version of the fix. The parked run fails if the first
 *      `gateway restart` lands more than 25 s after the door bound.
 *   5. The restart is real but EARLY: a host whose startup overlaps the binding
 *      gets killed mid-discovery and the boot that was about to succeed is
 *      thrown away. The parked run fails if any restart lands inside the 5 s
 *      parked window, and the `gateway.pid` stamp is what makes that the window
 *      the app must choose.
 *   6. The app restarts the host EVERY time, including when the companion has
 *      already reached the door. The connected control fails if any restart
 *      happens at all, so the parked case cannot be passed by a habit.
 *   7. The door itself is broken, so "the host parked" is the wrong diagnosis
 *      and a restart could not help. The driver asks the door for an
 *      authenticated `tools/list` and the test requires real LifeQuest tool
 *      names — `get_dashboard` and `preview_view` — from the real tool table.
 *   8. The restart is a `gateway start`, which does not make an already-running
 *      host re-read its config. Only `gateway restart` appears in the log, or
 *      the parked run fails.
 *   9. The rig watches for too short a window, so "no restart" is read from a
 *      window that closed before the app could have acted. The control waits
 *      past 10 s — longer than the whole parked decision — and the test asserts
 *      that it did.
 *  10. The e2e ports are already held by the operator's live app, so the rig
 *      either fails to bind or, worse, is answered by the app the operator is
 *      using. The launcher refuses to start unless both ports are free, and
 *      Electron is killed on every exit path.
 *  11. THE RECORDER IS SILENT, so "the app ran no `gateway restart`" is true of
 *      every run, including the ones where it did — the one failure here that
 *      looks exactly like success, and the one this rig first shipped with. The
 *      shim only records when the launcher wires `DOOR_RACE_CALLS` into the
 *      app's environment, and the app is none the wiser when it is missing: the
 *      fake CLI still exits 0. So the parked run now proves the recorder was live
 *      first — the app always runs `hermes config set` immediately before any
 *      restart, and the test fails if that call is absent from the log — and only
 *      then reads the restart counts.
 *  12. The log cannot tell a restart from a start. `hermes gateway restart` and
 *      `hermes gateway start` differ in the second token only, so a marker named
 *      after the first token made "the restart is a restart, not a start"
 *      unfalsifiable. The shim names its marker `p{argv[0]}-{argv[1]}` and both
 *      readers expose both atoms.
 *
 * FALSIFIED ONCE, ON PURPOSE
 *
 * The rig is only worth its runtime if it can fail. With the post-bind call in
 * `vault-service.ts`'s `rememberOpen` commented out and the bundle rebuilt, the
 * parked run goes red with exactly one check failing — "exactly one `gateway
 * restart` inside the window", zero invocations across a 40 s watch — while the
 * doors, the shim resolution, the profile write, the attach probes and the whole
 * connected control still pass. Restoring the call turns it green again. That is
 * the evidence that the parked assertion measures the fix and not the rig.
 *
 * Runs under `npm test` (`node --experimental-strip-types --test`). It skips
 * when the Vite dev server is not listening on 5173, because the app is started
 * from source by `electron .` with cwd `apps/desktop`, which loads the renderer
 * from that server.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = path.join(desktopRoot, "e2e/companion-door-race.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/companion-door-race.json");
const DEV_PORT = 5173;

/** The system under test owns 18643/18646 for the length of one run. */
const LOCAL_PORT = 18_643;

/** One recorded `hermes` invocation: the two verb atoms, and the marker's name. */
type CliCall = { at: number; argv: string[]; raw?: string };
type Check = { name: string; pass: boolean; detail: string | null };
type Run = {
  case: "parked" | "connected";
  ports: { local: number; invite: number; host: number };
  fakeCli: string;
  gatewayPidAgeSeconds: number;
  hostLog: { at: number; method: string; path: string }[];
  hostContact: { ok?: boolean; tools?: number; status?: number; error?: string } | null;
  cliLog: CliCall[];
  checks: Check[];
  verdict: "pass" | "fail";
  exit: { code: number | null; signal: string | null };
  result: {
    doorUpAt: number;
    watchedMs: number;
    cliPath: string | null;
    cliLog: CliCall[];
    toolsAfterRestart: string[] | null;
    toolsAfterRestartStatus: number;
    profileConfig: string | null;
    doorsAtBind: { localBound: boolean; inviteBound: boolean };
    inviteDoor: { port: number; status: number | null; refusal: string };
  };
};
type Report = {
  pass: boolean;
  failures: string[];
  notes: string[];
  runs: Record<string, Run>;
  generatedAt: string;
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

function runLauncher(): Promise<number> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      process.execPath,
      [LAUNCHER],
      { cwd: desktopRoot, timeout: 200_000, env },
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

/**
 * The fake CLI's marker names its first two argv tokens: `{hostname}.{random}
 * .p{argv[0]}-{argv[1]}`. Both are read, because `gateway restart` and
 * `gateway start` differ only in the second — and a rig that cannot tell them
 * apart cannot tell the app restarting a parked host from it starting one.
 */
const verbOf = (call: CliCall): string => call.argv[0] ?? "";
const subOf = (call: CliCall): string => call.argv[1] ?? "";
const isCall = (call: CliCall, verb: string, sub: string): boolean =>
  verbOf(call) === verb && subOf(call) === sub;

describe("companion door race e2e", () => {
  it("restarts a parked host inside the door's window, and never a connected one", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runLauncher();
    assert.equal(fs.existsSync(REPORT), true, "the launcher wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, [], `the launcher's own verdict: ${report.failures.join("; ")}`);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the launcher exited non-zero");

    const parked = report.runs.parked;
    const connected = report.runs.connected;
    assert.ok(parked, "the artifact has no parked run");
    assert.ok(connected, "the artifact has no connected run");
    assert.equal(parked.verdict, "pass", "the parked run failed its own checks");
    assert.equal(connected.verdict, "pass", "the connected run failed its own checks");

    // ── both runs were real: the app bound the moved doors, and this run's own
    //    fake CLI is what it ran. Without these, everything below could be true
    //    of a world where nothing happened. ────────────────────────────────────
    for (const run of [parked, connected]) {
      assert.equal(run.ports.local, LOCAL_PORT, "the run did not use the e2e local port");
      assert.equal(run.result.doorsAtBind.localBound, true, "the local door never bound");
      assert.equal(run.result.inviteDoor.refusal, "AUTH_REQUIRED", "the invite door never served");
      assert.ok(run.result.doorUpAt > 0, "the driver recorded no door bind instant");
      assert.equal(run.result.cliPath, run.fakeCli, `the app ran ${run.result.cliPath}, not this run's shim`);
      assert.equal(run.gatewayPidAgeSeconds, 120, "the host's pid file was not older than the doors");
      assert.ok(run.hostLog.length > 0, "the fake host was never asked for health or capabilities");
      assert.equal(
        (run.result.profileConfig ?? "").includes(`127.0.0.1:${run.ports.local}/mcp`),
        true,
        "the profile the app wrote does not name the door this rig bound",
      );
    }

    // ── the parked host: exactly one restart, inside the window, never before
    //    it. The window is measured from the door's own bind, and the raw log is
    //    re-read here so the launcher cannot have talked itself into a pass. ──
    //
    // The recorder is proved live first. The shim is silent unless the launcher
    // wired DOOR_RACE_CALLS into the app's environment, and a silent shim makes
    // every count below zero — so "no restart" would pass by construction. The
    // app always runs `config set` before it restarts anything, so its presence
    // is what turns the counts that follow into evidence.
    assert.ok(
      parked.result.cliLog.some((call) => isCall(call, "config", "set")),
      `the rig's CLI recorder never fired: the app's own \`config set\` is missing from ${JSON.stringify(parked.result.cliLog.map((c) => c.raw))}`,
    );
    const parkedRestarts = parked.result.cliLog.filter((call) => isCall(call, "gateway", "restart"));
    const parkedStarts = parked.result.cliLog.filter((call) => isCall(call, "gateway", "start"));
    assert.equal(parkedRestarts.length, 1, `the parked run invoked hermes ${parkedRestarts.length} times, not once`);
    assert.equal(parkedStarts.length, 0, "the app ran `gateway start` at a host that was already running");
    const restartRel = parkedRestarts[0]!.at - parked.result.doorUpAt;
    assert.ok(
      restartRel >= 4_000,
      `the restart landed ${restartRel}ms after the door bound, inside the 5s window a parked host must not be restarted in`,
    );
    assert.ok(
      restartRel <= 25_000,
      `the restart landed ${restartRel}ms after the door bound; a host left tool-less for that long is the bug`,
    );

    // The door is not the problem, and the restart is what the host needed: the
    // same door that was refused an unauthenticated caller a second earlier
    // serves the companion's real tool list once the host has been made to
    // re-read it.
    assert.equal(parked.result.doorRefusalAtBind?.status ?? 401, 401);
    assert.ok(
      (parked.result.toolsAfterRestart ?? []).includes("get_dashboard"),
      `the door did not advertise get_dashboard: ${JSON.stringify(parked.result.toolsAfterRestart)}`,
    );
    assert.ok(
      (parked.result.toolsAfterRestart ?? []).includes("preview_view"),
      `the door did not advertise preview_view: ${JSON.stringify(parked.result.toolsAfterRestart)}`,
    );

    // ── the connected host: the same world, a host that reached the door, and
    //    NOT ONE restart. This is what makes the parked run a decision. ───────
    const connectedRestarts = connected.result.cliLog.filter((call) => isCall(call, "gateway", "restart"));
    assert.deepEqual(
      connectedRestarts,
      [],
      `the app restarted a host that had already reached the door: ${JSON.stringify(connectedRestarts)}`,
    );
    assert.equal(connected.hostContact?.ok, true, `the control's host contact failed: ${JSON.stringify(connected.hostContact)}`);
    assert.ok((connected.hostContact?.tools ?? 0) > 0, "the control's host contact was served no tools");
    assert.ok(
      connected.result.watchedMs >= 10_000,
      `the control watched only ${connected.result.watchedMs}ms, too short to call "no restart" a decision`,
    );
    assert.ok(
      (connected.result.toolsAfterRestart ?? []).length > 0,
      "the door served the companion nothing in the control run",
    );
  });
});
