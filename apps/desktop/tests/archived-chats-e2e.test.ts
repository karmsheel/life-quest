import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createVault } from "@lifequest/vault-core";

/**
 * Archived chats, end to end, through the REAL main process, preload bridge and
 * renderer — the list that could never carry an archived row, and the three
 * View options that now can show it.
 *
 * WHY THIS RIG EXISTS
 *
 * LifeQuest's chat sidebar has always offered a "Show archived" view option, and
 * archiving has always worked: the gateway's `PATCH /api/sessions/{id}` writes
 * the durable flag. But the app asked the Hermes host gateway for its sessions,
 * and the gateway lists them with `list_sessions_rich(include_archived=False)`
 * and has no query parameter that changes that — so an archived row could never
 * cross the IPC boundary and the old boolean filter could only hide rows that
 * were never sent. The fix merges the gateway's live list with archived,
 * non-hidden rows read read-only from the attached profile's own `state.db`;
 * the sidebar's view becomes Hide archived / Show archived / Only archived.
 *
 * This file builds a throwaway world, runs `e2e/archived-chats.electron.mjs` in
 * Electron against it, and then judges the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway quietly serves the archived row too. It deliberately
 *      does NOT: `/api/sessions` answers live rows only, exactly like the real
 *      host, so the archived row can only appear if the app read the profile's
 *      `state.db` itself. The gateway's request log is in the artifact and must
 *      show the list was asked for.
 *   2. The rig attaches to the operator's real Hermes, vault, or app. `HERMES_HOME`
 *      is a temp dir, a stub `hermes` is first on PATH, the profile is one no
 *      real install has (`lq-archive-e2e`), the vault is a throwaway
 *      `createVault()`, and the app's userData and MCP door ports are moved by
 *      `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *   3. The archived row was already on screen before the filter was asked for,
 *      so the later presence proves nothing. The judge requires it absent in
 *      the initial state.
 *   4. The row is present but not really archived — the artifact must say it
 *      carries `data-archived`, the "Archived" tag, and is not openable.
 *   5. "Only archived" is read from the provider's state rather than the
 *      screen, so live rows could still be drawn. The judge reads the DOM state
 *      and requires the live gateway row to be gone while the archive remains.
 *   6. The screenshot is stale, blank, or of another window. It is this
 *      window's own `capturePage()` after the archived band painted, and the
 *      judge requires >10 KB on disk.
 *   7. The app never opened the vault or never attached, and every query read an
 *      empty document. The driver waits for `.chats-rail` and for the gateway's
 *      live chat title to be painted before judging, and the live-row check here
 *      fails if that never happened.
 *   8. The driver exits 0 without writing its report, or writes a report that
 *      contradicts itself. The judge re-derives every claim from the artifact
 *      and the filesystem; it does not trust `pass` alone.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/archived-chats-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/archived-chats.json` and
 * `e2e/artifacts/archived-chats.png` (the shipped screen, captured by the rig).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/archived-chats.electron.mjs");
const REPORT = path.join(ARTIFACTS, "archived-chats.json");
const SCREENSHOT = path.join(ARTIFACTS, "archived-chats.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-archive-e2e";

/**
 * Keep these in step with the rows this file seeds and the world it writes for
 * the driver (`world.json`): the driver serves the live row from the gateway and
 * the archived row only ever exists in the profile's `state.db`.
 */
const ARCHIVED = { id: "archived-ledger-notes", title: "Archived ledger notes" };
const LIVE = {
  id: "live-gateway-chat",
  title: "Live gateway chat",
  preview: "A live chat the gateway owns",
};

type Row = {
  label: string;
  archived: boolean;
  tag: string | null;
  openable: boolean;
};

type Check = { label: string; pass: boolean; detail: string | null };

type RowState = {
  hasRail: boolean;
  rows: Row[];
  groups: string[];
  empty: string | null;
  viewMenuOpen: boolean;
  liveRow: Row | null;
  archivedRow: Row | null;
  liveRows: Row[];
  archivedRows: Row[];
};

type States = {
  initial: RowState | null;
  show: RowState | null;
  only: RowState | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  states: States;
  screenshots: string[];
  gateway: {
    sessionsRequests: { at: number; method: string; path: string }[];
    count: number;
  } | null;
};

type World = {
  dir: string;
  hermesHome: string;
  userData: string;
  vaultDir: string;
  vaultId: string;
  binDir: string;
  worldFile: string;
  mcpPorts: { local: number; invite: number };
};

type DriverOutcome = { code: number | null; stdout: string; stderr: string };

