import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  DEFAULT_HERMES_HOST,
  DEFAULT_HERMES_PORT,
  discoverHermes,
  getHermesHomeDir,
  readHermesEnvFile,
} from "./hermes-connection.ts";

export interface HermesSetupResult {
  ok: boolean;
  envPath: string;
  changes: string[];
  apiKeyGenerated: boolean;
  needsGatewayRestart: boolean;
  gatewayReachable: boolean;
  error?: string;
}

function generateApiServerKey(): string {
  return `lifequest-${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Upsert KEY=VALUE lines in a .env file, preserving comments and unrelated keys.
 * Mirrors the browser extension / Hermes docs pattern of writing ~/.hermes/.env.
 */
export function upsertEnvLines(
  content: string,
  updates: Record<string, string>,
): { next: string; changes: string[] } {
  const changes: string[] = [];
  const lines = content.length ? content.split("\n") : [];
  const touched = new Set<string>();

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;

    const key = trimmed.slice(0, eq).trim();
    if (!(key in updates)) return line;

    const value = updates[key];
    if (value === undefined) return line;

    const indent = line.slice(0, line.search(/\S/));
    const previous = trimmed.slice(eq + 1).trim();
    if (previous !== value) {
      changes.push(`${key}=${key === "API_SERVER_KEY" ? "[updated]" : value}`);
    }
    touched.add(key);
    return `${indent}${key}=${value}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (touched.has(key) || value === undefined) continue;
    nextLines.push(`${key}=${value}`);
    changes.push(`${key}=${key === "API_SERVER_KEY" ? "[set]" : value}`);
  }

  const next = nextLines.join("\n");
  return {
    next: next.endsWith("\n") || !next.length ? next : `${next}\n`,
    changes,
  };
}

export async function setupHermesApiServer(): Promise<HermesSetupResult> {
  const home = getHermesHomeDir();
  const envPath = path.join(home, ".env");

  try {
    await fs.mkdir(home, { recursive: true });

    let existing = "";
    try {
      existing = await fs.readFile(envPath, "utf-8");
    } catch {
      existing = "";
    }

    const current = (await readHermesEnvFile()) ?? {};
    const apiKeyGenerated = !current.apiServerKey;
    const apiKey = current.apiServerKey || generateApiServerKey();

    const { next, changes } = upsertEnvLines(existing, {
      API_SERVER_ENABLED: "true",
      API_SERVER_HOST: current.apiServerHost || DEFAULT_HERMES_HOST,
      API_SERVER_PORT: String(current.apiServerPort || DEFAULT_HERMES_PORT),
      API_SERVER_KEY: apiKey,
    });

    await fs.writeFile(envPath, next, "utf-8");

    const { result } = await discoverHermes();
    const gatewayReachable = result.ok;

    return {
      ok: true,
      envPath,
      changes,
      apiKeyGenerated,
      needsGatewayRestart: !gatewayReachable,
      gatewayReachable,
    };
  } catch (error) {
    return {
      ok: false,
      envPath,
      changes: [],
      apiKeyGenerated: false,
      needsGatewayRestart: true,
      gatewayReachable: false,
      error: error instanceof Error ? error.message : "Setup failed",
    };
  }
}

export { setupSummaryMessage } from "./hermes-setup-shared.ts";
