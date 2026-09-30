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
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
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

/**
 * KAR-64: `createDatabase` and `addDatabaseColumn` are read-modify-write cycles on
 * registry.json with no locking, and this design adds the agent as a second
 * concurrent writer alongside the operator. An in-process async mutex keyed by
 * registry path is enough — the engine runs in one Electron main process.
 */
const registryLocks = new Map<string, Promise<unknown>>();

async function withRegistryLock<T>(registryPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = registryLocks.get(registryPath) ?? Promise.resolve();
  // Chain onto the previous holder regardless of how it settled, so a rejected
  // critical section does not poison every later one.
  const run = previous.then(fn, fn);
  registryLocks.set(
    registryPath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    return await run;
  } finally {
    if (registryLocks.get(registryPath) === undefined) registryLocks.delete(registryPath);
  }
}

export async function createDatabase(
  root: string,
  slug: string,
  // KAR-64: `id` is optional and defaults to a fresh UUID, so a Decision can name
  // the database it proposes without the id having to be minted on apply.
  input: { name: string; id?: string },
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

    const now = new Date().toISOString();
    const dbMeta: DatabaseMeta = {
      id: input.id ?? randomUUID(),
      name,
      sotMode: "local-only",
      adapter: null,
      columns: [],
      createdAt: now,
      updatedAt: now,
    };

    // Read-modify-write on registry.json under the per-path lock, and re-read
    // *inside* the critical section so a lock taken after a stale read cannot
    // still lose a concurrent writer's database.
    await withRegistryLock(registryPath, async () => {
      const registry = await readRegistry(registryPath);
      registry.databases.push(dbMeta);
      await atomicWriteFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
    });

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

    // Same critical section as createDatabase, and the same re-read inside it.
    return await withRegistryLock(registryPath, async () => {
      const registry = await readRegistry(registryPath);
      const db = registry.databases.find((d) => d.id === dbId);
      if (!db) return { ok: false as const, error: `Database not found: ${dbId}` };

      if (input.type === "relation") {
        const targetExists = registry.databases.some(
          (d) => d.id === input.relationDatabaseId,
        );
        if (!targetExists) {
          return {
            ok: false as const,
            error: `Target database not found: ${input.relationDatabaseId}`,
          };
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
      return { ok: true as const, value: db };
    });
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

/** Type-check one row's cells. checkDatabaseCells does not reject a mistyped value. */
export async function validateRowCells(
  root: string,
  slug: string,
  dbId: string,
  cells: Record<string, unknown>,
): Promise<Result<true>> {
  try {
    const registry = await readRegistry(vaultPaths(root).domainRegistry(slug));
    return validateCells(registry, dbId, slug, cells);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * KAR-64: the extra checks a proposed or applied database row write needs, beyond
 * what `validateCells` does. validateCells type-checks values and confirms a
 * relation's *target database* exists — it does not confirm the referenced *row*
 * exists, and enforces no posted-transaction invariants. Deliberately narrow:
 * these cover the posted-row rules the spec names, and are not a general
 * constraint engine.
 *
 * Every failure here is permanent: re-running it on the same cells gives the same
 * answer, so an approved apply that trips one must not stay retryable.
 */
export async function checkDatabaseCells(
  root: string,
  slug: string,
  dbId: string,
  cells: Record<string, unknown>,
): Promise<Result<true>> {
  const dbRes = await getDatabase(root, slug, dbId);
  if (!dbRes.ok) return dbRes;
  const db = dbRes.value;

  // Unknown column ids are rejected up front, the same rule validateCells
  // applies on write. Without this a typo'd column would pass every check here
  // and only fail at approve time, leaving a Decision the operator reviewed and
  // then could not apply.
  const colIds = new Set(db.columns.map((c) => c.id));
  for (const key of Object.keys(cells)) {
    if (!colIds.has(key)) {
      return { ok: false, error: `Unknown column id in cells: ${key}` };
    }
  }

  for (const col of db.columns) {
    const val = cells[col.id];
    if (val === undefined || val === null) continue;
    if (col.type === "relation") {
      if (typeof val !== "string" || !val) {
        return { ok: false, error: `Column ${col.name} expects relation row id` };
      }
      const target = await getRow(root, slug, col.relationDatabaseId as string, val);
      if (!target.ok) {
        return {
          ok: false,
          error: `Column ${col.name} references a row that does not exist: ${val}`,
        };
      }
    }
  }

  if (slug === FINANCE_DOMAIN_SLUG && dbId === FINANCE_DB_IDS.transactions) {
    // Columns are addressed by name so this holds regardless of the minted ids.
    const colId = (name: string) => db.columns.find((c) => c.name.toLowerCase() === name)?.id;
    const dateColId = colId("date");
    const amountColId = colId("amount");
    const provenanceColId = colId("provenance");
    const date = dateColId ? cells[dateColId] : undefined;
    if (date === undefined || date === null) {
      return { ok: false, error: "A posted transaction needs a date" };
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "A posted transaction date must be YYYY-MM-DD" };
    }
    const amount = amountColId ? cells[amountColId] : undefined;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
      return { ok: false, error: "A posted transaction needs a finite non-zero amount" };
    }
    // provenance defaults to "agent" when absent; validateCells already types it.
    if (provenanceColId) {
      const prov = cells[provenanceColId];
      if (prov !== undefined && prov !== null && typeof prov !== "string") {
        return { ok: false, error: "provenance expects a string" };
      }
    }
  }

  return { ok: true, value: true };
}

/**
 * KAR-64: `opts` is optional and defaults to the previous full-read behaviour, so
 * every existing call site is unaffected. When a limit is given the paging is
 * pushed into SQL — a tool-level slice of an unordered result set skips and
 * duplicates rows, and a ledger grows every time the user chats.
 */
export async function listRows(
  root: string,
  slug: string,
  dbId: string,
  opts?: { limit?: number; offset?: number },
): Promise<Result<DatabaseRow[]>> {
  try {
    const paths = vaultPaths(root);
    const sqlitePath = paths.domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: true, value: [] };
    }
    const limit =
      opts?.limit !== undefined && Number.isInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : null;
    const offset =
      opts?.offset !== undefined && Number.isInteger(opts.offset) && opts.offset > 0
        ? opts.offset
        : 0;
    const sqlite = openSqlite(sqlitePath);
    try {
      // Deterministic order, always: paged and unpaged reads must agree.
      const base =
        "SELECT id, database_id, created_at, updated_at, cells FROM rows " +
        "WHERE database_id = ? ORDER BY created_at ASC, id ASC";
      const stmt = limit === null
        ? sqlite.prepare(base)
        : sqlite.prepare(`${base} LIMIT ? OFFSET ?`);
      const rows = (limit === null ? stmt.all(dbId) : stmt.all(dbId, limit, offset)) as Array<{
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

/**
 * KAR-64: the row count for a database, so `list_rows` can tell the agent
 * "50 of 12,000 rows" from "these are all the rows". Without it a truncation is
 * indistinguishable from a complete answer.
 */
export async function countRows(
  root: string,
  slug: string,
  dbId: string,
): Promise<Result<number>> {
  try {
    const paths = vaultPaths(root);
    const sqlitePath = paths.domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: true, value: 0 };
    }
    const sqlite = openSqlite(sqlitePath);
    try {
      const row = sqlite
        .prepare("SELECT COUNT(*) AS n FROM rows WHERE database_id = ?")
        .get(dbId) as { n: number } | undefined;
      return { ok: true, value: row?.n ?? 0 };
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

export async function insertRows(
  root: string,
  slug: string,
  dbId: string,
  rows: Array<{ id: string; cells: Record<string, unknown> }>,
): Promise<Result<{ ids: string[] }>> {
  try {
    if (rows.length < 1) return { ok: false, error: "rows must not be empty" };
    const paths = vaultPaths(root);
    const registry = await readRegistry(paths.domainRegistry(slug));
    for (const row of rows) {
      if (!row.id.trim()) return { ok: false, error: "Row id is required" };
      const validation = validateCells(registry, dbId, slug, row.cells);
      if (!validation.ok) return validation;
    }

    const now = new Date().toISOString();
    const sqlite = openSqlite(paths.domainSqlite(slug));
    try {
      sqlite.exec("BEGIN");
      const existing = sqlite.prepare(
        "SELECT id FROM rows WHERE database_id = ? AND id = ?",
      );
      const insert = sqlite.prepare(
        "INSERT INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
      );
      for (const row of rows) {
        const found = existing.get(dbId, row.id) as { id: string } | undefined;
        if (found) {
          sqlite.exec("ROLLBACK");
          return { ok: false, error: `Row id already exists: ${row.id}` };
        }
        insert.run(dbId, row.id, now, now, JSON.stringify(row.cells));
      }
      sqlite.exec("COMMIT");
      return { ok: true, value: { ids: rows.map((row) => row.id) } };
    } catch (e) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The transaction is already closed.
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
