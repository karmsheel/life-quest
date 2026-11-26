import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Agent picker modes, end to end on the REAL app.
 *
 * The rig boots the app in a throwaway profile/vault/Hermes home, seeds one chat
 * list per agent, and then measures the picker's shipped modes against the real
 * DOM contract: the quiet one-mark default, the menu roster it opens, the
 * one-click/one-invoke switch (counted at the main-process IPC seam), the
 * pending mark between click and settle, a theme that names `named-chip`, a
 * custom four-axis recipe whose inline roster is a row UNDER the composer box,
 * the Settings override that must not flatten the mode, the Studio writing
 * `quiet-stack` into a profile theme file, a refused
 * `chrome.agentPicker.mode` value that names the field, and the old
 * `/extensions` address redirecting to `/customizations`.
 *
 * The assertions below restate the report's ten named checks, so a regression
 * fails here by name instead of as a generic non-zero exit. The report also
 * carries the measurements (invokes counted, switch latency, pending sightings,
 * keep method per theme) and the report's own artifact list; every picture must
 * exist on disk after a run, because a skipped or picture-less run is evidence
 * of nothing.
 *
 * The rig must run through the bench wrapper, because the rigs load the renderer
 * the shared dev server on 127.0.0.1:5173 serves and the wrapper is what puts
 * THIS checkout there:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/agent-picker-modes-e2e.test.ts
 *
 * A missing dev server fails loudly rather than skipping: "no server" is not
 * evidence the feature works.
 */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const RIG = path.join(desktopRoot, "e2e/agent-picker-modes.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/agent-picker-modes.json");
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const SHOTS = {
  default: "agent-picker-default.png",
  menu: "agent-picker-menu.png",
  namedChip: "agent-picker-named-chip.png",
  quietStack: "agent-picker-quiet-stack.png",
  studio: "agent-picker-studio-components.png",
  gutter: "agent-picker-gutter.png",
  namedChipGutter: "agent-picker-named-chip-gutter.png",
};
/** The twelve checks, in the order the rig runs them. */
const CHECKS = [
  "default-is-one-mark",
  "menu-lists-the-roster",
  "one-choice-is-one-switch",
  "pending-is-visible-and-brief",
  "theme-names-a-mode",
  "theme-combines-axes",
  "override-does-not-flatten-the-mode",
  "studio-writes-the-file",
  "refusal-names-the-field",
  "the-old-address-redirects",
  "one-mark-stands-in-the-gutter",
  "named-chip-stands-in-the-gutter",
];
const DEV_SERVER = { host: "127.0.0.1", port: 5173 };

