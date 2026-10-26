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
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-objects-ui.json");
const SHOT = path.join(desktopRoot, "e2e/artifacts/dashboard-objects-ui.png");

/**
 * The object-shaped card as the OPERATOR sees it, in a real layout engine.
 *
 * `dashboard-objects-e2e` proves the engine keeps the data when the drawing
 * changes; this rig proves the RENDERER draws each object the way its spec says:
 * a series table with a total column, a palette-coloured line chart with a
 * legend, y-axis ticks, grid lines, axis captions and value labels, a derived
 * metric that says "average", a metric from a second database, and a raw
 * listing. Then it presses Table -> Bar -> Line -> Table and requires the table
 * to come back unchanged while every saved spec keeps its query fields.
 *
 * A skipped run is evidence of nothing, so this fails on a missing report.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
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
      [path.join(desktopRoot, "e2e/dashboard-objects.electron.mjs")],
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
  title: string | null;
  blockCount: number;
  monthsTable: { headers: string[]; rows: string[][] } | null;
  monthsBars: number;
  monthsLines: number;
  monthsTools: string[];
  trend: {
    lines: number;
    dots: number;
    legend: { items: string[]; swatches: Array<string | null> } | null;
    captions: string[];
    valueLabels: number;
    yTicks: string[];
    grid: number;
  } | null;
  average: string | null;
  accounts: string | null;
  rows: { headers: string[]; rows: string[][] } | null;
  rowsHeaders: string[];
  saves: Array<{
    viewId: string | null;
    blocks: Array<Record<string, unknown>>;
  }>;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    initial: Sample;
    bar: Sample;
    line: Sample;
    table: Sample;
    saves: Report["checks"]["table"]["saves"];
    rowsTools: string[] | null;
    skin: { name: string | null; applied: string | null };
  };
};

describe("dashboard objects UI e2e", () => {
  it("draws every object and keeps the table when the drawing changes", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }
    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "the driver wrote no report artifact");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, [], "the rig's own claims failed");
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the driver exited non-zero");

    const initial = report.checks.initial;
    // Five OBJECTS in one card, each drawn as itself.
    assert.equal(initial.blockCount, 5);
    assert.deepEqual(initial.monthsTable?.headers, ["Month", "Food", "Travel", "Rent", "Total (ZAR)"]);
    assert.equal(initial.monthsTable?.rows.length, 4);
    assert.deepEqual(initial.monthsTable?.rows[0], ["2026-06", "100", "100", "—", "200"]);
    assert.equal(initial.trend?.lines, 3, "the line chart is not one line per series");
    assert.deepEqual(initial.trend?.legend?.items, ["Food", "Travel", "Rent"]);
    assert.equal(
      new Set((initial.trend?.legend?.swatches ?? []).filter(Boolean)).size,
      3,
      "the series share one colour",
    );
    assert.deepEqual(initial.trend?.captions.sort(), ["Month", "Spend"]);
    assert.ok((initial.trend?.valueLabels ?? 0) > 0, "value labels did not draw");
    assert.ok((initial.trend?.yTicks.length ?? 0) >= 3, "the y-axis drew no scale");
    assert.ok((initial.trend?.grid ?? 0) >= 3, "the chart drew no grid");
    assert.match(initial.average ?? "", /225/);
    assert.match(initial.average ?? "", /average/);
    assert.match(initial.accounts ?? "", /2/);
    assert.equal(initial.rows?.rows.length, 4);
    assert.ok(initial.rowsHeaders.includes("Amount (ZAR)"));

    // The drawing switch is the operator's own tab row, and it changes nothing
    // but the drawing.
    assert.equal(report.checks.bar.monthsBars, 12, "the bar drawing did not draw 4 labels x 3 series");
    assert.equal(report.checks.bar.monthsTable, null, "the bar drawing still drew a table");
    assert.equal(report.checks.line.monthsLines, 3, "the line drawing did not draw 3 series");
    assert.deepEqual(report.checks.table.monthsTable, initial.monthsTable);
    assert.deepEqual(
      report.checks.saves.map((s) => s.blocks.find((b) => b.id === "months")?.presentation),
      ["bar", "line", "table"],
    );
    for (const save of report.checks.saves) {
      const months = save.blocks.find((b) => b.id === "months");
      assert.equal(months?.groupBy, "date", "a drawing switch changed the groupBy");
      assert.equal(months?.timeBucket, "month", "a drawing switch changed the timeBucket");
      assert.equal(months?.measure, "sum", "a drawing switch changed the measure");
      assert.equal(months?.seriesBy, "category", "a drawing switch lost the series split");
    }
    // A raw listing offers its two captions, not a chart it cannot draw.
    assert.deepEqual(report.checks.rowsTools, ["list", "table"]);
    assert.equal(fs.existsSync(SHOT), true, "the rig captured no screenshot");
  });
});
