import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const REPORT = path.join(
  desktopRoot,
  "e2e/artifacts/security-fort-knox.json",
);
const SHOT = path.join(
  desktopRoot,
  "e2e/artifacts/security-fort-knox.png",
);

type Check = { pass: boolean; detail: string | null };
type Report = {
  pass: boolean;
  failures: string[];
  checks: Record<string, Check>;
  notes: string[];
  appVersion: string;
  csp: string;
  splice: { html: string; anchors: number; href: string | null; target: string | null };
  traversal: { ok: boolean; error?: string };
  doors: {
    normal: { status: number | null; body: string };
    foreign: { status: number | null; body: string };
    oversized: { status: number | null; elapsedMs: number };
  };
  secretModes: { file: number | null; dir: number | null };
  update: {
    check: { ok: boolean; decision?: unknown };
    forged: { ok: boolean; error?: string };
    install?: { ok: boolean; launched?: boolean; bytes?: number };
    launcher?: { ok: boolean; sha256?: string; argv?: string[] };
  };
  ports: { local: number; invite: number };
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      ["e2e/security-fort-knox.electron.mjs"],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: (() => {
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            // The fake launcher has to run under a node binary; hand it this one.
            LIFEQUEST_E2E_NODE: process.execPath,
          };
          // The rig sets its own LIFEQUEST_E2E before importing main; this only
          // keeps the runner's own environment from leaking a stale seam in.
          delete env.ELECTRON_RUN_AS_NODE;
          return env;
        })(),
      },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

/**
 * The install leg makes the REAL app quit itself, so the rig's own verdict is
 * the report, not the exit code. Every check the rig made must be present and
 * green; the assertions below restate the ones that matter so a silently
 * skipped check cannot pass for one that ran.
 */
describe("security — Fort-Knox acceptance", () => {
  it("contains the sweep's attack paths and still performs the legitimate ones", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    fs.rmSync(SHOT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "the rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    assert.deepEqual(
      report.failures,
      [],
      `the rig recorded failures: ${JSON.stringify(report.failures, null, 2)}`,
    );
    assert.equal(report.pass, true, "the rig did not pass");
    assert.equal(exitCode, 0, "the rig reported a failure through its exit code");

    // A picture of the shipped screen is part of the handover artifact.
    assert.equal(fs.existsSync(SHOT), true, "no screenshot artifact was written");
    assert.ok(fs.statSync(SHOT).size > 0, "the screenshot is empty");

    // Every check the rig made is green and there are enough of them to cover
    // each attack leg.
    const failing = Object.entries(report.checks).filter(([, c]) => !c.pass);
    assert.deepEqual(failing, [], "a check failed but the report did not say so");
    for (const required of [
      "csp.object-src",
      "csp.base-uri",
      "csp.form-action",
      "csp.frame-src",
      "csp.imgBlob",
      "ui01.singleAnchor",
      "ui01.hrefIsPlainUrl",
      "ui01.targetBlank",
      "ui01.noSplicedTag",
      "ui01.clickDoesNotNavigate",
      "shell01.inPlaceNavigationDenied",
      "shell04.windowOpenDenied",
      "vault.create",
      "vault.open",
      "vault.ownPageReadable",
      "vault01.crossDomainPageRefused",
      "vault06.reviewPathTraversalRefused",
      "door.bound",
      "door03.sameHostReachesAuth",
      "door03.foreignHostRejected",
      "door05.oversizedBodyRefusedPromptly",
      "door05.authenticatedBodyCapEnforced",
      "supp05.secretsFilePrivate",
      "supp05.secretsDirPrivate",
      "update.offered",
      "supp02.forgedInstallRefused",
      "supp02.forgedAssetNeverFetched",
      "update.legitInstallLaunched",
      "update.launcherRan",
      "update.launcherGotDownloadedBytes",
      "update.assetFetchedOnce",
    ]) {
      assert.ok(
        report.checks[required],
        `the rig never made the "${required}" check`,
      );
    }

    // The load-bearing shapes, restated.
    assert.equal(report.splice.anchors, 1, "the splice produced more than one anchor");
    assert.equal(report.splice.target, "_blank", "the external anchor lost its target");
    assert.ok(
      typeof report.splice.href === "string" &&
        report.splice.href.startsWith("https://evil.example/") &&
        !report.splice.href.includes("<"),
      `the external href was corrupted: ${JSON.stringify(report.splice.href)}`,
    );
    assert.equal(report.traversal.ok, false, "a cross-domain page id was accepted");
    assert.equal(report.doors.normal.status, 401, "the door stopped answering MCP auth");
    assert.equal(report.doors.foreign.status, 403, "a foreign Host header was served");
    assert.equal(report.secretModes.file, 0o600, "the pairing secrets file is not 0600");
    assert.equal(report.secretModes.dir, 0o700, "the pairing secrets dir is not 0700");
    assert.equal(report.update.forged.ok, false, "a forged installer was accepted");
    assert.equal(
      report.update.install?.launched,
      true,
      "the legitimate offered installer was not launched",
    );
    assert.match(
      report.update.launcher?.sha256 ?? "",
      /^[0-9a-f]{64}$/,
      "the launcher recorded no digest",
    );
    assert.match(
      report.csp,
      /object-src 'none'/,
      "the packaged CSP still lacks object-src 'none'",
    );
  });
});
