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
 * The stale-chat repair, end to end, through the REAL main process, preload
 * bridge and renderer — the operator's report that every EXISTING chat stopped
 * answering while a brand-new one worked.
 *
 * WHY THIS RIG EXISTS
 *
 * Hermes locks a chat's session to the model it was created with and ignores the
 * model a turn names. When the provider retires that model, every turn in the
 * old chat fails before a model call, while a new chat (created on the current
 * default) answers. The fix: the dock shows a repair notice for the active chat
 * whose gateway model is absent from `GET /api/model/options`, and one click
 * persists the profile's working default through the gateway's own
 * `POST /api/sessions/{id}/model`.
 *
 * This file builds a throwaway world (temp `HERMES_HOME` with profile
 * `lq-stale-model-e2e`, a throwaway vault the app auto-opens, a userData dir,
 * and a stub `hermes` first on PATH), runs `e2e/stale-chat-model.electron.mjs`
 * in Electron against it, and then judges the artifact from outside the app: the
 * gateway's own wire logs are re-read, so a banner that merely hid itself cannot
 * pass as a repaired chat.
 *
 * The world's one chat is locked to `retired/old-model:free` while the catalog
 * offers only `live/model`, which is exactly the reported state. The stub
 * gateway is stateful the way a real one is: the session list reports the new
 * model once the lock is accepted, and the chat only answers once the lock has
 * moved — so a per-turn model override cannot fake the fix.
 *
 * THE WAYS THIS COULD PASS WHILE PROVING NOTHING, WRITTEN DOWN FIRST
 *
 *   1. The app never attaches: the report still says "the app attached" false and
 *      the rig fails with that sentence, not with a silently green result.
 *   2. The notice never appears (the banner selector drifted, the catalog did not
 *      load, the retired model was never compared): the artifact's before-repair
 *      sample is asserted, and the banner is required visible with a real DOM box.
 *   2b. The notice scrolls out of sight on a long chat: it must be dock chrome
 *      inside the dock's footer above the composer, and the judge fails if it is
 *      inside `.chat-panel__body` (the thread's scroll port).
 *   3. The click only hides the banner locally: `model-lock-requests.log` must
 *      hold EXACTLY ONE line whose parsed body is
 *      `{"model":"live/model","provider":"nous"}` addressed to the chat's session.
 *   4. The banner disappears for another reason: only accepted together with the
 *      lock, and the after-repair sample is in the artifact.
 *   5. The reply is the fixture's own text: the fixture says "Last month closed
 *      even.", the turn's answer is "The ledger is settled, sir." — only the
 *      stream can paint the latter.
 *   6. The turn never reaches the gateway: `chat-stream-requests.log` must hold
 *      exactly one line whose body carries the typed text in input/instructions.
 *   7. The per-turn model override faked the repair: the stub only answers once
 *      the session lock has moved, and the judge re-reads the served session
 *      model from the artifact.
 *   8. The screenshot is stale/blank or of another window: it is the rig's own
 *      `capturePage()` after a forced repaint, >10 KB on disk.
 *   9. The test passes by skipping: the dev server must be up (lifequest-e2e
 *      puts it there) and `dist-electron/main.js` must exist; a skip is not
 *      accepted as evidence.
 *  10. The world leaks into the operator's machine: the whole world is a temp
 *      directory removed in `finally`, the profile name is one no real install
 *      has, the fake `hermes` is first on PATH, the MCP doors are moved off the
 *      product ports, and userData/vault are throwaway.
 *
 * Run through the bench wrapper, which puts this checkout's dev server up and
 * builds `dist-electron/main.js` (the dev bundle keeps the e2e seam):
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/stale-chat-model-e2e.test.ts
 *
 * Artifacts: `e2e/artifacts/stale-chat-model.json` and
 * `e2e/artifacts/stale-chat-model.png` (plus a before-repair capture of the
 * notice); the wire logs live in the run's temp world and are copied into the
 * report.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/stale-chat-model.electron.mjs");
const REPORT = path.join(ARTIFACTS, "stale-chat-model.json");
const SCREENSHOT = path.join(ARTIFACTS, "stale-chat-model.png");
const BEFORE_SCREENSHOT = path.join(ARTIFACTS, "stale-chat-model-before.png");

/** The Vite dev server, without which the app's window has nothing to load. */
const DEV_PORT = 5173;

/**
 * The one chat the stub gateway serves: an existing chat whose session lock is
 * still on the model the provider has retired.
 */
const CHAT = {
  id: "chat-stale",
  title: "Garden ledger",
  preview: "Did the ledger balance?",
  userText: "Did the ledger balance?",
  assistantText: "Last month closed even.",
  retiredModel: "retired/old-model:free",
};

/** The profile's current model: the only one the catalog offers. */
const DEFAULT_MODEL = "live/model";
const DEFAULT_PROVIDER = "nous";

/** The operator's next turn, and the answer the repaired chat must paint. */
const TURN = {
  userText: "Did the ledger settle?",
  reply: "The ledger is settled, sir.",
};

/** The profile no real Hermes install has; `recent.json` names it. */
const PROFILE = "lq-stale-model-e2e";

const MIN_SCREENSHOT_BYTES = 10 * 1024;

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

type Check = { label: string; pass: boolean; detail: string | null };

type BannerSample = {
  present: boolean;
  visible: boolean;
  text: string;
  /** The dock chrome the notice hangs from (`[class*="footer"]`), or null. */
  hostClass: string | null;
  /** The notice sits in the dock footer above the composer. */
  inFooter: boolean;
  /** The notice is inside `.chat-panel__body`, the thread's scroll port (a bug). */
  insideScrollBody: boolean;
  button: boolean;
  buttonVisible: boolean;
  buttonLabel: string;
  buttonDisabled: boolean | null;
};

type Sample = {
  activeTab: string | null;
  heading: string;
  emptySlate: string;
  railLabels: string[];
  banner: BannerSample;
  messages: Array<{ role: string | null; content: string }>;
  transcript: string;
  composer: { present: boolean; disabled: boolean | null; ariaLabel: string | null; value: string | null };
};

type WireRequest = { at: number; path: string; body: Record<string, unknown> };

type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  world: Record<string, unknown>;
  rendererUrl: string;
  states: {
    beforeRepair?: Sample;
    afterRepair?: Sample;
    answered?: Sample;
  };
  observations?: {
    openedBy?: string;
    contractWording?: {
      bannerText: string;
      bannerNamesFullModelId: boolean;
      bannerNamesShortModelLabel: boolean;
      buttonLabel: string;
      buttonNamesDefaultShortLabel: boolean;
      buttonNamesFullDefaultId: boolean;
      catalogRequested: boolean;
      bannerHost: string;
    };
    bannerHost?: string;
    bannerPlacement?: {
      hostClass: string | null;
      inFooter: boolean;
      insideScrollBody: boolean;
    };
    afterRepair?: {
      bannerGone: boolean;
      modelLockRequests: number;
      modelLockBody: unknown;
      sessionModelServed: string;
    };
    afterTurn?: {
      bannerStillGone: boolean;
      sessionModelServed: string;
    };
    sendGesture?: string;
  };
  contract?: Record<string, unknown>;
  gateway: {
    sessionsListed: number;
    messagesRead: number;
    modelLockRequests: WireRequest[];
    streamRequests: WireRequest[];
    sessionModelServedAfterLock: string;
    transcriptServed: Array<{ role: string; content: string }>;
    modelLockLogLines: unknown[];
    streamLogLines: unknown[];
  } | null;
  screenshots: string[];
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-stale-chat-model-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const profileDir = path.join(hermesHome, "profiles", PROFILE);
  for (const made of [hermesHome, profileDir, userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  // A fake `hermes`, first on PATH: every CLI call the app may make exits 0 and
  // none of them reaches a real install. `gateway` fails, the way a host that is
  // already serving the profile would be reported if the app tried to restart
  // it — the attach probe against the rig's stub is what makes this leg attached.
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, '#!/bin/sh\ncase "$1" in\n  gateway) exit 1 ;;\nesac\nexit 0\n', {
    mode: 0o755,
  });

  // The minimal host config the attach path expects. The default model matches
  // the catalog the stub serves so the host's own model probe has nothing to
  // warn about: the retired lock under test belongs to the CHAT, not the
  // profile, which is the whole point of the report.
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    `model:\n  default: ${DEFAULT_MODEL}\n`,
    "utf8",
  );

  const created = await createVault(vaultDir, "Stale chat model rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

  // One real vault entry so the app auto-opens it, and the profile the companion
  // must attach to. This file is the app's only memory of which vault to reopen.
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

  // The app's MCP doors move off the product ports, so the rig never fights the
  // bench app for 8643/8646.
  const mcpPorts = { local: await freePort(), invite: await freePort() };

  // What the driver needs to know that cannot be inferred: the stale chat, the
  // working default, the operator's next turn, the profile and the fake CLI.
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
        chat: CHAT,
        defaultModel: DEFAULT_MODEL,
        defaultProvider: DEFAULT_PROVIDER,
        turn: TURN,
        mcpPorts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { dir, hermesHome, userData, vaultDir, vaultId: vault.id, binDir, worldFile, mcpPorts };
}

/** Run the Electron driver against one world, with the app's spawn contract. */
function runDriver(world: World): Promise<DriverOutcome> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = world.hermesHome;
  // The fake CLI must resolve first: this is the only thing that keeps the app
  // from running the operator's real `hermes`.
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${DEV_PORT}`;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  env.LQ_STALE_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 200_000, env },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? (error.code as number) : 0;
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

function readArtifact(outcome: DriverOutcome): Report {
  const where = path.relative(desktopRoot, REPORT);
  assert.equal(
    fs.existsSync(REPORT),
    true,
    `the driver wrote no ${where} (exit ${outcome.code}). stderr: ${tail(outcome.stderr)}`,
  );
  try {
    return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
  } catch (error) {
    assert.fail(
      `the driver's ${where} is not JSON: ${error instanceof Error ? error.message : String(error)}; stderr: ${tail(outcome.stderr)}`,
    );
  }
}

