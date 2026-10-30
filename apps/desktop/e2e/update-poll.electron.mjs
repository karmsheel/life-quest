/**
 * The wired-app acceptance run for the update watch: the REAL LifeQuest main
 * process, the REAL preload, and the REAL renderer against a release feed this
 * rig owns, whose newest release changes *while the app is running*.
 *
 * `update-badge.electron.mjs` proves the badge and the popup against a stubbed
 * bridge. `update-install.electron.mjs` proves the feed rules and the download
 * against the real main. This one covers the fact neither of those can reach, and
 * the reason the feature was asked for:
 *
 *   · a release published after launch reaches the renderer with no click and no
 *     reload — main's watch reads the feed on its own clock, pushes the answer
 *     over IPC, and the operator gets an in-app notice plus the rail's glow;
 *   · the notice is announced once per release, not on every tick;
 *   · a dismissed notice stays dismissed while the same release keeps being
 *     offered;
 *   · a watch read that fails is quiet and does not erase the offer the operator
 *     can still install;
 *   · a release that stops being offered clears the notice, and one that comes
 *     back is announced again;
 *   · "View update" opens the real upgrade dialog, not a second weaker offer.
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile, keeps the
 * window off the operator's desktop, replaces the feed with this rig's server, and
 * shortens the watch's interval through the seam — the product reads every hour;
 * a rig that waited that long would not be testing the watch at all.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/update-poll.electron.mjs
 *
 * The report is the artifact: `e2e/artifacts/update-poll.json`, with two PNGs of
 * the shipped screen (the notice, and the dialog it opens).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "update-poll.json");

/**
 * The build under test, off the app's own `package.json` — the same file the
 * updater compares against and the notice renders. The offered release is a
 * fixed fixture that has to stay ahead of it; the sweep asserts that rather than
 * assuming it, so a future release does not silently turn every step below into a
 * test of the "up to date" branch.
 */
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;
const NEWER_VERSION = "0.9.0";

/** The rig's cadence. Far below the product's, and only this run's. */
const POLL_MS = 400;

const failures = [];
const states = {};
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Which step the run reached, so a failure names itself in the report. */
let stage = "boot";

/** The release the feed answers with, built off the live port. */
function releaseFor(version, base) {
  return {
    tag_name: `v${version}`,
    name: `LifeQuest ${version}`,
    body: "- The app now tells you when a newer release is published",
    html_url: `https://github.com/karmsheel/life-quest/releases/tag/v${version}`,
    published_at: "2026-03-01T09:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `LifeQuest-${version}-setup.exe`,
        browser_download_url: `${base}/asset/installer`,
        size: 1024,
      },
    ],
  };
}

/**
 * The feed this rig owns. `same` answers with the running build (nothing to
 * offer), `newer` with the fixture above, and `broken` with a 500 — the read a
 * watch tick cannot turn into an answer.
 */