type Check = { label: string; pass: boolean; detail: string | null };
type Keep = {
  file: string;
  previewSeen: boolean;
  keepClicked: boolean;
  kept: string | null;
  method: string | null;
};
type SwitchLeg = {
  roster: string;
  invokes: { at: number; target: string | null }[];
  result: {
    clicked: boolean;
    timedOut?: boolean;
    switchMs?: number;
    pendingSeen?: boolean;
    pendingAtEnd?: number;
    disabledSamples?: number;
    openedRoster?: boolean;
  };
};
type GutterGeometry = {
  ok: boolean;
  bandWidth: number | null;
  picker: { left: number; right: number; top: number; bottom: number; width: number };
  composerBox: { left: number; right: number; top: number; bottom: number; width: number };
  dockColumn: { left: number; right: number; top: number; bottom: number; width: number };
  clearOfBox: number;
  gutterSpan: number;
  insideDock: boolean;
  fitsGutter: boolean;
};
type WideDock = {
  method: string | null;
  window: { ok: boolean; after: { width: number; height: number } | null };
  thresholds: { minBandPx: number; oneMarkBreakpointPx: number; namedChipBreakpointPx: number };
  oneMark: { bandWidth: number | null; geometry: GutterGeometry } | null;
  namedChip: { widths: { bandWidth: number | null; geometry: GutterGeometry }[] };
};
type Report = {
  ranAt: string;
  pass: boolean;
  failures: string[];
  checks: Check[];
  artifacts: {
    default: string;
    menu: string;
    namedChip: string;
    quietStack: string;
    studio: string;
    gutter: string;
    namedChipGutter: string;
  };
  wideDock: WideDock;
  captures: Record<string, { path: string; bytes: number; attempts: number }>;
  world: {
    world: string;
    themeKeeps: Keep[];
    harnessOnBoot: string | null;
    checksMeasured: { themeKeeps: Keep[]; switches: SwitchLeg[]; seedOk: boolean; harnessOnBoot: string | null };
  };
  switchInvokes: { at: number; target: string | null }[];
  consoleErrors: { message: string }[];
  renderProcessGone: unknown[];
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_SERVER.port, DEV_SERVER.host);
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function runRig(): Promise<{ code: number; signal: string | null; report: Report | null }> {
  fs.rmSync(REPORT, { force: true });
  for (const shot of Object.values(SHOTS)) fs.rmSync(path.join(ARTIFACTS, shot), { force: true });
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [RIG],
      {
        cwd: desktopRoot,
        // The rig boots the app, seeds two agents, walks theme preview → Keep →
        // reload several times and opens the studio; it runs for a couple of
        // minutes on an idle machine and longer when the box is busy. A tighter
        // watchdog would kill it before it writes its report, which reads as
        // "the rig wrote no report" instead of the failure it is.
        timeout: 600_000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          ELECTRON_DISABLE_SANDBOX: "1",
        } as NodeJS.ProcessEnv,
      },
      (error, _stdout, _stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        const code = error && typeof error.code === "number" ? error.code : 0;
        const report = fs.existsSync(REPORT)
          ? (JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report)
          : null;
        resolve({ code, signal: error?.signal ?? null, report });
      },
    );
  });
}

