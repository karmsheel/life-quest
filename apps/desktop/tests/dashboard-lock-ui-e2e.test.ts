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
const REPORT = path.join(desktopRoot, "e2e/artifacts/dashboard-lock-ui.json");

/**
 * The rig renders the real Dashboard in a real layout engine, so it needs the
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
      [path.join(desktopRoot, "e2e/dashboard-lock-ui.electron.mjs")],
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

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type Corner = {
  badge: Box | null;
  switch: Box | null;
  pinboard: Box | null;
  alignItems: string;
  flexDirection: string;
  viewportWidth: number;
};

type BoardSample = {
  badge: string | null;
  badgeLocked: string | null;
  toggle: string | null;
  toggleRole: string | null;
  toggleChecked: string | null;
  toggleLabel: string | null;
  switchTrack: boolean;
  switchThumb: boolean;
  hint: string | null;
  corner: Corner | null;
  pinboardPaint: { background: string; color: string; shadow: string } | null;
  addToggle: boolean;
  addPinRow: boolean;
  pins: number;
  chrome: number;
  chromeButtons: number;
  strayAddButtons: number;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    unlocked: BoardSample;
    openedPinBoard: BoardSample;
    locked: BoardSample;
    toggleCalls: { locked: boolean; boardSlug: string | null }[];
    afterUnlockClick: BoardSample;
    pinboardHover: { rest: string; hovered: string };
    unexpectedBridgeCalls: string[];
    pinWritesWhileLocked: unknown[];
    consoleErrors: string[];
  };
  samples: { unlocked: BoardSample; locked: BoardSample };
};

/**
 * The Dashboard page lock, as the operator sees it: the board is editable while
 * unlocked and read-only — no pin chrome, no Add-pin row — while locked, and the
 * header's switch is the one way to change that. The page's corner holds the
 * state badge, the switch under it and the pin board's menu under that.
 */
