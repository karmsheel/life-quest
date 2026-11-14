/**
 * The paused-chat recovery rig: when Hermes has paused a conversation behind a
 * turn that was interrupted (the app or the gateway died mid-run), does the app
 * recover the SAME chat in place — acknowledge the lost turn, let the message
 * committed behind it answer, and paint that answer — instead of dead-ending on
 * "start a new chat"?
 *
 * WHY THIS RIG EXISTS
 *
 * Hermes fences a turn whose FIFO head it cannot account for as `unknown`. Every
 * later send into that conversation is accepted and committed but never
 * executed, and the host says so on the stream as an `error` SSE frame carrying
 * the runtime token `unknown_execution`, then closes the stream without a
 * terminal run frame. Before the fix the dock painted that token as a dead end
 * ("This conversation is paused because a turn was interrupted — start a new
 * chat.", "Ended before finishing — the stream closed before the turn
 * finished") even though Hermes can acknowledge the lost turn
 * (`hermes sessions discard <id> --yes`, the non-replaying form of
 * `prompt.resolve_unknown`) and then runs the message queued behind it.
 *
 * The fix in `electron/companion.ts` (companionChatStream): swallow the paused
 * frame instead of reporting it, run the discard for the OPEN VAULT's Hermes
 * profile, re-read `/api/sessions/<id>/messages` until the transcript grows,
 * and settle the turn with ONE terminal `run.incomplete` whose `reason` is
 * `PAUSED_RECOVERED_REASON` and whose `snapshot` is the re-read transcript. The
 * reply to the queued message therefore reaches the dock through the re-read,
 * not the (already closed) stream.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake host never really paused. If it ended the stream with a
 *      terminal frame, the ordinary completion path would paint the reply and
 *      the rig would prove nothing about recovery. So the host writes exactly
 *      one `event: error` frame carrying `unknown_execution` (the frame shape
 *      pinned by `companion-paused.electron.mjs`) and then ENDS the response —
 *      no `run.completed` / `run.stopped` / `run.incomplete`, no keepalive. The
 *      artifact records the frames, and the test fails if a terminal run frame
 *      was ever written.
 *   2. The app never asked Hermes to recover. A dock that merely hid the dead
 *      end would pass a "no dead end" check while the chat stayed paused. The
 *      fake `hermes` shim on PATH records every invocation it receives into THIS
 *      run's directory (and only when pointed there), and the test fails unless
 *      the artifact carries a `-p <rig-profile> sessions discard <sessionId>
 *      --yes` invocation. The shim is the only thing that writes that file, so
 *      its existence also proves the app resolved the rig's CLI, not the
 *      operator's.
 *   3. The transcript already held the answer, so "the reply is on screen" is
 *      not evidence of a re-read. The fake host's `/messages` serves the paused
 *      transcript (the operator's queued message, NO assistant reply) until the
 *      discard record exists, and only then the grown transcript. Every
 *      `/messages` request is logged with `afterDiscard` and the rows it served;
 *      the test re-derives that the grown rows exist only on a post-discard
 *      read, and that a pre-discard read never carried the reply.
 *   4. The dock says the right words from a fixture. This is the REAL main
 *      process, preload bridge and renderer (`bootForE2e`), driven through the
 *      REAL rail and composer; the note on screen is the renderer's rendering
 *      of the `run.incomplete` reason main emitted. The test imports
 *      `PAUSED_RECOVERED_REASON` from `electron/companion-client.ts` and requires
 *      the painted `.chat-panel__turn-note` to contain it.
 *   5. The dead end is only hidden while the error banner still shows, or the
 *      chat is only "recovered" because a NEW chat was opened. The rig asserts
 *      the error banner is absent, the dock's text contains neither "start a new
 *      chat" nor "stream closed before the turn finished", the SAME session id
 *      and its earlier message are still in the transcript, and the composer is
 *      send-enabled again.
 *   6. The paused path was bypassed and the generic close path answered. On the
 *      green path the dock must NOT carry "the stream closed before the turn
 *      finished"; the fake host closes right after the paused frame, so the only
 *      way that sentence can appear is if main reported the close instead of
 *      recovering.
 *   7. The rig attaches to the operator's real Hermes, vault, or app. `HERMES_HOME`
 *      is a temp dir, the profile is `lq-paused-e2e` (no real install has it),
 *      the vault is a throwaway `createVault()`, the stub `hermes` is first on
 *      PATH, userData and the MCP doors are moved by `LIFEQUEST_E2E`, the fake
 *      host binds a free port and 8642/8643/8646 are never bound.
 *   8. The screenshot is stale, blank, or of another window. It is this window's
 *      own `capturePage()` after recovery, >10 KB on disk.
 *   9. The report is trusted blindly. `tests/chat-paused-recovery-e2e.test.ts`
 *      re-derives the discard argv, the post-discard `/messages` growth, the
 *      note, the absence of both dead-end sentences, the composer state and the
 *      screenshot bytes from the artifact.
 *  10. The "recovery" is really a new chat. The gateway records the session id
 *      of the stream POST and of every `/messages` read; all must be the one
 *      seeded session, whose first message is still on screen.
 *
 * Run by `tests/chat-paused-recovery-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME` with profile `lq-paused-e2e`, throwaway vault BOUND to that
 * profile, stub `hermes` first on PATH, fake host port known before boot) and
 * passes it as `LQ_PAUSED_WORLD`:
 *
 *   LQ_PAUSED_WORLD=<dir> <electron> e2e/chat-paused-recovery.electron.mjs
 *
 * The driver starts the fake host on its own free port (the port has to be
 * known before `.env` is written), boots the REAL main process through
 * `bootForE2e`, and drives the REAL rail and composer. It writes
 * `e2e/artifacts/chat-paused-recovery.json` plus `.png`.
 *
 * The shim records invocations only when `LQ_PAUSED_RECORD` points at this run's
 * directory; the driver sets it from the world so a hand-run of this file cannot
 * write anywhere else. `LQ_PAUSED_CLI_FAIL` exists only for a future control
 * pass (the shim then exits non-zero for the discard, and the app must fall back
 * to the old pause sentence); the test never sets it.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT_NAME = "chat-paused-recovery.json";
const SCREENSHOT_NAME = "chat-paused-recovery.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/** The profile this rig owns. No real Hermes install has it. */
const RIG_PROFILE = "lq-paused-e2e";
/** Ports the product owns; a rig must never bind one of them. */
const RESERVED_PORTS = [8642, 8643, 8646];
/** The reported bug's window: the chat must be usable again within this. */
const RECOVERY_WINDOW_MS = 15_000;
/** How long to wait for the rail/tab strip/chat dock to be ready to drive. */
const READY_TIMEOUT_MS = 90_000;
/** How long the app may take to show the running state once sent. */
const RUNNING_TIMEOUT_MS = 10_000;
/** How long the app may take to point the new turn at the gateway. */
const STREAM_START_TIMEOUT_MS = 10_000;
/** How long the paused response may take to close after its error frame. */
const STREAM_CLOSE_TIMEOUT_MS = 10_000;
/** How long the shim's record file may take to appear once recovery ran. */
const DISCARD_RECORD_TIMEOUT_MS = 10_000;
/** How long after recovery the post-discard `/messages` reads may land. */
const MESSAGES_SETTLE_MS = 2_000;

