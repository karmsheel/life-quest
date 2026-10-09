/**
 * Drives the dashboard-arrange harness in a real Electron window and turns what
 * the Dashboard actually does into `e2e/artifacts/dashboard-arrange.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-arrange.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * The claims, and what makes each falsifiable:
 *
 *  1. `skin`           — the harness painted in the app's own skin. A rig on
 *                        base tokens judges a palette nobody runs.
 *  2. `chrome-identity` — every card's chrome is icon-only, and the icon is the
 *                        named one: `lucide-grip-vertical` for move,
 *                        `lucide-pin-off` for unpin, `lucide-maximize-2` /
 *                        `lucide-minimize-2` for the card's width. The rig reads
 *                        the class lucide-react stamps on the `<svg>`, so the
 *                        claim is "this exact icon" rather than "some svg". No
 *                        glyph character (`✕ ↑ ↓ ◧ ♭`) survives anywhere in the
 *                        chrome, which is what a half-migrated chrome fails.
 *
 * NOT covered here: anything about dragging, and the vault-core half of a write.
 * A dev-server page has no preload, so the page's bridge is a stub and a drop's
 * `pinsSet` ends at this rig's recorder.
 *
 * Input is dispatched through `webContents.sendInputEvent` — the browser's own
 * input pipeline — never through a hand-built `PointerEvent`, because the claims
 * to come are about activation timing, hit-testing, and pointer capture.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-arrange.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The board the harness seeds, restated so the driver can install it again. */
const SEED = [
  { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: "v-weekly", span: 1 },
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "ledger" },
  { id: "sys:today-week", kind: "system", system: "today-week" },
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: "v-summary", span: 2 },
  { id: "sys:pending-decisions", kind: "system", system: "pending-decisions" },
  { id: "sys:recent-log", kind: "system", system: "recent-log" },
];

/**
 * Everything the rig reads off the board in one pass: the cards in DOM order,
 * each card's chrome buttons with the icon each draws, the chrome's whole text
 * (which must hold no glyph), and the Add-pin heading's icon.
 */
const SAMPLE = `(() => {
  const cards = [...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")];
  const icons = (el) => [...((el && el.querySelector("svg") ? el.querySelector("svg").classList : []) || [])].join(" ");
  const heading = document.querySelector('[data-testid="board-add-pin"] .home-card__title');
  return {
    order: cards.map((card) => card.dataset.pinId),
    cards: cards.map((card) => ({
      id: card.dataset.pinId,
      chrome: card.querySelectorAll(":scope > .home-pin__chrome").length,
      buttons: [...card.querySelectorAll(":scope > .home-pin__chrome .home-pin__btn")].map((b) => ({
        testid: b.dataset.testid || null,
        label: b.getAttribute("aria-label"),
        title: b.getAttribute("title"),
        text: (b.textContent || "").trim(),
        svgs: b.querySelectorAll("svg").length,
        icon: [...((b.querySelector("svg") ? b.querySelector("svg").classList : []) || [])].join(" "),
      })),
    })),
    chromeText: [...document.querySelectorAll(".home-pin__chrome")].map((el) => el.textContent || "").join(""),
    lifted: document.querySelectorAll(".home-pin.is-lifted").length,
    arranging: document.querySelectorAll(".home-dashboard__grid.is-arranging").length,
    addPinHeading: heading
      ? { text: (heading.textContent || "").trim(), svgs: heading.querySelectorAll("svg").length, icon: icons(heading) }
      : null,
  };
})()`;

const GLYPHS = ["✕", "↑", "↓", "◧", "♭"];

const errors = [];
const scenarios = [];

function failure(message) {
  errors.push(message);
  return message;
}

function check(name, pass, detail) {
  scenarios.push({ name, pass: Boolean(pass), detail: detail ?? null });
  if (!pass) failure(`${name}: ${detail ?? "failed"}`);
  return Boolean(pass);
}

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a painted frame, with a floor.
 *
 * A hidden window's `requestAnimationFrame` can be throttled to nothing, and an
 * unbounded promise on it would hang the whole rig; the timeout is what makes
 * "wait for a frame" a bounded request rather than a bet.
 */
