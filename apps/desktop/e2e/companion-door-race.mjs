/**
 * Launcher for the companion door race (`companion-door-race.electron.mjs`).
 *
 * The rig asks one question — does the app make a Hermes host that was already
 * running before its MCP doors bound re-read them? — and it has to ask it
 * without touching the operator's Hermes, the operator's vault, or the live
 * LifeQuest that holds ports 8642/8643/8646 right now. So this script builds
 * the whole world the app will boot into, and the driver only runs the app:
 *
 *  - a throwaway vault (`createVault`), so the app auto-opens SOMETHING and the
 *    vault-open path — the path the fix hangs off, `rememberOpen` — actually
 *    runs. Each phase gets its own: a fresh vault is a fresh binding;
 *  - a throwaway `HERMES_HOME` with a fake `hermes` CLI FIRST on PATH, so every
 *    `hermes …` the app runs is recorded (JSONL: `{at, argv}`) and none of them
 *    is real;
 *  - a fake host on a port of this run's own, answering the three endpoints the
 *    app's attach path needs and nothing else. It never speaks MCP: whether the
 *    "host" reaches the door is decided by `hostContactsDoor` in the phase spec,
 *    and for the connected control that contact is this server POSTing to the
 *    door exactly as Hermes would;
 *  - a profile whose `mcp_servers.lifequest` already carries the credential the
 *    app will mint, and a secrets file that already holds that token, so
 *    `credentialChanged` is false and `ensureCompanion` cannot be the thing that
 *    restarts the host. Whatever restarts it is the post-bind door check.
 *
 * Two phases, one artifact:
 *
 *   parked     the host started BEFORE the doors and never contacted them: the
 *              reported failure, and the fix must restart the host inside the
 *              short (5 s) window and only there.
 *   connected  the same world, but the host reaches the local door seconds after
 *              it binds: no restart at all, which is what makes the first phase
 *              a decision rather than a habit.
 *
 * Usage, from `apps/desktop`, with the Vite dev server up:
 *
 *   node e2e/companion-door-race.mjs
 *
 * Exit code 0 = both phases passed; the artifact is
 * `e2e/artifacts/companion-door-race.json`.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const DRIVER = path.join(here, "companion-door-race.electron.mjs");
const REPORT = path.join(here, "artifacts", "companion-door-race.json");
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/**
 * The doors' e2e ports, fixed by the brief. The product's own 8643/8646 are held
 * by the operator's running LifeQuest, and a rig that tried them would either
 * fail to bind or, far worse, be answered by the app the operator is using.
 */
const LOCAL_PORT = 18_643;
const INVITE_PORT = 18_646;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lq-door-race-"));
const runs = {};
const failures = [];
const notes = [];
const children = new Set();
let finished = false;

