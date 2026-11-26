/**
 * The agent-picker-modes rig: does the dock's picker answer to the recipe it says
 * it is wearing?
 *
 * Why this exists. The picker is one control with one job ("who answers next"),
 * but its *shape* is a theme-authored recipe of four closed axes — roster,
 * labels, ring, size (`shared/agent-picker.ts`). The app ships three preset
 * modes over those axes (`one-mark` the quiet default, `named-chip` the same
 * trigger plus the answering agent's name, `quiet-stack` both marks in a row
 * under the composer box), accepts a theme's own `custom` combination, and lets
 * operator layer a Settings override on top without flattening the mode the
 * theme chose. Every one of those sentences is only true if the shipped
 * renderer, the theme parser, the Settings/Studio controls and the route rename
 * agree on it, so this rig boots the REAL app in a throwaway world and measures
 * each one by name:
 *
 *  1. `default-is-one-mark` — a fresh profile wears one mark, a menu roster and
 *     no label; the trigger is the Hermes agent.
 *  2. `menu-lists-the-roster` — opening the trigger shows both agents, each with
 *     a name and a blurb; Escape closes it and reopening works.
 *  3. `one-choice-is-one-switch` — choosing Pi invokes `companion:switchHarness`
 *     exactly once (counted at the main-process IPC seam), the trigger comes to
 *     name Pi, and no option was ever disabled during the click (sampled).
 *  4. `pending-is-visible-and-brief` — the target wears `data-pending`/`aria-busy`
 *     at least once between click and settle, and nothing is left pending.
 *  5. `theme-names-a-mode` — a kept theme with `chrome.agentPicker.mode:
 *     "named-chip"` survives a reload, and the trigger names Hermes.
 *  6. `theme-combines-axes` — a kept `custom` recipe (inline · all · hairline ·
 *     large) renders every axis at once, offers no menu trigger, names both
 *     agents, and still switches in one click → one invoke.
 *  7. `override-does-not-flatten-the-mode` — a Settings size override on a
 *     named-chip theme yields named-chip *and* large (the layering bug this
 *     feature fixed), and Layout's Reset returns the theme's named-chip/default.
 *  8. `studio-writes-the-file` — the old `/extensions` address redirects to
 *     `/customizations`; the Studio's Components section writes
 *     `chrome.agentPicker.mode: "quiet-stack"`, Save → Keep → reload keeps it.
 *  9. `refusal-names-the-field` — a theme naming mode `"stacked"` is refused with
 *     `chrome.agentPicker.mode` in the error, the picker does not change, and the
 *     bad file is not kept.
 * 10. `the-old-address-redirects` — `#/extensions` lands on `#/customizations`.
 *
 * The world is hermetic and throwaway, copied from `agent-switch.electron.mjs`:
 * a throwaway Electron profile and vault (made with the real `createVault`), a
 * throwaway `HERMES_HOME` with a `hermes` stub first on PATH, a fake Hermes host
 * gateway on loopback for the external agent, and a fake OpenAI-compatible
 * endpoint for the built-in one. Both agents get seeded chats, the document
 * reloads so it boots the way a launch does, and the picker is read through the
 * DOM contract (`data-testid="agent-picker"` plus its `data-*` axes) rather than
 * through pixels.
 *
 * Theme writes are the companion's gesture, not a back door: the rig writes the
 * JSON into `<profile>/themes/` and then uses the shipped ten-second preview gate
 * (Preview → Keep) and a reload, exactly as `theme-chrome.electron.mjs` does. If
 * the gate cannot be driven it falls back to main's own `themeSetKept` state door
 * plus a reload, and the report says which path each theme took.
 *
 * The click path is the money claim, so it is measured twice: once for the menu
 * roster and once for the inline roster, both counted at the IPC seam. The
 * pending mark is observed by a MutationObserver on `#root` (plus a 10 ms
 * sampler) installed before the click, because a fast local switch can show it
 * for less than one frame.
 *
 * Artifacts:
 *   e2e/artifacts/agent-picker-modes.json              the report
 *   e2e/artifacts/agent-picker-default.png             the quiet one-mark trigger (whole window)
 *   e2e/artifacts/agent-picker-menu.png                menu open, both names and blurbs (cropped)
 *   e2e/artifacts/agent-picker-named-chip.png          named-chip trigger (cropped)
 *   e2e/artifacts/agent-picker-quiet-stack.png         inline pair under the composer box (cropped)
 *   e2e/artifacts/agent-picker-studio-components.png   studio → Components (cropped)
 *
 * Run by `tests/agent-picker-modes-e2e.test.ts`, through the shared bench wrapper
 * (the rig loads the renderer that wrapper puts on 127.0.0.1:5173):
 *   /root/.local/bin/lifequest-e2e <checkout> tests/agent-picker-modes-e2e.test.ts
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
const REPORT = path.join(artifactsDir, "agent-picker-modes.json");

/** The endpoint model the built-in companion is pointed at. */
const MODEL = "rig-model";
/** A profile name no real install has: the companion runs on its own `profiles/<name>`. */
const PROBE_PROFILE = "lq-agent-picker-modes";
const DEV_URL = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173";

/** Distinct chat titles prove which agent's rail is in front after each switch. */
const HERMES_TITLES = ["Hermes alpha", "Hermes beta"];
const PI_TITLES = ["Pi alpha", "Pi beta"];

/** Click → picker/settled ceiling for the "brief" half of check 4. */
const PENDING_CEILING_MS = 3000;
/** How long a page script waits for a switch to land before recording a timeout. */
const SWITCH_WAIT_MS = 20_000;
/** How long the page waits for the roster to render after opening it. */
const ROSTER_WAIT_MS = 5_000;
/** How long the renderer waits for the theme watcher's preview before we fall back. */
const THEME_WATCH_MS = 20_000;
/** Watchdog: never leave the wrapper with a hung Electron process. */
const DRIVER_WATCHDOG_MS = 540_000;

const SHOT = {
  default: "agent-picker-default.png",
  menu: "agent-picker-menu.png",
  namedChip: "agent-picker-named-chip.png",
  quietStack: "agent-picker-quiet-stack.png",
  studio: "agent-picker-studio-components.png",
  gutter: "agent-picker-gutter.png",
  namedChipGutter: "agent-picker-named-chip-gutter.png",
};

/**
 * The wide dock the operator actually drags, drawn wider than the bench display.
 *
 * The divider's own clamp is 70% of the frame (or frame minus nav minus 400px,
 * whichever bites), so the 52rem composer band the labelled chip needs cannot
 * exist in the default 1280px window. The bench display is 1600x1000, so the
 * window is drawn 1760 wide with its leading 160px off the screen: the
 * composer's trailing gutter — everything the wide photographs keep — stays on
 * the visible display.
 */
const WIDE_WINDOW = { width: 1760, height: 940, x: -160, y: 0 };
/** Composer-band targets for the wide leg, in CSS px. */
const WIDE_ONE_MARK_BAND = 900;
const WIDE_NAMED_CHIP_BAND = 850;
const WIDE_NAMED_CHIP_WIDE_BAND = 1000;
/** The task's floor for "a wide dock": clear of the 34rem fallback query. */
const WIDE_BAND_MIN = 640;
/** The CSS box-sizing thresholds the two modes are drawn against. */
const ONE_MARK_BREAKPOINT_PX = 34 * 16;
const NAMED_CHIP_BREAKPOINT_PX = 52 * 16;

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
  await Promise.all(
    held.map(
      (server) =>
        new Promise((resolve) => {
          const at = openServers.indexOf(server);
          if (at >= 0) openServers.splice(at, 1);
          server.close(resolve);
        }),
    ),
  );
  return ports;
}

/**
 * Every `companion:switchHarness` invoke, counted at the main-process IPC seam.
 *
 * The renderer's bridge is a frozen contextBridge object, so wrapping it in the
 * page is not trustworthy; this is the seam the click actually crosses. The wrap
 * is installed before `bootForE2e` registers its handlers, which is what makes
 * "one choice, one invoke" a real count instead of a guess.
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

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const failures = [];
const checks = [];

function check(label, pass, detail = null) {
  const entry = {
    label,
    pass: Boolean(pass),
    detail: detail === null || detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
  };
  checks.push(entry);
  if (!entry.pass) failures.push(`${label}: ${entry.detail ?? "failed"}`);
  return entry.pass;
}

function writeReport(report) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

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
      `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
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

/**
 * Everything a check reads about the picker: the resolved recipe off the root,
 * the trigger, the roster rows (only present while a menu is open; inline modes
 * keep them under the composer box), the mark count, and the boxes the pictures crop.
 */
