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
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const REPORT = path.join(ARTIFACTS, "chat-focus.json");
const FOCUS_SHOT = path.join(ARTIFACTS, "chat-focus.png");
/** The contract's readable measure: 56rem at the bench's 16px root. */
const MEASURE = 56 * 16;

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Rect = { box: Box; display: string; visibility: string; visible: boolean };

type ControlState = {
  found: boolean;
  tag?: string;
  testid?: string | null;
  classes?: string;
  label?: string | null;
  title?: string | null;
  pressed?: string | null;
  icon?: string | null;
  box?: Box;
  display?: string;
  visibility?: string;
};

/** The window strip: the shipped three, and the duplicate that must not return. */
type StripState = {
  present: boolean;
  box: Box | null;
  childCount: number;
  classes: string[];
  testids: (string | null)[];
  /** Any `.chat-focus-toggle` inside `.window-titlebar__trailing`. */
  holdsChatFocus: boolean;
  /** `[data-testid="titlebar-main-page"]` anywhere in the document. */
  hasMainPageControl: boolean;
  /** Any aria-label/title still saying "…main page". */
  staleMainPageLabels: string[];
};

type MeasureState = {
  box: Box;
  display: string;
  visibility: string;
  maxWidth: string;
  width: string;
  marginLeft: string;
  marginRight: string;
} | null;

type FocusState = {
  viewport: { width: number; height: number };
  tokens: {
    track: number;
    collapsedTrack: number;
    frame: number;
    titlebarHeight: number;
    rootFontSize: number;
  };
  route: string | null;
  keys: {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    trusted: boolean;
  }[] | null;
  shell: {
    className: string;
    gridTemplateColumns: string;
    box: Box;
  } | null;
  rail: { box: Box; display: string } | null;
  main: { box: Box; display: string; visibility: string } | null;
  chat: {
    box: Box;
    display: string;
    visibility: string;
    className: string;
  } | null;
  launcher: { box: Box; position: string } | null;
  divider: { present: boolean; box: Box | null };
  dockControl: ControlState;
  strip: StripState;
  topRow: {
    className: string;
    isTabs: boolean;
    isHeader: boolean;
    box: Box;
    controlIsTrailing: boolean;
    trailingGap: number | null;
    lastTabBox: Box | null;
    plusBox: Box | null;
    plusInTrailingGroup: boolean;
    plusAfterLastTab: boolean;
    plusGap: number | null;
    afterPlus: boolean;
    children: { classes: string; box: Box; holdsControl: boolean }[];
  } | null;
  cluster: {
    tag: string;
    classes: string;
    testid: string | null;
    label: string | null;
    icon: string | null;
    box: Box;
  }[];
  content: {
    tabs: Rect | null;
    header: Rect | null;
    messages: Rect | null;
    composer: Rect | null;
    actions: Rect | null;
  };
  measure: { body: MeasureState; footer: MeasureState };
  owners: {
    mainArea: string | null;
    bottomRight: string | null;
    bottomLeft: string | null;
    trailingInner: string | null;
  };
  overflow: { scrollWidth: number; clientWidth: number };
  vaultName?: string;
};

type Scenario = { name: string; pass: boolean; failures: string[] };

type Report = {
  pass: boolean;
  failures: string[];
  vaultName: string;
  tokens: FocusState["tokens"];
  viewport: { width: number; height: number };
  initial: FocusState;
  focusedViaDock: FocusState;
  restoredAfterDock: FocusState;
  shortcutFocused: FocusState;
  shortcutRestored: FocusState;
  collapsedFromFocus: FocusState;
  focusFromCollapsed: FocusState;
  restoredFromCollapsed: FocusState;
  railCollapsedBase: FocusState;
  railCollapsedFocused: FocusState;
  railCollapsedRestored: FocusState;
  railRestored: FocusState;
  sideLeftBase: FocusState;
  sideLeftFocused: FocusState;
  sideLeftRestored: FocusState;
  finalRestored: FocusState;
  scenarios: Scenario[];
  screenshots: string[];
};

