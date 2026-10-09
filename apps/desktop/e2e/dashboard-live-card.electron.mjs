/**
 * Renders the card that is ACTUALLY on the operator's dashboard, at 1:1 in the
 * real layout engine, and writes `e2e/artifacts/dashboard-live-summary.png`.
 *
 * The fixture is not hand-written: it is read back out of
 * `dashboard-live-summary.json`, which the acceptance run wrote after calling
 * the companion's own tools against the real vault. So the picture is the card
 * the vault produced, not a mock of it.
 *
 * Run after `scratch-live-dashboard.mts`, with the dev server up:
 *
 *   node e2e/dashboard-live-card.electron.mjs
 *
 * Exit code 0 = the card drew with the rows the vault returned.
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
const SOURCE = path.join(artifactsDir, "dashboard-live-summary.json");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/view-card.html";

const errors = [];
const failure = (m) => {
  errors.push(m);
  return m;
};

/** Wait out a settle, in the MAIN process, where nothing throttles a timer. */
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One screenshot, or null with the reason recorded.
 *
 * A capture of an OCCLUDED window fails outright — Chromium answers
 * `UnknownVizError` when another window covers this one, which is the normal
 * case when the operator's own app is in the foreground. That is not a defect in
 * the card, so it is reported and the run carries on: the JSON report is the
 * artifact that matters, and a picture that could not be taken must not turn a
 * correct card into a failed rig.
 */
let shotFailure = null;

/** Take the screenshot, or record why it could not be taken. */
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

/**
 * The saved view and its run, pulled out of the acceptance run's artifact. The
 * view is the file the app reads — blocks and all — not a reconstruction: a
 * fixture that lost `blocks` would draw a different card from the real one.
 *
 * A second fixture adds a bar panel over the same rows. The saved card does not
 * have one; it exists so the chart half of the design can be looked at against
 * real numbers, and the report labels it as added-for-design.
 */
function fixtureFrom(source) {
  const readCard = source.steps.find(
    (s) => s.step === "the card as the dashboard draws it",
  );
  const save = source.steps.find((s) => s.step === "save_view");
  const view = source.savedView;
  if (!readCard || !save || !view) return null;
  const run = readCard.value;

  const tableBlock = run.blocks.find((b) => b.presentation === "table");
  // The trend block is the table block's own fields with a different drawing, so
  // the chart is grouped and windowed exactly like the rows beside it.
  const trendBlock = tableBlock
    ? { ...tableBlock, id: "trend", title: "Trend", presentation: "bar", span: 2 }
    : null;
  const withChart = trendBlock
    ? {
        ...view,
        id: `${view.id}-chart`,
        title: `${view.title} (with chart)`,
        blocks: [...view.blocks, trendBlock],
      }
    : null;
  return {
    key: `financial::${save.value.viewId}`,
    view,
    run: { ok: true, value: run },
    chartFixture: withChart
      ? {
          key: `financial::${withChart.id}`,
          view: withChart,
          run: {
            ok: true,
            value: { ...run, blocks: [...run.blocks, trendBlock] },
          },
        }
      : null,
  };
}

