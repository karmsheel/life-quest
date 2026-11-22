/**
 * The decision:list memo rig: cold, warm, patched, and invalidated — all through
 * the REAL main process, the REAL preload bridge, and a REAL vault on disk.
 *
 * WHY THIS RIG EXISTS
 *
 * `decision:list` reads every Decision file in `.lifequest/decisions/`, parses
 * it and resolves display labels for database rows. On the operator's vault (819
 * decision files) one call costs ~1.1-2.1 s, and one approve press used to cause
 * five or six of them, serialised behind the main-process vault write queue. The
 * fix is a per-open-vault memo of the LABELED list in
 * `electron/decision-list-cache.ts`, wired into `decisionList()`:
 *
 *   - a cold read goes to disk once;
 *   - the immediate repeat is served from the memo;
 *   - a Decision write (create/amend/resolve) patches the cached record instead
 *     of throwing the memo away, so an approve burst does zero disk reads;
 *   - any OTHER mutating IPC channel, any MCP tool write, a vault open/switch
 *     and a window focus invalidate the memo, and the next read is a fresh disk
 *     read — so a file changed by a sync tool or the companion is never
 *     invisible.
 *
 * The card that matters is the resolve one: an operator approves a proposal and
 * the memo must never hand the card back as still pending. That is the
 * regression this rig exists to catch.
 *
 * HOW THIS RIG PROVES IT (and the ways it could look green while proving
 * nothing, written down first)
 *
 *   1. The read is stubbed. It is not: the window is booted by `bootForE2e()`
 *      from `../dist-electron/main.js`, the calls are made from the app's own
 *      renderer through the preload bridge (`window.lifequest.…`), and the vault
 *      is a throwaway `createVault()` world seeded by the test.
 *   2. The "warm" read is only the OS page cache. The invalidation leg is the
 *      control: after a non-decision mutating channel the SAME read is slow
 *      again (~cold), which is what a disk read through this engine costs. The
 *      memo is the only thing that can make it ~1 ms.
 *   3. The warm read is measured before the IPC transfer. Timings are taken
 *      inside the renderer around the awaited bridge call; serialisation of the
 *      projection happens after the clock is read.
 *   4. A stubbed cold read passes by being fast. The cold check requires the
 *      first read to be a real disk read (>= 300 ms, or at least 3x the warm
 *      read), and separately requires the projected record count and hashes to
 *      match. If the renderer had already called decision:list before this rig
 *      did, the cold leg fails loudly instead of silently proving the memo.
 *   5. The resolve leg passes because the list was re-read from disk anyway.
 *      The check is both freshness AND warm speed: the patched read must be
 *      under 150 ms, while the same engine takes hundreds of ms for a disk read.
 *   6. The focus leg is claimed on a window that never focused. The rig counts
 *      real `focus` events on the BrowserWindow first; if the headless window
 *      never focused, the leg is recorded as not-covered (and the external file
 *      is shown to be valid by a forced invalidation) instead of being faked.
 *   7. The rig touches the operator's profile, vault, or app. It does not:
 *      `LIFEQUEST_E2E` points userData at a temp dir, the vault is a throwaway
 *      `createVault()` world, `HERMES_HOME` is a temp dir with a stub `hermes`
 *      first on PATH, and the MCP doors are moved to free ports.
 *
 * The renderer lands on CompanionSetupScreen because this world has no
 * companion (no gateway is served). That is expected: the bridge is installed by
 * the preload on every page, so the rig drives the real IPC surface from that
 * screen. No fake Hermes/OpenAI gateway is needed, and nothing on that screen
 * calls decision:list — which is what makes the first call a true cold read.
 *
 * Run by `tests/decisions-list-cache-e2e.test.ts`, which builds the world and
 * passes it as `LQ_DECISIONS_CACHE_WORLD`:
 *
 *   LQ_DECISIONS_CACHE_WORLD=<dir> <electron> e2e/decisions-list-cache.electron.mjs
 *
 * Exit 0 = its checks held. The artifact is `e2e/artifacts/decisions-list-cache.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

// A hidden/occluded rig window must not have its timers throttled: the whole
// rig is a timing measurement.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT_NAME = "decisions-list-cache.json";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

/** The warm read must be far under a disk read; 150 ms is the task's bar. */
const WARM_MAX_MS = 150;
/** A disk read of 600+ decisions on this machine costs hundreds of ms. */
const FRESH_MIN_MS = 250;
/** ...but a faster engine retires that absolute bar; the ratio is the real proof. */
const FRESH_RATIO = 3;

const failures = [];
const checks = [];
const notes = [];
const observations = [];

