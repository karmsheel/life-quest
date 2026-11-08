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
 * The feature, in one line: the card IS the chat control now — a press anywhere
 * on it puts it in front of the chat (up to three), a press on a held card takes
 * only that card back out, and a press on the board's own empty space takes them
 * all out. A card's own controls, a drag, a hold and Edit mode keep their own
 * presses. The claims, and what makes each falsifiable:
 *
 *  1. `no-chat-icon-remains` — the old corner control is gone from every card of
 *     every kind: no `[data-testid="pin-chat"]`, no `.home-pin__chat`, and not a
 *     single `MessageSquare` glyph inside a pin. A half-removed control fails by
 *     name, not by look.
 *  2. `every-card-is-a-click-target` — each pin carries exactly one hidden
 *     keyboard/AT toggle named with its own heading and the action, and the card
 *     itself paints `cursor: pointer`. Every card the page draws is a pin, so
 *     "the card" and "the pin" are the same set.
 *  3. `clicking-a-card-adds-it` — a real press on the card's own heading puts
 *     that pin, with the board slug, into the dock's `contextCards`, opens the
 *     dock, names the card off the heading, and draws the ring as a line. A
 *     press on a table cell inside the card does the same, so "anywhere on the
 *     card" is a claim about its content too.
 *  4. `three-cards-hold-at-once` — three presses for three different cards give
 *     exactly three dock entries in press order, three rings and three pressed
 *     toggles, and write nothing.
 *  5. `a-second-click-removes-only-that-card` — pressing a held card while three
 *     are held takes that card and only that card out; the other two keep their
 *     order and their rings. The dock stays open.
 *  6. `a-fourth-card-is-refused-with-a-status-line` — the fourth press changes
 *     nothing (no fourth entry, no fourth ring, no write) and puts the exact
 *     refusal line on the board as a `role="status"`; the next successful toggle
 *     clears it.
 *  7. `empty-board-clicks-clear-all` — a real press on the gap between cards and
 *     one on the board's header text both empty the context at once; a press on
 *     another app surface leaves it held, because the operator is allowed to work
 *     while the context is kept.
 *  8. `a-cards-own-controls-do-not-toggle` — the card's 3-dot trigger, its Edit
 *     card item, the card body while Edit mode is on, a size handle and the page
 *     menu are all their own presses: none adds or removes the card.
 *  9. `a-drag-does-not-toggle` — a 220 ms hold and release, a real drag that
 *     reorders the board, and a press that drifts before the hold all leave the
 *     context alone; the next plain press still toggles, so the suppression is
 *     consumed rather than stuck.
 * 10. `the-locked-board-still-selects-and-removes` — a locked board draws no
 *     editing chrome at all, yet its cards still add, hold and remove context,
 *     and the empty board still clears it, with zero pin writes and zero deletes.
 * 11. `the-keyboard-toggle-works` — the hidden control is a real button: focus it
 *     and press Enter and the card goes in; press Enter again and it comes out.
 *     On a locked board the card is not a tab stop but this control still is.
 * 12. `the-name-comes-off-the-heading` — the handed-over name is the card's own
 *     heading words for all three kinds, "Goals" and never "Goals2" for the card
 *     that paints a count badge inside its heading, and never the pin id.
 *
 * The pre-existing dashboard claims — the pin board behind the page menu, its
 * write, a locked board's missing add path and menu, the per-card menu's
 * Archive/Delete, the confirm dialog, and the deadline pin's own control layout —
 * are kept, because this feature must not have cost the board its other gestures.
 *
 * The bridge is a stub (a dev-server page has no preload), so this rig ends at
 * the recorded call. That a pin write reaches the vault is `dashboard-lock-e2e`'s
 * half, and the wired-app half is `dashboard-live-app`'s.
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
  "sys:goal-progress": ["pin-menu-toggle"],
  "view:financial:v-weekly": ["pin-menu-toggle"],
  "page:financial:ledger": ["pin-menu-toggle"],
  "sys:today-week": ["pin-menu-toggle"],
  "view:financial:v-summary": ["pin-menu-toggle"],
  "sys:pending-decisions": ["pin-menu-toggle"],
  "sys:recent-log": ["pin-menu-toggle"],
};

/**
 * What each card's menu must hold, by kind.
 *
 * Edit card comes first on every card, because sizing is the one action every
 * kind of card shares. A built-in card is app furniture, not a record, so it has
 * no Delete; a view and a page each have something behind them, so Delete is
 * there too. The list is exact and ordered, so a menu that grew an item nobody
 * asked for fails by name.
 */
const MENU = {
  "sys:goal-progress": ["Edit card", "Archive"],
  "view:financial:v-weekly": ["Edit card", "Archive", "Delete"],
  "page:financial:ledger": ["Edit card", "Archive", "Delete"],
};

/** The exact words the fourth card is answered with. */
const FULL_NOTICE = "Three cards are already in the chat context — take one out first.";

/**
 * The board and the page menu's controls, read straight off the rendered page.
 *
 * The pin board is no longer a header control: it is the page menu's second
 * item, behind the three-dot trigger at the title's top-right edge. The menu
 * only exists while it is open, so its items are read from inside the popover —
 * a closed menu has nothing to read, and that absence is itself a claim.
 *
 * The ordering claims are `compareDocumentPosition` bits, not index arithmetic:
 * "above the grid" is a fact about the document, and an index into a childNode
 * list is a fact about markup.
 */
