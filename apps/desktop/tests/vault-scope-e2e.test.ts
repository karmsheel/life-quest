import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Vault-scoped agents and chats, end to end.
 *
 * The rig boots the real app against a throwaway profile, two real vaults, a
 * throwaway Hermes home and a fake Hermes host that keeps one session store per
 * profile. It seeds the pre-vault world (a flat Pi transcript and legacy prefs),
 * boots onto Alpha, makes an Alpha chat, switches to Beta through the rail-foot
 * vault chip's "Switch vault" dialog, adds a fresh Hermes agent through Settings,
 * makes a Beta Hermes chat, reloads, switches back and forth, and finally reuses
 * Beta's Hermes profile in Alpha through "Use an existing agent…".
 *
 * The assertions below are the important report fields restated by name, so a
 * regression fails here by field instead of as a generic non-zero exit:
 *   - adoption records Alpha's binding as { harness: "pi", hermesProfile: null },
 *     marks the migration done, and moves the flat transcript into Alpha's
 *     bucket (the legacy companionProfile pref must NOT be adopted);
 *   - the vault switch went through the dialog and opened exactly one vault;
 *   - Beta starts with an empty rail, an empty tab strip and Pi only;
 *   - the fresh Hermes agent is bound to Beta, draws the Hermes pill, keeps its
 *     chat across a reload, and is shared with no other vault;
 *   - Alpha never sees a Beta chat or a Hermes pill, and its own chats and strip
 *     come back on return;
 *   - the reuse warning names Beta and says memory, skills and knowledge are
 *     shared; only then does Alpha gain Hermes on that profile;
 *   - the stores on disk and on the host are per vault / per profile.
 *
 * The rig must run through the bench wrapper, because it loads the renderer the
 * shared dev server on 127.0.0.1:5173 serves and the wrapper is what puts THIS
 * checkout there:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> tests/vault-scope-e2e.test.ts
 *
 * A skipped rig is evidence of nothing, so a missing dev server fails loudly
 * instead of skipping.
 */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DRIVER = path.join(desktopRoot, "e2e/vault-scope.electron.mjs");
const REPORT = path.join(desktopRoot, "e2e/artifacts/vault-scope.json");
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const SHOTS = [
  "vault-scope-a.png",
  "vault-scope-b-clean.png",
  "vault-scope-b-hermes.png",
  "vault-scope-a-return.png",
  "vault-scope-reuse-warning.png",
];

const DEV_SERVER = { host: "127.0.0.1", port: 5173 };

const LEGACY_PI_TITLE = "Legacy flat chat";
const ALPHA_CHAT_TITLE = "Alpha own chat";
const BETA_CHAT_TITLE = "Beta Hermes chat";

type Pill = { name: string | null; active: boolean; disabled: boolean; pending: boolean; busy: boolean };

type State = {
  railTitles: string[];
  railActive: string | null;
  railEmptyText: string | null;
  railErrorText: string | null;
  railListPresent: boolean;
  tabLabels: string[];
  activeTabLabel: string | null;
  tabCount: number;
  pills: Pill[];
  pillNames: string[];
  activePill: string | null;
  dashboard: boolean;
  chatPanel: boolean;
  welcomeCard: boolean;
  vaultChipName: string | null;
  switchDialogOpen: boolean;
  settingsOpen: boolean;
  hash: string;
  splashHidden: boolean;
};

type Binding = { harness: "hermes" | "pi"; hermesProfile: string | null };

type AgentsState = {
  vaultId: string | null;
  binding: Binding;
  installedProfiles: {
    name: string;
    path: string;
    isDefault: boolean;
    hasSoul: boolean;
    hasConfig: boolean;
    usedBy: { vaultId: string; vaultName: string }[];
  }[];
  vaultOpen: boolean;
};

type SwitchResult = {
  ok: boolean;
  already?: boolean;
  before: string | null;
  after: string | null;
  dialogOpened: boolean;
  dialogClosed: boolean;
  rowClicked?: boolean;
  reason?: string;
  opens: string[];
  openCount: number;
  otherOpens: string[];
};

