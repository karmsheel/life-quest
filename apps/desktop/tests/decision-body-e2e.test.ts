import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/decision-body.json");
const TARGETS = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-page-mapping.json"), "utf8"),
) as {
  page: { ids: { databaseId: string; mileageColumnId: string; distanceColumnId: string; assumptionSetId: string } };
  mapping: { target: { mappingId: string } };
};
const CUSTOM = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-custom-fields.json"), "utf8"),
) as {
  ids: { bottle: string; volume: string; opened: string };
  raw: unknown;
  resolved: unknown;
  batch: { body: unknown; resolved: unknown };
};

/**
 * The rig renders the real DecisionBody in a real layout engine, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` turns it on.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/decision-body.electron.mjs")],
      { cwd: desktopRoot, timeout: 120_000 },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

type Cell = { text: string; title: string | null };
type Block = { kind: string; detail: string; title: string | null };
type MappingRow = { source: string; column: string; columnTitle: string | null };

type Sample = {
  inboxWidth: number | null;
  changedRows: number;
  lead: string;
  readable: string;
  exactPayload: string | null;
  rows: { field: string; fieldTitle: string | null; cells: Cell[] }[];
};

type BatchSample = {
  inboxWidth: number | null;
  lead: string;
  sections: {
    lead: string;
    columns: string[];
    rows: { field: string; fieldTitle: string | null; cells: Cell[] }[];
  }[];
  readable: string;
  exactPayload: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    rawShowsShortId: boolean;
    pageRawShowsShortId: boolean;
    mappingRawShowsShortId: boolean;
    exactPayloadUnchanged: boolean;
    pageExactPayloadUnchanged: boolean;
    mappingExactPayloadUnchanged: boolean;
    labelledCellTitles: string[];
    inboxWidth: number | null;
    batchLead: string;
    batchLeads: string[];
    batchColumns: string[][];
    batchFields: string[][];
    batchRawIdOnScreen: boolean;
    batchExactPayloadUnchanged: boolean;
    batchResolvedRelations: { field: string; text: string; title: string | null }[];
    batchReadableHoldsNoShortId: boolean;
    batchResolvedExactPayloadUnchanged: boolean;
    customRawFields: string[];
    customRawShowsShortId: boolean;
    customFieldNames: string[];
    customFieldTitles: (string | null)[];
    customReadableHoldsNoShortId: boolean;
    customExactPayloadUnchanged: boolean;
    customBatchRawFields: string[];
    customBatchRawShowsShortId: boolean;
    customBatchFields: string[][];
    customBatchFieldTitles: (string | null)[][];
    customBatchReadableHoldsNoShortId: boolean;
    customBatchExactPayloadUnchanged: boolean;
    viewRawFields: { label: string; value: string }[];
    viewRawShowsShortId: boolean;
    viewFields: { label: string; value: string }[];
    viewMeasure: string | null;
    viewGroupBy: string | null;
    viewReadableHoldsNoShortId: boolean;
    viewExactPayloadUnchanged: boolean;
  };
  raw: Sample;
  resolved: Sample;
  pageRaw: { blocks: Block[]; readable: string };
  page: { blocks: Block[]; readable: string };
  mappingRaw: { lead: string; rows: MappingRow[]; readable: string };
  mapping: { lead: string; rows: MappingRow[]; readable: string };
  batchRaw: BatchSample;
  batchResolved: BatchSample;
  customRaw: Sample;
  customResolved: Sample;
  customBatchRaw: BatchSample;
  customBatch: BatchSample;
  viewRaw: { fields: { label: string; value: string }[]; readable: string; exactPayload: string | null };
  viewResolved: { fields: { label: string; value: string }[]; readable: string; exactPayload: string | null };
};

/** "47083ecb…" — the shortId the card falls back to for a raw id. */
const SHORT_ID = /[0-9a-f]{8}…/;

