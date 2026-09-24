import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  DATABASE_COLUMN_TYPES,
  DATABASE_SOT_MODES,
  type DatabaseColumn,
  type DatabaseColumnType,
  type DatabaseMeta,
  type DatabaseRow,
  type DatabaseListEntry,
  type DomainDatabaseRegistry,
  type Result,
} from "./types.ts";

function isColumnType(v: unknown): v is DatabaseColumnType {
  return (
    typeof v === "string" &&
    (DATABASE_COLUMN_TYPES as readonly string[]).includes(v)
  );
}

function validateColumnName(name: string): Result<true> {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Column name is required" };
  }
  return { ok: true, value: true };
}

function safeParseRegistry(raw: string): DomainDatabaseRegistry | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      "databases" in parsed &&
      Array.isArray(parsed.databases)
    ) {
      return parsed as DomainDatabaseRegistry;
    }
    return null;
  } catch {
    return null;
  }
}

export async function readRegistry(
  registryPath: string,
): Promise<DomainDatabaseRegistry> {
  try {
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed = safeParseRegistry(raw);
    if (parsed) return parsed;
    return { schemaVersion: 1, databases: [], installedKits: [] };
  } catch {
    return { schemaVersion: 1, databases: [], installedKits: [] };
  }
}

function openSqlite(sqlitePath: string): DatabaseSync {
  const db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`CREATE TABLE IF NOT EXISTS rows (
    database_id TEXT NOT NULL,
    id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cells TEXT NOT NULL,
    PRIMARY KEY (database_id, id)
  );`);
  return db;
}

export async function isDomainLive(root: string, slug: string): Promise<boolean> {
  try {
    const metaPath = vaultPaths(root).domainJson(slug);
    const raw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw);
    return meta.archivedAt == null;
  } catch {
    return false;
  }
}

async function ensureVaultDatabaseGitignore(root: string): Promise<void> {
  const paths = vaultPaths(root);
  const gitDir = paths.root + "/.git";
  try {
    await fs.stat(gitDir);
  } catch {
    return; // not a git repo
  }
  const ignorePath = paths.root + "/.gitignore";
  let current = "";
  try {
    current = await fs.readFile(ignorePath, "utf8");
  } catch {
    current = "";
  }
  const lines = new Set(current.split("\n").map((l) => l.trim()));
  const hasSqlite = lines.has("domains/*/data/domain.sqlite*");
  const hasCache = lines.has(".lifequest/cache/");
  let updated = current;
  if (!hasSqlite) {
    updated +=
      (current.endsWith("\n") || current === "" ? "" : "\n") +
      "domains/*/data/domain.sqlite*\n";
  }
  if (!hasCache) updated += ".lifequest/cache/\n";
  if (updated !== current) {
    await fs.writeFile(ignorePath, updated);
  }
}

