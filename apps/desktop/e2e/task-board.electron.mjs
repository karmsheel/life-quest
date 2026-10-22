/**
 * Drives the Act page's task board in a real Electron window and turns what the
 * page actually renders into `e2e/artifacts/task-board.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/task-board.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report and the screenshots are the
 * repeatable artifact.
 *
 * The claims, and what makes each falsifiable:
 *
 *  1. `page-order`   — the page's header comes before the board. The board is the
 *                      page's working surface, not a thing above the page's name;
 *                      reading `.act-page`'s children in DOM order is the claim.
 *  2. `columns`      — four columns, in board order, each with its own dot, title
 *                      and count: Backlog 4, This week 2, Today 2, Done 1.
 *  3. `card-anatomy` — every card is a title, a 3-dot menu and its own metadata;
 *                      no card carries a bare Column select or a bare Delete on its
 *                      face, and the dangling goal says "Missing goal" in the
 *                      destructive ink. Card and column radii are the design's
 *                      `--radius-xs` / `--radius-sm` steps, not the old 4/6px.
 *  4. `menu`         — the 3-dot opens a `role="menu"` with Edit details and
 *                      Delete (last, destructive), a press outside closes it, and
 *                      Escape closes it and returns focus to its trigger.
 *  5. `delete`       — Delete is reached only through that menu, sends exactly one
 *                      `deleteTask`, and the card leaves the board as the vault
 *                      applies it — the Done column falls from 1 to 0.
 *  6. `edit-move`    — Edit details opens the card's editor, where the Column
 *                      select now lives; changing it sends one `updateTask` and
 *                      the card moves to that column.
 *  7. `create`       — typing a title and pressing Add task creates exactly one
 *                      backlog task and shows it on the board.
 *  8. `width-growth` — at every wider sheet the four columns get wider together,
 *                      and they stay equal. This is the reported "narrow at its
 *                      standard size" case, measured.
 *  9. `width-cap`    — past the board's own ceiling the columns stop growing even
 *                      though the sheet keeps expanding. "Up to a point" is a
 *                      number in the report, not an intention.
 * 10. `no-overflow`  — at every width the board fits its scroller: no column and
 *                      no card paints past the sheet.
 *
 * NOT covered here: the board's persistence beyond `mapApply` (that is
 * `map`'s own rig), and the agent composer on the rest of the page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/task-board.html";

/**
 * The sheet widths the board is judged at.
 *
 * The app's default window is 1280 wide, with a 4.25rem rail and a 22.5rem dock,
 * so the sheet it leaves the page is about 840px. `standard-sheet` is that case:
 * the width the operator called narrow. `expanded-sheet` and `wide-sheet` are the
 * dock collapsed or the window made larger. `capped-sheet` is wider than the
 * board's 90rem ceiling, so it is where "up to a point" is measured.
 */
const WIDTHS = [
  { name: "standard-sheet", width: 840, height: 1000 },
  { name: "expanded-sheet", width: 1180, height: 1000 },
  { name: "wide-sheet", width: 1600, height: 1000 },
  { name: "capped-sheet", width: 2000, height: 1000 },
];

const COLUMN_ORDER = ["backlog", "this-week", "today", "done"];
const COLUMN_LABELS = ["Backlog", "This week", "Today", "Done"];
const COLUMN_COUNTS = ["4", "2", "2", "1"];

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

/**
 * Everything one settled width says about the page and its board.
 *
 * The radii are read as computed pixels rather than as class names: the first
 * version of this board drew 4px cards inside 6px columns, and only a computed
 * value can tell that from the design's 6px/12px steps. The menu is read when it
 * is open; the card's own text is read always.
 */
