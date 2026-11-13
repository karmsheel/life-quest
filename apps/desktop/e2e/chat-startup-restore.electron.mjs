/**
 * On a restart that remembers a chat, does the chat's transcript actually paint?
 *
 * WHY THIS EXISTS
 *
 * The operator reported: "on app start, a chat loads, its tab is shown selected,
 * but the thread pane is blank; switching to another tab and back makes the
 * conversation appear." A tab with no transcript is a lie the dock tells about
 * the state it restored — the strip says the chat is open, the thread says
 * nothing is — and the fix has to make the memory and the transcript land
 * together.
 *
 * The failure is a mount-order race inside the REAL app: `CompanionProvider`
 * answers with the active harness before the first companion `ready` status, so
 * `AppShell` (and the chat store inside it) mounts with `harness` already set.
 * `ChatSessionsProvider`'s harness-change effect treats its first answer as an
 * agent switch, bumps `listEpoch`, and voids the landing the dock's own
 * `resumeLast` effect (a child effect, so it runs first) has already started.
 * The switch's own landing is then refused by the `landingFor` latch, so no
 * list read completes and `loadMessages` is never called: the strip was seeded
 * from storage, the transcript was not. Switching tabs calls `openChat` again,
 * which is why the chat appears on the second click.
 *
 * The harness-page rigs cannot see this. They mount no CompanionProvider, so
 * `harness` is null and the switch effect returns before the epoch bump. This
 * rig exists because the bug lives in the arrangement only the real app has.
 *
 * THE WORLD IS HERMETIC
 *
 * The real main process, the real preload and the real renderer are run against
 * a throwaway world built by `tests/chat-startup-restore-e2e.test.ts` (a temp
 * `HERMES_HOME`, a throwaway vault, a userData directory, and a stub `hermes`
 * first on PATH). A loopback stub of the Hermes host gateway serves the attach
 * probes and exactly one chat — `chat-alpha`, one user message and one assistant
 * message — through the same endpoints the product calls:
 *
 *   GET /health                              → the attach probe
 *   GET /v1/capabilities                     → the feature list
 *   GET /api/sessions?limit=200              → one row: chat-alpha
 *   GET /api/sessions/chat-alpha/messages    → the two-message transcript
 *
 * Every request's path is appended to `gateway-requests.log` in the world, so
 * "was the transcript read during the launch, before the operator touched
 * anything" is a fact in the artifact, not an inference from the screen.
 *
 * TWO PHASES, ONE PROFILE
 *
 *   --phase=seed    the fixture launch: the app's first launch on this profile.
 *                   No strip is remembered, so the dock lands on the most recent
 *                   chat when the landing survives. Before quitting it makes
 *                   sure the profile remembers that chat (the strip plus
 *                   `lastSessionId`) and flushes storage, so the restart has the
 *                   state the operator reported.
 *   --phase=verify  the restart. The strip
 *                   (`lifequest.companion.openTabs.<vaultId>.hermes`) and
 *                   `lastSessionId.<vaultId>` are remembered — chats belong to a
 *                   vault, so the shipped keys carry the vault's stable id. The
 *                   chat's tab must be in front, its header must name it, AND its
 *                   transcript must be on screen without an interaction — the
 *                   reported bug is that it is the "Ask Hermes" empty slate
 *                   instead.
 *
 * A NOTE ON THE FIXTURE. On unfixed code the FIRST launch is broken by the same
 * race the report is about: the dock never lands, so no transcript is read and
 * nothing is remembered (the rig records that as `observations.firstLaunch` —
 * two sessions-list reads and zero message reads). A rig that insisted the
 * first launch paint a transcript before it would seed a memory could not run
 * at all against the buggy code, and could not produce the reported "tab
 * selected, thread blank" state. So the seed phase writes the two localStorage
 * keys the product writes (a precondition, not behavior under test) whenever the
 * landing did not already write them, and `observations.seededStripDirectly`
 * records which it was. The verify phase is the assertion.
 *
 * Run by `tests/chat-startup-restore-e2e.test.ts` as two separate Electron
 * processes over one profile:
 *
 *   LQ_STARTUP_WORLD=<dir> LQ_STARTUP_URL=<dist url> <electron> e2e/chat-startup-restore.electron.mjs --phase=seed
 *   LQ_STARTUP_WORLD=<dir> LQ_STARTUP_URL=<dist url> <electron> e2e/chat-startup-restore.electron.mjs --phase=verify
 *
 * Exit 0 = every check held. The report is
 * `e2e/artifacts/chat-startup-restore-<phase>.json` and the screenshot is
 * `e2e/artifacts/chat-startup-restore-<phase>.png`; the test merges the phases
 * into `e2e/artifacts/chat-startup-restore.json`.
 *
 * SYSTEM IN ISOLATION — the ways this can fail, written down before the
 * assertions:
 *
 *  1. The app never attaches to the stub gateway, so the connect screen stays
 *     and the dock is never mounted (the rig never reaches the question).
 *  2. The app attaches but the sessions list never arrives, so the sidebar is
 *     empty and there is no chat to land on.
 *  3. The dock mounts with the chat in front but its transcript is never read:
 *     no `GET /messages` reaches the gateway and the screen shows the empty
 *     "Ask Hermes" slate. This is the reported bug; the verify phase must see it
 *     fail on unfixed code and pass after the fix.
 *  4. The tab strip restores but the thread paints a DIFFERENT chat.
 *  5. The strip is remembered under the wrong agent key (or not written at all),
 *     so the restart has no memory and the verify phase tests nothing.
 *  6. Storage is only in memory: the strip the seed saw is gone in the second
 *     process (missing flush, a new profile, a different renderer origin).
 *  7. The remembered strip restores but the tab is not in front, or the header
 *     and the tab name different chats.
 *  8. The transcript request only reaches the gateway after some interaction,
 *     which would pass a screen-only check while the launch was still broken.
 *  9. The screenshots are not of the app (blank capture / no window), so the
 *     artifact cannot be used as evidence.
 * 10. The rig itself is blind (a selector that no longer matches, an instrument
 *     that cannot see a transcript), so a blank screen proves nothing. After the
 *     pre-interaction sample the verify phase records the operator's own
 *     workaround in `observations.afterReopeningTheChat`: re-opening the chat
 *     must paint the transcript. It is an observation, not a gate — requiring it
 *     would accept a broken launch — but it separates "the launch lost the read"
 *     from "the rig never looked at the right thing".
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

// An occluded/hidden window stops painting, and a window that stops painting
// can stop timers the renderer's own boot waits on. The bench keeps another app
// on the same display while this rig runs.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

const phase = (
  process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=verify"
).slice("--phase=".length);
const isSeed = phase === "seed";
const worldDir = process.env.LQ_STARTUP_WORLD;
const rendererUrl = process.env.LQ_STARTUP_URL;

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  return ok;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/** The world the test built: paths, the one chat, and the fake CLI directory. */
function readWorld() {
  if (!worldDir) {
    throw new Error(
      "LQ_STARTUP_WORLD is required — run this through tests/chat-startup-restore-e2e.test.ts",
    );
  }
  const file = path.join(worldDir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(`no world.json in ${worldDir}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const rowFor = (chat, nowSec) => ({
  id: chat.id,
  source: "api_server",
  title: chat.title,
  preview: chat.preview,
  started_at: nowSec - 600,
  last_active: nowSec - 60,
  pinned: false,
  archived: false,
  hidden: false,
  message_count: 2,
});

/**
 * The stub Hermes host gateway.
 *
 * Matched on the tail of the path because the app talks to the profile base
 * (`/p/<profile>/api/...`); the rig's own prefix is not part of what is being
 * tested. Every request is recorded, in memory for the report and on disk in the
 * world for the artifact trail.
 */
function serveGateway(world) {
  const chat = world.chat;
  const state = { requests: [], sessionsListed: 0, messagesRead: 0 };
  const logFile = path.join(world.dir, "gateway-requests.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${JSON.stringify({ phase, event: "gateway-started", at: new Date().toISOString() })}\n`);

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const json = (payload, status = 200) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(payload));

    state.requests.push({ at: Date.now(), method, path: url.pathname, search: url.search });
    fs.appendFileSync(
      logFile,
      `${JSON.stringify({ phase, at: new Date().toISOString(), method, path: url.pathname + url.search })}\n`,
    );

    if (url.pathname.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname.endsWith("/v1/capabilities")) {
      json({
        features: {
          session_list: true,
          session_chat: true,
          session_chat_stream: true,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/api/model/options")) {
      json({
        model: "some-model",
        providers: [
          {
            slug: "rig",
            name: "Rig provider",
            authenticated: true,
            models: ["some-model"],
            capabilities: {},
          },
        ],
      });
      return;
    }

    const messagesMatch = /\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (messagesMatch && method === "GET") {
      const id = decodeURIComponent(messagesMatch[1]);
      if (id !== chat.id) {
        json({ error: { message: "not_found", code: "session_not_found" } }, 404);
        return;
      }
      state.messagesRead += 1;
      json({
        object: "list",
        data: [
          { role: "user", content: chat.userText, timestamp: Math.floor(Date.now() / 1000) - 120 },
          {
            role: "assistant",
            content: chat.assistantText,
            timestamp: Math.floor(Date.now() / 1000) - 110,
          },
        ],
      });
      return;
    }

    if (url.pathname.endsWith("/api/sessions")) {
      if (method === "GET") {
        state.sessionsListed += 1;
        json({
          object: "list",
          data: [rowFor(chat, Math.floor(Date.now() / 1000))],
          limit: 200,
          offset: 0,
          has_more: false,
        });
        return;
      }
      if (method === "POST") {
        void readBody(req).then((body) => {
          const row = {
            ...rowFor(chat, Math.floor(Date.now() / 1000)),
            id: `chat-created-${Date.now()}`,
            title: typeof body?.title === "string" && body.title.trim() ? body.title : "New chat",
            preview: "",
            message_count: 0,
          };
          json({ object: "hermes.session", session: row }, 201);
        });
        return;
      }
    }

    const sessionMatch = /\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && (method === "PATCH" || method === "DELETE")) {
      void readBody(req).then((body) => {
        if (method === "DELETE") {
          json({ object: "hermes.session.deleted", id: decodeURIComponent(sessionMatch[1]) });
          return;
        }
        json({ object: "hermes.session", session: { ...rowFor(chat, Math.floor(Date.now() / 1000)), ...body } });
      });
      return;
    }

    json({});
  });

  return listen(server).then((port) => ({
    port,
    state,
    logFile,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  }));
}

