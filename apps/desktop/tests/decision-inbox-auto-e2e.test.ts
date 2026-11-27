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
const REPORT = path.join(desktopRoot, "e2e/artifacts/decision-inbox-auto.json");
const ARTIFACT_SCREENSHOTS = [
  "decision-inbox-auto-opened.png",
  "decision-inbox-auto-motion-strip.png",
  "decision-inbox-auto-closed-by-hand.png",
  "decision-inbox-auto-closed.png",
  "decision-inbox-auto-settings.png",
  "decision-inbox-auto-stayed-open.png",
];

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CardRow = {
  id: string;
  title: string;
  status: string;
  actions: string[];
};

type SwitchRow = {
  testId: string;
  present: boolean;
  label: string | null;
  checked: boolean;
};

type Screen = {
  path: string | null;
  sheet: "decisions" | "settings" | null;
  decisionsOpen: boolean;
  settingsOpen: boolean;
  overlay: {
    box: Box;
    position: string;
    backdropFilter: string | null;
  } | null;
  title: string | null;
  cards: CardRow[];
  inboxEmpty: string | null;
  actionMessage: string | null;
  settingsView: string | null;
  settingsTitle: string | null;
  navLabels: string[];
  rowLabels: string[];
  switches: SwitchRow[];
  bodyOverflow: string;
  backgroundPage: boolean;
  workspace: {
    mounts: number;
    top: number;
    max: number;
    height: number;
    markerTop: number | null;
  };
  settings: { autoOpen: boolean; autoClose: boolean };
  updates: Array<{ decisionInbox?: { autoOpen?: boolean; autoClose?: boolean } }>;
  resolveCalls: Array<{ id: string; resolution: string }>;
  listCalls: number;
  motion: {
    closing: boolean;
    scrimAnimation: string;
    panelAnimation: string;
    panelDuration: string;
    panelEasing: string;
    panelOpacity: string;
    panelTransform: string;
    panelPlayState: string | null;
  } | null;
  arrived: string[];
  arrivalLine: string | null;
  newChips: number;
};

