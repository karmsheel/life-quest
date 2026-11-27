/**
 * The archived chats rig: does the real app list an archived chat when the View
 * options ask for it, tag it, refuse to open it, and drop the live rows when the
 * view is "Only archived"?
 *
 * WHY THIS RIG EXISTS
 *
 * The sidebar has promised a "Show archived" band since it was written, and the
 * app has always been able to archive a chat: `PATCH /api/sessions/{id}` writes
 * the durable flag and Hermes drops the row out of the working list. What the
 * app could not do was read one back. The Hermes host gateway lists sessions
 * through `list_sessions_rich(include_archived=False)` and has no query
 * parameter that changes it, so `GET /api/sessions` never carried an archived
 * row: the old boolean filter could only ever filter an empty set. The fix
 * merges the gateway's live list with archived, non-hidden rows read read-only
 * from the attached profile's own `state.db`, and the sidebar's view becomes
 * Hide archived / Show archived / Only archived.
 *
 * THE WAYS THIS COULD LOOK GREEN WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The archived row never comes from the profile store at all. The fake
 *      gateway deliberately serves LIVE rows only — exactly the real host's
 *      omission — so the archived row can only appear if the app read
 *      `<HERMES_HOME>/profiles/lq-archive-e2e/state.db` itself. The gateway's
 *      sessions-request log is in the artifact, and the test fails if it never
 *      asked the gateway at all.
 *   2. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH, the
 *      profile is one no real install has (`lq-archive-e2e`), the vault is a
 *      throwaway `createVault()` copy, and the MCP doors are moved to free
 *      ports by `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *   3. The archived row is drawn but is not really archived: a row could carry
 *      the title without the flag, or the tag, or the disabled-open gesture.
 *      Every one of those is a separate check, read from the live DOM.
 *   4. "Only archived" leaves live rows on screen. The live row is
 *      gateway-owned, so it is a different insertion path than the archived
 *      one: the check reads the DOM after the switch, not the provider's state.
 *   5. The row appears before the filter is asked for (a stale list, a default
 *      view of "show"), so its later presence proves nothing. The initial sample
 *      must have no archived row at all.
 *   6. The screenshot is stale, blank, or of another window. It is this
 *      window's own `capturePage()` after the archived band painted, and the
 *      test requires >10 KB on disk.
 *   7. The app is stuck on the setup screen or the splash, and every query
 *      silently reads an empty document. The driver waits for `.chats-rail` and
 *      for the gateway's live chat title to be painted before it judges
 *      anything, and fails with a named timeout when they never arrive.
 *   8. The menu's option is found by position rather than by label, so a
 *      re-ordered or renamed menu passes. The driver derives its labels from
 *      the DOM (`button[role="menuitemradio"]` aria-label), clicks by label, and
 *      reports what the menu offered on failure.
 *
 * Run by `tests/archived-chats-e2e.test.ts`, which builds the world (temp
 * `HERMES_HOME`, profile `state.db`, throwaway vault, `recent.json`, fake
 * `hermes` on PATH) and passes it as `LQ_ARCHIVE_WORLD`:
 *
 *   LQ_ARCHIVE_WORLD=<dir> <electron> e2e/archived-chats.electron.mjs
 *
 * The driver starts the fake gateway on its own free port (the port has to be
 * known before `.env` is written), boots the REAL main process through
 * `bootForE2e`, drives the REAL sidebar, and writes
 * `e2e/artifacts/archived-chats.json` plus `e2e/artifacts/archived-chats.png`.
 * Exit 0 = its checks held.
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
const REPORT_NAME = "archived-chats.json";
const SCREENSHOT_NAME = "archived-chats.png";
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

const failures = [];
const checks = [];
const notes = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) console.error(`[archived-chats] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
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
 * `/health` and `/v1/capabilities` are the attach probes; `/api/sessions` is the
 * list this rig is about and it deliberately answers LIVE ROWS ONLY, because
 * that is the real host's behavior (`list_sessions_rich(include_archived=False)`).
 * The archived row in this world exists only in the profile's `state.db`, so the
 * app has to read the store itself for the sidebar to draw it. Every sessions
 * request is recorded for the artifact.
 *
 * Anything else answers `{}` 200: older/newer attach paths must not be able to
 * make the run fail for an endpoint this rig is not about.
 */