async function main() {
  if (!fs.existsSync(SOURCE)) {    console.error(`no live summary artifact at ${SOURCE} — run scratch-live-dashboard.mts first`);
    app.exit(1);
    return;
  }
  const fixture = fixtureFrom(JSON.parse(fs.readFileSync(SOURCE, "utf8")));
  if (!fixture) {
    console.error("the live summary artifact carries no saved card to draw");
    app.exit(1);
    return;
  }

  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: 900,
    height: 560,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: `live-card-${Date.now()}`, backgroundThrottling: false },
  });
  win.setContentSize(900, 560);
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
  await waitFor(win, `(window.viewCardCommits ?? 0) > ${before}`, "the live card to commit");
  await waitFor(win, `document.querySelectorAll(".view-card__table tbody tr").length > 0`, "table rows");
  // A settle by TIMER, not by animation frame. This rig's window is shown
  // inactively so it never steals the operator's focus, and Chromium throttles
  // `requestAnimationFrame` for a window it considers hidden or occluded — which
  // is exactly what happened when the app itself was in the foreground: the
  // promise never resolved and the rig timed out with nothing to report. A
  // timeout is not throttled, and two painted frames are not what this claim
  // needs: the rows are already in the DOM.
  await settle(120);

  const drawn = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(".view-card");
    const blocks = Array.from(document.querySelectorAll(".view-card__block"));
    return {
      title: card ? card.querySelector(".view-card__title").textContent : null,
      metric: card && card.querySelector(".view-card__metric") ? card.querySelector(".view-card__metric").textContent : null,
      headers: Array.from(document.querySelectorAll(".view-card__table thead th")).map((th) => th.textContent.trim()),
      tableAlign: (() => {
        const cell = document.querySelector(".view-card__table tbody td + td");
        return cell ? getComputedStyle(cell).textAlign : null;
      })(),
      shell: (() => {
        const cs = getComputedStyle(card);
        return { background: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, padding: cs.paddingTop };
      })(),
      blocks: blocks.map((b) => ({
        title: b.querySelector(".view-card__block-title") ? b.querySelector(".view-card__block-title").textContent : null,
        rows: Array.from(b.querySelectorAll(".view-card__table tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
        ),
        metric: b.querySelector(".view-card__metric") ? b.querySelector(".view-card__metric").textContent : null,
        bars: b.querySelectorAll(".view-card__bar").length,
        ticks: Array.from(b.querySelectorAll(".view-card__tick")).map((t) => (t.textContent || "").trim()),
      })),
    };
  })()`);

  const expectedRows = fixture.run.value.blocks.find((b) => b.presentation === "table").result.rows;
  const drawnRows = drawn.blocks.find((b) => b.rows.length > 0)?.rows ?? [];
  if (drawn.title !== fixture.view.title) failure(`the card titled ${JSON.stringify(drawn.title)}`);
  if (drawnRows.length !== expectedRows.length) {
    failure(`the card drew ${drawnRows.length} rows, the vault returned ${expectedRows.length}`);
  }
  // Design invariants: a card shell, an honest label header, right-aligned money.
  // The header comes from the card's OWN query — a week bucket labels the column
  // "Week", a month bucket "Month" — so the claim is that the drawn header names
  // the bucket the saved spec asked for, not one hard-coded word. This rig
  // renders whatever card the artifact holds, and the artifact holds whichever
  // card the companion last placed.
  const tableBlock = fixture.view.blocks.find((b) => b.presentation === "table");
  const bucket = tableBlock?.timeBucket ?? null;
  const expectedHeader =
    bucket === "day" ? "Day" : bucket === "week" ? "Week" : bucket === "month" ? "Month" : null;
  if (expectedHeader !== null && drawn.headers[0] !== expectedHeader) {
    failure(
      `the table's label column read ${JSON.stringify(drawn.headers[0])}, expected ${JSON.stringify(expectedHeader)} for a ${bucket} bucket`,
    );
  }
  if (drawn.tableAlign !== "right") {
    failure(`the value column is ${JSON.stringify(drawn.tableAlign)}-aligned, expected right`);
  }
  if (!drawn.shell.background || drawn.shell.background === "rgba(0, 0, 0, 0)") {
    failure(`the card drew no shell background: ${JSON.stringify(drawn.shell)}`);
  }
  if (drawn.shell.border === "0px") {
    failure("the card drew no shell border");
  }

  // The same rows as a chart, for the half of the design the saved card does not
  // use. Nothing here is asserted about the vault; it is a look at the drawing.
  let chartDrawn = null;
  if (fixture.chartFixture) {
    const beforeChart = await win.webContents.executeJavaScript("window.viewCardCommits ?? 0");
    await win.webContents.executeJavaScript(
      `window.installFixture(${JSON.stringify(fixture.chartFixture.key)}, ${JSON.stringify({ view: fixture.chartFixture.view, run: fixture.chartFixture.run })})`,
    );
    await win.webContents.executeJavaScript(
      `window.renderViewCard("financial", ${JSON.stringify(fixture.chartFixture.view.id)})`,
    );
    await waitFor(win, `(window.viewCardCommits ?? 0) > ${beforeChart}`, "the chart card to commit");
    await waitFor(win, `document.querySelectorAll(".view-card__bar").length > 0`, "chart bars");
    await settle(120);
    chartDrawn = await win.webContents.executeJavaScript(`(() => {
      const svg = document.querySelector(".view-card__chart");
      return {
        bars: document.querySelectorAll(".view-card__bar").length,
        baseline: Boolean(document.querySelector(".view-card__axis")),
        ticks: Array.from(document.querySelectorAll(".view-card__tick")).map((t) => (t.textContent || "").trim()),
        width: svg ? Math.round(svg.getBoundingClientRect().width) : null,
        height: svg ? Math.round(svg.getBoundingClientRect().height) : null,
        fill: document.querySelector(".view-card__bar") ? getComputedStyle(document.querySelector(".view-card__bar")).fill : null,
      };
    })()`);
    if (chartDrawn.bars !== expectedRows.length) {
      failure(`the chart drew ${chartDrawn.bars} bars for ${expectedRows.length} rows`);
    }
    if (!chartDrawn.baseline) failure("the chart drew no baseline");
    if (!chartDrawn.fill || chartDrawn.fill === "none") failure("the chart's bars carry no fill");
    const image = await shot(win);
    if (image) fs.writeFileSync(path.join(artifactsDir, "dashboard-live-chart.png"), image);

    // Back to the card the operator actually has, and capture that.
    await win.webContents.executeJavaScript(
      `window.renderViewCard("financial", ${JSON.stringify(fixture.view.id)})`,
    );
    await waitFor(win, `document.querySelectorAll(".view-card__table tbody tr").length > 0`, "the saved card again");
    await settle(120);
  }

  const image = await shot(win);
  if (image) fs.writeFileSync(path.join(artifactsDir, "dashboard-live-summary.png"), image);

  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the card the operator's real dashboard shows, drawn by ViewCard",
    source: SOURCE,
    drawn,
    vaultRows: expectedRows,
    chartDrawn,
    chartNote: "the chart panel is the saved card's own rows drawn as bars; the pinned card itself is metric + table",
    screenshot: shotFailure ?? "captured",
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(artifactsDir, "dashboard-live-card.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`card: ${drawn.title}, ${drawnBlocksText(drawn)}`);
  console.log(`shell: ${JSON.stringify(drawn.shell)} headers ${JSON.stringify(drawn.headers)} align ${drawn.tableAlign}`);
  if (chartDrawn) console.log(`chart: ${chartDrawn.bars} bars, ${chartDrawn.width}x${chartDrawn.height}, fill ${chartDrawn.fill}`);
  console.log(`failures: ${errors.length === 0 ? "none" : errors.join("; ")}`);
  win.destroy();
  app.exit(errors.length === 0 ? 0 : 1);
}

function drawnBlocksText(drawn) {
  return drawn.blocks
    .map((b) => `${b.title}${b.metric ? ` (${b.metric})` : ""}${b.rows.length ? ` [${b.rows.length} rows]` : ""}`)
    .join(", ");
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

setTimeout(() => {
  console.error("dashboard-live-card rig timed out");
  app.exit(1);
}, 60_000);
