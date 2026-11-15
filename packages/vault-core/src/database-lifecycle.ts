/**
 * Database lifecycle: the two destructive, Decision-gated database operations.
 *
 * `delete_database` and `merge_databases` (2026-11-15) exist because the only
 * database tools were row-shaped: the companion could add a row but could not
 * collapse the four duplicate "Supplement log" tables it had minted, and the
 * operator had no surface to do it from either. LAWS/DATABASES.md is the rule
 * they obey: a change to, or deletion of, data that already exists MUST appear
 * as a pending Decision and MUST NOT land until the operator approves it.
 *
 * This module is the half both sides share. `database-tools.ts` calls it to
 * describe what a proposal would do (the guards, the fingerprint, the merge's
 * column plan); `decisions.ts` calls it on approval to re-do those checks
 * against the vault as it stands and then write. It deliberately imports
 * neither of them — the tools and the approval queue both import this, so a
 * dependency back would be a cycle — and it knows nothing about tool argument
 * parsing or Decision records.
 *
 * Two rules hold everywhere here:
 *
 *  1. Every refusal is about the vault's state, not about a call. The same
 *     inputs on the same vault give the same answer, which is why the apply path
 *     can record a refusal as terminal instead of leaving the Decision pending
 *     forever (`isTerminalDatabaseLifecycleError`).
 *  2. Nothing writes until the whole operation has been re-checked. The propose
 *     path writes nothing at all; the apply path adds columns, widens options,
 *     moves rows and deletes sources in that order, so a failure leaves the
 *     sources intact until the move itself commits.
 */
import { createHash } from "node:crypto";
import {
  addDatabaseColumn,
  deleteDatabase,
  getDatabase,
  insertMovedRows,
  listDatabases,
  listRows,
  updateDatabaseColumnOptions,
} from "./domain-databases.ts";
import { appendLog } from "./log.ts";
import { listViews } from "./views.ts";
import {
  FINANCE_DB_IDS,
  FINANCE_DOMAIN_SLUG,
  type Actor,
  type DatabaseColumn,
  type DatabaseColumnSignature,
  type DatabaseColumnSpec,
  type DatabaseDecisionBody,
  type DatabaseMergeSource,
  type DatabaseMeta,
  type Result,
} from "./types.ts";

/** The maximum number of source databases one merge may collapse. */
export const MERGE_SOURCES_MAX = 20;

/** Column names are matched the way the operator reads a header row. */
function columnKey(name: string): string {
  return name.trim().toLowerCase();
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A finance kit database is the kit's, not the operator's or the agent's.
 *
 * In `database-lifecycle.ts` rather than in the tools because both the propose
 * path and the apply path refuse it, and one predicate in one place is what
 * keeps the two from disagreeing about which databases are untouchable.
 */
export function isFinanceDatabase(domainSlug: string, databaseId: string): boolean {
  return (
    domainSlug === FINANCE_DOMAIN_SLUG &&
    (Object.values(FINANCE_DB_IDS) as string[]).includes(databaseId)
  );
}

/**
 * The staleness guard's digest: sha256 over each row's (id, updatedAt), ordered
 * by id, plus the row count.
 *
 * A row added, removed or edited changes one of the two, and the apply path
 * compares both. `updatedAt` alone would miss a delete, an id alone would miss
 * an edit, and the count is checked separately so the message can tell the
 * operator how big the table is now.
 */
export async function databaseRowFingerprint(
  root: string,
  domainSlug: string,
  databaseId: string,
): Promise<Result<{ fingerprint: string; rowCount: number }>> {
  const listed = await listRows(root, domainSlug, databaseId);
  if (!listed.ok) return { ok: false, error: listed.error };
  const rows = [...listed.value]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => [row.id, row.updatedAt] as const);
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { ok: true, value: { fingerprint, rowCount: listed.value.length } };
}

/**
 * The schema half of a merge's staleness guard: id, name and type per column.
 *
 * Options are deliberately absent. A merge widens a select's options by design,
 * so a widening in the target is not a schema change to refuse; a column that
 * was renamed, retyped, added or removed is.
 */
