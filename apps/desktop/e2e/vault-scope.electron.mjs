/**
 * The vault-scope rig: do a vault's chats and agents belong to it?
 *
 * Why this exists. The operator reported that after switching to a new vault the
 * other vault's agent chats were still in the app, and that a new vault came up
 * on the previous vault's Hermes profile — the same memory, skills and knowledge.
 * Two things followed the app instead of the vault: the chat stores (Pi's flat
 * `pi-sessions/*.json`, one Hermes profile for the whole app) and the agent
 * choice (the app-level `harness`/`companionProfile` prefs).
 *
 * Desired behaviour, and what this rig proves end to end against the shipped
 * renderer and main process:
 *
 *   1. Adoption. An existing install's flat Pi transcript and (when it was on
 *      Hermes) its profile move into the vault that is open at the upgrade —
 *      once. Every other vault starts clean. A Pi install records NO Hermes
 *      profile: reusing one later is explicit, never a silent migration.
 *   2. Grouping. A chat made in vault Alpha does not appear in vault Beta. The
 *      switch goes through the operator's own path — the rail-foot vault chip's
 *      "Switch vault" dialog, which drives `openRecent` and so the real
 *      `VaultProvider` snapshot change and the renderer's vault-epoch reset.
 *      Beta's rail is empty, its tab strip is empty, and its switcher draws Pi
 *      only.
 *   3. Fresh agent. Settings adds a Hermes agent to Beta: the Hermes pill
 *      appears, the binding names the new profile, a Beta Hermes chat can be
 *      made, and a reload keeps it. Alpha sees none of it.
 *   4. Return. Switching back restores each vault's own chats, tab strip and
 *      agent; neither vault's titles leak into the other.
 *   5. Reuse is explicit. Alpha (Pi only) adds Beta's Hermes profile through
 *      "Use an existing agent…". The warning names Beta and says memory, skills
 *      and knowledge are shared; only after that does Alpha draw Hermes.
 *
 * The world is hermetic and throwaway, modelled on `agent-switch.electron.mjs`:
 *   - a throwaway Electron profile (`LIFEQUEST_E2E.userData`) and two real
 *     vaults made with the real `createVault`, so no operator vault is touched;
 *   - a throwaway HERMES_HOME with a `hermes` stub first on PATH (the gateway
 *     subcommand exits 1, so nothing real is ever started);
 *   - a fake Hermes host gateway on loopback that serves a SEPARATE session
 *     store per `/p/<profile>` prefix, so "one profile per vault" is a fact the
 *     rig can read back, not an assumption;
 *   - a fake OpenAI-compatible endpoint (`/v1/models`, streaming
 *     `/v1/chat/completions`) for the built-in companion, pre-configured in
 *     `pi-endpoint.json` before boot so the app comes up on Pi;
 *   - a pre-seeded flat legacy Pi transcript and legacy prefs (recent Alpha +
 *     Beta with Alpha newest, `harness: "pi"`, a `companionProfile` probe value
 *     that must NOT be adopted, no `vaultAgents`).
 *
 * Artifacts:
 *   e2e/artifacts/vault-scope.json                the report
 *   e2e/artifacts/vault-scope-a.png               Alpha after adoption, its chat
 *   e2e/artifacts/vault-scope-b-clean.png         Beta, empty rail, Pi only
 *   e2e/artifacts/vault-scope-b-hermes.png        Beta after the fresh agent
 *   e2e/artifacts/vault-scope-a-return.png        back on Alpha, its own chats
 *   e2e/artifacts/vault-scope-reuse-warning.png   the reuse warning naming Beta
 *
 * Run by `tests/vault-scope-e2e.test.ts`, through the shared bench wrapper:
 *   /root/.local/bin/lifequest-e2e <checkout> tests/vault-scope-e2e.test.ts
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
const REPORT = path.join(artifactsDir, "vault-scope.json");

/** The endpoint model the built-in companion is pointed at. */
const MODEL = "rig-model";
/** A profile name no real install has. It exists only in the legacy prefs. */
const PROBE_PROFILE = "lq-vault-scope-probe";
/** The profile the bridge fallback asks the fresh add to use. */
const FRESH_FALLBACK_PROFILE = "lq-vaultscope-b";
const DEV_SERVER_URL = "http://127.0.0.1:5173";

const ALPHA_NAME = "Alpha Vault";
const BETA_NAME = "Beta Vault";
const LEGACY_PI_ID = "legacyflat01";
const LEGACY_PI_TITLE = "Legacy flat chat";
const ALPHA_CHAT_TITLE = "Alpha own chat";
const BETA_CHAT_TITLE = "Beta Hermes chat";

/** Driver watchdog: never leave the wrapper with a hung Electron process. */
const DRIVER_WATCHDOG_MS = 280_000;
/** How long a vault switch is given to settle in the page. */
const SWITCH_WAIT_MS = 60_000;

