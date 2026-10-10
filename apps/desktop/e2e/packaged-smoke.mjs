/**
 * The packaged-build smoke rig: will the `.exe` an operator downloads run?
 *
 * `npm test` proves the app works when Electron loads `apps/desktop` straight
 * off the disk, with a dev server on 5173 and the workspace's `node_modules`
 * beside it. `npm run release` proves electron-builder wrote some files. Neither
 * proves the files *run*: everything that breaks between those two facts breaks
 * only once the app is packed into `resources/app.asar`, with no dev server and
 * no workspace tree to fall back on.
 *
 * The ways a packaged LifeQuest can fail, each one a check below:
 *
 *  1. `main` does not resolve. electron-builder takes `main` from
 *     `extraMetadata`; point it at a file the asar does not hold and Electron
 *     exits before a window ever exists.
 *     → `dist-electron/main.js` must be in the asar, and the packaged
 *       `package.json` must name it as `main`.
 *  2. The packaged `package.json` loses `"type": "module"`, so the ESM main is
 *     loaded as CommonJS and dies on its first `import`.
 *     → `type` is read back out of the asar and must be `module`.
 *  3. The preload is not in the asar, so `window.lifequest` never appears and
 *     every IPC call from the renderer throws.
 *     → `dist-electron/preload.js` must be in the asar.
 *  4. The renderer's own assets are not in the asar, so the window opens blank.
 *     → a DevTools-protocol page target must exist and must have reached the
 *       title `dist/index.html` declares.
 *  5. The vault cannot be opened from inside the asar — a dependency that only
 *     resolved in the workspace, or a `node:sqlite` the packaged Electron does
 *     not carry — and the app parks on its error state.
 *     → the vault this rig creates in a temp directory must come back rewritten
 *       into the throwaway profile's `recent.json`, and the app's own MCP door
 *       must bind on the throwaway port. Neither can happen unless the renderer
 *       mounted, called `vault:open` over the preload bridge, and the main
 *       process read that vault through the asar.
 *  6. The app dies after the window opens, in a crash-and-restart loop.
 *     → the process must still be alive once the door is up.
 *
 * Everything runs against a vault this rig creates in one temp directory and a
 * profile it creates in another, so the operator's own vault and their
 * `%APPDATA%\LifeQuest` are never opened, never written, and never at risk.
 *
 *   npm run release && node e2e/packaged-smoke.mjs
 *
 * Exit 0 = the packaged app booted, rendered, and opened a vault over its own
 * IPC bridge. The artifact is `e2e/artifacts/packaged-smoke.json`, beside
 * `packaged-smoke.log`, the run's own stdout and stderr.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const unpacked = path.join(desktopRoot, "release", "win-unpacked");
const exePath = path.join(unpacked, "LifeQuest.exe");
const asarPath = path.join(unpacked, "resources", "app.asar");
const artifactsDir = path.join(here, "artifacts");
const reportPath = path.join(artifactsDir, "packaged-smoke.json");
const transcriptPath = path.join(artifactsDir, "packaged-smoke.log");

/** What is seeded into the profile so the app has something to reopen. */
const SEEDED_ID = "00000000-0000-0000-0000-000000000000";
const SEEDED_NAME = "not-yet-opened";

const failures = [];
const checks = [];

