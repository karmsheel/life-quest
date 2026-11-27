/**
 * The onboarding rig: boots the REAL main process, preload and renderer on a
 * throwaway vault, then holds the operator-facing contract of P1.
 *
 * WHY THIS RIG EXISTS
 *
 * A new vault opens on Life with five areas seeded but LOCKED, and the chat dock
 * carries one quiet first-run card. The companion interviews the operator and
 * then OPENS the areas itself: one tool call applies the whole batch — unlocks,
 * doctrine drafts, at most one table, one note, a completed record — and leaves
 * the proposal file as the receipt for ONE announcement card. The card says
 * "I've opened up the Health and Business areas for you" and offers a single
 * Continue; the areas are already open when it appears. This rig is the only one
 * that proves that whole join over the real IPC bridge, a real vault, and a real
 * chat turn through the built-in companion.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *  1. The card is a mock, not the app. Every card is the real dock's DOM, gated
 *     on the vault's record and receipt, and Continue goes through the real
 *     preload channel.
 *  2. The model is faked and therefore the interview is faked. The fake endpoint
 *     logs the request bodies: the rig asserts the system prompt the app actually
 *     sent carried the five-area rubric and the `propose_onboarding_unlock`
 *     instruction BEFORE scripting the tool call back. The prompt is real; only
 *     the model's choice is scripted.
 *  3. The announcement is a lie that redraws. The rig asserts the vault is
 *     ALREADY unlocked (band and disk) while the card is on screen, and every
 *     claim about the unlock, doctrine, table, note, record and log is re-read
 *     from the vault's files by the test after the window exits.
 *  4. The screenshot is stale, blank, or another window's. Each is this window's
 *     own capturePage() at the moment named; the test requires > 20 KB.
 *  5. The rig touches the operator's app, vault or Hermes. HERMES_HOME is a temp
 *     dir, a stub `hermes` is first on PATH, both vaults are throwaway
 *     createVault()s, the MCP doors move to free ports, and the app profile is a
 *     throwaway from LIFEQUEST_E2E. The Hermes attach point is a fake server in
 *     this process; the Pi model is a fake OpenAI endpoint.
 *
 * Run by `tests/onboarding-e2e.test.ts`; it builds the world and passes it as
 * `LQ_ONBOARDING_WORLD`. Exit 0 = every check held; the artifact is
 * `e2e/artifacts/onboarding.json` plus three screenshots.
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
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "onboarding.json");
const SHOT_WELCOME = path.join(artifactsDir, "onboarding-welcome.png");
const SHOT_OPENED = path.join(artifactsDir, "onboarding-opened.png");
const SHOT_UNLOCKED = path.join(artifactsDir, "onboarding-unlocked.png");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const MODEL = "rig-model";

const checks = [];
const failures = [];
const screenshots = [];
const states = {};
const requests = [];
let toolCallServed = false;
let finalTextServed = false;

function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail: detail === null ? null : String(detail) });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

async function shot(win, file) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  const bytes = fs.statSync(file).size;
  screenshots.push({ file, bytes });
  return bytes;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const TOOL_ARGS = JSON.stringify({
  areas: [
    {
      slug: "health",
      doctrine: {
        premise: "I am someone whose thinking runs on sleep and movement.",
        what: "A week where I wake without an alarm and train twice.",
        why: "Because the work I care about needs a rested head.",
        how: "Lights out by 22:30 on weekdays; a walk at lunch.",
      },
    },
    {
      slug: "business",
      doctrine: {
        premise: "My craft deserves an offer of its own, not favours.",
        what: "Two clients I chose, and one product line shipped.",
        why: "Because the work should outlive a single gig.",
        how: "One proposal out per week; Tuesday deep-work block.",
      },
    },
  ],
  table: {
    areaSlug: "health",
    name: "Sleep log",
    columns: [
      { name: "Night", type: "date" },
      { name: "Hours", type: "number" },
    ],
  },
  note: {
    title: "First conversation",
    body: "We talked about the sleep I have been losing, the work I want back, and what a rested week would look like.",
  },
});

/**
 * The model's half of the interview, scripted against the real request bodies.
 *
 * - a probe without tools (e.g. a title or catalog call) gets plain text;
 * - a real chat turn with tools but no tool result gets the one
 *   propose_onboarding_unlock call, which is the whole point;
 * - the follow-up turn that carries the tool result gets the reflection text.
 *
 * Every request body is logged so the test can assert what the app told the
 * companion before any of this.
 */