type Report = {
  ok: boolean;
  failures: string[];
  checks: { name: string; pass: boolean; detail: unknown }[];
  world: {
    profileDir: string;
    alpha: { id: string; name: string; path: string };
    beta: { id: string; name: string; path: string };
    probeProfile: string;
    freshProfile: string | null;
    devServerUrl: string;
    piEndpoint: string;
    hermesHost: string;
    legacyPrefs: { harness?: string; companionProfile?: string };
  };
  adoption: {
    prefs: Record<string, unknown> | null;
    vaultAgents: Record<string, Binding> | null;
    migrated: boolean;
    legacyHarnessPref: string | null;
    legacyCompanionProfilePref: string | null;
    bindingFromPrefs: Binding | null;
    bindingFromBridge: Binding | null;
    flatRootJson: string[];
    flatFileExists: boolean;
    alphaBucketJson: string[];
    alphaBucketTitles: string[];
    alphaBucketHasLegacy: boolean;
    betaBucketJson: string[];
    railTitles: string[];
    pillNames: string[];
    activePill: string | null;
    tabLabels: string[];
    storage: StorageShape;
  };
  alpha: {
    chat: { ok: boolean; reason?: string; title?: string; before?: string[]; after?: string[] };
    state: State;
    storage: StorageShape;
  };
  grouping: {
    switch: SwitchResult;
    state: State;
    settled: boolean;
    samples: number;
    agents: { available: boolean; state?: AgentsState; error?: string } | null;
    storage: StorageShape;
    alphaTitlesSeen: string[];
  };
  switchToBeta: SwitchResult;
  switchToAlpha: SwitchResult;
  switchBackToBeta: SwitchResult;
  switchToAlphaForReuse: SwitchResult;
  freshAgent: {
    addPath: "ui" | "bridge";
    settingsOpen: { ok: boolean; reason?: string };
    addUi: unknown;
    activation: string;
    activationState: State;
    hermesActive: State;
    profile: string | null;
    binding: Binding | null;
    bindingAfterActivation: Binding | null;
    stateAfterAdd: State;
    installedAfterReload: AgentsState["installedProfiles"] | null;
    agentsAfterAdd: AgentsState | null;
    chat: { ok: boolean; reason?: string; title?: string; before?: string[]; after?: string[] };
    chatState: State;
    storage: StorageShape;
    reload: {
      bootMs: number;
      state: State;
      agents: AgentsState | null;
      settled: boolean;
    };
  };
  isolation: {
    switch: SwitchResult;
    state: State;
    settled: boolean;
    agents: AgentsState | null;
    storage: StorageShape;
    betaTitlesInAlpha: string[];
    betaTabsInAlpha: string[];
  };
  returnAlpha: { state: State; agents: AgentsState | null; storage: StorageShape };
  returnBeta: { state: State; agents: AgentsState | null; storage: StorageShape };
  reuse: {
    path: "ui" | "bridge";
    warning: {
      text: string;
      stage: string;
      namesBeta: boolean;
      mentionsShared: boolean;
      chooser: unknown;
      pick: unknown;
      confirm: unknown;
      dialogText: string;
    };
    bindingBefore: Binding | null;
    bindingAfter: Binding | null;
    bindingAfterActivation: Binding | null;
    stateAfterReuse: State;
    activation: string;
    state: State;
    agents: AgentsState | null;
    fallback: unknown;
  };
  disk: {
    flatRootJson: string[];
    flatRootHasJson: boolean;
    alphaBucketJson: string[];
    alphaBucketTitles: string[];
    betaBucketJson: string[];
    betaBucketTitles: string[];
    hermesStores: Record<string, string[]>;
    probeProfileStore: string[] | null;
    freshProfileStore: string[] | null;
  };
  finalPrefs: {
    vaultAgents: Record<string, Binding> | null;
    migrated: boolean;
    alphaBinding: Binding | null;
    betaBinding: Binding | null;
  };
  vaultOpens: { total: number; entries: { at: number; path: string | null }[] };
  addHermesInvokes: { at: number; input: unknown }[];
  consoleErrors: { level: unknown; message: string; source: string }[];
  consoleErrorsExcluded: { level: unknown; message: string; source: string }[];
  renderProcessGone: { reason: string }[];
  screenshots: string[];
};

