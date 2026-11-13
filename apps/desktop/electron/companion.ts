import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { companionMcpUrl, getLocalDoorCredentialState } from "./mcp-server.ts";
import {
  DEFAULT_API_PORT,
  PROFILE_NAME,
  hermesRoot,
  isSafeProfileName,
  listHermesProfiles,
  portFromBaseUrl,
  profileDir,
  readEnv,
  resolveHermesCli,
  type HermesProfileInfo,
} from "./companion-profile.ts";
import { hermesSpawnSpec } from "./companion-spawn.ts";
import { refreshServedProfile } from "./hermes-control.ts";
import { getFileUnsolicited } from "./companion-filing.ts";
import {
  getCompanionProfile,
  setCompanionProfile,
} from "./recent-vaults.ts";
import {
  currentVaultAgentBinding,
  getVaultAgentBinding,
  setVaultAgentBinding,
} from "./vault-agents.ts";
import { currentVaultScope } from "./vault-scope.ts";
import {
  readCompanionPrompts,
  type CompanionPrompts,
} from "./companion-prompts.ts";
import {
  mergeArchivedSessions,
  readArchivedSessions,
} from "./companion-archived.ts";
import {
  buildInstructions,
  buildTurnInput,
  createdSessionFromPayload,
  messagesFromPayload,
  modelCatalogFromPayload,
  sanitizeTranscriptRows,
  onboardingContextOf,
  runtimeRequestBody,
  sessionFromPayload,
  sessionsFromPayload,
  splitSse,
  type ChatStreamEvent,
  type CompanionInstructionsInput,
  type CompanionModelCatalog,
  type CompanionRuntimeOverride,
  type HermesSession,
  type TranscriptMessage,
  type TurnAttachment,
} from "./companion-client.ts";
import {
  ensureCompanion,
  hostMissedDoors,
  modelVerdict,
  modelWarningFor,
  shutdownCompanion,
  stripCompanionMcpProfile,
  writeCompanionMcpProfile,
  type CompanionIo,
  type CompanionReady,
  type CompanionStatus,
} from "./companion-lifecycle.ts";
import type { HarnessStatus } from "./harness/types.ts";
import { onHarnessStatusChanged, publishHarnessStatus } from "./harness/status-bus.ts";

export type PublicCompanionStatus = HarnessStatus;

/**
 * The Hermes status as the app sees it.
 *
 * `harness` and `detail` are added here, at the seam, so every consumer — the
 * setup screen, Settings, the gate — can read one shape regardless of which
 * companion answered. A port and a profile path are Hermes facts; they stay
 * present but optional, because a built-in companion has neither.
 */
export function publicStatus(status: CompanionStatus): PublicCompanionStatus {
  if (status.kind !== "ready") return status;
  const { apiKey: _key, ...rest } = status;
  const how = rest.startedByLifeQuest ? "started by LifeQuest" : "attached";
  return {
    ...rest,
    harness: "hermes",
    detail: `Ready · ${rest.baseUrl} · ${how}`,
  };
}

let current: CompanionStatus = { kind: "needs_install" };

/**
 * How long a chat stream may go without a single byte before this side declares
 * the transport dead.
 *
 * The gateway is chatty while a turn is live: it writes an SSE keepalive
 * comment every ten seconds even when the agent is thinking or running a slow
 * tool, and every delta and tool frame lands on the same socket. So a silence
 * far longer than that is not a slow turn — it is a stream that stopped, a
 * gateway that wedged, or a connection that was cut without the socket saying
 * so. Without a bound the turn stayed "running" for as long as the app stayed
 * open: the composer would not take another message, the rail's dot kept
 * pulsing, and restarting the app was the only way out. A turn the operator had
 * already watched stream its answer in could still be shown as in flight.
 */
const PRODUCT_STREAM_IDLE_MS = 45_000;
let streamIdleMs = PRODUCT_STREAM_IDLE_MS;

/**
 * Shorten the silence a chat stream is allowed, for the e2e seam only.
 *
 * The product keeps its 45-second bound; the seam's gate in `main.ts` is the
 * only caller, and it only exists in a dev build with `LIFEQUEST_E2E` set. A
 * rig that waited 45 real seconds for the bound would spend more time proving
 * the clock than the behaviour.
 */
export function setChatStreamIdleMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 500) return;
  streamIdleMs = Math.round(ms);
}

/** The sentence a stream that stopped gets, in the operator's own terms. */
const STREAM_LOST =
  "The companion stopped sending while this turn was running. The turn was closed and the chat was re-read, so any answer it stored is in the transcript. Send again if the reply is not there.";

/**
 * Everyone who wants to hear that the companion's status moved.
 *
 * The listener set lives on the app's bus (`harness/status-bus.ts`), not here:
 * the renderer subscribes once, before any harness is chosen, and a built-in
 * companion's status has to reach the same screen. This module keeps the
 * function name the rest of the app imports.
 */
export function onCompanionStatusChanged(
  listener: (status: PublicCompanionStatus) => void,
): () => void {
  return onHarnessStatusChanged(listener);
}

/** Store the status and tell everyone. Returns the wire shape (no API key). */
function publish(status: CompanionStatus): PublicCompanionStatus {
  current = status;
  // Tagged with this harness: a switch may already have moved the app to the
  // other companion, and a late answer from a gateway that was restarting when
  // the operator clicked must not be painted as the agent they are now on.
  return publishHarnessStatus("hermes", publicStatus(status));
}

/**
 * Is the pinned model one this profile can still route? Asked after the app is
 * already on screen, never before.
 *
 * The answer is a loopback GET the host answers in a few hundred milliseconds —
 * measured at 579ms on a profile with 52 providers — and it is the difference
 * between a chat that works and one that 404s on the first call. It rides on the
 * ready status (`modelWarning`) rather than blocking it, because a slow or dead
 * host must not be able to hold the splash: see the cold-start spec
 * (2026-10-17), where exactly that cost 57 seconds.
 *
 * Best-effort in every direction: no catalog, no verdict, no warning.
 */
let modelProbeInFlight = false;
/**
 * The status a probe could not be started for, because one was already running.
 *
 * A profile switch is the case this exists for: `companionUseProfile` awaits a
 * fresh ensure in ~100ms while the previous probe is still waiting on the host,
 * so without this the new profile would never be asked about at all — its first
 * probe would be swallowed by the old profile's.
 */
let modelProbeQueued: CompanionReady | null = null;

async function probePinnedModel(status: CompanionReady): Promise<void> {
  if (modelProbeInFlight) {
    modelProbeQueued = status;
    return;
  }
  modelProbeInFlight = true;
  try {
    const answer = await companionModelOptions();
    // The companion moved on while the host was thinking (a profile switch, a
    // vault open, a retry). Its new status owns the screen; this answer is
    // about a host we are no longer talking to.
    if (current !== status) return;
    const warning = modelWarningFor(modelVerdict(answer.ok ? answer.value : null));
    if (!warning || status.modelWarning === warning) return;
    publish({ ...status, modelWarning: warning });
  } catch {
    // Silence is not a verdict: an unreadable catalog never retires a model.
  } finally {
    modelProbeInFlight = false;
    const queued = modelProbeQueued;
    modelProbeQueued = null;
    if (queued && queued !== status && current === queued) {
      void probePinnedModel(queued);
    }
  }
}

function spawnError(cli: string, err: unknown): Error {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`spawn ${code || "error"} (${cli}): ${msg}`);
}

