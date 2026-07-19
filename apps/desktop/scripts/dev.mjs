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
  // Bundle workspace packages (vault-core is TypeScript source).
  // Keep electron external — provided by the Electron runtime.
  await build({
    entryPoints: [
      path.join(root, "electron/main.ts"),
      path.join(root, "electron/preload.ts"),
    ],
    outdir: path.join(root, "dist-electron"),
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    sourcemap: true,
    target: "node20",
  });
}

function startVite() {
  const viteBin = require.resolve("vite/bin/vite.js");
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
    if (!shuttingDown) cleanup(code ?? 0);
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
