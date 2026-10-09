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

type BlockTool = {
  presentation: string | null;
  label: string;
  active: boolean;
  disabled: boolean;
  title: string | null;
};

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
  shell: { background: string | null; border: string | null; radius: string | null };
  headers: string[];
  tableAlign: string | null;
  blocks: Array<{
    title: string | null;
    metric: string | null;
    tableRows: number;
    bars: number;
    lines: number;
    empty: string | null;
    tools: BlockTool[];
  }>;
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
    blockTools: BlockTool[][];
    blockSwitch: {
      saves: Array<{ viewId: string | null; blocks: Array<[string, string]> }>;
      states: Array<{ viewId: string; editable: boolean; blocks: Array<{ title: string | null; active: string[]; tools: string[]; tableRows: number; bars: number; metric: string | null }> }>;
    };
    readOnlyTools: number[];
    consoleErrors: string[];
  };
  samples: {
    bar: Sample;
    empty: Sample;
    metric: Sample;
    missing: Sample;
    warned: Sample;
    composedCard: Sample;
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
    assert.deepEqual(report.checks.barTicks, ["Transport", "Groceries"]);
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

    // The card is a card: the board's own shell, and a table that reads as one.
    // A view drawn without them is the regression this rig exists to catch.
    const composed = report.samples.composedCard;
    assert.notEqual(composed.shell.background, "rgba(0, 0, 0, 0)", "the card drew no shell background");
    assert.notEqual(composed.shell.border, "0px", "the card drew no shell border");
    assert.notEqual(composed.shell.radius, "0px", "the card drew no shell radius");
    assert.deepEqual(composed.headers, ["Week", "Total (ZAR)"]);
    assert.equal(composed.tableAlign, "right", "the value column is not right-aligned");

    // ── the operator can change how a block is displayed ────────────────────
    // Each panel offers the four ways it can be drawn, marks exactly one as
    // current, and the switches are driven by the database's own column types.
    assert.equal(report.checks.blockTools.length, 3, "the composed card drew no per-panel controls");
    for (const [index, tools] of report.checks.blockTools.entries()) {
      assert.deepEqual(
        tools.map((t) => t.presentation),
        ["metric", "table", "bar", "line"],
        `panel ${index} does not offer all four presentations`,
      );
      assert.equal(
        tools.filter((t) => t.active).length,
        1,
        `panel ${index} does not mark exactly one presentation as current`,
      );
      assert.ok(
        tools.every((t) => (t.title ?? "").length > 0),
        `panel ${index} has a control with no name`,
      );
    }
    // A metric panel can still become a line here, because the fixture's
    // database has a date column: the disabled state is a fact about the schema,
    // not a blanket rule.
    assert.equal(
      report.checks.blockTools[0]?.find((t) => t.presentation === "line")?.disabled,
      false,
      "a line was refused for a metric panel even though the database has a date column",
    );

    // One click is one write, under the card's own id, and the panel redraws.
    const save = report.checks.blockSwitch.saves[0];
    assert.equal(report.checks.blockSwitch.saves.length, 1, "one click did not make exactly one write");
    assert.equal(save?.viewId, "v-tools", "the switch saved under a different id than the card's own");
    assert.deepEqual(
      save?.blocks,
      [["total", "metric"], ["weeks", "bar"], ["trend", "bar"]],
      "the saved spec changed more than the panel that was switched",
    );
    const after = report.checks.blockSwitch.states.at(-1);
    assert.ok(after, "the card reported nothing after the switch");
    assert.equal(after?.blocks[1]?.bars > 0, true, "the panel did not redraw as a bar");
    assert.equal(after?.blocks[1]?.tableRows, 0, "the panel still draws a table after switching to a bar");
    assert.equal(after?.blocks[1]?.active[0], "bar", "the switched panel does not mark the bar as current");
    assert.notEqual(after?.blocks[0]?.metric, null, "switching a sibling panel lost the metric");
    assert.equal(after?.blocks[0]?.active[0], "metric", "the metric panel lost its current mark");
    assert.equal(after?.blocks[2]?.active[0], "bar", "the third panel's mark moved");

    // A locked dashboard's card is read-only: no switches at all.
    assert.deepEqual(report.checks.readOnlyTools, [0, 0, 0], "a read-only card still drew switches");
  });
});
