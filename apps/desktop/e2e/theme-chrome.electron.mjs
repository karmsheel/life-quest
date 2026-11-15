/**
 * Theme files, v2 — the vertical slice, judged on the REAL app.
 *
 * What the slice claims, and how this rig can falsify each:
 *
 *  1. `a-written-theme-file-is-worn-without-a-restart` — the rig writes a theme
 *     file into the app profile's `themes/` directory (the gesture the companion
 *     makes) and the real shell repaints: the wing switcher leaves the rail's top
 *     band for the window strip, and the area lens leaves the strip's centre for
 *     a bottom dock. No reload, no IPC from the renderer.
 *  2. `the-preview-asks-before-it-stays` — the preview bar is on screen, and it
 *     names the file. A theme that arrived without consent is not silently kept.
 *  3. `an-unkept-theme-reverts-by-itself` — after the ten-second window the
 *     shell is back on the chrome it had, with no preview bar and the wing band
 *     back in the rail. This is the "a bad write cannot strand the operator"
 *     half of the design.
 *  4. `keep-persists-the-theme-across-a-reload` — Keep is pressed, the renderer
 *     reloads, and the moved chrome is still where the theme put it: the choice
 *     is a file name in storage, not a lucky in-memory state.
 *  5. `an-invalid-theme-is-refused-by-name` — a theme with a made-up placement
 *     is refused with an error that names the field, and the chrome does not
 *     move. A silent refusal would look exactly like a working theme that
 *     happened to change nothing.
 *  6. `material-lands-on-the-document` — the theme's radius/density/motion are
 *     written to the document root (the material layer), and are not free CSS.
 *
 * The world is throwaway: its own profile, its own vault, a stub `hermes` first
 * on PATH, and its own MCP ports. `bootForE2e` runs the product's own main
 * process, preload and renderer, so this is the shipped shell and not a harness
 * page pretending to be it.
 *
 * Run with the checkout's dev server up (`lifequest-e2e` does both):
 *
 *   LQ_THEME_WORLD=<dir> <electron> e2e/theme-chrome.electron.mjs
 *
 * Exit 0 = every check held. The report is `e2e/artifacts/themes-v2.json`, and
 * the pictures are `e2e/artifacts/themes-v2-preview.png` and
 * `e2e/artifacts/themes-v2-kept.png`.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const world = process.env.LQ_THEME_WORLD;
const DEV_URL = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173";
const REPORT = path.join(artifactsDir, "themes-v2.json");
const PREVIEW_PNG = path.join(artifactsDir, "themes-v2-preview.png");
const KEPT_PNG = path.join(artifactsDir, "themes-v2-kept.png");

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Hermes host gateway that is serving this profile, and nothing else.
 *
 * Without a live host the app boots into the companion setup screen instead of
 * a vault — which would make every check about a screen the feature never
 * reaches. The stub answers the two probes the app's attach path makes.
 */
function serveHostGateway() {
  return listen(
    http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/health")) {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      if (url.pathname.endsWith("/v1/capabilities")) {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            features: {
              session_list: true,
              session_chat: true,
              session_chat_stream: true,
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    }),
  );
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** Two ports that were free a moment ago, for the rig's own MCP doors. */
async function freePorts(n) {
  const held = [];
  const ports = [];
  for (let i = 0; i < n; i += 1) {
    const server = net.createServer();
    ports.push(await listen(server));
    held.push(server);
  }
  await Promise.all(
    held.map((server) => new Promise((r) => server.close(r))),
  );
  return ports;
}

/** The `hermes` on PATH: succeeds for seeding, never brings a host up. */
function writeHermesStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    ["#!/bin/sh", 'case "$1" in', "  gateway) exit 1 ;;", "esac", "exit 0", ""].join(
      "\n",
    ),
    { mode: 0o755 },
  );
}

const SAMPLE = `(() => {
  const previewBar = document.querySelector('[data-testid="theme-preview-bar"]');
  const errorBar = document.querySelector('[data-testid="theme-error"]');
  const radius = getComputedStyle(document.documentElement).getPropertyValue("--radius-lg").trim();
  return {
    hash: location.hash,
    errors: (window.__lqErrors ?? []).slice(-4),
    shell: Boolean(document.querySelector(".shell")),
    preview: Boolean(previewBar),
    previewText: previewBar ? previewBar.textContent : null,
    error: errorBar ? errorBar.textContent : null,
    railWings: Boolean(document.querySelector(".nav-rail__wings-band")),
    wingTitlebar: Boolean(document.querySelector('[data-chrome-place="titlebar-left"]')),
    wingFloating: Boolean(document.querySelector('[data-chrome-place="floating-left"]')),
    domainBottom: Boolean(document.querySelector('[data-chrome-place="bottom-center"]')),
    domainFloating: Boolean(document.querySelector('[data-chrome-place="floating-bottom-right"]')),
    lensInStrip: Boolean(document.querySelector(".window-titlebar__lens")),
    areaNames: [...document.querySelectorAll(".domain-switcher__name")].map((n) => n.textContent.trim()),
    kept: (() => { try { return localStorage.getItem("lifequest-theme-file"); } catch { return null; } })(),
    density: document.documentElement.dataset.materialDensity ?? null,
    motion: document.documentElement.dataset.materialMotion ?? null,
    radiusLg: radius,
  };
})()`;

