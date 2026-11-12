/**
 * The built-in companion rig: a real app, a real Pi turn, a real reply.
 *
 * What this answers that no other rig does: does the studio actually talk to
 * `@earendil-works/pi-agent-core` in the Electron main process, and does the
 * dock show that answer? The harness pages test the panel against a stub; the
 * shell rig tests geometry; the startup rig tests the boot. None of them would
 * notice if the built-in companion was wired to nothing.
 *
 * The world is hermetic:
 *   - a throwaway app profile (the e2e seam's `LIFEQUEST_E2E` userData);
 *   - a throwaway vault created through the real IPC;
 *   - a fake OpenAI-compatible endpoint in this process, so no model, key or
 *     network is involved. It answers `/v1/models` and streams
 *     `/v1/chat/completions`, which is exactly what a local Ollama or LM Studio
 *     endpoint does.
 *
 * Two turns are driven through the real preload bridge (`window.lifequest`), the
 * same calls the panel makes. The first is plain text, so the rig proves the
 * ordinary path; the second asks for a TOOL CALL, so the dock's new work-log
 * rows are produced by genuine `pi-harness` events: the fake model answers the
 * first `/v1/chat/completions` with a streaming OpenAI `tool_calls` delta naming
 * a read-only LifeQuest MCP tool the request itself advertised, pi-agent-core
 * executes it against the rig's own vault through the real MCP door, the fake
 * endpoint is called again with the tool result in the conversation and streams
 * the final answer, and the panel is then read back live and after a reload.
 *
 * Artifacts:
 *   e2e/artifacts/pi-companion.json    the report
 *   e2e/artifacts/pi-companion-thread.png
 *   e2e/artifacts/pi-companion-picker.png
 *   e2e/artifacts/pi-companion-turn.png          the live tool turn settled
 *   e2e/artifacts/pi-companion-turn-history.png  the same turn after a reload
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");
const MODEL = "rig-model";
const REPLY = "Hello from Pi.";
/** The second turn's prompt: the endpoint keys its tool-call script off this. */
const TOOL_PROMPT = "What is in the rig ledger?";
/** What the fake model says in its second completion, once the tool result is in. */
const TOOL_ANSWER = "The rig ledger is empty.";
/** The vault domain the rig seeds a table in, so a read-only call can succeed. */
const RIG_DOMAIN = "financial";
const RIG_DATABASE_NAME = "Rig ledger";
/**
 * The read-only tool the endpoint asks for. The rig seeds a table first, so
 * `get_database` both succeeds and has a real `databaseId` to name as its
 * target — the row text the dock must show is `get_database · <uuid>`.
 */
const PREFERRED_TOOL = "get_database";
/** Read-only fallbacks, in order, if the advertised tool list lacks the above. */
const READ_ONLY_FALLBACKS = [
  "list_databases",
  "get_state",
  "list_documents",
  "list_goals",
  "get_companion_brief",
  "list_daily_notes",
];
/** Argument keys a tool row's target can be derived from (pi-harness targetLine). */
const TARGET_ARG_KEYS = [
  "databaseId",
  "viewId",
  "path",
  "file",
  "filepath",
  "file_path",
  "query",
  "url",
  "name",
  "goal",
];

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

/**
 * The fake OpenAI-compatible endpoint.
 *
 * Three scripts, chosen from the request itself rather than from a hidden turn
 * counter:
 *   - a request whose conversation already carries a tool result is the second
 *     model call of the tool turn → stream `TOOL_ANSWER`;
 *   - a request whose last user message is `TOOL_PROMPT` is the first model call
 *     of the tool turn → stream an OpenAI `tool_calls` delta for a read-only tool
 *     that the request itself advertised;
 *   - anything else is the ordinary first turn → stream `REPLY`.
 *
 * `world.databaseId` is the table the rig created through the real IPC before
 * the turns, so the chosen call has a real argument and really succeeds.
 */
function startFakeEndpoint(world) {
  /** Every completion request this endpoint answered, for the report. */
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          // A non-JSON body still gets the first-turn script; the request log shows it.
        }
        const plan = planCompletion(parsed, world);
        requests.push({
          at: Date.now(),
          lastRole: lastMessage(parsed)?.role ?? null,
          lastUserText: lastUserText(parsed).slice(0, 160),
          hasToolResult: hasToolResult(parsed),
          toolCount: toolsOf(parsed).length,
          tools: toolsOf(parsed).map((tool) => tool.name),
          plan: plan.record,
        });
        streamCompletion(res, plan);
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, requests, port: server.address().port }),
    );
  });
}

function chatChunk(delta, finishReason = null) {
  return {
    id: "rig",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function writeChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** The advertised tools, as the OpenAI function objects they came in as. */
function toolsOf(body) {
  if (!Array.isArray(body?.tools)) return [];
  return body.tools
    .map((tool) => (tool && tool.function ? tool.function : tool))
    .filter((tool) => tool && typeof tool.name === "string");
}

function lastMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.length > 0 ? messages[messages.length - 1] : null;
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === "user");
  const content = user?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

/** True once pi-agent-core has appended the tool's result to the conversation. */
function hasToolResult(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message) => {
    if (message?.role === "tool") return true;
    if (!Array.isArray(message?.content)) return false;
    return message.content.some(
      (part) => part && (part.type === "tool_result" || part.type === "toolResult"),
    );
  });
}

/**
 * A required argument, filled from the tool's own JSON schema.
 *
 * The rig knows the two values the chosen read-only call needs — the domain it
 * unlocked and the table it created — and everything else degrades to a
 * plausible value of the schema's type, so a fallback tool is still callable.
 */
function argFor(key, schema, world) {
  if (key === "domainSlug") return RIG_DOMAIN;
  if (key === "databaseId") return world.databaseId ?? undefined;
  if (key === "date") return new Date().toISOString().slice(0, 10);
  switch (schema?.type) {
    case "string":
      return "rig";
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    default:
      return undefined;
  }
}

function requiredArgs(tool, world) {
  const parameters = tool.parameters ?? tool.inputSchema ?? {};
  const properties = parameters.properties ?? {};
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  const args = {};
  for (const key of required) {
    const value = argFor(key, properties[key] ?? {}, world);
    if (value !== undefined) args[key] = value;
  }
  return args;
}

