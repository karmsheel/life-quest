import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@lifequest/vault-core";

/** vaultId → base64(encrypted) Hermes API key */
type SecretsFile = {
  hermesKeys: Record<string, string>;
  adapterSecrets: Record<string, string>;
  /** One per installation, not per vault: the update feed is the same repo. */
  updateToken?: string;
};

function secretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.json");
}

async function loadSecrets(): Promise<SecretsFile> {
  try {
    const raw = await fs.readFile(secretsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SecretsFile>;
    return {
      hermesKeys:
        parsed.hermesKeys && typeof parsed.hermesKeys === "object"
          ? parsed.hermesKeys
          : {},
      adapterSecrets:
        parsed.adapterSecrets && typeof parsed.adapterSecrets === "object"
          ? parsed.adapterSecrets
          : {},
      // Carried through, not dropped: `saveSecrets` writes this whole object
      // back, so a field left out here is a field erased on the next save.
      ...(typeof parsed.updateToken === "string"
        ? { updateToken: parsed.updateToken }
        : {}),
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { hermesKeys: {}, adapterSecrets: {} };
    }
    throw e;
  }
}

async function saveSecrets(data: SecretsFile): Promise<void> {
  const file = secretsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

function encryptString(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable; cannot persist Hermes API key",
    );
  }
  const buf = safeStorage.encryptString(plain);
  return buf.toString("base64");
}

function decryptString(b64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable; cannot read Hermes API key",
    );
  }
  const buf = Buffer.from(b64, "base64");
  return safeStorage.decryptString(buf);
}

export async function hasHermesKey(vaultId: string): Promise<boolean> {
  const data = await loadSecrets();
  return Boolean(data.hermesKeys[vaultId]);
}

export async function setHermesKey(
  vaultId: string,
  key: string,
): Promise<Result<true>> {
  try {
    const trimmed = key.trim();
    if (!trimmed) {
      return { ok: false, error: "API key must not be empty" };
    }
    const data = await loadSecrets();
    data.hermesKeys[vaultId] = encryptString(trimmed);
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearHermesKey(vaultId: string): Promise<Result<true>> {
  try {
    const data = await loadSecrets();
    delete data.hermesKeys[vaultId];
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Returns decrypted key, or null if missing. Throws if decrypt fails. */
export async function getHermesKey(vaultId: string): Promise<string | null> {
  const data = await loadSecrets();
  const enc = data.hermesKeys[vaultId];
  if (!enc) return null;
  return decryptString(enc);
}

// KAR-59 adapter secrets
export async function hasAdapterSecret(bindingId: string): Promise<boolean> {
  const data = await loadSecrets();
  return Boolean(data.adapterSecrets[bindingId]);
}

export async function setAdapterSecret(
  bindingId: string,
  secret: string,
): Promise<Result<true>> {
  try {
    const trimmed = secret.trim();
    if (!trimmed) {
      return { ok: false, error: "Secret must not be empty" };
    }
    const data = await loadSecrets();
    data.adapterSecrets[bindingId] = encryptString(trimmed);
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearAdapterSecret(bindingId: string): Promise<Result<true>> {
  try {
    const data = await loadSecrets();
    delete data.adapterSecrets[bindingId];
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Returns decrypted adapter secret, or null if missing. */
export async function getAdapterSecret(bindingId: string): Promise<string | null> {
  const data = await loadSecrets();
  const enc = data.adapterSecrets[bindingId];
  if (!enc) return null;
  return decryptString(enc);
}

// —— the update feed's token ————————————————————————————————————————————————
/**
 * One token for the installation: the releases it reads belong to the app, not
 * to any vault, so switching vaults must not lose it. Encrypted with the same
 * OS secure storage the Hermes key uses, and never handed back to the renderer —
 * only `hasUpdateToken` crosses that line.
 */
export async function hasUpdateToken(): Promise<boolean> {
  const data = await loadSecrets();
  return Boolean(data.updateToken);
}

export async function setUpdateToken(token: string): Promise<Result<true>> {
  try {
    const trimmed = token.trim();
    if (!trimmed) {
      return { ok: false, error: "Token must not be empty" };
    }
    const data = await loadSecrets();
    data.updateToken = encryptString(trimmed);
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearUpdateToken(): Promise<Result<true>> {
  try {
    const data = await loadSecrets();
    delete data.updateToken;
    await saveSecrets(data);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Returns the decrypted token, or null if none is stored. */
export async function getUpdateToken(): Promise<string | null> {
  const data = await loadSecrets();
  const enc = data.updateToken;
  if (!enc) return null;
  return decryptString(enc);
}
