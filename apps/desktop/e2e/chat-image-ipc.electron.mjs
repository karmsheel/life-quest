/**
 * The real app process's picture read door: `chat:imageRead` through the built
 * preload bridge, against a live vault this rig created and opened.
 *
 * What this answers that no other rig does: the harness page stubs the bridge
 * and the bundled-module leg calls `readChatImage` directly, so neither would
 * notice a missing IPC channel, a preload that never exposed the method, a
 * `vault-service` entry that throws on a closed vault, or a main handler that
 * resolves the wrong profile home. AGENTS requires a changed IPC channel and
 * preload to be verified against the restarted real process; this is that leg.
 *
 * The world is hermetic and far from the operator's:
 *   - a throwaway Electron profile set through the e2e seam before main is
 *     imported (and checked after import, so a seam-less bundle refuses to boot
 *     rather than opening the real profile);
 *   - a throwaway `HERMES_HOME` with the real `hermes` CLI removed from PATH, so
 *     the app's companion probe cannot attach to the operator's running gateway;
 *   - two free MCP door ports, so this app binds its own doors instead of
 *     fighting the bench app for 8643/8646;
 *   - this checkout's own built `dist/` served over loopback, so the renderer is
 *     the code under test rather than whichever branch is on the bench.
 *
 * The picture itself is the same real 120×80 PNG the harness page serves: it is
 * written into the created vault from node, then read back through
 * `window.lifequest.chatImageRead` — relative, absolute, and refused.
 *
 * Artifacts:
 *   e2e/artifacts/chat-image-ipc.json  the report (written even on throw)
 *   e2e/artifacts/chat-image-ipc.png   the shipped shell with this vault open
 *
 * Exit code 0 = every check held.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

// An occluded window stops painting; a rig that stops painting hands
// `capturePage()` the compositor's error instead of a picture.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "chat-image-ipc.json");
const SHOT = path.join(artifactsDir, "chat-image-ipc.png");
const VAULT = path.join(artifactsDir, "ipc-vault");
const userDataDir = path.join(artifactsDir, "userdata", "chat-image-ipc");
const hermesHome = path.join(artifactsDir, "ipc-hermes-home");
const NOTES = "notes.txt";
const PICTURE = "attachments/chat/present-ipc.png";

/**
 * The picture the app is asked to draw: a real 120×80 PNG, the same fixture the
 * harness page serves, carried as base64 so the rig writes bytes it knows are a
 * picture rather than a file that only has the extension.
 */
const MODEL = "rig-model";

const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAYAAADSm7GJAAAA8klEQVR42u3doQ2AMBRF0S6GrGEKJkB3PDbAsQ4EhSGhCAQvR9wqTHtQvwmUsQ67civnsq2LAgMMWIAFWIAFWJ8At3mK6OkwEvfVDfz3N7kXOG1fgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwY8PWMzygFAycGGDBgwIABAwYMGDBgwIABG3QYVRpVAgYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABvwL2e9ng60KFX/gLsAALsAALsO6AldsBUAl2ewlaRXQAAAAASUVORK5CYII=";
const FIXTURE_PNG = new Uint8Array(Buffer.from(FIXTURE_PNG_BASE64, "base64"));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

const scenarios = [];
const failures = [];
const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** Distinct ports nothing else holds right now, one probe per port. */
function freePorts(count) {
  const servers = Array.from({ length: count }, () => http.createServer());
  return Promise.all(servers.map((server) => listen(server))).then((ports) => {
    servers.forEach((server) => server.close());
    return ports;
  });
}

/**
 * This checkout's built renderer, over loopback.
 *
 * A shared dev server would make the window show whichever branch the bench is
 * on; serving `dist/` is the only way the shipped shell in the picture is the
 * code under test. `main.ts` always loads `VITE_DEV_SERVER_URL` when unpackaged.
 */
