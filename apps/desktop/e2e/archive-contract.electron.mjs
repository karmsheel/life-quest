/**
 * The archive contract rig: does archiving a chat reach the host gateway as a
 * write it actually accepts, and does a dead gateway say something the operator
 * can act on?
 *
 * WHY THIS RIG EXISTS
 *
 * The operator pressed Archive in the left sidebar and got
 * "Unsupported session fields: request_id". Two defects sat behind that one
 * symptom:
 *
 *   1. `companionSessionPatch` sent a `request_id` and an `expected_revision`
 *      with every session PATCH. Those are the mutation identity of Hermes'
 *      DASHBOARD backend (`hermes_cli/web_server_sessions.py`, which fences its
 *      `session.mutate` RPC, 409 `mutation_identity_required`). This app does
 *      not attach to that backend: it speaks to the host gateway's
 *      `/p/<profile>/api/sessions` API, whose PATCH is a strict field
 *      allowlist (`title`, `end_reason`, `pinned`, `archived`, `hidden`,
 *      `unread`) and answers anything else with 400
 *      `unsupported_session_field` BEFORE a write is attempted. So the archive
 *      body was refused and the operator saw the gateway's own words.
 *
 *   2. The archive path had once bypassed the `gatewayCall` wrapper every other
 *      session call uses, so a gateway that was not answering produced undici's
 *      raw "fetch failed" in the sidebar. That half is still guarded here: a
 *      dead gateway must be named in words the operator can act on.
 *
 * So the rig drives the REAL main process and the REAL sidebar against a fake
 * gateway that behaves like the real one, and asserts:
 *
 *   - the archive PATCH carries ONLY fields the host gateway accepts (and no
 *     mutation identity);
 *   - the archive lands: the row leaves the working list and no error banner
 *     appears;
 *   - a gateway that is GONE produces a named, actionable message — and never
 *     the raw words "fetch failed".
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway accepts anything, so the field problem is never
 *      exercised. It does NOT: it enforces the real allowlist and answers an
 *      unknown field with the real 400 body and code. The rig records every
 *      PATCH it received, body and all, and the judge reads that log — so a
 *      rig that never archived anything fails on the log, not on a self-report.
 *   2. The rig passes because the app never archived. Every check reads the
 *      gateway's own request log, so "the PATCH arrived with accepted fields"
 *      is a fact about the wire, not about the app's state.
 *   3. The dead-gateway check passes because the app was never ready. The rig
 *      waits for the sidebar to mount and for the gateway's live chat to be
 *      painted FIRST — that proves the app attached to a live gateway — and
 *      only then stops it. So the later failure is the gateway dying, not the
 *      app never having connected.
 *   4. The error message check is satisfied by any string. The judge requires
 *      the message to NAME the agent and the control that retries it, and
 *      separately requires that it does NOT contain the raw undici words.
 *   5. The screenshots are stale, blank, or of another window. They are this
 *      window's own `capturePage()`: one after the archive landed (the shipped
 *      sidebar with the chat gone) and one after the dead gateway painted its
 *      error. The judge requires >10 KB for each.
 *   6. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH, the
 *      profile is one no real install has (`lq-archive-e2e`), the vault is a
 *      throwaway `createVault()` copy, and the MCP doors are moved to free
 *      ports by `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *
 * Run by `tests/archive-contract-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME`, throwaway vault, `recent.json`, fake `hermes` on PATH) and
 * passes it as `LQ_ARCHIVE_WORLD`:
 *
 *   LQ_ARCHIVE_WORLD=<dir> <electron> e2e/archive-contract.electron.mjs
 *
 * The driver starts the fake gateway on its own free port (the port has to be
 * known before `.env` is written), boots the REAL main process through
 * `bootForE2e`, drives the REAL sidebar, and writes
 * `e2e/artifacts/archive-contract.json`, `archive-contract.png` (the successful
 * archive) and `archive-contract-dead.png` (the actionable error).
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
const REPORT_NAME = "archive-contract.json";
const SCREENSHOT_NAME = "archive-contract.png";
const DEAD_SCREENSHOT_NAME = "archive-contract-dead.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/**
 * The fields the host gateway's `PATCH /api/sessions/{id}` accepts.
 *
 * Copied from `gateway/platforms/api_server.py::_handle_patch_session`, where
 * the body is checked against exactly this set before any write. Anything else
 * — including a mutation identity such as `request_id` or `expected_revision` —
 * is a 400 `unsupported_session_field`, not a fenced write.
 */
