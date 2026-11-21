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
const REPORT = path.join(desktopRoot, "e2e/artifacts/decisions-latency.json");
const ARTIFACT_SCREENSHOT = "decisions-latency.png";
const ARTIFACT_PNG = path.join(desktopRoot, "e2e/artifacts", ARTIFACT_SCREENSHOT);
const HISTORY_SCREENSHOT = "decisions-latency-history.png";
const HISTORY_PNG = path.join(desktopRoot, "e2e/artifacts", HISTORY_SCREENSHOT);

/**
 * How much faster than the old order the final answer has to be.
 *
 * The old order spent three full list reads and one snapshot refresh before it
 * asked the sheet to close; with the rig's stubbed costs (900 ms `decision:list`,
 * 800 ms `vaultGetSnapshot`) that is ~2.5 s. The frame's own exit motion is
 * ~140 ms, so anything under 400 ms can only come from closing on the write.
 * The measured number is in the report and quoted in the failure message.
 */
const SHEET_GONE_BUDGET_MS = 400;

type CardRow = {
  id: string;
  title: string;
  status: string;
  actions: string[];
};

type Screen = {
  path: string | null;
  overlay: { closing: boolean; panel: boolean } | null;
  activeTab: string | null;
  loading: boolean;
  title: string | null;
  subtitle: string | null;
  cards: CardRow[];
  historyMore: { text: string; button: boolean } | null;
  ellipsisButtons: string[];
  empty: string | null;
  error: string | null;
  actionMessage: string | null;
  bodyOverflow: string;
  workspace: { present: boolean; heading: string | null };
  autoClose: boolean;
  resolves: Array<{ id: string; resolution: string }>;
};

type Probe = {
  id: string;
  resolution: "approved" | "rejected";
  clickAt: number;
  cardGoneAt: number | null;
  overlayGoneAt: number | null;
  sheetGoneAt: number | null;
  pathAtSheetGone: string | null;
  workspaceAtSheetGone: boolean | null;
  bodyOverflowAtSheetGone: string | null;
};

type TimedCall = { at: number; end: number | null; delayMs: number };

type Leg = {
  pass: boolean;
  detail: Record<string, unknown>;
};

type WorkspaceSample = {
  mounts: number;
  scrollTop: number;
  heading: string | null;
  probe: {
    runs: number;
    renders: number;
    revision: number;
    generation: number;
    lastRunAt: number | null;
  };
};