type StorageShape = {
  alphaPi: string | null;
  alphaHermes: string | null;
  alphaLast: string | null;
  betaPi: string | null;
  betaHermes: string | null;
  betaLast: string | null;
  legacyOpenTabs: string | null;
  legacyPi: string | null;
  legacyLast: string | null;
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
        timeout: 300_000,
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

describe("vault scope (chats and agents belong to their vault)", () => {
  it("keeps each vault's chats and agent to that vault, and makes reuse explicit", async (t) => {
    const up = await devServerUp();
    assert.equal(
      up,
      true,
      `no dev server on ${DEV_SERVER.host}:${DEV_SERVER.port} — this rig must run through ` +
        "`/root/.local/bin/lifequest-e2e <checkout> tests/vault-scope-e2e.test.ts`, which puts " +
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
    assert.equal(report.world.alpha.name, "Alpha Vault", "the Alpha vault was not created");
    assert.equal(report.world.beta.name, "Beta Vault", "the Beta vault was not created");
    assert.equal(
      report.world.legacyPrefs.harness,
      "pi",
      "the rig's legacy prefs did not declare Pi as the effective harness",
    );
    assert.equal(
      report.world.legacyPrefs.companionProfile,
      report.world.probeProfile,
      "the rig's legacy prefs did not carry the probe Hermes profile",
    );

    // ── 1. Adoption ────────────────────────────────────────────────────────
    assert.deepEqual(
      report.adoption.bindingFromPrefs,
      { harness: "pi", hermesProfile: null },
      `the adopting vault's binding is wrong: ${JSON.stringify(report.adoption.bindingFromPrefs)}`,
    );
    assert.equal(report.adoption.migrated, true, "vaultAgentsMigrated is not true after adoption");
    assert.equal(
      report.adoption.legacyCompanionProfilePref,
      report.world.probeProfile,
      "the legacy companionProfile pref was erased instead of left readable",
    );
    assert.equal(
      report.adoption.bindingFromPrefs?.hermesProfile,
      null,
      "the legacy companionProfile was silently adopted onto a Pi vault",
    );
    assert.equal(report.adoption.flatFileExists, false, "the flat legacy transcript is still in the flat folder");
    assert.equal(
      report.adoption.alphaBucketHasLegacy,
      true,
      `the flat transcript did not move into Alpha's bucket: ${JSON.stringify(report.adoption.alphaBucketJson)}`,
    );
    assert.ok(
      report.adoption.railTitles.includes(LEGACY_PI_TITLE),
      `Alpha did not show the pre-vault chat: ${JSON.stringify(report.adoption.railTitles)}`,
    );
    assert.deepEqual(report.adoption.pillNames, ["Pi"], "Alpha did not start on Pi only");
    assert.equal(report.adoption.activePill, "Pi", "the Pi pill is not active on the adopting vault");

    // ── Alpha's own chat ───────────────────────────────────────────────────
    assert.equal(report.alpha.chat.ok, true, `the Alpha chat was not created: ${JSON.stringify(report.alpha.chat)}`);
    assert.ok(
      report.alpha.state.railTitles.includes(ALPHA_CHAT_TITLE),
      `Alpha's rail does not list its own chat: ${JSON.stringify(report.alpha.state.railTitles)}`,
    );
    assert.equal(
      typeof report.alpha.storage.alphaPi,
      "string",
      "Alpha's strip was not stored under lifequest.companion.openTabs.<AlphaId>.pi",
    );

    // ── 2. Grouping: the switch went through the dialog, and Beta is clean ─
    assert.equal(report.grouping.switch.ok, true, `the switch to Beta failed: ${JSON.stringify(report.grouping.switch)}`);
    assert.equal(report.grouping.switch.dialogOpened, true, "the Switch vault dialog never opened");
    assert.equal(report.grouping.switch.dialogClosed, true, "the Switch vault dialog did not close on the switch");
    assert.equal(report.grouping.switch.after, "Beta Vault", "the rail-foot chip does not name Beta after the switch");
    assert.equal(report.grouping.switch.openCount, 1, `the dialog switch opened ${report.grouping.switch.openCount} vaults`);
    assert.deepEqual(
      report.grouping.switch.otherOpens,
      [],
      `the dialog switch opened something other than Beta: ${JSON.stringify(report.grouping.switch.otherOpens)}`,
    );
    assert.deepEqual(report.grouping.state.railTitles, [], `Beta's rail is not empty: ${JSON.stringify(report.grouping.state.railTitles)}`);
    assert.notEqual(report.grouping.state.railEmptyText, null, "Beta's empty rail shows no empty state");
    assert.equal(report.grouping.state.tabCount, 0, `Beta's tab strip has ${report.grouping.state.tabCount} tabs`);
    assert.deepEqual(report.grouping.state.tabLabels, [], `Beta's tab strip is not empty: ${JSON.stringify(report.grouping.state.tabLabels)}`);
    assert.deepEqual(report.grouping.state.pillNames, ["Pi"], `Beta's switcher does not draw Pi only: ${JSON.stringify(report.grouping.state.pillNames)}`);
    assert.deepEqual(report.grouping.alphaTitlesSeen, [], `Beta's rail showed Alpha's chats: ${JSON.stringify(report.grouping.alphaTitlesSeen)}`);
    assert.equal(
      report.grouping.storage.alphaPi,
      report.alpha.storage.alphaPi,
      "Alpha's remembered strip was overwritten while Beta was open",
    );

    // ── 3. Fresh agent on Beta ─────────────────────────────────────────────
    assert.equal(report.freshAgent.addPath, "ui", "the fresh agent was not added through Settings");
    assert.ok(
      typeof report.freshAgent.profile === "string" && report.freshAgent.profile.length > 0,
      `the fresh agent has no profile name: ${JSON.stringify(report.freshAgent.profile)}`,
    );
    assert.notEqual(report.freshAgent.profile, report.world.probeProfile, "the fresh agent bound the legacy probe profile");
    assert.equal(
      report.freshAgent.binding?.hermesProfile,
      report.freshAgent.profile,
      `Beta's binding does not name the fresh profile: ${JSON.stringify(report.freshAgent.binding)}`,
    );
    assert.equal(
      report.freshAgent.binding?.harness,
      "pi",
      `adding the agent switched Beta's answering agent: ${JSON.stringify(report.freshAgent.binding)}`,
    );
    assert.equal(
      report.freshAgent.stateAfterAdd.activePill,
      "Pi",
      "adding the Hermes agent switched Beta off Pi instead of only making Hermes available",
    );
    assert.ok(
      report.freshAgent.hermesActive.pillNames.includes("Hermes"),
      `Beta does not draw the Hermes pill: ${JSON.stringify(report.freshAgent.hermesActive.pillNames)}`,
    );
    assert.equal(report.freshAgent.hermesActive.activePill, "Hermes", "Use Hermes did not make Hermes the active agent");
    assert.equal(
      report.freshAgent.bindingAfterActivation?.harness,
      "hermes",
      `Use Hermes did not record the active agent: ${JSON.stringify(report.freshAgent.bindingAfterActivation)}`,
    );
    assert.equal(report.freshAgent.chat.ok, true, `the Beta Hermes chat was not created: ${JSON.stringify(report.freshAgent.chat)}`);
    assert.ok(
      report.freshAgent.chatState.railTitles.includes(BETA_CHAT_TITLE),
      `Beta's Hermes rail does not list its chat: ${JSON.stringify(report.freshAgent.chatState.railTitles)}`,
    );
    assert.ok(
      report.freshAgent.reload.state.railTitles.includes(BETA_CHAT_TITLE),
      `the reload lost Beta's Hermes chat: ${JSON.stringify(report.freshAgent.reload.state.railTitles)}`,
    );
    assert.ok(
      report.freshAgent.reload.state.pillNames.includes("Hermes"),
      `the reload lost Beta's Hermes pill: ${JSON.stringify(report.freshAgent.reload.state.pillNames)}`,
    );
    assert.equal(
      report.freshAgent.reload.agents?.binding.hermesProfile,
      report.freshAgent.profile,
      "the reload lost Beta's Hermes binding",
    );
    const installedAfterReload = report.freshAgent.installedAfterReload ?? [];
    const freshProfileRow = installedAfterReload.find(
      (profile) => profile.name === report.freshAgent.profile,
    );
    assert.ok(
      freshProfileRow,
      `the fresh profile is not installed after its ensure ran: ${JSON.stringify(
        installedAfterReload.map((profile) => profile.name),
      )}`,
    );
    assert.deepEqual(
      freshProfileRow?.usedBy,
      [],
      `the fresh profile is already shared: ${JSON.stringify(freshProfileRow?.usedBy)}`,
    );

    // ── 4. Isolation and return ────────────────────────────────────────────
    assert.deepEqual(report.isolation.betaTitlesInAlpha, [], "Beta's Hermes chat leaked into Alpha's rail");
    assert.deepEqual(report.isolation.betaTabsInAlpha, [], "Beta's Hermes tab leaked into Alpha's strip");
    assert.deepEqual(
      report.isolation.state.pillNames,
      ["Pi"],
      `Alpha draws a Hermes pill it never added: ${JSON.stringify(report.isolation.state.pillNames)}`,
    );
    assert.deepEqual(
      report.isolation.agents?.binding,
      { harness: "pi", hermesProfile: null },
      `Alpha's binding was contaminated by Beta: ${JSON.stringify(report.isolation.agents?.binding)}`,
    );
    assert.ok(
      report.returnAlpha.state.railTitles.includes(LEGACY_PI_TITLE) &&
        report.returnAlpha.state.railTitles.includes(ALPHA_CHAT_TITLE),
      `Alpha's own chats did not come back: ${JSON.stringify(report.returnAlpha.state.railTitles)}`,
    );
    assert.ok(
      report.returnAlpha.state.tabLabels.includes(ALPHA_CHAT_TITLE),
      `Alpha's tab strip did not come back: ${JSON.stringify(report.returnAlpha.state.tabLabels)}`,
    );
    assert.ok(
      report.returnBeta.state.railTitles.includes(BETA_CHAT_TITLE),
      `Beta's Hermes chat did not come back: ${JSON.stringify(report.returnBeta.state.railTitles)}`,
    );
    assert.deepEqual(
      report.returnBeta.state.pillNames.slice().sort(),
      ["Hermes", "Pi"],
      `Beta does not draw both pills on return: ${JSON.stringify(report.returnBeta.state.pillNames)}`,
    );
    assert.equal(report.returnBeta.state.activePill, "Hermes", "Beta did not return on its Hermes agent");

    // ── 5. Reuse is explicit ───────────────────────────────────────────────
    assert.deepEqual(
      report.reuse.bindingBefore,
      { harness: "pi", hermesProfile: null },
      `Alpha had a Hermes agent before reuse: ${JSON.stringify(report.reuse.bindingBefore)}`,
    );
    assert.equal(report.reuse.path, "ui", "the reuse was not driven through Settings");
    assert.equal(
      report.reuse.warning.namesBeta,
      true,
      `the reuse warning does not name Beta: ${JSON.stringify(report.reuse.warning.text.slice(0, 500))}`,
    );
    assert.equal(
      report.reuse.warning.mentionsShared,
      true,
      `the reuse warning does not say memory/skills/knowledge are shared: ${JSON.stringify(report.reuse.warning.text.slice(0, 500))}`,
    );
    assert.equal(
      report.reuse.bindingAfter?.hermesProfile,
      report.freshAgent.profile,
      `Alpha did not take Beta's profile: ${JSON.stringify(report.reuse.bindingAfter)}`,
    );
    assert.equal(
      report.reuse.bindingAfter?.harness,
      "pi",
      `reusing the profile switched Alpha's answering agent: ${JSON.stringify(report.reuse.bindingAfter)}`,
    );
    assert.equal(
      report.reuse.stateAfterReuse.activePill,
      "Pi",
      "reusing the profile switched Alpha off Pi instead of only making Hermes available",
    );
    assert.equal(
      report.reuse.bindingAfterActivation?.harness,
      "hermes",
      `Use Hermes did not record the active agent: ${JSON.stringify(report.reuse.bindingAfterActivation)}`,
    );
    assert.ok(
      report.reuse.state.pillNames.includes("Hermes"),
      `Alpha does not draw Hermes after reuse: ${JSON.stringify(report.reuse.state.pillNames)}`,
    );
    assert.equal(report.reuse.state.activePill, "Hermes", "Use Hermes did not activate Alpha's reused agent");
    assert.ok(
      report.reuse.state.railTitles.includes(BETA_CHAT_TITLE),
      `Alpha does not see the shared profile's chat: ${JSON.stringify(report.reuse.state.railTitles)}`,
    );
    assert.equal(
      report.finalPrefs.alphaBinding?.hermesProfile,
      report.freshAgent.profile,
      "the shared binding is not recorded in prefs for Alpha",
    );

    // ── Stores are per vault / per profile ─────────────────────────────────
    assert.equal(report.disk.flatRootHasJson, false, `flat pi-sessions still holds transcripts: ${JSON.stringify(report.disk.flatRootJson)}`);
    assert.ok(
      report.disk.alphaBucketTitles.includes(LEGACY_PI_TITLE) &&
        report.disk.alphaBucketTitles.includes(ALPHA_CHAT_TITLE),
      `Alpha's Pi bucket lost its chats: ${JSON.stringify(report.disk.alphaBucketTitles)}`,
    );
    assert.equal(
      report.disk.alphaBucketTitles.includes(BETA_CHAT_TITLE),
      false,
      "Beta's Hermes chat leaked into Alpha's Pi bucket",
    );
    assert.equal(
      report.disk.betaBucketTitles.includes(LEGACY_PI_TITLE) ||
        report.disk.betaBucketTitles.includes(ALPHA_CHAT_TITLE),
      false,
      `Beta's Pi bucket holds Alpha's chats: ${JSON.stringify(report.disk.betaBucketTitles)}`,
    );
    assert.ok(
      Array.isArray(report.disk.freshProfileStore) &&
        report.disk.freshProfileStore.includes(BETA_CHAT_TITLE),
      `the fresh profile's host store does not hold Beta's chat: ${JSON.stringify(report.disk.freshProfileStore)}`,
    );
    assert.equal(
      report.disk.probeProfileStore,
      null,
      "the host served the legacy probe profile, so it was attached to after all",
    );

    // ── Nothing failed in the page ─────────────────────────────────────────
    assert.deepEqual(report.consoleErrors, [], "the page logged console errors during the run");
    assert.deepEqual(report.renderProcessGone, [], "a renderer process went away during the run");

    for (const shot of SHOTS) {
      assert.equal(fs.existsSync(path.join(ARTIFACTS, shot)), true, `no ${shot}`);
    }
    assert.deepEqual(report.screenshots, SHOTS, "the report does not name the five screenshots");

    t.diagnostic(`artifact: ${REPORT}`);
    t.diagnostic(`fresh profile: ${report.freshAgent.profile}`);
    t.diagnostic(`alpha rail: ${JSON.stringify(report.returnAlpha.state.railTitles)}`);
    t.diagnostic(`beta pills: ${JSON.stringify(report.returnBeta.state.pillNames)}`);
    t.diagnostic(`vault opens: ${JSON.stringify(report.vaultOpens.entries.map((entry) => entry.path))}`);
  });
});