function note(message) {
  notes.push(message);
  console.error(`[door-race] ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`[door-race] FAIL ${message}`);
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
 * The marker file one `hermes` invocation leaves behind, and the argv it carried.
 *
 * The app spawns the CLI through a shell (`companion-spawn.ts`), so the shim is a
 * `.cmd` on Windows. Writing the argv itself from batch is a quoting trap —
 * `config`, `set`, `gateway.multiplex_profiles`, `true` all quote differently to
 * `cmd.exe` than to the shell that spawned it — and a log that mangles the argv
 * is worse than no log, because the artifact would then be describing a command
 * the app never ran.
 *
 * So the shim records the fact that it ran, in a file whose NAME carries the two
 * verb atoms the assertions read: `%COMPUTERNAME%.%RANDOM%.p%1-%2` (for `hermes
 * gateway restart` that is `…pgateway-restart`, and for `hermes config set …`
 * `…pconfig-set`). Both atoms are plain lowercase words in every command this
 * app runs, so no quoting is involved — and unlike a single atom they tell a
 * `gateway restart` from a `gateway start`, which is a distinction the judge
 * makes and the earlier one-atom name could not express. The launcher and the
 * driver read the creation stamps as the invocation time.
 *
 * The shim is silent unless `DOOR_RACE_CALLS` is set — the launcher points that
 * at the phase's own marker directory, so a phase can only ever count its own
 * app's calls.
 */
function writeHermesShim(cliDir) {
  fs.mkdirSync(cliDir, { recursive: true });
  const shim = path.join(cliDir, "hermes.cmd");
  const script = [
    "@echo off",
    "rem A fake hermes, first on PATH: record the invocation and exit 0.",
    "if defined DOOR_RACE_CALLS (",
    '  >"%DOOR_RACE_CALLS%\\%COMPUTERNAME%.%RANDOM%.p%1-%2" echo %1 %2',
    ")",
    "exit /b 0",
  ].join("\r\n");
  fs.writeFileSync(shim, `${script}\r\n`, "ascii");
  if (process.platform !== "win32") {
    // Same contract, for a rig that is ever run off Windows.
    const posix = path.join(cliDir, "hermes");
    fs.writeFileSync(
      posix,
      '#!/bin/sh\nif [ -n "$DOOR_RACE_CALLS" ]; then : > "$DOOR_RACE_CALLS/$(hostname).$$.p$1-$2"; fi\nexit 0\n',
      "utf8",
    );
    fs.chmodSync(posix, 0o755);
  }
  return shim;
}

/**
 * The verb atoms a marker file's name carries, or null for a name this rig did
 * not write. `p%1-%2` with a missing second token leaves a trailing hyphen, so
 * the split drops the empty atom.
 */
function markersOf(name) {
  const atom = /\.p([a-z][a-z-]*)$/.exec(name)?.[1];
  if (!atom) return null;
  return atom.split("-").filter(Boolean);
}

/** The invocation log the shim wrote: `{at, argv}` per call, in time order. */
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

/**
 * The three endpoints the app's attach path reads, on the port this phase's
 * `HERMES_HOME/.env` names. `/health` is `health(baseUrl)`; the profile prefix is
 * the same probe under `/p/lifequest`; `/v1/capabilities` is what
 * `capabilitiesSupportSessions` turns into `{kind:"ready"}`.
 *
 * Every request is recorded: the fake host's log is how the artifact proves a
 * healthy host really was serving when the app decided about it, rather than the
 * app having attached to nothing.
 */
function startFakeHost(port) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    requests.push({ at: Date.now(), method: req.method ?? "", path: url });
    if (url === "/health" || url === "/p/lifequest/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url === "/v1/capabilities") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          features: { session_list: true, session_chat_stream: true },
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: url } }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      // The server must not hold the launcher open if a phase dies: persistence
      // here would turn a failed run into a hung one.
      server.unref();
      resolve({
        port,
        requests,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** An authenticated MCP call, answered as the door answers. */
async function doorCall(port, token, method, params = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const frame = raw.split("\n").find((line) => line.startsWith("data: "));
  let json;
  try {
    json = JSON.parse(frame ? frame.slice(6) : raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

/**
 * The connected control's one act: the "host" reaching the local door the way
 * Hermes does — an authenticated `tools/list` — a couple of seconds after the
 * door bound. That is what makes the app's post-bind check answer "the companion
 * is already here" instead of "the host parked".
 */
async function hostContactsDoor(port, token) {
  const before = Date.now();
  const reply = await doorCall(port, token, "tools/list");
  const tools = (reply.json?.result?.tools ?? []).map((t) => t.name);
  return { at: Date.now(), sentAt: before, status: reply.status, tools: tools.length, ok: tools.length > 0 };
}

function bootFor(phase) {
  const dir = path.join(tmp, `phase-${phase.id}`);
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const callsDir = path.join(dir, "hermes-calls");
  const coordFile = path.join(dir, "doors.json");
  const resultFile = path.join(dir, "result.json");
  for (const p of [hermesHome, path.join(hermesHome, "profiles", "lifequest"), userData, callsDir]) {
    fs.mkdirSync(p, { recursive: true });
  }
  return { dir, hermesHome, userData, callsDir, coordFile, resultFile };
}

/** `<HERMES_HOME>/gateway.pid` with an mtime in the past, or none at all. */
function seedGatewayPid(hermesHome, ageSeconds) {
  if (ageSeconds === null) return null;
  const file = path.join(hermesHome, "gateway.pid");
  fs.writeFileSync(file, "12345\n", "ascii");
  const when = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(file, when, when);
  return fs.statSync(file).mtimeMs;
}

/** One phase's world: vault, profile, secrets, fake CLI, fake host. */
async function setupPhase(phase, { hostPort, token }) {
  const paths = bootFor(phase);
  const cliDir = path.join(tmp, "bin");

  const created = await createVault(path.join(paths.dir, "vault"), "Door race");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vaultId = created.value.lifequest.id;

  // The profile config ALREADY carries the credential the app is about to mint,
  // and the url of the door that is about to bind. Both of those are what keep
  // `credentialChanged` false in `writeCompanionMcpProfile`, which in turn keeps
  // `ensureCompanion`'s own `gateway restart` out of this run: the only restart
  // left possible is the post-bind door check this rig exists to watch.
  const profileDir = path.join(paths.hermesHome, "profiles", "lifequest");
  fs.writeFileSync(
    path.join(profileDir, "config.yaml"),
    [
      "mcp_servers:",
      "  lifequest:",
      `    url: http://127.0.0.1:${LOCAL_PORT}/mcp`,
      "    headers:",
      `      Authorization: Bearer ${token}`,
      "tools:",
      "  tool_search:",
      "    enabled: off",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(profileDir, ".env"), `API_SERVER_KEY=${token}\n`, "utf8");
  // The host's own port, read by `ensureCompanion` and by `ensureHostGateway`.
  fs.writeFileSync(path.join(paths.hermesHome, ".env"), `API_SERVER_PORT=${hostPort}\n`, "utf8");
  // The ROOT config carries the same entry, and that is not decoration: the app
  // decides `credentialChanged` from the PROFILE and the ROOT together
  // (`hasCompanionHeader` over both), and a root config without it makes every
  // run look like a freshly written credential — `ensureCompanion` then restarts
  // the host itself, ~80ms after the vault opens, and the restart this rig exists
  // to attribute to the post-bind check is already spent. The first version of
  // this rig seeded only the profile file and measured exactly that, which is how
  // a green-looking control hid the fact that it was watching the wrong restart.
  //
  // No `model:` block anywhere: a pinned model would start the catalog probe,
  // which is not this rig's question and would put this machine on the network.
  fs.writeFileSync(
    path.join(paths.hermesHome, "config.yaml"),
    [
      "mcp_servers:",
      "  lifequest:",
      `    url: http://127.0.0.1:${LOCAL_PORT}/mcp`,
      "    headers:",
      `      Authorization: Bearer ${token}`,
      "gateway:",
      "  multiplex_profiles: true",
      "",
    ].join("\n"),
    "utf8",
  );

  fs.mkdirSync(path.join(paths.userData, "pairing-secrets"), { recursive: true });
  fs.writeFileSync(
    path.join(paths.userData, "pairing-secrets", "connected-agent-secrets.json"),
    `${JSON.stringify({ vaults: { [vaultId]: { companionToken: token, bearers: {}, invites: [] } } }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(paths.userData, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          { id: vaultId, name: "Door race", path: path.join(paths.dir, "vault"), lastOpenedAt: new Date().toISOString() },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const gatewayPidMtime = seedGatewayPid(paths.hermesHome, phase.gatewayPidAgeSeconds);
  const shim = writeHermesShim(cliDir);

  const spec = {
    id: phase.id,
    case: phase.case,
    localPort: LOCAL_PORT,
    invitePort: INVITE_PORT,
    hostPort,
    hermesHome: paths.hermesHome,
    callsDir: paths.callsDir,
    coordFile: paths.coordFile,
    resultFile: paths.resultFile,
    vaultRoot: path.join(paths.dir, "vault"),
    vaultId,
    token,
    devServerUrl: DEV_SERVER,
    hostContactExpected: phase.case === "connected",
    // How long the driver must watch after the door binds. It has to outlast the
    // app's decision plus the fake CLI's own run, or "no restart" would be read
    // from a window that closed before the answer arrived.
    watchMs: phase.case === "connected" ? 20_000 : 40_000,
  };
  fs.writeFileSync(path.join(paths.dir, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`, "utf8");

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // The operator's Hermes home is never opened: `hermesRoot` reads HERMES_HOME
  // first, and the profile this rig seeds is under the temp one.
  env.HERMES_HOME = paths.hermesHome;
  // PATH is spelled `Path` on this machine, and assigning `env.PATH` would add a
  // SECOND variable rather than prepend anything to the one Windows itself reads
  // — the child would then resolve the operator's real `hermes`, which is the one
  // thing this rig must never run. So the existing key keeps its own spelling.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  env[pathKey] = `${cliDir}${path.delimiter}${env[pathKey] ?? ""}`;
  env.VITE_DEV_SERVER_URL = DEV_SERVER;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: paths.userData,
    showWindow: false,
    mcpPorts: { local: LOCAL_PORT, invite: INVITE_PORT },
  });
  env.LIFEQUEST_DOOR_RACE = JSON.stringify(spec);
  // The shim only records when this is set, and it must name THIS phase's marker
  // directory. Without it the shim is still a perfectly good fake `hermes` — it
  // exits 0 and the app is none the wiser — so every "the app ran no gateway
  // restart" assertion would pass by construction. That is the one failure mode
  // of this rig that looks exactly like success, which is why the judge also
  // demands the recorder prove it was live (the `config set` the app always runs
  // immediately before any restart).
  env.DOOR_RACE_CALLS = paths.callsDir;

  let host = await startFakeHost(hostPort);

  const record = {
    case: phase.case,
    ports: { local: LOCAL_PORT, invite: INVITE_PORT, host: hostPort },
    hermesHome: paths.hermesHome,
    fakeCli: shim,
    gatewayPidMtime,
    gatewayPidAgeSeconds: phase.gatewayPidAgeSeconds,
    vaultId,
    hostContactExpected: spec.hostContactExpected,
    watchMs: spec.watchMs,
    hostLog: [],
    /**
     * The fake CLI's invocation log, filled in by the DRIVER while the app is
     * still running: the restart this rig watches for is a marker file appearing
     * while the app holds the door, so it cannot be read after the fact without
     * also losing the "when" that the whole assertion rests on.
     */
    cliLog: [],
    doorUpAt: null,
    hostContact: null,
    result: null,
    notes: [],
  };

  const child = spawn(electron, [DRIVER], { cwd: desktopRoot, stdio: "inherit", env });
  children.add(child);

  // The control's contact, made the moment the driver reports the door bound —
  // the same instant Hermes would connect to a door it discovered at startup.
  const contact = (async () => {
    if (!spec.hostContactExpected) return;
    const bound = await waitForCoord(paths.coordFile, 60_000);
    if (!bound) {
      record.notes.push("the driver never reported the door bound; no host contact was sent");
      return;
    }
    record.doorUpAt = bound.at;
    try {
      record.hostContact = await hostContactsDoor(LOCAL_PORT, token);
    } catch (error) {
      record.hostContact = { error: error instanceof Error ? error.message : String(error) };
    }
  })();

  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      record.notes.push(`the app did not exit within ${(phase.timeoutMs / 1000).toFixed(0)}s and was killed`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve({ code: null, signal: "timeout" });
    }, phase.timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      record.notes.push(`electron could not be spawned: ${error.message}`);
      resolve({ code: null, signal: "spawn-error" });
    });
  });

  await contact;
  await host.close();
  children.delete(child);

  record.exit = outcome;
  record.hostLog = [...host.requests];
  record.cliLog = fs.existsSync(paths.callsDir) ? readInvocationLog(paths.callsDir) : [];
  if (fs.existsSync(paths.resultFile)) {
    try {
      record.result = JSON.parse(fs.readFileSync(paths.resultFile, "utf8"));
    } catch (error) {
      record.notes.push(`the driver's result file is not JSON: ${error.message}`);
    }
  } else {
    record.notes.push("the driver wrote no result file");
  }
  return record;
}