type Report = {
  url: string;
  ranAt: string;
  window: { width: number; height: number };
  fixture: {
    listDelayMs: number;
    snapshotDelayMs: number;
    seed: number;
    historySeed: number;
  };
  states: Record<string, Screen>;
  steps: Record<string, unknown>;
  latency: {
    leg1: {
      clickAt: number | null;
      cardGoneAt: number | null;
      clickToCardGoneMs: number | null;
      sheetStayedUp: boolean;
    };
    leg2: {
      clickAt: number | null;
      cardGoneAt: number | null;
      overlayGoneAt: number | null;
      sheetGoneAt: number | null;
      clickToCardGoneMs: number | null;
      clickToOverlayGoneMs: number | null;
      clickToSheetGoneMs: number | null;
      pathAtSheetGone: string | null;
      workspaceAtSheetGone: boolean | null;
      bodyOverflowAtSheetGone: string | null;
    };
  };
  answerWindow: {
    from: number | null;
    to: number | null;
    decisionListCalls: number;
    decisionListOffsetsMs: Array<number | null>;
    vaultGetSnapshotCallsBeforeSheetGone: number;
  };
  bookkeeping: {
    decisionListCallsAfterClick: number;
    decisionListReRead: boolean;
    decisionListAnsweredAfterSheetGone: number;
    decisionListDeferred: boolean;
    vaultGetSnapshotCallsAfterClick: number;
    vaultGetSnapshotRefreshed: boolean;
    vaultGetSnapshotAnsweredAfterSheetGone: number;
    vaultGetSnapshotDeferred: boolean;
  };
  calls: {
    list: TimedCall[];
    snapshot: TimedCall[];
    resolves: Array<{ id: string; resolution: string }>;
    bridge: Array<{ name: string; at: number }>;
    unexpected: Array<{ name: string; at: number }>;
  };
  capture: {
    shot: string;
    clickToCaptureMs: number;
    path: string | null;
    overlay: Screen["overlay"];
    workspace: Screen["workspace"];
    bodyOverflow: string;
    frames?: Array<{ paint: { kind: string; ms: number }; bytes: number }>;
    surfaceStable?: boolean;
    bytes?: number;
  };
  hold: {
    runs: {
      before: number | null;
      covered: number | null;
      afterClose: number | null;
      afterSettle: number | null;
      coveredDelta: number | null;
      closeWave: number | null;
      followUp: number | null;
      total: number | null;
    };
    values: {
      before: { revision: number | null; generation: number | null };
      covered: { revision: number | null; generation: number | null };
      afterClose: { revision: number | null; generation: number | null };
      afterSettle: { revision: number | null; generation: number | null };
    };
    live: {
      before: { revision: number; generation: number } | null;
      whileCovered: { revision: number; generation: number } | null;
      afterClose: { revision: number; generation: number } | null;
      afterSettle: { revision: number; generation: number } | null;
    };
    vaultRevision: {
      whileCovered: number | null;
      afterClose: number | null;
      afterSettle: number | null;
    };
    workspace: {
      before: WorkspaceSample | null;
      whileCovered: WorkspaceSample | null;
      afterClose: WorkspaceSample | null;
      afterSettle: WorkspaceSample | null;
    };
  };
  history: {
    seed: number;
    pageSize: number;
    press: {
      clickAt: number | null;
      firstCardAt: number | null;
      paintAt: number | null;
      paintKind: string | null;
      clickToCardMs: number | null;
      clickToPaintMs: number | null;
      cardsAtPaint: number | null;
    };
    firstPage: { cards: number | null; footer: string | null; activeTab: string | null };
    secondPage: { cards: number | null; footer: string | null };
    thirdPage: { cards: number | null; footer: string | null; footerPresent: boolean };
    tabReset: { cards: number | null; footer: string | null };
    filterReset: { cards: number | null; footer: string | null; activeTab: string | null };
    capture: string | null;
  };
  legs: Record<string, Leg>;
  screenshots: string[];
  consoleErrors: string[];
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
      [path.join(desktopRoot, "e2e/decisions-latency.electron.mjs")],
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

describe("answering the last pending Decision hands the page back immediately", () => {
  it("closes the sheet on the write, then does the reads behind it, and keeps the other answers honest", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(ARTIFACT_PNG, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, [], "the driver threw before it finished");
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // The stubbed costs are the defect's conditions; a run with cheaper reads
    // would pass this test while the operator still waits a second and a half.
    assert.equal(
      report.fixture.listDelayMs,
      900,
      "the stubbed decision:list cost is not the operator-scale 900 ms",
    );
    assert.equal(
      report.fixture.snapshotDelayMs,
      800,
      "the stubbed vaultGetSnapshot cost is not the operator-scale 800 ms",
    );
    assert.deepEqual(
      report.calls.unexpected,
      [],
      "the page called a bridge method this rig does not model",
    );

    // ── leg 1 — a non-last answer leaves the card, not the sheet ─────────────
    const leg1Id = report.steps.leg1CardId as string;
    const leg1Sample = report.states.leg1CardGone;
    const leg1Probe = report.states.leg1Probe
      ? (JSON.parse(JSON.stringify(report.states.leg1Probe)) as Probe)
      : null;
    assert.ok(leg1Id, "the driver never named the first card");
    assert.equal(
      (report.steps.leg1Answer as { clicked?: boolean })?.clicked,
      true,
      "the first card's Approve control could not be pressed",
    );
    assert.ok(leg1Sample, "no sample was taken after the first answer");
    assert.notEqual(leg1Sample.overlay, null, "answering a non-last card closed the sheet");
    assert.equal(leg1Sample.path, "/decisions", "a non-last answer changed the route");
    assert.equal(leg1Sample.cards.length, 1, "the answered card did not leave the queue");
    assert.equal(
      leg1Sample.cards.some((card) => card.id === leg1Id),
      false,
      "the answered card is still drawn in Pending",
    );
    assert.deepEqual(
      leg1Sample.ellipsisButtons,
      [],
      "a control is stuck on '…' after the answer landed",
    );
    assert.equal(
      leg1Sample.actionMessage,
      "Decision approved.",
      "the page did not say what the answer did",
    );
    assert.equal(
      report.latency.leg1.sheetStayedUp,
      true,
      `the sheet was already closing/leaving after a non-last answer (sheetGoneAt present)`,
    );
    assert.ok(
      report.latency.leg1.clickToCardGoneMs !== null &&
        report.latency.leg1.clickToCardGoneMs < SHEET_GONE_BUDGET_MS,
      `the answered card took ${report.latency.leg1.clickToCardGoneMs} ms to leave, not < ${SHEET_GONE_BUDGET_MS} ms`,
    );
    assert.equal(report.legs.leg1?.pass, true, "leg 1 is not satisfied");

    // ── leg 2 — the LAST answer closes on the write, not on the reads ────────
    const sheetGoneMs = report.latency.leg2.clickToSheetGoneMs;
    assert.notEqual(sheetGoneMs, null, "the sheet never left after the last answer");
    assert.ok(
      sheetGoneMs! < SHEET_GONE_BUDGET_MS,
      `click -> sheet gone measured ${sheetGoneMs} ms; the budget is < ${SHEET_GONE_BUDGET_MS} ms ` +
        `(reads are stubbed at ${report.fixture.listDelayMs} ms + ${report.fixture.snapshotDelayMs} ms, ` +
        `so the old order measured ~2.5 s)`,
    );
    assert.ok(
      report.latency.leg2.clickToCardGoneMs !== null &&
        report.latency.leg2.clickToCardGoneMs <= sheetGoneMs!,
      "the card did not leave before the sheet did",
    );
    assert.ok(
      report.latency.leg2.overlayGoneAt !== null,
      "the sheet's frame removal was never observed",
    );
    assert.equal(
      report.latency.leg2.pathAtSheetGone,
      "/work",
      "the route behind the sheet was not the workspace when the sheet left",
    );
    assert.equal(
      report.latency.leg2.workspaceAtSheetGone,
      true,
      "the workspace page was not mounted when the sheet left",
    );
    assert.notEqual(
      report.latency.leg2.bodyOverflowAtSheetGone,
      "hidden",
      "closing left the page behind scroll-locked",
    );
    const afterSheetGone = report.states.afterSheetGone;
    assert.equal(afterSheetGone.overlay, null, "the sheet is back on screen after the last answer");
    assert.equal(afterSheetGone.path, "/work", "the last answer did not return to the page behind");
    assert.equal(afterSheetGone.workspace.present, true, "the page behind the sheet is missing");
    assert.equal(report.legs.leg2?.pass, true, "leg 2 is not satisfied");

    // ── leg 3 — the reads were deferred, not deleted; no card comes back ─────
    assert.equal(
      report.bookkeeping.decisionListReRead,
      true,
      "the answer path deleted the decision:list re-read instead of deferring it",
    );
    assert.equal(
      report.bookkeeping.decisionListDeferred,
      true,
      "no decision:list re-read was still in flight when the sheet left — it was dropped, not deferred",
    );
    assert.equal(
      report.bookkeeping.vaultGetSnapshotRefreshed,
      true,
      "the answer path deleted the vault snapshot refresh",
    );
    assert.equal(
      report.bookkeeping.vaultGetSnapshotDeferred,
      true,
      "the vault snapshot refresh finished before the sheet left — nothing was deferred",
    );
    assert.ok(
      report.bookkeeping.decisionListCallsAfterClick >= 1,
      "no decision:list call was made after the answer at all",
    );
    assert.ok(
      report.bookkeeping.vaultGetSnapshotCallsAfterClick >= 1,
      "no vaultGetSnapshot call was made after the answer at all",
    );

    // The resolved cards must never reappear as pending, and History must hold
    // them — the background read drew the vault's own state, not the page's
    // optimism.
    assert.notEqual(report.states.reopenedPending.overlay, null, "the re-opened sheet is missing");
    assert.deepEqual(
      report.states.reopenedPending.cards,
      [],
      "a resolved card came back as pending on the re-opened sheet",
    );
    assert.match(
      report.states.reopenedPending.empty ?? "",
      /No pending proposals/,
      "the re-opened inbox does not say the queue is empty",
    );
    const leg2Id = report.steps.leg2CardId as string;
    const historyIds = report.states.reopenedHistory.cards.map((card) => card.id);
    assert.ok(leg1Id && historyIds.includes(leg1Id), "the first answer is missing from History");
    assert.ok(leg2Id && historyIds.includes(leg2Id), "the last answer is missing from History");
    for (const card of report.states.reopenedHistory.cards) {
      assert.equal(
        card.status.toLowerCase(),
        "approved",
        `History draws ${card.id} as "${card.status}", not approved`,
      );
    }
    assert.equal(report.legs.leg3?.pass, true, "leg 3 is not satisfied");

    // ── leg 4 — one answer is not a read storm ────────────────────────────────
    const listCalls = report.answerWindow.decisionListCalls;
    assert.equal(
      typeof listCalls,
      "number",
      "the driver did not count the decision:list calls in the answer window",
    );
    assert.ok(
      listCalls >= 1,
      "no decision:list call was made in the answer window — the re-read was deleted",
    );
    assert.ok(
      listCalls <= 2,
      `${listCalls} decision:list calls were made between the click and the sheet leaving; ` +
        `the fixed page budgets 2 (one bookkeeping read + the live-revision read), the old order made 3+`,
    );
    assert.ok(
      report.answerWindow.decisionListOffsetsMs.every(
        (offset) => offset !== null && offset <= 250,
      ),
      `the answer's list reads were not fired up front: ${JSON.stringify(
        report.answerWindow.decisionListOffsetsMs,
      )}`,
    );
    assert.equal(report.legs.leg4?.pass, true, "leg 4 is not satisfied");

    // ── leg 5 — auto-close OFF keeps the sheet up ────────────────────────────
    const autoCloseOff = report.states.autoCloseOff;
    assert.equal(
      report.steps.autoCloseSetting,
      false,
      "the auto-close-off run did not seed Settings › Decisions › auto-close as off",
    );
    assert.notEqual(autoCloseOff.overlay, null, "auto-close OFF closed the sheet anyway");
    assert.equal(autoCloseOff.path, "/decisions", "auto-close OFF left the sheet's route");
    assert.equal(autoCloseOff.cards.length, 0, "the last card did not leave the queue");
    assert.equal(autoCloseOff.autoClose, false, "the inbox did not read auto-close as off");
    const autoCloseProbe = report.states.autoCloseOffProbe as unknown as Probe | null;
    assert.equal(
      autoCloseProbe?.sheetGoneAt ?? null,
      null,
      "the sheet left even though auto-close is off",
    );
    assert.equal(report.legs.leg5?.pass, true, "leg 5 is not satisfied");

    // ── leg 6 — a refused write keeps the card and says why ──────────────────
    const refused = report.states.failedResolve;
    assert.equal(
      (report.steps.failedResolveAnswer as { clicked?: boolean })?.clicked,
      true,
      "the refused-write card's Approve control could not be pressed",
    );
    assert.notEqual(refused.overlay, null, "a refused write closed the sheet");
    assert.equal(refused.cards.length, 1, "a refused write removed the card");
    assert.equal(
      refused.cards[0]?.status.toLowerCase(),
      "pending",
      "the refused card is no longer pending",
    );
    assert.match(
      refused.error ?? "",
      /refused/i,
      `the refusal was not shown in the sheet: "${refused.error}"`,
    );
    assert.equal(
      (report.states.failedResolveCalls as unknown as { resolveFailures?: number })
        ?.resolveFailures,
      1,
      "the failed-write leg did not actually refuse exactly one write",
    );
    const failedProbe = report.states.failedResolveProbe as unknown as Probe | null;
    assert.equal(
      failedProbe?.sheetGoneAt ?? null,
      null,
      "the sheet left after a failed write",
    );
    assert.equal(report.legs.leg6?.pass, true, "leg 6 is not satisfied");

    // ── leg 7 — the page behind the sheet is held still ──────────────────────
    //
    // The shape is the contract: zero query runs while covered even though the
    // stub's revision AND the vault's reloadGeneration both advanced under the
    // hold; one catch-up run when the sheet leaves; one follow-up when the
    // single in-flight snapshot refresh lands — two runs for two answers, not
    // one per write per signal (the old code was an order of magnitude worse).
    const hold = report.hold;
    const workspaceBefore = hold.workspace.before;
    const workspaceAfterClose = hold.workspace.afterClose;
    const workspaceAfterSettle = hold.workspace.afterSettle;
    assert.equal(
      hold.runs.coveredDelta,
      0,
      `the covered page's query ran ${hold.runs.coveredDelta} time(s) while the sheet was over it ` +
        `(runs ${hold.runs.before} -> ${hold.runs.covered})`,
    );
    assert.deepEqual(
      hold.values.covered,
      hold.values.before,
      "the held revision/generation moved while the sheet covered the page",
    );
    assert.ok(
      (hold.live.whileCovered?.revision ?? -1) > hold.values.covered.revision!,
      `the live revision did not advance under the cover (live ${hold.live.whileCovered?.revision}, ` +
        `held ${hold.values.covered.revision}) — the freeze would prove nothing`,
    );
    assert.ok(
      (hold.live.whileCovered?.generation ?? -1) >
        hold.values.covered.generation!,
      `the live reloadGeneration did not advance under the cover ` +
        `(live ${hold.live.whileCovered?.generation}, held ${hold.values.covered.generation}) — ` +
        `the freeze would prove nothing`,
    );
    assert.equal(
      hold.vaultRevision.whileCovered,
      hold.live.whileCovered?.revision,
      "the stub's revision and the live revision disagree while the page is covered",
    );
    assert.equal(
      hold.runs.closeWave,
      1,
      `leaving the sheet produced ${hold.runs.closeWave} query run(s), not exactly one catch-up wave`,
    );
    assert.deepEqual(
      hold.values.afterClose,
      {
        revision: hold.live.afterClose?.revision ?? null,
        generation: hold.live.afterClose?.generation ?? null,
      },
      "the close wave did not hand the page the live revision/generation of that instant",
    );
    assert.equal(
      hold.runs.followUp,
      1,
      `the single in-flight refresh after the close produced ${hold.runs.followUp} extra run(s), not one`,
    );
    assert.deepEqual(
      hold.values.afterSettle,
      {
        revision: hold.live.afterSettle?.revision ?? null,
        generation: hold.live.afterSettle?.generation ?? null,
      },
      "the page never caught up with the deferred refresh",
    );
    assert.equal(
      hold.vaultRevision.afterSettle,
      hold.live.afterSettle?.revision,
      "the page's caught-up revision is not the stub vault's revision",
    );
    assert.ok(
      hold.runs.total !== null && hold.runs.total <= 2,
      `two answers produced ${hold.runs.total} page query runs; the fixed page budgets <= 2`,
    );
    assert.ok(workspaceBefore, "no baseline workspace sample was recorded");
    assert.equal(
      workspaceAfterClose?.mounts,
      workspaceBefore!.mounts,
      "closing the sheet remounted the page behind it",
    );
    assert.equal(
      workspaceAfterSettle?.mounts,
      workspaceBefore!.mounts,
      "the page behind the sheet was remounted after the sheet left",
    );
    assert.equal(
      workspaceAfterClose?.heading,
      workspaceBefore!.heading,
      "the workspace heading changed while the sheet was up",
    );
    assert.ok(
      workspaceBefore!.scrollTop > 0,
      "the workspace was not parked down its page before the sheet opened",
    );
    assert.equal(
      workspaceAfterClose?.scrollTop,
      workspaceBefore!.scrollTop,
      "the covered page's scroll position moved while the sheet was up",
    );
    assert.equal(
      workspaceAfterSettle?.scrollTop,
      workspaceBefore!.scrollTop,
      "the page's scroll position moved after the sheet left",
    );
    assert.equal(report.legs.leg7?.pass, true, "leg 7 is not satisfied");

    // ── leg 8 — History is one page of fifty, and offers the rest ────────────
    const history = report.history;
    assert.equal(
      history.firstPage.cards,
      50,
      `the first History page drew ${history.firstPage.cards} cards; it must draw exactly 50 of 120`,
    );
    assert.equal(history.firstPage.activeTab, "History", "the first page was not History");
    assert.equal(
      history.firstPage.footer,
      "Showing 50 of 120 decisions.",
      `the first page's pager line is "${history.firstPage.footer}"`,
    );
    assert.equal(
      history.secondPage.cards,
      100,
      `one Load older press drew ${history.secondPage.cards} cards, not 100`,
    );
    assert.equal(
      history.secondPage.footer,
      "Showing 100 of 120 decisions.",
      `the second page's pager line is "${history.secondPage.footer}"`,
    );
    assert.equal(
      history.thirdPage.cards,
      120,
      `two Load older presses drew ${history.thirdPage.cards} cards, not 120`,
    );
    assert.equal(
      history.thirdPage.footerPresent,
      false,
      `the pager is still offered at 120 of 120: "${history.thirdPage.footer}"`,
    );
    assert.equal(
      history.tabReset.cards,
      50,
      `History -> Pending -> History drew ${history.tabReset.cards} cards, not one page`,
    );
    assert.equal(
      history.tabReset.footer,
      "Showing 50 of 120 decisions.",
      `the tab round trip's pager line is "${history.tabReset.footer}"`,
    );
    assert.equal(
      history.filterReset.cards,
      50,
      `the AI source filter drew ${history.filterReset.cards} cards, not one page`,
    );
    assert.equal(
      history.filterReset.footer,
      "Showing 50 of 120 resolved decisions.",
      `the AI filter's pager line is "${history.filterReset.footer}"`,
    );
    assert.equal(
      history.press.paintKind,
      "frame",
      `History's first frame never fired (${history.press.paintKind})`,
    );
    assert.ok(
      history.press.clickToPaintMs !== null,
      "History's first paint was never timed",
    );
    assert.ok(
      history.press.clickToPaintMs! < 5000,
      `History's first page took ${history.press.clickToPaintMs} ms to paint`,
    );
    assert.ok(
      history.press.clickToCardMs !== null &&
        history.press.clickToPaintMs !== null &&
        history.press.clickToCardMs <= history.press.clickToPaintMs,
      "History's first card reached the DOM after its first frame",
    );
    assert.equal(
      history.capture,
      HISTORY_SCREENSHOT,
      "the History artefact was not written",
    );
    assert.equal(report.legs.leg8?.pass, true, "leg 8 is not satisfied");

    // ── the repeatable artifact: a JSON report and the frames it measured ────
    assert.deepEqual(
      report.screenshots,
      [ARTIFACT_SCREENSHOT, HISTORY_SCREENSHOT],
      "the run did not record exactly the two artefact pictures",
    );
    assert.equal(fs.existsSync(ARTIFACT_PNG), true, `${ARTIFACT_SCREENSHOT} was not written`);
    const png = fs.statSync(ARTIFACT_PNG);
    assert.ok(png.size > 10_000, `the artefact picture is only ${png.size} bytes`);
    // The picture is of the moment the sheet left, not of a later page.
    assert.equal(report.capture.path, "/work", "the artefact was captured off the workspace route");
    assert.equal(report.capture.overlay, null, "the artefact shows the sheet still up");
    assert.equal(
      report.capture.workspace.present,
      true,
      "the artefact shows no workspace page behind the sheet",
    );
    assert.equal(
      report.capture.workspace.heading,
      "Quarterly planning",
      "the artefact does not show the workspace page the operator was reading",
    );
    const captureFrames = report.capture.frames ?? [];
    assert.ok(
      captureFrames.length >= 2,
      `the artefact was captured from ${captureFrames.length} forced frame(s), so freshness is unproven`,
    );
    for (const [index, frame] of captureFrames.entries()) {
      assert.equal(
        frame.paint.kind,
        "frame",
        `forced frame ${index + 1} never fired (${frame.paint.kind}); the picture could be a cached surface`,
      );
    }
    assert.equal(
      report.capture.surfaceStable,
      true,
      `the surface was still changing across ${captureFrames.length} captures, so the artefact is not the settled page`,
    );
    // The capture has to wake a hidden window's compositor and force frames, so
    // it costs a few hundred milliseconds on top of the close. The old order
    // could not have photographed the page behind the sheet before ~2.5 s: it
    // had not closed yet.
    assert.ok(
      report.capture.clickToCaptureMs < 1500,
      `the artefact was captured ${report.capture.clickToCaptureMs} ms after the click, not just after the sheet left`,
    );

    // The second picture: History's first page with its pager line, captured the
    // same forced-frame way.
    assert.equal(fs.existsSync(HISTORY_PNG), true, `${HISTORY_SCREENSHOT} was not written`);
    const historyPng = fs.statSync(HISTORY_PNG);
    assert.ok(
      historyPng.size > 10_000,
      `the History artefact picture is only ${historyPng.size} bytes`,
    );
    const historyCapture = report.states.historyCapture as unknown as {
      shot: string;
      frames: Array<{ paint: { kind: string; ms: number }; bytes: number }>;
      surfaceStable: boolean;
      screen: Screen;
    };
    assert.ok(
      historyCapture.frames.length >= 2,
      `the History artefact was captured from ${historyCapture.frames.length} forced frame(s), so freshness is unproven`,
    );
    for (const [index, frame] of historyCapture.frames.entries()) {
      assert.equal(
        frame.paint.kind,
        "frame",
        `History forced frame ${index + 1} never fired (${frame.paint.kind}); the picture could be a cached surface`,
      );
    }
    assert.equal(
      historyCapture.surfaceStable,
      true,
      "the History surface was still changing between captures",
    );
    assert.equal(
      historyCapture.screen.cards.length,
      50,
      "the History artefact does not show the first page of 50",
    );
    assert.equal(
      historyCapture.screen.historyMore?.text,
      "Showing 50 of 120 decisions.",
      "the History artefact does not show the pager line",
    );
    assert.equal(historyCapture.screen.activeTab, "History");
  });
});
