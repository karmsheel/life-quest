import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/tool-run.json");

/**
 * The tool-run rig drives the real ChatPanel in a real window, so it needs the
 * Vite dev server. With the server down the test skips; `npm run dev` in another
 * shell turns it on.
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
      [path.join(desktopRoot, "e2e/tool-run.electron.mjs")],
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

/** The open disclosure's geometry, as the run grew under it. */
type GrowthSample = {
  missing: boolean;
  rows: number;
  rowLineHeight?: number | null;
  rowHeightMin?: number | null;
  rowHeightMax?: number | null;
  blockHeight?: number;
  blockClientHeight?: number;
  blockScrollHeight?: number;
  blockMaxHeight?: string | null;
  blockScrollTop?: number;
  boxTop?: number;
  boxBottom?: number;
  scrollbarWidth?: number;
  blockOverflowY?: string;
  body?: { clientHeight: number; scrollHeight: number; top: number; bottom: number } | null;
  lastRowTop?: number | null;
  lastRowBottom?: number | null;
  innerHeight?: number;
};

/** What scrolling the capped block to its own bottom did. */
type ScrolledSample = {
  missing: boolean;
  scrollTop?: number;
  maxScrollTop?: number;
  lastRowTop?: number;
  lastRowBottom?: number;
  boxTop?: number;
  boxBottom?: number;
  inside?: boolean;
  insideTranscript?: boolean;
};

type ToolRunReport = {
  pass: boolean;
  failures: string[];
  calls: number;
  transcript: {
    rest: string[];
    afterSend: string[];
    afterCalls: string[];
    toolBubbles: number;
  };
  decode: {
    path: { name: string; target: string };
    query: { target: string };
    longCommand: { target: string };
    stringArgs: { target: string };
    nameOnly: { name: string; target: string };
    completion: { name: string; ok?: unknown };
  };
  line: {
    livePartiallySettled: string;
    settled: string;
    wholeRun: string;
    sameName: string;
  };
  disclosure: {
    collapsed: { tag: string; expanded: string; rows: number; caretOpen: boolean };
    opened: { expanded: string; rows: string[]; caretOpen: boolean };
  };
  thinking: { beforeTools: boolean; withActivity: boolean; nextTurn: boolean };
  /** What the one row carrying underscores + descenders actually painted. */
  rowInk: {
    missing?: boolean;
    rows?: string[];
    text?: string;
    boxHeight?: number;
    rowHeight?: number;
    lineHeight?: string;
    font?: string;
    glyphBox?: number;
    inkBox?: number;
    descender?: number;
    truncated?: boolean;
    inkTop?: number | null;
    inkBottom?: number | null;
    painted?: number;
    boxBottom?: number;
  };
  reset: {
    newTurnBlocks: number;
    switchedActivity: boolean;
    switchedTranscript: string[];
  };
  screenshots: string[];
  /** What the open disclosure did as the run grew past the cap, and what scrolling it did. */
  growth: {
    added: number;
    opened: GrowthSample;
    grown: GrowthSample;
    scrolled: ScrolledSample;
  };
};

