import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Emit the service worker with the build's own asset names.
 *
 * The worker cannot be a `public/` file with placeholders: Vite copies public
 * files after the plugin hooks that could rewrite them, so a rewrite is silently
 * overwritten. It is emitted as a bundle asset instead, with the hashed names
 * substituted from this build. `sw.js` is served no-store by the door, so a new
 * build is seen on the next navigation.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: "lifequest-phone-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => name.startsWith("assets/"))
        .map((name) => `/phone/${name}`);
      const files = ["/phone/", "/phone/manifest.webmanifest", ...assets];
      const source = fs
        .readFileSync(path.join(__dirname, "sw.js"), "utf8")
        .replace("__PRECACHE__", JSON.stringify(files))
        .replace("__CACHE_VERSION__", Date.now().toString(36));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: "/phone/",
  publicDir: path.join(__dirname, "public"),
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    outDir: path.resolve(__dirname, "../dist-phone"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