function serveDist() {
  const dist = path.join(desktopRoot, "dist");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/**
 * A loopback OpenAI-compatible model list, so the built-in companion can reach
 * `ready` and the studio opens its shell.
 *
 * The studio may not open without a ready companion (LAWS/COMPANION.md), and
 * the built-in one probes `/models` to decide. Nothing here answers a chat: the
 * rig never runs a turn, it just needs the shell on screen for the artifact.
 */
function startModelEndpoint() {
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    res.setHeader("content-type", "application/json");
    if (pathname.endsWith("/models")) {
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/**
 * One `chatImageRead` through the preload bridge, reduced to a serializable
 * shape. The bytes are measured in the renderer: a Uint8Array crossing
 * `executeJavaScript` is not a reliable thing to compare, and the length is the
 * fact this rig cares about.
 */
function readExpression(ref) {
  return `(async () => {
    if (!window.lifequest || typeof window.lifequest.chatImageRead !== "function") {
      throw new Error("window.lifequest.chatImageRead is missing");
    }
    const result = await window.lifequest.chatImageRead(${JSON.stringify(ref)});
    if (!result) return { ok: false, error: "no reply" };
    if (result.ok) {
      const value = result.value ?? {};
      return {
        ok: true,
        mime: typeof value.mime === "string" ? value.mime : null,
        bytes: value.bytes && typeof value.bytes.byteLength === "number"
          ? value.bytes.byteLength
          : null,
        isBytes: value.bytes instanceof Uint8Array,
      };
    }
    return { ok: false, error: typeof result.error === "string" ? result.error : String(result.error) };
  })()`;
}

const UNREADABLE = /could not be read/i;

/**
 * Whether the shipped shell is really on screen: the nav rail has rendered AND
 * the splash, which paints over the whole window from `index.html` before React
 * exists, has stood down.
 *
 * The splash is a real overlay (`#splash`, dismissed by `SplashGate` with
 * `splash--out` and then `hidden`/`splash--done`), and a renderer reload brings
 * it back — so a poll that only watches `.nav-rail` can pass while the brand
 * lockup still covers the picture. This is the check the artifact must pass
 * before `capturePage`, never a timer.
 */
const SHELL_READY = `(() => {
  const splash = document.getElementById("splash");
  const style = splash ? getComputedStyle(splash) : null;
  const splashGone =
    !splash ||
    splash.hasAttribute("hidden") ||
    splash.classList.contains("splash--done") ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0;
  return Boolean(document.querySelector(".nav-rail")) && splashGone;
})()`;

/** Why the shell was not ready, for the failed check's detail. */
const SHELL_DETAIL = `(() => {
  const splash = document.getElementById("splash");
  const style = splash ? getComputedStyle(splash) : null;
  return {
    shell: Boolean(document.querySelector(".nav-rail")),
    splash: splash
      ? {
          hidden: splash.hasAttribute("hidden"),
          classes: splash.className,
          visibility: style.visibility,
          opacity: style.opacity,
        }
      : null,
  };
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // A vault of this run's own. Windows refuses to remove a directory while a
  // handle is still closing, so the rig starts from a fresh path it owns.
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(VAULT, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  // Hermes is a bystander here, but the app probes for it at boot: a throwaway
  // home keeps any seeded profile local, and removing the real `hermes` from
  // PATH makes the probe answer needs_install instead of attaching to the
  // operator's running gateway.
  fs.rmSync(hermesHome, { recursive: true, force: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((dir) => dir && !fs.existsSync(path.join(dir, "hermes")))
    .join(path.delimiter);

  // The doors the app binds are the product's 8643/8646 by default, and the
  // bench app on this display may already hold both. Two free ports are the
  // same seam the other real-app rigs use; main reads them at import time.
  // The built-in companion's endpoint, before boot: the studio gates on a
  // ready companion, and Pi's ensure probes this list.
  const endpoint = await startModelEndpoint();
  const piBaseUrl = `http://127.0.0.1:${endpoint.port}/v1`;

  const [mcpLocal, mcpInvite] = await freePorts(2);
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: userDataDir,
    showWindow: true,
    mcpPorts: { local: mcpLocal, invite: mcpInvite },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  const dist = await serveDist();
  process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${dist.port}`;

  // The bundled main is imported below, and importing it starts the app. A main
  // built by `npm run build` has the e2e seam compiled out, so it would open the
  // OPERATOR's profile before any assertion could run. Refuse to import it at
  // all: the dev-built bundle is the only one this rig may boot.
  const mainBundleFile = path.join(desktopRoot, "dist-electron", "main.js");
  const seamless = !fs.existsSync(mainBundleFile) ||
    !fs.readFileSync(mainBundleFile, "utf8").includes("LIFEQUEST_E2E");

  let report;
  const timeout = setTimeout(() => {
    console.error("chat-image-ipc: timed out after 180s");
    app.exit(1);
  }, 180_000);

  try {
    if (seamless) {
      throw new Error(
        "dist-electron/main.js was built without the e2e profile seam (npm run build); refusing to boot it against the operator's profile — run this through lifequest-e2e so the dev-built main is in place",
      );
    }
    // The import happens AFTER the environment above: main reads the e2e seam,
    // the vault-door ports and the dev-server URL once, at module scope.
    const { bootForE2e } = await import("../dist-electron/main.js");

    // The seam guard, before anything boots: a main bundle built by
    // `npm run build` has the e2e seam compiled out, and booting that would open
    // the operator's real profile. Refuse instead of touching the operator's
    // world.
    const realProfile = fs.realpathSync(userDataDir);
    const seam = check(
      "the real main process honoured the rig's throwaway profile",
      app.getPath("userData") === realProfile,
      `userData ${app.getPath("userData")} (wanted ${realProfile})`,
    );
    if (!seam) throw new Error("the e2e seam is not in dist-electron/main.js; refusing to boot the operator's profile");

    const win = await bootForE2e();
    const js = (code) => win.webContents.executeJavaScript(code, true);

    // The preload is in place before the page's own scripts run.
    let bridge = { present: false, chatImageRead: "undefined", methodCount: 0 };
    for (let i = 0; i < 200; i += 1) {
      bridge = await js(`(() => {
        if (!window.lifequest) return { present: false, chatImageRead: "undefined", methodCount: 0 };
        return {
          present: true,
          chatImageRead: typeof window.lifequest.chatImageRead,
          methodCount: Object.keys(window.lifequest).length,
        };
      })()`);
      if (bridge.present) break;
      await sleep(50);
    }
    check(
      "the built preload exposes chatImageRead",
      bridge.present === true && bridge.chatImageRead === "function" && bridge.methodCount > 20,
      JSON.stringify(bridge),
    );

    // The studio may not open without a ready companion; configure the built-in
    // one against the loopback model list. Only the shell is needed — no turn is
    // run in this rig.
    const configured = await js(`(async () => {
      const api = window.lifequest;
      const settings = await api.companionPiSettingsSave({
        baseUrl: ${JSON.stringify(piBaseUrl)},
        model: ${JSON.stringify(MODEL)},
        providerName: "Chat images rig",
      });
      const switched = await api.companionUseHarness("pi");
      return {
        settings: settings && settings.kind ? settings.kind : JSON.stringify(settings),
        switched: switched && switched.kind ? switched.kind : JSON.stringify(switched),
      };
    })()`);
    check(
      "the built-in companion is ready so the studio opens",
      configured.settings === "ready" || configured.switched === "ready",
      JSON.stringify(configured),
    );

    const created = await js(
      `window.lifequest.vaultCreate(${JSON.stringify(VAULT)}, "Chat images rig")`,
    );
    check(
      "the rig's vault is created through the real IPC",
      created && created.ok === true,
      created && created.ok === false ? String(created.error) : JSON.stringify(created),
    );
    const opened = await js(`window.lifequest.vaultOpen(${JSON.stringify(VAULT)})`);
    check(
      "the rig's vault is opened through the real IPC",
      opened && opened.ok === true,
      opened && opened.ok === false ? String(opened.error) : JSON.stringify(opened),
    );

    // A real picture inside the opened vault, and a non-picture file beside it.
    // Written from node after the open, so the door reads a live vault rather
    // than a fixture the vault happened to ship.
    const picturePath = path.join(VAULT, PICTURE);
    fs.mkdirSync(path.dirname(picturePath), { recursive: true });
    fs.writeFileSync(picturePath, FIXTURE_PNG);
    fs.writeFileSync(path.join(VAULT, NOTES), FIXTURE_PNG);
    check(
      "the picture is on disk inside the opened vault",
      fs.existsSync(picturePath) &&
        fs.statSync(picturePath).size === FIXTURE_PNG.byteLength,
      `${picturePath} (${fs.existsSync(picturePath) ? fs.statSync(picturePath).size : "missing"} bytes)`,
    );

    // Give the renderer a beat to settle on the opened vault before the reads
    // and the picture: the door itself does not depend on it, the screenshot
    // does.
    await js("window.lifequest.vaultGetSnapshot()");
    await sleep(600);

    // ── Allowed refs ───────────────────────────────────────────────────────
    const relative = await js(readExpression(PICTURE));
    check(
      "a vault-relative picture reads through the real IPC",
      relative.ok === true &&
        relative.mime === "image/png" &&
        relative.bytes === FIXTURE_PNG.byteLength,
      JSON.stringify(relative),
    );
    const absolute = await js(readExpression(picturePath));
    check(
      "an absolute path inside the vault reads through the real IPC",
      absolute.ok === true &&
        absolute.mime === "image/png" &&
        absolute.bytes === FIXTURE_PNG.byteLength,
      JSON.stringify(absolute),
    );
    check(
      "the two refs return the same picture",
      relative.ok === true &&
        absolute.ok === true &&
        relative.bytes === absolute.bytes &&
        relative.mime === absolute.mime,
      `relative ${JSON.stringify(relative)}, absolute ${JSON.stringify(absolute)}`,
    );

    // ── Refusals, through the same live door ───────────────────────────────
    const escaped = await js(readExpression("../escape.png"));
    check(
      "a path that climbs out of the vault is refused through the real IPC",
      escaped.ok === false && typeof escaped.error === "string" && UNREADABLE.test(escaped.error),
      JSON.stringify(escaped),
    );
    const remote = await js(readExpression("https://example.com/x.png"));
    check(
      "a remote URL is refused through the real IPC",
      remote.ok === false && typeof remote.error === "string" && UNREADABLE.test(remote.error),
      JSON.stringify(remote),
    );
    const empty = await js(readExpression(""));
    check(
      "an empty ref is refused through the real IPC",
      empty.ok === false && typeof empty.error === "string" && UNREADABLE.test(empty.error),
      JSON.stringify(empty),
    );
    const text = await js(readExpression(NOTES));
    check(
      "a non-picture file is refused through the real IPC",
      text.ok === false && typeof text.error === "string" && UNREADABLE.test(text.error),
      JSON.stringify(text),
    );

    // Reload the renderer once, so the shipped shell picks the open vault up
    // the way a real launch does (the VaultProvider reads it on mount) — and so
    // the picture door is asked again on a fresh page, the restart the AGENTS
    // rule is about.
    await new Promise((resolve) => {
      win.webContents.once("did-finish-load", resolve);
      win.webContents.reload();
    });
    // Bounded and deterministic: the shell must be up AND the splash gone
    // before the artifact is taken. A splash covering the window is not the
    // shipped surface, so this is a failing check rather than a slower wait.
    let shellRendered = false;
    for (let i = 0; i < 400; i += 1) {
      shellRendered = await js(SHELL_READY);
      if (shellRendered) break;
      await sleep(50);
    }
    const shellDetail = shellRendered ? null : await js(SHELL_DETAIL);
    check(
      "the shell renders after boot with the splash gone",
      shellRendered === true,
      `after 20s: ${JSON.stringify(shellDetail)}`,
    );
    await sleep(250);
    const reloaded = await js(readExpression(PICTURE));
    check(
      "the reloaded page reads the picture again through the built bridge",
      reloaded.ok === true &&
        reloaded.mime === "image/png" &&
        reloaded.bytes === FIXTURE_PNG.byteLength,
      JSON.stringify(reloaded),
    );

    // The shipped shell with this vault open, for the operator.
    await sleep(400);
    fs.writeFileSync(SHOT, (await win.webContents.capturePage()).toPNG());
    check(
      "the artifact picture was written",
      fs.existsSync(SHOT) && fs.statSync(SHOT).size > 0,
      `${fs.existsSync(SHOT) ? fs.statSync(SHOT).size : 0} bytes`,
    );

    report = {
      ranAt: new Date().toISOString(),
      vault: fs.existsSync(VAULT) ? fs.realpathSync(VAULT) : VAULT,
      userData: app.getPath("userData"),
      hermesHome,
      mcpPorts: { local: mcpLocal, invite: mcpInvite },
      companion: configured,
      bridge,
      reads: { relative, absolute, escaped, remote, empty, text, reloaded },
      shell: { rendered: shellRendered, detail: shellDetail },
      screenshot: fs.existsSync(SHOT) ? SHOT : null,
      scenarios,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      ranAt: new Date().toISOString(),
      vault: fs.existsSync(VAULT) ? fs.realpathSync(VAULT) : VAULT,
      userData: app.getPath("userData"),
      hermesHome,
      mcpPorts: { local: mcpLocal, invite: mcpInvite },
      scenarios,
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  const rows = scenarios.map((scenario) => [
    scenario.pass ? "PASS" : "FAIL",
    scenario.name,
    scenario.detail ?? "",
  ]);
  const header = ["", "check", "detail"];
  const widths = header.map((_, index) =>
    Math.max(header[index].length, ...rows.map((row) => String(row[index]).length)),
  );
  const format = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join("  ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${REPORT}`);
  console.log(`shot: ${SHOT}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat image ipc: PASS" : "chat image ipc: FAIL");

  try {
    endpoint.server.close();
  } catch {
    // The process is about to exit; a held socket is not a result.
  }

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-image-ipc: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
