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
 *                        The chrome is read inside the card's own tool row, which
 *                        also holds the chat control: that control is not chrome,
 *                        and this fixture is what keeps the two apart.
 *
 * The Add-pin row is behind the header's toggle, so the driver asks for it before
 * reading its heading. Landing on the page with it closed is `dashboard-card-
 * context`'s claim, not this rig's.
 *
 * NOT covered here: anything about dragging, and the vault-core half of a write.
 * A dev-server page has no preload, so the page's bridge is a stub and a drop's
 * `pinsSet` ends at this rig's recorder.
 *
 * Two seams worth naming. The window is shown inactive and never holds OS focus,
 * so `blur-cancels` dispatches the event a focused window would receive rather
 * than losing focus for real: a window that was never focused cannot lose focus,
 * and no rig here can seize the operator's desktop to arrange one. The listener
 * is what is covered; that the OS raises the event is not. And the harness renders
 * the page without the shell around it, so the scrollport the board scrolls inside
 * is the harness's own box, not `.shell__content` — which the live-app leg covers,
 * since it runs the app's own window.
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
/**
 * Tall enough that the whole seeded board is on screen at once, because a drag
 * can only start on one card and end on another if both are reachable. The
 * harness's scrollport is the window's height, and the size is set per claim:
 * the auto-scroll leg shrinks the window so the board overflows.
 */
const BOARD_SIZE = { width: 1280, height: 1200 };

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
      // The chrome sits inside the card's own tool row now — that row also holds
      // the chat control, which is NOT chrome, so the chrome is still read by its
      // own class and the fixture still means "board-editing chrome".
      chrome: card.querySelectorAll(":scope > .home-pin__tools > .home-pin__chrome").length,
      buttons: [...card.querySelectorAll(":scope > .home-pin__tools > .home-pin__chrome .home-pin__btn")].map((b) => ({
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
  await win.webContents.executeJavaScript(
    "window.dashboardArrangePinWrites.length = 0; document.querySelector('.arrange-scroll').scrollTop = 0;",
  );
}

/**
 * Ask the board for its Add-pin row.
 *
 * The row is behind the header's toggle, and every render lands it closed — the
 * page is keyed on the generation, so a fresh render is a fresh page. Called
 * only where the row itself is being judged; the arranging claims never touch it.
 */
async function openPinBoard(win) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-add-toggle"]')?.click()`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the Add-pin row to open",
  );
}

/** Scroll the board so its far end is on screen; returns nothing. */
async function scrollBoardToEnd(win) {
  await win.webContents.executeJavaScript(
    "(() => { const s = document.querySelector('.arrange-scroll'); s.scrollTop = s.scrollHeight; return s.scrollTop; })()",
  );
  await settleFrames(win);
}

/**
 * Pick a card up by its heading or its grip and put it down on a point.
 *
 * The pointer travels in steps rather than jumping: the slot resolver runs on
 * every move, so a single jump would only prove the last position was read. The
 * three steps are what a real hand does, and they are also what makes "the board
 * reflows as you go" falsifiable.
 *
 * `aim` is a function, not a point, and that is load-bearing: taking a card out
 * of the flow changes the height of the row it was in, so every card below it
 * moves up the moment the drag begins. A point measured before the lift is a
 * point at a card that is no longer there. The aim is resolved *after* the
 * board has reflowed, which is also what an operator does — they watch the board
 * shift and then put the card where the card now is.
 */
async function dragCard(win, pinId, aim, options = {}) {
  const source = await pointOn(
    win,
    options.via === "grip" ? `[data-pin-id="${pinId}"] [data-testid="pin-grip"]` : headingOf(pinId),
  );
  mouse(win, "mouseDown", source.x, source.y);
  // A grip needs no hold but it does need movement: it is armed to drag, not to
  // lift on the press itself.
  if (options.via === "grip") mouse(win, "mouseMove", source.x + 6, source.y);
  const lifted = await waitForLift(win, pinId);
  if (!lifted.includes(pinId)) {
    mouse(win, "mouseUp", source.x, source.y);
    throw new Error(`${pinId} never lifted, so it could not be dragged`);
  }
  // Leave the flow, let the board settle into its new shape, then aim.
  mouse(win, "mouseMove", source.x + 12, source.y + 12);
  await settleFrames(win);
  const target = await aim();
  const steps = 3;
  for (let step = 1; step <= steps; step += 1) {
    mouse(
      win,
      "mouseMove",
      source.x + 12 + ((target.x - source.x - 12) * step) / steps,
      source.y + 12 + ((target.y - source.y - 12) * step) / steps,
    );
    await sleep(40);
  }
  await settleFrames(win);
  mouse(win, "mouseUp", target.x, target.y);
  await sleep(140);
}

