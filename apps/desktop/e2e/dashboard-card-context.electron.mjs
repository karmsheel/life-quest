/**
 * Drives the dashboard-card-context harness in a real Electron window and turns
 * what the Dashboard actually renders into
 * `e2e/artifacts/dashboard-card-context.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-card-context.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. `add-toggle-is-closed-on-landing` — the pin board is not furniture. The
 *     row is absent and the control says it is closed. A page that still renders
 *     the row permanently fails on the sample, not on a glance.
 *  2. `add-toggle-opens-and-closes` — it is a control, not a one-way door: the
 *     row appears with the board's own add buttons, and disappears again.
 *  3. `pin-board-sits-above-the-grid` — proven with `compareDocumentPosition`,
 *     so "at the top" is a fact about the document and not about a screenshot.
 *  4. `locked-board-has-no-add-path` — a locked board has no toggle, no row and
 *     no add button anywhere. This is the claim the lock's whole meaning rests
 *     on: no second, hidden way to propose what Lock says is not editable.
 *  5. `add-pin-still-writes` — the moved row still does its job: one `pinsSet`,
 *     carrying the board plus exactly the pin that was asked for.
 *  6. `every-card-offers-the-chat-control` — every pinned card, of every kind,
 *     carries exactly one chat control that draws one icon, has no text, and has
 *     both an accessible name and a tooltip. A card that quietly lost the
 *     control fails by id.
 *  7. `the-chat-control-is-not-editing-chrome` — it is not inside
 *     `.home-pin__chrome`, and the chrome's own buttons are unchanged. This is
 *     what keeps "chrome" meaning *editing chrome*, which `dashboard-lock-ui`
 *     counts on.
 *  8. `chat-control-hands-over-the-card` — clicking hands that exact pin, with
 *     the board slug, to the dock, and opens the dock. A control that set nothing
 *     fails on the probe's own report.
 *  9. `the-name-comes-off-the-heading` — the handed-over name is read off the
 *     rendered card: "Weekly expenses" for the view, "Ledger" for the page,
 *     "Today & this week" for the built-in, and "Goals" — never "Goals1" — for
 *     the card that paints a count badge inside its own heading.
 * 10. `a-locked-board-still-offers-it` — asking about a card is not changing it,
 *     so the control survives the lock while every editing control is gone, and
 *     using it writes nothing.
 * 11. `the-chat-control-does-not-lift-the-card` — a 400 ms hold on it neither
 *     lifts the card nor writes; the arrange gesture's press guard still refuses
 *     a button that is not the grip.
 *
 * The bridge is a stub (a dev-server page has no preload), so claim 5 ends at
 * the recorded call. That a pin write reaches the vault is `dashboard-lock-e2e`'s
 * half, and the wired-app half is `dashboard-live-app`'s.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/dashboard-card-context.html";
const DEFAULT_SIZE = { width: 1280, height: 1000 };

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

/** What each seeded card must be called, and what its heading actually says. */
const NAMES = [
  { id: "sys:goal-progress", label: "Goals", heading: "Goals2" },
  { id: "view:financial:v-weekly", label: "Weekly expenses", heading: "Weekly expenses" },
  { id: "page:financial:ledger", label: "Ledger", heading: "Ledger" },
  { id: "sys:today-week", label: "Today & this week", heading: "Today & this week" },
  { id: "view:financial:v-summary", label: "Spending by month", heading: "Spending by month" },
  { id: "sys:pending-decisions", label: "Pending decisions", heading: "Pending decisions" },
  { id: "sys:recent-log", label: "Recent activity", heading: "Recent activity" },
];

/** The chrome each card must still offer, by kind. Unlocked only. */
const CHROME = {
  "sys:goal-progress": ["pin-grip", "pin-menu-toggle"],
  "view:financial:v-weekly": ["pin-grip", "pin-menu-toggle", "pin-span"],
  "page:financial:ledger": ["pin-grip", "pin-menu-toggle"],
  "sys:today-week": ["pin-grip", "pin-menu-toggle"],
  "view:financial:v-summary": ["pin-grip", "pin-menu-toggle", "pin-span"],
  "sys:pending-decisions": ["pin-grip", "pin-menu-toggle"],
  "sys:recent-log": ["pin-grip", "pin-menu-toggle"],
};

/**
 * What each card's menu must hold, by kind.
 *
 * A built-in card is app furniture, not a record, so its menu offers Archive
 * alone; a view and a page each have something behind them, so Delete is there
 * too. The list is exact and ordered, so a menu that grew an item nobody asked
 * for fails by name.
 */
const MENU = {
  "sys:goal-progress": ["Archive"],
  "view:financial:v-weekly": ["Archive", "Delete"],
  "page:financial:ledger": ["Archive", "Delete"],
};

/**
 * The board and the pin board's controls, read straight off the rendered page.
 *
 * The ordering claims are `compareDocumentPosition` bits, not index arithmetic:
 * "above the grid" is a fact about the document, and an index into a childNode
 * list is a fact about markup.
 */
