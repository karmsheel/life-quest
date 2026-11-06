#!/usr/bin/env node
/**
 * E2E for the weekly agent-cli evidence refresh.
 *
 * Black-box: it runs the real script and the real systemd units, then checks
 * the artefacts they produce. Nothing here is mocked.
 *
 * What it proves:
 *   1. `refresh-agent-cli.sh --check` reports status and changes nothing.
 *   2. A full refresh run produces the mined evidence, a fresh benchmark and
 *      a passing CLI E2E, and leaves the repo tree clean.
 *   3. The refresh never writes inside the repo's tracked files.
 *   4. The systemd units are valid and the timer is armed.
 *   5. The deferral path works: with the bench lock held by someone else, the
 *      refresh exits 75 instead of racing the test run.
 *
 * Usage:
 *   node bin/agent-cli-refresh.e2e.mjs           full run (refreshes evidence)
 *   node bin/agent-cli-refresh.e2e.mjs --check   status-only checks, no refresh
 *
 * Exit: 0 pass, 1 fail.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(REPO, "scripts", "refresh-agent-cli.sh");
const SCRATCH = path.join(REPO, ".scratch", "agent-cli");
const LOG_DIR = process.env.AGENT_CLI_REFRESH_LOG_DIR || "/var/log/agent-cli-refresh";
const OUT_DIR = path.join(REPO, ".scratch", "agent-cli", "refresh-e2e");

const CHECK_ONLY = process.argv.includes("--check");
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  process.stdout.write(`${mark}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}\n`);
}

function run(argv, opts = {}) {
  return spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd || REPO,
    encoding: "utf8",
    timeout: opts.timeout || 900000,
    maxBuffer: 32 * 1024 * 1024,
    env: opts.env || process.env,
  });
}

function gitStatus() {
  const r = run(["git", "-C", REPO, "status", "--porcelain"], { timeout: 30000 });
  return (r.stdout || "").trim();
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// --- 1. status mode ---------------------------------------------------------
const before = gitStatus();
const statusRun = run([SCRIPT, "--check"], { timeout: 120000 });
check("refresh --check exits 0", statusRun.status === 0, `exit=${statusRun.status}`);
check(
  "refresh --check reports the CLI sha and corpus size",
  /cli\.sha256=[0-9a-f]{64}/.test(statusRun.stdout || "") && /corpus\.sessions=\d+/.test(statusRun.stdout || ""),
  (statusRun.stdout || "").split("\n").slice(0, 3).join(" | "),
);
check("refresh --check changes nothing in the repo", gitStatus() === before, "git status delta");

// --- 2. systemd units -------------------------------------------------------
if (!CHECK_ONLY) {
  const verify = run(["systemd-analyze", "verify", "/etc/systemd/system/agent-cli-refresh.service"], { timeout: 60000 });
  check(
    "systemd service unit is valid",
    !/bad unit file setting|Refusing\./.test(verify.stdout || "") && !/bad unit file setting|Refusing\./.test(verify.stderr || ""),
    (verify.stderr || "").split("\n").filter((l) => /agent-cli/.test(l)).join(" | ") || "ok",
  );

  const timers = run(["systemctl", "list-timers", "agent-cli-refresh.timer", "--no-pager"], { timeout: 60000 });
  const timerLine = (timers.stdout || "")
    .split("\n")
    .find((l) => l.includes("agent-cli-refresh.timer") && /\d{4}-\d{2}-\d{2}/.test(l));
  check(
    "the weekly timer is armed with a next run",
    Boolean(timerLine),
    timerLine ? timerLine.trim() : (timers.stdout || "").trim(),
  );
  const enabled = run(["systemctl", "is-enabled", "agent-cli-refresh.timer"], { timeout: 30000 });
  check("the timer is enabled (survives reboot)", (enabled.stdout || "").trim() === "enabled", (enabled.stdout || "").trim());
}

// --- 3. deferral when the bench is busy -------------------------------------
if (!CHECK_ONLY) {
  const lock = "/run/lifequest-e2e.lock";
  // Hold the bench lock in the BACKGROUND for the duration of the probe, so
  // the deferral path is genuinely exercised rather than skipped when the
  // bench happens to be idle. This is the same lock lifequest-e2e takes.
  // `flock <file> -c ...` holds it for the child's lifetime; `flock <fd>` in
  // a shell keeps it open until that shell exits.
  const holder = spawn("flock", [lock, "-c", "sleep 60"], { stdio: "ignore", detached: true });
  holder.unref();
  // Give the holder a moment to take the lock, then confirm we cannot.
  const deadline = Date.now() + 10000;
  let lockedByUs = false;
  while (Date.now() < deadline) {
    const probe = spawnSync("flock", ["-w", "1", lock, "-c", "true"], { encoding: "utf8", timeout: 10000 });
    if (probe.status !== 0) {
      lockedByUs = true;
      break;
    }
    sleepMs(500);
  }

  if (lockedByUs) {
    const deferred = run([SCRIPT], {
      timeout: 120000,
      env: { ...process.env, AGENT_CLI_REFRESH_BENCH_WAIT: "3" },
    });
    check(
      "a busy bench makes the refresh defer (exit 75), not race",
      deferred.status === 75,
      `exit=${deferred.status}`,
    );
    const logTail = run(["bash", "-c", `tail -5 ${LOG_DIR}/$(date +%Y-%m-%d).log`], { timeout: 30000 });
    check(
      "the deferred refresh says why, in the log",
      /bench still busy|deferring/i.test(logTail.stdout || ""),
      (logTail.stdout || "").trim().split("\n").slice(-2).join(" | "),
    );
  } else {
    check("could not hold the bench lock; deferral path not exercised", false, "probe acquired the lock");
  }
  try { process.kill(-holder.pid, "SIGTERM"); } catch {}
}

// --- 4. a full refresh ------------------------------------------------------
if (!CHECK_ONLY) {
  const beforeStatus = gitStatus();
  const refresh = run([SCRIPT], { timeout: 1800000 });
  check("a full refresh exits 0", refresh.status === 0, `exit=${refresh.status}`);

  const repeats = path.join(SCRATCH, "repeats.json");
  const report = path.join(SCRATCH, "bench", "report.md");
  const e2eJson = path.join(SCRATCH, "bench", "e2e.json");
  const frozen = path.join(SCRATCH, "FROZEN.json");

  check("the mined evidence exists", fs.existsSync(repeats), repeats);
  check("the benchmark report exists", fs.existsSync(report), report);
  check("the freeze manifest exists", fs.existsSync(frozen), frozen);

  if (fs.existsSync(frozen)) {
    const f = JSON.parse(fs.readFileSync(frozen, "utf8"));
    check(
      "the freeze manifest records counts and a sha",
      Boolean(f.sha256 && f.counts?.sessions > 0 && f.counts?.toolCalls > 0),
      `sessions=${f.counts?.sessions} calls=${f.counts?.toolCalls} sha=${String(f.sha256).slice(0, 16)}`,
    );
  }

  if (fs.existsSync(e2eJson)) {
    const e = JSON.parse(fs.readFileSync(e2eJson, "utf8"));
    const passed = e.passed ?? e.summary?.passed ?? e.checks?.filter?.((c) => c.ok).length;
    const total = e.total ?? e.summary?.total ?? e.checks?.length;
    check("the CLI's own E2E passed inside the refresh", Number(passed) > 0 && Number(passed) === Number(total), `${passed}/${total}`);
  }

  // The refresh must not add or change ANY tracked file. Compare the set of
  // changed paths before and after, so pre-existing edits (this branch's own
  // work) do not mask a file the refresh quietly wrote.
  const changedNow = new Set(gitStatus().split("\n").filter(Boolean).map((l) => l.slice(3).trim()));
  const changedBefore = new Set(beforeStatus.split("\n").filter(Boolean).map((l) => l.slice(3).trim()));
  const added = [...changedNow].filter((p) => !changedBefore.has(p));
  const removed = [...changedBefore].filter((p) => !changedNow.has(p));
  check(
    "the refresh changed no repo file",
    added.length === 0 && removed.length === 0,
    added.length || removed.length ? `added=${added.join(",")} removed=${removed.join(",")}` : "no new or removed paths",
  );

  const latest = path.join(LOG_DIR, "latest.md");
  check("a human-readable run summary exists", fs.existsSync(latest), latest);
  if (fs.existsSync(latest)) {
    const text = fs.readFileSync(latest, "utf8");
    check("the summary reports the corpus size and the E2E verdict", /corpus: \d+ sessions/.test(text) && /E2E: \*\*(pass|fail)\*\*/.test(text), text.split("\n")[2] ?? "");
  }
}

// --- write the artifact ----------------------------------------------------
const artifact = {
  generatedAt: new Date().toISOString(),
  mode: CHECK_ONLY ? "check" : "full",
  repo: REPO,
  passed: results.filter((r) => r.ok).length,
  failed: failures,
  checks: results,
};
fs.writeFileSync(path.join(OUT_DIR, "refresh-e2e.json"), JSON.stringify(artifact, null, 2) + "\n");
fs.writeFileSync(
  path.join(OUT_DIR, "refresh-e2e.log"),
  results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`).join("\n") + "\n",
);

process.stdout.write(`\nagent-cli refresh E2E: ${artifact.passed} passed, ${failures} failed\n`);
process.stdout.write(`artifact: ${path.join(OUT_DIR, "refresh-e2e.json")}\n`);
process.exit(failures === 0 ? 0 : 1);
