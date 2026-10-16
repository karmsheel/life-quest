import { spawn } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

/**
 * The renderer's port, overridable so a second checkout can run beside the
 * operator's own `npm run dev` — which holds 5173 and, with `strictPort`, makes
 * Vite exit rather than move. The e2e rig for this script needs exactly that:
 * it has to watch a real `npm run dev` rebundle a real bundle, and it cannot do
 * that on the port somebody else is already using.
 */
const DEV_PORT = Number(process.env.LIFEQUEST_DEV_PORT ?? 5173);
const DEV_URL = `http://localhost:${DEV_PORT}`;
/**
 * STATUS_BREAKPOINT: what Electron exits with when this machine's Windows
 * refuses Chromium's sandbox. Electron 35 died here on Windows 11 build 26200 —
 * no window, no console output, nothing an operator can act on.
 */
const SANDBOX_UNAVAILABLE_EXIT = 0x80000003;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function cleanup(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
function waitForPort(port, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: "127.0.0.1" }, () => {
        socket.end();
        resolve(undefined);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function bundleElectron() {
  // Main: ESM (.js, loaded natively by Electron main).
  await build({
    entryPoints: [path.join(root, "electron/main.ts")],
    outdir: path.join(root, "dist-electron"),
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    sourcemap: true,
    target: "node20",
  });

  // Preload: CommonJS. Electron's ESM preload loader requires the .mjs
  // extension; an ESM-format .js preload is silently skipped, leaving
  // window.lifequest undefined and breaking every IPC call from the renderer.
  await build({
    entryPoints: [path.join(root, "electron/preload.ts")],
    outdir: path.join(root, "dist-electron"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: true,
    target: "node20",
  });
}

function startVite() {
  const vitePkg = require.resolve("vite/package.json");
  const viteBin = path.join(path.dirname(vitePkg), "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--port", String(DEV_PORT)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!shuttingDown) cleanup(code ?? 1);
  });
  return child;
}

/**
 * The Electron we launched, or null while one is being replaced.
 *
 * Separate from `children` (which is the shutdown list) because a restart has to
 * be able to tell "the app I am replacing" from "an app that died on its own",
 * and those two exits want opposite answers.
 */
let electron = null;

function startElectron() {
  const electronPath = require("electron");
  const env = { ...process.env, VITE_DEV_SERVER_URL: DEV_URL };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ["."], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  children.push(child);
  electron = child;
  child.on("exit", (code) => {
    if (shuttingDown) return;
    // A restart killed this one deliberately, and owns what happens next. Only
    // an exit nobody asked for is the operator closing the app, which ends dev.
    if (child.replaced) return;
    // A silent STATUS_BREAKPOINT is the worst failure mode there is: name it.
    if (((code ?? 0) >>> 0) === SANDBOX_UNAVAILABLE_EXIT) {
      console.error(
        "[dev] Electron exited 0x80000003: this machine's Windows refused Chromium's sandbox before a\n" +
          "[dev] window could open. Electron 35 cannot start its sandbox on Windows 11 build 26200;\n" +
          "[dev] updating `electron` is the fix (44.6.0 starts and runs here). ELECTRON_DISABLE_SANDBOX=1\n" +
          "[dev] also starts it, but Chromium then runs the renderer at low integrity, where it can no\n" +
          "[dev] longer write the app's profile under %APPDATA%.",
      );
    }
    cleanup(code ?? 0);
  });
  return child;
}

/**
 * Watching the main process's own sources, because nothing else does.
 *
 * The RENDERER needs no help: Vite watches `src/**` and hot-replaces it, so a
 * save there is on screen before you have moved your hand. The MAIN process is
 * not like that. It is an esbuild bundle, built once and loaded once, and then
 * frozen for the life of the process — so a change to `electron/**`, or to the
 * workspace package it bundles, is invisible until the bundle is rewritten AND
 * Electron is relaunched. Without this, `npm run dev` quietly serves a main
 * process from the moment it started, and the only way to see a main-process
 * change is to stop it and start it again — which is exactly the thing the
 * person at the keyboard does not know they have to do.
 *
 * There was a regression here, in the worst possible shape: the app kept working,
 * the window kept painting, and the part of the product under development was
 * simply not the part being run.
 *
 * WHAT IS WATCHED, AND WHY EXACTLY THIS
 *
 *   electron/**        main and preload, and the ~24 modules they bundle.
 *   packages/*\/src/**  the workspace packages the main process imports —
 *                      `@lifequest/vault-core`, which is most of the engine.
 *
 * NOT `src/**`: that is the renderer, Vite already owns it, and rebuilding or
 * relaunching the app on every keystroke in a component would be actively worse
 * than doing nothing. NOT `dist-electron/**`: esbuild writes there, and watching
 * our own output is a feedback loop that restarts the app forever.
 */
const WATCH_DIRS = [path.join(root, "electron"), path.join(root, "..", "..", "packages")];

/** Long enough to let an editor finish a save, short enough to feel immediate. */
const REBUNDLE_DEBOUNCE_MS = 120;

let debounceTimer = null;
let lastChange = null;
let restarting = false;
let restartQueued = false;

/** A source file we care about, as opposed to an editor's scratch file. */
function isMainSource(filename) {
  if (!filename) return true;
  const name = String(filename);
  if (/node_modules|[\\/]dist[\\/]|[\\/]dist$/.test(name)) return false;
  if (/[\\/]\./.test(name)) return false;
  return /\.(ts|mts|cts|js|mjs|json)$/.test(name);
}

/**
 * Replace the running Electron with one built from what is on disk now.
 *
 * Order matters and is the whole design: BUNDLE FIRST, and if the bundle fails,
 * leave the running app alone. Relaunching into a build error would take a
 * working dev session and turn it into a dead one over a typo — and the natural
 * next move is to keep the app up and fix the typo.
 */
async function rebundleAndRelaunch(reason) {
  if (restarting) {
    restartQueued = true;
    return;
  }
  restarting = true;
  try {
    console.log(`[dev] ${reason} — rebundling electron main + preload…`);
    await bundleElectron();
    console.log("[dev] relaunching Electron…");

    const previous = electron;
    electron = null;
    if (previous && previous.exitCode === null) {
      previous.replaced = true;
      await stop(previous);
    }
    if (shuttingDown) return;
    startElectron();
  } catch (err) {
    console.error(
      "[dev] the rebundle failed, so the running app is untouched — fix the error and save again:",
    );
    console.error(err instanceof Error ? err.message : String(err));
  } finally {
    restarting = false;
    if (restartQueued) {
      restartQueued = false;
      void rebundleAndRelaunch("a change landed while rebundling");
    }
  }
}

/**
 * End one child, and come back when it is really gone.
 *
 * SIGTERM first, and SIGKILL if it is still there a few seconds later: Electron
 * on Windows does not always honour a soft kill, and a relaunch that overlapped a
 * surviving process would leave two apps holding the same profile and the same
 * two MCP ports.
 */
function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const hardKill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(hardKill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function watchMainSources() {
  const watchers = [];
  for (const dir of WATCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!isMainSource(filename)) return;
        lastChange = filename ? String(filename) : "a main-process source file";
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void rebundleAndRelaunch(`change in ${lastChange}`);
        }, REBUNDLE_DEBOUNCE_MS);
      });
      watcher.on("error", (err) => {
        console.error(`[dev] the watcher on ${dir} stopped: ${err.message}`);
      });
      watchers.push(watcher);
    } catch (err) {
      // A watcher that cannot start is worth saying out loud and not worth
      // dying over: the app still runs, it just needs a restart to see changes.
      console.error(
        `[dev] could not watch ${dir} (${err instanceof Error ? err.message : String(err)}); ` +
          "main-process changes will need a manual restart",
      );
    }
  }
  console.log(`[dev] watching ${WATCH_DIRS.map((dir) => path.relative(root, dir)).join(" and ")}`);
  return watchers;
}

async function main() {
  console.log("[dev] bundling electron main + preload…");
  await bundleElectron();

  console.log("[dev] starting Vite on", DEV_URL);
  startVite();
  await waitForPort(DEV_PORT);

  console.log("[dev] launching Electron…");
  startElectron();

  watchMainSources();
}

main().catch((err) => {
  console.error(err);
  cleanup(1);
});
