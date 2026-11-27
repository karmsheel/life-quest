import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@lifequest/vault-core";

/**
 * DOOR-02 / SUPP-05: this file holds OS-encrypted secrets, but on Linux without
 * a keyring `safeStorage` resolves to the `basic_text` backend, which is not
 * encryption at all. The file is therefore private to the operator's user by
 * mode, and a plaintext-backend warning is emitted once.
 */
const SECRET_FILE_MODE = 0o600;
const SECRET_DIR_MODE = 0o700;

let warnedPlaintextBackend = false;

/**
 * Linux without a keyring (GNOME Keyring/KWallet) makes Electron fall back to
 * `basic_text`: `isEncryptionAvailable()` is true, but the bytes are plain
 * base64. There is no better store available, so the app still works — but it
 * must not do so silently. Warn once per process, before the first encrypt or
 * decrypt.
 */
function warnIfSafeStorageIsPlaintext(): void {
  if (warnedPlaintextBackend) return;
  warnedPlaintextBackend = true;
  if (process.platform !== "linux") return;
  try {
    const backend = safeStorage.getSelectedStorageBackend?.();
    if (backend === "basic_text") {
      console.warn(
        "[secrets] OS keyring is unavailable; Electron safeStorage is using the " +
          "plaintext basic_text backend. Secrets in secrets.json are protected by " +
          "file permissions only. Install/unlock a keyring (gnome-keyring, kwallet) " +
          "to encrypt them.",
      );
    }
  } catch {
    /* An older Electron without the backend probe: nothing to decide. */
  }
}

async function bestEffortChmod(target: string, mode: number): Promise<void> {
  // Windows has no POSIX mode (chmod only toggles the read-only bit), and the
  // per-user ACL already protects the directory there.
  if (process.platform === "win32") return;
  try {
    await fs.chmod(target, mode);
  } catch {
    /* The caller's read/write surfaces a real failure. */
  }
}

/** The userData dir must be 0700; correct an existing one on the read path too. */
async function ensureUserDataDir(file: string): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: SECRET_DIR_MODE });
  try {
    const st = await fs.stat(dir);
    if (st.isDirectory() && (st.mode & 0o777) !== SECRET_DIR_MODE) {
      await bestEffortChmod(dir, SECRET_DIR_MODE);
    }
  } catch {
    /* mkdir succeeded; the following write reports anything that matters. */
  }
}

async function hardenExistingFile(file: string): Promise<void> {
  try {
    const st = await fs.stat(file);
    if (st.isFile() && (st.mode & 0o777) !== SECRET_FILE_MODE) {
      await bestEffortChmod(file, SECRET_FILE_MODE);
    }
  } catch {
    /* No file yet: the first write creates it 0600. */
  }
}

/** vaultId → base64(encrypted) Hermes API key */
type SecretsFile = {
  hermesKeys: Record<string, string>;
  adapterSecrets: Record<string, string>;
};

function secretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.json");
}

async function loadSecrets(): Promise<SecretsFile> {
  try {
    const file = secretsPath();
    const raw = await fs.readFile(file, "utf8");
    // DOOR-02: repair a file/dir left behind with umask-derived modes.
    await hardenExistingFile(file);
    await ensureUserDataDir(file);
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
  await ensureUserDataDir(file);
  const tmp = `${file}.tmp`;
  // Mode on the temp file so the rename publishes it already 0600; the chmod
  // after the rename also repairs an inode that predates this rule.
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: SECRET_FILE_MODE,
  });
  await fs.rename(tmp, file);
  await bestEffortChmod(file, SECRET_FILE_MODE);
}

function encryptString(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable; cannot persist Hermes API key",
    );
  }
  warnIfSafeStorageIsPlaintext();
  const buf = safeStorage.encryptString(plain);
  return buf.toString("base64");
}

function decryptString(b64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable; cannot read Hermes API key",
    );
  }
  warnIfSafeStorageIsPlaintext();
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
