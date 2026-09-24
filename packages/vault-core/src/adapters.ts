import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./atomic-write.ts";
import { appendLog } from "./log.ts";
import { vaultPaths } from "./paths.ts";
import {
  ADAPTER_KINDS,
  type AdapterKind,
  type AdapterSecretStore,
  type AdapterTransport,
  type DatabaseAdapterBinding,
  type DatabaseMeta,
  type RemotePull,
  type Result,
  type SyncConflict,
  type SyncResult,
  type Actor,
} from "./types.ts";
import { getDatabase, isDomainLive, listRows, upsertRow, deleteRow } from "./domain-databases.ts";
import { createDecision } from "./decisions.ts";
import { ingestFingerprint, proposeMapping } from "./ingest.ts";

function isAdapterKind(v: string): v is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(v);
}

// ─── Sync file helpers ───

interface SyncIndexEntry {
  externalId: string;
  rowId: string;
  lastSyncedRemote: Record<string, string>;
  lastSyncedLocal: Record<string, unknown>;
  updatedAt: string;
}

interface SyncIndexFile {
  entries: Record<string, SyncIndexEntry>;
}

interface SyncQueueItem {
  op: "push" | "delete";
  externalId: string;
  cells?: Record<string, unknown>;
  queuedAt: string;
}

interface SyncQueueFile {
  items: SyncQueueItem[];
}

