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
const REPORT = path.join(desktopRoot, "e2e/artifacts/database-merge-delete-card.json");
const PNG = path.join(desktopRoot, "e2e/artifacts/database-merge-delete-card.png");

type Fixture = {
  target: { type: "database"; domainSlug: string; databaseId: string };
  body: {
    op: string;
    databaseName: string;
    rowCount?: number;
    sources?: {
      databaseId: string;
      name: string;
      rowCount: number;
      fingerprint: string;
      columns: { id: string; name: string; type: string }[];
    }[];
    newColumns?: { name: string; type: string; options?: string[] }[];
    widenedColumns?: { columnId: string; options: string[] }[];
    expectedColumns?: { id: string; name: string; type: string }[];
    dedupe?: boolean;
    fingerprint?: string;
  };
};

const DELETE = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-database-delete.json"), "utf8"),
) as Fixture;
const MERGE = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "e2e/fixtures/decision-database-merge.json"), "utf8"),
) as Fixture;

type Cell = { text: string; title: string | null };
type CardRow = { field: string; fieldTitle: string | null; cells: Cell[] };

type CardSample = {
  viewport: { width: number; height: number };
  inboxWidth: number | null;
  hasProposal: boolean;
  hasExactProposal: boolean;
  lead: string;
  leads: string[];
  tableCount: number;
  columns: string[];
  rows: CardRow[];
  readable: string;
  exactPayload: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  fixture: string[];
  screenshot: string;
  viewport: { width: number; height: number };
  checks: {
    deleteLead: string;
    deleteLeadMatchesContract: boolean;
    deleteColumns: string[];
    deleteName: string | null;
    deleteRowCount: string | null;
    deleteConsequence: string | null;
    deleteExactPayloadUnchanged: boolean;
    mergeLead: string;
    mergeLeadMatchesContract: boolean;
    mergeColumns: string[];
    mergeSourceCount: number;
    mergeSources: { field: string; fieldTitle: string | null; cell: string | null }[];
    mergeAddedColumnsSentence: string | null;
    mergeDedupeSentence: string | null;
    mergeExactPayloadUnchanged: boolean;
    inboxWidth: number | null;
    screenshotBytes: number;
    consoleErrors: string[];
  };
  deleteCard: CardSample;
  mergeCard: CardSample;
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
      [path.join(desktopRoot, "e2e/database-merge-delete-card.electron.mjs")],
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

function readReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

const GENERIC_LEAD = "Proposed change";

/** Neither op may fall through to GenericBody: no generic lead, no raw body keys. */
function assertNotGeneric(card: CardSample): void {
  assert.equal(card.hasProposal, true, "the card rendered no structured proposal");
  assert.notEqual(card.lead, GENERIC_LEAD, "the card fell through to the generic JSON body");
  assert.doesNotMatch(card.lead, /^Proposed change\b/, "the card fell through to GenericBody");
  for (const rawField of ["Fingerprint", "Expected columns", "Widened columns"]) {
    assert.equal(
      card.readable.includes(rawField),
      false,
      `the card dumped the raw body key "${rawField}" instead of prose`,
    );
  }
}

function assertExactPayloadUnchanged(card: CardSample, body: unknown): void {
  assert.equal(card.hasExactProposal, true, "the card has no collapsed exact proposal");
  assert.deepEqual(
    JSON.parse(card.exactPayload ?? "null"),
    body,
    "the card rewrote the body it was handed",
  );
}

describe("database merge and delete Decision cards", () => {
  it("draws a whole-database delete as a card, with the row count that goes with it", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(PNG, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = readReport();
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.deepEqual(report.fixture, [
      "fixtures/decision-database-delete.json",
      "fixtures/decision-database-merge.json",
    ]);

    const card = report.deleteCard;
    const body = DELETE.body;
    const rowCount = body.rowCount ?? 0;
    assert.ok(rowCount > 0, "the delete fixture carries no row count to show");

    // The lead names the whole database being deleted, not a row — the operator
    // must not approve this believing one record is going.
    const wantLead = `Delete the database "${body.databaseName}".`;
    assert.equal(report.checks.deleteLead, wantLead);
    assert.equal(report.checks.deleteLeadMatchesContract, true);
    assert.equal(card.lead, wantLead);

    // A delete has no after state: one before-only facts table, naming the
    // database and the rows that are removed with it.
    assert.deepEqual(report.checks.deleteColumns, ["Field", "Now"]);
    assert.deepEqual(card.columns, ["Field", "Now"]);
    const field = (name: string) => card.rows.find((row) => row.field === name);
    assert.equal(field("Name")?.cells[0]?.text, body.databaseName, "the card does not name the database");
    assert.equal(
      field("Rows")?.cells[0]?.text,
      rowCount.toLocaleString(),
      "the card does not state the row count being deleted",
    );
    // The consequence is stated: the rows go with the database and it cannot be
    // undone. A silent "delete the table" would hide losing a ledger.
    assert.match(
      report.checks.deleteConsequence ?? "",
      /rows? (are|is) deleted with it/i,
      "the card does not say the rows are deleted with the database",
    );
    assert.match(report.checks.deleteConsequence ?? "", /cannot be undone/i);
    assert.equal(report.checks.deleteExactPayloadUnchanged, true);

    assertNotGeneric(card);
    assertExactPayloadUnchanged(card, body);

    // The card keeps the width the inbox gives it (52rem), so this is the column
    // the operator reads, not an unconstrained harness layout.
    assert.ok(
      report.checks.inboxWidth !== null && report.checks.inboxWidth <= 832,
      `inbox rendered ${report.checks.inboxWidth}px wide, wider than the 52rem column`,
    );
  });

  it("draws a merge as one decision: every source, the added columns, the dedupe rule", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = readReport();
    const card = report.mergeCard;
    const body = MERGE.body;
    const sources = body.sources ?? [];
    const wantLead =
      `Merge ${sources.length} databases into "${body.databaseName}", ` +
      `then delete the ${sources.length} sources.`;

    // One approval has two effects, and the lead says both: the rows move into
    // the target, and the source databases are deleted.
    assert.equal(report.checks.mergeLead, wantLead);
    assert.equal(report.checks.mergeLeadMatchesContract, true);
    assert.equal(card.lead, wantLead);

    // One before-only row per source, labelled with the source's name. Three of
    // ours share the name "Supplement log" — the duplicate is exactly what the
    // merge collapses — so the database id is the row's unique key and its tooltip.
    assert.deepEqual(report.checks.mergeColumns, ["Field", "Now"]);
    assert.deepEqual(card.columns, ["Field", "Now"]);
    assert.equal(report.checks.mergeSourceCount, sources.length);
    assert.equal(card.rows.length, sources.length);
    sources.forEach((source, index) => {
      const row = card.rows[index];
      assert.ok(row, `the card is missing source ${index + 1} (${source.name})`);
      assert.equal(row.field, source.name, `source ${index + 1} is not labelled by its name`);
      assert.equal(
        row.fieldTitle,
        source.databaseId,
        `source ${index + 1} does not keep its raw database id in the tooltip`,
      );
      assert.equal(
        row.cells[0]?.text,
        `${source.rowCount} ${source.rowCount === 1 ? "row" : "rows"}`,
        `source ${index + 1} does not show its row count`,
      );
    });

    // The schema change is part of the approval: each column the merge adds to
    // the target is named on the card.
    const added = (body.newColumns ?? []).map((column) => column.name);
    assert.ok(added.length > 0, "the merge fixture adds no columns to assert");
    assert.ok(
      report.checks.mergeAddedColumnsSentence,
      "the card lists no columns being added to the target",
    );
    for (const name of added) {
      assert.match(
        report.checks.mergeAddedColumnsSentence,
        new RegExp(`"${name}"`),
        `the card does not name the added column "${name}"`,
      );
    }

    // Dedupe is a promise about rows the operator will never see inserted.
    assert.equal(report.checks.mergeDedupeSentence, "Exact duplicate rows are skipped.");
    assert.equal(
      card.leads.includes("Exact duplicate rows are skipped."),
      true,
      "the dedupe rule is not visible on the card",
    );

    assert.equal(report.checks.mergeExactPayloadUnchanged, true);
    assertNotGeneric(card);
    assertExactPayloadUnchanged(card, body);
  });

  it("captures the shipped card, not a mock", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");
    const report = readReport();
    assert.equal(report.screenshot, "artifacts/database-merge-delete-card.png");
    assert.equal(fs.existsSync(PNG), true, "driver wrote no screenshot artifact");
    assert.ok(
      fs.statSync(PNG).size > 5_000,
      `screenshot is only ${fs.statSync(PNG).size} bytes — the card probably did not paint`,
    );
    assert.equal(report.checks.screenshotBytes, fs.statSync(PNG).size);
    // A hidden window still paints the real component: the report sampled the
    // same window the picture was taken from.
    assert.equal(report.deleteCard.viewport.width > 0, true);
    assert.equal(report.mergeCard.viewport.width > 0, true);
  });
});
