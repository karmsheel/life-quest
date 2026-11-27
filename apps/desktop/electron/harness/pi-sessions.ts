// Transcripts for the built-in companion.
//
// Hermes owns its sessions; a harness that lives in this process has to own
// its own. They live in app userData, never in the vault: VISION says chat
// transcripts stay with the harness and the vault stays the operator's life
// database. One JSON file per chat, written atomically, because the dock lets
// the operator delete and rename while a turn is running.
//
// A vault is nevertheless the profile that is loaded, so the files are grouped
// under the open vault's identity (`<userData>/pi-sessions/<vaultId>/`): one
// folder for the whole app meant a new vault opened onto the previous vault's
// chats. `unassigned/` is the no-vault case (the setup screen and the app-less
// harness pages), which keeps the old flat behaviour for them.
import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { currentVaultBucket } from "../vault-scope.ts";

export type PiStoredSession = {
  id: string;
  title: string;
  preview: string | null;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  lastActive: number;
  pinned: boolean;
  archived: boolean;
  /**
   * The agent transcript, as `AgentMessage[]`. It carries user, assistant and
   * toolResult entries — not just the two the dock renders — because a resumed
   * chat has to remember the tool calls it already made.
   */
  messages: unknown[];
};

export type PiSessionSummary = {
  id: string;
  title: string;
  preview: string | null;
  lastActive: number;
  pinned: boolean;
  archived: boolean;
};

/** The legacy flat home; also the parent of every vault bucket. */
function sessionsRoot(): string {
  return path.join(app.getPath("userData"), "pi-sessions");
}

/** A bucket is a path segment, so an id that is not one is not trusted to be. */
function safeBucket(bucket: string): string {
  return /^[A-Za-z0-9_-]{1,128}$/.test(bucket) ? bucket : "unassigned";
}

/** A vault's folder; "unassigned" is the no-vault case. */
function bucketDir(bucket: string = currentVaultBucket()): string {
  return path.join(sessionsRoot(), safeBucket(bucket));
}

/**
 * Ids are file names; anything else is refused rather than sanitized silently.
 *
 * `bucket` is explicit because a turn belongs to the vault it STARTED in: a run
 * that outlives a vault switch must still write its transcript to the vault
 * that owns the chat, never into the vault the operator has moved to.
 */
function sessionFile(
  id: string,
  bucket: string = currentVaultBucket(),
): string | null {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  return path.join(bucketDir(bucket), `${id}.json`);
}

function summaryOf(session: PiStoredSession): PiSessionSummary {
  return {
    id: session.id,
    title: session.title,
    preview: session.preview,
    lastActive: session.lastActive,
    pinned: session.pinned,
    archived: session.archived,
  };
}

export async function listPiSessions(): Promise<PiSessionSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(bucketDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const rows: PiSessionSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const row = await readPiSession(name.slice(0, -".json".length));
    if (row && !row.archived) rows.push(summaryOf(row));
  }
  rows.sort((a, b) => b.lastActive - a.lastActive);
  return rows;
}

export async function readPiSession(id: string): Promise<PiStoredSession | null> {
  const file = sessionFile(id);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PiStoredSession>;
    if (typeof parsed.id !== "string") return null;
    return {
      id: parsed.id,
      title: typeof parsed.title === "string" ? parsed.title : "",
      preview: typeof parsed.preview === "string" ? parsed.preview : null,
      createdAt:
        typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      lastActive:
        typeof parsed.lastActive === "number" ? parsed.lastActive : Date.now(),
      pinned: parsed.pinned === true,
      archived: parsed.archived === true,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function createPiSession(
  title = "",
  bucket: string = currentVaultBucket(),
): Promise<PiStoredSession> {
  const now = Date.now();
  const session: PiStoredSession = {
    id: randomUUID(),
    title: title.trim(),
    preview: null,
    createdAt: now,
    lastActive: now,
    pinned: false,
    archived: false,
    messages: [],
  };
  await writePiSession(session, bucket);
  return session;
}

/**
 * Write one chat, into `bucket` when the caller captured the vault the turn
 * started in. The default is the open vault, which is what list/read/delete use.
 */
export async function writePiSession(
  session: PiStoredSession,
  bucket: string = currentVaultBucket(),
): Promise<void> {
  if (safeBucket(bucket) !== bucket) {
    throw new Error(`Refusing an unsafe vault bucket: ${bucket}`);
  }
  const file = sessionFile(session.id, bucket);
  if (!file) throw new Error(`Refusing an unsafe session id: ${session.id}`);
  await fs.mkdir(bucketDir(bucket), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(session)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export async function deletePiSession(id: string): Promise<boolean> {
  const file = sessionFile(id);
  if (!file) return false;
  try {
    await fs.rm(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * True when pre-vault flat transcripts are waiting for an adopting vault.
 *
 * The one-time adoption must run only for an install that actually has old
 * state: a fresh install's first vault starts clean, even if this machine
 * happens to have Hermes on PATH.
 */
export async function hasLegacyPiSessions(): Promise<boolean> {
  try {
    const names = await fs.readdir(sessionsRoot());
    return names.some((name) => name.endsWith(".json"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Move the pre-vault flat transcripts into `vaultId`'s bucket, once.
 *
 * Before chats were vault-scoped there was one folder for the whole app, and the
 * vault open at the upgrade is the one that keeps them: every other vault starts
 * clean. The move is per file, so a half-finished adoption still leaves the
 * remaining files where they were and is safe to run again.
 *
 * A collision never overwrites: the destination file is this vault's own chat
 * already, and the legacy file is left for whatever vault adopts next.
 */
export async function adoptLegacyPiSessions(vaultId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(vaultId)) return;
  const root = sessionsRoot();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const target = path.join(root, vaultId);
  await fs.mkdir(target, { recursive: true });
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const from = path.join(root, name);
    const to = path.join(target, name);
    try {
      await fs.access(to);
      continue;
    } catch {
      // No destination file: this one is free to move.
    }
    try {
      await fs.rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // A file that vanished between the listing and the rename is not an
      // adoption failure; the vault opening must not depend on this.
      if (code === "ENOENT") continue;
      throw e;
    }
  }
}

/** The visible name: a set title, else the first thing the operator asked. */
export function piSessionLabel(session: Pick<PiStoredSession, "title" | "preview">): string {
  const title = session.title.trim();
  if (title) return title;
  const preview = (session.preview ?? "").trim();
  return preview || "New chat";
}
