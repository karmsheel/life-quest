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
 * Three concerns live here because they are one surface and one page:
 *
 *  1. the name row is a compact, centred chip hanging flush under the tab
 *     strip, with the rename pencil at its trailing end — and the pencil's
 *     rename field still commits on Enter and cancels on Escape;
 *  2. the composer box is inset by a gutter that grows with the dock (12px
 *     floor, a linear climb, a 12.5% cap), symmetric and non-decreasing;
 *  3. the agent switcher stands in that right-hand gutter when the dock is
 *     wide, and steps just above the composer form when it is narrow (anchored
 *     to the form, not the band, so the band's cards and notices cannot push it
 *     up over the transcript), switched by a container query on the footer.
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
    borderTopWidthPx: number | null;
    borderTopStyle: string;
    borderRadius: string;
    background: string;
    fontSizePx: number | null;
  } | null;
  label: {
    rect: Box;
    text: string;
    classes: string;
    fontSizePx: number | null;
    fontWeight: string;
    hasSvg: boolean;
    tag: string;
  } | null;
  edit: {
    rect: Box;
    tag: string;
    hasSvg: boolean;
    ariaLabel: string | null;
    insideChip: boolean;
    afterLabel: boolean;
    insidePanel: boolean;
  } | null;
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
  chip: {
    present: boolean;
    stripPresent: boolean;
    headerPresent: boolean;
    rect: Box | null;
    display: string | null;
    borderTopWidthPx: number | null;
    borderTopStyle: string | null;
    fontSizePx: number | null;
    labelText: string | null;
    tabTitle: string | null;
    labelClasses: string | null;
    labelFontSizePx: number | null;
    headerTopVsStripBottomPx: number | null;
    topVsStripBottomPx: number | null;
    centreVsPanelCentrePx: number | null;
    insidePanel: boolean;
    editPresent: boolean;
    editTag: string | null;
    editHasSvg: boolean | null;
    editAfterLabel: boolean | null;
    editInsideChip: boolean | null;
    widthPx: number | null;
    heightPx: number | null;
  };
  rename: {
    opened: { fieldPresent: boolean; value: string | null; title: string | null };
    escape: {
      fieldClosed: boolean;
      chipBack: boolean;
      labelText: string | null;
      patchesBefore: number;
      patchesAfter: number;
      patchDelta: number;
      usedButtonFallback: boolean;
    };
    commit: {
      typedTitle: string;
      enterCommitted: boolean;
      usedFormFallback: boolean;
      patchLanded: boolean;
      patch: { id: string; patch: { title?: string } } | null;
      fieldClosed: boolean;
      labelText: string | null;
      tabTitle: string | null;
      chipWidthBeforePx: number | null;
      chipWidthAfterPx: number | null;
      chipGrew: boolean;
      topVsStripBottomPx: number | null;
      centreVsPanelCentrePx: number | null;
      insidePanel: boolean;
      insidePanelAt360: boolean;
      chipWidthAt360Px: number | null;
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

    // ── 1. the name chip ────────────────────────────────────────────────────
    // C1 — it rendered at all, inside the old header wrapper.
    assert.equal(report.chip.present, true, "the thread name chip never rendered");
    assert.equal(report.chip.stripPresent, true, "the thread drew no tab strip above the chip");
    assert.equal(report.chip.headerPresent, true, "the .chat-panel__header--thread wrapper is gone");
    assert.ok(
      report.chip.headerTopVsStripBottomPx !== null &&
        Math.abs(report.chip.headerTopVsStripBottomPx) <= report.tolerances.chipTopPx,
      `the header wrapper starts ${report.chip.headerTopVsStripBottomPx}px from the strip's bottom`,
    );
    // C3 — the chip hangs flush off the strip's bottom edge.
    assert.ok(
      report.chip.topVsStripBottomPx !== null &&
        Math.abs(report.chip.topVsStripBottomPx) <= report.tolerances.chipTopPx,
      `the chip's top edge is ${report.chip.topVsStripBottomPx}px from the strip's bottom ` +
        `(expected within ${report.tolerances.chipTopPx}px)`,
    );
    // C4 — it sits on the dock's centre line.
    assert.ok(
      report.chip.centreVsPanelCentrePx !== null &&
        Math.abs(report.chip.centreVsPanelCentrePx) <= report.tolerances.chipCentrePx,
      `the chip's centre is ${report.chip.centreVsPanelCentrePx}px off the panel's centre ` +
        `(expected within ${report.tolerances.chipCentrePx}px)`,
    );
    assert.equal(report.chip.insidePanel, true, "the chip escaped the dock's box");
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
      report.chip.borderTopWidthPx !== null && report.chip.borderTopWidthPx > 0,
      `the chip carries no border (${report.chip.borderTopWidthPx}px ${report.chip.borderTopStyle})`,
    );
    assert.ok(
      report.chip.widthPx !== null && report.chip.widthPx > 0 && report.chip.heightPx !== null &&
        report.chip.heightPx > 0,
      `the chip's box is ${report.chip.widthPx}×${report.chip.heightPx}px`,
    );
    // C8 — the pencil is a button with an SVG at the label's trailing end,
    // inside the chip.
    assert.equal(report.chip.editPresent, true, "the chip's rename pencil never rendered");
    assert.equal(report.chip.editTag, "BUTTON", `the pencil is a ${report.chip.editTag}, not a button`);
    assert.equal(report.chip.editHasSvg, true, "the rename control carries no SVG pencil");
    assert.equal(
      report.chip.editAfterLabel,
      true,
      "the pencil is not at the label's trailing end",
    );
    assert.equal(report.chip.editInsideChip, true, "the pencil sits outside the chip's box");

    // ── C9–C12: the pencil's rename path ────────────────────────────────────
    assert.equal(
      report.rename.opened.fieldPresent,
      true,
      "clicking the pencil did not open the rename field",
    );
    assert.equal(
      report.rename.opened.value,
      report.rename.opened.title,
      `the rename field opened with ${JSON.stringify(report.rename.opened.value)}, ` +
        `expected the current title ${JSON.stringify(report.rename.opened.title)}`,
    );
    // C10 — Escape cancels: nothing written, field closed, name kept.
    assert.equal(report.rename.escape.fieldClosed, true, "Escape did not close the rename field");
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
    // C11 — Enter commits, through the bridge and not only the panel's state.
    assert.equal(
      report.rename.commit.enterCommitted,
      true,
      report.rename.commit.usedFormFallback
        ? "Enter did not run the form submit (the field stayed open; the form's own submit " +
          "did commit, so the key never reached the field)"
        : "Enter left the rename field open and sent no session patch",
    );
    assert.equal(
      report.rename.commit.usedFormFallback,
      false,
      "the rig had to submit the rename form itself — Enter did not commit",
    );
    assert.equal(report.rename.commit.patchLanded, true, "the rename never reached the bridge");
    assert.equal(
      report.rename.commit.patch?.patch.title,
      report.rename.commit.typedTitle,
      `the bridge was asked to write ${JSON.stringify(report.rename.commit.patch?.patch.title)}, ` +
        `expected ${JSON.stringify(report.rename.commit.typedTitle)}`,
    );
    assert.equal(report.rename.commit.fieldClosed, true, "the rename field stayed open after Enter");
    assert.equal(
      report.rename.commit.labelText,
      report.rename.commit.typedTitle,
      "the chip's label did not take the committed title",
    );
    // C12 — the chip grows with the title.
    assert.ok(
      report.rename.commit.chipWidthBeforePx !== null &&
        report.rename.commit.chipWidthAfterPx !== null &&
        report.rename.commit.chipWidthAfterPx > report.rename.commit.chipWidthBeforePx,
      `the chip did not grow with the title: ${report.rename.commit.chipWidthBeforePx}px → ` +
        `${report.rename.commit.chipWidthAfterPx}px`,
    );
    assert.equal(report.rename.commit.chipGrew, true, "the chip's width did not follow the title");
    // ...and it still hangs under the strip, on the centre line, inside the dock
    // — at 900 and after the dock narrows to 360.
    assert.ok(
      report.rename.commit.topVsStripBottomPx !== null &&
        Math.abs(report.rename.commit.topVsStripBottomPx) <= report.tolerances.chipTopPx,
      `after the rename the chip's top is ${report.rename.commit.topVsStripBottomPx}px ` +
        `off the strip`,
    );
    assert.ok(
      report.rename.commit.centreVsPanelCentrePx !== null &&
        Math.abs(report.rename.commit.centreVsPanelCentrePx) <= report.tolerances.chipCentrePx,
      `after the rename the chip's centre is ${report.rename.commit.centreVsPanelCentrePx}px ` +
        `off the panel's centre`,
    );
    assert.equal(report.rename.commit.insidePanel, true, "the renamed chip escaped the dock");
    assert.equal(
      report.rename.commit.insidePanelAt360,
      true,
      "the renamed chip overflows the 360px dock",
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
