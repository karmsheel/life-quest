/**
 * Fort-Knox acceptance rig: the REAL LifeQuest main process, the REAL preload,
 * and the REAL renderer (Vite dev server), exercised against the attack paths the
 * 2026-10-28 security sweep found.
 *
 * This is the one artifact the security branch is allowed to claim. Each leg
 * fails on the pre-fix tree and passes on the fixed tree:
 *
 *   1. CSP — the shipped meta policy carries the navigation/object hardening,
 *      and `img-src` allows `blob:` (vault media/receipt images actually render).
 *   2. UI-01 — the wiki-placeholder splice is gone: `[x](https://evil/[[…]])`
 *      renders ONE external anchor whose href is the plain URL, `target=_blank`,
 *      with no generated tag inside the attribute. (The renderer module is
 *      imported from the live dev server, so this is the shipped code path.)
 *   3. SHELL-01/04 — an in-place `location.href` to a foreign origin is blocked
 *      (no request reaches the origin, the window keeps the app document), and
 *      `window.open` to a foreign origin creates no window and loads nothing.
 *   4. VAULT-01/06 — a cross-domain `pageId` (`../../health/pages/<id>`) is
 *      refused, while the same id inside its own domain still reads.
 *   5. DOOR-03/05 — the loopback MCP door rejects a foreign Host (403), keeps
 *      answering a same-host unauthenticated call (401 AUTH_REQUIRED), and
 *      answers an oversized body promptly (413/401) without wedging.
 *   6. SUPP-05/DOOR-02 — the pairing-secrets file is 0600 in a 0700 directory.
 *   7. SHELL-02/SUPP-02 — a forged `update:install` (an asset main never
 *      offered) is refused before any byte is fetched, while the legitimate
 *      asset from main's own `update:check` answer still downloads and is handed
 *      to the launcher with matching SHA-256.
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile, moves the
 * doors to ports this rig owns, and points the update feed/trust/launcher at
 * servers this rig owns. No real vault, installer, browser or operator profile
 * is touched. A successful install makes the app quit itself, so the report is
 * rewritten from an exit hook; the driver asserts on the report, not the exit
 * code.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "security-fort-knox.json");
const SHOT = path.join(artifactsDir, "security-fort-knox.png");
const FAKE_INSTALLER = path.join(here, "fixtures", "fake-installer.mjs");

const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;

const INSTALLER_BYTES = Buffer.from(
  "MZ\u0000\u0000LifeQuest security-rig fake setup stub — never executed; the rig\n" +
    "only hands this file to the fake launcher, which records its digest.\n",
  "utf8",
);
const INSTALLER_SHA = crypto
  .createHash("sha256")
  .update(INSTALLER_BYTES)
  .digest("hex");

const failures = [];
const checks = {};
const notes = [];
let markerFile = "";
let profileDir = "";
const state = {
  assets: {},
  checks,
  failures,
  notes,
  appVersion: APP_VERSION,
  installerSha: INSTALLER_SHA,
};

const check = (name, condition, detail) => {
  checks[name] = { pass: Boolean(condition), detail: detail ?? null };
  if (!condition) failures.push(`${name}: ${detail ?? "failed"}`);
  return Boolean(condition);
};
const note = (line) => notes.push(line);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readLauncherMarker() {
  try {
    return JSON.parse(fs.readFileSync(markerFile, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The successful install ends with the app quitting itself ~1s later. The
 * launcher leg is therefore finalised here, synchronously, from the marker file
 * rather than assumed by an async timer that the quit can race.
 */
let launcherFinalised = false;
function finaliseLauncher() {
  if (launcherFinalised || !state.update?.install) return;
  launcherFinalised = true;
  const marker = state.update.launcher ?? readLauncherMarker();
  state.update.launcher = marker;
  check("update.launcherRan", Boolean(marker?.ok), JSON.stringify(marker));
  check(
    "update.launcherGotDownloadedBytes",
    marker?.sha256 === INSTALLER_SHA,
    `launcher sha ${marker?.sha256} vs feed ${INSTALLER_SHA}`,
  );
  check("update.assetFetchedOnce", state.update.assetRequests === 1, `asset requests ${state.update.assetRequests}`);
}

function writeReport() {
  try {
    finaliseLauncher();
    fs.mkdirSync(artifactsDir, { recursive: true });
    state.pass = failures.length === 0;
    fs.writeFileSync(REPORT, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`[security-rig] could not write report: ${error}\n`);
  }
}
process.on("exit", writeReport);

