/**
 * Tiny static server for the landing page. No dependencies.
 *
 *   node apps/landing/scripts/serve.mjs [port]
 *
 * Serves `apps/landing` as the document root. The site is plain HTML, CSS and
 * JavaScript, so there is no build step: open http://localhost:4319/ and edit.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || process.env.PORT || 4319);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(ROOT, relative);

    // Never serve outside the landing directory.
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      const index = path.join(target, "index.html");
      info = await stat(index).catch(() => null);
      if (!info) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[".html"],
        "cache-control": "no-cache",
      });
      createReadStream(index).pipe(response);
      return;
    }

    if (!info) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(target).toLowerCase();
    response.writeHead(200, {
      "content-type": MIME[extension] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": extension === ".woff2" || extension === ".png" ? "public, max-age=86400" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error?.message || error}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[lifequest-landing] http://${HOST}:${PORT}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
