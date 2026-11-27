/**
 * Drives the Analytics harness in a real Electron window and turns what the
 * Analytics page actually renders into `e2e/artifacts/analytics.json` plus one
 * picture.
 *
 * Run with the dev server up (`npm run dev`, or the repository's e2e runner):
 *
 *   node e2e/analytics.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims. The picture, from this same run:
 *
 *   analytics.png   the matrix on the Life lens: eight period columns, the
 *                   Health and Finance area groups, values with their units,
 *                   no-data markers and deltas, on the table surface.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The page is the literal `/review/analytics` route, not the dynamic
 *     `/review/:cadence` one: the arriving location is asserted, and a review of
 *     a cadence called "analytics" would render either the wrong page or the
 *     fallback for an unknown review.
 *  2. The rail's Review wing holds six rows, with **Analytics** after **Yearly**,
 *     and pressing it from another Review page lands on the matrix.
 *  3. The page opens with the eyebrow `Review / Analytics` and the weekly cadence
 *     selected, with the matrix drawn and its eight period headers.
 *  4. The headers are the ENGINE's labels — the harness serves the same
 *     `periodLabel` output the engine does — not the page's own names. Each ties
 *     to its period (`analytics-period-link-<period>`) and to that period's
 *     review (`?period=`), with no `&scope=` on the Life lens.
 *  5. The Life lens is every area: both area groups draw (`analytics-area-health`
 *     before `analytics-area-financial`) and no group for an area the fixture
 *     has no definitions in. The Finance lens shows the three Finance rows and
 *     NONE of Health's, and its period links carry `&scope=financial`.
 *  6. The cells print the served value: Cash out — a negative ledger sum with a
 *     display-only magnitude — reads positive, with its unit; the no-data cell
 *     wears `data-nodata="true"` and `—`; a delta is present only where BOTH the
 *     cell and the column before it have data.
 *  7. The cadence selector refetches: monthly asks the engine for monthly and
 *     the headers take the monthly labels; switching back asks for weekly again.
 *  8. Clicking an events cell opens the panel for THAT period: the engine is
 *     asked for the column's start/end, the fixture's two rows are listed, and
 *     the panel links back to that period's review with `?period=…&scope=health`.
 *  9. Editing a row goes through the standard row path: `dbUpsertRow` with the
 *     events response's minted column ids, the row id, the event key in the
 *     `metric` cell, and the values typed. The panel then shows the new text.
 * 10. Deleting a row calls `dbDeleteRow` for that row and the panel reloads
 *     without it.
 * 11. Logging an event calls `metricLogEvent`, the panel reloads with the new
 *     row, and the matrix reloads with the new number.
 * 12. A derived cell opens its source database: the MemoryRouter route becomes
 *     `/data/financial/finance:transactions`.
 * 13. The New metric form calls `metricDefine` with the events definition the
 *     form described (source `events`, id/eventKey slugged from the label) and
 *     the matrix reloads with the new row.
 * 14. Ask-companion uses the app's prepared-chat door: a session is created and
 *     the dock is handed the `Define a metric for …` kickoff — no invented
 *     second transport.
 * 15. The empty read is an empty STATE: a lens with no definitions shows
 *     `analytics-empty`, never an empty grid with fake zeros.
 * 16. No bridge call this rig does not model, and no console error.
 *
 * NOT covered here: that any of it reaches disk (that is the engine's
 * `tests/analytics-engine-e2e.test.ts`), and the shell's own rails/lens visuals
 * (that is `tests/review-ui-e2e.test.ts`).
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
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/analytics.html";

/**
 * A window wide enough for the matrix (nine columns: the row label plus eight
 * periods) and tall enough for the page's header, the cadence row and four
 * definition rows — the shot has to show the shipped surface, not a sliver.
 */
const DEFAULT_SIZE = { width: 1440, height: 1000 };

/** The Review wing's rows, in order — the rail claim's whole basis. */
const REVIEW_RAIL_ROWS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Analytics"];

const errors = [];
/**
 * Everything sampled so far. Module-level rather than local to `main`, so a run
 * that throws part way still writes what it had already seen: a report with only
 * a message is a report nobody can diagnose from.
 */
const checks = {};
const failure = (message) => {
  errors.push(message);
  return message;
};

/* ── the driver's primitives ────────────────────────────────────────────────── */

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

