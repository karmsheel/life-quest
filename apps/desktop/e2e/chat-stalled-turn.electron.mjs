/**
 * The stalled-turn rig: when the Hermes gateway streams half a reply and then
 * goes silent with the socket still held open, does the chat stop showing
 * "running" — and does it recover the answer the gateway already stored?
 *
 * WHY THIS RIG EXISTS
 *
 * The app's chat turn state (`run.sending`) is cleared by a terminal stream
 * frame (`run.completed` / `run.cancelled` / a named `error`) or by the stream
 * request settling. The reported bug: a gateway that streams a `run.started`
 * and some deltas and then never writes another byte — connection held open,
 * no terminal event, no keepalive — left `sending` true forever. The rail's dot
 * pulsed, the "1 running" chip stayed, and the composer stayed in its stop
 * state. Restarting the app was the only way out. The fix bounds the stream read
 * by a BYTE-IDLE timeout (the real gateway writes an SSE keepalive every 10 s
 * while a turn is live, so a long silence is a dead stream): on expiry the app
 * aborts the request, names the failure on screen, settles the turn BEFORE the
 * post-turn list read, and re-reads the transcript so a reply the gateway
 * already stored is not lost.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway does not really stall — it ends the stream, so the
 *      pre-existing terminal path clears the dot and the rig proves nothing.
 *      The stream writes `run.started` + one `assistant.delta` and then NOTHING
 *      (no keepalive comment, no done, no error) and holds the socket; the
 *      artifact records the frames and the socket's lifetime, and the rig fails
 *      if the socket was already closed when recovery is judged.
 *   2. The turn never started: a send gesture that silently does nothing would
 *      let the final "no running state" pass. The rig requires the rail row's
 *      `data-live`, the "1 running" chip, the composer's stop control AND the
 *      gateway's `/chat/stream` POST before it judges recovery.
 *   3. The idle bound is ignored or disabled and the rig only looks green
 *      because it never judges the bug. The rig requires recovery within 15 s
 *      while the session's own bound is 2500 ms, and the control pass
 *      (`LQ_STALL_IDLE_MS=60000`, saved as `chat-stalled-turn.before.json`)
 *      shows the same checks failing with the dot still up: the check
 *      discriminates, it is not vacuous.
 *   4. The dot clears for the wrong reason — a stop press, a generic error path
 *      — while the stream is still open. The rig requires the app's NAMED
 *      sentence ("stopped sending"), the composer's send state back, and the
 *      gateway seeing the stalled socket close.
 *   5. The transcript shows the reply because it streamed in, not because the
 *      app re-read it. The stream only ever carries PARTIAL text; the stored
 *      final reply exists ONLY on `/api/sessions/{id}/messages` after the
 *      stall, so its presence proves the post-failure reload. The rig also
 *      logs a `/messages` fetch after the stream began whose response was the
 *      completed transcript, and requires the partial-only text be gone.
 *   6. The settle waits for the post-turn list read, which is the other half of
 *      the bug. Once the stream starts, the rig HOLDS every `/api/sessions`
 *      list request (never answers it) while continuing to answer `/messages`.
 *      A green recovery therefore proves the turn settled without waiting on
 *      that read — the rail already carries its seeded row, so nothing on
 *      screen depended on it.
 *   7. The rig attaches to the operator's real Hermes, vault, or app. The
 *      `HERMES_HOME` is a temp dir, the profile is `lq-stall-e2e` (no real
 *      install has it), the vault is a throwaway `createVault()`, a stub
 *      `hermes` is first on PATH, the userData and MCP doors are moved by
 *      `LIFEQUEST_E2E`, and 8642/8643/8646 are never bound.
 *   8. The screenshot is stale, blank, or of another window. It is this
 *      window's own `capturePage()` after recovery, and >10 KB on disk.
 *   9. The report is trusted blindly. `tests/chat-stalled-turn-e2e.test.ts`
 *      re-derives the recovery time, the named sentence, the transcript
 *      re-read, the closed socket and the screenshot bytes from the artifact.
 *
 * Run by `tests/chat-stalled-turn-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME`, profile `lq-stall-e2e`, throwaway vault, fake `hermes` on
 * PATH) and passes it as `LQ_STALL_WORLD`:
 *
 *   LQ_STALL_WORLD=<dir> <electron> e2e/chat-stalled-turn.electron.mjs
 *
 * The driver starts the fake gateway on its own free port (the port has to be
 * known before `.env` is written), boots the REAL main process through
 * `bootForE2e`, and drives the REAL rail and composer. It writes
 * `e2e/artifacts/chat-stalled-turn.json` plus `.png`.
 *
 * The idle bound is the seam's `streamIdleMs` (2500 ms here; the product's 45 s
 * would spend the run proving the clock). `LQ_STALL_IDLE_MS` may override it —
 * only to produce the control/pre-fix artifact at 60000 ms, where the turn must
 * still be stuck when the 15 s window closes; the test never sets it.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT_NAME = "chat-stalled-turn.json";
const SCREENSHOT_NAME = "chat-stalled-turn.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/** The turn's own bound. Product default is 45 000 ms; this is the rig's. */
const STREAM_IDLE_MS = (() => {
  const raw = Number(process.env.LQ_STALL_IDLE_MS ?? 2_500);
  return Number.isFinite(raw) && raw >= 500 ? Math.round(raw) : 2_500;
})();
/** The reported bug's window: the dot must be gone within this many ms of send. */
const RECOVERY_WINDOW_MS = 15_000;
/** How long to wait for the rail/tab strip/chat dock to be ready to drive. */
const READY_TIMEOUT_MS = 90_000;
/** How long the app may take to paint the message it is sending. */
const RUNNING_TIMEOUT_MS = 10_000;
/** How long the app may take to point the new turn at the gateway. */
const STREAM_START_TIMEOUT_MS = 10_000;
/** How long the held list request may take to arrive once the turn is settled. */
const HELD_LIST_TIMEOUT_MS = 5_000;
/** How long the stalled socket may take to close after recovery. */
const SOCKET_CLOSE_TIMEOUT_MS = 10_000;

