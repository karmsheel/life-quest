/**
 * The launch is not a write — a theme that was already on disk when the window
 * opened is listed, never worn.
 *
 * The bug this rig pins down. On Windows a cold start of the real app can
 * receive a `theme:changed` before the window's own first read of the profile's
 * `themes/` directory has come back — the watch is armed when the window is
 * created, and the OS reports on it around the same moment the renderer asks
 * for the list. The renderer's preview gate compares each file's mtime with a
 * map that starts empty, so a change that lands before that first read has to
 * be answered with the files' own mtimes: every file looks new, the last one
 * becomes a preview, the operator watches a gallery theme they never asked for
 * get worn and then taken back ten seconds later.
 *
 * The rule the rig holds the shipped shell to: the session's first read is the
 * baseline. A change that arrives before it completes is folded into it — the
 * files are listed, nothing is worn. A write after the baseline still previews,
 * which is the half that would break if the gate were simply turned off.
 *
 * The world is throwaway: its own profile (pre-loaded with the bundled gallery,
 * exactly as an operator's profile holds it) and its own vault, a stub `hermes`
 * first on PATH, and its own MCP ports. `bootForE2e` runs the product's own
 * main process, preload and renderer, so this is the shipped shell.
 *
 * The cold start is made repeatable rather than hoped for: the session's first
 * `readdir` of the profile's `themes/` directory is held open — a cold disk can
 * do the same — until the shell is on screen and the `theme:changed` has been
 * answered by a second read. Those two reads are the race: the second is the
 * one that would wear a theme on a shell that has no baseline yet.
 *
 * Run with the checkout's dev server up (`lifequest-e2e` does both):
 *
 *   node e2e/theme-launch.electron.mjs
 *
 * Exit 0 = every check held. The report is `e2e/artifacts/theme-launch.json`;
 * the pictures are `theme-launch-quiet.png`, `theme-launch-gallery.png` and
 * `theme-launch-late.png`.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createVault } from "@lifequest/vault-core";
import { SHOWCASE_THEMES } from "../shared/showcase-themes.ts";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const DEV_URL = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173";

const REPORT = path.join(artifactsDir, "theme-launch.json");
const QUIET_PNG = path.join(artifactsDir, "theme-launch-quiet.png");
const GALLERY_PNG = path.join(artifactsDir, "theme-launch-gallery.png");
const LATE_PNG = path.join(artifactsDir, "theme-launch-late.png");

/** How long the launch is watched for a theme that should never appear. */
const QUIET_WINDOW_MS = 2500;

const checks = [];
const failures = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold every listing of the profile's themes directory, and let them go in the
 * order the rig chooses.
 *
 * This is a property of the machine, not of the app: a cold start's first read
 * of a directory is not instantaneous, and the rig has to guarantee that the
 * change it sends is answered *before* the session's first read comes back.
 * The rig patches Node's shared `fs.promises` object, so the product's own
 * `theme:list` handler waits — no product seam is involved and the handler
 * under test is shipped.
 *
 * The held reads are released newest-first on purpose. Development React mounts
 * the provider twice, so several reads can be parked here; the newest one is the
 * read the `theme:changed` provoked, and releasing it first is exactly the order
 * a slow cold read produces on its own.
 */
function holdThemeListings(themesDir) {
  const target = path.resolve(themesDir);
  const realReaddir = fs.promises.readdir;
  const listings = [];
  /** Once released, later reads pass straight through: only the launch is held. */
  let holding = true;
  let resolveFirst;
  const firstStarted = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  fs.promises.readdir = async (dir, options) => {
    if (holding && path.resolve(String(dir)) === target) {
      const entry = { at: Date.now(), index: listings.length + 1 };
      const gate = new Promise((resolve) => {
        entry.release = resolve;
      });
      listings.push(entry);
      if (listings.length === 1) resolveFirst();
      await gate;
    }
    return realReaddir(dir, options);
  };
  return {
    firstStarted,
    listings,
    releaseNewest() {
      const newest = listings.filter((entry) => !entry.released).pop();
      if (!newest) return false;
      newest.released = true;
      newest.release();
      return true;
    },
    releaseAll() {
      holding = false;
      for (const entry of listings) {
        if (entry.released) continue;
        entry.released = true;
        entry.release();
      }
    },
  };
}

/** A Hermes host gateway that is serving this profile, and nothing else. */
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
  await Promise.all(held.map((server) => new Promise((r) => server.close(r))));
  return ports;
}

/** The `hermes` on PATH: succeeds for seeding, never brings a host up. */
function writeHermesStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "hermes"),
    ["#!/bin/sh", 'case "$1" in', "  gateway) exit 1 ;;", "esac", "exit 0", ""].join(
      "\n",
    ),
    { mode: 0o755 },
  );
}

/**
 * One look at the shell: the preview gate's bar, the chrome the operator can
 * actually see, and whether the app is on screen at all.
 */