describe("decision body labels", () => {
  it("shows a relation's row label instead of its id, and keeps the id reachable", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // The before state is real, so the after state is not a rig that cannot tell
    // the difference: as filed, the Category row showed a truncated row id.
    assert.equal(report.checks.rawShowsShortId, true, "the filed body no longer shows an id to fix");

    // Only the category moved. A cell that was empty before and is simply
    // absent from the full replace is not a change: three of them used to be
    // presented as empty-to-empty rows.
    assert.equal(report.resolved.changedRows, 1, "empty-to-empty cells still read as changes");
    assert.match(report.resolved.lead, /1 field would change/, "the lead hides the single change");

    const category = report.resolved.rows.find((row) => row.field === "Category");
    assert.ok(category, "no Category row rendered");
    assert.equal(category.cells[0]?.text, "Uncategorized", "the row's current category is unreadable");
    assert.equal(category.cells.at(-1)?.text, "Groceries", "the proposed category is unreadable");

    // No id in the readable area, both ids behind a tooltip, and the exact
    // payload the approve path will use left exactly as it was filed.
    assert.doesNotMatch(report.resolved.readable, SHORT_ID, "an id is still on screen");
    assert.equal(report.checks.labelledCellTitles.length >= 2, true, "the ids were dropped, not moved");
    assert.equal(report.checks.exactPayloadUnchanged, true, "the card rewrote the body");
    assert.match(report.resolved.exactPayload ?? "", /47083ecb-b581-4ba2-8a6a-2db8cf2d5a87/);

    // The card keeps the width the inbox gives it (52rem), so this is the column
    // the operator reads, not an unconstrained harness layout.
    assert.ok(
      report.checks.inboxWidth !== null && report.checks.inboxWidth <= 832,
      `inbox rendered ${report.checks.inboxWidth}px wide, wider than the 52rem column`,
    );
  });

  it("names what a page block is bound to and what a mapping maps onto", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const ids = TARGETS.page.ids;

    // As filed, a block shows the database as a slug pair and a column uuid as
    // "8f3d2b41…"; the assumption set's id reads as prose that is not its name.
    assert.ok(
      report.pageRaw.blocks.some((block) => block.detail === "Finance · transactions"),
      "the page fixture no longer shows the raw database id",
    );
    assert.equal(report.checks.pageRawShowsShortId, true, "the filed page shows no column id");
    assert.ok(
      report.pageRaw.blocks.some((block) => block.detail === "Finance assumption scenario 1"),
      "the page fixture no longer shows the raw assumption set id",
    );

    assert.deepEqual(
      report.page.blocks.map((block) => `${block.kind} ${block.detail}`),
      [
        "Table Transactions",
        "Metric Sum · Mileage",
        "Chart Line · Distance",
        "Scenario Scenario 1",
        "Note Top spend this month.",
      ],
      "a page block is still unreadable",
    );
    // Every block that named something keeps the id it named, so the operator
    // can still check it against the vault; a markdown block names nothing.
    assert.deepEqual(
      report.page.blocks.map((block) => block.title),
      [ids.databaseId, ids.mileageColumnId, ids.distanceColumnId, ids.assumptionSetId, null],
      "the page block tooltips do not hold the raw ids",
    );
    assert.doesNotMatch(report.page.readable, SHORT_ID, "a column id is still on the page");
    assert.equal(report.checks.pageExactPayloadUnchanged, true, "the page card rewrote the body");

    // The mapping names the database in its lead and each column it maps onto.
    assert.equal(report.checks.mappingRawShowsShortId, true, "the filed mapping shows no column id");
    assert.match(report.mapping.lead, /Map incoming columns onto Transactions\.$/);
    assert.deepEqual(
      report.mapping.rows.map((row) => row.column),
      ["Date", "Mileage", "Unmapped"],
      "a mapped column is still unreadable",
    );
    assert.equal(
      report.mapping.rows[1]?.columnTitle,
      ids.mileageColumnId,
      "the mapped column does not keep its raw id",
    );
    assert.equal(report.mapping.rows[2]?.columnTitle, null, "an unmapped column claims an id");
    assert.doesNotMatch(report.mapping.readable, SHORT_ID, "a column id is still on the mapping");
    assert.equal(report.checks.mappingExactPayloadUnchanged, true, "the mapping card rewrote the body");
  });

  it("draws a batch insert as one table per row, and names the rows it points at", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const batch = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-batch.json"), "utf8"),
    ) as {
      body: { databaseName: string; rows: { rowLabel: string | null }[] };
      resolved: unknown;
    };

    // The lead counts the rows and names the database, and each row gets its own
    // table: an insert has no before state, so no table offers one.
    assert.equal(
      report.checks.batchLead,
      `Insert ${batch.body.rows.length} rows into ${batch.body.databaseName}.`,
      "the batch lead does not count the rows",
    );
    assert.deepEqual(
      report.batchRaw.sections.map((section) => section.lead),
      batch.body.rows.map((row, index) => `${row.rowLabel ?? `Row ${index + 1}`}.`),
      "a row is not titled by its label, nor by its number when it carries none",
    );
    assert.deepEqual(
      report.checks.batchColumns,
      batch.body.rows.map(() => ["Field", "Proposed"]),
      "a batch table offers a column an insert cannot fill",
    );
    // A cell the row does not carry is not a field.
    assert.deepEqual(
      report.checks.batchFields.filter((fields) => fields.includes("Notes") || fields.includes("Source file")),
      [],
      "a batch table lists a cell the row does not carry",
    );

    // As filed, a relation cell is the row id the payload carries; as read, the
    // same cell names the row while keeping that id behind it.
    assert.equal(report.checks.batchRawIdOnScreen, true, "the filed batch shows no id to fix");
    const relations = report.checks.batchResolvedRelations;
    assert.ok(relations.length >= 2, "no batch relation cell rendered");
    assert.deepEqual(
      [...new Set(relations.map((cell) => cell.text))].sort(),
      ["Capitec", "Groceries"],
      "a batch relation cell still reads as an id",
    );
    assert.equal(report.checks.batchReadableHoldsNoShortId, true, "an id is still on screen");

    // Neither variant may rewrite the body it was handed: the exact payload is
    // what the approve path will write.
    assert.equal(report.checks.batchExactPayloadUnchanged, true, "the card rewrote the filed body");
    assert.equal(
      report.checks.batchResolvedExactPayloadUnchanged,
      true,
      "the card rewrote the read body",
    );
    assert.deepEqual(
      JSON.parse(report.batchRaw.exactPayload ?? "null"),
      batch.body,
      "the exact payload is not the filed body",
    );
  });

  it("names an operator database's fields by their column names, not their ids", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const wantFields = ["Bottle", "Volume", "Opened On"];
    const wantTitles = {
      Bottle: CUSTOM.ids.bottle,
      Volume: CUSTOM.ids.volume,
      "Opened On": CUSTOM.ids.opened,
    };

    // The reproduced defect: as filed, the Field column is the column id. This
    // is a uuid the add_column path minted, not the finance kit's readable id.
    assert.equal(
      report.checks.customRawShowsShortId,
      true,
      "the filed operator database shows no field id to fix",
    );
    assert.deepEqual(
      report.checks.customRawFields.map((field) => SHORT_ID.test(field)),
      [true, true, true],
      "the filed field labels are not the raw column ids",
    );

    // As read, each row's field is the column name, and the id it stands for is
    // still reachable in that header's tooltip. A diff card prints its changed
    // row first, so the card's order is not the payload's: compare the set.
    assert.deepEqual(
      [...report.customResolved.rows.map((row) => row.field)].sort(),
      [...wantFields].sort(),
    );
    assert.deepEqual(
      Object.fromEntries(report.customResolved.rows.map((row) => [row.field, row.fieldTitle])),
      wantTitles,
      "the field labels do not keep the raw column ids",
    );
    assert.doesNotMatch(
      report.customResolved.readable,
      SHORT_ID,
      "an operator database field id is still on screen",
    );
    assert.equal(
      report.checks.customExactPayloadUnchanged,
      true,
      "the row card rewrote the body it was handed",
    );
    assert.deepEqual(JSON.parse(report.customResolved.exactPayload ?? "null"), CUSTOM.resolved);

    // A batch insert keys every row's cells the same way; each of its tables
    // must show the same field names, not the ids.
    assert.equal(
      report.checks.customBatchRawShowsShortId,
      true,
      "the filed operator batch shows no field id to fix",
    );
    report.customBatch.sections.forEach((section, index) => {
      assert.deepEqual(
        section.rows.map((row) => row.field),
        wantFields,
        `batch row ${index + 1} is not labelled by column name`,
      );
      assert.deepEqual(
        Object.fromEntries(section.rows.map((row) => [row.field, row.fieldTitle])),
        wantTitles,
        `batch row ${index + 1} lost its raw column ids`,
      );
    });
    assert.doesNotMatch(
      report.customBatch.readable,
      SHORT_ID,
      "an operator batch field id is still on screen",
    );
    assert.equal(
      report.checks.customBatchExactPayloadUnchanged,
      true,
      "the batch card rewrote the body it was handed",
    );
    assert.deepEqual(
      JSON.parse(report.customBatch.exactPayload ?? "null"),
      CUSTOM.batch.resolved,
    );
  });

  it("names the columns a dashboard view measures and groups by", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const VIEW = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-view.json"), "utf8"),
    ) as { ids: { bottle: string; volume: string }; resolved: unknown };

    // As filed, both rows print the column id; the card has no other prose to
    // tell the operator what the card reads.
    assert.equal(
      report.checks.viewRawShowsShortId,
      true,
      "the filed view shows no column id to fix",
    );
    const rawMeasure = report.viewRaw.fields.find((field) => field.label === "Measure")?.value;
    const rawGroupBy = report.viewRaw.fields.find((field) => field.label === "Group by")?.value;
    assert.match(rawMeasure ?? "", SHORT_ID, "the filed Measure no longer shows the column id");
    assert.match(rawGroupBy ?? "", SHORT_ID, "the filed Group by no longer shows the column id");

    // As read, the names the read path added stand where the ids stood.
    assert.equal(report.checks.viewMeasure, "sum of Volume");
    assert.equal(report.checks.viewGroupBy, "Bottle");
    assert.doesNotMatch(report.viewResolved.readable, SHORT_ID, "a view column id is still on screen");
    assert.equal(
      report.checks.viewExactPayloadUnchanged,
      true,
      "the view card rewrote the spec it was handed",
    );
    assert.deepEqual(JSON.parse(report.viewResolved.exactPayload ?? "null"), VIEW.resolved);
    // The resolved spec keeps both ids the approve path will save.
    assert.match(JSON.stringify(VIEW.resolved), new RegExp(VIEW.ids.volume));
    assert.match(JSON.stringify(VIEW.resolved), new RegExp(VIEW.ids.bottle));
  });
});
