/**
 * Merging and deleting databases, end to end against a real vault.
 *
 * The reported gap (2026-11-15): health held four "Supplement log" databases and
 * the companion had no tool on its side to merge or delete a database. The
 * contract this rig holds is `.scratch/database-merge-delete/DESIGN.md`:
 *
 *   - `delete_database` and `merge_databases` FILE ONE pending Decision each and
 *     write nothing until the operator approves it (LAWS/DATABASES.md: deleting
 *     a database or moving its rows into another one is a change to existing
 *     data, so it goes through Decisions).
 *   - `delete_database` refuses an adapter-linked database, a Finance-kit
 *     database, a database another table's relation column points at, and a
 *     database a saved dashboard card reads (the operator has to unlink, untie,
 *     or repoint first). There is no other tool surface for those.
 *   - `merge_databases` matches columns by name, adds a source column the target
 *     lacks, unions select options, maps each source row cell-by-cell, skips
 *     exact duplicate rows by default (unless `dedupe: false`), preserves each
 *     source row's createdAt/updatedAt, then deletes the sources and logs one
 *     `database.deleted` per source plus one `database.merged` summary.
 *   - The fingerprint captured at propose time is re-checked at apply: rows
 *     added/edited after the proposal (or a target schema change) turn the
 *     approve into a TERMINAL refusal, with the source left intact.
 *   - `create_database` now refuses a second database with the same name
 *     (trimmed, case-insensitive) in the same area, so the companion cannot
 *     recreate the drift by itself. The Data page UI is unchanged.
 *
 * Every call below goes through the real `executeDatabaseTool` against a real
 * temp vault on disk, and every claim is read back with the engine's own
 * `getDatabase` / `listRows` / `listDecisions` / `readLog`. There is no stub
 * between the tool and the engine: the "gated" half is read back both before and
 * after `resolveDecision`, so a write that lands early is impossible to miss.
 *
 * Artifact: `e2e/artifacts/database-merge-delete.json` — every scenario, the
 * proposals and bodies as filed, and the facts read back off disk. The
 * assertions run on the same JSON this run writes, so the artifact is the
 * evidence rather than a log beside it.
 *
 * Runs under `node --experimental-strip-types --test
 * tests/database-merge-delete-e2e.test.ts`; no Electron and no dev server.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DATABASE_TOOL_DEFS,
  FINANCE_DB_IDS,
  addDatabaseColumn,
  createDatabase,
  createVault,
  deleteDatabase,
  executeDatabaseTool,
  getDatabase,
  listDatabases,
  listDecisions,
  listRows,
  listViews,
  readLog,
  resolveDecision,
  saveView,
  unlockDomain,
  upsertRow,
} from "@lifequest/vault-core";
import type { DatabaseMeta, DatabaseRow, Result } from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/database-merge-delete.json");

const AGENT = { type: "agent" as const, id: "e2e", name: "E2E" };

type Answer = Record<string, unknown>;
type Failure = { code: string; message: string };
type Check = { name: string; pass: boolean; detail: string | null };

/**
 * The frozen scenario list from DESIGN.md "E2E evidence" item 1 (plus the
 * Lead's merge-guard asymmetry ruling: relation/view guards apply to SOURCES
 * only, so referencing the TARGET must not block a merge into it). The artifact
 * is checked against this list, so a scenario cannot be silently dropped.
 */
const REQUIRED_SCENARIOS = [
  "tools-advertised",
  "delete-propose-decision",
  "delete-propose-writes-nothing",
  "delete-approve",
  "delete-refusal-not-found",
  "delete-refusal-adapter",
  "delete-refusal-relation",
  "delete-refusal-view",
  "delete-refusal-finance-kit",
  "merge-propose-decision",
  "merge-propose-writes-nothing",
  "merge-approve-rows",
  "merge-approve-schema",
  "merge-approve-sources-deleted",
  "merge-approve-log",
  "merge-dedupe-default-skips-target-duplicate",
  "merge-dedupe-false-keeps-duplicates",
  "merge-staleness-source-changed",
  "merge-staleness-target-schema",
  "merge-target-references-allowed",
  "merge-refusal-self",
  "merge-refusal-duplicate-ids",
  "merge-refusal-missing-id",
  "merge-refusal-adapter-target",
  "merge-refusal-adapter-source",
  "merge-refusal-finance-target",
  "merge-refusal-finance-source",
  "merge-refusal-view-source",
  "merge-refusal-relation-source",
  "merge-refusal-self-relation-source",
  "create-database-duplicate-name",
  "delete-approve-database-already-gone",
];

/** Unwrap an engine `Result`, naming the call that failed. */
function unwrap<T>(result: Result<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.value;
}

/** Call the real tool and fail loudly on a tool error. */
async function tool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  const answer = await executeDatabaseTool(root, AGENT, name, args);
  if ("error" in answer) {
    throw new Error(`${name} answered an error: ${JSON.stringify(answer.error)}`);
  }
  return answer as Answer;
}

/**
 * Call a tool that the contract says must be refused. Proves the refusal is
 * explicit (a coded error, not a silent success) and hands the message back for
 * the scenario to hold against the contract's own wording.
 */
async function refusal(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Failure> {
  const answer = await executeDatabaseTool(root, AGENT, name, args);
  assert.ok(
    "error" in answer,
    `${name} was accepted when the contract says it must be refused: ${JSON.stringify(answer).slice(0, 500)}`,
  );
  const failure = (answer as { error: Failure }).error;
  assert.equal(
    typeof failure?.code,
    "string",
    `${name}: the refusal carries no error code: ${JSON.stringify(failure)}`,
  );
  assert.equal(
    typeof failure?.message,
    "string",
    `${name}: the refusal carries no message: ${JSON.stringify(failure)}`,
  );
  return failure;
}

async function pendingCount(root: string): Promise<number> {
  const listed = unwrap(await listDecisions(root), "listDecisions");
  return listed.filter((decision) => decision.status === "pending").length;
}

async function decisionById(root: string, id: string) {
  const listed = unwrap(await listDecisions(root), "listDecisions");
  const found = listed.find((decision) => decision.id === id);
  assert.ok(found, `Decision ${id} is not in the inbox: ${JSON.stringify(listed).slice(0, 400)}`);
  return found;
}

function bodyOf(decision: { proposedBodyMarkdown: string }): Record<string, unknown> {
  return JSON.parse(decision.proposedBodyMarkdown) as Record<string, unknown>;
}

/* ── small engine helpers ─────────────────────────────────────────────────── */

type ColumnSpec = {
  name: string;
  type: string;
  options?: string[];
  relationDatabaseId?: string;
};

type DbHandle = {
  id: string;
  meta: DatabaseMeta;
  column: (name: string) => DatabaseMeta["columns"][number];
};

/** A database plus its columns, created through the engine's own API. */
async function createDb(
  root: string,
  slug: string,
  name: string,
  columns: ColumnSpec[] = [],
): Promise<DbHandle> {
  const created = unwrap(await createDatabase(root, slug, { name }), `createDatabase(${name})`);
  for (const column of columns) {
    unwrap(
      await addDatabaseColumn(root, slug, created.id, column),
      `addDatabaseColumn(${name}.${column.name})`,
    );
  }
  const meta = unwrap(await getDatabase(root, slug, created.id), `getDatabase(${name})`);
  const column = (columnName: string) => {
    const found = meta.columns.find((candidate) => candidate.name === columnName);
    assert.ok(found, `${name} has no column ${columnName}: ${meta.columns.map((c) => c.name).join(", ")}`);
    return found;
  };
  return { id: created.id, meta, column };
}

/** Cells keyed by column id, from a column-name map — the API's own shape. */
function cells(db: DbHandle, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [db.column(name).id, value]),
  );
}

/** Add one row through the engine's direct upsert path (a create: no Decision). */
async function addRow(
  root: string,
  slug: string,
  db: DbHandle,
  values: Record<string, unknown>,
): Promise<DatabaseRow> {
  return unwrap(
    await upsertRow(root, slug, db.id, { cells: cells(db, values) }),
    `upsertRow(${db.meta.name})`,
  );
}

