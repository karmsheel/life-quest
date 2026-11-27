import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { assertPhysicalContainment, vaultPaths, assertSafeSegment } from "./paths.ts";
import {
  DATABASE_COLUMN_TYPES,
  DATABASE_SOT_MODES,
  type DatabaseColumn,
  type DatabaseColumnType,
  type DatabaseMeta,
  type DatabaseRow,
  type DomainBooksDatabase,
  type DomainBooksExport,
  type DomainDatabaseRegistry,
  type Result,
} from "./types.ts";
import {
  isDomainLive,
  listRows,
  readRegistry,
  validateCells,
} from "./domain-databases.ts";

export async function exportDomainBooks(
  root: string,
  slug: string,
): Promise<Result<DomainBooksExport>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readRegistry(registryPath);

    const databases: DomainBooksDatabase[] = [];
    for (const db of registry.databases) {
      const rowsRes = await listRows(root, slug, db.id);
      if (!rowsRes.ok) return rowsRes;
      // Registry databases only — ingest staging tables are not in registry.
      const rows: DatabaseRow[] = rowsRes.value;
      databases.push({
        id: db.id,
        name: db.name,
        sotMode: db.sotMode,
        columns: db.columns,
        rows,
      });
    }

    const exportedAt = new Date().toISOString();
    const payload: DomainBooksExport = {
      schemaVersion: 1,
      domainSlug: slug,
      exportedAt,
      databases,
    };

    const booksPath = paths.domainBooks(slug);
    await atomicWriteFile(booksPath, JSON.stringify(payload, null, 2) + "\n");

    const databaseCount = databases.length;
    const rowCount = databases.reduce((sum, db) => sum + db.rows.length, 0);
    await appendLog(root, {
      domainSlug: slug,
      type: "books.exported",
      summary: `Exported ${databaseCount} databases (${rowCount} rows) for ${slug}`,
      payload: { domainSlug: slug, databaseCount, rowCount },
    });

    return { ok: true, value: payload };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A books.json is a vault file; bound how much of the machine it can use. */
const RESTORE_MAX_ROWS = 1_000_000;

function isColumnType(value: unknown): value is DatabaseColumnType {
  return typeof value === "string" && (DATABASE_COLUMN_TYPES as readonly string[]).includes(value);
}

/**
 * Validate one exported database's metadata. A books.json can be a synced/hostile
 * file, so the column list is checked against the same types the app itself
 * writes before it is allowed anywhere near registry.json.
 */
function checkExportedDatabase(
  raw: unknown,
  index: number,
): { ok: true; database: DomainBooksDatabase } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `books.json database ${index + 1} is not an object` };
  }
  const candidate = raw as Partial<DomainBooksDatabase>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return { ok: false, error: `books.json database ${index + 1} has no id` };
  }
  try {
    assertSafeSegment(candidate.id, "database id");
  } catch {
    return { ok: false, error: `books.json database ${index + 1} has an invalid id` };
  }
  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    return { ok: false, error: `books.json database ${index + 1} has no name` };
  }
  if (!Array.isArray(candidate.columns)) {
    return { ok: false, error: `books.json database ${index + 1} has no columns array` };
  }
  const columnIds = new Set<string>();
  const columns: DatabaseColumn[] = [];
  for (const rawColumn of candidate.columns) {
    if (!rawColumn || typeof rawColumn !== "object") {
      return { ok: false, error: `books.json database ${index + 1} has an invalid column` };
    }
    const column = rawColumn as Partial<DatabaseColumn>;
    if (typeof column.id !== "string" || !column.id.trim() || columnIds.has(column.id)) {
      return { ok: false, error: `books.json database ${index + 1} has an invalid column id` };
    }
    try {
      assertSafeSegment(column.id, "column id");
    } catch {
      return { ok: false, error: `books.json database ${index + 1} has an invalid column id` };
    }
    if (typeof column.name !== "string" || !column.name.trim() || !isColumnType(column.type)) {
      return { ok: false, error: `books.json database ${index + 1} has an invalid column` };
    }
    columnIds.add(column.id);
    const restoredColumn: DatabaseColumn = {
      id: column.id,
      name: column.name,
      type: column.type,
    };
    if (Array.isArray(column.options) && column.options.every((o) => typeof o === "string")) {
      restoredColumn.options = column.options;
    }
    if (typeof column.relationDatabaseId === "string" && column.relationDatabaseId) {
      try {
        assertSafeSegment(column.relationDatabaseId, "relation database id");
        restoredColumn.relationDatabaseId = column.relationDatabaseId;
      } catch {
        return { ok: false, error: `books.json database ${index + 1} has an invalid relation` };
      }
    }
    columns.push(restoredColumn);
  }
  const sotMode = (DATABASE_SOT_MODES as readonly string[]).includes(String(candidate.sotMode))
    ? (candidate.sotMode as DomainBooksDatabase["sotMode"])
    : "local-only";
  if (!Array.isArray(candidate.rows)) {
    return { ok: false, error: `books.json database ${index + 1} has no rows array` };
  }
  return {
    ok: true,
    database: {
      id: candidate.id,
      name: candidate.name,
      sotMode,
      columns,
      rows: candidate.rows as DatabaseRow[],
    },
  };
}

