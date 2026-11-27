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
const CAPTION_TEXT = "Update available";

const DEV_PORT = 5173;
const REPORT = path.join(desktopRoot, "e2e/artifacts/update-poll.json");

type Button = { label: string; disabled: boolean };
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Badge = {
  className: string;
  available: boolean;
  dataState: string | null;
  dataVersion: string | null;
  dataPreview: string | null;
  ariaLabel: string | null;
  ariaHaspopup: string | null;
  ariaExpanded: string | null;
  text: string;
  box: Box | null;
  visible: boolean;
  inVersion: boolean | null;
  inHeader: boolean | null;
  inFoot: boolean | null;
  inDockBar: boolean;
  lastControlInVersion: boolean | null;
} | null;
type Caption = {
  tag: string;
  text: string;
  display: string;
  dataLabel: string | null;
  inVersion: boolean;
  immediatelyBeforeBadge: boolean;
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
type Sample = {
  /** `.update-notice` elements in the page: the removed in-window card. */
  noticeCount: number;
  /** `[data-update-notice]` attributes: the card's own marker. */
  noticeAttributeCount: number;
  badgeCount: number;
  captionCount: number;
  alertCount: number;
  route: string | null;
  surface: string | null;
  hasShell: boolean;
  hasVersionSlot: boolean;
  companionSetup: boolean;
  badge: Badge;
  caption: Caption;
  version: {
    box: Box | null;
    inHeader: boolean;
    lastControlIsBadge: boolean | null;
    containsBadge: boolean;
    controls: string[];
  } | null;
  dialog: Dialog;
  news: News[] | null;
  viewport: { width: number; height: number };
};
type Screenshot = { file: string; width: number; height: number; empty: boolean };

type Report = {
  pass: boolean;
  stage: string;
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
    badgeScreenshot: Screenshot;
    dialogScreenshot: Screenshot;
    feedAtEnd: { feed: number; errors: number; models: number };
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
 * The update watch, end to end, in the card-less world: the real main process
 * reads a real feed on its own clock while the real renderer is running, and a
 * release that was not there at launch reaches the operator through the rail's
 * build number — glow, caption and the dialog it opens — with no in-window
 * notice card anywhere.
 *
 * The card's absence is asserted as a number in every sampled state
 * (`noticeCount`), not assumed from a grep of the source: a rig is the artifact.
 * A skipped run — no dev server — is not evidence that the watch works, so it is
 * reported as skipped rather than passing.
 */
describe("update watch", () => {
  it("surfaces a release published after launch through the badge alone", async (t) => {
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

    // Every sampled state carries the card's absence as a measurement. This runs
    // over the whole report, so a future state that forgets to assert it still
    // cannot pass with a `.update-notice` in the page.
    for (const [name, sample] of Object.entries({
      launch: states.launch,
      arrived: states.arrived,
      repeated: states.repeated,
      failedReads: states.failedReads,
      withdrawn: states.withdrawn,
      returned: states.returned,
      opened: states.opened,
      closed: states.closed,
    }) as [string, Sample][]) {
      assert.equal(sample.noticeCount, 0, `${name}: an .update-notice was rendered`);
      assert.equal(
        sample.noticeAttributeCount,
        0,
        `${name}: a data-update-notice element was rendered`,
      );
      assert.equal(sample.alertCount, 0, `${name}: an alert surface was raised`);
    }

    // ── the rail the badge lives in ─────────────────────────────────────────
    // The badge is in the rail's version slot at the top of the column, so
    // reaching it is also the claim that the real app opened a vault and reached
    // the studio.
    assert.equal(states.launch.hasShell, true, "the real app never reached its shell");
    assert.equal(states.launch.hasVersionSlot, true, "the rail's version slot never mounted");
    assert.ok(states.launch.badge, "the rail rendered no build number");
    assert.equal(states.launch.badge.inVersion, true, "the build number left the rail's version slot");

    // The launch still costs exactly its one check; nothing about the watch
    // changes the cadence at startup.
    assert.ok(
      states.launch.feedRequests >= 1,
      "the launch never asked the feed on its own",
    );

    // ── 1 — a launch with nothing newer is quiet ────────────────────────────
    assert.equal(
      states.launch.badge?.available,
      false,
      `an up-to-date launch turned the build number into an offer: ${states.launch.badge?.className}`,
    );
    assert.notEqual(
      states.launch.badge?.dataState,
      "available",
      "an up-to-date launch carried data-update-state=available",
    );
    assert.equal(
      states.launch.captionCount,
      0,
      "an up-to-date launch drew the update caption",
    );
    assert.equal(
      states.launch.dialog,
      null,
      "an up-to-date launch opened the dialog before the operator asked",
    );
    assert.equal(
      states.launch.version?.containsBadge,
      true,
      `the build number is not in the rail's version slot: ${JSON.stringify(states.launch.version?.controls)}`,
    );
    assert.equal(
      states.launch.version?.inHeader,
      true,
      "the version slot is not inside the rail's header",
    );
    assert.equal(
      states.launch.badge?.inFoot,
      false,
      "the build number is back in the rail's foot",
    );
    assert.equal(
      states.launch.badge?.inDockBar,
      false,
      "the build number is still in the dock's action bar",
    );

    // The push channel the watch reports on is the preload's.
    assert.equal(
      states.subscribed,
      "function",
      "the preload did not expose onUpdateDecision's unsubscribe",
    );

    // ── 2 — a release published after launch reaches the renderer ───────────
    const arrivedNews = states.arrived.news ?? [];
    assert.ok(
      arrivedNews.length >= 1,
      `the watch never reported the new release: ${JSON.stringify(arrivedNews)}`,
    );
    assert.equal(arrivedNews[0].state, "available");
    assert.equal(arrivedNews[0].latest, OFFERED);
    assert.equal(arrivedNews[0].current, APP_VERSION);

    assert.equal(
      states.arrived.badge?.available,
      true,
      `the release did not turn the build number into an offer: ${states.arrived.badge?.className}`,
    );
    assert.equal(
      states.arrived.badge?.dataState,
      "available",
      `the glowing build number's data-update-state is ${states.arrived.badge?.dataState}`,
    );
    assert.equal(
      states.arrived.badge?.dataVersion,
      OFFERED,
      `the glowing build number names ${states.arrived.badge?.dataVersion}, not ${OFFERED}`,
    );
    // The caption is the element immediately before the badge, in the rail's
    // version slot: the glow's sentence is the replacement for the removed card.
    assert.equal(states.arrived.captionCount, 1, "the offer drew no caption");
    assert.ok(states.arrived.caption, "the offer drew no caption beside the badge");
    assert.equal(
      states.arrived.caption?.text,
      CAPTION_TEXT,
      `the caption reads ${JSON.stringify(states.arrived.caption?.text)}`,
    );
    assert.equal(
      states.arrived.caption?.inVersion,
      true,
      "the caption left the rail's version slot",
    );
    assert.equal(
      states.arrived.caption?.immediatelyBeforeBadge,
      true,
      "the caption is not immediately before the build number",
    );
    assert.equal(
      states.arrived.caption?.visible,
      true,
      "the caption was rendered but not visible at the shipped window width",
    );
    assert.equal(
      states.arrived.badge?.inVersion,
      true,
      `the glowing build number left the rail's version slot: ${JSON.stringify(states.arrived.badge?.box)}`,
    );
    assert.equal(
      states.arrived.badge?.inDockBar,
      false,
      "the glowing build number is in the dock's action bar",
    );
    assert.equal(
      states.arrived.dialog,
      null,
      "the offer opened the dialog before the operator asked",
    );

    // ── 3 — later ticks keep the glow and raise nothing ─────────────────────
    assert.equal(
      states.repeated.news?.length,
      1,
      `the same release was reported more than once: ${JSON.stringify(states.repeated.news)}`,
    );
    assert.equal(
      states.repeated.badge?.available,
      true,
      "the glow went out while the release was still offered",
    );
    assert.equal(
      states.repeated.badge?.dataVersion,
      OFFERED,
      "the glowing build number lost the offered version",
    );
    assert.equal(
      states.repeated.caption?.text,
      CAPTION_TEXT,
      "later ticks lost the caption",
    );
    assert.equal(states.repeated.dialog, null, "a later tick opened the dialog");
    assert.equal(states.repeated.captionCount, 1, "a later tick drew a second caption");

    // ── 4 — a failing watch read is quiet, and the offer survives it ────────
    assert.equal(
      states.failedReads.news?.length,
      1,
      "a failed read was reported as news",
    );
    assert.equal(
      states.failedReads.badge?.available,
      true,
      "a failed read cleared the glow",
    );
    assert.equal(
      states.failedReads.badge?.dataVersion,
      OFFERED,
      "a failed read cleared the offered version",
    );
    assert.equal(
      states.failedReads.caption?.text,
      CAPTION_TEXT,
      "a failed read removed the caption",
    );
    assert.equal(
      states.afterFailures.ok,
      true,
      `a failed watch read erased the session's answer: ${JSON.stringify(states.afterFailures)}`,
    );
    assert.equal(states.afterFailures.decision?.state, "available");
    assert.equal(states.afterFailures.decision?.latest, OFFERED);

    // ── 5 — withdrawn, then republished: the glow follows the feed ──────────
    assert.equal(
      states.withdrawn.news?.[1]?.state,
      "current",
      `the withdrawal was not reported: ${JSON.stringify(states.withdrawn.news)}`,
    );
    assert.equal(
      states.withdrawn.badge?.available,
      false,
      "a withdrawn release left the build number glowing",
    );
    assert.notEqual(
      states.withdrawn.badge?.dataState,
      "available",
      "a withdrawn release still carried data-update-state=available",
    );
    assert.equal(
      states.withdrawn.captionCount,
      0,
      "a withdrawn release left its caption in the bar",
    );
    assert.equal(
      states.returned.news?.[2]?.state,
      "available",
      `the republished release was not reported again: ${JSON.stringify(states.returned.news)}`,
    );
    assert.equal(
      states.returned.badge?.available,
      true,
      "the republished release did not glow again",
    );
    assert.equal(
      states.returned.badge?.dataVersion,
      OFFERED,
      "the republished release's badge names the wrong version",
    );
    assert.equal(
      states.returned.caption?.text,
      CAPTION_TEXT,
      "the republished release came back without its caption",
    );

    // ── 6 — the glowing build number opens the real offer ───────────────────
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
    assert.ok(
      (states.opened.dialog?.buttons ?? []).some((button) =>
        button.label.includes("Not now"),
      ),
      "the dialog offered no way out",
    );
    assert.equal(states.closed.dialog, null, "Not now did not close the dialog");
    assert.equal(
      states.closed.badge?.available,
      true,
      "closing the dialog lost the offer's glow",
    );
    assert.equal(
      states.closed.badge?.dataVersion,
      OFFERED,
      "closing the dialog lost the offered version",
    );
    assert.equal(
      states.closed.caption?.text,
      CAPTION_TEXT,
      "closing the dialog lost the caption",
    );
    assert.equal(
      states.closed.badge?.inVersion,
      true,
      "the build number left the rail's version slot",
    );

    assert.ok(
      states.feedAtEnd.feed >= 5,
      `the watch did not keep a cadence: ${JSON.stringify(states.feedAtEnd)}`,
    );

    // The artifact the handover points at: real captures of the shipped screen.
    // There is no toast PNG any more — the card it photographed is gone.
    for (const [label, shot] of [
      ["glowing build number", states.badgeScreenshot],
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
    assert.equal(
      /update-poll-(badge|dialog)\.png$/.test(states.badgeScreenshot.file),
      true,
      `the badge artifact is ${states.badgeScreenshot.file}, expected update-poll-badge.png`,
    );
  });
});