/** The wire body of the turn: `input` is what the gateway receives. */
function carriedText(body: Record<string, unknown> | null): string {
  if (!body) return "";
  const input = typeof body.input === "string" ? body.input : "";
  const instructions = JSON.stringify(body.instructions ?? {});
  return `${input}\n${instructions}`;
}

describe("a stale chat model is repaired and answers (the retired-lock chat)", () => {
  it(
    "shows the repair notice for the retired model, persists the default through the gateway lock, and answers the next turn",
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
      fs.rmSync(BEFORE_SCREENSHOT, { force: true });

      const world = await buildWorld();
      try {
        const outcome = await runDriver(world);
        const report = readArtifact(outcome);

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

        // ── 1. the app attached and the existing chat is open ─────────────
        const before = report.states?.beforeRepair;
        assert.ok(before, "the artifact carries no before-repair sample");
        assert.equal(
          before.activeTab,
          CHAT.title,
          `the dock's open tab was ${JSON.stringify(before.activeTab)}, not ${JSON.stringify(CHAT.title)}; screen: ${JSON.stringify(before)}`,
        );
        assert.equal(
          before.heading,
          CHAT.title,
          `the dock's thread header was ${JSON.stringify(before.heading)}; screen: ${JSON.stringify(before)}`,
        );
        assert.equal(
          before.railLabels.includes(CHAT.title),
          true,
          `the sidebar did not list ${JSON.stringify(CHAT.title)}: ${JSON.stringify(before.railLabels)}`,
        );
        assert.ok(
          (report.gateway?.messagesRead ?? 0) > 0,
          `the app never read the existing chat's transcript: ${JSON.stringify(report.gateway)}`,
        );

        // ── 2. the repair notice names the retired model ───────────────────
        assert.equal(
          before.banner.present,
          true,
          `no [data-testid="chat-model-repair"] was rendered: ${JSON.stringify(before.banner)}`,
        );
        assert.equal(
          before.banner.visible,
          true,
          `the repair notice was in the DOM but not on screen: ${JSON.stringify(before.banner)}`,
        );
        assert.equal(
          before.banner.buttonVisible,
          true,
          `the repair notice offered no clickable default: ${JSON.stringify(before.banner)}`,
        );
        const wording = report.observations?.contractWording;
        assert.ok(wording, "the artifact carries no notice wording");
        // The final copy contract: the full retired id in the notice, and the
        // full default id on the one-click.
        assert.equal(
          wording.bannerNamesFullModelId,
          true,
          `the notice did not name the full retired id ${JSON.stringify(CHAT.retiredModel)}: ${JSON.stringify(wording.bannerText)}`,
        );
        assert.equal(
          wording.buttonLabel,
          `Use ${DEFAULT_MODEL}`,
          `the one-click was labelled ${JSON.stringify(wording.buttonLabel)}, not ${JSON.stringify(`Use ${DEFAULT_MODEL}`)}`,
        );
        // The placement regression guard: the notice is dock chrome above the
        // composer, under the thread's scroll port — not inside the port itself,
        // where a long chat would scroll the explanation out of sight.
        assert.equal(
          before.banner.inFooter,
          true,
          `the notice was not inside the dock footer above the composer: ${JSON.stringify(before.banner)}`,
        );
        assert.equal(
          before.banner.insideScrollBody,
          false,
          `the notice was inside .chat-panel__body (the thread's scroll port), so a long chat scrolls it out of sight: ${JSON.stringify(before.banner)}`,
        );
        assert.equal(
          report.observations?.bannerHost,
          "footer",
          `the artifact recorded bannerHost ${JSON.stringify(report.observations?.bannerHost)}, not "footer": ${JSON.stringify(report.observations?.bannerPlacement)}`,
        );

        // ── 3. one click writes EXACTLY the profile default's lock ────────
        const lockRequests = report.gateway?.modelLockRequests ?? [];
        assert.equal(
          lockRequests.length,
          1,
          `the gateway saw ${lockRequests.length} model-lock request(s), expected exactly one: ${JSON.stringify(lockRequests)}`,
        );
        assert.deepEqual(
          lockRequests[0]?.body,
          { model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER },
          `the model lock body was ${JSON.stringify(lockRequests[0]?.body)}`,
        );
        assert.equal(
          lockRequests[0]?.path?.endsWith(`/api/sessions/${CHAT.id}/model`),
          true,
          `the model lock went to ${JSON.stringify(lockRequests[0]?.path)}, not ${CHAT.id}'s session`,
        );
        const lockLines = report.gateway?.modelLockLogLines ?? [];
        assert.equal(
          lockLines.length,
          1,
          `model-lock-requests.log held ${lockLines.length} line(s), expected exactly one: ${JSON.stringify(lockLines)}`,
        );
        assert.deepEqual(
          lockLines[0],
          { model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER },
          `the persisted line was ${JSON.stringify(lockLines[0])}`,
        );
        const afterRepair = report.states?.afterRepair;
        assert.ok(afterRepair, "the artifact carries no after-repair sample");
        assert.equal(
          afterRepair.banner.visible,
          false,
          `the repair notice was still on screen after the lock: ${JSON.stringify(afterRepair.banner)}`,
        );

        // ── 4. the repaired chat answers the next turn ────────────────────
        const streamRequests = report.gateway?.streamRequests ?? [];
        assert.equal(
          streamRequests.length,
          1,
          `the gateway saw ${streamRequests.length} chat-stream request(s), expected exactly one: ${JSON.stringify(streamRequests)}`,
        );
        assert.ok(
          carriedText(streamRequests[0]?.body ?? null).includes(TURN.userText),
          `the turn's request body did not carry the typed text: ${JSON.stringify(streamRequests[0]?.body)}`,
        );
        const streamLines = report.gateway?.streamLogLines ?? [];
        assert.equal(
          streamLines.length,
          1,
          `chat-stream-requests.log held ${streamLines.length} line(s), expected exactly one: ${JSON.stringify(streamLines)}`,
        );
        const answered = report.states?.answered;
        assert.ok(answered, "the artifact carries no answered sample");
        assert.equal(
          answered.messages.some(
            (message) => message.role === "assistant" && message.content.includes(TURN.reply),
          ),
          true,
          `the repaired chat never painted ${JSON.stringify(TURN.reply)}: ${JSON.stringify(answered.messages)}`,
        );
        assert.equal(
          report.gateway?.sessionModelServedAfterLock,
          DEFAULT_MODEL,
          `the gateway still served the retired lock after repair, so the answer is not evidence: ${JSON.stringify(report.gateway?.sessionModelServedAfterLock)}`,
        );

        // ── 5. the picture is this rig's own capture of the shipped screen ─
        const screenshotWhere = path.relative(desktopRoot, SCREENSHOT);
        assert.equal(
          fs.existsSync(SCREENSHOT),
          true,
          `the driver wrote no screenshot at ${screenshotWhere}`,
        );
        const bytes = fs.statSync(SCREENSHOT).size;
        assert.ok(
          bytes > MIN_SCREENSHOT_BYTES,
          `${screenshotWhere} is ${bytes} bytes — a blank or failed capture was written instead of the answered chat`,
        );
        assert.equal(
          (report.screenshots ?? []).includes("stale-chat-model.png"),
          true,
          `the artifact's screenshot list is ${JSON.stringify(report.screenshots)}`,
        );

        // ── a compact, human-readable summary of what the run proved ──────
        t.diagnostic(`stale-chat-model: PASS (${report.checks.length}/${report.checks.length} checks)`);
        t.diagnostic(
          `  chat: ${JSON.stringify(CHAT.title)} — gateway model ${JSON.stringify(CHAT.retiredModel)} absent from the catalog`,
        );
        t.diagnostic(
          `  notice: ${JSON.stringify(wording.bannerText)} — button ${JSON.stringify(wording.buttonLabel)}`,
        );
        t.diagnostic(
          `  placement: host=${JSON.stringify(report.observations?.bannerHost)} (${JSON.stringify(report.observations?.bannerPlacement?.hostClass)}) — inside scroll body: ${JSON.stringify(before.banner.insideScrollBody)}`,
        );
        t.diagnostic(
          `  lock: POST ${lockRequests[0]?.path} body ${JSON.stringify(lockRequests[0]?.body)} — notice gone after refresh`,
        );
        t.diagnostic(
          `  turn: ${JSON.stringify(TURN.userText)} → ${JSON.stringify(TURN.reply)} (${report.observations?.sendGesture ?? "unknown gesture"})`,
        );
        t.diagnostic(`  screenshot: ${screenshotWhere} (${bytes} bytes)`);
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