/**
 * The full-screen chat rig measures the real shell in a real Electron window, so
 * it needs the Vite dev server. With the server down the test skips; the
 * canonical `./bin/agent-cli e2e run` invocation starts one.
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
      [path.join(desktopRoot, "e2e/chat-focus.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
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

const isZero = (value: string | undefined) => parseFloat(value ?? "0") === 0;
const near = (a: number | undefined, b: number | undefined, tolerance = 1) =>
  typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tolerance;

function classesOf(state: FocusState): string {
  return String(state.shell?.className ?? "");
}

function shellBox(state: FocusState): Box | undefined {
  return state.shell?.box;
}

/** The window strip's three controls, and the duplicate that must not return. */
function assertStrip(label: string, state: FocusState) {
  const strip = state.strip;
  assert.ok(strip, `${label}: the window strip was not sampled`);
  assert.equal(
    strip.present,
    true,
    `${label}: the window strip draws no trailing cluster`,
  );
  const classes = strip.classes ?? [];
  assert.equal(
    strip.childCount,
    3,
    `${label}: the strip's trailing cluster is not the shipped three (${JSON.stringify(classes)})`,
  );
  assert.equal(
    classes.length,
    3,
    `${label}: the strip's trailing cluster is not the shipped three (${JSON.stringify(classes)})`,
  );
  assert.match(
    String(classes[0] ?? ""),
    /layouts-menu__trigger/,
    `${label}: the layouts control does not lead the strip's cluster (${classes[0]})`,
  );
  assert.match(
    String(classes[1] ?? ""),
    /theme-mode-toggle/,
    `${label}: the day/night control does not follow the layouts control (${classes[1]})`,
  );
  assert.match(
    String(classes[2] ?? ""),
    /settings-menu/,
    `${label}: the settings menu does not trail the strip's cluster (${classes[2]})`,
  );
  assert.equal(
    strip.holdsChatFocus,
    false,
    `${label}: the strip carries a full-screen control again (${JSON.stringify(strip.testids)})`,
  );
  assert.equal(
    strip.hasMainPageControl,
    false,
    `${label}: [data-testid="titlebar-main-page"] is back in the strip`,
  );
  assert.deepEqual(
    strip.staleMainPageLabels,
    [],
    `${label}: a Collapse/Restore main page label survives (${JSON.stringify(strip.staleMainPageLabels)})`,
  );
  const boxes = state.cluster ?? [];
  assert.equal(
    boxes.length,
    3,
    `${label}: the strip's three controls were not measured (${JSON.stringify(boxes)})`,
  );
  for (let index = 1; index < boxes.length; index += 1) {
    assert.ok(
      boxes[index - 1]!.box.right <= boxes[index]!.box.left,
      `${label}: trailing control ${index} is drawn before the one it follows (${JSON.stringify(
        boxes.map((entry) => entry.box),
      )})`,
    );
  }
}

/**
 * The mode's one door: the dock's top-row control. The strip is checked for the
 * duplicate that used to sit there.
 */
function assertDoors(label: string, state: FocusState, focused: boolean) {
  const expectedLabel = focused ? "Exit full screen chat" : "Full screen chat";
  const expectedIcon = focused ? "lucide-minimize-2" : "lucide-maximize-2";
  const expectedPressed = focused ? "true" : "false";

  const dock = state.dockControl;
  assert.equal(dock.found, true, `${label}: the dock's top row has no full-screen control`);
  assert.match(
    String(dock.classes ?? ""),
    /chat-focus-toggle/,
    `${label}: the dock control is not marked chat-focus-toggle (${dock.classes})`,
  );
  assert.equal(
    dock.label,
    expectedLabel,
    `${label}: the dock control names the wrong move (${dock.label})`,
  );
  assert.equal(
    dock.title,
    expectedLabel,
    `${label}: the dock control's title names the wrong move (${dock.title})`,
  );
  assert.equal(
    dock.pressed,
    expectedPressed,
    `${label}: the dock control's aria-pressed does not follow the mode (${dock.pressed})`,
  );
  assert.match(
    String(dock.icon ?? ""),
    new RegExp(expectedIcon),
    `${label}: the dock control wears the wrong icon (${dock.icon})`,
  );

  // The top row is the tab strip here (the harness seeds a pinned chat): the plus
  // follows the last tab in the strip's flow, and the full-screen control holds
  // the band's trailing corner after it.
  const topRow = state.topRow;
  assert.ok(topRow, `${label}: the dock has no top row`);
  assert.equal(
    topRow.isTabs,
    true,
    `${label}: the dock's top row is not the tab strip (${topRow.className})`,
  );
  assert.equal(
    topRow.controlIsTrailing,
    true,
    `${label}: the dock control is not the trailing item of the top row (${JSON.stringify(topRow.children)})`,
  );
  assert.ok(
    topRow.lastTabBox !== null && topRow.plusBox !== null,
    `${label}: the strip did not report a last tab and the plus (${JSON.stringify({ lastTab: topRow.lastTabBox, plus: topRow.plusBox })})`,
  );
  assert.equal(
    topRow.plusAfterLastTab,
    true,
    `${label}: the new-chat plus is not after the last tab (${JSON.stringify({ lastTab: topRow.lastTabBox, plus: topRow.plusBox })})`,
  );
  assert.ok(
    topRow.plusGap !== null && topRow.plusGap >= 0 && topRow.plusGap <= 12,
    `${label}: the new-chat plus is not immediately after the last tab (${topRow.plusGap}px)`,
  );
  assert.equal(
    topRow.plusInTrailingGroup,
    false,
    `${label}: the new-chat plus is parked in the strip's trailing corner again`,
  );
  assert.equal(
    topRow.afterPlus,
    true,
    `${label}: the dock control does not stand after the new-chat plus (${JSON.stringify({ plus: topRow.plusBox, control: state.dockControl.box })})`,
  );

  assertStrip(label, state);
}