function settleFrames(win) {
  return win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let frames = 0;
       const tick = () => { frames += 1; if (frames >= 2) resolve(true); else requestAnimationFrame(tick); };
       requestAnimationFrame(tick);
       setTimeout(() => resolve(false), 400);
     })`,
  );
}

/** Say where the rig is, so a hang names itself instead of timing out dumb. */
function step(name) {
  console.log(`… ${name}`);
}

/** Real input, through the browser's own pipeline. */
function mouse(win, type, x, y) {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

/**
 * A point on an element that is really on it.
 *
 * A press is only a press if it lands: a card scrolled out of the board's
 * scrollport still has a rect, and `sendInputEvent` at that rect hits whatever
 * is on top instead. Checking `elementFromPoint` turns that into a named failure
 * ("the rig could not press the card") rather than a mysterious scenario FAIL —
 * the board changed under the rig, and the rig says so.
 */
async function pointOn(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: "no element" };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x, y, width: r.width, height: r.height, top: r.top, left: r.left,
        inside: Boolean(hit && (hit === el || el.contains(hit))),
        hit: hit ? (typeof hit.className === "string" && hit.className ? hit.className : hit.tagName) : null,
      };
    })()`,
  );
  if (point.error) throw new Error(`no element for ${selector}`);
  if (!point.inside) {
    throw new Error(
      `the point on ${selector} is not on it (it hits ${JSON.stringify(point.hit)}) — is the card inside the board's scrollport?`,
    );
  }
  return point;
}

/** The board's pins, in the order the DOM has them — the order the operator sees. */
function restingOrder(win) {
  return win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")].map((el) => el.dataset.pinId)`,
  );
}

/**
 * How many grid tracks the board has: the column count the slot rule and the
 * keyboard's Up/Down have to respect.
 *
 * Read from the grid's resolved `grid-template-columns` rather than by counting
 * the cards in the first row, because several home cards are full-row
 * (`home-card--wide`, a span-2 view, the deadline banner), so a "row" of the
 * board is not a row of the grid.
 */
function columns(win) {
  return win.webContents.executeJavaScript(
    `(() => {
      const grid = document.querySelector(".home-dashboard__grid");
      if (!grid) return 0;
      const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
      return tracks === "" || tracks === "none" ? 0 : tracks.split(/\\s+/).length;
    })()`,
  );
}

let generation = 0;

/** Install a board, re-render the page, and wait for it to settle. */
async function renderBoard(win, pins, locked) {
  generation += 1;
  const before = await win.webContents.executeJavaScript("window.dashboardArrangeCommits ?? 0");
  await win.webContents.executeJavaScript(
    `window.dashboardArrangeSetBoard(${JSON.stringify(pins)}, ${locked ? "true" : "false"}); window.dashboardArrangeRender(${generation}); true`,
  );
  await waitFor(
    win,
    `(window.dashboardArrangeCommits ?? 0) > ${before}`,
    `the page to commit with ${pins.length} pins locked=${locked}`,
  );
  // The board read is async, so the cards are the last thing to settle. The
  // count is the pins plus the one card that is not a pin — the Active-agents
  // card — which is why it is `pins.length + 1` rather than `pins.length`.
  await waitFor(
    win,
    `(() => {
       const badge = document.querySelector('[data-testid="board-lock-badge"]');
       const settled = badge && badge.dataset.locked === '${locked ? "true" : "false"}';
       const cards = document.querySelectorAll('.home-dashboard__grid > .home-pin').length;
       return settled && cards === ${pins.length + 1};
     })()`,
    "the board to render its cards",
  );
  await sleep(60);
}

/**
 * The selector for a card's own heading.
 *
 * Presses go here and never on a card's centre, because every home card ends in
 * a link and a press on an interactive element is deliberately not a drag. The
 * heading is in every card, is never interactive, and names the card.
 */
function headingOf(pinId) {
  return `[data-pin-id="${pinId}"] .home-card__title, [data-pin-id="${pinId}"] .view-card__title`;
}

/** A card's box, rounded: the geometry every claim about a gap is made of. */
function cardRect(win, pinId) {
  return win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector('[data-pin-id="${pinId}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top),
        width: Math.round(r.width), height: Math.round(r.height),
        position: getComputedStyle(el).position,
      };
    })()`,
  );
}

/** The pins currently lifted — the DOM's answer, not the page's state. */
function liftedIds(win) {
  return win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".home-dashboard__grid > .home-pin.is-lifted")].map((el) => el.dataset.pinId ?? null)`,
  );
}

