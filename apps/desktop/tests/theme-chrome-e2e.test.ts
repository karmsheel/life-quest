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
const rig = path.join(desktopRoot, "e2e/theme-chrome.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/themes-v2.json");

type Check = { label: string; pass: boolean; detail: string | null };
type Report = {
  ranAt: string;
  checks: Check[];
  failures: string[];
  pass: boolean;
  artifacts: {
    preview: string;
    kept: string;
    floating: string;
    settings: string;
    material: string;
    layout: string;
    variants: string;
  };
  theme: unknown;
  refused: unknown;
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
          LQ_THEME_WORLD: world,
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
 * Theme files, v2, end to end on the REAL app.
 *
 * The rig writes a theme file into the app profile's `themes/` directory — the
 * gesture the companion makes — and judges what the shipped shell does with it:
 * wears it without a restart, asks before keeping it, reverts on its own after
 * ten seconds, keeps it across a reload, and refuses a made-up placement by
 * naming the field. The report is `e2e/artifacts/themes-v2.json`; the pictures
 * are `themes-v2-preview.png` and `themes-v2-kept.png`.
 *
 * With the dev server down the test skips: the rig boots the product's main
 * process and renderer from this checkout's dev server, and a bare `npm test`
 * cannot promise which checkout is serving.
 */
describe("theme files v2", () => {
  it("wears, previews, reverts, keeps and refuses a theme file", async (t) => {
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

    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-theme-"));
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
        report.artifacts.preview,
        report.artifacts.kept,
        report.artifacts.floating,
        report.artifacts.settings,
        report.artifacts.material,
        report.artifacts.layout,
        report.artifacts.variants,
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