function serveGateway(world) {
  const state = { sessionsRequests: [] };
  const liveRows = () => [
    {
      id: world.live.id,
      title: world.live.title,
      preview: world.live.preview ?? "",
      started_at: Math.floor(Date.now() / 1000) - 900,
      last_activity: Math.floor(Date.now() / 1000) - 300,
      pinned: false,
      archived: false,
      hidden: false,
      message_count: 1,
    },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (payload) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(payload));
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
    if (url.pathname.endsWith("/api/sessions")) {
      state.sessionsRequests.push({
        at: Date.now(),
        method: req.method ?? "",
        path: req.url ?? "",
      });
      json({ object: "list", data: liveRows() });
      return;
    }
    json({});
  });
  return listen(server).then((port) => ({
    port,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
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
      "LQ_ARCHIVE_WORLD is required — run this through tests/archived-chats-e2e.test.ts",
    );
  }
  const file = path.join(dir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no world.json in ${dir} — the test builds the world before spawning this driver`,
    );
  }
  const world = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["hermesHome", "userData", "binDir", "live", "archived", "profile"]) {
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

/** What the live sidebar is showing, read from the shipped DOM. */
const SAMPLE = `(() => {
  const labelOf = (li) => (li.querySelector(".chats-rail__label")?.textContent ?? "").trim();
  const rowOf = (li) => {
    const main = li.querySelector(".chats-rail__row-main");
    return {
      label: labelOf(li),
      archived: li.getAttribute("data-archived") === "true",
      tag: (li.querySelector(".chats-rail__archived-tag")?.textContent ?? "").trim() || null,
      openable: Boolean(main) && !main.disabled,
    };
  };
  return {
    hasRail: Boolean(document.querySelector(".chats-rail")),
    rows: Array.from(document.querySelectorAll(".chats-rail__row")).map(rowOf),
    groups: Array.from(document.querySelectorAll(".chats-rail__group")).map((li) => (li.textContent ?? "").trim()),
    empty: (document.querySelector(".chats-rail__empty")?.textContent ?? "").trim() || null,
    viewMenuOpen: Boolean(document.querySelector(".chats-rail__view-menu")),
  };
})()`;

async function sample(win) {
  return win.webContents.executeJavaScript(SAMPLE);
}

/** The two rows this rig judges, named against the world the test wrote. */
function rowsOf(sampleState, world) {
  const rows = Array.isArray(sampleState.rows) ? sampleState.rows : [];
  return {
    ...sampleState,
    liveRow: rows.find((row) => !row.archived && row.label === world.live.title) ?? null,
    archivedRow:
      rows.find((row) => row.archived && row.label === world.archived.title) ?? null,
    liveRows: rows.filter((row) => !row.archived),
    archivedRows: rows.filter((row) => row.archived),
  };
}

function liveRowExpression(world) {
  return `(() => {
    const rows = Array.from(document.querySelectorAll(".chats-rail__row"));
    return rows.some((li) => !li.hasAttribute("data-archived") &&
      (li.querySelector(".chats-rail__label")?.textContent ?? "").trim() === ${JSON.stringify(world.live.title)});
  })()`;
}

function archivedRowExpression(world) {
  return `(() => {
    const rows = Array.from(document.querySelectorAll(".chats-rail__row[data-archived]"));
    return rows.some((li) =>
      (li.querySelector(".chats-rail__label")?.textContent ?? "").trim() === ${JSON.stringify(world.archived.title)} &&
      (li.querySelector(".chats-rail__archived-tag")?.textContent ?? "").trim() === "Archived");
  })()`;
}

/** Open the header's View options menu and return the radio items it painted. */
async function openViewMenu(win) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button[aria-label="View options"]');
    if (!button) return { opened: false, labels: [] };
    button.click();
    return { opened: true, labels: [] };
  })()`);
  if (!result?.opened) throw new Error('the chats header has no button[aria-label="View options"]');
  await waitFor(win, `Boolean(document.querySelector(".chats-rail__view-menu"))`, "the View options menu to paint");
  const items = await win.webContents.executeJavaScript(
    `(() => Array.from(document.querySelectorAll('.chats-rail__view-menu button[role="menuitemradio"]'))
      .map((button) => ({
        label: button.getAttribute("aria-label") || (button.textContent ?? "").trim(),
        checked: button.getAttribute("aria-checked"),
      })))()`,
  );
  return Array.isArray(items) ? items : [];
}

