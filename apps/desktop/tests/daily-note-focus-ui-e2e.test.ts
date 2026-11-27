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
/** The page at rest: the box and the day's act on the box's foot. */
const FOOTER_SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note-footer.png");
/** The page and the act's chat, after the sheet was asked to leave. */
const ANALYZE_SHOT = path.join(desktopRoot, "e2e/artifacts/daily-note-focus-analyze.png");
/** The page of paper's own measure: 56rem at the app's 16px root. */
const PANEL_MEASURE = 56 * 16;

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
      /** Focus mode is the cluster's trailing key: Today (off-today), then it. */
      lastInActions: boolean;
      /** The cluster's `--daily-note-act-height`, resolved from the stylesheet. */
      actHeight: number | null;
      borderStyle: string;
      borderWidth: number;
      radius: number;
    };
type AutomationsSample = {
  present: boolean;
  box: Box | null;
  centre: Centre | null;
  analyzeBox: Box | null;
  analyzeTestId: string | null;
  analyzeText?: string | null;
  analyzeDisabled?: boolean | null;
  analyzeFontSize?: number | null;
  analyzeHeight?: number | null;
  inHeader: boolean;
  inTitleRow: boolean;
  inActions: boolean;
  inFooter: boolean;
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
  /** The title row's cluster: the page's own keys, on the row's trailing edge. */
  actionCluster: { box: Box; rightGap: number | null } | null;
  /** The box's own column, which the day's act is placed against. */
  editorBox: Box | null;
  /** The foot under the box: the autosave line and the day's act. */
  pageFooter: {
    present: boolean;
    box: Box | null;
    belowEditor: boolean;
    statusInFooter: boolean;
    statusText: string | null;
  } | null;
  actionOrder: string[];
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
    className: string;
    hiddenFromView: boolean;
    visibleBox: (Box & { clipped: boolean }) | null;
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
  pageDate: {
    box: Box;
    centre: Centre;
    text: string;
    inPanel: boolean;
    tag: string;
    aboveNote: boolean;
    centredOnPanel: boolean;
    textAlign: string;
    fontSize: string;
  } | null;
  note: { box: Box; inPanel: boolean } | null;
  foot: { box: Box; inPanel: boolean; belowNote: boolean } | null;
  statusLine: {
    box: Box;
    text: string;
    inFoot: boolean;
    minHeight: string;
  } | null;
  focusActions: {
    present: boolean;
    box: Box | null;
    inFoot: boolean;
    actionBox: Box | null;
    actionTestId: string | null;
    actionText?: string | null;
    actionDisabled?: boolean | null;
    actionSvg?: boolean | null;
  };
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
  /** The dock behind the sheet: whether the act's chat is really on screen. */
  chat: {
    mounted: boolean;
    open: boolean;
    visible: boolean;
    surface: string | null;
    title: string | null;
    userMessages: string[];
  };
  /** The turns the page handed the dock, so the act's prompt is checkable. */
  chatCalls: {
    sessionId: string;
    input: string;
    automationContext: string | null;
    pageRoute: string | null;
  }[];
  writes: number;
  unexpectedCalls: string[];
};

/** A write to the vault, with the day the page was showing when it made it. */
type Write = { date: string; body: string; shown: string | null };

/**
 * The autosave band, caught in the act of showing its words.
 *
 * Its own shape, not a full sample: the rig takes the band and its words in
 * one poll, because the words vanish the instant the write lands and a sample
 * taken afterwards would read the band empty.
 */
type CaughtBand = {
  text: string;
  box: Box;
  minHeight: string;
  inFoot: boolean;
};