function check(label, pass, detail = null) {
  const ok = Boolean(pass);
  checks.push({ label, pass: ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
  if (!ok) {
    console.error(
      `[decisions-list-cache] FAIL ${label}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return ok;
}

/** A recorded fact that is worth reporting but is not a required leg. */
function observe(label, value) {
  observations.push({ label, value });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The one file the test left for this process: where the world is. */
function readWorld() {
  const dir = process.env.LQ_DECISIONS_CACHE_WORLD;
  if (!dir) {
    throw new Error(
      "LQ_DECISIONS_CACHE_WORLD is required — run this through tests/decisions-list-cache-e2e.test.ts",
    );
  }
  const file = path.join(dir, "world.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no world.json in ${dir} — the test builds the world before spawning this driver`,
    );
  }
  const world = { dir, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  for (const key of [
    "hermesHome",
    "userData",
    "vaultDir",
    "vaultId",
    "binDir",
    "profile",
    "seed",
  ]) {
    if (!world[key]) throw new Error(`world.json is missing "${key}"`);
  }
  for (const key of [
    "total",
    "dbRowPendingId",
    "externalTemplateId",
    "database",
    "expectedStatuses",
  ]) {
    if (!world.seed[key]) throw new Error(`world.json seed is missing "${key}"`);
  }
  return world;
}

/** Wait for an in-page expression to become truthy, or name what never happened. */
function waitFor(win, expression, label, timeoutMs = 30_000, intervalMs = 100) {
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
        reject(
          new Error(`timed out after ${timeoutMs}ms waiting for ${label}`),
        );
        return;
      }
      setTimeout(poll, intervalMs);
    };
    void poll();
  });
}

/**
 * One bridge call, timed inside the renderer around the awaited promise.
 *
 * The result is spread beside `ms` so a caller reads `ok`/`value` exactly as the
 * bridge answered. A rejected invoke is caught so a failure is reported as a
 * check instead of a dead driver.
 */
function callExpression(channel, args = []) {
  const argSource = args.map((arg) => JSON.stringify(arg)).join(", ");
  return `(async () => {
    const started = performance.now();
    let result;
    try {
      result = await window.lifequest.${channel}(${argSource});
    } catch (error) {
      return { ms: performance.now() - started, threw: String(error) };
    }
    const ms = performance.now() - started;
    return Object.assign({ ms }, result && typeof result === "object" ? result : { value: result });
  })()`;
}

/**
 * One decision:list read, projected in the page (after the clock is read).
 *
 * The projection is what the judge needs and nothing else: the count, a hash of
 * the whole list (so "the same records" is a fact rather than a spot check), the
 * status histogram, the focused records by id, and the database-row cards with
 * their resolved display labels.
 */
function listExpression(focusIds = []) {
  const wanted = JSON.stringify(focusIds);
  return `(async () => {
    const started = performance.now();
    let result;
    try {
      result = await window.lifequest.decisionList();
    } catch (error) {
      return { ms: performance.now() - started, threw: String(error) };
    }
    const ms = performance.now() - started;
    if (!result || !result.ok) {
      return { ms, ok: false, error: result && result.error ? result.error : "no result" };
    }
    const rows = Array.isArray(result.value) ? result.value : [];
    const text = JSON.stringify(rows);
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash * 33) ^ text.charCodeAt(i)) | 0;
    }
    const statuses = { pending: 0, approved: 0, rejected: 0, other: 0 };
    for (const row of rows) {
      const status = row && row.status;
      if (status === "pending" || status === "approved" || status === "rejected") {
        statuses[status] += 1;
      } else {
        statuses.other += 1;
      }
    }
    const wantedIds = ${wanted};
    const byId = {};
    for (const id of wantedIds) {
      const row = rows.find((candidate) => candidate && candidate.id === id);
      byId[id] = row
        ? {
            present: true,
            status: row.status,
            resolvedAt: row.resolvedAt,
            title: row.title,
            targetType: row.target && row.target.type,
          }
        : { present: false };
    }
    const databaseRows = rows
      .filter((row) => row && row.target && row.target.type === "database-row")
      .map((row) => {
        let body = null;
        try {
          body = JSON.parse(row.proposedBodyMarkdown);
        } catch (error) {
          body = null;
        }
        const cellLabels = (body && body.cellLabels) || null;
        const columnNames = (body && body.columnNames) || null;
        return {
          id: row.id,
          status: row.status,
          cellLabels,
          columnNames,
          cellCount: body && body.cells ? Object.keys(body.cells).length : 0,
          labelsResolved:
            Boolean(cellLabels && Object.keys(cellLabels).length > 0) &&
            Boolean(columnNames && Object.keys(columnNames).length > 0),
        };
      });
    return { ms, ok: true, count: rows.length, bytes: text.length, hash, statuses, byId, databaseRows };
  })()`;
}

