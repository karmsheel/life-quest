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

/**
 * The build under test, off the app's own `package.json` — the same file the
 * updater compares against. The rig derives its fixtures from it too, so a
 * version bump does not break this suite.
 */
const APP_VERSION = (require("../package.json") as { version: string }).version;
const NEWER_VERSION = "0.9.0";
const TEN_VERSION = "0.10.0";

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/update-install.json");

type Decision =
  | {
      state: "available";
      current: string;
      latest: string;
      notes: string;
      releaseUrl: string;
      installer: { name: string; url: string; size: number } | null;
    }
  | { state: "current"; current: string; latest: string }
  | { state: "no_release"; current: string; error: string }
  | { state: "error"; current: string; error: string };

type Answer = { ok: true; decision: Decision } | { ok: false; error: string };
type InstallAnswer =
  | { ok: true; launched: true; installer: string; bytes: number }
  | { ok: false; error: string };

type Report = {
  pass: boolean;
  failures: string[];
  states: {
    launch: { feedRequestsBeforeExplicitCalls: number };
    newer: Answer;
    same: Answer;
    older: Answer;
    ten: Answer;
    prerelease: Answer;
    garbage: Answer;
    noasset: Answer;
    four04: Answer;
    untrusted: Answer;
    session: { first: string; cached: string; forced: string };
    declaredUntrusted: InstallAnswer;
    redirected: InstallAnswer;
    truncated: InstallAnswer;
    install: { outcomes: InstallAnswer[]; assetRequests: number };
    landed: { path: string; size: number; sha256: string } | { path: string; missing: true };
    progress: { downloaded: number; total: number }[];
    launcher: {
      ok: boolean;
      argv: string[];
      size: number;
      sha256: string;
    } | null;
  };
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
      [path.join(desktopRoot, "e2e/update-install.electron.mjs")],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: {
          ...process.env,
          // The rig replaces the installer with a launcher it owns, and that
          // launcher has to run under a node binary. This is the one the runner
          // itself is running on, so the rig never has to hunt for one.
          LIFEQUEST_E2E_NODE: process.execPath,
        },
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
 * The wired-app rig runs the REAL main process, so the app quits itself when the
 * install succeeds: `before-quit` shuts the companion down and exits 0. The exit
 * code therefore carries the app's verdict, not the rig's — and on the failure
 * paths the rig sets it to 1 itself. The artifact is the report, and this suite
 * asserts on that; the exit code is only checked when it is non-zero.
 */
describe("auto-update install", () => {
  it("reads the release feed, refuses what it should, and hands the real download over", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    const { states } = report;

    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "the rig reported a failure through its exit code");

    // The cadence: the app asks the feed by itself, at launch, before this rig
    // asks for anything.
    assert.ok(
      states.launch.feedRequestsBeforeExplicitCalls >= 1,
      "the launch never asked the feed on its own",
    );

    // The version rules, on real payloads.
    assert.equal(states.newer.ok, true);
    assert.equal(
      (states.newer as { decision: Decision }).decision.state,
      "available",
      "a newer tag was not offered",
    );
    const newer = (states.newer as { decision: Extract<Decision, { state: "available" }> })
      .decision;
    assert.equal(newer.current, APP_VERSION, "the running version was misread");
    assert.equal(newer.latest, NEWER_VERSION, "the offered version kept its v prefix");
    assert.equal(
      newer.installer?.name,
      `LifeQuest-${NEWER_VERSION}-setup.exe`,
      `the Windows setup was not picked out of the assets: ${JSON.stringify(newer.installer)}`,
    );
    assert.ok(
      newer.notes.includes("build number glows") &&
        newer.releaseUrl.endsWith(`/v${NEWER_VERSION}`),
      "the release's notes or page did not come through",
    );

    assert.equal(
      (states.same as { decision: Decision }).decision.state,
      "current",
      "the same version was offered as an update",
    );
    assert.equal(
      (states.older as { decision: Decision }).decision.state,
      "current",
      "a downgrade was offered as an upgrade",
    );
    const ten = (states.ten as { decision: Extract<Decision, { state: "available" }> }).decision;
    assert.equal(
      ten.state === "available" ? ten.latest : ten.state,
      TEN_VERSION,
      `${TEN_VERSION} was not offered to ${APP_VERSION} — a text comparison would get this backwards`,
    );
    assert.equal(
      (states.prerelease as { decision: Decision }).decision.state,
      "current",
      "a prerelease of the running version was offered as newer",
    );
    assert.equal(
      (states.garbage as { decision: Decision }).decision.state,
      "error",
      "an unreadable tag did not fail closed",
    );
    assert.ok(
      ((states.garbage as { decision: Extract<Decision, { state: "error" }> }).decision.error ??
        "").includes("nightly"),
      "the unreadable tag was not named in the reason",
    );
    const noAsset = (
      states.noasset as { decision: Extract<Decision, { state: "available" }> }
    ).decision;
    assert.equal(noAsset.state, "available", "a release with no installer stopped being an upgrade");
    assert.equal(noAsset.installer, null, "a release with no setup exe produced an installer");
    assert.equal(states.four04.ok, false, "a 404 was reported as a settled answer");
    assert.ok(
      (states.four04 as { error: string }).error.includes("404"),
      `a 404 was not reported as a 404: ${JSON.stringify(states.four04)}`,
    );
    const untrusted = (
      states.untrusted as { decision: Extract<Decision, { state: "available" }> }
    ).decision;
    assert.equal(
      untrusted.installer,
      null,
      "an installer url off the trusted host was offered anyway",
    );

    // A session keeps its answer; `force` reaches the feed again.
    assert.equal(
      states.session.first,
      NEWER_VERSION,
      "the forced check did not read the feed",
    );
    assert.equal(states.session.cached, "available", "a second check did not replay the session's answer");
    assert.equal(states.session.forced, "current", "a forced check did not reach the feed");

    // The refusals, each before a byte lands.
    assert.equal(states.declaredUntrusted.ok, false, "an untrusted url was downloaded");
    assert.ok(
      (states.declaredUntrusted as { error: string }).error.includes("trusted host"),
      `the refusal did not say why: ${JSON.stringify(states.declaredUntrusted)}`,
    );
    assert.equal(states.redirected.ok, false, "a redirect off the trusted host was followed");
    assert.ok(
      (states.redirected as { error: string }).error.includes("redirected to"),
      `the redirect was refused for the wrong reason: ${JSON.stringify(states.redirected)}`,
    );
    assert.equal(states.truncated.ok, false, "a short body was accepted as the installer");
    assert.ok(
      (states.truncated as { error: string }).error.includes("declares"),
      `the size mismatch was not named: ${JSON.stringify(states.truncated)}`,
    );

    // The install: one download, two shared requests, the real bytes.
    assert.equal(states.install.outcomes.length, 2, "both install requests did not settle");
    assert.ok(
      states.install.outcomes.every((outcome) => outcome.ok === true),
      `an install request failed: ${JSON.stringify(states.install.outcomes)}`,
    );
    assert.equal(
      states.install.assetRequests,
      1,
      `the installer was fetched ${states.install.assetRequests} times for two requests`,
    );
    const landed = states.landed as { path: string; size: number; sha256: string };
    assert.equal(
      "missing" in states.landed,
      false,
      `nothing landed on disk: ${JSON.stringify(states.landed)}`,
    );
    assert.ok(landed.size > 0, `the download landed empty: ${JSON.stringify(states.landed)}`);
    assert.equal(
      (states.install.outcomes[0] as { installer: string }).installer,
      landed.path,
      "the app reported a different file from the one on disk",
    );

    // Progress, over the real IPC channel, monotonic and complete.
    assert.ok(states.progress.length > 0, "no progress events reached the renderer");
    assert.equal(
      states.progress[states.progress.length - 1].downloaded,
      landed.size,
      "the progress never reached the downloaded size",
    );

    // The launcher: handed the downloaded file, whose digest is the feed's.
    assert.ok(states.launcher, "the fake launcher never ran");
    assert.deepEqual(
      states.launcher?.argv,
      [landed.path],
      "the launcher was not handed the downloaded installer",
    );
    assert.equal(
      states.launcher?.sha256,
      landed.sha256,
      "the file handed to the launcher is not the file that landed",
    );
    assert.equal(
      states.launcher?.ok,
      true,
      `the launcher could not read what it was handed: ${JSON.stringify(states.launcher)}`,
    );
  });
});
