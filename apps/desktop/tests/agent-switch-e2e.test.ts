import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Agent switching, end to end.
 *
 * The rig boots the real app against a throwaway profile, vault and Hermes home,
 * seeds two chats on each agent (a fake Hermes host gateway for the external
 * one, a fake OpenAI-compatible endpoint for the built-in one), opens two Hermes
 * tabs, then clicks the Pi pill with a MutationObserver watching `#root`.
 *
 * The assertions below are the important report fields restated by name, so a
 * regression fails here by field instead of as a generic non-zero exit:
 *   - the connect screen never appeared (`welcomeSeen`), the dashboard node was
 *     never remounted (`dashboardGone`), the splash never returned;
 *   - the rail and tab strip swapped to the new agent's chats, the Pill became
 *     active, and the switch stayed under the latency ceiling;
 *   - switching back restored Hermes's rail *and* both Hermes tabs;
 *   - the dock surface stayed mounted at every sample and no console errors or
 *     uncaught exceptions were logged.
 *
 * It also holds the switch's races, each also a named report field:
 *   A. one `companion:switchHarness` invoke per pill click, and no pill left
 *      pending (`switchInvokes`, `pill.pendingAtEnd`/`busyAtEnd`);
 *   B. the chat rail never an empty column while switching
 *      (`rail.blankSamples`);
 *   C. the composer draft survives the round trip (`draft.restored`);
 *   D. per-agent tab memory (`persistence.beforeReload`) restored by a reload
 *      (`reload.tabLabels`, same active tab);
 *   E. the target pill never disabled by the switch (`pill.disabledSamples`).
 *
 * The rig must run through the bench wrapper, because the rigs load the
 * renderer the shared dev server on 127.0.0.1:5173 serves and the wrapper is
 * what puts THIS checkout there:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/agent-switch-e2e.test.ts
 *
 * A skipped rig is evidence of nothing, so a missing dev server fails loudly
 * instead of skipping.
 */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DRIVER = path.join(desktopRoot, "e2e/agent-switch.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/agent-switch.json");
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const SHOTS = [
  "agent-switch-before.png",
  "agent-switch-during.png",
  "agent-switch-after.png",
];

const DEV_SERVER = { host: "127.0.0.1", port: 5173 };
/** Kept in step with the rig's own ceiling; the report carries the actual ms. */
const SWITCH_CEILING_MS = 2000;

type State = {
  railTitles: string[];
  railActive: string | null;
  tabLabels: string[];
  activeTabLabel: string | null;
  tabCount: number;
  pills: { name: string; active: boolean; disabled: boolean; pending: boolean; busy: boolean }[];
  activePill: string | null;
  pendingPills: string[];
  busyPills: string[];
  dashboard: boolean;
  markedDashboard: boolean;
  welcomeCard: boolean;
  chatPanel: boolean;
  splashHidden: boolean;
  hash: string;
};

type SwitchResult = {
  clicked: boolean;
  timedOut?: boolean;
  switchMs: number;
  activePill: string | null;
  railTitles: string[];
  tabLabels: string[];
  activeTabLabel: string | null;
  pillDisabledAtEnd: boolean;
  pillDisabledSamples: number;
  welcomeCardAbsent: boolean;
  markedDashboardPresent: boolean;
  chatPanelPresent: boolean;
};

type RestoreResult = {
  clicked: boolean;
  wasActive?: boolean;
  timedOut?: boolean;
  restoreMs: number;
  activePill: string | null;
  railTitles: string[];
  tabLabels: string[];
  activeTabLabel: string | null;
  markedDashboardPresent: boolean;
  welcomeCardAbsent: boolean;
};

