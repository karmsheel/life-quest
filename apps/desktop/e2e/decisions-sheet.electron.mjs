/**
 * Drives the decisions sheet in a real Electron window and turns the
 * measurements into `e2e/artifacts/decisions-sheet.{json,png}`.
 *
 * Dev server up, then:
 *
 *   node_modules/.bin/electron e2e/decisions-sheet.electron.mjs
 *
 * Exit code 0 = every step ran. The JSON report is the repeatable artifact: the
 * test file (`tests/decisions-sheet-e2e.test.ts`) holds the assertions, this file
 * holds the interactions and the measurements, so a failure names a state rather
 * than a line of driver code.
 *
 * What is measured that a screenshot cannot show: the panel's share of the
 * window, the scrim's computed `backdrop-filter`, the background page's mount
 * count, the workspace's scroll position and marker offset before and after the
 * sheet, and the approve call the card actually made.
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
  process.env.LIFEQUEST_E2E_URL ??
  "http://127.0.0.1:5173/e2e/decisions-sheet.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

/** Where the operator's workspace is parked before the sheet opens. */
const WORKSPACE_TOP = 340;

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

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const sample = async () => {
    const value = await run("window.decisionsSheetScreen()");
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settle = async (ms = 260) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await run(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
    );
    return sample();
  };

  const screenshots = [];
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, `decisions-sheet-${name}.png`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    screenshots.push(path.basename(file));
    return path.basename(file);
  };

  const waitReady = () =>
    run("window.decisionsSheetReady.then(() => true)");

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const scrollTo = (top) =>
    run(`window.decisionsSheetScrollTo(${JSON.stringify(top)})`);

  /** Press the named action on one card, exactly as the operator does. */
  const clickCardAction = (id, label) =>
    run(`(() => {
      const card = document.querySelector(
        '[data-decision-id="' + CSS.escape(${JSON.stringify(id)}) + '"]'
      );
      const button = Array.from(card ? card.querySelectorAll("button") : []).find(
        (candidate) => (candidate.textContent || "").trim() === ${JSON.stringify(label)}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);

  /** Press the panel's own surface: it must not reach the scrim's handler. */
  const pressInsidePanel = () =>
    run(`(() => {
      const el = document.querySelector(".sheet-overlay__panel--decisions");
      if (!el) return { hit: null };
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      el.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
      return { hit: String(el.className || el.tagName) };
    })()`);

  /** A real press at a window point: what is under it, and a mousedown on it. */
  const pressAt = (x, y) =>
    run(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return { hit: null };
      const hit = el.hasAttribute("data-sheet-overlay")
        ? "scrim"
        : (el.className || el.tagName);
      el.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: ${x},
          clientY: ${y},
        })
      );
      return { hit: String(hit) };
    })()`);

  /**
   * Escape, from the body: a real key event starts at the focused element and
   * bubbles up through `document` to `window`, where the sheet listens.
   */
  const pressEscape = () =>
    run(`(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
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
    fixture: {
      workspaceTop: WORKSPACE_TOP,
    },
    states,
    steps,
    screenshots,
    failures,
    pass: false,
  };

  try {
    await win.loadURL(url);
    await waitReady();
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 1 — the page the sheet will be drawn over. Nothing is open yet.
    record("landing", await settle());

    // 2 — the operator is reading, not at the top of the page.
    step("scroll", await scrollTo(WORKSPACE_TOP));
    record("parked", await settle());

    // 3 — open it from the app's own control, not from a URL.
    step("openedClick", await click("[data-open-decisions]"));
    const opened = record("opened", await settle());
    await shot("opened");

    // 4 — a press on the panel is not a dismissal.
    const insidePress = await pressInsidePanel();
    record("insidePress", await settle());
    step("insidePressHit", insidePress.hit);

    // 5 — approve the newest proposal from inside the sheet.
    const firstId = opened.cards[0]?.id;
    step("approveId", firstId ?? null);
    step("approveClick", firstId ? await clickCardAction(firstId, "Approve") : false);
    record("approved", await settle());
    await shot("approved");

    // 6 — the cross hands the page back.
    step("crossClick", await click(".decisions-overlay__close"));
    record("closedByCross", await settle());
    await shot("closed");

    // 7 — Escape does the same, from a reopened sheet.
    await click("[data-open-decisions]");
    await settle();
    step("escapePress", await pressEscape());
    record("closedByEscape", await settle());

    // 8 — so does a press on the scrim.
    await click("[data-open-decisions]");
    await settle();
    const outsidePress = await pressAt(6, 6);
    record("closedByScrimPress", await settle());
    step("closedByScrimHit", outsidePress.hit);

    report.pass = true;
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }

  report.pass = report.pass && failures.length === 0;

  const reportFile = path.join(artifactsDir, "decisions-sheet.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const table = [["state", "path", "sheet", "cards", "workspaceTop", "mounts"]];
  for (const [name, state] of Object.entries(states)) {
    table.push([
      name,
      state?.path ?? "—",
      state?.overlay ? "open" : "closed",
      String(state?.cards?.length ?? "—"),
      String(state?.workspace?.top ?? "—"),
      String(state?.workspace?.mounts ?? "—"),
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
  console.log(report.pass ? "decisions sheet: PASS" : "decisions sheet: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`decisions-sheet: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
