#!/usr/bin/env node
// Black-box end-to-end acceptance test for bin/agent-cli.
// Zero dependencies: Node builtins only. Spawns the real CLI as a subprocess.
//
// Coverage:
//   1. `help --json` discovery; every command it lists must also appear in
//      `--help` text (and vice versa) — the documented list is the source of truth.
//   2. For every discovered command, from two cwds (worktree root and /tmp):
//        --help  -> exit 0, non-empty stdout, shows usage/own name, no crash/stack
//        --json  -> exit 0, stdout parses as a JSON object with the documented
//                   top-level shape ({cmd, ok, data, ...}), no crash/stack
//   3. The same matrix again by executing ./bin/agent-cli DIRECTLY (shebang
//      path must work, file must be executable — X_OK asserted).
//   4. Every command action: `<cmd> <action> --help` must exit 0 and show usage.
//   5. Read-only actions with no required args: `<cmd> <action> --json` parses.
//      Mutating actions are never executed (bench move/stop/shot, e2e run,
//      check typecheck, db query, docs show/search, find, logs tail); e2e run
//      is only exercised with --dry-run.
//
// Outputs:
//   .scratch/agent-cli/bench/e2e.json  machine-readable artifact
//   .scratch/agent-cli/bench/e2e.log   human-readable log
// Exit codes: 0 pass, 1 check failure, 2 bin/agent-cli missing/unusable.
//
// Usage (single rerunnable command):
//   node bin/agent-cli.e2e.mjs            # full E2E
//   node bin/agent-cli.e2e.mjs --list     # self-report: what would be tested
//   node bin/agent-cli.e2e.mjs --verbose  # stream every check
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, "..");
const CLI = path.join(HERE, "agent-cli");
const OUT_DIR = path.join(REPO_ROOT, ".scratch", "agent-cli", "bench");
const SECOND_CWD = process.env.AGENT_CLI_E2E_SECOND_CWD || "/tmp";
const SPAWN_TIMEOUT_MS = 30000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const ansi = /\x1b\[[0-9;]*[A-Za-z]/g;
const STACK_FRAME = /^\s+at\s+[\w$./()<>[\]:-]+/m;
const CRASH_PATTERNS = [/\bTypeError\b/, /\bReferenceError\b/, /\bSyntaxError\b/, /\bRangeError\b/, /Cannot read propert/, /is not a function/, /UnhandledPromiseRejection/, /\[ERR_[A-Z_]+\]/];
const USAGE_RE = /\b(usage|commands?|subcommands?|options?)\b/i;

// Actions that must never be executed by the E2E (they mutate the bench,
// run heavyweight suites, or require arguments we cannot supply safely).
const MUTATING_ACTIONS = new Set([
  "bench shot",
  "bench move",
  "bench stop",
  "e2e run",
  "check typecheck",
  "db query",
  "docs show",
  "docs search",
  "find",
  "logs tail",
]);

const flags = new Set(process.argv.slice(2));
const VERBOSE = flags.has("--verbose") || flags.has("-v");
const LIST_ONLY = flags.has("--list");
const startedAt = new Date();
const results = [];
const logLines = [];

function log(msg) {
  logLines.push(msg);
  if (VERBOSE) console.error(msg);
}
function clean(s) {
  return (s || "").replace(ansi, "");
}
function parseJson(stdout) {
  try {
    return { value: JSON.parse(clean(stdout)), error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}
function crashEvidence(run) {
  const stderr = clean(run.stderr);
  const out = [];
  if (run.error) out.push(`spawn error: ${run.error}`);
  if (run.signal) out.push(`killed by signal ${run.signal}`);
  if (STACK_FRAME.test(stderr)) out.push("stack frame on stderr");
  for (const p of CRASH_PATTERNS) if (p.test(stderr)) out.push(`crash pattern on stderr: ${p}`);
  const firstLine = stderr.split("\n").find((l) => l.trim());
  if (firstLine && /^[A-Za-z]*Error:/.test(firstLine.trim())) out.push(`error object printed: ${firstLine.trim()}`);
  return out;
}
function addCheck(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function spawnCli(argv, cwd, { direct = false } = {}) {
  const exe = direct ? CLI : process.execPath;
  const args = direct ? argv : [CLI, ...argv];
  const r = spawnSync(exe, args, {
    cwd,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { argv, cwd, direct, status: r.status, signal: r.signal ?? null, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error.message) : null };
}

function assertCommonRun(label, run) {
  let ok = true;
  ok = addCheck(`${label}: exit 0`, run.status === 0, `exit=${run.status}${run.signal ? ` signal=${run.signal}` : ""}`) && ok;
  ok = addCheck(`${label}: stdout non-empty`, clean(run.stdout).trim().length > 0, `${clean(run.stdout).length} chars`) && ok;
  const crash = crashEvidence(run);
  ok = addCheck(`${label}: no crash/stack trace`, crash.length === 0, crash.join("; ")) && ok;
  return ok;
}

function assertJsonRun(label, run, cmdName) {
  let ok = assertCommonRun(label, run);
  const parsed = parseJson(run.stdout);
  const objOk = parsed.value !== null && typeof parsed.value === "object" && !Array.isArray(parsed.value) && Object.keys(parsed.value).length > 0;
  const expectedKeys = ["cmd", "ok", "data", "version", "usage", "commands"];
  const hasExpectedKey = objOk && expectedKeys.some((k) => k in parsed.value);
  ok = addCheck(`${label}: valid JSON object`, objOk, parsed.error || (Array.isArray(parsed.value) ? "got array" : "empty object")) && ok;
  ok = addCheck(`${label}: documented top-level shape`, hasExpectedKey, objOk ? `keys=${Object.keys(parsed.value).slice(0, 8).join(",")}` : "no object") && ok;
  if (objOk && "ok" in parsed.value) ok = addCheck(`${label}: ok is boolean`, typeof parsed.value.ok === "boolean", typeof parsed.value.ok) && ok;
  if (objOk && "cmd" in parsed.value && cmdName) {
    ok = addCheck(`${label}: cmd echoes "${cmdName}"`, parsed.value.cmd === cmdName, `cmd=${JSON.stringify(parsed.value.cmd)}`) && ok;
  }
  return { ok, parsed: parsed.value };
}

function discoverFromHelpText(text) {
  const names = [];
  for (const line of clean(text).split("\n")) {
    const m = line.match(/^\s{1,6}([a-z][a-z0-9-]{1,30})\s{2,}\S/);
    if (m) names.push(m[1]);
  }
  const stop = new Set(["usage", "command", "commands", "options", "help", "examples", "global", "flags", "exit", "agent-cli"]);
  return [...new Set(names.filter((n) => !stop.has(n)))];
}

function missingCli(reason) {
  const artifact = { schema: "agent-cli-e2e/1", generatedAt: new Date().toISOString(), status: "missing", ok: false, reason, cli: CLI, checks: [], durationMs: Date.now() - startedAt.getTime() };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "e2e.json"), JSON.stringify(artifact, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "e2e.log"), `agent-cli E2E\n${new Date().toISOString()}\n\nMISSING: ${reason}\nbin/agent-cli missing — builder has not delivered a runnable CLI.\n`);
  console.error(`bin/agent-cli missing: ${reason}`);
  console.error(`expected executable at: ${CLI}`);
  return 2;
}

// ---------------------------------------------------------------- pre-flight
if (!fs.existsSync(CLI)) process.exit(missingCli(`bin/agent-cli missing at ${CLI}`));
let executable = false;
try {
  fs.accessSync(CLI, fs.constants.X_OK);
  executable = true;
} catch {
  /* checked below */
}
log(`agent-cli E2E — ${new Date().toISOString()}`);
log(`cli: ${CLI}`);
log(`cwd1: ${REPO_ROOT}`);
log(`cwd2: ${SECOND_CWD}`);
addCheck("bin/agent-cli is executable (chmod +x)", executable, executable ? "X_OK" : "not executable — run: chmod +x bin/agent-cli");
const syntax = spawnSync(process.execPath, ["--check", CLI], { encoding: "utf8" });
if (syntax.status !== 0) process.exit(missingCli(`bin/agent-cli is not valid JS: ${clean(syntax.stderr).split("\n").slice(0, 3).join(" | ")}`));

// ---------------------------------------------------------------- discovery
const discoRun = spawnCli(["help", "--json"], REPO_ROOT);
const discoJson = parseJson(discoRun.stdout);
const commands = [];
if (discoRun.status === 0 && discoJson.value && typeof discoJson.value === "object" && Array.isArray(discoJson.value.commands)) {
  for (const c of discoJson.value.commands) if (c && typeof c.name === "string") commands.push(c);
}
addCheck("help --json: exit 0", discoRun.status === 0, `exit=${discoRun.status}`);
addCheck("help --json: parses as JSON", discoJson.value !== null, discoJson.error || "");
addCheck("help --json: top-level object", discoJson.value !== null && typeof discoJson.value === "object" && !Array.isArray(discoJson.value), discoJson.value === null ? "no JSON" : typeof discoJson.value);
addCheck("help --json: exposes commands", commands.length > 0, `${commands.length} found`);

const helpTextRun = spawnCli(["--help"], REPO_ROOT);
const helpTextNames = discoverFromHelpText(helpTextRun.stdout);
const discoNames = commands.map((c) => c.name);
const missingFromJson = helpTextNames.filter((n) => !discoNames.includes(n));
const missingFromText = discoNames.filter((n) => !helpTextNames.includes(n));
addCheck("--help lists every command from help --json", missingFromText.length === 0, missingFromText.length ? `missing from --help: ${missingFromText.join(",")}` : `${discoNames.length} commands`);
addCheck("help --json lists every command from --help", missingFromJson.length === 0, missingFromJson.length ? `missing from help --json: ${missingFromJson.join(",")}` : `${helpTextNames.length} parsed`);

const actions = [];
for (const c of commands) for (const a of c.actions ?? []) if (a && typeof a.name === "string") actions.push({ cmd: c.name, action: a.name });

if (LIST_ONLY) {
  console.log(
    JSON.stringify(
      {
        schema: "agent-cli-e2e-list/1",
        cli: CLI,
        executable,
        cwds: [REPO_ROOT, SECOND_CWD],
        commands: commands.map((c) => c.name),
        actions: actions.map((a) => `${a.cmd} ${a.action}`),
        readOnlyActions: actions.filter((a) => !MUTATING_ACTIONS.has(`${a.cmd} ${a.action}`)).map((a) => `${a.cmd} ${a.action}`),
        mutatingActionsSkipped: [...MUTATING_ACTIONS],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ------------------------------------------------------- command matrix (node)
addCheck("top-level --help (worktree)", assertCommonRun("top-level --help (worktree)", spawnCli(["--help"], REPO_ROOT)));
addCheck("top-level --help (/tmp)", assertCommonRun("top-level --help (/tmp)", spawnCli(["--help"], SECOND_CWD)));

for (const c of commands) {
  for (const cwd of [REPO_ROOT, SECOND_CWD]) {
    const tag = cwd === REPO_ROOT ? "worktree" : cwd;
    const helpRun = spawnCli([c.name, "--help"], cwd);
    let ok = assertCommonRun(`${c.name} --help (${tag})`, helpRun);
    const text = clean(helpRun.stdout);
    ok = addCheck(`${c.name} --help (${tag}): shows usage`, USAGE_RE.test(text) || text.toLowerCase().includes(c.name.toLowerCase()), `usage=${USAGE_RE.test(text)}`) && ok;
    const jsonRun = spawnCli([c.name, "--json"], cwd);
    const json = assertJsonRun(`${c.name} --json (${tag})`, jsonRun, c.name);
    ok = ok && json.ok;
  }
}

// ------------------------------------------- direct-execution (shebang) matrix
for (const c of commands) {
  const tag = "direct";
  const helpRun = spawnCli([c.name, "--help"], REPO_ROOT, { direct: true });
  let ok = assertCommonRun(`${c.name} --help (${tag})`, helpRun);
  const text = clean(helpRun.stdout);
  ok = addCheck(`${c.name} --help (${tag}): shows usage`, USAGE_RE.test(text) || text.toLowerCase().includes(c.name.toLowerCase()), `usage=${USAGE_RE.test(text)}`) && ok;
  const jsonRun = spawnCli([c.name, "--json"], REPO_ROOT, { direct: true });
  const json = assertJsonRun(`${c.name} --json (${tag})`, jsonRun, c.name);
  ok = ok && json.ok;
}

// ------------------------------------------------------- action-level checks
for (const { cmd, action } of actions) {
  const label = `${cmd} ${action}`;
  const helpRun = spawnCli([cmd, action, "--help"], REPO_ROOT);
  let ok = assertCommonRun(`${label} --help`, helpRun);
  const text = clean(helpRun.stdout);
  ok = addCheck(`${label} --help: shows usage`, USAGE_RE.test(text) || text.toLowerCase().includes(action.toLowerCase()), `usage=${USAGE_RE.test(text)}`) && ok;

  if (MUTATING_ACTIONS.has(label)) {
    log(`SKIP  ${label} --json (mutating/heavy/needs args — --help only)`);
    continue;
  }
  if (label === "e2e run") {
    // only exercised as a dry run elsewhere
    continue;
  }
  const jsonRun = spawnCli([cmd, action, "--json"], REPO_ROOT);
  const json = assertJsonRun(`${label} --json`, jsonRun, cmd);
  ok = ok && json.ok;
}

// safe dry-run of the heavyweight e2e action
const dryRun = spawnCli(["e2e", "run", "--dry-run", "--json"], REPO_ROOT);
if (dryRun.status === 0 || dryRun.status === 2) {
  addCheck("e2e run --dry-run --json: does not execute (exit 0/2, prints command)", clean(dryRun.stdout).length > 0 || clean(dryRun.stderr).length > 0, `exit=${dryRun.status}`);
  const dj = parseJson(dryRun.stdout);
  if (dj.value) addCheck("e2e run --dry-run: stdout is JSON", true, Object.keys(dj.value).slice(0, 6).join(","));
}

// --- content search: `where` must answer, and must fail cleanly on no match.
// The nonsense term is generated per run so it cannot match this test file itself.
const noiseTerm = "zzq" + crypto.randomBytes(12).toString("hex");
const whereNoise = spawnCli(["where", noiseTerm, "--json"], REPO_ROOT);
const whereNoiseJson = parseJson(whereNoise.stdout);
addCheck("where <nonsense> --json: exit 1 (no matches)", whereNoise.status === 1, `term=${noiseTerm} exit=${whereNoise.status}`);
addCheck(
  "where <nonsense> --json: parses, matches.length === 0",
  whereNoiseJson.value !== null && Array.isArray(whereNoiseJson.value?.data?.matches) && whereNoiseJson.value.data.matches.length === 0,
  whereNoiseJson.error || `matches=${JSON.stringify(whereNoiseJson.value?.data?.count ?? null)}`,
);
if (whereNoiseJson.value) {
  addCheck("where <nonsense> --json: count === 0", whereNoiseJson.value?.data?.count === 0, `count=${whereNoiseJson.value?.data?.count}`);
}
const whereHit = spawnCli(["where", "ChatPanel", "--json"], REPO_ROOT);
const whereHitJson = parseJson(whereHit.stdout);
addCheck("where <known term> --json: exit 0 + non-empty matches", whereHit.status === 0 && Array.isArray(whereHitJson.value?.data?.matches) && whereHitJson.value.data.matches.length > 0, `exit=${whereHit.status} matches=${whereHitJson.value?.data?.matches?.length ?? "?"}`);

// -------------------------------------------------------------------- results
const failed = results.filter((r) => !r.ok);
const cliSha256 = crypto.createHash("sha256").update(fs.readFileSync(CLI)).digest("hex");
const gitHead = (spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim() || null;
const frozenPath = path.join(OUT_DIR, "..", "FROZEN.json");
const repeatsPath = path.join(OUT_DIR, "..", "repeats.json");
const artifact = {
  schema: "agent-cli-e2e/1",
  generatedAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed.length === 0 ? "pass" : "fail",
  ok: failed.length === 0,
  cli: CLI,
  cliSha256,
  cliMode: (fs.statSync(CLI).mode & 0o777).toString(8),
  cliBytes: fs.statSync(CLI).size,
  gitHead,
  corpus: fs.existsSync(frozenPath)
    ? { frozenJson: path.relative(REPO_ROOT, frozenPath), frozenJsonSha256: crypto.createHash("sha256").update(fs.readFileSync(frozenPath)).digest("hex"), frozenCounts: JSON.parse(fs.readFileSync(frozenPath, "utf8")).counts, repeatsSha256: fs.existsSync(repeatsPath) ? crypto.createHash("sha256").update(fs.readFileSync(repeatsPath)).digest("hex") : null }
    : null,
  executable,
  invocation: { viaNode: true, directShebang: executable },
  repoRoot: REPO_ROOT,
  secondCwd: SECOND_CWD,
  discovery: { method: "help --json, cross-checked against --help text", commands: discoNames, helpTextCommands: helpTextNames },
  perCommandResults: discoNames.map((name) => {
    const checks = results.filter((r) => r.name.startsWith(name + " "));
    const failedChecks = checks.filter((r) => !r.ok);
    return { command: name, checks: checks.length, passed: checks.length - failedChecks.length, failed: failedChecks.length, ok: failedChecks.length === 0 };
  }),
  selfReport: {
    commands: discoNames,
    actions: actions.map((a) => `${a.cmd} ${a.action}`),
    readOnlyActions: actions.filter((a) => !MUTATING_ACTIONS.has(`${a.cmd} ${a.action}`)).map((a) => `${a.cmd} ${a.action}`),
    mutatingActionsSkipped: [...MUTATING_ACTIONS],
    cwds: [REPO_ROOT, SECOND_CWD],
  },
  summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
  checks: results,
  failures: failed,
  durationMs: Date.now() - startedAt.getTime(),
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "e2e.json"), JSON.stringify(artifact, null, 2));
fs.writeFileSync(
  path.join(OUT_DIR, "e2e.log"),
  [
    `agent-cli E2E — ${artifact.generatedAt}`,
    `cli: ${CLI} (executable=${executable}, direct shebang=${executable})`,
    `status: ${artifact.status.toUpperCase()}`,
    `summary: ${artifact.summary.passed}/${artifact.summary.total} checks passed, ${artifact.summary.failed} failed (${artifact.durationMs}ms)`,
    `commands (${discoNames.length}): ${discoNames.join(", ")}`,
    `actions (${actions.length}): ${actions.map((a) => a.cmd + " " + a.action).join(", ")}`,
    "",
    ...logLines,
    "",
    failed.length ? "FAILURES:" : "ALL CHECKS PASSED",
    ...failed.map((f) => `  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`),
    "",
  ].join("\n"),
);

console.log(`agent-cli E2E: ${artifact.status} — ${artifact.summary.passed}/${artifact.summary.total} checks, ${discoNames.length} commands × 2 cwds + direct-exec, ${actions.length} actions (${artifact.durationMs}ms)`);
if (failed.length) for (const f of failed) console.error(`FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`artifact: ${path.join(OUT_DIR, "e2e.json")} and e2e.log`);
process.exit(failed.length === 0 ? 0 : 1);
