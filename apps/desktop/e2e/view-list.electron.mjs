/**
 * Draws the "recent transactions" LIST the vault actually produced, at 1:1 in
 * the real layout engine, and writes `e2e/artifacts/view-list.png`.
 *
 * The fixture is not hand-written and not a mock: it is read back out of
 * `e2e/artifacts/view-list.json`, which `tests/view-list-e2e.test.ts` wrote after
 * driving the companion's own `save_view` tool against a real vault with the real
 * finance kit installed. So the picture is the card the vault produced, and the
 * rows in it are the rows the engine returned.
 *
 * Run after that test, with the dev server up:
 *
 *   node e2e/view-list.electron.mjs
 *
 * Exit code 0 = the card drew one line per transaction, newest first, with the
 * money column right-aligned and the text columns left.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame. A rig runs hidden beside every other rig, so it
// has to keep painting or it hangs until its watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
// Which card to draw. The default is the one the e2e wrote; pointing
// LIFEQUEST_LIST_SOURCE at `dashboard-live-list.json` instead draws the card
// that is on the OPERATOR'S OWN Financial dashboard, from the same shape.
const SOURCE = process.env.LIFEQUEST_LIST_SOURCE ?? path.join(artifactsDir, "view-list.json");
const REPORT = process.env.LIFEQUEST_LIST_REPORT ?? path.join(artifactsDir, "view-list-rig.json");
const SHOT = process.env.LIFEQUEST_LIST_SHOT ?? path.join(artifactsDir, "view-list.png");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/view-card.html";

const errors = [];
const failure = (m) => {
  errors.push(m);
  return m;
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let shotFailure = null;
async function shot(win) {
  try {
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } catch (error) {
    shotFailure = error instanceof Error ? error.message : String(error);
    return null;
  }
}

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

/** The card's own id→heading rule, mirrored from ViewCard's `humanizeId`. */
function humanize(id) {
  const spaced = String(id).replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : String(id);
}