/** The Vite dev server, without which the app's window has nothing to load. */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/** A port nothing is listening on, asked by binding it rather than guessing. */
function freePort(): Promise<number> {
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

/**
 * The profile's own Hermes session store — the only place an archived row can
 * come from in this world.
 *
 * It is the schema the fix reads (`sessions` + `messages`), and it is seeded
 * exactly the way the host seeds one: an archived, non-hidden chat with the
 * first user message `readArchivedSessions` turns into the row preview, and a
 * live chat row (durable flags shared with the gateway-owned row of the same id)
 * so the store is not a one-row fixture.
 */
function seedProfileStore(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        started_at REAL,
        last_activity_at REAL,
        pinned INTEGER,
        archived INTEGER,
        hidden INTEGER,
        message_count INTEGER
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp REAL
      );
    `);
    const now = Math.floor(Date.now() / 1000);
    const insertSession = db.prepare(
      `INSERT INTO sessions
         (id, title, started_at, last_activity_at, pinned, archived, hidden, message_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, session_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // The proof row: archived, visible to the profile (not hidden), with a first
    // user message the row's preview is built from.
    insertSession.run(
      ARCHIVED.id,
      ARCHIVED.title,
      now - 7_200,
      now - 3_600,
      0,
      1,
      0,
      2,
    );
    insertMessage.run(
      "msg-archived-user",
      ARCHIVED.id,
      "user",
      "Pull the ledger notes together and file them under finance.",
      now - 7_100,
    );
    insertMessage.run(
      "msg-archived-assistant",
      ARCHIVED.id,
      "assistant",
      "Filed under Finance; the notes are attached to the period.",
      now - 7_000,
    );

    // The live row is gateway-owned; this store row is here so the seeded
    // database is a real two-chat store rather than a fixture with one row.
    insertSession.run(
      LIVE.id,
      LIVE.title,
      now - 900,
      now - 300,
      0,
      0,
      0,
      1,
    );
    insertMessage.run(
      "msg-live-user",
      LIVE.id,
      "user",
      LIVE.preview,
      now - 800,
    );
  } finally {
    db.close();
  }
}

/**
 * The throwaway world the app boots into: temp `HERMES_HOME` with the archived
 * profile store, a throwaway vault the app auto-opens, the userData that makes
 * it auto-open, and a fake `hermes` first on PATH so no real CLI is ever run.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-archived-chats-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const profileDir = path.join(hermesHome, "profiles", PROFILE);
  for (const made of [hermesHome, profileDir, userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  // A fake `hermes`, first on PATH: every CLI call the app may make exits 0 and
  // none of them reaches a real install.
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // The minimal host config the attach path expects. `model:` is deliberate:
  // the host's model probe runs after the ready status and must not warn about
  // this rig's business.
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n",
    "utf8",
  );

  // The archived half of the list lives ONLY here.
  seedProfileStore(path.join(profileDir, "state.db"));

  const created = await createVault(vaultDir, "Archived chats rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

  // The same shape `e2e/model-probe.electron.mjs` writes, with one real vault
  // entry so the app auto-opens it, and the profile the companion must attach
  // to. This file is the app's only memory of which vault to reopen.
  fs.writeFileSync(
    path.join(userData, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vault.id,
            name: vault.name,
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROFILE,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // The MCP doors move off the product ports; the driver's app would otherwise
  // fight the bench app for 8643/8646.
  const mcpPorts = { local: await freePort(), invite: await freePort() };

  // What the driver needs to know that cannot be inferred (which rows are the
  // proof, which profile, which port, where the fake CLI is).
  const worldFile = path.join(dir, "world.json");
  fs.writeFileSync(
    worldFile,
    `${JSON.stringify(
      {
        dir,
        hermesHome,
        userData,
        vaultDir,
        vaultId: vault.id,
        binDir,
        profile: PROFILE,
        archived: ARCHIVED,
        live: LIVE,
        mcpPorts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    dir,
    hermesHome,
    userData,
    vaultDir,
    vaultId: vault.id,
    binDir,
    worldFile,
    mcpPorts,
  };
}

/** Run the Electron driver against one world, with the app's spawn contract. */
function runDriver(world: World): Promise<DriverOutcome> {
  const electron = createRequire(import.meta.url)("electron") as string;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = world.hermesHome;
  // The fake CLI must resolve first: this is the only thing that keeps the app
  // from running the operator's real `hermes`.
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL =
    process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${DEV_PORT}`;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  env.LQ_ARCHIVE_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 240_000, env },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? (error.code as number) : 0;
        const spawnFailure =
          error && typeof error.code !== "number"
            ? `${error.message}\n${error.stack ?? ""}`
            : "";
        resolve({
          code: error && typeof error.code !== "number" ? null : code,
          stdout: String(stdout ?? ""),
          stderr: `${String(stderr ?? "")}${spawnFailure ? `\n${spawnFailure}` : ""}`,
        });
      },
    );
  });
}

/** The tail of a stream, for failure messages that have to stay readable. */
function tail(text: string, limit = 3_000): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function assertArtifactExists(outcome: DriverOutcome): Report {
  const where = path.relative(desktopRoot, REPORT);
  assert.equal(
    fs.existsSync(REPORT),
    true,
    `the driver wrote no ${where} (exit ${outcome.code}). stderr: ${tail(outcome.stderr)}`,
  );
  let report: Report;
  try {
    report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
  } catch (error) {
    assert.fail(
      `the driver's ${where} is not JSON: ${error instanceof Error ? error.message : String(error)}; stderr: ${tail(outcome.stderr)}`,
    );
  }
  return report;
}

