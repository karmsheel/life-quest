import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createVault } from "@lifequest/vault-core";

/**
 * The archive contract, end to end, through the REAL main process, preload
 * bridge and renderer — the write that archives a chat, and the message an
 * operator gets when the gateway is gone.
 *
 * WHY THIS RIG EXISTS
 *
 * The operator pressed Archive in the left sidebar and got "Unsupported session
 * fields: request_id". Two defects sat behind that one symptom:
 *
 *   1. `companionSessionPatch` sent `request_id` and `expected_revision` with
 *      every session PATCH. Those are the mutation identity of Hermes'
 *      DASHBOARD backend (`hermes_cli/web_server_sessions.py`, which fences its
 *      `session.mutate` RPC), not of the host gateway's `/api/sessions` API
 *      that this app attaches to. That gateway's PATCH is a strict allowlist
 *      and answers any other field with 400 `unsupported_session_field` before
 *      a write is attempted — so the archive was refused and the operator was
 *      shown the gateway's words.
 *
 *   2. The archive path had once bypassed the `gatewayCall` wrapper every other
 *      session call uses, so a gateway that was not answering produced undici's
 *      raw "fetch failed". That half is still guarded here.
 *
 * This file builds a throwaway world, runs `e2e/archive-contract.electron.mjs`
 * in Electron against it, and then judges the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway accepts anything, so the field problem is never
 *      exercised. It does NOT: it enforces the real allowlist and answers an
 *      unknown field with the real 400. The judge reads the gateway's own
 *      request log — "the PATCH arrived with accepted fields" is a fact about
 *      the wire.
 *   2. The rig passes because the app never archived. The judge requires the
 *      PATCH to be in the log, and requires the row to have left the working
 *      list.
 *   3. The dead-gateway check passes because the app never attached. The rig
 *      waits for the sidebar to mount AND for the gateway's live chat to be
 *      painted before it stops the gateway, so the later failure is the
 *      gateway dying and not the app never having connected.
 *   4. The error check is satisfied by any string. The judge requires the
 *      message to name the agent AND the control that retries it, and
 *      separately requires that it does NOT contain the raw transport words.
 *   5. The screenshots are stale, blank, or of another window. They are this
 *      window's own `capturePage()` — one after the archive landed, one after
 *      the error banner painted — and the judge requires >10 KB on each.
 *   6. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH, the
 *      profile is one no real install has (`lq-archive-e2e`), the vault is a
 *      throwaway `createVault()` copy, and the MCP door ports are moved by
 *      `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/archive-contract-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/archive-contract.json`,
 * `e2e/artifacts/archive-contract.png` (the successful archive) and
 * `e2e/artifacts/archive-contract-dead.png` (the actionable error).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/archive-contract.electron.mjs");
const REPORT = path.join(ARTIFACTS, "archive-contract.json");
const SCREENSHOT = path.join(ARTIFACTS, "archive-contract.png");
const DEAD_SCREENSHOT = path.join(ARTIFACTS, "archive-contract-dead.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/**
 * The fields the host gateway's PATCH accepts, as the rig's fake gateway
 * enforces them and the artifact records them.
 */
const SUPPORTED_SESSION_FIELDS = [
  "title",
  "end_reason",
  "pinned",
  "archived",
  "hidden",
  "unread",
];

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-archive-e2e";

/** The one chat this world owns: the one the operator archives. */
const LIVE = {
  id: "live-archive-chat",
  title: "Live archive chat",
  preview: "The chat the operator archived",
};

/**
 * A second working chat, so archiving the first does not empty the sidebar and
 * leave the dead-gateway gesture with nothing to aim at.
 */
const SECOND = {
  id: "second-archive-chat",
  title: "Second archive chat",
  preview: "The chat archived against a gateway that is gone",
};

type Check = { label: string; pass: boolean; detail: string | null };

