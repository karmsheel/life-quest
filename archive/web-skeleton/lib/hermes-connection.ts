import fs from "fs/promises";
import os from "os";
import path from "path";

export const DEFAULT_HERMES_HOST = "127.0.0.1";
export const DEFAULT_HERMES_PORT = 8642;

export type HermesConnectionKind =
  | "reachable"
  | "auth_failed"
  | "not_running"
  | "timeout"
  | "misconfigured";

export interface HermesEnvConfig {
  apiServerEnabled?: boolean;
  apiServerKey?: string;
  apiServerHost?: string;
  apiServerPort?: number;
  apiServerCorsOrigins?: string;
}

export interface HermesProbeResult {
  ok: boolean;
  baseUrl: string;
  latencyMs: number;
  model?: string;
  features?: string[];
  error?: string;
  kind?: HermesConnectionKind;
}

export function getHermesHomeDir(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

/**
 * Parse a .env file's KEY=VALUE lines for API_SERVER_* settings.
 * Mirrors how Hermes' own env_loader reads ~/.hermes/.env.
 */
export function parseHermesEnv(content: string): HermesEnvConfig {
  const result: HermesEnvConfig = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip "export " prefix (bash-compatible, like Hermes does)
    if (key.startsWith("export ")) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case "API_SERVER_ENABLED":
        result.apiServerEnabled = value.toLowerCase() === "true";
        break;
      case "API_SERVER_KEY":
        result.apiServerKey = value;
        break;
      case "API_SERVER_HOST":
        result.apiServerHost = value;
        break;
      case "API_SERVER_PORT": {
        const port = Number.parseInt(value, 10);
        if (Number.isFinite(port)) result.apiServerPort = port;
        break;
      }
      case "API_SERVER_CORS_ORIGINS":
        result.apiServerCorsOrigins = value;
        break;
    }
  }

  return result;
}

/**
 * Read config.yaml and extract top-level API_SERVER_* scalar keys.
 *
 * Hermes' gateway (gateway/run.py:1431-1434) has a bridge that iterates all
 * top-level scalar keys in config.yaml and sets them as os.environ fallbacks.
 * This means API_SERVER_KEY can live in config.yaml (not just .env) and the
 * gateway will still pick it up. We mirror that here.
 *
 * Also reads platforms.api_server.extra for host/port/key (the structured
 * config.yaml location), which takes precedence over top-level keys.
 */
export function parseHermesConfigYaml(content: string): HermesEnvConfig {
  const result: HermesEnvConfig = {};

  // Lightweight YAML parse for the keys we care about. We avoid a full YAML
  // dependency by doing targeted extraction — these values are always simple
  // scalars at the top level or under platforms.api_server.extra.
  const lines = content.split("\n");

  // Pass 1: top-level API_SERVER_* keys
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^API_SERVER_(ENABLED|KEY|HOST|PORT|CORS_ORIGINS)\s*:\s*(.*)$/,
    );
    if (!match) continue;

    const [, kind, rawValue] = match;
    let value = rawValue.trim();

    // Strip YAML quoting
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (kind) {
      case "ENABLED":
        result.apiServerEnabled =
          value.toLowerCase() === "true" || value === "yes" || value === "1";
        break;
      case "KEY":
        result.apiServerKey = value;
        break;
      case "HOST":
        result.apiServerHost = value;
        break;
      case "PORT": {
        const port = Number.parseInt(value, 10);
        if (Number.isFinite(port)) result.apiServerPort = port;
        break;
      }
      case "CORS_ORIGINS":
        result.apiServerCorsOrigins = value;
        break;
    }
  }

  // Pass 2: platforms.api_server.extra (structured config)
  // Look for the `platforms:` → `api_server:` → `extra:` section
  let inPlatforms = false;
  let inApiServer = false;
  let inExtra = false;
  let platformsIndent = -1;
  let apiServerIndent = -1;
  let extraIndent = -1;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.search(/\S/);

    // Track nesting
    if (/^platforms:\s*$/.test(line.trim())) {
      inPlatforms = true;
      platformsIndent = indent;
      continue;
    }
    if (inPlatforms && indent <= platformsIndent) {
      inPlatforms = false;
      inApiServer = false;
      inExtra = false;
    }

    if (inPlatforms && /^api_server:\s*$/.test(line.trim())) {
      inApiServer = true;
      apiServerIndent = indent;
      continue;
    }
    if (inApiServer && indent <= apiServerIndent && line.trim() !== "extra:") {
      inApiServer = false;
      inExtra = false;
    }

    if (inApiServer && /^extra:\s*$/.test(line.trim())) {
      inExtra = true;
      extraIndent = indent;
      continue;
    }
    if (inExtra && indent <= extraIndent) {
      inExtra = false;
    }

    if (inExtra) {
      const kvMatch = line.trim().match(
        /^(host|port|key|cors_origins|enabled)\s*:\s*(.*)$/,
      );
      if (kvMatch) {
        const [, k, rawVal] = kvMatch;
        let val = rawVal.trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (k === "host") result.apiServerHost = val;
        else if (k === "port") {
          const p = Number.parseInt(val, 10);
          if (Number.isFinite(p)) result.apiServerPort = p;
        } else if (k === "key") result.apiServerKey = val;
        else if (k === "cors_origins") result.apiServerCorsOrigins = val;
        else if (k === "enabled") result.apiServerEnabled = val === "true";
      }
    }
  }

  return result;
}

