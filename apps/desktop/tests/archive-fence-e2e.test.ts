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
 * The archive fence, end to end, through the REAL main process, preload bridge
 * and renderer — the write that archives a chat, and the message an operator
 * gets when the gateway is gone.
 *
 * WHY THIS RIG EXISTS
 *
 * The operator pressed Archive in the left sidebar and got "Fetch failed". Two
 * defects sat behind that one symptom:
 *
 *   1. `companionSessionPatch` called `hermesFetch` directly while every other
 *      session call went through the `gatewayCall` wrapper. A gateway that was
 *      not answering therefore produced undici's raw "fetch failed", which the
 *      sidebar's error banner showed verbatim — the operator was given a
 *      transport string and nothing about what to do about it.
 *
 *   2. The Hermes host gateway FENCES every session mutation: `PATCH
 *      /api/sessions/{id}` refuses a write with no `request_id` and no
 *      `expected_revision` (409 `mutation_identity_required`), and refuses one
 *      whose revision has moved on (409 `revision_conflict`). The app sent
 *      only `{archived: true}`, so even against a healthy gateway the archive
 *      was refused as a pre-fence client. The revision the fence needs was
 *      already in the list read (`runtime_revision`); the app dropped it.
 *
 * This file builds a throwaway world, runs `e2e/archive-fence.electron.mjs` in
 * Electron against it, and then judges the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway accepts anything, so the fence is never exercised. It
 *      does NOT: it refuses a write with no mutation identity exactly as the
 *      real host does, and refuses one whose revision does not match the row.
 *      The judge reads the gateway's own request log — so "the PATCH arrived
 *      with a fence" is a fact about the wire.
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
 *   5. The screenshot is stale, blank, or of another window. It is this
 *      window's own `capturePage()` after the error banner painted, and the
 *      judge requires >10 KB on disk.
 *   6. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH, the
 *      profile is one no real install has (`lq-fence-e2e`), the vault is a
 *      throwaway `createVault()` copy, and the MCP door ports are moved by
 *      `LIFEQUEST_E2E`. 8642/8643/8646 are never bound.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/archive-fence-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/archive-fence.json` and
 * `e2e/artifacts/archive-fence.png` (the shipped screen, captured by the rig).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/archive-fence.electron.mjs");
const REPORT = path.join(ARTIFACTS, "archive-fence.json");
const SCREENSHOT = path.join(ARTIFACTS, "archive-fence.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-fence-e2e";

/** The one chat this world owns. Its row's revision is 7 (the driver's world). */
const LIVE = {
  id: "live-fence-chat",
  title: "Live fence chat",
  preview: "The chat the operator archived",
};

/**
 * A second working chat, so archiving the first does not empty the sidebar and
 * leave the dead-gateway gesture with nothing to aim at.
 */
const SECOND = {
  id: "second-fence-chat",
  title: "Second fence chat",
  preview: "The chat archived against a gateway that is gone",
};

/** The row's revision in the fake gateway's list. The fence must carry it. */
const ROW_REVISION = 7;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-archive-fence-"));
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

  const created = await createVault(vaultDir, "Archive fence rig");
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

  // What the driver needs to know that cannot be inferred (which row is the
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
        live: LIVE,
        second: SECOND,
        rowRevision: ROW_REVISION,
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
  env.LQ_FENCE_WORLD = world.dir;
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

describe("archiving a chat (the fence the gateway demands, and the message when it is gone)", () => {
  it("sends a fenced archive the gateway accepts, and names a silent gateway in words the operator can act on", async (t) => {
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
      assert.equal(report.pass, true, "the driver did not pass");
      for (const check of report.checks ?? []) {
        assert.equal(
          check.pass,
          true,
          `the driver failed a check: ${check.label}${check.detail ? ` — ${check.detail}` : ""}`,
        );
      }

      // ── (1) the fence, read from the gateway's OWN request log ───────────
      // Not the app's account of itself: the wire.
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
      assert.equal(
        patch.body?.archived,
        true,
        `the archive never reached the gateway as a flag: ${JSON.stringify(patch.body)}`,
      );
      assert.equal(
        typeof patch.body?.request_id,
        "string",
        `the PATCH carries no request_id, so the gateway refuses it as a pre-fence client: ${JSON.stringify(patch.body)}`,
      );
      assert.ok(
        (patch.body?.request_id as string).length > 0,
        "the PATCH's request_id is empty",
      );
      assert.equal(
        patch.body?.expected_revision,
        ROW_REVISION,
        `the PATCH's expected_revision is ${String(patch.body?.expected_revision)}, not the row's own revision (${ROW_REVISION}) as the list read it: ${JSON.stringify(patch.body)}`,
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

      // ── (4) the picture is of the shipped screen ──────────────────────────
      assert.equal(
        fs.existsSync(SCREENSHOT),
        true,
        "the rig wrote no screenshot",
      );
      const bytes = fs.statSync(SCREENSHOT).size;
      assert.ok(
        bytes > SCREENSHOT_MIN_BYTES,
        `the screenshot is ${bytes} bytes (expected > ${SCREENSHOT_MIN_BYTES})`,
      );
      assert.deepEqual(
        report.screenshots ?? [],
        ["archive-fence.png"],
        "the report does not name the screenshot it took",
      );
    } finally {
      fs.rmSync(world.dir, { recursive: true, force: true });
    }
  });
});