export function readDatabaseColumnSignature(meta: DatabaseMeta): DatabaseColumnSignature[] {
  return meta.columns.map((column) => ({
    id: column.id,
    name: column.name,
    type: column.type,
  }));
}

/**
 * One key for a column signature, order-insensitive by id.
 *
 * Two reads of one schema must produce the same key whatever order the registry
 * stored the columns in, so the columns are sorted by id before joining. The
 * `|` inside a triple is safe: ids are uuids, names are operator text, and types
 * are a closed set — a name containing `|` cannot forge another column's triple
 * because the triple is still one line, and lines are compared whole.
 */
export function columnSignatureKey(
  columns: ReadonlyArray<DatabaseColumnSignature>,
): string {
  return [...columns]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((column) => `${column.id}|${column.name}|${column.type}`)
    .join("\n");
}

/**
 * The column plan a merge applies, derived from the two schemas by NAME.
 *
 * `columnMap` is flat and keyed by source column id: ids are uuids, so one map
 * covers every source. `targetColumnId` is null exactly when the column does not
 * exist in the target yet — `add` then carries the spec that will create it, and
 * the apply resolves the freshly minted target id by name after adding. Two
 * sources declaring the same new name share one `add` spec, so the target grows
 * the column once.
 */
export type MergePlan = {
  columnMap: Array<{
    sourceColumnId: string;
    targetColumnId: string | null;
    add?: DatabaseColumnSpec;
  }>;
  newColumns: DatabaseColumnSpec[];
  widenedColumns: Array<{ columnId: string; options: string[] }>;
};

/**
 * Derive the merge plan: which source column lands in which target column, which
 * target columns the merge must create, and which select columns it must widen.
 *
 * Everything that makes the move lossy is refused here, with a message the
 * operator can act on: a type conflict between same-named columns, a relation
 * column pointing somewhere else, two sources disagreeing about a new column's
 * type, a duplicate column name that makes the mapping ambiguous, or a new
 * relation column whose target is one of the databases this merge deletes.
 */
