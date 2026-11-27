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
 *  1. UNLOCKED, the board is editable and the page's controls are one menu: the
 *     badge reads Unlocked, no standalone `role="switch"` is left anywhere on
 *     the page, and a three-dot trigger sits at the title's top-right edge. The
 *     trigger is measured: it is at the top, on the right half, 36 px high, and
 *     it contains one svg. No menu items are in the document until the trigger
 *     is pressed — a menu that renders closed fails this by name.
 *  2. The OPEN menu is the contract: a `role="menu"` popover named "Dashboard
 *     actions", anchored under the trigger, right-aligned to it, beginning
 *     above the board's grid, and floating over the page (a hit test inside it
 *     lands in the popover, not in the content behind). Its FIRST item is the
 *     lock (`role="menuitemcheckbox"`, track + thumb drawn, caption "Lock",
 *     `aria-checked="false"`, `data-locked="false"`); its SECOND item is the
 *     pin board (`role="menuitem"`, one lucide pin svg, `aria-expanded="false"`).
 *     A menu that leads with the lock's action instead of its state, or that
 *     drops the pin board out of the menu, fails here.
 *  3. LOCKED, the board is read-only and the menu still leads with the lock:
 *     badge Locked, the trigger still reachable, the menu holds EXACTLY the lock
 *     item (no pin-board item at all, so no add path — the row is gone too), no
 *     pin chrome, and the hint says where the companion's changes go. This is
 *     the claim the whole feature rests on.
 *  4. Choosing the lock is a real write: clicking it records exactly one
 *     `pinsSetLocked` call carrying the board slug and the new value, keeps the
 *     menu OPEN while `aria-checked` / `data-locked` update in place, and the
 *     page behind re-renders to the new state. A control that closed the menu
 *     (or that wrote twice) fails.
 *  5. The pin board is the menu's second item, and choosing it closes the menu
 *     before drawing the row: the item says "Hide pin board" with
 *     `aria-expanded="true"` once the row is open, and choosing it again takes
 *     the row away. So "an unlocked board offers Add pin" is a claim about a
 *     control that was pressed, not about markup.
 *  6. The menu is a keyboard surface: Escape closes it and hands focus back to
 *     the trigger, and a press outside closes it without the page navigating.
 *     The focus hand-back is read from `document.activeElement`, not from a
 *     class name.
 *  7. No console errors, and no bridge call outside the recording stub — a page
 *     that grows a new dependency fails by name rather than rendering an empty
 *     board.
 *
 * NOT covered here: that a locked board files a Decision instead of writing.
 * That is the vault-core half, in `dashboard-lock-e2e`, which runs the same
 * `save_view` call against a real vault on disk.
 *
 * Falsification: the locked/unlocked samples are two different board states fed
 * to the same page and read back from the DOM, so a page that ignores `locked`
 * shows the same chrome twice and fails claim 3. The toggle claim is proven by
 * the recorded call, not by the label changing. The menu geometry is measured
 * from the rendered boxes, so a popover stacked under the wrong edge or one
 * painted behind the grid fails rather than being eyeballed.
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

