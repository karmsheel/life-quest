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
  reset: {
    newTurnBlocks: number;
    switchedActivity: boolean;
    switchedTranscript: string[];
  };
  screenshots: string[];
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

    // Restated here so the suite asserts the numbers, not only the driver: seven
    // calls must leave the transcript exactly as the send left it, and add no
    // tool pseudo-messages.
    assert.equal(report.calls, 7);
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
      "Edited 2 files, explored 2 files, ran 1 command, delegated Review the composer diff, used 1 tool",
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
