/**
 * The chat-panel harness page (`e2e/chat-panel.{html,tsx}`) driven by
 * `transcript-anchor.electron.mjs`: what happens to a transcript's bottom edge
 * while the composer below it grows.
 *
 * The reported bug this guards: typing a long paragraph grew the composer, the
 * transcript's scroll port shrank by the same height — the border did move up —
 * but the port's own `scrollTop` stayed put, so the last thing the operator was
 * reading slid below the new bottom edge and the composer looked like it had
 * grown over the chat.
 *
 * Both of the dock's transcripts are covered — the thread and Quick Notes — and
 * so are the two ways the watch can lose its surface: swapping to the other
 * transcript and back, and collapsing the dock and reopening it.
 *
 * It is its own test file, like `chat-bubble-meta-e2e.test.ts`: one rig, one
 * Electron app, one profile, so nothing shares browser state with the other
 * drivers of this page.
 *
 * The rig writes `e2e/artifacts/transcript-anchor.{json,png}`; the assertions
 * below restate the contract so a driver that reports `pass` for the wrong
 * geometry still fails the suite.
 */

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
const REPORT = path.join(desktopRoot, "e2e/artifacts/transcript-anchor.json");

/** One read of the dock's column, as the rig samples it. */
type Sample = {
  surface: "thread" | "chain";
  rows: number;
  bodyClientHeight: number;
  bodyScrollHeight: number;
  scrollTop: number;
  maxScroll: number;
  distanceFromBottom: number;
  atEnd: boolean;
  fieldHeight: number;
  fieldInlineHeight: string | null;
  footerHeight: number;
  footerPaddingTop: number;
  panelTop: number;
  panelBottom: number;
  panelHeight: number;
  transcriptBottom: number;
  composerTop: number;
  composerBottom: number;
  composerGap: number;
  lastRowBottom: number | null;
  lastRowGap: number | null;
  lastRowVisible: boolean;
};

type Report = {
  pass: boolean;
  failures: string[];
  capPx: number;
  endSlackPx: number;
  rest: Sample;
  mid: Sample;
  capped: Sample;
  cleared: Sample;
  scrolled: { scrollTop: number; distanceFromBottom: number };
  grownWhileReading: Sample;
  settled: Sample;
  back: Sample;
  chainRest: Sample;
  chainGrown: Sample;
  chainCleared: Sample;
  recovered: Sample;
  reopened: Sample;
  reopenedGrown: Sample;
  screenshots: string[];
};

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
      [path.join(desktopRoot, "e2e/transcript-anchor.electron.mjs")],
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

