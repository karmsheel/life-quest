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
const REPORT = path.join(desktopRoot, "e2e/artifacts/welcome-pane.json");

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type State = {
  viewport: { width: number; height: number };
  tokens: { frame: number; titlebarHeight: number; pageCanvas: string; border: string };
  titlebar: Box | null;
  body: {
    box: Box;
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
  } | null;
  pane: {
    box: Box;
    borderRadius: string;
    borderTopWidth: string;
    borderRightWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    borderTopColor: string;
    background: string;
    boxShadow: string;
    marginRight: string;
    marginBottom: string;
    tag: string;
    parentIsBody: boolean;
  } | null;
  card: Box | null;
  heading: string;
  overflow: { scrollWidth: number; clientWidth: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  tokens: State["tokens"];
  state: State;
  screenshots: string[];
};

/**
 * The welcome rig measures the real boot surface in a real Electron window, so
 * it needs the Vite dev server. With the server down the test skips; `npm run
 * dev` in another shell turns it on.
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
      [path.join(desktopRoot, "e2e/welcome-pane.electron.mjs")],
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

describe("welcome pane (the boot surfaces' frame)", () => {
  it("runs flush to the window and keeps its pane gap only under the titlebar", async (t) => {
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
    const { frame, titlebarHeight } = report.tokens;
    const { viewport, pane } = report.state;

    assert.deepEqual(report.failures, []);
    assert.equal(exitCode, 0, "driver exited non-zero");
    assert.equal(report.pass, true);

    // Restated here so the numbers are asserted by the suite, not only inside
    // the driver — and so a regression names the geometry it broke.
    assert.ok(pane, "the boot surface rendered no .welcome pane");
    assert.equal(
      pane.box.left,
      0,
      "the pane kept a leading inset — there is no rail on this surface",
    );
    assert.equal(
      pane.box.right,
      viewport.width,
      "the pane stopped short of the window's right edge",
    );
    assert.equal(
      pane.box.bottom,
      viewport.height,
      "the pane stopped short of the window's bottom edge",
    );
    assert.equal(
      pane.box.top,
      titlebarHeight + frame,
      `the strip's hairline is not one pane gap under it (${pane.box.top}px vs ${titlebarHeight + frame}px)`,
    );

    // A radius on a box flush with the window's edge leaves a notch the canvas
    // shows through — the gap coming back at the corners the pane now owns.
    assert.equal(
      pane.borderRadius,
      "0px",
      `the pane kept a rounded corner (${pane.borderRadius})`,
    );

    // The pane is the only box here, so its hairline is the only line drawn.
    for (const [side, width] of [
      ["top", pane.borderTopWidth],
      ["right", pane.borderRightWidth],
      ["bottom", pane.borderBottomWidth],
      ["left", pane.borderLeftWidth],
    ] as const) {
      assert.ok(
        parseFloat(width) > 0 && parseFloat(width) <= 1,
        `the pane has no hairline on its ${side} edge (${width})`,
      );
    }

    // Flush with three window edges, a shadow is clipped on all three and
    // survives only as a halo over the top seam — a second line where the
    // hairline is meant to be the only one. The sheet is the pane that keeps one.
    assert.equal(
      pane.boxShadow,
      "none",
      `the pane still floats on a shadow (${pane.boxShadow})`,
    );

    // The surface: the same page canvas the workspace sheet stands on — the
    // deepest ink in the window at night, with the mat, the cards and the panels
    // stepping up off it.
    assert.equal(
      pane.background,
      report.tokens.pageCanvas,
      "the pane is not on the page canvas the sheet uses",
    );

    // The real page rendered, not an empty box the geometry could still pass on.
    assert.equal(report.state.heading, "LifeQuest", "the welcome card did not render");

    // The escapes are negative margins: neither may overshoot into a scrollbar.
    assert.ok(
      report.state.overflow.scrollWidth <= viewport.width,
      `the pane spills past the window: ${report.state.overflow.scrollWidth}px of content in ${viewport.width}px`,
    );

    for (const file of report.screenshots) {
      assert.equal(fs.existsSync(file), true, `driver wrote no screenshot ${file}`);
    }
  });
});