const SAMPLE = `(() => {
  const section = document.querySelector('[data-testid="board-add-pin"]');
  const trigger = document.querySelector('[data-testid="board-page-menu"]');
  const popover = document.querySelector('[data-testid="board-page-menu-popover"]');
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
  const svgNames = (el) =>
    [...(el ? el.querySelectorAll('svg') : [])].map((svg) => [...svg.classList].join(' '));
  const statusEl = document.querySelector('[data-testid="pin-context-status"]');
  const statusRect = statusEl ? statusEl.getBoundingClientRect() : null;
  const cardState = (card) => {
    const toggle = card.querySelector(':scope > [data-testid="pin-context-toggle"]');
    const toggleRect = toggle ? toggle.getBoundingClientRect() : null;
    const style = getComputedStyle(card);
    return {
      id: card.dataset.pinId ?? null,
      heading: heading(card),
      inContext: card.classList.contains('is-in-context'),
      outline: { style: style.outlineStyle, width: style.outlineWidth },
      cursor: style.cursor,
      tabIndex: card.tabIndex,
      tools: card.querySelectorAll(':scope > .home-pin__tools').length,
      chrome: card.querySelectorAll(':scope > .home-pin__tools > .home-pin__chrome').length,
      chromeButtons: [...card.querySelectorAll(':scope > .home-pin__tools > .home-pin__chrome .home-pin__btn')]
        .map((b) => b.dataset.testid || null)
        .sort(),
      chat: card.querySelectorAll('[data-testid="pin-chat"]').length,
      chatClasses: card.querySelectorAll('.home-pin__chat').length,
      chatIcons: svgNames(card).filter((name) => name.includes('lucide-message-square')).length,
      toggle: toggle
        ? {
            pinId: toggle.dataset.contextPinId ?? null,
            pressed: toggle.getAttribute('aria-pressed'),
            label: toggle.getAttribute('aria-label'),
            text: (toggle.textContent || '').trim(),
            svgs: toggle.querySelectorAll('svg').length,
            tabIndex: toggle.tabIndex,
            disabled: toggle.disabled,
            width: toggleRect ? toggleRect.width : 0,
            height: toggleRect ? toggleRect.height : 0,
            inChrome: Boolean(toggle.closest('.home-pin__chrome')),
          }
        : null,
    };
  };
  return {
    header: (() => {
      const header = document.querySelector('.home-dashboard__header');
      if (!header) return null;
      const title = header.querySelector('.home-dashboard__title');
      const badge = header.querySelector('[data-testid="board-lock-badge"]');
      return {
        eyebrow: (header.querySelector('[data-testid="wing-eyebrow"]') || {}).textContent?.trim() ?? null,
        title: title
          ? [...title.childNodes]
              .filter((node) => node.nodeType === 3)
              .map((node) => (node.textContent || '').trim())
              .join('')
          : null,
        badge: badge ? (badge.textContent || '').trim() : null,
        hint: Boolean(header.querySelector('[data-testid="board-lock-hint"]')),
        subtitles: header.querySelectorAll('.home-dashboard__subtitle').length,
        paragraphs: [...header.querySelectorAll('p')].map((p) => ({
          cls: p.className,
          text: (p.textContent || '').trim(),
        })),
      };
    })(),
    pageMenu: trigger
      ? {
          label: trigger.getAttribute('aria-label'),
          haspopup: trigger.getAttribute('aria-haspopup'),
          expanded: trigger.getAttribute('aria-expanded'),
          svgs: trigger.querySelectorAll('svg').length,
          icon: icon(trigger),
          testid: trigger.dataset.testid || null,
        }
      : null,
    pageMenuPopover: popover
      ? {
          role: popover.getAttribute('role'),
          label: popover.getAttribute('aria-label'),
          testid: popover.dataset.testid || null,
          classes: popover.className,
          items: [...popover.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')].map(
            (el) => el.dataset.testid || null,
          ),
        }
      : null,
    addItem: (() => {
      const el = popover ? popover.querySelector('[data-testid="board-add-toggle"]') : null;
      if (!el) return null;
      const label = el.querySelector('.page-menu__item-label');
      return {
        testid: el.dataset.testid || null,
        role: el.getAttribute('role'),
        label: (label ? label.textContent : el.textContent || '').trim(),
        ariaLabel: el.getAttribute('aria-label'),
        expanded: el.getAttribute('aria-expanded'),
        svgs: el.querySelectorAll('svg').length,
        icon: icon(el),
      };
    })(),
    section: section
      ? {
          buttons: [...section.querySelectorAll('.home-pin-add__btn')].map((b) => (b.textContent || '').trim()),
          headingSvgs: section.querySelectorAll('.home-card__title svg').length,
        }
      : null,
    sectionBeforeGrid: follows(section, grid),
    triggerBeforeSection: follows(trigger, section),
    addItemsInDocument: document.querySelectorAll('[data-testid="board-add-toggle"]').length,
    lockItemsInDocument: document.querySelectorAll('[data-testid="board-lock-toggle"]').length,
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
    // ── the feature's own surface ──────────────────────────────────────────
    chatControls: document.querySelectorAll('[data-testid="pin-chat"]').length,
    chatClasses: document.querySelectorAll('.home-pin__chat').length,
    messageIcons: document.querySelectorAll('[data-pin-id] svg.lucide-message-square').length,
    contextToggles: document.querySelectorAll('[data-testid="pin-context-toggle"]').length,
    inContextCards: [...document.querySelectorAll('.home-dashboard__grid > .home-pin.is-in-context')]
      .map((card) => card.dataset.pinId ?? null),
    status: statusEl
      ? {
          present: true,
          role: statusEl.getAttribute('role'),
          text: (statusEl.textContent || '').trim(),
          height: statusRect ? statusRect.height : 0,
          display: getComputedStyle(statusEl).display,
        }
      : { present: false },
    staticPins: [...document.querySelectorAll('.home-dashboard__grid > .home-pin:not([data-pin-id])')].map(
      (el) => ({
        cursor: getComputedStyle(el).cursor,
        toggles: el.querySelectorAll('[data-testid="pin-context-toggle"]').length,
        tools: el.querySelectorAll(':scope > .home-pin__tools').length,
      }),
    ),
    lifted: document.querySelectorAll('.home-pin.is-lifted').length,
    editing: document.querySelectorAll('.home-pin.is-editing').length,
    resizeHandles: document.querySelectorAll('.home-pin__resize').length,
    cards: cards.map(cardState),
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

/**
 * The cards' own content, as one reading: what the goals card says about each
 * goal (its domain and its progress), how the count sits in the heading, what a
 * recent-activity line is made of, and what the task columns offer to press.
 */
const HOME_CARDS_SAMPLE = `(() => {
  const card = (id) => document.querySelector('[data-pin-id="' + id + '"]');
  const board = document.querySelector('.home-dashboard__grid');
  const goals = card('sys:goal-progress');
  const today = card('sys:today-week');
  const log = card('sys:recent-log');
  const heading = goals ? goals.querySelector(':scope > .home-card > .home-card__title') : null;
  const marker = heading ? heading.querySelector(':scope > .home-pin__builtin') : null;
  const count = heading ? heading.querySelector(':scope > .home-card__count') : null;
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const headingBox = rect(heading);
  const markerBox = rect(marker);
  const countBox = rect(count);
  const follows = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const text = (el) => (el ? (el.textContent || '').trim() : null);
  const goalRows = goals
    ? [...goals.querySelectorAll('.home-goal-row')].map((row) => ({
        name: text(row.querySelector('.home-goal-row__name')),
        domain: text(row.querySelector('.home-goal-row__domain')),
        unassigned: row.querySelector('.home-goal-row__domain')?.classList.contains('is-unassigned') ?? null,
        progress: row.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null,
        hasBar: Boolean(row.querySelector('.home-goal-row__bar')),
      }))
    : [];
  const activityRows = log
    ? [...log.querySelectorAll('.home-activity-row')].map((row) => ({
        summary: text(row.querySelector('.home-activity-row__summary')),
        type: text(row.querySelector('.home-activity-row__type')),
        when: text(row.querySelector('.home-activity-row__when')),
      }))
    : [];
  const columns = today
    ? [...today.querySelectorAll('.home-task-cols > div')].map((column) => ({
        heading: text(column.querySelector('.home-task-cols__head')),
        tasks: [...column.querySelectorAll('.home-task-row')].map((row) => ({
          title: text(row.querySelector('.home-task-row__title')),
          checkbox: row.querySelector('input.home-task-row__check')?.getAttribute('aria-label') ?? null,
        })),
      }))
    : [];
  return {
    boardWidth: board ? rect(board).width : null,
    goals: {
      present: Boolean(goals),
      width: rect(goals)?.width ?? null,
      rows: goalRows,
    },
    heading: {
      markerBeforeCount: follows(marker, count),
      countGapFromMarker: markerBox && countBox ? Math.round(countBox.left - markerBox.right) : null,
      countOffsetFromStart: headingBox && countBox ? Math.round(countBox.left - headingBox.left) : null,
      countInFirstHalf: headingBox && countBox ? countBox.left - headingBox.left < headingBox.width / 2 : null,
    },
    activity: {
      present: Boolean(log),
      width: rect(log)?.width ?? null,
      rows: activityRows,
    },
    todayWeek: {
      present: Boolean(today),
      width: rect(today)?.width ?? null,
      columns,
    },
  };
})()`;

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
    chatControls: pin.querySelectorAll('[data-testid="pin-chat"]').length,
    messageIcons: [...pin.querySelectorAll('svg')].filter((svg) =>
      [...svg.classList].join(' ').includes('lucide-message-square'),
    ).length,
    contextToggles: pin.querySelectorAll('[data-testid="pin-context-toggle"]').length,
    chrome: pin.querySelectorAll('.home-pin__chrome').length,
  };
})()`;

const errors = [];
const scenarios = [];

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

/** Say where the rig is, so a hang names itself instead of timing out dumb. */
function step(name) {
  console.log(`… ${name}`);
}

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

/** Wait for a frame pair, so a reflow the rig caused has painted. */
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

let generation = 0;

/**
 * Install a board, re-render the page, and wait for the lock badge to settle.
 * `HomePage` is keyed on the generation, so every render lands the pin board
 * back in its landing state — which is what makes "closed on landing" a claim
 * about every render rather than about the first one. The DOCK sits above the
 * keyed page, so the chat's context deliberately survives a re-render; the
 * driver clears it explicitly where a claim starts from an empty context.
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

/** Open the page's three-dot menu and wait for its popover. */
async function openPageMenu(win) {
  await click(win, '[data-testid="board-page-menu"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-page-menu-popover"]'))`,
    "the page menu to open",
  );
}

/** Close the page's menu by pressing its trigger again, if it is open. */
async function closePageMenu(win) {
  const open = await win.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-testid="board-page-menu-popover"]'))`,
  );
  if (open) await click(win, '[data-testid="board-page-menu"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the page menu to close",
  );
}