interface ConflictsFile {
  conflicts: SyncConflict[];
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ─── Mapping helpers ───

async function findMappingForFingerprint(
  root: string,
  slug: string,
  dbId: string,
  fingerprint: string,
): Promise<{ mappingId: string; columns: Array<{ source: string; columnId: string }> } | null> {
  const { listMappings } = await import("./ingest.ts");
  const mappings = await listMappings(root, slug, dbId);
  if (!mappings.ok) return null;
  const mapping = mappings.value.find((m) => m.fingerprint === fingerprint);
  if (!mapping) return null;
  return { mappingId: mapping.id, columns: mapping.columns };
}

// ─── Link / Unlink ───

export async function linkDatabaseAdapter(
  root: string,
  slug: string,
  dbId: string,
  input: {
    kind: AdapterKind;
    bindingId?: string;
    secret: string;
    sotMode: "linked-canonical" | "local-canonical-mirror";
    actor: Actor;
  },
  deps: { secrets: AdapterSecretStore },
): Promise<Result<DatabaseMeta>> {
  try {
    // Validate domain is live
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }

    // Agent actor → operator-only error
    if (input.actor.type === "agent") {
      return { ok: false, error: "Adapter links are operator-only" };
    }

    // Validate sotMode
    if (input.sotMode === "local-only") {
      return { ok: false, error: "Cannot link with local-only SoT mode" };
    }

    // Validate secret
    if (!input.secret || !input.secret.trim()) {
      return { ok: false, error: "Secret is required" };
    }

    // Validate kind
    if (!isAdapterKind(input.kind)) {
      return { ok: false, error: `Unknown adapter kind: ${input.kind}` };
    }

    // For google-sheet and notion, bindingId is required
    if (input.kind !== "url") {
      if (!input.bindingId || !input.bindingId.trim()) {
        return { ok: false, error: `bindingId is required for ${input.kind}` };
      }
    }

    // Get current database meta
    const dbRes = await getDatabase(root, slug, dbId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;

    // If there's an existing adapter, delete its old secret
    if (db.adapter) {
      await deps.secrets.delete(db.adapter.bindingId).catch(() => undefined);
    }

    // For url, generate a UUID bindingId
    const bindingId = input.kind === "url" ? randomUUID() : input.bindingId!;

    // Store the secret
    await deps.secrets.put(bindingId, input.secret);

    // Update registry
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readJsonFile<{ databases: DatabaseMeta[] }>(registryPath, { databases: [] });

    const existing = registry.databases.find((d) => d.id === dbId);
    if (!existing) {
      return { ok: false, error: `Database not found: ${dbId}` };
    }

    const now = new Date().toISOString();
    const binding: DatabaseAdapterBinding = {
      kind: input.kind,
      bindingId,
      mappingId: null,
      lastSyncedAt: null,
    };

    existing.adapter = binding;
    existing.sotMode = input.sotMode;
    existing.updatedAt = now;

    await writeJsonFile(registryPath, registry);

    // Log
    await appendLog(root, {
      domainSlug: slug,
      type: "adapter.linked",
      summary: `Linked ${input.kind} adapter to ${existing.name}`,
      payload: { databaseId: dbId, kind: input.kind, bindingId },
    });

    return { ok: true, value: existing };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unlinkDatabaseAdapter(
  root: string,
  slug: string,
  dbId: string,
  deps: { secrets: AdapterSecretStore },
  actor: Actor,
): Promise<Result<DatabaseMeta>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }

    if (actor.type === "agent") {
      return { ok: false, error: "Adapter links are operator-only" };
    }

    const dbRes = await getDatabase(root, slug, dbId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;

    if (!db.adapter) {
      return { ok: false, error: "Database is not linked" };
    }

    // Delete the secret
    await deps.secrets.delete(db.adapter.bindingId).catch(() => undefined);

    // Update registry
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readJsonFile<{ databases: DatabaseMeta[] }>(registryPath, { databases: [] });

    const existing = registry.databases.find((d) => d.id === dbId);
    if (!existing) {
      return { ok: false, error: `Database not found: ${dbId}` };
    }

    const oldBinding = existing.adapter;
    const now = new Date().toISOString();

    existing.adapter = null;
    existing.sotMode = "local-only";
    existing.updatedAt = now;

    await writeJsonFile(registryPath, registry);

    // Log
    await appendLog(root, {
      domainSlug: slug,
      type: "adapter.unlinked",
      summary: `Unlinked ${oldBinding.kind} adapter from ${existing.name}`,
      payload: { databaseId: dbId, kind: oldBinding.kind, bindingId: oldBinding.bindingId },
    });

    return { ok: true, value: existing };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Sync ───

async function loadSyncIndex(root: string, slug: string): Promise<SyncIndexFile> {
  const paths = vaultPaths(root);
  return readJsonFile<SyncIndexFile>(paths.domainSyncIndex(slug), { entries: {} });
}

async function saveSyncIndex(root: string, slug: string, index: SyncIndexFile): Promise<void> {
  const paths = vaultPaths(root);
  await writeJsonFile(paths.domainSyncIndex(slug), index);
}

async function loadSyncQueue(root: string, slug: string): Promise<SyncQueueFile> {
  const paths = vaultPaths(root);
  return readJsonFile<SyncQueueFile>(paths.domainSyncQueue(slug), { items: [] });
}

async function saveSyncQueue(root: string, slug: string, queue: SyncQueueFile): Promise<void> {
  const paths = vaultPaths(root);
  await writeJsonFile(paths.domainSyncQueue(slug), queue);
}

async function loadConflicts(root: string, slug: string): Promise<ConflictsFile> {
  const paths = vaultPaths(root);
  return readJsonFile<ConflictsFile>(paths.domainConflicts(slug), { conflicts: [] });
}

async function saveConflicts(root: string, slug: string, conflicts: ConflictsFile): Promise<void> {
  const paths = vaultPaths(root);
  await writeJsonFile(paths.domainConflicts(slug), conflicts);
}

export async function syncDatabase(
  root: string,
  slug: string,
  dbId: string,
  deps: {
    secrets: AdapterSecretStore;
    transport: AdapterTransport;
    online: boolean;
  },
): Promise<Result<SyncResult>> {
  try {
    if (!(await isDomainLive(root, slug))) {
      return { ok: false, error: `Domain not found or archived: ${slug}` };
    }

    const dbRes = await getDatabase(root, slug, dbId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;

    if (!db.adapter) {
      return { ok: false, error: "Database is not linked" };
    }

    const result: SyncResult = {
      databaseId: dbId,
      pulled: 0,
      pushed: 0,
      queued: 0,
      conflicts: [],
      warnings: [],
      needsMapping: false,
    };

    // Offline: queue local changes, don't pull
    if (!deps.online) {
      result.offline = true;
      const index = await loadSyncIndex(root, slug);
      const rows = await listRows(root, slug, dbId);
      if (rows.ok) {
        for (const row of rows.value) {
          const entry = index.entries[row.id];
          if (entry) {
            const lastLocal = entry.lastSyncedLocal;
            const currentLocal = row.cells;
            const hasChanged = JSON.stringify(lastLocal) !== JSON.stringify(currentLocal);
            if (hasChanged) {
              const queue = await loadSyncQueue(root, slug);
              queue.items.push({
                op: "push",
                externalId: entry.externalId,
                cells: currentLocal,
                queuedAt: new Date().toISOString(),
              });
              await saveSyncQueue(root, slug, queue);
              result.queued += 1;
            }
          }
        }
      }
      return { ok: true, value: result };
    }

    // Online: pull from remote
    const secret = await deps.secrets.get(db.adapter.bindingId);
    if (!secret) {
      return { ok: false, error: "Adapter secret not found" };
    }

    const pullRes = await deps.transport.pull({
      kind: db.adapter.kind,
      bindingId: db.adapter.bindingId,
      secret,
    });

    if (!pullRes.ok) {
      return { ok: false, error: pullRes.error };
    }

    const pull = pullRes.value;

    if (!pull.columns || pull.columns.length === 0) {
      return { ok: false, error: "Pull returned no columns" };
    }

    // Check mapping
    const fingerprint = ingestFingerprint(pull.columns);

    // Load sync index before mapping check so we can index existing rows
    const index = await loadSyncIndex(root, slug);
    const mapping = await findMappingForFingerprint(root, slug, dbId, fingerprint);

    if (!mapping) {
      // Use proposeMapping to file a mapping Decision
      const columns: Array<{ source: string; columnId: string }> = pull.columns.map((src) => {
        const match = db.columns.find(
          (c) => c.name.toLowerCase() === src.trim().toLowerCase() || c.id === src,
        );
        return { source: src, columnId: match?.id ?? "" };
      });
      const proposeRes = await proposeMapping(root, slug, {
        databaseId: dbId,
        fingerprint,
        sourceKind: db.adapter.kind,
        columns,
        actor: { type: "user" },
      });
      if (!proposeRes.ok) return proposeRes;

      // Create index entries for existing rows so next sync can detect conflicts
      const localRowsForIndex = await listRows(root, slug, dbId);
      if (localRowsForIndex.ok) {
        const eidCol = db.columns.find((c) => c.name === "external_id" || c.id === "external_id");
        for (const row of localRowsForIndex.value) {
          if (!index.entries[row.id]) {
            // Try to find the externalId from the remote rows
            const remoteRow = pull.rows.find((r) => {
              if (eidCol) {
                return r.cells.external_id === (row.cells as Record<string, unknown>)[eidCol.id];
              }
              return false;
            });
            const externalId = remoteRow?.externalId ?? `row:${row.id}`;
            index.entries[row.id] = {
              externalId,
              rowId: row.id,
              lastSyncedRemote: {},
              lastSyncedLocal: row.cells,
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }

      result.needsMapping = true;
      await saveSyncIndex(root, slug, index);
      return { ok: true, value: result };
    }

    // We have a mapping — apply rows
    const conflicts = await loadConflicts(root, slug);

    // Build column map: source → columnId
    const colBySource = new Map<string, string>();
    for (const col of mapping.columns) {
      if (col.source && col.columnId) {
        colBySource.set(col.source, col.columnId);
      }
    }

    // Find external_id column
    const eidCol = db.columns.find((c) => c.name === "external_id" || c.id === "external_id");
    const provCol = db.columns.find((c) => c.name === "provenance" || c.id === "provenance");

    // Map remote rows to column-id-keyed cells with type conversion
    const colById = new Map(db.columns.map((c) => [c.id, c]));
    function convertCell(colId: string, value: string): unknown {
      const col = colById.get(colId);
      if (!col) return value;
      if (col.type === "number") {
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
      }
      return value;
    }

    const mappedRemoteCells: Record<string, Record<string, unknown>> = {};
    for (const row of pull.rows) {
      const cells: Record<string, unknown> = {};
      for (const [src, colId] of colBySource.entries()) {
        if (src in row.cells) {
          cells[colId] = convertCell(colId, row.cells[src]);
        }
      }
      mappedRemoteCells[row.externalId] = cells;
    }

    // Load all local rows once
    const localRows = await listRows(root, slug, dbId);
    if (!localRows.ok) return localRows;

    // Build externalId → rowId map from sync index (works even without external_id column)
    const rowIdByExternalId = new Map<string, string>();
    for (const [rowId, entry] of Object.entries(index.entries)) {
      rowIdByExternalId.set(entry.externalId, rowId);
    }
    // Also check sqlite for external_id column values
    if (eidCol) {
      for (const row of localRows.value) {
        const eid = (row.cells as Record<string, unknown>)[eidCol.id];
        if (typeof eid === "string" && eid) {
          rowIdByExternalId.set(eid, row.id);
        }
      }
    }

    // Track seen external ids for duplicate detection
    const seenExternalIds = new Set<string>();

    for (const row of pull.rows) {
      const externalId = row.externalId;

      // Duplicate detection
      if (seenExternalIds.has(externalId)) {
        result.warnings.push(`duplicate external_id ${externalId}`);
        continue;
      }
      seenExternalIds.add(externalId);

      const remoteCells = mappedRemoteCells[externalId];
      const existingRowId = rowIdByExternalId.get(externalId);

      if (existingRowId) {
        // Existing row — check for changes
        const existingRow = localRows.value.find((r) => r.id === existingRowId);
        if (!existingRow) continue;

        const localCells = existingRow.cells as Record<string, unknown>;
        const indexEntry = index.entries[existingRowId];

        if (!indexEntry) {
          // First sync for this row — adopt remote values, record baseline
          const mergedCells = { ...localCells, ...remoteCells };
          if (eidCol) mergedCells[eidCol.id] = externalId;
          if (provCol) mergedCells[provCol.id] = `${db.adapter.kind}:${db.adapter.bindingId}`;
          await upsertRow(root, slug, dbId, { id: existingRowId, cells: mergedCells });
          index.entries[existingRowId] = {
            externalId,
            rowId: existingRowId,
            lastSyncedRemote: remoteCells,
            lastSyncedLocal: mergedCells,
            updatedAt: new Date().toISOString(),
          };
          result.pulled += 1;
          continue;
        }

        const lastRemote = indexEntry.lastSyncedRemote ?? {};
        const lastLocal = indexEntry.lastSyncedLocal ?? {};

        // Compare: remote changed?
        const remoteChanged = cellsChanged(lastRemote, remoteCells);
        // Compare: local changed?
        const localChanged = cellsChanged(lastLocal, localCells);

        if (remoteChanged && localChanged) {
          // Conflict — find which fields changed on both sides with different values
          const conflictFields: string[] = [];
          for (const colId of Object.keys(remoteCells)) {
            const remoteVal = remoteCells[colId];
            const lastRemoteVal = (lastRemote as Record<string, string>)[colId];
            const localVal = localCells[colId];
            const lastLocalVal = (lastLocal as Record<string, unknown>)[colId];
            // Conflict only if both changed AND values differ
            if (remoteVal !== lastRemoteVal && localVal !== lastLocalVal && remoteVal !== localVal) {
              conflictFields.push(colId);
            }
          }

          if (conflictFields.length > 0) {
            const defaultChoice = db.sotMode === "linked-canonical" ? "keep-remote" : "keep-local";
            const conflict: SyncConflict = {
              id: randomUUID(),
              databaseId: dbId,
              externalId,
              rowId: existingRowId,
              localCells: localCells,
              remoteCells,
              fields: conflictFields,
              defaultChoice,
            };
            conflicts.conflicts.push(conflict);
            continue;
          }
        }

        if (remoteChanged && !localChanged) {
          // Remote-only change: write remote into sqlite (linked-canonical)
          if (db.sotMode === "linked-canonical") {
            await upsertRow(root, slug, dbId, {
              id: existingRowId,
              cells: remoteCells as Record<string, unknown>,
            });
          }
          index.entries[existingRowId] = {
            externalId,
            rowId: existingRowId,
            lastSyncedRemote: remoteCells,
            lastSyncedLocal: remoteCells,
            updatedAt: new Date().toISOString(),
          };
          result.pulled += 1;
        } else if (localChanged && !remoteChanged) {
          // Local-only change: push to remote (mirror)
          if (db.sotMode === "local-canonical-mirror") {
            const pushRes = await deps.transport.pushRow({
              kind: db.adapter.kind,
              bindingId: db.adapter.bindingId,
              secret,
              externalId,
              cells: localCells as Record<string, string>,
            });
            if (pushRes.ok) {
              result.pushed += 1;
            }
          }
          index.entries[existingRowId] = {
            externalId,
            rowId: existingRowId,
            lastSyncedRemote: remoteCells,
            lastSyncedLocal: localCells,
            updatedAt: new Date().toISOString(),
          };
        }
      } else {
        // New external id — insert
        const cellsToInsert: Record<string, unknown> = { ...remoteCells };
        if (eidCol) cellsToInsert[eidCol.id] = externalId;
        if (provCol) cellsToInsert[provCol.id] = `${db.adapter.kind}:${db.adapter.bindingId}`;

        const insertRes = await upsertRow(root, slug, dbId, { cells: cellsToInsert });
        if (insertRes.ok) {
          index.entries[insertRes.value.id] = {
            externalId,
            rowId: insertRes.value.id,
            lastSyncedRemote: remoteCells,
            lastSyncedLocal: cellsToInsert,
            updatedAt: new Date().toISOString(),
          };
          result.pulled += 1;
        }
      }
    }

    // Flush offline queue after pull (so conflicts are detected first)
    const queue = await loadSyncQueue(root, slug);
    if (queue.items.length > 0) {
      // Build externalId → rowId map from the in-memory sync index
      const rowIdByExternalId = new Map<string, string>();
      for (const [rowId, entry] of Object.entries(index.entries)) {
        rowIdByExternalId.set(entry.externalId, rowId);
      }
      const remainingItems: SyncQueueItem[] = [];
      for (const item of queue.items) {
        const rowId = rowIdByExternalId.get(item.externalId);
        if (!rowId) {
          remainingItems.push(item);
          continue;
        }
        // Check if this row has a conflict recorded during pull processing
        const hasConflict = conflicts.conflicts.some((c) => c.externalId === item.externalId);
        if (hasConflict) {
          remainingItems.push(item);
          continue;
        }
        if (item.op === "push" && item.cells) {
          const pushRes = await deps.transport.pushRow({
            kind: db.adapter.kind,
            bindingId: db.adapter.bindingId,
            secret,
            externalId: item.externalId,
            cells: item.cells as Record<string, string>,
          });
          if (pushRes.ok) {
            result.pushed += 1;
          } else {
            remainingItems.push(item);
          }
        } else if (item.op === "delete") {
          const delRes = await deps.transport.deleteRow({
            kind: db.adapter.kind,
            bindingId: db.adapter.bindingId,
            secret,
            externalId: item.externalId,
          });
          if (delRes.ok) {
            result.pushed += 1;
          } else {
            remainingItems.push(item);
          }
        }
      }
      queue.items = remainingItems;
      await saveSyncQueue(root, slug, queue);
    }

    // URL FX
    if (db.adapter.kind === "url" && pull.fx && typeof pull.fx.usdZarRate === "number" && Number.isFinite(pull.fx.usdZarRate) && pull.fx.asOf) {
      const registryPath = vaultPaths(root).domainRegistry("financial");
      const registry = await readJsonFile<{ finance?: { usdZarRate: number | null; usdZarAsOf: string | null } }>(registryPath, {});
      if (!registry.finance) {
        registry.finance = { usdZarRate: null, usdZarAsOf: null };
      }
      registry.finance.usdZarRate = pull.fx.usdZarRate;
      registry.finance.usdZarAsOf = pull.fx.asOf;
      await writeJsonFile(registryPath, registry);
    }

    // Save sync state
    await saveSyncIndex(root, slug, index);
    await saveConflicts(root, slug, conflicts);
    await saveSyncQueue(root, slug, queue);

    // Update adapter lastSyncedAt
    const paths = vaultPaths(root);
    const registryPath = paths.domainRegistry(slug);
    const registry = await readJsonFile<{ databases: DatabaseMeta[] }>(registryPath, { databases: [] });
    const existing = registry.databases.find((d) => d.id === dbId);
    if (existing && existing.adapter) {
      existing.adapter.lastSyncedAt = new Date().toISOString();
      await writeJsonFile(registryPath, registry);
    }

    result.conflicts = conflicts.conflicts;
    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function cellsChanged(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
}

export async function syncLinkedDatabases(
  root: string,
  slug: string | null,
  deps: {
    secrets: AdapterSecretStore;
    transport: AdapterTransport;
    online: boolean;
  },
): Promise<Result<SyncResult[]>> {
  try {
    const { listDatabases } = await import("./domain-databases.ts");
    const dbs = await listDatabases(root, slug);
    if (!dbs.ok) return dbs;

    const results: SyncResult[] = [];

    for (const entry of dbs.value) {
      if (!entry.database.adapter) continue;

      const res = await syncDatabase(root, entry.domainSlug, entry.database.id, deps);
      if (res.ok) {
        results.push(res.value);
      } else {
        results.push({
          databaseId: entry.database.id,
          error: res.error,
          pulled: 0,
          pushed: 0,
          queued: 0,
          conflicts: [],
          warnings: [],
          needsMapping: false,
        });
      }
    }

    return { ok: true, value: results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Conflicts ───

export async function listSyncConflicts(
  root: string,
  slug: string,
  dbId?: string,
): Promise<Result<SyncConflict[]>> {
  try {
    const conflicts = await loadConflicts(root, slug);
    if (dbId) {
      return { ok: true, value: conflicts.conflicts.filter((c) => c.databaseId === dbId) };
    }
    return { ok: true, value: conflicts.conflicts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function resolveSyncConflict(
  root: string,
  slug: string,
  conflictId: string,
  choice: "keep-local" | "keep-remote" | "skip",
  deps: {
    secrets: AdapterSecretStore;
    transport: AdapterTransport;
    online: boolean;
  },
): Promise<Result<SyncConflict | null>> {
  try {
    const conflicts = await loadConflicts(root, slug);
    const idx = conflicts.conflicts.findIndex((c) => c.id === conflictId);
    if (idx === -1) {
      return { ok: false, error: `Conflict not found: ${conflictId}` };
    }

    const conflict = conflicts.conflicts[idx]!;
    const dbRes = await getDatabase(root, slug, conflict.databaseId);
    if (!dbRes.ok) return dbRes;
    const db = dbRes.value;

    if (!db.adapter) {
      return { ok: false, error: "Database is not linked" };
    }

    const secret = await deps.secrets.get(db.adapter.bindingId);
    if (!secret) {
      return { ok: false, error: "Adapter secret not found" };
    }

    const index = await loadSyncIndex(root, slug);

    if (choice === "keep-remote") {
      // Write remote cells into sqlite
      if (conflict.rowId) {
        await upsertRow(root, slug, conflict.databaseId, {
          id: conflict.rowId,
          cells: conflict.remoteCells as Record<string, unknown>,
        });
      }
      // Update index
      if (conflict.rowId && index.entries[conflict.rowId]) {
        index.entries[conflict.rowId] = {
          ...index.entries[conflict.rowId]!,
          lastSyncedRemote: conflict.remoteCells,
          lastSyncedLocal: conflict.remoteCells,
          updatedAt: new Date().toISOString(),
        };
      }
      await saveSyncIndex(root, slug, index);
    } else if (choice === "keep-local") {
      // Push local cells when online
      if (!deps.online) {
        return { ok: false, error: "Cannot push while offline" };
      }
      const pushRes = await deps.transport.pushRow({
        kind: db.adapter.kind,
        bindingId: db.adapter.bindingId,
        secret,
        externalId: conflict.externalId,
        cells: conflict.localCells as Record<string, string>,
      });
      if (!pushRes.ok) {
        return { ok: false, error: pushRes.error };
      }
      // Update index
      if (conflict.rowId && index.entries[conflict.rowId]) {
        index.entries[conflict.rowId] = {
          ...index.entries[conflict.rowId]!,
          lastSyncedRemote: conflict.remoteCells,
          lastSyncedLocal: conflict.localCells,
          updatedAt: new Date().toISOString(),
        };
      }
      await saveSyncIndex(root, slug, index);
    } else if (choice === "skip") {
      // Update index so same pair doesn't re-conflict
      if (conflict.rowId && index.entries[conflict.rowId]) {
        index.entries[conflict.rowId] = {
          ...index.entries[conflict.rowId]!,
          lastSyncedRemote: conflict.remoteCells,
          lastSyncedLocal: conflict.localCells,
          updatedAt: new Date().toISOString(),
        };
      }
      await saveSyncIndex(root, slug, index);
    }

    // Remove conflict
    conflicts.conflicts.splice(idx, 1);
    await saveConflicts(root, slug, conflicts);

    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
