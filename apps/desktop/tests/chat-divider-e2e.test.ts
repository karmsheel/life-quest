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

/**
 * The server the rig will actually load the harness page from, which is not
 * always 5173: a checkout running beside the operator's own dev server has to be
 * told which one is its own, and a gate that watched 5173 while the rig loaded
 * 5174 would wave through a run against somebody else's build.
 */
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const DEV_HOST = new URL(DEV_SERVER).hostname;
const DEV_PORT = Number(new URL(DEV_SERVER).port || 80);
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-divider.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Borders = { top: string; right: string; bottom: string; left: string };

type State = {
  viewport: { width: number; height: number };
  doc: { scrollWidth: number; clientWidth: number };
  tokens: {
    rootChatbarWidth: string;
    frame: number;
    navWidth: number;
    rootFontSize: number;
  };
  shell: {
    box: Box;
    className: string;
    clientWidth: number;
    inlineChatbarWidth: string | null;
    chatMin: number;
    chatMax: number;
    chatColumn: string;
    tracks: number[];
    dragging: boolean;
  };
  rail: { box: Box; display: string } | null;
  chats: { box: Box } | null;
  main: { box: Box; border: Borders; radiusTopLeft: string } | null;
  dock: { box: Box; border: Borders; className: string } | null;
  launcher: {
    box: Box;
    label: string | null;
    position: string;
    mark: boolean;
  } | null;
  divider: {
    found: boolean;
    box?: Box;
    side?: string;
    role?: string;
    orientation?: string;
    label?: string;
    valueNow?: number;
    valueMin?: number;
    valueMax?: number;
    dragging?: boolean;
    border?: Borders;
    background?: string;
    cursor?: string;
    focused?: boolean;
    hovered?: boolean;
    bar?: { left: number; width: number; opacity: number };
  };
  seam: number;
  dockTrack: number;
  owners: {
    handleCentre: string;
    handleLeadingPixel: string;
    sheetInner: string;
    dockInner: string;
  };
  announce: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  url: string;
  vaultName: string;
  tokens: State["tokens"];
  shipped: State;
  hover: State;
  narrower: { from: number; to: number; travelled: number };
  afterNarrower: State;
  floor: State;
  ceiling: State;
  eased: State;
  swapped: State;
  swapDrag: { travelled: number };
  swapWider: State;
  swapCeiling: State;
  swapFloor: State;
  collapsed: State;
  reopened: State;
  keyWider: State;
  keyBack: State;
  keyFloor: State;
  midDrag: State;
  cancelled: State;
  restored: State;
  keyTrailing: State;
  screenshots: string[];
};

const isHairline = (value: string | undefined) => {
  const width = parseFloat(value ?? "0");
  return Number.isFinite(width) && width > 0 && width <= 1;
};
const isZero = (value: string | undefined) => parseFloat(value ?? "0") === 0;

/**
 * The range the divider must be held to, restated here from the report's own
 * measurements rather than read back off the app.
 *
 * This is DeepSeek Harness's contract for its own side panel: a 300px floor, a
 * ceiling at 70% of the frame, and a 400px centre column that the panel may not
 * squeeze. The driver checks the *gesture* against whatever range the app
 * declares; the suite checks the declared range against this.
 */
function expectedRange(state: State) {
  const viewport = state.shell.clientWidth;
  // The leading chrome is two panes now: the rail and the chats list beside it.
  // Both come out of the frame before the page's 400px floor is applied.
  const nav =
    (state.rail ? state.rail.box.width : 0) +
    (state.chats ? state.chats.box.width : 0);
  return {
    min: 300,
    max: Math.max(
      300,
      Math.min(Math.round(viewport * 0.7), Math.round(viewport - nav - 400)),
    ),
    viewport,
    nav,
  };
}

/**
 * The one arrangement statement, read in both directions off the report's own
 * numbers: the panes abut, the seam is the sheet's edge facing the dock, the
 * handle straddles it and owns its own strip, and nothing spills sideways.
 */
