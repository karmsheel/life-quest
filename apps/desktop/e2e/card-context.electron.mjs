/**
 * Drives the card-context harness in a real Electron window and turns what the
 * chat panel actually renders into `e2e/artifacts/card-context.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/card-context.electron.mjs
 *
 * Exit code 0 = every claim held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. `the-harness-board-offers-three-cards` — the board really has three
 *     distinct cards on it, each a click target with a context toggle, and no
 *     chat icon. Without this, "one pill per card" and "three cards hold at
 *     once" would be claims about a board that could not break them.
 *  2. `no-card-no-pill-and-no-context` — the feature is absent when it is not
 *     used. No pill, no container, an empty dock, and the turn's instruction
 *     context has no `focusedCards` key at all — nor the old `focusedCard` one:
 *     a turn with no card must stay the turn it always was.
 *  3. `one-pill-per-card-in-the-order-added` — three cards in, three pills out,
 *     in the order they were chosen, each named off its own heading and carrying
 *     the pin id its remove button addresses. The container wraps rather than
 *     squeezing the field, and the field keeps the width it had with no pills.
 *  4. `each-pill-removes-only-its-card` — pressing the middle pill's remove takes
 *     that card and only that card out: the other two pills stay, in order, and
 *     their cards keep their rings. The dock does not close on a removal.
 *  5. `a-three-card-turn-carries-focusedcards` — the payload's `focusedCards` is
 *     exactly the three cards, field by field and in order, and there is no
 *     `focusedCard` key. This is the claim the whole feature exists for.
 *  6. `the-click-join-puts-the-card-in-the-pill-and-the-caret-in-the-composer` —
 *     the join, end to end on one page: a real press on the real Dashboard's
 *     card body grows the real panel's pill, puts the caret in the composer, and
 *     the turn that follows carries exactly that card.
 *  7. `removing-the-last-pill-restores-the-ordinary-turn` — the last pill away
 *     leaves no pill, an empty dock, no ring, and a turn with no card key.
 *  8. `only-the-dashboard-clears-the-context` — pressing the chat or the rail
 *     leaves the cards held (the operator may work while the context is kept);
 *     pressing the Dashboard's own empty space clears every card at once.
 *
 * The bridge is a stub (a dev-server page has no preload), so this rig ends at
 * the recorded payload. What the companion *does* with the lines is the agent's,
 * and the wording is claimed in `tests/agent-prompts-e2e.test.ts`, which builds
 * the real instructions.
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/card-context.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * The three cards the harness board offers, in board order. Each is the shape
 * the Dashboard's card click builds, so the rig proves the panel and the turn
 * read *that* shape and not a convenient one it invented.
 */
const CARD_A = {
  pin: {
    id: "view:financial:v-weekly",
    kind: "view",
    domainSlug: "financial",
    viewId: "v-weekly",
    span: 1,
  },
  label: "Weekly expenses",
  boardSlug: null,
};
const CARD_B = {
  pin: {
    id: "view:financial:v-summary",
    kind: "view",
    domainSlug: "financial",
    viewId: "v-summary",
    span: 1,
  },
  label: "Spending by month",
  boardSlug: null,
};
const CARD_C = {
  pin: {
    id: "view:financial:v-cashflow",
    kind: "view",
    domainSlug: "financial",
    viewId: "v-cashflow",
    span: 1,
  },
  label: "Cash flow",
  boardSlug: null,
};
const CARDS = [CARD_A, CARD_B, CARD_C];

/** What the turn must carry for a card, field by field. */
const focusedOf = (card) => ({
  label: card.label,
  pinId: card.pin.id,
  kind: "view",
  boardSlug: null,
  domainSlug: "financial",
  viewId: card.pin.viewId,
});