const SAMPLE = `(() => {
  const section = document.querySelector('[data-testid="board-add-pin"]');
  const toggle = document.querySelector('[data-testid="board-add-toggle"]');
  const grid = document.querySelector('.home-dashboard__grid');
  const follows = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const cards = [...document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]')];
  const heading = (card) => {
    const el = card.querySelector('.home-card__title, .view-card__title');
    return el ? (el.textContent || '').trim() : null;
  };
  const icon = (el) => {
    const svg = el ? el.querySelector('svg') : null;
    return svg ? [...svg.classList].join(' ') : null;
  };
  return {
    toggle: toggle
      ? {
          label: (toggle.textContent || '').trim(),
          expanded: toggle.getAttribute('aria-expanded'),
          svgs: toggle.querySelectorAll('svg').length,
          icon: icon(toggle),
        }
      : null,
    section: section
      ? {
          buttons: [...section.querySelectorAll('.home-pin-add__btn')].map((b) => (b.textContent || '').trim()),
          headingSvgs: section.querySelectorAll('.home-card__title svg').length,
        }
      : null,
    sectionBeforeGrid: follows(section, grid),
    toggleBeforeSection: follows(toggle, section),
    gridCards: cards.length,
    strayAddButtons: document.querySelectorAll('.home-pin-add__btn').length,
    chromeBars: document.querySelectorAll('.home-pin__chrome').length,
    chromeButtons: document.querySelectorAll('.home-pin__chrome .home-pin__btn').length,
    menuToggles: document.querySelectorAll('[data-testid="pin-menu-toggle"]').length,
    menus: [...document.querySelectorAll('[data-testid="pin-menu"]')].map((menu) => ({
      pinId: (menu.closest('[data-pin-id]') || {}).dataset?.pinId ?? null,
      role: menu.getAttribute('role'),
      items: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || '').trim()),
      testids: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.dataset.testid || null),
      danger: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.classList.contains('home-pin__menu-danger')),
    })),
    dialog: (() => {
      const box = document.querySelector('.confirm-dialog');
      if (!box) return null;
      const confirm = box.querySelector('.confirm-dialog__confirm');
      return {
        role: box.getAttribute('role'),
        modal: box.getAttribute('aria-modal'),
        title: (box.querySelector('.confirm-dialog__title') || {}).textContent?.trim() ?? null,
        message: (box.querySelector('.confirm-dialog__message') || {}).textContent?.trim() ?? null,
        confirmLabel: confirm ? (confirm.textContent || '').trim() : null,
        confirmAria: confirm ? confirm.getAttribute('aria-label') : null,
        destructive: confirm ? /destructive|danger/i.test(confirm.className) : null,
        cancel: Boolean(box.querySelector('.confirm-dialog__cancel')),
      };
    })(),
    chatControls: document.querySelectorAll('[data-testid="pin-chat"]').length,
    lifted: document.querySelectorAll('.home-pin.is-lifted').length,
    cards: cards.map((card) => {
      const chat = card.querySelector(':scope > .home-pin__tools > [data-testid="pin-chat"]');
      return {
        id: card.dataset.pinId,
        heading: heading(card),
        tools: card.querySelectorAll(':scope > .home-pin__tools').length,
        chat: card.querySelectorAll(':scope > .home-pin__tools > [data-testid="pin-chat"]').length,
        chatInChrome: card.querySelectorAll('.home-pin__chrome [data-testid="pin-chat"]').length,
        chatText: chat ? (chat.textContent || '').trim() : null,
        chatLabel: chat ? chat.getAttribute('aria-label') : null,
        chatTitle: chat ? chat.getAttribute('title') : null,
        chatSvgs: chat ? chat.querySelectorAll('svg').length : 0,
        chatIcon: icon(chat),
        chrome: card.querySelectorAll(':scope > .home-pin__tools > .home-pin__chrome').length,
        chromeButtons: [...card.querySelectorAll(':scope > .home-pin__tools > .home-pin__chrome .home-pin__btn')]
          .map((b) => b.dataset.testid || null)
          .sort(),
        // The pin-off glyph this replaced is gone, and its absence is part of
        // the claim: one removal vocabulary, in the menu.
        unpinGlyphs: card.querySelectorAll('[data-testid="pin-unpin"]').length,
      };
    }),
    menuToggle: (() => {
      const el = document.querySelector('[data-pin-id="sys:today-week"] [data-testid="pin-menu-toggle"]');
      return el
        ? {
            text: (el.textContent || '').trim(),
            label: el.getAttribute('aria-label'),
            title: el.getAttribute('title'),
            svgs: el.querySelectorAll('svg').length,
            icon: icon(el),
            haspopup: el.getAttribute('aria-haspopup'),
            expanded: el.getAttribute('aria-expanded'),
          }
        : null;
    })(),
  };
})()`;

