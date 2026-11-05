import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HermesSession } from "./companion-client.ts";

/**
 * The chats Hermes has archived, read from the profile's own session store.
 *
 * WHY THIS EXISTS
 *
 * The sidebar's view options have always promised a "Show archived" band, and
 * the app has always been able to archive a chat: `PATCH /api/sessions/{id}`
 * writes the durable `archived` flag and Hermes drops the row out of every
 * working list. What the app could not do was read one back. Hermes' host
 * gateway lists sessions through `list_sessions_rich(include_archived=False)`
 * (`gateway/platforms/api_server.py::_handle_list_sessions`), so
 * `GET /api/sessions` never carries an archived row no matter what the caller
 * asks for — the renderer's `includeArchived` filter could only ever filter an
 * empty set. The result was a one-way door: archive a chat in LifeQuest and it
 * was gone from LifeQuest (until Hermes Desktop or the CLI restored it), even
 * though the messages were still there.
 *
 * The Hermes Desktop sidebar solves the same problem through its own backend
 * (`GET /api/sessions?archived=include|only`), which is a different server than
 * the host gateway this app attaches to. So the store is read directly, from
 * the profile the app is already attached to, exactly as Hermes' own desktop
 * backend reads it: the profile's `state.db`, read-only, one query for the
 * archived rows the sidebar draws. This is a read, never a copy — the profile
 * stays the single source of truth, and unarchiving still goes through the
 * gateway's PATCH like every other flag.
 *
 * The read is deliberately defensive: a profile with no database yet (a fresh
 * install, or an E2E rig attached to a recording server), a database from an
 * older Hermes schema, or a failed lock all mean "no archived rows to draw",
 * not "the chat list is broken". The live list from the gateway is unaffected.
 */

/** How many archived rows one list read draws. Matches the gateway page size. */
const LIMIT = 200;

/** How much of the first prompt the row preview carries. */
const PREVIEW_CHARS = 200;

function oneLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/** Unix seconds from the store, tolerating an old millisecond stamp. */
function unixSeconds(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n / 1000 : n;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name?: unknown;
    }[];
    return rows.some((row) => String(row.name ?? "") === column);
  } catch {
    return false;
  }
}

function hasTable(db: DatabaseSync, table: string): boolean {
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { ok?: unknown } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * The archived rows the sidebar's archived band draws, newest activity first.
 *
 * The selection mirrors what the gateway's live list would have shown for the
 * same rows: hidden rows never cross, the preview is the first user message
 * (one line), and activity is the row's last activity rather than its start.
 */
export async function readArchivedSessions(
  profilePath: string,
): Promise<HermesSession[]> {
  if (!profilePath) return [];
  const dbPath = path.join(profilePath, "state.db");
  try {
    const stat = await fs.stat(dbPath);
    if (!stat.isFile()) return [];
  } catch {
    // No store on this profile yet: that is an empty archived view, not a fault.
    return [];
  }

  let db: DatabaseSync | null = null;
  try {
    // READ ONLY: the host gateway owns this database and may be writing it
    // through its WAL at the same moment. A read connection joins that WAL and
    // never takes a write lock.
    db = new DatabaseSync(dbPath, { readOnly: true });
    if (!hasTable(db, "sessions")) return [];
    if (!hasColumn(db, "sessions", "id") || !hasColumn(db, "sessions", "archived")) {
      return [];
    }

    const lastActive = hasColumn(db, "sessions", "last_activity_at")
      ? "COALESCE(s.last_activity_at, s.started_at)"
      : "s.started_at";
    const pinned = hasColumn(db, "sessions", "pinned") ? "s.pinned" : "0";
    const hiddenClause = hasColumn(db, "sessions", "hidden")
      ? "AND s.hidden = 0"
      : "";
    const messages = hasTable(db, "messages") &&
      hasColumn(db, "messages", "session_id") &&
      hasColumn(db, "messages", "role") &&
      hasColumn(db, "messages", "content");
    const preview = messages
      ? `COALESCE((SELECT SUBSTR(m.content, 1, ${PREVIEW_CHARS}) FROM messages m
           WHERE m.session_id = s.id AND m.role = 'user' AND m.content IS NOT NULL
           ORDER BY m.timestamp, m.id LIMIT 1), '') AS preview`
      : "'' AS preview";

    const rows = db
      .prepare(
        `SELECT s.id AS id, s.title AS title, ${lastActive} AS last_active,
                ${pinned} AS pinned, ${preview}
           FROM sessions s
          WHERE s.archived = 1 ${hiddenClause}
          ORDER BY last_active DESC, s.started_at DESC
          LIMIT ${LIMIT}`,
      )
      .all() as unknown as Record<string, unknown>[];

    const out: HermesSession[] = [];
    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const previewText = oneLine(row.preview);
      out.push({
        id,
        title: oneLine(row.title),
        preview: previewText ? previewText : null,
        lastActive: unixSeconds(row.last_active),
        pinned: Number(row.pinned ?? 0) !== 0,
        archived: true,
      });
    }
    return out;
  } catch (e) {
    // A store we cannot read must not take the live list down with it; the
    // archived band simply has nothing to draw this time.
    console.warn(
      `[companion] archived chats could not be read from ${dbPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // Closing a connection that never opened, or one SQLite already closed.
    }
  }
}

/**
 * Fold the archived rows into a gateway list, keyed by chat id.
 *
 * The gateway page never carries an archived row today, but a Hermes build that
 * back-fills a pinned row past the archive filter can: the archived row wins the
 * flag, while a preview the gateway computed is kept when the store's own
 * preview query came back empty.
 */
export function mergeArchivedSessions(
  live: readonly HermesSession[],
  archived: readonly HermesSession[],
): HermesSession[] {
  const merged = [...live];
  const index = new Map(merged.map((row, at) => [row.id, at]));
  for (const row of archived) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, merged.length);
      merged.push(row);
      continue;
    }
    const current = merged[at];
    merged[at] = {
      ...current,
      archived: true,
      preview: current.preview ?? row.preview,
      lastActive: current.lastActive ?? row.lastActive,
    };
  }
  return merged;
}