type Report = {
  ok: boolean;
  failures: string[];
  checks: { name: string; pass: boolean; detail: unknown }[];
  world: {
    profile: string;
    harnessOnBoot: string | null;
    devServerUrl: string;
    piEndpoint: string;
  };
  seed: {
    hermesReady: string;
    piReady: string;
    backToHermes: string;
    hermesCreated: { title: string; ok: boolean }[];
    piCreated: { title: string; ok: boolean }[];
    piListed: string[];
    hermesListed: string[];
  };
  before: {
    harness: string | null;
    railTitles: string[];
    tabLabels: string[];
    tabCount: number;
    activePill: string | null;
  };
  probe: {
    welcomeSeen: number;
    dashboardGone: number;
    splashSeen: number;
    chatPanelMissing: number;
    duringSwitchSamples: number;
    chatPanelPresentEverySample: boolean;
    markedDashboardPresent: boolean;
    errors: { kind: string; message: string }[];
  };
  afterSwitch: SwitchResult & { state: State };
  restored: RestoreResult & { state: State };
  switchCeilingMs: number;
  switchInvokes: {
    total: number;
    entries: { at: number; target: string | null }[];
    beforeSwitch: number;
    duringSwitch: number;
    duringRestore: number;
    pageWrap: { frozen: boolean; wrapped: boolean; error: string | null };
    pageCalls: number | null;
  };
  rail: {
    blankSamples: number;
    sampleCount: number;
    blankDetails: { t: number }[];
  };
  pill: {
    disabledSamples: number;
    pendingAfterSwitch: string[];
    busyAfterSwitch: string[];
    pendingAtEnd: string[];
    busyAtEnd: string[];
  };
  draft: {
    text: string;
    typed: { ok: boolean; value?: string; reason?: string };
    before: { value: string | null };
    afterSwitch: { value: string | null };
    restored: { value: string | null };
  };
  persistence: {
    beforeReload: {
      hermesRaw: string | null;
      piRaw: string | null;
      legacyRaw: string | null;
      hermes: { tabs: string[]; activeId: string | null } | null;
      pi: { tabs: string[]; activeId: string | null } | null;
    };
  };
  reload: {
    bootMs: number;
    samples: number;
    welcomeCardSamples: number;
    welcomeCardSeen: boolean;
    expectedActiveTab: string | null;
    tabLabels: string[];
    activeTabLabel: string | null;
    dashboard: boolean;
    chatPanel: boolean;
  };
  duringShot: {
    capturedAtMs: number | null;
    whileSwitchPending: boolean;
    differsFromBefore: boolean;
  };
  consoleErrors: { level: unknown; message: string; source: string }[];
  renderProcessGone: { reason: string }[];
  pageErrors: { kind: string; message: string }[];
  screenshots: string[];
};