/**
 * Pick the tool the fake model "chooses".
 *
 * Prefer the read-only `get_database`, whose `databaseId` is both a real table
 * the rig created and one of the keys the harness derives a row target from.
 * If the request did not advertise it, degrade to any advertised tool with a
 * target-naming required argument, then to a known read-only tool. The reason
 * is recorded so a degraded run says why instead of pretending.
 */
function chooseTool(body, world) {
  const tools = toolsOf(body);
  if (tools.length === 0) return null;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const preferred = byName.get(PREFERRED_TOOL);
  if (preferred && world.databaseId) {
    return {
      name: preferred.name,
      args: requiredArgs(preferred, world),
      reason: `read-only ${PREFERRED_TOOL} against the rig's seeded table`,
    };
  }
  for (const tool of tools) {
    const required = Array.isArray(tool.parameters?.required) ? tool.parameters.required : [];
    const key = required.find((name) => TARGET_ARG_KEYS.includes(name));
    if (key) {
      return {
        name: tool.name,
        args: requiredArgs(tool, world),
        reason: `fallback: advertised tool with a target-naming required arg (${key})`,
      };
    }
  }
  for (const name of READ_ONLY_FALLBACKS) {
    const tool = byName.get(name);
    if (tool) {
      return {
        name,
        args: requiredArgs(tool, world),
        reason: `fallback: known read-only tool ${name}`,
      };
    }
  }
  const first = tools[0];
  return {
    name: first.name,
    args: requiredArgs(first, world),
    reason: `fallback: first advertised tool ${first.name}`,
  };
}

function planCompletion(body, world) {
  const usage = { prompt_tokens: 120, completion_tokens: 7 };
  if (hasToolResult(body)) {
    return {
      kind: "text",
      parts: ["The rig ledger", " is empty."],
      usage: { prompt_tokens: 420, completion_tokens: 9 },
      record: { kind: "text", text: TOOL_ANSWER },
    };
  }
  if (lastUserText(body).includes("rig ledger")) {
    const choice = chooseTool(body, world);
    if (choice) {
      return {
        kind: "toolCall",
        name: choice.name,
        args: choice.args,
        usage: { prompt_tokens: 380, completion_tokens: 21 },
        record: {
          kind: "toolCall",
          name: choice.name,
          args: choice.args,
          reason: choice.reason,
        },
      };
    }
    return {
      kind: "text",
      parts: ["I could not reach a vault tool."],
      usage,
      record: { kind: "text", text: "no tool was advertised", toolsEmpty: true },
    };
  }
  return {
    kind: "text",
    parts: ["Hello", " from", " Pi."],
    usage,
    record: { kind: "text", text: REPLY },
  };
}

function streamCompletion(res, plan) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  if (plan.kind === "toolCall") {
    // One delta names the call; a second carries the whole argument JSON, the
    // way an OpenAI-compatible server streams it. The finish reason is what
    // tells pi-agent-core to execute the call instead of replying.
    writeChunk(
      res,
      chatChunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_rig_tool_1",
            type: "function",
            function: { name: plan.name, arguments: "" },
          },
        ],
      }),
    );
    setTimeout(() => {
      writeChunk(
        res,
        chatChunk({
          tool_calls: [{ index: 0, function: { arguments: JSON.stringify(plan.args) } }],
        }),
      );
      writeChunk(res, chatChunk({}, "tool_calls"));
      writeChunk(res, {
        id: "rig",
        object: "chat.completion.chunk",
        created: 0,
        model: MODEL,
        choices: [],
        usage: plan.usage,
      });
      res.write("data: [DONE]\n\n");
      res.end();
    }, 30);
    return;
  }
  let index = 0;
  const send = () => {
    if (index < plan.parts.length) {
      writeChunk(res, chatChunk({ content: plan.parts[index] }));
      index += 1;
      setTimeout(send, 25);
      return;
    }
    writeChunk(res, chatChunk({}, "stop"));
    writeChunk(res, {
      id: "rig",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL,
      choices: [],
      usage: plan.usage,
    });
    res.write("data: [DONE]\n\n");
    res.end();
  };
  send();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** One port nothing is listening on right now, for this rig's own MCP doors. */
function freePort() {
  const probe = http.createServer();
  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Keep this rig's MCP doors off the operator's 8643/8646.
 *
 * The wrapper (`lifequest-e2e`) hands every rig a throwaway profile through
 * `LIFEQUEST_E2E` but no door ports, and the bench app on the same display may
 * already own both. A door this app cannot bind means `vaultTools()` returns
 * nothing, the model request advertises no tools, and the whole point of this
 * leg — a genuine tool call — silently becomes impossible. Picking two free
 * ports is the same seam other rigs use, and the parse in `main.ts` happens when
 * this bundle is imported, so this has to run before the dynamic import below.
 */
async function isolateMcpPorts() {
  const raw = process.env.LIFEQUEST_E2E;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.mcpPorts) return parsed.mcpPorts;
  const mcpPorts = { local: await freePort(), invite: await freePort() };
  process.env.LIFEQUEST_E2E = JSON.stringify({ ...parsed, mcpPorts });
  return mcpPorts;
}

/**
 * The page-side snapshot reader, as source.
 *
 * Injected into both the live turn's loop (so a row can be caught while it is
 * still running) and the post-reload read (so history is read the same way).
 * Everything is read by the DOM contract the renderer publishes: a `turn` may
 * carry a `turn-process` (with `data-process-state`), a `process-header`, tool
 * rows that keep the legacy `{name} · {target}` text, `turn-answer`,
 * `turn-footer` (with `data-footer-status`) and `turn-usage`; the legacy
 * `.chat-panel__activity-row` and assistant bubble classes are the fallback.
 */
