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
 *  9. `width-control` — the card's width control names the two widths it offers.
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
    const control = card.querySelector('[data-testid="pin-span"]');
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
      widthControl: control ? control.getAttribute("aria-label") : null,
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
async function drawBoard(win) {
  await win.webContents.executeJavaScript("window.dashboardTileRender(1); true");
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

/** 8. The width control names the two widths it offers. */
function checkWidthControl(board) {
  const problems = [];
  const readings = [];
  for (const id of [LISTING, ROW_CARD]) {
    const card = cardOf(board, id);
    if (!card) {
      problems.push(`no card for ${id}`);
      continue;
    }
    readings.push(`${id}: ${JSON.stringify(card.widthControl)}`);
    if (!card.widthControl) {
      problems.push(`${id} draws no width control`);
      continue;
    }
    if (id === ROW_CARD && !/content/i.test(card.widthControl)) {
      problems.push(`${id} is the row card and its width control says ${JSON.stringify(card.widthControl)}`);
    }
    if (id === LISTING && !/row/i.test(card.widthControl)) {
      problems.push(`${id} is content-sized and its width control says ${JSON.stringify(card.widthControl)}`);
    }
  }
  return check("width-control", problems.length === 0, problems.join("; ") || readings.join("; "));
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
  checkWidthControl(board);

  const writes = await win.webContents.executeJavaScript("window.dashboardTilePinWrites");
  checkNoWrite(writes);

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

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what:
      "a dashboard whose cards are sized by what they hold, in layout units a quarter of the cell " +
      "this board used to be built from: a four-column listing draws at the width its columns need " +
      "inside a card within one step of that width, a one-number metric stays small, and a window " +
      "too small for the board scrolls the sheet sideways instead of squeezing a card until its " +
      "content spills over the frame",
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
          widthControl: card.widthControl,
          need: card.need,
          table: card.table,
          spills: card.spills,
        })),
      })),
      pinWrites: writes.length,
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
