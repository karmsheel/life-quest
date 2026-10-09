/**
 * The companion door race: does LifeQuest make a Hermes host that was ALREADY
 * RUNNING when its MCP doors bound re-read them?
 *
 * The real app runs here — `dist-electron/main.js`, the real preload, the real
 * renderer, booted through `bootForE2e` — against a throwaway world built by
 * `companion-door-race.mjs`: a temp `HERMES_HOME`, a fake `hermes` CLI first on
 * PATH, a fake host that answers the attach probes, a real throwaway vault that
 * the app auto-opens, and doors on 18643/18646. Nothing the operator owns is
 * read or written: their Hermes home is never opened, their vault is never
 * touched, and 8642/8643/8646 are not bound, not probed as a fallback, and not
 * disturbed.
 *
 * WHAT THIS RIG IS ABOUT
 *
 * On 2026-10-08 the host started at 17:07:50 and tried `mcp_servers.lifequest`
 * at 17:08:27 and 17:08:54; the app's doors bound at 17:38:44. Hermes parked the
 * server ("failed initial connection after 3 attempts, parking until a reconnect
 * is requested") and did not retry for 300s, so the operator's session had no
 * `mcp__lifequest__*` tools at all and the agent correctly reported that instead
 * of improvising a way in. The app's one-shot startup check found no door — the
 * vault was not open yet — and concluded nothing.
 *
 * The fix is a post-bind check on the vault-open path. This rig drives the two
 * cases that decide whether it works, and one Electron process per case:
 *
 *   parked     the host's own record (`<HERMES_HOME>/gateway.pid`) predates the
 *              doors and the host never contacts them: exactly the report. The
 *              app must restart the host once, after the short window and not
 *              before it, and the door must then serve an authenticated
 *              `tools/list` naming real LifeQuest tools — which is what proves
 *              the door was always fine and the restart was what the host needed.
 *   connected  the same world, but the host reaches the local door seconds after
 *              it binds. The app must NOT restart anything. Without this case a
 *              rig that always restarts would pass the first one.
 *
 * HOW THE RUN IS READ
 *
 * Every `hermes` the app runs is recorded as a marker file in the fake CLI's
 * directory (`{hostname}.{random}.p{argv[0]}` — see the launcher for why the
 * argv is an atom rather than a quoted command line). The driver polls that
 * directory LIVE, while the app is still running, because the claim is not "a
 * restart happened" but "a restart happened in this window": the file's creation
 * stamp against the door's own bind instant is the whole assertion.
 *
 * The artifact is `e2e/artifacts/companion-door-race.json`, written by the
 * launcher from these observations plus its own outside-the-app ones.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** The spec the launcher built for this phase; absent means this is not a rig run. */