export async function planDatabaseMerge(
  root: string,
  domainSlug: string,
  target: DatabaseMeta,
  sources: DatabaseMeta[],
): Promise<Result<MergePlan>> {
  const plan: MergePlan = { columnMap: [], newColumns: [], widenedColumns: [] };

  // A target with two columns of one name cannot be a mapping destination: the
  // operator would get the values in one of them and no way to tell which.
  const targetByName = new Map<string, DatabaseColumn>();
  for (const column of target.columns) {
    const key = columnKey(column.name);
    if (!key) continue;
    if (targetByName.has(key)) {
      return {
        ok: false,
        error:
          `Column "${column.name.trim()}": the target database "${target.name}" has more ` +
          "than one column with that name. Rename one before merging.",
      };
    }
    targetByName.set(key, column);
  }

  /** Target select options as the union of every source's choices. */
  const widened = new Map<string, Set<string>>();
  /** New target columns, deduped by name across every source. */
  const newByKey = new Map<string, { spec: DatabaseColumnSpec; sourceName: string }>();

  for (const source of sources) {
    const seenInSource = new Set<string>();
    for (const column of source.columns) {
      const key = columnKey(column.name);
      if (!key) continue;
      // A self-relation cannot survive the move: the merge re-mints every source
      // row's id, so each cell that pointed at another row of the SAME source
      // would point at nothing afterwards. The reference guards skip a database
      // referencing itself (`other.id === databaseId`), so this is the only place
      // that catches it.
      if (column.type === "relation" && column.relationDatabaseId === source.id) {
        return {
          ok: false,
          error:
            `Column "${column.name.trim()}": it relates rows inside "${source.name}" itself, ` +
            "and moving those rows mints new ids. Remove that relation column before merging.",
        };
      }
      if (seenInSource.has(key)) {
        return {
          ok: false,
          error:
            `Column "${column.name.trim()}": the source database "${source.name}" has more ` +
            "than one column with that name. Rename one before merging.",
        };
      }
      seenInSource.add(key);

      const matching = targetByName.get(key);
      if (matching) {
        if (matching.type !== column.type) {
          return {
            ok: false,
            error:
              `Column "${column.name.trim()}": it is ${column.type} in "${source.name}" but ` +
              `${matching.type} in "${target.name}". A merge cannot change a column's type, ` +
              "so rename one of them before merging.",
          };
        }
        if (column.type === "relation" && matching.relationDatabaseId !== column.relationDatabaseId) {
          return {
            ok: false,
            error:
              `Column "${column.name.trim()}": it points at different relation targets in ` +
              `"${source.name}" and "${target.name}". One relation column cannot mean two ` +
              "tables; give them different names before merging.",
          };
        }
        if (column.type === "select") {
          const union = widened.get(matching.id) ?? new Set(matching.options ?? []);
          for (const option of column.options ?? []) union.add(option);
          widened.set(matching.id, union);
        }
        plan.columnMap.push({ sourceColumnId: column.id, targetColumnId: matching.id });
        continue;
      }

      const alreadyPlanned = newByKey.get(key);
      if (alreadyPlanned) {
        if (alreadyPlanned.spec.type !== column.type) {
          return {
            ok: false,
            error:
              `Column "${column.name.trim()}": it is ${alreadyPlanned.spec.type} in ` +
              `"${alreadyPlanned.sourceName}" but ${column.type} in "${source.name}". Two ` +
              "sources cannot create one column with two types; rename one before merging.",
          };
        }
        if (
          column.type === "relation" &&
          alreadyPlanned.spec.relationDatabaseId !== column.relationDatabaseId
        ) {
          return {
            ok: false,
            error:
              `Column "${column.name.trim()}": it points at different relation targets in ` +
              `"${alreadyPlanned.sourceName}" and "${source.name}". One relation column cannot ` +
              "mean two tables; give them different names before merging.",
          };
        }
        if (column.type === "select") {
          const union = new Set(alreadyPlanned.spec.options ?? []);
          for (const option of column.options ?? []) union.add(option);
          alreadyPlanned.spec.options = [...union];
        }
        // Both sources fill the same new target column; the spec object is
        // shared, so the option union above is already visible through it.
        plan.columnMap.push({
          sourceColumnId: column.id,
          targetColumnId: null,
          add: alreadyPlanned.spec,
        });
        continue;
      }

      const spec: DatabaseColumnSpec = { name: column.name.trim(), type: column.type };
      if (column.type === "select") spec.options = [...new Set(column.options ?? [])];
      if (column.type === "relation" && column.relationDatabaseId) {
        spec.relationDatabaseId = column.relationDatabaseId;
      }
      newByKey.set(key, { spec, sourceName: source.name });
      plan.newColumns.push(spec);
      plan.columnMap.push({ sourceColumnId: column.id, targetColumnId: null, add: spec });
    }
  }

  // A new relation column must point at a database that outlives the merge. The
  // sources are deleted, and their rows are re-minted under new ids when they
  // move, so a relation onto one would be born dangling — and a relation onto a
  // database outside this area cannot be created at all.
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const spec of plan.newColumns) {
    if (spec.type !== "relation" || !spec.relationDatabaseId) continue;
    if (sourceIds.has(spec.relationDatabaseId)) {
      return {
        ok: false,
        error:
          `Column "${spec.name}": its relation target is another database in this merge, and ` +
          "that database is deleted by it. Remove the relation column from the source first.",
      };
    }
    const relation = await getDatabase(root, domainSlug, spec.relationDatabaseId);
    if (!relation.ok) {
      return {
        ok: false,
        error:
          `Column "${spec.name}": relation target not found in this domain: ` +
          spec.relationDatabaseId,
      };
    }
  }

  // Only a select whose choices actually grew needs rewriting; an unchanged (or
  // narrowed) union is already what the target stores.
  plan.widenedColumns = [...widened.entries()]
    .map(([columnId, options]) => ({ columnId, options: [...options] }))
    .filter(({ columnId, options }) => {
      const targetColumn = target.columns.find((column) => column.id === columnId);
      const current = new Set(targetColumn?.options ?? []);
      return options.some((option) => !current.has(option));
    });

  return { ok: true, value: plan };
}

