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
const REPORT = path.join(desktopRoot, "e2e/artifacts/pages-studio.json");

/**
 * The rig renders the real PagesPage beside the real DataPage in a real layout
 * engine, so it needs the Vite dev server. With the server down the test skips;
 * `npm run dev` turns it on.
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
      [path.join(desktopRoot, "e2e/pages-studio.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
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

type Side = {
  hostWidth: number;
  rowCount: number;
  rowFills: number[];
  names: (string | null)[];
  subs: (string | null)[];
  countText: string | null;
  chevrons: number;
  chips: number;
  list: { listStyleType: string; paddingLeft: string } | null;
  layout: { columns: string | null; rail: number | null; list: number | null };
  emptyText: string | null;
  filterPresent: boolean;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    parity: Record<string, { equal: boolean }>;
    narrowLayout: { columns: string | null };
    filterNarrowed: { rows: number };
    noMatch: { rows: number; empty: string | null };
    filterCleared: number;
    createCalls: string[];
    refusal: { text: string | null; calls: number };
    createdRow: { rows: number; first: string | null };
    emptyVault: { rows: number; empty: string | null; filterPresent: boolean };
    baselineWidths: { pages: number; data: number };
  };
  baseline: { pages: Side; data: Side };
};

describe("pages surface matches the Home wing", () => {
  it("renders the Pages page with the Data/Dashboard chrome, and it still works", async (t) => {
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

    // Parity is the claim, and the two surfaces must have been compared at the
    // same width — otherwise the equality below is between different layouts.
    assert.equal(
      report.checks.baselineWidths.pages,
      report.checks.baselineWidths.data,
      "the two surfaces were measured at different widths",
    );
    for (const [key, cell] of Object.entries(report.checks.parity)) {
      assert.equal(cell.equal, true, `pages ${key} does not match the Data surface`);
    }

    const pages = report.baseline.pages;

    // The reported defect was an unstyled list: default markers, no row chrome.
    assert.equal(pages.list?.listStyleType, "none", "the page list paints bullets");
    assert.equal(pages.list?.paddingLeft, "0px", "the page list keeps the UA padding");
    assert.ok(
      pages.rowFills.every((f) => f === 1),
      `a page row does not own its row: ${JSON.stringify(pages.rowFills)}`,
    );
    assert.equal(pages.chevrons, pages.rowCount, "every row should carry one chevron");
    assert.equal(pages.chips, pages.rowCount, "the overview lens should label each row's domain");
    assert.deepEqual(pages.names, ["Budget review", "Training plan", "Sleep log"]);
    assert.ok(
      pages.subs.every((s) => /blocks? · Updated \d{4}-\d{2}-\d{2}$/.test(s ?? "")),
      `row sub lines are not the shared shape: ${JSON.stringify(pages.subs)}`,
    );

    // Two columns at 1280 with the rail in its tracked range, one at 700.
    assert.equal((pages.layout.columns ?? "").split(/\s+/).length, 2);
    assert.ok(
      pages.layout.rail !== null && pages.layout.rail > 240 && pages.layout.rail <= 360,
      `the rail measured ${pages.layout.rail}px`,
    );
    assert.ok(
      pages.layout.list !== null && pages.layout.list > pages.layout.rail,
      "the list column is not the wider column",
    );
    assert.equal(
      (report.checks.narrowLayout.columns ?? "").split(/\s+/).length,
      1,
      "the container query no longer stacks the layout",
    );

    // The filter, its empty state, and the create path were all exercised.
    assert.equal(report.checks.filterNarrowed.rows, 1, "the filter stopped narrowing");
    assert.equal(report.checks.noMatch.rows, 0);
    assert.match(report.checks.noMatch.empty ?? "", /No pages match/);
    assert.equal(report.checks.filterCleared, 3, "clearing the filter did not restore the list");
    assert.equal(report.checks.refusal.calls, 0, "a domain-less create still reached the bridge");
    assert.match(report.checks.refusal.text ?? "", /Select a domain to create a page in/);
    assert.deepEqual(report.checks.createCalls, ["pageCreate:health:Race plan"]);
    assert.equal(report.checks.createdRow.rows, 4, "the created page is not on the list");
    assert.equal(report.checks.createdRow.first, "Race plan", "the new page is not first");

    assert.equal(report.checks.emptyVault.rows, 0);
    assert.equal(report.checks.emptyVault.empty, "No pages yet.");
    assert.equal(report.checks.emptyVault.filterPresent, false);
  });
});
