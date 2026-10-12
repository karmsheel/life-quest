/**
 * The companion setup screen — the "Agent connecting" screen an operator used
 * to be stranded on — rendered in a real Electron window against the real
 * picker (driven by `companion-setup.electron.mjs`).
 *
 * The complaint this rig answers: the app sat on a connect screen that
 * offered only Recheck and a docs link, with no way to see the Hermes
 * profiles this machine actually has or to pick one. The screen must list
 * every installed profile, mark the one in use, move the companion onto a
 * chosen one through the bridge, and offer the app's own `lifequest` profile
 * for creation — without losing Recheck, the docs link, or the error copy.
 */
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

const REPORT = path.join(desktopRoot, "e2e/artifacts/companion-setup.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ProfileRow = {
  name: string | null;
  checked: string | null;
  disabled: boolean;
  tag: string | null;
  desc: string;
  inUse: string | null;
  box: Box | null;
};

type State = {
  viewport: { width: number; height: number };
  heading: string;
  title: string;
  body: string | null;
  empty: boolean;
  rows: ProfileRow[];
  createRow: { checked: string | null; disabled: boolean; label: string | null; box: Box | null } | null;
  recheck: { label: string; disabled: boolean; box: Box | null } | null;
  docsHref: string | null;
  listBox: Box | null;
  useCalls: string[];
  ensureCalls: number;
  active: string | null;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  fixture: { names: string[]; active: string; hasLifequest: boolean };
  states: Record<string, State>;
  screenshots: string[];
};

/** The rig measures the real screen in a real Electron window, so it needs the Vite dev server. */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runDriver(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/companion-setup.electron.mjs")],
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

describe("companion setup screen", () => {
  it("lists every Hermes profile and moves the companion onto one", async (t) => {
    if (!(await devServerUp())) {
      t.skip(
        `dev server not listening on ${DEV_PORT} — run \`npm run dev\` to include this e2e`,
      );
      return;
    }

    fs.rmSync(REPORT, { force: true });
    const exitCode = await runDriver();
    assert.equal(fs.existsSync(REPORT), true, "driver wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    const { stuck, switched, failed, afterRecheck, created, landed, inflight, noList, install } =
      report.states;

    // The stuck connect: the failure is still named, and the picker lists
    // every installed profile with `default` marked as the default.
    assert.ok(stuck.body, "the stuck screen lost its error copy");
    assert.deepEqual(
      stuck.rows.map((row) => row.name),
      report.fixture.names.map((name) => `Use the ${name} profile`),
      "the picker does not list every installed profile",
    );
    assert.equal(stuck.rows[0]?.tag, "default", "the default profile is not marked");
    assert.equal(
      stuck.rows.slice(1).every((row) => row.tag === null),
      true,
      "a non-default profile wears the default tag",
    );
    assert.equal(
      stuck.createRow?.label,
      "Create and use the lifequest profile",
      "the app's own profile is not offered for creation",
    );
    assert.equal(
      stuck.rows.every((row) => row.inUse === null && row.checked === "false"),
      true,
      "an installed profile is marked in use while the app is on an unlisted one",
    );
    // The app IS on `lifequest` by default — it just does not exist yet — so
    // the create row is the one that reads "In use".
    assert.equal(
      stuck.createRow?.checked,
      "true",
      "the create row is not marked while the app is on the lifequest profile",
    );
    assert.equal(stuck.recheck?.label, "Recheck", "Recheck did not survive the picker");
    assert.equal(stuck.recheck?.disabled, false, "Recheck is inert on the stuck screen");
    assert.equal(stuck.docsHref, null, "the docs link painted outside needs_install");
    assert.ok(
      stuck.overflow.scrollWidth <= stuck.overflow.clientWidth,
      `the screen spills past the window: ${stuck.overflow.scrollWidth}px vs ${stuck.overflow.clientWidth}px`,
    );

    // Choosing one reaches the bridge with that name and marks the row.
    assert.deepEqual(switched.useCalls, ["coder"], "the switch did not reach the bridge");
    const coder = switched.rows.find((row) => row.name === "Use the coder profile");
    assert.equal(coder?.inUse, "In use", "the chosen profile is not marked in use");
    assert.equal(coder?.checked, "true", "the chosen row is not checked");
    assert.equal(
      switched.rows
        .filter((row) => row.name !== "Use the coder profile")
        .every((row) => row.inUse === null && row.checked === "false"),
      true,
      "more than one row is marked in use",
    );

    // A failed switch is not a dead end: the picker stays, the mark moves,
    // and Recheck runs the ensure again.
    assert.equal(
      failed.body,
      "Could not reach the default profile on the Hermes host gateway.",
      "the failed switch does not name the profile it tried",
    );
    assert.equal(failed.rows.length, report.fixture.names.length, "the failed switch lost rows");
    assert.ok(failed.createRow, "the failed switch lost the create row");
    assert.equal(
      failed.rows.find((row) => row.name === "Use the default profile")?.inUse,
      "In use",
      "the failed switch did not move the in-use mark",
    );
    assert.ok(
      afterRecheck.ensureCalls > failed.ensureCalls,
      `Recheck after a failed switch did not re-run the ensure: ${failed.ensureCalls} → ${afterRecheck.ensureCalls}`,
    );

    // Creating the app's own profile: exactly `lifequest` over the bridge.
    assert.equal(
      created.useCalls.at(-1),
      "lifequest",
      `the create row switched to ${JSON.stringify(created.useCalls.at(-1))}`,
    );
    assert.equal(created.createRow?.checked, "true", "the create row is not marked in use");

    // A switch that attaches drops the error copy.
    assert.ok(
      landed.body === null || !landed.body.includes("did not serve"),
      `an attached switch still shows the error copy: ${JSON.stringify(landed.body)}`,
    );
    assert.equal(
      landed.rows.find((row) => row.name === "Use the default profile")?.inUse,
      "In use",
      "the attached profile is not the one marked in use",
    );

    // Mid-flight: no row may be clicked while an ensure runs.
    assert.equal(
      inflight.rows.every((row) => row.disabled === true),
      true,
      "a row stayed live while the ensure was in flight",
    );
    assert.equal(inflight.createRow?.disabled, true, "the create row stayed live in flight");
    assert.equal(inflight.recheck?.label, "Connecting…", "Recheck did not read Connecting…");
    assert.equal(inflight.recheck?.disabled, true, "Recheck stayed live in flight");
    assert.equal(
      inflight.useCalls.length,
      landed.useCalls.length + 1,
      `the in-flight switch did not reach the bridge exactly once: ${JSON.stringify(inflight.useCalls)}`,
    );

    // An unreadable profiles list degrades to Recheck, not a blank screen.
    assert.equal(noList.empty, true, "a failed profiles read did not show the empty state");
    assert.ok(noList.recheck, "a failed profiles read took Recheck with it");
    assert.equal(noList.heading, "LifeQuest companion", "the heading did not survive");

    // needs_install keeps its docs link, and the picker does not eat it.
    assert.equal(
      install.docsHref,
      "https://hermes-agent.nousresearch.com/docs/",
      "needs_install lost its docs link",
    );
    assert.equal(
      install.rows.length,
      report.fixture.names.length,
      "the picker is missing next to the docs link",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