const READ_PICKER = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      left: Math.round(b.left),
      top: Math.round(b.top),
      right: Math.round(b.right),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
      height: Math.round(b.height),
    };
  };
  const picker = document.querySelector('[data-testid="agent-picker"]');
  const trigger = document.querySelector('[data-testid="agent-picker-trigger"]');
  const menu = document.querySelector('[data-testid="agent-picker-menu"]');
  const optionEls = [...document.querySelectorAll(".agent-switcher__option")];
  const options = optionEls.map((el) => ({
    agent: el.getAttribute("data-agent"),
    role: el.getAttribute("role"),
    testid: el.getAttribute("data-testid"),
    checked: el.getAttribute("aria-checked") === "true",
    disabled: el.disabled === true,
    pending: el.getAttribute("data-pending") === "true",
    busy: el.getAttribute("aria-busy") === "true",
    name: text(el.querySelector(".agent-switcher__name")),
    blurb: text(el.querySelector(".agent-switcher__blurb")),
  }));
  const pending = [
    ...document.querySelectorAll(
      '.agent-switcher [data-pending="true"], .agent-switcher [aria-busy="true"]',
    ),
  ].map((el) => ({
    testid: el.getAttribute("data-testid"),
    agent: el.getAttribute("data-agent"),
    pending: el.getAttribute("data-pending"),
    busy: el.getAttribute("aria-busy"),
  }));
  // The wide-dock geometry: the composer band the container query measures, the
  // box the gutter's trigger must clear, and the divider that sets the column.
  const footer = document.querySelector(".chat-panel__footer");
  const footerBox = box(footer);
  const footerPad = footer
    ? parseFloat(getComputedStyle(footer).paddingLeft) + parseFloat(getComputedStyle(footer).paddingRight)
    : 0;
  const dividerEl = document.querySelector('[data-testid="chat-divider"]');
  const dividerNow = dividerEl ? Number(dividerEl.getAttribute("aria-valuenow")) : NaN;
  const dividerMax = dividerEl ? Number(dividerEl.getAttribute("aria-valuemax")) : NaN;
  return {
    present: Boolean(picker),
    dockPresent: Boolean(document.querySelector(".chat-panel")),
    mode: picker ? picker.getAttribute("data-mode") : null,
    roster: picker ? picker.getAttribute("data-roster") : null,
    labels: picker ? picker.getAttribute("data-labels") : null,
    ring: picker ? picker.getAttribute("data-ring") : null,
    size: picker ? picker.getAttribute("data-size") : null,
    rootRole: picker ? picker.getAttribute("role") : null,
    markCount: document.querySelectorAll(".agent-switcher__mark").length,
    triggerCount: document.querySelectorAll('[data-testid="agent-picker-trigger"]').length,
    trigger: trigger
      ? {
          testid: trigger.getAttribute("data-testid"),
          agent: trigger.getAttribute("data-agent"),
          expanded: trigger.getAttribute("aria-expanded"),
          haspopup: trigger.getAttribute("aria-haspopup"),
          pending: trigger.getAttribute("data-pending") === "true",
          busy: trigger.getAttribute("aria-busy") === "true",
          disabled: trigger.disabled === true,
        }
      : null,
    triggerName: trigger ? text(trigger.querySelector(".agent-switcher__name")) : "",
    names: [...document.querySelectorAll(".agent-switcher__name")].map(text),
    menuOpen: Boolean(menu),
    menuRole: menu ? menu.getAttribute("role") : null,
    menuRows: options.filter((row) => row.role === "menuitemradio"),
    inlineRadios: document.querySelectorAll('.agent-switcher[data-roster="inline"] [role="radio"]').length,
    options,
    pending,
    pendingCount: pending.length,
    pickerRect: box(picker),
    composerRect: box(document.querySelector(".chat-panel__composer")),
    composerBoxRect: box(document.querySelector(".chat-panel__composer-box")),
    footerRect: footerBox,
    // The container query's number: the footer's content box, not its border box.
    bandWidth: footerBox ? Math.round(footerBox.width - footerPad) : null,
    divider: dividerEl
      ? {
          side: dividerEl.getAttribute("data-side"),
          now: Number.isFinite(dividerNow) ? dividerNow : null,
          max: Number.isFinite(dividerMax) ? dividerMax : null,
          rect: box(dividerEl),
        }
      : null,
    dockRowRect: box(document.querySelector(".chat-panel__composer-dock")),
    menuRect: box(menu),
    dockRect: box(document.querySelector(".chat-panel")),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hash: window.location.hash,
  };
})()`;

/**
 * The page-side gates: theme preview/error, the Customizations page and its
 * Studio, the kept file (read through main's own state door), and the boxes the
 * studio picture crops.
 */
const READ_SURFACE = `(async () => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      left: Math.round(b.left),
      top: Math.round(b.top),
      right: Math.round(b.right),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
      height: Math.round(b.height),
    };
  };
  const preview = document.querySelector('[data-testid="theme-preview-bar"]');
  const errorBar = document.querySelector('[data-testid="theme-error"]');
  const pageError = document.querySelector('[data-testid="customizations-error"]');
  let keptFile = null;
  try {
    const state = await window.lifequest?.themeGetState?.();
    keptFile = state && state.ok ? state.value.keptFile : null;
  } catch {
    keptFile = null;
  }
  const picker = document.querySelector('[data-testid="agent-picker"]');
  const activeSection = [...document.querySelectorAll('[data-testid^="studio-section-tab-"]')].find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  return {
    shell: Boolean(document.querySelector(".shell")),
    chatPanel: Boolean(document.querySelector(".chat-panel")),
    hash: window.location.hash,
    preview: Boolean(preview),
    previewText: preview ? text(preview) : null,
    errorBar: errorBar ? text(errorBar) : null,
    pageError: pageError ? text(pageError) : null,
    themeError: [errorBar ? text(errorBar) : "", pageError ? text(pageError) : ""]
      .filter(Boolean)
      .join(" | "),
    customizationsPage: Boolean(document.querySelector('[data-testid="customizations-page"]')),
    customizationsRows: document.querySelectorAll(
      '[data-testid="customizations-page"] li[data-testid^="customization-"]',
    ).length,
    customizationsCount: text(document.querySelector('[data-testid="customizations-count"]')),
    editor: Boolean(document.querySelector('[data-testid="customization-editor"]')),
    studio: Boolean(document.querySelector('[data-testid="customization-studio"]')),
    studioSection: activeSection
      ? activeSection.getAttribute("data-testid").replace("studio-section-tab-", "")
      : null,
    componentsPanel: Boolean(document.querySelector('[data-testid="studio-components"]')),
    modeQuietStackSelected: (() => {
      const button = document.querySelector('[data-testid="studio-agent-picker-mode-quiet-stack"]');
      return button ? button.getAttribute("aria-checked") === "true" : null;
    })(),
    studioSaveDisabled: (() => {
      const button = document.querySelector('[data-testid="studio-save"]');
      return button ? button.disabled === true : null;
    })(),
    pickerMode: picker ? picker.getAttribute("data-mode") : null,
    pickerRoster: picker ? picker.getAttribute("data-roster") : null,
    pickerSize: picker ? picker.getAttribute("data-size") : null,
    keptFile,
    studioRect: box(document.querySelector('[data-testid="customization-studio"]')),
    componentsRect: box(document.querySelector('[data-testid="studio-components"]')),
    pickerRect: box(picker),
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
})()`;

/** Open the menu roster if it is not already open. */
const OPEN_MENU = `(async () => {
  const menu = () => document.querySelector('[data-testid="agent-picker-menu"]');
  const trigger = () => document.querySelector('[data-testid="agent-picker-trigger"]');
  if (menu()) return { opened: true, alreadyOpen: true, reason: null };
  const el = trigger();
  if (!el) return { opened: false, alreadyOpen: false, reason: "no picker trigger in the dock" };
  el.click();
  const deadline = performance.now() + ${ROSTER_WAIT_MS};
  while (performance.now() < deadline) {
    if (menu()) return { opened: true, alreadyOpen: false, reason: null };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { opened: false, alreadyOpen: false, reason: "the roster did not open" };
})()`;

/** Close the open menu with Escape, then reopen it with the trigger. */
const ESCAPE_THEN_REOPEN = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const menu = () => document.querySelector('[data-testid="agent-picker-menu"]');
  const trigger = () => document.querySelector('[data-testid="agent-picker-trigger"]');
  const wasOpen = Boolean(menu());
  // The picker listens for Escape on the document; dispatch from the focused
  // element so the event travels the way a keyboard operator's would.
  const from = document.activeElement || document.body;
  from.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  let escapeClosed = !menu();
  const closeDeadline = performance.now() + 3000;
  while (!escapeClosed && performance.now() < closeDeadline) {
    await sleep(20);
    escapeClosed = !menu();
  }
  let reopened = false;
  if (escapeClosed) {
    const el = trigger();
    if (el) el.click();
    const openDeadline = performance.now() + ${ROSTER_WAIT_MS};
    while (performance.now() < openDeadline) {
      if (menu()) {
        reopened = true;
        break;
      }
      await sleep(20);
    }
  }
  return {
    wasOpen,
    escapeClosed,
    reopened,
    menuOpen: Boolean(menu()),
    focusAfterEscape: document.activeElement ? document.activeElement.getAttribute("data-testid") : null,
  };
})()`;

/**
 * Choose one agent and wait for the switch to settle: the trigger names it, the
 * rail holds its chats, and nothing in the picker is pending.
 *
 * The probe is installed before the click because a local switch can show the
 * pending mark for less than a sampled frame: a MutationObserver on `#root`
 * records the *addition* of `data-pending`/`aria-busy` (records survive even if
 * the attribute is gone by the callback), while a 10 ms sampler and the
 * per-iteration checks cover the render state. The same pass samples `disabled`
 * additions, which is the "never greys out under the pointer" rule.
 */
function chooseAgentScript(target, railTitles) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const trigger = () => document.querySelector('[data-testid="agent-picker-trigger"]');
    const row = () => document.querySelector('[data-testid="agent-picker-option-${target}"]');
    const menu = () => document.querySelector('[data-testid="agent-picker-menu"]');
    const rail = () => [...document.querySelectorAll(".chats-rail__rows .chats-rail__row")].map((li) =>
      text(li.querySelector(".chats-rail__label")),
    );
    const activeAgent = () => {
      const t = trigger();
      if (t) return t.getAttribute("data-agent");
      const checked = document.querySelector('.agent-switcher__option[aria-checked="true"]');
      return checked ? checked.getAttribute("data-agent") : null;
    };
    const pendingEls = () =>
      [...document.querySelectorAll('.agent-switcher [data-pending="true"], .agent-switcher [aria-busy="true"]')];
    const disabledEls = () =>
      [
        ...document.querySelectorAll(
          '.agent-switcher [role="menuitemradio"][disabled], .agent-switcher [role="radio"][disabled], .agent-switcher__trigger[disabled]',
        ),
      ];
    const wanted = ${JSON.stringify(railTitles)};

    // The probe. pendingSamples holds the first few sightings with enough
    // detail to say which control wore the mark.
    //
    // Both samples are scoped to the picker itself: the app root also contains
    // the whole dock, and "the composer's send button became disabled for a
    // moment" is a different claim than "the picker greyed out an agent under
    // the pointer". Only an element inside the agent-switcher counts.
    let startedAt = performance.now();
    const inPicker = (el) => Boolean(el && el.closest && el.closest(".agent-switcher"));
    const probe = { pendingSeen: false, pendingSamples: [], disabledSamples: 0, disabledDetails: [] };
    const root = document.getElementById("root") || document.body;
    const notePending = (el) => {
      probe.pendingSeen = true;
      if (probe.pendingSamples.length < 10) {
        probe.pendingSamples.push({
          at: Math.round(performance.now() - startedAt),
          testid: el.getAttribute("data-testid"),
          agent: el.getAttribute("data-agent"),
          pending: el.getAttribute("data-pending"),
          busy: el.getAttribute("aria-busy"),
        });
      }
    };
    const noteDisabled = (el) => {
      probe.disabledSamples += 1;
      if (probe.disabledDetails.length < 5) {
        probe.disabledDetails.push({
          testid: el.getAttribute("data-testid"),
          agent: el.getAttribute("data-agent"),
          at: Math.round(performance.now() - startedAt),
        });
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== "attributes") continue;
        const el = record.target;
        if (!inPicker(el)) continue;
        if (record.attributeName === "data-pending" && record.oldValue === null) notePending(el);
        if (record.attributeName === "aria-busy" && record.oldValue === null) notePending(el);
        if (record.attributeName === "disabled" && el.disabled === true) noteDisabled(el);
      }
    });
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-pending", "aria-busy", "disabled"],
    });
    const sampler = setInterval(() => {
      const pending = pendingEls();
      if (pending.length > 0) notePending(pending[0]);
      const disabled = disabledEls();
      if (disabled.length > 0) noteDisabled(disabled[0]);
    }, 10);
    const finish = (result) => {
      clearInterval(sampler);
      observer.disconnect();
      return result;
    };

    const wasActive = activeAgent() === "${target}";
    let openedRoster = false;
    if (!wasActive && !row()) {
      const el = trigger();
      if (!el) return finish({ clicked: false, reason: "no picker trigger in the dock", ...probe });
      el.click();
      openedRoster = true;
      const openDeadline = performance.now() + ${ROSTER_WAIT_MS};
      while (performance.now() < openDeadline && !row()) await sleep(20);
    }
    const targetRow = row();
    if (!targetRow) {
      return finish({
        clicked: false,
        reason: "no ${target} option in the picker",
        rosterOpen: Boolean(menu()),
        ...probe,
      });
    }
    if (targetRow.getAttribute("aria-checked") === "true" || wasActive) {
      return finish({
        clicked: false,
        skipped: true,
        wasActive: true,
        activeAgent: activeAgent(),
        openedRoster,
        pendingAtEnd: pendingEls().length,
        railTitles: rail(),
        ...probe,
      });
    }
    if (targetRow.disabled === true) noteDisabled(targetRow);
    startedAt = performance.now();
    targetRow.click();
    const settleDeadline = performance.now() + ${SWITCH_WAIT_MS};
    let lastRail = [];
    while (performance.now() < settleDeadline) {
      const pend = pendingEls();
      if (pend.length > 0) notePending(pend[0]);
      const disabled = disabledEls();
      if (disabled.length > 0) noteDisabled(disabled[0]);
      const current = trigger();
      lastRail = rail();
      if (
        activeAgent() === "${target}" &&
        pend.length === 0 &&
        wanted.some((title) => lastRail.includes(title))
      ) {
        return finish({
          clicked: true,
          timedOut: false,
          openedRoster,
          switchMs: Math.round(performance.now() - startedAt),
          activeAgent: activeAgent(),
          triggerAgent: current ? current.getAttribute("data-agent") : null,
          triggerPendingAtEnd: current ? current.getAttribute("data-pending") === "true" : null,
          triggerBusyAtEnd: current ? current.getAttribute("aria-busy") === "true" : null,
          railTitles: lastRail,
          menuClosedAfterChoice: !menu(),
          pendingAtEnd: pend.length,
          pendingSeen: probe.pendingSeen,
          pendingSamples: probe.pendingSamples,
          disabledSamples: probe.disabledSamples,
          disabledDetails: probe.disabledDetails,
        });
      }
      await sleep(10);
    }
    return finish({
      clicked: true,
      timedOut: true,
      openedRoster,
      switchMs: Math.round(performance.now() - startedAt),
      activeAgent: activeAgent(),
      railTitles: lastRail,
      pendingAtEnd: pendingEls().length,
      pendingSeen: probe.pendingSeen,
      pendingSamples: probe.pendingSamples,
      disabledSamples: probe.disabledSamples,
      disabledDetails: probe.disabledDetails,
    });
  })()`;
}

// ---------------------------------------------------------------------------
// Crops and captures
// ---------------------------------------------------------------------------

/** The union of some page boxes, padded and clipped to the window. */
function cropAround(boxes, viewport, pad = 16) {
  const present = boxes.filter(Boolean);
  if (present.length === 0) return undefined;
  const left = Math.max(0, Math.min(...present.map((box) => box.left)) - pad);
  const top = Math.max(0, Math.min(...present.map((box) => box.top)) - pad);
  const right = Math.min(viewport.width, Math.max(...present.map((box) => box.right)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...present.map((box) => box.bottom)) + pad);
  if (right <= left || bottom <= top) return undefined;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // ── The world ────────────────────────────────────────────────────────────
  const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-agent-picker-modes-"));
  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const callLog = path.join(world, "hermes-calls.log");
  const themesDir = path.join(profileDir, "themes");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  writeHermesStub(binDir, callLog);

  const created = await createVault(vaultDir, "Agent Picker Modes");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);

  // `companionProfile` moves the app off the real `lifequest` Hermes profile; the
  // recent vault makes the renderer land on the dashboard, not `/welcome`.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: created.value.lifequest.id,
            name: "Agent Picker Modes",
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
  // The shared bench wrapper serves THIS checkout on 5173 (it holds the e2e lock
  // while this rig runs); the rig tests the renderer the bench is serving.
  process.env.VITE_DEV_SERVER_URL = DEV_URL;
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
    const severity = typeof event?.level === "string" ? event.level : level;
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

  const poll = async (script, predicate = Boolean, timeout = 30_000, interval = 100) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      try {
        last = await js(script);
      } catch {
        // A reload destroys the execution context; retry until it is back.
        last = null;
      }
      if (predicate(last)) return { ok: true, value: last };
      await sleep(interval);
    }
    return { ok: false, value: last };
  };

  const requireGate = async (script, predicate, label, timeout = 60_000) => {
    const got = await poll(script, predicate, timeout);
    if (!got.ok) {
      throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(got.value).slice(0, 700)}`);
    }
    return got.value;
  };

  const readPicker = () => js(READ_PICKER);
  const readSurface = () => js(READ_SURFACE);

  /**
   * Where the inline roster sits, in numbers.
   *
   * The inline rosters (`quiet-stack`, any `roster: "inline"` recipe) are a real
   * row of the composer FORM, under the composer box — not a token in the
   * control row. The claim this helper checks is geometric: the row starts below
   * the box's bottom edge with the form's own gap between them, and its right
   * edge lands on the box's trailing edge (the edge the send control sits on),
   * within a rounding pixel. It also has to stay inside the dock column, which is
   * the only thing that can clip it.
   */
  const inlinePlacement = (state) => {
    const box = state.composerBoxRect;
    const picker = state.pickerRect;
    const column = state.dockRect;
    if (!box || !picker || !column) {
      return { ok: false, reason: "composerBoxRect/pickerRect/dockRect missing", problems: ["a rect is missing"] };
    }
    const numbers = {
      composerBoxBottom: box.bottom,
      composerBoxRight: box.right,
      pickerTop: picker.top,
      pickerRight: picker.right,
      pickerBottom: picker.bottom,
      gap: picker.top - box.bottom,
      rightDelta: picker.right - box.right,
      belowBox: picker.top >= box.bottom - 1,
      notOverlappingBox: picker.top >= box.bottom,
      rightAligned: Math.abs(picker.right - box.right) <= 2,
      insideDock:
        picker.left >= column.left &&
        picker.right <= column.right &&
        picker.top >= column.top &&
        picker.bottom <= column.bottom,
      realGap: picker.top - box.bottom > 0 && picker.top - box.bottom < 40,
      column,
      composerBox: box,
      picker,
    };
    const problems = [];
    if (!numbers.belowBox) {
      problems.push(`picker top ${picker.top} is not below the box bottom ${box.bottom} (gap ${numbers.gap}px)`);
    }
    if (!numbers.notOverlappingBox) {
      problems.push(`picker overlaps the composer box (picker top ${picker.top} < box bottom ${box.bottom})`);
    }
    if (!numbers.rightAligned) {
      problems.push(`picker right ${picker.right} is ${numbers.rightDelta}px off the box right ${box.right}`);
    }
    if (!numbers.insideDock) {
      problems.push(
        `picker ${JSON.stringify(picker)} is outside the dock column ${JSON.stringify({ left: column.left, right: column.right, top: column.top, bottom: column.bottom })}`,
      );
    }
    if (!numbers.realGap) {
      problems.push(`the gap ${numbers.gap}px is not a real row gap (0 < gap < 40)`);
    }
    return { ok: problems.length === 0, problems, ...numbers };
  };

  const reloadDocument = async () => {
    const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await loaded;
    await requireGate(
      "Boolean(document.querySelector('.shell'))",
      Boolean,
      "the shell after a reload",
      60_000,
    );
  };

  const waitForDockPicker = (label = "the dock's agent picker", mode = null) =>
    requireGate(
      READ_PICKER,
      (picker) => Boolean(picker && picker.present) && (mode === null || picker.mode === mode),
      label,
      90_000,
    );

  /**
   * Wait for the compositor to publish a frame, then capture.
   *
   * `capturePage` can hand back the previous (or a blank) surface right after a
   * reload or a theme repaint — the DOM is already correct, the pixels are not
   * yet. Two rAFs request a frame; the timeout keeps an occluded window's
   * throttled rAF from hanging the rig. A capture that comes back suspiciously
   * small for its crop (a uniform fill) is retried, and the byte count goes into
   * the report so a blank picture is visible as data rather than as "a file
   * exists".
   */
  const settlePaint = async () => {
    await js(
      "Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise((resolve) => setTimeout(resolve, 500))])",
    ).catch(() => {});
    await sleep(150);
  };

  const shot = async (file, rect) => {
    const target = path.join(artifactsDir, file);
    let bytes = 0;
    let attempt = 0;
    for (; attempt < 3; attempt += 1) {
      await settlePaint();
      let image;
      try {
        image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
      } catch {
        continue;
      }
      const png = image.toPNG();
      bytes = png.length;
      fs.writeFileSync(target, png);
      // A non-blank crop of this UI is kilobytes; a uniform fill is hundreds of
      // bytes. The full-window default shot has far more, so it uses a higher bar.
      const floor = rect ? 3000 : 20_000;
      if (bytes >= floor) break;
    }
    return { path: target, bytes, attempts: attempt + 1 };
  };

  // ── Theme files: the companion's gesture, then the shipped gate ──────────
  const themePath = (file) => path.join(themesDir, file);
  const writeTheme = (file, theme) => {
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(themePath(file), `${JSON.stringify(theme, null, 2)}\n`);
  };
  const readKept = async () => {
    try {
      return await js(
        "window.lifequest.themeGetState().then((state) => (state && state.ok ? state.value.keptFile : null)).catch(() => null)",
      );
    } catch {
      return null;
    }
  };

  /**
   * Put a theme file on disk and make it the kept theme through the app's own
   * ten-second preview gate: wait for the bar that names the file, press Keep,
   * and confirm main's state door agrees.
   *
   * If the gate does not answer (a watcher that missed the write, a Keep that
   * never landed), the fallback is main's own `themeSetKept` followed by a
   * reload — the same state Keep writes, just without the button — and the
   * report records which path the theme took. It is never the first path.
   */
  const keepThemeThroughTheApp = async (file) => {
    let surface = null;
    const until = Date.now() + THEME_WATCH_MS;
    while (Date.now() < until) {
      surface = await readSurface();
      if (surface && surface.preview && (surface.previewText ?? "").includes(file)) break;
      await sleep(100);
    }
    const previewSeen = Boolean(surface && surface.preview && (surface.previewText ?? "").includes(file));
    let keepClicked = false;
    if (previewSeen) {
      keepClicked = await js(
        `(() => { const button = document.querySelector('[data-testid="theme-keep"]'); if (!button) return false; button.click(); return true; })()`,
      );
    }
    let kept = await readKept();
    for (let i = 0; i < 60 && kept !== file; i += 1) {
      await sleep(100);
      kept = await readKept();
    }
    let method = keepClicked && kept === file ? "preview-keep" : null;
    if (kept !== file) {
      const viaState = await js(
        `window.lifequest.themeSetKept(${JSON.stringify(file)}).then((answer) => Boolean(answer && answer.ok)).catch(() => false)`,
      );
      if (viaState) {
        await reloadDocument();
        kept = await readKept();
        method = "themeSetKept+reload";
      }
    }
    return { file, previewSeen, keepClicked, kept, method };
  };

  const openSettingsAppearance = async () => {
    const clicked = await js(
      `(() => { const trigger = document.querySelector(".settings-menu__trigger"); if (!trigger) return false; trigger.click(); return true; })()`,
    );
    if (!clicked) return false;
    for (let i = 0; i < 100; i += 1) {
      const present = await js(
        `Boolean(document.querySelector('[data-testid="settings-agent-picker-size-large"]'))`,
      );
      if (present) {
        // The next action is a click on this page. Let its first frame land, or
        // a click can be dispatched into a tree React is still committing and
        // silently lost — which reads as "the control did nothing".
        await settlePaint();
        return true;
      }
      await js(
        `(() => { const item = [...document.querySelectorAll(".settings-nav-item")].find((el) => (el.textContent || "").includes("Appearance")); if (item) item.click(); return true; })()`,
      );
      await sleep(150);
    }
    return false;
  };

  const navigateHome = async () => {
    await js(`(() => { location.hash = "#/home"; return location.hash; })()`);
    await requireGate(
      READ_PICKER,
      (picker) => Boolean(picker && picker.present && picker.trigger) && picker.hash === "#/home",
      "the dock picker after going back to the dashboard",
      20_000,
    );
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  await requireGate("Boolean(window.lifequest)", Boolean, "the preload bridge", 30_000);

  // Seed the two agents: a chat list on each, then hand the boot back to Hermes.
  const seed = await js(`(async () => {
    const api = window.lifequest;
    const status = (value) => (value && value.kind) || "unknown";
    const hermesReady = status(await api.companionUseHarness("hermes"));
    const hermesCreated = [];
    for (const title of ${JSON.stringify(HERMES_TITLES)}) {
      const created = await api.companionSessionCreate(title);
      hermesCreated.push({ title, ok: Boolean(created && created.ok) });
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
      piCreated.push({ title, ok: Boolean(created && created.ok) });
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
    };
  })()`);

  const seedOk =
    seed.hermesReady === "ready" &&
    seed.hermesCreated.every((row) => row.ok) &&
    seed.piReady === "ready" &&
    seed.piCreated.every((row) => row.ok) &&
    seed.piListed.includes(PI_TITLES[0]) &&
    seed.piListed.includes(PI_TITLES[1]) &&
    seed.hermesListed.includes(HERMES_TITLES[0]) &&
    seed.hermesListed.includes(HERMES_TITLES[1]) &&
    seed.backToHermes === "ready";

  // ── Reload so the world boots the way a launch does ──────────────────────
  await reloadDocument();
  await requireGate(
    "Boolean(document.querySelector('.chat-panel'))",
    Boolean,
    "the chat dock",
    60_000,
  );
  await requireGate(
    "(() => { const el = document.getElementById('splash'); return !el || el.hasAttribute('hidden') || getComputedStyle(el).display === 'none'; })()",
    Boolean,
    "the splash to stand down",
    30_000,
  );
  await requireGate(
    `${JSON.stringify(HERMES_TITLES)}.every((title) => [...document.querySelectorAll('.chats-rail__label')].some((el) => el.textContent.trim() === title))`,
    Boolean,
    "the Hermes chat rail",
    30_000,
  );
  const bootPicker = await waitForDockPicker("the default picker after boot");
  const harnessOnBoot = await js(
    "window.lifequest.companionStatus().then((status) => (status ? status.harness : null)).catch(() => null)",
  ).catch(() => null);

  const measured = {
    seedOk,
    bootPicker,
    harnessOnBoot,
    themeKeeps: [],
    switches: [],
  };
  /** Every capture's bytes, so a blank surface is visible as data. */
  const captures = {};

  // ── 1. default-is-one-mark ───────────────────────────────────────────────
  const defaultState = await readPicker();
  const defaultKept = await readKept();
  captures.default = await shot(SHOT.default);
  check(
    "default-is-one-mark",
    defaultState.present === true &&
      defaultState.mode === "one-mark" &&
      defaultState.roster === "menu" &&
      defaultState.labels === "none" &&
      defaultState.ring === "accent" &&
      defaultState.size === "default" &&
      defaultState.markCount === 1 &&
      defaultState.trigger !== null &&
      defaultState.trigger.agent === "hermes" &&
      defaultState.trigger.testid === "agent-picker-trigger" &&
      defaultState.trigger.haspopup === "menu" &&
      defaultState.menuOpen === false &&
      defaultKept === null,
    {
      mode: defaultState.mode,
      roster: defaultState.roster,
      labels: defaultState.labels,
      ring: defaultState.ring,
      size: defaultState.size,
      markCount: defaultState.markCount,
      trigger: defaultState.trigger,
      keptFile: defaultKept,
    },
  );


  // ── 2. menu-lists-the-roster ─────────────────────────────────────────────
  const opened = await js(OPEN_MENU);
  const menuState = await readPicker();
  if (menuState.menuOpen) {
    const menuCrop = cropAround(
      [menuState.composerRect, menuState.pickerRect, menuState.menuRect],
      menuState.viewport,
      22,
    );
    captures.menu = await shot(SHOT.menu, menuCrop);
  }
  const escapeReopen = await js(ESCAPE_THEN_REOPEN);
  const rows = menuState.menuRows;
  const rowsOk =
    rows.length === 2 &&
    rows.every((row) => row.name.length > 0 && row.blurb.length > 0) &&
    rows.some((row) => row.agent === "hermes") &&
    rows.some((row) => row.agent === "pi") &&
    rows.filter((row) => row.checked).length === 1;
  check(
    "menu-lists-the-roster",
    opened.opened === true &&
      menuState.menuOpen === true &&
      menuState.menuRole === "menu" &&
      rowsOk &&
      escapeReopen.wasOpen === true &&
      escapeReopen.escapeClosed === true &&
      escapeReopen.reopened === true &&
      escapeReopen.menuOpen === true,
    {
      opened,
      menuOpen: menuState.menuOpen,
      menuRole: menuState.menuRole,
      rows: rows.map((row) => ({ agent: row.agent, name: row.name, blurb: row.blurb, checked: row.checked })),
      escapeReopen,
    },
  );

  // ── 3. one-choice-is-one-switch (and 4's evidence, same click) ───────────
  const invokesBeforeMenuSwitch = switchInvokes.length;
  const menuSwitch = await js(chooseAgentScript("pi", PI_TITLES));
  const menuSwitchInvokes = switchInvokes.slice(invokesBeforeMenuSwitch);
  measured.switches.push({ roster: "menu", invokes: menuSwitchInvokes, result: menuSwitch });
  const triggersPi = await readPicker();
  check(
    "one-choice-is-one-switch",
    menuSwitch.clicked === true &&
      menuSwitch.timedOut === false &&
      menuSwitch.openedRoster === false &&
      menuSwitch.menuClosedAfterChoice === true &&
      menuSwitchInvokes.length === 1 &&
      menuSwitchInvokes[0].target === "pi" &&
      triggersPi.trigger !== null &&
      triggersPi.trigger.agent === "pi" &&
      menuSwitch.disabledSamples === 0,
    {
      invokes: menuSwitchInvokes,
      totalInvokes: switchInvokes.length,
      switchMs: menuSwitch.switchMs,
      activeAgent: menuSwitch.activeAgent,
      triggerAgent: triggersPi.trigger ? triggersPi.trigger.agent : null,
      disabledSamples: menuSwitch.disabledSamples,
      disabledDetails: menuSwitch.disabledDetails,
      menuClosedAfterChoice: menuSwitch.menuClosedAfterChoice,
    },
  );

  // ── 4. pending-is-visible-and-brief ──────────────────────────────────────
  const pendingSettled = await readPicker();
  check(
    "pending-is-visible-and-brief",
    menuSwitch.pendingSeen === true &&
      pendingSettled.pendingCount === 0 &&
      menuSwitch.pendingAtEnd === 0 &&
      menuSwitch.triggerPendingAtEnd !== true &&
      menuSwitch.triggerBusyAtEnd !== true &&
      menuSwitch.timedOut === false &&
      typeof menuSwitch.switchMs === "number" &&
      menuSwitch.switchMs <= PENDING_CEILING_MS,
    {
      pendingSeen: menuSwitch.pendingSeen,
      pendingSamples: menuSwitch.pendingSamples,
      pendingAtEnd: menuSwitch.pendingAtEnd,
      pickerPendingAfterSettle: pendingSettled.pendingCount,
      switchMs: menuSwitch.switchMs,
      ceilingMs: PENDING_CEILING_MS,
    },
  );

  // Put the world back on Hermes so the named-chip theme has a name to show.
  const backToHermes = await js(chooseAgentScript("hermes", HERMES_TITLES));
  measured.switches.push({ roster: "menu", invokes: switchInvokes.slice(-1), result: backToHermes });

  // ── 5. theme-names-a-mode ────────────────────────────────────────────────
  const namedChipFile = "rig-modes-named-chip.json";
  writeTheme(namedChipFile, {
    name: "rig-modes-named-chip",
    label: "Rig Modes Named Chip",
    description: "A theme that asks the dock's picker to name the answering agent.",
    chrome: { agentPicker: { mode: "named-chip" } },
  });
  const namedChipKeep = await keepThemeThroughTheApp(namedChipFile);
  measured.themeKeeps.push(namedChipKeep);
  await reloadDocument();
  const namedChipPicker = await waitForDockPicker("the named-chip picker after a reload", "named-chip");
  const namedChipKept = await readKept();
  captures.namedChip = await shot(
    SHOT.namedChip,
    cropAround([namedChipPicker.composerRect, namedChipPicker.pickerRect], namedChipPicker.viewport, 16),
  );
  check(
    "theme-names-a-mode",
    namedChipKeep.kept === namedChipFile &&
      namedChipKeep.method !== null &&
      namedChipPicker.mode === "named-chip" &&
      namedChipPicker.roster === "menu" &&
      namedChipPicker.labels === "agent" &&
      namedChipPicker.triggerName === "Hermes" &&
      namedChipKept === namedChipFile,
    {
      keep: namedChipKeep,
      keptFile: namedChipKept,
      mode: namedChipPicker.mode,
      roster: namedChipPicker.roster,
      labels: namedChipPicker.labels,
      triggerName: namedChipPicker.triggerName,
      names: namedChipPicker.names,
    },
  );

  // ── 6. theme-combines-axes ───────────────────────────────────────────────
  const combinedFile = "rig-modes-combined.json";
  writeTheme(combinedFile, {
    name: "rig-modes-combined",
    label: "Rig Modes Combined",
    description: "Every picker axis named at once, as a custom mode.",
    chrome: {
      agentPicker: {
        mode: "custom",
        recipe: { roster: "inline", labels: "all", ring: "hairline", size: "large" },
      },
    },
  });
  const combinedKeep = await keepThemeThroughTheApp(combinedFile);
  measured.themeKeeps.push(combinedKeep);
  const combinedPicker = await waitForDockPicker("the custom-recipe picker", "custom");
  const combinedRows = combinedPicker.options.filter((row) => row.role === "radio");
  const combinedInvokesBefore = switchInvokes.length;
  const inlineSwitch = await js(chooseAgentScript("pi", PI_TITLES));
  const combinedInvokes = switchInvokes.slice(combinedInvokesBefore);
  measured.switches.push({ roster: "inline", invokes: combinedInvokes, result: inlineSwitch });
  const combinedAfter = await readPicker();
  // The recipe's inline roster is a row under the composer box, not in the
  // control row: this is the geometry the mode is shipped with.
  const combinedPlacement = inlinePlacement(combinedAfter);
  check(
    "theme-combines-axes",
    combinedKeep.kept === combinedFile &&
      combinedPlacement.ok === true &&
      combinedPicker.mode === "custom" &&
      combinedPicker.roster === "inline" &&
      combinedPicker.labels === "all" &&
      combinedPicker.ring === "hairline" &&
      combinedPicker.size === "large" &&
      combinedPicker.triggerCount === 0 &&
      combinedPicker.menuOpen === false &&
      combinedPicker.rootRole === "radiogroup" &&
      combinedRows.length === 2 &&
      combinedRows.every((row) => row.name.length > 0) &&
      combinedPicker.markCount === 2 &&
      inlineSwitch.clicked === true &&
      inlineSwitch.timedOut === false &&
      inlineSwitch.openedRoster === false &&
      combinedInvokes.length === 1 &&
      combinedAfter.trigger === null &&
      combinedAfter.options.some((row) => row.agent === "pi" && row.checked === true),
    {
      keep: combinedKeep,
      mode: combinedPicker.mode,
      roster: combinedPicker.roster,
      labels: combinedPicker.labels,
      ring: combinedPicker.ring,
      size: combinedPicker.size,
      triggerCount: combinedPicker.triggerCount,
      rootRole: combinedPicker.rootRole,
      rows: combinedRows.map((row) => ({ agent: row.agent, name: row.name, checked: row.checked })),
      markCount: combinedPicker.markCount,
      switchMs: inlineSwitch.switchMs,
      invokes: combinedInvokes,
      disabledSamples: inlineSwitch.disabledSamples,
      placement: combinedPlacement,
    },
  );

  // ── 7. override-does-not-flatten-the-mode ────────────────────────────────
  // Put named-chip back (the custom theme above outranks the earlier kept file),
  // then layer one Settings pick on top of it.
  const namedChipAgainFile = "rig-modes-named-chip-again.json";
  writeTheme(namedChipAgainFile, {
    name: "rig-modes-named-chip-again",
    label: "Rig Modes Named Chip Again",
    description: "The named-chip mode, kept again for the operator-override leg.",
    chrome: { agentPicker: { mode: "named-chip" } },
  });
  const namedChipAgainKeep = await keepThemeThroughTheApp(namedChipAgainFile);
  measured.themeKeeps.push(namedChipAgainKeep);
  const beforeOverride = await waitForDockPicker("the named-chip picker before the override", "named-chip");
  const settingsOpened = await openSettingsAppearance();

  /**
   * Press one Settings control and wait for the dock to wear the result.
   *
   * One press is the claim; the retry only covers a press that raced the page's
   * first commit after opening (a click dispatched into a tree React is still
   * mounting is dropped on the floor, and that is a rig artifact, not a control
   * that ignores people). The report carries the attempt count either way, so a
   * control that genuinely needs two presses shows up as exactly that.
   */
  /**
   * The two reads that tell "the control is broken" from "the rig clicked into a
   * tree that was still mounting": the operator override the app persisted, and
   * the dock's own resolved axes.
   */
  const readChromeState = () =>
    js(`(() => {
      let raw = null;
      try {
        raw = localStorage.getItem("lifequest-chrome-override");
      } catch {
        raw = "<unreadable>";
      }
      const picker = document.querySelector('[data-testid="agent-picker"]');
      return {
        override: raw,
        dockMode: picker ? picker.getAttribute("data-mode") : null,
        dockSize: picker ? picker.getAttribute("data-size") : null,
      };
    })()`);

  const pressAndWaitFor = async (testId, predicate, label, attempts = 3) => {
    const presses = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await settlePaint();
      const press = await js(
        `(() => {
          const button = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
          if (!button) return { clicked: false, reason: "no button" };
          const box = button.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          const topmost = top === button || (top !== null && button.contains(top));
          const state = { clicked: true, disabled: button.disabled === true, topmost };
          if (button.disabled) return { ...state, clicked: false, reason: "disabled" };
          button.click();
          return state;
        })()`,
      );
      const got = await poll(READ_PICKER, (picker) => picker && picker.present && predicate(picker), 4000, 50);
      const after = await readChromeState();
      presses.push({ attempt, label, press, hit: got.ok, after });
      if (got.ok) return { pressed: press.clicked === true, attempts: attempt, presses, picker: got.value };
    }
    return { pressed: presses.some((entry) => entry.press.clicked === true), attempts, presses, picker: null };
  };

  const sizeLarge = await pressAndWaitFor(
    "settings-agent-picker-size-large",
    (picker) => picker.size === "large",
    "the Settings size override",
  );
  const sizePressed = sizeLarge.pressed;
  const largePicker = await requireGate(
    READ_PICKER,
    (picker) => picker && picker.present && picker.size === "large",
    "the dock picker to take the Settings size override",
    10_000,
  );
  await navigateHome();
  const afterOverride = await readPicker();
  const resetReopened = await openSettingsAppearance();
  const reset = resetReopened
    ? await pressAndWaitFor(
        "chrome-reset",
        (picker) => picker.size === "default",
        "the reset to the theme's size",
      )
    : { pressed: false, attempts: 0, presses: [], picker: null };
  const resetPressed = reset.pressed;
  // Read the settled state rather than throwing on it: if the reset did not
  // take, the artifact should carry why (the press, the persisted override, the
  // dock's axes), not just "timed out".
  const defaultSizedPoll = await poll(
    READ_PICKER,
    (picker) => picker && picker.present && picker.size === "default",
    10_000,
    50,
  );
  const defaultSizedPicker = defaultSizedPoll.value ?? { size: null, mode: null, roster: null };
  const afterResetStorage = await readChromeState();
  await navigateHome();
  const afterReset = await readPicker();
  check(
    "override-does-not-flatten-the-mode",
    settingsOpened === true &&
      sizePressed === true &&
      largePicker.size === "large" &&
      afterOverride.mode === "named-chip" &&
      afterOverride.size === "large" &&
      afterOverride.roster === "menu" &&
      afterOverride.labels === "agent" &&
      resetPressed === true &&
      defaultSizedPicker.size === "default" &&
      // Post-reset: the mode the theme names and the size the theme sets. The
      // agent is deliberately not asserted — it is whichever the earlier legs
      // left answering, and a check about layering must not pin that.
      afterReset.mode === "named-chip" &&
      afterReset.size === "default" &&
      afterReset.roster === "menu",
    {
      settingsOpened,
      resetReopened,
      reset,
      afterResetStorage,
      defaultSizedRestored: defaultSizedPoll.ok,
      sizePressed,
      sizeAttempts: sizeLarge.attempts,
      beforeOverride: { mode: beforeOverride.mode, size: beforeOverride.size },
      whileSettingsOpen: { mode: largePicker.mode, size: largePicker.size },
      afterOverride: { mode: afterOverride.mode, size: afterOverride.size, labels: afterOverride.labels },
      resetPressed,
      afterReset: { mode: afterReset.mode, size: afterReset.size, roster: afterReset.roster },
    },
  );

  // ── 8. studio-writes-the-file ────────────────────────────────────────────
  // The old address first: /extensions must land on /customizations.
  const redirectToHome = await js(
    `(() => { location.hash = "#/extensions"; return window.location.hash; })()`,
  );
  const redirect = await requireGate(
    READ_SURFACE,
    (surface) => surface && surface.customizationsPage === true && surface.hash === "#/customizations",
    "the old /extensions address to redirect to /customizations",
    15_000,
  );

  const studioSeedFile = "rig-picker-studio.json";
  writeTheme(studioSeedFile, {
    name: "rig-picker-studio",
    label: "Rig Picker Studio",
    description: "A blank draft the rig opens in the studio's Components section.",
  });
  const studioRow = await requireGate(
    `Boolean(document.querySelector('[data-testid="customization-rig-picker-studio"] [data-testid="customization-edit"]'))`,
    Boolean,
    "the seeded theme's row on the Customizations page",
    20_000,
  );
  void studioRow;
  const editClicked = await js(
    `(() => { const button = document.querySelector('[data-testid="customization-rig-picker-studio"] [data-testid="customization-edit"]'); if (!button) return false; button.click(); return true; })()`,
  );
  await requireGate(
    `Boolean(document.querySelector('[data-testid="customization-editor"]'))`,
    Boolean,
    "the Customizations editor",
    15_000,
  );
  await js(
    `(() => { const tab = document.querySelector('[data-testid="customization-editor-tab-fields"]'); if (tab && tab.getAttribute("aria-selected") !== "true") tab.click(); return true; })()`,
  );
  await requireGate(
    `Boolean(document.querySelector('[data-testid="customization-studio"]'))`,
    Boolean,
    "the theme studio",
    15_000,
  );
  const componentsTabClicked = await js(
    `(() => { const tab = document.querySelector('[data-testid="studio-section-tab-components"]'); if (!tab) return false; tab.click(); return true; })()`,
  );
  const componentsReady = await requireGate(
    READ_SURFACE,
    (surface) =>
      surface &&
      surface.studioSection === "components" &&
      surface.componentsPanel === true &&
      surface.modeQuietStackSelected !== null,
    "the studio's Components panel",
    15_000,
  );
  // Scroll the studio to the top of its content column so the crop is the
  // section, not a slice of whatever the page happened to be showing.
  await js(`(() => {
    const studio = document.querySelector('[data-testid="customization-studio"]');
    if (!studio) return false;
    const scroller = studio.closest(".shell__content") || studio.closest(".customizations-page");
    if (scroller) {
      const offset = studio.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += offset - 12;
    } else {
      studio.scrollIntoView({ block: "start" });
    }
    return true;
  })()`);
  await sleep(350);
  const quietStackPicked = await js(
    `(() => { const button = document.querySelector('[data-testid="studio-agent-picker-mode-quiet-stack"]'); if (!button) return false; button.click(); return true; })()`,
  );
  const quietStackDraft = await requireGate(
    READ_PICKER,
    (picker) => picker && picker.present && picker.mode === "quiet-stack" && picker.roster === "inline",
    "the dock behind the studio to preview quiet-stack",
    10_000,
  );
  const componentsShotState = await readSurface();
  captures.studio = await shot(
    SHOT.studio,
    cropAround([componentsShotState.studioRect, componentsShotState.componentsRect], componentsShotState.viewport, 14),
  );
  const saveClicked = await js(
    `(() => { const button = document.querySelector('[data-testid="studio-save"]'); if (!button || button.disabled) return false; button.click(); return true; })()`,
  );
  const studioSave = await (async () => {
    const preview = await poll(
      READ_SURFACE,
      (surface) => surface && surface.preview && (surface.previewText ?? "").includes(studioSeedFile),
      THEME_WATCH_MS,
      100,
    );
    let keepClicked = false;
    if (preview.ok) {
      keepClicked = await js(
        `(() => { const button = document.querySelector('[data-testid="theme-keep"]'); if (!button) return false; button.click(); return true; })()`,
      );
    }
    let kept = await readKept();
    for (let i = 0; i < 60 && kept !== studioSeedFile; i += 1) {
      await sleep(100);
      kept = await readKept();
    }
    let method = keepClicked && kept === studioSeedFile ? "studio-save+keep" : null;
    if (kept !== studioSeedFile) {
      const viaState = await js(
        `window.lifequest.themeSetKept(${JSON.stringify(studioSeedFile)}).then((answer) => Boolean(answer && answer.ok)).catch(() => false)`,
      );
      if (viaState) {
        await reloadDocument();
        kept = await readKept();
        method = "themeSetKept+reload";
      }
    }
    return { previewSeen: preview.ok, previewText: preview.value?.previewText ?? null, keepClicked, kept, method };
  })();
  measured.themeKeeps.push({ file: studioSeedFile, ...studioSave });
  await reloadDocument();
  const quietStackPicker = await waitForDockPicker("the quiet-stack picker after a reload", "quiet-stack");
  const quietStackKept = await readKept();
  // The inline pair is a row of the composer form under the box, so the picture
  // has to carry the box itself — "under" is only legible against it.
  const quietStackPlacement = inlinePlacement(quietStackPicker);
  captures.quietStack = await shot(
    SHOT.quietStack,
    cropAround(
      [
        quietStackPicker.composerRect,
        quietStackPicker.composerBoxRect,
        quietStackPicker.pickerRect,
        quietStackPicker.dockRowRect,
      ],
      quietStackPicker.viewport,
      14,
    ),
  );
  check(
    "studio-writes-the-file",
    redirectToHome === "#/extensions" &&
      redirect.customizationsPage === true &&
      redirect.hash === "#/customizations" &&
      editClicked === true &&
      componentsTabClicked === true &&
      componentsReady.studioSection === "components" &&
      quietStackPicked === true &&
      quietStackDraft.mode === "quiet-stack" &&
      saveClicked === true &&
      studioSave.kept === studioSeedFile &&
      studioSave.method !== null &&
      quietStackPicker.mode === "quiet-stack" &&
      quietStackPicker.roster === "inline" &&
      quietStackPicker.labels === "none" &&
      quietStackPicker.ring === "hairline" &&
      quietStackPicker.size === "default" &&
      quietStackPicker.triggerCount === 0 &&
      quietStackPicker.inlineRadios === 2 &&
      quietStackPicker.markCount === 2 &&
      quietStackKept === studioSeedFile &&
      quietStackPlacement.ok === true,
    {
      redirect: { requested: redirectToHome, landed: redirect.hash, page: redirect.customizationsPage },
      editClicked,
      componentsTabClicked,
      studioSection: componentsReady.studioSection,
      componentsPanel: componentsReady.componentsPanel,
      quietStackPicked,
      dockPreview: { mode: quietStackDraft.mode, roster: quietStackDraft.roster },
      saveClicked,
      save: studioSave,
      keptFile: quietStackKept,
      picker: {
        mode: quietStackPicker.mode,
        roster: quietStackPicker.roster,
        labels: quietStackPicker.labels,
        ring: quietStackPicker.ring,
        size: quietStackPicker.size,
        triggerCount: quietStackPicker.triggerCount,
        inlineRadios: quietStackPicker.inlineRadios,
        markCount: quietStackPicker.markCount,
      },
      placement: quietStackPlacement,
    },
  );
  measured.captures = captures;

  // ── 9. refusal-names-the-field ───────────────────────────────────────────
  const surfaceBeforeBad = await readSurface();
  const pickerBeforeBad = await readPicker();
  if (!surfaceBeforeBad.customizationsPage) {
    await js(`(() => { location.hash = "#/customizations"; return window.location.hash; })()`);
    await requireGate(
      READ_SURFACE,
      (surface) => surface && surface.customizationsPage === true,
      "the Customizations page before the refusal",
      15_000,
    );
  }
  const badFile = "rig-modes-refused.json";
  writeTheme(badFile, {
    name: "rig-modes-refused",
    label: "Rig Modes Refused",
    description: "A theme naming a mode that does not exist; the parser must refuse it.",
    chrome: { agentPicker: { mode: "stacked" } },
  });
  const refusal = await poll(
    READ_SURFACE,
    (surface) => surface && typeof surface.themeError === "string" && surface.themeError.includes("chrome.agentPicker.mode"),
    THEME_WATCH_MS,
    100,
  );
  const pickerAfterBad = await readPicker();
  const keptAfterBad = await readKept();
  const badListed = await js(
    `Boolean(document.querySelector('[data-testid="customization-rig-modes-refused"]'))`,
  );
  const badOnDisk = (() => {
    try {
      return JSON.parse(fs.readFileSync(themePath(badFile), "utf8")).chrome.agentPicker.mode;
    } catch {
      return null;
    }
  })();
  check(
    "refusal-names-the-field",
    refusal.ok === true &&
      keptAfterBad === studioSeedFile &&
      keptAfterBad !== badFile &&
      pickerAfterBad.present === true &&
      pickerAfterBad.mode === pickerBeforeBad.mode &&
      pickerAfterBad.roster === pickerBeforeBad.roster &&
      badListed === false &&
      badOnDisk === "stacked",
    {
      error: refusal.value ? refusal.value.themeError : null,
      errorBar: refusal.value ? refusal.value.errorBar : null,
      pageError: refusal.value ? refusal.value.pageError : null,
      keptFile: keptAfterBad,
      pickerBefore: { mode: pickerBeforeBad.mode, roster: pickerBeforeBad.roster },
      pickerAfter: { mode: pickerAfterBad.mode, roster: pickerAfterBad.roster },
      badFileListed: badListed,
      badFileModeOnDisk: badOnDisk,
    },
  );
  // Clear the refusal banner so it does not sit over the next navigation.
  await js(`(() => { const button = document.querySelector('[data-testid="theme-dismiss"]'); if (button) button.click(); return true; })()`);

  // ── 10. the-old-address-redirects ────────────────────────────────────────
  await js(`(() => { location.hash = "#/home"; return window.location.hash; })()`);
  await requireGate(
    `window.location.hash`,
    (hash) => hash === "#/home",
    "the dashboard before the redirect leg",
    15_000,
  );
  const requested = await js(`(() => { location.hash = "#/extensions"; return window.location.hash; })()`);
  // The hash changes on the same tick the route does; the page's own content is
  // painted a commit later. Wait for both, or the check reads a correct URL and
  // a stale screen.
  const landed = await poll(
    READ_SURFACE,
    (surface) => surface && surface.hash === "#/customizations" && surface.customizationsPage === true,
    15_000,
    50,
  );
  check(
    "the-old-address-redirects",
    requested === "#/extensions" &&
      landed.ok === true &&
      landed.value.hash === "#/customizations" &&
      landed.value.customizationsPage === true,
    {
      requested,
      landed: landed.value ? landed.value.hash : null,
      customizationsPage: landed.value ? landed.value.customizationsPage : null,
      pageKeys: landed.value ? { page: landed.value.customizationsPage, rows: landed.value.customizationsRows } : null,
    },
  );

  // ── 11–12. the wide dock: the placement the operator's own column shows ───
  // Everything above ran at the dock's default width. There the CSS container
  // query on the composer band — `@container composer-band (max-width: 34rem)`
  // — steps the menu trigger ABOVE the composer. That is the fallback. The
  // operator drags the dock wider (the width is a gesture, not a persisted
  // setting), and at that width the shipped one-mark trigger stands in the
  // composer's trailing gutter (`right: calc(var(--composer-gutter) / 2 -
  // 0.75rem); bottom: 0; transform: translateX(50%)`) — the placement the
  // design sheet promises and the one the operator will actually see. These
  // checks widen the dock the way the operator does, then photograph and
  // measure that placement. They run strictly after 1–10, whose assertions are
  // untouched.

  /** Draw the wider window the labelled rule's band needs, then wait for it. */
  const resizeWindowForWideDock = async () => {
    const before = await js("({ width: window.innerWidth, height: window.innerHeight })");
    win.setContentSize(WIDE_WINDOW.width, WIDE_WINDOW.height);
    win.setPosition(WIDE_WINDOW.x, WIDE_WINDOW.y);
    const got = await poll(
      "({ width: window.innerWidth, height: window.innerHeight })",
      (size) =>
        Boolean(size) &&
        size.width >= WIDE_WINDOW.width - 40 &&
        size.height >= WIDE_WINDOW.height - 40,
      10_000,
      100,
    );
    return { requested: WIDE_WINDOW, before, after: got.value, ok: got.ok };
  };

  /**
   * Widen the dock with the operator's own gesture.
   *
   * The pointer trail is the real path: pointerdown on the divider, moves on the
   * window (the handler listens there, because a drag leaves the eight-pixel
   * handle immediately), pointerup to commit. The handle's keyboard path — a
   * focusable separator with arrow keys — is the fallback if a synthetic pointer
   * trail cannot move the track in this window, and the report records which one
   * moved it. One track pixel is one composer-band pixel, and the handle's own
   * `aria-valuemax` caps the ask.
   */
  const dragDockToBand = async (targetBand) => {
    const result = await js(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const frames = () =>
        Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);
      const band = () => {
        const footer = document.querySelector(".chat-panel__footer");
        if (!footer) return null;
        const style = getComputedStyle(footer);
        return {
          width: Math.round(
            footer.getBoundingClientRect().width -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight),
          ),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      };
      const divider = () => document.querySelector('[data-testid="chat-divider"]');
      const attempts = [];
      const target = ${Number(targetBand)};
      let method = null;
      const start = band();
      if (start === null) return { ok: false, reason: "no composer band", attempts, band: null, method };
      if (start.width >= target) return { ok: true, attempts, band: start.width, method: "already-wide-enough" };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const el = divider();
        const before = band();
        if (!el || before === null) {
          return { ok: false, reason: el ? "no composer band" : "no divider", attempts, band: before ? before.width : null, method };
        }
        if (before.width >= target) return { ok: true, attempts, band: before.width, method: method || "none" };
        const box = el.getBoundingClientRect();
        const nowWidth = Number(el.getAttribute("aria-valuenow"));
        const maxWidth = Number(el.getAttribute("aria-valuemax"));
        const side = el.getAttribute("data-side") || "right";
        // The handle moves the seam the way it points: a trailing dock grows when
        // the divider is dragged towards the page.
        const outward = side === "left" ? 1 : -1;
        // The composer band is the footer's content width; both move 1:1, so the
        // ask is the band's shortfall in track pixels, capped by the handle.
        const wantedTrack = Math.min(
          Number.isFinite(maxWidth) ? maxWidth : nowWidth + Math.max(0, target - before.width),
          nowWidth + Math.max(0, target - before.width),
        );
        const dx = (wantedTrack - nowWidth) * outward;
        const pointerId = 41;
        const x0 = Math.round(box.left + box.width / 2);
        const y0 = Math.round(box.top + Math.max(1, box.height / 2));
        const fire = (type, targetEl, x, buttons) =>
          targetEl.dispatchEvent(
            new PointerEvent(type, {
              pointerId,
              clientX: x,
              clientY: y0,
              button: type === "pointerdown" ? 0 : -1,
              buttons,
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
        attempts.push({
          attempt,
          method: "pointer",
          side,
          bandBefore: before.width,
          trackBefore: nowWidth,
          trackMax: maxWidth,
          trackWanted: wantedTrack,
          pointerDx: dx,
        });
        fire("pointerdown", el, x0, 1);
        // A drag is a trail, not a jump: the handler commits the last move's
        // width, and the trail is the gesture the code was written for.
        const steps = 4;
        for (let step = 1; step <= steps; step += 1) {
          fire("pointermove", window, Math.round(x0 + (dx * step) / steps), 1);
          await wait(16);
        }
        fire("pointerup", window, Math.round(x0 + dx), 0);
        await frames();
        await wait(160);
        const after = band();
        attempts[attempts.length - 1].bandAfter = after ? after.width : null;
        attempts[attempts.length - 1].trackAfter = Number(el.getAttribute("aria-valuenow"));
        method = "pointer";
        if (after !== null && after.width >= target) return { ok: true, attempts, band: after.width, method };
        if (after !== null && after.width <= before.width) break; // the trail moved nothing
      }
      // The keyboard's half: arrow keys on the focusable separator, 16px a press.
      const el = divider();
      const stalled = band();
      if (!el) return { ok: false, reason: "no divider after the pointer drag", attempts, band: stalled ? stalled.width : null, method };
      const side = el.getAttribute("data-side") || "right";
      const arrow = side === "left" ? "ArrowRight" : "ArrowLeft";
      el.focus();
      let presses = 0;
      while (presses < 90) {
        const before = band();
        if (before === null) break;
        if (before.width >= target) {
          return { ok: true, attempts, band: before.width, method: "keyboard", keyboardPresses: presses };
        }
        el.dispatchEvent(new KeyboardEvent("keydown", { key: arrow, bubbles: true, cancelable: true }));
        presses += 1;
        await frames();
        await wait(20);
      }
      const finalBand = band();
      return {
        ok: finalBand !== null && finalBand.width >= target,
        attempts,
        band: finalBand ? finalBand.width : null,
        method: "keyboard",
        keyboardPresses: presses,
      };
    })()`);
    return result;
  };

  /**
   * The gutter contract as numbers, for one measured picker state.
   *
   * A wide-dock trigger must stand wholly to the RIGHT of the composer box (so it
   * is in the empty gutter, not over the field it writes in), vertically inside
   * the box's band, beginning above the control row's top, clear of the box's 2px
   * accent border, and wholly inside the dock column — the column is the only
   * thing that can clip it.
   */
  const gutterGeometry = (state) => {
    const box = state.composerBoxRect;
    const form = state.composerRect;
    const picker = state.pickerRect;
    const row = state.dockRowRect;
    const column = state.dockRect;
    if (!box || !form || !picker || !row || !column) {
      return { ok: false, reason: "a rect is missing", bandWidth: state.bandWidth ?? null };
    }
    const numbers = {
      bandWidth: state.bandWidth ?? null,
      form,
      composerBox: box,
      dockRow: row,
      dockColumn: column,
      picker,
      /** Empty space between the box's border and the trigger's left edge. */
      clearOfBox: picker.left - box.right,
      /** The whole trailing gutter the form leaves: box's border → dock's edge. */
      gutterSpan: column.right - box.right,
      /** Space from the trigger's right edge to the dock's edge. */
      gutterRightOfPicker: column.right - picker.right,
      insideBandTop: picker.top - box.top,
      insideBandBottom: box.bottom - picker.bottom,
      beginsAboveDockRow: row.top - picker.top,
      rightOfBox: picker.left >= box.right - 1,
      clearOfBorder: picker.left >= box.right,
      withinBand: picker.top >= box.top - 1 && picker.bottom <= box.bottom + 1,
      beginsAboveTheRow: picker.top <= row.top,
      insideDock:
        picker.left >= column.left &&
        picker.right <= column.right &&
        picker.top >= column.top &&
        picker.bottom <= column.bottom,
      fitsGutter: column.right - box.right >= picker.width,
    };
    const ok =
      numbers.rightOfBox &&
      numbers.clearOfBorder &&
      numbers.withinBand &&
      numbers.beginsAboveTheRow &&
      numbers.insideDock &&
      numbers.fitsGutter;
    return { ok, ...numbers };
  };

  /**
   * The wide photographs: the window's trailing side at shipped scale — the real
   * titlebar strip at the top, the transcript's corner above the composer, and
   * the whole composer band and its trailing gutter. Nothing is staged.
   */
  const wideShotCrop = (state) => {
    if (!state || !state.dockRect || !state.viewport) return undefined;
    const left = Math.max(0, state.dockRect.left - 260);
    const width = state.viewport.width - left;
    if (width <= 0) return undefined;
    return {
      x: Math.round(left),
      y: 0,
      width: Math.round(width),
      height: Math.round(state.viewport.height),
    };
  };

  const wideWindow = await resizeWindowForWideDock();
  const wideDock = {
    method: null,
    window: wideWindow,
    thresholds: {
      minBandPx: WIDE_BAND_MIN,
      oneMarkBreakpointPx: ONE_MARK_BREAKPOINT_PX,
      namedChipBreakpointPx: NAMED_CHIP_BREAKPOINT_PX,
    },
    oneMark: null,
    namedChip: { widths: [] },
  };

  // 11's world: the dashboard, and the shipped default (the studio leg left a
  // quiet-stack theme kept, so it is cleared through the app's own state door).
  await js(`(() => { location.hash = "#/home"; return window.location.hash; })()`);
  await requireGate(
    "window.location.hash",
    (hash) => hash === "#/home",
    "the dashboard before the wide dock",
    20_000,
  );
  await js(
    `window.lifequest.themeSetKept(null).then((answer) => Boolean(answer && answer.ok)).catch(() => false)`,
  );
  await reloadDocument();
  await waitForDockPicker("the default picker at a wide dock", "one-mark");
  const oneMarkDrag = await dragDockToBand(WIDE_ONE_MARK_BAND);
  await settlePaint();
  const oneMarkWide = await readPicker();
  const oneMarkGeometry = gutterGeometry(oneMarkWide);
  captures.gutter = await shot(SHOT.gutter, wideShotCrop(oneMarkWide));
  wideDock.method = oneMarkDrag.method;
  wideDock.oneMark = {
    bandWidth: oneMarkWide.bandWidth,
    drag: oneMarkDrag,
    geometry: oneMarkGeometry,
  };
  check(
    "one-mark-stands-in-the-gutter",
    wideWindow.ok === true &&
      oneMarkDrag.ok === true &&
      oneMarkWide.mode === "one-mark" &&
      oneMarkWide.roster === "menu" &&
      oneMarkWide.labels === "none" &&
      oneMarkWide.size === "default" &&
      oneMarkWide.markCount === 1 &&
      oneMarkWide.triggerCount === 1 &&
      (oneMarkWide.bandWidth ?? 0) > ONE_MARK_BREAKPOINT_PX &&
      (oneMarkWide.bandWidth ?? 0) >= WIDE_BAND_MIN &&
      oneMarkGeometry.ok === true,
    {
      window: wideWindow,
      drag: oneMarkDrag,
      bandWidth: oneMarkWide.bandWidth,
      breakpointPx: ONE_MARK_BREAKPOINT_PX,
      placement:
        (oneMarkWide.bandWidth ?? 0) > ONE_MARK_BREAKPOINT_PX
          ? "the trigger is in the trailing gutter"
          : "the fallback above the composer (the container query is still narrow)",
      mode: oneMarkWide.mode,
      roster: oneMarkWide.roster,
      labels: oneMarkWide.labels,
      size: oneMarkWide.size,
      trigger: oneMarkWide.trigger,
      geometry: oneMarkGeometry,
    },
  );

  // 12's world: the named chip, kept through the shipped preview gate. The dock
  // width is not persisted, so the reload puts the column back at its token's
  // width and the drags below are real new gestures.
  const namedChipWideFile = "rig-modes-wide-named-chip.json";
  writeTheme(namedChipWideFile, {
    name: "rig-modes-wide-named-chip",
    label: "Rig Modes Wide Named Chip",
    description: "The labelled chip kept for the wide dock, where the CSS lets it stand in the gutter.",
    chrome: { agentPicker: { mode: "named-chip" } },
  });
  const namedChipWideKeep = await keepThemeThroughTheApp(namedChipWideFile);
  measured.themeKeeps.push(namedChipWideKeep);
  await reloadDocument();
  await waitForDockPicker("the named-chip picker before the wide drag", "named-chip");
  const namedChipDragOne = await dragDockToBand(WIDE_NAMED_CHIP_BAND);
  await settlePaint();
  const namedChipWideOne = await readPicker();
  const namedChipGeometryOne = gutterGeometry(namedChipWideOne);
  captures.namedChipGutter = await shot(SHOT.namedChipGutter, wideShotCrop(namedChipWideOne));
  const namedChipDragTwo = await dragDockToBand(WIDE_NAMED_CHIP_WIDE_BAND);
  await settlePaint();
  const namedChipWideTwo = await readPicker();
  const namedChipGeometryTwo = gutterGeometry(namedChipWideTwo);
  const namedChipWidths = [
    {
      targetBand: WIDE_NAMED_CHIP_BAND,
      bandWidth: namedChipWideOne.bandWidth,
      drag: namedChipDragOne,
      trigger: namedChipWideOne.trigger,
      triggerName: namedChipWideOne.triggerName,
      geometry: namedChipGeometryOne,
    },
    {
      targetBand: WIDE_NAMED_CHIP_WIDE_BAND,
      bandWidth: namedChipWideTwo.bandWidth,
      drag: namedChipDragTwo,
      trigger: namedChipWideTwo.trigger,
      triggerName: namedChipWideTwo.triggerName,
      geometry: namedChipGeometryTwo,
    },
  ];
  wideDock.namedChip = { widths: namedChipWidths };
  const namedTriggerNamed = namedChipWidths.every(
    (entry) => entry.triggerName === "Hermes" || entry.triggerName === "Pi",
  );
  check(
    "named-chip-stands-in-the-gutter",
    namedChipWideKeep.kept === namedChipWideFile &&
      (namedChipWideOne.bandWidth ?? 0) > NAMED_CHIP_BREAKPOINT_PX &&
      (namedChipWideTwo.bandWidth ?? 0) > NAMED_CHIP_BREAKPOINT_PX &&
      namedChipWideOne.mode === "named-chip" &&
      namedChipWideOne.labels === "agent" &&
      namedChipWideOne.triggerCount === 1 &&
      namedChipWideTwo.mode === "named-chip" &&
      namedTriggerNamed &&
      namedChipGeometryOne.ok === true &&
      namedChipGeometryTwo.ok === true,
    {
      kept: namedChipWideKeep,
      breakpointPx: NAMED_CHIP_BREAKPOINT_PX,
      rule: "the 52rem labelled rule: both widths are over the breakpoint and in the gutter",
      widths: namedChipWidths,
      secondBandWider: (namedChipWideTwo.bandWidth ?? 0) > (namedChipWideOne.bandWidth ?? 0),
    },
  );

  // ── The report ───────────────────────────────────────────────────────────
  const consoleErrorsFiltered = consoleErrors.filter((row) => !KNOWN_NOISE.test(row.message));
  const ok = failures.length === 0 && checks.length === 12;
  const report = {
    ranAt: new Date().toISOString(),
    pass: ok,
    failures,
    checks,
    artifacts: {
      default: path.relative(desktopRoot, path.join(artifactsDir, SHOT.default)),
      menu: path.relative(desktopRoot, path.join(artifactsDir, SHOT.menu)),
      namedChip: path.relative(desktopRoot, path.join(artifactsDir, SHOT.namedChip)),
      quietStack: path.relative(desktopRoot, path.join(artifactsDir, SHOT.quietStack)),
      studio: path.relative(desktopRoot, path.join(artifactsDir, SHOT.studio)),
      gutter: path.relative(desktopRoot, path.join(artifactsDir, SHOT.gutter)),
      namedChipGutter: path.relative(desktopRoot, path.join(artifactsDir, SHOT.namedChipGutter)),
    },
    wideDock,
    captures,
    world: {
      world,
      profileDir,
      vaultDir,
      hermesHome,
      themesDir,
      vaultId: created.value.lifequest.id,
      devServerUrl: DEV_URL,
      piEndpoint: piBaseUrl,
      hermesHostPort: hostPort,
      companionProfile: PROBE_PROFILE,
      harnessOnBoot,
      seed,
      checksMeasured: measured,
    },
    consoleErrors: consoleErrorsFiltered,
    consoleErrorsExcluded: consoleErrors.filter((row) => KNOWN_NOISE.test(row.message)),
    renderProcessGone,
    switchInvokes: switchInvokes.map((entry) => ({ at: entry.at, target: entry.target })),
  };
  writeReport(report);

  console.log(`agent picker modes: ${ok ? "PASS" : "FAIL"}`);
  console.log(
    JSON.stringify(
      {
        ok,
        failures,
        checks: checks.map((entry) => ({ label: entry.label, pass: entry.pass })),
        invokes: switchInvokes.map((entry) => entry.target),
        keeps: measured.themeKeeps,
        wideDock: {
          method: wideDock.method,
          window: wideDock.window,
          oneMark: wideDock.oneMark ? { bandWidth: wideDock.oneMark.bandWidth, geometry: wideDock.oneMark.geometry } : null,
          namedChip: wideDock.namedChip.widths.map((entry) => ({ bandWidth: entry.bandWidth, geometry: entry.geometry })),
        },
        switches: measured.switches.map((entry) => ({
          roster: entry.roster,
          invokes: entry.invokes.length,
          switchMs: entry.result.switchMs,
          pendingSeen: entry.result.pendingSeen,
        })),
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
      ranAt: new Date().toISOString(),
      pass: false,
      failures: ["the rig hit its watchdog before finishing"],
      checks,
      artifacts: {},
      world: null,
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
        ranAt: new Date().toISOString(),
        pass: false,
        failures: [
          `the rig crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        ],
        checks,
        artifacts: {},
        world: null,
      });
    } catch {
      // The exit below is what matters.
    }
    console.error("agent-picker-modes rig failed:", error);
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
