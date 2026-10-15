/**
 * Draws `FxRatePanel` in the real layout engine and drives its three controls,
 * writing `e2e/artifacts/fx-panel.json` and `fx-panel.png`.
 *
 * The panel is what the operator uses to point the vault at another rate source,
 * so the claims are about the FORM: that it loads what the vault holds, that
 * "Save and read now" sends the fields that were typed and then shows what the
 * source answered, that a source which cannot be read is reported as an error
 * rather than as a rate, and that a value the vault refuses is shown to the
 * operator instead of being swallowed.
 *
 * Run with the dev server up:
 *
 *   node e2e/fx-panel.electron.mjs
 *
 * Exit code 0 = every claim held.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "fx-panel.json");
const url = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/fx-panel.html";

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

/** Everything the panel draws, as one read of the DOM. */
const SAMPLE = `(() => {
  const panel = document.querySelector('[data-testid="fx-settings"]');
  const text = (sel) => {
    const el = panel && panel.querySelector(sel);
    return el ? el.textContent.trim() : null;
  };
  const value = (sel) => {
    const el = panel && panel.querySelector(sel);
    return el ? el.value : null;
  };
  return {
    present: Boolean(panel),
    heading: panel ? (panel.querySelector("h2") || {}).textContent ?? null : null,
    url: value('[data-testid="fx-url"]'),
    path: value('[data-testid="fx-path"]'),
    asOfPath: value('[data-testid="fx-asof-path"]'),
    rate: text('[data-testid="fx-rate"]'),
    lastRead: text('[data-testid="fx-last-read"]'),
    lastError: text('[data-testid="fx-last-error"]'),
    status: text('[data-testid="fx-status"]'),
    error: text('[data-testid="fx-error"]'),
    controls: panel
      ? Array.from(panel.querySelectorAll("button")).map((b) => b.textContent.trim())
      : [],
    labels: panel
      ? Array.from(panel.querySelectorAll(".data-field__label")).map((l) => l.textContent.trim())
      : [],
    shell: panel
      ? (() => {
          const cs = getComputedStyle(panel);
          return { background: cs.backgroundColor, border: cs.borderTopWidth };
        })()
      : null,
  };
})()`;

async function click(win, testId) {
  return win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="${testId}"]').click(); true`,
  );
}

