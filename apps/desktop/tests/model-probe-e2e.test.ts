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
const rig = path.join(desktopRoot, "e2e/model-probe.electron.mjs");
const REPORT = path.join(artifactsDir, "model-probe.json");

/** How long the fake host holds its catalog. The boot must not pay it. */
const CATALOG_DELAY_MS = 3000;
/** The app's own screen must be up well inside that delay. */
const BOOT_SCREEN_CEILING_MS = 1500;
const PINNED_MODEL = "retired-model-7";

type Check = { label: string; pass: boolean; detail: string | null };

type Push = { at: number; kind: string | null; modelWarning: string | null };

type LegReport = {
  leg: string;
  ranAt: string;
  host: { catalogRequests: number };
  timings: {
    bootAt: number;
    firstReadyAt: number | null;
    firstWarnedAt: number | null;
    appScreenAt: number | null;
    bootHeading: string | null;
    headingAtInstall: string | null;
  };
  pushes: Push[];
  finalStatus: { kind: string; modelWarning: string | null } | null;
  checks: Check[];
  failures: string[];
  pass: boolean;
};

function runLeg(
  leg: "retired" | "live" | "unknown",
  world: string,
): Promise<{ code: number; report: LegReport | null }> {
  const reportFile = path.join(artifactsDir, `model-probe-${leg}.json`);
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
          ELECTRON_RUN_AS_NODE: undefined,
          LQ_PROBE_WORLD: world,
          LQ_PROBE_LEG: leg,
          LQ_PROBE_CATALOG_DELAY_MS: String(CATALOG_DELAY_MS),
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
 * The model probe, end to end, through the REAL main process, preload bridge and
 * renderer — the warning that could never fire, and the boot it must not slow.
 *
 * The three legs are one claim each:
 *
 * `retired` — the profile's pinned model is absent from a provider the host has
 * a credential for, so the app must say so: the ready status first (no warning),
 * then a second status carrying the warning, after the host has answered.
 *
 * `live` — the same profile with the model still listed: no warning, ever, and
 * the probe still ran (the host counts its `/api/model/options` calls).
 *
 * `unknown` — the pinned provider has no credential on the host, so its model
 * list proves nothing about the pinned id. Silence is not a verdict, and this
 * leg fails if silence turns into a warning telling the operator their working
 * model is dead.
 *
 * Every leg also holds the boot's own budget: the catalog is held for
 * `CATALOG_DELAY_MS`, and the app's screen must be up inside
 * `BOOT_SCREEN_CEILING_MS`. An ensure that stops to ask about the model is the
 * 57-second splash with a shorter delay.
 *
 * Artifacts: `e2e/artifacts/model-probe-{retired,live,unknown}.json`, merged into
 * `e2e/artifacts/model-probe.json`.
 */
describe("the model probe (a retired model, without holding the boot)", () => {
  it("warns about a model this profile cannot route, and only when the host says so", async (t) => {
    for (const needed of ["dist-electron/main.js", "dist/index.html"]) {
      if (!fs.existsSync(path.join(desktopRoot, needed))) {
        t.skip(`no build at ${needed} — run \`npm run build\` to include this e2e`);
        return;
      }
    }

    fs.mkdirSync(artifactsDir, { recursive: true });
    const world = fs.mkdtempSync(path.join(os.tmpdir(), "lq-model-probe-"));

    const retired = await runLeg("retired", world);
    const live = await runLeg("live", world);
    const unknown = await runLeg("unknown", world);

    const legs = { retired, live, unknown };
    const merged = {
      ranAt: new Date().toISOString(),
      world,
      catalogDelayMs: CATALOG_DELAY_MS,
      bootScreenCeilingMs: BOOT_SCREEN_CEILING_MS,
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

      // ── The boot must not stop to ask about the model ─────────────────────
      assert.equal(
        report.host.catalogRequests,
        1,
        `the ${leg} leg asked the host for its catalog ${report.host.catalogRequests} times — exactly one probe was expected`,
      );
      assert.notEqual(
        report.timings.appScreenAt,
        null,
        `the ${leg} leg never reached the app's own screen`,
      );
      const bootGap = (report.timings.appScreenAt ?? Infinity) - report.timings.bootAt;
      assert.ok(
        bootGap <= BOOT_SCREEN_CEILING_MS,
        `the ${leg} leg put the app's screen up ${bootGap}ms after the window loaded, with the catalog held ${CATALOG_DELAY_MS}ms — the ensure waited for the probe`,
      );
      // The first status the app published is the one the boot is judged by.
      assert.equal(
        report.pushes[0]?.modelWarning ?? null,
        null,
        `the ${leg} leg's first status already carried a warning — the probe held the ready status`,
      );
    }

    const retiredReport = retired.report as LegReport;
    const liveReport = live.report as LegReport;
    const unknownReport = unknown.report as LegReport;

    // ── A model the profile cannot route is named ───────────────────────────
    const warning = retiredReport.pushes.find((p) => p.modelWarning)?.modelWarning ?? null;
    assert.ok(
      warning && warning.includes(PINNED_MODEL),
      `no warning named "${PINNED_MODEL}"; pushes were ${JSON.stringify(retiredReport.pushes)}`,
    );
    assert.equal(
      retiredReport.finalStatus?.modelWarning,
      warning,
      "the status the app reports after the push does not carry the warning the settings surface reads",
    );
    const warningGap =
      (retiredReport.timings.firstWarnedAt ?? 0) -
      (retiredReport.timings.firstReadyAt ?? 0);
    assert.ok(
      warningGap >= CATALOG_DELAY_MS * 0.8,
      `the warning landed ${warningGap}ms after the ready status while the catalog was held ${CATALOG_DELAY_MS}ms — it cannot have come from the probe`,
    );

    // ── A model that is still listed, and a catalog that cannot judge ───────
    for (const [leg, report] of [
      ["live", liveReport],
      ["unknown", unknownReport],
    ] as const) {
      assert.deepEqual(
        report.pushes.filter((p) => p.modelWarning),
        [],
        `the ${leg} leg pushed a warning: ${JSON.stringify(report.pushes)}`,
      );
      assert.equal(
        report.finalStatus?.modelWarning ?? null,
        null,
        `the ${leg} leg's final status carries a warning`,
      );
    }

    merged.pass = true;
    fs.writeFileSync(REPORT, `${JSON.stringify(merged, null, 2)}\n`);
  });
});
