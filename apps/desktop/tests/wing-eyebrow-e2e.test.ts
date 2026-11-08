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
const REPORT = path.join(desktopRoot, "e2e/artifacts/wing-eyebrow.json");

type Link = { label: string; href: string | null; active: boolean };
type Tab = { label: string; selected: boolean };
type State = {
  route: string | null;
  eyebrow: string | null;
  eyebrowCount: number;
  eyebrowUpper: string | null;
  eyebrowPage: string | null;
  /** The eyebrow's painted colour, as the browser resolves it. */
  eyebrowColor: string | null;
  /** `--muted-foreground` painted onto a probe element, same resolution. */
  mutedColor: string | null;
  heading: string | null;
  eyebrowAboveTitle: boolean | null;
  activeTab: string | null;
  tabs: Tab[];
  rail: Link[];
  errors: string[];
};

type Expectation = {
  route: string;
  eyebrow: string;
  wing: string;
  heading: string;
};

type Report = {
  pass: boolean;
  failures: string[];
  expectations: { PAGES: Expectation[]; RAILS: Record<string, string[]> };
  states: Record<string, State>;
  screenshots: string[];
};

/**
 * The wing-eyebrow rig drives the real shell in a real Electron window, so it
 * needs the Vite dev server. With the server down the test skips; `npm run dev`
 * in another shell turns it on.
 */
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
      [path.join(desktopRoot, "e2e/wing-eyebrow.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000 },
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

const labels = (links: Link[]) => links.map((link) => link.label);

describe("wing eyebrow (every wing page opens with its own name)", () => {
  it("opens every wing page with its page name, and keeps Images under Home", async (t) => {
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

    // Restated here so the numbers are asserted by the suite, not only inside
    // the driver — and so a regression names the page it broke.
    const { PAGES, RAILS } = report.expectations;

    for (const page of PAGES) {
      const state = report.states[page.route];
      assert.ok(state, `the rig never reached ${page.route}`);
      assert.equal(
        state.eyebrow,
        page.eyebrow,
        `${page.route} does not open with "${page.eyebrow}"`,
      );
      assert.equal(
        state.eyebrowCount,
        1,
        `${page.route} carries ${state.eyebrowCount} eyebrows, expected 1`,
      );
      assert.equal(
        state.eyebrowUpper,
        "uppercase",
        `${page.route}'s eyebrow is not drawn in capitals`,
      );
      assert.equal(
        state.eyebrowAboveTitle,
        true,
        `${page.route}'s eyebrow does not sit above the title`,
      );
      // The Dashboard's eyebrow used to be accent-coloured; every page's is
      // the shell's muted grey now, resolved to what the browser paints.
      assert.equal(
        state.eyebrowColor,
        state.mutedColor,
        `${page.route}'s eyebrow is ${state.eyebrowColor}, not the muted grey ${state.mutedColor}`,
      );
      assert.equal(
        state.activeTab,
        page.wing,
        `${page.route} does not belong to the ${page.wing} wing`,
      );
      assert.deepEqual(
        labels(state.rail),
        RAILS[page.wing],
        `the ${page.wing} rail moved`,
      );
      assert.deepEqual(state.errors, [], `${page.route} logged an error`);
    }

    // One grey, not twenty nearby greys: the painted colour across every page
    // is a single value, so no page can quietly keep a colour of its own.
    const greys = new Set(PAGES.map((page) => report.states[page.route].eyebrowColor));
    assert.equal(greys.size, 1, `eyebrows painted ${JSON.stringify([...greys])}`);
    assert.notEqual([...greys][0], null, "no eyebrow reported a colour");

    // The renames and the move, read off the rails the rig sampled.
    assert.ok(
      labels(report.states["/home"].rail).includes("Agents"),
      "the Home rail does not carry Agents",
    );
    assert.ok(
      !labels(report.states["/home"].rail).includes("Personnel"),
      "the Home rail still carries Personnel",
    );
    assert.ok(
      labels(report.states["/act"].rail).includes("Task Manager"),
      "the Act rail does not carry Task Manager",
    );
    assert.ok(
      !labels(report.states["/dream"].rail).includes("Images"),
      "the Define rail still carries Images",
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
