/**
 * Drives the recurring-tasks feature's SHIPPED UI in a real Electron window and
 * turns what the pages actually render into
 * `e2e/artifacts/recurring-tasks.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`), or through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/recurring-tasks-e2e.test.ts`:
 *
 *   node e2e/recurring-tasks.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report and the screenshots are the
 * repeatable artifact.
 *
 * The claims, in the contract's order, and what makes each falsifiable:
 *
 *  1. `card-recurring`  — the real Today & this week card's Recurring block
 *                         leads the card: it is drawn ABOVE the Today and This
 *                         week groups (measured in the card's own box), and it
 *                         lists the overdue, due-today and this-week fixture
 *                         records with their state labels, the later and paused
 *                         fixtures are absent, and the heading count matches the
 *                         rows. The fixture dates are the run's own today, so
 *                         this holds on any day, and the expectation comes from
 *                         the harness (`window.recurringTasksExpectations`).
 *  2. `review-row`      — the built-in Weekly review row is drawn as a link to
 *                         `/review/weekly` with NO tick while its open period is
 *                         unfinished; a `?reviews=done` mount (the review is
 *                         marked done in the vault's review index) has no row.
 *  3. `card-tick`       — ticking the due-today row sends exactly one
 *                         `completeRecurring` for that id; the harness applies
 *                         the engine's rule; the row leaves the card; the real
 *                         Act page then reads the ADVANCED next-due date. A
 *                         `?write=refuse` mount prints the refusal on the card
 *                         in `.form-error[role="alert"]` and leaves the row in
 *                         place.
 *  4. `card-manage`     — "Manage recurring →" is a link to
 *                         `/act?manage=recurring`; pressing it reaches the real
 *                         Act page and its `recurring-section` is inside the
 *                         page's scrollport (the Dashboard's own promise).
 *  5. `manager-list`    — the Act page's Recurring tasks section lists EVERY
 *                         record (paused and later included) with the cadence
 *                         sentence, "Next due <date>", the Paused/Overdue
 *                         badges, and "Last done <date>" where there is history.
 *  6. `manager-create`  — Add → fill a title and a weekly Monday cadence → the
 *                         editor's own due-date default is the next Monday, and
 *                         Save sends exactly one `createRecurring` with that
 *                         recurrence and date; the new row appears with its
 *                         cadence and next-due line.
 *  7. `manager-pause`   — Pause sends one `updateRecurring { paused: true }`,
 *                         the badge reads Paused and the control says Resume;
 *                         Resume reverses it with one `{ paused: false }`.
 *  8. `manager-delete`  — Delete asks through the app's own confirmation
 *                         (title, title-naming message, Delete/Cancel) and sends
 *                         nothing until confirmed; Cancel sends nothing; the
 *                         confirmation sends exactly one `deleteRecurring` and
 *                         the row leaves.
 *  9. `clean`           — no console error and no unmodelled bridge call.
 *
 * NOT covered here: the engine and the MCP door (that is
 * `tests/recurring-engine-e2e.test.ts`), and the board's own columns (the
 * task-board rig owns those).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// A hidden window that stops painting stops firing requestAnimationFrame, and a
// rig that waits on a frame then hangs until its watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/recurring-tasks.html";

/** The contract's scenario order. The test wrapper asserts it exactly. */
const SCENARIO_ORDER = [
  "card-recurring",
  "review-row",
  "card-tick",
  "card-manage",
  "manager-list",
  "manager-create",
  "manager-pause",
  "manager-delete",
  "clean",
];

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

function waitFor(win, expression, label, timeoutMs = 15_000) {
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

/** Wait for a painted frame, with a floor — a hidden window may throttle rAF. */
function settleFrames(win) {
  return win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let frames = 0;
       const tick = () => { frames += 1; if (frames >= 3) resolve(true); else requestAnimationFrame(tick); };
       requestAnimationFrame(tick);
       setTimeout(() => resolve(false), 400);
     })`,
  );
}

function step(name) {
  console.log(`… ${name}`);
}

/** A real pointer press at the centre of a selector, after proving it is hit-testable. */
async function clickSelector(win, selector) {
  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "nearest", inline: "nearest" })`,
  );
  await settleFrames(win);
  await sleep(60);
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       const x = r.left + r.width / 2;
       const y = r.top + r.height / 2;
       const hit = document.elementFromPoint(x, y);
       return { x, y, lands: Boolean(hit && (hit === el || el.contains(hit))) };
     })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  if (!point.lands) throw new Error(`${selector} is not hit-testable at its centre`);
  win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(30);
  win.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(160);
}