const errors = [];
const scenarios = [];

/**
 * The deadline pin, which is not a card: it has no padded shell for a corner row
 * to sit in, so its controls take a line of their own above the banner. That is
 * the one place this layout differs, so it is measured rather than assumed.
 */
const DEADLINE_PIN = { id: "sys:deadline", kind: "system", system: "deadline" };

const DEADLINE_SAMPLE = `(() => {
  const pin = document.querySelector('[data-pin-id="sys:deadline"]');
  if (!pin) return { present: false };
  const banner = pin.querySelector('.deadline-banner');
  const tools = pin.querySelector(':scope > .home-pin__tools');
  const chat = tools ? tools.querySelector('[data-testid="pin-chat"]') : null;
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const pinRect = rect(pin);
  const bannerRect = rect(banner);
  const toolsRect = rect(tools);
  return {
    present: true,
    banner: Boolean(banner),
    tools: Boolean(tools),
    toolsPosition: tools ? getComputedStyle(tools).position : null,
    toolsRight: toolsRect ? Math.round(toolsRect.right) : null,
    pinRight: Math.round(pinRect.right),
    toolsBottom: toolsRect ? Math.round(toolsRect.bottom) : null,
    bannerTop: bannerRect ? Math.round(bannerRect.top) : null,
    chatSvgs: chat ? chat.querySelectorAll('svg').length : 0,
    chatLabel: chat ? chat.getAttribute('aria-label') : null,
    chrome: pin.querySelectorAll('.home-pin__chrome').length,
  };
})()`;

function failure(message) {
  errors.push(message);
  return message;
}

function check(name, pass, detail) {
  scenarios.push({ name, pass: Boolean(pass), detail: pass ? null : (detail ?? "failed") });
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
 * Wait for a card to be lifted, or give up.
 *
 * The page's hold is a real 220 ms timer on its own event loop, and this rig
 * shares a machine with every other Electron rig in the suite: a stalled
 * renderer can miss a fixed sleep by more than the hold. Polling makes the claim
 * "a hold lifts the card" rather than "a hold lifts the card within 400 ms of a
 * stalled machine". The negative claims keep their fixed margin, because a
 * renderer too busy to fire the timer is exactly the case they must not mistake
 * for a pass.
 */
async function waitForLift(win, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await sample(win)).lifted > 0) return true;
    if (Date.now() > deadline) return false;
    await sleep(40);
  }
}

let generation = 0;

/**
 * Install a board, re-render the page, and wait for the lock badge to settle.
 * `HomePage` is keyed on the generation, so every render lands the pin board
 * back in its landing state — which is what makes "closed on landing" a claim
 * about every render rather than about the first one.
 */
async function render(win, locked, pins = SEED) {
  generation += 1;
  const before = await win.webContents.executeJavaScript(
    "window.dashboardCardContextCommits ?? 0",
  );
  await win.webContents.executeJavaScript(
    `window.dashboardCardContextSetBoard(${JSON.stringify(pins)}, ${locked ? "true" : "false"})`,
  );
  await win.webContents.executeJavaScript(`window.dashboardCardContextRender(${generation})`);
  await waitFor(
    win,
    `(window.dashboardCardContextCommits ?? 0) > ${before}`,
    `the page to commit with locked=${locked}`,
  );
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === '${locked ? "true" : "false"}'; })()`,
    `the badge to read locked=${locked}`,
  );
}

const sample = (win) => win.webContents.executeJavaScript(SAMPLE);

/** Click something in the page, by selector, and let React commit. */
async function click(win, selector) {
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
  await sleep(60);
}

async function openPinBoard(win) {
  await click(win, '[data-testid="board-add-toggle"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the pin board to open",
  );
}

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** A real mouse, through the browser's own pipeline. */
function mouse(win, type, x, y) {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

const dock = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextDock ?? null");
const pinWrites = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextPinWrites ?? []");
const deletes = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextDeletes ?? []");

/** Open one card's 3-dot menu and wait for the popup. */
async function openMenu(win, pinId) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-pin-id="${pinId}"] [data-testid="pin-menu-toggle"]').click()`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-pin-id="${pinId}"] [data-testid="pin-menu"]'))`,
    `${pinId}'s menu to open`,
  );
}

/** Click one item in the open menu. */
async function clickMenuItem(win, pinId, testid) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-pin-id="${pinId}"] [data-testid="${testid}"]').click()`,
  );
  await sleep(60);
}

