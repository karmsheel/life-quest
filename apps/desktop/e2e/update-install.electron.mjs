/**
 * The wired-app acceptance run for auto-update: the REAL LifeQuest main process,
 * the REAL preload, and the REAL renderer, talking to a release feed this rig
 * owns, downloading real bytes over the wire, and handing the file to a launcher
 * this rig owns.
 *
 * `update-badge.electron.mjs` proves the badge and the popup against a stubbed
 * bridge. This one covers what a stub cannot reach, and it is the reason the
 * feature can be trusted at all:
 *
 *   · the version rules, on real payloads — newer, same, older, `0.10.0` against
 *     the app's own version, a prerelease, and a tag that is not a version at all;
 *   · the one answer a session keeps, and `force` overriding it;
 *   · a feed with no release to compare against answering 404 — reported as
 *     "could not check", never as "up to date";
 *   · a release with no installer asset, which is still an available upgrade;
 *   · an installer url that is not a trusted host, refused before a byte moves;
 *   · a download that redirects off the trusted host, refused before a write;
 *   · a body that is shorter than the size the release declared — the partial
 *     file is deleted, never launched;
 *   · a real download that lands on disk byte-for-byte, and is then handed to a
 *     launcher with its own path as the argument;
 *   · two install requests in the same tick, one download: the flight is shared;
 *   · and the progress events the renderer really receives over IPC.
 *
 * Isolation: `LIFEQUEST_E2E` points the app at a throwaway profile, keeps the
 * window off the operator's desktop, and — the two seams this rig exists for —
 * moves the feed and the installer launcher to ones it owns. The operator's
 * `%APPDATA%\LifeQuest` is never opened, and no real installer is ever run.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/update-install.electron.mjs
 *
 * The report is the artifact, and the rigor is deliberate: a successful install
 * ends with the app quitting itself, so the process exit code is the app's own
 * (`app.exit(0)` out of `before-quit`) and cannot carry this rig's verdict. Every
 * assertion is therefore written into `e2e/artifacts/update-install.json`, and it
 * is rewritten from a `process.on("exit")` hook so a quit racing the run still
 * leaves the truth behind.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "update-install.json");
const FAKE_INSTALLER = path.join(here, "fixtures", "fake-installer.mjs");

/**
 * The build under test, off the app's own `package.json` — the same file the
 * updater compares against and the badge renders. Deriving it is what keeps this
 * rig from failing on the next release: `same`, `older` and `prerelease` are all
 * defined *relative* to it below.
 */
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;

/** One patch below the app's own — always older, whatever the version is. */
const OLDER_VERSION = (() => {
  const [major, minor, patch] = APP_VERSION.split(".").map((part) => parseInt(part, 10));
  return patch > 0
    ? `${major}.${minor}.${patch - 1}`
    : `${major}.${Math.max(0, minor - 1)}.0`;
})();

// Two fixtures that must stay ahead of the app, for two different reasons: `0.9.0`
// is a plain newer release, and `0.10.0` exists to be compared *numerically*
// against `0.1.x` — the pair that a text comparison would get backwards. Both are
// guarded at the end of the sweep rather than assumed.
const NEWER_VERSION = "0.9.0";
const TEN_VERSION = "0.10.0";

const failures = [];
/**
 * Every observation the run makes, at module scope rather than inside `main()`:
 * a successful install ends with the app quitting itself, so the report has to be
 * assemblable from anywhere — including the exit hook.
 */
const states = {};
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** The bytes the stub feed serves as "the installer". */
const INSTALLER_BYTES = Buffer.from(
  "MZ\u0000\u0000LifeQuest fake setup stub — not an executable; the rig only ever\n" +
    "hands this file to the fake launcher, which records its digest and exits.\n",
  "utf8",
);
const INSTALLER_SHA = crypto
  .createHash("sha256")
  .update(INSTALLER_BYTES)
  .digest("hex");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The release the feed answers with, per scenario, built off the live port. */
