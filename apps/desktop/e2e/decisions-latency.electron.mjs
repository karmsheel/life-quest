/**
 * Drives the decisions dismissal-latency rig in a real Electron window and turns
 * its measurements into `e2e/artifacts/decisions-latency.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/decisions-latency.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/decisions-latency-e2e.test.ts`) holds the assertions, this
 * file holds the interactions and the measurements, so a failure names a state
 * rather than a line of driver code.
 *
 * THE THREE RUNS
 *
 *  1. **The last card.** Two pending Decisions, `decision:list` stubbed at 900 ms
 *     and `vaultGetSnapshot` at 800 ms. Approve one (the sheet must stay), then
 *     the last one — and time the click to the frame leaving the document. This
 *     is the operator's defect: the old order spent ~2.5 s on three reads before
 *     the close could start.
 *  2. **Auto-close OFF.** One pending Decision, Settings › Decisions › auto-close
 *     seeded off from the snapshot: answering the last card must leave the sheet
 *     up, with the card gone.
 *  3. **A refused write.** One pending Decision, `decisionResolve` stubbed to
 *     refuse: the card must stay pending and the error must be said in the sheet.
 *
 * What the screenshot is timed against: `report.capture.clickToCaptureMs` reads
 * its own clock a few frames after `sheetGoneAt`, and the state sampled from the
 * page at that instant (route `/work`, no overlay, the workspace page painted)
 * is written beside it — so the picture in the artefact is provably of the page
 * the sheet handed back, not of a later moment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/decisions-latency.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The stubbed read costs the defect is about. */
const LIST_DELAY_MS = 900;
const SNAPSHOT_DELAY_MS = 800;

const states = {};
const steps = {};
const failures = [];
const consoleErrors = [];

