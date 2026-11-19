/**
 * The dock's chrome: the thread's name chip, the composer's side gutters and the
 * agent switcher's two homes.
 *
 * The rig (`e2e/dock-chrome.electron.mjs`) drives the shared chat-panel harness
 * page in a real Electron window — the shipping dock, sidebar, provider stack
 * and CSS, with the IPC bridge stubbed — and measures the layout engine's own
 * boxes at a ladder of dock widths. This wrapper re-reads the report the rig
 * wrote and restates every number the suite depends on, so a regression names
 * the field it broke instead of only "the driver said pass: false". The rig is
 * the only one that opens the page with `?agents=1`, so the real switcher draws.
 *
 * The concerns live here because they are one surface and one page:
 *
 *  1. the name row is the name itself: a borderless, fill-less, neutral-gray
 *     button hanging flush under the tab strip and centred on the dock, with no
 *     pencil. Clicking it opens a bare rename field in its own place — no Save or
 *     Cancel keys — that saves on blur and on Enter, cancels on Escape without a
 *     write, and opens from the tab menu's Rename too;
 *  2. the composer box is inset by a gutter that grows with the dock (12px
 *     floor, a linear climb, a 12.5% cap), symmetric and non-decreasing;
 *  3. the agent switcher stands in that right-hand gutter when the dock is
 *     wide, and steps just above the composer form when it is narrow (anchored
 *     to the form, not the band, so the band's cards and notices cannot push it
 *     up over the transcript), switched by a container query on the footer;
 *  4. the transcript's text column keeps the composer box's measure: the same
 *     gutter on each side (the trailing one giving back the reserved scrollbar's
 *     0.5rem), with the message rows filling that column — their union covering
 *     its edges and no row escaping it, whichever side each role's bubble sits
 *     on.
 *
 * The page mounts the real sidebar beside the dock and the real provider stack,
 * so this is the app's own layout — not a mock of it.
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
const REPORT = path.join(desktopRoot, "e2e/artifacts/dock-chrome.json");

/** The two pictures the rig writes beside the report. */
const WIDE_SHOT = "dock-chrome-wide.png";
const NARROW_SHOT = "dock-chrome-narrow.png";

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
      [path.join(desktopRoot, "e2e/dock-chrome.electron.mjs")],
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

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type Switcher = {
  rect: Box;
  position: string;
  role: string | null;
  ariaLabel: string | null;
  /** True: the form is inside the band, so the band still contains it. */
  insideFooter: boolean;
  /** The claim: the switcher is a child of the composer form, not the band. */
  insideComposerForm: boolean;
  pillCount: number;
  pills: { name: string | null; active: string | null; disabled: boolean }[];
  centrePx: number;
  centreVsGutterCentrePx: number;
  leftOfComposerGapPx: number;
  rightInsetPx: number;
  bottomVsComposerBoxBottomPx: number;
  bottomVsComposerBoxTopPx: number | null;
  bottomVsComposerFormTopPx: number | null;
  intersectsComposerBox: boolean | null;
  bottomVsFooterTopPx: number | null;
  insidePanel: boolean;
};

type Sample = {
  width: number;
  mode: "wide" | "narrow";
  chatSurface: string | null;
  panel: Box;
  columnWidthPx: number | null;
  shellFramePx: number;
  gutterLeftPx: number | null;
  gutterRightPx: number | null;
  gutterAveragePx: number | null;
  gutterExpectedPx: number;
  gutterDeltaPx: number | null;
  composerForm: Box | null;
  composerBox: Box | null;
  composerWidthRatio: number | null;
  hasStrip: boolean;
  hasHeader: boolean;
  headerTopVsStripBottomPx: number | null;
  chipTopVsStripBottomPx: number | null;
  chipCentreVsPanelCentrePx: number | null;
  tabTitle: string | null;
  chip: {
    rect: Box;
    display: string;
    tag: string;
    role: string | null;
    ariaLabel: string | null;
    text: string;
    hasSvg: boolean;
    cursor: string;
    color: string;
    background: string;
    borderWidthsPx: {
      top: number | null;
      right: number | null;
      bottom: number | null;
      left: number | null;
    };
    borderStyles: {
      top: string;
      right: string;
      bottom: string;
      left: string;
    };
    borderRadius: string;
    outlineWidthPx: number | null;
    fontSizePx: number | null;
    insideRow: boolean;
    containsLabel: boolean;
  } | null;
  label: {
    rect: Box;
    text: string;
    classes: string;
    fontSizePx: number | null;
    fontWeight: string;
    color: string;
    hasSvg: boolean;
    tag: string;
  } | null;
  /** The retired pencil's control, if a regression ever brings it back. */
  edit: {
    rect: Box;
    tag: string;
    hasSvg: boolean;
    ariaLabel: string | null;
    insideChip: boolean;
    afterLabel: boolean;
    insidePanel: boolean;
  } | null;
  /** How many `.chat-panel__name-edit` controls the page still carries. */
  nameEditClassCount: number;
  footer: {
    rect: Box;
    containerType: string;
    position: string;
    paddingLeftPx: number | null;
    paddingRightPx: number | null;
  } | null;
  switcher: Switcher | null;
};