/** The mode's layout, restated against the contract. */
function assertFocused(label: string, state: FocusState, base: FocusState) {
  const viewport = state.viewport;
  const rail = state.rail;
  const chat = state.chat;

  assert.match(
    classesOf(state),
    /shell--chat-focus/,
    `${label}: the shell does not wear shell--chat-focus (${classesOf(state)})`,
  );
  assert.match(
    classesOf(state),
    /shell--chat-open/,
    `${label}: the dock is not reported open in the mode (${classesOf(state)})`,
  );
  assert.doesNotMatch(
    classesOf(state),
    /shell--chat-collapsed/,
    `${label}: the dock is reported collapsed in the mode (${classesOf(state)})`,
  );

  assert.ok(rail, `${label}: the rail left the shell in the mode`);
  assert.equal(rail.box.left, 0, `${label}: the rail left the window's leading edge`);
  assert.equal(rail.box.top, 0, `${label}: the rail left the window's top edge`);
  assert.equal(
    rail.box.bottom,
    viewport.height,
    `${label}: the rail stopped short of the window bottom`,
  );
  assert.deepEqual(
    rail.box,
    base.rail?.box,
    `${label}: the rail did not keep its pre-mode box`,
  );

  const mainPainted =
    state.main !== null &&
    state.main.display !== "none" &&
    state.main.visibility !== "hidden" &&
    state.main.box.width > 0 &&
    state.main.box.height > 0;
  assert.equal(mainPainted, false, `${label}: the page is still painted (${JSON.stringify(state.main)})`);
  assert.equal(
    state.owners.mainArea,
    "dock",
    `${label}: the workspace beside the rail is not the dock (${state.owners.mainArea})`,
  );

  assert.ok(chat, `${label}: the dock is not on screen in the mode`);
  assert.equal(chat.display !== "none", true, `${label}: the dock is not painted`);
  assert.equal(chat.box.left, rail.box.right, `${label}: the dock does not start at the rail's trailing edge`);
  assert.equal(
    chat.box.right,
    viewport.width,
    `${label}: the dock stopped short of the window's trailing edge (${chat.box.right}px vs ${viewport.width}px)`,
  );
  assert.equal(
    chat.box.top,
    state.tokens.titlebarHeight,
    `${label}: the dock does not meet the window strip (${chat.box.top}px vs ${state.tokens.titlebarHeight}px)`,
  );
  assert.equal(
    chat.box.bottom,
    viewport.height,
    `${label}: the dock stopped short of the window bottom (${chat.box.bottom}px vs ${viewport.height}px)`,
  );
  assert.equal(
    chat.box.width,
    viewport.width - rail.box.width,
    `${label}: the dock does not fill the workspace right of the rail (${chat.box.width}px)`,
  );
  assert.equal(state.divider.present, false, `${label}: the divider is still drawn in the mode`);
  assert.equal(state.launcher, null, `${label}: the launcher is on screen in the mode`);

  // The dock's content is still drawn, and the full-width rows stay full width.
  for (const [name, rect] of Object.entries(state.content)) {
    assert.ok(rect, `${label}: the dock does not draw its ${name}`);
    assert.equal(rect.visible, true, `${label}: the dock's ${name} is not visible (${JSON.stringify(rect)})`);
  }
  for (const [name, rect] of [
    ["tab strip", state.content.tabs],
    ["header", state.content.header],
    ["bottom action bar", state.content.actions],
  ] as const) {
    assert.ok(rect, `${label}: the dock does not draw its ${name}`);
    assert.ok(
      near(rect.box.width, chat.box.width),
      `${label}: the ${name} is not full width (${rect.box.width}px vs ${chat.box.width}px)`,
    );
  }

  // The readable measure: width 100%, max-width 56rem, centred.
  for (const [name, measure] of [
    ["transcript", state.measure.body],
    ["composer band", state.measure.footer],
  ] as const) {
    assert.ok(measure, `${label}: the ${name} was not found in the mode`);
    assert.equal(
      measure.maxWidth,
      `${MEASURE}px`,
      `${label}: the ${name} does not carry max-width: 56rem (${measure.maxWidth})`,
    );
    assert.ok(
      near(measure.box.width, MEASURE),
      `${label}: the ${name} is not the readable measure wide (${measure.box.width}px vs ${MEASURE}px)`,
    );
    assert.ok(
      near(parseFloat(measure.marginLeft), parseFloat(measure.marginRight)),
      `${label}: the ${name} is not centred by equal margins (${measure.marginLeft}/${measure.marginRight})`,
    );
    assert.ok(
      near(measure.box.left + measure.box.right, chat.box.left + chat.box.right, 2),
      `${label}: the ${name} is not centred in the dock (${measure.box.left}..${measure.box.right} in ${chat.box.left}..${chat.box.right})`,
    );
  }

  assert.equal(
    state.owners.bottomRight,
    "dock",
    `${label}: the window's bottom-right corner is not the dock's (${state.owners.bottomRight})`,
  );
  assert.equal(
    state.owners.bottomLeft,
    "rail",
    `${label}: the window's bottom-left corner is not the rail's (${state.owners.bottomLeft})`,
  );
  assert.equal(state.route, "/home", `${label}: the page route changed (${state.route})`);
  assert.ok(
    state.overflow.scrollWidth <= viewport.width &&
      state.overflow.clientWidth <= viewport.width,
    `${label}: the layout opened a horizontal scrollbar (${state.overflow.scrollWidth}px)`,
  );

  assertDoors(label, state, true);
}

