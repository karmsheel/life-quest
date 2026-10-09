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
 *  1. `no-card-no-pill-no-line` — the feature is absent when it is not used. No
 *     pill, and the turn's instruction context has no `focusedCard` key at all,
 *     not a null one: a turn with no card must stay the turn it always was.
 *  2. `the-pill-names-the-card` — the card in context is visible above the
 *     composer, wearing one icon and the card's own name. A context the operator
 *     cannot see is a context they cannot take back.
 *  3. `the-pill-sits-above-the-composer` — the pill's box is above the field's
 *     and inside the composer's own column, measured, not asserted in prose.
 *  4. `the-turn-carries-the-card` — the payload's `focusedCard` is the exact
 *     object, field by field, including the `viewId` and the board slug the
 *     companion's own tools address the card by. This is the claim the whole
 *     feature exists for.
 *  5. `removing-the-pill-clears-the-context` — the dock holds nothing, the pill
 *     is gone, and the next turn carries no card.
 *  6. `the-pill-survives-the-turn` — a follow-up question about the same card
 *     needs no second click: both turns carry it and the pill stays.
 *  7. `the-card-control-puts-it-in-the-chat` — the join, end to end on one page:
 *     the real Dashboard's chat control is clicked, the real panel grows the pill
 *     and takes the caret, and the turn that follows carries that card. Every
 *     other claim here starts from a card the probe installed; this one starts
 *     from the operator's own click.
 *
 * The bridge is a stub (a dev-server page has no preload), so this rig ends at
 * the recorded payload. What the companion *does* with the line is the agent's,
 * and the wording is claimed in `tests/agent-prompts-e2e.test.ts`, which builds
 * the real instructions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/card-context.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * The card the operator handed over: the shape the Dashboard's chat control
 * builds, so the rig proves the panel reads *that* shape and not a convenient
 * one it invented.
 */
