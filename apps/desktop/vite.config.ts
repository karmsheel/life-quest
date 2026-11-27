import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The splash's four lockups, injected into `index.html` at build time.
 *
 * The splash paints before the app bundle, so it cannot import React or the
 * logo components — and a baked-in colour cannot follow the theme. The four
 * SVGs therefore go in as markup (hidden by `splash.css` until `data-logo`
 * names one), and the files are read from the same `src/assets/brand/logo/`
 * directory the rail draws (`LifeQuestLogo` imports them as raw text). One
 * source of truth for the art; no hand-copied paths in `index.html`.
 */
const SPLASH_LOGOS = [
  ["modern", "01-modern"],
  ["athletic", "02-athletic"],
  ["classic", "03-classic"],
  ["minimal", "04-minimal"],
] as const;

function splashLogos(): Plugin {
  const logoDir = path.resolve(__dirname, "src/assets/brand/logo");
  return {
    name: "lifequest-splash-logo",
    transformIndexHtml(html) {
      if (!html.includes("<!-- splash-logo -->")) return html;
      const variants = SPLASH_LOGOS.map(([id, file]) => {
        const svg = fs
          .readFileSync(path.join(logoDir, `${file}.svg`), "utf8")
          .trim()
          // The splash owns the accessible name; the inline copy is the art.
          .replace(
            "<svg ",
            '<svg class="splash__logo-svg" aria-hidden="true" focusable="false" ',
          );
        return `<span class="splash__logo-variant" data-splash-logo="${id}">${svg}</span>`;
      }).join("\n        ");
      return html.replace(
        "<!-- splash-logo -->",
        `<div class="splash__logo" role="img" aria-label="LifeQuest">\n        ${variants}\n      </div>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), splashLogos()],
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