/** A point at a fraction across a card, and just inside its top edge. */
async function pointIn(win, pinId, acrossX, downY = 30) {
  const box = await cardRect(win, pinId);
  if (!box) throw new Error(`no card for ${pinId}`);
  return { x: box.left + box.width * acrossX, y: box.top + downY };
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

  // 6. A hold does not move the board, and a drag moves the *room* for the card
  //    into the slot it will land in. `sys:goal-progress` is the board's first
  //    card and a full-row one, so this is the strongest version of the claim:
  //    the whole row it left is what the cards below move up into.
  step("lift-leaves-a-gap");
  await beginScenario(win);
  const restingGoal = await cardRect(win, "sys:goal-progress");
  const restingWeekly = await cardRect(win, "view:financial:v-weekly");
  const gapPoint = await pointOn(win, headingOf("sys:goal-progress"));
  mouse(win, "mouseDown", gapPoint.x, gapPoint.y);
  await waitForLift(win, "sys:goal-progress");
  // Still held, not yet moved: the card is lifted and nothing has shifted.
  const heldWeekly = await cardRect(win, "view:financial:v-weekly");
  const boardStoodStill = Math.abs(heldWeekly.top - restingWeekly.top) <= 2;
  // Now drag it into the row below. The card follows the pointer, and its slot
  // follows it: the layout box is the room it will land in.
  const gapTarget = await pointIn(win, "page:financial:ledger", 0.5, 60);
  mouse(win, "mouseMove", gapTarget.x, gapTarget.y);
  await settleFrames(win);
  const dragged = await cardMotion(win);
  const goalNow = dragged.find((card) => card.id === "sys:goal-progress");
  const weeklyNow = dragged.find((card) => card.id === "view:financial:v-weekly");
  // A drag in progress is the one picture worth keeping: it shows the card in
  // the hand and the room the board has made for it in the same frame.
  try {
    await settleFrames(win);
    const dragShot = await win.webContents.capturePage();
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, "dashboard-arrange-drag.png"), dragShot.toPNG());
  } catch (error) {
    console.log(`[drag screenshot skipped] ${error}`);
  }
  mouse(win, "mouseUp", gapTarget.x, gapTarget.y);
  await sleep(200);
  const gapOrder = await restingOrder(win);
  const closedUp = Boolean(weeklyNow) && Math.abs(weeklyNow.layoutTop - restingGoal.top) <= 2;
  const roomMoved = Boolean(goalNow) && goalNow.layoutTop > restingGoal.top + 40;
  const followsHand = Boolean(goalNow) && Math.abs(goalNow.ty) > 10;
  check(
    "lift-leaves-a-gap",
    boardStoodStill && closedUp && roomMoved && followsHand && gapOrder[0] !== "sys:goal-progress",
    `held: the next card at ${heldWeekly.top} against its resting ${restingWeekly.top}; ` +
      `dragged: the next card's slot at ${weeklyNow?.layoutTop} against the row it left (${restingGoal.top}), ` +
      `the card's own slot at ${goalNow?.layoutTop} with a ${goalNow?.ty} translate, ` +
      `the board now ${JSON.stringify(gapOrder)}`,
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

/**
 * The ordering claims: where a dropped card lands, and that it lands for one
 * write. The board is three tracks wide with full-row cards in it, which is
 * exactly the board the old `↑` / `↓` buttons got wrong: an arrow said "next in
 * the list" while the operator read it as "the cell above".
 */
async function checkOrdering(win) {
  const base = [
    "sys:goal-progress",
    "view:financial:v-weekly",
    "page:financial:ledger",
    "sys:today-week",
    "view:financial:v-summary",
    "sys:pending-decisions",
    "sys:recent-log",
  ];

  // 1. The cell to the right of the card beside it is one slot, not one row.
  step("same-row-targets-by-x");
  await beginScenario(win);
  const tracks = await columns(win);
  await dragCard(win, "view:financial:v-weekly", () => pointIn(win, "page:financial:ledger", 0.8));
  const swapped = await restingOrder(win);
  const swappedWrites = writesOf(await pinWrites(win));
  check(
    "same-row-targets-by-x",
    tracks === 3 &&
      swapped[0] === base[0] &&
      swapped[1] === "page:financial:ledger" &&
      swapped[2] === "view:financial:v-weekly" &&
      swappedWrites.length === 1 &&
      swappedWrites[0].join(",") === swapped.join(","),
    `on a ${tracks}-track board the drop gave ${JSON.stringify(swapped)} for ${swappedWrites.length} write(s)`,
  );

  // 2. A full-row card is not a dead zone: the row band decides, and past its
  //    midpoint the card belongs on the far side of it.
  step("drop-past-a-full-row-card");
  await beginScenario(win);
  await dragCard(win, "view:financial:v-weekly", () => pointIn(win, "sys:today-week", 0.8));
  const afterFullRow = await restingOrder(win);
  check(
    "drop-past-a-full-row-card",
    afterFullRow.join(",") ===
      [
        "sys:goal-progress",
        "page:financial:ledger",
        "sys:today-week",
        "view:financial:v-weekly",
        "view:financial:v-summary",
        "sys:pending-decisions",
        "sys:recent-log",
      ].join(","),
    `dropping past the midpoint of a full-row card gave ${JSON.stringify(afterFullRow)}`,
  );

  // 3. A span-2 card is droppable on either side, and a drop that changes
  //    nothing writes nothing — the second half of this claim is what keeps a
  //    stray drop from reordering the board for free.
  step("wide-card-left-and-right");
  await beginScenario(win);
  await dragCard(win, "sys:pending-decisions", () => pointIn(win, "view:financial:v-summary", 0.2));
  const beforeWide = await restingOrder(win);
  const writesBefore = (await pinWrites(win)).length;
  // The same slot again: the card is already where it would land, so this drop
  // must not reach the vault at all.
  await dragCard(win, "sys:pending-decisions", () => pointIn(win, "view:financial:v-summary", 0.2));
  const afterNoop = await restingOrder(win);
  const writesAfterNoop = (await pinWrites(win)).length;
  // And past the midpoint, the other side of the same card.
  await dragCard(win, "sys:pending-decisions", () => pointIn(win, "view:financial:v-summary", 0.8));
  const afterWide = await restingOrder(win);
  const writesAfter = (await pinWrites(win)).length;
  check(
    "wide-card-left-and-right",
    beforeWide.indexOf("sys:pending-decisions") === 4 &&
      beforeWide.indexOf("view:financial:v-summary") === 5 &&
      writesBefore === 1 &&
      afterNoop.join(",") === beforeWide.join(",") &&
      writesAfterNoop === 1 &&
      afterWide.indexOf("view:financial:v-summary") === 4 &&
      afterWide.indexOf("sys:pending-decisions") === 5 &&
      writesAfter === 2,
    `left half gave ${JSON.stringify(beforeWide)} (${writesBefore} write(s)); a repeat drop gave ` +
      `${JSON.stringify(afterNoop)} (${writesAfterNoop} write(s)); right half gave ` +
      `${JSON.stringify(afterWide)} (${writesAfter} write(s))`,
  );

  // 4. The board's one non-pinnable card is not a slot: dropping on it means the
  //    end of the pins, and no pin is ever placed after it.
  step("drop-on-the-agents-card");
  await beginScenario(win);
  await scrollBoardToEnd(win);
  const agents = await win.webContents.executeJavaScript(
    `(() => {
       const el = [...document.querySelectorAll(".home-dashboard__grid > .home-pin")].find((c) => !c.dataset.pinId);
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left + 40, y: r.top + 20 };
     })()`,
  );
  if (!agents) throw new Error("the board has no Active-agents card");
  await dragCard(win, "sys:pending-decisions", () => agents);
  const ended = await restingOrder(win);
  const endedWrites = writesOf(await pinWrites(win));
  const lastChildIsAgents = await win.webContents.executeJavaScript(
    `!document.querySelector(".home-dashboard__grid").lastElementChild.dataset.pinId`,
  );
  check(
    "drop-on-the-agents-card",
    ended.join(",") ===
      [
        "sys:goal-progress",
        "view:financial:v-weekly",
        "page:financial:ledger",
        "sys:today-week",
        "view:financial:v-summary",
        "sys:recent-log",
        "sys:pending-decisions",
      ].join(",") &&
      endedWrites.length === 1 &&
      lastChildIsAgents === true,
    `dropping on the agents card gave ${JSON.stringify(ended)} for ${endedWrites.length} write(s), ` +
      `agents last: ${lastChildIsAgents}`,
  );

  // 5. A hold and release in place is not a change: the card goes back and the
  //    vault is never asked.
  step("hold-then-release-writes-nothing");
  await beginScenario(win);
  const stillPoint = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", stillPoint.x, stillPoint.y);
  await waitForLift(win, "view:financial:v-weekly");
  mouse(win, "mouseUp", stillPoint.x, stillPoint.y);
  await sleep(140);
  const stillOrder = await restingOrder(win);
  check(
    "hold-then-release-writes-nothing",
    stillOrder.join(",") === base.join(",") && (await pinWrites(win)).length === 0,
    `a hold and release gave ${JSON.stringify(stillOrder)} for ${(await pinWrites(win)).length} write(s)`,
  );

  // 6. The grip is the same gesture: it drags, and it writes once.
  step("grip-drags-and-writes-once");
  await beginScenario(win);
  await dragCard(win, "page:financial:ledger", () => pointIn(win, "view:financial:v-weekly", 0.2), {
    via: "grip",
  });
  const gripOrder = await restingOrder(win);
  const gripWrites = writesOf(await pinWrites(win));
  check(
    "grip-drags-and-writes-once",
    gripOrder[0] === "sys:goal-progress" &&
      gripOrder[1] === "page:financial:ledger" &&
      gripOrder[2] === "view:financial:v-weekly" &&
      gripWrites.length === 1,
    `the grip drag gave ${JSON.stringify(gripOrder)} for ${gripWrites.length} write(s)`,
  );
}

/** The status line's current text: what the board says about the last gesture. */
function statusText(win) {
  return win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector('[data-testid="pin-arrange-status"]');
       return el ? (el.textContent || "").trim() : null;
     })()`,
  );
}

/** A real key press, through the browser's input pipeline. */
async function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "char", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(60);
}

/**
 * Start a drag and hold the card in the air, without dropping it.
 *
 * The gesture is left mid-flight on purpose: the claims that follow are about
 * what ends it — a key, a lost window, a vault that says no — so the test has to
 * be the thing that ends it.
 */
async function holdInTheAir(win, pinId, aim) {
  const source = await pointOn(win, headingOf(pinId));
  mouse(win, "mouseDown", source.x, source.y);
  const lifted = await waitForLift(win, pinId);
  if (!lifted.includes(pinId)) throw new Error(`${pinId} never lifted`);
  mouse(win, "mouseMove", source.x + 12, source.y + 12);
  await settleFrames(win);
  const target = await aim();
  mouse(win, "mouseMove", target.x, target.y);
  await sleep(80);
  return target;
}

/**
 * The claims about how a drag ends when it does not end in a write: a cancelled
 * gesture, and a vault that refuses the order. Both must leave the board in the
 * order it actually has, and both must say so.
 */
async function checkCancelAndRefusal(win) {
  const base = [
    "sys:goal-progress",
    "view:financial:v-weekly",
    "page:financial:ledger",
    "sys:today-week",
    "view:financial:v-summary",
    "sys:pending-decisions",
    "sys:recent-log",
  ];
  const toLedger = () => pointIn(win, "page:financial:ledger", 0.8);

  // 1. Escape mid-drag: the card goes home and nothing is written.
  step("escape-cancels");
  await beginScenario(win);
  const escaped = await holdInTheAir(win, "view:financial:v-weekly", toLedger);
  await pressKey(win, "Escape");
  mouse(win, "mouseUp", escaped.x, escaped.y);
  await sleep(160);
  const escapedOrder = await restingOrder(win);
  const escapedLifted = await liftedIds(win);
  check(
    "escape-cancels",
    escapedOrder.join(",") === base.join(",") &&
      escapedLifted.length === 0 &&
      (await pinWrites(win)).length === 0,
    `Escape left ${JSON.stringify(escapedOrder)} with ${escapedLifted.length} card(s) still lifted ` +
      `and ${(await pinWrites(win)).length} write(s)`,
  );

  // 2. A lost window ends a drag the same way.
  //
  //    The seam: this rig's window is shown inactive and never holds OS focus —
  //    deliberately, because a suite that steals the operator's focus every run
  //    is a suite they turn off — and a window that was never focused cannot
  //    lose focus, so `win.blur()` is a no-op here and a real blur is impossible
  //    to produce. What is dispatched below is the event such a window *would*
  //    receive, which is exactly the hook's contract; that a real focus change
  //    raises one is a claim for `dashboard-live-app`, which runs a shown app.
  step("blur-cancels");
  await beginScenario(win);
  const blurred = await holdInTheAir(win, "view:financial:v-weekly", toLedger);
  await win.webContents.executeJavaScript("window.dispatchEvent(new Event('blur')); true");
  await sleep(200);
  const liftedAfterBlur = await liftedIds(win);
  mouse(win, "mouseUp", blurred.x, blurred.y);
  await sleep(160);
  const blurredOrder = await restingOrder(win);
  check(
    "blur-cancels",
    liftedAfterBlur.length === 0 &&
      blurredOrder.join(",") === base.join(",") &&
      (await pinWrites(win)).length === 0,
    `losing the window left ${liftedAfterBlur.length} card(s) lifted, ` +
      `${JSON.stringify(blurredOrder)} on the board, and ${(await pinWrites(win)).length} write(s)`,
  );

  // 3. The board locked while the drag was in the air: the vault answers
  //    `applied: false`, and the board must stop showing an order it does not
  //    have.
  step("refusal-reverts");
  await beginScenario(win);
  await win.webContents.executeJavaScript("window.dashboardArrangeSetRefuse(true)");
  const refused = await holdInTheAir(win, "view:financial:v-weekly", toLedger);
  mouse(win, "mouseUp", refused.x, refused.y);
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="pin-arrange-status"]').length === 1`,
    "the status line to exist",
  );
  await sleep(400);
  const refusedOrder = await restingOrder(win);
  const refusedWrites = writesOf(await pinWrites(win));
  const refusedStatus = await statusText(win);
  await win.webContents.executeJavaScript("window.dashboardArrangeSetRefuse(false)");
  check(
    "refusal-reverts",
    refusedOrder.join(",") === base.join(",") &&
      refusedWrites.length === 1 &&
      /locked/i.test(refusedStatus ?? ""),
    `a refused write left ${JSON.stringify(refusedOrder)} after ${refusedWrites.length} write(s), ` +
      `and said ${JSON.stringify(refusedStatus)}`,
  );

  // 4. The write that fails outright: same rollback, different words.
  step("refusal-is-announced");
  await beginScenario(win);
  await win.webContents.executeJavaScript("window.dashboardArrangeSetFail(true)");
  const failed = await holdInTheAir(win, "view:financial:v-weekly", toLedger);
  mouse(win, "mouseUp", failed.x, failed.y);
  await sleep(400);
  const failedOrder = await restingOrder(win);
  const failedWrites = writesOf(await pinWrites(win));
  const failedStatus = await statusText(win);
  await win.webContents.executeJavaScript("window.dashboardArrangeSetFail(false)");
  check(
    "refusal-is-announced",
    failedOrder.join(",") === base.join(",") &&
      failedWrites.length === 1 &&
      /could not save/i.test(failedStatus ?? ""),
    `a failed write left ${JSON.stringify(failedOrder)} after ${failedWrites.length} write(s), ` +
      `and said ${JSON.stringify(failedStatus)}`,
  );
}