const VIEW_CARD = {
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

/** What the turn must carry for that card, field by field. */
const EXPECTED_FOCUSED = {
  label: "Weekly expenses",
  pinId: "view:financial:v-weekly",
  kind: "view",
  boardSlug: null,
  domainSlug: "financial",
  viewId: "v-weekly",
};

/** The pill and the field, in one pass. */
const SAMPLE = `(() => {
  const pill = document.querySelector('[data-testid="chat-context-pill"]');
  const remove = document.querySelector('[data-testid="chat-context-remove"]');
  const field = document.querySelector('.chat-panel__composer-input');
  const pillRect = pill ? pill.getBoundingClientRect() : null;
  const fieldRect = field ? field.getBoundingClientRect() : null;
  return {
    pill: pill
      ? {
          text: (pill.textContent || '').trim(),
          label: (pill.querySelector('.chat-panel__context-label') || {}).textContent?.trim() ?? null,
          svgs: pill.querySelectorAll('svg').length,
          icon: (() => {
            const svg = pill.querySelector('svg');
            return svg ? [...svg.classList].join(' ') : null;
          })(),
          remove: Boolean(remove),
          removeLabel: remove ? remove.getAttribute('aria-label') : null,
        }
      : null,
    geometry: pillRect && fieldRect
      ? {
          pillBottom: pillRect.bottom,
          fieldTop: fieldRect.top,
          pillLeft: pillRect.left,
          fieldLeft: fieldRect.left,
          pillRight: pillRect.right,
          fieldRight: fieldRect.right,
          pillHeight: pillRect.height,
        }
      : null,
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

/** Install (or clear) the card in the dock, exactly as the Dashboard's control does. */
async function setContext(win, card) {
  await win.webContents.executeJavaScript(
    `window.cardContextSetContext(${card ? JSON.stringify(card) : "null"})`,
  );
  await sleep(60);
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

/** A key-order-free comparison: the claim is about fields, not about literal order. */
function sameFields(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  const keys = (o) => Object.keys(o).sort();
  const a = keys(actual);
  const b = keys(expected);
  if (a.join(",") !== b.join(",")) return false;
  return a.every((k) => actual[k] === expected[k]);
}

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

  const checks = {};

  checks.skin = await win.webContents.executeJavaScript(
    "({ name: window.cardContextSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
  }

  // ── 1. no card, no pill, and the turn is the turn it always was ───────────
  const bare = await send(win, "What is on my board?");
  const bareContext = bare?.instructionsContext ?? {};
  const bareBefore = await sample(win);
  checks.bareTurn = {
    focusedCard: Object.prototype.hasOwnProperty.call(bareContext, "focusedCard")
      ? bareContext.focusedCard
      : "<absent>",
    pill: bareBefore.pill,
    keys: Object.keys(bareContext).sort(),
  };
  check(
    "no-card-no-pill-no-line",
    bareBefore.pill === null &&
      !Object.prototype.hasOwnProperty.call(bareContext, "focusedCard"),
    `with no card in context the panel drew ${JSON.stringify(bareBefore.pill)} and sent ` +
      `focusedCard=${JSON.stringify(checks.bareTurn.focusedCard)}`,
  );

  // ── 2. the pill names the card ────────────────────────────────────────────
  await setContext(win, VIEW_CARD);
  await waitFor(win, `Boolean(document.querySelector('[data-testid="chat-context-pill"]'))`, "the pill");
  const withPill = await sample(win);
  checks.pill = withPill;
  check(
    "the-pill-names-the-card",
    withPill.pill !== null &&
      withPill.pill.label === "Weekly expenses" &&
      withPill.pill.svgs === 2 &&
      (withPill.pill.icon ?? "").includes("lucide-message-square") &&
      withPill.pill.remove === true &&
      Boolean(withPill.pill.removeLabel) &&
      /in context/i.test(withPill.pill.text),
    `the pill read ${JSON.stringify(withPill.pill)}`,
  );

  // ── 3. it sits above the field, in the composer's own column ──────────────
  const g = withPill.geometry;
  check(
    "the-pill-sits-above-the-composer",
    g !== null &&
      g.pillHeight > 0 &&
      g.pillBottom <= g.fieldTop + 1 &&
      g.pillLeft >= g.fieldLeft - 1 &&
      g.pillRight <= g.fieldRight + 1,
    `the pill's box against the field's was ${JSON.stringify(g)}`,
  );

  // ── 4. the turn carries the card ──────────────────────────────────────────
  const carried = await send(win, "Make this a bar chart");
  checks.carriedTurn = carried?.instructionsContext?.focusedCard ?? null;
  check(
    "the-turn-carries-the-card",
    sameFields(carried?.instructionsContext?.focusedCard, EXPECTED_FOCUSED),
    `the turn carried ${JSON.stringify(checks.carriedTurn)}; expected ${JSON.stringify(EXPECTED_FOCUSED)}`,
  );

  // ── 6. a follow-up about the same card needs no second click ──────────────
  const followUp = await send(win, "Why is the last week so high?");
  const afterTwoTurns = await sample(win);
  checks.followUp = {
    focusedCard: followUp?.instructionsContext?.focusedCard ?? null,
    pill: afterTwoTurns.pill,
  };
  check(
    "the-pill-survives-the-turn",
    sameFields(followUp?.instructionsContext?.focusedCard, EXPECTED_FOCUSED) &&
      afterTwoTurns.pill?.label === "Weekly expenses",
    `the second turn carried ${JSON.stringify(checks.followUp.focusedCard)} with pill ` +
      `${JSON.stringify(checks.followUp.pill)}`,
  );

  // ── 5. taking it off clears it, and the next turn says so ─────────────────
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="chat-context-remove"]').click()`,
  );
  await waitFor(win, `!document.querySelector('[data-testid="chat-context-pill"]')`, "the pill to go");
  const cleared = await dock(win);
  const afterClear = await send(win, "Never mind, back to the board");
  const clearContext = afterClear?.instructionsContext ?? {};
  checks.cleared = {
    dock: cleared,
    focusedCard: Object.prototype.hasOwnProperty.call(clearContext, "focusedCard")
      ? clearContext.focusedCard
      : "<absent>",
  };
  check(
    "removing-the-pill-clears-the-context",
    cleared?.contextCard === null &&
      !Object.prototype.hasOwnProperty.call(clearContext, "focusedCard"),
    `after removing it the dock held ${JSON.stringify(cleared)} and the turn carried ` +
      `focusedCard=${JSON.stringify(checks.cleared.focusedCard)}`,
  );

  // ── 7. the operator's own click, all the way to the turn ──────────────────
  // Everything above starts from a card the probe installed. This starts where
  // the operator starts: a chat control on a card on the board.
  await setContext(win, null);
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-pin-id="view:financial:v-weekly"] [data-testid="pin-chat"]').click()`,
  );
  await waitFor(win, `Boolean(document.querySelector('[data-testid="chat-context-pill"]'))`, "the pill from a real click");
  const fromTheCard = await sample(win);
  const focused = await win.webContents.executeJavaScript(
    `(() => { const el = document.activeElement; return el ? { tag: el.tagName, cls: el.className } : null; })()`,
  );
  const byTheClick = await send(win, "Turn this into a bar chart");
  checks.fromTheCard = {
    pill: fromTheCard.pill,
    focused,
    focusedCard: byTheClick?.instructionsContext?.focusedCard ?? null,
  };
  check(
    "the-card-control-puts-it-in-the-chat",
    fromTheCard.pill?.label === "Weekly expenses" &&
      focused?.tag === "TEXTAREA" &&
      (focused?.cls ?? "").includes("chat-panel__composer-input") &&
      sameFields(byTheClick?.instructionsContext?.focusedCard, EXPECTED_FOCUSED),
    `clicking the card's chat control left ${JSON.stringify(checks.fromTheCard)}`,
  );

  // ── nothing unexpected, nothing on fire ───────────────────────────────────
  // Five turns: one with no card, two with it, one after it was taken off, and
  // one sent from a card the operator clicked. A run that sent fewer never
  // exercised the claim that names them.
  const turnCount = (await calls(win)).length;
  checks.turnsSent = turnCount;
  if (turnCount !== 5) {
    failure(`the rig sent ${turnCount} turn(s), expected 5 — a claim above may be vacuous`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // The artifact screenshot is the panel holding a card: the state the feature
  // is about, so that is what a reader should see.
  await setContext(win, VIEW_CARD);
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

  console.log(`pill:    ${JSON.stringify(withPill.pill)}`);
  console.log(`carried: ${JSON.stringify(checks.carriedTurn)}`);
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
