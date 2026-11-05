/**
 * The wired-app acceptance run: the REAL LifeQuest main process, the REAL
 * preload, and the REAL renderer, opened on the operator's own vault.
 *
 * The other rigs prove the pieces. This one proves the join — that the built
 * `main.js` reads the board's lock over the real IPC bridge, that `pins:setLocked`
 * is a channel the preload and main agree on, and that the summary table
 * `scratch-live-dashboard` pinned shows up on the operator's Dashboard through
 * `pins:list` → `HomePage` → `ViewCard` → `view:runSaved`, with no stub anywhere.
 *
 * The lock is no longer a header switch: it is the FIRST item of the page's
 * three-dot menu. Every lock interaction here therefore opens `board-page-menu`,
 * chooses `board-lock-toggle`, waits for `aria-checked` to flip while the popover
 * is still mounted (the page re-renders on the write; the menu's open state lives
 * in the page tree and must survive it), and only then presses Escape so the page
 * can be read again. A direct click finds nothing while the menu is shut, and a
 * control that closed the menu would fail the open-menu half of that wait.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/dashboard-live-app.electron.mjs
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile seeded with a
 * copy of the operator's `recent.json`, so their vault auto-opens and their own
 * `%APPDATA%\LifeQuest` is never written; the window is hidden, so nothing
 * flashes on their desktop. This is the only rig here that runs the application
 * itself rather than a harness page.
 *
 * `--drag` (through the launcher) adds the one leg that writes: it reorders the
 * operator's own Overview board through the real IPC channel and then puts the
 * order back, asserting the board file at each step. It is opt-in for the same
 * reason the screenshot is: everything else here reads, and a run that writes to
 * a real vault should be a decision rather than a default.
 *
 * The drag is a HOLD, because there is no grip any more: the card is its own
 * handle. This window is hidden, and Chromium throttles timers in a window nobody
 * is looking at — a 220 ms hold that fired a second late would be cancelled by the
 * first pointer move, so the leg does not sleep and hope: it polls for the card to
 * actually be lifted before it moves, and asks the app not to throttle timers
 * while it does.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

// The drag leg holds a card, and the hold is a timer. A hidden window's timers are
// aligned to a second at best, which would make this leg a claim about throttling
// rather than about the channel. Every other rig here does not need this switch
// because none of them waits on a timer inside the app.
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const SOURCE_RECENT = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
const REPORT = path.join(artifactsDir, "dashboard-live-app.json");

const errors = [];
const failure = (m) => {
  errors.push(m);
  return m;
};

function waitFor(win, expression, label, timeoutMs = 30_000) {
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

/** What the operator's Dashboard renders, read straight off the live DOM. */
const SAMPLE = `(() => {
  const badge = document.querySelector('[data-testid="board-lock-badge"]');
  const title = document.querySelector(".home-dashboard__title");
  const trigger = document.querySelector('[data-testid="board-page-menu"]');
  const popover = document.querySelector('[data-testid="board-page-menu-popover"]');
  const lock = document.querySelector('[data-testid="board-lock-toggle"]');
  const add = document.querySelector('[data-testid="board-add-toggle"]');
  const item = (el) => {
    if (!el) return null;
    const label = el.querySelector(".page-menu__item-label");
    return {
      testid: el.dataset.testid ?? null,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      caption: label ? (label.textContent || "").trim() : (el.textContent || "").trim(),
      checked: el.getAttribute("aria-checked"),
      locked: el.dataset.locked ?? null,
      expanded: el.getAttribute("aria-expanded"),
    };
  };
  return {
    title: title ? title.textContent.trim() : null,
    badge: badge ? badge.textContent.trim() : null,
    locked: badge ? badge.dataset.locked : null,
    // The live board's page menu: the trigger is always there, the popover and
    // its items only while it is open. The lock and the pin board are read from
    // inside the menu now — there is no header control to read while shut.
    menu: {
      trigger: trigger
        ? {
            testid: trigger.dataset.testid ?? null,
            label: trigger.getAttribute("aria-label"),
            haspopup: trigger.getAttribute("aria-haspopup"),
            expanded: trigger.getAttribute("aria-expanded"),
            svgs: trigger.querySelectorAll("svg").length,
          }
        : null,
      popover: popover
        ? {
            role: popover.getAttribute("role"),
            label: popover.getAttribute("aria-label"),
            testid: popover.dataset.testid ?? null,
            items: [...popover.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')].map(
              (el) => el.dataset.testid ?? null,
            ),
          }
        : null,
    },
    toggle: lock ? (lock.textContent || "").trim() : null,
    toggleRole: lock ? lock.getAttribute("role") : null,
    toggleChecked: lock ? lock.getAttribute("aria-checked") : null,
    toggleLabel: lock ? lock.getAttribute("aria-label") : null,
    addToggle: Boolean(add),
    addItem: item(add),
    cards: Array.from(document.querySelectorAll(".view-card__title")).map((e) => e.textContent.trim()),
    tables: Array.from(document.querySelectorAll(".view-card__table")).map((t) =>
      Array.from(t.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
      ),
    ),
    headers: Array.from(document.querySelectorAll(".view-card__table thead th")).map((th) =>
      th.textContent.trim(),
    ),
    tableAlign: (() => {
      const cell = document.querySelector(".view-card__table tbody td + td");
      return cell ? getComputedStyle(cell).textAlign : null;
    })(),
    // The card must wear the board's own shell, so a pinned view reads as a
    // sibling of the KPI cards rather than as a drawing dropped onto the board.
    shell: (() => {
      const card = document.querySelector(".view-card");
      if (!card) return null;
      const cs = getComputedStyle(card);
      return { background: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
    })(),
    /** The live palette the card is judged against, with a sibling card's own. */
    palette: (() => {
      const root = getComputedStyle(document.documentElement);
      const sibling = document.querySelector(".home-card");
      const token = (name) => root.getPropertyValue(name).trim();
      return {
        skin: document.documentElement.dataset.skin ?? null,
        theme: document.documentElement.dataset.theme ?? null,
        accent: token("--accent"),
        bgPanel: token("--bg-panel"),
        border: token("--border"),
        siblingBackground: sibling ? getComputedStyle(sibling).backgroundColor : null,
      };
    })(),
    metrics: Array.from(document.querySelectorAll(".view-card__metric")).map((e) => e.textContent.trim()),
    chrome: document.querySelectorAll(".home-pin__chrome").length,
    pinCount: document.querySelectorAll(".home-dashboard__grid > .home-pin").length,
    addPin: Boolean(document.querySelector('[data-testid="board-add-pin"]')),
  };
})()`;

