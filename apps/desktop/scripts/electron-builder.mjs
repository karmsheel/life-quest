/**
 * The one place electron-builder is invoked from.
 *
 * `package.mjs` (a dev build: `release/win-unpacked/`) and `release.mjs` (a
 * shippable build: the NSIS installer and the portable zip) differ only in the
 * flags they pass, so they share this.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

/**
 * @param {string[]} extraArgs flags for electron-builder, after `--win`
 * @returns {Promise<void>} rejects when the build fails
 */
export function runElectronBuilder(extraArgs = []) {
  // An unsigned private build: never let electron-builder go looking for a
  // signing identity on this machine.
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

  const builderPkgPath = require.resolve("electron-builder/package.json");
  const builderPkg = require(builderPkgPath);
  const binField = builderPkg.bin;
  const binRel =
    typeof binField === "string" ? binField : binField["electron-builder"];
  if (!binRel) {
    throw new Error("electron-builder package.json is missing bin");
  }
  const builderBin = path.join(path.dirname(builderPkgPath), binRel);

  // npm workspaces hoist electron to the repo root; electron-builder 26 only
  // reads apps/desktop/node_modules/electron and otherwise treats "^35.0.0" as
  // an unresolvable range. Pass the installed version explicitly.
  const electronPkg = require(require.resolve("electron/package.json"));
  if (!electronPkg.version) {
    throw new Error("electron package.json is missing version");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        builderBin,
        "--win",
        `--config.electronVersion=${electronPkg.version}`,
        ...extraArgs,
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`electron-builder was killed by ${signal}`));
        return;
      }
      if (code) {
        reject(new Error(`electron-builder exited ${code}`));
        return;
      }
      resolve();
    });
  });
}
