/**
 * Drives the dashboard-arrange harness in a real Electron window and turns what
 * the Dashboard actually does into `e2e/artifacts/dashboard-arrange.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-arrange.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable artifact:
 * same command, same claims, no eyeballing the app required.
 *
 * The claims, and what makes each falsifiable:
 *
 *  1. `skin`           — the harness painted in the app's own skin. A rig on
 *                        base tokens judges a palette nobody runs.
 *  2. `chrome-identity` — every card's chrome is icon-only, and the icon is the
 *                        named one: `lucide-grip-vertical` for move,
 *                        `lucide-pin-off` for unpin, `lucide-maximize-2` /
 *                        `lucide-minimize-2` for the card's width. The rig reads
 *                        the class lucide-react stamps on the `<svg>`, so the
 *                        claim is "this exact icon" rather than "some svg". No
 *                        glyph character (`✕ ↑ ↓ ◧ ♭`) survives anywhere in the
 *                        chrome, which is what a half-migrated chrome fails.
 *
 * NOT covered here: anything about dragging, and the vault-core half of a write.
 * A dev-server page has no preload, so the page's bridge is a stub and a drop's
 * `pinsSet` ends at this rig's recorder.
 *
 * Input is dispatched through `webContents.sendInputEvent` — the browser's own
 * input pipeline — never through a hand-built `PointerEvent`, because the claims
 * to come are about activation timing, hit-testing, and pointer capture.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-arrange.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** The board the harness seeds, restated so the driver can install it again. */
const SEED = [
  { id: "sys:goal-progress", kind: "system", system: "goal-progress" },
  { id: "view:financial:v-weekly", kind: "view", domainSlug: "financial", viewId: "v-weekly", span: 1 },
  { id: "page:financial:ledger", kind: "page", domainSlug: "financial", pageId: "ledger" },
  { id: "sys:today-week", kind: "system", system: "today-week" },
  { id: "view:financial:v-summary", kind: "view", domainSlug: "financial", viewId: "v-summary", span: 2 },
  { id: "sys:pending-decisions", kind: "system", system: "pending-decisions" },
  { id: "sys:recent-log", kind: "system", system: "recent-log" },
];

/**
 * Everything the rig reads off the board in one pass: the cards in DOM order,
 * each card's chrome buttons with the icon each draws, the chrome's whole text
 * (which must hold no glyph), and the Add-pin heading's icon.
 */
const SAMPLE = `(() => {
  const cards = [...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")];
  const icons = (el) => [...((el && el.querySelector("svg") ? el.querySelector("svg").classList : []) || [])].join(" ");
  const heading = document.querySelector('[data-testid="board-add-pin"] .home-card__title');
  return {
    order: cards.map((card) => card.dataset.pinId),
    cards: cards.map((card) => ({
      id: card.dataset.pinId,
      chrome: card.querySelectorAll(":scope > .home-pin__chrome").length,
      buttons: [...card.querySelectorAll(":scope > .home-pin__chrome .home-pin__btn")].map((b) => ({
        testid: b.dataset.testid || null,
        label: b.getAttribute("aria-label"),
        title: b.getAttribute("title"),
        text: (b.textContent || "").trim(),
        svgs: b.querySelectorAll("svg").length,
        icon: [...((b.querySelector("svg") ? b.querySelector("svg").classList : []) || [])].join(" "),
      })),
    })),
    chromeText: [...document.querySelectorAll(".home-pin__chrome")].map((el) => el.textContent || "").join(""),
    lifted: document.querySelectorAll(".home-pin.is-lifted").length,
    arranging: document.querySelectorAll(".home-dashboard__grid.is-arranging").length,
    addPinHeading: heading
      ? { text: (heading.textContent || "").trim(), svgs: heading.querySelectorAll("svg").length, icon: icons(heading) }
      : null,
  };
})()`;

const GLYPHS = ["✕", "↑", "↓", "◧", "♭"];

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

/** The centre of a selector's box, in the CSS pixels `sendInputEvent` takes. */
async function center(win, selector) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, top: r.top, left: r.left };
    })()`,
  );
  if (!point) throw new Error(`no element for ${selector}`);
  return point;
}

/** The board's pins, in the order the DOM has them — the order the operator sees. */
function restingOrder(win) {
  return win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".home-dashboard__grid > .home-pin[data-pin-id]")].map((el) => el.dataset.pinId)`,
  );
}

/**
 * How many grid tracks the board has: the column count the slot rule and the
 * keyboard's Up/Down have to respect.
 *
 * Read from the grid's resolved `grid-template-columns` rather than by counting
 * the cards in the first row, because several home cards are full-row
 * (`home-card--wide`, a span-2 view, the deadline banner), so a "row" of the
 * board is not a row of the grid.
 */
function columns(win) {
  return win.webContents.executeJavaScript(
    `(() => {
      const grid = document.querySelector(".home-dashboard__grid");
      if (!grid) return 0;
      const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
      return tracks === "" || tracks === "none" ? 0 : tracks.split(/\\s+/).length;
    })()`,
  );
}

let generation = 0;