type Report = {
  url: string;
  window: { width: number; height: number };
  fixture: {
    workspaceTop: number;
    seededId: string;
    switchLabels: Record<string, string>;
  };
  states: Record<string, Screen>;
  steps: {
    scroll?: boolean;
    filedId?: string;
    sheetAppeared?: boolean;
    motionSeeked?: number;
    motionFinished?: number;
    closeByHand?: boolean;
    reopenClick?: boolean;
    autoCloseElapsedMs?: number;
    prefersReducedMotion?: boolean;
    reducedOpenClick?: boolean;
    reducedSheetAppeared?: boolean;
    reducedCloseClick?: boolean;
    motionStudyFile?: string;
    motionStudySheet?: boolean;
    motionStudyFrames?: number;
    approveFirstId?: string | null;
    approveFirst?: boolean;
    approveLastId?: string | null;
    approveLast?: boolean;
    settingsClick?: boolean;
    toggleOpenOff?: boolean;
    toggleOpenOn?: boolean;
    settingsClose?: boolean;
    setAutoOpenOff?: boolean;
    autoOpenOffId?: string;
    cleanupOpenClick?: boolean;
    cleanupApprove?: boolean;
    setAutoOpenOn?: boolean;
    setAutoCloseOff?: boolean;
    stayOpenFilingId?: string;
    approveStayOpen?: boolean;
    setAutoCloseOn?: boolean;
    filedWhileOpenId?: string;
    approveWhileOpen?: boolean;
  };
  screenshots: string[];
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
      [path.join(desktopRoot, "e2e/decision-inbox-auto.electron.mjs")],
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

const lastPatch = (state: Screen) => state.updates[state.updates.length - 1];

const switchBy = (state: Screen, testId: string) =>
  state.switches.find((entry) => entry.testId === testId);

describe("the decisions inbox that opens and closes itself", () => {
  it("opens over the page a new decision was filed on, closes itself after the last answer, and obeys both switches in Settings › Decisions", async (t) => {
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

    const {
      landing,
      parked,
      openedMotion,
      openedMotionMid,
      filed,
      closingMotion,
      closedByHand,
      reopened,
      afterFirstApprove,
      closed,
      reducedMotionOpen,
      reducedMotionClosed,
      settings,
      settingsToggledOff,
      settingsToggledOn,
      settingsClosed,
      autoOpenOffSet,
      autoOpenOff,
      cleanupOpened,
      cleanupClosed,
      autoOpenOn,
      stayedOpen,
      settingsForAutoClose,
      filedWhileOpen,
      autoClosedByLast,
    } = report.states;

    const openSwitch = "settings-decision-auto-open";
    const closeSwitch = "settings-decision-auto-close";

    // 1 — a queue that was already waiting must not pop the inbox at launch.
    assert.equal(landing.sheet, null, "a pre-existing queue opened the inbox on load");
    assert.equal(landing.path, "/work", "the rig did not start on its page");
    assert.equal(landing.backgroundPage, true, "the workspace never painted");
    assert.ok(landing.workspace.max > 0, "the workspace has nothing to scroll");
    assert.equal(landing.workspace.top, 0, "the workspace did not start at its top");
    assert.equal(
      landing.cards.length,
      0,
      "the inbox drew cards although no sheet is up",
    );

    // 2 — the operator is somewhere down the page, not at its top.
    assert.equal(report.steps.scroll, true, "the driver could not scroll the workspace");
    assert.equal(
      parked.workspace.top,
      report.fixture.workspaceTop,
      "the workspace did not park",
    );
    assert.notEqual(parked.workspace.markerTop, null, "the workspace marker is missing");

    // 3 — a filing raises the inbox over that page, not a navigation away.
    assert.ok(report.steps.filedId, "the driver filed no decision");
    assert.notEqual(report.steps.filedId, report.fixture.seededId);
    assert.equal(filed.sheet, "decisions", "the filing did not open the inbox");
    assert.equal(filed.path, "/decisions", "the inbox is not the /decisions sheet");
    assert.equal(filed.title, "Decisions", "the sheet does not name its surface");
    assert.equal(
      filed.backgroundPage,
      true,
      "opening the inbox unmounted the page behind it — the backdrop blurs nothing",
    );
    assert.equal(
      filed.workspace.mounts,
      parked.workspace.mounts,
      "auto-opening the inbox remounted the workspace",
    );
    assert.equal(
      filed.workspace.top,
      parked.workspace.top,
      "auto-opening the inbox moved the page behind it",
    );
    assert.equal(
      filed.workspace.markerTop,
      parked.workspace.markerTop,
      "the workspace's content shifted when the inbox opened",
    );
    assert.equal(filed.bodyOverflow, "hidden", "the page behind the inbox still scrolls");
    assert.ok(filed.overlay, "auto-opening painted no scrim over the page");
    assert.equal(filed.overlay!.position, "fixed", "the inbox scrim is not fixed");
    assert.equal(
      filed.overlay!.box.width,
      report.window.width,
      "the scrim does not cover the window's width",
    );
    assert.equal(
      filed.overlay!.box.height,
      report.window.height,
      "the scrim does not cover the window's height",
    );
    assert.match(
      filed.overlay!.backdropFilter ?? "",
      /blur\(/,
      `the page behind the inbox is not blurred: "${filed.overlay!.backdropFilter}"`,
    );
    assert.equal(
      filed.cards.length,
      2,
      "the inbox does not hold both the pre-existing and the filed decision",
    );
    assert.equal(
      filed.cards.some((card) => card.id === report.fixture.seededId),
      true,
      "the pre-existing decision never reached the inbox",
    );
    assert.equal(
      filed.cards.some((card) => card.id === report.steps.filedId),
      true,
      "the filed decision never reached the inbox",
    );

    // 3a — the sheet arrives in motion, not between two frames: the scrim dims
    //      first, the panel settles up from a hair below, and both come to rest.
    //      The mid-flight reading is taken at a chosen instant (seeked to 100ms
    //      of the 200ms), so it is a fact about the motion rather than about
    //      when the driver happened to sample.
    assert.equal(report.steps.sheetAppeared, true, "the sheet never mounted");
    assert.ok(openedMotion.motion, "no motion was measurable when the sheet mounted");
    const arriving = openedMotion.motion!;
    assert.equal(arriving.closing, false, "a freshly opened sheet is already closing");
    assert.equal(
      arriving.scrimAnimation,
      "sheet-scrim-in",
      `the scrim arrives with "${arriving.scrimAnimation}"`,
    );
    // The arrival is a linear fade plus a settle-curve rise: on the settle curve
    // alone a 200ms fade is ~97% done at its midpoint, which reads as a pop.
    assert.match(
      arriving.panelAnimation,
      /sheet-panel-fade-in/,
      `the panel's arrival has no fade: "${arriving.panelAnimation}"`,
    );
    assert.match(
      arriving.panelAnimation,
      /sheet-panel-rise-in/,
      `the panel's arrival has no rise: "${arriving.panelAnimation}"`,
    );
    const arrivalDurations = arriving.panelDuration.split(",").map((part) => part.trim());
    assert.deepEqual(
      arrivalDurations,
      ["0.2s", "0.2s"],
      `the panel arrival runs for ${arriving.panelDuration}, not two 200ms tracks`,
    );
    assert.match(
      arriving.panelEasing,
      /linear/,
      `the fade is not linear: "${arriving.panelEasing}"`,
    );
    assert.match(
      arriving.panelEasing,
      /cubic-bezier\(0\.23, 1, 0\.32, 1\)/,
      `the rise does not settle on the app's curve: "${arriving.panelEasing}"`,
    );
    assert.notEqual(
      arriving.panelPlayState,
      null,
      "the panel's arrival is declared but no animation object is running it",
    );
    assert.equal(
      report.steps.motionSeeked,
      3,
      "the arrival is not three animations (scrim + panel fade + panel rise)",
    );
    assert.ok(openedMotionMid.motion, "no motion reading at the seeked instant");
    const mid = openedMotionMid.motion!;
    const midOpacity = Number(mid.panelOpacity);
    assert.ok(
      midOpacity > 0.2 && midOpacity < 0.8,
      `the panel is at opacity ${mid.panelOpacity} 100ms into its 200ms arrival — the fade is not legible at its midpoint`,
    );
    assert.match(
      mid.panelTransform,
      /matrix/,
      `the panel does not move on the way in: "${mid.panelTransform}"`,
    );
    assert.notEqual(mid.panelTransform, "none", "the panel's arrival has no transform");
    assert.equal(report.steps.motionFinished, 3, "the arrival could not be played out");
    assert.ok(filed.motion, "the sheet has no motion at rest");
    assert.equal(
      filed.motion!.panelOpacity,
      "1",
      `the landed panel is still translucent: ${filed.motion!.panelOpacity}`,
    );
    // A landed transform computes to the identity matrix rather than the
    // `none` keyword, because the finished animation is still applying its
    // final keyframe. Either spelling is "at rest".
    assert.ok(
      filed.motion!.panelTransform === "none" ||
        filed.motion!.panelTransform === "matrix(1, 0, 0, 1, 0, 0)",
      `the landed panel is still displaced: ${filed.motion!.panelTransform}`,
    );

    // 3b — the card that caused the sheet to open wears the arrival mark, and
    //      the card that was already waiting does not. The page was not on
    //      screen when the filing happened, so this is the only mark it gets.
    assert.deepEqual(
      filed.arrived,
      [report.steps.filedId],
      `the cards marked new are ${JSON.stringify(filed.arrived)}`,
    );
    assert.equal(
      filed.arrived.includes(report.fixture.seededId),
      false,
      "the pre-existing decision was marked as new",
    );
    assert.equal(filed.newChips, 1, "the new card does not wear exactly one New chip");
    assert.match(
      filed.arrivalLine ?? "",
      /^New decision filed by Hermes\.$/,
      `the arrival line is "${filed.arrivalLine}"`,
    );

    // 3c — closing by hand leaves the same way: the exit motion plays before the
    //      route changes, then the page behind is handed back untouched.
    assert.equal(report.steps.closeByHand, true, "the sheet's cross could not be pressed");
    assert.ok(closingMotion.motion, "no exit motion was measurable after the cross");
    const leaving = closingMotion.motion!;
    assert.equal(leaving.closing, true, "the sheet did not enter its closing state");
    assert.equal(
      leaving.scrimAnimation,
      "sheet-scrim-out",
      `the scrim leaves with "${leaving.scrimAnimation}"`,
    );
    assert.match(
      leaving.panelAnimation,
      /sheet-panel-fade-out/,
      `the panel's exit has no fade: "${leaving.panelAnimation}"`,
    );
    assert.match(
      leaving.panelAnimation,
      /sheet-panel-drop-out/,
      `the panel's exit has no drop: "${leaving.panelAnimation}"`,
    );
    assert.deepEqual(
      leaving.panelDuration.split(",").map((part) => part.trim()),
      ["0.14s", "0.14s"],
      `the exit runs for ${leaving.panelDuration}, not two 140ms tracks`,
    );
    assert.equal(closedByHand.sheet, null, "the hand-closed sheet is still up");
    assert.equal(closedByHand.path, "/work", "the hand-closed sheet did not return to the page");
    assert.equal(
      closedByHand.workspace.mounts,
      parked.workspace.mounts,
      "the hand-closed sheet remounted the page behind it",
    );
    assert.equal(report.steps.reopenClick, true, "the inbox could not be reopened by hand");
    assert.equal(reopened.sheet, "decisions", "reopening by hand painted no sheet");
    assert.equal(reopened.cards.length, 2, "the reopened inbox lost a pending card");

    // 4 — approving one of two pending cards leaves the sheet up.
    assert.equal(report.steps.approveFirst, true, "the Approve control could not be pressed");
    assert.equal(afterFirstApprove.sheet, "decisions", "one answer closed the inbox early");
    assert.equal(afterFirstApprove.path, "/decisions", "the inbox left its route on one answer");
    assert.equal(afterFirstApprove.cards.length, 1, "one answer did not remove one card");
    assert.notEqual(
      afterFirstApprove.cards[0]?.id,
      report.steps.approveFirstId,
      "the approved decision is still in Pending",
    );
    assert.equal(
      afterFirstApprove.actionMessage,
      "Decision approved.",
      "the approve said nothing",
    );
    assert.deepEqual(
      afterFirstApprove.resolveCalls.map((call) => call.id),
      [report.steps.approveFirstId],
      "the card did not ask the vault to approve exactly that Decision",
    );

    // 5 — the last answer closes the sheet back onto the parked page.
    assert.equal(report.steps.approveLast, true, "the last Approve could not be pressed");
    assert.equal(closed.sheet, null, "the last answer did not auto-close the inbox");
    assert.equal(closed.path, "/work", "auto-close did not return to the page behind");
    assert.equal(closed.backgroundPage, true, "auto-close lost the page behind");
    assert.equal(
      closed.workspace.mounts,
      parked.workspace.mounts,
      "auto-close remounted the workspace",
    );
    assert.equal(
      closed.workspace.top,
      parked.workspace.top,
      "auto-close did not restore the operator's scroll position",
    );
    assert.equal(
      closed.workspace.markerTop,
      parked.workspace.markerTop,
      "auto-close moved the content the operator was reading",
    );
    assert.notEqual(
      closed.bodyOverflow,
      "hidden",
      "auto-close left the page scroll-locked",
    );
    assert.equal(
      closed.resolveCalls.length,
      2,
      "the second answer never reached the vault",
    );
    // The auto-close is not an instant disappearance: it plays the same 140ms
    // exit before the route changes. A close that skipped the motion would land
    // well under this floor (the answer path itself is a few milliseconds here).
    assert.equal(
      typeof report.steps.autoCloseElapsedMs,
      "number",
      "the driver did not time the auto-close",
    );
    assert.ok(
      report.steps.autoCloseElapsedMs! >= 100,
      `auto-close took ${report.steps.autoCloseElapsedMs}ms — the exit motion was skipped`,
    );

    // 6 — Settings › Decisions, reached through the real settings sheet.
    assert.equal(report.steps.settingsClick, true, "the settings link could not be pressed");
    assert.equal(settings.sheet, "settings", "the settings link did not open settings");
    assert.equal(
      settings.path,
      "/settings?tab=decisions",
      "the settings sheet did not land on its Decisions page",
    );
    assert.equal(
      settings.backgroundPage,
      true,
      "opening settings unmounted the page behind it",
    );
    assert.equal(settings.settingsView, "decisions", "the Decisions panel is not the open page");
    assert.equal(settings.settingsTitle, "Decisions", "the Decisions section has no heading");
    assert.equal(
      settings.navLabels.includes("Decisions"),
      true,
      `the settings nav has no Decisions entry: ${JSON.stringify(settings.navLabels)}`,
    );
    assert.equal(settings.switches.length, 2, "the Decisions section does not render two switches");
    for (const entry of settings.switches) {
      assert.equal(entry.present, true, `${entry.testId} has no role=switch control`);
      assert.equal(
        entry.label,
        report.fixture.switchLabels[entry.testId],
        `${entry.testId} has the wrong accessible name: ${entry.label}`,
      );
      assert.equal(entry.checked, true, `${entry.testId} is not ON by default`);
    }
    assert.ok(
      settings.rowLabels.some((label) => /open for a new decision/i.test(label)),
      `the auto-open row has no visible label: ${JSON.stringify(settings.rowLabels)}`,
    );
    assert.ok(
      settings.rowLabels.some((label) => /close after the last decision/i.test(label)),
      `the auto-close row has no visible label: ${JSON.stringify(settings.rowLabels)}`,
    );

    // The real toggle writes the real bridge patch, carrying the whole object.
    assert.equal(report.steps.toggleOpenOff, true, "the auto-open switch could not be pressed");
    assert.equal(
      switchBy(settingsToggledOff, openSwitch)?.checked,
      false,
      "the auto-open switch did not move off",
    );
    assert.equal(
      switchBy(settingsToggledOff, closeSwitch)?.checked,
      true,
      "turning auto-open off moved the auto-close switch",
    );
    assert.equal(
      lastPatch(settingsToggledOff)?.decisionInbox?.autoOpen,
      false,
      "the panel did not send decisionInbox.autoOpen === false",
    );
    assert.equal(
      lastPatch(settingsToggledOff)?.decisionInbox?.autoClose,
      true,
      "the panel did not send the current auto-close value with the patch",
    );
    assert.equal(settingsToggledOff.settings.autoOpen, false, "the vault accepted no auto-open write");
    assert.equal(settingsToggledOff.settings.autoClose, true, "the vault lost its auto-close value");

    assert.equal(report.steps.toggleOpenOn, true, "the auto-open switch could not be pressed back on");
    assert.equal(
      switchBy(settingsToggledOn, openSwitch)?.checked,
      true,
      "the auto-open switch did not move back on",
    );
    assert.equal(
      lastPatch(settingsToggledOn)?.decisionInbox?.autoOpen,
      true,
      "the panel did not send decisionInbox.autoOpen === true",
    );
    assert.equal(settingsToggledOn.settings.autoOpen, true, "the vault did not keep auto-open on");

    // 7 — auto-open off: the filing raises nothing and the page is untouched.
    assert.equal(report.steps.settingsClose, true, "the settings cross could not be pressed");
    assert.equal(settingsClosed.sheet, null, "the settings cross did not close the sheet");
    assert.equal(settingsClosed.path, "/work", "closing settings did not return to the page");
    assert.equal(report.steps.setAutoOpenOff, true, "the auto-open setting could not be written off");
    assert.equal(
      autoOpenOffSet.settings.autoOpen,
      false,
      "the app's own settings write did not turn auto-open off",
    );
    assert.ok(report.steps.autoOpenOffId, "the driver filed no decision with auto-open off");
    assert.equal(autoOpenOff.sheet, null, "auto-open off still raised the inbox");
    assert.equal(autoOpenOff.path, "/work", "the filing with auto-open off changed the route");
    assert.equal(
      autoOpenOff.workspace.mounts,
      parked.workspace.mounts,
      "the filing with auto-open off remounted the workspace",
    );
    assert.equal(
      autoOpenOff.workspace.top,
      parked.workspace.top,
      "the filing with auto-open off moved the page",
    );

    // The deliberately unopened queue was cleared through the real inbox, so the
    // next step's "the only pending decision" is a fact.
    assert.equal(cleanupOpened.sheet, "decisions", "the inbox could not be opened by hand");
    assert.equal(cleanupOpened.cards.length, 1, "the unopened filing is not in the inbox");
    assert.equal(
      cleanupOpened.cards[0]?.id,
      report.steps.autoOpenOffId,
      "the inbox does not hold the decision filed with auto-open off",
    );
    assert.equal(report.steps.cleanupApprove, true, "the cleanup Approve could not be pressed");
    assert.equal(
      cleanupClosed.sheet,
      null,
      "answering the last decision did not hand the page back",
    );
    assert.equal(cleanupClosed.path, "/work", "the cleanup answer did not return to /work");

    // 8 — auto-open on, auto-close off: it opens, answers, and stays.
    assert.equal(report.steps.setAutoOpenOn, true, "auto-open could not be turned back on");
    assert.equal(report.steps.setAutoCloseOff, true, "auto-close could not be turned off");
    assert.ok(report.steps.stayOpenFilingId, "the driver filed no decision for the stay-open case");
    assert.equal(autoOpenOn.sheet, "decisions", "auto-open on did not raise the inbox");
    assert.equal(autoOpenOn.path, "/decisions", "auto-open on did not navigate to the inbox");
    assert.equal(autoOpenOn.cards.length, 1, "the inbox does not hold the one pending decision");
    assert.equal(
      autoOpenOn.cards[0]?.id,
      report.steps.stayOpenFilingId,
      "the inbox's only card is not the filed decision",
    );
    assert.equal(
      autoOpenOn.workspace.mounts,
      parked.workspace.mounts,
      "auto-open on remounted the workspace",
    );
    assert.equal(report.steps.approveStayOpen, true, "the stay-open Approve could not be pressed");
    assert.equal(
      stayedOpen.sheet,
      "decisions",
      "auto-close off still closed the answered inbox",
    );
    assert.equal(stayedOpen.path, "/decisions", "auto-close off left the inbox route");
    assert.equal(stayedOpen.cards.length, 0, "the answered card is still in Pending");
    assert.equal(
      stayedOpen.inboxEmpty,
      "No pending proposals.",
      `the empty inbox does not say so: "${stayedOpen.inboxEmpty}"`,
    );
    assert.equal(
      stayedOpen.actionMessage,
      "Decision approved.",
      "the approve said nothing",
    );
    assert.equal(stayedOpen.settings.autoClose, false, "the vault did not record auto-close off");

    // 9 — auto-close on while the sheet is up: a filing arrives in place, and
    //     the last answer closes back onto the workspace.
    assert.equal(report.steps.setAutoCloseOn, true, "auto-close could not be turned back on");
    assert.equal(
      settingsForAutoClose.settings.autoClose,
      true,
      "the vault did not record auto-close on",
    );
    assert.ok(report.steps.filedWhileOpenId, "the driver filed no decision into the open sheet");
    assert.equal(
      filedWhileOpen.sheet,
      "decisions",
      "the filing while the sheet was up closed or re-raised the sheet",
    );
    assert.equal(
      filedWhileOpen.path,
      "/decisions",
      "the filing while the sheet was up navigated again",
    );
    assert.equal(filedWhileOpen.cards.length, 1, "the new card did not arrive in the open sheet");
    assert.equal(
      filedWhileOpen.cards[0]?.id,
      report.steps.filedWhileOpenId,
      "the open sheet's card is not the filing",
    );
    assert.equal(report.steps.approveWhileOpen, true, "the final Approve could not be pressed");
    assert.equal(
      autoClosedByLast.sheet,
      null,
      "turning auto-close on did not close the answered inbox",
    );
    assert.equal(autoClosedByLast.path, "/work", "the final auto-close did not return to /work");
    assert.equal(
      autoClosedByLast.workspace.mounts,
      parked.workspace.mounts,
      "the final auto-close remounted the workspace",
    );
    assert.equal(
      autoClosedByLast.workspace.top,
      parked.workspace.top,
      "the final auto-close moved the operator's scroll position",
    );
    assert.equal(
      autoClosedByLast.workspace.markerTop,
      parked.workspace.markerTop,
      "the final auto-close moved the content the operator was reading",
    );
    assert.notEqual(
      autoClosedByLast.bodyOverflow,
      "hidden",
      "the final auto-close left the page scroll-locked",
    );

    // 10 — reduced motion: the frame still arrives and still leaves, but nothing
    //      moves and the close does not wait for a motion that is not playing.
    assert.equal(
      report.steps.prefersReducedMotion,
      true,
      "prefers-reduced-motion could not be emulated, so the guard is unproven",
    );
    assert.equal(reducedMotionOpen.sheet, "decisions", "the sheet did not open under reduced motion");
    assert.ok(reducedMotionOpen.motion, "the reduced-motion sheet has no motion reading");
    assert.equal(
      reducedMotionOpen.motion!.panelAnimation,
      "none",
      `the panel still animates under reduced motion: "${reducedMotionOpen.motion!.panelAnimation}"`,
    );
    assert.equal(
      reducedMotionOpen.motion!.scrimAnimation,
      "none",
      `the scrim still animates under reduced motion: "${reducedMotionOpen.motion!.scrimAnimation}"`,
    );
    assert.equal(report.steps.reducedCloseClick, true, "the reduced-motion cross could not be pressed");
    assert.equal(
      reducedMotionClosed.sheet,
      null,
      "under reduced motion the close waited for a motion that never played",
    );
    assert.equal(
      reducedMotionClosed.path,
      "/work",
      "the reduced-motion close did not hand the page back",
    );

    // The motion as a study: the arrival frozen at start/mid/end (the strip),
    // and a slowed replay encoded as a film because a still cannot show a
    // settle. The clip's durations are deliberately not the shipped ones — the
    // report above measures those — it exists to show the gesture's shape.
    assert.ok(
      (report.steps.motionStudyFrames ?? 0) >= 12,
      `the motion study captured ${report.steps.motionStudyFrames} frames`,
    );
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "e2e/artifacts/decision-inbox-auto-motion.mp4")),
      true,
      "the motion study wrote no film",
    );
    assert.equal(
      fs.existsSync(
        path.join(desktopRoot, "e2e/artifacts/decision-inbox-auto-motion/frame-000.png"),
      ),
      true,
      "the motion study kept no frames",
    );

    // The repeatable artifact: a JSON report plus the frames it measured.
    for (const shot of ARTIFACT_SCREENSHOTS) {
      assert.ok(
        report.screenshots.includes(shot),
        `the run did not record ${shot}`,
      );
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", shot)),
        true,
        `${shot} was reported but not written`,
      );
    }
  });
});
