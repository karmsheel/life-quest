/**
 * The foreign-chat rig: does the real app continue a chat another surface owns
 * (a Telegram chat) over the Hermes gateway's canonical JSON-RPC WebSocket —
 * the same stored session, streamed into the live dock — while a normal
 * api_server chat keeps using the REST chat stream?
 *
 * WHY THIS RIG EXISTS
 *
 * The Chats list has always listed every conversation on the companion's Hermes
 * profile, whichever surface started it, and the app has always read their
 * transcripts through `GET /api/sessions/{id}/messages`. Sending into one did
 * not work: `POST /api/sessions/{id}/chat[/stream]` is the API transport's door,
 * and Hermes refuses a turn aimed at a session another surface owns
 * (`permission_denied` from `gateway/session_api_turn.py`; the dock showed
 * "Chat stream failed (500)"). Hermes' own answer is to attach through the
 * gateway WebSocket (`session.resume` + `prompt.submit`), which is what this rig
 * exercises against the REAL app.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The rig talks HTTP only and the "continue" never reaches the WS. The
 *      fake gateway records every `session.resume` / `prompt.submit` /
 *      `session.interrupt` frame, the connection's subprotocols and the ticket
 *      minted over the control socket; the artifact fails without them.
 *   2. The app falls back to the API transport and the fake API answers anyway.
 *      The fake API's session-chat route is the rigorous refusal the real
 *      gateway gives (HTTP 500 permission_denied) and every hit is recorded;
 *      the telegram turn must produce zero hits for the telegram session.
 *   3. The reply is painted from the REST transcript rather than from streamed
 *      WS frames. The fake REST transcript NEVER contains the WS-only reply
 *      text; only the WebSocket frames carry it, so its presence in the DOM
 *      proves the WS path. The served transcripts are in the artifact.
 *   4. The chat is continued into a different session. `session.resume` and
 *      `prompt.submit` must name the telegram session id, and no POST
 *      /api/sessions create may happen (that would be a new chat).
 *   5. Stop is never exercised. A second turn is admitted, held running, and
 *      the dock's own stop control is clicked; `session.interrupt` must reach
 *      the socket naming the telegram session.
 *   6. The api_server chat is silently rerouted through the WS too. Its turn is
 *      sent from the same dock and MUST hit the fake API's chat stream and
 *      paint its reply; no prompt.submit may name it.
 *   7. The screenshot is stale or blank. It is this window's own
 *      `capturePage()` while the dock shows the Telegram chip and the WS-only
 *      reply, and the test requires >10 KB on disk.
 *   8. The rig touches the operator's Hermes, vault, or app. `HERMES_HOME` is a
 *      temp dir, a stub `hermes` is first on PATH and records every invocation,
 *      the profile is `lq-foreign-e2e` (no real install has it), the vault is a
 *      throwaway `createVault()`, userData and MCP doors are moved, and the
 *      combined REST/WS gateway binds 127.0.0.1 on a free port.
 *   9. The report contradicts itself. `tests/foreign-chat-e2e.test.ts`
 *      re-derives every claim from the artifact and the filesystem.
 *
 * Run by `tests/foreign-chat-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME`, profile store, throwaway vault, `recent.json`, stub `hermes`
 * with the endpoint JSON, world.json) and passes it as `LQ_FOREIGN_WORLD`:
 *
 *   LQ_FOREIGN_WORLD=<dir> <electron> e2e/foreign-chat.electron.mjs
 *
 * The driver starts the combined gateway on the free port the test chose,
 * boots the REAL main process through `bootForE2e`, drives the REAL rail,
 * dock and composer, and writes `e2e/artifacts/foreign-chat.json` plus
 * `e2e/artifacts/foreign-chat.png`. Exit 0 = its checks held.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { WebSocketServer } from "ws";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const REPORT_NAME = "foreign-chat.json";
const SCREENSHOT_NAME = "foreign-chat.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

const WS_PROTOCOL = "hermes-gateway-v1";
const WS_TICKET_PREFIX = "hermes-gateway-ticket.";

/** How long the app may take to mount the rail, open a chat and send. */
const MOUNT_TIMEOUT_MS = 90_000;
const ACTION_TIMEOUT_MS = 20_000;

