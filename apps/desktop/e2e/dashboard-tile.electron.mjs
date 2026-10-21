/**
 * Drives the dashboard-tile harness in a real Electron window and turns what the
 * board actually does into `e2e/artifacts/dashboard-tile.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-tile.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report is the repeatable artifact.
 *
 * THE FAULTS THIS RIG IS AIMED AT (both reported, then measured in the operator's
 * own vault):
 *
 *   "The tables can change size but when made smaller they often compress beyond
 *    the data they hold, causing it to spill over."
 *
 * The "Recent transactions" card holds a four-column listing, every cell of it
 * nowrap, and was pinned ONE cell wide. A table does not shrink below its own
 * min-content width, so it painted outside the card's frame.
 *
 *   "Some tables are still showing lots of empty space — the space between the
 *    Category and Amount columns is too much."
 *
 * Sizing a card in whole 17rem cells is a coarse instrument: that same card needs
 * 348px and the next cell up is 605px, so 225px of leftover was handed to a card
 * whose table was then told to fill it, and the table spent the difference
 * between its columns — which is the hole, right where the money column begins.
 *
 * The claims, and what makes each falsifiable:
 *
 *  1. `no-spill`      — no part of any card is drawn outside that card's frame,
 *                       at every width the board is asked to draw at. This is the
 *                       first fault stated as a measurement: the rig walks every
 *                       descendant of every card and compares it with the card's
 *                       own box. On the pre-fix build the listing's cells hang
 *                       out of their card by tens of pixels and this fails.
 *  2. `card-fits-its-table` — the second fault, as two numbers: a listing draws at
 *                       the width its columns need (it is not stretched to fill
 *                       its card), and the card around it is within one layout
 *                       step of that width. The one-number metric is the control:
 *                       its content needs almost nothing, and it must not come out
 *                       as wide as the listing beside it.
 *  3. `operator-card` — the operator's OWN card, row for row out of their vault,
 *                       holds its cells and is wider than the metric. The reported
 *                       case, with the reported data, rather than a fixture the
 *                       rig made up to be wide.
 *  4. `rows-mix`      — two lines of the board hold different numbers of cards
 *                       (three on one line, two on another), which is the
 *                       arrangement the operator asked for by name.
 *  5. `row-card`      — a card the operator stored across the row is drawn across
 *                       the whole row, at every width. The control that stops
 *                       "everything is as wide as its content" from passing.
 *  6. `board-floors`  — a window too small for the board's units gets a board that
 *                       is wider than the window, every track at least one unit,
 *                       every card at least one minimum card, and the sheet's own
 *                       scroller taking the overflow sideways. A card is never the
 *                       thing that gives way.
 *  7. `stable`        — a content-sized card draws in the same number of units at
 *                       every width, and coming back to a width reproduces it
 *                       exactly: a board measured against its own tracks would
 *                       oscillate between two answers, and this is the claim that
 *                       says it does not.
 *  8. `no-write`      — the board sized itself without asking the vault for
 *                       anything. A width is geometry, not a pin edit.
 *  9. Edit mode       — `edit-no-icon`, `edit-menu`, `edit-width-drag`,
 *                       `edit-width-survives-a-reload`, `edit-height-drag`,
 *                       `edit-height-survives-a-reload`,
 *                       `edit-width-floor-is-the-content`, `edit-drag-row`,
 *                       `edit-keys-step`, `edit-outside-exits`,
 *                       `edit-escape-exits`, `edit-is-not-arrange`: the Fill-the-row
 *                       icon is gone, Edit card is in the 3-dot menu, the right and
 *                       bottom borders drag a size onto the pin, and a press
 *                       outside the card ends the mode.
 *
 * NOT covered here: dragging a card (that is `dashboard-arrange`), a card the
 * companion edits keeping its place (that is `dashboard-card-slot`), and anything
 * about what the numbers in a card mean (that is `dashboard-views`).
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-tile.html";

/**
 * The three widths the board is judged at, and what each one is for.
 *
 * `wide` is a normal desktop window, where the board has room for a whole line of
 * cards. `narrow` is the operator making the window small — the case in the first
 * report, where the board still has room for two minimum cards and must give the
 * listing what it needs out of them. `tiny` is smaller than the board's own floor
 * (two minimum cards and the gutter): there the board refuses to shrink and the
 * sheet's scroller takes it sideways, and a rig that never asks for this width
 * cannot tell "the board does not squeeze cards" from "the board never had to".
 */
const WIDTHS = [
  { name: "wide", width: 1280, height: 1100 },
  { name: "narrow", width: 700, height: 1100 },
  { name: "tiny", width: 520, height: 1100 },
];

/** The board the harness seeds, restated so the driver can check it by name. */
const SEED = [
  "sys:goal-progress",
  "view:financial:v-listing",
  "view:financial:v-metric",
  "page:financial:ledger",
  "view:financial:v-row",
  "view:financial:v-ledger",
  "sys:pending-decisions",
  "view:financial:v-real",
];

/** The card the report names, and the one that must stay narrow beside it. */
const LISTING = "view:financial:v-listing";
const METRIC = "view:financial:v-metric";
const ROW_CARD = "view:financial:v-row";
/** The operator's own card: their rows, their columns, their pin's span 1. */
const OPERATOR = "view:financial:v-real";
/**
 * The card the height leg edits: the first card on the board.
 *
 * Height is dragged downward, and a pointer cannot leave the viewport, so the card
 * with the most room beneath it is the one to ask. It is also a SYSTEM card, which
 * is the point: Edit card is offered on every card on the board, not only on the
 * view pins the old width handle was limited to.
 */
const HEIGHT_CARD = "sys:goal-progress";

/**
 * The same board the harness seeds, restated as pin objects.
 *
 * The driver installs it again for each leg — the resize legs each start from a
 * board nobody has dragged yet, and the locked leg needs the same board read-only
 * — so it needs the pins themselves rather than only their ids.
 */
const SEED_PINS = [
  { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
  { id: LISTING, kind: "view", domainSlug: "financial", viewId: "v-listing", span: 1 },
  { id: METRIC, kind: "view", domainSlug: "financial", viewId: "v-metric", span: 1 },
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "ledger" },
  { id: ROW_CARD, kind: "view", domainSlug: "financial", viewId: "v-row", span: 2 },
  { id: "view:financial:v-ledger", kind: "view", domainSlug: "financial", viewId: "v-ledger", span: 1 },
  { id: "sys:pending-decisions", kind: "system", system: "pending-decisions" },
  { id: OPERATOR, kind: "view", domainSlug: "financial", viewId: "v-real", span: 1 },
];

/** How many times the page has been rendered: a fresh board per leg. */
let generation = 0;

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
 * Everything one width of the board says about itself, in one expression.
 *
 * The spill check walks EVERY descendant of every card and compares it with the
 * card's own frame: an overflowing table is not the table's box leaving the card
 * (a `width: 100%` table keeps its box where it was told) but its cells', so a
 * check that stopped at the table would see nothing at all. Two pixels is
 * rounding and hairline seats — the negative margins the board's own rows use to
 * reach their card's edges sit exactly on the frame — while a real spill is tens
 * of pixels and is reported with its measurement.
 */