// —— rig-owned ports and servers ————————————————————————————————————————————

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The update feed, the installer bytes, and the two foreign origins. */
async function startServers(ports) {
  let base = "";
  const counts = { feed: 0, asset: 0, forged: 0, nav: 0, popup: 0, click: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (url.pathname === "/releases/latest") {
      counts.feed += 1;
      const body = JSON.stringify({
        tag_name: "v0.9.0",
        name: "LifeQuest v0.9.0",
        body: "Security rig release",
        html_url: "https://github.com/karmsheel/life-quest/releases/tag/v0.9.0",
        published_at: "2026-10-28T08:00:00Z",
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "LifeQuest-0.9.0-win-x64.zip",
            browser_download_url: `${base}/asset/zip`,
            size: 10,
          },
          {
            name: "LifeQuest-0.9.0-setup.exe",
            browser_download_url: `${base}/asset/installer`,
            size: INSTALLER_BYTES.length,
          },
        ],
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (url.pathname === "/asset/installer") {
      counts.asset += 1;
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(INSTALLER_BYTES.length),
      });
      res.end(INSTALLER_BYTES);
      return;
    }
    if (url.pathname === "/forged") {
      // This URL is trusted by the E2E policy but is NOT the asset main offered.
      counts.forged += 1;
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(INSTALLER_BYTES.length),
      });
      res.end(INSTALLER_BYTES);
      return;
    }
    if (url.pathname === "/pwn" || url.pathname.startsWith("/pwn-click")) {
      counts.nav += 1;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>pwn</title><h1>pwn origin</h1>");
      return;
    }
    if (url.pathname === "/pwn-popup") {
      counts.popup += 1;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>popup</title><h1>popup origin</h1>");
      return;
    }
    counts.nav += 1;
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return {
    base,
    counts,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** One HTTP request with a Host we choose (fetch forbids setting Host). */
function rawMcpRequest(port, { host, body, headers = {}, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": String(Buffer.byteLength(body)),
          ...(host ? { host } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: text.slice(0, 400),
            elapsedMs: Date.now() - startedAt,
          }),
        );
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ status: null, body: "timeout", elapsedMs: Date.now() - startedAt });
    });
    request.on("error", (error) =>
      resolve({ status: null, body: String(error), elapsedMs: Date.now() - startedAt }),
    );
    request.end(body);
  });
}

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "security-rig", version: "1" },
  },
});

/**
 * The companion bearer the door minted for this vault. It is read from the
 * throwaway profile this rig owns — the same file the Hermes profile would
 * carry — to prove the body cap applies to a caller that IS authenticated.
 */