describe("transcript anchor", () => {
  it("keeps each transcript's end in view as the composer grows over it", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The fixture really does overflow, or none of the geometry below means
    // anything: a port that cannot scroll has no end to keep.
    assert.ok(
      report.rest.bodyScrollHeight > report.rest.bodyClientHeight + 200,
      `the transcript did not overflow: ${report.rest.bodyScrollHeight}px of content in a ${report.rest.bodyClientHeight}px port`,
    );
    assert.equal(report.rest.atEnd, true, "the transcript did not start at its end");

    // Growth is real, and it comes out of the transcript's port — the border
    // moves up; the composer does not grow downward over the last line.
    assert.ok(
      report.mid.fieldHeight > report.rest.fieldHeight + 40,
      "the small draft did not grow the field",
    );
    assert.equal(
      report.mid.composerGap,
      report.rest.composerGap,
      `the composer's distance under the transcript changed: ${report.rest.composerGap}px → ${report.mid.composerGap}px`,
    );
    assert.equal(
      report.mid.composerGap,
      report.mid.footerPaddingTop,
      "the composer is not sitting one gutter under the transcript's bottom edge",
    );
    assert.ok(
      report.mid.transcriptBottom < report.rest.transcriptBottom - 40,
      `the transcript's port did not give the height up: ${report.rest.transcriptBottom}px → ${report.mid.transcriptBottom}px`,
    );

    // The bug itself: the port gave the height up and the scroll offset stayed
    // put, so the operator's place slid below the new bottom edge.
    assert.equal(
      report.mid.atEnd,
      true,
      `the transcript lost its end while the composer grew (${report.mid.distanceFromBottom}px below it)`,
    );
    assert.equal(
      report.mid.lastRowVisible,
      true,
      "the last turn slid out of the transcript's port",
    );
    assert.ok(
      report.mid.lastRowBottom != null &&
        report.mid.lastRowBottom <= report.mid.transcriptBottom + 1,
      `the last turn's bottom ${report.mid.lastRowBottom}px is under the transcript's edge ${report.mid.transcriptBottom}px`,
    );

    // The cap is the most growth a draft can ask for.
    assert.equal(
      report.capped.fieldHeight,
      report.capPx,
      `the capped draft did not sit on the half-panel cap: ${report.capped.fieldHeight}px vs ${report.capPx}px`,
    );
    assert.equal(
      report.capped.atEnd,
      true,
      `the transcript lost its end under the capped composer (${report.capped.distanceFromBottom}px below it)`,
    );
    assert.equal(
      report.capped.lastRowVisible,
      true,
      "the last turn slid out of the port under the capped composer",
    );

    // The dock's column is fixed by the shell's grid track: growth moves the
    // border, never the panel.
    assert.equal(
      report.capped.panelHeight,
      report.rest.panelHeight,
      "the panel's own height moved while the composer grew",
    );

    // Shrinking back must not leave a blank strip under the last turn.
    assert.equal(
      report.cleared.atEnd,
      true,
      `the transcript lost its end when the draft cleared (${report.cleared.distanceFromBottom}px below it)`,
    );
    assert.equal(
      report.back.atEnd,
      true,
      `the transcript lost its end after the composer shrank again (${report.back.distanceFromBottom}px below it)`,
    );

    // Quick Notes is the dock's second transcript with the same composer idiom:
    // the same end-keeping applies there, from its own scroller.
    assert.equal(
      report.chainRest.surface,
      "chain",
      "the rig did not land on the Quick Notes surface",
    );
    assert.ok(
      report.chainRest.bodyScrollHeight > report.chainRest.bodyClientHeight + 200,
      `the chain did not overflow: ${report.chainRest.bodyScrollHeight}px of content in a ${report.chainRest.bodyClientHeight}px port`,
    );
    assert.equal(report.chainRest.atEnd, true, "the chain did not start at its end");
    assert.equal(
      report.chainGrown.fieldHeight,
      report.capPx,
      `the chain composer did not reach its cap: ${report.chainGrown.fieldHeight}px vs ${report.capPx}px`,
    );
    assert.equal(
      report.chainGrown.atEnd,
      true,
      `the chain lost its end under the capped composer (${report.chainGrown.distanceFromBottom}px below it)`,
    );
    assert.equal(
      report.chainGrown.lastRowVisible,
      true,
      "the newest signal slid out of the chain's port",
    );
    assert.ok(
      report.chainGrown.transcriptBottom < report.chainRest.transcriptBottom - 40,
      `the chain's port did not give the height up: ${report.chainRest.transcriptBottom}px → ${report.chainGrown.transcriptBottom}px`,
    );
    assert.equal(
      report.chainCleared.atEnd,
      true,
      `the chain lost its end when the draft cleared (${report.chainCleared.distanceFromBottom}px below it)`,
    );

    // Coming back to the thread re-binds the watch to the surface in front.
    assert.equal(report.recovered.surface, "thread", "the rig did not land back on the thread");
    assert.equal(
      report.recovered.atEnd,
      true,
      `the thread lost its end after returning from Quick Notes (${report.recovered.distanceFromBottom}px below it)`,
    );

    // The dock can be collapsed and reopened; the watch has to follow the fresh
    // transcript rather than holding the one it was unmounted from.
    assert.equal(
      report.reopened.atEnd,
      true,
      `the reopened dock started ${report.reopened.distanceFromBottom}px from its transcript's end`,
    );
    assert.equal(
      report.reopenedGrown.atEnd,
      true,
      `the reopened dock lost its end while the composer grew (${report.reopenedGrown.distanceFromBottom}px below it)`,
    );
    assert.equal(
      report.reopenedGrown.lastRowVisible,
      true,
      "the last turn slid out of the reopened transcript's port",
    );

    // The guard: an operator reading scrollback types without being pulled back
    // to the live turn.
    assert.ok(
      report.scrolled.distanceFromBottom > 100,
      "the rig did not actually scroll away from the end",
    );
    assert.ok(
      Math.abs(report.grownWhileReading.scrollTop - report.scrolled.scrollTop) <= 1,
      `typing yanked a reader to the live turn: ${report.scrolled.scrollTop}px → ${report.grownWhileReading.scrollTop}px`,
    );
    assert.equal(
      report.grownWhileReading.atEnd,
      false,
      "a reader was put back at the transcript's end while typing",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot at ${file}`);
    }
  });
});