const SAMPLE = `(() => {
  const grid = document.querySelector(".home-dashboard__grid");
  const scroller = document.querySelector(".tile-scroll");
  if (!grid) return { error: "no board" };
  const cs = getComputedStyle(grid);
  const declared = cs.gridTemplateColumns.trim();
  const trackList = declared === "" || declared === "none" ? [] : declared.split(/\\s+/);
  const gap = parseFloat(cs.columnGap) || 0;
  const round = (n) => Math.round(n * 10) / 10;
  const gridBox = grid.getBoundingClientRect();
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  let x = gridBox.left + padLeft;
  const tracks = trackList.map((w) => {
    const at = x;
    x += parseFloat(w) + gap;
    return { at, width: parseFloat(w) };
  });

  const cards = [...grid.querySelectorAll(":scope > .home-pin")].map((card) => {
    const shell = card.querySelector(".view-card, .home-card, .deadline-banner") || card;
    const shellBox = shell.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const spills = [];
    for (const el of card.querySelectorAll("*")) {
      if (el.closest(".home-pin__menu")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const past = Math.max(r.right - shellBox.right, shellBox.left - r.left);
      if (past > 2) {
        spills.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").split(" ").slice(0, 2).join(" "),
          past: round(past),
        });
      }
    }
    const mid = (t) => t.at + t.width / 2;
    const className = typeof card.className === "string" ? card.className : "";
    /**
     * What the card's table did with the width it was given.
     *
     * A card is a tile, so it is nearly always wider than the table inside it,
     * and the width has to go somewhere. This is where the operator's "the space
     * between Category and Amount is too much" is a measurement: the table's own
     * preferred width (asked of the browser, the same way the card's is), the
     * width it was stretched to, each column's box, and the slack left over.
     */
    const table = card.querySelector(".view-card__table");
    let tableReport = null;
    if (table) {
      // The table's own two answers, asked of the browser: under min-content the
      // narrowest it can be without its cells overflowing, under max-content the
      // width where nothing has to wrap. Both are recorded because a table's
      // intrinsic sizing is not the same question as a box's, and the claim that
      // follows needs to say which one it means.
      const previous = table.style.width;
      table.style.width = "min-content";
      const min = table.getBoundingClientRect().width;
      table.style.width = "max-content";
      const max = table.getBoundingClientRect().width;
      const maxColumns = [...table.querySelectorAll("thead th")].map((th) => ({
        header: (th.textContent || "").trim(),
        width: round(th.getBoundingClientRect().width),
      }));
      table.style.width = previous;
      const columnBoxes = [...table.querySelectorAll("thead th")].map((th) => ({
        header: (th.textContent || "").trim(),
        width: round(th.getBoundingClientRect().width),
      }));
      const shellStyle = getComputedStyle(shell);
      const padX =
        (parseFloat(shellStyle.paddingLeft) || 0) + (parseFloat(shellStyle.paddingRight) || 0);
      tableReport = {
        width: round(table.getBoundingClientRect().width),
        preferred: round(max),
        min: round(min),
        content: round(shellBox.width - padX - (parseFloat(shellStyle.borderLeftWidth) || 0) * 2),
        columns: columnBoxes,
        maxColumns,
      };
    }
    // What the hook measured this card at: the pin's own min-content width.
    const widthBefore = card.style.width;
    card.style.width = "min-content";
    const need = round(card.getBoundingClientRect().width);
    card.style.width = widthBefore;
    return {
      id: card.dataset.pinId ?? "(agents)",
      label: (card.querySelector(".view-card__title, .home-card__title")?.textContent ?? "").trim(),
      left: round(box.left),
      top: round(box.top),
      width: round(box.width),
      height: round(box.height),
      frame: round(shellBox.width),
      gridColumnStart: getComputedStyle(card).gridColumnStart,
      gridColumnEnd: getComputedStyle(card).gridColumnEnd,
      // Measured, not parsed: the tracks whose middle falls inside the card's box.
      covered: tracks.filter((t) => mid(t) >= box.left - 0.5 && mid(t) <= box.right + 0.5).length,
      // "This card owns the row" — the same two ways useTileSpans reads it: the
      // operator stored span 2 (home-pin--span2), or the card is drawn as
      // furniture across the board (.home-card--wide, the deadline banner).
      rowCard:
        className.includes("home-pin--span2") ||
        card.querySelector(".home-card--wide, .deadline-banner") !== null,
      need,
      table: tableReport,
      spills,
    };
  });

  const rows = [];
  for (const card of cards) {
    const row = rows.find((r) => Math.abs(r.top - card.top) <= 2);
    if (row) {
      row.cards.push(card.id);
      row.count += 1;
    } else {
      rows.push({ top: card.top, count: 1, cards: [card.id] });
    }
  }

  return {
    declared: declared || null,
    tracks: tracks.map((t) => round(t.width)),
    gap,
    unitRem: cs.getPropertyValue("--home-tile-unit-rem").trim(),
    minUnits: cs.getPropertyValue("--home-tile-min-units").trim(),
    inlineMinWidth: grid.style.minWidth || null,
    gridWidth: round(gridBox.width),
    cardCount: cards.length,
    cards,
    rows,
    scrollport: scroller
      ? {
          client: scroller.clientWidth,
          scroll: scroller.scrollWidth,
          overflowX: getComputedStyle(scroller).overflowX,
          scrollLeft: scroller.scrollLeft,
          canScrollSideways: scroller.scrollWidth - scroller.clientWidth > 1,
        }
      : null,
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

/** Say where the rig is, so a hang names itself instead of timing out dumb. */
function step(name) {
  console.log(`… ${name}`);
}

/**
 * The board is drawn and every card has its content.
 *
 * The measurement under test is a measurement OF the cards, so a board still
 * showing "Loading…" would be a board whose cards have nothing to measure — and
 * the run would pass for the wrong reason.
 */
const SETTLED = `(() => {
   const cards = document.querySelectorAll(".home-dashboard__grid > .home-pin").length;
   const loading = [...document.querySelectorAll(".view-card")].some((c) => (c.textContent || "").includes("Loading"));
   const tables = document.querySelectorAll(".view-card__table").length;
   return cards === ${SEED.length + 1} && !loading && tables >= 4;
 })()`;

/** Draw the board and wait for it to be the thing under test. */
async function drawBoard(win, { locked = false } = {}) {
  generation += 1;
  await win.webContents.executeJavaScript(
    `window.dashboardTileSetBoard(${JSON.stringify(SEED_PINS)}, ${locked ? "true" : "false"}); ` +
      `window.dashboardTileRender(${generation}); true`,
  );
  await waitFor(
    win,
    `document.querySelectorAll(".home-dashboard__grid > .home-pin").length === ${SEED.length + 1}`,
    "the board to render its cards",
  );
  await waitFor(win, SETTLED, "every card to draw its content");
  // The sizes are decided in a layout effect and by an observer, so the board is
  // read one settled frame after the content is there rather than in the same
  // tick it arrived.
  await settleFrames(win);
  await sleep(120);
  // Every leg starts from a board nobody has touched and an empty write log, so
  // "one write" is a claim about the gesture rather than about the run.
  await win.webContents.executeJavaScript("window.dashboardTilePinWrites.length = 0; true");
}

async function sample(win, name) {
  const board = await win.webContents.executeJavaScript(SAMPLE);
  if (board.error) throw new Error(`${name}: ${board.error}`);
  return board;
}

/** One card by id, or null. */
const cardOf = (board, id) => board.cards.find((card) => card.id === id) ?? null;

/**
 * 1. Nothing is drawn outside its own card, at any width.
 *
 * The claim is made per width rather than once, because the reported case is the
 * small window: a board that holds together at 1280 and spills at 700 is the bug
 * the operator reported, and a rig that only asked the wide one would call it
 * fixed.
 */
function checkNoSpill(boards) {
  const problems = [];
  for (const { name, board } of boards) {
    for (const card of board.cards) {
      if (card.spills.length === 0) continue;
      const worst = card.spills.reduce((a, b) => (a.past > b.past ? a : b));
      problems.push(
        `${name}: ${card.id} (${JSON.stringify(card.label)}) draws ${card.spills.length} element(s) ` +
          `outside its frame — worst ${worst.tag}.${worst.cls} by ${worst.past}px`,
      );
    }
  }
  return check("no-spill", problems.length === 0, problems.join("; "));
}

/**
 * 2. A card is as wide as its table, and the table keeps its own width.
 *
 * This is the operator's second report made into a measurement:
 *
 *   "Some tables are still showing lots of empty space — the space between the
 *    Category and Amount columns is too much."
 *
 * Two numbers, and they are the two halves of that sentence. A LISTING must draw
 * at the width its columns need — `table.width == table.preferred` — because a
 * table told to fill its card spends the difference between its columns, which is
 * the hole. And the CARD must be within one layout step of what its table needs,
 * which is what "lots of empty space" was: 605px of card around a 348px table.
 *
 * The metric is the control: a card whose content needs almost nothing must still
 * come out small, not stretched to match the wide card beside it.
 */
function checkCardFitsItsTable(boards) {
  const problems = [];
  const readings = [];
  for (const { name, board } of boards) {
    const step = (Number.parseFloat(board.unitRem) || 0) * 16 + board.gap;
    const minUnits = Number.parseInt(board.minUnits, 10) || 4;
    const minCard = minUnits * step - board.gap;
    for (const id of [LISTING, OPERATOR]) {
      const card = cardOf(board, id);
      if (!card) {
        problems.push(`${name}: no card for ${id}`);
        continue;
      }
      if (!card.table) {
        problems.push(`${name}: ${id} draws no table to measure`);
        continue;
      }
      const { width, preferred, content } = card.table;
      readings.push(
        `${name} ${card.id}: card ${card.width}px, table ${width}px of ${preferred}px needed`,
      );
      if (width - preferred > 2) {
        problems.push(
          `${name}: ${id}'s table was stretched to ${width}px from the ${preferred}px its columns ` +
            `need — ${Math.round(width - preferred)}px spread between the columns`,
        );
      }
      if (content - preferred > step) {
        problems.push(
          `${name}: ${id} is ${card.width}px around a ${preferred}px table — ` +
            `${Math.round(content - preferred)}px of leftover, more than one ${Math.round(step)}px step`,
        );
      }
    }
    const metric = cardOf(board, METRIC);
    if (!metric) {
      problems.push(`${name}: no card for ${METRIC}`);
      continue;
    }
    readings.push(`${name} metric: ${metric.width}px against a ${Math.round(minCard)}px minimum card`);
    if (metric.width > minCard + step) {
      problems.push(
        `${name}: the one-number metric is ${metric.width}px, wider than the ${Math.round(minCard)}px ` +
          `minimum card by more than one step`,
      );
    }
  }
  return check("card-fits-its-table", problems.length === 0, problems.join("; ") || readings.join("; "));
}