/** The exact pre-focus geometry. */
function assertRestored(label: string, before: FocusState, after: FocusState) {
  assert.doesNotMatch(
    classesOf(after),
    /shell--chat-focus/,
    `${label}: the mode class survived the exit (${classesOf(after)})`,
  );
  assert.equal(
    after.shell?.className,
    before.shell?.className,
    `${label}: the shell class list did not come back (${after.shell?.className} vs ${before.shell?.className})`,
  );
  assert.deepEqual(
    after.shell?.box,
    before.shell?.box,
    `${label}: the shell box did not come back`,
  );
  assert.equal(
    after.shell?.gridTemplateColumns,
    before.shell?.gridTemplateColumns,
    `${label}: the grid tracks did not come back (${after.shell?.gridTemplateColumns} vs ${before.shell?.gridTemplateColumns})`,
  );
  assert.deepEqual(after.rail?.box, before.rail?.box, `${label}: the rail did not come back`);
  assert.deepEqual(after.main?.box, before.main?.box, `${label}: the page did not come back`);
  assert.deepEqual(after.chat?.box, before.chat?.box, `${label}: the dock did not come back`);
  assert.equal(
    after.divider.present,
    before.divider.present,
    `${label}: the divider did not come back`,
  );
  assert.deepEqual(
    after.owners,
    before.owners,
    `${label}: the panes are not painted where they started`,
  );
  assert.equal(
    after.dockControl.label,
    before.dockControl.label,
    `${label}: the dock control did not turn around`,
  );
  assert.equal(
    after.dockControl.pressed,
    before.dockControl.pressed,
    `${label}: the dock control's pressed state did not clear`,
  );
  assert.equal(
    after.strip?.holdsChatFocus,
    false,
    `${label}: the strip carries a second full-screen door after the round trip`,
  );
  assert.equal(
    after.strip?.hasMainPageControl,
    false,
    `${label}: [data-testid="titlebar-main-page"] returned after the round trip`,
  );
  assert.deepEqual(
    after.strip?.classes,
    before.strip?.classes,
    `${label}: the strip's trailing cluster changed in the round trip`,
  );
  assert.equal(after.route, before.route, `${label}: the route changed`);
}

