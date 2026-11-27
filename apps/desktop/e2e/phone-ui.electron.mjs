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
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import QRCode from "qrcode";
import { build } from "esbuild";
import { app, BrowserWindow, nativeTheme, session } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const artifactsDir = path.join(here, "artifacts");
const userDataDir = path.join(artifactsDir, "userdata", "phone-ui");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

/**
 * A run that hangs is a run that cannot be diagnosed without re-running it, and
 * a re-run here costs three minutes of the bench. Every step leaves a line.
 */
const PROGRESS = path.join(artifactsDir, "phone-ui-progress.log");
function progress(message) {
  try {
    fs.appendFileSync(PROGRESS, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A progress file is diagnostics, never a reason to fail.
  }
}
fs.rmSync(PROGRESS, { force: true });
progress("module loaded");

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const BUNDLE = path.join(artifactsDir, ".phone-ui.bundle.mjs");
const PHONE_PARTITION = "persist:phone-rig";

/**
 * The real vault engine and door, bundled for the in-rig phone leg. The rig is
 * an Electron main process, not a Node script: it cannot import the app's
 * TypeScript directly, so it uses the same esbuild call `dev.mjs` uses.
 */
async function loadModules() {
  await build({
    stdin: {
      contents: [
        `export * from ${JSON.stringify(path.join(repoRoot, "packages/vault-core/src/index.ts"))};`,
        `export * from ${JSON.stringify(path.join(repoRoot, "apps/desktop/electron/phone-door.ts"))};`,
      ].join("\n"),
      resolveDir: repoRoot,
      sourcefile: "phone-ui.entry.ts",
      loader: "ts",
    },
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "silent",
  });
  return import(pathToFileURL(BUNDLE).href);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function makeMetricVault(mod) {
  const root = path.join(userDataDir, `vault-phone-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(root, { recursive: true });
  const created = await mod.createVault(root, "Phone rig");
  if (!created.ok) throw new Error(`createVault: ${created.error}`);
  // Areas seed locked; the kit lives in the Finance area, so open it first.
  const unlocked = await mod.unlockDomain(root, mod.FINANCE_DOMAIN_SLUG);
  if (!unlocked.ok) throw new Error(`unlockDomain: ${unlocked.error}`);
  const installed = await mod.installFinanceKit(root, mod.USER_ACTOR);
  if (!installed.ok || !installed.value.applied) throw new Error("installFinanceKit did not apply");
  const account = await mod.upsertRow(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.accounts, {
    id: "phone-acct",
    cells: { name: "Cheque", type: "checking", currency: "ZAR", opening_balance: 1000, opening_as_of: "2000-01-01" },
  });
  if (!account.ok) throw new Error(`account: ${account.error}`);
  for (const [id, amount] of [["phone-tx-1", -200], ["phone-tx-2", -270]]) {
    const row = await mod.upsertRow(root, mod.FINANCE_DOMAIN_SLUG, mod.FINANCE_DB_IDS.transactions, {
      id,
      cells: {
        date: todayIso(),
        amount,
        account: "phone-acct",
        category: null,
        payee: "Rig",
        notes: null,
        source_file: null,
        provenance: "rig",
        external_id: null,
        transfer_id: null,
      },
    });
    if (!row.ok) throw new Error(`txn ${id}: ${row.error}`);
  }
  const metric = await mod.writePhoneMetric(root, "month_spend");
  if (!metric.ok) throw new Error(`metric: ${metric.error}`);
  return root;
}

async function phoneLeg() {
  progress("phoneLeg: start");
  const mod = await loadModules();
  progress("phoneLeg: modules loaded");
  const root = await makeMetricVault(mod);
  progress("phoneLeg: vault ready");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const doorResult = await mod.createPhoneDoor({
    root,
    vaultName: "Phone rig",
    staticDir: path.join(desktopRoot, "dist-phone"),
    port,
    publicOrigin: origin,
    pairingTtlMs: 60_000,
  });
  if (!doorResult.ok) throw new Error(`createPhoneDoor: ${doorResult.error}`);
  let door = doorResult.value;
  progress("phoneLeg: door started");
  const code = door.mintPairingCode();
  if (!code.ok) throw new Error(`mint: ${code.error}`);

  const phoneSession = session.fromPartition(PHONE_PARTITION);
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    show: false,
    webPreferences: { partition: PHONE_PARTITION, contextIsolation: true, nodeIntegration: false },
  });

  try {
    win.webContents.setBackgroundThrottling(false);
    progress("phoneLeg: loading phone");
    await win.loadURL(`${door.url}/phone/#pair=${code.value.code}`);
    progress("phoneLeg: phone loaded");
    await waitFor(win, `Boolean(document.querySelector('[data-testid="phone-home"]'))`, "the paired phone home");
    progress("phoneLeg: home shown");

    const home = await sample(win, "document.body.textContent");
    check(
      "phone pairs and shows the metric",
      /Spent in/.test(home) && /470\.00/.test(home) && home.includes("Phone rig"),
      home.slice(0, 200),
    );

    // The shell must be cached before the offline reload, or the leg would be
    // proving that Chromium shows a network error. Bounded on purpose: a
    // registration that never settles must fail this leg, not hang the rig.
    progress("phoneLeg: waiting for sw");
    const swReady = await sample(
      win,
      `Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
      ])`,
    );
    check("phone caches its shell", swReady === true, `service worker ready ${swReady}`);
    progress(`phoneLeg: sw ready ${swReady}`);
    await shot(win, "phone-home");

    await setControl(win, 'textarea[aria-label="Draft a transaction"]', "R85 Pick n Pay food", "input");
    await clickButton(win, "Queue");
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="phone-draft"]'))`,
      "the queued draft",
    );
    const queued = await sample(win, "document.body.textContent");
    check(
      "phone queues a draft and no transaction",
      queued.includes("R85 Pick n Pay food") && /Waiting for the companion|On this phone/.test(queued),
      queued.slice(0, 240),
    );

    // Offline: the shell, the draft and the last metric are all from the phone.
    // "The studio is quit" is the door being gone, not a browser setting:
    // closing the listener is the same fact the product has when the window is
    // closed. The shell must come from the service worker and the API must fail.
    progress("phoneLeg: closing the door for the offline leg");
    await door.close();
    const offlineLoad = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await offlineLoad;
    await waitFor(win, `Boolean(document.querySelector('[data-testid="phone-home"]'))`, "the offline home");
    await waitFor(
      win,
      `document.body.textContent.includes("Waiting for your studio")`,
      "the offline status",
    );
    const offline = await sample(win, "document.body.textContent");
    check(
      "phone opens offline with its queue",
      offline.includes("R85 Pick n Pay food") &&
        offline.includes("Waiting for your studio") &&
        /as of/.test(offline),
      offline.slice(0, 240),
    );
    await shot(win, "phone-draft");

    // The studio comes back: reopen the same door and reload. The boot sync
    // should hand the draft over.
    progress("phoneLeg: reopening the door");
    const reopened = await mod.createPhoneDoor({
      root,
      vaultName: "Phone rig",
      staticDir: path.join(desktopRoot, "dist-phone"),
      port,
      publicOrigin: origin,
      pairingTtlMs: 60_000,
    });
    if (!reopened.ok) throw new Error(`reopen: ${reopened.error}`);
    door = reopened.value;
    win.webContents.reload();
    await waitFor(win, `Boolean(document.querySelector('[data-testid="phone-home"]'))`, "the online home");
    await waitFor(
      win,
      `document.body.textContent.includes("Waiting for the companion")`,
      "the synced draft",
    );

    const drafts = await mod.listPhoneDrafts(root, { status: "pending" });
    const draft = drafts.ok ? drafts.value.drafts[0] : undefined;
    check(
      "phone syncs its queue to the studio",
      Boolean(draft) && draft?.text === "R85 Pick n Pay food",
      JSON.stringify(drafts),
    );

    // The companion posts it; the phone's boot refresh picks up the resolution.
    progress(`phoneLeg: pending draft ${draft ? draft.clientId : "none"}`);
    if (draft) {
      const posted = await mod.executePhoneTool(root, mod.COMPANION_ACTOR, "post_phone_draft", {
        clientId: draft.clientId,
      });
      win.webContents.reload();
      await waitFor(win, `Boolean(document.querySelector('[data-testid="phone-home"]'))`, "the posted home");
      await waitFor(
        win,
        `!document.querySelector('[data-testid="phone-draft"]')`,
        "the draft to leave the phone",
      );
      const after = await sample(win, "document.body.textContent");
      check(
        "the companion's post clears the phone",
        posted?.posted === true && !after.includes("R85 Pick n Pay food"),
        `${JSON.stringify(posted)} / ${after.slice(0, 200)}`,
      );
    } else {
      check("the companion's post clears the phone", false, "no pending draft to post");
    }

    return win;
  } finally {
    progress("phoneLeg: closing");
    if (!win.isDestroyed()) win.destroy();
    await door.close();
    progress("phoneLeg: closed");
  }
}

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
  // The prototype matters: React reads the native setter, and a textarea rejects
  // the input element's setter with an incompatible-receiver TypeError. Pick the
  // element's own prototype rather than trusting the caller to name it.
  return sample(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto =
        el instanceof window.HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : el instanceof window.HTMLSelectElement
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      const event = el instanceof window.HTMLSelectElement ? "change" : "input";
      el.dispatchEvent(new Event(event, { bubbles: true }));
      return true;
    })()`,
  );
}

async function shot(win, name) {
  // A hidden window can hand back the frame it painted before the DOM settled;
  // wait for two frames and a beat so the picture is the screen the checks read.
  await sample(
    win,
    `new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 350)),
      ),
    )`,
  ).catch(() => undefined);
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
    win.webContents.on("console-message", (_event, level, message) => {
      progress(`renderer console[${level}]: ${String(message).slice(0, 300)}`);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      progress(`render-process-gone: ${JSON.stringify(details)}`);
    });
    await win.loadURL(`${DEV_URL}/e2e/phone-settings.html?rig=${rig}`);
    progress("settings: page loaded");
    await Promise.race([
      sample(win, "window.phoneSettingsHarnessReady"),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    progress("settings: readiness race done");

    // 1 — the shipped section, with its door and its controls.
    const landing = await sample(
      win,
      `(() => ({
        title: document.querySelector(".settings-panel__title")?.textContent ?? null,
        toggle: Boolean(document.querySelector('[role="switch"][aria-label="Phone access"]')),
        toggleChecked:
          document
            .querySelector('[role="switch"][aria-label="Phone access"]')
            ?.getAttribute("aria-checked") ?? null,
        door: document.querySelector(".settings-field p[role=status]")?.textContent?.trim() ?? null,
        address: document.querySelector('input[aria-label="Phone address"]')?.value ?? null,
      }))()`,
    );
    check(
      "settings shows the phone door",
      landing.title === "Phone" &&
        landing.toggle === true &&
        landing.toggleChecked === "true" &&
        landing.door === "http://127.0.0.1:8647" &&
        landing.address === "https://studio.example.ts.net",
      JSON.stringify(landing),
    );

    // 2 — the toggle really turns it off and on.
    await click(win, '[role="switch"][aria-label="Phone access"]');
    await waitFor(
      win,
      `document.querySelector('[role="switch"][aria-label="Phone access"]')?.getAttribute("aria-checked") === "false"`,
      "the toggle to turn phone access off",
    );
    const offCopy = await sample(
      win,
      `document.body.textContent.includes("Turn phone access on to pair a phone")`,
    );
    await click(win, '[role="switch"][aria-label="Phone access"]');
    await waitFor(
      win,
      `document.querySelector('[role="switch"][aria-label="Phone access"]')?.getAttribute("aria-checked") === "true"`,
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
  progress("main: start");
  fs.mkdirSync(artifactsDir, { recursive: true });
  nativeTheme.themeSource = "dark";

  let report;
  const timeout = setTimeout(() => {
    console.error("phone-ui: timed out after 120s");
    // Write what is known before exiting: a timeout with no artifact is a run
    // that cannot be diagnosed without re-running it.
    const reportFile = path.join(artifactsDir, "phone-ui.json");
    fs.writeFileSync(
      reportFile,
      `${JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          scenarios,
          failures: [...failures, "timed out after 120s"],
          screens,
          pass: false,
        },
        null,
        2,
      )}\n`,
    );
    app.exit(1);
  }, 120_000);

  try {
    await settingsLeg();
    progress("main: settings done");
    await chatStripLeg();
    progress("main: strip done");
    await phoneLeg();
    progress("main: phone done");
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

/**
 * Last line of defence: if any await never settles, leave an artifact and exit
 * rather than letting the wrapper's own timeout kill a process with no report.
 */
setTimeout(() => {
  progress("WATCHDOG: 150s");
  const reportFile = path.join(artifactsDir, "phone-ui.json");
  fs.writeFileSync(
    reportFile,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        scenarios,
        failures: [...failures, "watchdog: the rig never finished"],
        screens,
        pass: false,
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
    console.error(`phone-ui: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