/** The three cards, and everything about them the claims read, in one pass. */
const SAMPLE = `(() => {
  const container = document.querySelector('[data-testid="chat-context-pills"]');
  const pills = [...document.querySelectorAll('[data-testid="chat-context-pill"]')];
  const field = document.querySelector('.chat-panel__composer-input');
  const containerRect = container ? container.getBoundingClientRect() : null;
  const fieldRect = field ? field.getBoundingClientRect() : null;
  const heading = (card) => {
    const el = card.querySelector('.home-card__title, .view-card__title');
    return el ? (el.textContent || '').trim() : null;
  };
  const cards = [...document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]')];
  const cardState = (card) => {
    const style = getComputedStyle(card);
    const toggle = card.querySelector('[data-testid="pin-context-toggle"]');
    return {
      id: card.dataset.pinId ?? null,
      heading: heading(card),
      inContext: card.classList.contains('is-in-context'),
      outline: { style: style.outlineStyle, width: style.outlineWidth },
      toggle: toggle
        ? {
            pressed: toggle.getAttribute('aria-pressed'),
            label: toggle.getAttribute('aria-label'),
            pinId: toggle.dataset.contextPinId ?? null,
          }
        : null,
    };
  };
  return {
    composer: field
      ? {
          placeholder: field.getAttribute('placeholder'),
          disabled: field.disabled,
          width: fieldRect.width,
          left: fieldRect.left,
          right: fieldRect.right,
          top: fieldRect.top,
        }
      : null,
    container: container
      ? {
          testId: container.dataset.testid ?? null,
          classes: container.className,
          count: pills.length,
          flexWrap: getComputedStyle(container).flexWrap,
          display: getComputedStyle(container).display,
          bottom: containerRect.bottom,
          left: containerRect.left,
          right: containerRect.right,
          height: containerRect.height,
          fieldTop: fieldRect ? fieldRect.top : null,
        }
      : null,
    pills: pills.map((pill) => {
      const remove = pill.querySelector('[data-testid="chat-context-remove"]');
      const svg = pill.querySelector('svg');
      return {
        pinId: pill.dataset.contextPinId ?? null,
        text: (pill.textContent || '').trim(),
        label: (pill.querySelector('.chat-panel__context-label') || {}).textContent?.trim() ?? null,
        kind: (pill.querySelector('.chat-panel__context-kind') || {}).textContent?.trim() ?? null,
        svgs: pill.querySelectorAll('svg').length,
        icon: svg ? [...svg.classList].join(' ') : null,
        remove: remove
          ? {
              testId: remove.dataset.testid ?? null,
              pinId: remove.dataset.contextPinId ?? null,
              label: remove.getAttribute('aria-label'),
            }
          : null,
      };
    }),
    cards: cards.map(cardState),
    inContextCards: cards.filter((card) => card.classList.contains('is-in-context')).map((c) => c.dataset.pinId),
    active: (() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, cls: String(el.className ?? '') } : null;
    })(),
    dock: window.cardContextDock ?? null,
    calls: (window.__cardChatCalls ?? []).length,
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

const sample = (win) => win.webContents.executeJavaScript(SAMPLE);
const calls = (win) => win.webContents.executeJavaScript("window.__cardChatCalls ?? []");
const dock = (win) => win.webContents.executeJavaScript("window.cardContextDock ?? null");

/** Install one card in the dock, exactly as the Dashboard's card click does. */
async function toggleCard(win, card) {
  const before = ((await dock(win))?.contextCards ?? []).length;
  await win.webContents.executeJavaScript(
    `window.cardContextToggleCard(${JSON.stringify(card)})`,
  );
  await waitFor(
    win,
    `((window.cardContextDock ?? {}).contextCards ?? []).length !== ${before}`,
    `the dock to change size from ${before}`,
  );
}

/** Empty the dock through the probe's clear action. */
async function clearCards(win) {
  await win.webContents.executeJavaScript("window.cardContextClearCards()");
  await waitFor(
    win,
    `((window.cardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the dock to empty",
  );
}

/** Press one pill's remove control, by pin id, and wait for that pill to go. */
async function removePill(win, pinId) {
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="chat-context-remove"][data-context-pin-id=${JSON.stringify(pinId)}]').click()`,
  );
  await waitFor(
    win,
    `!document.querySelector('[data-testid="chat-context-pill"][data-context-pin-id=${JSON.stringify(pinId)}]')`,
    `the ${pinId} pill to go`,
  );
  await sleep(40);
}

