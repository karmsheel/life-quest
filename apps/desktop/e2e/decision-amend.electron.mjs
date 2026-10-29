/**
 * Drives the decision-amend harness in a real Electron window and turns what the
 * shipped page actually rendered into `e2e/artifacts/decision-amend.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`, or through `lifequest-e2e`):
 *
 *   node e2e/decision-amend.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same table, no eyeballing the app required.
 *
 * WHAT THIS RIG CLAIMS, AND THE INPUT THAT MAKES EACH CLAIM FALSIFIABLE
 *
 *  1. A pending proposal offers `Edit`, and no editor is open until it is
 *     clicked. The already-amended doctrine card wears "Edited by you"; the deck
 *     card does not.
 *  2. `Edit` opens the REAL editor prefilled from the record: the body-carried
 *     project title in its title input, the body's scalar fields as typed
 *     controls, and the exact-proposal JSON identical to the record's body.
 *  3. Correcting the title and summary and saving sends exactly one
 *     `decisionAmend` carrying those two edits plus the note, closes the editor,
 *     and leaves a PENDING card reading the corrected title with the chip on.
 *  4. `Approve with changes` reopens prefilled with the saved edit, adds a detail
 *     through the exact proposal, and sends one amend then one resolve approved —
 *     in that order. The card leaves Pending; History says `approved · edited`;
 *     the bridge's stored record has the edited title and body.
 *  5. `Revert to agent's version` on the already-amended doctrine card sends
 *     exactly `{revert:true}`, restores the agent's original title, and removes
 *     the chip.
 *  6. Invalid JSON in the exact-proposal textarea shows the inline editor error,
 *     disables both saves, and sends nothing to the bridge.
 *  7. A doctrine (prose) Decision's editor shows the markdown textarea rather
 *     than typed fields, and saving edited prose sends that markdown.
 *  8. The page logs no console errors, asks the bridge for nothing else, and
 *     captured the three screenshots the artifact names.
 *
 * NOT covered here: that the engine applies those edits to real vault files (the
 * engine rig, `tests/decision-amend-engine-e2e.test.ts`, owns that), and the
 * approve/reject round trip the existing decisions rigs own.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decision-amend.html";
const DEFAULT_SIZE = { width: 1280, height: 980 };

const errors = [];
const scenarios = [];
const screenshots = [];

/** Record one claim, so the JSON report names what held and what did not. */
function claim(name, pass, detail = null) {
  scenarios.push({ name, pass, detail: pass ? null : detail });
  if (!pass) errors.push(`${name}: ${detail ?? "failed"}`);
  return pass;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await win.webContents.executeJavaScript(expression);
    } catch {
      // The dev server can reload mid-wait while Vite optimises a new import,
      // which clears the harness globals: that is "not ready yet", not a failure.
      value = undefined;
    }
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await sleep(50);
  }
}

/**
 * Wait for a condition, and say whether it ever held.
 *
 * A wait that throws is the wrong instrument for a claim: the rig would die
 * before writing its report, and the artifact would be missing rather than red.
 */
async function settle(win, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await win.webContents.executeJavaScript(expression);
    } catch {
      value = undefined;
    }
    if (value === true) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
}

/** Call one of the harness's own globals, JSON-encoding its arguments. */
function call(win, name, ...args) {
  const encoded = args.map((arg) => JSON.stringify(arg)).join(", ");
  return win.webContents.executeJavaScript(`window.${name}(${encoded})`);
}