function payloadFor(scenario, base) {
  const asset = (name, url, size) => ({ name, browser_download_url: url, size });
  const release = (tag, assets = []) => ({
    tag_name: tag,
    name: `LifeQuest ${tag}`,
    body: "- The build number glows when a newer release exists",
    html_url: `https://github.com/karmsheel/life-quest/releases/tag/${tag}`,
    published_at: "2026-03-01T09:00:00Z",
    draft: false,
    prerelease: tag.includes("-"),
    assets,
  });

  const setupUrl = `${base}/asset/installer`;
  switch (scenario) {
    case "newer":
      return {
        status: 200,
        body: release(`v${NEWER_VERSION}`, [
          asset(`LifeQuest-${NEWER_VERSION}-win-x64.zip`, `${base}/asset/zip`, 1024),
          asset(`LifeQuest-${NEWER_VERSION}-setup.exe`, setupUrl, INSTALLER_BYTES.length),
          asset("latest.yml", `${base}/asset/yml`, 64),
        ]),
      };
    case "same":
      return {
        status: 200,
        body: release(`v${APP_VERSION}`, [
          asset(`LifeQuest-${APP_VERSION}-setup.exe`, setupUrl, 10),
        ]),
      };
    case "older":
      return {
        status: 200,
        body: release(`v${OLDER_VERSION}`, [
          asset(`LifeQuest-${OLDER_VERSION}-setup.exe`, setupUrl, 10),
        ]),
      };
    case "ten":
      return {
        status: 200,
        body: release(`v${TEN_VERSION}`, [
          asset(`LifeQuest-${TEN_VERSION}-setup.exe`, setupUrl, INSTALLER_BYTES.length),
        ]),
      };
    case "prerelease":
      return {
        status: 200,
        body: release(`v${APP_VERSION}-beta.1`, [
          asset(`LifeQuest-${APP_VERSION}-beta.1-setup.exe`, setupUrl, 10),
        ]),
      };
    case "garbage":
      return { status: 200, body: release("nightly", []) };
    case "noasset":
      return {
        status: 200,
        body: release(`v${NEWER_VERSION}`, [
          asset(`LifeQuest-${NEWER_VERSION}-win-x64.zip`, `${base}/asset/zip`, 1024),
        ]),
      };
    case "untrusted":
      return {
        status: 200,
        body: release(`v${NEWER_VERSION}`, [
          asset(
            `LifeQuest-${NEWER_VERSION}-setup.exe`,
            // Reachable (the server is bound on both stacks), and deliberately
            // not a host the policy names.
            `http://localhost:${new URL(base).port}/asset/installer`,
            INSTALLER_BYTES.length,
          ),
        ]),
      };
    case "redirect":
      return {
        status: 200,
        body: release(`v${NEWER_VERSION}`, [
          // Trusted as declared; the server sends it away to `localhost`.
          asset(
            `LifeQuest-${NEWER_VERSION}-setup.exe`,
            `${base}/redirect/untrusted`,
            INSTALLER_BYTES.length,
          ),
        ]),
      };
    case "truncated":
      return {
        status: 200,
        body: release(`v${NEWER_VERSION}`, [
          // The release declares more bytes than the body will carry.
          asset(
            `LifeQuest-${NEWER_VERSION}-setup.exe`,
            `${base}/asset/truncated`,
            INSTALLER_BYTES.length + 4096,
          ),
        ]),
      };
    case "four04":
      return { status: 404, body: { message: "Not Found" } };
    default:
      throw new Error(`unknown scenario ${scenario}`);
  }
}