const THEME = {
  name: "solar-system",
  label: "Solar System",
  description: "The wing switcher rides the window strip; the area lens floats at the foot.",
  chrome: {
    wingSwitcher: { place: "titlebar-left", variant: "labels" },
    domainSwitcher: { place: "bottom-center", variant: "pill" },
  },
  material: { radius: "round", density: "compact", motion: "none" },
};

const BAD_THEME = {
  name: "bad-chrome",
  label: "Bad Chrome",
  chrome: { wingSwitcher: { place: "sidebar-top" } },
};

async function main() {
  if (!world) throw new Error("LQ_THEME_WORLD is required");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const themesDir = path.join(profileDir, "themes");

  // ── The world ────────────────────────────────────────────────────────────
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir);

  let vaultId;
  if (fs.existsSync(path.join(vaultDir, "lifequest.json"))) {
    vaultId = JSON.parse(
      fs.readFileSync(path.join(vaultDir, "lifequest.json"), "utf8"),
    ).id;
  } else {
    fs.mkdirSync(vaultDir, { recursive: true });
    const created = await createVault(vaultDir, "Theme Chrome");
    if (!created.ok) throw new Error(`createVault: ${created.error}`);
    vaultId = created.value.lifequest.id;
  }

  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vaultId,
            name: "Theme Chrome",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: "lq-theme-probe",
      },
      null,
      2,
    )}\n`,
  );

  const [mcpLocal, mcpInvite] = await freePorts(2);
  const hostPort = await serveHostGateway();
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${hostPort}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
  );
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n  provider: nous\n",
  );
  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = DEV_URL;
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocal, invite: mcpInvite },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  // ── The real app ─────────────────────────────────────────────────────────
  await app.whenReady();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const consoleLines = [];
  win.webContents.on("console-message", (_event, level, message) => {
    consoleLines.push(`[${level}] ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    consoleLines.push(`[did-fail-load] ${code} ${description} ${url}`);
  });

  const evaluate = (source) =>
    win.webContents.executeJavaScript(source, true).catch((error) => {
      throw new Error(String(error));
    });

  const deadline = Date.now() + 60_000;
  let up = null;
  while (Date.now() < deadline) {
    try {
      up = await evaluate("Boolean(document.querySelector('.shell'))");
    } catch {
      up = null;
    }
    if (up) break;
    await sleep(100);
  }
  if (!up) {
    const diag = await evaluate(`(() => ({
      href: location.href,
      body: document.body ? document.body.innerText.slice(0, 1500) : null,
      splashHidden: document.getElementById("splash") ? document.getElementById("splash").hasAttribute("hidden") : null,
      rootChildren: document.getElementById("root") ? document.getElementById("root").children.length : null,
      welcome: document.querySelector(".welcome-lead") ? document.querySelector(".welcome-lead").textContent.trim() : null,
    }))()`).catch((error) => ({ error: String(error) }));
    const debug = { diag, consoleLines: consoleLines.slice(-40) };
    fs.writeFileSync(
      path.join(artifactsDir, "themes-v2-debug.json"),
      `${JSON.stringify(debug, null, 2)}\n`,
    );
    const debugShot = await win.webContents.capturePage().catch(() => null);
    if (debugShot) fs.writeFileSync(path.join(artifactsDir, "themes-v2-debug.png"), debugShot.toPNG());
    throw new Error(`the app shell never mounted: ${JSON.stringify(debug)}`);
  }

  // Runtime errors after the shell is up: a render that throws takes the whole
  // React tree with it, and a rig that only sees "no shell" cannot tell that
  // from a slow boot.
  await evaluate(`(() => {
    window.__lqErrors = [];
    window.addEventListener("error", (event) => {
      window.__lqErrors.push(String(event.error && event.error.stack ? event.error.stack : event.message));
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      window.__lqErrors.push("rejection: " + String(reason && reason.stack ? reason.stack : reason));
    });
    return true;
  })()`);

  // Two areas, so the area lens is a control and not the quiet "Life" label:
  // `unlockedAreas` deliberately excludes the base Life area.
  const domA = await evaluate(
    "Promise.all([window.lifequest.domainCreate({ name: 'Health' }), window.lifequest.domainCreate({ name: 'Work' })]).then((rs) => rs.every((r) => r.ok))",
  );
  check("two-areas-land", domA === true, "domain:create did not answer ok for both areas");
  let baseline = null;
  for (let i = 0; i < 100; i += 1) {
    baseline = await evaluate(SAMPLE);
    if (baseline.areaNames.length >= 2) break;
    await sleep(100);
  }
  check(
    "baseline-chrome-is-the-default",
    baseline &&
      baseline.railWings &&
      baseline.lensInStrip &&
      baseline.domainBottom === false,
    JSON.stringify(baseline),
  );

  // ── 1–2: the companion's gesture, and the preview gate ───────────────────
  fs.mkdirSync(themesDir, { recursive: true });
  fs.writeFileSync(
    path.join(themesDir, "solar-system.json"),
    `${JSON.stringify(THEME, null, 2)}\n`,
  );

  let preview = null;
  for (let i = 0; i < 120; i += 1) {
    preview = await evaluate(SAMPLE);
    if (preview.preview && preview.domainBottom) break;
    await sleep(100);
  }
  check(
    "a-written-theme-file-is-worn-without-a-restart",
    preview &&
      preview.wingTitlebar &&
      preview.domainBottom &&
      preview.railWings === false &&
      preview.lensInStrip === false,
    JSON.stringify(preview),
  );
  check(
    "the-preview-asks-before-it-stays",
    Boolean(preview?.preview) && (preview?.previewText ?? "").includes("solar-system.json"),
    preview?.previewText ?? "no preview bar",
  );
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(PREVIEW_PNG, shot.toPNG());

  // ── 3: the clock hands the window back ───────────────────────────────────
  let reverted = null;
  for (let i = 0; i < 200; i += 1) {
    reverted = await evaluate(SAMPLE);
    if (!reverted.preview && reverted.railWings && reverted.wingTitlebar === false) break;
    await sleep(100);
  }
  check(
    "an-unkept-theme-reverts-by-itself",
    Boolean(reverted) &&
      reverted.preview === false &&
      reverted.railWings === true &&
      reverted.wingTitlebar === false &&
      reverted.domainBottom === false,
    JSON.stringify(reverted),
  );

  // ── 4: Keep survives a reload ────────────────────────────────────────────
  fs.writeFileSync(
    path.join(themesDir, "solar-system.json"),
    `${JSON.stringify({ ...THEME, description: "Kept after review." }, null, 2)}\n`,
  );
  let previewAgain = null;
  for (let i = 0; i < 120; i += 1) {
    previewAgain = await evaluate(SAMPLE);
    if (previewAgain.preview) break;
    await sleep(100);
  }
  const kept = await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-keep\"]'); if (!b) return false; b.click(); return true; })()",
  );
  check("the-keep-button-is-there", kept === true, "no Keep button in the preview bar");
  await sleep(300);
  const keptState = await evaluate(SAMPLE);
  check(
    "keep-persists-the-file-name",
    keptState.kept === "solar-system.json" && keptState.preview === false,
    JSON.stringify({ kept: keptState.kept, preview: keptState.preview }),
  );

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  let afterReload = null;
  for (let i = 0; i < 150; i += 1) {
    afterReload = await evaluate(SAMPLE);
    if (afterReload.shell && afterReload.wingTitlebar) break;
    await sleep(100);
  }
  check(
    "keep-persists-the-theme-across-a-reload",
    afterReload &&
      afterReload.wingTitlebar &&
      afterReload.domainBottom &&
      afterReload.railWings === false &&
      afterReload.kept === "solar-system.json",
    JSON.stringify(afterReload),
  );
  check(
    "material-lands-on-the-document",
    afterReload &&
      afterReload.density === "compact" &&
      afterReload.motion === "none" &&
      afterReload.radiusLg === "28px",
    JSON.stringify({
      density: afterReload?.density,
      motion: afterReload?.motion,
      radiusLg: afterReload?.radiusLg,
    }),
  );
  // Let the first paint after the reload settle: a capture taken the instant
  // the root mounts photographs the paint before the board's own cards.
  await sleep(900);
  const keptShot = await win.webContents.capturePage();
  fs.writeFileSync(KEPT_PNG, keptShot.toPNG());

  // ── 5: an invalid theme is refused by name ───────────────────────────────
  fs.writeFileSync(
    path.join(themesDir, "bad-chrome.json"),
    `${JSON.stringify(BAD_THEME, null, 2)}\n`,
  );
  let refused = null;
  for (let i = 0; i < 120; i += 1) {
    refused = await evaluate(SAMPLE);
    if (refused.error) break;
    await sleep(100);
  }
  check(
    "an-invalid-theme-is-refused-by-name",
    Boolean(refused?.error) &&
      refused.error.includes("chrome.wingSwitcher.place") &&
      refused.wingTitlebar === true &&
      refused.domainBottom === true,
    JSON.stringify({ error: refused?.error, wing: refused?.wingTitlebar }),
  );

  await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-dismiss\"]'); if (b) b.click(); return true; })()",
  );

  const report = {
    ranAt: new Date().toISOString(),
    world,
    checks,
    failures,
    pass: failures.length === 0,
    artifacts: {
      preview: path.relative(desktopRoot, PREVIEW_PNG),
      kept: path.relative(desktopRoot, KEPT_PNG),
    },
    theme: THEME,
    refused: BAD_THEME,
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    app.exit(1);
    return;
  }
  app.exit(0);
}

main().catch((error) => {
  const report = {
    ranAt: new Date().toISOString(),
    world: world ?? null,
    checks,
    failures: [...failures, String(error)],
    pass: false,
  };
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    /* ignore */
  }
  console.error(error);
  app.exit(1);
});
