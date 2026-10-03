// KAR-70: the secrets half of pairing. This file lives in app userData, never
// in the vault. It holds the companion token, the SHA-256 hex of each
// connected-agent bearer (never the raw bearer), and the invite-code hashes
// with their expiry and used-at stamps.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Result } from "@lifequest/vault-core";

/** KAR-70: an invite code is 128 bits, shown once, single-use, 24h to live. */
const INVITE_BYTES = 16;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type InviteRecord = {
  id: string;
  codeHash: string;
  expiresAt: string;
  usedAt: string | null;
};

export type PairingVaultSecrets = {
  companionToken: string | null;
  /** fingerprint (12 hex) → SHA-256 hex of the bearer. Never the raw bearer. */
  bearers: Record<string, string>;
  invites: InviteRecord[];
};

export type PairingSecretsFile = {
  vaults: Record<string, PairingVaultSecrets>;
};

function secretsPath(secretsDir: string): string {
  return path.join(secretsDir, "connected-agent-secrets.json");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function emptyVaultSecrets(): PairingVaultSecrets {
  return { companionToken: null, bearers: {}, invites: [] };
}

function normalizeVault(raw: unknown): PairingVaultSecrets {
  const v = (raw ?? {}) as Partial<PairingVaultSecrets>;
  const bearers: Record<string, string> = {};
  if (v.bearers && typeof v.bearers === "object") {
    for (const [key, value] of Object.entries(v.bearers)) {
      if (typeof value === "string") bearers[key] = value;
    }
  }
  const invites: InviteRecord[] = Array.isArray(v.invites)
    ? v.invites
        .filter((i): i is InviteRecord => !!i && typeof i === "object" && typeof i.codeHash === "string")
        .map((i) => ({
          id: String(i.id ?? randomUUID()),
          codeHash: i.codeHash,
          expiresAt: String(i.expiresAt ?? new Date(0).toISOString()),
          usedAt: typeof i.usedAt === "string" ? i.usedAt : null,
        }))
    : [];
  return {
    companionToken: typeof v.companionToken === "string" ? v.companionToken : null,
    bearers,
    invites,
  };
}

async function readSecretsFile(secretsDir: string): Promise<PairingSecretsFile> {
  try {
    const raw = await fs.readFile(secretsPath(secretsDir), "utf8");
    const parsed = JSON.parse(raw) as { vaults?: Record<string, unknown> };
    const vaults: Record<string, PairingVaultSecrets> = {};
    if (parsed.vaults && typeof parsed.vaults === "object") {
      for (const [id, value] of Object.entries(parsed.vaults)) {
        vaults[id] = normalizeVault(value);
      }
    }
    return { vaults };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { vaults: {} };
    throw e;
  }
}

async function writeSecretsFile(
  secretsDir: string,
  data: PairingSecretsFile,
): Promise<void> {
  await fs.mkdir(secretsDir, { recursive: true });
  const file = secretsPath(secretsDir);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

async function loadVaultSecrets(
  secretsDir: string,
  vaultId: string,
): Promise<{ file: PairingSecretsFile; vault: PairingVaultSecrets }> {
  const file = await readSecretsFile(secretsDir);
  const vault = file.vaults[vaultId] ?? emptyVaultSecrets();
  file.vaults[vaultId] = vault;
  return { file, vault };
}

// ── companion token ──────────────────────────────────────────────────────────

/** The companion token, minted once per vault. base64url of 32 random bytes. */
export async function ensureCompanionToken(
  secretsDir: string,
  vaultId: string,
): Promise<Result<string>> {
  try {
    const { file, vault } = await loadVaultSecrets(secretsDir, vaultId);
    if (vault.companionToken) return { ok: true, value: vault.companionToken };
    vault.companionToken = randomBytes(32).toString("base64url");
    await writeSecretsFile(secretsDir, file);
    return { ok: true, value: vault.companionToken };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function companionTokenOf(
  secretsDir: string,
  vaultId: string,
): Promise<string | null> {
  try {
    const { vault } = await loadVaultSecrets(secretsDir, vaultId);
    return vault.companionToken;
  } catch {
    return null;
  }
}

// ── bearers ──────────────────────────────────────────────────────────────────

/** Remember the hash of an accepted bearer. The raw bearer is never stored. */
export async function rememberBearer(
  secretsDir: string,
  vaultId: string,
  fingerprint: string,
  bearer: string,
): Promise<Result<true>> {
  try {
    const { file, vault } = await loadVaultSecrets(secretsDir, vaultId);
    vault.bearers[fingerprint] = sha256Hex(bearer);
    await writeSecretsFile(secretsDir, file);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resolve a presented bearer to its 12-hex fingerprint, or null when this
 * vault has never seen it. Comparison is over hashes: the raw bearer is
 * compared in memory only.
 */
export async function resolveBearer(
  secretsDir: string,
  vaultId: string,
  bearer: string,
): Promise<string | null> {
  try {
    const { vault } = await loadVaultSecrets(secretsDir, vaultId);
    const hash = sha256Hex(bearer);
    for (const [fingerprint, stored] of Object.entries(vault.bearers)) {
      if (stored === hash) return fingerprint;
    }
    return null;
  } catch {
    return null;
  }
}

// ── invite codes ─────────────────────────────────────────────────────────────

/**
 * Mint a 128-bit invite code and return the raw code once. Only the hash is
 * stored, with an expiry 24 hours ahead.
 */
export async function mintInvite(
  secretsDir: string,
  vaultId: string,
  now: () => Date = () => new Date(),
): Promise<Result<{ code: string; id: string; expiresAt: string }>> {
  try {
    const { file, vault } = await loadVaultSecrets(secretsDir, vaultId);
    const code = randomBytes(INVITE_BYTES).toString("base64url");
    const record: InviteRecord = {
      id: randomUUID(),
      codeHash: sha256Hex(code),
      expiresAt: new Date(now().getTime() + INVITE_TTL_MS).toISOString(),
      usedAt: null,
    };
    vault.invites.push(record);
    await writeSecretsFile(secretsDir, file);
    return { ok: true, value: { code, id: record.id, expiresAt: record.expiresAt } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Drop an unused code. Returns false when it is unknown or already used. */
export async function dropInvite(
  secretsDir: string,
  vaultId: string,
  id: string,
): Promise<Result<boolean>> {
  try {
    const { file, vault } = await loadVaultSecrets(secretsDir, vaultId);
    const idx = vault.invites.findIndex((i) => i.id === id);
    if (idx === -1 || vault.invites[idx]!.usedAt !== null) {
      return { ok: true, value: false };
    }
    vault.invites.splice(idx, 1);
    await writeSecretsFile(secretsDir, file);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Whether a code is currently usable, without consuming it. Used so that a
 * missing name or a full pairing list leaves the code unspent.
 */
export async function checkInvite(
  secretsDir: string,
  vaultId: string,
  code: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    const { vault } = await loadVaultSecrets(secretsDir, vaultId);
    const hash = sha256Hex(code);
    const at = now().getTime();
    return vault.invites.some(
      (i) => i.codeHash === hash && i.usedAt === null && Date.parse(i.expiresAt) > at,
    );
  } catch {
    return false;
  }
}

/**
 * Consume a code. Returns true only when the hash matches, the code is unused,
 * and it has not expired; a failed take writes nothing.
 */
export async function takeInvite(
  secretsDir: string,
  vaultId: string,
  code: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    const { file, vault } = await loadVaultSecrets(secretsDir, vaultId);
    const hash = sha256Hex(code);
    const at = now().getTime();
    const match = vault.invites.find((i) => i.codeHash === hash);
    if (!match || match.usedAt !== null || Date.parse(match.expiresAt) <= at) {
      return false;
    }
    match.usedAt = new Date(at).toISOString();
    await writeSecretsFile(secretsDir, file);
    return true;
  } catch {
    return false;
  }
}