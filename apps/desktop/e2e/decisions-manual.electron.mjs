/**
 * Drives the manual-decisions harness in a real Electron window and turns what
 * the page actually rendered into `e2e/artifacts/decisions-manual.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`, or through `lifequest-e2e`):
 *
 *   node e2e/decisions-manual.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same table, no eyeballing the app required.
 *
 * WHAT THIS RIG CLAIMS, AND THE INPUT THAT MAKES EACH CLAIM FALSIFIABLE
 *
 *  1. The Decisions page has a third sub-tab, `Manual`, and it opens the real
 *     logging form with the operator's own words in mind: `What did you decide?`,
 *     an optional `Why?`, and the optional domain, defaulted to the lens.
 *  2. A blank decision is refused before it reaches the vault. The bridge's
 *     create count stays at zero and the form keeps the operator's place.
 *  3. Logging one decision is exactly one write, carrying the three fields the
 *     form showed, and the record comes back into the page's own list without a
 *     reload: "Logged" pill, "Manual" chip, the form handed back blank.
 *  4. The Manual tab is NOT the approval inbox: the pending proposal does not
 *     appear there, and the manual record never appears under Pending. That is
 *     the whole safety property, measured rather than assumed.
 *  5. History reads BOTH stores: the logged decision and the two resolved AI
 *     proposals, newest first, each wearing its source chip (`Manual` / `AI`),
 *     the AI rows keeping the status they were resolved with.
 *  6. The All / Manual / AI filter really narrows History: Manual leaves one
 *     row, AI leaves the two proposals, All brings both back.
 *  7. The record survives leaving the tab: History re-reads the manual store
 *     (`manualDecision:list` is asked again) rather than drawing React state
 *     left over from the form, and the page is never remounted to show it.
 *  8. The page asks the bridge for nothing it does not need, and logs no errors.
 *
 * NOT covered here: that the main process resolves those names in the first
 * place (the engine rig, `tests/manual-decisions-engine-e2e.test.ts`, runs the
 * real store over a real vault on disk), and the approve/reject round trip,
 * which the existing decisions rigs own.
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
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/decisions-manual.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

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

const screen = (win) => call(win, "decisionsManualScreen");

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
    const file = path.join(artifactsDir, `decisions-manual-${name}.png`);
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
    await waitFor(win, "Boolean(window.decisionsManualReady)", "decisionsManualReady");
    await waitFor(
      win,
      "window.decisionsManualScreen().listCalls > 0",
      "the first read",
    );
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    win.showInactive();
    await sleep(250);

    // ══ 1. Landing: Pending is the first tab, the pending proposal is there ══
    const landing = await screen(win);
    checks.landing = landing;
    claim(
      "the-page-has-three-tabs-and-lands-on-pending",
      landing.activeTab === "Pending" &&
        JSON.stringify(landing.tabs) === JSON.stringify(["Pending", "History", "Manual"]) &&
        landing.rows.length === 1 &&
        landing.rows[0].id === "decision-003",
      `tab=${JSON.stringify(landing.activeTab)} tabs=${JSON.stringify(landing.tabs)} rows=${JSON.stringify(landing.rows)}`,
    );

    // ══ 2. The Manual tab opens the real form ═══════════════════════════════
    const clickedManual = await call(win, "decisionsManualTab", "Manual");
    const opened = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.activeTab === "Manual" && s.form !== null &&
          s.manualListCalls > 0 && s.createCalls.length === 0;
      })()`,
    );
    const manualTab = await screen(win);
    checks.manualTab = manualTab;
    claim(
      "the-manual-tab-opens-the-logging-form",
      clickedManual &&
        opened &&
        manualTab.activeTab === "Manual" &&
        manualTab.form !== null &&
        JSON.stringify(manualTab.form.labels) ===
          JSON.stringify([
            "What did you decide?",
            "Why? (optional)",
            "Domain (optional)",
          ]) &&
        JSON.stringify(manualTab.form.domainOptions) ===
          JSON.stringify(["No domain", "Financial", "Health"]) &&
        manualTab.form.domain === "" &&
        manualTab.manualRows.length === 0 &&
        manualTab.manualEmpty === "No manual decisions logged yet.",
      `opened=${opened} tab=${JSON.stringify(manualTab.activeTab)} form=${JSON.stringify(manualTab.form)} empty=${JSON.stringify(manualTab.manualEmpty)}`,
    );

    // ══ 3. A blank decision never reaches the vault ═════════════════════════
    const submittedBlank = await call(win, "decisionsManualSubmit");
    const blankSettled = await settle(
      win,
      `window.decisionsManualScreen().error !== null`,
    );
    const blank = await screen(win);
    checks.blank = blank;
    claim(
      "a-blank-decision-is-refused-before-the-write",
      submittedBlank &&
        blankSettled &&
        /Say what you decided/.test(blank.error ?? "") &&
        blank.createCalls.length === 0 &&
        blank.manualRows.length === 0 &&
        blank.form?.title === "",
      `settled=${blankSettled} error=${JSON.stringify(blank.error)} calls=${JSON.stringify(blank.createCalls)}`,
    );

    // ══ 4. Logging one decision: one write, and it lands on the page ════════
    await call(win, "decisionsManualType", "title", "Stop the gym membership");
    await call(
      win,
      "decisionsManualType",
      "rationale",
      "The ledger says it costs more than it returns.",
    );
    await call(win, "decisionsManualDomain", "financial");
    const submitted = await call(win, "decisionsManualSubmit");
    const logged = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.createCalls.length === 1 && s.manualRows.length === 1 &&
          s.error === null;
      })()`,
    );
    const afterLog = await screen(win);
    checks.afterLog = afterLog;
    claim(
      "logging-one-decision-is-exactly-one-write",
      submitted &&
        logged &&
        JSON.stringify(afterLog.createCalls) ===
          JSON.stringify([
            {
              title: "Stop the gym membership",
              rationale: "The ledger says it costs more than it returns.",
              domainSlug: "financial",
            },
          ]),
      `submitted=${submitted} logged=${logged} calls=${JSON.stringify(afterLog.createCalls)}`,
    );
    claim(
      "the-logged-decision-is-on-the-page-immediately",
      afterLog.manualRows.length === 1 &&
        afterLog.manualRows[0].id === "manual-001" &&
        afterLog.manualRows[0].title === "Stop the gym membership" &&
        afterLog.manualRows[0].source === "Manual" &&
        afterLog.manualRows[0].status === "Logged" &&
        afterLog.message === "Decision logged." &&
        afterLog.form?.title === "" &&
        afterLog.form?.rationale === "" &&
        // The domain stays where the operator put it: logging the next decision
        // under the same domain is one field fewer to set again.
        afterLog.form?.domain === "financial",
      `rows=${JSON.stringify(afterLog.manualRows)} message=${JSON.stringify(afterLog.message)} form=${JSON.stringify(afterLog.form)}`,
    );
    await shot("form");

    // ══ 5. The Manual tab is not the approval inbox, in either direction ════
    await call(win, "decisionsManualTab", "Pending");
    const pendingSettled = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.activeTab === "Pending" && s.form === null && s.rows.length === 1;
      })()`,
    );
    const pending = await screen(win);
    checks.pending = pending;
    claim(
      "a-manual-decision-never-appears-under-pending",
      pendingSettled &&
        pending.rows.length === 1 &&
        pending.rows[0].id === "decision-003" &&
        pending.rows.every((row) => row.source === null),
      `settled=${pendingSettled} rows=${JSON.stringify(pending.rows)}`,
    );

    // ══ 6. History merges the two stores, newest first, with source chips ═══
    const listCallsBeforeHistory = pending.manualListCalls;
    await call(win, "decisionsManualTab", "History");
    const historySettled = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.activeTab === "History" && s.rows.length === 3;
      })()`,
    );
    const history = await screen(win);
    checks.history = history;
    claim(
      "history-reads-both-stores-newest-first",
      historySettled &&
        JSON.stringify(history.rows.map((row) => row.id)) ===
          JSON.stringify(["manual-001", "decision-001", "decision-002"]) &&
        JSON.stringify(history.rows.map((row) => row.source)) ===
          JSON.stringify(["Manual", "AI", "AI"]) &&
        history.manualListCalls > listCallsBeforeHistory,
      `settled=${historySettled} rows=${JSON.stringify(history.rows)} manualListCalls=${history.manualListCalls}`,
    );
    claim(
      "the-ai-side-keeps-the-status-it-was-resolved-with",
      JSON.stringify(history.rows.map((row) => row.status)) ===
        JSON.stringify(["Logged", "approved", "rejected"]),
      `statuses=${JSON.stringify(history.rows.map((row) => row.status))}`,
    );
    claim(
      "history-shows-the-filter-and-starts-on-all",
      JSON.stringify(history.filterButtons) ===
        JSON.stringify([
          { label: "All", pressed: true },
          { label: "Manual", pressed: false },
          { label: "AI", pressed: false },
        ]),
      `filters=${JSON.stringify(history.filterButtons)}`,
    );
    await shot("history");

    // ══ 7. The filter compares the manual side against the AI side ══════════
    await call(win, "decisionsManualFilter", "Manual");
    const manualFiltered = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.rows.length === 1 && s.rows[0].source === "Manual" &&
          s.filterButtons.find((f) => f.label === "Manual")?.pressed === true;
      })()`,
    );
    const manualOnly = await screen(win);
    checks.manualOnly = manualOnly;
    claim(
      "the-manual-filter-leaves-only-logged-decisions",
      manualFiltered &&
        manualOnly.rows.length === 1 &&
        manualOnly.rows[0].id === "manual-001" &&
        manualOnly.filterButtons.filter((f) => f.pressed).length === 1,
      `settled=${manualFiltered} rows=${JSON.stringify(manualOnly.rows)}`,
    );

    await call(win, "decisionsManualFilter", "AI");
    const aiFiltered = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.rows.length === 2 &&
          s.rows.every((row) => row.source === "AI") &&
          s.filterButtons.find((f) => f.label === "AI")?.pressed === true;
      })()`,
    );
    const aiOnly = await screen(win);
    checks.aiOnly = aiOnly;
    claim(
      "the-ai-filter-leaves-only-inbox-decisions",
      aiFiltered &&
        JSON.stringify(aiOnly.rows.map((row) => row.id)) ===
          JSON.stringify(["decision-001", "decision-002"]),
      `settled=${aiFiltered} rows=${JSON.stringify(aiOnly.rows)}`,
    );

    await call(win, "decisionsManualFilter", "All");
    const allBack = await settle(
      win,
      `window.decisionsManualScreen().rows.length === 3`,
    );
    const all = await screen(win);
    checks.all = all;
    claim(
      "the-all-filter-brings-both-sides-back",
      allBack && all.rows.length === 3,
      `settled=${allBack} rows=${JSON.stringify(all.rows.map((row) => row.id))}`,
    );

    // ══ 8. The record survives leaving the tab, without a remount ══════════
    const mountsBefore = await win.webContents.executeJavaScript(
      "window.decisionsManualMounts()",
    );
    const listCallsBeforeReturn = all.manualListCalls;
    await call(win, "decisionsManualTab", "Pending");
    await settle(win, `window.decisionsManualScreen().activeTab === "Pending"`);
    await call(win, "decisionsManualTab", "History");
    const returned = await settle(
      win,
      `(() => {
        const s = window.decisionsManualScreen();
        return s.activeTab === "History" && s.rows.length === 3 &&
          s.manualListCalls > ${listCallsBeforeReturn};
      })()`,
    );
    const returnScreen = await screen(win);
    const mountsAfter = await win.webContents.executeJavaScript(
      "window.decisionsManualMounts()",
    );
    checks.returned = { ...returnScreen, mountsBefore, mountsAfter };
    claim(
      "a-logged-decision-survives-a-tab-switch-from-the-store",
      returned &&
        returnScreen.rows.some((row) => row.id === "manual-001") &&
        mountsAfter === mountsBefore,
      `settled=${returned} rows=${JSON.stringify(returnScreen.rows.map((row) => row.id))} mounts=${mountsBefore}->${mountsAfter}`,
    );

    // ══ 9. Nothing unexpected, nothing screaming ════════════════════════════
    const unexpected = await win.webContents.executeJavaScript(
      "window.decisionsManualUnexpectedCalls",
    );
    checks.unexpectedBridgeCalls = unexpected;
    claim(
      "the-page-asks-the-bridge-for-nothing-else",
      Array.isArray(unexpected) && unexpected.length === 0,
      `unexpected calls: ${JSON.stringify(unexpected)}`,
    );
    checks.consoleErrors = consoleErrors;
    claim(
      "the-page-logs-no-errors",
      consoleErrors.length === 0,
      `${consoleErrors.length} console errors: ${consoleErrors.join(" | ")}`,
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
    path.join(artifactsDir, "decisions-manual.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const passed = scenarios.filter((scenario) => scenario.pass).length;
  console.log(`decisions-manual  ${passed}/${scenarios.length} claims held`);
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
  console.error("decisions-manual rig timed out");
  app.exit(1);
}, 120_000);