/**
 * Why this database cannot be deleted or merged at all, or null when it can.
 *
 * The guards are the operator's: a linked replica would resurrect, the Finance
 * kit owns its tables, another database's relation column would dangle, and a
 * saved dashboard card would go blank. Each message names what has to be removed
 * first, because the agent relaying it has no radio button to press.
 *
 * `references: false` asks the adapter/kit half only. A MERGE target is not being
 * deleted, so a relation column or a saved view onto it stays valid after the
 * merge — refusing those would block collapsing duplicates into the very table
 * the operator's dashboard already reads. That asymmetry is deliberate: the
 * source checks are about what disappears, and the target checks are about what
 * must not be written to.
 */
export async function describeDatabaseLifecycleRefusal(
  root: string,
  domainSlug: string,
  databaseId: string,
  opts?: { references?: boolean },
): Promise<string | null> {
  const db = await getDatabase(root, domainSlug, databaseId);
  // A missing database is the caller's NOT_FOUND, not a lifecycle refusal: it
  // has its own explanation, and naming it here would turn a lookup miss into a
  // "remove something first" instruction.
  if (!db.ok) return null;
  const meta = db.value;

  if (meta.adapter !== null) {
    return (
      `A database linked to an outside source cannot be deleted or merged: "${meta.name}". ` +
      "Unlink the adapter first — a deleted local replica would come back on the next sync."
    );
  }
  if (isFinanceDatabase(domainSlug, databaseId)) {
    return `The Finance kit owns "${meta.name}"; it cannot be deleted or merged.`;
  }
  if (opts?.references === false) return null;

  // Another database in this area whose relation column points at this one. The
  // area is the unit because a relation cannot cross areas.
  const listed = await listDatabases(root, domainSlug);
  const databases = listed.ok ? listed.value.map((entry) => entry.database) : [];
  const referrers: string[] = [];
  for (const other of databases) {
    if (other.id === databaseId) continue;
    for (const column of other.columns) {
      if (column.type === "relation" && column.relationDatabaseId === databaseId) {
        referrers.push(`"${other.name}"."${column.name}"`);
      }
    }
  }
  if (referrers.length > 0) {
    return (
      `The database "${meta.name}" is the target of ` +
      `${plural(referrers.length, "a relation column", "relation columns")}: ` +
      `${referrers.join(", ")}. Remove ` +
      `${referrers.length === 1 ? "the relation column" : "the relation columns"} first.`
    );
  }

  // A saved dashboard card bound to this database, at the root of a spec or as a
  // composed view's block. A read failure is not evidence of a reference: it is
  // left to the apply path, which runs against a live domain, rather than
  // refusing a legitimate deletion because a directory could not be listed.
  const views = await listViews(root, domainSlug);
  if (views.ok) {
    const titles: string[] = [];
    for (const view of views.value) {
      const referencesRoot = view.databaseId === databaseId;
      const referencesBlock =
        Array.isArray(view.blocks) &&
        view.blocks.some((block) => block && block.databaseId === databaseId);
      if (referencesRoot || referencesBlock) titles.push(`"${view.title}"`);
    }
    if (titles.length > 0) {
      return (
        `A saved view reads from the database "${meta.name}": ${titles.join(", ")}. ` +
        `Delete or repoint ${titles.length === 1 ? "that card" : "those cards"} first.`
      );
    }
  }

  return null;
}

/**
 * Apply an approved database deletion.
 *
 * Everything the propose path checked is checked again here, because the card
 * can sit in the inbox for days: the guards may now hold, and the fingerprint
 * tells us whether the operator is still approving the table they saw. Then the
 * engine deletes the rows and the registry entry and writes the Life log line.
 *
 * `domainSlugs` is the Decision's own area list; the engine logs under the
 * database's area, so a target outside that list would be a record the operator
 * never saw the card in, and applying it is refused rather than written.
 */
