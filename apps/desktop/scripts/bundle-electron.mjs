import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outdir = path.join(root, "dist-electron");

/**
 * `__LIFEQUEST_E2E_SEAM__` is the one difference between the bundle that ships
 * and the bundle `npm run dev` serves.
 *
 * The e2e seam at the top of `main.ts` (profile redirection, update feed/trust/
 * launcher overrides) exists so a rig can run the real main process against a
 * throwaway world. It must not exist in the product: this build defines it
 * false, so the seam is dead code in the shipped `dist-electron/main.js` — a
 * packaged app cannot be pointed at another profile or update feed by setting an
 * environment variable. `dev.mjs` defines it true because that is the bundle
 * every rig and the bench run.
 *
 * `minifySyntax` is what actually removes it: without it esbuild keeps the
 * unreachable `if (false) { … }` body (and the seam's code and strings) in the
 * bundle even though it can never run. The flag is a syntax-level transform that
 * drops dead branches and folds constants; it does not rename identifiers
 * (`keepNames`) and it is production-only, so the dev bundle the rigs import
 * keeps readable stack traces.
 *
 * `sourcemap: false` is also production-only: a `.map` here would be packed into
 * `app.asar` beside `main.js`/`preload.js` and hand every reader the full
 * main-process and preload source (SUPP-06). `dev.mjs` keeps sourcemaps.
 */
const LIFEQUEST_DEFINE = { __LIFEQUEST_E2E_SEAM__: "false" };

// Main stays ESM (.js, ESM loaded natively by Electron main).
await build({
  entryPoints: [path.join(root, "electron/main.ts")],
  outdir,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  sourcemap: false,
  minifySyntax: true,
  keepNames: true,
  target: "node20",
  define: LIFEQUEST_DEFINE,
});

// Preload MUST be CommonJS: Electron's ESM preload loader requires the .mjs
// extension, and an ESM-format .js preload is silently skipped — which leaves
// window.lifequest undefined and breaks every IPC call from the renderer.
await build({
  entryPoints: [path.join(root, "electron/preload.ts")],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: false,
  target: "node20",
});

/**
 * A leftover `.map` from an earlier dev build would still be packed into
 * `app.asar` beside the production bundles — and hand every reader the full
 * main/preload source. The production build writes no sourcemaps, so delete any
 * that a previous `npm run dev` left behind.
 */
for (const stale of ["main.js.map", "preload.js.map"]) {
  fs.rmSync(path.join(outdir, stale), { force: true });
}

console.log("[bundle-electron] wrote dist-electron/main.js + preload.js (cjs, no sourcemaps)");
