import path from "node:path";

export const PROFILE_NAME = "lifequest";
/** Dedicated listener if we must spawn. 8644 is Hermes' webhook adapter. */
export const DEFAULT_API_PORT = 8650;
export const RESERVED_PORTS = [8642, 8643, 8644] as const;
export const DISCOVERY_PORTS = [8642, 8644, 8645, 8650] as const;
export const MCP_URL = "http://127.0.0.1:8643/mcp";
export const COMPANION_SOUL = `You are the LifeQuest companion. Help the user set up and use LifeQuest: vaults, domains, Why → What → How, Life Map, Architecture, tasks, and the agent lock. Prefer LifeQuest MCP tools (lifequest) for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Why, What, or How; use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.
`;

const RESERVED = new Set<number>(RESERVED_PORTS);

export function hermesRoot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homedir: string,
): string {
  const raw = env.HERMES_HOME?.trim();
  if (raw) {
    const normalized = path.normalize(raw);
    const parent = path.dirname(normalized);
    if (path.basename(parent) === "profiles") {
      return path.dirname(parent);
    }
    return normalized;
  }
  const local = env.LOCALAPPDATA?.trim();
  if (local) {
    return path.join(local, "hermes");
  }
  return path.join(homedir, ".hermes");
}

/** Bases to probe before spawning. Prefer /p/lifequest on a shared gateway. */
export function attachCandidateBaseUrls(envPort: number | null): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const prefix = (port: number) => `http://127.0.0.1:${port}/p/${PROFILE_NAME}`;
  const raw = (port: number) => `http://127.0.0.1:${port}`;
  if (envPort && envPort > 0) {
    add(prefix(envPort));
    add(raw(envPort));
  }
  for (const port of DISCOVERY_PORTS) {
    add(prefix(port));
  }
  return urls;
}

export function portFromBaseUrl(baseUrl: string): number {
  try {
    const port = Number.parseInt(new URL(baseUrl).port, 10);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_API_PORT;
  } catch {
    return DEFAULT_API_PORT;
  }
}

export function profileDir(root: string): string {
  return path.join(root, "profiles", PROFILE_NAME);
}

export function readEnv(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return map;
}

export function upsertEnv(
  text: string,
  updates: Record<string, string>,
): string {
  const seen = new Set<string>();
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (key in updates) {
      out.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  let joined = out.join("\n");
  if (!joined.endsWith("\n")) joined += "\n";
  return joined;
}

export function ensureMcpServer(
  yaml: string,
  name: string,
  url: string,
): string {
  const keyRe = new RegExp(`(^|\\n)[ \\t]*${escapeRegExp(name)}:[ \\t]*`, "m");
  if (keyRe.test(yaml) && /mcp_servers:/m.test(yaml)) {
    return yaml;
  }
  const block = `  ${name}:\n    url: ${url}\n`;
  if (/^mcp_servers:[ \t]*$/m.test(yaml) || /^mcp_servers:[ \t]*\n/m.test(yaml)) {
    return yaml.replace(/^(mcp_servers:[ \t]*)\n/m, `$1\n${block}`);
  }
  const prefix = yaml.endsWith("\n") || yaml.length === 0 ? yaml : `${yaml}\n`;
  return `${prefix}mcp_servers:\n${block}`;
}

export function shouldSeedSoul(existing: string | null): boolean {
  return existing === null || existing.trim() === "";
}

export function nextFreePort(taken: Set<number>, start: number): number {
  let port = start;
  const limit = start + 100;
  while (port <= limit) {
    if (!taken.has(port) && !RESERVED.has(port)) return port;
    port += 1;
  }
  let fallback = start + 100;
  while (RESERVED.has(fallback) || taken.has(fallback)) fallback += 1;
  return fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
