/**
 * Drives the companion-brief harness in a real Electron window and turns what
 * the Dashboard actually renders into
 * `e2e/artifacts/companion-brief-ui.{json,png,-expired.png,-stale.png,-empty.png,-menu.png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/companion-brief-ui.electron.mjs
 *
 * The scenario data is NOT written here. The wrapper
 * (`tests/companion-brief-ui-e2e.test.ts`) builds it with the real vault-core —
 * `executeCompanionBriefTool` / `setCompanionBrief` / `readCompanionBrief` /
 * `dismissBriefItem` against a temp vault — and passes this driver a fixture
 * JSON path in `LIFEQUEST_BRIEF_FIXTURE`. So every read this page draws is a
 * read the real server produced, and the report carries both halves:
 *
 *   `server` — the vault's own evidence: the five items it stored and sorted,
 *              the sixth write it refused by name, the read that proves the
 *              refusal changed nothing, the expired item, the stale `writtenAt`,
 *              the empty vault, and the operator dismissal it performed.
 *   `checks`  — what the shipped card drew for those reads, sampled from the DOM.
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims, no eyeballing the app required.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. FIVE ITEMS RENDER IN PRIORITY ORDER WITH KIND, TEXT AND WHY. The card is
 *     the board's FIRST card, holds exactly the five items the server stored,
 *     and their DOM order is priority 1→5 even though the writer sent them in a
 *     different order. Each item's kind label, line and justification are the
 *     server's own strings, read back off the DOM.
 *  2. A SIXTH WRITE IS REFUSED AND THE BOARD DOES NOT MOVE. The wrapper's real
 *     set-tool call with six items returned the exact refusal; the read taken
 *     after that attempt is the same five items; the card is mounted again on
 *     that post-refusal read and draws exactly the same five items, same ids,
 *     same order, same words.
 *  3. AN ITEM PAST ITS `expiresAt` RENDERS FADED AND MARKED "expired". The item
 *     the server put in `recentlyExpired` is drawn with `data-expired="true"`,
 *     the `is-expired` class, a computed opacity below 1, and the literal word
 *     "expired"; the live items beside it are not faded.
 *  4. AN OLD `writtenAt` ADDS THE "Not refreshed since <date>" LINE. A read
 *     written 52 hours ago draws the card's quiet stale line with the same
 *     medium date the page's own locale computes, and no "Invalid Date".
 *  5. AN EMPTY BRIEF SAYS SO. A read with no items draws the exact
 *     "Nothing on the brief today" line instead of drawing nothing.
 *  6. THE DISMISSAL CONTROL OFFERS THE FOUR REASONS AND WRITES ONE. A real press
 *     on the item's Dismiss control opens a menu whose four items are Done /
 *     Not useful / Wrong / Later; a real press on "Not useful" records exactly
 *     `briefDismiss(itemId, "not-useful")` and answers with the REAL vault's
 *     post-dismissal read — the dismissed item leaves, the other four keep
 *     their words and order, and the card stays.
 *
 * The bridge in the harness is a stub (a dev-server page has no preload), so
 * this rig ends at the recorded call plus the server fixture. That a dismissal
 * reaches the vault is the wrapper's half: it ran `dismissBriefItem` against the
 * same temp vault and handed this driver the read it returned.
 *
 * Falsification: the same page is mounted again per scenario and the assertions
 * are about what THIS mount drew, not about a page that had settled earlier. A
 * card that ignored its read shows the same words for two scenarios and fails.
 * The priority claim is the DOM's order against the server's stored order. The
 * refusal claim compares the post-refusal read's item ids with the pre-refusal
 * ids. The dismissal claim is the recorded argument pair and the item ids left
 * on the board.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/companion-brief.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The card's exact empty copy, as shipped in `CompanionBriefCard.tsx`. */
const EMPTY_COPY = "Nothing on the brief today";