function arrangingCount(win) {
  return win.webContents.executeJavaScript(
    `document.querySelectorAll(".home-dashboard__grid.is-arranging").length`,
  );
}

function chromeCount(win) {
  return win.webContents.executeJavaScript(`document.querySelectorAll(".home-pin__chrome").length`);
}

function pinWrites(win) {
  return win.webContents.executeJavaScript("window.dashboardArrangePinWrites");
}

const writesOf = (writeList) => writeList.map((pins) => pins.map((pin) => pin.id));

/** Every scenario starts from the same seeded board, and from an empty write log. */
async function beginScenario(win, options = {}) {
  await renderBoard(win, SEED, options.locked === true);
  await win.webContents.executeJavaScript("window.dashboardArrangePinWrites.length = 0");
}

/** Press, wait, and let go — the shape of every activation claim here. */
async function press(win, point, holdMs) {
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(holdMs);
  mouse(win, "mouseUp", point.x, point.y);
  await sleep(80);
}

/**
 * Wait for a named card to be lifted, or give up.
 *
 * The page's hold is a real 220 ms timer on its own event loop, and this rig
 * shares a machine with every other Electron rig in the suite: a stalled
 * renderer can miss a fixed sleep by more than the hold. Polling makes the claim
 * "a hold lifts the card" rather than "a hold lifts the card within 400 ms of a
 * stalled machine", and the negative claims below get their margin instead.
 */
async function waitForLift(win, pinId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lifted = await liftedIds(win);
    if (lifted.includes(pinId)) return lifted;
    if (Date.now() > deadline) return lifted;
    await sleep(40);
  }
}

/** The named icon each control must draw, per card kind. */
function expectedIcons(pin) {
  const expected = { "pin-grip": "lucide-grip-vertical", "pin-unpin": "lucide-pin-off" };
  if (pin.kind === "view") {
    expected["pin-span"] = pin.span === 2 ? "lucide-minimize-2" : "lucide-maximize-2";
  }
  return expected;
}

/** The chrome, as one falsifiable claim. */
function checkChromeIdentity(sample) {
  const problems = [];

  if (sample.cards.length !== SEED.length) {
    problems.push(`the board rendered ${sample.cards.length} pin cards, expected ${SEED.length}`);
  }

  for (const pin of SEED) {
    const card = sample.cards.find((c) => c.id === pin.id);
    if (!card) {
      problems.push(`${pin.id} has no card`);
      continue;
    }
    if (card.chrome !== 1) {
      problems.push(`${pin.id} wears ${card.chrome} chrome bars, expected 1`);
      continue;
    }
    const expected = expectedIcons(pin);
    const got = card.buttons.map((b) => b.testid).sort();
    const want = Object.keys(expected).sort();
    if (got.join(",") !== want.join(",")) {
      problems.push(`${pin.id} offers [${got.join(", ")}], expected [${want.join(", ")}]`);
      continue;
    }
    for (const button of card.buttons) {
      const where = `${pin.id} ${button.testid}`;
      if (button.svgs !== 1) problems.push(`${where} draws ${button.svgs} icons, expected 1`);
      if (button.text !== "") problems.push(`${where} still draws the text ${JSON.stringify(button.text)}`);
      if (!button.label) problems.push(`${where} has no aria-label`);
      if (!button.title) problems.push(`${where} has no title`);
      const want2 = expected[button.testid];
      if (want2 && !button.icon.includes(want2)) {
        problems.push(`${where} draws ${JSON.stringify(button.icon)}, expected ${want2}`);
      }
    }
  }

  const glyphs = GLYPHS.filter((g) => sample.chromeText.includes(g));
  if (glyphs.length > 0) {
    problems.push(`the chrome still draws the glyphs ${glyphs.join(" ")}`);
  }

  const heading = sample.addPinHeading;
  if (!heading) {
    problems.push("the Add-pin row is missing, so its heading could not be read");
  } else if (heading.svgs < 1 || !heading.icon.includes("lucide-pin")) {
    problems.push(`the Add-pin heading draws ${heading.svgs} icons (${JSON.stringify(heading.icon)})`);
  }

  return check("chrome-identity", problems.length === 0, problems.join("; "));
}

/**
 * The activation claims: what lifts a card, and — just as important — what does
 * not. A hold that fires on any press would break every link on the board, so
 * each of these is a claim about restraint as much as about the lift.
 */