export async function createDatabase(
  root: string,
  slug: string,
  input: { name: string },
): Promise<Result<DatabaseMeta>> {
  try {
    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Database name is required" };
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const paths = vaultPaths(root);
    const dataDir = paths.domainDataDir(slug);
    await fs.mkdir(dataDir, { recursive: true });
    const registryPath = paths.domainRegistry(slug);
    const sqlitePath = paths.domainSqlite(slug);

    // Read current registry
    const registry = await readRegistry(registryPath);

    const now = new Date().toISOString();
    const dbMeta: DatabaseMeta = {
      id: randomUUID(),
      name,
      sotMode: "local-only",
      adapter: null,
      columns: [],
      createdAt: now,
      updatedAt: now,
    };

    registry.databases.push(dbMeta);

    // Write registry
    await atomicWriteFile(registryPath, JSON.stringify(registry, null, 2) + "\n");

    // Open sqlite to create rows table
    const sqlite = openSqlite(sqlitePath);
    sqlite.close();

    // Cache dir
    await fs.mkdir(paths.cacheDir, { recursive: true });

    // Gitignore
    await ensureVaultDatabaseGitignore(root);

    // Log
    await appendLog(root, {
      domainSlug: slug,
      type: "database.created",
      summary: `Created database ${name} in ${slug}`,
      payload: { databaseId: dbMeta.id, name },
    });

    return { ok: true, value: dbMeta };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listDatabases(
  root: string,
  domainSlug?: string | null,
): Promise<Result<DatabaseListEntry[]>> {
  try {
    const paths = vaultPaths(root);
    const entries: DatabaseListEntry[] = [];

    const slugs: string[] = domainSlug == null ? [] : [domainSlug];
    if (domainSlug == null) {
      // Union: read all live domains
      try {
        const entries_dirs = await fs.readdir(paths.domainsDir, { withFileTypes: true });
        for (const entry of entries_dirs) {
          if (!entry.isDirectory()) continue;
          const metaPath = paths.domainJson(entry.name);
          try {
            const raw = await fs.readFile(metaPath, "utf8");
            const meta = JSON.parse(raw);
            if (meta.archivedAt == null) slugs.push(entry.name);
          } catch {}
        }
      } catch {}
    }

    for (const slug of slugs) {
      const registryPath = paths.domainRegistry(slug);
      const registry = await readRegistry(registryPath);
      for (const db of registry.databases) {
        entries.push({ domainSlug: slug, database: db });
      }
    }

    return { ok: true, value: entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getDatabase(
  root: string,
  slug: string,
  dbId: string,
): Promise<Result<DatabaseMeta>> {
  try {
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readRegistry(registryPath);
    const db = registry.databases.find((d) => d.id === dbId);
    if (!db) return { ok: false, error: `Database not found: ${dbId}` };
    return { ok: true, value: db };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addDatabaseColumn(
  root: string,
  slug: string,
  dbId: string,
  input: {
    name: string;
    type: DatabaseColumnType;
    options?: string[];
    relationDatabaseId?: string;
  },
): Promise<Result<DatabaseMeta>> {
  try {
    const nameCheck = validateColumnName(input.name);
    if (!nameCheck.ok) return nameCheck;
    if (!isColumnType(input.type)) {
      return { ok: false, error: `Unknown column type: ${String(input.type)}` };
    }
    if (input.type === "select") {
      if (!input.options || input.options.length < 1) {
        return { ok: false, error: "select requires at least one option" };
      }
    }
    if (input.type === "relation") {
      if (!input.relationDatabaseId) {
        return { ok: false, error: "relation requires relationDatabaseId" };
      }
    }

    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readRegistry(registryPath);
    const db = registry.databases.find((d) => d.id === dbId);
    if (!db) return { ok: false, error: `Database not found: ${dbId}` };

    if (input.type === "relation") {
      const targetExists = registry.databases.some(
        (d) => d.id === input.relationDatabaseId,
      );
      if (!targetExists) {
        return { ok: false, error: `Target database not found: ${input.relationDatabaseId}` };
      }
    }

    const col: DatabaseColumn = {
      id: randomUUID(),
      name: input.name.trim(),
      type: input.type,
    };
    if (input.options) col.options = input.options;
    if (input.relationDatabaseId) col.relationDatabaseId = input.relationDatabaseId;

    db.columns.push(col);
    db.updatedAt = new Date().toISOString();

    await atomicWriteFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
    return { ok: true, value: db };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function validateCells(
  registry: DomainDatabaseRegistry,
  dbId: string,
  slug: string,
  cells: Record<string, unknown>,
): Result<true> {
  const db = registry.databases.find((d) => d.id === dbId);
  if (!db) return { ok: false, error: `Database not found: ${dbId}` };

  const colIds = new Set(db.columns.map((c) => c.id));
  const colById = new Map(db.columns.map((c) => [c.id, c]));

  for (const key of Object.keys(cells)) {
    if (!colIds.has(key)) {
      return { ok: false, error: `Unknown column id in cells: ${key}` };
    }
  }

  for (const col of db.columns) {
    const val = cells[col.id];
    if (val === undefined || val === null) continue;
    switch (col.type) {
      case "text":
        if (typeof val !== "string") {
          return { ok: false, error: `Column ${col.name} expects string` };
        }
        break;
      case "number":
        if (typeof val !== "number" || !Number.isFinite(val)) {
          return { ok: false, error: `Column ${col.name} expects finite number` };
        }
        break;
      case "date":
        if (typeof val !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return { ok: false, error: `Column ${col.name} expects YYYY-MM-DD` };
        }
        break;
      case "select":
        if (typeof val !== "string" || !col.options?.includes(val)) {
          return { ok: false, error: `Column ${col.name} value not in options` };
        }
        break;
      case "checkbox":
        if (typeof val !== "boolean") {
          return { ok: false, error: `Column ${col.name} expects boolean` };
        }
        break;
      case "relation":
        if (typeof val !== "string") {
          return { ok: false, error: `Column ${col.name} expects relation row id` };
        }
        // Validate target db exists in registry
        if (!registry.databases.some((d) => d.id === col.relationDatabaseId)) {
          return { ok: false, error: `Column ${col.name} relation target missing` };
        }
        break;
      case "file": {
        if (typeof val !== "string") {
          return { ok: false, error: `Column ${col.name} expects file path string` };
        }
        const prefix = `domains/${slug}/data/files/`;
        if (
          path.isAbsolute(val) ||
          val.includes("..") ||
          val.includes("\\") ||
          !val.startsWith(prefix)
        ) {
          return { ok: false, error: `Column ${col.name} invalid file path` };
        }
        break;
      }
    }
  }

  return { ok: true, value: true };
}

export async function listRows(
  root: string,
  slug: string,
  dbId: string,
): Promise<Result<DatabaseRow[]>> {
  try {
    const paths = vaultPaths(root);
    const sqlitePath = paths.domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: true, value: [] };
    }
    const sqlite = openSqlite(sqlitePath);
    try {
      const stmt = sqlite.prepare(
        "SELECT id, database_id, created_at, updated_at, cells FROM rows WHERE database_id = ?",
      );
      const rows = stmt.all(dbId) as Array<{
        id: string;
        database_id: string;
        created_at: string;
        updated_at: string;
        cells: string;
      }>;
      const result: DatabaseRow[] = rows.map((r) => ({
        id: r.id,
        databaseId: r.database_id,
        domainSlug: slug,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        cells: JSON.parse(r.cells),
      }));
      return { ok: true, value: result };
    } finally {
      sqlite.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getRow(
  root: string,
  slug: string,
  dbId: string,
  rowId: string,
): Promise<Result<DatabaseRow>> {
  try {
    const paths = vaultPaths(root);
    const sqlitePath = paths.domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: false, error: `Row not found: ${rowId}` };
    }
    const sqlite = openSqlite(sqlitePath);
    try {
      const stmt = sqlite.prepare(
        "SELECT id, database_id, created_at, updated_at, cells FROM rows WHERE database_id = ? AND id = ?",
      );
      const r = stmt.get(dbId, rowId) as
        | { id: string; database_id: string; created_at: string; updated_at: string; cells: string }
        | undefined;
      if (!r) return { ok: false, error: `Row not found: ${rowId}` };
      return {
        ok: true,
        value: {
          id: r.id,
          databaseId: r.database_id,
          domainSlug: slug,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          cells: JSON.parse(r.cells),
        },
      };
    } finally {
      sqlite.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function upsertRow(
  root: string,
  slug: string,
  dbId: string,
  input: { id?: string; cells: Record<string, unknown> },
): Promise<Result<DatabaseRow>> {
  try {
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const sqlitePath = paths.domainSqlite(slug);

    const registry = await readRegistry(registryPath);

    // Validate cells against registry
    const validation = validateCells(registry, dbId, slug, input.cells);
    if (!validation.ok) return validation;

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();

    const sqlite = openSqlite(sqlitePath);
    try {
      // Check if row exists
      const existing = sqlite
        .prepare("SELECT created_at FROM rows WHERE database_id = ? AND id = ?")
        .get(dbId, id) as { created_at: string } | undefined;

      const created = existing?.created_at ?? now;

      const stmt = sqlite.prepare(
        "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
      );
      stmt.run(dbId, id, created, now, JSON.stringify(input.cells));

      return {
        ok: true,
        value: {
          id,
          databaseId: dbId,
          domainSlug: slug,
          createdAt: created,
          updatedAt: now,
          cells: input.cells,
        },
      };
    } finally {
      sqlite.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteRow(
  root: string,
  slug: string,
  dbId: string,
  rowId: string,
): Promise<Result<{ id: string }>> {
  try {
    const paths = vaultPaths(root);
    const sqlitePath = paths.domainSqlite(slug);
    const sqlite = openSqlite(sqlitePath);
    try {
      const info = sqlite
        .prepare("DELETE FROM rows WHERE database_id = ? AND id = ?")
        .run(dbId, rowId);
      if (info.changes === 0) {
        return { ok: false, error: `Row not found: ${rowId}` };
      }
      return { ok: true, value: { id: rowId } };
    } finally {
      sqlite.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveDatabaseFile(
  root: string,
  slug: string,
  input: { bytes: Uint8Array; mime: string; name: string },
): Promise<Result<{ relPath: string; fileId: string }>> {
  try {
    const name = input.name;
    // Reject path escape
    if (!name || name.includes("..") || path.isAbsolute(name)) {
      return { ok: false, error: "Invalid file name" };
    }
    // Additional: reject backslashes with absolute drive
    if (/^[a-zA-Z]:/.test(name)) {
      return { ok: false, error: "Invalid file name" };
    }

    const fileId = randomUUID();
    const safeName = path.basename(name);
    const paths = vaultPaths(root);
    const fullPath = paths.domainFile(slug, fileId, safeName);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.bytes);

    const relPath = `domains/${slug}/data/files/${fileId}/${safeName}`;
    return { ok: true, value: { relPath, fileId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export { ensureVaultDatabaseGitignore };

export async function invalidateDomainCache(root: string): Promise<void> {
  const paths = vaultPaths(root);
  try {
    const entries = await fs.readdir(paths.cacheDir);
    for (const entry of entries) {
      await fs.rm(path.join(paths.cacheDir, entry), { recursive: true, force: true });
    }
  } catch {
    // cache dir may not exist
  }
  await fs.mkdir(paths.cacheDir, { recursive: true });
}
