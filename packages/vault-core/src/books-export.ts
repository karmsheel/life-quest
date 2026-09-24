import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  type DatabaseRow,
  type DomainBooksDatabase,
  type DomainBooksExport,
  type Result,
} from "./types.ts";
import {
  isDomainLive,
  listRows,
  readRegistry,
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

    // Verify books.json exists
    try {
      await fs.access(booksPath);
    } catch {
      return { ok: false, error: `books.json not found for domain: ${slug}` };
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

    const sqlitePath = paths.domainSqlite(slug);
    const walPath = `${sqlitePath}-wal`;
    const shmPath = `${sqlitePath}-shm`;

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

    // Read current registry (may have databases with no exported rows)
    const registryPath = paths.domainRegistry(slug);
    const registry = await readRegistry(registryPath);

    // For each exported db: ensure registry meta exists
    for (const exportedDb of parsed.databases) {
      const existing = registry.databases.find((d) => d.id === exportedDb.id);
      if (!existing) {
        // Append to registry
        registry.databases.push({
          id: exportedDb.id,
          name: exportedDb.name,
          sotMode: exportedDb.sotMode,
          adapter: null,
          columns: exportedDb.columns,
          createdAt: exportedDb.rows[0]?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Write updated registry
    await atomicWriteFile(registryPath, JSON.stringify(registry, null, 2) + "\n");

    // Insert rows, preserving original timestamps
    let totalRows = 0;
    const insertStmt = sqlite.prepare(
      "INSERT OR REPLACE INTO rows (database_id, id, created_at, updated_at, cells) VALUES (?, ?, ?, ?, ?)",
    );
    for (const exportedDb of parsed.databases) {
      for (const row of exportedDb.rows) {
        insertStmt.run(
          exportedDb.id,
          row.id,
          row.createdAt,
          row.updatedAt,
          JSON.stringify(row.cells),
        );
        totalRows++;
      }
    }

    sqlite.close();

    const databaseCount = parsed.databases.length;
    await appendLog(root, {
      domainSlug: slug,
      type: "books.restored",
      summary: `Restored ${databaseCount} databases (${totalRows} rows) for ${slug}`,
      payload: { domainSlug: slug, databaseCount, rowCount: totalRows },
    });

    return { ok: true, value: { databases: databaseCount, rows: totalRows } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
