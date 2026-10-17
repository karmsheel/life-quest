/**
 * The cold-start rig: how long until the app is on screen, and what the app was
 * waiting for while it was not.
 *
 * Why this exists at all. Every other rig here answers "does the thing work".
 * None of them answers "how long did the operator look at a logo", and the two
 * are not the same question. On 2026-10-17 the whole app was painted and
 * interactive 0.8 seconds into the launch and the operator could not touch it
 * for 57 seconds, because the cold-start splash waited on the companion — and
 * the companion was restarting a Hermes host that was already serving, on every
 * single launch, because a root config that lists no `mcp_servers.lifequest` can
 * never carry the credential the restart was being justified by. No rig noticed:
 * each one waits for the screen it wants and never asks what was covering it in
 * the meantime.
 *
 * The world is throwaway and hermetic. A stub `hermes` is first on PATH, so the
 * operator's own Hermes install is never found and never restarted; HERMES_HOME
 * points inside the world, so no profile under the operator's home is written;
 * the vault and the app profile are the rig's own, on a companion profile name
 * (`lq-boot-probe`) no real install has. `bootForE2e` runs the REAL main
 * process, the REAL preload and the REAL renderer against them.
 *
 * The companion's own gateway is stood up in-process as a loopback HTTP server
 * on a free port, named by `API_SERVER_PORT` in the world's Hermes home, so "the
 * companion is already serving this profile" is a fact this rig controls rather
 * than a fact of the machine it happens to run on.
 *
 * Legs:
 *   `boot`    a first launch against a host that is already serving the profile.
 *   `warm`    the second launch of the same world, plus an ensure asked for by
 *             hand AFTER the vault is open — the one arrangement in which the
 *             credential check is guaranteed to run, and therefore the leg that
 *             can tell "already has this credential" from "must restart".
 *   `stalled` the host is down and every CLI call takes seconds: the splash must
 *             still stand down inside the floor's budget.
 *
 * Run by `tests/startup-boot-e2e.test.ts`, once per leg:
 *
 *   LQ_BOOT_WORLD=<dir> LQ_BOOT_LEG=warm <electron> e2e/startup-boot.electron.mjs
 *
 * Exit 0 = the leg's checks held. The report is
 * `e2e/artifacts/startup-boot-<leg>.json`; the test merges the legs into
 * `e2e/artifacts/startup-boot.json`.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const world = process.env.LQ_BOOT_WORLD;
const leg = process.env.LQ_BOOT_LEG ?? "cold";
const hostMode = process.env.LQ_BOOT_HOST ?? "up";
const stubSleepMs = Number(process.env.LQ_BOOT_STUB_SLEEP_MS ?? 0);

/**
 * How long the splash may stay up, on any leg.
 *
 * `SPLASH_FLOOR_MS` is 1500ms measured from `__LQ_SPLASH_T0`, which
 * `theme-boot.js` sets in the document head — so the budget is that floor plus
 * a poll interval (50ms), the fade (200ms), and the process's own start. A
 * companion that takes 12 seconds must not move this number.
 */
const SPLASH_CEILING_MS = 3000;
/** The renderer's own first paint: the bundle, not the companion, and it is small. */
const FIRST_PAINT_CEILING_MS = 2000;

/** The profile the app is pointed at — never `lifequest`, so no real one is touched. */
const PROBE_PROFILE = "lq-boot-probe";

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** `n` ports that were free a moment ago and are let go together. */
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

/**
 * The built renderer, over loopback.
 *
 * `isDev` is true for anything unpackaged, so the main process always loads a
 * URL and never `dist/index.html` off the disk. Serving the built assets is
 * therefore the only way to measure the startup an operator actually gets
 * without also measuring the Vite dev server, which is a development tool and
 * not part of the product's boot.
 */
function serveDist() {
  const dist = path.join(desktopRoot, "dist");
  return listen(
    http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      fs.createReadStream(file).pipe(res);
    }),
  );
}

/**
 * A Hermes host gateway that is serving this profile, and nothing else.
 *
 * `attachCandidateBaseUrls` asks `GET <base>/health` and then
 * `GET <base>/v1/capabilities`; both have to answer the way a healthy host does
 * or `tryAttach` walks on to the next candidate port — which on a developer's
 * machine is where the operator's own gateway lives, and the leg would then be
 * measuring their install instead of this one.
 */
function serveHostGateway(capabilities) {
  return listen(
    http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/health")) {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      if (url.pathname.endsWith("/v1/capabilities")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(capabilities));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    }),
  );
}

