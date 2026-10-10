/**
 * `npm run package` — a dev build, for running the app without `npm run dev`.
 *
 * `--dir` pins the output to the unpacked folder regardless of what
 * `electron-builder.yml` lists, so this stays fast and produces no installers.
 * `npm run release` is the shippable build.
 */
import { runElectronBuilder } from "./electron-builder.mjs";

try {
  await runElectronBuilder(["--dir"]);
} catch (err) {
  console.error(err);
  process.exit(1);
}
