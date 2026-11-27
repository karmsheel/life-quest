/**
 * The stale-chat repair rig: an EXISTING Hermes chat locked to a model the
 * profile no longer offers must show the dock's repair notice, and one click
 * must move the gateway's session lock and answer the next turn.
 *
 * WHY THIS RIG EXISTS
 *
 * The operator reported that in the studio every EXISTING chat stopped
 * answering while a brand-new chat worked. Hermes locks a chat's session to the
 * model it was created with and ignores the app's per-turn model; when the
 * provider retires that model, every turn in the old chat fails before a model
 * call. A new chat works because it is created on the current default.
 *
 * The fix (the Lead builds it in parallel) is a dock notice for the active chat
 * whose gateway model is absent from `GET /api/model/options`, and one click
 * that persists the profile's working default through the gateway's own
 * `POST /api/sessions/{id}/model`. This rig is the proof, driven through the
 * REAL main process, preload bridge and renderer — not a page mock.
 *
 * THE WORLD IS HERMETIC
 *
 * `tests/stale-chat-model-e2e.test.ts` builds a throwaway world (temp
 * `HERMES_HOME` with profile `lq-stale-model-e2e`, a throwaway vault, a
 * userData dir, and a stub `hermes` first on PATH) and writes `world.json`. This
 * driver starts a loopback stub of the Hermes host gateway, points the profile's
 * `.env` at it, then boots the app through the same `bootForE2e` seam every
 * full-app rig uses. The stub serves exactly one chat, locked to
 * `retired/old-model:free`, while the model catalog offers only `live/model`:
 *
 *   GET  /health                                 → the attach probe
 *   GET  /v1/capabilities                        → the feature list
 *   GET  /api/sessions?limit=200                 → one row, locked to the retired model
 *   GET  /api/sessions/chat-stale/messages       → the two-message transcript
 *   GET  /api/model/options                      → providers: [{slug:"nous", models:["live/model"]}], current live/model
 *   POST /api/sessions/chat-stale/model          → appends the body to model-lock-requests.log, accepts the lock
 *   POST /api/sessions/chat-stale/chat/stream    → appends the body to chat-stream-requests.log, streams one answer
 *   any other /api/...                           → 200 {} (probes never wedge)
 *
 * The stub is stateful where a real gateway is: once it accepts the model lock,
 * the session list it serves reports the new model, and once it streams a turn,
 * the transcript it serves includes that turn. A repair that only paints over
 * the notice locally would still pass the screen check here, so the artifact
 * also carries the gateway's own wire logs: exactly one lock POST whose parsed
 * body is `{"model":"live/model","provider":"nous"}`, and exactly one stream
 * POST carrying the typed text.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The app never attaches to the stub gateway: the connect screen stays, no
 *      dock mounts and the notice is never rendered. The rig requires the shell,
 *      the rail, the chat row and the dock, and says "never attached" in the
 *      failure list instead of passing silently.
 *   2. The notice is asserted from a stale DOM: it is matched by
 *      `[data-testid="chat-model-repair"]` AND required to have a real box, no
 *      `[hidden]` ancestor, and non-zero opacity, and the report keeps its raw
 *      text so the judge can re-read the wording.
 *   2b. The notice scrolls out of sight on a long chat: the placement bug this
 *      artifact also guards. It must sit in the dock footer above the composer
 *      (a `[class*="footer"]` ancestor) and must NOT be inside
 *      `.chat-panel__body`, the thread's scroll port; both facts are recorded in
 *      `observations.bannerPlacement` / `observations.bannerHost`.
 *   3. The notice appears for every chat regardless of the stale lock: the
 *      scenario is only a stale chat (the gateway serves no other), so the rig
 *      additionally requires the catalog (which offers only `live/model`) and
 *      the notice naming the FULL retired id (`retired/old-model:free`) with the
 *      one-click labelled with the full default id (`Use live/model`).
 *   4. The click only hides the banner locally and never writes the lock: the
 *      rig reads `model-lock-requests.log` and the gateway's in-memory record,
 *      and fails unless there is EXACTLY ONE line whose parsed body is
 *      `{model:"live/model",provider:"nous"}`.
 *   5. The banner disappears for an unrelated reason (a re-render, an error
 *      banner, the dock closing): the disappearance is only accepted together
 *      with the accepted lock, and the post-click sample is kept in the report.
 *   6. The chat only answer because the app sends a per-turn model override: the
 *      stub ignores `model` on the chat body, exactly as Hermes locks the
 *      session, so a green answer requires the session lock to have moved (the
 *      stream is only answered after the lock is accepted; a stream POST before
 *      the lock would be answered with an error frame and recorded).
 *   7. The typed turn never reaches the gateway: the rig requires exactly one
 *      `chat-stream-requests.log` line whose body's `input`/`instructions`
 *      carry the typed text, before it accepts the painted reply.
 *   8. The reply painted from the fixture rather than the stream: the fixture
 *      transcript is "Last month closed even."; only the stream carries "The
 *      ledger is settled, sir.", so the painted reply can only come from the
 *      turn. (The fixture is deliberately different text.)
 *   9. The screenshot is stale, blank or of another window (the bench keeps
 *      another app on this display). It is this window's own `capturePage()`
 *      after a forced repaint and a raise, and must be >10 KB
 *      (`e2e/artifacts/stale-chat-model.png`; a second capture with the notice
 *      up is kept beside it).
 *  10. The test passes by skipping: this driver must actually run and write
 *      `e2e/artifacts/stale-chat-model.json`; the wrapper asserts the artifact,
 *      the exit code and every check.
 *
 * Run by `tests/stale-chat-model-e2e.test.ts`:
 *
 *   LQ_STALE_WORLD=<dir> VITE_DEV_SERVER_URL=<url> <electron> e2e/stale-chat-model.electron.mjs
 *
 * Exit 0 = every check held. The report records the contract the shipped
 * renderer actually used: the notice names the full retired id in the dock
 * footer above the composer (not inside the thread's scroll port), the
 * one-click is labelled with the full default id, and the shipped composer
 * sends on Ctrl/Cmd+Enter rather than plain Enter — so a wording or placement
 * drift is visible in the artifact instead of being silently absorbed.
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

const REPORT_NAME = "stale-chat-model.json";
const SCREENSHOT_NAME = "stale-chat-model.png";
const BEFORE_SCREENSHOT_NAME = "stale-chat-model-before.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;

/** Where the app loads the renderer. The bench's dev server serves this checkout. */
const DEV_SERVER_URL =
  process.env.LQ_STALE_URL ??
  process.env.VITE_DEV_SERVER_URL ??
  "http://127.0.0.1:5173";

