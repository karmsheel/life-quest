import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
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
const DRIVER = "decisions-manual";
const REPORT = path.join(desktopRoot, `e2e/artifacts/${DRIVER}.json`);
const SCREENSHOTS = [
  "decisions-manual-form.png",
  "decisions-manual-history.png",
];

/**
 * Manual decisions, end to end through the shipped page.
 *
 * The operator asked for a way to log the decisions they make themselves, on
 * their own, and to see them in History alongside the AI-related ones. This wraps
 * the rig that drives the real `DecisionsInbox` over a bridge stub that plays the
 * main process, and asserts every claim its artifact makes — including the two
 * facts a screenshot cannot show: one write per logged decision, and History
 * reading the second store rather than reusing React state from the form.
 *
 * It renders a real page in a real layout engine, so it needs the Vite dev
 * server. With the server down the test skips; `lifequest-e2e` puts the checkout
 * under test on it. A skipped rig is evidence of nothing, so the artifact must
 * exist and the run must exit zero.
 */
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

function runDriver(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, `e2e/${name}.electron.mjs`)],
      { cwd: desktopRoot, timeout: 180_000 },
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

type Scenario = { name: string; pass: boolean; detail: string | null };

type Card = {
  id: string;
  title: string;
  source: string | null;
  sourceKind: string | null;
  status: string;
  kind: string | null;
};

type Screen = {
  tabs: string[];
  activeTab: string | null;
  filterButtons: Array<{ label: string; pressed: boolean }>;
  form: {
    labels: string[];
    title: string;
    rationale: string;
    domain: string;
    domainOptions: string[];
  } | null;
  rows: Card[];
  manualRows: Card[];
  empty: string | null;
  manualEmpty: string | null;
  message: string | null;
  error: string | null;
  createCalls: Array<{
    title: string;
    rationale: string | null;
    domainSlug: string | null;
  }>;
  manualListCalls: number;
  listCalls: number;
  unexpectedCalls: string[];
};

type Report = {
  pass: boolean;
  failures: string[];
  scenarios: Scenario[];
  screenshots: string[];
  checks: {
    scenarios: Scenario[];
    landing: Screen;
    manualTab: Screen;
    blank: Screen;
    afterLog: Screen;
    pending: Screen;
    history: Screen;
    manualOnly: Screen;
    aiOnly: Screen;
    all: Screen;
    returned: Screen & { mountsBefore: number; mountsAfter: number };
    unexpectedBridgeCalls: string[];
    consoleErrors: string[];
  } & Record<string, unknown>;
};

describe("manual decisions e2e", () => {
  it("logs an operator decision and shows it against the AI's in History", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`lifequest-e2e\` to include this e2e`,
      );
      throw new Error("dev server down");
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver(DRIVER);
    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact — a skipped or silent rig is evidence of nothing",
    );

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    // Every claim the rig exists to make, by name, so a silently dropped claim is
    // a failure rather than a report that happens to have fewer lines in it.
    const wanted = [
      "the-page-has-three-tabs-and-lands-on-pending",
      "the-manual-tab-opens-the-logging-form",
      "a-blank-decision-is-refused-before-the-write",
      "logging-one-decision-is-exactly-one-write",
      "the-logged-decision-is-on-the-page-immediately",
      "a-manual-decision-never-appears-under-pending",
      "history-reads-both-stores-newest-first",
      "the-ai-side-keeps-the-status-it-was-resolved-with",
      "history-shows-the-filter-and-starts-on-all",
      "the-manual-filter-leaves-only-logged-decisions",
      "the-ai-filter-leaves-only-inbox-decisions",
      "the-all-filter-brings-both-sides-back",
      "a-logged-decision-survives-a-tab-switch-from-the-store",
      "the-page-asks-the-bridge-for-nothing-else",
      "the-page-logs-no-errors",
    ];
    const byName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const name of wanted) {
      const scenario = byName.get(name);
      assert.ok(scenario, `the rig never ran the claim ${name}`);
      assert.equal(scenario.pass, true, `${name}: ${scenario.detail ?? ""}`);
    }

    // The facts the claims are made of, read straight off the artifact.
    const { landing, manualTab, afterLog, pending, history, returned } = report.checks;

    assert.deepEqual(landing.tabs, ["Pending", "History", "Manual"]);
    assert.deepEqual(manualTab.form?.labels, [
      "What did you decide?",
      "Why? (optional)",
      "Domain (optional)",
    ]);
    assert.deepEqual(manualTab.form?.domainOptions, [
      "No domain",
      "Financial",
      "Health",
    ]);
    assert.deepEqual(manualTab.manualRows, []);
    assert.equal(manualTab.manualEmpty, "No manual decisions logged yet.");

    // One write, carrying exactly what the form showed.
    assert.deepEqual(afterLog.createCalls, [
      {
        title: "Stop the gym membership",
        rationale: "The ledger says it costs more than it returns.",
        domainSlug: "financial",
      },
    ]);
    assert.equal(afterLog.manualRows.length, 1);
    assert.equal(afterLog.manualRows[0]?.id, "manual-001");
    assert.equal(afterLog.manualRows[0]?.source, "Manual");
    assert.equal(afterLog.manualRows[0]?.status, "Logged");
    assert.equal(afterLog.message, "Decision logged.");
    // The form handed the operator a blank page back, with the domain kept.
    assert.equal(afterLog.form?.title, "");
    assert.equal(afterLog.form?.rationale, "");
    assert.equal(afterLog.form?.domain, "financial");

    // The split: the manual record is never a pending proposal.
    assert.equal(pending.rows.length, 1);
    assert.equal(pending.rows[0]?.id, "decision-003");
    assert.ok(
      pending.rows.every((row) => row.id !== "manual-001"),
      "a manual decision appeared under Pending",
    );

    // History draws both stores, newest first, labelled by source.
    assert.deepEqual(
      history.rows.map((row) => row.id),
      ["manual-001", "decision-001", "decision-002"],
    );
    assert.deepEqual(
      history.rows.map((row) => row.source),
      ["Manual", "AI", "AI"],
    );
    assert.deepEqual(
      history.rows.map((row) => row.status),
      ["Logged", "approved", "rejected"],
    );

    // The filter compares the two sides.
    assert.deepEqual(
      report.checks.manualOnly.rows.map((row) => row.id),
      ["manual-001"],
    );
    assert.deepEqual(
      report.checks.aiOnly.rows.map((row) => row.id),
      ["decision-001", "decision-002"],
    );
    assert.deepEqual(
      report.checks.all.rows.map((row) => row.id),
      ["manual-001", "decision-001", "decision-002"],
    );

    // The record survives leaving the tab because History asked the store again,
    // and the page was never remounted to make that true.
    assert.ok(
      returned.manualListCalls > 0,
      "History never read the manual store",
    );
    assert.equal(
      returned.mountsAfter,
      returned.mountsBefore,
      "showing a logged decision remounted the page",
    );

    assert.deepEqual(report.checks.unexpectedBridgeCalls, []);
    assert.deepEqual(report.checks.consoleErrors, []);

    // The picture is the shipped screen, and it is on disk for the operator.
    for (const file of SCREENSHOTS) {
      assert.ok(report.screenshots.includes(file), `rig did not capture ${file}`);
      const full = path.join(desktopRoot, "e2e/artifacts", file);
      assert.ok(fs.existsSync(full), `missing screenshot ${file}`);
      assert.ok(
        fs.statSync(full).size > 10_000,
        `${file} is too small to be a screenshot of the page`,
      );
    }
  });
});