/** Is something actually accepting connections on the bench's dev port? */
function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(DEV_SERVER, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1500);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function runRig(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      electron,
      [DRIVER],
      {
        cwd: desktopRoot,
        timeout: 240_000,
        env: {
          ...process.env,
          // Electron hosts export this; left in place the rig runs as plain
          // Node and never opens a window.
          ELECTRON_RUN_AS_NODE: undefined,
        } as NodeJS.ProcessEnv,
      },
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

describe("agent switch (the studio stays up)", () => {
  it("switches agents without tearing the studio down, and restores the tabs", async (t) => {
    const up = await devServerUp();
    assert.equal(
      up,
      true,
      `no dev server on ${DEV_SERVER.host}:${DEV_SERVER.port} — this rig must run through ` +
        "`/root/.local/bin/lifequest-e2e <checkout> tests/agent-switch-e2e.test.ts`, which puts " +
        "this checkout on the bench. A skipped rig is evidence of nothing.",
    );
    assert.equal(
      fs.existsSync(path.join(desktopRoot, "dist-electron/main.js")),
      true,
      "no dist-electron/main.js — run this rig through `lifequest-e2e`, which builds the e2e seam",
    );

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.rmSync(REPORT, { force: true });
    for (const shot of SHOTS) fs.rmSync(path.join(ARTIFACTS, shot), { force: true });

    const exitCode = await runRig();
    assert.equal(fs.existsSync(REPORT), true, "the rig wrote no report artifact");

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
    assert.equal(
      report.ok,
      true,
      `the report is not ok:\n${JSON.stringify(report.failures ?? [], null, 2)}`,
    );
    assert.equal(exitCode, 0, `the rig exited ${exitCode}: ${JSON.stringify(report.failures ?? [])}`);

    // ── The world the rig built ────────────────────────────────────────────
    assert.equal(report.world.harnessOnBoot, "hermes", "the world did not boot on Hermes");
    assert.equal(report.seed.hermesReady, "ready", "Hermes never came up in the rig's world");
    assert.equal(report.seed.piReady, "ready", "Pi never came up in the rig's world");
    assert.equal(report.seed.backToHermes, "ready", "the world could not be left on Hermes");
    assert.ok(
      report.seed.piListed.includes("Pi alpha") && report.seed.piListed.includes("Pi beta"),
      `the Pi chats were not seeded: ${JSON.stringify(report.seed.piListed)}`,
    );
    assert.ok(
      report.seed.hermesListed.includes("Hermes alpha") &&
        report.seed.hermesListed.includes("Hermes beta"),
      `the Hermes chats were not seeded: ${JSON.stringify(report.seed.hermesListed)}`,
    );

    assert.equal(report.before.activePill, "Hermes", "the studio did not start on Hermes");
    assert.equal(report.before.tabCount, 2, `the rig opened ${report.before.tabCount} Hermes tabs, not 2`);
    for (const title of ["Hermes alpha", "Hermes beta"]) {
      assert.ok(
        report.before.tabLabels.includes(title),
        `the Hermes tab strip is missing ${title}: ${JSON.stringify(report.before.tabLabels)}`,
      );
    }

    // ── 1. No connection page during the switch ────────────────────────────
    assert.equal(
      report.probe.welcomeSeen,
      0,
      "the connect screen (.welcome-card) appeared during the switch",
    );
    assert.equal(
      report.afterSwitch.welcomeCardAbsent,
      true,
      "the connect screen was in the DOM right after the switch",
    );

    // ── 2. The dashboard node never unmounted ──────────────────────────────
    assert.equal(
      report.probe.dashboardGone,
      0,
      "the marked .home-dashboard node was detached during the switch (the studio remounted)",
    );
    assert.equal(
      report.afterSwitch.markedDashboardPresent,
      true,
      "the dashboard node marked before the switch is gone afterwards",
    );
    assert.equal(
      report.restored.markedDashboardPresent,
      true,
      "the dashboard node marked before the switch is gone after the round trip",
    );

    // ── 3. The splash never reappeared ─────────────────────────────────────
    assert.equal(report.probe.splashSeen, 0, "the launch splash reappeared during the switch");

    // ── 4. The rail and the tab strip swapped to the new agent ─────────────
    assert.ok(
      report.afterSwitch.railTitles.includes("Pi alpha") &&
        report.afterSwitch.railTitles.includes("Pi beta"),
      `the rail did not list the Pi chats: ${JSON.stringify(report.afterSwitch.railTitles)}`,
    );
    assert.equal(
      report.afterSwitch.railTitles.includes("Hermes alpha"),
      false,
      `the rail still listed a Hermes chat after switching to Pi: ${JSON.stringify(report.afterSwitch.railTitles)}`,
    );
    assert.equal(
      report.afterSwitch.tabLabels.some((label) => label.startsWith("Hermes")),
      false,
      `the tab strip still showed a Hermes tab after switching to Pi: ${JSON.stringify(report.afterSwitch.tabLabels)}`,
    );

    // ── 5. The active pill is the one that was clicked ─────────────────────
    assert.equal(report.afterSwitch.activePill, "Pi", "the Pi pill is not the active one");
    assert.equal(
      report.afterSwitch.pillDisabledAtEnd,
      false,
      "the Pi pill is still disabled after the switch settled",
    );

    // ── 6. The switch was quick enough (the actual number is reported) ─────
    assert.ok(
      typeof report.afterSwitch.switchMs === "number" && report.afterSwitch.switchMs > 0,
      `no switch latency was measured: ${report.afterSwitch.switchMs}`,
    );
    assert.ok(
      report.afterSwitch.switchMs <= SWITCH_CEILING_MS,
      `the switch took ${report.afterSwitch.switchMs}ms (ceiling ${SWITCH_CEILING_MS}ms)`,
    );

    // ── 7. Switching back restores the previous agent's rail and tabs ──────
    assert.equal(report.restored.activePill, "Hermes", "the Hermes pill is not active after switching back");
    assert.ok(
      report.restored.railTitles.includes("Hermes alpha") &&
        report.restored.railTitles.includes("Hermes beta"),
      `the Hermes rail did not come back: ${JSON.stringify(report.restored.railTitles)}`,
    );
    assert.ok(
      report.restored.tabLabels.includes("Hermes alpha") &&
        report.restored.tabLabels.includes("Hermes beta"),
      `switching back did not restore the Hermes tabs: ${JSON.stringify(report.restored.tabLabels)}`,
    );
    assert.ok(
      ["Hermes alpha", "Hermes beta"].includes(report.restored.activeTabLabel ?? ""),
      `the restored tab strip has no Hermes tab in front: ${report.restored.activeTabLabel}`,
    );

    // ── 8. Nothing failed in the page ──────────────────────────────────────
    assert.deepEqual(report.consoleErrors, [], "the page logged console errors during the run");
    assert.deepEqual(report.renderProcessGone, [], "a renderer process went away during the run");
    assert.deepEqual(report.pageErrors, [], "the page threw an uncaught error or rejection");

    // ── 9. The dock surface was mounted at every sample ────────────────────
    assert.equal(
      report.probe.chatPanelMissing,
      0,
      "the .chat-panel dock disappeared during the switch",
    );
    assert.equal(
      report.probe.chatPanelPresentEverySample,
      true,
      "the .chat-panel dock was absent in at least one probe sample during the switch",
    );

    // ── A. One switch invoke per pill click; the pending mark clears ────────
    assert.equal(
      report.switchInvokes.duringSwitch,
      1,
      `one Pi pill click sent ${report.switchInvokes.duringSwitch} companion:switchHarness invokes`,
    );
    assert.equal(
      report.switchInvokes.duringRestore,
      1,
      `one Hermes pill click sent ${report.switchInvokes.duringRestore} companion:switchHarness invokes`,
    );
    assert.deepEqual(
      report.pill.pendingAtEnd,
      [],
      `the pending pill mark never cleared: ${JSON.stringify(report.pill.pendingAtEnd)}`,
    );
    assert.deepEqual(
      report.pill.busyAtEnd,
      [],
      `aria-busy never cleared on the pills: ${JSON.stringify(report.pill.busyAtEnd)}`,
    );

    // ── B. The rail never showed an empty column during the switch ─────────
    assert.equal(
      report.rail.blankSamples,
      0,
      `the chat rail went blank ${report.rail.blankSamples} times during the switch: ${JSON.stringify(
        report.rail.blankDetails,
      )}`,
    );
    assert.ok(report.rail.sampleCount > 0, "the rail sampler took no samples");

    // ── C. The composer draft survived the round trip ──────────────────────
    assert.equal(report.draft.typed.ok, true, `the rig could not type a draft: ${JSON.stringify(report.draft.typed)}`);
    assert.equal(report.draft.before.value, report.draft.text, "the draft was not in the composer before the switch");
    assert.equal(
      report.draft.restored.value,
      report.draft.text,
      `the draft was lost by the switch: composer now ${JSON.stringify(report.draft.restored.value)}`,
    );

    // ── D. Per-agent tab memory, restored by a fresh document ──────────────
    assert.notEqual(
      report.persistence.beforeReload.hermesRaw,
      null,
      "no stored tab strip for Hermes (lifequest.companion.openTabs.hermes)",
    );
    assert.notEqual(
      report.persistence.beforeReload.piRaw,
      null,
      "no stored tab strip for Pi (lifequest.companion.openTabs.pi)",
    );
    assert.ok(
      report.reload.tabLabels.includes("Hermes alpha") &&
        report.reload.tabLabels.includes("Hermes beta"),
      `the reload did not restore the two Hermes tabs: ${JSON.stringify(report.reload.tabLabels)}`,
    );
    assert.equal(
      report.reload.activeTabLabel,
      report.restored.activeTabLabel,
      `the reload restored a different tab in front: ${report.reload.activeTabLabel} vs ${report.restored.activeTabLabel}`,
    );

    // ── E. The switch never disabled the target pill ───────────────────────
    assert.equal(
      report.pill.disabledSamples,
      0,
      `the Pi pill was disabled ${report.pill.disabledSamples} samples during the switch`,
    );

    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(path.join(ARTIFACTS, shot)), true, `no ${shot}`);
    }
    assert.deepEqual(report.screenshots, SHOTS, "the report does not name the three screenshots");

    t.diagnostic(`artifact: ${REPORT}`);
    t.diagnostic(`switchMs: ${report.afterSwitch.switchMs}`);
    t.diagnostic(`restored tabs: ${JSON.stringify(report.restored.tabLabels)}`);
  });
});