function assertArrangement(label: string, state: State, side: "left" | "right") {
  const seam = side === "left" ? state.main!.box.left : state.main!.box.right;
  assert.equal(state.seam, seam, `${label}: the seam is not the panes' shared edge`);
  assert.equal(
    side === "left" ? state.dock!.box.right : state.main!.box.right,
    side === "left" ? state.main!.box.left : state.dock!.box.left,
    `${label}: the panes do not abut`,
  );
  assert.equal(
    (side === "left" ? state.main!.box.right : state.dock!.box.right),
    state.viewport.width,
    `${label}: the trailing pane does not reach the window's trailing edge`,
  );
  assert.equal(
    isHairline(side === "left" ? state.main!.border.left : state.main!.border.right),
    true,
    `${label}: the sheet lost the hairline on the seam`,
  );
  assert.equal(
    isZero(side === "left" ? state.main!.border.right : state.main!.border.left) &&
      isZero(state.main!.border.top) &&
      isZero(state.main!.border.bottom) &&
      isZero(state.dock!.border.top) &&
      isZero(state.dock!.border.right) &&
      isZero(state.dock!.border.bottom) &&
      isZero(state.dock!.border.left),
    true,
    `${label}: the panes grew a second line`,
  );
  assert.equal(state.divider.found, true, `${label}: there is no handle on the seam`);
  assert.equal(state.divider.side, side, `${label}: the handle does not know its side`);
  assert.equal(state.divider.role, "separator", `${label}: the handle is not a separator`);
  assert.equal(state.divider.orientation, "vertical", `${label}: the handle is not vertical`);
  assert.equal(
    state.divider.box!.left,
    seam - 2,
    `${label}: the handle is not straddling the seam (${JSON.stringify(state.divider.box)} around ${seam}px)`,
  );
  assert.equal(
    state.divider.bar!.width === 2 && state.divider.bar!.left === 1,
    true,
    `${label}: the handle's bar is not the two pixels on the seam`,
  );
  assert.equal(
    isZero(state.divider.border!.top) &&
      isZero(state.divider.border!.right) &&
      isZero(state.divider.border!.bottom) &&
      isZero(state.divider.border!.left) &&
      state.divider.background === "rgba(0, 0, 0, 0)",
    true,
    `${label}: the handle paints a line or a fill of its own`,
  );
  assert.equal(
    state.owners.handleCentre === "divider" && state.owners.handleLeadingPixel === "divider",
    true,
    `${label}: the handle is not the thing on its own strip (${state.owners.handleCentre})`,
  );
  assert.equal(
    state.owners.sheetInner === "sheet" && state.owners.dockInner === "dock",
    true,
    `${label}: a pane is not painted where its box says (${state.owners.sheetInner}/${state.owners.dockInner})`,
  );
  assert.ok(
    state.main!.box.width >= 400,
    `${label}: the page was squeezed to ${state.main!.box.width}px`,
  );
  assert.ok(
    state.doc.scrollWidth <= state.viewport.width &&
      state.doc.clientWidth <= state.viewport.width,
    `${label}: the layout opened a horizontal scrollbar`,
  );
}

/**
 * The dock's column at each end of the range, and the arithmatic that ties the
 * column to the box it is drawn in.
 */
function assertTrack(label: string, state: State, side: "left" | "right") {
  const frame = state.tokens.frame;
  assert.equal(
    state.dock!.box.width,
    side === "left" ? state.dockTrack : state.dockTrack + frame,
    `${label}: the dock's box is not its column${side === "left" ? "" : " plus the frame's slack"} (${state.dock!.box.width}px vs ${state.dockTrack}px)`,
  );
  assert.equal(
    state.divider.valueNow,
    state.dockTrack,
    `${label}: the handle reports a different column than the grid drew`,
  );
  assert.equal(
    state.divider.valueMin,
    state.shell.chatMin,
    `${label}: the handle's minimum is not the shell's`,
  );
  assert.equal(
    state.divider.valueMax,
    state.shell.chatMax,
    `${label}: the handle's maximum is not the shell's`,
  );
  assert.ok(
    state.dockTrack >= state.shell.chatMin && state.dockTrack <= state.shell.chatMax,
    `${label}: the column left the range`,
  );
}

