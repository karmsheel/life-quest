import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Review page: the document, the snapshot rules and the interview.
 *
 * The claims themselves live in `e2e/review.electron.mjs`, which drives the
 * harness; this file runs that driver and refuses a report that does not hold.
 * Every claim is restated here so a regression names the surface rather than
 * only the rig's own failure list.
 *
 * The rig needs the Vite dev server. With the server down the test skips;
 * `npm run dev` in another terminal brings it up.
 *
 * The artifact is `e2e/artifacts/review.json` plus the three `.png`s the driver
 * captures: same command, same claims, no eyeballing the app required.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/review.json");
const SHOTS = [
  "review-document.png",
  "review-started.png",
  "review-rules.png",
].map((name) => path.join(desktopRoot, "e2e/artifacts", name));

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
      [path.join(desktopRoot, "e2e/review.electron.mjs")],
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

type Page = {
  boxes: number;
  blockCount: number;
  blanks: number;
  writingLines: number;
  editing: boolean;
  inputValue: string | null;
  boxMarkdown: string;
  boxText: string;
  readOnly: boolean | null;
  strong: number;
  underlines: number;
  tables: number;
  headers: string[];
  headings: number;
  title: string | null;
  period: string | null;
  notice: string | null;
  error: string | null;
  status: string | null;
  actions: string[];
  modes: string[];
  previewShown: boolean;
  skillOpen: boolean;
  skillValue: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  generatedAt: string;
  checks: {
    opened: Page;
    blankLineBody: string;
    blankLineBlocks: number;
    bolded: { value: string; start: number; end: number; prevented: boolean };
    underlined: { value: string };
    headed: { value: string };
    reheaded: { value: string };
    formatted: Page;
    agentDown: Page;
    filledBody: string;
    started: Page;
    startedTwiceBody: string;
    starts: { sessionId: string; kickoff: string | null }[];
    preview: Page;
    previewText: string;
    rules: Page;
    skillWrites: string[];
    kickoffs: string[];
    unexpectedBridgeCalls: string[];
    calls: string[];
    consoleErrors: string[];
  };
};

