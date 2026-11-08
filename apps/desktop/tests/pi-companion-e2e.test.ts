import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The built-in companion, end to end.
 *
 * The rig boots the real app against a throwaway profile and vault, points the
 * built-in companion at a fake OpenAI-compatible endpoint, runs one turn
 * through the real preload bridge, and reads the reply back through the real
 * dock. Its report and two pictures are the artifact; the assertions below
 * restate the important ones so a regression fails here by name.
 */
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const REPORT = path.join(desktopRoot, "e2e/artifacts/pi-companion.json");
const THREAD_SHOT = path.join(desktopRoot, "e2e/artifacts/pi-companion-thread.png");
const PICKER_SHOT = path.join(desktopRoot, "e2e/artifacts/pi-companion-picker.png");

type Report = {
  ok: boolean;
  configured: {
    settings: string;
    switched: string;
    openedOk: boolean;
    /** The rig unlocks the two seeded areas it scopes agents in. */
    unlocked: boolean;
  };
  mounted: boolean;
  turn: { ok: boolean; sessionId: string | null; eventTypes: string[] };
  deltas: string;
  completed: boolean;
  stored: string[];
  threadHasReply: boolean;
  picker: { shown: boolean; items?: string[] };
  scopes: {
    scopedHermes: boolean;
    defaultedHermes: boolean;
    defaultedPi: boolean;
    persisted: { agentId: string; domains: string[]; defaultFor: string[] }[];
    overview: { pills: { name: string; active: boolean }[] };
    health: { pills: { name: string; active: boolean }[] };
    healthGated: { gated: boolean; lead: string };
    financial: { pills: { name: string; active: boolean }[] };
  };
  screenshots: string[];
};

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/pi-companion.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000, env: { ...process.env } },
      (error) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve(error ? (error.code as number) : 0);
      },
    );
  });
}

describe("built-in companion (Pi)", () => {
  it("answers a turn in the dock and offers both companions", async (t) => {
    fs.rmSync(REPORT, { force: true });
    const exitCode = await runRig();
    assert.equal(fs.existsSync(REPORT), true, "rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(exitCode, 0, "rig exited non-zero");
    assert.equal(report.ok, true);

    assert.equal(report.configured.settings, "ready");
    assert.equal(report.configured.switched, "ready");
    assert.equal(report.configured.openedOk, true);
    assert.equal(
      report.configured.unlocked,
      true,
      "the rig could not unlock the seeded Health and Finance areas",
    );
    assert.equal(report.mounted, true, "the dock never mounted");
    assert.equal(report.turn.ok, true);
    assert.ok(
      report.turn.eventTypes.includes("assistant.delta"),
      "the turn produced no streamed text",
    );
    assert.ok(report.deltas.includes("Hello from Pi."), `streamed text: ${report.deltas}`);
    assert.equal(report.completed, true, "the turn never completed");
    assert.ok(
      (report.stored ?? []).some((line) => line.includes("Hello from Pi.")),
      "the harness did not persist the reply",
    );
    assert.equal(report.threadHasReply, true, "the dock did not show the reply");

    assert.equal(report.picker.shown, true, "the dock offers no agent switcher");
    assert.deepEqual(
      (report.picker.items ?? []).sort(),
      ["Hermes", "Pi"],
      "the switcher does not offer both agents",
    );

    // Domain scoping: Hermes narrowed to Health and default there; Pi everywhere
    // and default in Financial.
    assert.equal(report.scopes.scopedHermes, true, "no Hermes scope chip");
    assert.equal(report.scopes.defaultedHermes, true, "no Hermes default chip");
    assert.equal(report.scopes.defaultedPi, true, "no Pi default chip");
    assert.ok(
      report.scopes.persisted.some(
        (scope) => scope.agentId === "hermes" && scope.domains.includes("health"),
      ),
      `the scope did not reach the vault: ${JSON.stringify(report.scopes.persisted)}`,
    );
    assert.deepEqual(
      report.scopes.overview.pills.map((pill) => pill.name),
      ["Pi"],
      "Overview offered an agent scoped to another domain",
    );
    if (report.scopes.healthGated.gated) {
      // No ready Hermes in this world: the gate naming Hermes is the domain
      // default having fired.
      assert.match(
        report.scopes.healthGated.lead,
        /hermes/i,
        "entering Health did not attempt its default agent",
      );
    } else {
      assert.deepEqual(
        report.scopes.health.pills.map((pill) => pill.name).sort(),
        ["Hermes", "Pi"],
        "the Health domain did not offer both agents",
      );
      assert.equal(
        report.scopes.health.pills.find((pill) => pill.name === "Hermes")?.active,
        true,
        "entering Health did not select its default agent",
      );
    }
    assert.deepEqual(
      report.scopes.financial.pills.map((pill) => pill.name),
      ["Pi"],
      "the Financial domain offered an agent scoped away from it",
    );
    assert.equal(
      report.scopes.financial.pills.find((pill) => pill.name === "Pi")?.active,
      true,
      "entering Financial did not return to its default agent",
    );

    assert.equal(fs.existsSync(THREAD_SHOT), true, "no thread screenshot");
    assert.equal(fs.existsSync(PICKER_SHOT), true, "no picker screenshot");
    for (const name of [
      "pi-companion-scope-overview.png",
      "pi-companion-scope-domain.png",
    ]) {
      assert.equal(fs.existsSync(path.join(desktopRoot, "e2e/artifacts", name)), true, `no ${name}`);
    }
    t.diagnostic(`artifact: ${REPORT}`);
  });
});