const failures = [];
const checks = [];
const notes = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) console.error(`[chat-stalled-turn] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/**
 * The fake Hermes host gateway.
 *
 * `/health`, `/v1/capabilities`, `/api/model/options` and the Sessions API are
 * the attach and chat paths the real app uses. The two pieces this rig is about:
 *
 *  - `/api/sessions/{id}/chat/stream` answers 200 text/event-stream, writes
 *    `run.started` and one `assistant.delta`, and then holds the socket open
 *    writing NOTHING — no keepalive, no run.completed, no error. That is the
 *    reported gateway failure.
 *  - `/api/sessions/{id}/messages` is mutable: while the turn is "running" it
 *    serves the seeded transcript; once the stalled stream has started it
 *    serves the completed transcript (the user's message and the final reply
 *    the gateway stored). A reload after recovery is the only way that reply
 *    can reach the screen.
 *
 * Once the stream has started, every `/api/sessions` LIST request is HELD — the
 * request is accepted and never answered — so a green settle cannot be the post
 * turn list read, and the rail has to keep the seeded row it already paints.
 */
function serveGateway(world) {
  const sockets = new Set();
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const state = {
    /** "seeded" until the stalled stream starts, then "completed". */
    phase: "seeded",
    sessionListRequests: [],
    messagesRequests: [],
    streamRequests: [],
    /** Post-stream list reads the app issued and the gateway never answered. */
    heldListRequests: [],
    fallbackRequests: [],
    stalled: {
      openedAt: null,
      closedAt: null,
      frames: [],
      runId: "run-stalled-e2e",
      input: null,
      sessionId: null,
    },
  };

  const sessionRow = () => ({
    id: world.session.id,
    title: world.session.title,
    preview: world.seed.userText,
    started_at: nowSeconds() - 600,
    last_activity: nowSeconds() - 60,
    pinned: false,
    archived: false,
    hidden: false,
    message_count: 1,
  });

  const transcript = () => {
    if (state.phase !== "completed") {
      return [
        { role: "user", content: world.seed.userText, timestamp: nowSeconds() - 600 },
      ];
    }
    // The reply the gateway stored after the turn: only here, never on the wire.
    return [
      { role: "user", content: world.seed.userText, timestamp: nowSeconds() - 600 },
      { role: "user", content: world.seed.turnText, timestamp: nowSeconds() - 5 },
      { role: "assistant", content: world.seed.finalReply, timestamp: nowSeconds() - 4 },
    ];
  };

  const json = (res, payload) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const at = Date.now();

    if (pathname.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    if (pathname.endsWith("/v1/capabilities")) {
      json(res, {
        features: {
          session_list: true,
          session_chat: true,
          session_chat_stream: true,
        },
      });
      return;
    }

    if (pathname.endsWith("/api/model/options")) {
      // The composer's pills read the gateway's own catalog; serving a real-
      // shaped one keeps the control row mounted exactly as the product has it.
      json(res, {
        providers: [
          { slug: "nous", name: "Nous", authenticated: true, models: ["rig-model"] },
        ],
        model: "rig-model",
        provider: "nous",
      });
      return;
    }

    const messagesMatch = pathname.match(/\/api\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      const request = {
        at,
        method: req.method ?? "",
        path: req.url ?? "",
        sessionId,
        stage: state.phase,
      };
      state.messagesRequests.push(request);
      json(res, { object: "list", data: transcript() });
      return;
    }

    const streamMatch = pathname.match(/\/api\/sessions\/([^/]+)\/chat\/stream$/);
    if (streamMatch) {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let input = null;
        try {
          const parsed = JSON.parse(body);
          input = typeof parsed.input === "string" ? parsed.input : null;
        } catch {
          /* the request log still names the POST */
        }
        const startedAt = Date.now();
        // The turn is now "running" on the gateway: from here the transcript
        // endpoint serves the stored completed answer, and list reads are held.
        state.phase = "completed";
        state.stalled.openedAt = startedAt;
        state.stalled.sessionId = decodeURIComponent(streamMatch[1]);
        state.stalled.input = input;
        state.streamRequests.push({
          at: startedAt,
          method: req.method ?? "",
          path: req.url ?? "",
          sessionId: state.stalled.sessionId,
          input,
        });

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const frames = [
          `event: run.started\ndata: ${JSON.stringify({
            run_id: state.stalled.runId,
            session_id: state.stalled.sessionId,
            seq: 1,
          })}\n\n`,
          `event: assistant.delta\ndata: ${JSON.stringify({
            run_id: state.stalled.runId,
            text: world.seed.partialText,
            seq: 2,
          })}\n\n`,
        ];
        state.stalled.frames = frames;
        for (const frame of frames) res.write(frame);
        state.stalled.res = res;
        res.on("close", () => {
          if (state.stalled.closedAt === null) state.stalled.closedAt = Date.now();
        });
        // Deliberately NOTHING else: no keepalive comment, no terminal frame,
        // no end(). The socket is held open exactly as the reported gateway did.
      });
      return;
    }

    if (pathname.endsWith("/api/sessions") && (req.method ?? "GET") === "GET") {
      if (state.phase === "completed") {
        // The app's post-turn list read is accepted and never answered. If the
        // settle were still behind it, the running state could not clear.
        state.heldListRequests.push({
          at,
          method: req.method ?? "",
          path: req.url ?? "",
          answered: false,
        });
        return;
      }
      state.sessionListRequests.push({
        at,
        method: req.method ?? "",
        path: req.url ?? "",
      });
      json(res, { object: "list", data: [sessionRow()] });
      return;
    }

    // Older/newer attach paths must not fail the run for an endpoint this rig
    // is not about.
    state.fallbackRequests.push({ at, method: req.method ?? "", path: req.url ?? "" });
    json(res, {});
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return listen(server).then((port) => ({
    port,
    state,
    close: () =>
      new Promise((resolve) => {
        // A held response or a stalled stream would otherwise keep close()
        // waiting forever; the driver's job is done either way.
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  }));
}

/** `HERMES_HOME/.env`, written after the gateway has a port and before boot. */
function writeHostEnv(hermesHome, port) {
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

/** The one file the test left for this process: where the world is. */
function readWorld() {
  const dir = process.env.LQ_STALL_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_STALL_WORLD is required — run this through tests/chat-stalled-turn-e2e.test.ts",
    );
  }
  const file = path.join(dir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no world.json in ${dir} — the test builds the world before spawning this driver`,
    );
  }
  const world = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["hermesHome", "userData", "binDir", "profile", "session", "seed", "mcpPorts"]) {
    if (!world[key]) throw new Error(`world.json is missing "${key}"`);
  }
  return { dir, ...world };
}

