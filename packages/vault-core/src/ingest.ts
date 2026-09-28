import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import { createDecision, resolveDecision } from "./decisions.ts";
import {
  getDatabase,
  isDomainLive,
  listRows,
  saveDatabaseFile,
  upsertRow,
} from "./domain-databases.ts";
import {
  type Actor,
  type DatabaseMeta,
  type DecisionRecord,
  type IngestBatch,
  type IngestBatchStatus,
  type IngestColumnMapping,
  type IngestFileResult,
  type IngestMapping,
  type IngestProvenance,
  type IngestRow,
  type IngestRowStatus,
  type IngestSourceKind,
  type MappingWriteResult,
  type Result,
} from "./types.ts";

function isSourceKind(v: string): v is IngestSourceKind {
  return v === "csv" || v === "pdf";
}

function detectSourceKind(mime: string, name: string): IngestSourceKind | null {
  if (mime === "text/csv" || mime === "text/plain" || name.toLowerCase().endsWith(".csv")) {
    return "csv";
  }
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  return null;
}

export function ingestFingerprint(columns: string[]): string {
  const normalized = columns
    .map((c) => c.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((c) => c.length > 0);
  const joined = normalized.join("\n");
  const hash = createHash("sha256").update(joined, "utf8").digest("hex");
  return `sha256:${hash}`;
}

function parseCsvBytes(bytes: Uint8Array): { columns: string[]; rows: Record<string, string>[] } {
  // Strip BOM
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  const text = new TextDecoder("utf-8").decode(bytes.subarray(offset));
  const rawLines = text.split(/\r?\n/);
  // First non-empty line is headers
  let headerLine = "";
  let headerIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i]!.trim();
    if (trimmed.length > 0) {
      headerLine = trimmed;
      headerIdx = i;
      break;
    }
  }
  if (!headerLine) {
    throw new Error("No header row found in CSV");
  }
  const headers = splitCsvLine(headerLine);
  if (headers.length === 0 || headers.every((h) => !h.trim())) {
    throw new Error("No valid header names in CSV");
  }
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line) continue;
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    rows.push(row);
  }
  return { columns: headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

async function ensureIngestTables(sqlitePath: string): Promise<void> {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ingest_batches (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      mapping_id TEXT,
      file_id TEXT NOT NULL,
      file_rel_path TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS ingest_rows (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      cells TEXT NOT NULL,
      source_cells TEXT NOT NULL,
      external_id TEXT,
      provenance TEXT NOT NULL,
      duplicate INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  } finally {
    db.close();
  }
}

async function readMappingFile(
  root: string,
  slug: string,
  mappingId: string,
): Promise<IngestMapping | null> {
  try {
    const filePath = vaultPaths(root).domainMapping(slug, mappingId);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as IngestMapping;
  } catch {
    return null;
  }
}

async function findMappingByFingerprint(
  root: string,
  slug: string,
  databaseId: string,
  fingerprint: string,
): Promise<IngestMapping | null> {
  const dir = vaultPaths(root).domainMappingsDir(slug);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const mappingId = entry.name.replace(/\.json$/, "");
    const mapping = await readMappingFile(root, slug, mappingId);
    if (mapping && mapping.databaseId === databaseId && mapping.fingerprint === fingerprint) {
      return mapping;
    }
  }
  return null;
}

/**
 * KAR-64: exported so the agent tool layer reuses this dedup predicate instead of
 * re-implementing it. The rule keys on `external_id` alone, matching ingest.
 */
export async function lookupExternalId(
  root: string,
  slug: string,
  dbId: string,
  externalId: string,
): Promise<boolean> {
  if (!externalId) return false;
  const res = await listRows(root, slug, dbId);
  if (!res.ok) return false;
  const dbRes = await getDatabase(root, slug, dbId);
  if (!dbRes.ok) return false;
  const dbMeta = dbRes.value;
  const externalIdColId = dbMeta.columns.find(
    (c) => c.name.toLowerCase() === "external_id" || c.id === "external_id",
  )?.id;
  return res.value.some((r) => {
    const cells = r.cells as Record<string, unknown>;
    // Check the external_id column specifically
    if (externalIdColId && cells[externalIdColId] === externalId) return true;
    // Also check literal keys
    if (cells["external_id"] === externalId) return true;
    if (cells["externalid"] === externalId) return true;
    return false;
  });
}

async function openIngestSqlite(root: string, slug: string): Promise<DatabaseSync> {
  const sqlitePath = vaultPaths(root).domainSqlite(slug);
  await ensureIngestTables(sqlitePath);
  const db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode=WAL;");
  return db;
}

export async function ingestFile(
  root: string,
  slug: string,
  input: {
    databaseId: string;
    bytes: Uint8Array;
    mime: string;
    name: string;
    extractedRows?: Record<string, string>[];
    actor: Actor;
  },
): Promise<Result<IngestFileResult>> {
  try {
    // 1. Refuse unknown/archived domain
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }

    // 2. Database must exist
    const dbRes = await getDatabase(root, slug, input.databaseId);
    if (!dbRes.ok) return dbRes;
    const dbMeta: DatabaseMeta = dbRes.value;

    // 3. Copy file first (always, even if parse later fails)
    const fileRes = await saveDatabaseFile(root, slug, {
      bytes: input.bytes,
      mime: input.mime,
      name: input.name,
    });
    if (!fileRes.ok) return fileRes;
    const { relPath, fileId } = fileRes.value;

    // 4. Detect sourceKind
    const sourceKind = detectSourceKind(input.mime, input.name);
    if (!sourceKind) {
      return {
        ok: false,
        error: `Unsupported file type: mime=${input.mime}, name=${input.name}`,
      };
    }

    // 5. Parse or take extractedRows
    let sourceColumns: string[];
    let sourceRows: Record<string, string>[];
    if (sourceKind === "csv") {
      try {
        const parsed = parseCsvBytes(input.bytes);
        sourceColumns = parsed.columns;
        sourceRows = parsed.rows;
      } catch (e) {
        return {
          ok: false,
          error: `Could not parse CSV: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    } else {
      // PDF: must have extractedRows
      const er = input.extractedRows;
      if (!er || !Array.isArray(er) || er.length === 0 || !er.every((r) => r && typeof r === "object")) {
        return {
          ok: false,
          error: "Could not extract rows from PDF",
        };
      }
      const keySet = new Set<string>();
      for (const r of er) {
        for (const k of Object.keys(r)) {
          keySet.add(k);
        }
      }
      sourceColumns = Array.from(keySet);
      sourceRows = er.map((r) => ({ ...r }));
    }

    // 6. Compute fingerprint
    const fingerprint = ingestFingerprint(sourceColumns);

    // 7. Look up mapping
    const existingMapping = await findMappingByFingerprint(
      root,
      slug,
      input.databaseId,
      fingerprint,
    );

    // Build provenance
    const provenance: IngestProvenance = {
      fileId,
      relPath,
      sourceKind,
      mappingId: existingMapping?.id ?? null,
    };

    if (existingMapping) {
      // Map rows to cells
      const externalIdColId = dbMeta.columns.find(
        (c) => c.id === "external_id" || c.name.toLowerCase() === "external_id",
      )?.id;

      const batchId = randomUUID();
      const now = new Date().toISOString();
      const batch: IngestBatch = {
        id: batchId,
        domainSlug: slug,
        databaseId: input.databaseId,
        mappingId: existingMapping.id,
        fileId,
        relPath,
        sourceKind,
        fingerprint,
        status: "staged",
        createdAt: now,
      };

      const colBySource = new Map<string, string>();
      for (const m of existingMapping.columns) {
        if (m.source && m.columnId) colBySource.set(m.source, m.columnId);
      }

      const rows: IngestRow[] = [];
      for (const srcRow of sourceRows) {
        const cells: Record<string, unknown> = {};
        for (const [srcKey, colId] of colBySource.entries()) {
          if (srcKey in srcRow) {
            cells[colId] = srcRow[srcKey];
          }
        }
        // Detect external_id
        let externalId: string | null = null;
        if (externalIdColId && cells[externalIdColId]) {
          externalId = String(cells[externalIdColId]);
        } else if (srcRow["external_id"]) {
          externalId = srcRow["external_id"];
        }
        const duplicate = externalId ? await lookupExternalId(root, slug, input.databaseId, externalId) : false;
        rows.push({
          id: randomUUID(),
          batchId,
          cells,
          sourceCells: srcRow,
          externalId,
          provenance,
          duplicate,
          status: "proposed",
          createdAt: now,
          updatedAt: now,
        });
      }

      // Persist batch + rows to sqlite
      const sqlite = await openIngestSqlite(root, slug);
      try {
        sqlite.prepare(
          "INSERT INTO ingest_batches (id, database_id, mapping_id, file_id, file_rel_path, source_kind, fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          batchId,
          input.databaseId,
          existingMapping.id,
          fileId,
          relPath,
          sourceKind,
          fingerprint,
          "staged",
          now,
        );
        const rowStmt = sqlite.prepare(
          "INSERT INTO ingest_rows (id, batch_id, cells, source_cells, external_id, provenance, duplicate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const r of rows) {
          rowStmt.run(
            r.id,
            r.batchId,
            JSON.stringify(r.cells),
            JSON.stringify(r.sourceCells),
            r.externalId,
            JSON.stringify(r.provenance),
            r.duplicate ? 1 : 0,
            "proposed",
            r.createdAt,
            r.updatedAt,
          );
        }
      } finally {
        sqlite.close();
      }

      return { ok: true, value: { kind: "staged", batch, rows } };
    }

    // 8. No mapping: create a Decision
    const mappingId = randomUUID();
    const now = new Date().toISOString();

    // Default columnId: case-insensitive name match against db columns
    const columns: IngestColumnMapping[] = sourceColumns.map((src) => {
      const match = dbMeta.columns.find((c) => c.name.toLowerCase() === src.trim().toLowerCase());
      return { source: src, columnId: match?.id ?? "" };
    });

    const proposedBody = JSON.stringify({
      id: mappingId,
      databaseId: input.databaseId,
      fingerprint,
      sourceKind,
      columns,
    });

    const decRes = await createDecision(root, {
      target: { type: "mapping", domainSlug: slug, mappingId },
      proposedBodyMarkdown: proposedBody,
      actor: input.actor,
    });
    if (!decRes.ok) return decRes;
    const decision = decRes.value;

    // Create awaiting-mapping batch
    const batchId = randomUUID();
    const batch: IngestBatch = {
      id: batchId,
      domainSlug: slug,
      databaseId: input.databaseId,
      mappingId: null,
      fileId,
      relPath,
      sourceKind,
      fingerprint,
      status: "awaiting-mapping",
      createdAt: now,
    };
    const sqlite = await openIngestSqlite(root, slug);
    try {
      sqlite.prepare(
        "INSERT INTO ingest_batches (id, database_id, mapping_id, file_id, file_rel_path, source_kind, fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        batchId,
        input.databaseId,
        null,
        fileId,
        relPath,
        sourceKind,
        fingerprint,
        "awaiting-mapping",
        now,
      );
    } finally {
      sqlite.close();
    }

    return {
      ok: true,
      value: {
        kind: "needs-mapping",
        fingerprint,
        sourceKind,
        sourceColumns,
        fileId,
        relPath,
        sampleRows: sourceRows.slice(0, 5),
        decision,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function proposeMapping(
  root: string,
  slug: string,
  input: {
    mappingId?: string;
    databaseId: string;
    fingerprint: string;
    sourceKind: IngestSourceKind;
    columns: IngestColumnMapping[];
    actor: Actor;
  },
): Promise<Result<MappingWriteResult>> {
  try {
    const now = new Date().toISOString();
    const mappingId = input.mappingId ?? randomUUID();

    // Validate columns
    const dbRes = await getDatabase(root, slug, input.databaseId);
    if (!dbRes.ok) return dbRes;
    const dbMeta = dbRes.value;
    const colIds = new Set(dbMeta.columns.map((c) => c.id));
    for (const col of input.columns) {
      if (col.columnId && !colIds.has(col.columnId)) {
        return { ok: false, error: `Unknown column id: ${col.columnId}` };
      }
    }

    const mapping: IngestMapping = {
      id: mappingId,
      databaseId: input.databaseId,
      fingerprint: input.fingerprint,
      sourceKind: input.sourceKind,
      columns: input.columns,
      createdAt: now,
      updatedAt: now,
    };

    // Always file a Decision
    const proposedBody = JSON.stringify(mapping);
    const previousBody = input.mappingId
      ? await readMappingFile(root, slug, input.mappingId)
          .then((m) => (m ? JSON.stringify(m) : null))
      : null;

    const decRes = await createDecision(root, {
      target: { type: "mapping", domainSlug: slug, mappingId },
      proposedBodyMarkdown: proposedBody,
      previousBodyMarkdown: previousBody,
      actor: input.actor,
    });
    if (!decRes.ok) return decRes;

    return { ok: true, value: { applied: false, decision: decRes.value } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listMappings(
  root: string,
  slug: string,
  databaseId?: string,
): Promise<Result<IngestMapping[]>> {
  try {
    const dir = vaultPaths(root).domainMappingsDir(slug);
    const mappings: IngestMapping[] = [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return { ok: true, value: [] };
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const mappingId = entry.name.replace(/\.json$/, "");
      const mapping = await readMappingFile(root, slug, mappingId);
      if (mapping && (databaseId === undefined || mapping.databaseId === databaseId)) {
        mappings.push(mapping);
      }
    }
    mappings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, value: mappings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getMapping(
  root: string,
  slug: string,
  mappingId: string,
): Promise<Result<IngestMapping>> {
  try {
    const mapping = await readMappingFile(root, slug, mappingId);
    if (!mapping) return { ok: false, error: `Mapping not found: ${mappingId}` };
    return { ok: true, value: mapping };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listIngestBatches(
  root: string,
  slug: string,
  databaseId?: string,
): Promise<Result<IngestBatch[]>> {
  try {
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: true, value: [] };
    }
    await ensureIngestTables(sqlitePath);
    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = databaseId
        ? (db.prepare("SELECT id, database_id, mapping_id, file_id, file_rel_path, source_kind, fingerprint, status, created_at FROM ingest_batches WHERE database_id = ?").all(databaseId) as Array<{
            id: string;
            database_id: string;
            mapping_id: string | null;
            file_id: string;
            file_rel_path: string;
            source_kind: string;
            fingerprint: string;
            status: string;
            created_at: string;
          }>)
        : (db.prepare("SELECT id, database_id, mapping_id, file_id, file_rel_path, source_kind, fingerprint, status, created_at FROM ingest_batches").all() as Array<{
            id: string;
            database_id: string;
            mapping_id: string | null;
            file_id: string;
            file_rel_path: string;
            source_kind: string;
            fingerprint: string;
            status: string;
            created_at: string;
          }>);
      const batches: IngestBatch[] = rows.map((r) => ({
        id: r.id,
        domainSlug: slug,
        databaseId: r.database_id,
        mappingId: r.mapping_id,
        fileId: r.file_id,
        relPath: r.file_rel_path,
        sourceKind: r.source_kind as IngestSourceKind,
        fingerprint: r.fingerprint,
        status: r.status as IngestBatchStatus,
        createdAt: r.created_at,
      }));
      batches.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { ok: true, value: batches };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listIngestRows(
  root: string,
  slug: string,
  batchId: string,
): Promise<Result<IngestRow[]>> {
  try {
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    try {
      await fs.access(sqlitePath);
    } catch {
      return { ok: true, value: [] };
    }
    await ensureIngestTables(sqlitePath);
    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = db.prepare(
        "SELECT id, batch_id, cells, source_cells, external_id, provenance, duplicate, status, created_at, updated_at FROM ingest_rows WHERE batch_id = ?",
      ).all(batchId) as Array<{
        id: string;
        batch_id: string;
        cells: string;
        source_cells: string;
        external_id: string | null;
        provenance: string;
        duplicate: number;
        status: string;
        created_at: string;
        updated_at: string;
      }>;
      const result: IngestRow[] = rows.map((r) => ({
        id: r.id,
        batchId: r.batch_id,
        cells: JSON.parse(r.cells),
        sourceCells: JSON.parse(r.source_cells),
        externalId: r.external_id,
        provenance: JSON.parse(r.provenance),
        duplicate: r.duplicate !== 0,
        status: r.status as IngestRowStatus,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { ok: true, value: result };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editIngestRow(
  root: string,
  slug: string,
  batchId: string,
  rowId: string,
  cells: Record<string, unknown>,
): Promise<Result<IngestRow>> {
  try {
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    await ensureIngestTables(sqlitePath);
    const db = new DatabaseSync(sqlitePath);
    try {
      const existing = db.prepare("SELECT id, batch_id, cells, source_cells, external_id, provenance, duplicate, status, created_at, updated_at FROM ingest_rows WHERE batch_id = ? AND id = ?").get(batchId, rowId) as
        | {
            id: string;
            batch_id: string;
            cells: string;
            source_cells: string;
            external_id: string | null;
            provenance: string;
            duplicate: number;
            status: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;
      if (!existing) return { ok: false, error: `Row not found: ${rowId}` };
      if (existing.status !== "proposed") {
        return { ok: false, error: `Cannot edit row with status: ${existing.status}` };
      }
      const now = new Date().toISOString();
      const merged: Record<string, unknown> = {
        ...(JSON.parse(existing.cells) as Record<string, unknown>),
        ...cells,
      };
      db.prepare("UPDATE ingest_rows SET cells = ?, updated_at = ? WHERE batch_id = ? AND id = ?").run(
        JSON.stringify(merged),
        now,
        batchId,
        rowId,
      );
      return {
        ok: true,
        value: {
          id: existing.id,
          batchId: existing.batch_id,
          cells: merged,
          sourceCells: JSON.parse(existing.source_cells),
          externalId: existing.external_id,
          provenance: JSON.parse(existing.provenance),
          duplicate: existing.duplicate !== 0,
          status: existing.status as IngestRowStatus,
          createdAt: existing.created_at,
          updatedAt: now,
        },
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function acceptIngestRows(
  root: string,
  slug: string,
  batchId: string,
  rowIds?: string[],
): Promise<Result<{ accepted: number; postedIds: string[] }>> {
  try {
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    await ensureIngestTables(sqlitePath);
    const db = new DatabaseSync(sqlitePath);
    try {
      // Get batch
      const batch = db.prepare("SELECT id, database_id, mapping_id FROM ingest_batches WHERE id = ?").get(batchId) as
        | { id: string; database_id: string; mapping_id: string | null }
        | undefined;
      if (!batch) return { ok: false, error: `Batch not found: ${batchId}` };

      // Get proposed rows
      let rows: Array<{
        id: string;
        batch_id: string;
        cells: string;
        source_cells: string;
        external_id: string | null;
        provenance: string;
        duplicate: number;
        status: string;
        created_at: string;
        updated_at: string;
      }>;
      if (rowIds && rowIds.length > 0) {
        const placeholders = rowIds.map(() => "?").join(",");
        rows = db.prepare(
          `SELECT id, batch_id, cells, source_cells, external_id, provenance, duplicate, status, created_at, updated_at FROM ingest_rows WHERE batch_id = ? AND id IN (${placeholders})`,
        ).all(batchId, ...rowIds) as typeof rows;
        rows = rows.filter((r) => r.status === "proposed");
      } else {
        rows = db.prepare(
          "SELECT id, batch_id, cells, source_cells, external_id, provenance, duplicate, status, created_at, updated_at FROM ingest_rows WHERE batch_id = ? AND status = ?",
        ).all(batchId, "proposed") as typeof rows;
      }

      const now = new Date().toISOString();
      const postedIds: string[] = [];
      const dbMetaRes = await getDatabase(root, slug, batch.database_id);
      if (!dbMetaRes.ok) return dbMetaRes;
      const dbMeta = dbMetaRes.value;
      const externalIdColId = dbMeta.columns.find(
        (c) => c.id === "external_id" || c.name.toLowerCase() === "external_id",
      )?.id;

      for (const row of rows) {
        const cells = JSON.parse(row.cells) as Record<string, unknown>;
        // Ensure external_id is set
        if (row.external_id && externalIdColId) {
          cells[externalIdColId] = row.external_id;
        }
        const upsertRes = await upsertRow(root, slug, batch.database_id, { cells });
        if (!upsertRes.ok) return upsertRes;
        postedIds.push(upsertRes.value.id);
        db.prepare("UPDATE ingest_rows SET status = ?, updated_at = ? WHERE batch_id = ? AND id = ?").run(
          "accepted",
          now,
          batchId,
          row.id,
        );
      }

      // Check if any proposed remain
      const remaining = db.prepare(
        "SELECT COUNT(*) AS cnt FROM ingest_rows WHERE batch_id = ? AND status = ?",
      ).get(batchId, "proposed") as { cnt: number };
      if (remaining.cnt === 0) {
        db.prepare("UPDATE ingest_batches SET status = ? WHERE id = ?").run("accepted", batchId);
      }

      await appendLog(root, {
        domainSlug: slug,
        type: "ingest.accepted",
        summary: `Accepted ${postedIds.length} rows from batch ${batchId}`,
        payload: { batchId, count: postedIds.length },
      });

      return { ok: true, value: { accepted: postedIds.length, postedIds } };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rejectIngestRows(
  root: string,
  slug: string,
  batchId: string,
  rowIds?: string[],
): Promise<Result<{ rejected: number }>> {
  try {
    const sqlitePath = vaultPaths(root).domainSqlite(slug);
    await ensureIngestTables(sqlitePath);
    const db = new DatabaseSync(sqlitePath);
    try {
      let rows: Array<{ id: string; status: string }>;
      if (rowIds && rowIds.length > 0) {
        const placeholders = rowIds.map(() => "?").join(",");
        rows = db.prepare(
          `SELECT id, status FROM ingest_rows WHERE batch_id = ? AND id IN (${placeholders})`,
        ).all(batchId, ...rowIds) as typeof rows;
      } else {
        rows = db.prepare(
          "SELECT id, status FROM ingest_rows WHERE batch_id = ? AND status = ?",
        ).all(batchId, "proposed") as typeof rows;
      }
      const now = new Date().toISOString();
      for (const row of rows) {
        db.prepare("UPDATE ingest_rows SET status = ?, updated_at = ? WHERE batch_id = ? AND id = ?").run(
          "rejected",
          now,
          batchId,
          row.id,
        );
      }

      // Check if any proposed remain
      const remaining = db.prepare(
        "SELECT COUNT(*) AS cnt FROM ingest_rows WHERE batch_id = ? AND status = ?",
      ).get(batchId, "proposed") as { cnt: number };
      if (remaining.cnt === 0) {
        db.prepare("UPDATE ingest_batches SET status = ? WHERE id = ?").run("rejected", batchId);
      }

      return { ok: true, value: { rejected: rows.length } };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