describe("review ui e2e", () => {
  it("opens the review document, fills its snapshot, and survives an agent that is not running", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(shot, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // ── the review IS the document ──────────────────────────────────────────
    const opened = report.checks.opened;
    assert.equal(opened.boxes, 1, "the review page does not draw exactly one editor box");
    assert.equal(opened.blockCount, 15, "the review did not render its own file");
    assert.equal(opened.editing, false, "the review opened a writing line on arrival");
    assert.equal(opened.title, "Weekly review", "the review page is not titled for its cadence");
    // The page opens on the CURRENT week, which is whatever week the suite runs
    // in: the claim is the shape of its own label, not a pinned date.
    assert.match(
      String(opened.period),
      /^Weekly review · Week of \d{1,2} [A-Z][a-z]{2} \d{4}$/,
      "the review page does not label its period",
    );
    assert.equal(
      opened.actions.includes("Edit"),
      false,
      "the review document is behind an Edit control again",
    );
    assert.equal(
      opened.actions.includes("Save"),
      false,
      "the review document is behind a Save control again",
    );

    // ── a blank line the operator typed reaches the file ────────────────────
    assert.equal(opened.blanks, 1, "the blank line the operator typed is not drawn");
    assert.equal(
      report.checks.blankLineBlocks,
      1,
      "the blank line disappeared from the box after an edit below it",
    );
    assert.match(
      report.checks.blankLineBody,
      /Two walks, and \*\*one\*\* late night\.\n\n\n\nSlept badly, and it showed at work\./,
      "the blank line the operator typed did not survive being written down",
    );

    // ── the formatting keys ────────────────────────────────────────────────
    assert.equal(report.checks.bolded.prevented, true, "Ctrl+B was not claimed by the editor");
    assert.equal(report.checks.bolded.value, "alpha **beta** gamma", "Ctrl+B did not wrap the selection");
    assert.equal(report.checks.bolded.start, 8, "Ctrl+B left the caret outside the mark");
    assert.equal(report.checks.bolded.end, 12, "Ctrl+B left the selection outside the mark");
    assert.equal(
      report.checks.underlined.value,
      "<u>alpha</u> **beta** gamma",
      "Ctrl+U did not write the underline mark",
    );
    assert.equal(
      report.checks.headed.value,
      "## <u>alpha</u> **beta** gamma",
      "Ctrl+2 did not make the line an H2",
    );
    assert.equal(
      report.checks.reheaded.value,
      "### <u>alpha</u> **beta** gamma",
      "Ctrl+3 stacked a second heading instead of replacing the first",
    );
    assert.equal(report.checks.formatted.underlines >= 1, true, "the underline mark did not render");
    assert.equal(report.checks.formatted.strong >= 1, true, "the bold mark did not render");
    assert.equal(
      report.checks.formatted.boxText.includes("<u>"),
      false,
      "the underline tag is printed literally in the box",
    );

    // ── Start fills the snapshot even with the agent down ──────────────────
    const agentDown = report.checks.agentDown;
    assert.match(
      String(agentDown.error),
      /Settings › Hermes/,
      "an unreachable agent was not reported with the place to fix it",
    );
    assert.doesNotMatch(
      String(agentDown.error),
      /fetch failed/i,
      "the page reported the transport's own words",
    );
    assert.equal(agentDown.boxes, 1, "an unreachable agent took the review document away");
    assert.match(
      report.checks.filledBody,
      /\| Groceries \| 1,234\.56 \|/,
      "the snapshot did not carry the figure its rule asked for",
    );
    assert.equal(
      report.checks.filledBody.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
      1,
      "the snapshot marker is not in the file exactly once",
    );
    assert.equal(
      agentDown.boxText.includes("lifequest:snapshot"),
      false,
      "the snapshot marker is printed in the review",
    );
    assert.equal(
      agentDown.boxText.includes("Spending this period"),
      true,
      "the filled snapshot is not visible in the review",
    );
    assert.equal(
      agentDown.tables >= 1,
      true,
      "the snapshot's table is not drawn as a table",
    );
    assert.deepEqual(
      agentDown.headers.filter((h) => h === "Category" || h === "Total (ZAR)").sort(),
      ["Category", "Total (ZAR)"],
      "the snapshot's table headers are wrong",
    );
    assert.equal(
      agentDown.boxText.includes("| --- |"),
      false,
      "the snapshot's table is painted as markdown pipes",
    );

    // ── a second Start fills once and opens the interview ─────────────────
    const started = report.checks.started;
    assert.equal(started.error, null, `the second Start reported ${String(started.error)}`);
    assert.match(String(started.notice), /snapshot/i, "the page did not say what it filled");
    assert.match(String(started.notice), /chat/i, "the page did not say the interview opened");
    assert.equal(
      report.checks.startedTwiceBody.split("<!-- lifequest:snapshot:finance-spend -->").length - 1,
      1,
      "a second Start appended a second snapshot block",
    );
    assert.equal(report.checks.starts.length, 1, "Start did not request exactly one session");
    assert.equal(
      report.checks.starts[0]!.sessionId,
      "review-rig-session",
      "Start requested a session this rig does not know",
    );
    // Opening the interview is one turn, sent to the session Start bound.
    assert.equal(report.checks.kickoffs.length, 1, "Start did not open the interview");

    // ── Preview is the whole document ─────────────────────────────────────
    assert.equal(report.checks.preview.previewShown, true, "the preview mode drew no preview");
    assert.equal(report.checks.preview.boxes, 0, "the preview mode left the editor on the page");
    assert.match(
      report.checks.previewText,
      /A note outside the skeleton\./,
      "the preview dropped a section the operator wrote",
    );

    // ── the cadence's rules ───────────────────────────────────────────────
    assert.match(
      String(report.checks.rules.skillValue),
      /Keep it to a page\./,
      "the rules panel did not show the cadence's rules",
    );
    assert.equal(report.checks.skillWrites.length, 1, "the rules were not written exactly once");
    assert.match(
      report.checks.skillWrites[0]!,
      /Always ask about sleep\./,
      "the rules write did not carry what the operator wrote",
    );

    // Nothing reached the bridge that this rig does not model, and the page
    // logged nothing while it was being driven.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(shot), true, `driver captured no screenshot ${shot}`);
    }
  });
});
