/**
 * The model probe: does a profile whose pinned model is gone say so, and does it
 * say so without holding the app's boot?
 *
 * WHY THIS EXISTS AT ALL
 *
 * The retried-model warning shipped without ever being able to fire. The probe
 * fetched the provider's `/models` with `API_SERVER_KEY` — the credential this
 * app mints for the host's loopback API server, not anything the provider
 * knows — and it was wired as an `io.checkModel` that takes three arguments to a
 * function that needs four, so `fetchImpl` was `undefined` and the call threw
 * into its own `catch` before a byte left the machine. Every launch reported
 * "unreachable" and nothing ever warned; `tsc` had been saying so at
 * `companion.ts:431` the whole time.
 *
 * The probe now asks the HOST for its own model inventory — `GET
 * /api/model/options`, the list the composer's model menu is built from, with a
 * key this app does hold — and it runs AFTER the ready status is published,
 * because that round-trip measured 579ms on a real profile and the splash must
 * not pay it (see the cold-start spec, 2026-10-17).
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The probe never runs, and "no warning" is read as "the model is fine".
 *      The fake host counts its `/api/model/options` requests and every leg
 *      fails if that count is zero.
 *   2. The rig attaches to the operator's real host, or the operator's Hermes.
 *      HERMES_HOME is a temp dir, a stub `hermes` is first on PATH, and the
 *      profile is one no real install has (`lq-model-probe`).
 *   3. The warning is in the ready status, which would mean the probe held the
 *      boot — the exact regression this change is not allowed to reintroduce.
 *      The first push on every leg must carry no warning, and on the retired
 *      leg the warning's push must land at least 2s later than the catalog delay.
 *   4. The rig reads a value the app never published. Everything asserted here
 *      arrives on `companion:statusChanged`, over the real preload bridge, from
 *      the real `companion.ts`.
 *   5. A catalog that cannot judge is read as a verdict. The `unknown` leg serves
 *      the pinned provider unauthenticated: no credential on the host is not the
 *      same fact as a model that no longer exists, and must stay silent.
 *
 * Run by `tests/model-probe-e2e.test.ts`, once per leg:
 *
 *   LQ_PROBE_WORLD=<dir> LQ_PROBE_LEG=retired <electron> e2e/model-probe.electron.mjs
 *
 * Exit 0 = the leg's checks held. The report is
 * `e2e/artifacts/model-probe-<leg>.json`; the test merges the legs into
 * `e2e/artifacts/model-probe.json`.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const world = process.env.LQ_PROBE_WORLD;
const leg = process.env.LQ_PROBE_LEG ?? "retired";
const catalogDelayMs = Number(process.env.LQ_PROBE_CATALOG_DELAY_MS ?? 3000);

const PROBE_PROFILE = "lq-model-probe";
const PINNED_MODEL = "retired-model-7";
const LIVE_MODEL = "model-a";

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

/**
 * The catalog each leg serves.
 *
 * The payload is the host's own shape — `{providers, provider, model}` — because
 * `modelCatalogFromPayload` is the function under test as much as the verdict
 * is: a rig that served the reduced shape could pass while the real payload
 * failed to reduce.
 */
