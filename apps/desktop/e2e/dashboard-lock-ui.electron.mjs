/**
 * Drives the dashboard-lock harness in a real Electron window and turns what
 * the Dashboard actually renders into `e2e/artifacts/dashboard-lock-ui.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-lock-ui.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. UNLOCKED, the board is editable: the badge reads Unlocked, the header
 *     control offers Lock, the pin board is offered (closed, and it draws its row
 *     when asked), and every pin carries its unpin / move chrome. Removing the
 *     `locked` gate from any of those renders the locked sample with editable
 *     chrome, which fails.
 *  2. LOCKED, the board is read-only: badge Locked, control offers Unlock, NO
 *     pin-board control at all, no Add-pin row, NO pin chrome at all, and the
 *     hint says where the companion's changes go. This is the claim the whole
 *     feature rests on.
 *  3. The toggle is a real write: clicking it records exactly one
 *     `pinsSetLocked` call carrying the board slug and the new value, and the
 *     page re-renders to the new state.
 *  4. It works in both directions: unlocking from locked restores the editable
 *     chrome, so the control is a toggle and not a one-way switch.
 *  5. No console errors, and no bridge call outside the recording stub — a page
 *     that grows a new dependency fails by name rather than rendering an empty
 *     board.
 *
 * NOT covered here: that a locked board files a Decision instead of writing.
 * That is the vault-core half, in `dashboard-lock-e2e`, which runs the same
 * `save_view` call against a real vault on disk.
 *
 * Falsification: the locked/unlocked samples are two different board states fed
 * to the same page and read back from the DOM, so a page that ignores `locked`
 * shows the same chrome twice and fails claim 2. The toggle claim is proven by
 * the recorded call, not by the label changing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-lock.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Read the board's chrome straight off the rendered page. */
