/**
 * Acceptance against reality: the REAL main process, the REAL preload and the
 * REAL network, asking github.com for the newest LifeQuest — with none of the
 * auto-update rig's overrides in place.
 *
 * `update-install.electron.mjs` proves the decision logic, the refusals and the
 * download against a feed it owns; `update-badge.electron.mjs` proves the rail and
 * the popup against a stubbed bridge. Neither touches the one thing this script
 * is for: that the URL, the headers, the unauthenticated read and the parse are
 * right, against the repository as it is public right now. A wrong path or a
 * missing `Accept` header is invisible to both rigs and fatal in the product.
 *
 * Run from `apps/desktop`, with the dev server up and the main bundle built:
 *
 *   <electron> e2e/update-live-feed.mjs
 *
 * Deliberately NOT in `npm test`: it needs the network, and a suite that fails
 * when GitHub is slow teaches people to ignore it. Run it before a release, and
 * after one — the two states it can find itself in are "there is nothing newer
 * than me" and "there is something newer than me", and both are worth reading.
 *
 * It downloads nothing and installs nothing: `updateCheck` is a read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const REPORT = path.join(artifactsDir, "update-live-feed.json");

const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
).version;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/** The app's own installer selector, so the live data is read the way main reads it. */
const SETUP_ASSET = /setup.*\.exe$/i;

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // A throwaway profile, and a hidden window: the operator's own vault and
  // %APPDATA%\LifeQuest are never opened. Nothing else is overridden — that is the
  // whole point of this script.
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lq-live-")));
  process.env.LIFEQUEST_E2E = JSON.stringify({ userData: profile, showWindow: false });

  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();
  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await run(
      "Boolean(window.lifequest && window.lifequest.updateCheck)",
    ).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Forced: the launch's own check may already have consumed the session's answer.
  const answer = await run("window.lifequest.updateCheck({ force: true })");

  const decision = answer?.ok === true ? answer.decision : null;
  const report = {
    ranAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    answer,
    decision,
    failures,
    pass: false,
  };

  check(
    "the real feed answered",
    answer?.ok === true,
    `the check failed: ${JSON.stringify(answer?.error ?? answer)}`,
  );

  if (decision) {
    check(
      "the feed named a release",
      decision.state === "available" || decision.state === "current",
      `state ${decision.state}: ${JSON.stringify(decision.error ?? "")}`,
    );
    check(
      "the build's own version came back as this build",
      decision.current === APP_VERSION,
      `the feed's answer says current ${decision.current}, package.json says ${APP_VERSION}`,
    );
    check(
      "the release tag parsed to a version",
      /^\d+\.\d+\.\d+/.test(String(decision.latest ?? "")),
      `latest ${JSON.stringify(decision.latest)}`,
    );

    if (decision.state === "available") {
      // A newer release: it must be offerable, exactly as the popup needs it.
      check(
        "the newer release carries a Windows installer",
        Boolean(decision.installer),
        `no -setup.exe among the published assets: ${JSON.stringify(decision.installer)}`,
      );
      check(
        "that installer is a github https url",
        /^https:\/\/github\.com\//.test(decision.installer?.url ?? ""),
        `installer url ${JSON.stringify(decision.installer?.url)}`,
      );
      check(
        "the release page is a github https page",
        /^https:\/\/github\.com\//.test(decision.releaseUrl ?? ""),
        `release url ${JSON.stringify(decision.releaseUrl)}`,
      );
      check(
        "the installer's name is the one the app would run",
        SETUP_ASSET.test(decision.installer?.name ?? ""),
        `installer name ${JSON.stringify(decision.installer?.name)}`,
      );
    } else {
      // Nothing newer than this build: the published release must BE this build,
      // which is what makes "up to date" the right answer rather than a silent
      // failure to see the release we just published.
      check(
        "the newest published release is this build",
        decision.latest === APP_VERSION,
        `the feed's newest release is ${decision.latest} but this build is ${APP_VERSION} — was the release published for a different commit?`,
      );
    }
  }

  report.pass = failures.length === 0;
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`app:      LifeQuest ${APP_VERSION}`);
  console.log(`answer:   ok=${answer?.ok} state=${decision?.state ?? "—"}`);
  if (decision) {
    console.log(`versions: ${decision.current} -> ${decision.latest}`);
    if (decision.state === "available") {
      console.log(`installer: ${decision.installer?.name} (${decision.installer?.size} bytes)`);
      console.log(`notes:    ${String(decision.notes ?? "").length} characters`);
    }
  }
  console.log(`report:   ${REPORT}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "update live feed: PASS" : "update live feed: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`update-live-feed: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