const SUPPORTED_SESSION_FIELDS = [
  "title",
  "end_reason",
  "pinned",
  "archived",
  "hidden",
  "unread",
];

const failures = [];
const checks = [];
const notes = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) console.error(`[archive-contract] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
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
 * The fake Hermes host gateway, as this app actually finds it.
 *
 * `/health` and `/v1/capabilities` are the attach probes; `/api/sessions` is
 * the list, with rows in the host's shape (no `runtime_revision`: the host's
 * list rows do not carry one).
 *
 * The PATCH is the point of this rig, and it behaves like the real host:
 *
 *   - the body is checked against the allowlist above and an unknown field is
 *     refused with the real 400 body and `unsupported_session_field` code;
 *   - a flag that is not a boolean is refused with the real
 *     `invalid_session_field` 400;
 *   - an accepted write commits and answers the real receipt shape
 *     (`{object: "hermes.session", session: row}`).
 *
 * Every PATCH is recorded — method, path, body — so the judge reads the wire
 * rather than the app's own account of itself.
 */
function serveGateway(world) {
  const state = { sessionsRequests: [], patches: [] };
  const rows = [
    {
      id: world.live.id,
      source: "api_server",
      title: world.live.title,
      preview: world.live.preview ?? "",
      started_at: Math.floor(Date.now() / 1000) - 900,
      last_active: Math.floor(Date.now() / 1000) - 300,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: 1,
    },
    {
      // A second working chat, so archiving one does not empty the sidebar
      // and leave the dead-gateway gesture with nothing to aim at.
      id: world.second.id,
      source: "api_server",
      title: world.second.title,
      preview: world.second.preview ?? "",
      started_at: Math.floor(Date.now() / 1000) - 800,
      last_active: Math.floor(Date.now() / 1000) - 200,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: 1,
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
        // The real host's allowlist, checked before any write.
        const unknown = Object.keys(body ?? {}).filter(
          (field) => !SUPPORTED_SESSION_FIELDS.includes(field),
        );
        if (unknown.length > 0) {
          json(
            {
              error: {
                message: `Unsupported session fields: ${unknown.join(", ")}`,
                type: "invalid_request_error",
                param: null,
                code: "unsupported_session_field",
              },
            },
            400,
          );
          return;
        }
        for (const flag of ["pinned", "archived", "hidden", "unread"]) {
          if (flag in body && typeof body[flag] !== "boolean") {
            json(
              {
                error: {
                  message: `'${flag}' must be a boolean`,
                  type: "invalid_request_error",
                  param: null,
                  code: "invalid_session_field",
                },
              },
              400,
            );
            return;
          }
        }
        if (typeof body.archived === "boolean") row.archived = body.archived;
        if (typeof body.pinned === "boolean") row.pinned = body.pinned;
        if (typeof body.hidden === "boolean") row.hidden = body.hidden;
        if (typeof body.title === "string") row.title = body.title;
        // The receipt the real host answers: the row, nested under `session`.
        json({ object: "hermes.session", session: row });
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
            source: "api_server",
            title: typeof body?.title === "string" ? body.title : "New chat",
            preview: "",
            started_at: Math.floor(Date.now() / 1000),
            last_active: Math.floor(Date.now() / 1000),
            pinned: false,
            archived: false,
            hidden: false,
            message_count: 0,
          };
          rows.unshift(row);
          json({ object: "hermes.session", session: row }, 201);
        });
        return;
      }
      state.sessionsRequests.push({
        at: Date.now(),
        method,
        path: url.url ?? req.url ?? "",
      });
      const payload = { object: "list", data: rows, limit: 200, offset: 0, has_more: false };
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
  const dir = process.env.LQ_ARCHIVE_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_ARCHIVE_WORLD is required — run this through tests/archive-contract-e2e.test.ts",
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
    // The row itself is a button whose text is the chat's title, so a loose
    // /archiv/i match on the combined label can hit the row (a world whose chat
    // name contains "archive" does) and open the chat instead of archiving it.
    // Match the control by its exact accessible name, and fall back to its
    // class only for a build that words the label differently.
    const archive = buttons.find((button) => {
      const label = (button.getAttribute("aria-label") ?? "").trim();
      return (
        /^archive chat$/i.test(label) ||
        button.classList.contains("chats-rail__archive-btn")
      );
    });
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
  const deadScreenshotFile = path.join(artifactsDir, DEAD_SCREENSHOT_NAME);
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

    // ── (1) the archive reaches the gateway with fields it accepts ──────────
    await clickArchive(win, world.live.title);
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
    const unsupportedFields =
      patch === null
        ? ["(no patch)"]
        : Object.keys(patch.body ?? {}).filter(
            (field) => !SUPPORTED_SESSION_FIELDS.includes(field),
          );
    check(
      "the PATCH carries only fields the host gateway accepts",
      patch !== null && unsupportedFields.length === 0,
      `unsupported fields ${JSON.stringify(unsupportedFields)} in body ${JSON.stringify(patch?.body ?? null)}`,
    );

    // ── (2) the archive landed: the row is gone from the working list ───────
    await sleep(600);
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

    // The shipped screen after a successful archive, for the operator.
    const successImage = await win.webContents.capturePage();
    fs.writeFileSync(screenshotFile, successImage.toPNG());
    const successBytes = fs.existsSync(screenshotFile)
      ? fs.statSync(screenshotFile).size
      : 0;
    check(
      "the screenshot shows the sidebar after the archive",
      successBytes > MIN_SCREENSHOT_BYTES,
      `${screenshotFile} is ${successBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    // ── (3) the gateway dies: the message must be actionable ───────────────
    // The second working chat is still on the list, so the gesture has
    // somewhere to land after the gateway is gone.
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
    const deadImage = await win.webContents.capturePage();
    fs.writeFileSync(deadScreenshotFile, deadImage.toPNG());
    const deadBytes = fs.existsSync(deadScreenshotFile)
      ? fs.statSync(deadScreenshotFile).size
      : 0;
    check(
      "the screenshot shows the sidebar with the error banner",
      deadBytes > MIN_SCREENSHOT_BYTES,
      `${deadScreenshotFile} is ${deadBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    notes.push(
      `the archive's PATCH body was ${JSON.stringify(patch?.body ?? null)}; the accepted fields are ${SUPPORTED_SESSION_FIELDS.join(", ")}`,
    );
  } catch (error) {
    failures.push(
      `the driver threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    console.error(error);
  }

  const screenshots = [SCREENSHOT_NAME, DEAD_SCREENSHOT_NAME].filter((name) =>
    fs.existsSync(path.join(artifactsDir, name)),
  );
  const report = {
    pass: failures.length === 0,
    failures: [...failures],
    checks: [...checks],
    ranAt: new Date().toISOString(),
    what: "archiving a chat sends the host gateway only the session fields it accepts, the chat leaves the working list, and a gateway that is gone is named in words the operator can act on",
    why: "the host gateway's PATCH /api/sessions/{id} is a strict allowlist and answers request_id/expected_revision with 400 unsupported_session_field; those fields fence Hermes' dashboard backend, not the API gateway this app attaches to",
    supportedSessionFields: SUPPORTED_SESSION_FIELDS,
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
    screenshots,
    notes,
  };

  try {
    fs.writeFileSync(
      path.join(artifactsDir, REPORT_NAME),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`[archive-contract] could not write the artifact: ${error}`);
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
