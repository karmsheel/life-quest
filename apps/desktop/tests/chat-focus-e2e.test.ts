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
  /** The titlebar door's relation to the theme control beside it. */
  gapToTheme?: number | null;
  beforeTheme?: boolean;
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
  titlebarControl: ControlState;
  topRow: {
    className: string;
    isTabs: boolean;
    isHeader: boolean;
    box: Box;
    controlIsTrailing: boolean;
    trailingGap: number | null;
    plusBox: Box | null;
    afterPlus: boolean;
    afterPlusGap: number | null;
    children: { classes: string; box: Box; holdsControl: boolean }[];
  } | null;
  cluster: {
    tag: string;
    classes: string;
    testid: string | null;
    label: string | null;
    icon: string | null;
    box: Box;
    holdsTitleControl: boolean;
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
  focusedViaTitlebar: FocusState;
  restoredAfterTitlebar: FocusState;
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

/** Both doors: label, pressed state, icon, and where each one lives. */
function assertDoors(label: string, state: FocusState, focused: boolean) {
  const expectedDockLabel = focused ? "Exit full screen chat" : "Full screen chat";
  const expectedTitleLabel = focused ? "Restore main page" : "Collapse main page";
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
    expectedDockLabel,
    `${label}: the dock control names the wrong move (${dock.label})`,
  );
  assert.equal(
    dock.title,
    expectedDockLabel,
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

  // The strip is drawn (the harness seeds a pinned chat), and the control is its
  // trailing item after the new-chat plus.
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
  assert.equal(
    topRow.afterPlus,
    true,
    `${label}: the dock control does not follow the new-chat plus (gap ${topRow.afterPlusGap})`,
  );
  assert.ok(
    topRow.afterPlusGap !== null && topRow.afterPlusGap <= 12,
    `${label}: the dock control is not immediately after the plus (${topRow.afterPlusGap}px)`,
  );

  const title = state.titlebarControl;
  assert.equal(title.found, true, `${label}: the titlebar carries no main-page control`);
  assert.match(
    String(title.classes ?? ""),
    /chat-focus-toggle/,
    `${label}: the titlebar control is not marked chat-focus-toggle (${title.classes})`,
  );
  assert.match(
    String(title.classes ?? ""),
    /window-titlebar__btn/,
    `${label}: the titlebar control is not a window-titlebar__btn (${title.classes})`,
  );
  assert.equal(
    title.label,
    expectedTitleLabel,
    `${label}: the titlebar control names the wrong move (${title.label})`,
  );
  assert.equal(
    title.pressed,
    expectedPressed,
    `${label}: the titlebar control's aria-pressed does not follow the mode (${title.pressed})`,
  );
  assert.match(
    String(title.icon ?? ""),
    new RegExp(expectedIcon),
    `${label}: the titlebar control wears the wrong icon (${title.icon})`,
  );

  const cluster = state.cluster;
  assert.equal(
    cluster.length,
    3,
    `${label}: the titlebar's trailing cluster is not the shipped three controls (${JSON.stringify(cluster.map((entry) => entry.classes))})`,
  );
  assert.equal(
    cluster[0]?.holdsTitleControl,
    true,
    `${label}: the main-page control does not lead the trailing cluster (${JSON.stringify(cluster.map((entry) => entry.classes))})`,
  );
  assert.match(
    String(cluster[1]?.classes ?? ""),
    /theme-mode-toggle/,
    `${label}: the theme control does not follow the main-page control (${cluster[1]?.classes})`,
  );
  assert.match(
    String(cluster[2]?.classes ?? ""),
    /settings-menu/,
    `${label}: the settings menu does not trail the cluster (${cluster[2]?.classes})`,
  );
  assert.ok(
    title.beforeTheme === true &&
      (title.gapToTheme ?? -1) >= 0 &&
      (title.gapToTheme ?? 99) <= 8,
    `${label}: the main-page control does not sit immediately before the theme control (gap ${title.gapToTheme})`,
  );
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
    after.titlebarControl.label,
    before.titlebarControl.label,
    `${label}: the titlebar control did not turn around`,
  );
  assert.equal(
    after.titlebarControl.pressed,
    before.titlebarControl.pressed,
    `${label}: the titlebar control's pressed state did not clear`,
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
  assert.equal(
    state.titlebarControl.label,
    "Collapse main page",
    `${label}: the titlebar control does not name the shipped move again (${state.titlebarControl.label})`,
  );
  assert.equal(
    state.titlebarControl.pressed,
    "false",
    `${label}: the titlebar control stayed pressed (${state.titlebarControl.pressed})`,
  );
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
  it("takes the workspace from both doors and restores the exact layout", async (t) => {
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

    // —— The mode, through every door and arrangement. ——
    assertFocused("dock door", report.focusedViaDock, report.initial);
    assertFocused("titlebar door", report.focusedViaTitlebar, report.initial);
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

    // —— Entering from a collapsed dock reopens it. ——
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
    assertRestored(
      "titlebar door exit",
      report.initial,
      report.restoredAfterTitlebar,
    );
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

    // —— The shortcut is a real trusted keydown, twice. ——
    assertShortcutKeys("shortcut on", report.shortcutFocused.keys, 1);
    assertShortcutKeys("shortcut off", report.shortcutRestored.keys, 2);

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