async function main() {
  const sessionPartition = `dashboard-card-context-${Date.now()}`;
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
      // The lift is a real 220 ms timer, and this rig runs beside every other
      // Electron window in the suite: a throttled background window would make
      // "a hold on the chat control does not lift the card" pass for the wrong
      // reason.
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
  await waitFor(win, "Boolean(window.dashboardCardContextReady)", "dashboardCardContextReady");

  const checks = {};

  // ── the skin, before anything is judged ───────────────────────────────────
  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.dashboardCardContextSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. closed on landing ──────────────────────────────────────────────────
  await render(win, false);
  const landing = await sample(win);
  checks.landing = landing;
  check(
    "add-toggle-is-closed-on-landing",
    landing.section === null &&
      landing.toggle !== null &&
      landing.toggle.expanded === "false" &&
      /^pin board$/i.test(landing.toggle.label) &&
      landing.toggle.svgs === 1 &&
      (landing.toggle.icon ?? "").includes("lucide-pin"),
    `the landing board offered ${JSON.stringify({ toggle: landing.toggle, section: landing.section })}`,
  );

  // ── 2. it opens and closes ────────────────────────────────────────────────
  await openPinBoard(win);
  const opened = await sample(win);
  const closedAgain = await (async () => {
    await click(win, '[data-testid="board-add-toggle"]');
    await waitFor(
      win,
      `!document.querySelector('[data-testid="board-add-pin"]')`,
      "the pin board to close",
    );
    return sample(win);
  })();
  checks.opened = opened;
  checks.closedAgain = closedAgain;
  check(
    "add-toggle-opens-and-closes",
    opened.toggle?.expanded === "true" &&
      /hide pin board/i.test(opened.toggle?.label ?? "") &&
      opened.section !== null &&
      opened.section.buttons.length > 0 &&
      opened.section.headingSvgs >= 1 &&
      opened.strayAddButtons > 0 &&
      closedAgain.section === null &&
      closedAgain.toggle?.expanded === "false" &&
      closedAgain.strayAddButtons === 0,
    `open ${JSON.stringify(opened.section?.buttons)} expanded=${opened.toggle?.expanded}, ` +
      `closed expanded=${closedAgain.toggle?.expanded} stray=${closedAgain.strayAddButtons}`,
  );

  // ── 3. the row sits above the grid it adds to ─────────────────────────────
  await openPinBoard(win);
  const above = await sample(win);
  checks.above = {
    sectionBeforeGrid: above.sectionBeforeGrid,
    toggleBeforeSection: above.toggleBeforeSection,
  };
  check(
    "pin-board-sits-above-the-grid",
    above.sectionBeforeGrid === true && above.toggleBeforeSection === true,
    `document order was ${JSON.stringify(checks.above)}`,
  );

  // ── 5. the moved row still writes ─────────────────────────────────────────
  const writesBefore = (await pinWrites(win)).length;
  await click(win, ".home-pin-add__btn");
  await waitFor(
    win,
    `(window.dashboardCardContextPinWrites ?? []).length > ${writesBefore}`,
    "the add button to write",
  );
  const addWrites = (await pinWrites(win)).slice(writesBefore);
  const expectedAdd = [
    ...SEED,
    { id: "sys:deadline", kind: "system", system: "deadline" },
  ];
  checks.addPinWrites = addWrites;
  check(
    "add-pin-still-writes",
    addWrites.length === 1 &&
      JSON.stringify(addWrites[0]) === JSON.stringify(expectedAdd),
    `the add button wrote ${JSON.stringify(addWrites)}`,
  );

  // ── 4. a locked board has no add path ─────────────────────────────────────
  await render(win, true);
  const lockedBoard = await sample(win);
  checks.lockedBoard = lockedBoard;
  check(
    "locked-board-has-no-add-path",
    lockedBoard.toggle === null &&
      lockedBoard.section === null &&
      lockedBoard.strayAddButtons === 0 &&
      lockedBoard.gridCards === SEED.length,
    `the locked board still offered ${JSON.stringify({ toggle: lockedBoard.toggle, section: lockedBoard.section, stray: lockedBoard.strayAddButtons })}`,
  );

  // ── 6/7. the chat control, on every card, outside the editing chrome ──────
  await render(win, false);
  const board = await sample(win);
  checks.board = board;
  const nameFor = (id) => NAMES.find((n) => n.id === id);
  const badControl = board.cards.filter((card) => {
    const expected = nameFor(card.id);
    return (
      card.tools !== 1 ||
      card.chat !== 1 ||
      card.chatSvgs !== 1 ||
      card.chatText !== "" ||
      !card.chatLabel ||
      !card.chatTitle ||
      !(card.chatIcon ?? "").includes("lucide-message-square") ||
      card.heading !== expected?.heading
    );
  });
  check(
    "every-card-offers-the-chat-control",
    board.cards.length === SEED.length &&
      board.chatControls === SEED.length &&
      badControl.length === 0,
    `${board.chatControls} chat control(s) over ${board.cards.length} card(s); ` +
      `offending: ${JSON.stringify(badControl)}`,
  );

  const badChrome = board.cards.filter(
    (card) =>
      card.chatInChrome !== 0 ||
      card.chrome !== 1 ||
      JSON.stringify(card.chromeButtons) !== JSON.stringify(CHROME[card.id]),
  );
  check(
    "the-chat-control-is-not-editing-chrome",
    badChrome.length === 0 &&
      board.chromeBars === SEED.length &&
      board.chromeButtons === Object.values(CHROME).flat().length,
    `chrome drifted: ${JSON.stringify(badChrome)}; ` +
      `${board.chromeBars} bar(s), ${board.chromeButtons} button(s)`,
  );

  // ── 8. clicking hands the card over ───────────────────────────────────────
  await click(win, '[data-pin-id="view:financial:v-weekly"] [data-testid="pin-chat"]');
  await waitFor(
    win,
    `Boolean((window.dashboardCardContextDock ?? {}).contextCard)`,
    "the dock to take the card",
  );
  const handed = await dock(win);
  checks.handed = handed;
  check(
    "chat-control-hands-over-the-card",
    handed.open === true &&
      handed.contextCard?.label === "Weekly expenses" &&
      handed.contextCard?.boardSlug === null &&
      handed.contextCard?.pin?.id === "view:financial:v-weekly" &&
      handed.contextCard?.pin?.viewId === "v-weekly" &&
      handed.contextCard?.pin?.domainSlug === "financial",
    `the dock holds ${JSON.stringify(handed)}`,
  );

  // ── 9. the name comes off the card, not out of the pin ────────────────────
  const handedNames = {};
  for (const wanted of NAMES) {
    await click(win, `[data-pin-id="${wanted.id}"] [data-testid="pin-chat"]`);
    await waitFor(
      win,
      `(window.dashboardCardContextDock ?? {}).contextCard?.pin?.id === ${JSON.stringify(wanted.id)}`,
      `the dock to take ${wanted.id}`,
    );
    handedNames[wanted.id] = (await dock(win)).contextCard?.label ?? null;
  }
  checks.handedNames = handedNames;
  const wrongNames = NAMES.filter((n) => handedNames[n.id] !== n.label);
  check(
    "the-name-comes-off-the-heading",
    wrongNames.length === 0,
    `the dock took ${JSON.stringify(handedNames)}; expected ${JSON.stringify(
      Object.fromEntries(NAMES.map((n) => [n.id, n.label])),
    )}`,
  );

  // ── 10. a locked board still lets the card be asked about ─────────────────
  await render(win, true);
  const lockedRead = await sample(win);
  const lockedWritesBefore = (await pinWrites(win)).length;
  await click(win, '[data-pin-id="sys:today-week"] [data-testid="pin-chat"]');
  await waitFor(
    win,
    `(window.dashboardCardContextDock ?? {}).contextCard?.pin?.id === "sys:today-week"`,
    "the locked board's chat control to hand the card over",
  );
  const lockedHanded = await dock(win);
  checks.lockedRead = lockedRead;
  checks.lockedHanded = lockedHanded;
  check(
    "a-locked-board-still-offers-it",
    lockedRead.chromeBars === 0 &&
      lockedRead.chromeButtons === 0 &&
      lockedRead.chatControls === SEED.length &&
      lockedRead.cards.every((c) => c.chat === 1) &&
      lockedHanded.contextCard?.label === "Today & this week" &&
      (await pinWrites(win)).length === lockedWritesBefore,
    `the locked board read ${JSON.stringify({
      chromeBars: lockedRead.chromeBars,
      chromeButtons: lockedRead.chromeButtons,
      chatControls: lockedRead.chatControls,
    })} and handed ${JSON.stringify(lockedHanded.contextCard)}`,
  );

  // ── 11. asking about a card is not picking one up ─────────────────────────
  await render(win, false);
  const gripWritesBefore = (await pinWrites(win)).length;
  const point = await pointAt(win, '[data-pin-id="sys:today-week"] [data-testid="pin-chat"]');
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(420);
  const held = await sample(win);
  mouse(win, "mouseUp", point.x, point.y);
  await sleep(120);
  // The same hold on the card's own heading DOES lift it. Without this, "a hold
  // on the chat control does nothing" would also pass on a board where the hold
  // gesture was broken outright — the claim has to distinguish the two. It is
  // polled rather than slept at: the hold is a real 220 ms timer, and a stalled
  // renderer missing a fixed sleep would fail a claim that is not about timing.
  const headingPoint = await pointAt(win, '[data-pin-id="sys:today-week"] .home-card__title');
  mouse(win, "mouseDown", headingPoint.x, headingPoint.y);
  const liftedByTheHold = (await waitForLift(win)) ? 1 : 0;
  mouse(win, "mouseUp", headingPoint.x, headingPoint.y);
  await sleep(120);
  checks.heldOnChatControl = { lifted: held.lifted, liftedByTheHold };
  check(
    "the-chat-control-does-not-lift-the-card",
    held.lifted === 0 &&
      liftedByTheHold === 1 &&
      (await pinWrites(win)).length === gripWritesBefore,
    `a hold on the chat control left ${held.lifted} card(s) lifted (the same hold on the ` +
      `heading lifted ${liftedByTheHold}) and ` +
      `${(await pinWrites(win)).length - gripWritesBefore} write(s)`,
  );

  // ── 12. the menu, and the two removals it holds ───────────────────────────
  await render(win, false);
  const menuBoard = await sample(win);
  const badToggles = menuBoard.cards.filter((card) => card.chromeButtons.includes("pin-menu-toggle") === false);
  checks.menuToggle = menuBoard.menuToggle;
  checks.menuBoard = { menuToggles: menuBoard.menuToggles, unpinGlyphs: menuBoard.cards.map((c) => c.unpinGlyphs) };
  check(
    "every-card-offers-the-menu",
    menuBoard.cards.length === SEED.length &&
      menuBoard.menuToggles === SEED.length &&
      badToggles.length === 0 &&
      menuBoard.cards.every((c) => c.unpinGlyphs === 0) &&
      menuBoard.menuToggle?.text === "" &&
      menuBoard.menuToggle?.svgs === 1 &&
      (menuBoard.menuToggle?.icon ?? "").includes("lucide-ellipsis-vertical") &&
      Boolean(menuBoard.menuToggle?.label) &&
      Boolean(menuBoard.menuToggle?.title) &&
      menuBoard.menuToggle?.haspopup === "menu" &&
      menuBoard.menuToggle?.expanded === "false",
    `${menuBoard.menuToggles} trigger(s) over ${menuBoard.cards.length} card(s); ` +
      `toggle ${JSON.stringify(menuBoard.menuToggle)}; stray unpin glyphs ` +
      `${JSON.stringify(checks.menuBoard.unpinGlyphs)}`,
  );

  const menuHeld = {};
  for (const [pinId, expected] of Object.entries(MENU)) {
    await openMenu(win, pinId);
    const open = await sample(win);
    menuHeld[pinId] = open.menus[0] ?? null;
    // Press the trigger again: the menu closes, and one popup is all there is.
    await click(win, `[data-pin-id="${pinId}"] [data-testid="pin-menu-toggle"]`);
    await waitFor(win, `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`, "the menu to close");
    if ((await sample(win)).menus.length !== 0) {
      menuHeld[`${pinId}:stayedOpen`] = true;
    }
  }
  checks.menus = menuHeld;
  const menuProblems = Object.entries(MENU).flatMap(([pinId, expected]) => {
    const got = menuHeld[pinId];
    const problems = [];
    if (got?.role !== "menu") problems.push(`${pinId} menu role ${JSON.stringify(got?.role)}`);
    if (JSON.stringify(got?.items) !== JSON.stringify(expected)) {
      problems.push(`${pinId} holds ${JSON.stringify(got?.items)}, expected ${JSON.stringify(expected)}`);
    }
    // Delete is the destructive one; Archive never is.
    if (got?.danger?.[0] !== false) problems.push(`${pinId} Archive wore the destructive token`);
    if (expected.includes("Delete") && got?.danger?.[1] !== true) {
      problems.push(`${pinId} Delete did not wear the destructive token`);
    }
    if (expected.includes("Delete") && got?.testids?.[1] !== "pin-delete") {
      problems.push(`${pinId} Delete item was ${JSON.stringify(got?.testids?.[1])}`);
    }
    return problems;
  });
  check("the-menu-holds-archive-and-delete-where-there-is-one", menuProblems.length === 0, menuProblems.join("; "));

  // One at a time: opening a second card's menu leaves exactly one open.
  await openMenu(win, "sys:today-week");
  await openMenu(win, "sys:recent-log");
  const twoMenus = await sample(win);
  checks.oneMenuAtATime = twoMenus.menus;
  check(
    "one-menu-at-a-time",
    twoMenus.menus.length === 1 && twoMenus.menus[0]?.pinId === "sys:recent-log",
    `${twoMenus.menus.length} menu(s) open: ${JSON.stringify(twoMenus.menus.map((m) => m.pinId))}`,
  );

  // Escape closes it.
  await win.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await waitFor(win, `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`, "Escape to close the menu");
  const afterEscape = await sample(win);
  check("escape-closes-the-menu", afterEscape.menus.length === 0, `${afterEscape.menus.length} menu(s) still open`);

  // A real press on the board closes it too — the gesture that starts elsewhere.
  await openMenu(win, "sys:today-week");
  const boardPoint = await pointAt(win, ".home-dashboard__header");
  mouse(win, "mouseDown", boardPoint.x, boardPoint.y);
  mouse(win, "mouseUp", boardPoint.x, boardPoint.y);
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`,
    "a press away to close the menu",
  );
  const afterPress = await sample(win);
  check(
    "a-press-away-closes-the-menu",
    afterPress.menus.length === 0,
    `${afterPress.menus.length} menu(s) survived a press on the header`,
  );

  // ── 13. Archive takes the card off this board, and deletes nothing ────────
  const archiveWritesBefore = (await pinWrites(win)).length;
  await openMenu(win, "sys:today-week");
  await clickMenuItem(win, "sys:today-week", "pin-archive");
  await waitFor(
    win,
    `!document.querySelector('[data-pin-id="sys:today-week"]')`,
    "the archived card to leave the board",
  );
  const archiveWrites = (await pinWrites(win)).slice(archiveWritesBefore);
  const expectedArchive = SEED.filter((p) => p.id !== "sys:today-week");
  checks.archiveWrites = archiveWrites;
  check(
    "archive-takes-the-card-off-the-board",
    archiveWrites.length === 1 &&
      JSON.stringify(archiveWrites[0]) === JSON.stringify(expectedArchive) &&
      (await sample(win)).menus.length === 0,
    `Archive wrote ${JSON.stringify(archiveWrites)}`,
  );

  /**
   * And Archive is not a delete, on the card where the difference is real: a
   * view card has a saved view behind it, and taking the card off must leave
   * that view alone — still in the vault, still offered by the pin board, so the
   * operator can put the card back. This is the pair the two laws make: the
   * reversible act and the irreversible one must not be the same act.
   */
  const viewArchiveBefore = (await pinWrites(win)).length;
  const deletesBeforeArchive = (await deletes(win)).length;
  await openMenu(win, "view:financial:v-summary");
  await clickMenuItem(win, "view:financial:v-summary", "pin-archive");
  await waitFor(
    win,
    `!document.querySelector('[data-pin-id="view:financial:v-summary"]')`,
    "the archived view card to leave the board",
  );
  await openPinBoard(win);
  const afterViewArchive = await sample(win);
  const offeredAgain = (afterViewArchive.section?.buttons ?? []).includes("Spending by month");
  checks.viewArchive = {
    writes: (await pinWrites(win)).length - viewArchiveBefore,
    deletes: (await deletes(win)).length - deletesBeforeArchive,
    offeredAgain,
  };
  check(
    "archiving-a-view-card-keeps-the-view",
    checks.viewArchive.writes === 1 &&
      checks.viewArchive.deletes === 0 &&
      offeredAgain === true,
    `archiving a view card read ${JSON.stringify(checks.viewArchive)}`,
  );

  // ── 14. a locked board has no menu at all ─────────────────────────────────
  await render(win, true);
  const lockedMenus = await sample(win);
  checks.lockedMenus = { menuToggles: lockedMenus.menuToggles, menus: lockedMenus.menus.length, chat: lockedMenus.chatControls };
  check(
    "a-locked-board-has-no-menu",
    lockedMenus.menuToggles === 0 &&
      lockedMenus.menus.length === 0 &&
      lockedMenus.chatControls === SEED.length,
    `the locked board read ${JSON.stringify(checks.lockedMenus)}`,
  );

  // ── 15. Delete asks first, and only then writes ───────────────────────────
  await render(win, false);
  const deleteWritesBefore = (await deletes(win)).length;
  const pinWritesBeforeDelete = (await pinWrites(win)).length;
  await openMenu(win, "view:financial:v-weekly");
  await clickMenuItem(win, "view:financial:v-weekly", "pin-delete");
  await waitFor(win, `Boolean(document.querySelector('.confirm-dialog'))`, "the question to be asked");
  const asking = await sample(win);
  checks.asking = asking.dialog;
  check(
    "delete-asks-before-it-writes",
    asking.dialog?.role === "dialog" &&
      asking.dialog?.modal === "true" &&
      asking.dialog?.title === "Delete “Weekly expenses”?" &&
      /cannot be undone/i.test(asking.dialog?.message ?? "") &&
      asking.dialog?.destructive === true &&
      asking.dialog?.cancel === true &&
      (await deletes(win)).length === deleteWritesBefore &&
      (await pinWrites(win)).length === pinWritesBeforeDelete,
    `the question read ${JSON.stringify(asking.dialog)} with ` +
      `${(await deletes(win)).length - deleteWritesBefore} delete(s) already sent`,
  );

  // Cancelling is a no-op, and the card is untouched.
  await win.webContents.executeJavaScript(
    `document.querySelector('.confirm-dialog__cancel').click()`,
  );
  await waitFor(win, `!document.querySelector('.confirm-dialog')`, "the question to close");
  const afterCancel = await sample(win);
  check(
    "cancelling-deletes-nothing",
    afterCancel.dialog === null &&
      (await deletes(win)).length === deleteWritesBefore &&
      afterCancel.cards.some((c) => c.id === "view:financial:v-weekly"),
    `Cancel left ${(await deletes(win)).length - deleteWritesBefore} delete(s) and ` +
      `${afterCancel.cards.length} card(s)`,
  );

  // Confirming deletes the view, and the card leaves the board — through the
  // pin board's own validation, which drops a pin whose view file is gone.
  await openMenu(win, "view:financial:v-weekly");
  await clickMenuItem(win, "view:financial:v-weekly", "pin-delete");
  await waitFor(win, `Boolean(document.querySelector('.confirm-dialog'))`, "the question again");
  await win.webContents.executeJavaScript(
    `document.querySelector('.confirm-dialog__confirm').click()`,
  );
  await waitFor(
    win,
    `!document.querySelector('[data-pin-id="view:financial:v-weekly"]')`,
    "the deleted view's card to leave the board",
  );
  const deleteWrites = (await deletes(win)).slice(deleteWritesBefore);
  const afterDelete = await sample(win);
  checks.deleteWrites = deleteWrites;
  check(
    "deleting-a-view-takes-the-card-with-it",
    deleteWrites.length === 1 &&
      deleteWrites[0]?.kind === "view" &&
      deleteWrites[0]?.slug === "financial" &&
      deleteWrites[0]?.id === "v-weekly" &&
      afterDelete.dialog === null &&
      afterDelete.cards.every((c) => c.id !== "view:financial:v-weekly") &&
      afterDelete.gridCards === SEED.length - 1,
    `the delete sent ${JSON.stringify(deleteWrites)} and left ` +
      `${JSON.stringify(afterDelete.cards.map((c) => c.id))}`,
  );

  // ── 16. the same, through a page pin ──────────────────────────────────────
  await render(win, false);
  const pageDeleteBefore = (await deletes(win)).length;
  await openMenu(win, "page:financial:ledger");
  await clickMenuItem(win, "page:financial:ledger", "pin-delete");
  await waitFor(win, `Boolean(document.querySelector('.confirm-dialog'))`, "the page's question");
  const pageQuestion = await sample(win);
  await win.webContents.executeJavaScript(
    `document.querySelector('.confirm-dialog__confirm').click()`,
  );
  await waitFor(
    win,
    `!document.querySelector('[data-pin-id="page:financial:ledger"]')`,
    "the deleted page's card to leave the board",
  );
  const pageDeletes = (await deletes(win)).slice(pageDeleteBefore);
  checks.pageQuestion = pageQuestion.dialog;
  checks.pageDeletes = pageDeletes;
  check(
    "deleting-a-page-takes-the-card-with-it",
    pageQuestion.dialog?.title === "Delete “Ledger”?" &&
      pageQuestion.dialog?.confirmLabel === "Delete page" &&
      pageDeletes.length === 1 &&
      pageDeletes[0]?.kind === "page" &&
      pageDeletes[0]?.id === "ledger" &&
      (await sample(win)).cards.every((c) => c.id !== "page:financial:ledger"),
    `the page question read ${JSON.stringify(pageQuestion.dialog)} and the delete sent ` +
      `${JSON.stringify(pageDeletes)}`,
  );

  // ── 12. the deadline pin is not a card, and lays its controls out its own way
  await render(win, false, [...SEED, DEADLINE_PIN]);
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-pin-id="sys:deadline"] .deadline-banner'))`,
    "the deadline banner to draw",
  );
  const deadline = await win.webContents.executeJavaScript(DEADLINE_SAMPLE);
  checks.deadlinePin = deadline;
  check(
    "the-deadline-pin-keeps-its-controls-out-of-the-way",
    deadline.present === true &&
      deadline.banner === true &&
      deadline.tools === true &&
      deadline.toolsPosition === "static" &&
      deadline.chatSvgs === 1 &&
      Boolean(deadline.chatLabel) &&
      deadline.chrome === 1 &&
      Math.abs(deadline.toolsRight - deadline.pinRight) <= 2 &&
      deadline.toolsBottom <= deadline.bannerTop,
    `the deadline pin's controls read ${JSON.stringify(deadline)}`,
  );

  // ── nothing unexpected, nothing on fire ───────────────────────────────────
  const unexpected = await win.webContents.executeJavaScript(
    "window.dashboardCardContextUnexpectedCalls",
  );
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The artifact screenshot is the board with the pin board open and a card's
  // menu open: both of this page's subjects in one frame, so that is what a
  // reader should see. The card is the surviving view — the two this run deleted
  // are really gone from the harness's vault, so the board draws six cards, which
  // is what the app would draw too.
  await render(win, false);
  await openPinBoard(win);
  await openMenu(win, "view:financial:v-summary");
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks: { ...checks, scenarios },
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-card-context.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "dashboard-card-context.png"), image.toPNG());

  console.log(
    `pin board: landing=${landing.section === null ? "closed" : "open"} ` +
      `above-grid=${above.sectionBeforeGrid} lockedToggle=${lockedBoard.toggle === null ? "none" : "present"}`,
  );
  console.log(
    `cards: ${board.cards.length} cards, ${board.chatControls} chat control(s), ` +
      `${board.chromeBars} chrome bar(s)${lockedRead.chromeBars === 0 ? ", none while locked" : ""}`,
  );
  console.log(`names:  ${JSON.stringify(handedNames)}`);
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
  console.error("dashboard-card-context rig timed out");
  app.exit(1);
}, 90_000);