/** Everything this driver reads off the page, in one sample. */
const SAMPLE = `(() => {
  const text = (el) => (el && el.textContent !== undefined ? el.textContent.trim() : null);
  const tid = (id) => document.querySelector('[data-testid="' + id + '"]');
  const field = (id) => {
    const el = tid(id);
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      value: typeof el.value === "string" ? el.value : null,
      options: el.options
        ? Array.from(el.options).map((option) => ({ value: option.value, label: text(option) }))
        : null,
    };
  };
  const railRows = Array.from(
    document.querySelectorAll(".nav-rail__section--wing a.nav-rail__link"),
  ).map((el) => ({
    label: text(el.querySelector(".nav-rail__label")),
    href: el.getAttribute("href"),
    active: String(el.className).includes("--active"),
  }));
  const cadence = field("analytics-cadence");
  const periods = Array.from(
    document.querySelectorAll('[data-testid^="analytics-period-link-"]'),
  ).map((el) => ({
    testid: el.getAttribute("data-testid"),
    label: text(el),
    href: el.getAttribute("href"),
  }));
  const areas = Array.from(document.querySelectorAll('[data-testid^="analytics-area-"]')).map(
    (el) => ({
      testid: el.getAttribute("data-testid"),
      heading: text(el.querySelector("h2, h3, h4, caption, th, .analytics-area__title")),
    }),
  );
  const rows = Array.from(document.querySelectorAll('[data-testid^="analytics-row-"]')).map(
    (el) => ({
      testid: el.getAttribute("data-testid"),
      label: text(el.querySelector("th, .analytics-row__label, [data-label]")) || text(el),
      labelText: text(el.querySelector(".analytics-matrix__label")),
    }),
  );
  const isCell = (id) => id && id.indexOf("analytics-cell-") === 0 && id !== "analytics-cell-panel";
  const cells = Array.from(document.querySelectorAll('[data-testid^="analytics-cell-"]'))
    .filter((el) => isCell(el.getAttribute("data-testid")))
    .map((el) => ({
      testid: el.getAttribute("data-testid"),
      text: text(el),
      value: el.getAttribute("data-value"),
      delta: el.getAttribute("data-delta"),
      nodata: el.getAttribute("data-nodata"),
    }));
  const panel = tid("analytics-cell-panel");
  const isEventRow = (id) => {
    if (!id || id.indexOf("analytics-event-") !== 0) return false;
    return !/^analytics-event-(edit|delete|save|cancel|date|value|note)-/.test(id);
  };
  const events = panel
    ? Array.from(panel.querySelectorAll('[data-testid^="analytics-event-"]'))
        .filter((el) => isEventRow(el.getAttribute("data-testid")))
        .map((el) => ({
          testid: el.getAttribute("data-testid"),
          text: text(el),
        }))
    : [];
  const editFields = Array.from(
    document.querySelectorAll(
      '[data-testid^="analytics-event-date-"], [data-testid^="analytics-event-value-"], [data-testid^="analytics-event-note-"]',
    ),
  ).map((el) => ({ testid: el.getAttribute("data-testid"), value: el.value ?? null }));
  const editButtons = Array.from(
    document.querySelectorAll(
      '[data-testid^="analytics-event-save-"], [data-testid^="analytics-event-cancel-"]',
    ),
  ).map((el) => el.getAttribute("data-testid"));
  const openReview = tid("analytics-open-review");
  const logDate = field("analytics-log-date");
  const metricArea = field("analytics-metric-area");
  const metricAggregation = field("analytics-metric-aggregation");
  return {
    location: window.analyticsRigLocation ?? null,
    page: Boolean(tid("analytics-page")),
    eyebrow: text(tid("wing-eyebrow")) ?? text(document.querySelector(".wing-eyebrow")),
    matrix: Boolean(tid("analytics-matrix")),
    empty: Boolean(tid("analytics-empty")),
    emptyText: text(tid("analytics-empty")),
    loading: Boolean(tid("analytics-loading")),
    error: text(tid("analytics-error")),
    railRows,
    cadence,
    periods,
    areas,
    rows,
    cells,
    panel: { present: Boolean(panel), text: text(panel) },
    events,
    editFields,
    editButtons,
    openReview: openReview
      ? { href: openReview.getAttribute("href"), text: text(openReview) }
      : null,
    log: {
      present: Boolean(tid("analytics-log-form")),
      date: logDate,
      value: field("analytics-log-value"),
      note: field("analytics-log-note"),
      submit: Boolean(tid("analytics-log-submit")),
      status: text(tid("analytics-log-status")),
    },
    metricForm: {
      present: Boolean(tid("analytics-metric-form")),
      mode: tid("analytics-metric-form")?.getAttribute("data-mode") ?? null,
      area: metricArea,
      source: field("analytics-metric-source"),
      label: field("analytics-metric-label"),
      unit: field("analytics-metric-unit"),
      aggregation: metricAggregation,
      target: field("analytics-metric-target"),
      database: field("analytics-metric-database"),
      measure: field("analytics-metric-measure"),
      dateColumn: field("analytics-metric-date"),
      save: Boolean(tid("analytics-metric-save")),
    },
    derivedHint: text(tid("analytics-metric-derived-hint")),
    proposalStatus: text(tid("analytics-proposal-status")),
    deleteConfirm: {
      panel: Boolean(tid("analytics-metric-delete-panel")),
      button: Boolean(tid("analytics-metric-delete-confirm")),
      text: text(tid("analytics-metric-delete-panel")),
    },
    newMetricButton: Boolean(tid("analytics-new-metric")),
    askCompanion: Boolean(tid("analytics-ask-companion")),
    route: window.analyticsRigRoute ?? null,
    calls: window.analyticsRigCalls ?? [],
    unexpectedCalls: window.analyticsRigUnexpectedCalls ?? [],
    matrixInputs: window.analyticsRigMatrixInputs ?? [],
    eventsInputs: window.analyticsRigEventsInputs ?? [],
    logInputs: window.analyticsRigLogInputs ?? [],
    defineInputs: window.analyticsRigDefineInputs ?? [],
    metricGets: window.analyticsRigMetricGets ?? [],
    proposals: window.analyticsRigProposals ?? [],
    dbListInputs: window.analyticsRigDbListInputs ?? [],
    dbCalls: window.analyticsRigDbCalls ?? [],
    kickoffs: window.analyticsRigKickoffs ?? [],
    sessions: window.analyticsRigSessions ? window.analyticsRigSessions() : [],
    expected: window.analyticsRigExpected ?? null,
    eventColumns: window.analyticsRigEventColumns ? window.analyticsRigEventColumns() : null,
    eventRows: window.analyticsRigEvents ? window.analyticsRigEvents() : [],
    definedMetrics: window.analyticsRigDefinedMetrics
      ? window.analyticsRigDefinedMetrics()
      : [],
    dataListenerCount: window.analyticsRigDataListenerCount
      ? window.analyticsRigDataListenerCount()
      : 0,
  };
})()`;

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

function setHarness(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

function frames(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

function click(win, selector) {
  return win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.click();
      return true;
    })()`,
  );
}

function clickTestId(win, testId) {
  return click(win, `[data-testid="${testId}"]`);
}

/** Press one rail row by its visible label (the wing section, not the shelf). */
function clickRailRow(win, label) {
  return win.webContents.executeJavaScript(
    `(() => {
      const row = Array.from(
        document.querySelectorAll(".nav-rail__section--wing a.nav-rail__link"),
      ).find((el) => (el.querySelector(".nav-rail__label")?.textContent ?? "").trim() === ${JSON.stringify(label)});
      if (!row) return false;
      row.click();
      return true;
    })()`,
  );
}

/** Press the title bar's area lens by its visible name. */
function clickLens(win, label) {
  return win.webContents.executeJavaScript(
    `(() => {
      const radio = Array.from(document.querySelectorAll('[role="radio"]')).find(
        (el) => (el.textContent ?? "").trim() === ${JSON.stringify(label)},
      );
      if (!radio) return false;
      radio.click();
      return true;
    })()`,
  );
}

/**
 * A React-controlled field set the way a user's typing would: the native setter
 * then the event the control listens to, so a page controlled by React state
 * sees the change (assigning `.value` alone is invisible to it).
 */
function setField(win, testId, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

/** Pick a `<select>` option by its value; returns the value it settled on. */
function setSelectValue(win, testId, value) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el || !el.options) return null;
    const option = Array.from(el.options).find((entry) => entry.value === ${JSON.stringify(value)});
    if (!option) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  })()`);
}

