import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
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
const rig = path.join(desktopRoot, "e2e/theme-launch.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/theme-launch.json");

type Check = { label: string; pass: boolean; detail: string | null };
type Report = {
  ranAt: string;
  checks: Check[];
  failures: string[];
  pass: boolean;
  firstReadWaitedMs: number;
  eventAfterFirstReadStartedMs: number;
  themeDirectoryListings: Array<{ at: number; index: number }>;
  artifacts: { quiet: string; gallery: string; late: string };
};

/**
 * Whether the dev server is serving — not merely listening.
 *
 * A port that accepts a connection while Vite is still starting answers the
 * window's first navigation with `ERR_CONNECTION_RESET`, which reads as a rig
 * failure rather than as "the bench was not ready". So this waits for a page.
 */
async function devServerUp(): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    const socket = net.createConnection(DEV_PORT, "127.0.0.1");
    const listening = await new Promise<boolean>((resolve) => {
      const done = (up: boolean) => {
        socket.destroy();
        resolve(up);
      };
      socket.on("connect", () => done(true));
      socket.on("error", () => done(false));
    });
    if (listening) {
      try {
        const response = await fetch(`http://127.0.0.1:${DEV_PORT}/`);
        if (response.ok) return true;
      } catch {
        /* still starting */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function runRig(world: string): Promise<{ code: number; report: Report | null }> {
  fs.rmSync(REPORT, { force: true });
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [rig],
      {
        cwd: desktopRoot,
        // The launch is held for 1.2s and watched for 2.5s, then a real write
        // has to preview: the margin is the rig's own sleeps plus app boot.
        timeout: 180_000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          LQ_LAUNCH_WORLD: world,
        } as NodeJS.ProcessEnv,
      },
      (error) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        const report = fs.existsSync(REPORT)
          ? (JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report)
          : null;
        resolve({ code, report });
      },
    );
  });
}

/**
 * A launch is not a write.
 *
 * A theme that was already on disk when the window opened is listed, never
 * worn — even when the OS reports a change while the session's first read is
 * still in flight, which is what a cold start on Windows does. The rig holds
 * that first read, sends the `theme:changed` the watcher would, and then checks
 * that the shell stays on its default chrome and offers no preview bar; the
 * gallery is still listed, and a write after the baseline still previews.
 *
 * The report is `e2e/artifacts/theme-launch.json`; the pictures are
 * `theme-launch-quiet.png` (the launch, nothing worn), `theme-launch-gallery.png`
 * (the files listed) and `theme-launch-late.png` (a later write previewing).
 *
 * With the dev server down the test skips: the rig boots the product's main
 * process and renderer from this checkout's dev server, and a bare `npm test`
 * cannot promise which checkout is serving.
 */
describe("theme launch", () => {
  it("never wears a theme file that was already on disk at launch", async (t) => {
    if (!(await devServerUp())) {
      t.skip("dev server not up — run through lifequest-e2e");
      return;
    }
    for (const needed of ["dist-electron/main.js", "dist/index.html"]) {
      if (!fs.existsSync(path.join(desktopRoot, needed))) {
        t.skip(`no build at ${needed} — run \`npm run build\``);
        return;
      }
    }

    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-launch-"));
    try {
      const { code, report } = await runRig(world);
      assert.ok(report, "the rig wrote no report");
      for (const check of report.checks) {
        assert.ok(check.pass, `${check.label}: ${check.detail ?? ""}`);
      }
      assert.deepEqual(report.failures, []);
      assert.equal(code, 0);
      assert.equal(report.pass, true);
      for (const artifact of [
        report.artifacts.quiet,
        report.artifacts.gallery,
        report.artifacts.late,
      ]) {
        assert.ok(
          fs.existsSync(path.resolve(desktopRoot, artifact)),
          `missing artifact ${artifact}`,
        );
      }
    } finally {
      fs.rmSync(world, { recursive: true, force: true });
    }
  });
});
