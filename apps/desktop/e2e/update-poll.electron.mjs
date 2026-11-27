/**
 * The wired-app acceptance run for the update watch: the REAL LifeQuest main
 * process, the REAL preload, and the REAL renderer against a release feed this
 * rig owns, whose newest release changes *while the app is running*.
 *
 * There is no in-window notice card any more. The operator asked for it gone:
 * the watch's news surfaces through the dock action bar's build number — its
 * glow, the "Update available" caption beside it, and the real dialog that
 * number opens — plus the OS notification main raises. This rig proves that
 * world, and the absence of the card is a measurement in every sample:
 * `noticeCount` is the number of `.update-notice` elements in the page, and it
 * is asserted to be 0 at every step.
 *
 * `update-badge.electron.mjs` proves the badge, its caption and the dialog
 * against a stubbed bridge, including the thin rail where the words retreat.
 * `update-install.electron.mjs` proves the feed rules and the download against
 * the real main. This rig covers the fact neither of those can reach:
 *
 *   · a release published after launch reaches the renderer with no click, no
 *     reload and no card — main's watch reads the feed on its own clock, pushes
 *     the answer over IPC, and the dock's build number starts to glow;
 *   · the glow is not announced twice on later ticks (the caption and the offer
 *     are the whole surface, so "once" is a quiet bar, not a card count);
 *   · a watch read that fails is quiet and does not erase the offer the operator
 *     can still install;
 *   · a release that stops being offered clears the glow and its caption, and a
 *     release that comes back glows again;
 *   · clicking the glowing build number opens the real upgrade dialog, and
 *     "Not now" closes it without losing the offer.
 *
 * The app has to reach its dock: the badge lives at the top of the rail, in the
 * version slot under the lockup, and the notice this rig used to sample lived
 * above every route. So this rig is the old one plus a throwaway world — a vault
 * created in the temp dir and a
 * `recent.json` that reopens it, a Pi endpoint pointing at the rig's own server
 * so the companion gate answers ready, and free MCP doors — and NOTHING else
 * changes. The operator's profile and vault are never read.
 *
 * ── every way this could fail, written down before the code ───────────────────
 *
 *  1. The app never reaches the dock, so the badge is absent — a broken
 *     `recent.json`/endpoint seed, or the companion gate stuck on its setup
 *     screen. The rig names the screen it actually landed on.
 *  2. The launch check offers nothing, yet the build number glows (or carries
 *     `data-update-state="available"`), or a caption is already beside it.
 *  3. The popup comes back: `.update-notice` is in the DOM, or a dialog is open
 *     before the operator clicked anything.
 *  4. The watch's news never reaches the renderer, so a release published while
 *     the app runs is invisible.
 *  5. The news arrives but the badge does not turn state: no
 *     `.update-badge--available`, the wrong `data-update-version`, or no caption
 *     (in the bar, even if the shipped dock's card retires the words).
 *  6. The caption is not the rail's version slot's own element immediately before
 *     the badge, or the number leaves the version slot for the dock's bar.
 *  7. The same release on later ticks raises a second surface — an alert, a
 *     dialog, a notice, or a second caption — instead of the badge simply
 *     staying on.
 *  8. A 500 from the feed clears the offer or adds an error surface: the watch
 *     failing is not the release being withdrawn.
 *  9. A withdrawn release leaves the glow or its caption on screen.
 * 10. A returned release does not glow again.
 * 11. Clicking the glowing build number opens nothing, opens a weaker offer, or
 *     opens it without the release the badge names.
 * 12. "Not now" closes the dialog but loses the offer, or the badge stops being
 *     the bar's last control afterwards.
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile, keeps the
 * window off the operator's desktop, replaces the feed with this rig's server,
 * and shortens the watch's interval through the seam — the product reads every
 * hour; a rig that waited that long would not be testing the watch at all.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/update-poll.electron.mjs
 *
 * The report is the artifact: `e2e/artifacts/update-poll.json`, with two PNGs of
 * the shipped screen (the glowing badge in its bar, and the dialog it opens).
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
// The real vault creator, so the app opens a throwaway vault of its own: the
// operator's profile and vault are never read or written by this rig.
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "update-poll.json");

/**
 * The build under test, off the app's own `package.json` — the same file the
 * updater compares against and the badge names. The offered release is a fixed
 * fixture that has to stay ahead of it; the sweep asserts that rather than
 * assuming it, so a future release does not silently turn every step below into
 * a test of the "up to date" branch.
 */
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;
const NEWER_VERSION = "0.9.0";

