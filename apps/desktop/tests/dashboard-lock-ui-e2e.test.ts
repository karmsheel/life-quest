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

type TitleRow = {
  heading: Box | null;
  badge: Box | null;
  viewportWidth: number;
};

type Trigger = {
  tag: string;
  className: string;
  testid: string | null;
  isButton: boolean;
  type: string | null;
  label: string | null;
  title: string | null;
  haspopup: string | null;
  expanded: string | null;
  svgs: number;
  box: Box;
  viewportWidth: number;
};

type MenuItem = {
  testid: string | null;
  role: string | null;
  label: string | null;
  title: string | null;
  caption: string;
  checked: string | null;
  expanded: string | null;
  locked: string | null;
  disabled: boolean;
  svgs: number;
  icon: string | null;
  track: boolean;
  thumb: boolean;
  className: string;
  box: Box;
  onTop: boolean;
};

type Popover = {
  testid: string | null;
  role: string | null;
  label: string | null;
  className: string;
  position: string;
  zIndex: string;
  box: Box;
  itemCount: number;
  itemTestIds: (string | null)[];
  items: MenuItem[];
  gridTop: number | null;
  viewportWidth: number;
  overlaysContent: boolean;
};

type ActiveElement = {
  testid: string | null;
  tag: string;
  className: string | null;
};

type BoardSample = {
  badge: string | null;
  badgeLocked: string | null;
  badgeClass: string | null;
  hint: string | null;
  titleRow: TitleRow | null;
  trigger: Trigger | null;
  popover: Popover | null;
  lock: MenuItem | null;
  add: MenuItem | null;
  lockItemsInDocument: number;
  addItemsInDocument: number;
  standaloneSwitches: number;
  lockSwitchClasses: number;
  menusInDocument: number;
  activeElement: ActiveElement | null;
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
    unlockedMenu: BoardSample;
    escaped: BoardSample;
    outsideClosed: BoardSample;
    toggled: BoardSample;
    openedPinBoard: BoardSample;
    addOpenMenu: BoardSample;
    pinBoardClosed: BoardSample;
    locked: BoardSample;
    lockedMenu: BoardSample;
    afterLockClickMenu: BoardSample;
    toggleCalls: { locked: boolean; boardSlug: string | null }[];
    afterUnlockClick: BoardSample;
    restoredMenu: BoardSample;
    unexpectedBridgeCalls: string[];
    pinWritesWhileLocked: unknown[];
    consoleErrors: string[];
  };
  samples: { unlocked: BoardSample; locked: BoardSample };
};

/**
 * The Dashboard page lock, behind the page's three-dot menu: the board is
 * editable while unlocked and read-only — no pin chrome, no Add-pin row — while
 * locked. The lock is the menu's FIRST item, a `menuitemcheckbox` that keeps the
 * menu open while it writes; the pin board is the second. The state badge sits
 * beside the page's name, and no standalone switch is left in the corner.
 */