/**
 * 3. The operator's own card, measured on the same rule.
 *
 * `v-real` is their card: their title, their four columns, their twelve rows out
 * of the vault, and — like theirs — a view file that says `span: 2` on a pin that
 * says `span: 1`. The controlled listing above is the instrument (its content is
 * chosen to be wide in any font); this one is the evidence that the rule reaches
 * the reported case with the reported data.
 */
function checkOperatorCard(boards) {
  const problems = [];
  const readings = [];
  for (const { name, board } of boards) {
    const card = cardOf(board, OPERATOR);
    const metric = cardOf(board, METRIC);
    if (!card) {
      problems.push(`${name}: no card for ${OPERATOR}`);
      continue;
    }
    readings.push(`${name}: ${card.covered} unit(s) at ${card.width}px`);
    if (card.covered < 4) {
      problems.push(
        `${name}: the operator's card was drawn in ${card.covered} unit(s) (${card.width}px)`,
      );
    }
    if (card.spills.length > 0) {
      problems.push(
        `${name}: the operator's card draws ${card.spills.length} element(s) outside its frame`,
      );
    }
    if (metric && !(card.width > metric.width)) {
      problems.push(
        `${name}: the operator's card (${card.width}px) is not wider than the metric (${metric.width}px)`,
      );
    }
  }
  return check("operator-card", problems.length === 0, problems.join("; ") || readings.join("; "));
}

/**
 * 4. The number of cards on a line follows from how wide they are.
 *
 * The operator's words: "we might only fit 2 on a certain line while on the next
 * one fit 3". Two readings, because the board legitimately respaces itself as the
 * window moves — a line of three at 1280px and a line of two at 700px is one
 * board, not two. So: across the widths, some line holds three cards and some
 * line holds two; on the roomiest board at least two lines hold more than one;
 * and on NO board is every card alone on its own line, which is the shape a board
 * squeezed until it gives up on packing takes (and the shape the pre-fix build
 * took at 520px).
 */
function checkRowsMix(boards) {
  const problems = [];
  const readings = [];
  const counts = new Set();
  for (const { name, board } of boards) {
    const tiled = board.rows.filter((row) => row.count > 1);
    for (const row of tiled) counts.add(row.count);
    readings.push(`${name} ${JSON.stringify(board.rows.map((row) => row.count))}`);
    if (tiled.length === 0) {
      problems.push(`${name}: every card is alone on its own line`);
    }
    if (name === "wide" && tiled.length < 2) {
      problems.push(`${name}: only ${tiled.length} line(s) hold more than one card`);
    }
  }
  if (!counts.has(3)) problems.push("no line on any width held three cards");
  if (!counts.has(2)) problems.push("no line on any width held two cards");
  return check("rows-mix", problems.length === 0, problems.join("; ") || readings.join("; "));
}

/** 4. The card the operator stored across the row is drawn across the row. */
function checkRowCard(boards) {
  const problems = [];
  const readings = [];
  for (const { name, board } of boards) {
    const card = cardOf(board, ROW_CARD);
    if (!card) {
      problems.push(`${name}: no card for ${ROW_CARD}`);
      continue;
    }
    readings.push(`${name}: ${card.width}px of a ${board.gridWidth}px board`);
    if (!card.rowCard) problems.push(`${name}: the stored span-2 card lost its own class`);
    // The board's own content width, not the grid's clientWidth: the frame's
    // padding is the frame's business and a row card reaches both edges.
    if (Math.abs(card.width - board.gridWidth) > 1) {
      problems.push(
        `${name}: the stored span-2 card measures ${card.width}px against the board's ${board.gridWidth}px`,
      );
    }
  }
  return check("row-card", problems.length === 0, problems.join("; ") || readings.join("; "));
}

/**
 * 5. A window too small for the board's units gets a board wider than the window.
 *
 * Three facts, and each fails on the pre-fix build for its own reason: the board
 * is wider than its scroller (it refused to shrink), the scroller can move
 * sideways (the overflow went to the sheet rather than to a card), and no track is
 * below one unit and no card below one minimum card (nothing was squeezed).
 */
function checkBoardFloors(boards) {
  const tiny = boards.find((entry) => entry.name === "tiny");
  if (!tiny) return check("board-floors", false, "the tiny width was never sampled");
  const { board } = tiny;
  const unit = (Number.parseFloat(board.unitRem) || 4.25) * 16;
  const minUnits = Number.parseInt(board.minUnits, 10) || 4;
  const minCard = minUnits * (unit + board.gap) - board.gap;
  const narrowTracks = board.tracks.filter((width) => width < unit - 1);
  const narrowCards = board.cards.filter((card) => card.width < minCard - 1);
  const scrollport = board.scrollport ?? { client: 0, scroll: 0, canScrollSideways: false };
  return check(
    "board-floors",
    board.gridWidth > scrollport.client + 1 &&
      scrollport.canScrollSideways &&
      narrowTracks.length === 0 &&
      narrowCards.length === 0,
    `at ${tiny.width}px wide: board ${board.gridWidth}px in a ${scrollport.client}px scrollport ` +
      `(scroll ${scrollport.scroll}, ${scrollport.overflowX}), tracks ${JSON.stringify(board.tracks.slice(0, 4))}… ` +
      `against a ${Math.round(unit)}px unit, ${narrowTracks.length} below the unit and ` +
      `${narrowCards.length} card(s) below the ${Math.round(minCard)}px minimum`,
  );
}

