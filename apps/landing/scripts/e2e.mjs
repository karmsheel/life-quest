#!/usr/bin/env node
/**
 * LifeQuest landing page — dependency-free E2E + visual-artifact rig.
 *
 * WHAT IT IS
 *   One self-contained end-to-end check of `apps/landing`. It starts its own
 *   static server on a free loopback port (unless BASE_URL is given), launches
 *   the system Chromium headless with a throwaway profile, and drives it over
 *   the DevTools protocol using Node 22's global WebSocket. No npm packages, no
 *   build step, no global state: `node apps/landing/scripts/e2e.mjs` works from
 *   a cold shell and exits non-zero if anything fails.
 *
 * EXACT COMMAND
 *   node apps/landing/scripts/e2e.mjs
 *
 *   Optional environment overrides:
 *   - BASE_URL=http://127.0.0.1:4319/   reuse an already-running server
 *   - CHROME=/path/to/chrome            use a different Chromium binary
 *
 * WHAT IT PROVES
 *   The shipped page (not a mock) is served, loads without console or network
 *   errors, uses its bundled fonts, and works at 1440, 1024, 768 and 390 CSS px:
 *     - document metadata: HTTP 200, title, meta description, parseable JSON-LD
 *     - hero copy, all five brand marks decoded, no failed requests
 *     - Instrument Serif / Instrument Sans actually loaded and applied
 *     - every nav link scrolls to its section (hash + scroll-margin alignment)
 *     - harness tabs: click, hidden/aria state, ArrowRight keyboard selection
 *     - alignment stack: six rows, row 1 default, focusing row 3 drives preview
 *     - access form: empty/invalid rejection, valid submit swaps in the success
 *     - prefers-reduced-motion: no reveal is left hidden or transformed
 *     - mobile menu: opens, six links, Escape closes; no horizontal overflow
 *     - accessibility smoke: one h1, alt text, tab/panel wiring, skip link is
 *       the first tab stop, no positive tabindex, labelled input, color-scheme
 *
 * ARTIFACTS (overwritten on every run; paths relative to the repo root)
 *   apps/landing/e2e/report.json               full machine-readable report
 *   apps/landing/e2e/artifacts/e2e-report.json copy of the same report
 *   apps/landing/e2e/artifacts/e2e-hero-desktop.png      1440x900 top of page
 *   apps/landing/e2e/artifacts/e2e-full-desktop.png      full page at 1440
 *   apps/landing/e2e/artifacts/e2e-full-mobile.png       full page at 390
 *   apps/landing/e2e/artifacts/e2e-harness-tab.png       #harness, Decisions tab
 *   apps/landing/e2e/artifacts/e2e-alignment-agents.png  #alignment, row 3 focused
 *   apps/landing/e2e/artifacts/e2e-access-success.png    #access after valid submit
 *   apps/landing/e2e/artifacts/e2e-mobile-menu.png       390x844 with menu open
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* --------------------------------------------------------------------------
   Paths, constants and shared state
   -------------------------------------------------------------------------- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(APP, "..", "..");
const ARTIFACTS = path.join(APP, "e2e", "artifacts");
const REPORT_PATH = path.join(APP, "e2e", "report.json");
const ARTIFACT_REPORT_PATH = path.join(ARTIFACTS, "e2e-report.json");
const SERVE_SCRIPT = path.join(HERE, "serve.mjs");

const COMMAND = "node apps/landing/scripts/e2e.mjs";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const PRODUCT_FILES = ["index.html", "styles.css", "main.js"];
const NAV_TARGETS = [
  { label: "Manifesto", hash: "#premise" },
  { label: "The Harness", hash: "#harness" },
  { label: "Alignment", hash: "#alignment" },
  { label: "Sovereignty", hash: "#sovereignty" },
  { label: "The System", hash: "#system" },
];
const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "chromium",
  "google-chrome",
].filter(Boolean);
const SCREENSHOT_SPECS = [
  { name: "e2e-hero-desktop.png", width: DESKTOP.width, height: DESKTOP.height, minHeight: DESKTOP.height, maxHeight: DESKTOP.height },
  { name: "e2e-full-desktop.png", width: DESKTOP.width, minHeight: 3000 },
  { name: "e2e-full-mobile.png", width: MOBILE.width, minHeight: 3000 },
  { name: "e2e-harness-tab.png", width: DESKTOP.width, minHeight: 800 },
  { name: "e2e-alignment-agents.png", width: DESKTOP.width, minHeight: 800 },
  { name: "e2e-access-success.png", width: DESKTOP.width, minHeight: 600 },
  { name: "e2e-mobile-menu.png", width: MOBILE.width, height: MOBILE.height, minHeight: MOBILE.height, maxHeight: MOBILE.height },
];

const state = {
  startedAt: Date.now(),
  phase: "setup",
  baseUrl: null,
  serverMode: null,
  serverPort: null,
  server: null,
  serverLog: "",
  chrome: null,
  chromePath: null,
  chromePort: null,
  chromeWsUrl: null,
  chromeVersion: null,
  chromeLog: "",
  chromeFlags: [],
  profile: null,
  cdp: null,
  sessionId: null,
  checks: [],
  screenshots: [],
  consoleErrors: [],
  exceptions: [],
  failedRequests: [],
  httpErrors: [],
  ignoredNetwork: [],
  requestCount: 0,
  warnings: [],
  fatal: null,
  productHashes: {},
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setPhase = (phase) => {
  state.phase = phase;
};

function repoRelative(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  return relative.startsWith("..") ? filePath : relative.split(path.sep).join("/");
}

/* --------------------------------------------------------------------------
   Minimal DevTools protocol client (same pattern as scripts/shot.mjs)
   -------------------------------------------------------------------------- */

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

  off(method, listener) {
    const listeners = this.events.get(method);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
  }

  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(method, handler);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const handler = (params) => {
        clearTimeout(timer);
        this.off(method, handler);
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already gone
    }
  }
}

/* --------------------------------------------------------------------------
   Browser / server plumbing
   -------------------------------------------------------------------------- */

function send(method, params = {}) {
  return state.cdp.send(method, params, state.sessionId);
}

async function evaluate(expression, options = {}) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: true,
    ...options,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(`page evaluate failed: ${description}`);
  }
  return response.result?.value;
}

