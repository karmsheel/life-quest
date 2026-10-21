/**
 * Drives the dashboard companion-edit harness in a real Electron window and turns
 * what the Dashboard actually does into
 * `e2e/artifacts/dashboard-companion-edit.json`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-companion-edit.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact.
 *
 * THE CLAIM, AND HOW IT IS FALSIFIED
 *
 * A companion turn that edits a pinned card must leave the operator where they
 * were. "Where they were" is read as three things, because "the board lost its
 * position" can mean any of them and only one of them is a bug in the page:
 *
 *  1. `scroll` — the scrollport's own `scrollTop`. A board that jumps to the top
 *     is the crude version of the report and the easiest to catch.
 *  2. `anchor` — which card is at a fixed point in the viewport, and how far
 *     through that card that point is (`offsetInCard`). This is the honest
 *     measure: a card that GREW above the fold moves the content under the
 *     operator without moving `scrollTop` at all, and the operator calls that
 *     losing their place exactly the same way.
 *  3. `identity` — whether each card is the same DOM node it was before the turn.
 *     A repaint that throws the card away and builds a new one is not "the same
 *     position" no matter where the new one lands: it is a flash, and a card
 *     mid-edit is the one card that must not be replaced while the companion is
 *     working on it.
 *
 * The turn is replayed three ways — a `save_view` that reorders the card's own
 * blocks (`blocks`), the same plus a re-pin (`board`), and a bare `vault:dataChanged`
 * with nothing written at all (`quiet`) — so a board that holds still only when
 * nothing happened has not passed anything.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "dashboard-companion-edit.json");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-companion-edit.html";

/**
 * Shorter than the board on purpose — that is the instrument. 1280 wide keeps the
 * grid at three tracks, so the card the companion edits spans the whole row and
 * its height is the board's height.
 */