/** The Settings → Hermes selectors this rig drives (SettingsVaultAgents). */
const UI = {
  section: '[data-testid="vault-agents"]',
  createFresh: '[data-testid="vault-agent-create"]',
  useExisting: '[data-testid="vault-agent-reuse"]',
  useHermes: '[data-testid="vault-agent-use-hermes"]',
  hermesProfile: '[data-testid="vault-agent-hermes-profile"]',
  hermesEmpty: '[data-testid="vault-agent-hermes-empty"]',
  notice: '[data-testid="vault-agent-notice"]',
  sharedWarning: '[data-testid="vault-agent-shared-warning"]',
  existingList: '[data-testid="vault-agent-existing-list"]',
  existingRow: '[data-testid="vault-agent-existing"]',
  existingWarning: '[data-testid="vault-agent-existing-warning"]',
  closeSettings: '[aria-label="Close settings"]',
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

function writeReport(report) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// ---------------------------------------------------------------------------
// The IPC seams this rig counts
// ---------------------------------------------------------------------------

/**
 * Every `vault:open` invoke, counted at the IPC seam.
 *
 * The switch is a UI gesture (the rail-foot chip's dialog), but the thing that
 * makes it real is exactly one `vault:open` for the target folder. Counting here
 * means "the rig clicked a row that opened the vault it claims" is measured at
 * the boundary the app crosses, not inferred from a label.
 */
const vaultOpens = [];
/** Every `vaultAgents:addHermes` invoke: which path (UI or bridge) added the agent. */
const addHermesInvokes = [];
/**
 * Every `companion:switchHarness` invoke, with the vault the main process had
 * open at that instant. A vault switch applies its binding in main and pushes
 * it; a *renderer* switch during a switch window would persist the wrong vault's
 * harness, so this log is the evidence that separates the two.
 */
const switchHarnessInvokes = [];
/** The vault id the last successful `vault:open` put in main's scope. */
let lastOpenedVaultId = null;
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function (channel, listener) {
  return originalHandle(channel, async (event, ...args) => {
    if (channel === "vault:open") vaultOpens.push({ at: Date.now(), path: args[0] ?? null });
    if (channel === "vaultAgents:addHermes") addHermesInvokes.push({ at: Date.now(), input: args[0] ?? null });
    if (channel === "companion:switchHarness") {
      switchHarnessInvokes.push({
        at: Date.now(),
        target: args[0] ?? null,
        // The scope at the instant of the call: a renderer switch during a
        // vault-switch window persists to THIS vault's binding.
        vaultId: lastOpenedVaultId,
      });
    }
    const result = await listener(event, ...args);
    if (channel === "vault:open" && result && result.ok && result.value?.lifequest?.id) {
      lastOpenedVaultId = result.value.lifequest.id;
    }
    return result;
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
// The fake Hermes host gateway, one session store per profile
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
 * A host gateway that serves a SEPARATE session store per profile.
 *
 * The app's real `hermesFetch` calls live in `electron/companion.ts` and are
 * made against the attached profile's base URL: the default profile at the bare
 * base, every other profile at `/p/<name>`. This rig's profiles are never
 * "default", so the first path segment is the profile and the rest is the API.
 * Serving one store for all profiles would make "the vault's own chats" a claim
 * the rig cannot check; serving one store per profile makes the leak visible
 * from the host side as well as from the rail.
 *
 * The store map is returned to the rig so it can assert, for example, that the
 * probe profile was never even attached to.
 */
async function startFakeHermesHost() {
  /** @type {Map<string, { sessions: Array<Record<string, unknown>>, nextId: number }>} */
  const stores = new Map();
  const storeFor = (profile) => {
    let store = stores.get(profile);
    if (!store) {
      store = { sessions: [], nextId: 1 };
      stores.set(profile, store);
    }
    return store;
  };
  const nowSec = () => Math.floor(Date.now() / 1000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const profileMatch = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
    const profile = profileMatch ? decodeURIComponent(profileMatch[1]) : "default";
    const rest = profileMatch ? profileMatch[2] ?? "/" : pathname;
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

    const messagesMatch = /\/api\/sessions\/([^/]+)\/messages$/.exec(rest);
    if (messagesMatch && req.method === "GET") {
      json({ messages: [] });
      return;
    }

    if (/\/api\/sessions$/.test(rest)) {
      const store = storeFor(profile);
      if (req.method === "GET") {
        json({
          sessions: store.sessions.map((row, index) => ({
            ...row,
            last_active: nowSec() - index,
          })),
        });
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
          id: `hermes-session-${store.nextId}`,
          title: title || "New chat",
          preview: "",
          pinned: false,
          archived: false,
          hidden: false,
          runtime_revision: 1,
        };
        store.nextId += 1;
        store.sessions.unshift(row);
        json({ session: { ...row, last_active: nowSec() } });
        return;
      }
    }

    const patchMatch = /\/api\/sessions\/([^/]+)$/.exec(rest);
    if (patchMatch && req.method === "PATCH") {
      const body = await readBody(req);
      const store = storeFor(profile);
      const row = store.sessions.find((entry) => entry.id === patchMatch[1]);
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

  const port = await listen(server);
  return { port, stores };
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

/** Everything the report calls a "state": rail, tabs, pills, gates, chrome. */
const READ_STATE = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const railRows = [...document.querySelectorAll(".chats-rail__rows .chats-rail__row")].map((li) => ({
    label: text(li.querySelector(".chats-rail__label")),
    active: li.getAttribute("data-active") === "true",
  }));
  const tabs = [...document.querySelectorAll(".chat-panel__tab")].map((tab) => ({
    label: text(tab.querySelector(".chat-panel__tab-label")),
    active: tab.classList.contains("chat-panel__tab--active"),
  }));
  const pills = [...document.querySelectorAll(".agent-switcher__pill")].map((el) => ({
    name: el.getAttribute("aria-label"),
    active: el.getAttribute("aria-checked") === "true",
    disabled: el.disabled === true,
    pending: el.classList.contains("agent-switcher__pill--pending"),
    busy: el.getAttribute("aria-busy") === "true",
  }));
  const railEmpty = document.querySelector(".chats-rail__list .chats-rail__empty");
  const railError = document.querySelector(".chats-rail__error");
  const splash = document.getElementById("splash");
  return {
    railTitles: railRows.map((row) => row.label),
    railActive: (railRows.find((row) => row.active) || {}).label || null,
    railEmptyText: railEmpty ? text(railEmpty) : null,
    railErrorText: railError ? text(railError) : null,
    railListPresent: Boolean(document.querySelector(".chats-rail__list")),
    tabLabels: tabs.map((tab) => tab.label),
    activeTabLabel: (tabs.find((tab) => tab.active) || {}).label || null,
    tabCount: tabs.length,
    pills,
    pillNames: pills.map((pill) => pill.name),
    activePill: (pills.find((pill) => pill.active) || {}).name || null,
    dashboard: Boolean(document.querySelector(".home-dashboard")),
    chatPanel: Boolean(document.querySelector(".chat-panel")),
    welcomeCard: Boolean(document.querySelector(".welcome-card")),
    vaultChipName: text(document.querySelector(".nav-rail__vault-name")) || null,
    switchDialogOpen: Boolean(document.querySelector(".vault-switcher")),
    settingsOpen: Boolean(document.querySelector(".settings-overlay__layout")),
    hash: window.location.hash,
    splashHidden: !splash || splash.hasAttribute("hidden") || getComputedStyle(splash).display === "none",
  };
})()`;

/**
 * Switch vaults the way the operator does: click the rail-foot vault chip, then
 * the "Switch vault" dialog row for the target. That path drives
 * `VaultProvider.openRecent`, which is what actually changes the renderer's
 * snapshot and triggers the vault-epoch reset under test — a bare
 * `window.lifequest.vaultOpen` would only move the main process.
 */
function switchVaultScript(label, vaultPath) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const chipName = () => {
      const el = document.querySelector(".nav-rail__vault-name");
      return el ? (el.textContent || "").trim() : null;
    };
    const chip = document.querySelector(".nav-rail__vault");
    if (!chip) return { ok: false, reason: "no vault chip in the rail" };
    const before = chipName();
    if (before === ${JSON.stringify(label)}) {
      return { ok: true, already: true, before, after: before, dialogOpened: false, dialogClosed: false };
    }
    chip.click();
    const deadline = performance.now() + 15000;
    let dialog = null;
    while (performance.now() < deadline) {
      dialog = document.querySelector(".vault-switcher");
      if (dialog) break;
      await sleep(20);
    }
    if (!dialog) return { ok: false, reason: "the Switch vault dialog never opened", before };
    const rows = [...dialog.querySelectorAll(".vault-switcher__row")];
    const row = rows.find((el) => el.getAttribute("data-vault-path") === ${JSON.stringify(vaultPath)});
    if (!row) {
      return {
        ok: false,
        reason: "the dialog has no row for the target vault",
        before,
        paths: rows.map((el) => el.getAttribute("data-vault-path")),
      };
    }
    if (row.disabled === true) return { ok: false, reason: "the target row is disabled", before };
    row.click();
    const deadline2 = performance.now() + ${SWITCH_WAIT_MS};
    while (performance.now() < deadline2) {
      const name = chipName();
      const stillOpen = Boolean(document.querySelector(".vault-switcher"));
      if (!stillOpen && name === ${JSON.stringify(label)}) {
        return {
          ok: true,
          already: false,
          before,
          after: name,
          dialogOpened: true,
          dialogClosed: true,
          rowClicked: true,
        };
      }
      await sleep(25);
    }
    return {
      ok: false,
      reason: "the switch never settled",
      before,
      after: chipName(),
      dialogOpen: Boolean(document.querySelector(".vault-switcher")),
      hash: window.location.hash,
    };
  })()`;
}

/**
 * Create a chat through the dock's own New chat control, then give it a title
 * through the row's own Rename action. The app's chat, the app's rename — the
 * rig only operates the controls an operator would.
 */
function createChatAndRenameScript(title) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const labels = () => [...document.querySelectorAll(".chats-rail__label")].map(text);
    const rows = () => [...document.querySelectorAll(".chats-rail__row")];
    const before = labels();
    const button =
      document.querySelector(".chats-rail__new") ||
      document.querySelector('.chat-panel__actions [aria-label="New chat"]');
    if (!button) return { ok: false, reason: "no New chat control", before };
    button.click();
    const deadline = performance.now() + 25000;
    let row = null;
    while (performance.now() < deadline) {
      const current = rows();
      if (current.length > before.length) {
        row =
          current.find((li) => !before.includes(text(li.querySelector(".chats-rail__label")))) ||
          current[current.length - 1];
        if (row) break;
      }
      await sleep(25);
    }
    if (!row) return { ok: false, reason: "no chat row appeared", before, after: labels() };
    const menuButton = row.querySelector(".chats-rail__menu-btn");
    if (!menuButton) return { ok: false, reason: "no row menu button", before, after: labels() };
    menuButton.click();
    await sleep(100);
    const renameItem = [...row.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.getAttribute("aria-label") === "Rename chat",
    );
    if (!renameItem) {
      return {
        ok: false,
        reason: "no Rename chat menu item",
        items: [...row.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute("aria-label")),
      };
    }
    renameItem.click();
    await sleep(100);
    const input = document.querySelector(".chats-rail__rename-input");
    if (!input) return { ok: false, reason: "no rename input" };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(50);
    const save = document.querySelector('[aria-label="Save chat name"]');
    if (save) save.click();
    else if (input.form) input.form.requestSubmit();
    const deadline2 = performance.now() + 15000;
    while (performance.now() < deadline2) {
      if (labels().includes(${JSON.stringify(title)})) {
        return { ok: true, title: ${JSON.stringify(title)}, before, after: labels() };
      }
      await sleep(25);
    }
    return { ok: false, reason: "the rename never landed", before, after: labels() };
  })()`;
}

/**
 * Open Settings → Hermes, where "Agents in this vault" lives. The tab is the
 * shipped route (`/settings?tab=hermes`); the rig navigates to it the same way a
 * link does.
 */
const OPEN_SETTINGS_AGENTS = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.location.hash = "#/settings?tab=hermes";
  const deadline = performance.now() + 20000;
  let last = null;
  while (performance.now() < deadline) {
    const overlay = document.querySelector(".settings-overlay__layout");
    const section = document.querySelector(${JSON.stringify(UI.section)});
    const buttons = [...document.querySelectorAll(".settings-overlay__layout button")];
    const piAction = buttons.find((el) => /^use pi$/i.test((el.textContent || "").trim()));
    const heading = [...document.querySelectorAll(".settings-overlay__layout h2, .settings-overlay__layout h3")].some(
      (el) => /agents in this vault/i.test(el.textContent || ""),
    );
    // The section paints its heading before the async vault-agents read lands;
    // the buttons only exist once the card is loaded. Wait for the card, not
    // for the heading, or the add step runs against an empty section.
    const cardReady = Boolean(
      document.querySelector(
        '[data-testid="vault-agent-create"], [data-testid="vault-agent-reuse"], [data-testid="vault-agent-use-hermes"], [data-testid="vault-agent-hermes-bound"], [data-testid="vault-agent-remove-hermes"]',
      ),
    );
    last = {
      overlay: Boolean(overlay),
      section: Boolean(section),
      heading,
      piAction: Boolean(piAction),
      cardReady,
      hash: window.location.hash,
    };
    if (overlay && section && cardReady) return { ok: true, ...last };
    await sleep(50);
  }
  return { ok: false, reason: "the Agents in this vault card did not load", last };
})()`;

/** Click the Settings control that creates a fresh agent for the open vault. */
const ADD_FRESH_AGENT = `(async () => {
  const scope =
    document.querySelector(${JSON.stringify(UI.section)}) ||
    document.querySelector(".settings-overlay__layout") ||
    document.body;
  const buttons = [...scope.querySelectorAll("button")];
  const byTestId = scope.querySelector(${JSON.stringify(UI.createFresh)});
  const button =
    byTestId || buttons.find((el) => /create a new agent/i.test(el.textContent || ""));
  if (!button) {
    return {
      ok: false,
      reason: "no create-a-new-agent control",
      buttons: buttons.map((el) => (el.textContent || "").trim()).filter(Boolean).slice(0, 40),
    };
  }
  button.click();
  return {
    ok: true,
    label: (button.textContent || "").trim(),
    testid: button.getAttribute("data-testid"),
  };
})()`;

/**
 * Open the "Use an existing agent…" chooser and wait for the installed profile
 * to appear. Returns the warning copy the chooser shows, so the report can prove
 * the vaults it names before anything is bound.
 */
function openExistingChooserScript(profileName, betaName) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const scope = () =>
      document.querySelector(${JSON.stringify(UI.section)}) ||
      document.querySelector(".settings-overlay__layout") ||
      document.body;
    const buttons = () => [...scope().querySelectorAll("button")];
    const byTestId = scope().querySelector(${JSON.stringify(UI.useExisting)});
    const opener = byTestId || buttons().find((el) => /use an existing agent/i.test(el.textContent || ""));
    if (!opener) {
      return {
        ok: false,
        reason: "no Use an existing agent control",
        buttons: buttons().map((el) => (el.textContent || "").trim()).filter(Boolean).slice(0, 40),
      };
    }
    opener.click();
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      const list = scope().querySelector(${JSON.stringify(UI.existingList)});
      const row =
        list?.querySelector('[data-profile="' + ${JSON.stringify(profileName)} + '"]') ||
        [...scope().querySelectorAll('button, [role="option"], [role="radio"], [role="listitem"]')].find(
          (el) => el !== opener && (el.textContent || "").includes(${JSON.stringify(profileName)}),
        );
      if (row) {
        const warningEl = row.querySelector(${JSON.stringify(UI.existingWarning)});
        const warningText = warningEl ? (warningEl.textContent || "").trim() : "";
        const texts = [...scope().querySelectorAll('p, div, span, [role="alert"], [role="status"]')]
          .map((el) => (el.textContent || "").trim())
          .filter((entry) => entry.length > 20 && entry.includes(${JSON.stringify(betaName)}));
        texts.sort((a, b) => b.length - a.length);
        const effective = warningText || texts[0] || "";
        return {
          ok: true,
          rowTag: row.tagName,
          rowLabel: (row.textContent || "").trim().slice(0, 500),
          warningText: effective,
          mentionsBeta: effective.includes(${JSON.stringify(betaName)}),
          mentionsShared: /memory|skills|knowledge/i.test(effective),
          warningCandidates: texts.slice(0, 6),
        };
      }
      await sleep(50);
    }
    return {
      ok: false,
      reason: "the installed profile never appeared in the chooser",
      text: (scope().textContent || "").slice(0, 2500),
    };
  })()`;
}

/**
 * Wait until the reuse chooser is on screen, not merely in the DOM.
 *
 * The Settings sheet animates in over the studio; a capture taken as soon as the
 * chooser's row exists can land on a frame that is still the dashboard. This
 * waits for the sheet, the chooser list and the per-row shared-memory warning to
 * be present and painted (two animation frames + a beat), and returns the
 * warning's text so the report carries what the picture shows.
 */
const WAIT_REUSE_WARNING_VISIBLE = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const sheet = document.querySelector(".settings-overlay__layout");
    const list = document.querySelector('[data-testid="vault-agent-existing-list"]');
    const warning = document.querySelector('[data-testid="vault-agent-existing-warning"]');
    if (sheet && list && warning) {
      const style = getComputedStyle(list);
      const box = list.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0.01 &&
        box.width > 0 &&
        box.height > 0;
      if (visible) {
        // The chooser sits below the agent card; scroll its warning row into
        // the sheet's viewport before the picture, or the shot shows the card
        // above it and not the line the artifact is named for.
        warning.scrollIntoView({ block: "center", inline: "nearest" });
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        await sleep(300);
        const rect = warning.getBoundingClientRect();
        const inViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.left >= 0 &&
          rect.right <= window.innerWidth;
        return {
          ok: true,
          warningText: (warning.textContent || "").trim(),
          box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          inViewport,
          sheetVisible: Boolean(document.querySelector(".settings-overlay__layout")),
        };
      }
    }
    await sleep(50);
  }
  return { ok: false, reason: "the reuse warning never became visible" };
})()`;