describe("agent picker modes", () => {
  it("proves the picker's modes against the real app", async (t) => {
    if (!(await devServerUp())) {
      assert.fail(
        "no dev server on 127.0.0.1:5173 — run through /root/.local/bin/lifequest-e2e so this checkout is the one being tested",
      );
    }
    // The bench's dev script bundles this after every main-process edit; without
    // it the rig imports a stale (or absent) seam bundle instead of this
    // checkout's. The renderer itself is served from source by Vite, so there is
    // no `dist/index.html` to wait for until a production build runs.
    const seamBundle = path.join(desktopRoot, "dist-electron/main.js");
    assert.ok(
      fs.existsSync(seamBundle),
      "no dist-electron/main.js — run through /root/.local/bin/lifequest-e2e, which builds the e2e seam",
    );

    const { code, signal, report } = await runRig();
    assert.ok(report, `the rig wrote no report${signal ? ` (killed by ${signal})` : ""}`);

    // The ten checks, by name, in order — a missing or renamed check is a
    // change to the feature's evidence, not a detail.
    assert.deepEqual(
      report.checks.map((check) => check.label),
      CHECKS,
      "the report's named checks changed",
    );
    for (const entry of report.checks) {
      assert.ok(entry.pass, `${entry.label}: ${entry.detail ?? "failed"}`);
    }
    assert.deepEqual(report.failures, [], "the rig recorded failures");
    assert.equal(report.pass, true, "the report is not green");
    assert.equal(code, 0, `the rig exited ${code}`);

    // The measurements the checks rest on, restated so a loosened check cannot
    // hide behind a green flag.
    const measured = report.world.checksMeasured;
    assert.equal(measured.seedOk, true, "the two agents' chats were not seeded");
    assert.equal(measured.harnessOnBoot, "hermes", "the world did not boot on Hermes");
    assert.equal(measured.themeKeeps.length, 5, "the rig did not keep five theme files");
    for (const keep of measured.themeKeeps) {
      assert.ok(keep.kept === keep.file, `theme ${keep.file} was not kept (kept=${keep.kept})`);
      assert.ok(keep.method !== null, `theme ${keep.file} took no keep path`);
    }
    const menuSwitch = measured.switches.find((leg) => leg.roster === "menu");
    const inlineSwitch = measured.switches.find((leg) => leg.roster === "inline");
    assert.ok(menuSwitch, "no menu-roster switch was measured");
    assert.ok(inlineSwitch, "no inline-roster switch was measured");
    assert.equal(menuSwitch.invokes.length, 1, "one menu choice did not make exactly one invoke");
    assert.equal(menuSwitch.invokes[0].target, "pi", "the menu switch did not target Pi");
    assert.equal(inlineSwitch.invokes.length, 1, "one inline choice did not make exactly one invoke");
    assert.equal(inlineSwitch.invokes[0].target, "pi", "the inline switch did not target Pi");
    assert.equal(menuSwitch.result.pendingSeen, true, "the menu switch never showed a pending mark");
    assert.equal(menuSwitch.result.disabledSamples, 0, "the menu switch disabled an option");
    assert.equal(menuSwitch.result.pendingAtEnd, 0, "the menu switch left something pending");

    // The inline rosters (`quiet-stack` and the custom recipe) are a row UNDER
    // the composer box, right-aligned to the box's trailing edge — not tokens in
    // the control row anymore. Restate the geometry from the two check details,
    // so a loosened check cannot hide behind the green flag.
    type Placement = {
      belowBox?: boolean;
      rightAligned?: boolean;
      insideDock?: boolean;
      gap?: number;
      rightDelta?: number;
      composerBoxBottom?: number;
      pickerTop?: number;
    };
    for (const name of ["theme-combines-axes", "studio-writes-the-file"] as const) {
      const check = report.checks.find((entry) => entry.label === name);
      assert.ok(check, `missing check ${name}`);
      const detail = check.detail
        ? (JSON.parse(check.detail) as { placement?: Placement })
        : {};
      const placement = detail.placement;
      assert.ok(placement, `${name} records no placement detail for its inline roster`);
      assert.equal(
        placement.belowBox,
        true,
        `${name}: the inline roster is not below the composer box (gap ${placement.gap}px)`,
      );
      assert.equal(
        placement.rightAligned,
        true,
        `${name}: the inline roster is ${placement.rightDelta}px off the box's trailing edge`,
      );
      assert.ok(
        (placement.gap ?? 0) > 0 && (placement.gap ?? 0) < 40,
        `${name}: the box→roster gap ${placement.gap}px is not a real row gap`,
      );
      assert.equal(placement.insideDock, true, `${name}: the inline roster left the dock column`);
      assert.ok(
        (placement.pickerTop ?? 0) >= (placement.composerBoxBottom ?? 0),
        `${name}: the inline roster overlaps the composer box`,
      );
    }

    // The wide dock: the placement the operator's own wider column shows. The two
    // checks above prove the trigger stands in the composer's trailing gutter at
    // both the one-mark and the labelled-chip breakpoint; these assertions restate
    // the numbers they rest on, from both sides of the 34rem/52rem rules.
    assert.ok(report.wideDock, "the report has no wideDock block");
    assert.equal(report.wideDock.window.ok, true, "the window never reached the wide size the band needs");
    assert.ok(
      report.wideDock.method === "pointer" || report.wideDock.method === "keyboard",
      `the dock was widened by ${report.wideDock.method ?? "nothing"} — no real resize gesture`,
    );
    assert.ok(report.wideDock.oneMark, "the report has no one-mark wide-dock measurement");
    const oneMarkWide = report.wideDock.oneMark;
    assert.ok(
      (oneMarkWide.bandWidth ?? 0) >= report.wideDock.thresholds.minBandPx,
      `the one-mark dock band is ${oneMarkWide.bandWidth}px — narrower than the wide dock this check names`,
    );
    assert.ok(
      (oneMarkWide.bandWidth ?? 0) > report.wideDock.thresholds.oneMarkBreakpointPx,
      `the one-mark dock band is ${oneMarkWide.bandWidth}px — the 34rem fallback is still in force`,
    );
    assert.equal(oneMarkWide.geometry.ok, true, "the one-mark trigger is not in the gutter");
    assert.ok(oneMarkWide.geometry.clearOfBox >= 0, "the one-mark trigger overlaps the composer box");
    assert.equal(oneMarkWide.geometry.insideDock, true, "the one-mark trigger left the dock column");
    assert.equal(oneMarkWide.geometry.fitsGutter, true, "the one-mark trigger is wider than its gutter");
    assert.equal(report.wideDock.namedChip.widths.length, 2, "the named-chip dock was not measured on both sides");
    for (const [index, width] of report.wideDock.namedChip.widths.entries()) {
      assert.ok(
        (width.bandWidth ?? 0) > report.wideDock.thresholds.namedChipBreakpointPx,
        `the named-chip band #${index + 1} is ${width.bandWidth}px — the 52rem fallback is still in force`,
      );
      assert.equal(width.geometry.ok, true, `the named-chip trigger is not in the gutter at band #${index + 1}`);
      assert.ok(width.geometry.clearOfBox >= 0, `the named-chip trigger overlaps the composer box at band #${index + 1}`);
      assert.equal(width.geometry.insideDock, true, `the named-chip trigger left the dock column at band #${index + 1}`);
    }
    assert.ok(
      (report.wideDock.namedChip.widths[1].bandWidth ?? 0) > (report.wideDock.namedChip.widths[0].bandWidth ?? 0),
      "the second named-chip width is not wider than the first",
    );

    // Every picture must exist: the shots are the feature's evidence.
    for (const [key, file] of Object.entries(SHOTS)) {
      assert.equal(
        report.artifacts[key as keyof typeof SHOTS],
        path.join("e2e", "artifacts", file),
        `the report names the wrong ${key} artifact`,
      );
      assert.ok(fs.existsSync(path.join(ARTIFACTS, file)), `missing artifact ${file}`);
    }
    // A picture that exists but is a uniform fill is not evidence: capturePage
    // can return a blank surface before the window's first paint, so the rig
    // retries and records the byte count. Hold it to that bar here too.
    for (const [key, minimum] of Object.entries({ default: 20_000, menu: 3_000, namedChip: 3_000, quietStack: 3_000, studio: 3_000, gutter: 20_000, namedChipGutter: 20_000 })) {
      const capture = report.captures?.[key];
      assert.ok(capture, `the report has no capture entry for ${key}`);
      assert.ok(
        capture.bytes >= minimum,
        `${key} picture is only ${capture.bytes} bytes — a blank or near-blank capture, not evidence`,
      );
      assert.ok(fs.existsSync(path.join(ARTIFACTS, SHOTS[key as keyof typeof SHOTS])), `missing artifact ${key}`);
    }
    assert.deepEqual(report.renderProcessGone, [], "the renderer process died during the run");

    t.diagnostic(`artifact: ${REPORT}`);
    t.diagnostic(`switch invokes: ${JSON.stringify(report.switchInvokes.map((entry) => entry.target))}`);
    t.diagnostic(
      `menu switch: ${menuSwitch.result.switchMs}ms, pending seen ${menuSwitch.result.pendingSeen}`,
    );
    t.diagnostic(
      `keeps: ${measured.themeKeeps.map((keep) => `${keep.file}:${keep.method}`).join(", ")}`,
    );
    t.diagnostic(
      `wide dock: ${report.wideDock.method}, one-mark band ${oneMarkWide.bandWidth}px clear ${oneMarkWide.geometry.clearOfBox}px, named-chip bands ${report.wideDock.namedChip.widths.map((width) => `${width.bandWidth}px/clear ${width.geometry.clearOfBox}px`).join(", ")}`,
    );
  });
});