/**
 * 6. A card's width follows from its content, not from the window.
 *
 * This is the claim that the board cannot oscillate, and it is made only about
 * the cards the board sizes. A card the operator stored across the row covers
 * every track there is — fifteen at 1280px, eight at 700px — and that is its width
 * behaving exactly as asked; it is excluded here and claimed in `row-card`.
 *
 * A span decided from the track width the card happens to have would flip between
 * one span and another as the window moved, which is why the arithmetic is done
 * against the design's unit instead. The round trip at the end is the other half:
 * the first and last samples are the same width, so a board that had drifted
 * would show it.
 */
function checkStable(boards) {
  const problems = [];
  const readings = [];
  for (const id of [...SEED, "(agents)"]) {
    const seen = boards.map(({ name, board }) => ({ name, card: cardOf(board, id) }));
    if (seen.some((entry) => !entry.card)) {
      problems.push(`${id} is missing from at least one width`);
      continue;
    }
    if (seen[0].card.rowCard) continue;
    const counts = [...new Set(seen.map((entry) => entry.card.covered))];
    if (counts.length > 1) {
      problems.push(
        `${id} drew in ${counts.length} different widths: ${seen
          .map((entry) => `${entry.name}=${entry.card.covered}`)
          .join(", ")}`,
      );
    }
    readings.push(`${id} ${counts.join("/")}`);
  }
  const wide = boards.find((entry) => entry.name === "wide");
  const again = boards.find((entry) => entry.name === "wide-again");
  if (wide && again) {
    const drift = wide.board.cards
      .map((card) => {
        const later = cardOf(again.board, card.id);
        if (!later) return `${card.id} vanished`;
        if (later.covered !== card.covered) return `${card.id}: ${card.covered} → ${later.covered}`;
        if (Math.abs(later.width - card.width) > 1) return `${card.id}: ${card.width}px → ${later.width}px`;
        return null;
      })
      .filter(Boolean);
    if (drift.length > 0) problems.push(`the board moved between two visits to 1280px: ${drift.join("; ")}`);
  } else {
    problems.push("the wide width was not sampled twice");
  }
  return check("stable", problems.length === 0, problems.join("; ") || readings.join("; "));
}

/** 7. Sizing the board asks the vault for nothing. */
function checkNoWrite(writes) {
  return check(
    "no-write",
    writes.length === 0,
    writes.length === 0
      ? "the board sized itself without a single pin write"
      : `the board wrote ${writes.length} pin list(s) while measuring itself: ${JSON.stringify(
          writes.map((pins) => pins.map((pin) => pin.id)),
        )}`,
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

/** A real key press, through the browser's own input pipeline. */
async function pressKey(win, keyCode) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "char", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(80);
}

/** The board's own geometry: the step, the gutter, and where the board starts. */
function geometry(win) {
  return win.webContents.executeJavaScript(
    `(() => {
       const grid = document.querySelector(".home-dashboard__grid");
       const style = getComputedStyle(grid);
       const box = grid.getBoundingClientRect();
       const tracks = style.gridTemplateColumns.trim().split(/\\s+/);
       const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
       return {
         step: parseFloat(tracks[0]),
         gap: parseFloat(style.columnGap) || 0,
         tracks: tracks.length,
         minUnits: parseInt(style.getPropertyValue("--home-tile-min-units"), 10) || 4,
         left: box.left,
         width: box.width,
         root,
       };
     })()`,
  );
}

/** One card's box, rounded, in both axes. */
function cardBox(win, pinId) {
  return win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector('[data-pin-id="${pinId}"]');
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return {
         left: r.left, right: r.right, width: r.width,
         top: r.top, bottom: r.bottom, height: r.height,
       };
     })()`,
  );
}

/** One card's handle for one axis, and whether a point on it really lands on it. */
function handleOf(win, pinId, axis) {
  return win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(
         '[data-pin-handle="${pinId}"][data-pin-handle-axis="${axis}"]',
       );
       if (!el) return null;
       const r = el.getBoundingClientRect();
       const x = r.left + r.width / 2;
       const y = r.top + r.height / 2;
       const hit = document.elementFromPoint(x, y);
       return {
         x, y, width: r.width, height: r.height,
         role: el.getAttribute("role"),
         orientation: el.getAttribute("aria-orientation"),
         label: el.getAttribute("aria-label"),
         valueNow: el.getAttribute("aria-valuenow"),
         valueMin: el.getAttribute("aria-valuemin"),
         valueMax: el.getAttribute("aria-valuemax"),
         lands: Boolean(hit && (hit === el || el.contains(hit))),
       };
     })()`,
  );
}

/** What Edit mode looks like right now: the card, its handles, and the old icon. */
function editState(win, pinId) {
  return win.webContents.executeJavaScript(
    `(() => {
       const card = document.querySelector('[data-pin-id="${pinId}"]');
       const handles = [...document.querySelectorAll("[data-pin-handle]")].map((el) => ({
         pinId: el.getAttribute("data-pin-handle"),
         axis: el.getAttribute("data-pin-handle-axis"),
         role: el.getAttribute("role"),
         orientation: el.getAttribute("aria-orientation"),
         label: el.getAttribute("aria-label"),
       }));
       return {
         editing: card ? card.classList.contains("is-editing") : false,
         editingIds: [...document.querySelectorAll(".home-pin.is-editing")].map((el) => el.dataset.pinId),
         handles,
         spanIcons: document.querySelectorAll('[data-testid="pin-span"]').length,
         menuItems: [...document.querySelectorAll('[data-testid="pin-menu"] [role="menuitem"]')]
           .map((el) => (el.textContent || "").trim()),
         menuTestIds: [...document.querySelectorAll('[data-testid="pin-menu"] [role="menuitem"]')]
           .map((el) => el.getAttribute("data-testid")),
       };
     })()`,
  );
}

/** A real press and release on the middle of an element. */
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
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(30);
  mouse(win, "mouseUp", point.x, point.y);
  await sleep(120);
}

/** Open one card's 3-dot menu and wait for the popup. */
async function openMenu(win, pinId) {
  await clickSelector(win, `[data-pin-id="${pinId}"] [data-testid="pin-menu-toggle"]`);
  await waitFor(
    win,
    `document.querySelectorAll('[data-pin-id="${pinId}"] [data-testid="pin-menu"]').length === 1`,
    "the card's menu to open",
  );
}

/** Open a card's menu, choose Edit card, and wait for Edit mode. */
async function enterEditMode(win, pinId) {
  await openMenu(win, pinId);
  await clickSelector(win, `[data-pin-id="${pinId}"] [data-testid="pin-edit"]`);
  await waitFor(
    win,
    `document.querySelector('[data-pin-id="${pinId}"]').classList.contains("is-editing")`,
    "the card to enter Edit mode",
  );
  // The handles' ranges are written by the board's own measurement pass, so wait
  // for that pass rather than reading a pair of separators that say nothing yet.
  await waitFor(
    win,
    `(() => {
       const el = document.querySelector(
         '[data-pin-handle="${pinId}"][data-pin-handle-axis="width"]',
       );
       return Boolean(el && el.getAttribute("aria-valuenow") !== null);
     })()`,
    "the edit handles to describe their range",
  );
  await settleFrames(win);
  await sleep(120);
}

/** The pin list the page last asked the vault to write, and the card's pin in it. */
async function lastWrite(win, pinId) {
  const writes = await win.webContents.executeJavaScript("window.dashboardTilePinWrites");
  const last = writes.length ? writes[writes.length - 1] : null;
  return {
    count: writes.length,
    pin: last ? (last.find((candidate) => candidate.id === pinId) ?? null) : null,
  };
}

const pinWrites = (win) =>
  win.webContents.executeJavaScript("window.dashboardTilePinWrites");

const liftedIds = (win) =>
  win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".home-pin.is-lifted")].map((el) => el.dataset.pinId)`,
  );

const resizeStatus = (win) =>
  win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector('[data-testid="pin-resize-status"]');
       return el ? (el.textContent || "").trim() : null;
     })()`,
  );