/** Install a board, re-render the page, and wait for it to settle. */
async function renderBoard(win, pins, locked) {
  generation += 1;
  const before = await win.webContents.executeJavaScript("window.dashboardArrangeCommits ?? 0");
  await win.webContents.executeJavaScript(
    `window.dashboardArrangeSetBoard(${JSON.stringify(pins)}, ${locked ? "true" : "false"}); window.dashboardArrangeRender(${generation}); true`,
  );
  await waitFor(
    win,
    `(window.dashboardArrangeCommits ?? 0) > ${before}`,
    `the page to commit with ${pins.length} pins locked=${locked}`,
  );
  // The board read is async, so the cards are the last thing to settle. The
  // count is the pins plus the one card that is not a pin — the Active-agents
  // card — which is why it is `pins.length + 1` rather than `pins.length`.
  await waitFor(
    win,
    `(() => {
       const badge = document.querySelector('[data-testid="board-lock-badge"]');
       const settled = badge && badge.dataset.locked === '${locked ? "true" : "false"}';
       const cards = document.querySelectorAll('.home-dashboard__grid > .home-pin').length;
       return settled && cards === ${pins.length + 1};
     })()`,
    "the board to render its cards",
  );
  await sleep(60);
}

/** The named icon each control must draw, per card kind. */
function expectedIcons(pin) {
  const expected = { "pin-grip": "lucide-grip-vertical", "pin-unpin": "lucide-pin-off" };
  if (pin.kind === "view") {
    expected["pin-span"] = pin.span === 2 ? "lucide-minimize-2" : "lucide-maximize-2";
  }
  return expected;
}

/** The chrome, as one falsifiable claim. */
function checkChromeIdentity(sample) {
  const problems = [];

  if (sample.cards.length !== SEED.length) {
    problems.push(`the board rendered ${sample.cards.length} pin cards, expected ${SEED.length}`);
  }

  for (const pin of SEED) {
    const card = sample.cards.find((c) => c.id === pin.id);
    if (!card) {
      problems.push(`${pin.id} has no card`);
      continue;
    }
    if (card.chrome !== 1) {
      problems.push(`${pin.id} wears ${card.chrome} chrome bars, expected 1`);
      continue;
    }
    const expected = expectedIcons(pin);
    const got = card.buttons.map((b) => b.testid).sort();
    const want = Object.keys(expected).sort();
    if (got.join(",") !== want.join(",")) {
      problems.push(`${pin.id} offers [${got.join(", ")}], expected [${want.join(", ")}]`);
      continue;
    }
    for (const button of card.buttons) {
      const where = `${pin.id} ${button.testid}`;
      if (button.svgs !== 1) problems.push(`${where} draws ${button.svgs} icons, expected 1`);
      if (button.text !== "") problems.push(`${where} still draws the text ${JSON.stringify(button.text)}`);
      if (!button.label) problems.push(`${where} has no aria-label`);
      if (!button.title) problems.push(`${where} has no title`);
      const want2 = expected[button.testid];
      if (want2 && !button.icon.includes(want2)) {
        problems.push(`${where} draws ${JSON.stringify(button.icon)}, expected ${want2}`);
      }
    }
  }

  const glyphs = GLYPHS.filter((g) => sample.chromeText.includes(g));
  if (glyphs.length > 0) {
    problems.push(`the chrome still draws the glyphs ${glyphs.join(" ")}`);
  }

  const heading = sample.addPinHeading;
  if (!heading) {
    problems.push("the Add-pin row is missing, so its heading could not be read");
  } else if (heading.svgs < 1 || !heading.icon.includes("lucide-pin")) {
    problems.push(`the Add-pin heading draws ${heading.svgs} icons (${JSON.stringify(heading.icon)})`);
  }

  return check("chrome-identity", problems.length === 0, problems.join("; "));
}

async function main() {
  const sessionPartition = `dashboard-arrange-${Date.now()}`;
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: sessionPartition },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.dashboardArrangeReady)", "dashboardArrangeReady");

  // A harness that never applied the skin would draw a palette the operator does
  // not run, and every design claim below would be about the wrong theme.
  const skin = await win.webContents.executeJavaScript(
    "({ name: window.dashboardArrangeSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  check(
    "skin",
    Boolean(skin.name) && skin.applied === skin.name,
    `the harness painted ${JSON.stringify(skin)}`,
  );

  await renderBoard(win, SEED, false);

  const sample = await win.webContents.executeJavaScript(SAMPLE);
  checkChromeIdentity(sample);

  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "dashboard-arrange.png"), image.toPNG());

  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks: { skin, scenarios, order: sample.order, sample },
    samples: { board: sample },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-arrange.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`order:    ${sample.order.join(" ")}`);
  console.log(`cards:    ${sample.cards.length}`);
  for (const scenario of scenarios) {
    console.log(`${scenario.name}: ${scenario.pass ? "PASS" : "FAIL"}${scenario.detail ? ` — ${scenario.detail}` : ""}`);
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
  console.error("dashboard-arrange rig timed out");
  app.exit(1);
}, 90_000);
