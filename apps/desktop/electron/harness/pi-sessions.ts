// Transcripts for the built-in companion.
//
// Hermes owns its sessions; a harness that lives in this process has to own
// its own. They live in app userData, never in the vault: VISION says chat
// transcripts stay with the harness and the vault stays the operator's life
// database. One JSON file per chat, written atomically, because the dock lets
// the operator delete and rename while a turn is running.
import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

function sessionsDir(): string {
  return path.join(app.getPath("userData"), "pi-sessions");
}

/** Ids are file names; anything else is refused rather than sanitized silently. */
function sessionFile(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  return path.join(sessionsDir(), `${id}.json`);
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
    names = await fs.readdir(sessionsDir());
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

export async function createPiSession(title = ""): Promise<PiStoredSession> {
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
  await writePiSession(session);
  return session;
}

export async function writePiSession(session: PiStoredSession): Promise<void> {
  const file = sessionFile(session.id);
  if (!file) throw new Error(`Refusing an unsafe session id: ${session.id}`);
  await fs.mkdir(sessionsDir(), { recursive: true });
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

/** The visible name: a set title, else the first thing the operator asked. */
export function piSessionLabel(session: Pick<PiStoredSession, "title" | "preview">): string {
  const title = session.title.trim();
  if (title) return title;
  const preview = (session.preview ?? "").trim();
  return preview || "New chat";
}