describe("tool run display", () => {
  it("stands a turn's tool calls in as one line, and opens on demand", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as ToolRunReport;

    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // Restated here so the suite asserts the numbers, not only the driver: eight
    // calls must leave the transcript exactly as the send left it, and add no
    // tool pseudo-messages.
    assert.equal(report.calls, 8);
    assert.deepEqual(
      report.transcript.afterCalls,
      report.transcript.afterSend,
      "tool frames wrote into the transcript",
    );
    assert.equal(report.transcript.toolBubbles, 0, "tool pseudo-messages reappeared");

    // The line itself: one clause per category, present tense only while running.
    assert.match(report.line.livePartiallySettled, /, running npm run test -w @lifequest\/desktop$/);
    assert.equal(report.line.settled, "Explored 2 files, ran 1 command");
    assert.equal(
      report.line.wholeRun,
      "Edited 2 files, explored 2 files, ran 1 command, delegated Review the composer diff, used 2 tools",
    );
    assert.equal(report.line.sameName, "Exploring AGENTS.md, ran 2 commands");

    // Closed on arrival, one row per call once opened.
    assert.equal(report.disclosure.collapsed.tag, "BUTTON");
    assert.equal(report.disclosure.collapsed.expanded, "false");
    assert.equal(report.disclosure.collapsed.rows, 0);
    assert.equal(report.disclosure.collapsed.caretOpen, false);
    assert.equal(report.disclosure.opened.expanded, "true");
    assert.equal(report.disclosure.opened.rows.length, report.calls);
    assert.equal(report.disclosure.opened.rows[0], "read_file · AGENTS.md");
    assert.equal(
      report.disclosure.opened.rows[3],
      "mcp__lq__get_pq · gap_pqy.ts",
      "a bridged MCP name lost its underscores in the row",
    );

    // Every row is `overflow: hidden` so it can ellipsize — which also clips it
    // vertically: a line box shorter than the font's glyph box cuts the bottoms
    // off letters, so `p` reads as `n` and `_` disappears. The window's own
    // pixels are the only honest witness, so the row that carries both is
    // measured: how tall its box is against the font it is set in, and how much
    // of its ink box (descender and underscore included) it actually paints.
    assert.equal(
      report.rowInk.truncated,
      false,
      "the probe row was ellipsized, so its ink is not the whole story",
    );
    assert.ok(
      (report.rowInk.rowHeight ?? 0) >= (report.rowInk.glyphBox ?? 0) + 1,
      `the row box is ${report.rowInk.rowHeight}px for a ${report.rowInk.glyphBox}px glyph box ` +
        `(font ${report.rowInk.font}, line-height ${report.rowInk.lineHeight})`,
    );
    assert.ok(
      (report.rowInk.boxBottom ?? 0) - (report.rowInk.inkBottom ?? 0) >= 1,
      `the row's ink ends ${((report.rowInk.boxBottom ?? 0) - (report.rowInk.inkBottom ?? 0)).toFixed(2)}px ` +
        `from the clip edge — a descender at the edge is a descender lost`,
    );
    assert.ok(
      (report.rowInk.painted ?? 0) >= (report.rowInk.inkBox ?? 0) * 0.85,
      `the row painted ${report.rowInk.painted}px of its ${report.rowInk.inkBox}px ink box ` +
        `(font ${report.rowInk.font}, line-height ${report.rowInk.lineHeight})`,
    );

    // The block is bounded and scrolls, and no row gives up its line box to fit
    // inside it. Both halves are asserted because either can come undone alone:
    // drop the cap and the block (and so the transcript) grows without bound,
    // drop the row's `flex-shrink: 0` and the cap presses 16.5px rows into 3.6px
    // instead of scrolling them out of sight -- the defect as it was reported.
    assert.equal(
      report.growth.grown.rows,
      report.growth.opened.rows + report.growth.added,
      "the block did not gain a row per call",
    );
    assert.equal(
      report.growth.grown.blockOverflowY,
      "auto",
      "the block has a cap but does not scroll its own overflow",
    );
    assert.ok(
      (report.growth.grown.blockClientHeight ?? 0) <= parseFloat(report.growth.grown.blockMaxHeight ?? "") + 1,
      `the block grew to ${report.growth.grown.blockClientHeight}px against a ${report.growth.grown.blockMaxHeight} cap`,
    );
    assert.ok(
      (report.growth.grown.blockClientHeight ?? 0) <= 12 * (report.growth.grown.rowLineHeight ?? 0),
      `the cap is not a cap: ${report.growth.grown.blockClientHeight}px is more than a dozen ` +
        `${report.growth.grown.rowLineHeight}px lines`,
    );
    assert.ok(
      (report.growth.grown.blockScrollHeight ?? 0) > (report.growth.grown.blockClientHeight ?? 0) + 1,
      `the cap hid nothing to scroll: ${report.growth.grown.blockScrollHeight}px of rows in ${report.growth.grown.blockClientHeight}px`,
    );
    assert.ok(
      (report.growth.grown.rowHeightMin ?? 0) >= (report.growth.grown.rowLineHeight ?? 0) - 0.5,
      `a row squeezed to ${report.growth.grown.rowHeightMin}px in a ${report.growth.grown.rowLineHeight}px line box`,
    );
    assert.ok(
      (report.growth.grown.blockScrollTop ?? 0) > 0 &&
        (report.growth.grown.lastRowBottom ?? 0) <= (report.growth.grown.boxBottom ?? 0) + 1,
      `the block is capped but sits at ${report.growth.grown.blockScrollTop}px, so the newest row ` +
        `(${report.growth.grown.lastRowBottom}px) is below the block's ${report.growth.grown.boxBottom}px edge`,
    );
    assert.ok(
      report.growth.scrolled.inside === true && report.growth.scrolled.insideTranscript === true,
      `scrolling the block to ${report.growth.scrolled.scrollTop}px of ${report.growth.scrolled.maxScrollTop}px ` +
        `left the newest row at ${report.growth.scrolled.lastRowTop}-${report.growth.scrolled.lastRowBottom}, ` +
        `outside the block ${report.growth.scrolled.boxTop}-${report.growth.scrolled.boxBottom}`,
    );
    // The wire keys, asserted through the app's own decoder.
    assert.equal(report.decode.path.name, "read_file");
    assert.equal(report.decode.path.target, "AGENTS.md");
    assert.equal(report.decode.query.target, "composer");
    assert.equal(report.decode.longCommand.target.length, 48);
    assert.equal(report.decode.stringArgs.target, "ls -la");
    assert.equal(report.decode.nameOnly.name, "read_file");
    assert.equal(report.decode.completion.ok, undefined, "a completion claimed a status");

    // The live markers, and the two resets.
    assert.equal(report.thinking.beforeTools, true);
    assert.equal(report.thinking.withActivity, false);
    assert.equal(report.thinking.nextTurn, true);
    assert.equal(report.reset.newTurnBlocks, 0);
    assert.equal(report.reset.switchedActivity, false);
    assert.equal(
      report.reset.switchedTranscript.some((text) => text.includes("Loaded the other chat")),
      true,
      "the switch to another chat did not land",
    );
  });
});