async function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "char", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(100);
}

/** A React-controlled text field, set the way a user's typing would. */
function setField(win, testId, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    return true;
  })()`);
}

/** Pick a `<select>` option by its visible label, the way a person reads it. */
function setSelectByLabel(win, testId, label) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return { ok: false, error: "no element" };
    const option = [...el.options].find((entry) => entry.textContent.trim() === ${JSON.stringify(label)});
    if (!option) return { ok: false, error: "no option labelled " + ${JSON.stringify(label)} };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: option.value };
  })()`);
}

function fieldValue(win, testId) {
  return win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="${testId}"]')?.value ?? null`,
  );
}

function commands(win) {
  return win.webContents.executeJavaScript("window.recurringTasksCommands ?? []");
}

async function sample(win, expression, name) {
  const value = await win.webContents.executeJavaScript(expression);
  if (!value) throw new Error(`${name}: no sample`);
  return value;
}

// ── What the pages actually render ────────────────────────────────────────────
const CARD_SAMPLE = `(() => {
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const round = (n) => Math.round(n * 10) / 10;
  const rows = [...document.querySelectorAll('[data-testid^="recurring-row-"]')].map((row) => {
    const id = (row.getAttribute("data-testid") || "").slice("recurring-row-".length);
    const checkbox = row.querySelector('input[type="checkbox"]');
    const link = row.querySelector("a");
    const stateEl = row.querySelector('[class*="home-recurring-row__state"]');
    const titleEl = row.querySelector(".home-recurring-row__title") ?? link ?? row;
    return {
      id,
      title: text(titleEl),
      state: text(stateEl),
      stateClass: stateEl ? stateEl.className : null,
      dataState: row.getAttribute("data-state"),
      link: link ? link.getAttribute("href") : null,
      checkbox: checkbox
        ? { testid: checkbox.getAttribute("data-testid"), label: checkbox.getAttribute("aria-label") }
        : null,
      text: text(row),
    };
  });
  const list = document.querySelector('[data-testid^="recurring-row-"]')?.closest("ul") ?? null;
  const block = list ? list.parentElement : null;
  const heading = block ? block.querySelector("h2, h3, h4") : null;
  const headingText = text(heading);
  const countText =
    text(block?.querySelector('[class*="count"]')) ??
    (headingText ? (headingText.match(/\\d+/) || [null])[0] : null);
  const manage = document.querySelector('[data-testid="today-week-recurring-manage"]');
  const card = document.querySelector(".home-task-card");
  const cols = card ? card.querySelector(".home-task-cols") : null;
  let order = null;
  if (block && card) {
    const blockRect = block.getBoundingClientRect();
    const colsRect = cols ? cols.getBoundingClientRect() : null;
    const cardRect = card.getBoundingClientRect();
    order = {
      recurringTop: round(blockRect.top - cardRect.top),
      colsTop: colsRect ? round(colsRect.top - cardRect.top) : null,
      recurringFirst:
        colsRect !== null && blockRect.top + blockRect.height <= colsRect.top + 1,
    };
  }
  return {
    rows,
    headingText,
    countText,
    count: countText !== null && countText !== "" ? Number(countText) : null,
    manage: manage ? { href: manage.getAttribute("href"), text: text(manage) } : null,
    cardPresent: Boolean(card),
    order,
    blockText: text(block),
    alert: text(card?.querySelector('.home-form-error, .form-error[role="alert"]')),
    route: {
      home: Boolean(document.querySelector(".home-dashboard")),
      act: Boolean(document.querySelector(".act-page")),
    },
  };
})()`;

