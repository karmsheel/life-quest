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
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-companion-edit.json");

/**
 * The rig renders the real Dashboard in a real layout engine, so it needs the Vite
 * dev server. With the server down the test skips; `npm run dev` in another
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
      [path.join(desktopRoot, "e2e/dashboard-companion-edit.electron.mjs")],
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

type Leg = {
  label: string;
  failures: string[];
  anchorSlide?: number;
  before: { scrollTop: number; maxScrollTop: number; anchor: { id: string } | null };
  after: { scrollTop: number; maxScrollTop: number; anchor: { id: string } | null };
};

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  checks: {
    skin: string | null;
    unexpectedBridgeCalls: string[];
    before: { scrollTop: number; editRows: number; anchor: { id: string } | null };
    afterBlocks: Leg;
    afterGrow: Leg;
    afterAbove: Leg;
    afterBoard: Leg;
    afterQuiet: Leg;
    beforeCardHeight: number;
    afterGrowCardHeight: number;
    aboveGrewBy: number;
    aboveOffsetDelta: number;
    boardOffsetDelta: number;
    growSamples: { sawLoading: boolean };
    aboveFrames: Array<{ top: number; max: number; recent: number }>;
    rebuiltCards: string[];
    changedCards: string[];
    focused: boolean;
    contextPill: boolean;
    liveBeforeTurn: string[];
    liveDuringTurn: string[];
    liveAfterTurn: string[];
    final: { pins: string[]; chrome: number; editTitle: string | null };
  };
};

/**
 * Editing a card in place, on a board that scrolls.
 *
 * The report this reads is the whole claim: a companion turn that rewrites the card
 * the operator is reading — reordering its blocks, growing it, growing a card above
 * it, and re-pinning it — must leave the operator looking at the same thing. The
 * assertions below are the ones the artifact makes, restated where they are worth
 * restating: the leg-by-leg failures come out of the report itself.
 */
describe("dashboard companion edit e2e", () => {
  it("holds the board's place while the companion edits a pinned card", async (t) => {
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

    const checks = report.checks;

    // The rig is a real board in the app's own skin, and it reached nothing the
    // stub does not model: a page that grew a new dependency fails loudly.
    assert.equal(checks.skin, "forge-os", "the harness did not paint in the app's skin");
    assert.deepEqual(checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.consoleErrors, []);

    // The board was genuinely scrolled and genuinely longer than its window, so
    // every claim below is about a position worth losing.
    assert.ok(checks.before.scrollTop > 0, "the board was parked at the top");
    assert.ok(
      checks.before.maxScrollTop > 0,
      "the board fits its window, so there was no position to lose",
    );
    assert.equal(checks.before.anchor?.id, "view:financial:v-recent");
    assert.ok(checks.before.editRows > 0, "the edited card drew no rows");

    // ── the exact numbers, one leg at a time ─────────────────────────────────
    // Each of these is also asserted inside the rig; they are repeated here because
    // this file is what a reader of the suite sees when the rig goes red.
    for (const [name, leg] of [
      ["blocks", checks.afterBlocks],
      ["grow", checks.afterGrow],
      ["above", checks.afterAbove],
      ["board", checks.afterBoard],
      ["quiet", checks.afterQuiet],
    ] as const) {
      assert.deepEqual(leg.failures, [], `${name} leg: ${leg.failures.join("; ")}`);
      assert.equal(
        leg.after.anchor?.id,
        leg.before.anchor?.id,
        `${name} leg: the card under the operator's eye changed`,
      );
    }

    // The card that was edited is taller by the companion's third block, and the
    // card below it is exactly where it was — the case a frozen board would fail.
    assert.ok(
      checks.afterGrowCardHeight > checks.beforeCardHeight,
      `the companion's block did not grow the card: ${checks.beforeCardHeight} → ${checks.afterGrowCardHeight}`,
    );
    assert.equal(checks.growSamples.sawLoading, false, "a card was rebuilt, not edited");
    assert.deepEqual(checks.rebuiltCards, [], "the turn replaced card DOM instead of editing one");

    // The card that was edited said so, in place, while it happened — one card and
    // not the whole board, because a board where every card pulses on every write
    // is a board that says nothing.
    assert.deepEqual(
      checks.changedCards,
      ["view:financial:v-recent"],
      "the edit was not marked on exactly the card that changed",
    );

    // A card ABOVE the operator grows: the offset has to move by exactly the
    // growth, because that is what holding a place against a reflow above means.
    assert.ok(checks.aboveGrewBy > 0, "the leg above the eye wrote nothing");
    assert.ok(
      Math.abs(checks.aboveOffsetDelta - checks.aboveGrewBy) <= 2,
      `a card above grew ${checks.aboveGrewBy}px and the offset moved ${checks.aboveOffsetDelta}px`,
    );
    const firstFrame = checks.aboveFrames[0];
    const lastFrame = checks.aboveFrames[checks.aboveFrames.length - 1];
    assert.ok(firstFrame && lastFrame, "the above leg recorded no frames");
    assert.ok(
      lastFrame!.top - firstFrame!.top >= checks.aboveGrewBy - 2,
      `the recorded frames show the offset moving only ${lastFrame!.top - firstFrame!.top}px of ${checks.aboveGrewBy}`,
    );
    assert.ok(
      lastFrame!.max - firstFrame!.max >= checks.aboveGrewBy - 2,
      `the board did not grow by the companion's block: ${firstFrame!.max} → ${lastFrame!.max}`,
    );
    assert.ok(
      lastFrame!.recent > firstFrame!.recent,
      `the edited card did not grow on screen: ${firstFrame!.recent} → ${lastFrame!.recent}`,
    );

    // A re-pin carries the operator's place with the card: the offset moves by the
    // card's own change of slot, which is where the pre-fix build slid the board.
    assert.ok(
      Math.abs(checks.boardOffsetDelta) > 2,
      `the re-pin moved the card and the board did not follow (${checks.boardOffsetDelta}px)`,
    );

    // ...and the control: an event with nothing behind it moves nothing.
    assert.equal(
      checks.afterQuiet.after.scrollTop,
      checks.afterQuiet.before.scrollTop,
      "an event with nothing written moved the board",
    );

    // ── the card the companion is working on ─────────────────────────────────
    // An operator hands a card to the chat, then a turn starts and ends: the ring
    // is on exactly that card, for exactly that window, and on nothing else.
    assert.equal(checks.focused, true, "the card's chat control was not on the board");
    assert.equal(checks.contextPill, true, "the card never reached the chat");
    assert.deepEqual(checks.liveBeforeTurn, [], "a card was ringed before any turn");
    assert.deepEqual(
      checks.liveDuringTurn,
      ["view:financial:v-recent"],
      "the turn did not ring exactly the card being worked on",
    );
    assert.deepEqual(checks.liveAfterTurn, [], "the ring outlived its turn");

    // The board is still a board: the same pins, still editable, with the card it
    // edited drawn under its own name.
    assert.ok(checks.final.pins.length >= 2, "the board lost its cards");
    assert.ok(checks.final.chrome > 0, "the board lost its editing chrome");
    assert.equal(checks.final.editTitle, "Spending by month");
  });
});