const SAMPLE = `(() => {
  const bar = document.querySelector('[data-testid="theme-preview-bar"]');
  return {
    shell: Boolean(document.querySelector(".shell")),
    preview: Boolean(bar),
    previewText: bar ? bar.textContent.replace(/\\s+/g, " ").trim() : null,
    railWings: Boolean(document.querySelector(".nav-rail__wings-band")),
    wingTitlebar: Boolean(document.querySelector('[data-chrome-place="titlebar-left"]')),
    wingFloating: Boolean(document.querySelector('[data-chrome-place="floating-left"]')),
    domainBottom: Boolean(document.querySelector('[data-chrome-place="bottom-center"]')),
  };
})()`;

const DEFAULT_CHROME = (sample) =>
  sample &&
  sample.shell === true &&
  sample.railWings === true &&
  sample.wingTitlebar === false &&
  sample.wingFloating === false &&
  sample.domainBottom === false;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const world = process.env.LQ_LAUNCH_WORLD;
  if (!world) throw new Error("LQ_LAUNCH_WORLD is not set");
  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const themesDir = path.join(profileDir, "themes");

  // ── The world ────────────────────────────────────────────────────────────
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir);

  fs.mkdirSync(vaultDir, { recursive: true });
  const created = await createVault(vaultDir, "Theme Launch");
  if (!created.ok) throw new Error(`createVault: ${created.error}`);

  // The bundled gallery is on disk before the window exists, which is the
  // operator's profile after its first launch: files to list, nothing kept.
  fs.mkdirSync(themesDir, { recursive: true });
  for (const theme of SHOWCASE_THEMES) {
    fs.writeFileSync(
      path.join(themesDir, `${theme.name}.json`),
      `${JSON.stringify(theme, null, 2)}\n`,
    );
  }
  fs.writeFileSync(
    path.join(profileDir, "theme-state.json"),
    `${JSON.stringify(
      {
        keptFile: null,
        seededShowcase: SHOWCASE_THEMES.map((theme) => theme.name),
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: created.value.lifequest.id,
            name: "Theme Launch",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: "lq-launch-probe",
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

  // The cold read is held before the product's main process is imported, so the
  // very first listing the renderer asks for is the one that waits.
  const listing = holdThemeListings(themesDir);

  // ── The real app ─────────────────────────────────────────────────────────
  await app.whenReady();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const consoleLines = [];
  win.webContents.on("console-message", (_event, level, message) => {
    consoleLines.push(`[${level}] ${message}`);
  });

  const evaluate = (source) => win.webContents.executeJavaScript(source, true);
  const sample = () => evaluate(SAMPLE);

  // The session's own first read, in flight and held. Without it no
  // "no preview" check below would mean anything.
  const listingBeganAt = Date.now();
  const listingHeld = await Promise.race([
    listing.firstStarted.then(() => true),
    sleep(20_000).then(() => false),
  ]);
  check(
    "the-renderer-reads-the-theme-directory-at-launch",
    listingHeld,
    listingHeld ? null : "no readdir of the profile's themes directory arrived",
  );
  if (!listingHeld) throw new Error("the session never read the theme directory");
  const firstReadAt = Date.now();

  /*
   * Wait for the provider to be mounted before waking it. The subscription and
   * the first read are made in the same effect, so a shell on screen means a
   * receiver; sending before it exists would be a lost event and every "no
   * preview" below would be a check that never had a chance to fail.
   */
  let shellUp = null;
  for (let i = 0; i < 150; i += 1) {
    shellUp = await sample();
    if (shellUp.shell) break;
    await sleep(80);
  }
  check(
    "the-launch-still-shows-the-shell",
    shellUp?.shell === true,
    JSON.stringify(shellUp),
  );
  if (!shellUp?.shell) throw new Error("the shell never mounted");
  await sleep(120);

  // The event a cold Windows start hands the window: the watch reports, the
  // renderer re-reads, and (before the baseline) no file's mtime is known yet.
  const beforeEvent = listing.listings.length;
  const eventAt = Date.now();
  win.webContents.send("theme:changed");
  let eventRead = null;
  for (let i = 0; i < 100; i += 1) {
    const next = listing.listings.slice(beforeEvent);
    if (next.length > 0) {
      eventRead = next[next.length - 1];
      break;
    }
    await sleep(80);
  }
  check(
    "the-early-change-reaches-the-renderer",
    eventRead !== null,
    eventRead
      ? null
      : `no listing followed the change (${listing.listings.length} before it)`,
  );

  /*
   * Let the read the change provoked answer first — that is the cold start's
   * order, and a shell with no baseline then has nothing to compare against, so
   * on the old gate every file looks new. The session's other reads are released
   * straight after; on the fixed shell the first one to answer is the baseline
   * and the rest find nothing changed.
   */
  listing.releaseNewest();
  await sleep(250);
  listing.releaseAll();
  await sleep(200);

  // ── 1: nothing is worn while the launch settles ───────────────────────────
  const samples = [];
  const quietUntil = Date.now() + QUIET_WINDOW_MS;
  while (Date.now() < quietUntil) {
    samples.push(await sample());
    await sleep(80);
  }
  const worn = samples.filter((s) => s.preview);
  const late = samples[samples.length - 1] ?? null;
  check(
    "an-early-wake-does-not-wear-a-theme",
    worn.length === 0 && DEFAULT_CHROME(late),
    JSON.stringify({
      previews: worn.map((s) => s.previewText),
      chrome: late,
      samples: samples.length,
    }),
  );
  const quietShot = await win.webContents.capturePage();
  fs.writeFileSync(QUIET_PNG, quietShot.toPNG());

  // ── 2: the files are listed, not worn ────────────────────────────────────
  const listed = await evaluate(`(async () => {
    location.hash = "#/customizations";
    for (let i = 0; i < 100; i += 1) {
      if (document.querySelector(".customization-card")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const cards = [...document.querySelectorAll(".customization-card")];
    return {
      count: cards.length,
      files: cards.map((card) => card.getAttribute("data-testid")),
      gallery: document.querySelectorAll('[data-testid="customization-gallery-chip"]').length,
      previewing: document.querySelectorAll('[data-testid="customization-previewing"]').length,
      active: document.querySelectorAll('[data-testid="customization-active"]').length,
    };
  })()`);
  check(
    "the-gallery-is-listed-and-nothing-is-active",
    listed.count === SHOWCASE_THEMES.length &&
      listed.gallery === SHOWCASE_THEMES.length &&
      listed.previewing === 0 &&
      listed.active === 0,
    JSON.stringify(listed),
  );
  const galleryShot = await win.webContents.capturePage();
  fs.writeFileSync(GALLERY_PNG, galleryShot.toPNG());

  // ── 3: a write after the baseline still previews ─────────────────────────
  const lateTheme = {
    ...SHOWCASE_THEMES[0],
    name: "late-arrival",
    label: "Late Arrival",
    description: "Written after the launch settled; the preview gate must still ask.",
  };
  fs.writeFileSync(
    path.join(themesDir, "late-arrival.json"),
    `${JSON.stringify(lateTheme, null, 2)}\n`,
  );
  let preview = null;
  const previewUntil = Date.now() + 8_000;
  while (Date.now() < previewUntil) {
    const now = await sample();
    if (now.preview) {
      preview = now;
      break;
    }
    await sleep(80);
  }
  check(
    "a-write-after-the-baseline-still-previews",
    Boolean(preview) &&
      (preview.previewText ?? "").includes("late-arrival.json") &&
      preview.wingFloating === true &&
      preview.domainBottom === true &&
      preview.railWings === false,
    JSON.stringify(preview),
  );
  const lateShot = await win.webContents.capturePage();
  fs.writeFileSync(LATE_PNG, lateShot.toPNG());

  // Leave the shell the way it was; the preview bar is the operator's own way
  // back, and pressing it is what the ten seconds would have done anyway.
  const reverted = await evaluate(`(async () => {
    const button = document.querySelector('[data-testid="theme-revert"]');
    if (!button) return null;
    button.click();
    for (let i = 0; i < 60; i += 1) {
      if (!document.querySelector('[data-testid="theme-preview-bar"]')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const bar = document.querySelector('[data-testid="theme-preview-bar"]');
    return {
      bar: Boolean(bar),
      railWings: Boolean(document.querySelector(".nav-rail__wings-band")),
      wingTitlebar: Boolean(document.querySelector('[data-chrome-place="titlebar-left"]')),
      domainBottom: Boolean(document.querySelector('[data-chrome-place="bottom-center"]')),
    };
  })()`);
  check(
    "revert-hands-the-launch-look-back",
    reverted?.bar === false &&
      reverted.railWings === true &&
      reverted.wingTitlebar === false &&
      reverted.domainBottom === false,
    JSON.stringify(reverted),
  );

  const report = {
    ranAt: new Date().toISOString(),
    world,
    checks,
    failures,
    pass: failures.length === 0,
    firstReadWaitedMs: firstReadAt - listingBeganAt,
    eventAfterFirstReadStartedMs: eventAt - firstReadAt,
    themeDirectoryListings: listing.listings.map((entry) => ({
      at: entry.at,
      index: entry.index,
      answeredAfterEvent: eventRead ? entry.index >= eventRead.index : null,
    })),
    artifacts: {
      quiet: path.relative(desktopRoot, QUIET_PNG),
      gallery: path.relative(desktopRoot, GALLERY_PNG),
      late: path.relative(desktopRoot, LATE_PNG),
    },
    consoleLines: consoleLines.slice(-20),
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
