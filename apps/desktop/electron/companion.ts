import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { companionMcpUrl } from "./mcp-server.ts";
import {
  DEFAULT_API_PORT,
  PROFILE_NAME,
  hermesRoot,
  portFromBaseUrl,
  profileDir,
  readEnv,
  checkPinnedModel,
} from "./companion-profile.ts";
import { hermesSpawnSpec } from "./companion-spawn.ts";
import { getFileUnsolicited } from "./companion-filing.ts";
import {
  readCompanionPrompts,
  type CompanionPrompts,
} from "./companion-prompts.ts";
import {
  buildInstructions,
  buildTurnInput,
  createdSessionFromPayload,
  messagesFromPayload,
  modelCatalogFromPayload,
  runtimeRequestBody,
  sessionFromPayload,
  sessionsFromPayload,
  splitSse,
  type ChatStreamEvent,
  type CompanionInstructionsInput,
  type CompanionModelCatalog,
  type CompanionRuntimeOverride,
  type HermesSession,
  type TurnAttachment,
} from "./companion-client.ts";
import {
  ensureCompanion,
  hostMissedDoors,
  shutdownCompanion,
  writeCompanionMcpProfile,
  type CompanionIo,
  type CompanionStatus,
} from "./companion-lifecycle.ts";

export type PublicCompanionStatus = Exclude<CompanionStatus, { kind: "ready" }> | {
  kind: "ready";
  port: number;
  baseUrl: string;
  startedByLifeQuest: boolean;
  profilePath: string;
  cliPath: string;
  childPid: number | null;
  modelWarning?: string;
};

export function publicStatus(status: CompanionStatus): PublicCompanionStatus {
  if (status.kind !== "ready") return status;
  const { apiKey: _key, ...rest } = status;
  return rest;
}

let current: CompanionStatus = { kind: "needs_install" };

function spawnError(cli: string, err: unknown): Error {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`spawn ${code || "error"} (${cli}): ${msg}`);
}

async function whichHermes(): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? ["hermes"] : ["-v", "hermes"];
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: String(stdout) });
      });
    });
    const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || null;
  } catch {
    if (process.platform === "win32") {
      try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
          execFile(
            "where.exe",
            ["hermes.cmd"],
            { timeout: 5000, windowsHide: true },
            (err, stdout) => {
              if (err) reject(err);
              else resolve({ stdout: String(stdout) });
            },
          );
        });
        const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        return line || null;
      } catch {
        return null;
      }
    }
    return null;
  }
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

