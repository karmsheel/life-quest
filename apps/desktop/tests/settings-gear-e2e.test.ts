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
const REPORT = path.join(desktopRoot, "e2e/artifacts/settings-gear.json");

type Sample = {
  path: string | null;
  viewport: { width: number; height: number };
  backgroundPage: boolean;
  overlay: boolean;
  panelPresent: boolean;
  nav: string[];
  searchPresent: boolean;
  quickMenuOpen: boolean;
  gear: {
    tag: string | null;
    href: string | null;
    label: string | null;
    title: string | null;
    hasPopup: string | null;
    expanded: string | null;
    inTitlebar: boolean;
  } | null;
  gearPopover: boolean;
  themeControlPresent: boolean;
};

type Report = {
  pass: boolean;
  failures: string[];
  steps: Record<string, unknown>;
  states: Record<string, Sample>;
  screenshots: string[];
};

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
      [path.join(desktopRoot, "e2e/settings-gear.electron.mjs")],
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

describe("the titlebar's settings gear", () => {
  it("links straight to the full settings sheet, and leaves the theme menu on the day/night control", async (t) => {
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

    const state = (name: string): Sample => {
      const found = report.states[name];
      assert.ok(found, `the report carries no "${name}" state`);
      return found;
    };

    // —— 1. The gear is a link to the settings sheet, and it is not a menu
    //       trigger: it announces no popup and opens no popover of its own.
    const landing = state("landing");
    assert.equal(landing.gear?.tag, "A", "the gear is not an anchor");
    assert.equal(landing.gear?.href, "/settings", "the gear does not point at the settings route");
    assert.equal(landing.gear?.label, "Open settings", "the gear is unlabelled");
    assert.equal(landing.gear?.title, "Settings", "the gear has no pointer name");
    assert.equal(landing.gear?.hasPopup, null, "the gear still announces a menu");
    assert.equal(landing.gear?.expanded, null, "the gear still reports a menu state");
    assert.equal(landing.gear?.inTitlebar, true, "the gear left the titlebar's trailing cluster");
    assert.equal(landing.overlay, false, "the settings sheet is up before the gear is pressed");
    assert.equal(landing.gearPopover, false, "a settings popover opened on arrival");
    assert.equal(
      landing.themeControlPresent,
      true,
      "the day/night control left the titlebar's trailing cluster",
    );

    // —— 2. Pressing the gear opens the whole sheet, over the page behind it.
    const opened = state("opened");
    assert.equal(opened.path, "/settings", "the gear did not navigate to the settings route");
    assert.equal(opened.overlay, true, "the gear did not open the settings sheet");
    assert.equal(opened.panelPresent, true, "the settings sheet painted no panel");
    assert.equal(opened.searchPresent, true, "the sheet has no search field");
    assert.ok(opened.nav.length > 1, "the sheet did not open on the full tab list");
    assert.equal(
      opened.gearPopover,
      false,
      "the gear opened a popover instead of the sheet",
    );
    assert.equal(
      opened.backgroundPage,
      true,
      "the gear unmounted the page behind the sheet — the backdrop blurs nothing",
    );

    // —— 3. The theme quick menu moved to the day/night control, not with the
    //       gear: hovering the control still opens it.
    const themed = state("themed");
    assert.equal(
      themed.quickMenuOpen,
      true,
      "the day/night control no longer opens the theme quick menu",
    );
    assert.equal(themed.gearPopover, false, "the gear opened a popover of its own");

    // The repeatable artifact: the JSON report plus the frames it measured.
    for (const file of report.screenshots) {
      assert.equal(
        fs.existsSync(path.join(desktopRoot, "e2e/artifacts", file)),
        true,
        `driver wrote no screenshot ${file}`,
      );
    }
  });
});