export async function applyDatabaseDelete(
  root: string,
  domainSlug: string,
  databaseId: string,
  domainSlugs: string[],
  body: DatabaseDecisionBody,
  actor: Actor,
): Promise<Result<void>> {
  if (!domainSlugs.includes(domainSlug)) {
    return {
      ok: false,
      error: `Decision does not cover the database's area: ${domainSlug}`,
    };
  }

  const db = await getDatabase(root, domainSlug, databaseId);
  if (!db.ok) return { ok: false, error: db.error };

  const refusal = await describeDatabaseLifecycleRefusal(root, domainSlug, databaseId);
  if (refusal) return { ok: false, error: refusal };

  if (typeof body.fingerprint !== "string" || !body.fingerprint) {
    return {
      ok: false,
      error: "The delete proposal is missing the row fingerprint it was filed with",
    };
  }
  const current = await databaseRowFingerprint(root, domainSlug, databaseId);
  if (!current.ok) return { ok: false, error: current.error };
  const countChanged =
    typeof body.rowCount === "number" && body.rowCount !== current.value.rowCount;
  if (countChanged || body.fingerprint !== current.value.fingerprint) {
    return {
      ok: false,
      error:
        `Database changed since this was proposed (it now has ${current.value.rowCount} rows). ` +
        "Re-read it and propose again.",
    };
  }

  const removed = await deleteDatabase(root, domainSlug, databaseId, actor);
  if (!removed.ok) return { ok: false, error: removed.error };
  return { ok: true, value: undefined };
}

/**
 * Apply an approved merge: add the missing columns, widen the select options,
 * move every source row into the target, then delete the sources.
 *
 * Order is the contract. Columns and options land before the rows need them
 * (`validateCells` would reject a select value the target does not offer), the
 * rows move in one sqlite transaction, and only a committed move deletes the
 * sources. A failure before the move leaves the sources whole; a failure after
 * it cannot lose rows, only leave some source registries to delete by hand — the
 * row guard is what guarantees the move itself saw every row it was promised.
 *
 * The guards are re-run against the vault as it stands, exactly as the delete's
 * are: the asymmetry from `describeDatabaseLifecycleRefusal` applies here too —
 * adapter/kit for the target and every source, references for the sources only.
 */
