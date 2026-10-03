// KAR-70: the secrets half of pairing. This file lives in app userData, never
// in the vault. It holds the companion token, the SHA-256 hex of each
// connected-agent bearer (never the raw bearer), and the invite-code hashes
// with their expiry and used-at stamps.
//
// Every read-modify-write goes through withSecretsLock. The file is read,
// mutated, and renamed as one unit, so an unlocked update lets two callers
// write stale snapshots over each other — which could make a spent invite code
// valid again, or forget a rejected bearer's hash so that key can introduce
// itself twice. withSecretsLock hands the caller a session bound to one
// already-read file, so a whole read-modify-write happens inside one chain.
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

/**
 * A held view of one secrets file. Each method mutates the snapshot the lock
 * already read; the lock writes it back once when the work finishes. Obtain
 * one only from withSecretsLock.
 */
export type SecretsSession = {
  secretsDir: string;
  vaultId: string;
  vault: PairingVaultSecrets;
  companionToken: () => string | null;
  /** The 12-hex fingerprint for a bearer this vault knows, else null. */
  resolveBearer: (bearer: string) => string | null;
  /** Whether a code is currently spendable. Does not consume it. */
  hasInvite: (code: string, at: number) => boolean;
  rememberBearer: (fingerprint: string, bearer: string) => void;
  /** Consumes the code. False when it is used, expired, or unknown. */
  takeInvite: (code: string, at: number) => boolean;
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
        .filter(
          (i): i is InviteRecord =>
            !!i && typeof i === "object" && typeof (i as InviteRecord).codeHash === "string",
        )
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

function fingerprintForHash(vault: PairingVaultSecrets, hash: string): string | null {
  for (const [fingerprint, stored] of Object.entries(vault.bearers)) {
    if (stored === hash) return fingerprint;
  }
  return null;
}

/**
 * KAR-70: one chain per secrets file. The invite door holds this lock across
 * its whole introduction, so a code cannot be checked by two callers and spent
 * by both.
 */
const locks = new Map<string, Promise<unknown>>();

export function withSecretsLock<T>(
  secretsDir: string,
  vaultId: string,
  work: (session: SecretsSession) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const file = await readSecretsFile(secretsDir);
    const vault = file.vaults[vaultId] ?? emptyVaultSecrets();
    file.vaults[vaultId] = vault;
    const session: SecretsSession = {
      secretsDir,
      vaultId,
      vault,
      companionToken: () => vault.companionToken,
      resolveBearer: (bearer: string) => fingerprintForHash(vault, sha256Hex(bearer)),
      hasInvite: (code: string, at: number) => {
        const hash = sha256Hex(code);
        return vault.invites.some(
          (i) => i.codeHash === hash && i.usedAt === null && Date.parse(i.expiresAt) > at,
        );
      },
      rememberBearer: (fingerprint: string, bearer: string) => {
        vault.bearers[fingerprint] = sha256Hex(bearer);
      },
      takeInvite: (code: string, at: number) => {
        const hash = sha256Hex(code);
        const match = vault.invites.find((i) => i.codeHash === hash);
        if (!match || match.usedAt !== null || Date.parse(match.expiresAt) <= at) return false;
        match.usedAt = new Date(at).toISOString();
        return true;
      },
    };
    try {
      return await work(session);
    } finally {
      // Written even when the work threw: a partial mutation must not be
      // silently dropped, and rewriting an unchanged snapshot is harmless.
      await writeSecretsFile(secretsDir, file);
    }
  };

  const prior = locks.get(secretsPath(secretsDir)) ?? Promise.resolve();
  const next = prior.then(run, run);
  locks.set(
    secretsPath(secretsDir),
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** A read that needs no lock: it takes no write, so it cannot race a mutation. */
export async function peekSecrets(
  secretsDir: string,
  vaultId: string,
): Promise<PairingVaultSecrets> {
  const file = await readSecretsFile(secretsDir);
  return file.vaults[vaultId] ?? emptyVaultSecrets();
}

// ── companion token ──────────────────────────────────────────────────────────

/**
 * KAR-70: the companion token, minted once per vault — base64url of 32 random
 * bytes — and stored in app userData, never in the vault. The generation is
 * inside the secrets lock and guarded on the stored value, so two callers that
 * race on a fresh vault still end up with the same token: a rotated token would
 * lock the running companion out of both doors.
 *
 * Throws when the secrets file cannot be read or written. There is no safe
 * fallback: a door that cannot recognise the companion would file a pairing
 * Decision for Hermes on its next call, which is worse than failing loudly.
 */
export async function ensureCompanionToken(
  secretsDir: string,
  vaultId: string,
): Promise<string> {
  return withSecretsLock(secretsDir, vaultId, async (s) => {
    if (!s.vault.companionToken) {
      s.vault.companionToken = randomBytes(32).toString("base64url");
    }
    return s.vault.companionToken;
  });
}

/**
 * The stored companion token for this vault, or null when none was minted yet.
 * A read that needs no lock, so it never races a mint. The door calls this on
 * every request; the token is compared in memory and is never logged.
 */
export async function companionBearer(
  secretsDir: string,
  vaultId: string,
): Promise<string | null> {
  try {
    return (await peekSecrets(secretsDir, vaultId)).companionToken;
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
    await withSecretsLock(secretsDir, vaultId, async (s) => {
      s.rememberBearer(fingerprint, bearer);
      return true;
    });
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
    return fingerprintForHash(await peekSecrets(secretsDir, vaultId), sha256Hex(bearer));
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
    const value = await withSecretsLock(secretsDir, vaultId, async (s) => {
      const code = randomBytes(INVITE_BYTES).toString("base64url");
      const record: InviteRecord = {
        id: randomUUID(),
        codeHash: sha256Hex(code),
        expiresAt: new Date(now().getTime() + INVITE_TTL_MS).toISOString(),
        usedAt: null,
      };
      s.vault.invites.push(record);
      return { code, id: record.id, expiresAt: record.expiresAt };
    });
    return { ok: true, value };
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
    const value = await withSecretsLock(secretsDir, vaultId, async (s) => {
      const idx = s.vault.invites.findIndex((i) => i.id === id);
      if (idx === -1 || s.vault.invites[idx]!.usedAt !== null) return false;
      s.vault.invites.splice(idx, 1);
      return true;
    });
    return { ok: true, value };
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
    const vault = await peekSecrets(secretsDir, vaultId);
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
 * and it has not expired; a failed take leaves the code unchanged.
 */
export async function takeInvite(
  secretsDir: string,
  vaultId: string,
  code: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    return await withSecretsLock(secretsDir, vaultId, async (s) =>
      s.takeInvite(code, now().getTime()),
    );
  } catch {
    return false;
  }
}