/**
 * Click one view option BY LABEL, never by index: the menu is the product's and
 * a re-ordered or renamed menu must fail loudly rather than pick the wrong item.
 * Returns the labels the menu offered.
 */
async function clickViewOption(win, pattern) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const buttons = Array.from(document.querySelectorAll('.chats-rail__view-menu button[role="menuitemradio"]'));
    const labelOf = (button) => button.getAttribute("aria-label") || (button.textContent ?? "").trim();
    const wanted = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)});
    const target = buttons.find((button) => wanted.test(labelOf(button)));
    const labels = buttons.map(labelOf);
    if (!target) return { clicked: false, labels };
    target.click();
    return { clicked: true, labels };
  })()`);
  if (!result?.clicked) {
    throw new Error(
      `the View options menu has no item matching ${String(pattern)}; it offered ${JSON.stringify(result?.labels ?? [])}`,
    );
  }
  return result.labels ?? [];
}

/**
 * The world's own `recent.json` (written by the test) makes the app auto-open a
 * throwaway vault, which is what mounts the chats sidebar on the vault path.
 */
async function run() {
  const world = readWorld();
  const host = await serveGateway(world);
  const states = { initial: null, show: null, only: null };
  const screenshotFile = path.join(artifactsDir, SCREENSHOT_NAME);
  fs.mkdirSync(artifactsDir, { recursive: true });

  try {
    writeHostEnv(world.hermesHome, host.port);
    // The app boots from the same seam every other full-app rig uses; the
    // profile, the renderer URL and the MCP door ports were set in the spawn
    // environment by the test. These assignments keep the same contract when
    // the driver is run by hand, and are what `__LIFEQUEST_E2E_SEAM__` reads
    // when main.js is imported below.
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

    // ── the sidebar is up, and the gateway's live row is painted ────────────
    // The app gates AppShell on the companion being ready; this is the wait
    // that also proves the fake gateway answered the attach probes.
    await waitFor(win, `Boolean(document.querySelector(".chats-rail"))`, "the chats sidebar (.chats-rail) to mount", 90_000);
    await waitFor(win, liveRowExpression(world), `the gateway's live chat "${world.live.title}" to be painted`, 60_000);
    await sleep(300);

    // ── (a) the working view does not carry the archived row ────────────────
    states.initial = rowsOf(await sample(win), world);
    check(
      "the archived chat is absent before the view asks for it",
      states.initial.archivedRow === null && states.initial.archivedRows.length === 0,
      `rows: ${JSON.stringify(states.initial.rows)}`,
    );
    check(
      "the gateway's live chat is on the working list",
      states.initial.liveRow !== null,
      `rows: ${JSON.stringify(states.initial.rows)}`,
    );

    // ── (b) Show archived: the row appears, tagged and never openable ───────
    const items = await openViewMenu(win);
    check(
      "the View options menu offers hide, show, and only-archived",
      items.length === 3 &&
        items.some((item) => /hide archived/i.test(item.label)) &&
        items.some((item) => /show archived/i.test(item.label)) &&
        items.some((item) => /only archived/i.test(item.label)),
      `menu items: ${JSON.stringify(items)}`,
    );
    const showLabels = await clickViewOption(win, /show archived/i);
    check(
      "Show archived is the item the DOM named",
      showLabels.some((label) => /show archived/i.test(label)),
      `menu items: ${JSON.stringify(showLabels)}`,
    );
    await waitFor(win, archivedRowExpression(world), `the archived chat "${world.archived.title}" to be listed`, 30_000);
    await sleep(300);

    states.show = rowsOf(await sample(win), world);
    check(
      "Show archived lists the archived chat",
      states.show.archivedRow !== null,
      `rows: ${JSON.stringify(states.show.rows)}`,
    );
    check(
      "the archived row carries data-archived",
      states.show.archivedRow?.archived === true,
      `row: ${JSON.stringify(states.show.archivedRow)}`,
    );
    check(
      "the archived row carries the Archived tag",
      states.show.archivedRow?.tag === "Archived",
      `row: ${JSON.stringify(states.show.archivedRow)}`,
    );
    check(
      "the archived row is not openable",
      states.show.archivedRow?.openable === false,
      `row: ${JSON.stringify(states.show.archivedRow)}`,
    );
    check(
      "the live row is still listed beside the archive",
      states.show.liveRow !== null,
      `rows: ${JSON.stringify(states.show.rows)}`,
    );

    // ── (d) the screenshot is of this window, while both bands are visible ──
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotFile, image.toPNG());
    const screenshotBytes = fs.existsSync(screenshotFile) ? fs.statSync(screenshotFile).size : 0;
    check(
      "the screenshot shows the sidebar with live and archived rows together",
      screenshotBytes > MIN_SCREENSHOT_BYTES,
      `${screenshotFile} is ${screenshotBytes} bytes (expected > ${MIN_SCREENSHOT_BYTES})`,
    );

    // ── (c) Only archived: the live rows are gone, the archive remains ──────
    await openViewMenu(win);
    const onlyLabels = await clickViewOption(win, /only archived/i);
    check(
      "Only archived is the item the DOM named",
      onlyLabels.some((label) => /only archived/i.test(label)),
      `menu items: ${JSON.stringify(onlyLabels)}`,
    );
    await waitFor(
      win,
      `(() => {
        const rows = Array.from(document.querySelectorAll(".chats-rail__row"));
        const live = rows.some((li) => !li.hasAttribute("data-archived"));
        const archived = ${archivedRowExpression(world)};
        return !live && archived;
      })()`,
      "Only archived to drop the live rows and keep the archive",
      30_000,
    );
    await sleep(300);

    states.only = rowsOf(await sample(win), world);
    check(
      "Only archived hides the gateway's live row",
      states.only.liveRow === null && states.only.liveRows.length === 0,
      `rows: ${JSON.stringify(states.only.rows)}`,
    );
    check(
      "Only archived still lists the archived chat",
      states.only.archivedRow !== null,
      `rows: ${JSON.stringify(states.only.rows)}`,
    );

    // ── the gateway was really the live list's source ───────────────────────
    check(
      "the fake gateway was asked for the session list",
      host.state.sessionsRequests.length > 0 &&
        host.state.sessionsRequests.some((request) => String(request.path).includes("/api/sessions")),
      `sessions requests: ${JSON.stringify(host.state.sessionsRequests)}`,
    );
    check(
      "the list was re-read when the view changed",
      host.state.sessionsRequests.length >= 2,
      `${host.state.sessionsRequests.length} sessions requests across the initial list and two view changes`,
    );

    notes.push(
      `the archived rows came from ${path.join(world.hermesHome, "profiles", world.profile, "state.db")}; the gateway was never asked for them`,
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
    what: "the real app's chats sidebar lists an archived chat only when the View options ask for it, tags it, refuses to open it, and Only archived drops the live gateway rows",
    why: "Hermes' host gateway lists sessions with include_archived=False and has no parameter that changes it, so the archived half of the view is read from the attached profile's own state.db; the sidebar's boolean filter used to hide only the archived rows the gateway never sent",
    world: {
      profile: world.profile,
      profilePath: path.join(world.hermesHome, "profiles", world.profile),
      gatewayPort: host.port,
      devServerUrl: DEV_SERVER_URL,
    },
    states,
    screenshots: fs.existsSync(screenshotFile) ? [SCREENSHOT_NAME] : [],
    gateway: {
      sessionsRequests: host.state.sessionsRequests,
      count: host.state.sessionsRequests.length,
    },
    notes,
  };

  try {
    fs.writeFileSync(
      path.join(artifactsDir, REPORT_NAME),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`[archived-chats] could not write the artifact: ${error}`);
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