const spillCount = (win, pinId) =>
  win.webContents.executeJavaScript(
    `(() => {
       const card = document.querySelector('[data-pin-id="${pinId}"]');
       if (!card) return -1;
       const shell = card.querySelector(".view-card, .home-card, .deadline-banner") || card;
       const frame = shell.getBoundingClientRect();
       let out = 0;
       for (const el of card.querySelectorAll("*")) {
         const r = el.getBoundingClientRect();
         if (r.width === 0 && r.height === 0) continue;
         if (Math.max(r.right - frame.right, frame.left - r.left) > 2) out += 1;
       }
       return out;
     })()`,
  );

/**
 * Drag one of a card's borders to a point, in the browser's own input pipeline.
 *
 * The pointer travels in steps rather than jumping, because the drag resolves the
 * size on every move — a single jump would only prove the last position was read.
 *
 * BOTH POINTS HAVE TO BE INSIDE THE WINDOW, and that is checked rather than
 * trusted: `sendInputEvent` injects at a coordinate, and a coordinate outside the
 * viewport is an event the renderer never sees. A rig whose aim left the window
 * would be a rig reporting "the drag did nothing" about a drag that never
 * happened — which is exactly what it did before this check existed.
 */
async function dragHandle(win, pinId, axis, target) {
  const handle = await handleOf(win, pinId, axis);
  if (!handle) throw new Error(`${pinId} draws no ${axis} handle`);
  if (!handle.lands) throw new Error(`the ${axis} handle of ${pinId} is not hit-testable`);
  const viewport = await win.webContents.executeJavaScript(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  const inside = (x, y) =>
    x >= 4 && x <= viewport.width - 4 && y >= 4 && y <= viewport.height - 4;
  const targetX = axis === "width" ? target : handle.x;
  const targetY = axis === "height" ? target : handle.y;
  if (!inside(handle.x, handle.y) || !inside(targetX, targetY)) {
    throw new Error(
      `the ${axis} drag of ${pinId} aims outside the ${viewport.width}x${viewport.height} window: ` +
        `from ${Math.round(handle.x)},${Math.round(handle.y)} to ` +
        `${Math.round(targetX)},${Math.round(targetY)}`,
    );
  }
  /**
   * Record what the input pipeline actually delivers.
   *
   * A drag that does nothing has two very different causes — the events never
   * arrived, or they arrived and the gesture ignored them — and a rig that cannot
   * tell them apart reports the wrong one. The recorder is what makes the
   * difference a number in the claim rather than a guess.
   */
  await win.webContents.executeJavaScript(
    `(() => {
       window.__tilePointers = [];
       window.__tileRecorder = (event) => {
         const target = event.target;
         const name = typeof target.className === "string" && target.className ? target.className : target.tagName;
         window.__tilePointers.push(
           event.type + "@" + Math.round(event.clientX) + "," + Math.round(event.clientY) +
             "/p" + event.pointerId + "→" + String(name).split(" ")[0],
         );
       };
       for (const type of ["pointerdown", "pointermove", "pointerup"]) {
         document.addEventListener(type, window.__tileRecorder, true);
       }
       return true;
     })()`,
  );
  mouse(win, "mouseDown", handle.x, handle.y);
  await sleep(60);
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    mouse(
      win,
      "mouseMove",
      handle.x + ((targetX - handle.x) * step) / steps,
      handle.y + ((targetY - handle.y) * step) / steps,
    );
    await sleep(40);
  }
  await settleFrames(win);
  mouse(win, "mouseUp", targetX, targetY);
  await sleep(220);
  return win.webContents.executeJavaScript(
    `(() => {
       for (const type of ["pointerdown", "pointermove", "pointerup"]) {
         document.removeEventListener(type, window.__tileRecorder, true);
       }
       return window.__tilePointers;
     })()`,
  );
}

/** Re-render the same board: the pin list the harness now holds is read again. */
async function reloadBoard(win) {
  generation += 1;
  await win.webContents.executeJavaScript(`window.dashboardTileRender(${generation}); true`);
  await settleFrames(win);
  await sleep(220);
}

/**
 * Edit card: the chrome the operator asked for, and the gesture behind it.
 *
 * The operator's words were literal: remove the icon next to the 3-dot, put Edit
 * card in the menu, and let the card's right and bottom borders be dragged. These
 * legs hold that sentence to the board one clause at a time.
 *
 * The claims that matter most are the ones a screenshot cannot make: Edit card is
 * the only way into the mode and a press outside the card is the way out; the
 * width floor is still the content, so the gesture cannot rebuild the spill this
 * board was reported for; and the far end of the width range is still the row,
 * stored as `span: 2` rather than as a very wide card.
 */