/**
 * The `hermes` on PATH. Every invocation is appended to the world's call log —
 * that log is how "the app restarted the host" becomes a number a test can
 * assert on, rather than something only visible in a process list.
 *
 * `gateway ...` exits non-zero, which is what a host that will not come up looks
 * like; every other subcommand succeeds, because seeding a profile is not the
 * thing under test.
 */
function writeHermesStub(binDir, callLog) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
      `sleep ${(stubSleepMs / 1000).toFixed(3)}`,
      'case "$1" in',
      "  gateway) exit 1 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return stub;
}

const SAMPLE = `(() => {
  const splash = document.getElementById("splash");
  const lead = document.querySelector(".welcome-lead");
  return {
    t: performance.now(),
    splashHidden: Boolean(splash && splash.hasAttribute("hidden")),
    rootPainted: (document.getElementById("root")?.children.length ?? 0) > 0,
    hasDashboard: Boolean(document.querySelector(".home-dashboard")),
    hasShell: Boolean(document.querySelector(".app-shell")),
    lead: lead ? lead.textContent.trim() : null,
  };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!world) throw new Error("LQ_BOOT_WORLD is required");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const callLog = path.join(world, "hermes-calls.log");

  const callsBefore = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean).length
    : 0;

  // ── The world ────────────────────────────────────────────────────────────
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir, callLog);

  let vaultId = "00000000-0000-0000-0000-000000000000";
  if (fs.existsSync(path.join(vaultDir, "lifequest.json"))) {
    vaultId = JSON.parse(fs.readFileSync(path.join(vaultDir, "lifequest.json"), "utf8")).id;
  } else {
    fs.mkdirSync(vaultDir, { recursive: true });
    const created = await createVault(vaultDir, "Startup Boot");
    if (!created.ok) throw new Error(`createVault: ${created.error}`);
    vaultId = created.value.lifequest.id;
  }

  // `companionProfile` is what moves the app off the real `lifequest` profile.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vaultId,
            name: "Startup Boot",
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

  // ── The servers, before anything imports the main process ────────────────
  const distPort = await serveDist();
  const hostPort =
    hostMode === "up"
      ? await serveHostGateway({
          features: {
            session_list: true,
            session_chat: true,
            session_chat_stream: true,
          },
        })
      : // A port with nothing behind it, so the app's own `/health` probes fail
        // the way they would on a host that is down.
        (await freePorts(1))[0];
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${hostPort}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
  );
  // A root config that exists and lists no `mcp_servers.lifequest` — the shape
  // every install has out of the box, and the shape the credential check used to
  // read as "stale" forever. Absent, the check cannot be exercised at all.
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n  provider: nous\n",
  );
  const [mcpLocalPort, mcpInvitePort] = await freePorts(2);

  // ── The environment the main process reads at import time ────────────────
  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${distPort}`;
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocalPort, invite: mcpInvitePort },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  // Time the boot's own IPC calls from the main side, without touching the
  // product: `companion:ensure` is the call the splash used to wait on, and its
  // duration is the number this whole rig exists to keep honest.
  const channelTimings = [];
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function (channel, listener) {
    return originalHandle(channel, async (event, ...args) => {
      const started = performance.now();
      try {
        return await listener(event, ...args);
      } finally {
        channelTimings.push({
          channel,
          durationMs: Math.round(performance.now() - started),
        });
      }
    });
  };

  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);

  await app.whenReady();
  const appReadyMs = at();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const windowLoadedMs = at();
  const win = await bootForE2e();

  // ── Watch the boot ───────────────────────────────────────────────────────
  const ensureDone = () => channelTimings.some((c) => c.channel === "companion:ensure");
  const deadline = Date.now() + 120_000;
  let firstPaintMs = null;
  let splashHiddenMs = null;
  let leadWhenRevealed = null;
  let last = null;
  while (Date.now() < deadline) {
    let sample = null;
    try {
      sample = await win.webContents.executeJavaScript(SAMPLE, true);
    } catch {
      sample = null;
    }
    if (sample) {
      last = sample;
      if (firstPaintMs === null && sample.rootPainted) firstPaintMs = at();
      if (splashHiddenMs === null && sample.splashHidden) {
        splashHiddenMs = at();
        leadWhenRevealed = sample.lead;
      }
      // Both legs end the same way: the splash is gone AND the companion has
      // answered. A stalled companion never reaches a dashboard, so waiting for
      // one would make this leg a claim about the machine's speed.
      if (splashHiddenMs !== null && ensureDone()) break;
    }
    await sleep(20);
  }

  const companionEnsureMs =
    channelTimings.find((c) => c.channel === "companion:ensure")?.durationMs ?? null;

  const readCalls = () =>
    fs.existsSync(callLog)
      ? fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean)
      : [];
  const calls = readCalls().slice(callsBefore);
  const ready = (last?.hasDashboard ?? false) || (last?.hasShell ?? false);

  /**
   * Ask the companion for its status again, by hand, once the vault is open.
   *
   * This is the only arrangement in which the credential check is guaranteed to
   * have a token to compare: `openVaultCompanionToken` answers null until a vault
   * is open, and at mount time the vault is usually still being opened — so the
   * launch's own ensure often returns before it looks at the credential at all,
   * and a rig that only watched the launch could not tell a fixed check from an
   * unexercised one. The call is the same `companion:ensure` the provider makes.
   */
  async function ensureWithVaultOpen() {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const up = await win.webContents
        .executeJavaScript(`Boolean(document.querySelector(".home-dashboard, .app-shell"))`, true)
        .catch(() => false);
      if (up) break;
      await sleep(50);
    }
    const before = readCalls().length;
    const started = performance.now();
    const answer = await win.webContents
      .executeJavaScript("window.lifequest.companionEnsure()", true)
      .catch((error) => ({ ok: false, error: String(error) }));
    return {
      durationMs: Math.round(performance.now() - started),
      invocations: readCalls().slice(before),
      kind: answer && typeof answer === "object" ? (answer.kind ?? null) : null,
    };
  }

  let handAsked = null;

  // ── What each leg is for ─────────────────────────────────────────────────
  check("the window loaded", windowLoadedMs > 0, `${windowLoadedMs}ms`);
  check(
    "the renderer painted before the splash stood down",
    firstPaintMs !== null && firstPaintMs <= FIRST_PAINT_CEILING_MS,
    `first paint at ${firstPaintMs}ms (ceiling ${FIRST_PAINT_CEILING_MS}ms)`,
  );
  check(
    "the splash stood down inside the floor's budget",
    splashHiddenMs !== null && splashHiddenMs <= SPLASH_CEILING_MS,
    `splash hidden at ${splashHiddenMs}ms (ceiling ${SPLASH_CEILING_MS}ms)`,
  );

  if (leg === "boot") {
    check("the companion attached", ready, `dashboard=${last?.hasDashboard} shell=${last?.hasShell}`);
  } else if (leg === "warm") {
    check("the companion attached", ready, `dashboard=${last?.hasDashboard} shell=${last?.hasShell}`);
    handAsked = await ensureWithVaultOpen();
    check(
      "the ensure the vault opened for answered ready",
      handAsked.kind === "ready",
      `companion:ensure answered ${JSON.stringify(handAsked.kind)}`,
    );
    // The regression this rig was written for. The profile config carries the
    // vault's token already; the root config exists and lists no lifequest
    // server, and never will. Asking the root for the header anyway made every
    // launch look like a fresh credential, so every launch ran two
    // `hermes config set`s and a `hermes gateway restart` — restarting a host
    // that was already serving, before the first paint.
    check(
      "an ensure against an already-credentialed profile spawns no hermes",
      handAsked.invocations.length === 0,
      `${handAsked.invocations.length} hermes invocations: ${JSON.stringify(handAsked.invocations)}`,
    );
  } else if (leg === "stalled") {
    check(
      "the companion did not attach",
      !ready,
      `the companion answered ready while its host was down (dashboard=${last?.hasDashboard})`,
    );
    check(
      "the companion really was slow",
      companionEnsureMs !== null && companionEnsureMs >= 2 * stubSleepMs,
      `companion:ensure took ${companionEnsureMs}ms with ${stubSleepMs}ms per CLI call`,
    );
    check(
      "the app's own boot surface was what the operator was left with",
      typeof leadWhenRevealed === "string" && leadWhenRevealed.length > 0,
      `no .welcome-lead when the splash went: ${JSON.stringify(leadWhenRevealed)}`,
    );
  } else {
    failures.push(`unknown leg ${leg}`);
  }

  const report = {
    leg,
    ranAt: new Date().toISOString(),
    world: { profileDir, vaultDir, hermesHome, host: hostMode, stubSleepMs },
    companion: {
      attached: ready,
      status: last === null ? "never sampled" : { hasShell: last.hasShell, hasDashboard: last.hasDashboard },
      leadWhenRevealed,
      leadAtEnd: last?.lead ?? null,
    },
    timings: {
      appReadyMs,
      windowLoadedMs,
      firstPaintMs,
      splashHiddenMs,
      companionEnsureMs,
      handAskedEnsureMs: handAsked?.durationMs ?? null,
    },
    splashCeilingMs: SPLASH_CEILING_MS,
    hermesInvocations: calls,
    handAskedInvocations: handAsked?.invocations ?? [],
    checks,
    failures,
    pass: failures.length === 0,
  };
  fs.writeFileSync(
    path.join(artifactsDir, `startup-boot-${leg}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  app.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