async function waitFor(expression, label, timeout = 8000) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeout) {
    lastValue = await evaluate(expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label} (last value: ${JSON.stringify(lastValue)})`);
}

function frame() {
  return evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}

async function waitForAnimations(timeout = 8000) {
  await evaluate(`new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const running = document.getAnimations().filter((animation) => {
        try {
          const timing = animation.effect.getTiming();
          return timing.iterations !== Infinity;
        } catch {
          return false;
        }
      }).filter((animation) => animation.playState !== "finished" && animation.playState !== "idle");
      if (running.length === 0 || performance.now() - started > ${timeout}) resolve(true);
      else requestAnimationFrame(tick);
    };
    tick();
  })`);
}

async function settle() {
  try {
    await evaluate("document.fonts.ready.then(() => true)");
  } catch {
    // fonts API unavailable — the fonts check will report it
  }
  try {
    await waitFor(
      'window.__LIFEQUEST_LANDING_READY__ === true && document.documentElement.dataset.ready === "true"',
      "landing ready signal",
      12000
    );
  } catch (error) {
    state.warnings.push(`ready signal: ${error.message}`);
  }
  await frame();
  await waitForAnimations();
}

async function loadUrl(url) {
  const loaded = state.cdp.once("Page.loadEventFired", 30000);
  await send("Page.navigate", { url });
  await loaded;
  await settle();
}

async function reloadPage() {
  const loaded = state.cdp.once("Page.loadEventFired", 30000);
  await send("Page.reload", { ignoreCache: false });
  await loaded;
  await settle();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

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

async function startServer() {
  if (process.env.BASE_URL) {
    const baseUrl = process.env.BASE_URL.replace(/\/?$/, "/");
    const response = await fetch(baseUrl).catch((error) => {
      throw new Error(`BASE_URL is not reachable (${baseUrl}): ${error.message}`);
    });
    if (!response.ok) throw new Error(`BASE_URL responded ${response.status}: ${baseUrl}`);
    return { baseUrl, mode: "external BASE_URL", port: new URL(baseUrl).port || "80" };
  }

  const port = await freePort();
  const server = spawn(process.execPath, [SERVE_SCRIPT, String(port)], {
    cwd: APP,
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.server = server;
  server.stdout.on("data", (chunk) => {
    state.serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    state.serverLog += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}/`;
  const started = Date.now();
  while (Date.now() - started < 12000) {
    if (server.exitCode !== null) {
      throw new Error(`static server exited early (code ${server.exitCode}):\n${state.serverLog.slice(-1500)}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return { baseUrl, mode: "owned static server", port };
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error(`static server did not answer on ${baseUrl}:\n${state.serverLog.slice(-1500)}`);
}

async function waitForDebuggerPort(port, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (state.chrome.exitCode !== null) {
      throw new Error(`Chromium exited early (code ${state.chrome.exitCode}):\n${state.chromeLog.slice(-2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const info = await response.json();
        if (info.webSocketDebuggerUrl?.includes(`:${port}/`)) return info;
      }
    } catch {
      // not listening yet
    }
    await sleep(120);
  }
  throw new Error(`Chromium did not open debugging port ${port}:\n${state.chromeLog.slice(-2000)}`);
}

async function launchChrome() {
  const chromePath = findChrome();
  const port = await freePort();
  const profile = path.join(os.tmpdir(), `lifequest-landing-e2e-${process.pid}-${Date.now()}`);
  await rm(profile, { recursive: true, force: true });

  const flags = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "about:blank",
  ];

  const chrome = spawn(chromePath, flags, { stdio: ["ignore", "ignore", "pipe"] });
  state.chrome = chrome;
  state.chromePath = chromePath;
  state.chromePort = port;
  state.profile = profile;
  state.chromeFlags = flags.filter((flag) => !flag.startsWith("--user-data-dir") && !flag.startsWith("--remote-debugging-port"));
  chrome.stderr.on("data", (chunk) => {
    state.chromeLog += chunk.toString();
  });

  const info = await waitForDebuggerPort(port);
  state.chromeVersion = info.Browser || "unknown";
  state.chromeWsUrl = info.webSocketDebuggerUrl;
}

async function setup() {
  await mkdir(ARTIFACTS, { recursive: true });
  state.productHashes = await hashProductFiles();

  const server = await startServer();
  state.baseUrl = server.baseUrl;
  state.serverMode = server.mode;
  state.serverPort = server.port;

  await launchChrome();

  state.cdp = new CDP(state.chromeWsUrl);
  await state.cdp.ready;

  const { targetId } = await state.cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await state.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  state.sessionId = sessionId;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  wirePageEvents();
}

function wirePageEvents() {
  const requestUrls = new Map();

  state.cdp.on("Network.requestWillBeSent", (params) => {
    state.requestCount += 1;
    requestUrls.set(params.requestId, params.request.url);
  });
  state.cdp.on("Network.loadingFailed", (params) => {
    state.failedRequests.push({
      url: requestUrls.get(params.requestId) || params.requestId,
      errorText: params.errorText,
      canceled: Boolean(params.canceled),
      phase: state.phase,
    });
  });
  state.cdp.on("Network.responseReceived", (params) => {
    if (params.response.status >= 400) {
      state.httpErrors.push({
        url: params.response.url,
        status: params.response.status,
        phase: state.phase,
      });
    }
  });
  state.cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error") return;
    state.consoleErrors.push({
      text: params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
      phase: state.phase,
    });
  });
  state.cdp.on("Runtime.exceptionThrown", (params) => {
    state.exceptions.push({
      text: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
      url: params.exceptionDetails.url,
      lineNumber: params.exceptionDetails.lineNumber,
      phase: state.phase,
    });
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await sleep(200);
  }
}

async function cleanup() {
  state.cdp?.close();
  await stopProcess(state.chrome);
  if (state.profile) await rm(state.profile, { recursive: true, force: true }).catch(() => {});
  await stopProcess(state.server);
}

/* --------------------------------------------------------------------------
   Interaction helpers
   -------------------------------------------------------------------------- */

