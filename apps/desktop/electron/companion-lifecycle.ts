import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  COMPANION_SOUL,
  DEFAULT_API_PORT,
  MCP_URL,
  PROFILE_NAME,
  RESERVED_PORTS,
  attachCandidateBaseUrls,
  ensureMcpServer,
  hermesRoot,
  portFromBaseUrl,
  profileDir,
  readEnv,
  shouldSeedSoul,
  upsertEnv,
} from "./companion-profile.ts";

const RESERVED = new Set<number>(RESERVED_PORTS);

export type CompanionReady = {
  kind: "ready";
  port: number;
  baseUrl: string;
  startedByLifeQuest: boolean;
  profilePath: string;
  cliPath: string;
  apiKey: string;
  childPid: number | null;
};

export type CompanionStatus =
  | CompanionReady
  | { kind: "needs_install" }
  | { kind: "profile_error"; message: string; path?: string }
  | { kind: "port_busy"; port: number }
  | { kind: "gateway_exited"; stderr: string }
  | { kind: "disconnected" }
  | { kind: "hermes_too_old"; version?: string }
  | { kind: "auth_error" };

export type CompanionIo = {
  homedir: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  whichHermes: () => Promise<string | null>;
  readFile: (p: string) => Promise<string | null>;
  writeFile: (p: string, body: string) => Promise<void>;
  mkdirp: (p: string) => Promise<void>;
  isPortFree: (port: number) => Promise<boolean>;
  health: (url: string) => Promise<boolean>;
  capabilities: (baseUrl: string, key: string) => Promise<unknown | null>;
  ensureHostGateway: (cli: string, hermesHome: string) => Promise<void>;
  stopPid: (pid: number) => Promise<void>;
  listeningPid: (port: number) => Promise<number | null>;
};

export function capabilitiesSupportSessions(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as {
    features?: Record<string, unknown>;
    endpoints?: Record<string, unknown>;
  };
  const features = obj.features ?? {};
  const hasSessions =
    features.session_list === true ||
    features.session_resources === true ||
    features.session_chat === true;
  if (!hasSessions) return false;
  if (features.session_chat_stream === true) return true;
  if (features.session_chat_streaming === true) return true;
  if (features.chat_stream === true) return true;
  return typeof obj.endpoints?.session_chat_stream === "string";
}

function sessionCapsKind(
  caps: unknown,
): "ok" | "auth_error" | "hermes_too_old" {
  if (caps == null) return "auth_error";
  return capabilitiesSupportSessions(caps) ? "ok" : "hermes_too_old";
}

export async function choosePort(
  envText: string,
  isPortFree: (port: number) => Promise<boolean>,
): Promise<number> {
  const map = readEnv(envText);
  const parsed = Number.parseInt(map.API_SERVER_PORT ?? "", 10);
  let start =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_API_PORT;
  if (RESERVED.has(start)) start = DEFAULT_API_PORT;
  for (let port = start; port < start + 100; port++) {
    if (RESERVED.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  let fallback = start + 100;
  while (RESERVED.has(fallback)) fallback += 1;
  return fallback;
}

export function shouldStopChild(
  startedByUs: boolean,
  childPid: number | null | undefined,
  listeningPid: number | null,
): boolean {
  if (!startedByUs || childPid == null || listeningPid == null) return false;
  return childPid === listeningPid;
}

export async function ensureCompanion(io: CompanionIo): Promise<CompanionStatus> {
  const cli = await io.whichHermes();
  if (!cli) return { kind: "needs_install" };

  const root = hermesRoot(io.env, io.homedir);
  const dir = profileDir(root);
  const envPath = path.join(dir, ".env");
  const configPath = path.join(dir, "config.yaml");
  const soulPath = path.join(dir, "SOUL.md");

  try {
    await io.mkdirp(dir);
  } catch (e) {
    return {
      kind: "profile_error",
      message: e instanceof Error ? e.message : String(e),
      path: dir,
    };
  }

  let envText = (await io.readFile(envPath)) ?? "";
  const existing = readEnv(envText);
  const apiKey =
    existing.API_SERVER_KEY?.trim() || randomBytes(24).toString("hex");

  try {
    envText = upsertEnv(envText, { API_SERVER_KEY: apiKey });
    await io.writeFile(envPath, envText);
    const yaml = (await io.readFile(configPath)) ?? "";
    await io.writeFile(configPath, ensureMcpServer(yaml, PROFILE_NAME, MCP_URL));
    const soul = await io.readFile(soulPath);
    if (shouldSeedSoul(soul)) {
      await io.writeFile(soulPath, COMPANION_SOUL);
    }
  } catch (e) {
    return {
      kind: "profile_error",
      message: e instanceof Error ? e.message : String(e),
      path: dir,
    };
  }

  const hostEnv = readEnv((await io.readFile(path.join(root, ".env"))) ?? "");
  const hostPortParsed = Number.parseInt(hostEnv.API_SERVER_PORT ?? "", 10);
  const hostPort =
    Number.isFinite(hostPortParsed) && hostPortParsed > 0
      ? hostPortParsed
      : DEFAULT_API_PORT;

  const tryAttach = async (): Promise<CompanionStatus | null> => {
    for (const baseUrl of attachCandidateBaseUrls(hostPort)) {
      if (!(await io.health(baseUrl))) continue;
      const caps = await io.capabilities(baseUrl, apiKey);
      const capsKind = sessionCapsKind(caps);
      if (capsKind !== "ok") return { kind: capsKind };
      return {
        kind: "ready",
        port: portFromBaseUrl(baseUrl),
        baseUrl,
        startedByLifeQuest: false,
        profilePath: dir,
        cliPath: cli,
        apiKey,
        childPid: null,
      };
    }
    return null;
  };

  const attached = await tryAttach();
  if (attached) return attached;

  try {
    await io.ensureHostGateway(cli, root);
  } catch (e) {
    return {
      kind: "gateway_exited",
      stderr: e instanceof Error ? e.message : String(e),
    };
  }

  const after = await tryAttach();
  if (after) return after;
  return {
    kind: "gateway_exited",
    stderr: "Host gateway did not serve /p/lifequest.",
  };
}

export async function shutdownCompanion(
  status: CompanionStatus,
  io: Pick<CompanionIo, "stopPid" | "listeningPid">,
): Promise<void> {
  if (status.kind !== "ready") return;
  const listening = await io.listeningPid(status.port);
  if (!shouldStopChild(status.startedByLifeQuest, status.childPid, listening)) {
    return;
  }
  if (status.childPid != null) await io.stopPid(status.childPid);
}