/**
 * The host's paused-conversation frame, copied byte for byte from
 * `e2e/companion-paused.electron.mjs`, the rig that pinned the real host's
 * shape: `_sse_frame` writes the event name, the JSON payload, then the blank
 * line. The host may wrap the token (`RuntimeStoreError('unknown_execution')`);
 * the app's `isPausedConversation` matches it anywhere in the message.
 */
const PAUSED_FRAME = 'event: error\ndata: {"message": "unknown_execution"}\n\n';

const failures = [];
const checks = [];
const notes = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) console.error(`[chat-paused-recovery] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Listen on a free port that is not one the product owns. `listen(0)` is the
 * only honest way to ask, but the kernel could still hand back a reserved port
 * on a machine that has one free; retry rather than bind it.
 */
function listenAvoidingReserved(server) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        if (RESERVED_PORTS.includes(port) && attempts < 8) {
          server.close(() => attempt());
          return;
        }
        resolve(port);
      });
    };
    attempt();
  });
}

/** The shim's record file: one invocation per line, argv separated by tabs. */
function recordFilePath(world) {
  return path.join(world.dir, "hermes-calls.txt");
}

/**
 * Read the shim's invocations. A line is only complete when it ends in a
 * newline: the shim writes one line per invocation, and reading while it is
 * mid-write must not parse half an argv.
 */
function readRecordedCalls(world) {
  const file = recordFilePath(world);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (!raw) return [];
  const lines = raw.split("\n");
  // The trailing element is either "" (complete file) or a partial line.
  lines.pop();
  return lines
    .filter((line) => line.length > 0)
    .map((line) => ({ raw: line, argv: line.split("\t") }));
}

/** The discard invocation this rig is about, or null before it lands. */
function findDiscard(world) {
  return (
    readRecordedCalls(world).find(
      (call) =>
        call.argv.includes("sessions") &&
        call.argv.includes("discard") &&
        call.argv.includes(world.session.id) &&
        call.argv.includes("--yes"),
    ) ?? null
  );
}

/**
 * The fake Hermes host gateway.
 *
 * `/health`, `/v1/capabilities`, `/api/model/options` and the Sessions API are
 * the attach and chat paths the real app uses, exactly as
 * `chat-stalled-turn.electron.mjs` serves them. The three pieces this rig is
 * about:
 *
 *  - `/api/sessions/{id}/chat/stream` answers 200 text/event-stream, writes the
 *    host's paused `event: error` frame, and ENDS the response. That is the
 *    reported host behaviour: the conversation is paused and the stream closes
 *    without a terminal run frame.
 *  - `/api/sessions/{id}/messages` is mutable. Before the shim records the
 *    discard it serves the PAUSED transcript: the seeded message and the
 *    operator's queued turn, no assistant reply. Once the discard record exists
 *    it serves the GROWN transcript with the assistant reply — the resumption.
 *    The reply exists nowhere else, so its appearance in the dock proves the
 *    post-discard re-read.
 *  - Every request is logged with the path it arrived on, the session id, and
 *    (for `/messages`) whether the discard had been recorded when it was served.
 */
function serveGateway(world) {
  const sockets = new Set();
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const state = {
    /** "seeded" until the chat stream POST, then "paused", then "recovered". */
    phase: "seeded",
    sessionListRequests: [],
    messagesRequests: [],
    streamRequests: [],
    fallbackRequests: [],
    /** When a `/messages` request first saw the shim's discard record. */
    discardObservedAt: null,
    discardArgv: null,
    stream: {
      openedAt: null,
      closedAt: null,
      frames: [],
      terminalFrameSent: false,
      runId: "run-paused-e2e",
      input: null,
      sessionId: null,
      path: null,
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

  const userRow = (text, at) => ({ role: "user", content: text, timestamp: at });
  const assistantRow = (text, at) => ({ role: "assistant", content: text, timestamp: at });

  /**
   * The transcript the host would answer with at this moment. The reply is only
   * present in the recovered phase; it was never on the stream and was never in
   * the paused transcript.
   */
  const transcript = () => {
    if (state.phase === "seeded") {
      return [userRow(world.seed.userText, nowSeconds() - 600)];
    }
    const paused = [
      userRow(world.seed.userText, nowSeconds() - 600),
      // The operator's message, committed behind the lost turn and not yet run.
      userRow(world.seed.turnText, nowSeconds() - 5),
    ];
    if (state.phase !== "recovered") return paused;
    return [...paused, assistantRow(world.seed.finalReply, nowSeconds() - 4)];
  };

  /** The rows a `/messages` response is about to carry, for the artifact. */
  const describeRows = (rows) => ({
    count: rows.length,
    roles: rows.map((row) => row.role),
    hasSeed: rows.some((row) => row.content === world.seed.userText),
    hasOperatorTurn: rows.some((row) => row.content === world.seed.turnText),
    hasAssistantReply: rows.some((row) => row.content === world.seed.finalReply),
    lastRole: rows.length > 0 ? rows[rows.length - 1].role : null,
    rows,
  });

  /** Has the shim recorded the discard for THIS session? */
  const discardRecorded = () => findDiscard(world) !== null;

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
      // The composer's pills read the gateway's own catalog; a real-shaped one
      // keeps the control row mounted exactly as the product has it.
      json(res, {
        providers: [
          { slug: "nous", name: "Nous", authenticated: true, models: ["rig-model"] },
        ],
        model: "rig-model",
        provider: "nous",
      });
      return;
    }

    // The attached base URL carries the profile prefix (`/p/<profile>`), so the
    // suffix is what identifies the route — the same shape chat-stalled-turn
    // matches.
    const messagesMatch = pathname.match(/\/api\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      const discarded = discardRecorded();
      if (discarded && state.phase === "paused") {
        // The resumption: the queued message has now run. Record the moment so
        // the artifact can prove the discard preceded the grown read.
        state.phase = "recovered";
        if (state.discardObservedAt === null) {
          state.discardObservedAt = at;
          state.discardArgv = findDiscard(world)?.argv ?? null;
        }
      }
      const rows = transcript();
      state.messagesRequests.push({
        at,
        method: req.method ?? "",
        path: req.url ?? "",
        sessionId,
        afterDiscard: discarded,
        stage: state.phase,
        served: describeRows(rows),
      });
      json(res, { object: "list", data: rows });
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
        // The send was accepted and committed: the transcript now carries the
        // operator's message, but nothing will execute it until the discard.
        state.phase = "paused";
        state.stream.openedAt = startedAt;
        state.stream.sessionId = decodeURIComponent(streamMatch[1]);
        state.stream.input = input;
        state.stream.path = req.url ?? "";
        state.streamRequests.push({
          at: startedAt,
          method: req.method ?? "",
          path: req.url ?? "",
          sessionId: state.stream.sessionId,
          input,
        });

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        // ONE frame, the host's paused frame, then the response ends. No
        // run.* terminal frame: that is the reported bug, and it is also why a
        // terminal-event path cannot be what paints the recovery.
        state.stream.frames = [PAUSED_FRAME];
        state.stream.terminalFrameSent = false;
        res.write(PAUSED_FRAME);
        res.on("finish", () => {
          if (state.stream.closedAt === null) state.stream.closedAt = Date.now();
        });
        res.end();
      });
      return;
    }

    if (pathname.endsWith("/api/sessions") && (req.method ?? "GET") === "GET") {
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

  return listenAvoidingReserved(server).then((port) => ({
    port,
    state,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  }));
}

/** `HERMES_HOME/.env`, written after the fake host has a port and before boot. */
function writeHostEnv(hermesHome, port) {
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

/** The one file the test left for this process: where the world is. */
function readWorld() {
  const dir = process.env.LQ_PAUSED_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_PAUSED_WORLD is required — run this through tests/chat-paused-recovery-e2e.test.ts",
    );
  }
  const file = path.join(dir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no world.json in ${dir} — the test builds the world before spawning this driver`,
    );
  }
  const world = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of [
    "dir",
    "hermesHome",
    "userData",
    "vaultDir",
    "binDir",
    "profile",
    "session",
    "seed",
    "mcpPorts",
  ]) {
    if (!world[key]) throw new Error(`world.json is missing "${key}"`);
  }
  return { ...world, dir };
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
 * so a failure report records what the screen actually still looked like.
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

