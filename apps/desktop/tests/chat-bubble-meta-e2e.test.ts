/**
 * The chat-panel harness page (`e2e/chat-panel.{html,tsx}`) driven by
 * `chat-bubble-meta.electron.mjs`: the side each role sits on, the stamp under
 * it, the copy control beside the stamp, and the traded colour schemes.
 *
 * The rig writes `e2e/artifacts/chat-bubble-meta.{json,png}`; the assertions
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
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-bubble-meta.json");

type Row = {
  role: "user" | "assistant";
  text: string;
  bubble: { left: number; right: number; top: number; bottom: number };
  alignSelf: string;
  meta: { left: number; right: number; top: number; bottom: number } | null;
  timeText: string | null;
  timeIso: string | null;
  timeBox: { left: number; right: number; top: number; bottom: number } | null;
  copyPresent: boolean;
  copyBox: { left: number; right: number; top: number; bottom: number } | null;
  copyState: string | null;
  copyLabel: string | null;
  background: string;
  borderColor: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  initial: {
    container: { left: number; right: number; top: number; bottom: number };
    rows: Row[];
    colours: {
      user: string | null;
      assistant: string | null;
      userAlpha: number | null;
      assistantAlpha: number | null;
    };
  };
  live: {
    rows: {
      role: "user" | "assistant";
      text: string;
      bubble: Row["bubble"];
      timeText: string | null;
      timeIso: string | null;
      copyPresent: boolean;
      copyState: string | null;
    }[];
  };
  shots: { thread: string };
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
      [path.join(desktopRoot, "e2e/chat-bubble-meta.electron.mjs")],
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

describe("chat bubble meta", () => {
  it("sides the roles, stamps each bubble, copies it, and trades the colour schemes", async (t) => {
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
    assert.equal(report.initial.rows.length, 2, "the loaded transcript lost a bubble");
    assert.equal(report.live.rows.length, 4, "the live turn did not add both sides");

    const user = report.initial.rows.find((row) => row.role === "user");
    const assistant = report.initial.rows.find((row) => row.role === "assistant");
    assert.ok(user && assistant, "both loaded roles rendered");

    // The sides are the whole point: the operator is on the left, Hermes is on
    // the right, and each touches its own edge of the transcript.
    assert.equal(user.alignSelf, "flex-start");
    assert.equal(assistant.alignSelf, "flex-end");
    assert.ok(
      Math.abs(user.bubble.left - report.initial.container.left) <= 1,
      `operator bubble did not touch the left edge: ${JSON.stringify(user.bubble)}`,
    );
    assert.ok(
      Math.abs(assistant.bubble.right - report.initial.container.right) <= 1,
      `reply bubble did not touch the right edge: ${JSON.stringify(assistant.bubble)}`,
    );

    // The stamp and the copy control are a footer under the bubble, not a
    // second column beside the role.
    for (const row of [user, assistant]) {
      assert.ok(row.timeIso, `${row.role} has no time element`);
      assert.ok(row.meta, `${row.role} has no meta row`);
      assert.ok(
        row.meta.top >= row.bubble.bottom - 1,
        `${row.role} stamp is not under its bubble`,
      );
      assert.equal(row.copyPresent, true, `${row.role} has no copy control`);
      assert.ok(
        row.timeBox && row.copyBox && row.copyBox.left >= row.timeBox.right - 1,
        `${row.role} copy control is not beside its stamp`,
      );
    }

    // The loaded transcript's instants survive the gateway hop.
    assert.equal(user.timeIso, new Date(1_700_000_000_000).toISOString());
    assert.equal(assistant.timeIso, new Date(1_700_000_002_000).toISOString());

    // The operator's fill is the stronger one; Hermes's is the quieter one.
    assert.ok(
      (report.initial.colours.userAlpha ?? 0) >
        (report.initial.colours.assistantAlpha ?? 1),
      `colour schemes did not swap: ${JSON.stringify(report.initial.colours)}`,
    );

    // The live turn is wired too: both new bubbles have a clock and a copy
    // control, not just the loaded history.
    for (const row of report.live.rows) {
      assert.ok(row.timeText, `live ${row.role} bubble has no stamp`);
      assert.ok(row.timeIso, `live ${row.role} bubble has no time element`);
    }
    const liveUser = report.live.rows.find((row) => row.text === "Live prompt");
    const liveReply = report.live.rows.find(
      (row) => row.text === "Live reply. Still here.",
    );
    assert.ok(liveUser && liveReply, "the live turn lost a side");
    assert.ok(
      Math.abs(liveUser.bubble.left - report.initial.container.left) <= 1,
      "the live operator bubble does not sit left",
    );
    assert.ok(
      Math.abs(liveReply.bubble.right - report.initial.container.right) <= 1,
      "the live reply bubble does not sit right",
    );

    assert.equal(fs.existsSync(report.shots.thread), true, "driver wrote no screenshot");
  });
});
