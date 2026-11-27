/**
 * The chat-panel harness page (`e2e/chat-panel.{html,tsx}`) driven by
 * `chat-bubble-meta.electron.mjs`: the operator's turn as a right-aligned accent
 * bubble, the companion's answer as plain full-width prose on the panel, the
 * role label and the stamp/copy footer under each row, and the live-turn bug
 * where whitespace-only deltas used to paint an empty answer bubble.
 *
 * The rig writes `e2e/artifacts/chat-bubble-meta.{json,png}`; the assertions
 * below restate the contract from that JSON so a driver that reports `pass` for
 * the wrong geometry still fails the suite.
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

type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

type ContentStyle = {
  background: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderTopStyle: string;
  borderColor: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
};

type Row = {
  role: "user" | "assistant";
  testId: string | null;
  roleLabel: string | null;
  text: string;
  rawText: string;
  content: Box;
  contentStyle: ContentStyle;
  alignSelf: string;
  alignItems: string;
  meta: Box | null;
  timeText: string | null;
  timeIso: string | null;
  timeBox: Box | null;
  copyPresent: boolean;
  copyBox: Box | null;
  copyState: string | null;
  copyLabel: string | null;
};

type Copy = { text: string | null; label: string | null };

type Report = {
  pass: boolean;
  failures: string[];
  initial: {
    container: Box;
    companionName: string | null;
    rows: Row[];
    colours: {
      user: string | null;
      assistant: string | null;
      userAlpha: number | null;
      assistantAlpha: number | null;
    };
  };
  whitespace: {
    turnPresent: boolean;
    turnStatus: string | null;
    sendState: string | null;
    userPresent: boolean;
    answerPresent: boolean;
    agentContentPresent: boolean;
    agentContentCount: number;
    answerText: string | null;
    roleLabels: string[];
    processPresent: boolean;
  };
  live: { container: Box; companionName: string | null; rows: Row[] };
  copies: {
    loadedAssistant: Copy;
    loadedUser: Copy;
    liveUser: Copy;
    liveReply: Copy;
  };
  shots: { thread: string; width: number; height: number };
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

/** Alpha channel of a computed colour; 1 when the string carries none. */
function alphaOf(color: string | null): number {
  const text = String(color ?? "");
  if (!text || text === "transparent") return 0;
  const percent = text.match(/\/\s*([\d.]+)\s*%/);
  if (percent) return Number(percent[1]) / 100;
  const numbers = (text.match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3]! : 1;
}

