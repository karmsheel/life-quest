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
const FLOATING_PNG = path.join(artifactsDir, "themes-v2-floating.png");
const SETTINGS_PNG = path.join(artifactsDir, "themes-v2-settings.png");
const MATERIAL_PNG = path.join(artifactsDir, "themes-v2-material.png");
const LAYOUT_PNG = path.join(artifactsDir, "themes-v2-layout.png");
const VARIANTS_PNG = path.join(artifactsDir, "themes-v2-variants.png");
const SIDEBAR_RIGHT_PNG = path.join(artifactsDir, "themes-v2-sidebar-right.png");
const DOCK_LEFT_PNG = path.join(artifactsDir, "themes-v2-dock-left.png");
const FLOATING_RAIL_PNG = path.join(artifactsDir, "themes-v2-floating-rail.png");
const OUTSIDE_PNG = path.join(artifactsDir, "themes-v2-outside-theme.png");
const SCENE_PNG = path.join(artifactsDir, "themes-v2-scene.png");

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

const SAMPLE = `(async () => {
  const previewBar = document.querySelector('[data-testid="theme-preview-bar"]');
  const errorBar = document.querySelector('[data-testid="theme-error"]');
  const radius = getComputedStyle(document.documentElement).getPropertyValue("--radius-lg").trim();
  const wingHost =
    document.querySelector('[data-chrome-place="titlebar-left"]') ||
    document.querySelector('[data-chrome-place="floating-left"]');
  const wingText = wingHost
    ? (wingHost.querySelector('[role="radio"]')?.textContent ?? "").trim()
    : null;
  const state = await window.lifequest?.themeGetState?.();
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
    wingText,
    domainBottom: Boolean(document.querySelector('[data-chrome-place="bottom-center"]')),
    domainBelow: Boolean(document.querySelector('[data-chrome-place="below-titlebar"]')),
    domainFloating: Boolean(document.querySelector('[data-chrome-place="floating-bottom-right"]')),
    domainPill: Boolean(document.querySelector(".domain-switcher--pill")),
    lensInStrip: Boolean(document.querySelector(".window-titlebar__lens")),
    settingsEntry: Boolean(document.querySelector(".window-titlebar__settings")),
    areaNames: [...document.querySelectorAll(".domain-switcher__name")].map((n) => n.textContent.trim()),
    kept: state && state.ok ? state.value.keptFile : null,
    density: document.documentElement.dataset.materialDensity ?? null,
    motion: document.documentElement.dataset.materialMotion ?? null,
    shadowAttr: document.documentElement.dataset.materialShadow ?? null,
    backdropAttr: document.documentElement.dataset.materialBackdrop ?? null,
    typeScaleAttr: document.documentElement.dataset.materialTypeScale ?? null,
    fontSize: getComputedStyle(document.documentElement).fontSize,
    durQuick: getComputedStyle(document.documentElement).getPropertyValue("--dur-quick").trim(),
    shadowSm: getComputedStyle(document.documentElement).getPropertyValue("--shadow-sm").trim(),
    backdrop: (() => {
      const main = document.querySelector(".shell__main");
      return main ? getComputedStyle(main).backgroundImage.slice(0, 80) : null;
    })(),
    radiusLg: radius,
    wingCompact: Boolean(document.querySelector(".nav-rail__wings--compact")),
    railWingLabels: [...document.querySelectorAll(".nav-rail__wings [role='radio']")].map((el) =>
      (el.textContent ?? "").trim(),
    ),
    domainLeftRail: Boolean(document.querySelector('[data-chrome-place="left-rail"]')),
    domainIcons: Boolean(document.querySelector(".domain-switcher--icons")),
    domainList: Boolean(document.querySelector(".domain-switcher--list")),
    areaInitials: [...document.querySelectorAll(".domain-switcher__initial")].map((el) =>
      (el.textContent ?? "").trim(),
    ),
    contentPadTop: (() => {
      const el = document.querySelector(".shell__content");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    railLinkPadY: (() => {
      const el = document.querySelector(".nav-rail__link");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    chatPad: (() => {
      const el = document.querySelector(".chat-panel__body");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    dockLeft: Boolean(document.querySelector(".shell--chat-left")),
    navPlaceAttr: document.documentElement.dataset.chromeNavPlace ?? null,
    innerWidth: window.innerWidth,
    railRect: (() => {
      const el = document.querySelector(".nav-rail");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        right: Math.round(b.right),
        top: Math.round(b.top),
        width: Math.round(b.width),
      };
    })(),
    titlebarHeight: (() => {
      const el = document.querySelector(".window-titlebar");
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    })(),
    titlebarSizeAttr: document.documentElement.dataset.chromeTitlebarSize ?? null,
    accentVar: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    scenePresetAttr: document.documentElement.dataset.sceneBackdrop ?? null,
    sceneIntensityAttr: document.documentElement.dataset.sceneIntensity ?? null,
    sceneLayer: Boolean(document.querySelector(".scene-backdrop")),
    sceneNodes: (() => {
      const layer = document.querySelector(".scene-backdrop");
      if (!layer) return 0;
      return layer.querySelectorAll(".scene-backdrop__star, .scene-backdrop__ring, .scene-backdrop__planet, .scene-backdrop__band").length;
    })(),
    sceneDuration: (() => {
      const node = document.querySelector(".scene-backdrop__star, .scene-backdrop__band");
      if (!node) return null;
      const seconds = parseFloat(getComputedStyle(node).animationDuration);
      return Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null;
    })(),
    slotPositioned: (() => {
      const main = document.querySelector(".shell__main");
      return main ? getComputedStyle(main).position : null;
    })(),
    stripPainted: Boolean(document.querySelector(".window-titlebar")),
    titlebarVar: document.documentElement.style.getPropertyValue("--window-titlebar-height") ?? null,
    mainRect: (() => {
      const el = document.querySelector(".shell__main");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    })(),
    chatRect: (() => {
      const el = document.querySelector(".chat-panel");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    })(),
    lensCenter: (() => {
      const el = document.querySelector(".window-titlebar__lens");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return Math.round(b.left + b.width / 2);
    })(),
    navWidthAttr: document.documentElement.dataset.chromeNavWidth ?? null,
    navWidthVar: getComputedStyle(document.documentElement)
      .getPropertyValue("--shell-sidebar-width")
      .trim(),
    railWidth: (() => {
      const rail = document.querySelector(".nav-rail");
      return rail ? Math.round(rail.getBoundingClientRect().width) : null;
    })(),
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

/** A complete palette with one pair at 1:1 — the contrast refusal's subject. */
const LOW_CONTRAST_THEME = {
  name: "low-contrast",
  label: "Low Contrast",
  colors: Object.fromEntries(
    [
      "background",
      "foreground",
      "card",
      "cardForeground",
      "muted",
      "mutedForeground",
      "popover",
      "popoverForeground",
      "primary",
      "primaryForeground",
      "secondary",
      "secondaryForeground",
      "accent",
      "accentForeground",
      "border",
      "input",
      "ring",
      "destructive",
      "destructiveForeground",
    ].map((key) => [key, key === "background" || key === "foreground" ? "#ffffff" : "#000000"]),
  ),
};

/** What the companion's own write_theme call puts on screen. */
const AGENT_THEME = {
  name: "agent-written",
  label: "Agent Written",
  description: "Written by a tool call through the MCP door, not by the rig's pen.",
  chrome: {
    wingSwitcher: { place: "floating-left", variant: "labels" },
    domainSwitcher: { place: "below-titlebar", variant: "segmented" },
    navRail: { width: "wide" },
  },
  material: {
    radius: "round",
    density: "airy",
    motion: "lively",
    shadow: "deep",
    typeScale: "airy",
    backdrop: "grid",
  },
};

/** The Phase 1 gate: a complete theme authored only through the MCP door. */
const OUTSIDE_THEME = {
  name: "outside-theme",
  label: "Outside Theme",
  description: "A whole theme — chrome and all six material axes — written through the companion's write_theme tool.",
  chrome: {
    wingSwitcher: { place: "floating-left", variant: "labels" },
    domainSwitcher: { place: "bottom-center", variant: "pill" },
    navRail: { place: "floating", width: "wide" },
    chatDock: { side: "left" },
    titlebar: { size: "tall" },
  },
  material: {
    radius: "sharp",
    shadow: "flat",
    motion: "none",
    typeScale: "compact",
    density: "compact",
    backdrop: "grid",
  },
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

  // ── 6: the rest of the matrix ───────────────────────────────────────────
  const writeThemeFile = (file, theme) =>
    fs.writeFileSync(path.join(themesDir, file), `${JSON.stringify(theme, null, 2)}\n`);
  const waitFor = async (predicate, timeout = 12_000) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      last = await evaluate(SAMPLE);
      if (predicate(last)) return last;
      await sleep(100);
    }
    return last;
  };

  const click = (testId) =>
    evaluate(`(() => {
      const b = document.querySelector('[data-testid="${testId}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);

  writeThemeFile("matrix-icons.json", {
    name: "matrix-icons",
    label: "Icons On The Strip",
    chrome: {
      wingSwitcher: { place: "titlebar-left", variant: "icons" },
      domainSwitcher: { place: "below-titlebar", variant: "segmented" },
    },
  });
  const icons = await waitFor((s) => s.wingTitlebar && s.domainBelow && s.preview);
  check(
    "the-second-placement-moves-and-swaps-variant",
    icons &&
      icons.wingTitlebar &&
      icons.wingText === "H" &&
      icons.domainBelow &&
      icons.lensInStrip === false,
    JSON.stringify({ wingText: icons?.wingText, below: icons?.domainBelow, strip: icons?.lensInStrip }),
  );

  // Keyboard and aria where a moved control now lives: both switchers are radio
  // groups, so ArrowRight must move the checked choice and keep focus inside.
  const keyboard = await evaluate(`(async () => {
    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = async (selector) => {
      const host = document.querySelector(selector);
      if (!host) return null;
      const radios = [...host.querySelectorAll('[role="radio"]')];
      const before = radios.findIndex((el) => el.getAttribute("aria-checked") === "true");
      if (before < 0) return { before: -1 };
      radios[before].focus();
      const focusedBefore = document.activeElement === radios[before];
      radios[before].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      await settle(700);
      const hostAfter = document.querySelector(selector);
      if (!hostAfter) return { before, focusedBefore, now: -1, focusedInside: false, count: 0 };
      const afterRadios = [...hostAfter.querySelectorAll('[role="radio"]')];
      return {
        before,
        focusedBefore,
        now: afterRadios.findIndex((el) => el.getAttribute("aria-checked") === "true"),
        focusedInside: hostAfter.contains(document.activeElement),
        count: afterRadios.length,
      };
    };
    // One after the other, never at once: focusing the area lens would otherwise
    // take the focus away from the wing switcher before it is measured.
    const wing = await probe('[data-chrome-place="titlebar-left"]');
    const domain = await probe('[data-chrome-place="below-titlebar"]');
    return { wing, domain };
  })()`);
  check(
    "keyboard-moves-the-moved-wing-switcher",
    keyboard?.wing &&
      keyboard.wing.focusedBefore === true &&
      keyboard.wing.now > -1 &&
      keyboard.wing.now !== keyboard.wing.before &&
      keyboard.wing.focusedInside === true,
    JSON.stringify(keyboard?.wing),
  );
  check(
    "keyboard-moves-the-moved-area-lens",
    keyboard?.domain &&
      keyboard.domain.focusedBefore === true &&
      keyboard.domain.now > -1 &&
      keyboard.domain.now !== keyboard.domain.before &&
      keyboard.domain.focusedInside === true,
    JSON.stringify(keyboard?.domain),
  );

  writeThemeFile("matrix-floating.json", {
    name: "matrix-floating",
    label: "Floating Edges",
    chrome: {
      wingSwitcher: { place: "floating-left", variant: "labels" },
      domainSwitcher: { place: "floating-bottom-right", variant: "pill" },
    },
  });
  const floating = await waitFor(
    (s) => s.wingFloating && s.domainFloating && s.domainPill && s.preview,
  );
  check(
    "the-floating-corners-hold-the-pill",
    floating &&
      floating.wingFloating &&
      floating.wingTitlebar === false &&
      floating.domainFloating &&
      floating.domainPill &&
      floating.areaNames.length >= 2,
    JSON.stringify({ wing: floating?.wingFloating, domain: floating?.domainFloating, pill: floating?.domainPill, areas: floating?.areaNames }),
  );
  const floatingShot = await win.webContents.capturePage();
  fs.writeFileSync(FLOATING_PNG, floatingShot.toPNG());

  writeThemeFile("matrix-hidden.json", {
    name: "matrix-hidden",
    label: "Hidden Chrome",
    chrome: {
      wingSwitcher: { place: "hidden", variant: "labels" },
      domainSwitcher: { place: "hidden", variant: "segmented" },
    },
  });
  const hidden = await waitFor(
    (s) =>
      !s.railWings &&
      !s.wingTitlebar &&
      !s.wingFloating &&
      !s.lensInStrip &&
      !s.domainBelow &&
      !s.domainBottom &&
      !s.domainFloating &&
      s.preview,
  );
  check(
    "hidden-chrome-still-leaves-the-way-out",
    hidden &&
      hidden.railWings === false &&
      hidden.wingTitlebar === false &&
      hidden.wingFloating === false &&
      hidden.lensInStrip === false &&
      hidden.domainBelow === false &&
      hidden.domainBottom === false &&
      hidden.domainFloating === false &&
      hidden.settingsEntry === true,
    JSON.stringify({ settings: hidden?.settingsEntry, shell: hidden?.shell, preview: hidden?.preview }),
  );
  // The preview bar is the escape hatch while the chrome is hidden: Revert.
  const revertedAgain = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backToKept = await waitFor((s) => !s.preview && s.wingTitlebar && s.domainBottom);
  check(
    "the-escape-hatch-returns-the-kept-theme",
    revertedAgain === true && backToKept?.kept === "solar-system.json" && backToKept.wingTitlebar && backToKept.domainBottom,
    JSON.stringify({ revertedAgain, kept: backToKept?.kept, wing: backToKept?.wingTitlebar, domain: backToKept?.domainBottom }),
  );

  // ── 6b: the remaining variants — compact wings, the rail's lens, icons, lists
  writeThemeFile("variant-lab.json", {
    name: "variant-lab",
    label: "Variant Lab",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "compact" },
      domainSwitcher: { place: "left-rail", variant: "icons" },
    },
  });
  const variants = await waitFor(
    (s) => s.railWings && s.wingCompact && s.domainLeftRail && s.domainIcons && s.preview,
  );
  check(
    "compact-wings-and-the-rail-lens",
    variants &&
      variants.railWings === true &&
      variants.wingCompact === true &&
      variants.railWingLabels.join(",") === "Home,Def,Plan,Exec,Rev" &&
      variants.domainLeftRail === true &&
      variants.domainIcons === true &&
      variants.lensInStrip === false &&
      variants.areaInitials.length >= 2 &&
      variants.areaInitials[0] === "L",
    JSON.stringify({
      compact: variants?.wingCompact,
      labels: variants?.railWingLabels,
      railLens: variants?.domainLeftRail,
      icons: variants?.areaInitials,
      strip: variants?.lensInStrip,
    }),
  );
  const variantsShot = await win.webContents.capturePage();
  fs.writeFileSync(VARIANTS_PNG, variantsShot.toPNG());

  writeThemeFile("variant-list.json", {
    name: "variant-list",
    label: "Variant List",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "left-rail", variant: "list" },
    },
  });
  const listed = await waitFor(
    (s) => s.railWings && s.domainLeftRail && s.domainList && s.preview,
  );
  check(
    "list-lens-stacks-in-the-rail",
    listed &&
      listed.domainList === true &&
      listed.domainLeftRail === true &&
      listed.areaNames.length >= 3,
    JSON.stringify({
      list: listed?.domainList,
      railLens: listed?.domainLeftRail,
      areas: listed?.areaNames,
    }),
  );

  // The escape hatch still returns the kept theme from a variant preview.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromVariants = await waitFor(
    (s) => !s.preview && s.wingTitlebar && s.domainBottom && !s.domainLeftRail,
  );
  check(
    "variants-revert-to-the-kept-theme",
    backFromVariants?.kept === "solar-system.json" &&
      backFromVariants.wingTitlebar === true &&
      backFromVariants.domainBottom === true &&
      backFromVariants.domainLeftRail === false,
    JSON.stringify({
      kept: backFromVariants?.kept,
      wing: backFromVariants?.wingTitlebar,
      domain: backFromVariants?.domainBottom,
    }),
  );

  // ── 6c: the sidebar on the trailing edge ────────────────────────────────
  writeThemeFile("nav-right.json", {
    name: "nav-right",
    label: "Sidebar Right",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      navRail: { place: "right", width: "wide" },
    },
  });
  const rightRail = await waitFor(
    (s) =>
      s.navPlaceAttr === "right" &&
      s.preview &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left > s.mainRect.right,
  );
  check(
    "sidebar-can-sit-on-the-right",
    rightRail?.navPlaceAttr === "right" &&
      rightRail.railRect.left > rightRail.mainRect.right &&
      rightRail.railRect.right >= rightRail.innerWidth - 20 &&
      rightRail.mainRect.left <= 2 &&
      rightRail.lensCenter !== null &&
      rightRail.lensCenter > 0 &&
      rightRail.lensCenter < rightRail.railRect.left,
    JSON.stringify({
      place: rightRail?.navPlaceAttr,
      rail: rightRail?.railRect,
      main: rightRail?.mainRect,
      lens: rightRail?.lensCenter,
      width: rightRail?.innerWidth,
    }),
  );

  const rightShot = await win.webContents.capturePage();
  fs.writeFileSync(SIDEBAR_RIGHT_PNG, rightShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromRight = await waitFor(
    (s) => !s.preview && s.wingTitlebar && s.domainBottom && s.navPlaceAttr === "left",
  );
  check(
    "right-rail-reverts-to-the-kept-theme",
    backFromRight?.kept === "solar-system.json" &&
      backFromRight.navPlaceAttr === "left" &&
      backFromRight.wingTitlebar === true,
    JSON.stringify({
      kept: backFromRight?.kept,
      place: backFromRight?.navPlaceAttr,
      wing: backFromRight?.wingTitlebar,
    }),
  );

  // ── 6d: the dock on the page's leading edge ──────────────────────────────
  writeThemeFile("dock-left.json", {
    name: "dock-left",
    label: "Dock Left",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      chatDock: { side: "left" },
    },
  });
  const dockLeft = await waitFor(
    (s) => s.dockLeft && s.chatRect && s.mainRect && s.chatRect.left < s.mainRect.left && s.preview,
  );
  check(
    "chat-dock-can-sit-on-the-left",
    dockLeft?.dockLeft === true &&
      dockLeft.chatRect.left < dockLeft.mainRect.left &&
      dockLeft.mainRect.right > dockLeft.chatRect.right,
    JSON.stringify({
      dockLeft: dockLeft?.dockLeft,
      chat: dockLeft?.chatRect,
      main: dockLeft?.mainRect,
    }),
  );

  const dockShot = await win.webContents.capturePage();
  fs.writeFileSync(DOCK_LEFT_PNG, dockShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromDock = await waitFor(
    (s) => !s.preview && !s.dockLeft && s.wingTitlebar && s.domainBottom,
  );
  check(
    "dock-side-reverts-to-the-kept-theme",
    backFromDock?.kept === "solar-system.json" &&
      backFromDock.dockLeft === false &&
      backFromDock.domainBottom === true,
    JSON.stringify({
      kept: backFromDock?.kept,
      dockLeft: backFromDock?.dockLeft,
      wing: backFromDock?.wingTitlebar,
    }),
  );

  // ── 6e: the sidebar afloat, and the strip's own height ──────────────────
  writeThemeFile("float-lab.json", {
    name: "float-lab",
    label: "Floating Rail",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "icons" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      navRail: { place: "floating", width: "default" },
      titlebar: { size: "tall" },
    },
  });
  const floatRail = await waitFor(
    (s) =>
      s.navPlaceAttr === "floating" &&
      s.preview &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left <= 20 &&
      s.mainRect.left <= 2 &&
      s.titlebarHeight === 40 &&
      s.titlebarSizeAttr === "tall",
  );
  check(
    "sidebar-can-float-above-the-page",
    floatRail?.navPlaceAttr === "floating" &&
      floatRail.railRect.left <= 20 &&
      floatRail.railRect.width >= 200 &&
      floatRail.railRect.width <= 320 &&
      floatRail.railRect.top >= 35 &&
      floatRail.mainRect.left <= 2,
    JSON.stringify({
      place: floatRail?.navPlaceAttr,
      rail: floatRail?.railRect,
      main: floatRail?.mainRect,
      preview: floatRail?.preview,
      error: floatRail?.error,
      previewText: (floatRail?.previewText ?? "").slice(0, 80),
      titlebarVar: floatRail?.titlebarVar,
    }),
  );
  check(
    "titlebar-can-wear-a-taller-strip",
    floatRail?.titlebarHeight === 40 && floatRail.titlebarSizeAttr === "tall",
    JSON.stringify({
      height: floatRail?.titlebarHeight,
      size: floatRail?.titlebarSizeAttr,
    }),
  );
  const floatRailShot = await win.webContents.capturePage();
  fs.writeFileSync(FLOATING_RAIL_PNG, floatRailShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromFloat = await waitFor(
    (s) =>
      !s.preview &&
      s.wingTitlebar &&
      s.navPlaceAttr === "left" &&
      s.titlebarHeight === 32,
  );
  check(
    "float-and-strip-size-revert-to-the-kept-theme",
    backFromFloat?.kept === "solar-system.json" &&
      backFromFloat.navPlaceAttr === "left" &&
      backFromFloat.titlebarHeight === 32,
    JSON.stringify({
      kept: backFromFloat?.kept,
      place: backFromFloat?.navPlaceAttr,
      height: backFromFloat?.titlebarHeight,
    }),
  );

  // ── 6f: the scene behind the page ───────────────────────────────────────
  writeThemeFile("scene-lab.json", {
    name: "scene-lab",
    label: "Scene Lab",
    chrome: {
      wingSwitcher: { place: "titlebar-left", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
    },
    scene: { background: { preset: "starfield", intensity: "lively" } },
  });
  const sceneStarfield = await waitFor(
    (s) =>
      s.preview &&
      s.scenePresetAttr === "starfield" &&
      s.sceneIntensityAttr === "lively" &&
      s.sceneLayer &&
      s.sceneNodes >= 60 &&
      s.slotPositioned === "relative" &&
      typeof s.sceneDuration === "number" &&
      s.sceneDuration > 0 &&
      s.sceneDuration < 4,
    20_000,
  );
  check(
    "a-theme-can-name-a-starfield",
    sceneStarfield?.scenePresetAttr === "starfield" &&
      sceneStarfield.sceneIntensityAttr === "lively" &&
      sceneStarfield.sceneLayer === true &&
      sceneStarfield.sceneNodes >= 60 &&
      sceneStarfield.slotPositioned === "relative" &&
      sceneStarfield.sceneDuration > 0 &&
      sceneStarfield.sceneDuration < 4,
    JSON.stringify({
      preset: sceneStarfield?.scenePresetAttr,
      intensity: sceneStarfield?.sceneIntensityAttr,
      layer: sceneStarfield?.sceneLayer,
      nodes: sceneStarfield?.sceneNodes,
      duration: sceneStarfield?.sceneDuration,
      positioned: sceneStarfield?.slotPositioned,
    }),
  );
  const sceneShot = await win.webContents.capturePage();
  fs.writeFileSync(SCENE_PNG, sceneShot.toPNG());

  writeThemeFile("aurora-lab.json", {
    name: "aurora-lab",
    label: "Aurora Lab",
    scene: { background: { preset: "aurora", intensity: "calm" } },
  });
  const sceneAurora = await waitFor(
    (s) =>
      s.preview &&
      s.scenePresetAttr === "aurora" &&
      s.sceneIntensityAttr === "calm" &&
      s.sceneLayer &&
      s.sceneNodes >= 3,
    20_000,
  );
  check(
    "an-aurora-replaces-the-stars",
    sceneAurora?.scenePresetAttr === "aurora" &&
      sceneAurora.sceneIntensityAttr === "calm" &&
      sceneAurora.sceneLayer === true &&
      sceneAurora.sceneNodes >= 3,
    JSON.stringify({
      preset: sceneAurora?.scenePresetAttr,
      intensity: sceneAurora?.sceneIntensityAttr,
      nodes: sceneAurora?.sceneNodes,
    }),
  );

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromScene = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "solar-system.json" &&
      s.scenePresetAttr === "plain" &&
      !s.sceneLayer,
  );
  check(
    "a-scene-reverts-with-its-theme",
    backFromScene?.kept === "solar-system.json" &&
      backFromScene.scenePresetAttr === "plain" &&
      backFromScene.sceneLayer === false,
    JSON.stringify({
      kept: backFromScene?.kept,
      preset: backFromScene?.scenePresetAttr,
      layer: backFromScene?.sceneLayer,
    }),
  );

  // ── 7: the companion's own tools, through the real MCP door ─────────────
  const { e2eCompanionDoor } = await import("../dist-electron/main.js");
  const door = await e2eCompanionDoor();
  check(
    "the-companion-door-answers",
    Boolean(door?.url && door?.token),
    JSON.stringify({ url: door?.url ?? null, token: Boolean(door?.token) }),
  );
  let client = null;
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    client = new Client({ name: "theme-rig", version: "0.1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(door.url), {
        requestInit: { headers: { Authorization: `Bearer ${door.token}` } },
      }),
    );
    const listed = await client.listTools();
    const names = (listed.tools ?? []).map((tool) => tool.name);
    check(
      "the-theme-tools-are-on-the-companion-door",
      ["get_theme", "validate_theme", "write_theme"].every((name) => names.includes(name)),
      names.slice(-10).join(","),
    );

    const callJson = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const text =
        result.content?.find((part) => part.type === "text")?.text ?? "{}";
      try {
        return { json: JSON.parse(text), isError: result.isError === true };
      } catch {
        return { json: null, isError: true };
      }
    };

    const getTheme = await callJson("get_theme", {});
    check(
      "get-theme-names-what-is-kept",
      getTheme.json?.keptFile === "solar-system.json",
      JSON.stringify(getTheme.json?.keptFile ?? null),
    );

    const contrast = await callJson("validate_theme", { theme: LOW_CONTRAST_THEME });
    const contrastMessage = contrast.json?.error?.message ?? "";
    check(
      "validate-theme-refuses-a-palette-it-cannot-read",
      contrastMessage.includes("WCAG AA contrast"),
      contrastMessage.slice(0, 220),
    );

    const badScene = await callJson("validate_theme", {
      theme: {
        name: "bad-scene",
        label: "Bad Scene",
        scene: { background: { preset: "nebula" } },
      },
    });
    const badSceneMessage = badScene.json?.error?.message ?? "";
    check(
      "validate-theme-refuses-a-scene-it-cannot-draw",
      badSceneMessage.includes("scene.background.preset must be one of"),
      badSceneMessage.slice(0, 220),
    );

    const written = await callJson("write_theme", { theme: AGENT_THEME });
    check(
      "write-theme-names-the-file-it-wrote",
      written.json?.written === "agent-written.json",
      JSON.stringify(written.json),
    );

    const agentPreview = await waitFor(
      (s) =>
        s.preview &&
        s.wingFloating &&
        s.domainBelow &&
        (s.previewText ?? "").includes("agent-written.json"),
    );
    check(
      "the-agents-write-previews-in-the-real-window",
      Boolean(agentPreview?.preview) &&
        agentPreview.wingFloating &&
        agentPreview.domainBelow,
      JSON.stringify({
        preview: agentPreview?.previewText,
        wing: agentPreview?.wingFloating,
        domain: agentPreview?.domainBelow,
      }),
    );

    const pressedKeep = await evaluate(
      `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
    );
    const agentKept = await waitFor(
      (s) => s.kept === "agent-written.json" && !s.preview,
    );
    check(
      "the-agents-write-is-kept-through-the-preview-bar",
      pressedKeep === true && agentKept?.kept === "agent-written.json",
      JSON.stringify({ pressedKeep, kept: agentKept?.kept }),
    );
  } finally {
    if (client) await client.close().catch(() => {});
  }

  // ── 7b: the R1 material tokens, on the real document ───────────────────
  const materialTheme = await waitFor(
    (s) =>
      s.shadowAttr === "deep" &&
      s.backdropAttr === "grid" &&
      s.typeScaleAttr === "airy" &&
      s.fontSize === "17px",
  );
  check(
    "material-tokens-land-on-the-document",
    materialTheme &&
      materialTheme.shadowAttr === "deep" &&
      materialTheme.backdropAttr === "grid" &&
      materialTheme.typeScaleAttr === "airy" &&
      materialTheme.fontSize === "17px" &&
      materialTheme.durQuick === "90ms" &&
      materialTheme.shadowSm !== "none" &&
      (materialTheme.backdrop ?? "").includes("linear-gradient") &&
      (materialTheme.contentPadTop ?? 0) >= 25 &&
      (materialTheme.railLinkPadY ?? 0) >= 8,
    JSON.stringify({
      shadow: materialTheme?.shadowAttr,
      backdrop: materialTheme?.backdropAttr,
      typeScale: materialTheme?.typeScaleAttr,
      fontSize: materialTheme?.fontSize,
      durQuick: materialTheme?.durQuick,
      shadowSm: (materialTheme?.shadowSm ?? "").slice(0, 40),
      bg: (materialTheme?.backdrop ?? "").slice(0, 40),
      pagePad: materialTheme?.contentPadTop,
      railPad: materialTheme?.railLinkPadY,
    }),
  );

  const wideRail = await waitFor(
    (s) => s.navWidthAttr === "wide" && s.navWidthVar === "19rem" && (s.railWidth ?? 0) >= 300,
  );
  check(
    "nav-rail-width-is-the-themes",
    wideRail?.navWidthAttr === "wide" &&
      wideRail.navWidthVar === "19rem" &&
      (wideRail.railWidth ?? 0) >= 300,
    JSON.stringify({
      navWidthAttr: wideRail?.navWidthAttr,
      navWidthVar: wideRail?.navWidthVar,
      railWidth: wideRail?.railWidth,
    }),
  );

  // ── 8: the operator's side of the gate, in Settings → Appearance ─────────
  const openedSettings = await evaluate(`(() => {
    const trigger = document.querySelector(".settings-menu__trigger");
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  let filesPanel = null;
  for (let i = 0; i < 100; i += 1) {
    filesPanel = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="theme-files"]');
      if (!panel) return null;
      return {
        rows: [...panel.querySelectorAll('[data-testid^="theme-file-row-"]')].map((row) => row.getAttribute("data-testid")),
        agentRow: Boolean(document.querySelector('[data-testid="theme-file-row-agent-written"]')),
        agentKept: Boolean(document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-kept"]')),
        solarRow: Boolean(document.querySelector('[data-testid="theme-file-row-solar-system"]')),
        text: panel.textContent.slice(0, 300),
      };
    })()`);
    if (filesPanel?.agentRow) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  check(
    "settings-lists-the-theme-files",
    openedSettings === true &&
      filesPanel?.agentRow === true &&
      filesPanel.agentKept === true &&
      filesPanel.solarRow === true,
    JSON.stringify(filesPanel ? { rows: filesPanel.rows, agentKept: filesPanel.agentKept } : null),
  );
  const settingsShot = await win.webContents.capturePage();
  fs.writeFileSync(SETTINGS_PNG, settingsShot.toPNG());

  // Try a file from the list: it must enter the same ten-second preview gate,
  // not jump straight to kept.
  const triedFromSettings = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-solar-system"] [data-testid="theme-file-try"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const tried = await waitFor(
    (s) => s.preview && (s.previewText ?? "").includes("solar-system.json") && s.wingTitlebar,
  );
  check(
    "try-from-settings-enters-the-preview-gate",
    triedFromSettings === true && Boolean(tried?.preview) && tried.wingTitlebar && tried.kept === "agent-written.json",
    JSON.stringify({ tried: tried?.previewText, kept: tried?.kept }),
  );
  const revertedFromSettings = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backToAgent = await waitFor((s) => !s.preview && s.wingFloating && s.kept === "agent-written.json");
  check(
    "reverting-from-settings-returns-the-kept-theme",
    revertedFromSettings === true && Boolean(backToAgent?.wingFloating) && backToAgent.kept === "agent-written.json",
    JSON.stringify({ wing: backToAgent?.wingFloating, kept: backToAgent?.kept }),
  );

  // ── 9: the operator's own material overrides, above the theme's ─────────
  const pressedSharp = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="material-option-radius-sharp"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const pressedCompact = await click("material-option-density-compact");
  const overridden = await waitFor(
    (s) => s.radiusLg === "8px" && (s.contentPadTop ?? 99) <= 20 && (s.railLinkPadY ?? 99) <= 7,
  );
  check(
    "operator-material-overrides-the-theme",
    pressedSharp === true &&
      pressedCompact === true &&
      overridden?.radiusLg === "8px" &&
      (overridden.contentPadTop ?? 99) <= 20 &&
      overridden.kept === "agent-written.json",
    JSON.stringify({
      pressedSharp,
      pressedCompact,
      radiusLg: overridden?.radiusLg,
      pagePad: overridden?.contentPadTop,
      railPad: overridden?.railLinkPadY,
      kept: overridden?.kept,
    }),
  );
  const materialShot = await win.webContents.capturePage();
  fs.writeFileSync(MATERIAL_PNG, materialShot.toPNG());

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterMaterialReload = await waitFor(
    (s) => s.shell && s.kept === "agent-written.json" && s.radiusLg === "8px",
    20_000,
  );
  check(
    "operator-material-survives-a-reload",
    afterMaterialReload?.radiusLg === "8px" && afterMaterialReload.kept === "agent-written.json",
    JSON.stringify({ radiusLg: afterMaterialReload?.radiusLg, kept: afterMaterialReload?.kept }),
  );

  // Reopen Settings to reset and remove.
  await evaluate(`(() => { const t = document.querySelector(".settings-menu__trigger"); if (t) t.click(); return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('[data-testid="material-reset"]'))`);
    if (ready) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  const pressedReset = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="material-reset"]');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  const reset = await waitFor((s) => s.radiusLg === "28px");
  check(
    "reset-returns-the-themes-material",
    pressedReset === true &&
      reset?.radiusLg === "28px" &&
      (reset.contentPadTop ?? 0) >= 25 &&
      reset.kept === "agent-written.json",
    JSON.stringify({
      pressedReset,
      radiusLg: reset?.radiusLg,
      pagePad: reset?.contentPadTop,
      kept: reset?.kept,
    }),
  );

  // ── 10: the operator's own chrome overrides, above the theme's ──────────
  const pressedWing = await click("chrome-wing-place-titlebar-left");
  const pressedWingVariant = await click("chrome-wing-variant-icons");
  const pressedDomain = await click("chrome-domain-place-bottom-center");
  const pressedDomainVariant = await click("chrome-domain-variant-pill");
  const pressedRight = await click("chrome-nav-place-right");
  const pressedDockLeft = await click("chrome-chat-side-left");
  const pressedTitlebarTall = await click("chrome-titlebar-size-tall");
  const pressedNarrow = await click("chrome-nav-width-narrow");
  const overriddenChrome = await waitFor(
    (s) =>
      s.wingTitlebar &&
      !s.wingFloating &&
      s.domainBottom &&
      !s.domainBelow &&
      s.navWidthAttr === "narrow" &&
      s.navPlaceAttr === "right" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left >= s.mainRect.right - 16 &&
      s.wingText === "H" &&
      s.domainPill,
  );
  check(
    "operator-chrome-overrides-the-theme",
    pressedWing === true &&
      pressedWingVariant === true &&
      pressedDomain === true &&
      pressedDomainVariant === true &&
      pressedRight === true &&
      pressedDockLeft === true &&
      pressedTitlebarTall === true &&
      pressedNarrow === true &&
      overriddenChrome?.wingTitlebar === true &&
      overriddenChrome.wingFloating === false &&
      overriddenChrome.wingText === "H" &&
      overriddenChrome.domainBottom === true &&
      overriddenChrome.domainBelow === false &&
      overriddenChrome.domainPill === true &&
      overriddenChrome.navWidthAttr === "narrow" &&
      overriddenChrome.navPlaceAttr === "right" &&
      overriddenChrome.dockLeft === true &&
      overriddenChrome.titlebarHeight === 40 &&
      overriddenChrome.railRect.left >= overriddenChrome.mainRect.right - 16,
    JSON.stringify({
      pressed:
        pressedWing &&
        pressedWingVariant &&
        pressedDomain &&
        pressedDomainVariant &&
        pressedRight &&
        pressedDockLeft &&
        pressedTitlebarTall &&
        pressedNarrow,
      wingTitlebar: overriddenChrome?.wingTitlebar,
      wingText: overriddenChrome?.wingText,
      pill: overriddenChrome?.domainPill,
      navPlace: overriddenChrome?.navPlaceAttr,
      dockLeft: overriddenChrome?.dockLeft,
      titlebarHeight: overriddenChrome?.titlebarHeight,
      titlebarVar: overriddenChrome?.titlebarVar,
      titlebarAttr: overriddenChrome?.titlebarSizeAttr,
      railLeft: overriddenChrome?.railRect?.left,
      mainRight: overriddenChrome?.mainRect?.right,
      wingFloating: overriddenChrome?.wingFloating,
      domainBottom: overriddenChrome?.domainBottom,
      domainBelow: overriddenChrome?.domainBelow,
      nav: overriddenChrome?.navWidthAttr,
    }),
  );

  const layoutShot = await win.webContents.capturePage();
  fs.writeFileSync(LAYOUT_PNG, layoutShot.toPNG());

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterChromeReload = await waitFor(
    (s) =>
      s.shell &&
      s.kept === "agent-written.json" &&
      s.wingTitlebar &&
      s.domainBottom &&
      s.navWidthAttr === "narrow" &&
      s.navPlaceAttr === "right" &&
      s.dockLeft &&
      s.titlebarHeight === 40,
    20_000,
  );
  check(
    "operator-chrome-survives-a-reload",
    afterChromeReload?.wingTitlebar === true &&
      afterChromeReload.domainBottom === true &&
      afterChromeReload.navWidthAttr === "narrow" &&
      afterChromeReload.navPlaceAttr === "right" &&
      afterChromeReload.dockLeft === true &&
      afterChromeReload.titlebarHeight === 40,
    JSON.stringify({
      wingTitlebar: afterChromeReload?.wingTitlebar,
      domainBottom: afterChromeReload?.domainBottom,
      nav: afterChromeReload?.navWidthAttr,
      navPlace: afterChromeReload?.navPlaceAttr,
      dockLeft: afterChromeReload?.dockLeft,
      titlebarHeight: afterChromeReload?.titlebarHeight,
    }),
  );

  // Reopen Settings and hand layout back to the theme.
  await evaluate(`(() => { const t = document.querySelector(".settings-menu__trigger"); if (t) t.click(); return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('[data-testid="chrome-reset"]'))`);
    if (ready) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  const pressedChromeReset = await click("chrome-reset");
  const resetChrome = await waitFor(
    (s) =>
      s.wingFloating &&
      !s.wingTitlebar &&
      s.domainBelow &&
      s.navWidthAttr === "wide" &&
      s.navPlaceAttr === "left" &&
      !s.dockLeft &&
      s.titlebarHeight === 32,
  );
  check(
    "reset-returns-the-themes-chrome",
    pressedChromeReset === true &&
      resetChrome?.wingFloating === true &&
      resetChrome.wingTitlebar === false &&
      resetChrome.domainBelow === true &&
      resetChrome.navWidthAttr === "wide" &&
      resetChrome.navPlaceAttr === "left" &&
      resetChrome.dockLeft === false &&
      resetChrome.titlebarHeight === 32,
    JSON.stringify({
      pressed: pressedChromeReset,
      wingFloating: resetChrome?.wingFloating,
      domainBelow: resetChrome?.domainBelow,
      nav: resetChrome?.navWidthAttr,
      navPlace: resetChrome?.navPlaceAttr,
      dockLeft: resetChrome?.dockLeft,
      titlebarHeight: resetChrome?.titlebarHeight,
    }),
  );

  // The operator's own scene pick, above the theme's: the kept agent theme has
  // no scene, so this is the operator's sky and Reset must take it away again.
  const pressedSceneOrbit = await click("scene-option-preset-orbit");
  const pressedSceneCalm = await click("scene-option-intensity-calm");
  const overriddenScene = await waitFor(
    (s) =>
      s.scenePresetAttr === "orbit" &&
      s.sceneIntensityAttr === "calm" &&
      s.sceneLayer &&
      s.sceneNodes >= 5,
  );
  check(
    "operator-scene-overrides-the-theme",
    pressedSceneOrbit === true &&
      pressedSceneCalm === true &&
      overriddenScene?.scenePresetAttr === "orbit" &&
      overriddenScene.sceneIntensityAttr === "calm" &&
      overriddenScene.sceneLayer === true &&
      overriddenScene.sceneNodes >= 5,
    JSON.stringify({
      pressed: pressedSceneOrbit && pressedSceneCalm,
      preset: overriddenScene?.scenePresetAttr,
      intensity: overriddenScene?.sceneIntensityAttr,
      nodes: overriddenScene?.sceneNodes,
    }),
  );

  const pressedSceneReset = await click("scene-reset");
  const resetScene = await waitFor(
    (s) => s.scenePresetAttr === "plain" && !s.sceneLayer,
  );
  check(
    "reset-returns-the-themes-scene",
    pressedSceneReset === true &&
      resetScene?.scenePresetAttr === "plain" &&
      resetScene.sceneLayer === false,
    JSON.stringify({
      pressed: pressedSceneReset,
      preset: resetScene?.scenePresetAttr,
      layer: resetScene?.sceneLayer,
    }),
  );

  // Remove the agent's file where the operator would: two presses, then gone.
  const firstRemove = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    if (!b) return false;
    b.click();
    return b.textContent.trim();
  })()`);
  const confirming = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    return b ? b.textContent.trim() : null;
  })()`);
  await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    if (b) b.click();
    return true;
  })()`);
  const removed = await waitFor(
    (s) => !s.wingFloating && !s.wingTitlebar && s.railWings && s.kept === null,
    15_000,
  );
  check(
    "settings-removes-a-theme-and-restores-the-default",
    firstRemove !== false &&
      confirming !== null &&
      confirming !== "Remove" &&
      fs.existsSync(path.join(themesDir, "agent-written.json")) === false &&
      removed?.railWings === true &&
      removed.wingFloating === false &&
      removed.kept === null,
    JSON.stringify({
      confirm: confirming,
      fileGone: !fs.existsSync(path.join(themesDir, "agent-written.json")),
      wing: removed?.wingFloating,
      kept: removed?.kept,
    }),
  );

  // ── 12: the Phase 1 gate — a whole theme from outside, worn and kept ────
  // The first door client closed with its own section; the gate opens a fresh
  // one, which is also the companion's real shape: a call, not a session.
  const gateDoor = await e2eCompanionDoor();
  const { Client: GateClient } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport: GateTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const gateClient = new GateClient({ name: "theme-rig-gate", version: "0.1.0" });
  await gateClient.connect(
    new GateTransport(new URL(gateDoor.url), {
      requestInit: { headers: { Authorization: `Bearer ${gateDoor.token}` } },
    }),
  );
  const gateCall = async (name, args) => {
    const result = await gateClient.callTool({ name, arguments: args });
    const text = result.content?.find((part) => part.type === "text")?.text ?? "{}";
    try {
      return { json: JSON.parse(text), isError: result.isError === true };
    } catch {
      return { json: null, isError: true };
    }
  };
  const outsideWritten = await gateCall("write_theme", { theme: OUTSIDE_THEME });
  const outside = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("outside-theme.json") &&
      s.wingFloating &&
      s.domainBottom &&
      s.domainPill &&
      s.navPlaceAttr === "floating" &&
      s.navWidthAttr === "wide" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.radiusLg === "8px" &&
      s.shadowAttr === "flat" &&
      s.motion === "none" &&
      s.typeScaleAttr === "compact" &&
      s.density === "compact" &&
      s.backdropAttr === "grid",
    25_000,
  );
  check(
    "a-theme-authored-outside-can-be-worn",
    outsideWritten.json?.written === "outside-theme.json" &&
      outside?.wingFloating === true &&
      outside.domainBottom === true &&
      outside.domainPill === true &&
      outside.navPlaceAttr === "floating" &&
      outside.navWidthAttr === "wide" &&
      outside.dockLeft === true &&
      outside.titlebarHeight === 40 &&
      outside.radiusLg === "8px" &&
      outside.shadowAttr === "flat" &&
      outside.motion === "none" &&
      outside.typeScaleAttr === "compact" &&
      outside.density === "compact" &&
      outside.backdropAttr === "grid",
    JSON.stringify({
      written: outsideWritten.json?.written,
      preview: outside?.preview,
      wing: outside?.wingFloating,
      domain: outside?.domainBottom,
      pill: outside?.domainPill,
      nav: outside?.navPlaceAttr,
      width: outside?.navWidthAttr,
      dockLeft: outside?.dockLeft,
      strip: outside?.titlebarHeight,
      radius: outside?.radiusLg,
      shadow: outside?.shadowAttr,
      motion: outside?.motion,
      type: outside?.typeScaleAttr,
      density: outside?.density,
      backdrop: outside?.backdropAttr,
    }),
  );

  const keptOutside = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const outsideKept = await waitFor(
    (s) => keptOutside === true && !s.preview && s.kept === "outside-theme.json",
    15_000,
  );
  check(
    "outside-theme-keeps-across-a-reload",
    keptOutside === true && outsideKept?.kept === "outside-theme.json",
    JSON.stringify({ kept: outsideKept?.kept }),
  );

  // The gate's second half: the app restarts wearing it, with the operator's
  // way out still painted — window controls, Settings entry, preview bar.
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterOutsideRestart = await waitFor(
    (s) =>
      s.shell &&
      s.kept === "outside-theme.json" &&
      s.wingFloating &&
      s.domainBottom &&
      s.navPlaceAttr === "floating" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.radiusLg === "8px" &&
      s.motion === "none" &&
      s.density === "compact" &&
      s.backdropAttr === "grid" &&
      s.settingsEntry &&
      s.stripPainted,
    25_000,
  );
  check(
    "outside-theme-survives-a-restart-with-its-way-out",
    afterOutsideRestart?.kept === "outside-theme.json" &&
      afterOutsideRestart.wingFloating === true &&
      afterOutsideRestart.navPlaceAttr === "floating" &&
      afterOutsideRestart.dockLeft === true &&
      afterOutsideRestart.titlebarHeight === 40 &&
      afterOutsideRestart.radiusLg === "8px" &&
      afterOutsideRestart.motion === "none" &&
      afterOutsideRestart.density === "compact" &&
      afterOutsideRestart.backdropAttr === "grid" &&
      afterOutsideRestart.settingsEntry === true &&
      afterOutsideRestart.stripPainted === true,
    JSON.stringify({
      kept: afterOutsideRestart?.kept,
      wing: afterOutsideRestart?.wingFloating,
      dockLeft: afterOutsideRestart?.dockLeft,
      strip: afterOutsideRestart?.titlebarHeight,
      radius: afterOutsideRestart?.radiusLg,
      motion: afterOutsideRestart?.motion,
      density: afterOutsideRestart?.density,
      settings: afterOutsideRestart?.settingsEntry,
      strip: afterOutsideRestart?.stripPainted,
    }),
  );

  const outsideShot = await win.webContents.capturePage();
  fs.writeFileSync(OUTSIDE_PNG, outsideShot.toPNG());

  const report = {
    ranAt: new Date().toISOString(),
    world,
    checks,
    failures,
    pass: failures.length === 0,
    artifacts: {
      preview: path.relative(desktopRoot, PREVIEW_PNG),
      kept: path.relative(desktopRoot, KEPT_PNG),
      floating: path.relative(desktopRoot, FLOATING_PNG),
      settings: path.relative(desktopRoot, SETTINGS_PNG),
      material: path.relative(desktopRoot, MATERIAL_PNG),
      layout: path.relative(desktopRoot, LAYOUT_PNG),
      variants: path.relative(desktopRoot, VARIANTS_PNG),
      sidebarRight: path.relative(desktopRoot, SIDEBAR_RIGHT_PNG),
      dockLeft: path.relative(desktopRoot, DOCK_LEFT_PNG),
      floatingRail: path.relative(desktopRoot, FLOATING_RAIL_PNG),
      outsideTheme: path.relative(desktopRoot, OUTSIDE_PNG),
      scene: path.relative(desktopRoot, SCENE_PNG),
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