async function checkEditMode(win) {
  const summary = {};
  /**
   * The edit legs run on a WIDER window than the sizing claims, and they have to:
   * a drag names a width by the pointer's own x, so widening a card that already
   * ends near the window's edge would aim outside the viewport — where an injected
   * event is never delivered. A roomy window is what makes "drag it wider" a
   * gesture this rig can actually perform.
   */
  win.setContentSize(1600, 1100);
  await settleFrames(win);
  await sleep(200);

  // 0. The chrome is the 3-dot alone: the Fill-the-row icon is gone, and every
  //    card still offers its menu. This is the first half of the request, read off
  //    the rendered board rather than off the source.
  step("edit-no-icon");
  await drawBoard(win);
  const chrome = await win.webContents.executeJavaScript(
    `(() => ({
       spanIcons: document.querySelectorAll('[data-testid="pin-span"]').length,
       menus: document.querySelectorAll('[data-testid="pin-menu-toggle"]').length,
       cards: document.querySelectorAll(".home-dashboard__grid > .home-pin").length,
       chromeButtons: [...document.querySelectorAll(".home-pin__chrome .home-pin__btn")]
         .map((el) => el.getAttribute("data-testid")),
     }))()`,
  );
  check(
    "edit-no-icon",
    chrome.spanIcons === 0 &&
      // The board draws one extra card for the Active-agents panel, which is page
      // furniture rather than a pin: every PIN has its menu, and the helper does not.
      chrome.menus === SEED.length &&
      chrome.chromeButtons.every((id) => id === "pin-menu-toggle"),
    `the board draws ${chrome.spanIcons} Fill-the-row icon(s), ${chrome.menus} menu trigger(s) ` +
      `for ${chrome.cards} card(s), and its chrome buttons are ${JSON.stringify(chrome.chromeButtons)}`,
  );
  summary.chrome = chrome;

  // 1. The menu holds Edit card, and nothing else grew: Archive stays plain,
  //    Delete stays destructive and last, and the trigger still names the menu.
  step("edit-menu");
  await openMenu(win, OPERATOR);
  const menu = await editState(win, OPERATOR);
  check(
    "edit-menu",
    JSON.stringify(menu.menuItems) ===
      JSON.stringify(["Edit card", "Archive", "Delete"]) &&
      JSON.stringify(menu.menuTestIds) ===
        JSON.stringify(["pin-edit", "pin-archive", "pin-delete"]),
    `the operator card's menu holds ${JSON.stringify(menu.menuItems)} ` +
      `(${JSON.stringify(menu.menuTestIds)})`,
  );
  summary.menu = { items: menu.menuItems, testIds: menu.menuTestIds };
  await pressKey(win, "Escape");
  await waitFor(win, `document.querySelectorAll('[data-testid="pin-menu"]').length === 0`, "Escape to close the menu");

  // 2. Edit card puts that card — and only that card — into Edit mode, with a
  //    handle on each of the two borders the request names.
  step("edit-handles");
  await enterEditMode(win, OPERATOR);
  const armed = await editState(win, OPERATOR);
  const widthHandle = await handleOf(win, OPERATOR, "width");
  const heightHandle = await handleOf(win, OPERATOR, "height");
  const handlesWellFormed =
    armed.handles.length === 2 &&
    armed.handles.every((handle) => handle.pinId === OPERATOR) &&
    widthHandle?.role === "separator" &&
    widthHandle?.orientation === "vertical" &&
    heightHandle?.role === "separator" &&
    heightHandle?.orientation === "horizontal" &&
    (widthHandle?.label ?? "").startsWith("Width of ") &&
    (heightHandle?.label ?? "").startsWith("Height of ") &&
    Number.isFinite(Number(widthHandle?.valueNow)) &&
    Number.isFinite(Number(widthHandle?.valueMin)) &&
    Number(widthHandle?.valueNow) >= Number(widthHandle?.valueMin) &&
    Number(widthHandle?.valueNow) <= Number(widthHandle?.valueMax);
  check(
    "edit-handles",
    armed.editing &&
      JSON.stringify(armed.editingIds) === JSON.stringify([OPERATOR]) &&
      handlesWellFormed,
    `Edit mode is ${armed.editing} on ${JSON.stringify(armed.editingIds)} with ` +
      `${armed.handles.length} handle(s): width ${JSON.stringify(widthHandle)}, ` +
      `height ${JSON.stringify(heightHandle)}`,
  );
  summary.handles = {
    editing: armed.editing,
    ids: armed.editingIds,
    handles: armed.handles,
    width: widthHandle,
    height: heightHandle,
  };

  // 3. Dragging the right border widens the card by the units aimed at, writes
  //    once, and the width survives a fresh render of the same board.
  step("edit-width-drag");
  const geo = await geometry(win);
  const before = await cardBox(win, OPERATOR);
  const unitsBefore = Math.round((before.width + geo.gap) / (geo.step + geo.gap));
  const wanted = unitsBefore + 2;
  const targetX = before.left + wanted * (geo.step + geo.gap) - geo.gap;
  const delivered = await dragHandle(win, OPERATOR, "width", targetX);
  const widened = await cardBox(win, OPERATOR);
  const widenedUnits = Math.round((widened.width + geo.gap) / (geo.step + geo.gap));
  const widenWrite = await lastWrite(win, OPERATOR);
  const widthSpills = await spillCount(win, OPERATOR);
  check(
    "edit-width-drag",
    widenedUnits === wanted &&
      widenWrite.count === 1 &&
      widenWrite.pin?.span === 1 &&
      typeof widenWrite.pin?.width === "number" &&
      Math.abs(widenWrite.pin.width * geo.root - widened.width) <= 2 &&
      widthSpills === 0,
    `dragging the right border to ${Math.round(targetX)}px gave ${widenedUnits} unit(s) at ` +
      `${Math.round(widened.width)}px (wanted ${wanted}), ${widenWrite.count} write(s) storing ` +
      `span=${widenWrite.pin?.span} width=${widenWrite.pin?.width}rem, ${widthSpills} element(s) ` +
      `outside the card; the pipeline delivered ${JSON.stringify(delivered)}; the board said ` +
      `${JSON.stringify(await resizeStatus(win))}`,
  );
  summary.width = {
    from: unitsBefore,
    wanted,
    units: widenedUnits,
    width: Math.round(widened.width),
    storedWidthRem: widenWrite.pin?.width ?? null,
    writes: widenWrite.count,
  };

  await reloadBoard(win);
  const reloadedWidth = await cardBox(win, OPERATOR);
  const reloadedUnits = Math.round((reloadedWidth.width + geo.gap) / (geo.step + geo.gap));
  summary.width.reloadedUnits = reloadedUnits;
  check(
    "edit-width-survives-a-reload",
    reloadedUnits === wanted && Math.abs(reloadedWidth.width - widened.width) <= 1,
    `after a fresh render of the same board the card is ${reloadedUnits} unit(s) at ` +
      `${Math.round(reloadedWidth.width)}px, against ${widenedUnits} at ${Math.round(widened.width)}px ` +
      `when the drag ended`,
  );

  // 4. Dragging the bottom border makes the card taller, writes once, and the
  //    height survives a fresh render. The card is the first one on the board, so
  //    there is room under it for the pointer to travel inside the window.
  step("edit-height-drag");
  await drawBoard(win);
  await enterEditMode(win, HEIGHT_CARD);
  const heightGeo = await geometry(win);
  const heightBefore = await cardBox(win, HEIGHT_CARD);
  const viewportHeight = await win.webContents.executeJavaScript("window.innerHeight");
  const heightTarget = Math.min(viewportHeight - 16, heightBefore.bottom + 160);
  if (heightTarget < heightBefore.bottom + 60) {
    throw new Error(
      `the ${HEIGHT_CARD} card ends at ${Math.round(heightBefore.bottom)}px in a ` +
        `${viewportHeight}px window: there is no room to drag its bottom border`,
    );
  }
  const heightDelivered = await dragHandle(win, HEIGHT_CARD, "height", heightTarget);
  const heightAfter = await cardBox(win, HEIGHT_CARD);
  const heightWrite = await lastWrite(win, HEIGHT_CARD);
  const heightSpills = await spillCount(win, HEIGHT_CARD);
  check(
    "edit-height-drag",
    heightAfter.height >= heightBefore.height + 60 &&
      heightWrite.count === 1 &&
      typeof heightWrite.pin?.height === "number" &&
      Math.abs(heightWrite.pin.height * heightGeo.root - heightAfter.height) <= 3 &&
      heightSpills === 0,
    `dragging the bottom border to ${Math.round(heightTarget)}px made the card ` +
      `${Math.round(heightAfter.height)}px from ${Math.round(heightBefore.height)}px, ` +
      `${heightWrite.count} write(s) storing height=${heightWrite.pin?.height}rem, ` +
      `${heightSpills} element(s) outside the card; the pipeline delivered ` +
      `${JSON.stringify(heightDelivered)}; the board said ${JSON.stringify(await resizeStatus(win))}`,
  );
  summary.height = {
    from: Math.round(heightBefore.height),
    height: Math.round(heightAfter.height),
    storedHeightRem: heightWrite.pin?.height ?? null,
    writes: heightWrite.count,
  };

  await reloadBoard(win);
  const reloadedHeight = await cardBox(win, HEIGHT_CARD);
  summary.height.reloadedHeight = Math.round(reloadedHeight.height);
  check(
    "edit-height-survives-a-reload",
    Math.abs(reloadedHeight.height - heightAfter.height) <= 2,
    `after a fresh render the card is ${Math.round(reloadedHeight.height)}px tall, against ` +
      `${Math.round(heightAfter.height)}px when the drag ended`,
  );

  // 5. The floor is the content, never the pointer — and it is a floor a drag can
  //    come back DOWN to, not only one it cannot pass. So the card is widened
  //    first, and then dragged hard in: it stops where its table stops, writes the
  //    width it stopped at, and nothing leaves the frame.
  step("edit-width-floor-is-the-content");
  await drawBoard(win);
  await enterEditMode(win, OPERATOR);
  const floorGeo = await geometry(win);
  const floorBefore = await cardBox(win, OPERATOR);
  const floorUnits = Math.round((floorBefore.width + floorGeo.gap) / (floorGeo.step + floorGeo.gap));
  const viewportWidth = await win.webContents.executeJavaScript("window.innerWidth");
  const roomUnits = Math.floor(
    (viewportWidth - 8 - floorBefore.left + floorGeo.gap) / (floorGeo.step + floorGeo.gap),
  );
  const growUnits = Math.min(3, Math.max(0, roomUnits - floorUnits));
  if (growUnits < 1) {
    throw new Error(
      `the operator card already fills ${floorUnits} unit(s) to ` +
        `${Math.round(floorBefore.left + floorBefore.width)}px in a ${viewportWidth}px window: ` +
        `there is no room to widen it`,
    );
  }
  const wideTarget =
    floorBefore.left + (floorUnits + growUnits) * (floorGeo.step + floorGeo.gap) - floorGeo.gap;
  await dragHandle(win, OPERATOR, "width", wideTarget);
  const widenedForFloor = await cardBox(win, OPERATOR);
  const floorWidenedUnits = Math.round(
    (widenedForFloor.width + floorGeo.gap) / (floorGeo.step + floorGeo.gap),
  );
  // Now pull it in, far past where its content begins.
  const floorTarget = Math.max(12, widenedForFloor.left - 260);
  const floorDelivered = await dragHandle(win, OPERATOR, "width", floorTarget);
  const floored = await cardBox(win, OPERATOR);
  const flooredUnits = Math.round((floored.width + floorGeo.gap) / (floorGeo.step + floorGeo.gap));
  const floorWrite = await lastWrite(win, OPERATOR);
  const floorSpills = await spillCount(win, OPERATOR);
  check(
    "edit-width-floor-is-the-content",
    floorWidenedUnits === floorUnits + growUnits &&
      flooredUnits === floorUnits &&
      floorWrite.count === 2 &&
      floorWrite.pin?.span === 1 &&
      typeof floorWrite.pin?.width === "number" &&
      Math.abs(floorWrite.pin.width * floorGeo.root - floored.width) <= 3 &&
      floorSpills === 0,
    `widening to ${floorUnits + growUnits} units gave ${floorWidenedUnits}, then dragging to ` +
      `${Math.round(floorTarget)}px stopped at ${flooredUnits} unit(s) at ` +
      `${Math.round(floored.width)}px; the card's content needs ${floorUnits}, ` +
      `${floorWrite.count} write(s) storing span=${floorWrite.pin?.span} ` +
      `width=${floorWrite.pin?.width}rem, ${floorSpills} element(s) outside the card; the ` +
      `pipeline delivered ${JSON.stringify(floorDelivered)}`,
  );
  summary.floor = {
    contentUnits: floorUnits,
    unitsBefore: floorWidenedUnits,
    stoppedAt: flooredUnits,
    width: Math.round(floored.width),
    storedWidthRem: floorWrite.pin?.width ?? null,
    writes: floorWrite.count,
  };

  // 6. The ceiling is the row, and it is stored as the row. The card dragged here
  //    is the one standing at the board's own left edge, because a drag to the
  //    row's far end is only inside the window for a card that starts at its near
  //    end — see the note on the window size above.
  step("edit-drag-row");
  await drawBoard(win);
  await enterEditMode(win, LISTING);
  const rowGeo = await geometry(win);
  const rowBox = await cardBox(win, LISTING);
  const rowTarget = rowGeo.left + rowGeo.width;
  await dragHandle(win, LISTING, "width", rowTarget);
  const filled = await cardBox(win, LISTING);
  const rowWrite = await lastWrite(win, LISTING);
  const rowSpills = await spillCount(win, LISTING);
  check(
    "edit-drag-row",
    rowWrite.count === 1 &&
      rowWrite.pin?.span === 2 &&
      rowWrite.pin?.width === undefined &&
      Math.abs(filled.width - rowGeo.width) <= 1 &&
      rowSpills === 0,
    `dragging ${Math.round(rowTarget)}px (the board's right edge) stored ` +
      `span=${rowWrite.pin?.span} width=${rowWrite.pin?.width} for ${Math.round(filled.width)}px ` +
      `against the board's ${Math.round(rowGeo.width)}px, from a card at ` +
      `${Math.round(rowBox.left)}px, ${rowWrite.count} write(s), ${rowSpills} element(s) outside`,
  );
  summary.row = {
    pinSpan: rowWrite.pin?.span ?? null,
    storedWidthRem: rowWrite.pin?.width ?? null,
    width: Math.round(filled.width),
    board: Math.round(rowGeo.width),
    writes: rowWrite.count,
  };

  // 7. The keyboard's half: one unit per press on the width, one rem per press on
  //    the height, written as each is pressed.
  step("edit-keys-step");
  await drawBoard(win);
  await enterEditMode(win, OPERATOR);
  const keyGeo = await geometry(win);
  const keyBefore = await cardBox(win, OPERATOR);
  const keyUnits = Math.round((keyBefore.width + keyGeo.gap) / (keyGeo.step + keyGeo.gap));
  const focusedWidth = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector('[data-pin-handle="${OPERATOR}"][data-pin-handle-axis="width"]');
       el.focus();
       return document.activeElement === el;
     })()`,
  );
  await pressKey(win, "Right");
  await sleep(260);
  const afterWidthKey = await cardBox(win, OPERATOR);
  const afterWidthUnits = Math.round(
    (afterWidthKey.width + keyGeo.gap) / (keyGeo.step + keyGeo.gap),
  );
  const widthKeyWrite = await lastWrite(win, OPERATOR);
  const heightBeforeKey = await cardBox(win, OPERATOR);
  const focusedHeight = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector('[data-pin-handle="${OPERATOR}"][data-pin-handle-axis="height"]');
       el.focus();
       return document.activeElement === el;
     })()`,
  );
  await pressKey(win, "Down");
  await sleep(260);
  const afterHeightKey = await cardBox(win, OPERATOR);
  const heightKeyWrite = await lastWrite(win, OPERATOR);
  const spoken = await resizeStatus(win);
  check(
    "edit-keys-step",
    focusedWidth === true &&
      afterWidthUnits === keyUnits + 1 &&
      widthKeyWrite.count === 1 &&
      widthKeyWrite.pin?.span === 1 &&
      focusedHeight === true &&
      afterHeightKey.height >= heightBeforeKey.height + keyGeo.root - 2 &&
      heightKeyWrite.count === 2 &&
      typeof heightKeyWrite.pin?.height === "number" &&
      /height set to/i.test(spoken ?? ""),
    `one ArrowRight from ${keyUnits} unit(s) gave ${afterWidthUnits} ` +
      `(${widthKeyWrite.count} write(s)); one ArrowDown made ${OPERATOR} ` +
      `${Math.round(afterHeightKey.height)}px from ${Math.round(heightBeforeKey.height)}px ` +
      `(${heightKeyWrite.count} write(s) in total); the live region said ${JSON.stringify(spoken)}`,
  );
  summary.keys = {
    widthFrom: keyUnits,
    widthTo: afterWidthUnits,
    heightFrom: Math.round(heightBeforeKey.height),
    heightTo: Math.round(afterHeightKey.height),
    writes: heightKeyWrite.count,
    spoken,
  };

  // 8. A press outside the card ends Edit mode; a press inside it does not.
  step("edit-outside-exits");
  await drawBoard(win);
  await enterEditMode(win, OPERATOR);
  await clickSelector(win, `[data-pin-id="${OPERATOR}"] .view-card__title`);
  const afterInside = await editState(win, OPERATOR);
  await clickSelector(win, ".home-dashboard__title");
  await waitFor(
    win,
    `document.querySelectorAll(".home-pin.is-editing").length === 0`,
    "a press outside the card to leave Edit mode",
  );
  const afterOutside = await editState(win, OPERATOR);
  check(
    "edit-outside-exits",
    afterInside.editing === true &&
      afterOutside.editing === false &&
      afterOutside.handles.length === 0,
    `a press inside left editing=${afterInside.editing}; a press on the page's title left ` +
      `editing=${afterOutside.editing} with ${afterOutside.handles.length} handle(s)`,
  );
  summary.outside = {
    insideEditing: afterInside.editing,
    outsideEditing: afterOutside.editing,
    handlesAfter: afterOutside.handles.length,
  };

  // 9. Escape is the keyboard's way out.
  step("edit-escape-exits");
  await drawBoard(win);
  await enterEditMode(win, OPERATOR);
  await pressKey(win, "Escape");
  await waitFor(
    win,
    `document.querySelectorAll(".home-pin.is-editing").length === 0`,
    "Escape to leave Edit mode",
  );
  const escaped = await editState(win, OPERATOR);
  check(
    "edit-escape-exits",
    escaped.editing === false && escaped.handles.length === 0,
    `after Escape the card is editing=${escaped.editing} with ${escaped.handles.length} handle(s)`,
  );
  summary.escape = { editing: escaped.editing, handles: escaped.handles.length };

  // 10. A press on a border is not the board's arrange gesture, and a drag that
  //     ends where it started is not a size.
  step("edit-is-not-arrange");
  await drawBoard(win);
  await enterEditMode(win, OPERATOR);
  const still = await handleOf(win, OPERATOR, "width");
  mouse(win, "mouseDown", still.x, still.y);
  await sleep(420);
  const liftedDuring = await liftedIds(win);
  const heldAsResize = await win.webContents.executeJavaScript(
    'document.querySelectorAll(".home-pin.is-resizing").length',
  );
  mouse(win, "mouseUp", still.x, still.y);
  await sleep(220);
  const noopWrites = await pinWrites(win);
  check(
    "edit-is-not-arrange",
    liftedDuring.length === 0 && noopWrites.length === 0 && heldAsResize === 1,
    `a 420 ms press on the width border lifted ${JSON.stringify(liftedDuring)}, held ` +
      `${heldAsResize} resize(s), and wrote ${noopWrites.length} time(s)`,
  );
  summary.noop = {
    lifted: liftedDuring.length,
    writes: noopWrites.length,
    heldAsResize,
  };

  // 11. A locked board has no chrome and therefore no way into Edit mode.
  step("edit-locked");
  await drawBoard(win, { locked: true });
  const locked = await win.webContents.executeJavaScript(
    `(() => ({
       menus: document.querySelectorAll('[data-testid="pin-menu-toggle"]').length,
       handles: document.querySelectorAll("[data-pin-handle]").length,
       editing: document.querySelectorAll(".home-pin.is-editing").length,
     }))()`,
  );
  check(
    "edit-locked",
    locked.menus === 0 && locked.handles === 0 && locked.editing === 0,
    `a locked board drew ${locked.menus} menu(s), ${locked.handles} handle(s) and ` +
      `${locked.editing} editing card(s)`,
  );
  summary.locked = locked;
  return summary;
}

