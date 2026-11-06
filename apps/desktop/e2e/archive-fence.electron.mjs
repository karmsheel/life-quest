/**
 * The archive fence rig: does archiving a chat actually reach the gateway as a
 * write the gateway will accept, and does a dead gateway say something the
 * operator can act on?
 *
 * WHY THIS RIG EXISTS
 *
 * The operator pressed Archive in the left sidebar and got "Fetch failed".
 * Two separate defects sat behind that one symptom:
 *
 *   1. `companionSessionPatch` called `hermesFetch` directly, while every other
 *      session call went through the `gatewayCall` wrapper. So when the Hermes
 *      host was not answering, the raw undici message ("fetch failed") went
 *      straight into the sidebar's error banner — the operator was told a
 *      transport string and nothing about what to do about it.
 *
 *   2. The Hermes host gateway FENCES every session mutation. `PATCH
 *      /api/sessions/{id}` refuses a write that carries no `request_id` and no
 *      `expected_revision` (409 `mutation_identity_required`, or 409
 *      `CLIENT_UPGRADE_REQUIRED` for a pre-fence client), and refuses one whose
 *      revision no longer matches the row (`revision_conflict`). The app sent
 *      only `{archived: true}`, so even against a healthy gateway the archive
 *      was refused as a pre-fence client. The revision the fence needs is
 *      already in the list read (`runtime_revision`); the app just dropped it.
 *
 * So the rig drives the REAL main process and the REAL sidebar against a fake
 * gateway that behaves like the real one, and asserts:
 *
 *   - the archive PATCH carries a `request_id` and an `expected_revision`;
 *   - the `expected_revision` is the row's own revision, as the list read it;
 *   - the gateway's own refusal (a 409) is surfaced as the gateway said it,
 *     not swallowed;
 *   - a gateway that is GONE produces a named, actionable message — and never
 *     the raw words "fetch failed".
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway accepts anything, so the fence is never exercised. It
 *      does NOT: it refuses a write with no mutation identity exactly as the
 *      real host does (409 `mutation_identity_required`), and refuses one whose
 *      `expected_revision` does not match the row (`revision_conflict`). The
 *      rig records every PATCH it received, body and all, and the judge reads
 *      that log — so a rig that never archived anything fails on the log, not
 *      on a self-report.
 *   2. The rig passes because the app never archived. Every check reads the
 *      gateway's own request log, so "the PATCH arrived" is a fact about the
 *      wire, not about the app's state.
 *   3. The dead-gateway check passes because the app was never ready. The rig
 *      waits for the sidebar to mount and for the gateway's live chat to be
 *      painted FIRST — that proves the app attached to a live gateway — and
 *      only then stops it. So the later failure is the gateway dying, not the
 *      app never having connected.
 *   4. The error message check is satisfied by any string. The judge requires
 *      the message to NAME the agent and the control that retries it, and
 *      separately requires that it does NOT contain the raw undici words.
 *   5. The screenshot is stale, blank, or of another window. It is this
 *      window's own `capturePage()` after the error banner painted, and the
 *      judge requires >10 KB on disk.
 *   6. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH, the
 *      profile is one no real install has (`lq-fence-e2e`), the vault is a
 *      throwaway `createVault()` copy, and the MCP doors are moved to free
 *      ports by `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *
 * Run by `tests/archive-fence-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME`, throwaway vault, `recent.json`, fake `hermes` on PATH) and
 * passes it as `LQ_FENCE_WORLD`:
 *
 *   LQ_FENCE_WORLD=<dir> <electron> e2e/archive-fence.electron.mjs
 *
 * The driver starts the fake gateway on its own free port (the port has to be
 * known before `.env` is written), boots the REAL main process through
 * `bootForE2e`, drives the REAL sidebar, and writes
 * `e2e/artifacts/archive-fence.json` plus `e2e/artifacts/archive-fence.png`.
 * Exit 0 = its checks held.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT_NAME = "archive-fence.json";
const SCREENSHOT_NAME = "archive-fence.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

const failures = [];
const checks = [];
const notes = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) console.error(`[archive-fence] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
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
 * The fake Hermes host gateway, with the real host's FENCES.
 *
 * `/health` and `/v1/capabilities` are the attach probes; `/api/sessions` is
 * the list, and it carries each row's `runtime_revision` because the real
 * host's list rows do (the app needs it to fence the archive).
 *
 * The PATCH is the point of this rig, and it behaves like the real host:
 *
 *   - a write with no `request_id` and no `expected_revision` is refused with
 *     409 `mutation_identity_required` (the real host's pre-fence refusal);
 *   - a write whose `expected_revision` does not match the row is refused with
 *     409 `revision_conflict`;
 *   - a properly fenced write commits, bumps the row's revision, and answers
 *     the receipt the real host answers (`ok`, `session_id`, `revision`,
 *     `operation`, and the flag that was written).
 *
 * Every PATCH is recorded — method, path, body — so the judge reads the wire
 * rather than the app's own account of itself.
 */
