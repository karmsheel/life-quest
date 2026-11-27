import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createVault,
  getDocument,
  listDatabases,
  listPages,
  readLog,
  readOnboardingRecord,
  BASE_AREA_SLUG,
} from "@lifequest/vault-core";

/**
 * P1 on the REAL app: the first-run card, the one announcement card, and the
 * one batch that opens a life — the areas are already open when the card appears.
 *
 * The rig (`e2e/onboarding.electron.mjs`) boots the real main process, preload
 * and renderer on a throwaway world, points the built-in companion at a fake
 * OpenAI endpoint, and scripts exactly one interview turn. This test builds the
 * world, runs the rig, and then re-reads the vault from disk — so a green run
 * means the card, the IPC, the batch and the files all agree, not just that a
 * window drew something.
 *
 * Artifact: `e2e/artifacts/onboarding.json` plus `onboarding-welcome.png`,
 * `onboarding-opened.png`, `onboarding-unlocked.png`. A skipped rig is evidence
 * of nothing (AGENTS.md): run it through
 * `/root/.local/bin/lifequest-e2e <checkout> tests/onboarding-e2e.test.ts`.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const DRIVER = path.join(desktopRoot, "e2e/onboarding.electron.mjs");
const REPORT = path.join(ARTIFACTS, "onboarding.json");
const SCREENSHOTS = [
  path.join(ARTIFACTS, "onboarding-welcome.png"),
  path.join(ARTIFACTS, "onboarding-opened.png"),
  path.join(ARTIFACTS, "onboarding-unlocked.png"),
];
const SCREENSHOT_MIN_BYTES = 20 * 1024;
const DEV_PORT = 5173;
const PROFILE = "lq-onboarding-e2e";

type Check = { label: string; pass: boolean; detail: string | null };
type Report = {
  pass: boolean;
  failures: string[];
  checks: Check[];
  states: Record<string, unknown>;
  screenshots: { file: string; bytes: number }[];
  requests: { systemHasRubric: boolean; toolCount: number; hasToolResult: boolean }[];
  toolCallServed: boolean;
  finalTextServed: boolean;
  generatedAt: string;
};

type World = {
  dir: string;
  hermesHome: string;
  userData: string;
  vaultDir: string;
  legacyVaultDir: string;
  vaultId: string;
  binDir: string;
  worldFile: string;
  mcpPorts: { local: number; invite: number };
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

async function buildWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-onboarding-"));
  const hermesHome = path.join(dir, "hermes-home");
  const userData = path.join(dir, "userdata");
  const vaultDir = path.join(dir, "vault");
  const legacyVaultDir = path.join(dir, "legacy-vault");
  const binDir = path.join(dir, "bin");
  for (const made of [hermesHome, path.join(hermesHome, "profiles", PROFILE), userData, binDir]) {
    fs.mkdirSync(made, { recursive: true });
  }

  // Every CLI call the app makes exits 0 and never reaches a real Hermes.
  fs.writeFileSync(path.join(binDir, "hermes"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hermesHome, "config.yaml"), "model:\n  default: some-model\n", "utf8");

  const created = await createVault(vaultDir, "Onboarding rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);
  const vault = created.value.lifequest;

  // The vault a real operator already has: areas, data, no onboarding file.
  const legacy = await createVault(legacyVaultDir, "Existing vault");
  if (!legacy.ok) throw new Error(`legacy createVault failed: ${legacy.error}`);
  fs.rmSync(path.join(legacyVaultDir, ".lifequest", "onboarding.json"), { force: true });

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
        legacyVaultDir,
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

  return { dir, hermesHome, userData, vaultDir, legacyVaultDir, vaultId: vault.id, binDir, worldFile, mcpPorts };
}

function runDriver(world: World): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
  env.LQ_ONBOARDING_WORLD = world.dir;
  env.ELECTRON_DISABLE_SANDBOX = env.ELECTRON_DISABLE_SANDBOX ?? "1";
  env.DISPLAY = env.DISPLAY ?? ":99";

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

function readMeta(vaultDir: string, slug: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(vaultDir, "domains", slug, "domain.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("onboarding interview (real app)", () => {
  it("opens the heard areas itself, announces them once, then never returns", async (t) => {
    if (!(await devServerUp())) {
      t.skip("no dev server on 127.0.0.1:5173 — run through lifequest-e2e");
      return;
    }
    for (const file of [REPORT, ...SCREENSHOTS]) fs.rmSync(file, { force: true });

    const world = await buildWorld();
    const outcome = await runDriver(world);
    assert.equal(fs.existsSync(REPORT), true, `rig wrote no report artifact; stderr: ${outcome.stderr.slice(-3000)}`);
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.equal(outcome.code, 0, `rig exited ${outcome.code}; failures: ${report.failures.join("; ")}; stderr: ${outcome.stderr.slice(-3000)}`);
    assert.equal(report.pass, true, `rig reported failure: ${report.failures.join("; ")}`);
    assert.deepEqual(
      report.checks.filter((entry) => !entry.pass),
      [],
      "every rig check must hold",
    );

    // ── the prompt was real, the model's choice was the only scripted part ─
    assert.equal(report.toolCallServed, true, "the scripted interview turn never produced a tool call");
    const rubricRequest = report.requests.find((request) => request.systemHasRubric);
    assert.ok(
      rubricRequest,
      "the app never sent the five-area rubric + propose_onboarding_unlock to the companion",
    );
    const promptSample = String((report.states as { promptSample?: unknown }).promptSample ?? "");
    assert.match(promptSample, /propose_onboarding_unlock/, "the rubric block names no proposal tool");
    assert.match(promptSample, /Relationships/, "the rubric block does not carry the five areas");

    // ── the card is a receipt: the vault was already open when it appeared ─
    const pre = report.states.preContinueVault as {
      status?: string;
      unlockedAreas?: string[];
      receipt?: boolean;
      health?: unknown;
      business?: unknown;
    };
    assert.equal(pre.status, "completed", "the record was not completed when the card appeared");
    assert.deepEqual(pre.unlockedAreas, ["health", "business"]);
    assert.equal(typeof pre.health, "string", "Health was not unlocked when the card appeared");
    assert.equal(typeof pre.business, "string", "Business was not unlocked when the card appeared");
    assert.equal(pre.receipt, true, "the card had no proposal receipt to render from");
    const band = report.states.preContinueBand as { tabs?: { label: string }[] };
    assert.deepEqual(
      (band.tabs ?? []).map((tab) => tab.label),
      ["Life", "Health", "Business"],
      "the band was not already the switcher when the card appeared",
    );
    const opened = report.states.opened as {
      status?: string;
      buttons?: string[];
      checkboxLines?: number;
      text?: string;
    };
    assert.equal(opened.status, "opened", "the card is not the announcement card");
    assert.deepEqual(opened.buttons, ["Continue"], "the card offers something other than Continue");
    assert.equal(opened.checkboxLines, 0, "the card asks the operator to tick something");
    assert.match(
      opened.text ?? "",
      /After analyzing our conversation, I've opened up the Health and Business areas for you/,
      "the card does not say what was opened",
    );
    assert.match(
      opened.text ?? "",
      /These let you hone in and focus on different areas in your life/,
      "the card does not say what the areas are for",
    );

    // ── the vault on disk agrees: unlock, doctrine, table, note, record ──
    const healthMeta = readMeta(world.vaultDir, "health");
    const businessMeta = readMeta(world.vaultDir, "business");
    assert.equal(typeof healthMeta.unlockedAt, "string", "Health was not unlocked on disk");
    assert.equal(typeof businessMeta.unlockedAt, "string", "Business was not unlocked on disk");
    assert.equal(readMeta(world.vaultDir, "mind").unlockedAt, null, "an area the interview did not hear was unlocked");

    const record = await readOnboardingRecord(world.vaultDir);
    assert.equal(record.ok, true, record.ok ? "" : record.error);
    if (record.ok) {
      assert.equal(record.value.status, "completed");
      assert.equal(typeof record.value.completedAt, "string");
      assert.deepEqual(record.value.unlockedAreas, ["health", "business"]);
    }

    for (const kind of ["premise", "what", "why", "how"] as const) {
      const doc = await getDocument(world.vaultDir, "health", kind);
      assert.equal(doc.ok, true, doc.ok ? "" : doc.error);
      if (doc.ok) assert.ok(doc.value.bodyMarkdown.trim().length > 0, `Health ${kind} stayed blank`);
    }

    const databases = await listDatabases(world.vaultDir, "health");
    assert.equal(databases.ok, true, databases.ok ? "" : databases.error);
    if (databases.ok) {
      const sleepLog = databases.value.find((entry) => entry.database.name === "Sleep log");
      assert.ok(sleepLog, "the one table was not created in Health");
      assert.equal(sleepLog?.database.columns.length, 2, "the table lost its columns");
    }

    const pages = await listPages(world.vaultDir, BASE_AREA_SLUG);
    assert.equal(pages.ok, true, pages.ok ? "" : pages.error);
    if (pages.ok) {
      const note = pages.value.find((entry) => entry.page.title === "First conversation");
      assert.ok(note, "the interview note page was not written");
      assert.ok(
        note?.page.blocks.some((block) => block.kind === "markdown" && block.markdown.trim().length > 0),
        "the interview note page is empty",
      );
    }

    const log = await readLog(world.vaultDir);
    assert.equal(log.ok, true, log.ok ? "" : log.error);
    if (log.ok) {
      const types = log.value.map((event) => event.type);
      assert.equal(types.filter((type) => type === "onboarding.started").length, 1, "onboarding.started is not logged once");
      assert.equal(types.filter((type) => type === "onboarding.completed").length, 1, "onboarding.completed is not logged once");
      assert.deepEqual(
        log.value.filter((event) => event.type === "domain.unlocked").map((event) => event.domainSlug).sort(),
        ["business", "health"],
        "the unlocks are not in the Log",
      );
    }

    assert.equal(
      fs.existsSync(path.join(world.vaultDir, ".lifequest", "onboarding-proposal.json")),
      false,
      "Continue did not clear the receipt",
    );

    // ── the legacy vault: no record, no card ─────────────────────────────
    const legacyRecord = await readOnboardingRecord(world.legacyVaultDir);
    assert.equal(legacyRecord.ok, true, legacyRecord.ok ? "" : legacyRecord.error);
    if (legacyRecord.ok) assert.equal(legacyRecord.value.status, "completed");
    const states = report.states as {
      legacy?: { present?: boolean };
      reloaded?: { present?: boolean };
      postContinueCard?: { present?: boolean };
    };
    assert.equal(states.legacy?.present, false, "the existing vault was shown a first-run card");
    assert.equal(states.reloaded?.present, false, "the completed vault brought the card back after a reload");
    assert.equal(states.postContinueCard?.present, false, "the card survived Continue");

    // ── the screenshots are this window's and non-blank ──────────────────
    for (const file of SCREENSHOTS) {
      assert.equal(fs.existsSync(file), true, `no ${path.basename(file)}`);
      assert.ok(fs.statSync(file).size > SCREENSHOT_MIN_BYTES, `${path.basename(file)} is blank or missing`);
    }

    t.diagnostic(`artifact: ${REPORT}`);
  });
});