/**
 * Merge two HermesEnvConfig objects. Values in `override` win over `base`.
 */
function mergeConfig(
  base: HermesEnvConfig,
  override: HermesEnvConfig,
): HermesEnvConfig {
  return {
    apiServerEnabled: override.apiServerEnabled ?? base.apiServerEnabled,
    apiServerKey: override.apiServerKey || base.apiServerKey,
    apiServerHost: override.apiServerHost || base.apiServerHost,
    apiServerPort: override.apiServerPort ?? base.apiServerPort,
    apiServerCorsOrigins:
      override.apiServerCorsOrigins || base.apiServerCorsOrigins,
  };
}

export async function readHermesEnvFile(): Promise<HermesEnvConfig | null> {
  const home = getHermesHomeDir();
  let config: HermesEnvConfig = {};

  // Source 1: config.yaml — Hermes' gateway bridges top-level scalar keys
  // into os.environ, and platforms.api_server.extra holds the structured form.
  // This is the primary source on most installs.
  try {
    const yamlPath = path.join(home, "config.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    const yamlConfig = parseHermesConfigYaml(yamlContent);
    config = mergeConfig(config, yamlConfig);
  } catch {
    // config.yaml may not exist on fresh installs
  }

  // Source 2: .env — user secrets. .env overrides config.yaml for keys it
  // actually defines (matching Hermes' own precedence: env > config.yaml).
  try {
    const envPath = path.join(home, ".env");
    const envContent = await fs.readFile(envPath, "utf-8");
    const envConfig = parseHermesEnv(envContent);
    config = mergeConfig(config, envConfig);
  } catch {
    // .env may not exist
  }

  // Source 3: process.env — highest precedence (shell exports, HERMES_HOME, etc.)
  if (process.env.API_SERVER_KEY) config.apiServerKey = process.env.API_SERVER_KEY;
  if (process.env.API_SERVER_HOST) config.apiServerHost = process.env.API_SERVER_HOST;
  if (process.env.API_SERVER_PORT) {
    const port = Number.parseInt(process.env.API_SERVER_PORT, 10);
    if (Number.isFinite(port)) config.apiServerPort = port;
  }
  if (process.env.API_SERVER_ENABLED) {
    config.apiServerEnabled =
      process.env.API_SERVER_ENABLED.toLowerCase() === "true";
  }
  if (process.env.API_SERVER_CORS_ORIGINS) {
    config.apiServerCorsOrigins = process.env.API_SERVER_CORS_ORIGINS;
  }

  // If nothing was found at all, return null (caller shows "not configured")
  const hasAny =
    config.apiServerKey !== undefined ||
    config.apiServerEnabled !== undefined ||
    config.apiServerHost !== undefined ||
    config.apiServerPort !== undefined;

  return hasAny ? config : null;
}

export function buildCandidateUrls(env?: HermesEnvConfig | null): string[] {
  const host = env?.apiServerHost || DEFAULT_HERMES_HOST;
  const port = env?.apiServerPort || DEFAULT_HERMES_PORT;
  const urls = new Set<string>();

  urls.add(`http://${host}:${port}`);
  urls.add(`http://127.0.0.1:${port}`);
  urls.add(`http://localhost:${port}`);

  return [...urls];
}

export async function probeHermesConnection(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 6000,
): Promise<HermesProbeResult> {
  const start = Date.now();
  const normalized = baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const healthRes = await fetch(`${normalized}/health`, {
      signal: controller.signal,
    });

    if (!healthRes.ok) {
      clearTimeout(timer);
      return {
        ok: false,
        baseUrl: normalized,
        latencyMs: Date.now() - start,
        kind: "not_running",
        error: `Hermes returned ${healthRes.status}. Is the gateway running?`,
      };
    }
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      baseUrl: normalized,
      latencyMs: Date.now() - start,
      kind: aborted ? "timeout" : "not_running",
      error: aborted
        ? "Connection timed out. Is Hermes gateway running?"
        : "Could not reach Hermes. Run `hermes gateway` in your terminal.",
    };
  }

  try {
    const capRes = await fetch(`${normalized}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;

    if (capRes.status === 401 || capRes.status === 403) {
      return {
        ok: false,
        baseUrl: normalized,
        latencyMs,
        kind: "auth_failed",
        error:
          "Invalid API key. Check API_SERVER_KEY in ~/.hermes/config.yaml or ~/.hermes/.env",
      };
    }

    if (!capRes.ok) {
      return {
        ok: false,
        baseUrl: normalized,
        latencyMs,
        kind: "misconfigured",
        error: `Capabilities check failed (${capRes.status})`,
      };
    }

    const data = (await capRes.json()) as {
      model?: string;
      features?: Record<string, boolean>;
    };

    const features = data.features
      ? Object.entries(data.features)
          .filter(([, enabled]) => enabled === true)
          .map(([name]) => name)
      : [];

    return {
      ok: true,
      baseUrl: normalized,
      latencyMs,
      model: data.model,
      features,
      kind: "reachable",
    };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      baseUrl: normalized,
      latencyMs: Date.now() - start,
      kind: aborted ? "timeout" : "not_running",
      error: aborted
        ? "Connection timed out while verifying credentials."
        : err instanceof Error
          ? err.message
          : "Probe failed",
    };
  }
}

export async function discoverHermes(): Promise<{
  env: HermesEnvConfig | null;
  envPath: string;
  candidates: string[];
  result: HermesProbeResult;
}> {
  const env = await readHermesEnvFile();
  const envPath = path.join(getHermesHomeDir(), ".env");
  const candidates = buildCandidateUrls(env);

  if (env?.apiServerEnabled === false) {
    return {
      env,
      envPath,
      candidates,
      result: {
        ok: false,
        baseUrl: candidates[0],
        latencyMs: 0,
        kind: "misconfigured",
        error:
          "API server is disabled. Set API_SERVER_ENABLED=true in ~/.hermes/config.yaml or ~/.hermes/.env",
      },
    };
  }

  const apiKey = env?.apiServerKey;
  if (!apiKey) {
    return {
      env,
      envPath,
      candidates,
      result: {
        ok: false,
        baseUrl: candidates[0],
        latencyMs: 0,
        kind: "misconfigured",
        error:
          "No API_SERVER_KEY found. Check ~/.hermes/config.yaml (top-level key or platforms.api_server.extra.key) or ~/.hermes/.env",
      },
    };
  }

  let lastResult: HermesProbeResult = {
    ok: false,
    baseUrl: candidates[0],
    latencyMs: 0,
    kind: "not_running",
    error: "Could not connect to Hermes on any known address.",
  };

  for (const baseUrl of candidates) {
    const result = await probeHermesConnection(baseUrl, apiKey);
    lastResult = result;
    if (result.ok) {
      return { env, envPath, candidates, result };
    }
  }

  return { env, envPath, candidates, result: lastResult };
}
