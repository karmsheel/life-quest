/**
 * The one-Life rig: boots the REAL main process, preload and renderer on a
 * throwaway vault, then holds the operator-facing contract of P0.
 *
 * WHY THIS RIG EXISTS
 *
 * A new vault now seeds a base `life` area (unlocked) and five LOCKED areas —
 * Health, Mind, Finance, Business, Relationships. Locked areas are invisible
 * until Settings → Areas unlocks them, and the titlebar lens is a quiet "Life"
 * label until a second area exists. This is the only rig that proves the whole
 * join over the real IPC bridge and a real vault: the seed, the quiet lens, the
 * Settings unlock button, the `domain:unlock` channel, `unlockDomain` on disk,
 * the refreshed snapshot, and the segmented control appearing at two areas.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *  1. The app opens on a locked area because the renderer's lens fallback is
 *     missing. The rig first asserts the titlebar carries the quiet Life label
 *     and no switcher, and the vault's persisted pref names `health` (locked).
 *  2. The lock is real but the unlock is a no-op that redraws. Every claim about
 *     the two unlocks is re-read from the vault's `domain.json` and log by the
 *     test after the window exits; the rig itself also reads the locked list
 *     shrinking and the chips appearing.
 *  3. The switcher appears for the wrong reason (a stub snapshot, a re-render
 *     with three chips from the start). The zero-state read happens before any
 *     click, and the three labels are asserted after the two unlocks only.
 *  4. The screenshot is stale, blank, or another window's. Each is this window's
 *     own `capturePage()` at the moment named, and the test requires >20 KB.
 *  5. The rig touches the operator's app, vault or Hermes. `HERMES_HOME` is a
 *     temp dir, a stub `hermes` is first on PATH, the vault is a throwaway
 *     `createVault()`, the MCP doors move to free ports, and the profile is one
 *     no real install has (`lq-areas-e2e`). No real gateway is started: a fake
 *     HTTP server that answers `/health` is the companion's attach point.
 *
 * Run by `tests/life-areas-e2e.test.ts`; it builds the world and passes it as
 * `LQ_AREAS_WORLD`. Exit 0 = every check held; the artifact is
 * `e2e/artifacts/life-areas.json` plus three screenshots.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "life-areas.json");
const SHOT_FRESH = path.join(artifactsDir, "life-areas-fresh.png");
const SHOT_SETTINGS = path.join(artifactsDir, "life-areas-settings.png");
const SHOT_UNLOCKED = path.join(artifactsDir, "life-areas-unlocked.png");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

const checks = [];
const failures = [];
const screenshots = [];
const states = {};

function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail: detail === null ? null : String(detail) });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(win, expression, label, timeoutMs = 30_000) {
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

async function shot(win, file) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  const bytes = fs.statSync(file).size;
  screenshots.push({ file, bytes });
  return bytes;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** The companion's attach point: a real HTTP server, no sessions. */
