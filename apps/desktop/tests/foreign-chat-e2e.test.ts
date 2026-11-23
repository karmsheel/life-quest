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
 * Continuing a chat another surface owns, end to end, through the REAL main
 * process, preload bridge and renderer.
 *
 * WHY THIS RIG EXISTS
 *
 * The Chats list has always listed every conversation on the companion's Hermes
 * profile, whichever surface started it, and the app reads their transcripts
 * through `GET /api/sessions/{id}/messages`. Sending into one did not work:
 * `POST /api/sessions/{id}/chat[/stream]` is the API transport's door, and
 * Hermes refuses a turn aimed at a session another surface owns
 * (`permission_denied`), which surfaced as "Chat stream failed (500)". Hermes'
 * documented answer is to attach through the gateway WebSocket
 * (`session.resume` + `prompt.submit`). This rig proves the real app does that,
 * on the same stored session, while a normal api_server chat keeps the REST
 * stream.
 *
 * This file builds a throwaway world, runs `e2e/foreign-chat.electron.mjs` in
 * Electron against it, and then judges the artifact from outside the app.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The rig talks HTTP only and the continue never reaches the WS. The fake
 *      gateway records every resume/submit/interrupt frame and the ticket
 *      minted over the control socket; the judge re-derives them from the
 *      artifact and fails without them.
 *   2. The app falls back to the API transport and the fake API answers anyway.
 *      The fake API's session-chat route is the real refusal (HTTP 500
 *      permission_denied) and every hit is recorded; the judge requires zero
 *      taps for the Telegram chat and that the turn still streamed.
 *   3. The reply is painted from the REST transcript rather than streamed
 *      frames. The fake REST transcript never contains the WS-only reply text;
 *      the judge requires the reply in the DOM and the same marker absent from
 *      every served REST row.
 *   4. The chat is continued into a different session. resume and submit must
 *      name the Telegram session id, and no POST /api/sessions create may
 *      happen (that would be a new chat).
 *   5. Stop is never exercised. A second turn is admitted and held running, the
 *      dock's own stop control is clicked, and the judge requires
 *      session.interrupt naming the Telegram session.
 *   6. The api_server chat is silently rerouted through the WS too. Its turn
 *      must hit the fake API chat stream, paint its reply, and never appear as
 *      a prompt.submit.
 *   7. The rig attaches to the operator's real Hermes, vault, or app.
 *      `HERMES_HOME` is a temp dir, a stub `hermes` is first on PATH and
 *      records every invocation, the profile is `lq-foreign-e2e` (no real
 *      install has it), the vault is a throwaway `createVault()`, userData and
 *      MCP doors are moved, and the gateway binds 127.0.0.1.
 *   8. The screenshot is stale or blank. It is the driver's own window
 *      `capturePage()` while the dock shows the chip and the streamed reply,
 *      and the judge requires >10 KB on disk.
 *   9. The artifact contradicts itself. The judge re-derives every claim — the
 *      frames, the refusal count, the served REST rows, the DOM sample, the
 *      CLI log and the screenshot bytes — and does not trust `pass` alone.
 *
 * SKIP: only when the Vite dev server is not listening on 5173, because the app
 * is started from source and loads its renderer from that server. Run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/foreign-chat-e2e.test.ts`,
 * which puts that server up and builds `dist-electron/main.js`; a bare
 * `npm test` with no server would otherwise pass by skipping this rig.
 *
 * Artifacts: `e2e/artifacts/foreign-chat.json` and
 * `e2e/artifacts/foreign-chat.png` (the shipped screen, captured by the rig).
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/foreign-chat.electron.mjs");
const REPORT = path.join(ARTIFACTS, "foreign-chat.json");
const SCREENSHOT = path.join(ARTIFACTS, "foreign-chat.png");
const SCREENSHOT_MIN_BYTES = 10 * 1024;
const DEV_PORT = 5173;

/** The profile no real Hermes install has; also the string `recent.json` names. */
const PROFILE = "lq-foreign-e2e";

/** The two chats the fake gateway lists: one another surface owns, one not. */
const TELEGRAM = {
  id: "tg-garden-chat",
  title: "Telegram · garden plan",
  source: "telegram",
  transcript: [
    {
      role: "user",
      content: "We planned the spring beds last week — the tulips are in the north bed.",
    },
    {
      role: "assistant",
      content: "The tulips hold the north bed until May; after them, the nigella.",
    },
  ],
};
const API = {
  id: "api-tasks-chat",
  title: "A normal LifeQuest chat",
  source: "api_server",
  transcript: [
    { role: "user", content: "Summarise the open tasks in my vault." },
    {
      role: "assistant",
      content: "Two tasks are open: the seed order and the fence repair.",
    },
  ],
};

/**
 * The turn's texts. The WS answer exists ONLY in the WebSocket frames — never
 * in a REST transcript — so its appearance in the DOM is the proof the reply
 * was streamed over the gateway socket. The narration is what the transport
 * streams BEFORE its tool call: it becomes a work-log narration line, which is
 * exactly the shape a real REST turn has (`assistant.completed` then carries
 * the authoritative whole reply). Narration and answer are deliberately
 * different words, the way a real reply's are.
 */
const SEED = {
  turnText: "Continue where we left off: what should I sow in the south bed this weekend?",
  wsNarration: "Let me pull up the bed plan we wrote for the south bed.",
  wsReplyMarker: "WS-ONLY-REPLY",
  wsReply:
    "WS-ONLY-REPLY — sow nigella in the south bed this weekend; the gateway socket carried this answer, not the REST transcript.",
  wsReplyPrefix: "WS-ONLY-REPLY — sow nigella",
  secondTurnText: "Now write the whole spring schedule into the garden note.",
  secondPartialMarker: "SECOND-TURN-PARTIAL",
  secondPartial:
    "SECOND-TURN-PARTIAL — this turn is still running on the gateway socket.",
  apiTurnText: "List them with due dates.",
  apiNarration: "Let me check the task list in the vault first.",
  apiReplyMarker: "API-TRANSPORT-REPLY",
  apiReply:
    "API-TRANSPORT-REPLY — the normal chat still ran on the API chat stream.",
  /** What the REAL gateway returns for a turn the API does not own. */
  refusalBody: {
    object: "error",
    error: {
      type: "permission_denied",
      code: "permission_denied",
      message:
        "API sessions are their own sessions. This conversation was started on another surface; continue it over the gateway WebSocket.",
    },
  },
};

type Check = { label: string; pass: boolean; detail: string | null };

type RowSample = {
  label: string;
  continuable: string | null;
  source: string | null;
  live: boolean;
  archived: boolean;
  rowText: string;
};

type DisabledControl = {
  tag: string;
  cls: string;
  testid: string | null;
  label: string | null;
  title: string | null;
  disabled: boolean;
  state: string | null;
};

type Sample = {
  at: number;
  hasRail: boolean;
  rows: RowSample[];
  telegramRow: RowSample | null;
  apiRow: RowSample | null;
  hasHeader: boolean;
  headerContinuable: string | null;
  headerSource: string | null;
  headerText: string | null;
  hasChip: boolean;
  chipText: string | null;
  chipTitle: string | null;
  chipSource: string | null;
  hasNote: boolean;
  noteText: string | null;
  noteSource: string | null;
  disabledControls: DisabledControl[];
  transcript: string | null;
  composerPresent: boolean;
  composerDisabled: boolean | null;
  composerValue: string | null;
  sendState: string | null;
  sendLabel: string | null;
  sendDisabled: boolean | null;
  rowLive: boolean;
  error: string | null;
  modelRepairPresent: boolean;
  modelRepairUseDefault: boolean;
  turnCount: number;
  turns: { status: string | null; text: string }[];
};

type WsFrame = {
  at: number;
  method: string;
  id: number | null;
  params: Record<string, unknown>;
  raw: string;
};

type RequestRow = {
  at: number;
  method: string;
  path: string;
  sessionId?: string;
  input?: string | null;
};

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  world: {
    profile: string;
    profilePath: string;
    hermesHome: string;
    userData: string;
    vaultDir: string;
    vaultId: string;
    callsDir: string;
    gatewayPort: number;
    gatewayAddress: string;
    devServerUrl: string;
    tmpdir: string;
  };
  sessions: {
    telegram: typeof TELEGRAM;
    api: typeof API;
  };
  seed: typeof SEED;
  states: {
    telegramOpen: Sample | null;
    afterFirstReply: Sample | null;
    secondTurnRunning: Sample | null;
    afterStop: Sample | null;
    apiChat: Sample | null;
  };
  measurements: {
    firstSendAt?: number;
    framesArrivedAt?: number;
    replyPaintedAt?: number;
    screenshotBytes?: number;
    telegramTurnsBefore?: number;
    apiTurnsBefore?: number;
    telegramFooterOnlyTurns?: number;
    apiFooterOnlyTurns?: number;
  };
  gateway: {
    requests: RequestRow[];
    sessionsRequests: RequestRow[];
    messagesRequests: RequestRow[];
    modelRequests: RequestRow[];
    streamRequests: RequestRow[];
    refusals: (RequestRow & { status: number; body: unknown })[];
    createRequests: RequestRow[];
    restTranscripts: Record<string, { role: string; content: string }[]>;
    apiFrames: {
      at: number;
      name: string;
      payload: Record<string, unknown>;
    }[];
  };
  websocket: {
    upgrades: { at: number; path?: string; protocols?: string; offered?: string[] }[];
    connections: {
      at: number;
      path: string;
      protocols: string[];
      protocol: string;
      ticket: string | null;
      ticketMinted: boolean;
      framesIn: number;
      framesOut: number;
      closedAt: number | null;
    }[];
    framesIn: WsFrame[];
    framesOut: { at: number; type: string; session_id: string | null; payload: unknown }[];
    resume: WsFrame[];
    submit: WsFrame[];
    interrupt: WsFrame[];
    submitCounts: Record<string, number>;
    unexpectedTurns: { at: number; sessionId: string; count: number }[];
  };
  control: {
    requests: { at: number; verb: string; id: number; params: Record<string, unknown> }[];
    tickets: { at: number; ticket: string; params: Record<string, unknown> }[];
  };
  cliLog: { at: number; argv: string; hermesHome: string | null; raw: string }[];
  screenshots: string[];
  notes: string[];
};

type World = {
  dir: string;
  hermesHome: string;
  profileHome: string;
  userData: string;
  vaultDir: string;
  vaultId: string;
  binDir: string;
  callsDir: string;
  worldFile: string;
  mcpPorts: { local: number; invite: number };
  gatewayPort: number;
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
 * The throwaway world the app boots into: temp `HERMES_HOME` with the fake
 * profile, a stub `hermes` first on PATH that names the fake gateway endpoint,
 * a fake profile store, a throwaway vault the app auto-opens, the userData that
 * makes it auto-open, and a free loopback port for the combined REST/WS gateway.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-foreign-chat-"));
  const hermesHome = path.join(dir, "hermes-home");
  const profileHome = path.join(hermesHome, "profiles", PROFILE);
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const callsDir = path.join(dir, "hermes-calls");
  for (const made of [hermesHome, profileHome, userData, binDir, callsDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  const gatewayPort = await freePort();

  // The owner endpoint the app discovers with `hermes gateway ensure --json`.
  // `control_home` is the multiplexer root (where the control socket lives) and
  // `profile_id` the profile home it serves: a served secondary, so the app
  // must name the profile on `session.resume` — exactly the shape a real
  // multiplexed host answers.
  //
  // ONE LINE, deliberately: the app reads the last stdout line that starts with
  // `{` and parses it, the way the real CLI prints its JSON status.
  fs.writeFileSync(
    path.join(binDir, "endpoint.json"),
    `${JSON.stringify({
      state: "ready",
      endpoint: {
        api_origin: `http://127.0.0.1:${gatewayPort}`,
        instance_id: "gw-foreign-e2e",
        profile_id: profileHome,
        authority_epoch: 1,
        runtime_protocol: 1,
        capabilities: ["session-authority-v1"],
        control_home: hermesHome,
        supervisor: "e2e",
      },
    })}\n`,
    "utf8",
  );

  // The fake `hermes`, first on PATH: every invocation is recorded (argv and
  // the HERMES_HOME it ran with), and `gateway ensure --json` answers the ready
  // owner's endpoint. Nothing this rig spawns can reach a real install.
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    [
      "#!/bin/sh",
      "# The fake hermes this rig puts first on PATH.",
      'if [ -n "$LQ_FOREIGN_CALLS" ]; then',
      "  {",
      '    printf \'%s\\n\' "$*"',
      '    printf \'HERMES_HOME=%s\\n\' "${HERMES_HOME:-}"',
      '    printf \'GATEWAY_MULTIPLEX_PROFILES=%s\\n\' "${GATEWAY_MULTIPLEX_PROFILES:-}"',
      '  } > "$LQ_FOREIGN_CALLS/$(date +%s%N).$$"',
      "fi",
      'if [ "$1" = "gateway" ] && [ "$2" = "ensure" ]; then',
      '  cat "$(dirname "$0")/endpoint.json"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  // The minimal host config the attach path expects. `model:` is deliberate:
  // the host's model probe runs after the ready status and must not warn about
  // this rig's business.
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n",
    "utf8",
  );

  const created = await createVault(vaultDir, "Foreign chat rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

  // The same shape the other full-app rigs write: one real vault entry so the
  // app auto-opens it, and the profile the companion must attach to.
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

  const worldFile = path.join(dir, "world.json");
  fs.writeFileSync(
    worldFile,
    `${JSON.stringify(
      {
        dir,
        hermesHome,
        profileHome,
        userData,
        vaultDir,
        vaultId: vault.id,
        binDir,
        callsDir,
        profile: PROFILE,
        gatewayPort,
        sessions: { telegram: TELEGRAM, api: API },
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
    profileHome,
    userData,
    vaultDir,
    vaultId: vault.id,
    binDir,
    callsDir,
    worldFile,
    mcpPorts,
    gatewayPort,
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
  env.LQ_FOREIGN_WORLD = world.dir;
  env.LQ_FOREIGN_CALLS = world.callsDir;
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

/** How many times `needle` appears in `text` (0 when either is empty). */
function countIn(text: string | null | undefined, needle: string): number {
  if (!text || !needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
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

describe("a chat from another surface, continued in the real dock", () => {
  it(
    "continues the Telegram chat over the gateway WS (resume + submit, same session, stop reaches session.interrupt) while an api_server chat keeps the REST stream",
    { timeout: 240_000 },
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

        // ── the driver's own verdict, re-read from the artifact ────────────
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

        // ── the world really was throwaway and loopback-only ───────────────
        assert.equal(
          report.world.hermesHome,
          world.hermesHome,
          `the artifact's HERMES_HOME is ${report.world.hermesHome}, not this run's temp home`,
        );
        assert.ok(
          report.world.hermesHome.startsWith(os.tmpdir()),
          `HERMES_HOME is not under the temp dir: ${report.world.hermesHome}`,
        );
        assert.equal(
          report.world.profilePath,
          world.profileHome,
          `the artifact's profile home is ${report.world.profilePath}, not this run's temp profile`,
        );
        assert.equal(
          report.world.gatewayAddress,
          "127.0.0.1",
          `the fake gateway bound ${report.world.gatewayAddress}, not loopback`,
        );
        assert.equal(
          report.world.gatewayPort,
          world.gatewayPort,
          `the fake gateway bound port ${report.world.gatewayPort}, not the rig's ${world.gatewayPort}`,
        );

        // ── (1) the source data reached the renderer ──────────────────────
        const open = report.states.telegramOpen;
        assert.ok(open, "the artifact has no sample of the opened Telegram chat");
        assert.equal(
          open.telegramRow?.continuable,
          "true",
          `the Telegram sidebar row does not carry data-continuable="true": ${JSON.stringify(open.telegramRow)}`,
        );
        assert.equal(
          open.telegramRow?.source,
          "telegram",
          `the Telegram sidebar row does not carry data-source="telegram": ${JSON.stringify(open.telegramRow)}`,
        );
        assert.equal(
          open.apiRow?.continuable,
          null,
          `the api_server row was marked continuable: ${JSON.stringify(open.apiRow)}`,
        );
        assert.equal(
          open.headerContinuable,
          "true",
          `the dock header does not carry data-continuable: ${JSON.stringify(open.headerText)}`,
        );
        assert.equal(
          open.chipText,
          "Telegram",
          `the dock header's source chip reads ${JSON.stringify(open.chipText)}, not "Telegram"`,
        );
        assert.match(
          open.chipTitle ?? "",
          /Telegram/,
          `the source chip's title is ${JSON.stringify(open.chipTitle)}`,
        );
        assert.match(
          open.noteText ?? "",
          /Shared with Telegram/,
          `the composer's shared-conversation note reads ${JSON.stringify(open.noteText)}`,
        );
        assert.equal(
          open.noteSource,
          "telegram",
          `the composer note does not name the source: ${JSON.stringify(open.noteText)}`,
        );
        assert.equal(
          open.disabledControls.some(
            (control) =>
              control.testid === "chat-attachment-button" &&
              control.disabled === true &&
              /another surface/i.test(control.title ?? "") &&
              /attachment/i.test(control.title ?? ""),
          ),
          true,
          `no disabled, named attachment control on a continued chat: ${JSON.stringify(open.disabledControls)}`,
        );
        assert.equal(
          open.modelRepairPresent,
          false,
          "the retired-model repair banner appeared on a continued chat",
        );
        assert.equal(
          open.modelRepairUseDefault,
          false,
          "the retired-model repair action appeared on a continued chat",
        );
        assert.equal(
          open.transcript?.includes(TELEGRAM.transcript[0].content),
          true,
          `the Telegram transcript was not painted from the gateway's REST read: ${JSON.stringify(open.transcript)}`,
        );

        // ── (2) the WS-only reply painted in the live DOM ─────────────────
        const replied = report.states.afterFirstReply;
        assert.ok(replied, "the artifact has no sample after the first reply");
        assert.equal(
          replied.transcript?.includes(SEED.wsReply),
          true,
          `the WS-only reply never reached the live DOM: ${JSON.stringify(replied.transcript)}`,
        );
        assert.notEqual(
          replied.sendState,
          "stop",
          `the first turn never settled: ${JSON.stringify(replied.sendState)}`,
        );
        assert.equal(
          replied.rowLive,
          false,
          "the rail row still shows the turn running after the reply",
        );
        assert.equal(
          replied.error,
          null,
          `the continued turn painted an error: ${JSON.stringify(replied.error)}`,
        );
        // The reply and the message belong to ONE turn: a transport that
        // resolves at admission rather than at the turn's end settles the
        // pending turn first and paints the reply in a second, user-less turn.
        const telegramTurnsBefore = report.measurements.telegramTurnsBefore ?? 0;
        const addedTurns = replied.turns.slice(telegramTurnsBefore);
        const footerOnly = (turn: { text: string }): boolean =>
          turn.text.replace(/^Completed · .*$/m, "").trim().length === 0;
        const contentTurns = addedTurns.filter((turn) => !footerOnly(turn));
        assert.equal(
          addedTurns.length,
          1,
          `the continued send added ${addedTurns.length} turn(s): ${JSON.stringify(addedTurns)}`,
        );
        assert.equal(
          contentTurns.length,
          1,
          `the continued send added ${contentTurns.length} content turn(s): ${JSON.stringify(addedTurns)}`,
        );
        const continuedTurn =
          contentTurns.find((turn) => turn.text.includes(SEED.turnText)) ?? null;
        assert.ok(
          continuedTurn,
          `no content turn carries the operator's message: ${JSON.stringify(addedTurns)}`,
        );
        assert.equal(
          continuedTurn!.status,
          "completed",
          `the continued turn never completed: ${JSON.stringify(continuedTurn)}`,
        );
        assert.ok(
          continuedTurn!.text.includes(SEED.wsReply),
          `the turn carrying the message does not also carry the reply: ${JSON.stringify(continuedTurn)}`,
        );
        assert.equal(
          addedTurns.filter((turn) => turn.text.includes(SEED.wsReply)).length,
          1,
          `the reply is carried by more than one turn: ${JSON.stringify(addedTurns)}`,
        );
        assert.equal(
          addedTurns.filter((turn) => turn.text.includes(SEED.turnText)).length,
          1,
          `the message is carried by more than one turn: ${JSON.stringify(addedTurns)}`,
        );
        assert.equal(
          report.measurements.telegramFooterOnlyTurns,
          0,
          `the continued send added ${report.measurements.telegramFooterOnlyTurns} footer-only turn(s): ${JSON.stringify(addedTurns)}`,
        );
        // The authoritative whole reply (`assistant.final`, the same contract
        // the REST stream's `assistant.completed` has) is painted exactly once;
        // the narration before the tool travelled the socket, not the DOM after
        // the settled work log folds.
        const answerPaints = countIn(replied.transcript, SEED.wsReply);
        assert.equal(
          answerPaints,
          1,
          `the final answer appears ${answerPaints} time(s) in the dock: ${JSON.stringify(replied.transcript)}`,
        );
        const framesOut = report.websocket.framesOut;
        assert.ok(
          framesOut.some(
            (frame) =>
              frame.type === "message.delta" &&
              (frame.payload as { text?: string } | null)?.text === SEED.wsNarration,
          ),
          `the narration delta never travelled the socket: ${JSON.stringify(framesOut.map((frame) => frame.type))}`,
        );
        assert.ok(
          framesOut.some((frame) => frame.type === "tool.start"),
          "the tool.start frame never travelled the socket",
        );
        assert.ok(
          framesOut.some(
            (frame) =>
              frame.type === "message.complete" &&
              (frame.payload as { text?: string } | null)?.text === SEED.wsReply,
          ),
          "the whole reply never travelled the socket on message.complete",
        );

        // ── (3) the frames prove it, and the API door was never used ──────
        const ws = report.websocket;
        assert.ok(ws, "the artifact carries no WebSocket log");
        assert.ok(
          ws.connections.length > 0,
          "the app never opened the gateway WebSocket",
        );
        assert.equal(
          ws.connections[0].protocol,
          "hermes-gateway-v1",
          `the WebSocket did not negotiate hermes-gateway-v1: ${JSON.stringify(ws.connections[0].protocols)}`,
        );
        assert.equal(
          ws.connections[0].ticketMinted,
          true,
          `the WebSocket carried no ticket minted over the control socket: ${JSON.stringify(ws.connections[0])}`,
        );
        assert.ok(
          report.control.tickets.length > 0,
          `the control socket minted no ticket: ${JSON.stringify(report.control.requests)}`,
        );
        assert.ok(
          ws.framesOut.some((frame) => frame.type === "gateway.ready"),
          "the fake gateway never sent gateway.ready",
        );

        const resumed = ws.resume.find(
          (frame) => frame.params.session_id === TELEGRAM.id,
        );
        assert.ok(
          resumed,
          `session.resume never named the Telegram session ${TELEGRAM.id}: ${JSON.stringify(ws.resume.map((frame) => frame.params))}`,
        );
        assert.equal(
          resumed.params.profile,
          PROFILE,
          `session.resume did not name the served profile: ${JSON.stringify(resumed.params)}`,
        );

        const submitted = ws.submit.find(
          (frame) =>
            frame.params.session_id === TELEGRAM.id &&
            typeof frame.params.submission_id === "string" &&
            frame.params.submission_id.length > 0,
        );
        assert.ok(
          submitted,
          `prompt.submit never named the Telegram session with a submission_id: ${JSON.stringify(ws.submit.map((frame) => frame.params))}`,
        );

        assert.equal(
          report.gateway.refusals.filter(
            (refusal) => refusal.sessionId === TELEGRAM.id,
          ).length,
          0,
          `the API door was asked to write the Telegram chat and refused: ${JSON.stringify(report.gateway.refusals)}`,
        );
        assert.equal(
          report.gateway.streamRequests.filter(
            (request) => request.sessionId === TELEGRAM.id,
          ).length,
          0,
          `the Telegram chat was sent through the REST chat stream: ${JSON.stringify(report.gateway.streamRequests)}`,
        );

        // ── (4) the continuation is the same session, not a new chat ──────
        assert.equal(
          report.gateway.createRequests.length,
          0,
          `the app created a new session while continuing: ${JSON.stringify(report.gateway.createRequests)}`,
        );

        // ── (5) the dock's Stop reached session.interrupt ─────────────────
        const interrupted = ws.interrupt.find(
          (frame) => frame.session_id === TELEGRAM.id,
        );
        assert.ok(
          interrupted,
          `the dock's stop never reached session.interrupt for the Telegram session: ${JSON.stringify(ws.interrupt.map((frame) => frame.params))}`,
        );
        assert.ok(
          (ws.submitCounts[TELEGRAM.id] ?? 0) >= 2,
          `the second turn was never admitted: ${JSON.stringify(ws.submitCounts)}`,
        );
        assert.notEqual(
          report.states.afterStop?.sendState,
          "stop",
          `the stopped turn never settled: ${JSON.stringify(report.states.afterStop)}`,
        );

        // ── (6) the api_server chat kept the API transport ────────────────
        assert.ok(
          report.gateway.streamRequests.some(
            (request) => request.sessionId === API.id,
          ),
          `the api_server chat never hit the fake API's chat stream: ${JSON.stringify(report.gateway.streamRequests)}`,
        );
        assert.equal(
          report.states.apiChat?.transcript?.includes(SEED.apiReply),
          true,
          `the api_server chat's reply never painted: ${JSON.stringify(report.states.apiChat?.transcript)}`,
        );
        assert.equal(
          ws.submit.filter((frame) => frame.params.session_id === API.id).length,
          0,
          `the api_server chat was rerouted through the WebSocket: ${JSON.stringify(ws.submit.map((frame) => frame.params.session_id))}`,
        );
        assert.equal(
          ws.unexpectedTurns.length,
          0,
          `an unexpected chat travelled the WebSocket: ${JSON.stringify(ws.unexpectedTurns)}`,
        );
        // The REST comparison is the dock's known-good path: a real gateway
        // answers over time, so its send adds one content turn and it has the
        // same narration-delta → tool → authoritative-whole-reply shape.
        const apiTurnsBefore = report.measurements.apiTurnsBefore ?? 0;
        const apiTurns = report.states.apiChat?.turns ?? [];
        const apiAddedTurns = apiTurns.slice(apiTurnsBefore);
        const apiContentTurns = apiAddedTurns.filter(
          (turn) => turn.text.replace(/^Completed · .*$/m, "").trim().length > 0,
        );
        assert.equal(
          apiAddedTurns.length,
          1,
          `the api_server send added ${apiAddedTurns.length} turn(s): ${JSON.stringify(apiAddedTurns)}`,
        );
        assert.equal(
          apiContentTurns.length,
          1,
          `the api_server send added ${apiContentTurns.length} content turn(s): ${JSON.stringify(apiAddedTurns)}`,
        );
        assert.ok(
          apiContentTurns[0].text.includes(SEED.apiTurnText),
          `the added api_server turn is not the one carrying the message: ${JSON.stringify(apiContentTurns[0])}`,
        );
        const apiTranscript = report.states.apiChat?.transcript;
        assert.equal(
          countIn(apiTranscript, SEED.apiReply),
          1,
          `the api_server answer appears ${countIn(apiTranscript, SEED.apiReply)} time(s): ${JSON.stringify(apiTranscript)}`,
        );
        const apiFrames = report.gateway.apiFrames ?? [];
        assert.ok(
          apiFrames.some(
            (frame) =>
              frame.name === "assistant.delta" &&
              (frame.payload as { text?: string } | null)?.text === SEED.apiNarration,
          ),
          `the api_server narration delta never travelled the REST stream: ${JSON.stringify(apiFrames.map((frame) => frame.name))}`,
        );
        assert.ok(
          apiFrames.some(
            (frame) =>
              frame.name === "assistant.completed" &&
              (frame.payload as { content?: string } | null)?.content ===
                SEED.apiReply,
          ),
          "the api_server authoritative answer never travelled the REST stream",
        );
        assert.ok(
          apiFrames.some((frame) => frame.name === "tool.started"),
          "the api_server tool call never travelled the REST stream",
        );
        assert.ok(
          apiFrames.some((frame) => frame.name === "run.completed"),
          "the api_server turn never carried its terminal frame",
        );

        // ── (2 again) the reply is WS-only, not a REST row ────────────────
        const served = report.gateway.restTranscripts[TELEGRAM.id] ?? [];
        assert.ok(
          served.length > 0,
          "the fake gateway never served a Telegram REST transcript",
        );
        assert.equal(
          served.some(
            (row) =>
              String(row.content).includes(SEED.wsReplyMarker) ||
              String(row.content).includes(SEED.wsNarration),
          ),
          false,
          `the fake REST transcript carried the narration or the WS-only reply: ${JSON.stringify(served)}`,
        );
        assert.ok(
          report.gateway.messagesRequests.some(
            (request) => request.sessionId === TELEGRAM.id,
          ),
          `the app never read the Telegram transcript over REST: ${JSON.stringify(report.gateway.messagesRequests)}`,
        );

        // ── (8) the app ran the stub, in the temp home ────────────────────
        assert.ok(
          report.cliLog.length > 0,
          "the stub hermes recorded no invocation — the app ran a real CLI",
        );
        const ensure = report.cliLog.find((call) =>
          /^gateway ensure\b/.test(call.argv),
        );
        assert.ok(
          ensure,
          `the app never ran \`hermes gateway ensure\` through the stub: ${JSON.stringify(report.cliLog)}`,
        );
        assert.equal(
          ensure?.hermesHome,
          world.profileHome,
          `the CLI ran with HERMES_HOME=${JSON.stringify(ensure?.hermesHome)}, not the temp profile home`,
        );
        for (const call of report.cliLog) {
          assert.ok(
            call.hermesHome === null || call.hermesHome.startsWith(world.dir),
            `a hermes invocation escaped the temp world: ${JSON.stringify(call)}`,
          );
        }

        // ── (7) the picture is this rig's own capture of the shipped dock ──
        const screenshotWhere = path.relative(desktopRoot, SCREENSHOT);
        assert.equal(
          fs.existsSync(SCREENSHOT),
          true,
          `the driver wrote no screenshot at ${screenshotWhere}`,
        );
        const bytes = fs.statSync(SCREENSHOT).size;
        assert.ok(
          bytes > SCREENSHOT_MIN_BYTES,
          `${screenshotWhere} is ${bytes} bytes — a blank or failed capture was written instead of the dock`,
        );
        assert.deepEqual(
          report.screenshots ?? [],
          ["foreign-chat.png"],
          `the artifact's screenshot list is ${JSON.stringify(report.screenshots)}`,
        );
        assert.ok(
          Date.now() - fs.statSync(SCREENSHOT).mtimeMs < 240_000,
          `${screenshotWhere} is stale (older than this run)`,
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