const round = (value) => Math.round(value);

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) consoleErrors.push(String(message));
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run("window.decisionsLatencyScreen()");
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const probe = async () => run("window.decisionsLatencyProbe()");
  const bridgeCalls = async () => run("window.decisionsLatencyCalls()");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const frames = async (ms = 0) => {
    if (ms > 0) await sleep(ms);
    await run(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
    );
  };

  const settle = async (ms = 260) => {
    await frames(ms);
    return sample();
  };

  const waitFor = async (expression, timeoutMs = 8000, label = expression) => {
    const started = Date.now();
    for (;;) {
      if (await run(`Boolean(${expression})`)) return true;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
      }
      await sleep(20);
    }
  };

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const record = (name, value) => {
    states[name] = value;
    return value;
  };

  const step = (name, value) => {
    steps[name] = value;
    return value;
  };

  const screenshots = [];

  /** The page's own clock, so a capture is timed on the same clock as the click. */
  const now = () => run("performance.now()");

  /** One raw capture of the surface, in memory. */
  const captureBytes = async () => {
    const image = await win.webContents.capturePage();
    return image.toPNG();
  };

  /**
   * Wait for one composited frame, or give up.
   *
   * A hidden Electron window does not paint on its own: the last frame it
   * produced can be seconds old, so a bare `capturePage` after the sheet left
   * hands back a picture of the sheet still up. `webContents.invalidate()` asks
   * for a repaint and `requestAnimationFrame` fires on the frame it produced, so
   * this waits for the DOM the rig just changed to actually be on the surface.
   * The timeout is the escape hatch for a window whose rAF never fires; the
   * caller records which happened, so a stale picture can never pass silently.
   */
  const waitFrame = (timeoutMs = 1200) =>
    run(`new Promise((resolve) => {
      const started = performance.now();
      const timer = setTimeout(
        () => resolve({ kind: "timeout", ms: performance.now() - started }),
        ${timeoutMs},
      );
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve({ kind: "frame", ms: performance.now() - started });
      });
    })`);

  /** The one artefact picture: written exactly as `decisions-latency.png`. */
  const shot = (bytes) => {
    const file = path.join(artifactsDir, "decisions-latency.png");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, bytes);
    screenshots.length = 0;
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const openPage = async (query) => {
    const target = query ? `${url}?${query}` : url;
    await win.loadURL(target);
    await waitFor("Boolean(window.decisionsLatencyReady)", 15000, "the harness module");
    await run("window.decisionsLatencyReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    // The fixture snapshot has to have landed before the sheet opens: the inbox
    // reads auto-close from it, and a sheet opened early would test the default.
    await waitFor(
      "Boolean(window.decisionsLatencyVault) && window.decisionsLatencyVault().hasSnapshot",
      10000,
      "the fixture vault snapshot",
    );
    await waitFor(
      "window.decisionsLatencyScreen().workspace.present",
      10000,
      "the workspace page behind the sheet",
    );
    await frames(120);
  };

  const openDecisions = async (expectedCards) => {
    const clicked = await click("[data-open-decisions]");
    if (!clicked) throw new Error("could not press the Decisions link");
    await waitFor(
      "Boolean(window.decisionsLatencyScreen().overlay)",
      8000,
      "the Decisions sheet opens",
    );
    await waitFor(
      `window.decisionsLatencyScreen().cards.length === ${expectedCards}`,
      10000,
      `the open sheet draws ${expectedCards} pending cards`,
    );
    await frames(120);
    return sample();
  };

  const answerCard = async (id, resolution) => {
    const result = await run(
      `window.decisionsLatencyAnswer(${JSON.stringify(id)}, ${JSON.stringify(resolution)})`,
    );
    if (!result || !result.clicked) {
      throw new Error(
        `could not answer ${id} (${resolution}): ${result?.reason ?? "unknown"}`,
      );
    }
    return result;
  };

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: {
      listDelayMs: LIST_DELAY_MS,
      snapshotDelayMs: SNAPSHOT_DELAY_MS,
      seed: 2,
    },
    states,
    steps,
    latency: {},
    answerWindow: {},
    bookkeeping: {},
    calls: {},
    capture: {},
    legs: {},
    screenshots,
    consoleErrors,
    failures,
    pass: false,
  };

  try {
    // ── run 1: the operator's defect, then the bookkeeping ────────────────────

    await openPage(
      `seed=2&listDelay=${LIST_DELAY_MS}&snapshotDelay=${SNAPSHOT_DELAY_MS}`,
    );
    record("landing", await sample());

    const opened = record("opened", await openDecisions(2));
    step("openClick", true);

    // LEG 1 — a non-last card leaves; the sheet stays; no control sticks on "…".
    const firstId = opened.cards[0]?.id;
    step("leg1CardId", firstId ?? null);
    step("leg1Answer", await answerCard(firstId, "approved"));
    await waitFor(
      "Boolean(window.decisionsLatencyProbe()) && window.decisionsLatencyProbe().cardGoneAt !== null",
      5000,
      "the answered card leaves the list",
    );
    // Longer than the frame's 140 ms exit motion: a sheet that was going to close
    // would already be gone by the time this sample is taken.
    record("leg1CardGone", await settle(320));
    record("leg1Probe", await probe());
    await waitFor(
      "window.decisionsLatencyCalls().inflight === 0",
      10000,
      "the first answer's background reads",
    );
    await waitFor(
      "window.decisionsLatencyScreen().cards.length === 1",
      10000,
      "the list settles to one pending card",
    );
    record("leg1Settled", await settle(120));

    // LEG 2 — the LAST card: the sheet must leave on the write, not on the reads.
    const beforeLast = await sample();
    const lastId = beforeLast.cards[0]?.id;
    step("leg2CardId", lastId ?? null);
    step("leg2Answer", await answerCard(lastId, "approved"));
    await waitFor(
      "Boolean(window.decisionsLatencyProbe()) && window.decisionsLatencyProbe().sheetGoneAt !== null",
      6000,
      "the sheet leaves the document and the route returns to /work",
    );
    const sheetGone = record("leg2Probe", await probe());

    // The picture is taken at the moment just after the frame left.
    //
    // Two things make this more than "call capturePage": a hidden window's
    // surface is a cached frame, and a capture started right after the DOM
    // changed can still hand back the old one. So the compositor is woken with a
    // throwaway capture (which also makes the first forced frame immediate
    // instead of ~a second), then frames are forced (invalidate + rAF), a beat
    // is given for the paint to land, and the surface is captured until two
    // consecutive frames are byte-identical. The last of those is the artefact,
    // and the report says how many frames it took and whether the surface had
    // settled — a stale picture cannot pass silently.
    await captureBytes();
    const captureFrames = [];
    let previous = null;
    let surfaceStable = false;
    for (let cycle = 0; cycle < 3 && !surfaceStable; cycle += 1) {
      win.webContents.invalidate();
      const paint = await waitFrame();
      await sleep(40);
      const bytes = await captureBytes();
      captureFrames.push({ paint, bytes: bytes.length });
      if (previous !== null && previous.equals(bytes)) surfaceStable = true;
      previous = bytes;
    }
    const captureAt = await now();
    const capturedShot = shot(previous);
    const afterSheetGone = record("afterSheetGone", await sample());
    record("capture", {
      shot: capturedShot,
      clickToCaptureMs: round(captureAt - (sheetGone?.clickAt ?? captureAt)),
      path: afterSheetGone.path,
      overlay: afterSheetGone.overlay,
      workspace: afterSheetGone.workspace,
      bodyOverflow: afterSheetGone.bodyOverflow,
      frames: captureFrames,
      surfaceStable,
      bytes: previous.length,
    });
    report.capture = states.capture;

    // LEG 3 — the reads were deferred, not deleted: wait for them and read the
    // call log, then prove the resolved cards never come back.
    await waitFor(
      "window.decisionsLatencyCalls().inflight === 0",
      10000,
      "the background bookkeeping after the last answer",
    );
    const afterCalls = record("callsAfterAnswer", await bridgeCalls());

    const reopenClick = await click("[data-open-decisions]");
    step("reopenClick", reopenClick);
    await waitFor(
      "Boolean(window.decisionsLatencyScreen().overlay)",
      8000,
      "the sheet re-opens",
    );
    await waitFor(
      "window.decisionsLatencyScreen().cards.length === 0",
      10000,
      "the re-opened inbox has no pending cards",
    );
    record("reopenedPending", await settle(140));
    step("historyClick", await run("window.decisionsLatencyTab('History')"));
    await waitFor(
      "window.decisionsLatencyScreen().cards.length === 2",
      10000,
      "History draws both resolved cards",
    );
    record("reopenedHistory", await settle(140));
    step("closeClick", await run("window.decisionsLatencyClose()"));
    await waitFor(
      "!window.decisionsLatencyScreen().overlay",
      6000,
      "the sheet closes before the next run",
    );

    // LEG 4 — how many list reads the answer really asked for. The window is the
    // answer itself: from the click to the moment the sheet left.
    const clickAt = sheetGone?.clickAt ?? null;
    const sheetGoneAt = sheetGone?.sheetGoneAt ?? null;
    const listInAnswerWindow = afterCalls.list.filter(
      (call) => clickAt !== null && call.at >= clickAt,
    );
    const listBeforeSheetGone = listInAnswerWindow.filter(
      (call) => sheetGoneAt === null || call.at <= sheetGoneAt,
    );
    const listAnsweredAfterSheetGone = listInAnswerWindow.filter(
      (call) => call.end !== null && sheetGoneAt !== null && call.end > sheetGoneAt,
    );
    const snapshotAfterClick = afterCalls.snapshot.filter(
      (call) => clickAt !== null && call.at >= clickAt,
    );
    const snapshotAnsweredAfterSheetGone = snapshotAfterClick.filter(
      (call) => call.end !== null && sheetGoneAt !== null && call.end > sheetGoneAt,
    );

    report.latency = {
      leg1: {
        clickAt: states.leg1Probe?.clickAt ?? null,
        cardGoneAt: states.leg1Probe?.cardGoneAt ?? null,
        clickToCardGoneMs:
          states.leg1Probe?.cardGoneAt != null && states.leg1Probe?.clickAt != null
            ? round(states.leg1Probe.cardGoneAt - states.leg1Probe.clickAt)
            : null,
        sheetStayedUp: states.leg1Probe?.sheetGoneAt == null,
      },
      leg2: {
        clickAt,
        cardGoneAt: sheetGone?.cardGoneAt ?? null,
        overlayGoneAt: sheetGone?.overlayGoneAt ?? null,
        sheetGoneAt,
        clickToCardGoneMs:
          sheetGone?.cardGoneAt != null && clickAt != null
            ? round(sheetGone.cardGoneAt - clickAt)
            : null,
        clickToOverlayGoneMs:
          sheetGone?.overlayGoneAt != null && clickAt != null
            ? round(sheetGone.overlayGoneAt - clickAt)
            : null,
        clickToSheetGoneMs:
          sheetGoneAt != null && clickAt != null
            ? round(sheetGoneAt - clickAt)
            : null,
        pathAtSheetGone: sheetGone?.pathAtSheetGone ?? null,
        workspaceAtSheetGone: sheetGone?.workspaceAtSheetGone ?? null,
        bodyOverflowAtSheetGone: sheetGone?.bodyOverflowAtSheetGone ?? null,
      },
    };
    report.answerWindow = {
      from: clickAt,
      to: sheetGoneAt,
      decisionListCalls: listBeforeSheetGone.length,
      decisionListOffsetsMs: listBeforeSheetGone.map((call) =>
        clickAt === null ? null : round(call.at - clickAt),
      ),
      vaultGetSnapshotCallsBeforeSheetGone: snapshotAfterClick.filter(
        (call) => sheetGoneAt === null || call.at <= sheetGoneAt,
      ).length,
    };
    report.bookkeeping = {
      decisionListCallsAfterClick: listInAnswerWindow.length,
      decisionListReRead: listInAnswerWindow.length > 0,
      decisionListAnsweredAfterSheetGone: listAnsweredAfterSheetGone.length,
      decisionListDeferred: listAnsweredAfterSheetGone.length > 0,
      vaultGetSnapshotCallsAfterClick: snapshotAfterClick.length,
      vaultGetSnapshotRefreshed: snapshotAfterClick.length > 0,
      vaultGetSnapshotAnsweredAfterSheetGone: snapshotAnsweredAfterSheetGone.length,
      vaultGetSnapshotDeferred: snapshotAnsweredAfterSheetGone.length > 0,
    };
    report.calls = {
      list: afterCalls.list.map((call) => ({
        at: round(call.at - (clickAt ?? 0)),
        end: call.end === null ? null : round(call.end - (clickAt ?? 0)),
        delayMs: call.delayMs,
      })),
      snapshot: afterCalls.snapshot.map((call) => ({
        at: round(call.at - (clickAt ?? 0)),
        end: call.end === null ? null : round(call.end - (clickAt ?? 0)),
        delayMs: call.delayMs,
      })),
      resolves: afterCalls.resolves,
      bridge: afterCalls.bridge.map((call) => ({
        name: call.name,
        at: round(call.at - (clickAt ?? 0)),
      })),
      unexpected: afterCalls.unexpected,
    };

    // ── run 2: auto-close OFF leaves the sheet up ─────────────────────────────

    await openPage(
      `seed=1&autoClose=off&listDelay=${LIST_DELAY_MS}&snapshotDelay=${SNAPSHOT_DELAY_MS}`,
    );
    const autoOpened = record("autoCloseOffOpened", await openDecisions(1));
    step("autoCloseSetting", await run("window.decisionsLatencyVault().decisionInboxAutoClose"));
    step(
      "autoCloseAnswer",
      await answerCard(autoOpened.cards[0]?.id, "approved"),
    );
    await waitFor(
      "Boolean(window.decisionsLatencyProbe()) && window.decisionsLatencyProbe().cardGoneAt !== null",
      5000,
      "the auto-close-off card leaves the list",
    );
    // Let the background read land and the exit motion's window pass, then the
    // claim is "the sheet is still here", not "it had not closed yet".
    await waitFor(
      "window.decisionsLatencyCalls().inflight === 0",
      10000,
      "the auto-close-off background reads",
    );
    record("autoCloseOff", await settle(400));
    record("autoCloseOffProbe", await probe());
    step("autoCloseCloseClick", await run("window.decisionsLatencyClose()"));
    await waitFor(
      "!window.decisionsLatencyScreen().overlay",
      6000,
      "the auto-close-off sheet closes for the next run",
    );

    // ── run 3: a refused write keeps the card and says why ────────────────────

    await openPage(`seed=1&failResolve=1&listDelay=${LIST_DELAY_MS}`);
    const refusedOpened = record("failedResolveOpened", await openDecisions(1));
    step(
      "failedResolveAnswer",
      await answerCard(refusedOpened.cards[0]?.id, "approved"),
    );
    await waitFor(
      "window.decisionsLatencyScreen().error !== null",
      6000,
      "the refusal is shown in the sheet",
    );
    record("failedResolve", await settle(200));
    record("failedResolveProbe", await probe());
    record("failedResolveCalls", await bridgeCalls());
    step("failedResolveCloseClick", await run("window.decisionsLatencyClose()"));
    await waitFor(
      "!window.decisionsLatencyScreen().overlay",
      6000,
      "the refused-write sheet closes",
    );
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }

  // ── per-leg summary, for the report's own table ────────────────────────────
  //
  // The judge (`tests/decisions-latency-e2e.test.ts`) re-states these from the
  // same measurements; this block exists so a report opened on its own says
  // which contract each number was gathered for.
  const leg1Sample = states.leg1CardGone;
  const leg1Probe = states.leg1Probe;
  const leg2 = report.latency.leg2 ?? {};
  const leg1AnsweredId = steps.leg1CardId;
  const reopened = states.reopenedPending;
  const history = states.reopenedHistory;
  const answeredIds = [steps.leg1CardId, steps.leg2CardId].filter(Boolean);
  const autoCloseOff = states.autoCloseOff;

  report.legs = {
    leg1: {
      pass:
        Boolean(leg1Sample?.overlay) &&
        leg1Probe?.cardGoneAt != null &&
        leg1Probe?.sheetGoneAt == null &&
        !leg1Sample?.cards?.some((card) => card.id === leg1AnsweredId) &&
        (leg1Sample?.ellipsisButtons?.length ?? 0) === 0,
      detail: {
        cardGoneMs: report.latency.leg1?.clickToCardGoneMs ?? null,
        sheetStayedUp: leg1Probe?.sheetGoneAt == null,
        cardsLeft: leg1Sample?.cards?.length ?? null,
        ellipsisButtons: leg1Sample?.ellipsisButtons ?? null,
      },
    },
    leg2: {
      pass:
        leg2.clickToSheetGoneMs != null &&
        leg2.clickToSheetGoneMs < 400 &&
        states.afterSheetGone?.overlay === null &&
        states.afterSheetGone?.path === "/work",
      detail: {
        clickToSheetGoneMs: leg2.clickToSheetGoneMs ?? null,
        clickToCardGoneMs: leg2.clickToCardGoneMs ?? null,
        path: states.afterSheetGone?.path ?? null,
      },
    },
    leg3: {
      pass:
        Boolean(report.bookkeeping.decisionListDeferred) &&
        Boolean(report.bookkeeping.vaultGetSnapshotDeferred) &&
        reopened?.cards?.length === 0 &&
        answeredIds.every((id) =>
          (history?.cards ?? []).some((card) => card.id === id),
        ),
      detail: {
        decisionListDeferred: report.bookkeeping.decisionListDeferred ?? null,
        vaultGetSnapshotDeferred:
          report.bookkeeping.vaultGetSnapshotDeferred ?? null,
        pendingCardsOnReopen: reopened?.cards?.length ?? null,
        historyIds: (history?.cards ?? []).map((card) => card.id),
      },
    },
    leg4: {
      pass:
        report.answerWindow.decisionListCalls != null &&
        report.answerWindow.decisionListCalls <= 2,
      detail: { decisionListCalls: report.answerWindow.decisionListCalls ?? null },
    },
    leg5: {
      pass:
        autoCloseOff?.overlay != null &&
        (autoCloseOff?.cards?.length ?? -1) === 0 &&
        autoCloseOff?.autoClose === false,
      detail: {
        overlay: autoCloseOff?.overlay ?? null,
        cards: autoCloseOff?.cards?.length ?? null,
        autoClose: autoCloseOff?.autoClose ?? null,
      },
    },
    leg6: {
      pass:
        states.failedResolve?.overlay != null &&
        (states.failedResolve?.cards?.length ?? 0) === 1 &&
        (states.failedResolve?.cards?.[0]?.status ?? "").toLowerCase() === "pending" &&
        typeof states.failedResolve?.error === "string" &&
        states.failedResolve.error.length > 0,
      detail: {
        overlay: states.failedResolve?.overlay ?? null,
        cards: states.failedResolve?.cards ?? null,
        error: states.failedResolve?.error ?? null,
      },
    },
  };

  report.pass = failures.length === 0;

  const reportFile = path.join(artifactsDir, "decisions-latency.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["leg", "pass", "detail"]];
  for (const [name, leg] of Object.entries(report.legs)) {
    table.push([name, leg.pass ? "PASS" : "FAIL", JSON.stringify(leg.detail)]);
  }
  const widths = table[0].map((_, index) =>
    Math.max(...table.map((row) => String(row[index]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, index) => String(cell).padEnd(widths[index])).join("  "));
  }
  if (report.latency.leg2) {
    console.log(
      `click -> sheet gone: ${report.latency.leg2.clickToSheetGoneMs} ms ` +
        `(reads stubbed at ${LIST_DELAY_MS} ms + ${SNAPSHOT_DELAY_MS} ms)`,
    );
    console.log(
      `decision:list calls inside the answer window: ${report.answerWindow.decisionListCalls}`,
    );
  }

  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "decisions latency: PASS" : "decisions latency: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`decisions-latency: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