async function checkActivation(win) {
  // 1. A short press is a press. If the hold threshold were ever removed, this
  //    is the scenario that fails, and it fails on a board whose links still work.
  step("short-press-is-not-a-drag");
  await beginScenario(win);
  const heading = await pointOn(win, headingOf("view:financial:v-weekly"));
  await press(win, heading, 60);
  // Past the hold's own deadline: a timer that had survived the release would
  // have fired by now, so this is a claim rather than a race with one.
  await sleep(400);
  check(
    "short-press-is-not-a-drag",
    (await liftedIds(win)).length === 0 && (await pinWrites(win)).length === 0,
    `a 60 ms press lifted ${JSON.stringify(await liftedIds(win))} and wrote ${(await pinWrites(win)).length} time(s)`,
  );

  // 2. Moving before the hold fires is a scroll or a selection, not a drag.
  step("movement-cancels-the-hold");
  await beginScenario(win);
  const moving = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", moving.x, moving.y);
  await sleep(50);
  mouse(win, "mouseMove", moving.x + 20, moving.y);
  await sleep(500);
  const afterMove = await liftedIds(win);
  mouse(win, "mouseUp", moving.x + 20, moving.y);
  await sleep(80);
  check(
    "movement-cancels-the-hold",
    afterMove.length === 0,
    `a 20 px move before the hold still lifted ${JSON.stringify(afterMove)}`,
  );

  // 3. The hold itself: 220 ms on the card, and the card is off the board.
  step("hold-lifts");
  await beginScenario(win);
  const holdPoint = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", holdPoint.x, holdPoint.y);
  const lifted = await waitForLift(win, "view:financial:v-weekly");
  const arranging = await arrangingCount(win);
  // The screenshot is a deliverable, not a claim: wait for a painted frame (a
  // capture before the compositor has one fails with a viz error) and let a
  // failure to capture cost the artifact, never the run.
  fs.mkdirSync(artifactsDir, { recursive: true });
  try {
    await settleFrames(win);
    const liftShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "dashboard-arrange-lift.png"), liftShot.toPNG());
  } catch (error) {
    console.log(`[lift screenshot skipped] ${error}`);
  }
  mouse(win, "mouseUp", holdPoint.x, holdPoint.y);
  await sleep(80);
  check(
    "hold-lifts",
    lifted.length === 1 && lifted[0] === "view:financial:v-weekly" && arranging === 1,
    `a hold lifted ${JSON.stringify(lifted)} with ${arranging} arranging grid(s)`,
  );

  // 4. The grip needs no hold: it is the affordance, so movement is enough.
  step("grip-lifts-at-once");
  await beginScenario(win);
  const grip = await pointOn(win, `[data-pin-id="view:financial:v-weekly"] [data-testid="pin-grip"]`);
  mouse(win, "mouseDown", grip.x, grip.y);
  await sleep(30);
  mouse(win, "mouseMove", grip.x + 6, grip.y);
  const gripLifted = await waitForLift(win, "view:financial:v-weekly", 1000);
  mouse(win, "mouseUp", grip.x + 6, grip.y);
  await sleep(80);
  check(
    "grip-lifts-at-once",
    gripLifted.length === 1 && gripLifted[0] === "view:financial:v-weekly",
    `the grip lifted ${JSON.stringify(gripLifted)} after 6 px and no hold`,
  );

  // 5. A press on a card's link is the link's, hold or no hold.
  step("press-on-a-link-is-not-a-drag");
  await beginScenario(win);
  const link = await pointOn(win, '[data-pin-id="page:financial:ledger"] a.home-card__more');
  await press(win, link, 400);
  check(
    "press-on-a-link-is-not-a-drag",
    (await liftedIds(win)).length === 0 && (await pinWrites(win)).length === 0,
    "a hold on a card's link lifted the card",
  );

  // 6. A hold does not move the board, and a drag does. `sys:goal-progress` is a
  //    full-row card, so when it does leave the flow the whole first row is what
  //    closes — the strongest form of the claim.
  step("lift-leaves-a-gap");
  await beginScenario(win);
  const restingGoal = await cardRect(win, "sys:goal-progress");
  const restingWeekly = await cardRect(win, "view:financial:v-weekly");
  const gapPoint = await pointOn(win, headingOf("sys:goal-progress"));
  mouse(win, "mouseDown", gapPoint.x, gapPoint.y);
  await waitForLift(win, "sys:goal-progress");
  // Still held, not yet moved: the card is lifted and nothing has shifted.
  const heldGoal = await cardRect(win, "sys:goal-progress");
  const heldWeekly = await cardRect(win, "view:financial:v-weekly");
  const boardStoodStill =
    heldGoal.position === "relative" &&
    Math.abs(heldGoal.top - restingGoal.top) <= 2 &&
    Math.abs(heldWeekly.top - restingWeekly.top) <= 2;
  // Now drag it, and the board closes the gap behind it.
  mouse(win, "mouseMove", gapPoint.x + 40, gapPoint.y + 4);
  const dragged = await waitFor(win, `(() => {
    const el = document.querySelector('[data-pin-id="sys:goal-progress"]');
    return el && getComputedStyle(el).position === 'absolute';
  })()`, "the dragged card to leave the board's flow", 3000).then(() => true, () => false);
  await settleFrames(win);
  const draggedGoal = await cardRect(win, "sys:goal-progress");
  const closedWeekly = await cardRect(win, "view:financial:v-weekly");
  mouse(win, "mouseUp", gapPoint.x + 40, gapPoint.y + 4);
  await sleep(80);
  const closedUp =
    closedWeekly &&
    Math.abs(closedWeekly.top - restingGoal.top) <= 2 &&
    Math.abs(closedWeekly.left - restingGoal.left) <= 2;
  check(
    "lift-leaves-a-gap",
    boardStoodStill && dragged && draggedGoal.position === "absolute" && closedUp,
    `held: ${heldGoal.position} at ${heldGoal.top} against a resting ${restingGoal.top}, ` +
      `the next card at ${heldWeekly.top}/${heldWeekly.left}; ` +
      `dragged: ${draggedGoal.position}, the next card at ` +
      `${closedWeekly?.top}/${closedWeekly?.left} against the resting ${restingGoal.top}/${restingGoal.left}`,
  );

  // 7. A locked board is inert — no chrome, no lift, no write.
  step("locked-is-inert");
  await beginScenario(win, { locked: true });
  const lockedPoint = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", lockedPoint.x, lockedPoint.y);
  await sleep(400);
  const lockedLifted = await liftedIds(win);
  mouse(win, "mouseUp", lockedPoint.x, lockedPoint.y);
  await sleep(80);
  const lockedChrome = await chromeCount(win);
  const lockedWrites = (await pinWrites(win)).length;
  check(
    "locked-is-inert",
    lockedLifted.length === 0 && lockedChrome === 0 && lockedWrites === 0,
    `a locked board drew ${lockedChrome} chrome bar(s), lifted ${JSON.stringify(lockedLifted)}, and wrote ${lockedWrites} time(s)`,
  );

  await beginScenario(win);
}