async function runHermes(
  cli: string,
  args: string[],
  extraEnv: Record<string, string>,
): Promise<void> {
  const spec = hermesSpawnSpec(process.platform, cli, args, extraEnv);
  await new Promise<void>((resolve, reject) => {
    let spawned: ChildProcess;
    try {
      spawned = spawn(spec.file, spec.args, spec.options);
    } catch (err) {
      reject(spawnError(cli, err));
      return;
    }
    let stderr = "";
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
              (stderr.trim() ? `\n${stderr.trim()}` : ""),
          ),
        ),
      );
    }, HERMES_TIMEOUT_MS);
    spawned.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    spawned.once("error", (err) => settle(() => reject(spawnError(cli, err))));
    spawned.once("close", (code) => {
      if (code === 0) settle(resolve);
      else {
        settle(() =>
          reject(
            new Error(
              stderr.trim() || `hermes ${args.join(" ")} exited ${code ?? "unknown"}`,
            ),
          ),
        );
      }
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

/**
 * Make the host serve `/p/{profile}`.
 *
 * `force` skips the "already healthy" shortcut. It exists for one case: this run
 * rewrote the companion credential, and a host that is already up read its
 * `mcp_servers` at start and keeps that connection for its lifetime — so the
 * repaired header only reaches its sessions after a restart. Without the force,
 * the host looks healthy, the app attaches, and every session on the profile
 * silently has no lifequest tools.
 */
async function ensureHostGateway(cli: string, hermesHome: string, force = false): Promise<void> {
  const extraEnv: Record<string, string> = {
    HERMES_HOME: hermesHome,
    GATEWAY_MULTIPLEX_PROFILES: "true",
  };
  const port = await hostPort(hermesHome);
  const hostBase = `http://127.0.0.1:${port}`;
  const prefix = `${hostBase}/p/${PROFILE_NAME}`;
  const hostUp = await health(hostBase);
  if (!force && hostUp && (await waitForHealth(prefix, 40, 500))) return;

  await runHermes(
    cli,
    ["config", "set", "gateway.multiplex_profiles", "true"],
    extraEnv,
  );
  if (hostUp) {
    try {
      await runHermes(cli, ["gateway", "restart"], extraEnv);
    } catch {
      await runHermes(cli, ["gateway", "start"], extraEnv);
    }
  } else {
    await runHermes(cli, ["gateway", "start"], extraEnv);
  }
  if (await waitForHealth(prefix, 180, 500)) return;
  throw new Error("Host gateway did not serve /p/lifequest.");
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
    writeFile: (p, body) => fs.writeFile(p, body, "utf8"),
    mkdirp: (p) => fs.mkdir(p, { recursive: true }).then(() => undefined),
    isPortFree,
    health,
    capabilities,
    ensureHostGateway: (cli, home, force) => ensureHostGateway(cli, home, force),
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
    checkModel: checkPinnedModel,
  };
}

export function companionStatus(): PublicCompanionStatus {
  return publicStatus(current);
}

/**
 * The `ensure` that is running right now, if one is.
 *
 * The post-bind door check must not run its own `gateway restart` while an
 * ensure is starting that same host: two lifecycle commands racing over one
 * gateway is noise at best. Waiting for the ensure to settle costs nothing —
 * the check re-reads the doors afterwards, and a host the app has just started
 * is a host whose startup covers the binding.
 */
let ensureInFlight: Promise<PublicCompanionStatus> | null = null;

export async function companionEnsure(): Promise<PublicCompanionStatus> {
  const run = ensureCompanion(realIo()).then((status) => {
    current = status;
    return publicStatus(status);
  });
  ensureInFlight = run.finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

/**
 * What a post-bind door check found, for the caller and for the rigs.
 *
 * `seen` and `repeat` are healthy; `no-door` means there was nothing to check
 * (no vault open, or the local door could not bind); `unavailable` means the
 * host could not be asked to re-read, which is reported and not retried in a
 * loop.
 */
export type CompanionDoorCheck =
  | { kind: "no-door" }
  | { kind: "seen" }
  | { kind: "refreshed"; boundAt: number }
  | { kind: "repeat"; boundAt: number }
  | { kind: "unavailable"; error: string };

let doorCheck: Promise<CompanionDoorCheck> | null = null;
/** The binding this run has already restarted the host for. */
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
 * arrived, restarts the host so it re-reads a config that now points at a live
 * door. That is the same lever `ensureCompanion` pulls when it writes a
 * credential a running host cannot see, and it is the only one the app owns: the
 * host's own reconnect lives behind a chat slash command, not an endpoint.
 *
 * One restart per binding. A vault switch rebinds the doors and resets the
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
  // restarting the host over it would be motion without cause.
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
    // is exactly the problem — it is serving without this door.
    await ensureHostGateway(cli, root, true);
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
 */
export function companionAttachToGateway(
  baseUrl: string,
  apiKey: string,
): PublicCompanionStatus {
  const normalized = baseUrl.replace(/\/$/, "");
  current = {
    kind: "ready",
    port: portFromBaseUrl(normalized),
    baseUrl: normalized,
    startedByLifeQuest: false,
    profilePath: "",
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
 * task would be waiting on the inner one it just enqueued. Null means no
 * token, and the profile is left exactly as it is.
 */
export async function companionWriteMcpProfile(
  companionToken: string | null,
): Promise<boolean> {
  if (!companionToken) return false;
  try {
    const root = hermesRoot(process.env, os.homedir());
    await writeCompanionMcpProfile(
      realIo(),
      path.join(profileDir(root), "config.yaml"),
      companionToken,
      path.join(root, "config.yaml"),
    );
    return true;
  } catch {
    return false;
  }
}

export async function companionShutdown(): Promise<void> {
  await shutdownCompanion(current, realIo());
}

function readyOrError(): CompanionStatus & { kind: "ready" } {
  if (current.kind !== "ready") {
    throw new Error("Companion is not ready");
  }
  return current;
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

export async function companionSessionsList(): Promise<
  { ok: true; value: HermesSession[] } | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch("/api/sessions?limit=200");
    if (!res.ok) return { ok: false, error: `Sessions list failed (${res.status})` };
    return { ok: true, value: sessionsFromPayload(await res.json()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionSessionCreate(
  title: string,
): Promise<{ ok: true; value: HermesSession } | { ok: false; error: string }> {
  try {
    const trimmed = title.trim();
    const res = await hermesFetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify(trimmed ? { title: trimmed } : {}),
    });
    if (!res.ok) {
      return { ok: false, error: await errorDetail(res, `Create session failed (${res.status})`) };
    }
    const created = createdSessionFromPayload(await res.json(), trimmed);
    if (!created) return { ok: false, error: "Create session missing id" };
    return { ok: true, value: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionSessionMessages(
  id: string,
): Promise<
  | { ok: true; value: { role: "user" | "assistant"; content: string }[] }
  | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch(`/api/sessions/${encodeURIComponent(id)}/messages`);
    if (!res.ok) return { ok: false, error: `Messages failed (${res.status})` };
    return { ok: true, value: messagesFromPayload(await res.json()) };
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
    const res = await hermesFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: await errorDetail(res, `Session update failed (${res.status})`) };
    }
    const updated = sessionFromPayload(await res.json());
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
 */
export async function companionSessionDelete(
  id: string,
): Promise<
  { ok: true; value: { id: string; deleted: boolean } } | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      return { ok: false, error: await errorDetail(res, `Delete session failed (${res.status})`) };
    }
    const body = (await res.json()) as { id?: unknown; deleted?: unknown };
    // The gateway answers `{object, id, deleted}`; `deleted: false` means the row
    // was already gone, which is the outcome the caller wanted either way.
    if (typeof body?.id !== "string") return { ok: false, error: "Delete session returned no id" };
    return { ok: true, value: { id: body.id, deleted: body.deleted !== false } };
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
 * A receipt rides the same call when the operator attached one. The attachment
 * is already in hand here: main took it out of the pending slot, so this
 * function never sees a path it cannot also produce the bytes for.
 */
export async function companionChatStream(
  sessionId: string,
  input: string,
  ctx: CompanionInstructionsInput,
  onEvent: (evt: ChatStreamEvent) => void,
  runtime?: CompanionRuntimeOverride | null,
  attachment?: TurnAttachment | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const instructions = attachment
      ? { ...ctx, attachedFile: { relPath: attachment.relPath, name: attachment.name } }
      : ctx;
    const res = await hermesFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
      {
        method: "POST",
        body: JSON.stringify({
          input: buildTurnInput(input, attachment),
          instructions: buildInstructions(instructions),
          ...runtimeRequestBody(runtime),
        }),
      },
    );
    if (!res.ok || !res.body) {
      return { ok: false, error: `Chat stream failed (${res.status})` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const split = splitSse(buf);
      buf = split.rest;
      for (const evt of split.events) onEvent(evt);
    }
    const tail = splitSse(buf + "\n\n");
    for (const evt of tail.events) onEvent(evt);
    onEvent({ type: "run.completed" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
      body: JSON.stringify({ request_id: requestId, allow }),
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
    const dir = profileDir(root);
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
