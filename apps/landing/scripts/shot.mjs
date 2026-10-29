/**
 * Screenshot utility for the landing page. No dependencies.
 *
 *   node scripts/shot.mjs [url] [outDir]
 *
 * Launches system Chromium with a throwaway profile, drives it over the
 * DevTools protocol, scrolls the whole page once so every reveal has fired,
 * then writes:
 *
 *   hero.png       1440 x 900 viewport, top of page
 *   full.png       full page at 1440 CSS px
 *   mobile.png     full page at 390 CSS px
 *   harness.png    the harness section at 1440
 *   alignment.png  the alignment section at 1440
 *   access.png     the access section at 1440
 *
 * The e2e rig uses the same protocol code; this file is the fast visual loop.
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_TO_OPEN = process.argv[2] || "http://127.0.0.1:4319/";
const OUT = path.resolve(process.argv[3] || path.join(HERE, "..", "e2e", "artifacts"));

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "chromium",
  "google-chrome",
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error("No Chromium found. Set CHROME=/path/to/chrome.");
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const listeners = this.events.get(message.method) || [];
        listeners.forEach((listener) => listener(message.params, message.sessionId));
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(listener);
  }

  waitFor(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitForPort(port, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Chromium did not open port ${port}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profile = `/tmp/lifequest-landing-shot-${process.pid}`;
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--remote-debugging-port=9222",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const info = await waitForPort(9222);
    const cdp = new CDP(info.webSocketDebuggerUrl);
    await cdp.ready;

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = cdp.waitFor("Page.loadEventFired");
    await send("Page.navigate", { url: URL_TO_OPEN });
    await loaded;
    await send("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => true)",
      awaitPromise: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // Scroll the page in steps so every IntersectionObserver reveal fires.
    await send("Runtime.evaluate", {
      expression: `(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        const step = Math.round(window.innerHeight * 0.7);
        for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        return true;
      })()`,
      awaitPromise: true,
    });

    // The rig's captures should show the finished state, not a transition
    // caught mid-flight. The page's own reveal behaviour is covered by e2e.
    await send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
        return true;
      })()`,
    });
    await new Promise((resolve) => setTimeout(resolve, 900));

    const shot = async (name, options = {}) => {
      const result = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        ...options,
      });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.join(OUT, name), Buffer.from(result.data, "base64"));
      console.log(`  wrote ${path.join(OUT, name)}`);
    };

    await send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await shot("hero.png", { captureBeyondViewport: false });

    await send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const regions = {
      "harness.png": "#harness",
      "alignment.png": "#alignment",
      "access.png": "#access",
    };
    for (const [name, selector] of Object.entries(regions)) {
      const rect = await send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
        })()`,
        returnByValue: true,
      });
      const box = rect.result.value;
      if (box) {
        await shot(name, {
          clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 2600), scale: 1 },
        });
      }
    }

    const metrics = await send("Page.getLayoutMetrics");
    const width = Math.ceil(metrics.cssContentSize.width);
    const height = Math.ceil(metrics.cssContentSize.height);
    await shot("full.png", {
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobileLoaded = cdp.waitFor("Page.loadEventFired");
    await send("Page.reload", { ignoreCache: false });
    await mobileLoaded;
    await send("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => true)",
      awaitPromise: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await send("Runtime.evaluate", {
      expression: `(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        const step = Math.round(window.innerHeight * 0.7);
        for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 110));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        return true;
      })()`,
      awaitPromise: true,
    });
    const mobileMetrics = await send("Page.getLayoutMetrics");
    await shot("mobile.png", {
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(mobileMetrics.cssContentSize.width),
        height: Math.ceil(mobileMetrics.cssContentSize.height),
        scale: 1,
      },
    });

    cdp.close();
  } finally {
    chrome.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true });
  }

  if (stderr.includes("FATAL")) console.error(stderr.slice(-2000));
  console.log("done");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
