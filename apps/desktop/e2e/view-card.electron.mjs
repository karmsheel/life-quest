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
 *  6. A span-2 wrapper gets the grid's full row (measured width == grid width).
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
 * NOT covered here: that vault-core computes the aggregation correctly (that is
 * `packages/vault-core/tests/views.test.ts` over a real vault) and the
 * HomePage pin spread itself (a page-level concern, covered by the source-text
 * contract test for the add-row).
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

/** One rect per chip-styled bar; fill read straight off the rect. */
const SAMPLE = `(() => {
  const card = document.querySelector(".view-card");
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
    bars,
    ticks: Array.from(document.querySelectorAll(".view-card__tick")).map((t) => (t.textContent || "").trim()),
    gridWidth: gridBox ? Math.round(gridBox.width) : null,
    pinWidth: pinBox ? Math.round(pinBox.width) : null,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent"),
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

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

async function main() {
  // A per-run partition isolates the HTTP disk cache: without it the window
  // serves a stale transform of ViewCard from a previous run's cache (the
  // page URL is cache-busted, the module URL is not), and a rig mutation
  // passes silently. This is the measured failure; the partition is the fix.
  const sessionPartition = `view-card-${Date.now()}`;
  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
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
  await waitFor(win, "Boolean(window.viewCardReady)", "viewCardReady");

  const checks = {};

  // ── 1. the bar view draws, in accent, one rect per group ───────────────────
  const bar = await render(win, "financial::v-bar", { view: ZAR_BAR_VIEW, run: { ok: true, value: BAR_RUN } });
  checks.barTitle = bar.title;
  checks.barRects = bar.bars.length;
  checks.barTicks = bar.ticks;
  if (bar.title !== "Spend by category, this month") {
    failure(`bar title read ${JSON.stringify(bar.title)}`);
  }
  if (bar.bars.length !== 2) failure(`bar view drew ${bar.bars.length} rects, expected 2`);
  if (bar.ticks.join(",") !== "Transpo…,Groceri…") {
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
    run: { ok: true, value: { columns: ["label", "value"], rows: [], warnings: [], currency: "ZAR" } },
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
      value: { columns: ["label", "value"], rows: [["value", -280.5]], warnings: [], currency: "ZAR" },
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
      value: { ...BAR_RUN, warnings: ["Rows span more than one currency; series kept separate."] },
    },
  });
  checks.warningText = warned.warnings;
  if (!(warned.warnings ?? "").includes("more than one currency")) {
    failure(`the card did not show the run's warning: ${JSON.stringify(warned.warnings)}`);
  }

  // ── 6. a span-2 wrapper owns the grid row ─────────────────────────────────
  // Re-mount with a wide wrapper; the driver measures wrapper vs grid width.
  const span2 = await win.webContents.executeJavaScript(
    `(() => {
      const grid = document.querySelector(".home-dashboard__grid");
      const pin = document.createElement("div");
      pin.className = "home-pin home-pin--span2";
      grid.appendChild(pin);
      const pinBox = pin.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const contentWidth = grid.clientWidth - padX;
      const probe = document.createElement("div");
      probe.className = "home-pin";
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

  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = { pass: errors.length === 0, failures: errors, checks, samples: { bar, empty, metric, missing, warned } };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "view-card.json"), `${JSON.stringify(report, null, 2)}\n`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "view-card.png"), image.toPNG());

  console.log(`bar: ${checks.barRects} rects, fill ${checks.barFills[0]}, tooltip ${JSON.stringify(checks.barTooltip)}`);
  console.log(`metric: ${checks.metricText}`);
  console.log(`empty: ${checks.emptyCopy}`);
  console.log(`missing: ${checks.missingCopy}`);
  console.log(`span2: ${checks.span2.span2Width}px of ${checks.span2.gridWidth}px grid`);
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
  console.error("view-card rig timed out");
  app.exit(1);
}, 90_000);
