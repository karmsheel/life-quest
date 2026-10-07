import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const DEV_PORT = 5173;
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
  const child = spawn(process.execPath, [viteBin], {
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
  child.on("exit", (code) => {
    if (shuttingDown) return;
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

async function main() {
  console.log("[dev] bundling electron main + preload…");
  await bundleElectron();

  console.log("[dev] starting Vite on", DEV_URL);
  startVite();
  await waitForPort(DEV_PORT);

  console.log("[dev] launching Electron…");
  startElectron();
}

main().catch((err) => {
  console.error(err);
  cleanup(1);
});
