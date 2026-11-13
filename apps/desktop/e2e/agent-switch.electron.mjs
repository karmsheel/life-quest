/**
 * The agent-switch rig: does changing agent tear the studio down?
 *
 * Why this exists. The chat dock carries an agent switcher: one pill per agent
 * ("Hermes", the external sidekick, and "Pi", the built-in one). Clicking the
 * other pill is a change of *chat store*, not a new launch — but the reported
 * failure was that it looked like a reconnection: the whole studio flashed,
 * `CompanionSetupScreen` (the `.welcome` pane with the `.welcome-card` and
 * "Connecting to your LifeQuest companion…") took the page, the dashboard
 * reloaded, and the operator's chat tabs were gone. Switching back did not
 * bring the previous agent's tabs with it.
 *
 * Desired behaviour: the dashboard never unmounts, the connect screen never
 * appears, only the chat rail and the tab strip swap, and switching back
 * restores the tabs that agent had open.
 *
 * The world is hermetic and throwaway:
 *   - a throwaway Electron profile (`LIFEQUEST_E2E.userData`) and vault, made
 *     with the real `createVault`, so no operator vault is touched;
 *   - a throwaway HERMES_HOME with a `hermes` stub first on PATH (the gateway
 *     subcommand exits 1, so nothing real is ever started);
 *   - a fake Hermes host gateway on loopback (`/health`, `/v1/capabilities`,
 *     `/api/model/options`, and the Sessions API: list/create/messages) that
 *     holds the seeded Hermes chats in this process;
 *   - a fake OpenAI-compatible endpoint (`/v1/models`, streaming
 *     `/v1/chat/completions`) for the built-in companion.
 *
 * Both agents get two chats with unmistakable names, then the renderer is
 * reloaded so the world boots on Hermes with those chats. Two Hermes tabs are
 * opened (one chat, then the other with "Open in new tab"), a probe is
 * installed over `#root`, and the Pi pill is clicked.
 *
 * The probe is the primary evidence, because the bug is a transient: a
 * MutationObserver records, after every batch, whether the `.welcome-card`
 * appeared, whether the marked `.home-dashboard` node was detached, whether the
 * splash became visible again, and whether `.chat-panel` was present. Those
 * counters are zero on a pass and cannot be zero if the studio was replaced.
 * The click-to-paint latency, the rail swap, the active pill, and the restored
 * tab strip are measured separately; the ceiling on the switch is 2000 ms and
 * the actual number is always reported (the world is not tuned to hide slowness).
 *
 * Beyond that teardown, the rig holds the switch's own race conditions:
 *   A. exactly one `companion:switchHarness` invoke per pill click (counted at
 *      the IPC seam; the page-wrap attempt is reported too), and no pill left
 *      with `--pending`/`aria-busy`;
 *   B. the chat rail is never an empty column — sampled every 50 ms, a sample
 *      with no rows and no empty-state text and no error notice fails the run;
 *   C. a draft typed into the Hermes composer survives the round trip;
 *   D. both agents have their own stored strip (`openTabs.hermes`/`.pi`), and a
 *      reload of the document restores the two Hermes tabs and the same tab in
 *      front;
 *   E. the switch never disables the target pill.
 *
 * Artifacts:
 *   e2e/artifacts/agent-switch.json          the report
 *   e2e/artifacts/agent-switch-before.png    the studio on Hermes, two tabs
 *   e2e/artifacts/agent-switch-during.png    immediately after the Pi click
 *   e2e/artifacts/agent-switch-after.png     on Pi after the switch
 *
 * Run by `tests/agent-switch-e2e.test.ts`, through the shared bench wrapper:
 *   /root/.local/bin/lifequest-e2e <checkout> tests/agent-switch-e2e.test.ts
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "agent-switch.json");

/** The endpoint model the built-in companion is pointed at. */
const MODEL = "rig-model";
/** A profile name no real install has: the companion runs on its own `profiles/<name>`. */
const PROBE_PROFILE = "lq-agent-switch";
const DEV_SERVER_URL = "http://127.0.0.1:5173";

/** The pass/fail ceiling for click → rail+pill settled. The actual is reported. */
const SWITCH_CEILING_MS = 2000;
/** How long the page waits for the switch to land before recording a timeout. */
const SWITCH_WAIT_MS = 20_000;
/** How long the page waits for the previous agent's tabs to come back. */
const RESTORE_WAIT_MS = 20_000;
/** Driver watchdog: never leave the wrapper with a hung Electron process. */
const DRIVER_WATCHDOG_MS = 220_000;

const HERMES_TITLES = ["Hermes alpha", "Hermes beta"];
const PI_TITLES = ["Pi alpha", "Pi beta"];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Servers this rig opened; closed in the shutdown path. */
const openServers = [];

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      openServers.push(server);
      resolve(server.address().port);
    });
  });
}

async function freePorts(n) {
  const held = [];
  const ports = [];
  for (let i = 0; i < n; i += 1) {
    const server = net.createServer();
    ports.push(await listen(server));
    held.push(server);
  }
  const released = await Promise.all(
    held.map(
      (server) =>
        new Promise((resolve) => {
          const at = openServers.indexOf(server);
          if (at >= 0) openServers.splice(at, 1);
          server.close(resolve);
        }),
    ),
  );
  void released;
  return ports;
}

function writeReport(report) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

/**
 * Every `companion:switchHarness` invoke, counted at the IPC seam.
 *
 * The probe wraps `window.lifequest.companionSwitchHarness` in the page as well,
 * but `window.lifequest` is a contextBridge object and contextBridge freezes it,
 * so that wrap cannot be relied on (the page attempt reports whether it took).
 * This seam is the one the app's click actually crosses, so counting here is the
 * authoritative answer to "how many switch invokes did one pill click make".
 * Installed before the main process registers its handlers (they register in
 * `bootForE2e`), the same latch the startup rig uses to time channels.
 */
const switchInvokes = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function (channel, listener) {
  return originalHandle(channel, async (event, ...args) => {
    if (channel === "companion:switchHarness") {
      switchInvokes.push({ at: Date.now(), target: args[0] ?? null });
    }
    return listener(event, ...args);
  });
};

// ---------------------------------------------------------------------------
// The fake OpenAI-compatible endpoint (the built-in companion's world)
// ---------------------------------------------------------------------------