const MANAGER_SAMPLE = `(() => {
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const round = (n) => Math.round(n * 10) / 10;
  const section = document.querySelector('[data-testid="recurring-section"]');
  const rows = section
    ? [...section.querySelectorAll('[data-testid^="recurring-item-"]')].map((row) => {
        const id = (row.getAttribute("data-testid") || "").slice("recurring-item-".length);
        const badges = [...row.querySelectorAll('[class*="recurring-badge"]')].map((badge) => ({
          text: text(badge),
          cls: badge.className,
        }));
        const action = (prefix) => {
          const el = row.querySelector('[data-testid="' + prefix + id + '"]');
          return el ? { text: text(el), tag: el.tagName.toLowerCase() } : null;
        };
        return {
          id,
          text: text(row),
          name: text(row.querySelector(".recurring-item__name")),
          meta: text(row.querySelector(".recurring-item__meta")),
          badges,
          paused: row.getAttribute("data-paused") === "true",
          edit: action("recurring-edit-"),
          pause: action("recurring-pause-"),
          delete: action("recurring-delete-"),
        };
      })
    : [];
  const editor = document.querySelector('[data-testid="recurring-editor"]');
  const dialog = document.querySelector('[role="dialog"]');
  const scroller = document.querySelector(".shell__content");
  const scrollerRect = scroller ? scroller.getBoundingClientRect() : null;
  const sectionRect = section ? section.getBoundingClientRect() : null;
  const inViewport = Boolean(
    sectionRect &&
      sectionRect.top >= (scrollerRect ? scrollerRect.top : 0) - 1 &&
      sectionRect.top < (scrollerRect ? scrollerRect.bottom : window.innerHeight) &&
      sectionRect.bottom > (scrollerRect ? scrollerRect.top : 0),
  );
  const add = section?.querySelector('[data-testid="recurring-add"]');
  return {
    present: Boolean(section),
    heading: text(section?.querySelector("#recurring-section-title, h2")),
    count: text(section?.querySelector('[class*="count"]')),
    add: add ? { text: text(add), tag: add.tagName.toLowerCase() } : null,
    empty: text(section?.querySelector(".recurring-section__empty")),
    rows,
    alert: text(section?.querySelector('.form-error[role="alert"]')),
    editor: editor
      ? {
          present: true,
          title: text(editor.querySelector(".recurring-editor__title")),
          fields: {
            title: (() => {
              const el = editor.querySelector('[data-testid="recurring-title"]');
              return el ? el.value : null;
            })(),
            cadence: (() => {
              const el = editor.querySelector('[data-testid="recurring-cadence"]');
              return el ? { value: el.value, label: text(el.selectedOptions[0]) } : null;
            })(),
            weekday: (() => {
              const el = editor.querySelector('[data-testid="recurring-weekday"]');
              return el ? { value: el.value, label: text(el.selectedOptions[0]) } : null;
            })(),
            dueDate: (() => {
              const el = editor.querySelector('[data-testid="recurring-due-date"]');
              return el ? el.value : null;
            })(),
            link: (() => {
              const el = editor.querySelector('[data-testid="recurring-link"]');
              return el ? el.value : null;
            })(),
          },
          save: text(editor.querySelector('[data-testid="recurring-save"]')),
          cancel: text(editor.querySelector('[data-testid="recurring-cancel"]')),
        }
      : null,
    dialog: dialog
      ? {
          role: dialog.getAttribute("role"),
          modal: dialog.getAttribute("aria-modal"),
          title: text(dialog.querySelector(".confirm-dialog__title")),
          message: text(dialog.querySelector(".confirm-dialog__message")),
          confirm: text(dialog.querySelector(".confirm-dialog__confirm")),
          cancel: text(dialog.querySelector(".confirm-dialog__cancel")),
        }
      : null,
    sectionRect: sectionRect
      ? {
          top: round(sectionRect.top),
          bottom: round(sectionRect.bottom),
          height: round(sectionRect.height),
        }
      : null,
    viewport: scrollerRect
      ? { top: round(scrollerRect.top), bottom: round(scrollerRect.bottom), height: round(scrollerRect.height) }
      : { top: 0, bottom: window.innerHeight, height: window.innerHeight },
    inViewport,
    route: {
      home: Boolean(document.querySelector(".home-dashboard")),
      act: Boolean(document.querySelector(".act-page")),
    },
  };
})()`;

