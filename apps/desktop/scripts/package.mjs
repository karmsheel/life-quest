import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

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

const child = spawn(
  process.execPath,
  [builderBin, "--win", "--dir", `--config.electronVersion=${electronPkg.version}`],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