const px = (value: string | null): number => Number.parseFloat(String(value ?? "0"));
const borderWidths = (style: ContentStyle): number[] =>
  [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(
    px,
  );
const paddings = (style: ContentStyle): number[] =>
  [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(px);
const allZero = (values: number[]): boolean =>
  values.every((value) => Math.abs(value) < 0.5);
const near = (a: number, b: number, tolerance = 1): boolean =>
  Math.abs(a - b) <= tolerance;

function assertMeta(prefix: string, row: Row): void {
  assert.ok(row.meta, `${prefix} has no meta row`);
  assert.ok(
    row.meta.top >= row.content.bottom - 1,
    `${prefix} stamp is not under its message: ${JSON.stringify(row)}`,
  );
  assert.ok(
    typeof row.timeText === "string" && row.timeText.length > 0 && /[:\d]/.test(row.timeText),
    `${prefix} has no visible stamp: ${JSON.stringify(row.timeText)}`,
  );
  assert.equal(row.copyPresent, true, `${prefix} has no copy control`);
  assert.ok(
    row.timeBox && row.copyBox && row.copyBox.left >= row.timeBox.right - 1,
    `${prefix} copy control is not to the stamp's right: ${JSON.stringify(row)}`,
  );
  assert.ok(
    row.copyBox &&
      row.meta &&
      row.copyBox.top < row.meta.bottom &&
      row.copyBox.bottom > row.meta.top,
    `${prefix} copy control is not beside its stamp`,
  );
}

describe("chat bubble meta", () => {
  it("right-aligns the operator's bubble and lets the answer rest on the panel", async (t) => {
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
    assert.equal(report.initial.rows.length, 2, "the loaded transcript lost a row");
    assert.equal(report.live.rows.length, 4, "the live turn did not add both sides");
    assert.ok(report.initial.companionName, "the dock did not name its companion");
    assert.equal(report.live.companionName, report.initial.companionName);

    const user = report.initial.rows.find((row) => row.role === "user");
    const assistant = report.initial.rows.find((row) => row.role === "assistant");
    assert.ok(user && assistant, "both loaded roles rendered");

    // A. The operator's turn is a bubble pinned to the transcript's trailing
    // edge, wearing the accent scheme (a fill and a border), and clearly inside
    // on the leading side.
    assert.equal(user.alignSelf, "flex-end");
    assert.ok(
      near(user.content.right, report.initial.container.right),
      `operator bubble did not touch the right edge: ${JSON.stringify(user.content)}`,
    );
    assert.ok(
      user.content.left > report.initial.container.left + 4,
      `operator bubble is not clearly inside: ${JSON.stringify(user.content)}`,
    );
    assert.ok(
      alphaOf(user.contentStyle.background) > 0.05,
      `operator bubble has no accent tint: ${user.contentStyle.background}`,
    );
    assert.ok(
      borderWidths(user.contentStyle).every((width) => width >= 1) &&
        user.contentStyle.borderTopStyle !== "none",
      `operator bubble has no visible border: ${JSON.stringify(user.contentStyle)}`,
    );

    // B. The companion's answer is not a bubble: no fill, no border, no
    // padding, starting at the transcript's leading edge and filling its width.
    assert.ok(
      alphaOf(assistant.contentStyle.background) <= 0.001,
      `answer still has a fill: ${assistant.contentStyle.background}`,
    );
    assert.ok(
      allZero(borderWidths(assistant.contentStyle)),
      `answer still has a border: ${JSON.stringify(borderWidths(assistant.contentStyle))}`,
    );
    assert.ok(
      allZero(paddings(assistant.contentStyle)),
      `answer still has padding: ${JSON.stringify(paddings(assistant.contentStyle))}`,
    );
    assert.ok(
      near(assistant.content.left, report.initial.container.left),
      `answer does not start at the leading edge: ${JSON.stringify(assistant.content)}`,
    );
    assert.ok(
      near(assistant.content.width, report.initial.container.width, 2),
      `answer is not the transcript's width: ${assistant.content.width}px vs ${report.initial.container.width}px`,
    );
    assert.notEqual(
      assistant.alignSelf,
      "flex-end",
      "the answer row is pushed to the trailing edge",
    );

    // C. Both rows keep their role label and their stamp + copy footer.
    assert.equal(user.roleLabel, "You");
    assert.equal(assistant.roleLabel, report.initial.companionName);
    assertMeta("the operator's loaded row", user);
    assertMeta("the companion's loaded row", assistant);

    // The loaded transcript's instants survive the gateway hop.
    assert.equal(user.timeIso, new Date(1_700_000_000_000).toISOString());
    assert.equal(assistant.timeIso, new Date(1_700_000_002_000).toISOString());

    // The control copies its own row, and says so.
    assert.equal(report.copies.loadedAssistant.text, "Ready.");
    assert.ok(report.copies.loadedAssistant.label?.startsWith("Copied"));
    assert.equal(report.copies.loadedUser.text, "Composer harness");
    assert.ok(report.copies.loadedUser.label?.startsWith("Copied"));

    // D. The shipped empty-bubble bug: whitespace-only deltas during an open
    // turn must paint no answer row and no agent content; only the work log.
    assert.equal(report.whitespace.turnPresent, true, "the live turn never opened");
    assert.equal(report.whitespace.turnStatus, "running");
    assert.equal(report.whitespace.answerPresent, false, "whitespace painted an answer row");
    assert.equal(report.whitespace.agentContentPresent, false);
    assert.equal(
      report.whitespace.agentContentCount,
      1,
      "whitespace added agent content beyond the loaded answer",
    );
    assert.ok(report.whitespace.roleLabels.includes("You"));

    // E. The live turn follows the same sides as loaded history.
    const liveUser = report.live.rows.find(
      (row) => row.role === "user" && row.text === "Live prompt",
    );
    const liveReply = report.live.rows.find(
      (row) => row.role === "assistant" && row.text === "Live reply. Still here.",
    );
    assert.ok(liveUser && liveReply, "the live turn lost a side");

    assert.equal(liveUser.alignSelf, "flex-end");
    assert.ok(
      near(liveUser.content.right, report.live.container.right),
      `live operator bubble did not touch the right edge: ${JSON.stringify(liveUser.content)}`,
    );
    assert.ok(alphaOf(liveUser.contentStyle.background) > 0.05);
    assert.ok(borderWidths(liveUser.contentStyle).every((width) => width >= 1));

    assert.ok(alphaOf(liveReply.contentStyle.background) <= 0.001);
    assert.ok(allZero(borderWidths(liveReply.contentStyle)));
    assert.ok(allZero(paddings(liveReply.contentStyle)));
    assert.ok(
      near(liveReply.content.left, report.live.container.left),
      `live reply does not start at the leading edge: ${JSON.stringify(liveReply.content)}`,
    );
    assert.ok(
      near(liveReply.content.width, report.live.container.width, 2),
      `live reply is not the transcript's width: ${liveReply.content.width}px vs ${report.live.container.width}px`,
    );
    assert.notEqual(liveReply.alignSelf, "flex-end");

    assert.equal(liveUser.roleLabel, "You");
    assert.equal(liveReply.roleLabel, report.live.companionName);
    for (const [prefix, row] of [
      ["the live operator row", liveUser],
      ["the live reply", liveReply],
    ] as const) {
      assertMeta(prefix, row);
      assert.ok(row.timeIso, `${prefix} has no time element`);
      assert.ok(
        Math.abs(Date.parse(row.timeIso!) - Date.now()) < 60_000,
        `${prefix} stamp does not describe now: ${row.timeIso}`,
      );
    }

    // The reply the operator can copy is the reply itself — the whitespace the
    // stream sent first never leaked into it.
    assert.equal(report.copies.liveUser.text, "Live prompt");
    assert.ok(report.copies.liveUser.label?.startsWith("Copied"));
    assert.equal(report.copies.liveReply.text, "Live reply. Still here.");
    assert.ok(report.copies.liveReply.label?.startsWith("Copied"));

    // F. The artifact exists and is a real capture at the reported size.
    assert.equal(fs.existsSync(report.shots.thread), true, "driver wrote no screenshot");
    const png = fs.readFileSync(report.shots.thread);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "the screenshot is not a PNG",
    );
    assert.equal(png.readUInt32BE(16), report.shots.width);
    assert.equal(png.readUInt32BE(20), report.shots.height);
    assert.ok(report.shots.width > 0 && report.shots.height > 0);
  });
});