const screen = (win) => call(win, "decisionsAmendScreen");
const decision = (win, id) => call(win, "decisionsAmendDecision", id);

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with the rest of the suite, and Chromium
    // throttles a backgrounded window's timers.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  /**
   * Capture what the page is showing NOW.
   *
   * A hidden window paints asynchronously: `capturePage` called straight after a
   * click reads the last painted frame, which is the state before the click. Two
   * animation frames put the page's own commit on the compositor, and the short
   * settle gives the capture a frame of its own — without this the artifact shows
   * the wrong screen, which is worse than no picture at all.
   */
  const shot = async (name) => {
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    );
    await sleep(150);
    const image = await win.webContents.capturePage();
    fs.mkdirSync(artifactsDir, { recursive: true });
    const file = path.join(artifactsDir, `decision-amend-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const checks = {};
  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    scenarios,
    checks,
    screenshots,
    failures: errors,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await waitFor(win, "Boolean(window.decisionsAmendReady)", "decisionsAmendReady");
    await waitFor(win, "window.decisionsAmendScreen().listCalls > 0", "the first read");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    win.showInactive();
    const landed = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        return s.activeTab === "Pending" && s.rows.length === 2;
      })()`,
    );
    await sleep(250);

    // ══ 1. Pending cards offer Edit; no editor until Edit is clicked ════════
    const landing = await screen(win);
    checks.landing = landing;
    const deckOnLanding = landing.rows.find((row) => row.id === "decision-deck");
    const premiseOnLanding = landing.rows.find((row) => row.id === "decision-premise");
    claim(
      "1-pending-cards-offer-edit-and-no-editor-is-open",
      landed &&
        landing.activeTab === "Pending" &&
        landing.rows.length === 2 &&
        Boolean(deckOnLanding?.hasEdit) &&
        Boolean(premiseOnLanding?.hasEdit) &&
        deckOnLanding?.title === "Buid a garden deck" &&
        deckOnLanding?.chip === null &&
        premiseOnLanding?.chip === "Edited by you" &&
        landing.rows.every((row) => row.editing === false) &&
        landing.editor === null &&
        landing.rows.every((row) => row.status === "pending"),
      `tab=${JSON.stringify(landing.activeTab)} rows=${JSON.stringify(landing.rows)} editor=${JSON.stringify(landing.editor)}`,
    );

    // ══ 2. Edit opens the real editor, prefilled from the record ════════════
    const clickedEdit = await call(win, "decisionsAmendEdit", "decision-deck");
    const editorOpened = await settle(
      win,
      "window.decisionsAmendScreen().editor !== null",
    );
    const openScreen = await screen(win);
    checks.editorOpen = openScreen;
    const deckRecord = await decision(win, "decision-deck");
    const expectedJson = JSON.stringify(
      JSON.parse(deckRecord.proposedBodyMarkdown),
      null,
      2,
    );
    claim(
      "2-edit-opens-the-real-editor-prefilled-from-the-record",
      clickedEdit &&
        editorOpened &&
        openScreen.editor !== null &&
        openScreen.editor.title === "Buid a garden deck" &&
        openScreen.editor.fields.summary === "Outdoor build" &&
        openScreen.editor.json === expectedJson &&
        openScreen.editor.exactOpen === false &&
        openScreen.editor.prose === false &&
        openScreen.editor.error === null &&
        openScreen.editor.saveDisabled === false &&
        openScreen.editor.approveChangesDisabled === false,
      `clicked=${clickedEdit} opened=${editorOpened} editor=${JSON.stringify(openScreen.editor)} expectedJson=${JSON.stringify(expectedJson)}`,
    );
    checks.expectedEditorJson = expectedJson;
    await shot("editor");

    // ══ 6. Invalid JSON is shown inline and never reaches the bridge ════════
    const openedExact = await call(win, "decisionsAmendOpenExact");
    const typedInvalid = await call(
      win,
      "decisionsAmendSetJson",
      '{"type":"createProject",',
    );
    const invalidSettled = await settle(
      win,
      "window.decisionsAmendScreen().editor !== null && window.decisionsAmendScreen().editor.error !== null",
    );
    const invalid = await screen(win);
    checks.invalidJson = invalid;
    claim(
      "6-invalid-json-shows-inline-and-disables-both-saves-with-no-call",
      openedExact &&
        typedInvalid &&
        invalidSettled &&
        invalid.editor !== null &&
        /not valid JSON/i.test(invalid.editor.error ?? "") &&
        invalid.editor.saveDisabled === true &&
        invalid.editor.approveChangesDisabled === true &&
        invalid.amendmentCalls.length === 0,
      `openedExact=${openedExact} typed=${typedInvalid} settled=${invalidSettled} editor=${JSON.stringify(invalid.editor)} calls=${JSON.stringify(invalid.amendmentCalls)}`,
    );
    const cancelled = await call(win, "decisionsAmendClick", "cancel");
    const cancelSettled = await settle(win, "window.decisionsAmendScreen().editor === null");
    if (!cancelled || !cancelSettled) {
      // Claim 3 cannot be made from a page that will not leave the editor; make
      // the failure explicit instead of hanging the rest of the sequence.
      claim(
        "3-save-changes-sends-one-amend-and-shows-the-edited-pending-card",
        false,
        `cancel did not close the editor: cancelled=${cancelled} settled=${cancelSettled}`,
      );
      throw new Error("the editor would not close after Cancel");
    }

    // ══ 3. Save changes: one amend, card back in the queue, chip on ════════
    await call(win, "decisionsAmendEdit", "decision-deck");
    await settle(win, "window.decisionsAmendScreen().editor !== null");
    await call(win, "decisionsAmendSetTitle", "Build a garden deck");
    await call(win, "decisionsAmendSetField", "summary", "Outdoor build, cedar frame");
    await call(win, "decisionsAmendSetNote", "Fix the spelling");
    const saved = await call(win, "decisionsAmendClick", "save");
    const saveSettled = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        const deck = s.rows.find((row) => row.id === "decision-deck");
        return s.editor === null && Boolean(deck) && deck.chip === "Edited by you" &&
          deck.title === "Build a garden deck" && s.amendmentCalls.length === 1;
      })()`,
    );
    const afterSave = await screen(win);
    checks.saved = afterSave;
    const savedCall = afterSave.amendmentCalls[0];
    let savedBody = null;
    try {
      savedBody = JSON.parse(savedCall?.input?.proposedBodyMarkdown ?? "");
    } catch {
      savedBody = null;
    }
    const savedDeck = afterSave.rows.find((row) => row.id === "decision-deck");
    claim(
      "3-save-changes-sends-one-amend-and-shows-the-edited-pending-card",
      saved &&
        saveSettled &&
        afterSave.amendmentCalls.length === 1 &&
        savedCall.id === "decision-deck" &&
        savedCall.input.proposedTitle === "Build a garden deck" &&
        savedCall.input.note === "Fix the spelling" &&
        savedBody !== null &&
        savedBody.type === "createProject" &&
        savedBody.id === "proj-deck" &&
        savedBody.title === "Build a garden deck" &&
        savedBody.summary === "Outdoor build, cedar frame" &&
        savedBody.domainSlug === null &&
        savedBody.goalId === null &&
        savedDeck?.title === "Build a garden deck" &&
        savedDeck?.status === "pending" &&
        savedDeck?.chip === "Edited by you" &&
        savedDeck?.editing === false &&
        afterSave.message === "Changes saved.",
      `saved=${saved} settled=${saveSettled} calls=${JSON.stringify(afterSave.amendmentCalls)} deck=${JSON.stringify(savedDeck)} message=${JSON.stringify(afterSave.message)}`,
    );
    checks.savedBody = savedBody;
    checks.savedCall = savedCall;
    await shot("saved");

    // ══ 4. Approve with changes: amend then resolve; History says edited ════
    await call(win, "decisionsAmendEdit", "decision-deck");
    const reopened = await settle(win, "window.decisionsAmendScreen().editor !== null");
    const reopenedScreen = await screen(win);
    checks.approveOpen = reopenedScreen;
    const prefilled =
      reopenedScreen.editor?.title === "Build a garden deck" &&
      reopenedScreen.editor?.fields.summary === "Outdoor build, cedar frame";
    const deckNow = await decision(win, "decision-deck");
    const bodyWithDetail = {
      ...JSON.parse(deckNow.proposedBodyMarkdown),
      bodyMarkdown: "Cedar frame, two planters, sealed.",
    };
    await call(win, "decisionsAmendOpenExact");
    await call(win, "decisionsAmendSetJson", JSON.stringify(bodyWithDetail, null, 2));
    await call(win, "decisionsAmendSetNote", "Add the frame detail");
    const approvedClick = await call(win, "decisionsAmendClick", "approve-changes");
    const approveSettled = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        return s.resolveCalls.length === 1 && s.amendmentCalls.length === 2 &&
          s.editor === null && !s.rows.some((row) => row.id === "decision-deck");
      })()`,
    );
    const afterApprove = await screen(win);
    checks.approved = afterApprove;
    const approveAmend = afterApprove.amendmentCalls[1];
    let approveBody = null;
    try {
      approveBody = JSON.parse(approveAmend?.input?.proposedBodyMarkdown ?? "");
    } catch {
      approveBody = null;
    }
    const resolveCall = afterApprove.resolveCalls[0];
    const written = afterApprove.callLog.filter(
      (entry) => entry.method === "decisionAmend" || entry.method === "decisionResolve",
    );
    const lastTwo = written.slice(-2);

    await call(win, "decisionsAmendTab", "History");
    const historySettled = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        const row = s.rows.find((candidate) => candidate.id === "decision-deck");
        return s.activeTab === "History" && Boolean(row) && row.status === "approved · edited";
      })()`,
    );
    const history = await screen(win);
    checks.history = history;
    const historyRow = history.rows.find((row) => row.id === "decision-deck");
    const storedDeck = await decision(win, "decision-deck");
    let storedDeckBody = null;
    try {
      storedDeckBody = JSON.parse(storedDeck.proposedBodyMarkdown);
    } catch {
      storedDeckBody = null;
    }
    claim(
      "4-approve-with-changes-sends-amend-then-approve-and-history-says-edited",
      reopened &&
        prefilled &&
        approvedClick &&
        approveSettled &&
        afterApprove.amendmentCalls.length === 2 &&
        approveAmend?.id === "decision-deck" &&
        approveAmend?.input?.proposedTitle === "Build a garden deck" &&
        approveAmend?.input?.note === "Add the frame detail" &&
        approveBody !== null &&
        approveBody.title === "Build a garden deck" &&
        approveBody.summary === "Outdoor build, cedar frame" &&
        approveBody.bodyMarkdown === "Cedar frame, two planters, sealed." &&
        afterApprove.resolveCalls.length === 1 &&
        resolveCall?.id === "decision-deck" &&
        resolveCall?.resolution === "approved" &&
        lastTwo.length === 2 &&
        lastTwo[0].method === "decisionAmend" &&
        lastTwo[1].method === "decisionResolve" &&
        historySettled &&
        historyRow?.status === "approved · edited" &&
        historyRow?.editing === false &&
        storedDeck.status === "approved" &&
        storedDeck.proposedTitle === "Build a garden deck" &&
        storedDeckBody?.title === "Build a garden deck" &&
        storedDeckBody?.summary === "Outdoor build, cedar frame" &&
        storedDeckBody?.bodyMarkdown === "Cedar frame, two planters, sealed.",
      `reopened=${reopened} prefilled=${prefilled} clicked=${approvedClick} settled=${approveSettled} amend=${JSON.stringify(approveAmend)} resolve=${JSON.stringify(resolveCall)} history=${JSON.stringify(historyRow)} stored=${JSON.stringify(storedDeck)}`,
    );
    checks.approveAmend = approveAmend;
    checks.approveBody = approveBody;
    checks.resolveCall = resolveCall;
    checks.historyRow = historyRow;
    checks.storedDeck = storedDeck;
    checks.storedDeckBody = storedDeckBody;
    await shot("history");

    // ══ 5. Revert restores the agent's version and removes the chip ═════════
    await call(win, "decisionsAmendTab", "Pending");
    const backToPending = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        return s.activeTab === "Pending" && s.rows.length === 1 &&
          s.rows[0].id === "decision-premise" && s.rows[0].chip === "Edited by you";
      })()`,
    );
    const pendingBeforeRevert = await screen(win);
    checks.pendingBeforeRevert = pendingBeforeRevert;
    await call(win, "decisionsAmendEdit", "decision-premise");
    const revertEditorOpened = await settle(
      win,
      "window.decisionsAmendScreen().editor !== null",
    );
    const revertEditor = await screen(win);
    const revertWasOffered = revertEditor.editor?.revertVisible === true;
    const revertClicked = await call(win, "decisionsAmendClick", "revert");
    const revertSettled = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        const row = s.rows.find((candidate) => candidate.id === "decision-premise");
        return s.editor === null && Boolean(row) && row.chip === null &&
          row.title === "Sleep more" &&
          s.amendmentCalls.filter((entry) => entry.input && entry.input.revert === true).length === 1;
      })()`,
    );
    const afterRevert = await screen(win);
    checks.reverted = afterRevert;
    const revertCalls = afterRevert.amendmentCalls.filter(
      (entry) => entry.input && entry.input.revert === true,
    );
    const revertCall = revertCalls[0];
    const revertedRow = afterRevert.rows.find((row) => row.id === "decision-premise");
    const storedPremise = await decision(win, "decision-premise");
    checks.revertCall = revertCall;
    checks.revertedRecord = storedPremise;
    claim(
      "5-revert-restores-the-agents-version-and-removes-the-chip",
      backToPending &&
        revertEditorOpened &&
        revertWasOffered &&
        revertClicked &&
        revertSettled &&
        revertCalls.length === 1 &&
        revertCall.id === "decision-premise" &&
        JSON.stringify(revertCall.input) === JSON.stringify({ revert: true }) &&
        revertedRow?.title === "Sleep more" &&
        revertedRow?.chip === null &&
        afterRevert.message === "Reverted to the agent's version." &&
        storedPremise.proposedTitle === "Sleep more" &&
        storedPremise.proposedBodyMarkdown === "Rest when you can." &&
        storedPremise.amendedAt === null &&
        storedPremise.amendedBy === null &&
        storedPremise.amendmentNote === null &&
        storedPremise.originalProposedTitle === null,
      `editor=${revertEditorOpened} offered=${revertWasOffered} clicked=${revertClicked} settled=${revertSettled} revertCalls=${JSON.stringify(revertCalls)} row=${JSON.stringify(revertedRow)} stored=${JSON.stringify(storedPremise)}`,
    );

    // ══ 7. A prose Decision edits markdown, not typed fields ════════════════
    await call(win, "decisionsAmendEdit", "decision-premise");
    const proseOpened = await settle(win, "window.decisionsAmendScreen().editor !== null");
    const proseScreen = await screen(win);
    checks.proseEditor = proseScreen;
    const editedProse = "Rest is when the body repairs. Eight hours, no screens.";
    const proseTyped = await call(win, "decisionsAmendSetJson", editedProse);
    const proseSaved = await call(win, "decisionsAmendClick", "save");
    const proseSettled = await settle(
      win,
      `(() => {
        const s = window.decisionsAmendScreen();
        const last = s.amendmentCalls[s.amendmentCalls.length - 1];
        return s.editor === null && Boolean(last) &&
          last.input.proposedBodyMarkdown === ${JSON.stringify(editedProse)};
      })()`,
    );
    const afterProse = await screen(win);
    const proseCall = afterProse.amendmentCalls[afterProse.amendmentCalls.length - 1];
    const proseRow = afterProse.rows.find((row) => row.id === "decision-premise");
    checks.proseSaved = afterProse;
    checks.proseCall = proseCall;
    checks.proseRow = proseRow;
    claim(
      "7-a-prose-decision-edits-markdown-not-fields",
      proseOpened &&
        proseTyped &&
        proseSaved &&
        proseSettled &&
        proseScreen.editor !== null &&
        proseScreen.editor.prose === true &&
        proseScreen.editor.fieldInputCount === 0 &&
        proseScreen.editor.json === "Rest when you can." &&
        proseCall?.id === "decision-premise" &&
        proseCall?.input?.proposedBodyMarkdown === editedProse &&
        proseCall?.input?.proposedTitle === "Sleep more" &&
        proseRow?.title === "Sleep more" &&
        proseRow?.chip === "Edited by you" &&
        afterProse.message === "Changes saved.",
      `opened=${proseOpened} editor=${JSON.stringify(proseScreen.editor)} call=${JSON.stringify(proseCall)} row=${JSON.stringify(proseRow)} message=${JSON.stringify(afterProse.message)}`,
    );

    // ══ 8. Nothing unexpected, nothing screaming, three pictures ════════════
    // The sink is a plain array on the harness window, not a callable global.
    const unexpectedCalls = await win.webContents.executeJavaScript(
      "window.decisionsAmendUnexpectedCalls",
    );
    checks.unexpectedBridgeCalls = unexpectedCalls;
    checks.consoleErrors = consoleErrors;
    claim(
      "8-the-page-logs-no-errors-and-asks-for-nothing-unexpected",
      Array.isArray(unexpectedCalls) &&
        unexpectedCalls.length === 0 &&
        consoleErrors.length === 0 &&
        screenshots.length === 3,
      `unexpected=${JSON.stringify(unexpectedCalls)} consoleErrors=${JSON.stringify(consoleErrors)} screenshots=${JSON.stringify(screenshots)}`,
    );

    report.pass = errors.length === 0;
  } catch (error) {
    errors.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    report.pass = false;
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "decision-amend.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const passed = scenarios.filter((scenario) => scenario.pass).length;
  console.log(`decision-amend  ${passed}/${scenarios.length} claims held`);
  for (const scenario of scenarios) {
    console.log(`  ${scenario.pass ? "ok  " : "FAIL"} ${scenario.name}`);
    if (!scenario.pass) console.log(`       ${scenario.detail}`);
  }
  console.log(`screenshots: ${screenshots.join(", ") || "none"}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(report.pass ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("decision-amend rig timed out");
  app.exit(1);
}, 120_000);
