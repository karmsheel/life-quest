import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Main stays ESM (.js, ESM loaded natively by Electron main).
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

// Preload MUST be CommonJS: Electron's ESM preload loader requires the .mjs
// extension, and an ESM-format .js preload is silently skipped — which leaves
// window.lifequest undefined and breaks every IPC call from the renderer.
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

console.log("[bundle-electron] wrote dist-electron/main.js + preload.js (cjs)");
