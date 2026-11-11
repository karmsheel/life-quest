/**
 * The Nous girl's ink, in the real app, in both palettes.
 *
 * Why this exists. Hermes' mark is the Nous girl: one black ink on nothing,
 * shipped as an SVG and drawn in two places — the agent switcher's block in the
 * chat dock, and the collapsed dock's floating launcher. That single black was
 * fine on the day page and invisible at night, where the block and the launcher
 * button both step down toward the dark canvas. The fix is a white version of
 * the artwork at night: the launcher paints its mask white, and the image mark
 * inverts the same artwork. Day keeps exactly what it had.
 *
 * A colour that cannot be seen is a paint bug, so the report is not a stylesheet
 * read: the rig captures the real window, crops each mark 1:1, and counts the
 * ink pixels in the crop. Night's mark must be bright pixels on a dark field;
 * day's must be dark pixels on a light one. The computed paint (the launcher's
 * `color`, the image's `filter`) is recorded beside the pixels, so a report that
 * passes for the wrong reason is visible in the artifact.
 *
 * The world is hermetic and throwaway:
 *   - a throwaway app profile (`LIFEQUEST_E2E.userData`) and vault, created with
 *     the real `createVault`;
 *   - a fake OpenAI-compatible endpoint so the built-in companion is ready and
 *     the studio boots to the dock, not the setup pane;
 *   - a throwaway HERMES_HOME, so no real Hermes profile is read.
 *
 * Three legs, through the app's own controls:
 *   night   the stored `dark` preference; the dock open, then collapsed;
 *   day     a real click on the titlebar's theme control;
 *   system  the stored `system` preference under a dark OS preference — the
 *           palette with no `data-theme` attribute, where the CSS media query is
 *           the only thing asking for the white version.
 *
 * Artifacts:
 *   e2e/artifacts/nous-mark.json               the report
 *   e2e/artifacts/nous-mark-both-themes.png    the four crops, side by side
 *   e2e/artifacts/nous-mark-night-window.png   the whole window at night
 *   e2e/artifacts/nous-mark-day-window.png     the whole window by day
 *   e2e/artifacts/nous-mark-night-switcher.png / -night-launcher.png / ...
 *
 * Run by `tests/nous-mark-e2e.test.ts`, through the bench wrapper:
 *   /root/.local/bin/lifequest-e2e <checkout> tests/nous-mark-e2e.test.ts
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeTheme } from "electron";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "nous-mark.json");

/** The endpoint model the built-in companion is pointed at. */
const MODEL = "rig-model";
/** A profile name no real install has. */
const PROBE_PROFILE = "lq-nous-mark";
const DEV_SERVER_URL = "http://127.0.0.1:5173";

/**
 * The ink floors. A 33px block holding a portrait has hundreds of ink pixels;
 * these are deliberately far below that, so anti-aliasing, the accent ring and
 * the portrait's own gaps cannot turn a painted mark into a failed one. They
 * are only high enough that an invisible (field-coloured) mark cannot pass: on
 * night's dark block a black mark leaves no bright pixel at all.
 */
const MIN_INK_PIXELS = 40;
/** The window/launcher sizes are CSS px; capture is scaled by the display. */
const CROP_PAD = 3;

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** Two loopback ports, free for the rig's app to claim for its MCP doors. */
async function freePorts(n) {
  const servers = [];
  const ports = [];
  for (let index = 0; index < n; index += 1) {
    const server = http.createServer();
    ports.push(await listen(server));
    servers.push(server);
  }
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  return ports;
}