/** The driver's coordination file, or null if it never appears. */
async function waitForCoord(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed.at === "number") return parsed;
    } catch {
      /* not written yet */
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The verdicts this launcher can make from outside the app. */
function judge(record) {
  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, pass: Boolean(ok), detail: detail ?? null });
    return Boolean(ok);
  };
  const res = record.result ?? {};
  // The CLI log the DRIVER captured live, plus anything this launcher sees in the
  // marker directory now: the two must agree, and a disagreement is itself a
  // failure rather than something to paper over.
  const live = Array.isArray(res.cliLog) ? res.cliLog : [];
  const after = record.cliLog;
  const cliLog = live.length > 0 ? live : after;
  const is = (argv, verb) => argv?.[0] === "gateway" && argv?.[1] === verb;
  const restarts = cliLog.filter((e) => is(e.argv, "restart"));
  const starts = cliLog.filter((e) => is(e.argv, "start"));
  const doorUpAt = res.doorUpAt ?? record.doorUpAt;
  const relative = (e) => ({ at: e.at, rel: typeof doorUpAt === "number" ? e.at - doorUpAt : null, argv: e.argv, raw: e.raw ?? null });

  add("the driver ran and reported", res.id === record.case || res.case === record.case, JSON.stringify({ id: res.id, case: res.case }));
  add("the app's doors bound on the e2e ports", typeof doorUpAt === "number" && res.doorsAtBind?.localBound === true && res.inviteDoor?.refusal === "AUTH_REQUIRED", JSON.stringify({ doorUpAt, doorsAtBind: res.doorsAtBind ?? null, inviteDoor: res.inviteDoor ?? null }));
  add("the fake host answered the app's attach probes", record.hostLog.length > 0, `requests: ${record.hostLog.length}`);
  add("the CLI the app ran is this run's shim", res.cliPath === record.fakeCli, `resolved: ${JSON.stringify(res.cliPath)}`);
  add("the two CLI logs agree", live.length === after.length, JSON.stringify({ live: live.length, after: after.length }));
  add("the profile names the door this rig bound", (res.profileConfig ?? "").includes(`127.0.0.1:${record.ports.local}/mcp`), "the url written into mcp_servers.lifequest");

  if (record.case === "parked") {
    add(
      "no `gateway restart` before the door's 5s window",
      restarts.every((e) => e.at - doorUpAt >= 4_000),
      JSON.stringify(restarts.map(relative)),
    );
    add(
      "exactly one `gateway restart` inside the window",
      restarts.length === 1 && restarts[0].at - doorUpAt <= 25_000,
      JSON.stringify(restarts.map(relative)),
    );
    add("the restart is a restart, not a start", starts.length === 0, JSON.stringify(starts.map(relative)));
    add(
      "the door serves real LifeQuest tools after it",
      (res.toolsAfterRestart ?? []).includes("get_dashboard") &&
        (res.toolsAfterRestart ?? []).includes("preview_view"),
      JSON.stringify((res.toolsAfterRestart ?? []).slice(0, 12)),
    );
    add(
      "the door refused every caller before the restart",
      res.doorRefusalAtBind?.status === 401,
      JSON.stringify(res.doorRefusalAtBind ?? null),
    );
  } else {
    add("no `gateway restart` at all", restarts.length === 0, JSON.stringify(restarts.map(relative)));
    add("the host's contact was accepted by the door", record.hostContact?.ok === true, JSON.stringify(record.hostContact));
    add(
      "the door serves the companion in the control too",
      (res.toolsAfterRestart ?? []).length > 0,
      `${(res.toolsAfterRestart ?? []).length} tools`,
    );
    add(
      "the door was watched for longer than the parked run's whole decision",
      typeof res.watchedMs === "number" && res.watchedMs >= 10_000,
      JSON.stringify({ watchedMs: res.watchedMs ?? null }),
    );
  }

  const failuresHere = checks.filter((c) => !c.pass).map((c) => `${record.case}: ${c.name} — ${c.detail}`);
  return { checks, failures: failuresHere };
}

