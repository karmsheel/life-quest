/**
 * Drives the view-card harness in a real Electron window and turns what the
 * card actually renders into `e2e/artifacts/view-card.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/view-card.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same table, no eyeballing the app required.
 *
 * What this rig claims, and the fixture that makes each claim falsifiable:
 *
 *  1. A bar view draws one rect per aggregate row, filled `var(--accent)`, and
 *     labels under each bar. The fixture has three groups.
 *  2. An empty run renders "No rows in this window." — not a crash, not blank.
 *  3. A metric view renders one large number with the resolved currency.
 *  4. A missing view file renders the "missing and can be unpinned" copy.
 *  5. Warnings reach the card as a muted line.
 *  6. A COMPOSED view draws every panel under one title, in block order, each
 *     panel naming itself: a metric, a table, and a bar chart. This is the card
 *     the artifact screenshot shows, and the shape `dashboard-views-e2e`
 *     produces from a real vault.
 *  7. A span-2 wrapper gets the grid's full row (measured width == grid width).
 *
 * Falsification: the CSS mutation (dropping `.home-pin--span2` from the
 * full-row rule) is proven to go red and restore green. The empty/missing
 * blocks are falsified by construction — the driver feeds the state as a
 * fixture, so a wrong branch renders the wrong fixture or none. A source
 * mutation of ViewCard.tsx is NOT runnable while the shared dev server
 * watch-loop serves stale `/src/` transforms (an e2e/ or CSS edit hot-reloads;
 * a `/src/` edit does not until the server restarts) — do not trust a
 * green source-mutation run here without confirming the served bytes first.
 *
 * NOT covered here: that vault-core computes the aggregation correctly and that
 * the full propose -> approve -> pin chain holds. That is `dashboard-views-e2e`,
 * which runs the same ViewCard against blocks a real vault produced.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/view-card.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * Paint the rig in the app's own theme before the first paint that matters.
 *
 * The theme lives in `localStorage` (`lifequest-skin` + `lifequest-theme`),
 * scoped to an origin — so setting it on any page of the dev server settles it
 * for every page in this window, including the harness the rig actually loads.
 * Without this the rig renders the base tokens, and a design review would be
 * judging a palette the operator never sees. Both values mirror the product
 * defaults: the Forge OS skin, and dark.
 */
async function applyAppTheme(win) {
  await win.loadURL(`${url}?v=theme-seed`);
  await win.webContents.executeJavaScript(
    `(() => {
       localStorage.setItem("lifequest-skin", "forge-os");
       localStorage.setItem("lifequest-theme", "dark");
       return true;
     })()`,
  );
}

