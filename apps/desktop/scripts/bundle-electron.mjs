import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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

console.log("[bundle-electron] wrote dist-electron/main.js + preload.js");