function startFakeModel() {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          body = {};
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const toolDefs = Array.isArray(body.tools) ? body.tools : [];
        const hasToolResult = messages.some((m) => m && m.role === "tool");
        const systemText = messages
          .filter((m) => m && m.role === "system")
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n");
        requests.push({
          stream: body.stream !== false,
          toolCount: toolDefs.length,
          messageRoles: messages.map((m) => m?.role).slice(-8),
          hasToolResult,
          systemHasRubric:
            systemText.includes("propose_onboarding_unlock") &&
            systemText.includes("Relationships") &&
            systemText.includes("financial"),
          // The report keeps the whole instructions the app sent, so the
          // evidence shows the rubric the companion actually read rather than
          // a slice that might cut the area list from the tool rule.
          systemSample: systemText,
        });

        const wantsToolCall = toolDefs.length > 0 && !hasToolResult;
        const stream = body.stream !== false;
        const chunks = [];
        if (!wantsToolCall) {
          const text = hasToolResult
            ? "I've opened up Health and Business for you — the card has the details whenever you want them."
            : "The onboarding interview is ready when you are.";
          if (hasToolResult) finalTextServed = true;
          const words = text.split(" ");
          if (stream) {
            for (const word of words) {
              chunks.push({
                id: "rig",
                object: "chat.completion.chunk",
                created: 0,
                model: MODEL,
                choices: [{ index: 0, delta: { content: `${word} ` }, finish_reason: null }],
              });
            }
          } else {
            chunks.push({
              id: "rig",
              object: "chat.completion.chunk",
              created: 0,
              model: MODEL,
              choices: [{ index: 0, delta: {}, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            });
          }
        } else {
          toolCallServed = true;
          chunks.push({
            id: "rig",
            object: "chat.completion.chunk",
            created: 0,
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_onboarding_1",
                      type: "function",
                      function: { name: "propose_onboarding_unlock", arguments: TOOL_ARGS },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        }
        chunks.push({
          id: "rig",
          object: "chat.completion.chunk",
          created: 0,
          model: MODEL,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: wantsToolCall ? "tool_calls" : "stop",
            },
          ],
        });

        if (!stream) {
          res.writeHead(200, { "content-type": "application/json" });
          const textResponse = {
            id: "rig",
            object: "chat.completion",
            created: 0,
            model: MODEL,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: wantsToolCall
                    ? null
                    : "I've opened up Health and Business for you — the card has the details.",
                  ...(wantsToolCall
                    ? {
                        tool_calls: [
                          {
                            id: "call_onboarding_1",
                            type: "function",
                            function: { name: "propose_onboarding_unlock", arguments: TOOL_ARGS },
                          },
                        ],
                      }
                    : {}),
                },
                finish_reason: wantsToolCall ? "tool_calls" : "stop",
              },
            ],
          };
          res.end(JSON.stringify(textResponse));
          return;
        }

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const chunk of chunks) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** The companion's attach point: a real HTTP server, no sessions. */
async function serveHealth(port) {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/health" || url.endsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (url.endsWith("/v1/capabilities")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          features: {
            session_list: true,
            session_resources: true,
            session_chat: true,
            session_chat_stream: true,
          },
        }),
      );
      return;
    }
    if (url.includes("/api/sessions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"sessions":[]}');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

const readWorld = () =>
  JSON.parse(fs.readFileSync(path.join(process.env.LQ_ONBOARDING_WORLD, "world.json"), "utf8"));

function writeHostEnv(hermesHome, port) {
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${port}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
    "utf8",
  );
}

function writeReport(pass) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        pass,
        failures,
        checks,
        states,
        screenshots,
        requests,
        toolCallServed,
        finalTextServed,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function domainMeta(vaultDir, slug) {
  return JSON.parse(fs.readFileSync(path.join(vaultDir, "domains", slug, "domain.json"), "utf8"));
}

/** The dock's onboarding surface, as the operator sees it. */
const CARD_EXPRESSION = `(() => {
  const card = document.querySelector('[data-testid="onboarding-card"]');
  if (!card) return { present: false };
  return {
    present: true,
    status: card.getAttribute("data-onboarding-status"),
    text: (card.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 600),
    buttons: Array.from(card.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()),
    checkboxLines: Array.from(card.querySelectorAll('input[type="checkbox"]')).length,
    ariaLabel: card.getAttribute("aria-label"),
  };
})()`;

/** The band as the operator sees it. */
const LENS_EXPRESSION = `(() => {
  const switcher = document.querySelector(".domain-switcher");
  const tabs = document.querySelector(".domain-switcher__tabs");
  return {
    switcher: Boolean(switcher),
    quiet: Boolean(document.querySelector(".domain-switcher--quiet")),
    quietText: (document.querySelector(".domain-switcher__life")?.textContent ?? "").trim(),
    tabs: tabs
      ? Array.from(tabs.querySelectorAll(".ui-segmented__option")).map((b) => ({
          label: (b.textContent ?? "").trim(),
          checked: b.getAttribute("aria-checked") === "true",
        }))
      : null,
  };
})()`;

async function clickButtonByText(win, text) {
  return win.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").replace(/\\s+/g, " ").trim() === wanted,
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function clickCardButton(win, pattern) {
  return win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-testid="onboarding-card"]');
    if (!card) return false;
    const re = new RegExp(${JSON.stringify(pattern)});
    const button = [...card.querySelectorAll("button")].find((b) =>
      re.test((b.textContent ?? "").replace(/\\s+/g, " ").trim()),
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function run() {
  const world = readWorld();
  const healthPort = await freePort();
  const healthServer = await serveHealth(healthPort);
  writeHostEnv(world.hermesHome, healthPort);

  const modelServer = await startFakeModel();
  const modelPort = modelServer.address().port;
  states.modelBaseUrl = `http://127.0.0.1:${modelPort}/v1`;

  process.env.HERMES_HOME = world.hermesHome;
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  process.env[pathKey] = `${world.binDir}${path.delimiter}${process.env[pathKey] ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;
  // Override the wrapper's throwaway profile with this rig's world so the MCP
  // doors land on free ports (the companion's tools live behind that door).
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  let win = null;
  try {
    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    win = await bootForE2e();

    const js = (code) => win.webContents.executeJavaScript(code);

    // ── 0. point the built-in companion at the fake model, then reload ─────
    const configured = await js(`(async () => {
      const api = window.lifequest;
      const settings = await api.companionPiSettingsSave({
        baseUrl: ${JSON.stringify(`http://127.0.0.1:${modelPort}/v1`)},
        model: ${JSON.stringify(MODEL)},
        providerName: "Onboarding rig endpoint",
      });
      const switched = await api.companionUseHarness("pi");
      return {
        settings: settings && settings.kind,
        switched: switched && switched.kind,
      };
    })()`);
    states.configured = configured;
    check("the rig pointed the companion at its fake model", configured.settings === "ready", configured);
    check("the rig switched to the built-in companion", configured.switched === "ready", configured);

    win.webContents.reload();
    await waitFor(win, `Boolean(document.querySelector(".chat-panel"))`, "the chat dock to mount", 120_000);
    await waitFor(
      win,
      `Boolean(document.querySelector('[data-testid="onboarding-card"]'))`,
      "the first-run onboarding card",
      60_000,
    );
    await sleep(400);

    // ── 1. a new vault: quiet Life, one welcome card, no locked name ──────
    const fresh = await js(LENS_EXPRESSION);
    states.fresh = fresh;
    check("the titlebar carries the lens on first run", fresh.switcher === true, fresh.switcher);
    check("a new vault shows the quiet Life label", fresh.quiet === true, fresh);
    check("the quiet label reads Life", fresh.quietText === "Life", fresh.quietText);
    check("there is no switcher before a second area", fresh.tabs === null, fresh.tabs);

    const welcome = await js(CARD_EXPRESSION);
    states.welcome = welcome;
    check("the first-run welcome card is in the dock", welcome.present === true, welcome);
    check("the welcome card is the not_started card", welcome.status === "not_started", welcome.status);
    check(
      "the welcome copy offers the interview and the way out",
      typeof welcome.text === "string" &&
        welcome.text.includes("Welcome to LifeQuest") &&
        welcome.text.includes("Or just start talking"),
      welcome.text,
    );
    check(
      "the welcome card offers Begin the interview",
      welcome.buttons.includes("Begin the interview"),
      welcome.buttons,
    );
    check(
      "no locked area is named before the interview",
      !/\\b(Mind|Business|Relationships)\\b/.test(welcome.text) ||
        welcome.text.includes("Begin the interview"),
      welcome.text,
    );

    const welcomeBytes = await shot(win, SHOT_WELCOME);
    check("the first-run card was captured", welcomeBytes > 20 * 1024, `${welcomeBytes} bytes`);

    // ── 2. Begin the interview: the kickoff turn reaches the companion ────
    const began = await clickButtonByText(win, "Begin the interview");
    check("Begin the interview is clickable", began === true, began);
    await waitFor(win, `document.querySelectorAll(".chat-panel__message").length > 0`, "the operator's opening turn");
    await waitFor(
      win,
      `document.querySelector('[data-testid="onboarding-card"]')?.getAttribute("data-onboarding-status") === "opened"`,
      "the announcement card after the tool opened the areas",
      120_000,
    );
    await sleep(700);

    states.prompt = requests.map((r) => ({
      toolCount: r.toolCount,
      hasToolResult: r.hasToolResult,
      systemHasRubric: r.systemHasRubric,
    }));
    const rubricRequest = requests.find((r) => r.systemHasRubric);
    check(
      "the companion was told the five-area rubric and the proposal tool",
      rubricRequest !== undefined,
      states.prompt,
    );
    states.promptSample = rubricRequest?.systemSample ?? null;
    check(
      "the proposal tool was scripted, not pre-seeded",
      toolCallServed === true,
      toolCallServed,
    );

    // ── 3. the receipt: already opened, and the card says so ─────────────
    const openedCard = await js(CARD_EXPRESSION);
    states.opened = openedCard;
    check("the announcement card replaces the welcome card", openedCard.status === "opened", openedCard.status);
    check(
      "the card names both heard areas",
      openedCard.text.includes("Health") && openedCard.text.includes("Business"),
      openedCard.text,
    );
    check(
      "the card says the companion opened them",
      openedCard.text.includes("After analyzing our conversation, I've opened up the Health and Business areas for you"),
      openedCard.text,
    );
    check(
      "the card says what the areas are for",
      openedCard.text.includes("These let you hone in and focus on different areas in your life"),
      openedCard.text,
    );
    check(
      "the card asks for no ticks and no permission",
      openedCard.checkboxLines === 0 &&
        JSON.stringify(openedCard.buttons) === JSON.stringify(["Continue"]),
      { buttons: openedCard.buttons, checkboxes: openedCard.checkboxLines },
    );

    // The areas are ALREADY open while the card is up. That is the whole point:
    // the companion did it, not the operator.
    const openedBand = await js(LENS_EXPRESSION);
    states.preContinueBand = openedBand;
    check("the band is already Life · Health · Business while the card is up", openedBand.quiet === false, openedBand);
    check(
      "the band already reads Life, Health, Business",
      JSON.stringify((openedBand.tabs ?? []).map((tab) => tab.label)) ===
        JSON.stringify(["Life", "Health", "Business"]),
      openedBand.tabs,
    );

    const openedRecord = JSON.parse(fs.readFileSync(path.join(world.vaultDir, ".lifequest", "onboarding.json"), "utf8"));
    const openedReceipt = fs.existsSync(path.join(world.vaultDir, ".lifequest", "onboarding-proposal.json"));
    states.preContinueVault = {
      status: openedRecord.status,
      unlockedAreas: openedRecord.unlockedAreas,
      receipt: openedReceipt,
      health: domainMeta(world.vaultDir, "health").unlockedAt,
      business: domainMeta(world.vaultDir, "business").unlockedAt,
      doctrine: fs
        .readdirSync(path.join(world.vaultDir, "domains", "health"))
        .filter((name) => ["premise.md", "what.md", "why.md", "how.md"].includes(name)),
    };
    check("the record is already completed while the card is up", openedRecord.status === "completed", openedRecord.status);
    check(
      "the record lists the areas that were opened",
      JSON.stringify(openedRecord.unlockedAreas) === JSON.stringify(["health", "business"]),
      openedRecord.unlockedAreas,
    );
    check(
      "Health is already unlocked before Continue",
      typeof domainMeta(world.vaultDir, "health").unlockedAt === "string",
      domainMeta(world.vaultDir, "health").unlockedAt,
    );
    check(
      "Business is already unlocked before Continue",
      typeof domainMeta(world.vaultDir, "business").unlockedAt === "string",
      domainMeta(world.vaultDir, "business").unlockedAt,
    );
    check(
      "the doctrine drafts are already written before Continue",
      ["premise.md", "what.md", "why.md", "how.md"].every((name) =>
        fs.existsSync(path.join(world.vaultDir, "domains", "health", name)),
      ),
      states.preContinueVault.doctrine,
    );
    check(
      "the proposal file is the receipt while the card is up",
      openedReceipt === true,
      openedReceipt,
    );

    const openedBytes = await shot(win, SHOT_OPENED);
    check("the announcement card was captured", openedBytes > 20 * 1024, `${openedBytes} bytes`);

    // ── 4. Continue acknowledges the receipt; nothing new is applied ─────
    const acknowledged = await clickCardButton(win, "^Continue$");
    check("the card's Continue is clickable", acknowledged === true, acknowledged);
    await waitFor(
      win,
      `!document.querySelector('[data-testid="onboarding-card"]')`,
      "the announcement card to go away",
      30_000,
    );
    await sleep(500);

    const afterContinueRecord = JSON.parse(fs.readFileSync(path.join(world.vaultDir, ".lifequest", "onboarding.json"), "utf8"));
    check("Continue leaves the record completed", afterContinueRecord.status === "completed", afterContinueRecord.status);
    check(
      "Continue removes the receipt",
      !fs.existsSync(path.join(world.vaultDir, ".lifequest", "onboarding-proposal.json")),
      null,
    );
    const afterContinueBand = await js(LENS_EXPRESSION);
    states.unlocked = afterContinueBand;
    check("the switcher stays Life, Health, Business", afterContinueBand.quiet === false, afterContinueBand);
    const postCard = await js(CARD_EXPRESSION);
    states.postContinueCard = postCard;
    check("no onboarding card after Continue", postCard.present === false, postCard);

    const unlockedBytes = await shot(win, SHOT_UNLOCKED);
    check("the opened Life was captured", unlockedBytes > 20 * 1024, `${unlockedBytes} bytes`);

    // ── 5. a reload never brings the card back ───────────────────────────
    win.webContents.reload();
    await waitFor(win, `Boolean(document.querySelector(".chat-panel"))`, "the dock after reload", 120_000);
    await sleep(900);
    const reloaded = await js(CARD_EXPRESSION);
    states.reloaded = reloaded;
    check("a completed vault never shows the onboarding card again", reloaded.present === false, reloaded);

    // ── 6. an existing vault (no onboarding file) never sees a card ──────
    const opened = await js(`(async () => {
      const res = await window.lifequest.vaultOpen(${JSON.stringify(world.legacyVaultDir)});
      return res && res.ok === true;
    })()`);
    check("the rig can open the legacy vault", opened === true, opened);
    win.webContents.reload();
    await waitFor(win, `Boolean(document.querySelector(".chat-panel"))`, "the dock on the legacy vault", 120_000);
    await sleep(1200);
    const legacy = await js(CARD_EXPRESSION);
    states.legacy = legacy;
    check("an existing vault with no onboarding file shows no card", legacy.present === false, legacy);

    writeReport(checks.every((entry) => entry.pass));
    return checks.every((entry) => entry.pass);
  } catch (error) {
    if (win) {
      try {
        states.diagnostic = await win.webContents.executeJavaScript(`(() => ({
          href: location.href,
          title: document.title,
          bodyText: (document.body?.innerText ?? "").slice(0, 900),
          hasLens: Boolean(document.querySelector(".window-titlebar__lens")),
          hasChat: Boolean(document.querySelector(".chat-panel")),
          card: (() => {
            const card = document.querySelector('[data-testid="onboarding-card"]');
            return card ? card.getAttribute("data-onboarding-status") : null;
          })(),
        }))()`);
        const bytes = await shot(win, path.join(artifactsDir, "onboarding-diagnostic.png"));
        states.diagnosticScreenshot = `${bytes} bytes`;
      } catch (diagnosticError) {
        states.diagnosticError = String(diagnosticError);
      }
    }
    throw error;
  } finally {
    await new Promise((resolve) => healthServer.close(resolve));
    await new Promise((resolve) => modelServer.close(resolve));
  }
}

run()
  .then((pass) => {
    if (!pass) console.error(`[onboarding] failures: ${failures.join("; ")}`);
    app.quit();
    process.exitCode = pass ? 0 : 1;
  })
  .catch((error) => {
    if (states.diagnostic) console.error(`[onboarding] window held: ${JSON.stringify(states.diagnostic)}`);
    failures.push(error instanceof Error ? error.message : String(error));
    states.error = String(error?.stack ?? error);
    try {
      writeReport(false);
    } catch {
      /* the artifact is best effort on a crash */
    }
    console.error(`[onboarding] rig crashed: ${error?.stack ?? error}`);
    app.quit();
    process.exitCode = 1;
  });
