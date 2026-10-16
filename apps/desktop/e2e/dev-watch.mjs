/**
 * Drives a REAL `npm run dev` and proves that a main-process source change
 * reaches the app that is running, turning what actually happens into
 * `e2e/artifacts/dev-watch.json`.
 *
 * Run through its test (`tests/dev-watch-e2e.test.ts`), or directly with:
 *
 *   node e2e/dev-watch.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact.
 *
 * THE CLAIM
 *
 * `npm run dev` builds the main process once and launches Electron. The renderer
 * is Vite's: it hot-replaces on every save. The main process is not, and until
 * this script watched its sources, a change to `electron/**` or to
 * `packages/vault-core/src/**` was invisible for the life of the process — the
 * window kept painting, the app kept working, and the code under development was
 * simply not the code being run. That is the failure this rig exists to catch,
 * and it cannot be caught by reading the script: it is caught by editing a file
 * and looking for the edit in a process that was already up.
 *
 * SO THE PROBE IS THE PRODUCT'S OWN OUTPUT
 *
 * The rig appends one line to a module the main process bundles:
 *
 *   console.log("[dev-watch-probe] <token> pid=" + process.pid);
 *
 * That line is the entire instrument, and it is deliberately the crudest one
 * available. It proves the bundle was REWRITTEN (the token is in the source and
 * was not in any earlier bundle) and that a process EVALUATED it (it is in the
 * log), and the pid in it separates those two facts: a rebundle without a
 * relaunch would leave the token unprinted, and a relaunch of an old bundle would
 * print nothing new. Neither can pass this rig.
 *
 * WHY A SECOND CHECKOUT AND NOT THE OPERATOR'S
 *
 * This rig edits real source files and rebuilds a real bundle. It runs in
 * whatever checkout it is invoked from, on its own ports and its own throwaway
 * profile, so it cannot disturb an operator's dev session, their app, or their
 * vault. `LIFEQUEST_DEV_PORT` is what lets the second checkout exist at all — see
 * `scripts/dev.mjs`.
 *
 * THE LEGS, AND WHAT EACH ONE FALSIFIES
 *
 *   boot      Nothing is printed before the edit: the token is ours.
 *   change    A one-line edit reaches a NEW pid. The claim itself.
 *   renderer  A change under `src/` rebundles NOTHING and relaunches NOTHING —
 *             the control that stops "restart on every save" from passing.
 *   broken    A bundle that cannot build leaves the running app ALIVE, on the pid
 *             it already had. The design decision that a typo must not cost you
 *             your dev session.
 *   recover   The next good save relaunches again, from the broken state, with no
 *             manual restart. What makes the failure mode recoverable.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "dev-watch.json");
const DEV_MJS = path.join(desktopRoot, "scripts", "dev.mjs");

/**
 * The module the probe is appended to, and the bundle it lands in.
 *
 * A small module the entry imports rather than the entry itself: the probe has
 * to run when the main process evaluates the bundle, and it has to be trivially
 * restorable. `data-revision.ts` is imported by `main.ts` at line 19, so a line
 * at its top level runs on every launch — and it is 7 kB of one concern, which
 * makes putting it back exactly what it was a copy rather than a merge.
 */
const PROBE_FILE = path.join(desktopRoot, "electron", "data-revision.ts");
const BUNDLE = path.join(desktopRoot, "dist-electron", "main.js");
/** A renderer file, for the control leg: an edit here must NOT restart the app. */
const RENDERER_PROBE = path.join(desktopRoot, "src", "__dev-watch-probe.ts");

const TOKEN_A = `watchA-${Date.now().toString(36)}`;
const TOKEN_B = `watchB-${Date.now().toString(36)}`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * A silent `hermes` that is first on PATH.
 *
 * The app spawns this CLI on vault open. Without a shim the operator's real
 * Hermes would be the thing the app talked to, and one of the commands it runs is
 * `gateway restart` — a test that restarts the operator's own assistant is not a
 * test anybody can run twice.
 */
function writeHermesShim(cliDir) {
  fs.mkdirSync(cliDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(cliDir, "hermes.cmd"),
      ["@echo off", "rem A fake hermes, first on PATH: exit 0, say nothing.", "exit /b 0", ""].join("\r\n"),
      "ascii",
    );
  } else {
    const shim = path.join(cliDir, "hermes");
    fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(shim, 0o755);
  }
}

/** Whether a pid is still there, asked of the OS rather than of our own bookkeeping. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Every probe line the app has printed, newest last. */
function probesIn(log) {
  const out = [];
  const pattern = /\[dev-watch-probe\] (\S+) pid=(\d+)/g;
  let match;
  while ((match = pattern.exec(log)) !== null) {
    out.push({ token: match[1], pid: Number(match[2]) });
  }
  return out;
}