/** The feed, the asset bytes, and the one redirect this rig serves. */
function startFeed() {
  let scenario = "newer";
  let base = "";
  const counts = { feed: 0, asset: 0, truncated: 0, redirect: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (url.pathname === "/releases/latest") {
      counts.feed += 1;
      const spec = payloadFor(scenario, base);
      res.writeHead(spec.status, { "content-type": "application/json" });
      res.end(JSON.stringify(spec.body));
      return;
    }
    if (url.pathname === "/asset/installer") {
      counts.asset += 1;
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(INSTALLER_BYTES.length),
      });
      res.end(INSTALLER_BYTES);
      return;
    }
    if (url.pathname === "/asset/truncated") {
      counts.truncated += 1;
      const partial = INSTALLER_BYTES.subarray(0, 64);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(partial.length),
      });
      res.end(partial);
      return;
    }
    if (url.pathname === "/redirect/untrusted") {
      counts.redirect += 1;
      res.writeHead(302, {
        location: `http://localhost:${url.port}/asset/installer`,
      });
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  });

  return new Promise((resolve, reject) => {
    // Bound on both stacks on purpose: the redirect above has to reach this same
    // server by a *different* name, so that only the trust policy changes.
    const listen = (host) =>
      new Promise((res, rej) => {
        server.once("error", rej);
        server.listen({ port: 0, host }, () => res());
      });
    (async () => {
      try {
        await listen("::");
      } catch {
        await listen("0.0.0.0");
      }
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve({
        base,
        counts,
        setScenario: (next) => {
          scenario = next;
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    })().catch(reject);
  });
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const feed = await startFeed();
  const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-update-")));
  const markerFile = path.join(workDir, "fake-installer.json");
  const profileDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-update-profile-")));

  const installerPath = path.join(
    app.getPath("temp"),
    "LifeQuest-update",
    `LifeQuest-${NEWER_VERSION}-setup.exe`,
  );
  // A left-over file from a previous run would make "the bytes landed" pass for
  // the wrong reason.
  fs.rmSync(installerPath, { force: true });
  fs.rmSync(markerFile, { force: true });

  const nodeBin = process.env.LIFEQUEST_E2E_NODE;
  if (!nodeBin || !fs.existsSync(nodeBin)) {
    throw new Error(
      "LIFEQUEST_E2E_NODE must name a node binary — the runner sets it (see tests/update-install-e2e.test.ts)",
    );
  }

  // Seeds the one seam, before main.js is imported: the module reads it at load.
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: false,
    updateFeedUrl: `${feed.base}/releases/latest`,
    updateLauncher: { exe: nodeBin, args: [FAKE_INSTALLER] },
    // Loopback over http, which is neither GitHub nor https: the policy has to
    // move for the rig to download at all, and the scenarios above move it back
    // to a host it does not name to prove the refusal still fires.
    updateTrust: { hosts: ["127.0.0.1"], allowHttp: true },
  });
  process.env.LIFEQUEST_FAKE_INSTALLER_OUT = markerFile;

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const waitFor = async (expression, label, timeoutMs = 30_000) => {
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

  // The bridge is live as soon as the preload has run, which is before the app
  // renders anything: nothing here depends on a vault or a gateway.
  await waitFor("Boolean(window.lifequest && window.lifequest.updateCheck)", "the preload bridge");

  // The launch's own check, fired by the renderer's `UpdateProvider` mounting —
  // not by anything this rig asked for. The bridge is live as soon as the preload
  // has run, which is before React mounts, so this waits for the request instead
  // of sampling whatever had happened by then.
  const launchDeadline = Date.now() + 20_000;
  while (feed.counts.feed < 1 && Date.now() < launchDeadline) {
    await sleep(50);
  }
  const launchRequests = feed.counts.feed;

  // A real listener on the real channel, so the progress events below are the
  // ones main actually sent rather than ones this rig invented.
  await run(`(() => {
    window.__progress = [];
    window.lifequest.onUpdateProgress((p) => window.__progress.push(p));
    return true;
  })()`);

  const decide = async (scenario) => {
    feed.setScenario(scenario);
    return run(`window.lifequest.updateCheck({ force: true })`);
  };

  // ── 1 — the launch's own check, once ──────────────────────────────────────
  states.fixtures = { appVersion: APP_VERSION, older: OLDER_VERSION, newer: NEWER_VERSION, ten: TEN_VERSION };
  const asNumbers = (text) => text.split(".").map((part) => parseInt(part, 10));
  const greater = (a, b) => {
    const left = asNumbers(a);
    const right = asNumbers(b);
    for (let i = 0; i < 3; i += 1) {
      if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0);
    }
    return false;
  };
  // The fixtures have to still mean what the sweep below says: `older` below this
  // build and the two fixed ones above it. A version that made one of them false
  // would turn that step into a test of a different branch, and pass regardless.
  check(
    "the fixture versions still bracket this build",
    greater(APP_VERSION, OLDER_VERSION) &&
      greater(NEWER_VERSION, APP_VERSION) &&
      greater(TEN_VERSION, APP_VERSION),
    `app ${APP_VERSION}: older ${OLDER_VERSION}, newer ${NEWER_VERSION}, ten ${TEN_VERSION}`,
  );

  states.launch = { feedRequestsBeforeExplicitCalls: launchRequests };
  check(
    "the launch asks the feed on its own",
    launchRequests >= 1,
    `the feed saw ${launchRequests} requests before this rig asked for anything`,
  );

  // ── 2 — the version rules, on real payloads ───────────────────────────────
  const newer = await decide("newer");
  states.newer = newer;
  check(
    "a newer tag is offered",
    newer?.ok === true && newer.decision.state === "available",
    `decision ${JSON.stringify(newer)}`,
  );
  check(
    "the offered version is the tag, without its v",
    newer?.decision?.latest === NEWER_VERSION && newer?.decision?.current === APP_VERSION,
    `latest ${newer?.decision?.latest}, current ${newer?.decision?.current}`,
  );
  check(
    "the release's notes and page come through",
    (newer?.decision?.notes ?? "").includes("build number glows") &&
      newer?.decision?.releaseUrl ===
        `https://github.com/karmsheel/life-quest/releases/tag/v${NEWER_VERSION}`,
    `notes ${JSON.stringify(newer?.decision?.notes)}, url ${newer?.decision?.releaseUrl}`,
  );
  check(
    "the Windows setup is picked out of the release's assets",
    newer?.decision?.installer?.name === `LifeQuest-${NEWER_VERSION}-setup.exe` &&
      newer?.decision?.installer?.size === INSTALLER_BYTES.length,
    `installer ${JSON.stringify(newer?.decision?.installer)}`,
  );

  const same = await decide("same");
  states.same = same;
  check(
    "the same version is not an update",
    same?.ok === true && same.decision.state === "current",
    `decision ${JSON.stringify(same)}`,
  );

  const older = await decide("older");
  states.older = older;
  check(
    "an older tag is not an update — a downgrade is not an upgrade",
    older?.ok === true && older.decision.state === "current",
    `decision ${JSON.stringify(older)}`,
  );

  const ten = await decide("ten");
  states.ten = ten;
  check(
    `${TEN_VERSION} is newer than ${APP_VERSION}, compared as numbers and not as text`,
    ten?.ok === true &&
      ten.decision.state === "available" &&
      ten.decision.latest === TEN_VERSION,
    `decision ${JSON.stringify(ten)}`,
  );

  const prerelease = await decide("prerelease");
  states.prerelease = prerelease;
  check(
    "a prerelease of this version is not an update",
    prerelease?.ok === true && prerelease.decision.state === "current",
    `decision ${JSON.stringify(prerelease)}`,
  );

  const garbage = await decide("garbage");
  states.garbage = garbage;
  check(
    "a tag that is not a version fails closed",
    garbage?.ok === true && garbage.decision.state === "error",
    `decision ${JSON.stringify(garbage)}`,
  );
  check(
    "the unreadable tag is named in the reason",
    (garbage?.decision?.error ?? "").includes("nightly"),
    `error ${JSON.stringify(garbage?.decision?.error)}`,
  );

  const noAsset = await decide("noasset");
  states.noasset = noAsset;
  check(
    "a release with no installer is still an available upgrade",
    noAsset?.ok === true && noAsset.decision.state === "available" && noAsset.decision.installer === null,
    `decision ${JSON.stringify(noAsset)}`,
  );

  const four04 = await decide("four04");
  states.four04 = four04;
  check(
    "a feed with no release to compare against reports that it could not check",
    four04?.ok === false && four04.error.includes("404"),
    `answer ${JSON.stringify(four04)}`,
  );

  const untrusted = await decide("untrusted");
  states.untrusted = untrusted;
  check(
    "an asset off the trusted host is not offered as an installer",
    untrusted?.ok === true &&
      untrusted.decision.state === "available" &&
      untrusted.decision.installer === null,
    `decision ${JSON.stringify(untrusted?.decision)}`,
  );

  // ── 3 — one answer a session keeps, and `force` overriding it ─────────────
  feed.setScenario("newer");
  const first = await run(`window.lifequest.updateCheck({ force: true })`);
  feed.setScenario("same");
  const cached = await run(`window.lifequest.updateCheck()`);
  const forced = await run(`window.lifequest.updateCheck({ force: true })`);
  states.session = { first: first?.decision?.latest, cached: cached?.decision?.state, forced: forced?.decision?.state };
  check(
    "a second unforced check replays the session's answer",
    cached?.ok === true && cached.decision.state === "available" && cached.decision.latest === NEWER_VERSION,
    `cached ${JSON.stringify(cached?.decision)}`,
  );
  check(
    "a forced check reaches the feed again",
    forced?.ok === true && forced.decision.state === "current",
    `forced ${JSON.stringify(forced?.decision)}`,
  );

  // ── 4 — the refusals, before any byte moves ──────────────────────────────
  const declaredUntrusted = await run(
    `window.lifequest.updateInstall(${JSON.stringify({
      name: `LifeQuest-${NEWER_VERSION}-setup.exe`,
      url: `http://localhost:${new URL(feed.base).port}/asset/installer`,
      size: INSTALLER_BYTES.length,
    })})`,
  );
  states.declaredUntrusted = declaredUntrusted;
  check(
    "an installer url off the trusted host is refused before a byte moves",
    declaredUntrusted?.ok === false && declaredUntrusted.error.includes("trusted host"),
    `answer ${JSON.stringify(declaredUntrusted)}`,
  );
  check(
    "the refusal happened before the server saw a request",
    feed.counts.asset === 0 && feed.counts.truncated === 0,
    `asset requests ${feed.counts.asset}, truncated ${feed.counts.truncated}`,
  );

  feed.setScenario("redirect");
  const redirectDecision = await run(`window.lifequest.updateCheck({ force: true })`);
  const redirected = await run(
    `window.lifequest.updateInstall(${JSON.stringify(redirectDecision.decision.installer)})`,
  );
  states.redirected = redirected;
  check(
    "a download that redirects off the trusted host is refused",
    redirected?.ok === false && redirected.error.includes("redirected to"),
    `answer ${JSON.stringify(redirected)}`,
  );
  check(
    "the redirect target really was fetched, so the refusal was the policy and not a dead host",
    feed.counts.redirect === 1,
    `redirect requests ${feed.counts.redirect}`,
  );
  check(
    "a refused redirect leaves no file behind",
    fs.existsSync(installerPath) === false,
    `${installerPath} was left on disk`,
  );

  // ── 5 — a body shorter than the release declared ─────────────────────────
  feed.setScenario("truncated");
  const truncatedDecision = await run(`window.lifequest.updateCheck({ force: true })`);
  const truncated = await run(
    `window.lifequest.updateInstall(${JSON.stringify(truncatedDecision.decision.installer)})`,
  );
  states.truncated = truncated;
  check(
    "a short body is refused, naming the sizes",
    truncated?.ok === false && truncated.error.includes("declares"),
    `answer ${JSON.stringify(truncated)}`,
  );
  check(
    "the partial download is deleted rather than left to be launched",
    fs.existsSync(installerPath) === false,
    `${installerPath} was left on disk after a short body`,
  );
  check(
    "the truncation really was served",
    feed.counts.truncated === 1,
    `truncated requests ${feed.counts.truncated}`,
  );

  // ── 6 — the install itself: real bytes on disk, handed to a launcher ─────
  feed.setScenario("newer");
  const finalDecision = await run(`window.lifequest.updateCheck({ force: true })`);
  const assetRequestsBefore = feed.counts.asset;

  // Two requests in the same tick on purpose: the second must join the first
  // rather than download the installer a second time.
  await run(`(() => {
    window.__installOutcome = [];
    const asset = ${JSON.stringify(finalDecision.decision.installer)};
    window.lifequest.updateInstall(asset).then((r) => window.__installOutcome.push(r));
    window.lifequest.updateInstall(asset).then((r) => window.__installOutcome.push(r));
    return true;
  })()`);

  await waitFor("window.__installOutcome.length === 2", "both install requests to settle", 60_000);
  const outcomes = await run("window.__installOutcome");
  states.install = { outcomes, assetRequests: feed.counts.asset - assetRequestsBefore };

  check(
    "both install requests succeed",
    outcomes.length === 2 && outcomes.every((outcome) => outcome?.ok === true),
    `outcomes ${JSON.stringify(outcomes)}`,
  );
  check(
    "the installer was fetched once, not twice",
    states.install.assetRequests === 1,
    `the asset was fetched ${states.install.assetRequests} times`,
  );
  check(
    "the installer path the app reports is the file it downloaded",
    outcomes[0]?.installer === installerPath,
    `installer ${outcomes[0]?.installer} vs ${installerPath}`,
  );

  // The bytes on disk are the bytes the feed served.
  const landed = fs.existsSync(installerPath) ? fs.readFileSync(installerPath) : null;
  states.landed = landed
    ? {
        path: installerPath,
        size: landed.length,
        sha256: crypto.createHash("sha256").update(landed).digest("hex"),
      }
    : { path: installerPath, missing: true };
  check(
    "the download landed on disk byte-for-byte",
    landed !== null && landed.equals(INSTALLER_BYTES),
    `landed ${JSON.stringify(states.landed)} vs the feed's ${INSTALLER_BYTES.length} bytes (${INSTALLER_SHA})`,
  );

  // The progress the renderer really received over IPC.
  const progress = await run("window.__progress");
  states.progress = progress.slice(-4);
  check(
    "the renderer received the download's progress over IPC",
    Array.isArray(progress) && progress.length > 0,
    `progress events ${JSON.stringify(progress)}`,
  );
  check(
    "the progress only ever moves forward, so two flights did not interleave",
    Array.isArray(progress) &&
      progress.every(
        (event, index) => index === 0 || event.downloaded >= progress[index - 1].downloaded,
      ),
    `progress ${JSON.stringify(progress)}`,
  );
  check(
    "the progress ends at the release's own size",
    Array.isArray(progress) &&
      progress.length > 0 &&
      progress[progress.length - 1].downloaded === INSTALLER_BYTES.length &&
      progress[progress.length - 1].total === INSTALLER_BYTES.length,
    `last event ${JSON.stringify(progress[progress.length - 1])}`,
  );

  // ── 7 — the launcher was handed exactly that file ────────────────────────
  const markerDeadline = Date.now() + 15_000;
  while (!fs.existsSync(markerFile) && Date.now() < markerDeadline) {
    await sleep(40);
  }
  const marker = fs.existsSync(markerFile)
    ? JSON.parse(fs.readFileSync(markerFile, "utf8"))
    : null;
  states.launcher = marker;
  check(
    "the fake launcher ran",
    Boolean(marker),
    `no marker at ${markerFile}`,
  );
  check(
    "the launcher was handed the downloaded installer by path",
    marker?.argv?.[0] === installerPath,
    `argv ${JSON.stringify(marker?.argv)}`,
  );
  check(
    "the file handed over was the real, complete download",
    marker?.ok === true &&
      marker?.size === INSTALLER_BYTES.length &&
      marker?.sha256 === INSTALLER_SHA,
    `marker ${JSON.stringify(marker)}`,
  );

  // The app steps aside so the installer can replace it: `app.quit()` out of the
  // updater reaches `before-quit`, which shuts the companion down and exits.
  states.steppedAside = "pending";
}