/**
 * Ask the board for its Add-pin row.
 *
 * The row is behind the page menu's second item: open the three-dot menu, choose
 * Pin board (which closes the menu before it toggles the row), and wait for the
 * row. Every render lands with the menu closed and the row closed — the page is
 * keyed on the generation — so this is the only way to the row.
 */
async function openPinBoard(win) {
  await openPageMenu(win);
  await click(win, '[data-testid="board-add-toggle"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the pin board to open",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the page menu to close after choosing the pin board",
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
 * A press point inside a card that is NOT on one of its controls.
 *
 * Tried in priority order — heading, a table cell, then the middle of the card —
 * and each candidate is hit-tested with `elementFromPoint`, so a press that
 * would land on a control is never mistaken for a press on the body.
 */
async function cardBodyPoint(win, pinId) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-pin-id=${JSON.stringify(pinId)}]');
    if (!card) return null;
    const excluded = 'a, button, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [role="separator"], [data-pin-handle]';
    const candidates = [];
    const heading = card.querySelector('.home-card__title, .view-card__title');
    if (heading) {
      const h = heading.getBoundingClientRect();
      candidates.push({ x: h.left + Math.min(40, h.width / 3), y: h.top + h.height / 2 });
    }
    const cell = card.querySelector('.view-card__table tbody td');
    if (cell) {
      const c = cell.getBoundingClientRect();
      candidates.push({ x: c.left + c.width / 2, y: c.top + c.height / 2 });
    }
    const r = card.getBoundingClientRect();
    candidates.push({ x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 80) });
    for (const candidate of candidates) {
      const el = document.elementFromPoint(candidate.x, candidate.y);
      if (!el || !card.contains(el)) continue;
      if (el.closest(excluded)) continue;
      return candidate;
    }
    return null;
  })()`);
  if (!point) throw new Error(`no pressable body point inside ${pinId}`);
  return point;
}

/** A point on a card's own table cell, for "anywhere on the card" claims. */
async function cardCellPoint(win, pinId) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const cell = document.querySelector('[data-pin-id=${JSON.stringify(pinId)}] .view-card__table tbody td');
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error(`no table cell inside ${pinId}`);
  return point;
}

/**
 * A point on the board's own empty space: the gap between two cards in the same
 * row, with no card and no control under it. "The board's background" is a fact
 * about hit-testing, so it is hit-tested.
 */
async function emptyBoardPoint(win) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const excluded = 'a, button, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [role="separator"], [data-pin-handle]';
    const grid = document.querySelector('.home-dashboard__grid');
    if (!grid) return null;
    const cards = [...grid.querySelectorAll(':scope > .home-pin[data-pin-id]')].map((c) => c.getBoundingClientRect());
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        const a = cards[i];
        const b = cards[j];
        if (Math.abs(a.top - b.top) > 2) continue;
        const left = a.right;
        const right = b.left;
        if (right - left < 4) continue;
        const x = (left + right) / 2;
        const y = a.top + Math.min(30, a.height / 2);
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('[data-pin-id]') || el.closest(excluded)) continue;
        return { x, y, via: 'gap' };
      }
    }
    return null;
  })()`);
  if (!point) throw new Error("no empty board gap to press");
  return point;
}

const dock = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextDock ?? null");
const pinWrites = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextPinWrites ?? []");
const deletes = (win) =>
  win.webContents.executeJavaScript("window.dashboardCardContextDeletes ?? []");

const contextIds = async (win) =>
  ((await dock(win))?.contextCards ?? []).map((card) => card.pin.id);

/** Empty the dock through the probe's clear action and wait for it to land. */
async function clearContext(win) {
  await win.webContents.executeJavaScript("window.dashboardCardContextClearCards()");
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the dock to empty",
  );
}

