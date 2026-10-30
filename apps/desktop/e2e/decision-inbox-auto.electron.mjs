/**
 * Drives the decision inbox's auto-open / auto-close behaviour in a real
 * Electron window and turns the measurements into
 * `e2e/artifacts/decision-inbox-auto.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/decision-inbox-auto.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/decision-inbox-auto-e2e.test.ts`) holds the assertions, this
 * file holds the interactions and the measurements, so a failure names a state
 * rather than a line of driver code.
 *
 * The story it plays, in order:
 *
 *   1. Land on `/work` with one Decision already pending: NO sheet.
 *   2. Scroll the workspace to a known place.
 *   3. The companion files a Decision: the inbox opens over that same page,
 *      without remounting it or moving it.
 *   4. Approve one of the two pending cards: the sheet stays, one card remains.
 *   5. Approve the last one: the sheet closes itself back onto the parked page.
 *   6. Open Settings › Decisions over the page: both switches render ON and the
 *      real toggle writes the real `settingsUpdate` patch.
 *   7. Auto-open off: a filing raises nothing.
 *   8. Auto-open on, auto-close off: the sheet stays up on its empty state.
 *   9. Auto-close on while the sheet is up: a second filing arrives in place and
 *      answering it closes the sheet.
 *
 * Measured because a screenshot cannot show it: the background page's mount
 * count, its scrollTop and content-marker offset before and after every sheet,
 * the body's scroll lock, and the exact settingsUpdate patches and resolve calls
 * the page made.
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
  "http://127.0.0.1:5173/e2e/decision-inbox-auto.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Where the operator's workspace is parked before the first sheet opens. */
const WORKSPACE_TOP = 340;
/** The Decision seeded before the first load: it must NOT pop the inbox. */
const SEEDED_ID = "decision-001";

