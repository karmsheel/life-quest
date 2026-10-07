import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import {
  DEFAULT_API_PORT,
  PROFILE_NAME,
  hermesRoot,
  profileDir,
  readEnv,
  checkPinnedModel,
} from "./companion-profile.ts";
import { hermesSpawnSpec } from "./companion-spawn.ts";
import {
  buildInstructions,
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
} from "./companion-client.ts";
import {
  ensureCompanion,
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
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

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
    spawned.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    spawned.once("error", (err) => reject(spawnError(cli, err)));
    spawned.once("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            stderr.trim() || `hermes ${args.join(" ")} exited ${code ?? "unknown"}`,
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

async function ensureHostGateway(cli: string, hermesHome: string): Promise<void> {
  const extraEnv: Record<string, string> = {
    HERMES_HOME: hermesHome,
    GATEWAY_MULTIPLEX_PROFILES: "true",
  };
  const port = await hostPort(hermesHome);
  const hostBase = `http://127.0.0.1:${port}`;
  const prefix = `${hostBase}/p/${PROFILE_NAME}`;
  const hostUp = await health(hostBase);
  if (hostUp && (await waitForHealth(prefix, 40, 500))) return;

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
    ensureHostGateway: (cli, home) => ensureHostGateway(cli, home),
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

export async function companionEnsure(): Promise<PublicCompanionStatus> {
  current = await ensureCompanion(realIo());
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
 */
export async function companionChatStream(
  sessionId: string,
  input: string,
  ctx: CompanionInstructionsInput,
  onEvent: (evt: ChatStreamEvent) => void,
  runtime?: CompanionRuntimeOverride | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await hermesFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
      {
        method: "POST",
        body: JSON.stringify({
          input,
          instructions: buildInstructions(ctx),
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