function companionToken() {
  try {
    const file = path.join(profileDir, "pairing-secrets", "connected-agent-secrets.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const vault = Object.values(parsed.vaults ?? {})[0];
    return typeof vault?.companionToken === "string" ? vault.companionToken : null;
  } catch {
    return null;
  }
}

function statMode(target) {
  try {
    return fs.statSync(target).mode & 0o777;
  } catch {
    return null;
  }
}

async function waitForDoor(port, deadlineMs = 60_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const answer = await rawMcpRequest(port, { body: initializeBody, timeoutMs: 1500 });
    if (answer.status !== null) return answer;
    await sleep(250);
  }
  return null;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-security-")));
  profileDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-security-profile-")));
  const vaultPath = path.join(workDir, "vault");
  markerFile = path.join(workDir, "fake-installer.json");
  const localPort = await freePort();
  const invitePort = await freePort();
  const servers = await startServers({ localPort, invitePort });
  state.ports = { local: localPort, invite: invitePort };

  const nodeBin = process.env.LIFEQUEST_E2E_NODE;
  if (!nodeBin || !fs.existsSync(nodeBin)) {
    throw new Error("LIFEQUEST_E2E_NODE must name a node binary (the runner sets it)");
  }

  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: localPort, invite: invitePort },
    updateFeedUrl: `${servers.base}/releases/latest`,
    updateLauncher: { exe: nodeBin, args: [FAKE_INSTALLER] },
    updateTrust: { hosts: ["127.0.0.1"], allowHttp: true },
  });
  process.env.LIFEQUEST_FAKE_INSTALLER_OUT = markerFile;

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const waitFor = async (expression, label, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value;
      try {
        value = await run(expression);
      } catch {
        value = undefined;
      }
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await sleep(100);
    }
  };
  await waitFor("Boolean(window.lifequest)", "the preload bridge");

  // A picture of the shipped screen, for the artifact.
  try {
    win.showInactive();
    await sleep(900);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(SHOT, image.toPNG());
    win.hide();
    note("captured the shipped screen before the attack legs");
  } catch (error) {
    note(`screenshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  // —— 1. CSP ———————————————————————————————————————————————————————————————
  const csp = await run(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ""`,
  );
  state.csp = csp;
  for (const directive of [
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ]) {
    check(`csp.${directive.split(" ")[0]}`, csp.includes(directive), `missing ${directive}`);
  }
  check("csp.imgBlob", /img-src[^;]*blob:/.test(csp), "img-src does not allow blob:");

  // —— 2. UI-01: the wiki splice ————————————————————————————————————————————
  const rendered = await run(`(async () => {
    const mod = await import("/src/lib/doctrine-markdown.ts");
    const html = mod.doctrineMarkdownToHtml(
      "[Read the shared plan](https://evil.example/[[Overview/What]])",
      (target) => target === "Overview/What" ? { href: "#/vision/overview/what", kind: "doctrine" } : null
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const anchor = host.querySelector("a");
    return {
      html,
      anchors: host.querySelectorAll("a").length,
      href: anchor ? anchor.getAttribute("href") : null,
      target: anchor ? anchor.getAttribute("target") : null,
      resolved: host.textContent,
    };
  })()`);
  state.splice = rendered;
  check("ui01.singleAnchor", rendered.anchors === 1, `rendered ${rendered.anchors} anchors: ${rendered.html}`);
  check(
    "ui01.hrefIsPlainUrl",
    typeof rendered.href === "string" &&
      rendered.href.startsWith("https://evil.example/") &&
      !rendered.href.includes("<"),
    `href was ${JSON.stringify(rendered.href)}`,
  );
  check("ui01.targetBlank", rendered.target === "_blank", `target was ${rendered.target}`);
  check("ui01.noSplicedTag", !rendered.html.includes('<a href="https://evil.example/<a'), "generated tag was spliced into the URL");

  // The rendered anchor, clicked for real in the live window: never in-window.
  const beforeClick = win.webContents.getURL();
  await run(`(async () => {
    const mod = await import("/src/lib/doctrine-markdown.ts");
    const host = document.createElement("div");
    host.innerHTML = mod.doctrineMarkdownToHtml(
      "[Click](http://127.0.0.1:${new URL(servers.base).port}/pwn-click)",
      () => null
    );
    document.body.appendChild(host);
    host.querySelector("a")?.click();
    host.remove();
  })()`);
  await sleep(1200);
  check(
    "ui01.clickDoesNotNavigate",
    win.webContents.getURL() === beforeClick && servers.counts.nav === 0,
    `url=${win.webContents.getURL()} foreignRequests=${servers.counts.nav}`,
  );

  // —— 3. SHELL-01/04: navigation and window.open ————————————————————————————
  const beforeNav = win.webContents.getURL();
  await run(`location.href = "http://127.0.0.1:${new URL(servers.base).port}/pwn"`).catch(() => {});
  await sleep(1500);
  check(
    "shell01.inPlaceNavigationDenied",
    win.webContents.getURL() === beforeNav && servers.counts.nav === 0,
    `url=${win.webContents.getURL()} foreignRequests=${servers.counts.nav}`,
  );
  const windowsBefore = BrowserWindow.getAllWindows().length;
  await run(`window.open("http://127.0.0.1:${new URL(servers.base).port}/pwn-popup")`).catch(() => {});
  await sleep(800);
  check(
    "shell04.windowOpenDenied",
    BrowserWindow.getAllWindows().length === windowsBefore && servers.counts.popup === 0,
    `windows=${BrowserWindow.getAllWindows().length} popupRequests=${servers.counts.popup}`,
  );

  // —— 4. Vault opens; cross-domain pageId ————————————————————————————————————
  const created = await run(
    `window.lifequest.vaultCreate(${JSON.stringify(vaultPath)}, "Security rig")`,
  );
  check("vault.create", created?.ok === true, JSON.stringify(created));
  const opened = await run(`window.lifequest.vaultOpen(${JSON.stringify(vaultPath)})`);
  check("vault.open", opened?.ok === true, JSON.stringify(opened));
  const healthPage = await run(`window.lifequest.pageCreate("health", { title: "Health page" })`);
  const intelPage = await run(
    `window.lifequest.pageCreate("intellectual", { title: "Intel page" })`,
  );
  state.pages = { healthPage, intelPage };
  const healthId = healthPage?.value?.id;
  const intelId = intelPage?.value?.id;
  check("vault.pagesCreated", Boolean(healthId && intelId), `ids ${healthId}/${intelId}`);
  if (healthId) {
    const own = await run(`window.lifequest.pageGet("health", ${JSON.stringify(healthId)})`);
    check("vault.ownPageReadable", own?.ok === true, JSON.stringify(own));
  }
  const traversal = await run(
    `window.lifequest.pageGet("intellectual", ${JSON.stringify(`../../health/pages/${healthId}`)})`,
  );
  state.traversal = traversal;
  check("vault01.crossDomainPageRefused", traversal?.ok === false, JSON.stringify(traversal));
  // The same fence, reached through a different id that becomes a path.
  const reviewTraversal = await run(
    `window.lifequest.reviewGet("weekly", ${JSON.stringify("../../health/how")})`,
  );
  state.reviewTraversal = reviewTraversal;
  check(
    "vault06.reviewPathTraversalRefused",
    reviewTraversal?.ok === false,
    JSON.stringify(reviewTraversal),
  );

  // —— 5. Doors: Host/Origin, body cap, secrets mode —————————————————————————
  const doorAnswer = await waitForDoor(localPort);
  check("door.bound", doorAnswer !== null, "the local door never answered on the rig port");
  const normal = await rawMcpRequest(localPort, { host: `127.0.0.1:${localPort}`, body: initializeBody });
  state.doors = { normal };
  check(
    "door03.sameHostReachesAuth",
    normal.status === 401 && normal.body.includes("AUTH_REQUIRED"),
    JSON.stringify(normal),
  );
  const foreign = await rawMcpRequest(localPort, { host: "evil.example", body: initializeBody });
  state.doors.foreign = foreign;
  check("door03.foreignHostRejected", foreign.status === 403, JSON.stringify(foreign));
  const oversized = await rawMcpRequest(localPort, {
    host: `127.0.0.1:${localPort}`,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "x", arguments: { pad: "A".repeat(2 * 1024 * 1024) } },
    }),
  });
  state.doors.oversized = oversized;
  check(
    "door05.oversizedBodyRefusedPromptly",
    (oversized.status === 413 || oversized.status === 401) && oversized.elapsedMs < 5000,
    JSON.stringify({ status: oversized.status, elapsedMs: oversized.elapsedMs }),
  );
  const token = companionToken();
  state.companionTokenLength = token?.length ?? 0;
  const oversizedAuthed = token
    ? await rawMcpRequest(localPort, {
        host: `127.0.0.1:${localPort}`,
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "x", arguments: { pad: "B".repeat(2 * 1024 * 1024) } },
        }),
      })
    : { status: null, elapsedMs: 0, body: "no companion bearer" };
  state.doors.oversizedAuthed = oversizedAuthed;
  check(
    "door05.authenticatedBodyCapEnforced",
    oversizedAuthed.status === 413 && oversizedAuthed.elapsedMs < 5000,
    JSON.stringify(oversizedAuthed),
  );

  const secretsFile = path.join(profileDir, "pairing-secrets", "connected-agent-secrets.json");
  const secretsDir = path.dirname(secretsFile);
  state.secretModes = { file: statMode(secretsFile), dir: statMode(secretsDir) };
  check(
    "supp05.secretsFilePrivate",
    state.secretModes.file === 0o600,
    `mode ${state.secretModes.file === null ? "missing" : state.secretModes.file.toString(8)}`,
  );
  check(
    "supp05.secretsDirPrivate",
    state.secretModes.dir === 0o700,
    `mode ${state.secretModes.dir === null ? "missing" : state.secretModes.dir.toString(8)}`,
  );

  // —— 6. Update install binding ——————————————————————————————————————————————
  const update = await run(`window.lifequest.updateCheck({ force: true })`);
  state.update = { check: update };
  const decision = update?.decision;
  check(
    "update.offered",
    update?.ok === true && decision?.state === "available" && Boolean(decision?.installer),
    JSON.stringify(update),
  );

  const forged = await run(
    `window.lifequest.updateInstall({ name: "pwn.exe", url: ${JSON.stringify(`${servers.base}/forged`)}, size: 0 })`,
  );
  state.update.forged = forged;
  check("supp02.forgedInstallRefused", forged?.ok === false, JSON.stringify(forged));
  check(
    "supp02.forgedAssetNeverFetched",
    servers.counts.forged === 0,
    `the forged asset was fetched ${servers.counts.forged} time(s)`,
  );

  // The legitimate asset from main's own answer still installs, and this ends
  // with the app quitting itself (hence the exit-hook report).
  writeReport();
  if (decision?.installer) {
    const install = await run(
      `window.lifequest.updateInstall(${JSON.stringify(decision.installer)})`,
    );
    state.update.install = install;
    check("update.legitInstallLaunched", install?.ok === true && install?.launched === true, JSON.stringify(install));
    state.update.assetRequests = servers.counts.asset;
    // The app schedules its own quit ~1s after a successful launch. Poll the
    // marker synchronously (the child writes it in well under a second) so the
    // launcher leg is decided before that quit, and finaliseLauncher() re-reads
    // it from the exit hook if this window is missed.
    const deadline = Date.now() + 750;
    while (Date.now() < deadline && !readLauncherMarker()) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    finaliseLauncher();
    writeReport();
  }

  await servers.close();
  state.pass = failures.length === 0;
  writeReport();
  // The install leg quits the app; on the refusal-only path, end the rig.
  setTimeout(() => app.quit(), 1200);
}

main().catch((error) => {
  failures.push(`rig crashed: ${error instanceof Error ? error.stack : String(error)}`);
  writeReport();
  app.exit(1);
});
