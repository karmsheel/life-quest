import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    /**
     * Keep the build outputs, the e2e artifacts, and the rig DRIVERS out of the
     * watcher.
     *
     * A rig writes its report and its screenshot under `e2e/artifacts/`, which is
     * inside this root, so the watcher saw a rig's own output as a source change
     * and pushed an HMR message at the page that had just written it. The page's
     * HMR client then processed an update for a module nothing had edited, on the
     * same thread the rig was waiting on: `executeJavaScript` stopped settling,
     * and a run died at whichever step happened to be in flight — measured as a
     * 90-second timeout at a different step each run.
     *
     * The drivers and the tests are the same hazard from the other side: a
     * `*.electron.mjs` rig or a `tests/*.test.ts` is Node code no page imports, so
     * editing one makes this server push a full reload at every connected page —
     * including a rig that was started a moment later. The harness PAGES
     * (`e2e/*.tsx`, `e2e/*.html`) and the fixtures they import stay watched,
     * because a change to those is exactly what a rig is meant to pick up.
     */
    watch: {
      ignored: [
        "**/e2e/artifacts/**",
        "**/e2e/*.mjs",
        "**/e2e/*.mts",
        "**/tests/**",
        "**/dist/**",
        "**/release/**",
      ],
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