describe("dashboard lock ui e2e", () => {
  it("makes the board read-only while locked and editable while unlocked", async (t) => {
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

    // The unlocked board is editable, and says so. The lock is one switch whose
    // position is the state, not a Lock/Unlock button whose caption is an
    // action; the pin board is a control now, offered closed, and asking for it
    // is what draws the row.
    assert.equal(report.checks.unlocked.badge, "Unlocked");
    assert.equal(report.checks.unlocked.badgeLocked, "false");
    assert.equal(report.checks.unlocked.toggleRole, "switch");
    assert.equal(report.checks.unlocked.toggleChecked, "false");
    assert.equal(report.checks.unlocked.toggleLabel, "Lock this dashboard");
    assert.equal(report.checks.unlocked.toggle, "Lock");
    assert.equal(report.checks.unlocked.switchTrack, true, "the switch drew no track");
    assert.equal(report.checks.unlocked.switchThumb, true, "the switch drew no thumb");
    assert.equal(report.checks.unlocked.addToggle, true, "an unlocked board offered no pin board");
    assert.equal(report.checks.unlocked.addPinRow, false, "the pin board was open on landing");
    assert.equal(report.checks.openedPinBoard.addPinRow, true, "the control did not draw the row");
    assert.ok(report.checks.openedPinBoard.strayAddButtons > 0, "the row offered nothing to add");
    assert.ok(report.checks.unlocked.chrome > 0, "an unlocked board drew no pin chrome");

    // The page's corner: state, switch, menu — stacked at the top right. The
    // boxes are measured on the rendered page, so a corner that drifted back to
    // a row, to the left, or below the title fails here.
    const corner = report.checks.unlocked.corner;
    assert.ok(corner, "the page drew no corner for its state and controls");
    const badgeBox = corner.badge;
    const switchBox = corner.switch;
    const pinboardBox = corner.pinboard;
    assert.ok(badgeBox, "the corner has no badge");
    assert.ok(switchBox, "the corner has no switch");
    assert.ok(pinboardBox, "the corner has no pin board");
    assert.equal(corner.flexDirection, "column", "the page's corner is not a stack");
    assert.equal(corner.alignItems, "flex-end", "the page's corner is not trailing-aligned");
    assert.ok(
      badgeBox.bottom <= switchBox.top,
      "the badge does not sit above the switch",
    );
    assert.ok(
      switchBox.bottom <= pinboardBox.top,
      "the switch does not sit above the pin board",
    );
    assert.equal(badgeBox.right, switchBox.right, "the badge and switch are not right-aligned");
    assert.equal(
      switchBox.right,
      pinboardBox.right,
      "the switch and pin board are not right-aligned",
    );
    assert.ok(
      badgeBox.right >= corner.viewportWidth / 2,
      `the corner is not on the page's right edge: badge right ${badgeBox.right} of ${corner.viewportWidth}`,
    );
    assert.ok(badgeBox.top <= 120, `the corner is not at the top: badge top ${badgeBox.top}`);

    // The pin board's menu wears the accent, and lifting the pointer onto it
    // draws a shadow it does not have at rest.
    assert.notEqual(
      report.checks.unlocked.pinboardPaint?.background,
      "rgba(0, 0, 0, 0)",
      "the pin board's button has no fill of its own",
    );
    assert.notEqual(
      report.checks.pinboardHover.hovered,
      report.checks.pinboardHover.rest,
      "hovering the pin board drew no shadow",
    );
    assert.ok(
      report.checks.pinboardHover.hovered.includes("20px"),
      `the pin board's hover shadow is not the lifted one: ${report.checks.pinboardHover.hovered}`,
    );

    // The locked board is read-only: this is the claim the feature rests on.
    assert.equal(report.checks.locked.badge, "Locked");
    assert.equal(report.checks.locked.badgeLocked, "true");
    assert.equal(report.checks.locked.toggleRole, "switch");
    assert.equal(report.checks.locked.toggleChecked, "true", "the locked board's switch is not on");
    assert.equal(report.checks.locked.toggleLabel, "Unlock this dashboard");
    assert.equal(report.checks.locked.addToggle, false, "a locked board still offered a pin board");
    assert.equal(report.checks.locked.addPinRow, false, "a locked board still offered Add pin");
    assert.equal(report.checks.locked.chrome, 0, "a locked board is still editable");
    assert.equal(report.checks.locked.chromeButtons, 0);
    // The lock hides the chrome; it must not hide the board.
    assert.equal(
      report.checks.locked.pins,
      report.checks.unlocked.pins,
      "the lock changed how many cards the board shows",
    );
    assert.match(report.checks.locked.hint ?? "", /locked/i);
    assert.match(report.checks.locked.hint ?? "", /Decisions/);

    // The control is a real write to the board, and it toggles back.
    assert.deepEqual(report.checks.toggleCalls, [{ locked: false, boardSlug: null }]);
    assert.equal(report.checks.afterUnlockClick.badge, "Unlocked");
    assert.equal(report.checks.afterUnlockClick.toggleChecked, "false");
    assert.equal(
      report.checks.afterUnlockClick.addToggle,
      true,
      "unlocking did not restore the pin-board control",
    );
    assert.equal(
      report.checks.afterUnlockClick.addPinRow,
      false,
      "unlocking left the pin board open by itself",
    );

    // Nothing reached the bridge that this rig does not model, and no pin write
    // was attempted while the board was locked.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.pinWritesWhileLocked, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // The artifacts the hand-over points at: the locked state (the feature's
    // own claim) and the unlocked corner (this change).
    for (const name of [
      "dashboard-lock-ui.png",
      "dashboard-lock-ui-unlocked.png",
      "dashboard-lock-ui-pinboard-hover.png",
    ]) {
      const shot = path.join(desktopRoot, "e2e/artifacts", name);
      assert.equal(fs.existsSync(shot), true, `${name} was not written`);
      assert.ok(fs.statSync(shot).size > 1000, `${name} is not a rendered screenshot`);
    }
  });
});