function readFunctionExpression() {
  return `(() => {
    const txt = (el) => (el && el.textContent ? el.textContent : "").replace(/\\s+/g, " ").trim();
    const attrs = (el, all) => {
      const out = {};
      if (!el || !el.getAttributeNames) return out;
      for (const name of el.getAttributeNames()) {
        if (all || name.indexOf("data-") === 0) out[name] = el.getAttribute(name);
      }
      return out;
    };
    const readTurn = (el) => {
      const rows = [...el.querySelectorAll('[data-testid="tool-row"], .chat-panel__activity-row')];
      const header = el.querySelector('[data-testid="process-header"]');
      const process = el.querySelector('[data-testid="turn-process"]');
      const footer = el.querySelector('[data-testid="turn-footer"]');
      const usage = el.querySelector('[data-testid="turn-usage"]');
      const status = el.querySelector('[data-testid="turn-status"]');
      return {
        attrs: attrs(el, false),
        rows: rows.map((row) => ({
          text: txt(row).slice(0, 220),
          attrs: attrs(row, true),
          html: (row.outerHTML || "").slice(0, 1400),
        })),
        header: header ? { text: txt(header).slice(0, 220), attrs: attrs(header, false) } : null,
        process: process ? attrs(process, false) : null,
        answers: [...el.querySelectorAll('[data-testid="turn-answer"]')].map((answer) => ({
          text: txt(answer).slice(0, 500),
          insideProcess: Boolean(answer.closest('[data-testid="turn-process"]')),
        })),
        footer: footer
          ? { text: txt(footer).slice(0, 300), status: footer.getAttribute("data-footer-status") }
          : null,
        usage: usage ? { text: txt(usage).slice(0, 160), attrs: attrs(usage, false) } : null,
        status: status ? { text: txt(status).slice(0, 180), attrs: attrs(status, false) } : null,
        args: [...el.querySelectorAll('[data-testid="tool-args"]')].map((node) => txt(node).slice(0, 300)),
        results: [...el.querySelectorAll('[data-testid="tool-result"]')].map((node) =>
          txt(node).slice(0, 300),
        ),
      };
    };
    return () => ({
      at: Math.round(performance.now()),
      turns: [...document.querySelectorAll('[data-testid="turn"]')].map(readTurn),
      answers: [...document.querySelectorAll('[data-testid="turn-answer"]')].map((answer) => ({
        text: txt(answer).slice(0, 500),
        insideProcess: Boolean(answer.closest('[data-testid="turn-process"]')),
      })),
      legacyRows: [...document.querySelectorAll(".chat-panel__activity-row")].map((row) => ({
        text: txt(row).slice(0, 220),
        attrs: attrs(row, true),
        html: (row.outerHTML || "").slice(0, 1400),
      })),
      legacyAnswers: [
        ...document.querySelectorAll(".chat-panel__message--assistant .chat-panel__message-content"),
      ].map((node) => ({
        text: txt(node).slice(0, 400),
        insideProcess: Boolean(node.closest('[data-testid="turn-process"]')),
      })),
      bodyText: document.body.innerText.slice(0, 6000),
    });
  })()`;
}

/** Node-side interpretation of one DOM snapshot. */

function allRows(dom) {
  const rows = [];
  for (const turn of dom?.turns ?? []) rows.push(...(turn.rows ?? []));
  rows.push(...(dom?.legacyRows ?? []));
  return rows;
}

function rowNamed(dom, toolName) {
  const rows = allRows(dom);
  if (rows.length === 0) return null;
  if (!toolName) return rows[0];
  return rows.find((row) => (row.text ?? "").includes(toolName)) ?? null;
}

/**
 * The target a row shows. The contract keeps the legacy text `{name} · {target}`;
 * data attributes and the seeded table's id are fallbacks so a renderer that
 * nests the target elsewhere still proves it is there.
 */
function targetOfRow(row, databaseId) {
  if (!row) return "";
  const text = row.text ?? "";
  const separator = text.indexOf("·");
  if (separator >= 0) return text.slice(separator + 1).trim();
  for (const [key, value] of Object.entries(row.attrs ?? {})) {
    if (/target/i.test(key) && value) return String(value);
  }
  const haystack = `${text} ${JSON.stringify(row.attrs ?? {})} ${row.html ?? ""}`;
  if (databaseId && haystack.includes(databaseId)) return databaseId;
  return "";
}

