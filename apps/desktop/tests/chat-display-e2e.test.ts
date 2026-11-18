/**
 * The chat dock's reading settings: the shipped 1.5 line spacing, the Ctrl
 * gestures that zoom the transcript, the dock's door to Settings → Chat display,
 * the settings page itself, and the localStorage pair both surfaces share.
 *
 * The rig (`e2e/chat-display.electron.mjs`) drives two harness pages in a real
 * Electron window — `chat-panel.html?reading=1`, the shipping dock with the
 * `ChatDisplayProvider` on top, and `settings-sheet.html`, the real settings
 * sheet with the same provider — measures the layout engine's own computed type,
 * and writes `e2e/artifacts/chat-display.json` plus two pictures of the shipped
 * surfaces. This wrapper re-reads that report and restates every number the
 * suite depends on, so a regression names the field it broke instead of only
 * "the driver said pass: false".
 *
 * Why these numbers: the transcript's base is 13px (0.8125rem of a 16px root)
 * on 1.5 line spacing, so the computed line-height is 19.5px and the ratio is
 * the reading line spacing the operator picked. A zoom notch is 10%, so 100% →
 * 14.3px, 110% → 14.3px, 120% → 15.6px. The settings page's preview is drawn
 * with the transcript's own measures, so its ratio is the same axis.
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

/** The two pictures the rig writes beside the report. */
const DOCK_SHOT = "chat-display-dock.png";
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

type ChatSample = {
  viewport: { width: number; height: number };
  chatSurface: string | null;
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
  link: {
    present: boolean;
    tag: string;
    ariaLabel: string | null;
    title: string | null;
    href: string | null;
    insideActionBar: boolean;
  } | null;
  keyLog: {
    key: string;
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
    defaultPrevented: boolean;
  }[];
  wheelLog: { ctrl: boolean; meta: boolean; deltaY: number; defaultPrevented: boolean }[];
};

type LineButton = {
  testid: string | null;
  value: string | null;
  pressed: string | null;
  active: boolean;
  label: string;
};

type SettingsSample = {
  view: string | null;
  panelTitle: string;
  navLabels: string[];
  navChatDisplayActive: boolean;
  labels: string[];
  zoom: {
    value: string | null;
    inPresent: boolean;
    outPresent: boolean;
    resetPresent: boolean;
    inDisabled: boolean | null;
    outDisabled: boolean | null;
  };
  preview: {
    present: boolean;
    dataZoom: string | null;
    dataLineSpacing: string | null;
    readingScale: string;
    readingLine: string;
    proseFontPx: number | null;
    proseLinePx: number | null;
    proseRatio: number | null;
  } | null;
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
  dockLink: ChatSample["link"];
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

    // ── 5. the dock's door into Settings → Chat display ────────────────────
    const link = report.dockLink;
    assert.ok(link, 'the dock has no [data-testid="chat-display-settings"] link');
    assert.equal(link!.present, true, "the dock's settings link is not present");
    assert.equal(
      link!.tag,
      "A",
      `the dock's settings entrance is a ${link!.tag}, not a link`,
    );
    assert.equal(
      link!.ariaLabel,
      "Chat display settings",
      `the link's accessible name is ${JSON.stringify(link!.ariaLabel)}`,
    );
    assert.match(
      link!.href ?? "",
      /^\/settings\?tab=reading/,
      `the link's href is ${JSON.stringify(link!.href)}, expected /settings?tab=reading`,
    );
    assert.equal(
      link!.insideActionBar,
      true,
      "the settings link is not in the dock's bottom action bar",
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
      report.artifacts.settings.path.endsWith(SETTINGS_SHOT),
      true,
      `the settings screenshot is ${report.artifacts.settings.path}, expected ${SETTINGS_SHOT}`,
    );
    for (const shot of [report.artifacts.dock, report.artifacts.settings]) {
      assert.equal(fs.existsSync(shot.path), true, `screenshot missing: ${shot.path}`);
      assert.ok(shot.bytes > 0, `screenshot is empty: ${shot.path}`);
    }
  });
});