/** The board's pins, in the order the live DOM has them. */
const ORDER = `[...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")].map((el) => el.dataset.pinId)`;

/** Real input, through the browser's own pipeline: this is the app's own window. */
function mouse(win, type, x, y) {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open the page's three-dot menu and wait for its popover.
 *
 * The lock and the pin board live inside it now: a direct click on
 * `board-lock-toggle` finds nothing while the menu is shut, so every lock
 * interaction in this rig opens the menu first.
 */
async function openPageMenu(win) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-page-menu"]').click()`,
  );
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-page-menu-popover"]'))`,
    "the page menu to open",
  );
}

/** Escape at the document: the page menu's own dismissal, and it returns focus. */
async function pressEscape(win) {
  await win.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`,
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the page menu to close",
  );
}

/**
 * Choose the lock item, and prove the live menu STAYS OPEN across the write.
 *
 * The page re-renders when the lock write resolves, but the menu's open state
 * lives in the page's own tree, so the popover and its item must survive the
 * flip. The rig waits for `aria-checked` to reach `expectChecked` while the
 * popover is still there, records that state, and only then dismisses the menu
 * so the page can be read again.
 */
async function chooseLock(win, expectChecked) {
  await openPageMenu(win);
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="board-lock-toggle"]').click()`,
  );
  const whileOpen = await waitFor(
    win,
    `(() => {
       const el = document.querySelector('[data-testid="board-lock-toggle"]');
       const popover = document.querySelector('[data-testid="board-page-menu-popover"]');
       if (!el || !popover) return null;
       if (el.getAttribute('aria-checked') !== '${expectChecked}') return null;
       return {
         checked: el.getAttribute('aria-checked'),
         locked: el.dataset.locked ?? null,
         menuOpen: true,
         caption: (el.textContent || '').trim(),
       };
     })()`,
    `the live lock item to read aria-checked=${expectChecked} with the menu still open`,
  );
  await pressEscape(win);
  return whileOpen;
}

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** How many proposals are waiting for the operator right now. */
async function pendingDecisions(win) {
  const list = await win.webContents.executeJavaScript("window.lifequest.decisionList()");
  const records = list && list.ok ? list.value : [];
  return records.filter((record) => record.status === "pending").length;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-app-"));
  if (!fs.existsSync(SOURCE_RECENT)) {
    console.error(`no recent.json at ${SOURCE_RECENT} — cannot open a vault`);
    app.exit(1);
    return;
  }
  // Seed the throwaway profile with the operator's recent list so their vault
  // auto-opens. The path itself comes from that file, never from this script.
  fs.copyFileSync(SOURCE_RECENT, path.join(workDir, "recent.json"));

  // The SAME handlers and the SAME window the product boots with. The profile
  // is already isolated above through app.setPath("userData", …).
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const checks = {};

  // The window opens on the operator's last lens, which is a domain. The board
  // this run reports on is the Overview one, so the rail's own switch is used —
  // the same `domain:setActive` channel the renderer calls — and the page is
  // reloaded so the restored lens is re-read.
  //
  // Boot order matters: the renderer paints Welcome before its snapshot arrives
  // and only then swaps to the Dashboard, so this waits for the vault to be open
  // rather than sampling whatever the first frame held. `bootForE2e` returns as
  // soon as the window is loaded, which is earlier than that.
  await waitFor(
    win,
    `Boolean(document.querySelector(".home-dashboard"))`,
    "the vault to open and the Dashboard to mount",
    60_000,
  );
  const onWelcome = await win.webContents.executeJavaScript(
    `Boolean(document.querySelector(".welcome"))`,
  );
  checks.openedOnWelcome = onWelcome;
  if (onWelcome) {
    failure("the app opened on Welcome: the seeded profile did not auto-open the vault");
  }

  const switched = await win.webContents.executeJavaScript(
    `window.lifequest.domainSetActive(null)`,
  );
  checks.overviewSwitch = switched;
  if (!switched || switched.ok !== true) {
    failure(`switching to the Overview lens failed: ${JSON.stringify(switched)}`);
  }
  await win.webContents.reload();
  await waitFor(win, `Boolean(document.querySelector(".home-dashboard"))`, "the Dashboard");
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the Overview board to read unlocked",
  );
  // A view card paints its frame first and its rows when `view:runSaved`
  // answers, so the sample waits for the card's content rather than the shell.
  await waitFor(
    win,
    `document.querySelectorAll(".view-card__table tbody tr").length > 0 || Boolean(document.querySelector(".view-card__error, .view-card__empty"))`,
    "the pinned card to draw",
    30_000,
  );

  const board = await win.webContents.executeJavaScript(SAMPLE);
  checks.overview = board;

  // ── the pinned summary table is on the real board ────────────────────────
  if (!board.cards.includes("Spending by month")) {
    failure(`the Overview dashboard does not show the pinned card: ${JSON.stringify(board.cards)}`);
  }
  const rows = board.tables.flat();
  checks.tableRows = rows;
  if (rows.length !== 5) {
    failure(`the card drew ${rows.length} table rows on the live board: ${JSON.stringify(rows)}`);
  }
  checks.metric = board.metrics[0] ?? null;
  if (!(board.metrics[0] ?? "").includes("ZAR")) {
    failure(`the card's headline metric read ${JSON.stringify(board.metrics[0])}`);
  }
  // The card is drawn in the design system, on the operator's real board: the
  // month header comes from the query, the money column is right-aligned, and
  // the shell matches its sibling pins.
  checks.design = { headers: board.headers, tableAlign: board.tableAlign, shell: board.shell };
  if (board.headers[0] !== "Month") {
    failure(`the live card's label column read ${JSON.stringify(board.headers[0])}, expected "Month"`);
  }
  if (!(board.headers[1] ?? "").startsWith("Total")) {
    failure(`the live card's value column read ${JSON.stringify(board.headers[1])}`);
  }
  if (board.tableAlign !== "right") {
    failure(`the live card's value column is ${JSON.stringify(board.tableAlign)}-aligned, expected right`);
  }
  if (!board.shell?.background || board.shell.background === "rgba(0, 0, 0, 0)") {
    failure(`the live card drew no shell background: ${JSON.stringify(board.shell)}`);
  }
  if (board.shell?.border === "0px" || board.shell?.radius === "0px") {
    failure(`the live card drew no shell edge: ${JSON.stringify(board.shell)}`);
  }
  // The card is drawn FROM the live palette, so it cannot drift from the skin
  // the operator runs: the same `--bg-panel` as a sibling KPI card, and the
  // accent the theme hands out.
  checks.palette = board.palette;
  if (board.palette.siblingBackground && board.shell.background !== board.palette.siblingBackground) {
    failure(
      `the live card's paper (${board.shell.background}) is not its siblings' (${board.palette.siblingBackground})`,
    );
  }
  if (board.locked !== "false") failure(`the Overview board read locked=${JSON.stringify(board.locked)}`);
  if (board.chrome === 0) failure("the live unlocked board drew no pin chrome");
  // Adding is a control now, not a permanent row, and it lives behind the page's
  // three-dot menu. The page menu is opened once and dismissed with Escape so
  // the operator's board is left as it was found; its items are read from inside
  // the popover, because a closed menu puts none of them in the document.
  await openPageMenu(win);
  const overviewMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.overviewMenu = overviewMenu;
  await pressEscape(win);
  const liveMenu = overviewMenu.menu;
  if (!liveMenu.trigger) {
    failure("the live board drew no page-menu trigger");
  } else {
    if (liveMenu.trigger.haspopup !== "menu") {
      failure(`the live trigger's aria-haspopup read ${JSON.stringify(liveMenu.trigger.haspopup)}`);
    }
    if (liveMenu.trigger.expanded !== "true") {
      failure(`the live trigger read aria-expanded=${JSON.stringify(liveMenu.trigger.expanded)} while open`);
    }
    if (liveMenu.trigger.label !== "Dashboard actions") {
      failure(`the live trigger is named ${JSON.stringify(liveMenu.trigger.label)}`);
    }
    if (liveMenu.trigger.svgs !== 1) {
      failure(`the live trigger drew ${liveMenu.trigger.svgs} svg(s), expected one`);
    }
  }
  if (liveMenu.popover?.role !== "menu") {
    failure(`the live page menu's popover read role ${JSON.stringify(liveMenu.popover?.role)}`);
  } else {
    if (liveMenu.popover.label !== "Dashboard actions") {
      failure(`the live popover is named ${JSON.stringify(liveMenu.popover.label)}`);
    }
    if (liveMenu.popover.testid !== "board-page-menu-popover") {
      failure(`the live popover's test id read ${JSON.stringify(liveMenu.popover.testid)}`);
    }
    // The lock is the menu's first item on the operator's own board too.
    if (liveMenu.popover.items?.[0] !== "board-lock-toggle") {
      failure(
        `the live menu's first item is ${JSON.stringify(liveMenu.popover.items?.[0])}, expected the lock`,
      );
    }
  }
  // The lock is a `menuitemcheckbox` state, not an action: its position and the
  // badge are the state, and the caption stays "Lock" in both positions.
  if (overviewMenu.toggleRole !== "menuitemcheckbox") {
    failure(`the live lock item's role read ${JSON.stringify(overviewMenu.toggleRole)}`);
  }
  if (overviewMenu.toggleChecked !== "false") {
    failure(`the live lock item read aria-checked=${JSON.stringify(overviewMenu.toggleChecked)}`);
  }
  if (overviewMenu.toggleLabel !== "Lock this dashboard") {
    failure(`the live lock item is named ${JSON.stringify(overviewMenu.toggleLabel)}`);
  }
  if (overviewMenu.toggle !== "Lock") {
    failure(`the live board's lock item read ${JSON.stringify(overviewMenu.toggle)}`);
  }
  // Recorded, not assumed: the operator's board already carries every system pin,
  // every finance page and the new card, so the honest answer to "is there an add
  // path?" may be no pin-board item at all. What the chrome count above proves is
  // that the unlocked board is editable.
  checks.addPinRowOffered = board.addPin;
  checks.pinBoardOffered = overviewMenu.addToggle;

  // ── the lock item, over the real IPC channel ─────────────────────────────
  // `pins:setLocked` is the one channel this feature adds; a rig with a stubbed
  // bridge can never prove the preload and main agree on its name and arity. The
  // menu stays open across the write — the popover and the item must survive the
  // page's re-render — and Escape dismisses it before the page is read again.
  checks.lockOn = await chooseLock(win, "true");
  if (checks.lockOn?.menuOpen !== true) {
    failure("choosing the lock item did not keep the live page menu open");
  }
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'true'; })()`,
    "the live board to lock",
  );
  const lockedSample = await win.webContents.executeJavaScript(SAMPLE);
  checks.afterLockClick = lockedSample;
  if (lockedSample.badge !== "Locked") {
    failure(`the board did not lock: badge ${JSON.stringify(lockedSample.badge)}`);
  }
  if (lockedSample.chrome !== 0 || lockedSample.addPin) {
    failure("the locked live board is still editable");
  }
  if (lockedSample.pinCount !== board.pinCount) {
    failure(
      `the locked live board changed its cards: ${board.pinCount} pins unlocked, ${lockedSample.pinCount} locked`,
    );
  }

  // ...and back, so the operator's board is left as it was found (unlocked).
  checks.unlockOn = await chooseLock(win, "false");
  if (checks.unlockOn?.menuOpen !== true) {
    failure("choosing the lock item did not keep the live page menu open");
  }
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the live board to unlock again",
  );
  checks.afterUnlockClick = await win.webContents.executeJavaScript(SAMPLE);
  if (checks.afterUnlockClick.chrome !== board.chrome) {
    failure(
      `unlocking restored ${checks.afterUnlockClick.chrome} pin chrome bars, the unlocked board had ${board.chrome}`,
    );
  }
  if (checks.afterUnlockClick.addPin !== board.addPin) {
    failure("unlocking did not restore the Add-pin row to its unlocked state");
  }

  // ── arranging the operator's own board, over the real IPC channel ─────────
  //
  // The harness rig proves the gesture against a stubbed bridge. This is the only
  // place the whole chain is real at once: hold → pointer capture → the slot rule
  // → `pins:set` → the board file on disk → the renderer reading it back.
  if (process.env.LIFEQUEST_E2E_DRAG) {
    const before = await win.webContents.executeJavaScript(ORDER);
    checks.dragBefore = before;
    if (before.length < 2) {
      failure(`the live board has ${before.length} pin(s); there is nothing to arrange`);
    } else {
      const [first, second] = before;
      /**
       * Drag `id` onto a fraction across the card `ontoId`.
       *
       * The card is its own handle: the press goes on the card's heading — never
       * its centre, because every home card ends in a link and a press on an
       * interactive element is deliberately not a drag — and it is HELD until the
       * board says the card is off it. Moving before the hold fires is a cancelled
       * press by design, so waiting for the lift is what makes this a drag.
       */
      const drag = async (id, ontoId, across) => {
        const from = await pointAt(win, `[data-pin-id="${id}"] .home-card__title, [data-pin-id="${id}"] .view-card__title`);
        mouse(win, "mouseDown", from.x, from.y);
        await waitFor(
          win,
          `document.querySelectorAll('[data-pin-id="${id}"].is-lifted').length === 1`,
          `the hold on ${id} to lift the card`,
        );
        const onto = await pointAt(win, `[data-pin-id="${ontoId}"]`);
        const target = { x: onto.left + onto.width * across, y: onto.top + 24 };
        for (let step = 1; step <= 3; step += 1) {
          mouse(win, "mouseMove", from.x + ((target.x - from.x) * step) / 3, from.y + ((target.y - from.y) * step) / 3);
          await sleep(60);
        }
        mouse(win, "mouseUp", target.x, target.y);
        await sleep(400);
      };

      // Onto the first card's left half: `second` lands before `first`.
      await drag(second, first, 0.2);
      const swapped = await win.webContents.executeJavaScript(ORDER);
      checks.dragAfterSwap = swapped;
      if (swapped.join(",") !== [second, first, ...before.slice(2)].join(",")) {
        failure(`the live drag gave ${JSON.stringify(swapped)}, expected ${JSON.stringify([second, first, ...before.slice(2)])}`);
      }
      // Onto the first card's right half: `second` goes back where it belongs,
      // so the operator's board is left exactly as it was found.
      await drag(second, first, 0.8);
      const restored = await win.webContents.executeJavaScript(ORDER);
      checks.dragRestored = restored;
      if (restored.join(",") !== before.join(",")) {
        failure(`the live board was not put back: ${JSON.stringify(restored)} against ${JSON.stringify(before)}`);
      }

      // A locked board has no arrange affordance at all, and a gesture over it
      // must not reach the bridge: no lift, and no new proposal in the inbox.
      // The lock is chosen from the open page menu, which stays open across the
      // write and is dismissed with Escape before the board is read.
      checks.dragLockOn = await chooseLock(win, "true");
      if (checks.dragLockOn?.menuOpen !== true) {
        failure("choosing the lock item did not keep the live page menu open");
      }
      await waitFor(
        win,
        `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'true'; })()`,
        "the live board to lock for the drag check",
      );
      const proposalsBefore = await pendingDecisions(win);
      const lockedChrome = await win.webContents.executeJavaScript(
        `document.querySelectorAll(".home-pin__chrome").length`,
      );
      const lockedCard = await pointAt(win, `[data-pin-id="${before[0]}"] .home-card__title, [data-pin-id="${before[0]}"] .view-card__title`);
      mouse(win, "mouseDown", lockedCard.x, lockedCard.y);
      await sleep(500);
      mouse(win, "mouseMove", lockedCard.x + 60, lockedCard.y + 30);
      await sleep(200);
      const lockedLifted = await win.webContents.executeJavaScript(
        `document.querySelectorAll(".home-pin.is-lifted").length`,
      );
      mouse(win, "mouseUp", lockedCard.x + 60, lockedCard.y + 30);
      await sleep(400);
      const proposalsAfter = await pendingDecisions(win);
      const afterLockedGesture = await win.webContents.executeJavaScript(ORDER);
      checks.dragLocked = {
        chrome: lockedChrome,
        lifted: lockedLifted,
        proposalsBefore,
        proposalsAfter,
        order: afterLockedGesture,
      };
      if (lockedChrome !== 0) {
        failure(`the locked live board drew ${lockedChrome} chrome bar(s), so there was chrome to press`);
      }
      if (lockedLifted !== 0) {
        failure("a gesture on the locked live board lifted a card");
      }
      if (proposalsAfter !== proposalsBefore) {
        failure(
          `a gesture on the locked live board filed a proposal: ${proposalsBefore} pending before, ${proposalsAfter} after`,
        );
      }
      if (afterLockedGesture.join(",") !== before.join(",")) {
        failure(`the locked live board changed its order: ${JSON.stringify(afterLockedGesture)}`);
      }
      // ...and back, so the operator's board is left unlocked.
      checks.dragLockOff = await chooseLock(win, "false");
      if (checks.dragLockOff?.menuOpen !== true) {
        failure("choosing the lock item did not keep the live page menu open");
      }
      await waitFor(
        win,
        `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
        "the live board to unlock after the drag check",
      );
    }
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the built app, on the operator's vault, showing the pinned summary table and toggling the page lock through the real IPC bridge",
    vault: "from the seeded recent.json",
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  // A picture of the operator's own board, on request: the artifact a reader
  // wants when the question is "does the restyle actually look like the app".
  // It is best-effort and time-boxed — a capture that never settles must not
  // turn a green run into a hung one, and the report is already on disk.
  if (process.env.LIFEQUEST_E2E_SHOT) {
    try {
      await win.webContents.executeJavaScript(
        `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      );
      const image = await Promise.race([
        win.webContents.capturePage(),
        new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (image) {
        fs.writeFileSync(path.join(artifactsDir, "dashboard-live-board.png"), image.toPNG());
      } else {
        console.error("[live-app] the board screenshot timed out; the report stands");
      }
    } catch (err) {
      console.error("[live-app] the board screenshot failed:", err);
    }
  }

  console.log(`board: ${JSON.stringify(board.cards)} metric ${checks.metric}`);
  console.log(`table rows: ${JSON.stringify(rows)}`);
  console.log(`lock: ${board.badge} -> ${lockedSample.badge} -> ${checks.afterUnlockClick.badge}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  fs.rmSync(workDir, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("dashboard-live-app rig timed out");
  app.exit(1);
}, 90_000);
