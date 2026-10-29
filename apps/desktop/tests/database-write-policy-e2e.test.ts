/**
 * The database write policy, end to end against a real vault.
 *
 * THE OPERATOR'S RULE (2026-10-28), which this rig exists to hold:
 *
 *   "I don't want the agent to file a decision when creating new databases or
 *    adding data to the databases. A confirmation in the chat is sufficient for
 *    then the agent to go ahead and log the transaction or log whatever other
 *    new data into whatever other database... With regards to the other
 *    activities, which would be the update or delete existing data, that should
 *    definitely go through the decision gate and pop up under decision."
 *
 * So the split is by WHAT THE WRITE TOUCHES, not by database or domain:
 *
 *   - ADDING DATA writes immediately, with no Decision: `create_database`,
 *     `upsert_row` without an id, and `insert_rows`.
 *   - CHANGING OR REMOVING EXISTING DATA still files one pending Decision and
 *     writes nothing until it is approved: `upsert_row` with an id,
 *     `delete_row`, and `add_column`.
 *
 * Every call below goes through the real `executeDatabaseTool` against a real
 * temp vault on disk. There is no stub between the tool and the engine: the
 * "wrote" half is read back with the engine's own `getRow` / `getDatabase`, and
 * the "gated" half is read back both before and after `resolveDecision`.
 *
 * Artifact: `e2e/artifacts/database-write-policy.json` — every step's answer and
 * the facts read back off disk. The assertions run on the same JSON this run
 * writes, so the artifact is the evidence rather than a log beside it.
 *
 * Runs under `node --experimental-strip-types --test
 * tests/database-write-policy-e2e.test.ts`; no Electron and no dev server.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  executeDatabaseTool,
  getDatabase,
  getRow,
  listDatabases,
  listDecisions,
  listRows,
  readLog,
  resolveDecision,
} from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/database-write-policy.json");

const AGENT = { type: "agent" as const, id: "e2e", name: "E2E" };

type Answer = Record<string, unknown>;

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

function decisionIdOf(answer: Answer): string {
  const id = answer.decisionId;
  assert.equal(typeof id, "string", `the tool returned no decisionId: ${JSON.stringify(answer)}`);
  return String(id);
}

async function pendingCount(root: string): Promise<number> {
  const listed = await listDecisions(root);
  assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
  return listed.ok ? listed.value.filter((decision) => decision.status === "pending").length : -1;
}

type Check = Record<string, unknown>;

describe("database write policy", () => {
  it("writes new data at once and gates changes and deletes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-write-policy-"));
    try {
      const created = await createVault(root, "Write Policy");
      assert.equal(created.ok, true, created.ok ? "" : created.error);

      const checks: Record<string, Check> = {};

      // ── 1. a new database is written, with its columns, and files nothing ──
      const databaseAnswer = await tool(root, "create_database", {
        domainSlug: "financial",
        name: "Bottles",
        columns: [
          { name: "Bottle", type: "text" },
          { name: "Volume", type: "number" },
        ],
      });
      const databaseId = String(databaseAnswer.databaseId ?? "");
      const createdMeta = await getDatabase(root, "financial", databaseId);
      assert.equal(createdMeta.ok, true, "the new database is not in the registry");
      const bottleColumn = createdMeta.ok
        ? createdMeta.value.columns.find((column) => column.name === "Bottle")
        : undefined;
      const volumeColumn = createdMeta.ok
        ? createdMeta.value.columns.find((column) => column.name === "Volume")
        : undefined;
      assert.ok(bottleColumn, "the database was written without its Bottle column");
      assert.ok(volumeColumn, "the database was written without its Volume column");
      const pendingAfterCreate = await pendingCount(root);
      checks.createDatabase = {
        answer: databaseAnswer,
        columnsOnDisk: createdMeta.ok ? createdMeta.value.columns.map((column) => column.name) : [],
        pendingDecisions: pendingAfterCreate,
      };
      assert.equal(databaseAnswer.applied, true, "create_database did not report applied: true");
      assert.equal(databaseAnswer.columns, 2, "create_database reported the wrong column count");
      assert.equal(pendingAfterCreate, 0, "creating a database filed a pending Decision");

      const cellsFor = (bottle: string, volume: number) => ({
        [bottleColumn!.id]: bottle,
        [volumeColumn!.id]: volume,
      });

      // ── 2. a single new row is written and logged, and files nothing ───────
      const single = await tool(root, "upsert_row", {
        domainSlug: "financial",
        databaseId,
        cells: cellsFor("Kleintjie", 750),
      });
      const singleRowId = String(single.rowId ?? "");
      const singleRead = await getRow(root, "financial", databaseId, singleRowId);
      checks.createRow = {
        answer: single,
        row: singleRead.ok ? singleRead.value.cells : null,
        pendingDecisions: await pendingCount(root),
      };
      assert.equal(single.posted, true, "upsert_row create did not report posted: true");
      assert.equal(single.applied, true, "upsert_row create did not report applied: true");
      assert.equal(singleRead.ok, true, "the new row is not in the database");
      assert.equal((await pendingCount(root)) === 0, true, "a new row filed a pending Decision");

      // ── 3. a batch of new rows is written in one call and files nothing ────
      const batch = await tool(root, "insert_rows", {
        domainSlug: "financial",
        databaseId,
        rows: [cellsFor("Wine", 1500), cellsFor("Brandy", 1000)],
      });
      const listedRows = await listRows(root, "financial", databaseId, { limit: 100, offset: 0 });
      checks.insertRows = {
        answer: batch,
        rowsOnDisk: listedRows.ok ? listedRows.value.length : -1,
        pendingDecisions: await pendingCount(root),
      };
      assert.equal(batch.posted, true, "insert_rows did not report posted: true");
      assert.equal(batch.rowCount, 2, "insert_rows reported the wrong row count");
      assert.equal(listedRows.ok && listedRows.value.length, 3, "the batch did not all land");
      assert.equal((await pendingCount(root)) === 0, true, "inserting rows filed a pending Decision");

      // ── 4. the applied writes are in the Life log, where no card shows them ─
      const log = await readLog(root);
      assert.equal(log.ok, true, log.ok ? "" : log.error);
      const appliedLogTypes = log.ok
        ? log.value
            .filter((event) => /^database\.(created|row\.created|rows\.created)$/.test(event.type))
            .map((event) => event.type)
        : [];
      checks.log = { types: appliedLogTypes };
      assert.ok(
        appliedLogTypes.includes("database.created"),
        "creating a database left no database.created log line",
      );
      assert.ok(
        appliedLogTypes.includes("database.row.created"),
        "adding a row left no database.row.created log line",
      );
      assert.ok(
        appliedLogTypes.includes("database.rows.created"),
        "adding a batch left no database.rows.created log line",
      );

      // ── 5. an update is gated, and does not write before approval ──────────
      const update = await tool(root, "upsert_row", {
        domainSlug: "financial",
        databaseId,
        id: singleRowId,
        cells: cellsFor("Kleintjie", 1000),
      });
      const updateDecisionId = decisionIdOf(update);
      const beforeApproveRow = await getRow(root, "financial", databaseId, singleRowId);
      const beforeApproveVolume = beforeApproveRow.ok
        ? beforeApproveRow.value.cells[volumeColumn!.id]
        : null;
      const pendingAfterUpdate = await pendingCount(root);
      checks.updateRow = {
        answer: update,
        volumeBeforeApprove: beforeApproveVolume,
        pendingDecisions: pendingAfterUpdate,
      };
      assert.equal(update.status, "pending", "an update did not file a pending Decision");
      assert.equal(update.posted, false, "an update reported posted: true before approval");
      assert.equal(beforeApproveVolume, 750, "the update wrote to the row before approval");
      assert.equal(pendingAfterUpdate, 1, "the update is not exactly one pending Decision");
      const approvedUpdate = await resolveDecision(root, updateDecisionId, "approved");
      assert.equal(approvedUpdate.ok, true, approvedUpdate.ok ? "" : approvedUpdate.error);
      const afterApproveRow = await getRow(root, "financial", databaseId, singleRowId);
      checks.updateRow.volumeAfterApprove = afterApproveRow.ok
        ? afterApproveRow.value.cells[volumeColumn!.id]
        : null;
      assert.equal(
        afterApproveRow.ok && afterApproveRow.value.cells[volumeColumn!.id],
        1000,
        "approving the update did not apply it",
      );

      // ── 6. a delete is gated, and the row survives until approval ──────────
      const removal = await tool(root, "delete_row", {
        domainSlug: "financial",
        databaseId,
        id: singleRowId,
      });
      const removalDecisionId = decisionIdOf(removal);
      const rowBeforeDeleteApprove = await getRow(root, "financial", databaseId, singleRowId);
      checks.deleteRow = {
        answer: removal,
        rowStillThere: rowBeforeDeleteApprove.ok,
        pendingDecisions: await pendingCount(root),
      };
      assert.equal(removal.status, "pending", "a delete did not file a pending Decision");
      assert.equal(rowBeforeDeleteApprove.ok, true, "the row was deleted before approval");
      assert.equal((await pendingCount(root)) === 1, true, "the delete is not exactly one pending Decision");
      const approvedDelete = await resolveDecision(root, removalDecisionId, "approved");
      assert.equal(approvedDelete.ok, true, approvedDelete.ok ? "" : approvedDelete.error);
      const rowAfterDeleteApprove = await getRow(root, "financial", databaseId, singleRowId);
      checks.deleteRow.rowAfterApprove = rowAfterDeleteApprove.ok;
      assert.equal(rowAfterDeleteApprove.ok, false, "approving the delete did not remove the row");

      // ── 7. a schema change is gated, and the column appears only on approval
      const columnChange = await tool(root, "add_column", {
        domainSlug: "financial",
        databaseId,
        name: "Opened On",
        type: "date",
      });
      const columnDecisionId = decisionIdOf(columnChange);
      const beforeColumnApprove = await getDatabase(root, "financial", databaseId);
      checks.addColumn = {
        answer: columnChange,
        columnsBeforeApprove: beforeColumnApprove.ok
          ? beforeColumnApprove.value.columns.map((column) => column.name)
          : [],
      };
      assert.equal(columnChange.status, "pending", "add_column did not file a pending Decision");
      assert.equal(
        beforeColumnApprove.ok &&
          beforeColumnApprove.value.columns.some((column) => column.name === "Opened On"),
        false,
        "add_column wrote the column before approval",
      );
      const approvedColumn = await resolveDecision(root, columnDecisionId, "approved");
      assert.equal(approvedColumn.ok, true, approvedColumn.ok ? "" : approvedColumn.error);
      const afterColumnApprove = await getDatabase(root, "financial", databaseId);
      checks.addColumn.columnsAfterApprove = afterColumnApprove.ok
        ? afterColumnApprove.value.columns.map((column) => column.name)
        : [];
      assert.equal(
        afterColumnApprove.ok &&
          afterColumnApprove.value.columns.some((column) => column.name === "Opened On"),
        true,
        "approving the column did not add it",
      );

      // ── 8. a bad schema writes nothing and files nothing ───────────────────
      const pendingBeforeBad = await pendingCount(root);
      const badCreate = await executeDatabaseTool(root, AGENT, "create_database", {
        domainSlug: "financial",
        name: "Broken",
        columns: [{ name: "That row", type: "relation" }],
      });
      const databases = await listDatabases(root, "financial");
      const brokeNothing =
        databases.ok && !databases.value.some((entry) => entry.database.name === "Broken");
      checks.invalidCreate = {
        answer: badCreate,
        databaseWritten: !brokeNothing,
        pendingDecisions: await pendingCount(root),
      };
      assert.equal(
        "error" in badCreate,
        true,
        `a relation column without a target was accepted: ${JSON.stringify(badCreate)}`,
      );
      assert.equal(brokeNothing, true, "a refused create still wrote the database");
      assert.equal(await pendingCount(root), pendingBeforeBad, "a refused create filed a Decision");

      const report = {
        pass: true,
        ranAt: new Date().toISOString(),
        command: "npm test -w @lifequest/desktop (tests/database-write-policy-e2e.test.ts)",
        policy: {
          direct: ["create_database", "upsert_row (no id)", "insert_rows"],
          gated: ["upsert_row (with id)", "delete_row", "add_column"],
        },
        databaseId,
        checks,
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

      // The artifact is the evidence: read it back and hold its claims.
      const written = JSON.parse(fs.readFileSync(REPORT, "utf8")) as typeof report;
      assert.equal(written.pass, true);
      assert.equal(written.checks.createDatabase.pendingDecisions, 0);
      assert.equal(written.checks.createRow.pendingDecisions, 0);
      assert.equal(written.checks.insertRows.pendingDecisions, 0);
      assert.equal(written.checks.updateRow.volumeBeforeApprove, 750);
      assert.equal(written.checks.updateRow.volumeAfterApprove, 1000);
      assert.equal(written.checks.deleteRow.rowStillThere, true);
      assert.equal(written.checks.deleteRow.rowAfterApprove, false);
      assert.equal(written.checks.invalidCreate.databaseWritten, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
