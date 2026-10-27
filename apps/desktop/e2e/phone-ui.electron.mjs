/**
 * Drives the phone client's desktop surfaces and turns its checks into
 * `e2e/artifacts/phone-ui.json` plus the screenshots beside it.
 *
 *   node_modules/.bin/electron e2e/phone-ui.electron.mjs
 *
 * Run with the dev server up (`npm run dev`). Exit 0 = every check held.
 *
 * WHAT THIS COVERS
 *
 * Settings → Phone on the real shipping section: the toggle, the address
 * validation, the pairing code and its QR, the countdown, the metric pin, and
 * forgetting a device. The page is a harness page because a dev-server page has
 * no preload; the section, the CSS, and the layout engine are the product's.
 * The pairing payload is generated here with the same `qrcode` call the service
 * uses, so the QR on screen is a real, decodable QR rather than a grey box.
 *
 * WHAT IT DOES NOT COVER (yet)
 *
 * The phone app itself, its offline outbox, and a real pairing against the
 * running door are the phone-window legs, added with the PWA. The chat strip is
 * covered by the chat-panel rig.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { app, BrowserWindow, nativeTheme } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const userDataDir = path.join(artifactsDir, "userdata", "phone-ui");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

const failures = [];
const scenarios = [];
const screens = [];

const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sample(win, expression) {
  return win.webContents.executeJavaScript(expression, true);
}

async function waitFor(win, expression, label, timeoutMs = 10_000) {
  const started = Date.now();
  for (;;) {
    const value = await sample(win, expression).catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await sleep(100);
  }
}

async function click(win, selector) {
  return sample(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
}

async function clickButton(win, label) {
  return sample(
    win,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => (candidate.textContent ?? "").trim() === ${JSON.stringify(label)},
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
}

async function setControl(win, selector, value, kind) {
  return sample(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = window.${kind === "select" ? "HTMLSelectElement" : "HTMLInputElement"}.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(${JSON.stringify(kind === "select" ? "change" : "input")}, { bubbles: true }));
      return true;
    })()`,
  );
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(artifactsDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  screens.push(file);
  return file;
}

function pairingFixture() {
  const code = "ABCD2345";
  const link = `https://studio.example.ts.net/phone/#pair=${code}`;
  return {
    code,
    link,
    qrDataUrl: "",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

async function settingsLeg() {
  const pairing = pairingFixture();
  pairing.qrDataUrl = await QRCode.toDataURL(pairing.link, { width: 240, margin: 1 });

  const state = {
    enabled: true,
    doorUrl: "http://127.0.0.1:8647",
    publicOrigin: "https://studio.example.ts.net",
    error: null,
    devices: [
      {
        id: "device-rig",
        name: "iPhone",
        createdAt: "2026-10-01T10:00:00.000Z",
        lastSeenAt: "2026-10-27T08:00:00.000Z",
      },
    ],
    metric: null,
    pendingDrafts: [],
  };

  const rig = encodeURIComponent(JSON.stringify({ state, pairing }));
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    win.webContents.setBackgroundThrottling(false);
    await win.loadURL(`${DEV_URL}/e2e/phone-settings.html?rig=${rig}`);
    await sample(win, "window.phoneSettingsHarnessReady");

    // 1 — the shipped section, with its door and its controls.
    const landing = await sample(
      win,
      `(() => ({
        title: document.querySelector(".settings-panel__title")?.textContent ?? null,
        toggle: Boolean(document.querySelector('input[aria-label="Phone access"]')),
        toggleChecked: document.querySelector('input[aria-label="Phone access"]')?.checked ?? null,
        door: document.querySelector(".settings-field p[role=status]")?.textContent?.trim() ?? null,
        address: document.querySelector('input[aria-label="Phone address"]')?.value ?? null,
      }))()`,
    );
    check(
      "settings shows the phone door",
      landing.title === "Phone" &&
        landing.toggle === true &&
        landing.toggleChecked === true &&
        landing.door === "http://127.0.0.1:8647" &&
        landing.address === "https://studio.example.ts.net",
      JSON.stringify(landing),
    );

    // 2 — the toggle really turns it off and on.
    await click(win, 'input[aria-label="Phone access"]');
    await waitFor(
      win,
      `document.querySelector('input[aria-label="Phone access"]')?.checked === false`,
      "the toggle to turn phone access off",
    );
    const offCopy = await sample(
      win,
      `document.body.textContent.includes("Turn phone access on to pair a phone")`,
    );
    await click(win, 'input[aria-label="Phone access"]');
    await waitFor(
      win,
      `document.querySelector('input[aria-label="Phone access"]')?.checked === true`,
      "the toggle to turn phone access back on",
    );
    check(
      "toggle turns access off and on",
      offCopy === true,
      `off copy ${offCopy}`,
    );

    // 3 — http is refused, with the reason on screen.
    await setControl(win, 'input[aria-label="Phone address"]', "http://insecure.example", "input");
    await clickButton(win, "Save address");
    await waitFor(
      win,
      `Boolean(document.querySelector(".form-error"))`,
      "the https refusal",
    );
    const refused = await sample(win, `document.querySelector(".form-error")?.textContent ?? ""`);
    check(
      "http address is refused",
      /https/.test(refused),
      `error ${JSON.stringify(refused)}`,
    );

    // 4 — https saves, and the call reached the bridge.
    await setControl(win, 'input[aria-label="Phone address"]', "https://studio.example.ts.net", "input");
    await clickButton(win, "Save address");
    await waitFor(
      win,
      `document.querySelector(".form-error") === null`,
      "the https address to save",
    );
    const savedCalls = await sample(win, "window.__lqPhoneCalls");
    check(
      "https address is saved",
      savedCalls.some(
        (call) => call.method === "setPublicOrigin" && call.origin === "https://studio.example.ts.net",
      ),
      JSON.stringify(savedCalls),
    );

    // 5 — pairing shows the code, a real QR, and a countdown that moves.
    await clickButton(win, "Pair a phone");
    await waitFor(win, `Boolean(document.querySelector("img[alt='Pairing QR code']"))`, "the QR");
    const paired = await sample(
      win,
      `(() => ({
        code: document.body.textContent.includes("ABCD2345"),
        qr: document.querySelector("img[alt='Pairing QR code']")?.src?.startsWith("data:image/png") ?? false,
        countdown: /expires in \\d+s/.test(document.body.textContent ?? ""),
      }))()`,
    );
    // The countdown is the one thing on this panel that proves its own clock
    // is alive. Poll rather than sleep once: a hidden window throttles timers
    // unless it is told not to, and a rig must not confuse that with a dead
    // interval.
    const countdownOf = () => sample(win, `(document.body.textContent ?? "").match(/expires in (\\d+)s/)?.[1] ?? null`);
    const before = await countdownOf();
    let after = before;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await sleep(200);
      after = await countdownOf();
      if (after !== null && before !== null && Number(after) < Number(before)) break;
    }
    const countdownMoved = after !== null && before !== null && Number(after) < Number(before);
    check(
      "pairing shows a real QR and expires",
      paired.code === true && paired.qr === true && paired.countdown === true && countdownMoved === true,
      `${JSON.stringify(paired)} / ${before}→${after}`,
    );
    await shot(win, "phone-settings");

    // 6 — Cancel clears it.
    await clickButton(win, "Cancel");
    await waitFor(
      win,
      `!document.querySelector("img[alt='Pairing QR code']")`,
      "the pairing panel to clear",
    );
    check(
      "cancel clears the pairing code",
      await sample(win, `!document.body.textContent.includes("Pairing code")`),
      "the pairing block is still on screen",
    );

    // 7 — the metric pin writes the id, and the select reflects it.
    await setControl(win, 'select[aria-label="Pinned metric"]', "month_spend", "select");
    await sleep(200);
    const metricCalls = await sample(win, "window.__lqPhoneCalls");
    const selected = await sample(
      win,
      `document.querySelector('select[aria-label="Pinned metric"]')?.value ?? null`,
    );
    check(
      "metric select writes",
      metricCalls.some((call) => call.method === "setMetric" && call.metric === "month_spend") &&
        selected === "month_spend",
      `calls ${JSON.stringify(metricCalls)} / value ${selected}`,
    );

    // 8 — a paired device can be forgotten.
    const deviceShown = await sample(win, `document.body.textContent.includes("iPhone")`);
    await clickButton(win, "Forget");
    await waitFor(
      win,
      `!document.body.textContent.includes("iPhone")`,
      "the device row to leave",
    );
    const forgetCalls = await sample(win, "window.__lqPhoneCalls");
    check(
      "forget removes the device",
      deviceShown === true &&
        forgetCalls.some(
          (call) => call.method === "revokeDevice" && call.id === "device-rig",
        ),
      `shown ${deviceShown} / calls ${JSON.stringify(forgetCalls)}`,
    );

    return { win };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function chatStripLeg() {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    win.webContents.setBackgroundThrottling(false);
    await win.loadURL(`${DEV_URL}/e2e/chat-panel.html?phone=1`);
    await sample(win, "window.chatPanelHarnessReady");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="phone-drafts"]'))`,
      "the phone draft strip",
    );

    const strip = await sample(
      win,
      `(() => {
        const root = document.querySelector('[data-testid="phone-drafts"]');
        return {
          head: root?.querySelector(".phone-drafts__head")?.textContent?.trim() ?? null,
          text: root?.querySelector(".phone-drafts__body")?.textContent ?? null,
          meta: root?.querySelector(".phone-drafts__meta")?.textContent ?? null,
        };
      })()`,
    );
    check(
      "chat strip shows the phone draft",
      /1 phone draft/.test(strip.head ?? "") &&
        strip.text === "R85 Pick n Pay food" &&
        /iPhone/.test(strip.meta ?? ""),
      JSON.stringify(strip),
    );

    await click(win, 'button[aria-label^="Ask the companion about the phone draft"]');
    await waitFor(
      win,
      `document.querySelector('textarea[aria-label="Message Hermes"]')?.value?.includes("Post the phone draft") === true`,
      "the confirmation prefilled into the composer",
    );
    await click(win, 'button[aria-label="Send message"]');
    await waitFor(
      win,
      `Array.isArray(window.__lqChatCalls) && window.__lqChatCalls.length > 0`,
      "the turn to be sent",
    );
    const turn = await sample(win, "window.__lqChatCalls?.[0] ?? null");
    check(
      "chat strip prefill carries the draft",
      turn?.instructionsContext?.phoneDrafts?.[0]?.clientId ===
        "00000000-0000-4000-8000-000000000001" &&
        turn?.instructionsContext?.phoneDrafts?.[0]?.captureDate === "2026-10-25",
      JSON.stringify(turn?.instructionsContext?.phoneDrafts ?? null),
    );
    await shot(win, "phone-chat-strip");
    return win;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  let report;
  const timeout = setTimeout(() => {
    console.error("phone-ui: timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    await settingsLeg();
    await chatStripLeg();
    report = {
      ranAt: new Date().toISOString(),
      scenarios,
      failures,
      screens,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      ranAt: new Date().toISOString(),
      scenarios,
      failures: [...failures, `threw: ${error instanceof Error ? error.message : String(error)}`],
      screens,
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "phone-ui.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = (report.scenarios ?? []).map((s) => [s.pass ? "PASS" : "FAIL", s.name, s.detail ?? ""]);
  const header = ["", "scenario", "detail"];
  const widths = header.map((_, i) => Math.max(header[i].length, ...rows.map((r) => String(r[i]).length)));
  const format = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "phone ui: PASS" : "phone ui: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`phone-ui: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
