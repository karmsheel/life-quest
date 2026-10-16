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
    collapsedTrack: number;
    frame: number;
    titlebarHeight: number;
    radiusSm: string;
  };
  vaultText: string;
  vaultName?: string;
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
    expandIcon: string | null;
    heading: string;
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
  railCollapsed: Arrangement;
  dockReopened: Arrangement;
  railRestored: Arrangement;
  restored: Arrangement;
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
    const { right, left, dockCollapsed, railCollapsed, restored } = report;
    const { track, chatTrack, collapsedTrack, frame, titlebarHeight, radiusSm } =
      report.tokens;

    assert.ok(track > 0 && chatTrack > track && frame > 0, "tokens were not read");
    assert.ok(
      titlebarHeight > 0 && parseFloat(radiusSm) > 0,
      "the strip or the radius token was not read",
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

    // —— The compositions: a collapsed dock, a collapsed rail. ——
    assert.equal(
      dockCollapsed.chat.box.width,
      collapsedTrack,
      `the collapsed dock is not the narrow column (${dockCollapsed.chat.box.width}px vs ${collapsedTrack}px)`,
    );
    assert.equal(
      dockCollapsed.chat.box.right,
      dockCollapsed.main.box.left,
      "the collapsed dock opened a gap to the sheet",
    );
    assert.equal(
      dockCollapsed.main.box.right,
      dockCollapsed.viewport.width,
      "the collapsed dock pushed the sheet off the window's trailing edge",
    );
    assert.equal(
      dockCollapsed.chat.expandIcon,
      "lucide-panel-left-open",
      `the collapsed tab's arrow does not open toward the page (${dockCollapsed.chat.expandIcon})`,
    );
    assert.deepEqual(
      report.dockReopened.main.box,
      left.main.box,
      "reopening the dock did not restore the swapped sheet",
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