const fixturePath = process.env.LIFEQUEST_BRIEF_FIXTURE;
if (!fixturePath) {
  console.error("companion-brief-ui: LIFEQUEST_BRIEF_FIXTURE is not set");
  app.exit(1);
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

/** Read the companion brief card and its place on the board off the rendered page. */
const SAMPLE = `(() => {
  const text = (el) => (el ? (el.textContent || "").trim() : null);
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
  const card = document.querySelector('[data-testid="companion-brief-card"]');
  const pin = card ? card.closest('[data-pin-id]') : null;
  const grid = document.querySelector('.home-dashboard__grid');
  const pinCards = [...document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]')];
  const title = card ? card.querySelector('.home-card__title') : null;
  const items = [...document.querySelectorAll('[data-testid="companion-brief-item"]')].map((li) => {
    const style = getComputedStyle(li);
    return {
      itemId: li.dataset.itemId ?? null,
      kind: li.dataset.kind ?? null,
      priority: li.dataset.priority ?? null,
      expired: li.dataset.expired ?? null,
      classList: [...li.classList],
      opacity: Number(style.opacity),
      kindLabel: text(li.querySelector('[data-testid="companion-brief-kind"]')),
      text: text(li.querySelector('[data-testid="companion-brief-text"]')),
      why: text(li.querySelector('[data-testid="companion-brief-why"]')),
      expiredWord: text(li.querySelector('[data-testid="companion-brief-expired"]')),
      box: box(li),
    };
  });
  const stale = document.querySelector('[data-testid="companion-brief-stale"]');
  const empty = document.querySelector('[data-testid="companion-brief-empty"]');
  const reasons = document.querySelector('[data-testid="companion-brief-reasons"]');
  const reasonButtons = reasons
    ? [...reasons.querySelectorAll('[role="menuitem"]')].map((el) => ({
        text: text(el),
        role: el.getAttribute('role'),
        box: box(el),
      }))
    : [];
  const dismissButtons = [...document.querySelectorAll('[data-testid="companion-brief-dismiss"]')].map(
    (el) => ({
      itemId: el.getAttribute('data-companion-brief-dismiss'),
      label: el.getAttribute('aria-label'),
      expanded: el.getAttribute('aria-expanded'),
      disabled: Boolean(el.disabled),
      box: box(el),
    }),
  );
  return {
    title: text(title),
    cardPresent: Boolean(card),
    cardPinId: pin ? pin.dataset.pinId ?? null : null,
    cardBox: box(card),
    gridPresent: Boolean(grid),
    pinCount: pinCards.length,
    pinIds: pinCards.map((el) => el.dataset.pinId ?? null),
    firstPinId: pinCards.length > 0 ? pinCards[0].dataset.pinId ?? null : null,
    firstPinHoldsCard: Boolean(
      pinCards[0] && pinCards[0].querySelector('[data-testid="companion-brief-card"]'),
    ),
    itemCount: items.length,
    itemIds: items.map((item) => item.itemId),
    items,
    stale: stale ? { text: text(stale), box: box(stale) } : null,
    empty: empty ? { text: text(empty), box: box(empty) } : null,
    staleCount: document.querySelectorAll('[data-testid="companion-brief-stale"]').length,
    emptyCount: document.querySelectorAll('[data-testid="companion-brief-empty"]').length,
    cardCount: document.querySelectorAll('[data-testid="companion-brief-card"]').length,
    itemSelectorCount: document.querySelectorAll('[data-testid="companion-brief-item"]').length,
    menuOpen: Boolean(reasons),
    menuReasons: reasonButtons.map((entry) => entry.text),
    reasonButtons,
    dismissButtons,
    dismissCalls: (window.companionBriefDismissCalls ?? []).slice(),
    calls: (window.companionBriefCalls ?? []).slice(),
    unexpectedCalls: (window.companionBriefUnexpectedCalls ?? []).slice(),
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function evalInPage(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

let generation = 0;


/**
 * Capture the window once its compositor has settled.
 *
 * A hidden window shares the machine with every other rig in the suite, and
 * under that load a `capturePage` taken right after a repaint can still return
 * the PREVIOUS presented frame — the DOM has the items, the pixels do not. So
 * capture repeatedly until two consecutive frames are identical: that is a
 * frame the compositor has finished presenting, not one still in flight.
 */
async function settledCapture(win) {
  const started = Date.now();
  await nextPaint(win);
  // Ask for a fresh full frame first, so the settle loop is comparing frames the
  // current DOM produced rather than two copies of whatever was left on screen.
  win.webContents.invalidate();
  await sleep(60);
  let previous = await win.webContents.capturePage();
  let equalRun = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await sleep(120);
    const next = await win.webContents.capturePage();
    equalRun = next.toPNG().equals(previous.toPNG()) ? equalRun + 1 : 0;
    previous = next;
    // Two matching frames AND enough wall time for the compositor to present a
    // repaint requested a moment ago. One matching pair alone can be two copies
    // of the frame that was already on screen when the capture started.
    if (equalRun >= 2 && Date.now() - started >= 600) return next;
  }
  return previous;
}

/** Wait two frames, so a style change the rig just asked for has painted. */
function nextPaint(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
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

/** Press, hold briefly, release — a plain click as a browser delivers it. */
async function press(win, point, holdMs = 40) {
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(holdMs);
  mouse(win, "mouseUp", point.x, point.y);
  await sleep(120);
}

/**
 * The centre of the element `selectorExpression` resolves to, after scrolling it
 * into view, verified with `elementFromPoint` so a press that would land on
 * something else is never mistaken for a press on the control.
 */
async function elementPoint(win, selectorExpression, label) {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const el = ${selectorExpression};
    if (!el) return { found: false, reason: "no element" };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { found: false, reason: "no box" };
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      found: true,
      x,
      y,
      hitInside: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
      hitTag: hit ? hit.tagName : null,
    };
  })()`);
  if (!result || !result.found) {
    throw new Error(`no pressable point for ${label}: ${JSON.stringify(result)}`);
  }
  if (!result.hitInside) {
    throw new Error(
      `the ${label} point is covered by ${JSON.stringify(result.hitTag)} instead of the control`,
    );
  }
  return { x: result.x, y: result.y };
}

