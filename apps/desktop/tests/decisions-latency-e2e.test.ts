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
  title: string | null;
  subtitle: string | null;
  cards: CardRow[];
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

type Report = {
  url: string;
  ranAt: string;
  window: { width: number; height: number };
  fixture: { listDelayMs: number; snapshotDelayMs: number; seed: number };
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

    // ── the repeatable artifact: a JSON report and the frame it measured ─────
    assert.deepEqual(
      report.screenshots,
      [ARTIFACT_SCREENSHOT],
      "the run did not record exactly the one artefact picture",
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
  });
});