function startFeed() {
  let scenario = "same";
  let base = "";
  const counts = { feed: 0, errors: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (url.pathname !== "/releases/latest") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
      return;
    }
    counts.feed += 1;
    if (scenario === "broken") {
      counts.errors += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "the feed is having a bad day" }));
      return;
    }
    const version = scenario === "newer" ? NEWER_VERSION : APP_VERSION;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(releaseFor(version, base)));
  });

  return new Promise((resolve, reject) => {
    const listen = (host) =>
      new Promise((res, rej) => {
        server.once("error", rej);
        server.listen({ port: 0, host }, () => res());
      });
    (async () => {
      try {
        await listen("127.0.0.1");
      } catch (error) {
        reject(error);
        return;
      }
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve({
        base,
        counts,
        scenario: () => scenario,
        setScenario: (next) => {
          scenario = next;
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    })();
  });
}

/** What the renderer currently draws, in one sample. */
const SAMPLE = `(() => {
  try {
  const notice = document.querySelector('.update-notice');
  const dialog = document.querySelector('.update-dialog');
  const buttons = (root) =>
    Array.from(root.querySelectorAll('button')).map((el) => ({
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
      disabled: el.disabled === true,
    }));
  let box = null;
  let visible = false;
  let style = null;
  if (notice) {
    const rect = notice.getBoundingClientRect();
    style = getComputedStyle(notice);
    box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0;
  }
  return {
    notice: notice
      ? {
          version: notice.getAttribute('data-update-notice'),
          role: notice.getAttribute('role'),
          live: notice.getAttribute('aria-live'),
          label: notice.getAttribute('aria-label'),
          text: (notice.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          buttons: buttons(notice),
          box,
          visible,
          style: {
            opacity: style.opacity,
            display: style.display,
            visibility: style.visibility,
            animationName: style.animationName,
            animationPlayState: style.animationPlayState,
          },
        }
      : null,
    dialog: dialog
      ? {
          version: dialog.getAttribute('data-update-dialog'),
          view: dialog.getAttribute('data-update-view'),
          title:
            (dialog.querySelector('.update-dialog__title')?.textContent ?? '').trim(),
          body:
            (dialog.querySelector('.update-dialog__body')?.textContent ?? '')
              .replace(/\\s+/g, ' ')
              .trim(),
          buttons: buttons(dialog),
        }
      : null,
    news: Array.isArray(window.__updateNews)
      ? window.__updateNews.map((entry) => ({
          state: entry?.state ?? null,
          latest: entry?.latest ?? null,
          current: entry?.current ?? null,
        }))
      : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
  } catch (error) {
    return { sampleError: String((error && error.stack) || error) };
  }
})()`;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const feed = await startFeed();
  const profileDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lq-update-poll-profile-")),
  );

  // Seeded before main.js is imported: the module reads the seam at load.
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    updateFeedUrl: `${feed.base}/releases/latest`,
    updatePollMs: POLL_MS,
    // Loopback over http; the release's installer url is this rig's own. The
    // offer has to look complete in the dialog even though nothing is installed.
    updateTrust: { hosts: ["127.0.0.1"], allowHttp: true },
  });

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  // The seam keeps the window hidden so it cannot steal the operator's desktop,
  // and a hidden window does not paint: Chromium does not advance CSS animations
  // in it, so the notice would sit at its entrance frame's `opacity: 0` forever
  // and every "is it on screen" question would be a question about a frozen
  // page. A rig window on the bench's own X display is the product's frame.
  win.showInactive();

  const run = (expression) =>
    win.webContents.executeJavaScript(expression, true).catch((error) => {
      throw new Error(
        `renderer script failed: ${error instanceof Error ? error.message : String(error)} :: ${expression.slice(0, 160).replace(/\s+/g, " ")}`,
      );
    });

  const waitFor = async (expression, label, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value;
      try {
        value = await run(expression);
      } catch {
        value = undefined;
      }
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await sleep(50);
    }
  };

  // A card that has mounted but whose entrance has not painted yet reads
  // `opacity: 0`; "on screen" is a fact about the settled frame, not the first
  // one. The watch's push lands before React has drawn the notice, and under a
  // dev server's first paint that gap can be longer than the animation.
  const navigationLog = [];
  win.webContents.on("did-start-loading", () => navigationLog.push("start-loading"));
  win.webContents.on("did-finish-load", () => navigationLog.push("finish-load"));
  win.webContents.on("did-fail-load", (_e, code, description) =>
    navigationLog.push(`fail-load ${code} ${description}`),
  );
  win.webContents.on("render-process-gone", (_e, details) =>
    navigationLog.push(`render-gone ${JSON.stringify(details)}`),
  );
  win.webContents.on("did-navigate", (_e, url) => navigationLog.push(`navigate ${url}`));
  win.webContents.on("did-navigate-in-page", (_e, url) => navigationLog.push(`in-page ${url}`));

  const rendererErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") rendererErrors.push(event.message);
  });

  const noticeState = () =>
    run(`(() => {
      const el = document.querySelector('.update-notice');
      if (!el) return { present: false };
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        present: true,
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility,
        animation: style.animationName,
        width: rect.width,
        height: rect.height,
      };
    })()`);

  const waitForNoticeShown = async () => {
    const deadline = Date.now() + 8_000;
    for (;;) {
      const state = await noticeState();
      if (state.present && state.visibility !== "hidden" && Number(state.opacity) > 0) {
        return state;
      }
      if (Date.now() > deadline) {
        const page = await run(`(() => ({
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          rootChildren: document.querySelector('#root')?.childElementCount ?? null,
          rootHtml: (document.querySelector('#root')?.innerHTML ?? '').slice(0, 400),
          bodyHtml: (document.body.innerHTML ?? '').slice(0, 400),
          noticeCount: document.querySelectorAll('.update-notice').length,
          newsCount: Array.isArray(window.__updateNews) ? window.__updateNews.length : null,
          hasBridge: Boolean(window.lifequest && window.lifequest.onUpdateDecision),
        }))()`);
        throw new Error(
          `timed out waiting for the notice to be on screen: ${JSON.stringify(state)}; page ${JSON.stringify(page)}; renderer errors: ${JSON.stringify(rendererErrors.slice(-4))}`,
        );
      }
      await sleep(60);
    }
  };

  const sample = async () => {
    const value = await run(SAMPLE);
    if (value && value.sampleError) {
      throw new Error(`page sample failed: ${value.sampleError}`);
    }
    return value;
  };

  const click = (selector) =>
    run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const shoot = async (name) => {
    // A hidden window does not paint, and a capture of an unpainted window is a
    // black rectangle — the artifact has to show the shipped screen.
    win.showInactive();
    await sleep(400);
    const image = await win.webContents.capturePage();
    const file = path.join(artifactsDir, name);
    fs.writeFileSync(file, image.toPNG());
    const size = image.getSize();
    return { file, width: size.width, height: size.height, empty: image.isEmpty() };
  };

  stage = "wait for the bridge";
  // The bridge is live as soon as the preload has run, before React mounts.
  await waitFor("Boolean(window.lifequest && window.lifequest.updateCheck)", "the preload bridge");

  // The launch's own check, fired by the provider mounting. Waiting for it (not
  // for a timer) is what makes "before this rig asked for anything" a fact.
  const launchDeadline = Date.now() + 20_000;
  while (feed.counts.feed < 1 && Date.now() < launchDeadline) await sleep(50);
  const launchRequests = feed.counts.feed;

  check(
    "the fixture still offers a newer release than this build",
    NEWER_VERSION.localeCompare(APP_VERSION, undefined, { numeric: true }) > 0,
    `the rig offers ${NEWER_VERSION} to a build of ${APP_VERSION} — raise the fixture`,
  );
  check(
    "the launch asks the feed on its own",
    launchRequests >= 1,
    `the feed saw ${launchRequests} requests before this rig asked for anything`,
  );

  stage = "launch sample";
  // ── 1 — launch with nothing to offer: quiet, no notice ────────────────────
  await sleep(600);
  const launch = await sample();
  states.launch = { feedRequests: launchRequests, ...launch };
  check(
    "a launch with no newer release shows no notice",
    launch.notice === null,
    `notice ${JSON.stringify(launch.notice)}`,
  );
  check(
    "a launch with no newer release opens no dialog by itself",
    launch.dialog === null,
    `dialog ${JSON.stringify(launch.dialog)}`,
  );

  stage = "subscribe to the push channel";
  // ── 2 — a real listener on the real push channel ──────────────────────────
  const subscribed = await run(`(() => {
    window.__updateNews = [];
    const off = window.lifequest.onUpdateDecision((entry) => window.__updateNews.push(entry));
    return typeof off;
  })()`);
  states.subscribed = subscribed;
  check(
    "the preload exposes the watch's push channel",
    subscribed === "function",
    `onUpdateDecision returned ${JSON.stringify(subscribed)}`,
  );

  stage = "wait for the watch's first news";
  // ── 3 — a release is published while the app is open ──────────────────────
  // Nothing clicks the build number, nothing reloads the page: the only thing
  // that changes is the feed's answer, and the app's own clock has to find it.
  const feedAtPublish = feed.counts.feed;
  feed.setScenario("newer");

  const arrived = await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const news = await run("Array.isArray(window.__updateNews) ? window.__updateNews.length : 0");
      if (news > 0) return news;
      if (Date.now() > deadline) throw new Error("the watch never reported the new release");
      await sleep(50);
    }
  })();
  await waitForNoticeShown();
  states.arrived = await sample();
  check(
    "the watch read the feed again without anyone clicking",
    feed.counts.feed > feedAtPublish,
    `the feed saw ${feed.counts.feed} requests, unchanged from ${feedAtPublish}`,
  );
  check(
    "the watch reported the release over IPC",
    arrived >= 1 &&
      states.arrived.news?.[0]?.state === "available" &&
      states.arrived.news?.[0]?.latest === NEWER_VERSION,
    `news ${JSON.stringify(states.arrived.news)}`,
  );

  const notice = states.arrived.notice;
  if (!check("the release raised an in-app notice", Boolean(notice), "no .update-notice in the page")) {
    console.error(`[update-poll] dom: ${JSON.stringify(states.arrived, null, 2)}`);
    throw new Error("no notice rendered");
  }
  check(
    "the notice names the release",
    notice.version === NEWER_VERSION &&
      notice.text.includes(`LifeQuest ${NEWER_VERSION} is available`) &&
      notice.text.includes(`v${APP_VERSION}`),
    `version ${JSON.stringify(notice.version)}, text ${JSON.stringify(notice.text)}`,
  );
  check(
    "the notice is a polite status region, not a modal",
    notice.role === "status" &&
      notice.live === "polite" &&
      (notice.label ?? "").includes(NEWER_VERSION),
    `role ${notice.role}, live ${notice.live}, label ${JSON.stringify(notice.label)}`,
  );
  check(
    "the notice offers the upgrade and a dismissal",
    notice.buttons.some((button) => button.label.startsWith("Open the LifeQuest")) &&
      notice.buttons.some((button) => button.label === "Dismiss the update notice"),
    `buttons ${JSON.stringify(notice.buttons)}`,
  );
  check(
    "the notice is on screen, inside the window",
    notice.visible &&
      notice.box.width > 0 &&
      notice.box.height > 0 &&
      notice.box.left >= 0 &&
      notice.box.top >= 0 &&
      notice.box.right <= states.arrived.viewport.width &&
      notice.box.bottom <= states.arrived.viewport.height,
    `visible ${notice.visible}, box ${JSON.stringify(notice.box)}, viewport ${JSON.stringify(states.arrived.viewport)}`,
  );
  check(
    "the notice does not take the dialog with it",
    states.arrived.dialog === null,
    `dialog ${JSON.stringify(states.arrived.dialog)}`,
  );
  states.toastScreenshot = await shoot("update-poll-toast.png");
  check(
    "the notice's picture is a real capture",
    !states.toastScreenshot.empty &&
      states.toastScreenshot.width > 0 &&
      states.toastScreenshot.height > 0,
    `screenshot ${JSON.stringify(states.toastScreenshot)}`,
  );

  stage = "wait for later ticks";
  // ── 4 — the same release on later ticks is not re-announced ───────────────
  const feedAtFirstNews = feed.counts.feed;
  const reannounceDeadline = Date.now() + 15_000;
  while (feed.counts.feed < feedAtFirstNews + 2 && Date.now() < reannounceDeadline) {
    await sleep(40);
  }
  const repeated = await sample();
  states.repeated = repeated;
  check(
    "the watch kept reading after the release was announced",
    feed.counts.feed >= feedAtFirstNews + 2,
    `the feed saw ${feed.counts.feed}, wanted ${feedAtFirstNews + 2}`,
  );
  check(
    "the same release is announced once, not on every tick",
    repeated.news?.length === 1,
    `news ${JSON.stringify(repeated.news)}`,
  );
  check(
    "the notice is still there after the later ticks",
    repeated.notice?.version === NEWER_VERSION && repeated.notice?.visible === true,
    `notice ${JSON.stringify(repeated.notice)}`,
  );

  stage = "a failing feed";
  // ── 5 — a watch read that fails is quiet, and does not erase the offer ────
  const errorsBefore = feed.counts.errors;
  feed.setScenario("broken");
  const failDeadline = Date.now() + 15_000;
  while (feed.counts.errors < errorsBefore + 2 && Date.now() < failDeadline) {
    await sleep(40);
  }
  const failedReads = await sample();
  states.failedReads = failedReads;
  check(
    "the failing reads really reached the feed",
    feed.counts.errors >= errorsBefore + 2,
    `the feed saw ${feed.counts.errors} failed reads, wanted ${errorsBefore + 2}`,
  );
  check(
    "a watch read that fails reports nothing",
    failedReads.news?.length === 1,
    `news ${JSON.stringify(failedReads.news)}`,
  );
  check(
    "a watch read that fails leaves the notice alone",
    failedReads.notice?.version === NEWER_VERSION && failedReads.notice?.visible === true,
    `notice ${JSON.stringify(failedReads.notice)}`,
  );
  // The offer the operator can still install must survive those failures: the
  // session's cached answer is what `update:install` validates against.
  const afterFailures = await run(`window.lifequest.updateCheck()`);
  states.afterFailures = afterFailures;
  check(
    "a failed watch read does not erase the session's answered offer",
    afterFailures?.ok === true &&
      afterFailures.decision?.state === "available" &&
      afterFailures.decision?.latest === NEWER_VERSION,
    `answer ${JSON.stringify(afterFailures)}`,
  );

  stage = "wait for the withdrawal";
  // ── 6 — the release is withdrawn: the notice goes with the offer ──────────
  feed.setScenario("same");
  const withdrawn = await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const sampleNow = await sample();
      if ((sampleNow.news?.length ?? 0) >= 2) return sampleNow;
      if (Date.now() > deadline) throw new Error("the watch never reported the withdrawal");
      await sleep(50);
    }
  })();
  states.withdrawn = withdrawn;
  check(
    "a release that stops being offered is reported",
    withdrawn.news?.[1]?.state === "current",
    `news ${JSON.stringify(withdrawn.news)}`,
  );
  check(
    "a withdrawn release takes its notice with it",
    withdrawn.notice === null,
    `notice ${JSON.stringify(withdrawn.notice)}`,
  );

  stage = "wait for the re-published release";
  // ── 7 — the release comes back: it is news again ──────────────────────────
  feed.setScenario("newer");
  await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const sampleNow = await sample();
      if (sampleNow.notice?.version === NEWER_VERSION) return;
      if (Date.now() > deadline) throw new Error("the re-published release was never announced");
      await sleep(50);
    }
  })();
  await waitForNoticeShown();
  const returned = await sample();
  states.returned = returned;
  check(
    "a release that comes back is announced again",
    (returned.news?.length ?? 0) >= 3 &&
      returned.news?.[2]?.state === "available" &&
      returned.news?.[2]?.latest === NEWER_VERSION,
    `news ${JSON.stringify(returned.news)}`,
  );
  check(
    "the returning notice names the release",
    returned.notice?.version === NEWER_VERSION && returned.notice?.visible === true,
    `notice ${JSON.stringify(returned.notice)}`,
  );

  stage = "open the dialog";
  // ── 8 — "View update" opens the real upgrade dialog ───────────────────────
  const opened = await click('.update-notice button[aria-label^="Open the LifeQuest"]');
  check("the notice's action is clickable", opened, "no View update control");
  const dialog = await waitFor(
    "(() => { const el = document.querySelector('.update-dialog'); return el ? true : null; })()",
    "the upgrade dialog",
  );
  check("clicking View update opens the dialog", Boolean(dialog), "no .update-dialog in the page");
  const openedState = await sample();
  states.opened = openedState;
  check(
    "the dialog is the real offer for the release the notice named",
    openedState.dialog?.view === "offer" &&
      openedState.dialog?.version === NEWER_VERSION &&
      (openedState.dialog?.title ?? "").includes(NEWER_VERSION),
    `dialog ${JSON.stringify(openedState.dialog)}`,
  );
  check(
    "the dialog is the same one the build number opens: it offers the install",
    openedState.dialog?.buttons.some((button) =>
      button.label.includes("Download and install"),
    ) &&
      openedState.dialog?.buttons.some((button) => button.label.includes("Not now")),
    `buttons ${JSON.stringify(openedState.dialog?.buttons)}`,
  );
  states.dialogScreenshot = await shoot("update-poll-dialog.png");
  check(
    "the dialog's picture is a real capture",
    !states.dialogScreenshot.empty &&
      states.dialogScreenshot.width > 0 &&
      states.dialogScreenshot.height > 0,
    `screenshot ${JSON.stringify(states.dialogScreenshot)}`,
  );

  // "Not now" closes the dialog and leaves the notice; the news is not lost by
  // looking at it.
  await click('.update-dialog button[aria-label="Not now"]');
  const afterNotNow = await waitFor(
    "(() => { const el = document.querySelector('.update-dialog'); return el ? null : true; })()",
    "the dialog to close",
  );
  const closedState = await sample();
  states.closed = closedState;
  check("Not now closes the dialog", Boolean(afterNotNow), "the dialog stayed open");
  check(
    "closing the dialog leaves the notice in place",
    closedState.notice?.version === NEWER_VERSION && closedState.notice?.visible === true,
    `notice ${JSON.stringify(closedState.notice)}`,
  );

  stage = "dismiss the notice";
  // ── 9 — dismissing the notice ends it for this release ────────────────────
  const dismissed = await click(".update-notice__dismiss");
  check("the notice can be dismissed", dismissed, "no dismiss control");
  await waitFor(
    "(() => document.querySelector('.update-notice') ? null : true)()",
    "the notice to be dismissed",
  );
  const dismissedState = await sample();
  states.dismissed = dismissedState;
  check(
    "dismissing removes the notice",
    dismissedState.notice === null,
    `notice ${JSON.stringify(dismissedState.notice)}`,
  );

  const feedAtDismiss = feed.counts.feed;
  const stayDismissedDeadline = Date.now() + 15_000;
  while (feed.counts.feed < feedAtDismiss + 2 && Date.now() < stayDismissedDeadline) {
    await sleep(40);
  }
  const stayedDismissed = await sample();
  states.stayedDismissed = stayedDismissed;
  check(
    "the watch kept reading after the dismissal",
    feed.counts.feed >= feedAtDismiss + 2,
    `the feed saw ${feed.counts.feed}, wanted ${feedAtDismiss + 2}`,
  );
  check(
    "a dismissed notice does not come back for the same release",
    stayedDismissed.notice === null && stayedDismissed.news?.length === 3,
    `notice ${JSON.stringify(stayedDismissed.notice)}, news ${JSON.stringify(stayedDismissed.news)}`,
  );

  states.feedAtEnd = { ...feed.counts };
  states.navigations = navigationLog;
}