export async function applyDatabaseMerge(
  root: string,
  domainSlug: string,
  targetDatabaseId: string,
  sourceDatabaseIds: string[],
  body: DatabaseDecisionBody,
  actor: Actor,
): Promise<Result<{ moved: number; skipped: number }>> {
  const proposals = new Map<string, DatabaseMergeSource>();
  for (const entry of body.sources ?? []) {
    if (entry && typeof entry.databaseId === "string") proposals.set(entry.databaseId, entry);
  }
  if (sourceDatabaseIds.length === 0) {
    return { ok: false, error: "The merge proposal names no source database" };
  }
  if (sourceDatabaseIds.includes(targetDatabaseId)) {
    return { ok: false, error: "A database cannot be merged into itself" };
  }

  const target = await getDatabase(root, domainSlug, targetDatabaseId);
  if (!target.ok) return { ok: false, error: target.error };

  const targetRefusal = await describeDatabaseLifecycleRefusal(
    root,
    domainSlug,
    targetDatabaseId,
    { references: false },
  );
  if (targetRefusal) return { ok: false, error: targetRefusal };

  const sourceMetas: DatabaseMeta[] = [];
  for (const sourceId of sourceDatabaseIds) {
    const meta = await getDatabase(root, domainSlug, sourceId);
    if (!meta.ok) return { ok: false, error: meta.error };
    const refusal = await describeDatabaseLifecycleRefusal(root, domainSlug, sourceId);
    if (refusal) return { ok: false, error: refusal };
    sourceMetas.push(meta.value);
  }

  // Staleness, source by source: the rows (fingerprint + count) and the schema
  // (the columns the proposal named) both have to be what the operator saw.
  for (const meta of sourceMetas) {
    const proposal = proposals.get(meta.id);
    if (!proposal) {
      return {
        ok: false,
        error: `The merge proposal is missing the fingerprint for "${meta.name}"`,
      };
    }
    const current = await databaseRowFingerprint(root, domainSlug, meta.id);
    if (!current.ok) return { ok: false, error: current.error };
    if (
      current.value.rowCount !== proposal.rowCount ||
      current.value.fingerprint !== proposal.fingerprint
    ) {
      return {
        ok: false,
        error:
          `Database changed since this was proposed (it now has ${current.value.rowCount} rows). ` +
          "Re-read it and propose again.",
      };
    }
    if (
      columnSignatureKey(readDatabaseColumnSignature(meta)) !==
      columnSignatureKey(proposal.columns ?? [])
    ) {
      return {
        ok: false,
        error:
          `The columns of "${meta.name}" changed since this was proposed. ` +
          "Re-read it and propose again.",
      };
    }
  }

  // The target's rows may have grown — a merge is additive, and added rows must
  // not cost the operator a re-propose. Its SCHEMA may not: the column plan below
  // is derived from it, and a column added, renamed or retyped since the card was
  // filed would move rows into a shape nobody approved.
  if (!Array.isArray(body.expectedColumns)) {
    return {
      ok: false,
      error: "The merge proposal is missing the target schema it was filed with",
    };
  }
  if (
    columnSignatureKey(readDatabaseColumnSignature(target.value)) !==
    columnSignatureKey(body.expectedColumns)
  ) {
    return {
      ok: false,
      error:
        "The target database's columns changed since this was proposed. " +
        "Re-read it and propose again.",
    };
  }

  const plan = await planDatabaseMerge(root, domainSlug, target.value, sourceMetas);
  if (!plan.ok) return { ok: false, error: plan.error };

  for (const spec of plan.value.newColumns) {
    const added = await addDatabaseColumn(root, domainSlug, targetDatabaseId, spec);
    if (!added.ok) return { ok: false, error: `Column "${spec.name}": ${added.error}` };
  }
  for (const widened of plan.value.widenedColumns) {
    const updated = await updateDatabaseColumnOptions(
      root,
      domainSlug,
      targetDatabaseId,
      widened.columnId,
      widened.options,
    );
    if (!updated.ok) return { ok: false, error: `Column ${widened.columnId}: ${updated.error}` };
  }

  // Re-read the target so the freshly minted column ids are known: a source
  // column with no target match maps by name onto the column just added.
  const refreshed = await getDatabase(root, domainSlug, targetDatabaseId);
  if (!refreshed.ok) return { ok: false, error: refreshed.error };
  const originalColumnIds = new Set(target.value.columns.map((column) => column.id));
  const addedColumnIdByName = new Map<string, string>();
  for (const column of refreshed.value.columns) {
    if (originalColumnIds.has(column.id)) continue;
    addedColumnIdByName.set(columnKey(column.name), column.id);
  }
  const targetColumnIdBySource = new Map<string, string>();
  for (const entry of plan.value.columnMap) {
    const targetColumnId =
      entry.targetColumnId ??
      (entry.add ? addedColumnIdByName.get(columnKey(entry.add.name)) : undefined);
    if (!targetColumnId) {
      return {
        ok: false,
        error: `Column ${entry.sourceColumnId}: it could not be mapped onto the target`,
      };
    }
    targetColumnIdBySource.set(entry.sourceColumnId, targetColumnId);
  }

  // Dedupe compares the MAPPED cells over the target's own columns, so an absent
  // value and an explicit null read as the same empty cell — which is how the
  // operator's table shows them.
  const targetColumns = [...refreshed.value.columns].sort((a, b) => a.id.localeCompare(b.id));
  const cellSignature = (cells: Record<string, unknown>): string =>
    targetColumns
      .map((column) => `${column.id}=${JSON.stringify(cells[column.id] ?? null)}`)
      .join("\u0000");

  const existing = await listRows(root, domainSlug, targetDatabaseId);
  if (!existing.ok) return { ok: false, error: existing.error };
  const seen = new Set(existing.value.map((row) => cellSignature(row.cells)));
  const dedupe = body.dedupe !== false;

  const moves: Array<{
    sourceDatabaseId: string;
    rows: Array<{
      sourceRowId: string;
      cells: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
      skip?: boolean;
    }>;
  }> = [];
  let skipped = 0;

  for (const meta of sourceMetas) {
    const listed = await listRows(root, domainSlug, meta.id);
    if (!listed.ok) return { ok: false, error: listed.error };
    const rows: (typeof moves)[number]["rows"] = [];
    for (const sourceRow of listed.value) {
      const cells: Record<string, unknown> = {};
      for (const [sourceColumnId, value] of Object.entries(sourceRow.cells)) {
        const targetColumnId = targetColumnIdBySource.get(sourceColumnId);
        // An unmappable cell is a row holding a value for a column its schema no
        // longer has. Dropping it would delete the value without showing it to
        // anyone; refusing makes the operator look at the database instead.
        if (!targetColumnId) {
          return {
            ok: false,
            error:
              `Column ${sourceColumnId}: a row in "${meta.name}" holds a value for a column ` +
              "that is not in its schema",
          };
        }
        cells[targetColumnId] = value;
      }
      const signature = cellSignature(cells);
      const duplicate = dedupe && seen.has(signature);
      if (duplicate) {
        skipped += 1;
      } else {
        seen.add(signature);
      }
      rows.push({
        sourceRowId: sourceRow.id,
        cells,
        createdAt: sourceRow.createdAt,
        updatedAt: sourceRow.updatedAt,
        ...(duplicate ? { skip: true } : {}),
      });
    }
    moves.push({ sourceDatabaseId: meta.id, rows });
  }

  const inserted = await insertMovedRows(root, domainSlug, targetDatabaseId, moves);
  if (!inserted.ok) return { ok: false, error: inserted.error };

  // The rows are in the target and out of the sources, so the registry entries
  // are the only thing left. A failure here is a source the operator can delete
  // by hand; it must not read as "nothing happened".
  for (const meta of sourceMetas) {
    const removed = await deleteDatabase(root, domainSlug, meta.id, actor);
    if (!removed.ok) return { ok: false, error: removed.error };
  }

  const sourceNames = sourceMetas.map((meta) => `"${meta.name}"`).join(", ");
  // A log line that cannot be appended must not fail a merge that already
  // committed: the target holds the rows either way.
  await appendLog(root, {
    domainSlug,
    type: "database.merged",
    summary:
      `Merged ${plural(sourceMetas.length, "database", "databases")} (${sourceNames}) ` +
      `into "${target.value.name}": ${plural(inserted.value.inserted, "row", "rows")} moved, ` +
      `${plural(skipped, "duplicate", "duplicates")} skipped`,
    payload: {
      targetDatabaseId,
      targetName: target.value.name,
      sources: sourceMetas.map((meta) => ({ databaseId: meta.id, name: meta.name })),
      moved: inserted.value.inserted,
      skipped,
      newColumns: plan.value.newColumns.map((spec) => spec.name),
      widenedColumns: plan.value.widenedColumns.map((entry) => entry.columnId),
      dedupe,
    },
    actor,
  });

  return { ok: true, value: { moved: inserted.value.inserted, skipped } };
}

/**
 * The lifecycle failures that no retry can fix.
 *
 * Every message this module (and the primitives it drives) manufactures about
 * the vault's state starts with one of these: a guard that now holds, a row or
 * schema that moved, a column type that conflicts. `decisions.ts` records such a
 * failure as terminal instead of stranding the Decision pending. Anything else —
 * a SQLite or filesystem error — is transient and stays retryable, which is why
 * this is an allow-list of prefixes rather than "not an I/O error".
 */
const TERMINAL_LIFECYCLE_ERROR_PREFIXES = [
  "A database linked to an outside source",
  "A saved view",
  "The Finance kit owns",
  "The database",
  "Database ",
  "The target database's",
  "The columns of ",
  "The merge proposal is missing",
  "The delete proposal is missing",
  "Decision does not cover",
  // Every plan conflict, every column-add failure and every unmappable cell.
  "Column ",
];

/** Whether re-approving this lifecycle failure can never succeed. */
export function isTerminalDatabaseLifecycleError(error: string): boolean {
  return TERMINAL_LIFECYCLE_ERROR_PREFIXES.some((prefix) => error.startsWith(prefix));
}
