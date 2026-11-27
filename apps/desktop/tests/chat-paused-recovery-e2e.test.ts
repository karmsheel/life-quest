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
// The note on screen is the renderer's rendering of the terminal frame's
// `reason`, and the reason is this exported constant. Importing it means a
// silent reword of the recovery note fails this rig instead of drifting past
// it; the module is pure (types and functions only), so the test runner's
// type-stripping can load it directly.
import { PAUSED_RECOVERED_REASON } from "../electron/companion-client.ts";

/**
 * A paused Hermes conversation, recovered in place, end to end through the REAL
 * main process, preload bridge and renderer.
 *
 * WHY THIS RIG EXISTS
 *
 * Hermes pauses a conversation whose FIFO head it cannot account for — the
 * shape a turn takes when the app or the gateway was killed mid-run. Every
 * later send is accepted and committed but never executed, and the stream says
 * so with an `error` frame carrying the runtime token `unknown_execution`, then
 * closes without a terminal run frame. Before the fix the dock turned that into
 * a dead end: the pause sentence told the operator to start a new chat, and the
 * generic stream-closed footer said the turn ended before finishing. Both were
 * wrong: Hermes can acknowledge the lost turn without replaying it
 * (`hermes sessions discard <id> --yes`, the non-interactive form of
 * `prompt.resolve_unknown`), after which the message queued behind it runs.
 *
 * The fix in `electron/companion.ts` swallows the paused frame, runs the discard
 * for the OPEN VAULT's Hermes profile, re-reads the transcript until it grows,
 * and emits ONE terminal `run.incomplete` whose reason is
 * `PAUSED_RECOVERED_REASON` and whose snapshot is the re-read transcript. The
 * dock recovers in place and keeps its history.
 *
 * This file builds a throwaway world, runs
 * `e2e/chat-paused-recovery.electron.mjs` in Electron against it, and judges
 * the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The fake host does not really pause: it ends the stream with a terminal
 *      frame, the ordinary completion path paints the reply, and the rig proves
 *      nothing. The host writes exactly one `event: error` frame carrying
 *      `unknown_execution` (the shape pinned by `companion-paused.electron.mjs`)
 *      and ends the response; the judge re-derives that no terminal run frame
 *      was written.
 *   2. The app never asked Hermes to recover: a dock that merely hid the dead
 *      end would pass a "no dead end" check while the chat stayed paused. The
 *      stub `hermes` on PATH records every invocation into this run's directory
 *      (and only when pointed there); the judge fails unless the artifact
 *      carries `-p <rig-profile> sessions discard <sessionId> --yes`.
 *   3. The reply was already on the transcript, so "the reply is on screen" is
 *      not evidence of a re-read. The fake host serves the paused transcript
 *      (operator turn, no assistant reply) until the discard record exists, then
 *      the grown transcript. Every `/messages` request is logged with
 *      `afterDiscard` and the rows it served; the judge re-derives that the
 *      grown rows exist only after the discard and never before it.
 *   4. The note is a fixture's, not the shipped code's. The driver boots the
 *      real main process and drives the real rail/composer; the painted
 *      `.chat-panel__turn-note` is the renderer's rendering of the reason main
 *      emitted. The judge requires it to contain the imported
 *      `PAUSED_RECOVERED_REASON`.
 *   5. The dead end is only hidden while the error banner still shows, or the
 *      chat was "recovered" by opening a new one. The judge requires the error
 *      banner absent, neither dead-end sentence anywhere in the dock, the SAME
 *      session's earlier message still on screen, and the composer
 *      send-enabled.
 *   6. The paused path was bypassed by the generic close path: the fake host
 *      closes right after the paused frame, so "the stream closed before the
 *      turn finished" on screen would mean main reported the close instead of
 *      recovering. The judge forbids that sentence.
 *   7. The rig attaches to the operator's real Hermes, vault, or app. The
 *      `HERMES_HOME` is a temp dir, the profile is `lq-paused-e2e` (no real
 *      install has it), the vault is a throwaway `createVault()` bound to that
 *      profile, a stub `hermes` is first on PATH, the userData and MCP doors are
 *      moved by `LIFEQUEST_E2E`, and 8642/8643/8646 are never bound.
 *   8. The screenshot is stale, blank, or of another window. It is the driver's
 *      own window `capturePage()` after recovery, and the judge requires >10 KB
 *      on disk.
 *   9. The artifact contradicts itself. The judge re-derives every claim — the
 *      discard argv, the stream's frames, the post-discard transcript growth,
 *      the note, the dead-end absence, the composer, the screenshot bytes — and
 *      does not trust `pass` alone.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/chat-paused-recovery-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/chat-paused-recovery.json` and
 * `e2e/artifacts/chat-paused-recovery.png` (the shipped screen, captured by the
 * rig).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/chat-paused-recovery.electron.mjs");
const REPORT = path.join(ARTIFACTS, "chat-paused-recovery.json");
const SCREENSHOT = path.join(ARTIFACTS, "chat-paused-recovery.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-paused-e2e";
/** Ports the product owns; the rig must never bind one. */
const RESERVED_PORTS = [8642, 8643, 8646];
/** How long the app may go without a stream byte; the product's bound is 45 s. */
const STREAM_IDLE_MS = 10_000;
/** The reported bug's window: the chat must be usable again within this. */
const RECOVERY_WINDOW_MS = 15_000;