/** Read the board's chrome and its page menu straight off the rendered page. */
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
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const data = (el, name) => (el ? el.dataset[name] ?? null : null);
  const badge = document.querySelector('[data-testid="board-lock-badge"]');
  const heading = document.querySelector(".home-dashboard__title");
  const trigger = document.querySelector('[data-testid="board-page-menu"]');
  const popover = document.querySelector('[data-testid="board-page-menu-popover"]');
  const items = popover
    ? [...popover.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')]
    : [];
  const lock = popover ? popover.querySelector('[data-testid="board-lock-toggle"]') : null;
  const add = popover ? popover.querySelector('[data-testid="board-add-toggle"]') : null;
  const grid = document.querySelector(".home-dashboard__grid");
  const item = (el) => {
    if (!el) return null;
    const label = el.querySelector(".page-menu__item-label");
    const icon = el.querySelector("svg");
    const r = el.getBoundingClientRect();
    return {
      testid: data(el, "testid"),
      role: attr(el, "role"),
      label: attr(el, "aria-label"),
      title: attr(el, "title"),
      // The words the item paints, from its own label span rather than the whole
      // button: the lock row's track adds no text, but a claim about the caption
      // should read the caption.
      caption: label ? (label.textContent || "").trim() : (el.textContent || "").trim(),
      checked: attr(el, "aria-checked"),
      expanded: attr(el, "aria-expanded"),
      locked: data(el, "locked"),
      disabled: el.disabled === true,
      svgs: el.querySelectorAll("svg").length,
      icon: icon ? [...icon.classList].join(" ") : null,
      track: Boolean(el.querySelector(".page-menu__track")),
      thumb: Boolean(el.querySelector(".page-menu__thumb")),
      className: el.className,
      box: box(el),
      // The hit test asks the browser what is painted at the item's centre: an
      // item behind the page's content fails even though it is in the DOM.
      onTop: (() => {
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && el.contains(hit));
      })(),
    };
  };
  const popoverBox = box(popover);
  const active = document.activeElement;
  return {
    title: text(".home-dashboard__title"),
    badge: badge ? (badge.textContent || "").trim() : null,
    badgeLocked: badge ? badge.dataset.locked : null,
    badgeClass: badge ? badge.className : null,
    hint: text('[data-testid="board-lock-hint"]'),
    // The badge belongs beside the page's name again: its box is compared with
    // the heading's, not with the corner's.
    titleRow: {
      heading: box(heading),
      badge: box(badge),
      viewportWidth: window.innerWidth,
    },
    // The one control in the corner: a three-dot trigger, measured, not named.
    trigger: trigger
      ? {
          tag: trigger.tagName,
          className: trigger.className,
          testid: data(trigger, "testid"),
          isButton: trigger.tagName === "BUTTON",
          type: attr(trigger, "type"),
          label: attr(trigger, "aria-label"),
          title: attr(trigger, "title"),
          haspopup: attr(trigger, "aria-haspopup"),
          expanded: attr(trigger, "aria-expanded"),
          svgs: trigger.querySelectorAll("svg").length,
          box: box(trigger),
          viewportWidth: window.innerWidth,
        }
      : null,
    // The popover only exists while the menu is open. Everything the menu claims
    // is read from inside it, so a closed menu has no items to claim about.
    popover: popover
      ? {
          testid: data(popover, "testid"),
          role: attr(popover, "role"),
          label: attr(popover, "aria-label"),
          className: popover.className,
          position: getComputedStyle(popover).position,
          zIndex: getComputedStyle(popover).zIndex,
          box: popoverBox,
          itemCount: items.length,
          itemTestIds: items.map((el) => data(el, "testid")),
          items: items.map(item),
          gridTop: grid ? Math.round(grid.getBoundingClientRect().top) : null,
          viewportWidth: window.innerWidth,
          // The popover is a popover: the browser must hit it, not the page
          // behind it, at a point inside its own box.
          overlaysContent: (() => {
            if (!popoverBox) return false;
            const hit = document.elementFromPoint(
              Math.round(popoverBox.left + popoverBox.width / 2),
              Math.round(popoverBox.top + popoverBox.height / 2),
            );
            return Boolean(hit && popover.contains(hit));
          })(),
        }
      : null,
    lock: item(lock),
    add: item(add),
    // A closed menu puts no items in the document. These counts are read over
    // the whole document, so an item that leaked out of its popover is caught.
    lockItemsInDocument: document.querySelectorAll('[data-testid="board-lock-toggle"]').length,
    addItemsInDocument: document.querySelectorAll('[data-testid="board-add-toggle"]').length,
    // Nothing standalone is left: the lock is not a switch in the corner any
    // more, it is the menu's first item.
    standaloneSwitches: document.querySelectorAll('[role="switch"]').length,
    lockSwitchClasses: document.querySelectorAll(".lock-switch").length,
    menusInDocument: document.querySelectorAll('[role="menu"]').length,
    activeElement: active
      ? {
          testid: data(active, "testid"),
          tag: active.tagName,
          className: typeof active.className === "string" ? active.className : null,
        }
      : null,
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

/** Click something in the page, by selector. */
async function click(win, selector) {
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
}

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, width: r.width, height: r.height };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** Open the page menu and wait for its popover. */
async function openMenu(win) {
  await click(win, '[data-testid="board-page-menu"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-page-menu-popover"]'))`,
    "the page menu to open",
  );
}

/**
 * Escape, through the browser's own input pipeline — a real key press on the
 * element the menu focused, not a synthetic event dispatched at the document.
 */
async function pressEscape(win) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "Escape to close the page menu",
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

/**
 * The menu's geometry, judged from the boxes the browser laid out.
 *
 * The popover is anchored under the trigger, right-aligned to it (`right: 0` on
 * a `.page-menu` wrapper that is as wide as the trigger), begins above the board
 * grid, and paints over the page rather than under it. Every number comes from
 * `getBoundingClientRect`, so a menu stacked at the left, floating upward, or
 * painted into the content fails by measurement.
 */
function checkMenuGeometry(sample, where) {
  const { trigger, popover } = sample;
  if (!trigger) {
    failure(`${where}: the page drew no menu trigger`);
    return;
  }
  if (!popover) {
    failure(`${where}: the menu was not open`);
    return;
  }
  if (trigger.box.top > 120) {
    failure(`${where}: the trigger is not at the top: trigger top ${trigger.box.top}`);
  }
  if (trigger.box.right < trigger.viewportWidth / 2) {
    failure(
      `${where}: the trigger is not on the right: trigger right ${trigger.box.right} of ${trigger.viewportWidth}`,
    );
  }
  if (popover.role !== "menu") {
    failure(`${where}: the popover's role read ${JSON.stringify(popover.role)}`);
  }
  if (popover.label !== "Dashboard actions") {
    failure(`${where}: the popover is named ${JSON.stringify(popover.label)}`);
  }
  if (popover.testid !== "board-page-menu-popover") {
    failure(`${where}: the popover's test id read ${JSON.stringify(popover.testid)}`);
  }
  if (!String(popover.className).split(/\s+/).includes("page-menu__popover")) {
    failure(`${where}: the popover's class read ${JSON.stringify(popover.className)}`);
  }
  if (popover.position !== "absolute") {
    failure(`${where}: the popover is ${JSON.stringify(popover.position)}, not a floating popover`);
  }
  // Under the trigger, close to it: a menu anchored above the trigger, or
  // detached from it, fails.
  if (popover.box.top < trigger.box.bottom - 1) {
    failure(
      `${where}: the popover (top ${popover.box.top}) is not under the trigger (bottom ${trigger.box.bottom})`,
    );
  } else if (popover.box.top - trigger.box.bottom > 16) {
    failure(
      `${where}: the popover is detached from the trigger: ${popover.box.top - trigger.box.bottom}px below`,
    );
  }
  // Right-aligned: the popover's edge agrees with the trigger's.
  if (Math.abs(popover.box.right - trigger.box.right) > 2) {
    failure(
      `${where}: the popover (right ${popover.box.right}) is not right-aligned to the trigger (right ${trigger.box.right})`,
    );
  }
  // It begins above the board's grid, and the browser hits the popover at its
  // own centre: it floats over the page's content.
  if (popover.gridTop !== null && popover.box.top >= popover.gridTop) {
    failure(
      `${where}: the popover begins at ${popover.box.top}, below the board grid's ${popover.gridTop}`,
    );
  }
  if (!popover.overlaysContent) {
    failure(`${where}: a hit test inside the popover landed on the page behind it`);
  }
  for (const item of popover.items) {
    if (!item.onTop) {
      failure(`${where}: the menu item ${JSON.stringify(item.testid)} was painted under the page`);
    }
  }
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

  // ── 1. UNLOCKED: editable, and the page's controls are one menu ───────────
  const unlocked = await render(win, false);
  checks.unlocked = unlocked;
  if (unlocked.badge !== "Unlocked") {
    failure(`the unlocked board's badge read ${JSON.stringify(unlocked.badge)}`);
  }
  if (unlocked.badgeLocked !== "false") {
    failure(`the unlocked board's badge data-locked read ${JSON.stringify(unlocked.badgeLocked)}`);
  }
  // The standalone switch that used to sit here is gone from every page: the
  // lock is the menu's first item now. Both spellings are checked, because a
  // `role="switch"` left behind at a different weight is still a second lock
  // control on the page.
  if (unlocked.standaloneSwitches !== 0) {
    failure(`the page still drew ${unlocked.standaloneSwitches} standalone switch(es)`);
  }
  if (unlocked.lockSwitchClasses !== 0) {
    failure(`the page still drew ${unlocked.lockSwitchClasses} .lock-switch control(s)`);
  }
  // Closed on landing, in both senses: no popover, and no items in the document.
  if (unlocked.popover !== null) {
    failure("the unlocked board landed with its page menu already open");
  }
  if (unlocked.menusInDocument !== 0) {
    failure(`the closed page menu left ${unlocked.menusInDocument} menu(s) in the document`);
  }
  if (unlocked.lockItemsInDocument !== 0 || unlocked.addItemsInDocument !== 0) {
    failure(
      `the closed page menu left items in the document: ${JSON.stringify({
        lock: unlocked.lockItemsInDocument,
        add: unlocked.addItemsInDocument,
      })}`,
    );
  }
  if (unlocked.lock !== null || unlocked.add !== null) {
    failure("a closed page menu still read a lock or pin-board item");
  }
  // The trigger itself is measured. A menu with no trigger is a menu nobody can
  // open; a trigger that does not announce the menu fails a screen reader.
  const trigger = unlocked.trigger;
  if (!trigger) {
    failure("the page drew no page-menu trigger");
  } else {
    if (!trigger.isButton) failure(`the trigger is a ${trigger.tag}, not a button`);
    if (!String(trigger.className).split(/\s+/).includes("page-menu__trigger")) {
      failure(`the trigger's class read ${JSON.stringify(trigger.className)}`);
    }
    if (!String(trigger.className).split(/\s+/).includes("btn")) {
      failure(`the trigger does not wear the button primitive: ${JSON.stringify(trigger.className)}`);
    }
    if (trigger.haspopup !== "menu") {
      failure(`the trigger's aria-haspopup read ${JSON.stringify(trigger.haspopup)}`);
    }
    if (trigger.expanded !== "false") {
      failure(`the closed trigger's aria-expanded read ${JSON.stringify(trigger.expanded)}`);
    }
    if (trigger.label !== "Dashboard actions") {
      failure(`the trigger is named ${JSON.stringify(trigger.label)}`);
    }
    if (trigger.svgs !== 1) {
      failure(`the trigger drew ${trigger.svgs} svg(s), expected one`);
    }
    if (trigger.box.top > 120) {
      failure(`the trigger is not at the top: trigger top ${trigger.box.top}`);
    }
    if (trigger.box.right < trigger.viewportWidth / 2) {
      failure(
        `the trigger is not on the right: trigger right ${trigger.box.right} of ${trigger.viewportWidth}`,
      );
    }
  }
  // The badge is back beside the page's name: its box shares the heading's line,
  // on the left half of the page. A badge that drifted into the corner fails the
  // viewport half of this.
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
  if (unlocked.chrome === 0) failure("the unlocked board drew no pin chrome");
  if (unlocked.chromeButtons === 0) failure("the unlocked board's pin chrome has no buttons");
  if (unlocked.addPinRow) failure("the unlocked board landed with its pin board already open");
  if (unlocked.strayAddButtons !== 0) failure("the unlocked board landed with an Add-pin button drawn");

  // ── 2. the OPEN menu: the lock is its first item, the pin board its second ──
  await openMenu(win);
  const unlockedMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.unlockedMenu = unlockedMenu;
  if (unlockedMenu.trigger?.expanded !== "true") {
    failure(
      `the open menu's trigger read aria-expanded=${JSON.stringify(unlockedMenu.trigger?.expanded)}`,
    );
  }
  checkMenuGeometry(unlockedMenu, "unlocked menu");
  if (unlockedMenu.popover?.itemCount !== 2) {
    failure(
      `the unlocked menu offered ${unlockedMenu.popover?.itemCount} item(s): ${JSON.stringify(unlockedMenu.popover?.itemTestIds)}`,
    );
  }
  if (unlockedMenu.popover?.itemTestIds?.[0] !== "board-lock-toggle") {
    failure(
      `the menu's first item is ${JSON.stringify(unlockedMenu.popover?.itemTestIds?.[0])}, expected the lock`,
    );
  }
  if (unlockedMenu.popover?.itemTestIds?.[1] !== "board-add-toggle") {
    failure(
      `the menu's second item is ${JSON.stringify(unlockedMenu.popover?.itemTestIds?.[1])}, expected the pin board`,
    );
  }
  const unlockedLock = unlockedMenu.lock;
  if (!unlockedLock) {
    failure("the unlocked menu drew no lock item");
  } else {
    if (unlockedLock.role !== "menuitemcheckbox") {
      failure(`the lock item's role read ${JSON.stringify(unlockedLock.role)}`);
    }
    if (unlockedLock.checked !== "false") {
      failure(`the unlocked lock item read aria-checked=${JSON.stringify(unlockedLock.checked)}`);
    }
    if (unlockedLock.locked !== "false") {
      failure(`the unlocked lock item read data-locked=${JSON.stringify(unlockedLock.locked)}`);
    }
    if (unlockedLock.label !== "Lock this dashboard") {
      failure(`the unlocked lock item is named ${JSON.stringify(unlockedLock.label)}`);
    }
    if (unlockedLock.caption !== "Lock") {
      failure(`the unlocked lock item's caption read ${JSON.stringify(unlockedLock.caption)}`);
    }
    if (!unlockedLock.track || !unlockedLock.thumb) {
      failure("the lock item did not draw its track and thumb");
    }
    if (!unlockedLock.onTop) {
      failure("the lock item was painted under the page");
    }
  }
  const unlockedAdd = unlockedMenu.add;
  if (!unlockedAdd) {
    failure("the unlocked menu offered no pin-board item");
  } else {
    if (unlockedAdd.role !== "menuitem") {
      failure(`the pin-board item's role read ${JSON.stringify(unlockedAdd.role)}`);
    }
    if (!/^pin board$/i.test(unlockedAdd.caption)) {
      failure(`the pin-board item's caption read ${JSON.stringify(unlockedAdd.caption)}`);
    }
    if (unlockedAdd.expanded !== "false") {
      failure(
        `the closed pin-board item read aria-expanded=${JSON.stringify(unlockedAdd.expanded)}`,
      );
    }
    if (unlockedAdd.svgs !== 1) {
      failure(`the pin-board item drew ${unlockedAdd.svgs} svg(s), expected the lucide pin`);
    }
    if (!(unlockedAdd.icon ?? "").includes("lucide-pin")) {
      failure(`the pin-board item's icon read ${JSON.stringify(unlockedAdd.icon)}`);
    }
    if (unlockedAdd.checked !== null) {
      failure(`the pin-board item is a checkbox: aria-checked=${JSON.stringify(unlockedAdd.checked)}`);
    }
  }

  // ── 6a. Escape closes the menu and hands focus back to the trigger ─────────
  await pressEscape(win);
  const escaped = await win.webContents.executeJavaScript(SAMPLE);
  checks.escaped = escaped;
  if (escaped.popover !== null) failure("Escape did not close the page menu");
  if (escaped.trigger?.expanded !== "false") {
    failure(
      `Escape left the trigger reading aria-expanded=${JSON.stringify(escaped.trigger?.expanded)}`,
    );
  }
  if (escaped.lockItemsInDocument !== 0 || escaped.addItemsInDocument !== 0) {
    failure("Escape left the menu's items in the document");
  }
  if (escaped.activeElement?.testid !== "board-page-menu") {
    failure(
      `Escape did not hand focus back to the trigger: activeElement read ${JSON.stringify(escaped.activeElement)}`,
    );
  }

  // ── 6b. A press outside closes it ──────────────────────────────────────────
  await openMenu(win);
  const headingPoint = await pointAt(win, ".home-dashboard__title");
  // A real mouse press on the page behind the menu: `pointerdown` outside the
  // trigger's wrapper is what dismisses a popover.
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: Math.round(headingPoint.left + 2),
    y: Math.round(headingPoint.top + headingPoint.height / 2),
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: Math.round(headingPoint.left + 2),
    y: Math.round(headingPoint.top + headingPoint.height / 2),
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "a press outside to close the page menu",
  );
  const outsideClosed = await win.webContents.executeJavaScript(SAMPLE);
  checks.outsideClosed = outsideClosed;
  if (outsideClosed.popover !== null) failure("a press outside did not close the page menu");
  if (outsideClosed.trigger?.expanded !== "false") {
    failure(
      `the outside press left the trigger reading aria-expanded=${JSON.stringify(outsideClosed.trigger?.expanded)}`,
    );
  }

  // ── 6c. The trigger toggles ────────────────────────────────────────────────
  await openMenu(win);
  await click(win, '[data-testid="board-page-menu"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "a second press on the trigger to close the page menu",
  );
  const toggled = await win.webContents.executeJavaScript(SAMPLE);
  checks.toggled = toggled;
  if (toggled.trigger?.expanded !== "false") {
    failure("a second press on the trigger did not close the menu");
  }

  // ── 5. the pin board is the second item, and choosing it draws the row ─────
  await openMenu(win);
  await click(win, '[data-testid="board-add-toggle"]');
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="board-add-pin"]'))`,
    "the pin board to open from the menu",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the menu to close after choosing the pin board",
  );
  const openedPinBoard = await win.webContents.executeJavaScript(SAMPLE);
  checks.openedPinBoard = openedPinBoard;
  if (!openedPinBoard.addPinRow) failure("choosing Pin board did not draw the Add-pin row");
  if (openedPinBoard.strayAddButtons === 0) failure("the opened Add-pin row offered nothing to add");
  if (openedPinBoard.popover !== null) failure("choosing Pin board left the menu open");
  // The item reports the row's state while the menu is open: reopened, it says
  // "Hide pin board" and `aria-expanded="true"`.
  await openMenu(win);
  const addOpenMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.addOpenMenu = addOpenMenu;
  if (!/^hide pin board$/i.test(addOpenMenu.add?.caption ?? "")) {
    failure(
      `the open menu's pin-board item read ${JSON.stringify(addOpenMenu.add?.caption)}, expected "Hide pin board"`,
    );
  }
  if (addOpenMenu.add?.expanded !== "true") {
    failure(
      `the open pin board's menu item read aria-expanded=${JSON.stringify(addOpenMenu.add?.expanded)}`,
    );
  }
  // Choosing it again closes the menu first, then takes the row away.
  await click(win, '[data-testid="board-add-toggle"]');
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-add-pin"]')`,
    "the pin board to close from the menu",
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="board-page-menu-popover"]')`,
    "the menu to close after hiding the pin board",
  );
  const pinBoardClosed = await win.webContents.executeJavaScript(SAMPLE);
  checks.pinBoardClosed = pinBoardClosed;
  if (pinBoardClosed.addPinRow) failure("choosing Hide pin board left the Add-pin row open");
  if (pinBoardClosed.popover !== null) failure("choosing Hide pin board left the menu open");

  // ── 3. LOCKED: read-only, and the menu still leads with the lock ──────────
  const locked = await render(win, true);
  checks.locked = locked;
  if (locked.badge !== "Locked") {
    failure(`the locked board's badge read ${JSON.stringify(locked.badge)}`);
  }
  if (locked.badgeLocked !== "true") {
    failure(`the locked board's badge data-locked read ${JSON.stringify(locked.badgeLocked)}`);
  }
  if (!locked.trigger) {
    failure("a locked board lost its page-menu trigger, so it can never be unlocked");
  } else if (locked.trigger.expanded !== "false") {
    failure(`the locked board's trigger landed reading aria-expanded=${JSON.stringify(locked.trigger.expanded)}`);
  }
  if (locked.popover !== null) failure("a locked board landed with its menu open");
  if (locked.lockItemsInDocument !== 0 || locked.addItemsInDocument !== 0) {
    failure("a closed menu on a locked board left items in the document");
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

  await openMenu(win);
  const lockedMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.lockedMenu = lockedMenu;
  checkMenuGeometry(lockedMenu, "locked menu");
  if (lockedMenu.popover?.itemCount !== 1) {
    failure(
      `the locked menu offered ${lockedMenu.popover?.itemCount} item(s): ${JSON.stringify(lockedMenu.popover?.itemTestIds)}`,
    );
  }
  if (lockedMenu.popover?.itemTestIds?.[0] !== "board-lock-toggle") {
    failure("the locked menu's first item is not the lock");
  }
  // The locked board has no add path: the pin-board item is absent while the
  // menu is open — a closed menu is the only surface where it could hide.
  if (lockedMenu.add !== null) {
    failure("a locked board still offered the pin-board item in its menu");
  }
  const lockedLock = lockedMenu.lock;
  if (!lockedLock) {
    failure("the locked menu drew no lock item, so the board can never be unlocked");
  } else {
    if (lockedLock.role !== "menuitemcheckbox") {
      failure(`the locked lock item's role read ${JSON.stringify(lockedLock.role)}`);
    }
    if (lockedLock.checked !== "true") {
      failure(`the locked lock item read aria-checked=${JSON.stringify(lockedLock.checked)}`);
    }
    if (lockedLock.locked !== "true") {
      failure(`the locked lock item read data-locked=${JSON.stringify(lockedLock.locked)}`);
    }
    if (lockedLock.label !== "Unlock this dashboard") {
      failure(`the locked lock item is named ${JSON.stringify(lockedLock.label)}`);
    }
    if (lockedLock.caption !== "Lock") {
      failure(`the locked lock item's caption read ${JSON.stringify(lockedLock.caption)}`);
    }
    if (!lockedLock.track || !lockedLock.thumb) {
      failure("the locked lock item did not draw its track and thumb");
    }
    if (!lockedLock.onTop) {
      failure("the locked lock item was painted under the page");
    }
  }

  // ── 4. choosing the lock writes once and KEEPS the menu open ──────────────
  // Lock is on right now (sample 3), so the click must ask for locked:false.
  const locksBefore = await win.webContents.executeJavaScript(
    "(window.dashboardLockLockCalls ?? []).length",
  );
  await click(win, '[data-testid="board-lock-toggle"]');
  await waitFor(
    win,
    `(window.dashboardLockLockCalls ?? []).length > ${locksBefore}`,
    "the lock item to call the bridge",
  );
  await waitFor(
    win,
    `(() => { const b = document.querySelector('[data-testid="board-lock-badge"]'); return b && b.dataset.locked === 'false'; })()`,
    "the board to render unlocked after the click",
  );
  await waitFor(
    win,
    `(() => { const el = document.querySelector('[data-testid="board-lock-toggle"]'); return el && el.getAttribute('aria-checked') === 'false' && el.dataset.locked === 'false'; })()`,
    "the lock item to flip in place",
  );
  const afterLockClickMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.afterLockClickMenu = afterLockClickMenu;
  if (afterLockClickMenu.popover === null) {
    failure("choosing the lock closed the menu; the menu pattern must keep it open");
  }
  if (afterLockClickMenu.trigger?.expanded !== "true") {
    failure("the menu closed after the lock write: the trigger no longer reads aria-expanded=true");
  }
  if (afterLockClickMenu.lock?.checked !== "false") {
    failure(
      `the lock item still reads aria-checked=${JSON.stringify(afterLockClickMenu.lock?.checked)} after unlocking`,
    );
  }
  const calls = await win.webContents.executeJavaScript("window.dashboardLockLockCalls");
  checks.toggleCalls = calls;
  if (calls.length !== 1) failure(`the lock item called the bridge ${calls.length} times, expected 1`);
  if (calls[0]?.locked !== false) {
    failure(`unlocking sent locked=${JSON.stringify(calls[0]?.locked)}`);
  }
  if (calls[0]?.boardSlug !== null) {
    failure(`the Overview board was addressed as ${JSON.stringify(calls[0]?.boardSlug)}, expected null`);
  }
  // And the board behind the menu is editable again, while the menu stays open.
  if ((await win.webContents.executeJavaScript(
    `document.querySelectorAll(".home-pin__chrome").length`,
  )) === 0) {
    failure("unlocking did not restore the pin chrome");
  }

  // Dismiss with Escape, then read the page again: the unlocked board offers the
  // pin board as the menu's second item again.
  await pressEscape(win);
  const afterUnlockClick = await win.webContents.executeJavaScript(SAMPLE);
  checks.afterUnlockClick = afterUnlockClick;
  if (afterUnlockClick.popover !== null) failure("Escape did not close the menu after unlocking");
  if (afterUnlockClick.addPinRow !== false) {
    failure("unlocking left the pin board open on its own");
  }
  await openMenu(win);
  const restoredMenu = await win.webContents.executeJavaScript(SAMPLE);
  checks.restoredMenu = restoredMenu;
  if (restoredMenu.add === null) {
    failure("unlocking did not restore the pin board as the menu's second item");
  } else if (!/^pin board$/i.test(restoredMenu.add.caption ?? "")) {
    failure(`the restored pin-board item read ${JSON.stringify(restoredMenu.add.caption)}`);
  }
  await pressEscape(win);

  // ── 7. nothing unexpected, nothing on fire ────────────────────────────────
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
  // for; the UNLOCKED board is the one that carries the menu trigger; and the
  // OPEN menu is the contract this change introduced — lock first, pin board
  // second, anchored under the trigger at the page's top right.
  await render(win, false);
  await nextPaint(win);
  const unlockedImage = await win.webContents.capturePage();
  await openMenu(win);
  await nextPaint(win);
  const menuImage = await win.webContents.capturePage();
  await render(win, true);
  await nextPaint(win);

  const report = { pass: errors.length === 0, failures: errors, checks, samples: { unlocked, locked } };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-lock-ui-unlocked.png"),
    unlockedImage.toPNG(),
  );
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-lock-ui-menu.png"),
    menuImage.toPNG(),
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "dashboard-lock-ui.png"), image.toPNG());

  console.log(`unlocked: badge ${unlocked.badge}, trigger expanded ${unlocked.trigger?.expanded}, chrome ${unlocked.chrome}, menu ${unlocked.popover === null ? "closed" : "open"}`);
  console.log(`menu:     items ${JSON.stringify(unlockedMenu.popover?.itemTestIds)}, lock checked ${JSON.stringify(unlockedMenu.lock?.checked)} / caption ${JSON.stringify(unlockedMenu.lock?.caption)}`);
  console.log(`locked:   badge ${locked.badge}, items ${JSON.stringify(lockedMenu.popover?.itemTestIds)}, chrome ${locked.chrome}`);
  console.log(`toggle:   ${JSON.stringify(calls)} (menu stayed ${afterLockClickMenu.popover ? "open" : "closed"})`);
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