async function main() {
  const sessionPartition = `dashboard-arrange-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      /**
       * The page's lift is a real 220 ms timer, and this rig runs beside every
       * other Electron window in the suite. Chromium throttles timers and stops
       * painting in an occluded window, which is exactly what a background rig
       * is — without this, "hold a card and it lifts" would really be "hold a
       * card and it lifts if this window happens to be in front".
       */
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.dashboardArrangeReady)", "dashboardArrangeReady");

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every design claim below would be about the wrong theme.
  const skin = await win.webContents.executeJavaScript(
    "({ name: window.dashboardArrangeSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  check(
    "skin",
    Boolean(skin.name) && skin.applied === skin.name,
    `the harness painted ${JSON.stringify(skin)}`,
  );

  await renderBoard(win, SEED, false);

  const sample = await win.webContents.executeJavaScript(SAMPLE);
  checkChromeIdentity(sample);

  await checkActivation(win);
  const order = await restingOrder(win);
  const tracks = await columns(win);

  await renderBoard(win, SEED, false);
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-arrange.png"), image.toPNG());

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks: { skin, scenarios, order, columns: tracks, sample },
    samples: { board: sample },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-arrange.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`order:    ${order.join(" ")}`);
  console.log(`columns:  ${tracks}`);
  console.log(`cards:    ${sample.cards.length}`);
  for (const scenario of scenarios) {
    console.log(`${scenario.name}: ${scenario.pass ? "PASS" : "FAIL"}${scenario.detail ? ` — ${scenario.detail}` : ""}`);
  }
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
  console.error("dashboard-arrange rig timed out");
  app.exit(1);
}, 90_000);
