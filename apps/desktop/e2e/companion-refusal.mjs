/**
 * The companion refusal: when Hermes refuses to bring its gateway up — the
 * message on STDOUT, an empty stderr, a non-zero exit — what does the operator
 * actually get to read?
 *
 * THE REPORTED FAILURE
 *
 * A fresh install stopped at the LifeQuest companion stage with two lines on the
 * setup screen:
 *
 *   Hermes gateway exited
 *   hermes gateway start exited 1
 *
 * The second line was the whole diagnosis the app had. The real one —
 * "Gateway service restart failed.", "Running the gateway as a background service
 * is not available on this platform (no systemd, launchd or Scheduled Tasks)." —
 * was printed by the CLI on STDOUT, which `runHermes` piped and never read, and
 * the first of the two commands' failures was dropped by a bare `catch {}`.
 *
 * WHAT THIS RIG ASKS
 *
 * One question, against the real app: with a fake `hermes` that reproduces both
 * of those refusals exactly as the real CLI emits them (stdout only, exit 1,
 * stderr empty), does the setup screen — the surface the operator reads — carry
 * the CLI's own sentences, or only the exit code?
 *
 * THE WAYS THIS COULD FAIL, WRITTEN DOWN BEFORE THE RIG
 *
 *   1. The app never reaches `ensureHostGateway`, so the refusal path is never
 *      exercised and a green run proves nothing. The driver waits for a
 *      `gateway_exited` status and the launcher fails the run if the fake CLI
 *      never logged the two `gateway` invocations.
 *   2. The app runs the OPERATOR'S real `hermes`, which would both falsify the
 *      run and touch a Hermes this rig must never touch. `HERMES_HOME` is a temp
 *      dir, the shim is first on PATH, and the artifact records the CLI that
 *      `where.exe hermes` resolves to; the judge fails unless it is this run's
 *      shim.
 *   3. The recorder is silent, so "the CLI was asked to start the gateway" is
 *      true of a run where it was not. The shim only writes markers when this
 *      rig points it at its own directory, and the judge requires the `config
 *      set` the app always runs before any gateway verb — the same live-recorder
 *      proof the door-race rig uses.
 *   4. The operator's own host answers the attach probe and the app attaches
 *      instead of restarting: the profile this rig aims the companion at is one
 *      no host on this machine serves (its home is this run's temp dir), so
 *      `/p/<name>/health` is 404 everywhere and the attach loop cannot succeed.
 *      The temp home's `.env` also names a dead port, so the first probe is a
 *      refused connection rather than a wait. The profile comes from the app's
 *      own prefs file, which is deliberate: a run that lands on `lifequest`
 *      instead would be answered by whatever host is up, and the artifact says
 *      which profile the app was on.
 *   5. The message is carried but the SCREEN drops it: the judge reads the
 *      rendered heading and body out of the real window, not the status object
 *      alone.
 *   6. A run that measures the fix by accident: the judge also fails when the
 *      body is nothing but an exit-code fallback (`hermes <args> exited <n>`),
 *      which is exactly what the unfixed app produced.
 *
 * The artifact is `e2e/artifacts/companion-refusal.json`; it quotes the exact
 * text the app reported, so the claim can be re-read without a re-run.
 *
 * Usage, from `apps/desktop`, with the Vite dev server up:
 *
 *   node e2e/companion-refusal.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const DRIVER = path.join(here, "companion-refusal.electron.mjs");
const REPORT = path.join(here, "artifacts", "companion-refusal.json");
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/**
 * The app's doors, moved off the product's 8643/8646 and off every other rig's
 * pair (the door race and the pairing rig hold 18643/18646, the card rigs
 * 18743/18746 and 18753/18756). This run opens no vault, so nothing should bind
 * them at all — the guard in `main` is what proves that stayed true.
 */
const LOCAL_PORT = 18_843;
const INVITE_PORT = 18_846;

/**
 * The companion profile this run aims at. It must be a name no host on this
 * machine serves: the app probes `/p/<name>/health` on the configured port and
 * then on Hermes' discovery ports, and a host that answered would make the app
 * attach — a different, green-by-accident path. The name exists only under this
 * run's temp `HERMES_HOME`, so no other process can serve it.
 */