const RAW_SPEC = process.env.LIFEQUEST_DOOR_RACE;
if (!RAW_SPEC) {
  console.error("[door-race] LIFEQUEST_DOOR_RACE is not set; run e2e/companion-door-race.mjs");
  app.exit(1);
}
const SPEC = RAW_SPEC ? JSON.parse(RAW_SPEC) : {};
const failures = [];
const notes = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function note(message) {
  notes.push(message);
  console.error(`[door-race:${SPEC.case}] ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`[door-race:${SPEC.case}] FAIL ${message}`);
}

/** The app's own `whichHermes`, asked the same way, so the artifact names the CLI. */
function resolveHermes() {
  return new Promise((resolve) => {
    execFile(
      process.platform === "win32" ? "where.exe" : "which",
      ["hermes"],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ path: null, error: error.message });
          return;
        }
        const line = String(stdout).split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null;
        resolve({ path: line, error: null });
      },
    );
  });
}

/**
 * One MCP call to the local door, answered as the door answers: its refusals are
 * plain JSON, a served call comes back as one `data:` frame.
 */
async function doorCall(token, method, params = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${SPEC.localPort}/mcp`, {
    method: "POST",
    headers,
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
 * Whether the local door is serving. A bearer-less `tools/list` is refused with
 * AUTH_REQUIRED before any vault work happens, so this cannot be answered by
 * anything except the app's own door — and it does not touch `companionSeenAt`,
 * which is set only for a caller that authenticates AS the companion.
 */
async function doorServing() {
  const reply = await doorCall(null, "tools/list").catch(() => null);
  if (!reply) return null;
  if (reply.raw.includes("AUTH_REQUIRED")) return reply;
  return null;
}

async function waitForDoor(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await doorServing()) return Date.now();
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
}

/** Every `hermes` invocation so far, from the marker files the fake CLI wrote. */
function invocations(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const calls = [];
  for (const name of names) {
    const parsed = /\.p([a-z][a-z-]*)$/.exec(name);
    let stamp;
    try {
      const st = fs.statSync(path.join(dir, name));
      stamp = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    } catch {
      continue;
    }
    calls.push({
      at: stamp,
      // The shim names its marker `p<verb>-<sub>`, so the two atoms the judge
      // reads are the first two argv tokens: `gateway restart`, `gateway start`,
      // `config set`. A missing second token leaves a trailing hyphen.
      argv: parsed ? parsed[1].split("-").filter(Boolean) : [],
      raw: name,
    });
  }
  return calls.sort((a, b) => a.at - b.at);
}

const isRestart = (call) => call.argv[0] === "gateway" && call.argv[1] === "restart";

/**
 * Watch the CLI's marker directory until a `gateway` invocation lands, or until
 * the deadline. It is polled LIVE on purpose: the assertion is about when the
 * app acted, not about whether the log has an entry by the time everything is
 * over.
 */
async function watchForRestart(dir, deadline, { onCall } = {}) {
  const seen = [];
  for (;;) {
    for (const call of invocations(dir)) {
      if (seen.some((s) => s.raw === call.raw)) continue;
      seen.push(call);
      if (onCall) onCall(call);
    }
    if (seen.some((call) => isRestart(call))) return seen;
    if (Date.now() > deadline) return seen;
    await sleep(250);
  }
}

async function run() {
  const processStartedAt = Date.now() - Math.round(process.uptime() * 1000);
  note(`phase ${SPEC.case}: app process up, ports ${SPEC.localPort}/${SPEC.invitePort}, host ${SPEC.hostPort}`);

  const hermes = await resolveHermes();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  void win;

  // The doors bind when the app auto-opens the throwaway vault from the seeded
  // `recent.json`. That is the app's own open path (`vaultOpen` → `rememberOpen`),
  // so the post-bind check under test runs because the product ran it, not
  // because this rig called it.
  const doorUpAt = await waitForDoor(75_000);
  if (doorUpAt === null) {
    fail("the app's local door never served on the e2e port within 75s");
    return;
  }
  const doorReply = await doorCall(null, "tools/list");
  note(`local door serving at ${doorUpAt} (refusal ${doorReply.status})`);

  // Publish the bind instant for the launcher: the connected control's "host"
  // reaches the door the moment this appears, exactly as Hermes would on
  // discovering a door at startup.
  fs.writeFileSync(
    SPEC.coordFile,
    `${JSON.stringify({ at: doorUpAt, port: SPEC.localPort, case: SPEC.case }, null, 2)}\n`,
    "utf8",
  );

  // The invite door is the other half of "both doors bound": the app binds them
  // together, and a run where only one is listening is not the product.
  const inviteRes = await fetch(`http://127.0.0.1:${SPEC.invitePort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  })
    .then((res) => res.text().then((text) => ({ status: res.status, text })))
    .catch((error) => ({ status: null, text: String(error) }));
  if (!inviteRes.text.includes("AUTH_REQUIRED")) {
    fail(`the invite door on ${SPEC.invitePort} did not serve its own refusal: ${JSON.stringify(inviteRes)}`);
  }

  // The restart this rig watches for is the fake CLI writing a marker file. The
  // door's window is measured from ITS bind, and this process only learned the
  // door was serving a little after that, so the windows below are asserted
  // against the door's own instant, never against a stopwatch started here.
  const deadline = doorUpAt + SPEC.watchMs;
  const firstCallAt = { value: null };
  const calls = await watchForRestart(SPEC.callsDir, deadline, {
    onCall: (call) => {
      if (firstCallAt.value === null) firstCallAt.value = call.at;
      note(`hermes invocation: ${call.raw} at ${call.at} (door +${call.at - doorUpAt}ms)`);
    },
  });
  const watchedMs = Date.now() - doorUpAt;

  const restarts = calls.filter(isRestart);

  const result = {
    id: SPEC.id,
    case: SPEC.case,
    processStartedAt,
    doorUpAt,
    doorUpToProcessStartMs: doorUpAt - processStartedAt,
    watchedMs,
    cliPath: hermes.path,
    cliLookupError: hermes.error,
    cliLog: calls,
    doorsAtBind: { localBound: true, inviteBound: true },
    inviteDoor: { port: SPEC.invitePort, status: inviteRes.status, refusal: "AUTH_REQUIRED" },
    doorRefusalAtBind: { status: doorReply.status, body: doorReply.raw.slice(0, 200) },
    profileConfig: null,
    soulSeeded: null,
    toolsAfterRestart: null,
    hostContactExpected: SPEC.hostContactExpected,
    failures: [...failures],
    notes: [...notes],
  };

  // The profile the app wrote, read back: the doors' url in it has to be the
  // port this rig moved them to, or the host was told about a door nobody is
  // serving on.
  const configPath = path.join(SPEC.hermesHome, "profiles", "lifequest", "config.yaml");
  try {
    result.profileConfig = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    note(`could not read the profile config back: ${error.message}`);
  }
  result.soulSeeded = fs.existsSync(path.join(SPEC.hermesHome, "profiles", "lifequest", "SOUL.md"));

  // ── the assertions this process can make from inside the app ───────────────
  if (SPEC.case === "parked") {
    if (restarts.length === 0) {
      fail(`no gateway restart arrived within ${SPEC.watchMs / 1000}s of the door binding`);
    } else {
      const first = restarts[0];
      if (first.at - doorUpAt < 4_000) {
        fail(`a gateway restart landed ${first.at - doorUpAt}ms after the door bound, inside the 5s window`);
      }
      if (first.at - doorUpAt > 25_000) {
        fail(`the only gateway restart landed ${first.at - doorUpAt}ms after the door bound, long after the 5s window`);
      }
      if (restarts.length > 1) {
        fail(`the app restarted the host ${restarts.length} times for one binding`);
      }
    }
    // The door is proven fine by asking it, and the tool list is the artifact
    // the operator's session was missing: real names, from the real tool table.
    const served = await doorCall(SPEC.token, "tools/list");
    const tools = (served.json?.result?.tools ?? []).map((t) => t.name);
    result.toolsAfterRestart = tools;
    result.toolsAfterRestartStatus = served.status;
    if (!tools.includes("get_dashboard") || !tools.includes("preview_view")) {
      fail(`the door served ${tools.length} tools after the restart and not the LifeQuest ones: ${JSON.stringify(tools.slice(0, 8))}`);
    }
  } else {
    // The control: the host reached the door, so the app has nothing to fix.
    if (restarts.length > 0) {
      fail(`the app restarted a host that had already reached the door: ${JSON.stringify(restarts)}`);
    }
    if (watchedMs < 10_000) {
      fail(`the control watched only ${watchedMs}ms, which is not long enough to call "no restart" a decision`);
    }
    const served = await doorCall(SPEC.token, "tools/list");
    result.toolsAfterRestart = (served.json?.result?.tools ?? []).map((t) => t.name);
    result.toolsAfterRestartStatus = served.status;
    if ((result.toolsAfterRestart ?? []).length === 0) {
      fail("the door served no tools to an authenticated companion in the control run");
    }
  }

  if (!(result.profileConfig ?? "").includes(`http://127.0.0.1:${SPEC.localPort}/mcp`)) {
    fail(`the profile does not name the door this rig bound (${SPEC.localPort})`);
  }
  if (!(result.profileConfig ?? "").includes(`Bearer ${SPEC.token}`)) {
    fail("the profile does not carry the credential the door accepts");
  }

  result.failures = [...failures];
  result.notes = [...notes];
  fs.writeFileSync(SPEC.resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  note(`${SPEC.case}: ${failures.length === 0 ? "pass" : "fail"} — cli invocations ${calls.length}, restarts ${restarts.length}, watched ${watchedMs}ms`);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    fail(`the driver threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    try {
      fs.writeFileSync(
        SPEC.resultFile,
        `${JSON.stringify({ id: SPEC.id, case: SPEC.case, failures: [...failures], notes: [...notes], threw: true }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      /* nothing left to write to */
    }
  })
  .finally(() => {
    app.exit(failures.length === 0 ? 0 : 1);
  });
