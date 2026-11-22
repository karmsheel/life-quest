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
const rig = path.join(desktopRoot, "e2e/theme-background.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/theme-background.json");

type Check = { label: string; pass: boolean; detail: string | null };
type Report = {
  ranAt: string;
  world: string;
  fixture: string;
  storedPicture: string | null;
  checks: Check[];
  failures: string[];
  pass: boolean;
  artifacts: {
    settings: string;
    app: string;
    horizon: string;
    studio: string;
  };
  themeFiles: Record<string, string>;
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

function runRig(world: string): Promise<{ code: number; report: Report | null }> {
  fs.rmSync(REPORT, { force: true });
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [rig],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          LQ_BACKGROUND_WORLD: world,
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
 * The app background layer, end to end on the REAL app.
 *
 * The rig boots the product's own main process and renderer in a throwaway
 * world, presses the real Settings "Choose picture…" button (answered by main's
 * picker seam), and judges what the shipped shell does with the picture: it is
 * copied into the profile's `backgrounds/`, worn behind the page with a blob
 * URL and Fit/Position/Dim/Blur, marked "yours", kept across a reload, handed
 * back by Reset to theme. It then previews and keeps a theme file that carries
 * the picture, paints the two new procedural skies, authors a picture in the
 * Extensions studio (and reads the saved JSON back), and proves a missing
 * picture falls back to the drawn sky while an invalid one is refused by name.
 *
 * The report is `e2e/artifacts/theme-background.json`; the pictures are
 * `theme-background-settings.png`, `theme-background-app.png`,
 * `theme-background-horizon.png` and `theme-background-studio.png`.
 *
 * With the dev server down the test skips: the rig boots the product's main
 * process and renderer from this checkout's dev server, and a bare `npm test`
 * cannot promise which checkout is serving.
 */
describe("app background", () => {
  it("picks, wears, keeps and authors a background picture", async (t) => {
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
    if (!fs.existsSync(path.join(desktopRoot, "e2e/fixtures/background-ridge.png"))) {
      t.skip("no background fixture — run node e2e/fixtures/make-background-fixture.mjs");
      return;
    }

    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-background-"));
    try {
      const { code, report } = await runRig(world);
      assert.ok(report, "the rig wrote no report");
      for (const check of report.checks) {
        assert.ok(check.pass, `${check.label}: ${check.detail ?? ""}`);
      }
      assert.deepEqual(report.failures, []);
      assert.equal(code, 0);
      assert.equal(report.pass, true);
      assert.equal(report.storedPicture !== null, true, "the rig stored no picture");
      for (const artifact of [
        report.artifacts.settings,
        report.artifacts.app,
        report.artifacts.horizon,
        report.artifacts.studio,
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
