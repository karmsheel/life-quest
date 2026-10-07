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
const REPORT = path.join(desktopRoot, "e2e/artifacts/view-card.json");

/**
 * The rig renders the real ViewCard in a real layout engine, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` in another
 * terminal brings it up.
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
      [path.join(desktopRoot, "e2e/view-card.electron.mjs")],
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
  present: boolean | null;
  title: string | null;
  warnings: string | null;
  empty: string | null;
  metric: string | null;
  missingCopy: boolean | null;
  bars: Array<{ fill: string; title: string | null }>;
  ticks: Array<string | null>;
  gridWidth: number | null;
  pinWidth: number | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    barTitle: string | null;
    barRects: number;
    barTicks: string[] | null;
    barFillMatchesAccent: boolean;
    barTooltip: string | null;
    emptyCopy: string | null;
    metricText: string | null;
    missingCopy: boolean | null;
    warningText: string | null;
    span2: { gridContentWidth: number; span2Width: number; plainWidth: number };
    consoleErrors: string[];
  };
  samples: {
    bar: Sample;
    empty: Sample;
    metric: Sample;
    missing: Sample;
    warned: Sample;
  };
};

describe("view card e2e", () => {
  it("draws a saved view in theme tokens and survives empty and missing runs", async (t) => {
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

    // The bar claim is measured, not sampled from a screenshot: two groups,
    // one accent fill, labels under the bars.
    assert.equal(report.checks.barRects >= 2, true, "bar claim could not fire");
    assert.equal(report.checks.barFillMatchesAccent, true, "the bar claim could not fail a fill regression");
    assert.deepEqual(report.checks.barTicks, ["Transpo…", "Groceri…"]);
    assert.ok(report.checks.barTooltip, "bars lost their value tooltip");

    // Empty and missing are product copy on a live card, not crashes.
    assert.equal(report.checks.emptyCopy, "No rows in this window.");
    assert.equal(report.checks.missingCopy, true);

    // One number, one currency.
    assert.match(report.checks.metricText ?? "", /280/);
    assert.match(report.checks.metricText ?? "", /ZAR/);

    // The span-2 claim is measured: the wrapper owns the grid's content row; a
    // plain pin next to it does not.
    assert.equal(report.checks.span2.span2Width, report.checks.span2.gridContentWidth);
    assert.ok(report.checks.span2.plainWidth < report.checks.span2.gridContentWidth);
  });
});