const SAMPLE = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || "").trim() : null;
  };
  const badge = document.querySelector('[data-testid="board-lock-badge"]');
  const toggle = document.querySelector('[data-testid="board-lock-toggle"]');
  return {
    title: text(".home-dashboard__title"),
    badge: badge ? badge.textContent.trim() : null,
    badgeLocked: badge ? badge.dataset.locked : null,
    badgeClass: badge ? badge.className : null,
    toggle: toggle ? toggle.textContent.trim() : null,
    hint: text('[data-testid="board-lock-hint"]'),
    // The pin board is a header control now, closed on landing, so "is Add pin
    // offered?" is two facts: is the control there, and does asking for it draw
    // the row? Both are recorded, and both are asserted.
    addToggle: Boolean(document.querySelector('[data-testid="board-add-toggle"]')),
    addPinRow: Boolean(document.querySelector('[data-testid="board-add-pin"]')),
    pins: document.querySelectorAll(".home-dashboard__grid > .home-pin").length,
    chrome: document.querySelectorAll(".home-pin__chrome").length,
    chromeButtons: document.querySelectorAll(".home-pin__chrome .home-pin__btn").length,
    strayAddButtons: document.querySelectorAll(".home-pin-add__btn").length,
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        value = undefined;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

let generation = 0;

/** Install a board, re-render the page, and read the chrome back. */
async function render(win, locked) {
  generation += 1;
  const before = await win.webContents.executeJavaScript(
    "window.dashboardLockCommits ?? 0",
  );
  await win.webContents.executeJavaScript(
    `window.dashboardLockSetBoard(${JSON.stringify([
      { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
      { id: "sys:recent-log", kind: "system", system: "recent-log" },
    ])}, ${locked ? "true" : "false"})`,
  );
  await win.webContents.executeJavaScript(
    `window.dashboardLockRender(${generation})`,
  );
  await waitFor(
    win,
    `(window.dashboardLockCommits ?? 0) > ${before}`,
    `the page to commit with locked=${locked}`,
  );
  // The board read is async: the badge is the last thing to settle.
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === '${locked ? "true" : "false"}'; })()`,
    `the badge to read locked=${locked}`,
  );
  return win.webContents.executeJavaScript(SAMPLE);
}

async function main() {
  const sessionPartition = `dashboard-lock-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: sessionPartition, backgroundThrottling: false },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.dashboardLockReady)", "dashboardLockReady");

  const checks = {};

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every design claim below would be about the wrong theme.
  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.dashboardLockSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. UNLOCKED: editable ─────────────────────────────────────────────────
  const unlocked = await render(win, false);
  checks.unlocked = unlocked;
  if (unlocked.badge !== "Unlocked") {
    failure(`the unlocked board's badge read ${JSON.stringify(unlocked.badge)}`);
  }
  if (unlocked.toggle !== "Lock") {
    failure(`the unlocked board's control read ${JSON.stringify(unlocked.toggle)}`);
  }
  if (!unlocked.addToggle) {
    failure("the unlocked board offered no pin-board control at all");
  }
  if (unlocked.addPinRow) {
    failure("the unlocked board landed with its pin board already open");
  }
  if (unlocked.chrome === 0) failure("the unlocked board drew no pin chrome");
  if (unlocked.chromeButtons === 0) failure("the unlocked board's pin chrome has no buttons");

  // 1b. And the control really draws the row. Without this, "an unlocked board
  //     offers Add pin" would be a claim about a button nobody pressed.
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-add-toggle"]').click()`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the pin board to open on the unlocked board",
  );
  const opened = await win.webContents.executeJavaScript(SAMPLE);
  checks.openedPinBoard = opened;
  if (!opened.addPinRow) failure("the pin-board control did not draw the Add-pin row");
  if (opened.strayAddButtons === 0) failure("the opened Add-pin row offered nothing to add");

  // ── 2. LOCKED: read-only ──────────────────────────────────────────────────
  const locked = await render(win, true);
  checks.locked = locked;
  if (locked.badge !== "Locked") {
    failure(`the locked board's badge read ${JSON.stringify(locked.badge)}`);
  }
  if (locked.badgeLocked !== "true") {
    failure(`the locked board's badge data-locked read ${JSON.stringify(locked.badgeLocked)}`);
  }
  if (locked.toggle !== "Unlock") {
    failure(`the locked board's control read ${JSON.stringify(locked.toggle)}`);
  }
  if (locked.addToggle) {
    failure("a locked board still offered the pin-board control");
  }
  if (locked.addPinRow) failure("a locked board still offered the Add-pin row");
  if (locked.chrome !== 0) {
    failure(`a locked board drew ${locked.chrome} pin chrome bar(s) — the board is still editable`);
  }
  if (locked.chromeButtons !== 0) {
    failure(`a locked board drew ${locked.chromeButtons} pin button(s)`);
  }
  if (locked.pins !== unlocked.pins) {
    failure(
      `the lock changed the board's contents: ${unlocked.pins} pins unlocked, ${locked.pins} locked`,
    );
  }
  if (!(locked.hint ?? "").includes("locked")) {
    failure(`the locked hint did not say the board is locked: ${JSON.stringify(locked.hint)}`);
  }
  if (!(locked.hint ?? "").includes("Decisions")) {
    failure(`the locked hint did not say where agent changes go: ${JSON.stringify(locked.hint)}`);
  }

  // ── 3. the toggle writes, and 4. it works both ways ───────────────────────
  // Lock is rendered right now (sample 2), so the click must ask for locked:false.
  const locksBefore = await win.webContents.executeJavaScript(
    "(window.dashboardLockLockCalls ?? []).length",
  );
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
  );
  await waitFor(
    win,
    `(window.dashboardLockLockCalls ?? []).length > ${locksBefore}`,
    "the lock toggle to call the bridge",
  );
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the board to render unlocked after the click",
  );
  const calls = await win.webContents.executeJavaScript("window.dashboardLockLockCalls");
  checks.toggleCalls = calls;
  if (calls.length !== 1) failure(`the toggle called the bridge ${calls.length} times, expected 1`);
  if (calls[0]?.locked !== false) {
    failure(`unlocking sent locked=${JSON.stringify(calls[0]?.locked)}`);
  }
  if (calls[0]?.boardSlug !== null) {
    failure(`the Overview board was addressed as ${JSON.stringify(calls[0]?.boardSlug)}, expected null`);
  }
  if ((await win.webContents.executeJavaScript(
    `document.querySelectorAll(".home-pin__chrome").length`,
  )) === 0) {
    failure("unlocking did not restore the pin chrome");
  }
  checks.afterUnlockClick = await win.webContents.executeJavaScript(SAMPLE);
  if (checks.afterUnlockClick.addToggle !== true) {
    failure("unlocking did not restore the pin-board control");
  }
  // Unlocking restores the *offer*, not an open row: the pin board is a control
  // the operator opens, so a fresh unlocked render lands closed like any other.
  if (checks.afterUnlockClick.addPinRow !== false) {
    failure("unlocking left the pin board open on its own");
  }
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-add-toggle"]').click()`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the restored pin-board control to draw the row",
  );
  if ((await win.webContents.executeJavaScript(SAMPLE)).addPinRow !== true) {
    failure("the restored pin-board control did not draw the Add-pin row");
  }

  // ── 5. nothing unexpected, nothing on fire ────────────────────────────────
  const unexpected = await win.webContents.executeJavaScript(
    "window.dashboardLockUnexpectedCalls",
  );
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  const pinWrites = await win.webContents.executeJavaScript(
    "window.dashboardLockPinWrites",
  );
  checks.pinWritesWhileLocked = pinWrites;
  if (pinWrites.length > 0) {
    failure(`a pin write reached the bridge: ${JSON.stringify(pinWrites)}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The artifact screenshot is the LOCKED board: it is the state the feature
  // exists for, so that is what a reader should see.
  await render(win, true);
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );

  const report = { pass: errors.length === 0, failures: errors, checks, samples: { unlocked, locked } };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.png"), image.toPNG());

  console.log(`unlocked: badge ${unlocked.badge}, control ${unlocked.toggle}, chrome ${unlocked.chrome}, pin-board ${unlocked.addToggle} (row ${unlocked.addPinRow})`);
  console.log(`locked:   badge ${locked.badge}, control ${locked.toggle}, chrome ${locked.chrome}, pin-board ${locked.addToggle} (row ${locked.addPinRow})`);
  console.log(`toggle:   ${JSON.stringify(calls)}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("dashboard-lock-ui rig timed out");
  app.exit(1);
}, 90_000);