const failures = [];
const checks = [];
const notes = [];
const measurements = {};

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) {
    console.error(`[foreign-chat] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many times `needle` appears in `text` (0 when `needle` is empty). */
function countIn(text, needle) {
  if (!text || !needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/** The one file the test left for this process: where the world is. */
function readWorld() {
  const dir = process.env.LQ_FOREIGN_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_FOREIGN_WORLD is required — run this through tests/foreign-chat-e2e.test.ts",
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
    "hermesHome",
    "userData",
    "binDir",
    "callsDir",
    "profile",
    "gatewayPort",
    "sessions",
    "seed",
  ]) {
    if (!world[key]) throw new Error(`world.json is missing "${key}"`);
  }
  return { dir, ...world };
}

/** `HERMES_HOME/.env`, written before the main process is imported. */
function writeHostEnv(hermesHome, port) {
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

/** The stub `hermes`' invocation log: one marker file per call. */
function readCliLog(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const calls = [];
  for (const name of names) {
    let body;
    let at;
    try {
      body = fs.readFileSync(path.join(dir, name), "utf8");
      at = fs.statSync(path.join(dir, name)).birthtimeMs;
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    const hermesHome = lines
      .find((line) => line.startsWith("HERMES_HOME="))
      ?.slice("HERMES_HOME=".length);
    calls.push({ at, argv: lines[0] ?? "", hermesHome: hermesHome ?? null, raw: name });
  }
  return calls.sort((a, b) => a.at - b.at);
}

/**
 * The gateway's local control socket — the same socket `hermes-control.ts`
 * speaks, and the one `session-ticket` is minted on.
 *
 * It answers the protocol-1 envelope every caller expects (`ok`, `protocol: 1`,
 * the request id, and an object `result`), and records the ticket grants so the
 * WS connection's ticket subprotocol can be checked against them. The generic
 * `identify` / `serve-profile` answers keep the app's ordinary boot-time
 * attach refresh path working without pretending to be a real host.
 */
async function serveControl(world) {
  const state = { requests: [], tickets: [], ticketSeq: 0 };
  const socketPath = path.join(world.hermesHome, "gateway.sock");
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {
    /* nothing left over */
  }
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          continue;
        }
        const verb = typeof request.verb === "string" ? request.verb : "";
        const id = typeof request.id === "number" ? request.id : 1;
        const params =
          request.params && typeof request.params === "object"
            ? request.params
            : {};
        state.requests.push({ at: Date.now(), verb, id, params });
        let result = {};
        if (verb === "session-ticket") {
          state.ticketSeq += 1;
          const ticket = `ticket-foreign-e2e-${state.ticketSeq}`;
          state.tickets.push({ at: Date.now(), ticket, params });
          result = { ticket };
        } else if (verb === "identify") {
          result = { profile: "gateway-e2e", served_profiles: [] };
        } else if (verb === "serve-profile") {
          result = { served: params.name ?? world.profile };
        } else if (verb === "unserve-profile") {
          result = { unserved: params.name ?? world.profile };
        } else if (verb === "rescan-profiles") {
          result = { profiles: [world.profile] };
        }
        const reply = {
          ok: true,
          protocol: 1,
          id,
          result,
          ...(verb === "session-ticket" ? { ticket: result.ticket } : {}),
        };
        socket.write(`${JSON.stringify(reply)}\n`);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // A Unix domain socket, not a TCP port: this is the path
    // `hermes-control.ts` stats and connects to.
    server.listen(socketPath, () => resolve());
  }).catch((error) => {
    throw new Error(
      `could not bind the control socket at ${socketPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return {
    state,
    close: () =>
      new Promise((resolve) => {
        try {
          server.close(() => {
            try {
              fs.rmSync(socketPath, { force: true });
            } catch {
              /* already gone */
            }
            resolve();
          });
        } catch {
          resolve();
        }
      }),
  };
}

/**
 * The fake Hermes host: REST (the attach and transcript paths the app already
 * uses), the control socket's ticket grants, and the canonical JSON-RPC
 * WebSocket.
 *
 * REST deliberately refuses a turn on the telegram session exactly as the real
 * gateway does (HTTP 500 `permission_denied`), and never puts the WS-only reply
 * in a transcript. The WebSocket records every frame in both directions and
 * answers resume/submit/interrupt; it streams the reply only for the telegram
 * session, and only when this rig's dock sends a prompt.
 */
async function buildGateway(world, controlState) {
  const tg = world.sessions.telegram;
  const dc = world.sessions.discord;
  const api = world.sessions.api;
  const foreign = [tg, dc];
  const allSessions = [tg, dc, api];
  const seed = world.seed;
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const state = {
    requests: [],
    sessionsRequests: [],
    messagesRequests: [],
    modelRequests: [],
    streamRequests: [],
    createRequests: [],
    refusals: [],
    restServed: {},
    /** Every SSE frame the fake API wrote for the api_server chat, in order. */
    apiFrames: [],
    ws: {
      upgrades: [],
      connections: [],
      in: [],
      out: [],
      resume: [],
      submit: [],
      interrupt: [],
      submitCounts: {},
      unexpectedTurns: [],
    },
  };
  const sockets = new Set();
  const restPrefix = `/p/${world.profile}`;
  const routeOf = (pathname) => {
    if (pathname === restPrefix) return "/";
    if (pathname.startsWith(`${restPrefix}/`)) return pathname.slice(restPrefix.length);
    return pathname;
  };

  const json = (res, payload, status = 200) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));

  const sessionRow = (session) => ({
    id: session.id,
    title: session.title,
    preview: session.transcript[0]?.content ?? "",
    source: session.source,
    started_at: nowSeconds() - 900,
    last_activity: nowSeconds() - 120,
    pinned: false,
    archived: false,
    hidden: false,
    message_count: session.transcript.length,
  });

  const sessionById = (id) =>
    allSessions.find((session) => session.id === id) ?? null;

  const transcriptFor = (id) => {
    const session = sessionById(id);
    if (!session) return null;
    const rows = session.transcript.map((row, index) => ({
      role: row.role,
      content: row.content,
      timestamp: nowSeconds() - 600 + index,
    }));
    state.restServed[id] = rows;
    return rows;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = routeOf(url.pathname);
    const at = Date.now();
    const request = { at, method: req.method ?? "", path: req.url ?? "", route };
    state.requests.push(request);

    if (route.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (route === "/v1/capabilities") {
      json(res, {
        features: {
          session_list: true,
          session_chat: true,
          session_chat_stream: true,
        },
      });
      return;
    }
    if (route === "/api/model/options") {
      state.modelRequests.push(request);
      json(res, {
        providers: [
          { slug: "nous", name: "Nous", authenticated: true, models: ["rig-model"] },
        ],
        model: "rig-model",
        provider: "nous",
      });
      return;
    }

    const messagesMatch = route.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      state.messagesRequests.push({ ...request, sessionId });
      const rows = transcriptFor(sessionId);
      if (!rows) {
        json(res, { object: "error", error: "not_found" }, 404);
        return;
      }
      json(res, { object: "list", data: rows });
      return;
    }

    const chatStreamMatch = route.match(/^\/api\/sessions\/([^/]+)\/chat\/stream$/);
    if (chatStreamMatch) {
      const sessionId = decodeURIComponent(chatStreamMatch[1]);
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let input = null;
        try {
          const parsed = JSON.parse(body);
          input = typeof parsed.input === "string" ? parsed.input : null;
        } catch {
          /* the request row still names the POST */
        }
        const record = {
          at: Date.now(),
          method: req.method ?? "",
          path: req.url ?? "",
          sessionId,
          input,
        };
        // The real gateway's refusal for a chat another surface owns. This is
        // the 500 the dock used to show as "Chat stream failed (500)".
        if (foreign.some((session) => session.id === sessionId)) {
          state.refusals.push({ ...record, status: 500, body: seed.refusalBody });
          json(res, seed.refusalBody, 500);
          return;
        }
        if (sessionId !== api.id) {
          json(res, { object: "error", error: "not_found" }, 404);
          return;
        }
        state.streamRequests.push(record);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const runId = "run-api-e2e";
        const frame = (name, payload) => {
          state.apiFrames.push({ at: Date.now(), name, payload });
          return `event: ${name}\ndata: ${JSON.stringify({ ...payload, type: name, run_id: runId, session_id: api.id })}\n\n`;
        };
        // The same shape a real REST turn has: a narration delta before the
        // tool, then `assistant.completed` carrying the authoritative whole
        // reply, then its terminal frame. Staggered, because a real gateway
        // answers over time and not in one tick.
        const schedule = [
          [0, () => res.write(frame("run.started", {}))],
          [50, () => res.write(frame("assistant.delta", { text: seed.apiNarration }))],
          [
            100,
            () =>
              res.write(
                frame("tool.started", {
                  name: "vault_search",
                  preview: "Searching the vault for the open tasks",
                }),
              ),
          ],
          [150, () => res.write(frame("tool.completed", { name: "vault_search" }))],
          [
            200,
            () => res.write(frame("assistant.completed", { content: seed.apiReply })),
          ],
          [
            260,
            () => {
              res.write(
                frame("run.completed", {
                  usage: { input_tokens: 8, output_tokens: 6 },
                }),
              );
              res.end();
            },
          ],
        ];
        for (const [delay, run] of schedule) {
          setTimeout(() => {
            try {
              run();
            } catch {
              /* the client went away */
            }
          }, delay);
        }
      });
      return;
    }

    if (route === "/api/sessions" && (req.method ?? "GET") === "GET") {
      state.sessionsRequests.push(request);
      json(res, { object: "list", data: allSessions.map(sessionRow) });
      return;
    }
    if (route === "/api/sessions" && (req.method ?? "POST") === "POST") {
      state.createRequests.push(request);
      json(res, {
        object: "hermes.session",
        session: {
          id: "created-by-app-e2e",
          title: "A new chat",
          source: "api_server",
          started_at: nowSeconds(),
          last_activity: nowSeconds(),
          pinned: false,
          archived: false,
          hidden: false,
          message_count: 0,
        },
      });
      return;
    }

    const singleMatch = route.match(/^\/api\/sessions\/([^/]+)$/);
    if (singleMatch) {
      const sessionId = decodeURIComponent(singleMatch[1]);
      const session = sessionById(sessionId);
      if (!session) {
        json(res, { object: "error", error: "not_found" }, 404);
        return;
      }
      json(res, { object: "hermes.session", session: sessionRow(session) });
      return;
    }

    // Older/newer attach paths must not fail the run for an endpoint this rig
    // is not about.
    json(res, {});
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  /* ── the canonical JSON-RPC WebSocket ─────────────────────────────────── */

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      const offered = [...protocols];
      state.ws.upgrades.push({ at: Date.now(), offered });
      if (offered.includes(WS_PROTOCOL)) return WS_PROTOCOL;
      return offered[0] ?? false;
    },
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const record = {
      at: Date.now(),
      path: req.url ?? "",
      protocols: String(req.headers["sec-websocket-protocol"] ?? ""),
    };
    state.ws.upgrades.push(record);
    if (!/\/api\/ws\/?$/.test(url.pathname)) {
      record.rejected = "not /api/ws";
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const send = (ws, frame) => {
    if (ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  };

  const reply = (ws, id, result) => {
    if (id === undefined || id === null) return;
    send(ws, { jsonrpc: "2.0", id, result });
  };

  const notify = (ws, type, sessionId, payload = {}) => {
    const frame = {
      jsonrpc: "2.0",
      method: "event",
      params: {
        type,
        ...(sessionId ? { session_id: sessionId } : {}),
        payload: { ...payload, ...(sessionId ? { session_id: sessionId } : {}) },
      },
    };
    if (!send(ws, frame)) return false;
    state.ws.out.push({
      at: Date.now(),
      type,
      session_id: sessionId ?? null,
      payload,
    });
    return true;
  };

  const at = (ws, delayMs, run) =>
    setTimeout(() => {
      if (ws.readyState === 1) run();
    }, delayMs);

  const streamTurn = (ws, session, admissionId) => {
    const runId = `wsrun-e2e-${session.id}`;
    const turn = session.turn;
    // Real pacing: the gateway answers resume/submit promptly, then streams.
    // A zero-latency fake would let the renderer's invoke reply beat the queued
    // event frames (a pre-existing IPC race), splitting the turn for a reason
    // that is the fake's; a real turn cannot be that fast.
    const schedule = [
      [40, () =>
        notify(ws, "message.delta", session.id, {
          run_id: runId,
          text: turn.narration,
        })],
      [90, () =>
        notify(ws, "tool.start", session.id, {
          run_id: runId,
          tool_id: `tool-e2e-${session.id}`,
          name: "vault_search",
          args: { query: session.title },
          preview: `Searching the vault for ${session.title}`,
        })],
      [140, () =>
        notify(ws, "tool.complete", session.id, {
          run_id: runId,
          tool_id: `tool-e2e-${session.id}`,
          name: "vault_search",
          result_text: `Found the notes for ${session.title}`,
          summary: `Found the notes for ${session.title}`,
          duration_s: 0.05,
        })],
      [190, () =>
        notify(ws, "message.delta", session.id, {
          run_id: runId,
          text: turn.replyPrefix,
        })],
      [280, () =>
        notify(ws, "message.complete", session.id, {
          run_id: runId,
          admission_id: admissionId,
          outcome: "completed",
          status: "complete",
          text: turn.reply,
          usage: { input_tokens: 42, output_tokens: 24 },
        })],
    ];
    for (const [delay, run] of schedule) at(ws, delay, run);
  };

  const streamSecondTurnPartial = (ws, sessionId, admissionId) => {
    const runId = "wsrun-e2e-2";
    at(ws, 40, () =>
      notify(ws, "message.delta", sessionId, {
        run_id: runId,
        admission_id: admissionId,
        text: seed.secondPartial,
      }),
    );
  };

  wss.on("connection", (ws, req) => {
    const offered = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const ticketProtocol = offered.find((part) =>
      part.startsWith(WS_TICKET_PREFIX),
    );
    const ticket = ticketProtocol
      ? ticketProtocol.slice(WS_TICKET_PREFIX.length)
      : null;
    const connection = {
      at: Date.now(),
      path: req.url ?? "",
      protocols: offered,
      protocol: ws.protocol,
      ticket,
      ticketMinted: Boolean(
        ticket && controlState.tickets.some((grant) => grant.ticket === ticket),
      ),
      framesIn: 0,
      framesOut: 0,
      closedAt: null,
    };
    state.ws.connections.push(connection);

    ws.on("close", () => {
      connection.closedAt = Date.now();
    });
    ws.on("error", () => {});

    // The gateway answers `gateway.ready` before it serves any request.
    if (notify(ws, "gateway.ready", null, {
      instance_id: "gw-foreign-e2e",
      runtime_protocol: 1,
      capabilities: ["session-authority-v1"],
    })) {
      connection.framesOut += 1;
    }

    ws.on("message", (raw) => {
      const text = String(raw);
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      const method = typeof message.method === "string" ? message.method : "";
      const params =
        message.params && typeof message.params === "object"
          ? message.params
          : {};
      const entry = {
        at: Date.now(),
        method,
        id: typeof message.id === "number" ? message.id : null,
        params,
        raw: text,
      };
      state.ws.in.push(entry);
      connection.framesIn += 1;

      if (method === "ping") {
        reply(ws, message.id, { ok: true });
        return;
      }
      if (method === "session.resume") {
        state.ws.resume.push(entry);
        reply(ws, message.id, {
          stored_session_id: params.session_id,
          subscription_id: `sub-${state.ws.resume.length}`,
          pending: false,
          running: false,
          session_id: params.session_id,
        });
        return;
      }
      if (method === "prompt.submit") {
        state.ws.submit.push(entry);
        const sessionId = String(params.session_id ?? "");
        state.ws.submitCounts[sessionId] =
          (state.ws.submitCounts[sessionId] ?? 0) + 1;
        const count = state.ws.submitCounts[sessionId];
        const admissionId = `adm-${count}`;
        reply(ws, message.id, {
          admission_id: admissionId,
          status: "started",
          session_id: sessionId,
          submission_id: params.submission_id ?? null,
        });
        const session = sessionById(sessionId);
        if (session && foreign.some((row) => row.id === sessionId) && count === 1) {
          streamTurn(ws, session, admissionId);
        } else if (sessionId === tg.id && count === 2) {
          streamSecondTurnPartial(ws, sessionId, admissionId);
        } else {
          // A turn on a chat this rig never expected on the WS. Recorded so the
          // test fails with a named detail rather than a silent hang.
          state.ws.unexpectedTurns.push({ at: Date.now(), sessionId, count });
          at(ws, 60, () =>
            notify(ws, "message.complete", sessionId, {
              outcome: "completed",
              status: "complete",
              text: "UNEXPECTED-WS-TURN",
            }),
          );
        }
        return;
      }
      if (method === "session.interrupt") {
        const entryInterrupt = {
          ...entry,
          session_id: String(params.session_id ?? ""),
        };
        state.ws.interrupt.push(entryInterrupt);
        reply(ws, message.id, { ok: true, interrupted: true });
        // The gateway's own terminal frame settles the dock's turn; the RPC
        // reply alone does not.
        if (String(params.session_id ?? "") === tg.id) {
          at(ws, 40, () =>
            notify(ws, "message.complete", String(params.session_id ?? ""), {
              outcome: "interrupted",
              status: "interrupted",
              usage: { input_tokens: 12, output_tokens: 3 },
            }),
          );
        }
        return;
      }
      reply(ws, message.id, { ok: true });
    });
  });

  const port = await listen(server, world.gatewayPort).catch((error) => {
    throw new Error(
      `could not bind the fake gateway on 127.0.0.1:${world.gatewayPort}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return {
    port,
    address: "127.0.0.1",
    state,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        try {
          wss.close();
        } catch {
          /* already closed */
        }
        server.close(() => resolve());
      }),
  };
}

/* ── the live DOM ───────────────────────────────────────────────────────── */

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

/** Poll an async predicate; a timeout is data for the artifact, not a crash. */
async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await predicate();
    } catch {
      ok = false;
    }
    if (ok) return { ok: true, at: Date.now(), label };
    if (Date.now() >= deadline) return { ok: false, at: Date.now(), label };
    await sleep(100);
  }
}

/**
 * One look at the shipped rail, dock header, composer and transcript.
 *
 * The hooks are the renderer's own: the sidebar row and the dock header carry
 * `data-continuable`/`data-source`; the chip is `.chat-panel__source`; the
 * composer's shared-conversation note is `.chat-panel__composer-note`; every
 * control a continued turn cannot carry is `[data-continued-disabled="true"]`.
 */
function snapshotExpression(world) {
  const telegramTitle = world.sessions.telegram.title;
  const discordTitle = world.sessions.discord.title;
  const apiTitle = world.sessions.api.title;
  return `(() => {
    const text = (el) => ((el && el.textContent) || "").trim();
    const attr = (el, name) => (el ? el.getAttribute(name) : null);
    // Text a person can actually read: a visually-hidden word is in the DOM
    // but not painted, so it must not count as "the word is shown".
    const paintedText = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let out = "";
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || parent.closest(".visually-hidden")) continue;
        out += node.textContent ?? "";
      }
      return out.replace(/\s+/g, " ").trim();
    };
    const rows = Array.from(document.querySelectorAll(".chats-rail__row")).map((li) => {
      const markSlot = li.querySelector(".chats-rail__mark");
      const markSvg = markSlot ? markSlot.querySelector("svg[data-platform-mark]") : null;
      return {
        label: text(li.querySelector(".chats-rail__label")),
        continuable: attr(li, "data-continuable"),
        source: attr(li, "data-source"),
        live: li.hasAttribute("data-live"),
        archived: li.hasAttribute("data-archived"),
        rowText: text(li),
        mark: markSvg ? markSvg.getAttribute("data-platform-mark") : null,
        markText: markSlot ? paintedText(markSlot) : "",
        markSlotSvgs: markSlot ? markSlot.querySelectorAll("svg").length : 0,
        hasDot: Boolean(markSlot && markSlot.querySelector(".chats-rail__dot")),
      };
    });
    const tabs = Array.from(document.querySelectorAll(".chat-panel__tab")).map((tab) => {
      const markSlot = tab.querySelector(".chat-panel__tab-mark");
      const markSvg = markSlot ? markSlot.querySelector("svg[data-platform-mark]") : null;
      return {
        id: attr(tab, "data-tab-id"),
        source: attr(tab, "data-source"),
        mark: markSvg ? markSvg.getAttribute("data-platform-mark") : null,
        markText: markSlot ? paintedText(markSlot) : "",
        label: text(tab),
        active: tab.classList.contains("chat-panel__tab--active"),
      };
    });
    const header = document.querySelector(".chat-panel__header--thread");
    const chip = document.querySelector(".chat-panel__source");
    const chipLabel = chip ? chip.querySelector(".chat-panel__source-label") : null;
    const chipHidden = chip ? chip.querySelector(".visually-hidden") : null;
    const chipHiddenRect = chipHidden ? chipHidden.getBoundingClientRect() : null;
    const chipMarkSvg = chip ? chip.querySelector("svg[data-platform-mark]") : null;
    const note = document.querySelector(".chat-panel__composer-note");
    const disabledControls = Array.from(
      document.querySelectorAll('[data-continued-disabled="true"]'),
    ).map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === "string" ? el.className : "",
      testid: attr(el, "data-testid"),
      label: attr(el, "aria-label"),
      title: attr(el, "title"),
      disabled: el.disabled === true || attr(el, "aria-disabled") === "true",
      state: attr(el, "data-state"),
    }));
    const messages = document.querySelector(".chat-panel__messages");
    const input = document.querySelector(".chat-panel__composer-input");
    const send = document.querySelector(".chat-panel__send");
    return {
      at: Date.now(),
      hasRail: Boolean(document.querySelector(".chats-rail")),
      rows,
      telegramRow: rows.find((row) => row.label === ${JSON.stringify(telegramTitle)}) ?? null,
      discordRow: rows.find((row) => row.label === ${JSON.stringify(discordTitle)}) ?? null,
      apiRow: rows.find((row) => row.label === ${JSON.stringify(apiTitle)}) ?? null,
      tabs,
      hasHeader: Boolean(header),
      headerContinuable: attr(header, "data-continuable"),
      headerSource: attr(header, "data-source"),
      headerText: header ? text(header) : null,
      hasChip: Boolean(chip),
      chipText: chipLabel ? text(chipLabel) : chip ? text(chip) : null,
      chipTitle: chip ? attr(chip, "title") : null,
      chipSource: chip ? attr(chip, "data-source") : null,
      chipVariantMark: chip
        ? chip.classList.contains("chat-panel__source--mark")
        : false,
      chipMark: chipMarkSvg ? chipMarkSvg.getAttribute("data-platform-mark") : null,
      chipRole: chip ? attr(chip, "role") : null,
      chipAriaLabel: chip ? attr(chip, "aria-label") : null,
      chipHasLabelElement: Boolean(chipLabel),
      chipHiddenText: chipHidden ? text(chipHidden) : null,
      chipHiddenWidth: chipHiddenRect ? chipHiddenRect.width : null,
      chipHiddenHeight: chipHiddenRect ? chipHiddenRect.height : null,
      chipPaintedText: chip ? paintedText(chip) : null,
      hasNote: Boolean(note),
      noteText: note ? text(note) : null,
      noteSource: note ? attr(note, "data-source") : null,
      disabledControls,
      transcript: messages ? (messages.innerText || "").trim() : null,
      composerPresent: Boolean(input),
      composerDisabled: input ? input.disabled === true : null,
      composerValue: input ? input.value : null,
      sendState: send ? attr(send, "data-state") : null,
      sendLabel: send ? attr(send, "aria-label") : null,
      sendDisabled: send ? send.disabled === true : null,
      rowLive: rows.some((row) => row.live),
      error: text(document.querySelector(".chat-panel__error")) || null,
      modelRepairPresent: Boolean(
        document.querySelector('[data-testid="chat-model-repair"]'),
      ),
      modelRepairUseDefault: Boolean(
        document.querySelector('[data-testid="chat-model-repair-use-default"]'),
      ),
      // The dock's turn records. A live send must be ONE turn that carries both
      // the operator's words and the reply; a settle before the frames arrive
      // would split it into a user-only turn plus a second answer turn.
      turnCount: document.querySelectorAll(".chat-panel__turn").length,
      turns: Array.from(document.querySelectorAll(".chat-panel__turn")).map((el) => ({
        status: el.getAttribute("data-turn-status"),
        text: (el.innerText || "").trim(),
      })),
    };
  })()`;
}

async function snapshot(win, world) {
  return win.webContents.executeJavaScript(snapshotExpression(world));
}

/** Open one chat from the sidebar, the way a person clicks it. */
function openRowExpression(title) {
  return `(() => {
    const wanted = ${JSON.stringify(title)};
    const row = Array.from(document.querySelectorAll(".chats-rail__row")).find((li) =>
      ((li.querySelector(".chats-rail__label")?.textContent) ?? "").trim() === wanted);
    if (!row) return { ok: false, reason: "no row " + wanted };
    const main = row.querySelector(".chats-rail__row-main");
    if (!main) return { ok: false, reason: "row has no row-main" };
    if (main.disabled) return { ok: false, reason: "row-main is disabled" };
    main.click();
    return { ok: true, label: wanted };
  })()`;
}

/** Type a draft into the dock's composer, the way a person types. */
function typeExpression(value) {
  return `(async () => {
    const el = document.querySelector(".chat-panel__composer-input");
    if (!el) return { ok: false, reason: "no composer" };
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      if (el.value === ${JSON.stringify(value)}) return { ok: true, value: el.value };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ok: false, reason: "the composer did not take the draft", value: el.value };
  })()`;
}

/** Type the turn and click the shipped send control. */
function typeAndSendExpression(value) {
  return `(async () => {
    const el = document.querySelector(".chat-panel__composer-input");
    if (!el) return { ok: false, reason: "no composer" };
    const proto = HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = performance.now() + 4000;
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
    return { ok: true, value: ${JSON.stringify(value)} };
  })()`;
}

/** Click the dock's own Stop control while a turn is running. */
const CLICK_STOP = `(() => {
  const button = document.querySelector('.chat-panel__send[data-state="stop"]');
  if (!button) return { ok: false, reason: "no stop control" };
  if (button.disabled) return { ok: false, reason: "the stop control is disabled" };
  button.click();
  return { ok: true, label: button.getAttribute("aria-label") };
})()`;

/* ── the run ────────────────────────────────────────────────────────────── */

async function run() {
  const world = readWorld();
  const screenshotFile = path.join(artifactsDir, SCREENSHOT_NAME);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const control = await serveControl(world);
  const host = await buildGateway(world, control.state);

  const states = {
    telegramOpen: null,
    afterFirstReply: null,
    secondTurnRunning: null,
    afterStop: null,
    discordOpen: null,
    discordReply: null,
    apiChat: null,
  };

  try {
    writeHostEnv(world.hermesHome, host.port);

    // The app boots from the seam every full-app rig uses; the environment was
    // set by the test's spawn, and these assignments keep the same contract
    // when the driver is run by hand.
    process.env.HERMES_HOME = world.hermesHome;
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
      "PATH";
    process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
    process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
    if (!process.env.LIFEQUEST_E2E) {
      process.env.LIFEQUEST_E2E = JSON.stringify({
        userData: world.userData,
        showWindow: true,
        mcpPorts: world.mcpPorts,
      });
    }
    delete process.env.ELECTRON_RUN_AS_NODE;

    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();
    const js = (code) => win.webContents.executeJavaScript(code);
    const snap = () => snapshot(win, world);

    // ── the rail is up, and all three chats are listed ─────────────────────
    await waitFor(
      win,
      `Boolean(document.querySelector(".chats-rail"))`,
      "the chats rail (.chats-rail) to mount",
      MOUNT_TIMEOUT_MS,
    );
    const listed = await waitUntil(
      async () => {
        const sample = await snap();
        return Boolean(sample.telegramRow && sample.discordRow && sample.apiRow);
      },
      MOUNT_TIMEOUT_MS,
      "the fake gateway's three chats to be listed",
    );
    check(
      "the app lists the Telegram, Discord and api_server chats",
      listed.ok,
      `rows: ${JSON.stringify((await snap()).rows)}`,
    );

    // ── open the Telegram chat in the dock ─────────────────────────────────
    const opened = await js(openRowExpression(world.sessions.telegram.title));
    check(
      "the Telegram chat opens from the sidebar",
      opened?.ok === true,
      `open result: ${JSON.stringify(opened)}`,
    );
    await waitFor(
      win,
      `(() => {
        const el = document.querySelector(".chat-panel__composer-input");
        const messages = document.querySelector(".chat-panel__messages");
        return Boolean(el) && el.disabled !== true && Boolean(messages) &&
          (messages.innerText || "").includes(${JSON.stringify(world.sessions.telegram.transcript[0].content)});
      })()`,
      "the Telegram chat's composer and REST transcript to paint",
      MOUNT_TIMEOUT_MS,
    );
    await sleep(350);

    states.telegramOpen = await snap();
    measurements.telegramTurnsBefore = states.telegramOpen.turnCount;

    // ── (1) the source data reached the renderer ───────────────────────────
    const tgRow = states.telegramOpen.telegramRow;
    const dcRow = states.telegramOpen.discordRow;
    check(
      "the Telegram row carries the source data (data-continuable + data-source)",
      tgRow?.continuable === "true" && tgRow?.source === "telegram",
      `row: ${JSON.stringify(tgRow)}`,
    );
    check(
      "the Discord row carries the source data (data-continuable + data-source)",
      dcRow?.continuable === "true" && dcRow?.source === "discord",
      `row: ${JSON.stringify(dcRow)}`,
    );
    const apiRowSample = states.telegramOpen.apiRow;
    check(
      "the api_server row is not marked continuable",
      apiRowSample?.continuable === null && apiRowSample?.source === null,
      `api row: ${JSON.stringify(apiRowSample)}`,
    );
    // ── (2a) the rail leads each foreign row with its platform LOGO ────────
    // The titles are plain words ("Spring bed plan", "Game night roster"), so a
    // word in the title cannot satisfy this: only the mark can.
    check(
      "the Telegram rail row leads with the Telegram mark, not a word or the status dot",
      tgRow?.mark === "telegram" &&
        tgRow?.markSlotSvgs === 1 &&
        tgRow?.markText === "" &&
        tgRow?.hasDot === false,
      `telegram row: ${JSON.stringify(tgRow)}`,
    );
    check(
      "the Discord rail row leads with the Discord mark, not a word or the status dot",
      dcRow?.mark === "discord" &&
        dcRow?.markSlotSvgs === 1 &&
        dcRow?.markText === "" &&
        dcRow?.hasDot === false,
      `discord row: ${JSON.stringify(dcRow)}`,
    );
    check(
      "the api_server rail row wears neither platform mark",
      apiRowSample?.mark === null && apiRowSample?.markSlotSvgs === 0,
      `api row: ${JSON.stringify(apiRowSample)}`,
    );
    // ── (2b) the dock tab strip leads the Telegram tab with the mark ───────
    const tgTab =
      states.telegramOpen.tabs.find((tab) => tab.id === world.sessions.telegram.id) ??
      null;
    check(
      "the open Telegram tab carries data-source and its platform mark",
      Boolean(tgTab) &&
        tgTab.source === "telegram" &&
        tgTab.mark === "telegram" &&
        tgTab.markText === "",
      `tabs: ${JSON.stringify(states.telegramOpen.tabs)}`,
    );
    // ── (2c) the dock header chip is the LOGO, and the word is not painted ──
    check(
      "the dock header chip draws the Telegram logo with no visible word",
      states.telegramOpen.headerContinuable === "true" &&
        states.telegramOpen.headerSource === "telegram" &&
        states.telegramOpen.chipVariantMark === true &&
        states.telegramOpen.chipMark === "telegram" &&
        states.telegramOpen.chipRole === "img" &&
        states.telegramOpen.chipHasLabelElement === false &&
        states.telegramOpen.chipHiddenText === "Telegram" &&
        (states.telegramOpen.chipHiddenWidth ?? 2) <= 1 &&
        (states.telegramOpen.chipHiddenHeight ?? 2) <= 1 &&
        !(states.telegramOpen.chipPaintedText ?? "").includes("Telegram"),
      `header: ${JSON.stringify({
        continuable: states.telegramOpen.headerContinuable,
        source: states.telegramOpen.headerSource,
        variant: states.telegramOpen.chipVariantMark,
        mark: states.telegramOpen.chipMark,
        role: states.telegramOpen.chipRole,
        labelElement: states.telegramOpen.chipHasLabelElement,
        hidden: states.telegramOpen.chipHiddenText,
        hiddenBox: [
          states.telegramOpen.chipHiddenWidth,
          states.telegramOpen.chipHiddenHeight,
        ],
        painted: states.telegramOpen.chipPaintedText,
      })}`,
    );
    check(
      "the chip's accessible label and tooltip still name the surface",
      typeof states.telegramOpen.chipAriaLabel === "string" &&
        states.telegramOpen.chipAriaLabel.includes("Telegram") &&
        typeof states.telegramOpen.chipTitle === "string" &&
        states.telegramOpen.chipTitle.includes("Telegram"),
      `aria-label: ${JSON.stringify(states.telegramOpen.chipAriaLabel)} / title: ${JSON.stringify(states.telegramOpen.chipTitle)}`,
    );
    check(
      "the composer says the conversation is shared with Telegram",
      states.telegramOpen.hasNote === true &&
        typeof states.telegramOpen.noteText === "string" &&
        /Shared with Telegram/i.test(states.telegramOpen.noteText) &&
        states.telegramOpen.noteSource === "telegram",
      `note: ${JSON.stringify(states.telegramOpen.noteText)}`,
    );
    const attachmentControl = states.telegramOpen.disabledControls.find(
      (control) => control.testid === "chat-attachment-button",
    );
    check(
      "the composer disables a control the WS door cannot carry, with its reason",
      states.telegramOpen.disabledControls.length > 0 &&
        Boolean(attachmentControl) &&
        attachmentControl.disabled === true &&
        typeof attachmentControl.title === "string" &&
        /another surface/i.test(attachmentControl.title) &&
        /attachment/i.test(attachmentControl.title),
      `disabled controls: ${JSON.stringify(states.telegramOpen.disabledControls)}`,
    );
    check(
      "no retired-model repair banner appears for a continued chat",
      states.telegramOpen.modelRepairPresent === false &&
        states.telegramOpen.modelRepairUseDefault === false,
      `model repair present: ${JSON.stringify({
        banner: states.telegramOpen.modelRepairPresent,
        useDefault: states.telegramOpen.modelRepairUseDefault,
      })}`,
    );
    check(
      "the Telegram transcript was read from the gateway's REST list first",
      states.telegramOpen.transcript?.includes(
        world.sessions.telegram.transcript[0].content,
      ) === true &&
        host.state.messagesRequests.some(
          (request) => request.sessionId === world.sessions.telegram.id,
        ),
      `messages requests: ${JSON.stringify(host.state.messagesRequests)}`,
    );

    // ── send the first turn: it must travel the WebSocket ──────────────────
    measurements.firstSendAt = Date.now();
    const sent = await js(typeAndSendExpression(world.sessions.telegram.turn.text));
    check(
      "the shipped send control sends the first turn",
      sent?.ok === true,
      `send result: ${JSON.stringify(sent)}`,
    );

    const framesArrived = await waitUntil(
      () =>
        host.state.ws.resume.some(
          (frame) => frame.params.session_id === world.sessions.telegram.id,
        ) &&
        host.state.ws.submit.some(
          (frame) => frame.params.session_id === world.sessions.telegram.id,
        ),
      ACTION_TIMEOUT_MS,
      "session.resume and prompt.submit on the gateway WebSocket",
    );
    measurements.framesArrivedAt = framesArrived.at;

    const replied = await waitUntil(
      async () => {
        const sample = await snap();
        // An idle composer draws no send control at all (the arrow appears
        // once there is something to send), so "settled" is "no stop control".
        return (
          sample.transcript?.includes(world.sessions.telegram.turn.reply) === true &&
          sample.sendState !== "stop" &&
          sample.rowLive === false
        );
      },
      ACTION_TIMEOUT_MS,
      "the WS-only reply to paint and the turn to settle",
    );
    await sleep(350);
    states.afterFirstReply = await snap();
    measurements.replyPaintedAt = replied.at;

    // ── (2) the WS frames, the reply, and the silence of the API door ──────
    const resumeFrame = host.state.ws.resume.find(
      (frame) => frame.params.session_id === world.sessions.telegram.id,
    );
    const submitFrame = host.state.ws.submit.find(
      (frame) =>
        frame.params.session_id === world.sessions.telegram.id &&
        typeof frame.params.submission_id === "string" &&
        frame.params.submission_id.length > 0,
    );
    check(
      "sending the Telegram chat opened the gateway WebSocket with a minted ticket",
      host.state.ws.connections.length > 0 &&
        host.state.ws.connections[0].protocol === WS_PROTOCOL &&
        host.state.ws.connections[0].ticketMinted === true &&
        control.state.tickets.length > 0,
      `connections: ${JSON.stringify(host.state.ws.connections)} / tickets: ${JSON.stringify(control.state.tickets)}`,
    );
    check(
      "the gateway sent gateway.ready before serving the turn",
      host.state.ws.out.some((frame) => frame.type === "gateway.ready"),
      `frames sent: ${JSON.stringify(host.state.ws.out.map((frame) => frame.type))}`,
    );
    check(
      "session.resume named the Telegram session",
      Boolean(resumeFrame) &&
        resumeFrame.params.session_id === world.sessions.telegram.id &&
        resumeFrame.params.defer_history === true &&
        resumeFrame.params.omit_messages === true,
      `resume frames: ${JSON.stringify(host.state.ws.resume.map((frame) => frame.params))}`,
    );
    check(
      "prompt.submit named the Telegram session and carried a submission_id",
      Boolean(submitFrame) && typeof submitFrame.params.submission_id === "string",
      `submit frames: ${JSON.stringify(host.state.ws.submit.map((frame) => frame.params))}`,
    );
    check(
      "the WS-only reply painted in the live DOM",
      states.afterFirstReply.transcript?.includes(world.sessions.telegram.turn.reply) === true,
      `transcript: ${JSON.stringify(states.afterFirstReply.transcript)}`,
    );
    check(
      "the continued turn settled without an error on screen",
      states.afterFirstReply.sendState !== "stop" &&
        states.afterFirstReply.rowLive === false &&
        !states.afterFirstReply.error,
      `sample: ${JSON.stringify({
        sendState: states.afterFirstReply.sendState,
        rowLive: states.afterFirstReply.rowLive,
        error: states.afterFirstReply.error,
      })}`,
    );
    // The transport must resolve the send when the TURN is over, not when it is
    // admitted: otherwise the renderer settles the pending turn before the
    // frames arrive and the reply lands in a second, user-less turn.
    const transcriptAfterReply = states.afterFirstReply.transcript ?? "";
    const telegramTurnsBefore = measurements.telegramTurnsBefore ?? 0;
    const addedTurns = states.afterFirstReply.turns.slice(telegramTurnsBefore);
    const footerOnly = (turn) =>
      turn.text.replace(/^Completed · .*$/m, "").trim().length === 0;
    const contentTurns = addedTurns.filter((turn) => !footerOnly(turn));
    measurements.telegramFooterOnlyTurns = addedTurns.length - contentTurns.length;
    const continuedTurn =
      contentTurns.find((turn) => turn.text.includes(world.sessions.telegram.turn.text)) ?? null;
    check(
      "the continued send is one turn carrying both the message and the reply",
      addedTurns.length === 1 &&
        contentTurns.length === 1 &&
        Boolean(continuedTurn) &&
        continuedTurn.status === "completed" &&
        continuedTurn.text.includes(world.sessions.telegram.turn.reply),
      `turns before ${telegramTurnsBefore}, added ${JSON.stringify(addedTurns)}`,
    );
    check(
      "the continued send added no empty or footer-only turn",
      measurements.telegramFooterOnlyTurns === 0,
      `the send added ${measurements.telegramFooterOnlyTurns} footer-only turn(s): ${JSON.stringify(addedTurns)}`,
    );
    check(
      "no added turn paints a second copy of the message or the reply",
      addedTurns.filter((turn) => turn.text.includes(world.sessions.telegram.turn.text))
        .length === 1 &&
        addedTurns.filter((turn) => turn.text.includes(world.sessions.telegram.turn.reply))
          .length === 1,
      `added turns: ${JSON.stringify(addedTurns)}`,
    );
    // The gateway's whole reply is authoritative (`assistant.final`, the same
    // contract the REST stream's `assistant.completed` has): painted once, and
    // the narration that preceded the tool came over the socket, not REST.
    check(
      "the WS-only answer is painted once, and the narration arrived over the socket",
      countIn(transcriptAfterReply, world.sessions.telegram.turn.reply) === 1 &&
        host.state.ws.out.some(
          (frame) =>
            frame.type === "message.delta" &&
            frame.payload?.text === world.sessions.telegram.turn.narration,
        ) &&
        host.state.ws.out.some((frame) => frame.type === "tool.start") &&
        host.state.ws.out.some(
          (frame) =>
            frame.type === "message.complete" &&
            frame.payload?.text === world.sessions.telegram.turn.reply,
        ),
      `answer x${countIn(transcriptAfterReply, world.sessions.telegram.turn.reply)} / frames out: ${JSON.stringify(host.state.ws.out.map((frame) => frame.type))}: ${JSON.stringify(transcriptAfterReply)}`,
    );
    const restTelegram = host.state.restServed[world.sessions.telegram.id];
    check(
      "the REST transcript never carried the narration or the WS-only reply",
      Array.isArray(restTelegram) &&
        restTelegram.length > 0 &&
        restTelegram.every(
          (row) =>
            !String(row.content).includes(world.sessions.telegram.turn.replyMarker) &&
            !String(row.content).includes(world.sessions.telegram.turn.narration),
        ),
      `REST telegram transcript: ${JSON.stringify(restTelegram)}`,
    );
    check(
      "nothing called the API chat route for the Telegram chat",
      host.state.streamRequests.every(
        (request) => request.sessionId !== world.sessions.telegram.id,
      ) &&
        !host.state.refusals.some(
          (refusal) => refusal.sessionId === world.sessions.telegram.id,
        ),
      `refusals: ${JSON.stringify(host.state.refusals)} / streams: ${JSON.stringify(host.state.streamRequests)}`,
    );
    check(
      "the continuation created no new chat",
      host.state.createRequests.length === 0,
      `create requests: ${JSON.stringify(host.state.createRequests)}`,
    );

    // ── the picture: this window, the chip and the streamed reply ──────────
    await js(`(() => {
      const body = document.querySelector(".chat-panel__body");
      if (!body) return false;
      body.scrollTop = body.scrollHeight;
      return true;
    })()`);
    await sleep(350);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotFile, image.toPNG());
    const screenshotBytes = fs.existsSync(screenshotFile)
      ? fs.statSync(screenshotFile).size
      : 0;
    measurements.screenshotBytes = screenshotBytes;
    check(
      "the screenshot is this window's capture of the dock with the chip and the reply",
      screenshotBytes > MIN_SCREENSHOT_BYTES,
      `${screenshotFile} is ${screenshotBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    // ── the second turn: hold it running, then stop it from the dock ───────
    const sentSecond = await js(typeAndSendExpression(world.seed.secondTurnText));
    check(
      "the shipped send control sends the second turn",
      sentSecond?.ok === true,
      `send result: ${JSON.stringify(sentSecond)}`,
    );
    const running = await waitUntil(
      async () => {
        const sample = await snap();
        return (
          sample.sendState === "stop" &&
          sample.sendDisabled === false &&
          sample.rowLive === true
        );
      },
      ACTION_TIMEOUT_MS,
      "the dock to show its stop control for the second turn",
    );
    states.secondTurnRunning = await snap();
    check(
      "the second turn is running and the composer offers Stop",
      running.ok,
      `last sample: ${JSON.stringify({
        sendState: states.secondTurnRunning.sendState,
        rowLive: states.secondTurnRunning.rowLive,
        submitCount: host.state.ws.submit.filter(
          (frame) => frame.params.session_id === world.sessions.telegram.id,
        ).length,
      })}`,
    );
    await sleep(250);

    const stopped = await js(CLICK_STOP);
    const interrupted = await waitUntil(
      () =>
        host.state.ws.interrupt.some(
          (frame) => frame.session_id === world.sessions.telegram.id,
        ),
      ACTION_TIMEOUT_MS,
      "session.interrupt on the gateway WebSocket",
    );
    const settled = await waitUntil(
      async () => {
        const sample = await snap();
        return sample.sendState !== "stop" && sample.rowLive === false;
      },
      ACTION_TIMEOUT_MS,
      "the stopped turn to settle in the dock",
    );
    await sleep(300);
    states.afterStop = await snap();
    check(
      "the dock's Stop reached session.interrupt on the socket",
      stopped?.ok === true && interrupted.ok,
      `stop: ${JSON.stringify(stopped)} / interrupts: ${JSON.stringify(host.state.ws.interrupt.map((frame) => frame.params))}`,
    );
    check(
      "the interrupted turn settles back to an idle composer",
      settled.ok,
      `last sample: ${JSON.stringify({
        sendState: states.afterStop.sendState,
        rowLive: states.afterStop.rowLive,
        error: states.afterStop.error,
      })}`,
    );

    // ── the Discord chat: same continuation, its own platform mark ─────────
    const openedDiscord = await js(
      openRowExpression(world.sessions.discord.title),
    );
    check(
      "the Discord chat opens from the sidebar",
      openedDiscord?.ok === true,
      `open result: ${JSON.stringify(openedDiscord)}`,
    );
    await waitFor(
      win,
      `(() => {
        const el = document.querySelector(".chat-panel__composer-input");
        const messages = document.querySelector(".chat-panel__messages");
        return Boolean(el) && el.disabled !== true && Boolean(messages) &&
          (messages.innerText || "").includes(${JSON.stringify(world.sessions.discord.transcript[0].content)});
      })()`,
      "the Discord chat's composer and REST transcript to paint",
      MOUNT_TIMEOUT_MS,
    );
    await sleep(350);
    states.discordOpen = await snap();
    measurements.discordTurnsBefore = states.discordOpen.turnCount;
    const dcTurnSample = world.sessions.discord.turn;
    check(
      "the dock header chip draws the Discord logo with no visible word",
      states.discordOpen.headerSource === "discord" &&
        states.discordOpen.chipVariantMark === true &&
        states.discordOpen.chipMark === "discord" &&
        states.discordOpen.chipRole === "img" &&
        states.discordOpen.chipHasLabelElement === false &&
        states.discordOpen.chipHiddenText === "Discord" &&
        (states.discordOpen.chipHiddenWidth ?? 2) <= 1 &&
        (states.discordOpen.chipHiddenHeight ?? 2) <= 1 &&
        !(states.discordOpen.chipPaintedText ?? "").includes("Discord") &&
        typeof states.discordOpen.chipAriaLabel === "string" &&
        states.discordOpen.chipAriaLabel.includes("Discord") &&
        typeof states.discordOpen.chipTitle === "string" &&
        states.discordOpen.chipTitle.includes("Discord"),
      `header: ${JSON.stringify({
        source: states.discordOpen.headerSource,
        variant: states.discordOpen.chipVariantMark,
        mark: states.discordOpen.chipMark,
        role: states.discordOpen.chipRole,
        labelElement: states.discordOpen.chipHasLabelElement,
        hidden: states.discordOpen.chipHiddenText,
        hiddenBox: [
          states.discordOpen.chipHiddenWidth,
          states.discordOpen.chipHiddenHeight,
        ],
        painted: states.discordOpen.chipPaintedText,
        aria: states.discordOpen.chipAriaLabel,
        title: states.discordOpen.chipTitle,
      })}`,
    );
    const dcTab =
      states.discordOpen.tabs.find(
        (tab) => tab.id === world.sessions.discord.id,
      ) ?? null;
    check(
      "the open Discord tab carries data-source and its platform mark",
      Boolean(dcTab) &&
        dcTab.source === "discord" &&
        dcTab.mark === "discord" &&
        dcTab.markText === "",
      `tabs: ${JSON.stringify(states.discordOpen.tabs)}`,
    );
    const dcSent = await js(
      typeAndSendExpression(world.sessions.discord.turn.text),
    );
    check(
      "the shipped send control sends the Discord turn",
      dcSent?.ok === true,
      `send result: ${JSON.stringify(dcSent)}`,
    );
    const dcFrames = await waitUntil(
      () =>
        host.state.ws.resume.some(
          (frame) => frame.params.session_id === world.sessions.discord.id,
        ) &&
        host.state.ws.submit.some(
          (frame) => frame.params.session_id === world.sessions.discord.id,
        ),
      ACTION_TIMEOUT_MS,
      "session.resume and prompt.submit for the Discord chat",
    );
    const dcReplied = await waitUntil(
      async () => {
        const sample = await snap();
        return (
          sample.transcript?.includes(dcTurnSample.reply) === true &&
          sample.sendState !== "stop" &&
          sample.rowLive === false
        );
      },
      ACTION_TIMEOUT_MS,
      "the Discord WS reply to paint and the turn to settle",
    );
    await sleep(300);
    states.discordReply = await snap();
    const dcTurnsBefore = measurements.discordTurnsBefore ?? 0;
    const dcAddedTurns = states.discordReply.turns.slice(dcTurnsBefore);
    const dcContentTurns = dcAddedTurns.filter((turn) => !footerOnly(turn));
    measurements.discordFooterOnlyTurns =
      dcAddedTurns.length - dcContentTurns.length;
    const dcContinuedTurn =
      dcContentTurns.find((turn) =>
        turn.text.includes(world.sessions.discord.turn.text),
      ) ?? null;
    const dcTranscript = states.discordReply.transcript ?? "";
    check(
      "the Discord send continued the Discord session over the WebSocket",
      dcFrames.ok &&
        host.state.ws.resume.some(
          (frame) =>
            frame.params.session_id === world.sessions.discord.id &&
            frame.params.profile === world.profile,
        ) &&
        host.state.ws.submit.some(
          (frame) =>
            frame.params.session_id === world.sessions.discord.id &&
            typeof frame.params.submission_id === "string" &&
            frame.params.submission_id.length > 0,
        ),
      `frames: ${JSON.stringify({
        resume: host.state.ws.resume.map((frame) => frame.params.session_id),
        submit: host.state.ws.submit.map((frame) => ({
          session: frame.params.session_id,
          submission: frame.params.submission_id,
        })),
      })}`,
    );
    check(
      "the Discord reply painted in one turn, no footer-only turn",
      dcAddedTurns.length === 1 &&
        dcContentTurns.length === 1 &&
        Boolean(dcContinuedTurn) &&
        dcContinuedTurn.status === "completed" &&
        dcContinuedTurn.text.includes(dcTurnSample.reply) &&
        countIn(dcTranscript, dcTurnSample.reply) === 1 &&
        measurements.discordFooterOnlyTurns === 0,
      `turns before ${dcTurnsBefore}, added ${JSON.stringify(dcAddedTurns)}`,
    );
    check(
      "the Discord chat never used the API chat route",
      !host.state.refusals.some(
        (refusal) => refusal.sessionId === world.sessions.discord.id,
      ) &&
        !host.state.streamRequests.some(
          (request) => request.sessionId === world.sessions.discord.id,
        ),
      `refusals: ${JSON.stringify(host.state.refusals)} / streams: ${JSON.stringify(host.state.streamRequests)}`,
    );
    check(
      "the Discord turn's narration and answer travelled the socket",
      host.state.ws.out.some(
        (frame) =>
          frame.type === "message.delta" &&
          frame.payload?.text === dcTurnSample.narration,
      ) &&
        host.state.ws.out.some(
          (frame) =>
            frame.type === "message.complete" &&
            frame.payload?.text === dcTurnSample.reply,
        ),
      `frames out: ${JSON.stringify(host.state.ws.out.map((frame) => frame.type))}`,
    );
    notes.push(
      `the Discord chat ${JSON.stringify(dcTurnSample.reply)} was continued on the same stored session over the socket; the REST transcript served ${JSON.stringify(host.state.restServed[world.sessions.discord.id])}`,
    );

    // ── the normal api_server chat must keep the REST transport ────────────
    const openedApi = await js(openRowExpression(world.sessions.api.title));
    check(
      "the api_server chat opens from the sidebar",
      openedApi?.ok === true,
      `open result: ${JSON.stringify(openedApi)}`,
    );
    await waitFor(
      win,
      `(() => {
        const el = document.querySelector(".chat-panel__composer-input");
        const messages = document.querySelector(".chat-panel__messages");
        return Boolean(el) && el.disabled !== true && Boolean(messages) &&
          (messages.innerText || "").includes(${JSON.stringify(world.sessions.api.transcript[0].content)});
      })()`,
      "the api_server chat's composer and REST transcript to paint",
      MOUNT_TIMEOUT_MS,
    );
    const apiTurnsBefore = (await snap()).turnCount;
    measurements.apiTurnsBefore = apiTurnsBefore;
    const apiSent = await js(typeAndSendExpression(world.seed.apiTurnText));
    check(
      "the shipped send control sends the api_server turn",
      apiSent?.ok === true,
      `send result: ${JSON.stringify(apiSent)}`,
    );
    const apiStreamHit = await waitUntil(
      () =>
        host.state.streamRequests.some(
          (request) => request.sessionId === world.sessions.api.id,
        ),
      ACTION_TIMEOUT_MS,
      "the fake API's chat stream to be hit for the api_server chat",
    );
    const apiReplied = await waitUntil(
      async () => {
        const sample = await snap();
        return (
          sample.transcript?.includes(world.seed.apiReply) === true &&
          sample.sendState !== "stop" &&
          sample.rowLive === false
        );
      },
      ACTION_TIMEOUT_MS,
      "the api_server reply to paint and the turn to settle",
    );
    await sleep(300);
    states.apiChat = await snap();
    check(
      "the api_server chat still runs over the REST chat stream",
      apiStreamHit.ok &&
        apiReplied.ok &&
        states.apiChat.transcript?.includes(world.seed.apiReply) === true,
      `stream requests: ${JSON.stringify(host.state.streamRequests)} / transcript: ${JSON.stringify(states.apiChat.transcript)}`,
    );
    check(
      "the api_server chat did not travel the WebSocket",
      host.state.ws.submit.every(
        (frame) => frame.params.session_id !== world.sessions.api.id,
      ) && host.state.ws.unexpectedTurns.length === 0,
      `submit frames: ${JSON.stringify(host.state.ws.submit.map((frame) => frame.params.session_id))} / unexpected: ${JSON.stringify(host.state.ws.unexpectedTurns)}`,
    );
    // Parity: the REST comparison has the same shape the WS turn must have —
    // one content turn added, the authoritative whole reply painted once from
    // `assistant.completed`, with a narration delta and a tool call before it.
    const apiTranscript = states.apiChat.transcript ?? "";
    const apiAddedTurns = states.apiChat.turns.slice(apiTurnsBefore);
    const apiContentTurns = apiAddedTurns.filter((turn) => !footerOnly(turn));
    measurements.apiFooterOnlyTurns = apiAddedTurns.length - apiContentTurns.length;
    check(
      "the api_server REST turn has the same one-turn narration-then-answer shape",
      apiAddedTurns.length === 1 &&
        apiContentTurns.length === 1 &&
        apiContentTurns[0].text.includes(world.seed.apiTurnText) &&
        countIn(apiTranscript, world.seed.apiReply) === 1 &&
        host.state.apiFrames.some(
          (frame) =>
            frame.name === "assistant.delta" &&
            frame.payload?.text === world.seed.apiNarration,
        ) &&
        host.state.apiFrames.some((frame) => frame.name === "tool.started") &&
        host.state.apiFrames.some(
          (frame) =>
            frame.name === "assistant.completed" &&
            frame.payload?.content === world.seed.apiReply,
        ) &&
        host.state.apiFrames.some((frame) => frame.name === "run.completed"),
      `turns before ${apiTurnsBefore}, added ${JSON.stringify(apiAddedTurns)} / api frames: ${JSON.stringify(host.state.apiFrames.map((frame) => frame.name))}`,
    );
    notes.push(
      "REST parity: the fake API stream emits assistant.completed with the whole reply after a narration delta and a tool call, the same shape the real API session stream has; both docks show one turn added by the send and the answer painted once.",
    );

    // ── the world was the temp one, and the CLI the stub ───────────────────
    const cliLog = readCliLog(world.callsDir);
    const ensureCall = cliLog.find((call) => /^gateway ensure\b/.test(call.argv));
    check(
      "the app ran the stub hermes for gateway ensure with the temp profile home",
      Boolean(ensureCall) &&
        ensureCall.hermesHome === path.join(world.hermesHome, "profiles", world.profile),
      `cli log: ${JSON.stringify(cliLog)}`,
    );
    notes.push(
      `the WS-only reply ${JSON.stringify(world.sessions.telegram.turn.reply)} exists only in the socket frames; the REST transcript served ${JSON.stringify(host.state.restServed[world.sessions.telegram.id])}`,
    );
    notes.push(
      `the fake API refused the Telegram chat's API door ${host.state.refusals.length} time(s); its stream was hit ${host.state.streamRequests.length} time(s), only for the api_server chat`,
    );

    // Report the whole world so the test can re-derive every claim.
    const report = {
      pass: failures.length === 0,
      failures: [...failures],
      checks: [...checks],
      ranAt: new Date().toISOString(),
      what: "the real app continues a Telegram chat in the dock over the Hermes gateway's canonical JSON-RPC WebSocket (session.resume + prompt.submit, the same stored session) while an api_server chat keeps the REST chat stream",
      why: "the API transport refuses to write a session another surface owns (permission_denied / HTTP 500); Hermes documents the gateway WebSocket as the door for continuing such a chat, and the dock has to keep its existing send, stop and transcript surfaces",
      world: {
        profile: world.profile,
        profilePath: path.join(world.hermesHome, "profiles", world.profile),
        hermesHome: world.hermesHome,
        userData: world.userData,
        vaultDir: world.vaultDir,
        vaultId: world.vaultId,
        callsDir: world.callsDir,
        gatewayPort: host.port,
        gatewayAddress: host.address,
        devServerUrl: DEV_SERVER_URL,
        tmpdir: os.tmpdir(),
      },
      sessions: world.sessions,
      seed: world.seed,
      states,
      measurements,
      gateway: {
        requests: host.state.requests.slice(0, 200),
        sessionsRequests: host.state.sessionsRequests,
        messagesRequests: host.state.messagesRequests,
        modelRequests: host.state.modelRequests,
        streamRequests: host.state.streamRequests,
        refusals: host.state.refusals,
        createRequests: host.state.createRequests,
        restTranscripts: host.state.restServed,
        apiFrames: host.state.apiFrames,
      },
      websocket: {
        upgrades: host.state.ws.upgrades,
        connections: host.state.ws.connections,
        framesIn: host.state.ws.in,
        framesOut: host.state.ws.out,
        resume: host.state.ws.resume,
        submit: host.state.ws.submit,
        interrupt: host.state.ws.interrupt,
        submitCounts: host.state.ws.submitCounts,
        unexpectedTurns: host.state.ws.unexpectedTurns,
      },
      control: {
        requests: control.state.requests,
        tickets: control.state.tickets,
      },
      cliLog,
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
      console.error(`[foreign-chat] could not write the artifact: ${error}`);
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    failures.push(
      `the driver threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    console.error(error);

    // Still write an artifact that names the failure, so the test can re-derive
    // it instead of reporting only "exit 1".
    const report = {
      pass: false,
      failures: [...failures],
      checks: [...checks],
      ranAt: new Date().toISOString(),
      world: {
        profile: world.profile,
        profilePath: path.join(world.hermesHome, "profiles", world.profile),
        hermesHome: world.hermesHome,
        userData: world.userData,
        gatewayPort: host.port,
        gatewayAddress: host.address,
        devServerUrl: DEV_SERVER_URL,
        tmpdir: os.tmpdir(),
      },
      sessions: world.sessions,
      seed: world.seed,
      states,
      measurements,
      gateway: {
        requests: host.state.requests.slice(0, 200),
        streamRequests: host.state.streamRequests,
        refusals: host.state.refusals,
        createRequests: host.state.createRequests,
        restTranscripts: host.state.restServed,
        apiFrames: host.state.apiFrames,
      },
      websocket: {
        upgrades: host.state.ws.upgrades,
        connections: host.state.ws.connections,
        framesIn: host.state.ws.in,
        framesOut: host.state.ws.out,
        resume: host.state.ws.resume,
        submit: host.state.ws.submit,
        interrupt: host.state.ws.interrupt,
        unexpectedTurns: host.state.ws.unexpectedTurns,
      },
      control: {
        requests: control.state.requests,
        tickets: control.state.tickets,
      },
      cliLog: readCliLog(world.callsDir),
      screenshots: fs.existsSync(screenshotFile) ? [SCREENSHOT_NAME] : [],
      notes,
    };
    try {
      fs.writeFileSync(
        path.join(artifactsDir, REPORT_NAME),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
    } catch {
      /* nothing left to write to */
    }
  }

  await host.close().catch(() => {});
  await control.close().catch(() => {});
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