/**
 * Install a read behind the page, mount the page again, and sample the card.
 *
 * `ready` is the card fact that says this mount's read has landed — a count, a
 * presence — so the sample is never the previous scenario's DOM.
 */
async function render(win, setup, ready, label) {
  generation += 1;
  const before = await evalInPage(win, "window.companionBriefCommits ?? 0");
  if (setup) await evalInPage(win, setup);
  await evalInPage(win, `window.companionBriefRender(${generation})`);
  await waitFor(
    win,
    `(window.companionBriefCommits ?? 0) > ${before}`,
    `the page to commit (${label})`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="companion-brief-card"]'))`,
    `the companion brief card to draw (${label})`,
  );
  await waitFor(win, ready, `the card's read to land (${label})`);
  return evalInPage(win, SAMPLE);
}

/** Items in one priority order: 1 is read first, the card's own rule. */
function inPriorityOrder(items, recentlyExpired) {
  return [...items, ...recentlyExpired].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

const readSetup = (scenarioName) =>
  `window.companionBriefSetRead(${JSON.stringify(fixture.scenarios[scenarioName].read)})`;

/** The card's shell and place on the board, judged from the grid's own order. */
function checkShell(sample, where) {
  if (!sample.gridPresent) failure(`${where}: the page drew no board grid`);
  if (!sample.cardPresent) failure(`${where}: the board drew no companion brief card`);
  if (sample.cardCount !== 1) {
    failure(`${where}: the board drew ${sample.cardCount} companion brief cards`);
  }
  if (sample.title !== "Companion brief") {
    failure(`${where}: the card's title read ${JSON.stringify(sample.title)}`);
  }
  if (sample.firstPinId !== "sys:companion-brief") {
    failure(
      `${where}: the board's first card is ${JSON.stringify(sample.firstPinId)}, expected the companion brief`,
    );
  }
  if (!sample.firstPinHoldsCard) {
    failure(`${where}: the board's first card does not hold the companion brief card`);
  }
  if (sample.cardPinId !== "sys:companion-brief") {
    failure(`${where}: the card sits on pin ${JSON.stringify(sample.cardPinId)}`);
  }
  if (!sample.cardBox || sample.cardBox.width <= 0 || sample.cardBox.height <= 0) {
    failure(`${where}: the card painted no box`);
  }
}

/** One drawn item against the server's own item. */
function checkItem(drawn, expected, labels, where) {
  if (!drawn) {
    failure(`${where}: item ${expected.id} was not drawn`);
    return;
  }
  if (drawn.itemId !== expected.id) {
    failure(
      `${where}: item ${expected.id} was drawn in the order position of ${JSON.stringify(drawn.itemId)}`,
    );
  }
  if (drawn.kind !== expected.kind) {
    failure(`${where}: item ${expected.id} drew kind ${JSON.stringify(drawn.kind)}`);
  }
  const label = labels[expected.kind];
  if (drawn.kindLabel !== label) {
    failure(
      `${where}: item ${expected.id} drew kind label ${JSON.stringify(drawn.kindLabel)}, expected ${JSON.stringify(label)}`,
    );
  }
  if (drawn.text !== expected.text) {
    failure(
      `${where}: item ${expected.id} drew text ${JSON.stringify(drawn.text)}, expected ${JSON.stringify(expected.text)}`,
    );
  }
  if (drawn.why !== expected.why) {
    failure(
      `${where}: item ${expected.id} drew why ${JSON.stringify(drawn.why)}, expected ${JSON.stringify(expected.why)}`,
    );
  }
  if (Number(drawn.priority) !== expected.priority) {
    failure(
      `${where}: item ${expected.id} drew priority ${JSON.stringify(drawn.priority)}, expected ${expected.priority}`,
    );
  }
  if (!drawn.box || drawn.box.width <= 0 || drawn.box.height <= 0) {
    failure(`${where}: item ${expected.id} painted no box`);
  }
}

/** The five-item board: priority order, kind, text, why, no expired, no stale. */
function checkFive(sample, where) {
  const expected = fixture.scenarios.five.read.items;
  checkShell(sample, where);
  if (expected.length !== 5) {
    failure(`${where}: the server fixture does not hold five items`);
  }
  if (sample.itemCount !== 5) {
    failure(`${where}: the card drew ${sample.itemCount} item(s), expected five`);
  }
  const priorities = expected.map((item) => item.priority);
  if (JSON.stringify(priorities) !== JSON.stringify([1, 2, 3, 4, 5])) {
    failure(`${where}: the server's order is not priority 1..5: ${JSON.stringify(priorities)}`);
  }
  if (JSON.stringify(sample.itemIds) !== JSON.stringify(expected.map((item) => item.id))) {
    failure(
      `${where}: the card drew ${JSON.stringify(sample.itemIds)}, expected the server's priority order ${JSON.stringify(expected.map((item) => item.id))}`,
    );
  }
  expected.forEach((item, index) => checkItem(sample.items[index], item, fixture.labels, where));
  for (const drawn of sample.items) {
    if (drawn.expired !== "false" || drawn.classList.includes("is-expired")) {
      failure(`${where}: item ${drawn.itemId} drew as expired on a current brief`);
    }
    if (drawn.expiredWord !== null) {
      failure(`${where}: item ${drawn.itemId} drew the expired word on a current brief`);
    }
    if (drawn.opacity !== 1) {
      failure(`${where}: item ${drawn.itemId} was faded on a current brief (opacity ${drawn.opacity})`);
    }
  }
  if (sample.staleCount !== 0 || sample.stale) {
    failure(`${where}: a freshly written brief drew the "Not refreshed since" line`);
  }
  if (sample.emptyCount !== 0 || sample.empty) {
    failure(`${where}: a five-item brief drew the empty state`);
  }
  if (!(sample.calls ?? []).includes("briefGet")) {
    failure(`${where}: the card never read the brief through briefGet`);
  }
}

async function main() {
  const sessionPartition = `companion-brief-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 40 ms press hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
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
  await waitFor(win, "Boolean(window.companionBriefReady)", "companionBriefReady");

  const checks = {};

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every design claim below would be about the wrong theme.
  checks.skin = await evalInPage(
    win,
    "({ name: window.companionBriefSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. FIVE ITEMS, PRIORITY ORDER, KIND + TEXT + WHY ─────────────────────
  const five = await render(
    win,
    readSetup("five"),
    `document.querySelectorAll('[data-testid="companion-brief-item"]').length === 5`,
    "five items",
  );
  checks.five = five;
  checkFive(five, "five items");
  const fiveImage = await settledCapture(win);
  // The screenshot must be the frame the sample describes, not a later or
  // earlier board: read the DOM again at the instant of the capture.
  const fiveAtCapture = await evalInPage(win, SAMPLE);
  checks.fiveAtCapture = fiveAtCapture;
  if (
    fiveAtCapture.itemCount !== five.itemCount ||
    JSON.stringify(fiveAtCapture.itemIds) !== JSON.stringify(five.itemIds)
  ) {
    failure(
      `the board changed between the five-item sample and its screenshot: ${JSON.stringify(five.itemIds)} -> ${JSON.stringify(fiveAtCapture.itemIds)}`,
    );
  }

  // ── 2. THE SIXTH WRITE WAS REFUSED AND THE BOARD DID NOT MOVE ────────────
  const sixth = fixture.server && fixture.server.sixthWrite;
  if (!sixth || sixth.refused !== true) {
    failure("the server fixture carries no refused sixth write");
  } else {
    if (sixth.attempted !== 6) {
      failure(`the sixth write attempt carried ${JSON.stringify(sixth.attempted)} items`);
    }
    if (sixth.message !== "too many brief items (max 5)") {
      failure(
        `the sixth write was refused with ${JSON.stringify(sixth.message)}, expected "too many brief items (max 5)"`,
      );
    }
    if (sixth.code !== "MALFORMED") {
      failure(`the sixth write refusal carried code ${JSON.stringify(sixth.code)}`);
    }
  }
  if (fixture.server && fixture.server.readUnchangedAfterRefusal !== true) {
    failure("the server read changed after the refused sixth write");
  }
  const afterRefusal = await render(
    win,
    readSetup("fiveAfterRefusal"),
    `document.querySelectorAll('[data-testid="companion-brief-item"]').length === 5`,
    "five items after the refused sixth write",
  );
  checks.fiveAfterRefusal = afterRefusal;
  checkShell(afterRefusal, "after the refused sixth write");
  if (afterRefusal.itemCount !== five.itemCount) {
    failure(
      `the refused write changed the board: ${five.itemCount} items before, ${afterRefusal.itemCount} after`,
    );
  }
  if (JSON.stringify(afterRefusal.itemIds) !== JSON.stringify(five.itemIds)) {
    failure(
      `the refused write reordered or replaced the board: ${JSON.stringify(five.itemIds)} -> ${JSON.stringify(afterRefusal.itemIds)}`,
    );
  }
  for (let index = 0; index < five.items.length; index += 1) {
    const before = five.items[index];
    const after = afterRefusal.items[index];
    if (
      !after ||
      after.itemId !== before.itemId ||
      after.kind !== before.kind ||
      after.text !== before.text ||
      after.why !== before.why ||
      after.priority !== before.priority
    ) {
      failure(
        `the refused write changed item ${before.itemId} on the board: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
    }
  }

  // ── 3. AN ITEM PAST ITS EXPIRY IS FADED AND MARKED ───────────────────────
  const expiredRead = fixture.scenarios.expired.read;
  const expiredOrder = inPriorityOrder(expiredRead.items, expiredRead.recentlyExpired);
  const expired = await render(
    win,
    readSetup("expired"),
    `document.querySelectorAll('[data-testid="companion-brief-item"]').length === ${expiredOrder.length}`,
    "expired item",
  );
  checks.expired = expired;
  checkShell(expired, "expired item");
  if (expiredRead.recentlyExpired.length !== 1) {
    failure(
      `the server fixture put ${expiredRead.recentlyExpired.length} item(s) in recentlyExpired, expected one`,
    );
  }
  if (JSON.stringify(expired.itemIds) !== JSON.stringify(expiredOrder.map((item) => item.id))) {
    failure(
      `the expired board drew ${JSON.stringify(expired.itemIds)}, expected ${JSON.stringify(expiredOrder.map((item) => item.id))}`,
    );
  }
  const expiredIds = new Set(expiredRead.recentlyExpired.map((item) => item.id));
  expiredOrder.forEach((item, index) => {
    const drawn = expired.items[index];
    checkItem(drawn, item, fixture.labels, "expired item");
    if (!drawn) return;
    if (expiredIds.has(item.id)) {
      if (drawn.expired !== "true") {
        failure(`the expired item ${item.id} drew data-expired=${JSON.stringify(drawn.expired)}`);
      }
      if (!drawn.classList.includes("is-expired")) {
        failure(`the expired item ${item.id} drew without the is-expired class`);
      }
      if (!(drawn.opacity < 1)) {
        failure(`the expired item ${item.id} was not faded (opacity ${drawn.opacity})`);
      }
      if (drawn.expiredWord !== "expired") {
        failure(
          `the expired item ${item.id} drew ${JSON.stringify(drawn.expiredWord)} instead of the word expired`,
        );
      }
    } else {
      if (drawn.expired !== "false") {
        failure(`the live item ${item.id} drew data-expired=${JSON.stringify(drawn.expired)}`);
      }
      if (drawn.opacity !== 1) {
        failure(`the live item ${item.id} was faded (opacity ${drawn.opacity})`);
      }
      if (drawn.expiredWord !== null) {
        failure(`the live item ${item.id} drew the expired word`);
      }
    }
  });
  if (expired.itemCount !== expiredOrder.length) {
    failure(
      `the expired board drew ${expired.itemCount} item(s), expected ${expiredOrder.length}`,
    );
  }
  if (expired.staleCount !== 0 || expired.stale) {
    failure("a two-hour-old brief drew the stale line");
  }
  await nextPaint(win);
  const expiredImage = await settledCapture(win);

  // ── 4. AN OLD writtenAt ADDS THE STALE LINE ──────────────────────────────
  const staleRead = fixture.scenarios.stale.read;
  const stale = await render(
    win,
    readSetup("stale"),
    `Boolean(document.querySelector('[data-testid="companion-brief-stale"]')) && document.querySelectorAll('[data-testid="companion-brief-item"]').length === ${staleRead.items.length}`,
    "stale brief",
  );
  checks.stale = stale;
  checkShell(stale, "stale brief");
  if (!stale.stale || stale.staleCount !== 1) {
    failure("a brief written 52 hours ago drew no stale line");
  } else {
    const staleDate = await evalInPage(
      win,
      `new Date(${JSON.stringify(staleRead.writtenAt)}).toLocaleDateString(undefined, { dateStyle: "medium" })`,
    );
    const expectedStale = `Not refreshed since ${staleDate}`;
    checks.staleExpected = expectedStale;
    if (stale.stale.text !== expectedStale) {
      failure(
        `the stale line read ${JSON.stringify(stale.stale.text)}, expected ${JSON.stringify(expectedStale)}`,
      );
    }
    if (stale.stale.text.includes("Invalid Date")) {
      failure(`the stale line painted an invalid date: ${JSON.stringify(stale.stale.text)}`);
    }
  }
  if (stale.itemIds.length !== staleRead.items.length) {
    failure(
      `the stale brief drew ${stale.itemIds.length} item(s), expected ${staleRead.items.length}`,
    );
  }
  staleRead.items.forEach((item, index) => checkItem(stale.items[index], item, fixture.labels, "stale brief"));
  if (stale.emptyCount !== 0 || stale.empty) {
    failure("a stale brief with items drew the empty state");
  }
  await nextPaint(win);
  const staleImage = await settledCapture(win);

  // ── 5. AN EMPTY BRIEF SAYS SO ────────────────────────────────────────────
  const empty = await render(
    win,
    readSetup("empty"),
    `Boolean(document.querySelector('[data-testid="companion-brief-empty"]'))`,
    "empty brief",
  );
  checks.empty = empty;
  checkShell(empty, "empty brief");
  if (empty.itemCount !== 0) {
    failure(`an empty brief drew ${empty.itemCount} item(s)`);
  }
  if (!empty.empty || empty.emptyCount !== 1) {
    failure("an empty brief drew no empty state");
  } else if (empty.empty.text !== EMPTY_COPY) {
    failure(
      `the empty copy read ${JSON.stringify(empty.empty.text)}, expected ${JSON.stringify(EMPTY_COPY)}`,
    );
  }
  if (empty.staleCount !== 0 || empty.stale) {
    failure("an empty brief drew the stale line");
  }
  await nextPaint(win);
  const emptyImage = await settledCapture(win);

  // ── 6. THE DISMISSAL MENU: FOUR REASONS, ONE CALL, ONE ITEM GONE ─────────
  const dismiss = fixture.scenarios.dismiss;
  const dismissBefore = await render(
    win,
    `window.companionBriefSetRead(${JSON.stringify(dismiss.before)})`,
    `document.querySelectorAll('[data-testid="companion-brief-item"]').length === ${dismiss.before.items.length}`,
    "dismissal before",
  );
  checks.dismissBefore = dismissBefore;
  checkFive(dismissBefore, "dismissal before");
  await evalInPage(
    win,
    `window.companionBriefSetDismissRead(${JSON.stringify(dismiss.after)})`,
  );

  const targetId = dismiss.call.itemId;
  const dismissSelector = `[data-companion-brief-dismiss=${JSON.stringify(targetId)}]`;
  const dismissPoint = await elementPoint(
    win,
    `document.querySelector(${JSON.stringify(dismissSelector)})`,
    "Dismiss control",
  );
  await press(win, dismissPoint);
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="companion-brief-reasons"]'))`,
    "the dismissal menu to open",
  );
  const menu = await evalInPage(win, SAMPLE);
  checks.menu = menu;
  const expectedReasons = fixture.reasonLabels;
  if (!menu.menuOpen) {
    failure("a press on Dismiss opened no reasons menu");
  }
  if (JSON.stringify(menu.menuReasons) !== JSON.stringify(expectedReasons)) {
    failure(
      `the dismissal menu offered ${JSON.stringify(menu.menuReasons)}, expected ${JSON.stringify(expectedReasons)}`,
    );
  }
  if (menu.reasonButtons.length !== 4) {
    failure(`the dismissal menu drew ${menu.reasonButtons.length} reason(s), expected four`);
  }
  if (menu.reasonButtons.some((entry) => entry.role !== "menuitem")) {
    failure("the dismissal menu's choices are not menuitems");
  }
  if (!menu.dismissButtons.some((entry) => entry.itemId === targetId && entry.expanded === "true")) {
    failure(`the Dismiss control for ${targetId} did not report its menu expanded`);
  }
  // The menu itself is the artifact for claim 6: four reasons, on the shipped
  // card, beside the item they settle.
  const menuImage = await settledCapture(win);
  const menuAtCapture = await evalInPage(win, SAMPLE);
  checks.menuAtCapture = menuAtCapture;
  if (!menuAtCapture.menuOpen) {
    failure("the reasons menu closed before its screenshot was captured");
  } else if (JSON.stringify(menuAtCapture.menuReasons) !== JSON.stringify(expectedReasons)) {
    failure(
      `the reason menu at capture read ${JSON.stringify(menuAtCapture.menuReasons)}, expected ${JSON.stringify(expectedReasons)}`,
    );
  }

  const notUsefulLabel = "Not useful";
  const notUsefulPoint = await elementPoint(
    win,
    `[...document.querySelectorAll('[data-testid="companion-brief-reasons"] [role="menuitem"]')].find((el) => (el.textContent || "").trim() === ${JSON.stringify(notUsefulLabel)})`,
    "Not useful reason",
  );
  await press(win, notUsefulPoint);
  await waitFor(
    win,
    `(window.companionBriefDismissCalls ?? []).length === 1 && document.querySelectorAll('[data-testid="companion-brief-item"]').length === ${dismiss.after.items.length}`,
    "the dismissal to land",
  );
  const dismissed = await evalInPage(win, SAMPLE);
  checks.dismissed = dismissed;
  checkShell(dismissed, "dismissal after");
  if (dismissed.dismissCalls.length !== 1) {
    failure(
      `the card made ${dismissed.dismissCalls.length} briefDismiss call(s), expected one: ${JSON.stringify(dismissed.dismissCalls)}`,
    );
  } else {
    const call = dismissed.dismissCalls[0];
    if (call.itemId !== targetId) {
      failure(`the card dismissed ${JSON.stringify(call.itemId)}, expected ${JSON.stringify(targetId)}`);
    }
    if (call.reason !== "not-useful") {
      failure(
        `the card dismissed for reason ${JSON.stringify(call.reason)}, expected "not-useful"`,
      );
    }
  }
  if (dismissed.menuOpen) {
    failure("the reasons menu stayed open after a reason was chosen");
  }
  if (dismissed.itemIds.includes(targetId)) {
    failure(`the dismissed item ${targetId} is still on the board`);
  }
  if (JSON.stringify(dismissed.itemIds) !== JSON.stringify(dismiss.after.items.map((item) => item.id))) {
    failure(
      `after the dismissal the board drew ${JSON.stringify(dismissed.itemIds)}, expected the server's remaining set ${JSON.stringify(dismiss.after.items.map((item) => item.id))}`,
    );
  }
  if (dismissed.itemCount !== dismiss.before.items.length - 1) {
    failure(
      `the dismissal left ${dismissed.itemCount} item(s), expected ${dismiss.before.items.length - 1}`,
    );
  }
  dismiss.after.items.forEach((item, index) => {
    checkItem(dismissed.items[index], item, fixture.labels, "dismissal after");
  });

  // ── NOTHING UNEXPECTED, NOTHING ON FIRE ──────────────────────────────────
  const unexpected = dismissed.unexpectedCalls ?? [];
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    generatedAt: new Date().toISOString(),
    driver: "companion-brief-ui",
    server: fixture.server,
    labels: fixture.labels,
    reasonLabels: fixture.reasonLabels,
    checks,
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "companion-brief-ui.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(artifactsDir, "companion-brief-ui.png"), fiveImage.toPNG());
  fs.writeFileSync(
    path.join(artifactsDir, "companion-brief-ui-expired.png"),
    expiredImage.toPNG(),
  );
  fs.writeFileSync(path.join(artifactsDir, "companion-brief-ui-stale.png"), staleImage.toPNG());
  fs.writeFileSync(path.join(artifactsDir, "companion-brief-ui-empty.png"), emptyImage.toPNG());
  fs.writeFileSync(path.join(artifactsDir, "companion-brief-ui-menu.png"), menuImage.toPNG());

  console.log(
    `five:     first ${JSON.stringify(five.firstPinId)}, ${five.itemCount} item(s), order ${JSON.stringify(five.items.map((item) => item.priority))}, kinds ${JSON.stringify(five.items.map((item) => item.kindLabel))}`,
  );
  console.log(
    `refused:  sixth write refused (${JSON.stringify(sixth?.message)}); board unchanged ${JSON.stringify(JSON.stringify(five.itemIds) === JSON.stringify(afterRefusal.itemIds))}`,
  );
  console.log(
    `expired:  ${JSON.stringify(checks.expired?.items?.filter((item) => item.expired === "true").map((item) => ({ id: item.itemId, opacity: item.opacity, word: item.expiredWord })))}`,
  );
  console.log(`stale:    ${JSON.stringify(checks.stale?.stale?.text)}`);
  console.log(`empty:    ${JSON.stringify(checks.empty?.empty?.text)}`);
  console.log(
    `dismiss:  menu ${JSON.stringify(checks.menu?.menuReasons)} -> ${JSON.stringify(checks.dismissed?.dismissCalls)}; left ${JSON.stringify(checks.dismissed?.itemIds)}`,
  );
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
  console.error("companion-brief-ui rig timed out");
  app.exit(1);
}, 90_000);
