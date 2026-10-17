import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
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

const artifactsDir = path.join(desktopRoot, "e2e/artifacts");
const rig = path.join(desktopRoot, "e2e/startup-boot.electron.mjs");
const REPORT = path.join(artifactsDir, "startup-boot.json");

/** The splash budget the rig holds itself to, restated so the suite owns it too. */
const SPLASH_CEILING_MS = 3000;
const FIRST_PAINT_CEILING_MS = 2000;

type Check = { label: string; pass: boolean; detail: string | null };

type LegReport = {
  leg: string;
  ranAt: string;
  companion: { attached: boolean; leadWhenRevealed: string | null };
  timings: {
    appReadyMs: number;
    windowLoadedMs: number;
    firstPaintMs: number | null;
    splashHiddenMs: number | null;
    companionEnsureMs: number | null;
    handAskedEnsureMs: number | null;
  };
  hermesInvocations: string[];
  handAskedInvocations: string[];
  checks: Check[];
  failures: string[];
  pass: boolean;
};

/** One launch of the real app, in the world the caller owns. */
function runLeg(
  leg: "boot" | "warm" | "stalled",
  world: string,
  env: Record<string, string> = {},
): Promise<{ code: number; report: LegReport | null }> {
  const reportFile = path.join(artifactsDir, `startup-boot-${leg}.json`);
  fs.rmSync(reportFile, { force: true });
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [rig],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: {
          ...process.env,
          // Electron hosts export this; left in place every launch runs as plain
          // Node and never opens a window.
          ELECTRON_RUN_AS_NODE: undefined,
          LQ_BOOT_WORLD: world,
          LQ_BOOT_LEG: leg,
          ...env,
        } as NodeJS.ProcessEnv,
      },
      (error) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        const report = fs.existsSync(reportFile)
          ? (JSON.parse(fs.readFileSync(reportFile, "utf8")) as LegReport)
          : null;
        resolve({ code, report });
      },
    );
  });
}

/**
 * Cold start, end to end, on the REAL main process, preload and renderer.
 *
 * The three legs are one story about one world. `boot` is a first launch against
 * a companion host that is already serving: the app must be on screen on the
 * splash floor, not on the companion. `warm` is the same world again: the
 * profile config already carries the vault's credential, so an ensure must not
 * spawn the Hermes CLI at all — and it must not be able to pass this by never
 * looking, which is why the rig asks for the ensure by hand once the vault is
 * open, the one moment the credential check is guaranteed to run. `stalled` is a
 * host that is down behind a CLI that takes seconds per call: the app must still
 * put its own boot surface on screen inside the floor, rather than holding a
 * logo for as long as the companion takes.
 *
 * The artifacts are `e2e/artifacts/startup-boot-{boot,warm,stalled}.json` per
 * leg, merged into `e2e/artifacts/startup-boot.json`.
 */
describe("cold start (the splash, and what may hold it)", () => {
  it("boots on the floor, leaves a serving host alone, and never waits on the companion", async (t) => {
    for (const needed of ["dist-electron/main.js", "dist/index.html"]) {
      if (!fs.existsSync(path.join(desktopRoot, needed))) {
        t.skip(`no build at ${needed} — run \`npm run build\` to include this e2e`);
        return;
      }
    }

    fs.mkdirSync(artifactsDir, { recursive: true });
    // One world for all three legs: `warm` is only meaningful as the second
    // launch of the same vault, profile and Hermes home.
    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-startup-boot-"));

    const boot = await runLeg("boot", world, { LQ_BOOT_HOST: "up" });
    const warm = await runLeg("warm", world, { LQ_BOOT_HOST: "up" });
    // 3s per CLI call, and the stalled path makes four of them.
    const stalledSleepMs = 3000;
    const stalled = await runLeg("stalled", world, {
      LQ_BOOT_HOST: "down",
      LQ_BOOT_STUB_SLEEP_MS: String(stalledSleepMs),
    });

    const legs = { boot, warm, stalled };
    const merged = {
      ranAt: new Date().toISOString(),
      world,
      splashCeilingMs: SPLASH_CEILING_MS,
      firstPaintCeilingMs: FIRST_PAINT_CEILING_MS,
      legs: Object.fromEntries(
        Object.entries(legs).map(([leg, { code, report }]) => [
          leg,
          { exitCode: code, ...report },
        ]),
      ),
      pass: false,
    };
    fs.writeFileSync(REPORT, `${JSON.stringify(merged, null, 2)}\n`);

    for (const [leg, { report, code }] of Object.entries(legs)) {
      assert.ok(report, `the ${leg} leg wrote no report`);
      assert.deepEqual(report.failures, [], `the ${leg} leg failed inside the rig`);
      assert.equal(report.pass, true, `the ${leg} leg reported failure`);
      assert.equal(code, 0, `the ${leg} leg exited ${code}`);
    }

    const bootReport = boot.report as LegReport;
    const warmReport = warm.report as LegReport;
    const stalledReport = stalled.report as LegReport;

    // ── The app's own boot, on every leg ────────────────────────────────────
    for (const [leg, report] of [
      ["boot", bootReport],
      ["warm", warmReport],
      ["stalled", stalledReport],
    ] as const) {
      assert.notEqual(
        report.timings.firstPaintMs,
        null,
        `the ${leg} leg never painted the renderer`,
      );
      assert.ok(
        (report.timings.firstPaintMs ?? Infinity) <= FIRST_PAINT_CEILING_MS,
        `the ${leg} leg painted the renderer at ${report.timings.firstPaintMs}ms, past the ${FIRST_PAINT_CEILING_MS}ms budget`,
      );
      assert.ok(
        (report.timings.splashHiddenMs ?? Infinity) <= SPLASH_CEILING_MS,
        `the ${leg} leg held the splash until ${report.timings.splashHiddenMs}ms, past the ${SPLASH_CEILING_MS}ms budget`,
      );
    }

    // ── A serving companion is attached, and nothing is restarted for it ─────
    assert.equal(bootReport.companion.attached, true, "the first launch did not attach");
    assert.equal(warmReport.companion.attached, true, "the second launch did not attach");

    // The regression: on an unchanged profile, an ensure must not run
    // `hermes config set` twice and then restart a host that is already serving
    // the profile. Measured before the fix: four invocations, and 56 seconds of
    // splash on a real machine whose `gateway restart` had to be timed out.
    assert.deepEqual(
      warmReport.handAskedInvocations,
      [],
      `a warm ensure spawned the Hermes CLI: ${JSON.stringify(warmReport.handAskedInvocations)}`,
    );

    // ── A companion that is slow does not hold the splash ───────────────────
    assert.equal(
      stalledReport.companion.attached,
      false,
      "the stalled leg attached to a host that was down",
    );
    assert.ok(
      (stalledReport.timings.companionEnsureMs ?? 0) >= 2 * stalledSleepMs,
      `the stalled leg's companion answered in ${stalledReport.timings.companionEnsureMs}ms — not slow enough to be testing anything`,
    );
    assert.ok(
      stalledReport.companion.leadWhenRevealed,
      "nothing of the app's own was on screen when the splash stood down",
    );
    assert.ok(
      (stalledReport.timings.splashHiddenMs ?? Infinity) <
        (stalledReport.timings.companionEnsureMs ?? 0),
      "the splash outlived the companion's own answer on the stalled leg",
    );

    merged.pass = true;
    fs.writeFileSync(REPORT, `${JSON.stringify(merged, null, 2)}\n`);
  });
});
