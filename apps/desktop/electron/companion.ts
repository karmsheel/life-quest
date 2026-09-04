import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { readEnv } from "./companion-profile.ts";
import { hermesSpawnSpec } from "./companion-spawn.ts";
import {
  buildInstructions,
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
let child: ChildProcess | null = null;

function spawnError(cli: string, err: unknown): Error {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`spawn ${code || "error"} (${cli}): ${msg}`);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

async function spawnGateway(cli: string, profileDirPath: string): Promise<{ pid: number }> {
  let extraEnv: Record<string, string> = {};
  try {
    const envText = await fs.readFile(path.join(profileDirPath, ".env"), "utf8");
    extraEnv = readEnv(envText);
  } catch {
    /* profile .env may not exist yet */
  }
  const hermesHome = path.dirname(path.dirname(profileDirPath));
  extraEnv.HERMES_HOME = hermesHome;
  const spec = hermesSpawnSpec(
    process.platform,
    cli,
    ["-p", "lifequest", "gateway"],
    extraEnv,
  );
  const proc = await new Promise<ChildProcess>((resolve, reject) => {
    let settled = false;
    let spawned: ChildProcess;
    try {
      spawned = spawn(spec.file, spec.args, spec.options);
    } catch (err) {
      reject(spawnError(cli, err));
      return;
    }
    spawned.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(spawnError(cli, err));
    });
    spawned.once("spawn", () => {
      if (settled) return;
      settled = true;
      resolve(spawned);
    });
  });
  child = proc;
  if (proc.pid == null) {
    throw new Error("Failed to spawn hermes gateway");
  }
  let port = 8650;
  try {
    const envText = await fs.readFile(path.join(profileDirPath, ".env"), "utf8");
    const parsed = Number.parseInt(readEnv(envText).API_SERVER_PORT ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) port = parsed;
  } catch {
    /* default port */
  }
  const dedicated = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (await health(dedicated)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { pid: proc.pid };
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
    spawnGateway: (cli, dir) => spawnGateway(cli, dir),
    stopPid: async (pid) => {
      try {
        if (process.platform === "win32") {
          await new Promise<void>((resolve) => {
            execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve());
          });
        } else {
          process.kill(pid, "SIGTERM");
        }
      } catch {
        /* already gone */
      }
      if (child?.pid === pid) child = null;
    },
    listeningPid: async () => {
      if (child?.pid && processAlive(child.pid)) return child.pid;
      return null;
    },
  };
}

export function companionStatus(): PublicCompanionStatus {
  return publicStatus(current);
}

export async function companionEnsure(): Promise<PublicCompanionStatus> {
  current = await ensureCompanion(realIo());
  if (current.kind === "ready" && current.startedByLifeQuest && current.childPid == null) {
    current = { ...current, childPid: child?.pid ?? null };
  }
  return publicStatus(current);
}

export async function companionShutdown(): Promise<void> {
  await shutdownCompanion(current, realIo());
  child = null;
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

function asSessions(payload: unknown): HermesSession[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as { sessions?: unknown; data?: unknown; items?: unknown })
          .sessions ??
        (payload as { data?: unknown }).data ??
        (payload as { items?: unknown }).items)
      : [];
  if (!Array.isArray(rows)) return [];
  const out: HermesSession[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; session_id?: unknown; title?: unknown; name?: unknown };
    const id = String(r.id ?? r.session_id ?? "");
    if (!id) continue;
    out.push({ id, title: String(r.title ?? r.name ?? "Session") });
  }
  return out;
}

export async function companionSessionsList(): Promise<
  { ok: true; value: HermesSession[] } | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch("/api/sessions");
    if (!res.ok) return { ok: false, error: `Sessions list failed (${res.status})` };
    return { ok: true, value: asSessions(await res.json()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionSessionCreate(
  title: string,
): Promise<{ ok: true; value: HermesSession } | { ok: false; error: string }> {
  try {
    const res = await hermesFetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return { ok: false, error: `Create session failed (${res.status})` };
    const data = (await res.json()) as { id?: string; title?: string };
    const id = String(data.id ?? "");
    if (!id) return { ok: false, error: "Create session missing id" };
    return { ok: true, value: { id, title: String(data.title ?? title) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionSessionMessages(
  id: string,
): Promise<
  | { ok: true; value: { role: string; content: string }[] }
  | { ok: false; error: string }
> {
  try {
    const res = await hermesFetch(`/api/sessions/${encodeURIComponent(id)}/messages`);
    if (!res.ok) return { ok: false, error: `Messages failed (${res.status})` };
    const payload = (await res.json()) as unknown;
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { messages?: unknown }).messages)
        ? (payload as { messages: unknown[] }).messages
        : [];
    const value: { role: string; content: string }[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as { role?: unknown; content?: unknown };
      const role = r.role === "assistant" ? "assistant" : "user";
      const content = typeof r.content === "string" ? r.content : "";
      value.push({ role, content });
    }
    return { ok: true, value };
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
