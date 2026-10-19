/**
 * The wired-app acceptance run for Reviews: the REAL LifeQuest main process, the
 * REAL preload, and the REAL renderer, opened on the operator's own vault.
 *
 * The other rigs prove the pieces — `review.electron.mjs` drives the page against
 * a recording stub, `tests/review-snapshot-e2e.test.ts` drives the engine against
 * a real vault on disk. This one proves the JOIN, which neither of them can: that
 * `review:skillGet`, `review:prepopulate` and `review:write` are channels the
 * preload and the built `main.js` agree on by name and arity, and that the real
 * page renders the operator's own review file through them.
 *
 * ── It writes nothing ────────────────────────────────────────────────────────
 *
 * Every call this rig makes is answerable without touching a file:
 *
 *  - `reviewGet` and `reviewSkillGet` are reads, and reading the skill is
 *    deliberately non-creating — the default is returned and no file appears.
 *  - `reviewPrepopulate` and `reviewWrite` are asked about a period that has no
 *    review (January 2020). Both answer `Review file not found` from the engine's
 *    own read, which is the point: an unregistered channel rejects with "No
 *    handler registered for …" instead, so the refusal is itself the proof that
 *    the channel exists and reaches the vault.
 *  - The rig hashes the operator's `reviews/` tree before and after and asserts it
 *    is byte-identical. A pass with a changed file is a failure.
 *
 * The one leg that would WRITE — Start filling a real period's snapshot — is not
 * here. A run that writes to the operator's own vault should be a decision rather
 * than a side effect of a rig, and the write is covered twice over already: the
 * engine against a temp vault (`tests/review-snapshot-e2e.test.ts`) and the page
 * against a recording stub (`tests/review-ui-e2e.test.ts`).
 *
 * Run from `apps/desktop`, with a Vite dev server up and the main bundle built —
 * and with the app itself NOT running, because this rig brings its own instance
 * on its own isolated profile. `npm run dev` starts both, so a verification run
 * wants the server alone:
 *
 *   node node_modules/vite/bin/vite.js --port 5173   # in one terminal
 *   node e2e/review-live-app.mjs                     # in another
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const electron = createRequire(import.meta.url)("electron");
const SOURCE_RECENT = path.join(os.homedir(), "AppData", "Roaming", "LifeQuest", "recent.json");
const REPORT = path.join(here, "artifacts", "review-live-app.json");

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-app-"));
if (fs.existsSync(SOURCE_RECENT)) {
  fs.copyFileSync(SOURCE_RECENT, path.join(profileDir, "recent.json"));
} else {
  console.error(`[review-app] no recent.json at ${SOURCE_RECENT}; the app will open on Welcome`);
}

/**
 * A silent `hermes` that is first on PATH, and a Hermes home of its own.
 *
 * The app spawns this CLI while it opens the vault (`companionEnsure`), and the
 * splash holds the shell until that settles. Without a shim the operator's real
 * Hermes is what the app talks to — and one of the commands it runs is `gateway
 * restart`, which is not something a test run may do to the operator's own
 * assistant. The shim exits 0 and says nothing, so the boot is fast AND their
 * Hermes is untouched. `HERMES_HOME` points at the throwaway tree for the same
 * reason: the profile the app reads and writes is this run's, not theirs.
 */
function writeHermesShim(cliDir) {
  fs.mkdirSync(cliDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(cliDir, "hermes.cmd"),
      ["@echo off", "rem A fake hermes, first on PATH: exit 0, say nothing.", "exit /b 0", ""].join("\r\n"),
      "ascii",
    );
  } else {
    const shim = path.join(cliDir, "hermes");
    fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(shim, 0o755);
  }
}

const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "lq-review-hermes-"));
const cliDir = path.join(hermesHome, "bin");
writeHermesShim(cliDir);

/** A port nothing is listening on, for a door this run can hold itself. */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A Hermes host gateway that is serving this profile, and nothing else.
 *
 * The app's boot asks `GET <base>/health` and then `GET <base>/v1/capabilities`
 * before it will call the companion ready — and the splash holds the shell until
 * then. Answering both is what makes this run's boot fast, and it also keeps the
 * app away from whatever the operator has on their own machine: with a host
 * answering on the port this world names, `tryAttach` never walks on to theirs.
 */
function serveHostGateway(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.endsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname.endsWith("/v1/capabilities")) {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            features: { session_list: true, session_chat: true, session_chat_stream: true },
          }),
        );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const hostPort = await freePort();
const mcpLocalPort = await freePort();
const mcpInvitePort = await freePort();
const gateway = await serveHostGateway(hostPort);

// The app reads the API port and key from the Hermes home this run owns. The key
// is what it will send; the fake gateway does not check it, but the app refuses
// to attach to a host that answers 401, so the shape has to be right.
fs.writeFileSync(
  path.join(hermesHome, ".env"),
  `API_SERVER_PORT=${hostPort}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
);
// A root config that exists and lists no `mcp_servers.lifequest`: the shape every
// install has out of the box.
fs.writeFileSync(
  path.join(hermesHome, "config.yaml"),
  "model:\n  default: some-model\n  provider: nous\n",
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
env.LIFEQUEST_E2E = JSON.stringify({
  userData: profileDir,
  showWindow: false,
  mcpPorts: { local: mcpLocalPort, invite: mcpInvitePort },
});
env.HERMES_HOME = hermesHome;
env.PATH = `${cliDir}${path.delimiter}${env.PATH ?? ""}`;

fs.rmSync(REPORT, { force: true });

const child = spawn(electron, [path.join(here, "review-live-app.electron.mjs")], {
  cwd: desktopRoot,
  stdio: "inherit",
  env,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error("[review-app] timed out");
  child.kill();
}, 360_000);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  gateway.close();
  if (process.env.LIFEQUEST_E2E_KEEP_PROFILE) {
    console.log(`[review-app] profile kept at ${profileDir}`);
  } else {
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(hermesHome, { recursive: true, force: true });
  }
  if (signal || timedOut) {
    console.error(`[review-app] the app did not finish (${signal ?? "timeout"})`);
    process.exit(1);
  }
  if (!fs.existsSync(REPORT)) {
    console.error(`[review-app] the app exited (${code}) without writing a report`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  console.log(`[review-app] pass=${report.pass}`);
  if (!report.pass) console.error(`[review-app] failures: ${report.failures.join("; ")}`);
  process.exit(report.pass ? 0 : 1);
});
