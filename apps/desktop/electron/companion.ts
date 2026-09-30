import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import {
  DEFAULT_API_PORT,
  PROFILE_NAME,
  readEnv,
} from "./companion-profile.ts";
import { hermesSpawnSpec } from "./companion-spawn.ts";
import {
  buildInstructions,
  createdSessionFromPayload,
  messagesFromPayload,
  sessionsFromPayload,
  splitSse,
  type ChatStreamEvent,
  type CompanionInstructionsInput,
  type HermesSession,
} from "./companion-client.ts";
import {
  ensureCompanion,
  shutdownCompanion,
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
  };
}

export function companionStatus(): PublicCompanionStatus {
  return publicStatus(current);
}

export async function companionEnsure(): Promise<PublicCompanionStatus> {
  current = await ensureCompanion(realIo());
  return publicStatus(current);
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

export async function companionChatStream(
  sessionId: string,
  input: string,
  ctx: CompanionInstructionsInput,
  onEvent: (evt: ChatStreamEvent) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await hermesFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
      {
        method: "POST",
        body: JSON.stringify({ input, instructions: buildInstructions(ctx) }),
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

export async function companionOpenProfileFolder(): Promise<void> {
  if (current.kind !== "ready") return;
  await shell.openPath(current.profilePath);
}