function assertCollapsedExit(label: string, state: FocusState) {
  assert.match(
    classesOf(state),
    /shell--chat-collapsed/,
    `${label}: the dock collapsed but the shell is not collapsed (${classesOf(state)})`,
  );
  assert.doesNotMatch(
    classesOf(state),
    /shell--chat-focus/,
    `${label}: collapsing the dock left the mode stuck on (${classesOf(state)})`,
  );
  assert.ok(
    state.main !== null &&
      state.main.display !== "none" &&
      state.main.box.width > 0 &&
      state.main.box.height > 0,
    `${label}: the page did not come back (${JSON.stringify(state.main)})`,
  );
  assert.equal(state.chat, null, `${label}: the dock pane is still in the grid`);
  const launcher = state.launcher;
  assert.ok(launcher, `${label}: the floating launcher did not come back`);
  assert.equal(launcher.position, "fixed", `${label}: the launcher is not floating`);
  assert.equal(
    state.dockControl.found,
    false,
    `${label}: the dock's control is still reachable with the dock collapsed`,
  );
  // The strip is still the shipped three while the dock is collapsed: the mode's
  // one door left with the dock, but no second door replaces it up there.
  assertStrip(label, state);
  assert.equal(state.divider.present, false, `${label}: the divider is drawn with no dock`);
}

function assertShortcutKeys(
  label: string,
  keys: FocusState["keys"],
  expected: number,
) {
  assert.ok(Array.isArray(keys), `${label}: the harness logged no keydowns`);
  assert.equal(
    keys.length,
    expected,
    `${label}: the page saw ${keys.length} keydowns, not ${expected} (${JSON.stringify(keys)})`,
  );
  for (const key of keys) {
    assert.equal(
      key.ctrl && key.shift && !key.alt && !key.meta,
      true,
      `${label}: a keydown did not carry exactly Ctrl+Shift (${JSON.stringify(key)})`,
    );
    assert.equal(
      key.key.toLowerCase(),
      "f",
      `${label}: a keydown was not F (${JSON.stringify(key)})`,
    );
    assert.equal(
      key.trusted,
      true,
      `${label}: the keydown was synthetic rather than delivered by the browser (${JSON.stringify(key)})`,
    );
  }
}

