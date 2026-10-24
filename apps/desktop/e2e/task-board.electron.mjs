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
 *  2. `columns`      — six columns, in board order, each with its own dot, title
 *                      and count: Done 1, In-progress 1, Today 2, This week 2,
 *                      Next 30 days 1, Backlog 4.
 *  2b. `page-trimmed` — the Strategy badge and the Execution brief section are
 *                      gone from the page, while the agent and activity sections
 *                      remain.
 *  7b. `drag-across`  — a real pointer drag carries a card from Backlog to Next
 *                      30 days, shows the ghost and the target column while it
 *                      is in the air, and releases exactly one `moveTask`.
 *  7c. `drag-reorder` — a drag within a column places the card before another
 *                      card and sends its id as `beforeId`.
 *  7d. `drag-cancel`  — Escape during a drag leaves the board untouched.
 *  7e. `column-add`   — a column's own Add control creates a card in that column,
 *                      not in Backlog.
 *  7f. `drag-scroll`  — at the standard sheet, where the last columns sit off
 *                      screen, holding a drag at the board's right edge scrolls
 *                      the board under the hand.
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
 *  8. `width-growth` — at every wider sheet the six columns get wider together,
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

const COLUMN_ORDER = [
  "done",
  "in-progress",
  "today",
  "this-week",
  "next-30-days",
  "backlog",
];
const COLUMN_LABELS = [
  "Done",
  "In-progress",
  "Today",
  "This week",
  "Next 30 days",
  "Backlog",
];
const COLUMN_COUNTS = ["1", "1", "2", "2", "1", "4"];

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
  const viewport = document.querySelector(".task-board__viewport");
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
    alignmentBadge: Boolean(document.querySelector(".act-page__alignment-badge")),
    briefSection: Boolean(document.querySelector(".act-brief")),
    sectionTitles: [...document.querySelectorAll(".act-page__section-title")].map(text),
    taskPageText: page ? (page.textContent || "").includes("Execution brief") : false,
    dragGhost: Boolean(document.querySelector(".task-drag-ghost")),
    dropTargetColumn:
      document.querySelector(".task-column.is-drop-target")?.dataset.column ?? null,
    draggingIds: [...document.querySelectorAll(".task-card.is-dragging")].map(
      (card) => card.dataset.taskId ?? null,
    ),
    page: rect(page),
    board: rect(board),
    grid: rect(grid),
    viewport: viewport
      ? {
          ...rect(viewport),
          client: viewport.clientWidth,
          scroll: viewport.scrollWidth,
          scrollLeft: round(viewport.scrollLeft),
          overflowX: getComputedStyle(viewport).overflowX,
        }
      : null,
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
  // The board scrolls sideways at the standard sheet, so a control in a far
  // column may exist but be off-viewport. A person scrolls it into reach; the
  // rig does the same before it measures the point.
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
  await sleep(140);
}

async function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "char", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(100);
}

function mouse(win, type, x, y) {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
}

/** A point on an element that really is on top at that point. */
async function pointOn(win, selector, across = 0.5, down = 0.5) {
  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "nearest", inline: "nearest" })`,
  );
  await settleFrames(win);
  await sleep(60);
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return { error: "no element" };
       const r = el.getBoundingClientRect();
       const x = r.left + r.width * ${across};
       const y = r.top + r.height * ${down};
       const hit = document.elementFromPoint(x, y);
       return { x, y, lands: Boolean(hit && (hit === el || el.contains(hit))) };
     })()`,
  );
  if (!point || point.error) throw new Error(`no element for ${selector}`);
  if (!point.lands) throw new Error(`${selector} is not hit-testable at its centre`);
  return point;
}