const SAMPLE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const px = (value) => Number.parseFloat(value) || 0;
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height) };
  };
  const scroller = document.querySelector(".shell__content");
  const page = document.querySelector(".act-page");
  const board = document.querySelector(".task-board");
  const grid = document.querySelector(".task-columns");
  const gridStyle = grid ? getComputedStyle(grid) : null;
  const cards = [...document.querySelectorAll(".task-card")];

  const columns = [...document.querySelectorAll(".task-column")].map((col) => {
    const colStyle = getComputedStyle(col);
    const colCards = [...col.querySelectorAll(".task-list > li > .task-card")];
    return {
      id: col.dataset.column ?? null,
      label: text(col.querySelector(".task-column__title")),
      headerCount: text(col.querySelector(".task-column__count")),
      width: round(col.getBoundingClientRect().width),
      radius: px(colStyle.borderTopLeftRadius),
      background: colStyle.backgroundColor,
      cardCount: colCards.length,
      cards: colCards.map((card) => card.dataset.taskId ?? null),
    };
  });

  return {
    pageChildren: page
      ? [...page.children].map((el) => {
          const cls = typeof el.className === "string" ? el.className : "";
          if (cls.includes("act-page__header")) return "header";
          if (cls.includes("task-board")) return "board";
          return el.tagName.toLowerCase();
        })
      : [],
    page: rect(page),
    board: rect(board),
    grid: rect(grid),
    tracks: gridStyle ? gridStyle.gridTemplateColumns.trim().split(/\\s+/).map(px) : [],
    total: text(document.querySelector(".task-board__count")),
    heading: text(document.querySelector(".act-page__title")),
    scrollport: scroller
      ? {
          client: scroller.clientWidth,
          scroll: scroller.scrollWidth,
          overflowX: getComputedStyle(scroller).overflowX,
        }
      : null,
    bodyWidth: document.body.scrollWidth,
    columns,
    cards: cards.map((card) => {
      const style = getComputedStyle(card);
      const menu = card.querySelector('[data-testid="task-menu"]');
      const trigger = card.querySelector('[data-testid="task-menu-toggle"]');
      return {
        id: card.dataset.taskId ?? null,
        title: text(card.querySelector(".task-card__title")),
        titleTag: card.querySelector(".task-card__title")?.tagName.toLowerCase() ?? null,
        width: round(card.getBoundingClientRect().width),
        radius: px(style.borderTopLeftRadius),
        shadow: style.boxShadow,
        expanded: card.classList.contains("is-open"),
        chips: [...card.querySelectorAll(".task-chip")].map((chip) => ({
          label: text(chip),
          danger: chip.classList.contains("task-chip--danger"),
        })),
        notes: text(card.querySelector(".task-card__notes")),
        hasColumnSelect: Boolean(card.querySelector('select[aria-label$="column"]')),
        menuTrigger: trigger
          ? {
              label: trigger.getAttribute("aria-label"),
              haspopup: trigger.getAttribute("aria-haspopup"),
              expanded: trigger.getAttribute("aria-expanded"),
            }
          : null,
        menu: menu
          ? {
              role: menu.getAttribute("role"),
              items: [...menu.querySelectorAll('[role="menuitem"]')].map((item) => text(item)),
              testIds: [...menu.querySelectorAll('[role="menuitem"]')].map(
                (item) => item.getAttribute("data-testid"),
              ),
              danger: [...menu.querySelectorAll('[role="menuitem"]')]
                .filter((item) => item.classList.contains("task-card__menu-danger"))
                .map((item) => text(item)),
            }
          : null,
        // Delete must be reachable only after the 3-dot: a button saying Delete
        // that is not inside the menu is the old card face coming back.
        bareDeletes: [...card.querySelectorAll("button")].filter(
          (button) =>
            !button.closest('[role="menu"]') &&
            (button.textContent || "").trim() === "Delete",
        ).length,
      };
    }),
    menuCount: document.querySelectorAll('[data-testid="task-menu"]').length,
    activeLabel: document.activeElement?.getAttribute?.("data-testid") ?? null,
  };
})()`;

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
  await sleep(140);
}

async function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "char", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(100);
}

function sample(win, name) {
  return win.webContents.executeJavaScript(SAMPLE).then((value) => {
    if (!value) throw new Error(`${name}: no sample`);
    return value;
  });
}

const cardOf = (board, id) => board.cards.find((card) => card.id === id) ?? null;
const columnOf = (board, id) => board.columns.find((column) => column.id === id) ?? null;

let loads = 0;

/** A fresh Act page, one board, and the fixture's full task count. */
async function loadPage(win, query = "") {
  loads += 1;
  await win.loadURL(`${url}?v=${Date.now()}-${loads}${query}`);
  await waitFor(win, "Boolean(window.taskBoardReady)", "taskBoardReady");
  await waitFor(
    win,
    `document.querySelectorAll(".task-card").length === 9`,
    "the board to render its nine cards",
  );
  await waitFor(
    win,
    `document.querySelector(".task-board__count")?.textContent.trim() === "9"`,
    "the board's count to settle",
  );
  await settleFrames(win);
  await sleep(140);
}

/** Open one card's 3-dot menu and wait for its popup. */
async function openMenu(win, taskId) {
  await clickSelector(
    win,
    `[data-task-id="${taskId}"] [data-testid="task-menu-toggle"]`,
  );
  await waitFor(
    win,
    `document.querySelectorAll('[data-task-id="${taskId}"] [data-testid="task-menu"]').length === 1`,
    "the card's menu to open",
  );
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: WIDTHS[0].width,
    height: WIDTHS[0].height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `task-board-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await loadPage(win);

  const skin = await win.webContents.executeJavaScript(
    "({ name: window.taskBoardSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  check(
    "skin",
    Boolean(skin.name) && skin.applied === skin.name,
    `the harness painted ${JSON.stringify(skin)}`,
  );

  // ── The page's order, and the board's own anatomy at its standard width ─────
  step("standard-sheet");
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  await settleFrames(win);
  await sleep(160);
  const standard = await sample(win, "standard-sheet");

  check(
    "page-order",
    JSON.stringify(standard.pageChildren.slice(0, 2)) === JSON.stringify(["header", "board"]),
    `the Act page's first two children are ${JSON.stringify(standard.pageChildren.slice(0, 2))}`,
  );

  check(
    "columns",
    JSON.stringify(standard.columns.map((column) => column.id)) === JSON.stringify(COLUMN_ORDER) &&
      JSON.stringify(standard.columns.map((column) => column.label)) ===
        JSON.stringify(COLUMN_LABELS) &&
      JSON.stringify(standard.columns.map((column) => column.headerCount)) ===
        JSON.stringify(COLUMN_COUNTS) &&
      JSON.stringify(standard.columns.map((column) => column.cardCount)) ===
        JSON.stringify([4, 2, 2, 1]) &&
      standard.total === "9",
    `columns are ${JSON.stringify(
      standard.columns.map((column) => [column.id, column.label, column.headerCount, column.cardCount]),
    )} with total ${standard.total}`,
  );

  const brief = cardOf(standard, "t-brief");
  const legacy = cardOf(standard, "t-legacy");
  const missingGoal = legacy?.chips.find((chip) => chip.label === "Missing goal");
  const radii = (board) => {
    const card = board.cards[0];
    const column = board.columns[0];
    return { card: card?.radius, column: column?.radius };
  };
  const designRadii = radii(standard);
  check(
    "card-anatomy",
    standard.cards.length === 9 &&
      standard.cards.every(
        (card) =>
          card.title &&
          card.titleTag === "button" &&
          card.menuTrigger?.haspopup === "menu" &&
          card.menuTrigger?.expanded === "false" &&
          card.bareDeletes === 0 &&
          !card.hasColumnSelect,
      ) &&
      Boolean(brief?.notes) &&
      (brief?.chips.length ?? 0) >= 2 &&
      missingGoal?.danger === true &&
      designRadii.card === 6 &&
      designRadii.column === 12,
    `${standard.cards.length} card(s); radii card=${designRadii.card} column=${designRadii.column}; ` +
      `brief chips ${JSON.stringify(brief?.chips.map((chip) => chip.label))}; ` +
      `dangling chip ${JSON.stringify(missingGoal)}; ` +
      `bare deletes ${standard.cards.reduce((n, card) => n + card.bareDeletes, 0)}`,
  );

  // ── The menu holds the destructive action, and gets out of the way ──────────
  step("menu");
  await openMenu(win, "t-ship");
  const opened = await sample(win, "menu-open");
  const ship = cardOf(opened, "t-ship");
  check(
    "menu",
    opened.menuCount === 1 &&
      ship?.menuTrigger?.expanded === "true" &&
      ship?.menu?.role === "menu" &&
      JSON.stringify(ship?.menu?.items) === JSON.stringify(["Edit details", "Delete"]) &&
      JSON.stringify(ship?.menu?.testIds) ===
        JSON.stringify(["task-menu-edit", "task-menu-delete"]) &&
      JSON.stringify(ship?.menu?.danger) === JSON.stringify(["Delete"]),
    `menu is ${JSON.stringify(ship?.menu)} with trigger ${JSON.stringify(ship?.menuTrigger)}`,
  );

  // A press outside closes it. The board's heading is a harmless outside target.
  await clickSelector(win, ".task-board h2");
  await waitFor(win, `document.querySelectorAll('[data-testid="task-menu"]').length === 0`, "an outside press to close the menu");
  const afterOutside = await sample(win, "menu-outside");
  check(
    "menu-outside",
    afterOutside.menuCount === 0 &&
      cardOf(afterOutside, "t-ship")?.menuTrigger?.expanded === "false",
    `after the outside press ${afterOutside.menuCount} menu(s) are open`,
  );

  // Escape closes it too, and focus lands back on the 3-dot that opened it.
  await openMenu(win, "t-ship");
  await pressKey(win, "Escape");
  await waitFor(win, `document.querySelectorAll('[data-testid="task-menu"]').length === 0`, "Escape to close the menu");
  const afterEscape = await sample(win, "menu-escape");
  check(
    "menu-escape",
    afterEscape.menuCount === 0 && afterEscape.activeLabel === "task-menu-toggle",
    `after Escape: menus=${afterEscape.menuCount}, focus=${JSON.stringify(afterEscape.activeLabel)}`,
  );

  // ── Delete is one deliberate step behind the 3-dot, and it lands ────────────
  step("delete");
  const beforeDelete = await win.webContents.executeJavaScript("window.taskBoardCommands.length");
  await openMenu(win, "t-savings");
  await clickSelector(win, `[data-task-id="t-savings"] [data-testid="task-menu-delete"]`);
  await waitFor(
    win,
    `document.querySelectorAll('[data-task-id="t-savings"]').length === 0`,
    "the deleted card to leave the board",
  );
  await waitFor(
    win,
    `document.querySelector(".task-board__count")?.textContent.trim() === "8"`,
    "the board's count to fall after delete",
  );
  const afterDelete = await sample(win, "delete");
  const deleteCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeDelete);
  check(
    "delete",
    deleteCommands.length === 1 &&
      deleteCommands[0]?.type === "deleteTask" &&
      deleteCommands[0]?.id === "t-savings" &&
      afterDelete.total === "8" &&
      columnOf(afterDelete, "done")?.headerCount === "0" &&
      columnOf(afterDelete, "done")?.cardCount === 0,
    `delete sent ${JSON.stringify(deleteCommands)}; Done is now ` +
      `${JSON.stringify(columnOf(afterDelete, "done"))}`,
  );

  // ── Edit details opens the editor; the Column select lives there now ────────
  step("edit-move");
  await openMenu(win, "t-receipts");
  await clickSelector(win, `[data-task-id="t-receipts"] [data-testid="task-menu-edit"]`);
  await waitFor(
    win,
    `document.querySelector('[data-task-id="t-receipts"]')?.classList.contains("is-open")`,
    "the card's editor to open",
  );
  const editing = await sample(win, "edit-open");
  check(
    "edit-open",
    cardOf(editing, "t-receipts")?.expanded === true &&
      cardOf(editing, "t-receipts")?.hasColumnSelect === true,
    `editor open=${cardOf(editing, "t-receipts")?.expanded}, ` +
      `column select=${cardOf(editing, "t-receipts")?.hasColumnSelect}`,
  );

  const beforeMove = await win.webContents.executeJavaScript("window.taskBoardCommands.length");
  await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[data-task-id="t-receipts"] select[aria-label$="column"]');
    if (!select) return false;
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setValue.call(select, "today");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    win,
    `document.querySelector('[data-column="today"] [data-task-id="t-receipts"]') !== null`,
    "the moved card to land in Today",
  );
  const afterMove = await sample(win, "edit-move");
  const moveCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeMove);
  check(
    "edit-move",
    moveCommands.length === 1 &&
      moveCommands[0]?.type === "updateTask" &&
      moveCommands[0]?.id === "t-receipts" &&
      moveCommands[0]?.column === "today" &&
      columnOf(afterMove, "today")?.headerCount === "3" &&
      columnOf(afterMove, "backlog")?.headerCount === "3",
    `move sent ${JSON.stringify(moveCommands)}; Today=${columnOf(afterMove, "today")?.headerCount}, ` +
      `Backlog=${columnOf(afterMove, "backlog")?.headerCount}`,
  );

  // ── Create: the board's one entry point adds a backlog task ────────────────
  step("create");
  const beforeCreate = await win.webContents.executeJavaScript("window.taskBoardCommands.length");
  await clickSelector(win, ".task-create input");
  await win.webContents.insertText("Write the Friday note");
  await waitFor(
    win,
    `document.querySelector(".task-create input").value === "Write the Friday note"`,
    "the new task's title to be typed",
  );
  await clickSelector(win, ".task-create__add");
  await waitFor(
    win,
    `[...document.querySelectorAll('[data-column="backlog"] .task-card__title')].some((el) => el.textContent.trim() === "Write the Friday note")`,
    "the created card to appear in Backlog",
  );
  const afterCreate = await sample(win, "create");
  const createCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeCreate);
  check(
    "create",
    createCommands.length === 1 &&
      createCommands[0]?.type === "createTask" &&
      createCommands[0]?.title === "Write the Friday note" &&
      afterCreate.total === "9" &&
      columnOf(afterCreate, "backlog")?.headerCount === "4",
    `create sent ${JSON.stringify(createCommands)}; total=${afterCreate.total}, ` +
      `Backlog=${columnOf(afterCreate, "backlog")?.headerCount}`,
  );

  // ── Width: the columns grow with the page, then stop at the board's ceiling ─
  step("widths");
  await loadPage(win);
  const boards = [];
  for (const entry of WIDTHS) {
    win.setContentSize(entry.width, entry.height);
    await settleFrames(win);
    await sleep(180);
    boards.push({ name: entry.name, width: entry.width, board: await sample(win, entry.name) });
  }

  const standardBoard = boards.find((entry) => entry.name === "standard-sheet").board;
  const expandedBoard = boards.find((entry) => entry.name === "expanded-sheet").board;
  const wideBoard = boards.find((entry) => entry.name === "wide-sheet").board;
  const cappedBoard = boards.find((entry) => entry.name === "capped-sheet").board;
  const columnWidths = (board) => board.columns.map((column) => column.width);
  const spread = (widths) => Math.max(...widths) - Math.min(...widths);

  check(
    "width-growth",
    expandedBoard.page.width > standardBoard.page.width + 200 &&
      expandedBoard.columns[0].width > standardBoard.columns[0].width + 50 &&
      spread(columnWidths(standardBoard)) <= 1 &&
      spread(columnWidths(expandedBoard)) <= 1,
    `page ${standardBoard.page.width}→${expandedBoard.page.width}px; ` +
      `columns ${JSON.stringify(columnWidths(standardBoard))}→` +
      `${JSON.stringify(columnWidths(expandedBoard))}`,
  );

  check(
    "width-cap",
    cappedBoard.page.width > wideBoard.page.width + 200 &&
      Math.abs(cappedBoard.grid.width - wideBoard.grid.width) <= 1 &&
      spread(columnWidths(wideBoard)) <= 1 &&
      spread(columnWidths(cappedBoard)) <= 1 &&
      cappedBoard.columns.every((column) => column.width <= 361),
    `page ${wideBoard.page.width}→${cappedBoard.page.width}px but board ` +
      `${wideBoard.grid.width}→${cappedBoard.grid.width}px; ` +
      `columns ${JSON.stringify(columnWidths(wideBoard))}→` +
      `${JSON.stringify(columnWidths(cappedBoard))}`,
  );

  const spills = boards.flatMap((entry) => {
    const scroller = entry.board.scrollport;
    return scroller && scroller.scroll > scroller.client + 1
      ? [{ name: entry.name, scroll: scroller.scroll, client: scroller.client }]
      : [];
  });
  check(
    "no-overflow",
    spills.length === 0 &&
      boards.every(
        (entry) =>
          entry.board.board.width <= entry.board.page.width + 1 &&
          entry.board.grid.width <= entry.board.page.width + 1,
      ),
    `overflowing widths: ${JSON.stringify(spills)}`,
  );

  // ── Artifact: the board as the operator sees it, and its menu ──────────────
  step("artifact");
  await loadPage(win);
  fs.mkdirSync(artifactsDir, { recursive: true });

  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  await settleFrames(win);
  await sleep(180);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "task-board-standard.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board-standard.png skipped] ${error}`);
  }

  win.setContentSize(WIDTHS[1].width, WIDTHS[1].height);
  await settleFrames(win);
  await sleep(180);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "task-board.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board.png skipped] ${error}`);
  }

  await openMenu(win, "t-ship");
  await settleFrames(win);
  await sleep(150);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "task-board-menu.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board-menu.png skipped] ${error}`);
  }

  // The card's own details, where the column picker lives now.
  await clickSelector(win, `[data-task-id="t-ship"] [data-testid="task-menu-edit"]`);
  await waitFor(
    win,
    `document.querySelector('[data-task-id="t-ship"]')?.classList.contains("is-open")`,
    "the card's editor to open for the screenshot",
  );
  await settleFrames(win);
  await sleep(150);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "task-board-editor.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board-editor.png skipped] ${error}`);
  }

  // The same board in the day palette: the columns are wells on the page and the
  // cards step up, in both halves of the Dark Ladder.
  step("artifact-light");
  await loadPage(win, "&mode=light");
  win.setContentSize(WIDTHS[1].width, WIDTHS[1].height);
  await settleFrames(win);
  await sleep(180);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "task-board-light.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board-light.png skipped] ${error}`);
  }

  const unexpectedBridgeCalls = await win.webContents.executeJavaScript(
    "window.taskBoardUnexpectedCalls",
  );
  check(
    "clean",
    consoleErrors.length === 0 && unexpectedBridgeCalls.length === 0,
    `the page logged ${consoleErrors.length} error(s) and reached for ${unexpectedBridgeCalls.length} ` +
      `unmodelled bridge method(s)${unexpectedBridgeCalls.length ? `: ${unexpectedBridgeCalls.join(", ")}` : ""}`,
  );

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "the Act page's task board: header before board, four titled and counted columns, cards whose " +
      "destructive action sits one deliberate step behind a 3-dot menu, and columns that widen with " +
      "the sheet up to the board's own ceiling",
    skin,
    checks: {
      scenarios,
      widths: boards.map((entry) => ({
        name: entry.name,
        width: entry.width,
        pageWidth: entry.board.page.width,
        boardWidth: entry.board.board.width,
        gridWidth: entry.board.grid.width,
        tracks: entry.board.tracks,
        columns: entry.board.columns,
        total: entry.board.total,
        scrollport: entry.board.scrollport,
      })),
      dom: {
        pageChildren: standard.pageChildren,
        heading: standard.heading,
        cardCount: standard.cards.length,
        cardRadii: standard.cards.map((card) => card.radius),
        columnRadii: standard.columns.map((column) => column.radius),
        chips: standard.cards.map((card) => ({ id: card.id, chips: card.chips })),
        bareDeletes: standard.cards.reduce((n, card) => n + card.bareDeletes, 0),
        menu: ship?.menu ?? null,
      },
      unexpectedBridgeCalls,
      consoleErrors,
    },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "task-board.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  for (const entry of boards) {
    console.log(
      `${entry.name.padEnd(15)} ${entry.width}px window: page ${entry.board.page.width}px, ` +
        `columns ${JSON.stringify(columnWidths(entry.board))}, grid ${entry.board.grid.width}px`,
    );
  }
  for (const scenario of scenarios) {
    console.log(
      `${scenario.name}: ${scenario.pass ? "PASS" : "FAIL"}${scenario.detail ? ` — ${scenario.detail}` : ""}`,
    );
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
  console.error("task-board rig timed out");
  app.exit(1);
}, 120_000);