/**
 * The seeded world. The stream carries ONLY the paused error frame; the reply
 * exists only in the gateway's transcript AFTER the discard, so it can reach
 * the screen only through the post-discard re-read.
 */
const SESSION = { id: "paused-recovery-chat", title: "Paused recovery chat" };
const SEED = {
  userText: "Walk me through the garden plan for this week.",
  turnText: "The message that was queued behind the interrupted turn.",
  finalReply:
    "RECOVERED-REPLY — the message queued behind the lost turn has now been answered, in this same chat.",
};

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
  sendDisabled: boolean | null;
  errorBoxPresent: boolean;
  error: string | null;
  note: string | null;
  footerStatus: string | null;
  transcript: string;
  transcriptHasSeed: boolean;
  transcriptHasTurn: boolean;
  transcriptHasFinal: boolean;
  panelText: string;
};

type RequestRow = { at: number; method: string; path: string };

type ServedRows = {
  count: number;
  roles: string[];
  hasSeed: boolean;
  hasOperatorTurn: boolean;
  hasAssistantReply: boolean;
  lastRole: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  what: string;
  why: string;
  world: {
    profile: string;
    profilePath: string;
    sessionId: string;
    sessionTitle: string;
    gatewayPort: number;
    hermesHome: string;
    userData: string;
    vaultDir: string;
    binDir: string;
    recordFile: string;
  };
  measurements: {
    streamIdleMs: number | null;
    sendAt: number | null;
    runningSeenAt: number | null;
    streamRequestAt: number | null;
    streamClosedAt: number | null;
    discardRecordedAt: number | null;
    discardObservedAt: number | null;
    recoveredAt: number | null;
    recoveryMs: number | null;
    messagesBeforeDiscard: number;
    messagesAfterDiscard: number;
  };
  states: {
    initial: Sample | null;
    running: Sample | null;
    recovered: Sample | null;
    usable: Sample | null;
  };
  gateway: {
    sessionListRequests: RequestRow[];
    messagesRequests: (RequestRow & {
      sessionId: string;
      afterDiscard: boolean;
      stage: string;
      served: ServedRows;
    })[];
    streamRequests: (RequestRow & { sessionId: string; input: string | null })[];
    stream: {
      openedAt: number | null;
      closedAt: number | null;
      frames: string[];
      errorFrame: string;
      terminalFrameSent: boolean;
      input: string | null;
      sessionId: string | null;
      path: string | null;
    };
    discard: {
      recorded: boolean;
      argv: string[] | null;
      rawLine: string | null;
      recordedAt: number | null;
      observedAt: number | null;
      recordFile: string;
      allInvocations: string[][];
    };
  } | null;
  hermeticity: {
    profile: string;
    hermesHome: string;
    recordFile: string;
    gatewayPort: number;
    mcpPorts: { local: number; invite: number };
    reservedPorts: number[];
  } | null;
  consoleErrors: string[];
  screenshots: string[];
  notes: string[];
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

/**
 * A free port nothing is listening on, asked by binding it rather than guessing,
 * and never one of the product's own ports.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => {
          if (RESERVED_PORTS.includes(port) && attempts < 8) attempt();
          else resolve(port);
        });
      });
    };
    attempt();
  });
}

/**
 * The fake `hermes` CLI, first on PATH.
 *
 * It records every invocation into `$LQ_PAUSED_RECORD/hermes-calls.txt` — one
 * tab-separated argv per line — and ONLY when that variable is set, so a run
 * that forgot to point it somewhere cannot write into the operator's home. The
 * record is how the judge proves the app ran the real recovery command with the
 * rig's profile and session, and that it resolved THIS shim rather than the
 * operator's Hermes.
 *
 * `LQ_PAUSED_CLI_FAIL` is the hook for a future control pass: the discard then
 * exits non-zero, and the app must fall back to the old pause sentence instead
 * of claiming a recovery. The test never sets it.
 */
const HERMES_STUB = `#!/bin/sh
# The paused-chat-recovery rig's fake hermes. Records argv, never touches a host.
if [ -n "\${LQ_PAUSED_RECORD:-}" ]; then
  line=""
  for arg in "$@"; do
    if [ -z "$line" ]; then line="$arg"; else line="$line\t$arg"; fi
  done
  printf '%s\\n' "$line" >> "\${LQ_PAUSED_RECORD}/hermes-calls.txt"
fi
if [ -n "\${LQ_PAUSED_CLI_FAIL:-}" ]; then
  for arg in "$@"; do
    if [ "$arg" = "discard" ]; then
      echo "the control run refused to discard" >&2
      exit 1
    fi
  done
fi
exit 0
`;

/**
 * The throwaway world the app boots into: temp `HERMES_HOME` with the throwaway
 * profile, a throwaway vault the app auto-opens AND binds to that profile (the
 * recovery's `activeProfileName()` reads the open vault's binding, so without
 * this the CLI would be pointed at `lifequest`), the userData that makes it
 * auto-open, and the fake `hermes` first on PATH.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-paused-recovery-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const profileDir = path.join(hermesHome, "profiles", PROFILE);
  for (const made of [hermesHome, profileDir, userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, HERMES_STUB, { mode: 0o755 });

  // The minimal host config the attach path expects. `model:` is deliberate:
  // the host's model probe runs after the ready status and must not warn about
  // this rig's business.
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n",
    "utf8",
  );

  const created = await createVault(vaultDir, "Paused recovery rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

  // The same shape the stalled-turn rig writes, plus the vault's agent
  // binding: the open vault owns the Hermes profile, and the recovery asks the
  // OPEN VAULT for it. `vaultAgentsMigrated` is set so the legacy-adoption pass
  // cannot rewrite the binding out from under the rig.
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
        vaultAgents: {
          [vault.id]: { harness: "hermes", hermesProfile: PROFILE },
        },
        vaultAgentsMigrated: true,
        harness: "hermes",
        companionProfile: PROFILE,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // The MCP doors move off the product ports; the driver's app would otherwise
  // fight the bench app for 8643/8646. They must be two different ports, or the
  // second listener fails and the vault opens with a door error.
  const localDoor = await freePort();
  let inviteDoor = await freePort();
  while (inviteDoor === localDoor) inviteDoor = await freePort();
  const mcpPorts = { local: localDoor, invite: inviteDoor };

  // What the driver needs to know that cannot be inferred (which chat is the
  // proof, which profile, where the fake CLI is, where its record goes).
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
  // A stray control hook in the operator's shell must not turn the green run
  // into a fallback run.
  delete env.LQ_PAUSED_CLI_FAIL;
  env.HERMES_HOME = world.hermesHome;
  // The fake CLI must resolve first: this is the only thing that keeps the app
  // from running the operator's real `hermes`.
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL =
    process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${DEV_PORT}`;
  // The shim records the recovery invocation here, and only here.
  env.LQ_PAUSED_RECORD = world.dir;
  // A short stream-idle bound only shortens the failure path if the fake host
  // ever fails to close the paused stream; the product's own bound is 45 s.
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
    streamIdleMs: STREAM_IDLE_MS,
  });
  env.LQ_PAUSED_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 200_000, maxBuffer: 8 * 1024 * 1024, env },
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

describe("a paused Hermes chat, in the real app (it must recover in place)", () => {
  it(
    "swallows the paused frame, runs the discard, re-reads the grown transcript, and leaves the chat usable without a new-chat dead end",
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

        // ── the seam really ran the rig's own bounds and profile ─────────
        assert.equal(
          report.measurements?.streamIdleMs,
          STREAM_IDLE_MS,
          `the artifact says the stream idle bound was ${report.measurements?.streamIdleMs}ms, not ${STREAM_IDLE_MS}ms — this is not the run the test asked for`,
        );
        assert.equal(report.world?.profile, PROFILE);
        assert.equal(report.world?.sessionId, SESSION.id);
        assert.equal(report.world?.sessionTitle, SESSION.title);

        // ── the fake host really paused, and closed without a terminal frame ─
        const gateway = report.gateway;
        assert.ok(gateway, "the artifact carries no gateway log");
        assert.equal(
          gateway.streamRequests.length > 0,
          true,
          `the fake gateway was never asked to stream the turn: ${JSON.stringify(gateway.streamRequests)}`,
        );
        assert.equal(
          gateway.streamRequests[0]?.sessionId,
          SESSION.id,
          `the turn was streamed into ${JSON.stringify(gateway.streamRequests[0]?.sessionId)}, not the seeded chat`,
        );
        assert.match(
          String(gateway.streamRequests[0]?.input ?? ""),
          new RegExp(SEED.turnText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          `the stream request did not carry the operator's turn: ${JSON.stringify(gateway.streamRequests[0]?.input)}`,
        );
        assert.equal(gateway.stream.errorFrame, gateway.stream.frames[0]);
        assert.match(gateway.stream.frames[0] ?? "", /^event: error\n/);
        assert.match(gateway.stream.frames[0] ?? "", /unknown_execution/);
        assert.equal(
          gateway.stream.terminalFrameSent,
          false,
          `the fake host wrote a terminal run frame, so this rig is not testing the paused path: ${JSON.stringify(gateway.stream.frames)}`,
        );
        assert.equal(
          gateway.stream.frames.filter((frame) => /^event: run\./m.test(frame)).length,
          0,
          `a run.* terminal frame reached the wire: ${JSON.stringify(gateway.stream.frames)}`,
        );
        assert.equal(
          typeof gateway.stream.closedAt,
          "number",
          `the paused stream was never closed: ${JSON.stringify(gateway.stream)}`,
        );

        // ── the app really ran the recovery command ──────────────────────
        assert.equal(
          gateway.discard.recorded,
          true,
          `no \`hermes -p ${PROFILE} sessions discard ${SESSION.id} --yes\` invocation was recorded; the app never asked Hermes to recover (all invocations: ${JSON.stringify(gateway.discard.allInvocations)})`,
        );
        assert.deepEqual(
          gateway.discard.argv,
          ["-p", PROFILE, "sessions", "discard", SESSION.id, "--yes"],
          `the recovery invocation was ${JSON.stringify(gateway.discard.argv)}, not the non-replaying discard`,
        );

        // ── the transcript grew only AFTER the discard, and was re-read ──
        const before = gateway.messagesRequests.filter(
          (request) => request.afterDiscard === false,
        );
        const after = gateway.messagesRequests.filter(
          (request) => request.afterDiscard === true,
        );
        const baseline = before.reduce(
          (largest, request) => Math.max(largest, request.served.count),
          0,
        );
        assert.equal(
          before.every((request) => request.served.hasAssistantReply === false),
          true,
          `the reply was already in a pre-discard transcript, so the screen could show it without a re-read: ${JSON.stringify(before)}`,
        );
        assert.equal(
          after.length > 0,
          true,
          `no /messages read happened after the discard: ${JSON.stringify(gateway.messagesRequests)}`,
        );
        const grown = after.find(
          (request) =>
            request.sessionId === SESSION.id &&
            request.served.count > baseline &&
            request.served.hasAssistantReply === true &&
            request.served.lastRole === "assistant",
        );
        assert.ok(
          grown,
          `no post-discard read returned the grown transcript (baseline ${baseline} rows): ${JSON.stringify(after)}`,
        );
        assert.equal(
          grown!.served.hasOperatorTurn,
          true,
          `the grown transcript lost the operator's queued message: ${JSON.stringify(grown!.served)}`,
        );

        // ── the dock recovered in place: note, reply, no dead end ────────
        const recovered = report.states?.recovered;
        assert.ok(recovered, "the artifact carries no recovered state");
        assert.equal(
          (recovered!.note ?? "").includes(PAUSED_RECOVERED_REASON),
          true,
          `the painted turn note ${JSON.stringify(recovered!.note)} does not carry the shipped recovery reason ${JSON.stringify(PAUSED_RECOVERED_REASON)}`,
        );
        assert.match(
          recovered!.note ?? "",
          /paused/i,
          `the note does not name the pause: ${JSON.stringify(recovered!.note)}`,
        );
        assert.equal(
          recovered!.footerStatus,
          "incomplete",
          `the recovered turn's footer is ${JSON.stringify(recovered!.footerStatus)}, so the recovery note is not the terminal frame's`,
        );
        assert.equal(
          recovered!.transcriptHasTurn,
          true,
          `the operator's queued message is not in the transcript: ${JSON.stringify(recovered!.transcript)}`,
        );
        assert.equal(
          recovered!.transcriptHasFinal,
          true,
          `the recovered reply is not in the transcript: ${JSON.stringify(recovered!.transcript)}`,
        );
        assert.equal(
          recovered!.transcriptHasSeed,
          true,
          `the earlier message is gone, so this is a new chat rather than the recovered one: ${JSON.stringify(recovered!.transcript)}`,
        );
        assert.equal(
          recovered!.errorBoxPresent,
          false,
          `the error banner is still on screen: ${JSON.stringify(recovered!.error)}`,
        );
        for (const sentence of [
          "start a new chat",
          "stream closed before the turn finished",
        ]) {
          assert.doesNotMatch(
            recovered!.panelText ?? "",
            new RegExp(sentence, "i"),
            `the dock still says "${sentence}": ${JSON.stringify(recovered!.panelText)}`,
          );
        }
        assert.doesNotMatch(
          recovered!.panelText ?? "",
          /unknown_execution/i,
          "the runtime token reached the screen",
        );

        // ── the turn really ran, then settled, inside the reported window ─
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
        assert.equal(recovered!.rowLive, false);
        assert.equal(recovered!.liveChip, null);

        // ── the composer is send-enabled again ───────────────────────────
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
          report.states?.usable?.sendDisabled,
          false,
          `the send control is disabled after recovery: ${JSON.stringify(report.states?.usable)}`,
        );

        // ── hermeticity: the rig touched only its own throwaway world ────
        const hermeticity = report.hermeticity;
        assert.ok(hermeticity, "the artifact carries no hermeticity facts");
        assert.equal(hermeticity!.profile, PROFILE);
        assert.equal(
          hermeticity!.hermesHome.startsWith(os.tmpdir()),
          true,
          `the rig's HERMES_HOME is not a temp dir: ${hermeticity!.hermesHome}`,
        );
        assert.equal(
          RESERVED_PORTS.includes(hermeticity!.gatewayPort),
          false,
          `the fake gateway bound the product port ${hermeticity!.gatewayPort}`,
        );
        assert.deepEqual(
          RESERVED_PORTS.filter(
            (port) =>
              hermeticity!.mcpPorts.local === port ||
              hermeticity!.mcpPorts.invite === port,
          ),
          [],
          `the rig's MCP doors bound a product port: ${JSON.stringify(hermeticity!.mcpPorts)}`,
        );
        assert.equal(
          hermeticity!.recordFile.startsWith(world.dir),
          true,
          `the CLI record file is outside this run's directory: ${hermeticity!.recordFile}`,
        );

        // ── the runtime token never reached the console ──────────────────
        assert.deepEqual(
          (report.consoleErrors ?? []).filter((line) => /unknown_execution/i.test(line)),
          [],
          `the runtime token was logged as a console error: ${JSON.stringify(report.consoleErrors)}`,
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
          ["chat-paused-recovery.png"],
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