/**
 * The Hermes CLI on this machine. Delegates to `resolveHermesCli`, which
 * walks PATH by hand — the old `execFile("command", ["-v", "hermes"])` died
 * with ENOENT on every Linux that ships no `command` binary, and the app
 * answered "install Hermes" on machines that have it. See
 * `companion-profile.ts` for the full story.
 */
async function whichHermes(): Promise<string | null> {
  return resolveHermesCli(process.env, os.homedir());
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function health(baseUrl: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function capabilities(baseUrl: string, key: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${key}` },
      // An endpoint that accepts the connection and then never answers must not
      // hold the cold start: bound it the way `health` bounds itself.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Kill a hung CLI and its children. A `.cmd` shim (which is what `where hermes`
 * resolves first on Windows) spawns a python grandchild that outlives a plain
 * kill, so the tree goes, not just the shell.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {
      /* best effort: the timeout already reported the failure */
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/**
 * How long one hermes command may run before it is killed and reported.
 *
 * `gateway restart` hangs on this machine — it stops inside its own scheduled
 * task repair (`schtasks /Delete` → access denied) and never exits, so its
 * `close` event never fires. Unbounded, that one command held `companionEnsure`
 * open forever and parked the cold-start splash with it: the app looked frozen
 * on launch with no error anywhere. Every CLI call is bounded now, so a wedged
 * hermes degrades the companion status instead of the whole window.
 */
const HERMES_TIMEOUT_MS = 45_000;

/** What one `hermes` run said, so a caller can report it on a success too. */
type HermesRun = { stdout: string; stderr: string };

/**
 * How much of one stream is kept. A wedged gateway can print without bound, and
 * the sentence that names the failure is at the end; the top of a wall of plugin
 * chatter is not worth holding in the main process.
 */
const HERMES_OUTPUT_LIMIT = 8_000;

function tail(text: string, limit = HERMES_OUTPUT_LIMIT): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(trimmed.length - limit)}`;
}

/**
 * The message for a `hermes` command that exited non-zero.
 *
 * BOTH streams are read, and that is the whole point of this function. Hermes
 * prints every user-facing refusal through `print()` / `print_error()`, which is
 * STDOUT (`hermes_cli/cli_output.py`) — "Gateway service restart failed.",
 * "Running the gateway as a background service is not available on this
 * platform (no systemd, launchd or Scheduled Tasks).", "A gateway is already
 * running (PID n)" — and then exits non-zero with stderr EMPTY. Reading stderr
 * alone turned every one of those into the bare `hermes gateway start exited 1`
 * that an operator reported on 2026-10-12 while the actual sentence sat unread
 * in a pipe the app had opened and never drained.
 *
 * stderr still comes first when it has anything, because a traceback names the
 * bug; stdout is what carries the explanation.
 */
function hermesFailure(args: string[], code: number | null, run: HermesRun): Error {
  const detail = [run.stderr, run.stdout]
    .map((stream) => tail(stream))
    .filter(Boolean)
    .join("\n");
  return new Error(detail || `hermes ${args.join(" ")} exited ${code ?? "unknown"}`);
}

async function runHermes(
  cli: string,
  args: string[],
  extraEnv: Record<string, string>,
): Promise<HermesRun> {
  const spec = hermesSpawnSpec(process.platform, cli, args, extraEnv);
  return new Promise<HermesRun>((resolve, reject) => {
    let spawned: ChildProcess;
    try {
      spawned = spawn(spec.file, spec.args, spec.options);
    } catch (err) {
      reject(spawnError(cli, err));
      return;
    }
    // Both pipes are read to the end. Reading is not only how the failure text
    // is found: an undrained pipe fills at ~64KB and blocks the child, so a
    // chatty `hermes` would wedge here until the timeout killed it.
    const run: HermesRun = { stdout: "", stderr: "" };
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const timer = setTimeout(() => {
      killTree(spawned.pid);
      settle(() =>
        reject(
          new Error(
            `hermes ${args.join(" ")} did not exit within ${HERMES_TIMEOUT_MS / 1000}s and was killed.` +
              (tail(run.stderr) ? `\n${tail(run.stderr)}` : "") +
              (tail(run.stdout) ? `\n${tail(run.stdout)}` : ""),
          ),
        ),
      );
    }, HERMES_TIMEOUT_MS);
    spawned.stdout?.on("data", (chunk) => {
      run.stdout += String(chunk);
    });
    spawned.stderr?.on("data", (chunk) => {
      run.stderr += String(chunk);
    });
    spawned.once("error", (err) => settle(() => reject(spawnError(cli, err))));
    spawned.once("close", (code) => {
      if (code === 0) settle(() => resolve(run));
      else settle(() => reject(hermesFailure(args, code, run)));
    });
  });
}

async function hostPort(hermesHome: string): Promise<number> {
  try {
    const envText = await fs.readFile(path.join(hermesHome, ".env"), "utf8");
    const parsed = Number.parseInt(readEnv(envText).API_SERVER_PORT ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    /* default */
  }
  return DEFAULT_API_PORT;
}

async function waitForHealth(url: string, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await health(url)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function failureText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Ask Hermes to make sure a gateway runtime exists for `profileHome`.
 *
 * `hermes gateway ensure` is the idempotent verb: it answers with the live owner
 * as ready and starts one only when none answers. It never replaces a running
 * gateway, which is exactly the difference from `gateway restart`.
 *
 * Older Hermes has no `ensure` verb. There the fallback is `gateway start` from
 * the ROOT home: under multiplexing a named profile may not own a gateway of its
 * own, so starting from the profile home would be refused with exit 78.
 */
async function ensureGatewayRuntime(
  cli: string,
  profileHome: string,
  rootEnv: Record<string, string>,
): Promise<void> {
  try {
    await runHermes(cli, ["gateway", "ensure", "--json", "--timeout", "30"], {
      ...rootEnv,
      HERMES_HOME: profileHome,
    });
    return;
  } catch (e) {
    if (
      !/invalid choice|unknown command|unrecognized arguments/i.test(
        failureText(e),
      )
    ) {
      throw e;
    }
  }
  await runHermes(cli, ["gateway", "start"], rootEnv);
}

/**
 * Whether an `ensure` failure is still a gateway on its way up, rather than a
 * verdict. Hermes exits 5 with `state: "starting"` / `reason_code: "deadline"`
 * when the process exists but has not answered yet; that is worth polling for.
 * A refusal ("did not become ready", a missing platform service, a malformed
 * invocation) is not, and waiting the full window on it would hold the setup
 * screen for 90 seconds to report something already known.
 */
function ensureMayStillStart(text: string): boolean {
  return /"state"\s*:\s*"starting"|"reason_code"\s*:\s*"deadline"|did not exit within|timed out/i.test(
    text,
  );
}

/**
 * Make the host serve `/p/{profile}` — without restarting anything that is
 * already running.
 *
 * This function used to answer every unhealthy probe with `hermes gateway
 * restart`. On this machine that restarts the ONE host multiplexer, which serves
 * every profile at once: the operator's Telegram and Discord bots, their open
 * Hermes Desktop, and every other profile went down with it. It happened on
 * launch whenever the app did not see `/p/lifequest` quickly enough — the exact
 * disruption this function must not cause.
 *
 * The narrower contract:
 *   - host serving the profile         -> attach, do nothing;
 *   - host running, profile not served -> hot-serve that profile through
 *                                         Hermes' own control socket, or leave
 *                                         the host running and say so;
 *   - host not running                 -> `gateway ensure` starts the one
 *                                         runtime that serves the profile.
 *
 * `force` means a running host must re-read THIS profile's configuration (a
 * credential was just written, or the profile parked on a door). It is answered
 * by cycling only that profile's served runtime, never the host.
 */
async function ensureHostGateway(
  cli: string,
  hermesHome: string,
  force = false,
  profileName: string = PROFILE_NAME,
): Promise<void> {
  const extraEnv: Record<string, string> = {
    HERMES_HOME: hermesHome,
    GATEWAY_MULTIPLEX_PROFILES: "true",
  };
  const profileHome = profileDir(hermesHome, profileName);
  const port = await hostPort(hermesHome);
  const hostBase = `http://127.0.0.1:${port}`;
  // The default profile hangs off the bare base; every other one off `/p/<name>`.
  const prefix =
    profileName === "default" ? hostBase : `${hostBase}/p/${profileName}`;
  const hostUp = await health(hostBase);
  const serving =
    hostUp && (force ? await health(prefix) : await waitForHealth(prefix, 40, 500));

  if (serving) {
    if (force) {
      // The host is up and serving this profile; make it re-read the profile's
      // config by cycling that profile alone. A host that predates the control
      // verbs is left running — Hermes reconciles MCP servers from config on its
      // own housekeeping tick, and a gateway someone else is using is not ours
      // to restart.
      await refreshServedProfile(hermesHome, profileName).catch(() => false);
    }
    return;
  }

  if (hostUp) {
    // The host is up but this profile is not being served. Ask Hermes to serve
    // it, then wait. NEVER restart the host here: that would take every other
    // profile down to fix one.
    const served = await refreshServedProfile(hermesHome, profileName).catch(
      () => false,
    );
    if (await waitForHealth(prefix, served ? 40 : 20, 500)) return;
    throw new Error(
      `The Hermes host gateway is already running, but it does not serve ${prefix}. ` +
        `It was left running; no other gateway on this machine was stopped or restarted.`,
    );
  }

  // The host is down, so this is the only path that starts anything.
  //
  // The API server is the platform the companion talks to — `/health`,
  // `/v1/capabilities`, `/api/sessions` — and Hermes ships every platform
  // DISABLED (`PlatformConfig.enabled` defaults to False). A machine that has
  // never opened its API server therefore never listens on 8642. LifeQuest is
  // the one thing on this machine that needs it, so it turns it on, the same way
  // it turns multiplexing on. The listener is 127.0.0.1 only and still demands
  // the profile's API_SERVER_KEY. These are written ONLY while nothing is
  // running: changing them under a live host would have no effect until its
  // next start and is not a reason to stop it.
  const configFailures: string[] = [];
  for (const [key, value] of [
    ["gateway.multiplex_profiles", "true"],
    ["gateway.api_server.enabled", "true"],
  ]) {
    try {
      await runHermes(cli, ["config", "set", key, value], extraEnv);
    } catch (e) {
      configFailures.push(failureText(e));
    }
  }

  let startFailure: string | null = null;
  try {
    await ensureGatewayRuntime(cli, profileHome, extraEnv);
  } catch (e) {
    startFailure = failureText(e);
  }

  // The CLI exited 0 and nothing is serving. An exit code is not evidence that
  // the gateway came up: Hermes reports "✗ Gateway start via direct spawn FAILED
  // — no stable gateway process detected" on STDOUT and then exits 0
  // (`gateway_windows.py::_report_gateway_start`), so a dead gateway and a live
  // one are the same exit code and the same empty stderr. Its own words are the
  // only thing that tells them apart, so they ride along with the verdict.
  const said = [...configFailures, startFailure]
    .map((part) => tail(part ?? ""))
    .filter(Boolean)
    .join("\n");
  const verdict =
    profileName === "default"
      ? "Host gateway did not serve the default profile."
      : `Host gateway did not serve /p/${profileName}.`;

  // A refusal is a verdict, not something to wait out. Polling for 90 seconds on
  // "Gateway runtime did not become ready" only makes the operator wait for the
  // same sentence.
  if (startFailure && !ensureMayStillStart(startFailure)) {
    throw new Error(said ? `${verdict}\n${said}` : verdict);
  }
  if (await waitForHealth(prefix, 180, 500)) return;
  throw new Error(said ? `${verdict}\n${said}` : verdict);
}

/**
 * DOOR-02 / SUPP-05: every file this module writes into the Hermes home may
 * carry a credential (the profile `config.yaml` carries the companion bearer,
 * the profile `.env` carries the host API key). umask-derived 0644 is not good
 * enough, and a file that already exists keeps its inode mode when rewritten —
 * which is why the mode is both set on creation and corrected afterwards.
 */
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

function isPosix(): boolean {
  return process.platform !== "win32";
}

async function hardenPathMode(target: string, mode: number, wantDir: boolean): Promise<void> {
  if (!isPosix()) return;
  try {
    const st = await fs.stat(target);
    if ((wantDir ? st.isDirectory() : st.isFile()) && (st.mode & 0o777) !== mode) {
      await fs.chmod(target, mode);
    }
  } catch {
    /* Best effort: the write itself reports a real failure. */
  }
}

async function writeFilePrivate(p: string, body: string): Promise<void> {
  await fs.writeFile(p, body, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await hardenPathMode(p, PRIVATE_FILE_MODE, false);
}

async function mkdirPrivate(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true, mode: PRIVATE_DIR_MODE });
  await hardenPathMode(p, PRIVATE_DIR_MODE, true);
}

function realIo(): CompanionIo {
  return {
    homedir: os.homedir(),
    env: process.env,
    whichHermes,
    readFile: async (p) => {
      try {
        return await fs.readFile(p, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    writeFile: writeFilePrivate,
    mkdirp: mkdirPrivate,
    hardenFile: (p) => hardenPathMode(p, PRIVATE_FILE_MODE, false),
    isPortFree,
    health,
    capabilities,
    ensureHostGateway: (cli, home, force, profileName) =>
      ensureHostGateway(cli, home, force, profileName),
    /**
     * DOOR-01: whether this process's local door is bound. `attempted` is false
     * before any vault has opened (there is no door to bind), which is the one
     * case where leaving an existing profile entry alone is correct.
     */
    localDoor: async () => {
      const state = getLocalDoorCredentialState();
      if (!state.attempted) return null;
      return { attempted: state.attempted, bound: state.bound };
    },
    // Imported lazily for the same reason the vault token is: mcp-server owns
    // the doors and reaches Electron, and this module is imported by the chat
    // path, so a static import would close a cycle for no gain.
    doorsState: async () => {
      try {
        const { getMcpDoorState } = await import("./mcp-server.ts");
        return getMcpDoorState();
      } catch {
        return null;
      }
    },
    // The doors may be serving on e2e ports rather than 8643, and the profile
    // has to name the door that is actually listening.
    mcpUrl: () => {
      return companionMcpUrl();
    },
    /**
     * When the host itself last started, from its own pid file's mtime.
     *
     * The host writes `%HERMES_HOME%/gateway.pid` as it boots (2026-10-08:
     * process start 17:07:50, file 17:08:02), so a stamp older than the doors is
     * proof that this host has already run its one discovery pass — over a door
     * that was not there. The PID FILE IN THE PROFILE IS NOT THIS ONE: the
     * multiplexing host serves every profile out of the root home, and a
     * profile's own pid file is a stale standalone gateway's.
     */
    hostStartedAt: async () => {
      try {
        const st = await fs.stat(
          path.join(hermesRoot(process.env, os.homedir()), "gateway.pid"),
        );
        return st.mtimeMs;
      } catch {
        return null;
      }
    },
    stopPid: async () => {
      /* Host multiplexer is not LifeQuest-owned. */
    },
    listeningPid: async () => null,
  };
}

export function companionStatus(): PublicCompanionStatus {
  return publicStatus(current);
}

/**
 * The profile the companion runs on.
 *
 * The open vault owns it: a vault is a profile, so the agent binding names the
 * Hermes profile this process may touch, and a switch moves it before anything
 * reads the gateway. Only before a vault exists — the setup screen — does the
 * app-level choice still answer; it is also the value the one-time adoption
 * copies into the vault that was open at the upgrade.
 */
let activeProfile: string | null = null;
let profileLoaded = false;

async function activeProfileName(): Promise<string> {
  const scope = currentVaultScope();
  if (scope) {
    try {
      const binding = await getVaultAgentBinding(scope.id);
      if (binding.hermesProfile && isSafeProfileName(binding.hermesProfile)) {
        return binding.hermesProfile;
      }
    } catch {
      // An unreadable binding falls through to the app's own profile, which the
      // ensure then seeds and reports on.
    }
    return PROFILE_NAME;
  }
  // No vault yet: the app-level choice, read once, lazily (the first
  // `companionEnsure` can arrive before anything has had a chance to load the
  // prefs file, and `needs_install` must not wait on a settings read to answer).
  if (!profileLoaded) {
    try {
      const stored = await getCompanionProfile();
      if (stored && isSafeProfileName(stored)) activeProfile = stored;
    } catch {
      // An unreadable prefs file leaves the app on its own profile.
    }
    profileLoaded = true;
  }
  return activeProfile ?? PROFILE_NAME;
}

/**
 * The `ensure` that is running right now, if one is.
 *
 * The post-bind door check must not cycle the profile while an ensure is
 * starting that same host: two lifecycle operations racing over one gateway is
 * noise at best. Waiting for the ensure to settle costs nothing — the check
 * re-reads the doors afterwards, and a host the app has just started is a host
 * whose startup covers the binding.
 */
let ensureInFlight: Promise<PublicCompanionStatus> | null = null;
/**
 * The profile the last ensure was asked for.
 *
 * A vault switch can move the choice while a gateway is still starting. The
 * run in flight then answers for a profile the vault no longer uses, and
 * handing its promise back would leave the new vault's profile never ensured —
 * the dock would show the old agent's status under the new vault's binding.
 * A caller whose profile is no longer the one that ran waits it out and asks
 * again for the one now in force.
 */
let lastEnsuredFor: string | null = null;

async function sameProfileInForce(name: string | null): Promise<boolean> {
  return name !== null && name === (await activeProfileName());
}

export async function companionEnsure(): Promise<PublicCompanionStatus> {
  /**
   * One ensure at a time.
   *
   * Two overlapping runs do more than duplicate work: each reads and rewrites
   * the same `HERMES_HOME/.env` (an ordinary read-then-write, not an atomic
   * one), so one can read the file while the other has it half-written and lose
   * `API_SERVER_PORT` — after which the app probes Hermes' default 8642 and
   * talks to a host that has nothing to do with this run. React's StrictMode in
   * development mounts the provider twice and makes exactly that overlap, and a
   * second window or a Recheck can produce it in production.
   *
   * A profile switch is the one caller with a new answer to ask for: it waits
   * for the run already in flight and then starts its own (see
   * `companionUseProfile`), so deduplicating here cannot pin it to the profile
   * it is leaving. A vault switch does the same. The loop is the wait: it only
   * leaves once no run is in flight, so the run started after it cannot overlap
   * the one it was waiting for.
   */
  while (ensureInFlight) {
    let failure: unknown;
    const settled = await ensureInFlight.catch((e: unknown) => {
      failure = e;
      return undefined;
    });
    if (await sameProfileInForce(lastEnsuredFor)) {
      // A joiner sees the same verdict the original caller would have: a run
      // that threw keeps throwing at the caller rather than being flattened
      // into a stale status.
      if (failure !== undefined) throw failure;
      return settled ?? companionStatus();
    }
  }
  // The profile is looked up INSIDE the shared promise, before the first
  // suspension: `await activeProfileName()` in the caller's own frame would let a
  // second call slip past the guard while the first was still reading prefs,
  // and that is precisely the overlap this is here to stop.
  const run = (async () => {
    const profile = await activeProfileName();
    lastEnsuredFor = profile;
    const status = await ensureCompanion(realIo(), profile);
    const published = publish(status);
    // Deliberately not awaited: every launch calls this, and the probe is a
    // round-trip to a host that may be slow, absent, or restarting. It answers
    // onto the status when it lands (see `probePinnedModel`).
    if (status.kind === "ready") void probePinnedModel(status);
    return published;
  })();
  ensureInFlight = run.finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

/** What the picker lists, and which profile the app is on right now. */
export async function companionProfilesList(): Promise<{
  active: string;
  profiles: HermesProfileInfo[];
}> {
  const active = await activeProfileName();
  const root = hermesRoot(process.env, os.homedir());
  const profiles = await listHermesProfiles(root);
  return { active, profiles };
}

/**
 * Choose the profile the companion runs on — an installed one, or `lifequest`
 * (which the ensure then creates on the spot) — and bring it up.
 *
 * This is the way out of a stuck connect. A machine whose host never served
 * `/p/lifequest` is no longer a dead end: the operator sees every profile this
 * Hermes install has, picks one, and the app seeds it (soul, MCP entry, eager
 * tool search) and attaches to it.
 *
 * The choice's home follows the vault: while one is open the profile is the
 * vault's agent binding (picking a profile makes this vault a Hermes vault), and
 * only before a vault exists does it live in the app-level prefs. That is what
 * keeps the next vault from inheriting this one's agent.
 *
 * The name is validated here even though the renderer is ours: a name that is
 * not a plain segment would escape `profiles/` or the `/p/` prefix, and the
 * bridge is the one boundary where that is worth refusing.
 */
export async function companionUseProfile(name: string): Promise<PublicCompanionStatus> {
  const trimmed = (name ?? "").trim();
  if (!isSafeProfileName(trimmed)) {
    return { kind: "profile_error", message: `Not a usable profile name: "${name}"` };
  }
  activeProfile = trimmed;
  profileLoaded = true;
  const scope = currentVaultScope();
  try {
    if (scope) {
      // Choosing a profile binds it to the vault the same way adding an agent
      // does: it becomes the vault's Hermes agent, while which companion answers
      // is still the operator's separate "Use Hermes" decision.
      const current = await getVaultAgentBinding(scope.id);
      await setVaultAgentBinding(scope.id, {
        harness: current.harness,
        hermesProfile: trimmed,
      });
    } else {
      await setCompanionProfile(trimmed);
    }
  } catch {
    // A prefs write that fails costs the choice its memory, not this session.
  }
  // The ensure already in flight belongs to the profile being left. Let it
  // settle before asking for the new one; starting both would race their writes
  // to the same files (see `companionEnsure`).
  if (ensureInFlight) {
    try {
      await ensureInFlight;
    } catch {
      /* the old profile's failure is not this switch's verdict */
    }
  }
  return companionEnsure();
}

/**
 * What a post-bind door check found, for the caller and for the rigs.
 *
 * `seen` and `repeat` are healthy; `no-door` means there was nothing to check
 * (no vault open, or the local door could not bind); `refreshed` means the host
 * was asked to re-read this profile; `unavailable` means the host could not be
 * asked, which is reported and not retried in a loop.
 */
export type CompanionDoorCheck =
  | { kind: "no-door" }
  | { kind: "seen" }
  | { kind: "refreshed"; boundAt: number }
  | { kind: "repeat"; boundAt: number }
  | { kind: "unavailable"; error: string };

let doorCheck: Promise<CompanionDoorCheck> | null = null;
/** The binding this run has already asked the host to refresh the profile for. */
let refreshedBind: number | null = null;

/**
 * Make the running host able to see the doors that have just bound.
 *
 * `ensureCompanion` decides this once, at app start, and at app start no vault
 * need be open — so it usually has no doors to judge and attaches to whatever
 * host is serving. That host read its `mcp_servers` when IT started; if that was
 * before these doors bound, it tried, was refused, and parked. Hermes does not
 * probe a parked server again for 300s, so every session on the profile is
 * tool-less until it does — the 2026-10-08 report: "My tool list does not
 * include the LifeQuest MCP tools", from an agent that then correctly stopped
 * instead of improvising.
 *
 * So the vault-open path calls this after the doors bind. It waits the binding's
 * window out (see `hostMissedDoors`: seconds for a host that was already
 * running, the long one for a host still starting) and, if the companion never
 * arrived, asks the host to re-read this profile. That request cycles ONLY the
 * selected profile's served runtime (Hermes' `unserve-profile` / `serve-profile`
 * control verbs); it does not restart the host, because the host is the one
 * multiplexer for every profile on this machine. An older Hermes without those
 * verbs is left running: it reconciles MCP servers from config on its own
 * housekeeping tick, and the operator's other gateways stay up either way.
 *
 * One refresh per binding. A vault switch rebinds the doors and resets the
 * question, so the new binding is checked on its own; re-opening the same vault
 * asks again about a binding already answered and gets `repeat`.
 */
export function companionConfirmDoors(): Promise<CompanionDoorCheck> {
  if (doorCheck) return doorCheck;
  const run = confirmDoorsOnce().finally(() => {
    doorCheck = null;
  });
  doorCheck = run;
  return run;
}

async function confirmDoorsOnce(): Promise<CompanionDoorCheck> {
  const { getMcpDoors, getMcpDoorState } = await import("./mcp-server.ts");
  // A local door that failed to bind — 8643 held by another process — has
  // nothing for the companion to reach. That failure is Settings' to report, and
  // cycling the profile's runtime over it would be motion without cause.
  if (!getMcpDoors().localUrl || !getMcpDoorState()) return { kind: "no-door" };

  // An ensure that is starting the host right now owns that host's lifecycle:
  // let it settle, then ask the doors again. Its startup covers this binding, so
  // the answer is very often "seen" by the time we look.
  if (ensureInFlight) {
    try {
      await ensureInFlight;
    } catch {
      /* a failed ensure is the ensure caller's to report, not this check's */
    }
  }

  const missed = await hostMissedDoors(realIo());
  if (!missed) return { kind: "seen" };
  if (refreshedBind === missed.boundAt) return { kind: "repeat", boundAt: missed.boundAt };

  const cli = await whichHermes();
  if (!cli) return { kind: "unavailable", error: "hermes is not on PATH" };
  const root = hermesRoot(process.env, os.homedir());
  try {
    // `force` skips the "already healthy" shortcut: the host is healthy and that
    // is exactly the problem — it is serving without this door. The ensure then
    // cycles this profile's served runtime through Hermes' control socket; it
    // does not restart the host every profile shares.
    await ensureHostGateway(cli, root, true, await activeProfileName());
  } catch (e) {
    return { kind: "unavailable", error: e instanceof Error ? e.message : String(e) };
  }
  refreshedBind = missed.boundAt;
  return { kind: "refreshed", boundAt: missed.boundAt };
}

/**
 * Attach to a gateway that is already listening, instead of discovering one.
 *
 * `companionEnsure` probes for a Hermes on this machine and attaches to what it
 * finds; this is that same attach, given the address rather than searching for
 * it. The E2E rigs point the chat client at their own recording server with it,
 * because the alternative — making them drive the real discovery path — would
 * have them write an API key into the operator's own Hermes profile.
 *
 * `profilePath` is the profile the attached status claims to be for. It is
 * empty for a rig that attaches without a vault-scoped agent (the historical
 * shape), and the rig's own throwaway profile path when the open vault binds an
 * agent: the transport guard refuses a ready status whose profile is not the
 * vault's bound one, and a fake gateway that claimed no profile would be refused
 * for the very vault the rig just bound.
 */
export function companionAttachToGateway(
  baseUrl: string,
  apiKey: string,
  profilePath = "",
): PublicCompanionStatus {
  const normalized = baseUrl.replace(/\/$/, "");
  current = {
    kind: "ready",
    port: portFromBaseUrl(normalized),
    baseUrl: normalized,
    startedByLifeQuest: false,
    profilePath,
    cliPath: "",
    childPid: null,
    apiKey,
  };
  return publicStatus(current);
}

/**
 * KAR-70: write a vault's companion token into the Hermes profile.
 *
 * Called after a vault opens or is switched, because that is the moment
 * the doors have been rebound to the vault whose credential they now
 * accept.
 *
 * `companionToken` is passed in rather than looked up here. The caller is
 * `rememberOpen`, which runs on the vault queue; minting a token through
 * `vault-service` would re-enter that same queue and deadlock — the outer
 * task would be waiting on the inner one it just enqueued.
 *
 * DOOR-01: a null token, or a token offered for a port this process did not
 * bind, must never reach the host. The profile is what the running Hermes host
 * reads to find `lifequest`; naming `http://127.0.0.1:8643/mcp` and carrying a
 * bearer while another local process owns that port hands the companion's
 * master credential to that process on the host's next reconnect. So:
 *
 *  - the local door is bound here  -> write the url + bearer (normal path);
 *  - the app tried to bind and failed -> REMOVE our entry and the root
 *    Authorization header (a previous run's entry is already on disk);
 *  - no vault has opened, so no door was attempted -> leave the profile alone.
 *
 * Returns true only when the credential was written.
 */
export async function companionWriteMcpProfile(
  companionToken: string | null,
): Promise<boolean> {
  try {
    const root = hermesRoot(process.env, os.homedir());
    const configPath = path.join(profileDir(root, await activeProfileName()), "config.yaml");
    const rootConfigPath = path.join(root, "config.yaml");
    const door = getLocalDoorCredentialState();
    if (door.attempted && !door.bound) {
      await stripCompanionMcpProfile(realIo(), configPath, rootConfigPath);
      return false;
    }
    if (!companionToken) return false;
    await writeCompanionMcpProfile(realIo(), configPath, companionToken, rootConfigPath);
    return true;
  } catch {
    return false;
  }
}

export async function companionShutdown(): Promise<void> {
  await shutdownCompanion(current, realIo());
}

/**
 * The sentence a transport call gets while the companion is moving to this
 * vault's agent. Callers treat it as "wait for the switch", not as a defect.
 */
const SWITCHING_AGENT = "The companion is switching to this vault's agent.";

/**
 * The ready status on hand — but only while it belongs to the agent the open
 * vault is bound to.
 *
 * A vault switch between two Hermes-bound vaults is not instantaneous on the
 * transport: `rememberOpen` binds the new profile and starts its ensure in the
 * background, so until that ensure lands `current` still holds the PREVIOUS
 * profile's ready status, and its baseUrl serves the PREVIOUS profile's
 * sessions. A session list/create/read answered from it would paint the other
 * vault's chats into this one — a correct answer for the wrong agent, which no
 * renderer-side vault epoch can detect. So a transport call made while the bound
 * profile and the ready status's own profile path disagree is refused.
 *
 * Nothing is mutated for this: the ensure in flight publishes the real verdict,
 * and the caller asks again when it lands. The ensure path does not come through
 * here, so a switch can always complete.
 */
function readyOrError(): CompanionStatus & { kind: "ready" } {
  const status = current;
  if (status.kind !== "ready") {
    throw new Error("Companion is not ready");
  }
  const bound = currentVaultAgentBinding()?.hermesProfile ?? null;
  if (bound) {
    const expected = profileDir(hermesRoot(process.env, os.homedir()), bound);
    // A ready status with no profile path cannot be shown to be this vault's,
    // so it is refused as well: waiting is better than another vault's answer.
    if (status.profilePath !== expected) throw new Error(SWITCHING_AGENT);
  }
  return status;
}

async function hermesFetch(
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  const st = readyOrError();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${st.apiKey}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const base = st.baseUrl.replace(/\/$/, "");
  return fetch(`${base}${pathname}`, { ...init, headers });
}

/**
 * A gateway that stopped answering, said in words the operator can act on.
 *
 * The app attaches to a Hermes host once, at start, and holds the address it
 * found. Nothing tells it when that host later stops — so the next call is a
 * `fetch` against a closed port, and undici's own words for that are "fetch
 * failed". That string was the whole of a reported failure: the operator pressed
 * Start on a review, got "fetch failed" in the page's error slot, and had no way
 * to know that a review had nothing to do with it and that the agent was not
 * running.
 *
 * So a transport failure is named for what it is, the remembered status is
 * dropped so the next `companionEnsure` re-probes and can bring the host back,
 * and the message names the one control that retries it.
 */
const TRANSPORT_FAILURE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed|network|UND_ERR/i;

function isTransportFailure(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === "TypeError" && /fetch/i.test(e.message)) return true;
    if (TRANSPORT_FAILURE.test(e.message)) return true;
    const cause = (e as { cause?: unknown }).cause;
    if (cause) {
      const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
      if (TRANSPORT_FAILURE.test(text)) return true;
    }
    return false;
  }
  return TRANSPORT_FAILURE.test(String(e));
}

/** Forget a host that did not answer, so the next ensure looks for one again. */
function noteGatewaySilent(): void {
  if (current.kind === "ready") current = { kind: "disconnected" };
}

export function agentUnreachableMessage(what: string): string {
  return `${what}: the agent is not answering. Open Settings › Hermes and press Recheck, then try again — the review itself is unaffected.`;
}

/**
 * Run one gateway call, naming a silent gateway rather than echoing undici.
 *
 * Every session call goes through this, so "the agent is not running" reads the
 * same wherever it is hit, and a failure never leaves a dead address cached as a
 * healthy one.
 */
const NOT_READY = "Companion is not ready";

async function gatewayCall<T>(
  what: string,
  run: () => Promise<T>,
): Promise<T | { __unreachable: string }> {
  try {
    return await run();
  } catch (e) {
    if (isTransportFailure(e) || (e instanceof Error && e.message === NOT_READY)) {
      noteGatewaySilent();
      return { __unreachable: agentUnreachableMessage(what) };
    }
    throw e;
  }
}

function unreachableOf(value: unknown): string | null {
  if (value && typeof value === "object" && "__unreachable" in value) {
    return String((value as { __unreachable: unknown }).__unreachable);
  }
  return null;
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    if (
      body.error &&
      typeof body.error === "object" &&
      typeof body.error.message === "string" &&
      body.error.message.trim()
    ) {
      return body.error.message.trim();
    }
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  } catch {
    // The status line is enough when the body is not JSON.
  }
  return fallback;
}

/**
 * The profile's chats.
 *
 * `includeArchived` is the sidebar's view option: archived rows come back
 * instead of being dropped, so the operator can see and restore them. Hidden
 * rows never cross the boundary either way.
 *
 * The gateway list cannot carry an archived row: its Sessions API lists with
 * `include_archived=False` and has no query parameter that changes that (see
 * `companion-archived.ts`). So the archived half of that view is read from the
 * attached profile's own store and folded in here. The read only happens when
 * the view asks for it, so the working list pays nothing for it.
 */
export async function companionSessionsList(
  options: { includeArchived?: boolean } = {},
): Promise<
  { ok: true; value: HermesSession[] } | { ok: false; error: string }
> {
  try {
    const includeArchived = options.includeArchived === true;
    const res = await gatewayCall("Listing chats", () =>
      hermesFetch("/api/sessions?limit=200"),
    );
    const unreachable = unreachableOf(res);
    if (unreachable) return { ok: false, error: unreachable };
    const response = res as Response;
    if (!response.ok) return { ok: false, error: `Sessions list failed (${response.status})` };
    const live = sessionsFromPayload(await response.json(), { includeArchived });
    if (!includeArchived) return { ok: true, value: live };
    const profilePath = current.kind === "ready" ? current.profilePath : "";
    const archived = await readArchivedSessions(profilePath);
    return { ok: true, value: mergeArchivedSessions(live, archived) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionSessionCreate(
  title: string,
): Promise<{ ok: true; value: HermesSession } | { ok: false; error: string }> {
  try {
    const trimmed = title.trim();
    const res = await gatewayCall("Starting a chat", () =>
      hermesFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify(trimmed ? { title: trimmed } : {}),
      }),
    );
    const unreachable = unreachableOf(res);
    if (unreachable) return { ok: false, error: unreachable };
    const response = res as Response;
    if (!response.ok) {
      return {
        ok: false,
        error: await errorDetail(response, `Create session failed (${response.status})`),
      };
    }
    const created = createdSessionFromPayload(await response.json(), trimmed);
    if (!created) return { ok: false, error: "Create session missing id" };
    return { ok: true, value: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The door a page must come through before it promises the operator a chat.
 *
 * A review's Start creates or reuses a session, and until this existed it went
 * straight at a gateway the app had attached to at start-up and never checked
 * again — so a host that had since stopped produced "fetch failed" on a page
 * that had nothing to do with it. Here the status is re-established first: a
 * non-ready companion is brought up (or its reason named), and only then is a
 * session asked for.
 */
export async function companionSessionsOpen(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (current.kind === "ready") return { ok: true };
  let status: PublicCompanionStatus;
  try {
    status = await companionEnsure();
  } catch (e) {
    return {
      ok: false,
      error: `${agentUnreachableMessage("Starting the agent")} (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (status.kind === "ready") return { ok: true };
  return { ok: false, error: companionStatusMessage(status) };
}

/** One status as a sentence for a page that is not the setup screen. */
export function companionStatusMessage(status: PublicCompanionStatus): string {
  switch (status.kind) {
    case "needs_install":
      return "The agent needs the Hermes CLI on your PATH. Install Hermes, then press Recheck in Settings › Hermes.";
    case "hermes_too_old":
      return "This Hermes build does not expose the Sessions API. Update Hermes, then press Recheck in Settings › Hermes.";
    case "port_busy":
      return `Something else is on port ${status.port}. Free the Hermes host gateway port, then press Recheck in Settings › Hermes.`;
    case "auth_error":
      return "The Hermes profile key was rejected. Fix the profile .env, then press Recheck in Settings › Hermes.";
    case "profile_error":
      return `The agent's Hermes profile could not be prepared: ${status.message}`;
    case "gateway_exited":
      return `The agent stopped: ${status.detail}. Press Recheck in Settings › Hermes.`;
    default:
      return agentUnreachableMessage("Starting the agent");
  }
}

export async function companionSessionMessages(
  id: string,
): Promise<
  | { ok: true; value: TranscriptMessage[] }
  | { ok: false; error: string }
> {
  try {
    const res = await gatewayCall("Reading a chat", () =>
      hermesFetch(`/api/sessions/${encodeURIComponent(id)}/messages`),
    );
    const unreachable = unreachableOf(res);
    if (unreachable) return { ok: false, error: unreachable };
    const response = res as Response;
    if (!response.ok) return { ok: false, error: `Messages failed (${response.status})` };
    return { ok: true, value: sanitizeTranscriptRows(messagesFromPayload(await response.json())) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The client-safe session fields the gateway's PATCH accepts. */
export type CompanionSessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

/**
 * PATCH /api/sessions/{id} — rename, pin or archive one chat.
 *
 * All three are durable Hermes-side flags, so Hermes Desktop (and every other
 * channel on this profile) sees the same state; LifeQuest keeps no copy.
 *
 * ONLY FLAGS CROSS THE WIRE
 *
 * The host gateway's PATCH is a strict allowlist — `title`, `end_reason`,
 * `pinned`, `archived`, `hidden`, `unread` — and answers anything else with 400
 * `unsupported_session_field` before a write is attempted. So a body carrying a
 * mutation identity (`request_id` / `expected_revision`) is not fenced: it is
 * refused. Those fields belong to Hermes' *dashboard* backend
 * (`hermes_cli/web_server_sessions.py`, which fences its `session.mutate` RPC),
 * not to the `/api/sessions` API this app attaches to. The archive is therefore
 * the operator's plain flag write, and the gateway's own answer is the verdict.
 */
export async function companionSessionPatch(
  id: string,
  patch: CompanionSessionPatch,
): Promise<{ ok: true; value: HermesSession } | { ok: false; error: string }> {
  try {
    const body: Record<string, unknown> = {};
    if (typeof patch.title === "string") body.title = patch.title;
    if (typeof patch.pinned === "boolean") body.pinned = patch.pinned;
    if (typeof patch.archived === "boolean") body.archived = patch.archived;
    if (Object.keys(body).length === 0) {
      return { ok: false, error: "Session update had nothing to change" };
    }
    const res = await gatewayCall("Updating a chat", () =>
      hermesFetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
    const unreachable = unreachableOf(res);
    if (unreachable) return { ok: false, error: unreachable };
    const response = res as Response;
    if (!response.ok) {
      return {
        ok: false,
        error: await errorDetail(response, `Session update failed (${response.status})`),
      };
    }
    const updated = sessionFromPayload(await response.json());
    if (!updated) return { ok: false, error: "Session update returned no session" };
    return { ok: true, value: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * DELETE /api/sessions/{id} — remove one chat and every message under it.
 *
 * This is not `archived` in a stronger key: the store's own delete, so the row
 * is gone from Hermes everywhere and nothing brings it back. LifeQuest keeps no
 * copy of a chat, so there is nothing to reconcile here afterwards.
 *
 * No body and no fence fields: this app attaches to the host gateway's
 * `/api/sessions` API, which takes the delete as a plain request (see
 * `companionSessionPatch` for why a mutation identity does not belong here).
 */
export async function companionSessionDelete(
  id: string,
): Promise<
  { ok: true; value: { id: string; deleted: boolean } } | { ok: false; error: string }
> {
  try {
    const res = await gatewayCall("Deleting a chat", () =>
      hermesFetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    );
    const unreachable = unreachableOf(res);
    if (unreachable) return { ok: false, error: unreachable };
    const response = res as Response;
    if (!response.ok) {
      return {
        ok: false,
        error: await errorDetail(response, `Delete session failed (${response.status})`),
      };
    }
    const body = (await response.json()) as {
      id?: unknown;
      session_id?: unknown;
      deleted?: unknown;
      already_absent?: unknown;
    };
    /**
     * The gateway's receipt names the row it retired: the host answers
     * `{object: "hermes.session.deleted", id, deleted}`. `session_id` is read
     * too, because the dashboard backend words its receipt that way and a host
     * that adopted that shape should not be reported as a failed delete. What
     * matters is that the receipt names a row at all: a reply that names none
     * is not a delete this app can claim.
     */
    const named = [body?.id, body?.session_id].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!named) {
      const alreadyAbsent = body?.deleted === false || body?.already_absent === true;
      if (alreadyAbsent) return { ok: true, value: { id, deleted: true } };
      return { ok: false, error: "Delete session returned no id" };
    }
    return { ok: true, value: { id: named, deleted: body.deleted !== false } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * One turn: the operator's text, the vault context, and — when the composer's
 * pills carry a pick — the model/provider and thinking level that turn should
 * run under. The pick is per turn, never persisted app-side beyond the
 * composer's own stored preference, so a chat that is opened in Hermes Desktop
 * keeps running whatever that client asks for.
 *
 * Attachments ride the same call. The attachments are already in hand here:
 * main took them out of the pending slot, so this function never sees a path it
 * cannot also produce the bytes for. A receipt arrives on the older
 * `attachment` argument and keeps its own wording; the general attachments
 * arrive as a list and are described by kind.
 *
 * THE STREAM IS BOUNDED BY SILENCE, NOT BY A TOTAL TIMEOUT
 *
 * A turn may legitimately run for an hour, so there is no deadline on the whole
 * request. What cannot be legitimate is a socket that produces nothing at all:
 * the gateway writes a keepalive comment every ten seconds while it is working,
 * so a silence longer than `streamIdleMs` means the stream is gone, whatever the
 * socket thinks. When that happens the request is aborted and the turn is
 * failed with a sentence the operator can act on. The renderer then settles the
 * turn, which is the part that clears the running dot and unlocks the composer.
 */
export async function companionChatStream(
  sessionId: string,
  input: string,
  ctx: CompanionInstructionsInput,
  onEvent: (evt: ChatStreamEvent) => void,
  runtime?: CompanionRuntimeOverride | null,
  attachment?: TurnAttachment | null,
  attachments?: TurnAttachment[] | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Terminal tracking lives outside the try so a dropped socket can still settle
  // the turn instead of leaving a permanent spinner.
  let terminated = false;
  let started = false;
  // One abort controller owns the whole request, and one timer measures the
  // silence. Every byte received pushes the timer out; nothing else does.
  const stall = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => stall.abort(), streamIdleMs);
    // A watchdog must never be the reason the app process stays alive.
    idle.unref?.();
  };
  try {
    const instructions: CompanionInstructionsInput = {
      ...ctx,
      ...(attachment
        ? { attachedFile: { relPath: attachment.relPath, name: attachment.name } }
        : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };
    // Armed before the fetch: a gateway that accepts the connection and never
    // answers is the same failure as one that goes silent mid-turn.
    armIdle();
    const res = await hermesFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
      {
        method: "POST",
        body: JSON.stringify({
          input: buildTurnInput(input, attachments, attachment),
          instructions: buildInstructions(instructions),
          ...runtimeRequestBody(runtime),
        }),
        signal: stall.signal,
      },
    );
    if (!res.ok || !res.body) {
      return { ok: false, error: `Chat stream failed (${res.status})` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deliver = (evt: ChatStreamEvent) => {
      if (evt.type === "run.completed" || evt.type === "run.stopped" || evt.type === "run.incomplete") {
        terminated = true;
      }
      if (evt.type === "run.started") started = true;
      onEvent(evt);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bytes are the only heartbeat this side can see: keepalive comments are
      // dropped by the SSE parser, so they must not be mistaken for a stall.
      armIdle();
      buf += decoder.decode(value, { stream: true });
      const split = splitSse(buf);
      buf = split.rest;
      for (const evt of split.events) deliver(evt);
    }
    const tail = splitSse(buf + "\n\n");
    for (const evt of tail.events) deliver(evt);
    // A stream that closes without its terminal frame is not a finished turn:
    // the gateway died, the socket dropped, or the handler errored after the
    // last delta. Reporting it as completed is how a half-finished turn used to
    // read like a whole one. `run.incomplete` says what actually happened; the
    // terminal frame carries the snapshot, so this one carries only the reason.
    if (!terminated) {
      onEvent({ type: "run.incomplete", reason: "the stream closed before the turn finished" });
    }
    return { ok: true };
  } catch (e) {
    // The abort is ours, so it gets our sentence rather than undici's.
    const message = stall.signal.aborted
      ? STREAM_LOST
      : e instanceof Error
        ? e.message
        : String(e);
    // A transport failure mid-turn (a dropped socket, or our own silence
    // watchdog) is still a turn that ended badly. Without a terminal frame the
    // panel would keep the turn "running" forever.
    if (started && !terminated) {
      onEvent({ type: "run.incomplete", reason: message });
    }
    return { ok: false, error: message };
  } finally {
    if (idle !== undefined) clearTimeout(idle);
  }
}

/**
 * GET /api/model/options — the gateway's own model inventory for this profile.
 *
 * This is the same payload the Hermes dashboard's picker is built from, so the
 * composer's menu cannot drift from what the gateway can actually route. It is
 * read once when the dock needs it and never polled: the catalog changes when
 * the operator changes providers in Hermes, which is a restart-shaped event.
 */
export async function companionModelOptions(): Promise<
  { ok: true; value: CompanionModelCatalog } | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch("/api/model/options");
    if (!res.ok) {
      return { ok: false, error: `Model catalog failed (${res.status})` };
    }
    const catalog = modelCatalogFromPayload(await res.json());
    if (!catalog) return { ok: false, error: "Model catalog listed no models" };
    return { ok: true, value: catalog };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionApproval(
  runId: string,
  requestId: string,
  allow: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await hermesFetch(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      // Hermes 0.22.5 refuses `{allow}` (400) and fences approvals on
      // `choice`: once | session | always | deny. "Approve once" is the dock's
      // one button; "deny" is the same button's other state.
      body: JSON.stringify({ request_id: requestId, choice: allow ? "once" : "deny" }),
    });
    if (!res.ok) return { ok: false, error: `Approval failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Interrupt a live run. The gateway stops it cooperatively (the run ends as
 * `cancelled` and the SSE stream closes on its own), so the caller learns the
 * turn is over from the stream, never from this response.
 */
export async function companionRunStop(
  runId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await hermesFetch(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
    });
    if (!res.ok) return { ok: false, error: `Stop failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Steer a live run: add guidance to a turn that is already running.
 *
 * The gateway takes the text and hands it to the running agent, which reads it
 * at its next step - the agent abandons what it was doing and answers the
 * steer. That is how the operator says "actually, keep it to the second page"
 * without cancelling the turn and losing the work already done.
 *
 * The gateway answers in three ways that mean different things to the
 * operator, and each one gets its own sentence, because "steer failed" tells
 * the operator nothing about whether their message went anywhere:
 *
 *  - 200: the steer was accepted and the agent has it;
 *  - 404 `run_not_found`: the run id is unknown to the gateway. The gateway
 *    resolves the run BEFORE it looks at the text, so this also answers 404
 *    for an empty steer;
 *  - 409 `run_not_accepting_steer`: the run is known but is not running - it
 *    finished between the keypress and this call, or it is waiting for an
 *    approval, or it is already stopping;
 *  - 400 `invalid_steer_input`: the text was empty.
 *
 * The empty text is refused HERE, before the call, so the operator is told
 * what is wrong with their own input rather than being sent to the far end
 * for a verdict about a run they may never have heard of.
 */
export async function companionRunSteer(
  runId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const steerText = typeof text === "string" ? text.trim() : "";
  if (!steerText) {
    return { ok: false, error: "Type what you want the agent to do instead." };
  }
  try {
    const res = await hermesFetch(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      body: JSON.stringify({ input: steerText }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) {
      return {
        ok: false,
        error: "That turn is no longer running, so the message could not be steered into it.",
      };
    }
    if (res.status === 409) {
      return {
        ok: false,
        error: "That turn has already finished, so the message could not be steered into it.",
      };
    }
    // Anything else: the gateway's own message names the reason in one
    // sentence, and the status alone does not.
    return {
      ok: false,
      error: await errorDetail(res, `Steer failed (${res.status})`),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionOpenProfileFolder(): Promise<void> {
  if (current.kind !== "ready") return;
  await shell.openPath(current.profilePath);
}

/**
 * What the companion is told, and what it has been given to read — for Settings.
 *
 * The system prompt is assembled from three places the operator cannot see from
 * inside the app: the profile's SOUL.md, the per-turn `instructions` this app
 * appends to every chat turn, and the skill library Hermes keeps beside the
 * profile. Showing them is the point; the reason it matters is the empty-schema
 * failure, where the answer to "why can my companion not make a card?" was in
 * none of the three.
 *
 * `instructions` is built from the same context the chat path would send for the
 * turn in front of the operator — the active domain lens, its board, that board's
 * lock, About me, and the filing pref — so what Settings shows is what the agent
 * would actually receive, not a generic sample.
 */
export async function companionPrompts(): Promise<
  { ok: true; value: CompanionPrompts } | { ok: false; error: string }
> {
  try {
    const root = hermesRoot(process.env, os.homedir());
    const dir = profileDir(root, await activeProfileName());
    const context = await currentInstructionsContext();
    const instructions = buildInstructions(context);
    const value = await readCompanionPrompts({ profilePath: dir, instructions, context });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The instructions context as the chat panel would send it right now.
 *
 * Imported lazily, like the companion token: `vault-service` imports this module
 * for the chat stream, so a static import would close a cycle. A failure to read
 * the vault is not an error for a read-only Settings page — it means no vault is
 * open, and the context says exactly that.
 */
async function currentInstructionsContext(): Promise<CompanionInstructionsInput> {
  const fileUnsolicited = await getFileUnsolicited();
  try {
    const vault = await import("./vault-service.ts");
    const [snap, activeSlug] = await Promise.all([
      vault.vaultGetSnapshot(),
      vault.domainGetActive(),
    ]);
    const snapshot = snap.ok ? snap.value : null;
    // The home board follows the domain lens, so the active domain IS the board
    // the operator is looking at; null (Overview) when no domain is active.
    const boardSlug = activeSlug ?? null;
    let boardLocked: boolean | undefined;
    if (snapshot) {
      const board = await vault.pinsList(boardSlug);
      if (board.ok) boardLocked = board.value.locked;
    }
    return {
      domainName:
        snapshot?.domains.find((d) => d.slug === activeSlug)?.meta.name ?? null,
      domainSlug: activeSlug,
      viewingBoard: boardSlug,
      ...(boardLocked === undefined ? {} : { viewingBoardLocked: boardLocked }),
      aboutMe: snapshot?.map?.aboutMe ?? "",
      // The agent lock belongs to the map, not to this page; the chat panel sends
      // false and so does this, so the two texts agree.
      locked: false,
      vaultOpen: Boolean(snapshot),
      fileUnsolicited,
      // The Settings preview has to show the same paragraph the turn would: a
      // companion that is told the rubric on one screen and not the other is
      // the drift this page exists to end. Null once the record is complete.
      onboarding: snapshot
        ? onboardingContextOf(
            snapshot.onboarding,
            snapshot.onboardingProposal !== null,
          )
        : null,
    };
  } catch {
    return {
      domainName: null,
      domainSlug: null,
      aboutMe: "",
      locked: false,
      vaultOpen: false,
      fileUnsolicited,
    };
  }
}