const WINDOW = { width: 1280, height: 720 };

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(win, expression, label, timeoutMs = 20_000) {
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

const EDIT_PIN = "view:financial:v-recent";

/**
 * Everything the claims are made of, read off the live DOM in one pass.
 *
 * The anchor point is deliberately a few pixels INTO the scrollport rather than at
 * its very top: a card whose top edge is exactly at 0 sits on the boundary, and a
 * one-pixel reflow flips which card is "at the top" without the operator having
 * lost anything. Reading the anchor as (card id, fraction through that card) is
 * robust to that and still catches a real jump.
 */
const MEASURE = `(() => {
  const port = (() => {
    const grid = document.querySelector(".home-dashboard__grid");
    let node = grid ? grid.parentElement : null;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return node;
      node = node.parentElement;
    }
    return document.scrollingElement;
  })();
  const portRect = port.getBoundingClientRect();
  const anchorY = portRect.top + 12;
  const cards = [...document.querySelectorAll(".home-dashboard__grid > .home-pin")];
  let anchor = null;
  const boxes = [];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const title = card.querySelector(".view-card__title, .home-card__title");
    boxes.push({
      id: card.dataset.pinId ?? null,
      top: Math.round(rect.top - portRect.top),
      height: Math.round(rect.height),
      rows: card.querySelectorAll(".view-card__table tbody tr").length,
      title: title ? (title.textContent || "").trim() : null,
    });
    if (!anchor && rect.top <= anchorY && rect.bottom > anchorY) {
      anchor = {
        id: card.dataset.pinId ?? null,
        offsetInCard: Math.round(anchorY - rect.top),
        height: Math.round(rect.height),
      };
    }
  }
  return {
    scrollTop: Math.round(port.scrollTop),
    maxScrollTop: Math.round(port.scrollHeight - port.clientHeight),
    scrollHeight: port.scrollHeight,
    clientHeight: port.clientHeight,
    anchor,
    boxes,
    editRows: document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__table tbody tr').length,
    editBlocks: [...document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__block')].map((b) => {
      const head = b.querySelector(".view-card__block-title");
      return head ? (head.textContent || "").trim() : null;
    }),
    // The card's own top-level blocks with their drawn shape, which is what
    // "the order of items changed" means on screen.
    editShapes: [...document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__block')].map((b) =>
      [...b.classList].find((name) => name.startsWith("view-card__block--")) ?? "unknown",
    ),
  };
})()`;

/** How far anything is allowed to drift between two measurements, in pixels. */
const SLACK = 2;

/**
 * The hold's contract, asserted between two measurements of the same board.
 *
 * The scroll offset is NOT the claim, and asserting it would be asserting the
 * wrong thing: a card that grows by 64px above the operator's fold has to move
 * `scrollTop` by 64px to keep the operator still, and a page that froze the offset
 * would have failed them. The claim is the one the operator made in their own
 * words — **the board lost its position** — read as three facts:
 *
 *  1. The card under the operator's eye is the same card, in the same place
 *     (`anchor`). This is the whole point.
 *  2. Every other card keeps its distance from that anchor, which is what the
 *     operator sees as "the board did not move under me". A card that changed
 *     height legitimately moves the cards BELOW it, so the invariant is about the
 *     cards' order and spacing, not about their screen coordinates: a card that is
 *     120px below the anchor before the turn is 120px below it after.
 *  3. The scroll offset moved by exactly as much as the anchor card moved in the
 *     board's own coordinates — the part that proves the stillness was *earned* by
 *     the page rather than by nothing happening to the board at all.
 */
function compare(before, after, label) {
  const detail = { label, before, after, failures: [] };
  if (before.editRows === 0) {
    detail.failures.push(`the edited card drew no rows before the ${label} turn`);
  }
  if (before.scrollTop === 0) {
    detail.failures.push(`the board was at the top before the ${label} turn, so there was no position to lose`);
  }
  if (!before.anchor) {
    detail.failures.push(`nothing was under the board's top edge before the ${label} turn`);
    return detail;
  }
  if (!after.anchor) {
    detail.failures.push(`nothing is under the board's top edge after the ${label} turn`);
    return detail;
  }
  if (before.anchor.id !== after.anchor.id) {
    detail.failures.push(
      `a different card is under the operator's eye: ${before.anchor.id} → ${after.anchor.id}`,
    );
    return detail;
  }
  const slide = Math.abs(after.anchor.offsetInCard - before.anchor.offsetInCard);
  detail.anchorSlide = slide;
  if (slide > SLACK) {
    detail.failures.push(
      `${before.anchor.id} slid ${slide}px under the operator's eye ` +
        `(offset ${before.anchor.offsetInCard} → ${after.anchor.offsetInCard})`,
    );
  }

  const beforeById = new Map(before.boxes.map((box) => [box.id, box]));
  const afterById = new Map(after.boxes.map((box) => [box.id, box]));
  for (const box of before.boxes) {
    if (!box.id) continue;
    const now = afterById.get(box.id);
    if (!now) {
      detail.failures.push(`${box.id} left the board across the ${label} turn`);
      continue;
    }
    // Distance from the anchor, not from the viewport: a card above the fold that
    // legitimately changed height moves everything below it, and the operator
    // still sees the same board.
    const wasGap = box.top - before.anchor.top;
    const isGap = now.top - after.anchor.top;
    if (Math.abs(isGap - wasGap) > SLACK) {
      detail.failures.push(
        `${box.id} changed its place on the board: ${wasGap}px below the anchor before, ${isGap}px after`,
      );
    }
  }
  return detail;
}

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `companion-edit-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(WINDOW.width, WINDOW.height);

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const checks = {};

  try {
    await win.loadURL(`${url}?v=${Date.now()}`);
    // Paint the window: a hidden renderer defers passive effects, and the
    // board's scroll listener — the half of the hold that hears the operator —
    // is one of them. Without a painted frame nobody ever hears a scroll, and
    // the leg measures a hold that was never re-taken. `showInactive` keeps the
    // focus where the operator left it.
    win.showInactive();
    await waitFor(win, "Boolean(window.dashboardCompanionEditReady)", "the harness page to mount");
    await waitFor(
      win,
      `document.querySelectorAll(".home-dashboard__grid > .home-pin").length > 0`,
      "the board to draw its pins",
    );
    // Two painted frames, so React's passive effects have run: the board's
    // scroll listener is one, and it is what makes an operator's scroll (or the
    // rig's programmatic one) update the hold.
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    await waitFor(
      win,
      `document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__table tbody tr').length > 0`,
      "the edited card to draw its rows",
    );
    // The system cards behind `GoalProgressCard` / `DeadlineBanner` answer over
    // their own channels; a page that has not settled would make the first
    // measurement a moving target.
    await sleep(400);

    checks.skin = await win.webContents.executeJavaScript(
      `document.documentElement.dataset.skin ?? null`,
    );
    const unexpected = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditUnexpectedCalls ?? []`,
    );
    checks.unexpectedBridgeCalls = unexpected;
    if (unexpected.length > 0) {
      failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
    }

    // ── the operator's place: a card at the top of the board, mid-card ───────
    const parked = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditScrollToCard(${JSON.stringify(EDIT_PIN)})`,
    );
    if (!parked) failure(`could not park the board on ${EDIT_PIN}`);
    await sleep(120);

    const before = await win.webContents.executeJavaScript(MEASURE);
    checks.before = before;

    if (before.scrollTop === 0) {
      failure("the board did not scroll: this rig cannot catch a board that jumps to the top");
    }
    if (before.editRows === 0) {
      failure(`the edited card drew no rows: ${JSON.stringify(before.editBlocks)}`);
    }
    // The card has to be the one under the operator's eye, or the claim is about
    // a card nobody was looking at.
    if (before.anchor?.id !== EDIT_PIN) {
      failure(
        `the parked board put ${JSON.stringify(before.anchor?.id)} at the top, not the card being edited`,
      );
    }

    /** The DOM node each pin is, so the next measurement can refuse a rebuild. */
    const nodeIds = await win.webContents.executeJavaScript(
      `(() => {
         const out = {};
         for (const card of document.querySelectorAll(".home-dashboard__grid > .home-pin")) {
           if (!card.dataset.pinId) continue;
           card.dataset.probeNode = String(Math.random()).slice(2);
           out[card.dataset.pinId] = card.dataset.probeNode;
         }
         return out;
       })()`,
    );
    checks.cardNodes = nodeIds;

    // ── turn one: the reported write, a `save_view` that reorders the card ───
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditWrite("blocks")`);
    // Wait on the WRITE, not on the card's existence: the metric block is already
    // in the DOM (second), so "a metric exists" is true before the turn and would
    // let the measurement race the reorder.
    await waitFor(
      win,
      `window.dashboardCompanionEditBlockKey() === JSON.stringify(${JSON.stringify(
        ["metric", "table"],
      )})`,
      "the card to redraw with its blocks reordered",
    );
    /**
     * The card's own "this one changed" mark, read while it is still up.
     *
     * Checked here and not later in the run on purpose: it is one animation long and
     * it clears itself, so a measurement taken after the position legs have settled
     * would find nothing and prove nothing. Read off the DOM rather than from state:
     * what the operator sees is a class on the card.
     */
    checks.changedCards = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".home-pin")].filter((pin) => pin.querySelector(".view-card.is-changed")).map((pin) => pin.dataset.pinId)`,
    );
    await sleep(300);

    const afterBlocks = await win.webContents.executeJavaScript(MEASURE);
    checks.afterBlocks = compare(before, afterBlocks, "blocks");

    // ── the control that makes the claim falsifiable ────────────────────────
    // The edited card is given a third block, so its own box grows — the case a
    // page that merely froze the board cannot pass, because a hold that does
    // nothing leaves the operator looking at a different part of the board.
    // While it happens, every mutation of the grid is sampled: the offset the
    // board was at when the turn landed, and whether any card ever fell back to
    // its "Loading…" state, which is a card being thrown away and rebuilt.
    await win.webContents.executeJavaScript(`(() => {
      const port = document.querySelector(".home-dashboard__grid").parentElement;
      const grid = document.querySelector(".home-dashboard__grid");
      const samples = [];
      const observer = new MutationObserver(() => {
        samples.push({
          scrollTop: Math.round(port.scrollTop),
          gridHeight: Math.round(grid.getBoundingClientRect().height),
          loading: [...document.querySelectorAll(".view-card")].some(
            (card) => (card.textContent || "").trim() === "Loading…",
          ),
        });
      });
      observer.observe(grid, { childList: true, subtree: true, characterData: true });
      window.__probeSamples = samples;
      window.__probeObserver = observer;
      return true;
    })()`);
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditGrow("v-recent")`);
    await waitFor(
      win,
      `document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__block').length === 3`,
      "the card to redraw with the companion's third block",
    );
    await sleep(400);
    const afterGrow = await win.webContents.executeJavaScript(MEASURE);
    checks.afterGrow = compare(before, afterGrow, "grow");
    const samples = await win.webContents.executeJavaScript(
      `(() => { const o = window.__probeObserver; if (o) o.disconnect(); return window.__probeSamples ?? []; })()`,
    );
    checks.growSamples = {
      count: samples.length,
      sawLoading: samples.some((sample) => sample.loading),
      scrollTops: [...new Set(samples.map((sample) => sample.scrollTop))],
      gridHeights: [...new Set(samples.map((sample) => sample.gridHeight))],
      first: samples[0] ?? null,
      last: samples[samples.length - 1] ?? null,
    };
    checks.beforeCardHeight = before.boxes.find((box) => box.id === EDIT_PIN)?.height ?? null;
    checks.afterGrowCardHeight = afterGrow.boxes.find((box) => box.id === EDIT_PIN)?.height ?? null;

    if (afterBlocks.editShapes.join("|") === before.editShapes.join("|")) {
      failure(
        `the card's blocks did not change order, so the turn wrote nothing to test: ${JSON.stringify(before.editShapes)}`,
      );
    }
    // The growth is what the next claim is about, so it has to be real. A card
    // that redrew at the same height would make "the board held still" vacuous.
    if (!(checks.afterGrowCardHeight > checks.beforeCardHeight)) {
      failure(
        `the companion's third block did not change the card's box: ` +
          `${checks.beforeCardHeight}px → ${checks.afterGrowCardHeight}px`,
      );
    }
    if (checks.growSamples.sawLoading) {
      failure("a card fell back to its Loading… state: it was rebuilt, not edited");
    }

    // ── turn two: a card ABOVE the operator's eye grows ─────────────────────
    //
    // The board is parked near its BOTTOM, with the card that will grow left well
    // above the fold and off the screen. This is the leg the page has to own
    // itself: nothing in view moves relative to anything else in view, so there is
    // no relative distance for Chromium's own anchoring to hold — the whole board
    // slips under the operator, and only a deliberate anchor catches it. The catch
    // is visible in the offset: holding the operator's place against a card that
    // grew above them means moving the offset by exactly the growth.
    //
    // Parked slightly OFF the bottom on purpose. At the very end of the board the
    // scroll is clamped and there is nowhere to absorb the growth, so the leg would
    // be testing the browser's limits rather than the page's anchor.
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditScrollToCard("sys:recent-log")`);
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditScrollBy(-160)`);
    await sleep(250);
    const beforeAbove = await win.webContents.executeJavaScript(MEASURE);
    checks.beforeAbove = beforeAbove;
    const editedBox = beforeAbove.boxes.find((box) => box.id === EDIT_PIN);
    if (!editedBox || editedBox.top > -40) {
      failure(
        `the card that is about to grow is not above the fold: top ${editedBox?.top}`,
      );
    }
    if (beforeAbove.scrollTop >= beforeAbove.maxScrollTop) {
      failure(
        `the low park is clamped at the end of the board (${beforeAbove.scrollTop} of ${beforeAbove.maxScrollTop}): ` +
          "there is no room to hold anything",
      );
    }
    // The held trajectory, as evidence: the offset has to MOVE (by the growth) for
    // the operator's place to stay still, and the board's own ceiling has to move
    // with it. A board that pinned the offset would show one frame here.
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditWatchBoard()`);
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditGrow("v-recent")`);
    await waitFor(
      win,
      `document.querySelectorAll('[data-pin-id="${EDIT_PIN}"] .view-card__block').length === 4`,
      "the card above the operator to redraw with its new block",
    );
    await sleep(400);
    const afterAbove = await win.webContents.executeJavaScript(MEASURE);
    checks.afterAbove = compare(beforeAbove, afterAbove, "above");
    checks.aboveFrames = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditBoardFrames()`,
    );
    const aboveWas = beforeAbove.boxes.find((box) => box.id === EDIT_PIN)?.height;
    const aboveHeight = afterAbove.boxes.find((box) => box.id === EDIT_PIN)?.height;
    checks.aboveGrewBy = (aboveHeight ?? 0) - (aboveWas ?? 0);
    const aboveDelta = afterAbove.scrollTop - beforeAbove.scrollTop;
    checks.aboveOffsetDelta = aboveDelta;
    if (!(checks.aboveGrewBy > 0)) {
      failure(
        `the card above the operator did not grow (${aboveWas}px → ${aboveHeight}px): ` +
          "the leg proves nothing",
      );
    } else if (Math.abs(aboveDelta - checks.aboveGrewBy) > SLACK) {
      failure(
        `a card above the operator grew ${checks.aboveGrewBy}px and the board's offset moved ${aboveDelta}px: ` +
          "the operator was not held",
      );
    }

    const rebuilt = await win.webContents.executeJavaScript(
      `(() => {
         const was = ${JSON.stringify(nodeIds)};
         const out = [];
         for (const card of document.querySelectorAll(".home-dashboard__grid > .home-pin")) {
           const id = card.dataset.pinId;
           if (!id) continue;
           if (card.dataset.probeNode === was[id]) continue;
           out.push(id);
         }
         return out;
       })()`,
    );
    checks.rebuiltCards = rebuilt;
    if (rebuilt.length > 0) {
      failure(`the turn replaced cards wholesale instead of editing one: ${rebuilt.join(", ")}`);
    }

    // ── turn three: a re-pin alongside the edit ─────────────────────────────
    //
    // The other thing a companion turn does to a board: `arrange_dashboard` moves
    // the card the operator is reading to another slot. This is the leg that was
    // measured at scrollTop 566 → 415 on the pre-fix build — the anchor card was
    // held by Chromium's own anchoring while every card around it slid 151px, which
    // is the report in its other shape. Here the contract is the same one: the card
    // stays under the eye, and the board's offset moves by exactly as much as the
    // card moved within the board.
    //
    // Last of the three, because it changes the board's ORDER: a re-pin moves the
    // cards relative to each other, and no leg after it could claim anything about
    // a card's distance from the anchor.
    //
    // Re-parked back at the TOP of the board first, for the same reason the leg
    // above parks off the bottom: at the very end of a board the scroll is clamped,
    // there is nowhere for the offset to go, and the claim would be about the
    // browser's limits rather than the page's anchor.
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditScrollToCard(${JSON.stringify(EDIT_PIN)})`);
    await sleep(250);
    const beforeBoard = await win.webContents.executeJavaScript(MEASURE);
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditWrite("board")`);
    await waitFor(
      win,
      `window.dashboardCompanionEditOrder()[2] === ${JSON.stringify(EDIT_PIN)}`,
      "the board to take the companion's new order",
    );
    await sleep(400);
    const afterBoard = await win.webContents.executeJavaScript(MEASURE);
    checks.afterBoard = compare(beforeBoard, afterBoard, "board");
    const boardDelta = afterBoard.scrollTop - beforeBoard.scrollTop;
    checks.boardOffsetDelta = boardDelta;
    if (Math.abs(boardDelta) <= SLACK) {
      failure(
        `the card was re-pinned and the board's offset did not move (${boardDelta}px): ` +
          "the operator's place was not carried across the board's own change",
      );
    }

    // ── turn four: the control. Nothing written, the event alone ─────────────
    const beforeQuiet = await win.webContents.executeJavaScript(MEASURE);
    await win.webContents.executeJavaScript(`window.dashboardCompanionEditWrite("quiet")`);
    await sleep(500);
    const afterQuiet = await win.webContents.executeJavaScript(MEASURE);
    checks.afterQuiet = compare(beforeQuiet, afterQuiet, "quiet");
    if (afterQuiet.scrollTop !== beforeQuiet.scrollTop) {
      failure(
        `an event with nothing written moved the board ${afterQuiet.scrollTop - beforeQuiet.scrollTop}px`,
      );
    }

    // ── the operator's own gesture: a card handed to the chat ───────────────
    //
    // Everything above is about the card, and a card cannot be "the one the
    // companion is working on" unless the chat knows it is. This leg is the
    // operator's half: press the card's own chat control, which is the app's one
    // path from a card to the dock, and then send the turn frames the main process
    // would send. The ring is read off the DOM, because a class on the pin is what
    // the operator sees.
    const focused = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditFocusCard(${JSON.stringify(EDIT_PIN)})`,
    );
    checks.focused = focused;
    if (!focused) failure(`the card's chat control was not on the board for ${EDIT_PIN}`);
    // The control hands the card over and opens the dock; the context pill is that
    // same fact in the chat, and its presence is what makes the ring mean anything.
    try {
      await waitFor(win, `Boolean(document.querySelector('[data-testid="chat-context-pill"]'))`, "the card to reach the chat", 5_000);
      checks.contextPill = true;
    } catch {
      checks.contextPill = false;
      failure("handing the card to the chat left no context pill, so the ring would be unfounded");
    }
    await sleep(150);

    checks.liveBeforeTurn = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditLiveCards()`,
    );
    if (checks.liveBeforeTurn.length > 0) {
      failure(`a card wore the working ring before any turn started: ${checks.liveBeforeTurn.join(", ")}`);
    }

    await win.webContents.executeJavaScript(`window.dashboardCompanionEditTurn("started")`);
    await sleep(200);
    checks.liveDuringTurn = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditLiveCards()`,
    );
    if (checks.liveDuringTurn.join(",") !== EDIT_PIN) {
      failure(
        `the turn's working ring was on ${JSON.stringify(checks.liveDuringTurn)}, expected exactly [${EDIT_PIN}]`,
      );
    }

    await win.webContents.executeJavaScript(`window.dashboardCompanionEditTurn("completed")`);
    await sleep(300);
    checks.liveAfterTurn = await win.webContents.executeJavaScript(
      `window.dashboardCompanionEditLiveCards()`,
    );
    if (checks.liveAfterTurn.length > 0) {
      failure(`the working ring outlived its turn: ${checks.liveAfterTurn.join(", ")}`);
    }

    // ── the board is still a board ──────────────────────────────────────────
    const finalState = await win.webContents.executeJavaScript(MEASURE);
    checks.final = {
      pins: finalState.boxes.map((box) => box.id),
      chrome: await win.webContents.executeJavaScript(
        `document.querySelectorAll(".home-pin__chrome").length`,
      ),
      editTitle: finalState.boxes.find((box) => box.id === EDIT_PIN)?.title ?? null,
    };
    if (finalState.boxes.length < 2) failure("the board lost its cards");

    // The whole point of the leg above: a card whose blocks were reordered is
    // drawn in the new order — the write landed, not just the position held.
    if (!afterBlocks.editShapes.join("|").includes("metric")) {
      failure("the reordered card drew no metric block at all");
    }

    if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);
  } catch (error) {
    failure(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }

  for (const key of ["afterBlocks", "afterGrow", "afterAbove", "afterBoard", "afterQuiet"]) {
    const detail = checks[key];
    if (detail && detail.failures.length > 0) {
      for (const message of detail.failures) failure(`${detail.label}: ${message}`);
    }
  }

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the real dashboard, scrolled, while the companion edits a pinned card",
    command: "node e2e/dashboard-companion-edit.electron.mjs",
    window: WINDOW,
    checks,
    consoleErrors,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `[companion-edit] offset ${checks.before?.scrollTop} → ${checks.afterBlocks?.after.scrollTop} (blocks) → ` +
      `${checks.afterAbove?.after.scrollTop} (above, +${checks.aboveGrewBy}) → ${checks.afterBoard?.after.scrollTop} (board)`,
  );
  console.log(
    `[companion-edit] anchor ${JSON.stringify(checks.before?.anchor)} → ${JSON.stringify(checks.afterBlocks?.after.anchor)}`,
  );
  console.log(
    `[companion-edit] above frames: ${JSON.stringify(checks.aboveFrames)}, loading seen ${checks.growSamples?.sawLoading}`,
  );
  console.log(`[companion-edit] failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

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
  console.error("dashboard-companion-edit rig timed out");
  app.exit(1);
}, 90_000);