/**
 * How many times the script has REPLACED a running app.
 *
 * Counted from the script's own words rather than inferred, because "launching"
 * and "relaunching" are different events and only the second one is the watcher:
 * the first launch happens once, at the top of `main()`, and every relaunch after
 * it is a source change that was noticed.
 */
function relaunchesIn(log) {
  return (log.match(/\[dev\] relaunching Electron/g) ?? []).length;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-dev-watch-"));
  const profileDir = path.join(workDir, "profile");
  const hermesHome = path.join(workDir, "hermes");
  const cliDir = path.join(workDir, "bin");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesShim(cliDir);

  const devPort = await freePort();
  const localPort = await freePort();
  const invitePort = await freePort();

  /** The bundle's own bytes, so a rebundle is observable and not inferred. */
  const bundleBefore = fs.existsSync(BUNDLE) ? fs.statSync(BUNDLE).mtimeMs : null;

  const env = { ...process.env };
  // Without this the Electron this script spawns runs as plain Node, and for the
  // Electron the dev script spawns with it inherited: no window, no app.
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = hermesHome;
  env.PATH = `${cliDir}${path.delimiter}${env.PATH ?? ""}`;
  env.LIFEQUEST_DEV_PORT = String(devPort);
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: localPort, invite: invitePort },
  });

  /** Everything the dev script and the app it launched have said. */
  let log = "";
  let dev = null;
  const checks = { devPort, localPort, invitePort, bundleBefore, legs: {} };
  const originalProbeFile = fs.readFileSync(PROBE_FILE, "utf8");

  const settle = async (ms) => {
    await sleep(ms);
  };

  /** Wait until the log satisfies a predicate, or give up and say what is missing. */
  async function waitForLog(label, predicate, timeoutMs = 45_000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (predicate(log)) return true;
      await sleep(100);
    }
    return false;
  }

  try {
    dev = spawn(process.execPath, [DEV_MJS], { cwd: desktopRoot, stdio: ["ignore", "pipe", "pipe"], env });
    dev.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    dev.stderr.on("data", (chunk) => {
      log += chunk.toString();
    });

    // ── boot ────────────────────────────────────────────────────────────────
    const watching = await waitForLog("the watcher to install", (text) =>
      text.includes("[dev] watching "),
    );
    if (!watching) failure("the dev script never reported a watcher");
    // The app's own first line is an FX rate it fetches over the network, so it
    // is a nice confirmation and a bad precondition: offline, the line never
    // comes and the app is fine. Recorded, never fatal — the claim below does not
    // rest on it, because only a source change can produce a RELAUNCH.
    const appSaidSomething = await waitForLog(
      "the app's first line",
      (text) => text.includes("[fx]"),
      45_000,
    );
    await settle(1500);

    checks.legs.boot = {
      watcherInstalled: watching,
      appSaidSomething,
      relaunches: relaunchesIn(log),
      probes: probesIn(log),
    };
    if (probesIn(log).length !== 0) {
      failure("a probe line was printed before the rig edited anything, so the probe is not ours");
    }
    if (relaunchesIn(log) !== 0) {
      failure("the app was relaunched before anything was edited");
    }

    // ── the claim: a main-process edit reaches a running app ───────────────
    const bundleBeforeEdit = fs.statSync(BUNDLE).mtimeMs;
    fs.writeFileSync(
      PROBE_FILE,
      `${originalProbeFile}\nconsole.log("[dev-watch-probe] ${TOKEN_A} pid=" + process.pid);\n`,
    );
    const sawRebundle = await waitForLog("the rebundle notice", (text) =>
      text.includes("rebundling electron main + preload"),
    );
    const sawProbeA = await waitForLog("the probe to be printed", (text) =>
      text.includes(`${TOKEN_A} pid=`),
    );
    await settle(500);
    const bundleAfterEdit = fs.statSync(BUNDLE).mtimeMs;
    const probesA = probesIn(log).filter((probe) => probe.token === TOKEN_A);
    checks.legs.change = {
      rebundleAnnounced: sawRebundle,
      bundleRewritten: bundleAfterEdit > bundleBeforeEdit,
      probePrinted: sawProbeA,
      relaunches: relaunchesIn(log),
      probes: probesA,
    };
    if (!sawRebundle) failure("a main-process edit did not announce a rebundle");
    if (!(bundleAfterEdit > bundleBeforeEdit)) {
      failure("a main-process edit did not rewrite dist-electron/main.js");
    }
    if (relaunchesIn(log) < 1) {
      failure("a main-process edit rebundled but did not replace the running app");
    }
    if (probesA.length === 0) {
      failure("the edit never reached the running app: the new code was bundled but not launched");
    }
    const pidA = probesA[0]?.pid ?? null;
    checks.legs.change.pid = pidA;

    // ── the control: a renderer edit must not restart the main process ─────
    // Without this leg, a script that restarted Electron on ANY file change would
    // pass everything above, and would be a strictly worse experience than the
    // bug it replaced.
    const probeCountBeforeRenderer = probesIn(log).length;
    fs.writeFileSync(RENDERER_PROBE, "// dev-watch e2e: a renderer file, deliberately not watched\n");
    await settle(4000);
    const probeCountAfterRenderer = probesIn(log).length;
    checks.legs.renderer = {
      probesBefore: probeCountBeforeRenderer,
      probesAfter: probeCountAfterRenderer,
      relaunched: probeCountAfterRenderer > probeCountBeforeRenderer,
    };
    if (probeCountAfterRenderer > probeCountBeforeRenderer) {
      failure("a change under src/ relaunched the main process");
    }
    fs.rmSync(RENDERER_PROBE, { force: true });

    // ── a bundle that cannot build must not cost the running app ───────────
    const pidBeforeBroken = probesIn(log).at(-1)?.pid ?? pidA;
    fs.writeFileSync(
      PROBE_FILE,
      `${originalProbeFile}\nconst broken = ;\nconsole.log("[dev-watch-probe] ${TOKEN_B} pid=" + process.pid);\n`,
    );
    const sawBroken = await waitForLog("the rebundle failure", (text) =>
      text.includes("the rebundle failed"),
    );
    await settle(2500);
    const probesAfterBroken = probesIn(log);
    checks.legs.broken = {
      failureReported: sawBroken,
      pidBefore: pidBeforeBroken,
      appStillAlive: pidBeforeBroken === null ? null : alive(pidBeforeBroken),
      newProbes: probesAfterBroken.length - probeCountAfterRenderer,
      devStillRunning: dev.exitCode === null,
    };
    if (!sawBroken) failure("a source file that cannot build did not report a failure");
    if (pidBeforeBroken !== null && !alive(pidBeforeBroken)) {
      failure("a broken build killed the app that was already running");
    }
    if (probesAfterBroken.length > probeCountAfterRenderer) {
      failure("a broken build was launched anyway");
    }

    // ── and the next good save brings it back, with no manual restart ──────
    fs.writeFileSync(
      PROBE_FILE,
      `${originalProbeFile}\nconsole.log("[dev-watch-probe] ${TOKEN_B} pid=" + process.pid);\n`,
    );
    const sawRecovery = await waitForLog("the recovery probe", (text) =>
      text.includes(`${TOKEN_B} pid=`),
    );
    await settle(500);
    const probesB = probesIn(log).filter((probe) => probe.token === TOKEN_B);
    checks.legs.recover = { probePrinted: sawRecovery, probes: probesB };
    if (!sawRecovery) {
      failure("the app did not recover on the next good save: a typo left dev stuck");
    }
    if (probesB[0]?.pid != null && probesB[0].pid === pidBeforeBroken) {
      failure("the recovering bundle was evaluated by the OLD process, so nothing was relaunched");
    }

    // ── put the source back exactly as it was ─────────────────────────────
    const relaunchesBeforeRestore = relaunchesIn(log);
    fs.writeFileSync(PROBE_FILE, originalProbeFile);
    const restored = await waitForLog(
      "the restore relaunch",
      (text) => relaunchesIn(text) > relaunchesBeforeRestore,
      20_000,
    );
    checks.legs.restore = {
      relaunchesBefore: relaunchesBeforeRestore,
      relaunchesAfter: relaunchesIn(log),
      relaunched: restored,
    };
    checks.sourceRestored = fs.readFileSync(PROBE_FILE, "utf8") === originalProbeFile;
    if (!checks.sourceRestored) failure("the rig did not restore the source file it edited");
  } catch (error) {
    failure(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    // The source is restored whatever happened, and the dev tree is stopped —
    // including the Electron it spawned, which is why the tree is killed and not
    // just the script.
    try {
      fs.writeFileSync(PROBE_FILE, originalProbeFile);
    } catch {
      // Nothing useful to do; the report carries the failure.
    }
    fs.rmSync(RENDERER_PROBE, { force: true });
    if (dev && dev.exitCode === null) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        dev.kill("SIGTERM");
      }
      await sleep(1500);
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "a main-process source change rebundles and relaunches the app under `npm run dev`, a " +
      "renderer change does not, and a bundle that cannot build leaves the running app alive",
    command: "node e2e/dev-watch.mjs  (also reached by npm test via tests/dev-watch-e2e.test.ts)",
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `[dev-watch] change: rebundled=${checks.legs.change?.rebundleAnnounced} newPid=${checks.legs.change?.pid}`,
  );
  console.log(
    `[dev-watch] renderer edit: relaunched=${checks.legs.renderer?.relaunched} (must be false)`,
  );
  console.log(
    `[dev-watch] broken build: reported=${checks.legs.broken?.failureReported} appAlive=${checks.legs.broken?.appStillAlive}`,
  );
  console.log(`[dev-watch] recovery pid=${checks.legs.recover?.probes?.[0]?.pid ?? "none"}`);
  console.log(`[dev-watch] failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[dev-watch] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