/** A point inside a column: above a named card, or below its last card. */
async function dropPoint(win, column, beforeId = null) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const col = document.querySelector('[data-column="${column}"]');
       if (!col) return { error: "no column" };
       const box = col.getBoundingClientRect();
       const x = box.left + box.width / 2;
       const cards = [...col.querySelectorAll(".task-list > li > .task-card")];
       if (${JSON.stringify(beforeId)} != null) {
         const card = document.querySelector('[data-task-id="${beforeId}"]');
         if (!card) return { error: "no before card" };
         const r = card.getBoundingClientRect();
         return { x, y: r.top + 2 };
       }
       const last = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
       const y = last
         ? Math.min(last.bottom + 12, box.top + box.height - 10)
         : box.top + Math.min(70, box.height - 10);
       return { x, y };
     })()`,
  );
  if (!point || point.error) throw new Error(`no drop point in ${column}: ${point?.error}`);
  return point;
}

/** Press a card and move far enough that the board lifts it. */
async function beginDrag(win, taskId) {
  const source = await pointOn(win, `[data-task-id="${taskId}"] .task-card__title`);
  mouse(win, "mouseDown", source.x, source.y);
  mouse(win, "mouseMove", source.x + 12, source.y + 12);
  await waitFor(
    win,
    `document.querySelector('[data-task-id="${taskId}"]')?.classList.contains("is-dragging")`,
    `${taskId} to lift`,
  );
  await settleFrames(win);
  return source;
}

/** Carry the lifted card to a point in steps, the way a hand travels. */
async function moveDrag(win, source, target, steps = 4) {
  const from = { x: source.x + 12, y: source.y + 12 };
  for (let step = 1; step <= steps; step += 1) {
    mouse(
      win,
      "mouseMove",
      from.x + ((target.x - from.x) * step) / steps,
      from.y + ((target.y - from.y) * step) / steps,
    );
    await sleep(35);
  }
  await settleFrames(win);
}

/** Release a drag and return the commands it produced. */
async function dropDrag(win, taskId, target) {
  const before = await win.webContents.executeJavaScript(
    "window.taskBoardCommands.length",
  );
  mouse(win, "mouseUp", target.x, target.y);
  await waitFor(
    win,
    `!document.querySelector('[data-task-id="${taskId}"]')?.classList.contains("is-dragging")`,
    "the drag to end",
  );
  await sleep(160);
  return (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(before);
}

async function dragTask(win, taskId, column, beforeId = null) {
  const source = await beginDrag(win, taskId);
  const target = await dropPoint(win, column, beforeId);
  await moveDrag(win, source, target);
  const commands = await dropDrag(win, taskId, target);
  return { source, target, commands };
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
    `document.querySelectorAll(".task-card").length === 11`,
    "the board to render its eleven cards",
  );
  await waitFor(
    win,
    `document.querySelector(".task-board__count")?.textContent.trim() === "11"`,
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
    "page-trimmed",
    !standard.alignmentBadge &&
      !standard.briefSection &&
      !standard.taskPageText &&
      JSON.stringify(standard.sectionTitles) ===
        JSON.stringify(["Run an agent", "Recent activity"]),
    `badge=${standard.alignmentBadge}, brief=${standard.briefSection}, ` +
      `text=${standard.taskPageText}, sections=${JSON.stringify(standard.sectionTitles)}`,
  );

  check(
    "columns",
    JSON.stringify(standard.columns.map((column) => column.id)) === JSON.stringify(COLUMN_ORDER) &&
      JSON.stringify(standard.columns.map((column) => column.label)) ===
        JSON.stringify(COLUMN_LABELS) &&
      JSON.stringify(standard.columns.map((column) => column.headerCount)) ===
        JSON.stringify(COLUMN_COUNTS) &&
      JSON.stringify(standard.columns.map((column) => column.cardCount)) ===
        JSON.stringify([1, 1, 2, 2, 1, 4]) &&
      standard.total === "11",
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
    standard.cards.length === 11 &&
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
    `document.querySelector(".task-board__count")?.textContent.trim() === "10"`,
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
      afterDelete.total === "10" &&
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
      afterCreate.total === "11" &&
      columnOf(afterCreate, "backlog")?.headerCount === "4",
    `create sent ${JSON.stringify(createCommands)}; total=${afterCreate.total}, ` +
      `Backlog=${columnOf(afterCreate, "backlog")?.headerCount}`,
  );

  // ── The drag: across two columns, within one, and one cancelled mid-air ────
  // The sheet is expanded first: six columns need the room, and a drag across
  // two of them should not be judged at the narrowest width the board supports.
  win.setContentSize(WIDTHS[1].width, WIDTHS[1].height);
  await settleFrames(win);
  await sleep(180);

  step("drag-across");
  const source = await beginDrag(win, "t-brief");
  const monthTarget = await dropPoint(win, "next-30-days", "t-month");
  await moveDrag(win, source, monthTarget);
  const inFlight = await sample(win, "drag-in-flight");
  try {
    const image = await win.webContents.capturePage();
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, "task-board-drag.png"), image.toPNG());
  } catch (error) {
    console.log(`[task-board-drag.png skipped] ${error}`);
  }
  const acrossCommands = await dropDrag(win, "t-brief", monthTarget);
  await waitFor(
    win,
    `document.querySelector('[data-column="next-30-days"] [data-task-id="t-brief"]') !== null`,
    "the dragged card to land in Next 30 days",
  );
  const across = await sample(win, "drag-across");
  check(
    "drag-across",
    inFlight.dragGhost === true &&
      inFlight.dropTargetColumn === "next-30-days" &&
      JSON.stringify(inFlight.draggingIds) === JSON.stringify(["t-brief"]) &&
      acrossCommands.length === 1 &&
      acrossCommands[0]?.type === "moveTask" &&
      acrossCommands[0]?.id === "t-brief" &&
      acrossCommands[0]?.column === "next-30-days" &&
      acrossCommands[0]?.beforeId === "t-month" &&
      JSON.stringify(columnOf(across, "next-30-days")?.cards) ===
        JSON.stringify(["t-brief", "t-month"]) &&
      columnOf(across, "next-30-days")?.headerCount === "2" &&
      columnOf(across, "backlog")?.headerCount === "3",
    `flight ${JSON.stringify({
      ghost: inFlight.dragGhost,
      target: inFlight.dropTargetColumn,
      dragging: inFlight.draggingIds,
    })}; ` +
      `commands ${JSON.stringify(acrossCommands)}; ` +
      `month ${JSON.stringify(columnOf(across, "next-30-days"))}; ` +
      `backlog ${columnOf(across, "backlog")?.headerCount}`,
  );

  step("drag-reorder");
  const reorderSource = await beginDrag(win, "t-legacy");
  const reorderTarget = await dropPoint(win, "backlog", "t-banking");
  await moveDrag(win, reorderSource, reorderTarget);
  const reorderCommands = await dropDrag(win, "t-legacy", reorderTarget);
  await waitFor(
    win,
    `document.querySelector('[data-column="backlog"] .task-list > li:first-child [data-task-id="t-legacy"]') !== null`,
    "the reordered card to lead Backlog",
  );
  const reordered = await sample(win, "drag-reorder");
  check(
    "drag-reorder",
    reorderCommands.length === 1 &&
      reorderCommands[0]?.type === "moveTask" &&
      reorderCommands[0]?.id === "t-legacy" &&
      reorderCommands[0]?.column === "backlog" &&
      reorderCommands[0]?.beforeId === "t-banking" &&
      JSON.stringify(columnOf(reordered, "backlog")?.cards) ===
        JSON.stringify(["t-legacy", "t-banking", "t-new-1"]),
    `commands ${JSON.stringify(reorderCommands)}; ` +
      `backlog order ${JSON.stringify(columnOf(reordered, "backlog")?.cards)}`,
  );

  step("drag-cancel");
  const beforeCancel = await win.webContents.executeJavaScript(
    "window.taskBoardCommands.length",
  );
  const cancelSource = await beginDrag(win, "t-landlord");
  const cancelTarget = await dropPoint(win, "today");
  await moveDrag(win, cancelSource, cancelTarget);
  await pressKey(win, "Escape");
  await waitFor(
    win,
    `document.querySelector('[data-task-id="t-landlord"]')?.classList.contains("is-dragging") !== true`,
    "Escape to end the drag",
  );
  mouse(win, "mouseUp", cancelTarget.x, cancelTarget.y);
  await sleep(160);
  const cancelCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeCancel);
  const cancelled = await sample(win, "drag-cancel");
  check(
    "drag-cancel",
    cancelCommands.length === 0 &&
      !cancelled.dragGhost &&
      JSON.stringify(columnOf(cancelled, "this-week")?.cards) ===
        JSON.stringify(["t-ship", "t-landlord"]),
    `cancel commands ${JSON.stringify(cancelCommands)}; ` +
      `week ${JSON.stringify(columnOf(cancelled, "this-week")?.cards)}`,
  );

  // ── A column's own Add control creates in that column, not in Backlog ──────
  step("column-add");
  const beforeColumnAdd = await win.webContents.executeJavaScript(
    "window.taskBoardCommands.length",
  );
  await clickSelector(win, '[data-column="next-30-days"] .task-column__add');
  await waitFor(
    win,
    `document.querySelector('[data-column="next-30-days"] .task-composer input') !== null`,
    "the Next 30 days composer to open",
  );
  await clickSelector(win, '[data-column="next-30-days"] .task-composer input');
  await win.webContents.insertText("Book the accountant");
  await clickSelector(win, '[data-column="next-30-days"] .task-composer__add');
  await waitFor(
    win,
    `[...document.querySelectorAll('[data-column="next-30-days"] .task-card__title')].some((el) => el.textContent.trim() === "Book the accountant")`,
    "the column-created card to appear in Next 30 days",
  );
  const added = await sample(win, "column-add");
  const columnAddCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeColumnAdd);
  check(
    "column-add",
    columnAddCommands.length === 1 &&
      columnAddCommands[0]?.type === "createTask" &&
      columnAddCommands[0]?.title === "Book the accountant" &&
      columnAddCommands[0]?.column === "next-30-days" &&
      columnOf(added, "next-30-days")?.headerCount === "3" &&
      columnOf(added, "backlog")?.headerCount === "3",
    `column add sent ${JSON.stringify(columnAddCommands)}; ` +
      `month=${columnOf(added, "next-30-days")?.headerCount}, ` +
      `backlog=${columnOf(added, "backlog")?.headerCount}`,
  );

  // ── The standard sheet scrolls the board under a drag at its edge ──────────
  step("drag-scroll");
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  await settleFrames(win);
  await sleep(180);
  const beforeScroll = await win.webContents.executeJavaScript(
    "window.taskBoardCommands.length",
  );
  const scrollViewport = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(".task-board__viewport");
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollLeft: el.scrollLeft };
     })()`,
  );
  if (!scrollViewport) throw new Error("the board has no scroll viewport");
  // Start at the left edge, where Done and Today are visible. A card from one
  // of those columns can then be carried to the right edge, and only the
  // auto-scroll loop can move the board toward the off-screen backlog.
  await win.webContents.executeJavaScript(
    `document.querySelector(".task-board__viewport").scrollLeft = 0`,
  );
  await settleFrames(win);
  const scrollSource = await beginDrag(win, "t-tax");
  const startScroll = await win.webContents.executeJavaScript(
    `document.querySelector(".task-board__viewport").scrollLeft`,
  );
  await moveDrag(win, scrollSource, {
    x: scrollViewport.right - 8,
    y: scrollViewport.top + 120,
  });
  // The hand now holds still at the edge: only the auto-scroll loop can move
  // the board, which is exactly the claim.
  await sleep(420);
  const scrolled = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(".task-board__viewport");
       return el ? { scrollLeft: el.scrollLeft, scroll: el.scrollWidth, client: el.clientWidth } : null;
     })()`,
  );
  await pressKey(win, "Escape");
  await waitFor(
    win,
    `document.querySelector('[data-task-id="t-tax"]')?.classList.contains("is-dragging") !== true`,
    "Escape to end the auto-scroll drag",
  );
  mouse(win, "mouseUp", scrollViewport.right - 8, scrollViewport.top + 120);
  await sleep(160);
  const scrollCommands = (
    await win.webContents.executeJavaScript("window.taskBoardCommands")
  ).slice(beforeScroll);
  check(
    "drag-scroll",
    (scrolled?.scrollLeft ?? 0) > startScroll + 20 &&
      (scrolled?.scroll ?? 0) > (scrolled?.client ?? 0) &&
      scrollCommands.length === 0,
    `board ${JSON.stringify(scrolled)} from ${startScroll}; ` +
      `commands ${JSON.stringify(scrollCommands)}`,
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
      expandedBoard.columns[0].width > standardBoard.columns[0].width + 5 &&
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

  // The page itself never scrolls sideways; the board's own viewport carries
  // the overflow at the standard sheet, and is still once the sheet is wide
  // enough for all six readable columns.
  const spills = boards.flatMap((entry) => {
    const scroller = entry.board.scrollport;
    return scroller && scroller.scroll > scroller.client + 1
      ? [{ name: entry.name, scroll: scroller.scroll, client: scroller.client }]
      : [];
  });
  const standardViewport = standardBoard.viewport;
  const expandedViewport = expandedBoard.viewport;
  check(
    "no-overflow",
    spills.length === 0 &&
      boards.every((entry) => {
        const viewport = entry.board.viewport;
        return (
          viewport &&
          entry.board.board.width <= entry.board.page.width + 1 &&
          viewport.width <= entry.board.page.width + 1 &&
          viewport.scroll >= viewport.client
        );
      }) &&
      Boolean(standardViewport) &&
      (standardViewport?.scroll ?? 0) > (standardViewport?.client ?? 0) + 20 &&
      (standardViewport?.overflowX === "auto" || standardViewport?.overflowX === "scroll") &&
      Boolean(expandedViewport) &&
      (expandedViewport?.scroll ?? 0) <= (expandedViewport?.client ?? 0) + 1,
    `page spills: ${JSON.stringify(spills)}; ` +
      `standard board ${JSON.stringify(standardViewport)}; ` +
      `expanded board ${JSON.stringify(expandedViewport)}`,
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
      "the Act page's task board: header before board, six titled and counted columns through " +
      "In-progress and Next 30 days, cards that can be dragged across columns or reordered in place, columns " +
      "that widen with the sheet up to the board's own ceiling, and a page without the Strategy badge " +
      "or Execution brief",
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
        viewport: entry.board.viewport,
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