function writeReport() {
  const report = {
    pass: failures.length === 0,
    failures,
    what: "the real LifeQuest app against a Hermes host that was already running when its MCP doors bound: the parked host is restarted once inside the door's window, the connected host is never restarted",
    why: "the 2026-10-08 report — a companion session with no mcp__lifequest__* tools — was a host that tried a door before it existed and parked on it; the app's one-shot startup check found no door and did nothing",
    notes,
    runs,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * The two phases. Order matters for the reader, not for the app: each runs in
 * its own temp world and its own Electron process, so nothing carries over.
 *
 * Both seed `<HERMES_HOME>/gateway.pid` with a stamp older than the doors, which
 * is what a host that was already running when the app started looks like. The
 * parked phase is then the 2026-10-08 report reproduced exactly; the connected
 * phase feeds that same world a host that reaches the door, and demands no
 * restart at all.
 */
const PHASES = [
  {
    id: "parked",
    case: "parked",
    // The host's own record has to predate the doors for the app to conclude it
    // has already run its one discovery pass. Without this file the app waits
    // the 45 s window instead, which is the correct-but-slow path.
    gatewayPidAgeSeconds: 120,
    timeoutMs: 90_000,
  },
  {
    id: "connected",
    case: "connected",
    gatewayPidAgeSeconds: 120,
    timeoutMs: 90_000,
  },
];

async function main() {
  if (!(await portIsFree(LOCAL_PORT)) || !(await portIsFree(INVITE_PORT))) {
    throw new Error(
      `the e2e door ports ${LOCAL_PORT}/${INVITE_PORT} are not free; nothing may be bound there before this rig runs`,
    );
  }
  const hostPort = await freePort();
  const token = randomBytes(32).toString("base64url");

  for (const phase of PHASES) {
    console.error(`[door-race] phase ${phase.id}: ${phase.case}`);
    const record = await setupPhase(phase, { hostPort, token });
    const verdict = judge(record);
    record.checks = verdict.checks;
    record.verdict = verdict.failures.length === 0 ? "pass" : "fail";
    runs[phase.id] = record;
    for (const message of verdict.failures) failures.push(message);
    console.error(
      `[door-race] phase ${phase.id}: ${record.verdict} — cli calls ${record.cliLog.length}, restarts ${record.cliLog.filter((e) => e.argv?.[0] === "gateway" && e.argv?.[1] === "restart").length}`,
    );
  }
  return writeReport();
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
  .then((report) => {
    // The report is on disk before this prints, so a run that fails to clean up
    // still leaves its artifact behind.
    console.log(`[door-race] ${report.pass ? "PASS" : "FAIL"}: ${REPORT}`);
    for (const run of Object.values(runs)) {
      for (const check of run.checks) {
        console.log(`[door-race]   ${run.case.padEnd(9)} ${check.pass ? "ok  " : "FAIL"} ${check.name}`);
      }
    }
    if (failures.length > 0) for (const message of failures) console.error(`[door-race]   ${message}`);
    cleanup();
    process.exit(report.pass ? 0 : 1);
  })
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
    writeReport();
    cleanup();
    process.exit(1);
  });
