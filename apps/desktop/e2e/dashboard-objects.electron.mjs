/**
 * Drives the object-shaped ViewCard in a real Electron window and turns what it
 * renders into `e2e/artifacts/dashboard-objects-ui.{json,png}`.
 *
 * What this rig claims, and the fixture that makes each claim falsifiable:
 *
 *  1. One card draws five objects: a series table, a derived metric, a line
 *     chart with a palette/legend/axis captions/value labels, a metric from a
 *     second database, and a raw listing.
 *  2. The series table prints one column per series plus the row total, and its
 *     numbers are the engine's.
 *  3. The line chart draws one polyline per series in distinct palette colours,
 *     with a legend, y-axis ticks, grid lines, axis captions and value labels.
 *  4. Pressing Table -> Bar -> Line -> Table changes the DRAWING and nothing
 *     else. The saved spec recorded by the harness keeps groupBy, timeBucket,
 *     measure and seriesBy, and the table on the way back has the same rows and
 *     headers it had at the start. This is the operator's reported bug.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/dashboard-objects.electron.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/dashboard-objects.html";

const failures = [];
const checks = {};
const failure = (message) => {
  failures.push(message);
  console.error(`FAIL: ${message}`);
};

const SAMPLE = `(() => {
  const card = document.querySelector(".view-card");
  const blocks = Array.from(document.querySelectorAll(".view-card__block"));
  const blockByTitle = (title) => blocks.find((b) => {
    const t = b.querySelector(".view-card__block-title");
    return t && t.textContent.trim() === title;
  }) || null;
  const months = blockByTitle("Month by month");
  const trend = blockByTitle("By category");
  const average = blockByTitle("Average month");
  const accounts = blockByTitle("Accounts");
  const rowsBlock = blockByTitle("The rows themselves");
  const tableData = (block) => {
    if (!block) return null;
    const table = block.querySelector(".view-card__table");
    if (!table) return null;
    return {
      headers: Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim()),
      rows: Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
      ),
    };
  };
  const legend = (block) => {
    if (!block) return null;
    const items = Array.from(block.querySelectorAll(".view-card__legend-item"));
    return {
      items: items.map((li) => li.textContent.trim()),
      swatches: items.map((li) => {
        const sw = li.querySelector(".view-card__legend-swatch");
        return sw ? getComputedStyle(sw).backgroundColor : null;
      }),
    };
  };
  const captions = (el) => el ? Array.from(el.querySelectorAll(".view-card__axis-caption")).map((t) => t.textContent.trim()) : [];
  return {
    title: card ? card.querySelector(".view-card__title")?.textContent ?? null : null,
    // No drawing tabs are ever visible on the card: they exist only inside an
    // object's menu, which this counts while every menu is closed.
    visibleDrawings: document.querySelectorAll("[data-testid='view-block-tool']").length,
    blockCount: blocks.length,
    blockTitles: blocks.map((b) => b.querySelector(".view-card__block-title")?.textContent?.trim() ?? null),
    monthsTable: tableData(months),
    monthsBars: months ? months.querySelectorAll(".view-card__bar").length : 0,
    monthsLines: months ? months.querySelectorAll(".view-card__polyline, .view-card__line").length : 0,
    monthsMenus: months ? months.querySelectorAll("[data-testid='view-block-display-menu']").length : 0,
    trend: trend ? {
      lines: trend.querySelectorAll("polyline").length,
      dots: trend.querySelectorAll(".view-card__dot").length,
      legend: legend(trend),
      captions: captions(trend),
      valueLabels: trend.querySelectorAll(".view-card__value-label").length,
      yTicks: Array.from(trend.querySelectorAll(".view-card__axis-label")).map((t) => t.textContent.trim()),
      grid: trend.querySelectorAll(".view-card__grid").length,
    } : null,
    average: average ? average.querySelector(".view-card__metric")?.textContent?.trim() ?? null : null,
    accounts: accounts ? accounts.querySelector(".view-card__metric")?.textContent?.trim() ?? null : null,
    rows: tableData(rowsBlock),
    rowsHeaders: rowsBlock ? Array.from(rowsBlock.querySelectorAll("th")).map((th) => th.textContent.trim()) : [],
    saves: (window.viewSaveLog ?? []).slice(),
  };
})()`;

async function applyAppTheme(win) {
  await win.loadURL(`${url}?v=theme-seed`);
  await win.webContents.executeJavaScript(`(() => {
    localStorage.setItem("lifequest-skin", "forge-os");
    localStorage.setItem("lifequest-theme", "dark");
    return true;
  })()`);
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
      if (value) return resolve(value);
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(poll, 50);
    };
    void poll();
  });
}

async function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

/** The object's block element, by its visible title. */
function blockByTitleScript(title) {
  return `Array.from(document.querySelectorAll(".view-card__block")).find((b) => (b.querySelector(".view-card__block-title")?.textContent ?? "").trim() === ${JSON.stringify(title)})`;
}

