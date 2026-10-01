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
const REPORT = path.join(desktopRoot, "e2e/artifacts/composer-autogrow.json");

/**
 * The composer autogrow rig needs the Vite dev server, because it measures the
 * real ChatPanel in a real layout engine rather than a stubbed DOM. With the
 * server down the test skips; `npm run dev` in another shell turns it on.
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
      [path.join(desktopRoot, "e2e/composer-autogrow.electron.mjs")],
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

describe("composer autogrow", () => {
  it("grows the field with the draft and clamps it at half the panel", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      pass: boolean;
      failures: string[];
      restHeightPx: number;
      capPx: number;
      restPanelHeight: number;
      samples: { step: string; fieldHeight: number; fieldSpansRow: boolean }[];
      resizeChecks: { step: string; fieldHeight: number; expectedCap: number }[];
      send: {
        hiddenWhileEmpty: boolean;
        controlPx: number;
        gutterPx: number;
        removedColumnPx: number;
        insideField: { inside: boolean };
        click: { present: boolean; enabled: boolean; calls: string[]; draftAfter: string; sendPresentAfter: boolean };
        stream: {
          decoded: { type: string; runId: string } | null;
          decodedTerminal: { type: string } | null;
          decodedFailed: { type: string; reason: string } | null;
          live: { present: boolean; state: string | null; square: boolean; arrow: boolean; disabled: boolean | null };
          afterRunStarted: { present: boolean; state: string | null; disabled: boolean | null };
          afterStopClick: { stops: string[]; state: string | null; fieldDisabled: boolean };
          afterCancelled: { note: string | null; noteRole: string | null };
          settled: { present: boolean; fieldDisabled: boolean; note: string | null };
          submits: number;
        };
      };
    };

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // Restated here so the numbers are asserted by the suite, not only inside
    // the driver: the cap is half the panel and the resting shape is untouched.
    assert.equal(report.capPx, Math.max(Math.round(report.restPanelHeight / 2), 72));
    assert.ok(report.samples.length >= 10, "expected the full growth ladder");
    for (const sample of report.samples) {
      assert.ok(
        sample.fieldHeight <= report.capPx + 1,
        `${sample.step} exceeded the cap: ${sample.fieldHeight}px`,
      );
      assert.ok(
        sample.fieldHeight >= report.restHeightPx,
        `${sample.step} fell under the resting height: ${sample.fieldHeight}px`,
      );
    }
    for (const check of report.resizeChecks) {
      assert.ok(
        Math.abs(check.fieldHeight - check.expectedCap) <= 1,
        `${check.step} did not re-clamp to its panel: ${check.fieldHeight}px`,
      );
    }

    // The inline send control: hidden while the composer is empty, inside the
    // field's own box when it shows, and still submitting the form.
    assert.equal(report.send.hiddenWhileEmpty, true, "send control rendered on an empty composer");
    assert.equal(report.send.insideField.inside, true, "send control sat outside the field");
    assert.ok(
      report.send.gutterPx < report.send.removedColumnPx,
      `gutter ${report.send.gutterPx}px did not beat the removed ${report.send.removedColumnPx}px column`,
    );
    for (const sample of report.samples) {
      assert.equal(sample.fieldSpansRow, true, `${sample.step} did not give the field the full row width`);
    }
    assert.equal(report.send.click.present && report.send.click.enabled, true, "send control unusable");
    assert.equal(report.send.click.calls.length, 1, "icon button did not submit exactly once");
    assert.equal(report.send.click.calls[0]?.length > 0, true, "submitted draft was empty");
    assert.equal(report.send.click.draftAfter, "", "draft survived the send");
    assert.equal(report.send.click.sendPresentAfter, false, "send control stayed on screen after the send");

    // The streaming state: the same control becomes an interrupt, armed by the
    // run id from the wire, and it clears only when the stream actually ends.
    assert.equal(report.send.stream.decoded?.type, "run.started", "run.started did not decode");
    assert.equal(report.send.stream.decoded?.runId, "run_harness_1", "run id lost in decoding");
    assert.equal(report.send.stream.live.state, "stop", "no stop state while the run was live");
    assert.equal(report.send.stream.live.square, true, "arrow stayed up while streaming");
    assert.equal(report.send.stream.live.arrow, false, "arrow and stop square rendered together");
    assert.equal(report.send.stream.live.disabled, true, "stop was clickable before the run id arrived");
    assert.equal(report.send.stream.afterRunStarted.disabled, false, "stop never armed");
    assert.deepEqual(report.send.stream.afterStopClick.stops, ["run_harness_1"], "stop IPC not called with the run id");
    assert.equal(report.send.stream.afterStopClick.state, "stop", "control flipped back while the gateway was still working");
    assert.equal(report.send.stream.submits, 0, "the stop click routed through the composer form");
    assert.equal(report.send.stream.settled.present, false, "control outlived the stream");

    // ...and it does not leave the stopped turn reading like a finished one.
    assert.equal(report.send.stream.decodedTerminal?.type, "run.stopped", "run.cancelled did not decode");
    assert.equal(report.send.stream.decodedFailed?.type, "run.incomplete", "run.failed did not decode");
    assert.equal(report.send.stream.decodedFailed?.reason, "iteration budget", "turn exit reason lost");
    assert.match(
      report.send.stream.afterCancelled.note ?? "",
      /^Stopped/,
      "the interrupted turn carried no marker",
    );
    assert.equal(report.send.stream.afterCancelled.noteRole, "status", "the marker is not announced");
    assert.equal(
      report.send.stream.settled.note,
      report.send.stream.afterCancelled.note,
      "the marker vanished when the stream closed",
    );
  });
});
