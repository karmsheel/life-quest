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
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-side.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Borders = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

type Arrangement = {
  viewport: { width: number; height: number };
  tokens: {
    track: number;
    collapsedTrack: number;
    chatTrack: number;
    frame: number;
    rootFontSize: number;
    titlebarHeight: number;
    radiusSm: string;
  };
  vaultText: string;
  vaultName?: string;
  accentBackground: string;
  paperBackground: string;
  shell: { className: string; gridTemplateColumns: string; box: Box } | null;
  rail: { box: Box; display: string; background: string } | null;
  main: {
    box: Box;
    radius: {
      topLeft: string;
      topRight: string;
      bottomRight: string;
      bottomLeft: string;
    };
    border: Borders;
    background: string;
    boxShadow: string;
  } | null;
  chat: {
    box: Box;
    className: string;
    border: Borders;
    background: string;
    backdropFilter: string;
    boxShadow: string;
    heading: string;
  } | null;
  launcher: {
    box: Box;
    label: string | null;
    title: string | null;
    position: string;
    borderRadius: string;
    background: string;
    color: string;
    borderColor: string;
    borderWidth: string;
    mark: boolean;
    markMask: string | null;
    markWidth: number | null;
    markHeight: number | null;
  } | null;
  actions: {
    box: Box;
    controls: { label: string | null; icon: string | null; disabled: boolean }[];
    badge: { label: string | null; text: string; box: Box } | null;
  } | null;
  collapseAction: {
    label: string | null;
    title: string | null;
    icon: string | null;
    box: Box;
  } | null;
  trailing: {
    box: Box;
    controls: { tag: string; className: string; label: string | null }[];
  } | null;
  sideSwitch: {
    found?: boolean;
    label?: string | null;
    title?: string | null;
    pressed?: string | null;
    icon?: string | null;
    box?: Box;
  };
  /** A stale copy of either chat control in the titlebar: both must be gone. */
  staleTitlebar: { side: boolean; collapse: boolean };
  owners: {
    topLeft: string | null;
    bottomLeft: string | null;
    bottomRight: string | null;
    trailingInner: string | null;
  };
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string;
  tokens: Arrangement["tokens"];
  right: Arrangement;
  left: Arrangement;
  dockCollapsed: Arrangement;
  dockCollapsedHover: Arrangement;
  dockCollapsedLight: Arrangement;
  dockCollapsedDarkAgain: Arrangement;
  railCollapsed: Arrangement;
  dockReopened: Arrangement;
  railAndDockCollapsed: Arrangement;
  dockBackUnderCollapsedRail: Arrangement;
  railRestored: Arrangement;
  restored: Arrangement;
  barCollapsed: Arrangement;
  collapsedSwapOpen: Arrangement;
  collapsedSwapped: Arrangement;
  collapsedSwapBackOpen: Arrangement;
  collapsedSwappedBack: Arrangement;
  barReopened: Arrangement;
  screenshots: string[];
};

const isHairline = (value: string | undefined) => {
  const width = parseFloat(value ?? "0");
  return Number.isFinite(width) && width > 0 && width <= 1;
};
const isZero = (value: string | undefined) => parseFloat(value ?? "0") === 0;