/** The timings this rig waits on. Nothing here is a product bound. */
const READY_TIMEOUT_MS = 90_000;
const LIST_TIMEOUT_MS = 60_000;
const BANNER_TIMEOUT_MS = 25_000;
const LOCK_TIMEOUT_MS = 15_000;
const REPAIR_GONE_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 8_000;
const REPLY_TIMEOUT_MS = 20_000;

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

/** The world the test built: paths, the one chat, the current default, the turn. */
function readWorld() {
  const worldDir = process.env.LQ_STALE_WORLD;
  if (!worldDir) {
    throw new Error(
      "LQ_STALE_WORLD is required — run this through tests/stale-chat-model-e2e.test.ts",
    );
  }
  const file = path.join(worldDir, "world.json");
  if (!fs.existsSync(file)) throw new Error(`no world.json in ${worldDir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Read a JSON-lines wire log, ignoring a torn tail. */
function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ unparsed: line });
    }
  }
  return rows;
}

/**
 * The stub Hermes host gateway.
 *
 * Matched on the tail of the path because the app talks to the profile base
 * (`/p/<profile>/api/...`); the rig's own prefix is not part of what is being
 * tested. The gateway's state is held in memory for the report AND written to
 * the world as one JSON line per request/body for the artifact trail.
 */
function serveGateway(world) {
  const chat = world.chat;
  const turn = world.turn;
  const defaultModel = world.defaultModel;
  const defaultProvider = world.defaultProvider;

  const state = {
    requests: [],
    sessionsListed: 0,
    messagesRead: 0,
    modelLockRequests: [],
    streamRequests: [],
    /** The lock the gateway serves from now on (a real lock moves the session). */
    sessionModel: chat.retiredModel,
    /** The transcript the gateway serves; the accepted turn is appended to it. */
    transcript: [
      { role: "user", content: chat.userText },
      { role: "assistant", content: chat.assistantText },
    ],
  };

  const logFile = path.join(world.dir, "gateway-requests.log");
  const lockFile = path.join(world.dir, "model-lock-requests.log");
  const streamLogFile = path.join(world.dir, "chat-stream-requests.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  // Fresh world, fresh wire logs: "exactly one line" must mean this run's lines.
  fs.writeFileSync(lockFile, "");
  fs.writeFileSync(streamLogFile, "");
  fs.appendFileSync(
    logFile,
    `${JSON.stringify({ at: new Date().toISOString(), event: "gateway-started" })}\n`,
  );

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
          resolve({ unparsed: raw });
        }
      });
    });

  /** The session row the list serves, with whatever lock the gateway now holds. */
  const rowFor = () => {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      id: chat.id,
      source: "api_server",
      model: state.sessionModel,
      title: chat.title,
      preview: chat.preview,
      started_at: nowSec - 600,
      last_active: nowSec - 60,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: state.transcript.length,
      is_internal_child: false,
    };
  };

  const sseFrames = [
    `event: run.started\ndata: ${JSON.stringify({ run_id: "run-1", session_id: chat.id })}`,
    `event: assistant.completed\ndata: ${JSON.stringify({
      session_id: chat.id,
      content: turn.reply,
      completed: true,
      partial: false,
      interrupted: false,
      run_id: "run-1",
    })}`,
    `event: run.completed\ndata: ${JSON.stringify({ session_id: chat.id, run_id: "run-1" })}`,
    `event: done\ndata: ${JSON.stringify({ session_id: chat.id, run_id: "run-1" })}`,
  ].join("\n\n");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const json = (payload, status = 200) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(payload));

    state.requests.push({ at: Date.now(), method, path: url.pathname, search: url.search });
    fs.appendFileSync(
      logFile,
      `${JSON.stringify({ at: new Date().toISOString(), method, path: url.pathname + url.search })}\n`,
    );

    if (url.pathname.endsWith("/health")) {
      json({});
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
        providers: [
          {
            slug: defaultProvider,
            name: "Nous Portal",
            is_current: true,
            is_user_defined: false,
            authenticated: true,
            models: [defaultModel],
            capabilities: {},
          },
        ],
        model: defaultModel,
        provider: defaultProvider,
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
      json({ object: "hermes.messages", messages: state.transcript });
      return;
    }

    const modelMatch = /\/api\/sessions\/([^/]+)\/model$/.exec(url.pathname);
    if (modelMatch && method === "POST") {
      const id = decodeURIComponent(modelMatch[1]);
      const body = await readBody(req);
      state.modelLockRequests.push({ at: Date.now(), path: url.pathname, body });
      fs.appendFileSync(lockFile, `${JSON.stringify(body)}\n`);
      if (id !== chat.id) {
        json({ error: { message: "not_found", code: "session_not_found" } }, 404);
        return;
      }
      if (typeof body?.model === "string" && body.model.trim()) {
        // The accepted lock is what the session now reports. This is the honest
        // gateway simulation: a list read after the click does not resurrect the
        // retired model, so the banner's absence is not an artifact of a stale
        // response the rig withheld.
        state.sessionModel = body.model.trim();
      }
      json({
        object: "hermes.session.model_lock",
        session_id: chat.id,
        runtime: {
          provider: typeof body?.provider === "string" ? body.provider : "",
          model: typeof body?.model === "string" ? body.model : "",
          route_source: "raw_request",
          model_lock: "accepted",
        },
      });
      return;
    }

    const streamMatch = /\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(url.pathname);
    if (streamMatch && method === "POST") {
      const id = decodeURIComponent(streamMatch[1]);
      const body = await readBody(req);
      state.streamRequests.push({ at: Date.now(), path: url.pathname, body });
      fs.appendFileSync(streamLogFile, `${JSON.stringify(body)}\n`);
      if (id !== chat.id) {
        json({ error: { message: "not_found", code: "session_not_found" } }, 404);
        return;
      }
      // Hermes serves an existing chat on the model its session was created
      // with; the per-turn body cannot move it. So the turn only succeeds once
      // the lock has moved — which is exactly the fault under test.
      if (state.sessionModel === chat.retiredModel) {
        // Refuse the way a retired model fails: no answer, an error frame.
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.end(
          `event: run.started\ndata: {"run_id":"run-refused","session_id":${JSON.stringify(chat.id)}}\n\n` +
            `event: error\ndata: {"message":"model not available: ${chat.retiredModel}","session_id":${JSON.stringify(chat.id)}}\n\n`,
        );
        return;
      }
      // The gateway has stored the turn by the time the stream answers: append
      // it so a later transcript read (a repair that re-reads, a reopen) shows
      // the operator's own words and the reply.
      state.transcript.push({ role: "user", content: turn.userText });
      state.transcript.push({ role: "assistant", content: turn.reply });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.end(`${sseFrames}\n\n`);
      return;
    }

    if (url.pathname.endsWith("/api/sessions")) {
      if (method === "GET") {
        state.sessionsListed += 1;
        json({
          object: "hermes.sessions",
          sessions: [rowFor()],
          limit: 200,
          offset: 0,
          has_more: false,
        });
        return;
      }
      if (method === "POST") {
        await readBody(req);
        json({ object: "hermes.session", session: rowFor() }, 201);
        return;
      }
    }

    const sessionMatch = /\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && (method === "PATCH" || method === "DELETE")) {
      const body = await readBody(req);
      if (method === "DELETE") {
        json({ object: "hermes.session.deleted", id: decodeURIComponent(sessionMatch[1]) });
        return;
      }
      json({ object: "hermes.session", session: { ...rowFor(), ...body } });
      return;
    }

    // Every other probe: 200 {} so list/ensure/probe paths never wedge.
    json({});
  });

  return listen(server).then((port) => ({
    port,
    state,
    logFile,
    lockFile,
    streamLogFile,
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
 * Deliberately reads the rendered DOM rather than any store: "the notice is on
 * screen", "the reply is painted" are claims about what the operator sees.
 */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const visible = (el) => {
    if (!el) return false;
    if (el.closest("[hidden]")) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || "1") <= 0.01
    ) {
      return false;
    }
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const bannerEl = document.querySelector('[data-testid="chat-model-repair"]');
  const buttonEl = document.querySelector('[data-testid="chat-model-repair-use-default"]');
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
  const composer = document.querySelector(".chat-panel__composer-input");
  const send = document.querySelector(".chat-panel__send");
  return {
    t: performance.now(),
    shell: Boolean(document.querySelector(".shell, .app-shell")),
    dock: Boolean(document.querySelector(".chat-panel")),
    surface: document.querySelector(".chat-panel")?.getAttribute("data-chat-surface") ?? null,
    tabs,
    activeTab: (tabs.find((tab) => tab.active) || {}).label ?? null,
    heading: text(document.querySelector(".chat-panel__heading--thread")),
    emptySlate: text(document.querySelector(".chat-panel__empty-title")),
    railLabels: Array.from(document.querySelectorAll(".chats-rail__label")).map(text).filter(Boolean),
    messages,
    transcript: messages.map((message) => message.content).join("\\n"),
    banner: {
      present: Boolean(bannerEl),
      visible: visible(bannerEl),
      text: text(bannerEl),
      // The notice is dock chrome, not transcript: it must sit in the dock's
      // footer above the composer, under the scroll port, so a long conversation
      // cannot scroll the one explanation (and its one click) out of sight. The
      // regression guard is insideScrollBody:false — the reported placement
      // bug was the notice living inside the chat-panel body scroll port.
      hostClass: bannerEl?.closest('[class*="footer"]')?.className ?? null,
      inFooter: Boolean(bannerEl?.closest('[class*="footer"]')),
      insideScrollBody: Boolean(bannerEl?.closest(".chat-panel__body")),
      button: Boolean(buttonEl),
      buttonVisible: visible(buttonEl),
      buttonLabel: text(buttonEl),
      buttonDisabled: buttonEl ? buttonEl.disabled === true : null,
    },
    composer: {
      present: Boolean(composer),
      disabled: composer ? composer.disabled === true : null,
      ariaLabel: composer ? composer.getAttribute("aria-label") : null,
      value: composer ? composer.value : null,
    },
    send: {
      present: Boolean(send),
      state: send ? send.getAttribute("data-state") : null,
      label: send ? send.getAttribute("aria-label") : null,
      disabled: send ? send.disabled === true : null,
    },
    errorBanners: Array.from(document.querySelectorAll('.chat-panel__error[role="alert"]')).map(
      (node) => text(node),
    ),
  };
})()`;

/** What the screen held, for a failure message that names the real state. */
const screenSummary = (state) =>
  JSON.stringify({
    shell: state?.shell,
    dock: state?.dock,
    surface: state?.surface,
    activeTab: state?.activeTab,
    heading: state?.heading,
    emptySlate: state?.emptySlate,
    rail: state?.railLabels,
    banner: state?.banner,
    messages: state?.messages?.map((message) => message.content),
    composer: state?.composer,
    errors: state?.errorBanners,
  });

/** The retired model's short label, the way the shipped renderer derives it. */
const shortModelLabel = (model) => {
  const id = String(model ?? "").trim();
  const slash = id.lastIndexOf("/");
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  return tail.replace(/:free$/, "") || id;
};

/** Does this on-screen text name the chat's retired model (full id or short label)? */
const namesRetiredModel = (text, chat) => {
  const value = String(text ?? "");
  return (
    value.includes(chat.retiredModel) ||
    value.includes(shortModelLabel(chat.retiredModel))
  );
};

const activeTabExpression = (title) => `(() => {
  const tab = Array.from(document.querySelectorAll(".chat-panel__tab")).find(
    (node) => node.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true",
  );
  if (!tab) return false;
  return ((tab.querySelector(".chat-panel__tab-label")?.textContent) || "").trim() === ${JSON.stringify(title)};
})()`;

const clickRowExpression = (title) => `(() => {
  const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
    (li) => ((li.querySelector(".chats-rail__label")?.textContent) || "").trim() === ${JSON.stringify(title)},
  );
  const button = row?.querySelector(".chats-rail__row-main");
  if (!button) return false;
  button.click();
  return true;
})()`;

const rowListedExpression = (title) => `(() => {
  return Array.from(document.querySelectorAll(".chats-rail__label")).some(
    (label) => ((label.textContent) || "").trim() === ${JSON.stringify(title)},
  );
})()`;

const bannerVisibleExpression = `(() => {
  const el = document.querySelector('[data-testid="chat-model-repair"]');
  if (!el) return false;
  if (el.closest("[hidden]")) return false;
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity || "1") <= 0.01
  ) {
    return false;
  }
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
})()`;

const replyExpression = (reply) => `(() => {
  return Array.from(document.querySelectorAll(".chat-panel__message-content")).some(
    (el) => ((el.textContent) || "").includes(${JSON.stringify(reply)}),
  );
})()`;

/** Put a draft in the dock's composer the way a person would. */
const typeDraftExpression = (text) => `(async () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) return { ok: false, reason: "no composer" };
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  el.focus();
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    if (el.value === ${JSON.stringify(text)}) return { ok: true, value: el.value };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { ok: false, reason: "the composer did not take the draft", value: el.value };
})()`;

/**
 * Send with the SHIPPED gesture: Ctrl+Enter. The composer's plain Enter is a
 * newline by design (a prompt is a paragraph, not a telegram); the brief's
 * "Enter sends" is the older gesture. The rig records which gesture it used and
 * the answered turn is the assertion either way.
 */
const sendWithCtrlEnterExpression = `(async () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) return { ok: false, reason: "no composer" };
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
  );
  return { ok: true };
})()`;

/** The fallback the brief names: plain Enter on the focused composer. */
const sendWithEnterExpression = `(async () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) return { ok: false, reason: "no composer" };
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  return { ok: true };
})()`;

/** Last-resort gesture: the shipped send control. */
const clickSendExpression = `(async () => {
  const button = document.querySelector('.chat-panel__send[data-state="send"]');
  if (!button) return { ok: false, reason: "no send control" };
  if (button.disabled) return { ok: false, reason: "the send control is disabled" };
  button.click();
  return { ok: true };
})()`;

const clickRepairExpression = `(() => {
  const button = document.querySelector('[data-testid="chat-model-repair-use-default"]');
  if (!button) return false;
  if (button.disabled) return false;
  button.click();
  return true;
})()`;

/** Poll the rendered app until `expression` returns true. */
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

/** Poll the rig's own gateway state (main-process memory) until `accept` says yes. */
async function waitForGateway(accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (accept()) return true;
    await sleep(50);
  }
  return accept();
}

async function main() {
  const reportPath = path.join(artifactsDir, REPORT_NAME);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const world = readWorld();
  const chat = world.chat;

  const startedAt = Date.now();
  const marks = [];
  const mark = (label) => marks.push({ ms: Date.now() - startedAt, label });
  const states = {};
  const observations = {};

  let gateway = null;
  let win = null;

  const writeReport = (extra = {}) => {
    const modelLockLines = gateway ? readJsonLines(gateway.lockFile) : [];
    const streamLogLines = gateway ? readJsonLines(gateway.streamLogFile) : [];
    const report = {
      ranAt: new Date().toISOString(),
      world: {
        dir: world.dir,
        hermesHome: world.hermesHome,
        userData: world.userData,
        profile: world.profile,
      },
      rendererUrl: DEV_SERVER_URL,
      chat,
      defaultModel: world.defaultModel,
      defaultProvider: world.defaultProvider,
      turn: world.turn,
      marks,
      states,
      observations,
      contract: {
        bannerTestId: "chat-model-repair",
        buttonTestId: "chat-model-repair-use-default",
        bannerText: states.beforeRepair?.banner?.text ?? null,
        buttonLabel: states.beforeRepair?.banner?.buttonLabel ?? null,
        bannerHost: observations.bannerHost ?? null,
        defaultModelShortLabel: shortModelLabel(world.defaultModel),
        sendGesture: observations.sendGesture ?? null,
      },
      gateway: gateway
        ? {
            port: gateway.port,
            logFile: gateway.logFile,
            requests: gateway.state.requests,
            sessionsListed: gateway.state.sessionsListed,
            messagesRead: gateway.state.messagesRead,
            modelLockRequests: gateway.state.modelLockRequests,
            streamRequests: gateway.state.streamRequests,
            sessionModelServedAfterLock: gateway.state.sessionModel,
            transcriptServed: gateway.state.transcript,
            modelLockLogFile: gateway.lockFile,
            modelLockLogLines: modelLockLines,
            streamLogFile: gateway.streamLogFile,
            streamLogLines,
          }
        : null,
      screenshots: [
        ...(fs.existsSync(path.join(artifactsDir, SCREENSHOT_NAME)) ? [SCREENSHOT_NAME] : []),
        ...(fs.existsSync(path.join(artifactsDir, BEFORE_SCREENSHOT_NAME))
          ? [BEFORE_SCREENSHOT_NAME]
          : []),
      ],
      checks,
      failures,
      pass: failures.length === 0,
      ...extra,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };

  const timeout = setTimeout(() => {
    writeReport({ timedOut: true });
    console.error("[stale-chat-model] timed out after 120s");
    app.exit(1);
  }, 120_000);

  try {
    /**
     * Capture what the window is showing NOW.
     *
     * The bench keeps another app on the same display, so this window is
     * occluded, and an occluded Chromium window that has never presented a new
     * frame answers `capturePage` with the last one it did — the artifact then
     * shows the splash or the blank slate the report says is gone. So the window
     * is raised once at boot (below), and the capture forces a renderer frame,
     * warms the capturer, waits for the compositor to swap, then takes the real
     * capture.
     */
    const screenshotOf = async (name) => {
      const file = path.join(artifactsDir, name);
      await win.webContents
        .executeJavaScript(
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))))",
          true,
        )
        .catch(() => {});
      await win.webContents.capturePage().catch(() => null);
      await sleep(600);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      return fs.statSync(file).size;
    };

    gateway = await serveGateway(world);
    writeHostEnv(world, gateway.port);

    process.env.HERMES_HOME = world.hermesHome;
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
    process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
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
    try {
      win.setAlwaysOnTop(true, "screen-saver");
      win.showInactive();
      win.moveTop();
    } catch {
      // A window that cannot be raised is still a window with a DOM.
    }
    const js = (code) => win.webContents.executeJavaScript(code, true);

    // ── 1. The app attaches, and the stale chat is reachable ────────────────
    const shellUp = await waitFor(
      win,
      `Boolean(document.querySelector(".shell, .app-shell"))`,
      READY_TIMEOUT_MS,
    );
    check(
      "the app attached to the stub gateway and opened its shell",
      shellUp,
      shellUp ? null : "the connect screen stayed up; the dock has nothing to render",
    );
    if (!shellUp) {
      const body = await js(`document.body.innerText.slice(0, 400)`).catch(() => "");
      mark(`shell-missing: ${String(body).slice(0, 160)}`);
      throw new Error(
        "the app never attached to the stub gateway: the shell never mounted, so the stale-chat notice could not be tested",
      );
    }
    await waitFor(win, `Boolean(document.querySelector(".chats-rail"))`, 30_000);
    const dockUp = await waitFor(win, `Boolean(document.querySelector(".chat-panel"))`, 30_000);
    check("the chat dock is on screen", dockUp, dockUp ? null : "no .chat-panel mounted");
    if (!dockUp) throw new Error("the chat panel never mounted");

    // The chat row is how the operator reaches an existing chat. The landing may
    // already have opened it (the dock resumes the most recent chat); the rig
    // records which, then clicks the row if it did not.
    const rowListed = await waitFor(win, rowListedExpression(chat.title), LIST_TIMEOUT_MS);
    check(
      "the sidebar lists the gateway's existing chat",
      rowListed,
      `rail: ${JSON.stringify(await js(`Array.from(document.querySelectorAll(".chats-rail__label")).map((el) => (el.textContent || "").trim())`))}`,
    );
    if (!rowListed) {
      throw new Error(
        `the sidebar never listed "${chat.title}"; the sessions list did not reach the dock`,
      );
    }

    const landedOpen = await js(activeTabExpression(chat.title));
    if (!landedOpen) {
      const clicked = await js(clickRowExpression(chat.title));
      check(
        "the existing chat opens in the dock from its sidebar row",
        clicked,
        clicked ? null : reallyClickedDetail(await js(`document.querySelectorAll(".chats-rail__row").length`)),
      );
      await waitFor(win, activeTabExpression(chat.title), 20_000);
    }
    observations.openedBy = landedOpen ? "landing" : "sidebar-row-click";
    const chatOpen = await waitFor(
      win,
      `(() => {
        const tab = Array.from(document.querySelectorAll(".chat-panel__tab")).find(
          (node) => node.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true",
        );
        if (!tab) return false;
        if (((tab.querySelector(".chat-panel__tab-label")?.textContent) || "").trim() !== ${JSON.stringify(chat.title)}) return false;
        const composer = document.querySelector(".chat-panel__composer-input");
        return Boolean(composer) && composer.disabled !== true;
      })()`,
      20_000,
    );
    check(
      `the "${chat.title}" chat is open in the dock, its tab in front`,
      chatOpen,
      `screen: ${screenSummary(await js(SAMPLE))}`,
    );
    if (!chatOpen) throw new Error(`"${chat.title}" never became the dock's open chat`);

    // The fixture transcript is read from the gateway; the notice is about the
    // chat's lock, not about a transcript read, but both must have landed.
    const transcriptPainted = await waitFor(
      win,
      `document.querySelectorAll(".chat-panel__message").length >= 2`,
      20_000,
    );
    check(
      "the existing chat's stored transcript is on screen",
      transcriptPainted,
      `screen: ${screenSummary(await js(SAMPLE))}`,
    );

    // ── 2. The repair notice, naming the retired model ──────────────────────
    mark("wait:repair-banner");
    const bannerUp = await waitFor(win, bannerVisibleExpression, BANNER_TIMEOUT_MS);
    const stateBeforeRepair = await js(SAMPLE);
    states.beforeRepair = stateBeforeRepair;
    check(
      "the dock shows the model-repair notice for the stale chat",
      bannerUp && stateBeforeRepair.banner.visible === true,
      `screen: ${screenSummary(stateBeforeRepair)}; gateway requests: ${JSON.stringify(
        gateway.state.requests.map((request) => `${request.method} ${request.path}`),
      )}`,
    );
    check(
      "the notice names the chat's retired model",
      namesRetiredModel(stateBeforeRepair.banner.text, chat),
      `notice text: ${JSON.stringify(stateBeforeRepair.banner.text)}; expected ${JSON.stringify(chat.retiredModel)}`,
    );
    check(
      "the notice offers the one-click default repair",
      stateBeforeRepair.banner.buttonVisible === true &&
        stateBeforeRepair.banner.buttonDisabled === false,
      `button: ${JSON.stringify(stateBeforeRepair.banner)}`,
    );
    // The placement regression guard. The notice is dock chrome, not transcript:
    // it lives in the dock footer directly above the composer, under the scroll
    // port. The reported placement bug is a notice inside `.chat-panel__body` —
    // the thread's scroll port — where a long chat scrolls the one explanation
    // (and its one click) out of sight and leaves "no answer" unexplained.
    check(
      "the repair notice sits in the dock footer above the composer",
      stateBeforeRepair.banner.inFooter === true,
      `banner host: ${JSON.stringify({
        hostClass: stateBeforeRepair.banner.hostClass,
        inFooter: stateBeforeRepair.banner.inFooter,
      })}`,
    );
    check(
      "the repair notice is not inside the scrollable thread body",
      stateBeforeRepair.banner.insideScrollBody === false,
      `banner host class: ${JSON.stringify(stateBeforeRepair.banner.hostClass)}; ` +
        "the notice is inside .chat-panel__body, so a long chat scrolls the explanation out of sight",
    );
    // The final copy contract: the full retired id in the notice, and the full
    // default id on the one-click.
    check(
      "the notice names the full retired id and the button names the full default",
      stateBeforeRepair.banner.text.includes(chat.retiredModel) &&
        String(stateBeforeRepair.banner.buttonLabel).trim() === `Use ${world.defaultModel}`,
      `notice: ${JSON.stringify(stateBeforeRepair.banner.text)}; ` +
        `button: ${JSON.stringify(stateBeforeRepair.banner.buttonLabel)}; ` +
        `expected model ${JSON.stringify(chat.retiredModel)} and label ${JSON.stringify(`Use ${world.defaultModel}`)}`,
    );
    observations.contractWording = {
      // The shipped renderer names the model with the full gateway id and the
      // one-click with the full default id; both are recorded verbatim in the
      // artifact so a copy drift is visible instead of guessed at.
      bannerText: stateBeforeRepair.banner.text,
      bannerNamesFullModelId: String(stateBeforeRepair.banner.text).includes(chat.retiredModel),
      bannerNamesShortModelLabel: String(stateBeforeRepair.banner.text).includes(
        shortModelLabel(chat.retiredModel),
      ),
      buttonLabel: stateBeforeRepair.banner.buttonLabel,
      buttonNamesDefaultShortLabel: String(stateBeforeRepair.banner.buttonLabel).includes(
        shortModelLabel(world.defaultModel),
      ),
      buttonNamesFullDefaultId: String(stateBeforeRepair.banner.buttonLabel).includes(
        world.defaultModel,
      ),
      catalogRequested: gateway.state.requests.some((request) =>
        request.path.endsWith("/api/model/options"),
      ),
      bannerHost: stateBeforeRepair.banner.inFooter ? "footer" : "other",
    };
    // The dock chrome the notice hangs from, and the scroll port it must NOT be
    // inside — the placement fix this artifact is evidence for.
    observations.bannerHost = stateBeforeRepair.banner.inFooter ? "footer" : "other";
    observations.bannerPlacement = {
      hostClass: stateBeforeRepair.banner.hostClass,
      inFooter: stateBeforeRepair.banner.inFooter,
      insideScrollBody: stateBeforeRepair.banner.insideScrollBody,
    };
    await screenshotOf(BEFORE_SCREENSHOT_NAME);
    mark("screenshot:before-repair");

    // ── 3. One click writes the model lock, and the notice goes ─────────────
    const lockLinesBefore = readJsonLines(gateway.lockFile).length;
    check(
      "no model lock was written before the operator clicked",
      lockLinesBefore === 0,
      `${lockLinesBefore} line(s) in ${gateway.lockFile} before the click`,
    );

    const clickedRepair = await js(clickRepairExpression);
    check(
      "the repair button is clickable",
      clickedRepair,
      `banner: ${JSON.stringify(stateBeforeRepair.banner)}`,
    );
    const lockLanded = await waitForGateway(
      () => gateway.state.modelLockRequests.length >= 1,
      LOCK_TIMEOUT_MS,
    );
    const bannerGone = await waitFor(win, `!${bannerVisibleExpression}`, REPAIR_GONE_TIMEOUT_MS);
    // One settle beat: a second, duplicate save (if any) has time to land.
    await sleep(800);
    const stateAfterRepair = await js(SAMPLE);
    states.afterRepair = stateAfterRepair;
    const lockLines = readJsonLines(gateway.lockFile);
    const lockRequests = gateway.state.modelLockRequests;
    const lockBody = lockRequests[0]?.body ?? null;

    check(
      "clicking the repair writes exactly one model lock request",
      lockLanded && lockRequests.length === 1 && lockLines.length === 1,
      `requests: ${JSON.stringify(lockRequests)}; log lines: ${JSON.stringify(lockLines)}`,
    );
    check(
      "the model lock request names the profile's current model",
      JSON.stringify(lockBody) ===
        JSON.stringify({ model: world.defaultModel, provider: world.defaultProvider }),
      `sent ${JSON.stringify(lockBody)}; expected ${JSON.stringify({
        model: world.defaultModel,
        provider: world.defaultProvider,
      })}`,
    );
    check(
      "the model lock request is addressed to the stale chat's session",
      lockRequests[0]?.path?.endsWith(`/api/sessions/${chat.id}/model`) === true,
      `path: ${JSON.stringify(lockRequests[0]?.path ?? null)}`,
    );
    check(
      "the repair notice is gone once the lock is accepted",
      bannerGone && stateAfterRepair.banner.visible === false,
      `screen: ${screenSummary(stateAfterRepair)}; gateway: ${JSON.stringify({
        sessionModel: gateway.state.sessionModel,
        locks: lockRequests,
      })}`,
    );
    observations.afterRepair = {
      clickDelivered: clickedRepair === true,
      bannerGone,
      modelLockRequests: lockRequests.length,
      modelLockBody: lockBody,
      sessionModelServed: gateway.state.sessionModel,
      sessionsListed: gateway.state.sessionsListed,
    };

    // ── 4. The repaired chat answers the next turn ──────────────────────────
    const typed = await js(typeDraftExpression(world.turn.userText));
    check(
      "the composer takes the typed turn",
      typed?.ok === true,
      JSON.stringify(typed),
    );
    // The send control only appears once the app's own state carries the draft
    // (not merely the DOM value), so waiting for it is what makes the Enter
    // gesture below send the turn rather than race React's commit.
    const draftCommitted = await waitFor(
      win,
      `(() => {
        const button = document.querySelector('.chat-panel__send[data-state="send"]');
        return Boolean(button) && button.disabled !== true;
      })()`,
      5_000,
    );
    check(
      "the composer offers its send control for the typed turn",
      draftCommitted,
      `composer: ${JSON.stringify((await js(SAMPLE)).composer)}`,
    );
    // The shipped send gesture is Ctrl+Enter. Fall back to plain Enter and then
    // the send control only so a contract drift is recorded, never guessed: the
    // report names which gesture actually sent the turn.
    observations.sendGesture = "Ctrl+Enter";
    const sentWithCtrl = await js(sendWithCtrlEnterExpression);
    let streamSeen = await waitForGateway(
      () => gateway.state.streamRequests.length >= 1,
      SEND_TIMEOUT_MS,
    );
    if (!streamSeen && sentWithCtrl?.ok) {
      observations.sendGesture = "plain Enter (fallback)";
      await js(sendWithEnterExpression);
      streamSeen = await waitForGateway(
        () => gateway.state.streamRequests.length >= 1,
        SEND_TIMEOUT_MS,
      );
    }
    if (!streamSeen) {
      observations.sendGesture = "send control (fallback)";
      await js(clickSendExpression);
      streamSeen = await waitForGateway(
        () => gateway.state.streamRequests.length >= 1,
        SEND_TIMEOUT_MS,
      );
    }
    check(
      "the repaired chat sends the next turn to the gateway",
      streamSeen,
      `composer: ${JSON.stringify((await js(SAMPLE)).composer)}; stream requests: ${JSON.stringify(
        gateway.state.streamRequests,
      )}`,
    );

    const replyPainted = await waitFor(
      win,
      replyExpression(world.turn.reply),
      REPLY_TIMEOUT_MS,
    );
    const stateAnswered = await js(SAMPLE);
    states.answered = stateAnswered;
    check(
      "the repaired chat paints the gateway's answer, not the broken-model failure",
      replyPainted &&
        stateAnswered.messages.some(
          (message) => message.role === "assistant" && message.content.includes(world.turn.reply),
        ),
      `screen: ${screenSummary(stateAnswered)}; errors: ${JSON.stringify(stateAnswered.errorBanners)}`,
    );

    await waitForGateway(() => gateway.state.streamRequests.length >= 1, 2_000);
    await sleep(500);
    const streamRequests = gateway.state.streamRequests;
    const streamLines = readJsonLines(gateway.streamLogFile);
    const streamBody = streamRequests[0]?.body ?? null;
    const bodyText = JSON.stringify(streamBody ?? {});
    check(
      "the chat stream log holds exactly one line for the turn",
      streamRequests.length === 1 && streamLines.length === 1,
      `requests: ${JSON.stringify(streamRequests)}; log lines: ${JSON.stringify(streamLines)}`,
    );
    check(
      "the turn's request body carries the typed text in input/instructions",
      bodyText.includes(world.turn.userText) ||
        String(streamBody?.input ?? "").includes(world.turn.userText) ||
        JSON.stringify(streamBody?.instructions ?? {}).includes(world.turn.userText),
      `body: ${JSON.stringify(streamBody)}`,
    );
    check(
      "the fake gateway only answered because the session lock had moved",
      gateway.state.sessionModel === world.defaultModel,
      `session model served: ${JSON.stringify(gateway.state.sessionModel)}`,
    );
    observations.afterTurn = {
      streamRequests: streamRequests.length,
      streamBodyFields: streamBody && typeof streamBody === "object" ? Object.keys(streamBody) : [],
      bannerStillGone: stateAnswered.banner.visible === false,
      sessionModelServed: gateway.state.sessionModel,
      sessionsListed: gateway.state.sessionsListed,
    };

    // ── 5. The picture is the shipped screen, not a blank capture ───────────
    mark("screenshot:after-repair");
    const bytes = await screenshotOf(SCREENSHOT_NAME);
    check(
      "the screenshot is a real picture of the app",
      bytes > MIN_SCREENSHOT_BYTES,
      `${path.join(artifactsDir, SCREENSHOT_NAME)} is ${bytes} bytes`,
    );
  } catch (error) {
    failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    try {
      if (win) {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(artifactsDir, SCREENSHOT_NAME), image.toPNG());
      }
    } catch {
      // A screenshot is evidence, not a reason to lose the report.
    }
  } finally {
    clearTimeout(timeout);
  }

  const report = writeReport();
  if (gateway) await gateway.close().catch(() => {});
  console.log(`stale-chat-model: ${report.pass ? "pass" : "fail"}`);
  for (const check of checks) {
    console.log(`  ${check.pass ? "ok  " : "FAIL"} ${check.label}`);
  }
  for (const failure of failures) console.error(`FAIL ${failure}`);
  app.exit(report.pass ? 0 : 1);
}

/** A detail for the "row click was not delivered" failure that names what existed. */
function reallyClickedDetail(rowCount) {
  if (rowCount === 0) return "there is no .chats-rail__row to click";
  return `the row has no .chats-rail__row-main control (${rowCount} row(s) present)`;
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