/**
 * Arranging from the keyboard: the same board, the same one write per drop, and
 * the same announcements. This leg is what makes removing the `↑` / `↓` buttons
 * a trade rather than a loss — they were the only non-pointer path, and this is
 * the one that replaces them.
 */
async function checkKeyboard(win) {
  const base = [
    "sys:goal-progress",
    "view:financial:v-weekly",
    "page:financial:ledger",
    "sys:today-week",
    "view:financial:v-summary",
    "sys:pending-decisions",
    "sys:recent-log",
  ];

  /** Put the keyboard's focus on a card's grip, the way Tab would. */
  const focusGrip = (pinId) =>
    win.webContents.executeJavaScript(
      `(() => {
         const grip = document.querySelector('[data-pin-id="${pinId}"] [data-testid="pin-grip"]');
         if (!grip) return false;
         grip.focus();
         return document.activeElement === grip;
       })()`,
    );

  // 1. Enter lifts, arrows move, Enter drops: one write, and the exact order.
  step("keyboard-moves-and-writes");
  await beginScenario(win);
  const focused = await focusGrip("sys:today-week");
  await pressKey(win, "Return");
  await pressKey(win, "Left");
  await pressKey(win, "Left");
  await pressKey(win, "Return");
  await sleep(200);
  const keyOrder = await restingOrder(win);
  const keyWrites = writesOf(await pinWrites(win));
  check(
    "keyboard-moves-and-writes",
    focused === true &&
      keyOrder.join(",") ===
        [
          "sys:goal-progress",
          "sys:today-week",
          "view:financial:v-weekly",
          "page:financial:ledger",
          "view:financial:v-summary",
          "sys:pending-decisions",
          "sys:recent-log",
        ].join(",") &&
      keyWrites.length === 1 &&
      keyWrites[0].join(",") === keyOrder.join(","),
    `two ArrowLefts from index 3 gave ${JSON.stringify(keyOrder)} for ${keyWrites.length} write(s)`,
  );

  // 2. Down is a row, not a slot — the claim the old arrows got wrong.
  step("keyboard-down-moves-a-row");
  await beginScenario(win);
  const tracks = await columns(win);
  await focusGrip("sys:pending-decisions");
  await pressKey(win, "Return");
  await pressKey(win, "Up");
  await pressKey(win, "Return");
  await sleep(200);
  const rowOrder = await restingOrder(win);
  const rowWrites = writesOf(await pinWrites(win));
  check(
    "keyboard-down-moves-a-row",
    tracks === 3 &&
      rowOrder.indexOf("sys:pending-decisions") === 2 &&
      rowWrites.length === 1,
    `one ArrowUp on a ${tracks}-track board moved the card to index ` +
      `${rowOrder.indexOf("sys:pending-decisions")} for ${rowWrites.length} write(s)`,
  );

  // 3. Escape puts it back and writes nothing.
  step("keyboard-escape-writes-nothing");
  await beginScenario(win);
  await focusGrip("sys:today-week");
  await pressKey(win, "Return");
  await pressKey(win, "Right");
  await pressKey(win, "Escape");
  await sleep(160);
  const escapedOrder = await restingOrder(win);
  check(
    "keyboard-escape-writes-nothing",
    escapedOrder.join(",") === base.join(",") && (await pinWrites(win)).length === 0,
    `Escape from a keyboard lift left ${JSON.stringify(escapedOrder)} with ` +
      `${(await pinWrites(win)).length} write(s)`,
  );

  // 4. The moves are spoken, and so is the outcome.
  step("keyboard-is-announced");
  await beginScenario(win);
  await focusGrip("sys:today-week");
  await pressKey(win, "Return");
  const movingStatus = await statusText(win);
  await pressKey(win, "Left");
  const movedStatus = await statusText(win);
  await pressKey(win, "Return");
  await sleep(200);
  const savedStatus = await statusText(win);
  check(
    "keyboard-is-announced",
    /moving .*today/i.test(movingStatus ?? "") &&
      /position 3 of 7/i.test(movedStatus ?? "") &&
      /saved/i.test(savedStatus ?? ""),
    `the live region said ${JSON.stringify([movingStatus, movedStatus, savedStatus])}`,
  );

  // 5. Focus comes back to the grip of the card that moved, so the operator can
  //    keep arranging without hunting for where they were.
  step("focus-returns-to-the-grip");
  await beginScenario(win);
  await focusGrip("sys:today-week");
  await pressKey(win, "Return");
  await pressKey(win, "Left");
  await pressKey(win, "Return");
  await sleep(300);
  const focusBack = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.activeElement;
       const card = el && el.closest ? el.closest("[data-pin-id]") : null;
       return {
         isGrip: Boolean(el && el.dataset && el.dataset.testid === "pin-grip"),
         pinId: card ? card.dataset.pinId : null,
       };
     })()`,
  );
  check(
    "focus-returns-to-the-grip",
    focusBack.isGrip === true && focusBack.pinId === "sys:today-week",
    `after the drop, focus was on ${JSON.stringify(focusBack)}`,
  );
}

/**
 * Every pin's transform, drawn box, and layout box.
 *
 * The layout box is the drawn box with the card's own translate taken back off:
 * that is the slot the card occupies and the slot the board has made room for. A
 * card mid-animation, and a card being dragged, are both somewhere else on screen
 * than their slot — so a claim about *where the board put a card* is a claim
 * about the layout box, and a claim about movement is a claim about the drawn one.
 */
function cardMotion(win) {
  return win.webContents.executeJavaScript(
    `(() => {
       const parse = (transform) => {
         if (!transform || transform === "none") return { tx: 0, ty: 0 };
         const m = transform.match(/matrix\\(([^)]+)\\)/);
         if (!m) return { tx: 0, ty: 0 };
         const parts = m[1].split(",").map((n) => Number(n.trim()));
         return { tx: parts[4] ?? 0, ty: parts[5] ?? 0 };
       };
       return [...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")].map((el) => {
         const box = el.getBoundingClientRect();
         const { tx, ty } = parse(getComputedStyle(el).transform);
         return {
           id: el.dataset.pinId,
           lifted: el.classList.contains("is-lifted"),
           tx: Math.round(tx * 100) / 100,
           ty: Math.round(ty * 100) / 100,
           left: Math.round(box.left),
           top: Math.round(box.top),
           layoutLeft: Math.round(box.left - tx),
           layoutTop: Math.round(box.top - ty),
         };
       });
     })()`,
  );
}

/**
 * The motion claims: cards move into their new places rather than teleporting,
 * a long board scrolls under a drag, and an operator who asked for less movement
 * gets none of it.
 */
async function checkMotion(win) {
  const movedCards = (sample) => sample.filter((card) => !card.lifted && (card.tx !== 0 || card.ty !== 0));

  // 1. FLIP: the card that changes places is *drawn where it was* at the moment
  //    of the reorder and travels to where it belongs, rather than teleporting.
  //    Three samples: the reorder frame, mid-animation, and at rest.
  step("siblings-animate");
  await beginScenario(win);
  const source = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", source.x, source.y);
  await waitForLift(win, "view:financial:v-weekly");
  mouse(win, "mouseMove", source.x + 12, source.y + 12);
  await settleFrames(win);
  const before = await cardMotion(win);
  const target = await pointIn(win, "page:financial:ledger", 0.8);
  mouse(win, "mouseMove", target.x, target.y);
  await sleep(30);
  const reorder = await cardMotion(win);
  await sleep(70);
  const travelling = await cardMotion(win);
  await sleep(320);
  const settled = await cardMotion(win);
  mouse(win, "mouseUp", target.x, target.y);
  await sleep(220);
  const after = await cardMotion(win);

  const flying = movedCards(reorder);
  const flyer = flying[0];
  const wasThere = flyer ? before.find((card) => card.id === flyer.id) : null;
  const endedUp = flyer ? settled.find((card) => card.id === flyer.id) : null;
  const midWay = flyer ? travelling.find((card) => card.id === flyer.id) : null;
  const between = (value, a, b) => value > Math.min(a, b) && value < Math.max(a, b);
  check(
    "siblings-animate",
    flying.length > 0 &&
      Boolean(wasThere && endedUp) &&
      // Drawn where it was on the reorder frame, in the *layout* position it is
      // heading for: the inverse transform is what stops the jump.
      Math.abs(flyer.left - wasThere.left) <= 2 &&
      Math.abs(flyer.layoutLeft - endedUp.layoutLeft) <= 2 &&
      // And mid-animation it is strictly between the two places, which is what
      // proves it is playing rather than frozen at either end.
      Boolean(midWay) &&
      between(midWay.left, wasThere.left, endedUp.layoutLeft) &&
      movedCards(settled).length === 0 &&
      movedCards(after).length === 0 &&
      Boolean(wasThere && endedUp && wasThere.layoutLeft !== endedUp.layoutLeft),
    `reorder frame: ${JSON.stringify(flyer)} against where it was ${wasThere?.left}; ` +
      `mid-animation: ${midWay?.left}; settled: ${endedUp?.layoutLeft} ` +
      `(${movedCards(settled).length} still moving, ${movedCards(after).length} after the drop)`,
  );

  // 2. A board taller than its box scrolls under a drag, and the card stays under
  //    the pointer while it does.
  step("auto-scroll-follows-the-pointer");
  win.setContentSize(1280, 520);
  await sleep(250);
  await beginScenario(win);
  const shortSource = await pointOn(win, headingOf("view:financial:v-weekly"));
  mouse(win, "mouseDown", shortSource.x, shortSource.y);
  await waitForLift(win, "view:financial:v-weekly");
  mouse(win, "mouseMove", shortSource.x + 10, shortSource.y + 10);
  await settleFrames(win);
  const scrollStart = await win.webContents.executeJavaScript(
    "document.querySelector('.arrange-scroll').scrollTop",
  );
  const edge = await win.webContents.executeJavaScript(
    `(() => { const s = document.querySelector('.arrange-scroll'); const r = s.getBoundingClientRect(); return { x: r.left + 120, y: r.bottom - 12 }; })()`,
  );
  mouse(win, "mouseMove", edge.x, edge.y);
  await sleep(700);
  const scrollEnd = await win.webContents.executeJavaScript(
    "document.querySelector('.arrange-scroll').scrollTop",
  );
  const underPointer = await win.webContents.executeJavaScript(
    `(() => {
       const card = document.querySelector('[data-pin-id="view:financial:v-weekly"]');
       if (!card) return false;
       const r = card.getBoundingClientRect();
       return r.top <= ${Math.round(edge.y)} && r.bottom >= ${Math.round(edge.y)};
     })()`,
  );
  mouse(win, "mouseUp", edge.x, edge.y);
  await sleep(160);
  win.setContentSize(BOARD_SIZE.width, BOARD_SIZE.height);
  await sleep(250);
  check(
    "auto-scroll-follows-the-pointer",
    scrollEnd > scrollStart && underPointer === true,
    `the board scrolled from ${scrollStart} to ${scrollEnd} while the pointer sat at the edge; ` +
      `the card still covers the pointer: ${underPointer}`,
  );

  // 3. Reduced motion: the same reorder, and no card is ever displaced.
  //
  //    The media feature is emulated over CDP because that is the only way to ask
  //    a real engine for it. If this Electron build will not take the emulation,
  //    the claim is dropped rather than faked with an injected stylesheet — an
  //    uncovered CSS guard is honest, a falsely covered one is not.
  step("reduced-motion-is-still");
  let emulated = false;
  try {
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    emulated = true;
  } catch (error) {
    console.log(`[reduced motion not emulated] ${error}`);
  }
  if (!emulated) {
    check(
      "reduced-motion-is-still",
      false,
      "this Electron build refused Emulation.setEmulatedMedia, so prefers-reduced-motion could not be asked for",
    );
  } else {
    await beginScenario(win);
    const prefersReduce = await win.webContents.executeJavaScript(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    );
    const calmSource = await pointOn(win, headingOf("view:financial:v-weekly"));
    mouse(win, "mouseDown", calmSource.x, calmSource.y);
    await waitForLift(win, "view:financial:v-weekly");
    mouse(win, "mouseMove", calmSource.x + 12, calmSource.y + 12);
    await settleFrames(win);
    const calmTarget = await pointIn(win, "page:financial:ledger", 0.8);
    mouse(win, "mouseMove", calmTarget.x, calmTarget.y);
    await sleep(40);
    const calmMid = await cardMotion(win);
    await sleep(200);
    const calmSettled = await cardMotion(win);
    mouse(win, "mouseUp", calmTarget.x, calmTarget.y);
    await sleep(200);
    try {
      win.webContents.debugger.detach();
    } catch {
      // Detaching a debugger that already went away is not a failure.
    }
    check(
      "reduced-motion-is-still",
      prefersReduce === true &&
        movedCards(calmMid).length === 0 &&
        movedCards(calmSettled).length === 0,
      `under reduced motion (${prefersReduce}) the board drew ` +
        `${movedCards(calmMid).length} moving card(s) mid-reorder and ` +
        `${movedCards(calmSettled).length} after it`,
    );
  }
}

async function main() {
  const sessionPartition = `dashboard-arrange-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: BOARD_SIZE.width,
    height: BOARD_SIZE.height,
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
  win.setContentSize(BOARD_SIZE.width, BOARD_SIZE.height);
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
  // The Add-pin row lives behind the header's own toggle now: it is a control at
  // the top of the page rather than permanent furniture below the board, and it
  // lands closed. The heading-identity claim below is about the row, so the row
  // has to be asked for first.
  await openPinBoard(win);

  const sample = await win.webContents.executeJavaScript(SAMPLE);
  checkChromeIdentity(sample);
  /**
   * The board's seeded order and column count, read before any scenario runs.
   * The ordering claims legitimately leave the board rearranged — that is what
   * they are for — so "this rig renders the seven pins in this order" has to be
   * a claim about the fresh board, not about whatever the last drag left behind.
   */
  const order = sample.order;
  const tracks = await columns(win);

  await checkActivation(win);
  await checkOrdering(win);
  await checkCancelAndRefusal(win);
  await checkKeyboard(win);
  await checkMotion(win);

  await renderBoard(win, SEED, false);
  await settleFrames(win);
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-arrange.png"), image.toPNG());

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks: {
      skin,
      scenarios,
      order,
      columns: tracks,
      sample,
      /**
       * A page that grows a dependency on a bridge method this rig does not model
       * fails by name rather than by rendering a quietly empty board, and a page
       * that logs an error while arranging fails too.
       */
      unexpectedBridgeCalls: await win.webContents.executeJavaScript(
        "window.dashboardArrangeUnexpectedCalls",
      ),
      consoleErrors,
    },
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