async function rowsOf(root: string, slug: string, databaseId: string): Promise<DatabaseRow[]> {
  return unwrap(
    await listRows(root, slug, databaseId, { limit: 500, offset: 0 }),
    `listRows(${databaseId})`,
  );
}

/** Fail unless the database is gone from the registry. Returns the error text. */
async function databaseGone(root: string, slug: string, databaseId: string): Promise<string> {
  const read = await getDatabase(root, slug, databaseId);
  assert.equal(read.ok, false, `the database ${databaseId} is still in the registry`);
  return read.error;
}

/**
 * Pin a source row's timestamps, so "a merge preserves createdAt and updatedAt"
 * is checked against values that cannot coincide with the merge's own clock.
 * Only the two timestamp columns are written here (SQLite, the vault's own
 * storage); every read and write under test still goes through the engine.
 */
function pinRowTimestamps(
  root: string,
  slug: string,
  databaseId: string,
  pins: Array<{ id: string; createdAt: string; updatedAt: string }>,
): void {
  const sqlite = new DatabaseSync(path.join(root, "domains", slug, "data", "domain.sqlite"));
  try {
    const statement = sqlite.prepare(
      "UPDATE rows SET created_at = ?, updated_at = ? WHERE database_id = ? AND id = ?",
    );
    for (const pin of pins) {
      statement.run(pin.createdAt, pin.updatedAt, databaseId, pin.id);
    }
  } finally {
    sqlite.close();
  }
}

/**
 * Bind an outside adapter by editing the registry, which is how DESIGN.md asks
 * this rig to set up an adapter-linked database: the engine exposes no
 * local-only setter, and `linkDatabaseAdapter` needs an operator secret store.
 * Only the adapter field changes.
 */