/**
 * Restore a domain's book from `books.json`.
 *
 * This is the one path that replaces live data, so it is two-phase: everything
 * is validated against a merged registry FIRST (cells through the same
 * `validateCells` the write path uses, so a file cannot inject unknown columns,
 * mistyped values or an arbitrary column list into the registry), and only then
 * is the old sqlite backed up and replaced. A row that fails validation aborts
 * the restore with the database untouched.
 */
export async function restoreDomainBooks(
  root: string,
  slug: string,
  options: { confirm: boolean },
): Promise<Result<{ databases: number; rows: number }>> {
  if (options.confirm !== true) {
    return { ok: false, error: "Restore requires confirmation" };
  }

  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }
    const paths = vaultPaths(root);
    const booksPath = paths.domainBooks(slug);
    await assertPhysicalContainment(root, booksPath, "read");

    // Verify books.json exists
    try {
      await fs.access(booksPath);
    } catch {
      return { ok: false, error: `books.json not found for domain: ${slug}` };
    }

    if ((await fs.stat(booksPath)).size > 512 * 1024 * 1024) {
      return { ok: false, error: "books.json is too large to restore" };
    }
    const raw = await fs.readFile(booksPath, "utf8");
    let parsed: DomainBooksExport;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "books.json is not valid JSON" };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.databases)
    ) {
      return { ok: false, error: "books.json is not a valid export payload" };
    }

    // ── phase 1: validate everything, write nothing ───────────────────────
    const exported: DomainBooksDatabase[] = [];
    for (let i = 0; i < parsed.databases.length; i++) {
      const checked = checkExportedDatabase(parsed.databases[i], i);
      if (!checked.ok) return checked;
      exported.push(checked.database);
    }

    const registryPath = paths.domainRegistry(slug);
    const registry = await readRegistry(registryPath);
    const merged: DomainDatabaseRegistry = {
      ...registry,
      databases: [...registry.databases],
    };
    for (const exportedDb of exported) {
      const existing = merged.databases.find((d) => d.id === exportedDb.id);
      if (!existing) {
        merged.databases.push({
          id: exportedDb.id,
          name: exportedDb.name,
          sotMode: exportedDb.sotMode,
          adapter: null,
          columns: exportedDb.columns,
          createdAt: exportedDb.rows[0]?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as DatabaseMeta);
      }
    }
    let totalRows = 0;
    for (const exportedDb of exported) {
      for (const row of exportedDb.rows) {
        if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id.trim()) {
          return { ok: false, error: "books.json holds a row without an id" };
        }
        if (typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") {
          return { ok: false, error: `Row ${row.id} in books.json has invalid timestamps` };
        }
        if (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells)) {
          return { ok: false, error: `Row ${row.id} in books.json has invalid cells` };
        }
        const validation = validateCells(
          merged,
          exportedDb.id,
          slug,
          row.cells as Record<string, unknown>,
        );
        if (!validation.ok) {
          return { ok: false, error: `books.json row ${row.id}: ${validation.error}` };
        }
        totalRows += 1;
        if (totalRows > RESTORE_MAX_ROWS) {
          return { ok: false, error: `books.json holds more than ${RESTORE_MAX_ROWS} rows` };
        }
      }
    }

    // ── phase 2: back up, then replace ────────────────────────────────────
    const sqlitePath = paths.domainSqlite(slug);
    const walPath = `${sqlitePath}-wal`;
    const shmPath = `${sqlitePath}-shm`;
    const backupPath = `${sqlitePath}.bak`;
    await assertPhysicalContainment(root, sqlitePath, "write");
    try {
      await fs.copyFile(sqlitePath, backupPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          ok: false,
          error: `Could not back up the current book, restore aborted: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // Close + unlink sqlite + wal + shm if present
    for (const p of [sqlitePath, walPath, shmPath]) {
      try {
        await fs.unlink(p);
      } catch {
        // may not exist
      }
    }

    // Recreate sqlite with the rows table
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec("PRAGMA journal_mode=WAL;");
    sqlite.exec(`CREATE TABLE IF NOT EXISTS rows (
      database_id TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cells TEXT NOT NULL,
      PRIMARY KEY (database_id, id)
    );`);

    // Write updated registry
    await assertPhysicalContainment(root, registryPath, "write");
    await atomicWriteFile(registryPath, JSON.stringify(merged, null, 2) + "\n");

    // Insert rows, preserving original timestamps
    const insertStmt = sqlite.prepare(
      "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
    );
    let restored = 0;
    for (const exportedDb of exported) {
      for (const row of exportedDb.rows) {
        insertStmt.run(
          exportedDb.id,
          row.id,
          row.createdAt,
          row.updatedAt,
          JSON.stringify(row.cells),
        );
        restored++;
      }
    }
    sqlite.close();

    const databaseCount = exported.length;
    await appendLog(root, {
      domainSlug: slug,
      type: "books.restored",
      summary: `Restored ${databaseCount} databases (${restored} rows) for ${slug}`,
      payload: {
        domainSlug: slug,
        databaseCount,
        rowCount: restored,
        backup: (await fs.access(backupPath).then(() => true, () => false)) ? backupPath : null,
      },
    });

    return { ok: true, value: { databases: databaseCount, rows: restored } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
