/**
 * The chat dock's reading settings: the shipped 1.5 line spacing, the Ctrl
 * gestures that zoom the transcript, the dock's own Chat display page, the
 * Settings → Chat display page, and the localStorage pair every surface shares.
 *
 * The rig (`e2e/chat-display.electron.mjs`) drives two harness pages in a real
 * Electron window — `chat-panel.html?reading=1`, the shipping dock with the
 * `ChatDisplayProvider` on top, and `settings-sheet.html`, the real settings
 * sheet with the same provider — measures the layout engine's own computed type,
 * and writes `e2e/artifacts/chat-display.json` plus three pictures of the
 * shipped surfaces. This wrapper re-reads that report and restates every number
 * the suite depends on, so a regression names the field it broke instead of only
 * "the driver said pass: false".
 *
 * Why these numbers: the transcript's base is 13px (0.8125rem of a 16px root)
 * on 1.5 line spacing, so the computed line-height is 19.5px and the ratio is
 * the reading line spacing the operator picked. A zoom notch is 10%, so 100% →
 * 13px, 110% → 14.3px, 120% → 15.6px. The dock's display page and the settings
 * page's preview are both drawn with the transcript's own measures, so their
 * ratios are the same axis.
 *
 * A skipped rig is evidence of nothing, so the test only reports a run whose
 * report artifact exists — and `lifequest-e2e` is what puts THIS checkout on
 * 5173.
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
const REPORT = path.join(desktopRoot, "e2e/artifacts/chat-display.json");

/** The three pictures the rig writes beside the report. */
const DOCK_SHOT = "chat-display-dock.png";
const DISPLAY_SHOT = "chat-display-page.png";
const SETTINGS_SHOT = "chat-display-settings.png";

/** The contract's own numbers, restated so the report cannot drift on its own. */
const BASE_FONT_PX = 13;
const DEFAULT_RATIO = 1.5;
const RELAXED_RATIO = 1.75;
const ZOOM_STEP = 10;
const STORAGE_KEY = "lifequest-chat-display";

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Stored = { zoom?: number; lineSpacing?: number } | string | null;

type ChatLocation = {
  href: string;
  pathname: string;
  search: string;
};

type ZoomState = {
  value: string | null;
  inPresent: boolean;
  outPresent: boolean;
  resetPresent: boolean;
  inDisabled: boolean | null;
  outDisabled: boolean | null;
};

type PreviewState = {
  present: boolean;
  dataZoom: string | null;
  dataLineSpacing: string | null;
  readingScale: string;
  readingLine: string;
  proseFontPx: number | null;
  proseLinePx: number | null;
  proseRatio: number | null;
};

type LineButton = {
  testid: string | null;
  value: string | null;
  pressed: string | null;
  active: boolean;
  label: string;
};

/** The bottom bar's Chat display settings control: a button, not a route. */
type DisplayButton = {
  present: boolean;
  tag: string;
  type: string | null;
  ariaLabel: string | null;
  title: string | null;
  pressed: string | null;
  href: string | null;
  icon: string | null;
  insideActionBar: boolean;
};

/** The dock's own display page, as the sample saw it. */
type DisplayPageState = {
  present: boolean;
  headerPresent: boolean;
  heading: string;
  back: { present: boolean; label: string | null };
  bodyPresent: boolean;
  bodyVisible: boolean;
  root: boolean;
};

type ChatSample = {
  viewport: { width: number; height: number };
  chatSurface: string | null;
  location: ChatLocation;
  panel: Box;
  readingScale: string;
  readingLine: string;
  answer: {
    fontPx: number;
    linePx: number;
    ratio: number;
    text: string;
  } | null;
  answerRows: number;
  stored: Stored;
  footer: { present: boolean; hidden: boolean | null; visible: boolean };
  composerVisible: boolean;
  tabs: { present: boolean; visible: boolean };
  displayPage: DisplayPageState;
  zoom: ZoomState;
  preview: PreviewState | null;
  lineButtons: LineButton[];
  displayButton: DisplayButton;
  keyLog: {
    key: string;
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
    defaultPrevented: boolean;
  }[];
  wheelLog: { ctrl: boolean; meta: boolean; deltaY: number; defaultPrevented: boolean }[];
};