function assertPng(file: string, label: string, minBytes = 512) {
  assert.equal(fs.existsSync(file), true, `${label}: the driver wrote no picture at ${file}`);
  const bytes = fs.readFileSync(file);
  assert.ok(
    bytes.length >= minBytes,
    `${label}: the picture is empty (${bytes.length} bytes)`,
  );
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${label}: the artifact is not a PNG (${file})`,
  );
}

describe("full-screen chat", () => {
  it("takes the workspace from its one door and its shortcut and restores the exact layout", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact — a crashed or skipped run is not evidence",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);
    assert.ok(report.scenarios.length > 0, "the driver recorded no scenarios");
    for (const scenario of report.scenarios) {
      assert.equal(
        scenario.pass,
        true,
        `scenario "${scenario.name}" failed: ${scenario.failures.join("; ")}`,
      );
    }

    // —— The tokens the contract freezes. ——
    assert.deepEqual(
      report.viewport,
      { width: 1280, height: 900 },
      `the rig did not run at 1280x900 (${JSON.stringify(report.viewport)})`,
    );
    assert.equal(
      report.tokens.titlebarHeight,
      32,
      `the window strip is not the shipped 32px (${report.tokens.titlebarHeight})`,
    );
    assert.equal(
      report.tokens.frame,
      12,
      `the shell frame is not the shipped 12px (${report.tokens.frame})`,
    );
    assert.equal(
      report.tokens.track,
      256,
      `the rail is not the shipped 256px (${report.tokens.track})`,
    );
    assert.equal(
      report.tokens.collapsedTrack,
      56,
      `the collapsed rail is not the shipped 56px (${report.tokens.collapsedTrack})`,
    );
    assert.equal(
      report.tokens.rootFontSize,
      16,
      `the root type size is not 16px, so 56rem is not 896px (${report.tokens.rootFontSize})`,
    );

    // —— The shipped layout, before the mode. ——
    assert.match(
      classesOf(report.initial),
      /shell--chat-right/,
      `the shipped shell is not the trailing-dock arrangement (${classesOf(report.initial)})`,
    );
    assert.equal(
      report.initial.chat?.box.right,
      report.initial.viewport.width,
      "the shipped dock does not reach the window's trailing edge",
    );
    assert.equal(
      report.initial.divider.present,
      true,
      "the shipped layout has no divider between the page and the dock",
    );
    assertDoors("shipped layout", report.initial, false);

    // —— The mode, through its one door, its shortcut and every arrangement. ——
    assertFocused("dock door", report.focusedViaDock, report.initial);
    assertFocused("shortcut", report.shortcutFocused, report.initial);
    assertFocused("from collapsed dock", report.focusFromCollapsed, report.initial);
    assertFocused(
      "rail-collapsed",
      report.railCollapsedFocused,
      report.railCollapsedBase,
    );
    assertFocused("dock-left", report.sideLeftFocused, report.sideLeftBase);

    // The rail-collapsed mode starts at the rail's own thin track.
    assert.equal(
      report.railCollapsedBase.rail?.box.width,
      report.railCollapsedBase.tokens.collapsedTrack,
      "collapsing the rail did not shrink it to its icon column",
    );
    assert.equal(
      report.railCollapsedFocused.chat?.box.left,
      report.railCollapsedBase.tokens.collapsedTrack,
      `the mode's dock does not start at the collapsed rail's trailing edge (${report.railCollapsedFocused.chat?.box.left}px vs ${report.railCollapsedBase.tokens.collapsedTrack}px)`,
    );
    // The mode ignores the dock's side.
    assert.match(
      classesOf(report.sideLeftFocused),
      /shell--chat-left/,
      "the dock-left arrangement lost its own shell class in the mode",
    );
    assert.equal(
      report.sideLeftFocused.chat?.box.left,
      report.sideLeftFocused.rail?.box.right,
      "the dock-left mode does not start at the rail's trailing edge",
    );
    assert.equal(
      report.sideLeftFocused.chat?.box.right,
      report.sideLeftFocused.viewport.width,
      "the dock-left mode does not reach the window's trailing edge",
    );

    // —— Entering the mode from a collapsed dock reopens it: the shortcut is
    // the only door left when the dock's control is not on screen. ——
    assert.ok(
      report.focusFromCollapsed.chat,
      "entering the mode from a collapsed dock left the dock collapsed",
    );
    assert.match(
      classesOf(report.focusFromCollapsed),
      /shell--chat-open/,
      `the reopened dock is not reported open (${classesOf(report.focusFromCollapsed)})`,
    );
    assert.equal(
      report.focusFromCollapsed.launcher,
      null,
      "the launcher survived entering the mode from a collapsed dock",
    );

    // —— Every exit restores the exact pre-focus geometry. ——
    assertRestored("dock door exit", report.initial, report.restoredAfterDock);
    assertRestored("shortcut exit", report.initial, report.shortcutRestored);
    assertRestored(
      "from collapsed exit",
      report.initial,
      report.restoredFromCollapsed,
    );
    assertRestored(
      "rail-collapsed exit",
      report.railCollapsedBase,
      report.railCollapsedRestored,
    );
    assertRestored(
      "dock-left exit",
      report.sideLeftBase,
      report.sideLeftRestored,
    );
    assertRestored("rail restore", report.initial, report.railRestored);
    assertRestored("final", report.initial, report.finalRestored);
    assertDoors("final", report.finalRestored, false);

    // —— Collapsing the dock while in the mode clears it. ——
    assertCollapsedExit("collapse while focused", report.collapsedFromFocus);

    // —— The shortcut is a real trusted keydown at every press, four times. ——
    assertShortcutKeys("shortcut on", report.shortcutFocused.keys, 1);
    assertShortcutKeys("shortcut off", report.shortcutRestored.keys, 2);
    assertShortcutKeys("from collapsed on", report.focusFromCollapsed.keys, 3);
    assertShortcutKeys(
      "from collapsed off",
      report.restoredFromCollapsed.keys,
      4,
    );

    // —— The artifact: a picture of the shipped full-screen UI. ——
    const focusShots = report.screenshots.filter((file) =>
      /chat-focus\.png$/.test(file),
    );
    assert.equal(
      focusShots.length,
      1,
      `the report does not name the mode's picture (${JSON.stringify(report.screenshots)})`,
    );
    assertPng(FOCUS_SHOT, "the mode's picture", 10_000);
    for (const file of report.screenshots) {
      assertPng(file, "a rig screenshot");
    }
  });
});