/** Record one check. `detail` is what the check actually saw. */
function check(name, pass, detail = null) {
  checks.push({ name, pass, detail });
  if (!pass) failures.push(detail ? `${name} (${detail})` : name);
  return pass;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Three distinct free ports, so the doors and DevTools cannot collide. */
async function threeFreePorts() {
  const taken = [];
  while (taken.length < 3) {
    const port = await freePort();
    if (!taken.includes(port)) taken.push(port);
  }
  return { cdpPort: taken[0], localPort: taken[1], invitePort: taken[2] };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

/** Poll `probe` until it returns something truthy, or give up and return null. */
async function waitForValue(probe, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

/** The tail of the run's transcript, for a failure an operator can act on. */
function transcriptTail(lines = 30) {
  if (!fs.existsSync(transcriptPath)) return [];
  const all = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/).filter(Boolean);
  return all.slice(-lines);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

let child = null;
let profileDir = null;
let vaultDir = null;
let vault = null;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(transcriptPath, { force: true });

  if (!fs.existsSync(exePath)) {
    throw new Error(`no packaged app at ${exePath} — run \`npm run release\` first`);
  }

  // --- Checks 1-3: what the asar actually holds ----------------------------
  check("the packaged executable exists", true, path.relative(unpacked, exePath));
  const hasAsar = check("resources/app.asar exists", fs.existsSync(asarPath));

  if (hasAsar) {
    const asar = createRequire(import.meta.url)("@electron/asar");
    const entries = new Set(
      asar
        .listPackage(asarPath)
        .map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "")),
    );
    for (const required of [
      "dist/index.html",
      "dist-electron/main.js",
      "dist-electron/preload.js",
    ]) {
      check(`the asar holds ${required}`, entries.has(required));
    }
    const packaged = JSON.parse(
      asar.extractFile(asarPath, "package.json").toString("utf8"),
    );
    check(
      "the packaged package.json names the main the asar holds",
      packaged.main === "dist-electron/main.js",
      `main=${packaged.main}`,
    );
    check(
      'the packaged package.json keeps "type": "module"',
      packaged.type === "module",
      `type=${packaged.type}`,
    );
  }

  // --- A vault and a profile, both throwaway -------------------------------
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-smoke-vault-"));
  const created = await createVault(vaultDir, "Packaged Smoke");
  if (!created.ok) throw new Error(`createVault: ${created.error}`);
  vault = created.value;

  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-smoke-profile-"));
  const prefsFile = path.join(profileDir, "recent.json");
  fs.writeFileSync(
    prefsFile,
    `${JSON.stringify(
      {
        recent: [
          {
            id: SEEDED_ID,
            name: SEEDED_NAME,
            path: vaultDir,
            lastOpenedAt: "1970-01-01T00:00:00.000Z",
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
      },
      null,
      2,
    )}\n`,
  );

  const { cdpPort, localPort, invitePort } = await threeFreePorts();

  // --- Launch the thing an operator would double-click ---------------------
  // The child's output goes to a file rather than a pipe: this transcript is
  // the only witness when the app dies before it draws anything.
  const logFd = fs.openSync(transcriptPath, "a");
  const env = { ...process.env };
  // Electron hosts (DSH, and any other Electron app) export this; left in
  // place, the packaged exe would run as plain Node and never open a window.
  delete env.ELECTRON_RUN_AS_NODE;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: localPort, invite: invitePort },
  });

  child = spawn(exePath, [`--remote-debugging-port=${cdpPort}`], {
    cwd: unpacked,
    stdio: ["ignore", logFd, logFd],
    env,
  });
  fs.closeSync(logFd);

  // --- Check 4: the window, and the document in it -------------------------
  const target = await waitForValue(
    async () => {
      const list = await httpGetJson(`http://127.0.0.1:${cdpPort}/json/list`);
      return Array.isArray(list) ? list.find((t) => t.type === "page") ?? null : null;
    },
    60_000,
    500,
  );
  check(
    "a window opened and published a page target",
    Boolean(target),
    target ? null : "no DevTools page target within 60s",
  );
  check(
    "the renderer loaded the packaged index.html",
    Boolean(target?.url?.endsWith("index.html")),
    target?.url ?? "no target",
  );
  // A page target exists the instant the renderer does, which is a beat before
  // the document has parsed its own <title>; Chromium reports the file name
  // until it has. The check is that the document *reaches* the declared title,
  // so the title is polled rather than sampled once.
  let lastTitle = null;
  const titled = await waitForValue(
    async () => {
      const list = await httpGetJson(`http://127.0.0.1:${cdpPort}/json/list`);
      const page = Array.isArray(list) ? list.find((t) => t.type === "page") : null;
      lastTitle = page?.title ?? lastTitle;
      return page?.title === "LifeQuest" ? page : null;
    },
    30_000,
    300,
  );
  check(
    "the packaged document reached its declared title",
    Boolean(titled),
    `title=${lastTitle ?? "none"}`,
  );

  // --- Check 5: the vault, through the app's own door ----------------------
  const doorUp = await waitForValue(
    async () => ((await portOpen(localPort)) ? true : null),
    60_000,
    400,
  );
  check(
    "the MCP door bound on the throwaway port",
    doorUp === true,
    doorUp ? null : `nothing listening on ${localPort} within 60s`,
  );

  const prefs = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
  const entry = prefs.recent.find((e) => e.path === vaultDir);
  check(
    "opening the vault rewrote the throwaway profile's recent entry",
    entry?.id === vault.lifequest.id,
    `id=${entry?.id ?? "missing"} expected=${vault.lifequest.id} name=${entry?.name ?? "missing"}`,
  );

  // --- Check 6: still alive ------------------------------------------------
  check(
    "the app is still running once the door is up",
    child.exitCode === null && !child.killed,
    `exitCode=${child.exitCode}`,
  );
}

/** Kill the app's whole process tree, and wait for it to be gone. */
function killTree() {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.on("exit", done);
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    killer.on("exit", done);
    killer.on("error", done);
    setTimeout(done, 10_000);
  });
}

/**
 * Nothing this rig starts outlives it, window or child process, and no temp
 * directory it made is left in `%TEMP%`.
 *
 * Cleanup is async and polled rather than retried in a synchronous loop.
 * Chromium keeps its profile files open until every one of its processes is
 * gone, and a synchronous retry blocks the very event loop that would notice
 * the child exiting — so the removal is retried across real ticks instead. A
 * directory that still will not go is named and left, never thrown: a messy
 * `%TEMP%` must not be able to take the rig's verdict down with it.
 */
async function shutdown() {
  await killTree();
  for (const dir of [profileDir, vaultDir]) {
    if (!dir) continue;
    const removed = await waitForValue(
      async () => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          return true;
        } catch {
          return null;
        }
      },
      20_000,
      400,
    );
    if (!removed) {
      console.error(`[packaged-smoke] could not remove ${dir}; it is left in %TEMP%`);
    }
  }
}

let crashed = null;
try {
  await main();
} catch (err) {
  crashed = err instanceof Error ? err.message : String(err);
}
await shutdown();

const report = {
  pass: failures.length === 0 && !crashed,
  crashed,
  failures,
  checks,
  app: fs.existsSync(exePath)
    ? {
        file: path.relative(desktopRoot, exePath),
        bytes: fs.statSync(exePath).size,
        sha256: sha256(exePath),
      }
    : null,
  transcript: transcriptTail(),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (crashed) console.error(`  CRASH ${crashed}`);
if (!report.pass) {
  console.error("[packaged-smoke] the last lines the app wrote:");
  for (const line of report.transcript) console.error(`    ${line}`);
}
console.log(`[packaged-smoke] pass=${report.pass} -> ${path.relative(desktopRoot, reportPath)}`);
process.exit(report.pass ? 0 : 1);