/** Is a measured read a real disk read (vs a memo hit)? */
function looksFresh(ms) {
  return typeof ms === "number" && ms >= FRESH_MIN_MS;
}

/** A short, readable window into what the renderer is showing. */
const SCREEN = `(() => ({
  hash: (window.location && window.location.hash) || "",
  route: (window.location && window.location.pathname) || "",
  hasBridge: Boolean(window.lifequest && typeof window.lifequest.decisionList === "function"),
  setupHeading: (document.querySelector("main.welcome .welcome-card")?.textContent ?? "").trim().slice(0, 160),
}))()`;

async function run() {
  const world = readWorld();
  const seed = world.seed;
  fs.mkdirSync(artifactsDir, { recursive: true });

  /** Every timing the artifact reports, in the order it was measured. */
  const timings = [];
  const recordTiming = (leg, ms) => {
    timings.push({ leg, ms });
    return ms;
  };

  // The world's env must be installed BEFORE main.ts is imported: its e2e seam
  // reads LIFEQUEST_E2E at module load.
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

  let report = {
    pass: false,
    failures: [],
    checks: [],
    observations: [],
    ranAt: new Date().toISOString(),
  };

  try {
    await app.whenReady();
    const { bootForE2e } = await import("../dist-electron/main.js");
    const win = await bootForE2e();

    // Count real window focus events: the optional focus leg is only called
    // "covered" when the OS/browser actually delivered one.
    let focusEvents = 0;
    win.on("focus", () => {
      focusEvents += 1;
    });
    // The renderer's own console, kept for the artifact: if the app never opens
    // the vault, the reason it did not is usually one line in here.
    const consoleLines = [];
    const rendererEvents = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (consoleLines.length < 120) consoleLines.push({ level, message: String(message) });
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      rendererEvents.push({ event: "render-process-gone", details });
    });
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      rendererEvents.push({ event: "did-fail-load", errorCode, errorDescription, validatedURL });
    });

    /**
     * What the renderer thinks the world is, in one round-trip: the window's
     * address, what is painted, whether the app's own boot found the recent
     * vault, and what the bridge answers. Used when the vault never opens.
     */
    const bootDiagnostics = `(async () => {
      const out = {
        href: String(window.location && window.location.href),
        title: document.title,
        bodyText: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 900),
        bridgeKeys: window.lifequest ? Object.keys(window.lifequest).length : 0,
      };
      try {
        out.recent = await window.lifequest.vaultListRecent();
      } catch (error) {
        out.recentError = String(error);
      }
      try {
        const snapshot = await window.lifequest.vaultGetSnapshot();
        out.snapshot = snapshot && snapshot.ok
          ? { ok: true, rootPath: snapshot.value ? snapshot.value.rootPath : null }
          : { ok: false, error: snapshot ? snapshot.error : "no result" };
      } catch (error) {
        out.snapshotError = String(error);
      }
      return out;
    })()`;

    // ── the real preload bridge, on the app's own window ────────────────────
    await waitFor(
      win,
      `Boolean(window.lifequest && typeof window.lifequest.decisionList === "function")`,
      "the real preload bridge (window.lifequest.decisionList) to be installed",
      90_000,
    );
    const bootDiagnosticsBefore = await win.webContents.executeJavaScript(
      bootDiagnostics,
    );

    // The renderer opens the throwaway vault on boot (`vault:open`).
    // `vault:getSnapshot` is the signal a vault is open (`domain:getActive`
    // answers a plain string|null, and null both before and after an open).
    // The window is given 60 s to do it on its own; if it does not, the rig
    // opens the same vault through the SAME real bridge call the app makes and
    // records that it had to. That keeps the memo legs honest (the cold read is
    // still the first decision:list of this process) instead of dying on an
    // unrelated startup step.
    const vaultOpenExpression = `(async () => {
      try {
        const r = await window.lifequest.vaultGetSnapshot();
        return Boolean(r && r.ok && r.value && r.value.rootPath);
      } catch (error) {
        return false;
      }
    })()`;
    let vaultOpenedBy = "renderer";
    try {
      await waitFor(
        win,
        vaultOpenExpression,
        "the app to open the throwaway vault",
        60_000,
        400,
      );
    } catch (bootError) {
      const bootDiagnosticsAfter = await win.webContents.executeJavaScript(
        bootDiagnostics,
      );
      const opened = await win.webContents.executeJavaScript(
        `(async () => { try { return await window.lifequest.vaultOpen(${JSON.stringify(world.vaultDir)}); } catch (error) { return { threw: String(error) }; } })()`,
      );
      const openedSummary = opened && opened.ok === true
        ? { ok: true, rootPath: opened.value ? opened.value.rootPath : null }
        : opened;
      notes.push(
        `the renderer did not open the vault on its own within 60 s (${bootError instanceof Error ? bootError.message : String(bootError)}); the rig opened it through window.lifequest.vaultOpen. boot: ${JSON.stringify({ before: bootDiagnosticsBefore, after: bootDiagnosticsAfter, opened: openedSummary })}`,
      );
      check(
        "the throwaway vault could be opened through the real bridge",
        Boolean(opened && opened.ok === true),
        `vaultOpen(${world.vaultDir}) answered ${JSON.stringify(openedSummary)}; boot: ${JSON.stringify({ before: bootDiagnosticsBefore, after: bootDiagnosticsAfter })}`,
      );
      await waitFor(
        win,
        vaultOpenExpression,
        "the bridge to see the vault the rig opened",
        30_000,
        400,
      );
      vaultOpenedBy = "rig";
    }
    await sleep(1_000);

    const screen = await win.webContents.executeJavaScript(SCREEN);
    const snapshot = await win.webContents.executeJavaScript(
      `(async () => { const r = await window.lifequest.vaultGetSnapshot(); return r && r.ok && r.value ? { rootPath: r.value.rootPath, decisions: Array.isArray(r.value.decisions) ? r.value.decisions.length : -1 } : null; })()`,
    );
    check(
      "the app opened the throwaway vault, not the operator's",
      Boolean(snapshot && snapshot.rootPath === world.vaultDir),
      `snapshot: ${JSON.stringify(snapshot)} (expected rootPath ${world.vaultDir})`,
    );

    // A window focus announces a data change (main.ts's focus handler), which
    // invalidates the memo by design. Let any launch-time focus settle first, so
    // one cannot land between the cold and warm reads and turn the warm leg into
    // a second disk read. The rig waits until the event count has been quiet for
    // ~600 ms (up to 6 s), then blurs, so the focus leg later is a real one.
    let quietFocusEvents = -1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (focusEvents === quietFocusEvents) break;
      quietFocusEvents = focusEvents;
      await sleep(600);
    }
    const focusedAtStart = win.isFocused();
    win.blur();
    await sleep(400);
    const focusedAfterBlur = win.isFocused();

    // ── (1) the COLD read ───────────────────────────────────────────────────
    const cold = await win.webContents.executeJavaScript(
      listExpression([seed.dbRowPendingId]),
    );
    recordTiming("cold", cold.ms);
    check(
      "the cold read lists every seeded decision",
      cold.ok && cold.count === seed.total,
      `count ${cold.count} (expected ${seed.total}); statuses ${JSON.stringify(cold.statuses)}`,
    );
    check(
      "the cold read's status histogram is the seeded one",
      cold.ok &&
        cold.statuses?.pending === seed.expectedStatuses.pending &&
        cold.statuses?.approved === seed.expectedStatuses.approved &&
        cold.statuses?.rejected === seed.expectedStatuses.rejected,
      `statuses ${JSON.stringify(cold.statuses)} (expected ${JSON.stringify(seed.expectedStatuses)})`,
    );
    const coldDbRow = (cold.databaseRows ?? []).find(
      (row) => row.id === seed.dbRowPendingId,
    );
    check(
      "the database-row card's display labels were resolved on the cold read",
      Boolean(coldDbRow && coldDbRow.labelsResolved),
      `database-row card: ${JSON.stringify(coldDbRow ?? null)}`,
    );

    // ── (2) the WARM read ───────────────────────────────────────────────────
    const warm = await win.webContents.executeJavaScript(
      listExpression([seed.dbRowPendingId]),
    );
    recordTiming("warm", warm.ms);
    check(
      "the immediate repeat read returns the same records",
      warm.ok && warm.count === cold.count && warm.hash === cold.hash,
      `count ${warm.count}/${cold.count}; hash ${warm.hash}/${cold.hash}`,
    );
    check(
      "the cold read is a real disk read, not a memo hit",
      cold.ok && (cold.ms >= 300 || cold.ms >= FRESH_RATIO * Math.max(1, warm.ms)),
      `cold ${cold.ms?.toFixed?.(1)} ms (warm ${warm.ms?.toFixed?.(1)} ms); if the cold read is fast, a renderer path called decision:list before the rig did`,
    );
    check(
      "the repeat read is served from the memo and is dramatically faster",
      warm.ok && warm.ms < WARM_MAX_MS && cold.ms >= FRESH_RATIO * Math.max(1, warm.ms),
      `cold ${cold.ms?.toFixed?.(1)} ms -> warm ${warm.ms?.toFixed?.(1)} ms (bar: warm < ${WARM_MAX_MS} ms and cold >= ${FRESH_RATIO}x warm)`,
    );

    // ── (3) resolve through the bridge: never pending again, still warm ─────
    const resolveWrite = await win.webContents.executeJavaScript(
      callExpression("decisionResolve", [seed.dbRowPendingId, "approved"]),
    );
    const resolvedRecord = resolveWrite.value ?? null;
    check(
      "decision:resolve through the bridge approved the pending card",
      resolveWrite.ok === true &&
        resolvedRecord !== null &&
        resolvedRecord.status === "approved" &&
        typeof resolvedRecord.resolvedAt === "string",
      `write: ${JSON.stringify({ ok: resolveWrite.ok, status: resolvedRecord?.status, resolvedAt: resolvedRecord?.resolvedAt, error: resolveWrite.error })}`,
    );
    const afterResolve = await win.webContents.executeJavaScript(
      listExpression([seed.dbRowPendingId]),
    );
    recordTiming("afterResolve", afterResolve.ms);
    const resolvedListed = afterResolve.byId?.[seed.dbRowPendingId] ?? null;
    check(
      "the resolved card is never handed back as still pending",
      resolvedListed?.present === true &&
        resolvedListed.status === "approved" &&
        typeof resolvedListed.resolvedAt === "string" &&
        resolvedListed.resolvedAt === resolvedRecord?.resolvedAt,
      `listed: ${JSON.stringify(resolvedListed)} (resolvedAt written ${JSON.stringify(resolvedRecord?.resolvedAt)})`,
    );
    check(
      "the read after a resolve is warm (the cached record was patched, not re-read)",
      afterResolve.ok === true && afterResolve.ms < WARM_MAX_MS,
      `read after resolve ${afterResolve.ms?.toFixed?.(1)} ms (bar: < ${WARM_MAX_MS} ms; a disk read is hundreds of ms)`,
    );
    check(
      "the resolve did not lose another card's status",
      afterResolve.ok &&
        afterResolve.count === cold.count &&
        afterResolve.statuses.approved === seed.expectedStatuses.approved + 1 &&
        afterResolve.statuses.pending === seed.expectedStatuses.pending - 1,
      `statuses ${JSON.stringify(afterResolve.statuses)}`,
    );
    const resolvedLabels = (afterResolve.databaseRows ?? []).find(
      (row) => row.id === seed.dbRowPendingId,
    );
    observe("labels on the resolved record (patch should keep the labeled form)", {
      labelsResolved: Boolean(resolvedLabels && resolvedLabels.labelsResolved),
      card: resolvedLabels ?? null,
    });

    // ── (4) create through the bridge appears in the next list, warm ────────
    const createInput = {
      target: { type: "pins", domainSlug: null },
      rationale: "Filed through the real preload bridge by the decision-list memo rig.",
      proposedTitle: "The memo rig's filed card",
      proposedBodyMarkdown: JSON.stringify({ pins: [] }),
    };
    const createWrite = await win.webContents.executeJavaScript(
      callExpression("decisionCreate", [createInput]),
    );
    const createdRecord = createWrite.value ?? null;
    const createdId = createdRecord?.id ?? null;
    check(
      "decision:create through the bridge filed a pending card",
      createWrite.ok === true &&
        createdRecord !== null &&
        createdRecord.status === "pending" &&
        typeof createdId === "string" &&
        createdId.length > 0,
      `write: ${JSON.stringify({ ok: createWrite.ok, status: createdRecord?.status, id: createdId, error: createWrite.error })}`,
    );
    const afterCreate = await win.webContents.executeJavaScript(
      listExpression([seed.dbRowPendingId, createdId]),
    );
    recordTiming("afterCreate", afterCreate.ms);
    const createdListed = createdId ? afterCreate.byId?.[createdId] ?? null : null;
    check(
      "the filed card appears in the very next list at warm speed",
      createdListed?.present === true &&
        createdListed.status === "pending" &&
        afterCreate.ms < WARM_MAX_MS,
      `listed: ${JSON.stringify(createdListed)}; read ${afterCreate.ms?.toFixed?.(1)} ms (bar: < ${WARM_MAX_MS} ms)`,
    );
    check(
      "the create left the resolved card resolved",
      afterCreate.byId?.[seed.dbRowPendingId]?.status === "approved",
      `resolved card: ${JSON.stringify(afterCreate.byId?.[seed.dbRowPendingId] ?? null)}`,
    );

    // ── (5) a NON-decision write invalidates the memo: fresh disk read ──────
    const dbWrite = await win.webContents.executeJavaScript(
      callExpression("dbUpsertRow", [
        seed.database.slug,
        seed.database.accountsId,
        { cells: { [seed.database.accountsNameColumnId]: "The rig's second account" } },
      ]),
    );
    check(
      "a non-decision mutating channel wrote through the bridge",
      dbWrite.ok === true,
      `db:upsertRow: ${JSON.stringify({ ok: dbWrite.ok, error: dbWrite.error })}`,
    );
    const afterInvalidation = await win.webContents.executeJavaScript(
      listExpression([seed.dbRowPendingId, createdId]),
    );
    recordTiming("afterInvalidation", afterInvalidation.ms);
    check(
      "the next list after a non-decision write is a fresh disk read, not the memo",
      afterInvalidation.ok === true &&
        (looksFresh(afterInvalidation.ms) ||
          afterInvalidation.ms >= FRESH_RATIO * Math.max(1, afterCreate.ms)),
      `read after db:upsertRow ${afterInvalidation.ms?.toFixed?.(1)} ms (warm before it: ${afterCreate.ms?.toFixed?.(1)} ms)`,
    );
    check(
      "the fresh read is still correct",
      afterInvalidation.ok === true &&
        afterInvalidation.count === cold.count + 1 &&
        afterInvalidation.statuses.approved === seed.expectedStatuses.approved + 1 &&
        afterInvalidation.statuses.rejected === seed.expectedStatuses.rejected &&
        afterInvalidation.statuses.pending === seed.expectedStatuses.pending &&
        afterInvalidation.byId?.[createdId]?.status === "pending" &&
        afterInvalidation.byId?.[seed.dbRowPendingId]?.status === "approved",
      `count ${afterInvalidation.count} (expected ${cold.count + 1}); statuses ${JSON.stringify(afterInvalidation.statuses)}; created ${JSON.stringify(afterInvalidation.byId?.[createdId] ?? null)}; resolved ${JSON.stringify(afterInvalidation.byId?.[seed.dbRowPendingId] ?? null)}`,
    );
    // This is the control for the whole rig: the very same read that just cost
    // ~1 ms now costs a disk read again. So "warm" cannot be the OS page cache.
    notes.push(
      `control: a plain re-read after invalidation cost ${afterInvalidation.ms?.toFixed?.(1)} ms, the memo hit before it ${afterCreate.ms?.toFixed?.(1)} ms`,
    );

    // ── (extra) two concurrent cold reads should share one in-flight read ───
    await win.webContents.executeJavaScript(
      callExpression("dbUpsertRow", [
        seed.database.slug,
        seed.database.accountsId,
        { cells: { [seed.database.accountsNameColumnId]: "The rig's third account" } },
      ]),
    );
    const concurrent = await win.webContents.executeJavaScript(`(async () => {
      const started = performance.now();
      let results;
      try {
        results = await Promise.all([
          window.lifequest.decisionList(),
          window.lifequest.decisionList(),
        ]);
      } catch (error) {
        return { threw: String(error) };
      }
      const ms = performance.now() - started;
      return {
        ms,
        ok: results.every((result) => Boolean(result && result.ok)),
        counts: results.map((result) => (result && result.ok && Array.isArray(result.value) ? result.value.length : -1)),
      };
    })()`);
    recordTiming("concurrentColdPair", concurrent.ms);
    observe("two concurrent cold reads share one in-flight read", {
      ms: concurrent.ms,
      ok: concurrent.ok,
      counts: concurrent.counts,
      singleFreshReadMs: afterInvalidation.ms,
      sharedInFlight:
        Boolean(concurrent.ok) &&
        typeof concurrent.ms === "number" &&
        concurrent.ms < 1.6 * Math.max(1, afterInvalidation.ms),
      detail: `pair ${concurrent.ms?.toFixed?.(1)} ms vs one fresh read ${afterInvalidation.ms?.toFixed?.(1)} ms (a serialised pair would be ~2x)`,
    });

    // ── (6) optional: an external edit + a real window focus ────────────────
    // The memo is re-populated by the concurrent pair (or its first read).
    const warmAgain = await win.webContents.executeJavaScript(
      listExpression([]),
    );
    recordTiming("warmAgain", warmAgain.ms);
    const template = JSON.parse(
      fs.readFileSync(
        path.join(
          world.vaultDir,
          ".lifequest",
          "decisions",
          `${seed.externalTemplateId}.json`,
        ),
        "utf8",
      ),
    );
    const externalId = `external-edit-${Date.now()}`;
    const externalRecord = {
      ...template,
      id: externalId,
      title: "A decision synced onto disk by another tool",
      status: "pending",
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(world.vaultDir, ".lifequest", "decisions", `${externalId}.json`),
      `${JSON.stringify(externalRecord, null, 2)}\n`,
      "utf8",
    );
    const beforeFocus = await win.webContents.executeJavaScript(
      listExpression([externalId]),
    );
    const staleBeforeFocus = beforeFocus.byId?.[externalId]?.present !== true;
    const focusBefore = focusEvents;
    const focusedBeforeAttempt = win.isFocused();
    win.blur();
    await sleep(300);
    const focusedAfterSecondBlur = win.isFocused();
    win.focus();
    await sleep(500);
    // `app.focus({ steal: true })` is macOS-shaped; on this Linux X display it
    // may be a no-op or unsupported. A failure here must not kill the rig: the
    // focus leg is judged by the events actually delivered (counted above).
    try {
      app.focus({ steal: true });
    } catch {
      // No app-level focus on this platform; the window-level attempt stands.
    }
    await sleep(700);
    const focusedAfterAttempt = win.isFocused();
    const focusFired = focusEvents > focusBefore;
    const afterFocus = await win.webContents.executeJavaScript(
      listExpression([externalId]),
    );
    recordTiming("afterFocus", afterFocus.ms);
    const externalVisibleAfterFocus =
      afterFocus.byId?.[externalId]?.present === true;

    if (focusFired) {
      check(
        "an external edit on disk becomes visible after a real window focus",
        externalVisibleAfterFocus,
        `external record ${externalId} visible=${externalVisibleAfterFocus}; focus events ${focusBefore} -> ${focusEvents}; read ${afterFocus.ms?.toFixed?.(1)} ms`,
      );
      check(
        "the read after a focus is a fresh disk read",
        looksFresh(afterFocus.ms) ||
          afterFocus.ms >= FRESH_RATIO * Math.max(1, warmAgain.ms),
        `read after focus ${afterFocus.ms?.toFixed?.(1)} ms (warm before it: ${warmAgain.ms?.toFixed?.(1)} ms)`,
      );
    } else {
      // Never fake this leg: prove the external file is valid through a forced
      // invalidation, and record the focus path as not-covered.
      const forced = await win.webContents.executeJavaScript(
        callExpression("dbUpsertRow", [
          seed.database.slug,
          seed.database.accountsId,
          { cells: { [seed.database.accountsNameColumnId]: "The rig's fourth account" } },
        ]),
      );
      const afterForced = await win.webContents.executeJavaScript(
        listExpression([externalId]),
      );
      recordTiming("externalAfterForcedInvalidation", afterForced.ms);
      check(
        "the external edit is a valid Decision (visible after a forced invalidation)",
        forced.ok === true && afterForced.byId?.[externalId]?.present === true,
        `external record visible after db:upsertRow: ${afterForced.byId?.[externalId]?.present === true}`,
      );
      observations.push({
        label: "external edit + window focus",
        value: {
          status: "not-covered",
          reason:
            "the headless window never delivered a focus event, so the focus-invalidation path could not be exercised",
          focusEventsBefore: focusBefore,
          focusEventsAfter: focusEvents,
          isFocused: {
            atStart: focusedAtStart,
            afterFirstBlur: focusedAfterBlur,
            beforeAttempt: focusedBeforeAttempt,
            afterSecondBlur: focusedAfterSecondBlur,
            afterFocusAttempt: focusedAfterAttempt,
          },
          memoStaleBeforeFocus: staleBeforeFocus,
          warmBeforeFocusMs: warmAgain.ms,
          externalFileVisibleAfterForcedInvalidation:
            afterForced.byId?.[externalId]?.present === true,
        },
      });
    }
    if (focusFired) {
      observe("external edit + window focus", {
        status: "covered",
        externalId,
        memoStaleBeforeFocus: staleBeforeFocus,
        visibleAfterFocus: externalVisibleAfterFocus,
        focusEvents: focusEvents,
        readAfterFocusMs: afterFocus.ms,
      });
    }

    // The world is thrown away by the test; leaving the external file is fine,
    // but the report says it was written.
    notes.push(
      `the external edit wrote .lifequest/decisions/${externalId}.json directly on disk; memo stale before focus: ${staleBeforeFocus}`,
    );

    report = {
      pass: failures.length === 0,
      failures: [...failures],
      checks: [...checks],
      ranAt: new Date().toISOString(),
      what: "decision:list is memoised per open vault: the cold read is correct, the repeat is served from the memo, a resolve/create through the bridge is patched into the cached list (never handed back stale, at warm speed), and any other mutating channel forces a fresh disk read",
      why: "one decision:list costs ~1.1-2.1 s on an 819-file vault and an approve press caused 5-6 of them; a cached list must still never show an approved card as pending, and a file changed by a sync tool or the companion must never stay invisible",
      world: {
        profile: world.profile,
        vaultDir: world.vaultDir,
        vaultId: world.vaultId,
        devServerUrl: DEV_SERVER_URL,
        seed: {
          total: seed.total,
          expectedStatuses: seed.expectedStatuses,
          databaseRowHistory: seed.historyRows ?? null,
          database: seed.database,
          resolveTargetId: seed.dbRowPendingId,
          externalTemplateId: seed.externalTemplateId,
        },
        screen,
        snapshotDecisions: snapshot?.decisions ?? null,
        vaultOpenedBy,
        bootDiagnostics: bootDiagnosticsBefore,
        rendererConsole: consoleLines,
        rendererEvents,
        window: {
          focusedAtStart,
          focusedAfterBlur,
          focusEvents,
        },
      },
      timings,
      bars: {
        warmMaxMs: WARM_MAX_MS,
        freshMinMs: FRESH_MIN_MS,
        freshRatio: FRESH_RATIO,
      },
      legs: {
        cold: {
          ms: cold.ms,
          ok: cold.ok ?? null,
          count: cold.count ?? null,
          bytes: cold.bytes ?? null,
          hash: cold.hash ?? null,
          statuses: cold.statuses ?? null,
          databaseRow: coldDbRow ?? null,
        },
        warm: {
          ms: warm.ms,
          ok: warm.ok ?? null,
          count: warm.count ?? null,
          hash: warm.hash ?? null,
          sameRecordsAsCold:
            warm.ok === true && warm.count === cold.count && warm.hash === cold.hash,
          speedup:
            typeof cold.ms === "number" && typeof warm.ms === "number" && warm.ms > 0
              ? Number((cold.ms / warm.ms).toFixed(2))
              : null,
        },
        resolve: {
          write: {
            ok: resolveWrite.ok ?? null,
            error: resolveWrite.error ?? null,
            status: resolvedRecord?.status ?? null,
            resolvedAt: resolvedRecord?.resolvedAt ?? null,
            id: resolvedRecord?.id ?? null,
          },
          listMs: afterResolve.ms,
          listed: resolvedListed,
          statusHistogram: afterResolve.statuses ?? null,
          labelsOnResolvedRecord: resolvedLabels ?? null,
        },
        create: {
          write: {
            ok: createWrite.ok ?? null,
            error: createWrite.error ?? null,
            id: createdId,
            status: createdRecord?.status ?? null,
          },
          listMs: afterCreate.ms,
          listed: createdListed,
          statusHistogram: afterCreate.statuses ?? null,
        },
        invalidation: {
          channel: "db:upsertRow",
          writeOk: dbWrite.ok ?? null,
          listMs: afterInvalidation.ms,
          warmBeforeMs: afterCreate.ms,
          looksFresh: looksFresh(afterInvalidation.ms),
          count: afterInvalidation.count ?? null,
          statusHistogram: afterInvalidation.statuses ?? null,
          created: afterInvalidation.byId?.[createdId] ?? null,
          resolved: afterInvalidation.byId?.[seed.dbRowPendingId] ?? null,
        },
        concurrentColdReads: {
          ms: concurrent.ms ?? null,
          ok: concurrent.ok ?? null,
          counts: concurrent.counts ?? null,
          singleFreshReadMs: afterInvalidation.ms,
        },
        focus: focusFired
          ? {
              status: "covered",
              externalId,
              memoStaleBeforeFocus: staleBeforeFocus,
              visibleAfterFocus: externalVisibleAfterFocus,
              readAfterFocusMs: afterFocus.ms,
              focusEvents,
              isFocused: {
                atStart: focusedAtStart,
                afterFirstBlur: focusedAfterBlur,
                beforeAttempt: focusedBeforeAttempt,
                afterSecondBlur: focusedAfterSecondBlur,
                afterFocusAttempt: focusedAfterAttempt,
              },
            }
          : {
              status: "not-covered",
              externalId,
              reason:
                "the headless window never delivered a focus event; the external file was proven valid through a forced invalidation instead",
              memoStaleBeforeFocus: staleBeforeFocus,
              focusEventsBefore: focusBefore,
              focusEventsAfter: focusEvents,
              readAfterFocusMs: afterFocus.ms,
              isFocused: {
                atStart: focusedAtStart,
                afterFirstBlur: focusedAfterBlur,
                beforeAttempt: focusedBeforeAttempt,
                afterSecondBlur: focusedAfterSecondBlur,
                afterFocusAttempt: focusedAfterAttempt,
              },
            },
      },
      observations: [...observations],
      notes: [...notes],
    };
  } catch (error) {
    failures.push(
      `the driver threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    console.error(error);
    report = {
      ...report,
      pass: false,
      failures: [...failures],
      checks: [...checks],
      ranAt: new Date().toISOString(),
      timings,
      observations: [...observations],
      notes: [...notes],
    };
  }

  try {
    fs.writeFileSync(
      path.join(artifactsDir, REPORT_NAME),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(
      `[decisions-list-cache] could not write the artifact: ${error}`,
    );
  }
  console.log(JSON.stringify(report, null, 2));

  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