const states = {};
const steps = {};
const failures = [];

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

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const frames = () =>
    run(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
    );

  const sample = async () => {
    const value = await run("window.decisionAutoScreen()");
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await sleep(ms);
    await frames();
    return sample();
  };

  /**
   * Wait for a state instead of guessing a delay. The report records the state
   * it waited for, so a timeout names the state that never arrived.
   */
  const waitFor = async (label, predicate, timeout = 8000) => {
    const started = Date.now();
    let current = await sample();
    while (!predicate(current)) {
      if (Date.now() - started > timeout) {
        throw new Error(
          `timed out waiting for ${label}; last state: ${JSON.stringify(current)}`,
        );
      }
      await sleep(80);
      current = await sample();
    }
    return current;
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `decision-inbox-auto-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const waitReady = () => run("window.decisionAutoReady.then(() => true)");

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Press one of the two Decisions switches the way a hand would. */
  const clickSwitch = (testId) =>
    run(`(() => {
      const wrap = document.querySelector(
        '[data-testid="' + ${JSON.stringify(testId)} + '"]'
      );
      const el = wrap && (wrap.matches('[role="switch"]') ? wrap : wrap.querySelector('[role="switch"]'));
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const scrollTo = (top) =>
    run(`window.decisionAutoScrollTo(${JSON.stringify(top)})`);

  /**
   * The app's own settings write. `key` and `value` are not part of a
   * `Partial<VaultSettings>` patch shape here because the feature's switch is a
   * nested field; the harness spreads the current object itself.
   */
  const setDecision = async (key, value) => {
    const result = await run(
      `window.decisionAutoSet(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
    );
    return result?.ok === true;
  };

  const fileDecision = async (title) =>
    run(`window.decisionAutoFile(${JSON.stringify(title)})`);

  const approve = async (id) =>
    run(`window.decisionAutoApprove(${JSON.stringify(id)})`);

  const record = (name, value) => {
    states[name] = value;
    return value;
  };

  const step = (name, value) => {
    steps[name] = value;
    return value;
  };

  const expectedSwitchLabels = {
    "settings-decision-auto-open":
      "Open the decisions inbox for a new decision",
    "settings-decision-auto-close":
      "Close the decisions inbox after the last decision",
  };

  const switchBy = (state, testId) =>
    state.switches?.find((entry) => entry.testId === testId);

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    fixture: {
      workspaceTop: WORKSPACE_TOP,
      seededId: SEEDED_ID,
      switchLabels: expectedSwitchLabels,
    },
    states,
    steps,
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await waitReady();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);

    // 1 — the page the inbox will be drawn over, with a queue already waiting.
    //     A pre-existing Decision is not a filing: no sheet may be up.
    record("landing", await settle());

    // 2 — the operator is reading, not at the top of the page.
    step("scroll", await scrollTo(WORKSPACE_TOP));
    record("parked", await settle());

    // 3 — the companion files a Decision: the inbox raises itself over the page.
    step("filedId", await fileDecision("Filed while the operator was reading"));
    const filedId = steps.filedId;
    const filed = record(
      "filed",
      await waitFor(
        "the inbox to open for the new filing",
        (state) =>
          state.sheet === "decisions" &&
          state.cards.length === 2 &&
          state.cards.some((card) => card.id === filedId),
      ),
    );
    record("filed", await settle(120));
    await shot("opened");

    // 4 — one of the two answers the sheet outlives: the queue is not empty yet.
    const approveFirstId =
      filed.cards.find((card) => card.id !== SEEDED_ID)?.id ?? filed.cards[0]?.id;
    step("approveFirstId", approveFirstId ?? null);
    step("approveFirst", approveFirstId ? await approve(approveFirstId) : false);
    record(
      "afterFirstApprove",
      await waitFor(
        "the sheet to stay up with one card left",
        (state) =>
          state.sheet === "decisions" &&
          state.cards.length === 1 &&
          state.actionMessage === "Decision approved.",
      ),
    );

    // 5 — the last pending answer puts the sheet away, onto the parked page.
    const lastId = states.afterFirstApprove.cards[0]?.id;
    step("approveLastId", lastId ?? null);
    step("approveLast", lastId ? await approve(lastId) : false);
    record(
      "closed",
      await waitFor(
        "the last answer to close the inbox onto the workspace",
        (state) => state.sheet === null && state.path === "/work",
      ),
    );
    record("closed", await settle(160));
    await shot("closed");

    // 6 — Settings › Decisions, over the page, with the real switches.
    step("settingsClick", await click("[data-open-settings]"));
    record(
      "settings",
      await waitFor(
        "the settings sheet on its decisions page",
        (state) =>
          state.sheet === "settings" &&
          state.path === "/settings?tab=decisions" &&
          state.switches.length === 2 &&
          state.switches.every((entry) => entry.present),
      ),
    );
    record("settings", await settle(160));
    await shot("settings");

    step("toggleOpenOff", await clickSwitch("settings-decision-auto-open"));
    record(
      "settingsToggledOff",
      await waitFor(
        "the auto-open switch to turn off and write its patch",
        (state) => {
          const toggle = switchBy(state, "settings-decision-auto-open");
          const patch = state.updates[state.updates.length - 1];
          return (
            toggle?.checked === false &&
            patch?.decisionInbox?.autoOpen === false
          );
        },
      ),
    );
    record("settingsToggledOff", await settle(160));

    step("toggleOpenOn", await clickSwitch("settings-decision-auto-open"));
    record(
      "settingsToggledOn",
      await waitFor(
        "the auto-open switch to turn back on and write its patch",
        (state) => {
          const toggle = switchBy(state, "settings-decision-auto-open");
          const patch = state.updates[state.updates.length - 1];
          return (
            toggle?.checked === true &&
            patch?.decisionInbox?.autoOpen === true
          );
        },
      ),
    );
    record("settingsToggledOn", await settle(160));

    // 7 — close Settings, turn auto-open off through the app's own settings
    //     write, and file: nothing may rise over the workspace.
    step("settingsClose", await click(".settings-overlay__close"));
    record(
      "settingsClosed",
      await waitFor(
        "settings to close back onto the workspace",
        (state) => state.sheet === null && state.path === "/work",
      ),
    );
    step("setAutoOpenOff", await setDecision("autoOpen", false));
    record("autoOpenOffSet", await settle(200));
    const beforeAutoOpenOffListCalls = states.autoOpenOffSet.listCalls;

    step("autoOpenOffId", await fileDecision("Filed with auto-open off"));
    // Wait for the watcher's live re-read to happen while auto-open is off, so
    // "no sheet appeared" is a fact about a read that ran, not about a read that
    // had not started yet.
    await waitFor(
      "the watcher to re-read with auto-open off",
      (state) =>
        state.listCalls > beforeAutoOpenOffListCalls && state.sheet === null,
    );
    record("autoOpenOff", await settle(400));
    await shot("auto-open-off");

    // Clear the queue that deliberately did not pop, through the real inbox, so
    // the next step can speak about "the only pending decision".
    step("cleanupOpenClick", await click("[data-open-decisions]"));
    record(
      "cleanupOpened",
      await waitFor(
        "the manually opened inbox",
        (state) => state.sheet === "decisions" && state.cards.length === 1,
      ),
    );
    const cleanupId = states.cleanupOpened.cards[0]?.id;
    step("cleanupApprove", cleanupId ? await approve(cleanupId) : false);
    record(
      "cleanupClosed",
      await waitFor(
        "the answered queue to hand the page back",
        (state) => state.sheet === null && state.path === "/work",
      ),
    );

    // 8 — auto-open on, auto-close off: the sheet opens for the filing and then
    //     stays up on its empty state when the last answer lands.
    step("setAutoOpenOn", await setDecision("autoOpen", true));
    await settle(160);
    step("setAutoCloseOff", await setDecision("autoClose", false));
    record("settingsForStayOpen", await settle(200));

    step("stayOpenFilingId", await fileDecision("Filed while the inbox stays"));
    const stayCardId = steps.stayOpenFilingId;
    record(
      "autoOpenOn",
      await waitFor(
        "the inbox to open with the one pending decision",
        (state) =>
          state.sheet === "decisions" &&
          state.path === "/decisions" &&
          state.cards.length === 1 &&
          state.cards.some((card) => card.id === stayCardId),
      ),
    );

    step("approveStayOpen", stayCardId ? await approve(stayCardId) : false);
    record(
      "stayedOpen",
      await waitFor(
        "the answered inbox to stay up on its empty state",
        (state) =>
          state.sheet === "decisions" &&
          state.path === "/decisions" &&
          state.cards.length === 0 &&
          state.inboxEmpty === "No pending proposals.",
      ),
    );
    record("stayedOpen", await settle(200));
    await shot("stayed-open");

    // 9 — turn auto-close on while the sheet is up. A second filing arrives in
    //     the open sheet (no extra navigation), and answering it closes.
    step("setAutoCloseOn", await setDecision("autoClose", true));
    record("settingsForAutoClose", await settle(200));

    step("filedWhileOpenId", await fileDecision("Filed while the sheet is open"));
    const whileOpenId = steps.filedWhileOpenId;
    record(
      "filedWhileOpen",
      await waitFor(
        "the new card to arrive inside the open sheet",
        (state) =>
          state.sheet === "decisions" &&
          state.path === "/decisions" &&
          state.cards.length === 1 &&
          state.cards.some((card) => card.id === whileOpenId),
      ),
    );

    step(
      "approveWhileOpen",
      whileOpenId ? await approve(whileOpenId) : false,
    );
    record(
      "autoClosedByLast",
      await waitFor(
        "the last answer to close the sheet onto the workspace",
        (state) => state.sheet === null && state.path === "/work",
      ),
    );
    record("autoClosedByLast", await settle(160));
    await shot("final-closed");

    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`,
    );
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "decision-inbox-auto.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [
    ["state", "path", "sheet", "cards", "mounts", "top", "autoOpen", "autoClose"],
  ];
  for (const [name, state] of Object.entries(states)) {
    table.push([
      name,
      state?.path ?? "—",
      state?.sheet ?? "none",
      String(state?.cards?.length ?? "—"),
      String(state?.workspace?.mounts ?? "—"),
      String(state?.workspace?.top ?? "—"),
      String(state?.settings?.autoOpen ?? "—"),
      String(state?.settings?.autoClose ?? "—"),
    ]);
  }
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => String(row[i]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(
    report.pass
      ? "decision inbox auto-open: PASS"
      : "decision inbox auto-open: FAIL",
  );

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app.whenReady().then(main).catch((error) => {
  console.error(
    `decision-inbox-auto: ${error instanceof Error ? error.stack : error}`,
  );
  app.exit(1);
});