/** One rect per chip-styled bar; fill read straight off the rect. */
const SAMPLE = `(() => {
  const card = document.querySelector(".view-card");
  const blocks = Array.from(document.querySelectorAll(".view-card__block"));
  const bars = Array.from(document.querySelectorAll(".view-card__bar")).map((r) => {
    const box = r.getBoundingClientRect();
    return {
      x: Math.round(box.x),
      width: Math.round(box.width),
      height: Math.round(box.height),
      fill: getComputedStyle(r).fill,
      title: r.querySelector("title") ? r.querySelector("title").textContent : null,
    };
  });
  const grid = document.querySelector(".home-dashboard__grid");
  const pin = document.querySelector(".home-pin");
  const gridBox = grid ? grid.getBoundingClientRect() : null;
  const pinBox = pin ? pin.getBoundingClientRect() : null;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    present: Boolean(card),
    title: card ? (card.querySelector(".view-card__title") || {}).textContent ?? null : null,
    warnings: card ? (card.querySelector(".view-card__warnings") || {}).textContent ?? null : null,
    empty: card ? (card.querySelector(".view-card__empty") || {}).textContent ?? null : null,
    metric: card ? (card.querySelector(".view-card__metric") || {}).textContent ?? null : null,
    missingCopy: card ? card.textContent.includes("missing and can be unpinned") : null,
    // Composed views: one entry per panel, in draw order.
    blocks: blocks.map((b) => ({
      title: b.querySelector(".view-card__block-title") ? b.querySelector(".view-card__block-title").textContent : null,
      metric: b.querySelector(".view-card__metric") ? b.querySelector(".view-card__metric").textContent : null,
      tableRows: b.querySelectorAll(".view-card__table tbody tr").length,
      bars: b.querySelectorAll(".view-card__bar").length,
      lines: b.querySelectorAll(".view-card__line").length,
      empty: b.querySelector(".view-card__empty") ? b.querySelector(".view-card__empty").textContent : null,
      // The operator's own switches for this panel: which one is on, and which
      // ones this database can actually express.
      tools: Array.from(b.querySelectorAll(".view-card__tool")).map((btn) => ({
        presentation: btn.getAttribute("data-presentation"),
        label: (btn.textContent || "").trim(),
        active: btn.getAttribute("aria-pressed") === "true",
        disabled: btn.disabled,
        title: btn.getAttribute("title"),
      })),
    })),
    bars,
    ticks: Array.from(document.querySelectorAll(".view-card__tick")).map((t) => (t.textContent || "").trim()),
    gridWidth: gridBox ? Math.round(gridBox.width) : null,
    pinWidth: pinBox ? Math.round(pinBox.width) : null,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent"),
    // The card must wear the board's own shell: same paper, hairline and radius
    // as every sibling pin. A view that drew without them is the regression this
    // sample exists to catch.
    shell: (() => {
      const cs = card ? getComputedStyle(card) : null;
      return {
        background: cs ? cs.backgroundColor : null,
        border: cs ? cs.borderTopWidth : null,
        radius: cs ? cs.borderTopLeftRadius : null,
      };
    })(),
    headers: Array.from(document.querySelectorAll(".view-card__table thead th")).map((th) =>
      (th.textContent || "").trim(),
    ),
    tableAlign: (() => {
      const cell = document.querySelector(".view-card__table tbody td + td");
      return cell ? getComputedStyle(cell).textAlign : null;
    })(),
  };
})()`;

/**
 * Wrap one block's result in the shape `viewRunSaved` answers with: a title over
 * a list of blocks. The card draws blocks either way, so every fixture goes
 * through here rather than each one knowing the envelope. The rollup mirrors
 * `runViewBlocks`: with more than one panel a warning names the panel it came
 * from, and with one panel it reads as the card's own line.
 */
function composed(title, blocks) {
  const list = blocks.map((b, i) => ({
    id: b.id ?? `block-${i + 1}`,
    title: b.title ?? `Block ${i + 1}`,
    presentation: b.presentation,
    ...(b.span ? { span: b.span } : {}),
    result: b.result ?? b,
  }));
  const warnings = [];
  for (const b of list) {
    for (const w of b.result.warnings) {
      warnings.push(list.length > 1 ? `${b.title}: ${w}` : w);
    }
  }
  return { title, blocks: list, warnings };
}

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

/**
 * The last step the rig reached, so a timeout names the step that produced it
 * instead of only saying "timed out" — which is the difference between one run
 * and a bisect.
 */
let step = "start";
const at = (name) => {
  step = name;
};