/** Press a card's body and wait for the dock to reach `expected` cards. */
async function pressCard(win, pinId, expected) {
  const point = await cardBodyPoint(win, pinId);
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(40);
  mouse(win, "mouseUp", point.x, point.y);
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === ${expected}`,
    `the dock to hold ${expected} card(s) after pressing ${pinId}`,
  );
  await sleep(60);
}

/**
 * Whether a card, as the sample read it, draws a ring.
 *
 * The browser's own answer, not the class name: a mark that lands on the element
 * but paints no line is not a highlight, and this is the half of that claim a
 * class-name check cannot make.
 */
const drawnRing = (card) =>
  card?.outline?.style === "solid" && parseFloat(card.outline?.width ?? "0") >= 1;

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

/**
 * Pick a card up by its heading and put it down on a point.
 *
 * There is one way to start a drag — hold the card — and `waitForLift` is the
 * hold. The pointer travels in steps rather than jumping: the slot resolver runs
 * on every move, so a single jump would only prove the last position was read.
 */
async function dragCard(win, pinId, aim) {
  const source = await pointAt(win, `[data-pin-id="${pinId}"] .home-card__title, [data-pin-id="${pinId}"] .view-card__title`);
  mouse(win, "mouseDown", source.x, source.y);
  const lifted = await waitForLift(win);
  if (!lifted) {
    mouse(win, "mouseUp", source.x, source.y);
    throw new Error(`${pinId} never lifted, so it could not be dragged`);
  }
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
  const release = await aim();
  mouse(win, "mouseUp", release.x, release.y);
  await sleep(150);
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
      // "a hold does not toggle" pass for the wrong reason.
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

  step("header");
  // ── 0. the header says what the page is, and what it is called ────────────
  await render(win, false);
  const landing = await sample(win);
  checks.header = landing.header;
  check(
    "the-header-drops-the-doctrine-line",
    landing.header !== null &&
      landing.header.eyebrow === "Dashboard" &&
      // The Life surface's page title, never Overview (the word is internal now).
      landing.header.title === "Life" &&
      landing.header.badge === "Unlocked" &&
      landing.header.hint === true &&
      landing.header.subtitles === 0 &&
      // The header's only paragraphs are the eyebrow and the lock hint, so a
      // doctrine line that came back — under any class — fails here.
      landing.header.paragraphs.length === 2 &&
      landing.header.paragraphs[0].cls.includes("wing-eyebrow") &&
      landing.header.paragraphs[1].cls.includes("home-dashboard__lock-hint") &&
      /unlocked/i.test(landing.header.paragraphs[1].text),
    `the header read ${JSON.stringify(landing.header)}`,
  );

  step("landing");
  // ── 1. closed on landing ──────────────────────────────────────────────────
  // The page's actions live behind one three-dot trigger now: the row is absent,
  // the menu is shut, and a closed menu puts no items in the document at all.
  checks.landing = landing;
  check(
    "add-toggle-is-closed-on-landing",
    landing.section === null &&
      landing.pageMenu !== null &&
      landing.pageMenu.expanded === "false" &&
      landing.pageMenu.haspopup === "menu" &&
      landing.pageMenu.label === "Dashboard actions" &&
      landing.pageMenu.svgs === 1 &&
      landing.pageMenuPopover === null &&
      landing.addItem === null &&
      landing.addItemsInDocument === 0 &&
      landing.lockItemsInDocument === 0,
    `the landing board offered ${JSON.stringify({
      menu: landing.pageMenu,
      popover: landing.pageMenuPopover,
      addItem: landing.addItem,
      section: landing.section,
    })}`,
  );

  step("pin-board");
  // ── 2. it opens and closes, from inside the menu ──────────────────────────
  await openPinBoard(win);
  const opened = await sample(win);
  // The row is open and the menu has closed; reopening the menu is what makes
  // the item's "Hide pin board" / `aria-expanded="true"` a claim about the open
  // row rather than about a label that happens to be on screen.
  await openPageMenu(win);
  const openedMenu = await sample(win);
  await click(win, '[data-testid="board-add-toggle"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-add-pin"]')`,
    "the pin board to close",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the menu to close after hiding the pin board",
  );
  const closedAgain = await sample(win);
  checks.opened = opened;
  checks.openedMenu = openedMenu;
  checks.closedAgain = closedAgain;
  check(
    "add-toggle-opens-and-closes",
    opened.section !== null &&
      opened.section.buttons.length > 0 &&
      opened.section.headingSvgs >= 1 &&
      opened.strayAddButtons > 0 &&
      opened.pageMenuPopover === null &&
      opened.addItem === null &&
      openedMenu.addItem?.expanded === "true" &&
      /hide pin board/i.test(openedMenu.addItem?.label ?? "") &&
      closedAgain.section === null &&
      closedAgain.pageMenuPopover === null &&
      closedAgain.addItem === null &&
      closedAgain.strayAddButtons === 0,
    `open ${JSON.stringify(opened.section?.buttons)} menu=${JSON.stringify(opened.pageMenuPopover)}, ` +
      `reopened item ${JSON.stringify(openedMenu.addItem)}, ` +
      `closed stray=${closedAgain.strayAddButtons} menu=${JSON.stringify(closedAgain.pageMenuPopover)}`,
  );

  step("above-grid");
  // ── 3. the row sits above the grid it adds to ─────────────────────────────
  await openPinBoard(win);
  const above = await sample(win);
  checks.above = {
    sectionBeforeGrid: above.sectionBeforeGrid,
    triggerBeforeSection: above.triggerBeforeSection,
  };
  check(
    "pin-board-sits-above-the-grid",
    above.sectionBeforeGrid === true && above.triggerBeforeSection === true,
    `document order was ${JSON.stringify(checks.above)}`,
  );

  step("add-write");
  // ── 4. the moved row still writes ─────────────────────────────────────────
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

  step("locked-add-path");
  // ── 5. a locked board has no add path ─────────────────────────────────────
  // The board is read-only; the honest place to check for a hidden add path is
  // the menu itself, because a closed menu hides every item by design. The menu
  // must still open — it is the only surface that can unlock the board.
  await render(win, true);
  const lockedBoard = await sample(win);
  await openPageMenu(win);
  const lockedMenu = await sample(win);
  await closePageMenu(win);
  checks.lockedBoard = lockedBoard;
  checks.lockedMenu = lockedMenu;
  check(
    "locked-board-has-no-add-path",
    lockedBoard.addItem === null &&
      lockedBoard.addItemsInDocument === 0 &&
      lockedBoard.section === null &&
      lockedBoard.strayAddButtons === 0 &&
      lockedBoard.gridCards === SEED.length &&
      lockedBoard.pageMenuPopover === null &&
      lockedBoard.pageMenu !== null &&
      lockedMenu.pageMenuPopover !== null &&
      lockedMenu.addItemsInDocument === 0 &&
      JSON.stringify(lockedMenu.pageMenuPopover.items) === JSON.stringify(["board-lock-toggle"]) &&
      lockedMenu.addItem === null,
    `the locked board offered ${JSON.stringify({
      addItem: lockedBoard.addItem,
      section: lockedBoard.section,
      stray: lockedBoard.strayAddButtons,
      menuItems: lockedMenu.pageMenuPopover?.items,
      menuAddItem: lockedMenu.addItem,
    })}`,
  );

  step("locked-chrome");
  // ── 6. a locked board has no editing chrome, menu or tools row ────────────
  checks.lockedMenus = {
    menuToggles: lockedBoard.menuToggles,
    menus: lockedBoard.menus.length,
    chromeBars: lockedBoard.chromeBars,
    toolsRows: lockedBoard.cards.reduce((total, card) => total + card.tools, 0),
    contextToggles: lockedBoard.contextToggles,
  };
  check(
    "a-locked-board-has-no-menu",
    lockedBoard.menuToggles === 0 &&
      lockedBoard.menus.length === 0 &&
      lockedBoard.chromeBars === 0 &&
      lockedBoard.chromeButtons === 0 &&
      lockedBoard.cards.every((card) => card.tools === 0 && card.chrome === 0) &&
      // The context control is NOT editing chrome: it survives the lock, one per
      // card, so the card can still be asked about on a read-only board.
      lockedBoard.contextToggles === SEED.length &&
      lockedBoard.cards.every((card) => card.toggle !== null),
    `the locked board read ${JSON.stringify(checks.lockedMenus)}`,
  );

  step("no-chat-icon");
  // ── 7. the chat icon is gone from every card ──────────────────────────────
  await render(win, false);
  await clearContext(win);
  const board = await sample(win);
  checks.board = board;
  check(
    "no-chat-icon-remains",
    board.chatControls === 0 &&
      board.chatClasses === 0 &&
      board.messageIcons === 0 &&
      board.cards.every(
        (card) => card.chat === 0 && card.chatClasses === 0 && card.chatIcons === 0,
      ) &&
      board.cards.every((card) => (card.toggle?.svgs ?? 0) === 0),
    `${board.chatControls} chat control(s), ${board.chatClasses} chat class(es), ` +
      `${board.messageIcons} MessageSquare glyph(s) across ${board.cards.length} card(s)`,
  );

  step("click-target");
  // ── 8. every card is a click target, with one keyboard toggle ─────────────
  const nameFor = (id) => NAMES.find((entry) => entry.id === id);
  const badTargets = board.cards.filter((card) => {
    const expected = nameFor(card.id);
    return (
      card.toggle === null ||
      card.toggle.pinId !== card.id ||
      card.toggle.pressed !== "false" ||
      card.toggle.label !== `Add "${expected.label}" to the chat context` ||
      card.toggle.inChrome !== false ||
      card.toggle.svgs !== 0 ||
      card.toggle.width > 2 ||
      card.toggle.height > 2 ||
      card.cursor !== "pointer" ||
      card.inContext !== false
    );
  });
  check(
    "every-card-is-a-click-target",
    board.cards.length === SEED.length &&
      board.contextToggles === SEED.length &&
      board.cards.every((card) => card.heading === nameFor(card.id)?.heading) &&
      badTargets.length === 0 &&
      // Every card on the board is a pin: a card the page draws for itself has
      // no pin id, is not a click target, and has no place on the board.
      board.staticPins.length === 0,
    `${board.contextToggles} toggle(s) over ${board.cards.length} card(s); ` +
      `offending: ${JSON.stringify(badTargets)}; static ${JSON.stringify(board.staticPins)}`,
  );

  step("press-adds");
  // ── 9. a press anywhere on the card adds it ───────────────────────────────
  const writesBeforePress = (await pinWrites(win)).length;
  await pressCard(win, "view:financial:v-weekly", 1);
  const pressed = await sample(win);
  const pressedCard = pressed.cards.find((card) => card.id === "view:financial:v-weekly");
  const pressedDock = await dock(win);
  checks.pressedCard = {
    dock: pressedDock,
    card: pressedCard,
    inContextCards: pressed.inContextCards,
  };
  check(
    "clicking-a-card-adds-it",
    pressedDock.open === true &&
      pressedDock.contextCards?.length === 1 &&
      pressedDock.contextCards[0]?.label === "Weekly expenses" &&
      pressedDock.contextCards[0]?.boardSlug === null &&
      pressedDock.contextCards[0]?.pin?.id === "view:financial:v-weekly" &&
      pressedDock.contextCards[0]?.pin?.viewId === "v-weekly" &&
      pressedDock.contextCards[0]?.pin?.domainSlug === "financial" &&
      JSON.stringify(pressed.inContextCards) === JSON.stringify(["view:financial:v-weekly"]) &&
      pressedCard?.inContext === true &&
      drawnRing(pressedCard) &&
      pressedCard?.toggle?.pressed === "true" &&
      pressedCard?.toggle?.label === 'Take "Weekly expenses" out of the chat context' &&
      (await pinWrites(win)).length === writesBeforePress,
    `the press left ${JSON.stringify(checks.pressedCard)}`,
  );

  // The same claim about a card's content, not just its chrome-free margins: a
  // table cell inside the card is a press on the card.
  await press(win, await cardBodyPoint(win, "view:financial:v-weekly"));
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "a second body press to take the card back out",
  );
  await press(win, await cardCellPoint(win, "view:financial:v-weekly"));
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 1`,
    "a press on the card's table cell to add it",
  );
  const fromCell = await sample(win);
  check(
    "a-press-on-the-cards-content-is-a-press-on-the-card",
    JSON.stringify(fromCell.inContextCards) === JSON.stringify(["view:financial:v-weekly"]) &&
      fromCell.cards.find((card) => card.id === "view:financial:v-weekly")?.inContext === true &&
      (await contextIds(win))[0] === "view:financial:v-weekly",
    `the table-cell press left ${JSON.stringify(fromCell.inContextCards)}`,
  );
  await clearContext(win);

  step("three-hold");
  // ── 10. three cards hold at once, in press order ──────────────────────────
  await pressCard(win, "view:financial:v-weekly", 1);
  await pressCard(win, "page:financial:ledger", 2);
  await pressCard(win, "sys:today-week", 3);
  const threeHeld = await sample(win);
  const expectedIds = ["view:financial:v-weekly", "page:financial:ledger", "sys:today-week"];
  const expectedLabels = ["Weekly expenses", "Ledger", "Today & this week"];
  checks.threeHeld = {
    ids: await contextIds(win),
    cards: (await dock(win)).contextCards?.map((card) => ({ label: card.label, boardSlug: card.boardSlug })),
    inContextCards: threeHeld.inContextCards,
    toggles: threeHeld.cards
      .filter((card) => expectedIds.includes(card.id))
      .map((card) => ({ id: card.id, pressed: card.toggle?.pressed, label: card.toggle?.label })),
  };
  check(
    "three-cards-hold-at-once",
    JSON.stringify(checks.threeHeld.ids) === JSON.stringify(expectedIds) &&
      JSON.stringify(checks.threeHeld.cards?.map((card) => card.label)) === JSON.stringify(expectedLabels) &&
      checks.threeHeld.cards?.every((card) => card.boardSlug === null) &&
      JSON.stringify(threeHeld.inContextCards) === JSON.stringify(expectedIds) &&
      threeHeld.cards
        .filter((card) => expectedIds.includes(card.id))
        .every(
          (card) =>
            drawnRing(card) &&
            card.toggle?.pressed === "true" &&
            card.toggle?.label === `Take "${nameFor(card.id).label}" out of the chat context`,
        ) &&
      threeHeld.cards
        .filter((card) => !expectedIds.includes(card.id))
        .every((card) => !card.inContext && !drawnRing(card) && card.toggle?.pressed === "false"),
    `three presses left ${JSON.stringify(checks.threeHeld)}`,
  );

  step("second-press");
  // ── 11. a second press takes only that card out ───────────────────────────
  const writesBeforeSecond = (await pinWrites(win)).length;
  await pressCard(win, "page:financial:ledger", 2);
  const afterSecond = await sample(win);
  const secondIds = await contextIds(win);
  const ledger = afterSecond.cards.find((card) => card.id === "page:financial:ledger");
  const stillHeld = afterSecond.cards.filter((card) =>
    ["view:financial:v-weekly", "sys:today-week"].includes(card.id),
  );
  checks.afterSecond = { ids: secondIds, inContextCards: afterSecond.inContextCards, ledger };
  check(
    "a-second-click-removes-only-that-card",
    JSON.stringify(secondIds) ===
      JSON.stringify(["view:financial:v-weekly", "sys:today-week"]) &&
      JSON.stringify(afterSecond.inContextCards) ===
        JSON.stringify(["view:financial:v-weekly", "sys:today-week"]) &&
      ledger?.inContext === false &&
      !drawnRing(ledger) &&
      ledger?.toggle?.pressed === "false" &&
      stillHeld.every((card) => drawnRing(card) && card.toggle?.pressed === "true") &&
      (await dock(win))?.open === true &&
      (await pinWrites(win)).length === writesBeforeSecond,
    `the second press left ${JSON.stringify(checks.afterSecond)}`,
  );

  step("fourth-refused");
  // ── 12. a fourth card is refused, visibly ─────────────────────────────────
  // The preceding claim left two cards held and took the middle one out; put it
  // back so the fourth press really is a fourth press.
  await pressCard(win, "page:financial:ledger", 3);
  const writesBeforeFourth = (await pinWrites(win)).length;
  const fourthPoint = await cardBodyPoint(win, "view:financial:v-summary");
  mouse(win, "mouseDown", fourthPoint.x, fourthPoint.y);
  await sleep(40);
  mouse(win, "mouseUp", fourthPoint.x, fourthPoint.y);
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="pin-context-status"]'))`,
    "the fourth-card status line",
  );
  const refused = await sample(win);
  const refusedIds = await contextIds(win);
  const fourthCard = refused.cards.find((card) => card.id === "view:financial:v-summary");
  checks.refused = {
    ids: refusedIds,
    status: refused.status,
    card: fourthCard,
    inContextCards: refused.inContextCards,
  };
  check(
    "a-fourth-card-is-refused-with-a-status-line",
    JSON.stringify(refusedIds) ===
      JSON.stringify(["view:financial:v-weekly", "sys:today-week", "page:financial:ledger"]) &&
      refused.status.present === true &&
      refused.status.role === "status" &&
      refused.status.text === FULL_NOTICE &&
      refused.status.height > 0 &&
      refused.status.display !== "none" &&
      fourthCard?.inContext === false &&
      !drawnRing(fourthCard) &&
      fourthCard?.toggle?.pressed === "false" &&
      refused.inContextCards.length === 3 &&
      (await pinWrites(win)).length === writesBeforeFourth,
    `the fourth press left ${JSON.stringify(checks.refused)}`,
  );

  // The next successful toggle clears the line: it is an answer, not a state.
  await pressCard(win, "view:financial:v-weekly", 2);
  await waitFor(
    win,
    `!document.querySelector('[data-testid="pin-context-status"]')`,
    "the status line to clear after a successful toggle",
  );
  const afterNotice = await sample(win);
  checks.noticeCleared = afterNotice.status;
  check(
    "the-refusal-line-clears-on-the-next-toggle",
    afterNotice.status.present === false &&
      JSON.stringify(await contextIds(win)) ===
        JSON.stringify(["sys:today-week", "page:financial:ledger"]),
    `after a successful toggle the status read ${JSON.stringify(afterNotice.status)}`,
  );
  await clearContext(win);

  step("empty-clear");
  // ── 13. empty board space clears every card at once ───────────────────────
  const seedThree = async () => {
    await pressCard(win, "view:financial:v-weekly", 1);
    await pressCard(win, "page:financial:ledger", 2);
    await pressCard(win, "sys:today-week", 3);
  };
  await seedThree();
  const gapPoint = await emptyBoardPoint(win);
  mouse(win, "mouseDown", gapPoint.x, gapPoint.y);
  await sleep(40);
  mouse(win, "mouseUp", gapPoint.x, gapPoint.y);
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the gap press to clear the context",
  );
  const afterGap = await sample(win);
  checks.emptyGap = { point: gapPoint, inContextCards: afterGap.inContextCards, status: afterGap.status };

  await seedThree();
  const headerPoint = await pointAt(win, '[data-testid="wing-eyebrow"]');
  mouse(win, "mouseDown", headerPoint.x, headerPoint.y);
  await sleep(40);
  mouse(win, "mouseUp", headerPoint.x, headerPoint.y);
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the header-text press to clear the context",
  );
  const afterHeader = await sample(win);

  // And the other half of the rule: a press on another app surface leaves the
  // context held. The operator works while the context is kept.
  await seedThree();
  const outside = await pointAt(win, '[data-testid="outside-the-dashboard"]');
  mouse(win, "mouseDown", outside.x, outside.y);
  await sleep(40);
  mouse(win, "mouseUp", outside.x, outside.y);
  await sleep(200);
  const afterOutside = await sample(win);
  checks.emptyClear = {
    afterGap: afterGap.inContextCards,
    afterHeader: afterHeader.inContextCards,
    afterOutside: afterOutside.inContextCards,
    outsidePoint: outside,
  };
  check(
    "empty-board-clicks-clear-all",
    afterGap.inContextCards.length === 0 &&
      afterHeader.inContextCards.length === 0 &&
      // The third press was NOT on the Dashboard, so nothing was cleared.
      JSON.stringify(afterOutside.inContextCards) ===
        JSON.stringify(["view:financial:v-weekly", "page:financial:ledger", "sys:today-week"]) &&
      (await contextIds(win)).length === 3,
    `the empty-board presses read ${JSON.stringify(checks.emptyClear)}`,
  );
  await clearContext(win);

  step("controls");
  // ── 14. a card's own controls keep their presses ──────────────────────────
  await render(win, false);
  await clearContext(win);
  const writesBeforeControls = (await pinWrites(win)).length;
  const contextBeforeControls = (await contextIds(win)).length;

  // The 3-dot trigger opens the menu and does not touch the context.
  const menuPoint = await pointAt(win, '[data-pin-id="sys:today-week"] [data-testid="pin-menu-toggle"]');
  await press(win, menuPoint);
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-pin-id="sys:today-week"] [data-testid="pin-menu"]'))`,
    "the card menu to open from a real press",
  );
  const afterMenuPress = await sample(win);

  // Edit card is a menu item: it opens Edit mode and does not touch the context.
  await press(win, await pointAt(win, '[data-pin-id="sys:today-week"] [data-testid="pin-edit"]'));
  await waitFor(
    win,
    `document.querySelectorAll('.home-pin.is-editing').length === 1`,
    "Edit mode to open from the menu",
  );
  const afterEdit = await sample(win);

  // A press on the card body while Edit mode is on is about the size, not the
  // chat.
  await press(win, await cardBodyPoint(win, "sys:today-week"));

  // A size handle is its own control.
  const handlePoint = await pointAt(win, '[data-pin-id="sys:today-week"] [data-pin-handle-axis="width"]');
  await press(win, handlePoint);

  // Escape leaves Edit mode; the page menu is another one of the board's own
  // controls and must not clear or add anything either.
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(
    win,
    `document.querySelectorAll('.home-pin.is-editing').length === 0`,
    "Escape to leave Edit mode",
  );
  const pageMenuPoint = await pointAt(win, '[data-testid="board-page-menu"]');
  await press(win, pageMenuPoint);
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-page-menu-popover"]'))`,
    "the page menu to open",
  );
  await press(win, pageMenuPoint);
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the page menu to close",
  );
  const afterControls = await sample(win);
  checks.controls = {
    before: contextBeforeControls,
    afterMenuPress: (await win.webContents.executeJavaScript(
      "((window.dashboardCardContextDock ?? {}).contextCards ?? []).length",
    )),
    afterEdit,
    after: afterControls,
    menus: afterMenuPress.menus.length,
  };
  check(
    "a-cards-own-controls-do-not-toggle",
    afterMenuPress.menus.length === 1 &&
      afterEdit.editing === 1 &&
      afterEdit.resizeHandles === 2 &&
      afterControls.editing === 0 &&
      (await contextIds(win)).length === 0 &&
      afterControls.inContextCards.length === 0 &&
      (await pinWrites(win)).length === writesBeforeControls,
    `the card's own controls left ${JSON.stringify({
      menu: afterMenuPress.menus.length,
      editing: afterEdit.editing,
      handles: afterEdit.resizeHandles,
      context: await contextIds(win),
    })} and ${(await pinWrites(win)).length - writesBeforeControls} write(s)`,
  );

  step("gestures");
  // ── 15. a hold, a drag and a drift are not a press on the card ────────────
  await render(win, false);
  await clearContext(win);
  const writesBeforeGesture = (await pinWrites(win)).length;

  // A hold that lifts the card and drops it where it stood: the click the
  // browser delivers at the end belongs to the gesture.
  const holdPoint = await cardBodyPoint(win, "sys:today-week");
  mouse(win, "mouseDown", holdPoint.x, holdPoint.y);
  const holdLifted = await waitForLift(win);
  mouse(win, "mouseUp", holdPoint.x, holdPoint.y);
  await sleep(220);
  const afterHold = await sample(win);
  checks.hold = { liftedDuringHold: holdLifted, context: await contextIds(win), lifted: afterHold.lifted };

  // A real drag, aimed at the first slot: one write, no context.
  await dragCard(win, "view:financial:v-summary", async () =>
    pointAt(win, '[data-pin-id="sys:goal-progress"] .home-card__title'),
  );
  await waitFor(
    win,
    `(window.dashboardCardContextPinWrites ?? []).length > ${writesBeforeGesture}`,
    "the drag to write the new order",
  );
  const afterDrag = await sample(win);
  const dragWrites = (await pinWrites(win)).length - writesBeforeGesture;
  checks.drag = { writes: dragWrites, context: await contextIds(win), lifted: afterDrag.lifted };

  // A press that drifts before the hold is disarmed: it is a text selection or a
  // nudge, not a click.
  const driftPoint = await cardBodyPoint(win, "page:financial:ledger");
  mouse(win, "mouseDown", driftPoint.x, driftPoint.y);
  mouse(win, "mouseMove", driftPoint.x + 20, driftPoint.y + 4);
  await sleep(60);
  mouse(win, "mouseUp", driftPoint.x + 20, driftPoint.y + 4);
  await sleep(200);
  const afterDrift = await sample(win);
  checks.drift = { context: await contextIds(win), lifted: afterDrift.lifted };

  // ...and the next real press still toggles, so the suppression was consumed
  // by the gesture rather than left stuck on the board.
  await pressCard(win, "view:financial:v-weekly", 1);
  const afterGestureThenPress = await sample(win);
  const writesAfterGestures = (await pinWrites(win)).length;
  check(
    "a-drag-does-not-toggle",
    holdLifted === true &&
      afterHold.lifted === 0 &&
      checks.hold.context.length === 0 &&
      dragWrites === 1 &&
      afterDrag.lifted === 0 &&
      checks.drag.context.length === 0 &&
      checks.drift.context.length === 0 &&
      afterDrift.lifted === 0 &&
      JSON.stringify(afterGestureThenPress.inContextCards) === JSON.stringify(["view:financial:v-weekly"]) &&
      writesAfterGestures === writesBeforeGesture + 1,
    `the gestures read ${JSON.stringify({
      hold: checks.hold,
      drag: checks.drag,
      drift: checks.drift,
      afterPress: afterGestureThenPress.inContextCards,
      writes: writesAfterGestures - writesBeforeGesture,
    })}`,
  );
  await clearContext(win);

  step("locked-select");
  // ── 16. the locked board still selects, holds and removes, writing nothing ─
  await render(win, true);
  const lockedRead = await sample(win);
  const lockedWritesBefore = (await pinWrites(win)).length;
  const lockedDeletesBefore = (await deletes(win)).length;
  await pressCard(win, "view:financial:v-weekly", 1);
  const lockedOne = await sample(win);
  await pressCard(win, "page:financial:ledger", 2);
  const lockedTwo = await sample(win);
  await pressCard(win, "view:financial:v-weekly", 1);
  const lockedRemoved = await sample(win);
  await press(win, await pointAt(win, '[data-testid="wing-eyebrow"]'));
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the locked board's empty space to clear the context",
  );
  const lockedCleared = await sample(win);
  checks.lockedSelection = {
    chrome: { bars: lockedRead.chromeBars, buttons: lockedRead.chromeButtons, tools: lockedRead.cards.map((card) => card.tools) },
    cursor: lockedRead.cards.map((card) => card.cursor),
    one: { ids: ["view:financial:v-weekly"], rings: lockedOne.inContextCards },
    two: lockedTwo.inContextCards,
    removed: lockedRemoved.inContextCards,
    cleared: lockedCleared.inContextCards,
    writes: (await pinWrites(win)).length - lockedWritesBefore,
    deletes: (await deletes(win)).length - lockedDeletesBefore,
  };
  check(
    "the-locked-board-still-selects-and-removes",
    lockedRead.chromeBars === 0 &&
      lockedRead.chromeButtons === 0 &&
      lockedRead.cards.every((card) => card.tools === 0 && card.chrome === 0) &&
      lockedRead.cards.every((card) => card.cursor === "pointer") &&
      JSON.stringify(lockedOne.inContextCards) === JSON.stringify(["view:financial:v-weekly"]) &&
      drawnRing(lockedOne.cards.find((card) => card.id === "view:financial:v-weekly")) &&
      JSON.stringify(lockedTwo.inContextCards) ===
        JSON.stringify(["view:financial:v-weekly", "page:financial:ledger"]) &&
      JSON.stringify(lockedRemoved.inContextCards) === JSON.stringify(["page:financial:ledger"]) &&
      lockedCleared.inContextCards.length === 0 &&
      (await pinWrites(win)).length === lockedWritesBefore &&
      (await deletes(win)).length === lockedDeletesBefore,
    `the locked board read ${JSON.stringify(checks.lockedSelection)}`,
  );

  step("keyboard");
  // ── 17. the keyboard toggle works, locked or not ──────────────────────────
  await render(win, false);
  await clearContext(win);
  const focusToggle = async (pinId) =>
    win.webContents.executeJavaScript(
      `(() => {
         const toggle = document.querySelector('[data-pin-id="${pinId}"] [data-testid="pin-context-toggle"]');
         if (!toggle) return false;
         toggle.focus();
         return document.activeElement === toggle;
       })()`,
    );
  const pressEnter = async () => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await sleep(150);
  };
  const focusedToggle = await focusToggle("view:financial:v-weekly");
  await sleep(60);
  const activeAfterFocus = await win.webContents.executeJavaScript(
    `(() => { const el = document.activeElement; return el ? { tag: el.tagName, testid: el.dataset.testid ?? null } : null; })()`,
  );
  const beforeEnter = await sample(win);
  await pressEnter();
  const activeAfterEnter = await win.webContents.executeJavaScript(
    `(() => { const el = document.activeElement; return el ? { tag: el.tagName, testid: el.dataset.testid ?? null } : null; })()`,
  );
  const contextAfterFirstEnter = await contextIds(win);
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 1`,
    "the keyboard toggle to add the card",
  );
  const afterEnter = await sample(win);
  await focusToggle("view:financial:v-weekly");
  await pressEnter();
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the keyboard toggle to remove the card",
  );
  const afterSecondEnter = await sample(win);

  // On a locked board the card is not a tab stop, but the context control is:
  // that is the whole reason it exists outside the editing chrome.
  await render(win, true);
  await clearContext(win);
  const lockedBeforeKeyboard = await sample(win);
  const lockedWritesBeforeKeyboard = (await pinWrites(win)).length;
  const lockedFocused = await focusToggle("view:financial:v-weekly");
  await pressEnter();
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 1`,
    "the locked board's keyboard toggle to add the card",
  );
  const lockedAfterEnter = await sample(win);
  await focusToggle("view:financial:v-weekly");
  await pressEnter();
  await waitFor(
    win,
    `((window.dashboardCardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the locked board's keyboard toggle to remove the card",
  );
  checks.keyboard = {
    focused: focusedToggle,
    activeAfterFocus,
    activeAfterEnter,
    contextAfterFirstEnter,
    before: { pressed: beforeEnter.cards.find((card) => card.id === "view:financial:v-weekly")?.toggle?.pressed },
    afterEnter: {
      rings: afterEnter.inContextCards,
      pressed: afterEnter.cards.find((card) => card.id === "view:financial:v-weekly")?.toggle?.pressed,
      label: afterEnter.cards.find((card) => card.id === "view:financial:v-weekly")?.toggle?.label,
    },
    afterSecondEnter: {
      rings: afterSecondEnter.inContextCards,
      pressed: afterSecondEnter.cards.find((card) => card.id === "view:financial:v-weekly")?.toggle?.pressed,
    },
    locked: {
      cardTabIndex: lockedBeforeKeyboard.cards.map((card) => card.tabIndex),
      toggleTabIndex: lockedBeforeKeyboard.cards.map((card) => card.toggle?.tabIndex),
      focused: lockedFocused,
      rings: lockedAfterEnter.inContextCards,
      writes: (await pinWrites(win)).length - lockedWritesBeforeKeyboard,
    },
  };
  check(
    "the-keyboard-toggle-works",
    focusedToggle === true &&
      checks.keyboard.afterEnter.rings.length === 1 &&
      checks.keyboard.afterEnter.rings[0] === "view:financial:v-weekly" &&
      checks.keyboard.afterEnter.pressed === "true" &&
      checks.keyboard.afterEnter.label === 'Take "Weekly expenses" out of the chat context' &&
      checks.keyboard.afterSecondEnter.rings.length === 0 &&
      checks.keyboard.afterSecondEnter.pressed === "false" &&
      checks.keyboard.locked.cardTabIndex.every((value) => value === -1) &&
      checks.keyboard.locked.toggleTabIndex.every((value) => value === 0) &&
      lockedFocused === true &&
      JSON.stringify(checks.keyboard.locked.rings) === JSON.stringify(["view:financial:v-weekly"]) &&
      checks.keyboard.locked.writes === 0,
    `the keyboard read ${JSON.stringify(checks.keyboard)}`,
  );
  await clearContext(win);

  step("names");
  // ── 18. the name comes off the heading ────────────────────────────────────
  await render(win, false);
  const handedNames = {};
  for (const wanted of NAMES) {
    await clearContext(win);
    await pressCard(win, wanted.id, 1);
    const held = await dock(win);
    handedNames[wanted.id] = held.contextCards?.[0]?.label ?? null;
  }
  const wrongNames = NAMES.filter((entry) => handedNames[entry.id] !== entry.label);
  checks.handedNames = handedNames;
  check(
    "the-name-comes-off-the-heading",
    wrongNames.length === 0 &&
      handedNames["sys:goal-progress"] === "Goals" &&
      // The heading node's whole subtree says "Goals2" because of the count
      // badge; the name is the heading's own words, never the id.
      NAMES[0].heading === "Goals2",
    `the dock took ${JSON.stringify(handedNames)}; expected ${JSON.stringify(
      Object.fromEntries(NAMES.map((entry) => [entry.id, entry.label])),
    )}`,
  );
  await clearContext(win);

  step("menus");
  // ── 19. the per-card menu still does its job ──────────────────────────────
  await render(win, false);
  const menuBoard = await sample(win);
  const badToggles = menuBoard.cards.filter(
    (card) => card.chromeButtons.includes("pin-menu-toggle") === false,
  );
  checks.menuToggle = menuBoard.menuToggle;
  checks.menuBoard = { menuToggles: menuBoard.menuToggles };
  check(
    "every-card-offers-the-menu",
    menuBoard.cards.length === SEED.length &&
      menuBoard.menuToggles === SEED.length &&
      badToggles.length === 0 &&
      menuBoard.menuToggle?.text === "" &&
      menuBoard.menuToggle?.svgs === 1 &&
      (menuBoard.menuToggle?.icon ?? "").includes("lucide-ellipsis-vertical") &&
      Boolean(menuBoard.menuToggle?.label) &&
      Boolean(menuBoard.menuToggle?.title) &&
      menuBoard.menuToggle?.haspopup === "menu" &&
      menuBoard.menuToggle?.expanded === "false",
    `${menuBoard.menuToggles} trigger(s) over ${menuBoard.cards.length} card(s); ` +
      `toggle ${JSON.stringify(menuBoard.menuToggle)}`,
  );

  const menuHeld = {};
  for (const [pinId, expected] of Object.entries(MENU)) {
    await openMenu(win, pinId);
    const open = await sample(win);
    menuHeld[pinId] = open.menus[0] ?? null;
    // Press the trigger again: the menu closes, and one popup is all there is.
    await click(win, `[data-pin-id="${pinId}"] [data-testid="pin-menu-toggle"]`);
    await waitFor(
      win,
      `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`,
      "the menu to close",
    );
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
    // Delete is the destructive one; Edit card and Archive never are.
    if (got?.danger?.[0] !== false) problems.push(`${pinId} Edit card wore the destructive token`);
    if (got?.danger?.[1] !== false) problems.push(`${pinId} Archive wore the destructive token`);
    const deleteAt = expected.indexOf("Delete");
    if (deleteAt >= 0 && got?.danger?.[deleteAt] !== true) {
      problems.push(`${pinId} Delete did not wear the destructive token`);
    }
    if (deleteAt >= 0 && got?.testids?.[deleteAt] !== "pin-delete") {
      problems.push(`${pinId} Delete item was ${JSON.stringify(got?.testids?.[deleteAt])}`);
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
    `${twoMenus.menus.length} menu(s) open: ${JSON.stringify(twoMenus.menus.map((menu) => menu.pinId))}`,
  );

  // Escape closes it.
  await win.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`,
    "Escape to close the menu",
  );
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

  step("archive");
  // ── 20. Archive takes the card off this board, and deletes nothing ────────
  const archiveWritesBefore = (await pinWrites(win)).length;
  await openMenu(win, "sys:today-week");
  await clickMenuItem(win, "sys:today-week", "pin-archive");
  await waitFor(
    win,
    `!document.querySelector('[data-pin-id="sys:today-week"]')`,
    "the archived card to leave the board",
  );
  const archiveWrites = (await pinWrites(win)).slice(archiveWritesBefore);
  const expectedArchive = SEED.filter((pin) => pin.id !== "sys:today-week");
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
   * view card has a saved view behind it, and taking the card off must leave the
   * view alone — still in the vault, still offered by the pin board, so the
   * operator can put the card back.
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

  step("delete-ask");
  // ── 21. Delete asks first, and only then writes ───────────────────────────
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
      afterCancel.cards.some((card) => card.id === "view:financial:v-weekly"),
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
      afterDelete.cards.every((card) => card.id !== "view:financial:v-weekly") &&
      afterDelete.gridCards === SEED.length - 1,
    `the delete sent ${JSON.stringify(deleteWrites)} and left ` +
      `${JSON.stringify(afterDelete.cards.map((card) => card.id))}`,
  );

  step("delete-page");
  // ── 22. the same, through a page pin ──────────────────────────────────────
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
      (await sample(win)).cards.every((card) => card.id !== "page:financial:ledger"),
    `the page question read ${JSON.stringify(pageQuestion.dialog)} and the delete sent ` +
      `${JSON.stringify(pageDeletes)}`,
  );

  step("deadline");
  // ── 23. the deadline pin is not a card, and lays its controls out its own way
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
      deadline.chatControls === 0 &&
      deadline.messageIcons === 0 &&
      deadline.chrome === 1 &&
      Math.abs(deadline.toolsRight - deadline.pinRight) <= 2 &&
      deadline.toolsBottom <= deadline.bannerTop,
    `the deadline pin's controls read ${JSON.stringify(deadline)}`,
  );

  step("home-cards");
  // ── 24. the cards say what they are showing ──────────────────────────────
  // A goal's domain and progress, a count that rides the heading rather than
  // floating off to the menu, an activity line that reads as a line, and the
  // task ticks. The cards the operator said were "plain" are read here as what
  // they draw, not as what they are called.
  await render(win, false);
  await waitFor(
    win,
    `document.querySelectorAll('[data-pin-id="sys:goal-progress"] .home-goal-row').length === 2`,
    "the goals card to draw its two rows",
  );
  await waitFor(
    win,
    `document.querySelectorAll('[data-pin-id="sys:today-week"] .home-task-row__check').length === 3`,
    "the task card to draw its three ticks",
  );
  const homeCards = await win.webContents.executeJavaScript(HOME_CARDS_SAMPLE);
  checks.homeCards = homeCards;
  check(
    "the-cards-say-what-they-show",
    homeCards.boardWidth !== null &&
      JSON.stringify(homeCards.goals.rows) ===
        JSON.stringify([
          {
            name: "Run 5k",
            domain: "Financial",
            unassigned: false,
            progress: "40",
            hasBar: true,
          },
          {
            name: "Renew the passport",
            domain: "No area",
            unassigned: true,
            progress: null,
            hasBar: false,
          },
        ]) &&
      // The goals card and the activity card are content-sized columns now, not
      // full-row strips.
      homeCards.goals.width < homeCards.boardWidth - 40 &&
      homeCards.activity.width < homeCards.boardWidth - 40 &&
      homeCards.todayWeek.width < homeCards.boardWidth - 40 &&
      homeCards.heading.markerBeforeCount === true &&
      homeCards.heading.countGapFromMarker !== null &&
      homeCards.heading.countGapFromMarker <= 16 &&
      homeCards.heading.countInFirstHalf === true &&
      homeCards.activity.rows.length === 2 &&
      homeCards.activity.rows.every((row) => row.summary && row.type && row.when) &&
      JSON.stringify(homeCards.todayWeek.columns.map((column) => column.heading)) ===
        JSON.stringify(["Today 2", "This week 1"]) &&
      JSON.stringify(homeCards.todayWeek.columns[0]?.tasks.map((task) => task.title)) ===
        JSON.stringify(["Draft the ledger import", "Reply to the accountant"]) &&
      JSON.stringify(homeCards.todayWeek.columns[1]?.tasks.map((task) => task.title)) ===
        JSON.stringify(["Close the books"]) &&
      homeCards.todayWeek.columns.every((column) =>
        column.tasks.every((task) => /^Mark ".+" done$/.test(task.checkbox ?? "")),
      ),
    `the cards read ${JSON.stringify(homeCards)}`,
  );

  step("task-tick");
  // ── 25. a tick on the Dashboard finishes a task ──────────────────────────
  // The write is the Act board's own `moveTask`: one command, to Done. The card
  // redraws from the task store, so the task leaves the column and the heading's
  // count follows it. Pressing on the card's control is not pressing the card
  // itself, so the chat's context stays empty.
  const tickBefore = await win.webContents.executeJavaScript(
    "window.dashboardCardContextMapCommands.length",
  );
  await click(
    win,
    '[data-pin-id="sys:today-week"] .home-task-row input.home-task-row__check',
  );
  await waitFor(
    win,
    `window.dashboardCardContextMapCommands.length > ${tickBefore}`,
    "the tick to write a map command",
  );
  // The redraw is asynchronous (the write, then a snapshot read): poll for it and
  // record whatever the card settled on, so a card that did not redraw fails with
  // its own state in the report rather than with a bare timeout.
  const tick = await (async () => {
    const deadline = Date.now() + 12_000;
    for (;;) {
      const state = await win.webContents.executeJavaScript(
        `(() => {
           const commands = window.dashboardCardContextMapCommands.slice(${tickBefore});
           const headings = [...document.querySelectorAll('[data-pin-id="sys:today-week"] .home-task-cols__head')]
             .map((el) => (el.textContent || '').trim());
           const titles = [...document.querySelectorAll('[data-pin-id="sys:today-week"] .home-task-row__title')]
             .map((el) => (el.textContent || '').trim());
           const error = document.querySelector('[data-pin-id="sys:today-week"] .form-error');
           const context = ((window.dashboardCardContextDock ?? {}).contextCards ?? []).length;
           return {
             commands,
             headings,
             titles,
             rows: titles.length,
             error: error ? (error.textContent || '').trim() : null,
             context,
           };
         })()`,
      );
      if (state.rows === 2 || Date.now() > deadline) return state;
      await sleep(120);
    }
  })();
  checks.taskTick = tick;
  check(
    "a-task-tick-marks-it-done",
    JSON.stringify(tick.commands) ===
      JSON.stringify([{ type: "moveTask", id: "t-draft", column: "done" }]) &&
      JSON.stringify(tick.headings) === JSON.stringify(["Today 1", "This week 1"]) &&
      tick.titles.includes("Reply to the accountant") &&
      !tick.titles.includes("Draft the ledger import") &&
      tick.error === null &&
      tick.context === 0,
    `the tick wrote ${JSON.stringify(tick.commands)} and left ${JSON.stringify(tick)}`,
  );

  // ── nothing unexpected, nothing on fire ───────────────────────────────────
  await clearContext(win);
  const unexpected = await win.webContents.executeJavaScript(
    "window.dashboardCardContextUnexpectedCalls",
  );
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The artifact screenshot is the board with the pin board open, three cards in
  // the chat's context and one card's menu open: the page's subjects in one
  // frame. The view this run deleted is really gone from the harness's vault, so
  // the board draws one card fewer than the seed, which is what the app would do
  // too.
  await render(win, false);
  await openPinBoard(win);
  await pressCard(win, "view:financial:v-summary", 1);
  await pressCard(win, "sys:today-week", 2);
  await pressCard(win, "sys:pending-decisions", 3);
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
      `above-grid=${above.sectionBeforeGrid} lockedAddItem=${lockedBoard.addItem === null ? "none" : "present"}`,
  );
  console.log(
    `cards: ${board.cards.length} cards, ${board.contextToggles} context toggle(s), ` +
      `${board.chatControls} chat control(s)`,
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