/** Pick the profile row in the open chooser; report any confirmation step. */
function pickExistingProfileScript(profileName) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const scope = () =>
      document.querySelector(${JSON.stringify(UI.section)}) ||
      document.querySelector(".settings-overlay__layout") ||
      document.body;
    const list = scope().querySelector(${JSON.stringify(UI.existingList)});
    const rows = [...scope().querySelectorAll('button, [role="option"], [role="radio"], [role="listitem"]')];
    const row =
      list?.querySelector('[data-profile="' + ${JSON.stringify(profileName)} + '"]') ||
      rows.find((el) => (el.textContent || "").includes(${JSON.stringify(profileName)}));
    if (!row) {
      return {
        ok: false,
        reason: "no profile row to pick",
        rows: rows.map((el) => (el.textContent || "").trim().slice(0, 120)).slice(0, 30),
      };
    }
    row.click();
    await sleep(600);
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) {
      return { ok: true, rowLabel: (row.textContent || "").trim().slice(0, 500), confirmClicked: false, confirmLabel: null, dialogText: "" };
    }
    const confirm = [...dialog.querySelectorAll("button")].find((el) =>
      /use this agent|reuse|share|confirm|add/i.test((el.textContent || "").trim()),
    );
    return {
      ok: true,
      rowLabel: (row.textContent || "").trim().slice(0, 500),
      confirmClicked: Boolean(confirm),
      confirmLabel: confirm ? (confirm.textContent || "").trim() : null,
      dialogText: (dialog.textContent || "").trim().slice(0, 1200),
    };
  })()`;
}

/** Click the confirm control of an open reuse dialog. */
const CONFIRM_REUSE_DIALOG = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { ok: false, reason: "no dialog open" };
  const confirm = [...dialog.querySelectorAll("button")].find((el) =>
    /use this agent|reuse|share|confirm|add/i.test((el.textContent || "").trim()),
  );
  if (!confirm) {
    return {
      ok: false,
      reason: "no confirm control in the dialog",
      buttons: [...dialog.querySelectorAll("button")].map((el) => (el.textContent || "").trim()).slice(0, 20),
    };
  }
  const label = (confirm.textContent || "").trim();
  confirm.click();
  return { ok: true, label };
})()`;

/** Close the Settings sheet through its own cross. */
const CLOSE_SETTINGS = `(() => {
  const close = document.querySelector(${JSON.stringify(UI.closeSettings)});
  if (!close) return { ok: false, reason: "no Close settings control" };
  close.click();
  return { ok: true };
})()`;

/**
 * What the "Agents in this vault" card says right now: the bound profile, the
 * notice the add/reuse wrote, and any shared-memory warning on the card.
 */
const READ_SETTINGS_AGENTS = `(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const section = document.querySelector(${JSON.stringify(UI.section)});
  if (!section) return { present: false };
  const profile = section.querySelector(${JSON.stringify(UI.hermesProfile)});
  const empty = section.querySelector(${JSON.stringify(UI.hermesEmpty)});
  const notice = section.querySelector(${JSON.stringify(UI.notice)});
  const warning = section.querySelector(${JSON.stringify(UI.sharedWarning)});
  const useHermes = section.querySelector(${JSON.stringify(UI.useHermes)});
  const bound = section.querySelector('[data-testid="vault-agent-hermes"][data-bound="true"]');
  return {
    present: true,
    boundProfileText: profile ? text(profile) : null,
    emptyText: empty ? text(empty) : null,
    notice: notice ? text(notice) : null,
    sharedWarning: warning ? text(warning) : null,
    useHermesOffered: Boolean(useHermes),
    bound: Boolean(bound),
    text: text(section).slice(0, 2500),
  };
})()`;

/** Click Settings' own "Use Hermes" action for this vault. */
const CLICK_USE_HERMES_SETTINGS = `(() => {
  const section = document.querySelector(${JSON.stringify(UI.section)}) || document;
  const button =
    section.querySelector(${JSON.stringify(UI.useHermes)}) ||
    [...section.querySelectorAll("button")].find((el) => /^use hermes$/i.test((el.textContent || "").trim()));
  if (!button) return { ok: false, reason: "no Use Hermes control in the vault agent card" };
  button.click();
  return { ok: true, label: (button.textContent || "").trim() };
})()`;

/** Click the dock's Hermes pill. */
const CLICK_HERMES_PILL = `(() => {
  const pill = document.querySelector('.agent-switcher__pill[aria-label="Hermes"]');
  if (!pill) return { ok: false, reason: "no Hermes pill in the dock" };
  if (pill.getAttribute("aria-checked") === "true") return { ok: true, alreadyActive: true };
  pill.click();
  return { ok: true, alreadyActive: false };
})()`;

/** Per-vault, per-agent tab memory, as the app stored it. */
function readStorageScript(alphaId, betaId) {
  return `(() => {
    const slot = (key) => window.localStorage.getItem(key);
    const alpha = ${JSON.stringify(alphaId)};
    const beta = ${JSON.stringify(betaId)};
    return {
      alphaPi: slot("lifequest.companion.openTabs." + alpha + ".pi"),
      alphaHermes: slot("lifequest.companion.openTabs." + alpha + ".hermes"),
      alphaLast: slot("lifequest.companion.lastSessionId." + alpha),
      betaPi: slot("lifequest.companion.openTabs." + beta + ".pi"),
      betaHermes: slot("lifequest.companion.openTabs." + beta + ".hermes"),
      betaLast: slot("lifequest.companion.lastSessionId." + beta),
      legacyOpenTabs: slot("lifequest.companion.openTabs"),
      legacyPi: slot("lifequest.companion.openTabs.pi"),
      legacyLast: slot("lifequest.companion.lastSessionId"),
    };
  })()`;
}

