import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Daily Note focus mode, rendered by the real page in a real layout engine.
 *
 * The claims themselves live in `e2e/daily-note-focus.electron.mjs`, which drives
 * the existing daily-note harness; this file runs that driver and refuses a
 * report that does not hold. The report is the repeatable artifact:
 * `e2e/artifacts/daily-note-focus.json` plus `daily-note-focus.png`, the picture
 * of the shipped surface.
 *
 * A skipped rig is evidence of nothing, so with the Vite dev server down this
 * test skips rather than passing.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/daily-note-focus.json");
const SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note-focus.png");
/** The sheet's narrow measure: 40rem at the app's 16px root. */
const PANEL_MEASURE = 40 * 16;

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type Centre = { x: number; y: number };
type TriggerSample =
  | { present: false }
  | {
      present: true;
      tag: string;
      box: Box;
      centre: Centre;
      ariaLabel: string | null;
      titleAttr: string | null;
      text: string;
      svg: boolean;
      svgBox: Box | null;
      disabled: boolean;
      inHeader: boolean;
      inTitleRow: boolean;
      inActions: boolean;
      domImmediatelyBeforeAutomations: boolean;
    };
type AutomationsSample = {
  present: boolean;
  box: Box | null;
  centre: Centre | null;
  analyzeBox: Box | null;
  analyzeTestId: string | null;
};
type OverlaySample = {
  present: true;
  className: string;
  dataFocusOverlay: boolean;
  dataSheetOverlay: boolean;
  box: Box;
  position: string;
  zIndex: string;
  backdropFilter: string | null;
  background: string;
};
type Sample = {
  path: string;
  viewport: { width: number; height: number };
  bodyOverflowStyle: string;
  pageMounted: boolean;
  railMounted: boolean;
  pageEditorMounted: boolean;
  pageEditorOpenLine: boolean;
  pageEditorBody: string | null;
  trigger: TriggerSample;
  automations: AutomationsSample;
  titleRow: Box | null;
  overlay: OverlaySample | null;
  panel:
    | { box: Box; centre: Centre; className: string; inOverlay: boolean }
    | null;
  chrome: { box: Box; inPanel: boolean; borderBottom: string } | null;
  title: {
    box: Box;
    centre: Centre;
    text: string;
    inPanel: boolean;
    topOffset: number | null;
  } | null;
  close: {
    box: Box;
    centre: Centre;
    ariaLabel: string | null;
    titleAttr: string | null;
    inPanel: boolean;
    topOffset: number | null;
  } | null;
  body: { box: Box; inPanel: boolean } | null;
  note: { box: Box; inPanel: boolean } | null;
  editor: {
    box: Box;
    className: string;
    noteLive: boolean;
    inNote: boolean;
    inPanel: boolean;
    inputValue: string | null;
  } | null;
  focusInput: { value: string; focused: boolean; ariaLabel: string | null } | null;
  noteLiveInsideOverlay: number;
  writes: number;
  unexpectedCalls: string[];
};

/** A write to the vault, with the day the page was showing when it made it. */
type Write = { date: string; body: string; shown: string | null };

type Report = {
  url: string;
  ranAt: string;
  window: { width: number; height: number };
  fixture: { sentence: string };
  checks: { today?: string; writes?: Write[] };
  states: Record<string, Sample>;
  steps: {
    triggerPresent?: boolean;
    openedClick?: boolean;
    crossClick?: boolean;
    scrimPoint?: { x: number; y: number };
    scrimHit?: {
      hit: string | null;
      tag?: string;
      isOverlay: boolean;
      isPanel: boolean;
    } | null;
    escapeSent?: boolean;
    typedLineOpen?: boolean;
    typed?: { value: string; focused: boolean } | null;
    focusWrite?: Write | null;
    screenshot?: {
      file: string;
      bytes: number;
      width: number;
      height: number;
      whileOpen: boolean;
    } | null;
    screenshotWhileOpen?: boolean;
    closeAfterTypingSent?: boolean;
  };
  screenshots: string[];
  consoleErrors: string[];
  unexpectedCalls: string[];
  failures: string[];
  pass: boolean;
};