type Report = {
  url: string;
  ranAt: string;
  window: { width: number; height: number };
  fixture: { sentence: string };
  checks: { today?: string; writes?: Write[] };
  states: Record<string, Sample | CaughtBand>;
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
    savingBandText?: string | null;
    savingBandHeight?: number | null;
    savingBandInFoot?: boolean | null;
    restBandHeight?: number | null;
    focusWrite?: Write | null;
    screenshot?: {
      file: string;
      bytes: number;
      width: number;
      height: number;
      whileOpen: boolean;
    } | null;
    screenshotWhileOpen?: boolean;
    /** The page at rest, captured before the sheet is opened. */
    footerShot?: {
      file: string;
      bytes: number;
      width: number;
      height: number;
    } | null;
    /** The off-today trip that proves the cluster's order. */
    prevDayClick?: boolean;
    todayClick?: boolean;
    analyzeClicked?: boolean;
    analyzeShot?: {
      file: string;
      bytes: number;
      width: number;
      height: number;
    } | null;
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
    fs.rmSync(FOOTER_SHOT, { force: true });
    fs.rmSync(ANALYZE_SHOT, { force: true });
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
      backToToday,
      offToday,
      opened,
      closedByCross,
      reopenedForScrim,
      closedByScrim,
      reopenedForEscape,
      closedByEscape,
      reopenedForTyping,
      typedModal,
      saving,
      savedByFocus,
      analyzeFromFocus,
      pageAfterFocus,
    } = report.states;

    // ── 1. the page's own keys: focus mode at the title row's trailing end ───
    // Falsifiable from the DOM order and the rendered boxes: focus mode must be a
    // button (not a word or an icon), carry the label the operator was told it
    // has, sit in the title row's action cluster as that cluster's LAST key, be
    // square and framed, and stand exactly the height the cluster's own token
    // resolves to. The day's act is not in this cluster — claim 1a reads it off
    // the box's foot.
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
      trigger.lastInActions,
      true,
      `focus mode is not the title row's last key: ${JSON.stringify(landing.actionOrder)}`,
    );
    // Nothing of the day's act is left in the cluster: no Analyze note key and no
    // automations slot among the page's keys.
    assert.ok(
      !landing.actionOrder.some(
        (entry) =>
          entry.includes("daily-note-analyze") || entry.includes("daily-note__automations"),
      ),
      `the day's act is still in the title row's cluster: ${JSON.stringify(landing.actionOrder)}`,
    );
    assert.equal(trigger.disabled, false, "the trigger is disabled on a loaded day");
    // The keys live on the page's trailing edge: the cluster must end where the
    // title row ends, or they float in the middle of the row.
    assert.ok(landing.actionCluster, "the title row has no action cluster");
    assert.ok(
      (landing.actionCluster!.rightGap ?? Number.POSITIVE_INFINITY) <= 2,
      `the keys' cluster ends ${landing.actionCluster!.rightGap}px off the title row's trailing edge`,
    );

    // The square framed key: the operator asked for a button-like border and a
    // square UI, so the frame has to be there and the box has to be square.
    assert.notEqual(
      trigger.borderStyle,
      "none",
      `the trigger paints no border — border-style is ${JSON.stringify(trigger.borderStyle)}`,
    );
    assert.ok(
      (trigger.borderWidth ?? 0) >= 1,
      `the trigger's border is ${trigger.borderWidth}px — no frame to see`,
    );
    // Square: the key is as wide as it is tall, within a pixel of the paint.
    assert.ok(
      Math.abs(trigger.box.width - trigger.box.height) <= 1,
      `the trigger's box is ${trigger.box.width}x${trigger.box.height} — not a square`,
    );
    // Both dimensions are the cluster's own token, resolved from the stylesheet in
    // the page: a key that stopped wearing the token would fail against it.
    assert.ok(
      typeof trigger.actHeight === "number" && trigger.actHeight > 0,
      `the cluster's --daily-note-act-height did not resolve: ${trigger.actHeight}`,
    );
    assert.ok(
      Math.abs(trigger.box.height - (trigger.actHeight ?? Number.NaN)) <= 1,
      `the key is ${trigger.box.height}px tall and the cluster's token is ${trigger.actHeight}px`,
    );
    assert.ok(
      Math.abs(trigger.box.width - (trigger.actHeight ?? Number.NaN)) <= 1,
      `the key is ${trigger.box.width}px wide and the cluster's token is ${trigger.actHeight}px`,
    );

    // ── 1a. the day's act: on the box's foot, at the box's bottom-right ──────
    // The operator asked for Analyze note under the box, one type step down from
    // the page's chrome. Every part is measured: the act's cluster in the foot,
    // the editor's rendered edge, the label's size and the key's height.
    const act = landing.automations;
    assert.equal(act.present, true, "Analyze note's container is not on the page");
    assert.ok(act.box, "Analyze note's cluster could not be measured");
    assert.ok(act.analyzeBox, "Analyze note's button could not be measured");
    assert.equal(act.inFooter, true, "Analyze note is not in the box's foot");
    assert.equal(act.inHeader, false, "Analyze note is still in the page's header");
    assert.equal(act.inTitleRow, false, "Analyze note is still on the title row");
    assert.equal(act.inActions, false, "Analyze note is still in the title row's keys cluster");
    assert.equal(landing.pageFooter?.present, true, "the page draws no foot under the box");
    assert.equal(
      landing.pageFooter?.belowEditor,
      true,
      "the foot sits above the editor it belongs to",
    );
    assert.equal(
      landing.pageFooter?.statusInFooter,
      true,
      "the autosave line is not in the foot with the act",
    );
    const pageEditor = landing.editorBox;
    assert.ok(pageEditor, "the page editor's box could not be measured");
    assert.ok(
      act.box!.top >= pageEditor!.bottom - 1,
      `the act's row (top ${act.box!.top}) is not below the editor (bottom ${pageEditor!.bottom})`,
    );
    assert.ok(
      Math.abs(act.box!.right - pageEditor!.right) <= 2,
      `the act's right edge (${act.box!.right}) is ${act.box!.right - pageEditor!.right}px off the editor's (${pageEditor!.right})`,
    );
    assert.ok(
      act.box!.left >= pageEditor!.left - 1 && act.box!.right <= pageEditor!.right + 2,
      `the act [${act.box!.left}, ${act.box!.right}] leaves the box's column [${pageEditor!.left}, ${pageEditor!.right}]`,
    );
    // One step down: a 0.875rem label (13–14.5px at the app's 16px root) and a
    // shorter key (33–37px), against the title row's own key.
    assert.ok(
      (act.analyzeFontSize ?? 0) >= 13 && (act.analyzeFontSize ?? 0) <= 14.5,
      `the act's label is ${act.analyzeFontSize}px, not the one step down the operator asked for`,
    );
    assert.ok(
      (act.analyzeHeight ?? 0) >= 33 && (act.analyzeHeight ?? 0) <= 37,
      `the act is ${act.analyzeHeight}px tall, not the shorter key the operator asked for`,
    );
    assert.ok(
      Math.abs((act.analyzeHeight ?? 0) - trigger.box.height) >= 2,
      `the act is ${act.analyzeHeight}px tall and the title row's key ${trigger.box.height}px — not a step down`,
    );
    // An empty day has nothing to commit, so its act is inert; the written day
    // below (claim 1b) is where it must be live.
    assert.equal(act.analyzeDisabled, true, "the act is live on a day with nothing written in it");

    // The page behind is where it was, and no sheet was up before the press.
    assert.equal(landing.overlay, null, "a sheet was open on arrival");
    assert.notEqual(landing.bodyOverflowStyle, "hidden", "the page was locked before the press");
    assert.equal(landing.pageMounted, true, "the daily-note page is missing at landing");
    assert.equal(landing.railMounted, true, "the nav rail is missing at landing");

    // ── 1b. off today: "back to today, then focus mode", and the act is live ──
    // The cluster's order is read on a day that is not today, because that is the
    // only day the Today key exists. The rig steps back one day through the
    // page's own pager, reads the row, then steps back to today with the page's
    // own key.
    assert.equal(report.steps.prevDayClick, true, "the rig could not step off today");
    assert.equal(report.steps.todayClick, true, "the rig could not step back to today");
    assert.deepEqual(
      offToday.actionOrder,
      ["daily-note-today", "daily-note-focus"],
      `the title row's cluster reads ${JSON.stringify(offToday.actionOrder)} off today — expected the way back, then focus mode`,
    );
    assert.ok(offToday.trigger.present, "the off-today page draws no focus-mode trigger");
    if (offToday.trigger.present) {
      assert.equal(offToday.trigger.inTitleRow, true, "the focus key left the title row off today");
      assert.equal(
        offToday.trigger.lastInActions,
        true,
        "the focus key is not the title row's last key off today",
      );
    }
    assert.equal(offToday.automations.present, true, "the off-today page has no day act");
    assert.equal(offToday.automations.inFooter, true, "the day's act left the box's foot off today");
    assert.equal(
      offToday.automations.inActions,
      false,
      "the day's act is in the title row's keys off today",
    );
    assert.equal(
      offToday.automations.analyzeDisabled,
      false,
      "yesterday holds a written note, yet the day's act is inert",
    );
    // Back on today, the page came back whole: the keys and the foot are still
    // the ones the claims above measured.
    assert.equal(backToToday.overlay, null, "the trip off today left a sheet up");
    assert.equal(backToToday.trigger.present, true, "coming back to today lost the focus key");
    assert.equal(backToToday.pageEditorMounted, true, "coming back to today lost the editor");
    assert.equal(backToToday.pageFooter?.present, true, "coming back to today lost the box's foot");

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
    // The page's measure is absolute (56rem) and a cap, not a share: at 1280px
    // that is under half the window, so "<= 60%" alone would pass a 700px box.
    assert.ok(
      Math.abs(panel.box.width - PANEL_MEASURE) <= 2,
      `the panel is ${panel.box.width}px wide, not its 56rem (${PANEL_MEASURE}px) measure`,
    );
    // A page of paper is wider than the reading column it replaced: the point of
    // the change was that the note read as a page rather than as a narrow field.
    assert.ok(
      panel.box.width > 700,
      `the panel is ${panel.box.width}px wide — still a narrow column, not a page`,
    );
    // But it is still a *page*, not the whole window: the operator asked for the
    // note and nothing around it, so the page behind stays blurred mat on either
    // side rather than being stretched under the paper.
    assert.ok(
      panel.box.width <= opened.viewport.width * 0.75,
      `the panel is ${((panel.box.width / opened.viewport.width) * 100).toFixed(1)}% of the window — it swallowed the page behind it`,
    );
    assert.ok(
      Math.abs(panel.centre.x - opened.viewport.width / 2) <= 2,
      `the panel is centred at ${panel.centre.x}, not the window's ${opened.viewport.width / 2}`,
    );

    // ── 2a. the page of paper is headed by the day ───────────────────────────
    // The date is the page's ONE heading, centred over the prose. Without it the
    // operator has to keep the Daily Note page behind the sheet in their head to
    // remember which day they are writing.
    const pageDate = opened.pageDate;
    assert.ok(pageDate, "the page of paper has no date at its top");
    if (!pageDate) return;
    assert.equal(pageDate.inPanel, true, "the date is outside the panel");
    assert.equal(pageDate.tag, "H2", `the date is a ${pageDate.tag}, not the page's heading`);
    assert.ok(pageDate.text.trim().length > 0, "the date prints nothing");
    // The harness's own today, as the page prints it: the date on the page of
    // paper has to be the day the page behind is showing.
    assert.match(
      pageDate.text,
      /Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday/,
      `the date carries no weekday: ${JSON.stringify(pageDate.text)}`,
    );
    assert.ok(
      pageDate.aboveNote,
      "the date sits under the prose instead of heading it",
    );
    assert.ok(
      pageDate.box.top < (opened.note?.box.top ?? Number.POSITIVE_INFINITY),
      "the date is not above the note",
    );
    // It is the page's one heading, so it sits on the page's true centre — the
    // centre the sheet's own title used to hold, now that the title is gone.
    assert.equal(
      pageDate.textAlign,
      "center",
      `the date is aligned ${pageDate.textAlign}, not centred`,
    );
    assert.ok(
      pageDate.centredOnPanel,
      `the date is centred at ${pageDate.centre?.x}, not the panel's ${panel.centre.x}`,
    );
    assert.ok(
      Math.abs((pageDate.centre?.x ?? 0) - panel.centre.x) <= 2,
      `the date is ${(pageDate.centre?.x ?? 0) - panel.centre.x}px off the panel's centre`,
    );
    // And it is a heading in weight: the page's own name, not a caption.
    assert.ok(
      parseFloat(pageDate.fontSize) >= 18,
      `the heading is ${pageDate.fontSize}, too small to be the page's own name`,
    );

    // ── 2b. the page of paper has a foot, below the prose ───────────────────
    const foot = opened.foot;
    assert.ok(foot, "the page of paper has no foot");
    if (!foot) return;
    assert.equal(foot.inPanel, true, "the foot is outside the panel");
    assert.equal(
      foot.belowNote,
      true,
      "the foot sits above the prose instead of under it",
    );
    assert.ok(
      foot.box.top >= (opened.note?.box.bottom ?? 0) - 1,
      "the foot overlaps the prose it is supposed to sit under",
    );

    // The autosave band: the saving notification's own place. It is mounted
    // whether or not it has words, so the page does not jump under the hand
    // when the notification lands.
    const statusLine = opened.statusLine;
    assert.ok(statusLine, "the page of paper has no autosave band");
    if (!statusLine) return;
    assert.equal(statusLine.inFoot, true, "the autosave band is not in the page's foot");
    assert.equal(
      statusLine.text,
      "",
      `the band has words at rest: ${JSON.stringify(statusLine.text)}`,
    );
    assert.ok(
      parseFloat(statusLine.minHeight) > 0,
      `the autosave band reserves no height: min-height is ${statusLine.minHeight}`,
    );
    // The rendered height honours the reserve, up to the layout engine's own
    // sub-pixel rounding (a 1.15rem reserve lands on 18.4px and measures 18.39).
    assert.ok(
      statusLine.box.height >= parseFloat(statusLine.minHeight) - 0.5,
      `the autosave band is ${statusLine.box.height}px tall, shorter than its own ${statusLine.minHeight} reserve`,
    );

    // The day's own act, at the foot of the page: the same automation the page
    // offers, on the same draft, for the same day.
    const focusActions = opened.focusActions;
    assert.equal(focusActions.present, true, "the page of paper offers no acts");
    assert.equal(focusActions.inFoot, true, "the acts are not in the page's foot");
    assert.ok(focusActions.actionBox, "the page of paper's act could not be measured");
    assert.ok(
      focusActions.actionBox!.top >= (opened.note?.box.bottom ?? 0) - 1,
      "the act sits over the prose instead of under it",
    );
    assert.equal(
      focusActions.actionTestId,
      "focus-overlay-action-daily-note-analyze",
      `the act's test id is ${JSON.stringify(focusActions.actionTestId)}`,
    );
    assert.equal(focusActions.actionText, "Analyze note", `the act reads ${JSON.stringify(focusActions.actionText)}`);
    assert.equal(focusActions.actionSvg, true, "the act carries no icon");

    // The sheet's title is the frame's ACCESSIBLE name, not a piece of chrome:
    // the page the operator reads is headed by the date and nothing else. So the
    // title must still be in the document (the dialog is labelled by it) but must
    // paint nothing — a visible title above the date is a page with two
    // headings, which is exactly what this change removed.
    const title = opened.title;
    assert.ok(title, "the sheet draws no .sheet-overlay__title");
    if (!title) return;
    assert.equal(title.text, "Daily Journal", `the sheet's title reads ${JSON.stringify(title.text)}`);
    assert.equal(title.inPanel, true, "the title is outside the panel");
    assert.equal(
      title.hiddenFromView,
      true,
      "the sheet's title is still painted — the page has two headings",
    );
    assert.ok(title.visibleBox, "the title's box could not be measured");
    assert.ok(
      title.visibleBox!.clipped,
      `the hidden title still paints a ${title.visibleBox!.width}x${title.visibleBox!.height}px strip above the date`,
    );
    assert.ok(
      (title.visibleBox!.width ?? 0) <= 2 && (title.visibleBox!.height ?? 0) <= 2,
      `the hidden title occupies ${title.visibleBox!.width}x${title.visibleBox!.height}px of the panel`,
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

    // ── 4a. the saving notification has a place, and keeps it ───────────────
    // The band is caught mid-write, when "Saving…" is actually on screen. Its
    // height there must be the height it has at rest: a band that grows when the
    // notification lands is a page that jumps under the operator's hands.
    assert.ok(saving, "the rig never caught the saving notification on screen");
    if (saving) {
      assert.match(
        String(report.steps.savingBandText),
        /Saving…|Not saved/,
        `the saving band reads ${JSON.stringify(report.steps.savingBandText)}`,
      );      assert.ok(
        (report.steps.savingBandHeight ?? 0) > 0,
        "the saving band collapsed to nothing while it had words",
      );
      // The band's own reserve: the height it holds whether or not it is showing.
      assert.ok(
        (report.steps.restBandHeight ?? 0) > 0,
        "the autosave band reserves no height at rest",
      );
      assert.ok(
        Math.abs(
          (report.steps.savingBandHeight ?? 0) - (report.steps.restBandHeight ?? 0),
        ) <= 2,
        `the autosave band is ${report.steps.savingBandHeight}px while saving and ${report.steps.restBandHeight}px at rest — the page jumps when the notification lands`,
      );
      // The band belongs to the foot, and the foot belongs under the prose.
      assert.equal(
        report.steps.savingBandInFoot,
        true,
        "the saving band is not in the page's foot",
      );
    }

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

    // ── 5. the day's act, pressed in the sheet: focus mode leaves and the
    //       operator is handed the chat it opens, in the dock behind ──────────
    // The operator's ask in one sentence: press Analyze note on the page of
    // paper and the sheet goes, so the new chat is visible while the agent
    // starts on the note. Each half is measured: the sheet's unmount, and a
    // dock that is open, wide and carrying the act's own turn.
    assert.equal(report.steps.analyzeClicked, true, "the sheet's day-act could not be pressed");
    assert.equal(analyzeFromFocus.overlay, null, "pressing the day's act left focus mode up");
    assert.notEqual(
      analyzeFromFocus.bodyOverflowStyle,
      "hidden",
      "the page stayed locked after the act left the sheet",
    );
    assert.equal(analyzeFromFocus.pageMounted, true, "leaving the sheet lost the page behind");
    assert.equal(analyzeFromFocus.pageEditorMounted, true, "the act's exit lost the page's editor");
    assert.equal(analyzeFromFocus.chat.mounted, true, "the dock left the DOM");
    assert.equal(analyzeFromFocus.chat.open, true, "the dock did not open for the act's chat");
    assert.equal(
      analyzeFromFocus.chat.visible,
      true,
      "the dock is collapsed, so the act's chat is not on screen",
    );
    assert.equal(
      analyzeFromFocus.chat.surface,
      "thread",
      `the dock is on ${JSON.stringify(analyzeFromFocus.chat.surface)}, not its thread`,
    );
    assert.match(
      String(analyzeFromFocus.chat.title ?? ""),
      /^Analyze note · /,
      `the act's chat is titled ${JSON.stringify(analyzeFromFocus.chat.title)}`,
    );
    assert.equal(
      analyzeFromFocus.chat.userMessages.length,
      1,
      `the dock shows ${analyzeFromFocus.chat.userMessages.length} turns, expected the act's one`,
    );
    assert.match(
      analyzeFromFocus.chat.userMessages[0] ?? "",
      /Analyze the Daily Journal for/,
      `the turn on screen is not the automation's prompt: ${JSON.stringify(analyzeFromFocus.chat.userMessages[0])}`,
    );

    // The turn actually reached the agent, on the day the page was showing, with
    // the note the sheet wrote as its hidden context — not a chat pane that
    // opened on the previous conversation.
    const turn = analyzeFromFocus.chatCalls[0];
    assert.ok(turn, "the act opened a chat but sent no turn");
    if (turn) {
      assert.match(turn.input, /Analyze the Daily Journal for/);
      assert.equal(turn.pageRoute, "/notes", `the turn's page context is ${JSON.stringify(turn.pageRoute)}`);
      assert.match(
        String(turn.automationContext ?? ""),
        new RegExp(`--- DAILY JOURNAL \\(${today}\\) ---`),
        "the turn's context does not fence the day's own journal",
      );
      assert.ok(
        String(turn.automationContext ?? "").includes(sentence),
        "the turn's context does not carry the sentence the sheet wrote",
      );
    }
    assert.equal(report.steps.analyzeShot?.file, "daily-note-focus-analyze.png");
    assert.ok(
      (report.steps.analyzeShot?.bytes ?? 0) > 10_000,
      `the act's picture is ${report.steps.analyzeShot?.bytes} bytes`,
    );

    // ── 6. the page the sheet was covering is back, draft and all ────────────
    assert.equal(pageAfterFocus.overlay, null, "the final close left the sheet mounted");
    assert.equal(pageAfterFocus.pageEditorMounted, true, "the page's editor is gone after closing");
    assert.match(
      String(pageAfterFocus.pageEditorBody),
      new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `the page editor behind does not hold the typed sentence: ${JSON.stringify(pageAfterFocus.pageEditorBody)}`,
    );
    assert.notEqual(pageAfterFocus.bodyOverflowStyle, "hidden", "the page stayed locked after closing");

    // ── 7. nothing unmodelled, nothing on fire, and the pictures exist ────────
    assert.deepEqual(report.unexpectedCalls, [], "the page reached unmodelled bridge methods");
    assert.deepEqual(report.consoleErrors, [], "the run logged a console error");

    assert.ok(report.screenshots.includes("daily-note-focus.png"), "the run recorded no screenshot");
    assert.ok(
      report.screenshots.includes("daily-note-focus-analyze.png"),
      "the run recorded no picture of the page the act handed back",
    );
    // The picture of the moved act: the page at rest, the box, and Analyze note
    // on the box's foot.
    assert.ok(
      report.screenshots.includes("daily-note-footer.png"),
      "the run recorded no picture of the box's foot",
    );
    assert.equal(
      report.steps.footerShot?.file,
      "daily-note-footer.png",
      `the foot's picture is ${JSON.stringify(report.steps.footerShot?.file)}`,
    );
    assert.ok(
      (report.steps.footerShot?.bytes ?? 0) > 10_000,
      `the foot's picture is ${report.steps.footerShot?.bytes} bytes`,
    );
    assert.equal(fs.existsSync(FOOTER_SHOT), true, "driver captured no picture of the box's foot");
    const footerPng = fs.readFileSync(FOOTER_SHOT);
    assert.equal(
      footerPng.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "the foot's picture is not a PNG",
    );
    assert.ok(
      footerPng.length > 10_000,
      `the foot's picture is only ${footerPng.length} bytes`,
    );
    assert.equal(fs.existsSync(ANALYZE_SHOT), true, "driver captured no act picture");
    assert.ok(fs.statSync(ANALYZE_SHOT).size > 10_000, "the act picture is empty");
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