/**
 * One look at the shipped rail, composer, turn note, error banner and
 * transcript. The note is the renderer's rendering of the terminal frame's
 * `reason`; `panelText` is the whole dock, which is where a dead-end sentence
 * would survive even if the note were right.
 */
const sampleExpression = (world) => `(() => {
  const title = ${JSON.stringify(world.session.title)};
  const text = (el) => ((el && el.textContent) || "").trim();
  const row = Array.from(document.querySelectorAll(".chats-rail__row")).find((li) =>
    text(li.querySelector(".chats-rail__label")) === title) ?? null;
  const input = document.querySelector(".chat-panel__composer-input");
  const send = document.querySelector(".chat-panel__send");
  const errorBox = document.querySelector(".chat-panel__error");
  const messages = document.querySelector(".chat-panel__messages");
  const note = document.querySelector(".chat-panel__turn-note");
  const footer = document.querySelector('[data-testid="turn-footer"]');
  const panel = document.querySelector(".chat-panel");
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
    errorBoxPresent: Boolean(errorBox),
    error: text(errorBox && errorBox.querySelector("p")) || null,
    note: text(note) || null,
    footerStatus: footer ? footer.getAttribute("data-footer-status") : null,
    transcript,
    transcriptHasSeed: transcript.includes(${JSON.stringify(world.seed.userText)}),
    transcriptHasTurn: transcript.includes(${JSON.stringify(world.seed.turnText)}),
    transcriptHasFinal: transcript.includes(${JSON.stringify(world.seed.finalReply)}),
    panelText: text(panel),
  };
})()`;

