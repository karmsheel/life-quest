import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createVault } from "@lifequest/vault-core";

/**
 * The cold-start restore, end to end, on the REAL main process, preload and
 * renderer.
 *
 * A chat's tab is remembered across a quit: the strip restores a chat with its
 * tab in front. The operator's report is that the thread beside it stays blank
 * — "Ask Hermes" — until they click another tab and come back. This suite builds
 * a hermetic world (a throwaway vault, a temp HERMES_HOME with a stub `hermes`
 * first on PATH, a userData directory, and a stub Hermes host gateway serving
 * exactly one chat), then boots that app twice over the same profile:
 *
 *   seed    the fixture launch: first launch, no memory. The dock lands on the
 *           gateway's one chat when the landing survives; the phase makes sure
 *           the profile remembers that chat (strip + lastSessionId) and flushes
 *           storage so the restart has the operator's state. On unfixed code
 *           the first launch is broken by the same race and remembers nothing,
 *           so the phase writes the two keys directly and records in
 *           `observations.seededStripDirectly` that it did.
 *   verify  the restart: the strip restores, the tab is in front, and the
 *           transcript must be on screen WITHOUT any interaction. Unfixed, this
 *           is the reported blank thread; the gateway request log proves the
 *           messages call was never made during the launch.
 *
 * The renderer is served from ONE loopback origin held by this test for both
 * processes: localStorage is per origin, so a different port for the second
 * launch would make "the restart forgot everything" pass for the wrong reason.
 *
 * Run through the bench wrapper, which puts this checkout's dev server up and
 * builds `dist-electron/main.js` (the dev bundle keeps the e2e seam):
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/chat-startup-restore-e2e.test.ts
 *
 * Artifacts: `e2e/artifacts/chat-startup-restore-{seed,verify}.json` per phase,
 * their screenshots, merged into `e2e/artifacts/chat-startup-restore.json`.
 */

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const RIG = path.join(desktopRoot, "e2e/chat-startup-restore.electron.mjs");
const REPORT = path.join(ARTIFACTS, "chat-startup-restore.json");
const PHASES = ["seed", "verify"] as const;

/** The chat the stub gateway serves: exactly one, with a two-message transcript. */
const CHAT = {
  id: "chat-alpha",
  title: "Garden planning",
  preview: "How much water does the garden need this week?",
  userText: "How much water does the garden need this week?",
  assistantText:
    "Less than last week: give the tomatoes a deep soak on Tuesday and leave the rest alone.",
};

/** The profile no real Hermes install has; `recent.json` names it. */
const PROFILE = "lq-startup-restore-e2e";

type World = {
  dir: string;
  hermesHome: string;
  userData: string;
  vaultDir: string;
  binDir: string;
  worldFile: string;
  mcpPorts: { local: number; invite: number };
};

type Check = { label: string; pass: boolean; detail: string | null };

type PhaseReport = {
  phase: string;
  ranAt: string;
  world: Record<string, unknown>;
  rendererUrl: string;
  chat: typeof CHAT;
  marks: Array<{ ms: number; label: string }>;
  states: Record<string, unknown>;
  observations?: Record<string, unknown>;
  gateway: {
    logFile: string | null;
    requests: Array<{ at: number; method: string; path: string }>;
    sessionsListed: number;
    messagesRead: number;
  };
  screenshots: string[];
  checks: Check[];
  failures: string[];
  pass: boolean;
};

