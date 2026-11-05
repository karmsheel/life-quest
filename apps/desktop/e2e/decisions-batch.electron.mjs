/**
 * Drives the batch-approve behaviour in a real Electron window and turns the
 * measurements into `e2e/artifacts/decisions-batch.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/decisions-batch.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/decisions-batch-e2e.test.ts`) holds the assertions, this
 * file holds the interactions and the measurements.
 *
 * The stub in `decisions-batch.tsx` holds every resolve open until this driver
 * releases it, so "in flight" is a fact rather than a race: the report records
 * how many answers the page dispatched at once, which cards showed their own
 * "…", and the list's top before and after the notices appear.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/decisions-batch.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const states = {};
const steps = {};
const failures = [];

async function main() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run("window.decisionsBatchScreen()");
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 240) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await run(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
    );
    return sample();
  };

  /** Wait until an expression in the page is true, without sleeping on a guess. */
  const waitFor = (expression, label, timeout = 10_000) =>
    run(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        let value = false;
        try {
          value = Boolean(${expression});
        } catch (error) {
          reject(error);
          return;
        }
        if (value) {
          resolve(true);
          return;
        }
        if (Date.now() - started > ${timeout}) {
          reject(new Error("timed out waiting for: " + ${JSON.stringify(label)}));
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    })`);

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `decisions-batch-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  /** Press the named action on one card, exactly as the operator does. */
  const clickCardAction = (id, label) =>
    run(`(() => {
      const card = document.querySelector(
        '[data-decision-id="' + CSS.escape(${JSON.stringify(id)}) + '"]'
      );
      if (!card) return false;
      const button = Array.from(card.querySelectorAll("button")).find(
        (candidate) => (candidate.textContent || "").trim() === ${JSON.stringify(label)}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);

  const record = (name, value) => {
    states[name] = value;
    return value;
  };
  const step = (name, value) => {
    steps[name] = value;
    return value;
  };

  const report = {
    url,
    ranAt: new Date().toISOString(),
    window: { ...DEFAULT_SIZE },
    states,
    steps,
    screenshots,
    consoleErrors,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await run(
      "new Promise((resolve) => { const tick = () => window.decisionsBatchReady ? resolve(true) : requestAnimationFrame(tick); tick(); })",
    );
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 1 — the inbox at rest: the bar, the switcher and the approve-all control.
    const rest = record("rest", await settle());
    await shot("rest");
    const ids = rest.cards.map((card) => card.id);
    if (ids.length !== 4) throw new Error(`expected 4 seeded decisions, saw ${ids.length}`);

    // 2 — a refusal. The card stays pending and the error joins the bar; the
    //     list's top must not move because of it.
    const failId = ids[ids.length - 1];
    step("failId", failId);
    await run(`window.decisionsBatchFailNext(${JSON.stringify(failId)})`);
    step("failClick", await clickCardAction(failId, "Approve"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 1",
      "the failing resolve to be dispatched",
    );
    await run("window.decisionsBatchReleaseOne()");
    await waitFor(
      "Boolean(document.querySelector('.decisions-inbox__notices .form-error'))",
      "the refusal to be shown in the bar",
    );
    record("failed", await settle());
    await shot("error");

    // 3 — two answers at once. The first is still held open when the second is
    //     clicked; BOTH cards must own a processing state.
    const [firstId, secondId] = ids;
    step("firstId", firstId ?? null);
    step("secondId", secondId ?? null);
    step("firstClick", await clickCardAction(firstId, "Approve"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 1",
      "the first resolve to be dispatched",
    );
    step("secondClick", await clickCardAction(secondId, "Approve"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 2",
      "both resolves to be in flight together",
    );
    record("twoInFlight", await settle());
    await shot("in-flight");

    // 4 — release only the first: it lands while the second is still held. The
    //     second must not have been cancelled by the first's completion.
    step("releaseOne", await run("window.decisionsBatchReleaseOne()"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 1 && window.decisionsBatchScreen().cards.length === 3",
      "the first of the two answers to land",
    );
    record("oneLeft", await settle());

    // 5 — release the second; both are approved and the message is in the bar.
    step("releaseSecond", await run("window.decisionsBatchReleaseAll()"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 0 && window.decisionsBatchScreen().cards.length === 2 && Boolean(document.querySelector('.decisions-inbox__notices .doc-editor__message'))",
      "the second of the two answers to land",
    );
    record("bothApproved", await settle());
    await shot("approved");

    // 6 — approve all. Two proposals are left; both answers must be dispatched
    //     before either is released, not one after the other.
    step("approveAllClick", await click('[data-testid="btn-decisions-approve-all"]'));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 2",
      "approve all to dispatch every pending answer",
    );
    record("approvingAll", await settle());
    await shot("approving-all");

    step("releaseAll", await run("window.decisionsBatchReleaseAll()"));
    await waitFor(
      "window.decisionsBatchScreen().inflight === 0 && window.decisionsBatchScreen().cards.length === 0",
      "approve all to finish",
    );
    record("allApproved", await settle());
    await shot("all-approved");

    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "decisions-batch.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["state", "cards", "inflight", "approveAll", "message"]];
  for (const [name, state] of Object.entries(states)) {
    table.push([
      name,
      String(state?.cards?.length ?? "—"),
      String(state?.inflight ?? "—"),
      state?.approveAll ? `${state.approveAll.text}${state.approveAll.disabled ? " (disabled)" : ""}` : "—",
      state?.notices?.message?.text ?? state?.notices?.error?.text ?? "—",
    ]);
  }
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => String(row[i]).length)),
  );
  for (const row of table) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
  }

  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "decisions batch: PASS" : "decisions batch: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`decisions-batch: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