/** Type a draft the way a person would, without sending it. */
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

/** The two sentences the fix exists to remove. */
const DEAD_END_SENTENCES = [
  "start a new chat",
  "stream closed before the turn finished",
];

async function run() {
  const world = readWorld();
  const host = await serveGateway(world);
  const screenshotFile = path.join(artifactsDir, SCREENSHOT_NAME);
  const recordFile = recordFilePath(world);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const measurements = {
    sendAt: null,
    runningSeenAt: null,
    streamRequestAt: null,
    streamClosedAt: null,
    discardRecordedAt: null,
    discardObservedAt: null,
    recoveredAt: null,
    recoveryMs: null,
    messagesBeforeDiscard: 0,
    messagesAfterDiscard: 0,
    streamIdleMs: null,
  };
  const states = { initial: null, sending: null, running: null, recovered: null, usable: null };
  const consoleErrors = [];
  /** The shim's discard invocation, once it lands; the report carries it. */
  let discard = null;

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
    // The shim records only when pointed at a directory, and this rig points it
    // at its own world. Overriding (not defaulting) keeps a hand-run honest.
    process.env.LQ_PAUSED_RECORD = world.dir;
    const streamIdleMs = 10_000;
    measurements.streamIdleMs = streamIdleMs;
    if (!process.env.LIFEQUEST_E2E) {
      process.env.LIFEQUEST_E2E = JSON.stringify({
        userData: world.userData,
        showWindow: true,
        mcpPorts: world.mcpPorts,
        streamIdleMs,
      });
    } else {
      // Record the seam the app actually booted with, so the test judges the
      // run it asked for rather than the driver's fallback.
      try {
        const parsed = JSON.parse(process.env.LIFEQUEST_E2E);
        if (typeof parsed.streamIdleMs === "number") {
          measurements.streamIdleMs = parsed.streamIdleMs;
        }
      } catch {
        /* the app logs its own invalid-JSON warning; the fallback stands */
      }
    }
    delete process.env.ELECTRON_RUN_AS_NODE;

    // Attach before boot so the boot's own console errors are recorded too: the
    // requirement is that the runtime token never reaches the console either.
    app.on("web-contents-created", (_event, contents) => {
      contents.on("console-message", (event) => {
        if (event.level === "error") consoleErrors.push(event.message);
      });
    });

    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();
    const js = (code) => win.webContents.executeJavaScript(code);

    // ── the rail is up, and the gateway's seeded chat is on it ──────────────
    await waitFor(
      win,
      `Boolean(document.querySelector(".chats-rail"))`,
      "the chats rail (.chats-rail) to mount",
      READY_TIMEOUT_MS,
    );
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

    // ── send the turn: the paused host must really start a run ──────────────
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
        (sample.rowLive === true || sample.sendState === "stop") &&
        sample.composerPresent === true,
      RUNNING_TIMEOUT_MS,
    );
    if (running.ok) measurements.runningSeenAt = Date.now();
    states.running = running.sample;
    check(
      "the rail row shows the running state once the message is sent",
      running.ok && running.sample.rowLive === true,
      `last sample: ${JSON.stringify(running.sample)}`,
    );
    check(
      "the composer shows its stop control while the turn runs",
      running.ok &&
        running.sample.sendState === "stop" &&
        running.sample.sendLabel === "Stop this run",
      `last sample: ${JSON.stringify(running.sample)}`,
    );

    // The app must actually be talking to the fake gateway's paused stream.
    const streamDeadline = Date.now() + STREAM_START_TIMEOUT_MS;
    while (host.state.streamRequests.length === 0 && Date.now() < streamDeadline) {
      await sleep(50);
    }
    const streamRequest = host.state.streamRequests[0] ?? null;
    if (streamRequest) measurements.streamRequestAt = streamRequest.at;
    check(
      "the turn was really sent to the gateway's chat stream",
      streamRequest !== null &&
        streamRequest.method === "POST" &&
        streamRequest.sessionId === world.session.id &&
        String(streamRequest.input ?? "").includes(world.seed.turnText),
      `stream requests: ${JSON.stringify(host.state.streamRequests)}`,
    );
    check(
      "the fake host really paused: one error frame with the runtime token, no terminal run frame",
      host.state.stream.frames.length === 1 &&
        host.state.stream.frames[0] === PAUSED_FRAME &&
        /unknown_execution/.test(host.state.stream.frames[0]) &&
        host.state.stream.terminalFrameSent === false &&
        host.state.streamRequests.length > 0,
      `frames: ${JSON.stringify(host.state.stream.frames)} / terminalFrameSent: ${host.state.stream.terminalFrameSent}`,
    );
    // The real host closes the stream right after that frame; the app must have
    // been reading a closed stream, not a held-open one, for the recovery to be
    // the paused path rather than the idle path.
    const closeDeadline = Date.now() + STREAM_CLOSE_TIMEOUT_MS;
    while (host.state.stream.closedAt === null && Date.now() < closeDeadline) {
      await sleep(50);
    }
    if (host.state.stream.closedAt !== null) {
      measurements.streamClosedAt = host.state.stream.closedAt;
    }
    check(
      "the fake host closed the stream right after the paused frame",
      host.state.stream.closedAt !== null,
      `stream closedAt: ${host.state.stream.closedAt}`,
    );

    // ── the recovery: the dead end must not appear, and the chat must resume ─
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
        sample.errorBoxPresent === false &&
        /paused/i.test(sample.note ?? "") &&
        /recover/i.test(sample.note ?? "") &&
        sample.transcriptHasTurn === true &&
        sample.transcriptHasFinal === true,
      windowLeft,
    );
    if (recovered.ok) {
      measurements.recoveredAt = Date.now();
      measurements.recoveryMs = measurements.recoveredAt - measurements.sendAt;
    }
    states.recovered = recovered.sample;
    check(
      "the chat recovers in place within 15 s of the send",
      recovered.ok,
      `after ${measurements.recoveryMs ?? ">15000"}ms the screen still read: ${JSON.stringify(recovered.sample)}`,
    );
    check(
      "the turn's note names the paused chat and its recovery",
      /paused/i.test(recovered.sample?.note ?? "") &&
        /recover/i.test(recovered.sample?.note ?? ""),
      `note on screen: ${JSON.stringify(recovered.sample?.note ?? null)}`,
    );
    check(
      "the note is the recovered turn's, not the generic stream-closed footer",
      recovered.sample?.footerStatus === "incomplete" &&
        !/stream closed before the turn finished/i.test(recovered.sample?.note ?? ""),
      `footer status: ${JSON.stringify(recovered.sample?.footerStatus)} / note: ${JSON.stringify(recovered.sample?.note ?? null)}`,
    );
    check(
      "the transcript shows the answer to the message that was queued behind the lost turn",
      recovered.sample?.transcriptHasTurn === true &&
        recovered.sample?.transcriptHasFinal === true,
      `transcript after recovery: ${JSON.stringify(recovered.sample?.transcript ?? null)}`,
    );
    check(
      "the conversation kept its history: the earlier message is still on screen",
      recovered.sample?.transcriptHasSeed === true,
      `transcript after recovery: ${JSON.stringify(recovered.sample?.transcript ?? null)}`,
    );
    check(
      "the paused error banner is gone (no runtime token, no dead end)",
      recovered.sample?.errorBoxPresent === false && recovered.sample?.error === null,
      `error banner: ${JSON.stringify(recovered.sample?.error ?? null)}`,
    );
    for (const sentence of DEAD_END_SENTENCES) {
      check(
        `the dock no longer says "${sentence}"`,
        !new RegExp(sentence, "i").test(recovered.sample?.panelText ?? ""),
        `dock text: ${JSON.stringify(recovered.sample?.panelText ?? null)}`,
      );
    }
    check(
      "the runtime token never reaches the screen",
      !/unknown_execution/i.test(recovered.sample?.panelText ?? ""),
      `dock text: ${JSON.stringify(recovered.sample?.panelText ?? null)}`,
    );
    check(
      "the rail row is not left running after the recovery",
      recovered.sample?.rowLive === false && recovered.sample?.liveChip === null,
      `recovered sample: ${JSON.stringify(recovered.sample)}`,
    );

    // ── the app really asked Hermes to recover ──────────────────────────────
    const recordDeadline = Date.now() + DISCARD_RECORD_TIMEOUT_MS;
    discard = findDiscard(world);
    while (discard === null && Date.now() < recordDeadline) {
      await sleep(50);
      discard = findDiscard(world);
    }
    if (discard !== null) {
      try {
        measurements.discardRecordedAt = Math.round(fs.statSync(recordFile).mtimeMs);
      } catch {
        measurements.discardRecordedAt = null;
      }
    }
    measurements.discardObservedAt = host.state.discardObservedAt;
    const expectedArgv = ["-p", world.profile, "sessions", "discard", world.session.id, "--yes"];
    check(
      "the app ran the real recovery: `hermes -p <rig-profile> sessions discard <id> --yes`",
      discard !== null && JSON.stringify(discard.argv) === JSON.stringify(expectedArgv),
      `recorded discard: ${JSON.stringify(discard)} / expected argv: ${JSON.stringify(expectedArgv)} / record file: ${recordFile}`,
    );
    check(
      "the recorded discard names this rig's session and profile",
      discard !== null &&
        discard.argv.includes(world.profile) &&
        discard.argv.includes(world.session.id) &&
        discard.argv[discard.argv.indexOf("-p") + 1] === world.profile,
      `recorded discard: ${JSON.stringify(discard)}`,
    );

    // ── the transcript really was re-read AFTER the discard ─────────────────
    await sleep(MESSAGES_SETTLE_MS);
    const messagesRequests = host.state.messagesRequests;
    const before = messagesRequests.filter((request) => request.afterDiscard === false);
    const after = messagesRequests.filter((request) => request.afterDiscard === true);
    measurements.messagesBeforeDiscard = before.length;
    measurements.messagesAfterDiscard = after.length;
    const baseline = before.reduce(
      (largest, request) => Math.max(largest, request.served.count),
      0,
    );
    const grown = after.find(
      (request) =>
        request.served.count > baseline &&
        request.served.hasAssistantReply === true &&
        request.served.lastRole === "assistant" &&
        request.sessionId === world.session.id,
    );
    check(
      "the transcript was re-read from the gateway after the discard",
      after.length > 0,
      `messages requests: ${JSON.stringify(messagesRequests)}`,
    );
    check(
      "the post-discard read returned the grown transcript with the assistant reply",
      Boolean(grown),
      `baseline rows: ${baseline} / post-discard requests: ${JSON.stringify(after)}`,
    );
    check(
      "the reply was never in the transcript before the discard (the stream could not have carried it)",
      before.every((request) => request.served.hasAssistantReply === false),
      `pre-discard requests: ${JSON.stringify(before)}`,
    );
    check(
      "the fake host saw the discard before it served the grown transcript",
      after.every((request) => request.afterDiscard === true) &&
        host.state.discardObservedAt !== null,
      `discard observed at: ${host.state.discardObservedAt} / post-discard requests: ${JSON.stringify(after)}`,
    );

    // ── the composer takes input again (not merely un-disabled) ─────────────
    const probeDraft = "A draft typed after the recovery";
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

    // ── hermeticity: this run touched only its own throwaway world ──────────
    const pathParts = (process.env[pathKey] ?? "").split(path.delimiter);
    const hermeticity = {
      profile: world.profile,
      hermesHome: world.hermesHome,
      hermesHomeUnderTmp: world.hermesHome.startsWith(os.tmpdir()),
      worldUnderTmp: world.dir.startsWith(os.tmpdir()),
      userDataUnderWorld: world.userData.startsWith(world.dir),
      vaultUnderWorld: world.vaultDir.startsWith(world.dir),
      binDir: world.binDir,
      stubPath: path.join(world.binDir, "hermes"),
      stubFirstOnPath: pathParts[0] === world.binDir,
      recordFile,
      recordFileUnderWorld: recordFile.startsWith(world.dir),
      gatewayPort: host.port,
      gatewayPortReserved: RESERVED_PORTS.includes(host.port),
      mcpPorts: world.mcpPorts,
      mcpPortsReserved: RESERVED_PORTS.filter(
        (port) => world.mcpPorts.local === port || world.mcpPorts.invite === port,
      ),
      reservedPorts: RESERVED_PORTS,
    };
    check(
      "the rig ran on its own profile, not a real Hermes install",
      hermeticity.profile === RIG_PROFILE &&
        hermeticity.hermesHomeUnderTmp &&
        hermeticity.worldUnderTmp,
      `hermeticity: ${JSON.stringify(hermeticity)}`,
    );
    check(
      "the app's userData, vault, and CLI resolution are the rig's own",
      hermeticity.userDataUnderWorld &&
        hermeticity.vaultUnderWorld &&
        hermeticity.stubFirstOnPath &&
        fs.existsSync(hermeticity.stubPath) &&
        hermeticity.recordFileUnderWorld,
      `hermeticity: ${JSON.stringify(hermeticity)}`,
    );
    check(
      "no product port was bound (8642/8643/8646)",
      hermeticity.gatewayPortReserved === false && hermeticity.mcpPortsReserved.length === 0,
      `hermeticity: ${JSON.stringify(hermeticity)}`,
    );
    check(
      "the runtime token did not reach the console",
      consoleErrors.every((line) => !/unknown_execution/i.test(line)),
      `console errors: ${JSON.stringify(consoleErrors)}`,
    );

    // ── the picture is this window's capture of the recovered chat ──────────
    // The thread parks at its bottom, which would cut the note off the capture.
    // The recovered thread fits on one screen, so rest it at the top: the note
    // and the recovered reply are one still.
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
      `the fake host served GET /p/${world.profile}/api/sessions/${world.session.id}/messages: the paused transcript before the discard record existed and the grown transcript (operator turn + assistant reply) after it`,
    );
    notes.push(
      `the reply ${JSON.stringify(world.seed.finalReply)} exists only in the post-discard transcript; the stream carried only the paused error frame, so its presence on screen proves the re-read`,
    );
    notes.push(
      `the shim recorded ${readRecordedCalls(world).length} invocation(s); the discard was ${JSON.stringify(discard?.argv ?? null)}`,
    );
    if (measurements.recoveryMs !== null) {
      notes.push(`the chat was usable again ${measurements.recoveryMs}ms after the send`);
    }
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
    what: "the real app, after Hermes pauses a conversation with its paused `event: error` frame and closes the stream, runs `hermes sessions discard` for the open vault's profile, re-reads the transcript until the queued message answers, paints that answer and a note naming the recovery, and leaves the composer send-enabled — without ever telling the operator to start a new chat",
    why: "a paused conversation accepted and committed every send but never executed it, and the dock only showed the runtime token and the stream-closed footer; Hermes can acknowledge the lost turn non-replayingly, after which the queued message runs and its answer lands in the transcript the app can re-read",
    world: {
      profile: world.profile,
      profilePath: path.join(world.hermesHome, "profiles", world.profile),
      sessionId: world.session.id,
      sessionTitle: world.session.title,
      gatewayPort: host.port,
      devServerUrl: DEV_SERVER_URL,
      hermesHome: world.hermesHome,
      userData: world.userData,
      vaultDir: world.vaultDir,
      binDir: world.binDir,
      recordFile,
    },
    measurements,
    states,
    gateway: {
      sessionListRequests: host.state.sessionListRequests,
      messagesRequests: host.state.messagesRequests,
      streamRequests: host.state.streamRequests,
      stream: {
        openedAt: host.state.stream.openedAt,
        closedAt: host.state.stream.closedAt,
        frames: host.state.stream.frames,
        errorFrame: PAUSED_FRAME,
        terminalFrameSent: host.state.stream.terminalFrameSent,
        input: host.state.stream.input,
        sessionId: host.state.stream.sessionId,
        path: host.state.stream.path,
      },
      discard: {
        recorded: discard !== null,
        argv: discard?.argv ?? null,
        rawLine: discard?.raw ?? null,
        recordedAt: measurements.discardRecordedAt,
        observedAt: host.state.discardObservedAt,
        recordFile,
        allInvocations: readRecordedCalls(world).map((call) => call.argv),
      },
      fallbackRequests: host.state.fallbackRequests.slice(0, 40),
    },
    hermeticity: {
      profile: world.profile,
      hermesHome: world.hermesHome,
      recordFile,
      gatewayPort: host.port,
      mcpPorts: world.mcpPorts,
      reservedPorts: RESERVED_PORTS,
    },
    consoleErrors,
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
    console.error(`[chat-paused-recovery] could not write the artifact: ${error}`);
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