function rowStateOf(row) {
  if (!row) return "missing";
  const blob = `${row.text ?? ""} ${JSON.stringify(row.attrs ?? {})}`.toLowerCase();
  if (/failed|failure|error/.test(blob)) return "failed";
  if (/completed|complete|done|success/.test(blob)) return "done";
  if (/(^|["\s])ok(["'\s]|$)/.test(blob)) return "done";
  return "unknown";
}

/** A duration in the DOM, preferring the app's own `data-tool-duration-ms`. */
function durationOfRow(row) {
  if (!row) return null;
  const attrs = row.attrs ?? {};
  const native = attrs["data-tool-duration-ms"];
  if (native != null && native !== "" && /^\d+(\.\d+)?$/.test(String(native))) {
    return {
      source: "data-tool-duration-ms",
      value: Number(native),
      native: attrs["data-tool-duration-source"] === "harness",
      durationSource: attrs["data-tool-duration-source"] ?? null,
    };
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (/duration|elapsed|took/i.test(key) && value != null && value !== "" && /^\d+(\.\d+)?$/.test(String(value))) {
      return { source: key, value: Number(value) };
    }
  }
  const text = String(row.text ?? "");
  const textMatch = text.match(/(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (textMatch) return { source: "row text", text: textMatch[0] };
  const htmlMatch = String(row.html ?? "").match(/(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (htmlMatch) return { source: "row html", text: htmlMatch[0] };
  return null;
}

function usageOfTurn(turn) {
  const usage = turn?.usage;
  if (!usage) return { present: false };
  const attrs = usage.attrs ?? {};
  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const input = attrs["data-input"] != null ? number(attrs["data-input"]) : null;
  const output = attrs["data-output"] != null ? number(attrs["data-output"]) : null;
  const total = attrs["data-total"] != null ? number(attrs["data-total"]) : null;
  return {
    present: true,
    text: usage.text ?? "",
    attrs,
    numbers: { input, output, total },
    numeric: [input, output, total].some((value) => value != null) || /\d/.test(usage.text ?? ""),
  };
}

function foldHeaderOf(turn) {
  return turn?.header?.text ?? null;
}

function answerOfTurn(turn, expected) {
  const answers = turn?.answers ?? [];
  return (
    answers.find((answer) => (answer.text ?? "").includes(expected)) ??
    answers[answers.length - 1] ??
    null
  );
}

/** The answer of record, falling back to a page-level read if turns are nested differently. */
function answerOfDom(dom, turn, expected) {
  return (
    answerOfTurn(turn, expected) ??
    (dom?.answers ?? []).find((answer) => (answer.text ?? "").includes(expected)) ??
    (dom?.legacyAnswers ?? []).find((answer) => (answer.text ?? "").includes(expected)) ??
    null
  );
}


/**
 * The built renderer, over loopback.
 *
 * `isDev` is true for anything unpackaged, so main always loads a URL — and a
 * URL served by the shared dev server would make this rig test whichever branch
 * happens to be on the bench. Serving this checkout's own dist is the only way
 * the picture and the assertions are about the code under test.
 */
function serveDist() {
  const dist = path.join(desktopRoot, "dist");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  // The table the read-only tool will read. It is created through the real IPC
  // before the turns, and the endpoint fills `databaseId` from it, so the call
  // has a real argument and succeeds against this rig's throwaway vault.
  const world = { databaseId: null };
  const endpoint = await startFakeEndpoint(world);
  const baseUrl = `http://127.0.0.1:${endpoint.port}/v1`;

  const vaultDir = path.join(artifactsDir, "pi-vault");
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir, { recursive: true });

  // The app's tools reach it through the MCP door, so the door has to bind on
  // ports nobody else holds — see isolateMcpPorts.
  const mcpPorts = await isolateMcpPorts();

  const dist = await serveDist();
  process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${dist.port}`;
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const js = (code) => win.webContents.executeJavaScript(code);

  // The preload is in place before the page's own scripts; waiting on one probe
  // is enough and costs nothing.
  for (let i = 0; i < 200; i += 1) {
    if (await js("Boolean(window.lifequest)")) break;
    await sleep(50);
  }

  const configured = await js(`(async () => {
    const api = window.lifequest;
    const settings = await api.companionPiSettingsSave({
      baseUrl: ${JSON.stringify(baseUrl)},
      model: ${JSON.stringify(MODEL)},
      providerName: "Rig endpoint",
    });
    const switched = await api.companionUseHarness("pi");
    const created = await api.vaultCreate(${JSON.stringify(vaultDir)}, "Pi rig");
    const opened = await api.vaultOpen(${JSON.stringify(vaultDir)});
    // A new vault seeds the base Life area unlocked and Health/Mind/Finance/
    // Business/Relationships locked. This rig scopes agents by area and switches
    // the lens, so the two areas it uses are unlocked first — the same
    // domainUnlock IPC the onboarding and Settings call.
    const unlockedHealth = await api.domainUnlock("health");
    const unlockedFinance = await api.domainUnlock("financial");
    // The work-log row the tool turn produces is about a real read against a
    // real table, so make one. A read-only tool needs no seeded rows: the table
    // existing is what makes get_database succeed instead of erroring.
    let database = null;
    let databaseError = null;
    try {
      const made = await api.dbCreate(${JSON.stringify(RIG_DOMAIN)}, {
        name: ${JSON.stringify(RIG_DATABASE_NAME)},
      });
      if (made && made.ok) database = { id: made.value.id, name: made.value.name };
      else databaseError = made ? made.error : "no reply";
    } catch (e) {
      databaseError = e instanceof Error ? e.message : String(e);
    }
    return {
      settings: settings && settings.kind,
      switched: switched && switched.kind,
      createdOk: created && created.ok,
      openedOk: opened && opened.ok,
      unlocked: unlockedHealth && unlockedHealth.ok === true &&
        unlockedFinance && unlockedFinance.ok === true,
      database,
      databaseError,
    };
  })()`);
  world.databaseId = configured.database?.id ?? null;

  // A reload puts the renderer in the state a real launch would: Pi ready, a
  // vault open, the dock mounted.
  win.webContents.reload();
  let mounted = false;
  for (let i = 0; i < 300; i += 1) {
    if (await js("Boolean(document.querySelector('.chat-panel'))")) {
      mounted = true;
      break;
    }
    await sleep(100);
  }

  const turn = await js(`(async () => {
    const api = window.lifequest;
    const events = [];
    const off = api.onCompanionStream((event) => events.push(event));
    const created = await api.companionSessionCreate("Pi rig chat");
    const sessionId = created.ok ? created.value.id : null;
    if (!sessionId) return { ok: false, error: "no session", events };
    const result = await api.companionChatStream({
      sessionId,
      input: "Say hello",
      instructionsContext: {
        domainName: null,
        domainSlug: null,
        aboutMe: "",
        locked: false,
        vaultOpen: true,
      },
      runtime: null,
      receiptRelPath: null,
    });
    // The invoke reply and the stream frames travel on different channels, so
    // the last frames can still be queued when the turn resolves. Drain first.
    await new Promise((resolve) => setTimeout(resolve, 500));
    off();
    return { ok: result.ok === true, sessionId, events };
  })()`);

  // The stream channel carries frames: { sessionId, event }.
  const frames = (turn.events ?? []).map((frame) => frame && frame.event ? frame.event : frame);
  const deltas = frames
    .filter((event) => event && event.type === "assistant.delta")
    .map((event) => event.text)
    .join("");
  const completed = frames.some((event) => event && event.type === "run.completed");

  const stored = await js(`(async () => {
    const res = await window.lifequest.companionSessionMessages(${JSON.stringify(turn.sessionId)});
    return res && res.ok ? res.value.map((m) => m.role + ": " + m.content) : [];
  })()`);

  // Let the panel read it back: reload, then land on the chat if it did not.
  win.webContents.reload();
  let threadText = "";
  for (let i = 0; i < 300; i += 1) {
    threadText = await js("document.body.innerText");
    if (threadText.includes(REPLY)) break;
    if (i === 120) {
      // Open the list, then the chat, the way the operator would.
      await js(`(() => {
        const back = document.querySelector('[aria-label="All chats"]');
        if (back) back.click();
        return true;
      })()`);
      await sleep(400);
      await js(`(() => {
        const row = [...document.querySelectorAll('button')].find((el) =>
          (el.textContent ?? "").includes("Pi rig chat"),
        );
        if (row) row.click();
        return Boolean(row);
      })()`);
    }
    await sleep(100);
  }

  // A picture of the boot splash proves nothing about the dock: wait for it to
  // be gone (the gate fades it out, then marks it hidden).
  for (let i = 0; i < 200; i += 1) {
    const gone = await js(
      "(() => { const el = document.getElementById('splash'); return !el || el.hasAttribute('hidden') || getComputedStyle(el).display === 'none'; })()",
    );
    if (gone) break;
    await sleep(100);
  }
  await sleep(600);
  const threadImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "pi-companion-thread.png"), threadImage.toPNG());

  // The switcher: a vertical pill of agent blocks in the dock's corner. Both
  // agents are unscoped here, so both are offered on Overview.
  const pickerShown = await js(`(() => ({
    shown: Boolean(document.querySelector(".agent-switcher")),
    items: [...document.querySelectorAll(".agent-switcher__pill")].map(
      (el) => el.getAttribute("aria-label"),
    ),
  }))()`);
  const pickerImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, "pi-companion-picker.png"), pickerImage.toPNG());

  // ——— the tool turn: the dock's work log, from real pi-harness events ———
  //
  // The first turn proved a reply. This one proves the TIMELINE: the fake model
  // asks for a read-only vault tool the request itself advertised, pi-agent-core
  // executes it through the real MCP door, and the dock is read while the turn
  // runs and again after it settles. A live row can only appear in the chat the
  // dock is showing, and the reload leg above left it on this thread.
  const readFunction = readFunctionExpression();
  const liveTurn = await js(`(async () => {
    const api = window.lifequest;
    const read = ${readFunction};
    const events = [];
    const off = api.onCompanionStream((frame) => events.push(frame));
    const samples = [];
    let turnSamples = 0;
    // A cheap reader for the sampling loop: only the rows, because the question
    // is whether a row existed while the turn ran. Reading the whole snapshot
    // (html, body text) on every mutation would slow the expensive frames down.
    const readRows = () => {
      const turns = [...document.querySelectorAll('[data-testid="turn"]')].map((turn) => ({
        rows: [...turn.querySelectorAll('[data-testid="tool-row"], .chat-panel__activity-row')].map(
          (row) => ({
            text: (row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 220),
            attrs: {},
          }),
        ),
      }));
      return {
        at: Math.round(performance.now()),
        turns,
        // Debug breadcrumbs for the "seen while running" claim: the activity
        // line can exist with its list closed, so a sample with no row also has
        // to say whether the line was there and whether it was open.
        lines: [...document.querySelectorAll(".chat-panel__activity-line")].map((line) =>
          line.getAttribute("aria-expanded"),
        ),
        globalRows: document.querySelectorAll(".chat-panel__activity-row").length,
        legacyRows: [],
        legacyAnswers: [],
        bodyText: "",
      };
    };
    // Set the instant the invoke resolves, so the marked samples are exactly
    // those taken while the turn had not finished yet.
    const note = () => {
      if (samples.length < 600) samples.push(readRows());
    };
    // A fast local MCP call can leave its row on screen for only a few
    // milliseconds, so a 12 ms poll AND a MutationObserver both watch for it.
    // The sample count at settle marks the samples taken during the turn: those
    // are the ones that prove the row appeared WHILE the turn ran.
    const observer = new MutationObserver(note);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    // The tool-run block is a disclosure: its rows are not rendered while the
    // line is collapsed (which is its default, live or settled). Open it the
    // way the operator does, once, as soon as it appears — the row then exists
    // in the DOM while the turn is still running.
    const clickedLines = new Set();
    const openRunGroup = () => {
      for (const line of document.querySelectorAll(".chat-panel__activity-line")) {
        if (clickedLines.has(line) || line.getAttribute("aria-expanded") === "true") continue;
        clickedLines.add(line);
        line.click();
      }
    };
    let settled = false;
    const pending = api.companionChatStream({
      sessionId: ${JSON.stringify(turn.sessionId)},
      input: ${JSON.stringify(TOOL_PROMPT)},
      instructionsContext: {
        domainName: null,
        domainSlug: null,
        aboutMe: "",
        locked: false,
        vaultOpen: true,
      },
      runtime: null,
      receiptRelPath: null,
    }).then((result) => {
      turnSamples = samples.length;
      settled = true;
      return result;
    }).catch((error) => {
      turnSamples = samples.length;
      settled = true;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    });
    while (!settled) {
      note();
      openRunGroup();
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    const result = await pending;
    turnSamples = Math.min(turnSamples, samples.length);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    observer.disconnect();
    note();
    off();
    // A settled turn folds its process AND the run block re-mounts collapsed,
    // so neither the rows nor the args/results are in the DOM. Open both
    // disclosures the way the operator would, then read: the evidence has to
    // survive the fold, and the disclosures have to be reopenable.
    const expandSettled = async () => {
      let headers = 0;
      for (const header of document.querySelectorAll('[data-testid="process-header"]')) {
        if (header.getAttribute("aria-expanded") === "true") continue;
        header.click();
        headers += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      let lines = 0;
      for (const line of document.querySelectorAll(".chat-panel__activity-line")) {
        if (line.getAttribute("aria-expanded") === "true") continue;
        line.click();
        lines += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      return headers + lines;
    };
    const liveRows = read();
    const expanded = liveRows.turns.some((entry) => entry.rows.length > 0)
      ? 0
      : await expandSettled();
    const dom = read();
    return {
      ok: result.ok === true,
      error: result.ok ? null : result.error,
      events,
      samples,
      turnSamples,
      expanded,
      liveGroupOpened: clickedLines.size > 0,
      final: dom,
    };
  })()`);

  await sleep(400);
  fs.writeFileSync(
    path.join(artifactsDir, "pi-companion-turn.png"),
    (await win.webContents.capturePage()).toPNG(),
  );

  // What the wire and the DOM say about that turn, side by side: the wire is
  // the harness's facts, the DOM is the work log the operator reads.
  const liveFrames = (liveTurn.events ?? []).map((frame) =>
    frame && frame.event ? frame.event : frame,
  );
  const wireStarted = liveFrames.find((event) => event && event.type === "tool.started") ?? null;
  const wireCompleted = liveFrames.find((event) => event && event.type === "tool.completed") ?? null;
  const wireUsage = liveFrames.find((event) => event && event.type === "usage")?.usage ?? null;
  const wireFinal = liveFrames.find((event) => event && event.type === "assistant.final")?.text ?? null;
  const wireRunCompleted =
    liveFrames.find((event) => event && event.type === "run.completed") ?? null;
  const toolPlan =
    [...endpoint.requests].reverse().find(
      (request) => request.plan && request.plan.kind === "toolCall",
    )?.plan ?? null;
  const toolName = toolPlan?.name ?? wireStarted?.name ?? null;
  const toolArgs = toolPlan?.args ?? wireStarted?.args ?? null;

  const liveDom = liveTurn.final ?? {};
  const liveTurns = liveDom.turns ?? [];
  const liveToolTurn =
    liveTurns.find((entry) => Boolean(rowNamed({ turns: [entry] }, toolName))) ??
    liveTurns.find((entry) =>
      (entry.answers ?? []).some((answer) => (answer.text ?? "").includes(TOOL_ANSWER)),
    ) ??
    liveTurns[liveTurns.length - 1] ??
    null;
  const liveRow =
    rowNamed(liveToolTurn ? { turns: [liveToolTurn] } : liveDom, toolName) ??
    rowNamed(liveDom, toolName);
  const liveAnswer = answerOfDom(liveDom, liveToolTurn, TOOL_ANSWER);
  const preSettleSamples = (liveTurn.samples ?? []).slice(0, liveTurn.turnSamples ?? 0);
  // When the row was not sampled live, the samples say why: were the rows even
  // in the DOM, and was their disclosure open?
  const sampleShape = (sample) => ({
    at: sample.at,
    turnRows: (sample.turns ?? []).map((turn) => turn.rows.length),
    legacyRows: (sample.legacyRows ?? []).length,
    lines: sample.lines ?? null,
    globalRows: sample.globalRows ?? null,
  });
  const live = {
    turnOk: liveTurn.ok === true,
    turnError: liveTurn.error ?? null,
    samplesWithRows: preSettleSamples.filter((sample) =>
      (sample.turns ?? []).some((turn) => turn.rows.length > 0),
    ).length,
    sampleHead: preSettleSamples.slice(0, 4).map(sampleShape),
    sampleTail: preSettleSamples.slice(-4).map(sampleShape),
    toolName,
    toolArgs,
    rowText: liveRow?.text ?? "",
    target: targetOfRow(liveRow, configured.database?.id),
    rowState: rowStateOf(liveRow),
    rowSeenWhileRunning: preSettleSamples.some((sample) => Boolean(rowNamed(sample, toolName))),
    rowFirstSeenAt:
      preSettleSamples.find((sample) => Boolean(rowNamed(sample, toolName)))?.at ?? null,
    duration: durationOfRow(liveRow),
    foldHeader: foldHeaderOf(liveToolTurn),
    footerStatus: liveToolTurn?.footer?.status ?? null,
    answer: liveAnswer?.text ?? null,
    answerOutsideProcess: liveAnswer ? liveAnswer.insideProcess === false : null,
    usage: usageOfTurn(liveToolTurn),
    resultPreview: wireCompleted?.resultPreview ?? null,
    resultText: (liveToolTurn?.results ?? []).join(" ").slice(0, 1200),
    turnCount: liveTurns.length,
    sampleCount: (liveTurn.samples ?? []).length,
    preSettleSampleCount: preSettleSamples.length,
    expandedForRead:
      typeof liveTurn.expanded === "number" ? liveTurn.expanded > 0 : liveTurn.expanded === true,
    liveGroupOpened: liveTurn.liveGroupOpened === true,
    wire: {
      eventTypes: liveFrames.map((event) => event && event.type),
      toolStarted: wireStarted,
      toolCompleted: wireCompleted,
      usage: wireUsage,
      final: wireFinal,
      runCompleted: Boolean(wireRunCompleted),
      snapshotToolRows: (wireRunCompleted?.snapshot ?? [])
        .filter((row) => row.role === "tool")
        .map((row) => ({
          toolName: row.toolName ?? null,
          toolCallId: row.toolCallId ?? null,
          isError: row.isError === true,
          contentLength: (row.content ?? "").length,
        })),
    },
  };

  // ——— the same turn after a reload: history out of the structured transcript ———
  win.webContents.reload();
  let historyText = "";
  for (let i = 0; i < 300; i += 1) {
    historyText = await js("document.body.innerText");
    if (historyText.includes(TOOL_ANSWER)) break;
    if (i === 120) {
      await js(`(() => {
        const back = document.querySelector('[aria-label="All chats"]');
        if (back) back.click();
        return true;
      })()`);
      await sleep(400);
      await js(`(() => {
        const row = [...document.querySelectorAll('button')].find((el) =>
          (el.textContent ?? "").includes("Pi rig chat"),
        );
        if (row) row.click();
        return Boolean(row);
      })()`);
    }
    await sleep(100);
  }
  await sleep(700);
  const readHistory = () => js(`(() => { const read = ${readFunction}; return read(); })()`);
  let historyDom = await readHistory();
  if (!historyDom.turns.some((entry) => entry.rows.length > 0)) {
    // Reloaded turns render folded, and their run block is a collapsed
    // disclosure inside: open both, exactly as the live leg does, then read.
    await js(`(async () => {
      for (const header of document.querySelectorAll('[data-testid="process-header"]')) {
        if (header.getAttribute("aria-expanded") !== "true") header.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const line of document.querySelectorAll(".chat-panel__activity-line")) {
        if (line.getAttribute("aria-expanded") !== "true") line.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      return true;
    })()`);
    historyDom = await readHistory();
  }
  const historyTurns = historyDom.turns ?? [];
  const historyToolTurn =
    historyTurns.find((entry) => Boolean(rowNamed({ turns: [entry] }, toolName))) ??
    historyTurns.find((entry) =>
      (entry.answers ?? []).some((answer) => (answer.text ?? "").includes(TOOL_ANSWER)),
    ) ??
    historyTurns[historyTurns.length - 1] ??
    null;
  const historyRow =
    rowNamed(historyToolTurn ? { turns: [historyToolTurn] } : historyDom, toolName) ??
    rowNamed(historyDom, toolName);
  const historyAnswer = answerOfDom(historyDom, historyToolTurn, TOOL_ANSWER);
  const history = {
    textHasAnswer: historyText.includes(TOOL_ANSWER),
    toolRowSeen: Boolean(historyRow),
    rowText: historyRow?.text ?? "",
    target: targetOfRow(historyRow, configured.database?.id),
    rowState: rowStateOf(historyRow),
    foldHeader: foldHeaderOf(historyToolTurn),
    footerStatus: historyToolTurn?.footer?.status ?? null,
    answer: historyAnswer?.text ?? null,
    answerOutsideProcess: historyAnswer ? historyAnswer.insideProcess === false : null,
    usage: usageOfTurn(historyToolTurn),
    resultText: (historyToolTurn?.results ?? []).join(" ").slice(0, 1200),
    turnCount: historyTurns.length,
  };
  // The design claims a reloaded turn reads the same as the turn that produced
  // it. Say whether it does, fact by fact — and whether the reloaded footer
  // accounts for the same tokens (Pi sums both model calls of the turn; a
  // transcript rebuild may only carry the last assistant row's usage).
  const reloadParity = {
    rowTextMatchesLive: live.rowText === history.rowText,
    targetMatchesLive: live.target === history.target,
    footerStatusMatchesLive: live.footerStatus === history.footerStatus,
    answerMatchesLive: (live.answer ?? "") === (history.answer ?? ""),
    answerOutsideProcessMatchesLive:
      live.answerOutsideProcess === history.answerOutsideProcess,
    usageVsLive: {
      harnessFrame: wireUsage ?? null,
      liveFooter: live.usage.numbers ?? null,
      historyFooter: history.usage.numbers ?? null,
      totalsMatch:
        live.usage.numbers?.total != null && history.usage.numbers?.total != null
          ? live.usage.numbers.total === history.usage.numbers.total
          : null,
    },
  };
  fs.writeFileSync(
    path.join(artifactsDir, "pi-companion-turn-history.png"),
    (await win.webContents.capturePage()).toPNG(),
  );

  // The checks this new leg exists to prove. Kept as one named verdict each so
  // the report says which fact regressed, not just that the run failed.
  const toolChecks = {
    /** The invoke itself resolved; a failed turn would poison everything below. */
    toolTurnOk: live.turnOk === true,
    /** The request advertised the vault's tools, so a real call was possible. */
    toolsAdvertised: endpoint.requests.some((request) => request.toolCount > 0),
    databaseCreated: Boolean(configured.database?.id),
    /** The endpoint asked for a tool, not for text. */
    endpointRequestedToolCall: toolPlan != null,
    /** ...and the real pi-harness executed it. */
    harnessRanTool: Boolean(wireStarted && wireCompleted),
    toolSucceeded:
      wireCompleted?.isError === false &&
      typeof wireCompleted?.resultPreview === "string" &&
      wireCompleted.resultPreview.includes(RIG_DATABASE_NAME),
    liveRowSeen: Boolean(liveRow),
    liveRowSeenWhileRunning: live.rowSeenWhileRunning === true,
    liveRowNamesTool: Boolean(toolName) && live.rowText.includes(toolName),
    liveRowHasTarget: live.target.length > 0,
    liveRowTargetNamesTable:
      live.target.includes(configured.database?.id ?? "\u0000") ||
      live.target.includes(RIG_DATABASE_NAME),
    liveResultNamesTable:
      typeof live.resultPreview === "string" && live.resultPreview.includes(RIG_DATABASE_NAME),
    liveRowClosedDone: live.rowState === "done",
    // Presence is the claim: the row's duration came from the harness, not the
    // app, and it was actually observed (a sub-millisecond call can legitimately
    // round to 0).
    liveRowDuration:
      live.duration != null &&
      (live.duration.value === undefined || live.duration.value >= 0),
    foldHeaderNamesWork: typeof live.foldHeader === "string" && /worked for/i.test(live.foldHeader),
    answerIsSecondCompletion: typeof live.answer === "string" && live.answer.includes(TOOL_ANSWER),
    answerOutsideProcess: live.answerOutsideProcess === true,
    footerCompleted: live.footerStatus === "completed",
    usageAccounted: live.usage.present === true && live.usage.numeric === true,
    historyToolRowSeen: history.toolRowSeen === true,
    historyRowNamesTool: Boolean(toolName) && history.rowText.includes(toolName),
    historyRowHasTarget: history.target.length > 0,
    historyRowTargetNamesTable:
      history.target.includes(configured.database?.id ?? "\u0000") ||
      history.target.includes(RIG_DATABASE_NAME),
    historyResultNamesTable:
      typeof history.resultText === "string" &&
      history.resultText.includes(RIG_DATABASE_NAME),
    historyRowClosedDone: history.rowState === "done",
    historyFoldHeader: typeof history.foldHeader === "string" && /worked for/i.test(history.foldHeader),
    historyAnswerIsSecondCompletion:
      typeof history.answer === "string" && history.answer.includes(TOOL_ANSWER),
  };

  // Domain scoping, end to end through the Settings UI (the real writer is
  // VaultProvider, so the switcher sees the change). Hermes is narrowed to
  // Health and made that domain's default; Pi stays everywhere and becomes
  // Financial's default. The harness switch is stubbed while the domains are
  // entered: this world has no Hermes gateway, and the rule under test is the
  // renderer's, not that gateway.
  await js(`(() => { window.location.hash = "#/settings?tab=hermes"; return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    if (await js("Boolean(document.querySelector('.settings-agents'))")) break;
    await sleep(100);
  }
  const settingsDebug = await js(`(() => ({
    hash: window.location.hash,
    panel: Boolean(document.querySelector(".settings-agents")),
    labels: [...document.querySelectorAll(".settings-agents [aria-label]")].map(
      (el) => el.getAttribute("aria-label"),
    ).slice(0, 24),
    body: document.body.innerText.slice(0, 120),
  }))()`);
  const clickOption = (label) =>
    js(`(() => {
      const el = [...document.querySelectorAll("[aria-label]")].find(
        (node) => node.getAttribute("aria-label") === ${JSON.stringify(label)},
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);
  const scopedHermes = await clickOption("Hermes: Health");
  await sleep(500);
  const defaultedHermes = await clickOption("Hermes: default in Health");
  await sleep(500);
  // Pi is offered everywhere already; it only needs Finance as its default.
  const defaultedPi = await clickOption("Pi: default in Finance");
  await sleep(600);
  const persisted = await js(`(async () => {
    const snap = await window.lifequest.vaultGetSnapshot();
    return snap && snap.ok ? snap.value.settings.agentScopes ?? null : null;
  })()`);

  // Back to the studio. The switch into a defaulted domain is real; a world
  // without a ready Hermes gate on the setup screen instead, and that screen
  // naming Hermes is the same rule having fired.
  await js(`(() => { window.location.hash = "#/home"; return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    if (await js("Boolean(document.querySelector('.domain-switcher'))")) break;
    await sleep(100);
  }

  const readSwitcher = () =>
    js(`(() => ({
      pills: [...document.querySelectorAll(".agent-switcher__pill")].map((el) => ({
        name: el.getAttribute("aria-label"),
        active: el.getAttribute("aria-checked") === "true",
      })),
      heading: document.querySelector(".chat-panel__heading--thread")?.textContent ?? null,
    }))()`);
  await sleep(700);
  const scopeOverview = await readSwitcher();
  fs.writeFileSync(
    path.join(artifactsDir, "pi-companion-scope-overview.png"),
    (await win.webContents.capturePage()).toPNG(),
  );

  const clickedHealth = await js(`(() => {
    const chip = [...document.querySelectorAll(".domain-switcher .ui-segmented__option")].find(
      (el) => (el.textContent ?? "").trim() === "Health",
    );
    if (!chip) return false;
    chip.click();
    return true;
  })()`);
  await sleep(1600);
  const healthGated = await js(`(() => {
    const lead = document.querySelector(".welcome-lead")?.textContent ?? "";
    return { gated: Boolean(document.querySelector(".welcome")), lead };
  })()`);
  const scopeHealth = await readSwitcher();
  fs.writeFileSync(
    path.join(artifactsDir, "pi-companion-scope-domain.png"),
    (await win.webContents.capturePage()).toPNG(),
  );

  const clickedFinancial = await js(`(() => {
    const chip = [...document.querySelectorAll(".domain-switcher .ui-segmented__option")].find(
      (el) => (el.textContent ?? "").trim() === "Finance",
    );
    if (!chip) return false;
    chip.click();
    return true;
  })()`);
  await sleep(1600);
  const scopeFinancial = await readSwitcher();

  const report = {
    ok:
      configured.settings === "ready" &&
      configured.switched === "ready" &&
      configured.openedOk === true &&
      configured.unlocked === true &&
      mounted === true &&
      turn.ok === true &&
      deltas.includes(REPLY) &&
      Array.isArray(stored) &&
      stored.some((line) => line.includes(REPLY)) &&
      completed === true &&
      threadText.includes(REPLY) &&
      pickerShown.shown === true &&
      scopedHermes === true &&
      defaultedHermes === true &&
      defaultedPi === true &&
      Array.isArray(persisted) &&
      persisted.some((scope) => scope.agentId === "hermes" && scope.domains.includes("health")) &&
      scopeOverview.pills.length === 1 &&
      (healthGated.gated
        ? /hermes/i.test(healthGated.lead)
        : scopeHealth.pills.length === 2 &&
          scopeHealth.pills.some((pill) => pill.name === "Hermes" && pill.active)) &&
      scopeFinancial.pills.length === 1 &&
      scopeFinancial.pills.some((pill) => pill.name === "Pi" && pill.active) &&
      Object.values(toolChecks).every((pass) => pass === true),
    configured,
    mounted,
    turn: {
      ok: turn.ok,
      sessionId: turn.sessionId,
      eventTypes: frames.map((event) => event && event.type),
      raw: turn.events ?? [],
    },
    deltas,
    completed,
    stored,
    threadHasReply: threadText.includes(REPLY),
    picker: pickerShown,
    tool: {
      checks: toolChecks,
      database: configured.database ?? null,
      databaseError: configured.databaseError ?? null,
      mcpPorts,
      plan: toolPlan,
      live,
      history,
      reloadParity,
      requests: endpoint.requests.map((request) => ({
        lastRole: request.lastRole,
        lastUserText: request.lastUserText,
        hasToolResult: request.hasToolResult,
        toolCount: request.toolCount,
        plan: request.plan,
      })),
      toolsAdvertised: [...(endpoint.requests.find((request) => request.toolCount > 0)?.tools ?? [])],
    },
    scopes: {
      settingsDebug,
      scopedHermes,
      defaultedHermes,
      defaultedPi,
      persisted,
      clickedHealth,
      clickedFinancial,
      overview: scopeOverview,
      health: scopeHealth,
      healthGated,
      financial: scopeFinancial,
    },
    endpoint: baseUrl,
    screenshots: [
      "pi-companion-thread.png",
      "pi-companion-picker.png",
      "pi-companion-turn.png",
      "pi-companion-turn-history.png",
      "pi-companion-scope-overview.png",
      "pi-companion-scope-domain.png",
    ],
  };
  fs.writeFileSync(
    path.join(artifactsDir, "pi-companion.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log("pi companion:", report.ok ? "PASS" : "FAIL");
  console.log(JSON.stringify(report, null, 1));
  endpoint.server.close();
  dist.server.close();
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error("pi companion rig failed:", error);
  app.exit(1);
});