async function elementBox(selector, { scrollIntoView = true } = {}) {
  const box = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    ${scrollIntoView ? "element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });" : ""}
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2,
    };
  })()`);
  if (!box) throw new Error(`element not found: ${selector}`);
  return box;
}

async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await frame();
}

async function clickSelector(selector, options = {}) {
  const box = await elementBox(selector, options);
  await clickAt(box.centerX, box.centerY);
  return box;
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await frame();
}

async function insertText(text) {
  await send("Input.insertText", { text });
  await frame();
}

async function scrollToTop() {
  await evaluate("window.scrollTo(0, 0); true");
  await frame();
}

async function waitForScrollSettled(timeout = 4000) {
  const started = Date.now();
  let previous = Number.NaN;
  while (Date.now() - started < timeout) {
    const current = await evaluate("Math.round(window.scrollY)");
    if (current === previous) return current;
    previous = current;
    await sleep(80);
  }
  return previous;
}

async function scrollThroughPage() {
  await evaluate(`(async () => {
    const root = document.documentElement;
    root.style.scrollBehavior = "auto";
    const step = Math.max(240, Math.round(window.innerHeight * 0.7));
    for (let y = 0; y <= root.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 70)));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  })()`);
  await waitFor('document.querySelectorAll(".reveal:not(.is-in)").length === 0', "every .reveal element to enter naturally", 10000);
  await waitForAnimations();
}

/* --------------------------------------------------------------------------
   Screenshot helpers
   -------------------------------------------------------------------------- */

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return { width: null, height: null };
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function capture(name, { clip = null } = {}) {
  const params = { format: "png", fromSurface: true };
  if (clip) {
    params.captureBeyondViewport = true;
    params.clip = {
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      width: Math.round(clip.width),
      height: Math.round(clip.height),
      scale: 1,
    };
  } else {
    params.captureBeyondViewport = false;
  }
  const response = await send("Page.captureScreenshot", params);
  const buffer = Buffer.from(response.data, "base64");
  const filePath = path.join(ARTIFACTS, name);
  await writeFile(filePath, buffer);
  const size = pngSize(buffer);
  const record = {
    name,
    path: repoRelative(filePath),
    phase: state.phase,
    width: size.width,
    height: size.height,
    bytes: buffer.length,
    capturedAt: new Date().toISOString(),
  };
  state.screenshots.push(record);
  console.log(`         captured ${name} (${size.width}x${size.height}, ${Math.round(buffer.length / 1024)} KB)`);
  return record;
}

async function captureSection(name, selector) {
  // Scroll home first so the fixed header cannot paint over the clip region.
  await scrollToTop();
  const box = await elementBox(selector, { scrollIntoView: false });
  return capture(name, {
    clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 4000) },
  });
}

async function captureFullPage(name) {
  await scrollToTop();
  const metrics = await send("Page.getLayoutMetrics");
  const size = metrics.cssContentSize || metrics.contentSize;
  return capture(name, {
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height) },
  });
}

/* --------------------------------------------------------------------------
   Check plumbing
   -------------------------------------------------------------------------- */

async function check(id, group, name, run) {
  const started = Date.now();
  let pass = false;
  let actual = null;
  let summary = "";
  let details;
  try {
    const result = await run();
    pass = Boolean(result?.pass);
    actual = result?.actual ?? null;
    summary = result?.summary || (pass ? "ok" : "assertion failed");
    details = result?.details;
  } catch (error) {
    actual = { error: error?.message || String(error) };
    summary = `threw: ${error?.message || error}`;
  }
  const entry = { id, group, name, pass, summary, actual, details, durationMs: Date.now() - started };
  state.checks.push(entry);
  console.log(`${(pass ? "PASS" : "FAIL").padEnd(5)}${id.padEnd(5)} ${name}`);
  if (!pass) console.log(`           ↳ ${summary}`);
  return entry;
}

function identityTransform(value) {
  return value === "none" || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(value);
}

/* --------------------------------------------------------------------------
   Desktop phase
   -------------------------------------------------------------------------- */

async function runDesktopPhase() {
  setPhase("desktop");
  await send("Emulation.setDeviceMetricsOverride", {
    width: DESKTOP.width,
    height: DESKTOP.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await loadUrl(state.baseUrl);

  /* ---- readiness ------------------------------------------------------- */
  await check("0.1", "Readiness", "page signals ready after fonts and first paint", async () => {
    const actual = await evaluate(`({
      flag: window.__LIFEQUEST_LANDING_READY__ === true,
      dataReady: document.documentElement.dataset.ready === "true",
      fontsStatus: document.fonts.status,
      revealCount: document.querySelectorAll(".reveal").length,
      revealOnLoadCount: document.querySelectorAll(".reveal-on-load").length
    })`);
    return {
      pass: actual.flag && actual.dataReady && actual.fontsStatus === "loaded",
      actual,
      summary: `flag=${actual.flag} data-ready=${actual.dataReady} fonts=${actual.fontsStatus}`,
    };
  });

  /* ---- 1. document ----------------------------------------------------- */
  await check("1.1", "Document", "server responds 200 with an HTML document", async () => {
    const response = await fetch(state.baseUrl, { headers: { "cache-control": "no-cache" } });
    const body = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const pass = response.status === 200 && contentType.includes("text/html") && body.toLowerCase().includes("<!doctype html>");
    return {
      pass,
      actual: { status: response.status, contentType, bytes: body.length },
      summary: `status=${response.status} type=${contentType} bytes=${body.length}`,
    };
  });

  await check("1.2", "Document", "document title is set and names LifeQuest", async () => {
    const title = await evaluate("document.title");
    const pass = typeof title === "string" && title.trim().length >= 10 && /lifequest/i.test(title);
    return { pass, actual: { title }, summary: `title=${JSON.stringify(title)}` };
  });

  await check("1.3", "Document", "meta description is non-empty", async () => {
    const content = await evaluate('document.querySelector(\'meta[name="description"]\')?.content?.trim() ?? ""');
    const pass = content.length >= 40;
    return { pass, actual: { length: content.length, content }, summary: `length=${content.length}` };
  });

  await check("1.4", "Document", "JSON-LD blocks parse and describe the app", async () => {
    const actual = await evaluate(`(() => {
      const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const parsed = [];
      const errors = [];
      for (const block of blocks) {
        try {
          const value = JSON.parse(block.textContent);
          parsed.push({ type: value["@type"] ?? null, name: value.name ?? null, context: value["@context"] ?? null });
        } catch (error) {
          errors.push(String(error));
        }
      }
      return { blocks: blocks.length, parsed, errors };
    })()`);
    const pass = actual.blocks >= 1 && actual.errors.length === 0 && actual.parsed.some((item) => item.context && item.type);
    return { pass, actual, summary: `blocks=${actual.blocks} errors=${actual.errors.length}` };
  });

  /* ---- 3. fonts -------------------------------------------------------- */
  await check("3.1", "Fonts", "document.fonts is loaded", async () => {
    const actual = await evaluate("document.fonts.ready.then(() => ({ status: document.fonts.status, size: document.fonts.size }))");
    return { pass: actual.status === "loaded", actual, summary: `status=${actual.status} faces=${actual.size}` };
  });

  await check("3.2", "Fonts", "h1 uses Instrument Serif and the face is loaded", async () => {
    const actual = await evaluate(`(() => {
      const family = getComputedStyle(document.querySelector("h1")).fontFamily;
      return { family, loaded: document.fonts.check('16px "Instrument Serif"') };
    })()`);
    const pass = actual.family.includes("Instrument Serif") && actual.loaded;
    return { pass, actual, summary: `family=${actual.family} loaded=${actual.loaded}` };
  });

  await check("3.3", "Fonts", "body uses Instrument Sans and the face is loaded", async () => {
    const actual = await evaluate(`(() => {
      const family = getComputedStyle(document.body).fontFamily;
      return { family, loaded: document.fonts.check('16px "Instrument Sans"') };
    })()`);
    const pass = actual.family.includes("Instrument Sans") && actual.loaded;
    return { pass, actual, summary: `family=${actual.family} loaded=${actual.loaded}` };
  });

  /* ---- 2. hero copy ---------------------------------------------------- */
  await check("2.1", "Hero", 'hero h1 contains "Own the" and "axis"', async () => {
    const text = await evaluate('document.querySelector("h1").textContent.replace(/\\s+/g, " ").trim()');
    const pass = text.includes("Own the") && /\baxis\b/i.test(text);
    return { pass, actual: { text }, summary: `h1=${JSON.stringify(text)}` };
  });

  /* ---- 6. alignment default ------------------------------------------- */
  await check("6.1", "Alignment", "six stack rows and row 1 active by default", async () => {
    const actual = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("[data-layer]")];
      return {
        rows: rows.length,
        buttons: rows.filter((row) => row.tagName === "BUTTON").length,
        active: rows.findIndex((row) => row.classList.contains("is-active")),
        previewTitle: document.querySelector("[data-stack-title]")?.textContent.trim(),
        previewIndex: document.querySelector("[data-stack-index]")?.textContent.trim(),
      };
    })()`);
    const pass =
      actual.rows === 6 &&
      actual.buttons === 6 &&
      actual.active === 0 &&
      actual.previewTitle === "You" &&
      actual.previewIndex === "01 / 06";
    return { pass, actual, summary: `rows=${actual.rows} active=${actual.active} preview=${actual.previewTitle} ${actual.previewIndex}` };
  });

  /* ---- 5. tabs default ------------------------------------------------- */
  await check("5.1", "Harness tabs", "three tabs exist with Today selected and matching panels", async () => {
    const actual = await evaluate(`(() => {
      const tabs = [...document.querySelectorAll("[role=tab]")];
      const panels = [...document.querySelectorAll("[role=tabpanel]")];
      const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.id);
      return {
        tabs: tabs.length,
        panels: panels.length,
        selected,
        todayHidden: document.querySelector('[data-mock-panel="today"]').hidden,
        decisionsHidden: document.querySelector('[data-mock-panel="decisions"]').hidden,
        contextHidden: document.querySelector('[data-mock-panel="context"]').hidden,
      };
    })()`);
    const pass =
      actual.tabs === 3 &&
      actual.panels === 3 &&
      actual.selected.length === 1 &&
      actual.selected[0] === "tab-today" &&
      actual.todayHidden === false &&
      actual.decisionsHidden === true &&
      actual.contextHidden === true;
    return { pass, actual, summary: `tabs=${actual.tabs} selected=${actual.selected.join(",")}` };
  });

  /* ---- 10. accessibility smoke ---------------------------------------- */
  await check("10.1", "Accessibility", "exactly one h1", async () => {
    const actual = await evaluate('({ count: document.querySelectorAll("h1").length, texts: [...document.querySelectorAll("h1")].map((el) => el.textContent.trim().slice(0, 60)) })');
    return { pass: actual.count === 1, actual, summary: `h1 count=${actual.count}` };
  });

  await check("10.2", "Accessibility", "every img has an alt attribute", async () => {
    const actual = await evaluate(`(() => {
      const images = [...document.images];
      const missing = images.filter((image) => !image.hasAttribute("alt")).map((image) => image.currentSrc || image.src);
      return { images: images.length, missing };
    })()`);
    return { pass: actual.images > 0 && actual.missing.length === 0, actual, summary: `images=${actual.images} missing-alt=${actual.missing.length}` };
  });

  await check("10.3", "Accessibility", "every role=tab aria-controls resolves to a panel", async () => {
    const actual = await evaluate(`[...document.querySelectorAll("[role=tab]")].map((tab) => ({
      id: tab.id,
      controls: tab.getAttribute("aria-controls"),
      resolves: Boolean(document.getElementById(tab.getAttribute("aria-controls") || "")),
    }))`);
    const pass = actual.length > 0 && actual.every((tab) => tab.controls && tab.resolves);
    return { pass, actual, summary: `${actual.filter((tab) => tab.resolves).length}/${actual.length} controls resolve` };
  });

  await check("10.4", "Accessibility", "skip link is the first tab stop and targets #main", async () => {
    await evaluate("window.scrollTo(0, 0); document.body.focus(); true");
    await pressKey("Tab", "Tab", 9);
    await sleep(120);
    const actual = await evaluate(`(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? null,
        className: typeof active?.className === "string" ? active.className : null,
        href: active?.getAttribute?.("href") ?? null,
        mainExists: Boolean(document.getElementById("main")),
        focusVisible: Boolean(active?.matches?.(":focus-visible")),
      };
    })()`);
    const pass =
      String(actual.className || "").includes("skip-link") && actual.href === "#main" && actual.mainExists;
    await evaluate("document.activeElement?.blur?.(); true");
    return { pass, actual, summary: `first tab stop=${actual.tag}.${actual.className} href=${actual.href}` };
  });

  await check("10.5", "Accessibility", "no element has a positive tabindex", async () => {
    const actual = await evaluate(`(() => {
      const positive = [...document.querySelectorAll("[tabindex]")]
        .filter((element) => Number(element.getAttribute("tabindex")) > 0)
        .map((element) => ({ tag: element.tagName, className: String(element.className).slice(0, 60), tabindex: element.getAttribute("tabindex") }));
      return { positive, all: document.querySelectorAll("[tabindex]").length };
    })()`);
    return { pass: actual.positive.length === 0, actual, summary: `positive=${actual.positive.length}` };
  });

  await check("10.6", "Accessibility", "access email input has an associated label", async () => {
    const actual = await evaluate(`(() => {
      const input = document.querySelector('[data-testid="access-email"]');
      if (!input) return null;
      return {
        id: input.id,
        labels: [...(input.labels || [])].map((label) => label.textContent.trim()),
      };
    })()`);
    const pass = Boolean(actual && actual.labels.length > 0 && actual.labels.every((label) => label.length > 0));
    return { pass, actual, summary: `labels=${JSON.stringify(actual?.labels ?? [])}` };
  });

  await check("10.7", "Accessibility", "color-scheme meta is declared", async () => {
    const actual = await evaluate('({ content: document.querySelector(\'meta[name="color-scheme"]\')?.content ?? null })');
    return { pass: Boolean(actual.content && actual.content.trim()), actual, summary: `color-scheme=${actual.content}` };
  });

  /* ---- hero screenshot (top of page, animations settled) -------------- */
  setPhase("screenshot:hero");
  await scrollToTop();
  await capture("e2e-hero-desktop.png");

  /* ---- reveal the whole page naturally, then check assets -------------- */
  setPhase("scroll-through");
  await scrollThroughPage();

  await check("2.2", "Hero", "all five brand marks decoded (naturalWidth > 0)", async () => {
    const actual = await evaluate(`(() => {
      const targets = [
        ["header mark", '[data-testid="site-header"] .brand__mark'],
        ["hero mark", ".axis__mark"],
        ["harness mark", ".window__brand img"],
        ["access mark", ".access__orbits img"],
        ["footer mark", '[data-testid="site-footer"] .brand__mark'],
      ];
      return targets.map(([name, selector]) => {
        const image = document.querySelector(selector);
        return {
          name,
          selector,
          found: Boolean(image),
          naturalWidth: image?.naturalWidth ?? 0,
          complete: image?.complete ?? false,
          src: image?.currentSrc || image?.src || null,
        };
      });
    })()`);
    const pass = actual.length === 5 && actual.every((image) => image.found && image.complete && image.naturalWidth > 0);
    return {
      pass,
      actual,
      summary: actual.map((image) => `${image.name}=${image.naturalWidth}`).join(" "),
    };
  });

  /* ---- full desktop page (default state, every reveal settled) --------- */
  setPhase("screenshot:full-desktop");
  await captureFullPage("e2e-full-desktop.png");

  /* ---- 4. navigation --------------------------------------------------- */
  setPhase("navigation");
  await evaluate('document.documentElement.style.scrollBehavior = "auto"; true');
  for (const [index, target] of NAV_TARGETS.entries()) {
    await check(`4.${index + 1}`, "Navigation", `nav link "${target.label}" scrolls to ${target.hash}`, async () => {
      const box = await evaluate(`(() => {
        const link = document.querySelector('[data-nav-link][href="${target.hash}"]');
        if (!link) return null;
        const rect = link.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      if (!box) throw new Error(`nav link for ${target.hash} not found`);
      await clickAt(box.x, box.y);
      await waitFor(`location.hash === ${JSON.stringify(target.hash)}`, `hash ${target.hash}`, 5000);
      await waitForScrollSettled();
      const actual = await evaluate(`(() => {
        const section = document.querySelector(${JSON.stringify(target.hash)});
        const rect = section.getBoundingClientRect();
        const scrollMarginTop = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        return {
          hash: location.hash,
          scrollY: Math.round(window.scrollY),
          sectionTop: Math.round(rect.top * 100) / 100,
          scrollMarginTop,
        };
      })()`);
      const pass =
        actual.hash === target.hash &&
        actual.scrollY > 0 &&
        Math.abs(actual.sectionTop - actual.scrollMarginTop) <= 8;
      return {
        pass,
        actual,
        summary: `hash=${actual.hash} scrollY=${actual.scrollY} top=${actual.sectionTop} margin=${actual.scrollMarginTop}`,
      };
    });
  }

  /* ---- 5. tabs interaction -------------------------------------------- */
  setPhase("harness-tabs");
  await clickSelector('[data-mock-tab="decisions"]');
  await waitFor('document.querySelector(\'[data-mock-panel="decisions"]\').hidden === false', "decisions panel visible", 4000);
  await check("5.2", "Harness tabs", "clicking Decisions shows its panel and updates aria-selected", async () => {
    const actual = await evaluate(`(() => {
      const tabs = [...document.querySelectorAll("[role=tab]")];
      const decisions = document.querySelector('[data-mock-panel="decisions"]');
      return {
        selected: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.id),
        todayHidden: document.querySelector('[data-mock-panel="today"]').hidden,
        decisionsHidden: decisions.hidden,
        decisionsDisplay: getComputedStyle(decisions).display,
        decisionsHeight: Math.round(decisions.getBoundingClientRect().height),
      };
    })()`);
    const pass =
      actual.selected.length === 1 &&
      actual.selected[0] === "tab-decisions" &&
      actual.todayHidden === true &&
      actual.decisionsHidden === false &&
      actual.decisionsDisplay !== "none" &&
      actual.decisionsHeight > 0;
    return { pass, actual, summary: `selected=${actual.selected.join(",")} todayHidden=${actual.todayHidden} decisionsHidden=${actual.decisionsHidden}` };
  });

  setPhase("screenshot:harness");
  await captureSection("e2e-harness-tab.png", "#harness");

  await evaluate('document.querySelector(\'[data-mock-tab="decisions"]\').focus(); true');
  await pressKey("ArrowRight", "ArrowRight", 39);
  await waitFor('document.querySelector(\'[data-mock-tab="context"]\').getAttribute("aria-selected") === "true"', "context tab selected by keyboard", 4000);
  await check("5.3", "Harness tabs", "ArrowRight moves tab selection (and focus) to Context", async () => {
    const actual = await evaluate(`(() => {
      const tabs = [...document.querySelectorAll("[role=tab]")];
      return {
        selected: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.id),
        activeElement: document.activeElement?.id ?? null,
        contextHidden: document.querySelector('[data-mock-panel="context"]').hidden,
        decisionsHidden: document.querySelector('[data-mock-panel="decisions"]').hidden,
      };
    })()`);
    const pass =
      actual.selected.length === 1 &&
      actual.selected[0] === "tab-context" &&
      actual.activeElement === "tab-context" &&
      actual.contextHidden === false &&
      actual.decisionsHidden === true;
    return { pass, actual, summary: `selected=${actual.selected.join(",")} focus=${actual.activeElement}` };
  });

  await clickSelector('[data-mock-tab="context"]');
  await check("5.4", "Harness tabs", "clicking Context shows the context panel", async () => {
    const actual = await evaluate(`(() => {
      const context = document.querySelector('[data-mock-panel="context"]');
      return {
        selected: [...document.querySelectorAll("[role=tab]")].filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.id),
        contextHidden: context.hidden,
        contextDisplay: getComputedStyle(context).display,
        contextHeight: Math.round(context.getBoundingClientRect().height),
      };
    })()`);
    const pass =
      actual.selected.length === 1 &&
      actual.selected[0] === "tab-context" &&
      actual.contextHidden === false &&
      actual.contextDisplay !== "none" &&
      actual.contextHeight > 0;
    return { pass, actual, summary: `selected=${actual.selected.join(",")} contextHidden=${actual.contextHidden}` };
  });

  /* ---- 6. alignment interaction --------------------------------------- */
  setPhase("alignment");
  await check("6.2", "Alignment", "focusing row 3 (Agents) drives the preview title and index", async () => {
    await evaluate("document.querySelectorAll('[data-layer]')[2].focus(); true");
    await frame();
    const actual = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("[data-layer]")];
      return {
        previewTitle: document.querySelector("[data-stack-title]")?.textContent.trim(),
        previewIndex: document.querySelector("[data-stack-index]")?.textContent.trim(),
        activeRow: rows.findIndex((row) => row.classList.contains("is-active")),
        focusedRow: rows.indexOf(document.activeElement),
        rowTitle: rows[2]?.querySelector(".stack__title")?.textContent.trim(),
      };
    })()`);
    const pass =
      actual.previewTitle === "Agents" &&
      actual.previewIndex === "03 / 06" &&
      actual.activeRow === 2 &&
      actual.focusedRow === 2 &&
      actual.rowTitle === "Agents";
    return { pass, actual, summary: `preview=${actual.previewTitle} ${actual.previewIndex} active=${actual.activeRow}` };
  });

  setPhase("screenshot:alignment");
  await captureSection("e2e-alignment-agents.png", "#alignment");

  /* ---- 7. access form -------------------------------------------------- */
  setPhase("access-form");
  const consoleBaseline = state.consoleErrors.length + state.exceptions.length;

  await clickSelector('[data-testid="access-submit"]');
  await waitFor('document.querySelector(\'[data-testid="access-email"]\').getAttribute("aria-invalid") === "true"', "aria-invalid on empty submit", 4000);
  await check("7.1", "Access form", "empty submit marks the input invalid and keeps the form", async () => {
    const actual = await evaluate(`(() => {
      const form = document.querySelector('[data-testid="access-form"]');
      const input = document.querySelector('[data-testid="access-email"]');
      const status = document.querySelector('[data-testid="access-status"]');
      return {
        ariaInvalid: input.getAttribute("aria-invalid"),
        status: status.textContent.trim(),
        formHidden: form.hidden,
        formHeight: Math.round(form.getBoundingClientRect().height),
        focused: document.activeElement === input,
      };
    })()`);
    const pass =
      actual.ariaInvalid === "true" &&
      /valid email/i.test(actual.status) &&
      actual.formHidden === false &&
      actual.formHeight > 0;
    return { pass, actual, summary: `aria-invalid=${actual.ariaInvalid} status=${JSON.stringify(actual.status)}` };
  });

  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="access-email"]');
    input.focus();
    input.select();
    return true;
  })()`);
  await insertText("not-an-email");
  await clickSelector('[data-testid="access-submit"]');
  await waitFor('document.querySelector(\'[data-testid="access-email"]\').getAttribute("aria-invalid") === "true"', "aria-invalid on invalid email", 4000);
  await check("7.2", "Access form", "invalid email is rejected with a validation message", async () => {
    const actual = await evaluate(`(() => {
      const form = document.querySelector('[data-testid="access-form"]');
      const input = document.querySelector('[data-testid="access-email"]');
      const status = document.querySelector('[data-testid="access-status"]');
      return {
        value: input.value,
        ariaInvalid: input.getAttribute("aria-invalid"),
        status: status.textContent.trim(),
        formHidden: form.hidden,
      };
    })()`);
    const pass =
      actual.value === "not-an-email" &&
      actual.ariaInvalid === "true" &&
      /valid email/i.test(actual.status) &&
      actual.formHidden === false;
    return { pass, actual, summary: `value=${actual.value} aria-invalid=${actual.ariaInvalid}` };
  });

  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="access-email"]');
    input.focus();
    input.select();
    return true;
  })()`);
  await insertText("sovereign@example.com");
  await clickSelector('[data-testid="access-submit"]');
  await waitFor('document.querySelector(\'[data-testid="access-success"]\').hidden === false', "success panel visible", 5000);
  await check("7.3", "Access form", "valid email hides the form and shows the success state", async () => {
    const actual = await evaluate(`(() => {
      const form = document.querySelector('[data-testid="access-form"]');
      const success = document.querySelector('[data-testid="access-success"]');
      return {
        formHidden: form.hidden,
        successHidden: success.hidden,
        successText: success.textContent.replace(/\\s+/g, " ").trim(),
        successHeight: Math.round(success.getBoundingClientRect().height),
        successDisplay: getComputedStyle(success).display,
      };
    })()`);
    const pass =
      actual.formHidden === true &&
      actual.successHidden === false &&
      actual.successDisplay !== "none" &&
      actual.successHeight > 0 &&
      /You['’]re on the list\./.test(actual.successText);
    return { pass, actual, summary: `formHidden=${actual.formHidden} success=${JSON.stringify(actual.successText.slice(0, 80))}` };
  });

  await check("7.4", "Access form", "no console errors during the form flow", async () => {
    const delta = state.consoleErrors.length + state.exceptions.length - consoleBaseline;
    return {
      pass: delta === 0,
      actual: { delta, consoleErrors: state.consoleErrors.slice(consoleBaseline), exceptions: state.exceptions.slice(consoleBaseline) },
      summary: `new console errors/exceptions=${delta}`,
    };
  });

  setPhase("screenshot:access");
  await captureSection("e2e-access-success.png", "#access");
}