/** The rig's cadence. Far below the product's, and only this run's. */
const POLL_MS = 400;

/** The built-in companion's fake endpoint: one model, known to the app. */
const PI_MODEL = "e2e-update-poll-model";

/** The caption the shipped bar draws beside a glowing build number. */
const CAPTION_TEXT = "Update available";

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
 * watch tick cannot turn into an answer. The same server answers the built-in
 * companion's `GET /v1/models` probe, so the app's companion gate reaches ready
 * and the real dock mounts; that route is not part of the update claims.
 */
function startFeed() {
  let scenario = "same";
  let base = "";
  const counts = { feed: 0, errors: 0, models: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (url.pathname === "/v1/models") {
      counts.models += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: PI_MODEL, object: "model", owned_by: "e2e" }],
        }),
      );
      return;
    }
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

/** Two free loopback ports, so the app's MCP doors never touch the operator's. */
function freePorts(count) {
  return Promise.all(
    Array.from({ length: count }, () => {
      return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({ port: 0, host: "127.0.0.1" }, () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : 0;
          server.close(() => resolve(port));
        });
      });
    }),
  );
}

/**
 * What the renderer currently draws, in one sample.
 *
 * `noticeCount` is deliberately the first field: the in-window card was removed,
 * so every step of this run is also a measured claim that it did not come back.
 * The badge is reported by class and by its data attributes, and the caption is
 * reported as its own element immediately before the badge in the rail's version
 * slot — the absence of a card is only half the story; the presence of the glow
 * and its sentence is the other half.
 */