const REPORT_NOTE = "the run never reached its report";
let report = { pass: false, failures, note: REPORT_NOTE };

function writeReport() {
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `${JSON.stringify(
        { ranAt: new Date().toISOString(), states, failures, pass: failures.length === 0 },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    console.error(`update-poll: could not write the report: ${error}`);
  }
}

app.on("window-all-closed", () => {});

process.on("exit", writeReport);

app
  .whenReady()
  .then(async () => {
    try {
      await main();
      report = {
        ranAt: new Date().toISOString(),
        stage,
        states,
        failures,
        pass: failures.length === 0,
      };
    } catch (error) {
      report = {
        ranAt: new Date().toISOString(),
        stage,
        states,
        failures: [
          ...failures,
          `threw at ${stage}: ${error instanceof Error ? error.message : String(error)}`,
        ],
        pass: false,
      };
    }
    writeReport();

    console.log("");
    console.log(`launch feed requests: ${states.launch?.feedRequests ?? "—"}`);
    console.log(`notice:  ${states.arrived?.notice?.text ?? "—"}`);
    console.log(`dialog:  ${states.opened?.dialog?.title ?? "—"}`);
    console.log(`news:    ${JSON.stringify(states.returned?.news ?? [])}`);
    console.log(`polls:   ${JSON.stringify(states.feedAtEnd ?? {})}`);
    console.log(`shots:   ${JSON.stringify([states.toastScreenshot?.file, states.dialogScreenshot?.file])}`);
    console.log(`report: ${REPORT}`);
    for (const failure of report.failures) console.log(`FAIL ${failure}`);
    console.log(report.pass ? "update poll: PASS" : "update poll: FAIL");

    app.exit(report.pass ? 0 : 1);
  })
  .catch((error) => {
    console.error(`update-poll: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