type DockChromeReport = {
  pass: boolean;
  failures: string[];
  url: string;
  window: { width: number; height: number };
  tolerances: {
    gutterPx: number;
    gutterSymmetryPx: number;
    chipTopPx: number;
    chipCentrePx: number;
    chipFontMinPx: number;
    chipFontMaxPx: number;
    chipContrastMargin: number;
    switcherCentrePx: number;
    switcherBottomPx: number;
    switcherRightPx: number;
    narrowRightInsetPx: number;
    narrowComposerGapPx: number;
    narrowGapTolerancePx: number;
    composerNarrowRatioMin: number;
    composerWideRatioMax: number;
    wideModeMinWidth: number;
  };
  widths: number[];
  expectedGutters: { width: number; expectedPx: number }[];
  samples: Sample[];
  gutters: {
    widths: number[];
    expectedPx: number[];
    measuredLeftPx: (number | null)[];
    measuredRightPx: (number | null)[];
    measuredAveragePx: (number | null)[];
    monotonic: boolean;
    tolerancePx: number;
    symmetryTolerancePx: number;
    narrowRatio: { width: number; value: number | null; min: number };
    wideRatio: { width: number; value: number | null; max: number };
  };
  /**
   * The operator's request measured: the transcript's text column against the
   * composer box at every rung of the dock ladder. Content geometry is read the
   * way the browser lays it out — clientWidth already excludes the reserved
   * scrollbar — so a trailing padding that forgets that bar shows up as a right
   * edge inside the composer's.
   */
  transcriptColumn: {
    present: boolean;
    bodyScrollbarGutter: string | null;
    tolerancePx: number;
    narrowTolerancePx: number;
    samples: {
      width: number;
      panelWidthPx: number;
      composerBox: { left: number; right: number; width: number } | null;
      content: { left: number; right: number; width: number } | null;
      body: {
        left: number | null;
        right: number | null;
        width: number | null;
        clientWidthPx: number | null;
        scrollbarWidthPx: number | null;
        paddingLeftPx: number | null;
        paddingRightPx: number | null;
        scrollbarGutter: string | null;
      } | null;
      leftDeltaPx: number | null;
      rightDeltaPx: number | null;
      widthDeltaPx: number | null;
      /** The message rows as a block: the second witness that the text, not just
       *  the padding, sits in the column. Role-agnostic on purpose — which side
       *  the operator's bubble is on belongs to the transcript, not this rig. */
      messages: {
        leftDeltaPx: number | null;
        rightDeltaPx: number | null;
        rowCount: number;
        rowsLeftDeltaPx: number | null;
        rowsRightDeltaPx: number | null;
        rowsOutsideLeftPx: number | null;
        rowsOutsideRightPx: number | null;
      } | null;
      messagesPresent: boolean;
    }[];
  };
  chip: {
    present: boolean;
    stripPresent: boolean;
    headerPresent: boolean;
    rect: Box | null;
    display: string | null;
    tag: string | null;
    role: string | null;
    ariaLabel: string | null;
    text: string | null;
    hasSvg: boolean | null;
    cursor: string | null;
    color: string | null;
    background: string | null;
    borderWidthsPx: {
      top: number | null;
      right: number | null;
      bottom: number | null;
      left: number | null;
    } | null;
    borderStyles: {
      top: string;
      right: string;
      bottom: string;
      left: string;
    } | null;
    borderRadius: string | null;
    outlineWidthPx: number | null;
    fontSizePx: number | null;
    labelText: string | null;
    labelColor: string | null;
    tabTitle: string | null;
    labelClasses: string | null;
    labelFontSizePx: number | null;
    headerTopVsStripBottomPx: number | null;
    topVsStripBottomPx: number | null;
    centreVsPanelCentrePx: number | null;
    insidePanel: boolean;
    insideRow: boolean;
    containsLabel: boolean;
    editPresent: boolean;
    editTag: string | null;
    editHasSvg: boolean | null;
    nameEditClassCount: number;
    widthPx: number | null;
    heightPx: number | null;
    /** The colour claim: resolved colours and their contrast against the dock. */
    colors: {
      chip: string | null;
      chipLuminance: number | null;
      chipContrast: number | null;
      mutedToken: string | null;
      mutedLuminance: number | null;
      ink: string | null;
      inkLuminance: number | null;
      inkContrast: number | null;
      roleLabel: string | null;
      roleLabelLuminance: number | null;
      panelBackground: string | null;
      panelLuminance: number | null;
    };
  };
  rename: {
    opened: {
      fieldPresent: boolean;
      value: string | null;
      title: string | null;
      fieldTag: string | null;
      inForm: boolean;
      formInRow: boolean;
      formButtonCount: number;
      chipHidden: boolean;
    };
    escape: {
      fieldClosed: boolean;
      chipBack: boolean;
      labelText: string | null;
      patchesBefore: number;
      patchesAfter: number;
      patchDelta: number;
      usedRecovery: string | null;
    };
    blur: {
      typedTitle: string;
      committed: boolean;
      patchLanded: boolean;
      patch: { id: string; patch: { title?: string } } | null;
      fieldClosed: boolean;
      labelText: string | null;
      patchesBefore: number;
      patchDelta: number;
    };
    enter: {
      typedTitle: string;
      enterCommitted: boolean;
      usedBlurFallback: boolean;
      patchLanded: boolean;
      patch: { id: string; patch: { title?: string } } | null;
      fieldClosed: boolean;
      labelText: string | null;
      tabTitle: string | null;
      patchesBefore: number;
      patchDelta: number;
      chipWidthBeforePx: number | null;
      chipWidthAfterPx: number | null;
      chipGrew: boolean;
      topVsStripBottomPx: number | null;
      centreVsPanelCentrePx: number | null;
      insidePanel: boolean;
      insidePanelAt360: boolean;
      chipWidthAt360Px: number | null;
    };
    tabMenu: {
      tabFound: boolean;
      menuOpened: boolean;
      itemClicked: boolean;
      fieldPresent: boolean;
      value: string | null;
      expectedTitle: string;
      fieldTag: string | null;
      inForm: boolean;
      formInRow: boolean;
      fieldClosed: boolean;
      patchesBefore: number;
      patchDelta: number;
      labelText: string | null;
    };
  };
  footer: {
    containerType: string;
    isSizeContainer: boolean;
    position: string;
    paddingLeftPx: number | null;
    paddingRightPx: number | null;
  } | null;
  agentSwitcher: {
    present: boolean;
    role: string | null;
    insideFooter: boolean | null;
    insideComposerForm: boolean | null;
    pillCount: number;
    pills: { name: string | null; active: string | null; disabled: boolean }[];
    wide: {
      width: number;
      present: boolean;
      noOverlap: boolean | null;
      composerGapPx: number | null;
      centreDeltaPx: number | null;
      rightInsetPx: number | null;
      bottomVsComposerBoxPx: number | null;
      insidePanel: boolean | null;
    }[];
    narrow: {
      width: number;
      present: boolean;
      aboveComposerBox: boolean | null;
      bottomVsComposerBoxTopPx: number | null;
      bottomVsComposerFormTopPx: number | null;
      intersectsComposerBox: boolean | null;
      insideComposerForm: boolean | null;
      rightInsetPx: number | null;
      rightInsetDeltaPx: number | null;
    }[];
  };
  screenshots: {
    wide: { path: string; bytes: number };
    narrow: { path: string; bytes: number };
  };
  marks: { ms: number; label: string }[];
};

