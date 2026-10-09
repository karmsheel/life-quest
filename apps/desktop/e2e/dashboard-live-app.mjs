/**
 * Launcher for the wired-app acceptance run (`dashboard-live-app.electron.mjs`).
 *
 * The rig itself must run INSIDE Electron's main process, so this Node script is
 * what sets the environment that the app's own e2e seam reads:
 *
 *  - `LIFEQUEST_E2E` isolates the profile. It is built here, with a throwaway
 *    directory for `userData`, seeded from the operator's `recent.json` so their
 *    vault auto-opens. Their real `%APPDATA%\LifeQuest` is never written.
 *  - `VITE_DEV_SERVER_URL` points the window at the dev server.
 *  - `ELECTRON_RUN_AS_NODE` is dropped, or the spawned Electron runs as plain
 *    Node and no window ever opens.
 *
 *   node e2e/dashboard-live-app.mjs
 *
 * Exit code 0 = the app rendered the pinned summary table and toggled the page
 * lock over the real IPC bridge; the artifact is
 * `e2e/artifacts/dashboard-live-app.json`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const SOURCE_RECENT = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
const REPORT = path.join(here, "artifacts", "dashboard-live-app.json");

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-app-"));
if (fs.existsSync(SOURCE_RECENT)) {
  fs.copyFileSync(SOURCE_RECENT, path.join(profileDir, "recent.json"));
} else {
  console.error(`[live-app] no recent.json at ${SOURCE_RECENT}; the app will open on Welcome`);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
env.LIFEQUEST_E2E = JSON.stringify({ userData: profileDir, showWindow: false });

fs.rmSync(REPORT, { force: true });

// `--shot` also captures the live board, for when the question is how the
// Dashboard looks rather than whether it works.
const shot = process.argv.includes("--shot");
if (shot) env.LIFEQUEST_E2E_SHOT = "1";

// `--drag` adds the one leg that writes: it reorders the operator's own Overview
// board through the real IPC channel and puts the order back. Opt-in, because a
// run that touches a real vault should be a decision and not a default.
const drag = process.argv.includes("--drag");
if (drag) env.LIFEQUEST_E2E_DRAG = "1";

const child = spawn(electron, [path.join(here, "dashboard-live-app.electron.mjs")], {
  cwd: desktopRoot,
  stdio: "inherit",
  env,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error("[live-app] timed out");
  child.kill();
}, 120_000);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (process.env.LIFEQUEST_E2E_KEEP_PROFILE) {
    console.log(`[live-app] profile kept at ${profileDir}`);
  } else {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  if (signal || timedOut) {
    console.error(`[live-app] the app did not finish (${signal ?? "timeout"})`);
    process.exit(1);
  }
  if (!fs.existsSync(REPORT)) {
    console.error(`[live-app] the app exited (${code}) without writing a report`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  console.log(`[live-app] pass=${report.pass}`);
  if (!report.pass) console.error(`[live-app] failures: ${report.failures.join("; ")}`);
  process.exit(report.pass ? 0 : 1);
});
