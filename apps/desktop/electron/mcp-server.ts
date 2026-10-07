// KAR-70 Task 6: the Electron-facing door manager.
//
// Both listeners live in `pairing-door.ts`; this module owns the app-level
// state around them — which vault is open, where the secrets live in userData,
// and what Settings is told when one of the two doors cannot bind.
//
// Opening a vault binds both doors to it. Opening a *second* vault while the
// first is still open rebinds them rather than keeping the first vault's root:
// a door serves one vault, the one that is open.
import path from "node:path";
import { app } from "electron";
import {
  startPairingDoors,
  LOCAL_MCP_PORT,
  INVITE_MCP_PORT,
} from "./pairing-door.ts";
import type { Result } from "@lifequest/vault-core";

const MCP_HOST = "127.0.0.1";

type Doors = Awaited<ReturnType<typeof startPairingDoors>>;

let doors: Doors | null = null;
let openVaultId: string | null = null;
/**
 * KAR-70: the desktop's in-memory lens, handed to the doors. Held here
 * rather than read per request from userData, so a lens change lands
 * on the next call with no vault write.
 */
let currentLens: () => string | null = () => null;

/** The two urls and their per-door errors, as Settings reads them. */
export type McpDoors = {
  localUrl: string;
  inviteUrl: string;
  localError: string | null;
  inviteError: string | null;
};

function localUrl(): string {
  return `http://${MCP_HOST}:${LOCAL_MCP_PORT}/mcp`;
}

function inviteUrl(): string {
  return `http://${MCP_HOST}:${INVITE_MCP_PORT}/mcp`;
}

function secretsDir(): string {
  return path.join(app.getPath("userData"), "pairing-secrets");
}

/**
 * KAR-70: where the pairing secrets live — app userData beside the other app
 * secrets, never inside a vault. A vault can be copied or synced, and a copied
 * vault must not carry the companion's credential with it.
 */
export function getPairingSecretsDir(): string {
  return secretsDir();
}

export function getMcpDoors(): McpDoors {
  if (!doors) {
    // No vault open: no door, and no error to report — there is nothing to try.
    return { localUrl: "", inviteUrl: "", localError: null, inviteError: null };
  }
  return {
    // A door that failed to bind shows no url; its error explains why.
    localUrl: doors.localError ? "" : localUrl(),
    inviteUrl: doors.inviteError ? "" : inviteUrl(),
    localError: doors.localError,
    inviteError: doors.inviteError,
  };
}

export function getMcpError(): string | null {
  const d = getMcpDoors();
  return d.localError ?? d.inviteError;
}

/**
 * The local door's url, for existing callers that expect a single string. It is
 * empty when the local door failed to bind or no vault is open.
 */
export function getMcpUrl(): string {
  return getMcpDoors().localUrl;
}

/**
 * Open (or rebind) the doors for this vault. The lens argument is gone: the
 * doors resolve the lens themselves, and a connected agent's view is its grant
 * rather than whatever the desktop happens to be looking at.
 */
export async function startMcp(
  rootPath: string,
  vaultId: string,
  getLens: () => string | null = () => null,
): Promise<Result<McpDoors>> {
  currentLens = getLens;
  if (doors) {
    // Already listening. Rebind to the newly opened vault's root, roster, and
    // companion credential rather than serving the previous vault.
    doors.rebind(rootPath, vaultId);
    openVaultId = vaultId;
    return { ok: true, value: getMcpDoors() };
  }
  doors = await startPairingDoors({
    root: rootPath,
    vaultId,
    secretsDir: secretsDir(),
    lens: () => currentLens(),
  });
  openVaultId = vaultId;
  const value = getMcpDoors();
  // Neither door bound is a failure the caller should throw on: the vault is
  // open and the other door may be serving.
  return { ok: true, value };
}

export async function stopMcp(): Promise<void> {
  const current = doors;
  doors = null;
  openVaultId = null;
  if (current) await current.close();
}

/** The vault the doors are currently bound to, for tests and diagnostics. */
export function getMcpVaultId(): string | null {
  return openVaultId;
}