function startFakePiEndpoint() {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const parts = ["Rig reply", " from", " Pi."];
        let i = 0;
        const send = () => {
          if (i < parts.length) {
            res.write(
              `data: ${JSON.stringify({
                id: "rig",
                object: "chat.completion.chunk",
                created: 0,
                model: MODEL,
                choices: [{ index: 0, delta: { content: parts[i] }, finish_reason: null }],
              })}\n\n`,
            );
            i += 1;
            setTimeout(send, 15);
            return;
          }
          res.write(
            `data: ${JSON.stringify({
              id: "rig",
              object: "chat.completion.chunk",
              created: 0,
              model: MODEL,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          res.end();
        };
        send();
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return listen(server);
}

// ---------------------------------------------------------------------------
// The fake Hermes host gateway (the external companion's world)
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

/**
 * A host gateway serving one profile, with an in-memory Sessions API.
 *
 * The app's real `hermesFetch` calls live in `electron/companion.ts`:
 *   GET  /api/sessions?limit=200   → { sessions: [...] }
 *   POST /api/sessions             → { session: {...} }
 *   GET  /api/sessions/{id}/messages → { messages: [...] }
 *   GET  /api/model/options        → provider catalog
 * and attachment probes `GET <base>/health` + `GET <base>/v1/capabilities`.
 * Everything is matched with `endsWith` because the app talks to the profile
 * base (`/p/<profile>`); the rig's own path prefix is not part of the test.
 */
function startFakeHermesHost() {
  /** @type {Array<Record<string, unknown>>} newest first */
  const sessions = [];
  let nextId = 1;
  const nowSec = () => Math.floor(Date.now() / 1000);

  const rows = () =>
    sessions.map((row, index) => ({
      ...row,
      last_active: nowSec() - index,
    }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const json = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (pathname.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (pathname.endsWith("/v1/capabilities")) {
      json({
        features: {
          session_list: true,
          session_chat: true,
          session_chat_stream: true,
        },
      });
      return;
    }
    if (pathname.endsWith("/api/model/options")) {
      json({
        model: MODEL,
        providers: [
          {
            slug: "rig",
            name: "Rig provider",
            authenticated: true,
            models: [MODEL],
            capabilities: {},
          },
        ],
      });
      return;
    }

    const messagesMatch = /\/api\/sessions\/([^/]+)\/messages$/.exec(pathname);
    if (messagesMatch && req.method === "GET") {
      json({ messages: [] });
      return;
    }

    if (/\/api\/sessions$/.test(pathname)) {
      if (req.method === "GET") {
        json({ sessions: rows() });
        return;
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        let title = "";
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.title === "string") title = parsed.title.trim();
        } catch {
          // A session with no body still exists; the title is then blank.
        }
        const row = {
          id: `hermes-session-${nextId}`,
          title: title || "New chat",
          preview: "",
          pinned: false,
          archived: false,
          hidden: false,
          runtime_revision: 1,
        };
        nextId += 1;
        sessions.unshift(row);
        json({ session: { ...row, last_active: nowSec() } });
        return;
      }
    }

    const patchMatch = /\/api\/sessions\/([^/]+)$/.exec(pathname);
    if (patchMatch && req.method === "PATCH") {
      const body = await readBody(req);
      const row = sessions.find((entry) => entry.id === patchMatch[1]);
      if (!row) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.title === "string") row.title = parsed.title;
        if (typeof parsed.pinned === "boolean") row.pinned = parsed.pinned;
        if (typeof parsed.archived === "boolean") row.archived = parsed.archived;
      } catch {
        // A malformed patch leaves the row as it was.
      }
      json({ session: { ...row, last_active: nowSec() } });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  return listen(server);
}

// ---------------------------------------------------------------------------
// The Hermes CLI stub, first on PATH
// ---------------------------------------------------------------------------

function writeHermesStub(binDir, callLog) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `printf '%s\\n' \"$*\" >> ${JSON.stringify(callLog)}`,
      'case "$1" in',
      "  gateway) exit 1 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return stub;
}

// ---------------------------------------------------------------------------
// Page scripts
// ---------------------------------------------------------------------------

/** Everything the report calls a "state": rail, tabs, pills, gates. */
const READ_STATE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const railRows = [...document.querySelectorAll(".chats-rail__rows .chats-rail__row")].map((li) => ({
    label: text(li.querySelector(".chats-rail__label")),
    active: li.getAttribute("data-active") === "true",
  }));
  const tabs = [...document.querySelectorAll(".chat-panel__tab")].map((tab) => ({
    label: text(tab.querySelector(".chat-panel__tab-label")),
    active: tab.classList.contains("chat-panel__tab--active"),
    pinned: tab.hasAttribute("data-pinned"),
  }));
  const pills = [...document.querySelectorAll(".agent-switcher__pill")].map((el) => ({
    name: el.getAttribute("aria-label"),
    active: el.getAttribute("aria-checked") === "true",
    disabled: el.disabled === true,
    pending: el.classList.contains("agent-switcher__pill--pending"),
    busy: el.getAttribute("aria-busy") === "true",
  }));
  const splash = document.getElementById("splash");
  const splashHidden =
    !splash || splash.hasAttribute("hidden") || getComputedStyle(splash).display === "none";
  return {
    railTitles: railRows.map((row) => row.label),
    railActive: (railRows.find((row) => row.active) || {}).label || null,
    tabLabels: tabs.map((tab) => tab.label),
    activeTabLabel: (tabs.find((tab) => tab.active) || {}).label || null,
    tabCount: tabs.length,
    pills,
    activePill: (pills.find((pill) => pill.active) || {}).name || null,
    pendingPills: pills.filter((pill) => pill.pending).map((pill) => pill.name),
    busyPills: pills.filter((pill) => pill.busy).map((pill) => pill.name),
    dashboard: Boolean(document.querySelector(".home-dashboard")),
    markedDashboard: Boolean(document.querySelector('.home-dashboard[data-lq-probe="before"]')),
    welcomeCard: Boolean(document.querySelector(".welcome-card")),
    chatPanel: Boolean(document.querySelector(".chat-panel")),
    splashHidden,
    hash: window.location.hash,
  };
})()`;

/**
 * The switch probe: a MutationObserver counting what a transient bug leaves
 * behind. It marks the dashboard node, so "the same node is still there" is a
 * detached-node check rather than a class check.
 */
const INSTALL_PROBE = `(() => {
  const probe = {
    installedAt: performance.now(),
    switchStartMs: null,
    welcomeSeen: 0,
    dashboardGone: 0,
    splashSeen: 0,
    chatPanelMissing: 0,
    pillDisabledSamples: 0,
    railSamples: [],
    railBlankSamples: 0,
    railBlankDetails: [],
    samples: [],
    errors: [],
  };
  window.__lqSwitchProbe = probe;
  window.addEventListener("error", (event) => {
    probe.errors.push({
      kind: "error",
      message: String(event && (event.message || event.error || "error")).slice(0, 400),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event && event.reason;
    probe.errors.push({
      kind: "unhandledrejection",
      message: String(reason && reason.message ? reason.message : reason).slice(0, 400),
    });
  });
  const splashVisible = () => {
    const el = document.getElementById("splash");
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.01
    );
  };
  let previous = null;
  const sample = () => {
    const current = {
      t: Math.round(performance.now() - probe.installedAt),
      marked: Boolean(document.querySelector('.home-dashboard[data-lq-probe="before"]')),
      dashboard: Boolean(document.querySelector(".home-dashboard")),
      welcome: Boolean(document.querySelector(".welcome-card")),
      shell: Boolean(document.querySelector(".app-shell")),
      chatPanel: Boolean(document.querySelector(".chat-panel")),
      splashVisible: splashVisible(),
    };
    // The marked node detaching is the proof of a remount; count the transition
    // once, not every batch that follows it.
    if (previous && previous.marked && !current.marked) probe.dashboardGone += 1;
    if (current.welcome && !(previous && previous.welcome)) probe.welcomeSeen += 1;
    if (current.splashVisible && !(previous && previous.splashVisible)) probe.splashSeen += 1;
    if (!current.chatPanel && !(previous && !previous.chatPanel)) probe.chatPanelMissing += 1;
    previous = current;
    if (probe.samples.length < 600) probe.samples.push(current);
  };
  const root = document.getElementById("root") || document.body;
  const observer = new MutationObserver(sample);
  observer.observe(root, { childList: true, subtree: true, attributes: true });
  sample();
  const markedNode = document.querySelector(".home-dashboard");
  if (markedNode) markedNode.setAttribute("data-lq-probe", "before");
  /*
   * The rail must never be an empty column while the switch is in flight.
   *
   * After every state change the rail has to show one of three things: rows, a
   * non-empty empty-state ("Loading Pi's chats…", "No chats yet"), or an error
   * notice. A frame with none of them is the "empty column" flash the operator
   * reported, so it is counted on a 50 ms timer for the whole switch window —
   * sampling faster than a MutationObserver would, because the flash can be a
   * single paint.
   */
  const railState = () => {
    const list = document.querySelector(".chats-rail__list");
    const rows = list ? list.querySelectorAll(".chats-rail__row").length : 0;
    const empty = list ? list.querySelector(".chats-rail__empty") : null;
    const emptyText = empty ? (empty.textContent || "").trim() : "";
    const error = Boolean(document.querySelector(".chats-rail__error"));
    return {
      list: Boolean(list),
      rows,
      emptyText,
      error,
      // Anything visible that says what is happening. All three absent is the
      // blank column.
      blank: rows === 0 && emptyText === "" && !error,
    };
  };
  probe.railTimer = setInterval(() => {
    const state = railState();
    if (probe.railSamples.length < 2000) {
      probe.railSamples.push({ t: Math.round(performance.now() - probe.installedAt), ...state });
    }
    if (state.blank) {
      probe.railBlankSamples += 1;
      if (probe.railBlankDetails.length < 8) {
        probe.railBlankDetails.push({ t: Math.round(performance.now() - probe.installedAt), ...state });
      }
    }
  }, 50);
  const installed = {
    installed: true,
    marked: Boolean(document.querySelector('.home-dashboard[data-lq-probe="before"]')),
    dashboard: Boolean(document.querySelector(".home-dashboard")),
    welcomeCard: Boolean(document.querySelector(".welcome-card")),
    chatPanel: Boolean(document.querySelector(".chat-panel")),
    splashHidden: splashVisible() === false,
    railState: railState(),
  };
  return installed;
})()`;

/**
 * Click the Pi pill and wait for the switch to be visible: the pill active and
 * the rail holding Pi's chats and not Hermes's. Latency and the probe counters
 * ride back in one answer.
 */
const SWITCH_TO_PI = `(async () => {
  const probe = window.__lqSwitchProbe;
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const rail = () =>
    [...document.querySelectorAll(".chats-rail__rows .chats-rail__row")].map((li) =>
      text(li.querySelector(".chats-rail__label")),
    );
  const tabs = () =>
    [...document.querySelectorAll(".chat-panel__tab")].map((tab) =>
      text(tab.querySelector(".chat-panel__tab-label")),
    );
  const activeTab = () => {
    const tab = document.querySelector(".chat-panel__tab--active");
    return tab ? text(tab.querySelector(".chat-panel__tab-label")) : null;
  };
  const activePill = () => {
    const pill = [...document.querySelectorAll(".agent-switcher__pill")].find(
      (el) => el.getAttribute("aria-checked") === "true",
    );
    return pill ? pill.getAttribute("aria-label") : null;
  };
  const piPill = () =>
    document.querySelector('.agent-switcher__pill[aria-label="Pi"]');
  const pill = piPill();
  if (!pill) {
    return { clicked: false, reason: "no Pi pill in the dock", rail: rail() };
  }
  probe.switchStartMs = Math.round(performance.now() - probe.installedAt);
  probe.pillDisabledSamples = 0;
  const started = performance.now();
  pill.click();
  const deadline = performance.now() + ${SWITCH_WAIT_MS};
  let lastRail = [];
  let lastTabs = [];
  let active = null;
  while (performance.now() < deadline) {
    const currentPill = piPill();
    if (currentPill && currentPill.disabled === true) probe.pillDisabledSamples += 1;
    active = activePill();
    lastRail = rail();
    lastTabs = tabs();
    if (
      active === "Pi" &&
      lastRail.includes("Pi alpha") &&
      lastRail.includes("Pi beta") &&
      !lastRail.includes("Hermes alpha")
    ) {
      return {
        clicked: true,
        timedOut: false,
        switchMs: Math.round(performance.now() - started),
        activePill: active,
        railTitles: lastRail,
        tabLabels: lastTabs,
        activeTabLabel: activeTab(),
        pillDisabledAtEnd: Boolean(piPill() && piPill().disabled === true),
        pillDisabledSamples: probe.pillDisabledSamples,
        welcomeCardAbsent: !document.querySelector(".welcome-card"),
        markedDashboardPresent: Boolean(
          document.querySelector('.home-dashboard[data-lq-probe="before"]'),
        ),
        chatPanelPresent: Boolean(document.querySelector(".chat-panel")),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return {
    clicked: true,
    timedOut: true,
    switchMs: Math.round(performance.now() - started),
    activePill: activePill(),
    railTitles: rail(),
    tabLabels: tabs(),
    activeTabLabel: activeTab(),
    pillDisabledAtEnd: Boolean(piPill() && piPill().disabled === true),
    pillDisabledSamples: probe.pillDisabledSamples,
    welcomeCardAbsent: !document.querySelector(".welcome-card"),
    markedDashboardPresent: Boolean(
      document.querySelector('.home-dashboard[data-lq-probe="before"]'),
    ),
    chatPanelPresent: Boolean(document.querySelector(".chat-panel")),
  };
})()`;

/**
 * Click the Hermes pill and wait for the previous agent's world to come back:
 * Hermes chats in the rail, and both Hermes tabs in the dock's strip.
 */
const SWITCH_BACK = `(async () => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const rail = () =>
    [...document.querySelectorAll(".chats-rail__rows .chats-rail__row")].map((li) =>
      text(li.querySelector(".chats-rail__label")),
    );
  const tabItems = () =>
    [...document.querySelectorAll(".chat-panel__tab")].map((tab) => ({
      label: text(tab.querySelector(".chat-panel__tab-label")),
      active: tab.classList.contains("chat-panel__tab--active"),
    }));
  const activePill = () => {
    const pill = [...document.querySelectorAll(".agent-switcher__pill")].find(
      (el) => el.getAttribute("aria-checked") === "true",
    );
    return pill ? pill.getAttribute("aria-label") : null;
  };
  const hermesPill = () =>
    document.querySelector('.agent-switcher__pill[aria-label="Hermes"]');
  const pill = hermesPill();
  if (!pill) {
    return { clicked: false, reason: "no Hermes pill in the dock", rail: rail() };
  }
  const wasActive = pill.getAttribute("aria-checked") === "true";
  const started = performance.now();
  if (!wasActive) pill.click();
  const deadline = performance.now() + ${RESTORE_WAIT_MS};
  while (performance.now() < deadline) {
    const labels = rail();
    const items = tabItems();
    const labelsOfTabs = items.map((item) => item.label);
    if (
      activePill() === "Hermes" &&
      labels.includes("Hermes alpha") &&
      labels.includes("Hermes beta") &&
      labelsOfTabs.includes("Hermes alpha") &&
      labelsOfTabs.includes("Hermes beta")
    ) {
      return {
        clicked: true,
        wasActive,
        timedOut: false,
        restoreMs: Math.round(performance.now() - started),
        activePill: activePill(),
        railTitles: labels,
        tabLabels: labelsOfTabs,
        activeTabLabel: (items.find((item) => item.active) || {}).label || null,
        markedDashboardPresent: Boolean(
          document.querySelector('.home-dashboard[data-lq-probe="before"]'),
        ),
        welcomeCardAbsent: !document.querySelector(".welcome-card"),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    clicked: true,
    wasActive,
    timedOut: true,
    restoreMs: Math.round(performance.now() - started),
    activePill: activePill(),
    railTitles: rail(),
    tabLabels: tabItems().map((item) => item.label),
    activeTabLabel: (tabItems().find((item) => item.active) || {}).label || null,
    markedDashboardPresent: Boolean(
      document.querySelector('.home-dashboard[data-lq-probe="before"]'),
    ),
    welcomeCardAbsent: !document.querySelector(".welcome-card"),
  };
})()`;

const READ_PROBE = `(() => {
  const probe = window.__lqSwitchProbe;
  if (!probe) return { installed: false };
  const during =
    probe.switchStartMs === null
      ? probe.samples
      : probe.samples.filter((sample) => sample.t >= probe.switchStartMs);
  return {
    installed: true,
    welcomeSeen: probe.welcomeSeen,
    dashboardGone: probe.dashboardGone,
    splashSeen: probe.splashSeen,
    chatPanelMissing: probe.chatPanelMissing,
    pillDisabledSamples: probe.pillDisabledSamples,
    switchStartMs: probe.switchStartMs,
    sampleCount: probe.samples.length,
    duringSwitchSamples: during.length,
    chatPanelPresentEverySample: during.every((sample) => sample.chatPanel === true),
    dashboardPresentAtEnd: Boolean(document.querySelector(".home-dashboard")),
    markedDashboardPresent: Boolean(
      document.querySelector('.home-dashboard[data-lq-probe="before"]'),
    ),
    welcomeCardAbsent: !document.querySelector(".welcome-card"),
    splashHidden: (() => {
      const el = document.getElementById("splash");
      return !el || el.hasAttribute("hidden") || getComputedStyle(el).display === "none";
    })(),
    errors: probe.errors,
    railSampleCount: probe.railSamples.length,
    railBlankSamples: probe.railBlankSamples,
    railBlankDetails: probe.railBlankDetails,
    samples: probe.samples.slice(-200),
  };
})()`;

/** The composer's current text, and whether it is present and enabled. */
const READ_COMPOSER = `(() => {
  const el = document.querySelector(".chat-panel__composer-input");
  return {
    present: Boolean(el),
    value: el ? el.value : null,
    disabled: el ? el.disabled === true : null,
    placeholder: el ? el.getAttribute("placeholder") : null,
  };
})()`;

/**
 * Put a draft in the dock's composer the way a person would, through the native
 * value setter plus the `input` event React listens for. The app's own composer
 * element is used, not a stand-in.
 */
function typeComposerDraft(text) {
  return `(async () => {
    const el = document.querySelector(".chat-panel__composer-input");
    if (!el) return { ok: false, reason: "no composer" };
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      if (el.value === ${JSON.stringify(text)}) return { ok: true, value: el.value, tag: el.tagName };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ok: false, reason: "the composer did not take the draft", value: el.value };
  })()`;
}

/**
 * Wrap `window.lifequest.companionSwitchHarness` in the page to count calls.
 *
 * The bridge is a contextBridge object, which Electron freezes, so this may not
 * take; the report says whether it did, and the main process counts the same
 * invokes at the IPC seam either way (see `switchInvokes`).
 */
const INSTALL_SWITCH_COUNTER = `(() => {
  const result = { frozen: Object.isFrozen(window.lifequest), wrapped: false, error: null };
  try {
    const original = window.lifequest.companionSwitchHarness;
    window.__lqSwitchHarnessCalls = 0;
    window.lifequest.companionSwitchHarness = function (...args) {
      window.__lqSwitchHarnessCalls += 1;
      return original.apply(this, args);
    };
    result.wrapped = window.lifequest.companionSwitchHarness !== original;
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
  }
  return result;
})()`;

/**
 * Per-vault, per-agent tab memory, as the app stored it.
 *
 * Chats belong to a vault, so the shipped keys carry the vault's stable id:
 * `lifequest.companion.openTabs.<vaultId>.<agent>` and
 * `lifequest.companion.lastSessionId.<vaultId>`. The pre-vault keys
 * (`openTabs.<agent>`, `lastSessionId`) are not read by the app for a vault, so
 * a rig that asserted them would be checking a slot nothing writes.
 */
function readTabStorage(vaultId) {
  return `(() => {
    const vaultId = ${JSON.stringify(vaultId)};
    const slot = (agent) => window.localStorage.getItem("lifequest.companion.openTabs." + vaultId + "." + agent);
    const parse = (raw) => {
      if (raw === null) return null;
      try {
        const value = JSON.parse(raw);
        if (Array.isArray(value)) return { tabs: value, activeId: null, bare: true };
        return {
          tabs: Array.isArray(value && value.tabs) ? value.tabs : [],
          activeId: value && typeof value.activeId === "string" ? value.activeId : null,
          bare: false,
        };
      } catch {
        return { parseError: true, raw };
      }
    };
    return {
      vaultId,
      hermesRaw: slot("hermes"),
      piRaw: slot("pi"),
      legacyRaw: window.localStorage.getItem("lifequest.companion.openTabs"),
      hermes: parse(slot("hermes")),
      pi: parse(slot("pi")),
      lastSessionId: window.localStorage.getItem("lifequest.companion.lastSessionId." + vaultId),
    };
  })()`;
}

/** Stop the rail sampler before a reload tears the context down. */
const STOP_RAIL_SAMPLER = `(() => {
  const probe = window.__lqSwitchProbe;
  if (probe && probe.railTimer) {
    clearInterval(probe.railTimer);
    probe.railTimer = null;
  }
  return true;
})()`;

// ---------------------------------------------------------------------------
// Small page helpers
// ---------------------------------------------------------------------------

/** Click a chat row (plain click: navigation) and wait for it to be the active row. */
function clickRailRow(label) {
  return `(async () => {
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const findRow = () =>
      [...document.querySelectorAll(".chats-rail__row")].find(
        (li) => text(li.querySelector(".chats-rail__label")) === ${JSON.stringify(label)},
      );
    const row = findRow();
    if (!row) return { ok: false, reason: "no row", titles: [...document.querySelectorAll(".chats-rail__label")].map(text) };
    const main = row.querySelector(".chats-rail__row-main");
    if (!main) return { ok: false, reason: "no row main" };
    main.click();
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const current = findRow();
      if (current && current.getAttribute("data-active") === "true") return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ok: false, reason: "row never became active" };
  })()`;
}

/** Open a chat row in a second tab through its own "Open in new tab" menu item. */
function openRailRowInNewTab(label) {
  return `(async () => {
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const findRow = () =>
      [...document.querySelectorAll(".chats-rail__row")].find(
        (li) => text(li.querySelector(".chats-rail__label")) === ${JSON.stringify(label)},
      );
    const row = findRow();
    if (!row) return { ok: false, reason: "no row" };
    const menuButton = row.querySelector(".chats-rail__menu-btn");
    if (!menuButton) return { ok: false, reason: "no menu button" };
    menuButton.click();
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    await frame();
    const item = [...row.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.getAttribute("aria-label") === "Open in new tab",
    );
    if (!item) {
      return {
        ok: false,
        reason: "no Open in new tab item",
        items: [...row.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute("aria-label")),
      };
    }
    item.click();
    await frame();
    await frame();
    await frame();
    return { ok: true };
  })()`;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // ── The world ────────────────────────────────────────────────────────────
  const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-agent-switch-"));
  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const callLog = path.join(world, "hermes-calls.log");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  writeHermesStub(binDir, callLog);

  const created = await createVault(vaultDir, "Agent Switch");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);

  // `companionProfile` moves the app off the real `lifequest` Hermes profile;
  // the recent vault makes the renderer land on the dashboard, not `/welcome`.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: created.value.lifequest.id,
            name: "Agent Switch",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROBE_PROFILE,
      },
      null,
      2,
    )}\n`,
  );

  // ── The servers, before the main process reads its environment ───────────
  const piPort = await startFakePiEndpoint();
  const hostPort = await startFakeHermesHost();
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${hostPort}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
  );
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n  provider: nous\n",
  );
  const [mcpLocalPort, mcpInvitePort] = await freePorts(2);

  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  // The shared bench wrapper serves THIS checkout on 5173 (it holds the e2e
  // lock while this rig runs); the rig tests the renderer the bench is serving.
  process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocalPort, invite: mcpInvitePort },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  const piBaseUrl = `http://127.0.0.1:${piPort}/v1`;

  // ── Boot the real app ────────────────────────────────────────────────────
  await app.whenReady();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const js = (code) => win.webContents.executeJavaScript(code, true);

  const consoleErrors = [];
  const renderProcessGone = [];
  const KNOWN_NOISE =
    /vite|WebSocket connection|\[hmr\]|Electron Security Warning|Autofill|DevTools/i;
  win.webContents.on("console-message", (event, level, message) => {
    const text =
      typeof event?.message === "string" ? event.message : typeof message === "string" ? message : "";
    const severity =
      typeof event?.level === "string" ? event.level : level;
    const isError = severity === "error" || (typeof severity === "number" && severity >= 3);
    if (!isError) return;
    consoleErrors.push({
      level: severity,
      message: String(text).slice(0, 400),
      source: typeof event?.sourceId === "string" ? event.sourceId : "",
    });
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    renderProcessGone.push({ reason: details?.reason ?? "unknown", exitCode: details?.exitCode ?? null });
  });

  const waitFor = async (label, predicate, timeoutMs = 60_000, intervalMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return true;
      } catch {
        // A reload destroys the execution context; retry until it is back.
      }
      await sleep(intervalMs);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  await waitFor("the preload bridge", async () => Boolean(await js("Boolean(window.lifequest)")), 30_000, 50);

  // ── Seed the two agents' chats ───────────────────────────────────────────
  const seed = await js(`(async () => {
    const api = window.lifequest;
    const status = (value) => (value && value.kind) || "unknown";
    const hermesReady = status(await api.companionUseHarness("hermes"));
    const hermesCreated = [];
    for (const title of ${JSON.stringify(HERMES_TITLES)}) {
      const created = await api.companionSessionCreate(title);
      hermesCreated.push({ title, ok: Boolean(created && created.ok), id: created && created.ok ? created.value.id : null, error: created && created.error });
    }
    const settings = await api.companionPiSettingsSave({
      baseUrl: ${JSON.stringify(piBaseUrl)},
      model: ${JSON.stringify(MODEL)},
      providerName: "Rig endpoint",
    });
    const piReady = status(await api.companionUseHarness("pi"));
    const piCreated = [];
    for (const title of ${JSON.stringify(PI_TITLES)}) {
      const created = await api.companionSessionCreate(title);
      piCreated.push({ title, ok: Boolean(created && created.ok), id: created && created.ok ? created.value.id : null, error: created && created.error });
    }
    const piListed = await api.companionSessionsList();
    const backToHermes = status(await api.companionUseHarness("hermes"));
    const hermesListed = await api.companionSessionsList();
    return {
      hermesReady,
      hermesCreated,
      settings: settings && settings.kind ? settings.kind : "saved",
      piReady,
      piCreated,
      piListed: piListed && piListed.ok ? piListed.value.map((row) => row.title) : [],
      backToHermes,
      hermesListed: hermesListed && hermesListed.ok ? hermesListed.value.map((row) => row.title) : [],
      piListedOk: Boolean(piListed && piListed.ok),
      hermesListedOk: Boolean(hermesListed && hermesListed.ok),
    };
  })()`);

  const seedOk =
    seed.hermesReady === "ready" &&
    seed.hermesCreated.every((row) => row.ok) &&
    seed.piReady === "ready" &&
    seed.piCreated.every((row) => row.ok) &&
    seed.piListedOk &&
    seed.hermesListedOk &&
    seed.piListed.includes(PI_TITLES[0]) &&
    seed.piListed.includes(PI_TITLES[1]) &&
    seed.hermesListed.includes(HERMES_TITLES[0]) &&
    seed.hermesListed.includes(HERMES_TITLES[1]) &&
    seed.backToHermes === "ready";

  // ── Reload so the world boots the way a launch does ──────────────────────
  const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await loaded;

  await waitFor(
    "the dashboard",
    async () => Boolean(await js("Boolean(document.querySelector('.home-dashboard'))")),
    60_000,
  );
  await waitFor(
    "the chat dock",
    async () => Boolean(await js("Boolean(document.querySelector('.chat-panel'))")),
    60_000,
  );
  await waitFor(
    "the splash to stand down",
    async () =>
      Boolean(
        await js(
          "(() => { const el = document.getElementById('splash'); return !el || el.hasAttribute('hidden') || getComputedStyle(el).display === 'none'; })()",
        ),
      ),
    30_000,
  );
  await waitFor(
    "the Hermes chat rail",
    async () =>
      Boolean(
        await js(
          `${JSON.stringify(HERMES_TITLES)}.every((title) => [...document.querySelectorAll('.chats-rail__label')].some((el) => el.textContent.trim() === title))`,
        ),
      ),
    30_000,
  );

  // ── Open the two Hermes chats as two tabs ────────────────────────────────
  const openedFirst = await js(clickRailRow(HERMES_TITLES[0]));
  await sleep(250);
  const openedSecond = await js(openRailRowInNewTab(HERMES_TITLES[1]));
  await waitFor(
    "two Hermes tabs",
    async () =>
      Boolean(
        await js(
          `(() => {
            const labels = [...document.querySelectorAll(".chat-panel__tab")].map((tab) => tab.querySelector(".chat-panel__tab-label")?.textContent.trim() ?? "");
            return labels.includes(${JSON.stringify(HERMES_TITLES[0])}) && labels.includes(${JSON.stringify(HERMES_TITLES[1])});
          })()`,
        ),
      ),
    15_000,
  );
  await sleep(300);

  const readState = () => js(READ_STATE);
  const before = await readState();
  const harnessesBefore = await js(
    "window.lifequest.companionHarnesses().then((rows) => rows.map((row) => ({ id: row.id, active: row.active })))",
  );

  // ── Instrument before the click ──────────────────────────────────────────
  // (a) the page-side switch-harness wrap the spec asks for (the IPC seam count
  // is authoritative when contextBridge refuses it), (b) the mutation/rail
  // probe, (c) a real draft in the Hermes composer so "the draft survives a
  // switch" is a fact about the app's own field.
  const switchCounter = await js(INSTALL_SWITCH_COUNTER);
  const installed = await js(INSTALL_PROBE);
  const DRAFT = "rig draft: keep me across the switch";
  const draftTyped = await js(typeComposerDraft(DRAFT));
  const draftBefore = await js(READ_COMPOSER);
  const beforeShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "agent-switch-before.png"), beforeShot.toPNG());

  // ── The switch, with a picture taken while it is happening ───────────────
  //
  // The probe is the authority on the transient, but the operator's evidence is
  // a frame. A single early capture can land before the renderer has presented
  // the post-click frame (it did on the fixed build: the first 40ms picture was
  // pixel-identical to `before`). So while the switch is still pending, frames
  // are taken until one differs from the before picture, or the switch settles.
  // The report says when the frame was taken and whether the switch was still
  // running, so the picture is never silently passed off as mid-switch.
  const beforePng = beforeShot.toPNG();
  const switchInvokesBefore = switchInvokes.length;
  const switchPromise = js(SWITCH_TO_PI);
  let switchSettled = false;
  switchPromise.then(
    () => {
      switchSettled = true;
    },
    () => {
      switchSettled = true;
    },
  );
  const switchStartedAt = Date.now();
  let duringPng = null;
  let duringAtMs = null;
  let duringWhileSwitching = false;
  while (!switchSettled && Date.now() - switchStartedAt < 5000) {
    const frame = await win.webContents.capturePage();
    const png = frame.toPNG();
    if (!png.equals(beforePng)) {
      duringPng = png;
      duringAtMs = Date.now() - switchStartedAt;
      duringWhileSwitching = !switchSettled;
      break;
    }
    await sleep(12);
  }
  if (!duringPng) {
    // No frame ever showed a change before the switch settled (or the switch
    // threw): record what the window is showing and say so.
    const frame = await win.webContents.capturePage();
    duringPng = frame.toPNG();
    duringAtMs = Date.now() - switchStartedAt;
    duringWhileSwitching = false;
  }
  fs.writeFileSync(path.join(artifactsDir, "agent-switch-during.png"), duringPng);
  const afterSwitchRaw = await switchPromise;
  const switchInvokesAfterSwitch = switchInvokes.length;
  const probeAfterSwitch = await js(READ_PROBE);
  const stateAfterSwitch = await readState();
  const draftAfterSwitch = await js(READ_COMPOSER);
  const afterShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "agent-switch-after.png"), afterShot.toPNG());

  // ── Switch back: the previous agent's tabs must return ───────────────────
  const restoredRaw = await js(SWITCH_BACK);
  const switchInvokesAfterRestore = switchInvokes.length;
  await sleep(400);
  const stateRestored = await readState();
  const draftRestored = await js(READ_COMPOSER);
  const probeAtEnd = await js(READ_PROBE);
  const storageBeforeReload = await js(readTabStorage(created.value.lifequest.id));
  const pageSwitchCalls = await js(
    "typeof window.__lqSwitchHarnessCalls === 'number' ? window.__lqSwitchHarnessCalls : null",
  );
  await js(STOP_RAIL_SAMPLER);

  // ── D. Per-agent tab memory across a reload ──────────────────────────────
  //
  // The strip a switch restores must be written per agent, so a fresh document
  // can bring this agent's tabs back. The reload is a cold renderer (it may
  // legitimately show the boot connect screen until the cached status lands),
  // so this leg is about the memory, not the switch transients: no dashboard
  // marker can survive a reload, and the setup screen is not asserted here.
  const reloadStartedAt = Date.now();
  let reloadSamples = 0;
  let reloadWelcomeCardSamples = 0;
  const reloadLoaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await reloadLoaded;
  await waitFor(
    "the dashboard after the reload",
    async () => {
      const state = await js(
        "(() => ({ dashboard: Boolean(document.querySelector('.home-dashboard')), welcomeCard: Boolean(document.querySelector('.welcome-card')) }))()",
      );
      reloadSamples += 1;
      if (state.welcomeCard) reloadWelcomeCardSamples += 1;
      return state.dashboard === true;
    },
    60_000,
    50,
  );
  const reloadBootMs = Date.now() - reloadStartedAt;
  await waitFor(
    "the chat dock after the reload",
    async () => Boolean(await js("Boolean(document.querySelector('.chat-panel'))")),
    30_000,
  );
  const expectedActiveTab = restoredRaw.activeTabLabel;
  await waitFor(
    "the restored Hermes tabs after the reload",
    async () =>
      Boolean(
        await js(
          `(() => {
            const labels = [...document.querySelectorAll(".chat-panel__tab")].map((tab) => tab.querySelector(".chat-panel__tab-label")?.textContent.trim() ?? "");
            const active = document.querySelector(".chat-panel__tab--active .chat-panel__tab-label")?.textContent.trim() ?? null;
            return labels.includes(${JSON.stringify(HERMES_TITLES[0])}) && labels.includes(${JSON.stringify(HERMES_TITLES[1])}) && active === ${JSON.stringify(expectedActiveTab)};
          })()`,
        ),
      ),
    20_000,
  );
  const reloadState = await readState();
  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean)
    : [];

  // ── What happened ────────────────────────────────────────────────────────
  const failures = [];
  const checks = [];
  const check = (name, pass, detail = null) => {
    checks.push({ name, pass: Boolean(pass), detail });
    if (!pass) failures.push(detail ? `${name}: ${detail}` : name);
  };

  const hermesTabsBefore =
    before.tabLabels.includes(HERMES_TITLES[0]) && before.tabLabels.includes(HERMES_TITLES[1]);

  check(
    "world: the app booted on Hermes with both seeded chats",
    seedOk && before.activePill === "Hermes",
    JSON.stringify({ seed, activePill: before.activePill, railTitles: before.railTitles }),
  );
  check("world: the surface is the dashboard, not a connect screen", before.dashboard && before.chatPanel, JSON.stringify({ dashboard: before.dashboard, chatPanel: before.chatPanel }));
  check(
    "world: two Hermes chats are open as two tabs",
    hermesTabsBefore && before.tabCount >= 2,
    JSON.stringify({ tabLabels: before.tabLabels, tabCount: before.tabCount, openedFirst, openedSecond }),
  );
  check(
    "world: the probe installed on the marked dashboard",
    installed.installed === true && installed.marked === true && installed.welcomeCard === false,
    JSON.stringify(installed),
  );

  // 1. No connection page during the switch.
  check(
    "no connection page appeared during the switch",
    probeAfterSwitch.welcomeSeen === 0 && afterSwitchRaw.welcomeCardAbsent === true,
    `welcomeSeen=${probeAfterSwitch.welcomeSeen}, welcomeCardAbsent=${afterSwitchRaw.welcomeCardAbsent}`,
  );
  // 2. The dashboard node never unmounted.
  check(
    "the dashboard node never unmounted",
    probeAfterSwitch.dashboardGone === 0 && afterSwitchRaw.markedDashboardPresent === true,
    `dashboardGone=${probeAfterSwitch.dashboardGone}, markedDashboardPresent=${afterSwitchRaw.markedDashboardPresent}`,
  );
  // 3. The launch splash never came back.
  check(
    "the launch splash never reappeared",
    probeAfterSwitch.splashSeen === 0 && probeAtEnd.splashSeen === 0,
    `splashSeen=${probeAfterSwitch.splashSeen}`,
  );
  // 4. The rail and tab strip moved to the new agent.
  check(
    "the chat rail swapped to the Pi chats",
    afterSwitchRaw.railTitles.includes(PI_TITLES[0]) &&
      afterSwitchRaw.railTitles.includes(PI_TITLES[1]) &&
      !afterSwitchRaw.railTitles.includes(HERMES_TITLES[0]),
    JSON.stringify({ railTitles: afterSwitchRaw.railTitles, timedOut: afterSwitchRaw.timedOut }),
  );
  check(
    "the dock's tab strip no longer shows the Hermes tabs",
    !afterSwitchRaw.tabLabels.some((label) => HERMES_TITLES.includes(label)),
    JSON.stringify(afterSwitchRaw.tabLabels),
  );
  // 5. The active pill is the one that was clicked, and it is not stuck disabled.
  check(
    "the active pill is Pi",
    afterSwitchRaw.activePill === "Pi" && afterSwitchRaw.pillDisabledAtEnd === false,
    JSON.stringify({
      activePill: afterSwitchRaw.activePill,
      pillDisabledAtEnd: afterSwitchRaw.pillDisabledAtEnd,
      pillDisabledSamples: afterSwitchRaw.pillDisabledSamples,
    }),
  );
  // 6. The switch was quick enough, and the number is reported either way.
  check(
    `the switch stayed under ${SWITCH_CEILING_MS}ms`,
    typeof afterSwitchRaw.switchMs === "number" &&
      afterSwitchRaw.switchMs > 0 &&
      afterSwitchRaw.switchMs <= SWITCH_CEILING_MS,
    `switchMs=${afterSwitchRaw.switchMs} (ceiling ${SWITCH_CEILING_MS}ms)`,
  );
  // 9. The dock surface stayed mounted at every sample.
  check(
    "the dock surface stayed mounted at every sample",
    probeAfterSwitch.chatPanelMissing === 0 && probeAfterSwitch.chatPanelPresentEverySample === true,
    JSON.stringify({
      chatPanelMissing: probeAfterSwitch.chatPanelMissing,
      chatPanelPresentEverySample: probeAfterSwitch.chatPanelPresentEverySample,
      duringSwitchSamples: probeAfterSwitch.duringSwitchSamples,
    }),
  );
  // 7. Switching back restores the previous agent's rail and tabs.
  check(
    "switching back returned the Hermes rail",
    restoredRaw.railTitles.includes(HERMES_TITLES[0]) &&
      restoredRaw.railTitles.includes(HERMES_TITLES[1]),
    JSON.stringify({ railTitles: restoredRaw.railTitles, timedOut: restoredRaw.timedOut }),
  );
  check(
    "switching back restored the two Hermes tabs",
    restoredRaw.tabLabels.includes(HERMES_TITLES[0]) &&
      restoredRaw.tabLabels.includes(HERMES_TITLES[1]) &&
      [HERMES_TITLES[0], HERMES_TITLES[1]].includes(restoredRaw.activeTabLabel),
    JSON.stringify({
      tabLabels: restoredRaw.tabLabels,
      activeTabLabel: restoredRaw.activeTabLabel,
      timedOut: restoredRaw.timedOut,
      restoreMs: restoredRaw.restoreMs,
    }),
  );
  check(
    "the dashboard was never torn down across the round trip",
    probeAtEnd.dashboardGone === 0 && probeAtEnd.markedDashboardPresent === true && probeAtEnd.chatPanelMissing === 0,
    JSON.stringify({
      dashboardGone: probeAtEnd.dashboardGone,
      markedDashboardPresent: probeAtEnd.markedDashboardPresent,
      chatPanelMissing: probeAtEnd.chatPanelMissing,
    }),
  );
  // 8. Nothing failed in the page.
  const consoleErrorsFiltered = consoleErrors.filter((row) => !KNOWN_NOISE.test(row.message));
  check(
    "the page logged no errors or uncaught exceptions",
    consoleErrorsFiltered.length === 0 &&
      renderProcessGone.length === 0 &&
      probeAtEnd.errors.length === 0,
    JSON.stringify({
      consoleErrors: consoleErrorsFiltered,
      renderProcessGone,
      pageErrors: probeAtEnd.errors,
      excludedNoise: consoleErrors.filter((row) => KNOWN_NOISE.test(row.message)),
    }),
  );

  // ── A. Exactly one switch invoke per pill click; the pending mark clears ──
  const switchCallsDuringSwitch = switchInvokesAfterSwitch - switchInvokesBefore;
  const switchCallsDuringRestore = switchInvokesAfterRestore - switchInvokesAfterSwitch;
  check(
    "each pill click sent exactly one companion:switchHarness invoke",
    switchCallsDuringSwitch === 1 && switchCallsDuringRestore === 1,
    JSON.stringify({
      duringSwitch: switchCallsDuringSwitch,
      duringRestore: switchCallsDuringRestore,
      total: switchInvokes.length,
      targets: switchInvokes.map((entry) => entry.target),
      pageWrap: switchCounter,
      pageCalls: pageSwitchCalls,
    }),
  );
  check(
    "the pending pill mark cleared",
    stateRestored.pendingPills.length === 0 && stateRestored.busyPills.length === 0,
    JSON.stringify({
      pendingAtEnd: stateRestored.pendingPills,
      busyAtEnd: stateRestored.busyPills,
      pendingAfterSwitch: stateAfterSwitch.pendingPills,
      busyAfterSwitch: stateAfterSwitch.busyPills,
    }),
  );
  // ── B. The rail never went blank ─────────────────────────────────────────
  check(
    "the chat rail never showed an empty column during the switch",
    probeAtEnd.railBlankSamples === 0 && probeAtEnd.railSampleCount > 0,
    JSON.stringify({
      blankSamples: probeAtEnd.railBlankSamples,
      samples: probeAtEnd.railSampleCount,
      blankDetails: probeAtEnd.railBlankDetails,
    }),
  );
  // ── C. The draft survives the round trip ─────────────────────────────────
  check(
    "the composer draft survived the round trip",
    draftTyped.ok === true && draftBefore.value === DRAFT && draftRestored.value === DRAFT,
    JSON.stringify({
      text: DRAFT,
      typed: draftTyped,
      before: draftBefore,
      afterSwitch: draftAfterSwitch,
      restored: draftRestored,
    }),
  );
  // ── D. One strip per agent, restored by a fresh document ─────────────────
  check(
    "both agents have their own remembered tab strip",
    storageBeforeReload.hermesRaw !== null && storageBeforeReload.piRaw !== null,
    JSON.stringify({ storage: storageBeforeReload }),
  );
  check(
    "a reload restored the two Hermes tabs",
    reloadState.tabLabels.includes(HERMES_TITLES[0]) &&
      reloadState.tabLabels.includes(HERMES_TITLES[1]) &&
      reloadState.activeTabLabel === expectedActiveTab,
    JSON.stringify({
      expectedActiveTab,
      reloadTabLabels: reloadState.tabLabels,
      reloadActiveTabLabel: reloadState.activeTabLabel,
      reloadBootMs,
      reloadSamples,
      reloadWelcomeCardSamples,
    }),
  );
  // ── E. The switch never disabled the target pill ─────────────────────────
  check(
    "the switch never disabled the target pill",
    afterSwitchRaw.pillDisabledSamples === 0,
    `pillDisabledSamples=${afterSwitchRaw.pillDisabledSamples}`,
  );

  const ok = failures.length === 0;
  const report = {
    ok,
    ranAt: new Date().toISOString(),
    failures,
    checks,
    world: {
      worldDir: world,
      profileDir,
      vaultDir,
      hermesHome,
      profile: PROBE_PROFILE,
      devServerUrl: DEV_SERVER_URL,
      piEndpoint: piBaseUrl,
      hermesHost: `http://127.0.0.1:${hostPort}/p/${PROBE_PROFILE}`,
      harnessOnBoot: (harnessesBefore.find((row) => row.active) || {}).id ?? null,
      hermesInvocations: calls,
    },
    seed,
    before: {
      harness: (harnessesBefore.find((row) => row.active) || {}).id ?? null,
      railTitles: before.railTitles,
      railActive: before.railActive,
      tabLabels: before.tabLabels,
      tabCount: before.tabCount,
      activeTabLabel: before.activeTabLabel,
      activePill: before.activePill,
      dashboard: before.dashboard,
      chatPanel: before.chatPanel,
    },
    probe: probeAtEnd,
    afterSwitch: {
      ...afterSwitchRaw,
      state: stateAfterSwitch,
    },
    restored: {
      ...restoredRaw,
      state: stateRestored,
    },
    switchCeilingMs: SWITCH_CEILING_MS,
    duringShot: {
      capturedAtMs: duringAtMs,
      whileSwitchPending: duringWhileSwitching,
      differsFromBefore: !duringPng.equals(beforePng),
    },
    switchInvokes: {
      total: switchInvokes.length,
      entries: switchInvokes.map((entry) => ({ at: entry.at, target: entry.target })),
      beforeSwitch: switchInvokesBefore,
      duringSwitch: switchCallsDuringSwitch,
      duringRestore: switchCallsDuringRestore,
      pageWrap: switchCounter,
      pageCalls: pageSwitchCalls,
    },
    rail: {
      blankSamples: probeAtEnd.railBlankSamples,
      sampleCount: probeAtEnd.railSampleCount,
      blankDetails: probeAtEnd.railBlankDetails,
    },
    pill: {
      disabledSamples: afterSwitchRaw.pillDisabledSamples,
      pendingAfterSwitch: stateAfterSwitch.pendingPills,
      busyAfterSwitch: stateAfterSwitch.busyPills,
      pendingAtEnd: stateRestored.pendingPills,
      busyAtEnd: stateRestored.busyPills,
    },
    draft: {
      text: DRAFT,
      typed: draftTyped,
      before: draftBefore,
      afterSwitch: draftAfterSwitch,
      restored: draftRestored,
    },
    persistence: {
      vaultId: created.value.lifequest.id,
      beforeReload: storageBeforeReload,
    },
    reload: {
      bootMs: reloadBootMs,
      samples: reloadSamples,
      welcomeCardSamples: reloadWelcomeCardSamples,
      welcomeCardSeen: reloadWelcomeCardSamples > 0,
      expectedActiveTab,
      tabLabels: reloadState.tabLabels,
      activeTabLabel: reloadState.activeTabLabel,
      dashboard: reloadState.dashboard,
      chatPanel: reloadState.chatPanel,
      state: reloadState,
    },
    consoleErrors: consoleErrorsFiltered,
    consoleErrorsExcluded: consoleErrors.filter((row) => KNOWN_NOISE.test(row.message)),
    renderProcessGone,
    pageErrors: probeAtEnd.errors,
    screenshots: [
      "agent-switch-before.png",
      "agent-switch-during.png",
      "agent-switch-after.png",
    ],
  };
  writeReport(report);

  console.log(`agent switch: ${ok ? "PASS" : "FAIL"}`);
  console.log(
    JSON.stringify(
      {
        ok,
        failures,
        welcomeSeen: probeAtEnd.welcomeSeen,
        dashboardGone: probeAtEnd.dashboardGone,
        splashSeen: probeAtEnd.splashSeen,
        chatPanelMissing: probeAtEnd.chatPanelMissing,
        switchMs: afterSwitchRaw.switchMs,
        afterSwitchRail: afterSwitchRaw.railTitles,
        afterSwitchTabs: afterSwitchRaw.tabLabels,
        restoredRail: restoredRaw.railTitles,
        restoredTabs: restoredRaw.tabLabels,
        restoredActiveTab: restoredRaw.activeTabLabel,
        switchInvokes: {
          duringSwitch: switchCallsDuringSwitch,
          duringRestore: switchCallsDuringRestore,
          pageWrap: switchCounter,
        },
        railBlankSamples: probeAtEnd.railBlankSamples,
        pillDisabledSamples: afterSwitchRaw.pillDisabledSamples,
        pendingAtEnd: stateRestored.pendingPills,
        draftRestored: draftRestored.value,
        storedStrips: {
          hermes: storageBeforeReload.hermesRaw !== null,
          pi: storageBeforeReload.piRaw !== null,
        },
        reloadTabs: reloadState.tabLabels,
        reloadActiveTab: reloadState.activeTabLabel,
        reloadWelcomeCardSamples,
        consoleErrors: consoleErrorsFiltered,
      },
      null,
      1,
    ),
  );
  return ok;
}

// ---------------------------------------------------------------------------
// Process lifecycle: always write a report, always exit, always close servers.
// ---------------------------------------------------------------------------

let exitCode = 1;
const watchdog = setTimeout(() => {
  try {
    writeReport({
      ok: false,
      ranAt: new Date().toISOString(),
      failures: ["the driver hit its watchdog before finishing"],
      probe: null,
      screenshots: [],
    });
  } catch {
    // Nothing else can be written; the exit still has to happen.
  }
  app.exit(1);
}, DRIVER_WATCHDOG_MS);
watchdog.unref?.();

app.whenReady().then(async () => {
  try {
    exitCode = (await main()) ? 0 : 1;
  } catch (error) {
    try {
      writeReport({
        ok: false,
        ranAt: new Date().toISOString(),
        failures: [`the rig crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`],
        screenshots: [],
      });
    } catch {
      // The exit below is what matters.
    }
    console.error("agent-switch rig failed:", error);
    exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    for (const server of openServers.splice(0)) {
      try {
        server.close();
      } catch {
        // Already closed.
      }
    }
    app.exit(exitCode);
  }
});