const PROFILE = "refusal-e2e";

/**
 * The refusal, verbatim in shape from Hermes 2026-10 (`hermes_cli/gateway.py`):
 * the message on STDOUT, an empty stderr, exit 1. `gateway ensure` is the only
 * gateway verb the app runs at startup now; `restart` and `start` are refused
 * too, so a regression that reaches for either one leaves its own sentence in
 * the artifact.
 */
const ENSURE_REFUSAL = [
  "✗ Gateway runtime did not become ready.",
  "  The host gateway process exited during startup.",
  "  Run `hermes gateway status` for details.",
  "",
];
const ENSURE_SENTENCE = "Gateway runtime did not become ready.";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lq-refusal-"));
const notes = [];
const failures = [];
const children = new Set();
let finished = false;
let record = null;

function note(message) {
  notes.push(message);
  console.error(`[refusal] ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`[refusal] FAIL ${message}`);
}

/** A port nothing is listening on, asked by binding it rather than guessing. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * The fake `hermes`, first on PATH.
 *
 * `gateway ensure` — the only gateway verb the app starts anything with — refuses
 * the way the real CLI refuses: the text on STDOUT, nothing on stderr, exit 1.
 * Every other invocation (the two `config set`s the app runs first) exits 0.
 *
 * The refusal text is emitted with `type` from a UTF-8 file rather than `echo`:
 * a `✗` through `echo` is written in the console code page and arrives at the
 * app as mojibake, and this rig is about the app carrying the CLI's words
 * faithfully, not about cmd.exe's encoding.
 *
 * Each invocation also writes a marker file whose name carries the two verb
 * atoms the judge reads (`%COMPUTERNAME%.%RANDOM%-%RANDOM%.p%1-%2`), because a
 * log that cannot tell `gateway ensure` from `gateway restart` cannot state the
 * claim. TWO randoms, not one: the app runs `hermes config set` twice in a row
 * with identical argv, and one `%RANDOM%` collides often enough to make the
 * second invocation overwrite the first — which is how this rig's first run
 * proved "the app ran the config sets" with a single marker. The marker is
 * written only when this rig sets the directory, so a run can only ever count
 * its own app's calls.
 */
function writeHermesShim(cliDir) {
  fs.mkdirSync(cliDir, { recursive: true });
  const ensureText = path.join(cliDir, "refuse-ensure.txt");
  fs.writeFileSync(ensureText, `${ENSURE_REFUSAL.join("\r\n")}`, "utf8");

  const shim = path.join(cliDir, "hermes.cmd");
  const script = [
    "@echo off",
    "rem A fake hermes: record the invocation, then refuse `gateway` the way the",
    "rem real CLI does — the message on stdout, an empty stderr, exit 1.",
    "if defined REFUSAL_CALLS (",
    '  >"%REFUSAL_CALLS%\\%COMPUTERNAME%.%RANDOM%-%RANDOM%.p%1-%2" echo %1 %2',
    ")",
    'if "%1"=="gateway" (',
    `  type "${ensureText}"`,
    "  exit /b 1",
    ")",
    "exit /b 0",
    "",
  ].join("\r\n");
  fs.writeFileSync(shim, script, "ascii");

  if (process.platform !== "win32") {
    // The same contract for a rig ever run off Windows. `which` resolves this
    // extensionless file, not the .cmd beside it.
    const posix = path.join(cliDir, "hermes");
    fs.writeFileSync(
      posix,
      [
        "#!/bin/sh",
        'if [ -n "$REFUSAL_CALLS" ]; then : > "$REFUSAL_CALLS/$(hostname).$$.p$1-$2"; fi',
        'if [ "$1" = "gateway" ]; then cat "$(dirname "$0")/refuse-ensure.txt"; exit 1; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(posix, 0o755);
    return { shim: posix, ensureText };
  }
  return { shim, ensureText };
}

/** The two verb atoms a marker file's name carries, or null for a foreign name. */
function markersOf(name) {
  const atom = /\.p([a-z][a-z-]*)$/.exec(name)?.[1];
  if (!atom) return null;
  return atom.split("-").filter(Boolean);
}

/** The invocation log the shim wrote, in time order. */
function readInvocationLog(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const calls = [];
  for (const name of names) {
    const argv = markersOf(name);
    if (!argv) continue;
    try {
      calls.push({ at: fs.statSync(path.join(dir, name)).birthtimeMs, argv, raw: name });
    } catch {
      /* removed under us; nothing to report */
    }
  }
  return calls.sort((a, b) => a.at - b.at);
}

async function main() {
  if (!(await portIsFree(LOCAL_PORT)) || !(await portIsFree(INVITE_PORT))) {
    throw new Error(
      `the e2e door ports ${LOCAL_PORT}/${INVITE_PORT} are not free; nothing may be bound there before this rig runs`,
    );
  }
  const hostPort = await freePort();

  const dir = path.join(tmp, "world");
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const callsDir = path.join(dir, "hermes-calls");
  const resultFile = path.join(dir, "result.json");
  const cliDir = path.join(tmp, "bin");
  for (const p of [
    hermesHome,
    path.join(hermesHome, "profiles", PROFILE),
    userData,
    callsDir,
  ]) {
    fs.mkdirSync(p, { recursive: true });
  }

  const { shim } = writeHermesShim(cliDir);

  // The host port the app reads: a dead one. Nothing is listening, so the first
  // attach candidate is a refused connection rather than a twenty-second wait,
  // and the app goes straight to the gateway commands this rig is about.
  fs.writeFileSync(path.join(hermesHome, ".env"), `API_SERVER_PORT=${hostPort}\n`, "utf8");
  // The profile the app is on. `getCompanionProfile` reads this file, and the
  // name is what keeps every `/p/<name>/health` on this machine a 404.
  fs.writeFileSync(
    path.join(userData, "recent.json"),
    `${JSON.stringify(
      {
        recent: [],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROFILE,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const spec = {
    profile: PROFILE,
    localPort: LOCAL_PORT,
    invitePort: INVITE_PORT,
    hostPort,
    hermesHome,
    callsDir,
    resultFile,
    shim,
    devServerUrl: DEV_SERVER,
    // The app has to probe a dead port, run two `config set`s and then two
    // gateway commands that refuse. The two refusals are fast; this is slack.
    timeoutMs: 90_000,
  };
  fs.writeFileSync(path.join(dir, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`, "utf8");

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // The operator's Hermes home is never opened: `hermesRoot` reads HERMES_HOME
  // first, and every path this run writes lives under the temp one.
  env.HERMES_HOME = hermesHome;
  // PATH is spelled `Path` on this machine, and assigning `env.PATH` would add a
  // SECOND variable rather than prepend to the one Windows reads — the child
  // would then resolve the operator's real `hermes`, the one thing this rig must
  // never run.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  env[pathKey] = `${cliDir}${path.delimiter}${env[pathKey] ?? ""}`;
  env.VITE_DEV_SERVER_URL = DEV_SERVER;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData,
    showWindow: false,
    mcpPorts: { local: LOCAL_PORT, invite: INVITE_PORT },
  });
  env.LIFEQUEST_COMPANION_REFUSAL = JSON.stringify(spec);
  env.REFUSAL_CALLS = callsDir;

  note(`world ${dir}; fake hermes ${shim}; dead host port ${hostPort}; profile ${PROFILE}`);

  const child = spawn(electron, [DRIVER], { cwd: desktopRoot, stdio: "inherit", env });
  children.add(child);

  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      note(`the app did not exit within ${(spec.timeoutMs / 1000).toFixed(0)}s and was killed`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve({ code: null, signal: "timeout" });
    }, spec.timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      note(`electron could not be spawned: ${error.message}`);
      resolve({ code: null, signal: "spawn-error" });
    });
  });
  children.delete(child);

  const result = fs.existsSync(resultFile)
    ? JSON.parse(fs.readFileSync(resultFile, "utf8"))
    : null;
  if (!result) note("the driver wrote no result file");

  record = {
    pass: false,
    failures: [],
    what: "the real LifeQuest app against a Hermes CLI that refuses `gateway ensure` the way the real one refuses: the message on stdout, an empty stderr, exit 1. Does the setup screen carry the CLI's own words, without restarting any gateway?",
    why: "a fresh install stopped at the companion stage showing 'Hermes gateway exited / hermes gateway start exited 1' — the app read stderr only, Hermes prints refusals on stdout, and the first command's failure was swallowed by a bare catch; it also restarted the shared host gateway to fix one profile",
    profile: PROFILE,
    fakeCli: shim,
    ports: { local: LOCAL_PORT, invite: INVITE_PORT, host: hostPort },
    exit: outcome,
    result,
    cliLog: readInvocationLog(callsDir),
    notes,
  };

  judge(record);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * The verdicts, made from outside the app: the driver's own observations plus
 * this process's view of the CLI log and the app's exit.
 */
function judge(run) {
  const add = (name, ok, detail) => {
    run.checks.push({ name, pass: Boolean(ok), detail: detail ?? null });
    if (!ok) run.failures.push(`${name} — ${detail ?? ""}`);
    return Boolean(ok);
  };
  run.checks = [];

  const res = run.result ?? {};
  const detail = typeof res.detail === "string" ? res.detail : "";
  const is = (call, verb) => call.argv[0] === "gateway" && call.argv[1] === verb;
  const gatewayCalls = run.cliLog.filter((c) => c.argv[0] === "gateway");
  const configCalls = run.cliLog.filter((c) => c.argv[0] === "config");
  const screen = res.screen ?? {};

  add(
    "the driver ran and reached a companion status",
    res.ran === true && typeof res.kind === "string",
    JSON.stringify({ ran: res.ran ?? null, kind: res.kind ?? null }),
  );
  add(
    "the CLI the app ran is this run's shim",
    res.cliPath === run.fakeCli,
    `resolved: ${JSON.stringify(res.cliPath)} expected ${run.fakeCli}`,
  );
  add(
    "the recorder was live: the app's own `config set` is in the log",
    configCalls.length >= 1,
    JSON.stringify(configCalls.map((c) => c.argv)),
  );
  add(
    "the app asked the CLI to ensure the gateway, and never to restart or start it",
    gatewayCalls.some((c) => is(c, "ensure")) &&
      !gatewayCalls.some((c) => is(c, "restart") || is(c, "start")),
    JSON.stringify(gatewayCalls.map((c) => c.argv)),
  );
  add(
    "the app reported gateway_exited",
    res.kind === "gateway_exited",
    JSON.stringify({ kind: res.kind ?? null, detail: detail.slice(0, 400) }),
  );
  add(
    "the reported detail carries the ensure refusal the app used to swallow",
    detail.includes(ENSURE_SENTENCE),
    JSON.stringify(detail.slice(0, 600)),
  );
  add(
    "the reported detail is not just an exit-code fallback",
    detail.trim().length > 0 && !/^hermes [^\n]* exited \d+$/.test(detail.trim()),
    JSON.stringify(detail.slice(0, 200)),
  );
  add(
    "the setup screen is the companion screen, and its lead names the failure",
    screen.heading === "LifeQuest companion" && screen.lead === "Hermes gateway exited",
    JSON.stringify({ heading: screen.heading ?? null, lead: screen.lead ?? null }),
  );
  add(
    "the setup screen body shows the CLI's own sentence",
    typeof screen.body === "string" && screen.body.includes(ENSURE_SENTENCE),
    JSON.stringify((screen.body ?? "").slice(0, 400)),
  );

  run.pass = run.failures.length === 0;
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  if (finished) return;
  finished = true;
  if (!process.env.LIFEQUEST_E2E_KEEP_TMP) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      note(`could not remove ${tmp}`);
    }
  } else {
    note(`kept ${tmp}`);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

main()
  .then((run) => {
    console.log(`[refusal] ${run.pass ? "PASS" : "FAIL"}: ${REPORT}`);
    for (const check of run.checks) {
      console.log(`[refusal]   ${check.pass ? "ok  " : "FAIL"} ${check.name}`);
    }
    for (const message of run.failures) console.error(`[refusal]   ${message}`);
    cleanup();
    process.exit(run.pass ? 0 : 1);
  })
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
    try {
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(
        REPORT,
        `${JSON.stringify({ pass: false, failures, notes, generatedAt: new Date().toISOString() }, null, 2)}\n`,
      );
    } catch {
      /* nothing left to write to */
    }
    cleanup();
    process.exit(1);
  });
