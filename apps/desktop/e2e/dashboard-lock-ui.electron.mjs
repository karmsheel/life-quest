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
 *  1. UNLOCKED, the board is editable: the badge reads Unlocked, the switch is
 *     off (`aria-checked="false"`), the pin board is offered (closed, and it
 *     draws its row when asked), and every pin carries its unpin / move chrome.
 *     Removing the `locked` gate from any of those renders the locked sample
 *     with editable chrome, which fails. The header is measured too: the badge
 *     sits on the page name's line, while the switch and the pin board's menu
 *     share one top-right row at one height, and hovering the menu draws a
 *     shadow.
 *  2. LOCKED, the board is read-only: badge Locked, switch on, NO pin-board
 *     control at all, no Add-pin row, NO pin chrome at all, and the hint says
 *     where the companion's changes go. This is the claim the whole feature
 *     rests on.
 *  3. The switch is a real write: clicking it records exactly one
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
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const badge = document.querySelector('[data-testid="board-lock-badge"]');
  const toggle = document.querySelector('[data-testid="board-lock-toggle"]');
  const pinboard = document.querySelector('[data-testid="board-add-toggle"]');
  const corner = document.querySelector('[data-testid="home-page-corner"]');
  const heading = document.querySelector(".home-dashboard__title");
  return {
    title: text(".home-dashboard__title"),
    badge: badge ? badge.textContent.trim() : null,
    badgeLocked: badge ? badge.dataset.locked : null,
    badgeClass: badge ? badge.className : null,
    toggle: toggle ? toggle.textContent.trim() : null,
    toggleRole: toggle ? toggle.getAttribute("role") : null,
    toggleChecked: toggle ? toggle.getAttribute("aria-checked") : null,
    toggleLabel: toggle ? toggle.getAttribute("aria-label") : null,
    switchTrack: toggle ? Boolean(toggle.querySelector(".lock-switch__track")) : false,
    switchThumb: toggle ? Boolean(toggle.querySelector(".lock-switch__thumb")) : false,
    hint: text('[data-testid="board-lock-hint"]'),
    // The badge belongs beside the page's name again: its box is compared with
    // the heading's, not with the corner's.
    titleRow: {
      heading: box(heading),
      badge: box(badge),
      viewportWidth: window.innerWidth,
    },
    // The page's controls: the switch and the pin board's menu in one row at
    // the top right. The boxes are read so the row, the order and the matching
    // heights are facts about the rendered page, not claims about the markup.
    corner: corner
      ? {
          switch: box(toggle),
          pinboard: box(pinboard),
          alignItems: getComputedStyle(corner).alignItems,
          flexDirection: getComputedStyle(corner).flexDirection,
          viewportWidth: window.innerWidth,
        }
      : null,
    // The pin board's button is the one control in the corner that wears the
    // accent rather than the page's own neutral surface: the two fill colours
    // are read so "a different colour" is measured, not asserted.
    pinboardPaint: pinboard
      ? {
          background: getComputedStyle(pinboard).backgroundColor,
          color: getComputedStyle(pinboard).color,
          shadow: getComputedStyle(pinboard).boxShadow,
        }
      : null,
    // The pin board is a header control now, closed on landing, so "is Add pin
    // offered?" is two facts: is the control there, and does asking for it draw
    // the row? Both are recorded, and both are asserted.
    addToggle: Boolean(pinboard),
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

/** Wait two frames, so a style change the rig just asked for has painted. */
function nextPaint(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

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
  // The lock is one switch, not a pair of Lock/Unlock buttons: a switch role,
  // the position a reader hears, and a track and thumb that can actually draw
  // the two states.
  if (unlocked.toggleRole !== "switch") {
    failure(`the unlocked board's lock control had role ${JSON.stringify(unlocked.toggleRole)}, expected "switch"`);
  }
  if (unlocked.toggleChecked !== "false") {
    failure(`the unlocked board's switch read aria-checked=${JSON.stringify(unlocked.toggleChecked)}`);
  }
  if (unlocked.toggle !== "Lock") {
    failure(`the unlocked board's switch caption read ${JSON.stringify(unlocked.toggle)}`);
  }
  if (!unlocked.switchTrack || !unlocked.switchThumb) {
    failure("the switch did not render its track and thumb");
  }
  if (!unlocked.addToggle) {
    failure("the unlocked board offered no pin-board control at all");
  }
  if (unlocked.addPinRow) {
    failure("the unlocked board landed with its pin board already open");
  }
  if (unlocked.chrome === 0) failure("the unlocked board drew no pin chrome");
  if (unlocked.chromeButtons === 0) failure("the unlocked board's pin chrome has no buttons");

  // 1a. The badge is back beside the page's name: its box shares the heading's
  //     line, on the left half of the page. The badge that sat in the top-right
  //     corner fails the viewport half of this.
  const titleRow = unlocked.titleRow;
  if (!titleRow?.heading || !titleRow.badge) {
    failure("the page's heading or its badge recorded no box");
  } else {
    const heading = titleRow.heading;
    const badge = titleRow.badge;
    const headingMid = (heading.top + heading.bottom) / 2;
    const badgeMid = (badge.top + badge.bottom) / 2;
    if (Math.abs(headingMid - badgeMid) > 6) {
      failure(
        `the badge is not on the heading's line: badge mid ${badgeMid}, heading mid ${headingMid}`,
      );
    }
    if (badge.left < heading.left || badge.left > heading.left + heading.width) {
      failure(
        `the badge is not inside the heading row: badge left ${badge.left}, heading ${heading.left}..${heading.left + heading.width}`,
      );
    }
    if (badge.right > titleRow.viewportWidth / 2) {
      failure(
        `the badge is still on the page's right: badge right ${badge.right} of ${titleRow.viewportWidth}`,
      );
    }
  }

  // 1b. The page's controls: the switch and the pin board's menu in one row at
  //     the top right, both the same height. The boxes come from the rendered
  //     page, so a stack, a left-aligned row or two different heights fail
  //     here rather than being eyeballed.
  const corner = unlocked.corner;
  if (!corner) {
    failure("the page drew no corner for its controls");
  } else if (!corner.switch) {
    failure("the page's corner is missing its switch");
  } else {
    if (corner.flexDirection !== "row") {
      failure(`the corner lays out ${corner.flexDirection}, expected a row`);
    }
    if (corner.alignItems !== "center") {
      failure(`the corner aligns ${corner.alignItems}, expected centred`);
    }
    if (corner.switch.top > 120) {
      failure(`the page's controls are not at the top: switch top ${corner.switch.top}`);
    }
    if (corner.switch.right < corner.viewportWidth / 2) {
      failure(
        `the page's controls are not on the right: switch right ${corner.switch.right} of ${corner.viewportWidth}`,
      );
    }
    if (unlocked.addToggle) {
      if (!corner.pinboard) {
        failure("the pin board's control did not record a box");
      } else if (Math.abs(corner.switch.top - corner.pinboard.top) > 2) {
        failure(
          `the pin board is not beside the switch: switch top ${corner.switch.top}, pin board top ${corner.pinboard.top}`,
        );
      } else if (corner.pinboard.left < corner.switch.right) {
        failure(
          `the pin board (left ${corner.pinboard.left}) is not to the right of the switch (right ${corner.switch.right})`,
        );
      } else if (corner.pinboard.height !== corner.switch.height) {
        failure(
          `the two controls are not one height: switch ${corner.switch.height}, pin board ${corner.pinboard.height}`,
        );
      }
    }
  }

  // 1c. The pin board's menu wears the accent, not the page's own surface. The
  //     eyebrow is painted in `--accent`, so the two colours are compared
  //     rather than a colour being named.
  if (unlocked.pinboardPaint) {
    const accent = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector(".home-dashboard__eyebrow")).color`,
    );
    if (unlocked.pinboardPaint.color !== accent) {
      failure(
        `the pin board's label is ${unlocked.pinboardPaint.color}, not the page accent ${accent}`,
      );
    }
    if (unlocked.pinboardPaint.background === "rgba(0, 0, 0, 0)") {
      failure("the pin board's button has no fill of its own");
    }
  } else {
    failure("the unlocked board's pin-board button recorded no paint");
  }

  // 1d. And the control really draws the row. Without this, "an unlocked board
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
  if (locked.toggleRole !== "switch") {
    failure(`the locked board's lock control had role ${JSON.stringify(locked.toggleRole)}`);
  }
  if (locked.toggleChecked !== "true") {
    failure(`the locked board's switch read aria-checked=${JSON.stringify(locked.toggleChecked)}, expected "true"`);
  }
  if (locked.toggleLabel !== "Unlock this dashboard") {
    failure(`the locked board's switch is named ${JSON.stringify(locked.toggleLabel)}`);
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
  if (checks.afterUnlockClick.toggleChecked !== "false") {
    failure(
      `the switch still reads aria-checked=${JSON.stringify(checks.afterUnlockClick.toggleChecked)} after unlocking`,
    );
  }
  // Unlocking restores the *offer*, not an open row: the pin board is a control
  // the operator opens, so a fresh unlocked render lands closed like any other.
  if (checks.afterUnlockClick.addPinRow !== false) {
    failure("unlocking left the pin board open on its own");
  }

  // 4b. The pin board's menu answers a hover with a shadow: the computed value
  //     is read at rest and again with the pointer on the button, so "hover
  //     shadow" is a fact about the rendered page rather than a class name.
  const pinboardCentre = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="board-add-toggle"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!pinboardCentre) {
    failure("the restored pin-board control has no box to hover");
  } else {
    const restShadow = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('[data-testid="board-add-toggle"]')).boxShadow`,
    );
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: pinboardCentre.x,
      y: pinboardCentre.y,
    });
    // The shadow is a transition; give it longer than its 120 ms to land before
    // reading the computed value.
    await new Promise((resolve) => setTimeout(resolve, 260));
    const hoveredShadow = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('[data-testid="board-add-toggle"]')).boxShadow`,
    );
    checks.pinboardHover = { rest: restShadow, hovered: hoveredShadow };
    if (hoveredShadow === restShadow || hoveredShadow === "none") {
      failure(
        `hovering the pin board drew no new shadow: ${JSON.stringify(checks.pinboardHover)}`,
      );
    }
    // The hover shadow is the soft, accent-tinted one (a 20 px blur), not the
    // hairline the button wears at rest.
    if (!hoveredShadow.includes("20px") || restShadow.includes("20px")) {
      failure(
        `the pin board's hover shadow is not the lifted one: ${JSON.stringify(checks.pinboardHover)}`,
      );
    }
    const hoverShot = await win.webContents.capturePage();
    fs.writeFileSync(
      path.join(artifactsDir, "dashboard-lock-ui-pinboard-hover.png"),
      hoverShot.toPNG(),
    );
    // Take the pointer off the button so the click below is not a hover press.
    win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
    await nextPaint(win);
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

  // The artifact screenshots: the LOCKED board is the state the feature exists
  // for; the UNLOCKED board is the one that carries the whole corner — badge,
  // switch and the pin board's menu under them.
  await render(win, false);
  await nextPaint(win);
  const unlockedImage = await win.webContents.capturePage();
  await render(win, true);
  await nextPaint(win);

  const report = { pass: errors.length === 0, failures: errors, checks, samples: { unlocked, locked } };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-lock-ui-unlocked.png"),
    unlockedImage.toPNG(),
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.png"), image.toPNG());

  console.log(`unlocked: badge ${unlocked.badge}, switch ${unlocked.toggleChecked}, caption ${unlocked.toggle}, chrome ${unlocked.chrome}, pin-board ${unlocked.addToggle} (row ${unlocked.addPinRow})`);
  console.log(`locked:   badge ${locked.badge}, switch ${locked.toggleChecked}, caption ${locked.toggle}, chrome ${locked.chrome}, pin-board ${locked.addToggle} (row ${locked.addPinRow})`);
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