/**
 * Pick a drawing from one object's display menu.
 *
 * The switch is a popover behind one small control now, so this opens the
 * object's menu and clicks the item the way the operator would. The menu closes
 * itself on the pick and the card redraws.
 */
async function pick(win, title, presentation) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const block = ${blockByTitleScript(title)};
    const trigger = block ? block.querySelector("[data-testid='view-block-display-menu']") : null;
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  if (!opened) throw new Error(`${title} has no display menu`);
  await waitFor(
    win,
    `Boolean(${blockByTitleScript(title)}?.querySelector("[data-testid='view-block-tool']"))`,
    `${title}'s display menu`,
  );
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const block = ${blockByTitleScript(title)};
    const btn = Array.from(block.querySelectorAll("[data-testid='view-block-tool']")).find((b) => b.getAttribute("data-presentation") === ${JSON.stringify(presentation)});
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`no usable ${presentation} switch on ${title}`);
}

/** Open one object's menu, read its items, and close it again. */
async function menuItems(win, title) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const block = ${blockByTitleScript(title)};
    const trigger = block ? block.querySelector("[data-testid='view-block-display-menu']") : null;
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  if (!opened) return null;
  await waitFor(
    win,
    `Boolean(${blockByTitleScript(title)}?.querySelector("[data-testid='view-block-tool']"))`,
    `${title}'s display menu`,
  );
  const items = await win.webContents.executeJavaScript(`(() =>
    Array.from(${blockByTitleScript(title)}.querySelectorAll("[data-testid='view-block-tool']")).map((b) => b.getAttribute("data-presentation"))
  )()`);
  await win.webContents.executeJavaScript(`(() => {
    const block = ${blockByTitleScript(title)};
    block.querySelector("[data-testid='view-block-display-menu']")?.click();
    return true;
  })()`);
  return items;
}