type SettingsSample = {
  view: string | null;
  panelTitle: string;
  navLabels: string[];
  navChatDisplayActive: boolean;
  labels: string[];
  zoom: ZoomState;
  preview: PreviewState | null;
  lineButtons: LineButton[];
  stored: Stored;
};

type ChatDisplayReport = {
  url: string;
  settingsUrl: string;
  ranAt: string;
  window: { width: number; height: number };
  contract: {
    baseFontPx: number;
    defaultLineSpacing: number;
    relaxedLineSpacing: number;
    zoomStepPercent: number;
    storageKey: string;
    fontTolerancePx: number;
    ratioTolerance: number;
  };
  defaults: ChatSample;
  wheel: {
    outsideDock: ChatSample;
    up: ChatSample;
    down: ChatSample;
  };
  keys: {
    plus: ChatSample;
    minus: ChatSample;
    zero: ChatSample;
  };
  persistence: { before: ChatSample; after: ChatSample };
  dockDisplay: {
    control: DisplayButton;
    locationBefore: ChatLocation;
    page: ChatSample;
    relaxed: ChatSample;
    zoomed: ChatSample;
    reset: ChatSample;
    restored: ChatSample;
    closed: ChatSample;
  };
  settings: {
    sheet: { opened: boolean; clicked: boolean };
    opened: SettingsSample;
    relaxed: SettingsSample;
    zoomed: SettingsSample;
    reset: SettingsSample;
    final: SettingsSample;
  };
  sharedContract: ChatSample;
  dockArtifact: ChatSample;
  settingsArtifact: SettingsSample;
  artifacts: {
    dock: { path: string; bytes: number };
    display: { path: string; bytes: number };
    settings: { path: string; bytes: number };
  };
  marks: { ms: number; label: string }[];
  failures: string[];
  pass: boolean;
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
      [path.join(desktopRoot, "e2e/chat-display.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000 },
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

/** The stored shape of a sample, as an object to read `zoom`/`lineSpacing` off. */
function storedOf(sample: { stored: Stored }): { zoom?: number; lineSpacing?: number } {
  const stored = sample.stored;
  return stored !== null && typeof stored === "object" ? stored : {};
}

/** One font-size or ratio against the number the contract fixes. */
function assertNear(
  value: number | null | undefined,
  expected: number,
  tolerance: number,
  message: string,
): void {
  assert.ok(
    typeof value === "number" && Math.abs(value - expected) <= tolerance,
    `${message}: measured ${value}, expected ${expected} ± ${tolerance}`,
  );
}

describe("the chat dock's reading settings", () => {
  it("ships at 1.5 line spacing, zooms with Ctrl, and shares its stored pair with Settings → Chat display", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as ChatDisplayReport;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The contract the rig measured against — restated here, so a rig that
    // silently loosened its own tolerances cannot pass this suite.
    assert.equal(report.contract.baseFontPx, BASE_FONT_PX);
    assert.equal(report.contract.defaultLineSpacing, DEFAULT_RATIO);
    assert.equal(report.contract.relaxedLineSpacing, RELAXED_RATIO);
    assert.equal(report.contract.zoomStepPercent, ZOOM_STEP);
    assert.equal(report.contract.storageKey, STORAGE_KEY);
    assert.ok(
      report.contract.fontTolerancePx <= 0.5,
      `the rig loosened its font tolerance to ${report.contract.fontTolerancePx}px`,
    );
    assert.ok(
      report.contract.ratioTolerance <= 0.05,
      `the rig loosened its ratio tolerance to ${report.contract.ratioTolerance}`,
    );

    const fontTolerance = report.contract.fontTolerancePx;
    const ratioTolerance = report.contract.ratioTolerance;
    const fontAt = (percent: number) => (BASE_FONT_PX * percent) / 100;

    // ── 1. the default state: 100% on 1.5 line spacing ─────────────────────
    const defaults = report.defaults;
    assert.equal(defaults.answer !== null, true, "the dock's assistant answer did not render");
    assert.ok(defaults.answerRows > 0, "the dock drew no assistant rows");
    assert.equal(
      defaults.readingScale,
      "1",
      `the dock's --chat-reading-scale is ${JSON.stringify(defaults.readingScale)}, expected "1"`,
    );
    assert.equal(
      defaults.readingLine,
      String(DEFAULT_RATIO),
      `the dock's --chat-reading-line is ${JSON.stringify(defaults.readingLine)}, expected "${DEFAULT_RATIO}"`,
    );
    assertNear(defaults.answer!.fontPx, BASE_FONT_PX, fontTolerance, "the default answer font-size");
    assertNear(
      defaults.answer!.ratio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the default answer line-height/font-size",
    );

    // ── 2. Ctrl + wheel: one 10% notch per event, only over the dock ───────
    assert.equal(
      report.wheel.outsideDock.readingScale,
      "1",
      "Ctrl+wheel outside the dock zoomed the transcript — the gesture is the dock's, not the window's",
    );
    assert.equal(
      report.wheel.up.readingScale,
      "1.1",
      `Ctrl+wheel up left the dock at ${JSON.stringify(report.wheel.up.readingScale)}, expected "1.1"`,
    );
    assertNear(
      report.wheel.up.answer?.fontPx,
      fontAt(110),
      fontTolerance,
      "one Ctrl+wheel-up notch on the answer font",
    );
    assertNear(
      report.wheel.up.answer?.ratio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the line ratio after a wheel zoom",
    );
    assert.equal(
      report.wheel.down.readingScale,
      "1",
      `Ctrl+wheel down left the dock at ${JSON.stringify(report.wheel.down.readingScale)}, expected back to "1"`,
    );
    assertNear(
      report.wheel.down.answer?.fontPx,
      BASE_FONT_PX,
      fontTolerance,
      "the answer font after a wheel zoom back down",
    );

    // ── 3. Ctrl + = / - / 0 from the keyboard ──────────────────────────────
    assert.equal(
      report.keys.plus.readingScale,
      "1.1",
      `Ctrl+= left the dock at ${JSON.stringify(report.keys.plus.readingScale)}; the page's key log was ` +
        `${JSON.stringify(report.keys.plus.keyLog)}`,
    );
    assertNear(
      report.keys.plus.answer?.fontPx,
      fontAt(110),
      fontTolerance,
      "the answer font after Ctrl+=",
    );
    assert.equal(
      report.keys.minus.readingScale,
      "1",
      `Ctrl+- left the dock at ${JSON.stringify(report.keys.minus.readingScale)}`,
    );
    assert.equal(
      report.keys.zero.readingScale,
      "1",
      `Ctrl+0 left the dock at ${JSON.stringify(report.keys.zero.readingScale)} — the zoom was not reset`,
    );
    assertNear(
      report.keys.zero.answer?.fontPx,
      BASE_FONT_PX,
      fontTolerance,
      "the answer font after Ctrl+0",
    );
    assertNear(
      report.keys.zero.answer?.ratio,
      DEFAULT_RATIO,
      ratioTolerance,
      "Ctrl+0 did not return the line ratio",
    );

    // ── 4. the window remembers the size across a reload ───────────────────
    assert.equal(
      storedOf(report.persistence.before).zoom,
      110,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(report.persistence.before.stored)} ` +
        "after stepping to 110%",
    );
    assert.equal(
      report.persistence.after.readingScale,
      "1.1",
      `after a reload the dock wears ${JSON.stringify(report.persistence.after.readingScale)}, ` +
        'expected the stored "1.1"',
    );
    assertNear(
      report.persistence.after.answer?.fontPx,
      fontAt(110),
      fontTolerance,
      "the answer font after the reload",
    );

    // ── 5. the dock's own display page: a button in the bar, not a route ────
    const dockDisplay = report.dockDisplay;
    const displayControl = dockDisplay.control;
    assert.equal(
      displayControl.present,
      true,
      'the dock has no [data-testid="chat-display-settings"] control',
    );
    assert.equal(
      displayControl.tag,
      "BUTTON",
      `the dock's display control is a <${displayControl.tag.toLowerCase()}>, not a button`,
    );
    assert.equal(
      displayControl.type,
      "button",
      `the control's type is ${JSON.stringify(displayControl.type)}, expected "button"`,
    );
    assert.equal(
      displayControl.href,
      null,
      `the control carries href ${JSON.stringify(displayControl.href)}; it must be a button, not a route`,
    );
    assert.equal(
      displayControl.ariaLabel,
      "Chat display settings",
      `the control's accessible name is ${JSON.stringify(displayControl.ariaLabel)}`,
    );
    assert.equal(
      displayControl.title,
      "Chat display settings",
      `the control's title is ${JSON.stringify(displayControl.title)}`,
    );
    assert.equal(
      displayControl.pressed,
      "false",
      `the control reports pressed ${JSON.stringify(displayControl.pressed)} on a thread`,
    );
    assert.equal(
      displayControl.icon,
      "lucide-type",
      `the control is not wearing the Type icon (${displayControl.icon})`,
    );
    assert.equal(
      displayControl.insideActionBar,
      true,
      "the display control is not in the dock's bottom action bar",
    );

    const displayPage = dockDisplay.page;
    assert.equal(
      displayPage.chatSurface,
      "display",
      `pressing the control left the dock on ${JSON.stringify(displayPage.chatSurface)}, expected "display"`,
    );
    assert.equal(
      displayPage.location.href,
      dockDisplay.locationBefore.href,
      "the dock's display control navigated the window instead of opening the dock's page",
    );
    assert.equal(
      displayPage.location.href.includes("/settings"),
      false,
      `the window is on ${JSON.stringify(displayPage.location.href)}, a /settings route — the control must not navigate`,
    );
    assert.equal(
      displayPage.displayPage.headerPresent,
      true,
      "the display page has no .chat-panel__header--display",
    );
    assert.equal(
      displayPage.displayPage.heading,
      "Chat display",
      `the display page's heading is ${JSON.stringify(displayPage.displayPage.heading)}`,
    );
    assert.equal(
      displayPage.displayPage.back.present,
      true,
      "the display page has no Back control",
    );
    assert.equal(
      displayPage.displayPage.back.label,
      "Back to chat",
      `the Back control is labelled ${JSON.stringify(displayPage.displayPage.back.label)}`,
    );
    assert.equal(
      displayPage.displayPage.bodyPresent,
      true,
      "the display page has no .chat-panel__body--display",
    );
    assert.equal(
      displayPage.displayPage.bodyVisible,
      true,
      "the display page's body is not painted",
    );
    assert.equal(
      displayPage.displayPage.root,
      true,
      "the display page has no [data-chat-display] root",
    );
    assert.equal(
      displayPage.displayButton.pressed,
      "true",
      "the dock-bar display control does not report pressed on its own page",
    );
    assert.equal(
      displayPage.footer.hidden,
      true,
      "the display page kept the chat footer drawn",
    );
    assert.equal(
      displayPage.footer.visible,
      false,
      "the display page's footer is painted",
    );
    assert.equal(
      displayPage.composerVisible,
      false,
      "the display page kept a visible composer",
    );
    assert.equal(
      displayPage.tabs.present,
      false,
      "the display page still draws the tab strip",
    );
    assert.equal(
      displayPage.zoom.value,
      "110%",
      `the dock's display page reads ${JSON.stringify(displayPage.zoom.value)}, expected the stored "110%"`,
    );
    assert.equal(
      displayPage.zoom.inPresent &&
        displayPage.zoom.outPresent &&
        displayPage.zoom.resetPresent,
      true,
      `the display page's zoom controls are ${JSON.stringify(displayPage.zoom)}`,
    );
    assert.equal(
      displayPage.lineButtons.length,
      4,
      `the display page offers ${displayPage.lineButtons.length} line spacings, expected 4`,
    );
    const displayNormal = displayPage.lineButtons.find(
      (button) => button.testid === "chat-display-line-normal",
    );
    assert.ok(displayNormal, "the display page has no Normal line-spacing option");
    assert.equal(displayNormal!.value, String(DEFAULT_RATIO));
    assert.equal(displayNormal!.pressed, "true", "the Normal option is not pressed at the shipped 1.5");
    assert.equal(displayNormal!.active, true, "the Normal option is not the active one");
    const displayRelaxedBefore = displayPage.lineButtons.find(
      (button) => button.testid === "chat-display-line-relaxed",
    );
    assert.ok(displayRelaxedBefore, "the display page has no Relaxed option");
    assert.equal(displayRelaxedBefore!.value, String(RELAXED_RATIO));
    assert.equal(
      displayRelaxedBefore!.pressed,
      "false",
      "the Relaxed option is pressed while the stored spacing is 1.5",
    );
    assert.equal(displayPage.preview?.dataZoom, "110", `the display page's preview data-zoom is ${JSON.stringify(displayPage.preview?.dataZoom)}`);
    assert.equal(
      displayPage.preview?.dataLineSpacing,
      String(DEFAULT_RATIO),
      `the display page's preview data-line-spacing is ${JSON.stringify(displayPage.preview?.dataLineSpacing)}`,
    );
    assert.equal(displayPage.preview?.readingScale, "1.1");
    assert.equal(displayPage.preview?.readingLine, String(DEFAULT_RATIO));
    assertNear(
      displayPage.preview?.proseFontPx,
      fontAt(110),
      fontTolerance,
      "the dock display page's preview font-size at 110%",
    );
    assertNear(
      displayPage.preview?.proseRatio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the dock display page's preview line ratio at 1.5",
    );

    // The dock page's controls are the settings page's controls: they write the
    // same provider storage and the preview wears it.
    const displayRelaxed = dockDisplay.relaxed;
    assert.equal(
      displayRelaxed.preview?.dataLineSpacing,
      String(RELAXED_RATIO),
      `pressing Relaxed on the dock page left the preview at ${JSON.stringify(displayRelaxed.preview?.dataLineSpacing)}`,
    );
    assertNear(
      displayRelaxed.preview?.proseRatio,
      RELAXED_RATIO,
      ratioTolerance,
      "the dock page's preview line ratio after Relaxed",
    );
    assert.equal(
      storedOf(displayRelaxed).lineSpacing,
      RELAXED_RATIO,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(displayRelaxed.stored)} after Relaxed on the dock page`,
    );
    assert.equal(
      storedOf(displayRelaxed).zoom,
      110,
      "pressing Relaxed on the dock page changed the stored zoom",
    );
    const displayRelaxedButton = displayRelaxed.lineButtons.find(
      (button) => button.testid === "chat-display-line-relaxed",
    );
    assert.ok(displayRelaxedButton, "the dock page's Relaxed button did not render");
    assert.equal(displayRelaxedButton!.pressed, "true");
    assert.equal(displayRelaxedButton!.active, true);
    assert.equal(
      displayRelaxed.zoom.value,
      "110%",
      `changing line spacing moved the dock page's zoom to ${JSON.stringify(displayRelaxed.zoom.value)}`,
    );

    const displayZoomed = dockDisplay.zoomed;
    assert.equal(
      displayZoomed.zoom.value,
      "120%",
      `the dock page's + left the read-back at ${JSON.stringify(displayZoomed.zoom.value)}, expected "120%"`,
    );
    assert.equal(
      displayZoomed.preview?.dataZoom,
      "120",
      `the dock page's preview data-zoom is ${JSON.stringify(displayZoomed.preview?.dataZoom)} after +`,
    );
    assertNear(
      displayZoomed.preview?.proseFontPx,
      fontAt(120),
      fontTolerance,
      "the dock page's preview font-size after +",
    );
    assertNear(
      displayZoomed.preview?.proseRatio,
      RELAXED_RATIO,
      ratioTolerance,
      "zooming the dock page must not change the line spacing",
    );
    assert.equal(
      storedOf(displayZoomed).zoom,
      120,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(displayZoomed.stored)} after + on the dock page`,
    );

    const displayReset = dockDisplay.reset;
    assert.equal(
      displayReset.zoom.value,
      "100%",
      `the dock page's reset read-back is ${JSON.stringify(displayReset.zoom.value)}`,
    );
    assert.equal(
      displayReset.preview?.dataZoom,
      "100",
      `reset left the dock preview's data-zoom at ${JSON.stringify(displayReset.preview?.dataZoom)}`,
    );
    assert.equal(
      displayReset.preview?.dataLineSpacing,
      String(DEFAULT_RATIO),
      `reset left the dock preview's line spacing at ${JSON.stringify(displayReset.preview?.dataLineSpacing)}`,
    );
    assertNear(
      displayReset.preview?.proseFontPx,
      BASE_FONT_PX,
      fontTolerance,
      "the dock preview's prose font-size after reset",
    );
    assertNear(
      displayReset.preview?.proseRatio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the dock preview's line ratio after reset",
    );
    assert.equal(storedOf(displayReset).zoom, 100, "reset did not store zoom 100 from the dock page");
    assert.equal(
      storedOf(displayReset).lineSpacing,
      DEFAULT_RATIO,
      "reset did not store the 1.5 line spacing from the dock page",
    );

    // The dock page must leave the pair the Settings leg below is written
    // against: 110% / 1.5 (reset put 100%, one zoom-in puts it back).
    const displayRestored = dockDisplay.restored;
    assert.equal(
      displayRestored.zoom.value,
      "110%",
      `the pair left for the Settings leg reads ${JSON.stringify(displayRestored.zoom.value)}, expected "110%"`,
    );
    assert.equal(displayRestored.preview?.dataZoom, "110");
    assert.equal(displayRestored.preview?.dataLineSpacing, String(DEFAULT_RATIO));
    assert.equal(storedOf(displayRestored).zoom, 110);
    assert.equal(storedOf(displayRestored).lineSpacing, DEFAULT_RATIO);

    // The same control closes the page: the thread and its composer come back.
    const displayClosed = dockDisplay.closed;
    assert.equal(
      displayClosed.chatSurface,
      "thread",
      `a second press left the dock on ${JSON.stringify(displayClosed.chatSurface)}, expected "thread"`,
    );
    assert.equal(
      displayClosed.composerVisible,
      true,
      "closing the dock's display page did not give the thread its composer back",
    );
    assert.equal(
      displayClosed.footer.visible,
      true,
      "closing the dock's display page left the footer hidden",
    );
    assert.equal(
      displayClosed.displayButton.pressed,
      "false",
      "the display control stayed pressed after it closed its own page",
    );
    assert.equal(
      displayClosed.location.href,
      dockDisplay.locationBefore.href,
      "closing the dock's display page moved the window",
    );

    // ── 6. Settings → Chat display ─────────────────────────────────────────
    const opened = report.settings.opened;
    assert.equal(report.settings.sheet.opened, true, "the settings sheet could not be opened");
    assert.equal(report.settings.sheet.clicked, true, 'no "Chat display" nav item was pressed');
    assert.equal(
      opened.view,
      "reading",
      `the sheet is showing ${JSON.stringify(opened.view)}, expected "reading"`,
    );
    assert.equal(
      opened.panelTitle,
      "Chat display",
      `the page's title is ${JSON.stringify(opened.panelTitle)}`,
    );
    assert.equal(opened.navChatDisplayActive, true, "the nav's active row is not Chat display");
    assert.equal(
      opened.labels.includes("Text size"),
      true,
      `the page has no "Text size" row (labels: ${JSON.stringify(opened.labels)})`,
    );
    assert.equal(
      opened.labels.includes("Line spacing"),
      true,
      `the page has no "Line spacing" row (labels: ${JSON.stringify(opened.labels)})`,
    );
    assert.equal(
      opened.zoom.value,
      "110%",
      `the settings page reads ${JSON.stringify(opened.zoom.value)}, expected the stored "110%"`,
    );
    assert.equal(
      opened.zoom.inPresent && opened.zoom.outPresent && opened.zoom.resetPresent,
      true,
      `the zoom controls are ${JSON.stringify(opened.zoom)}`,
    );
    assert.ok(opened.preview, "the settings page drew no preview");
    assert.equal(
      opened.preview!.dataZoom,
      "110",
      `the preview's data-zoom is ${JSON.stringify(opened.preview!.dataZoom)}`,
    );
    assert.equal(
      opened.preview!.dataLineSpacing,
      String(DEFAULT_RATIO),
      `the preview's data-line-spacing is ${JSON.stringify(opened.preview!.dataLineSpacing)}`,
    );
    assert.equal(opened.preview!.readingScale, "1.1");
    assert.equal(opened.preview!.readingLine, String(DEFAULT_RATIO));
    assertNear(
      opened.preview!.proseFontPx,
      fontAt(110),
      fontTolerance,
      "the preview's prose font-size at 110%",
    );
    assertNear(
      opened.preview!.proseRatio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the preview's line ratio at 1.5",
    );

    // Relaxed: the click writes the spacing and the preview wears it.
    const relaxed = report.settings.relaxed;
    assert.equal(
      relaxed.preview?.dataLineSpacing,
      String(RELAXED_RATIO),
      `pressing Relaxed left the preview at ${JSON.stringify(relaxed.preview?.dataLineSpacing)}`,
    );
    assertNear(
      relaxed.preview?.proseRatio,
      RELAXED_RATIO,
      ratioTolerance,
      "the preview's line ratio after Relaxed",
    );
    assert.equal(
      storedOf(relaxed).lineSpacing,
      RELAXED_RATIO,
      `localStorage ${STORAGE_KEY} is ${JSON.stringify(relaxed.stored)} after Relaxed`,
    );
    const relaxedButton = relaxed.lineButtons.find(
      (button) => button.testid === "chat-display-line-relaxed",
    );
    assert.ok(relaxedButton, "the Relaxed button did not render");
    assert.equal(relaxedButton!.value, String(RELAXED_RATIO));
    assert.equal(
      relaxedButton!.pressed,
      "true",
      "the Relaxed button is not marked pressed",
    );
    assert.equal(relaxedButton!.active, true, "the Relaxed button is not the active option");

    // Zoom-in: the read-back and the preview move together.
    const zoomed = report.settings.zoomed;
    assert.equal(
      zoomed.zoom.value,
      "120%",
      `pressing + left the read-back at ${JSON.stringify(zoomed.zoom.value)}, expected "120%"`,
    );
    assert.equal(
      zoomed.preview?.dataZoom,
      "120",
      `the preview's data-zoom is ${JSON.stringify(zoomed.preview?.dataZoom)} after +`,
    );
    assertNear(
      zoomed.preview?.proseFontPx,
      fontAt(120),
      fontTolerance,
      "the preview's prose font-size after +",
    );
    assert.ok(
      typeof zoomed.preview?.proseFontPx === "number" &&
        typeof relaxed.preview?.proseFontPx === "number" &&
        zoomed.preview!.proseFontPx > relaxed.preview!.proseFontPx,
      `pressing + did not grow the preview: ${relaxed.preview?.proseFontPx}px → ` +
        `${zoomed.preview?.proseFontPx}px`,
    );
    assertNear(
      zoomed.preview?.proseRatio,
      RELAXED_RATIO,
      ratioTolerance,
      "zooming must not change the line spacing",
    );

    // Reset: back to the shipped pair.
    const reset = report.settings.reset;
    assert.equal(
      reset.zoom.value,
      "100%",
      `reset left the read-back at ${JSON.stringify(reset.zoom.value)}`,
    );
    assert.equal(
      reset.preview?.dataLineSpacing,
      String(DEFAULT_RATIO),
      `reset left the preview's line spacing at ${JSON.stringify(reset.preview?.dataLineSpacing)}`,
    );
    assertNear(
      reset.preview?.proseFontPx,
      BASE_FONT_PX,
      fontTolerance,
      "the preview's prose font-size after reset",
    );
    assertNear(
      reset.preview?.proseRatio,
      DEFAULT_RATIO,
      ratioTolerance,
      "the preview's line ratio after reset",
    );
    assert.equal(storedOf(reset).zoom, 100, "reset did not store zoom 100");
    assert.equal(
      storedOf(reset).lineSpacing,
      DEFAULT_RATIO,
      "reset did not store the 1.5 line spacing",
    );

    // ── 7. the shared contract: the dock wears what the page wrote ─────────
    assert.equal(
      storedOf(report.settings.final).zoom,
      100,
      "the settings page did not leave the window at 100%",
    );
    assert.equal(
      storedOf(report.settings.final).lineSpacing,
      RELAXED_RATIO,
      `the settings page did not store ${RELAXED_RATIO} before the dock reloaded`,
    );
    const contract = report.sharedContract;
    assert.equal(
      contract.readingScale,
      "1",
      `the dock wears ${JSON.stringify(contract.readingScale)} after the settings page chose 100%`,
    );
    assert.equal(
      contract.readingLine,
      String(RELAXED_RATIO),
      `the dock wears line spacing ${JSON.stringify(contract.readingLine)}, expected the settings ` +
        `page's "${RELAXED_RATIO}" — the two surfaces disagree`,
    );
    assertNear(
      contract.answer?.fontPx,
      BASE_FONT_PX,
      fontTolerance,
      "the dock's answer font-size after the shared-contract reload",
    );
    assertNear(
      contract.answer?.ratio,
      RELAXED_RATIO,
      ratioTolerance,
      "the dock's answer line ratio after the shared-contract reload",
    );

    // ── the pictures: the shipped screens at non-default settings ──────────
    assert.equal(
      report.dockArtifact.readingScale,
      "1.2",
      `the dock picture was taken at ${JSON.stringify(report.dockArtifact.readingScale)}`,
    );
    assert.equal(report.dockArtifact.readingLine, String(RELAXED_RATIO));
    assertNear(
      report.dockArtifact.answer?.fontPx,
      fontAt(120),
      fontTolerance,
      "the dock picture's answer font-size",
    );
    assert.equal(
      report.settingsArtifact.zoom.value,
      "120%",
      `the settings picture shows ${JSON.stringify(report.settingsArtifact.zoom.value)}`,
    );
    assert.equal(
      report.settingsArtifact.preview?.dataLineSpacing,
      String(RELAXED_RATIO),
      "the settings picture does not show the dock's line spacing",
    );
    assertNear(
      report.settingsArtifact.preview?.proseFontPx,
      fontAt(120),
      fontTolerance,
      "the settings picture's preview font-size",
    );

    assert.equal(
      report.artifacts.dock.path.endsWith(DOCK_SHOT),
      true,
      `the dock screenshot is ${report.artifacts.dock.path}, expected ${DOCK_SHOT}`,
    );
    assert.equal(
      report.artifacts.display.path.endsWith(DISPLAY_SHOT),
      true,
      `the dock display-page screenshot is ${report.artifacts.display.path}, expected ${DISPLAY_SHOT}`,
    );
    assert.equal(
      report.artifacts.settings.path.endsWith(SETTINGS_SHOT),
      true,
      `the settings screenshot is ${report.artifacts.settings.path}, expected ${SETTINGS_SHOT}`,
    );
    for (const shot of [
      report.artifacts.dock,
      report.artifacts.display,
      report.artifacts.settings,
    ]) {
      assert.equal(fs.existsSync(shot.path), true, `screenshot missing: ${shot.path}`);
      assert.ok(shot.bytes > 0, `screenshot is empty: ${shot.path}`);
    }
  });
});