describe("archived chats, in the real app (filter, tagging, and the only-archived view)", () => {
  it("lists an archived chat only when the view asks for it, and hides the live rows when asked to show only archived", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` (or lifequest-dev) to include this e2e`,
      );
      return;
    }
    // The driver imports the main bundle the bench's dev server built. Missing
    // it is a setup failure, not a reason to skip: a skipped rig is evidence of
    // nothing (AGENTS.md).
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — the bench's dev server must have built main before this rig runs (lifequest-e2e does that)",
    );

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SCREENSHOT, { force: true });

    const world = await buildWorld();
    try {
      const outcome = await runDriver(world);
      const report = assertArtifactExists(outcome);

      // ── the driver's own verdict, re-read from the artifact ──────────────
      assert.deepEqual(
        report.failures ?? [],
        [],
        `the driver reported failures: ${(report.failures ?? []).join("; ")}; stderr: ${tail(outcome.stderr)}`,
      );
      assert.equal(report.pass, true, "the driver's artifact says pass: false");
      for (const check of report.checks ?? []) {
        assert.equal(
          check.pass,
          true,
          `the driver check "${check.label}" failed: ${check.detail ?? "no detail"}`,
        );
      }
      assert.equal(
        outcome.code,
        0,
        `the driver exited ${outcome.code}; stderr: ${tail(outcome.stderr)}`,
      );

      const states = report.states ?? { initial: null, show: null, only: null };
      assert.ok(
        states.initial && states.show && states.only,
        "the artifact is missing one of its three states (initial/show/only)",
      );

      // ── (a) the archived row is absent until the view asks for it ───────
      const initial = states.initial!;
      assert.equal(
        initial.archivedRow,
        null,
        `the archived chat was already on screen before the filter was asked for: ${JSON.stringify(initial.rows)}`,
      );
      assert.deepEqual(
        initial.archivedRows,
        [],
        `an archived row was drawn in the default view: ${JSON.stringify(initial.rows)}`,
      );
      assert.ok(
        initial.liveRow,
        `the gateway's live chat "${LIVE.title}" was not on the working list: ${JSON.stringify(initial.rows)}`,
      );

      // ── (b) Show archived: the row appears, tagged, never openable ──────
      const show = states.show!;
      assert.ok(
        show.archivedRow,
        `Show archived did not list "${ARCHIVED.title}": ${JSON.stringify(show.rows)}`,
      );
      assert.equal(
        show.archivedRow!.label,
        ARCHIVED.title,
        `the archived row's label read ${JSON.stringify(show.archivedRow!.label)}`,
      );
      assert.equal(
        show.archivedRow!.archived,
        true,
        `the archived row does not carry data-archived: ${JSON.stringify(show.archivedRow)}`,
      );
      assert.equal(
        show.archivedRow!.tag,
        "Archived",
        `the archived row does not show the "Archived" tag: ${JSON.stringify(show.archivedRow)}`,
      );
      assert.equal(
        show.archivedRow!.openable,
        false,
        `the archived row is openable; it must be restorable but never a chat to open: ${JSON.stringify(show.archivedRow)}`,
      );
      assert.ok(
        show.liveRow,
        `Show archived dropped the live row: ${JSON.stringify(show.rows)}`,
      );

      // ── (c) Only archived: the live row is gone, the archive remains ────
      const only = states.only!;
      assert.equal(
        only.liveRow,
        null,
        `Only archived still drew the gateway's live chat: ${JSON.stringify(only.rows)}`,
      );
      assert.deepEqual(
        only.liveRows,
        [],
        `Only archived still drew live rows: ${JSON.stringify(only.rows)}`,
      );
      assert.ok(
        only.archivedRow,
        `Only archived dropped the archived chat too: ${JSON.stringify(only.rows)}`,
      );

      // ── (d) the picture is this rig's own capture of the shipped screen ──
      const screenshotWhere = path.relative(desktopRoot, SCREENSHOT);
      assert.equal(
        fs.existsSync(SCREENSHOT),
        true,
        `the driver wrote no screenshot at ${screenshotWhere}`,
      );
      const bytes = fs.statSync(SCREENSHOT).size;
      assert.ok(
        bytes > SCREENSHOT_MIN_BYTES,
        `${screenshotWhere} is ${bytes} bytes — a blank or failed capture was written instead of the sidebar`,
      );
      assert.deepEqual(
        report.screenshots ?? [],
        ["archived-chats.png"],
        `the artifact's screenshot list is ${JSON.stringify(report.screenshots)}`,
      );

      // ── (e) the live rows really came from the gateway ──────────────────
      const requests = report.gateway?.sessionsRequests ?? [];
      assert.ok(
        requests.length > 0,
        "the fake gateway was never asked for its session list — the live row cannot have come from the attached host",
      );
      assert.ok(
        requests.some((request) => String(request.path).includes("/api/sessions")),
        `no /api/sessions request was recorded: ${JSON.stringify(requests)}`,
      );
    } finally {
      if (process.env.LIFEQUEST_E2E_KEEP_TMP) {
        t.diagnostic(`kept the rig world at ${world.dir}`);
      } else {
        try {
          fs.rmSync(world.dir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
          t.diagnostic(`could not remove the rig world at ${world.dir}`);
        }
      }
    }
  });
});
