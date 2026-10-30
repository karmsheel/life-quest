/**
 * E2E for the read path behind the Decisions page: a Decision filed against an
 * operator-created database carries a cell map keyed by column id, and every
 * column added through add_column is a uuid. The stored file must keep that id
 * (the approve path writes from it); what the page reads must carry the column's
 * name beside it, or the card's Field column shows `0a1b2c3d…`.
 *
 * This drives the real propose path (`executeDatabaseTool` as an agent), the real
 * vault files, and the same `withDecisionDisplayLabels` the inbox calls. The
 * Electron rig (`decision-body.electron.mjs`) proves what the card does with the
 * result; this proves the names are actually resolved and the stored Decision is
 * not rewritten. `npm test` runs it without a dev server.
 *
 * Artifact: `e2e/artifacts/decision-fields-read.json` — pass/fail, the ids, the
 * names, and both bodies. The assertion runs on the same JSON it writes.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  addDatabaseColumn,
  createDatabase,
  createDecision,
  createVault,
  executeDatabaseTool,
  executeViewTool,
  listDecisions,
  setPinBoardLocked,
  upsertRow,
  USER_ACTOR,
  withDecisionDisplayLabels,
} from "@lifequest/vault-core";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(desktopRoot, "e2e/artifacts/decision-fields-read.json");
const AGENT = { type: "agent" as const, id: "e2e", name: "E2E" };

type Field = { id: string; name: string };

async function addColumn(
  root: string,
  databaseId: string,
  name: string,
  type: "text" | "number" | "date",
): Promise<Field> {
  const added = await addDatabaseColumn(root, "financial", databaseId, { name, type });
  assert.equal(added.ok, true, `add_column failed for ${name}`);
  const column = added.ok ? added.value.columns.find((entry) => entry.name === name) : null;
  assert.ok(column, `the registry has no ${name} column after adding it`);
  return { id: column.id, name: column.name };
}

function cells(fields: { bottle: Field; volume: Field; opened: Field }, values: [string, number, string]) {
  return {
    [fields.bottle.id]: values[0],
    [fields.volume.id]: values[1],
    [fields.opened.id]: values[2],
  };
}

describe("decision field names on read", () => {
  it("resolves an operator database's column names without rewriting the stored Decision", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lq-decision-fields-"));
    try {
      const created = await createVault(root, "Decision Fields");
      assert.equal(created.ok, true, created.ok ? "" : created.error);

      const database = await createDatabase(root, "financial", { name: "Bottles" });
      assert.equal(database.ok, true, database.ok ? "" : database.error);
      const databaseId = database.ok ? database.value.id : "";

      const fields = {
        bottle: await addColumn(root, databaseId, "Bottle", "text"),
        volume: await addColumn(root, databaseId, "Volume", "number"),
        opened: await addColumn(root, databaseId, "Opened On", "date"),
      };
      const rowId = randomUUID();
      const seeded = await upsertRow(root, "financial", databaseId, {
        id: rowId,
        cells: cells(fields, ["Kleintjie", 750, "2026-10-01"]),
      });
      assert.equal(seeded.ok, true, seeded.ok ? "" : seeded.error);

      // ── one row write ────────────────────────────────────────────────────
      const filed = (await executeDatabaseTool(root, AGENT, "upsert_row", {
        domainSlug: "financial",
        databaseId,
        id: rowId,
        cells: cells(fields, ["Kleintjie", 1000, "2026-10-01"]),
      })) as { decisionId?: string; status?: string };
      assert.equal(filed.status, "pending", `the write was not filed as a pending Decision: ${JSON.stringify(filed)}`);
      assert.ok(filed.decisionId, "the tool returned no decisionId");

      const listed = await listDecisions(root);
      assert.equal(listed.ok, true, listed.ok ? "" : listed.error);
      const raw = listed.ok ? listed.value.find((entry) => entry.id === filed.decisionId) : undefined;
      assert.ok(raw, "the filed Decision is not in the vault's list");
      assert.equal(
        raw.proposedBodyMarkdown.includes("columnNames"),
        false,
        "the stored Decision already carries display labels",
      );
      for (const field of Object.values(fields)) {
        assert.ok(
          raw.proposedBodyMarkdown.includes(field.id),
          `the stored body dropped the ${field.name} column id`,
        );
      }

      const decisionPath = path.join(root, ".lifequest", "decisions", `${raw.id}.json`);
      const storedText = fs.readFileSync(decisionPath, "utf8");
      const stored = JSON.parse(storedText) as { proposedBodyMarkdown: string };
      assert.deepEqual(
        JSON.parse(stored.proposedBodyMarkdown),
        JSON.parse(raw.proposedBodyMarkdown),
        "listDecisions rewrote the stored body",
      );

      const [resolved] = await withDecisionDisplayLabels(root, [raw]);
      assert.ok(resolved, "withDecisionDisplayLabels returned no Decision");
      const body = JSON.parse(resolved.proposedBodyMarkdown) as {
        columnNames?: Record<string, string>;
      };
      assert.deepEqual(body.columnNames, {
        [fields.bottle.id]: "Bottle",
        [fields.volume.id]: "Volume",
        [fields.opened.id]: "Opened On",
      });
      // The ids stay in the body the approve path reads.
      const resolvedCells = JSON.parse(resolved.proposedBodyMarkdown) as { cells: Record<string, unknown> };
      assert.deepEqual(Object.keys(resolvedCells.cells).sort(), Object.values(fields).map((field) => field.id).sort());
      assert.equal(
        fs.readFileSync(decisionPath, "utf8"),
        storedText,
        "reading for display rewrote the file on disk",
      );

      // ── a batch insert ───────────────────────────────────────────────────
      // New rows are no longer gated (operator policy, 2026-10-28), so the tool
      // writes them and files nothing. The batch Decision shape still exists in
      // vaults that filed one before that change, and the inbox still has to
      // read its column names — so this files the same body directly, the way
      // `createDecision` did, and asks the read path to label it.
      const batchRows = [
        { id: randomUUID(), cells: cells(fields, ["Wine", 1500, "2026-10-02"]), rowLabel: "Wine" },
        { id: randomUUID(), cells: cells(fields, ["Brandy", 1000, "2026-10-03"]), rowLabel: "Brandy" },
      ];
      const batchFiled = await createDecision(root, {
        target: { type: "database-batch", domainSlug: "financial", databaseId },
        proposedTitle: "Insert 2 rows into Bottles",
        proposedBodyMarkdown: JSON.stringify(
          { op: "insert-rows", databaseName: "Bottles", rows: batchRows },
          null,
          2,
        ),
        previousBodyMarkdown: null,
        actor: AGENT,
      });
      assert.equal(batchFiled.ok, true, batchFiled.ok ? "" : batchFiled.error);
      const batchDecisionId = batchFiled.ok ? batchFiled.value.id : "";
      const afterBatch = await listDecisions(root);
      assert.equal(afterBatch.ok, true, afterBatch.ok ? "" : afterBatch.error);
      const batchRaw = afterBatch.ok
        ? afterBatch.value.find((entry) => entry.id === batchDecisionId)
        : undefined;
      assert.ok(batchRaw, "the filed batch Decision is not in the vault's list");
      assert.equal(batchRaw.proposedBodyMarkdown.includes("columnNames"), false);
      const [batchResolved] = await withDecisionDisplayLabels(root, [batchRaw]);
      const batchBody = JSON.parse(batchResolved!.proposedBodyMarkdown) as {
        columnNames?: Record<string, string>;
        rows: { cells: Record<string, unknown> }[];
      };
      assert.deepEqual(batchBody.columnNames, {
        [fields.bottle.id]: "Bottle",
        [fields.volume.id]: "Volume",
        [fields.opened.id]: "Opened On",
      });
      assert.equal(batchBody.rows.length, 2, "the batch resolved a different number of rows");

      // ── a dashboard-view Decision ────────────────────────────────────────
      // A locked board files the spec instead of saving it. The card prints the
      // measure and grouping as prose, and those name columns by id too.
      const locked = await setPinBoardLocked(root, null, true, USER_ACTOR);
      assert.equal(locked.ok, true, locked.ok ? "" : locked.error);
      const viewFiled = (await executeViewTool(root, AGENT, "save_view", {
        domainSlug: "financial",
        boardSlug: null,
        spec: {
          schemaVersion: 1,
          databaseId,
          title: "Bottles",
          presentation: "table",
          groupBy: fields.bottle.id,
          timeBucket: null,
          timeColumnId: null,
          timeWindow: "all",
          filters: [],
          measure: "sum",
          measureColumnId: fields.volume.id,
          per: null,
          sort: { by: "label", dir: "asc" },
          limit: 12,
          convertToZar: false,
          columns: [],
        },
      })) as { proposed?: boolean; decisionId?: string; error?: unknown };
      assert.equal(viewFiled.proposed, true, `the view was not filed: ${JSON.stringify(viewFiled)}`);
      const afterView = await listDecisions(root);
      assert.equal(afterView.ok, true, afterView.ok ? "" : afterView.error);
      const viewRaw = afterView.ok
        ? afterView.value.find((entry) => entry.id === viewFiled.decisionId)
        : undefined;
      assert.ok(viewRaw, "the filed view Decision is not in the vault's list");
      assert.equal(viewRaw.proposedBodyMarkdown.includes("measureColumnName"), false);
      assert.ok(viewRaw.proposedBodyMarkdown.includes(fields.volume.id));
      const [viewResolved] = await withDecisionDisplayLabels(root, [viewRaw]);
      const viewSpec = (
        JSON.parse(viewResolved!.proposedBodyMarkdown) as {
          spec: {
            measureColumnName?: string;
            groupByName?: string;
            columnNames?: Record<string, string>;
          };
        }
      ).spec;
      assert.equal(viewSpec.measureColumnName, "Volume");
      assert.equal(viewSpec.groupByName, "Bottle");
      assert.equal(viewSpec.columnNames?.[fields.volume.id], "Volume");
      assert.equal(viewSpec.columnNames?.[fields.bottle.id], "Bottle");

      const report = {
        pass: true,
        ranAt: new Date().toISOString(),
        command: "npm test -w @lifequest/desktop (tests/decision-fields-read-e2e.test.ts)",
        database: { id: databaseId, name: "Bottles" },
        fields,
        row: {
          decisionId: raw.id,
          storedBody: JSON.parse(stored.proposedBodyMarkdown),
          resolvedBody: JSON.parse(resolved.proposedBodyMarkdown),
          storedFileUnchanged: true,
        },
        batch: {
          decisionId: batchRaw.id,
          rawBody: JSON.parse(batchRaw.proposedBodyMarkdown),
          resolvedBody: JSON.parse(batchResolved!.proposedBodyMarkdown),
        },
        view: {
          decisionId: viewRaw.id,
          rawBody: JSON.parse(viewRaw.proposedBodyMarkdown),
          resolvedBody: JSON.parse(viewResolved!.proposedBodyMarkdown),
        },
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