/** The fake OpenAI-compatible endpoint: enough for readiness, never a real turn. */
async function startFakePiEndpoint() {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(
          `data: ${JSON.stringify({
            id: "rig",
            object: "chat.completion.chunk",
            created: 0,
            model: MODEL,
            choices: [{ index: 0, delta: { content: "Rig reply." }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: "rig",
            object: "chat.completion.chunk",
            created: 0,
            model: MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return { server, port: await listen(server) };
}

/**
 * Bright and dark ink pixels in a NativeImage crop, plus its luminance range.
 * `toBitmap()` is the platform's raw order (BGRA here); the luminance weights
 * are applied in that order, which matters only for the accent's warm tint —
 * the marks themselves are greys, where channel order changes nothing.
 */
function analyse(image) {
  const bitmap = image.toBitmap();
  let bright = 0;
  let dark = 0;
  let maxLuma = 0;
  let minLuma = 255;
  let opaque = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    const a = bitmap[i + 3];
    if (a < 128) continue;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma > 200) bright += 1;
    if (luma < 80) dark += 1;
    if (luma > maxLuma) maxLuma = luma;
    if (luma < minLuma) minLuma = luma;
    opaque += 1;
  }
  return {
    pixels: opaque,
    brightPixels: bright,
    darkPixels: dark,
    maxLuma: Math.round(maxLuma),
    minLuma: Math.round(minLuma),
  };
}

/**
 * A 1:1 crop of one box, from the *whole window* capture: the full frame is the
 * capture path the other rigs prove reliable, and `crop` never rescales it.
 */
async function crop(win, box, name, scale) {
  const frame = await win.webContents.capturePage();
  const image = frame.crop({
    x: Math.max(0, Math.round((box.x - CROP_PAD) * scale)),
    y: Math.max(0, Math.round((box.y - CROP_PAD) * scale)),
    width: Math.round((box.width + CROP_PAD * 2) * scale),
    height: Math.round((box.height + CROP_PAD * 2) * scale),
  });
  fs.writeFileSync(path.join(artifactsDir, `${name}.png`), image.toPNG());
  return { image, ink: analyse(image) };
}

/** The marks as the page computed them: geometry, paint and the artwork URL. */
const READ_MARKS = `(async () => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const pills = [...document.querySelectorAll(".agent-switcher__pill")].map((el) => ({
    name: el.getAttribute("aria-label"),
    active: el.getAttribute("aria-checked") === "true",
    box: rect(el),
  }));
  const hermesPill = [...document.querySelectorAll(".agent-switcher__pill")].find(
    (el) => el.getAttribute("aria-label") === "Hermes",
  );
  const image = hermesPill
    ? hermesPill.querySelector('img[data-agent-mark="hermes"]')
    : null;
  const launcher = document.querySelector(".chat-launcher");
  const launcherMark = launcher ? launcher.querySelector(".chat-launcher__mark") : null;
  let decoded = false;
  if (image) {
    try {
      await image.decode();
      decoded = true;
    } catch {
      decoded = false;
    }
  }
  const style = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
  return {
    dataTheme: document.documentElement.getAttribute("data-theme"),
    skin: document.documentElement.getAttribute("data-skin"),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    switcher: {
      shown: Boolean(document.querySelector(".agent-switcher")),
      items: pills.map((pill) => pill.name),
      pills,
      hermes: image
        ? {
            box: rect(hermesPill),
            decoded,
            src: image.getAttribute("src"),
            filter: style(image, "filter"),
          }
        : null,
    },
    launcher: launcher
      ? {
          box: rect(launcher),
          color: style(launcher, "color"),
          background: style(launcher, "backgroundColor"),
          markMask: launcherMark
            ? style(launcherMark, "maskImage") || style(launcherMark, "webkitMaskImage")
            : null,
          label: launcher.getAttribute("aria-label"),
        }
      : null,
  };
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // ── The world ────────────────────────────────────────────────────────────
  const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-nous-mark-"));
  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });

  const created = await createVault(vaultDir, "Nous Mark");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);

  // The recent-vault record lands the renderer on the dashboard instead of
  // `/welcome`, and the probe profile keeps Hermes off the real install.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: created.value.lifequest.id,
            name: "Nous Mark",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROBE_PROFILE,
      },
      null,
      2,
    )}\n`,
  );

  const { server: piServer, port: piPort } = await startFakePiEndpoint();
  const piBaseUrl = `http://127.0.0.1:${piPort}/v1`;
  // The bench app is running beside this one; the rig's own app takes free
  // ports for its MCP doors rather than fighting the bench for the fixed pair.
  const [mcpLocalPort, mcpInvitePort] = await freePorts(2);
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.env.HERMES_HOME = hermesHome;
  process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocalPort, invite: mcpInvitePort },
  });

  // ── Boot the real app ────────────────────────────────────────────────────
  await app.whenReady();
  nativeTheme.themeSource = "dark";
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const js = (code) => win.webContents.executeJavaScript(code, true);

  const waitFor = async (label, predicate, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return true;
      } catch {
        // A reload destroys the execution context; retry until it is back.
      }
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  await waitFor("the preload bridge", () => js("Boolean(window.lifequest)"), 30_000);

  // Pi must be ready before the reload, or the studio boots to the setup pane
  // and the dock — the thing under test — never mounts.
  const configured = await js(`(async () => {
    const api = window.lifequest;
    const status = (value) => (value && value.kind) || "unknown";
    const settings = await api.companionPiSettingsSave({
      baseUrl: ${JSON.stringify(piBaseUrl)},
      model: ${JSON.stringify(MODEL)},
      providerName: "Rig endpoint",
    });
    const engaged = status(await api.companionUseHarness("pi"));
    const opened = await api.vaultOpen(${JSON.stringify(vaultDir)});
    return {
      settings: settings && settings.kind,
      engaged,
      openedOk: Boolean(opened && opened.ok),
    };
  })()`);

  // ── Night: the dock open, then collapsed ─────────────────────────────────
  const boot = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await boot;
  await waitFor(
    "the dock and both agent blocks",
    async () =>
      Boolean(
        await js(
          "document.querySelectorAll('.agent-switcher__pill').length >= 2 && Boolean(document.querySelector('.chat-panel'))",
        ),
      ),
  );
  await waitFor("the Hermes artwork", () =>
    js(`(async () => {
      const img = document.querySelector('img[data-agent-mark="hermes"]');
      if (!img) return false;
      try { await img.decode(); return true; } catch { return false; }
    })()`),
  );
  await sleep(700);

  const night = await js(READ_MARKS);
  const scale = (await win.webContents.capturePage()).getSize().width / night.viewport.width;
  const nightWindow = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "nous-mark-night-window.png"), nightWindow.toPNG());

  const nightSwitcher = await crop(win, night.switcher.hermes.box, "nous-mark-night-switcher", scale);

  // Collapse to the floating launcher, the other place the mark is worn.
  await js(`(() => {
    const collapse = document.querySelector('[data-testid="chat-collapse"]');
    if (collapse) collapse.click();
    return Boolean(collapse);
  })()`);
  await waitFor("the floating launcher", () => js("Boolean(document.querySelector('.chat-launcher'))"));
  await sleep(500);
  const nightCollapsed = await js(READ_MARKS);
  const nightLauncher = await crop(
    win,
    nightCollapsed.launcher.box,
    "nous-mark-night-launcher",
    scale,
  );

  // ── Day: a real click on the titlebar's theme control ────────────────────
  await js(`(() => {
    const toggle = document.querySelector(".theme-mode-toggle");
    if (toggle) toggle.click();
    return Boolean(toggle);
  })()`);
  await waitFor(
    "the day palette",
    async () => (await js("document.documentElement.getAttribute('data-theme')")) === "light",
  );
  await sleep(600);
  const dayCollapsed = await js(READ_MARKS);
  const dayLauncher = await crop(win, dayCollapsed.launcher.box, "nous-mark-day-launcher", scale);

  // Reopen the dock to measure the block by day.
  await js(`(() => {
    const launcher = document.querySelector(".chat-launcher");
    if (launcher) launcher.click();
    return Boolean(launcher);
  })()`);
  await waitFor(
    "the reopened dock",
    () => js("Boolean(document.querySelector('.agent-switcher')) && !document.querySelector('.chat-launcher')"),
  );
  await sleep(700);
  const day = await js(READ_MARKS);
  const dayWindow = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "nous-mark-day-window.png"), dayWindow.toPNG());
  const daySwitcher = await crop(win, day.switcher.hermes.box, "nous-mark-day-switcher", scale);

  // ── System: no `data-theme`, the media query is the only signal ──────────
  await js(`(() => {
    localStorage.setItem("lifequest-theme", "system");
    return true;
  })()`);
  const systemBoot = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await systemBoot;
  await waitFor(
    "the dock under the system preference",
    () =>
      js("Boolean(document.querySelector('.agent-switcher')) && document.documentElement.getAttribute('data-theme') === null"),
  );
  await sleep(700);
  const systemOpen = await js(READ_MARKS);
  // The launcher only exists while the dock is collapsed: read the block's
  // paint from the open dock, then collapse to read the button's ink.
  await js(`(() => {
    const collapse = document.querySelector('[data-testid="chat-collapse"]');
    if (collapse) collapse.click();
    return Boolean(collapse);
  })()`);
  await waitFor("the system-dark launcher", () => js("Boolean(document.querySelector('.chat-launcher'))"));
  await sleep(500);
  const systemCollapsed = await js(READ_MARKS);
  const systemNight = { ...systemOpen, launcher: systemCollapsed.launcher };

  // ── The artifact: the four crops, side by side ───────────────────────────
  const cells = [
    { label: "night · switcher", image: nightSwitcher.image },
    { label: "night · launcher", image: nightLauncher.image },
    { label: "day · switcher", image: daySwitcher.image },
    { label: "day · launcher", image: dayLauncher.image },
  ];
  const composed = await js(`(async () => {
    const cells = ${JSON.stringify(
      cells.map((cell) => ({
        label: cell.label,
        dataUrl: `data:image/png;base64,${cell.image.toPNG().toString("base64")}`,
      })),
    )};
    const drawn = [];
    for (const cell of cells) {
      drawn.push(await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ label: cell.label, image });
        image.onerror = reject;
        image.src = cell.dataUrl;
      }));
    }
    const tile = 128, pad = 14, caption = 20;
    const canvas = document.createElement("canvas");
    canvas.width = pad + drawn.length * (tile + pad);
    canvas.height = pad + tile + caption + pad;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#161514";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawn.forEach((cell, index) => {
      const x = pad + index * (tile + pad);
      // Contain, centred: a launcher circle and a block crop stay their own shape.
      const ratio = Math.min(tile / cell.image.width, tile / cell.image.height);
      const w = cell.image.width * ratio;
      const h = cell.image.height * ratio;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cell.image, x + (tile - w) / 2, pad + (tile - h) / 2, w, h);
      ctx.fillStyle = "#e8e4dc";
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(cell.label, x + tile / 2, pad + tile + 15);
    });
    return canvas.toDataURL("image/png");
  })()`);
  fs.writeFileSync(
    path.join(artifactsDir, "nous-mark-both-themes.png"),
    Buffer.from(String(composed).split(",")[1], "base64"),
  );

  // ── The verdict ──────────────────────────────────────────────────────────
  const checks = [];
  const check = (label, pass, detail) => checks.push({ label, pass: Boolean(pass), detail });
  const hermes = (leg) => leg.switcher.hermes;

  // `piSettingsSave` returns the ensure of whichever harness was active when it
  // ran — at first boot that can be Hermes, whose gateway this world does not
  // provide. The signal this rig needs is the explicit switch that follows and
  // the dock mounting on the reload after it.
  check("engaged a ready Pi and opened the vault", configured.engaged === "ready" && configured.openedOk, JSON.stringify(configured));
  check("the switcher offers Hermes and Pi", night.switcher.items.join(",") === "Hermes,Pi", JSON.stringify(night.switcher.items));
  check("the Hermes block decodes its artwork", hermes(night)?.decoded === true, JSON.stringify(hermes(night)?.src));
  check("night is the explicit dark palette", night.dataTheme === "dark", String(night.dataTheme));
  check("the night artwork is inverted to its white version", hermes(night)?.filter === "invert(1)", String(hermes(night)?.filter));
  check("the night block paints white ink", nightSwitcher.ink.brightPixels >= MIN_INK_PIXELS, JSON.stringify(nightSwitcher.ink));
  check("the night launcher paints its mask white", nightCollapsed.launcher?.color === "rgb(255, 255, 255)", String(nightCollapsed.launcher?.color));
  check("the night launcher paints white ink", nightLauncher.ink.brightPixels >= MIN_INK_PIXELS, JSON.stringify(nightLauncher.ink));
  check("the launcher is still the Nous girl", String(nightCollapsed.launcher?.markMask).includes("girl_steampunk"), String(nightCollapsed.launcher?.markMask));

  check("day is the explicit light palette", day.dataTheme === "light", String(day.dataTheme));
  check("the day artwork keeps the shipped black", hermes(day)?.filter === "none", String(hermes(day)?.filter));
  check("the day block paints dark ink", daySwitcher.ink.darkPixels >= MIN_INK_PIXELS, JSON.stringify(daySwitcher.ink));
  check("the day launcher keeps the shipped dark gray", dayCollapsed.launcher?.color === "rgb(51, 51, 51)", String(dayCollapsed.launcher?.color));
  check("the day launcher paints dark ink", dayLauncher.ink.darkPixels >= MIN_INK_PIXELS, JSON.stringify(dayLauncher.ink));

  check("the system dark palette carries no data-theme", systemNight.dataTheme === null, String(systemNight.dataTheme));
  check("the system dark artwork is inverted too", hermes(systemNight)?.filter === "invert(1)", String(hermes(systemNight)?.filter));
  check("the system dark launcher paints its mask white", systemNight.launcher?.color === "rgb(255, 255, 255)", String(systemNight.launcher?.color));

  const failures = checks.filter((entry) => !entry.pass);
  const report = {
    ok: failures.length === 0,
    world: { profile: profileDir, vault: vaultDir, piBaseUrl, devServer: DEV_SERVER_URL },
    configured,
    marks: {
      night: { state: night, ink: nightSwitcher.ink, launcher: { state: nightCollapsed, ink: nightLauncher.ink } },
      day: { state: day, ink: daySwitcher.ink, launcher: { state: dayCollapsed, ink: dayLauncher.ink } },
      systemNight,
    },
    captureScale: scale,
    checks,
    failures,
    screenshots: [
      "nous-mark-both-themes.png",
      "nous-mark-night-window.png",
      "nous-mark-day-window.png",
      "nous-mark-night-switcher.png",
      "nous-mark-night-launcher.png",
      "nous-mark-day-switcher.png",
      "nous-mark-day-launcher.png",
    ],
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log("nous mark:", report.ok ? "PASS" : "FAIL");
  for (const entry of checks) {
    console.log(`  ${entry.pass ? "ok  " : "FAIL"} ${entry.label} — ${entry.detail}`);
  }

  fs.rmSync(world, { recursive: true, force: true });
  piServer.close();
  app.exit(report.ok ? 0 : 1);
}

// A hung Electron process would hold the bench wrapper's lock until its own
// timeout, so the rig ends itself first and leaves the report to say where.
const watchdog = setTimeout(() => {
  console.error("nous mark rig: watchdog");
  app.exit(1);
}, 180_000);
watchdog.unref?.();

app.whenReady().then(main).catch((error) => {
  console.error("nous mark rig failed:", error);
  app.exit(1);
});