/** Wait for an in-page expression to become truthy, or name what never happened. */
function waitFor(win, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try {
        value = await win.webContents.executeJavaScript(expression);
      } catch {
        value = undefined;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`));
        return;
      }
      setTimeout(poll, 100);
    };
    void poll();
  });
}

/**
 * Poll the live DOM until `accept(sample)` says yes, returning the last sample
 * and whether it ever said yes. Never throws: a timeout is data, not a crash,
 * so the control run can record what the screen actually still looked like.
 */
async function pollSample(win, expression, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sample = null;
  for (;;) {
    try {
      sample = await win.webContents.executeJavaScript(expression);
    } catch {
      sample = null;
    }
    if (sample && accept(sample)) return { ok: true, sample };
    if (Date.now() >= deadline) return { ok: false, sample };
    await sleep(100);
  }
}

/** One look at the shipped rail, composer, error banner, and transcript. */
const sampleExpression = (world) => `(() => {
  const title = ${JSON.stringify(world.session.title)};
  const text = (el) => ((el && el.textContent) || "").trim();
  const row = Array.from(document.querySelectorAll(".chats-rail__row")).find((li) =>
    text(li.querySelector(".chats-rail__label")) === title) ?? null;
  const input = document.querySelector(".chat-panel__composer-input");
  const send = document.querySelector(".chat-panel__send");
  const errorBox = document.querySelector(".chat-panel__error");
  const messages = document.querySelector(".chat-panel__messages");
  const transcript = ((messages && messages.innerText) || "").trim();
  return {
    at: Date.now(),
    hasRail: Boolean(document.querySelector(".chats-rail")),
    rowPresent: Boolean(row),
    rowLive: Boolean(row) && row.hasAttribute("data-live"),
    liveChip: text(document.querySelector(".chats-rail__live-count")) || null,
    composerPresent: Boolean(input),
    composerDisabled: input ? input.disabled === true : null,
    composerValue: input ? input.value : null,
    composerPlaceholder: input ? input.getAttribute("placeholder") : null,
    sendState: send ? send.getAttribute("data-state") : null,
    sendLabel: send ? send.getAttribute("aria-label") : null,
    sendDisabled: send ? send.disabled === true : null,
    error: text(errorBox && errorBox.querySelector("p")) || null,
    transcript,
    transcriptHasSeed: transcript.includes(${JSON.stringify(world.seed.userText)}),
    transcriptHasPartial:
      transcript.includes(${JSON.stringify(world.seed.partialText)}) ||
      transcript.includes(${JSON.stringify(world.seed.partialText.slice(0, 24))}),
    transcriptHasFinal: transcript.includes(${JSON.stringify(world.seed.finalReply)}),
  };
})()`;

/** Put a draft in the dock's composer the way a person would. */
function typeDraftExpression(text) {
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
      if (el.value === ${JSON.stringify(text)}) return { ok: true, value: el.value };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ok: false, reason: "the composer did not take the draft", value: el.value };
  })()`;
}

/** Type the turn and click the shipped send control. */
const SEND_EXPRESSION = (turnText) => `(async () => {
  const el = document.querySelector(".chat-panel__composer-input");
  if (!el) return { ok: false, reason: "no composer" };
  const proto = HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  el.focus();
  setter.call(el, ${JSON.stringify(turnText)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  const deadline = performance.now() + 3000;
  let button = null;
  while (performance.now() < deadline) {
    button = document.querySelector('.chat-panel__send[data-state="send"]');
    if (button) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!button) {
    return { ok: false, reason: "no send control after typing", value: el.value };
  }
  if (button.disabled) {
    return { ok: false, reason: "the send control is disabled", value: el.value };
  }
  button.click();
  return { ok: true, value: el.value };
})()`;

/** The seeded chat open in the dock, so the composer belongs to it. */
const OPEN_CHAT_EXPRESSION = (world) => `(() => {
  const title = ${JSON.stringify(world.session.title)};
  const row = Array.from(document.querySelectorAll(".chats-rail__row")).find((li) =>
    ((li.querySelector(".chats-rail__label")?.textContent) ?? "").trim() === title);
  if (!row) return false;
  const main = row.querySelector(".chats-rail__row-main");
  if (!main) return false;
  main.click();
  return true;
})()`;

async function run() {
  const world = readWorld();
  const host = await serveGateway(world);
  const screenshotFile = path.join(artifactsDir, SCREENSHOT_NAME);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const measurements = {
    streamIdleMs: STREAM_IDLE_MS,
    recoveryWindowMs: RECOVERY_WINDOW_MS,
    control: STREAM_IDLE_MS >= RECOVERY_WINDOW_MS,
    sendAt: null,
    runningSeenAt: null,
    streamStartedAt: null,
    recoveredAt: null,
    recoveryMs: null,
    socketClosedAfterSendMs: null,
    heldListRequestsAtJudgement: 0,
  };
  const states = { initial: null, sending: null, running: null, recovered: null, usable: null };

  try {
    writeHostEnv(world.hermesHome, host.port);
    // The app boots from the same seam every other full-app rig uses. These
    // assignments keep the same contract when the driver is run by hand, and
    // are what `__LIFEQUEST_E2E_SEAM__` reads when main.js is imported below.
    process.env.HERMES_HOME = world.hermesHome;
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
    process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
    if (!process.env.LIFEQUEST_E2E) {
      process.env.LIFEQUEST_E2E = JSON.stringify({
        userData: world.userData,
        showWindow: true,
        mcpPorts: world.mcpPorts,
        streamIdleMs: STREAM_IDLE_MS,
      });
    }
    delete process.env.ELECTRON_RUN_AS_NODE;

    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();
    const js = (code) => win.webContents.executeJavaScript(code);

    // ── the rail is up, and the gateway's seeded chat is on it ──────────────
    await waitFor(win, `Boolean(document.querySelector(".chats-rail"))`, "the chats rail (.chats-rail) to mount", READY_TIMEOUT_MS);
    await waitFor(
      win,
      `(() => {
        const title = ${JSON.stringify(world.session.title)};
        return Array.from(document.querySelectorAll(".chats-rail__row")).some((li) =>
          ((li.querySelector(".chats-rail__label")?.textContent) ?? "").trim() === title);
      })()`,
      `the gateway's seeded chat "${world.session.title}" to be listed`,
      60_000,
    );

    // Open it in the dock so the composer and transcript belong to this chat.
    if (!(await js(OPEN_CHAT_EXPRESSION(world)))) {
      throw new Error("the seeded chat row has no row-main control to open");
    }
    await waitFor(
      win,
      `(() => {
        const el = document.querySelector(".chat-panel__composer-input");
        return Boolean(el) && el.disabled !== true;
      })()`,
      "the chat composer to mount and become usable",
      60_000,
    );
    await waitFor(
      win,
      `(() => {
        const el = document.querySelector(".chat-panel__messages");
        return Boolean(el) && (el.innerText || "").includes(${JSON.stringify(world.seed.userText)});
      })()`,
      "the seeded transcript to be read from the gateway and painted",
      30_000,
    );
    await sleep(300);

    states.initial = await js(sampleExpression(world));
    check(
      "the app lands on the seeded chat with its transcript on screen",
      states.initial.hasRail === true &&
        states.initial.rowPresent === true &&
        states.initial.transcriptHasSeed === true &&
        states.initial.composerPresent === true &&
        states.initial.composerDisabled === false,
      `initial sample: ${JSON.stringify(states.initial)}`,
    );
    check(
      "the rail row starts with no running state",
      states.initial.rowLive === false && states.initial.liveChip === null,
      `initial sample: ${JSON.stringify(states.initial)}`,
    );

    // ── send the turn: the stall must really start a run ────────────────────
    measurements.sendAt = Date.now();
    const sent = await js(SEND_EXPRESSION(world.seed.turnText));
    check(
      "the shipped send control sends the turn",
      sent?.ok === true,
      `send result: ${JSON.stringify(sent)}`,
    );
    states.sending = await js(sampleExpression(world));

    const running = await pollSample(
      win,
      sampleExpression(world),
      (sample) =>
        sample.rowLive === true &&
        /^1 running$/.test(sample.liveChip ?? "") &&
        sample.sendState === "stop" &&
        sample.sendDisabled === false,
      RUNNING_TIMEOUT_MS,
    );
    if (running.ok) measurements.runningSeenAt = Date.now();
    states.running = running.sample;
    check(
      "the rail row shows the running state once the message is sent",
      running.ok,
      `last sample: ${JSON.stringify(running.sample)}`,
    );
    check(
      "the composer shows its stop control while the turn runs",
      running.ok &&
        running.sample.sendState === "stop" &&
        running.sample.sendLabel === "Stop this run",
      `last sample: ${JSON.stringify(running.sample)}`,
    );

    // The app must actually be talking to the fake gateway's stalled stream.
    const streamDeadline = Date.now() + STREAM_START_TIMEOUT_MS;
    while (host.state.streamRequests.length === 0 && Date.now() < streamDeadline) {
      await sleep(50);
    }
    const streamRequest = host.state.streamRequests[0] ?? null;
    if (streamRequest) measurements.streamStartedAt = streamRequest.at;
    check(
      "the turn was really sent to the gateway's chat stream",
      streamRequest !== null &&
        streamRequest.sessionId === world.session.id &&
        String(streamRequest.input ?? "").includes(world.seed.turnText),
      `stream requests: ${JSON.stringify(host.state.streamRequests)}`,
    );
    check(
      "the fake gateway really stalled: run.started plus one delta, then silence",
      host.state.stalled.frames.length === 2 &&
        host.state.stalled.frames[0].includes("event: run.started") &&
        host.state.stalled.frames[1].includes("event: assistant.delta") &&
        host.state.stalled.closedAt === null,
      `frames: ${JSON.stringify(host.state.stalled.frames)} / closedAt: ${host.state.stalled.closedAt}`,
    );

    // ── the reported bug: the running state must clear on its own ──────────
    const windowLeft = Math.max(0, RECOVERY_WINDOW_MS - (Date.now() - measurements.sendAt));
    const recovered = await pollSample(
      win,
      sampleExpression(world),
      (sample) =>
        sample.rowPresent === true &&
        sample.rowLive === false &&
        sample.liveChip === null &&
        sample.sendState !== "stop" &&
        sample.composerPresent === true &&
        sample.composerDisabled === false &&
        /stopped sending/i.test(sample.error ?? "") &&
        sample.transcriptHasFinal === true,
      windowLeft,
    );
    if (recovered.ok) {
      measurements.recoveredAt = Date.now();
      measurements.recoveryMs = measurements.recoveredAt - measurements.sendAt;
    }
    states.recovered = recovered.sample;
    check(
      "the running state clears within 15 s of send",
      recovered.ok,
      `after ${measurements.recoveryMs ?? ">15000"}ms the screen still read: ${JSON.stringify(recovered.sample)}`,
    );
    check(
      "the error shown is the app's named sentence, not a generic failure",
      /stopped sending/i.test(recovered.sample?.error ?? ""),
      `error on screen: ${JSON.stringify(recovered.sample?.error ?? null)}`,
    );
    check(
      "the composer is usable again once the turn settles",
      recovered.ok &&
        recovered.sample.composerPresent === true &&
        recovered.sample.composerDisabled === false &&
        recovered.sample.sendState !== "stop" &&
        /^Message /.test(recovered.sample.composerPlaceholder ?? ""),
      `recovered sample: ${JSON.stringify(recovered.sample)}`,
    );
    check(
      "the transcript shows the gateway's stored completed reply",
      recovered.sample?.transcriptHasFinal === true &&
        recovered.sample?.transcriptHasPartial !== true,
      `transcript after recovery: ${JSON.stringify(recovered.sample?.transcript ?? null)}`,
    );

    // ── the composer takes input again (not merely un-disabled) ─────────────
    const probeDraft = "A draft typed after the stall";
    const typed = await js(typeDraftExpression(probeDraft));
    const usable = await pollSample(
      win,
      sampleExpression(world),
      (sample) =>
        sample.composerValue === probeDraft &&
        sample.sendState === "send" &&
        sample.sendDisabled === false,
      5_000,
    );
    states.usable = usable.sample;
    check(
      "the composer accepts a new draft and offers the send control again",
      typed?.ok === true && usable.ok,
      `typed: ${JSON.stringify(typed)} / last sample: ${JSON.stringify(usable.sample)}`,
    );
    // Clear the probe so the picture shows the recovered chat, not a draft.
    await js(typeDraftExpression(""));
    await sleep(300);

    // ── the transcript was re-read, and the turn settled before the list ────
    const heldDeadline = Date.now() + HELD_LIST_TIMEOUT_MS;
    while (host.state.heldListRequests.length === 0 && Date.now() < heldDeadline) {
      await sleep(50);
    }
    measurements.heldListRequestsAtJudgement = host.state.heldListRequests.length;
    const streamAt = measurements.streamStartedAt ?? measurements.sendAt ?? 0;
    const reRead = host.state.messagesRequests.filter(
      (request) => request.at >= streamAt && request.stage === "completed",
    );
    check(
      "the transcript was re-read from the gateway after the stall",
      reRead.length > 0,
      `messages requests: ${JSON.stringify(host.state.messagesRequests)} / stream at: ${streamAt}`,
    );
    check(
      "the settle did not wait on the post-turn session list read",
      host.state.heldListRequests.length > 0 &&
        recovered.ok &&
        measurements.recoveryMs !== null &&
        measurements.recoveryMs <= RECOVERY_WINDOW_MS,
      `${host.state.heldListRequests.length} list request(s) held unanswered; recovery ${measurements.recoveryMs}ms after send`,
    );

    // ── the app closed the stalled socket ───────────────────────────────────
    const closeDeadline = Date.now() + SOCKET_CLOSE_TIMEOUT_MS;
    while (host.state.stalled.closedAt === null && Date.now() < closeDeadline) {
      await sleep(50);
    }
    if (host.state.stalled.closedAt !== null && measurements.sendAt !== null) {
      measurements.socketClosedAfterSendMs = host.state.stalled.closedAt - measurements.sendAt;
    }
    check(
      "the app closed the stalled stream socket",
      host.state.stalled.closedAt !== null,
      `stalled socket closedAt: ${host.state.stalled.closedAt}`,
    );

    // ── the picture is this window's capture of the recovered chat ──────────
    // The thread parks at its bottom, which cut the named sentence's first
    // line off the capture. The recovered thread fits on one screen, so rest it
    // at the top: the error and the gateway's stored reply are one still.
    await js(
      `(() => {
        const body = document.querySelector(".chat-panel__body");
        if (!body) return false;
        body.scrollTop = 0;
        return true;
      })()`,
    );
    await sleep(350);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotFile, image.toPNG());
    const screenshotBytes = fs.existsSync(screenshotFile) ? fs.statSync(screenshotFile).size : 0;
    check(
      "the screenshot shows the recovered chat, not a mock",
      screenshotBytes > MIN_SCREENSHOT_BYTES,
      `${screenshotFile} is ${screenshotBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    notes.push(
      `the idle bound was ${STREAM_IDLE_MS}ms through the seam's streamIdleMs; the product's own bound is 45000ms`,
    );
    if (measurements.control) {
      notes.push(
        `CONTROL RUN: LQ_STALL_IDLE_MS=${STREAM_IDLE_MS} is at or above the ${RECOVERY_WINDOW_MS}ms window, so this report records the reported bug (the running dot stays, the composer stays stopped and the stalled socket stays open); the real run uses 2500ms`,
      );
      notes.push(
        `CONTROL RUN: the capture taken at the end of this run is the stuck screen; it is written to ${SCREENSHOT_NAME} for the run's own check and the delivered green run overwrites it with the recovered screen, so this artifact is the reproduction report, not the acceptance picture`,
      );
    }
    notes.push(
      `the stored reply ${JSON.stringify(world.seed.finalReply)} exists only on /api/sessions/${world.session.id}/messages after the stream started; the stream carried only ${JSON.stringify(world.seed.partialText)}`,
    );
    notes.push(
      `${host.state.heldListRequests.length} /api/sessions list request(s) after the stream started were accepted and never answered, so the recovery above was not waiting on them`,
    );
  } catch (error) {
    failures.push(
      `the driver threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    console.error(error);
  }

  const report = {
    pass: failures.length === 0,
    failures: [...failures],
    checks: [...checks],
    ranAt: new Date().toISOString(),
    control: measurements.control,
    what: "the real app, after a Hermes chat stream stalls with the socket held open, clears the rail's running dot, reopens the composer, names the failure, re-reads the transcript so the gateway's stored reply is visible, and closes the stalled socket",
    why: "the turn was only settled by a terminal stream frame or by the request settling; a gateway that went silent with the connection held open left run.sending true forever, so the rail pulsed and the composer stayed stopped until the app restarted",
    world: {
      profile: world.profile,
      profilePath: path.join(world.hermesHome, "profiles", world.profile),
      sessionId: world.session.id,
      sessionTitle: world.session.title,
      gatewayPort: host.port,
      devServerUrl: DEV_SERVER_URL,
    },
    measurements,
    states,
    gateway: {
      sessionListRequests: host.state.sessionListRequests,
      heldListRequests: host.state.heldListRequests,
      messagesRequests: host.state.messagesRequests,
      streamRequests: host.state.streamRequests,
      stalled: {
        openedAt: host.state.stalled.openedAt,
        closedAt: host.state.stalled.closedAt,
        frames: host.state.stalled.frames,
        input: host.state.stalled.input,
      },
      fallbackRequests: host.state.fallbackRequests.slice(0, 40),
    },
    screenshots: fs.existsSync(screenshotFile) ? [SCREENSHOT_NAME] : [],
    notes,
  };

  try {
    fs.writeFileSync(
      path.join(artifactsDir, REPORT_NAME),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`[chat-stalled-turn] could not write the artifact: ${error}`);
  }
  console.log(JSON.stringify(report, null, 2));

  await host.close().catch(() => {});
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