const SAMPLE = `(() => {
  try {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0
    );
  };
  const buttons = (root) =>
    Array.from(root.querySelectorAll('button')).map((el) => ({
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
      disabled: el.disabled === true,
    }));
  const badge = document.querySelector('.update-badge');
  const captions = Array.from(document.querySelectorAll('.update-badge__label'));
  const caption = badge ? badge.previousElementSibling : captions[0] ?? null;
  const captionEl =
    caption && caption.classList && caption.classList.contains('update-badge__label')
      ? caption
      : captions[0] ?? null;
  // The badge's home: the rail's version slot at the top of the column, inside
  // the header directly under the lockup. The slot is what the news lands in now
  // that the dock's bar no longer carries the build number, and the foot below is
  // one row (Log, vault chip, collapse toggle) with no caption row in it.
  const versionSlot = document.querySelector('.nav-rail__version');
  const railHeader = document.querySelector('.nav-rail__header');
  const footerRow = document.querySelector('.nav-rail__foot-row');
  const versionControls = versionSlot
    ? Array.from(versionSlot.querySelectorAll('button'))
    : [];
  const dialog = document.querySelector('.update-dialog');
  return {
    noticeCount: document.querySelectorAll('.update-notice').length,
    noticeAttributeCount: document.querySelectorAll('[data-update-notice]').length,
    badgeCount: document.querySelectorAll('.update-badge').length,
    captionCount: captions.length,
    alertCount: document.querySelectorAll('[role="alert"]').length,
    route: window.location.hash || window.location.pathname,
    surface: document.querySelector('.chat-panel')
      ? document.querySelector('.chat-panel').getAttribute('data-chat-surface')
      : null,
    hasShell: Boolean(document.querySelector('.shell')),
    hasVersionSlot: Boolean(versionSlot),
    companionSetup: Boolean(
      document.querySelector('.companion-setup, .companion-setup-screen, .splash-screen'),
    ),
    badge: badge
      ? {
          className: badge.className,
          available: badge.classList.contains('update-badge--available'),
          dataState: badge.getAttribute('data-update-state'),
          dataVersion: badge.getAttribute('data-update-version'),
          dataPreview: badge.getAttribute('data-update-preview'),
          ariaLabel: badge.getAttribute('aria-label'),
          ariaHaspopup: badge.getAttribute('aria-haspopup'),
          ariaExpanded: badge.getAttribute('aria-expanded'),
          text: (badge.textContent ?? '').trim(),
          box: box(badge),
          visible: visible(badge),
          inVersion: Boolean(versionSlot && versionSlot.contains(badge)),
          inHeader: Boolean(railHeader && railHeader.contains(badge)),
          inFoot: Boolean(footerRow && footerRow.contains(badge)),
          inDockBar: Boolean(
            document.querySelector('.chat-panel__actions')?.contains(badge)
          ),
          lastControlInVersion: versionControls.length
            ? versionControls[versionControls.length - 1] === badge
            : null,
        }
      : null,
    caption: captionEl
      ? {
          tag: captionEl.tagName.toLowerCase(),
          text: (captionEl.textContent ?? '').trim(),
          display: getComputedStyle(captionEl).display,
          dataLabel: captionEl.getAttribute('data-update-label'),
          inVersion: Boolean(versionSlot && versionSlot.contains(captionEl)),
          immediatelyBeforeBadge:
            Boolean(badge) && captionEl.nextElementSibling === badge,
          box: box(captionEl),
          visible: visible(captionEl),
        }
      : null,
    version: versionSlot
      ? {
          box: box(versionSlot),
          inHeader: Boolean(railHeader && railHeader.contains(versionSlot)),
          lastControlIsBadge: versionControls.length
            ? versionControls[versionControls.length - 1] === badge
            : null,
          containsBadge: Boolean(badge && versionSlot.contains(badge)),
          controls: versionControls.map((el) => (el.getAttribute('aria-label') ?? '').trim()),
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
  const [mcpLocal, mcpInvite] = await freePorts(2);

  // A throwaway world: the profile, the vault it reopens, and the endpoint that
  // lets the built-in companion answer ready. Nothing here is the operator's.
  const world = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-update-poll-")));
  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  fs.mkdirSync(profileDir, { recursive: true });
  const created = await createVault(vaultDir, "Update Poll");
  if (!created.ok) throw new Error(`the throwaway vault could not be created: ${created.error}`);

  // The app reopens `recent[0]` on a cold start. The harness choice is Pi so the
  // companion gate never probes the operator's Hermes install; the profile name
  // only matters if a Hermes call sneaks in, and it must not be the operator's.
  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: created.value.lifequest.id,
            name: "Update Poll",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: "e2e-update-poll",
        harness: "pi",
      },
      null,
      2,
    )}\n`,
  );

  // The built-in companion's endpoint, in the throwaway profile. It is loopback,
  // so no key is needed; `GET /v1/models` answers from the rig's own server.
  fs.writeFileSync(
    path.join(profileDir, "pi-endpoint.json"),
    `${JSON.stringify(
      {
        baseUrl: `${feed.base}/v1`,
        model: PI_MODEL,
        providerName: "E2E update rig",
      },
      null,
      2,
    )}\n`,
  );

  // Seeded before main.js is imported: the module reads the seam at load.
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    mcpPorts: { local: mcpLocal, invite: mcpInvite },
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
  // in it, so the badge's halo would sit frozen and every "is it on screen"
  // question would be a question about a frozen page. A rig window on the bench's
  // own X display is the product's frame.
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

  const sample = async () => {
    const value = await run(SAMPLE);
    if (value && value.sampleError) {
      throw new Error(`page sample failed: ${value.sampleError}`);
    }
    return value;
  };

  /** Everything the page can say about why the dock never arrived. */
  const pageDiagnosis = () =>
    run(`(() => ({
      readyState: document.readyState,
      route: window.location.hash || window.location.pathname,
      title: document.title,
      rootChildren: document.querySelector('#root')?.childElementCount ?? null,
      hasShell: Boolean(document.querySelector('.shell')),
      hasVersionSlot: Boolean(document.querySelector('.nav-rail__version')),
      hasBadge: Boolean(document.querySelector('.update-badge')),
      hasChatPanel: Boolean(document.querySelector('.chat-panel')),
      hasWelcome: Boolean(document.querySelector('.welcome')),
      hasCompanionSetup: Boolean(document.querySelector('.companion-setup, .companion-setup-screen')),
      bodyText: (document.body.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      hasBridge: Boolean(window.lifequest && window.lifequest.updateCheck),
      newsCount: Array.isArray(window.__updateNews) ? window.__updateNews.length : null,
    }))()`);

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

  stage = "wait for the bridge and the dock";
  // The bridge is live as soon as the preload has run, before React mounts.
  await waitFor("Boolean(window.lifequest && window.lifequest.updateCheck)", "the preload bridge");
  // The badge lives at the top of the rail, so this is also the claim that the
  // real app opened a vault and reached its studio rather than the welcome or
  // companion-setup screen.
  try {
    await waitFor(
      "(() => document.querySelector('.update-badge') ? true : null)()",
      "the dock's update badge",
      60_000,
    );
  } catch (error) {
    throw new Error(
      `${error.message}; the page reported ${JSON.stringify(await pageDiagnosis())}; ` +
        `renderer errors: ${JSON.stringify(rendererErrors.slice(-4))}`,
    );
  }

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
  // ── 1 — launch with nothing to offer: a resting build number, no offer ────
  await sleep(600);
  const launch = await sample();
  states.launch = { feedRequests: launchRequests, ...launch };
  check(
    "the launch reaches the rail's version slot",
    launch.hasVersionSlot === true && launch.badge?.inVersion === true,
    `version slot ${launch.hasVersionSlot}, badge in version slot ${launch.badge?.inVersion}`,
  );
  check(
    "a launch with no newer release leaves the build number at rest",
    launch.badge?.available === false && launch.badge?.dataState !== "available",
    `badge class ${JSON.stringify(launch.badge?.className)}, state ${JSON.stringify(launch.badge?.dataState)}`,
  );
  check(
    "a launch with no newer release draws no caption",
    launch.captionCount === 0 && launch.caption === null,
    `captions ${JSON.stringify(launch.caption)} (count ${launch.captionCount})`,
  );
  check(
    "a launch with no newer release shows no in-app notice",
    launch.noticeCount === 0 && launch.noticeAttributeCount === 0,
    `noticeCount ${launch.noticeCount}, data-update-notice count ${launch.noticeAttributeCount}`,
  );
  check(
    "a launch with no newer release opens no dialog by itself",
    launch.dialog === null && launch.alertCount === 0,
    `dialog ${JSON.stringify(launch.dialog)}, alerts ${launch.alertCount}`,
  );
  check(
    "the build number is the rail's version line, under the lockup",
    launch.badge?.inVersion === true &&
      launch.version?.containsBadge === true &&
      launch.badge?.inDockBar === false &&
      launch.badge?.inFoot === false &&
      launch.version?.lastControlIsBadge === true,
    `version slot controls ${JSON.stringify(launch.version?.controls)}`,
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

  const arrivedNews = await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const news = await run("Array.isArray(window.__updateNews) ? window.__updateNews.length : 0");
      if (news > 0) return news;
      if (Date.now() > deadline) throw new Error("the watch never reported the new release");
      await sleep(50);
    }
  })();
  // The badge's glow is React state drawn after the push lands; wait for the
  // class the operator would see, not for the IPC frame.
  await waitFor(
    `(() => {
      const el = document.querySelector('.update-badge');
      return el &&
        el.classList.contains('update-badge--available') &&
        el.getAttribute('data-update-version') === ${JSON.stringify(NEWER_VERSION)}
        ? true
        : null;
    })()`,
    "the glowing build number",
  );
  await sleep(200);
  states.arrived = await sample();
  check(
    "the watch read the feed again without anyone clicking",
    feed.counts.feed > feedAtPublish,
    `the feed saw ${feed.counts.feed} requests, unchanged from ${feedAtPublish}`,
  );
  check(
    "the watch reported the release over IPC",
    arrivedNews >= 1 &&
      states.arrived.news?.[0]?.state === "available" &&
      states.arrived.news?.[0]?.latest === NEWER_VERSION,
    `news ${JSON.stringify(states.arrived.news)}`,
  );

  const arrived = states.arrived;
  if (
    !check(
      "the release turns the build number into the offer",
      arrived.badge?.available === true,
      `badge ${JSON.stringify(arrived.badge)}`,
    )
  ) {
    console.error(`[update-poll] dom: ${JSON.stringify(arrived, null, 2)}`);
    throw new Error("the badge never turned available");
  }
  check(
    "the glowing build number carries the offered version",
    arrived.badge?.dataState === "available" &&
      arrived.badge?.dataVersion === NEWER_VERSION,
    `state ${JSON.stringify(arrived.badge?.dataState)}, version ${JSON.stringify(arrived.badge?.dataVersion)}`,
  );
  // The card is gone: the glow and its sentence are the whole surface, so "once"
  // means the bar is quiet on later ticks, not that a card was skipped.
  check(
    "the offer raises no in-app notice",
    arrived.noticeCount === 0 && arrived.noticeAttributeCount === 0,
    `noticeCount ${arrived.noticeCount}, data-update-notice count ${arrived.noticeAttributeCount}`,
  );
  check(
    "the offer opens no dialog by itself",
    arrived.dialog === null && arrived.alertCount === 0,
    `dialog ${JSON.stringify(arrived.dialog)}, alerts ${arrived.alertCount}`,
  );
  // The badge is at the top of the rail, in the version slot under the lockup:
  // the glow and its sentence are the whole surface, and the caption sits inline
  // before the number whenever the offer is up.
  check(
    "the offer puts a caption immediately before the build number",
    arrived.captionCount === 1 &&
      arrived.caption?.text === CAPTION_TEXT &&
      arrived.caption?.inVersion === true &&
      arrived.caption?.immediatelyBeforeBadge === true &&
      arrived.caption?.visible === true,
    `caption ${JSON.stringify(arrived.caption)} (count ${arrived.captionCount})`,
  );
  check(
    "the glowing build number is still the rail's version-line number",
    arrived.badge?.inVersion === true &&
      arrived.version?.containsBadge === true &&
      arrived.badge?.inDockBar === false &&
      arrived.badge?.inFoot === false &&
      arrived.version?.lastControlIsBadge === true,
    `badge ${JSON.stringify(arrived.badge?.box)}, version slot controls ${JSON.stringify(arrived.version?.controls)}`,
  );
  // The shipped screen, as the handover points at it: the glowing build number
  // under the lockup at the top of the rail.
  states.badgeScreenshot = await shoot("update-poll-badge.png");
  check(
    "the badge's picture is a real capture",
    !states.badgeScreenshot.empty &&
      states.badgeScreenshot.width > 0 &&
      states.badgeScreenshot.height > 0,
    `screenshot ${JSON.stringify(states.badgeScreenshot)}`,
  );

  stage = "wait for later ticks";
  // ── 4 — the same release on later ticks raises nothing new ────────────────
  const feedAtFirstNews = feed.counts.feed;
  const repeatDeadline = Date.now() + 15_000;
  while (feed.counts.feed < feedAtFirstNews + 2 && Date.now() < repeatDeadline) {
    await sleep(40);
  }
  const repeated = await sample();
  states.repeated = repeated;
  check(
    "the watch kept reading after the release arrived",
    feed.counts.feed >= feedAtFirstNews + 2,
    `the feed saw ${feed.counts.feed}, wanted ${feedAtFirstNews + 2}`,
  );
  check(
    "the same release is reported once, not on every tick",
    repeated.news?.length === 1,
    `news ${JSON.stringify(repeated.news)}`,
  );
  check(
    "later ticks keep the glow on",
    repeated.badge?.available === true &&
      repeated.badge?.dataVersion === NEWER_VERSION &&
      repeated.caption?.text === CAPTION_TEXT,
    `badge ${JSON.stringify(repeated.badge)}, caption ${JSON.stringify(repeated.caption)}`,
  );
  check(
    "later ticks raise no notice, alert or dialog",
    repeated.noticeCount === 0 &&
      repeated.alertCount === 0 &&
      repeated.dialog === null &&
      repeated.captionCount === 1,
    `noticeCount ${repeated.noticeCount}, alerts ${repeated.alertCount}, dialog ${JSON.stringify(repeated.dialog)}, captions ${repeated.captionCount}`,
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
    "a watch read that fails leaves the glow and its caption alone",
    failedReads.badge?.available === true &&
      failedReads.badge?.dataVersion === NEWER_VERSION &&
      failedReads.caption?.text === CAPTION_TEXT,
    `badge ${JSON.stringify(failedReads.badge)}, caption ${JSON.stringify(failedReads.caption)}`,
  );
  check(
    "a failing read raises no notice, alert or dialog",
    failedReads.noticeCount === 0 &&
      failedReads.alertCount === 0 &&
      failedReads.dialog === null,
    `noticeCount ${failedReads.noticeCount}, alerts ${failedReads.alertCount}, dialog ${JSON.stringify(failedReads.dialog)}`,
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
  // ── 6 — the release is withdrawn: the glow goes with the offer ────────────
  feed.setScenario("same");
  await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const sampleNow = await sample();
      if (
        (sampleNow.news?.length ?? 0) >= 2 &&
        sampleNow.badge?.available === false
      ) {
        return;
      }
      if (Date.now() > deadline) throw new Error("the watch never reported the withdrawal");
      await sleep(50);
    }
  })();
  await sleep(200);
  const withdrawn = await sample();
  states.withdrawn = withdrawn;
  check(
    "a release that stops being offered is reported",
    withdrawn.news?.[1]?.state === "current",
    `news ${JSON.stringify(withdrawn.news)}`,
  );
  check(
    "a withdrawn release clears the glow",
    withdrawn.badge?.available === false && withdrawn.badge?.dataState !== "available",
    `badge ${JSON.stringify(withdrawn.badge)}`,
  );
  check(
    "a withdrawn release takes its caption and its version with it",
    withdrawn.captionCount === 0 && withdrawn.caption === null,
    `caption ${JSON.stringify(withdrawn.caption)} (count ${withdrawn.captionCount})`,
  );
  check(
    "a withdrawn release leaves no notice behind",
    withdrawn.noticeCount === 0 && withdrawn.noticeAttributeCount === 0,
    `noticeCount ${withdrawn.noticeCount}`,
  );

  stage = "wait for the re-published release";
  // ── 7 — the release comes back: it glows again ────────────────────────────
  feed.setScenario("newer");
  await (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const sampleNow = await sample();
      if (
        (sampleNow.news?.length ?? 0) >= 3 &&
        sampleNow.badge?.available === true &&
        sampleNow.caption?.text === CAPTION_TEXT
      ) {
        return;
      }
      if (Date.now() > deadline) throw new Error("the re-published release never glowed");
      await sleep(50);
    }
  })();
  await sleep(200);
  const returned = await sample();
  states.returned = returned;
  check(
    "a release that comes back is reported again",
    (returned.news?.length ?? 0) >= 3 &&
      returned.news?.[2]?.state === "available" &&
      returned.news?.[2]?.latest === NEWER_VERSION,
    `news ${JSON.stringify(returned.news)}`,
  );
  check(
    "the returned release glows with its version and caption",
    returned.badge?.available === true &&
      returned.badge?.dataVersion === NEWER_VERSION &&
      returned.caption?.text === CAPTION_TEXT &&
      returned.captionCount === 1,
    `badge ${JSON.stringify(returned.badge)}, caption ${JSON.stringify(returned.caption)}`,
  );
  check(
    "the returned release raises no notice",
    returned.noticeCount === 0 && returned.noticeAttributeCount === 0,
    `noticeCount ${returned.noticeCount}`,
  );

  stage = "open the dialog";
  // ── 8 — the glowing build number opens the real upgrade dialog ────────────
  const opened = await click(".update-badge");
  check("the glowing build number is clickable", opened, "no .update-badge to click");
  await waitFor(
    "(() => { const el = document.querySelector('.update-dialog'); return el ? true : null; })()",
    "the upgrade dialog",
  );
  await sleep(200);
  const openedState = await sample();
  states.opened = openedState;
  check(
    "clicking the glowing build number opens the dialog",
    openedState.dialog !== null,
    "no .update-dialog in the page",
  );
  check(
    "the dialog is the real offer for the release the badge names",
    openedState.dialog?.view === "offer" &&
      openedState.dialog?.version === NEWER_VERSION &&
      (openedState.dialog?.title ?? "").includes(NEWER_VERSION),
    `dialog ${JSON.stringify(openedState.dialog)}`,
  );
  check(
    "the dialog is the same one the build number always opened: it offers the install",
    openedState.dialog?.buttons.some((button) =>
      button.label.includes("Download and install"),
    ) &&
      openedState.dialog?.buttons.some((button) => button.label.includes("Not now")),
    `buttons ${JSON.stringify(openedState.dialog?.buttons)}`,
  );
  check(
    "the dialog arrives without the card",
    openedState.noticeCount === 0 && openedState.noticeAttributeCount === 0,
    `noticeCount ${openedState.noticeCount}`,
  );
  states.dialogScreenshot = await shoot("update-poll-dialog.png");
  check(
    "the dialog's picture is a real capture",
    !states.dialogScreenshot.empty &&
      states.dialogScreenshot.width > 0 &&
      states.dialogScreenshot.height > 0,
    `screenshot ${JSON.stringify(states.dialogScreenshot)}`,
  );

  // "Not now" closes the dialog and leaves the glow: the news is not lost by
  // looking at it.
  await click('.update-dialog button[aria-label="Not now"]');
  await waitFor(
    "(() => { const el = document.querySelector('.update-dialog'); return el ? null : true; })()",
    "the dialog to close",
  );
  await sleep(200);
  const closedState = await sample();
  states.closed = closedState;
  check("Not now closes the dialog", closedState.dialog === null, "the dialog stayed open");
  check(
    "closing the dialog leaves the glow and its caption in place",
    closedState.badge?.available === true &&
      closedState.badge?.dataVersion === NEWER_VERSION &&
      closedState.caption?.text === CAPTION_TEXT,
    `badge ${JSON.stringify(closedState.badge)}, caption ${JSON.stringify(closedState.caption)}`,
  );
  check(
    "closing the dialog leaves the number in the rail's version slot",
    closedState.badge?.inVersion === true &&
      closedState.version?.containsBadge === true &&
      closedState.version?.lastControlIsBadge === true,
    `version slot controls ${JSON.stringify(closedState.version?.controls)}`,
  );
  check(
    "closing the dialog raises no notice",
    closedState.noticeCount === 0,
    `noticeCount ${closedState.noticeCount}`,
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
        {
          ranAt: new Date().toISOString(),
          stage,
          states,
          failures,
          pass: failures.length === 0,
        },
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
    console.log(
      `badge:   ${states.arrived?.badge?.className ?? "—"} / version ${states.arrived?.badge?.dataVersion ?? "—"}`,
    );
    console.log(`caption: ${states.arrived?.caption?.text ?? "—"}`);
    console.log(`dialog:  ${states.opened?.dialog?.title ?? "—"}`);
    console.log(`notice count: ${states.arrived?.noticeCount ?? "—"} (launch ${states.launch?.noticeCount ?? "—"})`);
    console.log(`news:    ${JSON.stringify(states.returned?.news ?? [])}`);
    console.log(`polls:   ${JSON.stringify(states.feedAtEnd ?? {})}`);
    console.log(`shots:   ${JSON.stringify([states.badgeScreenshot?.file, states.dialogScreenshot?.file])}`);
    console.log(`report: ${REPORT}`);
    for (const failure of report.failures) console.log(`FAIL ${failure}`);
    console.log(report.pass ? "update poll: PASS" : "update poll: FAIL");

    app.exit(report.pass ? 0 : 1);
  })
  .catch((error) => {
    console.error(`update-poll: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
