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
 * A stalled chat stream, end to end, through the REAL main process, preload
 * bridge and renderer — the turn that used to show as running forever.
 *
 * WHY THIS RIG EXISTS
 *
 * LifeQuest's chat turn state (`run.sending`) is cleared by a terminal stream
 * frame or by the stream request settling. The reported bug: the Hermes gateway
 * streamed a `run.started` and a delta, then went silent with the connection
 * held open — no terminal frame, no keepalive. Nothing settled, so the rail's
 * dot kept pulsing, the "1 running" chip stayed, and the composer stayed in its
 * stop state until the app was restarted. The fix bounds the stream read with a
 * byte-idle timeout (the real gateway writes an SSE keepalive every ten
 * seconds, so a long byte silence is a dead stream), names the failure, settles
 * the turn BEFORE the post-turn list read, and re-reads the transcript so a
 * reply the gateway already stored is not lost.
 *
 * This file builds a throwaway world, runs `e2e/chat-stalled-turn.electron.mjs`
 * in Electron against it, and then judges the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake gateway does not really stall: it ends the stream, the
 *      pre-existing terminal path clears the dot and the rig proves nothing.
 *      The stream writes `run.started` + one delta and then nothing at all and
 *      holds the socket; the driver fails if the socket was already closed, and
 *      the judge re-derives the socket's close from the artifact.
 *   2. The turn never started: a send click that silently did nothing would let
 *      "the dot is gone" pass. The driver requires `data-live`, the "1 running"
 *      chip, the stop control and the gateway's `/chat/stream` POST before it
 *      judges recovery, and the judge re-reads those states from the artifact.
 *   3. The check cannot discriminate the bug. The idle bound is shortened
 *      through the seam's `streamIdleMs` (2500 ms) and recovery is required
 *      within 15 s. The control pass — `LQ_STALL_IDLE_MS=60000`, saved by hand
 *      as `chat-stalled-turn.before.json` — runs the same driver at/above the
 *      window and must fail with the dot still up; that is the reproduction.
 *   4. The dot clears for the wrong reason (a stop press, a generic error)
 *      while the stream is still open. The driver requires the app's NAMED
 *      sentence ("stopped sending"), the send control back, and the socket
 *      close.
 *   5. The reply is on screen because it streamed in, not because the app
 *      re-read it. The wire carries only PARTIAL text; the stored final reply
 *      exists only on `/api/sessions/{id}/messages` after the stall, so its
 *      presence proves the post-failure reload. The judge re-derives the
 *      completed `/messages` fetch from the artifact.
 *   6. The settle waits on the post-turn list read — the other half of the fix.
 *      Once the stream starts the driver HOLDS every `/api/sessions` list
 *      request unanswered while `/messages` keeps answering, so a green
 *      recovery proves the turn settled without it.
 *   7. The rig attaches to the operator's real Hermes, vault, or app. The
 *      `HERMES_HOME` is a temp dir, the profile is `lq-stall-e2e` (no real
 *      install has it), the vault is a throwaway `createVault()`, a stub
 *      `hermes` is first on PATH, the userData and MCP doors are moved by
 *      `LIFEQUEST_E2E`, and 8642/8643/8646 are never bound.
 *   8. The screenshot is stale, blank, or of another window. It is the driver's
 *      own window `capturePage()` after recovery, and the judge requires >10 KB
 *      on disk.
 *   9. The artifact contradicts itself. The judge re-derives every claim — the
 *      recovery time, the named sentence, the `/messages` re-read, the closed
 *      socket, the held list requests, the screenshot bytes — and does not
 *      trust `pass` alone.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/chat-stalled-turn-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/chat-stalled-turn.json` and
 * `e2e/artifacts/chat-stalled-turn.png` (the shipped screen, captured by the
 * rig).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/chat-stalled-turn.electron.mjs");
const REPORT = path.join(ARTIFACTS, "chat-stalled-turn.json");
const SCREENSHOT = path.join(ARTIFACTS, "chat-stalled-turn.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-stall-e2e";

/**
 * The seeded world. The stream carries PARTIAL text; FINAL text exists only in
 * the gateway's stored transcript after the stall, so it can only reach the
 * screen through the post-failure reload.
 */
const SESSION = { id: "stalled-turn-chat", title: "Stalled turn chat" };
const SEED = {
  userText: "Walk me through the garden plan for this week.",
  turnText: "Keep going until the whole report is written, then file it.",
  partialText: "PARTIAL-REPLY-WHILE-THE-STREAM-WAS-ALIVE",
  finalReply:
    "FINAL-STORED-REPLY — the gateway had already written this answer down before the socket went quiet.",
};

/** The idle bound the rig sets through the seam; the product's is 45 000 ms. */
const STREAM_IDLE_MS = (() => {
  const raw = Number(process.env.LQ_STALL_IDLE_MS ?? 2_500);
  return Number.isFinite(raw) && raw >= 500 ? Math.round(raw) : 2_500;
})();
/** The reported bug's window: the running state must clear within this. */
const RECOVERY_WINDOW_MS = 15_000;

type Check = { label: string; pass: boolean; detail: string | null };

type Sample = {
  at: number;
  rowPresent: boolean;
  rowLive: boolean;
  liveChip: string | null;
  composerPresent: boolean;
  composerDisabled: boolean | null;
  composerPlaceholder: string | null;
  sendState: string | null;
  sendLabel: string | null;
  error: string | null;
  transcript: string;
  transcriptHasSeed: boolean;
  transcriptHasPartial: boolean;
  transcriptHasFinal: boolean;
};

type RequestRow = { at: number; method: string; path: string };

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  control: boolean;
  measurements: {
    streamIdleMs: number;
    recoveryWindowMs: number;
    control: boolean;
    sendAt: number | null;
    recoveredAt: number | null;
    recoveryMs: number | null;
    socketClosedAfterSendMs: number | null;
    heldListRequestsAtJudgement: number;
  };
  states: {
    initial: Sample | null;
    running: Sample | null;
    recovered: Sample | null;
    usable: Sample | null;
  };
  gateway: {
    sessionListRequests: RequestRow[];
    heldListRequests: (RequestRow & { answered: boolean })[];
    messagesRequests: (RequestRow & { sessionId: string; stage: string })[];
    streamRequests: (RequestRow & { sessionId: string; input: string | null })[];
    stalled: {
      openedAt: number | null;
      closedAt: number | null;
      frames: string[];
    };
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
 * The throwaway world the app boots into: temp `HERMES_HOME` with the throwaway
 * profile, a throwaway vault the app auto-opens, the userData that makes it
 * auto-open, and a fake `hermes` first on PATH so no real CLI is ever run.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-stalled-turn-"));
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

  const created = await createVault(vaultDir, "Stalled turn rig");
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

  // What the driver needs to know that cannot be inferred (which chat is the
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
        session: SESSION,
        seed: SEED,
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
  // The seam shortens the stall bound to 2500 ms (or whatever the control run
  // asks for); the product's own bound is 45 s.
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
    streamIdleMs: STREAM_IDLE_MS,
  });
  env.LQ_STALL_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 200_000, env },
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

describe("a stalled chat stream, in the real app (the running state must clear)", () => {
  it(
    "clears the rail's running state, reopens the composer, names the failure, re-reads the transcript, and closes the stalled socket",
    { timeout: 180_000 },
    async (t) => {
      if (!(await devServerUp())) {
        t.skip(
          `dev server not listening on ${DEV_PORT} — run \`npm run dev\` (or lifequest-dev) to include this e2e`,
        );
        return;
      }
      // The driver imports the main bundle the bench's dev server built. Missing
      // it is a setup failure, not a reason to skip: a skipped rig is evidence
      // of nothing (AGENTS.md).
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

        // ── the driver's own verdict, re-read from the artifact ──────────
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

        // ── the seam really ran the rig's short bound ────────────────────
        assert.equal(
          report.measurements?.streamIdleMs,
          STREAM_IDLE_MS,
          `the artifact says the stream idle bound was ${report.measurements?.streamIdleMs}ms, not ${STREAM_IDLE_MS}ms — this is not the run the test asked for`,
        );
        assert.equal(
          report.control,
          false,
          "this artifact is a control run (bound at/above the recovery window); it reproduces the bug and must not be accepted as green",
        );

        // ── the running state appeared, then cleared inside the window ───
        assert.equal(
          report.states?.running?.rowLive,
          true,
          `the rail row never showed the running state, so the recovery proves nothing: ${JSON.stringify(report.states?.running)}`,
        );
        assert.equal(
          report.states?.running?.sendState,
          "stop",
          `the composer never showed its stop control: ${JSON.stringify(report.states?.running)}`,
        );
        const recoveryMs = report.measurements?.recoveryMs;
        assert.equal(
          typeof recoveryMs,
          "number",
          `the artifact carries no recovery time: ${JSON.stringify(report.measurements)}`,
        );
        assert.ok(
          recoveryMs! > 0 && recoveryMs! <= RECOVERY_WINDOW_MS,
          `recovery took ${recoveryMs}ms; the bound is ${RECOVERY_WINDOW_MS}ms`,
        );

        // ── the named sentence, the composer, the stored reply ───────────
        assert.match(
          report.states?.recovered?.error ?? "",
          /stopped sending/i,
          `the error on screen was ${JSON.stringify(report.states?.recovered?.error)} — not the app's named sentence`,
        );
        assert.equal(
          report.states?.recovered?.rowLive,
          false,
          `the rail row still carries data-live after recovery: ${JSON.stringify(report.states?.recovered)}`,
        );
        assert.equal(
          report.states?.recovered?.liveChip,
          null,
          `the running chip is still on screen: ${JSON.stringify(report.states?.recovered?.liveChip)}`,
        );
        assert.equal(
          report.states?.usable?.composerPresent,
          true,
          `the composer did not come back: ${JSON.stringify(report.states?.usable)}`,
        );
        assert.equal(
          report.states?.usable?.sendState,
          "send",
          `the composer did not offer its send control again: ${JSON.stringify(report.states?.usable)}`,
        );
        assert.equal(
          report.states?.recovered?.transcriptHasFinal,
          true,
          `the transcript does not show the gateway's stored reply: ${JSON.stringify(report.states?.recovered?.transcript)}`,
        );
        assert.equal(
          report.states?.recovered?.transcriptHasPartial,
          false,
          `the transcript still shows the partial stream text instead of the stored reply: ${JSON.stringify(report.states?.recovered?.transcript)}`,
        );

        // ── the transcript really was re-read after the stall ───────────
        const gateway = report.gateway;
        assert.ok(gateway, "the artifact carries no gateway log");
        const streamAt = gateway.streamRequests[0]?.at;
        assert.equal(
          typeof streamAt,
          "number",
          `the fake gateway was never asked to stream the turn: ${JSON.stringify(gateway.streamRequests)}`,
        );
        assert.ok(
          gateway.messagesRequests.some(
            (request) => request.at >= streamAt! && request.stage === "completed",
          ),
          `no completed /messages read happened after the stream started: ${JSON.stringify(gateway.messagesRequests)}`,
        );

        // ── the settle did not wait on the held post-turn list read ─────
        assert.ok(
          gateway.heldListRequests.length > 0,
          "the app never issued the post-turn session list read this rig holds open",
        );
        assert.deepEqual(
          gateway.heldListRequests.map((request) => request.answered),
          gateway.heldListRequests.map(() => false),
          `a held list request was answered after all: ${JSON.stringify(gateway.heldListRequests)}`,
        );

        // ── the app closed the stalled socket ────────────────────────────
        assert.equal(
          typeof gateway.stalled.closedAt,
          "number",
          `the stalled stream socket was never closed: ${JSON.stringify(gateway.stalled)}`,
        );

        // ── the picture is this rig's own capture of the shipped screen ──
        const screenshotWhere = path.relative(desktopRoot, SCREENSHOT);
        assert.equal(
          fs.existsSync(SCREENSHOT),
          true,
          `the driver wrote no screenshot at ${screenshotWhere}`,
        );
        const bytes = fs.statSync(SCREENSHOT).size;
        assert.ok(
          bytes > SCREENSHOT_MIN_BYTES,
          `${screenshotWhere} is ${bytes} bytes — a blank or failed capture was written instead of the recovered chat`,
        );
        assert.deepEqual(
          report.screenshots ?? [],
          ["chat-stalled-turn.png"],
          `the artifact's screenshot list is ${JSON.stringify(report.screenshots)}`,
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
    },
  );
});
