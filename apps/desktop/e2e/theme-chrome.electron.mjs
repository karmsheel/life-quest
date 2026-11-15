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
      (materialTheme.backdrop ?? "").includes("linear-gradient"),
    JSON.stringify({
      shadow: materialTheme?.shadowAttr,
      backdrop: materialTheme?.backdropAttr,
      typeScale: materialTheme?.typeScaleAttr,
      fontSize: materialTheme?.fontSize,
      durQuick: materialTheme?.durQuick,
      shadowSm: (materialTheme?.shadowSm ?? "").slice(0, 40),
      bg: (materialTheme?.backdrop ?? "").slice(0, 40),
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
  const overridden = await waitFor((s) => s.radiusLg === "8px");
  check(
    "operator-material-overrides-the-theme",
    pressedSharp === true && overridden?.radiusLg === "8px" && overridden.kept === "agent-written.json",
    JSON.stringify({ pressedSharp, radiusLg: overridden?.radiusLg, kept: overridden?.kept }),
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
    pressedReset === true && reset?.radiusLg === "28px" && reset.kept === "agent-written.json",
    JSON.stringify({ pressedReset, radiusLg: reset?.radiusLg, kept: reset?.kept }),
  );

  // ── 10: the operator's own chrome overrides, above the theme's ──────────
  const click = (testId) =>
    evaluate(`(() => {
      const b = document.querySelector('[data-testid="${testId}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
  const pressedWing = await click("chrome-wing-place-titlebar-left");
  const pressedDomain = await click("chrome-domain-place-bottom-center");
  const pressedNarrow = await click("chrome-nav-width-narrow");
  const overriddenChrome = await waitFor(
    (s) => s.wingTitlebar && !s.wingFloating && s.domainBottom && !s.domainBelow && s.navWidthAttr === "narrow",
  );
  check(
    "operator-chrome-overrides-the-theme",
    pressedWing === true &&
      pressedDomain === true &&
      pressedNarrow === true &&
      overriddenChrome?.wingTitlebar === true &&
      overriddenChrome.wingFloating === false &&
      overriddenChrome.domainBottom === true &&
      overriddenChrome.domainBelow === false &&
      overriddenChrome.navWidthAttr === "narrow",
    JSON.stringify({
      pressed: pressedWing && pressedDomain && pressedNarrow,
      wingTitlebar: overriddenChrome?.wingTitlebar,
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
    (s) => s.shell && s.kept === "agent-written.json" && s.wingTitlebar && s.domainBottom && s.navWidthAttr === "narrow",
    20_000,
  );
  check(
    "operator-chrome-survives-a-reload",
    afterChromeReload?.wingTitlebar === true &&
      afterChromeReload.domainBottom === true &&
      afterChromeReload.navWidthAttr === "narrow",
    JSON.stringify({
      wingTitlebar: afterChromeReload?.wingTitlebar,
      domainBottom: afterChromeReload?.domainBottom,
      nav: afterChromeReload?.navWidthAttr,
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
    (s) => s.wingFloating && !s.wingTitlebar && s.domainBelow && s.navWidthAttr === "wide",
  );
  check(
    "reset-returns-the-themes-chrome",
    pressedChromeReset === true &&
      resetChrome?.wingFloating === true &&
      resetChrome.wingTitlebar === false &&
      resetChrome.domainBelow === true &&
      resetChrome.navWidthAttr === "wide",
    JSON.stringify({
      pressed: pressedChromeReset,
      wingFloating: resetChrome?.wingFloating,
      domainBelow: resetChrome?.domainBelow,
      nav: resetChrome?.navWidthAttr,
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