type Patch = {
  at: number;
  method: string;
  path: string;
  body: Record<string, unknown>;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  supportedSessionFields?: string[];
  states: {
    ready: { rows: { label: string; archived: boolean }[] } | null;
    archived: { rows: { label: string; archived: boolean }[] } | null;
    dead: { error: string } | null;
  };
  gateway: {
    sessionsRequests: { at: number; method: string; path: string }[];
    patches: Patch[];
  } | null;
  screenshots: string[];
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
 * The throwaway world the app boots into: a temp `HERMES_HOME`, a throwaway
 * vault the app auto-opens, the userData that makes it auto-open, and a fake
 * `hermes` first on PATH so no real CLI is ever run.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-archive-contract-"));
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

  const created = await createVault(vaultDir, "Archive contract rig");
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
  // proof, which profile, where the fake CLI is).
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
        live: LIVE,
        second: SECOND,
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

describe("archiving a chat (the host gateway's field allowlist, and the message when it is gone)", () => {
  it("sends an archive the gateway accepts, and names a silent gateway in words the operator can act on", async (t) => {
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
    fs.rmSync(DEAD_SCREENSHOT, { force: true });

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
      assert.equal(report.pass, true, "the driver did not pass");
      for (const check of report.checks ?? []) {
        assert.equal(
          check.pass,
          true,
          `the driver failed a check: ${check.label}${check.detail ? ` — ${check.detail}` : ""}`,
        );
      }

      // ── (1) the wire, read from the gateway's OWN request log ────────────
      // Not the app's account of itself: the request bodies the gateway saw.
      assert.deepEqual(
        report.supportedSessionFields,
        SUPPORTED_SESSION_FIELDS,
        "the artifact does not record the field allowlist the rig enforced",
      );
      const patches = report.gateway?.patches ?? [];
      assert.ok(
        patches.length > 0,
        `the gateway never received an archive PATCH: ${JSON.stringify(report.gateway?.sessionsRequests ?? [])}`,
      );
      const patch = patches.at(-1) as Patch;
      assert.equal(patch.method, "PATCH", "the archive did not go out as a PATCH");
      assert.ok(
        patch.path.endsWith(`/${encodeURIComponent(LIVE.id)}`),
        `the archive hit the wrong chat: ${patch.path}`,
      );
      assert.deepEqual(
        patch.body,
        { archived: true },
        `the archive's body is not the plain flag the gateway accepts: ${JSON.stringify(patch.body)}`,
      );

      // ── (2) the archive landed: the row left the working list ────────────
      const readyRows = report.states.ready?.rows ?? [];
      assert.ok(
        readyRows.some((row) => row.label === LIVE.title),
        `the live chat was never on the sidebar, so the archive proved nothing: ${JSON.stringify(readyRows)}`,
      );
      const afterRows = report.states.archived?.rows ?? [];
      assert.ok(
        !afterRows.some((row) => row.label === LIVE.title),
        `the archived chat is still listed: ${JSON.stringify(afterRows)}`,
      );

      // ── (3) a silent gateway is named, not echoed ─────────────────────────
      const deadError = report.states.dead?.error ?? "";
      assert.ok(
        deadError.length > 0,
        "a gateway that is gone produced no message at all",
      );
      assert.doesNotMatch(
        deadError,
        /fetch failed/i,
        `the operator was shown the raw transport words again: ${JSON.stringify(deadError)}`,
      );
      assert.match(
        deadError,
        /agent/i,
        `the message does not say what is not answering: ${JSON.stringify(deadError)}`,
      );
      assert.match(
        deadError,
        /recheck/i,
        `the message does not name the control that retries it: ${JSON.stringify(deadError)}`,
      );

      // ── (4) the pictures are of the shipped screen ────────────────────────
      for (const screenshot of [SCREENSHOT, DEAD_SCREENSHOT]) {
        assert.equal(
          fs.existsSync(screenshot),
          true,
          `the rig wrote no ${path.basename(screenshot)}`,
        );
        const bytes = fs.statSync(screenshot).size;
        assert.ok(
          bytes > SCREENSHOT_MIN_BYTES,
          `${path.basename(screenshot)} is ${bytes} bytes (expected > ${SCREENSHOT_MIN_BYTES})`,
        );
      }
      assert.deepEqual(
        report.screenshots ?? [],
        ["archive-contract.png", "archive-contract-dead.png"],
        "the report does not name the screenshots it took",
      );
    } finally {
      fs.rmSync(world.dir, { recursive: true, force: true });
    }
  });
});