/**
 * The divider between the page and the dock, in a real Electron window.
 *
 * This is the whole claim: a seam the operator can drag, held to the frame's
 * range rather than to the pointer's reach, on whichever side the dock is
 * standing, with the width the operator chose surviving the swap and the
 * collapse. The gestures are the browser's own input, and the artifact is
 * `e2e/artifacts/chat-divider.{json,png}` — same command, same geometry.
 *
 * It needs the Vite dev server (the harness page). With it down the test skips
 * and says which; `npm run dev` brings it up.
 */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, DEV_HOST);
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
    const env = { ...process.env };
    // Without this the spawned Electron runs as plain Node and no window opens.
    delete env.ELECTRON_RUN_AS_NODE;
    // The rig loads the harness off the same server this suite gates on, so one
    // variable points both at the checkout under test.
    env.LIFEQUEST_E2E_URL ??= `${DEV_SERVER}/e2e/chat-divider.html`;
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/chat-divider.electron.mjs")],
      { cwd: desktopRoot, timeout: 150_000, env },
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

describe("chat dock divider", () => {
  it("drags the seam between the page and the dock, within the frame's range, on either side", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_SERVER} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the driver exited non-zero");

    const {
      shipped,
      hover,
      afterNarrower,
      floor,
      ceiling,
      eased,
      swapped,
      swapWider,
      swapCeiling,
      swapFloor,
      collapsed,
      reopened,
      keyWider,
      keyBack,
      keyFloor,
      midDrag,
      cancelled,
      restored,
      keyTrailing,
    } = report;

    // ── the instrument: a handle, on the seam, and the range it is held to ──
    assertArrangement("shipped", shipped, "right");
    assert.equal(shipped.shell.className.includes("shell--chat-right"), true);
    assert.equal(
      shipped.shell.inlineChatbarWidth,
      null,
      "the width was set before anybody dragged it",
    );
    assert.equal(shipped.divider.label, "Resize the chat dock");
    assert.equal(
      shipped.divider.bar!.opacity,
      0,
      "the handle's bar is drawn at rest",
    );

    // The hover is the offer, not a light show: the resize cursor says the seam
    // moves, and the accent bar stays out of the way until the hand is on it.
    assertArrangement("hover", hover, "right");
    assert.equal(
      hover.divider.hovered,
      true,
      "the pointer never landed on the handle, so the hover claim proves nothing",
    );
    assert.equal(
      hover.divider.cursor,
      "col-resize",
      "the handle does not offer the column-resize cursor on hover",
    );
    assert.equal(
      hover.divider.bar!.opacity,
      0,
      "the handle's bar glows on hover",
    );

    // The contract itself, recomputed from the frame the report measured.
    const range = expectedRange(shipped);
    assert.equal(range.min, 300, "the dock's floor is not 300px");
    assert.equal(
      shipped.shell.chatMin,
      range.min,
      `the shell's floor is ${shipped.shell.chatMin}px, not the contract's ${range.min}px`,
    );
    assert.equal(
      shipped.shell.chatMax,
      range.max,
      `the shell's ceiling is ${shipped.shell.chatMax}px, not the contract's ${range.max}px (frame ${range.viewport}px, chrome ${range.nav}px)`,
    );
    assert.ok(
      shipped.dockTrack > shipped.shell.chatMin &&
        shipped.dockTrack < shipped.shell.chatMax,
      "the shipped dock does not start strictly inside the range, so the drags below cannot tell a bound from a start",
    );

    // ── the drag: the seam is 1:1 with the hand, and the right way round ────
    assertArrangement("narrower", afterNarrower, "right");
    assertTrack("narrower", afterNarrower, "right");
    assert.equal(
      afterNarrower.seam - shipped.seam,
      report.narrower.travelled,
      "the seam did not track the pointer one for one",
    );
    assert.equal(
      afterNarrower.dockTrack,
      shipped.dockTrack - report.narrower.travelled,
      "dragging the trailing dock towards the page did not narrow it",
    );
    assert.equal(
      afterNarrower.main!.box.width,
      shipped.main!.box.width + report.narrower.travelled,
      "the page did not take the room the dock gave up",
    );
    assert.equal(
      afterNarrower.shell.inlineChatbarWidth,
      `${afterNarrower.dockTrack}px`,
      "the committed width is not the one on the shell",
    );
    assert.equal(
      afterNarrower.announce,
      `Chat dock ${afterNarrower.dockTrack} pixels wide.`,
      "the gesture did not say what it did",
    );
    assert.equal(
      afterNarrower.shell.dragging === false && afterNarrower.divider.dragging === false,
      true,
      "the drag state outlived the pointer",
    );

    // ── the two bounds, and the page's own floor ───────────────────────────
    assertArrangement("floor", floor, "right");
    assertTrack("floor", floor, "right");
    assert.equal(floor.dockTrack, floor.shell.chatMin, "the drag went under the floor");
    assert.equal(floor.divider.valueMin, floor.shell.chatMin);
    assert.equal(
      floor.main!.box.width,
      range.viewport - range.nav - floor.dockTrack,
      "the sheet's width is not what the frame's tracks leave it",
    );

    assertArrangement("ceiling", ceiling, "right");
    assertTrack("ceiling", ceiling, "right");
    assert.equal(ceiling.dockTrack, ceiling.shell.chatMax, "the drag went over the ceiling");
    assert.equal(ceiling.divider.valueMax, ceiling.shell.chatMax);
    assert.equal(
      ceiling.dockTrack <= Math.round(range.viewport * 0.7),
      true,
      `the dock took ${ceiling.dockTrack}px, more than 70% of the ${range.viewport}px frame`,
    );
    assert.equal(
      ceiling.main!.box.width,
      400,
      `the ceiling did not land the page exactly on its floor (${ceiling.main!.box.width}px)`,
    );

    // A drag away from a bound moves the column again: the range is a clamp, not
    // a wall the gesture dies against.
    assert.equal(
      ceiling.dockTrack - eased.dockTrack,
      160,
      "a drag away from the ceiling did not move the column",
    );

    // ── the swap: the width travels, the range does not change ─────────────
    assertArrangement("swapped", swapped, "left");
    assertTrack("swapped", swapped, "left");
    assert.equal(swapped.shell.className.includes("shell--chat-left"), true);
    assert.equal(swapped.dockTrack, eased.dockTrack, "the swap threw the width away");
    assert.equal(
      swapped.shell.chatMin === eased.shell.chatMin &&
        swapped.shell.chatMax === eased.shell.chatMax,
      true,
      "the range changed with the side",
    );
    assert.equal(
      swapped.dock!.box.left,
      swapped.chats?.box.right,
      "the swapped dock did not take the column beside the chats list",
    );
    assert.equal(
      swapped.dock!.box.width,
      swapped.dockTrack,
      "the swapped dock still carries the frame's slack",
    );
    assert.equal(
      swapped.main!.box.right,
      swapped.viewport.width,
      "the swapped sheet stopped short of the window",
    );

    // ── and the same gesture from the other side ───────────────────────────
    assertArrangement("swapped/wider", swapWider, "left");
    assertTrack("swapped/wider", swapWider, "left");
    assert.equal(
      swapWider.seam - swapped.seam,
      report.swapDrag.travelled,
      "the leading seam did not track the pointer one for one",
    );
    assert.equal(
      swapWider.dockTrack,
      swapped.dockTrack + report.swapDrag.travelled,
      "dragging the leading dock away from the page did not widen it",
    );
    assert.equal(
      swapWider.main!.box.width,
      swapped.main!.box.width - report.swapDrag.travelled,
      "the page did not give up the room the dock took",
    );
    assert.equal(swapCeiling.dockTrack, swapCeiling.shell.chatMax, "the leading dock passed the ceiling");
    assert.equal(swapFloor.dockTrack, swapFloor.shell.chatMin, "the leading dock passed the floor");

    // ── the collapse: the strip becomes one floating mark, and keeps the width ─
    assert.equal(
      collapsed.dock,
      null,
      "a collapsed dock is still a pane: the vertical strip should be gone",
    );
    assert.equal(
      collapsed.shell.chatColumn,
      "0px",
      `the collapsed shell still reserves a dock column (${collapsed.shell.chatColumn})`,
    );
    assert.equal(
      collapsed.divider.found,
      false,
      "a collapsed dock still offers a handle to drag",
    );
    assert.equal(collapsed.shell.inlineChatbarWidth, `${swapFloor.dockTrack}px`);
    assert.ok(collapsed.launcher, "the collapsed dock has no floating mark");
    assert.equal(
      collapsed.launcher.position,
      "fixed",
      `the collapsed mark is not floating (${collapsed.launcher.position})`,
    );
    assert.equal(
      collapsed.launcher.mark,
      true,
      "the floating mark has no agent logo",
    );
    assert.equal(
      collapsed.launcher.label,
      "Open Hermes chat",
      `the floating mark names the wrong move (${collapsed.launcher.label})`,
    );
    assert.equal(
      collapsed.launcher.box.left < collapsed.viewport.width / 2 &&
        collapsed.launcher.box.top > collapsed.viewport.height / 2,
      true,
      `the floating mark did not follow the swapped dock to the bottom-left half (${JSON.stringify(collapsed.launcher.box)})`,
    );
    assert.equal(
      collapsed.launcher.box.left,
      collapsed.tokens.navWidth + collapsed.tokens.rootFontSize,
      `the floating mark is not beside the rail the swapped dock led against (${collapsed.launcher.box.left}px vs ${collapsed.tokens.navWidth}px + ${collapsed.tokens.rootFontSize}px)`,
    );
    assertArrangement("reopened", reopened, "left");
    assert.equal(
      reopened.dockTrack,
      swapFloor.dockTrack,
      "reopening the dock reset the width the operator chose",
    );
    assert.equal(
      swapped.tokens.rootChatbarWidth,
      report.tokens.rootChatbarWidth,
      "the drag rewrote a token",
    );
    assert.equal(
      restored.tokens.rootChatbarWidth,
      report.tokens.rootChatbarWidth,
      "a drag rewrote the token the shell's width is meant to fall back to",
    );

    // ── the keyboard: the divider moves where the arrow points ─────────────
    assertArrangement("keyboard/wider", keyWider, "left");
    assert.equal(
      keyWider.dockTrack,
      reopened.dockTrack + 16,
      "ArrowRight did not move the leading dock one step wider",
    );
    assert.equal(keyWider.divider.focused, true, "the handle lost focus to the key press");
    assert.equal(
      keyWider.shell.inlineChatbarWidth,
      `${keyWider.dockTrack}px`,
      "a key press was drawn but not committed",
    );
    assert.equal(
      keyWider.announce,
      `Chat dock ${keyWider.dockTrack} pixels wide.`,
      "the key press was not announced",
    );
    assert.equal(keyBack.dockTrack, reopened.dockTrack, "ArrowLeft did not move it back");
    assert.equal(
      keyFloor.dockTrack,
      keyFloor.shell.chatMin,
      "the keyboard walked the dock past its floor",
    );
    assert.equal(
      keyFloor.announce,
      "The chat dock is already as narrow as it goes.",
      "a key press at the floor did not say so",
    );

    // ── a cancelled gesture is not a width ─────────────────────────────────
    assert.equal(
      midDrag.dockTrack > keyFloor.dockTrack && midDrag.shell.dragging,
      true,
      "the pane did not move under the hand, so the cancel below proves nothing",
    );
    assert.equal(
      midDrag.divider.bar!.opacity === 1 && midDrag.divider.dragging === true,
      true,
      "the handle did not show itself while it was being held",
    );
    assertArrangement("cancelled", cancelled, "left");
    assert.equal(
      cancelled.dockTrack,
      keyFloor.dockTrack,
      "a cancelled drag left the pane at a width nobody chose",
    );
    assert.equal(
      cancelled.shell.inlineChatbarWidth,
      `${keyFloor.dockTrack}px`,
      "a cancelled drag left the shell drawn at the abandoned width",
    );
    assert.equal(
      cancelled.shell.dragging === false && cancelled.divider.dragging === false,
      true,
      "a cancelled drag left the tray mid-gesture",
    );
    assert.equal(cancelled.announce, "Width change cancelled.");

    // ── the round trip, and the arrow on the other side of the swap ────────
    assertArrangement("restored", restored, "right");
    assert.equal(restored.divider.side, "right", "the handle did not come back with the dock");
    assert.equal(restored.dockTrack, cancelled.dockTrack, "the round trip lost the width");
    assert.equal(restored.seam, restored.main!.box.right, "the seam moved off the sheet's edge");
    assertArrangement("keyboard/trailing", keyTrailing, "right");
    assert.equal(
      keyTrailing.dockTrack,
      restored.dockTrack + 16,
      "ArrowLeft is not the wider dock on the trailing side, which is the contract the arrows are stated as",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