/** The vault-agent state as the renderer's own bridge reports it. */
const READ_AGENTS_STATE = `(async () => {
  const bridge = window.lifequest;
  if (!bridge || typeof bridge.vaultAgentsGet !== "function") {
    return { available: false };
  }
  try {
    const state = await bridge.vaultAgentsGet();
    return { available: true, state };
  } catch (error) {
    return { available: true, error: String(error && error.message ? error.message : error) };
  }
})()`;

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function sessionTitlesIn(dir) {
  return listJson(dir).map((name) => {
    const parsed = readJson(path.join(dir, name));
    return parsed && typeof parsed.title === "string" ? parsed.title : name;
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // ── The world ────────────────────────────────────────────────────────────
  const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-vault-scope-"));
  const profileDir = path.join(world, "profile");
  const alphaDir = path.join(world, "alpha-vault");
  const betaDir = path.join(world, "beta-vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const callLog = path.join(world, "hermes-calls.log");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  fs.mkdirSync(alphaDir, { recursive: true });
  fs.mkdirSync(betaDir, { recursive: true });
  writeHermesStub(binDir, callLog);

  const createdAlpha = await createVault(alphaDir, ALPHA_NAME);
  if (!createdAlpha.ok) throw new Error(`createVault(Alpha) failed: ${createdAlpha.error}`);
  const createdBeta = await createVault(betaDir, BETA_NAME);
  if (!createdBeta.ok) throw new Error(`createVault(Beta) failed: ${createdBeta.error}`);
  const alphaId = createdAlpha.value.lifequest.id;
  const betaId = createdBeta.value.lifequest.id;

  // The pre-vault world: one flat Pi transcript and legacy app-level prefs. The
  // `companionProfile` value is a probe: the effective harness is Pi, so the
  // adoption must record NO Hermes profile even though the old pref names one.
  const flatSessionsDir = path.join(profileDir, "pi-sessions");
  fs.mkdirSync(flatSessionsDir, { recursive: true });
  const nowMs = Date.now();
  fs.writeFileSync(
    path.join(flatSessionsDir, `${LEGACY_PI_ID}.json`),
    `${JSON.stringify(
      {
        id: LEGACY_PI_ID,
        title: LEGACY_PI_TITLE,
        preview: "the chat this install already had",
        createdAt: nowMs - 86_400_000,
        lastActive: nowMs - 60_000,
        pinned: false,
        archived: false,
        messages: [
          { role: "user", content: "Keep this chat: it is the pre-vault one." },
          { role: "assistant", content: "Kept." },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const legacyPrefs = {
    recent: [
      {
        id: alphaId,
        name: ALPHA_NAME,
        path: alphaDir,
        lastOpenedAt: new Date(nowMs).toISOString(),
      },
      {
        id: betaId,
        name: BETA_NAME,
        path: betaDir,
        lastOpenedAt: new Date(nowMs - 3_600_000).toISOString(),
      },
    ],
    activeDomainByVaultId: {},
    deadlineDismissedOnByVaultId: {},
    deadlineNotifiedOnByVaultId: {},
    companionProfile: PROBE_PROFILE,
    harness: "pi",
  };
  fs.writeFileSync(path.join(profileDir, "recent.json"), `${JSON.stringify(legacyPrefs, null, 2)}\n`);

  // ── The servers, before the main process reads its environment ───────────
  const piPort = await startFakePiEndpoint();
  const hermesHost = await startFakeHermesHost();
  const hostPort = hermesHost.port;
  // The Pi endpoint is pre-configured, so the app boots on Pi instead of the
  // companion setup screen. Loopback needs no key.
  const piBaseUrl = `http://127.0.0.1:${piPort}/v1`;
  fs.writeFileSync(
    path.join(profileDir, "pi-endpoint.json"),
    `${JSON.stringify({ baseUrl: piBaseUrl, model: MODEL, providerName: "Rig endpoint" }, null, 2)}\n`,
  );
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

  const waitFor = async (label, predicate, timeoutMs = 60_000, intervalMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return true;
      } catch (error) {
        lastError = error;
        // A reload destroys the execution context; retry until it is back.
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `timed out waiting for ${label}${lastError ? ` (last error: ${lastError.message})` : ""}`,
    );
  };

  const readState = () => js(READ_STATE);
  const readAgentsState = () => js(READ_AGENTS_STATE);
  const readStorage = () => js(readStorageScript(alphaId, betaId));
  /** The two vaults' bindings as they stand on disk, with the invoke counts. */
  const prefsNow = () => {
    const prefs = readJson(path.join(profileDir, "recent.json"));
    return {
      alpha: prefs?.vaultAgents?.[alphaId] ?? null,
      beta: prefs?.vaultAgents?.[betaId] ?? null,
      migrated: prefs?.vaultAgentsMigrated === true,
      switchInvokes: switchHarnessInvokes.length,
    };
  };
  const prefsTimeline = [];
  const markPrefs = (label) => prefsTimeline.push({ label, at: new Date().toISOString(), ...prefsNow() });

  /**
   * Poll the DOM until a predicate over the state holds. Returns the final state
   * (pass or timeout) so the report always carries what the screen said.
   */
  const waitState = async (label, predicate, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    let state = await readState();
    let samples = 0;
    while (Date.now() < deadline) {
      state = await readState();
      samples += 1;
      if (predicate(state)) return { ok: true, state, samples };
      await sleep(100);
    }
    return { ok: false, state, samples, reason: label };
  };

  const readSettings = () => js(READ_SETTINGS_AGENTS);
  /** Poll the vault-agent card until its async re-read/re-render has landed. */
  const waitSettings = async (label, predicate, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    let state = await readSettings();
    while (Date.now() < deadline) {
      state = await readSettings();
      if (predicate(state)) return { ok: true, state };
      await sleep(100);
    }
    return { ok: false, state, reason: label };
  };

  const capture = async (name) => {
    // A hidden/occluded window commits frames on its own schedule; an immediate
    // capture can hand back the paint before the last state change (the Settings
    // sheet opening, the reuse warning landing). A beat makes the picture the
    // state the report describes.
    await sleep(450);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(artifactsDir, name), image.toPNG());
    return name;
  };

  /**
   * Drive one vault switch through the dialog and count the `vault:open`
   * invokes it caused, so "the click opened the vault it claims" is measured
   * per switch instead of inferred from the whole run's log.
   */
  const doSwitch = async (label, vaultDir) => {
    const before = vaultOpens.length;
    const result = await js(switchVaultScript(label, vaultDir));
    const opened = vaultOpens.slice(before).map((entry) => entry.path);
    return {
      ...result,
      opens: opened,
      openCount: opened.filter((entry) => entry === vaultDir).length,
      otherOpens: opened.filter((entry) => entry !== vaultDir),
    };
  };

  await waitFor("the preload bridge", async () => Boolean(await js("Boolean(window.lifequest)")), 30_000, 50);

  // ── 1. Adoption: boot lands on Alpha and keeps the pre-vault chat ────────
  const adoptionSettled = await waitState(
    "Alpha after adoption",
    (state) =>
      state.dashboard === true &&
      state.chatPanel === true &&
      state.vaultChipName === ALPHA_NAME &&
      state.railTitles.includes(LEGACY_PI_TITLE) &&
      state.splashHidden === true,
    90_000,
  );
  await sleep(500);
  const bootState = adoptionSettled.state;
  const adoptionAgents = await readAgentsState();
  const bootStorage = await readStorage();
  markPrefs("after-adoption");
  await capture("vault-scope-a.png");

  const prefsAfterAdoption = readJson(path.join(profileDir, "recent.json"));
  const alphaBucketDir = path.join(flatSessionsDir, alphaId);
  const betaBucketDir = path.join(flatSessionsDir, betaId);
  const adoption = {
    prefs: prefsAfterAdoption,
    vaultAgents: prefsAfterAdoption?.vaultAgents ?? null,
    migrated: prefsAfterAdoption?.vaultAgentsMigrated === true,
    legacyHarnessPref: prefsAfterAdoption?.harness ?? null,
    legacyCompanionProfilePref: prefsAfterAdoption?.companionProfile ?? null,
    bindingFromPrefs: prefsAfterAdoption?.vaultAgents?.[alphaId] ?? null,
    bindingFromBridge: adoptionAgents?.available ? adoptionAgents.state?.binding ?? null : null,
    flatRootJson: listJson(flatSessionsDir),
    flatFileExists: fs.existsSync(path.join(flatSessionsDir, `${LEGACY_PI_ID}.json`)),
    alphaBucketJson: listJson(alphaBucketDir),
    alphaBucketTitles: sessionTitlesIn(alphaBucketDir),
    alphaBucketHasLegacy: fs.existsSync(path.join(alphaBucketDir, `${LEGACY_PI_ID}.json`)),
    betaBucketJson: listJson(betaBucketDir),
    railTitles: bootState.railTitles,
    pillNames: bootState.pillNames,
    activePill: bootState.activePill,
    tabLabels: bootState.tabLabels,
    storage: bootStorage,
  };

  // ── Alpha chat, through the dock's own New chat + Rename ─────────────────
  const alphaChat = await js(createChatAndRenameScript(ALPHA_CHAT_TITLE));
  const alphaChatState = await waitState(
    "the Alpha chat in the rail and strip",
    (state) => state.railTitles.includes(ALPHA_CHAT_TITLE) && state.tabLabels.includes(ALPHA_CHAT_TITLE),
    30_000,
  );
  const alphaStorage = await readStorage();

  // ── 2. Grouping: switch to Beta through the Switch vault dialog ──────────
  const switchToBeta = await doSwitch(BETA_NAME, betaDir);
  const betaClean = await waitState(
    "Beta's clean surface",
    (state) =>
      state.vaultChipName === BETA_NAME &&
      state.switchDialogOpen === false &&
      state.railTitles.length === 0 &&
      state.tabCount === 0 &&
      state.pillNames.length === 1 &&
      state.pillNames[0] === "Pi",
    60_000,
  );
  await sleep(500);
  const betaCleanState = await readState();
  const betaCleanStorage = await readStorage();
  const betaCleanAgents = await readAgentsState();
  await capture("vault-scope-b-clean.png");

  const grouping = {
    switch: switchToBeta,
    state: betaCleanState,
    settled: betaClean.ok,
    samples: betaClean.samples,
    agents: betaCleanAgents,
    storage: betaCleanStorage,
    alphaTitlesSeen: betaCleanState.railTitles.filter((title) =>
      [LEGACY_PI_TITLE, ALPHA_CHAT_TITLE].includes(title),
    ),
  };

  // ── 3. Fresh agent: Settings adds Hermes to Beta ─────────────────────────
  const settingsOpen = await js(OPEN_SETTINGS_AGENTS);
  let addPath = "bridge";
  let addUi = null;
  if (settingsOpen.ok) {
    addUi = await js(ADD_FRESH_AGENT);
    if (addUi.ok) {
      addPath = "ui";
      await waitFor(
        "the fresh agent binding",
        async () => {
          const agents = await readAgentsState();
          return Boolean(agents?.available && agents.state?.binding?.hermesProfile);
        },
        30_000,
        150,
      );
    }
  }
  if (addPath !== "ui") {
    const added = await js(
      `(async () => {
        const bridge = window.lifequest;
        if (!bridge || typeof bridge.vaultAgentsAddHermes !== "function") {
          return { ok: false, reason: "no vaultAgentsAddHermes bridge" };
        }
        const result = await bridge.vaultAgentsAddHermes({
          mode: "fresh",
          name: ${JSON.stringify(FRESH_FALLBACK_PROFILE)},
        });
        return result;
      })()`,
    );
    addUi = { fallback: added };
    await waitFor(
      "the fallback agent binding",
      async () => {
        const agents = await readAgentsState();
        return Boolean(agents?.available && agents.state?.binding?.hermesProfile);
      },
      30_000,
      150,
    );
  }

  markPrefs("after-add");
  const afterAddAgents = await readAgentsState();
  const afterAddState = await readState();
  const freshProfile = afterAddAgents?.state?.binding?.hermesProfile ?? null;
  const addSettingsSettled = await waitSettings(
    "the bound-agent notice",
    (state) => /bound/i.test(state.notice ?? "") && (state.boundProfileText ?? "").includes(freshProfile ?? "\u0000"),
  );
  const afterAddSettings = addSettingsSettled.state;

  // Bring Hermes up: the add binds it, but a vault can also be bound without
  // being active (the product rule). The shipped control for that is the card's
  // own "Use Hermes"; the dock's pill is the same switch and is the fallback.
  // Every fallback step is recorded: a silent path change here would hide a
  // broken Settings action behind a passing rig.
  let activation = "already-active";
  let activationState = await readState();
  let settingsUse = null;
  let pill = null;
  if (activationState.activePill !== "Hermes") {
    settingsUse = await js(CLICK_USE_HERMES_SETTINGS);
    if (settingsUse.ok) {
      activation = "settings-use-hermes";
    } else {
      const closed = await js(CLOSE_SETTINGS);
      if (!closed.ok) await js('window.location.hash = "#/home"');
      // The dock's harness list may still be catching up with the add's
      // refetch; give the pill a few seconds to appear before falling back.
      const pillDeadline = Date.now() + 8000;
      while (Date.now() < pillDeadline) {
        pill = await js(CLICK_HERMES_PILL);
        if (pill.ok) break;
        await sleep(250);
      }
      if (pill.ok) {
        activation = pill.alreadyActive ? "already-active" : "pill";
      } else {
        // A reload is a cold renderer: never reload onto the Settings sheet,
        // or the dashboard is not behind it and the wait can never settle.
        await js('window.location.hash = "#/home"');
        await sleep(400);
        const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
        win.webContents.reload();
        await loaded;
        await waitFor("the dashboard after the add reload", async () => (await readState()).dashboard === true, 90_000, 100);
        pill = await js(CLICK_HERMES_PILL);
        activation = pill.ok ? "reload+pill" : "unavailable";
      }
    }
  }
  markPrefs("after-use-hermes");
  const hermesActive = await waitState(
    "Beta on Hermes",
    (state) => state.activePill === "Hermes" && state.pillNames.includes("Hermes"),
    60_000,
  );
  const afterActivationAgents = await readAgentsState();
  const activationSettingsSettled = await waitSettings(
    "the active-agent card",
    (state) => state.present && state.useHermesOffered === false,
  );
  const afterActivationSettings = activationSettingsSettled.state;

  // Close Settings through its own cross before operating the dock.
  if (settingsOpen.ok) {
    const closed = await js(CLOSE_SETTINGS);
    if (!closed.ok) await js('window.location.hash = "#/home"');
    await waitState("Settings closed", (state) => state.settingsOpen === false, 15_000);
  }

  const betaRailReady = await waitState(
    "Beta's Hermes rail to load",
    (state) => state.railListPresent && (state.railTitles.length > 0 || state.railEmptyText === "No chats yet"),
    40_000,
  );
  const betaHermesChat = await js(createChatAndRenameScript(BETA_CHAT_TITLE));
  const betaHermesState = await waitState(
    "Beta's Hermes chat in the rail",
    (state) => state.railTitles.includes(BETA_CHAT_TITLE) && state.pillNames.includes("Hermes"),
    40_000,
  );
  const betaHermesStorage = await readStorage();

  // ── 3b. A reload keeps Beta's Hermes chat, pill and binding ──────────────
  const reloadStartedAt = Date.now();
  const reloadLoaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await reloadLoaded;
  const reloadSettled = await waitState(
    "Beta after the reload",
    (state) =>
      state.dashboard === true &&
      state.chatPanel === true &&
      state.vaultChipName === BETA_NAME &&
      state.railTitles.includes(BETA_CHAT_TITLE) &&
      state.pillNames.includes("Hermes"),
    90_000,
  );
  await sleep(600);
  markPrefs("after-reload");
  const reloadState = await readState();
  const reloadAgents = await readAgentsState();
  // The fresh profile only exists on disk once its ensure has run; after the
  // reload it is an installed profile and its `usedBy` can be read.
  const installedAfterReload = reloadAgents?.state?.installedProfiles ?? null;
  const reloadBootMs = Date.now() - reloadStartedAt;
  await capture("vault-scope-b-hermes.png");

  const freshAgent = {
    addPath,
    settingsOpen,
    addUi,
    addHermesInvokes: addInvokesSnapshot(),
    switchHarnessInvokes: switchHarnessInvokes.map((entry) => ({ ...entry })),
    prefsTimeline,
    activation,
    activationDetail: { settingsUse, pill },
    activationState,
    hermesActive: hermesActive.state,
    profile: freshProfile,
    binding: afterAddAgents?.state?.binding ?? null,
    bindingAfterActivation: afterActivationAgents?.state?.binding ?? null,
    stateAfterAdd: afterAddState,
    settingsAfterAdd: afterAddSettings,
    installedAfterReload,
    settingsAfterAddSettled: addSettingsSettled.ok,
    settingsAfterActivation: afterActivationSettings,
    betaRailReady: betaRailReady.state,
    agentsAfterAdd: afterAddAgents?.state ?? null,
    chat: betaHermesChat,
    chatState: betaHermesState.state,
    storage: betaHermesStorage,
    reload: {
      bootMs: reloadBootMs,
      state: reloadState,
      agents: reloadAgents?.state ?? null,
      settled: reloadSettled.ok,
    },
  };

  // ── 4a. Return to Alpha: its own chats and agent, none of Beta's ─────────
  const switchToAlpha = await doSwitch(ALPHA_NAME, alphaDir);
  const alphaReturn = await waitState(
    "Alpha's own surface",
    (state) =>
      state.vaultChipName === ALPHA_NAME &&
      state.switchDialogOpen === false &&
      state.railTitles.includes(LEGACY_PI_TITLE) &&
      state.railTitles.includes(ALPHA_CHAT_TITLE) &&
      state.pillNames.length === 1 &&
      state.pillNames[0] === "Pi",
    60_000,
  );
  await sleep(600);
  markPrefs("after-return-alpha");
  const alphaReturnState = await readState();
  const alphaReturnAgents = await readAgentsState();
  const alphaReturnStorage = await readStorage();
  await capture("vault-scope-a-return.png");

  const isolation = {
    switch: switchToAlpha,
    state: alphaReturnState,
    settled: alphaReturn.ok,
    agents: alphaReturnAgents?.state ?? null,
    storage: alphaReturnStorage,
    betaTitlesInAlpha: alphaReturnState.railTitles.filter((title) => title === BETA_CHAT_TITLE),
    betaTabsInAlpha: alphaReturnState.tabLabels.filter((title) => title === BETA_CHAT_TITLE),
  };

  // ── 4b. Back to Beta: its Hermes chats return with both pills ────────────
  markPrefs("before-return-beta");
  const betaBindingBeforeReturn = prefsNow().beta;
  const switchBackToBeta = await doSwitch(BETA_NAME, betaDir);
  markPrefs("after-return-beta-switch");
  const betaReturn = await waitState(
    "Beta's own surface again",
    (state) =>
      state.vaultChipName === BETA_NAME &&
      state.switchDialogOpen === false &&
      state.railTitles.includes(BETA_CHAT_TITLE) &&
      state.pillNames.includes("Hermes") &&
      state.activePill === "Hermes",
    60_000,
  );
  await sleep(600);
  const betaReturnState = await readState();
  const betaReturnStorage = await readStorage();
  const betaReturnAgents = await readAgentsState();

  // ── 5. Reuse is explicit: Alpha takes Beta's profile ─────────────────────
  const switchToAlphaForReuse = await doSwitch(ALPHA_NAME, alphaDir);
  const alphaBeforeReuse = await waitState(
    "Alpha before reuse",
    (state) =>
      state.vaultChipName === ALPHA_NAME &&
      state.railTitles.includes(ALPHA_CHAT_TITLE) &&
      state.pillNames.length === 1 &&
      state.pillNames[0] === "Pi",
    60_000,
  );
  const bindingBeforeReuse = (await readAgentsState())?.state?.binding ?? null;

  const settingsForReuse = await js(OPEN_SETTINGS_AGENTS);
  let reusePath = "bridge";
  let chooser = null;
  let pick = null;
  let confirm = null;
  let warningText = "";
  let warningStage = "none";
  let reuseUi = null;
  let warningVisible = null;
  if (settingsForReuse.ok && freshProfile) {
    chooser = await js(openExistingChooserScript(freshProfile, BETA_NAME));
    if (chooser.ok) {
      reusePath = "ui";
      if (chooser.warningText && chooser.mentionsBeta) {
        warningText = chooser.warningText;
        warningStage = "chooser";
      }
      // The warning screenshot is the evidence for the explicit-reuse rule, so
      // it is taken only once the shipped chooser is actually painted.
      warningVisible = await js(WAIT_REUSE_WARNING_VISIBLE);
      if (warningVisible.ok && warningVisible.warningText) {
        warningText = warningVisible.warningText;
      }
      await capture("vault-scope-reuse-warning.png");
      pick = await js(pickExistingProfileScript(freshProfile));
      if (pick.ok && pick.confirmClicked) {
        // A build that asks for a confirmation after the row click: the dialog
        // itself carries the warning, so it is captured before confirming.
        if (!warningText) {
          warningText = pick.dialogText || "";
          warningStage = "dialog";
          await capture("vault-scope-reuse-warning.png");
        }
        confirm = await js(CONFIRM_REUSE_DIALOG);
      }
    }
  }
  if (reusePath !== "ui") {
    const added = await js(
      `(async () => {
        const bridge = window.lifequest;
        if (!bridge || typeof bridge.vaultAgentsAddHermes !== "function") {
          return { ok: false, reason: "no vaultAgentsAddHermes bridge" };
        }
        return bridge.vaultAgentsAddHermes({
          mode: "existing",
          profile: ${JSON.stringify(freshProfile)},
        });
      })()`,
    );
    reuseUi = { fallback: added };
  }
  await waitFor(
    "Alpha's shared-profile binding",
    async () => {
      const agents = await readAgentsState();
      return agents?.state?.binding?.hermesProfile === freshProfile;
    },
    30_000,
    150,
  );
  const bindingAfterReuse = (await readAgentsState())?.state?.binding ?? null;
  const stateAfterReuse = await readState();
  const reuseSettingsSettled = await waitSettings(
    "the bound card's shared warning",
    (state) => (state.sharedWarning ?? "").includes(BETA_NAME),
  );
  const settingsAfterReuse = reuseSettingsSettled.state;

  // Bring the newly bound Hermes up on Alpha, the same way as on Beta: the
  // card's own "Use Hermes", with the dock's pill as the fallback.
  let reuseActivation = "already-active";
  let reuseState = await readState();
  let reuseSettingsUse = null;
  let reusePill = null;
  if (reuseState.activePill !== "Hermes") {
    reuseSettingsUse = await js(CLICK_USE_HERMES_SETTINGS);
    if (reuseSettingsUse.ok) {
      reuseActivation = "settings-use-hermes";
    } else {
      const closed = await js(CLOSE_SETTINGS);
      if (!closed.ok) await js('window.location.hash = "#/home"');
      const pillDeadline = Date.now() + 8000;
      while (Date.now() < pillDeadline) {
        reusePill = await js(CLICK_HERMES_PILL);
        if (reusePill.ok) break;
        await sleep(250);
      }
      if (reusePill.ok) {
        reuseActivation = reusePill.alreadyActive ? "already-active" : "pill";
      } else {
        await js('window.location.hash = "#/home"');
        await sleep(400);
        const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
        win.webContents.reload();
        await loaded;
        await waitFor("the dashboard after the reuse reload", async () => (await readState()).dashboard === true, 90_000, 100);
        reusePill = await js(CLICK_HERMES_PILL);
        reuseActivation = reusePill.ok ? "reload+pill" : "unavailable";
      }
    }
  }
  if (settingsForReuse.ok) {
    const closed = await js(CLOSE_SETTINGS);
    if (!closed.ok) await js('window.location.hash = "#/home"');
    await waitState("Settings closed after reuse", (state) => state.settingsOpen === false, 15_000);
  }
  const bindingAfterReuseActivation = (await readAgentsState())?.state?.binding ?? null;
  const reuseActivationSettingsSettled = await waitSettings(
    "the active shared-agent card",
    (state) => state.present && state.useHermesOffered === false,
  );
  const settingsAfterReuseActivation = reuseActivationSettingsSettled.state;
  const alphaShared = await waitState(
    "Alpha on the shared profile",
    (state) =>
      state.pillNames.includes("Hermes") &&
      state.activePill === "Hermes" &&
      state.railTitles.includes(BETA_CHAT_TITLE),
    60_000,
  );
  await sleep(600);
  const alphaSharedState = await readState();
  const alphaSharedAgents = await readAgentsState();
  const reuseWarning = {
    text: warningText,
    stage: warningStage,
    namesBeta: warningText.includes(BETA_NAME),
    mentionsShared: /memory|skills|knowledge/i.test(warningText),
    chooser,
    pick,
    confirm,
    dialogText: pick?.dialogText ?? "",
  };

  // ── Final disk/host facts ────────────────────────────────────────────────
  const finalPrefs = readJson(path.join(profileDir, "recent.json"));
  const hermesStores = {};
  for (const [profileName, store] of hermesHost.stores.entries()) {
    hermesStores[profileName] = store.sessions.map((row) => row.title);
  }
  const disk = {
    flatRootJson: listJson(flatSessionsDir),
    flatRootHasJson: listJson(flatSessionsDir).some((name) => name.endsWith(".json")),
    alphaBucketJson: listJson(alphaBucketDir),
    alphaBucketTitles: sessionTitlesIn(alphaBucketDir),
    betaBucketJson: listJson(betaBucketDir),
    betaBucketTitles: sessionTitlesIn(betaBucketDir),
    hermesStores,
    probeProfileStore: hermesStores[PROBE_PROFILE] ?? null,
    freshProfileStore: freshProfile ? hermesStores[freshProfile] ?? null : null,
  };
  const finalPrefsState = {
    vaultAgents: finalPrefs?.vaultAgents ?? null,
    migrated: finalPrefs?.vaultAgentsMigrated === true,
    alphaBinding: finalPrefs?.vaultAgents?.[alphaId] ?? null,
    betaBinding: finalPrefs?.vaultAgents?.[betaId] ?? null,
  };

  // ── What happened ────────────────────────────────────────────────────────
  const failures = [];
  const checks = [];
  const check = (name, pass, detail = null) => {
    checks.push({ name, pass: Boolean(pass), detail });
    if (!pass) failures.push(detail ? `${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : name);
  };

  // 1. Adoption.
  check(
    "adoption: the app booted on Alpha with the pre-vault chat in the rail",
    bootState.dashboard === true &&
      bootState.vaultChipName === ALPHA_NAME &&
      bootState.railTitles.includes(LEGACY_PI_TITLE) &&
      bootState.activePill === "Pi",
    JSON.stringify({
      dashboard: bootState.dashboard,
      vaultChipName: bootState.vaultChipName,
      railTitles: bootState.railTitles,
      activePill: bootState.activePill,
      settled: adoptionSettled.ok,
    }),
  );
  check(
    "adoption: prefs record the adopting vault's binding as Pi with no Hermes profile",
    adoption.bindingFromPrefs?.harness === "pi" &&
      adoption.bindingFromPrefs?.hermesProfile === null,
    JSON.stringify({
      bindingFromPrefs: adoption.bindingFromPrefs,
      bindingFromBridge: adoption.bindingFromBridge,
      legacyHarnessPref: adoption.legacyHarnessPref,
      legacyCompanionProfilePref: adoption.legacyCompanionProfilePref,
    }),
  );
  check(
    "adoption: the one-time migration is marked done",
    adoption.migrated === true,
    JSON.stringify({ migrated: adoption.migrated }),
  );
  check(
    "adoption: the legacy Hermes profile pref was not silently adopted",
    adoption.bindingFromPrefs?.hermesProfile === null &&
      adoption.legacyCompanionProfilePref === PROBE_PROFILE,
    JSON.stringify({
      hermesProfile: adoption.bindingFromPrefs?.hermesProfile ?? null,
      legacyCompanionProfilePref: adoption.legacyCompanionProfilePref,
      probeProfile: PROBE_PROFILE,
    }),
  );
  check(
    "adoption: the flat transcript moved into Alpha's bucket",
    adoption.flatFileExists === false &&
      adoption.alphaBucketHasLegacy === true &&
      adoption.flatRootJson.every((name) => !name.endsWith(".json") || name === alphaId || name === betaId),
    JSON.stringify({
      flatRootJson: adoption.flatRootJson,
      flatFileExists: adoption.flatFileExists,
      alphaBucketJson: adoption.alphaBucketJson,
      alphaBucketHasLegacy: adoption.alphaBucketHasLegacy,
    }),
  );
  check(
    "adoption: Alpha draws only Pi",
    adoption.pillNames.length === 1 && adoption.pillNames[0] === "Pi",
    JSON.stringify({ pillNames: adoption.pillNames, activePill: adoption.activePill }),
  );

  // 2. Grouping.
  check(
    "grouping: an Alpha chat was created through the dock",
    alphaChat.ok === true &&
      alphaChatState.ok === true &&
      alphaChatState.state.railTitles.includes(ALPHA_CHAT_TITLE),
    JSON.stringify({ chat: alphaChat, state: alphaChatState.state, samples: alphaChatState.samples }),
  );
  check(
    "grouping: Alpha's strip remembers its chat under the vault's own key",
    typeof alphaStorage.alphaPi === "string" && alphaStorage.alphaPi !== null,
    JSON.stringify({ alphaStorage }),
  );
  check(
    "switch: the Switch vault dialog drove the switch to Beta",
    switchToBeta.ok === true &&
      switchToBeta.dialogOpened === true &&
      switchToBeta.dialogClosed === true &&
      switchToBeta.after === BETA_NAME,
    JSON.stringify(switchToBeta),
  );
  check(
    "switch: exactly one vault:open invoke per dialog switch, for the target folder",
    switchToBeta.openCount === 1 &&
      switchToAlpha.openCount === 1 &&
      switchBackToBeta.openCount === 1 &&
      switchToAlphaForReuse.openCount === 1,
    JSON.stringify({
      switches: [switchToBeta, switchToAlpha, switchBackToBeta, switchToAlphaForReuse].map((entry) => ({
        before: entry.before,
        after: entry.after,
        opens: entry.opens,
        openCount: entry.openCount,
        otherOpens: entry.otherOpens,
      })),
      allOpens: vaultOpens.map((entry) => entry.path),
    }),
  );
  check(
    "grouping: Beta's rail is empty and holds none of Alpha's chats",
    betaClean.ok === true &&
      betaCleanState.railTitles.length === 0 &&
      betaCleanState.railEmptyText !== null,
    JSON.stringify({
      railTitles: betaCleanState.railTitles,
      railEmptyText: betaCleanState.railEmptyText,
      settled: betaClean.ok,
      samples: betaClean.samples,
      alphaTitlesSeen: grouping.alphaTitlesSeen,
    }),
  );
  check(
    "grouping: Beta's tab strip is empty",
    betaCleanState.tabCount === 0 && betaCleanState.tabLabels.length === 0,
    JSON.stringify({ tabCount: betaCleanState.tabCount, tabLabels: betaCleanState.tabLabels }),
  );
  check(
    "grouping: Beta's switcher draws only Pi",
    betaCleanState.pillNames.length === 1 && betaCleanState.pillNames[0] === "Pi",
    JSON.stringify({ pillNames: betaCleanState.pillNames, activePill: betaCleanState.activePill }),
  );
  check(
    "grouping: Alpha's remembered strip survived while Beta is open",
    betaCleanStorage.alphaPi === alphaStorage.alphaPi,
    JSON.stringify({ alphaBefore: alphaStorage.alphaPi, alphaWhileBeta: betaCleanStorage.alphaPi }),
  );

  // 3. Fresh agent.
  check(
    "fresh agent: the add was driven by the shipped path and named a new profile",
    addPath === "ui" &&
      typeof freshProfile === "string" &&
      freshProfile.length > 0 &&
      freshProfile !== PROBE_PROFILE,
    JSON.stringify({ addPath, freshProfile, addUi, settingsOpen }),
  );
  check(
    "fresh agent: the add made Hermes available without switching Beta off Pi",
    afterAddAgents?.state?.binding?.hermesProfile === freshProfile &&
      afterAddAgents?.state?.binding?.harness === "pi" &&
      afterAddState.activePill === "Pi",
    JSON.stringify({
      bindingAfterAdd: afterAddAgents?.state?.binding ?? null,
      stateAfterAdd: afterAddState,
    }),
  );
  check(
    "fresh agent: Beta draws the Hermes pill and Use Hermes makes it the active agent",
    hermesActive.ok === true &&
      hermesActive.state.pillNames.includes("Hermes") &&
      afterActivationAgents?.state?.binding?.harness === "hermes" &&
      afterActivationAgents?.state?.binding?.hermesProfile === freshProfile,
    JSON.stringify({
      activation,
      state: hermesActive.state,
      bindingAfterActivation: afterActivationAgents?.state?.binding ?? null,
    }),
  );
  check(
    "fresh agent: Settings said the add only bound the agent, and Use Hermes was the control",
    activation === "settings-use-hermes" &&
      /bound/i.test(afterAddSettings?.notice ?? "") &&
      /use hermes/i.test(afterAddSettings?.notice ?? "") &&
      (afterAddSettings?.boundProfileText ?? "").includes(freshProfile ?? "\u0000"),
    JSON.stringify({
      activation,
      notice: afterAddSettings?.notice ?? null,
      boundProfileText: afterAddSettings?.boundProfileText ?? null,
      freshProfile,
    }),
  );
  check(
    "fresh agent: a Beta Hermes chat was created",
    betaHermesChat.ok === true && betaHermesState.ok === true,
    JSON.stringify({ chat: betaHermesChat, state: betaHermesState.state }),
  );
  check(
    "fresh agent: a reload kept Beta's Hermes chat, pill and binding",
    reloadSettled.ok === true &&
      reloadState.railTitles.includes(BETA_CHAT_TITLE) &&
      reloadState.pillNames.includes("Hermes") &&
      reloadAgents?.state?.binding?.hermesProfile === freshProfile,
    JSON.stringify({
      bootMs: reloadBootMs,
      railTitles: reloadState.railTitles,
      pillNames: reloadState.pillNames,
      activePill: reloadState.activePill,
      binding: reloadAgents?.state?.binding ?? null,
      settled: reloadSettled.ok,
    }),
  );
  const freshInstalledRow = Array.isArray(installedAfterReload)
    ? installedAfterReload.find((profile) => profile.name === freshProfile) ?? null
    : null;
  check(
    "fresh agent: the new profile is installed for Beta and shared with no other vault",
    freshInstalledRow !== null && Array.isArray(freshInstalledRow.usedBy) && freshInstalledRow.usedBy.length === 0,
    JSON.stringify({
      profile: freshProfile,
      installedAfterReload,
      freshInstalledRow,
    }),
  );

  // 4. Isolation and return.
  check(
    "isolation: Alpha draws none of Beta's chats",
    isolation.settled === true &&
      isolation.betaTitlesInAlpha.length === 0 &&
      isolation.betaTabsInAlpha.length === 0,
    JSON.stringify({
      railTitles: alphaReturnState.railTitles,
      tabLabels: alphaReturnState.tabLabels,
      betaTitlesInAlpha: isolation.betaTitlesInAlpha,
      settled: isolation.settled,
    }),
  );
  check(
    "isolation: Alpha draws no Hermes pill",
    alphaReturnState.pillNames.length === 1 && alphaReturnState.pillNames[0] === "Pi",
    JSON.stringify({ pillNames: alphaReturnState.pillNames, activePill: alphaReturnState.activePill }),
  );
  check(
    "isolation: Alpha's binding is still the clean Pi default",
    alphaReturnAgents?.state?.binding?.harness === "pi" &&
      alphaReturnAgents?.state?.binding?.hermesProfile === null,
    JSON.stringify({ binding: alphaReturnAgents?.state?.binding ?? null }),
  );
  check(
    "return: Alpha's own chats came back",
    alphaReturnState.railTitles.includes(LEGACY_PI_TITLE) &&
      alphaReturnState.railTitles.includes(ALPHA_CHAT_TITLE),
    JSON.stringify({ railTitles: alphaReturnState.railTitles, settled: alphaReturn.ok }),
  );
  check(
    "return: Alpha's tab strip came back",
    alphaReturnState.tabLabels.includes(ALPHA_CHAT_TITLE),
    JSON.stringify({ tabLabels: alphaReturnState.tabLabels, activeTabLabel: alphaReturnState.activeTabLabel }),
  );
  check(
    "return: Beta's Hermes chats came back with both pills",
    betaReturn.ok === true &&
      betaReturnState.railTitles.includes(BETA_CHAT_TITLE) &&
      betaReturnState.pillNames.includes("Hermes") &&
      betaReturnState.pillNames.includes("Pi") &&
      betaReturnState.activePill === "Hermes",
    JSON.stringify({
      railTitles: betaReturnState.railTitles,
      tabLabels: betaReturnState.tabLabels,
      pillNames: betaReturnState.pillNames,
      activePill: betaReturnState.activePill,
      settled: betaReturn.ok,
    }),
  );
  check(
    "return: Beta's own agent binding survived the round trip",
    betaBindingBeforeReturn?.harness === "hermes" &&
      betaBindingBeforeReturn?.hermesProfile === freshProfile &&
      betaReturnAgents?.state?.binding?.harness === "hermes",
    JSON.stringify({
      bindingBeforeSwitch: betaBindingBeforeReturn,
      bindingAfterSwitch: betaReturnAgents?.state?.binding ?? null,
      freshProfile,
    }),
  );
  check(
    "return: Beta's strip came back under the vault's own key",
    typeof betaReturnStorage.betaHermes === "string" && betaReturnStorage.betaHermes !== null,
    JSON.stringify({ betaReturnStorage }),
  );

  // 5. Reuse.
  check(
    "reuse: Alpha had no Hermes agent before reuse",
    bindingBeforeReuse?.harness === "pi" && bindingBeforeReuse?.hermesProfile === null,
    JSON.stringify({ bindingBeforeReuse, alphaBeforeReuse: alphaBeforeReuse.state }),
  );
  check(
    "reuse: the warning named Beta and said memory, skills and knowledge are shared",
    reusePath === "ui" && reuseWarning.namesBeta === true && reuseWarning.mentionsShared === true,
    JSON.stringify({
      reusePath,
      warning: reuseWarning,
      settingsForReuse,
      chooser,
    }),
  );
  check(
    "reuse: Alpha took the shared profile without switching off Pi",
    bindingAfterReuse?.hermesProfile === freshProfile &&
      bindingAfterReuse?.harness === "pi" &&
      stateAfterReuse.activePill === "Pi",
    JSON.stringify({
      bindingAfterReuse,
      stateAfterReuse,
    }),
  );
  check(
    "reuse: after Use Hermes Alpha is on the shared profile",
    bindingAfterReuseActivation?.harness === "hermes" &&
      bindingAfterReuseActivation?.hermesProfile === freshProfile &&
      alphaShared.ok === true &&
      alphaSharedState.pillNames.includes("Hermes") &&
      alphaSharedState.activePill === "Hermes",
    JSON.stringify({
      bindingAfterReuseActivation,
      reuseActivation,
      state: alphaSharedState,
      settled: alphaShared.ok,
    }),
  );
  check(
    "reuse: the warning screenshot was taken with the chooser painted",
    warningVisible?.ok === true &&
      warningVisible?.sheetVisible === true &&
      warningVisible?.inViewport === true &&
      /also used by/i.test(warningVisible?.warningText ?? "") &&
      /beta vault/i.test(warningVisible?.warningText ?? ""),
    JSON.stringify({ warningVisible, warningText }),
  );
  check(
    "reuse: the bound card warned that Beta shares this profile's memory",
    (settingsAfterReuse?.sharedWarning ?? "").includes(BETA_NAME) &&
      /memory|skills|knowledge/i.test(settingsAfterReuse?.sharedWarning ?? ""),
    JSON.stringify({
      sharedWarning: settingsAfterReuse?.sharedWarning ?? null,
      settingsAfterReuse,
    }),
  );
  check(
    "reuse: Alpha now sees the shared profile's own chat",
    alphaSharedState.railTitles.includes(BETA_CHAT_TITLE),
    JSON.stringify({ railTitles: alphaSharedState.railTitles, binding: alphaSharedAgents?.state?.binding ?? null }),
  );
  check(
    "reuse: the shared binding is recorded in prefs for Alpha",
    finalPrefsState.alphaBinding?.harness === "hermes" &&
      finalPrefsState.alphaBinding?.hermesProfile === freshProfile,
    JSON.stringify({ alphaBinding: finalPrefsState.alphaBinding, betaBinding: finalPrefsState.betaBinding }),
  );

  // Disk and host.
  check(
    "disk: the legacy flat folder holds no transcript",
    disk.flatRootHasJson === false,
    JSON.stringify({ flatRootJson: disk.flatRootJson }),
  );
  check(
    "disk: Alpha's Pi bucket holds the pre-vault chat and Alpha's own, nothing else",
    disk.alphaBucketTitles.includes(LEGACY_PI_TITLE) &&
      disk.alphaBucketTitles.includes(ALPHA_CHAT_TITLE) &&
      !disk.alphaBucketTitles.includes(BETA_CHAT_TITLE),
    JSON.stringify({ alphaBucketTitles: disk.alphaBucketTitles }),
  );
  check(
    "disk: Beta's Pi bucket holds none of Alpha's chats",
    !disk.betaBucketTitles.includes(LEGACY_PI_TITLE) &&
      !disk.betaBucketTitles.includes(ALPHA_CHAT_TITLE),
    JSON.stringify({ betaBucketTitles: disk.betaBucketTitles }),
  );
  check(
    "host: the Hermes gateway kept one session store per profile",
    freshProfile !== null &&
      Array.isArray(disk.freshProfileStore) &&
      disk.freshProfileStore.includes(BETA_CHAT_TITLE) &&
      disk.probeProfileStore === null,
    JSON.stringify({
      freshProfile,
      freshProfileStore: disk.freshProfileStore,
      probeProfile: PROBE_PROFILE,
      probeProfileStore: disk.probeProfileStore,
      stores: disk.hermesStores,
    }),
  );

  // Hygiene.
  const consoleErrorsFiltered = consoleErrors.filter((row) => !KNOWN_NOISE.test(row.message));
  check(
    "the page logged no errors or uncaught exceptions",
    consoleErrorsFiltered.length === 0 && renderProcessGone.length === 0,
    JSON.stringify({ consoleErrors: consoleErrorsFiltered, renderProcessGone }),
  );
  const screenshots = [
    "vault-scope-a.png",
    "vault-scope-b-clean.png",
    "vault-scope-b-hermes.png",
    "vault-scope-a-return.png",
    "vault-scope-reuse-warning.png",
  ];
  check(
    "every screenshot was captured",
    screenshots.every((name) => fs.existsSync(path.join(artifactsDir, name))),
    JSON.stringify({ screenshots, present: screenshots.filter((name) => fs.existsSync(path.join(artifactsDir, name))) }),
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
      alpha: { id: alphaId, name: ALPHA_NAME, path: alphaDir },
      beta: { id: betaId, name: BETA_NAME, path: betaDir },
      probeProfile: PROBE_PROFILE,
      freshFallbackProfile: FRESH_FALLBACK_PROFILE,
      freshProfile,
      devServerUrl: DEV_SERVER_URL,
      piEndpoint: piBaseUrl,
      hermesHost: `http://127.0.0.1:${hostPort}`,
      legacyPrefs,
    },
    adoption,
    alpha: {
      chat: alphaChat,
      state: alphaChatState.state,
      storage: alphaStorage,
    },
    grouping,
    switchToBeta,
    switchToAlpha,
    switchBackToBeta,
    switchToAlphaForReuse,
    freshAgent,
    isolation,
    returnAlpha: { state: alphaReturnState, agents: alphaReturnAgents?.state ?? null, storage: alphaReturnStorage },
    returnBeta: {
      state: betaReturnState,
      agents: betaReturnAgents?.state ?? null,
      storage: betaReturnStorage,
      bindingBeforeSwitch: betaBindingBeforeReturn,
    },
    reuse: {
      path: reusePath,
      warning: reuseWarning,
      warningVisible,
      bindingBefore: bindingBeforeReuse,
      bindingAfter: bindingAfterReuse,
      bindingAfterActivation: bindingAfterReuseActivation,
      stateAfterReuse,
      settingsAfterReuse,
      settingsAfterReuseActivation,
      activation: reuseActivation,
      activationDetail: { settingsUse: reuseSettingsUse, pill: reusePill },
      state: alphaSharedState,
      agents: alphaSharedAgents?.state ?? null,
      fallback: reuseUi,
    },
    disk,
    finalPrefs: finalPrefsState,
    vaultOpens: {
      total: vaultOpens.length,
      entries: vaultOpens.map((entry) => ({ at: entry.at, path: entry.path })),
    },
    addHermesInvokes: addInvokesSnapshot(),
    switchHarnessInvokes: switchHarnessInvokes.map((entry) => ({ ...entry })),
    prefsTimeline,
    consoleErrors: consoleErrorsFiltered,
    consoleErrorsExcluded: consoleErrors.filter((row) => KNOWN_NOISE.test(row.message)),
    renderProcessGone,
    screenshots,
  };
  writeReport(report);

  console.log(`vault scope: ${ok ? "PASS" : "FAIL"}`);
  console.log(
    JSON.stringify(
      {
        ok,
        failures,
        adoptionBinding: adoption.bindingFromPrefs,
        migrated: adoption.migrated,
        alphaRail: bootState.railTitles,
        betaClean: {
          railTitles: betaCleanState.railTitles,
          railEmptyText: betaCleanState.railEmptyText,
          tabCount: betaCleanState.tabCount,
          pillNames: betaCleanState.pillNames,
        },
        freshProfile,
        addPath,
        betaReloadRail: reloadState.railTitles,
        alphaReturnRail: alphaReturnState.railTitles,
        betaReturnPills: betaReturnState.pillNames,
        reuseWarning: reuseWarning.text.slice(0, 400),
        reuseBinding: bindingAfterReuse,
        disk,
        vaultOpens: vaultOpens.map((entry) => entry.path),
        consoleErrors: consoleErrorsFiltered,
      },
      null,
      1,
    ),
  );
  return ok;
}

/** A defensive copy of the addHermes invoke log. */
function addInvokesSnapshot() {
  return addHermesInvokes.map((entry) => ({ at: entry.at, input: entry.input }));
}

/** The `usedBy` list for a profile, or [] when the list has no such row. */
function usedByForProfile(profiles, name) {
  if (!Array.isArray(profiles) || !name) return [];
  const row = profiles.find((profile) => profile.name === name);
  return Array.isArray(row?.usedBy) ? row.usedBy : [];
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
        failures: [
          `the rig crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        ],
        screenshots: [],
      });
    } catch {
      // The exit below is what matters.
    }
    console.error("vault-scope rig failed:", error);
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
