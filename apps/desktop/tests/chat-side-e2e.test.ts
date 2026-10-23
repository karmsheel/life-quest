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
  chatToggle: { label: string | null; icon: string | null; box: Box } | null;
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
  railRestored: Arrangement;
  restored: Arrangement;
  barCollapsed: Arrangement;
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
      restored,
      barCollapsed,
      barReopened,
    } = report;
    const { track, chatTrack, frame, rootFontSize, titlebarHeight, radiusSm } =
      report.tokens;

    assert.ok(track > 0 && chatTrack > track && frame > 0, "tokens were not read");
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
    assert.equal(
      right.main?.radius.topLeft,
      radiusSm,
      `the sheet's leading top corner is not the system radius (${right.main?.radius.topLeft})`,
    );
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

    // The control itself: in the trailing cluster, beside the settings, wearing
    // the swap icon and naming the move it makes.
    assert.equal(right.sideSwitch.found, true, "no switch in the titlebar");
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
    const classes = (right.trailing?.controls ?? []).map((row) => row.className);
    const settingsAt = classes.findIndex((name) => name.includes("settings-menu"));
    const switchAt = classes.findIndex((name) => name.includes("side-switch"));
    assert.equal(
      switchAt,
      settingsAt + 1,
      `the switch is not beside the settings: ${JSON.stringify(classes)}`,
    );
    assert.equal(
      right.chatToggle?.icon,
      "lucide-panel-right-close",
      `the collapse arrow does not point at the right-hand dock (${right.chatToggle?.icon})`,
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
    assert.equal(
      left.main?.radius.topLeft,
      radiusSm,
      `the swapped sheet lost its leading top corner (${left.main?.radius.topLeft})`,
    );
    assert.equal(
      isZero(left.main?.radius.topRight) &&
        isZero(left.main?.radius.bottomRight) &&
        isZero(left.main?.radius.bottomLeft),
      true,
      `the swapped sheet rounded a corner on the window's own edge: tr/br/bl ${left.main?.radius.topRight}/${left.main?.radius.bottomRight}/${left.main?.radius.bottomLeft}`,
    );
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
      left.chatToggle?.icon,
      "lucide-panel-left-close",
      `the collapse arrow does not follow the dock to the left (${left.chatToggle?.icon})`,
    );
    assert.equal(
      left.collapseAction?.icon,
      "lucide-panel-left-close",
      `the bottom-bar collapse arrow does not follow the dock to the left (${left.collapseAction?.icon})`,
    );

    // —— The compositions: a collapsed dock, a collapsed rail. ——
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
      "rgb(51, 51, 51)",
      `the mark is not dark gray on the orange button (${dockCollapsed.launcher?.color})`,
    );
    assert.equal(
      dockCollapsed.launcher?.box.left !== undefined &&
        dockCollapsed.launcher.box.left > dockCollapsed.viewport.width / 2 &&
        dockCollapsed.launcher.box.top > dockCollapsed.viewport.height / 2,
      true,
      `the floating mark is not in the bottom-right half: ${JSON.stringify(dockCollapsed.launcher?.box)}`,
    );
    assert.equal(
      dockCollapsed.viewport.width - (dockCollapsed.launcher?.box.right ?? 0),
      frame + rootFontSize,
      `the floating mark lost its trailing inset (${dockCollapsed.launcher?.box.right}px of ${dockCollapsed.viewport.width}px)`,
    );
    assert.equal(
      dockCollapsed.viewport.height - (dockCollapsed.launcher?.box.bottom ?? 0),
      frame + rootFontSize,
      `the floating mark lost its bottom inset (${dockCollapsed.launcher?.box.bottom}px of ${dockCollapsed.viewport.height}px)`,
    );
    assert.equal(
      dockCollapsed.chatToggle?.label,
      "Expand chat",
      "the titlebar lost its second way back into the dock",
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
      dockCollapsed.launcher?.color,
      `the day mark changed ink instead of keeping the night gray (${dockCollapsedLight.launcher?.color} vs ${dockCollapsed.launcher?.color})`,
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
      "returning to the night theme did not restore the gray mark",
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
    assert.equal(
      railCollapsed.chat.box.left,
      0,
      "with the rail gone the dock did not take the window's leading edge",
    );
    assert.equal(
      railCollapsed.main.box.right,
      railCollapsed.viewport.width,
      "with the rail and the dock swapped the sheet left the window's trailing edge",
    );
    assert.deepEqual(
      report.railRestored.main.box,
      left.main.box,
      "restoring the rail did not restore the swapped sheet",
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
      restored.chatToggle?.icon,
      right.chatToggle?.icon,
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
      ["Chat history", "New chat", "Life-Chain", "Collapse chat"],
      `the bottom bar still carries an unassigned action: ${JSON.stringify(restored.actions?.controls)}`,
    );
    assert.ok(bar && collapseBox, "the bottom bar or its collapse control was not found");
    assert.equal(
      collapseBox.left > bar.left + bar.width / 2 &&
        collapseBox.right <= bar.right &&
        bar.right - collapseBox.right <= 10 &&
        collapseBox.top >= bar.top &&
        collapseBox.bottom <= bar.bottom,
      true,
      `the collapse control is not the bottom-right action (${JSON.stringify(collapseBox)} in ${JSON.stringify(bar)})`,
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