/**
 * The dock-chrome rig measures the real dock in a real layout engine, so it
 * needs the Vite dev server; with the server down the test skips and
 * `npm run dev` in another shell turns it on. A skipped rig is evidence of
 * nothing, so the wrapper only ever reports a run whose report artifact exists.
 */
describe("dock chrome", () => {
  it("hangs the name chip under the tab strip and grows the composer's gutters", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as DockChromeReport;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The ladder was actually driven and every rung measured: a skipped width
    // would hide a gutter that only breaks at one dock size.
    assert.deepEqual(
      report.samples.map((sample) => sample.width),
      report.widths,
      "the rig did not sample every dock width in its ladder",
    );
    assert.equal(report.samples.length, report.widths.length);

    // ── 2. the composer's gutters ───────────────────────────────────────────
    // Each width is measured against the contract's own curve, on both sides
    // and against its own mirror, so a one-sided or wrongly-signed gutter names
    // the width it broke at.
    for (const sample of report.samples) {
      assert.ok(
        sample.columnWidthPx !== null && Math.abs(sample.columnWidthPx - sample.width) <= 0.5,
        `the dock's column measured ${sample.columnWidthPx}px for a ${sample.width}px drive — ` +
          `--chatbar-width did not resolve into the shell's track`,
      );
      assert.ok(
        sample.gutterLeftPx !== null &&
          Math.abs(sample.gutterLeftPx - sample.gutterExpectedPx) <= report.tolerances.gutterPx,
        `left gutter at ${sample.width}px is ${sample.gutterLeftPx}px, expected ` +
          `${sample.gutterExpectedPx}px ± ${report.tolerances.gutterPx}`,
      );
      assert.ok(
        sample.gutterRightPx !== null &&
          Math.abs(sample.gutterRightPx - sample.gutterExpectedPx) <= report.tolerances.gutterPx,
        `right gutter at ${sample.width}px is ${sample.gutterRightPx}px, expected ` +
          `${sample.gutterExpectedPx}px ± ${report.tolerances.gutterPx}`,
      );
      assert.ok(
        sample.gutterLeftPx !== null &&
          sample.gutterRightPx !== null &&
          Math.abs(sample.gutterLeftPx - sample.gutterRightPx) <=
            report.tolerances.gutterSymmetryPx,
        `the composer's gutter is asymmetric at ${sample.width}px: ` +
          `left ${sample.gutterLeftPx}px / right ${sample.gutterRightPx}px`,
      );
    }
    // G3 — a gutter that narrows as the dock grows is the wrong sign in the
    // calc, and no single width would catch it.
    for (let i = 1; i < report.samples.length; i += 1) {
      const previous = report.samples[i - 1]!;
      const current = report.samples[i]!;
      assert.ok(
        previous.gutterAveragePx !== null &&
          current.gutterAveragePx !== null &&
          current.gutterAveragePx >= previous.gutterAveragePx - 0.1,
        `the gutter fell as the dock grew: ${previous.width}px → ` +
          `${previous.gutterAveragePx}px, then ${current.width}px → ${current.gutterAveragePx}px`,
      );
    }
    assert.equal(report.gutters.monotonic, true, "the gutter ladder is not monotonic");
    // G4, G5 — the two ends of the ladder. Narrow keeps the composer nearly
    // full-width; wide leaves real gaps.
    assert.ok(
      report.gutters.narrowRatio.value !== null &&
        report.gutters.narrowRatio.value >= report.gutters.narrowRatio.min,
      `composer/panel is ${report.gutters.narrowRatio.value} at ${report.gutters.narrowRatio.width}px ` +
        `(min ${report.gutters.narrowRatio.min})`,
    );
    assert.ok(
      report.gutters.wideRatio.value !== null &&
        report.gutters.wideRatio.value <= report.gutters.wideRatio.max,
      `composer/panel is ${report.gutters.wideRatio.value} at ${report.gutters.wideRatio.width}px ` +
        `(max ${report.gutters.wideRatio.max})`,
    );

    // ── 2. the transcript's text column ─────────────────────────────────────
    // The operator's request: on a wide dock the transcript's padding is the
    // composer's measure, so the text runs the composer box's width. Restated
    // per width here so a regression names the rung it broke at.
    assert.equal(
      report.transcriptColumn.present,
      true,
      "the thread transcript body or its content box was not measurable",
    );
    // T3 — the scrollbar's space is reserved by the scroller itself, so the
    // column does not change width as the conversation grows.
    assert.equal(
      report.transcriptColumn.bodyScrollbarGutter,
      "stable",
      `the transcript scroller's scrollbar-gutter is ${report.transcriptColumn.bodyScrollbarGutter}, not stable`,
    );
    assert.deepEqual(
      report.transcriptColumn.samples.map((entry) => entry.width),
      report.widths,
      "the transcript column was not measured at every dock width",
    );
    for (const entry of report.transcriptColumn.samples) {
      // T5 — the 300px floor is the one rung where the body's 0.875rem minimum
      // outruns the composer's 12px gutter; the column may be up to 4px narrower
      // there. Every other rung must align within 2px.
      const tolerance =
        entry.width === 300
          ? report.transcriptColumn.narrowTolerancePx
          : report.transcriptColumn.tolerancePx;
      assert.ok(
        entry.leftDeltaPx !== null && Math.abs(entry.leftDeltaPx) <= tolerance,
        `the transcript's text starts ${entry.leftDeltaPx}px from the composer box's left at ` +
          `${entry.width}px (tolerance ${tolerance}px)`,
      );
      assert.ok(
        entry.rightDeltaPx !== null && Math.abs(entry.rightDeltaPx) <= tolerance,
        `the transcript's text ends ${entry.rightDeltaPx}px from the composer box's right at ` +
          `${entry.width}px (tolerance ${tolerance}px) — a scrollbar's width left in the ` +
          `column shows up here`,
      );
      assert.ok(
        entry.widthDeltaPx !== null && Math.abs(entry.widthDeltaPx) <= tolerance,
        `the transcript's text column is ${entry.widthDeltaPx}px wider than the composer box at ` +
          `${entry.width}px (tolerance ${tolerance}px)`,
      );
      // T4 — the text really sits in that column: the message rows fill it. The
      // rows' union covers both edges and no row escapes it, so a padding that
      // moved the rows but not the text would fail. The side each role's bubble
      // is aligned to is the transcript's business, not this rig's.
      assert.equal(
        entry.messagesPresent,
        true,
        `the transcript's message rows were not measurable at ${entry.width}px`,
      );
      assert.ok(entry.messages !== null, `no message-row block at ${entry.width}px`);
      assert.ok(
        entry.messages!.leftDeltaPx !== null && Math.abs(entry.messages!.leftDeltaPx) <= 2,
        `the message rows start ${entry.messages!.leftDeltaPx}px from the text column's left ` +
          `at ${entry.width}px`,
      );
      assert.ok(
        entry.messages!.rightDeltaPx !== null && Math.abs(entry.messages!.rightDeltaPx) <= 2,
        `the message rows end ${entry.messages!.rightDeltaPx}px from the text column's right ` +
          `at ${entry.width}px`,
      );
      assert.ok(
        entry.messages!.rowCount > 0 &&
          entry.messages!.rowsLeftDeltaPx !== null &&
          entry.messages!.rowsRightDeltaPx !== null &&
          Math.abs(entry.messages!.rowsLeftDeltaPx) <= 2 &&
          Math.abs(entry.messages!.rowsRightDeltaPx) <= 2,
        `the rows' union is ${entry.messages!.rowsLeftDeltaPx}px / ` +
          `${entry.messages!.rowsRightDeltaPx}px off the column's edges at ${entry.width}px`,
      );
      assert.ok(
        entry.messages!.rowsOutsideLeftPx !== null &&
          entry.messages!.rowsOutsideRightPx !== null &&
          entry.messages!.rowsOutsideLeftPx >= -2 &&
          entry.messages!.rowsOutsideRightPx >= -2,
        `a message row escaped the column by ${entry.messages!.rowsOutsideLeftPx}px / ` +
          `${entry.messages!.rowsOutsideRightPx}px at ${entry.width}px`,
      );
    }

    // ── 1. the name chip ────────────────────────────────────────────────────
    // C1 — it rendered at all, inside the old header wrapper.
    assert.equal(report.chip.present, true, "the thread name chip never rendered");
    assert.equal(report.chip.stripPresent, true, "the thread drew no tab strip above the name");
    assert.equal(report.chip.headerPresent, true, "the .chat-panel__header--thread wrapper is gone");
    assert.ok(
      report.chip.headerTopVsStripBottomPx !== null &&
        Math.abs(report.chip.headerTopVsStripBottomPx) <= report.tolerances.chipTopPx,
      `the header wrapper starts ${report.chip.headerTopVsStripBottomPx}px from the strip's bottom`,
    );
    // C3 — the name hangs flush off the strip's bottom edge.
    assert.ok(
      report.chip.topVsStripBottomPx !== null &&
        Math.abs(report.chip.topVsStripBottomPx) <= report.tolerances.chipTopPx,
      `the name's top edge is ${report.chip.topVsStripBottomPx}px from the strip's bottom ` +
        `(expected within ${report.tolerances.chipTopPx}px)`,
    );
    // C4 — it sits on the dock's centre line. The row's trailing actions slot is
    // empty for a tabbed thread but still contributes half the row's 0.35rem gap,
    // which is why the tolerance is 4px.
    assert.ok(
      report.chip.centreVsPanelCentrePx !== null &&
        Math.abs(report.chip.centreVsPanelCentrePx) <= report.tolerances.chipCentrePx,
      `the name's centre is ${report.chip.centreVsPanelCentrePx}px off the panel's centre ` +
        `(expected within ${report.tolerances.chipCentrePx}px)`,
    );
    assert.equal(report.chip.insidePanel, true, "the name escaped the dock's box");
    // C8 — the whole name is the control: a real button, named for the rename,
    // carrying the label as its only content.
    assert.equal(report.chip.tag, "BUTTON", `the name is a ${report.chip.tag}, not a button`);
    assert.ok(
      typeof report.chip.ariaLabel === "string" && report.chip.ariaLabel.length > 0,
      `the name carries no accessible name: ${JSON.stringify(report.chip.ariaLabel)}`,
    );
    assert.equal(report.chip.insideRow, true, "the name escaped its row's box");
    assert.equal(report.chip.containsLabel, true, "the name's label is outside the control");
    // C7 — the label is the title, literally: the heading classes, the tab's own
    // text, and no icon's accessible name leaked into textContent.
    const chipClasses = (report.chip.labelClasses ?? "").split(/\s+/);
    assert.ok(
      chipClasses.includes("chat-panel__heading") &&
        chipClasses.includes("chat-panel__heading--thread"),
      `the label lost its heading classes: ${report.chip.labelClasses}`,
    );
    assert.ok(
      typeof report.chip.labelText === "string" &&
        report.chip.labelText.length > 0 &&
        report.chip.labelText === report.chip.labelText.trim(),
      `the label's text is not a bare title: ${JSON.stringify(report.chip.labelText)}`,
    );
    if (report.chip.tabTitle !== null) {
      assert.equal(
        report.chip.labelText,
        report.chip.tabTitle,
        "the chip's label is not exactly the chat title the tab carries",
      );
    }
    // C6 — one type step down from the old band's 0.85rem (13.6px).
    assert.ok(
      report.chip.labelFontSizePx !== null &&
        report.chip.labelFontSizePx > report.tolerances.chipFontMinPx &&
        report.chip.labelFontSizePx < report.tolerances.chipFontMaxPx,
      `the name's font-size is ${report.chip.labelFontSizePx}px, expected ` +
        `${report.tolerances.chipFontMinPx}–${report.tolerances.chipFontMaxPx}px`,
    );
    // C2 — a box sized to its text, not a band across the dock.
    assert.ok(
      report.chip.display === "inline-flex" || report.chip.display === "flex",
      `the chip's display is ${report.chip.display}, not an inline/flex box`,
    );
    assert.ok(
      report.chip.widthPx !== null && report.chip.widthPx > 0 && report.chip.heightPx !== null &&
        report.chip.heightPx > 0,
      `the chip's box is ${report.chip.widthPx}×${report.chip.heightPx}px`,
    );
    // C9 — the name paints no chrome at rest: no border on any side, no fill.
    assert.ok(
      report.chip.borderWidthsPx !== null &&
        Object.values(report.chip.borderWidthsPx).length === 4 &&
        Object.values(report.chip.borderWidthsPx).every((value) => value === 0),
      `the name still draws a border: ${JSON.stringify(report.chip.borderWidthsPx)}`,
    );
    assert.ok(
      report.chip.borderStyles !== null &&
        Object.values(report.chip.borderStyles).every((style) => style === "none"),
      `the name still draws a border: ${JSON.stringify(report.chip.borderStyles)}`,
    );
    assert.ok(
      typeof report.chip.background === "string" &&
        /rgba\(0, 0, 0, 0\)|transparent/.test(report.chip.background),
      `the name still paints a fill: ${report.chip.background}`,
    );
    // C9 — the resting ink is the neutral `--muted` token, and it reads quieter
    // than the transcript's `--fg` prose: a lower contrast against the dock's own
    // canvas. A regression to the old bright ink scores the same as the
    // transcript and fails here.
    assert.equal(
      report.chip.colors.chip,
      report.chip.colors.mutedToken,
      `the name's ink is ${report.chip.colors.chip}, not the muted token ` +
        `${report.chip.colors.mutedToken}`,
    );
    assert.ok(
      report.chip.colors.chipContrast !== null &&
        report.chip.colors.inkContrast !== null &&
        report.chip.colors.chipContrast <
          report.chip.colors.inkContrast - report.tolerances.chipContrastMargin,
      `the name's contrast against the dock is ${report.chip.colors.chipContrast}, not at least ` +
        `${report.tolerances.chipContrastMargin} below the transcript's ` +
        `${report.chip.colors.inkContrast}`,
    );
    // C8 — the retired pencil is gone: no test id, no old class, no SVG.
    assert.equal(report.chip.editPresent, false, "the chip's rename pencil is back");
    assert.notEqual(report.chip.editHasSvg, true, "the retired rename control carries an SVG again");
    assert.equal(report.chip.nameEditClassCount, 0, "a .chat-panel__name-edit control is back");
    assert.equal(report.chip.hasSvg, false, "the name's control carries an SVG icon");

    // ── C10–C13: the name's rename path ─────────────────────────────────────
    // C10 — clicking the name opens the field in its own row, prefilled and bare.
    assert.equal(
      report.rename.opened.fieldPresent,
      true,
      "clicking the name did not open the rename field",
    );
    assert.equal(
      report.rename.opened.value,
      report.rename.opened.title,
      `the rename field opened with ${JSON.stringify(report.rename.opened.value)}, ` +
        `expected the current title ${JSON.stringify(report.rename.opened.title)}`,
    );
    assert.equal(
      report.rename.opened.fieldTag,
      "INPUT",
      `the rename field is a ${report.rename.opened.fieldTag}, not an input`,
    );
    assert.equal(
      report.rename.opened.inForm,
      true,
      "the rename field is not inside .chat-panel__rename",
    );
    assert.equal(
      report.rename.opened.formInRow,
      true,
      "the rename field did not open in the name's own row",
    );
    assert.equal(
      report.rename.opened.chipHidden,
      true,
      "the name stayed beside the field instead of being replaced by it",
    );
    // The Save/Cancel keys are gone: blur saves, Escape cancels.
    assert.equal(
      report.rename.opened.formButtonCount,
      0,
      `the rename field drew ${report.rename.opened.formButtonCount} Save/Cancel button(s)`,
    );
    // C11 — Escape cancels: nothing written, field closed, name kept.
    assert.equal(report.rename.escape.fieldClosed, true, "Escape did not close the rename field");
    assert.equal(
      report.rename.escape.usedRecovery,
      null,
      "Escape did not close the field on its own; the rig had to recover it",
    );
    assert.equal(
      report.rename.escape.patchDelta,
      0,
      `Escape wrote ${report.rename.escape.patchDelta} session patch(es)`,
    );
    assert.equal(
      report.rename.escape.labelText,
      report.rename.opened.title,
      `the title changed to ${JSON.stringify(report.rename.escape.labelText)} after Escape`,
    );
    // C12 — blur saves: there is no Save key, so clicking away writes the typed
    // title through the bridge and closes the field.
    assert.equal(
      report.rename.blur.committed,
      true,
      "blurring the rename field did not save the title",
    );
    assert.equal(report.rename.blur.patchLanded, true, "blur never reached the bridge");
    assert.equal(
      report.rename.blur.patch?.patch.title,
      report.rename.blur.typedTitle,
      `blur asked the bridge to write ${JSON.stringify(report.rename.blur.patch?.patch.title)}, ` +
        `expected ${JSON.stringify(report.rename.blur.typedTitle)}`,
    );
    assert.equal(
      report.rename.blur.patchDelta,
      1,
      `blur wrote ${report.rename.blur.patchDelta} session patch(es), expected exactly one`,
    );
    assert.equal(report.rename.blur.fieldClosed, true, "the rename field stayed open after blur");
    assert.equal(
      report.rename.blur.labelText,
      report.rename.blur.typedTitle,
      "the chip's label did not take the title blur saved",
    );
    // C12 — Enter takes the same save path and commits through the bridge.
    assert.equal(
      report.rename.enter.enterCommitted,
      true,
      report.rename.enter.usedBlurFallback
        ? "Enter did not blur the field (the blur itself committed, so the save path " +
          "works and the key never reached it)"
        : "Enter left the rename field open and sent no session patch",
    );
    assert.equal(
      report.rename.enter.usedBlurFallback,
      false,
      "the rig had to blur the field itself — Enter did not save",
    );
    assert.equal(report.rename.enter.patchLanded, true, "the rename never reached the bridge");
    assert.equal(
      report.rename.enter.patch?.patch.title,
      report.rename.enter.typedTitle,
      `the bridge was asked to write ${JSON.stringify(report.rename.enter.patch?.patch.title)}, ` +
        `expected ${JSON.stringify(report.rename.enter.typedTitle)}`,
    );
    assert.equal(
      report.rename.enter.patchDelta,
      1,
      `Enter wrote ${report.rename.enter.patchDelta} session patch(es), expected exactly one`,
    );
    assert.equal(report.rename.enter.fieldClosed, true, "the rename field stayed open after Enter");
    assert.equal(
      report.rename.enter.labelText,
      report.rename.enter.typedTitle,
      "the chip's label did not take the committed title",
    );
    // C13 — the chip grows with the title.
    assert.ok(
      report.rename.enter.chipWidthBeforePx !== null &&
        report.rename.enter.chipWidthAfterPx !== null &&
        report.rename.enter.chipWidthAfterPx > report.rename.enter.chipWidthBeforePx,
      `the chip did not grow with the title: ${report.rename.enter.chipWidthBeforePx}px → ` +
        `${report.rename.enter.chipWidthAfterPx}px`,
    );
    assert.equal(report.rename.enter.chipGrew, true, "the chip's width did not follow the title");
    // ...and it still hangs under the strip, on the centre line, inside the dock
    // — at 900 and after the dock narrows to 360.
    assert.ok(
      report.rename.enter.topVsStripBottomPx !== null &&
        Math.abs(report.rename.enter.topVsStripBottomPx) <= report.tolerances.chipTopPx,
      `after the rename the name's top is ${report.rename.enter.topVsStripBottomPx}px ` +
        `off the strip`,
    );
    assert.ok(
      report.rename.enter.centreVsPanelCentrePx !== null &&
        Math.abs(report.rename.enter.centreVsPanelCentrePx) <= report.tolerances.chipCentrePx,
      `after the rename the name's centre is ${report.rename.enter.centreVsPanelCentrePx}px ` +
        `off the panel's centre`,
    );
    assert.equal(report.rename.enter.insidePanel, true, "the renamed name escaped the dock");
    assert.equal(
      report.rename.enter.insidePanelAt360,
      true,
      "the renamed name overflows the 360px dock",
    );
    // C13 — the tab menu's Rename is the same field, and cancelling it writes
    // nothing: the menu's door must not save on its own.
    assert.equal(report.rename.tabMenu.tabFound, true, "the strip drew no tab in front to right-click");
    assert.equal(report.rename.tabMenu.menuOpened, true, "right-clicking the tab opened no menu");
    assert.equal(report.rename.tabMenu.itemClicked, true, "the tab menu drew no Rename item");
    assert.equal(
      report.rename.tabMenu.fieldPresent,
      true,
      "the tab menu's Rename did not open the name's rename field",
    );
    assert.equal(
      report.rename.tabMenu.value,
      report.rename.tabMenu.expectedTitle,
      `the tab menu's field opened with ${JSON.stringify(report.rename.tabMenu.value)}, ` +
        `expected the current title ${JSON.stringify(report.rename.tabMenu.expectedTitle)}`,
    );
    assert.equal(
      report.rename.tabMenu.fieldTag,
      "INPUT",
      `the tab menu's field is a ${report.rename.tabMenu.fieldTag}, not an input`,
    );
    assert.equal(
      report.rename.tabMenu.inForm,
      true,
      "the tab menu's rename field is not .chat-panel__rename",
    );
    assert.equal(
      report.rename.tabMenu.formInRow,
      true,
      "the tab menu's field did not open in the name's row",
    );
    assert.equal(
      report.rename.tabMenu.fieldClosed,
      true,
      "Escape did not close the tab-menu rename field",
    );
    assert.equal(
      report.rename.tabMenu.patchDelta,
      0,
      `the tab menu's rename path wrote ${report.rename.tabMenu.patchDelta} patch(es) by itself`,
    );

    // ── 3. the agent switcher ────────────────────────────────────────────────
    // S8 — the footer is the container the narrow/wide rule is written on.
    assert.ok(report.footer, "the composer footer was not measured");
    assert.ok(
      report.footer!.containerType.includes("inline-size"),
      `the footer is not an inline-size container: container-type is ` +
        `${report.footer!.containerType}`,
    );
    assert.equal(report.footer!.isSizeContainer, true);
    // S1, S9 — it renders, on the composer form, with both fixtures' companions.
    assert.equal(report.agentSwitcher.present, true, "the agent switcher never rendered");
    assert.equal(
      report.agentSwitcher.role,
      "radiogroup",
      `the switcher's role is ${report.agentSwitcher.role}`,
    );
    assert.equal(
      report.agentSwitcher.insideComposerForm,
      true,
      "the switcher is not a child of the composer form — its fallback is anchored to the " +
        "band, where the interview card and retired-model notice can push it up the panel",
    );
    assert.ok(
      report.agentSwitcher.pillCount >= 2,
      `only ${report.agentSwitcher.pillCount} agent pill(s) rendered`,
    );
    assert.equal(
      report.agentSwitcher.pills.filter((pill) => pill.active === "true").length,
      1,
      `expected exactly one active agent, got ${JSON.stringify(report.agentSwitcher.pills)}`,
    );
    // S3–S6 — wide dock: in the right gutter, centred in it, bottom level with
    // the composer box, inside the dock, never over the composer.
    assert.ok(
      report.agentSwitcher.wide.length >= 1,
      "the rig never measured the switcher at a wide dock",
    );
    for (const mode of report.agentSwitcher.wide) {
      assert.equal(mode.present, true, `the switcher did not render at ${mode.width}px`);
      assert.ok(
        mode.noOverlap === true,
        `the switcher overlaps the composer at ${mode.width}px ` +
          `(left edge is ${mode.composerGapPx}px from the box's right edge)`,
      );
      assert.ok(
        mode.centreDeltaPx !== null &&
          Math.abs(mode.centreDeltaPx) <= report.tolerances.switcherCentrePx,
        `the switcher's centre is ${mode.centreDeltaPx}px off the gutter's centre at ` +
          `${mode.width}px (expected within ${report.tolerances.switcherCentrePx}px)`,
      );
      assert.ok(
        mode.rightInsetPx !== null && mode.rightInsetPx >= 2,
        `the switcher escapes the panel's right edge at ${mode.width}px ` +
          `(right inset ${mode.rightInsetPx}px)`,
      );
      assert.ok(
        mode.bottomVsComposerBoxPx !== null &&
          Math.abs(mode.bottomVsComposerBoxPx) <= report.tolerances.switcherBottomPx,
        `the switcher's bottom is ${mode.bottomVsComposerBoxPx}px off the composer box's ` +
          `bottom at ${mode.width}px`,
      );
      assert.equal(mode.insidePanel, true, `the switcher escaped the dock at ${mode.width}px`);
    }
    // S7 — narrow dock: just above the composer it belongs to (the band's cards
    // and notices must not push it up), not covering it, at the dock's own
    // 0.75rem trailing inset.
    assert.ok(
      report.agentSwitcher.narrow.length >= 1,
      "the rig never measured the switcher at a narrow dock",
    );
    for (const mode of report.agentSwitcher.narrow) {
      assert.equal(mode.present, true, `the switcher did not render at ${mode.width}px`);
      assert.ok(
        mode.aboveComposerBox === true,
        `the switcher is not just above the composer at ${mode.width}px ` +
          `(its bottom is ${mode.bottomVsComposerBoxTopPx}px from the composer box's top; ` +
          `expected ≤ 1px above, and −5.6px with no context pills)`,
      );
      // The other half of the same claim: it is *just* above. Without this a
      // block anchored to the band again — 12px of band padding, plus whatever
      // card the band holds — would still be "above the composer" and pass.
      assert.ok(
        mode.bottomVsComposerBoxTopPx !== null &&
          mode.bottomVsComposerBoxTopPx >=
            -(report.tolerances.narrowComposerGapPx + report.tolerances.narrowGapTolerancePx),
        `the switcher floats ${-(mode.bottomVsComposerBoxTopPx ?? 0)}px above the composer ` +
          `box at ${mode.width}px, expected ≈ ${report.tolerances.narrowComposerGapPx}px ` +
          `(a band-anchored fallback sits ~${report.tolerances.narrowComposerGapPx + 12}px ` +
          `above and would clear the transcript instead of hugging the composer)`,
      );
      assert.equal(
        mode.intersectsComposerBox,
        false,
        `the narrow switcher overlaps the composer box at ${mode.width}px`,
      );
      assert.ok(
        mode.rightInsetDeltaPx !== null &&
          Math.abs(mode.rightInsetDeltaPx) <= report.tolerances.switcherRightPx,
        `the switcher's right inset at ${mode.width}px is ${mode.rightInsetPx}px, expected ` +
          `${report.tolerances.narrowRightInsetPx}px ± ${report.tolerances.switcherRightPx}`,
      );
    }

    // ── the pictures ─────────────────────────────────────────────────────────
    // A report without a picture proves nothing to the operator; both are
    // written by the rig's own capturePage and named here.
    assert.equal(
      report.screenshots.wide.path.endsWith(WIDE_SHOT),
      true,
      `the wide screenshot is ${report.screenshots.wide.path}, expected ${WIDE_SHOT}`,
    );
    assert.equal(
      report.screenshots.narrow.path.endsWith(NARROW_SHOT),
      true,
      `the narrow screenshot is ${report.screenshots.narrow.path}, expected ${NARROW_SHOT}`,
    );
    for (const shot of [report.screenshots.wide, report.screenshots.narrow]) {
      assert.equal(fs.existsSync(shot.path), true, `screenshot missing: ${shot.path}`);
      assert.ok(shot.bytes > 0, `screenshot is empty: ${shot.path}`);
    }
  });
});