type PhaseOutcome = {
  phase: string;
  code: number | null;
  stdout: string;
  stderr: string;
  report: PhaseReport | null;
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * The built renderer, served from one fixed origin for both phases.
 *
 * `isDev` is true for anything unpackaged, so the app always loads a URL. Serving
 * the built assets is therefore how the real product's boot is measured without
 * also measuring Vite — and holding the server here, rather than in each phase,
 * is what keeps the renderer origin (and therefore localStorage) identical.
 */
function serveDist() {
  const dist = path.join(desktopRoot, "dist");
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * The throwaway world the app boots into: a temp `HERMES_HOME`, a throwaway vault
 * the app auto-opens, the userData that makes it auto-open, and a fake `hermes`
 * first on PATH so no real CLI is ever run.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-chat-startup-restore-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  const profileDir = path.join(hermesHome, "profiles", PROFILE);
  for (const made of [hermesHome, profileDir, userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  // A fake `hermes`, first on PATH: every CLI call the app may make exits 0 and
  // none of them reaches a real install. `gateway` fails, the way a host that
  // is already serving the profile would be reported if the app tried to
  // restart it — the attach probe is what makes this leg attached.
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(stub, "#!/bin/sh\ncase \"$1\" in\n  gateway) exit 1 ;;\nesac\nexit 0\n", {
    mode: 0o755,
  });

  // The minimal host config the attach path expects; `model` is deliberate so
  // the host's model probe does not warn about this rig's business.
  fs.writeFileSync(path.join(hermesHome, "config.yaml"), "model:\n  default: some-model\n", "utf8");

  const created = await createVault(vaultDir, "Chat startup restore rig");
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
        mcpPorts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { dir, hermesHome, userData, vaultDir, binDir, worldFile, mcpPorts };
}

/** Run one phase as its own Electron process against the same world and profile. */
function runPhase(world: World, rendererUrl: string, phase: string): Promise<PhaseOutcome> {
  const reportFile = path.join(ARTIFACTS, `chat-startup-restore-${phase}.json`);
  fs.rmSync(reportFile, { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = world.hermesHome;
  // The fake CLI must resolve first: this is the only thing that keeps the app
  // from running the operator's real `hermes`.
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL = rendererUrl;
  env.LQ_STARTUP_URL = rendererUrl;
  env.LQ_STARTUP_WORLD = world.dir;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [RIG, `--phase=${phase}`],
      { cwd: desktopRoot, timeout: 240_000, env },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? (error.code as number) : null;
        const report = fs.existsSync(reportFile)
          ? (JSON.parse(fs.readFileSync(reportFile, "utf8")) as PhaseReport)
          : null;
        resolve({
          phase,
          code:
            error && typeof error.code !== "number"
              ? null
              : (code ?? (error ? 1 : 0)),
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          report,
        });
      },
    );
  });
}

/** The tail of a stream, for failure messages that have to stay readable. */
function tail(text: string, limit = 2_500): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function assertPhaseReport(outcome: PhaseOutcome): PhaseReport {
  const where = path.relative(desktopRoot, path.join(ARTIFACTS, `chat-startup-restore-${outcome.phase}.json`));
  assert.ok(
    outcome.report,
    `the ${outcome.phase} phase wrote no ${where} (exit ${outcome.code}). stderr: ${tail(outcome.stderr)}`,
  );
  const report = outcome.report as PhaseReport;
  assert.deepEqual(
    report.failures,
    [],
    `the ${outcome.phase} phase failed inside the rig: ${JSON.stringify(report.failures, null, 2)}`,
  );
  assert.equal(report.pass, true, `the ${outcome.phase} phase reported failure`);
  assert.equal(
    outcome.code,
    0,
    `the ${outcome.phase} phase exited ${outcome.code}: ${tail(outcome.stderr)}`,
  );
  return report;
}

describe("cold-start restore (a remembered chat paints its transcript)", () => {
  it("restores the tab AND the transcript on the restart, but never leaves the thread blank", async (t) => {
    for (const needed of ["dist-electron/main.js", "dist/index.html"]) {
      if (!fs.existsSync(path.join(desktopRoot, needed))) {
        t.skip(`no build at ${needed} — run \`npm run build\` to include this e2e`);
        return;
      }
    }

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const world = await buildWorld();
    const server = await serveDist();
    const rendererUrl = `http://127.0.0.1:${server.port}`;

    const merged: {
      ranAt: string;
      world: Record<string, unknown>;
      rendererUrl: string;
      phases: Record<string, unknown>;
      pass: boolean;
    } = {
      ranAt: new Date().toISOString(),
      world: {
        dir: world.dir,
        hermesHome: world.hermesHome,
        userData: world.userData,
        profile: PROFILE,
      },
      rendererUrl,
      phases: {},
      pass: false,
    };

    try {
      // Both phases run even if the first fails: the control's evidence is as
      // much a part of the artifact as the restart's.
      const outcomes: PhaseOutcome[] = [];
      for (const phase of PHASES) {
        const outcome = await runPhase(world, rendererUrl, phase);
        outcomes.push(outcome);
        merged.phases[phase] = {
          exitCode: outcome.code,
          report: outcome.report,
          stderr: outcome.report ? undefined : tail(outcome.stderr),
        };
        fs.writeFileSync(REPORT, `${JSON.stringify(merged, null, 2)}\n`);
      }

      const [seed, verify] = outcomes;
      const seedReport = assertPhaseReport(seed);
      const verifyReport = assertPhaseReport(verify);

      // ── The fixture: the restart must actually have something remembered ───
      const seedChecks = new Map(seedReport.checks.map((check) => [check.label, check]));
      assert.equal(
        seedChecks.get("the restart's remembered strip is in the profile")?.pass,
        true,
        `the fixture launch did not leave a remembered strip: ${JSON.stringify(
          seedReport.states,
          null,
          2,
        )}`,
      );
      // The first launch on unfixed code is broken by the same mount race (no
      // transcript read, nothing remembered), so it is recorded as an
      // observation rather than gated on: the reported fault, and the assertion
      // this rig exists for, is the restart below.
      const firstLaunch = (seedReport.observations as Record<string, unknown> | undefined)
        ?.firstLaunch;
      assert.ok(
        firstLaunch && typeof firstLaunch === "object",
        "the fixture launch recorded no first-launch observation",
      );

      // ── The restart is the reported bug: strip restored AND transcript read ─
      const verifyChecks = new Map(verifyReport.checks.map((check) => [check.label, check]));
      for (const label of [
        "the restart found the remembered strip in the profile",
        "the remembered chat is the chat in the tab strip",
        "the restored tab is the dialog in front",
        "the launch read the restored chat's transcript before any interaction",
        "the restored conversation is on screen, not the empty slate",
      ]) {
        assert.equal(
          verifyChecks.get(label)?.pass,
          true,
          `the restart failed "${label}": ${JSON.stringify(
            verifyChecks.get(label)?.detail ?? verifyReport.states,
            null,
            2,
          )}`,
        );
      }
      assert.ok(
        verifyReport.gateway.messagesRead > 0,
        `the restart never read the chat's transcript: the gateway saw ${JSON.stringify(
          verifyReport.gateway.requests,
        )}`,
      );
      assert.ok(
        verifyReport.gateway.requests.some((request) =>
          request.path.endsWith(`/${CHAT.id}/messages`),
        ),
        `the restart's gateway log has no GET /messages for ${CHAT.id}`,
      );

      merged.pass = true;
      fs.writeFileSync(REPORT, `${JSON.stringify(merged, null, 2)}\n`);
    } finally {
      await server.close();
    }
  });
});