async function main() {
  const sessionPartition = `dashboard-tile-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: WIDTHS[0].width,
    height: WIDTHS[0].height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition,
      // This rig runs beside every other Electron window in the suite, and
      // Chromium throttles timers and stops painting in a window it decides is
      // occluded — which is exactly what a background rig is.
      backgroundThrottling: false,
    },
  });
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.dashboardTileReady)", "dashboardTileReady");

  const skin = await win.webContents.executeJavaScript(
    "({ name: window.dashboardTileSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  check(
    "skin",
    Boolean(skin.name) && skin.applied === skin.name,
    `the harness painted ${JSON.stringify(skin)}`,
  );

  await drawBoard(win);

  const boards = [];
  for (const entry of WIDTHS) {
    step(`${entry.name} (${entry.width}px)`);
    win.setContentSize(entry.width, entry.height);
    // The window is the input to the thing being measured: two settled frames
    // plus a beat, so the board is read after the resize has reached the layout
    // and the measurement has run rather than during it.
    await settleFrames(win);
    await sleep(180);
    boards.push({ name: entry.name, width: entry.width, board: await sample(win, entry.name) });
  }

  // Back to the first width once more: the round trip is what makes "the board
  // settles" a claim rather than a snapshot.
  step("wide again");
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  await settleFrames(win);
  await sleep(180);
  boards.push({ name: "wide-again", width: WIDTHS[0].width, board: await sample(win, "wide-again") });

  const board = boards[0].board;
  check(
    "board",
    board.cardCount === SEED.length + 1 &&
      SEED.every((id, index) => board.cards[index]?.id === id),
    `the board drew ${board.cardCount} card(s): ${JSON.stringify(board.cards.map((card) => card.id))}`,
  );
  checkRowsMix(boards);
  checkNoSpill(boards);
  checkCardFitsItsTable(boards);
  checkOperatorCard(boards);
  checkRowCard(boards);
  checkBoardFloors(boards);
  checkStable(boards);

  const writes = await win.webContents.executeJavaScript("window.dashboardTilePinWrites");
  checkNoWrite(writes);

  // The operator's own Edit card gesture, on a board nobody has dragged: the legs
  // below write pins, so they run after every claim that reads the board at rest.
  const edits = await checkEditMode(win);

  const unexpectedBridgeCalls = await win.webContents.executeJavaScript(
    "window.dashboardTileUnexpectedCalls",
  );
  check(
    "clean",
    consoleErrors.length === 0 && unexpectedBridgeCalls.length === 0,
    `the page logged ${consoleErrors.length} error(s) and reached for ${unexpectedBridgeCalls.length} ` +
      `unmodelled bridge method(s)${unexpectedBridgeCalls.length ? `: ${unexpectedBridgeCalls.join(", ")}` : ""}`,
  );

  // Two screenshots, and they are a deliverable rather than a claim. The
  // `wide` one is the board the operator actually works on — where the reported
  // card used to spill — and the `tiny` one is the reported case at its worst: a
  // window too small for the board's cells, so the sheet scrolled sideways rather
  // than a listing poured over its own frame. Same command, same picture, on any
  // machine.
  step("artifact");
  // The board the screenshots show is the seeded one, freshly drawn: the resize
  // legs above leave a card as wide as the rig dragged it, and the artifact is
  // the board the operator works on rather than the rig's last experiment.
  await drawBoard(win);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const shots = [
    { name: "dashboard-tile-wide.png", size: WIDTHS[0] },
    { name: "dashboard-tile.png", size: WIDTHS[WIDTHS.length - 1] },
  ];
  for (const shot of shots) {
    win.setContentSize(shot.size.width, shot.size.height);
    await settleFrames(win);
    await sleep(200);
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(artifactsDir, shot.name), image.toPNG());
    } catch (error) {
      console.log(`[${shot.name} skipped] ${error}`);
    }
  }

  // And Edit mode itself: the card's right and bottom borders, in the chrome the
  // operator sees. This is the picture a review of this change opens first.
  await drawBoard(win);
  win.setContentSize(WIDTHS[0].width, WIDTHS[0].height);
  await settleFrames(win);
  await sleep(180);
  await enterEditMode(win, HEIGHT_CARD);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, "dashboard-tile-edit.png"), image.toPNG());
  } catch (error) {
    console.log(`[dashboard-tile-edit.png skipped] ${error}`);
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "a dashboard whose cards are sized by what they hold, and by the operator's own hand: Edit " +
      "card in the 3-dot menu puts one card in Edit mode, its right and bottom borders drag a width " +
      "and a height onto the pin, and a press outside the card ends the mode; sizes are floors, so " +
      "no gesture can make a card spill its content",
    skin,
    checks: {
      scenarios,
      widths: boards.map((entry) => ({
        name: entry.name,
        width: entry.width,
        tracks: entry.board.tracks,
        unitRem: entry.board.unitRem,
        minUnits: entry.board.minUnits,
        gap: entry.board.gap,
        inlineMinWidth: entry.board.inlineMinWidth,
        gridWidth: entry.board.gridWidth,
        scrollport: entry.board.scrollport,
        rows: entry.board.rows,
        cards: entry.board.cards.map((card) => ({
          id: card.id,
          label: card.label,
          width: card.width,
          frame: card.frame,
          covered: card.covered,
          gridColumnStart: card.gridColumnStart,
          gridColumnEnd: card.gridColumnEnd,
          rowCard: card.rowCard,
          need: card.need,
          table: card.table,
          spills: card.spills,
        })),
      })),
      pinWrites: writes.length,
      /** The operator's Edit card gesture: what each leg measured, for the test to hold to. */
      edits,
      unexpectedBridgeCalls,
      consoleErrors,
    },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-tile.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  for (const entry of boards) {
    console.log(
      `${entry.name.padEnd(11)} ${entry.width}px: ${entry.board.tracks.length} track(s) ` +
        `${JSON.stringify(entry.board.tracks)}, board ${entry.board.gridWidth}px, ` +
        `rows ${JSON.stringify(entry.board.rows.map((row) => row.count))}`,
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
  console.error("dashboard-tile rig timed out");
  app.exit(1);
}, 90_000);