/**
 * The switch rig measures the real shell in a real Electron window, so it needs
 * the Vite dev server. With the server down the test skips; `npm run dev` in
 * another shell turns it on.
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
      [path.join(desktopRoot, "e2e/chat-side.electron.mjs")],
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

describe("chat dock side switch", () => {
  it("swaps the dock and the workspace sheet, and swaps them back", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // Restated here so the numbers are asserted by the suite, not only inside the
    // driver — and so a regression names the geometry it broke.
    const {
      right,
      left,
      dockCollapsed,
      dockCollapsedHover,
      dockCollapsedLight,
      dockCollapsedDarkAgain,
      railCollapsed,
      railAndDockCollapsed,
      restored,
      barCollapsed,
      collapsedSwapOpen,
      collapsedSwapped,
      collapsedSwapBackOpen,
      collapsedSwappedBack,
      barReopened,
    } = report;
    const { track, collapsedTrack, chatTrack, frame, rootFontSize, titlebarHeight, radiusSm } =
      report.tokens;

    assert.ok(
      track > 0 && chatTrack > track && frame > 0,
      "tokens were not read",
    );
    assert.ok(
      collapsedTrack > 0 && collapsedTrack < track,
      `the collapsed rail track was not read as a thin column (${collapsedTrack}px vs ${track}px expanded)`,
    );
    assert.ok(
      titlebarHeight > 0 && rootFontSize > 0 && parseFloat(radiusSm) > 0,
      "the strip, the root type size or the radius token was not read",
    );

    // —— The shipped arrangement: rail, sheet, dock. ——
    assert.equal(
      right.shell?.className.includes("shell--chat-right"),
      true,
      `the shipped shell does not wear its own arrangement class: ${right.shell?.className}`,
    );
    assert.equal(right.rail?.box.left, 0, "the rail left the window's leading edge");
    assert.equal(
      right.rail?.box.bottom,
      right.viewport.height,
      "the rail stopped short of the window bottom",
    );
    assert.equal(right.main?.box.left, track, "the sheet left the rail's trailing edge");
    assert.equal(
      right.main?.box.right,
      right.chat?.box.left,
      "the sheet left a gap between itself and the dock",
    );
    assert.equal(
      right.chat?.box.right,
      right.viewport.width,
      "the dock stopped short of the window's trailing edge",
    );
    assert.equal(
      right.chat?.box.width,
      chatTrack + frame,
      `the dock lost the frame's slack: ${right.chat?.box.width}px vs ${chatTrack + frame}px`,
    );
    assert.equal(
      isHairline(right.main?.border.right),
      true,
      `the sheet lost the seam with the dock (${right.main?.border.right})`,
    );
    for (const [edge, width] of Object.entries(right.chat?.border ?? {})) {
      assert.equal(isZero(width), true, `the dock grew a ${edge} border (${width})`);
    }
    // The sheet is square on every corner in both arrangements: it is a pane, not
    // a card, and no corner of it is notched out of the mat.
    for (const [corner, radius] of [
      ["top left", right.main?.radius.topLeft],
      ["top right", right.main?.radius.topRight],
      ["bottom right", right.main?.radius.bottomRight],
      ["bottom left", right.main?.radius.bottomLeft],
    ] as const) {
      assert.equal(
        isZero(radius),
        true,
        `the sheet rounded its ${corner} corner (${radius})`,
      );
    }
    assert.equal(
      right.owners.bottomRight,
      "dock",
      `the window's bottom-right corner is not the dock's (${right.owners.bottomRight})`,
    );
    assert.equal(
      right.owners.bottomLeft,
      "rail",
      `the window's bottom-left corner is not the rail's (${right.owners.bottomLeft})`,
    );

    // The control itself: in the dock's bottom action bar, immediately before the
    // collapse it belongs with, wearing the swap icon and naming the move it
    // makes. The titlebar no longer carries a copy of either chat control.
    const rightTrailing = (right.trailing?.controls ?? []).map((row) => row.className);
    assert.deepEqual(
      rightTrailing.length,
      3,
      `the titlebar's trailing cluster kept a chat control: ${JSON.stringify(rightTrailing)}`,
    );
    for (const [index, needle] of [
      "theme-mode-toggle",
      "window-titlebar__shortcuts",
      "settings-menu",
    ].entries()) {
      assert.ok(
        String(rightTrailing[index] ?? "").includes(needle),
        `the titlebar's trailing child ${index} is not ${needle}: ${JSON.stringify(rightTrailing)}`,
      );
    }
    assert.equal(
      right.staleTitlebar.side,
      false,
      "a .window-titlebar__side-switch is still in the strip",
    );
    assert.equal(
      right.staleTitlebar.collapse,
      false,
      "a .window-titlebar__chat-toggle is still in the strip",
    );
    assert.equal(
      right.sideSwitch.found,
      true,
      "no switch in the dock's bottom action bar",
    );
    assert.equal(
      right.sideSwitch.icon,
      "lucide-arrow-left-right",
      `the switch is not wearing the swap icon (${right.sideSwitch.icon})`,
    );
    assert.equal(
      right.sideSwitch.label,
      "Move chat to the left of the page",
      `the switch names the wrong move: ${right.sideSwitch.label}`,
    );
    assert.equal(
      right.sideSwitch.pressed,
      "false",
      "the switch reports a swapped shell while the dock is on the right",
    );
    // The bar's own order, and the slot that left with the chat list.
    assert.deepEqual(
      right.actions?.controls.map((control) => control.label),
      ["New chat", "Life-Chain", "Move chat to the left of the page", "Collapse chat"],
      `the bottom bar's actions are not in their shipped order: ${JSON.stringify(right.actions?.controls)}`,
    );
    const switchBox = right.sideSwitch.box;
    const rightCollapseBox = right.collapseAction?.box;
    assert.ok(
      switchBox && rightCollapseBox && right.actions?.box,
      "the switch, the collapse control or the bar was not found",
    );
    assert.equal(
      switchBox.right < rightCollapseBox.left &&
        rightCollapseBox.left - switchBox.right <= 8 &&
        switchBox.top >= right.actions.box.top &&
        switchBox.bottom <= right.actions.box.bottom,
      true,
      `the switch does not sit immediately before the collapse control (${JSON.stringify(switchBox)} vs ${JSON.stringify(rightCollapseBox)} in ${JSON.stringify(right.actions?.box)})`,
    );
    assert.equal(
      right.collapseAction?.icon,
      "lucide-panel-right-close",
      `the collapse arrow does not point out of the right-hand dock (${right.collapseAction?.icon})`,
    );

    // —— The swap: one click, and the two panes trade places. ——
    assert.equal(
      left.shell?.className.includes("shell--chat-left"),
      true,
      `the swapped shell does not wear the swapped class: ${left.shell?.className}`,
    );
    assert.equal(
      left.rail?.box.left,
      0,
      "the swap moved the rail off the window's leading edge",
    );
    assert.deepEqual(
      left.rail?.box,
      right.rail?.box,
      "the swap moved the rail",
    );
    assert.equal(
      left.chat?.box.left,
      left.rail?.box.right,
      "the swapped dock did not take the column beside the rail",
    );
    assert.equal(
      left.chat?.box.width,
      chatTrack,
      `the swapped dock still carries the frame's slack: ${left.chat?.box.width}px vs ${chatTrack}px`,
    );
    assert.equal(
      left.main?.box.left,
      left.chat?.box.right,
      "the swapped sheet did not take the dock's trailing edge",
    );
    assert.equal(
      left.main?.box.right,
      left.viewport.width,
      `the swapped sheet stopped short of the window (${left.main?.box.right}px vs ${left.viewport.width}px)`,
    );
    assert.equal(
      isHairline(left.main?.border.left),
      true,
      `the swapped sheet lost the seam on its leading edge (${left.main?.border.left})`,
    );
    assert.equal(
      isZero(left.main?.border.right),
      true,
      `the swapped sheet kept a second line on its trailing edge (${left.main?.border.right})`,
    );
    assert.equal(
      isZero(left.main?.border.top) &&
        isZero(left.main?.border.bottom) &&
        isZero(left.chat?.border.top) &&
        isZero(left.chat?.border.right) &&
        isZero(left.chat?.border.bottom) &&
        isZero(left.chat?.border.left),
      true,
      `the swapped panes grew lines: sheet t/b ${left.main?.border.top}/${left.main?.border.bottom}, dock t/r/b/l ${left.chat?.border.top}/${left.chat?.border.right}/${left.chat?.border.bottom}/${left.chat?.border.left}`,
    );
    for (const [corner, radius] of [
      ["top left", left.main?.radius.topLeft],
      ["top right", left.main?.radius.topRight],
      ["bottom right", left.main?.radius.bottomRight],
      ["bottom left", left.main?.radius.bottomLeft],
    ] as const) {
      assert.equal(
        isZero(radius),
        true,
        `the swapped sheet rounded its ${corner} corner (${radius})`,
      );
    }
    assert.equal(
      left.chat?.background,
      left.main?.background,
      `the swapped dock is not on the sheet's surface (${left.chat?.background} vs ${left.main?.background})`,
    );
    assert.equal(
      left.owners.bottomRight,
      "sheet",
      `the sheet is not painted into the window's bottom-right corner (${left.owners.bottomRight})`,
    );
    assert.equal(
      left.owners.trailingInner,
      "sheet",
      `a dock's width in from the trailing edge is not the sheet (${left.owners.trailingInner})`,
    );
    assert.equal(
      left.owners.bottomLeft,
      "rail",
      `the window's bottom-left corner is not the rail's after the swap (${left.owners.bottomLeft})`,
    );

    // The tracks themselves, not just the boxes they produce.
    const leftTracks = (left.shell?.gridTemplateColumns ?? "").split(" ");
    const rightTracks = (right.shell?.gridTemplateColumns ?? "").split(" ");
    assert.equal(leftTracks.length, 3, `the shell is not a three-track grid: ${left.shell?.gridTemplateColumns}`);
    assert.equal(
      parseFloat(leftTracks[1]),
      chatTrack,
      `the swapped shell's second track is not the dock's column: ${leftTracks[1]}`,
    );
    assert.equal(
      parseFloat(rightTracks[2]),
      chatTrack,
      `the shipped shell's last track is not the dock's column: ${rightTracks[2]}`,
    );
    assert.equal(
      leftTracks[0],
      rightTracks[0],
      `the rail's track changed with the swap: ${leftTracks[0]} vs ${rightTracks[0]}`,
    );

    // And the control has turned around with it.
    assert.equal(
      left.sideSwitch.label,
      "Move chat to the right of the page",
      `the switch names the wrong move after the swap: ${left.sideSwitch.label}`,
    );
    assert.equal(
      left.sideSwitch.pressed,
      "true",
      "the switch does not report the swapped shell",
    );
    assert.equal(
      left.collapseAction?.icon,
      "lucide-panel-left-close",
      `the bottom-bar collapse arrow does not follow the dock to the left (${left.collapseAction?.icon})`,
    );
    assert.deepEqual(
      left.actions?.controls.map((control) => control.label),
      ["New chat", "Life-Chain", "Move chat to the right of the page", "Collapse chat"],
      `the swapped bar's actions are not in their shipped order: ${JSON.stringify(left.actions?.controls)}`,
    );

    // —— The compositions: the dock collapsed with the rail expanded, then the
    // rail collapsed to its icon column under the dock. ——
    assert.equal(
      dockCollapsed.chat,
      null,
      "the collapsed dock is still a pane: the vertical strip should be gone",
    );
    assert.equal(
      parseFloat((dockCollapsed.shell?.gridTemplateColumns.split(" ")[1] ?? "NaN")),
      0,
      `the collapsed shell still reserves a dock column (${dockCollapsed.shell?.gridTemplateColumns})`,
    );
    assert.equal(
      dockCollapsed.main?.box.left,
      track,
      `the collapsed sheet left the rail's trailing edge (${dockCollapsed.main?.box.left}px vs ${track}px)`,
    );
    assert.equal(
      dockCollapsed.main?.box.right,
      dockCollapsed.viewport.width,
      "the collapsed dock pushed the sheet off the window's trailing edge",
    );
    assert.equal(
      isZero(dockCollapsed.main?.border.left) && isZero(dockCollapsed.main?.border.right),
      true,
      `the collapsed sheet still draws a seam to a dock that is gone (${dockCollapsed.main?.border.left}/${dockCollapsed.main?.border.right})`,
    );
    assert.equal(
      dockCollapsed.launcher?.position,
      "fixed",
      "the collapsed dock did not become a floating mark",
    );
    assert.equal(
      dockCollapsed.launcher?.label,
      "Open Hermes chat",
      `the floating mark names the wrong move: ${dockCollapsed.launcher?.label}`,
    );
    assert.equal(
      dockCollapsed.launcher?.mark && String(dockCollapsed.launcher?.markMask).includes("girl_steampunk"),
      true,
      `the floating mark is not the Nous girl (${dockCollapsed.launcher?.mark}, ${dockCollapsed.launcher?.markMask})`,
    );
    assert.equal(
      dockCollapsed.launcher?.color,
      "rgb(0, 0, 0)",
      `the night mark is not black on the orange button (${dockCollapsed.launcher?.color})`,
    );
    assert.equal(
      dockCollapsed.launcher?.box.left !== undefined &&
        dockCollapsed.launcher.box.left < dockCollapsed.viewport.width / 2 &&
        dockCollapsed.launcher.box.top > dockCollapsed.viewport.height / 2,
      true,
      `the floating mark did not follow the dock to the bottom-left half: ${JSON.stringify(dockCollapsed.launcher?.box)}`,
    );
    assert.equal(
      dockCollapsed.launcher?.box.left,
      track + rootFontSize,
      `the floating mark is not beside the rail's trailing edge (${dockCollapsed.launcher?.box.left}px vs ${track}px + ${rootFontSize}px)`,
    );
    assert.equal(
      dockCollapsed.viewport.height - (dockCollapsed.launcher?.box.bottom ?? 0),
      frame + rootFontSize,
      `the floating mark lost its bottom inset (${dockCollapsed.launcher?.box.bottom}px of ${dockCollapsed.viewport.height}px)`,
    );
    // Collapsed, the dock renders only its launcher: the bar — and with it the
    // switch and the collapse control — is not on screen, so the swap is not
    // reachable from here and the mark is the only way back in.
    assert.equal(
      dockCollapsed.sideSwitch?.found,
      false,
      "the side switch is still reachable while the dock is collapsed",
    );
    assert.equal(
      dockCollapsed.collapseAction,
      null,
      "the collapse control is still on screen while the dock is collapsed",
    );
    assert.equal(
      dockCollapsed.actions,
      null,
      "the dock's bottom action bar is still on screen while the dock is collapsed",
    );
    assert.notEqual(
      dockCollapsed.launcher?.background,
      dockCollapsed.accentBackground,
      "the night launcher still wears the full accent at rest",
    );
    assert.equal(
      dockCollapsedHover.launcher?.background,
      dockCollapsed.accentBackground,
      `the night hover is not the accent the button used to wear (${dockCollapsedHover.launcher?.background} vs ${dockCollapsed.accentBackground})`,
    );
    assert.equal(
      dockCollapsedLight.launcher?.color,
      "rgb(51, 51, 51)",
      `the day mark is not the dark gray the paper field needs (${dockCollapsedLight.launcher?.color})`,
    );
    assert.notEqual(
      dockCollapsedLight.launcher?.color,
      dockCollapsed.launcher?.color,
      "the launcher ink did not follow the theme",
    );
    assert.equal(
      dockCollapsedLight.launcher?.background,
      dockCollapsedLight.paperBackground,
      `the day launcher is not on the paper fill (${dockCollapsedLight.launcher?.background} vs ${dockCollapsedLight.paperBackground})`,
    );
    assert.notEqual(
      dockCollapsedLight.launcher?.background,
      dockCollapsedLight.accentBackground,
      "the day launcher is still flooded with the standout colour",
    );
    assert.equal(
      dockCollapsedLight.launcher?.borderColor,
      dockCollapsedLight.accentBackground,
      `the day launcher has no accent outline (${dockCollapsedLight.launcher?.borderColor} vs ${dockCollapsedLight.accentBackground})`,
    );
    assert.equal(
      parseFloat(dockCollapsedLight.launcher?.borderWidth ?? "0") >= 1,
      true,
      `the day launcher's outline is not visible (${dockCollapsedLight.launcher?.borderWidth})`,
    );
    assert.equal(
      dockCollapsedDarkAgain.launcher?.background,
      dockCollapsed.launcher?.background,
      "returning to the night theme did not restore the lowered fill",
    );
    assert.equal(
      dockCollapsedDarkAgain.launcher?.color,
      dockCollapsed.launcher?.color,
      "returning to the night theme did not restore the black mark",
    );
    assert.deepEqual(
      report.dockReopened.main.box,
      left.main.box,
      "reopening the dock did not restore the swapped sheet",
    );
    assert.equal(
      report.dockReopened.launcher,
      null,
      "the floating mark survived the dock opening",
    );
    // —— The rail's collapsed state: it stays in the layout as a thin icon
    // column, so the dock keeps starting at its trailing edge instead of taking
    // the window's own leading edge. The claimed 56px is the rail's own track,
    // not the sheet's, and the dock follows it. ——
    assert.equal(
      Boolean(railCollapsed.rail) && railCollapsed.rail.display !== "none",
      true,
      `the rail left the layout instead of shrinking to its icon column (${JSON.stringify(railCollapsed.rail)})`,
    );
    assert.equal(
      railCollapsed.rail?.box.width,
      collapsedTrack,
      `the collapsed rail is not the collapsed track (${railCollapsed.rail?.box.width}px vs ${collapsedTrack}px)`,
    );
    assert.equal(
      railCollapsed.shell?.className.includes("shell--nav-collapsed"),
      true,
      `the collapsed shell does not wear the collapsed-rail class: ${railCollapsed.shell?.className}`,
    );
    assert.equal(
      railCollapsed.chat.box.left,
      railCollapsed.rail?.box.right,
      "the dock did not start at the collapsed rail's trailing edge",
    );
    assert.equal(
      railCollapsed.chat.box.left,
      collapsedTrack,
      `the dock starts at ${railCollapsed.chat.box.left}px instead of the collapsed track (${collapsedTrack}px)`,
    );
    assert.equal(
      railCollapsed.chat.box.right,
      railCollapsed.main.box.left,
      "the dock and the sheet stopped abutting under a collapsed rail",
    );
    assert.equal(
      railCollapsed.chat.box.width,
      chatTrack,
      `the dock lost its chat column under a collapsed rail (${railCollapsed.chat.box.width}px vs ${chatTrack}px)`,
    );
    assert.equal(
      railCollapsed.main.box.right,
      railCollapsed.viewport.width,
      "with the rail and the dock swapped the sheet left the window's trailing edge",
    );

    // —— Both collapsed: the mark follows the dock's column, which now starts at
    // the collapsed rail's trailing edge. The rail's width is still in the sum —
    // at 56px rather than 256px — so the mark sits one rem inside the rail. ——
    assert.ok(
      railAndDockCollapsed.launcher,
      "collapsing the dock under a collapsed rail left no floating mark",
    );
    assert.equal(
      railAndDockCollapsed.launcher.box.left,
      collapsedTrack + rootFontSize,
      `the floating mark is not beside the collapsed rail's trailing edge (${railAndDockCollapsed.launcher.box.left}px vs ${collapsedTrack}px + ${rootFontSize}px)`,
    );
    assert.equal(
      railAndDockCollapsed.launcher.box.left,
      (railAndDockCollapsed.rail?.box.right ?? NaN) + rootFontSize,
      `the floating mark is not measured from the rail it still has (${railAndDockCollapsed.launcher.box.left}px vs rail right ${railAndDockCollapsed.rail?.box.right}px + ${rootFontSize}px)`,
    );
    assert.equal(
      railAndDockCollapsed.viewport.height - railAndDockCollapsed.launcher.box.bottom,
      frame + rootFontSize,
      `the floating mark lost its bottom inset with the rail collapsed (${railAndDockCollapsed.launcher.box.bottom}px of ${railAndDockCollapsed.viewport.height}px)`,
    );
    assert.deepEqual(
      report.dockBackUnderCollapsedRail.chat.box,
      railCollapsed.chat.box,
      "reopening the dock under a collapsed rail did not restore the rail-adjacent geometry",
    );
    assert.equal(
      report.dockBackUnderCollapsedRail.launcher,
      null,
      "the floating mark survived the reopen under a collapsed rail",
    );
    // —— The rail comes back through the control that collapsed it: the toggle
    // stayed in the rail, so expanding is the same button, and the expanded
    // arrangement — rail 256, dock at its trailing edge — has to return. ——
    assert.equal(
      report.railRestored.shell?.className.includes("shell--nav-collapsed"),
      false,
      `the restored shell still wears the collapsed-rail class: ${report.railRestored.shell?.className}`,
    );
    assert.equal(
      report.railRestored.rail?.box.width,
      track,
      `restoring the rail did not give it the expanded track (${report.railRestored.rail?.box.width}px vs ${track}px)`,
    );
    assert.deepEqual(
      report.railRestored.rail?.box,
      left.rail?.box,
      "restoring the rail did not restore the rail's box",
    );
    assert.deepEqual(
      report.railRestored.main.box,
      left.main.box,
      "restoring the rail did not restore the swapped sheet",
    );
    assert.deepEqual(
      report.railRestored.chat.box,
      left.chat.box,
      "restoring the rail did not restore the dock beside it",
    );

    // —— The round trip: the same click again, and nothing moved. ——
    assert.deepEqual(restored.rail?.box, right.rail?.box, "the rail did not come back");
    assert.deepEqual(restored.main?.box, right.main?.box, "the sheet did not come back");
    assert.deepEqual(restored.chat?.box, right.chat?.box, "the dock did not come back");
    assert.deepEqual(
      restored.sideSwitch.box,
      right.sideSwitch.box,
      "the switch moved between the two runs",
    );
    assert.equal(
      restored.shell?.gridTemplateColumns,
      right.shell?.gridTemplateColumns,
      `the track list did not come back: ${restored.shell?.gridTemplateColumns} vs ${right.shell?.gridTemplateColumns}`,
    );
    assert.deepEqual(
      restored.owners,
      right.owners,
      "the panes are not painted where they started",
    );
    assert.equal(
      restored.collapseAction?.icon,
      right.collapseAction?.icon,
      "the collapse arrow did not come back",
    );

    // —— The dock's own way out, in the bottom bar's trailing corner. ——
    const bar = restored.actions?.box;
    const collapseBox = restored.collapseAction?.box;
    assert.equal(
      restored.collapseAction?.label,
      "Collapse chat",
      `the bottom bar's collapse control names the wrong move (${restored.collapseAction?.label})`,
    );
    assert.equal(
      restored.collapseAction?.icon,
      "lucide-panel-right-close",
      `the bottom bar's collapse arrow does not point at the trailing dock (${restored.collapseAction?.icon})`,
    );
    assert.deepEqual(
      restored.actions?.controls.map((control) => control.label),
      ["New chat", "Life-Chain", "Move chat to the left of the page", "Collapse chat"],
      `the bottom bar still carries an unassigned action: ${JSON.stringify(restored.actions?.controls)}`,
    );
    assert.ok(bar && collapseBox, "the bottom bar or its collapse control was not found");
    // The build number moved into this bar, to the right of the collapse control:
    // the version badge, not the collapse control, holds the window's bottom-right
    // end now.
    const badgeBox = restored.actions?.badge?.box;
    assert.ok(badgeBox, "the bottom bar carries no version badge");
    assert.match(
      restored.actions?.badge?.text ?? "",
      /^v\d+\.\d+\.\d+/,
      `the badge does not show the build number (${restored.actions?.badge?.text})`,
    );
    assert.equal(
      badgeBox.left > collapseBox.right &&
        badgeBox.right <= bar.right &&
        bar.right - badgeBox.right <= 10 &&
        badgeBox.top >= bar.top &&
        badgeBox.bottom <= bar.bottom,
      true,
      `the version badge does not hold the bar's trailing end (${JSON.stringify(badgeBox)} in ${JSON.stringify(bar)}, collapse ends at ${collapseBox.right}px)`,
    );
    assert.equal(
      collapseBox.left > bar.left + bar.width / 2 &&
        collapseBox.right <= badgeBox.left &&
        badgeBox.left - collapseBox.right <= 12 &&
        collapseBox.top >= bar.top &&
        collapseBox.bottom <= bar.bottom,
      true,
      `the collapse control does not sit just left of the badge (${JSON.stringify(collapseBox)} vs ${JSON.stringify(badgeBox)} in ${JSON.stringify(bar)})`,
    );
    assert.equal(
      barCollapsed.chat,
      null,
      "the bottom bar's collapse left the dock in the grid",
    );
    assert.ok(barCollapsed.launcher, "the bottom bar's collapse did not return the floating mark");
    assert.equal(
      barCollapsed.launcher.position,
      "fixed",
      "the returned mark is not floating",
    );
    assert.equal(
      barCollapsed.main?.box.right,
      barCollapsed.viewport.width,
      "the bottom bar's collapse did not give the sheet the window's trailing edge",
    );
    assert.equal(
      barCollapsed.launcher.box.left > barCollapsed.viewport.width / 2 &&
        barCollapsed.launcher.box.top > barCollapsed.viewport.height / 2,
      true,
      `a trailing dock's mark left the bottom-right half: ${JSON.stringify(barCollapsed.launcher.box)}`,
    );
    assert.equal(
      barCollapsed.viewport.width - barCollapsed.launcher.box.right,
      frame + rootFontSize,
      `a trailing dock's mark lost its trailing inset (${barCollapsed.launcher.box.right}px of ${barCollapsed.viewport.width}px)`,
    );

    // —— The reported gesture: the switch lives in the dock's bar, so the swap is
    // driven from the open dock — open, swap, collapse — and the mark has to
    // follow the side it was swapped to and come back the same way. Collapsed,
    // the bar is not rendered at all, which is why the swap cannot be attempted
    // from there. ——
    assert.equal(
      collapsedSwapOpen.shell?.className.includes("shell--chat-left"),
      true,
      `reopening then swapping did not put the dock on the leading side: ${collapsedSwapOpen.shell?.className}`,
    );
    assert.equal(
      collapsedSwapOpen.sideSwitch?.label,
      "Move chat to the right of the page",
      `the switch did not turn around with the open dock (${collapsedSwapOpen.sideSwitch?.label})`,
    );
    assert.equal(
      collapsedSwapped.chat,
      null,
      "collapsing the swapped dock left it in the grid",
    );
    assert.equal(
      collapsedSwapped.sideSwitch?.found,
      false,
      "the side switch is still reachable with the dock collapsed",
    );
    assert.equal(
      collapsedSwapped.shell?.className.includes("shell--chat-left"),
      true,
      `the collapsed swap did not put the dock on the leading side: ${collapsedSwapped.shell?.className}`,
    );
    assert.equal(
      collapsedSwapped.launcher?.box.left,
      track + rootFontSize,
      `the mark stayed on the trailing corner through a collapsed swap (${collapsedSwapped.launcher?.box.left}px vs ${track}px + ${rootFontSize}px)`,
    );
    assert.equal(
      (collapsedSwapped.launcher?.box.left ?? Infinity) <
        collapsedSwapped.viewport.width / 2 &&
        (collapsedSwapped.launcher?.box.top ?? 0) >
          collapsedSwapped.viewport.height / 2,
      true,
      `the mark is not in the bottom-left half after the collapsed swap: ${JSON.stringify(collapsedSwapped.launcher?.box)}`,
    );
    assert.equal(
      collapsedSwapBackOpen.shell?.className.includes("shell--chat-right"),
      true,
      `reopening then swapping back did not return the dock to the trailing side: ${collapsedSwapBackOpen.shell?.className}`,
    );
    assert.deepEqual(
      collapsedSwappedBack.launcher?.box,
      barCollapsed.launcher.box,
      `swapping back did not return the mark to the trailing corner (${JSON.stringify(collapsedSwappedBack.launcher?.box)} vs ${JSON.stringify(barCollapsed.launcher.box)})`,
    );
    assert.equal(
      collapsedSwappedBack.chat,
      null,
      "collapsing the dock again after swapping back reopened it",
    );
    assert.deepEqual(
      barReopened.main.box,
      restored.main.box,
      "the floating mark did not restore the sheet the bottom bar collapsed",
    );
    assert.deepEqual(
      barReopened.chat?.box,
      restored.chat?.box,
      "the floating mark did not restore the dock the bottom bar collapsed",
    );
    assert.equal(
      barReopened.launcher,
      null,
      "the floating mark survived the second reopen",
    );

    // Nothing spills sideways in either arrangement.
    for (const [name, state] of [
      ["right", right],
      ["left", left],
      ["round trip", restored],
    ] as const) {
      assert.ok(
        state.overflow.scrollWidth <= state.viewport.width &&
          state.overflow.clientWidth <= state.viewport.width,
        `${name}: the layout opened a horizontal scrollbar (${state.overflow.scrollWidth}px vs ${state.viewport.width}px)`,
      );
    }

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