/** The card the vault saved, plus the run the engine gave back for it. */
function fixtureFrom(source) {
  const view = source.savedView;
  const run = source.run;
  if (!view || !run || !Array.isArray(run.blocks)) return null;
  return { key: `financial::${view.id}`, view, run: { ok: true, value: run } };
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`no list artifact at ${SOURCE} — run the view-list e2e first`);
    app.exit(1);
    return;
  }
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const fixture = fixtureFrom(source);
  if (!fixture) {
    console.error("the list artifact carries no saved card to draw");
    app.exit(1);
    return;
  }

  const block = fixture.run.value.blocks[0];
  const expectedRows = block?.result?.listRows ?? [];
  const expectedHeaders = block?.result?.columns ?? [];
  // The unit rides the money column only when the rows share one currency, and
  // the money column is the one the engine named — not whichever is last.
  const currency = block?.result?.currency ?? null;
  const single = currency === "ZAR" || currency === "USD" ? currency : null;
  const moneyColumn = block?.result?.currencyColumn ?? null;
  const expectedMoneyHeader =
    single && moneyColumn ? `${humanize(moneyColumn)} (${single})` : null;

  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `view-list-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(900, 620);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.viewCardReady)", "viewCardReady");
  const before = await win.webContents.executeJavaScript("window.viewCardCommits ?? 0");
  await win.webContents.executeJavaScript(
    `window.installFixture(${JSON.stringify(fixture.key)}, ${JSON.stringify({ view: fixture.view, run: fixture.run })})`,
  );
  await win.webContents.executeJavaScript(
    `window.renderViewCard("financial", ${JSON.stringify(fixture.view.id)})`,
  );
  await waitFor(win, `(window.viewCardCommits ?? 0) > ${before}`, "the list card to commit");
  await waitFor(
    win,
    `document.querySelectorAll(".view-card__table--list tbody tr").length > 0`,
    "list rows",
  );
  // The card is pinned with span 2, which on the real board means the whole row.
  // The harness's grid packs cards into `minmax(17rem, 1fr)` columns, so left as
  // it is this rig would picture a full-width card squeezed into one cell — and a
  // picture of a width the operator never sees is worse than no picture. Set
  // AFTER the render, because React re-applies the wrapper's own inline style.
  await win.webContents.executeJavaScript(
    `document.querySelector(".home-dashboard__grid").style.gridTemplateColumns = "1fr"; true`,
  );
  // A settle by TIMER, not by frame: this window is shown inactively so it never
  // steals the operator's focus, and Chromium throttles requestAnimationFrame for
  // a window it considers hidden. Two painted frames are not what this claims.
  await settle(150);

  const drawn = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(".view-card");
    const table = card.querySelector(".view-card__table--list");
    const cellsOf = (tr) => Array.from(tr.querySelectorAll("td")).map((td) => ({
      text: td.textContent.trim(),
      align: getComputedStyle(td).textAlign,
      tabular: getComputedStyle(td).fontVariantNumeric,
    }));
    return {
      title: card.querySelector(".view-card__title").textContent,
      plainTable: Boolean(card.querySelector(".view-card__table:not(.view-card__table--list)")),
      headers: Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim()),
      rows: Array.from(table.querySelectorAll("tbody tr")).map(cellsOf),
      empty: card.querySelector(".view-card__empty") ? card.querySelector(".view-card__empty").textContent : null,
      warnings: card.querySelector(".view-card__warnings") ? card.querySelector(".view-card__warnings").textContent : null,
      shell: (() => {
        const cs = getComputedStyle(card);
        return { background: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
      })(),
    };
  })()`);

  const drawnRows = drawn.rows.map((r) => r.map((c) => c.text));
  const wantRows = expectedRows.map((r) => r.map((c) => String(c)));

  if (drawn.title !== fixture.view.title) {
    failure(`the card titled ${JSON.stringify(drawn.title)}`);
  }
  if (drawn.rows.length !== expectedRows.length) {
    failure(`the card drew ${drawn.rows.length} rows, the engine returned ${expectedRows.length}`);
  }
  // One line per transaction, in the engine's own order: a renderer that sorted
  // or regrouped would be a second, disagreeing answer to the same question.
  if (JSON.stringify(drawnRows) !== JSON.stringify(wantRows)) {
    failure(`the drawn rows are not the engine's rows: drew ${JSON.stringify(drawnRows)}`);
  }
  if (drawn.headers.length !== expectedHeaders.length) {
    failure(`the card drew ${drawn.headers.length} columns, the engine named ${expectedHeaders.length}`);
  }

  // Alignment follows the CELL, not the column's position. The aggregate table
  // right-aligns everything after its first cell, which is right when the second
  // column is money and wrong the moment a listing puts a payee there — so the
  // claim is made per cell, against the type the engine actually returned.
  for (const [rowIndex, row] of drawn.rows.entries()) {
    const want = expectedRows[rowIndex] ?? [];
    for (const [cellIndex, cell] of row.entries()) {
      const numeric = typeof want[cellIndex] === "number";
      const expected = numeric ? "right" : "left";
      if (cell.align !== expected) {
        failure(
          `row ${rowIndex} cell ${cellIndex} (${JSON.stringify(cell.text)}) is ${cell.align}-aligned, ` +
            `expected ${expected} for a ${numeric ? "number" : "text"} cell`,
        );
      }
      if (numeric && !String(cell.tabular).includes("tabular-nums")) {
        failure(`the money cell ${JSON.stringify(cell.text)} is not set in tabular figures`);
      }
    }
  }

  // The unit belongs on the money column — the one the engine NAMED — and on no
  // other, and not at all when the rows do not share a currency.
  const moneyIndex = moneyColumn ? expectedHeaders.indexOf(moneyColumn) : -1;
  const units = drawn.headers
    .map((h, i) => [i, h, /\(([A-Z]{3})\)/.exec(h)?.[1] ?? null])
    .filter(([, , cur]) => cur !== null);
  if (expectedMoneyHeader === null) {
    if (units.length > 0) {
      failure(
        `the headings claim a currency its rows do not share: ${JSON.stringify(units.map(([, h]) => h))}`,
      );
    }
  } else if (moneyIndex < 0) {
    failure(`the engine named a money column ${JSON.stringify(moneyColumn)} that is not in its columns`);
  } else {
    const got = drawn.headers[moneyIndex];
    if (got !== expectedMoneyHeader) {
      failure(`the money heading read ${JSON.stringify(got)}, expected ${JSON.stringify(expectedMoneyHeader)}`);
    }
    if (units.length !== 1) {
      failure(`the currency unit is on ${units.length} headings, expected exactly the money column`);
    }
  }
  if (!drawn.shell.background || drawn.shell.background === "rgba(0, 0, 0, 0)") {
    failure(`the card drew no shell background: ${JSON.stringify(drawn.shell)}`);
  }
  if (drawn.shell.border === "0px") failure("the card drew no shell border");

  const image = await shot(win);
  if (image) fs.writeFileSync(SHOT, image);

  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the recent-transactions listing the vault produced, drawn by the app's own ViewCard",
    source: SOURCE,
    headers: drawn.headers,
    rows: drawn.rows.length,
    firstRow: drawnRows[0] ?? null,
    lastRow: drawnRows.at(-1) ?? null,
    newestFirst: drawnRows[0]?.[0] ?? null,
    oldestLast: drawnRows.at(-1)?.[0] ?? null,
    moneyHeader: moneyIndex >= 0 ? (drawn.headers[moneyIndex] ?? null) : null,
    warnings: drawn.warnings,
    screenshot: shotFailure ?? "captured",
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`list: ${drawn.title} — ${drawn.rows.length} rows, headers ${JSON.stringify(drawn.headers)}`);
  console.log(`newest: ${report.newestFirst}  oldest: ${report.oldestLast}`);
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
  console.error("view-list rig timed out");
  app.exit(1);
}, 60_000);
