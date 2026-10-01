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

type Sample = {
  inboxWidth: number | null;
  changedRows: number;
  lead: string;
  readable: string;
  exactPayload: string | null;
  rows: { field: string; cells: { text: string; title: string | null }[] }[];
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    rawShowsShortId: boolean;
    labelledCellTitles: string[];
    exactPayloadUnchanged: boolean;
    inboxWidth: number | null;
  };
  raw: Sample;
  resolved: Sample;
};

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
    assert.doesNotMatch(report.resolved.readable, /\b[0-9a-f]{8}…/, "an id is still on screen");
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
});