/** Alpha of a computed colour: 1 when it carries none. */
function alphaOf(color: string | null): number {
  const raw = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return raw.length >= 4 ? raw[3]! : 1;
}

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

/**
 * The suite's own runner (`scripts/test.mjs`) strips `ELECTRON_RUN_AS_NODE`, but
 * a direct `node --experimental-strip-types --test` does not: without this env
 * the spawned "electron" runs as plain node, dies in ~200ms and never opens a
 * window. Strip it here so both entry points run the same rig.
 */
function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/daily-note-focus.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000, env },
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

/** The gap between two boxes' facing edges, in viewport pixels. */
function edgeGap(left: Box, right: Box): number {
  return right.left - left.right;
}

describe("daily note focus mode", () => {
  it("opens the day's note alone over the blurred page, and writes the same draft", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const sentence = report.fixture.sentence;
    const today = report.checks.today;
    assert.ok(today, "the harness named no today");
    assert.equal(report.window.width, 1280, "the report was measured in a window other than 1280px");

    const {
      landing,
      opened,
      closedByCross,
      reopenedForScrim,
      closedByScrim,
      reopenedForEscape,
      closedByEscape,
      reopenedForTyping,
      typedModal,
      savedByFocus,
      pageAfterFocus,
    } = report.states;

    // ── 1. the trigger: in the header's title row, directly before Analyze ───
    // Falsifiable from the DOM order and the rendered boxes: it must be a button
    // (not a word or an icon), carry the label the operator was told it has, and
    // sit no more than the row's own gap away from the automations on its right.
    assert.ok(landing.trigger.present, "the page draws no focus-mode trigger");
    if (!landing.trigger.present) return;
    const trigger = landing.trigger;
    assert.equal(trigger.tag, "BUTTON", `the trigger is a ${trigger.tag}, not a button`);
    assert.equal(trigger.ariaLabel, "Focus mode", "the trigger is not labelled Focus mode");
    assert.match(
      String(trigger.titleAttr),
      /Focus mode/,
      `the trigger wears ${JSON.stringify(trigger.titleAttr)} as its title`,
    );
    assert.equal(trigger.svg, true, "the icon-only trigger carries no icon");
    // Presence is not visibility. The icon has to paint at its own size inside
    // the key: a padding override from the primitive once squeezed the 16px icon
    // to 0.39px, leaving a button that looked like an empty square.
    assert.ok(trigger.svgBox, "the trigger's icon box could not be measured");
    assert.ok(
      (trigger.svgBox?.width ?? 0) > 12 && (trigger.svgBox?.height ?? 0) > 12,
      `the trigger's icon measures ${trigger.svgBox?.width}x${trigger.svgBox?.height} — squeezed out of view`,
    );
    assert.ok(
      trigger.svgBox!.left >= trigger.box.left &&
        trigger.svgBox!.top >= trigger.box.top &&
        trigger.svgBox!.right <= trigger.box.right &&
        trigger.svgBox!.bottom <= trigger.box.bottom,
      "the trigger's icon paints outside its own button",
    );
    assert.ok(
      trigger.box.width >= 30 && trigger.box.height >= 30,
      `the icon-only trigger's box is ${trigger.box.width}x${trigger.box.height}, smaller than a key`,
    );
    assert.equal(trigger.text, "", `the trigger prints words: ${JSON.stringify(trigger.text)}`);
    assert.equal(trigger.inHeader, true, "the trigger is not inside .daily-note__header");
    assert.equal(trigger.inTitleRow, true, "the trigger is not on the title row");
    assert.equal(trigger.inActions, true, "the trigger is outside the title row's action cluster");
    assert.equal(
      trigger.domImmediatelyBeforeAutomations,
      true,
      "the automations are not the trigger's next sibling — Analyze note is not immediately right of it",
    );
    assert.equal(trigger.disabled, false, "the trigger is disabled on a loaded day");

    assert.equal(landing.automations.present, true, "Analyze note's container is not on the page");
    assert.ok(landing.automations.analyzeBox, "Analyze note's button could not be measured");
    // On the heading's row: same vertical band as the automations cluster.
    const rowDelta = Math.abs(
      trigger.centre.y - (landing.automations.centre?.y ?? Number.NaN),
    );
    assert.ok(
      rowDelta <= 6,
      `the trigger is ${rowDelta}px off Analyze note's row`,
    );
    assert.ok(
      edgeGap(trigger.box, landing.automations.box!) >= 0,
      "the trigger is not left of the automations",
    );
    const gap = edgeGap(trigger.box, landing.automations.box!);
    assert.ok(
      gap <= 12.5,
      `the trigger sits ${gap}px from Analyze note — not immediately left of it`,
    );
    // The page behind is where it was, and no sheet was up before the press.
    assert.equal(landing.overlay, null, "a sheet was open on arrival");
    assert.notEqual(landing.bodyOverflowStyle, "hidden", "the page was locked before the press");
    assert.equal(landing.pageMounted, true, "the daily-note page is missing at landing");
    assert.equal(landing.railMounted, true, "the nav rail is missing at landing");

    // ── 2. the sheet: the shared frame, at the Daily Note's measure ──────────
    assert.equal(report.steps.openedClick, true, "the rig could not press the trigger");
    assert.ok(opened.overlay, "pressing the trigger painted no focus sheet");
    if (!opened.overlay) return;
    assert.equal(opened.overlay.dataFocusOverlay, true, "the root is not marked data-focus-overlay");
    assert.equal(opened.overlay.dataSheetOverlay, true, "the root does not use the shared sheet frame");
    assert.match(opened.overlay.className, /focus-overlay/, "the root does not wear the focus sheet class");
    assert.equal(opened.overlay.position, "fixed", "the scrim is not fixed over the window");
    assert.equal(
      opened.bodyOverflowStyle,
      "hidden",
      "the page behind still scrolls while the sheet is up",
    );
    // The page behind stays mounted so closing hands it back; a sheet that
    // replaced the page would have nothing to return to.
    assert.equal(opened.pageMounted, true, "the daily-note page left the DOM behind the sheet");
    assert.equal(opened.railMounted, true, "the nav rail left the DOM behind the sheet");
    assert.equal(opened.pageEditorMounted, true, "the page's editor left the DOM behind the sheet");

    const panel = opened.panel;
    assert.ok(panel, "the sheet painted no .focus-overlay__panel");
    if (!panel) return;
    assert.equal(panel.inOverlay, true, "the panel is not inside the focus overlay");
    // The narrow measure is absolute (40rem) and a cap, not a share: at 1280px
    // that is half the window, so "<= 60%" alone would pass a 700px box.
    assert.ok(
      Math.abs(panel.box.width - PANEL_MEASURE) <= 2,
      `the panel is ${panel.box.width}px wide, not its 40rem (${PANEL_MEASURE}px) measure`,
    );
    assert.ok(
      panel.box.width <= 700,
      `the panel is ${panel.box.width}px wide — wider than a narrow writing column`,
    );
    assert.ok(
      panel.box.width <= opened.viewport.width * 0.6,
      `the panel is ${((panel.box.width / opened.viewport.width) * 100).toFixed(1)}% of the window — not narrow`,
    );
    assert.ok(
      Math.abs(panel.centre.x - opened.viewport.width / 2) <= 2,
      `the panel is centred at ${panel.centre.x}, not the window's ${opened.viewport.width / 2}`,
    );

    // The title is the page's own name, centred over the panel, at its top.
    const title = opened.title;
    assert.ok(title, "the sheet draws no .sheet-overlay__title");
    if (!title) return;
    assert.equal(title.text, "Daily Note", `the sheet's title reads ${JSON.stringify(title.text)}`);
    assert.equal(title.inPanel, true, "the title is outside the panel");
    assert.ok(
      Math.abs(title.centre.x - panel.centre.x) <= 2,
      `the title is centred at ${title.centre.x}, ${title.centre.x - panel.centre.x}px from the panel's ${panel.centre.x}`,
    );
    assert.ok(
      (title.topOffset ?? Number.NaN) >= 0 && (title.topOffset ?? Number.NaN) <= 40,
      `the title sits ${title.topOffset}px from the panel's top`,
    );

    // The chrome is the panel's own, and the cross is in its top-right corner.
    assert.ok(opened.chrome, "the sheet draws no .focus-overlay__chrome");
    assert.equal(opened.chrome?.inPanel, true, "the chrome is outside the panel");
    assert.ok(
      (opened.chrome?.box.top ?? Number.NaN) - panel.box.top <= 2,
      "the chrome does not sit at the panel's top",
    );
    const close = opened.close;
    assert.ok(close, "the sheet draws no .focus-overlay__close");
    if (!close) return;
    assert.equal(close.ariaLabel, "Close focus mode", "the cross is not labelled Close focus mode");
    assert.equal(close.inPanel, true, "the cross is outside the panel");
    assert.ok(
      close.centre.x > panel.centre.x,
      `the cross sits at ${close.centre.x}, on the leading half of a panel centred at ${panel.centre.x}`,
    );
    assert.ok(
      (close.topOffset ?? Number.NaN) <= 40,
      `the cross sits ${close.topOffset}px down the panel — not in its top-right`,
    );
    assert.ok(
      close.box.top >= panel.box.top &&
        close.box.right <= panel.box.right &&
        close.box.bottom <= panel.box.bottom,
      `the cross is not inside the panel: ${close.box.left},${close.box.top} vs ${panel.box.left},${panel.box.top}`,
    );

    // The surface is the shared note editor and nothing else: exactly one
    // `.note-live` in the sheet, inside `.focus-overlay__note`.
    assert.ok(opened.body, "the sheet draws no .focus-overlay__body");
    assert.equal(opened.body?.inPanel, true, "the sheet's body is outside the panel");
    assert.ok(opened.note, "the sheet draws no .focus-overlay__note");
    assert.ok(opened.editor, "the sheet draws no [data-testid=daily-note-focus-editor]");
    if (!opened.editor) return;
    assert.equal(opened.editor.noteLive, true, "the focus editor is not a .note-live box");
    assert.equal(opened.editor.inNote, true, "the focus editor is outside .focus-overlay__note");
    assert.equal(opened.editor.inPanel, true, "the focus editor is outside the panel");
    assert.ok(
      opened.editor.box.width > 0 && opened.editor.box.height > 0,
      `the focus editor measured ${opened.editor.box.width}x${opened.editor.box.height}`,
    );
    assert.equal(
      opened.noteLiveInsideOverlay,
      1,
      `the sheet draws ${opened.noteLiveInsideOverlay} note boxes, expected exactly 1`,
    );

    // The scrim is the app stepped back: blurred and dimmed, not opaque.
    assert.match(
      String(opened.overlay.backdropFilter),
      /blur\(/,
      `the page behind is not blurred: "${opened.overlay.backdropFilter}"`,
    );
    assert.ok(
      alphaOf(opened.overlay.background) < 1,
      `the scrim is opaque: ${opened.overlay.background}`,
    );

    // ── 3. three dismissals, each measured where it landed ───────────────────
    // The cross.
    assert.equal(report.steps.crossClick, true, "the cross could not be pressed");
    assert.equal(closedByCross.overlay, null, "the cross did not close the sheet");
    assert.notEqual(closedByCross.bodyOverflowStyle, "hidden", "closing left the page locked");
    assert.equal(closedByCross.pageMounted, true, "closing lost the page behind");
    assert.ok(closedByCross.trigger.present, "closing lost the trigger that opened the sheet");

    // The scrim: the press must start on the overlay itself. A point outside the
    // panel is computed from the panel's own box, and the element actually hit
    // is recorded, so a press that landed on the panel fails here rather than
    // passing as a dismissal.
    assert.ok(reopenedForScrim.overlay, "the sheet could not be reopened for the scrim press");
    const scrimHit = report.steps.scrimHit;
    assert.ok(scrimHit && scrimHit.hit !== null, "the scrim press hit nothing");
    assert.equal(scrimHit?.isOverlay, true, `the scrim press landed on ${scrimHit?.hit}, not the overlay`);
    assert.equal(scrimHit?.isPanel, false, "the scrim press landed on the panel");
    const point = report.steps.scrimPoint;
    assert.ok(point, "the rig computed no scrim point");
    assert.ok(
      point!.x > 0 && point!.x < reopenedForScrim.viewport.width && point!.y > 0 && point!.y < reopenedForScrim.viewport.height,
      `the scrim point ${point!.x},${point!.y} is outside the window`,
    );
    assert.equal(closedByScrim.overlay, null, "the scrim press did not close the sheet");

    // Escape.
    assert.ok(reopenedForEscape.overlay, "the sheet could not be reopened for Escape");
    assert.equal(report.steps.escapeSent, true, "the rig did not dispatch Escape");
    assert.equal(closedByEscape.overlay, null, "Escape did not close the sheet");
    assert.equal(closedByEscape.pageMounted, true, "Escape lost the page behind");

    // ── 4. typing in the modal writes the same draft, for the shown day ──────
    assert.ok(reopenedForTyping.overlay, "the sheet could not be reopened for typing");
    assert.equal(report.steps.typedLineOpen, true, "the modal editor never opened a writing line");
    assert.ok(report.steps.typed, "the rig never typed into the modal editor");
    assert.equal(
      report.steps.typed?.value,
      sentence,
      "the modal editor did not take the sentence",
    );
    assert.equal(report.steps.typed?.focused, true, "the modal editor never took the caret");
    assert.ok(typedModal.overlay, "the modal closed while the sentence was being typed");
    assert.equal(
      typedModal.focusInput?.value,
      sentence,
      "the modal editor's line did not hold the sentence",
    );

    // The write is read from the harness's own ledger: the day must be today's,
    // the body must be what was typed, and the page must have been showing that
    // day when it wrote — prose carried onto another date is the one way an
    // autosave can lose a day.
    const written = report.steps.focusWrite;
    assert.ok(written, "the sentence typed in focus mode never reached the autosave ledger");
    if (written) {
      assert.equal(written.date, today, "focus mode wrote a day other than the one on screen");
      assert.equal(written.shown, today, "focus mode wrote prose while the page showed another day");
      assert.match(written.body, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal(report.steps.screenshotWhileOpen, true, "the picture was not captured with the sheet open");
    assert.equal(savedByFocus.overlay !== null, true, "the sheet closed itself while the save landed");

    // ── 5. closing hands the typed draft back to the page editor ─────────────
    assert.equal(pageAfterFocus.overlay, null, "the final close left the sheet mounted");
    assert.equal(pageAfterFocus.pageEditorMounted, true, "the page's editor is gone after closing");
    assert.match(
      String(pageAfterFocus.pageEditorBody),
      new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `the page editor behind does not hold the typed sentence: ${JSON.stringify(pageAfterFocus.pageEditorBody)}`,
    );
    assert.notEqual(pageAfterFocus.bodyOverflowStyle, "hidden", "the page stayed locked after closing");

    // ── 6. nothing unmodelled, nothing on fire, and the picture exists ────────
    assert.deepEqual(report.unexpectedCalls, [], "the page reached unmodelled bridge methods");
    assert.deepEqual(report.consoleErrors, [], "the run logged a console error");

    assert.ok(report.screenshots.includes("daily-note-focus.png"), "the run recorded no screenshot");
    assert.equal(fs.existsSync(SHOT), true, "driver captured no screenshot");
    const png = fs.readFileSync(SHOT);
    assert.ok(png.length > 10_000, `the screenshot is only ${png.length} bytes`);
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "the screenshot is not a PNG",
    );
    const shotWidth = png.readUInt32BE(16);
    const shotHeight = png.readUInt32BE(20);
    assert.ok(
      shotWidth >= 1200 && shotHeight >= 850,
      `the screenshot is ${shotWidth}x${shotHeight}, not the 1280x900 window`,
    );
    const shotInfo = report.steps.screenshot;
    assert.ok(shotInfo, "the report carries no screenshot measurement");
    assert.equal(shotInfo?.file, "daily-note-focus.png");
    assert.equal(shotInfo?.bytes, png.length, "the reported screenshot size does not match the file");
    assert.equal(shotInfo?.whileOpen, true, "the screenshot was not taken with the sheet open");
  });
});