function catalogFor(which) {
  const base = (authenticated, models) => ({
    provider: "nous",
    model: which === "live" ? LIVE_MODEL : PINNED_MODEL,
    providers: [
      { slug: "nous", name: "Nous", authenticated, models },
      { slug: "openrouter", name: "OpenRouter", authenticated: false, models: ["other/model"] },
    ],
  });
  if (which === "retired") return base(true, ["model-a", "model-b"]);
  if (which === "live") return base(true, [LIVE_MODEL, "model-b"]);
  // "unknown": the provider the profile is pinned to carries no credential on
  // this host, so its model list proves nothing about the pinned id.
  return base(false, []);
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function freePorts(n) {
  const held = [];
  const ports = [];
  for (let i = 0; i < n; i += 1) {
    const server = net.createServer();
    ports.push(await listen(server));
    held.push(server);
  }
  await Promise.all(held.map((s) => new Promise((r) => s.close(r))));
  return ports;
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The built renderer, over loopback — the same boot the operator gets. */
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
 * The host gateway, including the one endpoint this rig is about.
 *
 * `/api/model/options` answers after `catalogDelayMs` on purpose: the delay is
 * what proves the verdict is not on the ready path. Every request is counted, so
 * "the probe never ran" cannot pass as "the model is fine".
 */
function serveHostGateway(catalogDelayMsArg, catalog) {
  const state = { catalogRequests: 0, catalogAnsweredAt: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname.endsWith("/v1/capabilities")) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          features: { session_list: true, session_chat: true, session_chat_stream: true },
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/api/model/options")) {
      state.catalogRequests += 1;
      setTimeout(() => {
        state.catalogAnsweredAt.push(Date.now());
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(catalog));
      }, catalogDelayMsArg);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  return listen(server).then((port) => ({ port, state, server }));
}

/** The `hermes` on PATH: records nothing, refuses nothing it does not have to. */
function writeHermesStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return stub;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!world) throw new Error("LQ_PROBE_WORLD is required");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir);

  // Deliberately no vault: the app opens on Welcome, the chat composer never
  // mounts, and the only caller of `/api/model/options` left is the probe. With
  // a vault open the composer asks for the same catalog for its model menu, and
  // "the probe ran" would stop being an assertion — the count would reach one
  // whether or not the probe existed.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROBE_PROFILE,
      },
      null,
      2,
    )}\n`,
  );

  const distPort = await serveDist();
  const host = await serveHostGateway(catalogDelayMs, catalogFor(leg));
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${host.port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
  );
  fs.writeFileSync(path.join(hermesHome, "config.yaml"), "model:\n  default: some-model\n");
  const [mcpLocalPort, mcpInvitePort] = await freePorts(2);

  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${distPort}`;
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocalPort, invite: mcpInvitePort },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  await app.whenReady();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const bootAt = at();

  // The status the app published for the mount's own ensure, before any probe
  // could have answered, and a recorder for everything published afterwards.
  const install = `(() => {
    window.__lqModel = { events: [] };
    window.__lqModel.headingAtInstall = document.querySelector(".welcome-card h1")?.textContent?.trim() ?? null;
    window.lifequest.onCompanionStatusChanged((status) => {
      window.__lqModel.events.push({ at: performance.now(), status });
    });
    return true;
  })()`;
  await win.webContents.executeJavaScript(install, true);

  // Wait for the catalog to have been asked for, and for its answer to have had
  // time to land as a push. A leg whose catalog is never asked for fails below.
  // The surface on screen is the measurement that matters: `ensuring` is what
  // `AppRoutes` gates the studio on, so while the ensure's promise is
  // outstanding the operator is looking at "Connecting to your LifeQuest
  // companion…" no matter how early the status was pushed. `WelcomePage`'s
  // heading is "LifeQuest"; the setup screen's is "LifeQuest companion".
  const headingNow = () =>
    win.webContents
      .executeJavaScript(
        'document.querySelector(".welcome-card h1")?.textContent?.trim() ?? null',
        true,
      )
      .catch(() => null);
  const bootHeading = await headingNow();
  let appScreenAt = bootHeading === "LifeQuest" ? at() : null;

  const settleMs = catalogDelayMs + 2_500;
  const deadline = Date.now() + settleMs;
  let events = [];
  while (Date.now() < deadline) {
    events = await win.webContents
      .executeJavaScript("window.__lqModel.events", true)
      .catch(() => []);
    if (appScreenAt === null) {
      const heading = await headingNow();
      if (heading === "LifeQuest") appScreenAt = at();
    }
    const warned = events.some((e) => e.status && e.status.modelWarning);
    if (warned) break;
    await sleep(100);
  }
  // Give a silent leg its whole window: "no warning" is only meaningful after
  // the catalog has had every chance to produce one.
  if (!events.some((e) => e.status && e.status.modelWarning)) {
    await sleep(catalogDelayMs);
    events = await win.webContents
      .executeJavaScript("window.__lqModel.events", true)
      .catch(() => []);
  }

  const finalStatus = await win.webContents
    .executeJavaScript("window.lifequest.companionStatus()", true)
    .catch(() => null);
  const { headingAtInstall } = await win.webContents
    .executeJavaScript("window.__lqModel", true)
    .catch(() => ({}));

  const readyEvents = events.filter((e) => e.status && e.status.kind === "ready");
  const warnedEvents = events.filter((e) => e.status && e.status.modelWarning);
  const firstReadyAt = readyEvents[0]?.at ?? null;
  const firstWarnedAt = warnedEvents[0]?.at ?? null;

  // ── What every leg must hold ─────────────────────────────────────────────
  check(
    "the probe asked the host exactly once",
    host.state.catalogRequests === 1,
    `${host.state.catalogRequests} requests to /api/model/options (expected 1)`,
  );
  check(
    "the app attached",
    finalStatus && finalStatus.kind === "ready",
    `final status ${JSON.stringify(finalStatus && finalStatus.kind)}`,
  );
  // The FIRST ready status is the one the boot is judged by: it must not carry
  // a verdict the host had not answered for yet.
  check(
    "the first ready status carried no warning",
    readyEvents.length > 0 && !readyEvents[0].status.modelWarning,
    `${readyEvents.length} ready pushes; the first ${readyEvents[0]?.status.modelWarning ? "carried" : "did not carry"} a warning`,
  );
  // The probe is held for `catalogDelayMs` on purpose. The app's own screen must
  // be up well inside that: an ensure that stops to ask about the model is the
  // 57-second splash with a shorter delay.
  check(
    "the app's own screen was up without waiting for the catalog",
    appScreenAt !== null && appScreenAt - bootAt <= 1500,
    `the app's screen appeared ${appScreenAt === null ? "never" : `${appScreenAt - bootAt}ms`} after the window loaded, with the catalog held ${catalogDelayMs}ms`,
  );

  if (leg === "retired") {
    check(
      "a warning was pushed",
      warnedEvents.length > 0,
      `${warnedEvents.length} pushing statuses carried a warning`,
    );
    check(
      "the warning names the pinned model",
      warnedEvents.some((e) => String(e.status.modelWarning).includes(PINNED_MODEL)),
      `warning text: ${JSON.stringify(warnedEvents[0]?.status.modelWarning ?? null)}`,
    );
    // The probe is a round-trip the boot must not pay. The catalog is held for
    // `catalogDelayMs`, so a warning that arrived sooner than that would have
    // been in the ready status.
    const gap = firstWarnedAt !== null && firstReadyAt !== null ? firstWarnedAt - firstReadyAt : null;
    check(
      "the warning arrived after the ready status, not with it",
      gap !== null && gap >= catalogDelayMs * 0.8,
      `warning ${gap}ms after ready (catalog held ${catalogDelayMs}ms)`,
    );
    check(
      "the status the app now reports carries the warning",
      Boolean(finalStatus && finalStatus.modelWarning),
      `companionStatus() reported ${JSON.stringify(finalStatus && finalStatus.modelWarning)} after the push`,
    );
  } else if (leg === "live") {
    check(
      "a model that is still listed warned about nothing",
      warnedEvents.length === 0,
      `pushed a warning for a live model: ${JSON.stringify(warnedEvents[0]?.status.modelWarning ?? null)}`,
    );
  } else if (leg === "unknown") {
    check(
      "a catalog that cannot judge warned about nothing",
      warnedEvents.length === 0,
      `pushed a warning from an unjudgeable catalog: ${JSON.stringify(warnedEvents[0]?.status.modelWarning ?? null)}`,
    );
  } else {
    failures.push(`unknown leg ${leg}`);
  }

  const report = {
    leg,
    ranAt: new Date().toISOString(),
    world: { profileDir, vaultDir, hermesHome, catalogDelayMs },
    expected: { pinnedModel: PINNED_MODEL, liveModel: LIVE_MODEL },
    host: { catalogRequests: host.state.catalogRequests, catalogAnsweredAt: host.state.catalogAnsweredAt },
    timings: { bootAt, firstReadyAt, firstWarnedAt, appScreenAt, bootHeading, headingAtInstall },
    pushes: events.map((e) => ({
      at: e.at,
      kind: e.status?.kind ?? null,
      modelWarning: e.status?.modelWarning ?? null,
    })),
    finalStatus: finalStatus ? { kind: finalStatus.kind, modelWarning: finalStatus.modelWarning ?? null } : null,
    checks,
    failures,
    pass: failures.length === 0,
  };
  fs.writeFileSync(
    path.join(artifactsDir, `model-probe-${leg}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  host.server.close();
  app.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
