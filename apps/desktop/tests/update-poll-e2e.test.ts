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
 * The build under test, off the app's own `package.json`. The rig derives its
 * fixture from the same idea, so a version bump does not break this suite.
 */
const APP_VERSION = (require("../package.json") as { version: string }).version;
const OFFERED = "0.9.0";

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/update-poll.json");

type Button = { label: string; disabled: boolean };
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Notice = {
  version: string | null;
  role: string | null;
  live: string | null;
  label: string | null;
  text: string;
  buttons: Button[];
  box: Box | null;
  visible: boolean;
} | null;
type Dialog = {
  version: string | null;
  view: string | null;
  title: string;
  body: string;
  buttons: Button[];
} | null;
type News = { state: string | null; latest: string | null; current: string | null };
type Screenshot = { file: string; width: number; height: number; empty: boolean };
type Sample = {
  notice: Notice;
  dialog: Dialog;
  news: News[] | null;
  viewport: { width: number; height: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  states: {
    launch: Sample & { feedRequests: number };
    subscribed: string;
    arrived: Sample;
    repeated: Sample;
    failedReads: Sample;
    afterFailures: { ok: boolean; decision?: { state: string; latest?: string } };
    withdrawn: Sample;
    returned: Sample;
    opened: Sample;
    closed: Sample;
    dismissed: Sample;
    stayedDismissed: Sample;
    toastScreenshot: Screenshot;
    dialogScreenshot: Screenshot;
    feedAtEnd: { feed: number; errors: number };
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
      [path.join(desktopRoot, "e2e/update-poll.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
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
 * The update watch, end to end: the real main process reads a real feed on its
 * own clock while the real renderer is running, and the release that was not
 * there at launch reaches the operator without a click.
 *
 * A rig is the artifact. A skipped run — no dev server — is not evidence that the
 * watch works, so it is reported as skipped rather than passing.
 */
describe("update watch", () => {
  it("surfaces a release published after launch, without a click", async (t) => {
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
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true, "the rig reported a failure in its artifact");
    assert.equal(exitCode, 0, "the rig reported a failure through its exit code");

    const { states } = report;

    // The launch still costs exactly its one check; nothing about the watch
    // changes the cadence at startup.
    assert.ok(
      states.launch.feedRequests >= 1,
      "the launch never asked the feed on its own",
    );
    assert.equal(
      states.launch.notice,
      null,
      "an up-to-date launch raised an update notice",
    );

    // The push channel the watch reports on is the preload's.
    assert.equal(
      states.subscribed,
      "function",
      "the preload did not expose onUpdateDecision's unsubscribe",
    );

    // The release published after launch reached the renderer with no click.
    const arrivedNews = states.arrived.news ?? [];
    assert.ok(
      arrivedNews.length >= 1,
      `the watch never reported the new release: ${JSON.stringify(arrivedNews)}`,
    );
    assert.equal(arrivedNews[0].state, "available");
    assert.equal(arrivedNews[0].latest, OFFERED);
    assert.equal(arrivedNews[0].current, APP_VERSION);

    const notice = states.arrived.notice;
    assert.ok(notice, "the release raised no in-app notice");
    assert.equal(notice.version, OFFERED, "the notice named the wrong release");
    assert.ok(
      notice.text.includes(`LifeQuest ${OFFERED} is available`),
      `the notice did not say what happened: ${JSON.stringify(notice.text)}`,
    );
    assert.ok(
      notice.text.includes(`v${APP_VERSION}`),
      `the notice did not say which build is running: ${JSON.stringify(notice.text)}`,
    );
    assert.equal(notice.role, "status", "the notice is not a status region");
    assert.equal(notice.live, "polite", "the notice would interrupt a screen reader");
    assert.equal(notice.visible, true, "the notice was rendered but not visible");
    assert.ok(
      notice.buttons.some((button) => button.label.startsWith("Open the LifeQuest")),
      `the notice offered no way into the upgrade: ${JSON.stringify(notice.buttons)}`,
    );
    assert.ok(
      notice.buttons.some((button) => button.label === "Dismiss the update notice"),
      `the notice offered no dismissal: ${JSON.stringify(notice.buttons)}`,
    );
    assert.equal(
      states.arrived.dialog,
      null,
      "the notice opened the dialog before the operator asked",
    );

    // The same release on later ticks is not re-announced.
    assert.equal(
      states.repeated.news?.length,
      1,
      `the same release was announced more than once: ${JSON.stringify(states.repeated.news)}`,
    );
    assert.equal(states.repeated.notice?.version, OFFERED);

    // A failing watch read is quiet, and the answered offer survives it.
    assert.equal(
      states.failedReads.news?.length,
      1,
      "a failed read was reported as news",
    );
    assert.equal(
      states.failedReads.notice?.version,
      OFFERED,
      "a failed read removed the notice",
    );
    assert.equal(
      states.afterFailures.ok,
      true,
      `a failed watch read erased the session's answer: ${JSON.stringify(states.afterFailures)}`,
    );
    assert.equal(states.afterFailures.decision?.state, "available");
    assert.equal(states.afterFailures.decision?.latest, OFFERED);

    // Withdrawn, then republished: the notice follows the feed.
    assert.equal(
      states.withdrawn.news?.[1]?.state,
      "current",
      `the withdrawal was not reported: ${JSON.stringify(states.withdrawn.news)}`,
    );
    assert.equal(
      states.withdrawn.notice,
      null,
      "a withdrawn release left its notice on screen",
    );
    assert.equal(
      states.returned.news?.[2]?.state,
      "available",
      `the republished release was not announced again: ${JSON.stringify(states.returned.news)}`,
    );
    assert.equal(states.returned.notice?.version, OFFERED);

    // "View update" opens the real offer.
    assert.equal(states.opened.dialog?.view, "offer");
    assert.equal(states.opened.dialog?.version, OFFERED);
    assert.ok(
      (states.opened.dialog?.title ?? "").includes(OFFERED),
      `the dialog named the wrong release: ${JSON.stringify(states.opened.dialog?.title)}`,
    );
    assert.ok(
      (states.opened.dialog?.buttons ?? []).some((button) =>
        button.label.includes("Download and install"),
      ),
      `the dialog was not the install offer: ${JSON.stringify(states.opened.dialog?.buttons)}`,
    );
    assert.equal(
      states.closed.notice?.version,
      OFFERED,
      "closing the dialog lost the notice",
    );

    // Dismissed once, gone for that release, and the watch keeps reading.
    assert.equal(states.dismissed.notice, null, "the notice could not be dismissed");
    assert.equal(
      states.stayedDismissed.notice,
      null,
      "the dismissed notice came back for the same release",
    );
    assert.equal(
      states.stayedDismissed.news?.length,
      3,
      `the watch announced more than the three real changes: ${JSON.stringify(states.stayedDismissed.news)}`,
    );
    assert.ok(
      states.feedAtEnd.feed >= 5,
      `the watch did not keep a cadence: ${JSON.stringify(states.feedAtEnd)}`,
    );

    // The artifact the handover points at: real captures of the shipped screen.
    for (const [label, shot] of [
      ["update notice", states.toastScreenshot],
      ["upgrade dialog", states.dialogScreenshot],
    ] as const) {
      assert.equal(
        fs.existsSync(shot.file),
        true,
        `the ${label} screenshot is missing: ${shot.file}`,
      );
      assert.equal(shot.empty, false, `the ${label} screenshot is empty`);
      assert.ok(shot.width > 0 && shot.height > 0, `the ${label} screenshot has no size`);
      assert.ok(
        fs.statSync(shot.file).size > 8_000,
        `the ${label} screenshot is too small to be a screen: ${shot.file}`,
      );
    }
  });
});