async function main() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: 720,
    height: 720,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `fx-panel-${Date.now()}`,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(720, 720);
  win.showInactive();

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });

  await win.loadURL(`${url}?v=${Date.now()}`);
  await waitFor(win, "Boolean(window.fxPanelReady)", "fxPanelReady");
  await waitFor(win, `document.querySelector('[data-testid="fx-settings"]') !== null`, "the panel");
  await settle(150);

  const checks = {};

  // ── 1. it loads what the vault holds ────────────────────────────────────
  checks.initial = await win.webContents.executeJavaScript(SAMPLE);
  if (!checks.initial.present) failure("the panel did not render");
  // The default source reaches the form rather than three empty boxes: a vault
  // nobody has pointed anywhere still reads a rate, and blank fields would say
  // the opposite.
  if (checks.initial.url !== "https://open.er-api.com/v6/latest/USD") {
    failure(`the source URL loaded as ${JSON.stringify(checks.initial.url)}`);
  }
  if (checks.initial.path !== "rates.ZAR") {
    failure(`the rate path loaded as ${JSON.stringify(checks.initial.path)}`);
  }
  if (checks.initial.rate !== "not read yet") {
    failure(`a vault with no rate said ${JSON.stringify(checks.initial.rate)}`);
  }
  if (checks.initial.controls.length !== 3) {
    failure(`the panel drew ${checks.initial.controls.length} controls, expected 3`);
  }
  if (!checks.initial.shell || checks.initial.shell.border === "0px") {
    failure("the panel drew no card border");
  }

  // ── 2. reading a source that works ──────────────────────────────────────
  await win.webContents.executeJavaScript(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set('[data-testid="fx-url"]', "https://example.test/rates.json");
    set('[data-testid="fx-path"]', "data.0.rate");
    set('[data-testid="fx-asof-path"]', "");
    return true;
  })()`);
  await click(win, "fx-save");
  await waitFor(win, `(window.fxPanelCalls || []).includes("fxRefresh")`, "the read after saving");
  await settle(150);
  checks.afterSave = await win.webContents.executeJavaScript(SAMPLE);
  checks.sent = await win.webContents.executeJavaScript("window.fxPanelSent");

  // What was TYPED is what was sent — including the empty date path, which means
  // "this source does not date itself" and must not arrive as an empty string.
  const sent = (checks.sent ?? [])[0] ?? {};
  if (sent.url !== "https://example.test/rates.json") {
    failure(`the panel sent url ${JSON.stringify(sent.url)}`);
  }
  if (sent.path !== "data.0.rate") failure(`the panel sent path ${JSON.stringify(sent.path)}`);
  if (sent.asOfPath !== null) {
    failure(`an emptied date path was sent as ${JSON.stringify(sent.asOfPath)}, expected null`);
  }
  // And what came back is what is shown.
  if (!/16\.49/.test(checks.afterSave.rate ?? "")) {
    failure(`the rate the source answered was not shown: ${JSON.stringify(checks.afterSave.rate)}`);
  }
  if (!/2026-10-14/.test(checks.afterSave.rate ?? "")) {
    failure(`the as-of date was not shown: ${JSON.stringify(checks.afterSave.rate)}`);
  }
  if (!/Read 16\.49 ZAR per USD as of 2026-10-14/.test(checks.afterSave.status ?? "")) {
    failure(`the panel did not say what it read: ${JSON.stringify(checks.afterSave.status)}`);
  }
  if (checks.afterSave.lastError !== "none") {
    failure(`a successful read left an error on screen: ${JSON.stringify(checks.afterSave.lastError)}`);
  }
  if (checks.afterSave.error !== null) {
    failure(`a successful save showed an error: ${JSON.stringify(checks.afterSave.error)}`);
  }

  const image = await shot(win);
  if (image) fs.writeFileSync(path.join(artifactsDir, "fx-panel.png"), image);

  // ── 3. a source that cannot be read is an error, not a rate ─────────────
  await win.webContents.executeJavaScript(
    `window.fxPanelState.refresh = { refreshed: false, rate: null, asOf: null, error: "https://example.test/x answered HTTP 500" }; true`,
  );
  await click(win, "fx-refresh");
  await settle(200);
  checks.afterRefused = await win.webContents.executeJavaScript(SAMPLE);
  if (!/answered HTTP 500/.test(checks.afterRefused.status ?? "")) {
    failure(`a refused refresh said ${JSON.stringify(checks.afterRefused.status)}`);
  }
  if (!/answered HTTP 500/.test(checks.afterRefused.lastError ?? "")) {
    failure(`a refused refresh left the error field as ${JSON.stringify(checks.afterRefused.lastError)}`);
  }

  // ── 4. a value the vault refuses is shown, not swallowed ───────────────
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-testid="fx-url"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "not-a-url");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await click(win, "fx-save");
  await settle(200);
  checks.afterBadUrl = await win.webContents.executeJavaScript(SAMPLE);
  if (!/http or https URL/.test(checks.afterBadUrl.error ?? "")) {
    failure(`a refused source URL showed ${JSON.stringify(checks.afterBadUrl.error)}`);
  }

  // ── 5. going back to the default ───────────────────────────────────────
  await click(win, "fx-reset");
  await settle(250);
  checks.afterReset = await win.webContents.executeJavaScript(SAMPLE);
  // Clearing must not discard the rate the vault already knows: the operator
  // changed where it comes from, not what the vault holds.
  if (!/16\.49/.test(checks.afterReset.rate ?? "")) {
    failure(`clearing the source discarded the rate: ${JSON.stringify(checks.afterReset.rate)}`);
  }
  if (checks.afterReset.url !== "https://open.er-api.com/v6/latest/USD") {
    failure(`clearing did not restore the default: ${JSON.stringify(checks.afterReset.url)}`);
  }

  if (consoleErrors.length > 0) failure(`console errors: ${consoleErrors.join(" | ")}`);

  const report = {
    pass: errors.length === 0,
    failures: errors,
    what: "the USD→ZAR rate source panel: load, save-and-read, a refused source, and back to the default",
    checks,
    screenshot: shotFailure ?? "captured",
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`panel: ${checks.initial.heading} — ${checks.initial.controls.join(", ")}`);
  console.log(`rate:  ${checks.afterSave.rate}  (${checks.afterSave.status})`);
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
  console.error("fx-panel rig timed out");
  app.exit(1);
}, 60_000);
