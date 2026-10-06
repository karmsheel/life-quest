/**
 * Drives the pages-studio harness in a real Electron window and writes
 * `e2e/artifacts/pages-studio.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/pages-studio.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required.
 *
 * What this rig claims:
 *
 *  1. Parity with the Data surface. The two suites are mounted side by side with
 *     the same width, and their computed eyebrow / title / lead / panel chrome /
 *     panel head / count badge / list-row anatomy / sub line / field are
 *     deep-equal. A change to one surface that does not reach the other turns
 *     this into a named failure listing both sides.
 *  2. The list reads as a list: no bullets, no padding, rows own the full row
 *     width, one chevron per row, a domain chip per row in the overview lens.
 *  3. Rows are ordered newest-updated first, which the fixture deliberately
 *     does not match.
 *  4. The filter narrows the list, the no-match state names the query and reads
 *     differently from the empty-vault state, and clearing restores the list.
 *  5. The layout is two columns at 1280 and one column at 700 — the container
 *     query is actually wired to the rail.
 *  6. Create still works: submitting with no domain is refused with the named
 *     error, and submitting with a domain writes through `pageCreate`, after
 *     which the new page is on the list (the stub models the write).
 *  7. The empty vault keeps its own empty state — "No pages yet." — with no
 *     filter field offered.
 *
 * NOT covered here: the nav rail, the chat panel or the router — this is the
 * surface inside the shell's content area.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/pages-studio.html";
const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 700, height: 900 };

/** Fields that must be identical on both surfaces — the parity contract. */
const PARITY_KEYS = [
  "eyebrow",
  "title",
  "lead",
  "panel",
  "head2",
  "count",
  "row",
  "sub",
  "input",
  "list",
];

const PAGES_CFG = `{
  row: ".page-list__open",
  list: ".page-list",
  sub: ".page-list__sub",
  name: ".page-list__name",
  chevron: ".page-list__chevron",
  chip: ".page-list__domain",
  input: ".pages-studio .input-field",
  submit: ".pages-studio__submit",
  empty: ".pages-studio__empty-title",
  filter: ".pages-studio__filter .input-field",
  error: ".pages-studio__banner--error",
  stat: ".pages-studio__stat"
}`;

const DATA_CFG = `{
  row: ".database-list__open",
  list: ".database-list",
  sub: ".database-list__sub",
  name: ".database-list__name",
  chevron: ".database-list__chevron",
  chip: ".database-list__domain",
  input: ".data-studio .input-field",
  submit: ".data-studio__submit",
  empty: ".data-studio__empty",
  filter: ".data-studio__filter .input-field",
  error: ".data-studio__banner--error",
  stat: ".data-studio__stat"
}`;

const SAMPLE = `(() => {
  const g = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = s[p];
    return o;
  };
  const frac = (el) =>
    el && el.parentElement && el.parentElement.clientWidth
      ? Math.round((el.offsetWidth / el.parentElement.clientWidth) * 1000) / 1000
      : null;
  const probe = (hostSel, rootSel, cfg) => {
    const host = document.querySelector(hostSel);
    if (!host) return { missing: hostSel };
    const q = (s) => host.querySelector(s);
    const root = q(rootSel);
    if (!root) return { missing: rootSel };
    const panel = q(rootSel + "__panel");
    const rows = Array.from(host.querySelectorAll(cfg.row));
    const layout = q(rootSel + "__layout");
    const rail = q(rootSel + "__rail");
    const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
    return {
      hostWidth: host.clientWidth,
      eyebrow: g(q(rootSel + "__eyebrow"), ["fontSize", "fontWeight", "letterSpacing", "textTransform", "color"]),
      title: g(q(rootSel + "__title"), ["fontSize", "fontWeight", "letterSpacing", "lineHeight"]),
      lead: g(q(rootSel + "__lead"), ["fontSize", "lineHeight", "color", "maxWidth"]),
      panel: g(panel, ["borderTopWidth", "borderTopStyle", "borderTopColor", "backgroundColor", "boxShadow", "paddingTop", "paddingLeft", "paddingBottom", "paddingRight", "borderTopLeftRadius"]),
      head2: g(q(rootSel + "__panel-head h2"), ["fontSize", "fontWeight", "letterSpacing", "textTransform", "color"]),
      count: g(q(rootSel + "__count"), ["fontSize", "minWidth", "borderTopWidth", "backgroundColor", "textAlign", "borderTopLeftRadius"]),
      row: rows[0]
        ? Object.assign(
            { height: rows[0].offsetHeight, fillsParent: frac(rows[0]) },
            g(rows[0], ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderLeftWidth", "borderLeftColor", "borderTopLeftRadius"]),
          )
        : null,
      rowCount: rows.length,
      rowFills: rows.map(frac),
      sub: g(q(cfg.sub), ["fontSize", "color"]),
      input: q(cfg.input)
        ? Object.assign(
            { fillsParent: frac(q(cfg.input)) },
            g(q(cfg.input), ["borderTopWidth", "backgroundColor", "paddingTop", "paddingLeft", "appearance", "lineHeight", "borderTopLeftRadius"]),
          )
        : null,
      list: g(q(cfg.list), ["listStyleType", "marginLeft", "marginRight", "paddingLeft"]),
      submit: q(cfg.submit)
        ? Object.assign(
            { fillsParent: frac(q(cfg.submit)), disabled: q(cfg.submit).disabled },
            g(q(cfg.submit), ["borderTopLeftRadius", "borderTopWidth"]),
          )
        : null,
      layout: {
        columns: layout ? getComputedStyle(layout).gridTemplateColumns : null,
        rail: rail ? Math.round(rail.getBoundingClientRect().width) : null,
        list: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      },
      countText: text(q(rootSel + "__count")),
      chevrons: host.querySelectorAll(cfg.chevron).length,
      chips: host.querySelectorAll(cfg.chip).length,
      names: rows.map((r) => text(r.querySelector(cfg.name))),
      subs: rows.map((r) => text(r.querySelector(cfg.sub))),
      emptyText: text(q(cfg.empty)),
      filterPresent: Boolean(q(cfg.filter)),
      filterValue: q(cfg.filter) ? q(cfg.filter).value : null,
      errorText: text(q(cfg.error)),
      stats: Array.from(host.querySelectorAll(cfg.stat)).map((li) => li.textContent.replace(/\\s+/g, " ").trim()),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  };
  return {
    pages: probe("#pages-sample", ".pages-studio", ${PAGES_CFG}),
    data: probe("#data-sample", ".data-studio", ${DATA_CFG}),
  };
})()`;

const errors = [];
const failure = (message) => {
  errors.push(message);
  return message;
};

/**
 * Poll for the state we are waiting on. Never sleep a fixed interval, and never
 * wait on a frame: a hidden window suspends rAF, so a frame-based wait never
 * returns and the run hangs with nothing to read.
 */
function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        // Vite can reload the page mid-wait (re-optimising a new import), which
        // clears the harness globals: that is "not ready yet".
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

/** Drive a React-controlled input (or select) the way a user would. */
const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  return true;
})()`;

const click = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

/** Act, then wait for the state the caller names — never for a frame. */
async function act(win, expression, label, predicate, timeoutMs = 10_000) {
  await win.webContents.executeJavaScript(expression);
  await waitFor(win, predicate, label, timeoutMs);
}

const rowsAre = (n) =>
  `document.querySelectorAll("#pages-sample .page-list__item").length === ${n}`;

async function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

/**
 * A window sized for the case it measures. Shrinking and re-growing one window
 * does not work on this host — `setContentSize(1280)` back from 700 leaves
 * `innerWidth` at 700 (measured), so a single-window rig would assert the
 * restored layout against a window that never grew back.
 */
async function open(size) {
  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setContentSize(size.width, size.height);
  win.showInactive();
  await win.loadURL(url);
  await waitFor(win, "Boolean(window.pagesStudioReady)", "pagesStudioReady");
  await waitFor(
    win,
    'document.querySelectorAll("#pages-sample .page-list__item").length === 3',
    "the pages list to settle",
  );
  return win;
}

async function main() {
  const win = await open(WIDE);

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await waitFor(
    win,
    'document.querySelectorAll("#data-sample .database-list__item").length === 2',
    "the data list to settle",
  );

  const checks = {};
  const baseline = await sample(win);
  checks.baselineWidths = {
    pages: baseline.pages.hostWidth,
    data: baseline.data.hostWidth,
  };
  if (baseline.pages.hostWidth !== baseline.data.hostWidth) {
    failure(
      `the two surfaces got different widths (${baseline.pages.hostWidth} vs ${baseline.data.hostWidth}) — every px parity claim below is void`,
    );
  }

  // ── 1. parity with the Data surface ───────────────────────────────────────
  checks.parity = {};
  for (const key of PARITY_KEYS) {
    const left = baseline.pages[key];
    const right = baseline.data[key];
    const equal = JSON.stringify(left) === JSON.stringify(right);
    checks.parity[key] = { equal, pages: left, data: right };
    if (!equal) {
      failure(
        `parity ${key} differs — pages ${JSON.stringify(left)} vs data ${JSON.stringify(right)}`,
      );
      checks.parity[key].pagesOnly = Object.keys(left ?? {})
        .filter((k) => JSON.stringify(left[k]) !== JSON.stringify(right?.[k]))
        .map((k) => `${k}: ${JSON.stringify(left[k])} vs ${JSON.stringify(right?.[k])}`);
    }
  }

  // ── 2. the list reads as a list ───────────────────────────────────────────
  const list = baseline.pages.list;
  checks.noBullets = list?.listStyleType === "none" && list?.paddingLeft === "0px";
  if (!checks.noBullets) {
    failure(`the page list still paints markers: ${JSON.stringify(list)}`);
  }
  checks.rowsOwnTheRow = baseline.pages.rowFills.every((f) => f === 1);
  if (!checks.rowsOwnTheRow) {
    failure(`a page row does not span its row: ${JSON.stringify(baseline.pages.rowFills)}`);
  }
  checks.chevronPerRow = baseline.pages.chevrons === baseline.pages.rowCount;
  if (!checks.chevronPerRow) {
    failure(
      `${baseline.pages.chevrons} chevrons for ${baseline.pages.rowCount} rows`,
    );
  }
  checks.chipPerRow = baseline.pages.chips === baseline.pages.rowCount;
  if (!checks.chipPerRow) {
    failure(`overview lens shows ${baseline.pages.chips} domain chips for ${baseline.pages.rowCount} rows`);
  }
  checks.countBadge = baseline.pages.countText === "3";
  if (!checks.countBadge) failure(`count badge read "${baseline.pages.countText}", expected "3"`);
  checks.rowSubLines = baseline.pages.subs;
  checks.rowSubShaped = baseline.pages.subs.every(
    (s) => /blocks? · Updated \d{4}-\d{2}-\d{2}$/.test(s ?? ""),
  );
  if (!checks.rowSubShaped) failure(`a row sub line is not "N blocks · Updated YYYY-MM-DD": ${JSON.stringify(baseline.pages.subs)}`);

  // ── 3. newest-updated first (fixture order is deliberately not this) ──────
  checks.order = baseline.pages.names;
  const expectedOrder = ["Budget review", "Training plan", "Sleep log"];
  if (JSON.stringify(checks.order) !== JSON.stringify(expectedOrder)) {
    failure(`list order ${JSON.stringify(checks.order)} != ${JSON.stringify(expectedOrder)}`);
  }

  // ── 4. two columns, rail capped ───────────────────────────────────────────
  checks.wideLayout = baseline.pages.layout;
  const wideTracks = (baseline.pages.layout.columns ?? "").trim().split(/\s+/).length;
  if (wideTracks !== 2) {
    failure(`at 1280 the layout resolved to ${wideTracks} column(s): ${baseline.pages.layout.columns}`);
  }
  if (!(baseline.pages.layout.rail > 240 && baseline.pages.layout.rail <= 360)) {
    failure(`the rail measured ${baseline.pages.layout.rail}px, outside (240, 360]`);
  }
  if (!(baseline.pages.layout.list > baseline.pages.layout.rail)) {
    failure(`the list column (${baseline.pages.layout.list}px) is not wider than the rail (${baseline.pages.layout.rail}px)`);
  }
  checks.dataLayoutMatches =
    JSON.stringify(baseline.pages.layout.columns) === JSON.stringify(baseline.data.layout.columns) &&
    Math.abs(baseline.pages.layout.rail - baseline.data.layout.rail) <= 1;
  if (!checks.dataLayoutMatches) {
    failure(
      `the two-column geometry differs from Data: pages ${JSON.stringify(baseline.pages.layout)} vs data ${JSON.stringify(baseline.data.layout)}`,
    );
  }

  // ── 5. the header says what the page is ───────────────────────────────────
  checks.eyebrowText = await win.webContents.executeJavaScript(
    'document.querySelector("#pages-sample .pages-studio__eyebrow").textContent.trim()',
  );
  checks.createPanelHead = await win.webContents.executeJavaScript(
    'document.querySelector("#pages-domains-heading").textContent.trim()',
  );
  checks.domainStats = baseline.pages.stats;
  if (checks.domainStats.length !== 2) {
    failure(`the By-domain panel listed ${checks.domainStats.length} rows, expected 2`);
  }
  checks.createDisabledWhenEmpty = baseline.pages.submit?.disabled === true;
  if (!checks.createDisabledWhenEmpty) {
    failure("the create button is enabled with an empty title");
  }
  checks.createFillsRail = baseline.pages.submit?.fillsParent === 1;
  if (!checks.createFillsRail) {
    failure(`the create button fills ${baseline.pages.submit?.fillsParent} of the rail, expected 1`);
  }

  // ── 6. the filter ─────────────────────────────────────────────────────────
  await act(
    win,
    setValue(".pages-studio__filter .input-field", "budget"),
    "the filter to narrow the list",
    rowsAre(1),
  );
  const filtered = await sample(win);
  checks.filterNarrowed = {
    rows: filtered.pages.rowCount,
    names: filtered.pages.names,
    countText: filtered.pages.countText,
  };
  if (filtered.pages.rowCount !== 1 || filtered.pages.names[0] !== "Budget review") {
    failure(`filter "budget" left ${JSON.stringify(filtered.pages.names)}`);
  }
  if (filtered.pages.countText !== "1") {
    failure(`count badge read "${filtered.pages.countText}" while filtered, expected "1"`);
  }

  await act(
    win,
    setValue(".pages-studio__filter .input-field", "zzz"),
    "the no-match state",
    '/No pages match/.test((document.querySelector("#pages-sample .pages-studio__empty-title") || {}).textContent || "")',
  );
  const noMatch = await sample(win);
  checks.noMatch = { rows: noMatch.pages.rowCount, empty: noMatch.pages.emptyText };
  if (noMatch.pages.rowCount !== 0) failure(`no-match filter still painted ${noMatch.pages.rowCount} rows`);
  if (!/No pages match/.test(noMatch.pages.emptyText ?? "")) {
    failure(`the no-match state read "${noMatch.pages.emptyText}"`);
  }
  if (/No pages yet/.test(noMatch.pages.emptyText ?? "")) {
    failure("the no-match state reuses the empty-vault copy");
  }

  await act(
    win,
    setValue(".pages-studio__filter .input-field", ""),
    "the filter to clear",
    rowsAre(3),
  );
  const cleared = await sample(win);
  checks.filterCleared = cleared.pages.rowCount;
  if (cleared.pages.rowCount !== 3) failure(`clearing the filter left ${cleared.pages.rowCount} rows`);

  // ── 7. the layout stacks when the container is narrow ─────────────────────
  const narrowWin = await open(NARROW);
  const narrow = await sample(narrowWin);
  checks.narrowLayout = narrow.pages.layout;
  checks.narrowViewport = narrow.pages.viewport;
  checks.narrowRowsStillFill = narrow.pages.rowFills.every((f) => f === 1);
  if (narrow.pages.viewport.width !== NARROW.width) {
    failure(`the narrow window measured ${narrow.pages.viewport.width}px, not ${NARROW.width}`);
  }
  if (narrow.pages.layout.columns.trim().split(/\s+/).length !== 1) {
    failure(`at ${NARROW.width}px the layout kept ${narrow.pages.layout.columns}`);
  }
  if (!checks.narrowRowsStillFill) {
    failure(`a row stopped spanning its row when narrow: ${JSON.stringify(narrow.pages.rowFills)}`);
  }
  if (!(narrow.pages.layout.rail <= narrow.pages.layout.list)) {
    failure("the stacked rail is wider than the list column");
  }
  const narrowImage = await narrowWin.webContents.capturePage();
  narrowWin.destroy();

  // ── 8. create: refused without a domain, then written ────────────────────
  await act(
    win,
    setValue(".pages-studio__form .input-field", "Race plan"),
    "the create button to arm",
    'document.querySelector(".pages-studio__submit").disabled === false',
  );
  const typed = await sample(win);
  checks.createArmed = typed.pages.submit?.disabled === false;
  if (!checks.createArmed) failure("the create button stayed disabled with a title typed");

  const callsBeforeRefusal = await win.webContents.executeJavaScript(
    "window.pagesStudioCalls.filter((c) => c.startsWith('pageCreate')).length",
  );
  await act(
    win,
    click(".pages-studio__submit"),
    "the domain-less refusal",
    '/Select a domain to create a page in/.test((document.querySelector("#pages-sample .pages-studio__banner--error") || {}).textContent || "")',
  );
  const refused = await sample(win);
  const callsAfterRefusal = await win.webContents.executeJavaScript(
    "window.pagesStudioCalls.filter((c) => c.startsWith('pageCreate')).length",
  );
  checks.refusal = { text: refused.pages.errorText, calls: callsAfterRefusal - callsBeforeRefusal };
  if (!/Select a domain to create a page in/.test(refused.pages.errorText ?? "")) {
    failure(`submitting without a domain said "${refused.pages.errorText}"`);
  }
  if (checks.refusal.calls !== 0) {
    failure(`submitting without a domain still called pageCreate ${checks.refusal.calls} time(s)`);
  }

  await act(
    win,
    setValue(".pages-studio__form select.input-field", "health"),
    "the domain select to take",
    'document.querySelector(".pages-studio__form select.input-field").value === "health"',
  );
  await act(win, click(".pages-studio__submit"), "the created page to land", rowsAre(4));
  const created = await sample(win);
  const createCalls = await win.webContents.executeJavaScript(
    "window.pagesStudioCalls.filter((c) => c.startsWith('pageCreate'))",
  );
  checks.createCalls = createCalls;
  checks.createdRow = {
    rows: created.pages.rowCount,
    first: created.pages.names[0],
    countText: created.pages.countText,
    errorText: created.pages.errorText,
  };
  if (createCalls.length !== 1 || createCalls[0] !== "pageCreate:health:Race plan") {
    failure(`pageCreate calls were ${JSON.stringify(createCalls)}`);
  }
  if (created.pages.rowCount !== 4) failure(`the list did not grow: ${created.pages.rowCount} rows`);
  if (created.pages.names[0] !== "Race plan") {
    failure(`the new page is not first (newest) on the list: ${JSON.stringify(created.pages.names[0])}`);
  }
  if (created.pages.errorText !== null) failure(`an error banner survived a successful create: ${created.pages.errorText}`);

  // ── 9. the empty vault keeps its own state ────────────────────────────────
  await act(
    win,
    "window.pagesHarness.setPages([])",
    "the empty vault state",
    'document.querySelector("#pages-sample .pages-studio__empty-title") !== null',
  );
  const empty = await sample(win);
  checks.emptyVault = {
    rows: empty.pages.rowCount,
    empty: empty.pages.emptyText,
    filterPresent: empty.pages.filterPresent,
    countText: empty.pages.countText,
    createPresent: empty.pages.submit !== null,
  };
  if (empty.pages.rowCount !== 0) failure(`the empty vault painted ${empty.pages.rowCount} rows`);
  if (empty.pages.emptyText !== "No pages yet.") {
    failure(`the empty vault read "${empty.pages.emptyText}"`);
  }
  if (empty.pages.filterPresent) {
    failure("the empty vault still offers a filter field");
  }
  if (empty.pages.countText !== "0") failure(`the empty vault badge read "${empty.pages.countText}"`);
  if (!checks.emptyVault.createPresent) failure("the empty vault dropped the create panel");

  checks.finalSample = empty;
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    viewport: { wide: WIDE, narrow: NARROW },
    checks,
    baseline,
  };

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "pages-studio.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(artifactsDir, "pages-studio-narrow.png"), narrowImage.toPNG());
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "pages-studio.png"), image.toPNG());

  const rows = PARITY_KEYS.map((key) => {
    const cell = checks.parity[key];
    return `  ${key.padEnd(9)} ${cell.equal ? "==" : "!!"}  ${JSON.stringify(cell.pages)}`;
  });
  console.log(`hosts: pages ${baseline.pages.hostWidth}px  data ${baseline.data.hostWidth}px`);
  console.log(`parity with Data:\n${rows.join("\n")}`);
  console.log(
    `list: ${baseline.pages.rowCount} rows  order ${JSON.stringify(baseline.pages.names)}`,
  );
  console.log(`wide layout: ${JSON.stringify(baseline.pages.layout)}`);
  console.log(`narrow layout: ${JSON.stringify(narrow.pages.layout)}`);
  console.log(
    `filter: 3 → ${filtered.pages.rowCount} (budget) → ${noMatch.pages.rowCount} (zzz) → ${cleared.pages.rowCount}`,
  );
  console.log(`create: ${JSON.stringify(createCalls)}  rows ${created.pages.rowCount}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);

  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    // A throw mid-flow (a wait that timed out) must still leave the artifact
    // behind: the next session reads the JSON, not this stdout.
    try {
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactsDir, "pages-studio.json"),
        `${JSON.stringify(
          {
            pass: false,
            failures: [...errors, String(error)],
            aborted: true,
            checks: {},
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      // nothing else to do — the exit code already says the run failed
    }
    app.exit(1);
  });

setTimeout(() => {
  console.error("pages-studio rig timed out");
  app.exit(1);
}, 120_000);