function waitFor(win, expression, label, timeoutMs = 10_000) {  const deadline = Date.now() + timeoutMs;
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

async function render(win, fixtureKey, fixture) {
  const committed = await win.webContents.executeJavaScript(
    "window.viewCardCommits ?? 0",
  );
  await win.webContents.executeJavaScript(
    `window.installFixture(${JSON.stringify(fixtureKey)}, ${JSON.stringify(fixture)})`,
  );
  const [slug, viewId] = [fixtureKey.split("::")[0], fixtureKey.split("::")[1]];
  await win.webContents.executeJavaScript(
    `window.renderViewCard(${JSON.stringify(slug)}, ${JSON.stringify(viewId)})`,
  );
  await waitFor(win, `(window.viewCardCommits ?? 0) > ${committed}`, `${fixtureKey} to commit`);
  await waitFor(
    win,
    `Boolean(document.querySelector(".view-card__bar") || document.querySelector(".view-card__metric") || document.querySelector(".form-error") || (() => { const c = document.querySelector(".view-card"); return c && (c.textContent.includes("No rows in this window.") || c.textContent.includes("missing and can be unpinned")); })())`,
    `${fixtureKey} content`,
  );
  return win.webContents.executeJavaScript(SAMPLE);
}

// KAR-V fixtures: the SavedView + run result pairs the card reads over IPC.
const ZAR_BAR_VIEW = {
  schemaVersion: 1,
  databaseId: "finance:transactions",
  title: "Spend by category, this month",
  presentation: "bar",
  groupBy: "category",
  timeBucket: null,
  timeColumnId: "date",
  timeWindow: "this-month",
  filters: [],
  measure: "sum",
  measureColumnId: "amount",
  sort: { by: "value", dir: "desc" },
  limit: 12,
  convertToZar: false,
};
const BAR_RUN = {
  columns: ["label", "value"],
  rows: [
    ["Transport", -60],
    ["Groceries", -215.5],
  ],
  warnings: [],
  currency: "ZAR",
};

/**
 * The composed fixture the artifact is built around: a weekly summary as the
 * companion would propose it — the range total, the week-by-week table, and the
 * same weeks as a chart, in one card.
 */
const COMPOSED_KEY = "financial::v-composed";const COMPOSED_FIXTURE = {
  // The file the app reads: the card's spec, blocks and all, so the table's
  // headers come from the query that shaped the rows rather than a guess.
  view: {
    ...ZAR_BAR_VIEW,
    title: "Weekly expenses",
    presentation: "table",
    timeBucket: "week",
    groupBy: "date",
    blocks: [
      {
        id: "total",
        title: "Last 5 weeks",
        presentation: "metric",
        groupBy: null,
        timeBucket: "week",
        timeColumnId: "date",
        timeWindow: "this-month",
        filters: [],
        measure: "sum",
        measureColumnId: "amount",
        sort: { by: "label", dir: "asc" },
        limit: 12,
        convertToZar: false,
      },
      {
        id: "weeks",
        title: "Week by week",
        presentation: "table",
        groupBy: "date",
        timeBucket: "week",
        timeColumnId: "date",
        timeWindow: "this-month",
        filters: [],
        measure: "sum",
        measureColumnId: "amount",
        sort: { by: "label", dir: "asc" },
        limit: 12,
        convertToZar: false,
      },
      {
        id: "trend",
        title: "Trend",
        presentation: "bar",
        span: 2,
        groupBy: "date",
        timeBucket: "week",
        timeColumnId: "date",
        timeWindow: "this-month",
        filters: [],
        measure: "sum",
        measureColumnId: "amount",
        sort: { by: "label", dir: "asc" },
        limit: 12,
        convertToZar: false,
      },
    ],
  },
  run: {
    ok: true,
    value: composed("Weekly expenses", [
      {
        id: "total",
        title: "Last 5 weeks",
        presentation: "metric",
        columns: ["label", "value"],
        rows: [["value", 7028.34]],
        warnings: [],
        currency: "ZAR",
      },
      {
        id: "weeks",
        title: "Week by week",
        presentation: "table",
        columns: ["label", "value"],
        rows: [
          ["2026-W36", 1111],
          ["2026-W37", 1114],
          ["2026-W38", 1148],
          ["2026-W39", 1265],
          ["2026-W40", 2390.34],
        ],
        warnings: [],
        currency: "ZAR",
      },
      {
        id: "trend",
        title: "Trend",
        presentation: "bar",
        span: 2,
        columns: ["label", "value"],
        rows: [
          ["2026-W36", 1111],
          ["2026-W37", 1114],
          ["2026-W38", 1148],
          ["2026-W39", 1265],
          ["2026-W40", 2390.34],
        ],
        warnings: [],
        currency: "ZAR",
      },
    ]),
  },
};

/**
 * The same card under its own key, for the block-switch step.
 *
 * It needs a key of its own because `renderViewCard` only remounts when
 * (slug, viewId) changes: re-rendering `v-composed` would leave the card with
 * the props it already had and re-read nothing. The view id is the one the save
 * must carry back, so this is also what makes "the write used the card's own id"
 * a claim rather than a coincidence.
 */
const TOOLS_KEY = "financial::v-tools";
const TOOLS_FIXTURE = {
  ...COMPOSED_FIXTURE,
  view: { ...COMPOSED_FIXTURE.view, id: "v-tools" },
};

/** The same card mounted read-only: what a locked dashboard draws. */
const READONLY_KEY = "financial::v-readonly";
const READONLY_FIXTURE = {
  ...COMPOSED_FIXTURE,
  view: { ...COMPOSED_FIXTURE.view, id: "v-readonly" },
};

async function main() {
  // A per-run partition isolates the HTTP disk cache: without it the window
  // serves a stale transform of ViewCard from a previous run's cache (the
  // page URL is cache-busted, the module URL is not), and a rig mutation
  // passes silently. This is the measured failure; the partition is the fix.
  const sessionPartition = `view-card-${Date.now()}`;
  // The rig opens a real window on the operator's desktop: paint it in the
  // SKIN the app itself defaults to, not the base tokens. A view card is judged
  // against the theme the operator actually sees, and `forge-os` night is that
  // theme — a rig on bare tokens reviews a palette no one runs.
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
  /**
   * Every console line the page emitted, in order. The block-switch step reads
   * its two channels out of this rather than asking the page, so the claim does
   * not depend on the renderer still answering questions after a write.
   */
  const pageLines = [];
  win.webContents.on("console-message", (event) => {
    pageLines.push(event.message);
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await applyAppTheme(win);
  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.viewCardReady)", "viewCardReady");

  const checks = {};

  // A harness that never applied the skin would draw a palette the operator
  // does not run, and every design claim below would be about the wrong theme.
  const skin = await win.webContents.executeJavaScript(
    "({ name: window.viewCardSkin, applied: document.documentElement.dataset.skin ?? null })",
  );
  checks.skin = skin;
  if (!skin.name || skin.applied !== skin.name) {
    failure(`the harness did not paint in the app's skin: ${JSON.stringify(skin)}`);
  }

  at("1 bar");
  // ── 1. the bar view draws, in accent, one rect per group ───────────────────
  const bar = await render(win, "financial::v-bar", {
    view: ZAR_BAR_VIEW,
    run: { ok: true, value: composed(ZAR_BAR_VIEW.title, [{ presentation: "bar", ...BAR_RUN }]) },
  });
  checks.barTitle = bar.title;
  checks.barRects = bar.bars.length;
  checks.barTicks = bar.ticks;
  if (bar.title !== "Spend by category, this month") {
    failure(`bar title read ${JSON.stringify(bar.title)}`);
  }
  if (bar.bars.length !== 2) failure(`bar view drew ${bar.bars.length} rects, expected 2`);
  // Labels fill their slot, so a short label is drawn whole; the claim is that
  // every tick is present and none is wider than the slot it sits in.
  if (bar.ticks.join(",") !== "Transport,Groceries") {
    failure(`bar ticks read ${JSON.stringify(bar.ticks)}`);
  }
  const fills = new Set(bar.bars.map((b) => b.fill));
  checks.barFills = [...fills];
  if (fills.size !== 1) failure(`bars carry more than one fill: ${[...fills].join(" | ")}`);
  const accent = bar.accent;
  checks.accent = accent;
  checks.barFillMatchesAccent = accent
    ? bar.bars.every((b) => sameColor(b.fill, accent))
    : false;
  if (!checks.barFillMatchesAccent) {
    failure(`bar fill is not the accent token: ${checks.barFills.join(" | ")} vs ${accent}`);
  }
  checks.barTooltip = bar.bars[0]?.title ?? null;

  // ── 2. an empty window reads as a quiet line, not a crash ─────────────────
  const empty = await render(win, "financial::v-empty", {
    view: { ...ZAR_BAR_VIEW, title: "Spend, quiet month" },
    run: {
      ok: true,
      value: composed("Spend, quiet month", [
        { presentation: "bar", columns: ["label", "value"], rows: [], warnings: [], currency: "ZAR" },
      ]),
    },
  });
  checks.emptyCopy = empty.empty;
  if (empty.empty !== "No rows in this window.") {
    failure(`empty card read ${JSON.stringify(empty.empty)}`);
  }

  // ── 3. the metric view is one number with the currency ────────────────────
  const metric = await render(win, "financial::v-metric", {
    view: {
      ...ZAR_BAR_VIEW,
      title: "Total spend",
      presentation: "metric",
      groupBy: null,
    },
    run: {
      ok: true,
      value: composed("Total spend", [
        { presentation: "metric", columns: ["label", "value"], rows: [["value", -280.5]], warnings: [], currency: "ZAR" },
      ]),
    },
  });
  checks.metricText = metric.metric;
  if (!/-?280(?:[.,]5)?/.test(metric.metric ?? "") || !(metric.metric ?? "").includes("ZAR")) {
    failure(`metric card read ${JSON.stringify(metric.metric)}`);
  }

  // ── 4. a missing view file is a named card, not a crash ───────────────────
  const missing = await render(win, "financial::v-missing", {
    view: ZAR_BAR_VIEW,
    run: null,
    missing: true,
  });
  checks.missingCopy = missing.missingCopy;
  if (missing.missingCopy !== true) {
    failure("a missing view file did not render the unpinned copy");
  }

  // ── 5. warnings are a muted line on the card ──────────────────────────────
  const warned = await render(win, "financial::v-warn", {
    view: ZAR_BAR_VIEW,
    run: {
      ok: true,
      value: composed(ZAR_BAR_VIEW.title, [
        { presentation: "bar", ...BAR_RUN, warnings: ["Rows span more than one currency; series kept separate."] },
      ]),
    },
  });
  checks.warningText = warned.warnings;
  if (!(warned.warnings ?? "").includes("more than one currency")) {
    failure(`the card did not show the run's warning: ${JSON.stringify(warned.warnings)}`);
  }

  at("6 composed");
  // ── 6. a COMPOSED view is one card holding metric + table + chart ─────────
  // This is the "weekly summary" shape: the panels the operator asked for, in
  // one pinnable card, titled once, with each panel naming itself.
  const composedCard = await render(win, COMPOSED_KEY, COMPOSED_FIXTURE);
  checks.composed = {
    blockCount: composedCard.blocks.length,
    titles: composedCard.blocks.map((b) => b.title),
    metric: composedCard.blocks[0]?.metric ?? null,
    tableRows: composedCard.blocks[1]?.tableRows ?? 0,
    bars: composedCard.blocks[2]?.bars ?? 0,
    cardTitle: composedCard.title,
  };
  if (composedCard.blocks.length !== 3) {
    failure(`a composed card drew ${composedCard.blocks.length} panels, expected 3`);
  }
  if (composedCard.blocks.map((b) => b.title).join("|") !== "Last 5 weeks|Week by week|Trend") {
    failure(`composed panel titles read ${JSON.stringify(composedCard.blocks.map((b) => b.title))}`);
  }
  if ((composedCard.blocks[0]?.metric ?? "").indexOf("7") < 0) {
    failure(`the composed metric panel read ${JSON.stringify(composedCard.blocks[0]?.metric)}`);
  }
  if ((composedCard.blocks[1]?.tableRows ?? 0) !== 5) {
    failure(`the composed table drew ${composedCard.blocks[1]?.tableRows} rows, expected 5`);
  }
  if ((composedCard.blocks[2]?.bars ?? 0) !== 5) {
    failure(`the composed chart drew ${composedCard.blocks[2]?.bars} bars, expected 5`);
  }

  // ── 7. the card wears the board's shell, and its table reads as a table ────
  // A pinned view is a card on the board, not a drawing dropped onto it. The
  // composed fixture's table is grouped by week, so its label column is a week.
  const shell = composedCard.shell;
  checks.shell = shell;
  if (!shell.background || shell.background === "rgba(0, 0, 0, 0)") {
    failure(`the card drew no shell background: ${JSON.stringify(shell)}`);
  }
  if (shell.border === "0px") failure("the card drew no shell border");
  if (!shell.radius || shell.radius === "0px") {
    failure(`the card drew no shell radius: ${JSON.stringify(shell.radius)}`);
  }
  checks.composedHeaders = composedCard.headers;
  // The fixture groups by week, so the label column is a week and the value
  // column says what it sums in the run's currency.
  if (composedCard.headers[0] !== "Week") {
    failure(`the composed table's label column read ${JSON.stringify(composedCard.headers[0])}`);
  }
  if (composedCard.headers[1] !== "Total (ZAR)") {
    failure(`the composed table's value column read ${JSON.stringify(composedCard.headers[1])}`);
  }
  if (composedCard.tableAlign !== "right") {
    failure(`the composed table's value column is ${JSON.stringify(composedCard.tableAlign)}-aligned, expected right`);
  }

  at("8 span2");
  // ── 8. a span-2 wrapper owns the grid row ─────────────────────────────────
  // Re-mount with a wide wrapper; the driver measures wrapper vs grid width.
  const span2 = await win.webContents.executeJavaScript(
    `(() => {
      const grid = document.querySelector(".home-dashboard__grid");
      const pin = document.createElement("div");
      pin.className = "home-pin home-pin--span2";
      pin.dataset.viewCardProbe = "span2";
      grid.appendChild(pin);
      const pinBox = pin.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const contentWidth = grid.clientWidth - padX;
      const probe = document.createElement("div");
      probe.className = "home-pin";
      probe.dataset.viewCardProbe = "plain";
      grid.appendChild(probe);
      return {
        gridContentWidth: Math.round(contentWidth),
        span2Width: Math.round(pinBox.width),
        plainWidth: Math.round(probe.getBoundingClientRect().width),
      };
    })()`,
  );
  checks.span2 = span2;
  if (span2.span2Width !== span2.gridContentWidth) {
    failure(
      `a span-2 pin measured ${span2.span2Width}px against the grid's ${span2.gridContentWidth}px content width`,
    );
  }

  // Leave the composed card mounted: it is the artifact's subject, so the PNG
  // shows the shape the operator asked for rather than the last assertion run.
  // This runs BEFORE the block-switch step, because that step's save is the last
  // thing this rig asks the page to do.
  //
  // This re-render repeats the key already on screen, and `viewCardCommits` only
  // moves when (slug, viewId) changes — waiting for a commit here would hang
  // forever, which is what `render()` above is careful never to do twice. The
  // span-2 step appended its probes straight into the grid, so React never owned
  // them: drop them by hand, then let two frames paint before the capture.
  await win.webContents.executeJavaScript(
    `document.querySelectorAll("[data-view-card-probe]").forEach((el) => el.remove())`,
  );
  await win.webContents.executeJavaScript(
    `window.installFixture(${JSON.stringify(COMPOSED_KEY)}, ${JSON.stringify(COMPOSED_FIXTURE)})`,
  );
  await win.webContents.executeJavaScript(`window.renderViewCard("financial", "v-composed")`);
  await waitFor(
    win,
    `document.querySelectorAll(".home-dashboard__grid > .home-pin").length === 1 && document.querySelectorAll(".view-card__block").length === 3`,
    "the composed card alone in the grid",
  );
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const image = await win.webContents.capturePage();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "view-card.png"), image.toPNG());

  // ── 9. the operator can change how one block is displayed ────────────────
  // "Modify a certain block on the dashboard — like editing how a certain block
  // is displayed." Each panel carries the four ways it can be drawn; the ones
  // this database cannot express are drawn disabled rather than hidden, and a
  // click writes the card back through the app's own view:save with the card's
  // own id, so the file keeps its identity and the pin keeps its place.
  //
  // This is the LAST step on purpose, and nothing after the click asks the page
  // a question. A save re-runs the card, and at that moment this renderer can
  // stop answering `executeJavaScript` at all (a Vite HMR message lands on the
  // same thread); a console line the page already emitted does not have that
  // problem. So the click is the last thing the page is told, and everything
  // after it is read from the two channels above.
  //
  // The read-only claim comes FIRST, on a card of its own: a locked dashboard is
  // the state the card is MOUNTED in, not a prop flip on a card that has just
  // saved. The seam this leaves is named rather than hidden — that a live lock
  // toggle reaches the card is HomePage's wiring, and `dashboard-lock-ui` is the
  // rig that owns the toggle itself.
  at("9 block tools");
  await win.webContents.executeJavaScript(`window.viewCardSetEditable(false)`);
  const readOnly = await render(win, READONLY_KEY, READONLY_FIXTURE);
  checks.readOnlyTools = readOnly.blocks.map((b) => b.tools.length);
  if (readOnly.blocks.some((b) => b.tools.length > 0)) {
    failure("a read-only card still drew block switches");
  }
  await win.webContents.executeJavaScript(`window.viewCardSetEditable(true)`);

  const toolsCard = await render(win, TOOLS_KEY, TOOLS_FIXTURE);
  checks.blockTools = toolsCard.blocks.map((b) => b.tools);
  const panels = toolsCard.blocks;
  if (panels.length !== 3) failure(`the composed card drew ${panels.length} panels, expected 3`);
  for (const [index, panel] of panels.entries()) {
    const offered = panel.tools.map((t) => t.presentation);
    if (offered.join(",") !== "metric,table,bar,line") {
      failure(`panel ${index} offers ${offered.join(",")} instead of all four presentations`);
    }
    const on = panel.tools.filter((t) => t.active).map((t) => t.presentation);
    if (on.length !== 1) failure(`panel ${index} marks ${on.length} presentations as current, expected 1`);
  }
  // The disabled state is driven by the database's own column types, not by a
  // guess: this fixture has a date column, so a line IS expressible for a metric
  // panel, and it must be offered live.
  const metricLine = panels[0].tools.find((t) => t.presentation === "line");
  if (!metricLine || metricLine.disabled) {
    failure("a metric panel cannot be switched to a line even though the database has a date column");
  }

  at("9a click");
  const clickedBar = await win.webContents.executeJavaScript(
    `(() => {
      const block = document.querySelectorAll(".view-card__block")[1];
      const btn = Array.from(block.querySelectorAll(".view-card__tool")).find(
        (b) => b.getAttribute("data-presentation") === "bar"
      );
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!clickedBar) failure("the week table's panel offered no usable Bar switch");
  at("9a1 read channels");
  // The save record and the card's own report come from the page's console, not
  // from an `executeJavaScript`: a save re-runs the card, and a Vite HMR message
  // can wedge this renderer's JS thread at that exact moment, while a line
  // already emitted is still in the main process's hands. `pageLines` is filled
  // by the `console-message` listener above.
  const readChannels = () => {
    const saves = pageLines
      .filter((line) => line.startsWith("viewCardSave:"))
      .map((line) => JSON.parse(line.slice("viewCardSave:".length)));
    const states = pageLines
      .filter((line) => line.startsWith("viewCardState:"))
      .map((line) => JSON.parse(line.slice("viewCardState:".length)));
    return { saves, states };
  };
  let channels = readChannels();
  const channelStates = () => channels.states.filter((s) => s.viewId === "v-tools");
  // Wait for the save AND the redraw it causes: the card re-reads itself after a
  // write, so the last report of the OLD shape arrives before the new one, and
  // reading too early would call a correct card a stale one.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    channels = readChannels();
    const last = channelStates().at(-1);
    if (channels.saves.length > 0 && last?.blocks?.[1]?.active?.[0] === "bar") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const saves = channels.saves;
  const states = channelStates();
  const switched = states.at(-1) ?? null;
  checks.blockSwitch = { saves, states };
  if (saves.length !== 1) failure(`one click made ${saves.length} writes, expected 1`);
  if (saves[0]?.viewId !== "v-tools") {
    failure(`the block switch saved under viewId ${JSON.stringify(saves[0]?.viewId)}, not the card's own id`);
  }
  const savedBlocks = saves[0]?.blocks ?? [];
  if (savedBlocks.length !== 3) failure(`the saved spec carries ${savedBlocks.length} blocks, expected 3`);
  if (savedBlocks[1]?.[1] !== "bar") {
    failure(`the saved spec's week panel is a ${savedBlocks[1]?.[1]}, expected bar`);
  }
  if (savedBlocks[0]?.[1] !== "metric" || savedBlocks[2]?.[1] !== "bar") {
    failure("switching one panel changed another panel's presentation");
  }
  if (!switched) {
    failure("the card reported nothing after the switch");
  } else {
    if ((switched.blocks[1]?.bars ?? 0) === 0) {
      failure("the panel did not redraw as a bar after the switch");
    }
    if ((switched.blocks[1]?.tableRows ?? 0) !== 0) {
      failure("the panel still draws a table after switching to a bar");
    }
    if (switched.blocks[0]?.metric === null) failure("switching a sibling panel lost the metric");
    if (switched.blocks[0]?.active?.[0] !== "metric") {
      failure("the metric panel no longer marks itself as the current presentation");
    }
    if (switched.blocks[1]?.active?.[0] !== "bar") {
      failure("the switched panel does not mark the bar as current");
    }
    if (switched.blocks[2]?.active?.[0] !== "bar") {
      failure("switching one panel changed the third panel's current presentation");
    }
  }

  // A read-only card — a locked dashboard — draws no switches at all; that claim
  // was made above, before this card saved anything.

  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  // Leave the composed card mounted: it is the artifact's subject, so the PNG
  // shows the shape the operator asked for rather than the last assertion run.
  // This re-render repeats the key already on screen, and `viewCardCommits` only
  // moves when (slug, viewId) changes — waiting for a commit here would hang
  // forever, which is what `render()` above is careful never to do twice. The
  // span-2 step appended its probes straight into the grid, so React never owned
  // them: drop them by hand, then let two frames paint before the capture.
  await win.webContents.executeJavaScript(
    `document.querySelectorAll("[data-view-card-probe]").forEach((el) => el.remove())`,
  );
  await win.webContents.executeJavaScript(
    `window.installFixture(${JSON.stringify(COMPOSED_KEY)}, ${JSON.stringify(COMPOSED_FIXTURE)})`,
  );
  await win.webContents.executeJavaScript(`window.renderViewCard("financial", "v-composed")`);
  await waitFor(
    win,
    `document.querySelectorAll(".home-dashboard__grid > .home-pin").length === 1 && document.querySelectorAll(".view-card__block").length === 3`,
    "the composed card alone in the grid",
  );
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );

  at("report");
  const report = { pass: errors.length === 0, failures: errors, checks, samples: { bar, empty, metric, missing, warned, composedCard } };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "view-card.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`bar: ${checks.barRects} rects, fill ${checks.barFills[0]}, tooltip ${JSON.stringify(checks.barTooltip)}`);
  console.log(`metric: ${checks.metricText}`);
  console.log(`empty: ${checks.emptyCopy}`);
  console.log(`missing: ${checks.missingCopy}`);
  console.log(
    `composed: ${checks.composed.blockCount} panels [${checks.composed.titles.join(", ")}], ` +
      `metric ${checks.composed.metric}, ${checks.composed.tableRows} table rows, ${checks.composed.bars} bars`,
  );
  console.log(
    `span2: ${checks.span2.span2Width}px of the grid's ${checks.span2.gridContentWidth}px content row ` +
      `(plain pin ${checks.span2.plainWidth}px)`,
  );
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

/** Normalise #hex, rgb()/rgba(), or 0-1 float color() to a comparable triple. */
function parseColor(value) {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = v.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(/[, ]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  const srgb = v.match(/color\(srgb ([^)]+)\)/);
  if (srgb) {
    const parts = srgb[1].split(" ").map(Number);
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: 1 };
  }
  return null;
}

function sameColor(a, b) {
  const ca = parseColor(a.trim());
  const cb = parseColor(b.trim());
  if (!ca || !cb) return false;
  return Math.abs(ca.r - cb.r) < 2 && Math.abs(ca.g - cb.g) < 2 && Math.abs(ca.b - cb.b) < 2;
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error(`view-card rig timed out at: ${step}`);
  app.exit(1);
}, 90_000);