function bindAdapter(root: string, slug: string, databaseId: string): void {
  const registryPath = path.join(root, "domains", slug, "data", "registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
    databases: Array<{ id: string; adapter: unknown }>;
  };
  const entry = registry.databases.find((database) => database.id === databaseId);
  assert.ok(entry, `the registry has no database ${databaseId}`);
  entry.adapter = {
    kind: "url",
    bindingId: `e2e-binding-${databaseId}`,
    mappingId: null,
    lastSyncedAt: null,
  };
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

/**
 * A minimal valid saved card on one database. `saveView` fills the remaining
 * ViewSpec fields with its own defaults, exactly as the renderer's editor does.
 */
function metricView(databaseId: string, title: string) {
  return {
    databaseId,
    title,
    presentation: "metric" as const,
    groupBy: null,
    timeBucket: null,
    timeColumnId: null,
    timeWindow: "all" as const,
    filters: [],
    measure: "count" as const,
    measureColumnId: null,
    per: null,
    sort: { by: "label" as const, dir: "asc" as const },
    limit: 12,
    convertToZar: false,
    columns: [],
  };
}

/** The Finance kit's Accounts database, created life-size if the kit is absent. */
async function ensureFinanceAccounts(root: string): Promise<DatabaseMeta> {
  const listed = unwrap(await listDatabases(root, "financial"), "listDatabases(financial)");
  const existing = listed.find((entry) => entry.database.id === FINANCE_DB_IDS.accounts);
  if (existing) return existing.database;
  const created = unwrap(
    await createDatabase(root, "financial", { name: "Accounts", id: FINANCE_DB_IDS.accounts }),
    "createDatabase(finance:accounts)",
  );
  unwrap(
    await addDatabaseColumn(root, "financial", FINANCE_DB_IDS.accounts, {
      name: "Name",
      type: "text",
    }),
    "addDatabaseColumn(finance:accounts.Name)",
  );
  return created;
}

const sha256Hex = /^[0-9a-f]{64}$/;

describe("database merge and delete", () => {
  it("files one Decision per lifecycle change, applies it only on approve, and refuses unsafe changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-database-merge-delete-"));
    const scenarios: Check[] = [];
    const evidence: Record<string, unknown> = {};
    const scenario = (name: string, pass: boolean, detail: string | null = null): void => {
      scenarios.push({ name, pass, detail });
      assert.equal(pass, true, `${name}: ${detail ?? "failed"}`);
    };

    try {
      unwrap(await createVault(root, "Database Merge E2E"), "createVault");
      for (const slug of ["health", "financial"]) {
        unwrap(await unlockDomain(root, slug), `unlockDomain(${slug})`);
      }

      // ── 1. the agent-facing surface advertises the two lifecycle tools ─────
      const databaseToolNames = DATABASE_TOOL_DEFS.map((definition) => definition.name);
      const deleteDef = DATABASE_TOOL_DEFS.find((definition) => definition.name === "delete_database");
      const mergeDef = DATABASE_TOOL_DEFS.find((definition) => definition.name === "merge_databases");
      const surface = {
        databaseTools: databaseToolNames,
        deleteDatabase: deleteDef ?? null,
        mergeDatabases: mergeDef ?? null,
      };
      evidence.toolSurface = surface;
      scenario(
        "tools-advertised",
        deleteDef !== undefined &&
          mergeDef !== undefined &&
          /Decision/i.test(String(deleteDef.description)) &&
          /Decision/i.test(String(mergeDef.description)),
        `database tools: ${databaseToolNames.join(", ")}`,
      );

      // ═══ delete_database: propose, then approve ═══════════════════════════
      const doomed = await createDb(root, "health", "Old Supplements", [
        { name: "Name", type: "text" },
        { name: "Dose", type: "number" },
      ]);
      await addRow(root, "health", doomed, { Name: "Fish oil", Dose: 2 });
      await addRow(root, "health", doomed, { Name: "Zinc", Dose: 1 });
      const pendingBeforeDelete = await pendingCount(root);

      const deleteAnswer = await tool(root, "delete_database", {
        domainSlug: "health",
        databaseId: doomed.id,
      });
      const deleteDecisionId = String(deleteAnswer.decisionId ?? "");
      assert.ok(deleteDecisionId, "delete_database returned no decisionId");
      const deleteDecision = await decisionById(root, deleteDecisionId);
      const deleteBody = bodyOf(deleteDecision);
      evidence.deleteProposal = {
        answer: deleteAnswer,
        decision: {
          id: deleteDecision.id,
          status: deleteDecision.status,
          target: deleteDecision.target,
          proposedTitle: deleteDecision.proposedTitle,
        },
        body: deleteBody,
      };

      scenario(
        "delete-propose-decision",
        deleteAnswer.status === "pending" &&
          deleteAnswer.posted === false &&
          deleteAnswer.databaseId === doomed.id &&
          deleteAnswer.name === "Old Supplements" &&
          deleteAnswer.rowCount === 2 &&
          deleteDecision.status === "pending" &&
          deleteDecision.target.type === "database" &&
          deleteDecision.target.domainSlug === "health" &&
          deleteDecision.target.databaseId === doomed.id &&
          deleteDecision.proposedTitle === 'Delete database "Old Supplements"' &&
          deleteBody.op === "delete-database" &&
          deleteBody.databaseName === "Old Supplements" &&
          deleteBody.rowCount === 2 &&
          typeof deleteBody.fingerprint === "string" &&
          sha256Hex.test(deleteBody.fingerprint) &&
          deleteBody.previousCells === null &&
          deleteBody.cells === null &&
          deleteBody.expectedUpdatedAt === null,
        `delete_database answered ${JSON.stringify(deleteAnswer).slice(0, 300)}; body ${JSON.stringify(deleteBody).slice(0, 300)}`,
      );

      const afterDeletePropose = await getDatabase(root, "health", doomed.id);
      const doomedRowsBeforeApprove = await rowsOf(root, "health", doomed.id);
      const pendingAfterDeletePropose = await pendingCount(root);
      scenario(
        "delete-propose-writes-nothing",
        afterDeletePropose.ok === true &&
          doomedRowsBeforeApprove.length === 2 &&
          pendingAfterDeletePropose === pendingBeforeDelete + 1,
        `database still there: ${afterDeletePropose.ok}, rows: ${doomedRowsBeforeApprove.length}, pending: ${pendingAfterDeletePropose}`,
      );

      const approvedDelete = unwrap(
        await resolveDecision(root, deleteDecisionId, "approved"),
        "approve delete_database",
      );
      const doomedAfterApprove = await getDatabase(root, "health", doomed.id);
      const doomedRowsAfterApprove = await rowsOf(root, "health", doomed.id);
      const resolvedDeleteDecision = await decisionById(root, deleteDecisionId);
      const logAfterDelete = unwrap(await readLog(root), "readLog");
      const deletedDoomedEvents = logAfterDelete.filter(
        (event) =>
          event.type === "database.deleted" &&
          (event.payload as { databaseId?: string } | null)?.databaseId === doomed.id,
      );
      const healthAfterDelete = unwrap(await listDatabases(root, "health"), "listDatabases(health)");
      const registryStillHasDoomed = healthAfterDelete.some(
        (entry) => entry.database.id === doomed.id,
      );
      evidence.deleteApproval = {
        decision: {
          status: resolvedDeleteDecision.status,
          resolvedAt: resolvedDeleteDecision.resolvedAt,
          reason: resolvedDeleteDecision.reason,
        },
        approved: approvedDelete.status,
        databaseGone: doomedAfterApprove.ok === false,
        rowsRemaining: doomedRowsAfterApprove.length,
        registryStillHasDoomed,
        logEvents: deletedDoomedEvents,
      };
      scenario(
        "delete-approve",
        approvedDelete.status === "approved" &&
          doomedAfterApprove.ok === false &&
          doomedRowsAfterApprove.length === 0 &&
          !registryStillHasDoomed &&
          deletedDoomedEvents.length === 1 &&
          deletedDoomedEvents[0]?.summary.includes("Old Supplements") &&
          resolvedDeleteDecision.status === "approved",
        `approved: ${approvedDelete.status}, database gone: ${doomedAfterApprove.ok === false}, rows: ${doomedRowsAfterApprove.length}, log: ${JSON.stringify(deletedDoomedEvents).slice(0, 300)}`,
      );

      // ── 2. delete refusals: not found, adapter, relation, view, kit ───────
      const pendingBeforeNotFound = await pendingCount(root);
      const notFound = await refusal(root, "delete_database", {
        domainSlug: "health",
        databaseId: "no-such-database",
      });
      scenario(
        "delete-refusal-not-found",
        notFound.code === "NOT_FOUND" && (await pendingCount(root)) === pendingBeforeNotFound,
        `missing database answered ${JSON.stringify(notFound)}`,
      );

      // An outside adapter owns the copy: deleting the local replica would
      // resurrect it on the next sync, so the operator must unlink first.
      const linked = await createDb(root, "health", "Linked Sheet", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", linked, { Name: "Row" });
      bindAdapter(root, "health", linked.id);
      const boundMeta = unwrap(await getDatabase(root, "health", linked.id), "getDatabase(linked)");
      const pendingBeforeAdapter = await pendingCount(root);
      const adapterRefusal = await refusal(root, "delete_database", {
        domainSlug: "health",
        databaseId: linked.id,
      });
      scenario(
        "delete-refusal-adapter",
        boundMeta.adapter !== null &&
          adapterRefusal.code === "VALIDATION" &&
          /unlink the adapter first/i.test(adapterRefusal.message) &&
          (await getDatabase(root, "health", linked.id)).ok === true &&
          (await pendingCount(root)) === pendingBeforeAdapter,
        `adapter-linked delete answered ${JSON.stringify(adapterRefusal)}`,
      );

      // Another table's relation column points at the doomed database.
      const referenced = await createDb(root, "health", "Referenced", [
        { name: "Name", type: "text" },
      ]);
      const refSource = await createDb(root, "health", "Ref Source", [
        { name: "Ref Link", type: "relation", relationDatabaseId: referenced.id },
      ]);
      const pendingBeforeRelation = await pendingCount(root);
      const relationRefusal = await refusal(root, "delete_database", {
        domainSlug: "health",
        databaseId: referenced.id,
      });
      scenario(
        "delete-refusal-relation",
        relationRefusal.code === "VALIDATION" &&
          /remove the relation column first/i.test(relationRefusal.message) &&
          relationRefusal.message.includes("Ref Source") &&
          relationRefusal.message.includes("Ref Link") &&
          (await getDatabase(root, "health", referenced.id)).ok === true &&
          (await pendingCount(root)) === pendingBeforeRelation,
        `relation-referenced delete answered ${JSON.stringify(relationRefusal)}`,
      );

      // A saved dashboard card reads the doomed database.
      const viewReferenced = await createDb(root, "health", "View Referenced", [
        { name: "Name", type: "text" },
      ]);
      unwrap(
        await saveView(root, "health", metricView(viewReferenced.id, "View card")),
        "saveView(View card)",
      );
      const pendingBeforeView = await pendingCount(root);
      const viewRefusal = await refusal(root, "delete_database", {
        domainSlug: "health",
        databaseId: viewReferenced.id,
      });
      scenario(
        "delete-refusal-view",
        viewRefusal.code === "VALIDATION" &&
          /delete|repoint/i.test(viewRefusal.message) &&
          viewRefusal.message.includes("View card") &&
          (await getDatabase(root, "health", viewReferenced.id)).ok === true &&
          (await pendingCount(root)) === pendingBeforeView,
        `view-referenced delete answered ${JSON.stringify(viewRefusal)}`,
      );

      // The Finance kit owns its databases.
      const financeAccounts = await ensureFinanceAccounts(root);
      const pendingBeforeFinanceDelete = await pendingCount(root);
      const financeDeleteRefusal = await refusal(root, "delete_database", {
        domainSlug: "financial",
        databaseId: FINANCE_DB_IDS.accounts,
      });
      scenario(
        "delete-refusal-finance-kit",
        financeAccounts.id === FINANCE_DB_IDS.accounts &&
          financeDeleteRefusal.code === "VALIDATION" &&
          /kit/i.test(financeDeleteRefusal.message) &&
          (await getDatabase(root, "financial", FINANCE_DB_IDS.accounts)).ok === true &&
          (await pendingCount(root)) === pendingBeforeFinanceDelete,
        `Finance-kit delete answered ${JSON.stringify(financeDeleteRefusal)}`,
      );

      // ═══ merge_databases: the happy path ══════════════════════════════════
      // Target: Name/Dose/Time, with only "Morning" among Time's options, plus
      // a target-only Started column. Sources add a Notes column and one select
      // option each, and one source repeats an earlier source's row exactly.
      const mergeTarget = await createDb(root, "health", "Supplement log", [
        { name: "Name", type: "text" },
        { name: "Dose", type: "number" },
        { name: "Time", type: "select", options: ["Morning"] },
        { name: "Started", type: "date" },
      ]);
      const mergeTargetName = mergeTarget.column("Name");
      const mergeTargetTime = mergeTarget.column("Time");
      const mergeTargetStarted = mergeTarget.column("Started");
      const keptRow = await addRow(root, "health", mergeTarget, {
        Name: "Vitamin D",
        Dose: 1,
        Time: "Morning",
        Started: "2026-01-01",
      });

      const sourceOne = await createDb(root, "health", "Supplement log (14 Nov)", [
        { name: "Name", type: "text" },
        { name: "Dose", type: "number" },
        { name: "Time", type: "select", options: ["Evening"] },
        { name: "Notes", type: "text" },
      ]);
      const sourceTwo = await createDb(root, "health", "Supplement log (15 Nov)", [
        { name: "Name", type: "text" },
        { name: "Dose", type: "number" },
        { name: "Time", type: "select", options: ["Morning", "Evening"] },
        { name: "Notes", type: "text" },
      ]);
      const fishOil = await addRow(root, "health", sourceOne, {
        Name: "Fish oil",
        Dose: 2,
        Time: "Evening",
        Notes: "after dinner",
      });
      const magnesium = await addRow(root, "health", sourceOne, {
        Name: "Magnesium",
        Dose: 1,
        Time: "Evening",
        Notes: "night",
      });
      const zinc = await addRow(root, "health", sourceTwo, {
        Name: "Zinc",
        Dose: 1,
        Time: "Morning",
        Notes: "morning",
      });
      // Exactly equal to sourceOne's Fish oil row in every mapped cell. The
      // earlier row of the merge is the one that may stay; this one is skipped.
      const duplicatedFishOil = await addRow(root, "health", sourceTwo, {
        Name: "Fish oil",
        Dose: 2,
        Time: "Evening",
        Notes: "after dinner",
      });
      const SOURCE_TIMES: Record<string, { createdAt: string; updatedAt: string }> = {
        "Fish oil": { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T09:00:00.000Z" },
        Magnesium: { createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T09:00:00.000Z" },
        Zinc: { createdAt: "2026-11-03T08:00:00.000Z", updatedAt: "2026-11-03T09:00:00.000Z" },
      };
      pinRowTimestamps(root, "health", sourceOne.id, [
        { id: fishOil.id, ...SOURCE_TIMES["Fish oil"] },
        { id: magnesium.id, ...SOURCE_TIMES.Magnesium },
      ]);
      pinRowTimestamps(root, "health", sourceTwo.id, [
        { id: zinc.id, ...SOURCE_TIMES.Zinc },
        // Deliberately different dates from sourceOne's Fish oil: if the merge
        // kept THIS duplicate instead of the earlier row, the timestamps prove it.
        { id: duplicatedFishOil.id, createdAt: "2026-11-04T08:00:00.000Z", updatedAt: "2026-11-04T09:00:00.000Z" },
      ]);

      const pendingBeforeMerge = await pendingCount(root);
      const mergeAnswer = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: mergeTarget.id,
        sourceDatabaseIds: [sourceOne.id, sourceTwo.id],
      });
      const mergeDecisionId = String(mergeAnswer.decisionId ?? "");
      assert.ok(mergeDecisionId, "merge_databases returned no decisionId");
      const mergeDecision = await decisionById(root, mergeDecisionId);
      const mergeBody = bodyOf(mergeDecision);
      const mergedSources = (mergeAnswer.sources ?? []) as Array<{
        databaseId: string;
        name: string;
        rowCount: number;
      }>;
      const bodySources = (mergeBody.sources ?? []) as Array<{
        databaseId: string;
        name: string;
        rowCount: number;
        fingerprint: string;
        columns: Array<{ id: string; name: string; type: string }>;
      }>;
      const bodyNewColumns = (mergeBody.newColumns ?? []) as Array<{
        name: string;
        type: string;
      }>;
      const bodyWidened = (mergeBody.widenedColumns ?? []) as Array<{
        columnId: string;
        options: string[];
      }>;
      const bodyExpected = (mergeBody.expectedColumns ?? []) as Array<{
        id: string;
        name: string;
        type: string;
      }>;
      const targetSignature = mergeTarget.meta.columns
        .map((column) => `${column.id}|${column.name}|${column.type}`)
        .sort();
      const bodyExpectedSignature = bodyExpected
        .map((column) => `${column.id}|${column.name}|${column.type}`)
        .sort();
      evidence.mergeProposal = {
        answer: mergeAnswer,
        decision: {
          id: mergeDecision.id,
          status: mergeDecision.status,
          target: mergeDecision.target,
          proposedTitle: mergeDecision.proposedTitle,
        },
        body: mergeBody,
      };

      scenario(
        "merge-propose-decision",
        mergeAnswer.status === "pending" &&
          mergeAnswer.posted === false &&
          mergeAnswer.targetDatabaseId === mergeTarget.id &&
          mergeAnswer.targetName === "Supplement log" &&
          mergeAnswer.dedupe === true &&
          typeof mergeAnswer.rowsToMove === "number" &&
          (mergeAnswer.rowsToMove as number) >= 3 &&
          mergedSources.length === 2 &&
          mergedSources[0]?.databaseId === sourceOne.id &&
          mergedSources[0]?.name === "Supplement log (14 Nov)" &&
          mergedSources[0]?.rowCount === 2 &&
          mergedSources[1]?.databaseId === sourceTwo.id &&
          mergedSources[1]?.rowCount === 2 &&
          mergeDecision.status === "pending" &&
          mergeDecision.target.type === "database" &&
          mergeDecision.target.databaseId === mergeTarget.id &&
          mergeDecision.proposedTitle === 'Merge 2 databases into "Supplement log"' &&
          mergeBody.op === "merge-databases" &&
          mergeBody.databaseName === "Supplement log" &&
          mergeBody.dedupe === true &&
          bodySources.length === 2 &&
          bodySources[0]?.databaseId === sourceOne.id &&
          bodySources[1]?.databaseId === sourceTwo.id &&
          bodySources.every(
            (source) =>
              typeof source.fingerprint === "string" &&
              sha256Hex.test(source.fingerprint) &&
              Array.isArray(source.columns) &&
              source.columns.every(
                (column) =>
                  typeof column.id === "string" &&
                  typeof column.name === "string" &&
                  typeof column.type === "string",
              ),
          ) &&
          bodyNewColumns.some((column) => column.name === "Notes" && column.type === "text") &&
          bodyWidened.some(
            (widened) =>
              widened.columnId === mergeTargetTime.id &&
              widened.options.includes("Evening") &&
              widened.options.includes("Morning"),
          ) &&
          bodyExpectedSignature.length === targetSignature.length &&
          bodyExpectedSignature.every((entry, index) => entry === targetSignature[index]) &&
          mergeBody.previousCells === null &&
          mergeBody.cells === null &&
          mergeBody.expectedUpdatedAt === null,
        `merge_databases answered ${JSON.stringify(mergeAnswer).slice(0, 400)}; body ${JSON.stringify(mergeBody).slice(0, 500)}`,
      );

      const targetAfterProposeResult = await getDatabase(root, "health", mergeTarget.id);
      const targetAfterPropose = unwrap(
        targetAfterProposeResult,
        "getDatabase(target after propose)",
      );
      const targetRowsAfterPropose = await rowsOf(root, "health", mergeTarget.id);
      const sourceOneAfterPropose = await getDatabase(root, "health", sourceOne.id);
      const sourceTwoAfterPropose = await getDatabase(root, "health", sourceTwo.id);
      const sourceOneRowsAfterPropose = await rowsOf(root, "health", sourceOne.id);
      const sourceTwoRowsAfterPropose = await rowsOf(root, "health", sourceTwo.id);
      const pendingAfterMergePropose = await pendingCount(root);
      evidence.mergeProposal.onDiskBeforeApprove = {
        targetColumns: targetAfterPropose.columns.map((column) => ({
          name: column.name,
          type: column.type,
          options: column.options ?? null,
        })),
        targetRows: targetRowsAfterPropose.length,
        sources: [
          { id: sourceOne.id, exists: sourceOneAfterPropose.ok, rows: sourceOneRowsAfterPropose.length },
          { id: sourceTwo.id, exists: sourceTwoAfterPropose.ok, rows: sourceTwoRowsAfterPropose.length },
        ],
        pendingDecisions: pendingAfterMergePropose,
      };
      scenario(
        "merge-propose-writes-nothing",
        targetAfterProposeResult.ok === true &&
          targetRowsAfterPropose.length === 1 &&
          targetAfterPropose.columns.every((column) => column.name !== "Notes") &&
          targetAfterPropose.columns.every(
            (column) =>
              column.name !== "Time" ||
              JSON.stringify(column.options ?? []) === JSON.stringify(["Morning"]),
          ) &&
          sourceOneAfterPropose.ok === true &&
          sourceTwoAfterPropose.ok === true &&
          sourceOneRowsAfterPropose.length === 2 &&
          sourceTwoRowsAfterPropose.length === 2 &&
          pendingAfterMergePropose === pendingBeforeMerge + 1,
        `before approve: target rows ${targetRowsAfterPropose.length}, columns ${targetAfterPropose.columns.map((c) => c.name).join(",")}, sources ${sourceOneAfterPropose.ok}/${sourceTwoAfterPropose.ok}, pending ${pendingAfterMergePropose}`,
      );

      const approvedMerge = unwrap(
        await resolveDecision(root, mergeDecisionId, "approved"),
        "approve merge_databases",
      );
      const targetAfterMerge = unwrap(
        await getDatabase(root, "health", mergeTarget.id),
        "getDatabase(target after merge)",
      );
      const targetRows = await rowsOf(root, "health", mergeTarget.id);
      const movedRows = targetRows.filter((row) => row.id !== keptRow.id);
      const movedByName = new Map(
        movedRows.map((row) => [String(row.cells[mergeTargetName.id]), row]),
      );
      const movedNames = [...movedByName.keys()].sort();
      const originalRow = targetRows.find((row) => row.id === keptRow.id);
      const sourceRowIds = new Set([fishOil.id, magnesium.id, zinc.id, duplicatedFishOil.id]);
      const movedRowsMintNewIds = movedRows.every((row) => !sourceRowIds.has(row.id));
      const timestampsPreserved = movedRows.every((row) => {
        const name = String(row.cells[mergeTargetName.id]);
        const expected = SOURCE_TIMES[name];
        return (
          expected !== undefined &&
          row.createdAt === expected.createdAt &&
          row.updatedAt === expected.updatedAt
        );
      });
      const timeAfterMerge = targetAfterMerge.columns.find((column) => column.name === "Time");
      const notesAfterMerge = targetAfterMerge.columns.find((column) => column.name === "Notes");
      const targetOnlyCellsEmpty = movedRows.every(
        (row) => row.cells[mergeTargetStarted.id] === undefined,
      );
      evidence.mergeApproval = {
        decisionStatus: approvedMerge.status,
        targetRows: targetRows.length,
        movedRows: movedRows.map((row) => ({
          name: row.cells[mergeTargetName.id],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          started: row.cells[mergeTargetStarted.id] ?? null,
        })),
        movedNames,
        mintedNewIdsForMovedRows: movedRowsMintNewIds,
        timestampsPreserved,
        targetColumns: targetAfterMerge.columns.map((column) => ({
          name: column.name,
          type: column.type,
          options: column.options ?? null,
        })),
        timeOptions: timeAfterMerge?.options ?? null,
        notesColumn: notesAfterMerge
          ? { name: notesAfterMerge.name, type: notesAfterMerge.type }
          : null,
        targetOnlyCellsEmpty,
        keptRowName: originalRow ? originalRow.cells[mergeTargetName.id] : null,
      };
      scenario(
        "merge-approve-rows",
        approvedMerge.status === "approved" &&
          targetRows.length === 4 &&
          movedRows.length === 3 &&
          JSON.stringify(movedNames) === JSON.stringify(["Fish oil", "Magnesium", "Zinc"]) &&
          movedRows.filter((row) => row.cells[mergeTargetName.id] === "Fish oil").length === 1 &&
          movedRowsMintNewIds &&
          timestampsPreserved &&
          targetOnlyCellsEmpty &&
          originalRow !== undefined &&
          originalRow.cells[mergeTargetStarted.id] === "2026-01-01",
        `target rows ${targetRows.length} (${movedNames.join(", ")}), minted ids: ${movedRowsMintNewIds}, timestamps kept: ${timestampsPreserved}, target-only cells empty: ${targetOnlyCellsEmpty}`,
      );

      scenario(
        "merge-approve-schema",
        notesAfterMerge !== undefined &&
          notesAfterMerge.type === "text" &&
          timeAfterMerge !== undefined &&
          JSON.stringify([...(timeAfterMerge.options ?? [])].sort()) ===
            JSON.stringify(["Evening", "Morning"]),
        `columns ${targetAfterMerge.columns.map((c) => c.name).join(",")}, Time options ${JSON.stringify(timeAfterMerge?.options)}`,
      );

      const sourceOneGone = await getDatabase(root, "health", sourceOne.id);
      const sourceTwoGone = await getDatabase(root, "health", sourceTwo.id);
      const sourceOneRowsGone = await rowsOf(root, "health", sourceOne.id);
      const sourceTwoRowsGone = await rowsOf(root, "health", sourceTwo.id);
      const healthAfterMerge = unwrap(await listDatabases(root, "health"), "listDatabases(health)");
      evidence.mergeApproval.sources = [
        {
          id: sourceOne.id,
          present: sourceOneGone.ok,
          rows: sourceOneRowsGone.length,
          inRegistry: healthAfterMerge.some((entry) => entry.database.id === sourceOne.id),
        },
        {
          id: sourceTwo.id,
          present: sourceTwoGone.ok,
          rows: sourceTwoRowsGone.length,
          inRegistry: healthAfterMerge.some((entry) => entry.database.id === sourceTwo.id),
        },
      ];
      scenario(
        "merge-approve-sources-deleted",
        sourceOneGone.ok === false &&
          sourceTwoGone.ok === false &&
          sourceOneRowsGone.length === 0 &&
          sourceTwoRowsGone.length === 0 &&
          !healthAfterMerge.some(
            (entry) => entry.database.id === sourceOne.id || entry.database.id === sourceTwo.id,
          ),
        `sources present: ${sourceOneGone.ok}/${sourceTwoGone.ok}, rows: ${sourceOneRowsGone.length}/${sourceTwoRowsGone.length}`,
      );

      const logAfterMerge = unwrap(await readLog(root), "readLog");
      const mergedEvents = logAfterMerge.filter((event) => event.type === "database.merged");
      const deletedMergeEvents = logAfterMerge.filter(
        (event) =>
          event.type === "database.deleted" &&
          [sourceOne.id, sourceTwo.id].includes(
            (event.payload as { databaseId?: string } | null)?.databaseId ?? "",
          ),
      );
      const mergedEvent = mergedEvents.find((event) =>
        JSON.stringify(event).includes(mergeTarget.id),
      );
      const mergedEventJson = JSON.stringify(mergedEvent ?? {});
      const mergedEventNumbers = (mergedEventJson.match(/\d+/g) ?? []).map(Number);
      evidence.mergeApproval.log = {
        mergedEvents,
        deletedSourceEvents: deletedMergeEvents,
      };
      scenario(
        "merge-approve-log",
        deletedMergeEvents.length === 2 &&
          mergedEvents.length === 1 &&
          mergedEvent !== undefined &&
          mergedEvent.domainSlug === "health" &&
          mergedEventJson.includes(mergeTarget.id) &&
          mergedEventJson.includes(mergeTarget.meta.name) &&
          [sourceOne.id, sourceTwo.id].every((id) =>
            JSON.stringify(mergedEvent?.payload ?? {}).includes(id),
          ) &&
          mergedEvent.actor?.type === "agent" &&
          mergedEvent.actor.id === "e2e" &&
          mergedEventNumbers.includes(3) &&
          mergedEventNumbers.includes(1),
        `merged line ${JSON.stringify(mergedEvent).slice(0, 500)}; deleted lines ${deletedMergeEvents.length}`,
      );

      // ═══ dedupe: default skips a row equal to one the target holds ════════
      const bottles = await createDb(root, "health", "Bottles", [
        { name: "Bottle", type: "text" },
        { name: "Volume", type: "number" },
      ]);
      await addRow(root, "health", bottles, { Bottle: "Kleintjie", Volume: 750 });
      const bottlesCopy = await createDb(root, "health", "Bottles (copy)", [
        { name: "Bottle", type: "text" },
        { name: "Volume", type: "number" },
      ]);
      await addRow(root, "health", bottlesCopy, { Bottle: "Kleintjie", Volume: 750 });
      await addRow(root, "health", bottlesCopy, { Bottle: "Wine", Volume: 1500 });
      const bottlesProposal = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: bottles.id,
        sourceDatabaseIds: [bottlesCopy.id],
      });
      const bottlesDecisionId = String(bottlesProposal.decisionId ?? "");
      const bottlesBody = bodyOf(await decisionById(root, bottlesDecisionId));
      unwrap(await resolveDecision(root, bottlesDecisionId, "approved"), "approve Bottles merge");
      const bottlesRows = await rowsOf(root, "health", bottles.id);
      const bottleNames = bottlesRows.map((row) => String(row.cells[bottles.column("Bottle").id]));
      const bottlesCopyGone = await getDatabase(root, "health", bottlesCopy.id);
      evidence.dedupeDefault = {
        proposal: bottlesProposal,
        body: bottlesBody,
        targetNames: bottleNames,
        sourceGone: bottlesCopyGone.ok === false,
      };
      scenario(
        "merge-dedupe-default-skips-target-duplicate",
        bottlesProposal.dedupe === true &&
          bottlesBody.dedupe === true &&
          bottlesRows.length === 2 &&
          bottleNames.filter((name) => name === "Kleintjie").length === 1 &&
          bottleNames.includes("Wine") &&
          bottlesCopyGone.ok === false,
        `target rows ${JSON.stringify(bottleNames)}, source gone: ${bottlesCopyGone.ok === false}`,
      );

      // ═══ dedupe:false inserts the duplicate rows ══════════════════════════
      const books = await createDb(root, "health", "Books", [{ name: "Title", type: "text" }]);
      await addRow(root, "health", books, { Title: "Dune" });
      const booksCopy = await createDb(root, "health", "Books (copy)", [
        { name: "Title", type: "text" },
      ]);
      await addRow(root, "health", booksCopy, { Title: "Dune" });
      await addRow(root, "health", booksCopy, { Title: "Emma" });
      const booksProposal = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: books.id,
        sourceDatabaseIds: [booksCopy.id],
        dedupe: false,
      });
      const booksDecisionId = String(booksProposal.decisionId ?? "");
      const booksBody = bodyOf(await decisionById(root, booksDecisionId));
      unwrap(await resolveDecision(root, booksDecisionId, "approved"), "approve Books merge");
      const booksRows = await rowsOf(root, "health", books.id);
      const bookTitles = booksRows.map((row) => String(row.cells[books.column("Title").id]));
      evidence.dedupeFalse = {
        proposal: booksProposal,
        body: booksBody,
        targetTitles: bookTitles,
      };
      scenario(
        "merge-dedupe-false-keeps-duplicates",
        booksProposal.dedupe === false &&
          booksBody.dedupe === false &&
          booksRows.length === 3 &&
          bookTitles.filter((title) => title === "Dune").length === 2 &&
          bookTitles.filter((title) => title === "Emma").length === 1,
        `target titles ${JSON.stringify(bookTitles)}`,
      );

      // ═══ guards on the target must not block a merge into it ══════════════
      // A relation column pointing AT the target and a saved card ON the target
      // both stay valid after the merge — only SOURCE references are a problem.
      const refTarget = await createDb(root, "health", "Referenced Target", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", refTarget, { Name: "Kept" });
      const targetView = unwrap(
        await saveView(root, "health", metricView(refTarget.id, "Target card")),
        "saveView(Target card)",
      );
      const targetRelSource = await createDb(root, "health", "Target Relation Source", [
        { name: "Link", type: "relation", relationDatabaseId: refTarget.id },
      ]);
      const refMergedSource = await createDb(root, "health", "Referenced Source", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", refMergedSource, { Name: "Moved in" });
      const targetRefsProposal = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: refTarget.id,
        sourceDatabaseIds: [refMergedSource.id],
      });
      unwrap(
        await resolveDecision(root, String(targetRefsProposal.decisionId), "approved"),
        "approve merge into referenced target",
      );
      const refTargetAfter = unwrap(
        await getDatabase(root, "health", refTarget.id),
        "getDatabase(Referenced Target)",
      );
      const viewsAfterMerge = unwrap(await listViews(root, "health"), "listViews(health)");
      const refMergedSourceGone = await getDatabase(root, "health", refMergedSource.id);
      const refPlusRows = await rowsOf(root, "health", refTarget.id);
      evidence.targetReferencesAllowed = {
        proposal: targetRefsProposal,
        targetColumns: refTargetAfter.columns.map((column) => column.name),
        viewStillSaved: viewsAfterMerge.some((view) => view.id === targetView.id),
        relationSourceStillThere: (await getDatabase(root, "health", targetRelSource.id)).ok,
        mergedSourceGone: refMergedSourceGone.ok === false,
        targetRows: refPlusRows.length,
      };
      scenario(
        "merge-target-references-allowed",
        targetRefsProposal.status === "pending" &&
          refTargetAfter.columns.some((column) => column.name === "Name") &&
          viewsAfterMerge.some((view) => view.id === targetView.id) &&
          (await getDatabase(root, "health", targetRelSource.id)).ok === true &&
          refMergedSourceGone.ok === false &&
          refPlusRows.length === 2,
        `target merge answered ${JSON.stringify(targetRefsProposal).slice(0, 250)}, view kept: ${viewsAfterMerge.some((view) => view.id === targetView.id)}, source gone: ${refMergedSourceGone.ok === false}`,
      );

      // ═══ staleness: the vault moved after the proposal ════════════════════
      const staleTarget = await createDb(root, "health", "Habits", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", staleTarget, { Name: "Walk" });
      const staleSource = await createDb(root, "health", "Habits (copy)", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", staleSource, { Name: "Run" });
      const staleProposal = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: staleTarget.id,
        sourceDatabaseIds: [staleSource.id],
      });
      const staleDecisionId = String(staleProposal.decisionId ?? "");
      // A row is added to the SOURCE after the proposal: the source fingerprint
      // no longer matches, so the approve can never be a partial merge.
      await addRow(root, "health", staleSource, { Name: "Read" });
      const staleApproval = await resolveDecision(root, staleDecisionId, "approved");
      const staleDecisionAfter = await decisionById(root, staleDecisionId);
      const staleSourceAfter = await getDatabase(root, "health", staleSource.id);
      const staleSourceRows = await rowsOf(root, "health", staleSource.id);
      const staleTargetRowsAfter = await rowsOf(root, "health", staleTarget.id);
      const staleError = staleApproval.ok ? "" : staleApproval.error;
      evidence.stalenessSource = {
        proposal: staleProposal,
        approveOk: staleApproval.ok,
        approveError: staleError,
        decision: {
          status: staleDecisionAfter.status,
          reason: staleDecisionAfter.reason,
          resolvedAt: staleDecisionAfter.resolvedAt,
        },
        sourcePresent: staleSourceAfter.ok,
        sourceRows: staleSourceRows.length,
        targetRows: staleTargetRowsAfter.length,
      };
      scenario(
        "merge-staleness-source-changed",
        staleApproval.ok === false &&
          /changed since this was proposed/i.test(staleError) &&
          staleDecisionAfter.status === "rejected" &&
          typeof staleDecisionAfter.reason === "string" &&
          /changed since this was proposed/i.test(staleDecisionAfter.reason) &&
          staleSourceAfter.ok === true &&
          staleSourceRows.length === 2 &&
          staleTargetRowsAfter.length === 1,
        `approve answered ${staleApproval.ok ? "ok" : staleError}; decision ${staleDecisionAfter.status}/${String(staleDecisionAfter.reason).slice(0, 160)}`,
      );

      const schemaTarget = await createDb(root, "health", "Sleep log", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", schemaTarget, { Name: "Night one" });
      const schemaSource = await createDb(root, "health", "Sleep log (copy)", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", schemaSource, { Name: "Night two" });
      const schemaProposal = await tool(root, "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: schemaTarget.id,
        sourceDatabaseIds: [schemaSource.id],
      });
      const schemaDecisionId = String(schemaProposal.decisionId ?? "");
      // The target's schema changes after the proposal: the merge can no longer
      // be the merge the operator approved.
      unwrap(
        await addDatabaseColumn(root, "health", schemaTarget.id, {
          name: "Quality",
          type: "number",
        }),
        "addDatabaseColumn(Sleep log.Quality)",
      );
      const schemaApproval = await resolveDecision(root, schemaDecisionId, "approved");
      const schemaDecisionAfter = await decisionById(root, schemaDecisionId);
      const schemaError = schemaApproval.ok ? "" : schemaApproval.error;
      const schemaSourceAfter = await getDatabase(root, "health", schemaSource.id);
      const schemaTargetRows = await rowsOf(root, "health", schemaTarget.id);
      const schemaSourceRows = await rowsOf(root, "health", schemaSource.id);
      evidence.stalenessTargetSchema = {
        proposal: schemaProposal,
        approveOk: schemaApproval.ok,
        approveError: schemaError,
        decision: {
          status: schemaDecisionAfter.status,
          reason: schemaDecisionAfter.reason,
        },
        sourcePresent: schemaSourceAfter.ok,
        sourceRows: schemaSourceRows.length,
        targetRows: schemaTargetRows.length,
      };
      scenario(
        "merge-staleness-target-schema",
        schemaApproval.ok === false &&
          /changed|schema|column/i.test(schemaError) &&
          schemaDecisionAfter.status === "rejected" &&
          typeof schemaDecisionAfter.reason === "string" &&
          /changed|schema|column/i.test(schemaDecisionAfter.reason) &&
          schemaSourceAfter.ok === true &&
          schemaSourceRows.length === 1 &&
          schemaTargetRows.length === 1,
        `approve answered ${schemaApproval.ok ? "ok" : schemaError}; decision ${schemaDecisionAfter.status}/${String(schemaDecisionAfter.reason).slice(0, 160)}`,
      );

      // ═══ merge refusals: argument and guard refusals file nothing ═════════
      const refusals: Record<string, Failure> = {};
      const recordRefusal = async (
        key: string,
        toolName: string,
        args: Record<string, unknown>,
      ): Promise<Failure> => {
        const before = await pendingCount(root);
        const failure = await refusal(root, toolName, args);
        assert.equal(
          await pendingCount(root),
          before,
          `${key}: the refusal filed a Decision`,
        );
        refusals[key] = failure;
        return failure;
      };

      const selfTarget = await createDb(root, "health", "Self Merge", [
        { name: "Name", type: "text" },
      ]);
      const selfRefusal = await recordRefusal("self", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: selfTarget.id,
        sourceDatabaseIds: [selfTarget.id],
      });
      scenario(
        "merge-refusal-self",
        selfRefusal.code === "VALIDATION",
        `merging into itself answered ${JSON.stringify(selfRefusal)}`,
      );

      const dupTarget = await createDb(root, "health", "Duplicate Ids Target", [
        { name: "Name", type: "text" },
      ]);
      const dupSource = await createDb(root, "health", "Duplicate Ids Source", [
        { name: "Name", type: "text" },
      ]);
      const duplicateIdsRefusal = await recordRefusal("duplicateIds", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: dupTarget.id,
        sourceDatabaseIds: [dupSource.id, dupSource.id],
      });
      scenario(
        "merge-refusal-duplicate-ids",
        duplicateIdsRefusal.code === "VALIDATION",
        `duplicate source ids answered ${JSON.stringify(duplicateIdsRefusal)}`,
      );

      const missingTarget = await createDb(root, "health", "Missing Id Target", [
        { name: "Name", type: "text" },
      ]);
      const missingIdRefusal = await recordRefusal("missingId", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: missingTarget.id,
        sourceDatabaseIds: ["no-such-source-database"],
      });
      scenario(
        "merge-refusal-missing-id",
        /not found/i.test(missingIdRefusal.message),
        `a missing source id answered ${JSON.stringify(missingIdRefusal)}`,
      );

      // Adapter guards apply to the target AND every source.
      const adapterMergeTarget = await createDb(root, "health", "Adapter Merge Target", [
        { name: "Name", type: "text" },
      ]);
      const adapterMergeSource = await createDb(root, "health", "Adapter Merge Source", [
        { name: "Name", type: "text" },
      ]);
      bindAdapter(root, "health", adapterMergeTarget.id);
      const adapterTargetRefusal = await recordRefusal("adapterTarget", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: adapterMergeTarget.id,
        sourceDatabaseIds: [adapterMergeSource.id],
      });
      scenario(
        "merge-refusal-adapter-target",
        adapterTargetRefusal.code === "VALIDATION" &&
          /unlink the adapter first/i.test(adapterTargetRefusal.message),
        `adapter-linked target answered ${JSON.stringify(adapterTargetRefusal)}`,
      );

      const adapterSourceTarget = await createDb(root, "health", "Adapter Source Target", [
        { name: "Name", type: "text" },
      ]);
      const adapterBoundSource = await createDb(root, "health", "Adapter Bound Source", [
        { name: "Name", type: "text" },
      ]);
      bindAdapter(root, "health", adapterBoundSource.id);
      const adapterSourceRefusal = await recordRefusal("adapterSource", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: adapterSourceTarget.id,
        sourceDatabaseIds: [adapterBoundSource.id],
      });
      scenario(
        "merge-refusal-adapter-source",
        adapterSourceRefusal.code === "VALIDATION" &&
          /unlink the adapter first/i.test(adapterSourceRefusal.message),
        `adapter-linked source answered ${JSON.stringify(adapterSourceRefusal)}`,
      );

      // The Finance kit owns its databases, as target and as source.
      const financeMergeSource = await createDb(root, "financial", "Finance Merge Source", [
        { name: "Name", type: "text" },
      ]);
      const financeTargetRefusal = await recordRefusal("financeTarget", "merge_databases", {
        domainSlug: "financial",
        targetDatabaseId: FINANCE_DB_IDS.accounts,
        sourceDatabaseIds: [financeMergeSource.id],
      });
      scenario(
        "merge-refusal-finance-target",
        financeTargetRefusal.code === "VALIDATION" &&
          /kit/i.test(financeTargetRefusal.message),
        `Finance-kit target answered ${JSON.stringify(financeTargetRefusal)}`,
      );

      const financeTarget = await createDb(root, "financial", "Finance Target", [
        { name: "Name", type: "text" },
      ]);
      const financeSourceRefusal = await recordRefusal("financeSource", "merge_databases", {
        domainSlug: "financial",
        targetDatabaseId: financeTarget.id,
        sourceDatabaseIds: [FINANCE_DB_IDS.accounts],
      });
      scenario(
        "merge-refusal-finance-source",
        financeSourceRefusal.code === "VALIDATION" &&
          /kit/i.test(financeSourceRefusal.message),
        `Finance-kit source answered ${JSON.stringify(financeSourceRefusal)}`,
      );

      // A saved card on a SOURCE blocks the merge (deleting the source would
      // strand the card); the target case above proves the asymmetry.
      const viewSourceTarget = await createDb(root, "health", "View Source Target", [
        { name: "Name", type: "text" },
      ]);
      const viewBoundSource = await createDb(root, "health", "View Bound Source", [
        { name: "Name", type: "text" },
      ]);
      unwrap(
        await saveView(root, "health", metricView(viewBoundSource.id, "Source card")),
        "saveView(Source card)",
      );
      const viewSourceRefusal = await recordRefusal("viewSource", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: viewSourceTarget.id,
        sourceDatabaseIds: [viewBoundSource.id],
      });
      scenario(
        "merge-refusal-view-source",
        viewSourceRefusal.code === "VALIDATION" &&
          /delete|repoint/i.test(viewSourceRefusal.message) &&
          viewSourceRefusal.message.includes("Source card"),
        `view-referenced source answered ${JSON.stringify(viewSourceRefusal)}`,
      );

      // Another table's relation column on a SOURCE blocks the merge.
      const relationSourceTarget = await createDb(root, "health", "Relation Source Target", [
        { name: "Name", type: "text" },
      ]);
      const relationBoundSource = await createDb(root, "health", "Relation Bound Source", [
        { name: "Name", type: "text" },
      ]);
      const relationFromOther = await createDb(root, "health", "Relation From Other", [
        { name: "Ref Link", type: "relation", relationDatabaseId: relationBoundSource.id },
      ]);
      const relationSourceRefusal = await recordRefusal("relationSource", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: relationSourceTarget.id,
        sourceDatabaseIds: [relationBoundSource.id],
      });
      scenario(
        "merge-refusal-relation-source",
        relationSourceRefusal.code === "VALIDATION" &&
          /remove the relation column first/i.test(relationSourceRefusal.message) &&
          relationSourceRefusal.message.includes("Relation From Other") &&
          relationSourceRefusal.message.includes("Ref Link"),
        `relation-referenced source answered ${JSON.stringify(relationSourceRefusal)}`,
      );
      // A SOURCE relation column that points at its own database cannot survive
      // the move: the merge re-mints every source row id, so each cell would
      // point at nothing afterwards. The reference guards skip a database
      // referencing itself, so the column plan is what refuses it.
      const selfRelationTarget = await createDb(root, "health", "Self Relation Target", [
        { name: "Name", type: "text" },
      ]);
      const selfRelationSource = await createDb(root, "health", "Self Relation Source", [
        { name: "Name", type: "text" },
      ]);
      unwrap(
        await addDatabaseColumn(root, "health", selfRelationSource.id, {
          name: "Related",
          type: "relation",
          relationDatabaseId: selfRelationSource.id,
        }),
        "addDatabaseColumn(Self Relation Source.Related)",
      );
      const selfRelationRefusal = await recordRefusal("selfRelationSource", "merge_databases", {
        domainSlug: "health",
        targetDatabaseId: selfRelationTarget.id,
        sourceDatabaseIds: [selfRelationSource.id],
      });
      scenario(
        "merge-refusal-self-relation-source",
        selfRelationRefusal.code === "VALIDATION" &&
          /Column "Related"/.test(selfRelationRefusal.message) &&
          /relates rows inside/i.test(selfRelationRefusal.message) &&
          selfRelationRefusal.message.includes("Self Relation Source") &&
          (await getDatabase(root, "health", selfRelationSource.id)).ok === true,
        `self-relation source answered ${JSON.stringify(selfRelationRefusal)}`,
      );
      evidence.mergeRefusals = refusals;

      // ═══ create_database: a duplicate name in the same area is refused ════
      const firstHabit = await tool(root, "create_database", {
        domainSlug: "health",
        name: "Habit Tracker",
        columns: [{ name: "Habit", type: "text" }],
      });
      const pendingBeforeDuplicateName = await pendingCount(root);
      const duplicateHabit = await refusal(root, "create_database", {
        domainSlug: "health",
        name: "  habit tracker ",
        columns: [{ name: "Habit", type: "text" }],
      });
      const healthAfterDuplicate = unwrap(
        await listDatabases(root, "health"),
        "listDatabases(health)",
      );
      const habitTrackerDatabases = healthAfterDuplicate.filter(
        (entry) => entry.database.name.trim().toLowerCase() === "habit tracker",
      );
      evidence.createDatabaseDuplicate = {
        created: firstHabit,
        refused: duplicateHabit.code === "VALIDATION",
        refusal: duplicateHabit,
        databasesNamedHabitTracker: habitTrackerDatabases.map((entry) => entry.database.id),
        pendingDecisions: await pendingCount(root),
      };
      scenario(
        "create-database-duplicate-name",
        firstHabit.applied === true &&
          duplicateHabit.code === "VALIDATION" &&
          /already exists/i.test(duplicateHabit.message) &&
          /use it instead/i.test(duplicateHabit.message) &&
          duplicateHabit.message.includes("Habit Tracker") &&
          habitTrackerDatabases.length === 1 &&
          habitTrackerDatabases[0]?.database.id === firstHabit.databaseId &&
          (await pendingCount(root)) === pendingBeforeDuplicateName,
        `duplicate create answered ${JSON.stringify(duplicateHabit)}; databases with that name: ${habitTrackerDatabases.length}`,
      );

      // ═══ approve a delete Decision after the database was deleted by hand ═
      const deleteTwice = await createDb(root, "health", "Delete Twice", [
        { name: "Name", type: "text" },
      ]);
      await addRow(root, "health", deleteTwice, { Name: "Once" });
      const deleteTwiceProposal = await tool(root, "delete_database", {
        domainSlug: "health",
        databaseId: deleteTwice.id,
      });
      const deleteTwiceDecisionId = String(deleteTwiceProposal.decisionId ?? "");
      unwrap(
        await deleteDatabase(root, "health", deleteTwice.id),
        "deleteDatabase(Delete Twice by hand)",
      );
      const deleteTwiceApproval = await resolveDecision(root, deleteTwiceDecisionId, "approved");
      const deleteTwiceDecisionAfter = await decisionById(root, deleteTwiceDecisionId);
      const deleteTwiceGone = await getDatabase(root, "health", deleteTwice.id);
      const deleteTwiceRows = await rowsOf(root, "health", deleteTwice.id);
      const deleteTwiceError = deleteTwiceApproval.ok ? "" : deleteTwiceApproval.error;
      evidence.deleteAlreadyGone = {
        proposal: deleteTwiceProposal,
        approveOk: deleteTwiceApproval.ok,
        approveError: deleteTwiceError,
        terminal: !deleteTwiceApproval.ok,
        decision: {
          status: deleteTwiceDecisionAfter.status,
          reason: deleteTwiceDecisionAfter.reason,
        },
        databaseGone: deleteTwiceGone.ok === false,
        rows: deleteTwiceRows.length,
      };
      scenario(
        "delete-approve-database-already-gone",
        deleteTwiceApproval.ok === false &&
          /not found/i.test(deleteTwiceError) &&
          deleteTwiceDecisionAfter.status === "rejected" &&
          typeof deleteTwiceDecisionAfter.reason === "string" &&
          /not found/i.test(deleteTwiceDecisionAfter.reason) &&
          deleteTwiceGone.ok === false &&
          deleteTwiceRows.length === 0,
        `approve answered ${deleteTwiceApproval.ok ? "ok" : deleteTwiceError}; decision ${deleteTwiceDecisionAfter.status}/${String(deleteTwiceDecisionAfter.reason).slice(0, 160)}`,
      );

      // ── the artifact, and the assertions on the artifact itself ───────────
      const report = {
        pass: true,
        what:
          "Database merge and delete, end to end against a real temp vault: the real " +
          "executeDatabaseTool, the real engine, and every claim read back off disk. No " +
          "Electron and no dev server.",
        command:
          "cd apps/desktop && node --experimental-strip-types --test tests/database-merge-delete-e2e.test.ts",
        contract: ".scratch/database-merge-delete/DESIGN.md — E2E evidence item 1",
        generatedAt: new Date().toISOString(),
        vault: { temp: true, domains: ["health", "financial"] },
        scenarioCount: scenarios.length,
        scenarios,
        requiredScenarios: REQUIRED_SCENARIOS,
        evidence,
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

      // The file on disk is the artifact a reader will open: assert on what was
      // WRITTEN, not on the object still in memory.
      assert.equal(fs.existsSync(REPORT), true, "the run wrote no artifact");
      const written = JSON.parse(fs.readFileSync(REPORT, "utf8")) as typeof report;
      assert.equal(written.pass, true);
      assert.equal(written.scenarioCount, scenarios.length);
      assert.deepEqual(
        written.scenarios.map((entry) => entry.name),
        scenarios.map((entry) => entry.name),
        "the written scenario list moved",
      );
      assert.deepEqual(
        written.scenarios.filter((entry) => !entry.pass),
        [],
        "the written artifact carries a failed scenario",
      );
      assert.deepEqual(
        [...written.scenarios.map((entry) => entry.name)].sort(),
        [...REQUIRED_SCENARIOS].sort(),
        "the written artifact is missing a contract scenario",
      );
      assert.equal(written.evidence.deleteProposal.answer.rowCount, 2);
      assert.equal(written.evidence.deleteApproval.rowsRemaining, 0);
      assert.equal(written.evidence.mergeProposal.answer.targetName, "Supplement log");
      assert.equal(written.evidence.mergeApproval.targetRows, 4);
      assert.equal(written.evidence.mergeApproval.movedRows.length, 3);
      assert.equal(written.evidence.mergeApproval.notesColumn?.type, "text");
      assert.deepEqual(
        [...written.evidence.mergeApproval.timeOptions].sort(),
        ["Evening", "Morning"],
      );
      assert.equal(written.evidence.createDatabaseDuplicate.refused, true);
      assert.equal(written.evidence.deleteAlreadyGone.terminal, true);
      assert.equal(written.evidence.mergeApproval.sources[0].present, false);
      assert.equal(written.evidence.mergeApproval.sources[1].present, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