/** Type into the composer the way a keyboard would, then send the turn. */
async function send(win, text) {
  const before = (await calls(win)).length;
  await win.webContents.executeJavaScript(`(async () => {
    const el = document.querySelector('.chat-panel__composer-input');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const send = document.querySelector('.chat-panel__send');
    if (!send) return false;
    send.click();
    return true;
  })()`);
  await waitFor(win, `(window.__cardChatCalls ?? []).length > ${before}`, "the turn to be sent");
  return (await calls(win))[before];
}

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function pointAt(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       if (r.width < 1 || r.height < 1) return null;
       return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
     })()`,
  );
  if (!point) throw new Error(`no visible element for ${selector}`);
  return point;
}

/** A real press inside a card's own content, never on one of its controls. */
async function cardPoint(win, pinId) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-pin-id=${JSON.stringify(pinId)}]');
    if (!card) return null;
    const excluded = 'a, button, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [role="separator"], [data-pin-handle]';
    const candidates = [];
    const heading = card.querySelector('.home-card__title, .view-card__title');
    if (heading) {
      const h = heading.getBoundingClientRect();
      candidates.push({ x: h.left + h.width * 0.35, y: h.top + h.height / 2 });
    }
    const cell = card.querySelector('.view-card__table tbody td');
    if (cell) {
      const c = cell.getBoundingClientRect();
      candidates.push({ x: c.left + c.width / 2, y: c.top + c.height / 2 });
    }
    const r = card.getBoundingClientRect();
    candidates.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
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

/** A real press-and-release on a point. */
async function press(win, point) {
  mouse(win, "mouseDown", point.x, point.y);
  await sleep(40);
  mouse(win, "mouseUp", point.x, point.y);
  await sleep(80);
}

/** A key-order-free comparison: the claim is about fields, not literal order. */
function sameFields(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  const keys = (o) => Object.keys(o).sort();
  const a = keys(actual);
  const b = keys(expected);
  if (a.join(",") !== b.join(",")) return false;
  return a.every((k) => actual[k] === expected[k]);
}

const drawnRing = (card) =>
  card?.outline?.style === "solid" && parseFloat(card.outline.width ?? "0") >= 1;

async function main() {
  const sessionPartition = `card-context-${Date.now()}`;
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
  await win.webContents.executeJavaScript("window.cardContextReady");
  await waitFor(win, "Boolean(document.querySelector('.chat-panel__composer-input'))", "the composer");
  // The panel resumes the last chat asynchronously; without a session the field
  // is disabled and nothing can be sent.
  await waitFor(
    win,
    `!document.querySelector('.chat-panel__composer-input').disabled`,
    "the composer to be usable",
  );
  await waitFor(
    win,
    `document.querySelectorAll('.home-dashboard__grid > .home-pin[data-pin-id]').length === ${CARDS.length}`,
    "the three-card board to draw",
  );

  const checks = {};

  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.cardContextSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. the board really offers three cards ────────────────────────────────
  const board = await sample(win);
  checks.board = board;
  check(
    "the-harness-board-offers-three-cards",
    board.cards.length === CARDS.length &&
      JSON.stringify(board.cards.map((card) => card.id)) ===
        JSON.stringify(CARDS.map((card) => card.pin.id)) &&
      board.cards.every(
        (card, index) =>
          card.heading === CARDS[index].label &&
          card.toggle?.pinId === card.id &&
          card.inContext === false,
      ) &&
      board.cards.every((card) => card.toggle?.pressed === "false") &&
      board.pills.length === 0 &&
      (await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-testid="pin-chat"]').length === 0 && document.querySelectorAll('.home-pin__chat').length === 0`,
      )),
    `the board read ${JSON.stringify({
      ids: board.cards.map((card) => card.id),
      headings: board.cards.map((card) => card.heading),
      toggles: board.cards.map((card) => card.toggle),
    })}`,
  );

  // ── 2. no card, no pill, and the turn is the turn it always was ───────────
  const bare = await send(win, "What is on my board?");
  const bareContext = bare?.instructionsContext ?? {};
  const bareBefore = await sample(win);
  checks.bareTurn = {
    focusedCards: Object.prototype.hasOwnProperty.call(bareContext, "focusedCards")
      ? bareContext.focusedCards
      : "<absent>",
    focusedCard: Object.prototype.hasOwnProperty.call(bareContext, "focusedCard")
      ? bareContext.focusedCard
      : "<absent>",
    pill: bareBefore.pills.length === 0 ? null : bareBefore.pills,
    container: bareBefore.container,
    dock: bareBefore.dock,
    keys: Object.keys(bareContext).sort(),
  };
  check(
    "no-card-no-pill-and-no-context",
    bareBefore.pills.length === 0 &&
      bareBefore.container === null &&
      (bareBefore.dock?.contextCards ?? []).length === 0 &&
      (bareBefore.dock?.livePinIds ?? []).length === 0 &&
      !Object.prototype.hasOwnProperty.call(bareContext, "focusedCards") &&
      !Object.prototype.hasOwnProperty.call(bareContext, "focusedCard"),
    `with no card in context the panel drew ${JSON.stringify(bareBefore.pills)} and sent ` +
      `focusedCards=${JSON.stringify(checks.bareTurn.focusedCards)} ` +
      `focusedCard=${JSON.stringify(checks.bareTurn.focusedCard)}`,
  );
  const bareFieldWidth = bareBefore.composer?.width ?? null;

  // ── 3. one pill per card, in the order added ──────────────────────────────
  await toggleCard(win, CARD_A);
  await toggleCard(win, CARD_B);
  await toggleCard(win, CARD_C);
  const held = await sample(win);
  checks.held = held;
  check(
    "one-pill-per-card-in-the-order-added",
    held.pills.length === CARDS.length &&
      JSON.stringify(held.pills.map((pill) => pill.label)) ===
        JSON.stringify(CARDS.map((card) => card.label)) &&
      JSON.stringify(held.pills.map((pill) => pill.pinId)) ===
        JSON.stringify(CARDS.map((card) => card.pin.id)) &&
      JSON.stringify((held.dock?.contextCards ?? []).map((card) => card.pin.id)) ===
        JSON.stringify(CARDS.map((card) => card.pin.id)) &&
      held.pills.every(
        (pill, index) =>
          pill.text.includes(CARDS[index].label) &&
          pill.remove?.testId === "chat-context-remove" &&
          pill.remove?.pinId === CARDS[index].pin.id &&
          pill.remove?.label === `Remove "${CARDS[index].label}" from context` &&
          pill.svgs >= 1 &&
          (pill.icon ?? "").includes("lucide-message-square"),
      ) &&
      held.container !== null &&
      held.container.testId === "chat-context-pills" &&
      held.container.count === CARDS.length &&
      held.container.flexWrap === "wrap" &&
      held.container.bottom <= (held.container.fieldTop ?? 0) + 1 &&
      held.container.left >= (held.composer?.left ?? 0) - 1 &&
      held.container.right <= (held.composer?.right ?? 0) + 1 &&
      Math.abs((held.composer?.width ?? 0) - (bareFieldWidth ?? 0)) <= 1 &&
      JSON.stringify(held.inContextCards) ===
        JSON.stringify(CARDS.map((card) => card.pin.id)) &&
      held.cards.every((card) => drawnRing(card)),
    `three cards in gave ${JSON.stringify(held.pills)} with container ` +
      `${JSON.stringify(held.container)} and rings ${JSON.stringify(held.inContextCards)}`,
  );

  // ── 4. each pill removes only its card ────────────────────────────────────
  const turnsBeforePill = (await calls(win)).length;
  await removePill(win, CARD_B.pin.id);
  const afterPill = await sample(win);
  checks.afterPill = afterPill;
  const expectedAfterPill = [CARD_A.pin.id, CARD_C.pin.id];
  check(
    "each-pill-removes-only-its-card",
    afterPill.pills.length === 2 &&
      JSON.stringify(afterPill.pills.map((pill) => pill.pinId)) === JSON.stringify(expectedAfterPill) &&
      JSON.stringify(afterPill.pills.map((pill) => pill.label)) ===
        JSON.stringify([CARD_A.label, CARD_C.label]) &&
      JSON.stringify((afterPill.dock?.contextCards ?? []).map((card) => card.pin.id)) ===
        JSON.stringify(expectedAfterPill) &&
      JSON.stringify(afterPill.inContextCards) === JSON.stringify(expectedAfterPill) &&
      afterPill.dock?.open === true &&
      (await calls(win)).length === turnsBeforePill,
    `removing ${CARD_B.pin.id} left pills ${JSON.stringify(afterPill.pills.map((pill) => pill.pinId))}, ` +
      `dock ${JSON.stringify((afterPill.dock?.contextCards ?? []).map((card) => card.pin.id))}, ` +
      `rings ${JSON.stringify(afterPill.inContextCards)}`,
  );

  // ── 5. a three-card turn carries the array, exactly ───────────────────────
  await toggleCard(win, CARD_B);
  const beforeThree = (await calls(win)).length;
  const threeTurn = await send(win, "Compare these cards");
  const threeContext = threeTurn?.instructionsContext ?? {};
  // The middle card was taken out and put back, so it now sits at the end: the
  // order is the order the cards were ADDED, not the board's order.
  const expectedThree = [CARD_A, CARD_C, CARD_B].map(focusedOf);
  const threeFocused = threeContext.focusedCards;
  checks.threeCardTurn = {
    focusedCards: threeFocused ?? null,
    hasFocusedCard: Object.prototype.hasOwnProperty.call(threeContext, "focusedCard"),
    expected: expectedThree,
    turns: (await calls(win)).length,
  };
  check(
    "a-three-card-turn-carries-focusedcards",
    Array.isArray(threeFocused) &&
      threeFocused.length === 3 &&
      threeFocused.every((card, index) => sameFields(card, expectedThree[index])) &&
      JSON.stringify(threeFocused.map((card) => card.pinId)) ===
        JSON.stringify([CARD_A.pin.id, CARD_C.pin.id, CARD_B.pin.id]) &&
      !Object.prototype.hasOwnProperty.call(threeContext, "focusedCard") &&
      (await calls(win)).length === beforeThree + 1,
    `the turn carried ${JSON.stringify(checks.threeCardTurn.focusedCards)}; expected ` +
      `${JSON.stringify(expectedThree)}; focusedCard key ` +
      `${checks.threeCardTurn.hasFocusedCard}`,
  );

  // ── 6. the operator's own click, all the way to the turn ──────────────────
  // Everything above starts from cards the probe installed. This starts where
  // the operator starts: a real press on a real card body on the board.
  await clearCards(win);
  const beforeClick = (await calls(win)).length;
  await press(win, await cardPoint(win, CARD_A.pin.id));
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="chat-context-pill"]'))`,
    "the pill from a real click",
  );
  await waitFor(
    win,
    `Boolean(document.activeElement && document.activeElement.classList.contains('chat-panel__composer-input'))`,
    "the caret in the composer",
  );
  const fromTheCard = await sample(win);
  const clickedRing = fromTheCard.cards.find((card) => card.id === CARD_A.pin.id) ?? null;
  const byTheClick = await send(win, "Turn this into a bar chart");
  checks.fromTheCard = {
    pill: fromTheCard.pills[0] ?? null,
    pills: fromTheCard.pills.length,
    active: fromTheCard.active,
    dock: fromTheCard.dock,
    ring: clickedRing,
    focusedCards: byTheClick?.instructionsContext?.focusedCards ?? null,
    turns: (await calls(win)).length,
  };
  const joinParts = {
    onePill: fromTheCard.pills.length === 1,
    named: fromTheCard.pills[0]?.label === CARD_A.label,
    pinId: fromTheCard.pills[0]?.pinId === CARD_A.pin.id,
    dockOpen: fromTheCard.dock?.open === true,
    dockHolds: JSON.stringify((fromTheCard.dock?.contextCards ?? []).map((card) => card.pin.id)) ===
      JSON.stringify([CARD_A.pin.id]),
    caret: fromTheCard.active?.tag === "TEXTAREA",
    caretInField: (fromTheCard.active?.cls ?? "").includes("chat-panel__composer-input"),
    ring: clickedRing?.inContext === true,
    ringDrawn: drawnRing(clickedRing),
    focusedIsArray: Array.isArray(byTheClick?.instructionsContext?.focusedCards),
    focusedMatches: sameFields(
      byTheClick?.instructionsContext?.focusedCards?.[0],
      focusedOf(CARD_A),
    ),
    turns: (await calls(win)).length === beforeClick + 1,
    beforeClick,
    callsAfter: (await calls(win)).length,
  };
  checks.joinParts = joinParts;
  check(
    "the-click-join-puts-the-card-in-the-pill-and-the-caret-in-the-composer",
    joinParts.onePill &&
      joinParts.named &&
      joinParts.pinId &&
      joinParts.dockOpen &&
      joinParts.dockHolds &&
      joinParts.caret &&
      joinParts.caretInField &&
      joinParts.ring &&
      joinParts.ringDrawn &&
      joinParts.focusedIsArray &&
      joinParts.focusedMatches &&
      joinParts.turns,
    `clicking the card left parts ${JSON.stringify(joinParts)} and ${JSON.stringify(checks.fromTheCard)}`,
  );

  // ── 7. removing the last pill restores the ordinary turn ──────────────────
  await removePill(win, CARD_A.pin.id);
  const afterLastPill = await sample(win);
  const afterLastTurn = await send(win, "Never mind, back to the board");
  const lastContext = afterLastTurn?.instructionsContext ?? {};
  checks.lastPill = {
    pills: afterLastPill.pills,
    container: afterLastPill.container,
    dock: afterLastPill.dock,
    rings: afterLastPill.inContextCards,
    focusedCards: Object.prototype.hasOwnProperty.call(lastContext, "focusedCards")
      ? lastContext.focusedCards
      : "<absent>",
    focusedCard: Object.prototype.hasOwnProperty.call(lastContext, "focusedCard")
      ? lastContext.focusedCard
      : "<absent>",
  };
  check(
    "removing-the-last-pill-restores-the-ordinary-turn",
    afterLastPill.pills.length === 0 &&
      afterLastPill.container === null &&
      (afterLastPill.dock?.contextCards ?? []).length === 0 &&
      afterLastPill.inContextCards.length === 0 &&
      !Object.prototype.hasOwnProperty.call(lastContext, "focusedCards") &&
      !Object.prototype.hasOwnProperty.call(lastContext, "focusedCard"),
    `after the last pill the panel read ${JSON.stringify(checks.lastPill)}`,
  );

  // ── 8. only the Dashboard's own empty space clears ────────────────────────
  // The context is the operator's working set: pressing the chat or the rail
  // while it is held must leave it held. Only the Dashboard's empty space is the
  // "take them all back" gesture.
  await toggleCard(win, CARD_A);
  await toggleCard(win, CARD_B);
  const heldForSurfaces = await sample(win);
  await press(win, await pointAt(win, ".chat-panel__heading"));
  await press(win, await pointAt(win, ".nav-rail"));
  const afterOtherSurfaces = await sample(win);
  await press(win, await pointAt(win, ".home-dashboard__eyebrow"));
  await waitFor(
    win,
    `((window.cardContextDock ?? {}).contextCards ?? []).length === 0`,
    "the empty Dashboard to clear the context",
  );
  const afterBoardPress = await sample(win);
  checks.surfaces = {
    held: (heldForSurfaces.dock?.contextCards ?? []).map((card) => card.pin.id),
    afterChatAndRail: (afterOtherSurfaces.dock?.contextCards ?? []).map((card) => card.pin.id),
    afterBoard: (afterBoardPress.dock?.contextCards ?? []).map((card) => card.pin.id),
    rings: afterBoardPress.inContextCards,
  };
  check(
    "only-the-dashboard-clears-the-context",
    JSON.stringify(checks.surfaces.held) === JSON.stringify([CARD_A.pin.id, CARD_B.pin.id]) &&
      JSON.stringify(checks.surfaces.afterChatAndRail) ===
        JSON.stringify([CARD_A.pin.id, CARD_B.pin.id]) &&
      afterOtherSurfaces.pills.length === 2 &&
      afterOtherSurfaces.inContextCards.length === 2 &&
      checks.surfaces.afterBoard.length === 0 &&
      checks.surfaces.rings.length === 0 &&
      afterBoardPress.pills.length === 0,
    `the context across surfaces read ${JSON.stringify(checks.surfaces)}`,
  );

  // ── nothing unexpected, nothing on fire ───────────────────────────────────
  // Four turns: one with no card, one with three, one from the operator's own
  // click, and one after the last pill was removed. A run that sent fewer never
  // exercised the claim that names them.
  const turnCount = (await calls(win)).length;
  checks.turnsSent = turnCount;
  if (turnCount !== 4) {
    failure(`the rig sent ${turnCount} turn(s), expected 4 — a claim above may be vacuous`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The artifact screenshot is the panel holding three cards with the board
  // wearing their three rings: the state the feature is about, so that is what a
  // reader should see.
  await clearCards(win);
  await toggleCard(win, CARD_A);
  await toggleCard(win, CARD_B);
  await toggleCard(win, CARD_C);
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
    path.join(artifactsDir, "card-context.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "card-context.png"), image.toPNG());

  console.log(`pills:   ${JSON.stringify(held.pills.map((pill) => pill.label))}`);
  console.log(`carried: ${JSON.stringify(checks.threeCardTurn.focusedCards)}`);
  console.log(`turns:   ${turnCount}`);
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
  console.error("card-context rig timed out");
  app.exit(1);
}, 90_000);
