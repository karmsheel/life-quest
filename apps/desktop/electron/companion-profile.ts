import path from "node:path";

export const PROFILE_NAME = "lifequest";
/** Host multiplexer API port (Hermes default). 8643 is LifeQuest MCP; 8644 is the webhook adapter. */
export const DEFAULT_API_PORT = 8642;
export const RESERVED_PORTS = [8642, 8643, 8644] as const;
export const DISCOVERY_PORTS = [8642, 8644, 8645, 8650] as const;
export const MCP_URL = "http://127.0.0.1:8643/mcp";
export const COMPANION_SOUL = `You are the LifeQuest companion. Help the user set up and use LifeQuest: vaults, domains, Premise, Vision, Purpose, and Strategy (How), Life Map, Architecture, tasks, and the agent lock. Prefer LifeQuest MCP tools (lifequest) for map and task changes. If a tool returns LOCKED, tell the user the map is locked and do not retry writes. Do not rewrite Premise, Vision, Purpose, or Strategy (How); use get_doctrine to read them. Do not flip the agent lock. You also exist in Hermes Desktop and other channels on this same profile — stay consistent.
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

/** Host-multiplexer bases. Only `/p/lifequest` — a raw host URL is the default profile. */
export function attachCandidateBaseUrls(envPort: number | null): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const prefix = (port: number) => `http://127.0.0.1:${port}/p/${PROFILE_NAME}`;
  if (envPort && envPort > 0) add(prefix(envPort));
  for (const port of DISCOVERY_PORTS) add(prefix(port));
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

/**
 * KAR-70: write (or refresh) the `mcp_servers.<name>` entry.
 *
 * `headers` carries the companion's `Authorization`, so a profile written before
 * the door asked for a bearer stops being refused with AUTH_REQUIRED the moment
 * `ensure` runs again. When the entry already exists its `url` is updated and
 * `headers` are merged key by key — the other keys on that entry, and every
 * other `mcp_servers` entry, stay exactly as they were. Only its own
 * `Authorization` is ever replaced.
 *
 * A header value is written unquoted only when it is a plain YAML scalar: a
 * token or key that starts with a YAML indicator (`{`, `[`, `*`, `&`, `!`, `%`,
 * `@`, `` ` ``, `>`, `|`, `#`, `,`, `?`, `:` …) would otherwise be read as
 * structure. Such a value is single-quoted, which escapes both indicators and
 * any embedded `'`.
 */
export function ensureMcpServer(
  yaml: string,
  name: string,
  url: string,
  headers?: Record<string, string>,
): string {
  const headerEntries = Object.entries(headers ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const keyRe = new RegExp(`(^|\\n)([ \\t]+)${escapeRegExp(name)}:[ \\t]*\\n`, "m");
  const match = /mcp_servers:/m.test(yaml) ? keyRe.exec(yaml) : null;

  if (match && match.index !== undefined) {
    return mergeIntoEntry(yaml, match.index + match[1]!.length, name, url, headerEntries);
  }

  const lines = [`  ${name}:`, `    url: ${url}`];
    if (headerEntries.length > 0) {
      lines.push("    headers:");
      for (const [key, value] of headerEntries) {
        lines.push(`      ${key}: ${yamlScalar(value)}`);
      }
    }
  const block = `${lines.join("\n")}\n`;
  if (/^mcp_servers:[ \t]*$/m.test(yaml) || /^mcp_servers:[ \t]*\n/m.test(yaml)) {
    return yaml.replace(/^(mcp_servers:[ \t]*)\n/m, `$1\n${block}`);
  }
  const prefix = yaml.endsWith("\n") || yaml.length === 0 ? yaml : `${yaml}\n`;
  return `${prefix}mcp_servers:\n${block}`;
}

/** A single header line under an entry, at the entry's own indent. */
function headerLine(indent: string, key: string, value: string): string {
  return `${indent}  headers:\n${indent}    ${key}: ${yamlScalar(value)}`;
}

/**
 * Rewrite one existing entry in place. Its block runs from the entry key to the
 * next line at that key's indent or shallower, which is where the next sibling
 * `mcp_servers` entry — or the next top-level key — starts.
 */
function mergeIntoEntry(
  yaml: string,
  start: number,
  name: string,
  url: string,
  headerEntries: [string, string][],
): string {
  const lines = yaml.split("\n");
  const startLine = yaml.slice(0, start).split("\n").length - 1;
  const indent = /^([ \t]*)/.exec(lines[startLine] ?? "")?.[1] ?? "  ";
  let end = startLine + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "") {
      const own = /^([ \t]*)/.exec(line)?.[1] ?? "";
      if (own.length <= indent.length) break;
    }
    end += 1;
  }

  const body = lines.slice(startLine + 1, end);
  const rest: string[] = [];
  const headerIndent = `${indent}  `;
  let i = 0;
  while (i < body.length) {
    const line = body[i] ?? "";
    const own = /^([ \t]*)/.exec(line)?.[1] ?? "";
    if (/^url:/.test(line.trim()) && own.length === headerIndent.length) {
      rest.push(`${headerIndent}url: ${url}`);
      i += 1;
      continue;
    }
    if (/^headers:/.test(line.trim()) && own.length === headerIndent.length) {
      // Drop the old header block; the merge below rewrites it whole.
      i += 1;
      while (i < body.length) {
        const next = body[i] ?? "";
        const nextIndent = /^([ \t]*)/.exec(next)?.[1] ?? "";
        if (next.trim() !== "" && nextIndent.length <= headerIndent.length) break;
        i += 1;
      }
      continue;
    }
    rest.push(line);
    i += 1;
  }

  const rebuilt = [`${indent}${name}:`, `${headerIndent}url: ${url}`];
  for (const [key, value] of headerEntries) rebuilt.push(headerLine(indent, key, value));
  // Keep the entry's other keys after ours; a `headers:` block above them would
  // swallow them, so ours goes last.
  return [...lines.slice(0, startLine), ...rebuilt, ...rest, ...lines.slice(end)].join("\n");
}

/** Render a header value as a YAML scalar, quoted only when it has to be. */
function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/@=+-]*$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
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
