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
 * The turn is driven through the real preload bridge (`window.lifequest`), the
 * same calls the panel makes, and the transcript is then read back by the real
 * panel after a reload.
 *
 * Artifacts:
 *   e2e/artifacts/pi-companion.json    the report
 *   e2e/artifacts/pi-companion-thread.png
 *   e2e/artifacts/pi-companion-picker.png
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

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function startFakeEndpoint() {
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
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const parts = ["Hello", " from", " Pi."];
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
            setTimeout(send, 30);
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
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
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
  const server = await startFakeEndpoint();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const vaultDir = path.join(artifactsDir, "pi-vault");
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir, { recursive: true });

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
    return {
      settings: settings && settings.kind,
      switched: switched && switched.kind,
      createdOk: created && created.ok,
      openedOk: opened && opened.ok,
      unlocked: unlockedHealth && unlockedHealth.ok === true &&
        unlockedFinance && unlockedFinance.ok === true,
    };
  })()`);

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
      scopeFinancial.pills.some((pill) => pill.name === "Pi" && pill.active),
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
  server.close();
  dist.server.close();
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error("pi companion rig failed:", error);
  app.exit(1);
});
