import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;

/**
 * The page-context rig.
 *
 * One harness page holds both ends of the feature — the real Dashboard, or the
 * real Goals screen, in the shell's content column, and the real `ChatPanel`
 * beside it — because the claim that matters crosses them: the screen the
 * operator is looking at is the screen the next turn quotes, and the instruction
 * that reaches the model says so. Either half alone would prove nothing: a pill
 * that gates nothing, or a reader nothing turns on.
 *
 * It renders real pages in a real layout engine, so it needs the Vite dev
 * server. With it down the test skips; `npm run dev` in another terminal brings
 * it up.
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
      { cwd: desktopRoot, timeout: 120_000 },
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

type Report = {
  pass: boolean;
  failures: string[];
  checks: {
    scenarios: Scenario[];
    landing: Sample;
    off: Sample["pill"];
    offTurn: { hasKey: boolean; pageContext: unknown; quotes: boolean };
    arrived: Sample;
    goalsTurn: {
      pageContext: { route: string; label: string; body: string } | null;
      hasBlock: boolean;
      hasEnd: boolean;
    };
    chrome: {
      railText: string;
      bodyMentionsRail: boolean;
      bodyMentionsComposer: boolean;
      firstLine: string | null;
    };
    dashboardTurn: {
      route: string | null;
      label: string | null;
      body: string;
      namesTheCard: boolean;
      namesTheFigures: boolean;
      noAffordances: boolean;
      headingIsSpaced: boolean;
      saysAlreadyExists: boolean;
      saysNoDuplicate: boolean;
    };
    afterTurns: Sample["pill"];
    consoleErrors: string[];
  };
};

type Sample = {
  path: string | null;
  pill: {
    text: string;
    label: string | null;
    kind: string | null;
    state: string | null;
    pressed: string | null;
    aria: string | null;
    title: string | null;
    type: string | null;
    svgs: number;
    icon: string | null;
  } | null;
  attach: { label: string | null; svgs: number; icon: string | null } | null;
  line: { children: string[] } | null;
  inLine: boolean;
  attachBeforePill: boolean;
  attachLeftOfPill: boolean;
  sameRow: boolean;
  pageHeading: string | null;
  railText: string | null;
  calls: number;
};

describe("page context e2e", () => {
  it("puts the screen in front of the operator into the turn, and lets it be turned off", async (t) => {
    if (!(await devServerUp())) {
      t.skip(`dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`);
      return;
    }

    const driver = "page-context";
    const reportPath = path.join(desktopRoot, `e2e/artifacts/${driver}.json`);
    fs.rmSync(reportPath, { force: true });
    const exitCode = await runDriver(driver);
    assert.equal(fs.existsSync(reportPath), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(exitCode, 0, "driver exited non-zero");

    const byName = new Map(report.checks.scenarios.map((s) => [s.name, s]));
    for (const name of [
      "the-pill-is-on-by-default",
      "the-pill-sits-beside-the-attach-control",
      "clicking-the-pill-turns-it-off",
      "a-turn-sent-while-off-quotes-nothing",
      "walking-to-another-page-turns-it-back-on",
      "the-turn-carries-the-screen",
      "the-outline-is-the-page-and-not-the-chrome",
      "the-dashboard-says-what-is-already-there",
      "the-pill-survives-the-turns-it-sends",
    ]) {
      const scenario = byName.get(name);
      assert.ok(scenario, `${driver} never ran the scenario ${name}`);
      assert.equal(scenario.pass, true, `${driver} failed ${name}: ${scenario.detail ?? ""}`);
    }

    // Landing: on, named the way the rail names it, and beside the receipt
    // control rather than somewhere else on the line.
    const landing = report.checks.landing;
    assert.equal(landing.path, "/home");
    assert.equal(landing.pill?.label, "Dashboard");
    assert.equal(landing.pill?.state, "on");
    assert.equal(landing.pill?.pressed, "true");
    assert.equal(landing.attachBeforePill, true, "the pill is not after the attach control");
    assert.equal(landing.inLine, true, "the pill left the composer's footer line");
    assert.equal(landing.attach?.label, "Attach a receipt", "the attach control changed");

    // Off is a state, not a disappearance: the pill and its name stay put.
    assert.equal(report.checks.off?.state, "off");
    assert.equal(report.checks.off?.label, "Dashboard");
    assert.equal(report.checks.off?.pressed, "false");

    // Off really gates the read: no key at all, and no block in the text.
    assert.equal(report.checks.offTurn.hasKey, false, "a turn while off still carried pageContext");
    assert.equal(report.checks.offTurn.quotes, false, "a turn while off still quoted the page");

    // Walking away re-arms it, naming the new screen.
    assert.equal(report.checks.arrived.path, "/goals");
    assert.equal(report.checks.arrived.pill?.label, "Goals");
    assert.equal(report.checks.arrived.pill?.state, "on");

    // The screen itself, quoted: route, label, and the page's own words.
    const goals = report.checks.goalsTurn.pageContext;
    assert.equal(goals?.route, "/goals");
    assert.equal(goals?.label, "Goals");
    assert.match(goals?.body ?? "", /^# Goals$/m);
    assert.match(goals?.body ?? "", /- Run a half marathon/);
    assert.match(goals?.body ?? "", /\[table\] Progress: Goal \| Progress/);
    assert.equal(report.checks.goalsTurn.hasBlock, true, "the page block never reached the instruction");
    assert.equal(report.checks.goalsTurn.hasEnd, true, "the page block was left unterminated");

    // The outline is the page: the rail's own marker is on screen the whole
    // time and must never be quoted as if it were the operator's content.
    assert.equal(report.checks.chrome.railText, "RAIL-CHROME-MARKER");
    assert.equal(report.checks.chrome.bodyMentionsRail, false, "the outline quoted the nav rail");
    assert.equal(report.checks.chrome.bodyMentionsComposer, false, "the outline quoted the composer");
    assert.equal(report.checks.chrome.firstLine, "# Goals");

    // The reported failure, made falsifiable: the Dashboard turn names the
    // expense card that is already there, with its rendered weeks, and the text
    // the model reads tells it not to propose a duplicate.
    const dashboard = report.checks.dashboardTurn;
    assert.equal(dashboard.route, "/home");
    assert.equal(dashboard.label, "Dashboard");
    assert.equal(dashboard.namesTheCard, true, `the outline missed the card:\n${dashboard.body}`);
    assert.equal(
      dashboard.namesTheFigures,
      true,
      `the outline missed the card's figures:\n${dashboard.body}`,
    );
    // A control's label is not a thing on the screen: the card's picker says
    // "Metric | Table | Bar | Line", and quoted as content those read as charts.
    assert.equal(
      dashboard.noAffordances,
      true,
      `the outline quoted the card's controls:\n${dashboard.body}`,
    );
    assert.equal(dashboard.headingIsSpaced, true, `a heading's badge was welded on:\n${dashboard.body}`);
    assert.equal(dashboard.saysAlreadyExists, true);
    assert.equal(dashboard.saysNoDuplicate, true);

    // Sending a turn does not spend the pill.
    assert.equal(report.checks.afterTurns?.state, "on");
    assert.equal(report.checks.afterTurns?.label, "Dashboard");

    assert.deepEqual(report.checks.consoleErrors, []);
  });
});