const started = Date.now();
let report = { pass: false, failures: [], note: "the run never reached its report" };

function writeReport() {
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`update-install: could not write the report: ${error}`);
  }
}

app.on("window-all-closed", () => {});

// The report is written twice on purpose: once when the run settles, and once
// more from the exit hook — a successful install ends with the app quitting
// itself, and a quit that beat the first write must not erase the verdict.
process.on("exit", writeReport);

app
  .whenReady()
  .then(async () => {
    try {
      await main();
      report = {
        ranAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        states,
        failures,
        pass: failures.length === 0,
      };
    } catch (error) {
      report = {
        ranAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        failures: [
          ...failures,
          `threw: ${error instanceof Error ? error.message : String(error)}`,
        ],
        pass: false,
      };
    }
    writeReport();

    console.log("");
    for (const row of [
      ["scenario", "current", "latest", "state", "installer"],
      ["launch", "—", "—", "asked", "—"],
      ["newer", report.states?.newer?.decision?.current, report.states?.newer?.decision?.latest, report.states?.newer?.decision?.state, report.states?.newer?.decision?.installer?.name ?? "none"],
      ["same", report.states?.same?.decision?.current, report.states?.same?.decision?.latest, report.states?.same?.decision?.state, "—"],
      ["older", report.states?.older?.decision?.current, report.states?.older?.decision?.latest, report.states?.older?.decision?.state, "—"],
      ["ten", report.states?.ten?.decision?.current, report.states?.ten?.decision?.latest, report.states?.ten?.decision?.state, "—"],
      ["prerelease", report.states?.prerelease?.decision?.current, report.states?.prerelease?.decision?.latest, report.states?.prerelease?.decision?.state, "—"],
      ["garbage tag", report.states?.garbage?.decision?.current, "—", report.states?.garbage?.decision?.state, "—"],
      ["no asset", report.states?.noasset?.decision?.current, report.states?.noasset?.decision?.latest, report.states?.noasset?.decision?.state, "none"],
      ["untrusted host", report.states?.untrusted?.decision?.current, report.states?.untrusted?.decision?.latest, report.states?.untrusted?.decision?.state, "none"],
      ["404 (no release)", "—", "—", report.states?.four04?.ok === false ? "could not check" : "—", "—"],
    ]) {
      console.log(row.map((cell) => String(cell ?? "—").padEnd(16)).join(" "));
    }
    console.log("");
    console.log(`install: ${JSON.stringify(report.states?.install?.outcomes?.map((o) => o?.ok))}, asset fetches ${report.states?.install?.assetRequests}`);
    console.log(`landed:   ${JSON.stringify(report.states?.landed)}`);
    console.log(`launcher: ${JSON.stringify(report.states?.launcher)}`);
    console.log(`report: ${REPORT}`);
    for (const failure of report.failures) console.log(`FAIL ${failure}`);
    console.log(report.pass ? "update install: PASS" : "update install: FAIL");

    // The app quits itself from the updater's own hand-over; nothing here calls
    // `app.exit`, because the point is to watch it step aside. If the run failed
    // there is no quit coming, so one is asked for.
    if (!report.pass) app.exit(1);
  })
  .catch((error) => {
    report = {
      ranAt: new Date().toISOString(),
      states,
      failures: [...failures, `threw: ${error instanceof Error ? error.stack : String(error)}`],
      pass: false,
    };
    writeReport();
    console.error(`update-install: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