async function shoot(win, name) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await settleFrames(win);
  await sleep(200);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, name), image.toPNG());
    return true;
  } catch (error) {
    console.log(`[${name} skipped] ${error}`);
    return false;
  }
}

let loads = 0;

/** A fresh harness mount at `/home`, with the recurring rows settled. */
async function loadCard(win, query = "") {
  loads += 1;
  await win.loadURL(`${url}?v=${Date.now()}-${loads}${query}`);
  await waitFor(win, "Boolean(window.recurringTasksReady)", "recurringTasksReady");
  await waitFor(
    win,
    `document.querySelector(".home-task-card") !== null`,
    "the Today & this week card to render",
  );
  const expected = await win.webContents.executeJavaScript(
    "window.recurringTasksExpectations",
  );
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid^="recurring-row-"]').length === ${expected.card.count}`,
    "the card's recurring rows",
  );
  await settleFrames(win);
  await sleep(180);
  return expected;
}

const rowOf = (rows, id) => rows.find((row) => row.id === id) ?? null;

/** Filled once the window exists, so a crash can still say what the page logged. */
let activeWindow = null;
const consoleErrors = [];

/**
 * A run that throws mid-way still leaves an artifact: the claims that held, the
 * one that did not, the exception, and the console errors. A rig whose only
 * output on failure is an exit code makes the next run a guess.
 */