function serveGateway(world) {
  const state = { sessionsRequests: [], patches: [] };
  const rows = [
    {
      id: world.live.id,
      title: world.live.title,
      preview: world.live.preview ?? "",
      started_at: Math.floor(Date.now() / 1000) - 900,
      last_active: Math.floor(Date.now() / 1000) - 300,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: 1,
      runtime_revision: world.rowRevision ?? 7,
    },
    {
      // A second working chat, so archiving one does not empty the sidebar
      // and leave the dead-gateway gesture with nothing to aim at.
      id: world.second.id,
      title: world.second.title,
      preview: world.second.preview ?? "",
      started_at: Math.floor(Date.now() / 1000) - 800,
      last_active: Math.floor(Date.now() / 1000) - 200,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: 1,
      runtime_revision: world.rowRevision ?? 7,
    },
  ];

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
          resolve({ __unparsable: raw });
        }
      });
    });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (payload, status = 200) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(payload));
    const method = req.method ?? "GET";

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

    // The app scopes every call by profile: the real host's path is
    // `/p/{profile}/api/sessions/{id}`, so the route is matched on its TAIL.
    // An anchored `^/api/sessions` would silently fall through to the
    // catch-all below and the rig would never see the write.
    if (method === "PATCH" && /\/api\/sessions\/[^/]+$/.test(url.pathname)) {
      void readBody(req).then((body) => {
        state.patches.push({
          at: Date.now(),
          method,
          path: url.pathname,
          body,
        });
        const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) {
          json({ detail: "not_found" }, 404);
          return;
        }
        // The real host's pre-fence refusal.
        if (
          body?.request_id === undefined &&
          body?.expected_revision === undefined
        ) {
          json({ detail: "mutation_identity_required" }, 409);
          return;
        }
        if (
          body?.request_id === undefined ||
          body?.expected_revision === undefined
        ) {
          json({ detail: "mutation_identity_required" }, 409);
          return;
        }
        // The real host's conflict refusal.
        if (body.expected_revision !== row.runtime_revision) {
          json({ detail: "revision_conflict" }, 409);
          return;
        }
        if (typeof body.archived === "boolean") row.archived = body.archived;
        if (typeof body.pinned === "boolean") row.pinned = body.pinned;
        if (typeof body.title === "string") row.title = body.title;
        row.runtime_revision += 1;
        // The receipt the real host answers.
        json({
          ok: true,
          session_id: row.id,
          revision: row.runtime_revision,
          execution_generation: 0,
          operation: "sidebar",
          archived: row.archived,
          pinned: row.pinned,
          title: row.title,
        });
      });
      return;
    }

    if (url.pathname.endsWith("/api/sessions")) {
      if (method === "POST") {
        // The blank chat the app opens when the last working chat is archived.
        // The real host answers the created row; the app reads its id off the
        // reply, so the reply must carry one.
        void readBody(req).then((body) => {
          const row = {
            id: `chat-created-${rows.length + 1}`,
            title: typeof body?.title === "string" ? body.title : "New chat",
            preview: "",
            started_at: Math.floor(Date.now() / 1000),
            last_active: Math.floor(Date.now() / 1000),
            pinned: false,
            archived: false,
            hidden: false,
            message_count: 0,
            runtime_revision: 0,
          };
          rows.unshift(row);
          json({ session: row });
        });
        return;
      }
      state.sessionsRequests.push({
        at: Date.now(),
        method,
        path: url.url ?? req.url ?? "",
      });
      const payload = { object: "list", data: rows };
      state.sessionsResponses = state.sessionsResponses ?? [];
      state.sessionsResponses.push(payload);
      json(payload);
      return;
    }
    json({});
  });
  return listen(server).then((port) => ({
    port,
    state,
    rows,
    close: () =>
      new Promise((resolve) => {
        // `closeAllConnections` releases the keep-alive sockets the app's
        // undici pool holds, so the app's next call really finds a closed port
        // rather than a pooled socket that is about to be reused.
        server.closeAllConnections?.();
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
  const dir = process.env.LQ_FENCE_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_FENCE_WORLD is required — run this through tests/archive-fence-e2e.test.ts",
    );
  }
  const file = path.join(dir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no world.json in ${dir} — the test builds the world before spawning this driver`,
    );
  }
  const world = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["hermesHome", "userData", "binDir", "live", "second", "profile"]) {
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

/** The sidebar's own error banner, read from the shipped DOM. */
const ERROR_TEXT = `(() => {
  const nodes = Array.from(document.querySelectorAll(".chats-rail__error"));
  // The banner holds the message in a <p> and a Dismiss button beside it: read
  // the message itself, not the button's label.
  const texts = nodes
    .map((node) => (node.querySelector("p")?.textContent ?? "").trim())
    .filter((text) => text.length > 0);
  return texts.join(" | ");
})()`;

/** The live row's title as the sidebar painted it, for the ready proof. */
/**
 * Is the named chat on the sidebar right now?
 *
 * A named function rather than an inline expression: the expression is handed
 * to `executeJavaScript` as a string, and a hand-built IIFE is easy to
 * mis-parenthesise into something that throws instead of answering.
 */
function liveRowExpression(title) {
  return `(() => {
    const labels = Array.from(document.querySelectorAll(".chats-rail__label"));
    return labels.some((node) => (node.textContent ?? "").trim() === ${JSON.stringify(title)});
  })()`;
}

/** The sidebar's rows, read from the shipped DOM. */
const ROWS = `(() => Array.from(document.querySelectorAll(".chats-rail__row")).map((li) => ({
  label: (li.querySelector(".chats-rail__label")?.textContent ?? "").trim(),
  archived: li.getAttribute("data-archived") === "true",
})))()`;

/**
 * Click a row's archive control, by its accessible name.
 *
 * The archive control is a hover control in the resting row, so it is found by
 * its label and clicked through the DOM: a real pointer move would need the
 * driver's input pipeline, and the DOM click is the same handler.
 */
async function clickArchive(win, label) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll(".chats-rail__row"));
    const row = rows.find((li) =>
      (li.querySelector(".chats-rail__label")?.textContent ?? "").trim() === ${JSON.stringify(
        label,
      )}
    );
    if (!row) return { clicked: false, reason: "no such row" };
    const buttons = Array.from(row.querySelectorAll("button, [role='button']"));
    const archive = buttons.find((button) =>
      /archiv/i.test(
        (button.getAttribute("aria-label") ?? "") + " " + (button.textContent ?? "")
      )
    );
    if (!archive) {
      return {
        clicked: false,
        reason: "no archive control",
        buttons: buttons.map((b) => b.getAttribute("aria-label") || (b.textContent ?? "").trim()),
      };
    }
    archive.click();
    return { clicked: true };
  })()`);
  if (!result?.clicked) {
    throw new Error(
      `could not archive "${label}": ${result?.reason ?? "unknown"}; the row offered ${JSON.stringify(
        result?.buttons ?? [],
      )}`,
    );
  }
  return result;
}

/**
 * The world's own `recent.json` (written by the test) makes the app auto-open a
 * throwaway vault, which is what mounts the chats sidebar on the vault path.
 */
async function run() {
  const world = readWorld();
  const host = await serveGateway(world);
  const screenshotFile = path.join(artifactsDir, SCREENSHOT_NAME);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const states = { ready: null, archived: null, dead: null };

  try {
    writeHostEnv(world.hermesHome, host.port);
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
      });
    }
    delete process.env.ELECTRON_RUN_AS_NODE;

    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();

    // ── the app attached to the live gateway ────────────────────────────────
    // This wait is what makes the later failure "the gateway died" rather than
    // "the app never connected".
    await waitFor(win, `Boolean(document.querySelector(".chats-rail"))`, "the chats sidebar (.chats-rail) to mount", 90_000);
    try {
      await waitFor(
        win,
        liveRowExpression(world.live.title),
        `the gateway's live chat "${world.live.title}" to be painted`,
        60_000,
      );
    } catch (error) {
      // Name what the screen actually held, so a failure says which half broke
      // (the list never arrived, or it arrived and was filtered away).
      const seen = await win.webContents.executeJavaScript(
        `(() => ({
          labels: Array.from(document.querySelectorAll(".chats-rail__label")).map((n) => (n.textContent ?? "").trim()),
          rows: document.querySelectorAll(".chats-rail__row").length,
          empty: (document.querySelector(".chats-rail__empty")?.textContent ?? "").trim(),
          error: (document.querySelector(".chats-rail__error")?.textContent ?? "").trim(),
        }))()`,
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; the sidebar held ${JSON.stringify(seen)}; the gateway served ${JSON.stringify(host.state.sessionsResponses ?? [])}`,
      );
    }
    await sleep(300);
    states.ready = { rows: await win.webContents.executeJavaScript(ROWS) };

    // ── (1) the archive reaches the gateway as a FENCED write ───────────────
    await clickArchive(win, world.live.title);
    // The PATCH lands on the wire; wait for the gateway to have seen it.
    await waitFor(
      win,
      "true",
      "the archive gesture to be dispatched",
      5_000,
    );
    const patchDeadline = Date.now() + 20_000;
    while (host.state.patches.length === 0 && Date.now() < patchDeadline) {
      await sleep(100);
    }

    const patch = host.state.patches.at(-1) ?? null;
    check(
      "the archive reached the gateway as a PATCH",
      patch !== null && patch.method === "PATCH",
      `patches: ${JSON.stringify(host.state.patches)}`,
    );
    check(
      "the PATCH names the chat the operator archived",
      patch !== null && patch.path.endsWith(`/${encodeURIComponent(world.live.id)}`),
      `patch path: ${patch?.path ?? "(none)"}`,
    );
    check(
      "the PATCH carries the archived flag",
      patch !== null && patch.body?.archived === true,
      `patch body: ${JSON.stringify(patch?.body ?? null)}`,
    );
    check(
      "the PATCH carries a request_id (the mutation identity Hermes demands)",
      patch !== null &&
        typeof patch.body?.request_id === "string" &&
        patch.body.request_id.length > 0,
      `patch body: ${JSON.stringify(patch?.body ?? null)}`,
    );
    check(
      "the PATCH carries an expected_revision (the fence Hermes demands)",
      patch !== null &&
        typeof patch.body?.expected_revision === "number" &&
        Number.isInteger(patch.body.expected_revision),
      `patch body: ${JSON.stringify(patch?.body ?? null)}`,
    );
    check(
      "the expected_revision is the row's own revision, as the list read it",
      patch !== null && patch.body?.expected_revision === (world.rowRevision ?? 7),
      `expected_revision: ${String(patch?.body?.expected_revision ?? "(none)")} (the list row's runtime_revision was ${world.rowRevision ?? 7})`,
    );

    // ── (2) the archive landed: the row is gone from the working list ───────
    await sleep(500);
    states.archived = { rows: await win.webContents.executeJavaScript(ROWS) };
    check(
      "the archived chat left the working list",
      !states.archived.rows.some((row) => row.label === world.live.title),
      `rows: ${JSON.stringify(states.archived.rows)}`,
    );
    const archivedError = await win.webContents.executeJavaScript(ERROR_TEXT);
    check(
      "the archive reported no error",
      archivedError === "",
      `the sidebar's error banner said: ${JSON.stringify(archivedError)}`,
    );

    // ── (3) the gateway dies: the message must be actionable ───────────────
    // The second working chat is still on the list, so the gesture has
    // somewhere to land after the gateway is gone.
    const second = host.rows.find((row) => row.id === world.second.id);
    if (second) second.runtime_revision = world.rowRevision ?? 7;

    await host.close();
    await sleep(300);

    // The archive against a gateway that is gone.
    await clickArchive(win, world.second.title);
    await sleep(2500);
    const deadError = await win.webContents.executeJavaScript(ERROR_TEXT);
    states.dead = { error: deadError };

    check(
      "a dead gateway still produces a message",
      deadError.length > 0,
      `the sidebar's error banner was empty`,
    );
    check(
      "the message does not show the raw transport words",
      !/fetch failed/i.test(deadError),
      `the sidebar's error banner said: ${JSON.stringify(deadError)}`,
    );
    check(
      "the message names the agent and the control that retries it",
      /agent/i.test(deadError) && /recheck/i.test(deadError),
      `the sidebar's error banner said: ${JSON.stringify(deadError)}`,
    );

    // ── (4) the screenshot is of this window, with the error banner up ─────
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotFile, image.toPNG());
    const screenshotBytes = fs.existsSync(screenshotFile) ? fs.statSync(screenshotFile).size : 0;
    check(
      "the screenshot shows the sidebar with the error banner",
      screenshotBytes > MIN_SCREENSHOT_BYTES,
      `${screenshotFile} is ${screenshotBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    notes.push(
      `the archive's PATCH body was ${JSON.stringify(patch?.body ?? null)}; the row's runtime_revision was ${world.rowRevision ?? 7}`,
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
    what: "archiving a chat sends a fenced PATCH the Hermes gateway accepts, and a gateway that is gone is named in words the operator can act on",
    why: "the Hermes host gateway refuses a session mutation that carries no request_id and no expected_revision, and the app's archive path also bypassed the wrapper that names a silent gateway, so the operator saw 'fetch failed'",
    world: {
      profile: world.profile,
      profilePath: path.join(world.hermesHome, "profiles", world.profile),
      gatewayPort: host.port,
      devServerUrl: DEV_SERVER_URL,
    },
    states,
    gateway: {
      sessionsRequests: host.state.sessionsRequests,
      patches: host.state.patches,
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
    console.error(`[archive-fence] could not write the artifact: ${error}`);
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