async function serveHealth(port) {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/health" || url.endsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (url.endsWith("/v1/capabilities")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

const readWorld = () => JSON.parse(fs.readFileSync(path.join(process.env.LQ_AREAS_WORLD, "world.json"), "utf8"));

/** `HERMES_HOME/.env`, written after the fake gateway has a port. */
function writeHostEnv(hermesHome, port) {
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

function writeReport(pass) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        pass,
        failures,
        checks,
        states,
        screenshots,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

/** The band as the operator sees it: quiet label or the segmented control. */
const LENS_EXPRESSION = `(() => {
  const switcher = document.querySelector(".domain-switcher");
  const tabs = document.querySelector(".domain-switcher__tabs");
  return {
    switcher: Boolean(switcher),
    quiet: Boolean(document.querySelector(".domain-switcher--quiet")),
    quietText: (document.querySelector(".domain-switcher__life")?.textContent ?? "").trim(),
    tabs: tabs
      ? Array.from(tabs.querySelectorAll(".ui-segmented__option")).map((b) => ({
          label: (b.textContent ?? "").trim(),
          checked: b.getAttribute("aria-checked") === "true",
        }))
      : null,
    homeTitle: (document.querySelector(".home-dashboard__title")?.textContent ?? "").trim(),
    lensBox: (() => {
      const box = document.querySelector(".window-titlebar__lens .domain-switcher");
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    })(),
  };
})()`;

async function unlockAreas(win, names) {
  return win.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(names)};
    const pressed = [];
    for (const row of Array.from(document.querySelectorAll(".locked-areas__item"))) {
      const name = (row.querySelector(".locked-areas__name")?.textContent ?? "").trim();
      if (!wanted.includes(name)) continue;
      const button = Array.from(row.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Unlock");
      if (button) { button.click(); pressed.push(name); }
    }
    return pressed;
  })()`);
}

async function run() {
  const world = readWorld();
  const port = await freePort();
  const server = await serveHealth(port);
  writeHostEnv(world.hermesHome, port);

  process.env.HERMES_HOME = world.hermesHome;
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
  if (!process.env.LIFEQUEST_E2E) {
    process.env.LIFEQUEST_E2E = JSON.stringify({
      userData: world.userData,
      showWindow: true,
      mcpPorts: world.mcpPorts,
    });
  }
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();

    // ── 1. the app opens on Life, not on the persisted locked area ─────────
    await waitFor(win, `Boolean(document.querySelector(".window-titlebar__lens"))`, "the titlebar lens to mount", 120_000);
    await waitFor(win, `Boolean(document.querySelector(".domain-switcher"))`, "the lens to render");
    await waitFor(win, `Boolean(document.querySelector(".home-dashboard__title"))`, "the Life dashboard title");
    await sleep(400);

    const fresh = await win.webContents.executeJavaScript(LENS_EXPRESSION);
    states.fresh = fresh;
    check("the titlebar carries the lens on first run", fresh.switcher === true, fresh.switcher);
    check("a vault with no unlocked areas shows the quiet Life label", fresh.quiet === true, fresh);
    check("the quiet label reads Life", fresh.quietText === "Life", fresh.quietText);
    check("there is no switcher to point at before a second area", fresh.tabs === null, fresh.tabs);
    check("the dashboard title reads Life", fresh.homeTitle === "Life", fresh.homeTitle);
    check("the quiet label keeps a lens-sized box", (fresh.lensBox?.height ?? 0) > 0, fresh.lensBox);

    const freshBytes = await shot(win, SHOT_FRESH);
    check("the first-run screen was captured", freshBytes > 20 * 1024, `${freshBytes} bytes`);

    // ── 2. Settings → Areas reveals the locked five ────────────────────────
    await win.webContents.executeJavaScript(`location.hash = "#/settings?tab=domains"`);
    await waitFor(win, `Boolean(document.querySelector(".locked-areas"))`, "the locked areas list", 30_000);
    const settings = await win.webContents.executeJavaScript(`(() => ({
      heading: (document.querySelector(".domains-manager__section-title")?.textContent ?? "").trim(),
      lockedNames: Array.from(document.querySelectorAll(".locked-areas__name")).map((n) => (n.textContent ?? "").trim()),
      unlockButtons: Array.from(document.querySelectorAll(".locked-areas__item button")).filter((b) => (b.textContent ?? "").trim() === "Unlock").length,
      areasTitle: (document.querySelector(".settings-card__title, .settings-section__title")?.textContent ?? "").trim(),
    }))()`);
    states.settings = settings;
    check("the five locked areas are named exactly once each", JSON.stringify(settings.lockedNames) === JSON.stringify(["Health", "Mind", "Finance", "Business", "Relationships"]), settings.lockedNames);
    check("each locked area has its own Unlock control", settings.unlockButtons === 5, settings.unlockButtons);

    const settingsBytes = await shot(win, SHOT_SETTINGS);
    check("the locked list was captured", settingsBytes > 20 * 1024, `${settingsBytes} bytes`);

    // ── 3. unlock two areas through the real button/channel ───────────────
    const pressed = await unlockAreas(win, ["Health", "Finance"]);
    check("Health and Finance were pressed", JSON.stringify(pressed) === JSON.stringify(["Health", "Finance"]), pressed);
    await waitFor(win, `document.querySelectorAll(".locked-areas__item").length === 3`, "the locked list to shrink to three", 30_000);

    // ── 4. the band becomes the switcher ───────────────────────────────────
    await win.webContents.executeJavaScript(`location.hash = "#/home"`);
    await waitFor(win, `Boolean(document.querySelector(".domain-switcher__tabs"))`, "the segmented lens to appear", 30_000);
    await sleep(300);

    const unlocked = await win.webContents.executeJavaScript(LENS_EXPRESSION);
    states.unlocked = unlocked;
    const labels = (unlocked.tabs ?? []).map((tab) => tab.label);
    check("two unlocked areas turn the band into the switcher", unlocked.quiet === false, unlocked);
    check("the switcher reads Life, Health, Finance", JSON.stringify(labels) === JSON.stringify(["Life", "Health", "Finance"]), labels);
    check("Life is the selected lens", unlocked.tabs?.[0]?.checked === true, unlocked.tabs?.[0]);
    check("the dashboard is still on Life", unlocked.homeTitle === "Life", unlocked.homeTitle);

    // ── 5. choosing Health changes the surface ─────────────────────────────
    await win.webContents.executeJavaScript(`(() => {
      const chip = Array.from(document.querySelectorAll(".domain-switcher__tabs .ui-segmented__option"))
        .find((b) => (b.textContent ?? "").trim() === "Health");
      chip?.click();
      return Boolean(chip);
    })()`);
    await waitFor(
      win,
      `document.querySelector(".domain-switcher__tabs .ui-segmented__option[aria-checked=true]")?.textContent.trim() === "Health"`,
      "the Health chip to become the lens",
    );
    const healthLens = await win.webContents.executeJavaScript(LENS_EXPRESSION);
    states.healthLens = healthLens;
    check("the Health lens is active", healthLens.tabs?.find((tab) => tab.checked)?.label === "Health", healthLens.tabs);
    check("the dashboard names the area", healthLens.homeTitle === "Health", healthLens.homeTitle);

    const unlockedBytes = await shot(win, SHOT_UNLOCKED);
    check("the unlocked switcher was captured", unlockedBytes > 20 * 1024, `${unlockedBytes} bytes`);

    // The window keeps painting; nothing here writes to the vault after this.
    writeReport(checks.every((entry) => entry.pass));
    return checks.every((entry) => entry.pass);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run()
  .then((pass) => {
    if (!pass) console.error(`[life-areas] failures: ${failures.join("; ")}`);
    app.quit();
    process.exitCode = pass ? 0 : 1;
  })
  .catch((error) => {
    failures.push(error instanceof Error ? error.message : String(error));
    states.error = String(error?.stack ?? error);
    try {
      writeReport(false);
    } catch {
      /* the artifact is best effort on a crash */
    }
    console.error(`[life-areas] rig crashed: ${error?.stack ?? error}`);
    app.quit();
    process.exitCode = 1;
  });