describe("dashboard lock ui e2e", () => {
  it("makes the board read-only while locked and editable while unlocked, through the page menu", async (t) => {
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

    // The unlocked board is editable, and the page's controls are one menu. The
    // standalone switch is gone from the whole page, and a closed menu puts no
    // items in the document — those two are what this change is.
    assert.equal(report.checks.unlocked.badge, "Unlocked");
    assert.equal(report.checks.unlocked.badgeLocked, "false");
    assert.equal(report.checks.unlocked.standaloneSwitches, 0, "a standalone lock switch is left");
    assert.equal(report.checks.unlocked.lockSwitchClasses, 0, "a .lock-switch is left on the page");
    assert.equal(report.checks.unlocked.popover, null, "the menu was open on landing");
    assert.equal(report.checks.unlocked.lock, null, "a closed menu still read a lock item");
    assert.equal(report.checks.unlocked.add, null, "a closed menu still read a pin-board item");
    assert.equal(report.checks.unlocked.lockItemsInDocument, 0, "the closed menu left its lock item behind");
    assert.equal(report.checks.unlocked.addItemsInDocument, 0, "the closed menu left its pin item behind");
    assert.equal(report.checks.unlocked.addPinRow, false, "the pin board was open on landing");
    assert.ok(report.checks.unlocked.chrome > 0, "an unlocked board drew no pin chrome");

    // The trigger is measured, at the page's top right, announcing a menu.
    const trigger = report.checks.unlocked.trigger;
    assert.ok(trigger, "the page drew no page-menu trigger");
    assert.equal(trigger.isButton, true, "the trigger is not a button");
    assert.deepEqual(trigger.className.split(/\s+/), [
      "btn",
      "btn-ghost",
      "page-menu__trigger",
      "page-corner__action",
    ]);
    assert.equal(trigger.haspopup, "menu");
    assert.equal(trigger.expanded, "false");
    assert.equal(trigger.label, "Dashboard actions");
    assert.equal(trigger.svgs, 1, "the trigger did not draw its three dots");
    assert.ok(trigger.box.top <= 120, `the trigger is not at the top: top ${trigger.box.top}`);
    assert.ok(
      trigger.box.right >= trigger.viewportWidth / 2,
      `the trigger is not on the right: right ${trigger.box.right} of ${trigger.viewportWidth}`,
    );

    // The badge is back beside the page's name: same line, left half of the
    // page. A badge that drifted back into the top-right corner fails here.
    const titleRow = report.checks.unlocked.titleRow;
    assert.ok(titleRow?.heading, "the page's heading recorded no box");
    assert.ok(titleRow?.badge, "the page's badge recorded no box");
    const headingMid = (titleRow.heading.top + titleRow.heading.bottom) / 2;
    const badgeMid = (titleRow.badge.top + titleRow.badge.bottom) / 2;
    assert.ok(
      Math.abs(headingMid - badgeMid) <= 6,
      `the badge is not on the heading's line: badge mid ${badgeMid}, heading mid ${headingMid}`,
    );
    assert.ok(
      titleRow.badge.left >= titleRow.heading.left &&
        titleRow.badge.left <= titleRow.heading.left + titleRow.heading.width,
      "the badge is not inside the heading row",
    );
    assert.ok(
      titleRow.badge.right <= titleRow.viewportWidth / 2,
      `the badge is still on the page's right: badge right ${titleRow.badge.right} of ${titleRow.viewportWidth}`,
    );

    // ── the open menu: lock first, pin board second ──────────────────────────
    const menu = report.checks.unlockedMenu;
    assert.equal(menu.trigger?.expanded, "true", "the trigger did not report the menu open");
    const popover = menu.popover;
    assert.ok(popover, "opening the trigger drew no popover");
    assert.equal(popover.role, "menu");
    assert.equal(popover.label, "Dashboard actions");
    assert.equal(popover.testid, "board-page-menu-popover");
    assert.ok(popover.className.split(/\s+/).includes("page-menu__popover"));
    assert.equal(popover.position, "absolute", "the popover is not a floating menu");
    assert.equal(popover.itemCount, 2, `the menu offered ${JSON.stringify(popover.itemTestIds)}`);
    assert.deepEqual(popover.itemTestIds, ["board-lock-toggle", "board-add-toggle"]);

    // Anchored under the trigger, right-aligned to it, beginning above the grid,
    // and painted over the page rather than under it.
    assert.ok(
      popover.box.top >= trigger.box.bottom - 1,
      `the popover (top ${popover.box.top}) is not under the trigger (bottom ${trigger.box.bottom})`,
    );
    assert.ok(
      popover.box.top - trigger.box.bottom <= 16,
      `the popover is detached from the trigger: ${popover.box.top - trigger.box.bottom}px below`,
    );
    assert.ok(
      Math.abs(popover.box.right - trigger.box.right) <= 2,
      `the popover is not right-aligned to the trigger: ${popover.box.right} vs ${trigger.box.right}`,
    );
    assert.ok(
      popover.gridTop !== null && popover.box.top < popover.gridTop,
      `the popover begins below the grid: top ${popover.box.top}, grid ${popover.gridTop}`,
    );
    assert.equal(popover.overlaysContent, true, "the popover painted under the page content");
    assert.deepEqual(
      popover.items.map((item) => item.onTop),
      [true, true],
      "a menu item was painted under the page",
    );

    // The lock is the menu's first item, and it is a checkbox whose track and
    // thumb draw the state the aria-checked announces.
    const lock = menu.lock;
    assert.ok(lock, "the menu drew no lock item");
    assert.equal(lock.role, "menuitemcheckbox");
    assert.equal(lock.checked, "false");
    assert.equal(lock.locked, "false");
    assert.equal(lock.label, "Lock this dashboard");
    assert.equal(lock.caption, "Lock");
    assert.equal(lock.track, true, "the lock item drew no track");
    assert.equal(lock.thumb, true, "the lock item drew no thumb");
    assert.equal(lock.disabled, false);

    // The pin board is the second item, and it carries the lucide pin.
    const add = menu.add;
    assert.ok(add, "the menu offered no pin-board item");
    assert.equal(add.role, "menuitem");
    assert.match(add.caption, /^pin board$/i);
    assert.equal(add.expanded, "false");
    assert.equal(add.svgs, 1);
    assert.match(add.icon ?? "", /lucide-pin/);
    assert.equal(add.checked, null, "the pin-board item is a checkbox");

    // ── keyboard: Escape closes and hands the trigger its keyboard back ──────
    assert.equal(report.checks.escaped.popover, null, "Escape left the menu open");
    assert.equal(report.checks.escaped.trigger?.expanded, "false");
    assert.equal(
      report.checks.escaped.activeElement?.testid,
      "board-page-menu",
      `Escape did not return focus to the trigger: ${JSON.stringify(report.checks.escaped.activeElement)}`,
    );

    // A press outside closes it, and the trigger toggles.
    assert.equal(report.checks.outsideClosed.popover, null, "a press outside left the menu open");
    assert.equal(report.checks.outsideClosed.trigger?.expanded, "false");
    assert.equal(report.checks.toggled.popover, null, "a second press on the trigger left the menu open");

    // ── the pin board is chosen from the menu, and it draws its row ──────────
    const opened = report.checks.openedPinBoard;
    assert.equal(opened.addPinRow, true, "choosing Pin board drew no Add-pin row");
    assert.ok(opened.strayAddButtons > 0, "the Add-pin row offered nothing to add");
    assert.equal(opened.popover, null, "choosing Pin board left the menu open");
    assert.equal(opened.add, null, "the chosen menu item stayed in the document");
    const addOpen = report.checks.addOpenMenu;
    assert.match(addOpen.add?.caption ?? "", /^hide pin board$/i);
    assert.equal(addOpen.add?.expanded, "true", "the open pin board's item did not report aria-expanded");
    assert.equal(report.checks.pinBoardClosed.addPinRow, false, "choosing Hide pin board left the row open");
    assert.equal(report.checks.pinBoardClosed.popover, null, "choosing Hide pin board left the menu open");

    // ── the locked board is read-only, and its menu still leads with the lock ─
    const locked = report.checks.locked;
    assert.equal(locked.badge, "Locked");
    assert.equal(locked.badgeLocked, "true");
    assert.ok(locked.trigger, "a locked board lost its menu trigger");
    assert.equal(locked.trigger?.expanded, "false");
    assert.equal(locked.popover, null);
    assert.equal(locked.addPinRow, false, "a locked board still offered Add pin");
    assert.equal(locked.chrome, 0, "a locked board is still editable");
    assert.equal(locked.chromeButtons, 0);
    // The lock hides the chrome; it must not hide the board.
    assert.equal(
      locked.pins,
      report.checks.unlocked.pins,
      "the lock changed how many cards the board shows",
    );
    assert.match(locked.hint ?? "", /locked/i);
    assert.match(locked.hint ?? "", /Decisions/);
    // The badge keeps its place beside the name in both states: a badge that
    // drifts into the corner when the board locks would fail here.
    assert.ok(locked.titleRow?.badge, "the locked board's badge left the heading row");
    assert.ok(
      locked.titleRow!.badge!.right <= locked.titleRow!.viewportWidth / 2,
      "the locked board's badge is on the page's right rather than beside the name",
    );

    const lockedMenu = report.checks.lockedMenu;
    assert.ok(lockedMenu.popover, "a locked board's menu would not open");
    assert.equal(lockedMenu.popover?.itemCount, 1, "a locked board's menu grew items");
    assert.deepEqual(lockedMenu.popover?.itemTestIds, ["board-lock-toggle"]);
    assert.equal(lockedMenu.add, null, "a locked board still offered the pin-board item");
    const lockedLock = lockedMenu.lock;
    assert.ok(lockedLock, "a locked board's menu has no lock item, so it can never be unlocked");
    assert.equal(lockedLock.role, "menuitemcheckbox");
    assert.equal(lockedLock.checked, "true");
    assert.equal(lockedLock.locked, "true");
    assert.equal(lockedLock.label, "Unlock this dashboard");
    assert.equal(lockedLock.caption, "Lock");
    assert.equal(lockedLock.track, true);
    assert.equal(lockedLock.thumb, true);

    // ── the lock item is a real write, and it keeps the menu open ────────────
    assert.deepEqual(report.checks.toggleCalls, [{ locked: false, boardSlug: null }]);
    const afterLockClick = report.checks.afterLockClickMenu;
    assert.ok(afterLockClick.popover, "the menu closed when the lock was chosen");
    assert.equal(afterLockClick.trigger?.expanded, "true");
    assert.equal(afterLockClick.lock?.checked, "false", "the lock item did not flip in place");
    assert.equal(afterLockClick.lock?.locked, "false");
    assert.equal(afterLockClick.badge, "Unlocked");
    assert.equal(report.checks.afterUnlockClick.popover, null, "Escape did not close the menu");
    assert.ok(report.checks.afterUnlockClick.chrome > 0, "unlocking did not restore the pin chrome");
    assert.equal(
      report.checks.afterUnlockClick.addPinRow,
      false,
      "unlocking left the pin board open by itself",
    );
    assert.ok(report.checks.restoredMenu.add, "unlocking did not restore the pin-board menu item");

    // Nothing reached the bridge that this rig does not model, and no pin write
    // was attempted while the board was locked.
    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.pinWritesWhileLocked, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // The artifacts the hand-over points at: the locked state (the feature's
    // own claim), the unlocked board (the trigger's home), and the open menu
    // (lock first, pin board second).
    for (const name of [
      "dashboard-lock-ui.png",
      "dashboard-lock-ui-unlocked.png",
      "dashboard-lock-ui-menu.png",
    ]) {
      const shot = path.join(desktopRoot, "e2e/artifacts", name);
      assert.equal(fs.existsSync(shot), true, `${name} was not written`);
      assert.ok(fs.statSync(shot).size > 1000, `${name} is not a rendered screenshot`);
    }
  });
});
