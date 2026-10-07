/**
 * `npm test`, with one piece of environment hygiene.
 *
 * Electron hosts (DSH, and any other Electron app) export
 * ELECTRON_RUN_AS_NODE, which makes every `electron` this suite spawns run as
 * plain node instead of as Electron: each rig then dies in ~200 ms without
 * opening a window. `dev.mjs` already strips that variable for the app it
 * launches; this keeps the test path consistent with it. Nothing else changes -
 * the command below is exactly the one this script replaces.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--test", "tests/**/*.test.ts"],
  { cwd: root, stdio: "inherit", env },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[test] the test runner was killed by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
