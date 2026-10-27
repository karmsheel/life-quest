import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;
const REPORT = path.join(desktopRoot, "e2e/artifacts/phone-engine.json");

/**
 * Every scenario the engine rig must report as passing. The names are the rig's
 * own, so a rig that quietly stops checking one is a failure here rather than a
 * shorter green run.
 */
const SCENARIOS = [
  "queue writes one pending file and no transaction",
  "queue is idempotent by clientId",
  "queue refuses bad input",
  "captureDate clamps to a week",
  "withdraw is pending-only",
  "metric month_spend and month_income",
  "metric net_worth",
  "metric refuses a mixed total without a rate",
  "settings default and write",
  "devices cap and hashes",
  "queue cap is 100",
  "corrupt draft is skipped, not deleted",
  "metric with no kit",
];

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: { name: string; pass: boolean; detail: string | null }[];
};

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/phone-engine.electron.mjs")],
      { cwd: desktopRoot, timeout: 180_000 },
      (error, _stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(new Error(`${error.message}\n${stderr}`));
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

describe("phone engine", { concurrency: false }, () => {
  it("queues, caps, clamps, and prices the vault without creating a transaction", async () => {
    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(
      exitCode,
      0,
      `the phone engine rig exited ${exitCode}: ${report.failures.join("; ")}`,
    );
    assert.equal(
      report.pass,
      true,
      `the rig reported failures: ${report.failures.join("; ")}`,
    );

    const byName = new Map(report.scenarios.map((s) => [s.name, s]));
    for (const name of SCENARIOS) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig reported no scenario named "${name}"`);
      assert.equal(
        scenario.pass,
        true,
        `"${name}" failed: ${scenario.detail ?? "no detail"}`,
      );
    }
  });
});
