import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createVault, listDomains, readLog } from "@lifequest/vault-core";

/**
 * P0: the one-Life shell, on the REAL app.
 *
 * This rig boots the real main process, the real preload and the real renderer
 * on a throwaway vault, and holds the operator-facing contract:
 *
 *  1. A new vault opens on Life: the titlebar band carries the quiet "Life"
 *     label, not a switcher, and no locked area is named anywhere in the lens.
 *  2. Settings → Areas reveals the five locked areas by name and unlocks two of
 *     them through the real IPC channel.
 *  3. Once a second area is unlocked the same band becomes the segmented control
 *     — Life, Health, Finance — and choosing Health changes the surface.
 *  4. Unlocking is a flag flip in the vault: nothing is created, no folder moves,
 *     and the log records both unlocks.
 *  5. The persisted lens named a LOCKED area (`health`) when the app opened; the
 *     app opens on Life rather than a hidden area, and clears that pref.
 *
 * The artifact is `e2e/artifacts/life-areas.json` plus three screenshots of the
 * shipped window. A skipped rig is evidence of nothing (AGENTS.md): run it
 * through `/root/.local/bin/lifequest-e2e <checkout> tests/life-areas-e2e.test.ts`.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/life-areas.electron.mjs");
const REPORT = path.join(ARTIFACTS, "life-areas.json");
const SCREENSHOTS = [
  path.join(ARTIFACTS, "life-areas-fresh.png"),
  path.join(ARTIFACTS, "life-areas-settings.png"),
  path.join(ARTIFACTS, "life-areas-unlocked.png"),
];
const SCREENSHOT_MIN_BYTES = 20 * 1024;
const DEV_PORT = 5173;
const PROFILE = "lq-areas-e2e";

type Check = { label: string; pass: boolean; detail: string | null };
type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  states: Record<string, unknown>;
  screenshots: { file: string; bytes: number }[];
  generatedAt: string;
};

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

/**
 * The throwaway world: a temp HERMES_HOME, a stub `hermes` first on PATH, and a
 * fresh vault the app auto-opens. `activeDomainByVaultId` names `health`, which
 * is LOCKED in the new seed — the boot must land on Life and clear that pref.
 */
async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-areas-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const binDir = path.join(dir, "bin");
  for (const made of [hermesHome, path.join(hermesHome, "profiles", PROFILE), userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  // Every CLI call the app makes exits 0 and never reaches a real Hermes.
  fs.writeFileSync(path.join(binDir, "hermes"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hermesHome, "config.yaml"), "model:\n  default: some-model\n", "utf8");

  const created = await createVault(vaultDir, "Life areas rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

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
        activeDomainByVaultId: { [vault.id]: "health" },
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: PROFILE,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

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
        provider: PROFILE,
        profile: PROFILE,
        mcpPorts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { dir, hermesHome, userData, vaultDir, vaultId: vault.id, binDir, worldFile, mcpPorts };
}

type DriverOutcome = { code: number | null; stdout: string; stderr: string };

function runDriver(world: World): Promise<DriverOutcome> {
  const electron = createRequire(import.meta.url)("electron") as string;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_HOME = world.hermesHome;
  env.PATH = `${world.binDir}${path.delimiter}${env.PATH ?? ""}`;
  env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${DEV_PORT}`;
  env.LIFEQUEST_E2E = JSON.stringify({
    userData: world.userData,
    showWindow: true,
    mcpPorts: world.mcpPorts,
  });
  env.LQ_AREAS_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";

  return new Promise((resolve) => {
    execFile(
      electron,
      [DRIVER],
      { cwd: desktopRoot, timeout: 300_000, env },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? (error.code as number) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

function tail(text: string, limit = 4_000): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function readMeta(vaultDir: string, slug: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(vaultDir, "domains", slug, "domain.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("one life: the locked areas unlock on the real app", () => {
  it("opens on Life, unlocks two areas from Settings, and turns the band into the switcher", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` (or lifequest-e2e) to include this e2e`,
      );
      return;
    }
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — the bench's dev server must have built main before this rig runs (lifequest-e2e does that)",
    );

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    for (const file of [REPORT, ...SCREENSHOTS]) fs.rmSync(file, { force: true });

    const world = await buildWorld();
    try {
      // ── the seed the driver is about to see ───────────────────────────────
      const seeded = await listDomains(world.vaultDir);
      assert.equal(seeded.ok, true, seeded.ok ? "" : seeded.error);
      if (!seeded.ok) return;
      assert.equal(seeded.value.length, 6, "Life + five areas are seeded");
      assert.equal(
        seeded.value.filter((d) => d.meta.unlockedAt === null).map((d) => d.slug).join(","),
        "health,mind,financial,business,relationships",
        "the five seeded areas are locked",
      );
      // The Log is operator-visible, so seeding a LOCKED area must not name it.
      const seedLog = await readLog(world.vaultDir);
      assert.equal(seedLog.ok, true, seedLog.ok ? "" : seedLog.error);
      if (!seedLog.ok) return;
      assert.deepEqual(
        seedLog.value
          .filter((event) => event.type === "domain.created")
          .map((event) => event.domainSlug),
        ["life"],
        "only the Life area is logged at creation",
      );

      const outcome = await runDriver(world);
      assert.equal(
        fs.existsSync(REPORT),
        true,
        `the driver wrote no ${path.relative(desktopRoot, REPORT)} (exit ${outcome.code}). stderr: ${tail(outcome.stderr)}`,
      );
      const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

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

      // ── the screenshots are this window's own, and not blank ──────────────
      for (const file of SCREENSHOTS) {
        assert.equal(
          fs.existsSync(file),
          true,
          `the driver wrote no ${path.relative(desktopRoot, file)}; stderr: ${tail(outcome.stderr)}`,
        );
        const bytes = fs.statSync(file).size;
        assert.ok(
          bytes > SCREENSHOT_MIN_BYTES,
          `${path.basename(file)} is ${bytes} bytes — too small to be the shipped screen`,
        );
        const recorded = (report.screenshots ?? []).find(
          (shot) => path.basename(shot.file) === path.basename(file),
        );
        assert.ok(recorded, `the report does not carry ${path.basename(file)}`);
      }

      // ── the settings capture is its own frame, not a stale Home frame ─────
      assert.notDeepEqual(
        fs.readFileSync(SCREENSHOTS[0] as string),
        fs.readFileSync(SCREENSHOTS[1] as string),
        "the Settings screenshot is the frame under the sheet, not the sheet",
      );

      // ── the vault on disk is the evidence, not the driver's self-report ───
      assert.equal(
        typeof readMeta(world.vaultDir, "health").unlockedAt,
        "string",
        "Health's unlockedAt is an ISO timestamp after the unlock",
      );
      assert.equal(
        typeof readMeta(world.vaultDir, "financial").unlockedAt,
        "string",
        "Finance's unlockedAt is an ISO timestamp after the unlock",
      );
      for (const slug of ["mind", "business", "relationships"]) {
        assert.equal(
          readMeta(world.vaultDir, slug).unlockedAt,
          null,
          `${slug} stays locked: only the two the operator pressed were unlocked`,
        );
      }
      const log = await readLog(world.vaultDir);
      assert.equal(log.ok, true, log.ok ? "" : log.error);
      if (!log.ok) return;
      assert.deepEqual(
        log.value
          .filter((event) => event.type === "domain.unlocked")
          .map((event) => event.domainSlug)
          .sort(),
        ["financial", "health"],
        "both unlocks are log events",
      );
    } finally {
      fs.rmSync(world.dir, { recursive: true, force: true });
    }
  });
});