async function main() {
  nativeTheme.themeSource = "dark";
  const partition = `dashboard-objects-${Date.now()}`;
  const win = new BrowserWindow({
    width: 1280,
    height: 1500,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(1280, 1500);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  try {
    await applyAppTheme(win);
    await win.loadURL(`${url}?v=${Date.now()}`);
    await waitFor(win, "Boolean(window.viewCardReady)", "viewCardReady");
    await waitFor(win, "(window.viewCardCommits ?? 0) > 0", "a committed card");
    await waitFor(win, "Boolean(document.querySelector('.view-card__table'))", "the card to draw a table");

    checks.skin = await win.webContents.executeJavaScript(
      "({ name: window.viewCardSkin, applied: document.documentElement.dataset.skin ?? null })",
    );
    if (!checks.skin.name || checks.skin.applied !== checks.skin.name) {
      failure(`the harness did not paint in the app's skin: ${JSON.stringify(checks.skin)}`);
    }

    // ── 1. five objects, each drawn as itself ──────────────────────────────
    const initial = await sample(win);
    checks.initial = initial;
    if (initial.blockCount !== 5) failure(`the card drew ${initial.blockCount} objects, expected 5`);
    if (initial.title !== "Spending, object by object") {
      failure(`the card title read ${JSON.stringify(initial.title)}`);
    }

    // ── 2. the series table ────────────────────────────────────────────────
    if (!initial.monthsTable) {
      failure("the months object did not draw a table");
    } else {
      const headers = initial.monthsTable.headers;
      const expected = ["Month", "Food", "Travel", "Rent", "Total (ZAR)"];
      if (JSON.stringify(headers) !== JSON.stringify(expected)) {
        failure(`series table headers read ${JSON.stringify(headers)}, expected ${JSON.stringify(expected)}`);
      }
      if (initial.monthsTable.rows.length !== 4) {
        failure(`the series table drew ${initial.monthsTable.rows.length} rows, expected 4`);
      }
      const june = initial.monthsTable.rows[0];
      if (!june || june[0] !== "2026-06" || june[1] !== "100" || june[2] !== "100" || june[3] !== "—" || june[4] !== "200") {
        failure(`the June series row read ${JSON.stringify(june)}`);
      }
    }

    // ── 3. the trend chart's chrome ────────────────────────────────────────
    if (!initial.trend) {
      failure("the category object did not draw a chart");
    } else {
      if (initial.trend.lines !== 3) failure(`the line chart drew ${initial.trend.lines} series, expected 3`);
      if (initial.trend.legend?.items.length !== 3) {
        failure(`the legend listed ${JSON.stringify(initial.trend.legend?.items)}, expected three series`);
      }
      const distinct = new Set((initial.trend.legend?.swatches ?? []).filter(Boolean));
      if (distinct.size < 3) {
        failure(`the series share colours: ${JSON.stringify([...(initial.trend.legend?.swatches ?? [])])}`);
      }
      if (!initial.trend.captions.includes("Month") || !initial.trend.captions.includes("Spend")) {
        failure(`the axis captions read ${JSON.stringify(initial.trend.captions)}`);
      }
      if (initial.trend.valueLabels === 0) failure("valueLabels was set but no value was printed");
      if (initial.trend.yTicks.length < 3) failure(`the y-axis drew ${initial.trend.yTicks.length} ticks`);
      if (initial.trend.grid < 3) failure(`the chart drew ${initial.trend.grid} grid lines`);
    }

    if (!/225/.test(initial.average ?? "")) failure(`the derived metric read ${JSON.stringify(initial.average)}`);
    if (!/average/.test(initial.average ?? "")) failure("the derived metric does not say it is an average");
    if (!/2/.test(initial.accounts ?? "")) failure(`the second-database metric read ${JSON.stringify(initial.accounts)}`);
    if (!initial.rows || initial.rows.rows.length !== 4) {
      failure(`the row object drew ${JSON.stringify(initial.rows?.rows?.length)} rows`);
    }
    if (!initial.rowsHeaders.includes("Amount (ZAR)")) {
      failure(`the row object's money header read ${JSON.stringify(initial.rowsHeaders)}`);
    }

    // ── 4. Table -> Bar -> Line -> Table keeps the data ────────────────────
    await pick(win, "Month by month", "bar");
    await waitFor(win, `(() => {
      const b = Array.from(document.querySelectorAll(".view-card__block")).find((x) => (x.querySelector(".view-card__block-title")?.textContent ?? "").trim() === "Month by month");
      return !!b && b.querySelectorAll(".view-card__bar").length === 12;
    })()`, "the months object to draw 12 bars");
    const bar = await sample(win);
    checks.bar = bar;
    if (bar.monthsTable !== null) failure("the bar drawing still drew a table");
    const barSave = bar.saves.at(-1);
    if (!barSave) failure("the bar switch made no write");

    await pick(win, "Month by month", "line");
    await waitFor(win, `(() => {
      const b = Array.from(document.querySelectorAll(".view-card__block")).find((x) => (x.querySelector(".view-card__block-title")?.textContent ?? "").trim() === "Month by month");
      return !!b && b.querySelectorAll("polyline").length === 3;
    })()`, "the months object to draw 3 lines");
    const line = await sample(win);
    checks.line = line;

    await pick(win, "Month by month", "table");
    await waitFor(win, `(() => {
      const b = Array.from(document.querySelectorAll(".view-card__block")).find((x) => (x.querySelector(".view-card__block-title")?.textContent ?? "").trim() === "Month by month");
      return !!b && b.querySelectorAll(".view-card__table tbody tr").length === 4;
    })()`, "the months object to draw the table again");
    const table = await sample(win);
    checks.table = table;

    if (JSON.stringify(table.monthsTable) !== JSON.stringify(initial.monthsTable)) {
      failure("the table changed its rows or headers after the drawings were cycled");
    }
    const saves = table.saves;
    checks.saves = saves;
    if (saves.length !== 3) failure(`three switches made ${saves.length} writes, expected 3`);
    for (const save of saves) {
      const months = save.blocks.find((b) => b.id === "months");
      if (!months) {
        failure("a switch saved no months object");
        continue;
      }
      if (months.groupBy !== "date" || months.timeBucket !== "month") {
        failure(`a switch rewrote the query: ${JSON.stringify({ groupBy: months.groupBy, timeBucket: months.timeBucket })}`);
      }
      if (months.measure !== "sum" || months.seriesBy !== "category") {
        failure(`a switch lost the measure or the series split: ${JSON.stringify({ measure: months.measure, seriesBy: months.seriesBy })}`);
      }
      if (months.display?.palette !== "warm") {
        failure(`a switch lost the object's display: ${JSON.stringify(months.display)}`);
      }
    }
    if (saves.length === 3) {
      const presentations = saves.map((s) => s.blocks.find((b) => b.id === "months")?.presentation);
      if (JSON.stringify(presentations) !== JSON.stringify(["bar", "line", "table"])) {
        failure(`the switches saved ${JSON.stringify(presentations)}`);
      }
    }

    // A drawing the object cannot hold is not offered: the raw listing has no
    // chart switch, because a chart of rows is an aggregate it does not have.
    const rowsTools = await menuItems(win, "The rows themselves");
    checks.rowsTools = rowsTools;
    if (JSON.stringify(rowsTools) !== JSON.stringify(["list", "table"])) {
      failure(`the raw listing offered ${JSON.stringify(rowsTools)}, expected list and table`);
    }

    if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

    // The artifact shows the hidden switch OPEN on the raw listing, because that
    // is the interaction this revision changed. Scroll to the top first: the
    // card is taller than the fold, and the earlier clicks left the window
    // scrolled to the menu that was open.
    await win.webContents.executeJavaScript(`(() => {
      const block = ${blockByTitleScript("The rows themselves")};
      block?.querySelector("[data-testid='view-block-display-menu']")?.click();
      window.scrollTo(0, 0);
      return true;
    })()`);
    await waitFor(
      win,
      `Boolean(${blockByTitleScript("The rows themselves")}?.querySelector("[data-testid='view-block-tool']"))`,
      "the display menu in the screenshot",
    );
    await win.webContents.executeJavaScript("window.scrollTo(0, 0); true");
    await new Promise((resolve) => setTimeout(resolve, 120));

    const image = await win.webContents.capturePage();
    fs.mkdirSync(artifactsDir, { recursive: true });
    const png = path.join(artifactsDir, "dashboard-objects-ui.png");
    fs.writeFileSync(png, image.toPNG());

    const report = {
      pass: failures.length === 0,
      failures,
      command: "node e2e/dashboard-objects.electron.mjs (with the dev server up)",
      checks,
      screenshot: "e2e/artifacts/dashboard-objects-ui.png",
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(artifactsDir, "dashboard-objects-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`dashboard-objects-ui: ${report.pass ? "PASS" : "FAIL"} (${failures.length} failures)`);
    app.exit(report.pass ? 0 : 1);
  } catch (error) {
    failure(error instanceof Error ? error.message : String(error));
    const report = { pass: false, failures, checks, generatedAt: new Date().toISOString() };
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, "dashboard-objects-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
    app.exit(1);
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});