async function writeCrashReport(error) {
  const unexpectedBridgeCalls = [];
  if (activeWindow && !activeWindow.isDestroyed()) {
    try {
      const calls = await activeWindow.webContents.executeJavaScript(
        "window.recurringTasksUnexpectedCalls ?? []",
      );
      unexpectedBridgeCalls.push(...calls);
    } catch {
      // The page is gone; the report still records the exception.
    }
  }
  const report = {
    pass: false,
    failures: [...errors, String(error && error.stack ? error.stack : error)],
    what: "the shipped recurring-tasks UI — the driver stopped before every claim had run",
    scenarioOrder: SCENARIO_ORDER,
    error: String(error && error.stack ? error.stack : error),
    checks: { scenarios, unexpectedBridgeCalls, consoleErrors },
    generatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "recurring-tasks.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch (writeError) {
    console.error(`could not write the crash report: ${writeError}`);
  }
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: 1280,
    height: 1000,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `recurring-tasks-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(1280, 1000);
  win.showInactive();
  activeWindow = win;

  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  // ── 1. the card's Recurring block ───────────────────────────────────────────
  step("card-recurring");
  const first = await loadCard(win);
  const skin = await win.webContents.executeJavaScript(
    "({ name: window.recurringTasksSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  const card = await sample(win, CARD_SAMPLE, "card");
  const cardDetail = JSON.stringify({
    rows: card.rows.map((row) => [row.id, row.title, row.state, row.link]),
    count: card.count,
    manage: card.manage,
    order: card.order,
  });
  const cardRowsMatch = first.card.rows.every((expected) => {
    const row = rowOf(card.rows, expected.id);
    return (
      row !== null &&
      row.title === expected.title &&
      row.state === expected.label &&
      row.dataState === expected.state &&
      row.link === expected.link &&
      Boolean(row.checkbox) === expected.checkbox
    );
  });
  const absentMatch = first.card.absentIds.every((id) => rowOf(card.rows, id) === null);
  check(
    "card-recurring",
    card.cardPresent &&
      card.order?.recurringFirst === true &&
      card.rows.length === first.card.count &&
      cardRowsMatch &&
      absentMatch &&
      card.count === first.card.count &&
      card.manage?.href === first.card.manage.href &&
      card.manage?.text === first.card.manage.text,
    `${cardDetail}; expected the Recurring block to sit ABOVE the Today/This week
      groups and ${JSON.stringify({
      rows: first.card.rows.map((row) => [row.id, row.title, row.label, row.link]),
      count: first.card.count,
      absent: first.card.absentIds,
      manage: first.card.manage,
    })}`,
  );
  await shoot(win, "recurring-tasks-card.png");

  // ── 2. the built-in review row, and its absence once the review is done ────
  step("review-row");
  const weeklyRow = rowOf(card.rows, first.review.id);
  const doneMount = await loadCard(win, "&reviews=done");
  const doneCard = await sample(win, CARD_SAMPLE, "card-reviews-done");
  const doneWeeklyRow = rowOf(doneCard.rows, first.review.id);
  check(
    "review-row",
    first.review.expected &&
      weeklyRow !== null &&
      weeklyRow.title === first.review.title &&
      weeklyRow.link === first.review.link &&
      weeklyRow.checkbox === null &&
      weeklyRow.state !== null &&
      !doneMount.review.expected &&
      doneWeeklyRow === null &&
      doneCard.rows.length === doneMount.card.count,
    `before: ${JSON.stringify(weeklyRow)}; after ?reviews=done: ${JSON.stringify(
      doneWeeklyRow,
    )} with ${doneCard.rows.length} rows (expected ${doneMount.card.count})`,
  );

  // ── 3. a tick writes once, the row leaves, the manager reads the new date ──
  step("card-tick");
  const tickMount = await loadCard(win);
  const commandsBeforeTick = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-done-${tickMount.tick.id}"]`);
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-row-${tickMount.tick.id}"]') === null`,
    "the ticked row to leave the card",
  );
  const tickCommands = (await commands(win)).slice(commandsBeforeTick);
  const completeCommands = tickCommands.filter((command) => command.type === "completeRecurring");
  const tickedCard = await sample(win, CARD_SAMPLE, "card-after-tick");

  // The manager, reached through the card's own manage link, now reads the
  // advanced date for that record.
  await clickSelector(win, '[data-testid="today-week-recurring-manage"]');
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-item-${tickMount.tick.id}"]') !== null`,
    "the manager after the tick",
  );
  await settleFrames(win);
  await sleep(160);
  const tickedManager = await sample(win, MANAGER_SAMPLE, "manager-after-tick");
  const tickedRow = rowOf(tickedManager.rows, tickMount.tick.id);

  // A refused write is printed on the card, and the row stays.
  const refuseMount = await loadCard(win, "&write=refuse");
  const commandsBeforeRefusal = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-done-${refuseMount.tick.id}"]`);
  await waitFor(
    win,
    `Boolean(document.querySelector(".home-task-card .form-error[role=\\"alert\\"]"))`,
    "the refusal banner on the card",
  );
  const refusedCard = await sample(win, CARD_SAMPLE, "card-refused");
  const refusedCommands = (await commands(win)).slice(commandsBeforeRefusal).filter(
    (command) => command.type === "completeRecurring",
  );
  const refusedRow = rowOf(refusedCard.rows, refuseMount.tick.id);
  check(
    "card-tick",
    completeCommands.length === 1 &&
      completeCommands[0]?.id === tickMount.tick.id &&
      rowOf(tickedCard.rows, tickMount.tick.id) === null &&
      tickedRow !== null &&
      tickedRow.text.includes(tickMount.tick.afterDueLabel) &&
      refusedCommands.length === 1 &&
      refusedCommands[0]?.id === refuseMount.tick.id &&
      (refusedCard.alert ?? "").includes(refuseMount.writeError) &&
      refusedRow !== null,
    `tick commands ${JSON.stringify(completeCommands)}; after: row absent=` +
      `${rowOf(tickedCard.rows, tickMount.tick.id) === null}; manager row=` +
      `${JSON.stringify(tickedRow?.text)}; refused commands ${JSON.stringify(
        refusedCommands,
      )}; card alert=${JSON.stringify(refusedCard.alert)}; refused row present=` +
      `${refusedRow !== null}`,
  );

  // ── 4. the manage link reaches the real Act page ────────────────────────────
  step("card-manage");
  const manageMount = await loadCard(win);
  const manageCard = await sample(win, CARD_SAMPLE, "card-manage");
  await clickSelector(win, '[data-testid="today-week-recurring-manage"]');
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-section"]') !== null`,
    "the Act page's recurring section",
  );
  // The section is scrolled into view on mount; give the frame loop time.
  await settleFrames(win);
  await sleep(250);
  const managed = await sample(win, MANAGER_SAMPLE, "manager-managed");
  check(
    "card-manage",
    manageCard.manage?.href === manageMount.card.manage.href &&
      manageCard.manage?.text === manageMount.card.manage.text &&
      managed.present &&
      managed.route.act &&
      managed.inViewport,
    `link ${JSON.stringify(manageCard.manage)}; after press: present=${managed.present}, ` +
      `act=${managed.route.act}, section=${JSON.stringify(managed.sectionRect)}, ` +
      `viewport=${JSON.stringify(managed.viewport)}`,
  );

  // ── 5. the manager lists every record ──────────────────────────────────────
  step("manager-list");
  const manager = managed;
  const managerRowsMatch = first.manager.rows.every((expected) => {
    const row = rowOf(manager.rows, expected.id);
    return (
      row !== null &&
      row.name === expected.title &&
      (row.meta ?? "").includes(expected.cadence) &&
      (row.meta ?? "").includes(expected.dueLabel) &&
      (expected.paused ? (row.badges ?? []).some((badge) => badge.text === "Paused") : true) &&
      (expected.dueState
        ? (row.badges ?? []).some((badge) => badge.text === expected.dueState)
        : true) &&
      (expected.lastDone ? (row.text ?? "").includes(expected.lastDone) : !row.text.includes("Last done")) &&
      row.edit?.text === "Edit" &&
      row.delete?.text === "Delete" &&
      row.pause?.text === (expected.paused ? "Resume" : "Pause")
    );
  });
  check(
    "manager-list",
    manager.present &&
      manager.heading === "Recurring tasks" &&
      manager.count === String(first.manager.count) &&
      manager.rows.length === first.manager.count &&
      manager.add?.text === "Add recurring task" &&
      managerRowsMatch,
    `heading ${JSON.stringify(manager.heading)} count ${JSON.stringify(manager.count)} ` +
      `rows ${JSON.stringify(manager.rows.map((row) => [row.id, row.name, row.meta, row.badges.map((b) => b.text)]))}`,
  );
  await shoot(win, "recurring-tasks-manager.png");

  // ── 6. create from the manager's editor ────────────────────────────────────
  step("manager-create");
  await clickSelector(win, '[data-testid="recurring-add"]');
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-editor"]') !== null`,
    "the new-task editor",
  );
  await setField(win, "recurring-title", first.create.title);
  const cadencePicked = await setSelectByLabel(win, "recurring-cadence", first.create.cadenceLabel);
  if (!cadencePicked.ok) throw new Error(`could not choose the cadence: ${cadencePicked.error}`);
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-weekday"]') !== null`,
    "the weekly weekday field",
  );
  const weekdayPicked = await setSelectByLabel(win, "recurring-weekday", first.create.weekdayLabel);
  if (!weekdayPicked.ok) throw new Error(`could not choose the weekday: ${weekdayPicked.error}`);
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-due-date"]')?.value === ${JSON.stringify(first.create.dueIso)}`,
    "the editor's next-Monday due date",
  );
  const editorSample = await sample(win, MANAGER_SAMPLE, "editor");
  await shoot(win, "recurring-tasks-editor.png");
  const commandsBeforeCreate = (await commands(win)).length;
  await clickSelector(win, '[data-testid="recurring-save"]');
  await waitFor(win, `document.querySelector('[data-testid="recurring-editor"]') === null`, "the editor to close");
  const created = (await commands(win)).slice(commandsBeforeCreate);
  const createCommand = created.find((command) => command.type === "createRecurring");
  await waitFor(
    win,
    `document.querySelectorAll('[data-testid^="recurring-item-"]').length === ${first.manager.count + 1}`,
    "the new row to appear",
  );
  const createdManager = await sample(win, MANAGER_SAMPLE, "manager-after-create");
  const createdState = await win.webContents.executeJavaScript(
    "window.recurringTasksState()",
  );
  const createdRecord = (createdState.recurring ?? []).find(
    (item) => item.title === first.create.title,
  );
  const createdRow = createdRecord
    ? rowOf(createdManager.rows, createdRecord.id)
    : null;
  check(
    "manager-create",
    created.filter((command) => command.type === "createRecurring").length === 1 &&
      createCommand?.title === first.create.title &&
      JSON.stringify(createCommand?.recurrence) === JSON.stringify(first.create.recurrence) &&
      createCommand?.dueDate === first.create.dueIso &&
      editorSample.editor?.fields.dueDate === first.create.dueIso &&
      createdRecord !== undefined &&
      createdRow !== null &&
      (createdRow?.meta ?? "").includes("Every Monday") &&
      (createdRow?.meta ?? "").includes(first.create.dueLabel),
    `command ${JSON.stringify(createCommand)}; editor due=${JSON.stringify(
      editorSample.editor?.fields.dueDate,
    )}; expected due=${first.create.dueIso}; row=${JSON.stringify(createdRow?.meta)}`,
  );

  // ── 7. pause and resume ────────────────────────────────────────────────────
  step("manager-pause");
  const pauseId = first.pause.id;
  const commandsBeforePause = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-pause-${pauseId}"]`);
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-item-${pauseId}"]')?.textContent.includes("Paused")`,
    "the Paused badge",
  );
  const pausedCommands = (await commands(win))
    .slice(commandsBeforePause)
    .filter((command) => command.type === "updateRecurring");
  const pausedManager = await sample(win, MANAGER_SAMPLE, "manager-paused");
  const pausedRow = rowOf(pausedManager.rows, pauseId);
  const commandsBeforeResume = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-pause-${pauseId}"]`);
  await waitFor(
    win,
    `!document.querySelector('[data-testid="recurring-item-${pauseId}"]')?.textContent.includes("Paused")`,
    "the Paused badge to clear",
  );
  const resumedCommands = (await commands(win))
    .slice(commandsBeforeResume)
    .filter((command) => command.type === "updateRecurring");
  const resumedManager = await sample(win, MANAGER_SAMPLE, "manager-resumed");
  const resumedRow = rowOf(resumedManager.rows, pauseId);
  check(
    "manager-pause",
    pausedCommands.length === 1 &&
      pausedCommands[0]?.id === pauseId &&
      pausedCommands[0]?.paused === true &&
      pausedRow?.pause?.text === "Resume" &&
      (pausedRow?.badges ?? []).some((badge) => badge.text === "Paused") &&
      resumedCommands.length === 1 &&
      resumedCommands[0]?.id === pauseId &&
      resumedCommands[0]?.paused === false &&
      resumedRow?.pause?.text === "Pause" &&
      !(resumedRow?.badges ?? []).some((badge) => badge.text === "Paused"),
    `pause ${JSON.stringify(pausedCommands)} badge=${JSON.stringify(pausedRow?.badges)} ` +
      `control=${JSON.stringify(pausedRow?.pause)}; resume ${JSON.stringify(
        resumedCommands,
      )} badge=${JSON.stringify(resumedRow?.badges)} control=${JSON.stringify(resumedRow?.pause)}`,
  );

  // ── 8. delete asks first ───────────────────────────────────────────────────
  step("manager-delete");
  const deleteId = first.delete.id;
  const commandsBeforeDelete = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-delete-${deleteId}"]`);
  await waitFor(
    win,
    `document.querySelector('[role="dialog"]') !== null`,
    "the delete confirmation",
  );
  const asking = await sample(win, MANAGER_SAMPLE, "delete-confirm");
  const commandsWhileAsking = (await commands(win)).length;
  await clickSelector(win, ".confirm-dialog__cancel");
  await waitFor(win, `document.querySelector('[role="dialog"]') === null`, "the confirmation to close");
  const commandsAfterCancel = (await commands(win)).length;
  await clickSelector(win, `[data-testid="recurring-delete-${deleteId}"]`);
  await waitFor(
    win,
    `document.querySelector('[role="dialog"]') !== null`,
    "the delete confirmation (second time)",
  );
  await clickSelector(win, ".confirm-dialog__confirm");
  await waitFor(
    win,
    `document.querySelector('[data-testid="recurring-item-${deleteId}"]') === null`,
    "the deleted row to leave the manager",
  );
  const deleteCommands = (await commands(win))
    .slice(commandsBeforeDelete)
    .filter((command) => command.type === "deleteRecurring");
  const afterDelete = await sample(win, MANAGER_SAMPLE, "manager-after-delete");
  check(
    "manager-delete",
    asking.dialog?.role === "dialog" &&
      asking.dialog?.title === "Delete recurring task?" &&
      (asking.dialog?.message ?? "").includes(first.delete.title) &&
      asking.dialog?.confirm === "Delete" &&
      asking.dialog?.cancel === "Cancel" &&
      commandsWhileAsking === commandsBeforeDelete &&
      commandsAfterCancel === commandsBeforeDelete &&
      deleteCommands.length === 1 &&
      deleteCommands[0]?.id === deleteId &&
      rowOf(afterDelete.rows, deleteId) === null,
    `dialog ${JSON.stringify(asking.dialog)}; commands while asking=${commandsWhileAsking} ` +
      `(before ${commandsBeforeDelete}), after cancel=${commandsAfterCancel}; ` +
      `delete=${JSON.stringify(deleteCommands)}`,
  );

  // ── 9. nothing stray happened ─────────────────────────────────────────────
  step("clean");
  const unexpectedBridgeCalls = await win.webContents.executeJavaScript(
    "window.recurringTasksUnexpectedCalls",
  );
  const bridgeCalls = await win.webContents.executeJavaScript(
    "window.recurringTasksCalls",
  );
  check(
    "clean",
    consoleErrors.length === 0 && unexpectedBridgeCalls.length === 0,
    `console errors ${JSON.stringify(consoleErrors)}; unmodelled bridge calls ${JSON.stringify(
      unexpectedBridgeCalls,
    )}`,
  );

  // ── the artifact ──────────────────────────────────────────────────────────
  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "the shipped recurring-tasks UI: the Dashboard's Today & this week card listing the " +
      "overdue/due-today/this-week records with their labels and the built-in weekly review " +
      "row as an unticked link, a tick that writes one completeRecurring and leaves the row " +
      "(and prints a refused write on the card), the manage link reaching the real Act page's " +
      "recurring section, the manager listing every record with cadence/next-due/badges/" +
      "last-done, create with the editor's next-Monday default, pause/resume, and a delete " +
      "that asks before it writes",
    skin,
    scenarioOrder: SCENARIO_ORDER,
    reference: {
      today: first.today,
      weekStartDay: first.weekStartDay,
      weekEnd: first.weekEnd,
      now: first.now,
      reviewsDoneMount: "?reviews=done",
      writeRefuseMount: "?write=refuse",
    },
    checks: {
      scenarios,
      expectations: first,
      card: {
        first: card,
        afterTick: tickedCard,
        refused: refusedCard,
        reviewsDone: doneCard,
      },
      review: { before: weeklyRow, afterDone: doneWeeklyRow },
      tick: {
        commands: completeCommands,
        managerRow: tickedRow,
        refusedCommands,
        refusedAlert: refusedCard.alert,
      },
      manage: { link: manageCard.manage, afterPress: managed },
      manager: manager,
      create: {
        editor: editorSample.editor,
        command: createCommand ?? null,
        record: createdRecord ?? null,
        row: createdRow,
        commands: created,
      },
      pause: { paused: pausedCommands, pausedRow, resumed: resumedCommands, resumedRow },
      delete: { dialog: asking.dialog, commands: deleteCommands, survivedCancel: commandsAfterCancel === commandsBeforeDelete },
      bridgeCalls,
      unexpectedBridgeCalls,
      consoleErrors,
    },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "recurring-tasks.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  for (const scenario of scenarios) {
    console.log(
      `${scenario.name}: ${scenario.pass ? "PASS" : "FAIL"}${
        scenario.detail ? ` — ${scenario.detail}` : ""
      }`,
    );
  }
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch(async (error) => {
    console.error(error);
    await writeCrashReport(error);
    app.exit(1);
  });

setTimeout(async () => {
  const error = new Error("recurring-tasks rig timed out");
  console.error(error);
  await writeCrashReport(error);
  app.exit(1);
}, 180_000);