/** `HERMES_HOME/.env`, written after the gateway has a port and before boot. */
function writeHostEnv(world, port) {
  fs.writeFileSync(
    path.join(world.hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

/**
 * What one read of the dock says, in the parts this rig makes claims about.
 *
 * Deliberately reads the rendered DOM rather than any store: "the transcript is
 * on screen" is a claim about what the operator sees.
 */
const SAMPLE = (world) => `(() => {
  const vaultId = ${JSON.stringify(world.vaultId)};
  const text = (el) => ((el && el.textContent) || "").trim();
  const tabs = Array.from(document.querySelectorAll(".chat-panel__tab")).map((tab) => ({
    label: text(tab.querySelector(".chat-panel__tab-label")),
    active: tab.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true",
  }));
  const messages = Array.from(document.querySelectorAll(".chat-panel__message")).map((node) => ({
    role: node.className.includes("--user")
      ? "user"
      : node.className.includes("--assistant")
        ? "assistant"
        : null,
    content: text(node.querySelector(".chat-panel__message-content")),
  }));
  return {
    t: performance.now(),
    shell: Boolean(document.querySelector(".shell")),
    splashVisible: (() => {
      const splash = document.getElementById("splash");
      if (!splash) return false;
      const style = window.getComputedStyle(splash);
      return (
        !splash.hasAttribute("hidden") &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0.01
      );
    })(),
    dock: Boolean(document.querySelector(".chat-panel")),
    surface: document.querySelector(".chat-panel")?.getAttribute("data-chat-surface") ?? null,
    tabs,
    tabCount: tabs.length,
    strip: Boolean(document.querySelector(".chat-panel__tabs")),
    thread: Boolean(document.querySelector(".chat-panel__header--thread")),
    heading: text(
      document.querySelector(".chat-panel__heading--thread") ??
        document.querySelector(".chat-panel__heading"),
    ),
    emptySlate: text(document.querySelector(".chat-panel__empty-title")),
    messageCount: messages.length,
    messages,
    railLabels: Array.from(document.querySelectorAll(".chats-rail__label")).map(text).filter(Boolean),
    storedStrip: window.localStorage.getItem("lifequest.companion.openTabs." + vaultId + ".hermes"),
    legacyStrip: window.localStorage.getItem("lifequest.companion.openTabs"),
    lastSessionId: window.localStorage.getItem("lifequest.companion.lastSessionId." + vaultId),
  };
})()`;

/** What the screen held, for a failure message that names the real state. */
const screenSummary = (state) =>
  JSON.stringify({
    surface: state.surface,
    tabs: state.tabs,
    heading: state.heading,
    emptySlate: state.emptySlate,
    messages: state.messageCount,
    firstMessage: state.messages[0]?.content ?? null,
    rail: state.railLabels,
    storedStrip: state.storedStrip,
    lastSessionId: state.lastSessionId,
  });

/** The chat tab is in front and the thread names the same chat. */
const activeTab = (state) => state.tabs.find((tab) => tab.active)?.label ?? null;

const screenHasTranscript = (state, chat) => {
  const onScreen = state.messages.map((message) => message.content);
  return (
    state.messageCount === 2 &&
    onScreen.includes(chat.userText) &&
    onScreen.includes(chat.assistantText)
  );
};

const readStoredStrip = (state) => {
  const raw = state.storedStrip ?? state.legacyStrip;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return null;
  }
};

const stripMatches = (strip, state, chat) =>
  strip?.tabs.join(",") === chat.id &&
  strip?.activeId === chat.id &&
  state.lastSessionId === chat.id;

/**
 * Poll the rendered dock until `predicate` says the launch has settled.
 *
 * A bug that never reads the transcript does not become true later — but the
 * first frames of a GOOD launch also have no messages yet, so a single sample is
 * a coin toss. Waiting for the transcript up to `timeoutMs` and then taking the
 * final sample is what makes the two cases distinguishable.
 */
async function waitFor(win, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ok = false;
    try {
      ok = await win.webContents.executeJavaScript(expression, true);
    } catch {
      ok = false;
    }
    if (ok) return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  if (!rendererUrl) {
    throw new Error(
      "LQ_STARTUP_URL is required — it must be the SAME http origin in both phases, or the renderer's localStorage does not survive the restart",
    );
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  const world = readWorld();
  const chat = world.chat;

  const reportPath = path.join(artifactsDir, `chat-startup-restore-${phase}.json`);
  const screenshotPath = path.join(artifactsDir, `chat-startup-restore-${phase}.png`);

  const startedAt = Date.now();
  const marks = [];
  const mark = (label) => marks.push({ ms: Date.now() - startedAt, label });
  const states = {};
  const observations = {};

  const writeReport = (extra = {}) => {
    const report = {
      phase,
      ranAt: new Date().toISOString(),
      world: {
        dir: world.dir,
        hermesHome: world.hermesHome,
        userData: world.userData,
        profile: world.profile,
      },
      rendererUrl,
      chat,
      marks,
      states,
      observations,
      gateway: {
        logFile: gateway?.logFile ?? null,
        requests: gateway?.state.requests ?? [],
        sessionsListed: gateway?.state.sessionsListed ?? 0,
        messagesRead: gateway?.state.messagesRead ?? 0,
      },
      screenshots: fs.existsSync(screenshotPath) ? [path.basename(screenshotPath)] : [],
      checks,
      failures,
      pass: failures.length === 0,
      ...extra,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };

  let gateway = null;
  let win = null;

  const timeout = setTimeout(() => {
    writeReport({ timedOut: true });
    console.error(`[chat-startup-restore:${phase}] timed out after 120s`);
    app.exit(1);
  }, 120_000);

  try {
    // ── The world, before anything imports the main process ────────────────
    /**
     * Capture what the window is showing NOW.
     *
     * The bench keeps another app on the same display, so this window is
     * occluded, and an occluded Chromium window that has never presented a new
     * frame answers `capturePage` with the last one it did — the artifact then
     * shows the splash or the blank slate the report says is gone. So the window
     * is raised once at boot (below), and the capture forces a renderer frame,
     * warms the capturer (whose first answer may be the frame from before the
     * raise), waits for the compositor to swap, then takes the real capture.
     * `stayHidden` is deliberately NOT set: when it is, the page is kept hidden
     * and the capture can come back with a frame older than the DOM.
     */
    const screenshotOf = async () => {
      await win.webContents
        .executeJavaScript(
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))))",
          true,
        )
        .catch(() => {});
      await win.webContents.capturePage().catch(() => null);
      await sleep(600);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
      return image.toPNG().length;
    };

    gateway = await serveGateway(world);
    writeHostEnv(world, gateway.port);

    process.env.HERMES_HOME = world.hermesHome;
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
    process.env.VITE_DEV_SERVER_URL = rendererUrl;
    process.env.LIFEQUEST_E2E = JSON.stringify({
      userData: world.userData,
      showWindow: true,
      mcpPorts: world.mcpPorts,
    });
    delete process.env.ELECTRON_RUN_AS_NODE;

    // Belt as well as braces: the e2e seam in the main bundle points the app at
    // `world.userData`, but the rig sets it itself before the main process is
    // imported, so a production bundle (no seam) can never open the operator's
    // real profile either.
    app.setPath("userData", world.userData);

    mark("boot:main-ready");
    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    win = await bootForE2e();
    mark("boot:window");
    // The bench app shares this display: raise the product's own window so its
    // compositor keeps presenting frames, and the capture below is of what the
    // page shows now rather than whatever it last presented while occluded.
    try {
      win.setAlwaysOnTop(true, "screen-saver");
      win.showInactive();
      win.moveTop();
    } catch {
      // A window that cannot be raised is still a window with a DOM.
    }

    // ── The dock is mounted: the app attached and the vault opened ─────────
    const shellUp = await waitFor(
      win,
      `Boolean(document.querySelector(".shell, .app-shell"))`,
      90_000,
    );
    check("the app opened its shell against the stub gateway", shellUp);
    if (!shellUp) {
      const body = await win.webContents
        .executeJavaScript(`document.body.innerText.slice(0, 400)`, true)
        .catch(() => "");
      mark(`shell-missing: ${String(body).slice(0, 160)}`);
      throw new Error("the shell never mounted; the connect screen stayed up");
    }
    await waitFor(win, `Boolean(document.querySelector(".chats-rail"))`, 30_000);
    const dockUp = await waitFor(win, `Boolean(document.querySelector(".chat-panel"))`, 30_000);
    check("the chat dock is on screen", dockUp);
    if (!dockUp) throw new Error("the chat panel never mounted");

    // ── Wait for the launch to settle, then read what is on screen ─────────
    // Wait for the transcript itself, not for the empty slate: the slate is
    // painted the moment the thread has no chat in front, which is the bug's own
    // first frame, and settling on it would sample a good launch mid-read. 15s
    // is far longer than a transcript read takes when it is issued at all; the
    // bug is not slow, it is absent.
    // The splash is an overlay over the whole app; a capture taken while it is
    // still compositing is a picture of the splash, not of the thread.
    await waitFor(
      win,
      `(() => {
        const splash = document.getElementById("splash");
        if (!splash) return true;
        const style = window.getComputedStyle(splash);
        return (
          splash.hasAttribute("hidden") ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity || "1") <= 0.01
        );
      })()`,
      10_000,
    );
    mark("wait:transcript");
    const transcriptPainted = await waitFor(
      win,
      `document.querySelectorAll(".chat-panel__message").length > 0`,
      15_000,
    );

    const state = await win.webContents.executeJavaScript(SAMPLE(world), true);
    states[phase] = state;
    mark("sample:done");

    // The gateway as it stood when the screen was sampled: the verify phase's
    // "read before any interaction" claim has to be a fact about THIS moment,
    // not about the end of the phase (the workaround control below talks to the
    // gateway afterwards, on purpose).
    observations.gatewayBeforeInteraction = {
      at: new Date().toISOString(),
      requests: gateway.state.requests.map((request) => ({ ...request })),
      sessionsListed: gateway.state.sessionsListed,
      messagesRead: gateway.state.messagesRead,
    };

    const strip = readStoredStrip(state);
    const transcriptOnScreen = screenHasTranscript(state, chat);
    const messagesRequested = gateway.state.messagesRead > 0;

    if (isSeed) {
      // ── What a first launch on an empty memory did (the control, recorded) ─
      //
      // On unfixed code the first launch is broken by the SAME race: the dock's
      // landing is voided by the first harness answer, no list read completes,
      // no transcript is read, and nothing is remembered. That is a fact worth
      // keeping in the artifact — it says the fault is not restore-specific —
      // but it is not what this rig gates on: the operator's report is the
      // restart, and the verify phase is the assertion. If it ever stops being
      // true (because the mount lands, as it must after the fix), the
      // observation flips to true and the fixture write below is skipped.
      observations.firstLaunch = {
        transcriptPainted,
        messagesRead: gateway.state.messagesRead,
        sessionsListed: gateway.state.sessionsListed,
        emptySlate: state.emptySlate,
        heading: state.heading,
        rememberedStrip: state.storedStrip ?? state.legacyStrip,
      };

      check(
        "the sidebar lists the gateway's chat",
        state.railLabels.includes(chat.title),
        `rail: ${JSON.stringify(state.railLabels)}`,
      );

      // The fixture: the memory an operator has after using the app on a
      // working build. Usually the landing itself writes it (post-fix); when it
      // cannot (pre-fix nothing is ever remembered) the rig writes the two keys
      // the product writes, so the restart has the state the report is about.
      // This is the precondition, not the behavior under test.
      if (!stripMatches(strip, state, chat)) {
        mark("seed:write-strip-fixture");
        await win.webContents.executeJavaScript(
          `(() => {
            window.localStorage.setItem(
              "lifequest.companion.openTabs." + ${JSON.stringify(world.vaultId)} + ".hermes",
              ${JSON.stringify(JSON.stringify({ tabs: [chat.id], activeId: chat.id }))},
            );
            window.localStorage.setItem(
              "lifequest.companion.lastSessionId." + ${JSON.stringify(world.vaultId)},
              ${JSON.stringify(chat.id)},
            );
            return true;
          })()`,
          true,
        );
        observations.seededStripDirectly = true;
      } else {
        observations.seededStripDirectly = false;
      }

      const remembered = await win.webContents.executeJavaScript(SAMPLE(world), true);
      states.seedRemembered = remembered;
      check(
        "the restart's remembered strip is in the profile",
        stripMatches(readStoredStrip(remembered), remembered, chat),
        `stored strip ${remembered.storedStrip}, legacy ${remembered.legacyStrip}, lastSessionId ${remembered.lastSessionId}`,
      );

      await screenshotOf();
      // The restart is only a restart if storage really reached disk; flush it
      // the way a quit does instead of trusting the next process to find it.
      mark("seed:flush");
      await win.webContents.session.flushStorageData();
    } else {
      // ── The restart: remembered strip, and the transcript with it ─────────
      check(
        "the restart found the remembered strip in the profile",
        strip?.tabs.join(",") === chat.id && strip?.activeId === chat.id,
        `stored strip ${state.storedStrip}, legacy ${state.legacyStrip}`,
      );
      check(
        "the remembered chat is the chat in the tab strip",
        state.tabCount === 1 &&
          state.tabs[0]?.label === chat.title &&
          state.tabs[0]?.active === true,
        `tabs: ${JSON.stringify(state.tabs)}`,
      );
      check(
        "the restored tab is the dialog in front",
        state.surface === "thread" &&
          state.heading === chat.title &&
          state.thread === true,
        `surface ${state.surface}, heading ${JSON.stringify(state.heading)}, thread header ${state.thread}`,
      );
      // The reported bug, stated twice: the wire and the screen. A screen-only
      // assertion could be satisfied by a cached paint; a wire-only one could be
      // a request whose answer never arrived.
      check(
        "the launch read the restored chat's transcript before any interaction",
        messagesRequested,
        `messages requests: ${gateway.state.messagesRead}; requests: ${JSON.stringify(
          gateway.state.requests.map((request) => `${request.method} ${request.path}`),
        )}`,
      );
      check(
        "the restored conversation is on screen, not the empty slate",
        transcriptOnScreen && state.emptySlate === "",
        `screen held ${screenSummary(state)}`,
      );
      await screenshotOf();

      // ── The control against a blind instrument ────────────────────────────
      //
      // Everything above was sampled before the operator touched anything. This
      // is the operator's own workaround, run AFTER that sample and screenshot:
      // re-open the chat from the sidebar (the gesture that calls `openChat` →
      // `loadMessages`). If the transcript appears now, the blank above was the
      // launch losing the read — not this rig failing to see transcripts. It is
      // an observation, never a gate: a fix that makes the launch land should
      // make this unnecessary, and a rig that required the workaround would
      // accept the bug.
      mark("verify:workaround");
      const clickDelivered = await win.webContents.executeJavaScript(
        `(() => {
          const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
            (li) => ((li.querySelector(".chats-rail__label") || {}).textContent || "").trim() === ${JSON.stringify(chat.title)},
          );
          const button = row?.querySelector(".chats-rail__row-main");
          if (!button) return false;
          button.click();
          return true;
        })()`,
        true,
      );
      const recovered = clickDelivered
        ? await waitFor(win, `document.querySelectorAll(".chat-panel__message").length > 0`, 5_000)
        : false;
      const afterWorkaround = await win.webContents.executeJavaScript(SAMPLE(world), true);
      states.verifyAfterWorkaround = afterWorkaround;
      observations.afterReopeningTheChat = {
        clickDelivered,
        transcriptPainted: recovered,
        gateway: {
          sessionsListed: gateway.state.sessionsListed,
          messagesRead: gateway.state.messagesRead,
        },
        screen: {
          messageCount: afterWorkaround.messageCount,
          emptySlate: afterWorkaround.emptySlate,
          contents: afterWorkaround.messages.map((message) => message.content),
        },
      };
    }

    const bytes = fs.statSync(screenshotPath).size;
    check(
      "the screenshot is a real picture of the app",
      bytes > 10 * 1024,
      `${screenshotPath} is ${bytes} bytes`,
    );
    mark("screenshot:done");
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    try {
      if (win) {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(screenshotPath, image.toPNG());
      }
    } catch {
      // A screenshot is evidence, not a reason to lose the report.
    }
  } finally {
    clearTimeout(timeout);
  }

  const report = writeReport();
  if (gateway) await gateway.close().catch(() => {});
  console.log(`${isSeed ? "chat-startup-restore seed" : "chat-startup-restore verify"}: ${report.pass ? "pass" : "fail"}`);
  for (const failure of failures) console.error(`FAIL ${failure}`);
  app.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