async function shot(win, name) {
  await frames(win);
  // A fresh checkout has no artifacts directory: it is gitignored, so the first
  // run in a worktree is the one that has to make it.
  fs.mkdirSync(artifactsDir, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = path.join(artifactsDir, name);
  fs.writeFileSync(file, image.toPNG());
  return fs.statSync(file).size;
}

/** ISO date arithmetic, so the fixture's rows can be aimed at its own week. */
function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** One cell by its stable test id, or null. */
function cellOf(page, testId) {
  return page.cells.find((cell) => cell.testid === testId) ?? null;
}

/** Wait until a bridge call with a given prefix has been recorded. */
function waitForCall(win, prefix, label, timeoutMs = 10_000) {
  return waitFor(
    win,
    `(window.analyticsRigCalls ?? []).some((call) => call.indexOf(${JSON.stringify(prefix)}) === 0)`,
    label,
    timeoutMs,
  );
}

function callsOf(win) {
  return setHarness(win, "window.analyticsRigCalls ?? []");
}

/* ── the run ────────────────────────────────────────────────────────────────── */

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `analytics-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  win.showInactive();
  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(e.message);
  });
  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.analyticsRigReady)", "analyticsRigReady");
  await frames(win);

  // ── 1. the literal route, the eyebrow, and the matrix on arrival ───────────
  const arrival = await sample(win);
  checks.arrival = {
    location: arrival.location,
    page: arrival.page,
    eyebrow: arrival.eyebrow,
    cadence: arrival.cadence,
    matrix: arrival.matrix,
    periods: arrival.periods.length,
    error: arrival.error,
  };
  if (arrival.location !== "/review/analytics") {
    failure(
      `the Analytics page is at ${JSON.stringify(arrival.location)}, not "/review/analytics" — the dynamic /review/:cadence route probably won the match`,
    );
  }
  if (!arrival.page) {
    failure("the Analytics page (analytics-page) did not render at /review/analytics");
  }
  if (arrival.eyebrow !== "Review / Analytics") {
    failure(
      `the page's eyebrow reads ${JSON.stringify(arrival.eyebrow)}, expected "Review / Analytics"`,
    );
  }
  if (!arrival.cadence || arrival.cadence.value !== "weekly") {
    failure(
      `the cadence selector opens on ${JSON.stringify(arrival.cadence?.value)}, expected weekly`,
    );
  }
  if (arrival.cadence) {
    const values = (arrival.cadence.options ?? []).map((option) => option.value);
    for (const cadence of ["weekly", "monthly", "quarterly", "yearly"]) {
      if (!values.includes(cadence)) {
        failure(`the cadence selector has no ${cadence} option (${JSON.stringify(values)})`);
      }
    }
  }
  if (arrival.error) failure(`the page paints its error state on arrival: ${arrival.error}`);
  if (!arrival.matrix) {
    failure("the matrix (analytics-matrix) did not render on the Life lens");
  }
  if (arrival.unexpectedCalls.length > 0) {
    failure(
      `the page asked the bridge for methods this rig does not model: ${arrival.unexpectedCalls.join(", ")}`,
    );
  }

  // ── 2. the rail: Analytics is the Review wing's sixth row, after Yearly ────
  // The wing section is drawn from the shell's own routing state; wait for the
  // pending useWing effect of the first paint before reading the order.
  await waitFor(
    win,
    `Array.from(document.querySelectorAll(".nav-rail__section--wing a.nav-rail__link")).some(
      (el) => (el.querySelector(".nav-rail__label")?.textContent ?? "").trim() === "Analytics",
    )`,
    "the Analytics rail row",
  );
  const railRows = (await sample(win)).railRows;
  checks.railRow = {
    rows: railRows.map((row) => row.label),
    analytics: railRows.find((row) => row.label === "Analytics") ?? null,
  };
  const labels = railRows.map((row) => row.label);
  if (JSON.stringify(labels.slice(0, REVIEW_RAIL_ROWS.length)) !== JSON.stringify(REVIEW_RAIL_ROWS)) {
    failure(
      `the Review wing's rail rows are ${JSON.stringify(labels)}, expected ${JSON.stringify(REVIEW_RAIL_ROWS)}`,
    );
  }
  const analyticsRow = railRows.find((row) => row.label === "Analytics");
  if (!analyticsRow) {
    failure("the rail's Review wing has no Analytics row");
  } else if (analyticsRow.href !== "/review/analytics") {
    failure(`the Analytics rail row routes to ${JSON.stringify(analyticsRow.href)}`);
  }
  // Pressing another Review page and coming back proves the row ROUTES, rather
  // than the page simply being the initial entry.
  if (!(await clickRailRow(win, "Weekly"))) {
    failure("the Review wing's Weekly row could not be pressed");
  } else {
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-rig-cadence-probe"]'))`,
      "the Weekly row's page",
    );
    if (!(await clickRailRow(win, "Analytics"))) {
      failure("the Review wing's Analytics row could not be pressed");
    } else {
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-page"]')) && Boolean(document.querySelector('[data-testid="analytics-matrix"]'))`,
        "the Analytics page after the rail press",
      );
      await frames(win);
      const back = await sample(win);
      checks.railNavigation = { location: back.location, page: back.page };
      if (back.location !== "/review/analytics") {
        failure(
          `pressing the Analytics rail row landed on ${JSON.stringify(back.location)}, not /review/analytics`,
        );
      }
      if (!back.page) failure("pressing the Analytics rail row did not draw the page");
    }
  }

  // ── 3. the matrix: engine labels, area groups, served values ───────────────
  const life = await sample(win);
  const expected = life.expected;
  if (!expected) {
    failure("the harness exposed no expected fixture periods");
  }
  const weekly = expected?.weekly ?? [];
  checks.matrix = {
    cadence: life.cadence?.value ?? null,
    periods: life.periods,
    areas: life.areas,
    rows: life.rows,
    cells: life.cells.length,
  };
  if (weekly.length !== 8) {
    failure(`the fixture serves ${weekly.length} weekly periods, expected 8`);
  }
  if (life.periods.length !== 8) {
    failure(
      `the matrix draws ${life.periods.length} period columns, expected 8 (${JSON.stringify(life.periods.map((period) => period.label))})`,
    );
  }
  for (const [index, period] of weekly.entries()) {
    const drawn = life.periods[index];
    if (!drawn) {
      failure(`period column ${index + 1} is missing`);
      continue;
    }
    if (drawn.testid !== `analytics-period-link-${period.period}`) {
      failure(
        `period column ${index + 1} is ${JSON.stringify(drawn.testid)}, expected analytics-period-link-${period.period}`,
      );
    }
    if (drawn.label !== period.label) {
      failure(
        `period column ${index + 1} reads ${JSON.stringify(drawn.label)}, expected the engine's ${JSON.stringify(period.label)}`,
      );
    }
    const href = String(drawn.href ?? "");
    if (!href.includes(`period=${period.period}`)) {
      failure(
        `period column ${index + 1} links to ${JSON.stringify(href)}, without ?period=${period.period}`,
      );
    }
    if (href.includes("scope=")) {
      failure(
        `the Life lens's period link carries a scope (${JSON.stringify(href)}); the Life matrix is every area`,
      );
    }
  }
  const areaIds = life.areas.map((area) => area.testid);
  checks.matrixAreas = areaIds;
  if (JSON.stringify(areaIds) !== JSON.stringify(["analytics-area-health", "analytics-area-financial"])) {
    failure(
      `the Life lens's area groups are ${JSON.stringify(areaIds)}, expected ["analytics-area-health","analytics-area-financial"]`,
    );
  }
  const rowIds = life.rows.map((row) => row.testid);
  checks.matrixRows = rowIds;
  for (const expectedRow of [
    "analytics-row-health-training-sessions",
    "analytics-row-financial-cash-in",
    "analytics-row-financial-cash-out",
    "analytics-row-financial-net-cash-flow",
  ]) {
    if (!rowIds.includes(expectedRow)) {
      failure(`the matrix has no ${expectedRow} row (drawn: ${JSON.stringify(rowIds)})`);
    }
  }

  const lastWeek = weekly[weekly.length - 1];
  if (!lastWeek) throw new Error("the fixture has no last weekly period");
  const nextToLastWeek = weekly[weekly.length - 2];
  // A formatted value is printed as served, with its unit.
  const cashOut = cellOf(life, `analytics-cell-financial-cash-out-${lastWeek.period}`);
  checks.cashOutCell = cashOut;
  if (!cashOut) {
    failure(
      `the Cash out cell (analytics-cell-financial-cash-out-${lastWeek.period}) is not drawn`,
    );
  } else {
    const expectedText = "1,234.56 (ZAR)";
    if (!String(cashOut.value ?? "").includes(expectedText) && !String(cashOut.text ?? "").includes(expectedText)) {
      failure(
        `the Cash out cell prints ${JSON.stringify(cashOut.text)} (data-value ${JSON.stringify(
          cashOut.value,
        )}), expected the served positive ${JSON.stringify(expectedText)}`,
      );
    }
    if (String(cashOut.value ?? cashOut.text ?? "").trim().startsWith("-")) {
      failure(
        `the Cash out cell prints its ledger sign (${JSON.stringify(cashOut.value ?? cashOut.text)}); the definition's magnitude is display-only`,
      );
    }
    if (cashOut.nodata === "true") {
      failure("the Cash out cell is marked no-data although the fixture has a value for it");
    }
  }

  // A no-data cell is the marker, never a zero, and carries no delta.
  const noDataPeriod = weekly[1];
  const noData = cellOf(life, `analytics-cell-health-training-sessions-${noDataPeriod.period}`);
  checks.noDataCell = noData;
  if (!noData) {
    failure(
      `the no-data cell (analytics-cell-health-training-sessions-${noDataPeriod.period}) is not drawn`,
    );
  } else {
    if (noData.nodata !== "true") {
      failure(
        `the cell with no rows has data-nodata=${JSON.stringify(noData.nodata)}, expected "true"`,
      );
    }
    if (!String(noData.text ?? "").includes("—")) {
      failure(
        `the no-data cell prints ${JSON.stringify(noData.text)}, expected the "—" marker`,
      );
    }
    if (noData.delta) {
      failure(
        `the no-data cell carries a delta (${JSON.stringify(noData.delta)}); a delta needs both periods`,
      );
    }
  }

  // A delta IS printed where both columns have data: 5 in the seventh column
  // against 3 in the sixth is +2 (the fixture's health row; the columns beside
  // the two no-data cells have nothing to compare, so they carry no delta).
  const deltaPeriod = weekly[6];
  const deltaCell = cellOf(life, `analytics-cell-health-training-sessions-${deltaPeriod.period}`);
  checks.deltaCell = deltaCell;
  const expectedDelta = "+2";
  if (!deltaCell) {
    failure(
      `the delta cell (analytics-cell-health-training-sessions-${deltaPeriod.period}) is not drawn`,
    );
  } else if (String(deltaCell.delta ?? "") !== expectedDelta && !String(deltaCell.text ?? "").includes(expectedDelta)) {
    failure(
      `the cell where both periods have data prints delta ${JSON.stringify(
        deltaCell.delta,
      )} (text ${JSON.stringify(deltaCell.text)}), expected ${expectedDelta}`,
    );
  }
  if (nextToLastWeek) {
    checks.lastTwoWeeks = [nextToLastWeek.period, lastWeek.period];
  }

  // The picture: the matrix on the Life lens, before any interaction mutates it.
  checks.screenshot = {
    file: path.join(artifactsDir, "analytics.png"),
    bytes: await shot(win, "analytics.png"),
  };
  if (checks.screenshot.bytes < 20_000) {
    failure(
      `the analytics.png screenshot is only ${checks.screenshot.bytes} bytes — the matrix surface was probably not on screen`,
    );
  }

  // ── 4. the Finance lens: only Finance rows, and its period links scope ─────
  if (!(await clickLens(win, "Finance"))) {
    failure("the title bar's Finance lens control was not found");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigMatrixInputs ?? []).some((input) => input.cadence === "weekly" && input.lens === "financial")`,
      "the Finance lens to ask the engine for the Finance matrix",
    );
    await waitFor(
      win,
      `!document.querySelector('[data-testid="analytics-area-health"]') && Boolean(document.querySelector('[data-testid="analytics-area-financial"]'))`,
      "the Finance lens to replace the Life rows",
    );
    await frames(win);
    const finance = await sample(win);
    const financeRows = finance.rows.map((row) => row.testid);
    checks.financeLens = {
      input: finance.matrixInputs.filter((input) => input.lens === "financial").pop() ?? null,
      areas: finance.areas.map((area) => area.testid),
      rows: financeRows,
      periodHref: finance.periods[finance.periods.length - 1]?.href ?? null,
    };
    if (finance.matrixInputs.some((input) => input.lens === "financial") === false) {
      failure("the Finance lens never asked the engine for a Finance-scoped matrix");
    }
    if (finance.areas.length !== 1 || finance.areas[0].testid !== "analytics-area-financial") {
      failure(
        `the Finance lens draws area groups ${JSON.stringify(finance.areas.map((area) => area.testid))}, expected only analytics-area-financial`,
      );
    }
    const leaked = financeRows.filter((row) => !row.startsWith("analytics-row-financial-"));
    if (leaked.length > 0) {
      failure(
        `the Finance lens draws rows from another area: ${JSON.stringify(leaked)}`,
      );
    }
    if (financeRows.length !== 3) {
      failure(
        `the Finance lens draws ${financeRows.length} rows, expected the fixture's three Finance definitions`,
      );
    }
    // `checks.financeLens` holds the sampled link; the sample object itself has
    // `periods`, not `periodHref` (reading the latter always saw undefined).
    const periodHref = String(checks.financeLens.periodHref ?? "");
    if (!periodHref.includes("scope=financial")) {
      failure(
        `the Finance lens's period link is ${JSON.stringify(periodHref)}; it must carry &scope=financial so the review opens on this area`,
      );
    }
    if (!periodHref.includes(`period=${lastWeek.period}`)) {
      failure(
        `the Finance lens's period link is ${JSON.stringify(periodHref)}, without ?period=${lastWeek.period}`,
      );
    }
  }
  // Back to Life for the event legs.
  if (!(await clickLens(win, "LIFE"))) {
    failure("the title bar's Life lens control was not found");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigMatrixInputs ?? []).some((input) => input.cadence === "weekly" && input.lens === null) && Boolean(document.querySelector('[data-testid="analytics-area-health"]'))`,
      "the Life lens to bring the Health rows back",
    );
    await frames(win);
  }

  // ── 5. the cadence selector refetches and relabels ────────────────────────
  const monthlyChoice = await setSelectValue(win, "analytics-cadence", "monthly");
  checks.monthlyChoice = monthlyChoice;
  if (monthlyChoice !== "monthly") {
    failure("the cadence selector has no monthly option to choose");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigMatrixInputs ?? []).some((input) => input.cadence === "monthly")`,
      "the monthly cadence to ask the engine for a monthly matrix",
    );
    const monthlyFirst = expected?.monthly?.[0];
    if (monthlyFirst) {
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-period-link-${monthlyFirst.period}"]'))`,
        "the monthly period columns",
      );
    }
    await frames(win);
    const monthly = await sample(win);
    const monthlyPeriods = monthly.expected?.monthly ?? [];
    checks.monthly = {
      input: monthly.matrixInputs.filter((input) => input.cadence === "monthly").pop() ?? null,
      periods: monthly.periods,
      cadence: monthly.cadence?.value ?? null,
    };
    if (monthly.periods.length !== 8) {
      failure(`the monthly matrix draws ${monthly.periods.length} columns, expected 8`);
    }
    if (monthly.periods.length === life.periods.length) {
      const sameLabels =
        JSON.stringify(monthly.periods.map((period) => period.label)) ===
        JSON.stringify(life.periods.map((period) => period.label));
      if (sameLabels) {
        failure("the cadence switch to monthly left the weekly labels in the headers");
      }
    }
    for (const [index, period] of monthlyPeriods.entries()) {
      const drawn = monthly.periods[index];
      if (!drawn || drawn.label !== period.label) {
        failure(
          `monthly column ${index + 1} reads ${JSON.stringify(drawn?.label)}, expected the engine's ${JSON.stringify(period.label)}`,
        );
      }
    }
    // Back to weekly, so the review links and events legs name weekly periods.
    const weeklyChoice = await setSelectValue(win, "analytics-cadence", "weekly");
    if (weeklyChoice !== "weekly") {
      failure("the cadence selector has no weekly option to return to");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigMatrixInputs ?? []).some((input) => input.cadence === "weekly" && input.lens === null)`,
        "weekly to be read again",
      );
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-cadence"]')?.value ?? "") === "weekly"`,
        "the weekly selector state",
      );
      await frames(win);
    }
  }

  // ── 6. a derived cell opens its source database ───────────────────────────
  const derivedTestId = `analytics-cell-financial-cash-out-${lastWeek.period}`;
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="${derivedTestId}"]'))`,
    "the derived cell after the cadence returned to weekly",
  );
  if (!(await clickTestId(win, derivedTestId))) {
    failure(`the derived cell ${derivedTestId} could not be pressed`);
  } else {
    try {
      await waitFor(
        win,
        `window.analyticsRigRoute?.dbId === "finance:transactions"`,
        "the derived cell to open /data/financial/finance:transactions",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const derived = await sample(win);
    const derivedExpected = (derived.expected ?? expected) ?? {};
    checks.derivedNavigation = derived.route;
    if (derived.route?.pathname !== "/data/financial/finance:transactions") {
      failure(
        `the derived cell navigated to ${JSON.stringify(derived.route?.pathname)}, expected /data/financial/finance:transactions`,
      );
    }
    if (derived.route?.slug !== "financial" || derived.route?.dbId !== "finance:transactions") {
      failure(
        `the derived cell's route params are ${JSON.stringify(derived.route)}, expected area financial and database finance:transactions`,
      );
    }
    if (derived.route?.from !== lastWeek.start || derived.route?.to !== lastWeek.end) {
      failure(
        `the derived cell's period filter is ${JSON.stringify({
          from: derived.route?.from,
          to: derived.route?.to,
        })}, expected the cell's period ${lastWeek.start}..${lastWeek.end}`,
      );
    }
    if (
      !derived.route?.columnId ||
      derived.route.columnId !== derivedExpected.financeDateColumn
    ) {
      failure(
        `the derived cell's period filter names the date column ${JSON.stringify(
          derived.route?.columnId,
        )}, expected the definition's ${JSON.stringify(derivedExpected.financeDateColumn)}`,
      );
    }
    if (!String(derived.route?.search ?? "").includes("columnId=")) {
      failure(
        `the derived cell's URL is ${JSON.stringify(
          derived.route?.search,
        )}, without the columnId period-filter param`,
      );
    }
    // Back to the matrix for the event legs.
    await setHarness(win, `window.analyticsRigGoto("/review/analytics")`);
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-page"]')) && Boolean(document.querySelector('[data-testid="analytics-matrix"]'))`,
      "the Analytics page after returning from the database",
    );
    await waitFor(
      win,
      `(document.querySelector('[data-testid="analytics-cadence"]')?.value ?? "") === "weekly"`,
      "the weekly cadence after returning",
    );
    await frames(win);
  }

  // ── 7. an events cell opens the panel for ITS period ──────────────────────
  const eventsTestId = `analytics-cell-health-training-sessions-${lastWeek.period}`;
  await waitFor(
    win,
    `Boolean(document.querySelector('[data-testid="${eventsTestId}"]'))`,
    "the events cell",
  );
  if (!(await clickTestId(win, eventsTestId))) {
    failure(`the events cell ${eventsTestId} could not be pressed`);
  } else {
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-cell-panel"]'))`,
      "the cell panel to open",
    );
    await waitForCall(win, `metricEvents:health:training-sessions:`, "the panel's events read");
    await frames(win);
    const panel = await sample(win);
    const eventsCall = panel.eventsInputs.filter(
      (input) => input.area === "health" && input.metricId === "training-sessions",
    ).pop();
    checks.eventsPanel = {
      input: eventsCall ?? null,
      rows: panel.events,
      openReview: panel.openReview,
    };
    if (!eventsCall) {
      failure("the panel never asked the engine for the period's events");
    } else if (
      eventsCall.start !== lastWeek.start ||
      eventsCall.end !== lastWeek.end
    ) {
      failure(
        `the panel asked for events ${eventsCall.start}..${eventsCall.end}, expected the cell's period ${lastWeek.start}..${lastWeek.end}`,
      );
    }
    const eventIds = panel.events.map((row) => row.testid);
    if (eventIds.length !== 2) {
      failure(
        `the panel lists ${eventIds.length} events (${JSON.stringify(eventIds)}), expected the fixture's two`,
      );
    }
    if (!eventIds.includes("analytics-event-event-1") || !eventIds.includes("analytics-event-event-2")) {
      failure(
        `the panel's rows are ${JSON.stringify(eventIds)}, expected analytics-event-event-1 and analytics-event-event-2`,
      );
    }
    const openReview = String(panel.openReview?.href ?? "");
    if (!openReview.includes(`period=${lastWeek.period}`)) {
      failure(
        `the panel's review link is ${JSON.stringify(openReview)}, without ?period=${lastWeek.period}`,
      );
    }
    if (!openReview.includes("scope=health")) {
      failure(
        `the panel's review link is ${JSON.stringify(openReview)}, without &scope=health for the events metric's area`,
      );
    }
  }

  // ── 8. editing a row goes through the standard row path ───────────────────
  const editedDate = addDays(lastWeek.start, 2);
  if (!(await clickTestId(win, "analytics-event-edit-event-1"))) {
    failure("the first event row has no edit control (analytics-event-edit-event-1)");
  } else {
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-event-date-event-1"]'))`,
      "the event row's edit fields",
    );
    await setField(win, "analytics-event-date-event-1", editedDate);
    await setField(win, "analytics-event-value-event-1", "3");
    await setField(win, "analytics-event-note-event-1", "Long run");
    if (!(await clickTestId(win, "analytics-event-save-event-1"))) {
      failure("the event row has no save control (analytics-event-save-event-1)");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigDbCalls ?? []).some((call) => call.kind === "upsert" && call.input?.id === "event-1")`,
        "the row edit's dbUpsertRow",
      );
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-event-event-1"]')?.textContent ?? "").includes("Long run")`,
        "the panel to reload the edited row",
      );
      await frames(win);
      const edited = await sample(win);
      const upsert = edited.dbCalls.find(
        (call) => call.kind === "upsert" && call.input?.id === "event-1",
      );
      checks.editRow = { call: upsert ?? null, rows: edited.events };
      if (!upsert) {
        failure("editing the row did not call dbUpsertRow");
      } else {
        const columns = edited.eventColumns;
        const cells = upsert.input?.cells ?? {};
        if (upsert.slug !== "health" || upsert.dbId !== "metrics") {
          failure(
            `the row edit wrote to ${JSON.stringify(upsert.slug)}/${JSON.stringify(
              upsert.dbId,
            )}, expected health/metrics`,
          );
        }
        if (cells[columns.date] !== editedDate) {
          failure(
            `the row edit wrote date ${JSON.stringify(cells[columns.date])}, expected ${editedDate}`,
          );
        }
        if (cells[columns.metric] !== "training-sessions") {
          failure(
            `the row edit wrote metric ${JSON.stringify(
              cells[columns.metric],
            )}, expected the event key "training-sessions" (the row would leave its metric)`,
          );
        }
        if (Number(cells[columns.value]) !== 3) {
          failure(
            `the row edit wrote value ${JSON.stringify(cells[columns.value])}, expected 3`,
          );
        }
        if (cells[columns.note] !== "Long run") {
          failure(
            `the row edit wrote note ${JSON.stringify(cells[columns.note])}, expected "Long run"`,
          );
        }
      }
      const editedRow = edited.events.find((row) => row.testid === "analytics-event-event-1");
      if (!editedRow || !String(editedRow.text ?? "").includes("Long run")) {
        failure(
          `the panel after the edit does not show the updated row: ${JSON.stringify(editedRow?.text ?? null)}`,
        );
      }
    }
  }

  // ── 9. deleting a row calls dbDeleteRow and the panel reloads ─────────────
  if (!(await clickTestId(win, "analytics-event-delete-event-2"))) {
    failure("the second event row has no delete control (analytics-event-delete-event-2)");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigDbCalls ?? []).some((call) => call.kind === "delete" && call.rowId === "event-2")`,
      "the row delete's dbDeleteRow",
    );
    await waitFor(
      win,
      `!Boolean(document.querySelector('[data-testid="analytics-event-event-2"]'))`,
      "the panel to reload without the deleted row",
    );
    await frames(win);
    const deleted = await sample(win);
    const deleteCall = deleted.dbCalls.find(
      (call) => call.kind === "delete" && call.rowId === "event-2",
    );
    checks.deleteRow = { call: deleteCall ?? null, rows: deleted.events };
    if (!deleteCall) {
      failure("deleting the row did not call dbDeleteRow");
    } else if (deleteCall.slug !== "health" || deleteCall.dbId !== "metrics") {
      failure(
        `the row delete called ${JSON.stringify(deleteCall.slug)}/${JSON.stringify(
          deleteCall.dbId,
        )}, expected health/metrics`,
      );
    }
  }

  // ── 10. logging an event reloads the panel and the matrix ─────────────────
  const loggedDate = addDays(lastWeek.start, 5);
  const logDateSet = await setField(win, "analytics-log-date", loggedDate);
  await setField(win, "analytics-log-value", "2");
  await setField(win, "analytics-log-note", "Evening walk");
  const matrixCallsBefore = (await callsOf(win)).filter((call) =>
    String(call).startsWith("analyticsMatrix:"),
  ).length;
  if (!logDateSet) {
    failure("the log form has no date field (analytics-log-date)");
  } else if (!(await clickTestId(win, "analytics-log-submit"))) {
    failure("the log form has no submit button (analytics-log-submit)");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigLogInputs ?? []).some((input) => input.metricId === "training-sessions")`,
      "the log form's metricLogEvent",
    );
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-event-event-3"]'))`,
      "the panel to reload with the logged row",
    );
    // The events metric's last column is the sum of the period's rows: after the
    // edit (3), the delete (—1) and this log (2), the cell must read 5.
    await waitFor(
      win,
      `(document.querySelector('[data-testid="analytics-cell-health-training-sessions-${lastWeek.period}"]')?.getAttribute("data-value") ?? "").includes("5")`,
      "the matrix to reload with the logged event counted",
    );
    await frames(win);
    const logged = await sample(win);
    const logCall = logged.logInputs.filter(
      (input) => input.metricId === "training-sessions",
    ).pop();
    const matrixCell = cellOf(logged, `analytics-cell-health-training-sessions-${lastWeek.period}`);
    const matrixCallsAfter = logged.calls.filter((call) =>
      String(call).startsWith("analyticsMatrix:"),
    ).length;
    checks.logEvent = {
      input: logCall ?? null,
      rows: logged.events,
      matrixCell,
      matrixCallsBefore,
      matrixCallsAfter,
      status: logged.log.status,
    };
    if (!logCall) {
      failure("logging an event did not call metricLogEvent");
    } else {
      if (logCall.area !== "health" || logCall.metricId !== "training-sessions") {
        failure(
          `the log call named ${JSON.stringify(logCall.area)}/${JSON.stringify(
            logCall.metricId,
          )}, expected health/training-sessions`,
        );
      }
      if (logCall.date !== loggedDate) {
        failure(
          `the log call dated the event ${JSON.stringify(logCall.date)}, expected ${loggedDate}`,
        );
      }
      if (Number(logCall.value) !== 2) {
        failure(
          `the log call wrote value ${JSON.stringify(logCall.value)}, expected 2`,
        );
      }
      if (logCall.note !== "Evening walk") {
        failure(
          `the log call wrote note ${JSON.stringify(logCall.note)}, expected "Evening walk"`,
        );
      }
    }
    if (!logged.events.some((row) => row.testid === "analytics-event-event-3")) {
      failure(
        `the panel after logging lists ${JSON.stringify(logged.events.map((row) => row.testid))}, without the new row`,
      );
    }
    if (matrixCallsAfter <= matrixCallsBefore) {
      failure("logging an event did not reload the matrix");
    }
    if (!matrixCell || !String(matrixCell.value ?? "").includes("5")) {
      failure(
        `the matrix cell after logging reads ${JSON.stringify(
          matrixCell?.value ?? matrixCell?.text ?? null,
        )}, expected the events sum 5`,
      );
    }
  }

  // ── 11. the New metric form defines an events metric ──────────────────────
  if (!(await clickTestId(win, "analytics-new-metric"))) {
    failure("the page has no New metric control (analytics-new-metric)");
  } else {
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-metric-form"]'))`,
      "the New metric form",
    );
    const areaSet = await setSelectValue(win, "analytics-metric-area", "health");
    await setField(win, "analytics-metric-label", "Prayer minutes");
    await setField(win, "analytics-metric-unit", "minutes");
    const aggregationSet = await setSelectValue(win, "analytics-metric-aggregation", "sum");
    await setField(win, "analytics-metric-target", "30");
    if (!areaSet) failure("the New metric form has no health area option");
    if (!aggregationSet) failure("the New metric form has no sum aggregation option");
    if (!(await clickTestId(win, "analytics-metric-save"))) {
      failure("the New metric form has no save button (analytics-metric-save)");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigDefineInputs ?? []).length > 0`,
        "the New metric form's metricDefine",
      );
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-row-health-prayer-minutes"]'))`,
        "the matrix to reload with the new metric row",
      );
      await frames(win);
      const defined = await sample(win);
      const defineCall = defined.defineInputs[defined.defineInputs.length - 1];
      checks.newMetric = {
        input: defineCall ?? null,
        rowPresent: defined.rows.some(
          (row) => row.testid === "analytics-row-health-prayer-minutes",
        ),
      };
      if (!defineCall) {
        failure("the New metric form did not call metricDefine");
      } else {
        const definition = defineCall.definition ?? {};
        if (defineCall.area !== "health") {
          failure(
            `the definition's area is ${JSON.stringify(defineCall.area)}, expected health`,
          );
        }
        if (definition.label !== "Prayer minutes") {
          failure(
            `the definition's label is ${JSON.stringify(definition.label)}, expected "Prayer minutes"`,
          );
        }
        if (definition.unit !== "minutes") {
          failure(
            `the definition's unit is ${JSON.stringify(definition.unit)}, expected minutes`,
          );
        }
        if (definition.source !== "events") {
          failure(
            `the definition's source is ${JSON.stringify(definition.source)}, expected events`,
          );
        }
        if (definition.aggregation !== "sum") {
          failure(
            `the definition's aggregation is ${JSON.stringify(
              definition.aggregation,
            )}, expected sum`,
          );
        }
        if (Number(definition.target) !== 30) {
          failure(
            `the definition's target is ${JSON.stringify(definition.target)}, expected 30`,
          );
        }
        if (definition.id !== "prayer-minutes") {
          failure(
            `the definition's id is ${JSON.stringify(definition.id)}, expected the label slugged to "prayer-minutes"`,
          );
        }
        if (definition.eventKey !== "prayer-minutes") {
          failure(
            `the definition's eventKey is ${JSON.stringify(
              definition.eventKey,
            )}, expected the label slugged to "prayer-minutes"`,
          );
        }
      }
      if (!checks.newMetric.rowPresent) {
        failure(
          `the matrix after defining the metric has rows ${JSON.stringify(
            defined.rows.map((row) => row.testid),
          )}, without analytics-row-health-prayer-minutes`,
        );
      }
    }
  }

  // ── 11b. the New metric form defines a database-derived metric ────────────
  if (!(await clickTestId(win, "analytics-new-metric"))) {
    failure("the page has no New metric control (analytics-new-metric) for the derived leg");
  } else {
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="analytics-metric-form"]'))`,
      "the New metric form for the derived leg",
    );
    const sourceSet = await setSelectValue(win, "analytics-metric-source", "derived");
    if (sourceSet !== "derived") {
      failure("the New metric form has no derived source option");
    }
    // An area without databases must say so and point at Data, rather than
    // offering an empty database select with no explanation.
    await setSelectValue(win, "analytics-metric-area", "health");
    let emptyAreaHint = null;
    try {
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-metric-derived-hint"]')?.textContent ?? "").includes("Data")`,
        "the derived form's no-database hint",
      );
      emptyAreaHint = (
        await sample(win)
      ).derivedHint;
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    const derivedAreaSet = await setSelectValue(win, "analytics-metric-area", "financial");
    if (!derivedAreaSet) failure("the New metric form has no Finance area option");
    try {
      await waitFor(
        win,
        `(window.analyticsRigDbListInputs ?? []).includes("financial")`,
        "the derived form's dbList read",
      );
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-metric-database"] option[value="finance:transactions"]'))`,
        "the finance database option",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    const databaseSet = await setSelectValue(
      win,
      "analytics-metric-database",
      "finance:transactions",
    );
    const measureSet = await setSelectValue(
      win,
      "analytics-metric-measure",
      expected?.financeAmountColumn ?? "",
    );
    const dateSet = await setSelectValue(
      win,
      "analytics-metric-date",
      expected?.financeDateColumn ?? "",
    );
    if (!databaseSet) failure("the derived form has no finance:transactions database option");
    if (!measureSet) failure("the derived form has no Amount measure column option");
    if (!dateSet) failure("the derived form has no Date column option");
    await setField(win, "analytics-metric-label", "Card spend");
    await setField(win, "analytics-metric-unit", "ZAR");
    await setSelectValue(win, "analytics-metric-aggregation", "sum");
    await setField(win, "analytics-metric-target", "2000");
    if (!(await clickTestId(win, "analytics-metric-save"))) {
      failure("the derived form has no save button (analytics-metric-save)");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigDefineInputs ?? []).some((input) => input.definition?.source === "derived")`,
        "the derived form's metricDefine",
      );
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-row-financial-card-spend"]'))`,
        "the matrix to reload with the derived metric row",
      );
      await frames(win);
      const derivedForm = await sample(win);
      const derivedDefine = derivedForm.defineInputs
        .filter((input) => input.definition?.source === "derived")
        .pop();
      checks.derivedForm = {
        input: derivedDefine ?? null,
        hint: derivedForm.derivedHint,
        emptyAreaHint,
        rowPresent: derivedForm.rows.some(
          (row) => row.testid === "analytics-row-financial-card-spend",
        ),
      };
      if (!derivedDefine) {
        failure("the derived form did not call metricDefine with a derived draft");
      } else {
        const definition = derivedDefine.definition ?? {};
        if (derivedDefine.area !== "financial") {
          failure(
            `the derived definition's area is ${JSON.stringify(derivedDefine.area)}, expected financial`,
          );
        }
        if (definition.source !== "derived") {
          failure(
            `the derived definition's source is ${JSON.stringify(definition.source)}, expected derived`,
          );
        }
        if (definition.id !== "card-spend" || definition.label !== "Card spend") {
          failure(
            `the derived definition is ${JSON.stringify({
              id: definition.id,
              label: definition.label,
            })}, expected the label slugged to card-spend`,
          );
        }
        if (definition.databaseId !== "finance:transactions") {
          failure(
            `the derived definition's database is ${JSON.stringify(definition.databaseId)}, expected finance:transactions`,
          );
        }
        if (definition.measureColumnId !== (expected?.financeAmountColumn ?? "")) {
          failure(
            `the derived definition's measure column is ${JSON.stringify(definition.measureColumnId)}, expected the Amount column`,
          );
        }
        if (definition.timeColumnId !== (expected?.financeDateColumn ?? "")) {
          failure(
            `the derived definition's date column is ${JSON.stringify(definition.timeColumnId)}, expected the Date column`,
          );
        }
        if (definition.aggregation !== "sum") {
          failure(
            `the derived definition's aggregation is ${JSON.stringify(definition.aggregation)}, expected sum`,
          );
        }
        if (Number(definition.target) !== 2000) {
          failure(
            `the derived definition's target is ${JSON.stringify(definition.target)}, expected 2000`,
          );
        }
        if (definition.spec !== undefined) {
          failure(
            "the renderer sent a ViewSpec; a derived draft must let the engine build the spec",
          );
        }
      }
      if (!checks.derivedForm.rowPresent) {
        failure("the matrix did not reload with analytics-row-financial-card-spend");
      }
    }
  }

  // ── 11c. editing a definition proposes an update; the matrix keeps the old one ──
  const editTestId = "analytics-metric-edit-financial-cash-out";
  if (!(await clickTestId(win, editTestId))) {
    failure(`the Cash out row has no edit control (${editTestId})`);
  } else {
    try {
      await waitFor(
        win,
        `(window.analyticsRigMetricGets ?? []).some((input) => input.metricId === "cash-out")`,
        "the edit form's metricGet",
      );
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-metric-form"]')?.getAttribute("data-mode") ?? "") === "edit"`,
        "the edit form",
      );
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-metric-database"]')?.value ?? "") === "finance:transactions"`,
        "the edit form's database prefill",
      );
      // The measure column only comes from metricGet, so waiting for it proves
      // the whole prefill landed before the driver types into the form.
      await waitFor(
        win,
        `(document.querySelector('[data-testid="analytics-metric-measure"]')?.value ?? "") === ${JSON.stringify(expected?.financeAmountColumn ?? "")}`,
        "the edit form's measure prefill",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const editForm = await sample(win);
    checks.editDefinition = {
      get: editForm.metricGets.filter((input) => input.metricId === "cash-out").pop() ?? null,
      form: {
        mode: editForm.metricForm.mode,
        source: editForm.metricForm.source?.value ?? null,
        label: editForm.metricForm.label?.value ?? null,
        database: editForm.metricForm.database?.value ?? null,
        measure: editForm.metricForm.measure?.value ?? null,
        dateColumn: editForm.metricForm.dateColumn?.value ?? null,
        aggregation: editForm.metricForm.aggregation?.value ?? null,
        unit: editForm.metricForm.unit?.value ?? null,
      },
      proposal: null,
      proposalStatus: null,
      rowLabel: null,
      defineCallsBefore: editForm.defineInputs.length,
    };
    const prefilled = checks.editDefinition.form;
    if (prefilled.source !== "derived") {
      failure(
        `the edit form's source is ${JSON.stringify(prefilled.source)}, expected derived (prefilled from metricGet)`,
      );
    }
    if (prefilled.label !== "Cash out") {
      failure(
        `the edit form's label is ${JSON.stringify(prefilled.label)}, expected the definition's "Cash out"`,
      );
    }
    if (prefilled.measure !== (expected?.financeAmountColumn ?? "")) {
      failure(
        `the edit form's measure column is ${JSON.stringify(prefilled.measure)}, expected the definition's Amount column`,
      );
    }
    if (prefilled.dateColumn !== (expected?.financeDateColumn ?? "")) {
      failure(
        `the edit form's date column is ${JSON.stringify(prefilled.dateColumn)}, expected the definition's Date column`,
      );
    }
    await setField(win, "analytics-metric-label", "Cash out (gross)");
    if (!(await clickTestId(win, "analytics-metric-save"))) {
      failure("the edit form has no save control (analytics-metric-save)");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigProposals ?? []).some((input) => input.action === "update" && input.metricId === "cash-out")`,
        "the edit form's metricPropose update",
      );
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-proposal-status"]'))`,
        "the proposal status line",
      );
      await frames(win);
      const edited = await sample(win);
      const proposal = edited.proposals
        .filter((input) => input.action === "update" && input.metricId === "cash-out")
        .pop();
      const cashOutRow = edited.rows.find(
        (row) => row.testid === "analytics-row-financial-cash-out",
      );
      checks.editDefinition = {
        ...checks.editDefinition,
        proposal: proposal ?? null,
        proposalStatus: edited.proposalStatus,
        rowLabel: cashOutRow?.labelText ?? null,
        defineCallsAfter: edited.defineInputs.length,
      };
      if (!proposal) {
        failure("editing the definition did not call metricPropose with action update");
      } else {
        const definition = proposal.definition ?? {};
        if (proposal.area !== "financial") {
          failure(
            `the update proposal's area is ${JSON.stringify(proposal.area)}, expected financial`,
          );
        }
        if (definition.id !== "cash-out") {
          failure(
            `the update draft's id is ${JSON.stringify(definition.id)}, expected cash-out (an edit keeps the id)`,
          );
        }
        if (definition.label !== "Cash out (gross)") {
          failure(
            `the update draft's label is ${JSON.stringify(definition.label)}, expected "Cash out (gross)"`,
          );
        }
        if (definition.source !== "derived") {
          failure(
            `the update draft's source is ${JSON.stringify(definition.source)}, expected derived`,
          );
        }
        if (definition.databaseId !== "finance:transactions") {
          failure(
            `the update draft's database is ${JSON.stringify(definition.databaseId)}, expected finance:transactions`,
          );
        }
      }
      if (!String(checks.editDefinition.proposalStatus ?? "").includes("Sent to Decisions")) {
        failure(
          `the proposal status reads ${JSON.stringify(
            checks.editDefinition.proposalStatus,
          )}, expected "Sent to Decisions — applying it changes what this metric measures."`,
        );
      }
      if (checks.editDefinition.rowLabel !== "Cash out") {
        failure(
          `the matrix row reads ${JSON.stringify(
            checks.editDefinition.rowLabel,
          )} before the Decision is approved, expected the unchanged "Cash out"`,
        );
      }
      if (checks.editDefinition.defineCallsAfter !== checks.editDefinition.defineCallsBefore) {
        failure("editing a definition called metricDefine; an edit must be proposed in Decisions");
      }
    }
  }

  // ── 11d. deleting a definition confirms, then proposes a delete ────────────
  const deleteTestId = "analytics-metric-delete-financial-cash-in";
  if (!(await clickTestId(win, deleteTestId))) {
    failure(`the Cash in row has no delete control (${deleteTestId})`);
  } else {
    try {
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-metric-delete-confirm"]'))`,
        "the delete confirm",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const confirmForm = await sample(win);
    checks.deleteDefinition = {
      confirmShown: confirmForm.deleteConfirm.button,
      confirmText: confirmForm.deleteConfirm.text,
      proposal: null,
      proposalStatus: null,
      rowPresent: confirmForm.rows.some(
        (row) => row.testid === "analytics-row-financial-cash-in",
      ),
    };
    if (!checks.deleteDefinition.confirmShown) {
      failure("pressing Delete did not open the confirm (analytics-metric-delete-confirm)");
    }
    if (!String(checks.deleteDefinition.confirmText ?? "").includes("Cash in")) {
      failure(
        `the delete confirm says ${JSON.stringify(
          checks.deleteDefinition.confirmText,
        )}, without naming the Cash in metric`,
      );
    }
    if (!(await clickTestId(win, "analytics-metric-delete-confirm"))) {
      failure("the delete confirm could not be pressed");
    } else {
      await waitFor(
        win,
        `(window.analyticsRigProposals ?? []).some((input) => input.action === "delete" && input.metricId === "cash-in")`,
        "the delete confirm's metricPropose",
      );
      await frames(win);
      const deleted = await sample(win);
      const proposal = deleted.proposals
        .filter((input) => input.action === "delete" && input.metricId === "cash-in")
        .pop();
      checks.deleteDefinition = {
        ...checks.deleteDefinition,
        proposal: proposal ?? null,
        proposalStatus: deleted.proposalStatus,
        rowPresent: deleted.rows.some(
          (row) => row.testid === "analytics-row-financial-cash-in",
        ),
      };
      if (!proposal) {
        failure("the delete confirm did not call metricPropose with action delete");
      } else {
        if (proposal.area !== "financial") {
          failure(
            `the delete proposal's area is ${JSON.stringify(proposal.area)}, expected financial`,
          );
        }
        if (proposal.definition !== undefined) {
          failure("the delete proposal carried a definition; a delete names the metric only");
        }
      }
      if (!String(checks.deleteDefinition.proposalStatus ?? "").includes("Sent to Decisions")) {
        failure(
          `the delete proposal's status reads ${JSON.stringify(
            checks.deleteDefinition.proposalStatus,
          )}, expected "Sent to Decisions — applying it changes what this metric measures."`,
        );
      }
      if (!checks.deleteDefinition.rowPresent) {
        failure(
          "the Cash in row disappeared after the delete proposal; the definition must stay until the Decision is approved",
        );
      }
    }
  }

  // ── 12. ask-companion opens the prepared chat ─────────────────────────────
  const sessionsBefore = (await sample(win)).sessions.length;
  if (!(await clickTestId(win, "analytics-ask-companion"))) {
    failure("the page has no ask-companion control (analytics-ask-companion)");
  } else {
    try {
      await waitFor(
        win,
        `(window.analyticsRigKickoffs ?? []).some((kickoff) => /define a metric for/i.test(kickoff))`,
        "the companion chat's prepared kickoff",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const asked = await sample(win);
    const kickoff = asked.kickoffs.find((text) => /define a metric for/i.test(text)) ?? null;
    checks.askCompanion = { kickoff, sessions: asked.sessions.length, sessionsBefore };
    if (!kickoff) {
      failure(
        `ask-companion sent no "Define a metric for …" kickoff (sent: ${JSON.stringify(asked.kickoffs)})`,
      );
    }
    if (asked.sessions.length <= sessionsBefore) {
      failure("ask-companion did not create the chat it opened the dock onto");
    }
  }

  // ── 13. a lens with no definitions shows the empty state ──────────────────
  if (!(await clickLens(win, "Mind"))) {
    failure("the title bar's Mind lens control was not found");
  } else {
    await waitFor(
      win,
      `(window.analyticsRigMatrixInputs ?? []).some((input) => input.lens === "mind")`,
      "the Mind lens to ask the engine for its (empty) matrix",
    );
    try {
      await waitFor(
        win,
        `Boolean(document.querySelector('[data-testid="analytics-empty"]'))`,
        "the empty state",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const empty = await sample(win);
    checks.emptyState = {
      input: empty.matrixInputs.filter((input) => input.lens === "mind").pop() ?? null,
      empty: empty.empty,
      text: empty.emptyText,
      rows: empty.rows.map((row) => row.testid),
    };
    if (!empty.empty) {
      failure("the empty matrix (a lens with no definitions) draws no analytics-empty state");
    }
    if (empty.rows.length > 0) {
      failure(
        `the empty matrix still draws rows: ${JSON.stringify(empty.rows.map((row) => row.testid))}`,
      );
    }
  }

  // ── 14. nothing unexpected, nothing in the console ───────────────────────
  const unexpected = await setHarness(win, "window.analyticsRigUnexpectedCalls ?? []");
  checks.unexpectedBridgeCalls = unexpected;
  if (unexpected.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${unexpected.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) {
    failure(`console errors: ${consoleErrors.join(" | ")}`);
  }
  checks.dataListenerCount = await setHarness(
    win,
    "window.analyticsRigDataListenerCount ? window.analyticsRigDataListenerCount() : 0",
  );
  if (checks.dataListenerCount < 1) {
    failure("the page holds no listener on the vault's change signal, so a write cannot reload it");
  }
  checks.calls = await callsOf(win);

  // ── the report ────────────────────────────────────────────────────────────
  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "analytics.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `[analytics] ${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} failure(s)`,
  );
  for (const message of errors) console.log(`  ✗ ${message}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

setTimeout(() => {
  console.error("analytics rig timed out");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "analytics.json"),
    `${JSON.stringify(
      {
        pass: false,
        failures: [...errors, "analytics rig timed out"],
        checks,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  app.exit(1);
}, 150_000);

app
  .whenReady()
  .then(main)
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`analytics rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "analytics.json"),
      `${JSON.stringify(
        {
          pass: false,
          failures: [...errors, message],
          checks,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });
