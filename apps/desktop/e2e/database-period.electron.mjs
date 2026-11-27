/**
 * Drives the DatabasePage period-filter harness in a real Electron window and
 * turns what the Data page actually renders into
 * `e2e/artifacts/database-period.json` plus one picture.
 *
 * Run with the dev server up (`npm run dev`, or the repository's e2e runner):
 *
 *   node e2e/database-period.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same claims. The picture, from this same run:
 *
 *   database-period.png   the opened Transactions database on a
 *                         `?from=&to=&columnId=` deep link: the Rows panel's
 *                         "Showing 2026-10-12 → 2026-10-18" chip with its Clear
 *                         button, and only the three in-range rows drawn.
 *
 * What this rig claims, and what makes each claim falsifiable:
 *
 *  1. The deep link is read as the page opens: `/data/financial/finance:transactions`
 *     with `?from=2026-10-12&to=2026-10-18&columnId=date` leaves exactly the
 *     three rows whose date falls in that week on screen, and the three
 *     out-of-range rows (the week before, the week after) absent — proved by
 *     their dates AND their payees. The Rows table is the real table (Date,
 *     Payee, Amount, Actions) and the bridge served six rows, so the page read
 *     six and drew three: this is a display filter, not a narrowed read.
 *  2. The chip names the range (`Showing 2026-10-12 → 2026-10-18`) and lives in
 *     the Rows panel head with a Clear button beside it.
 *  3. Clearing the chip strips `from`, `to` and `columnId` with `replace`, and
 *     all rows come back: the six the database holds plus the one this run
 *     added (see 4). It does not re-filter from the emptied URL.
 *  4. The filter does not reach the create path: with the chip showing,
 *     "Add row" still calls `dbUpsertRow`, the page reloads, and the new row is
 *     only outside the period (it has no date yet), not lost.
 *  5. A plain open (no params) draws all six rows and no chip, exactly as today.
 *  6. A `columnId` that names a NUMBER column is ignored: all six rows, no chip,
 *     no throw.
 *  7. A malformed date and a missing `to` are ignored the same way.
 *  8. No bridge call this rig does not model, and no console error.
 *  9. The page holds a listener on the vault's change signal, so a write it did
 *     not make through its own call can still reload it.
 *
 * NOT covered here: that the Analytics matrix emits the matching link (that is
 * the analytics rig's derived-cell leg), the sync/ingest flows (the fixture has
 * no adapter and no staged batches, so those legs are not exercised — the filter
 * only narrows the Rows panel's rendered list), and the real vault (the bridge
 * is stubbed). `?from=&to=&columnId=` entered in the app's own HashRouter URL is
 * the router's wiring, which this MemoryRouter harness deliberately does not
 * restate.
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
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/database-period.html";

/** Wide enough for the two-column page and tall enough for the Rows panel. */
const SIZE = { width: 1440, height: 1000 };

/* ── the claim's fixture, restated ─────────────────────────────────────────── */

const SLUG = "financial";
const DB_ID = "finance:transactions";
const ROUTE = `/data/${SLUG}/${DB_ID}`;
const FROM = "2026-10-12";
const TO = "2026-10-18";
const COLUMN_ID = "date";

const ALL_DATES = [
  "2026-10-03",
  "2026-10-08",
  "2026-10-12",
  "2026-10-14",
  "2026-10-16",
  "2026-10-21",
];
const IN_RANGE_DATES = ["2026-10-12", "2026-10-14", "2026-10-16"];
/** The rows the link must NOT show, by the date each carries. */
const OUT_OF_RANGE_DATES = ["2026-10-03", "2026-10-08", "2026-10-21"];
/** …and by the payee each carries, so a misread date cannot hide a row. */
const OUT_OF_RANGE_PAYEES = ["Grocer", "Fuel", "Books"];
const HEADERS = ["Date", "Payee", "Amount", "Actions"];

const errors = [];
/**
 * Everything sampled so far. Module-level rather than local to `main`, so a run
 * that throws part way still writes what it had already seen: a report with only
 * a message is a report nobody can diagnose from.
 */
const checks = {};
const screenshots = [];
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
  const rowsPanel = Array.from(
    document.querySelectorAll(".database-page .data-studio__panel"),
  ).find((section) => text(section.querySelector(".data-studio__panel-head h2")) === "Rows");
  const table = rowsPanel ? rowsPanel.querySelector("table.data-table") : null;
  const headers = table
    ? Array.from(table.querySelectorAll("thead th")).map((el) => text(el))
    : [];
  const rows = table
    ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td"))
          .slice(0, Math.max(headers.length - 1, 0))
          .map((td) => {
            const input = td.querySelector("input");
            return input ? (input.value ?? "") : text(td);
          }),
      )
    : [];
  const chip = tid("db-period-filter");
  const range = chip ? chip.querySelector(".data-studio__period-filter-range") : null;
  const addRow = rowsPanel
    ? Array.from(rowsPanel.querySelectorAll(".data-studio__panel-head button")).find(
        (button) => text(button) === "Add row",
      )
    : null;
  return {
    location: window.databasePeriodLocation ?? null,
    page: Boolean(document.querySelector(".database-page")),
    title: text(document.querySelector(".database-page .data-studio__title")),
    lead: text(document.querySelector(".database-page .data-studio__lead")),
    error: text(document.querySelector(".database-page .data-studio__banner--error")),
    chip: chip
      ? {
          text: text(chip),
          range: range ? text(range) : null,
          clear: Boolean(tid("db-period-filter-clear")),
        }
      : null,
    headers,
    rows,
    addRow: Boolean(addRow),
    rowsServed: window.databasePeriodRowsServed ?? 0,
    loads: window.databasePeriodLoads ?? 0,
    writes: window.databasePeriodWrites ?? [],
    calls: window.databasePeriodCalls ?? [],
    unexpectedCalls: window.databasePeriodUnexpectedCalls ?? [],
    expected: window.databasePeriodExpected ?? null,
    dataListenerCount: window.databasePeriodDataListenerCount
      ? window.databasePeriodDataListenerCount()
      : 0,
  };
})()`;

function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

function frames(win) {
  return win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

/** A real click through the DOM, so React's own handlers run. */
function clickTestId(win, testId) {
  return win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.click();
      return true;
    })()`,
  );
}

/** Press the Rows panel's "Add row" button, found by its own label. */
function clickAddRow(win) {
  return win.webContents.executeJavaScript(`(() => {
    const panel = Array.from(
      document.querySelectorAll(".database-page .data-studio__panel"),
    ).find(
      (section) =>
        (section.querySelector(".data-studio__panel-head h2")?.textContent ?? "").trim() === "Rows",
    );
    if (!panel) return false;
    const button = Array.from(panel.querySelectorAll(".data-studio__panel-head button")).find(
      (el) => (el.textContent ?? "").trim() === "Add row",
    );
    if (!button) return false;
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
    button.click();
    return true;
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
  screenshots.push(file);
  return fs.statSync(file).size;
}

/** The dates the drawn rows carry, in order. */
function rowDates(page) {
  return page.rows.map((cells) => String(cells[0] ?? ""));
}

/** The payees the drawn rows carry, in order. */
function rowPayees(page) {
  return page.rows.map((cells) => String(cells[1] ?? ""));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ── the run ────────────────────────────────────────────────────────────────── */

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `database-period-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(SIZE.width, SIZE.height);
  win.showInactive();
  const consoleErrors = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") consoleErrors.push(e.message);
  });

  /**
   * Vite re-optimises dependencies the first time a new import appears and
   * reloads the page when it does, which clears the harness globals mid-wait —
   * so poll for the ready promise instead of assuming the module ran once.
   */
  const waitForHarness = async (label, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await win.webContents.executeJavaScript(
          "Boolean(window.databasePeriodReady) ? window.databasePeriodReady.then(() => true) : false",
        );
        if (ready === true) return true;
        last = "harness globals not present yet";
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`harness never became ready for ${label}: ${last}`);
  };

  /** A cold load of one entry route; the only way MemoryRouter takes a link. */
  const openRoute = async (entry, label) => {
    await win.loadURL(`${url}?route=${encodeURIComponent(entry)}`);
    await waitForHarness(label);
    await frames(win);
    return sample(win);
  };

  // ── 1. the deep link: three rows, the chip, six read ─────────────────────
  const deepLink = await openRoute(
    `${ROUTE}?from=${FROM}&to=${TO}&columnId=${COLUMN_ID}`,
    "/data/financial/finance:transactions?from=&to=&columnId=",
  );
  checks.deepLink = {
    location: deepLink.location,
    title: deepLink.title,
    lead: deepLink.lead,
    error: deepLink.error,
    headers: deepLink.headers,
    dates: rowDates(deepLink),
    payees: rowPayees(deepLink),
    chip: deepLink.chip,
    rowsServed: deepLink.rowsServed,
    loads: deepLink.loads,
    unexpectedCalls: deepLink.unexpectedCalls,
    expected: deepLink.expected,
    dataListenerCount: deepLink.dataListenerCount,
  };
  const expectedLocation = `${ROUTE}?from=${FROM}&to=${TO}&columnId=${COLUMN_ID}`;
  if (deepLink.location !== expectedLocation) {
    failure(
      `the deep link opened ${JSON.stringify(deepLink.location)}, expected ${JSON.stringify(expectedLocation)}`,
    );
  }
  if (!deepLink.page) failure("the database page (database-page) did not render");
  if (deepLink.title !== "Transactions") {
    failure(`the page title reads ${JSON.stringify(deepLink.title)}, expected "Transactions"`);
  }
  if (deepLink.error) failure(`the page paints its error state on arrival: ${deepLink.error}`);
  if (!same(deepLink.headers, HEADERS)) {
    failure(
      `the Rows table's columns are ${JSON.stringify(deepLink.headers)}, expected ${JSON.stringify(HEADERS)}`,
    );
  }
  if (deepLink.rowsServed !== ALL_DATES.length) {
    failure(
      `the bridge served ${deepLink.rowsServed} rows, expected ${ALL_DATES.length} — the page narrowed the read instead of the display`,
    );
  }
  if (deepLink.rows.length !== IN_RANGE_DATES.length) {
    failure(
      `the deep link draws ${deepLink.rows.length} rows (${JSON.stringify(rowDates(deepLink))}), expected ${IN_RANGE_DATES.length}`,
    );
  }
  if (!same(rowDates(deepLink), IN_RANGE_DATES)) {
    failure(
      `the deep link draws dates ${JSON.stringify(rowDates(deepLink))}, expected ${JSON.stringify(IN_RANGE_DATES)}`,
    );
  }
  if (!same(deepLink.expected?.inRangeDates, IN_RANGE_DATES)) {
    failure(
      `the fixture's own in-range dates are ${JSON.stringify(deepLink.expected?.inRangeDates)}, expected ${JSON.stringify(IN_RANGE_DATES)}`,
    );
  }
  for (const date of OUT_OF_RANGE_DATES) {
    if (rowDates(deepLink).includes(date)) {
      failure(`an out-of-range row (${date}) is still drawn on the deep link`);
    }
  }
  for (const payee of OUT_OF_RANGE_PAYEES) {
    if (rowPayees(deepLink).includes(payee)) {
      failure(`an out-of-range row (${payee}) is still drawn on the deep link`);
    }
  }
  if (!deepLink.chip) {
    failure("the period chip (db-period-filter) did not render on the deep link");
  } else {
    if (deepLink.chip.range !== `Showing ${FROM} → ${TO}`) {
      failure(
        `the chip reads ${JSON.stringify(deepLink.chip.range)}, expected ${JSON.stringify(`Showing ${FROM} → ${TO}`)}`,
      );
    }
    if (!deepLink.chip.clear) {
      failure("the chip has no clear button (db-period-filter-clear)");
    }
  }
  if (deepLink.unexpectedCalls.length > 0) {
    failure(
      `the page asked the bridge for methods this rig does not model: ${deepLink.unexpectedCalls.join(", ")}`,
    );
  }
  if (deepLink.dataListenerCount < 1) {
    failure("the page holds no listener on the vault's change signal");
  }
  await shot(win, "database-period.png");

  // ── 2. create still writes while the period is showing ────────────────────
  const beforeAdd = await sample(win);
  if (!(await clickAddRow(win))) {
    failure("the Rows panel's Add row button was not found");
  } else {
    const deadline = Date.now() + 10_000;
    let added = false;
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript(
        "({ writes: (window.databasePeriodWrites ?? []).length, loads: window.databasePeriodLoads ?? 0 })",
      );
      if (state.writes >= 1 && state.loads > beforeAdd.loads) {
        added = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!added) {
      failure(
        "Add row did not reach dbUpsertRow and reload the page (no write or no second dbGet)",
      );
    }
    await frames(win);
    const afterAdd = await sample(win);
    checks.addRow = {
      writes: afterAdd.writes,
      loads: afterAdd.loads,
      dates: rowDates(afterAdd),
      chip: afterAdd.chip,
    };
    const write = afterAdd.writes[0];
    if (!write || write.kind !== "upsert" || write.slug !== SLUG || write.dbId !== DB_ID) {
      failure(`Add row wrote through ${JSON.stringify(write)}, expected dbUpsertRow on ${SLUG}/${DB_ID}`);
    } else if (write.id !== null) {
      failure(`Add row asked to upsert a named row ${JSON.stringify(write.id)}, expected a new row`);
    }
    if (afterAdd.rows.length !== IN_RANGE_DATES.length) {
      failure(
        `with the period showing, Add row changed the drawn count to ${afterAdd.rows.length} (${JSON.stringify(rowDates(afterAdd))}) — a new undated row is outside the period`,
      );
    }
    if (!afterAdd.chip) {
      failure("the period chip vanished after Add row");
    }
  }

  // ── 3. clear: all rows back, the three params gone ────────────────────────
  if (!(await clickTestId(win, "db-period-filter-clear"))) {
    failure("the chip's clear button was not found");
  } else {
    try {
      await waitFor(
        win,
        `!document.querySelector('[data-testid="db-period-filter"]') && document.querySelectorAll(".database-page table.data-table tbody tr").length === ${ALL_DATES.length + 1}`,
        "the cleared page (chip gone, all seven rows)",
      );
      // React Router runs a navigation in a transition, so the router's own
      // location can land a paint after the chip and rows do. Wait for the URL
      // the clear asked for, not for the state around it.
      await waitFor(
        win,
        `window.databasePeriodLocation === ${JSON.stringify(ROUTE)}`,
        "the cleared URL",
      );
    } catch (error) {
      failure(String(error instanceof Error ? error.message : error));
    }
    await frames(win);
    const cleared = await sample(win);
    checks.clear = {
      location: cleared.location,
      dates: rowDates(cleared),
      payees: rowPayees(cleared),
      chip: cleared.chip,
      rows: cleared.rows.length,
    };
    if (cleared.location !== ROUTE) {
      failure(
        `clearing the chip left the URL at ${JSON.stringify(cleared.location)}, expected ${JSON.stringify(ROUTE)}`,
      );
    }
    if (cleared.chip) {
      failure("the chip is still drawn after Clear");
    }
    if (cleared.rows.length !== ALL_DATES.length + 1) {
      failure(
        `after Clear the page draws ${cleared.rows.length} rows, expected ${ALL_DATES.length + 1} (the six the database holds plus the one Add row made)`,
      );
    }
    if (!same(rowDates(cleared).slice(0, ALL_DATES.length), ALL_DATES)) {
      failure(
        `after Clear the drawn dates are ${JSON.stringify(rowDates(cleared))}, expected the six fixture dates in order`,
      );
    }
    for (const date of OUT_OF_RANGE_DATES) {
      if (!rowDates(cleared).includes(date)) {
        failure(`after Clear the out-of-range row ${date} did not come back`);
      }
    }
  }

  // ── 4. a plain open behaves exactly as today ──────────────────────────────
  const plain = await openRoute(ROUTE, "a plain open");
  checks.plain = {
    location: plain.location,
    dates: rowDates(plain),
    chip: plain.chip,
    rowsServed: plain.rowsServed,
    unexpectedCalls: plain.unexpectedCalls,
  };
  if (plain.rowsServed !== ALL_DATES.length || plain.rows.length !== ALL_DATES.length) {
    failure(
      `a plain open draws ${plain.rows.length} of ${plain.rowsServed} rows, expected all ${ALL_DATES.length}`,
    );
  }
  if (!same(rowDates(plain), ALL_DATES)) {
    failure(
      `a plain open draws dates ${JSON.stringify(rowDates(plain))}, expected ${JSON.stringify(ALL_DATES)}`,
    );
  }
  if (plain.chip) failure("a plain open draws the period chip");
  if (plain.location !== ROUTE) {
    failure(`a plain open is at ${JSON.stringify(plain.location)}, expected ${JSON.stringify(ROUTE)}`);
  }
  if (plain.unexpectedCalls.length > 0) {
    failure(
      `a plain open asked the bridge for methods this rig does not model: ${plain.unexpectedCalls.join(", ")}`,
    );
  }

  // ── 5. a columnId that is not a date column is ignored ────────────────────
  const badColumn = await openRoute(
    `${ROUTE}?from=${FROM}&to=${TO}&columnId=amount`,
    "a link with a number column",
  );
  checks.badColumn = {
    location: badColumn.location,
    dates: rowDates(badColumn),
    chip: badColumn.chip,
    unexpectedCalls: badColumn.unexpectedCalls,
  };
  if (!same(rowDates(badColumn), ALL_DATES)) {
    failure(
      `a link naming the number column draws ${JSON.stringify(rowDates(badColumn))}, expected all six rows`,
    );
  }
  if (badColumn.chip) {
    failure("a link naming a number column drew the period chip — a non-date column was trusted");
  }
  if (badColumn.unexpectedCalls.length > 0) {
    failure(
      `a link naming a number column asked the bridge for unmodelled methods: ${badColumn.unexpectedCalls.join(", ")}`,
    );
  }

  // ── 6. malformed and incomplete links are ignored ─────────────────────────
  const malformedDate = await openRoute(
    `${ROUTE}?from=2026-13-01&to=${TO}&columnId=${COLUMN_ID}`,
    "a link with an impossible date",
  );
  const missingTo = await openRoute(
    `${ROUTE}?from=${FROM}&columnId=${COLUMN_ID}`,
    "a link with no to",
  );
  checks.invalidLinks = {
    malformed: { dates: rowDates(malformedDate), chip: malformedDate.chip },
    missingTo: { dates: rowDates(missingTo), chip: missingTo.chip },
  };
  if (!same(rowDates(malformedDate), ALL_DATES) || malformedDate.chip) {
    failure(
      `a link with the impossible date 2026-13-01 draws ${JSON.stringify(rowDates(malformedDate))} with chip ${JSON.stringify(malformedDate.chip)} — invalid dates must be ignored`,
    );
  }
  if (!same(rowDates(missingTo), ALL_DATES) || missingTo.chip) {
    failure(
      `a link with no \`to\` draws ${JSON.stringify(rowDates(missingTo))} with chip ${JSON.stringify(missingTo.chip)} — an incomplete link must be ignored`,
    );
  }

  // ── 7. nothing unexpected, nothing in the console ─────────────────────────
  const final = await sample(win);
  checks.unexpectedBridgeCalls = final.unexpectedCalls;
  if (final.unexpectedCalls.length > 0) {
    failure(`the page called bridge methods this rig does not model: ${final.unexpectedCalls.join(", ")}`);
  }
  checks.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) {
    failure(`console errors: ${consoleErrors.join(" | ")}`);
  }
  checks.calls = final.calls;

  // ── the report ────────────────────────────────────────────────────────────
  const report = {
    pass: errors.length === 0,
    failures: errors,
    checks,
    fixtures: {
      route: ROUTE,
      range: { from: FROM, to: TO, columnId: COLUMN_ID },
      dates: ALL_DATES,
      inRangeDates: IN_RANGE_DATES,
      outOfRangeDates: OUT_OF_RANGE_DATES,
      headers: HEADERS,
    },
    screenshots,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "database-period.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `[database-period] ${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} failure(s)`,
  );
  for (const message of errors) console.log(`  ✗ ${message}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

setTimeout(() => {
  console.error("database-period rig timed out");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "database-period.json"),
    `${JSON.stringify(
      {
        pass: false,
        failures: [...errors, "database-period rig timed out"],
        checks,
        screenshots,
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
    console.error(`database-period rig threw: ${message}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "database-period.json"),
      `${JSON.stringify(
        {
          pass: false,
          failures: [...errors, message],
          checks,
          screenshots,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  });