/* --------------------------------------------------------------------------
   Reduced motion phase
   -------------------------------------------------------------------------- */

async function runReducedMotionPhase() {
  setPhase("reduced-motion");
  await send("Emulation.setEmulatedMedia", {
    media: "",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await reloadPage();

  await check("8.1", "Reduced motion", "prefers-reduced-motion: reduce is active after reload", async () => {
    const actual = await evaluate(`({
      matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ready: window.__LIFEQUEST_LANDING_READY__ === true,
      fontsStatus: document.fonts.status
    })`);
    return { pass: actual.matches && actual.ready, actual, summary: `matches=${actual.matches} ready=${actual.ready}` };
  });

  await check("8.2", "Reduced motion", "every .reveal is fully visible with no transform", async () => {
    const actual = await evaluate(`(() => {
      const isIdentity = (value) => value === "none" || /^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(value);
      const inspect = (element) => {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, transform: style.transform };
      };
      const elements = [...document.querySelectorAll(".reveal")];
      const bad = elements.filter((element) => {
        const style = inspect(element);
        return style.opacity !== "1" || !isIdentity(style.transform);
      });
      return { count: elements.length, badCount: bad.length, bad: bad.slice(0, 8).map((element) => ({ className: String(element.className), ...inspect(element) })) };
    })()`);
    return { pass: actual.count > 0 && actual.badCount === 0, actual, summary: `reveals=${actual.count} broken=${actual.badCount}` };
  });

  await check("8.3", "Reduced motion", "every .reveal-on-load is fully visible with no transform", async () => {
    const actual = await evaluate(`(() => {
      const isIdentity = (value) => value === "none" || /^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(value);
      const inspect = (element) => {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, transform: style.transform };
      };
      const elements = [...document.querySelectorAll(".reveal-on-load")];
      const bad = elements.filter((element) => {
        const style = inspect(element);
        return style.opacity !== "1" || !isIdentity(style.transform);
      });
      return { count: elements.length, badCount: bad.length, bad: bad.slice(0, 8).map((element) => ({ className: String(element.className), ...inspect(element) })) };
    })()`);
    return { pass: actual.count > 0 && actual.badCount === 0, actual, summary: `reveal-on-load=${actual.count} broken=${actual.badCount}` };
  });

  await check("8.4", "Reduced motion", "ticker, hero lines and all section content stay visible", async () => {
    const actual = await evaluate(`(() => {
      const isIdentity = (value) => value === "none" || /^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(value);
      const ticker = document.querySelector(".ticker__track");
      const tickerStyle = getComputedStyle(ticker);
      const heroLines = [...document.querySelectorAll(".hero__title .line-mask > span")].map((element) => getComputedStyle(element).transform);
      const premiseLines = [...document.querySelectorAll(".premise__statement .line-mask > span")].map((element) => getComputedStyle(element).transform);
      const sections = [...document.querySelectorAll("main section")].map((section) => ({
        id: section.id,
        height: Math.round(section.getBoundingClientRect().height),
        opacity: getComputedStyle(section).opacity,
      }));
      return {
        ticker: {
          animationName: tickerStyle.animationName,
          height: Math.round(ticker.getBoundingClientRect().height),
          opacity: tickerStyle.opacity,
          items: ticker.querySelectorAll(".ticker__item").length,
        },
        heroLines,
        premiseLines,
        sections,
      };
    })()`);
    const pass =
      actual.ticker.height > 0 &&
      actual.ticker.animationName === "none" &&
      actual.ticker.items >= 9 &&
      actual.heroLines.length === 3 &&
      actual.heroLines.every(identityTransform) &&
      actual.premiseLines.length >= 2 &&
      actual.premiseLines.every(identityTransform) &&
      actual.sections.length === 7 &&
      actual.sections.every((section) => section.height > 100 && section.opacity === "1");
    return { pass, actual, summary: `ticker=${actual.ticker.height}px sections=${actual.sections.length} lines-ok=${actual.heroLines.every(identityTransform)}` };
  });

  await send("Emulation.setEmulatedMedia", { media: "", features: [] });
}

/* --------------------------------------------------------------------------
   Mobile phase
   -------------------------------------------------------------------------- */

async function runMobilePhase() {
  setPhase("mobile");
  await send("Emulation.setDeviceMetricsOverride", {
    width: MOBILE.width,
    height: MOBILE.height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await reloadPage();

  await check("9.1", "Mobile", "menu toggle opens a full-screen menu with six links", async () => {
    const toggle = await evaluate(`(() => {
      const button = document.querySelector('[data-testid="menu-toggle"]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {
        display: getComputedStyle(button).display,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: rect.x + rect.width / 2,
        centerY: rect.y + rect.height / 2,
        expanded: button.getAttribute("aria-expanded"),
      };
    })()`);
    if (!toggle || toggle.display === "none") throw new Error(`menu toggle not visible: ${JSON.stringify(toggle)}`);
    await clickAt(toggle.centerX, toggle.centerY);
    await waitFor('document.querySelector(\'[data-testid="mobile-menu"]\').hidden === false', "mobile menu open", 4000);
    await frame();
    const actual = await evaluate(`(() => {
      const menu = document.querySelector('[data-testid="mobile-menu"]');
      const toggle = document.querySelector('[data-testid="menu-toggle"]');
      const rect = menu.getBoundingClientRect();
      const links = [...menu.querySelectorAll("a")].map((link) => {
        const linkRect = link.getBoundingClientRect();
        return {
          text: link.textContent.replace(/\\s+/g, " ").trim(),
          visible: linkRect.width > 0 && linkRect.height > 0 && getComputedStyle(link).display !== "none",
        };
      });
      return {
        toggleDisplay: getComputedStyle(toggle).display,
        expanded: toggle.getAttribute("aria-expanded"),
        hidden: menu.hidden,
        display: getComputedStyle(menu).display,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        links,
        bodyLocked: document.body.classList.contains("menu-open"),
      };
    })()`);
    const pass =
      actual.expanded === "true" &&
      actual.hidden === false &&
      actual.display === "flex" &&
      actual.width >= MOBILE.width - 1 &&
      actual.height >= MOBILE.height - 1 &&
      actual.links.length === 6 &&
      actual.links.every((link) => link.visible);
    return { pass, actual, summary: `expanded=${actual.expanded} size=${actual.width}x${actual.height} links=${actual.links.length}` };
  });

  setPhase("screenshot:mobile-menu");
  await capture("e2e-mobile-menu.png");

  await pressKey("Escape", "Escape", 27);
  await waitFor('document.querySelector(\'[data-testid="mobile-menu"]\').hidden === true', "mobile menu closed by Escape", 4000);
  await check("9.2", "Mobile", "Escape closes the menu and restores the toggle", async () => {
    const actual = await evaluate(`(() => {
      const menu = document.querySelector('[data-testid="mobile-menu"]');
      const toggle = document.querySelector('[data-testid="menu-toggle"]');
      return {
        hidden: menu.hidden,
        display: getComputedStyle(menu).display,
        expanded: toggle.getAttribute("aria-expanded"),
        focusReturned: document.activeElement === toggle,
        bodyLocked: document.body.classList.contains("menu-open"),
      };
    })()`);
    const pass = actual.hidden === true && actual.display === "none" && actual.expanded === "false" && actual.bodyLocked === false;
    return { pass, actual, summary: `hidden=${actual.hidden} expanded=${actual.expanded} focusReturned=${actual.focusReturned}` };
  });

  setPhase("scroll-through-mobile");
  await scrollThroughPage();
  setPhase("screenshot:full-mobile");
  await captureFullPage("e2e-full-mobile.png");
}

/* --------------------------------------------------------------------------
   Responsive overflow phase
   -------------------------------------------------------------------------- */

async function runOverflowPhase() {
  setPhase("responsive");
  const widths = [
    { id: "9.3", width: 1440, height: 900, mobile: false },
    { id: "9.4", width: 1024, height: 900, mobile: false },
    { id: "9.5", width: 768, height: 900, mobile: false },
    { id: "9.6", width: 390, height: 844, mobile: true },
  ];
  for (const viewport of widths) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await reloadPage();
    await check(viewport.id, "Mobile", `no horizontal overflow at ${viewport.width}px`, async () => {
      const actual = await evaluate(`(() => {
        const offenders = [...document.querySelectorAll("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0) return false;
            if (getComputedStyle(element).position === "fixed") return false;
            return rect.right > window.innerWidth + 1 || rect.left < -1;
          })
          .slice(0, 8)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              className: String(element.className).slice(0, 80),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          });
        return {
          innerWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          offenders,
        };
      })()`);
      const pass =
        actual.innerWidth === viewport.width &&
        actual.documentScrollWidth <= actual.innerWidth + 1 &&
        actual.bodyScrollWidth <= actual.innerWidth + 1;
      return {
        pass,
        actual,
        summary: `inner=${actual.innerWidth} doc=${actual.documentScrollWidth} body=${actual.bodyScrollWidth}`,
      };
    });
  }
}

/* --------------------------------------------------------------------------
   Final console / network / artifact checks
   -------------------------------------------------------------------------- */

function isFavicon(url) {
  return typeof url === "string" && /\/favicon\.(ico|png)(\?.*)?$/i.test(url);
}

async function runFinalChecks() {
  setPhase("final");
  await sleep(500);

  await check("2.3", "Assets", "no failed network requests (cancelled/favicon ignored)", async () => {
    const relevant = state.failedRequests.filter((request) => !request.canceled && !isFavicon(request.url));
    const ignored = state.failedRequests.filter((request) => request.canceled || isFavicon(request.url));
    state.ignoredNetwork.push(...ignored.map((request) => ({ kind: "loadingFailed", ...request })));
    return {
      pass: relevant.length === 0,
      actual: { requests: state.requestCount, failed: relevant.length, failedDetails: relevant.slice(0, 10), ignored: ignored.length },
      summary: `requests=${state.requestCount} failed=${relevant.length} ignored=${ignored.length}`,
    };
  });

  await check("2.4", "Assets", "no HTTP responses with status >= 400", async () => {
    const relevant = state.httpErrors.filter((response) => !isFavicon(response.url));
    const ignored = state.httpErrors.filter((response) => isFavicon(response.url));
    state.ignoredNetwork.push(...ignored.map((response) => ({ kind: "httpError", ...response })));
    return {
      pass: relevant.length === 0,
      actual: { errors: relevant.length, details: relevant.slice(0, 10), ignored: ignored.length },
      summary: `http>=400=${relevant.length} ignored=${ignored.length}`,
    };
  });

  await check("11.1", "Console", "no uncaught exceptions during the run", async () => {
    return {
      pass: state.exceptions.length === 0,
      actual: { count: state.exceptions.length, exceptions: state.exceptions.slice(0, 10) },
      summary: `exceptions=${state.exceptions.length}`,
    };
  });

  await check("11.2", "Console", "no console.error calls during the run", async () => {
    return {
      pass: state.consoleErrors.length === 0,
      actual: { count: state.consoleErrors.length, errors: state.consoleErrors.slice(0, 10) },
      summary: `console errors=${state.consoleErrors.length}`,
    };
  });

  await check("0.2", "Artifacts", "all seven named screenshots exist at the expected sizes", async () => {
    const actual = [];
    for (const spec of SCREENSHOT_SPECS) {
      const filePath = path.join(ARTIFACTS, spec.name);
      const record = { name: spec.name, expected: `${spec.width}x${spec.minHeight ?? "*"}${spec.height ? "" : "+"}`, pass: false };
      try {
        const buffer = await readFile(filePath);
        const size = pngSize(buffer);
        record.width = size.width;
        record.height = size.height;
        record.bytes = buffer.length;
        record.pass =
          buffer.length > 10000 &&
          size.width === spec.width &&
          (spec.height == null || size.height === spec.height) &&
          (spec.minHeight == null || size.height >= spec.minHeight) &&
          (spec.maxHeight == null || size.height <= spec.maxHeight);
      } catch (error) {
        record.error = error.message;
      }
      actual.push(record);
    }
    return {
      pass: actual.length === SCREENSHOT_SPECS.length && actual.every((record) => record.pass),
      actual,
      summary: `${actual.filter((record) => record.pass).length}/${actual.length} screenshots valid`,
    };
  });
}

/* --------------------------------------------------------------------------
   Report
   -------------------------------------------------------------------------- */

async function hashProductFiles() {
  const hashes = {};
  for (const file of PRODUCT_FILES) {
    try {
      hashes[file] = createHash("sha256").update(await readFile(path.join(APP, file))).digest("hex");
    } catch {
      hashes[file] = null;
    }
  }
  return hashes;
}

async function buildReport() {
  const finishedAt = Date.now();
  const passed = state.checks.filter((entry) => entry.pass).length;
  const failed = state.checks.length - passed;
  const result = failed === 0 && !state.fatal ? "PASS" : "FAIL";
  const productAfter = await hashProductFiles();
  const changedDuringRun = PRODUCT_FILES.some((file) => productAfter[file] !== state.productHashes[file]);
  if (changedDuringRun) {
    state.warnings.push(
      `product files changed while the rig was running (${PRODUCT_FILES.filter((file) => productAfter[file] !== state.productHashes[file]).join(", ")}); results describe the snapshot at startup`
    );
  }

  return {
    name: "lifequest-landing-e2e",
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    command: COMMAND,
    result,
    baseUrl: state.baseUrl,
    server: { mode: state.serverMode, port: state.serverPort },
    browser: {
      path: state.chromePath,
      version: state.chromeVersion,
      headless: true,
      flags: state.chromeFlags,
      profile: "throwaway (removed on exit)",
    },
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    product: {
      files: state.productHashes,
      filesAfterRun: productAfter,
      changedDuringRun,
    },
    summary: {
      total: state.checks.length,
      passed,
      failed,
      passRate: state.checks.length ? Math.round((passed / state.checks.length) * 1000) / 10 : 0,
      runtimeMs: finishedAt - state.startedAt,
      result,
    },
    checks: state.checks,
    screenshots: state.screenshots,
    console: { errors: state.consoleErrors, exceptions: state.exceptions },
    network: {
      requestCount: state.requestCount,
      failed: state.failedRequests,
      httpErrors: state.httpErrors,
      ignored: state.ignoredNetwork,
    },
    warnings: state.warnings,
    fatal: state.fatal,
  };
}

async function writeReport(report) {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, json);
  await mkdir(path.dirname(ARTIFACT_REPORT_PATH), { recursive: true });
  await writeFile(ARTIFACT_REPORT_PATH, json);
}

function printSummary(report) {
  const { summary } = report;
  console.log(`\n${"=".repeat(78)}`);
  console.log(`LifeQuest landing E2E — ${summary.result}`);
  console.log(`  checks:      ${summary.passed} passed, ${summary.failed} failed (${summary.total} total)`);
  console.log(`  runtime:     ${(summary.runtimeMs / 1000).toFixed(1)}s`);
  console.log(`  base url:    ${report.baseUrl} (${report.server.mode})`);
  console.log(`  screenshots: ${report.screenshots.length} → ${repoRelative(ARTIFACTS)}/`);
  console.log(`  report:      ${repoRelative(REPORT_PATH)}`);
  if (summary.failed > 0) {
    console.log("\nFailed checks:");
    for (const entry of report.checks.filter((item) => !item.pass)) {
      console.log(`  - ${entry.id} ${entry.name}\n      ${entry.summary}`);
    }
  }
  if (report.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  console.log(`${"=".repeat(78)}`);
  console.log(`RESULT: ${summary.result}`);
}

/* --------------------------------------------------------------------------
   Main
   -------------------------------------------------------------------------- */

async function main() {
  console.log("LifeQuest landing page E2E");
  console.log(`  command:   ${COMMAND}`);
  console.log(`  artifacts: ${repoRelative(ARTIFACTS)}/`);
  console.log("");

  try {
    await setup();
    console.log(`  base url:  ${state.baseUrl} (${state.serverMode})`);
    console.log(`  chromium:  ${state.chromePath} (${state.chromeVersion})`);
    console.log("");
    await runDesktopPhase();
    await runReducedMotionPhase();
    await runMobilePhase();
    await runOverflowPhase();
    await runFinalChecks();
  } catch (error) {
    state.fatal = { message: error?.message || String(error), stack: error?.stack };
    console.error(`\nFATAL: ${error?.message || error}`);
  } finally {
    await cleanup();
  }

  const report = await buildReport();
  await writeReport(report);
  printSummary(report);
  process.exitCode = report.summary.result === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error("e2e rig crashed:", error);
  process.exitCode = 1;
});
