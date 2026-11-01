// Where a built-in companion's endpoint and credential live.
//
// The rule is LAWS/SECRETS.md: the key never enters the vault. So it lives in
// app userData, sealed by OS secure storage, in a file of its own — not in the
// prefs file, which is plain JSON, and not in `secrets.json`, which is keyed by
// vault. One companion, one endpoint, one key.
import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export type PiEndpointSettings = {
  /** OpenAI-compatible base URL, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** The model this endpoint should run; empty until configured. */
  model: string;
  /** What the picker calls this endpoint. */
  providerName: string;
};

export const PI_DEFAULTS: PiEndpointSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  providerName: "OpenAI-compatible",
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "pi-endpoint.json");
}

function keyPath(): string {
  return path.join(app.getPath("userData"), "pi-endpoint.key");
}

export async function readPiSettings(): Promise<PiEndpointSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PiEndpointSettings>;
    return {
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim()
          : PI_DEFAULTS.baseUrl,
      model: typeof parsed.model === "string" ? parsed.model.trim() : "",
      providerName:
        typeof parsed.providerName === "string" && parsed.providerName.trim()
          ? parsed.providerName.trim()
          : PI_DEFAULTS.providerName,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ...PI_DEFAULTS };
    throw e;
  }
}

export async function writePiSettings(
  next: PiEndpointSettings,
): Promise<PiEndpointSettings> {
  const clean: PiEndpointSettings = {
    baseUrl: next.baseUrl.trim() || PI_DEFAULTS.baseUrl,
    model: next.model.trim(),
    providerName: next.providerName.trim() || PI_DEFAULTS.providerName,
  };
  const file = settingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
  return clean;
}

/**
 * A key with nowhere safe to go.
 *
 * On a desktop with a keyring this never fills. On a headless bench (or a Linux
 * box with no libsecret) `safeStorage` reports no encryption, and the honest
 * answer is a session-only key rather than one written as plaintext beside the
 * prefs. The setup surface says "this session only" when it happens.
 */
let memoryKey: string | null = null;

export function piKeyIsPersisted(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export async function readPiKey(): Promise<string | null> {
  if (memoryKey) return memoryKey;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const b64 = await fs.readFile(keyPath(), "utf8");
    return safeStorage.decryptString(Buffer.from(b64.trim(), "base64")) || null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function hasPiKey(): Promise<boolean> {
  if (memoryKey) return true;
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    await fs.access(keyPath());
    return true;
  } catch {
    return false;
  }
}

export async function writePiKey(key: string): Promise<"persisted" | "session"> {
  const trimmed = key.trim();
  if (trimmed === "") {
    await clearPiKey();
    return "session";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    memoryKey = trimmed;
    return "session";
  }
  memoryKey = null;
  const file = keyPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const sealed = safeStorage.encryptString(trimmed).toString("base64");
  await fs.writeFile(tmp, `${sealed}\n`, "utf8");
  await fs.rename(tmp, file);
  return "persisted";
}

export async function clearPiKey(): Promise<void> {
  memoryKey = null;
  try {
    await fs.rm(keyPath(), { force: true });
  } catch {
    // Already gone is the outcome the caller wanted.
  }
}

/** True for a loopback endpoint, which may legitimately run without a key. */
export function isLoopbackEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}
